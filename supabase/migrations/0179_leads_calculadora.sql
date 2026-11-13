-- ==============================================================================
-- MIGRAÇÃO 0179: Funil Isca Digital — Leads da Calculadora Oficial (leads_calculadora)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.leads_calculadora (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  email TEXT NOT NULL,
  momento_estetica TEXT NOT NULL,
  downloaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  converted_to_user BOOLEAN NOT NULL DEFAULT false,
  converted_at TIMESTAMPTZ NULL,

  CONSTRAINT leads_calculadora_nome_check
    CHECK (length(trim(nome)) >= 2),
  CONSTRAINT leads_calculadora_whatsapp_check
    CHECK (length(regexp_replace(whatsapp, '\D', '', 'g')) >= 10),
  CONSTRAINT leads_calculadora_email_check
    CHECK (position('@' IN trim(email)) > 1),
  CONSTRAINT leads_calculadora_momento_check
    CHECK (
      momento_estetica IN (
        'Começando agora / Garagem',
        'Estética montada (1 a 2 pessoas)',
        'Já tenho equipe (3+ pessoas)'
      )
    )
);

CREATE INDEX IF NOT EXISTS idx_leads_calculadora_email_lower
  ON public.leads_calculadora (lower(trim(email)));

CREATE INDEX IF NOT EXISTS idx_leads_calculadora_downloaded_at
  ON public.leads_calculadora (downloaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_leads_calculadora_converted
  ON public.leads_calculadora (converted_to_user)
  WHERE converted_to_user = false;

-- ------------------------------------------------------------------------------
-- RLS: Somente INSERT público controlado; leitura/gestão restrita a Admins.
-- ------------------------------------------------------------------------------
ALTER TABLE public.leads_calculadora ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leads_calculadora_insert_public ON public.leads_calculadora;
CREATE POLICY leads_calculadora_insert_public
  ON public.leads_calculadora
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    length(trim(nome)) >= 2
    AND length(regexp_replace(whatsapp, '\D', '', 'g')) >= 10
    AND position('@' IN trim(email)) > 1
    AND momento_estetica IN (
      'Começando agora / Garagem',
      'Estética montada (1 a 2 pessoas)',
      'Já tenho equipe (3+ pessoas)'
    )
  );

DROP POLICY IF EXISTS leads_calculadora_select_admin ON public.leads_calculadora;
CREATE POLICY leads_calculadora_select_admin
  ON public.leads_calculadora
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS leads_calculadora_update_admin ON public.leads_calculadora;
CREATE POLICY leads_calculadora_update_admin
  ON public.leads_calculadora
  FOR UPDATE
  TO authenticated
  USING (public.is_platform_admin_editor())
  WITH CHECK (public.is_platform_admin_editor());

REVOKE ALL ON TABLE public.leads_calculadora FROM PUBLIC;
GRANT INSERT ON TABLE public.leads_calculadora TO anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.leads_calculadora TO authenticated;

-- ------------------------------------------------------------------------------
-- RPC pública segura para gravar o lead e retornar apenas o UUID gerado
-- (evita expor PII via SELECT para usuários anônimos)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_lead_calculadora(
  p_nome TEXT,
  p_whatsapp TEXT,
  p_email TEXT,
  p_momento_estetica TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nome TEXT := trim(COALESCE(p_nome, ''));
  v_whatsapp TEXT := trim(COALESCE(p_whatsapp, ''));
  v_whatsapp_digits TEXT := regexp_replace(COALESCE(p_whatsapp, ''), '\D', '', 'g');
  v_email TEXT := lower(trim(COALESCE(p_email, '')));
  v_momento TEXT := trim(COALESCE(p_momento_estetica, ''));
  v_lead_id UUID;
BEGIN
  IF length(v_nome) < 2 THEN
    RAISE EXCEPTION 'Informe seu nome completo (mínimo 2 caracteres).';
  END IF;

  IF length(v_whatsapp_digits) < 10 OR length(v_whatsapp_digits) > 13 THEN
    RAISE EXCEPTION 'Informe um WhatsApp válido com DDD.';
  END IF;

  IF v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Informe um e-mail válido.';
  END IF;

  IF v_momento NOT IN (
    'Começando agora / Garagem',
    'Estética montada (1 a 2 pessoas)',
    'Já tenho equipe (3+ pessoas)'
  ) THEN
    RAISE EXCEPTION 'Selecione o momento atual da sua estética.';
  END IF;

  INSERT INTO public.leads_calculadora (
    nome,
    whatsapp,
    email,
    momento_estetica,
    downloaded_at,
    converted_to_user
  )
  VALUES (
    v_nome,
    v_whatsapp,
    v_email,
    v_momento,
    now(),
    false
  )
  RETURNING id INTO v_lead_id;

  RETURN v_lead_id;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_lead_calculadora(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_lead_calculadora(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ------------------------------------------------------------------------------
-- Marca conversão do lead ao criar conta (via RPC autenticada + trigger em auth.users)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.marcar_lead_calculadora_convertido(
  p_lead_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_auth_email TEXT;
  v_rows INT := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  SELECT lower(trim(email))
  INTO v_auth_email
  FROM auth.users
  WHERE id = v_uid;

  UPDATE public.leads_calculadora
  SET
    converted_to_user = true,
    converted_at = COALESCE(converted_at, now())
  WHERE converted_to_user = false
    AND (
      (v_auth_email IS NOT NULL AND lower(trim(email)) = v_auth_email)
      OR (p_lead_id IS NOT NULL AND id = p_lead_id AND downloaded_at >= now() - interval '7 days')
    );

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.marcar_lead_calculadora_convertido(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marcar_lead_calculadora_convertido(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_marcar_lead_calculadora_on_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NOT NULL AND length(trim(NEW.email)) > 0 THEN
    UPDATE public.leads_calculadora
    SET
      converted_to_user = true,
      converted_at = COALESCE(converted_at, now())
    WHERE lower(trim(email)) = lower(trim(NEW.email))
      AND converted_to_user = false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_marcar_lead_calculadora_on_signup ON auth.users;
CREATE TRIGGER trg_marcar_lead_calculadora_on_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_marcar_lead_calculadora_on_signup();

