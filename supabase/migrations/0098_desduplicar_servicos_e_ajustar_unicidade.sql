-- ==============================================================================
-- MIGRATION 0098: DESDUPLICAR SERVIÇOS E REMOVER CONSTRAINT RÍGIDA
-- ==============================================================================
-- Esta migração:
-- 1. Remove a constraint servicos_tenant_id_nome_key se ainda existir
-- 2. Limpa registros duplicados existentes de serviços no mesmo tenant,
--    preservando o registro mais recente e redirecionando referências.
-- 3. Cria índice único parcial case-insensitive seguro para serviços ativos.

DO $$
DECLARE
  v_dup RECORD;
  v_keeper_id UUID;
  v_drop_id UUID;
BEGIN
  -- 1. Remove a constraint única antiga caso ainda exista
  IF EXISTS (
    SELECT 1 
    FROM information_schema.table_constraints 
    WHERE constraint_name = 'servicos_tenant_id_nome_key' 
      AND table_schema = 'public' 
      AND table_name = 'servicos'
  ) THEN
    ALTER TABLE public.servicos DROP CONSTRAINT servicos_tenant_id_nome_key;
  END IF;

  -- 2. Identifica e unifica duplicatas existentes por (tenant_id, lower(trim(nome)))
  FOR v_dup IN (
    SELECT tenant_id, lower(trim(nome)) AS nome_limpo, count(*) AS qtd
    FROM public.servicos
    GROUP BY tenant_id, lower(trim(nome))
    HAVING count(*) > 1
  ) LOOP
    -- Escolhe o serviço "guardião" (o mais recente com ativo=true, ou o mais recente)
    SELECT id INTO v_keeper_id
    FROM public.servicos
    WHERE tenant_id = v_dup.tenant_id 
      AND lower(trim(nome)) = v_dup.nome_limpo
    ORDER BY ativo DESC, updated_at DESC, created_at DESC
    LIMIT 1;

    -- Para todas as outras duplicatas deste mesmo nome
    FOR v_drop_id IN (
      SELECT id
      FROM public.servicos
      WHERE tenant_id = v_dup.tenant_id 
        AND lower(trim(nome)) = v_dup.nome_limpo
        AND id <> v_keeper_id
    ) LOOP
      -- Redireciona dependências de itens de agendamento
      UPDATE public.agendamentos
      SET servico_id = v_keeper_id
      WHERE servico_id = v_drop_id;

      UPDATE public.agendamento_itens
      SET servico_id = v_keeper_id
      WHERE servico_id = v_drop_id;

      UPDATE public.orcamento_nivel_itens
      SET servico_id = v_keeper_id
      WHERE servico_id = v_drop_id;

      -- Mescla preços da matriz do drop_id no keeper caso o keeper não tenha para a categoria
      INSERT INTO public.servico_precos (tenant_id, servico_id, categoria_id, preco_base, duracao_minutos, unidade_duracao, duracao_confirmada, ativo)
      SELECT sp.tenant_id, v_keeper_id, sp.categoria_id, sp.preco_base, sp.duracao_minutos, sp.unidade_duracao, sp.duracao_confirmada, sp.ativo
      FROM public.servico_precos sp
      WHERE sp.servico_id = v_drop_id
      ON CONFLICT (servico_id, categoria_id) DO NOTHING;

      -- Remove preços do serviço duplicado antigo
      DELETE FROM public.servico_precos WHERE servico_id = v_drop_id;

      -- Deleta a linha duplicada
      DELETE FROM public.servicos WHERE id = v_drop_id;
    END LOOP;
  END LOOP;
END $$;

-- 3. Recria o índice único parcial apenas para serviços ativos
DROP INDEX IF EXISTS public.servicos_tenant_id_nome_ativo_idx;

CREATE UNIQUE INDEX servicos_tenant_id_nome_ativo_idx 
ON public.servicos (tenant_id, lower(trim(nome))) 
WHERE (ativo = true);

COMMENT ON INDEX public.servicos_tenant_id_nome_ativo_idx IS 
'Garante unicidade case-insensitive apenas para serviços ativos do mesmo tenant.';
