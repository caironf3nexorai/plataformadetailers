-- ==============================================================================
-- MIGRAÇÃO 0164: FUNÇÃO RPC is_super_admin PARA CONTROLE DE ACESSO GLOBAL
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = auth.uid() 
      AND ativo = true 
      AND revogado_em IS NULL 
      AND super_admin = true
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO anon;
