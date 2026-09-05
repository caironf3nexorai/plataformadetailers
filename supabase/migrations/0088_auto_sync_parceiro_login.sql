-- ==============================================================================
-- MIGRAÇÃO 0088: SINCRONIZAÇÃO AUTOMÁTICA DE LOGIN DE PARCEIROS & STATUS DO USUÁRIO
-- ==============================================================================

-- 1. TRIGGER NA TABELA PARCEIROS:
-- Sempre que um parceiro for cadastrado ou tiver seu email atualizado pelo Admin,
-- vincula automaticamente ao usuário do auth.users se existir com o mesmo e-mail.
CREATE OR REPLACE FUNCTION public.handle_parceiro_sync_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  IF NEW.user_id IS NULL AND NEW.email IS NOT NULL THEN
    SELECT id INTO v_user_id 
    FROM auth.users 
    WHERE LOWER(email) = LOWER(TRIM(NEW.email)) 
    LIMIT 1;

    IF v_user_id IS NOT NULL THEN
      NEW.user_id := v_user_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_parceiro_sync_user ON public.parceiros;
CREATE TRIGGER trg_parceiro_sync_user
  BEFORE INSERT OR UPDATE OF email, user_id ON public.parceiros
  FOR EACH ROW EXECUTE FUNCTION public.handle_parceiro_sync_user();


-- 2. TRIGGER NO SIGNUP DO SUPABASE (auth.users):
-- Sempre que um usuário criar conta pelo /criar-conta ou /entrar,
-- se já existir um parceiro com aquele email, vincula imediatamente.
CREATE OR REPLACE FUNCTION public.handle_auth_user_link_parceiro()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NOT NULL THEN
    UPDATE public.parceiros
    SET user_id = NEW.id
    WHERE LOWER(email) = LOWER(TRIM(NEW.email))
      AND (user_id IS NULL OR user_id != NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auth_user_link_parceiro ON auth.users;
CREATE TRIGGER trg_auth_user_link_parceiro
  AFTER INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_link_parceiro();


-- 3. SINCRONIZAR PARCEIROS EXISTENTES IMEDIATAMENTE
UPDATE public.parceiros p
SET user_id = u.id
FROM auth.users u
WHERE p.user_id IS NULL 
  AND LOWER(TRIM(p.email)) = LOWER(TRIM(u.email));


-- 4. RPC PARA IDENTIFICAR SE O USUÁRIO ATUAL É PARCEIRO E/OU ADMIN
CREATE OR REPLACE FUNCTION public.obter_status_usuario_atual()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_is_admin BOOLEAN := FALSE;
  v_is_partner BOOLEAN := FALSE;
  v_partner_id UUID := NULL;
  v_partner_nome TEXT := NULL;
  v_partner_codigo TEXT := NULL;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'is_admin', false,
      'is_partner', false,
      'partner_id', null,
      'partner_nome', null,
      'partner_codigo', null
    );
  END IF;

  v_is_admin := public.is_platform_admin();

  SELECT id, nome, codigo 
  INTO v_partner_id, v_partner_nome, v_partner_codigo
  FROM public.parceiros
  WHERE user_id = v_uid AND ativo = true
  LIMIT 1;

  IF v_partner_id IS NOT NULL THEN
    v_is_partner := TRUE;
  END IF;

  RETURN jsonb_build_object(
    'is_admin', v_is_admin,
    'is_partner', v_is_partner,
    'partner_id', v_partner_id,
    'partner_nome', v_partner_nome,
    'partner_codigo', v_partner_codigo
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_status_usuario_atual() TO authenticated;


-- 5. RPC ADMIN PARA VINCULAR MANUALMENTE PARCEIRO A USUÁRIO PELO PAINEL
CREATE OR REPLACE FUNCTION public.admin_vincular_usuario_parceiro(
  p_parceiro_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso restrito a administradores';
  END IF;

  UPDATE public.parceiros
  SET user_id = p_user_id
  WHERE id = p_parceiro_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_vincular_usuario_parceiro(UUID, UUID) TO authenticated;
