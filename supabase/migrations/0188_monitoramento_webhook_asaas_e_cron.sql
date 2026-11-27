-- ==============================================================================
-- MIGRAÇÃO 0188: MONITORAMENTO AUTOMÁTICO E RECONCILIAÇÃO DE WEBHOOK ASAAS
-- ==============================================================================

BEGIN;

-- 1. Tabela de histórico de checagens de saúde e reconciliações do Webhook Asaas
CREATE TABLE IF NOT EXISTS public.asaas_webhook_monitoramento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  origem TEXT NOT NULL CHECK (origem IN ('admin', 'cron')),
  acao TEXT NOT NULL CHECK (acao IN ('status', 'reativar', 'reconciliar')),
  executado_por TEXT,
  webhook_saudavel BOOLEAN NOT NULL DEFAULT false,
  webhooks_total INTEGER NOT NULL DEFAULT 0,
  webhooks_interrompidos INTEGER NOT NULL DEFAULT 0,
  pagamentos_analisados INTEGER NOT NULL DEFAULT 0,
  acoes_aplicadas INTEGER NOT NULL DEFAULT 0,
  erros_count INTEGER NOT NULL DEFAULT 0,
  resumo_mensagem TEXT NOT NULL,
  detalhes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asaas_webhook_monit_created_at
  ON public.asaas_webhook_monitoramento (created_at DESC);

ALTER TABLE public.asaas_webhook_monitoramento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins podem ler monitoramento webhook asaas" ON public.asaas_webhook_monitoramento;
CREATE POLICY "Platform admins podem ler monitoramento webhook asaas"
  ON public.asaas_webhook_monitoramento
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

-- 2. RPC para o Painel Admin consultar último status, histórico e métricas de eventos recebidos
DROP FUNCTION IF EXISTS public.admin_obter_status_monitoramento_asaas();
CREATE OR REPLACE FUNCTION public.admin_obter_status_monitoramento_asaas()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ultima_checagem JSONB;
  v_historico JSONB;
  v_ultimo_evento JSONB;
  v_eventos_24h INTEGER := 0;
  v_eventos_7d INTEGER := 0;
  v_cron_ativo BOOLEAN := false;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores da plataforma podem consultar o monitoramento Asaas.';
  END IF;

  SELECT to_jsonb(m) INTO v_ultima_checagem
  FROM public.asaas_webhook_monitoramento m
  ORDER BY m.created_at DESC
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(to_jsonb(h) ORDER BY h.created_at DESC), '[]'::jsonb)
  INTO v_historico
  FROM (
    SELECT
      id,
      origem,
      acao,
      executado_por,
      webhook_saudavel,
      webhooks_total,
      webhooks_interrompidos,
      pagamentos_analisados,
      acoes_aplicadas,
      erros_count,
      resumo_mensagem,
      created_at
    FROM public.asaas_webhook_monitoramento
    ORDER BY created_at DESC
    LIMIT 10
  ) h;

  IF to_regclass('public.assinatura_eventos') IS NOT NULL THEN
    SELECT jsonb_build_object(
      'asaas_event_id', e.asaas_event_id,
      'tipo', e.tipo,
      'created_at', e.created_at
    )
    INTO v_ultimo_evento
    FROM public.assinatura_eventos e
    ORDER BY e.created_at DESC
    LIMIT 1;

    SELECT COUNT(*) INTO v_eventos_24h
    FROM public.assinatura_eventos
    WHERE created_at >= now() - INTERVAL '24 hours';

    SELECT COUNT(*) INTO v_eventos_7d
    FROM public.assinatura_eventos
    WHERE created_at >= now() - INTERVAL '7 days';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT EXISTS (
      SELECT 1 FROM cron.job
      WHERE jobname = 'monitoramento-diario-webhook-asaas'
        AND active = true
    ) INTO v_cron_ativo;
  END IF;

  RETURN jsonb_build_object(
    'ultima_checagem', v_ultima_checagem,
    'historico', COALESCE(v_historico, '[]'::jsonb),
    'ultimo_evento', v_ultimo_evento,
    'eventos_24h', v_eventos_24h,
    'eventos_7d', v_eventos_7d,
    'cron_ativo', v_cron_ativo
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_obter_status_monitoramento_asaas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_obter_status_monitoramento_asaas() TO authenticated;

-- 3. Função de disparo diário via pg_net (se pg_net e segredos do Vault estiverem configurados)
DROP FUNCTION IF EXISTS public.disparar_monitoramento_asaas_cron();
CREATE OR REPLACE FUNCTION public.disparar_monitoramento_asaas_cron()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT;
  v_cron_secret TEXT;
  v_req_id BIGINT;
BEGIN
  IF to_regnamespace('net') IS NULL THEN
    RETURN jsonb_build_object('disparado', false, 'motivo', 'extensao_pg_net_indisponivel');
  END IF;

  -- Tenta ler do Supabase Vault (vault.decrypted_secrets) se existir
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE $q$
      SELECT decrypted_secret FROM vault.decrypted_secrets
      WHERE name IN ('asaas_reconciliar_url', 'supabase_project_url')
      ORDER BY CASE WHEN name = 'asaas_reconciliar_url' THEN 0 ELSE 1 END
      LIMIT 1
    $q$ INTO v_url;

    EXECUTE $q$
      SELECT decrypted_secret FROM vault.decrypted_secrets
      WHERE name IN ('cron_secret', 'CRON_SECRET')
      LIMIT 1
    $q$ INTO v_cron_secret;
  END IF;

  IF v_url IS NOT NULL AND v_url NOT LIKE '%/functions/v1/%' THEN
    v_url := rtrim(v_url, '/') || '/functions/v1/asaas-reconciliar';
  END IF;

  IF COALESCE(v_url, '') = '' THEN
    v_url := 'https://oamwsqlszahyjkaksouh.supabase.co/functions/v1/asaas-reconciliar';
  END IF;

  IF COALESCE(v_cron_secret, '') = '' THEN
    v_cron_secret := current_setting('app.settings.cron_secret', true);
  END IF;

  IF COALESCE(v_cron_secret, '') = '' THEN
    RETURN jsonb_build_object(
      'disparado', false,
      'motivo', 'cron_secret_nao_configurado_no_vault',
      'instrucao', 'Cadastre o segredo cron_secret no Supabase Vault com o mesmo valor de CRON_SECRET das Edge Functions.'
    );
  END IF;

  EXECUTE $q$
    SELECT net.http_post(
      url := $1,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', $2
      ),
      body := jsonb_build_object(
        'action', 'reconciliar',
        'reativar_webhook', true,
        'dry_run', false
      )
    )
  $q$ INTO v_req_id USING v_url, v_cron_secret;

  RETURN jsonb_build_object(
    'disparado', true,
    'request_id', v_req_id,
    'url', v_url
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('disparado', false, 'erro', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.disparar_monitoramento_asaas_cron() FROM PUBLIC, anon, authenticated;

-- 3.1. Função de disparo diário autenticado do expurgo de fotos (corrige job antigo que enviava headers vazios)
DROP FUNCTION IF EXISTS public.disparar_expurgo_fotos_cron();
CREATE OR REPLACE FUNCTION public.disparar_expurgo_fotos_cron()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT := 'https://oamwsqlszahyjkaksouh.supabase.co/functions/v1/expurgo-fotos';
  v_cron_secret TEXT;
  v_req_id BIGINT;
BEGIN
  IF to_regnamespace('net') IS NULL THEN
    RETURN jsonb_build_object('disparado', false, 'motivo', 'extensao_pg_net_indisponivel');
  END IF;

  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE $q$
      SELECT decrypted_secret FROM vault.decrypted_secrets
      WHERE name IN ('cron_secret', 'CRON_SECRET')
      LIMIT 1
    $q$ INTO v_cron_secret;
  END IF;

  IF COALESCE(v_cron_secret, '') = '' THEN
    v_cron_secret := current_setting('app.settings.cron_secret', true);
  END IF;

  IF COALESCE(v_cron_secret, '') = '' THEN
    RETURN jsonb_build_object('disparado', false, 'motivo', 'cron_secret_nao_configurado_no_vault');
  END IF;

  EXECUTE $q$
    SELECT net.http_post(
      url := $1,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', $2
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    )
  $q$ INTO v_req_id USING v_url, v_cron_secret;

  RETURN jsonb_build_object('disparado', true, 'request_id', v_req_id, 'url', v_url);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('disparado', false, 'erro', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.disparar_expurgo_fotos_cron() FROM PUBLIC, anon, authenticated;

-- 4. Agendamento diário no pg_cron (06:15 UTC = 03:15 Brasília, após rotina-diaria-assinaturas)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monitoramento-diario-webhook-asaas') THEN
      PERFORM cron.unschedule('monitoramento-diario-webhook-asaas');
    END IF;

    PERFORM cron.schedule(
      'monitoramento-diario-webhook-asaas',
      '15 6 * * *',
      'SELECT public.disparar_monitoramento_asaas_cron();'
    );

    -- Atualiza também o cron de expurgo-fotos-diario para enviar x-cron-secret via Vault
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expurgo-fotos-diario') THEN
      PERFORM cron.unschedule('expurgo-fotos-diario');
    END IF;

    PERFORM cron.schedule(
      'expurgo-fotos-diario',
      '0 6 * * *',
      'SELECT public.disparar_expurgo_fotos_cron();'
    );
  END IF;
END;
$$;

-- 5. Verificação Anti-PGRST203: garantir assinatura única das novas funções
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'admin_obter_status_monitoramento_asaas';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Assinatura duplicada para admin_obter_status_monitoramento_asaas (encontradas: %)', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'disparar_monitoramento_asaas_cron';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Assinatura duplicada para disparar_monitoramento_asaas_cron (encontradas: %)', v_count;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
