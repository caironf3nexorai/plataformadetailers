-- ==============================================================================
-- MIGRAÇÃO 0107: QUADRO DE AVISOS, CENTRAL DE CUPONS & BANNERS GLOBAIS COM RESGATE
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TABELA DE CUPONS DA PLATAFORMA (public.plataforma_cupons)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plataforma_cupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT NOT NULL UNIQUE,
  descricao TEXT NULL,
  desconto_tipo TEXT NOT NULL CHECK (desconto_tipo IN ('percentual', 'valor_fixo')),
  desconto_valor NUMERIC(10,2) NOT NULL CHECK (desconto_valor > 0),
  plano_alvo TEXT NOT NULL DEFAULT 'todos' CHECK (plano_alvo IN ('todos', 'pro', 'studio')),
  duracao_meses INTEGER NOT NULL DEFAULT 1 CHECK (duracao_meses >= 0), -- 1: 1ª mensalidade, >1: recorrente por X meses, 0: vitalício
  limite_usos INTEGER NULL CHECK (limite_usos IS NULL OR limite_usos > 0), -- NULL = ilimitado
  total_usos INTEGER NOT NULL DEFAULT 0,
  ativo BOOLEAN NOT NULL DEFAULT true,
  origem TEXT NOT NULL DEFAULT 'plataforma' CHECK (origem IN ('plataforma', 'parceiro', 'banner', 'campanha')),
  parceiro_id UUID NULL REFERENCES public.parceiros(id) ON DELETE SET NULL,
  valido_ate TIMESTAMPTZ NULL,
  criado_por UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plataforma_cupons_codigo ON public.plataforma_cupons(codigo);
CREATE INDEX IF NOT EXISTS idx_plataforma_cupons_ativo ON public.plataforma_cupons(ativo, valido_ate);

-- ------------------------------------------------------------------------------
-- 2. TABELA DE REGISTRO DE USOS DE CUPOM (public.plataforma_cupons_usos)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plataforma_cupons_usos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cupom_id UUID NOT NULL REFERENCES public.plataforma_cupons(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plano TEXT NOT NULL,
  valor_original NUMERIC(10,2) NOT NULL,
  valor_desconto NUMERIC(10,2) NOT NULL,
  valor_final NUMERIC(10,2) NOT NULL,
  asaas_payment_id TEXT NULL,
  asaas_subscription_id TEXT NULL,
  usado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(cupom_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_plataforma_cupons_usos_tenant ON public.plataforma_cupons_usos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_plataforma_cupons_usos_cupom ON public.plataforma_cupons_usos(cupom_id);

-- ------------------------------------------------------------------------------
-- 3. TABELA DE COMUNICADOS / QUADRO DE AVISOS (public.plataforma_comunicados)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plataforma_comunicados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo TEXT NOT NULL,
  mensagem TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'aviso' CHECK (tipo IN ('aviso', 'promocao', 'brinde', 'novidade', 'alerta')),
  badge_texto TEXT NULL,
  cor_tema TEXT NOT NULL DEFAULT 'amber' CHECK (cor_tema IN ('amber', 'emerald', 'purple', 'blue', 'rose')),
  imagem_url TEXT NULL,
  acao_tipo TEXT NOT NULL DEFAULT 'nenhuma' CHECK (acao_tipo IN ('nenhuma', 'link', 'cupom', 'brinde_dias', 'brinde_custom')),
  acao_label TEXT NULL,
  acao_link TEXT NULL,
  cupom_id UUID NULL REFERENCES public.plataforma_cupons(id) ON DELETE SET NULL,
  dias_bonus INTEGER NULL CHECK (dias_bonus IS NULL OR dias_bonus > 0),
  acao_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  publico_alvo TEXT NOT NULL DEFAULT 'todos' CHECK (publico_alvo IN ('todos', 'free', 'pro', 'studio')),
  obrigatorio BOOLEAN NOT NULL DEFAULT false,
  ativo BOOLEAN NOT NULL DEFAULT true,
  data_inicio TIMESTAMPTZ NOT NULL DEFAULT now(),
  data_fim TIMESTAMPTZ NULL,
  criado_por UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comunicados_ativo_periodo ON public.plataforma_comunicados(ativo, data_inicio, data_fim);

-- ------------------------------------------------------------------------------
-- 4. TABELA DE LEITURAS E RESGATES (public.plataforma_comunicados_leituras)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plataforma_comunicados_leituras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comunicado_id UUID NOT NULL REFERENCES public.plataforma_comunicados(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  visualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  resgatado BOOLEAN NOT NULL DEFAULT false,
  resgatado_em TIMESTAMPTZ NULL,
  resgate_info JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(comunicado_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_comunicados_leituras_tenant ON public.plataforma_comunicados_leituras(tenant_id, comunicado_id);

-- ------------------------------------------------------------------------------
-- 5. RLS (ROW LEVEL SECURITY)
-- ------------------------------------------------------------------------------
ALTER TABLE public.plataforma_cupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plataforma_cupons_usos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plataforma_comunicados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plataforma_comunicados_leituras ENABLE ROW LEVEL SECURITY;

-- Políticas de Cupons
DROP POLICY IF EXISTS "Platform admin gerencia cupons" ON public.plataforma_cupons;
CREATE POLICY "Platform admin gerencia cupons" ON public.plataforma_cupons
  FOR ALL USING (public.is_platform_admin());

DROP POLICY IF EXISTS "Tenants podem visualizar cupons ativos" ON public.plataforma_cupons;
CREATE POLICY "Tenants podem visualizar cupons ativos" ON public.plataforma_cupons
  FOR SELECT USING (ativo = true AND (valido_ate IS NULL OR valido_ate >= now()));

-- Políticas de Usos de Cupons
DROP POLICY IF EXISTS "Platform admin visualiza usos de cupons" ON public.plataforma_cupons_usos;
CREATE POLICY "Platform admin visualiza usos de cupons" ON public.plataforma_cupons_usos
  FOR SELECT USING (public.is_platform_admin());

DROP POLICY IF EXISTS "Tenants gerenciam seus proprios usos de cupom" ON public.plataforma_cupons_usos;
CREATE POLICY "Tenants gerenciam seus proprios usos de cupom" ON public.plataforma_cupons_usos
  FOR ALL USING (tenant_id IN (SELECT public.meus_tenants()));

-- Políticas de Comunicados
DROP POLICY IF EXISTS "Platform admin gerencia comunicados" ON public.plataforma_comunicados;
CREATE POLICY "Platform admin gerencia comunicados" ON public.plataforma_comunicados
  FOR ALL USING (public.is_platform_admin());

DROP POLICY IF EXISTS "Tenants podem visualizar comunicados ativos" ON public.plataforma_comunicados;
CREATE POLICY "Tenants podem visualizar comunicados ativos" ON public.plataforma_comunicados
  FOR SELECT USING (
    ativo = true 
    AND data_inicio <= now() 
    AND (data_fim IS NULL OR data_fim >= now())
  );

-- Políticas de Leituras de Comunicados
DROP POLICY IF EXISTS "Platform admin visualiza todas as leituras" ON public.plataforma_comunicados_leituras;
CREATE POLICY "Platform admin visualiza todas as leituras" ON public.plataforma_comunicados_leituras
  FOR SELECT USING (public.is_platform_admin());

DROP POLICY IF EXISTS "Tenants gerenciam suas leituras e resgates" ON public.plataforma_comunicados_leituras;
CREATE POLICY "Tenants gerenciam suas leituras e resgates" ON public.plataforma_comunicados_leituras
  FOR ALL USING (tenant_id IN (SELECT public.meus_tenants()));

-- ------------------------------------------------------------------------------
-- 6. RPCS DE CUPONS
-- ------------------------------------------------------------------------------

-- 6.1 Validar Cupom (Usado pelo Checkout e Frontend)
DROP FUNCTION IF EXISTS public.validar_cupom(text, text);
CREATE OR REPLACE FUNCTION public.validar_cupom(
  p_codigo TEXT,
  p_plano TEXT DEFAULT 'pro'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cupom RECORD;
  v_tenant_id UUID;
  v_preco_centavos INTEGER;
  v_valor_original NUMERIC(10,2);
  v_valor_desconto NUMERIC(10,2) := 0;
  v_valor_final NUMERIC(10,2);
  v_ja_usou BOOLEAN := false;
BEGIN
  IF p_codigo IS NULL OR trim(p_codigo) = '' THEN
    RETURN jsonb_build_object('valido', false, 'mensagem', 'Código de cupom não informado.');
  END IF;

  v_tenant_id := (SELECT public.meus_tenants() LIMIT 1);

  -- Busca o cupom
  SELECT * INTO v_cupom
  FROM public.plataforma_cupons
  WHERE upper(trim(codigo)) = upper(trim(p_codigo));

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valido', false, 'mensagem', 'Cupom inválido ou não encontrado.');
  END IF;

  IF NOT v_cupom.ativo THEN
    RETURN jsonb_build_object('valido', false, 'mensagem', 'Este cupom foi desativado.');
  END IF;

  IF v_cupom.valido_ate IS NOT NULL AND v_cupom.valido_ate < now() THEN
    RETURN jsonb_build_object('valido', false, 'mensagem', 'Este cupom expirou.');
  END IF;

  IF v_cupom.limite_usos IS NOT NULL AND v_cupom.total_usos >= v_cupom.limite_usos THEN
    RETURN jsonb_build_object('valido', false, 'mensagem', 'O limite de utilizações deste cupom foi atingido.');
  END IF;

  IF v_cupom.plano_alvo != 'todos' AND lower(trim(v_cupom.plano_alvo)) != lower(trim(p_plano)) THEN
    RETURN jsonb_build_object('valido', false, 'mensagem', format('Este cupom é exclusivo para o plano %s.', upper(v_cupom.plano_alvo)));
  END IF;

  -- Verifica se a oficina já utilizou
  IF v_tenant_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.plataforma_cupons_usos
      WHERE cupom_id = v_cupom.id AND tenant_id = v_tenant_id
    ) INTO v_ja_usou;

    IF v_ja_usou THEN
      RETURN jsonb_build_object('valido', false, 'mensagem', 'Sua oficina já utilizou este cupom anteriormente.');
    END IF;
  END IF;

  -- Busca preço do plano
  SELECT preco_centavos INTO v_preco_centavos
  FROM public.plans
  WHERE codigo = lower(trim(p_plano));

  IF v_preco_centavos IS NULL THEN
    v_preco_centavos := CASE WHEN lower(trim(p_plano)) = 'studio' THEN 14700 ELSE 6700 END;
  END IF;

  v_valor_original := round(v_preco_centavos / 100.0, 2);

  IF v_cupom.desconto_tipo = 'percentual' THEN
    v_valor_desconto := round(v_valor_original * (v_cupom.desconto_valor / 100.0), 2);
  ELSE
    v_valor_desconto := v_cupom.desconto_valor;
  END IF;

  IF v_valor_desconto > v_valor_original THEN
    v_valor_desconto := v_valor_original;
  END IF;

  v_valor_final := round(v_valor_original - v_valor_desconto, 2);
  IF v_valor_final < 0 THEN v_valor_final := 0; END IF;

  RETURN jsonb_build_object(
    'valido', true,
    'id', v_cupom.id,
    'codigo', v_cupom.codigo,
    'descricao', v_cupom.descricao,
    'desconto_tipo', v_cupom.desconto_tipo,
    'desconto_valor', v_cupom.desconto_valor,
    'duracao_meses', v_cupom.duracao_meses,
    'valor_original', v_valor_original,
    'valor_desconto', v_valor_desconto,
    'valor_final', v_valor_final,
    'mensagem', 'Cupom aplicado com sucesso!'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validar_cupom(text, text) TO authenticated, anon;

-- 6.1.1 Registrar Uso de Cupom
DROP FUNCTION IF EXISTS public.registrar_uso_cupom(uuid, uuid, text, numeric, numeric, numeric, text, text);
CREATE OR REPLACE FUNCTION public.registrar_uso_cupom(
  p_cupom_id UUID,
  p_tenant_id UUID,
  p_plano TEXT,
  p_valor_original NUMERIC,
  p_valor_desconto NUMERIC,
  p_valor_final NUMERIC,
  p_asaas_payment_id TEXT DEFAULT NULL,
  p_asaas_subscription_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.plataforma_cupons_usos (
    cupom_id, tenant_id, user_id, plano,
    valor_original, valor_desconto, valor_final,
    asaas_payment_id, asaas_subscription_id, usado_em
  ) VALUES (
    p_cupom_id, p_tenant_id, auth.uid(), p_plano,
    p_valor_original, p_valor_desconto, p_valor_final,
    p_asaas_payment_id, p_asaas_subscription_id, now()
  )
  ON CONFLICT (cupom_id, tenant_id) DO UPDATE SET
    valor_final = EXCLUDED.valor_final,
    asaas_payment_id = COALESCE(EXCLUDED.asaas_payment_id, public.plataforma_cupons_usos.asaas_payment_id),
    asaas_subscription_id = COALESCE(EXCLUDED.asaas_subscription_id, public.plataforma_cupons_usos.asaas_subscription_id),
    usado_em = now();

  UPDATE public.plataforma_cupons
  SET total_usos = total_usos + 1, updated_at = now()
  WHERE id = p_cupom_id;

  RETURN jsonb_build_object('sucesso', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_uso_cupom(uuid, uuid, text, numeric, numeric, numeric, text, text) TO authenticated, service_role;

-- 6.2 Admin Listar Cupons
DROP FUNCTION IF EXISTS public.admin_listar_cupons();
CREATE OR REPLACE FUNCTION public.admin_listar_cupons()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso restrito a administradores da plataforma.';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'codigo', c.codigo,
    'descricao', c.descricao,
    'desconto_tipo', c.desconto_tipo,
    'desconto_valor', c.desconto_valor,
    'plano_alvo', c.plano_alvo,
    'duracao_meses', c.duracao_meses,
    'limite_usos', c.limite_usos,
    'total_usos', c.total_usos,
    'ativo', c.ativo,
    'origem', c.origem,
    'parceiro_id', c.parceiro_id,
    'parceiro_nome', p.nome,
    'valido_ate', c.valido_ate,
    'created_at', c.created_at,
    'total_desconto_concedido', COALESCE((
      SELECT sum(u.valor_desconto) FROM public.plataforma_cupons_usos u WHERE u.cupom_id = c.id
    ), 0)
  ) ORDER BY c.created_at DESC), '[]'::jsonb)
  INTO v_res
  FROM public.plataforma_cupons c
  LEFT JOIN public.parceiros p ON p.id = c.parceiro_id;

  RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_listar_cupons() TO authenticated;

-- 6.3 Admin Salvar Cupom
DROP FUNCTION IF EXISTS public.admin_salvar_cupom(uuid, text, text, text, numeric, text, integer, integer, boolean, text, uuid, timestamptz);
CREATE OR REPLACE FUNCTION public.admin_salvar_cupom(
  p_id UUID DEFAULT NULL,
  p_codigo TEXT DEFAULT NULL,
  p_descricao TEXT DEFAULT NULL,
  p_desconto_tipo TEXT DEFAULT 'percentual',
  p_desconto_valor NUMERIC DEFAULT 10,
  p_plano_alvo TEXT DEFAULT 'todos',
  p_duracao_meses INTEGER DEFAULT 1,
  p_limite_usos INTEGER DEFAULT NULL,
  p_ativo BOOLEAN DEFAULT true,
  p_origem TEXT DEFAULT 'plataforma',
  p_parceiro_id UUID DEFAULT NULL,
  p_valido_ate TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_codigo TEXT;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso restrito a administradores da plataforma.';
  END IF;

  v_codigo := upper(trim(p_codigo));
  IF v_codigo IS NULL OR v_codigo = '' THEN
    RAISE EXCEPTION 'O código do cupom é obrigatório.';
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE public.plataforma_cupons SET
      codigo = v_codigo,
      descricao = p_descricao,
      desconto_tipo = p_desconto_tipo,
      desconto_valor = p_desconto_valor,
      plano_alvo = p_plano_alvo,
      duracao_meses = COALESCE(p_duracao_meses, 1),
      limite_usos = p_limite_usos,
      ativo = p_ativo,
      origem = p_origem,
      parceiro_id = p_parceiro_id,
      valido_ate = p_valido_ate,
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.plataforma_cupons (
      codigo, descricao, desconto_tipo, desconto_valor, plano_alvo,
      duracao_meses, limite_usos, ativo, origem, parceiro_id, valido_ate, criado_por
    ) VALUES (
      v_codigo, p_descricao, p_desconto_tipo, p_desconto_valor, p_plano_alvo,
      COALESCE(p_duracao_meses, 1), p_limite_usos, p_ativo, p_origem, p_parceiro_id, p_valido_ate, auth.uid()
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_salvar_cupom(uuid, text, text, text, numeric, text, integer, integer, boolean, text, uuid, timestamptz) TO authenticated;

-- 6.4 Admin Toggle Cupom
DROP FUNCTION IF EXISTS public.admin_toggle_cupom(uuid, boolean);
CREATE OR REPLACE FUNCTION public.admin_toggle_cupom(p_id UUID, p_ativo BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso restrito a administradores da plataforma.';
  END IF;

  UPDATE public.plataforma_cupons
  SET ativo = p_ativo, updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('sucesso', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_toggle_cupom(uuid, boolean) TO authenticated;

-- 6.5 Admin Excluir Cupom
DROP FUNCTION IF EXISTS public.admin_excluir_cupom(uuid);
CREATE OR REPLACE FUNCTION public.admin_excluir_cupom(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso restrito a administradores da plataforma.';
  END IF;

  DELETE FROM public.plataforma_cupons WHERE id = p_id;
  RETURN jsonb_build_object('sucesso', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_excluir_cupom(uuid) TO authenticated;

-- ------------------------------------------------------------------------------
-- 7. RPCS DO QUADRO DE AVISOS & COMUNICADOS GLOBAIS
-- ------------------------------------------------------------------------------

-- 7.1 Obter Comunicado Pendente para o Tenant Atual
DROP FUNCTION IF EXISTS public.obter_comunicado_pendente();
CREATE OR REPLACE FUNCTION public.obter_comunicado_pendente()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_plano TEXT := 'free';
  v_comunicado RECORD;
  v_cupom RECORD;
BEGIN
  v_tenant_id := (SELECT public.meus_tenants() LIMIT 1);
  IF v_tenant_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(plano::text, 'free') INTO v_plano
  FROM public.tenants WHERE id = v_tenant_id;

  -- Seleciona o comunicado ativo mais recente não lido por este tenant
  SELECT c.* INTO v_comunicado
  FROM public.plataforma_comunicados c
  WHERE c.ativo = true
    AND c.data_inicio <= now()
    AND (c.data_fim IS NULL OR c.data_fim >= now())
    AND (c.publico_alvo = 'todos' OR c.publico_alvo = v_plano)
    AND NOT EXISTS (
      SELECT 1 FROM public.plataforma_comunicados_leituras l
      WHERE l.comunicado_id = c.id AND l.tenant_id = v_tenant_id
    )
  ORDER BY c.data_inicio DESC, c.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Se tiver cupom associado, traz os dados do cupom
  IF v_comunicado.cupom_id IS NOT NULL THEN
    SELECT codigo, desconto_tipo, desconto_valor INTO v_cupom
    FROM public.plataforma_cupons WHERE id = v_comunicado.cupom_id;
  END IF;

  RETURN jsonb_build_object(
    'id', v_comunicado.id,
    'titulo', v_comunicado.titulo,
    'mensagem', v_comunicado.mensagem,
    'tipo', v_comunicado.tipo,
    'badge_texto', v_comunicado.badge_texto,
    'cor_tema', v_comunicado.cor_tema,
    'imagem_url', v_comunicado.imagem_url,
    'acao_tipo', v_comunicado.acao_tipo,
    'acao_label', v_comunicado.acao_label,
    'acao_link', v_comunicado.acao_link,
    'dias_bonus', v_comunicado.dias_bonus,
    'cupom_codigo', v_cupom.codigo,
    'cupom_desconto_tipo', v_cupom.desconto_tipo,
    'cupom_desconto_valor', v_cupom.desconto_valor,
    'obrigatorio', v_comunicado.obrigatorio,
    'acao_payload', v_comunicado.acao_payload
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_comunicado_pendente() TO authenticated;

-- 7.2 Marcar Comunicado Visualizado
DROP FUNCTION IF EXISTS public.marcar_comunicado_visualizado(uuid);
CREATE OR REPLACE FUNCTION public.marcar_comunicado_visualizado(p_comunicado_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  v_tenant_id := (SELECT public.meus_tenants() LIMIT 1);
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'mensagem', 'Tenant não encontrado');
  END IF;

  INSERT INTO public.plataforma_comunicados_leituras (
    comunicado_id, tenant_id, user_id, visualizado_em
  ) VALUES (
    p_comunicado_id, v_tenant_id, auth.uid(), now()
  )
  ON CONFLICT (comunicado_id, tenant_id) DO NOTHING;

  RETURN jsonb_build_object('sucesso', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.marcar_comunicado_visualizado(uuid) TO authenticated;

-- 7.3 Resgatar Brinde do Comunicado (Dias Grátis / Cupom / Custom)
DROP FUNCTION IF EXISTS public.resgatar_brinde_comunicado(uuid);
CREATE OR REPLACE FUNCTION public.resgatar_brinde_comunicado(p_comunicado_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_comunicado RECORD;
  v_assinatura RECORD;
  v_dias INTEGER := 0;
  v_novo_vencimento DATE;
  v_novo_trial_fim DATE;
  v_cupom RECORD;
BEGIN
  v_tenant_id := (SELECT public.meus_tenants() LIMIT 1);
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'mensagem', 'Oficina não identificada');
  END IF;

  SELECT * INTO v_comunicado
  FROM public.plataforma_comunicados
  WHERE id = p_comunicado_id AND ativo = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'mensagem', 'Comunicado não encontrado ou expirado.');
  END IF;

  -- 1. Se for brinde de dias de bônus na assinatura / trial
  IF v_comunicado.acao_tipo = 'brinde_dias' AND v_comunicado.dias_bonus IS NOT NULL AND v_comunicado.dias_bonus > 0 THEN
    v_dias := v_comunicado.dias_bonus;
    
    SELECT * INTO v_assinatura FROM public.assinaturas WHERE tenant_id = v_tenant_id;
    
    IF FOUND THEN
      IF v_assinatura.status = 'trial' AND v_assinatura.trial_fim IS NOT NULL THEN
        v_novo_trial_fim := v_assinatura.trial_fim + v_dias;
        UPDATE public.assinaturas 
        SET trial_fim = v_novo_trial_fim, updated_at = now()
        WHERE id = v_assinatura.id;
      ELSIF v_assinatura.proximo_vencimento IS NOT NULL THEN
        v_novo_vencimento := v_assinatura.proximo_vencimento + v_dias;
        UPDATE public.assinaturas 
        SET proximo_vencimento = v_novo_vencimento, updated_at = now()
        WHERE id = v_assinatura.id;
      END IF;
    ELSE
      -- Se a oficina não tinha registro de assinatura (ex: Free inicial), cria período de trial bônus no plano Pro!
      v_novo_trial_fim := (now() AT TIME ZONE 'America/Sao_Paulo')::date + v_dias;
      INSERT INTO public.assinaturas (
        tenant_id, plano, status, trial_fim, valor_centavos
      ) VALUES (
        v_tenant_id, 'pro', 'trial', v_novo_trial_fim, 6700
      )
      ON CONFLICT (tenant_id) DO UPDATE
      SET trial_fim = v_novo_trial_fim, status = 'trial', plano = 'pro', updated_at = now();

      UPDATE public.tenants SET plano = 'pro' WHERE id = v_tenant_id;
    END IF;
  END IF;

  -- 2. Se for cupom associado
  IF v_comunicado.cupom_id IS NOT NULL THEN
    SELECT codigo INTO v_cupom FROM public.plataforma_cupons WHERE id = v_comunicado.cupom_id;
  END IF;

  -- 3. Registra / atualiza leitura como resgatada
  INSERT INTO public.plataforma_comunicados_leituras (
    comunicado_id, tenant_id, user_id, visualizado_em, resgatado, resgatado_em, resgate_info
  ) VALUES (
    p_comunicado_id, v_tenant_id, auth.uid(), now(), true, now(),
    jsonb_build_object('dias_creditados', v_dias, 'cupom', v_cupom.codigo)
  )
  ON CONFLICT (comunicado_id, tenant_id) DO UPDATE SET
    resgatado = true,
    resgatado_em = now(),
    resgate_info = jsonb_build_object('dias_creditados', v_dias, 'cupom', v_cupom.codigo);

  RETURN jsonb_build_object(
    'sucesso', true,
    'dias_bonus', v_dias,
    'cupom_codigo', v_cupom.codigo,
    'mensagem', CASE 
      WHEN v_dias > 0 THEN format('Parabéns! %s dias bônus foram creditados com sucesso na sua conta!', v_dias)
      WHEN v_cupom.codigo IS NOT NULL THEN format('Cupom %s resgatado com sucesso!', v_cupom.codigo)
      ELSE 'Brinde resgatado com sucesso!'
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resgatar_brinde_comunicado(uuid) TO authenticated;

-- 7.4 Admin Listar Comunicados (com estatísticas)
DROP FUNCTION IF EXISTS public.admin_listar_comunicados();
CREATE OR REPLACE FUNCTION public.admin_listar_comunicados()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso restrito a administradores da plataforma.';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'titulo', c.titulo,
    'mensagem', c.mensagem,
    'tipo', c.tipo,
    'badge_texto', c.badge_texto,
    'cor_tema', c.cor_tema,
    'imagem_url', c.imagem_url,
    'acao_tipo', c.acao_tipo,
    'acao_label', c.acao_label,
    'acao_link', c.acao_link,
    'cupom_id', c.cupom_id,
    'cupom_codigo', cp.codigo,
    'dias_bonus', c.dias_bonus,
    'publico_alvo', c.publico_alvo,
    'obrigatorio', c.obrigatorio,
    'ativo', c.ativo,
    'data_inicio', c.data_inicio,
    'data_fim', c.data_fim,
    'created_at', c.created_at,
    'total_visualizacoes', COALESCE((
      SELECT count(*) FROM public.plataforma_comunicados_leituras l WHERE l.comunicado_id = c.id
    ), 0),
    'total_resgates', COALESCE((
      SELECT count(*) FROM public.plataforma_comunicados_leituras l WHERE l.comunicado_id = c.id AND l.resgatado = true
    ), 0)
  ) ORDER BY c.created_at DESC), '[]'::jsonb)
  INTO v_res
  FROM public.plataforma_comunicados c
  LEFT JOIN public.plataforma_cupons cp ON cp.id = c.cupom_id;

  RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_listar_comunicados() TO authenticated;

-- 7.5 Admin Salvar Comunicado
DROP FUNCTION IF EXISTS public.admin_salvar_comunicado(uuid, text, text, text, text, text, text, text, text, text, uuid, integer, text, boolean, boolean, timestamptz, timestamptz, jsonb);
CREATE OR REPLACE FUNCTION public.admin_salvar_comunicado(
  p_id UUID DEFAULT NULL,
  p_titulo TEXT DEFAULT NULL,
  p_mensagem TEXT DEFAULT NULL,
  p_tipo TEXT DEFAULT 'aviso',
  p_badge_texto TEXT DEFAULT NULL,
  p_cor_tema TEXT DEFAULT 'amber',
  p_imagem_url TEXT DEFAULT NULL,
  p_acao_tipo TEXT DEFAULT 'nenhuma',
  p_acao_label TEXT DEFAULT NULL,
  p_acao_link TEXT DEFAULT NULL,
  p_cupom_id UUID DEFAULT NULL,
  p_dias_bonus INTEGER DEFAULT NULL,
  p_publico_alvo TEXT DEFAULT 'todos',
  p_obrigatorio BOOLEAN DEFAULT false,
  p_ativo BOOLEAN DEFAULT true,
  p_data_inicio TIMESTAMPTZ DEFAULT now(),
  p_data_fim TIMESTAMPTZ DEFAULT NULL,
  p_acao_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso restrito a administradores da plataforma.';
  END IF;

  IF p_titulo IS NULL OR trim(p_titulo) = '' THEN
    RAISE EXCEPTION 'O título do comunicado é obrigatório.';
  END IF;

  IF p_mensagem IS NULL OR trim(p_mensagem) = '' THEN
    RAISE EXCEPTION 'A mensagem do comunicado é obrigatória.';
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE public.plataforma_comunicados SET
      titulo = trim(p_titulo),
      mensagem = trim(p_mensagem),
      tipo = p_tipo,
      badge_texto = p_badge_texto,
      cor_tema = p_cor_tema,
      imagem_url = p_imagem_url,
      acao_tipo = p_acao_tipo,
      acao_label = p_acao_label,
      acao_link = p_acao_link,
      cupom_id = p_cupom_id,
      dias_bonus = p_dias_bonus,
      publico_alvo = p_publico_alvo,
      obrigatorio = p_obrigatorio,
      ativo = p_ativo,
      data_inicio = COALESCE(p_data_inicio, now()),
      data_fim = p_data_fim,
      acao_payload = COALESCE(p_acao_payload, '{}'::jsonb),
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.plataforma_comunicados (
      titulo, mensagem, tipo, badge_texto, cor_tema, imagem_url,
      acao_tipo, acao_label, acao_link, cupom_id, dias_bonus,
      publico_alvo, obrigatorio, ativo, data_inicio, data_fim,
      acao_payload, criado_por
    ) VALUES (
      trim(p_titulo), trim(p_mensagem), p_tipo, p_badge_texto, p_cor_tema, p_imagem_url,
      p_acao_tipo, p_acao_label, p_acao_link, p_cupom_id, p_dias_bonus,
      p_publico_alvo, p_obrigatorio, p_ativo, COALESCE(p_data_inicio, now()), p_data_fim,
      COALESCE(p_acao_payload, '{}'::jsonb), auth.uid()
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_salvar_comunicado(uuid, text, text, text, text, text, text, text, text, text, uuid, integer, text, boolean, boolean, timestamptz, timestamptz, jsonb) TO authenticated;

-- 7.6 Admin Toggle Comunicado
DROP FUNCTION IF EXISTS public.admin_toggle_comunicado(uuid, boolean);
CREATE OR REPLACE FUNCTION public.admin_toggle_comunicado(p_id UUID, p_ativo BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso restrito a administradores da plataforma.';
  END IF;

  UPDATE public.plataforma_comunicados
  SET ativo = p_ativo, updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('sucesso', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_toggle_comunicado(uuid, boolean) TO authenticated;

-- 7.7 Admin Excluir Comunicado
DROP FUNCTION IF EXISTS public.admin_excluir_comunicado(uuid);
CREATE OR REPLACE FUNCTION public.admin_excluir_comunicado(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso restrito a administradores da plataforma.';
  END IF;

  DELETE FROM public.plataforma_comunicados WHERE id = p_id;
  RETURN jsonb_build_object('sucesso', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_excluir_comunicado(uuid) TO authenticated;
