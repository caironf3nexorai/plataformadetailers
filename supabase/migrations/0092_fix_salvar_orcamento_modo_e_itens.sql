-- =========================================================================================
-- MIGRATION 0092: CORREÇÃO DEFINITIVA DE MODO ORÇAMENTO E SALVAR_NIVEL_ORCAMENTO
-- 1. Permite '3_niveis', 'tres_niveis' e 'simples' na restrição check de orcamentos.modo_orcamento
-- 2. Torna servico_id opcional em orcamento_nivel_itens para permitir combos
-- 3. Corrige salvar_nivel_orcamento eliminando referência à coluna inexistente s.preco_base
-- =========================================================================================

-- 1. Restrição de modo_orcamento em orcamentos
ALTER TABLE public.orcamentos DROP CONSTRAINT IF EXISTS orcamentos_modo_orcamento_check;
ALTER TABLE public.orcamentos ADD CONSTRAINT orcamentos_modo_orcamento_check 
  CHECK (modo_orcamento IS NULL OR modo_orcamento IN ('tres_niveis', '3_niveis', 'simples'));

-- 2. Torna servico_id opcional em orcamento_nivel_itens
ALTER TABLE public.orcamento_nivel_itens ALTER COLUMN servico_id DROP NOT NULL;

-- 3. Ajuste em salvar_nivel_orcamento
CREATE OR REPLACE FUNCTION public.salvar_nivel_orcamento(
  p_nivel uuid,
  p_itens jsonb,
  p_titulo text default null,
  p_descricao text default null
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_nivel_rec record;
  v_orcamento_rec record;
  v_item jsonb;
  v_servico_id uuid;
  v_combo_id uuid;
  v_preco numeric(10,2);
  v_preco_custom numeric(10,2);
  v_duracao integer;
  v_duracao_custom integer;
  v_total_valor numeric(10,2) := 0;
  v_total_duracao integer := 0;
  v_ordem smallint := 1;
BEGIN
  SELECT n.* INTO v_nivel_rec FROM public.orcamento_niveis n WHERE n.id = p_nivel;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nível de orçamento não encontrado.';
  END IF;

  SELECT o.* INTO v_orcamento_rec FROM public.orcamentos o WHERE o.id = v_nivel_rec.orcamento_id;

  IF NOT public.tem_papel(v_orcamento_rec.tenant_id, ARRAY['dono', 'gerente']::app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado. Apenas dono e gerente podem editar orçamentos.';
  END IF;

  -- Atualiza título e descrição do nível se informados
  UPDATE public.orcamento_niveis
  SET titulo = coalesce(p_titulo, titulo),
      descricao = coalesce(p_descricao, descricao)
  WHERE id = p_nivel;

  -- Deleta itens anteriores do nível
  DELETE FROM public.orcamento_nivel_itens WHERE nivel_id = p_nivel;

  -- Inserção dos itens com suporte a preço customizado por serviço
  IF p_itens IS NOT NULL AND jsonb_array_length(p_itens) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens)
    LOOP
      v_servico_id := nullif(v_item->>'servico_id', '')::uuid;
      v_combo_id := nullif(v_item->>'combo_id', '')::uuid;

      v_preco_custom := CASE 
        WHEN v_item ? 'preco' AND nullif(v_item->>'preco', '') IS NOT NULL 
        THEN (v_item->>'preco')::numeric(10,2) 
        ELSE null 
      END;

      v_duracao_custom := CASE 
        WHEN v_item ? 'duracao_minutos' AND nullif(v_item->>'duracao_minutos', '') IS NOT NULL 
        THEN (v_item->>'duracao_minutos')::integer 
        ELSE null 
      END;

      v_preco := 0;
      v_duracao := 60;

      IF v_combo_id IS NOT NULL THEN
        IF v_preco_custom IS NOT NULL AND v_preco_custom >= 0 THEN
          v_preco := v_preco_custom;
        ELSE
          SELECT cp.preco_base, coalesce(cp.duracao_minutos, 60)
          INTO v_preco, v_duracao
          FROM public.combo_precos cp
          WHERE cp.combo_id = v_combo_id
            AND (cp.ativo IS TRUE OR cp.ativo IS NULL)
            AND cp.preco_base IS NOT NULL
          ORDER BY (CASE WHEN cp.categoria_id = v_orcamento_rec.categoria_id THEN 0 ELSE 1 END)
          LIMIT 1;
        END IF;

        IF v_duracao_custom IS NOT NULL AND v_duracao_custom > 0 THEN
          v_duracao := v_duracao_custom;
        END IF;

        v_preco := coalesce(v_preco, 0);
        v_duracao := coalesce(v_duracao, 60);

        INSERT INTO public.orcamento_nivel_itens (
          tenant_id, nivel_id, servico_id, combo_id, preco, duracao_minutos, ordem
        ) VALUES (
          v_orcamento_rec.tenant_id, p_nivel, null, v_combo_id, v_preco, v_duracao, v_ordem
        );

        v_total_valor := v_total_valor + v_preco;
        v_total_duracao := v_total_duracao + v_duracao;
        v_ordem := v_ordem + 1;

      ELSIF v_servico_id IS NOT NULL THEN
        IF v_preco_custom IS NOT NULL AND v_preco_custom >= 0 THEN
          v_preco := v_preco_custom;
        ELSE
          -- Tenta buscar preço da categoria do orçamento
          SELECT sp.preco_base, coalesce(sp.duracao_minutos, 60)
          INTO v_preco, v_duracao
          FROM public.servico_precos sp
          WHERE sp.servico_id = v_servico_id
            AND (sp.ativo IS TRUE OR sp.ativo IS NULL)
            AND sp.preco_base IS NOT NULL
            AND sp.preco_base > 0
          ORDER BY (CASE WHEN sp.categoria_id = v_orcamento_rec.categoria_id THEN 0 ELSE 1 END)
          LIMIT 1;

          -- Fallback seguro: se não achou para a categoria, busca qualquer preço ativo do serviço
          IF v_preco IS NULL OR v_preco = 0 THEN
            SELECT sp.preco_base, coalesce(sp.duracao_minutos, 60)
            INTO v_preco, v_duracao
            FROM public.servico_precos sp
            WHERE sp.servico_id = v_servico_id
              AND (sp.ativo IS TRUE OR sp.ativo IS NULL)
              AND sp.preco_base IS NOT NULL
            ORDER BY sp.preco_base DESC
            LIMIT 1;
          END IF;
        END IF;

        IF v_duracao_custom IS NOT NULL AND v_duracao_custom > 0 THEN
          v_duracao := v_duracao_custom;
        END IF;

        v_preco := coalesce(v_preco, 0);
        v_duracao := coalesce(v_duracao, 60);

        INSERT INTO public.orcamento_nivel_itens (
          tenant_id, nivel_id, servico_id, combo_id, preco, duracao_minutos, ordem
        ) VALUES (
          v_orcamento_rec.tenant_id, p_nivel, v_servico_id, null, v_preco, v_duracao, v_ordem
        );

        v_total_valor := v_total_valor + v_preco;
        v_total_duracao := v_total_duracao + v_duracao;
        v_ordem := v_ordem + 1;
      END IF;
    END LOOP;
  END IF;

  -- Recalcula totais do nível
  UPDATE public.orcamento_niveis
  SET valor_total = v_total_valor,
      duracao_total = v_total_duracao
  WHERE id = p_nivel;
END;
$$;

GRANT EXECUTE ON FUNCTION public.salvar_nivel_orcamento(uuid, jsonb, text, text) TO authenticated;

-- =========================================================================================
-- 4. ATUALIZAÇÃO DA RPC cadastro_rapido PARA INCLUIR COR DO VEÍCULO (SETE PARÂMETROS)
-- =========================================================================================
DROP FUNCTION IF EXISTS public.cadastro_rapido(text, text, text, uuid, text, text);

CREATE OR REPLACE FUNCTION public.cadastro_rapido(
  p_nome text,
  p_telefone text,
  p_placa text default null,
  p_categoria uuid default null,
  p_marca text default null,
  p_modelo text default null,
  p_cor text default null
)
RETURNS TABLE (out_cliente_id uuid, out_veiculo_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_tenant_id uuid;
  v_cliente_id uuid;
  v_veiculo_id uuid;
  v_placa_clean text;
  v_existente_id uuid;
  v_existente_cliente_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT tm.tenant_id INTO v_tenant_id
  FROM public.tenant_members tm
  WHERE tm.user_id = auth.uid() AND tm.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Nenhum tenant ativo encontrado para o usuário.';
  END IF;

  IF NOT public.tem_papel(v_tenant_id, ARRAY['dono', 'gerente']::public.app_role[]) THEN
    RAISE EXCEPTION 'Operadores não podem cadastrar clientes ou veículos.';
  END IF;

  IF coalesce(trim(p_nome), '') = '' THEN
    RAISE EXCEPTION 'Nome do cliente é obrigatório.';
  END IF;

  IF coalesce(trim(p_telefone), '') = '' THEN
    RAISE EXCEPTION 'Telefone do cliente é obrigatório.';
  END IF;

  -- 1. Busca ou cria o cliente pelo telefone
  SELECT c.id INTO v_cliente_id
  FROM public.clientes c
  WHERE c.tenant_id = v_tenant_id AND c.telefone = trim(p_telefone) AND c.ativo = true
  LIMIT 1;

  IF v_cliente_id IS NULL THEN
    INSERT INTO public.clientes (tenant_id, nome, telefone)
    VALUES (v_tenant_id, trim(p_nome), trim(p_telefone))
    RETURNING clientes.id INTO v_cliente_id;
  END IF;

  -- 2. Se informou dados do veículo
  IF p_placa IS NOT NULL AND trim(p_placa) <> '' THEN
    v_placa_clean := upper(trim(p_placa));

    SELECT v.id, v.cliente_id INTO v_existente_id, v_existente_cliente_id
    FROM public.veiculos v
    WHERE v.tenant_id = v_tenant_id AND v.placa = v_placa_clean
    LIMIT 1;

    IF v_existente_id IS NOT NULL THEN
      v_veiculo_id := v_existente_id;

      IF v_existente_cliente_id IS DISTINCT FROM v_cliente_id THEN
        PERFORM public.transferir_veiculo(v_veiculo_id, v_cliente_id, current_date);
      END IF;

      -- Se a cor foi informada e o veículo ainda não tinha cor, atualiza
      IF p_cor IS NOT NULL AND trim(p_cor) <> '' THEN
        UPDATE public.veiculos
        SET cor = trim(p_cor)
        WHERE id = v_veiculo_id AND (cor IS NULL OR cor = '');
      END IF;
    ELSE
      IF p_categoria IS NULL THEN
        RAISE EXCEPTION 'Categoria do veículo é obrigatória para novo veículo.';
      END IF;

      INSERT INTO public.veiculos (tenant_id, cliente_id, categoria_id, placa, marca, modelo, cor)
      VALUES (v_tenant_id, v_cliente_id, p_categoria, v_placa_clean, trim(p_marca), trim(p_modelo), trim(p_cor))
      RETURNING veiculos.id INTO v_veiculo_id;

      INSERT INTO public.veiculo_donos (tenant_id, veiculo_id, cliente_id, inicio, fim)
      VALUES (v_tenant_id, v_veiculo_id, v_cliente_id, current_date, null);
    END IF;
  END IF;

  out_cliente_id := v_cliente_id;
  out_veiculo_id := v_veiculo_id;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cadastro_rapido(text, text, text, uuid, text, text, text) TO authenticated;

-- =========================================================================================
-- 5. RPC atualizar_veiculo (PERMITE ATUALIZAR DADOS E COR DO VEÍCULO CADASTRADO)
-- =========================================================================================
CREATE OR REPLACE FUNCTION public.atualizar_veiculo(
  p_veiculo_id uuid,
  p_cor text default null,
  p_marca text default null,
  p_modelo text default null,
  p_ano integer default null,
  p_placa text default null,
  p_categoria_id uuid default null,
  p_observacoes text default null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_veiculo record;
  v_ret jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT v.* INTO v_veiculo
  FROM public.veiculos v
  WHERE v.id = p_veiculo_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Veículo não encontrado.';
  END IF;

  -- Verifica se o usuário pertence ao mesmo tenant do veículo
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.user_id = auth.uid()
      AND tm.tenant_id = v_veiculo.tenant_id
      AND tm.status = 'ativo'
  ) THEN
    RAISE EXCEPTION 'Acesso negado ao veículo deste tenant.';
  END IF;

  UPDATE public.veiculos
  SET
    cor = CASE WHEN p_cor IS NOT NULL THEN nullif(trim(p_cor), '') ELSE cor END,
    marca = CASE WHEN p_marca IS NOT NULL THEN nullif(trim(p_marca), '') ELSE marca END,
    modelo = CASE WHEN p_modelo IS NOT NULL THEN nullif(trim(p_modelo), '') ELSE modelo END,
    ano = CASE WHEN p_ano IS NOT NULL THEN p_ano ELSE ano END,
    placa = CASE WHEN p_placa IS NOT NULL AND trim(p_placa) <> '' THEN upper(trim(p_placa)) ELSE placa END,
    categoria_id = CASE WHEN p_categoria_id IS NOT NULL THEN p_categoria_id ELSE categoria_id END,
    observacoes = CASE WHEN p_observacoes IS NOT NULL THEN nullif(trim(p_observacoes), '') ELSE observacoes END,
    updated_at = now()
  WHERE id = p_veiculo_id;

  SELECT jsonb_build_object(
    'id', v.id,
    'tenant_id', v.tenant_id,
    'cliente_id', v.cliente_id,
    'categoria_id', v.categoria_id,
    'placa', v.placa,
    'marca', v.marca,
    'modelo', v.modelo,
    'cor', v.cor,
    'ano', v.ano,
    'observacoes', v.observacoes,
    'ativo', v.ativo,
    'updated_at', v.updated_at
  ) INTO v_ret
  FROM public.veiculos v
  WHERE v.id = p_veiculo_id;

  RETURN v_ret;
END;
$$;

GRANT EXECUTE ON FUNCTION public.atualizar_veiculo(uuid, text, text, text, integer, text, uuid, text) TO authenticated;

-- ============================================================================
-- 4. PERMISSÕES DE EXCLUSÃO (DELETE)
-- ============================================================================
GRANT DELETE ON public.orcamentos TO authenticated;
GRANT DELETE ON public.orcamento_niveis TO authenticated;
GRANT DELETE ON public.orcamento_nivel_itens TO authenticated;
GRANT DELETE ON public.orcamento_fotos TO authenticated;
GRANT DELETE ON public.clientes TO authenticated;

-- ============================================================================
-- 5. RPC EXCLUIR_ORCAMENTO
-- ============================================================================
CREATE OR REPLACE FUNCTION public.excluir_orcamento(p_orcamento_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orcamento record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT * INTO v_orcamento FROM public.orcamentos WHERE id = p_orcamento_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.';
  END IF;

  IF NOT public.tem_papel(v_orcamento.tenant_id, array['dono', 'gerente']::app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado. Apenas donos e gerentes podem excluir orçamentos.';
  END IF;

  -- Se já estiver aprovado e tiver agendamento ativo vinculado, bloquear
  IF v_orcamento.status = 'aprovado' AND v_orcamento.agendamento_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.agendamentos 
      WHERE id = v_orcamento.agendamento_id 
        AND status NOT IN ('cancelado')
    ) THEN
      RAISE EXCEPTION 'Este orçamento possui um agendamento ativo. Cancele o agendamento antes de excluir o orçamento.';
    END IF;
  END IF;

  -- Exclusão segura em cascata
  DELETE FROM public.orcamento_fotos WHERE orcamento_id = p_orcamento_id;
  DELETE FROM public.orcamento_nivel_itens WHERE nivel_id IN (
    SELECT id FROM public.orcamento_niveis WHERE orcamento_id = p_orcamento_id
  );
  DELETE FROM public.orcamento_niveis WHERE orcamento_id = p_orcamento_id;
  DELETE FROM public.orcamentos WHERE id = p_orcamento_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.excluir_orcamento(uuid) TO authenticated;

-- ============================================================================
-- 6. RPC ATUALIZAR_CLIENTE_ORCAMENTO
-- Permite alterar o cliente e veículo de um orçamento que não esteja aprovado/concluído
-- ============================================================================
CREATE OR REPLACE FUNCTION public.atualizar_cliente_orcamento(
  p_orcamento_id uuid,
  p_cliente_id uuid,
  p_veiculo_id uuid DEFAULT NULL,
  p_categoria_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orcamento record;
  v_cat_id uuid;
  v_ret jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT * INTO v_orcamento FROM public.orcamentos WHERE id = p_orcamento_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.';
  END IF;

  IF NOT public.tem_papel(v_orcamento.tenant_id, array['dono', 'gerente']::app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  IF v_orcamento.status = 'aprovado' THEN
    RAISE EXCEPTION 'Orçamentos aprovados ou concluídos não permitem alteração de cliente. Crie um novo orçamento se necessário.';
  END IF;

  -- Validação de cliente no mesmo tenant
  IF NOT EXISTS (
    SELECT 1 FROM public.clientes 
    WHERE id = p_cliente_id AND tenant_id = v_orcamento.tenant_id
  ) THEN
    RAISE EXCEPTION 'Cliente inválido ou pertencente a outra oficina.';
  END IF;

  -- Se veículo informado, obtém categoria se não especificada
  IF p_veiculo_id IS NOT NULL THEN
    SELECT categoria_id INTO v_cat_id 
    FROM public.veiculos 
    WHERE id = p_veiculo_id AND tenant_id = v_orcamento.tenant_id;
  END IF;

  IF p_categoria_id IS NOT NULL THEN
    v_cat_id := p_categoria_id;
  END IF;

  IF v_cat_id IS NULL THEN
    v_cat_id := v_orcamento.categoria_id;
  END IF;

  UPDATE public.orcamentos
  SET cliente_id = p_cliente_id,
      veiculo_id = p_veiculo_id,
      categoria_id = v_cat_id,
      updated_at = now()
  WHERE id = p_orcamento_id;

  SELECT jsonb_build_object(
    'id', o.id,
    'cliente_id', o.cliente_id,
    'veiculo_id', o.veiculo_id,
    'categoria_id', o.categoria_id,
    'status', o.status,
    'updated_at', o.updated_at
  ) INTO v_ret
  FROM public.orcamentos o
  WHERE o.id = p_orcamento_id;

  RETURN v_ret;
END;
$$;

GRANT EXECUTE ON FUNCTION public.atualizar_cliente_orcamento(uuid, uuid, uuid, uuid) TO authenticated;

-- ============================================================================
-- 7. RPC REGISTRAR_SINAL_PAGO (Garante compatibilidade de parâmetro e search_path)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.registrar_sinal_pago(p_agendamento uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agendamento record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT a.* INTO v_agendamento FROM public.agendamentos a WHERE a.id = p_agendamento;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado.';
  END IF;

  IF NOT public.tem_papel(v_agendamento.tenant_id, array['dono', 'gerente']::app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  UPDATE public.agendamentos
  SET sinal_status = 'pago',
      sinal_pago_em = now(),
      updated_at = now()
  WHERE id = p_agendamento;
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_sinal_pago(uuid) TO authenticated;

-- ============================================================================
-- 8. RPCs CONFIRMAR E RECUSAR AGENDAMENTO ONLINE (Garante compatibilidade e permissões)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.confirmar_agendamento_online(p_agendamento uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agendamento record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT a.* INTO v_agendamento FROM public.agendamentos a WHERE a.id = p_agendamento;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado.';
  END IF;

  IF NOT public.tem_papel(v_agendamento.tenant_id, array['dono', 'gerente']::app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  UPDATE public.agendamentos
  SET status = 'confirmado',
      updated_at = now()
  WHERE id = p_agendamento;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirmar_agendamento_online(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.recusar_agendamento_online(p_agendamento uuid, p_motivo text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agendamento record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT a.* INTO v_agendamento FROM public.agendamentos a WHERE a.id = p_agendamento;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado.';
  END IF;

  IF NOT public.tem_papel(v_agendamento.tenant_id, array['dono', 'gerente']::app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  UPDATE public.agendamentos
  SET status = 'cancelado',
      motivo_cancelamento = coalesce(p_motivo, 'Recusado pelo estabelecimento'),
      cancelado_em = now(),
      cancelado_por = auth.uid(),
      updated_at = now()
  WHERE id = p_agendamento;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recusar_agendamento_online(uuid, text) TO authenticated;


