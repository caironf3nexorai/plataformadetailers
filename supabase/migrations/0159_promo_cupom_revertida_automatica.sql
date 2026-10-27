-- ==============================================================================
-- MIGRAÇÃO 0159: REVERSÃO AUTOMÁTICA DE PREÇO PROMOCIONAL (CUPOM POR MESES)
-- ==============================================================================
-- Objetivo:
--   Quando um cupom com duracao_meses > 1 é aplicado (Black Friday, campanhas, etc.),
--   registrar na assinatura quantos meses de promoção restam e qual o valor original.
--   O webhook de pagamento decrementa o contador a cada cobrança confirmada.
--   Ao zerar, o webhook chama o Asaas para restaurar o preço normal automaticamente.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ADICIONAR COLUNAS DE PROMOÇÃO TEMPORÁRIA NA TABELA assinaturas
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  -- Meses restantes com desconto promocional (NULL = sem promoção ativa)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'assinaturas'
      AND column_name = 'promo_meses_restantes'
  ) THEN
    ALTER TABLE public.assinaturas
      ADD COLUMN promo_meses_restantes INTEGER NULL
        CHECK (promo_meses_restantes IS NULL OR promo_meses_restantes >= 0);
    COMMENT ON COLUMN public.assinaturas.promo_meses_restantes IS
      'Meses de promoção restantes. NULL = sem promoção. 0 = promoção encerrada (preço já restaurado). >0 = ainda em promoção.';
  END IF;

  -- Valor original do plano em centavos (para restaurar após promoção)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'assinaturas'
      AND column_name = 'promo_valor_normal_centavos'
  ) THEN
    ALTER TABLE public.assinaturas
      ADD COLUMN promo_valor_normal_centavos INTEGER NULL;
    COMMENT ON COLUMN public.assinaturas.promo_valor_normal_centavos IS
      'Valor normal do plano em centavos (antes do desconto), usado para restaurar o preço após o período promocional.';
  END IF;

  -- ID do cupom que originou a promoção (referência para auditoria)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'assinaturas'
      AND column_name = 'promo_cupom_id'
  ) THEN
    ALTER TABLE public.assinaturas
      ADD COLUMN promo_cupom_id UUID NULL
        REFERENCES public.plataforma_cupons(id) ON DELETE SET NULL;
    COMMENT ON COLUMN public.assinaturas.promo_cupom_id IS
      'Cupom que gerou o preço promocional vigente na assinatura.';
  END IF;

  -- Código do cupom (desnormalizado para facilitar auditoria sem JOIN)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'assinaturas'
      AND column_name = 'promo_cupom_codigo'
  ) THEN
    ALTER TABLE public.assinaturas
      ADD COLUMN promo_cupom_codigo TEXT NULL;
    COMMENT ON COLUMN public.assinaturas.promo_cupom_codigo IS
      'Código do cupom que originou a promoção (desnormalizado para auditoria rápida).';
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_assinaturas_promo_ativa
  ON public.assinaturas(promo_meses_restantes)
  WHERE promo_meses_restantes IS NOT NULL AND promo_meses_restantes > 0;

-- ------------------------------------------------------------------------------
-- 2. RPC: iniciar_promocao_assinatura
--    Chamada pelo checkout após criar assinatura com cupom de duracao_meses > 1
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.iniciar_promocao_assinatura(uuid, integer, integer, uuid, text);
CREATE OR REPLACE FUNCTION public.iniciar_promocao_assinatura(
  p_tenant_id              UUID,
  p_meses                  INTEGER,
  p_valor_normal_centavos  INTEGER,
  p_cupom_id               UUID,
  p_cupom_codigo           TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.assinaturas SET
    promo_meses_restantes       = p_meses,
    promo_valor_normal_centavos = p_valor_normal_centavos,
    promo_cupom_id              = p_cupom_id,
    promo_cupom_codigo          = p_cupom_codigo,
    updated_at                  = now()
  WHERE tenant_id = p_tenant_id;

  RETURN jsonb_build_object('sucesso', true, 'meses_restantes', p_meses);
END;
$$;

GRANT EXECUTE ON FUNCTION public.iniciar_promocao_assinatura(uuid, integer, integer, uuid, text)
  TO service_role;

-- ------------------------------------------------------------------------------
-- 3. RPC: decrementar_promo_assinatura
--    Chamada pelo webhook a cada PAYMENT_CONFIRMED.
--    Retorna: { "deve_restaurar": true/false, "valor_normal_centavos": N }
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.decrementar_promo_assinatura(uuid);
CREATE OR REPLACE FUNCTION public.decrementar_promo_assinatura(
  p_tenant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ass   RECORD;
  v_novo  INTEGER;
BEGIN
  SELECT promo_meses_restantes, promo_valor_normal_centavos, promo_cupom_codigo
  INTO v_ass
  FROM public.assinaturas
  WHERE tenant_id = p_tenant_id;

  -- Sem promoção ativa ou já encerrada
  IF NOT FOUND
     OR v_ass.promo_meses_restantes IS NULL
     OR v_ass.promo_meses_restantes <= 0
  THEN
    RETURN jsonb_build_object('deve_restaurar', false, 'promo_ativa', false);
  END IF;

  -- Decrementa 1 mês
  v_novo := v_ass.promo_meses_restantes - 1;

  UPDATE public.assinaturas SET
    promo_meses_restantes = v_novo,
    updated_at            = now()
  WHERE tenant_id = p_tenant_id;

  -- Se chegou a zero, sinaliza para o webhook restaurar o preço
  IF v_novo = 0 THEN
    RETURN jsonb_build_object(
      'deve_restaurar',         true,
      'promo_ativa',            false,
      'valor_normal_centavos',  v_ass.promo_valor_normal_centavos,
      'cupom_codigo',           v_ass.promo_cupom_codigo
    );
  END IF;

  -- Ainda em promoção
  RETURN jsonb_build_object(
    'deve_restaurar',         false,
    'promo_ativa',            true,
    'meses_restantes',        v_novo,
    'valor_normal_centavos',  v_ass.promo_valor_normal_centavos
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.decrementar_promo_assinatura(uuid)
  TO service_role;

-- ------------------------------------------------------------------------------
-- 4. VIEW para o painel admin visualizar promoções ativas
-- ------------------------------------------------------------------------------
DROP VIEW IF EXISTS public.admin_promocoes_ativas;
CREATE VIEW public.admin_promocoes_ativas AS
SELECT
  t.id              AS tenant_id,
  t.nome            AS oficina_nome,
  a.plano,
  a.ciclo,
  a.valor_centavos  AS valor_promo_centavos,
  round(a.valor_centavos / 100.0, 2)              AS valor_promo_reais,
  a.promo_meses_restantes,
  a.promo_valor_normal_centavos,
  round(a.promo_valor_normal_centavos / 100.0, 2) AS valor_normal_reais,
  a.promo_cupom_codigo,
  a.promo_cupom_id,
  a.updated_at
FROM public.assinaturas a
JOIN public.tenants t ON t.id = a.tenant_id
WHERE a.promo_meses_restantes IS NOT NULL
  AND a.promo_meses_restantes > 0
ORDER BY a.promo_meses_restantes ASC;

GRANT SELECT ON public.admin_promocoes_ativas TO authenticated;
