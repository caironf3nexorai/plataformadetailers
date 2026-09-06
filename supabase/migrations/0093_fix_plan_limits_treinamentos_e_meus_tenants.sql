-- ==============================================================================
-- MIGRAÇÃO 0093: FIX PLAN_LIMITS (UPDATED_AT), TREINAMENTOS, ISOLAMENTO TENANT E AUDITORIA
-- ==============================================================================

-- 1. Garantir que plan_limits possui updated_at
ALTER TABLE public.plan_limits 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 2. Garantir que audit_logs e current_admin_email existem para a auditoria de planos
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT,
  acao TEXT NOT NULL,
  entidade TEXT,
  registro_id TEXT,
  detalhes JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Audit logs select platform admin" ON public.audit_logs;
CREATE POLICY "Audit logs select platform admin" ON public.audit_logs
  FOR SELECT USING (public.is_platform_admin());

CREATE OR REPLACE FUNCTION public.current_admin_email()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT email::TEXT FROM auth.users WHERE id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.current_admin_email() TO authenticated;

-- 3. Restaurar isolamento estrito de meus_tenants()
-- Platform admins já usam funções SECURITY DEFINER específicas com is_platform_admin().
-- meus_tenants() DEVE retornar apenas os tenants aos quais o usuário de fato pertence como membro,
-- para que o admin não veja dados de todas as oficinas misturados (categorias, orçamentos, clientes, etc).
CREATE OR REPLACE FUNCTION public.meus_tenants()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT tenant_id FROM public.tenant_members
  WHERE user_id = auth.uid() AND status = 'ativo';
$$;

GRANT EXECUTE ON FUNCTION public.meus_tenants() TO authenticated;

-- 4. Corrigir obter_treinamentos_assinante()
-- O campo na tabela tenants é "plano" e não "plano_codigo". Além disso, meus_tenants() retorna SETOF UUID (não é array).
CREATE OR REPLACE FUNCTION public.obter_treinamentos_assinante()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_plano_codigo TEXT := 'free';
  v_resultado JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT tenant_id INTO v_tenant_id
  FROM public.tenant_members
  WHERE user_id = auth.uid() AND status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NOT NULL THEN
    SELECT t.plano INTO v_plano_codigo
    FROM public.tenants t
    WHERE t.id = v_tenant_id;
  END IF;

  IF v_plano_codigo IS NULL THEN
    v_plano_codigo := 'free';
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'titulo', t.titulo,
      'descricao', t.descricao,
      'url', t.url,
      'plataforma', t.plataforma,
      'video_id', t.video_id,
      'categoria', t.categoria,
      'duracao_minutos', t.duracao_minutos,
      'ordem', t.ordem,
      'essencial', t.essencial,
      'planos_permitidos', (
        SELECT coalesce(jsonb_agg(tp.plano), '[]'::jsonb)
        FROM public.treinamento_planos tp
        WHERE tp.treinamento_id = t.id
      ),
      'disponivel_no_plano_atual', (
        EXISTS (
          SELECT 1 FROM public.treinamento_planos tp
          WHERE tp.treinamento_id = t.id AND tp.plano = v_plano_codigo
        )
      )
    ) ORDER BY t.ordem ASC, t.created_at ASC
  ), '[]'::jsonb) INTO v_resultado
  FROM public.treinamentos t
  WHERE t.ativo = true;

  RETURN v_resultado;
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_treinamentos_assinante() TO authenticated;

-- 5. Corrigir marcar_treinamento_visualizado() para usar LIMIT 1 em vez de [1]
CREATE OR REPLACE FUNCTION public.marcar_treinamento_visualizado(
  p_treinamento_id UUID,
  p_concluido BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT tenant_id INTO v_tenant_id
  FROM public.tenant_members
  WHERE user_id = auth.uid() AND status = 'ativo'
  LIMIT 1;

  IF p_concluido THEN
    INSERT INTO public.treinamento_visualizacoes (treinamento_id, user_id, tenant_id, concluido_em)
    VALUES (p_treinamento_id, auth.uid(), v_tenant_id, now())
    ON CONFLICT (treinamento_id, user_id) DO NOTHING;
  ELSE
    DELETE FROM public.treinamento_visualizacoes
    WHERE treinamento_id = p_treinamento_id AND user_id = auth.uid();
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.marcar_treinamento_visualizado(UUID, BOOLEAN) TO authenticated;
