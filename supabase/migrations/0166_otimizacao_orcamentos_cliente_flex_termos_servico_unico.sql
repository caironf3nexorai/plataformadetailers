-- ==============================================================================
-- MIGRAÇÃO 0166: OTIMIZAÇÃO DE TEMPO E AGILIDADE EM ORÇAMENTOS
-- 1. Dados do cliente flexíveis/avulsos em orcamentos (cliente_id opcional + avulso)
-- 2. Defaults desmarcados (false) para Termos e Fotos em orcamentos
-- 3. Serviço Único (avulso, sem cadastro no catálogo) em orcamento_nivel_itens
--    e agendamento_itens (servico_id opcional + servico_nome)
-- 4. RPCs atualizadas mantendo blindagem de segurança/tenancy (0163):
--    criar_orcamento, atualizar_cliente_orcamento, salvar_nivel_orcamento,
--    orcamento_publico, responder_orcamento, converter_orcamento_em_agendamento,
--    agendar_orcamento_publico (Opção B), horarios_disponiveis, reagendar,
--    iniciar_execucao, buscar_agendamentos, rentabilidade_por_servico,
--    historico_consumo_veiculo, atendimentos_periodo
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ALTERAÇÕES ESTRUTURAIS DE TABELAS
-- ------------------------------------------------------------------------------

-- 1.1 public.orcamentos: cliente opcional, campos avulsos e checkboxes false por padrão
ALTER TABLE public.orcamentos
  ALTER COLUMN cliente_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS cliente_nome_avulso text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cliente_telefone_avulso text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS veiculo_descricao_avulsa text DEFAULT NULL;

ALTER TABLE public.orcamentos
  ALTER COLUMN incluir_fotos SET DEFAULT false,
  ALTER COLUMN incluir_termos SET DEFAULT false,
  ALTER COLUMN incluir_termo_responsabilidade SET DEFAULT false,
  ALTER COLUMN incluir_termo_garantia SET DEFAULT false;

-- 1.2 public.orcamento_nivel_itens: suporte a Serviço Único sem servico_id
ALTER TABLE public.orcamento_nivel_itens
  ALTER COLUMN servico_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS servico_nome text DEFAULT NULL;

DELETE FROM public.orcamento_nivel_itens
WHERE servico_id IS NULL
  AND combo_id IS NULL
  AND nullif(trim(servico_nome), '') IS NULL;

ALTER TABLE public.orcamento_nivel_itens
  DROP CONSTRAINT IF EXISTS chk_orcamento_nivel_itens_origem;

ALTER TABLE public.orcamento_nivel_itens
  ADD CONSTRAINT chk_orcamento_nivel_itens_origem
  CHECK (
    servico_id IS NOT NULL
    OR combo_id IS NOT NULL
    OR nullif(trim(servico_nome), '') IS NOT NULL
  );

-- 1.3 public.agendamento_itens: suporte a Serviço Único convertido em OS/agendamento
ALTER TABLE public.agendamento_itens
  ALTER COLUMN servico_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS servico_nome text DEFAULT NULL;

-- ------------------------------------------------------------------------------
-- 2. RPC CRIAR_ORCAMENTO (Suporta cliente cadastrado OU dados parciais/avulsos)
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.criar_orcamento(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.criar_orcamento(uuid, uuid, uuid, text, text, text, text, uuid);

CREATE OR REPLACE FUNCTION public.criar_orcamento(
  p_cliente uuid DEFAULT NULL,
  p_veiculo uuid DEFAULT NULL,
  p_categoria uuid DEFAULT NULL,
  p_titulo text DEFAULT NULL,
  p_cliente_nome_avulso text DEFAULT NULL,
  p_cliente_telefone_avulso text DEFAULT NULL,
  p_veiculo_descricao_avulsa text DEFAULT NULL,
  p_tenant uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_tenant_id uuid;
  v_categoria_id uuid := p_categoria;
  v_numero integer;
  v_orcamento_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF p_cliente IS NOT NULL THEN
    SELECT c.tenant_id INTO v_tenant_id
    FROM public.clientes c
    WHERE c.id = p_cliente;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cliente não encontrado.';
    END IF;

    IF p_tenant IS NOT NULL AND p_tenant <> v_tenant_id THEN
      RAISE EXCEPTION 'Cliente pertencente a outra oficina.';
    END IF;
  ELSE
    v_tenant_id := p_tenant;
    IF v_tenant_id IS NULL THEN
      SELECT tm.tenant_id INTO v_tenant_id
      FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid() AND tm.status <> 'inativo'
      ORDER BY tm.created_at ASC
      LIMIT 1;
    END IF;

    IF v_tenant_id IS NULL THEN
      RAISE EXCEPTION 'Oficina não identificada para criação do orçamento.';
    END IF;
  END IF;

  IF NOT public.tem_papel(v_tenant_id, array['dono', 'gerente']::app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado. Apenas dono ou gerente podem criar orçamentos.';
  END IF;

  -- Se veículo informado, valida pertencimento ao tenant e extrai categoria
  IF p_veiculo IS NOT NULL THEN
    SELECT v.categoria_id INTO v_categoria_id
    FROM public.veiculos v
    WHERE v.id = p_veiculo AND v.tenant_id = v_tenant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Veículo não encontrado nesta oficina.';
    END IF;

    IF p_categoria IS NOT NULL THEN
      v_categoria_id := p_categoria;
    END IF;
  END IF;

  -- Fallback: primeira categoria ativa do tenant
  IF v_categoria_id IS NULL THEN
    SELECT cv.id INTO v_categoria_id
    FROM public.categorias_veiculo cv
    WHERE cv.tenant_id = v_tenant_id AND COALESCE(cv.ativo, true) = true
    ORDER BY cv.ordem ASC, cv.created_at ASC
    LIMIT 1;
  END IF;

  IF v_categoria_id IS NULL THEN
    SELECT cv.id INTO v_categoria_id
    FROM public.categorias_veiculo cv
    WHERE cv.tenant_id = v_tenant_id
    LIMIT 1;
  END IF;

  IF v_categoria_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma categoria de veículo disponível.';
  END IF;

  v_numero := public.proximo_numero_orcamento(v_tenant_id);

  INSERT INTO public.orcamentos (
    tenant_id,
    numero,
    cliente_id,
    veiculo_id,
    categoria_id,
    titulo,
    cliente_nome_avulso,
    cliente_telefone_avulso,
    veiculo_descricao_avulsa,
    incluir_fotos,
    incluir_termos,
    incluir_termo_responsabilidade,
    incluir_termo_garantia,
    criado_por
  ) VALUES (
    v_tenant_id,
    v_numero,
    p_cliente,
    p_veiculo,
    v_categoria_id,
    nullif(trim(p_titulo), ''),
    CASE WHEN p_cliente IS NULL THEN nullif(trim(p_cliente_nome_avulso), '') ELSE NULL END,
    CASE WHEN p_cliente IS NULL THEN nullif(trim(p_cliente_telefone_avulso), '') ELSE NULL END,
    CASE WHEN p_veiculo IS NULL THEN nullif(trim(p_veiculo_descricao_avulsa), '') ELSE NULL END,
    false,
    false,
    false,
    false,
    auth.uid()
  ) RETURNING id INTO v_orcamento_id;

  -- Cria os três níveis vazios padrão (Essencial, Recomendado [Destaque], Completo)
  INSERT INTO public.orcamento_niveis (tenant_id, orcamento_id, nivel, titulo, descricao, destaque, ordem)
  VALUES
    (v_tenant_id, v_orcamento_id, 'essencial', 'Essencial', 'Serviço principal solicitado', false, 1),
    (v_tenant_id, v_orcamento_id, 'recomendado', 'Recomendado', 'Manutenção completa recomendada para seu veículo', true, 2),
    (v_tenant_id, v_orcamento_id, 'completo', 'Completo / Proteção Total', 'O melhor resultado com proteção duradoura', false, 3);

  RETURN v_orcamento_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_orcamento(uuid, uuid, uuid, text, text, text, text, uuid) TO authenticated;

-- ------------------------------------------------------------------------------
-- 3. RPC ATUALIZAR_CLIENTE_ORCAMENTO
-- Bloqueia apenas se o orçamento já foi convertido em agendamento/OS (agendamento_id IS NOT NULL)
-- ------------------------------------------------------------------------------
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

  IF v_orcamento.agendamento_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este orçamento já foi convertido em OS/agendamento e não permite troca de cliente por aqui.';
  END IF;

  -- Validação de cliente no mesmo tenant
  IF NOT EXISTS (
    SELECT 1 FROM public.clientes
    WHERE id = p_cliente_id AND tenant_id = v_orcamento.tenant_id
  ) THEN
    RAISE EXCEPTION 'Cliente inválido ou pertencente a outra oficina.';
  END IF;

  -- Se veículo informado, valida pertencimento ao tenant e obtém categoria se não especificada
  IF p_veiculo_id IS NOT NULL THEN
    SELECT categoria_id INTO v_cat_id
    FROM public.veiculos
    WHERE id = p_veiculo_id AND tenant_id = v_orcamento.tenant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Veículo inválido ou pertencente a outra oficina.';
    END IF;
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
      cliente_nome_avulso = NULL,
      cliente_telefone_avulso = NULL,
      veiculo_descricao_avulsa = CASE WHEN p_veiculo_id IS NOT NULL THEN NULL ELSE veiculo_descricao_avulsa END,
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

-- ------------------------------------------------------------------------------
-- 4. RPC SALVAR_NIVEL_ORCAMENTO (Suporte a Serviço Único sem servico_id)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.salvar_nivel_orcamento(
  p_nivel uuid,
  p_itens jsonb,
  p_titulo text DEFAULT NULL,
  p_descricao text DEFAULT NULL
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
  v_servico_nome text;
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

  -- Inserção dos itens com suporte a preço customizado, duração e Serviço Único avulso
  IF p_itens IS NOT NULL AND jsonb_array_length(p_itens) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens)
    LOOP
      v_servico_id := nullif(v_item->>'servico_id', '')::uuid;
      v_combo_id := nullif(v_item->>'combo_id', '')::uuid;
      v_servico_nome := nullif(trim(coalesce(v_item->>'servico_nome', v_item->>'nome')), '');

      v_preco_custom := CASE
        WHEN v_item ? 'preco' AND nullif(v_item->>'preco', '') IS NOT NULL
        THEN (v_item->>'preco')::numeric(10,2)
        ELSE NULL
      END;

      v_duracao_custom := CASE
        WHEN v_item ? 'duracao_minutos' AND nullif(v_item->>'duracao_minutos', '') IS NOT NULL
        THEN (v_item->>'duracao_minutos')::integer
        ELSE NULL
      END;

      v_preco := 0;
      v_duracao := 60;

      IF v_combo_id IS NOT NULL THEN
        IF v_preco_custom IS NOT NULL AND v_preco_custom >= 0 THEN
          v_preco := v_preco_custom;
        ELSE
          SELECT cp.preco_base
          INTO v_preco
          FROM public.combo_precos cp
          WHERE cp.combo_id = v_combo_id
            AND (cp.ativo IS TRUE OR cp.ativo IS NULL)
            AND cp.preco_base IS NOT NULL
          ORDER BY (CASE WHEN cp.categoria_id = v_orcamento_rec.categoria_id THEN 0 ELSE 1 END)
          LIMIT 1;
        END IF;

        IF v_duracao_custom IS NOT NULL AND v_duracao_custom > 0 THEN
          v_duracao := v_duracao_custom;
        ELSE
          SELECT coalesce(cp.duracao_minutos, 60)
          INTO v_duracao
          FROM public.combo_precos cp
          WHERE cp.combo_id = v_combo_id
            AND (cp.ativo IS TRUE OR cp.ativo IS NULL)
          ORDER BY (CASE WHEN cp.categoria_id = v_orcamento_rec.categoria_id THEN 0 ELSE 1 END)
          LIMIT 1;
        END IF;

        v_preco := greatest(0, coalesce(v_preco, 0));
        v_duracao := coalesce(v_duracao, 60);

        INSERT INTO public.orcamento_nivel_itens (
          tenant_id, nivel_id, servico_id, combo_id, servico_nome, preco, duracao_minutos, ordem
        ) VALUES (
          v_orcamento_rec.tenant_id, p_nivel, null, v_combo_id, null, v_preco, v_duracao, v_ordem
        );

        v_total_valor := v_total_valor + v_preco;
        v_total_duracao := v_total_duracao + v_duracao;
        v_ordem := v_ordem + 1;

      ELSIF v_servico_id IS NOT NULL THEN
        IF v_preco_custom IS NOT NULL AND v_preco_custom >= 0 THEN
          v_preco := v_preco_custom;
        ELSE
          SELECT sp.preco_base
          INTO v_preco
          FROM public.servico_precos sp
          WHERE sp.servico_id = v_servico_id
            AND (sp.ativo IS TRUE OR sp.ativo IS NULL)
            AND sp.preco_base IS NOT NULL
            AND sp.preco_base > 0
          ORDER BY (CASE WHEN sp.categoria_id = v_orcamento_rec.categoria_id THEN 0 ELSE 1 END)
          LIMIT 1;

          IF v_preco IS NULL OR v_preco = 0 THEN
            SELECT sp.preco_base
            INTO v_preco
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
        ELSE
          SELECT coalesce(sp.duracao_minutos, 60)
          INTO v_duracao
          FROM public.servico_precos sp
          WHERE sp.servico_id = v_servico_id
            AND (sp.ativo IS TRUE OR sp.ativo IS NULL)
            AND sp.duracao_minutos IS NOT NULL
            AND sp.duracao_minutos > 0
          ORDER BY (CASE WHEN sp.categoria_id = v_orcamento_rec.categoria_id THEN 0 ELSE 1 END)
          LIMIT 1;

          IF v_duracao IS NULL OR v_duracao <= 0 THEN
            SELECT coalesce(sp.duracao_minutos, 60)
            INTO v_duracao
            FROM public.servico_precos sp
            WHERE sp.servico_id = v_servico_id
              AND (sp.ativo IS TRUE OR sp.ativo IS NULL)
              AND sp.duracao_minutos IS NOT NULL
              AND sp.duracao_minutos > 0
            LIMIT 1;
          END IF;
        END IF;

        v_preco := greatest(0, coalesce(v_preco, 0));
        v_duracao := coalesce(v_duracao, 60);

        INSERT INTO public.orcamento_nivel_itens (
          tenant_id, nivel_id, servico_id, combo_id, servico_nome, preco, duracao_minutos, ordem
        ) VALUES (
          v_orcamento_rec.tenant_id, p_nivel, v_servico_id, null, null, v_preco, v_duracao, v_ordem
        );

        v_total_valor := v_total_valor + v_preco;
        v_total_duracao := v_total_duracao + v_duracao;
        v_ordem := v_ordem + 1;

      ELSIF v_servico_nome IS NOT NULL THEN
        -- Serviço Único (avulso, não salvo no catálogo)
        v_preco := greatest(0, coalesce(v_preco_custom, 0));
        v_duracao := CASE WHEN v_duracao_custom IS NOT NULL AND v_duracao_custom > 0 THEN v_duracao_custom ELSE 60 END;

        INSERT INTO public.orcamento_nivel_itens (
          tenant_id, nivel_id, servico_id, combo_id, servico_nome, preco, duracao_minutos, ordem
        ) VALUES (
          v_orcamento_rec.tenant_id, p_nivel, null, null, v_servico_nome, v_preco, v_duracao, v_ordem
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

-- ------------------------------------------------------------------------------
-- 5. RPC ORCAMENTO_PUBLICO (Cliente flexível, incluir_fotos, defaults false, Serviço Único)
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.orcamento_publico(uuid);
DROP FUNCTION IF EXISTS public.orcamento_publico(text);

CREATE OR REPLACE FUNCTION public.orcamento_publico(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_orcamento record;
  v_tenant record;
  v_niveis_json jsonb := '[]'::jsonb;
  v_veiculo_json jsonb := null;
  v_agendamento_json jsonb := null;
  v_tem_cliente_cadastrado boolean := false;
  v_tem_veiculo boolean := false;
  v_tem_agendamento boolean := false;
  v_primeiro_nome text := null;
  v_cliente_tel text := null;
  v_status_atual text;
  v_modo_orc text;
  v_alteracao_pendente boolean := false;
  v_alteracao_historico_json jsonb := '[]'::jsonb;
  v_desconto_json jsonb := null;
  v_usuario_desconto_nome text := null;
  v_itens_aprovados_json jsonb := '[]'::jsonb;
  v_termo_garantia_json jsonb := null;
  v_termo_resp_final text := '';
  v_incluir_fotos boolean := false;
  v_incluir_termos boolean := false;
  v_incluir_termo_resp boolean := false;
  v_incluir_termo_gar boolean := false;
  v_incluir_termo_risco boolean := false;
BEGIN
  -- 1. Busca orçamento estritamente pelo token público unguessable
  SELECT o.* INTO v_orcamento
  FROM public.orcamentos o
  WHERE o.token_publico = p_token
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.';
  END IF;

  -- 2. Busca dados da oficina
  SELECT t.* INTO v_tenant
  FROM public.tenants t
  WHERE t.id = v_orcamento.tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oficina não encontrada.';
  END IF;

  -- 3. Verifica expiração automática por validade
  v_status_atual := v_orcamento.status;
  IF v_status_atual IN ('enviado', 'visualizado') AND v_orcamento.enviado_em IS NOT NULL THEN
    IF (v_orcamento.enviado_em::date + coalesce(v_orcamento.validade_dias, 7)) < current_date THEN
      v_status_atual := 'expirado';
      UPDATE public.orcamentos SET status = 'expirado', updated_at = now() WHERE id = v_orcamento.id;
    END IF;
  END IF;

  -- 4. Marca como 'visualizado' no primeiro acesso
  IF v_orcamento.status = 'enviado' AND v_status_atual = 'enviado' THEN
    UPDATE public.orcamentos
    SET status = 'visualizado',
        visualizado_em = now(),
        updated_at = now()
    WHERE id = v_orcamento.id;
    v_status_atual := 'visualizado';
  END IF;

  v_modo_orc := coalesce(v_orcamento.modo_orcamento, '3_niveis');

  -- Flags explícitas de exibição (desmarcadas por padrão)
  v_incluir_fotos := coalesce(v_orcamento.incluir_fotos, false);
  v_incluir_termos := coalesce(v_orcamento.incluir_termos, false);
  v_incluir_termo_resp := coalesce(v_orcamento.incluir_termo_responsabilidade, v_incluir_termos, false);
  v_incluir_termo_gar := coalesce(v_orcamento.incluir_termo_garantia, v_incluir_termos, false);
  v_incluir_termo_risco := coalesce(v_orcamento.incluir_termo_risco, false) AND v_incluir_termo_resp;

  -- 5. Cliente (cadastrado ou dados parciais/avulsos)
  v_tem_cliente_cadastrado := (v_orcamento.cliente_id IS NOT NULL);
  IF v_orcamento.cliente_id IS NOT NULL THEN
    SELECT
      split_part(c.nome, ' ', 1),
      c.telefone
    INTO v_primeiro_nome, v_cliente_tel
    FROM public.clientes c
    WHERE c.id = v_orcamento.cliente_id;
  END IF;

  IF (v_primeiro_nome IS NULL OR trim(v_primeiro_nome) = '') AND nullif(trim(v_orcamento.cliente_nome_avulso), '') IS NOT NULL THEN
    v_primeiro_nome := split_part(trim(v_orcamento.cliente_nome_avulso), ' ', 1);
  END IF;

  IF (v_cliente_tel IS NULL OR trim(v_cliente_tel) = '') AND nullif(trim(v_orcamento.cliente_telefone_avulso), '') IS NOT NULL THEN
    v_cliente_tel := trim(v_orcamento.cliente_telefone_avulso);
  END IF;

  -- 6. Veículo
  IF v_orcamento.veiculo_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', v.id,
      'modelo', v.modelo,
      'marca', v.marca,
      'placa', v.placa,
      'ano', v.ano,
      'cor', v.cor
    ) INTO v_veiculo_json
    FROM public.veiculos v
    WHERE v.id = v_orcamento.veiculo_id;
    IF FOUND THEN
      v_tem_veiculo := true;
    END IF;
  END IF;

  -- 7. Agendamento vinculado
  IF v_orcamento.agendamento_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', a.id,
      'inicio', a.inicio,
      'status', a.status,
      'numero_os', a.numero_os,
      'duracao_total', coalesce(a.duracao_total, a.duracao_minutos, 60),
      'preco_estimado_total', coalesce(a.preco_estimado_total, a.preco_estimado, 0),
      'previsao_entrega', a.previsao_entrega,
      'sinal', CASE
        WHEN coalesce(a.sinal_valor, 0) > 0 THEN jsonb_build_object(
          'ativo', true,
          'valor', a.sinal_valor,
          'status', coalesce(a.sinal_status, 'pendente'),
          'pix_chave', v_tenant.pix_chave,
          'pix_payload', CASE
            WHEN a.sinal_status = 'pendente' AND v_tenant.pix_chave IS NOT NULL AND trim(v_tenant.pix_chave) <> '' THEN
              public.gerar_payload_pix(
                v_tenant.pix_chave,
                coalesce(v_tenant.pix_nome_beneficiario, v_tenant.nome),
                coalesce(v_tenant.pix_cidade, 'SAO PAULO'),
                a.sinal_valor,
                'OS' || lpad(a.numero_os::text, 4, '0')
              )
            ELSE null
          END
        )
        ELSE jsonb_build_object('ativo', false, 'valor', 0)
      END
    ) INTO v_agendamento_json
    FROM public.agendamentos a
    WHERE a.id = v_orcamento.agendamento_id;

    IF FOUND THEN
      v_tem_agendamento := true;
    END IF;
  END IF;

  -- 8. Desconto concedido
  IF coalesce(v_orcamento.desconto_valor, 0) > 0 AND v_orcamento.desconto_tipo IS NOT NULL THEN
    IF v_orcamento.desconto_aplicado_por IS NOT NULL THEN
      SELECT u.nome INTO v_usuario_desconto_nome
      FROM public.usuarios u
      WHERE u.id = v_orcamento.desconto_aplicado_por;
    END IF;

    v_desconto_json := jsonb_build_object(
      'tipo', v_orcamento.desconto_tipo,
      'valor', v_orcamento.desconto_valor,
      'motivo', v_orcamento.desconto_motivo,
      'cupom_codigo', v_orcamento.desconto_cupom_codigo,
      'aplicado_em', v_orcamento.desconto_aplicado_em,
      'aplicado_por_nome', coalesce(split_part(v_usuario_desconto_nome, ' ', 1), 'Gestor')
    );
  END IF;

  -- 9. Níveis e Itens da Proposta (inclui Serviços Únicos via i.servico_nome)
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', n.id,
        'nivel', n.nivel,
        'titulo', CASE
          WHEN v_modo_orc = 'simples' AND (n.titulo ILIKE 'essencial' OR n.titulo IS NULL OR trim(n.titulo) = '')
          THEN 'Proposta de Serviços'
          ELSE n.titulo
        END,
        'descricao', n.descricao,
        'valor_original', n.valor_total,
        'valor_total', CASE
          WHEN coalesce(v_orcamento.desconto_valor, 0) > 0 AND v_orcamento.desconto_tipo = 'porcentagem'
            THEN round(n.valor_total * (1.0 - (v_orcamento.desconto_valor / 100.0)), 2)
          WHEN coalesce(v_orcamento.desconto_valor, 0) > 0 AND v_orcamento.desconto_tipo = 'valor_fixo'
            THEN greatest(0.00, n.valor_total - v_orcamento.desconto_valor)
          ELSE n.valor_total
        END,
        'duracao_total', n.duracao_total,
        'destaque', CASE WHEN v_modo_orc = 'simples' THEN false ELSE n.destaque END,
        'ordem', n.ordem,
        'itens', coalesce(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', i.id,
                'servico_id', i.servico_id,
                'combo_id', i.combo_id,
                'servico_nome', coalesce(s.nome, c.nome, i.servico_nome, 'Serviço'),
                'servico_descricao', coalesce(s.descricao_publica, c.descricao_publica, s.descricao_interna, ''),
                'preco', i.preco,
                'duracao_minutos', i.duracao_minutos,
                'ordem', i.ordem
              ) ORDER BY i.ordem ASC
            )
            FROM public.orcamento_nivel_itens i
            LEFT JOIN public.servicos s ON s.id = i.servico_id
            LEFT JOIN public.combos c ON c.id = i.combo_id
            WHERE i.nivel_id = n.id
          ),
          '[]'::jsonb
        )
      ) ORDER BY n.ordem ASC
    ),
    '[]'::jsonb
  ) INTO v_niveis_json
  FROM public.orcamento_niveis n
  WHERE n.orcamento_id = v_orcamento.id
    AND (v_modo_orc <> 'simples' OR n.nivel = 'essencial');

  -- Fallback para modo simples caso o nível não se chame 'essencial'
  IF v_modo_orc = 'simples' AND (v_niveis_json IS NULL OR jsonb_array_length(v_niveis_json) = 0) THEN
    SELECT coalesce(
      jsonb_agg(sub.nivel_obj),
      '[]'::jsonb
    ) INTO v_niveis_json
    FROM (
      SELECT jsonb_build_object(
        'id', n.id,
        'nivel', n.nivel,
        'titulo', coalesce(nullif(trim(n.titulo), ''), 'Proposta de Serviços'),
        'descricao', n.descricao,
        'valor_original', n.valor_total,
        'valor_total', CASE
          WHEN coalesce(v_orcamento.desconto_valor, 0) > 0 AND v_orcamento.desconto_tipo = 'porcentagem'
            THEN round(n.valor_total * (1.0 - (v_orcamento.desconto_valor / 100.0)), 2)
          WHEN coalesce(v_orcamento.desconto_valor, 0) > 0 AND v_orcamento.desconto_tipo = 'valor_fixo'
            THEN greatest(0.00, n.valor_total - v_orcamento.desconto_valor)
          ELSE n.valor_total
        END,
        'duracao_total', n.duracao_total,
        'destaque', false,
        'ordem', n.ordem,
        'itens', coalesce(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', i.id,
                'servico_id', i.servico_id,
                'combo_id', i.combo_id,
                'servico_nome', coalesce(s.nome, c.nome, i.servico_nome, 'Serviço'),
                'servico_descricao', coalesce(s.descricao_publica, c.descricao_publica, s.descricao_interna, ''),
                'preco', i.preco,
                'duracao_minutos', i.duracao_minutos,
                'ordem', i.ordem
              ) ORDER BY i.ordem ASC
            )
            FROM public.orcamento_nivel_itens i
            LEFT JOIN public.servicos s ON s.id = i.servico_id
            LEFT JOIN public.combos c ON c.id = i.combo_id
            WHERE i.nivel_id = n.id
          ),
          '[]'::jsonb
        )
      ) AS nivel_obj
      FROM public.orcamento_niveis n
      WHERE n.orcamento_id = v_orcamento.id
      ORDER BY n.ordem ASC
      LIMIT 1
    ) sub;
  END IF;

  -- 10. Itens aprovados
  IF v_orcamento.status = 'aprovado' AND v_orcamento.nivel_aprovado IS NOT NULL THEN
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'servico_id', i.servico_id,
          'combo_id', i.combo_id,
          'servico_nome', coalesce(s.nome, c.nome, i.servico_nome, 'Serviço'),
          'preco', i.preco,
          'duracao_minutos', i.duracao_minutos
        ) ORDER BY i.ordem ASC
      ),
      '[]'::jsonb
    ) INTO v_itens_aprovados_json
    FROM public.orcamento_nivel_itens i
    JOIN public.orcamento_niveis n ON n.id = i.nivel_id
    LEFT JOIN public.servicos s ON s.id = i.servico_id
    LEFT JOIN public.combos c ON c.id = i.combo_id
    WHERE n.orcamento_id = v_orcamento.id
      AND n.nivel = v_orcamento.nivel_aprovado;
  ELSIF v_modo_orc = 'simples' AND v_status_atual IN ('aprovado', 'em_andamento', 'concluido') THEN
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'servico_id', i.servico_id,
          'combo_id', i.combo_id,
          'servico_nome', coalesce(s.nome, c.nome, i.servico_nome, 'Serviço'),
          'preco', i.preco,
          'duracao_minutos', i.duracao_minutos
        ) ORDER BY i.ordem ASC
      ),
      '[]'::jsonb
    ) INTO v_itens_aprovados_json
    FROM public.orcamento_nivel_itens i
    JOIN public.orcamento_niveis n ON n.id = i.nivel_id
    LEFT JOIN public.servicos s ON s.id = i.servico_id
    LEFT JOIN public.combos c ON c.id = i.combo_id
    WHERE n.orcamento_id = v_orcamento.id
      AND n.nivel = coalesce(v_orcamento.nivel_aprovado, 'essencial');
  END IF;

  -- 11. Termo de Garantia (somente se incluir_termo_garantia ativo)
  IF v_incluir_termo_gar THEN
    IF v_orcamento.termo_garantia_id IS NOT NULL THEN
      SELECT jsonb_build_object('id', tg.id, 'tipo', tg.tipo, 'titulo', tg.titulo, 'conteudo', tg.conteudo)
      INTO v_termo_garantia_json
      FROM public.termos_garantia tg
      WHERE tg.id = v_orcamento.termo_garantia_id;
    END IF;

    IF v_termo_garantia_json IS NULL THEN
      SELECT jsonb_build_object('id', tg.id, 'tipo', tg.tipo, 'titulo', tg.titulo, 'conteudo', tg.conteudo)
      INTO v_termo_garantia_json
      FROM public.termos_garantia tg
      WHERE tg.tenant_id = v_orcamento.tenant_id AND tg.padrao = true AND tg.ativo = true
      ORDER BY tg.created_at ASC
      LIMIT 1;
    END IF;
  END IF;

  -- 12. Termo de Responsabilidade (somente se incluir_termo_responsabilidade ativo)
  IF v_incluir_termo_resp THEN
    v_termo_resp_final := v_orcamento.termo_responsabilidade_texto;
    IF (v_termo_resp_final IS NULL OR trim(v_termo_resp_final) = '') AND v_orcamento.termo_responsabilidade_id IS NOT NULL THEN
      SELECT tg.conteudo INTO v_termo_resp_final
      FROM public.termos_garantia tg
      WHERE tg.id = v_orcamento.termo_responsabilidade_id;
    END IF;
    IF v_termo_resp_final IS NULL OR trim(v_termo_resp_final) = '' THEN
      v_termo_resp_final := coalesce(v_tenant.termo_responsabilidade, '');
    END IF;
  ELSE
    v_termo_resp_final := '';
  END IF;

  -- 13. Retorno do Objeto JSON completo
  RETURN jsonb_build_object(
    'numero', v_orcamento.numero,
    'numero_os', v_orcamento.numero_os,
    'titulo', v_orcamento.titulo,
    'observacoes', v_orcamento.observacoes,
    'status', v_status_atual,
    'modo_orcamento', v_modo_orc,
    'nivel_aprovado', v_orcamento.nivel_aprovado,
    'categoria_id', v_orcamento.categoria_id,
    'itens_aprovados', v_itens_aprovados_json,
    'validade_dias', coalesce(v_orcamento.validade_dias, 7),
    'enviado_em', v_orcamento.enviado_em,
    'data_validade_limite', CASE
      WHEN v_orcamento.enviado_em IS NOT NULL THEN (v_orcamento.enviado_em::date + coalesce(v_orcamento.validade_dias, 7))
      ELSE NULL
    END,
    'assinatura_data', v_orcamento.assinatura_data,
    'assinatura_nome', v_orcamento.assinatura_nome,
    'assinatura_url', v_orcamento.assinatura_path,
    'tem_cliente_cadastrado', v_tem_cliente_cadastrado,
    'cliente_primeiro_nome', v_primeiro_nome,
    'cliente_telefone', v_cliente_tel,
    'cliente_nome_avulso', v_orcamento.cliente_nome_avulso,
    'cliente_telefone_avulso', v_orcamento.cliente_telefone_avulso,
    'veiculo_descricao_avulsa', v_orcamento.veiculo_descricao_avulsa,
    'desconto', v_desconto_json,
    'incluir_fotos', v_incluir_fotos,
    'incluir_termos', v_incluir_termos,
    'incluir_termo_responsabilidade', v_incluir_termo_resp,
    'incluir_termo_garantia', v_incluir_termo_gar,
    'garantia_meses', coalesce(v_orcamento.garantia_meses, 3),
    'incluir_termo_risco', v_incluir_termo_risco,
    'termo_risco_servico', v_orcamento.termo_risco_servico,
    'termo_risco_observacoes', v_orcamento.termo_risco_observacoes,
    'termo_risco_texto', v_orcamento.termo_risco_texto,
    'termo_responsabilidade', v_termo_resp_final,
    'termo_garantia', v_termo_garantia_json,
    'oficina', jsonb_build_object(
      'tenant_id', v_tenant.id,
      'nome', v_tenant.nome,
      'razao_social', v_tenant.razao_social,
      'documento', v_tenant.documento,
      'documento_tipo', v_tenant.documento_tipo,
      'telefone', v_tenant.telefone,
      'email', coalesce(v_tenant.email, (SELECT tm.email FROM public.tenant_members tm WHERE tm.tenant_id = v_tenant.id ORDER BY tm.created_at ASC LIMIT 1), ''),
      'cidade', v_tenant.cidade,
      'uf', v_tenant.uf,
      'logo_path', v_tenant.logo_path,
      'logo_url', coalesce(v_tenant.logo_url, v_tenant.logo_path),
      'orcamento_agendamento_cliente', coalesce(v_tenant.orcamento_agendamento_cliente, true),
      'plano', v_tenant.plano,
      'pdf_cor_primaria', v_tenant.pdf_cor_primaria,
      'pdf_cor_fundo_cabecalho', v_tenant.pdf_cor_fundo_cabecalho,
      'pdf_cor_texto_cabecalho', v_tenant.pdf_cor_texto_cabecalho,
      'pdf_cor_fundo_secoes', v_tenant.pdf_cor_fundo_secoes,
      'pdf_cor_texto_secoes', v_tenant.pdf_cor_texto_secoes,
      'pdf_subtitulo_cabecalho', v_tenant.pdf_subtitulo_cabecalho,
      'pdf_texto_observacoes_orcamento', v_tenant.pdf_texto_observacoes_orcamento,
      'pdf_texto_rodape', v_tenant.pdf_texto_rodape
    ),
    'veiculo', v_veiculo_json,
    'agendamento', v_agendamento_json,
    'niveis', v_niveis_json,
    'alteracao_pendente', v_alteracao_pendente,
    'alteracao_historico', v_alteracao_historico_json
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.orcamento_publico(uuid) TO anon, authenticated;

-- ------------------------------------------------------------------------------
-- 6. RPC RESPONDER_ORCAMENTO (Permite aprovar orçamento com dados avulsos/parciais)
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.responder_orcamento(uuid, text, boolean, text, text);
DROP FUNCTION IF EXISTS public.responder_orcamento(uuid, text, boolean);

CREATE OR REPLACE FUNCTION public.responder_orcamento(
  p_token uuid,
  p_nivel text,
  p_aceite boolean,
  p_assinatura_base64 text DEFAULT NULL,
  p_nome_assinante text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_orcamento record;
  v_os_num integer;
  v_nome_limpo text;
  v_cliente_nome text;
  v_nivel_valor numeric(10,2) := 0;
BEGIN
  SELECT o.* INTO v_orcamento
  FROM public.orcamentos o
  WHERE o.token_publico = p_token
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.';
  END IF;

  IF v_orcamento.status IN ('enviado', 'visualizado') AND v_orcamento.enviado_em IS NOT NULL THEN
    IF (v_orcamento.enviado_em::date + coalesce(v_orcamento.validade_dias, 7)) < current_date THEN
      UPDATE public.orcamentos SET status = 'expirado', updated_at = now() WHERE id = v_orcamento.id;
      RAISE EXCEPTION 'Este orçamento está expirado e não aceita mais respostas.';
    END IF;
  END IF;

  IF v_orcamento.status = 'expirado' THEN
    RAISE EXCEPTION 'Este orçamento está expirado e não aceita mais respostas.';
  END IF;

  IF p_aceite THEN
    IF p_nivel IS NULL OR p_nivel NOT IN ('essencial', 'recomendado', 'completo') THEN
      RAISE EXCEPTION 'Nível de orçamento inválido.';
    END IF;

    SELECT coalesce(valor_total, 0) INTO v_nivel_valor
    FROM public.orcamento_niveis
    WHERE orcamento_id = v_orcamento.id AND nivel = p_nivel;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'O nível escolhido não existe neste orçamento.';
    END IF;

    v_os_num := v_orcamento.numero_os;
    IF v_os_num IS NULL THEN
      v_os_num := public.proximo_numero_os(v_orcamento.tenant_id);
    END IF;

    v_nome_limpo := nullif(trim(coalesce(p_nome_assinante, '')), '');

    UPDATE public.orcamentos
    SET status = 'aprovado',
        nivel_aprovado = p_nivel,
        numero_os = v_os_num,
        respondido_em = now(),
        assinatura_path = coalesce(p_assinatura_base64, assinatura_path),
        assinatura_nome = coalesce(v_nome_limpo, assinatura_nome),
        assinatura_data = CASE WHEN p_assinatura_base64 IS NOT NULL THEN now() ELSE assinatura_data END,
        updated_at = now()
    WHERE id = v_orcamento.id;

    -- Obter nome do cliente (cadastrado ou avulso) para notificação interna
    IF v_orcamento.cliente_id IS NOT NULL THEN
      SELECT c.nome INTO v_cliente_nome
      FROM public.clientes c
      WHERE c.id = v_orcamento.cliente_id;
    END IF;

    IF v_cliente_nome IS NULL OR trim(v_cliente_nome) = '' THEN
      v_cliente_nome := COALESCE(nullif(trim(v_orcamento.cliente_nome_avulso), ''), 'Cliente');
    END IF;

    -- Disparar Notificação Pontual para a Oficina (papel mínimo: gerente)
    PERFORM public.criar_notificacao_interna(
      v_orcamento.tenant_id,
      NULL,
      'oficina',
      'gerente',
      'orcamento_aprovado',
      '🎉 Orçamento Aprovado!',
      COALESCE(v_nome_limpo, v_cliente_nome, 'Cliente') || ' aprovou a proposta #' || LPAD(v_os_num::text, 4, '0') || ' (' || upper(p_nivel) || ') no valor de R$ ' || to_char(COALESCE(v_nivel_valor, 0), 'FM999G999G990D00') || '.',
      '/orcamentos',
      jsonb_build_object('orcamento_id', v_orcamento.id, 'numero_os', v_os_num, 'nivel', p_nivel)
    );
  ELSE
    UPDATE public.orcamentos
    SET status = 'recusado',
        nivel_aprovado = null,
        respondido_em = now(),
        updated_at = now()
    WHERE id = v_orcamento.id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.responder_orcamento(uuid, text, boolean, text, text) TO anon, authenticated;

-- ------------------------------------------------------------------------------
-- 7. RPC CONVERTER_ORCAMENTO_EM_AGENDAMENTO
-- Exige cliente_id vinculado antes da criação da OS; copia Serviço Único e termos ativos
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.converter_orcamento_em_agendamento(
  p_orcamento uuid,
  p_inicio timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_orcamento record;
  v_nivel_rec record;
  v_tenant record;
  v_agendamento_id uuid;
  v_servico_principal uuid;
  v_modo_ocupacao text := 'slot';
  v_dias_ocupados integer := 1;
  v_valor_final numeric(10,2) := 0.00;
  v_os_num integer;
  v_termo_resp_texto text := '';
  v_termo_gar_texto text := '';
  v_incluir_termo_resp boolean := false;
  v_incluir_termo_gar boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  SELECT o.* INTO v_orcamento
  FROM public.orcamentos o
  WHERE o.id = p_orcamento;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.';
  END IF;

  IF NOT public.tem_papel(v_orcamento.tenant_id, ARRAY['dono', 'gerente']::app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  IF v_orcamento.status NOT IN ('aprovado', 'finalizado') THEN
    RAISE EXCEPTION 'Apenas orçamentos aprovados podem ser convertidos em agendamento.';
  END IF;

  IF v_orcamento.agendamento_id IS NOT NULL THEN
    RETURN v_orcamento.agendamento_id;
  END IF;

  IF v_orcamento.cliente_id IS NULL THEN
    RAISE EXCEPTION 'Vincule ou cadastre os dados do cliente antes de converter este orçamento em OS/agendamento.';
  END IF;

  IF v_orcamento.nivel_aprovado IS NULL THEN
    RAISE EXCEPTION 'Nenhum nível aprovado foi registrado para este orçamento.';
  END IF;

  SELECT n.* INTO v_nivel_rec
  FROM public.orcamento_niveis n
  WHERE n.orcamento_id = p_orcamento AND n.nivel = v_orcamento.nivel_aprovado;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nível aprovado não encontrado.';
  END IF;

  SELECT i.servico_id INTO v_servico_principal
  FROM public.orcamento_nivel_itens i
  WHERE i.nivel_id = v_nivel_rec.id
  ORDER BY (CASE WHEN i.servico_id IS NOT NULL THEN 0 ELSE 1 END), i.ordem ASC
  LIMIT 1;

  IF v_servico_principal IS NOT NULL THEN
    SELECT coalesce(s.modo_ocupacao, 'slot'), coalesce(s.dias_ocupados, 1)
    INTO v_modo_ocupacao, v_dias_ocupados
    FROM public.servicos s WHERE s.id = v_servico_principal;
  END IF;

  v_valor_final := coalesce(v_nivel_rec.valor_total, 0);
  IF v_orcamento.desconto_valor > 0 AND v_orcamento.desconto_tipo IS NOT NULL THEN
    IF v_orcamento.desconto_tipo = 'porcentagem' THEN
      v_valor_final := round(v_valor_final * (1.0 - (v_orcamento.desconto_valor / 100.0)), 2);
    ELSIF v_orcamento.desconto_tipo = 'valor_fixo' THEN
      v_valor_final := greatest(0.00, v_valor_final - v_orcamento.desconto_valor);
    END IF;
  END IF;

  v_os_num := v_orcamento.numero_os;
  IF v_os_num IS NULL THEN
    v_os_num := public.proximo_numero_os(v_orcamento.tenant_id);
  END IF;

  SELECT t.* INTO v_tenant FROM public.tenants t WHERE t.id = v_orcamento.tenant_id;

  v_incluir_termo_resp := coalesce(v_orcamento.incluir_termo_responsabilidade, v_orcamento.incluir_termos, false);
  v_incluir_termo_gar := coalesce(v_orcamento.incluir_termo_garantia, v_orcamento.incluir_termos, false);

  IF v_incluir_termo_resp THEN
    v_termo_resp_texto := v_orcamento.termo_responsabilidade_texto;
    IF (v_termo_resp_texto IS NULL OR trim(v_termo_resp_texto) = '') AND v_orcamento.termo_responsabilidade_id IS NOT NULL THEN
      SELECT tg.conteudo INTO v_termo_resp_texto
      FROM public.termos_garantia tg
      WHERE tg.id = v_orcamento.termo_responsabilidade_id;
    END IF;
    IF v_termo_resp_texto IS NULL OR trim(v_termo_resp_texto) = '' THEN
      v_termo_resp_texto := coalesce(v_tenant.termo_responsabilidade, '');
    END IF;
  END IF;

  IF v_incluir_termo_gar AND v_orcamento.termo_garantia_id IS NOT NULL THEN
    SELECT tg.conteudo INTO v_termo_gar_texto
    FROM public.termos_garantia tg
    WHERE tg.id = v_orcamento.termo_garantia_id;
  END IF;

  INSERT INTO public.agendamentos (
    tenant_id,
    cliente_id,
    veiculo_id,
    servico_id,
    categoria_id,
    inicio,
    duracao_minutos,
    duracao_total,
    modo_ocupacao,
    modo_ocupacao_efetivo,
    dias_ocupados,
    preco_estimado,
    preco_estimado_total,
    status,
    origem,
    observacoes,
    criado_por,
    numero_os,
    termo_garantia_id,
    termo_responsabilidade_texto,
    termo_garantia_texto
  ) VALUES (
    v_orcamento.tenant_id,
    v_orcamento.cliente_id,
    v_orcamento.veiculo_id,
    v_servico_principal,
    v_orcamento.categoria_id,
    p_inicio,
    coalesce(v_nivel_rec.duracao_total, 60),
    coalesce(v_nivel_rec.duracao_total, 60),
    coalesce(v_modo_ocupacao, 'slot'),
    coalesce(v_modo_ocupacao, 'slot'),
    coalesce(v_dias_ocupados, 1),
    v_valor_final,
    v_valor_final,
    'agendado',
    'orcamento',
    coalesce(v_orcamento.observacoes, '') || ' (Convertido do Orçamento ORC' || lpad(v_orcamento.numero::text, 4, '0') || ' - OS ' || lpad(v_os_num::text, 4, '0') || ' - ' || v_nivel_rec.titulo || ')',
    auth.uid(),
    v_os_num,
    CASE WHEN v_incluir_termo_gar THEN v_orcamento.termo_garantia_id ELSE NULL END,
    nullif(v_termo_resp_texto, ''),
    nullif(v_termo_gar_texto, '')
  ) RETURNING id INTO v_agendamento_id;

  INSERT INTO public.agendamento_itens (
    tenant_id,
    agendamento_id,
    servico_id,
    combo_id,
    servico_nome,
    duracao_minutos,
    preco_estimado,
    modo_ocupacao,
    dias_ocupados,
    ordem
  )
  SELECT
    v_orcamento.tenant_id,
    v_agendamento_id,
    i.servico_id,
    i.combo_id,
    coalesce(s.nome, i.servico_nome),
    coalesce(i.duracao_minutos, 60),
    coalesce(i.preco, 0),
    coalesce(s.modo_ocupacao, 'slot'),
    coalesce(s.dias_ocupados, 1),
    coalesce(i.ordem, 0)
  FROM public.orcamento_nivel_itens i
  LEFT JOIN public.servicos s ON s.id = i.servico_id
  WHERE i.nivel_id = v_nivel_rec.id;

  PERFORM public.recalcular_agendamento_totais(v_agendamento_id);

  UPDATE public.orcamentos
  SET agendamento_id = v_agendamento_id,
      numero_os = v_os_num,
      updated_at = now()
  WHERE id = p_orcamento;

  RETURN v_agendamento_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.converter_orcamento_em_agendamento(uuid, timestamptz) TO authenticated;

-- ------------------------------------------------------------------------------
-- 8. RPC AGENDAR_ORCAMENTO_PUBLICO (Opção B: cadastro automático no agendamento online)
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.agendar_orcamento_publico(uuid, timestamptz, boolean, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.agendar_orcamento_publico(uuid, timestamptz, boolean, text, text);
DROP FUNCTION IF EXISTS public.agendar_orcamento_publico(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.agendar_orcamento_publico(text, timestamptz, boolean, text, text);
DROP FUNCTION IF EXISTS public.agendar_orcamento_publico(text, timestamptz);

CREATE OR REPLACE FUNCTION public.agendar_orcamento_publico(
  p_token uuid,
  p_inicio timestamptz,
  p_transbordo_aceito boolean DEFAULT false,
  p_user_agent text DEFAULT null,
  p_ip text DEFAULT null,
  p_cliente_nome text DEFAULT null,
  p_cliente_telefone text DEFAULT null,
  p_veiculo_modelo text DEFAULT null,
  p_veiculo_placa text DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_orcamento record;
  v_tenant record;
  v_nivel_rec record;
  v_antecedencia_minima integer;
  v_agendamento_cliente_habil boolean;
  v_min_inicio timestamptz;
  v_data date;
  v_hora time;
  v_is_disponivel boolean := false;
  v_termino_previsto timestamptz;
  v_agendamento_id uuid;
  v_itens_json jsonb := '[]'::jsonb;
  v_item record;
  v_servico_id_primeiro uuid;
  v_modo_item text;
  v_dias_item smallint;
  v_ordem smallint := 0;
  v_os_num integer;
  v_modo_efetivo text := 'slot';
  v_duracao_total_calculada integer := 0;
  v_total_calculado numeric(10,2) := 0;
  v_is_transbordo boolean := false;
  v_inicio_sp date;
  v_termino_sp date;
  v_obs_final text;
  v_sinal_valor_calc numeric(10,2) := 0;
  v_sinal_status_final text := 'nao_aplicavel';
  v_status_inicial text := 'agendado';
  v_pix_payload text := null;

  -- Variáveis para Opção B (cadastro de cliente/veículo parciais)
  v_cliente_id uuid;
  v_veiculo_id uuid;
  v_categoria_id uuid;
  v_nome_limpo text;
  v_tel_limpo text;
  v_tel_digitos text;
  v_modelo_limpo text;
  v_placa_raw text;
  v_placa_final text;
  v_veic_obs text := null;
  v_termo_resp_texto text := '';
  v_termo_gar_texto text := '';
  v_incluir_termo_resp boolean := false;
  v_incluir_termo_gar boolean := false;
BEGIN
  -- 1. Busca Orçamento ESTRITAMENTE pelo Token Público (Eliminando bypass IDOR)
  SELECT o.* INTO v_orcamento
  FROM public.orcamentos o
  WHERE o.token_publico = p_token
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.';
  END IF;

  IF v_orcamento.status = 'expirado' THEN
    RAISE EXCEPTION 'Este orçamento está expirado e não pode ser agendado.';
  END IF;

  IF v_orcamento.status <> 'aprovado' OR v_orcamento.nivel_aprovado IS NULL THEN
    RAISE EXCEPTION 'O orçamento precisa ser aprovado antes do agendamento.';
  END IF;

  IF v_orcamento.agendamento_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este orçamento já possui um agendamento vinculado.';
  END IF;

  SELECT t.* INTO v_tenant FROM public.tenants t WHERE t.id = v_orcamento.tenant_id;

  v_agendamento_cliente_habil := coalesce(v_tenant.orcamento_agendamento_cliente, true);
  v_antecedencia_minima := coalesce(v_tenant.antecedencia_minima_horas, 2);

  IF NOT v_agendamento_cliente_habil THEN
    RAISE EXCEPTION 'O agendamento online de orçamentos não está ativado nesta oficina.';
  END IF;

  v_min_inicio := now() + (v_antecedencia_minima || ' hours')::interval;
  IF p_inicio < v_min_inicio THEN
    RAISE EXCEPTION 'Agendamento deve ser feito com antecedência mínima de % horas.', v_antecedencia_minima;
  END IF;

  v_data := (p_inicio AT TIME ZONE coalesce(v_tenant.fuso_horario, 'America/Sao_Paulo'))::date;
  v_hora := (p_inicio AT TIME ZONE coalesce(v_tenant.fuso_horario, 'America/Sao_Paulo'))::time;

  PERFORM pg_advisory_xact_lock(hashtext(v_orcamento.tenant_id::text || ':' || v_data::text));

  v_cliente_id := v_orcamento.cliente_id;
  v_veiculo_id := v_orcamento.veiculo_id;
  v_categoria_id := v_orcamento.categoria_id;

  IF v_categoria_id IS NULL THEN
    SELECT cv.id INTO v_categoria_id
    FROM public.categorias_veiculo cv
    WHERE cv.tenant_id = v_orcamento.tenant_id
    ORDER BY cv.ordem ASC, cv.created_at ASC
    LIMIT 1;
  END IF;

  -- Opção B: Se orçamento não tinha cliente cadastrado, localiza por telefone ou cria cadastro agora
  IF v_cliente_id IS NULL THEN
    v_nome_limpo := nullif(trim(coalesce(p_cliente_nome, v_orcamento.cliente_nome_avulso)), '');
    v_tel_limpo := nullif(trim(coalesce(p_cliente_telefone, v_orcamento.cliente_telefone_avulso)), '');
    v_tel_digitos := regexp_replace(coalesce(v_tel_limpo, ''), '\D', '', 'g');

    IF v_nome_limpo IS NULL OR length(v_nome_limpo) < 2 THEN
      RAISE EXCEPTION 'Informe seu nome completo para concluir o agendamento.';
    END IF;

    IF length(v_tel_digitos) < 8 THEN
      RAISE EXCEPTION 'Informe um WhatsApp ou telefone válido (com DDD) para concluir o agendamento.';
    END IF;

    SELECT c.id INTO v_cliente_id
    FROM public.clientes c
    WHERE c.tenant_id = v_orcamento.tenant_id
      AND COALESCE(c.ativo, true) = true
      AND regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g') = v_tel_digitos
    ORDER BY c.created_at ASC
    LIMIT 1;

    IF v_cliente_id IS NULL THEN
      INSERT INTO public.clientes (
        tenant_id, nome, telefone, origem, ativo
      ) VALUES (
        v_orcamento.tenant_id, v_nome_limpo, v_tel_limpo, 'online', true
      ) RETURNING id INTO v_cliente_id;
    END IF;

    -- Cadastro opcional de veículo caso informado no formulário público ou pré-preenchido
    IF v_veiculo_id IS NULL AND v_categoria_id IS NOT NULL THEN
      v_modelo_limpo := nullif(trim(coalesce(p_veiculo_modelo, v_orcamento.veiculo_descricao_avulsa)), '');
      v_placa_raw := upper(regexp_replace(coalesce(p_veiculo_placa, ''), '[^a-zA-Z0-9]', '', 'g'));

      IF v_modelo_limpo IS NOT NULL OR nullif(v_placa_raw, '') IS NOT NULL THEN
        IF nullif(v_placa_raw, '') IS NULL OR v_placa_raw IN ('SEMPLACA', 'SEM', 'SP', 'NAOTEM', 'TESTE') THEN
          v_placa_final := 'PROV-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
        ELSE
          SELECT v.id INTO v_veiculo_id
          FROM public.veiculos v
          WHERE v.tenant_id = v_orcamento.tenant_id
            AND v.placa = v_placa_raw
            AND v.cliente_id = v_cliente_id
          LIMIT 1;

          IF v_veiculo_id IS NULL THEN
            IF EXISTS (
              SELECT 1 FROM public.veiculos v
              WHERE v.tenant_id = v_orcamento.tenant_id AND v.placa = v_placa_raw
            ) THEN
              v_placa_final := 'PROV-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
              v_veic_obs := 'Placa informada no agendamento online: ' || v_placa_raw;
            ELSE
              v_placa_final := v_placa_raw;
            END IF;
          END IF;
        END IF;

        IF v_veiculo_id IS NULL THEN
          INSERT INTO public.veiculos (
            tenant_id, cliente_id, categoria_id, placa, modelo, observacoes, ativo
          ) VALUES (
            v_orcamento.tenant_id, v_cliente_id, v_categoria_id, v_placa_final, coalesce(v_modelo_limpo, 'Veículo'), v_veic_obs, true
          ) RETURNING id INTO v_veiculo_id;

          INSERT INTO public.veiculo_donos (
            tenant_id, veiculo_id, cliente_id, inicio
          ) VALUES (
            v_orcamento.tenant_id, v_veiculo_id, v_cliente_id, current_date
          );
        END IF;
      END IF;
    END IF;

    UPDATE public.orcamentos
    SET cliente_id = v_cliente_id,
        veiculo_id = coalesce(v_veiculo_id, veiculo_id),
        categoria_id = coalesce(v_categoria_id, categoria_id),
        cliente_nome_avulso = NULL,
        cliente_telefone_avulso = NULL,
        veiculo_descricao_avulsa = CASE WHEN v_veiculo_id IS NOT NULL THEN NULL ELSE veiculo_descricao_avulsa END,
        updated_at = now()
    WHERE id = v_orcamento.id;
  END IF;

  SELECT n.* INTO v_nivel_rec
  FROM public.orcamento_niveis n
  WHERE n.orcamento_id = v_orcamento.id AND n.nivel = v_orcamento.nivel_aprovado;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dados do pacote aprovado não foram encontrados.';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'servico_id', servico_id,
        'combo_id', combo_id,
        'duracao_minutos', duracao_minutos
      )
    ),
    '[]'::jsonb
  )
  INTO v_itens_json
  FROM public.orcamento_nivel_itens
  WHERE nivel_id = v_nivel_rec.id;

  -- Consulta disponibilidade via RPC horarios_disponiveis
  SELECT disponivel, termino_previsto INTO v_is_disponivel, v_termino_previsto
  FROM public.horarios_disponiveis(
    v_orcamento.tenant_id,
    v_data,
    v_itens_json,
    v_categoria_id,
    null
  )
  WHERE horario = v_hora;

  IF NOT coalesce(v_is_disponivel, false) THEN
    RAISE EXCEPTION 'O horário selecionado não está mais disponível na agenda.';
  END IF;

  SELECT servico_id INTO v_servico_id_primeiro
  FROM public.orcamento_nivel_itens
  WHERE nivel_id = v_nivel_rec.id
  ORDER BY (CASE WHEN servico_id IS NOT NULL THEN 0 ELSE 1 END), ordem ASC
  LIMIT 1;

  IF v_servico_id_primeiro IS NOT NULL THEN
    SELECT coalesce(s.modo_ocupacao, 'slot'), coalesce(s.dias_ocupados, 1)
    INTO v_modo_item, v_dias_item
    FROM public.servicos s
    WHERE s.id = v_servico_id_primeiro AND s.tenant_id = v_orcamento.tenant_id;
  END IF;

  v_modo_item := coalesce(v_modo_item, 'slot');
  v_dias_item := coalesce(v_dias_item, 1);

  IF v_modo_item IN ('transborda', 'multiplos_dias') OR v_dias_item > 1 THEN
    v_modo_efetivo := v_modo_item;
  END IF;

  FOR v_item IN SELECT * FROM public.orcamento_nivel_itens WHERE nivel_id = v_nivel_rec.id LOOP
    v_duracao_total_calculada := v_duracao_total_calculada + coalesce(v_item.duracao_minutos, 60);
    v_total_calculado := v_total_calculado + coalesce(v_item.preco, 0);
  END LOOP;

  IF v_orcamento.desconto_valor > 0 AND v_orcamento.desconto_tipo IS NOT NULL THEN
    IF v_orcamento.desconto_tipo = 'porcentagem' THEN
      v_total_calculado := round(v_total_calculado * (1.0 - (v_orcamento.desconto_valor / 100.0)), 2);
    ELSIF v_orcamento.desconto_tipo = 'valor_fixo' THEN
      v_total_calculado := greatest(0.00, v_total_calculado - v_orcamento.desconto_valor);
    END IF;
  END IF;

  IF v_termino_previsto IS NULL THEN
    v_termino_previsto := public.calcular_fim_efetivo(v_orcamento.tenant_id, p_inicio, v_duracao_total_calculada, v_modo_efetivo);
  END IF;

  v_inicio_sp := (p_inicio AT TIME ZONE coalesce(v_tenant.fuso_horario, 'America/Sao_Paulo'))::date;
  v_termino_sp := (v_termino_previsto AT TIME ZONE coalesce(v_tenant.fuso_horario, 'America/Sao_Paulo'))::date;

  IF v_termino_sp > v_inicio_sp THEN
    v_is_transbordo := true;
  END IF;

  IF v_is_transbordo AND NOT coalesce(p_transbordo_aceito, false) THEN
    RAISE EXCEPTION 'Para agendar um serviço com pernoite, é obrigatório aceitar os termos de permanência do veículo na oficina.';
  END IF;

  IF coalesce(v_tenant.sinal_ativo, false) AND coalesce(v_tenant.sinal_valor, 0) > 0 AND v_total_calculado > 0 THEN
    IF v_tenant.sinal_tipo = 'percentual' THEN
      v_sinal_valor_calc := round((v_total_calculado * v_tenant.sinal_valor / 100.0), 2);
    ELSE
      v_sinal_valor_calc := least(v_tenant.sinal_valor, v_total_calculado);
    END IF;

    IF v_sinal_valor_calc > 0 THEN
      v_sinal_status_final := 'pendente';
      v_status_inicial := 'aguardando_confirmacao';
    END IF;
  END IF;

  v_os_num := coalesce(v_orcamento.numero_os, public.proximo_numero_os(v_orcamento.tenant_id));

  v_obs_final := coalesce(v_orcamento.observacoes, '');
  IF v_is_transbordo THEN
    v_obs_final := trim(v_obs_final || ' [Transbordo Aceito pelo Cliente: Término previsto em ' || to_char(v_termino_previsto AT TIME ZONE coalesce(v_tenant.fuso_horario, 'America/Sao_Paulo'), 'DD/MM/YYYY às HH24:MI') || ']');
  END IF;

  v_incluir_termo_resp := coalesce(v_orcamento.incluir_termo_responsabilidade, v_orcamento.incluir_termos, false);
  v_incluir_termo_gar := coalesce(v_orcamento.incluir_termo_garantia, v_orcamento.incluir_termos, false);

  IF v_incluir_termo_resp THEN
    v_termo_resp_texto := v_orcamento.termo_responsabilidade_texto;
    IF (v_termo_resp_texto IS NULL OR trim(v_termo_resp_texto) = '') AND v_orcamento.termo_responsabilidade_id IS NOT NULL THEN
      SELECT tg.conteudo INTO v_termo_resp_texto
      FROM public.termos_garantia tg
      WHERE tg.id = v_orcamento.termo_responsabilidade_id;
    END IF;
    IF v_termo_resp_texto IS NULL OR trim(v_termo_resp_texto) = '' THEN
      v_termo_resp_texto := coalesce(v_tenant.termo_responsabilidade, '');
    END IF;
  END IF;

  IF v_incluir_termo_gar AND v_orcamento.termo_garantia_id IS NOT NULL THEN
    SELECT tg.conteudo INTO v_termo_gar_texto
    FROM public.termos_garantia tg
    WHERE tg.id = v_orcamento.termo_garantia_id;
  END IF;

  -- Cria o Agendamento
  INSERT INTO public.agendamentos (
    tenant_id, cliente_id, veiculo_id, servico_id, categoria_id, numero_os,
    inicio, duracao_minutos, duracao_total, modo_ocupacao, modo_ocupacao_efetivo, dias_ocupados,
    preco_estimado, preco_estimado_total, status, origem,
    observacoes, sinal_valor, sinal_status, previsao_entrega,
    transbordo_aceito_em, transbordo_aceite_user_agent, transbordo_aceite_ip,
    termo_garantia_id, termo_responsabilidade_texto, termo_garantia_texto
  ) VALUES (
    v_orcamento.tenant_id, v_cliente_id, v_veiculo_id, v_servico_id_primeiro, v_categoria_id, v_os_num,
    p_inicio, v_duracao_total_calculada, v_duracao_total_calculada, coalesce(v_modo_efetivo, 'slot'), coalesce(v_modo_efetivo, 'slot'), coalesce(v_dias_item, 1),
    v_total_calculado, v_total_calculado, v_status_inicial, 'orcamento',
    nullif(v_obs_final, ''), v_sinal_valor_calc, v_sinal_status_final, v_termino_previsto,
    CASE WHEN v_is_transbordo THEN now() ELSE null END,
    CASE WHEN v_is_transbordo THEN p_user_agent ELSE null END,
    CASE WHEN v_is_transbordo THEN p_ip ELSE null END,
    CASE WHEN v_incluir_termo_gar THEN v_orcamento.termo_garantia_id ELSE null END,
    nullif(v_termo_resp_texto, ''),
    nullif(v_termo_gar_texto, '')
  ) RETURNING id INTO v_agendamento_id;

  FOR v_item IN
    SELECT i.*, s.nome AS cat_servico_nome, s.modo_ocupacao AS cat_modo, s.dias_ocupados AS cat_dias
    FROM public.orcamento_nivel_itens i
    LEFT JOIN public.servicos s ON s.id = i.servico_id
    WHERE i.nivel_id = v_nivel_rec.id
    ORDER BY i.ordem ASC
  LOOP
    INSERT INTO public.agendamento_itens (
      tenant_id, agendamento_id, servico_id, combo_id, servico_nome,
      duracao_minutos, preco_estimado, modo_ocupacao, dias_ocupados, ordem
    ) VALUES (
      v_orcamento.tenant_id, v_agendamento_id, v_item.servico_id, v_item.combo_id,
      coalesce(v_item.cat_servico_nome, v_item.servico_nome),
      coalesce(v_item.duracao_minutos, 60), coalesce(v_item.preco, 0),
      coalesce(v_item.cat_modo, v_modo_item, 'transborda'), coalesce(v_item.cat_dias, v_dias_item, 1), v_ordem
    );
    v_ordem := v_ordem + 1;
  END LOOP;

  PERFORM public.recalcular_agendamento_totais(v_agendamento_id);

  UPDATE public.orcamentos
  SET agendamento_id = v_agendamento_id,
      numero_os = v_os_num,
      updated_at = now()
  WHERE id = v_orcamento.id;

  IF v_sinal_status_final = 'pendente' AND v_sinal_valor_calc > 0 AND v_tenant.pix_chave IS NOT NULL AND trim(v_tenant.pix_chave) <> '' THEN
    v_pix_payload := public.gerar_payload_pix(
      v_tenant.pix_chave,
      v_tenant.pix_nome_beneficiario,
      v_tenant.pix_cidade,
      v_sinal_valor_calc,
      'AG' || v_os_num::text
    );
  END IF;

  RETURN jsonb_build_object(
    'agendamento_id', v_agendamento_id,
    'numero_os', v_os_num,
    'status', v_status_inicial,
    'valor_total', v_total_calculado,
    'duracao_minutos', v_duracao_total_calculada,
    'termino_previsto', v_termino_previsto,
    'is_transbordo', v_is_transbordo,
    'sinal', jsonb_build_object(
      'exigido', (v_sinal_status_final = 'pendente'),
      'valor', v_sinal_valor_calc,
      'status', v_sinal_status_final,
      'pix_payload', v_pix_payload
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.agendar_orcamento_publico(uuid, timestamptz, boolean, text, text, text, text, text, text) TO anon, authenticated;

-- ------------------------------------------------------------------------------
-- 9. RPC HORARIOS_DISPONIVEIS (Considera duracao_minutos de Serviços Únicos)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.horarios_disponiveis(
  p_tenant uuid,
  p_data date,
  p_itens jsonb DEFAULT NULL,
  p_categoria uuid DEFAULT NULL,
  p_ignorar_agendamento uuid DEFAULT NULL
) RETURNS TABLE (
  horario time,
  disponivel boolean,
  motivo text,
  termino_previsto timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
#variable_conflict use_column
DECLARE
  v_fuso text := public.obter_fuso_tenant(p_tenant);
  v_dia_semana smallint;
  v_horario_func record;
  v_grade_minutos smallint;
  v_duracao_total_itens integer := 0;
  v_modo_efetivo text := 'transborda';
  v_max_dias integer := 1;
  v_item jsonb;
  v_servico_id uuid;
  v_combo_id uuid;
  v_dur_item integer;
  v_modo_item text;
  v_dias_item integer;
  v_posicao_inicio timestamptz;
  v_posicao_fim timestamptz;
  v_janela_fim_dia1 timestamptz;
  v_slot_time time;
  v_fechamento_ts timestamptz;
  v_agora_sp timestamptz;
  v_sobrepoem_bloqueio boolean;
  v_qtd_agendamentos_ativos integer;
  v_pos_index integer;
  v_is_disponivel boolean;
  v_motivo_indisponivel text;
BEGIN
  v_dia_semana := extract(dow from p_data)::smallint;

  SELECT * INTO v_horario_func
  FROM public.horarios_funcionamento h
  WHERE h.tenant_id = p_tenant AND h.dia_semana = v_dia_semana AND h.ativo;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT coalesce(t.grade_minutos, 60) INTO v_grade_minutos
  FROM public.tenants t WHERE t.id = p_tenant;

  IF p_itens IS NOT NULL AND jsonb_array_length(p_itens) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
      v_servico_id := nullif(v_item->>'servico_id', '')::uuid;
      v_combo_id := nullif(v_item->>'combo_id', '')::uuid;

      IF v_servico_id IS NOT NULL THEN
        SELECT
          coalesce(sp.duracao_minutos, nullif(v_item->>'duracao_minutos', '')::integer, 60),
          coalesce(v_item->>'modo_ocupacao', s.modo_ocupacao, 'transborda'),
          coalesce(s.dias_ocupados, 1)
        INTO v_dur_item, v_modo_item, v_dias_item
        FROM public.servicos s
        LEFT JOIN public.servico_precos sp
          ON sp.servico_id = s.id
         AND (p_categoria IS NULL OR sp.categoria_id = p_categoria)
         AND sp.ativo
        WHERE s.id = v_servico_id AND s.tenant_id = p_tenant
        LIMIT 1;

        IF FOUND THEN
          v_duracao_total_itens := v_duracao_total_itens + coalesce(v_dur_item, 60);
          IF v_dias_item > v_max_dias THEN v_max_dias := v_dias_item; END IF;
          v_modo_efetivo := 'transborda';
        END IF;
      ELSIF v_combo_id IS NOT NULL THEN
        SELECT coalesce(cp.duracao_minutos, nullif(v_item->>'duracao_minutos', '')::integer, 60)
        INTO v_dur_item
        FROM public.combo_precos cp
        WHERE cp.combo_id = v_combo_id
          AND (p_categoria IS NULL OR cp.categoria_id = p_categoria)
        LIMIT 1;

        v_duracao_total_itens := v_duracao_total_itens + coalesce(v_dur_item, nullif(v_item->>'duracao_minutos', '')::integer, 60);
        v_modo_efetivo := 'transborda';
      ELSE
        -- Serviço Único avulso (sem servico_id e sem combo_id)
        v_dur_item := coalesce(nullif(v_item->>'duracao_minutos', '')::integer, 60);
        IF v_dur_item <= 0 THEN v_dur_item := 60; END IF;
        v_duracao_total_itens := v_duracao_total_itens + v_dur_item;
        v_modo_efetivo := 'transborda';
      END IF;
    END LOOP;
  ELSE
    v_modo_efetivo := 'transborda';
  END IF;

  IF v_duracao_total_itens = 0 THEN
    v_duracao_total_itens := 60;
  END IF;

  v_agora_sp := now() AT TIME ZONE v_fuso;

  v_slot_time := v_horario_func.abre;
  v_fechamento_ts := (p_data || ' ' || v_horario_func.fecha)::timestamp AT TIME ZONE v_fuso;
  v_pos_index := 0;

  WHILE v_slot_time <= (v_horario_func.fecha - (v_grade_minutos || ' minutes')::interval) LOOP
    v_pos_index := v_pos_index + 1;
    v_posicao_inicio := (p_data || ' ' || v_slot_time)::timestamp AT TIME ZONE v_fuso;

    v_is_disponivel := true;
    v_motivo_indisponivel := null;

    -- Calcula término efetivo com base em horas úteis da oficina
    v_posicao_fim := public.calcular_fim_efetivo(p_tenant, v_posicao_inicio, v_duracao_total_itens, 'transborda');

    IF v_posicao_fim < v_fechamento_ts THEN
      v_janela_fim_dia1 := v_posicao_fim;
    ELSE
      v_janela_fim_dia1 := v_fechamento_ts;
    END IF;

    IF v_is_disponivel AND v_posicao_inicio < v_agora_sp THEN
      v_is_disponivel := false;
      v_motivo_indisponivel := 'passado';
    END IF;

    IF v_is_disponivel THEN
      SELECT exists(
        SELECT 1 FROM public.bloqueios_agenda b
        WHERE b.tenant_id = p_tenant
          AND b.inicio < v_janela_fim_dia1
          AND b.fim > v_posicao_inicio
      ) INTO v_sobrepoem_bloqueio;

      IF v_sobrepoem_bloqueio THEN
        v_is_disponivel := false;
        v_motivo_indisponivel := 'bloqueado';
      END IF;
    END IF;

    IF v_is_disponivel THEN
      SELECT count(*) INTO v_qtd_agendamentos_ativos
      FROM public.agendamentos a
      WHERE a.tenant_id = p_tenant
        AND a.status NOT IN ('cancelado')
        AND (p_ignorar_agendamento IS NULL OR a.id <> p_ignorar_agendamento)
        AND a.inicio < v_janela_fim_dia1
        AND public.calcular_fim_efetivo(
              a.tenant_id,
              a.inicio,
              coalesce(a.duracao_total, a.duracao_minutos, 60),
              'transborda'
            ) > v_posicao_inicio;

      IF v_qtd_agendamentos_ativos >= coalesce(v_horario_func.capacidade, 1) THEN
        v_is_disponivel := false;
        v_motivo_indisponivel := 'sem_box_livre';
      END IF;
    END IF;

    horario := v_slot_time;
    disponivel := v_is_disponivel;
    motivo := v_motivo_indisponivel;
    termino_previsto := v_posicao_fim;
    RETURN NEXT;

    v_slot_time := (v_slot_time + (v_grade_minutos || ' minutes')::interval)::time;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.horarios_disponiveis(uuid, date, jsonb, uuid, uuid) TO anon, authenticated;

-- ------------------------------------------------------------------------------
-- 10. RPC REAGENDAR (Encaminha duracao_minutos para horários disponíveis)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reagendar(
  p_agendamento uuid,
  p_novo_inicio timestamptz
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_agendamento record;
  v_fuso text;
  v_data date;
  v_hora time;
  v_is_valido boolean := false;
  v_itens_json jsonb;
BEGIN
  SELECT * INTO v_agendamento FROM public.agendamentos WHERE id = p_agendamento;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado.';
  END IF;

  IF NOT public.tem_papel(v_agendamento.tenant_id, ARRAY['dono', 'gerente']::app_role[]) THEN
    RAISE EXCEPTION 'Apenas donos ou gerentes podem reagendar.';
  END IF;

  v_fuso := public.obter_fuso_tenant(v_agendamento.tenant_id);
  v_data := (p_novo_inicio AT TIME ZONE v_fuso)::date;
  v_hora := date_trunc('minute', (p_novo_inicio AT TIME ZONE v_fuso))::time;

  PERFORM pg_advisory_xact_lock(hashtext(v_agendamento.tenant_id::text || ':' || v_data::text));

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'servico_id', servico_id,
        'combo_id', combo_id,
        'duracao_minutos', duracao_minutos
      )
    ),
    '[]'::jsonb
  )
  INTO v_itens_json
  FROM public.agendamento_itens
  WHERE agendamento_id = p_agendamento;

  IF (v_itens_json IS NULL OR jsonb_array_length(v_itens_json) = 0) AND v_agendamento.servico_id IS NOT NULL THEN
    v_itens_json := jsonb_build_array(jsonb_build_object('servico_id', v_agendamento.servico_id));
  END IF;

  SELECT disponivel INTO v_is_valido
  FROM public.horarios_disponiveis(
    v_agendamento.tenant_id,
    v_data,
    v_itens_json,
    v_agendamento.categoria_id,
    p_agendamento
  ) hd
  WHERE hd.horario = v_hora;

  IF NOT coalesce(v_is_valido, false) THEN
    RAISE EXCEPTION 'Este horário não está disponível na agenda. Escolha outro horário.';
  END IF;

  UPDATE public.agendamentos
  SET inicio = p_novo_inicio,
      updated_at = now()
  WHERE id = p_agendamento;

  PERFORM public.recalcular_agendamento_totais(p_agendamento);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reagendar(uuid, timestamptz) TO authenticated;

-- ------------------------------------------------------------------------------
-- 11. RPC INICIAR_EXECUCAO (Fallback para ai.servico_nome em Serviço Único)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.iniciar_execucao(p_agendamento uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_now timestamptz := now();
  v_hoje_sp date;
  v_exec_id uuid;
  v_exec_status text;
  v_item record;
  v_citem record;
  v_current_member_id uuid;
  v_comissao_tipo public.comissao_tipo;
  v_comissao_valor numeric(10,2);
BEGIN
  SELECT a.tenant_id INTO v_tenant_id
  FROM public.agendamentos a
  WHERE a.id = p_agendamento;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Agendamento não encontrado';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.meus_tenants() t WHERE t = v_tenant_id) THEN
    RAISE EXCEPTION 'sem acesso';
  END IF;

  v_hoje_sp := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  SELECT id, status INTO v_exec_id, v_exec_status
  FROM public.execucoes
  WHERE agendamento_id = p_agendamento;

  IF v_exec_id IS NOT NULL THEN
    IF v_exec_status = 'finalizado' THEN
      RAISE EXCEPTION 'Este atendimento já foi finalizado.';
    ELSIF v_exec_status = 'pausado' THEN
      PERFORM public.retomar_execucao(v_exec_id);
    ELSE
      UPDATE public.execucoes
      SET status = 'em_andamento',
          updated_at = v_now
      WHERE id = v_exec_id;
    END IF;
  ELSE
    INSERT INTO public.execucoes (
      tenant_id,
      agendamento_id,
      status,
      iniciado_em,
      contando_desde,
      segundos_trabalhados,
      segundos_pausados
    ) VALUES (
      v_tenant_id,
      p_agendamento,
      'em_andamento',
      v_now,
      v_now,
      0,
      0
    ) RETURNING id INTO v_exec_id;
  END IF;

  UPDATE public.agendamentos
  SET status = 'em_andamento',
      updated_at = v_now
  WHERE id = p_agendamento;

  IF auth.uid() IS NOT NULL THEN
    SELECT tm.id INTO v_current_member_id
    FROM public.tenant_members tm
    WHERE tm.tenant_id = v_tenant_id
      AND tm.user_id = auth.uid()
      AND tm.status <> 'inativo'
    LIMIT 1;

    IF v_current_member_id IS NOT NULL THEN
      SELECT cr.tipo, cr.valor
      INTO v_comissao_tipo, v_comissao_valor
      FROM public.comissao_regras cr
      WHERE cr.tenant_id = v_tenant_id
        AND cr.member_id = v_current_member_id
        AND (cr.vigencia_inicio <= v_hoje_sp)
        AND (cr.vigencia_fim IS NULL OR cr.vigencia_fim >= v_hoje_sp)
      ORDER BY cr.vigencia_inicio DESC, cr.created_at DESC
      LIMIT 1;

      INSERT INTO public.execucao_executores (
        tenant_id,
        execucao_id,
        member_id,
        principal,
        comissao_tipo,
        comissao_valor,
        comissao_calculada
      ) VALUES (
        v_tenant_id,
        v_exec_id,
        v_current_member_id,
        NOT EXISTS (SELECT 1 FROM public.execucao_executores WHERE execucao_id = v_exec_id),
        COALESCE(v_comissao_tipo, 'nenhuma'::public.comissao_tipo),
        COALESCE(v_comissao_valor, 0),
        0
      )
      ON CONFLICT (execucao_id, member_id) DO NOTHING;
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.execucao_itens WHERE execucao_id = v_exec_id) THEN
    FOR v_item IN (
      SELECT
        ai.id AS agendamento_item_id,
        COALESCE(s.nome, ai.servico_nome, 'Serviço') AS servico_nome,
        s.checklist_modelo_id
      FROM public.agendamento_itens ai
      LEFT JOIN public.servicos s ON s.id = ai.servico_id
      WHERE ai.agendamento_id = p_agendamento
    ) LOOP
      IF v_item.checklist_modelo_id IS NOT NULL THEN
        FOR v_citem IN (
          SELECT cmi.descricao, cmi.obrigatorio, cmi.ordem, cmi.observacao
          FROM public.checklist_modelo_itens cmi
          WHERE cmi.modelo_id = v_item.checklist_modelo_id
          ORDER BY cmi.ordem, cmi.created_at
        ) LOOP
          INSERT INTO public.execucao_itens (
            tenant_id,
            execucao_id,
            agendamento_item_id,
            servico_nome,
            descricao,
            obrigatorio,
            ordem,
            origem,
            observacao
          ) VALUES (
            v_tenant_id,
            v_exec_id,
            v_item.agendamento_item_id,
            v_item.servico_nome,
            v_citem.descricao,
            v_citem.obrigatorio,
            v_citem.ordem,
            'modelo',
            v_citem.observacao
          );
        END LOOP;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('success', true, 'execucao_id', v_exec_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.iniciar_execucao(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.iniciar_execucao(uuid) TO authenticated;

-- ------------------------------------------------------------------------------
-- 12. RPC BUSCAR_AGENDAMENTOS (Retorna ai.servico_nome em agendamento_itens JSON)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.buscar_agendamentos(
  p_tenant uuid,
  p_inicio date DEFAULT NULL,
  p_fim date DEFAULT NULL,
  p_status text[] DEFAULT NULL,
  p_busca text DEFAULT NULL,
  p_cliente_id uuid DEFAULT NULL,
  p_veiculo_id uuid DEFAULT NULL,
  p_limite integer DEFAULT 30,
  p_offset integer DEFAULT 0
) RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  cliente_id uuid,
  veiculo_id uuid,
  servico_id uuid,
  categoria_id uuid,
  inicio timestamptz,
  duracao_minutos integer,
  duracao_total integer,
  modo_ocupacao text,
  modo_ocupacao_efetivo text,
  dias_ocupados smallint,
  preco_estimado numeric,
  preco_estimado_total numeric,
  status text,
  origem text,
  observacoes text,
  numero_os integer,
  forcado boolean,
  created_at timestamptz,
  updated_at timestamptz,
  cliente jsonb,
  veiculo jsonb,
  servico jsonb,
  categoria jsonb,
  agendamento_itens jsonb,
  execucao jsonb,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
#variable_conflict use_column
DECLARE
  v_busca_limpa text;
  v_busca_num integer := null;
  v_dono_inicio date := null;
  v_dono_fim date := null;
  v_target_cliente uuid := p_cliente_id;
BEGIN
  IF NOT (p_tenant IN (SELECT public.meus_tenants())) AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  IF p_busca IS NOT NULL AND trim(p_busca) <> '' THEN
    v_busca_limpa := trim(p_busca);
    BEGIN
      IF regexp_replace(lower(v_busca_limpa), '[^0-9]', '', 'g') <> '' THEN
        v_busca_num := (regexp_replace(lower(v_busca_limpa), '[^0-9]', '', 'g'))::integer;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_busca_num := null;
    END;
  END IF;

  IF p_veiculo_id IS NOT NULL THEN
    IF v_target_cliente IS NULL THEN
      SELECT vd.cliente_id, vd.inicio, vd.fim
      INTO v_target_cliente, v_dono_inicio, v_dono_fim
      FROM public.veiculo_donos vd
      WHERE vd.veiculo_id = p_veiculo_id
      ORDER BY CASE WHEN vd.fim IS NULL THEN 0 ELSE 1 END, vd.inicio DESC
      LIMIT 1;
    ELSE
      SELECT vd.inicio, vd.fim
      INTO v_dono_inicio, v_dono_fim
      FROM public.veiculo_donos vd
      WHERE vd.veiculo_id = p_veiculo_id AND vd.cliente_id = v_target_cliente
      ORDER BY vd.inicio DESC
      LIMIT 1;
    END IF;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      a.id,
      a.tenant_id,
      a.cliente_id,
      a.veiculo_id,
      a.servico_id,
      a.categoria_id,
      a.inicio,
      a.duracao_minutos,
      coalesce(a.duracao_total, a.duracao_minutos) AS duracao_total,
      a.modo_ocupacao,
      coalesce(a.modo_ocupacao_efetivo, a.modo_ocupacao) AS modo_ocupacao_efetivo,
      a.dias_ocupados,
      a.preco_estimado,
      coalesce(a.preco_estimado_total, a.preco_estimado) AS preco_estimado_total,
      a.status,
      a.origem,
      a.observacoes,
      a.numero_os,
      coalesce(a.forcado, false) AS forcado,
      a.created_at,
      a.updated_at,
      to_jsonb(c.*) AS cliente,
      CASE WHEN v.id IS NOT NULL THEN to_jsonb(v.*) ELSE null END AS veiculo,
      CASE WHEN s.id IS NOT NULL THEN to_jsonb(s.*) ELSE null END AS servico,
      CASE WHEN cat.id IS NOT NULL THEN to_jsonb(cat.*) ELSE null END AS categoria,
      coalesce(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', ai.id,
              'agendamento_id', ai.agendamento_id,
              'servico_id', ai.servico_id,
              'servico_nome', ai.servico_nome,
              'duracao_minutos', ai.duracao_minutos,
              'preco_estimado', ai.preco_estimado,
              'ordem', ai.ordem,
              'servicos', to_jsonb(s_item.*)
            ) ORDER BY ai.ordem ASC
          )
          FROM public.agendamento_itens ai
          LEFT JOIN public.servicos s_item ON s_item.id = ai.servico_id
          WHERE ai.agendamento_id = a.id
        ),
        '[]'::jsonb
      ) AS agendamento_itens,
      CASE WHEN ex.id IS NOT NULL THEN to_jsonb(ex.*) ELSE null END AS execucao,
      count(*) OVER() AS total_count
    FROM public.agendamentos a
    JOIN public.clientes c ON c.id = a.cliente_id
    LEFT JOIN public.veiculos v ON v.id = a.veiculo_id
    LEFT JOIN public.servicos s ON s.id = a.servico_id
    LEFT JOIN public.categorias_veiculo cat ON cat.id = a.categoria_id
    LEFT JOIN public.execucoes ex ON ex.agendamento_id = a.id
    WHERE a.tenant_id = p_tenant
      AND (p_cliente_id IS NULL OR a.cliente_id = p_cliente_id)
      AND (p_veiculo_id IS NULL OR (
            a.veiculo_id = p_veiculo_id
            AND (v_dono_inicio IS NULL OR (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date >= v_dono_inicio)
            AND (v_dono_fim IS NULL OR (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date <= v_dono_fim)
          ))
      AND (p_inicio IS NULL OR ((a.inicio AT TIME ZONE 'America/Sao_Paulo')::date + COALESCE(a.dias_ocupados, 1) - 1) >= p_inicio)
      AND (p_fim IS NULL OR (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date <= p_fim)
      AND (p_status IS NULL OR cardinality(p_status) = 0 OR a.status = ANY(p_status))
      AND (
        v_busca_limpa IS NULL
        OR (v_busca_num IS NOT NULL AND a.numero_os = v_busca_num)
        OR (v.placa ILIKE '%' || v_busca_limpa || '%')
        OR (c.nome ILIKE '%' || v_busca_limpa || '%')
        OR (c.telefone ILIKE '%' || v_busca_limpa || '%')
        OR (a.observacoes ILIKE '%' || v_busca_limpa || '%')
      )
    ORDER BY a.inicio DESC
  )
  SELECT *
  FROM base
  LIMIT p_limite
  OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.buscar_agendamentos(uuid, date, date, text[], text, uuid, uuid, integer, integer) TO authenticated;

-- ------------------------------------------------------------------------------
-- 13. RPCS DE RELATÓRIOS E HISTÓRICO (LEFT JOIN para não omitir Serviço Único)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rentabilidade_por_servico(
  p_tenant uuid,
  p_inicio date,
  p_fim date
) RETURNS TABLE (
  servico_id uuid,
  servico_nome text,
  servico_codigo text,
  quantidade integer,
  faturamento_total numeric,
  custo_medio numeric,
  lucro_liquido_total numeric,
  lucro_liquido_medio numeric,
  margem_percentual numeric,
  tempo_medio_minutos integer,
  lucro_por_hora numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT (p_tenant IN (SELECT public.meus_tenants())) OR NOT public.tem_papel(p_tenant, ARRAY['dono', 'gerente']::app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  RETURN QUERY
  WITH itens_rateados AS (
    SELECT
      e.id AS execucao_id,
      ai.servico_id,
      coalesce(s.nome, ai.servico_nome, 'Serviço Único') AS servico_nome,
      coalesce(s.codigo, 'UNI') AS servico_codigo,
      coalesce(
        ai.duracao_minutos,
        round(coalesce(e.tempo_efetivo_minutos, 60)::numeric * (
          CASE
            WHEN coalesce(tot.total_estimado, 0) > 0 THEN
              coalesce(ai.preco_estimado, 0) / tot.total_estimado
            ELSE
              1.0 / count(*) OVER(PARTITION BY e.id)
          END
        ))
      )::integer AS tempo_item,
      coalesce(e.valor_total_final, 0) * (
        CASE
          WHEN coalesce(tot.total_estimado, 0) > 0 THEN
            coalesce(ai.preco_estimado, 0) / tot.total_estimado
          ELSE
            1.0 / count(*) OVER(PARTITION BY e.id)
        END
      ) AS faturamento_item,
      (coalesce(e.custo_produtos, 0) + coalesce(e.custo_comissao, 0) + coalesce(e.custo_estrutura, 0)) * (
        CASE
          WHEN coalesce(tot.total_estimado, 0) > 0 THEN
            coalesce(ai.preco_estimado, 0) / tot.total_estimado
          ELSE
            1.0 / count(*) OVER(PARTITION BY e.id)
        END
      ) AS custo_item,
      coalesce(e.lucro_liquido, 0) * (
        CASE
          WHEN coalesce(tot.total_estimado, 0) > 0 THEN
            coalesce(ai.preco_estimado, 0) / tot.total_estimado
          ELSE
            1.0 / count(*) OVER(PARTITION BY e.id)
        END
      ) AS lucro_liquido_item
    FROM public.execucoes e
    JOIN public.agendamentos a ON a.id = e.agendamento_id
    JOIN public.agendamento_itens ai ON ai.agendamento_id = a.id
    LEFT JOIN public.servicos s ON s.id = ai.servico_id
    JOIN LATERAL (
      SELECT nullif(sum(coalesce(ai2.preco_estimado, 0)), 0) AS total_estimado
      FROM public.agendamento_itens ai2
      WHERE ai2.agendamento_id = a.id
    ) tot ON true
    WHERE e.tenant_id = p_tenant
      AND e.status = 'finalizado'
      AND e.finalizado_em::date >= p_inicio
      AND e.finalizado_em::date <= p_fim
  )
  SELECT
    ir.servico_id,
    ir.servico_nome,
    ir.servico_codigo,
    count(distinct ir.execucao_id)::integer AS quantidade,
    round(coalesce(sum(ir.faturamento_item), 0), 2)::numeric AS faturamento_total,
    round(coalesce(avg(ir.custo_item), 0), 2)::numeric AS custo_medio,
    round(coalesce(sum(ir.lucro_liquido_item), 0), 2)::numeric AS lucro_liquido_total,
    round(coalesce(avg(ir.lucro_liquido_item), 0), 2)::numeric AS lucro_liquido_medio,
    CASE
      WHEN sum(ir.faturamento_item) > 0 THEN round((sum(ir.lucro_liquido_item) / sum(ir.faturamento_item)) * 100.0, 1)
      ELSE 0.0
    END::numeric AS margem_percentual,
    round(coalesce(avg(ir.tempo_item), 0))::integer AS tempo_medio_minutos,
    CASE
      WHEN sum(coalesce(ir.tempo_item, 0)) > 0 THEN
        round(sum(ir.lucro_liquido_item) / (sum(ir.tempo_item)::numeric / 60.0), 2)
      ELSE 0.0
    END::numeric AS lucro_por_hora
  FROM itens_rateados ir
  GROUP BY ir.servico_id, ir.servico_nome, ir.servico_codigo;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rentabilidade_por_servico(uuid, date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.historico_consumo_veiculo(p_veiculo uuid)
RETURNS TABLE (
  execucao_id uuid,
  concluido_em timestamptz,
  servicos_nomes text,
  produto_nome text,
  produto_marca text,
  quantidade numeric,
  unidade_uso text,
  custo_unitario numeric,
  custo_total numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_tenant_id uuid;
  v_dono_inicio date;
  v_dono_fim date;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  SELECT v.tenant_id INTO v_tenant_id FROM public.veiculos v WHERE v.id = p_veiculo;

  IF NOT public.tem_papel(v_tenant_id, ARRAY['dono', 'gerente']::app_role[]) THEN
    RETURN;
  END IF;

  SELECT vd.inicio, vd.fim
  INTO v_dono_inicio, v_dono_fim
  FROM public.veiculo_donos vd
  WHERE vd.veiculo_id = p_veiculo
  ORDER BY CASE WHEN vd.fim IS NULL THEN 0 ELSE 1 END, vd.inicio DESC
  LIMIT 1;

  RETURN QUERY
  SELECT
    e.id AS execucao_id,
    e.finalizado_em AS concluido_em,
    coalesce((
      SELECT string_agg(coalesce(s.nome, ai.servico_nome, 'Serviço'), ', ')
      FROM public.agendamento_itens ai
      LEFT JOIN public.servicos s ON s.id = ai.servico_id
      WHERE ai.agendamento_id = e.agendamento_id
    ), 'Serviço') AS servicos_nomes,
    p.nome AS produto_nome,
    p.marca AS produto_marca,
    ec.quantidade,
    p.unidade_uso,
    ec.custo_unitario,
    ec.custo_total
  FROM public.execucoes e
  JOIN public.agendamentos a ON a.id = e.agendamento_id
  JOIN public.execucao_consumos ec ON ec.execucao_id = e.id
  JOIN public.produtos p ON p.id = ec.produto_id
  WHERE a.veiculo_id = p_veiculo
    AND (v_dono_inicio IS NULL OR (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date >= v_dono_inicio)
    AND (v_dono_fim IS NULL OR (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date <= v_dono_fim)
  ORDER BY e.finalizado_em DESC NULLS LAST, ec.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.historico_consumo_veiculo(uuid) TO authenticated;

-- Drop explícito para permitir alinhar os OUT parameters caso a função ativa no banco tenha sido ajustada manualmente
DROP FUNCTION IF EXISTS public.atendimentos_periodo(uuid, date, date);

CREATE OR REPLACE FUNCTION public.atendimentos_periodo(
  p_tenant uuid,
  p_inicio date,
  p_fim date
) RETURNS TABLE (
  execucao_id uuid,
  agendamento_id uuid,
  numero_os integer,
  data timestamptz,
  placa text,
  cliente text,
  servicos text,
  tempo_minutos integer,
  valor numeric,
  custo_produtos numeric,
  custo_comissao numeric,
  custo_estrutura numeric,
  lucro_liquido numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT (p_tenant IN (SELECT public.meus_tenants())) OR NOT public.tem_papel(p_tenant, ARRAY['dono', 'gerente']::app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado. Apenas dono e gerente podem visualizar atendimentos do período.';
  END IF;

  RETURN QUERY
  SELECT
    e.id AS execucao_id,
    e.agendamento_id,
    a.numero_os,
    e.finalizado_em AS data,
    coalesce(v.placa, 'Sem placa') AS placa,
    coalesce(c.nome, 'Cliente não informado') AS cliente,
    coalesce(
      (
        SELECT string_agg(coalesce(s.nome, ai.servico_nome, 'Serviço'), ', ')
        FROM public.agendamento_itens ai
        LEFT JOIN public.servicos s ON s.id = ai.servico_id
        WHERE ai.agendamento_id = e.agendamento_id
      ),
      'Serviço'
    ) AS servicos,
    coalesce(e.tempo_efetivo_minutos, 0) AS tempo_minutos,
    coalesce(e.valor_total_final, 0.00) AS valor,
    coalesce(e.custo_produtos, 0.00) AS custo_produtos,
    coalesce(e.custo_comissao, 0.00) AS custo_comissao,
    coalesce(e.custo_estrutura, 0.00) AS custo_estrutura,
    coalesce(e.lucro_liquido, 0.00) AS lucro_liquido
  FROM public.execucoes e
  JOIN public.agendamentos a ON a.id = e.agendamento_id
  LEFT JOIN public.clientes c ON c.id = a.cliente_id
  LEFT JOIN public.veiculos v ON v.id = a.veiculo_id
  WHERE e.tenant_id = p_tenant
    AND e.status = 'finalizado'
    AND e.finalizado_em::date >= p_inicio
    AND e.finalizado_em::date <= p_fim
  ORDER BY e.finalizado_em DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.atendimentos_periodo(uuid, date, date) TO authenticated;

-- Atualiza schema cache do PostgREST
NOTIFY pgrst, 'reload schema';

