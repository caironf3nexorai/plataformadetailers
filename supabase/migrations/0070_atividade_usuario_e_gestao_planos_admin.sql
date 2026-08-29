-- ==============================================================================
-- MIGRAÇÃO 0070: REGISTRO DE ATIVIDADE DE USUÁRIO & ATUALIZAÇÃO DE ÚLTIMO ACESSO
-- ==============================================================================

-- 1. ADICIONAR COLUNA LAST_SEEN_AT EM PROFILES
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- 2. RPC DE REGISTRO DE ATIVIDADE DO USUÁRIO
CREATE OR REPLACE FUNCTION public.touch_user_activity()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    UPDATE public.profiles
    SET last_seen_at = now()
    WHERE id = auth.uid();
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.touch_user_activity() TO authenticated;

-- 3. ATUALIZAR ADMIN_LISTAR_TENANTS PARA CONSIDERAR LAST_SEEN_AT E LAST_SIGN_IN_AT
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
  agendamento_online_ativo BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT 
    t.id,
    t.nome,
    t.slug,
    t.plano,
    t.cidade,
    t.uf,
    t.created_at,
    COALESCE(tm.cnt, 0)::BIGINT AS total_membros,
    COALESCE(tc.cnt, 0)::BIGINT AS total_clientes,
    COALESCE(tv.cnt, 0)::BIGINT AS total_veiculos,
    COALESCE(ta.cnt, 0)::BIGINT AS total_agendamentos,
    COALESCE(te.cnt, 0)::BIGINT AS total_execucoes,
    tm_last.max_sign_in AS ultimo_acesso,
    t.agendamento_online_ativo
  FROM public.tenants t
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

GRANT EXECUTE ON FUNCTION public.admin_listar_tenants(text, text, integer, integer) TO authenticated;

-- 4. ATUALIZAR ADMIN_DETALHE_TENANT PARA TAMBÉM RETORNAR O MAIOR ENTRE LAST_SIGN_IN_AT E LAST_SEEN_AT
DROP FUNCTION IF EXISTS public.admin_detalhe_tenant(uuid);
CREATE OR REPLACE FUNCTION public.admin_detalhe_tenant(p_tenant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant RECORD;
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

  -- Lista de membros com cálculo atualizado do último acesso
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', tm.id,
    'user_id', tm.user_id,
    'email', tm.email,
    'nome', COALESCE(p.nome, tm.email),
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

  -- Histórico dos últimos 12 meses
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

  -- Storage usage mais recente
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
      'agendamento_online_ativo', v_tenant.agendamento_online_ativo
    ),
    'membros', v_membros,
    'historico_12m', v_historico_12m,
    'storage', v_storage
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_detalhe_tenant(uuid) TO authenticated;
