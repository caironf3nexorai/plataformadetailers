-- Migration 0058: Garantia de Semeadura Completa no Cadastro de Novos Tenants
-- 1. Atualização da função seed_formas_pagamento_tenant para desvincular da tabela antiga forma_pagamento_taxas (removida na 0055)

CREATE OR REPLACE FUNCTION public.seed_formas_pagamento_tenant(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Dinheiro
  IF NOT EXISTS (SELECT 1 FROM public.tenant_formas_pagamento WHERE tenant_id = p_tenant_id AND tipo = 'dinheiro') THEN
    INSERT INTO public.tenant_formas_pagamento (tenant_id, nome, tipo, permite_parcelar, ordem)
    VALUES (p_tenant_id, 'Dinheiro', 'dinheiro', false, 1);
  END IF;

  -- Pix
  IF NOT EXISTS (SELECT 1 FROM public.tenant_formas_pagamento WHERE tenant_id = p_tenant_id AND tipo = 'pix') THEN
    INSERT INTO public.tenant_formas_pagamento (tenant_id, nome, tipo, permite_parcelar, ordem)
    VALUES (p_tenant_id, 'Pix', 'pix', false, 2);
  END IF;

  -- Cartão de Débito
  IF NOT EXISTS (SELECT 1 FROM public.tenant_formas_pagamento WHERE tenant_id = p_tenant_id AND tipo = 'debito') THEN
    INSERT INTO public.tenant_formas_pagamento (tenant_id, nome, tipo, permite_parcelar, ordem)
    VALUES (p_tenant_id, 'Cartão de Débito', 'debito', false, 3);
  END IF;

  -- Cartão de Crédito
  IF NOT EXISTS (SELECT 1 FROM public.tenant_formas_pagamento WHERE tenant_id = p_tenant_id AND tipo = 'credito') THEN
    INSERT INTO public.tenant_formas_pagamento (tenant_id, nome, tipo, permite_parcelar, ordem)
    VALUES (p_tenant_id, 'Cartão de Crédito', 'credito', true, 4);
  END IF;

  -- Fiado / A Prazo
  IF NOT EXISTS (SELECT 1 FROM public.tenant_formas_pagamento WHERE tenant_id = p_tenant_id AND tipo = 'fiado') THEN
    INSERT INTO public.tenant_formas_pagamento (tenant_id, nome, tipo, permite_parcelar, ordem)
    VALUES (p_tenant_id, 'Fiado / A Prazo', 'fiado', true, 5);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_formas_pagamento_tenant(uuid) TO authenticated;


-- 2. Atualização da RPC criar_oficina para Semeadura Completa de Novos Tenants
CREATE OR REPLACE FUNCTION public.criar_oficina(
  p_nome text, p_cidade text, p_uf text, p_telefone text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_tenant uuid;
  v_slug text;
  v_user_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF COALESCE(trim(p_nome), '') = '' THEN
    RAISE EXCEPTION 'Informe o nome da oficina.';
  END IF;

  IF (SELECT count(*) FROM public.tenant_members tm
       WHERE tm.user_id = auth.uid() AND tm.role = 'dono'
         AND tm.status IN ('ativo','convidado')) >= 3 THEN
    RAISE EXCEPTION 'Limite de oficinas por usuário atingido.';
  END IF;

  v_slug := lower(regexp_replace(p_nome, '[^a-zA-Z0-9]+', '-', 'g'))
            || '-' || substr(gen_random_uuid()::text, 1, 6);

  INSERT INTO public.tenants (nome, slug, cidade, uf, telefone, criado_por, plano)
    VALUES (p_nome, v_slug, p_cidade, p_uf, p_telefone, auth.uid(), 'free')
    RETURNING tenants.id INTO v_tenant;

  SELECT u.email INTO v_user_email FROM auth.users u WHERE u.id = auth.uid();

  INSERT INTO public.tenant_members (tenant_id, user_id, email, role, status)
    VALUES (v_tenant, auth.uid(), v_user_email, 'dono', 'ativo');

  -- 1. Seed de 7 categorias padrão de carroceria
  INSERT INTO public.categorias_veiculo (tenant_id, nome, descricao, ordem, ativo)
  VALUES
    (v_tenant, 'Hatch', 'Onix, HB20, Gol, Argo, Polo', 0, true),
    (v_tenant, 'Sedan', 'Corolla, Civic, Virtus, Cronos, Onix Plus', 1, true),
    (v_tenant, 'SUV', 'Creta, Compass, T-Cross, Renegade, Tracker', 2, true),
    (v_tenant, 'Caminhonete', 'Hilux, S10, Ranger, Toro, Strada', 3, true),
    (v_tenant, 'Van / Utilitário', 'Kombi, Master, Sprinter, Ducato', 4, false),
    (v_tenant, 'Caminhão', 'Veículos pesados', 5, false),
    (v_tenant, 'Moto', 'Todas as cilindradas', 6, false)
  ON CONFLICT (tenant_id, nome) DO NOTHING;

  -- 2. Seed de Horários de Funcionamento (Segunda a Sábado com horário padrão, Domingo inativo)
  PERFORM public.seed_horarios_funcionamento_tenant(v_tenant);

  -- 3. Seed de Formas de Pagamento (Dinheiro, Pix, Débito, Crédito, Fiado)
  PERFORM public.seed_formas_pagamento_tenant(v_tenant);

  -- 4. Seed de Maquininha Padrão
  IF NOT EXISTS (SELECT 1 FROM public.tenant_maquininhas WHERE tenant_id = v_tenant AND padrao = true) THEN
    INSERT INTO public.tenant_maquininhas (tenant_id, nome, padrao, ordem)
    VALUES (v_tenant, 'Maquininha Padrão', true, 1);
  END IF;

  RETURN v_tenant;
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_oficina(text, text, text, text) TO authenticated;


-- 3. Backfill preventivo para qualquer oficina existente sem horários, formas de pagamento ou maquininha
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.tenants LOOP
    PERFORM public.seed_horarios_funcionamento_tenant(r.id);
    PERFORM public.seed_formas_pagamento_tenant(r.id);
    IF NOT EXISTS (SELECT 1 FROM public.tenant_maquininhas WHERE tenant_id = r.id AND padrao = true) THEN
      INSERT INTO public.tenant_maquininhas (tenant_id, nome, padrao, ordem)
      VALUES (r.id, 'Maquininha Padrão', true, 1);
    END IF;
  END LOOP;
END;
$$;
