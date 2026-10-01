-- ==============================================================================
-- MIGRAÇÃO 0140: Correção Definitiva da RPC admin_alterar_trial_cadastro
-- Corrige a tabela de auditoria (admin_auditoria em vez de admin_audit_logs/admin_audits_logs)
-- e adiciona tratamento de erro silencioso para nunca interromper a ação do admin.
-- ==============================================================================

-- 1. Cria tabela de compatibilidade admin_audit_logs caso algum script antigo procure por ela
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID,
  acao TEXT,
  entidade TEXT,
  entidade_id TEXT,
  dados_anteriores JSONB,
  dados_novos JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Cria view/alias admin_audits_logs para compatibilidade com qualquer referência no plural
CREATE OR REPLACE VIEW public.admin_audits_logs AS 
SELECT * FROM public.admin_audit_logs;

-- 3. Permite ao admin atualizar a tabela plataforma_config diretamente
DROP POLICY IF EXISTS "Admin pode atualizar configuracao da plataforma" ON public.plataforma_config;
CREATE POLICY "Admin pode atualizar configuracao da plataforma" ON public.plataforma_config
  FOR UPDATE
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- 4. Redefine a RPC admin_alterar_trial_cadastro com auditoria blindada
CREATE OR REPLACE FUNCTION public.admin_alterar_trial_cadastro(
  p_ativo BOOLEAN,
  p_dias INTEGER DEFAULT 15
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_antigo_ativo BOOLEAN;
  v_antigo_dias INTEGER;
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Apenas o administrador da plataforma pode alterar as configurações de trial.';
  END IF;

  SELECT trial_cadastro_ativo, trial_dias_padrao
  INTO v_antigo_ativo, v_antigo_dias
  FROM public.plataforma_config
  WHERE id = 1;

  UPDATE public.plataforma_config
  SET trial_cadastro_ativo = p_ativo,
      trial_dias_padrao = COALESCE(p_dias, 15),
      updated_at = now()
  WHERE id = 1;

  -- Registrar log de auditoria com proteção de exceção para não abortar
  BEGIN
    INSERT INTO public.admin_auditoria (
      admin_user_id,
      acao,
      entidade,
      entidade_id,
      valor_anterior,
      valor_novo
    ) VALUES (
      auth.uid(),
      'alterar_trial_cadastro',
      'plataforma_config',
      '1',
      jsonb_build_object('trial_cadastro_ativo', v_antigo_ativo, 'trial_dias_padrao', v_antigo_dias),
      jsonb_build_object('trial_cadastro_ativo', p_ativo, 'trial_dias_padrao', p_dias)
    );
  EXCEPTION WHEN OTHERS THEN
    -- Auditoria opcional: se a tabela tiver outro formato ou não existir, não trava o toggle
    NULL;
  END;

  -- Log secundário na tabela de compatibilidade
  BEGIN
    INSERT INTO public.admin_audit_logs (
      admin_id,
      acao,
      entidade,
      entidade_id,
      dados_anteriores,
      dados_novos
    ) VALUES (
      auth.uid(),
      'alterar_trial_cadastro',
      'plataforma_config',
      '1',
      jsonb_build_object('trial_cadastro_ativo', v_antigo_ativo, 'trial_dias_padrao', v_antigo_dias),
      jsonb_build_object('trial_cadastro_ativo', p_ativo, 'trial_dias_padrao', p_dias)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_alterar_trial_cadastro(boolean, integer) TO authenticated;
