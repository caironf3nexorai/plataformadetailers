-- ==============================================================================
-- MIGRAÇÃO 0050: GESTÃO DE ADMINISTRADORES DA PLATAFORMA & SUPER ADMIN IMUTÁVEL
-- ==============================================================================

-- 1. ADICIONAR COLUNA SUPER_ADMIN EM PLATFORM_ADMINS
ALTER TABLE public.platform_admins 
ADD COLUMN IF NOT EXISTS super_admin BOOLEAN NOT NULL DEFAULT false;

-- 2. FUNÇÃO SECURITY DEFINER PARA LISTAR ADMINISTRADORES DA PLATAFORMA
DROP FUNCTION IF EXISTS public.admin_listar_administradores();
CREATE OR REPLACE FUNCTION public.admin_listar_administradores()
RETURNS TABLE (
  id UUID,
  user_id UUID,
  email TEXT,
  nivel TEXT,
  ativo BOOLEAN,
  super_admin BOOLEAN,
  observacao TEXT,
  created_at TIMESTAMPTZ,
  revogado_em TIMESTAMPTZ,
  criado_por_email TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT 
    pa.id,
    pa.user_id,
    pa.email,
    pa.nivel,
    pa.ativo,
    pa.super_admin,
    pa.observacao,
    pa.created_at,
    pa.revogado_em,
    u_creator.email AS criado_por_email
  FROM public.platform_admins pa
  LEFT JOIN auth.users u_creator ON u_creator.id = pa.criado_por
  ORDER BY pa.super_admin DESC, pa.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_listar_administradores() TO authenticated;

-- 3. FUNÇÃO SECURITY DEFINER PARA PROMOVER / CADASTRAR NOVO ADMIN POR E-MAIL
DROP FUNCTION IF EXISTS public.admin_promover_administrador(text, text, text, boolean);
CREATE OR REPLACE FUNCTION public.admin_promover_administrador(
  p_email TEXT,
  p_nivel TEXT DEFAULT 'admin',
  p_observacao TEXT DEFAULT NULL,
  p_super_admin BOOLEAN DEFAULT false
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_target_user_id UUID;
  v_antigo RECORD;
  v_caller_is_super BOOLEAN;
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Acesso negado: permissão de escrita requerida';
  END IF;

  IF p_nivel NOT IN ('admin', 'suporte') THEN
    RAISE EXCEPTION 'Nível inválido. Use "admin" ou "suporte"';
  END IF;

  -- Buscar user_id em auth.users pelo e-mail
  SELECT id INTO v_target_user_id
  FROM auth.users
  WHERE LOWER(email) = LOWER(TRIM(p_email));

  IF v_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário com o e-mail "%" não foi encontrado no sistema. Ele precisa criar uma conta primeiro.', p_email;
  END IF;

  -- Verificar se quem está chamando é Super Admin caso tente conceder super_admin
  SELECT super_admin INTO v_caller_is_super
  FROM public.platform_admins
  WHERE user_id = auth.uid();

  IF p_super_admin AND NOT COALESCE(v_caller_is_super, false) THEN
    RAISE EXCEPTION 'Apenas um Super Admin pode conceder privilégios de Super Admin.';
  END IF;

  -- Verificar se já existe em platform_admins
  SELECT * INTO v_antigo FROM public.platform_admins WHERE user_id = v_target_user_id;

  IF FOUND THEN
    -- Impedir alteração se o alvo for um Super Admin e quem chama não for Super Admin
    IF v_antigo.super_admin AND NOT COALESCE(v_caller_is_super, false) THEN
      RAISE EXCEPTION 'Operação negada: O Super Admin é imutável.';
    END IF;

    UPDATE public.platform_admins
    SET nivel = p_nivel,
        ativo = true,
        observacao = COALESCE(p_observacao, observacao),
        revogado_em = NULL,
        super_admin = CASE WHEN COALESCE(v_caller_is_super, false) THEN p_super_admin ELSE super_admin END
    WHERE id = v_antigo.id;
  ELSE
    INSERT INTO public.platform_admins (
      user_id, email, nivel, ativo, observacao, criado_por, super_admin
    ) VALUES (
      v_target_user_id, TRIM(p_email), p_nivel, true, p_observacao, auth.uid(), 
      CASE WHEN COALESCE(v_caller_is_super, false) THEN p_super_admin ELSE false END
    );
  END IF;

  -- Auditoria
  INSERT INTO public.admin_auditoria (
    admin_user_id, acao, entidade, entidade_id, valor_anterior, valor_novo
  ) VALUES (
    auth.uid(),
    'admin_promovido',
    'platform_admins',
    v_target_user_id::text,
    to_jsonb(v_antigo),
    jsonb_build_object('email', p_email, 'nivel', p_nivel, 'super_admin', p_super_admin)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_promover_administrador(text, text, text, boolean) TO authenticated;

-- 4. FUNÇÃO SECURITY DEFINER PARA REVOGAR ADMINISTRADOR DA PLATAFORMA (COM PROTEÇÃO IMUTÁVEL)
DROP FUNCTION IF EXISTS public.admin_revogar_administrador(uuid);
CREATE OR REPLACE FUNCTION public.admin_revogar_administrador(p_admin_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin RECORD;
  v_caller_is_super BOOLEAN;
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Acesso negado: permissão de escrita requerida';
  END IF;

  SELECT * INTO v_admin FROM public.platform_admins WHERE id = p_admin_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Administrador não encontrado';
  END IF;

  -- PROTEÇÃO IMUTÁVEL DO SUPER ADMIN:
  IF v_admin.super_admin THEN
    RAISE EXCEPTION 'OPERAÇÃO NEGADA: O Super Admin é imutável e seu acesso não pode ser revogado.';
  END IF;

  -- Impedir auto-revogação
  IF v_admin.user_id = auth.uid() THEN
    RAISE EXCEPTION 'Você não pode revogar o seu próprio acesso administrador.';
  END IF;

  UPDATE public.platform_admins
  SET ativo = false,
      revogado_em = now()
  WHERE id = p_admin_id;

  INSERT INTO public.admin_auditoria (
    admin_user_id, acao, entidade, entidade_id, valor_anterior, valor_novo
  ) VALUES (
    auth.uid(),
    'admin_revogado',
    'platform_admins',
    p_admin_id::text,
    to_jsonb(v_admin),
    jsonb_build_object('ativo', false, 'revogado_em', now())
  );
END;
$$;

-- 5. FUNÇÃO SECURITY DEFINER PARA CRIAR NOVO PLANO DINAMICAMENTE
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

  -- 1. Tentar adicionar o novo valor ao enum plan_code se ainda não existir
  BEGIN
    EXECUTE format('ALTER TYPE public.plan_code ADD VALUE IF NOT EXISTS %L', v_codigo_clean);
  EXCEPTION WHEN OTHERS THEN
    -- Se proibir em subtransação, ignorar e prosseguir
    NULL;
  END;

  -- 2. Inserir ou atualizar na tabela plans
  INSERT INTO public.plans (codigo, nome, preco_centavos, ativo)
  VALUES (v_codigo_clean::plan_code, p_nome, p_preco_centavos, true)
  ON CONFLICT (codigo) DO UPDATE
  SET nome = EXCLUDED.nome,
      preco_centavos = EXCLUDED.preco_centavos,
      ativo = true;

  -- 3. Popular limites padrão se não existirem
  INSERT INTO public.plan_limits (plano, recurso, limite)
  VALUES 
    (v_codigo_clean::plan_code, 'clientes', NULL),
    (v_codigo_clean::plan_code, 'agendamentos', NULL),
    (v_codigo_clean::plan_code, 'membros', NULL),
    (v_codigo_clean::plan_code, 'servicos', NULL),
    (v_codigo_clean::plan_code, 'execucoes', NULL)
  ON CONFLICT (plano, recurso) DO NOTHING;

  -- 4. Popular features no catálogo se não existirem
  INSERT INTO public.plan_features (plano, feature, habilitado)
  SELECT v_codigo_clean::plan_code, fc.chave, true
  FROM public.feature_catalogo fc
  ON CONFLICT (plano, feature) DO NOTHING;

  -- 5. Registrar auditoria
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

