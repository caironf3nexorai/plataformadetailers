-- ==============================================================================
-- MIGRAÇÃO 0160: CORRIGIR CAMPOS DE VALIDAÇÃO DE CUPOM (valido_ate e total_usos)
-- ==============================================================================
-- Objetivo:
--   1. Corrigir erro 'record "v_cupom" has no field "data_expiracao"' na função
--      validar_cupom. Na tabela plataforma_cupons as colunas corretas são:
--      - valido_ate (TIMESTAMPTZ) em vez de data_expiracao
--      - total_usos (INTEGER) em vez de usos_atuais
--   2. Garantir compatibilidade com chamadas de 2 ou 3 parâmetros (mensal/anual).
--   3. Retornar duracao_meses e campos completos para cálculo transparente de DE / POR.
-- ==============================================================================

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

  -- 2. Validação de Limite Global de Usos (total_usos)
  IF v_cupom.limite_usos IS NOT NULL AND v_cupom.total_usos >= v_cupom.limite_usos THEN
    RETURN jsonb_build_object('valido', false, 'mensagem', 'O limite de utilizações deste cupom foi atingido.');
  END IF;

  -- 3. Validação de Plano Alvo
  IF v_cupom.plano_alvo != 'todos' AND lower(trim(v_cupom.plano_alvo)) != lower(trim(p_plano)) THEN
    RETURN jsonb_build_object(
      'valido', false,
      'mensagem', format('Este cupom é exclusivo para o plano %s.', upper(v_cupom.plano_alvo))
    );
  END IF;

  -- 4. Validação de Uso Único por Oficina/Tenant
  IF v_tenant_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.plataforma_cupons_usos
      WHERE cupom_id = v_cupom.id AND tenant_id = v_tenant_id
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
      v_preco_centavos := CASE WHEN v_ciclo_norm = 'anual' THEN 57000 ELSE 5700 END;
    ELSIF lower(trim(p_plano)) = 'studio' THEN
      v_preco_centavos := CASE WHEN v_ciclo_norm = 'anual' THEN 147000 ELSE 14700 END;
    ELSE
      RETURN jsonb_build_object('valido', false, 'mensagem', 'Plano selecionado não encontrado na base de planos.');
    END IF;
  END IF;

  v_valor_original := round(v_preco_centavos / 100.0, 2);

  -- 6. Cálculo do desconto (percentual ou valor fixo)
  IF v_cupom.desconto_tipo = 'percentual' THEN
    v_valor_desconto := round(v_valor_original * (v_cupom.desconto_valor / 100.0), 2);
  ELSE
    v_valor_desconto := v_cupom.desconto_valor;
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

-- Sobrecarga de conveniência com 2 parâmetros para compatibilidade com código legado
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
