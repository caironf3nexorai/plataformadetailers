-- ==============================================================================
-- MIGRAÇÃO 0087: PORTAL DO PARCEIRO, COMISSÃO AUTOMÁTICA E COTAS DE FOTOS
-- ==============================================================================

-- 1. VÍNCULO DE USUÁRIO COM PARCEIRO PARA ACESSO AO PORTAL
-- Adiciona a coluna user_id sem travar a tabela auth.users (evita deadlocks com o GoTrue/Auth)
ALTER TABLE public.parceiros 
ADD COLUMN IF NOT EXISTS user_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS parceiros_user_id_idx 
ON public.parceiros(user_id) 
WHERE user_id IS NOT NULL;

-- Chave estrangeira segura criada com NOT VALID (não segura lock em auth.users)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'parceiros_user_id_fkey'
  ) THEN
    ALTER TABLE public.parceiros 
    ADD CONSTRAINT parceiros_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

-- 2. POLÍTICAS DE RLS PARA VISUALIZAÇÃO DO PRÓPRIO PARCEIRO
DROP POLICY IF EXISTS "parceiros_self_select_policy" ON public.parceiros;
CREATE POLICY "parceiros_self_select_policy" ON public.parceiros
  FOR SELECT USING (user_id = auth.uid() OR public.is_platform_admin());

DROP POLICY IF EXISTS "parceiro_comissoes_self_select_policy" ON public.parceiro_comissoes;
CREATE POLICY "parceiro_comissoes_self_select_policy" ON public.parceiro_comissoes
  FOR SELECT USING (
    parceiro_id IN (SELECT id FROM public.parceiros WHERE user_id = auth.uid()) 
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS "parceiro_oficinas_self_select_policy" ON public.parceiro_oficinas;
CREATE POLICY "parceiro_oficinas_self_select_policy" ON public.parceiro_oficinas
  FOR SELECT USING (
    parceiro_id IN (SELECT id FROM public.parceiros WHERE user_id = auth.uid()) 
    OR public.is_platform_admin()
  );

-- 3. TRIGGER DE AUTO-VÍNCULO NO CADASTRO DE PARCEIROS (TABELA PARCEIROS)
CREATE OR REPLACE FUNCTION public.handle_parceiro_sync_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  IF NEW.user_id IS NULL AND NEW.email IS NOT NULL THEN
    SELECT id INTO v_user_id 
    FROM auth.users 
    WHERE lower(trim(email)) = lower(trim(NEW.email)) 
    LIMIT 1;

    IF v_user_id IS NOT NULL THEN
      NEW.user_id := v_user_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_parceiro_sync_user ON public.parceiros;
CREATE TRIGGER trg_parceiro_sync_user
  BEFORE INSERT OR UPDATE OF email, user_id ON public.parceiros
  FOR EACH ROW EXECUTE FUNCTION public.handle_parceiro_sync_user();

-- Sincroniza parceiros existentes que coincidam com o email de um usuário
UPDATE public.parceiros p
SET user_id = u.id
FROM auth.users u
WHERE p.user_id IS NULL 
  AND lower(trim(p.email)) = lower(trim(u.email));

-- 4. RPC PARA ATUALIZAÇÃO SEGURA DO PIX PELO PARCEIRO
CREATE OR REPLACE FUNCTION public.parceiro_atualizar_pix(
  p_pix_chave TEXT,
  p_pix_tipo TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_parceiro_id UUID;
  v_user_email TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  SELECT id INTO v_parceiro_id FROM public.parceiros WHERE user_id = auth.uid();

  -- Fallback de auto-vínculo por e-mail caso ainda não associado
  IF v_parceiro_id IS NULL THEN
    SELECT email INTO v_user_email FROM auth.users WHERE id = auth.uid();
    IF v_user_email IS NOT NULL THEN
      UPDATE public.parceiros
      SET user_id = auth.uid()
      WHERE lower(trim(email)) = lower(trim(v_user_email))
      RETURNING id INTO v_parceiro_id;
    END IF;
  END IF;

  IF v_parceiro_id IS NULL THEN
    RAISE EXCEPTION 'Nenhum perfil de parceiro comercial associado a este usuário.';
  END IF;

  IF p_pix_chave IS NULL OR trim(p_pix_chave) = '' THEN
    RAISE EXCEPTION 'Informe uma chave PIX válida.';
  END IF;

  UPDATE public.parceiros
  SET pix_chave = trim(p_pix_chave),
      pix_tipo = lower(trim(p_pix_tipo))
  WHERE id = v_parceiro_id;

  RETURN jsonb_build_object(
    'sucesso', true,
    'mensagem', 'Chave PIX atualizada com sucesso.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.parceiro_atualizar_pix(TEXT, TEXT) TO authenticated;

-- 5. RPC PARA OBTER DADOS DO PAINEL DO PARCEIRO
CREATE OR REPLACE FUNCTION public.parceiro_obter_dados_painel()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_parceiro RECORD;
  v_user_email TEXT;
  v_total_indicacoes INT := 0;
  v_total_ativas INT := 0;
  v_comissoes_previstas NUMERIC(10,2) := 0.00;
  v_comissoes_aprovadas NUMERIC(10,2) := 0.00;
  v_comissoes_pagas NUMERIC(10,2) := 0.00;
  v_indicacoes JSONB := '[]'::JSONB;
  v_comissoes JSONB := '[]'::JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  SELECT * INTO v_parceiro FROM public.parceiros WHERE user_id = auth.uid();

  -- Auto-vínculo pelo e-mail se ainda não constar
  IF v_parceiro.id IS NULL THEN
    SELECT email INTO v_user_email FROM auth.users WHERE id = auth.uid();
    IF v_user_email IS NOT NULL THEN
      UPDATE public.parceiros
      SET user_id = auth.uid()
      WHERE lower(trim(email)) = lower(trim(v_user_email))
      RETURNING * INTO v_parceiro;
    END IF;
  END IF;

  IF v_parceiro.id IS NULL THEN
    RETURN jsonb_build_object('is_parceiro', false);
  END IF;

  -- 1. Métricas de Indicações
  SELECT count(*) INTO v_total_indicacoes
  FROM public.parceiro_oficinas po
  WHERE po.parceiro_id = v_parceiro.id;

  SELECT count(*) INTO v_total_ativas
  FROM public.parceiro_oficinas po
  JOIN public.assinaturas ass ON ass.tenant_id = po.tenant_id
  WHERE po.parceiro_id = v_parceiro.id AND ass.status = 'ativa';

  -- 2. Métricas de Comissões
  SELECT
    coalesce(sum(case when status = 'prevista' then valor_comissao else 0 end), 0.00),
    coalesce(sum(case when status = 'aprovada' then valor_comissao else 0 end), 0.00),
    coalesce(sum(case when status = 'paga' then valor_comissao else 0 end), 0.00)
  INTO v_comissoes_previstas, v_comissoes_aprovadas, v_comissoes_pagas
  FROM public.parceiro_comissoes
  WHERE parceiro_id = v_parceiro.id;

  -- 3. Lista de Oficinas Indicadas
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'tenant_id', t.id,
      'oficina_nome', t.nome,
      'cidade', t.cidade,
      'uf', t.uf,
      'plano', t.plano,
      'status_assinatura', coalesce(ass.status, 'trial'),
      'vinculado_em', po.created_at,
      'proximo_vencimento', ass.proximo_vencimento
    ) ORDER BY po.created_at DESC
  ), '[]'::jsonb)
  INTO v_indicacoes
  FROM public.parceiro_oficinas po
  JOIN public.tenants t ON t.id = po.tenant_id
  LEFT JOIN public.assinaturas ass ON ass.tenant_id = t.id
  WHERE po.parceiro_id = v_parceiro.id;

  -- 4. Histórico de Comissões
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', pc.id,
      'competencia', pc.competencia,
      'oficina_nome', t.nome,
      'valor_base', pc.valor_base,
      'valor_comissao', pc.valor_comissao,
      'status', pc.status,
      'pago_em', pc.pago_em,
      'comprovante_path', pc.comprovante_path,
      'created_at', pc.created_at
    ) ORDER BY pc.competencia DESC, pc.created_at DESC
  ), '[]'::jsonb)
  INTO v_comissoes
  FROM public.parceiro_comissoes pc
  JOIN public.tenants t ON t.id = pc.tenant_id
  WHERE pc.parceiro_id = v_parceiro.id;

  RETURN jsonb_build_object(
    'is_parceiro', true,
    'parceiro', jsonb_build_object(
      'id', v_parceiro.id,
      'nome', v_parceiro.nome,
      'email', v_parceiro.email,
      'telefone', v_parceiro.telefone,
      'codigo', v_parceiro.codigo,
      'pix_chave', v_parceiro.pix_chave,
      'pix_tipo', v_parceiro.pix_tipo,
      'comissao_tipo', v_parceiro.comissao_tipo,
      'comissao_valor', v_parceiro.comissao_valor,
      'recorrente', v_parceiro.recorrente,
      'ativo', v_parceiro.ativo
    ),
    'resumo', jsonb_build_object(
      'total_indicacoes', v_total_indicacoes,
      'total_ativas', v_total_ativas,
      'comissoes_previstas', v_comissoes_previstas,
      'comissoes_aprovadas', v_comissoes_aprovadas,
      'comissoes_pagas', v_comissoes_pagas
    ),
    'indicacoes', v_indicacoes,
    'comissoes', v_comissoes
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.parceiro_obter_dados_painel() TO authenticated;

-- 6. RPC PARA IDENTIFICAR SE O USUÁRIO ATUAL É PARCEIRO E/OU ADMIN
CREATE OR REPLACE FUNCTION public.obter_status_usuario_atual()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_email TEXT;
  v_is_admin BOOLEAN := FALSE;
  v_is_partner BOOLEAN := FALSE;
  v_partner_id UUID := NULL;
  v_partner_nome TEXT := NULL;
  v_partner_codigo TEXT := NULL;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'is_admin', false,
      'is_partner', false,
      'partner_id', null,
      'partner_nome', null,
      'partner_codigo', null
    );
  END IF;

  v_is_admin := public.is_platform_admin();

  -- Busca direta por user_id
  SELECT id, nome, codigo 
  INTO v_partner_id, v_partner_nome, v_partner_codigo
  FROM public.parceiros
  WHERE user_id = v_uid AND ativo = true
  LIMIT 1;

  -- Fallback de busca por email
  IF v_partner_id IS NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
    IF v_email IS NOT NULL THEN
      SELECT id, nome, codigo 
      INTO v_partner_id, v_partner_nome, v_partner_codigo
      FROM public.parceiros
      WHERE lower(trim(email)) = lower(trim(v_email)) AND ativo = true
      LIMIT 1;

      -- Se encontrou por email e user_id estava nulo, aproveita para vincular
      IF v_partner_id IS NOT NULL THEN
        UPDATE public.parceiros SET user_id = v_uid WHERE id = v_partner_id;
      END IF;
    END IF;
  END IF;

  IF v_partner_id IS NOT NULL THEN
    v_is_partner := TRUE;
  END IF;

  RETURN jsonb_build_object(
    'is_admin', v_is_admin,
    'is_partner', v_is_partner,
    'partner_id', v_partner_id,
    'partner_nome', v_partner_nome,
    'partner_codigo', v_partner_codigo
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_status_usuario_atual() TO authenticated;

-- 7. RPC ADMIN PARA VINCULAR MANUALMENTE PARCEIRO A USUÁRIO PELO PAINEL
CREATE OR REPLACE FUNCTION public.admin_vincular_usuario_parceiro(
  p_parceiro_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso restrito a administradores';
  END IF;

  UPDATE public.parceiros
  SET user_id = p_user_id
  WHERE id = p_parceiro_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_vincular_usuario_parceiro(UUID, UUID) TO authenticated;

-- 8. RPC DISPARADA PELO WEBHOOK DO ASAAS PARA REGISTRAR COMISSÃO AUTOMÁTICA
CREATE OR REPLACE FUNCTION public.processar_pagamento_asaas_parceiro(
  p_tenant_id UUID,
  p_valor_centavos INTEGER,
  p_competencia DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_comp DATE;
  v_vinc RECORD;
  v_parceiro RECORD;
  v_valor_base NUMERIC(10,2);
  v_valor_comissao NUMERIC(10,2);
BEGIN
  v_comp := date_trunc('month', COALESCE(p_competencia, (now() AT TIME ZONE 'America/Sao_Paulo')::date))::date;

  -- 1. Registra o pagamento de competência da oficina
  INSERT INTO public.pagamentos_competencia (tenant_id, competencia, valor_pago_centavos, confirmado_em)
  VALUES (p_tenant_id, v_comp, COALESCE(p_valor_centavos, 6700), NOW())
  ON CONFLICT (tenant_id, competencia)
  DO UPDATE SET valor_pago_centavos = EXCLUDED.valor_pago_centavos, confirmado_em = NOW();

  -- 2. Verifica se a oficina possui vínculo com um parceiro comercial
  SELECT * INTO v_vinc FROM public.parceiro_oficinas WHERE tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', true, 'parceiro_vinculado', false);
  END IF;

  SELECT * INTO v_parceiro FROM public.parceiros WHERE id = v_vinc.parceiro_id;
  IF NOT FOUND OR NOT v_parceiro.ativo THEN
    RETURN jsonb_build_object('sucesso', true, 'parceiro_ativo', false);
  END IF;

  -- Se o parceiro não for recorrente e não for o primeiro mês do vínculo, não gera comissão
  IF NOT v_parceiro.recorrente AND date_trunc('month', v_vinc.created_at)::date != v_comp THEN
    RETURN jsonb_build_object('sucesso', true, 'nao_recorrente_ignorado', true);
  END IF;

  -- 3. Calcula comissão
  v_valor_base := (COALESCE(p_valor_centavos, 6700) / 100.0);

  IF v_parceiro.comissao_tipo = 'percentual' THEN
    v_valor_comissao := round(v_valor_base * (v_parceiro.comissao_valor / 100.0), 2);
  ELSE
    v_valor_comissao := v_parceiro.comissao_valor;
  END IF;

  -- 4. Grava a comissão aprovada diretamente no painel do parceiro
  INSERT INTO public.parceiro_comissoes (
    parceiro_id, tenant_id, competencia, valor_base, valor_comissao, status
  ) VALUES (
    v_parceiro.id, p_tenant_id, v_comp, v_valor_base, v_valor_comissao, 'aprovada'
  )
  ON CONFLICT (parceiro_id, tenant_id, competencia)
  DO UPDATE SET 
    valor_base = EXCLUDED.valor_base,
    valor_comissao = EXCLUDED.valor_comissao,
    status = (CASE WHEN public.parceiro_comissoes.status = 'paga' THEN 'paga' ELSE 'aprovada' END);

  RETURN jsonb_build_object(
    'sucesso', true,
    'parceiro_id', v_parceiro.id,
    'comissao_gerada', v_valor_comissao,
    'status', 'aprovada'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.processar_pagamento_asaas_parceiro(UUID, INTEGER, DATE) TO authenticated, service_role;

-- 9. COTAS DE PRESERVAÇÃO DE FOTOS POR PLANO
INSERT INTO public.plan_limits (plano, recurso, limite) VALUES
  ('free', 'atendimentos_preservados_limite', 0),
  ('pro', 'atendimentos_preservados_limite', 50),
  ('studio', 'atendimentos_preservados_limite', NULL)
ON CONFLICT (plano, recurso) DO UPDATE SET limite = EXCLUDED.limite;

-- 10. ATUALIZAÇÃO DA RPC PRESERVAR_FOTOS_EXECUCAO COM VALIDAÇÃO DE COTA
CREATE OR REPLACE FUNCTION public.preservar_fotos_execucao(
  p_execucao uuid,
  p_preservar boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_member_id uuid;
  v_plano text;
  v_retencao integer := 90;
  v_limite integer;
  v_total_preservados integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT e.tenant_id INTO v_tenant_id
  FROM public.execucoes e
  WHERE e.id = p_execucao;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Execução não encontrada';
  END IF;

  SELECT tm.id INTO v_member_id
  FROM public.tenant_members tm
  WHERE tm.tenant_id = v_tenant_id
    AND tm.user_id = auth.uid()
    AND tm.status = 'ativo'
    AND tm.role IN ('dono', 'gerente')
  LIMIT 1;

  IF v_member_id IS NULL AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas Dono e Gerente deste estabelecimento podem alterar a preservação de fotos.';
  END IF;

  SELECT t.plano INTO v_plano FROM public.tenants t WHERE t.id = v_tenant_id;

  IF p_preservar THEN
    SELECT pl.limite INTO v_limite 
    FROM public.plan_limits pl 
    WHERE pl.plano = v_plano AND pl.recurso = 'atendimentos_preservados_limite';

    IF v_limite IS NOT NULL THEN
      SELECT count(DISTINCT ef.execucao_id) INTO v_total_preservados
      FROM public.execucao_fotos ef
      WHERE ef.tenant_id = v_tenant_id 
        AND ef.preservada = true
        AND ef.execucao_id != p_execucao;

      IF v_total_preservados >= v_limite THEN
        IF v_limite = 0 THEN
          RAISE EXCEPTION 'A preservação permanente de fotos não está disponível no plano % (Gratuito). Faça upgrade para o plano Pro para preservar atendimentos.', upper(v_plano);
        ELSE
          RAISE EXCEPTION 'Limite de atendimentos preservados atingido para o plano % (% atendimentos). Remova a preservação de atendimentos antigos ou faça upgrade para o Studio.', upper(v_plano), v_limite;
        END IF;
      END IF;
    END IF;

    UPDATE public.execucao_fotos ef
    SET preservada = true,
        preservada_em = now(),
        preservada_por = v_member_id,
        expirado_em = null
    WHERE ef.execucao_id = p_execucao;
  ELSE
    SELECT pl.limite INTO v_retencao 
    FROM public.plan_limits pl 
    WHERE pl.plano = v_plano AND pl.recurso = 'retencao_fotos_execucao_dias';
    v_retencao := COALESCE(v_retencao, 90);

    UPDATE public.execucao_fotos ef
    SET preservada = false,
        preservada_em = null,
        preservada_por = null,
        expirado_em = now() + (v_retencao || ' days')::interval
    WHERE ef.execucao_id = p_execucao;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.preservar_fotos_execucao(uuid, boolean) TO authenticated;

-- 11. ATUALIZAÇÃO DA RPC ENTRADA_AVULSA COM SUPORTE A PREÇOS CUSTOMIZADOS
CREATE OR REPLACE FUNCTION public.entrada_avulsa(
  p_cliente uuid,
  p_veiculo uuid,
  p_itens jsonb,
  p_categoria uuid,
  p_observacoes text default null
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_tenant uuid;
  v_user uuid;
  v_agendamento_id uuid;
  v_item jsonb;
  v_servico_id uuid;
  v_combo_id uuid;
  v_duracao integer;
  v_modo text;
  v_dias integer;
  v_preco numeric(10,2);
  v_preco_custom numeric(10,2);
  v_ordem smallint := 0;
  v_primeiro_servico uuid;
  v_os_num integer;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.clientes WHERE id = p_cliente;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não encontrado.';
  END IF;

  SELECT auth.uid() INTO v_user;

  IF NOT (v_tenant IN (SELECT meus_tenants())) OR NOT public.tem_papel(v_tenant, array['dono', 'gerente', 'operador']::app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado. Usuário não é membro desta oficina.';
  END IF;

  IF p_itens IS NULL OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos um serviço para a entrada avulsa.';
  END IF;

  v_servico_id := (p_itens->0->>'servico_id')::uuid;
  v_os_num := public.proximo_numero_os(v_tenant);

  INSERT INTO public.agendamentos (
    tenant_id,
    cliente_id,
    veiculo_id,
    servico_id,
    categoria_id,
    inicio,
    status,
    origem,
    observacoes,
    criado_por,
    duracao_total,
    duracao_minutos,
    preco_estimado_total,
    preco_estimado,
    modo_ocupacao,
    dias_ocupados,
    numero_os
  ) VALUES (
    v_tenant,
    p_cliente,
    p_veiculo,
    v_servico_id,
    p_categoria,
    now(),
    'confirmado',
    'balcao',
    p_observacoes,
    v_user,
    0,
    0,
    0.00,
    0.00,
    'slot',
    1,
    v_os_num
  ) RETURNING id INTO v_agendamento_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_servico_id := (v_item->>'servico_id')::uuid;
    v_combo_id := nullif(v_item->>'combo_id', '')::uuid;

    SELECT 
      coalesce(sp.duracao_minutos, 60),
      s.modo_ocupacao,
      coalesce(s.dias_ocupados, 1),
      sp.preco_base
    INTO v_duracao, v_modo, v_dias, v_preco
    FROM public.servicos s
    LEFT JOIN public.servico_precos sp
      ON sp.servico_id = s.id
     AND sp.categoria_id = p_categoria
     AND sp.ativo
    WHERE s.id = v_servico_id AND s.tenant_id = v_tenant;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Serviço % não encontrado.', v_servico_id;
    END IF;

    -- Se um preço customizado foi informado na entrada, ele prevalece
    IF v_item ? 'preco' AND (v_item->>'preco') IS NOT NULL AND trim(v_item->>'preco') != '' THEN
      v_preco_custom := (v_item->>'preco')::numeric(10,2);
      IF v_preco_custom IS NOT NULL AND v_preco_custom >= 0 THEN
        v_preco := v_preco_custom;
      END IF;
    END IF;

    IF v_primeiro_servico IS NULL THEN
      v_primeiro_servico := v_servico_id;
    END IF;

    INSERT INTO public.agendamento_itens (
      tenant_id, agendamento_id, servico_id, combo_id,
      duracao_minutos, preco_estimado, modo_ocupacao, dias_ocupados, ordem
    ) VALUES (
      v_tenant, v_agendamento_id, v_servico_id, v_combo_id,
      v_duracao, v_preco, v_modo, v_dias, v_ordem
    );

    v_ordem := v_ordem + 1;
  END LOOP;

  UPDATE public.agendamentos
  SET servico_id = v_primeiro_servico
  WHERE id = v_agendamento_id;

  PERFORM public.recalcular_agendamento_totais(v_agendamento_id);

  RETURN v_agendamento_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.entrada_avulsa(uuid, uuid, jsonb, uuid, text) TO authenticated;
