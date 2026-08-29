-- ==============================================================================
-- MIGRAÇÃO 0066: ESTRUTURA DE ASSINATURAS (ASAAS), TRIAL 14 DIAS E TERMOS LEGAIS
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ATUALIZAÇÃO DE PREÇOS DOS PLANOS (PARTE 0)
-- ------------------------------------------------------------------------------
UPDATE public.plans SET preco_centavos = 0 WHERE codigo::text = 'free';
UPDATE public.plans SET preco_centavos = 6700 WHERE codigo::text = 'pro';
UPDATE public.plans SET preco_centavos = 14700 WHERE codigo::text = 'studio';

-- ------------------------------------------------------------------------------
-- 2. TABELA DE HISTÓRICO DE ACEITE DOS TERMOS (ACEITES_TERMOS) (AJUSTE 5)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aceites_termos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  versao_documento TEXT NOT NULL DEFAULT 'v1.0-2026-08',
  tipo_documento TEXT NOT NULL DEFAULT 'ambos' CHECK (tipo_documento IN ('termos_uso', 'politica_privacidade', 'ambos')),
  ip_address TEXT NULL,
  user_agent TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.aceites_termos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Membros leem aceites do proprio tenant" ON public.aceites_termos;
CREATE POLICY "Membros leem aceites do proprio tenant" ON public.aceites_termos
  FOR SELECT USING (
    tenant_id IN (SELECT public.meus_tenants()) OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS "Membros criam aceites no proprio tenant" ON public.aceites_termos;
CREATE POLICY "Membros criam aceites no proprio tenant" ON public.aceites_termos
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT public.meus_tenants())
  );

-- ------------------------------------------------------------------------------
-- 3. TABELA DE ASSINATURAS E EVENTOS DE WEBHOOK (PARTES 1 E 3)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assinaturas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID UNIQUE NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  asaas_customer_id TEXT NULL,
  asaas_subscription_id TEXT NULL,
  plano TEXT NOT NULL REFERENCES public.plans(codigo),
  status TEXT NOT NULL DEFAULT 'trial' CHECK (status IN ('trial', 'ativa', 'atrasada', 'cancelada')),
  forma_pagamento TEXT NULL CHECK (forma_pagamento IN ('cartao', 'pix')),
  valor_centavos INTEGER NOT NULL DEFAULT 0,
  trial_fim DATE NULL,
  proximo_vencimento DATE NULL,
  atraso_desde DATE NULL,
  url_pagamento_asaas TEXT NULL,
  cancelada_em TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.assinaturas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Assinatura visivel para membros do tenant ou admin" ON public.assinaturas;
CREATE POLICY "Assinatura visivel para membros do tenant ou admin" ON public.assinaturas
  FOR SELECT USING (
    tenant_id IN (SELECT public.meus_tenants()) OR public.is_platform_admin()
  );

-- Sem política de INSERT/UPDATE/DELETE para clientes (apenas via RPC/Security Definer/Service Role)

-- Tabela de Eventos do Webhook (tenant_id aceita NULL conforme Ajuste Menor)
CREATE TABLE IF NOT EXISTS public.assinatura_eventos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NULL REFERENCES public.tenants(id) ON DELETE SET NULL,
  asaas_event_id TEXT UNIQUE NOT NULL,
  tipo TEXT NOT NULL,
  payload JSONB NOT NULL,
  processado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.assinatura_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Eventos de assinatura visiveis para admins" ON public.assinatura_eventos;
CREATE POLICY "Eventos de assinatura visiveis para admins" ON public.assinatura_eventos
  FOR SELECT USING (public.is_platform_admin());

-- ------------------------------------------------------------------------------
-- 4. BACKFILL DE ASSINATURAS PARA OFICINAS EXISTENTES (AJUSTE 3)
-- ------------------------------------------------------------------------------
INSERT INTO public.assinaturas (tenant_id, plano, status, valor_centavos, created_at, updated_at)
SELECT 
  id AS tenant_id,
  plano::text AS plano,
  'ativa' AS status,
  (CASE 
    WHEN plano::text = 'pro' THEN 6700 
    WHEN plano::text = 'studio' THEN 14700 
    ELSE 0 
  END) AS valor_centavos,
  now() AS created_at,
  now() AS updated_at
FROM public.tenants
ON CONFLICT (tenant_id) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 5. ATUALIZAÇÃO DA RPC CRIAR_OFICINA (PARTE 2 — TRIAL DE 14 DIAS NO PRO)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.criar_oficina(
  p_nome text, p_cidade text, p_uf text, p_telefone text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE 
  v_tenant uuid; 
  v_slug text;
  v_trial_fim date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF coalesce(trim(p_nome), '') = '' THEN
    RAISE EXCEPTION 'Informe o nome da oficina.';
  END IF;

  IF (
    SELECT count(*) FROM tenant_members
    WHERE user_id = auth.uid() AND role = 'dono' AND status IN ('ativo', 'convidado')
  ) >= 3 THEN
    RAISE EXCEPTION 'Limite de oficinas por usuário atingido.';
  END IF;

  v_slug := lower(regexp_replace(p_nome, '[^a-zA-Z0-9]+', '-', 'g'))
            || '-' || substr(gen_random_uuid()::text, 1, 6);

  -- Oficinas novas entram no plano Pro em modo Trial por 14 dias no fuso de São Paulo
  v_trial_fim := (now() AT TIME ZONE 'America/Sao_Paulo')::date + 14;

  INSERT INTO tenants (nome, slug, cidade, uf, telefone, criado_por, plano)
    VALUES (p_nome, v_slug, p_cidade, p_uf, p_telefone, auth.uid(), 'pro')
    RETURNING id INTO v_tenant;

  INSERT INTO tenant_members (tenant_id, user_id, email, role, status)
    VALUES (
      v_tenant, 
      auth.uid(),
      (SELECT email FROM auth.users WHERE id = auth.uid()),
      'dono', 
      'ativo'
    );

  -- Registrar assinatura em estado de Trial
  INSERT INTO public.assinaturas (
    tenant_id, plano, status, valor_centavos, trial_fim
  ) VALUES (
    v_tenant, 'pro', 'trial', 6700, v_trial_fim
  ) ON CONFLICT (tenant_id) DO NOTHING;

  RETURN v_tenant;
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. RPC DE CONSULTA DE ASSINATURA DO TENANT
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.obter_assinatura_tenant(uuid);
CREATE OR REPLACE FUNCTION public.obter_assinatura_tenant(p_tenant_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_ass RECORD;
  v_hoje DATE;
  v_dias_trial INTEGER := 0;
  v_dias_atraso INTEGER := 0;
  v_dias_para_rebaixamento INTEGER := 0;
BEGIN
  v_tenant_id := COALESCE(p_tenant_id, (SELECT public.meus_tenants() LIMIT 1));
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('existe', false);
  END IF;

  SELECT * INTO v_ass FROM public.assinaturas WHERE tenant_id = v_tenant_id;
  IF NOT FOUND THEN
    -- Fallback se porventura não houver registro
    SELECT plano INTO v_ass FROM public.tenants WHERE id = v_tenant_id;
    RETURN jsonb_build_object(
      'existe', false,
      'plano', COALESCE(v_ass.plano::text, 'free'),
      'status', 'ativa'
    );
  END IF;

  v_hoje := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  IF v_ass.status = 'trial' AND v_ass.trial_fim IS NOT NULL THEN
    v_dias_trial := v_ass.trial_fim - v_hoje;
    IF v_dias_trial < 0 THEN v_dias_trial := 0; END IF;
  END IF;

  IF v_ass.status = 'atrasada' AND v_ass.atraso_desde IS NOT NULL THEN
    v_dias_atraso := v_hoje - v_ass.atraso_desde;
    v_dias_para_rebaixamento := 5 - v_dias_atraso;
    IF v_dias_para_rebaixamento < 0 THEN v_dias_para_rebaixamento := 0; END IF;
  END IF;

  RETURN jsonb_build_object(
    'existe', true,
    'id', v_ass.id,
    'tenant_id', v_ass.tenant_id,
    'plano', v_ass.plano,
    'status', v_ass.status,
    'forma_pagamento', v_ass.forma_pagamento,
    'valor_centavos', v_ass.valor_centavos,
    'trial_fim', v_ass.trial_fim,
    'dias_trial_restantes', v_dias_trial,
    'proximo_vencimento', v_ass.proximo_vencimento,
    'atraso_desde', v_ass.atraso_desde,
    'dias_atraso', v_dias_atraso,
    'dias_para_rebaixamento', v_dias_para_rebaixamento,
    'url_pagamento_asaas', v_ass.url_pagamento_asaas,
    'asaas_subscription_id', v_ass.asaas_subscription_id,
    'cancelada_em', v_ass.cancelada_em
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_assinatura_tenant(uuid) TO authenticated;

-- ------------------------------------------------------------------------------
-- 7. RPC PARA REGISTRAR ACEITE DOS TERMOS (AJUSTE 5)
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.registrar_aceite_termos(uuid, text, text, text, text);
CREATE OR REPLACE FUNCTION public.registrar_aceite_termos(
  p_tenant_id UUID,
  p_versao TEXT DEFAULT 'v1.0-2026-08',
  p_tipo TEXT DEFAULT 'ambos',
  p_ip TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_aceite_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  INSERT INTO public.aceites_termos (
    tenant_id, user_id, versao_documento, tipo_documento, ip_address, user_agent
  ) VALUES (
    p_tenant_id, v_user_id, p_versao, p_tipo, p_ip, p_user_agent
  )
  RETURNING id INTO v_aceite_id;

  RETURN jsonb_build_object('success', true, 'id', v_aceite_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_aceite_termos(uuid, text, text, text, text) TO authenticated;

-- ------------------------------------------------------------------------------
-- 8. ROTINA DIÁRIA DE REBAIXAMENTO E CONTROLE DE TRIAL (PARTE 4 + AJUSTE 3)
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.processar_rotina_diaria_assinaturas();
CREATE OR REPLACE FUNCTION public.processar_rotina_diaria_assinaturas()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_hoje DATE;
  v_rec_trial RECORD;
  v_rec_atraso RECORD;
  v_count_trial_rebaixados INTEGER := 0;
  v_count_atraso_rebaixados INTEGER := 0;
BEGIN
  v_hoje := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  -- 1. Rebaixar Trials Expirados sem assinatura contratada no Asaas
  -- (Somente oficinas que possuem registro em assinaturas conforme Ajuste 3)
  FOR v_rec_trial IN
    SELECT a.id, a.tenant_id, a.plano
    FROM public.assinaturas a
    WHERE a.status = 'trial'
      AND a.trial_fim IS NOT NULL
      AND a.trial_fim < v_hoje
      AND a.asaas_subscription_id IS NULL
  LOOP
    -- Rebaixar plano na oficina para free
    UPDATE public.tenants
    SET plano = 'free', updated_at = now()
    WHERE id = v_rec_trial.tenant_id;

    -- Atualizar registro de assinatura
    UPDATE public.assinaturas
    SET plano = 'free',
        status = 'cancelada',
        cancelada_em = now(),
        updated_at = now()
    WHERE id = v_rec_trial.id;

    -- Auditar ação
    INSERT INTO public.admin_auditoria (
      admin_user_id, acao, entidade, entidade_id, valor_anterior, valor_novo
    ) VALUES (
      COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
      'trial_expirado_rebaixado_free',
      'tenants',
      v_rec_trial.tenant_id::text,
      jsonb_build_object('plano', v_rec_trial.plano, 'status', 'trial'),
      jsonb_build_object('plano', 'free', 'status', 'cancelada')
    );

    v_count_trial_rebaixados := v_count_trial_rebaixados + 1;
  END LOOP;

  -- 2. Rebaixar Assinaturas em Atraso há mais de 5 dias
  FOR v_rec_atraso IN
    SELECT a.id, a.tenant_id, a.plano, a.atraso_desde
    FROM public.assinaturas a
    WHERE a.status = 'atrasada'
      AND a.atraso_desde IS NOT NULL
      AND a.atraso_desde < (v_hoje - 5)
  LOOP
    -- Rebaixar plano da oficina para free (sem apagar nada do banco)
    UPDATE public.tenants
    SET plano = 'free', updated_at = now()
    WHERE id = v_rec_atraso.tenant_id;

    -- Manter registro da assinatura com status atrasada e data para histórico
    UPDATE public.assinaturas
    SET plano = 'free',
        updated_at = now()
    WHERE id = v_rec_atraso.id;

    INSERT INTO public.admin_auditoria (
      admin_user_id, acao, entidade, entidade_id, valor_anterior, valor_novo
    ) VALUES (
      COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
      'inadimplencia_5dias_rebaixado_free',
      'tenants',
      v_rec_atraso.tenant_id::text,
      jsonb_build_object('plano', v_rec_atraso.plano, 'atraso_desde', v_rec_atraso.atraso_desde),
      jsonb_build_object('plano', 'free', 'status', 'atrasada')
    );

    v_count_atraso_rebaixados := v_count_atraso_rebaixados + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'processado_em', now(),
    'trial_rebaixados', v_count_trial_rebaixados,
    'atraso_rebaixados', v_count_atraso_rebaixados
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.processar_rotina_diaria_assinaturas() TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 9. RPCs DO PAINEL ADMIN DA PLATAFORMA (PARTE 5 + AJUSTE MENOR MRR)
-- ------------------------------------------------------------------------------
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
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT 
    a.id,
    a.tenant_id,
    t.nome AS tenant_nome,
    u.email AS dono_email,
    a.plano,
    a.status,
    a.forma_pagamento,
    a.valor_centavos,
    a.trial_fim,
    a.proximo_vencimento,
    a.atraso_desde,
    a.asaas_customer_id,
    a.asaas_subscription_id,
    a.created_at
  FROM public.assinaturas a
  JOIN public.tenants t ON t.id = a.tenant_id
  LEFT JOIN public.tenant_members tm ON tm.tenant_id = t.id AND tm.role = 'dono' AND tm.status = 'ativo'
  LEFT JOIN auth.users u ON u.id = tm.user_id
  WHERE (p_status IS NULL OR p_status = '' OR a.status = p_status)
    AND (p_busca IS NULL OR p_busca = '' OR 
         t.nome ILIKE '%' || p_busca || '%' OR 
         u.email ILIKE '%' || p_busca || '%' OR 
         a.asaas_customer_id ILIKE '%' || p_busca || '%')
  ORDER BY a.created_at DESC
  LIMIT p_limite OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_listar_assinaturas(text, text, integer, integer) TO authenticated;

-- Métricas Gerais do Painel Admin (MRR conta SOMENTE status = 'ativa' conforme Ajuste Menor)
DROP FUNCTION IF EXISTS public.admin_obter_metricas_assinaturas();
CREATE OR REPLACE FUNCTION public.admin_obter_metricas_assinaturas()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_mrr_centavos BIGINT := 0;
  v_total_ativas INTEGER := 0;
  v_total_trial INTEGER := 0;
  v_total_atrasadas INTEGER := 0;
  v_total_canceladas INTEGER := 0;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  -- MRR conta APENAS assinaturas ativas
  SELECT COALESCE(SUM(valor_centavos), 0)::bigint INTO v_mrr_centavos
  FROM public.assinaturas
  WHERE status = 'ativa';

  SELECT COUNT(*)::integer INTO v_total_ativas FROM public.assinaturas WHERE status = 'ativa';
  SELECT COUNT(*)::integer INTO v_total_trial FROM public.assinaturas WHERE status = 'trial';
  SELECT COUNT(*)::integer INTO v_total_atrasadas FROM public.assinaturas WHERE status = 'atrasada';
  SELECT COUNT(*)::integer INTO v_total_canceladas FROM public.assinaturas WHERE status = 'cancelada';

  RETURN jsonb_build_object(
    'mrr_centavos', v_mrr_centavos,
    'mrr_reais', (v_mrr_centavos / 100.0),
    'total_ativas', v_total_ativas,
    'total_trial', v_total_trial,
    'total_atrasadas', v_total_atrasadas,
    'total_canceladas', v_total_canceladas
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_obter_metricas_assinaturas() TO authenticated;

-- RPC para Alteração Manual de Plano pelo Admin com Auditoria Obrigatória
DROP FUNCTION IF EXISTS public.admin_alterar_plano_manual(uuid, text, text);
CREATE OR REPLACE FUNCTION public.admin_alterar_plano_manual(
  p_tenant_id UUID,
  p_novo_plano TEXT,
  p_motivo TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_plano_antigo TEXT;
  v_valor_novo INTEGER := 0;
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Apenas o administrador da plataforma pode alterar planos manualmente.';
  END IF;

  SELECT plano::text INTO v_plano_antigo FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oficina não encontrada.';
  END IF;

  IF p_novo_plano = 'pro' THEN v_valor_novo := 6700;
  ELSIF p_novo_plano = 'studio' THEN v_valor_novo := 14700;
  ELSE v_valor_novo := 0;
  END IF;

  -- 1. Atualizar tenant
  UPDATE public.tenants
  SET plano = p_novo_plano, updated_at = now()
  WHERE id = p_tenant_id;

  -- 2. Atualizar ou inserir assinatura
  INSERT INTO public.assinaturas (tenant_id, plano, status, valor_centavos, updated_at)
  VALUES (p_tenant_id, p_novo_plano, 'ativa', v_valor_novo, now())
  ON CONFLICT (tenant_id) DO UPDATE
  SET plano = EXCLUDED.plano,
      status = 'ativa',
      valor_centavos = EXCLUDED.valor_centavos,
      updated_at = now();

  -- 3. Gravar Auditoria
  INSERT INTO public.admin_auditoria (
    admin_user_id, acao, entidade, entidade_id, valor_anterior, valor_novo
  ) VALUES (
    auth.uid(),
    'alteracao_manual_plano_oficina',
    'tenants',
    p_tenant_id::text,
    jsonb_build_object('plano', v_plano_antigo),
    jsonb_build_object('plano', p_novo_plano, 'motivo', COALESCE(p_motivo, 'Alteração manual pelo Admin'))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_alterar_plano_manual(uuid, text, text) TO authenticated;
