-- ==============================================================================
-- MIGRAÇÃO 0116: FIX COLUNAS DE TERMOS DE GARANTIA E RESPONSABILIDADE EM AGENDAMENTOS
-- ==============================================================================

-- 1. ADICIONA COLUNA NA TABELA TENANTS CASO NÃO EXISTA
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS termo_responsabilidade text DEFAULT NULL;

-- 2. ADICIONA COLUNAS DE RASTREABILIDADE DE TERMOS NA TABELA AGENDAMENTOS
ALTER TABLE public.agendamentos
  ADD COLUMN IF NOT EXISTS termo_garantia_id uuid REFERENCES public.termos_garantia(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS termo_responsabilidade_texto text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS termo_garantia_texto text DEFAULT NULL;

-- 3. RECARREGA CACHE DE SCHEMA DO POSTGREST
NOTIFY pgrst, 'reload schema';
