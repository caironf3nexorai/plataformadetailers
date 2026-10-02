-- ==============================================================================
-- MIGRAÇÃO 0141: ADICIONAR CAMPOS DE PIXELS DE MARKETING EM plataforma_config
-- ==============================================================================

-- 1. ADICIONA AS COLUNAS DE PIXELS DE MARKETING
ALTER TABLE public.plataforma_config
  ADD COLUMN IF NOT EXISTS meta_pixel_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS google_ads_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS google_analytics_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tiktok_pixel_id TEXT DEFAULT NULL;

-- 2. ATUALIZAR RPC obter_config_plataforma() PARA INCLUIR OS PIXELS
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
    'trial_cadastro_ativo', COALESCE(trial_cadastro_ativo, true),
    'trial_dias_padrao', COALESCE(trial_dias_padrao, 15),
    'meta_pixel_id', meta_pixel_id,
    'google_ads_id', google_ads_id,
    'google_analytics_id', google_analytics_id,
    'tiktok_pixel_id', tiktok_pixel_id,
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
    'tiktok_pixel_id', null
  ));
END;
$$;
GRANT EXECUTE ON FUNCTION public.obter_config_plataforma() TO authenticated, anon;

-- 3. RPC PARA SALVAR CONFIGURAÇÕES DE PIXELS (APENAS ADMINISTRADORES DA PLATAFORMA)
DROP FUNCTION IF EXISTS public.admin_salvar_config_pixels(TEXT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.admin_salvar_config_pixels(
  p_meta_pixel_id TEXT DEFAULT NULL,
  p_google_ads_id TEXT DEFAULT NULL,
  p_google_analytics_id TEXT DEFAULT NULL,
  p_tiktok_pixel_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_is_admin BOOLEAN := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  SELECT is_super_admin INTO v_is_admin
  FROM public.admin_users
  WHERE user_id = v_user_id AND ativo = true;

  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores da plataforma podem alterar pixels de marketing.';
  END IF;

  UPDATE public.plataforma_config
  SET 
    meta_pixel_id = NULLIF(TRIM(p_meta_pixel_id), ''),
    google_ads_id = NULLIF(TRIM(p_google_ads_id), ''),
    google_analytics_id = NULLIF(TRIM(p_google_analytics_id), ''),
    tiktok_pixel_id = NULLIF(TRIM(p_tiktok_pixel_id), ''),
    updated_at = NOW()
  WHERE id = 1;

  RETURN jsonb_build_object(
    'sucesso', true,
    'mensagem', 'Configurações de pixels atualizadas com sucesso.',
    'meta_pixel_id', p_meta_pixel_id,
    'google_ads_id', p_google_ads_id,
    'google_analytics_id', p_google_analytics_id,
    'tiktok_pixel_id', p_tiktok_pixel_id
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_salvar_config_pixels(TEXT, TEXT, TEXT, TEXT) TO authenticated;
