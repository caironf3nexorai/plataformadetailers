-- ==============================================================================
-- MIGRAÇÃO 0170: RESTAURAR 'nao_compareceu' NA CONSTRAINT agendamentos_status_check
-- Na migração 0041, agendamentos_status_check foi recriada para adicionar
-- 'aguardando_confirmacao' e omitiu acidentalmente 'nao_compareceu', fazendo
-- a ação "Não Compareceu" falhar em todos os agendamentos.
-- ==============================================================================

DO $$
DECLARE
  v_conname text;
BEGIN
  FOR v_conname IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(c.conkey)
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'agendamentos'
      AND c.contype = 'c'
      AND array_length(c.conkey, 1) = 1
      AND att.attname = 'status'
  LOOP
    EXECUTE format('ALTER TABLE public.agendamentos DROP CONSTRAINT IF EXISTS %I', v_conname);
  END LOOP;

  ALTER TABLE public.agendamentos
    ADD CONSTRAINT agendamentos_status_check
    CHECK (
      status IN (
        'agendado',
        'aguardando_confirmacao',
        'confirmado',
        'em_andamento',
        'concluido',
        'cancelado',
        'nao_compareceu'
      )
    );
END;
$$;

-- Garante que RPCs de agenda continuam atualizadas e schema recarregado
NOTIFY pgrst, 'reload schema';

