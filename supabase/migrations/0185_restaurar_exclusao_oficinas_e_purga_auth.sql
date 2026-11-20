-- ==============================================================================
-- Migration 0185: RESTAURAR EXCLUSÃO DE OFICINAS & PURGA DE AUTH NO PAINEL ADMIN
-- - Restaura a RPC public.admin_excluir_oficina_e_usuario com a assinatura
--   exata esperada pelo frontend: (p_tenant_id UUID, p_purga_auth BOOLEAN DEFAULT TRUE)
-- - Protegida estritamente por public.is_platform_admin_editor()
-- - Realiza a exclusão em cascata limpa de todos os registros da oficina (tenants,
--   vistorias, orçamentos, fotos, execuções, financeiro e user_activity_logs)
-- - Trava de segurança obrigatória: NUNCA exclui contas de administradores da plataforma
--   (public.platform_admins) nem o próprio administrador logado (auth.uid())
-- - Inclui verificação Anti-PGRST203 e NOTIFY pgrst, 'reload schema'
-- ==============================================================================

BEGIN;

-- 1. DROPAR ASSINATURAS ANTERIORES PARA EVITAR SOBRECARGA OU CONFLITO DE NOMES DE PARÂMETROS
DROP FUNCTION IF EXISTS public.admin_excluir_oficina_e_usuario(UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.admin_excluir_oficina_e_usuario(UUID);

-- 2. RECRIAR FUNÇÃO COM A ASSINATURA EXATA (p_tenant_id, p_purga_auth)
CREATE OR REPLACE FUNCTION public.admin_excluir_oficina_e_usuario(
  p_tenant_id UUID,
  p_purga_auth BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_tenant RECORD;
  v_member JSONB;
  v_member_uid UUID;
  v_member_email TEXT;
  v_membros_oficina JSONB := '[]'::jsonb;
  v_caller_id UUID;
  v_has_other_tenants BOOLEAN;
  v_is_protected_admin BOOLEAN;
  v_emails_liberados TEXT[] := ARRAY[]::TEXT[];
  v_count_users INTEGER := 0;
BEGIN
  -- 1. Validação de permissão administrativa de edição
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores com permissão de edição podem excluir oficinas.';
  END IF;

  v_caller_id := auth.uid();

  -- 2. Localizar a oficina
  SELECT id, nome, slug, criado_por INTO v_tenant
  FROM public.tenants
  WHERE id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oficina não encontrada (ID: %)', p_tenant_id;
  END IF;

  -- 3. Trava de segurança: não pode excluir a própria oficina ativa na sessão
  IF p_tenant_id IN (SELECT public.meus_tenants()) THEN
    RAISE EXCEPTION 'Operação bloqueada: você não pode excluir a oficina em que está atualmente logado.';
  END IF;

  -- 4. Coletar todos os usuários/membros vinculados à oficina (tenant_members + criado_por)
  SELECT COALESCE(
    jsonb_agg(DISTINCT jsonb_build_object(
      'user_id', u_all.user_id,
      'email', LOWER(TRIM(COALESCE(u_all.email, '')))
    )),
    '[]'::jsonb
  )
  INTO v_membros_oficina
  FROM (
    SELECT tm.user_id, tm.email
    FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id AND tm.user_id IS NOT NULL
    UNION
    SELECT t.criado_por AS user_id, u.email
    FROM public.tenants t
    JOIN auth.users u ON u.id = t.criado_por
    WHERE t.id = p_tenant_id AND t.criado_por IS NOT NULL
  ) u_all;

  -- 5. Anular referências diretas de auditoria e execuções para evitar trava de FK residual
  FOR v_member IN SELECT * FROM jsonb_array_elements(v_membros_oficina) LOOP
    v_member_uid := (v_member->>'user_id')::UUID;

    UPDATE public.admin_auditoria
    SET admin_user_id = NULL
    WHERE admin_user_id = v_member_uid;

    UPDATE public.execucao_itens
    SET concluido_por = NULL
    WHERE concluido_por = v_member_uid;

    UPDATE public.execucoes
    SET valor_definido_por = NULL
    WHERE valor_definido_por = v_member_uid;

    UPDATE public.execucoes
    SET desconto_aplicado_por = NULL
    WHERE desconto_aplicado_por = v_member_uid;
  END LOOP;

  -- 6. Desativar verificação de imutabilidade na transação atual
  PERFORM set_config('app.bypass_immutability', 'true', true);

  -- 7. Limpeza explícita e em cascata de tabelas operacionais e financeiras
  DELETE FROM public.aceites_termos WHERE tenant_id = p_tenant_id;
  DELETE FROM public.checkin_fotos WHERE tenant_id = p_tenant_id;
  DELETE FROM public.checkin_avarias WHERE tenant_id = p_tenant_id;
  DELETE FROM public.checkins WHERE tenant_id = p_tenant_id;
  DELETE FROM public.despesas_fixas_pagamentos WHERE tenant_id = p_tenant_id;
  DELETE FROM public.despesas_fixas WHERE tenant_id = p_tenant_id;
  DELETE FROM public.contas_receber WHERE tenant_id = p_tenant_id;
  DELETE FROM public.fila_mensagens_whatsapp WHERE tenant_id = p_tenant_id;
  DELETE FROM public.tenant_config_whatsapp WHERE tenant_id = p_tenant_id;
  DELETE FROM public.parceiro_indicacoes WHERE indicado_tenant_id = p_tenant_id OR indicador_tenant_id = p_tenant_id;
  DELETE FROM public.assinaturas WHERE tenant_id = p_tenant_id;

  -- 8. Limpar logs de atividade dos membros da oficina
  DELETE FROM public.user_activity_logs 
  WHERE user_id IN (
    SELECT (m->>'user_id')::UUID 
    FROM jsonb_array_elements(v_membros_oficina) m 
    WHERE (m->>'user_id') IS NOT NULL
  );

  -- 9. Excluir a oficina (deleta em cascata clientes, veículos, serviços, agendamentos, etc.)
  DELETE FROM public.tenants
  WHERE id = p_tenant_id;

  -- 10. Se solicitado (p_purga_auth = true), remover usuários exclusivos em auth.users
  IF p_purga_auth THEN
    FOR v_member IN SELECT * FROM jsonb_array_elements(v_membros_oficina) LOOP
      v_member_uid := (v_member->>'user_id')::UUID;
      v_member_email := v_member->>'email';

      -- Verifica se o usuário pertence a alguma OUTRA oficina ativa
      SELECT EXISTS (
        SELECT 1 FROM public.tenant_members
        WHERE user_id = v_member_uid
      ) INTO v_has_other_tenants;

      -- TRAVA OBRIGATÓRIA: NUNCA excluir contas de administradores da plataforma
      SELECT EXISTS (
        SELECT 1 FROM public.platform_admins
        WHERE user_id = v_member_uid AND (super_admin = true OR ativo = true)
      ) INTO v_is_protected_admin;

      -- TRAVA OBRIGATÓRIA: NUNCA excluir o próprio administrador executando a ação
      IF NOT v_has_other_tenants AND NOT v_is_protected_admin AND v_member_uid IS DISTINCT FROM v_caller_id THEN
        UPDATE public.parceiros
        SET user_id = NULL
        WHERE user_id = v_member_uid;

        DELETE FROM public.platform_admins WHERE user_id = v_member_uid;
        DELETE FROM public.notificacoes WHERE user_id = v_member_uid;
        DELETE FROM public.feedbacks WHERE user_id = v_member_uid;
        DELETE FROM public.tenant_members WHERE user_id = v_member_uid;
        DELETE FROM public.profiles WHERE id = v_member_uid;
        DELETE FROM auth.users WHERE id = v_member_uid;

        IF v_member_email <> '' THEN
          v_emails_liberados := array_append(v_emails_liberados, v_member_email);
        END IF;
        v_count_users := v_count_users + 1;
      END IF;
    END LOOP;
  END IF;

  -- 11. Auditoria da Exclusão
  INSERT INTO public.admin_auditoria (
    admin_user_id,
    acao,
    entidade,
    entidade_id,
    valor_anterior,
    valor_novo
  ) VALUES (
    v_caller_id,
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
      'total_usuarios_removidos', v_count_users,
      'purga_auth', p_purga_auth
    )
  );

  -- 12. Retorno padronizado
  RETURN jsonb_build_object(
    'sucesso', true,
    'tenant_id', p_tenant_id,
    'tenant_nome', v_tenant.nome,
    'emails_liberados', v_emails_liberados,
    'total_usuarios_removidos', v_count_users
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_excluir_oficina_e_usuario(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_excluir_oficina_e_usuario(UUID, BOOLEAN) TO authenticated, service_role;

-- 3. AUDITORIA AUTOMÁTICA ANTI-PGRST203
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT p.proname, count(*) as total
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'admin_excluir_oficina_e_usuario'
    GROUP BY p.proname
    HAVING count(*) > 1
  ) LOOP
    RAISE EXCEPTION 'ALERTA CRÍTICO ANTI-PGRST203: Função pública % possui % assinaturas ativas!', r.proname, r.total;
  END LOOP;
END $$;

-- 4. RECARREGAR IMEDIATAMENTE O SCHEMA CACHE DO SUPABASE/POSTGREST
NOTIFY pgrst, 'reload schema';

COMMIT;
