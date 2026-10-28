-- ==============================================================================
-- MIGRAÇÃO 0160: CORRIGIR CAMPOS DE VALIDAÇÃO DE CUPOM, CÁLCULO ANUAL E LIMITE DE USOS
-- ==============================================================================
-- Objetivo:
--   1. Corrigir cálculo de cupom com valor fixo no plano anual:
--      Para ciclo anual, o desconto fixo mensal (ex: R$ 17,90) deve ser multiplicado
--      por 12 meses (vitalício/anual = 12 x 17,90 = R$ 214,80 off), resultando em
--      R$ 581,40 - R$ 214,80 = R$ 366,60 em vez de abater apenas 1 única mensalidade.
--   2. Garantir contagem e limite estrito de cupons REALMENTE FINALIZADOS:
--      - Adiciona status ('pendente', 'confirmado') em plataforma_cupons_usos.
--      - Não queima a cota de 10 cupons quando o cliente apenas abre o checkout e abandona.
--      - Apenas quando o pagamento for recebido/confirmado (webhook) o uso é confirmado
--        e contabilizado no limite global (ex: 10 cupons).
--   3. Regra de uso único por oficina (Prevenção de Abuso após Cancelamento):
--      - Se o cliente utilizou o cupom e posteriormente cancelou a assinatura,
--        o registro confirmado impede reutilizar o cupom em novas assinaturas.
--      - Ao re-assinar após cancelamento, volta obrigatoriamente ao valor original integral.
--   4. Exibir dados dinâmicos transparentes na simulação de DE / POR no painel administrativo.
-- ==============================================================================

-- 1. Garantir que plataforma_cupons_usos tenha as colunas status e confirmado_em
ALTER TABLE public.plataforma_cupons_usos 
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pendente';

ALTER TABLE public.plataforma_cupons_usos 
ADD COLUMN IF NOT EXISTS confirmado_em TIMESTAMPTZ NULL;

-- 2. Atualizar função validar_cupom
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
  v_ciclo_norm TEXT;
  v_usos_confirmados INT;
  v_multiplicador INT;
BEGIN
  IF p_codigo IS NULL OR trim(p_codigo) = '' THEN
    RETURN jsonb_build_object('valido', false, 'mensagem', 'Código do cupom não informado.');
  END IF;

  v_ciclo_norm := COALESCE(NULLIF(lower(trim(p_ciclo)), ''), 'mensal');
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

  -- 1. Validação de Prazo de Validade do Cupom (valido_ate)
  IF v_cupom.valido_ate IS NOT NULL AND v_cupom.valido_ate < now() THEN
    RETURN jsonb_build_object('valido', false, 'mensagem', 'Este cupom já expirou.');
  END IF;

  -- 2. Validação de Limite Global de Usos:
  -- Conta apenas as assinaturas que foram REALMENTE FINALIZADAS/CONFIRMADAS (status = 'confirmado').
  -- Isso impede que checkouts abandonados ou não pagos consumam a cota dos 10 clientes.
  SELECT count(*) INTO v_usos_confirmados
  FROM public.plataforma_cupons_usos
  WHERE cupom_id = v_cupom.id AND status = 'confirmado';

  IF v_cupom.limite_usos IS NOT NULL AND v_usos_confirmados >= v_cupom.limite_usos THEN
    RETURN jsonb_build_object('valido', false, 'mensagem', 'O limite de utilizações deste cupom foi atingido.');
  END IF;

  -- 3. Validação de Plano Alvo
  IF v_cupom.plano_alvo != 'todos' AND lower(trim(v_cupom.plano_alvo)) != lower(trim(p_plano)) THEN
    RETURN jsonb_build_object(
      'valido', false,
      'mensagem', format('Este cupom é exclusivo para o plano %s.', upper(v_cupom.plano_alvo))
    );
  END IF;

  -- 4. Validação de Uso Único por Oficina/Tenant:
  -- Se a oficina já finalizou uma assinatura com este cupom anteriormente, bloqueia a reutilização.
  -- Se o cliente cancelou e tentou voltar, ele não pode reutilizar o cupom (paga o valor original).
  IF v_tenant_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.plataforma_cupons_usos
      WHERE cupom_id = v_cupom.id AND tenant_id = v_tenant_id AND status = 'confirmado'
    ) INTO v_ja_usou;

    IF v_ja_usou THEN
      RETURN jsonb_build_object('valido', false, 'mensagem', 'Sua oficina já utilizou este cupom anteriormente.');
    END IF;
  END IF;

  -- 5. Busca o preço dinâmico do plano na tabela plans
  IF v_ciclo_norm = 'anual' THEN
    SELECT COALESCE(preco_anual_centavos, preco_centavos * 10) INTO v_preco_centavos
    FROM public.plans
    WHERE codigo = lower(trim(p_plano));
  ELSE
    SELECT preco_centavos INTO v_preco_centavos
    FROM public.plans
    WHERE codigo = lower(trim(p_plano));
  END IF;

  -- Fallback de segurança se o plano não estiver cadastrado na tabela plans
  IF v_preco_centavos IS NULL THEN
    IF lower(trim(p_plano)) = 'pro' THEN
      v_preco_centavos := CASE WHEN v_ciclo_norm = 'anual' THEN 58140 ELSE 5700 END;
    ELSIF lower(trim(p_plano)) = 'studio' THEN
      v_preco_centavos := CASE WHEN v_ciclo_norm = 'anual' THEN 147000 ELSE 14700 END;
    ELSE
      RETURN jsonb_build_object('valido', false, 'mensagem', 'Plano selecionado não encontrado na base de planos.');
    END IF;
  END IF;

  v_valor_original := round(v_preco_centavos / 100.0, 2);

  -- 6. Cálculo do desconto (percentual ou valor fixo):
  -- No ciclo ANUAL:
  -- Se for percentual: aplica % sobre o valor anual total
  -- Se for valor fixo (ex: R$ 17.90/mês):
  --   Multiplica por 12 meses (vitalício = 12 x 17.90 = R$ 214.80)
  --   ou pelo número de meses promocionais se < 12 (ex: 2 meses = 2 x 17.90 = R$ 35.80)
  IF v_cupom.desconto_tipo = 'percentual' THEN
    v_valor_desconto := round(v_valor_original * (v_cupom.desconto_valor / 100.0), 2);
  ELSE
    IF v_ciclo_norm = 'anual' THEN
      v_multiplicador := CASE 
        WHEN COALESCE(v_cupom.duracao_meses, 1) = 0 THEN 12
        ELSE LEAST(12, v_cupom.duracao_meses)
      END;
      v_valor_desconto := round(v_cupom.desconto_valor * v_multiplicador, 2);
    ELSE
      v_valor_desconto := v_cupom.desconto_valor;
    END IF;
  END IF;

  IF v_valor_desconto > v_valor_original THEN
    v_valor_desconto := v_valor_original;
  END IF;

  v_valor_final := round(v_valor_original - v_valor_desconto, 2);
  IF v_valor_final < 0 THEN 
    v_valor_final := 0; 
  END IF;

  RETURN jsonb_build_object(
    'valido', true,
    'id', v_cupom.id,
    'codigo', v_cupom.codigo,
    'descricao', v_cupom.descricao,
    'desconto_tipo', v_cupom.desconto_tipo,
    'desconto_valor', v_cupom.desconto_valor,
    'duracao_meses', COALESCE(v_cupom.duracao_meses, 1),
    'ciclo', v_ciclo_norm,
    'valor_original', v_valor_original,
    'valor_desconto', v_valor_desconto,
    'valor_final', v_valor_final,
    'mensagem', 'Cupom aplicado com sucesso!'
  );
END;
$$;

-- Sobrecarga de conveniência com 2 parâmetros para compatibilidade com chamadas existentes
CREATE OR REPLACE FUNCTION public.validar_cupom(
  p_codigo TEXT,
  p_plano TEXT
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.validar_cupom(p_codigo, p_plano, 'mensal');
$$;

GRANT EXECUTE ON FUNCTION public.validar_cupom(text, text, text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.validar_cupom(text, text) TO authenticated, anon, service_role;

-- 3. Registrar uso pendente no checkout sem inflar total_usos prematuramente
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
    asaas_payment_id, asaas_subscription_id, usado_em, status
  ) VALUES (
    p_cupom_id, p_tenant_id, auth.uid(), p_plano,
    p_valor_original, p_valor_desconto, p_valor_final,
    p_asaas_payment_id, p_asaas_subscription_id, now(), 'pendente'
  )
  ON CONFLICT (cupom_id, tenant_id) DO UPDATE SET
    valor_original = EXCLUDED.valor_original,
    valor_desconto = EXCLUDED.valor_desconto,
    valor_final = EXCLUDED.valor_final,
    asaas_payment_id = COALESCE(EXCLUDED.asaas_payment_id, public.plataforma_cupons_usos.asaas_payment_id),
    asaas_subscription_id = COALESCE(EXCLUDED.asaas_subscription_id, public.plataforma_cupons_usos.asaas_subscription_id),
    usado_em = now();

  RETURN jsonb_build_object('sucesso', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_uso_cupom(uuid, uuid, text, numeric, numeric, numeric, text, text) TO authenticated, service_role;

-- 4. Função para confirmar o uso do cupom quando o pagamento for recebido/confirmado
DROP FUNCTION IF EXISTS public.confirmar_uso_cupom(uuid, text, text);
CREATE OR REPLACE FUNCTION public.confirmar_uso_cupom(
  p_tenant_id UUID,
  p_asaas_subscription_id TEXT DEFAULT NULL,
  p_asaas_payment_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cupom_id UUID;
  v_usos_total INT;
BEGIN
  UPDATE public.plataforma_cupons_usos
  SET status = 'confirmado',
      confirmado_em = now(),
      asaas_payment_id = COALESCE(p_asaas_payment_id, asaas_payment_id),
      asaas_subscription_id = COALESCE(p_asaas_subscription_id, asaas_subscription_id)
  WHERE tenant_id = p_tenant_id
    AND status = 'pendente'
  RETURNING cupom_id INTO v_cupom_id;

  IF v_cupom_id IS NOT NULL THEN
    SELECT count(*) INTO v_usos_total
    FROM public.plataforma_cupons_usos
    WHERE cupom_id = v_cupom_id AND status = 'confirmado';

    UPDATE public.plataforma_cupons
    SET total_usos = v_usos_total,
        updated_at = now()
    WHERE id = v_cupom_id;
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'cupom_id', v_cupom_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirmar_uso_cupom(uuid, text, text) TO authenticated, service_role;

-- 5. Atualizar admin_listar_cupons para exibir utilizações confirmadas reais
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
    'total_usos', COALESCE((
      SELECT count(*) FROM public.plataforma_cupons_usos u WHERE u.cupom_id = c.id AND u.status = 'confirmado'
    ), c.total_usos),
    'ativo', c.ativo,
    'origem', c.origem,
    'parceiro_id', c.parceiro_id,
    'parceiro_nome', p.nome,
    'valido_ate', c.valido_ate,
    'created_at', c.created_at,
    'total_desconto_concedido', COALESCE((
      SELECT sum(u.valor_desconto) FROM public.plataforma_cupons_usos u WHERE u.cupom_id = c.id AND u.status = 'confirmado'
    ), 0)
  ) ORDER BY c.created_at DESC), '[]'::jsonb)
  INTO v_res
  FROM public.plataforma_cupons c
  LEFT JOIN public.parceiros p ON p.id = c.parceiro_id;

  RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_listar_cupons() TO authenticated;

-- 6. Atualizar obter_assinatura_tenant para retornar dados da promoção de cupom
CREATE OR REPLACE FUNCTION public.obter_assinatura_tenant(p_tenant_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
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
  v_plano_final TEXT;
  v_valor_dinamico INTEGER;
BEGIN
  v_tenant_id := COALESCE(p_tenant_id, (SELECT public.meus_tenants() LIMIT 1));
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('existe', false, 'status', 'trial', 'plano', 'pro', 'ciclo', 'mensal');
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = v_tenant_id;
  SELECT * INTO v_ass FROM public.assinaturas WHERE tenant_id = v_tenant_id;

  v_hoje := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  IF NOT FOUND THEN
    SELECT preco_centavos INTO v_valor_dinamico FROM public.plans WHERE codigo = 'pro';
    RETURN jsonb_build_object(
      'existe', false,
      'plano', COALESCE(v_tenant.plano::text, 'free'),
      'status', CASE WHEN v_tenant.plano = 'free' THEN 'cancelada' ELSE 'trial' END,
      'ciclo', 'mensal',
      'valor_centavos', COALESCE(v_valor_dinamico, 0),
      'dias_trial_restantes', 0
    );
  END IF;

  v_status_final := v_ass.status;
  v_plano_final := COALESCE(v_ass.plano, v_tenant.plano, 'pro');

  -- VERIFICAÇÃO ATIVA DE EXPIRAÇÃO DE TRIAL
  IF v_status_final = 'trial' AND v_ass.trial_fim IS NOT NULL THEN
    v_dias_trial := v_ass.trial_fim - v_hoje;
    IF v_dias_trial <= 0 THEN
      v_dias_trial := 0;
      v_status_final := 'cancelada';
      v_plano_final := 'free';

      UPDATE public.assinaturas
      SET plano = 'free',
          status = 'cancelada',
          cancelada_em = COALESCE(cancelada_em, now()),
          updated_at = now()
      WHERE id = v_ass.id;

      UPDATE public.tenants
      SET plano = 'free',
          updated_at = now()
      WHERE id = v_tenant_id;
    END IF;
  END IF;

  -- VERIFICAÇÃO DE ATRASO
  IF v_status_final = 'atrasada' AND v_ass.atraso_desde IS NOT NULL THEN
    v_dias_atraso := v_hoje - v_ass.atraso_desde;
    v_dias_para_rebaixamento := 5 - v_dias_atraso;
    IF v_dias_para_rebaixamento <= 0 THEN
      v_dias_para_rebaixamento := 0;
      v_status_final := 'cancelada';
      v_plano_final := 'free';

      UPDATE public.assinaturas
      SET plano = 'free',
          status = 'cancelada',
          updated_at = now()
      WHERE id = v_ass.id;

      UPDATE public.tenants
      SET plano = 'free',
          updated_at = now()
      WHERE id = v_tenant_id;
    END IF;
  END IF;

  -- Busca preço dinâmico na tabela plans
  SELECT 
    CASE 
      WHEN COALESCE(v_ass.ciclo, 'mensal') = 'anual' AND p.preco_anual_centavos IS NOT NULL AND p.preco_anual_centavos > 0 
        THEN p.preco_anual_centavos
      ELSE p.preco_centavos
    END
  INTO v_valor_dinamico
  FROM public.plans p
  WHERE p.codigo = v_plano_final;

  RETURN jsonb_build_object(
    'existe', true,
    'id', v_ass.id,
    'tenant_id', v_ass.tenant_id,
    'plano', v_plano_final,
    'status', v_status_final,
    'ciclo', COALESCE(v_ass.ciclo, 'mensal'),
    'forma_pagamento', v_ass.forma_pagamento,
    'valor_centavos', COALESCE(v_valor_dinamico, v_ass.valor_centavos, 0),
    'trial_fim', v_ass.trial_fim,
    'dias_trial_restantes', v_dias_trial,
    'proximo_vencimento', v_ass.proximo_vencimento,
    'atraso_desde', v_ass.atraso_desde,
    'dias_atraso', v_dias_atraso,
    'dias_para_rebaixamento', v_dias_para_rebaixamento,
    'url_pagamento_asaas', v_ass.url_pagamento_asaas,
    'asaas_subscription_id', v_ass.asaas_subscription_id,
    'cancelada_em', v_ass.cancelada_em,
    'promo_meses_restantes', v_ass.promo_meses_restantes,
    'promo_valor_normal_centavos', v_ass.promo_valor_normal_centavos,
    'promo_cupom_codigo', v_ass.promo_cupom_codigo,
    'promo_valor_cobrado_centavos', v_ass.valor_centavos
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_assinatura_tenant(UUID) TO authenticated, service_role;
