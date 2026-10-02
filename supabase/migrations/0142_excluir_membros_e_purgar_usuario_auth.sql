-- ==============================================================================
-- MIGRAÇÃO 0142: EXCLUSÃO REAL DE MEMBROS E PURGAÇÃO DE USUÁRIOS NO AUTH.USERS
-- ==============================================================================

-- 1. PURGAÇÃO IMEDIATA DO E-MAIL DE TESTE caironfelipe3@gmail.com
DO $$
DECLARE
  v_uid UUID;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE LOWER(email) = 'caironfelipe3@gmail.com';
  IF v_uid IS NOT NULL THEN
    -- Desvincular de referências de auditoria e parceiros
    UPDATE public.admin_auditoria 
    SET admin_user_id = '00000000-0000-0000-0000-000000000000'::uuid 
    WHERE admin_user_id = v_uid;

    UPDATE public.parceiros 
    SET user_id = NULL 
    WHERE user_id = v_uid;

    -- Limpar de membros de oficina
    DELETE FROM public.tenant_members 
    WHERE user_id = v_uid OR LOWER(email) = 'caironfelipe3@gmail.com';

    -- Excluir perfil e conta auth
    DELETE FROM public.profiles WHERE id = v_uid;
    DELETE FROM auth.users WHERE id = v_uid;

    RAISE NOTICE 'Usuário caironfelipe3@gmail.com purgado com sucesso!';
  END IF;
END $$;

-- 2. FUNÇÃO RPC: EXCLUIR MEMBRO DA EQUIPE COM CASCATA ATÉ AUTH.USERS
-- Garante que quando um colaborador é removido da plataforma, seus dados e
-- seu cadastro auth.users são completamente apagados se não pertencer a outra oficina.
CREATE OR REPLACE FUNCTION public.excluir_membro_equipe(
  p_member_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_member RECORD;
  v_target_user_id UUID;
  v_target_email TEXT;
  v_is_manager BOOLEAN := FALSE;
  v_is_platform_admin BOOLEAN := FALSE;
  v_outros_tenants INTEGER := 0;
  v_is_super_admin BOOLEAN := FALSE;
  v_auth_deleted BOOLEAN := FALSE;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: usuário não autenticado.';
  END IF;

  -- 1. Localizar o registro do membro
  SELECT * INTO v_member
  FROM public.tenant_members
  WHERE id = p_member_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'sucesso', true,
      'mensagem', 'Membro não encontrado ou já removido.'
    );
  END IF;

  -- 2. Validar permissões do chamador (dono/gerente da oficina ou admin da plataforma)
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = v_member.tenant_id
      AND user_id = v_caller_id
      AND role IN ('dono', 'gerente')
  ) INTO v_is_manager;

  SELECT public.is_platform_admin() INTO v_is_platform_admin;

  IF NOT (v_is_manager OR v_is_platform_admin) THEN
    RAISE EXCEPTION 'Acesso negado: apenas o dono/gerente da oficina ou administrador pode remover membros.';
  END IF;

  -- 3. Proteção: Dono da oficina não pode se auto-excluir por aqui
  IF v_member.user_id = v_caller_id AND v_member.role = 'dono' THEN
    RAISE EXCEPTION 'Você não pode excluir seu próprio usuário como dono da oficina. Para transferir ou encerrar a oficina, use as configurações gerais.';
  END IF;

  v_target_user_id := v_member.user_id;
  v_target_email := LOWER(TRIM(COALESCE(v_member.email, '')));

  -- 4. Se o membro não tinha user_id vinculado mas tinha email, tentar localizar em auth.users
  IF v_target_user_id IS NULL AND v_target_email <> '' THEN
    SELECT id INTO v_target_user_id 
    FROM auth.users 
    WHERE LOWER(email) = v_target_email;
  END IF;

  -- 5. Excluir o vínculo na tenant_members
  DELETE FROM public.tenant_members
  WHERE id = p_member_id;

  -- 6. Se o usuário tem conta no auth.users, verificar se deve ser excluído do sistema
  IF v_target_user_id IS NOT NULL THEN
    -- Contar se ainda possui vínculo com qualquer outra oficina
    SELECT COUNT(*) INTO v_outros_tenants
    FROM public.tenant_members
    WHERE user_id = v_target_user_id;

    -- Verificar se é super-administrador da plataforma
    SELECT EXISTS (
      SELECT 1 FROM public.platform_admins
      WHERE user_id = v_target_user_id AND super_admin = true
    ) INTO v_is_super_admin;

    -- Se não pertence a nenhuma outra oficina e não é super-admin, purgar completamente!
    IF v_outros_tenants = 0 AND NOT v_is_super_admin THEN
      -- Limpar referências que poderiam impedir exclusão por chave estrangeira
      UPDATE public.admin_auditoria
      SET admin_user_id = '00000000-0000-0000-0000-000000000000'::uuid
      WHERE admin_user_id = v_target_user_id;

      UPDATE public.parceiros
      SET user_id = NULL
      WHERE user_id = v_target_user_id;

      UPDATE public.execucoes
      SET concluido_por = NULL
      WHERE concluido_por = v_target_user_id;

      UPDATE public.execucoes
      SET valor_definido_por = NULL
      WHERE valor_definido_por = v_target_user_id;

      UPDATE public.execucoes
      SET desconto_aplicado_por = NULL
      WHERE desconto_aplicado_por = v_target_user_id;

      DELETE FROM public.platform_admins WHERE user_id = v_target_user_id;
      DELETE FROM public.user_push_subscriptions WHERE user_id = v_target_user_id;
      DELETE FROM public.notificacoes_destinatarios WHERE user_id = v_target_user_id;
      DELETE FROM public.feedbacks WHERE user_id = v_target_user_id;

      -- Excluir perfil e usuário auth
      DELETE FROM public.profiles WHERE id = v_target_user_id;
      DELETE FROM auth.users WHERE id = v_target_user_id;

      v_auth_deleted := TRUE;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'sucesso', true,
    'email_removido', v_target_email,
    'auth_usuario_excluido', v_auth_deleted,
    'mensagem', CASE 
      WHEN v_auth_deleted THEN 'Colaborador e credenciais excluídos completamente do banco de dados. O e-mail está liberado para novos cadastros.'
      ELSE 'Vínculo do colaborador com esta oficina removido com sucesso.'
    END
  );
END;
$$;

-- 3. FUNÇÃO RPC ADMIN: PURGAR QUALQUER USUÁRIO / LIBERAR E-MAIL
-- Permite que super-administradores da plataforma liberem qualquer e-mail que tenha
-- ficado travado em tentativas anteriores de cadastro ou testes.
CREATE OR REPLACE FUNCTION public.admin_purgar_usuario_por_email(
  p_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_target_email TEXT;
  v_target_user_id UUID;
  v_is_super_admin BOOLEAN;
BEGIN
  -- 1. Validar que o chamador é admin da plataforma
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores da plataforma podem purgar usuários.';
  END IF;

  v_caller_id := auth.uid();
  v_target_email := LOWER(TRIM(p_email));

  IF v_target_email = '' OR v_target_email IS NULL THEN
    RAISE EXCEPTION 'E-mail inválido para purgação.';
  END IF;

  -- 2. Localizar usuário no auth.users
  SELECT id INTO v_target_user_id
  FROM auth.users
  WHERE LOWER(email) = v_target_email;

  -- 3. Proteção: Não permitir que o chamador apague a si mesmo
  IF v_target_user_id = v_caller_id THEN
    RAISE EXCEPTION 'Você não pode purgar seu próprio usuário administrador ativo.';
  END IF;

  -- 4. Limpar referências e dependências
  IF v_target_user_id IS NOT NULL THEN
    UPDATE public.admin_auditoria
    SET admin_user_id = '00000000-0000-0000-0000-000000000000'::uuid
    WHERE admin_user_id = v_target_user_id;

    UPDATE public.parceiros
    SET user_id = NULL
    WHERE user_id = v_target_user_id;

    UPDATE public.execucoes
    SET concluido_por = NULL
    WHERE concluido_por = v_target_user_id;

    DELETE FROM public.platform_admins WHERE user_id = v_target_user_id;
    DELETE FROM public.user_push_subscriptions WHERE user_id = v_target_user_id;
    DELETE FROM public.notificacoes_destinatarios WHERE user_id = v_target_user_id;
    DELETE FROM public.feedbacks WHERE user_id = v_target_user_id;
    DELETE FROM public.tenant_members WHERE user_id = v_target_user_id;
    DELETE FROM public.profiles WHERE id = v_target_user_id;
    DELETE FROM auth.users WHERE id = v_target_user_id;
  END IF;

  -- Limpar também de tenant_members pelo e-mail caso existisse convite pendente sem user_id
  DELETE FROM public.tenant_members WHERE LOWER(email) = v_target_email;

  -- Registrar auditoria
  INSERT INTO public.admin_auditoria (
    admin_user_id,
    acao,
    entidade,
    entidade_id,
    valor_anterior,
    valor_novo
  ) VALUES (
    v_caller_id,
    'purgar_usuario_por_email',
    'auth.users',
    COALESCE(v_target_user_id::text, v_target_email),
    jsonb_build_object('email', v_target_email),
    jsonb_build_object('removido_completamente', true)
  );

  RETURN jsonb_build_object(
    'sucesso', true,
    'email_liberado', v_target_email,
    'user_id', v_target_user_id,
    'mensagem', 'E-mail purgado com sucesso de todas as tabelas e do auth.users! Pronto para novo cadastro.'
  );
END;
$$;

-- 4. CONCEDER PERMISSÕES DE EXECUÇÃO
GRANT EXECUTE ON FUNCTION public.excluir_membro_equipe(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_purgar_usuario_por_email(TEXT) TO authenticated, service_role;
