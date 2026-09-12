-- ==============================================================================
-- MIGRAÇÃO 0111: MATERIAIS DIDÁTICOS (ACADEMIA DETAILER) & CONTROLE DE DOWNLOAD
-- ==============================================================================

-- 1. BUCKET DE ARMAZENAMENTO PARA MATERIAIS DIDÁTICOS (PDFs, E-BOOKS, MANUAIS)
INSERT INTO storage.buckets (id, name, public)
VALUES ('academia-materiais', 'academia-materiais', true)
ON CONFLICT (id) DO NOTHING;

-- Políticas do Storage para o Bucket academia-materiais
DROP POLICY IF EXISTS "Academia materiais visualizacao autenticados" ON storage.objects;
CREATE POLICY "Academia materiais visualizacao autenticados" ON storage.objects
  FOR SELECT USING (bucket_id = 'academia-materiais');

DROP POLICY IF EXISTS "Platform admin insere materiais" ON storage.objects;
CREATE POLICY "Platform admin insere materiais" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'academia-materiais' 
    AND public.is_platform_admin()
  );

DROP POLICY IF EXISTS "Platform admin atualiza materiais" ON storage.objects;
CREATE POLICY "Platform admin atualiza materiais" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'academia-materiais' 
    AND public.is_platform_admin()
  );

DROP POLICY IF EXISTS "Platform admin deleta materiais" ON storage.objects;
CREATE POLICY "Platform admin deleta materiais" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'academia-materiais' 
    AND public.is_platform_admin()
  );

-- 2. TABELA PRINCIPAL DE MATERIAIS DIDÁTICOS
CREATE TABLE IF NOT EXISTS public.academia_materiais (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo TEXT NOT NULL,
  descricao TEXT NULL,
  categoria TEXT NOT NULL DEFAULT 'Geral', -- 'Precificação', 'Tráfego Pago', 'Gestão & Vendas', 'Técnica & Polimento', 'Checklists & Processos'
  arquivo_path TEXT NOT NULL,
  arquivo_nome TEXT NOT NULL,
  tamanho_bytes BIGINT DEFAULT 0,
  total_paginas INTEGER DEFAULT 0,
  capa_url TEXT NULL,
  permitir_download BOOLEAN NOT NULL DEFAULT false, -- false = 🔒 Apenas Leitor Seguro (DRM Anti-Cópia), true = 📥 Download Liberado
  planos_permitidos TEXT[] NOT NULL DEFAULT ARRAY['pro', 'studio'],
  ordem INTEGER NOT NULL DEFAULT 0,
  ativo BOOLEAN NOT NULL DEFAULT true,
  visualizacoes_count INTEGER NOT NULL DEFAULT 0,
  downloads_count INTEGER NOT NULL DEFAULT 0,
  criado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_academia_materiais_cat ON public.academia_materiais(categoria, ativo);
CREATE INDEX IF NOT EXISTS idx_academia_materiais_ordem ON public.academia_materiais(ordem ASC, created_at DESC);

-- HABILITAR RLS
ALTER TABLE public.academia_materiais ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Leitura de materiais ativos ou admin" ON public.academia_materiais;
CREATE POLICY "Leitura de materiais ativos ou admin" ON public.academia_materiais
  FOR SELECT TO authenticated
  USING (ativo = true OR public.is_platform_admin());

DROP POLICY IF EXISTS "Admin gerencia materiais" ON public.academia_materiais;
CREATE POLICY "Admin gerencia materiais" ON public.academia_materiais
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- 3. ADICIONAR COLUNA PERMITIR_DOWNLOAD NA TABELA DE MODELOS DE TERMOS
ALTER TABLE public.plataforma_modelos_termos 
ADD COLUMN IF NOT EXISTS permitir_download BOOLEAN NOT NULL DEFAULT true;

-- 4. RPCS PARA ACADEMIA DE MATERIAIS

-- 4.1 Obter Materiais para o Assinante (com checagem de plano e bloqueios)
DROP FUNCTION IF EXISTS public.obter_materiais_assinante(text);
CREATE OR REPLACE FUNCTION public.obter_materiais_assinante(
  p_categoria TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_tenant_id UUID;
  v_plano TEXT := 'free';
  v_resultado JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('erro', 'Não autenticado');
  END IF;

  -- Localiza o tenant e o plano do usuário através de tenant_members
  SELECT tm.tenant_id, COALESCE(t.plano::text, 'free')
  INTO v_tenant_id, v_plano
  FROM public.tenant_members tm
  JOIN public.tenants t ON t.id = tm.tenant_id
  WHERE tm.user_id = v_user_id AND tm.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    SELECT t.id, COALESCE(t.plano::text, 'free')
    INTO v_tenant_id, v_plano
    FROM public.tenants t
    WHERE t.criado_por = v_user_id
    LIMIT 1;
  END IF;

  IF v_tenant_id IS NULL AND public.is_platform_admin() THEN
    SELECT t.id, COALESCE(t.plano::text, 'studio')
    INTO v_tenant_id, v_plano
    FROM public.tenants t
    LIMIT 1;
  END IF;

  IF v_plano IS NULL THEN
    v_plano := 'free';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'titulo', m.titulo,
    'descricao', m.descricao,
    'categoria', m.categoria,
    'arquivo_path', m.arquivo_path,
    'arquivo_nome', m.arquivo_nome,
    'tamanho_bytes', m.tamanho_bytes,
    'total_paginas', m.total_paginas,
    'capa_url', m.capa_url,
    'permitir_download', m.permitir_download,
    'planos_permitidos', m.planos_permitidos,
    'ordem', m.ordem,
    'disponivel_no_plano_atual', (
      m.planos_permitidos IS NULL 
      OR v_plano = ANY(m.planos_permitidos)
      OR public.is_platform_admin()
    ),
    'created_at', m.created_at
  ) ORDER BY m.ordem ASC, m.created_at DESC), '[]'::jsonb)
  INTO v_resultado
  FROM public.academia_materiais m
  WHERE m.ativo = true
    AND (p_categoria IS NULL OR m.categoria = p_categoria);

  RETURN jsonb_build_object(
    'plano_atual', v_plano,
    'materiais', v_resultado
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_materiais_assinante(text) TO authenticated;

-- 4.2 Admin: Listar Materiais com Métricas
DROP FUNCTION IF EXISTS public.admin_obter_materiais();
CREATE OR REPLACE FUNCTION public.admin_obter_materiais()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso restrito a administradores.';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'titulo', m.titulo,
    'descricao', m.descricao,
    'categoria', m.categoria,
    'arquivo_path', m.arquivo_path,
    'arquivo_nome', m.arquivo_nome,
    'tamanho_bytes', m.tamanho_bytes,
    'total_paginas', m.total_paginas,
    'capa_url', m.capa_url,
    'permitir_download', m.permitir_download,
    'planos_permitidos', m.planos_permitidos,
    'ordem', m.ordem,
    'ativo', m.ativo,
    'visualizacoes_count', m.visualizacoes_count,
    'downloads_count', m.downloads_count,
    'created_at', m.created_at
  ) ORDER BY m.ordem ASC, m.created_at DESC), '[]'::jsonb)
  INTO v_res
  FROM public.academia_materiais m;

  RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_obter_materiais() TO authenticated;

-- 4.3 Admin: Salvar Material (Criar ou Atualizar)
DROP FUNCTION IF EXISTS public.admin_salvar_material(jsonb);
CREATE OR REPLACE FUNCTION public.admin_salvar_material(
  p_material JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_planos TEXT[];
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso restrito a administradores.';
  END IF;

  IF p_material->>'id' IS NOT NULL AND (p_material->>'id') != '' THEN
    v_id := (p_material->>'id')::UUID;
  END IF;

  IF p_material->'planos_permitidos' IS NOT NULL THEN
    SELECT ARRAY(SELECT jsonb_array_elements_text(p_material->'planos_permitidos')) INTO v_planos;
  ELSE
    v_planos := ARRAY['pro', 'studio'];
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE public.academia_materiais
    SET
      titulo = p_material->>'titulo',
      descricao = p_material->>'descricao',
      categoria = COALESCE(p_material->>'categoria', 'Geral'),
      arquivo_path = COALESCE(p_material->>'arquivo_path', arquivo_path),
      arquivo_nome = COALESCE(p_material->>'arquivo_nome', arquivo_nome),
      tamanho_bytes = COALESCE((p_material->>'tamanho_bytes')::BIGINT, tamanho_bytes),
      total_paginas = COALESCE((p_material->>'total_paginas')::INTEGER, total_paginas),
      capa_url = p_material->>'capa_url',
      permitir_download = COALESCE((p_material->>'permitir_download')::BOOLEAN, false),
      planos_permitidos = v_planos,
      ordem = COALESCE((p_material->>'ordem')::INTEGER, 0),
      ativo = COALESCE((p_material->>'ativo')::BOOLEAN, true),
      updated_at = now()
    WHERE id = v_id;
  ELSE
    INSERT INTO public.academia_materiais (
      titulo,
      descricao,
      categoria,
      arquivo_path,
      arquivo_nome,
      tamanho_bytes,
      total_paginas,
      capa_url,
      permitir_download,
      planos_permitidos,
      ordem,
      ativo,
      criado_por
    ) VALUES (
      p_material->>'titulo',
      p_material->>'descricao',
      COALESCE(p_material->>'categoria', 'Geral'),
      p_material->>'arquivo_path',
      COALESCE(p_material->>'arquivo_nome', 'material.pdf'),
      COALESCE((p_material->>'tamanho_bytes')::BIGINT, 0),
      COALESCE((p_material->>'total_paginas')::INTEGER, 0),
      p_material->>'capa_url',
      COALESCE((p_material->>'permitir_download')::BOOLEAN, false),
      v_planos,
      COALESCE((p_material->>'ordem')::INTEGER, 0),
      COALESCE((p_material->>'ativo')::BOOLEAN, true),
      auth.uid()
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_salvar_material(jsonb) TO authenticated;

-- 4.4 Admin: Excluir Material
DROP FUNCTION IF EXISTS public.admin_excluir_material(uuid);
CREATE OR REPLACE FUNCTION public.admin_excluir_material(
  p_material_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso restrito a administradores.';
  END IF;

  DELETE FROM public.academia_materiais WHERE id = p_material_id;

  RETURN jsonb_build_object('sucesso', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_excluir_material(uuid) TO authenticated;

-- 4.5 Registrar Acesso ou Download de Material
DROP FUNCTION IF EXISTS public.registrar_acesso_material(uuid, text);
CREATE OR REPLACE FUNCTION public.registrar_acesso_material(
  p_material_id UUID,
  p_tipo TEXT DEFAULT 'visualizacao'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_tipo = 'download' THEN
    UPDATE public.academia_materiais
    SET downloads_count = downloads_count + 1
    WHERE id = p_material_id;
  ELSE
    UPDATE public.academia_materiais
    SET visualizacoes_count = visualizacoes_count + 1
    WHERE id = p_material_id;
  END IF;

  RETURN jsonb_build_object('sucesso', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_acesso_material(uuid, text) TO authenticated;

-- 5. ATUALIZAR FUNÇÕES DE MODELOS DE TERMOS PARA SUPORTAR PERMITIR_DOWNLOAD

-- 5.1 Atualizar listar_modelos_termos para incluir permitir_download
CREATE OR REPLACE FUNCTION public.listar_modelos_termos(
  p_categoria TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res JSONB;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'titulo', m.titulo,
    'categoria', m.categoria,
    'tipo_servico', m.tipo_servico,
    'descricao', m.descricao,
    'conteudo_texto', m.conteudo_texto,
    'arquivo_url', m.arquivo_url,
    'arquivo_nome', m.arquivo_nome,
    'arquivo_tipo', m.arquivo_tipo,
    'arquivo_tamanho_bytes', m.arquivo_tamanho_bytes,
    'permitir_download', m.permitir_download,
    'destaque', m.destaque,
    'downloads_count', m.downloads_count,
    'aplicacoes_count', m.aplicacoes_count,
    'created_at', m.created_at
  ) ORDER BY m.destaque DESC, m.created_at DESC), '[]'::jsonb)
  INTO v_res
  FROM public.plataforma_modelos_termos m
  WHERE m.ativo = true
    AND (p_categoria IS NULL OR m.categoria = p_categoria);

  RETURN v_res;
END;
$$;

-- 5.2 Atualizar admin_listar_modelos_termos para incluir permitir_download
CREATE OR REPLACE FUNCTION public.admin_listar_modelos_termos()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso restrito a administradores da plataforma.';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'titulo', m.titulo,
    'categoria', m.categoria,
    'tipo_servico', m.tipo_servico,
    'descricao', m.descricao,
    'conteudo_texto', m.conteudo_texto,
    'arquivo_url', m.arquivo_url,
    'arquivo_nome', m.arquivo_nome,
    'arquivo_tipo', m.arquivo_tipo,
    'arquivo_tamanho_bytes', m.arquivo_tamanho_bytes,
    'permitir_download', m.permitir_download,
    'destaque', m.destaque,
    'ativo', m.ativo,
    'downloads_count', m.downloads_count,
    'aplicacoes_count', m.aplicacoes_count,
    'created_at', m.created_at
  ) ORDER BY m.created_at DESC), '[]'::jsonb)
  INTO v_res
  FROM public.plataforma_modelos_termos m;

  RETURN v_res;
END;
$$;

-- 5.3 Atualizar admin_salvar_modelo_termo para persistir permitir_download
DROP FUNCTION IF EXISTS public.admin_salvar_modelo_termo(uuid, text, text, text, text, text, text, text, text, bigint, boolean, boolean);
DROP FUNCTION IF EXISTS public.admin_salvar_modelo_termo(uuid, text, text, text, text, text, text, text, text, bigint, boolean, boolean, boolean);
CREATE OR REPLACE FUNCTION public.admin_salvar_modelo_termo(
  p_id UUID DEFAULT NULL,
  p_titulo TEXT DEFAULT NULL,
  p_categoria TEXT DEFAULT 'responsabilidade',
  p_tipo_servico TEXT DEFAULT NULL,
  p_descricao TEXT DEFAULT NULL,
  p_conteudo_texto TEXT DEFAULT NULL,
  p_arquivo_url TEXT DEFAULT NULL,
  p_arquivo_nome TEXT DEFAULT NULL,
  p_arquivo_tipo TEXT DEFAULT NULL,
  p_arquivo_tamanho_bytes BIGINT DEFAULT NULL,
  p_destaque BOOLEAN DEFAULT false,
  p_ativo BOOLEAN DEFAULT true,
  p_permitir_download BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso restrito a administradores da plataforma.';
  END IF;

  IF p_titulo IS NULL OR trim(p_titulo) = '' THEN
    RAISE EXCEPTION 'O título do modelo é obrigatório.';
  END IF;

  IF p_conteudo_texto IS NULL OR trim(p_conteudo_texto) = '' THEN
    RAISE EXCEPTION 'O conteúdo do termo é obrigatório.';
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE public.plataforma_modelos_termos SET
      titulo = trim(p_titulo),
      categoria = p_categoria,
      tipo_servico = p_tipo_servico,
      descricao = trim(p_descricao),
      conteudo_texto = trim(p_conteudo_texto),
      arquivo_url = p_arquivo_url,
      arquivo_nome = p_arquivo_nome,
      arquivo_tipo = p_arquivo_tipo,
      arquivo_tamanho_bytes = p_arquivo_tamanho_bytes,
      permitir_download = COALESCE(p_permitir_download, true),
      destaque = p_destaque,
      ativo = p_ativo,
      updated_at = now()
    WHERE id = p_id;
    v_id := p_id;
  ELSE
    INSERT INTO public.plataforma_modelos_termos (
      titulo,
      categoria,
      tipo_servico,
      descricao,
      conteudo_texto,
      arquivo_url,
      arquivo_nome,
      arquivo_tipo,
      arquivo_tamanho_bytes,
      permitir_download,
      destaque,
      ativo,
      criado_por
    ) VALUES (
      trim(p_titulo),
      p_categoria,
      p_tipo_servico,
      trim(p_descricao),
      trim(p_conteudo_texto),
      p_arquivo_url,
      p_arquivo_nome,
      p_arquivo_tipo,
      p_arquivo_tamanho_bytes,
      COALESCE(p_permitir_download, true),
      p_destaque,
      p_ativo,
      auth.uid()
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_salvar_modelo_termo(uuid, text, text, text, text, text, text, text, text, bigint, boolean, boolean, boolean) TO authenticated;
