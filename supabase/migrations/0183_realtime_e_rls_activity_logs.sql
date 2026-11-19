-- ==============================================================================
-- Migration 0183: REALTIME & DESBLOQUEIO DE RLS EM USER_ACTIVITY_LOGS
-- - Permite SELECT para o próprio usuário (auth.uid() = user_id) e administradores,
--   evitando erro 403 em operações PostgREST com retorno de representação.
-- - Ativa REPLICA IDENTITY FULL e adiciona public.user_activity_logs na publicação
--   supabase_realtime para atualização em tempo real no Radar do Admin.
-- ==============================================================================

BEGIN;

-- 1. POLÍTICAS RLS BLINDADAS E COMPATÍVEIS COM POSTGREST
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
  USING (auth.uid() = user_id OR public.is_platform_admin());

DROP POLICY IF EXISTS user_activity_logs_delete ON public.user_activity_logs;
CREATE POLICY user_activity_logs_delete 
  ON public.user_activity_logs 
  FOR DELETE 
  TO authenticated 
  USING (public.is_platform_admin());

REVOKE ALL ON TABLE public.user_activity_logs FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.user_activity_logs TO authenticated;
GRANT ALL ON TABLE public.user_activity_logs TO service_role;

-- 2. SUPORTE A SUPABASE REALTIME
ALTER TABLE public.user_activity_logs REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'user_activity_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_activity_logs;
  END IF;
END $$;

COMMIT;

