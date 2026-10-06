-- ==============================================================================
-- MIGRAÇÃO 0154: REMOVER TOTALMENTE TRAVAS DE EXCLUSÃO DE VISTORIAS E LOGINS
-- 1. Remove os triggers que bloqueavam a exclusão de check-ins, avarias, fotos e termos
-- 2. Permite exclusão normal de agendamentos, clientes, veículos e oficinas sem erro P0002
-- 3. Atualiza foreign keys de checkins para permitir exclusão/purgação de usuários
-- 4. Fortalece admin_excluir_oficina_e_usuario para expurgar oficinas e logins de teste sem travas
-- ==============================================================================

-- 1. REMOVER OS TRIGGERS RÍGIDOS QUE IMPEDIAM A EXCLUSÃO
DROP TRIGGER IF EXISTS trg_proteger_checkins_delete ON public.checkins;
DROP TRIGGER IF EXISTS trg_proteger_checkin_avarias_delete ON public.checkin_avarias;
DROP TRIGGER IF EXISTS trg_proteger_checkin_fotos_delete ON public.checkin_fotos;
DROP TRIGGER IF EXISTS trg_proteger_aceites_termos_delete ON public.aceites_termos;
DROP FUNCTION IF EXISTS public.proteger_vistorias_exclusao();

-- 2. FLEXIBILIZAR RESTRIÇÃO DE CHAVE ESTRANGEIRA EM CHECKINS E FOTOS
ALTER TABLE public.checkins ALTER COLUMN criado_por DROP NOT NULL;
ALTER TABLE public.checkin_fotos ALTER COLUMN enviado_por DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'checkins_criado_por_fkey'
  ) THEN
    ALTER TABLE public.checkins DROP CONSTRAINT checkins_criado_por_fkey;
  END IF;
  
  ALTER TABLE public.checkins ADD CONSTRAINT checkins_criado_por_fkey 
    FOREIGN KEY (criado_por) REFERENCES auth.users(id) ON DELETE SET NULL;

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'checkin_fotos_enviado_por_fkey'
  ) THEN
    ALTER TABLE public.checkin_fotos DROP CONSTRAINT checkin_fotos_enviado_por_fkey;
  END IF;

  ALTER TABLE public.checkin_fotos ADD CONSTRAINT checkin_fotos_enviado_por_fkey 
    FOREIGN KEY (enviado_por) REFERENCES auth.users(id) ON DELETE SET NULL;
END $$;

-- 3. ATUALIZAÇÃO DA FUNÇÃO RPC ADMIN PARA EXCLUSÃO COMPLETA DE OFICINAS E USUÁRIOS
CREATE OR REPLACE FUNCTION public.admin_excluir_oficina_e_usuario(
  p_tenant_id UUID,
  p_excluir_auth_users BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_tenant RECORD;
  v_member RECORD;
  v_emails_liberados TEXT[] := ARRAY[]::TEXT[];
  v_count_users INTEGER := 0;
  v_has_other_tenants BOOLEAN;
  v_is_super_admin BOOLEAN;
BEGIN
  -- 1. Validação de privilégios de administrador da plataforma
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores da plataforma podem excluir oficinas.';
  END IF;

  v_caller_id := auth.uid();

  -- 2. Localizar tenant
  SELECT id, nome, slug, criado_por INTO v_tenant
  FROM public.tenants
  WHERE id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oficina não encontrada (ID: %)', p_tenant_id;
  END IF;

  -- 3. Proteção contra auto-exclusão: Admin não pode excluir a sua própria oficina ativa
  IF p_tenant_id IN (SELECT public.meus_tenants()) THEN
    RAISE EXCEPTION 'Operação bloqueada: você não pode excluir a oficina em que está atualmente logado.';
  END IF;

  -- 4. Coletar usuários associados a esta oficina (antes de apagar o tenant)
  CREATE TEMP TABLE IF NOT EXISTS tmp_usuarios_oficina_del (
    user_id UUID,
    email TEXT,
    role TEXT
  ) ON COMMIT DROP;

  TRUNCATE tmp_usuarios_oficina_del;

  INSERT INTO tmp_usuarios_oficina_del (user_id, email, role)
  SELECT DISTINCT tm.user_id, tm.email, tm.role
  FROM public.tenant_members tm
  WHERE tm.tenant_id = p_tenant_id
    AND tm.user_id IS NOT NULL;

  -- 5. Limpar referências cruzadas que poderiam travar exclusão
  FOR v_member IN SELECT * FROM tmp_usuarios_oficina_del LOOP
    UPDATE public.admin_auditoria
    SET admin_user_id = '00000000-0000-0000-0000-000000000000'::uuid
    WHERE admin_user_id = v_member.user_id;

    UPDATE public.parceiros
    SET user_id = NULL
    WHERE user_id = v_member.user_id;

    UPDATE public.execucoes
    SET concluido_por = NULL
    WHERE concluido_por = v_member.user_id;

    UPDATE public.execucoes
    SET valor_definido_por = NULL
    WHERE valor_definido_por = v_member.user_id;

    UPDATE public.execucoes
    SET desconto_aplicado_por = NULL
    WHERE desconto_aplicado_por = v_member.user_id;
  END LOOP;

  -- 6. Limpeza prévia explícita de registros do tenant (sem travas)
  DELETE FROM public.aceites_termos WHERE tenant_id = p_tenant_id;
  DELETE FROM public.checkin_fotos WHERE tenant_id = p_tenant_id;
  DELETE FROM public.checkin_avarias WHERE tenant_id = p_tenant_id;
  DELETE FROM public.checkins WHERE tenant_id = p_tenant_id;

  -- 7. Excluir a oficina da tabela tenants (dispara ON DELETE CASCADE nas demais filhas)
  DELETE FROM public.tenants
  WHERE id = p_tenant_id;

  -- 8. Se solicitado, excluir do auth.users os usuários que não pertencem a nenhuma outra oficina
  IF p_excluir_auth_users THEN
    FOR v_member IN SELECT * FROM tmp_usuarios_oficina_del LOOP
      -- Verificar se o usuário pertence a alguma outra oficina existente
      SELECT EXISTS (
        SELECT 1 FROM public.tenant_members
        WHERE user_id = v_member.user_id
      ) INTO v_has_other_tenants;

      -- Verificar se é super admin da plataforma (não deve ser excluído por engano)
      SELECT EXISTS (
        SELECT 1 FROM public.platform_admins
        WHERE user_id = v_member.user_id AND super_admin = true
      ) INTO v_is_super_admin;

      IF NOT v_has_other_tenants AND NOT v_is_super_admin THEN
        DELETE FROM public.platform_admins WHERE user_id = v_member.user_id;
        DELETE FROM public.user_push_subscriptions WHERE user_id = v_member.user_id;
        DELETE FROM public.notificacoes_destinatarios WHERE user_id = v_member.user_id;
        DELETE FROM public.feedbacks WHERE user_id = v_member.user_id;
        DELETE FROM public.tenant_members WHERE user_id = v_member.user_id;

        -- Excluir perfil e usuário auth (libera o e-mail para novo cadastro)
        DELETE FROM public.profiles WHERE id = v_member.user_id;
        DELETE FROM auth.users WHERE id = v_member.user_id;

        v_emails_liberados := array_append(v_emails_liberados, v_member.email);
        v_count_users := v_count_users + 1;
      END IF;
    END LOOP;
  END IF;

  -- 9. Registrar auditoria da exclusão
  INSERT INTO public.admin_auditoria (
    admin_user_id,
    acao,
    entidade,
    entidade_id,
    valor_anterior,
    valor_novo
  ) VALUES (
    COALESCE(v_caller_id, '00000000-0000-0000-0000-000000000000'::uuid),
    'excluir_oficina_e_liberar_usuario',
    'tenants',
    p_tenant_id::text,
    jsonb_build_object(
      'nome', v_tenant.nome,
      'slug', v_tenant.slug,
      'criado_por', v_tenant.criado_por
    ),
    jsonb_build_object(
      'excluido_em', now(),
      'emails_liberados', v_emails_liberados,
      'total_usuarios_removidos', v_count_users
    )
  );

  RETURN jsonb_build_object(
    'sucesso', true,
    'tenant_id', p_tenant_id,
    'tenant_nome', v_tenant.nome,
    'emails_liberados', v_emails_liberados,
    'total_usuarios_removidos', v_count_users
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_excluir_oficina_e_usuario(UUID, BOOLEAN) TO authenticated, service_role;
