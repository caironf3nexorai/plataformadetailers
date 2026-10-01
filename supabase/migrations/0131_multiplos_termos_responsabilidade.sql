-- ==============================================================================
-- MIGRATION 0131: Suporte a Múltiplos Termos de Responsabilidade por Oficina
-- Permite que uma oficina tenha múltiplos modelos de responsabilidade ativos
-- (ex: Padrão do Advogado CDC, Veículos Antigos/Colecionáveis, Pátio) e escolha
-- no orçamento qual termo aplicar na proposta e na impressão do PDF.
-- ==============================================================================

-- 1. ADICIONAR CATEGORIA NA TABELA TERMOS_GARANTIA
ALTER TABLE public.termos_garantia
  ADD COLUMN IF NOT EXISTS categoria text NOT NULL DEFAULT 'garantia';

COMMENT ON COLUMN public.termos_garantia.categoria IS 'Categoria do termo: "garantia" ou "responsabilidade". Permite que a oficina armazene múltiplos termos de responsabilidade e escolha qual aplicar em cada orçamento.';

-- 2. ADICIONAR COLUNA TERMO_RESPONSABILIDADE_ID EM ORÇAMENTOS
ALTER TABLE public.orcamentos
  ADD COLUMN IF NOT EXISTS termo_responsabilidade_id uuid REFERENCES public.termos_garantia(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.orcamentos.termo_responsabilidade_id IS 'ID do termo de responsabilidade selecionado para este orçamento na impressão do PDF e proposta.';
