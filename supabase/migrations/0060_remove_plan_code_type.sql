-- Migration 0060: Remover Definitivamente o Tipo public.plan_code e Atualizar as 10 Funções Remanescentes

-- ==============================================================================
-- 1. dentro_do_limite(uuid, text, integer)
-- ==============================================================================
DROP FUNCTION IF EXISTS public.dentro_do_limite(uuid, text, integer);

CREATE OR REPLACE FUNCTION public.dentro_do_limite(
  p_tenant uuid,
  p_recurso text,
  p_contagem integer
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_plano text;
  v_limite integer;
BEGIN
  SELECT plano INTO v_plano FROM public.tenants WHERE id = p_tenant;
  SELECT limite INTO v_limite FROM public.plan_limits
    WHERE plano = v_plano AND recurso = p_recurso;
  IF v_limite IS NULL THEN RETURN true; END IF;
  RETURN p_contagem < v_limite;
END;
$$;

-- ==============================================================================
-- 2. admin_listar_tenants(text, text, integer, integer)
-- ==============================================================================
DROP FUNCTION IF EXISTS public.admin_listar_tenants(text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.admin_listar_tenants(
  p_busca TEXT DEFAULT NULL,
  p_plano TEXT DEFAULT NULL,
  p_limite INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  nome TEXT,
  slug TEXT,
  plano TEXT,
  cidade TEXT,
  uf TEXT,
  created_at TIMESTAMPTZ,
  total_membros BIGINT,
  total_clientes BIGINT,
  total_veiculos BIGINT,
  total_agendamentos BIGINT,
  total_execucoes BIGINT,
  ultimo_acesso TIMESTAMPTZ,
  agendamento_online_ativo BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT 
    t.id,
    t.nome,
    t.slug,
    t.plano,
    t.cidade,
    t.uf,
    t.created_at,
    COALESCE(tm.cnt, 0)::BIGINT AS total_membros,
    COALESCE(tc.cnt, 0)::BIGINT AS total_clientes,
    COALESCE(tv.cnt, 0)::BIGINT AS total_veiculos,
    COALESCE(ta.cnt, 0)::BIGINT AS total_agendamentos,
    COALESCE(te.cnt, 0)::BIGINT AS total_execucoes,
    tm_last.max_sign_in AS ultimo_acesso,
    t.agendamento_online_ativo
  FROM public.tenants t
  LEFT JOIN (
    SELECT tenant_id, COUNT(*) AS cnt 
    FROM public.tenant_members 
    WHERE status = 'ativo' 
    GROUP BY tenant_id
  ) tm ON tm.tenant_id = t.id
  LEFT JOIN (
    SELECT m.tenant_id, MAX(u.last_sign_in_at) AS max_sign_in
    FROM public.tenant_members m
    JOIN auth.users u ON u.id = m.user_id
    GROUP BY m.tenant_id
  ) tm_last ON tm_last.tenant_id = t.id
  LEFT JOIN (SELECT tenant_id, COUNT(*) AS cnt FROM public.clientes GROUP BY tenant_id) tc ON tc.tenant_id = t.id
  LEFT JOIN (SELECT tenant_id, COUNT(*) AS cnt FROM public.veiculos GROUP BY tenant_id) tv ON tv.tenant_id = t.id
  LEFT JOIN (SELECT tenant_id, COUNT(*) AS cnt FROM public.agendamentos GROUP BY tenant_id) ta ON ta.tenant_id = t.id
  LEFT JOIN (SELECT tenant_id, COUNT(*) AS cnt FROM public.execucoes GROUP BY tenant_id) te ON te.tenant_id = t.id
  WHERE (p_busca IS NULL OR p_busca = '' OR 
         t.nome ILIKE '%' || p_busca || '%' OR 
         t.slug ILIKE '%' || p_busca || '%' OR 
         t.cidade ILIKE '%' || p_busca || '%')
    AND (p_plano IS NULL OR p_plano = '' OR t.plano = p_plano)
  ORDER BY t.created_at DESC
  LIMIT p_limite OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_listar_tenants(text, text, integer, integer) TO authenticated;

-- ==============================================================================
-- 3. admin_atualizar_plano(text, text, integer, boolean)
-- ==============================================================================
DROP FUNCTION IF EXISTS public.admin_atualizar_plano(text, text, integer, boolean);

CREATE OR REPLACE FUNCTION public.admin_atualizar_plano(
  p_codigo TEXT,
  p_nome TEXT,
  p_preco_centavos INTEGER,
  p_ativo BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_codigo TEXT;
  v_antigo RECORD;
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Acesso negado: permissão de escrita requerida';
  END IF;

  v_codigo := LOWER(TRIM(p_codigo));

  SELECT * INTO v_antigo FROM public.plans WHERE codigo = v_codigo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plano não encontrado: %', p_codigo;
  END IF;

  UPDATE public.plans
  SET nome = p_nome,
      preco_centavos = p_preco_centavos,
      ativo = p_ativo
  WHERE codigo = v_codigo;

  -- Gravar auditoria
  INSERT INTO public.admin_auditoria (
    admin_user_id, acao, entidade, entidade_id, valor_anterior, valor_novo
  ) VALUES (
    auth.uid(),
    'plano_atualizado',
    'plans',
    p_codigo,
    to_jsonb(v_antigo),
    jsonb_build_object('codigo', p_codigo, 'nome', p_nome, 'preco_centavos', p_preco_centavos, 'ativo', p_ativo)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_atualizar_plano(text, text, integer, boolean) TO authenticated;

-- ==============================================================================
-- 4. admin_definir_limite(text, text, integer)
-- ==============================================================================
DROP FUNCTION IF EXISTS public.admin_definir_limite(text, text, integer);

CREATE OR REPLACE FUNCTION public.admin_definir_limite(
  p_plano TEXT,
  p_recurso TEXT,
  p_limite INTEGER
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_plano TEXT;
  v_limite_antigo INTEGER;
  v_exists BOOLEAN;
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Acesso negado: permissão de escrita requerida';
  END IF;

  v_plano := LOWER(TRIM(p_plano));

  SELECT EXISTS(SELECT 1 FROM public.plans WHERE codigo = v_plano) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'Plano % não existe em plans', p_plano;
  END IF;

  SELECT limite INTO v_limite_antigo
  FROM public.plan_limits
  WHERE plano = v_plano AND recurso = p_recurso;

  IF FOUND THEN
    UPDATE public.plan_limits
    SET limite = p_limite
    WHERE plano = v_plano AND recurso = p_recurso;
  ELSE
    INSERT INTO public.plan_limits (plano, recurso, limite)
    VALUES (v_plano, p_recurso, p_limite);
  END IF;

  INSERT INTO public.admin_auditoria (
    admin_user_id, acao, entidade, entidade_id, valor_anterior, valor_novo
  ) VALUES (
    auth.uid(),
    'limite_atualizado',
    'plan_limits',
    p_plano || ':' || p_recurso,
    jsonb_build_object('limite', v_limite_antigo),
    jsonb_build_object('limite', p_limite)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_definir_limite(text, text, integer) TO authenticated;

-- ==============================================================================
-- 5. admin_criar_novo_plano(text, text, integer)
-- ==============================================================================
DROP FUNCTION IF EXISTS public.admin_criar_novo_plano(text, text, integer);

CREATE OR REPLACE FUNCTION public.admin_criar_novo_plano(
  p_codigo TEXT,
  p_nome TEXT,
  p_preco_centavos INTEGER DEFAULT 0
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_codigo_clean TEXT;
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Acesso negado: permissão de escrita requerida';
  END IF;

  v_codigo_clean := LOWER(TRIM(p_codigo));
  
  IF v_codigo_clean = '' THEN
    RAISE EXCEPTION 'Código do plano não pode ser vazio';
  END IF;

  -- 1. Inserir ou atualizar na tabela plans
  INSERT INTO public.plans (codigo, nome, preco_centavos, ativo)
  VALUES (v_codigo_clean, p_nome, p_preco_centavos, true)
  ON CONFLICT (codigo) DO UPDATE
  SET nome = EXCLUDED.nome,
      preco_centavos = EXCLUDED.preco_centavos,
      ativo = true;

  -- 2. Popular limites padrão se não existirem
  INSERT INTO public.plan_limits (plano, recurso, limite)
  VALUES 
    (v_codigo_clean, 'clientes', NULL),
    (v_codigo_clean, 'agendamentos', NULL),
    (v_codigo_clean, 'membros', NULL),
    (v_codigo_clean, 'servicos', NULL),
    (v_codigo_clean, 'execucoes', NULL)
  ON CONFLICT (plano, recurso) DO NOTHING;

  -- 3. Popular features no catálogo se não existirem
  INSERT INTO public.plan_features (plano, feature, habilitado)
  SELECT v_codigo_clean, fc.chave, true
  FROM public.feature_catalogo fc
  ON CONFLICT (plano, feature) DO NOTHING;

  -- 4. Registrar auditoria
  INSERT INTO public.admin_auditoria (
    admin_user_id, acao, entidade, entidade_id, valor_anterior, valor_novo
  ) VALUES (
    auth.uid(),
    'plano_criado',
    'plans',
    v_codigo_clean,
    NULL,
    jsonb_build_object('codigo', v_codigo_clean, 'nome', p_nome, 'preco_centavos', p_preco_centavos)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_criar_novo_plano(text, text, integer) TO authenticated;

-- ==============================================================================
-- 6. admin_salvar_plan_features(jsonb)
-- ==============================================================================
DROP FUNCTION IF EXISTS public.admin_salvar_plan_features(jsonb);

CREATE OR REPLACE FUNCTION public.admin_salvar_plan_features(p_features JSONB)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_item JSONB;
  v_plano TEXT;
  v_feature TEXT;
  v_hab BOOLEAN;
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Acesso negado: permissão de escrita requerida';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_features) LOOP
    v_plano := v_item->>'plano';
    v_feature := v_item->>'feature';
    v_hab := (v_item->>'habilitado')::boolean;

    INSERT INTO public.plan_features (plano, feature, habilitado, updated_at)
    VALUES (v_plano, v_feature, v_hab, now())
    ON CONFLICT (plano, feature) DO UPDATE
    SET habilitado = EXCLUDED.habilitado, updated_at = now();
  END LOOP;

  INSERT INTO public.admin_auditoria (
    admin_user_id, acao, entidade, entidade_id, valor_anterior, valor_novo
  ) VALUES (
    auth.uid(),
    'feature_alterada',
    'plan_features',
    'lote',
    NULL,
    p_features
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_salvar_plan_features(jsonb) TO authenticated;

-- ==============================================================================
-- 7. tenant_tem_feature(uuid, text)
-- ==============================================================================
DROP FUNCTION IF EXISTS public.tenant_tem_feature(uuid, text);

CREATE OR REPLACE FUNCTION public.tenant_tem_feature(
  p_tenant_id UUID,
  p_feature TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_plano TEXT;
  v_habilitado BOOLEAN;
BEGIN
  SELECT plano INTO v_plano FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT habilitado INTO v_habilitado
  FROM public.plan_features
  WHERE plano = v_plano AND feature = p_feature;

  RETURN COALESCE(v_habilitado, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_tem_feature(uuid, text) TO authenticated, anon;

-- ==============================================================================
-- 8. trg_execucao_foto_expiracao_fn()
-- ==============================================================================
DROP FUNCTION IF EXISTS public.trg_execucao_foto_expiracao_fn() CASCADE;

CREATE OR REPLACE FUNCTION public.trg_execucao_foto_expiracao_fn()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_plano text;
  v_retencao integer := 90;
BEGIN
  IF NEW.expirado_em IS NULL AND NOT COALESCE(NEW.preservada, false) THEN
    SELECT e.tenant_id INTO v_tenant_id
    FROM public.execucoes e
    WHERE e.id = NEW.execucao_id;

    IF v_tenant_id IS NOT NULL THEN
      SELECT t.plano INTO v_plano
      FROM public.tenants t
      WHERE t.id = v_tenant_id;

      SELECT pl.limite INTO v_retencao
      FROM public.plan_limits pl
      WHERE pl.plano = v_plano AND pl.recurso = 'retencao_fotos_execucao_dias';

      v_retencao := COALESCE(v_retencao, 90);
      NEW.expirado_em := now() + (v_retencao || ' days')::interval;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_execucao_foto_expiracao ON public.execucao_fotos;
CREATE TRIGGER trg_execucao_foto_expiracao
  BEFORE INSERT ON public.execucao_fotos
  FOR EACH ROW EXECUTE FUNCTION public.trg_execucao_foto_expiracao_fn();

-- ==============================================================================
-- 9. preservar_fotos_execucao(uuid, boolean)
-- ==============================================================================
DROP FUNCTION IF EXISTS public.preservar_fotos_execucao(uuid, boolean);

CREATE OR REPLACE FUNCTION public.preservar_fotos_execucao(
  p_execucao uuid,
  p_preservar boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_member_id uuid;
  v_plano text;
  v_retencao integer := 90;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT e.tenant_id INTO v_tenant_id
  FROM public.execucoes e
  WHERE e.id = p_execucao;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Execução não encontrada';
  END IF;

  SELECT tm.id INTO v_member_id
  FROM public.tenant_members tm
  WHERE tm.tenant_id = v_tenant_id
    AND tm.user_id = auth.uid()
    AND tm.status = 'ativo'
    AND tm.role IN ('dono', 'gerente')
  LIMIT 1;

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: apenas Dono e Gerente deste estabelecimento podem alterar a preservação de fotos.';
  END IF;

  IF p_preservar THEN
    UPDATE public.execucao_fotos ef
    SET preservada = true,
        preservada_em = now(),
        preservada_por = v_member_id,
        expirado_em = null
    WHERE ef.execucao_id = p_execucao;
  ELSE
    SELECT t.plano INTO v_plano FROM public.tenants t WHERE t.id = v_tenant_id;
    SELECT pl.limite INTO v_retencao FROM public.plan_limits pl WHERE pl.plano = v_plano AND pl.recurso = 'retencao_fotos_execucao_dias';
    v_retencao := COALESCE(v_retencao, 90);

    UPDATE public.execucao_fotos ef
    SET preservada = false,
        preservada_em = null,
        preservada_por = null,
        expirado_em = now() + (v_retencao || ' days')::interval
    WHERE ef.execucao_id = p_execucao;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.preservar_fotos_execucao(uuid, boolean) TO authenticated;

-- ==============================================================================
-- 10. atualizar_expiracao_fotos_tenant(uuid)
-- ==============================================================================
DROP FUNCTION IF EXISTS public.atualizar_expiracao_fotos_tenant(uuid);

CREATE OR REPLACE FUNCTION public.atualizar_expiracao_fotos_tenant(
  p_tenant uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_plano text;
  v_retencao integer := 90;
BEGIN
  SELECT t.plano INTO v_plano FROM public.tenants t WHERE t.id = p_tenant;
  IF v_plano IS NULL THEN RETURN; END IF;

  SELECT pl.limite INTO v_retencao FROM public.plan_limits pl WHERE pl.plano = v_plano AND pl.recurso = 'retencao_fotos_execucao_dias';
  v_retencao := COALESCE(v_retencao, 90);

  UPDATE public.execucao_fotos ef
  SET expirado_em = GREATEST(ef.expirado_em, now() + (v_retencao || ' days')::interval)
  FROM public.execucoes e
  WHERE ef.execucao_id = e.id
    and e.tenant_id = p_tenant
    AND ef.preservada = false;
END;
$$;

-- ==============================================================================
-- 11. REMOÇÃO DEFINITIVA DO ENUM PUBLIC.PLAN_CODE
-- ==============================================================================
DROP TYPE IF EXISTS public.plan_code;
