-- Migration 0146: Vincular Retroativamente Oficina Teste Parceiro, Comissões Dinâmicas em Tempo Real e Correção de Esquema
-- 1. Vincula oficinas de teste e indicadas ao parceiro comercial
-- 2. Ativa o plano Pro e credita comissão calculada DINAMICAMENTE sobre o valor atual do plano (ex: R$ 5,00 -> 20% = R$ 1,00)
-- 3. Atualiza processar_pagamento_asaas_parceiro para calcular comissões dinâmicas em tempo real conforme valor cadastrado
-- 4. Atualiza admin_salvar_plano_completo para sincronizar valor de assinaturas ativas em tempo real
-- 5. Atualiza criar_oficina para aceitar códigos de parceiro também em p_codigo_indicacao
-- 6. Cria RPC admin_vincular_oficina_parceiro com SECURITY DEFINER

-- ==============================================================================
-- 1. VINCULAR OFICINA(S) E CREDITAR COMISSÃO DINÂMICA
-- ==============================================================================
DO $$
DECLARE
  v_parceiro RECORD;
  v_tenant RECORD;
  v_plano_pro RECORD;
  v_comp DATE;
  v_preco_centavos_atual INTEGER;
  v_valor_base NUMERIC(10,2);
  v_valor_comissao NUMERIC(10,2);
BEGIN
  -- 1.1 Localizar o parceiro TESTETES10
  SELECT * INTO v_parceiro 
  FROM public.parceiros 
  WHERE codigo = 'TESTETES10' OR id = 'b5148aa2-6080-47f4-b356-95c935ef715f'
  LIMIT 1;

  IF v_parceiro.id IS NULL THEN
    RAISE NOTICE 'Parceiro não encontrado.';
    RETURN;
  END IF;

  -- 1.2 Obter o valor atual do plano PRO cadastrado em public.plans (ex: 500 = R$ 5,00)
  SELECT * INTO v_plano_pro
  FROM public.plans
  WHERE codigo = 'pro';

  v_preco_centavos_atual := COALESCE(v_plano_pro.preco_centavos, 500);
  v_valor_base := round(v_preco_centavos_atual / 100.0, 2);

  -- 1.3 Calcular a comissão do parceiro dinamicamente
  IF v_parceiro.comissao_tipo = 'percentual' THEN
    v_valor_comissao := round(v_valor_base * (v_parceiro.comissao_valor / 100.0), 2);
  ELSE
    v_valor_comissao := v_parceiro.comissao_valor;
  END IF;

  v_comp := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;

  -- 1.4 Vincular retroativamente as oficinas criadas para teste ou via parceiro
  FOR v_tenant IN 
    SELECT t.* 
    FROM public.tenants t
    WHERE t.id = '37aa41e4-9088-4ba0-842d-b58ff034350b'
       OR t.criado_por IN (SELECT id FROM auth.users WHERE lower(email) = 'caironfelipe3@gmail.com')
       OR (v_parceiro.user_id IS NOT NULL AND t.criado_por != v_parceiro.user_id)
  LOOP
    -- Inserir vínculo com o parceiro
    INSERT INTO public.parceiro_oficinas (parceiro_id, tenant_id)
    VALUES (v_parceiro.id, v_tenant.id)
    ON CONFLICT (tenant_id) DO UPDATE SET parceiro_id = EXCLUDED.parceiro_id;

    -- Atualizar o plano da oficina em public.tenants
    UPDATE public.tenants
    SET plano = 'pro',
        updated_at = NOW()
    WHERE id = v_tenant.id;

    -- Atualizar ou inserir assinatura ativa com o valor dinâmico do plano
    INSERT INTO public.assinaturas (
      tenant_id, plano, status, valor_centavos, proximo_vencimento, updated_at
    ) VALUES (
      v_tenant.id, 'pro', 'ativa', v_preco_centavos_atual, (v_comp + INTERVAL '1 month' - INTERVAL '1 day')::date, NOW()
    )
    ON CONFLICT (tenant_id) DO UPDATE SET
      plano = 'pro',
      status = 'ativa',
      valor_centavos = v_preco_centavos_atual,
      proximo_vencimento = (v_comp + INTERVAL '1 month' - INTERVAL '1 day')::date,
      cancelada_em = NULL,
      updated_at = NOW();

    -- Registrar pagamento da competência com o valor real
    INSERT INTO public.pagamentos_competencia (tenant_id, competencia, valor_pago_centavos, confirmado_em)
    VALUES (v_tenant.id, v_comp, v_preco_centavos_atual, NOW())
    ON CONFLICT (tenant_id, competencia)
    DO UPDATE SET valor_pago_centavos = EXCLUDED.valor_pago_centavos, confirmado_em = NOW();

    -- Gravar a comissão aprovada calculada dinamicamente
    INSERT INTO public.parceiro_comissoes (
      parceiro_id, tenant_id, competencia, valor_base, valor_comissao, status
    ) VALUES (
      v_parceiro.id, v_tenant.id, v_comp, v_valor_base, v_valor_comissao, 'aprovada'
    )
    ON CONFLICT (parceiro_id, tenant_id, competencia)
    DO UPDATE SET
      valor_base = EXCLUDED.valor_base,
      valor_comissao = EXCLUDED.valor_comissao,
      status = 'aprovada';

    RAISE NOTICE 'Oficina % vinculada ao parceiro %. Plano: R$ %, Comissao (%): R$ %',
      v_tenant.id, v_parceiro.id, v_valor_base, v_parceiro.comissao_valor, v_valor_comissao;
  END LOOP;
END $$;

-- ==============================================================================
-- 2. RPC DE PROCESSAMENTO DE PAGAMENTO ASAAS / COMISSÃO 100% DINÂMICA
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.processar_pagamento_asaas_parceiro(
  p_tenant_id UUID,
  p_valor_centavos INTEGER DEFAULT NULL,
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
  v_tenant RECORD;
  v_valor_centavos_final INTEGER;
  v_valor_base NUMERIC(10,2);
  v_valor_comissao NUMERIC(10,2);
BEGIN
  v_comp := date_trunc('month', COALESCE(p_competencia, (now() AT TIME ZONE 'America/Sao_Paulo'))::date))::date;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Oficina não encontrada');
  END IF;

  -- Se o webhook do Asaas informou o valor real pago, usa ele.
  -- Senão, busca o preço atual do plano cadastrado em public.plans.
  IF p_valor_centavos IS NOT NULL AND p_valor_centavos > 0 THEN
    v_valor_centavos_final := p_valor_centavos;
  ELSE
    SELECT preco_centavos INTO v_valor_centavos_final
    FROM public.plans
    WHERE codigo = COALESCE(v_tenant.plano, 'pro');

    IF v_valor_centavos_final IS NULL OR v_valor_centavos_final <= 0 THEN
      SELECT valor_centavos INTO v_valor_centavos_final
      FROM public.assinaturas
      WHERE tenant_id = p_tenant_id;
    END IF;

    IF v_valor_centavos_final IS NULL OR v_valor_centavos_final <= 0 THEN
      v_valor_centavos_final := 500;
    END IF;
  END IF;

  INSERT INTO public.pagamentos_competencia (tenant_id, competencia, valor_pago_centavos, confirmado_em)
  VALUES (p_tenant_id, v_comp, v_valor_centavos_final, NOW())
  ON CONFLICT (tenant_id, competencia)
  DO UPDATE SET valor_pago_centavos = EXCLUDED.valor_pago_centavos, confirmado_em = NOW();

  SELECT * INTO v_vinc FROM public.parceiro_oficinas WHERE tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', true, 'parceiro_vinculado', false);
  END IF;

  SELECT * INTO v_parceiro FROM public.parceiros WHERE id = v_vinc.parceiro_id;
  IF NOT FOUND OR NOT v_parceiro.ativo THEN
    RETURN jsonb_build_object('sucesso', true, 'parceiro_ativo', false);
  END IF;

  IF NOT v_parceiro.recorrente AND date_trunc('month', v_vinc.created_at)::date != v_comp THEN
    RETURN jsonb_build_object('sucesso', true, 'nao_recorrente_ignorado', true);
  END IF;

  -- Cálculo dinâmico em tempo real
  v_valor_base := round((v_valor_centavos_final / 100.0), 2);

  IF v_parceiro.comissao_tipo = 'percentual' THEN
    v_valor_comissao := round(v_valor_base * (v_parceiro.comissao_valor / 100.0), 2);
  ELSE
    v_valor_comissao := v_parceiro.comissao_valor;
  END IF;

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
    'valor_base', v_valor_base,
    'comissao_gerada', v_valor_comissao,
    'status', 'aprovada'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.processar_pagamento_asaas_parceiro(UUID, INTEGER, DATE) TO authenticated, service_role;

-- ==============================================================================
-- 3. ATUALIZAÇÃO DO SALVAR PLANO COMPLETO PARA SINCRONIZAR ASSINATURAS EM TEMPO REAL
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.admin_salvar_plano_completo(
  p_codigo TEXT,
  p_nome TEXT,
  p_preco_centavos INTEGER,
  p_ativo BOOLEAN,
  p_features JSONB,
  p_limites JSONB
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_key TEXT;
  v_val JSONB;
  v_limite_num INTEGER;
  v_hab BOOLEAN;
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Permissão negada. Apenas administradores editores podem alterar planos.';
  END IF;

  UPDATE public.plans
  SET 
    nome = TRIM(p_nome),
    preco_centavos = p_preco_centavos,
    ativo = p_ativo,
    updated_at = NOW()
  WHERE codigo = LOWER(TRIM(p_codigo));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plano % não encontrado.', p_codigo;
  END IF;

  -- Atualiza em tempo real o valor das assinaturas ativas deste plano
  UPDATE public.assinaturas
  SET valor_centavos = p_preco_centavos,
      updated_at = NOW()
  WHERE plano = LOWER(TRIM(p_codigo)) AND status = 'ativa';

  IF p_features IS NOT NULL AND jsonb_typeof(p_features) = 'object' THEN
    FOR v_key, v_val IN SELECT * FROM jsonb_each(p_features)
    LOOP
      v_hab := (v_val::text = 'true');
      INSERT INTO public.plan_features (plano, feature, habilitado, updated_at)
      VALUES (LOWER(TRIM(p_codigo)), v_key, v_hab, NOW())
      ON CONFLICT (plano, feature) DO UPDATE
      SET habilitado = EXCLUDED.habilitado, updated_at = NOW();
    END LOOP;
  END IF;

  IF p_limites IS NOT NULL AND jsonb_typeof(p_limites) = 'object' THEN
    FOR v_key, v_val IN SELECT * FROM jsonb_each(p_limites)
    LOOP
      IF v_val IS NULL OR jsonb_typeof(v_val) = 'null' OR v_val::text = 'null' THEN
        v_limite_num := NULL;
      ELSE
        v_limite_num := (v_val::text)::INTEGER;
      END IF;

      INSERT INTO public.plan_limits (plano, recurso, limite, updated_at)
      VALUES (LOWER(TRIM(p_codigo)), v_key, v_limite_num, NOW())
      ON CONFLICT (plano, recurso) DO UPDATE
      SET limite = EXCLUDED.limite, updated_at = NOW();
    END LOOP;
  END IF;

  INSERT INTO public.audit_logs (usuario_id, email, acao, entidade, registro_id, detalhes)
  VALUES (
    auth.uid(),
    public.current_admin_email(),
    'ATUALIZAR_PLANO_COMPLETO',
    'plans',
    p_codigo,
    jsonb_build_object(
      'nome', p_nome,
      'preco_centavos', p_preco_centavos,
      'ativo', p_ativo,
      'features', p_features,
      'limites', p_limites
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_salvar_plano_completo(TEXT, TEXT, INTEGER, BOOLEAN, JSONB, JSONB) TO authenticated;

-- ==============================================================================
-- 4. CRIAR_OFICINA COM DETECÇÃO INTELIGENTE DE CÓDIGO DE PARCEIRO
-- ==============================================================================
DROP FUNCTION IF EXISTS public.criar_oficina(text, text, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.criar_oficina(
  p_nome text,
  p_cidade text DEFAULT NULL,
  p_uf text DEFAULT NULL,
  p_telefone text DEFAULT NULL,
  p_codigo_indicacao text DEFAULT NULL,
  p_codigo_parceiro text DEFAULT NULL,
  p_documento text DEFAULT NULL,
  p_codigo_campanha text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID;
  v_slug TEXT;
  v_parceiro RECORD;
  v_indicador RECORD;
  v_codigo_proprio TEXT;
  v_indicado_email TEXT;
  v_indicador_email TEXT;
  v_indicador_tel TEXT;
  v_indicador_doc TEXT;

  v_trial_ativo_config BOOLEAN := true;
  v_dias_trial_config INTEGER := 15;
  v_plano_inicial TEXT := 'pro';
  v_status_inicial TEXT := 'trial';
  v_dias_trial_concedidos INTEGER := 15;
  v_trial_fim DATE;
  v_valor_centavos INTEGER := 6700;

  v_campanha RECORD;
  v_campanha_usada TEXT := NULL;
BEGIN
  IF p_nome IS NULL OR trim(p_nome) = '' THEN
    RAISE EXCEPTION 'O nome da oficina é obrigatório';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  SELECT 
    COALESCE(trial_ativo, true),
    COALESCE(trial_dias, 15)
  INTO 
    v_trial_ativo_config,
    v_dias_trial_config
  FROM public.plataforma_config
  ORDER BY id ASC
  LIMIT 1;

  IF v_dias_trial_config IS NULL OR v_dias_trial_config <= 0 THEN
    v_dias_trial_config := 15;
  END IF;

  IF p_codigo_campanha IS NOT NULL AND trim(p_codigo_campanha) != '' THEN
    SELECT * INTO v_campanha
    FROM public.campanhas_lancamento
    WHERE upper(codigo) = upper(trim(p_codigo_campanha))
      AND ativo = true
      AND (data_fim IS NULL OR data_fim >= current_date)
      AND (limite_usos IS NULL OR usos_atuais < limite_usos)
    LIMIT 1;

    IF FOUND THEN
      v_plano_inicial := COALESCE(v_campanha.plano_concedido, 'pro');
      v_status_inicial := 'trial';
      v_dias_trial_concedidos := COALESCE(v_campanha.dias_trial, v_dias_trial_config);
      v_trial_fim := (current_date + v_dias_trial_concedidos);
      v_valor_centavos := 6700;
      v_campanha_usada := v_campanha.codigo;

      UPDATE public.campanhas_lancamento
      SET usos_atuais = usos_atuais + 1,
          updated_at = now()
      WHERE id = v_campanha.id;
    END IF;
  END IF;

  IF v_campanha_usada IS NULL THEN
    IF NOT v_trial_ativo_config THEN
      v_plano_inicial := 'free';
      v_status_inicial := 'ativo';
      v_dias_trial_concedidos := 0;
      v_trial_fim := NULL;
      v_valor_centavos := 0;
    ELSE
      v_plano_inicial := 'pro';
      v_status_inicial := 'trial';
      v_dias_trial_concedidos := v_dias_trial_config;
      v_trial_fim := (current_date + v_dias_trial_concedidos);
      v_valor_centavos := 6700;
    END IF;
  ELSE
    v_status_inicial := 'trial';
    v_trial_fim := (current_date + v_dias_trial_concedidos);
  END IF;

  v_slug := lower(regexp_replace(p_nome, '[^a-zA-Z0-9]+', '-', 'g'))
            || '-' || substr(gen_random_uuid()::text, 1, 6);

  v_codigo_proprio := public.gerar_codigo_indicacao_unico();

  -- Criar Tenant
  INSERT INTO public.tenants (nome, slug, cidade, uf, telefone, documento, criado_por, plano, codigo_indicacao)
    VALUES (p_nome, v_slug, p_cidade, p_uf, p_telefone, p_documento, auth.uid(), v_plano_inicial, v_codigo_proprio)
    RETURNING id INTO v_tenant;

  -- Criar Membro Dono
  INSERT INTO public.tenant_members (tenant_id, user_id, email, role, status)
    VALUES (
      v_tenant, 
      auth.uid(),
      (SELECT email FROM auth.users WHERE id = auth.uid()),
      'dono', 
      'ativo'
    );

  -- Registrar Assinatura Inicial
  INSERT INTO public.assinaturas (
    tenant_id, plano, status, valor_centavos, trial_fim, created_at, updated_at
  ) VALUES (
    v_tenant, v_plano_inicial, v_status_inicial, v_valor_centavos, v_trial_fim, now(), now()
  ) ON CONFLICT (tenant_id) DO UPDATE
  SET plano = EXCLUDED.plano, status = EXCLUDED.status, trial_fim = EXCLUDED.trial_fim, updated_at = now();

  -- Semeaduras
  INSERT INTO public.categorias_veiculo (tenant_id, nome, descricao, ordem, ativo)
  VALUES
    (v_tenant, 'Hatch', 'Onix, HB20, Gol, Argo, Polo', 0, true),
    (v_tenant, 'Sedan', 'Corolla, Civic, Virtus, Cronos, Onix Plus', 1, true),
    (v_tenant, 'SUV', 'Creta, Compass, T-Cross, Renegade, Tracker', 2, true),
    (v_tenant, 'Caminhonete', 'Hilux, S10, Ranger, Toro, Strada', 3, true),
    (v_tenant, 'Van / Utilitário', 'Kombi, Master, Sprinter, Ducato', 4, false),
    (v_tenant, 'Caminhão', 'Veículos pesados', 5, false),
    (v_tenant, 'Moto', 'Todas as cilindradas', 6, false)
  ON CONFLICT (tenant_id, nome) DO NOTHING;

  BEGIN
    PERFORM public.seed_horarios_funcionamento_tenant(v_tenant);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    PERFORM public.seed_formas_pagamento_tenant(v_tenant);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  IF NOT EXISTS (SELECT 1 FROM public.tenant_maquininhas WHERE tenant_id = v_tenant AND padrao = true) THEN
    INSERT INTO public.tenant_maquininhas (tenant_id, nome, padrao, ordem)
    VALUES (v_tenant, 'Maquininha Padrão', true, 1);
  END IF;

  -- Checagem de Parceiro (aceita tanto p_codigo_parceiro quanto p_codigo_indicacao se for parceiro)
  IF p_codigo_parceiro IS NOT NULL AND trim(p_codigo_parceiro) != '' THEN
    SELECT * INTO v_parceiro FROM public.parceiros 
    WHERE upper(codigo) = upper(trim(p_codigo_parceiro)) AND ativo = true;

    IF FOUND THEN
      INSERT INTO public.parceiro_oficinas (parceiro_id, tenant_id)
      VALUES (v_parceiro.id, v_tenant)
      ON CONFLICT (tenant_id) DO UPDATE SET parceiro_id = EXCLUDED.parceiro_id;
    END IF;
  ELSIF p_codigo_indicacao IS NOT NULL AND trim(p_codigo_indicacao) != '' THEN
    SELECT * INTO v_parceiro FROM public.parceiros 
    WHERE upper(codigo) = upper(trim(p_codigo_indicacao)) AND ativo = true;

    IF FOUND THEN
      INSERT INTO public.parceiro_oficinas (parceiro_id, tenant_id)
      VALUES (v_parceiro.id, v_tenant)
      ON CONFLICT (tenant_id) DO UPDATE SET parceiro_id = EXCLUDED.parceiro_id;
    END IF;
  END IF;

  -- Indicação entre oficinas
  IF NOT EXISTS (SELECT 1 FROM public.parceiro_oficinas WHERE tenant_id = v_tenant)
     AND p_codigo_indicacao IS NOT NULL AND trim(p_codigo_indicacao) != '' THEN
    SELECT * INTO v_indicador FROM public.tenants 
    WHERE upper(codigo_indicacao) = upper(trim(p_codigo_indicacao));

    IF FOUND AND v_indicador.id != v_tenant THEN
      SELECT email INTO v_indicado_email FROM auth.users WHERE id = auth.uid();
      
      SELECT u.email, t.telefone, t.documento INTO v_indicador_email, v_indicador_tel, v_indicador_doc
      FROM public.tenants t
      JOIN auth.users u ON u.id = t.criado_por
      WHERE t.id = v_indicador.id;

      INSERT INTO public.indicacoes_oficina (
        indicador_tenant_id,
        indicado_tenant_id,
        status,
        indicado_nome_oficina,
        indicado_email,
        indicador_email,
        indicador_telefone,
        indicador_documento
      ) VALUES (
        v_indicador.id,
        v_tenant,
        'pendente',
        p_nome,
        v_indicado_email,
        v_indicador_email,
        v_indicador_tel,
        v_indicador_doc
      ) ON CONFLICT (indicado_tenant_id) DO NOTHING;
    END IF;
  END IF;

  BEGIN
    PERFORM public.notificar_admin(
      'nova_oficina',
      'Nova Oficina Cadastrada: ' || p_nome,
      'A oficina "' || p_nome || '" (' || coalesce(p_cidade, 'Sem cidade') || '/' || coalesce(p_uf, 'UF') || ') acabou de se cadastrar no plano ' || upper(v_plano_inicial) || '.',
      '/admin/oficinas',
      jsonb_build_object('tenant_id', v_tenant, 'nome', p_nome, 'plano', v_plano_inicial, 'trial_fim', v_trial_fim, 'campanha', v_campanha_usada)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_tenant;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.criar_oficina(text, text, text, text, text, text, text, text) TO authenticated;

-- ==============================================================================
-- 5. RPC ADMIN PARA VINCULAR OU ALTERAR PARCEIRO COM SECURITY DEFINER
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.admin_vincular_oficina_parceiro(
  p_tenant_id UUID,
  p_parceiro_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Apenas administradores da plataforma podem vincular parceiros a oficinas.';
  END IF;

  IF p_parceiro_id IS NULL THEN
    DELETE FROM public.parceiro_oficinas WHERE tenant_id = p_tenant_id;
    RETURN jsonb_build_object('sucesso', true, 'removido', true);
  END IF;

  INSERT INTO public.parceiro_oficinas (parceiro_id, tenant_id)
  VALUES (p_parceiro_id, p_tenant_id)
  ON CONFLICT (tenant_id) DO UPDATE SET parceiro_id = EXCLUDED.parceiro_id;

  RETURN jsonb_build_object('sucesso', true, 'parceiro_id', p_parceiro_id, 'tenant_id', p_tenant_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_vincular_oficina_parceiro(UUID, UUID) TO authenticated, service_role;
