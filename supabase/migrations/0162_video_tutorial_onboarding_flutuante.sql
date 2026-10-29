-- ==============================================================================
-- MIGRAÇÃO 0162: VÍDEO TUTORIAL DE ONBOARDING E INICIAÇÃO FLUTUANTE
-- ==============================================================================
-- Objetivo:
--   1. Adicionar campos centrais em public.plataforma_config para armazenar
--      a URL e título do vídeo de tutorial de iniciação da plataforma (aberto para todos).
--   2. Adicionar flag onboarding_concluido e onboarding_concluido_em em public.tenants.
--   3. Criar RPC marcar_onboarding_concluido() para registrar a conclusão permanente
--      pelo usuário / tenant, fazendo o player sumir para sempre.
--   4. Atualizar obter_config_plataforma() e criar RPC admin para gestão do vídeo.
-- ==============================================================================

-- 1. Colunas em plataforma_config
ALTER TABLE public.plataforma_config
  ADD COLUMN IF NOT EXISTS video_onboarding_url TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS video_onboarding_titulo TEXT DEFAULT 'Guia Rápido: Configuração Completa da Sua Oficina',
  ADD COLUMN IF NOT EXISTS video_onboarding_ativo BOOLEAN DEFAULT true;

-- 2. Colunas em tenants para rastreabilidade de conclusão do tutorial de setup
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS onboarding_concluido BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_concluido_em TIMESTAMPTZ DEFAULT NULL;

-- 3. Atualizar obter_config_plataforma() para expor os dados do vídeo de onboarding
DROP FUNCTION IF EXISTS public.obter_config_plataforma();
CREATE OR REPLACE FUNCTION public.obter_config_plataforma()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_res JSONB;
BEGIN
  SELECT jsonb_build_object(
    'bloqueio_planos_ativo', COALESCE(bloqueio_planos_ativo, false),
    'trial_cadastro_ativo', COALESCE(trial_cadastro_ativo, trial_ativo, true),
    'trial_dias_padrao', COALESCE(trial_dias_padrao, trial_dias, 15),
    'meta_pixel_id', meta_pixel_id,
    'google_ads_id', google_ads_id,
    'google_analytics_id', google_analytics_id,
    'tiktok_pixel_id', tiktok_pixel_id,
    'video_onboarding_url', video_onboarding_url,
    'video_onboarding_titulo', COALESCE(video_onboarding_titulo, 'Guia Rápido: Configuração Completa da Sua Oficina'),
    'video_onboarding_ativo', COALESCE(video_onboarding_ativo, true),
    'updated_at', updated_at
  ) INTO v_res
  FROM public.plataforma_config
  WHERE id = 1;

  RETURN COALESCE(v_res, jsonb_build_object(
    'bloqueio_planos_ativo', false,
    'trial_cadastro_ativo', true,
    'trial_dias_padrao', 15,
    'meta_pixel_id', null,
    'google_ads_id', null,
    'google_analytics_id', null,
    'tiktok_pixel_id', null,
    'video_onboarding_url', null,
    'video_onboarding_titulo', 'Guia Rápido: Configuração Completa da Sua Oficina',
    'video_onboarding_ativo', true
  ));
END;
$$;
GRANT EXECUTE ON FUNCTION public.obter_config_plataforma() TO authenticated, anon;

-- 4. RPC para marcar onboarding como concluído pelo tenant autenticado
CREATE OR REPLACE FUNCTION public.marcar_onboarding_concluido(
  p_tenant_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_tenant_id UUID;
  v_eh_membro BOOLEAN := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  -- Se tenant foi passado, valida permissão
  IF p_tenant_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.tenant_members
      WHERE tenant_id = p_tenant_id AND user_id = auth.uid() AND status = 'ativo'
    ) OR EXISTS (
      SELECT 1 FROM public.tenants
      WHERE id = p_tenant_id AND criado_por = auth.uid()
    ) OR public.is_platform_admin() INTO v_eh_membro;

    IF NOT v_eh_membro THEN
      RAISE EXCEPTION 'Acesso negado para o tenant informado';
    END IF;
    v_target_tenant_id := p_tenant_id;
  ELSE
    -- Pega o tenant ativo do usuário
    SELECT tm.tenant_id INTO v_target_tenant_id
    FROM public.tenant_members tm
    WHERE tm.user_id = auth.uid() AND tm.status = 'ativo'
    LIMIT 1;

    IF v_target_tenant_id IS NULL THEN
      SELECT t.id INTO v_target_tenant_id
      FROM public.tenants t
      WHERE t.criado_por = auth.uid()
      LIMIT 1;
    END IF;
  END IF;

  IF v_target_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma oficina localizada para este usuário';
  END IF;

  UPDATE public.tenants
  SET onboarding_concluido = true,
      onboarding_concluido_em = now(),
      updated_at = now()
  WHERE id = v_target_tenant_id;

  RETURN jsonb_build_object(
    'sucesso', true,
    'tenant_id', v_target_tenant_id,
    'onboarding_concluido', true,
    'concluido_em', now()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.marcar_onboarding_concluido(UUID) TO authenticated;

-- 5. RPC Administrativa para salvar ou atualizar o vídeo de onboarding
CREATE OR REPLACE FUNCTION public.admin_salvar_config_onboarding(
  p_video_url TEXT,
  p_titulo TEXT DEFAULT NULL,
  p_ativo BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Apenas administradores da plataforma podem configurar o vídeo de onboarding';
  END IF;

  UPDATE public.plataforma_config
  SET video_onboarding_url = p_video_url,
      video_onboarding_titulo = COALESCE(p_titulo, video_onboarding_titulo, 'Guia Rápido: Configuração Completa da Sua Oficina'),
      video_onboarding_ativo = COALESCE(p_ativo, true),
      updated_at = now()
  WHERE id = 1;

  RETURN jsonb_build_object(
    'sucesso', true,
    'video_onboarding_url', p_video_url,
    'video_onboarding_titulo', p_titulo,
    'video_onboarding_ativo', p_ativo
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_salvar_config_onboarding(TEXT, TEXT, BOOLEAN) TO authenticated;
