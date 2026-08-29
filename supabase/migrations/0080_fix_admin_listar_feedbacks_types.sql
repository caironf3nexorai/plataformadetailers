-- ==============================================================================
-- MIGRAÇÃO 0080: CORRIGIR TIPAGEM EXPLÍCITA EM ADMIN_LISTAR_FEEDBACKS
-- Resolve erro 'structure of query does not match function result type'
-- ==============================================================================

DROP FUNCTION IF EXISTS public.admin_listar_feedbacks(text, text, uuid, integer, integer);

CREATE OR REPLACE FUNCTION public.admin_listar_feedbacks(
  p_tipo TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_tenant_id UUID DEFAULT NULL,
  p_limite INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  tenant_id UUID,
  tenant_nome TEXT,
  user_id UUID,
  user_email TEXT,
  papel TEXT,
  tipo TEXT,
  mensagem TEXT,
  tela_origem TEXT,
  user_agent TEXT,
  status TEXT,
  premiado BOOLEAN,
  resposta_admin TEXT,
  respondido_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Apenas o administrador da plataforma pode visualizar o painel de feedbacks.';
  END IF;

  RETURN QUERY
  SELECT 
    f.id::uuid AS id,
    f.tenant_id::uuid AS tenant_id,
    COALESCE(t.nome, 'Oficina')::text AS tenant_nome,
    f.user_id::uuid AS user_id,
    COALESCE(u.email, '')::text AS user_email,
    f.papel::text AS papel,
    f.tipo::text AS tipo,
    f.mensagem::text AS mensagem,
    f.tela_origem::text AS tela_origem,
    f.user_agent::text AS user_agent,
    f.status::text AS status,
    f.premiado::boolean AS premiado,
    f.resposta_admin::text AS resposta_admin,
    f.respondido_em::timestamptz AS respondido_em,
    f.created_at::timestamptz AS created_at
  FROM public.feedbacks f
  LEFT JOIN public.tenants t ON t.id = f.tenant_id
  LEFT JOIN auth.users u ON u.id = f.user_id
  WHERE (p_tipo IS NULL OR p_tipo = '' OR f.tipo = p_tipo)
    AND (p_status IS NULL OR p_status = '' OR f.status = p_status)
    AND (p_tenant_id IS NULL OR f.tenant_id = p_tenant_id)
  ORDER BY f.created_at DESC
  LIMIT p_limite OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_listar_feedbacks(text, text, uuid, integer, integer) TO authenticated;
