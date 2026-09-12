-- Migration 0112: Correção de Identificação de Planos e Membros na Academia (Vídeos e Materiais)
-- Corrige a identificação do plano real da oficina para funcionários (tenant_members)
-- e unifica o formato de retorno das RPCs obter_treinamentos_assinante e obter_materiais_assinante.

-- 1. CORRIGIR obter_treinamentos_assinante()
CREATE OR REPLACE FUNCTION public.obter_treinamentos_assinante()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_plano_codigo TEXT := 'free';
  v_is_admin BOOLEAN := false;
  v_resultado JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  v_is_admin := public.is_platform_admin();

  -- Localiza o tenant ativo do usuário autenticado através de tenant_members
  SELECT tm.tenant_id, COALESCE(t.plano::text, 'free')
  INTO v_tenant_id, v_plano_codigo
  FROM public.tenant_members tm
  JOIN public.tenants t ON t.id = tm.tenant_id
  WHERE tm.user_id = auth.uid() AND tm.status = 'ativo'
  LIMIT 1;

  -- Se for admin e não tiver tenant_members ativo, usa o primeiro tenant ou plano studio
  IF v_tenant_id IS NULL AND v_is_admin THEN
    SELECT t.id, COALESCE(t.plano::text, 'studio')
    INTO v_tenant_id, v_plano_codigo
    FROM public.tenants t
    LIMIT 1;
  END IF;

  -- Fallback para proprietário caso tenant_members ainda não tenha sincronizado
  IF v_tenant_id IS NULL THEN
    SELECT t.id, COALESCE(t.plano::text, 'free')
    INTO v_tenant_id, v_plano_codigo
    FROM public.tenants t
    WHERE t.criado_por = auth.uid()
    LIMIT 1;
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
        v_is_admin
        OR EXISTS (
          SELECT 1 FROM public.treinamento_planos tp
          WHERE tp.treinamento_id = t.id AND tp.plano = v_plano_codigo
        )
        OR NOT EXISTS (
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
    ) ORDER BY t.ordem ASC, t.created_at ASC
  ), '[]'::jsonb) INTO v_resultado
  FROM public.treinamentos t
  WHERE t.ativo = true;

  RETURN jsonb_build_object(
    'plano_atual', v_plano_codigo,
    'treinamentos', v_resultado
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_treinamentos_assinante() TO authenticated;


-- 2. CORRIGIR obter_materiais_assinante(text)
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
  v_is_admin BOOLEAN := false;
  v_resultado JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('erro', 'Não autenticado');
  END IF;

  v_is_admin := public.is_platform_admin();

  -- Localiza o tenant ativo do usuário autenticado através de tenant_members
  SELECT tm.tenant_id, COALESCE(t.plano::text, 'free')
  INTO v_tenant_id, v_plano
  FROM public.tenant_members tm
  JOIN public.tenants t ON t.id = tm.tenant_id
  WHERE tm.user_id = v_user_id AND tm.status = 'ativo'
  LIMIT 1;

  -- Se for admin da plataforma, libera modo completo
  IF v_tenant_id IS NULL AND v_is_admin THEN
    SELECT t.id, COALESCE(t.plano::text, 'studio')
    INTO v_tenant_id, v_plano
    FROM public.tenants t
    LIMIT 1;
  END IF;

  -- Fallback para proprietário do tenant
  IF v_tenant_id IS NULL THEN
    SELECT t.id, COALESCE(t.plano::text, 'free')
    INTO v_tenant_id, v_plano
    FROM public.tenants t
    WHERE t.criado_por = v_user_id
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
      v_is_admin
      OR m.planos_permitidos IS NULL 
      OR cardinality(m.planos_permitidos) = 0
      OR v_plano = ANY(m.planos_permitidos)
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
