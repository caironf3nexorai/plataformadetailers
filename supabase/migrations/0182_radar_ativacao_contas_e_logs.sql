-- ==============================================================================
-- Migration 0182: RADAR DE ATIVAÇÃO DE CONTAS & RASTREAMENTO LEVE
-- - Tabela public.user_activity_logs com RLS blindada
-- - Índice composto (user_id, created_at DESC)
-- - pg_cron diário às 06:00 UTC (03:00 BRT) para retenção de 30 dias (Supabase Free)
-- - RPC admin_obter_radar_ativacao (Paginação 20/pág, sem consultas N+1, Score de Uso)
-- - RPC admin_obter_timeline_usuario (Drawer / Modal com ORDER BY explícito no jsonb_agg)
-- - RPC admin_estender_trial (Protegida contra assinaturas ativas, +15 dias em 1 clique)
-- - Verificador Anti-PGRST203 em pg_proc
-- ==============================================================================

BEGIN;

-- 1. TABELA DE LOGS LEVES DE ATIVIDADE
CREATE TABLE IF NOT EXISTS public.user_activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('page_view', 'action')),
  route TEXT NULL,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices otimizados
CREATE INDEX IF NOT EXISTS idx_user_activity_logs_user_created 
  ON public.user_activity_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_activity_logs_created_at 
  ON public.user_activity_logs (created_at);

-- RLS
ALTER TABLE public.user_activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_activity_logs_insert ON public.user_activity_logs;
CREATE POLICY user_activity_logs_insert 
  ON public.user_activity_logs 
  FOR INSERT 
  TO authenticated 
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_activity_logs_select ON public.user_activity_logs;
CREATE POLICY user_activity_logs_select 
  ON public.user_activity_logs 
  FOR SELECT 
  TO authenticated 
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS user_activity_logs_delete ON public.user_activity_logs;
CREATE POLICY user_activity_logs_delete 
  ON public.user_activity_logs 
  FOR DELETE 
  TO authenticated 
  USING (public.is_platform_admin());

REVOKE ALL ON TABLE public.user_activity_logs FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.user_activity_logs TO authenticated;
GRANT ALL ON TABLE public.user_activity_logs TO service_role;

-- 2. ROTINA DE PURGA AUTOMÁTICA DE 30 DIAS (PG_CRON)
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expurgo-user-activity-logs-30d') THEN
      PERFORM cron.unschedule('expurgo-user-activity-logs-30d');
    END IF;

    -- Executa diariamente às 06:00 UTC (03:00 Horário de Brasília)
    PERFORM cron.schedule(
      'expurgo-user-activity-logs-30d',
      '0 6 * * *',
      'DELETE FROM public.user_activity_logs WHERE created_at < (now() - INTERVAL ''30 days'');'
    );
  END IF;
END $$;

-- 3. RPC OTIMIZADA DO RADAR DE ATIVAÇÃO (SEM N+1, PAGINADA EM 20/PÁGINA)
DROP FUNCTION IF EXISTS public.admin_obter_radar_ativacao(integer, integer, text, text);
CREATE OR REPLACE FUNCTION public.admin_obter_radar_ativacao(
  p_pagina INTEGER DEFAULT 1,
  p_limite INTEGER DEFAULT 20,
  p_busca TEXT DEFAULT NULL,
  p_score TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hoje_date DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date;
  v_hoje_inicio TIMESTAMPTZ := ((CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date::timestamp AT TIME ZONE 'America/Sao_Paulo');
  v_offset INTEGER;
  v_limite INTEGER := COALESCE(p_limite, 20);
  v_resultado JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores da plataforma podem acessar o radar.';
  END IF;

  IF v_limite <= 0 THEN v_limite := 20; END IF;
  v_offset := (GREATEST(1, COALESCE(p_pagina, 1)) - 1) * v_limite;

  WITH dados_tenants AS (
    SELECT
      t.id AS tenant_id,
      t.nome AS nome_estetica,
      t.slug,
      t.plano,
      t.cidade,
      t.uf,
      t.telefone AS tenant_telefone,
      t.created_at AS data_cadastro,
      t.logo_path,
      t.agendamento_online_ativo,
      
      -- Dono da oficina
      dono.user_id AS dono_id,
      COALESCE(dono.nome, dono.raw_nome, dono.email, 'Sem dono') AS nome_dono,
      COALESCE(dono.telefone, t.telefone, dono.raw_telefone) AS telefone_dono,
      dono.email AS email_dono,
      
      -- Atividade mais recente do dono/oficina (com NULLIF para '1970-01-01')
      NULLIF(
        GREATEST(
          COALESCE(dono.last_sign_in_at, '1970-01-01 00:00:00+00'::timestamptz),
          COALESCE(dono.last_seen_at, '1970-01-01 00:00:00+00'::timestamptz),
          COALESCE(dono.ultima_acao_em, '1970-01-01 00:00:00+00'::timestamptz)
        ),
        '1970-01-01 00:00:00+00'::timestamptz
      ) AS ultimo_acesso,
      dono.ultima_acao_label,
      dono.ultima_acao_em,

      -- Assinatura e Trial
      COALESCE(a.status, CASE WHEN t.plano = 'free' THEN 'cancelada' ELSE 'trial' END) AS assinatura_status,
      a.trial_fim,
      CASE
        WHEN COALESCE(a.status, 'trial') = 'trial' AND a.trial_fim IS NOT NULL THEN
          GREATEST(0, (a.trial_fim - v_hoje_date))
        ELSE 0
      END AS dias_trial_restantes,

      -- Contadores reais (ignora nomes óbvios de teste)
      COALESCE(cr.cnt, 0)::BIGINT AS total_clientes_reais,
      COALESCE(srv.cnt, 0)::BIGINT AS total_servicos,
      COALESCE(srv_custom.cnt, 0)::BIGINT AS total_servicos_customizados,
      COALESCE(ag.cnt, 0)::BIGINT AS total_agendamentos,
      COALESCE(ex.cnt, 0)::BIGINT AS total_execucoes,
      COALESCE(chk.cnt, 0)::BIGINT AS total_vistorias,
      COALESCE(veic.cnt, 0)::BIGINT AS total_veiculos,
      
      -- Score de uso (Ajustado: não considera srv default na largada, exige custom ou config)
      CASE
        WHEN (COALESCE(cr.cnt, 0) > 0 AND (COALESCE(ag.cnt, 0) > 0 OR COALESCE(ex.cnt, 0) > 0 OR COALESCE(chk.cnt, 0) > 0))
          THEN 'operando'
        WHEN (
          COALESCE(cr.cnt, 0) > 0 
          OR COALESCE(srv_custom.cnt, 0) > 0 
          OR t.logo_path IS NOT NULL 
          OR t.agendamento_online_ativo = true
          OR COALESCE(veic.cnt, 0) > 0
        )
          THEN 'configurando'
        ELSE 'so_cadastro'
      END AS score
    FROM public.tenants t
    LEFT JOIN public.assinaturas a ON a.tenant_id = t.id
    LEFT JOIN LATERAL (
      SELECT
        tm.user_id,
        tm.email,
        p.nome,
        p.telefone,
        u.raw_user_meta_data->>'nome' AS raw_nome,
        u.raw_user_meta_data->>'telefone' AS raw_telefone,
        u.last_sign_in_at,
        p.last_seen_at,
        act.label AS ultima_acao_label,
        act.created_at AS ultima_acao_em
      FROM public.tenant_members tm
      LEFT JOIN public.profiles p ON p.id = tm.user_id
      LEFT JOIN auth.users u ON u.id = tm.user_id
      LEFT JOIN LATERAL (
        SELECT label, created_at
        FROM public.user_activity_logs
        WHERE user_id = tm.user_id
        ORDER BY created_at DESC
        LIMIT 1
      ) act ON true
      WHERE tm.tenant_id = t.id AND tm.role = 'dono' AND tm.status = 'ativo'
      ORDER BY tm.created_at ASC
      LIMIT 1
    ) dono ON true
    LEFT JOIN (
      SELECT c.tenant_id, COUNT(*) AS cnt
      FROM public.clientes c
      WHERE c.ativo = true
        AND lower(trim(c.nome)) NOT IN ('teste', 'test', 'aaa', '123', 'abc', 'cliente teste', 'asdf')
        AND c.nome !~* '^(teste|test|aaa+|123+|asdf+)'
        AND length(trim(c.nome)) >= 2
      GROUP BY c.tenant_id
    ) cr ON cr.tenant_id = t.id
    LEFT JOIN (
      SELECT tenant_id, COUNT(*) AS cnt
      FROM public.servicos
      WHERE ativo = true
      GROUP BY tenant_id
    ) srv ON srv.tenant_id = t.id
    LEFT JOIN (
      SELECT s.tenant_id, COUNT(*) AS cnt
      FROM public.servicos s
      JOIN public.tenants t2 ON t2.id = s.tenant_id
      WHERE s.ativo = true
        AND s.created_at > (t2.created_at + INTERVAL '2 minutes')
      GROUP BY s.tenant_id
    ) srv_custom ON srv_custom.tenant_id = t.id
    LEFT JOIN (
      SELECT tenant_id, COUNT(*) AS cnt
      FROM public.agendamentos
      GROUP BY tenant_id
    ) ag ON ag.tenant_id = t.id
    LEFT JOIN (
      SELECT tenant_id, COUNT(*) AS cnt
      FROM public.execucoes
      GROUP BY tenant_id
    ) ex ON ex.tenant_id = t.id
    LEFT JOIN (
      SELECT tenant_id, COUNT(*) AS cnt
      FROM public.checkins
      GROUP BY tenant_id
    ) chk ON chk.tenant_id = t.id
    LEFT JOIN (
      SELECT tenant_id, COUNT(*) AS cnt
      FROM public.veiculos
      GROUP BY tenant_id
    ) veic ON veic.tenant_id = t.id
  ),
  metricas_globais AS (
    SELECT
      COUNT(*)::INTEGER AS total_contas,
      COUNT(*) FILTER (WHERE ultimo_acesso >= v_hoje_inicio)::INTEGER AS total_ativos_hoje,
      COUNT(*) FILTER (WHERE score = 'operando')::INTEGER AS total_operando,
      COUNT(*) FILTER (WHERE dias_trial_restantes > 0 AND dias_trial_restantes <= 3)::INTEGER AS total_trial_vencendo
    FROM dados_tenants
  ),
  filtrados AS (
    SELECT *
    FROM dados_tenants dt
    WHERE (
      p_busca IS NULL OR trim(p_busca) = '' OR
      dt.nome_estetica ILIKE '%' || trim(p_busca) || '%' OR
      dt.nome_dono ILIKE '%' || trim(p_busca) || '%' OR
      dt.email_dono ILIKE '%' || trim(p_busca) || '%' OR
      dt.telefone_dono ILIKE '%' || trim(p_busca) || '%'
    )
    AND (
      p_score IS NULL OR p_score = 'todos' OR dt.score = p_score
    )
  ),
  paginados AS (
    SELECT *
    FROM filtrados
    ORDER BY ultimo_acesso DESC NULLS LAST, data_cadastro DESC
    LIMIT v_limite
    OFFSET v_offset
  )
  SELECT jsonb_build_object(
    'resumo', (
      SELECT jsonb_build_object(
        'total_contas', total_contas,
        'total_ativos_hoje', total_ativos_hoje,
        'total_operando', total_operando,
        'total_trial_vencendo', total_trial_vencendo
      ) FROM metricas_globais
    ),
    'paginacao', jsonb_build_object(
      'pagina_atual', GREATEST(1, COALESCE(p_pagina, 1)),
      'limite', v_limite,
      'total_filtrados', (SELECT COUNT(*)::INTEGER FROM filtrados),
      'total_paginas', GREATEST(1, CEIL((SELECT COUNT(*)::NUMERIC FROM filtrados) / v_limite)::INTEGER)
    ),
    'contas', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'tenant_id', p.tenant_id,
          'nome_estetica', p.nome_estetica,
          'slug', p.slug,
          'plano', p.plano,
          'cidade', p.cidade,
          'uf', p.uf,
          'dono_id', p.dono_id,
          'nome_dono', p.nome_dono,
          'telefone_dono', p.telefone_dono,
          'email_dono', p.email_dono,
          'data_cadastro', p.data_cadastro,
          'ultimo_acesso', p.ultimo_acesso,
          'ultima_acao_label', p.ultima_acao_label,
          'ultima_acao_em', p.ultima_acao_em,
          'assinatura_status', p.assinatura_status,
          'trial_fim', p.trial_fim,
          'dias_trial_restantes', p.dias_trial_restantes,
          'total_clientes_reais', p.total_clientes_reais,
          'total_servicos', p.total_servicos,
          'total_servicos_customizados', p.total_servicos_customizados,
          'total_agendamentos', p.total_agendamentos,
          'total_execucoes', p.total_execucoes,
          'total_vistorias', p.total_vistorias,
          'total_veiculos', p.total_veiculos,
          'score', p.score
        )
        ORDER BY p.ultimo_acesso DESC NULLS LAST, p.data_cadastro DESC
      )
      FROM paginados p
    ), '[]'::jsonb)
  ) INTO v_resultado;

  RETURN v_resultado;
END;
$$;

-- 4. RPC DE TIMELINE CRONOLÓGICA (DRAWER / MODAL COM ORDER BY EXPLÍCITO NO JSONB_AGG)
DROP FUNCTION IF EXISTS public.admin_obter_timeline_usuario(uuid, integer);
CREATE OR REPLACE FUNCTION public.admin_obter_timeline_usuario(
  p_tenant_id UUID,
  p_limite INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limite INTEGER := LEAST(COALESCE(p_limite, 50), 100);
  v_resultado JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores podem consultar a timeline.';
  END IF;

  WITH membros AS (
    SELECT tm.user_id, tm.email, COALESCE(p.nome, u.raw_user_meta_data->>'nome', tm.email) AS nome
    FROM public.tenant_members tm
    LEFT JOIN public.profiles p ON p.id = tm.user_id
    LEFT JOIN auth.users u ON u.id = tm.user_id
    WHERE tm.tenant_id = p_tenant_id
  ),
  logs AS (
    SELECT
      l.id,
      l.user_id,
      m.nome AS user_nome,
      m.email AS user_email,
      l.event_type,
      l.route,
      l.label,
      l.created_at
    FROM public.user_activity_logs l
    JOIN membros m ON m.user_id = l.user_id
    ORDER BY l.created_at DESC
    LIMIT v_limite
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', l.id,
      'user_id', l.user_id,
      'user_nome', l.user_nome,
      'user_email', l.user_email,
      'event_type', l.event_type,
      'route', l.route,
      'label', l.label,
      'created_at', l.created_at
    )
    ORDER BY l.created_at DESC
  ), '[]'::jsonb)
  INTO v_resultado
  FROM logs l;

  RETURN v_resultado;
END;
$$;

-- 5. RPC SEGURA PARA ESTENDER TRIAL EM +15 DIAS (COM PROTEÇÃO CONTRA ASSINATURA ATIVA)
DROP FUNCTION IF EXISTS public.admin_estender_trial(uuid, integer);
CREATE OR REPLACE FUNCTION public.admin_estender_trial(
  p_tenant_id UUID,
  p_dias INTEGER DEFAULT 15
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hoje DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date;
  v_ass RECORD;
  v_nova_data DATE;
  v_tenant_nome TEXT;
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores editores podem estender trial.';
  END IF;

  SELECT nome INTO v_tenant_nome FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oficina não encontrada.';
  END IF;

  SELECT * INTO v_ass FROM public.assinaturas WHERE tenant_id = p_tenant_id;
  
  IF FOUND THEN
    -- Proteção: não sobrescrever clientes com assinatura ativa paga
    IF v_ass.status = 'ativa' THEN
      RAISE EXCEPTION 'Não é permitido estender o trial de uma conta com assinatura ativa paga.';
    END IF;

    IF v_ass.trial_fim IS NOT NULL AND v_ass.trial_fim > v_hoje THEN
      v_nova_data := v_ass.trial_fim + p_dias;
    ELSE
      v_nova_data := v_hoje + p_dias;
    END IF;

    UPDATE public.assinaturas
    SET status = 'trial',
        trial_fim = v_nova_data,
        plano = CASE WHEN plano = 'free' THEN 'pro' ELSE plano END,
        updated_at = now()
    WHERE tenant_id = p_tenant_id;
  ELSE
    v_nova_data := v_hoje + p_dias;
    INSERT INTO public.assinaturas (tenant_id, plano, status, ciclo, valor_centavos, trial_fim, is_cortesia, created_at, updated_at)
    VALUES (p_tenant_id, 'pro', 'trial', 'mensal', 6700, v_nova_data, false, now(), now());
  END IF;

  UPDATE public.tenants
  SET plano = CASE WHEN plano = 'free' THEN 'pro' ELSE plano END,
      updated_at = now()
  WHERE id = p_tenant_id;

  RETURN jsonb_build_object(
    'sucesso', true,
    'tenant_id', p_tenant_id,
    'tenant_nome', v_tenant_nome,
    'novo_trial_fim', v_nova_data,
    'dias_adicionados', p_dias,
    'dias_restantes', (v_nova_data - v_hoje)
  );
END;
$$;

-- Permissões das RPCs
REVOKE ALL ON FUNCTION public.admin_obter_radar_ativacao(integer, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_obter_radar_ativacao(integer, integer, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_obter_timeline_usuario(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_obter_timeline_usuario(uuid, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_estender_trial(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_estender_trial(uuid, integer) TO authenticated;

-- 6. VERIFICADOR ANTI-PGRST203 NO CATÁLOGO PG_PROC
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT p.proname, count(*) as total
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('admin_obter_radar_ativacao', 'admin_obter_timeline_usuario', 'admin_estender_trial')
    GROUP BY p.proname
    HAVING count(*) > 1
  ) LOOP
    RAISE EXCEPTION 'ERRO ANTI-PGRST203: Função % possui % assinaturas ativas em public.', r.proname, r.total;
  END LOOP;
END $$;

COMMIT;

