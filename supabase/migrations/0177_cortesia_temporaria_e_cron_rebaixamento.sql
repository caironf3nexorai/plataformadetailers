-- ==============================================================================
-- MIGRAÇÃO 0177: CORTESIA TEMPORÁRIA NO ADMIN, SEPARAÇÃO DE MRR E CRON DE REBAIXAMENTO
-- ==============================================================================
-- Problemas corrigidos:
--   1. Concessões manuais pelo Admin agora suportam prazo de cortesia
--      (15 dias, 30 dias, 3 meses, 6 meses, 1 ano, data/dias customizados ou vitalícia),
--      ficam explicitamente marcadas com status = 'cortesia', is_cortesia = true,
--      cortesia_ate = DATE, valor_centavos = 0 (zero cobrança no Asaas e zero distorção de MRR).
--   2. admin_salvar_plano_completo não sobrescreve mais cortesias nem assinaturas
--      com desconto promocional ativo quando o admin altera o preço padrão dos planos.
--   3. processar_rotina_diaria_assinaturas() não estava agendada no pg_cron e tinha
--      lacunas (data UTC, status 'atrasada' preso, ausência de regra para cortesia
--      expirada, trials legados sem trial_fim, canceladas após ciclo pago e drift de tenants).
--      Agora roda diariamente às 06:05 UTC (03:05 Brasília) via pg_cron e também pode
--      ser acionada sob demanda no painel admin via admin_executar_rotina_assinaturas().
--   4. Segurança: fecha execução direta de processar_rotina_diaria_assinaturas() para
--      authenticated, exige admin na view admin_promocoes_ativas e restringe
--      admin_registrar_pagamento_manual_competencia a is_platform_admin_editor().
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. SCHEMA DE public.assinaturas: SUPORTE A CORTESIA TEMPORÁRIA
-- ------------------------------------------------------------------------------
ALTER TABLE public.assinaturas
  ADD COLUMN IF NOT EXISTS is_cortesia BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.assinaturas
  ADD COLUMN IF NOT EXISTS cortesia_ate DATE NULL;

ALTER TABLE public.assinaturas
  ADD COLUMN IF NOT EXISTS plano_pendente TEXT NULL;

COMMENT ON COLUMN public.assinaturas.is_cortesia IS
  'Indica se o plano atual foi concedido manualmente como cortesia administrativa (sem cobrança Asaas e fora do MRR).';

COMMENT ON COLUMN public.assinaturas.cortesia_ate IS
  'Data limite (America/Sao_Paulo) da cortesia administrativa; quando atingida, rebaixa automaticamente para Free. NULL = vitalícia/sem prazo.';

COMMENT ON COLUMN public.assinaturas.plano_pendente IS
  'Plano selecionado em checkout pendente no Asaas antes da confirmação do pagamento pelo webhook.';

-- Atualiza a constraint CHECK de status para aceitar 'cortesia'
DO $$
DECLARE
  v_con RECORD;
BEGIN
  FOR v_con IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.assinaturas'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.assinaturas DROP CONSTRAINT %I', v_con.conname);
  END LOOP;

  ALTER TABLE public.assinaturas
    ADD CONSTRAINT assinaturas_status_check
    CHECK (status IN ('trial', 'ativa', 'atrasada', 'cancelada', 'cortesia'));
END;
$$;

CREATE INDEX IF NOT EXISTS idx_assinaturas_vigencia_cron
  ON public.assinaturas (status, trial_fim, cortesia_ate, atraso_desde, proximo_vencimento)
  WHERE status IN ('trial', 'cortesia', 'atrasada', 'cancelada', 'ativa');

-- ------------------------------------------------------------------------------
-- 2. PROTEGER VIEW admin_promocoes_ativas (VAZAMENTO CROSS-TENANT CORRIGIDO)
-- ------------------------------------------------------------------------------
DROP VIEW IF EXISTS public.admin_promocoes_ativas;
CREATE VIEW public.admin_promocoes_ativas AS
SELECT
  t.id              AS tenant_id,
  t.nome            AS oficina_nome,
  a.plano,
  a.ciclo,
  a.valor_centavos  AS valor_promo_centavos,
  round(a.valor_centavos / 100.0, 2)              AS valor_promo_reais,
  a.promo_meses_restantes,
  a.promo_valor_normal_centavos,
  round(a.promo_valor_normal_centavos / 100.0, 2) AS valor_normal_reais,
  a.promo_cupom_codigo,
  a.promo_cupom_id,
  a.updated_at
FROM public.assinaturas a
JOIN public.tenants t ON t.id = a.tenant_id
WHERE a.promo_meses_restantes IS NOT NULL
  AND a.promo_meses_restantes > 0
  AND (
    public.is_platform_admin()
    OR auth.role() = 'service_role'
    OR session_user IN ('postgres', 'supabase_admin')
  )
ORDER BY a.promo_meses_restantes ASC;

REVOKE ALL ON TABLE public.admin_promocoes_ativas FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.admin_promocoes_ativas TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 3. ADMIN: ALTERAÇÃO MANUAL DE PLANO COM CORTESIA TEMPORÁRIA E AUDITORIA
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_alterar_plano_manual(uuid, text, text);
DROP FUNCTION IF EXISTS public.admin_alterar_plano_manual(uuid, text, text, integer, date, boolean);

CREATE OR REPLACE FUNCTION public.admin_alterar_plano_manual(
  p_tenant_id UUID,
  p_novo_plano TEXT,
  p_motivo TEXT DEFAULT NULL,
  p_dias_cortesia INTEGER DEFAULT NULL,
  p_cortesia_ate DATE DEFAULT NULL,
  p_is_cortesia BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant RECORD;
  v_ass_atual RECORD;
  v_tem_ass BOOLEAN := false;
  v_ass_status_ant TEXT := NULL;
  v_ass_is_cortesia_ant BOOLEAN := false;
  v_ass_cortesia_ate_ant DATE := NULL;
  v_ass_ciclo_ant TEXT := 'mensal';
  v_ass_prox_venc_ant DATE := NULL;
  v_hoje DATE;
  v_plano_limpo TEXT;
  v_status_novo TEXT;
  v_is_cortesia_final BOOLEAN := false;
  v_cortesia_ate_final DATE := NULL;
  v_prox_venc_novo DATE := NULL;
  v_valor_novo INTEGER := 0;
  v_dias_efetivos INTEGER := NULL;
  v_motivo_limpo TEXT;
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Apenas administradores editores da plataforma podem alterar planos manualmente.';
  END IF;

  v_plano_limpo := lower(trim(COALESCE(p_novo_plano, '')));
  IF v_plano_limpo = '' OR NOT EXISTS (SELECT 1 FROM public.plans WHERE codigo = v_plano_limpo) THEN
    RAISE EXCEPTION 'Plano "%" inválido ou não encontrado.', COALESCE(p_novo_plano, '');
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oficina não encontrada.';
  END IF;

  SELECT * INTO v_ass_atual FROM public.assinaturas WHERE tenant_id = p_tenant_id;
  v_tem_ass := FOUND;
  IF v_tem_ass THEN
    v_ass_status_ant := v_ass_atual.status;
    v_ass_is_cortesia_ant := COALESCE(v_ass_atual.is_cortesia, false);
    v_ass_cortesia_ate_ant := v_ass_atual.cortesia_ate;
    v_ass_ciclo_ant := COALESCE(v_ass_atual.ciclo, 'mensal');
    v_ass_prox_venc_ant := v_ass_atual.proximo_vencimento;
  END IF;

  v_hoje := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_motivo_limpo := NULLIF(trim(COALESCE(p_motivo, '')), '');

  IF p_dias_cortesia IS NOT NULL AND p_dias_cortesia <= 0 THEN
    RAISE EXCEPTION 'A duração da cortesia em dias deve ser maior que zero (ou NULL para vitalícia).';
  END IF;

  IF p_cortesia_ate IS NOT NULL AND p_cortesia_ate <= v_hoje THEN
    RAISE EXCEPTION 'A data final da cortesia (%) deve ser posterior à data de hoje (%).', p_cortesia_ate, v_hoje;
  END IF;

  IF v_plano_limpo = 'free' THEN
    -- Rebaixamento manual imediato para o plano gratuito
    v_status_novo := 'cancelada';
    v_is_cortesia_final := false;
    v_cortesia_ate_final := NULL;
    v_valor_novo := 0;

    UPDATE public.tenants
    SET plano = 'free', updated_at = now()
    WHERE id = p_tenant_id;

    INSERT INTO public.assinaturas (
      tenant_id, plano, plano_pendente, status, valor_centavos,
      is_cortesia, cortesia_ate, trial_fim, atraso_desde,
      cancelada_em, url_pagamento_asaas, forma_pagamento, updated_at
    ) VALUES (
      p_tenant_id, 'free', NULL, 'cancelada', 0,
      false, NULL, NULL, NULL,
      now(), NULL, NULL, now()
    )
    ON CONFLICT (tenant_id) DO UPDATE
    SET plano = 'free',
        plano_pendente = NULL,
        status = 'cancelada',
        valor_centavos = 0,
        is_cortesia = false,
        cortesia_ate = NULL,
        trial_fim = NULL,
        atraso_desde = NULL,
        cancelada_em = now(),
        url_pagamento_asaas = NULL,
        forma_pagamento = NULL,
        proximo_vencimento = NULL,
        updated_at = now();

  ELSIF COALESCE(p_is_cortesia, true) = true THEN
    -- Cortesia administrativa (SEM cobrança no Asaas e SEM entrar no MRR)
    v_status_novo := 'cortesia';
    v_is_cortesia_final := true;
    v_valor_novo := 0;

    IF p_cortesia_ate IS NOT NULL THEN
      v_cortesia_ate_final := p_cortesia_ate;
      v_dias_efetivos := (v_cortesia_ate_final - v_hoje);
    ELSIF p_dias_cortesia IS NOT NULL THEN
      v_cortesia_ate_final := v_hoje + p_dias_cortesia;
      v_dias_efetivos := p_dias_cortesia;
    ELSE
      -- Sem prazo definido (vitalícia)
      v_cortesia_ate_final := NULL;
      v_dias_efetivos := NULL;
    END IF;

    UPDATE public.tenants
    SET plano = v_plano_limpo, updated_at = now()
    WHERE id = p_tenant_id;

    INSERT INTO public.assinaturas (
      tenant_id, plano, plano_pendente, status, ciclo, valor_centavos,
      is_cortesia, cortesia_ate, trial_fim, atraso_desde,
      cancelada_em, url_pagamento_asaas, forma_pagamento, updated_at
    ) VALUES (
      p_tenant_id, v_plano_limpo, NULL, 'cortesia', 'mensal', 0,
      true, v_cortesia_ate_final, NULL, NULL,
      NULL, NULL, NULL, now()
    )
    ON CONFLICT (tenant_id) DO UPDATE
    SET plano = EXCLUDED.plano,
        plano_pendente = NULL,
        status = 'cortesia',
        valor_centavos = 0,
        is_cortesia = true,
        cortesia_ate = EXCLUDED.cortesia_ate,
        trial_fim = NULL,
        atraso_desde = NULL,
        cancelada_em = NULL,
        url_pagamento_asaas = NULL,
        forma_pagamento = NULL,
        proximo_vencimento = NULL,
        updated_at = now();

  ELSE
    -- Ativação manual comercial paga (fora do gateway Asaas, conta no MRR com preço dinâmico)
    v_status_novo := 'ativa';
    v_is_cortesia_final := false;
    v_cortesia_ate_final := NULL;
    v_prox_venc_novo := COALESCE(
      p_cortesia_ate,
      CASE WHEN p_dias_cortesia IS NOT NULL THEN (v_hoje + p_dias_cortesia) ELSE NULL END,
      v_ass_prox_venc_ant
    );

    SELECT COALESCE(
      CASE
        WHEN v_ass_ciclo_ant = 'anual' AND p.preco_anual_centavos IS NOT NULL AND p.preco_anual_centavos > 0
          THEN p.preco_anual_centavos
        ELSE p.preco_centavos
      END,
      0
    ) INTO v_valor_novo
    FROM public.plans p
    WHERE p.codigo = v_plano_limpo;

    UPDATE public.tenants
    SET plano = v_plano_limpo, updated_at = now()
    WHERE id = p_tenant_id;

    INSERT INTO public.assinaturas (
      tenant_id, plano, plano_pendente, status, ciclo, valor_centavos,
      is_cortesia, cortesia_ate, trial_fim, atraso_desde,
      cancelada_em, proximo_vencimento, updated_at
    ) VALUES (
      p_tenant_id, v_plano_limpo, NULL, 'ativa', 'mensal', COALESCE(v_valor_novo, 0),
      false, NULL, NULL, NULL,
      NULL, v_prox_venc_novo, now()
    )
    ON CONFLICT (tenant_id) DO UPDATE
    SET plano = EXCLUDED.plano,
        plano_pendente = NULL,
        status = 'ativa',
        valor_centavos = EXCLUDED.valor_centavos,
        is_cortesia = false,
        cortesia_ate = NULL,
        trial_fim = NULL,
        atraso_desde = NULL,
        cancelada_em = NULL,
        proximo_vencimento = EXCLUDED.proximo_vencimento,
        updated_at = now();
  END IF;

  INSERT INTO public.admin_auditoria (
    admin_user_id, acao, entidade, entidade_id, valor_anterior, valor_novo
  ) VALUES (
    auth.uid(),
    'alteracao_manual_plano_oficina',
    'tenants',
    p_tenant_id::text,
    jsonb_build_object(
      'plano', v_tenant.plano,
      'status', v_ass_status_ant,
      'is_cortesia', v_ass_is_cortesia_ant,
      'cortesia_ate', v_ass_cortesia_ate_ant
    ),
    jsonb_build_object(
      'plano', v_plano_limpo,
      'status', v_status_novo,
      'is_cortesia', v_is_cortesia_final,
      'cortesia_ate', v_cortesia_ate_final,
      'dias_cortesia', v_dias_efetivos,
      'proximo_vencimento', v_prox_venc_novo,
      'valor_centavos', v_valor_novo,
      'motivo', COALESCE(v_motivo_limpo, 'Alteração manual pelo Admin')
    )
  );

  RETURN jsonb_build_object(
    'sucesso', true,
    'tenant_id', p_tenant_id,
    'plano', v_plano_limpo,
    'status', v_status_novo,
    'is_cortesia', v_is_cortesia_final,
    'cortesia_ate', v_cortesia_ate_final,
    'dias_cortesia', v_dias_efetivos,
    'valor_centavos', v_valor_novo
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_alterar_plano_manual(uuid, text, text, integer, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_alterar_plano_manual(uuid, text, text, integer, date, boolean) TO authenticated;

-- ------------------------------------------------------------------------------
-- 4. CORRIGIR admin_salvar_plano_completo PARA NÃO SOBRESCREVER CORTESIAS OU PROMOÇÕES
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_salvar_plano_completo(TEXT, TEXT, INTEGER, BOOLEAN, JSONB, JSONB);
DROP FUNCTION IF EXISTS public.admin_salvar_plano_completo(TEXT, TEXT, INTEGER, BOOLEAN, JSONB, JSONB, INTEGER);

CREATE OR REPLACE FUNCTION public.admin_salvar_plano_completo(
  p_codigo TEXT,
  p_nome TEXT,
  p_preco_centavos INTEGER,
  p_ativo BOOLEAN,
  p_features JSONB,
  p_limites JSONB,
  p_preco_anual_centavos INTEGER DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key TEXT;
  v_val JSONB;
  v_limite_num INTEGER;
  v_hab BOOLEAN;
  v_cod TEXT := LOWER(TRIM(p_codigo));
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Permissão negada. Apenas administradores editores podem alterar planos.';
  END IF;

  UPDATE public.plans
  SET
    nome = TRIM(p_nome),
    preco_centavos = p_preco_centavos,
    preco_anual_centavos = p_preco_anual_centavos,
    ativo = p_ativo,
    updated_at = NOW()
  WHERE codigo = v_cod;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plano % não encontrado.', p_codigo;
  END IF;

  -- Atualiza apenas assinaturas reais não-cortesia e sem promoção temporária ativa
  UPDATE public.assinaturas
  SET valor_centavos = CASE WHEN v_cod = 'free' THEN 0 ELSE p_preco_centavos END,
      updated_at = NOW()
  WHERE plano = v_cod
    AND (ciclo IS NULL OR ciclo = 'mensal')
    AND status IN ('ativa', 'trial', 'atrasada')
    AND COALESCE(is_cortesia, false) = false
    AND COALESCE(promo_meses_restantes, 0) = 0;

  IF p_preco_anual_centavos IS NOT NULL AND p_preco_anual_centavos > 0 THEN
    UPDATE public.assinaturas
    SET valor_centavos = CASE WHEN v_cod = 'free' THEN 0 ELSE p_preco_anual_centavos END,
        updated_at = NOW()
    WHERE plano = v_cod
      AND ciclo = 'anual'
      AND status IN ('ativa', 'trial', 'atrasada')
      AND COALESCE(is_cortesia, false) = false
      AND COALESCE(promo_meses_restantes, 0) = 0;
  END IF;

  IF p_features IS NOT NULL AND jsonb_typeof(p_features) = 'object' THEN
    FOR v_key, v_val IN SELECT * FROM jsonb_each(p_features)
    LOOP
      v_hab := (v_val::text = 'true');
      INSERT INTO public.plan_features (plano, feature, habilitado, updated_at)
      VALUES (v_cod, v_key, v_hab, NOW())
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
      VALUES (v_cod, v_key, v_limite_num, NOW())
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
      'preco_anual_centavos', p_preco_anual_centavos,
      'ativo', p_ativo,
      'features', p_features,
      'limites', p_limites
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_salvar_plano_completo(TEXT, TEXT, INTEGER, BOOLEAN, JSONB, JSONB, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_salvar_plano_completo(TEXT, TEXT, INTEGER, BOOLEAN, JSONB, JSONB, INTEGER) TO authenticated;

-- ------------------------------------------------------------------------------
-- 5. ATUALIZAR obter_assinatura_tenant COM CORTESIA + REBAIXAMENTO AUTOMÁTICO COMPLETO
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.obter_assinatura_tenant(UUID);
CREATE OR REPLACE FUNCTION public.obter_assinatura_tenant(p_tenant_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_system BOOLEAN;
  v_tenant_id UUID;
  v_ass RECORD;
  v_tenant RECORD;
  v_hoje DATE;
  v_dias_trial INTEGER := 0;
  v_dias_cortesia INTEGER := NULL;
  v_dias_atraso INTEGER := 0;
  v_dias_para_rebaixamento INTEGER := 0;
  v_status_final TEXT;
  v_plano_final TEXT;
  v_is_cortesia BOOLEAN := false;
  v_cortesia_ate_ret DATE := NULL;
  v_valor_dinamico INTEGER;
BEGIN
  v_is_system := (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin'));

  IF NOT v_is_system AND auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  v_tenant_id := COALESCE(p_tenant_id, (SELECT public.meus_tenants() LIMIT 1));
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object(
      'existe', false,
      'status', 'cancelada',
      'plano', 'free',
      'ciclo', 'mensal',
      'is_cortesia', false,
      'cortesia_ate', NULL,
      'dias_cortesia_restantes', NULL
    );
  END IF;

  IF NOT v_is_system AND NOT (v_tenant_id IN (SELECT public.meus_tenants()) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Acesso negado às informações de assinatura desta oficina.';
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = v_tenant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'existe', false,
      'status', 'cancelada',
      'plano', 'free',
      'ciclo', 'mensal',
      'valor_centavos', 0,
      'dias_trial_restantes', 0,
      'is_cortesia', false,
      'cortesia_ate', NULL,
      'dias_cortesia_restantes', NULL
    );
  END IF;

  SELECT * INTO v_ass FROM public.assinaturas WHERE tenant_id = v_tenant_id;

  v_hoje := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  IF NOT FOUND THEN
    SELECT preco_centavos INTO v_valor_dinamico FROM public.plans WHERE codigo = COALESCE(v_tenant.plano::text, 'free');
    RETURN jsonb_build_object(
      'existe', false,
      'plano', COALESCE(v_tenant.plano::text, 'free'),
      'status', CASE WHEN COALESCE(v_tenant.plano::text, 'free') = 'free' THEN 'cancelada' ELSE 'trial' END,
      'ciclo', 'mensal',
      'valor_centavos', COALESCE(v_valor_dinamico, 0),
      'dias_trial_restantes', 0,
      'is_cortesia', false,
      'cortesia_ate', NULL,
      'dias_cortesia_restantes', NULL
    );
  END IF;

  v_status_final := v_ass.status;
  v_plano_final := CASE
    WHEN v_status_final = 'cancelada' AND v_tenant.plano = 'free' THEN 'free'
    ELSE COALESCE(v_tenant.plano::text, v_ass.plano, 'free')
  END;
  v_is_cortesia := (v_status_final = 'cortesia' OR COALESCE(v_ass.is_cortesia, false) = true) AND v_plano_final != 'free';
  v_cortesia_ate_ret := CASE WHEN v_is_cortesia THEN v_ass.cortesia_ate ELSE NULL END;

  -- A. EXPIRAÇÃO DE TRIAL (incluindo legados sem trial_fim > 15 dias ou checkout abandonado não pago)
  IF v_status_final = 'trial' THEN
    IF v_ass.trial_fim IS NOT NULL THEN
      v_dias_trial := v_ass.trial_fim - v_hoje;
      IF v_dias_trial <= 0 THEN
        v_dias_trial := 0;
        v_status_final := 'cancelada';
        v_plano_final := 'free';
        v_is_cortesia := false;
        v_cortesia_ate_ret := NULL;

        UPDATE public.assinaturas
        SET plano = 'free',
            status = 'cancelada',
            is_cortesia = false,
            cortesia_ate = NULL,
            valor_centavos = 0,
            cancelada_em = COALESCE(cancelada_em, now()),
            updated_at = now()
        WHERE id = v_ass.id;

        UPDATE public.tenants
        SET plano = 'free',
            updated_at = now()
        WHERE id = v_tenant_id;
      END IF;
    ELSIF (v_ass.created_at AT TIME ZONE 'America/Sao_Paulo')::date <= (v_hoje - 15) THEN
      v_dias_trial := 0;
      v_status_final := 'cancelada';
      v_plano_final := 'free';
      v_is_cortesia := false;
      v_cortesia_ate_ret := NULL;

      UPDATE public.assinaturas
      SET plano = 'free',
          status = 'cancelada',
          is_cortesia = false,
          cortesia_ate = NULL,
          valor_centavos = 0,
          cancelada_em = COALESCE(cancelada_em, now()),
          updated_at = now()
      WHERE id = v_ass.id;

      UPDATE public.tenants
      SET plano = 'free',
          updated_at = now()
      WHERE id = v_tenant_id;
    END IF;
  END IF;

  -- B. EXPIRAÇÃO DE CORTESIA TEMPORÁRIA
  IF v_is_cortesia AND v_cortesia_ate_ret IS NOT NULL THEN
    v_dias_cortesia := v_cortesia_ate_ret - v_hoje;
    IF v_dias_cortesia <= 0 THEN
      v_dias_cortesia := 0;
      v_status_final := 'cancelada';
      v_plano_final := 'free';
      v_is_cortesia := false;
      v_cortesia_ate_ret := NULL;

      UPDATE public.assinaturas
      SET plano = 'free',
          status = 'cancelada',
          is_cortesia = false,
          cortesia_ate = NULL,
          valor_centavos = 0,
          cancelada_em = COALESCE(cancelada_em, now()),
          url_pagamento_asaas = NULL,
          updated_at = now()
      WHERE id = v_ass.id;

      UPDATE public.tenants
      SET plano = 'free',
          updated_at = now()
      WHERE id = v_tenant_id;
    END IF;
  END IF;

  -- C. INADIMPLÊNCIA >= 5 DIAS
  IF v_status_final = 'atrasada' AND NOT v_is_cortesia AND v_ass.atraso_desde IS NOT NULL THEN
    v_dias_atraso := v_hoje - v_ass.atraso_desde;
    v_dias_para_rebaixamento := 5 - v_dias_atraso;
    IF v_dias_para_rebaixamento <= 0 THEN
      v_dias_para_rebaixamento := 0;
      v_status_final := 'cancelada';
      v_plano_final := 'free';

      UPDATE public.assinaturas
      SET plano = 'free',
          status = 'cancelada',
          is_cortesia = false,
          cortesia_ate = NULL,
          valor_centavos = 0,
          cancelada_em = COALESCE(cancelada_em, now()),
          updated_at = now()
      WHERE id = v_ass.id;

      UPDATE public.tenants
      SET plano = 'free',
          updated_at = now()
      WHERE id = v_tenant_id;
    END IF;
  END IF;

  -- D. CANCELADA COM FIM DE CICLO PAGO EXPIRADO
  IF v_ass.cancelada_em IS NOT NULL
     AND v_ass.asaas_subscription_id IS NULL
     AND NOT v_is_cortesia
     AND v_plano_final != 'free'
     AND v_status_final IN ('ativa', 'cancelada')
     AND (v_ass.proximo_vencimento IS NULL OR v_ass.proximo_vencimento < v_hoje)
  THEN
    v_status_final := 'cancelada';
    v_plano_final := 'free';

    UPDATE public.assinaturas
    SET plano = 'free',
        status = 'cancelada',
        valor_centavos = 0,
        updated_at = now()
    WHERE id = v_ass.id;

    UPDATE public.tenants
    SET plano = 'free',
        updated_at = now()
    WHERE id = v_tenant_id;
  END IF;

  -- E. PREÇO DINÂMICO (CORTESIA OU FREE RETORNA 0)
  IF v_plano_final = 'free' OR v_is_cortesia OR v_status_final = 'cortesia' THEN
    v_valor_dinamico := 0;
  ELSE
    SELECT
      CASE
        WHEN COALESCE(v_ass.ciclo, 'mensal') = 'anual' AND p.preco_anual_centavos IS NOT NULL AND p.preco_anual_centavos > 0
          THEN p.preco_anual_centavos
        ELSE p.preco_centavos
      END
    INTO v_valor_dinamico
    FROM public.plans p
    WHERE p.codigo = v_plano_final;
  END IF;

  RETURN jsonb_build_object(
    'existe', true,
    'id', v_ass.id,
    'tenant_id', v_ass.tenant_id,
    'plano', v_plano_final,
    'status', v_status_final,
    'ciclo', COALESCE(v_ass.ciclo, 'mensal'),
    'forma_pagamento', v_ass.forma_pagamento,
    'valor_centavos', COALESCE(v_valor_dinamico, v_ass.valor_centavos, 0),
    'trial_fim', v_ass.trial_fim,
    'dias_trial_restantes', v_dias_trial,
    'is_cortesia', v_is_cortesia,
    'cortesia_ate', v_cortesia_ate_ret,
    'dias_cortesia_restantes', v_dias_cortesia,
    'proximo_vencimento', v_ass.proximo_vencimento,
    'atraso_desde', v_ass.atraso_desde,
    'dias_atraso', v_dias_atraso,
    'dias_para_rebaixamento', v_dias_para_rebaixamento,
    'url_pagamento_asaas', v_ass.url_pagamento_asaas,
    'asaas_subscription_id', v_ass.asaas_subscription_id,
    'cancelada_em', v_ass.cancelada_em,
    'promo_meses_restantes', v_ass.promo_meses_restantes,
    'promo_valor_normal_centavos', v_ass.promo_valor_normal_centavos,
    'promo_cupom_codigo', v_ass.promo_cupom_codigo,
    'promo_valor_cobrado_centavos', v_ass.valor_centavos
  );
END;
$$;

REVOKE ALL ON FUNCTION public.obter_assinatura_tenant(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obter_assinatura_tenant(UUID) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 6. MÉTRICAS E LISTAGENS ADMIN: EXCLUIR CORTESIAS DO MRR E EXPOR PRAZOS
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_obter_metricas_assinaturas();
CREATE OR REPLACE FUNCTION public.admin_obter_metricas_assinaturas()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mrr_centavos BIGINT := 0;
  v_total_ativas INTEGER := 0;
  v_total_trial INTEGER := 0;
  v_total_cortesias INTEGER := 0;
  v_total_atrasadas INTEGER := 0;
  v_total_canceladas INTEGER := 0;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  -- MRR real considera APENAS assinaturas ativas de planos pagos que NÃO são cortesia
  SELECT COALESCE(SUM(valor_centavos), 0)::bigint INTO v_mrr_centavos
  FROM public.assinaturas
  WHERE status = 'ativa'
    AND plano != 'free'
    AND COALESCE(is_cortesia, false) = false;

  SELECT COUNT(*)::integer INTO v_total_ativas
  FROM public.assinaturas
  WHERE status = 'ativa'
    AND plano != 'free'
    AND COALESCE(is_cortesia, false) = false;

  SELECT COUNT(*)::integer INTO v_total_trial
  FROM public.assinaturas
  WHERE status = 'trial';

  SELECT COUNT(*)::integer INTO v_total_cortesias
  FROM public.assinaturas
  WHERE (status = 'cortesia' OR COALESCE(is_cortesia, false) = true)
    AND plano != 'free';

  SELECT COUNT(*)::integer INTO v_total_atrasadas
  FROM public.assinaturas
  WHERE status = 'atrasada';

  SELECT COUNT(*)::integer INTO v_total_canceladas
  FROM public.assinaturas
  WHERE status = 'cancelada';

  RETURN jsonb_build_object(
    'mrr_centavos', v_mrr_centavos,
    'mrr_reais', (v_mrr_centavos / 100.0),
    'total_ativas', v_total_ativas,
    'total_trial', v_total_trial,
    'total_cortesias', v_total_cortesias,
    'total_atrasadas', v_total_atrasadas,
    'total_canceladas', v_total_canceladas
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_obter_metricas_assinaturas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_obter_metricas_assinaturas() TO authenticated;

-- Listagem admin de assinaturas com campos de cortesia
DROP FUNCTION IF EXISTS public.admin_listar_assinaturas(text, text, integer, integer);
CREATE OR REPLACE FUNCTION public.admin_listar_assinaturas(
  p_status TEXT DEFAULT NULL,
  p_busca TEXT DEFAULT NULL,
  p_limite INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  tenant_id UUID,
  tenant_nome TEXT,
  dono_email TEXT,
  plano TEXT,
  status TEXT,
  forma_pagamento TEXT,
  valor_centavos INTEGER,
  trial_fim DATE,
  proximo_vencimento DATE,
  atraso_desde DATE,
  asaas_customer_id TEXT,
  asaas_subscription_id TEXT,
  created_at TIMESTAMPTZ,
  is_cortesia BOOLEAN,
  cortesia_ate DATE
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT
    a.id::uuid AS id,
    a.tenant_id::uuid AS tenant_id,
    COALESCE(t.nome, '')::text AS tenant_nome,
    COALESCE(u.email, '')::text AS dono_email,
    COALESCE(a.plano, 'free')::text AS plano,
    COALESCE(a.status, 'cancelada')::text AS status,
    a.forma_pagamento::text AS forma_pagamento,
    COALESCE(a.valor_centavos, 0)::integer AS valor_centavos,
    a.trial_fim::date AS trial_fim,
    a.proximo_vencimento::date AS proximo_vencimento,
    a.atraso_desde::date AS atraso_desde,
    a.asaas_customer_id::text AS asaas_customer_id,
    a.asaas_subscription_id::text AS asaas_subscription_id,
    a.created_at::timestamptz AS created_at,
    COALESCE(a.is_cortesia, a.status = 'cortesia')::boolean AS is_cortesia,
    a.cortesia_ate::date AS cortesia_ate
  FROM public.assinaturas a
  JOIN public.tenants t ON t.id = a.tenant_id
  LEFT JOIN LATERAL (
    SELECT m.user_id
    FROM public.tenant_members m
    WHERE m.tenant_id = t.id AND m.role = 'dono' AND m.status = 'ativo'
    ORDER BY m.created_at ASC
    LIMIT 1
  ) tm ON true
  LEFT JOIN auth.users u ON u.id = tm.user_id
  WHERE (
      p_status IS NULL
      OR p_status = ''
      OR (p_status = 'cortesia' AND (a.status = 'cortesia' OR COALESCE(a.is_cortesia, false) = true))
      OR (p_status <> 'cortesia' AND a.status = p_status)
    )
    AND (
      p_busca IS NULL
      OR p_busca = ''
      OR t.nome ILIKE '%' || p_busca || '%'
      OR u.email ILIKE '%' || p_busca || '%'
      OR a.asaas_customer_id ILIKE '%' || p_busca || '%'
    )
  ORDER BY a.created_at DESC
  LIMIT p_limite OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_listar_assinaturas(text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_listar_assinaturas(text, text, integer, integer) TO authenticated;

-- Listagem admin de oficinas com status de assinatura/cortesia/trial
DROP FUNCTION IF EXISTS public.admin_listar_tenants(text, text, integer, integer);
CREATE OR REPLACE FUNCTION public.admin_listar_tenants(
  p_busca TEXT DEFAULT NULL,
  p_plano TEXT DEFAULT NULL,
  p_limite INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  nome TEXT,
  slug TEXT,
  plano TEXT,
  cidade TEXT,
  uf TEXT,
  created_at TIMESTAMPTZ,
  total_membros BIGINT,
  total_clientes BIGINT,
  total_veiculos BIGINT,
  total_agendamentos BIGINT,
  total_execucoes BIGINT,
  ultimo_acesso TIMESTAMPTZ,
  agendamento_online_ativo BOOLEAN,
  assinatura_status TEXT,
  is_cortesia BOOLEAN,
  cortesia_ate DATE,
  trial_fim DATE,
  proximo_vencimento DATE
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT
    t.id::uuid,
    t.nome::text,
    t.slug::text,
    t.plano::text,
    t.cidade::text,
    t.uf::text,
    t.created_at::timestamptz,
    COALESCE(tm.cnt, 0)::BIGINT AS total_membros,
    COALESCE(tc.cnt, 0)::BIGINT AS total_clientes,
    COALESCE(tv.cnt, 0)::BIGINT AS total_veiculos,
    COALESCE(ta.cnt, 0)::BIGINT AS total_agendamentos,
    COALESCE(te.cnt, 0)::BIGINT AS total_execucoes,
    tm_last.max_sign_in::timestamptz AS ultimo_acesso,
    t.agendamento_online_ativo::boolean,
    COALESCE(a.status, CASE WHEN t.plano = 'free' THEN 'cancelada' ELSE 'trial' END)::text AS assinatura_status,
    COALESCE(a.is_cortesia, a.status = 'cortesia', false)::boolean AS is_cortesia,
    a.cortesia_ate::date AS cortesia_ate,
    a.trial_fim::date AS trial_fim,
    a.proximo_vencimento::date AS proximo_vencimento
  FROM public.tenants t
  LEFT JOIN public.assinaturas a ON a.tenant_id = t.id
  LEFT JOIN (
    SELECT tenant_id, COUNT(*) AS cnt
    FROM public.tenant_members
    WHERE status = 'ativo'
    GROUP BY tenant_id
  ) tm ON tm.tenant_id = t.id
  LEFT JOIN (
    SELECT
      m.tenant_id,
      MAX(
        GREATEST(
          COALESCE(u.last_sign_in_at, '1970-01-01 00:00:00+00'::timestamptz),
          COALESCE(p.last_seen_at, '1970-01-01 00:00:00+00'::timestamptz)
        )
      ) AS max_sign_in
    FROM public.tenant_members m
    JOIN auth.users u ON u.id = m.user_id
    LEFT JOIN public.profiles p ON p.id = m.user_id
    GROUP BY m.tenant_id
  ) tm_last ON tm_last.tenant_id = t.id
  LEFT JOIN (SELECT tenant_id, COUNT(*) AS cnt FROM public.clientes GROUP BY tenant_id) tc ON tc.tenant_id = t.id
  LEFT JOIN (SELECT tenant_id, COUNT(*) AS cnt FROM public.veiculos GROUP BY tenant_id) tv ON tv.tenant_id = t.id
  LEFT JOIN (SELECT tenant_id, COUNT(*) AS cnt FROM public.agendamentos GROUP BY tenant_id) ta ON ta.tenant_id = t.id
  LEFT JOIN (SELECT tenant_id, COUNT(*) AS cnt FROM public.execucoes GROUP BY tenant_id) te ON te.tenant_id = t.id
  WHERE (p_busca IS NULL OR p_busca = '' OR
         t.nome ILIKE '%' || p_busca || '%' OR
         t.slug ILIKE '%' || p_busca || '%' OR
         t.cidade ILIKE '%' || p_busca || '%')
    AND (p_plano IS NULL OR p_plano = '' OR t.plano = p_plano)
  ORDER BY t.created_at DESC
  LIMIT p_limite OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_listar_tenants(text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_listar_tenants(text, text, integer, integer) TO authenticated;

-- Detalhe admin de oficina com informações de assinatura/cortesia
DROP FUNCTION IF EXISTS public.admin_detalhe_tenant(UUID);
CREATE OR REPLACE FUNCTION public.admin_detalhe_tenant(p_tenant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant RECORD;
  v_ass RECORD;
  v_tem_ass BOOLEAN := false;
  v_ass_status TEXT;
  v_ass_is_cortesia BOOLEAN := false;
  v_ass_cortesia_ate DATE := NULL;
  v_ass_trial_fim DATE := NULL;
  v_ass_prox_venc DATE := NULL;
  v_ass_sub_id TEXT := NULL;
  v_membros JSONB;
  v_historico_12m JSONB;
  v_storage JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oficina não encontrada';
  END IF;

  SELECT * INTO v_ass FROM public.assinaturas WHERE tenant_id = p_tenant_id;
  v_tem_ass := FOUND;
  IF v_tem_ass THEN
    v_ass_status := v_ass.status;
    v_ass_is_cortesia := COALESCE(v_ass.is_cortesia, v_ass.status = 'cortesia', false);
    v_ass_cortesia_ate := v_ass.cortesia_ate;
    v_ass_trial_fim := v_ass.trial_fim;
    v_ass_prox_venc := v_ass.proximo_vencimento;
    v_ass_sub_id := v_ass.asaas_subscription_id;
  ELSE
    v_ass_status := CASE WHEN v_tenant.plano = 'free' THEN 'cancelada' ELSE 'trial' END;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', tm.id,
    'user_id', tm.user_id,
    'email', tm.email,
    'nome', COALESCE(p.nome, u.raw_user_meta_data->>'nome', tm.email),
    'telefone', COALESCE(p.telefone, u.raw_user_meta_data->>'telefone', null),
    'role', tm.role,
    'status', tm.status,
    'ultimo_acesso', GREATEST(
      COALESCE(u.last_sign_in_at, '1970-01-01 00:00:00+00'::timestamptz),
      COALESCE(p.last_seen_at, '1970-01-01 00:00:00+00'::timestamptz)
    )
  )), '[]'::jsonb)
  INTO v_membros
  FROM public.tenant_members tm
  LEFT JOIN public.profiles p ON p.id = tm.user_id
  LEFT JOIN auth.users u ON u.id = tm.user_id
  WHERE tm.tenant_id = p_tenant_id;

  WITH meses AS (
    SELECT generate_series(
      date_trunc('month', now() - interval '11 months'),
      date_trunc('month', now()),
      interval '1 month'
    )::date AS mes
  ),
  ag AS (
    SELECT date_trunc('month', created_at)::date AS mes, COUNT(*) AS cnt
    FROM public.agendamentos
    WHERE tenant_id = p_tenant_id AND created_at >= (now() - interval '12 months')
    GROUP BY 1
  ),
  ex AS (
    SELECT date_trunc('month', iniciado_em)::date AS mes, COUNT(*) AS cnt
    FROM public.execucoes
    WHERE tenant_id = p_tenant_id AND status = 'finalizado' AND iniciado_em >= (now() - interval '12 months')
    GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'mes', to_char(m.mes, 'YYYY-MM'),
    'agendamentos_criados', COALESCE(ag.cnt, 0),
    'execucoes_finalizadas', COALESCE(ex.cnt, 0)
  ) ORDER BY m.mes ASC), '[]'::jsonb)
  INTO v_historico_12m
  FROM meses m
  LEFT JOIN ag ON ag.mes = m.mes
  LEFT JOIN ex ON ex.mes = m.mes;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'bucket', bucket,
    'total_arquivos', total_arquivos,
    'total_bytes', total_bytes,
    'calculado_em', calculado_em
  )), '[]'::jsonb)
  INTO v_storage
  FROM public.storage_uso_snapshot
  WHERE tenant_id = p_tenant_id
    AND calculado_em = (SELECT MAX(calculado_em) FROM public.storage_uso_snapshot WHERE tenant_id = p_tenant_id);

  RETURN jsonb_build_object(
    'tenant', jsonb_build_object(
      'id', v_tenant.id,
      'nome', v_tenant.nome,
      'slug', v_tenant.slug,
      'plano', v_tenant.plano,
      'cidade', v_tenant.cidade,
      'uf', v_tenant.uf,
      'created_at', v_tenant.created_at,
      'nome_alterado_em', v_tenant.nome_alterado_em,
      'agendamento_online_ativo', v_tenant.agendamento_online_ativo,
      'assinatura_status', v_ass_status,
      'is_cortesia', v_ass_is_cortesia,
      'cortesia_ate', v_ass_cortesia_ate,
      'trial_fim', v_ass_trial_fim,
      'proximo_vencimento', v_ass_prox_venc,
      'asaas_subscription_id', v_ass_sub_id
    ),
    'membros', v_membros,
    'historico_12m', v_historico_12m,
    'storage', COALESCE(v_storage, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_detalhe_tenant(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_detalhe_tenant(UUID) TO authenticated;

-- ------------------------------------------------------------------------------
-- 7. ENDURECER admin_registrar_pagamento_manual_competencia & LIMPAR CORTESIA
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_registrar_pagamento_manual_competencia(UUID, DATE, INTEGER);
DROP FUNCTION IF EXISTS public.admin_registrar_pagamento_manual_competencia(UUID, DATE);

CREATE OR REPLACE FUNCTION public.admin_registrar_pagamento_manual_competencia(
  p_tenant_id UUID,
  p_competencia DATE,
  p_valor_pago_centavos INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_valor INTEGER;
  v_comp DATE := date_trunc('month', p_competencia)::date;
  v_res_parceiro JSONB;
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores editores da plataforma podem registrar pagamentos manuais.';
  END IF;

  IF p_valor_pago_centavos IS NOT NULL AND p_valor_pago_centavos > 0 THEN
    v_valor := p_valor_pago_centavos;
  ELSE
    SELECT COALESCE(
      CASE WHEN a.ciclo = 'anual' AND p.preco_anual_centavos > 0 THEN p.preco_anual_centavos ELSE p.preco_centavos END,
      p.preco_centavos
    ) INTO v_valor
    FROM public.assinaturas a
    JOIN public.plans p ON p.codigo = a.plano
    WHERE a.tenant_id = p_tenant_id
    LIMIT 1;

    IF v_valor IS NULL THEN
      SELECT preco_centavos INTO v_valor FROM public.plans WHERE codigo = 'pro' LIMIT 1;
    END IF;
  END IF;

  INSERT INTO public.pagamentos_competencia (tenant_id, competencia, valor_pago_centavos, confirmado_por, confirmado_em)
  VALUES (p_tenant_id, v_comp, v_valor, auth.uid(), NOW())
  ON CONFLICT (tenant_id, competencia)
  DO UPDATE SET valor_pago_centavos = EXCLUDED.valor_pago_centavos, confirmado_em = NOW(), confirmado_por = auth.uid();

  UPDATE public.assinaturas
  SET status = 'ativa',
      plano = CASE WHEN COALESCE(plano, 'free') = 'free' THEN COALESCE(NULLIF(plano_pendente, 'free'), 'pro') ELSE plano END,
      plano_pendente = NULL,
      is_cortesia = false,
      cortesia_ate = NULL,
      atraso_desde = NULL,
      trial_fim = NULL,
      cancelada_em = NULL,
      valor_centavos = v_valor,
      proximo_vencimento = (v_comp + INTERVAL '1 month' - INTERVAL '1 day')::date,
      updated_at = NOW()
  WHERE tenant_id = p_tenant_id;

  UPDATE public.tenants
  SET plano = CASE
        WHEN plano = 'free' THEN COALESCE((SELECT NULLIF(a.plano, 'free') FROM public.assinaturas a WHERE a.tenant_id = p_tenant_id), 'pro')
        ELSE plano
      END,
      updated_at = NOW()
  WHERE id = p_tenant_id;

  PERFORM public.processar_conversao_indicacao(p_tenant_id);

  SELECT public.processar_pagamento_asaas_parceiro(p_tenant_id, v_valor, v_comp) INTO v_res_parceiro;

  RETURN jsonb_build_object(
    'sucesso', true,
    'tenant_id', p_tenant_id,
    'competencia', v_comp,
    'valor_pago_centavos', v_valor,
    'comissao_parceiro', v_res_parceiro
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_registrar_pagamento_manual_competencia(UUID, DATE, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_registrar_pagamento_manual_competencia(UUID, DATE, INTEGER) TO authenticated, service_role;

-- Blindar helpers internos de comissão/indicação contra chamada direta por usuários comuns
REVOKE ALL ON FUNCTION public.processar_pagamento_asaas_parceiro(UUID, INTEGER, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.processar_pagamento_asaas_parceiro(UUID, INTEGER, DATE) TO service_role;

REVOKE ALL ON FUNCTION public.processar_conversao_indicacao(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.processar_conversao_indicacao(UUID) TO service_role;

-- ------------------------------------------------------------------------------
-- 8. CORRIGIR criar_oficina PARA USAR FUSO AMERICA/SAO_PAULO NO TRIAL_FIM
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.criar_oficina(text, text, text, text);
DROP FUNCTION IF EXISTS public.criar_oficina(text, text, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.criar_oficina(
  p_nome text,
  p_cidade text DEFAULT NULL,
  p_uf text DEFAULT NULL,
  p_telefone text DEFAULT NULL,
  p_codigo_indicacao text DEFAULT NULL,
  p_codigo_parceiro text DEFAULT NULL,
  p_codigo_campanha text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID;
  v_nome_limpo TEXT;
  v_slug TEXT;
  v_parceiro RECORD;
  v_indicador RECORD;
  v_codigo_proprio TEXT;
  v_indicado_email TEXT;
  v_indicador_email TEXT;
  v_indicador_tel TEXT;
  v_indicador_doc TEXT;
  v_hoje DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  v_trial_ativo_config BOOLEAN := true;
  v_dias_trial_config INTEGER := 15;
  v_plano_inicial TEXT := 'pro';
  v_status_inicial TEXT := 'trial';
  v_dias_trial_concedidos INTEGER := 15;
  v_trial_fim DATE;
  v_valor_centavos INTEGER := 5700;

  v_campanha RECORD;
  v_campanha_usada TEXT := NULL;
BEGIN
  v_nome_limpo := TRIM(COALESCE(p_nome, ''));
  IF v_nome_limpo = '' OR LENGTH(v_nome_limpo) < 2 THEN
    RAISE EXCEPTION 'Informe o nome da oficina (mínimo 2 caracteres).';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  BEGIN
    SELECT
      COALESCE(trial_cadastro_ativo, trial_ativo, true),
      COALESCE(trial_dias_padrao, trial_dias, 15)
    INTO
      v_trial_ativo_config,
      v_dias_trial_config
    FROM public.plataforma_config
    WHERE id = 1;
  EXCEPTION WHEN OTHERS THEN
    v_trial_ativo_config := true;
    v_dias_trial_config := 15;
  END;

  IF v_dias_trial_config IS NULL OR v_dias_trial_config <= 0 THEN
    v_dias_trial_config := 15;
  END IF;

  IF p_codigo_campanha IS NOT NULL AND trim(p_codigo_campanha) != '' THEN
    BEGIN
      SELECT * INTO v_campanha
      FROM public.campanhas_lancamento
      WHERE upper(trim(codigo)) = upper(trim(p_codigo_campanha))
        AND ativo = true
        AND (expira_em IS NULL OR expira_em > now())
        AND (limite_usos IS NULL OR total_usos < limite_usos)
      LIMIT 1;

      IF FOUND THEN
        v_campanha_usada := v_campanha.codigo;
        v_plano_inicial := COALESCE(v_campanha.plano_concedido, 'pro');
        v_status_inicial := 'trial';
        v_dias_trial_concedidos := COALESCE(v_campanha.dias_trial, v_dias_trial_config);
        v_trial_fim := (v_hoje + v_dias_trial_concedidos);
        v_valor_centavos := v_campanha.valor_mensal_centavos;

        UPDATE public.campanhas_lancamento
        SET total_usos = total_usos + 1,
            updated_at = now()
        WHERE id = v_campanha.id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_campanha_usada := NULL;
    END;
  END IF;

  IF v_campanha_usada IS NULL THEN
    IF NOT v_trial_ativo_config THEN
      v_plano_inicial := 'free';
      v_status_inicial := 'cancelada';
      v_dias_trial_concedidos := 0;
      v_trial_fim := NULL;
      v_valor_centavos := 0;
    ELSE
      v_plano_inicial := 'pro';
      v_status_inicial := 'trial';
      v_dias_trial_concedidos := v_dias_trial_config;
      v_trial_fim := (v_hoje + v_dias_trial_concedidos);

      SELECT preco_centavos INTO v_valor_centavos
      FROM public.plans
      WHERE codigo = v_plano_inicial;

      IF v_valor_centavos IS NULL THEN
        v_valor_centavos := 5700;
      END IF;
    END IF;
  END IF;

  v_slug := public.gerar_slug_oficina(v_nome_limpo);
  v_codigo_proprio := public.gerar_codigo_indicacao_unico();

  INSERT INTO public.tenants (
    nome, slug, cidade, uf, telefone, criado_por, plano, codigo_indicacao
  ) VALUES (
    v_nome_limpo, v_slug, p_cidade, p_uf, p_telefone, auth.uid(), v_plano_inicial, v_codigo_proprio
  ) RETURNING id INTO v_tenant;

  INSERT INTO public.tenant_members (tenant_id, user_id, email, role, status)
  VALUES (
    v_tenant,
    auth.uid(),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    'dono',
    'ativo'
  );

  INSERT INTO public.assinaturas (
    tenant_id, plano, status, ciclo, valor_centavos, trial_fim, is_cortesia, cortesia_ate, created_at, updated_at
  ) VALUES (
    v_tenant, v_plano_inicial, v_status_inicial, 'mensal', v_valor_centavos, v_trial_fim, false, NULL, now(), now()
  ) ON CONFLICT (tenant_id) DO UPDATE
  SET plano = EXCLUDED.plano,
      status = EXCLUDED.status,
      valor_centavos = EXCLUDED.valor_centavos,
      trial_fim = EXCLUDED.trial_fim,
      is_cortesia = false,
      cortesia_ate = NULL,
      updated_at = now();

  INSERT INTO public.categorias_veiculo (tenant_id, nome, ordem, ativo) VALUES
    (v_tenant, 'Hatch Pequeno', 1, true),
    (v_tenant, 'Sedan Médio', 2, true),
    (v_tenant, 'SUV / Caminhonete', 3, true),
    (v_tenant, 'Esportivo / Coupe', 4, true),
    (v_tenant, 'Moto', 5, true);

  BEGIN
    INSERT INTO public.tenant_formas_pagamento (tenant_id, nome, tipo, taxa_padrao, ativo, ordem) VALUES
      (v_tenant, 'Dinheiro', 'dinheiro', 0.00, true, 1),
      (v_tenant, 'PIX', 'pix', 0.00, true, 2),
      (v_tenant, 'Cartão de Débito', 'debito', 1.99, true, 3),
      (v_tenant, 'Cartão de Crédito à Vista', 'credito_vista', 3.49, true, 4);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  IF NOT EXISTS (SELECT 1 FROM public.tenant_maquininhas WHERE tenant_id = v_tenant AND padrao = true) THEN
    INSERT INTO public.tenant_maquininhas (tenant_id, nome, padrao, ordem)
    VALUES (v_tenant, 'Maquininha Padrão', true, 1);
  END IF;

  PERFORM public.seed_horarios_funcionamento_tenant(v_tenant);
  PERFORM public.seed_servicos_iniciais_tenant(v_tenant);

  BEGIN
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
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
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
          v_nome_limpo,
          v_indicado_email,
          v_indicador_email,
          v_indicador_tel,
          v_indicador_doc
        ) ON CONFLICT (indicado_tenant_id) DO NOTHING;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    PERFORM public.notificar_admin(
      'nova_oficina',
      'Nova Oficina Cadastrada: ' || v_nome_limpo,
      'A oficina "' || v_nome_limpo || '" (' || coalesce(p_cidade, 'Sem cidade') || '/' || coalesce(p_uf, 'UF') || ') acabou de se cadastrar no plano ' || upper(v_plano_inicial) || '.',
      '/admin/oficinas',
      jsonb_build_object('tenant_id', v_tenant, 'nome', v_nome_limpo, 'plano', v_plano_inicial, 'trial_fim', v_trial_fim, 'campanha', v_campanha_usada)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_tenant;
END;
$function$;

REVOKE ALL ON FUNCTION public.criar_oficina(text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_oficina(text, text, text, text, text, text, text) TO authenticated;

-- ------------------------------------------------------------------------------
-- 9. ROTINA DIÁRIA DE REBAIXAMENTO COMPLETA + GATEWAY ADMIN + PG_CRON
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.processar_rotina_diaria_assinaturas();
CREATE OR REPLACE FUNCTION public.processar_rotina_diaria_assinaturas()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hoje DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_rec RECORD;
  v_count_trial_rebaixados INTEGER := 0;
  v_count_cortesia_rebaixados INTEGER := 0;
  v_count_atraso_rebaixados INTEGER := 0;
  v_count_cancelado_rebaixados INTEGER := 0;
  v_count_orfaos_corrigidos INTEGER := 0;
  v_count_notificacoes_expurgadas INTEGER := 0;
  v_actor UUID := COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
BEGIN
  IF NOT (
    auth.role() = 'service_role'
    OR session_user IN ('postgres', 'supabase_admin')
    OR public.is_platform_admin_editor()
  ) THEN
    RAISE EXCEPTION 'Acesso negado: rotina exclusiva do agendador do sistema ou administrador editor.';
  END IF;

  -- 0. Normalizar registros inconsistentes onde plano já é 'free', mas status ficou 'ativa' ou 'cortesia'
  UPDATE public.assinaturas
  SET status = 'cancelada',
      is_cortesia = false,
      cortesia_ate = NULL,
      valor_centavos = 0,
      updated_at = now()
  WHERE plano = 'free'
    AND (status IN ('ativa', 'cortesia') OR COALESCE(is_cortesia, false) = true OR valor_centavos > 0);

  -- 1. Rebaixar Trials Vencidos (inclui legados sem trial_fim > 15 dias e checkouts nunca pagos)
  FOR v_rec IN
    SELECT a.id, a.tenant_id, a.plano, a.trial_fim, a.created_at, t.nome AS tenant_nome
    FROM public.assinaturas a
    JOIN public.tenants t ON t.id = a.tenant_id
    WHERE a.status = 'trial'
      AND (
        (a.trial_fim IS NOT NULL AND a.trial_fim <= v_hoje)
        OR (a.trial_fim IS NULL AND (a.created_at AT TIME ZONE 'America/Sao_Paulo')::date <= (v_hoje - 15))
      )
  LOOP
    UPDATE public.tenants
    SET plano = 'free', updated_at = now()
    WHERE id = v_rec.tenant_id;

    UPDATE public.assinaturas
    SET plano = 'free',
        status = 'cancelada',
        is_cortesia = false,
        cortesia_ate = NULL,
        valor_centavos = 0,
        cancelada_em = COALESCE(cancelada_em, now()),
        url_pagamento_asaas = NULL,
        updated_at = now()
    WHERE id = v_rec.id;

    BEGIN
      INSERT INTO public.admin_auditoria (
        admin_user_id, acao, entidade, entidade_id, valor_anterior, valor_novo
      ) VALUES (
        v_actor,
        'trial_expirado_rebaixado_free',
        'tenants',
        v_rec.tenant_id::text,
        jsonb_build_object('plano', v_rec.plano, 'status', 'trial', 'trial_fim', v_rec.trial_fim),
        jsonb_build_object('plano', 'free', 'status', 'cancelada')
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
      PERFORM public.criar_notificacao_interna(
        v_rec.tenant_id,
        NULL,
        'admin',
        'operador',
        'downgrade_oficina',
        '📉 Fim de Trial: Oficina Rebaixada',
        'A oficina "' || v_rec.tenant_nome || '" encerrou o período de degustação e foi migrada para o plano Free.',
        '/admin/assinaturas',
        jsonb_build_object('tenant_id', v_rec.tenant_id, 'motivo', 'trial_expirado')
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    v_count_trial_rebaixados := v_count_trial_rebaixados + 1;
  END LOOP;

  -- 2. Rebaixar Cortesias Temporárias Vencidas
  FOR v_rec IN
    SELECT a.id, a.tenant_id, a.plano, a.cortesia_ate, a.status, t.nome AS tenant_nome
    FROM public.assinaturas a
    JOIN public.tenants t ON t.id = a.tenant_id
    WHERE (a.status = 'cortesia' OR COALESCE(a.is_cortesia, false) = true)
      AND a.cortesia_ate IS NOT NULL
      AND a.cortesia_ate <= v_hoje
  LOOP
    UPDATE public.tenants
    SET plano = 'free', updated_at = now()
    WHERE id = v_rec.tenant_id;

    UPDATE public.assinaturas
    SET plano = 'free',
        status = 'cancelada',
        is_cortesia = false,
        cortesia_ate = NULL,
        valor_centavos = 0,
        cancelada_em = now(),
        url_pagamento_asaas = NULL,
        updated_at = now()
    WHERE id = v_rec.id;

    BEGIN
      INSERT INTO public.admin_auditoria (
        admin_user_id, acao, entidade, entidade_id, valor_anterior, valor_novo
      ) VALUES (
        v_actor,
        'cortesia_expirada_rebaixado_free',
        'tenants',
        v_rec.tenant_id::text,
        jsonb_build_object('plano', v_rec.plano, 'status', v_rec.status, 'cortesia_ate', v_rec.cortesia_ate),
        jsonb_build_object('plano', 'free', 'status', 'cancelada')
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
      PERFORM public.criar_notificacao_interna(
        v_rec.tenant_id,
        NULL,
        'admin',
        'operador',
        'downgrade_oficina',
        '⏳ Fim de Cortesia: Oficina Rebaixada',
        'O período de cortesia da oficina "' || v_rec.tenant_nome || '" encerrou em ' || to_char(v_rec.cortesia_ate, 'DD/MM/YYYY') || ' e o plano retornou para Free.',
        '/admin/assinaturas',
        jsonb_build_object('tenant_id', v_rec.tenant_id, 'motivo', 'cortesia_expirada', 'cortesia_ate', v_rec.cortesia_ate)
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    v_count_cortesia_rebaixados := v_count_cortesia_rebaixados + 1;
  END LOOP;

  -- 3. Rebaixar Assinaturas em Atraso há 5 dias ou mais
  FOR v_rec IN
    SELECT a.id, a.tenant_id, a.plano, a.atraso_desde, t.nome AS tenant_nome
    FROM public.assinaturas a
    JOIN public.tenants t ON t.id = a.tenant_id
    WHERE a.status = 'atrasada'
      AND COALESCE(a.is_cortesia, false) = false
      AND a.atraso_desde IS NOT NULL
      AND a.atraso_desde <= (v_hoje - 5)
  LOOP
    UPDATE public.tenants
    SET plano = 'free', updated_at = now()
    WHERE id = v_rec.tenant_id;

    UPDATE public.assinaturas
    SET plano = 'free',
        status = 'cancelada',
        valor_centavos = 0,
        cancelada_em = COALESCE(cancelada_em, now()),
        updated_at = now()
    WHERE id = v_rec.id;

    BEGIN
      INSERT INTO public.admin_auditoria (
        admin_user_id, acao, entidade, entidade_id, valor_anterior, valor_novo
      ) VALUES (
        v_actor,
        'inadimplencia_5dias_rebaixado_free',
        'tenants',
        v_rec.tenant_id::text,
        jsonb_build_object('plano', v_rec.plano, 'atraso_desde', v_rec.atraso_desde),
        jsonb_build_object('plano', 'free', 'status', 'cancelada')
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
      PERFORM public.criar_notificacao_interna(
        v_rec.tenant_id,
        NULL,
        'admin',
        'operador',
        'downgrade_oficina',
        '⚠️ Inadimplência: Oficina Rebaixada',
        'A oficina "' || v_rec.tenant_nome || '" teve sua assinatura rebaixada para Free após 5 dias de atraso.',
        '/admin/assinaturas',
        jsonb_build_object('tenant_id', v_rec.tenant_id, 'motivo', 'inadimplencia_5dias')
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    v_count_atraso_rebaixados := v_count_atraso_rebaixados + 1;
  END LOOP;

  -- 4. Rebaixar assinaturas canceladas cujo ciclo pago (proximo_vencimento) já terminou
  FOR v_rec IN
    SELECT a.id, a.tenant_id, a.plano, a.proximo_vencimento, t.nome AS tenant_nome
    FROM public.assinaturas a
    JOIN public.tenants t ON t.id = a.tenant_id
    WHERE a.cancelada_em IS NOT NULL
      AND a.asaas_subscription_id IS NULL
      AND COALESCE(a.is_cortesia, false) = false
      AND (t.plano != 'free' OR a.plano != 'free')
      AND a.status IN ('ativa', 'cancelada')
      AND (a.proximo_vencimento IS NULL OR a.proximo_vencimento < v_hoje)
  LOOP
    UPDATE public.tenants
    SET plano = 'free', updated_at = now()
    WHERE id = v_rec.tenant_id;

    UPDATE public.assinaturas
    SET plano = 'free',
        status = 'cancelada',
        valor_centavos = 0,
        updated_at = now()
    WHERE id = v_rec.id;

    BEGIN
      INSERT INTO public.admin_auditoria (
        admin_user_id, acao, entidade, entidade_id, valor_anterior, valor_novo
      ) VALUES (
        v_actor,
        'ciclo_cancelado_encerrado_rebaixado_free',
        'tenants',
        v_rec.tenant_id::text,
        jsonb_build_object('plano', v_rec.plano, 'proximo_vencimento', v_rec.proximo_vencimento),
        jsonb_build_object('plano', 'free', 'status', 'cancelada')
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    v_count_cancelado_rebaixados := v_count_cancelado_rebaixados + 1;
  END LOOP;

  -- 5. Corrigir oficinas órfãs (plano pago no tenant sem registro correspondente em assinaturas ou em dessincronia)
  FOR v_rec IN
    SELECT t.id AS tenant_id, t.nome AS tenant_nome, t.plano, t.created_at
    FROM public.tenants t
    WHERE NOT EXISTS (SELECT 1 FROM public.assinaturas a WHERE a.tenant_id = t.id)
  LOOP
    IF v_rec.plano = 'free' THEN
      INSERT INTO public.assinaturas (tenant_id, plano, status, ciclo, valor_centavos, is_cortesia, cancelada_em)
      VALUES (v_rec.tenant_id, 'free', 'cancelada', 'mensal', 0, false, now())
      ON CONFLICT (tenant_id) DO NOTHING;
    ELSIF (v_rec.created_at AT TIME ZONE 'America/Sao_Paulo')::date <= (v_hoje - 15) THEN
      UPDATE public.tenants SET plano = 'free', updated_at = now() WHERE id = v_rec.tenant_id;
      INSERT INTO public.assinaturas (tenant_id, plano, status, ciclo, valor_centavos, is_cortesia, cancelada_em)
      VALUES (v_rec.tenant_id, 'free', 'cancelada', 'mensal', 0, false, now())
      ON CONFLICT (tenant_id) DO NOTHING;
      v_count_orfaos_corrigidos := v_count_orfaos_corrigidos + 1;
    ELSE
      INSERT INTO public.assinaturas (tenant_id, plano, status, ciclo, valor_centavos, trial_fim, is_cortesia)
      VALUES (
        v_rec.tenant_id,
        v_rec.plano,
        'trial',
        'mensal',
        COALESCE((SELECT preco_centavos FROM public.plans WHERE codigo = v_rec.plano LIMIT 1), 0),
        (v_rec.created_at AT TIME ZONE 'America/Sao_Paulo')::date + 15,
        false
      )
      ON CONFLICT (tenant_id) DO NOTHING;
      v_count_orfaos_corrigidos := v_count_orfaos_corrigidos + 1;
    END IF;
  END LOOP;

  -- 5.1 Sincronizar tenants cujo plano divergiu de assinaturas canceladas em 'free'
  UPDATE public.tenants t
  SET plano = 'free', updated_at = now()
  FROM public.assinaturas a
  WHERE a.tenant_id = t.id
    AND a.plano = 'free'
    AND a.status = 'cancelada'
    AND t.plano != 'free';

  -- 6. Expurgo de notificações lidas com mais de 90 dias
  WITH deleted AS (
    DELETE FROM public.notificacoes
    WHERE lida = true
      AND lida_em < (now() - INTERVAL '90 days')
    RETURNING id
  )
  SELECT COUNT(*)::integer INTO v_count_notificacoes_expurgadas FROM deleted;

  RETURN jsonb_build_object(
    'processado_em', now(),
    'data_referencia_brt', v_hoje,
    'trial_rebaixados', v_count_trial_rebaixados,
    'cortesia_rebaixados', v_count_cortesia_rebaixados,
    'atraso_rebaixados', v_count_atraso_rebaixados,
    'cancelado_rebaixados', v_count_cancelado_rebaixados,
    'orfaos_corrigidos', v_count_orfaos_corrigidos,
    'notificacoes_expurgadas_90d', v_count_notificacoes_expurgadas
  );
END;
$$;

REVOKE ALL ON FUNCTION public.processar_rotina_diaria_assinaturas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.processar_rotina_diaria_assinaturas() TO service_role;

-- Wrapper seguro para acionamento manual pelo Admin no painel
DROP FUNCTION IF EXISTS public.admin_executar_rotina_assinaturas();
CREATE OR REPLACE FUNCTION public.admin_executar_rotina_assinaturas()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores editores podem executar a rotina de verificação.';
  END IF;

  RETURN public.processar_rotina_diaria_assinaturas();
END;
$$;

REVOKE ALL ON FUNCTION public.admin_executar_rotina_assinaturas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_executar_rotina_assinaturas() TO authenticated;

-- ------------------------------------------------------------------------------
-- 10. AGENDAR ROTINA DIÁRIA NO PG_CRON + EXECUTAR VARREDURA RETROATIVA IMEDIATA
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rotina-diaria-assinaturas') THEN
      PERFORM cron.unschedule('rotina-diaria-assinaturas');
    END IF;

    -- Executa diariamente às 06:05 UTC (03:05 Horário de Brasília)
    PERFORM cron.schedule(
      'rotina-diaria-assinaturas',
      '5 6 * * *',
      'SELECT public.processar_rotina_diaria_assinaturas();'
    );
  END IF;
END;
$$;

-- Executa varredura imediata na aplicação da migração para rebaixar trials/atrasos expirados pendentes
DO $$
BEGIN
  PERFORM public.processar_rotina_diaria_assinaturas();
END;
$$;

NOTIFY pgrst, 'reload schema';
