-- ==============================================================================
-- MIGRAÇÃO 0178:
-- 1. Exclusão segura de parceiros comerciais (admin_excluir_parceiro) e proteção
--    de escrita somente para administradores editores (is_platform_admin_editor)
-- 2. Listagem administrativa completa das contas em auth.users
--    (admin_listar_contas_auth) explicando e exibindo contas órfãs, membros,
--    parceiros e admins além das oficinas visíveis em /admin/oficinas
-- 3. Correção definitiva dos bugs da migração 0142 e 0156 em:
--    - excluir_membro_equipe
--    - admin_purgar_usuario_por_email
--    - admin_excluir_oficina_e_usuario
--    (remove coluna inexistente execucoes.concluido_por, remove tabelas
--     inexistentes user_push_subscriptions/notificacoes_destinatarios e troca
--     UUID zero inválido em admin_auditoria por NULL)
-- 4. Ajuste de FK residual em forma_pagamento_taxas.criado_por (ON DELETE SET NULL)
-- ==============================================================================

-- 1. FLEXIBILIZAR FK RESIDUAL PARA EVITAR TRAVAS AO PURGAR USUÁRIOS DE AUTH.USERS
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'forma_pagamento_taxas'
      AND column_name = 'criado_por'
  ) THEN
    ALTER TABLE public.forma_pagamento_taxas
      ALTER COLUMN criado_por DROP NOT NULL;

    ALTER TABLE public.forma_pagamento_taxas
      DROP CONSTRAINT IF EXISTS forma_pagamento_taxas_criado_por_fkey;

    ALTER TABLE public.forma_pagamento_taxas
      ADD CONSTRAINT forma_pagamento_taxas_criado_por_fkey
      FOREIGN KEY (criado_por) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 1.1 Permitir deleção em cascata de comissao_regras durante exclusão de membro/oficina
CREATE OR REPLACE FUNCTION public.protect_comissao_regras_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true'
     OR NOT EXISTS (SELECT 1 FROM public.tenant_members WHERE id = OLD.member_id)
     OR NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = OLD.tenant_id) THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'Regra de comissão é imutável. Encerre a vigência atual e crie uma nova regra.';
  RETURN NULL;
END;
$$;

-- 2. ENDURECER RLS DE ESCRITA DE PARCEIROS PARA APENAS ADMINS EDITORES
--    (admins de nível 'suporte' continuam com permissão somente de leitura)
DROP POLICY IF EXISTS "parceiros_admin_policy" ON public.parceiros;
DROP POLICY IF EXISTS "parceiros_self_select_policy" ON public.parceiros;
DROP POLICY IF EXISTS "parceiros_admin_select_policy" ON public.parceiros;
DROP POLICY IF EXISTS "parceiros_admin_insert_policy" ON public.parceiros;
DROP POLICY IF EXISTS "parceiros_admin_update_policy" ON public.parceiros;
DROP POLICY IF EXISTS "parceiros_admin_delete_policy" ON public.parceiros;

CREATE POLICY "parceiros_self_select_policy" ON public.parceiros
  FOR SELECT USING (user_id = auth.uid() OR public.is_platform_admin());

CREATE POLICY "parceiros_admin_insert_policy" ON public.parceiros
  FOR INSERT WITH CHECK (public.is_platform_admin_editor());

CREATE POLICY "parceiros_admin_update_policy" ON public.parceiros
  FOR UPDATE USING (public.is_platform_admin_editor())
  WITH CHECK (public.is_platform_admin_editor());

CREATE POLICY "parceiros_admin_delete_policy" ON public.parceiros
  FOR DELETE USING (public.is_platform_admin_editor());

DROP POLICY IF EXISTS "parceiro_oficinas_admin_policy" ON public.parceiro_oficinas;
DROP POLICY IF EXISTS "parceiro_oficinas_self_select_policy" ON public.parceiro_oficinas;
DROP POLICY IF EXISTS "parceiro_oficinas_admin_insert_policy" ON public.parceiro_oficinas;
DROP POLICY IF EXISTS "parceiro_oficinas_admin_update_policy" ON public.parceiro_oficinas;
DROP POLICY IF EXISTS "parceiro_oficinas_admin_delete_policy" ON public.parceiro_oficinas;

CREATE POLICY "parceiro_oficinas_self_select_policy" ON public.parceiro_oficinas
  FOR SELECT USING (
    parceiro_id IN (SELECT id FROM public.parceiros WHERE user_id = auth.uid())
    OR public.is_platform_admin()
  );

CREATE POLICY "parceiro_oficinas_admin_insert_policy" ON public.parceiro_oficinas
  FOR INSERT WITH CHECK (public.is_platform_admin_editor());

CREATE POLICY "parceiro_oficinas_admin_update_policy" ON public.parceiro_oficinas
  FOR UPDATE USING (public.is_platform_admin_editor())
  WITH CHECK (public.is_platform_admin_editor());

CREATE POLICY "parceiro_oficinas_admin_delete_policy" ON public.parceiro_oficinas
  FOR DELETE USING (public.is_platform_admin_editor());

DROP POLICY IF EXISTS "parceiro_comissoes_admin_policy" ON public.parceiro_comissoes;
DROP POLICY IF EXISTS "parceiro_comissoes_self_select_policy" ON public.parceiro_comissoes;
DROP POLICY IF EXISTS "parceiro_comissoes_admin_insert_policy" ON public.parceiro_comissoes;
DROP POLICY IF EXISTS "parceiro_comissoes_admin_update_policy" ON public.parceiro_comissoes;
DROP POLICY IF EXISTS "parceiro_comissoes_admin_delete_policy" ON public.parceiro_comissoes;

CREATE POLICY "parceiro_comissoes_self_select_policy" ON public.parceiro_comissoes
  FOR SELECT USING (
    parceiro_id IN (SELECT id FROM public.parceiros WHERE user_id = auth.uid())
    OR public.is_platform_admin()
  );

CREATE POLICY "parceiro_comissoes_admin_insert_policy" ON public.parceiro_comissoes
  FOR INSERT WITH CHECK (public.is_platform_admin_editor());

CREATE POLICY "parceiro_comissoes_admin_update_policy" ON public.parceiro_comissoes
  FOR UPDATE USING (public.is_platform_admin_editor())
  WITH CHECK (public.is_platform_admin_editor());

CREATE POLICY "parceiro_comissoes_admin_delete_policy" ON public.parceiro_comissoes
  FOR DELETE USING (public.is_platform_admin_editor());

-- 3. ATUALIZAR admin_vincular_oficina_parceiro PARA EXIGIR is_platform_admin_editor()
CREATE OR REPLACE FUNCTION public.admin_vincular_oficina_parceiro(
  p_tenant_id UUID,
  p_parceiro_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores com permissão de edição podem vincular ou desvincular parceiros.';
  END IF;

  IF p_parceiro_id IS NULL THEN
    DELETE FROM public.parceiro_oficinas WHERE tenant_id = p_tenant_id;
    RETURN jsonb_build_object('sucesso', true, 'removido', true);
  END IF;

  INSERT INTO public.parceiro_oficinas (parceiro_id, tenant_id)
  VALUES (p_parceiro_id, p_tenant_id)
  ON CONFLICT (tenant_id) DO UPDATE SET parceiro_id = EXCLUDED.parceiro_id;

  RETURN jsonb_build_object('sucesso', true, 'parceiro_id', p_parceiro_id, 'tenant_id', p_tenant_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_vincular_oficina_parceiro(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_vincular_oficina_parceiro(UUID, UUID) TO authenticated, service_role;

-- 4. NOVA RPC: EXCLUSÃO SEGURA DE PARCEIRO COMERCIAL
DROP FUNCTION IF EXISTS public.admin_excluir_parceiro(UUID);
DROP FUNCTION IF EXISTS public.admin_excluir_parceiro(UUID, BOOLEAN);

CREATE OR REPLACE FUNCTION public.admin_excluir_parceiro(
  p_parceiro_id UUID,
  p_desativar_cupons BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID;
  v_parceiro RECORD;
  v_oficinas_count INTEGER := 0;
  v_oficinas_nomes TEXT[] := ARRAY[]::TEXT[];
  v_comissoes_count INTEGER := 0;
  v_comissoes_pagas_count INTEGER := 0;
  v_comissoes_total NUMERIC(10,2) := 0;
  v_cupons_count INTEGER := 0;
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores com permissão de edição podem excluir parceiros.';
  END IF;

  v_caller_id := auth.uid();

  SELECT * INTO v_parceiro
  FROM public.parceiros
  WHERE id = p_parceiro_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parceiro não encontrado (ID: %).', p_parceiro_id;
  END IF;

  -- Coletar resumo de vínculos antes de excluir para auditoria e resposta
  SELECT
    COUNT(*)::INTEGER,
    COALESCE(array_agg(t.nome ORDER BY t.nome), ARRAY[]::TEXT[])
  INTO v_oficinas_count, v_oficinas_nomes
  FROM public.parceiro_oficinas po
  JOIN public.tenants t ON t.id = po.tenant_id
  WHERE po.parceiro_id = p_parceiro_id;

  SELECT
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (WHERE status = 'paga')::INTEGER,
    COALESCE(SUM(valor_comissao), 0)::NUMERIC(10,2)
  INTO v_comissoes_count, v_comissoes_pagas_count, v_comissoes_total
  FROM public.parceiro_comissoes
  WHERE parceiro_id = p_parceiro_id;

  SELECT COUNT(*)::INTEGER
  INTO v_cupons_count
  FROM public.plataforma_cupons
  WHERE parceiro_id = p_parceiro_id;

  -- Desvincular (e opcionalmente desativar) cupons associados na Central de Cupons
  UPDATE public.plataforma_cupons
  SET parceiro_id = NULL,
      ativo = CASE WHEN COALESCE(p_desativar_cupons, true) THEN false ELSE ativo END,
      updated_at = now()
  WHERE parceiro_id = p_parceiro_id;

  -- Excluir vínculos, comissões e o registro do parceiro
  DELETE FROM public.parceiro_oficinas WHERE parceiro_id = p_parceiro_id;
  DELETE FROM public.parceiro_comissoes WHERE parceiro_id = p_parceiro_id;
  DELETE FROM public.parceiros WHERE id = p_parceiro_id;

  -- Registrar auditoria completa
  INSERT INTO public.admin_auditoria (
    admin_user_id,
    acao,
    entidade,
    entidade_id,
    valor_anterior,
    valor_novo
  ) VALUES (
    v_caller_id,
    'excluir_parceiro',
    'parceiros',
    p_parceiro_id::text,
    jsonb_build_object(
      'nome', v_parceiro.nome,
      'email', v_parceiro.email,
      'codigo', v_parceiro.codigo,
      'user_id', v_parceiro.user_id,
      'oficinas_vinculadas', v_oficinas_nomes,
      'oficinas_desvinculadas', v_oficinas_count,
      'total_comissoes', v_comissoes_count,
      'comissoes_pagas', v_comissoes_pagas_count,
      'valor_total_comissoes', v_comissoes_total,
      'cupons_vinculados', v_cupons_count
    ),
    jsonb_build_object(
      'excluido_em', now(),
      'cupons_desativados', COALESCE(p_desativar_cupons, true)
    )
  );

  RETURN jsonb_build_object(
    'sucesso', true,
    'parceiro_id', p_parceiro_id,
    'parceiro_nome', v_parceiro.nome,
    'codigo', v_parceiro.codigo,
    'oficinas_desvinculadas', v_oficinas_count,
    'comissoes_removidas', v_comissoes_count,
    'comissoes_pagas_removidas', v_comissoes_pagas_count,
    'cupons_afetados', v_cupons_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_excluir_parceiro(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_excluir_parceiro(UUID, BOOLEAN) TO authenticated, service_role;

-- 5. NOVA RPC: LISTAGEM COMPLETA DAS CONTAS EM AUTH.USERS PARA AUDITORIA ADMIN
DROP FUNCTION IF EXISTS public.admin_listar_contas_auth(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.admin_listar_contas_auth(
  p_busca TEXT DEFAULT NULL,
  p_filtro TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  email TEXT,
  nome TEXT,
  telefone TEXT,
  email_confirmado BOOLEAN,
  email_confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  last_sign_in_at TIMESTAMPTZ,
  is_admin BOOLEAN,
  admin_nivel TEXT,
  admin_ativo BOOLEAN,
  is_super_admin BOOLEAN,
  is_parceiro BOOLEAN,
  parceiro_id UUID,
  parceiro_codigo TEXT,
  parceiro_ativo BOOLEAN,
  total_oficinas INTEGER,
  oficinas JSONB,
  categoria TEXT,
  pode_purgar BOOLEAN,
  motivo_bloqueio_purga TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_busca TEXT;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores da plataforma podem visualizar as contas de autenticação.';
  END IF;

  v_caller_id := auth.uid();
  v_busca := NULLIF(LOWER(TRIM(COALESCE(p_busca, ''))), '');

  RETURN QUERY
  WITH base_users AS (
    SELECT
      u.id,
      COALESCE(u.email, '')::TEXT AS email,
      COALESCE(
        NULLIF(TRIM(p.nome), ''),
        NULLIF(TRIM(u.raw_user_meta_data->>'nome'), ''),
        NULLIF(split_part(COALESCE(u.email, ''), '@', 1), ''),
        'Sem nome'
      )::TEXT AS nome,
      NULLIF(TRIM(COALESCE(p.telefone, u.raw_user_meta_data->>'telefone')), '')::TEXT AS telefone,
      (u.email_confirmed_at IS NOT NULL)::BOOLEAN AS email_confirmado,
      u.email_confirmed_at,
      u.created_at,
      u.last_sign_in_at,
      COALESCE(pa.ativo, false)::BOOLEAN AS is_admin,
      CASE WHEN pa.user_id IS NOT NULL THEN pa.nivel::TEXT ELSE NULL::TEXT END AS admin_nivel,
      COALESCE(pa.ativo, false)::BOOLEAN AS admin_ativo,
      COALESCE(pa.super_admin, false)::BOOLEAN AS is_super_admin,
      (pr.id IS NOT NULL)::BOOLEAN AS is_parceiro,
      pr.id AS parceiro_id,
      pr.codigo::TEXT AS parceiro_codigo,
      pr.ativo AS parceiro_ativo,
      COALESCE((
        SELECT COUNT(*)::INTEGER
        FROM public.tenant_members tm
        JOIN public.tenants t ON t.id = tm.tenant_id
        WHERE tm.user_id = u.id
           OR (tm.user_id IS NULL AND u.email IS NOT NULL AND LOWER(TRIM(tm.email)) = LOWER(TRIM(u.email)))
      ), 0) AS total_oficinas,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'member_id', tm.id,
            'tenant_id', t.id,
            'tenant_nome', t.nome,
            'tenant_slug', t.slug,
            'plano', t.plano::TEXT,
            'role', tm.role::TEXT,
            'status', tm.status::TEXT,
            'total_donos_oficina', (
              SELECT COUNT(*)::INTEGER
              FROM public.tenant_members tm2
              WHERE tm2.tenant_id = t.id AND tm2.role = 'dono'
            )
          )
          ORDER BY tm.created_at ASC
        )
        FROM public.tenant_members tm
        JOIN public.tenants t ON t.id = tm.tenant_id
        WHERE tm.user_id = u.id
           OR (tm.user_id IS NULL AND u.email IS NOT NULL AND LOWER(TRIM(tm.email)) = LOWER(TRIM(u.email)))
      ), '[]'::jsonb) AS oficinas,
      EXISTS (
        SELECT 1
        FROM public.tenant_members tm
        WHERE tm.user_id = u.id
          AND tm.role = 'dono'
      ) AS is_dono_oficina,
      (
        SELECT t.nome
        FROM public.tenant_members tm
        JOIN public.tenants t ON t.id = tm.tenant_id
        WHERE tm.user_id = u.id
          AND tm.role = 'dono'
          AND NOT EXISTS (
            SELECT 1
            FROM public.tenant_members tm2
            WHERE tm2.tenant_id = tm.tenant_id
              AND tm2.role = 'dono'
              AND tm2.user_id IS DISTINCT FROM u.id
          )
        ORDER BY tm.created_at ASC
        LIMIT 1
      )::TEXT AS sole_owner_tenant_nome
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    LEFT JOIN public.platform_admins pa ON pa.user_id = u.id
    LEFT JOIN LATERAL (
      SELECT pr_sub.id, pr_sub.codigo, pr_sub.ativo
      FROM public.parceiros pr_sub
      WHERE pr_sub.user_id = u.id
         OR (pr_sub.user_id IS NULL AND u.email IS NOT NULL AND LOWER(TRIM(pr_sub.email)) = LOWER(TRIM(u.email)))
      ORDER BY (pr_sub.user_id = u.id) DESC, pr_sub.created_at DESC
      LIMIT 1
    ) pr ON TRUE
    WHERE u.email IS NOT NULL AND TRIM(u.email) <> ''
  ),
  classified AS (
    SELECT
      b.id,
      b.email,
      b.nome,
      b.telefone,
      b.email_confirmado,
      b.email_confirmed_at,
      b.created_at,
      b.last_sign_in_at,
      b.is_admin,
      b.admin_nivel,
      b.admin_ativo,
      b.is_super_admin,
      b.is_parceiro,
      b.parceiro_id,
      b.parceiro_codigo,
      b.parceiro_ativo,
      b.total_oficinas,
      b.oficinas,
      CASE
        WHEN b.is_admin AND b.total_oficinas = 0 THEN 'admin_plataforma'
        WHEN b.is_parceiro AND b.total_oficinas = 0 THEN 'parceiro_sem_oficina'
        WHEN b.total_oficinas = 0 THEN 'orfa_sem_oficina'
        WHEN b.is_dono_oficina THEN 'dono_oficina'
        ELSE 'membro_equipe'
      END::TEXT AS categoria,
      (
        b.id <> COALESCE(v_caller_id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND NOT b.is_super_admin
        AND NOT b.admin_ativo
        AND b.sole_owner_tenant_nome IS NULL
      )::BOOLEAN AS pode_purgar,
      CASE
        WHEN b.id = v_caller_id THEN 'Sua própria conta logada no momento.'
        WHEN b.is_super_admin THEN 'Conta protegida de Super Admin.'
        WHEN b.admin_ativo THEN 'Administrador ativo. Revogue o acesso em Admins antes de excluir.'
        WHEN b.sole_owner_tenant_nome IS NOT NULL THEN format('Dono único da oficina "%s". Exclua a oficina primeiro na aba Oficinas.', b.sole_owner_tenant_nome)
        ELSE NULL
      END::TEXT AS motivo_bloqueio_purga
    FROM base_users b
  )
  SELECT
    c.id,
    c.email,
    c.nome,
    c.telefone,
    c.email_confirmado,
    c.email_confirmed_at,
    c.created_at,
    c.last_sign_in_at,
    c.is_admin,
    c.admin_nivel,
    c.admin_ativo,
    c.is_super_admin,
    c.is_parceiro,
    c.parceiro_id,
    c.parceiro_codigo,
    c.parceiro_ativo,
    c.total_oficinas,
    c.oficinas,
    c.categoria,
    c.pode_purgar,
    c.motivo_bloqueio_purga
  FROM classified c
  WHERE (
    v_busca IS NULL
    OR LOWER(c.email) LIKE '%' || v_busca || '%'
    OR LOWER(c.nome) LIKE '%' || v_busca || '%'
    OR LOWER(COALESCE(c.parceiro_codigo, '')) LIKE '%' || v_busca || '%'
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(c.oficinas) elem
      WHERE LOWER(COALESCE(elem->>'tenant_nome', '')) LIKE '%' || v_busca || '%'
    )
  )
  AND (
    p_filtro IS NULL
    OR p_filtro = ''
    OR p_filtro = 'todas'
    OR (p_filtro = 'sem_oficina' AND c.total_oficinas = 0)
    OR (p_filtro = 'orfas' AND c.categoria = 'orfa_sem_oficina')
    OR (p_filtro = 'com_oficina' AND c.total_oficinas > 0)
    OR (p_filtro = 'parceiros' AND c.is_parceiro)
    OR (p_filtro = 'admins' AND c.is_admin)
  )
  ORDER BY
    CASE c.categoria
      WHEN 'orfa_sem_oficina' THEN 0
      WHEN 'parceiro_sem_oficina' THEN 1
      WHEN 'admin_plataforma' THEN 2
      WHEN 'membro_equipe' THEN 3
      ELSE 4
    END ASC,
    c.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_listar_contas_auth(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_listar_contas_auth(TEXT, TEXT) TO authenticated, service_role;

-- 6. CORRIGIR excluir_membro_equipe (BUGS DA MIGRAÇÃO 0142)
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
  v_is_platform_admin_editor BOOLEAN := FALSE;
  v_outros_tenants INTEGER := 0;
  v_outros_donos INTEGER := 0;
  v_is_super_admin BOOLEAN := FALSE;
  v_is_active_admin BOOLEAN := FALSE;
  v_is_active_parceiro BOOLEAN := FALSE;
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

  -- 2. Validar permissões do chamador (dono/gerente da oficina ou admin editor da plataforma)
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = v_member.tenant_id
      AND user_id = v_caller_id
      AND role IN ('dono', 'gerente')
  ) INTO v_is_manager;

  SELECT public.is_platform_admin_editor() INTO v_is_platform_admin_editor;

  IF NOT (v_is_manager OR v_is_platform_admin_editor) THEN
    RAISE EXCEPTION 'Acesso negado: apenas o dono/gerente da oficina ou administrador editor pode remover membros.';
  END IF;

  -- 3. Proteções de propriedade da oficina
  IF v_member.user_id = v_caller_id AND v_member.role = 'dono' THEN
    RAISE EXCEPTION 'Você não pode excluir seu próprio usuário como dono da oficina. Para transferir ou encerrar a oficina, use as configurações gerais.';
  END IF;

  IF v_member.role = 'dono' THEN
    SELECT COUNT(*)::INTEGER INTO v_outros_donos
    FROM public.tenant_members
    WHERE tenant_id = v_member.tenant_id
      AND role = 'dono'
      AND id <> p_member_id;

    IF v_outros_donos = 0 THEN
      RAISE EXCEPTION 'Operação bloqueada: não é possível remover o único dono da oficina.';
    END IF;
  END IF;

  v_target_user_id := v_member.user_id;
  v_target_email := LOWER(TRIM(COALESCE(v_member.email, '')));

  IF v_target_user_id IS NULL AND v_target_email <> '' THEN
    SELECT id INTO v_target_user_id
    FROM auth.users
    WHERE LOWER(email) = v_target_email;
  END IF;

  -- 4. Excluir o vínculo na tenant_members (habilitando bypass controlado para cascades de comissao_regras)
  PERFORM set_config('app.bypass_immutability', 'true', true);

  DELETE FROM public.tenant_members
  WHERE id = p_member_id;

  -- 5. Se o usuário tem conta no auth.users e não possui outro vínculo ativo/protegido, purgar
  IF v_target_user_id IS NOT NULL AND v_target_user_id <> v_caller_id THEN
    SELECT COUNT(*)::INTEGER INTO v_outros_tenants
    FROM public.tenant_members
    WHERE user_id = v_target_user_id;

    SELECT EXISTS (
      SELECT 1 FROM public.platform_admins
      WHERE user_id = v_target_user_id AND super_admin = true
    ) INTO v_is_super_admin;

    SELECT EXISTS (
      SELECT 1 FROM public.platform_admins
      WHERE user_id = v_target_user_id AND ativo = true
    ) INTO v_is_active_admin;

    SELECT EXISTS (
      SELECT 1 FROM public.parceiros
      WHERE user_id = v_target_user_id AND ativo = true
    ) INTO v_is_active_parceiro;

    IF v_outros_tenants = 0 AND NOT v_is_super_admin AND NOT v_is_active_admin AND NOT v_is_active_parceiro THEN
      UPDATE public.admin_auditoria
      SET admin_user_id = NULL
      WHERE admin_user_id = v_target_user_id;

      UPDATE public.parceiros
      SET user_id = NULL
      WHERE user_id = v_target_user_id;

      UPDATE public.execucao_itens
      SET concluido_por = NULL
      WHERE concluido_por = v_target_user_id;

      UPDATE public.execucoes
      SET valor_definido_por = NULL
      WHERE valor_definido_por = v_target_user_id;

      UPDATE public.execucoes
      SET desconto_aplicado_por = NULL
      WHERE desconto_aplicado_por = v_target_user_id;

      DELETE FROM public.platform_admins WHERE user_id = v_target_user_id;
      DELETE FROM public.notificacoes WHERE user_id = v_target_user_id;
      DELETE FROM public.feedbacks WHERE user_id = v_target_user_id;
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

REVOKE ALL ON FUNCTION public.excluir_membro_equipe(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.excluir_membro_equipe(UUID) TO authenticated, service_role;

-- 7. CORRIGIR admin_purgar_usuario_por_email (BUGS DA MIGRAÇÃO 0142)
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
  v_is_super_admin BOOLEAN := FALSE;
  v_is_active_admin BOOLEAN := FALSE;
  v_sole_owner_tenant_nome TEXT;
  v_members_removed INTEGER := 0;
  v_extra_removed INTEGER := 0;
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores com permissão de edição podem purgar usuários.';
  END IF;

  v_caller_id := auth.uid();
  v_target_email := LOWER(TRIM(COALESCE(p_email, '')));

  IF v_target_email = '' OR position('@' in v_target_email) = 0 THEN
    RAISE EXCEPTION 'E-mail inválido para purgação.';
  END IF;

  SELECT id INTO v_target_user_id
  FROM auth.users
  WHERE LOWER(email) = v_target_email;

  PERFORM set_config('app.bypass_immutability', 'true', true);

  IF v_target_user_id IS NOT NULL THEN
    -- Proteção 1: Auto-exclusão
    IF v_target_user_id = v_caller_id THEN
      RAISE EXCEPTION 'Você não pode purgar seu próprio usuário administrador ativo.';
    END IF;

    -- Proteção 2: Super Admin e Admin ativo
    SELECT EXISTS (
      SELECT 1 FROM public.platform_admins
      WHERE user_id = v_target_user_id AND super_admin = true
    ) INTO v_is_super_admin;

    IF v_is_super_admin THEN
      RAISE EXCEPTION 'Operação bloqueada: contas Super Admin são protegidas e não podem ser purgadas.';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.platform_admins
      WHERE user_id = v_target_user_id AND ativo = true
    ) INTO v_is_active_admin;

    IF v_is_active_admin THEN
      RAISE EXCEPTION 'Operação bloqueada: revogue o privilégio administrativo desta conta na aba Admins antes de excluí-la.';
    END IF;

    -- Proteção 3: Não deixar oficina existente sem nenhum dono
    SELECT t.nome INTO v_sole_owner_tenant_nome
    FROM public.tenant_members tm
    JOIN public.tenants t ON t.id = tm.tenant_id
    WHERE tm.user_id = v_target_user_id
      AND tm.role = 'dono'
      AND NOT EXISTS (
        SELECT 1
        FROM public.tenant_members tm2
        WHERE tm2.tenant_id = tm.tenant_id
          AND tm2.role = 'dono'
          AND tm2.user_id IS DISTINCT FROM v_target_user_id
      )
    ORDER BY tm.created_at ASC
    LIMIT 1;

    IF v_sole_owner_tenant_nome IS NOT NULL THEN
      RAISE EXCEPTION 'Este e-mail é o único dono da oficina "%". Exclua a oficina (com a opção de liberar e-mail marcada) na aba Oficinas antes de purgar esta conta.', v_sole_owner_tenant_nome;
    END IF;

    -- Limpeza de referências antes da exclusão em auth.users
    UPDATE public.admin_auditoria
    SET admin_user_id = NULL
    WHERE admin_user_id = v_target_user_id;

    UPDATE public.parceiros
    SET user_id = NULL
    WHERE user_id = v_target_user_id;

    UPDATE public.execucao_itens
    SET concluido_por = NULL
    WHERE concluido_por = v_target_user_id;

    UPDATE public.execucoes
    SET valor_definido_por = NULL
    WHERE valor_definido_por = v_target_user_id;

    UPDATE public.execucoes
    SET desconto_aplicado_por = NULL
    WHERE desconto_aplicado_por = v_target_user_id;

    DELETE FROM public.platform_admins WHERE user_id = v_target_user_id;
    DELETE FROM public.notificacoes WHERE user_id = v_target_user_id;
    DELETE FROM public.feedbacks WHERE user_id = v_target_user_id;
    DELETE FROM public.tenant_members WHERE user_id = v_target_user_id;
    GET DIAGNOSTICS v_members_removed = ROW_COUNT;

    DELETE FROM public.profiles WHERE id = v_target_user_id;
    DELETE FROM auth.users WHERE id = v_target_user_id;
  END IF;

  -- Limpar também vínculos pendentes em tenant_members pelo e-mail sem user_id
  DELETE FROM public.tenant_members WHERE LOWER(TRIM(email)) = v_target_email;
  GET DIAGNOSTICS v_extra_removed = ROW_COUNT;
  v_members_removed := v_members_removed + v_extra_removed;

  -- Registrar auditoria apenas quando houve remoção real ou limpeza de convite
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
    jsonb_build_object(
      'email', v_target_email,
      'auth_encontrado', (v_target_user_id IS NOT NULL)
    ),
    jsonb_build_object(
      'removido_completamente', (v_target_user_id IS NOT NULL),
      'vinculos_removidos', v_members_removed
    )
  );

  RETURN jsonb_build_object(
    'sucesso', true,
    'encontrado', (v_target_user_id IS NOT NULL OR v_members_removed > 0),
    'auth_encontrado', (v_target_user_id IS NOT NULL),
    'email_liberado', v_target_email,
    'user_id', v_target_user_id,
    'vinculos_removidos', v_members_removed,
    'mensagem', CASE
      WHEN v_target_user_id IS NOT NULL THEN 'E-mail purgado com sucesso de todas as tabelas e do auth.users! Pronto para novo cadastro.'
      WHEN v_members_removed > 0 THEN 'Convite pendente removido com sucesso; este e-mail já não possuía conta no auth.users.'
      ELSE 'Este e-mail já está livre (não havia conta no auth.users nem vínculo pendente).'
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_purgar_usuario_por_email(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_purgar_usuario_por_email(TEXT) TO authenticated, service_role;

-- 8. CORRIGIR admin_excluir_oficina_e_usuario (BUGS DE AUDITORIA E PERMISSÃO DA 0156)
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
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores com permissão de edição podem excluir oficinas.';
  END IF;

  v_caller_id := auth.uid();

  SELECT id, nome, slug, criado_por INTO v_tenant
  FROM public.tenants
  WHERE id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oficina não encontrada (ID: %)', p_tenant_id;
  END IF;

  IF p_tenant_id IN (SELECT public.meus_tenants()) THEN
    RAISE EXCEPTION 'Operação bloqueada: você não pode excluir a oficina em que está atualmente logado.';
  END IF;

  SELECT COALESCE(
    jsonb_agg(DISTINCT jsonb_build_object(
      'user_id', tm.user_id,
      'email', LOWER(TRIM(COALESCE(tm.email, '')))
    )),
    '[]'::jsonb
  )
  INTO v_membros_oficina
  FROM public.tenant_members tm
  WHERE tm.tenant_id = p_tenant_id
    AND tm.user_id IS NOT NULL;

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

  PERFORM set_config('app.bypass_immutability', 'true', true);

  DELETE FROM public.aceites_termos WHERE tenant_id = p_tenant_id;
  DELETE FROM public.checkin_fotos WHERE tenant_id = p_tenant_id;
  DELETE FROM public.checkin_avarias WHERE tenant_id = p_tenant_id;
  DELETE FROM public.checkins WHERE tenant_id = p_tenant_id;

  DELETE FROM public.tenants
  WHERE id = p_tenant_id;

  IF p_excluir_auth_users THEN
    FOR v_member IN SELECT * FROM jsonb_array_elements(v_membros_oficina) LOOP
      v_member_uid := (v_member->>'user_id')::UUID;
      v_member_email := v_member->>'email';

      SELECT EXISTS (
        SELECT 1 FROM public.tenant_members
        WHERE user_id = v_member_uid
      ) INTO v_has_other_tenants;

      SELECT EXISTS (
        SELECT 1 FROM public.platform_admins
        WHERE user_id = v_member_uid AND (super_admin = true OR ativo = true)
      ) INTO v_is_protected_admin;

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

REVOKE ALL ON FUNCTION public.admin_excluir_oficina_e_usuario(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_excluir_oficina_e_usuario(UUID, BOOLEAN) TO authenticated, service_role;

-- Recarregar schema do PostgREST
NOTIFY pgrst, 'reload schema';
