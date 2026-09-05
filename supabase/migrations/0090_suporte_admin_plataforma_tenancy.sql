-- ==============================================================================
-- MIGRAÇÃO 0090: SUPORTE A ADMINISTRADORES DA PLATAFORMA EM MEUS_TENANTS E TEM_PAPEL
-- ==============================================================================

-- 1. meus_tenants() retorna também todos os tenants para administradores da plataforma
CREATE OR REPLACE FUNCTION public.meus_tenants()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT tenant_id FROM public.tenant_members
  WHERE user_id = auth.uid() AND status = 'ativo'
  UNION
  SELECT id FROM public.tenants
  WHERE public.is_platform_admin();
$$;

-- 2. tem_papel() retorna true para administradores da plataforma
CREATE OR REPLACE FUNCTION public.tem_papel(p_tenant UUID, p_roles public.app_role[])
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = p_tenant
      AND user_id = auth.uid()
      AND status = 'ativo'
      AND role = ANY(p_roles)
  ) OR public.is_platform_admin();
$$;

GRANT EXECUTE ON FUNCTION public.meus_tenants() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tem_papel(UUID, public.app_role[]) TO authenticated;
