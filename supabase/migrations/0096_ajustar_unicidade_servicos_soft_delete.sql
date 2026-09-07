-- ==============================================================================
-- MIGRAÇÃO 0096: AJUSTAR UNICIDADE DE SERVIÇOS PARA SUPORTAR SOFT-DELETE
-- ==============================================================================
-- O constraint rígido servicos_tenant_id_nome_key (UNIQUE (tenant_id, nome))
-- impedia o cadastro de serviços com o mesmo nome mesmo que o anterior estivesse
-- inativo (ativo = false).
-- Esta migração substitui a restrição total por um índice único parcial apenas
-- para serviços ativos, com comparação case-insensitive (lower(trim(nome))).

DO $$
BEGIN
  -- 1. Remove a restrição única antiga se existir
  IF EXISTS (
    SELECT 1 
    FROM information_schema.table_constraints 
    WHERE constraint_name = 'servicos_tenant_id_nome_key' 
      AND table_schema = 'public' 
      AND table_name = 'servicos'
  ) THEN
    ALTER TABLE public.servicos DROP CONSTRAINT servicos_tenant_id_nome_key;
  END IF;
END $$;

-- 2. Cria índice único parcial considerando apenas serviços ativos e case-insensitive
CREATE UNIQUE INDEX IF NOT EXISTS servicos_tenant_id_nome_ativo_idx 
ON public.servicos (tenant_id, lower(trim(nome))) 
WHERE (ativo = true);

COMMENT ON INDEX public.servicos_tenant_id_nome_ativo_idx IS 
'Garante que não existam serviços ativos duplicados com o mesmo nome (case-insensitive) para o mesmo tenant.';
