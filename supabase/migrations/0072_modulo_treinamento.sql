-- ==============================================================================
-- MIGAÇÃO 0072: MÓDULO DE TREINAMENTO (VÍDEOS DE CAPACITAÇÃO E ONBOARDING)
-- ==============================================================================

-- 1. TABELA PRINCIPAL DE TREINAMENTOS (CATÁLOGO GLOBAL)
CREATE TABLE IF NOT EXISTS public.treinamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo TEXT NOT NULL,
  descricao TEXT,
  url TEXT NOT NULL,
  plataforma TEXT NOT NULL CHECK (plataforma IN ('youtube', 'vimeo')),
  video_id TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'Geral',
  duracao_minutos INTEGER DEFAULT 0,
  ordem INTEGER DEFAULT 0,
  essencial BOOLEAN DEFAULT false,
  ativo BOOLEAN DEFAULT true,
  criado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. VÍNCULO DE TREINAMENTO COM PLANOS
CREATE TABLE IF NOT EXISTS public.treinamento_planos (
  treinamento_id UUID NOT NULL REFERENCES public.treinamentos(id) ON DELETE CASCADE,
  plano TEXT NOT NULL REFERENCES public.plans(codigo) ON DELETE CASCADE,
  PRIMARY KEY (treinamento_id, plano)
);

-- 3. VISUALIZAÇÕES E PROGRESSO DOS USUÁRIOS
CREATE TABLE IF NOT EXISTS public.treinamento_visualizacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  treinamento_id UUID NOT NULL REFERENCES public.treinamentos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL DEFAULT auth.uid(),
  tenant_id UUID NOT NULL,
  concluido_em TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_treinamento_user UNIQUE (treinamento_id, user_id)
);

-- HABILITAR RLS NAS 3 TABELAS
ALTER TABLE public.treinamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treinamento_planos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treinamento_visualizacoes ENABLE ROW LEVEL SECURITY;

-- POLÍTICAS RLS DE TREINAMENTOS
DROP POLICY IF EXISTS "Leitura de treinamentos ativados ou admin" ON public.treinamentos;
CREATE POLICY "Leitura de treinamentos ativados ou admin" ON public.treinamentos
  FOR SELECT TO authenticated
  USING (ativo = true OR public.is_platform_admin());

DROP POLICY IF EXISTS "Admin pode gerenciar treinamentos" ON public.treinamentos;
CREATE POLICY "Admin pode gerenciar treinamentos" ON public.treinamentos
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- POLÍTICAS RLS DE TREINAMENTO PLANOS
DROP POLICY IF EXISTS "Leitura de planos de treinamento por autenticados" ON public.treinamento_planos;
CREATE POLICY "Leitura de planos de treinamento por autenticados" ON public.treinamento_planos
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admin pode gerenciar planos de treinamento" ON public.treinamento_planos;
CREATE POLICY "Admin pode gerenciar planos de treinamento" ON public.treinamento_planos
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- POLÍTICAS RLS DE VISUALIZAÇÕES
DROP POLICY IF EXISTS "Usuario gerencia suas proprias visualizacoes" ON public.treinamento_visualizacoes;
CREATE POLICY "Usuario gerencia suas proprias visualizacoes" ON public.treinamento_visualizacoes
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ==============================================================================
-- FUNÇÃO RPC: OBTER TREINAMENTOS PARA ASSINANTE (COM DISPONIBILIDADE E STATUS)
-- ==============================================================================
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

  v_tenant_id := (public.meus_tenants())[1];

  IF v_tenant_id IS NOT NULL THEN
    SELECT p.codigo INTO v_plano_codigo
    FROM public.tenants t
    LEFT JOIN public.plans p ON p.codigo = t.plano_codigo
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
        ) OR NOT EXISTS (
          SELECT 1 FROM public.treinamento_planos tp
          WHERE tp.treinamento_id = t.id
        )
      ),
      'concluido', (
        EXISTS (
          SELECT 1 FROM public.treinamento_visualizacoes tv
          WHERE tv.treinamento_id = t.id AND tv.user_id = auth.uid()
        )
      )
    ) ORDER BY t.ordem ASC, t.created_at DESC
  ), '[]'::jsonb)
  INTO v_resultado
  FROM public.treinamentos t
  WHERE t.ativo = true;

  RETURN jsonb_build_object(
    'plano_atual', v_plano_codigo,
    'treinamentos', v_resultado
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_treinamentos_assinante() TO authenticated;


-- ==============================================================================
-- FUNÇÃO RPC: MARCAR OU DESMARCAR TREINAMENTO COMO VISUALIZADO
-- ==============================================================================
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

  v_tenant_id := (public.meus_tenants())[1];

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


-- ==============================================================================
-- FUNÇÃO RPC ADMIN: OBTER TREINAMENTOS COM MÉTRICAS DE ENGAJAMENTO (OFICINAS UNICAS)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.admin_obter_treinamentos()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_resultado JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado. Apenas administradores da plataforma.';
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
      'ativo', t.ativo,
      'created_at', t.created_at,
      'planos_permitidos', (
        SELECT coalesce(jsonb_agg(tp.plano), '[]'::jsonb)
        FROM public.treinamento_planos tp
        WHERE tp.treinamento_id = t.id
      ),
      'oficinas_assistiram_count', (
        SELECT count(DISTINCT tv.tenant_id)
        FROM public.treinamento_visualizacoes tv
        WHERE tv.treinamento_id = t.id
      )
    ) ORDER BY t.ordem ASC, t.created_at DESC
  ), '[]'::jsonb)
  INTO v_resultado
  FROM public.treinamentos t;

  RETURN v_resultado;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_obter_treinamentos() TO authenticated;


-- ==============================================================================
-- FUNÇÃO RPC ADMIN: SALVAR / ATUALIZAR TREINAMENTO E PLANOS
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.admin_salvar_treinamento(
  p_id UUID DEFAULT NULL,
  p_titulo TEXT DEFAULT NULL,
  p_descricao TEXT DEFAULT NULL,
  p_url TEXT DEFAULT NULL,
  p_plataforma TEXT DEFAULT NULL,
  p_video_id TEXT DEFAULT NULL,
  p_categoria TEXT DEFAULT 'Geral',
  p_duracao_minutos INTEGER DEFAULT 0,
  p_ordem INTEGER DEFAULT 0,
  p_essencial BOOLEAN DEFAULT false,
  p_ativo BOOLEAN DEFAULT true,
  p_planos TEXT[] DEFAULT ARRAY[]::TEXT[]
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_plano TEXT;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado. Apenas administradores da plataforma.';
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE public.treinamentos SET
      titulo = coalesce(p_titulo, titulo),
      descricao = p_descricao,
      url = coalesce(p_url, url),
      plataforma = coalesce(p_plataforma, plataforma),
      video_id = coalesce(p_video_id, video_id),
      categoria = coalesce(p_categoria, categoria),
      duracao_minutos = coalesce(p_duracao_minutos, duracao_minutos),
      ordem = coalesce(p_ordem, ordem),
      essencial = coalesce(p_essencial, essencial),
      ativo = coalesce(p_ativo, ativo),
      updated_at = now()
    WHERE id = p_id;
    v_id := p_id;
  ELSE
    INSERT INTO public.treinamentos (
      titulo, descricao, url, plataforma, video_id, categoria, duracao_minutos, ordem, essencial, ativo, criado_por
    ) VALUES (
      p_titulo, p_descricao, p_url, p_plataforma, p_video_id, p_categoria, coalesce(p_duracao_minutos, 0), coalesce(p_ordem, 0), coalesce(p_essencial, false), coalesce(p_ativo, true), auth.uid()
    ) RETURNING id INTO v_id;
  END IF;

  -- Atualiza planos associados
  DELETE FROM public.treinamento_planos WHERE treinamento_id = v_id;
  IF p_planos IS NOT NULL AND array_length(p_planos, 1) > 0 THEN
    FOREACH v_plano IN ARRAY p_planos LOOP
      INSERT INTO public.treinamento_planos (treinamento_id, plano)
      VALUES (v_id, v_plano)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_salvar_treinamento TO authenticated;
