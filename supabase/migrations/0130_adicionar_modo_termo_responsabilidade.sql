-- ==============================================================================
-- MIGRATION 0130: Adicionar coluna modo_termo_responsabilidade em orçamentos
-- Controla se o termo está no modo 'dinamico' (auto-gerado por serviço) ou 'personalizado'
-- ==============================================================================

ALTER TABLE public.orcamentos
  ADD COLUMN IF NOT EXISTS modo_termo_responsabilidade text DEFAULT 'dinamico';

COMMENT ON COLUMN public.orcamentos.modo_termo_responsabilidade IS 'Modo do termo de responsabilidade no orçamento: dinamico (gerado e atualizado conforme os serviços selecionados) ou personalizado (editado manualmente pelo usuário).';
