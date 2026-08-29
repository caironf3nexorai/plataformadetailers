-- ==============================================================================
-- MIGRAÇÃO 0074: CORRIGIR TIPAGEM EXPLICITA DE RETORNO EM ADMIN_LISTAR_ASSINATURAS
-- Resolve erro 'structure of query does not match function result type'
-- ==============================================================================

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
    a.id::uuid AS id,
    a.tenant_id::uuid AS tenant_id,
    COALESCE(t.nome, '')::text AS tenant_nome,
    COALESCE(u.email, '')::text AS dono_email,
    COALESCE(a.plano, 'free')::text AS plano,
    COALESCE(a.status, 'ativa')::text AS status,
    a.forma_pagamento::text AS forma_pagamento,
    COALESCE(a.valor_centavos, 0)::integer AS valor_centavos,
    a.trial_fim::date AS trial_fim,
    a.proximo_vencimento::date AS proximo_vencimento,
    a.atraso_desde::date AS atraso_desde,
    a.asaas_customer_id::text AS asaas_customer_id,
    a.asaas_subscription_id::text AS asaas_subscription_id,
    a.created_at::timestamptz AS created_at
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
