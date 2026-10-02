-- Migration 0147: Suporte a Plano Anual, Ciclos de Cobrança e Política de Cancelamento
-- 1. Adiciona coluna preco_anual_centavos na tabela public.plans
-- 2. Adiciona coluna ciclo (mensal/anual) na tabela public.assinaturas
-- 3. Atualiza obter_planos_publicos e admin_listar_planos_completos
-- 4. Atualiza admin_salvar_plano_completo com suporte ao preco_anual_centavos
-- 5. Atualiza obter_assinatura_tenant para retornar ciclo e renovacao_automatica

-- 1. Adiciona coluna preco_anual_centavos em public.plans
ALTER TABLE public.plans 
ADD COLUMN IF NOT EXISTS preco_anual_centavos INTEGER NULL DEFAULT NULL;

-- Popular valores padrão iniciais de planos anuais com ~15% a 20% de desconto (2 meses grátis)
UPDATE public.plans 
SET preco_anual_centavos = 0 
WHERE codigo = 'free';

UPDATE public.plans 
SET preco_anual_centavos = 68400 -- R$ 684,00 no ano (R$ 57/mês, economia de R$ 120/ano)
WHERE codigo = 'pro' AND (preco_anual_centavos IS NULL OR preco_anual_centavos = 0);

UPDATE public.plans 
SET preco_anual_centavos = 149900 -- R$ 1.499,00 no ano (R$ 124,91/mês, economia de R$ 265/ano)
WHERE codigo = 'studio' AND (preco_anual_centavos IS NULL OR preco_anual_centavos = 0);

-- 2. Adiciona ciclo em public.assinaturas
ALTER TABLE public.assinaturas 
ADD COLUMN IF NOT EXISTS ciclo TEXT NOT NULL DEFAULT 'mensal';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assinaturas_ciclo_check'
  ) THEN
    ALTER TABLE public.assinaturas 
    ADD CONSTRAINT assinaturas_ciclo_check CHECK (ciclo IN ('mensal', 'anual'));
  END IF;
END $$;

-- 3. RPC Pública para listar planos incluindo preco_anual_centavos
CREATE OR REPLACE FUNCTION public.obter_planos_publicos()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT jsonb_agg(
      jsonb_build_object(
        'codigo', p.codigo,
        'nome', p.nome,
        'preco_centavos', p.preco_centavos,
        'preco_anual_centavos', COALESCE(p.preco_anual_centavos, p.preco_centavos * 10),
        'ativo', p.ativo,
        'limites', COALESCE((
          SELECT jsonb_object_agg(pl.recurso, pl.limite)
          FROM public.plan_limits pl
          WHERE pl.plano = p.codigo
        ), '{}'::jsonb),
        'features', COALESCE((
          SELECT jsonb_object_agg(pf.feature, pf.habilitado)
          FROM public.plan_features pf
          WHERE pf.plano = p.codigo
        ), '{}'::jsonb)
      )
      ORDER BY p.preco_centavos ASC, p.codigo ASC
    )
    FROM public.plans p
    WHERE p.ativo = true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_planos_publicos() TO anon, authenticated;

-- 4. RPC Admin para listar planos completos incluindo preco_anual_centavos
CREATE OR REPLACE FUNCTION public.admin_listar_planos_completos()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  SELECT jsonb_build_object(
    'catalogo', (
      SELECT jsonb_agg(to_jsonb(fc) ORDER BY fc.ordem ASC, fc.nome ASC)
      FROM public.feature_catalogo fc
    ),
    'planos', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'codigo', p.codigo,
          'nome', p.nome,
          'preco_centavos', p.preco_centavos,
          'preco_anual_centavos', p.preco_anual_centavos,
          'ativo', p.ativo,
          'features', COALESCE((
            SELECT jsonb_object_agg(pf.feature, pf.habilitado)
            FROM public.plan_features pf
            WHERE pf.plano = p.codigo
          ), '{}'::jsonb),
          'limites', COALESCE((
            SELECT jsonb_object_agg(pl.recurso, pl.limite)
            FROM public.plan_limits pl
            WHERE pl.plano = p.codigo
          ), '{}'::jsonb)
        )
        ORDER BY p.preco_centavos ASC, p.codigo ASC
      )
      FROM public.plans p
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_listar_planos_completos() TO authenticated;

-- 5. RPC Admin para salvar plano completo com preco_anual_centavos
DROP FUNCTION IF EXISTS public.admin_salvar_plano_completo(TEXT, TEXT, INTEGER, BOOLEAN, JSONB, JSONB);
DROP FUNCTION IF EXISTS public.admin_salvar_plano_completo(TEXT, TEXT, INTEGER, BOOLEAN, JSONB, JSONB, INTEGER);

CREATE OR REPLACE FUNCTION public.admin_salvar_plano_completo(
  p_codigo TEXT,
  p_nome TEXT,
  p_preco_centavos INTEGER,
  p_ativo BOOLEAN,
  p_features JSONB,
  p_limites JSONB,
  p_preco_anual_centavos INTEGER DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_key TEXT;
  v_val JSONB;
  v_limite_num INTEGER;
  v_hab BOOLEAN;
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Permissão negada. Apenas administradores editores podem alterar planos.';
  END IF;

  UPDATE public.plans
  SET 
    nome = TRIM(p_nome),
    preco_centavos = p_preco_centavos,
    preco_anual_centavos = p_preco_anual_centavos,
    ativo = p_ativo,
    updated_at = NOW()
  WHERE codigo = LOWER(TRIM(p_codigo));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plano % não encontrado.', p_codigo;
  END IF;

  -- Atualiza em tempo real o valor das assinaturas ativas mensais deste plano
  UPDATE public.assinaturas
  SET valor_centavos = p_preco_centavos,
      updated_at = NOW()
  WHERE plano = LOWER(TRIM(p_codigo)) AND status = 'ativa' AND ciclo = 'mensal';

  -- Se foi informado valor anual, atualiza também as assinaturas anuais ativas
  IF p_preco_anual_centavos IS NOT NULL AND p_preco_anual_centavos > 0 THEN
    UPDATE public.assinaturas
    SET valor_centavos = p_preco_anual_centavos,
        updated_at = NOW()
    WHERE plano = LOWER(TRIM(p_codigo)) AND status = 'ativa' AND ciclo = 'anual';
  END IF;

  IF p_features IS NOT NULL AND jsonb_typeof(p_features) = 'object' THEN
    FOR v_key, v_val IN SELECT * FROM jsonb_each(p_features)
    LOOP
      v_hab := (v_val::text = 'true');
      INSERT INTO public.plan_features (plano, feature, habilitado, updated_at)
      VALUES (LOWER(TRIM(p_codigo)), v_key, v_hab, NOW())
      ON CONFLICT (plano, feature) DO UPDATE
      SET habilitado = EXCLUDED.habilitado, updated_at = NOW();
    END LOOP;
  END IF;

  IF p_limites IS NOT NULL AND jsonb_typeof(p_limites) = 'object' THEN
    FOR v_key, v_val IN SELECT * FROM jsonb_each(p_limites)
    LOOP
      IF v_val IS NULL OR jsonb_typeof(v_val) = 'null' OR v_val::text = 'null' THEN
        v_limite_num := NULL;
      ELSE
        v_limite_num := (v_val::text)::INTEGER;
      END IF;

      INSERT INTO public.plan_limits (plano, recurso, limite, updated_at)
      VALUES (LOWER(TRIM(p_codigo)), v_key, v_limite_num, NOW())
      ON CONFLICT (plano, recurso) DO UPDATE
      SET limite = EXCLUDED.limite, updated_at = NOW();
    END LOOP;
  END IF;

  INSERT INTO public.audit_logs (usuario_id, email, acao, entidade, registro_id, detalhes)
  VALUES (
    auth.uid(),
    public.current_admin_email(),
    'ATUALIZAR_PLANO_COMPLETO',
    'plans',
    p_codigo,
    jsonb_build_object(
      'nome', p_nome,
      'preco_centavos', p_preco_centavos,
      'preco_anual_centavos', p_preco_anual_centavos,
      'ativo', p_ativo,
      'features', p_features,
      'limites', p_limites
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_salvar_plano_completo(TEXT, TEXT, INTEGER, BOOLEAN, JSONB, JSONB, INTEGER) TO authenticated;

-- 6. Atualiza obter_assinatura_tenant para retornar ciclo e dados de vigência
CREATE OR REPLACE FUNCTION public.obter_assinatura_tenant(p_tenant_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_ass RECORD;
  v_tenant RECORD;
  v_hoje DATE;
  v_dias_trial INTEGER := 0;
  v_dias_atraso INTEGER := 0;
  v_dias_para_rebaixamento INTEGER := 0;
  v_status_final TEXT;
BEGIN
  v_tenant_id := COALESCE(p_tenant_id, (SELECT public.meus_tenants() LIMIT 1));
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('existe', false, 'status', 'trial', 'plano', 'pro', 'ciclo', 'mensal');
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = v_tenant_id;
  SELECT * INTO v_ass FROM public.assinaturas WHERE tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'existe', false,
      'plano', COALESCE(v_tenant.plano::text, 'pro'),
      'status', 'trial',
      'ciclo', 'mensal',
      'dias_trial_restantes', 15
    );
  END IF;

  v_hoje := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_status_final := v_ass.status;

  IF v_status_final = 'trial' AND v_ass.trial_fim IS NOT NULL THEN
    v_dias_trial := v_ass.trial_fim - v_hoje;
    IF v_dias_trial < 0 THEN v_dias_trial := 0; END IF;
  END IF;

  IF v_status_final = 'atrasada' AND v_ass.atraso_desde IS NOT NULL THEN
    v_dias_atraso := v_hoje - v_ass.atraso_desde;
    v_dias_para_rebaixamento := 5 - v_dias_atraso;
    IF v_dias_para_rebaixamento < 0 THEN v_dias_para_rebaixamento := 0; END IF;
  END IF;

  RETURN jsonb_build_object(
    'existe', true,
    'id', v_ass.id,
    'tenant_id', v_ass.tenant_id,
    'plano', COALESCE(v_ass.plano, v_tenant.plano, 'pro'),
    'status', v_status_final,
    'ciclo', COALESCE(v_ass.ciclo, 'mensal'),
    'forma_pagamento', v_ass.forma_pagamento,
    'valor_centavos', v_ass.valor_centavos,
    'trial_fim', v_ass.trial_fim,
    'dias_trial_restantes', v_dias_trial,
    'proximo_vencimento', v_ass.proximo_vencimento,
    'atraso_desde', v_ass.atraso_desde,
    'dias_atraso', v_dias_atraso,
    'dias_para_rebaixamento', v_dias_para_rebaixamento,
    'url_pagamento_asaas', v_ass.url_pagamento_asaas,
    'asaas_subscription_id', v_ass.asaas_subscription_id,
    'cancelada_em', v_ass.cancelada_em
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_assinatura_tenant(UUID) TO authenticated, service_role;

-- 7. Atualiza validar_cupom com suporte ao ciclo anual
DROP FUNCTION IF EXISTS public.validar_cupom(text, text);
DROP FUNCTION IF EXISTS public.validar_cupom(text, text, text);

CREATE OR REPLACE FUNCTION public.validar_cupom(
  p_codigo TEXT,
  p_plano TEXT,
  p_ciclo TEXT DEFAULT 'mensal'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cupom RECORD;
  v_tenant_id UUID;
  v_preco_centavos INT;
  v_valor_original NUMERIC(10,2);
  v_valor_desconto NUMERIC(10,2);
  v_valor_final NUMERIC(10,2);
  v_ja_usou BOOLEAN;
BEGIN
  IF p_codigo IS NULL OR trim(p_codigo) = '' THEN
    RETURN jsonb_build_object('valido', false, 'mensagem', 'Código do cupom não informado.');
  END IF;

  v_tenant_id := (SELECT public.meus_tenants() LIMIT 1);

  SELECT * INTO v_cupom
  FROM public.plataforma_cupons
  WHERE upper(trim(codigo)) = upper(trim(p_codigo));

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valido', false, 'mensagem', 'Cupom não encontrado ou inválido.');
  END IF;

  IF NOT v_cupom.ativo THEN
    RETURN jsonb_build_object('valido', false, 'mensagem', 'Este cupom está inativo no momento.');
  END IF;

  IF v_cupom.data_expiracao IS NOT NULL AND v_cupom.data_expiracao < current_date THEN
    RETURN jsonb_build_object('valido', false, 'mensagem', 'Este cupom já expirou.');
  END IF;

  IF v_cupom.limite_usos IS NOT NULL AND v_cupom.usos_atuais >= v_cupom.limite_usos THEN
    RETURN jsonb_build_object('valido', false, 'mensagem', 'O limite de utilizações deste cupom foi atingido.');
  END IF;

  IF v_cupom.plano_alvo != 'todos' AND lower(trim(v_cupom.plano_alvo)) != lower(trim(p_plano)) THEN
    RETURN jsonb_build_object('valido', false, 'mensagem', format('Este cupom é exclusivo para o plano %s.', upper(v_cupom.plano_alvo)));
  END IF;

  IF v_tenant_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.plataforma_cupons_usos
      WHERE cupom_id = v_cupom.id AND tenant_id = v_tenant_id
    ) INTO v_ja_usou;

    IF v_ja_usou THEN
      RETURN jsonb_build_object('valido', false, 'mensagem', 'Sua oficina já utilizou este cupom anteriormente.');
    END IF;
  END IF;

  IF lower(trim(p_ciclo)) = 'anual' THEN
    SELECT COALESCE(preco_anual_centavos, preco_centavos * 10) INTO v_preco_centavos
    FROM public.plans
    WHERE codigo = lower(trim(p_plano));

    IF v_preco_centavos IS NULL THEN
      v_preco_centavos := CASE WHEN lower(trim(p_plano)) = 'studio' THEN 149900 ELSE 68400 END;
    END IF;
  ELSE
    SELECT preco_centavos INTO v_preco_centavos
    FROM public.plans
    WHERE codigo = lower(trim(p_plano));

    IF v_preco_centavos IS NULL THEN
      v_preco_centavos := CASE WHEN lower(trim(p_plano)) = 'studio' THEN 14700 ELSE 6700 END;
    END IF;
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
    'ciclo', p_ciclo,
    'valor_original', v_valor_original,
    'valor_desconto', v_valor_desconto,
    'valor_final', v_valor_final,
    'mensagem', 'Cupom aplicado com sucesso!'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validar_cupom(text, text, text) TO authenticated, anon;
