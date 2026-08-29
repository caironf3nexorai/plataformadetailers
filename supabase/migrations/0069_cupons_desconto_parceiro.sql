-- ==============================================================================
-- MIGRAÇÃO 0069: SUPORTE A CUPONS DE DESCONTO DE PARCEIROS COMERCIAIS
-- Permite que cada parceiro ofereça um desconto na mensalidade para as oficinas que usarem seu código.
-- ==============================================================================

ALTER TABLE public.parceiros
ADD COLUMN IF NOT EXISTS desconto_tipo TEXT DEFAULT 'nenhum' CHECK (desconto_tipo IN ('nenhum', 'percentual', 'valor_fixo')),
ADD COLUMN IF NOT EXISTS desconto_valor NUMERIC(10,2) DEFAULT 0;
