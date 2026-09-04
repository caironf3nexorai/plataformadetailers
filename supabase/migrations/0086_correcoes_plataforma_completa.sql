-- Migration 0086: Correções da Plataforma NuvemWash
-- 1. Corrige erro 'categoria_custo does not exist' em obter_ou_gerar_despesas_mes
-- 2. Permite preço customizado por serviço no orçamento em salvar_nivel_orcamento
-- 3. Adiciona campo modo_orcamento em orcamentos ('tres_niveis' | 'simples')
-- 4. Adiciona p_cor em cadastro_rapido para salvar cor do veículo

-- 1. CORREÇÃO DA RPC obter_ou_gerar_despesas_mes (Usa 'categoria' em vez de 'categoria_custo')
CREATE OR REPLACE FUNCTION public.obter_ou_gerar_despesas_mes(
  p_tenant uuid,
  p_mes date
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_inicio_mes date := date_trunc('month', p_mes)::date;
  v_fim_mes date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_inicio_mes_ant date := (date_trunc('month', p_mes) - interval '1 month')::date;
  v_fim_mes_ant date := (date_trunc('month', p_mes) - interval '1 day')::date;
  v_rec record;
  v_pai_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT (p_tenant IN (SELECT public.meus_tenants()) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  FOR v_rec IN
    SELECT d.*
    FROM public.despesas_fixas d
    WHERE d.tenant_id = p_tenant
      AND d.tipo = 'variavel'
      AND d.vigencia_inicio <= v_fim_mes_ant
      AND (d.vigencia_fim IS NULL OR d.vigencia_fim >= v_inicio_mes_ant)
      AND NOT EXISTS (
        SELECT 1 FROM public.despesas_fixas d_atual
        WHERE d_atual.tenant_id = p_tenant
          AND d_atual.tipo = 'variavel'
          AND (
            d_atual.id = d.id 
            OR d_atual.despesa_pai_id = coalesce(d.despesa_pai_id, d.id)
            OR lower(trim(d_atual.nome)) = lower(trim(d.nome))
          )
          AND d_atual.vigencia_inicio <= v_fim_mes
          AND (d_atual.vigencia_fim IS NULL OR d_atual.vigencia_fim >= v_inicio_mes)
      )
  LOOP
    v_pai_id := coalesce(v_rec.despesa_pai_id, v_rec.id);
    INSERT INTO public.despesas_fixas (
      tenant_id, nome, categoria, valor_mensal, vigencia_inicio, vigencia_fim,
      tipo, despesa_pai_id, confirmado, confirmado_em, confirmado_por, criado_por
    ) VALUES (
      p_tenant, v_rec.nome, coalesce(v_rec.categoria, 'Geral'), v_rec.valor_mensal, v_inicio_mes, v_fim_mes,
      'variavel', v_pai_id, false, null, null, coalesce(v_rec.criado_por, auth.uid())
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_ou_gerar_despesas_mes(uuid, date) TO authenticated;


-- 2. AJUSTE EM salvar_nivel_orcamento PARA SUPORTAR PREÇO E DURAÇÃO CUSTOMIZADOS
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
          SELECT sp.preco_base, coalesce(sp.duracao_minutos, 60)
          INTO v_preco, v_duracao
          FROM public.servico_precos sp
          WHERE sp.servico_id = v_servico_id
            AND (sp.ativo IS TRUE OR sp.ativo IS NULL)
            AND sp.preco_base IS NOT NULL
            AND sp.preco_base > 0
          ORDER BY (CASE WHEN sp.categoria_id = v_orcamento_rec.categoria_id THEN 0 ELSE 1 END)
          LIMIT 1;

          IF v_preco IS NULL OR v_preco = 0 THEN
            SELECT s.preco_base, coalesce(s.duracao_minutos, 60)
            INTO v_preco, v_duracao
            FROM public.servicos s
            WHERE s.id = v_servico_id;
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


-- 3. ADICIONA COLUNA modo_orcamento NA TABELA orcamentos
ALTER TABLE public.orcamentos 
ADD COLUMN IF NOT EXISTS modo_orcamento text DEFAULT 'tres_niveis' CHECK (modo_orcamento IN ('tres_niveis', 'simples'));


-- 4. ATUALIZAÇÃO DA RPC cadastro_rapido PARA INCLUIR COR DO VEÍCULO
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
