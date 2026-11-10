-- ==============================================================================
-- MIGRAÇÃO 0172: SLUG EDITÁVEL DA OFICINA E VÍDEOS TUTORIAIS DINÂMICOS
-- ==============================================================================
-- 1. Cria RPC public.atualizar_slug_oficina(p_novo_slug, p_tenant_id) para o
--    proprietário (dono) personalizar diretamente o slug público da oficina
--    (/agendar/{slug}) com sanitização, proteção de rotas reservadas e unicidade.
-- 2. Cria bucket público onboarding-videos no Storage para upload nativo de
--    vídeos MP4/WebM de boas-vindas e dos tutoriais curtos sem restrição de plano.
-- 3. Adiciona coluna videos_tutoriais_etapas JSONB em public.plataforma_config
--    e atualiza obter_config_plataforma() + admin_salvar_config_onboarding()
--    para gerenciar o vídeo de 60s e as 7 etapas (etapa_2..etapa_8) via Admin.
-- ==============================================================================

-- 1. RPC SEGURA PARA EDIÇÃO DIRETA DO SLUG DA OFICINA PELO DONO
CREATE OR REPLACE FUNCTION public.atualizar_slug_oficina(
  p_novo_slug TEXT,
  p_tenant_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_tenant_id UUID;
  v_autorizado BOOLEAN := false;
  v_slug_limpo TEXT;
  v_slug_atual TEXT;
  v_reservados TEXT[] := ARRAY[
    'admin', 'api', 'app', 'agendar', 'agenda', 'hoje', 'dashboard',
    'orcamento', 'orcamentos', 'vistoria', 'checkin', 'execucao', 'atendimento',
    'termo-risco', 'garantia', 'certificado', 'calculadora', 'entrar', 'login',
    'criar-conta', 'cadastro', 'convite', 'lancamento', 'parceiro',
    'recuperar-senha', 'redefinir-senha', 'nova-oficina',
    'termos-de-uso', 'termos-uso', 'politica-de-privacidade', 'politica-privacidade',
    'clientes', 'veiculos', 'estoque', 'financeiro', 'servicos', 'precificacao',
    'treinamentos', 'arquivos-digitais', 'indique', 'diluicao', 'planos',
    'configuracoes', 'suporte', 'ajuda', 'nuvemwash'
  ];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  IF p_tenant_id IS NOT NULL THEN
    v_target_tenant_id := p_tenant_id;
  ELSE
    SELECT tm.tenant_id
    INTO v_target_tenant_id
    FROM public.tenant_members tm
    WHERE tm.user_id = auth.uid()
      AND tm.role = 'dono'
      AND tm.status = 'ativo'
    LIMIT 1;
  END IF;

  IF v_target_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: apenas o proprietário da oficina pode editar o endereço (slug).';
  END IF;

  SELECT (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = v_target_tenant_id
        AND tm.user_id = auth.uid()
        AND tm.role = 'dono'
        AND tm.status = 'ativo'
    )
    OR public.is_platform_admin()
  ) INTO v_autorizado;

  IF NOT COALESCE(v_autorizado, false) THEN
    RAISE EXCEPTION 'Acesso negado: apenas o proprietário da oficina pode editar o endereço (slug).';
  END IF;

  SELECT slug INTO v_slug_atual
  FROM public.tenants
  WHERE id = v_target_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oficina não encontrada.';
  END IF;

  -- Sanitização PT-BR -> ASCII lowercase slug
  v_slug_limpo := LOWER(TRIM(COALESCE(p_novo_slug, '')));
  v_slug_limpo := translate(
    v_slug_limpo,
    'áàâãäéèêëíìîïóòôõöúùûüçñýÿ',
    'aaaaaeeeeiiiiooooouuuucnyy'
  );
  v_slug_limpo := regexp_replace(v_slug_limpo, '[^a-z0-9]+', '-', 'g');
  v_slug_limpo := regexp_replace(v_slug_limpo, '^-+|-+$', '', 'g');

  IF v_slug_limpo IS NULL OR LENGTH(v_slug_limpo) < 3 OR LENGTH(v_slug_limpo) > 60 THEN
    RAISE EXCEPTION 'O endereço (slug) deve ter entre 3 e 60 caracteres válidos (letras minúsculas, números e hífen).';
  END IF;

  IF NOT (v_slug_limpo ~ '^[a-z0-9]+(-[a-z0-9]+)*$') THEN
    RAISE EXCEPTION 'O endereço (slug) pode conter apenas letras minúsculas, números e hífens sem repetições nas extremidades.';
  END IF;

  IF v_slug_limpo = ANY(v_reservados) THEN
    RAISE EXCEPTION 'O endereço "/agendar/%" é reservado pelo sistema. Escolha outro endereço.', v_slug_limpo;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tenants t
    WHERE LOWER(t.slug) = v_slug_limpo
      AND t.id <> v_target_tenant_id
  ) THEN
    RAISE EXCEPTION 'O endereço "/agendar/%" já está em uso por outra oficina. Por favor, escolha outro.', v_slug_limpo;
  END IF;

  IF v_slug_atual IS DISTINCT FROM v_slug_limpo THEN
    UPDATE public.tenants
    SET slug = v_slug_limpo,
        updated_at = now()
    WHERE id = v_target_tenant_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_target_tenant_id,
    'slug', v_slug_limpo
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.atualizar_slug_oficina(TEXT, UUID) TO authenticated;

-- 2. BUCKET PÚBLICO PARA VÍDEOS DE ONBOARDING E TUTORIAIS CURTOS
INSERT INTO storage.buckets (id, name, public)
VALUES ('onboarding-videos', 'onboarding-videos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Onboarding videos leitura publica" ON storage.objects;
CREATE POLICY "Onboarding videos leitura publica" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'onboarding-videos');

DROP POLICY IF EXISTS "Platform admin insere onboarding videos" ON storage.objects;
CREATE POLICY "Platform admin insere onboarding videos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'onboarding-videos'
    AND public.is_platform_admin()
  );

DROP POLICY IF EXISTS "Platform admin atualiza onboarding videos" ON storage.objects;
CREATE POLICY "Platform admin atualiza onboarding videos" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'onboarding-videos'
    AND public.is_platform_admin()
  );

DROP POLICY IF EXISTS "Platform admin deleta onboarding videos" ON storage.objects;
CREATE POLICY "Platform admin deleta onboarding videos" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'onboarding-videos'
    AND public.is_platform_admin()
  );

-- 3. COLUNA E RPCS PARA TUTORIAIS CURTOS DAS ETAPAS DO ONBOARDING PROGRESSIVO
ALTER TABLE public.plataforma_config
  ADD COLUMN IF NOT EXISTS videos_tutoriais_etapas JSONB NOT NULL DEFAULT '{}'::jsonb;

DROP FUNCTION IF EXISTS public.obter_config_plataforma();
CREATE OR REPLACE FUNCTION public.obter_config_plataforma()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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
    'video_onboarding_titulo', COALESCE(video_onboarding_titulo, 'Bem-vindo ao Nuvem Wash (60s)'),
    'video_onboarding_ativo', COALESCE(video_onboarding_ativo, true),
    'videos_tutoriais_etapas', COALESCE(videos_tutoriais_etapas, '{}'::jsonb),
    'updated_at', updated_at
  )
  INTO v_res
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
    'video_onboarding_titulo', 'Bem-vindo ao Nuvem Wash (60s)',
    'video_onboarding_ativo', true,
    'videos_tutoriais_etapas', '{}'::jsonb
  ));
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_config_plataforma() TO authenticated, anon;

DROP FUNCTION IF EXISTS public.admin_salvar_config_onboarding(TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.admin_salvar_config_onboarding(TEXT, TEXT, BOOLEAN, JSONB);

CREATE OR REPLACE FUNCTION public.admin_salvar_config_onboarding(
  p_video_url TEXT,
  p_titulo TEXT DEFAULT NULL,
  p_ativo BOOLEAN DEFAULT true,
  p_videos_etapas JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Apenas administradores da plataforma podem configurar os vídeos de onboarding';
  END IF;

  UPDATE public.plataforma_config
  SET video_onboarding_url = p_video_url,
      video_onboarding_titulo = COALESCE(p_titulo, video_onboarding_titulo, 'Bem-vindo ao Nuvem Wash (60s)'),
      video_onboarding_ativo = COALESCE(p_ativo, true),
      videos_tutoriais_etapas = COALESCE(p_videos_etapas, videos_tutoriais_etapas, '{}'::jsonb),
      updated_at = now()
  WHERE id = 1;

  RETURN jsonb_build_object(
    'sucesso', true,
    'video_onboarding_url', p_video_url,
    'video_onboarding_titulo', p_titulo,
    'video_onboarding_ativo', p_ativo,
    'videos_tutoriais_etapas', COALESCE(p_videos_etapas, '{}'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_salvar_config_onboarding(TEXT, TEXT, BOOLEAN, JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';

