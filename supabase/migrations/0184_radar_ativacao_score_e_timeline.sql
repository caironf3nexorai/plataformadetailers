-- ==============================================================================
-- Migration 0184: AJUSTE DO SCORE NO RADAR DE ATIVAÇÃO & TIMELINE RESILIENTE
-- - Atualiza public.admin_obter_radar_ativacao:
--   * Remove t.agendamento_online_ativo e servicos padrao do score configurando
--     (eliminando falso-positivo em contas recem-criadas)
--   * Adiciona contagem de rotas distintas visitadas em user_activity_logs
--   * Nova regra de Score:
--       🟢 operando: clientes_reais > 0 E (agendamentos > 0 OU execucoes > 0 OU vistorias > 0)
--       🟡 configurando: clientes_reais > 0 OU logo_path IS NOT NULL OU rotas_visitadas >= 2
--       🔴 so_cadastro: todo o restante
--   * Retorna total_rotas_visitadas no payload JSON de cada conta
-- - Atualiza public.admin_obter_timeline_usuario:
--   * Une tenant_members (por user_id e email) e tenants.criado_por para encontrar
--     todos os eventos do criador/dono da oficina mesmo se o user_id estiver desvinculado
-- - Inclui verificadores Anti-PGRST203 em pg_proc
-- ==============================================================================

BEGIN;

-- 1. RPC ATUALIZADA DO RADAR DE ATIVAÇÃO
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
      
      -- Dono da oficina (com fallback resiliente para tenants.criado_por)
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
      COALESCE(rotas.cnt, 0)::BIGINT AS total_rotas_visitadas,
      
      -- Score de uso atualizado:
      -- 🟢 operando: total_clientes_reais > 0 E (total_agendamentos > 0 OU total_execucoes > 0 OU total_vistorias > 0)
      -- 🟡 configurando: total_clientes_reais > 0 OU t.logo_path IS NOT NULL OU total_rotas_visitadas >= 2
      -- 🔴 so_cadastro: todo o restante
      CASE
        WHEN (
          COALESCE(cr.cnt, 0) > 0 
          AND (COALESCE(ag.cnt, 0) > 0 OR COALESCE(ex.cnt, 0) > 0 OR COALESCE(chk.cnt, 0) > 0)
        )
          THEN 'operando'
        WHEN (
          COALESCE(cr.cnt, 0) > 0 
          OR t.logo_path IS NOT NULL 
          OR COALESCE(rotas.cnt, 0) >= 2
        )
          THEN 'configurando'
        ELSE 'so_cadastro'
      END AS score
    FROM public.tenants t
    LEFT JOIN public.assinaturas a ON a.tenant_id = t.id
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(tm.user_id, t.criado_por) AS user_id,
        COALESCE(tm.email, u.email) AS email,
        p.nome,
        p.telefone,
        u.raw_user_meta_data->>'nome' AS raw_nome,
        u.raw_user_meta_data->>'telefone' AS raw_telefone,
        u.last_sign_in_at,
        p.last_seen_at,
        act.label AS ultima_acao_label,
        act.created_at AS ultima_acao_em
      FROM (
        SELECT tm_sub.user_id, tm_sub.email
        FROM public.tenant_members tm_sub
        WHERE tm_sub.tenant_id = t.id AND tm_sub.role = 'dono'
        ORDER BY tm_sub.created_at ASC
        LIMIT 1
      ) tm
      FULL OUTER JOIN (SELECT t.criado_por AS user_id) t_owner ON true
      LEFT JOIN auth.users u ON u.id = COALESCE(tm.user_id, t.criado_por)
      LEFT JOIN public.profiles p ON p.id = COALESCE(tm.user_id, t.criado_por)
      LEFT JOIN LATERAL (
        SELECT label, created_at
        FROM public.user_activity_logs
        WHERE user_id = COALESCE(tm.user_id, t.criado_por)
        ORDER BY created_at DESC
        LIMIT 1
      ) act ON true
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
    -- Contagem de rotas distintas visitadas pelos membros / criador da oficina
    LEFT JOIN (
      SELECT 
        tm_all.tenant_id,
        COUNT(DISTINCT l.route) AS cnt
      FROM (
        SELECT tm.tenant_id, tm.user_id
        FROM public.tenant_members tm
        WHERE tm.user_id IS NOT NULL
        UNION
        SELECT t_sub.id AS tenant_id, t_sub.criado_por AS user_id
        FROM public.tenants t_sub
        WHERE t_sub.criado_por IS NOT NULL
      ) tm_all
      JOIN public.user_activity_logs l ON l.user_id = tm_all.user_id
      WHERE l.route IS NOT NULL AND trim(l.route) != ''
      GROUP BY tm_all.tenant_id
    ) rotas ON rotas.tenant_id = t.id
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
          'total_rotas_visitadas', p.total_rotas_visitadas,
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

REVOKE ALL ON FUNCTION public.admin_obter_radar_ativacao(integer, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_obter_radar_ativacao(integer, integer, text, text) TO authenticated;

-- 2. RPC ATUALIZADA DA TIMELINE DE ATIVIDADES DO USUÁRIO (DRAWER ADMIN)
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
    -- 1. Usuários vinculados na tenant_members (por user_id ou por email)
    SELECT 
      COALESCE(tm.user_id, u.id) AS user_id,
      COALESCE(tm.email, u.email) AS email,
      COALESCE(p.nome, u.raw_user_meta_data->>'nome', tm.email, u.email, 'Membro') AS nome
    FROM public.tenant_members tm
    LEFT JOIN auth.users u ON (u.id = tm.user_id OR LOWER(u.email) = LOWER(tm.email))
    LEFT JOIN public.profiles p ON (p.id = tm.user_id OR p.id = u.id)
    WHERE tm.tenant_id = p_tenant_id

    UNION

    -- 2. Dono / Criador da oficina na tabela tenants
    SELECT 
      t.criado_por AS user_id,
      u.email,
      COALESCE(p.nome, u.raw_user_meta_data->>'nome', u.email, 'Dono') AS nome
    FROM public.tenants t
    JOIN auth.users u ON u.id = t.criado_por
    LEFT JOIN public.profiles p ON p.id = t.criado_por
    WHERE t.id = p_tenant_id AND t.criado_por IS NOT NULL
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

REVOKE ALL ON FUNCTION public.admin_obter_timeline_usuario(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_obter_timeline_usuario(uuid, integer) TO authenticated;

-- 3. AUDITORIA E VERIFICAÇÃO AUTOMÁTICA ANTI-PGRST203
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT p.proname, count(*) as total
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('admin_obter_radar_ativacao', 'admin_obter_timeline_usuario')
    GROUP BY p.proname
    HAVING count(*) > 1
  ) LOOP
    RAISE EXCEPTION 'ALERTA CRÍTICO ANTI-PGRST203: Função pública % possui % assinaturas ativas!', r.proname, r.total;
  END LOOP;
END $$;

COMMIT;

