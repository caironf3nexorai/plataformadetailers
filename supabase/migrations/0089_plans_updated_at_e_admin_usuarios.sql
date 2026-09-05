-- ==============================================================================
-- MIGRAÇÃO 0089: PLANS UPDATED_AT & ADMIN LISTAR USUARIOS PARA PARCEIROS
-- ==============================================================================

-- 1. Adicionar updated_at e created_at na tabela public.plans se não existirem
ALTER TABLE public.plans 
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Trigger para manter updated_at sincronizado em public.plans
CREATE OR REPLACE FUNCTION public.handle_plans_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_plans_updated_at ON public.plans;
CREATE TRIGGER trg_plans_updated_at
BEFORE UPDATE ON public.plans
FOR EACH ROW
EXECUTE FUNCTION public.handle_plans_updated_at();


-- 2. Garantir coluna tempo_efetivo_minutos em execucoes se não existir
ALTER TABLE public.execucoes
ADD COLUMN IF NOT EXISTS tempo_efetivo_minutos INTEGER DEFAULT 0;


-- 3. Função RPC para Administradores listarem todos os usuários da plataforma para vínculo de parceiro
DROP FUNCTION IF EXISTS public.admin_listar_usuarios_para_parceiro();

CREATE OR REPLACE FUNCTION public.admin_listar_usuarios_para_parceiro()
RETURNS TABLE (
  id UUID,
  email TEXT,
  nome TEXT,
  telefone TEXT,
  tenant_nome TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado. Apenas administradores da plataforma podem acessar esta lista.';
  END IF;

  RETURN QUERY
  SELECT 
    u.id,
    u.email::TEXT,
    COALESCE(NULLIF(TRIM(p.nome), ''), split_part(u.email, '@', 1))::TEXT AS nome,
    p.telefone::TEXT,
    (
      SELECT t.nome 
      FROM public.tenant_members tm
      JOIN public.tenants t ON t.id = tm.tenant_id
      WHERE tm.user_id = u.id AND tm.status = 'ativo'
      ORDER BY tm.created_at ASC
      LIMIT 1
    )::TEXT AS tenant_nome
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.email IS NOT NULL AND u.email != ''
  ORDER BY u.email ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_listar_usuarios_para_parceiro() TO authenticated;
