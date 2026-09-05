-- =========================================================================================
-- MIGRATION 0091: ADICIONAR_ITEM_AGENDAMENTO PERMISSIVO PARA ATENDIMENTOS EM ANDAMENTO
-- Permite que gestores adicionem serviços a agendamentos em andamento ou concluídos
-- sem bloqueio indevido por horário de fechamento comercial, com suporte a p_forcar
-- e sincronização automática em execucao_itens quando a execução já existir.
-- =========================================================================================

DROP FUNCTION IF EXISTS public.adicionar_item_agendamento(uuid, uuid);
DROP FUNCTION IF EXISTS public.adicionar_item_agendamento(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.adicionar_item_agendamento(uuid, uuid, uuid, boolean);

CREATE OR REPLACE FUNCTION public.adicionar_item_agendamento(
  p_agendamento uuid,
  p_servico uuid,
  p_combo uuid DEFAULT null,
  p_forcar boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_agendamento record;
  v_data date;
  v_hora time;
  v_itens_atuais jsonb;
  v_novos_itens jsonb;
  v_duracao_item integer;
  v_modo_item text;
  v_dias_item integer;
  v_preco_item numeric(10,2);
  v_is_valido boolean := false;
  v_novos_minutos integer;
  v_termino_previsto text;
  v_servico_nome text;
  v_execucao record;
  v_categoria_id uuid;
BEGIN
  SELECT * INTO v_agendamento FROM public.agendamentos WHERE id = p_agendamento;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado.'; END IF;

  IF NOT public.tem_papel(v_agendamento.tenant_id, ARRAY['dono', 'gerente']::app_role[]) THEN
    RAISE EXCEPTION 'Apenas donos ou gerentes podem alterar serviços do agendamento.';
  END IF;

  -- Se o agendamento já está em andamento/concluído ou se p_forcar = true, NÃO bloqueia por horário de fechamento
  IF v_agendamento.status NOT IN ('em_andamento', 'concluido') AND NOT coalesce(p_forcar, false) THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('servico_id', servico_id, 'combo_id', combo_id)), '[]'::jsonb)
    INTO v_itens_atuais
    FROM public.agendamento_itens WHERE agendamento_id = p_agendamento;

    v_novos_itens := v_itens_atuais || jsonb_build_array(jsonb_build_object('servico_id', p_servico, 'combo_id', p_combo));

    v_data := (v_agendamento.inicio AT TIME ZONE 'America/Sao_Paulo')::date;
    v_hora := (v_agendamento.inicio AT TIME ZONE 'America/Sao_Paulo')::time;

    PERFORM pg_advisory_xact_lock(hashtext(v_agendamento.tenant_id::text || ':' || v_data::text));

    SELECT disponivel INTO v_is_valido
    FROM public.horarios_disponiveis(v_agendamento.tenant_id, v_data, v_novos_itens, v_agendamento.categoria_id, p_agendamento) hd
    WHERE hd.horario = v_hora;

    IF NOT coalesce(v_is_valido, false) THEN
      SELECT coalesce(sum(duracao_minutos), 0) INTO v_novos_minutos
      FROM (
        SELECT duracao_minutos FROM public.agendamento_itens WHERE agendamento_id = p_agendamento
        UNION ALL
        SELECT coalesce(sp.duracao_minutos, 60)
        FROM public.servicos s
        LEFT JOIN public.servico_precos sp ON sp.servico_id = s.id AND sp.categoria_id = v_agendamento.categoria_id AND sp.ativo
        WHERE s.id = p_servico
      ) sub;

      v_termino_previsto := to_char((v_agendamento.inicio + (v_novos_minutos || ' minutes')::interval) AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI');

      RAISE EXCEPTION 'O atendimento passaria a terminar às %, depois do fechamento. Reagende ou remova um serviço.', v_termino_previsto;
    END IF;
  END IF;

  v_categoria_id := v_agendamento.categoria_id;

  SELECT 
    s.nome,
    coalesce(sp.duracao_minutos, s.duracao_minutos, 60),
    coalesce(s.modo_ocupacao, 'slot'),
    coalesce(s.dias_ocupados, 1),
    sp.preco_base
  INTO v_servico_nome, v_duracao_item, v_modo_item, v_dias_item, v_preco_item
  FROM public.servicos s
  LEFT JOIN public.servico_precos sp
    ON sp.servico_id = s.id
   AND sp.categoria_id = v_categoria_id
   AND sp.ativo
  WHERE s.id = p_servico AND s.tenant_id = v_agendamento.tenant_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Serviço não encontrado.'; END IF;

  -- Fallback de preço se a categoria do veículo não tiver preço específico ativo
  IF v_preco_item IS NULL THEN
    SELECT coalesce(preco_base, 0), coalesce(duracao_minutos, v_duracao_item)
    INTO v_preco_item, v_duracao_item
    FROM public.servico_precos
    WHERE servico_id = p_servico AND tenant_id = v_agendamento.tenant_id AND ativo
    ORDER BY preco_base DESC
    LIMIT 1;
  END IF;
  v_preco_item := coalesce(v_preco_item, 0);

  -- Insere o item na tabela agendamento_itens
  INSERT INTO public.agendamento_itens (
    tenant_id, agendamento_id, servico_id, combo_id,
    duracao_minutos, preco_estimado, modo_ocupacao, dias_ocupados, ordem
  ) VALUES (
    v_agendamento.tenant_id, p_agendamento, p_servico, p_combo,
    v_duracao_item, v_preco_item, v_modo_item, v_dias_item, 99
  )
  ON CONFLICT (agendamento_id, servico_id) DO UPDATE
  SET duracao_minutos = excluded.duracao_minutos,
      preco_estimado = excluded.preco_estimado;

  -- Se já houver execução aberta/em andamento, sincroniza também em execucao_itens
  SELECT * INTO v_execucao FROM public.execucoes WHERE agendamento_id = p_agendamento ORDER BY created_at DESC LIMIT 1;
  IF FOUND AND v_execucao.id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.execucao_itens
      WHERE execucao_id = v_execucao.id AND servico_nome = v_servico_nome
    ) THEN
      INSERT INTO public.execucao_itens (
        tenant_id,
        execucao_id,
        servico_nome,
        descricao,
        obrigatorio,
        ordem,
        concluido
      ) VALUES (
        v_agendamento.tenant_id,
        v_execucao.id,
        v_servico_nome,
        'Item adicionado via gestão do atendimento',
        true,
        99,
        false
      );
    END IF;
  END IF;

  -- Recalcula totais do agendamento
  PERFORM public.recalcular_agendamento_totais(p_agendamento);
END;
$$;

GRANT EXECUTE ON FUNCTION public.adicionar_item_agendamento(uuid, uuid, uuid, boolean) TO authenticated;
