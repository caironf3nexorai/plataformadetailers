-- ==============================================================================
-- MIGRAÇÃO 0176: VISIBILIDADE DE 'nao_compareceu' E REAGENDAMENTO DE OS/ORÇAMENTO
-- ==============================================================================
-- 1. Corrige public.horarios_disponiveis para também desconsiderar agendamentos
--    com status = 'nao_compareceu' ao calcular capacidade de box livre (regressão
--    introduzida na 0166 ao filtrar apenas 'cancelado').
-- 2. Atualiza public.reagendar(uuid, timestamptz) para:
--    - Validar usuário autenticado e status permitidos (bloqueia cancelado/concluido/em_andamento)
--    - Reativar agendamentos em 'nao_compareceu' para 'agendado' (ou
--      'aguardando_confirmacao' se sinal pendente), preservando numero_os e
--      registrando histórico nas observações
--    - Recalcular previsao_entrega para o novo horário
-- 3. Cria public.reagendar_os_orcamento(uuid, timestamptz) para reagendar uma OS
--    diretamente pela tela do Orçamento (DetalheOrcamento) mantendo numero_os e
--    evitando colisão no índice único agendamentos_numero_os_unico.
-- 4. Fortalece public.converter_orcamento_em_agendamento contra colisão de
--    numero_os quando houver OS anterior cancelada e preenche previsao_entrega.
-- ==============================================================================


-- ------------------------------------------------------------------------------
-- 1. HORARIOS_DISPONIVEIS: libera horários marcados como 'nao_compareceu'
--    (Preserva permissões existentes da assinatura canônica de 5 argumentos)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.horarios_disponiveis(
  p_tenant uuid,
  p_data date,
  p_itens jsonb DEFAULT NULL,
  p_categoria uuid DEFAULT NULL,
  p_ignorar_agendamento uuid DEFAULT NULL
) RETURNS TABLE (
  horario time,
  disponivel boolean,
  motivo text,
  termino_previsto timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
#variable_conflict use_column
DECLARE
  v_fuso text := public.obter_fuso_tenant(p_tenant);
  v_dia_semana smallint;
  v_horario_func record;
  v_grade_minutos smallint;
  v_duracao_total_itens integer := 0;
  v_modo_efetivo text := 'transborda';
  v_max_dias integer := 1;
  v_item jsonb;
  v_servico_id uuid;
  v_combo_id uuid;
  v_dur_item integer;
  v_modo_item text;
  v_dias_item integer;
  v_posicao_inicio timestamptz;
  v_posicao_fim timestamptz;
  v_janela_fim_dia1 timestamptz;
  v_slot_time time;
  v_fechamento_ts timestamptz;
  v_agora_sp timestamptz;
  v_sobrepoem_bloqueio boolean;
  v_qtd_agendamentos_ativos integer;
  v_pos_index integer;
  v_is_disponivel boolean;
  v_motivo_indisponivel text;
BEGIN
  v_dia_semana := extract(dow FROM p_data)::smallint;

  SELECT * INTO v_horario_func
  FROM public.horarios_funcionamento h
  WHERE h.tenant_id = p_tenant AND h.dia_semana = v_dia_semana AND h.ativo;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT coalesce(t.grade_minutos, 60) INTO v_grade_minutos
  FROM public.tenants t WHERE t.id = p_tenant;

  IF p_itens IS NOT NULL AND jsonb_array_length(p_itens) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
      v_servico_id := nullif(v_item->>'servico_id', '')::uuid;
      v_combo_id := nullif(v_item->>'combo_id', '')::uuid;

      IF v_servico_id IS NOT NULL THEN
        SELECT
          coalesce(sp.duracao_minutos, nullif(v_item->>'duracao_minutos', '')::integer, 60),
          coalesce(v_item->>'modo_ocupacao', s.modo_ocupacao, 'transborda'),
          coalesce(s.dias_ocupados, 1)
        INTO v_dur_item, v_modo_item, v_dias_item
        FROM public.servicos s
        LEFT JOIN public.servico_precos sp
          ON sp.servico_id = s.id
         AND (p_categoria IS NULL OR sp.categoria_id = p_categoria)
         AND sp.ativo
        WHERE s.id = v_servico_id AND s.tenant_id = p_tenant
        LIMIT 1;

        IF FOUND THEN
          v_duracao_total_itens := v_duracao_total_itens + coalesce(v_dur_item, 60);
          IF v_dias_item > v_max_dias THEN v_max_dias := v_dias_item; END IF;
          v_modo_efetivo := 'transborda';
        END IF;
      ELSIF v_combo_id IS NOT NULL THEN
        SELECT coalesce(cp.duracao_minutos, nullif(v_item->>'duracao_minutos', '')::integer, 60)
        INTO v_dur_item
        FROM public.combo_precos cp
        WHERE cp.combo_id = v_combo_id
          AND (p_categoria IS NULL OR cp.categoria_id = p_categoria)
        LIMIT 1;

        v_duracao_total_itens := v_duracao_total_itens + coalesce(v_dur_item, nullif(v_item->>'duracao_minutos', '')::integer, 60);
        v_modo_efetivo := 'transborda';
      ELSE
        -- Serviço Único avulso (sem servico_id e sem combo_id)
        v_dur_item := coalesce(nullif(v_item->>'duracao_minutos', '')::integer, 60);
        IF v_dur_item <= 0 THEN v_dur_item := 60; END IF;
        v_duracao_total_itens := v_duracao_total_itens + v_dur_item;
        v_modo_efetivo := 'transborda';
      END IF;
    END LOOP;
  ELSE
    v_modo_efetivo := 'transborda';
  END IF;

  IF v_duracao_total_itens = 0 THEN
    v_duracao_total_itens := 60;
  END IF;

  v_agora_sp := now() AT TIME ZONE v_fuso;

  v_slot_time := v_horario_func.abre;
  v_fechamento_ts := (p_data || ' ' || v_horario_func.fecha)::timestamp AT TIME ZONE v_fuso;
  v_pos_index := 0;

  WHILE v_slot_time <= (v_horario_func.fecha - (v_grade_minutos || ' minutes')::interval) LOOP
    v_pos_index := v_pos_index + 1;
    v_posicao_inicio := (p_data || ' ' || v_slot_time)::timestamp AT TIME ZONE v_fuso;

    v_is_disponivel := true;
    v_motivo_indisponivel := null;

    -- Calcula término efetivo com base em horas úteis da oficina
    v_posicao_fim := public.calcular_fim_efetivo(p_tenant, v_posicao_inicio, v_duracao_total_itens, 'transborda');

    IF v_posicao_fim < v_fechamento_ts THEN
      v_janela_fim_dia1 := v_posicao_fim;
    ELSE
      v_janela_fim_dia1 := v_fechamento_ts;
    END IF;

    IF v_is_disponivel AND v_posicao_inicio < v_agora_sp THEN
      v_is_disponivel := false;
      v_motivo_indisponivel := 'passado';
    END IF;

    IF v_is_disponivel THEN
      SELECT exists(
        SELECT 1 FROM public.bloqueios_agenda b
        WHERE b.tenant_id = p_tenant
          AND b.inicio < v_janela_fim_dia1
          AND b.fim > v_posicao_inicio
      ) INTO v_sobrepoem_bloqueio;

      IF v_sobrepoem_bloqueio THEN
        v_is_disponivel := false;
        v_motivo_indisponivel := 'bloqueado';
      END IF;
    END IF;

    IF v_is_disponivel THEN
      SELECT count(*) INTO v_qtd_agendamentos_ativos
      FROM public.agendamentos a
      WHERE a.tenant_id = p_tenant
        AND a.status NOT IN ('cancelado', 'nao_compareceu')
        AND (p_ignorar_agendamento IS NULL OR a.id <> p_ignorar_agendamento)
        AND a.inicio < v_janela_fim_dia1
        AND public.calcular_fim_efetivo(
              a.tenant_id,
              a.inicio,
              coalesce(a.duracao_total, a.duracao_minutos, 60),
              'transborda'
            ) > v_posicao_inicio;

      IF v_qtd_agendamentos_ativos >= coalesce(v_horario_func.capacidade, 1) THEN
        v_is_disponivel := false;
        v_motivo_indisponivel := 'sem_box_livre';
      END IF;
    END IF;

    horario := v_slot_time;
    disponivel := v_is_disponivel;
    motivo := v_motivo_indisponivel;
    termino_previsto := v_posicao_fim;
    RETURN NEXT;

    v_slot_time := (v_slot_time + (v_grade_minutos || ' minutes')::interval)::time;
  END LOOP;
END;
$$;


-- ------------------------------------------------------------------------------
-- 2. REAGENDAR: suporta reativar OS em 'nao_compareceu' e atualiza previsao_entrega
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reagendar(
  p_agendamento uuid,
  p_novo_inicio timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_agendamento record;
  v_fuso text;
  v_data date;
  v_hora time;
  v_is_valido boolean := false;
  v_termino_previsto timestamptz;
  v_itens_json jsonb;
  v_novo_status text;
  v_obs_nova text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  SELECT * INTO v_agendamento FROM public.agendamentos WHERE id = p_agendamento;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado.';
  END IF;

  IF NOT public.tem_papel(v_agendamento.tenant_id, ARRAY['dono', 'gerente']::public.app_role[]) THEN
    RAISE EXCEPTION 'Apenas donos ou gerentes podem reagendar.';
  END IF;

  IF v_agendamento.status = 'cancelado' THEN
    RAISE EXCEPTION 'Não é possível reagendar um agendamento cancelado.';
  END IF;

  IF v_agendamento.status IN ('concluido', 'em_andamento') THEN
    RAISE EXCEPTION 'Este atendimento já está em execução ou concluído e não pode ser reagendado.';
  END IF;

  v_fuso := public.obter_fuso_tenant(v_agendamento.tenant_id);
  v_data := (p_novo_inicio AT TIME ZONE v_fuso)::date;
  v_hora := date_trunc('minute', (p_novo_inicio AT TIME ZONE v_fuso))::time;

  PERFORM pg_advisory_xact_lock(hashtext(v_agendamento.tenant_id::text || ':' || v_data::text));

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'servico_id', servico_id,
        'combo_id', combo_id,
        'duracao_minutos', duracao_minutos
      )
    ),
    '[]'::jsonb
  )
  INTO v_itens_json
  FROM public.agendamento_itens
  WHERE agendamento_id = p_agendamento;

  IF (v_itens_json IS NULL OR jsonb_array_length(v_itens_json) = 0) AND v_agendamento.servico_id IS NOT NULL THEN
    v_itens_json := jsonb_build_array(jsonb_build_object('servico_id', v_agendamento.servico_id));
  END IF;

  SELECT hd.disponivel, hd.termino_previsto
  INTO v_is_valido, v_termino_previsto
  FROM public.horarios_disponiveis(
    v_agendamento.tenant_id,
    v_data,
    v_itens_json,
    v_agendamento.categoria_id,
    p_agendamento
  ) hd
  WHERE hd.horario = v_hora;

  IF NOT coalesce(v_is_valido, false) THEN
    RAISE EXCEPTION 'Este horário não está disponível na agenda. Escolha outro horário.';
  END IF;

  IF v_termino_previsto IS NULL THEN
    v_termino_previsto := public.calcular_fim_efetivo(
      v_agendamento.tenant_id,
      p_novo_inicio,
      coalesce(v_agendamento.duracao_total, v_agendamento.duracao_minutos, 60),
      coalesce(v_agendamento.modo_ocupacao_efetivo, v_agendamento.modo_ocupacao, 'transborda')
    );
  END IF;

  IF v_agendamento.status = 'nao_compareceu' THEN
    v_novo_status := CASE
      WHEN v_agendamento.sinal_status = 'pendente' THEN 'aguardando_confirmacao'
      ELSE 'agendado'
    END;
    v_obs_nova := coalesce(nullif(trim(v_agendamento.observacoes), '') || E'\n', '') ||
      '[Reagendado em ' || to_char(now() AT TIME ZONE v_fuso, 'DD/MM/YYYY HH24:MI') || ' após não comparecimento]';
  ELSE
    v_novo_status := v_agendamento.status;
    v_obs_nova := v_agendamento.observacoes;
  END IF;

  UPDATE public.agendamentos
  SET inicio = p_novo_inicio,
      previsao_entrega = v_termino_previsto,
      status = v_novo_status,
      observacoes = v_obs_nova,
      updated_at = now()
  WHERE id = p_agendamento;

  PERFORM public.recalcular_agendamento_totais(p_agendamento);
END;
$$;

REVOKE ALL ON FUNCTION public.reagendar(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reagendar(uuid, timestamptz) TO authenticated;


-- ------------------------------------------------------------------------------
-- 3. CONVERTER_ORCAMENTO_EM_AGENDAMENTO: evita colisão de numero_os e define previsao_entrega
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.converter_orcamento_em_agendamento(
  p_orcamento uuid,
  p_inicio timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_orcamento record;
  v_nivel_rec record;
  v_tenant record;
  v_agendamento_id uuid;
  v_ag_existente_status text;
  v_servico_principal uuid;
  v_modo_ocupacao text := 'slot';
  v_dias_ocupados integer := 1;
  v_valor_final numeric(10,2) := 0.00;
  v_os_num integer;
  v_termo_resp_texto text := '';
  v_termo_gar_texto text := '';
  v_incluir_termo_resp boolean := false;
  v_incluir_termo_gar boolean := false;
  v_duracao_calc integer := 60;
  v_previsao_entrega timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  SELECT o.* INTO v_orcamento
  FROM public.orcamentos o
  WHERE o.id = p_orcamento;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.';
  END IF;

  IF NOT public.tem_papel(v_orcamento.tenant_id, ARRAY['dono', 'gerente']::public.app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  IF v_orcamento.status NOT IN ('aprovado', 'finalizado') THEN
    RAISE EXCEPTION 'Apenas orçamentos aprovados podem ser convertidos em agendamento.';
  END IF;

  IF v_orcamento.agendamento_id IS NOT NULL THEN
    SELECT a.status INTO v_ag_existente_status
    FROM public.agendamentos a
    WHERE a.id = v_orcamento.agendamento_id;

    IF FOUND AND v_ag_existente_status <> 'cancelado' THEN
      RETURN v_orcamento.agendamento_id;
    END IF;

    UPDATE public.orcamentos
    SET agendamento_id = NULL,
        updated_at = now()
    WHERE id = p_orcamento;
  END IF;

  IF v_orcamento.cliente_id IS NULL THEN
    RAISE EXCEPTION 'Vincule ou cadastre os dados do cliente antes de converter este orçamento em OS/agendamento.';
  END IF;

  IF v_orcamento.nivel_aprovado IS NULL THEN
    RAISE EXCEPTION 'Nenhum nível aprovado foi registrado para este orçamento.';
  END IF;

  SELECT n.* INTO v_nivel_rec
  FROM public.orcamento_niveis n
  WHERE n.orcamento_id = p_orcamento AND n.nivel = v_orcamento.nivel_aprovado;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nível aprovado não encontrado.';
  END IF;

  SELECT i.servico_id INTO v_servico_principal
  FROM public.orcamento_nivel_itens i
  WHERE i.nivel_id = v_nivel_rec.id
  ORDER BY (CASE WHEN i.servico_id IS NOT NULL THEN 0 ELSE 1 END), i.ordem ASC
  LIMIT 1;

  IF v_servico_principal IS NOT NULL THEN
    SELECT coalesce(s.modo_ocupacao, 'slot'), coalesce(s.dias_ocupados, 1)
    INTO v_modo_ocupacao, v_dias_ocupados
    FROM public.servicos s WHERE s.id = v_servico_principal;
  END IF;

  v_valor_final := coalesce(v_nivel_rec.valor_total, 0);
  IF v_orcamento.desconto_valor > 0 AND v_orcamento.desconto_tipo IS NOT NULL THEN
    IF v_orcamento.desconto_tipo = 'porcentagem' THEN
      v_valor_final := round(v_valor_final * (1.0 - (v_orcamento.desconto_valor / 100.0)), 2);
    ELSIF v_orcamento.desconto_tipo = 'valor_fixo' THEN
      v_valor_final := greatest(0.00, v_valor_final - v_orcamento.desconto_valor);
    END IF;
  END IF;

  v_os_num := v_orcamento.numero_os;
  IF v_os_num IS NULL OR EXISTS (
    SELECT 1
    FROM public.agendamentos a
    WHERE a.tenant_id = v_orcamento.tenant_id
      AND a.numero_os = v_os_num
  ) THEN
    v_os_num := public.proximo_numero_os(v_orcamento.tenant_id);
  END IF;

  SELECT t.* INTO v_tenant FROM public.tenants t WHERE t.id = v_orcamento.tenant_id;

  v_incluir_termo_resp := coalesce(v_orcamento.incluir_termo_responsabilidade, v_orcamento.incluir_termos, false);
  v_incluir_termo_gar := coalesce(v_orcamento.incluir_termo_garantia, v_orcamento.incluir_termos, false);

  IF v_incluir_termo_resp THEN
    v_termo_resp_texto := v_orcamento.termo_responsabilidade_texto;
    IF (v_termo_resp_texto IS NULL OR trim(v_termo_resp_texto) = '') AND v_orcamento.termo_responsabilidade_id IS NOT NULL THEN
      SELECT tg.conteudo INTO v_termo_resp_texto
      FROM public.termos_garantia tg
      WHERE tg.id = v_orcamento.termo_responsabilidade_id;
    END IF;
    IF v_termo_resp_texto IS NULL OR trim(v_termo_resp_texto) = '' THEN
      v_termo_resp_texto := coalesce(v_tenant.termo_responsabilidade, '');
    END IF;
  END IF;

  IF v_incluir_termo_gar AND v_orcamento.termo_garantia_id IS NOT NULL THEN
    SELECT tg.conteudo INTO v_termo_gar_texto
    FROM public.termos_garantia tg
    WHERE tg.id = v_orcamento.termo_garantia_id;
  END IF;

  v_duracao_calc := greatest(5, coalesce(v_nivel_rec.duracao_total, 60));
  v_previsao_entrega := public.calcular_fim_efetivo(
    v_orcamento.tenant_id,
    p_inicio,
    v_duracao_calc,
    coalesce(v_modo_ocupacao, 'transborda')
  );

  INSERT INTO public.agendamentos (
    tenant_id,
    cliente_id,
    veiculo_id,
    servico_id,
    categoria_id,
    inicio,
    previsao_entrega,
    duracao_minutos,
    duracao_total,
    modo_ocupacao,
    modo_ocupacao_efetivo,
    dias_ocupados,
    preco_estimado,
    preco_estimado_total,
    status,
    origem,
    observacoes,
    criado_por,
    numero_os,
    termo_garantia_id,
    termo_responsabilidade_texto,
    termo_garantia_texto
  ) VALUES (
    v_orcamento.tenant_id,
    v_orcamento.cliente_id,
    v_orcamento.veiculo_id,
    v_servico_principal,
    v_orcamento.categoria_id,
    p_inicio,
    v_previsao_entrega,
    v_duracao_calc,
    v_duracao_calc,
    coalesce(v_modo_ocupacao, 'slot'),
    coalesce(v_modo_ocupacao, 'slot'),
    coalesce(v_dias_ocupados, 1),
    v_valor_final,
    v_valor_final,
    'agendado',
    'orcamento',
    coalesce(v_orcamento.observacoes, '') || ' (Convertido do Orçamento ORC' || lpad(v_orcamento.numero::text, 4, '0') || ' - OS ' || lpad(v_os_num::text, 4, '0') || ' - ' || v_nivel_rec.titulo || ')',
    auth.uid(),
    v_os_num,
    CASE WHEN v_incluir_termo_gar THEN v_orcamento.termo_garantia_id ELSE NULL END,
    nullif(v_termo_resp_texto, ''),
    nullif(v_termo_gar_texto, '')
  ) RETURNING id INTO v_agendamento_id;

  INSERT INTO public.agendamento_itens (
    tenant_id,
    agendamento_id,
    servico_id,
    combo_id,
    servico_nome,
    duracao_minutos,
    preco_estimado,
    modo_ocupacao,
    dias_ocupados,
    ordem
  )
  SELECT
    v_orcamento.tenant_id,
    v_agendamento_id,
    i.servico_id,
    i.combo_id,
    coalesce(s.nome, i.servico_nome),
    coalesce(i.duracao_minutos, 60),
    coalesce(i.preco, 0),
    coalesce(s.modo_ocupacao, 'slot'),
    coalesce(s.dias_ocupados, 1),
    coalesce(i.ordem, 0)
  FROM public.orcamento_nivel_itens i
  LEFT JOIN public.servicos s ON s.id = i.servico_id
  WHERE i.nivel_id = v_nivel_rec.id;

  PERFORM public.recalcular_agendamento_totais(v_agendamento_id);

  UPDATE public.orcamentos
  SET agendamento_id = v_agendamento_id,
      numero_os = v_os_num,
      updated_at = now()
  WHERE id = p_orcamento;

  RETURN v_agendamento_id;
END;
$$;

REVOKE ALL ON FUNCTION public.converter_orcamento_em_agendamento(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.converter_orcamento_em_agendamento(uuid, timestamptz) TO authenticated;


-- ------------------------------------------------------------------------------
-- 4. REAGENDAR_OS_ORCAMENTO: reagenda diretamente pelo Orçamento (preserva OS)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reagendar_os_orcamento(
  p_orcamento uuid,
  p_novo_inicio timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_orcamento record;
  v_agendamento record;
  v_fuso text;
  v_data date;
  v_previsao_entrega timestamptz;
  v_novo_status text;
  v_obs_nova text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  IF p_novo_inicio IS NULL THEN
    RAISE EXCEPTION 'Informe a nova data e horário para reagendamento.';
  END IF;

  SELECT o.* INTO v_orcamento
  FROM public.orcamentos o
  WHERE o.id = p_orcamento;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.';
  END IF;

  IF NOT public.tem_papel(v_orcamento.tenant_id, ARRAY['dono', 'gerente']::public.app_role[]) THEN
    RAISE EXCEPTION 'Apenas donos ou gerentes podem reagendar OS.';
  END IF;

  IF v_orcamento.status NOT IN ('aprovado', 'finalizado') THEN
    RAISE EXCEPTION 'Apenas orçamentos aprovados podem ser agendados ou reagendados.';
  END IF;

  IF v_orcamento.agendamento_id IS NULL THEN
    RETURN public.converter_orcamento_em_agendamento(p_orcamento, p_novo_inicio);
  END IF;

  SELECT a.* INTO v_agendamento
  FROM public.agendamentos a
  WHERE a.id = v_orcamento.agendamento_id;

  IF NOT FOUND OR v_agendamento.status = 'cancelado' THEN
    RETURN public.converter_orcamento_em_agendamento(p_orcamento, p_novo_inicio);
  END IF;

  IF v_agendamento.status IN ('concluido', 'em_andamento') THEN
    RAISE EXCEPTION 'Não é possível reagendar uma OS que já está em execução ou concluída.';
  END IF;

  v_fuso := public.obter_fuso_tenant(v_agendamento.tenant_id);
  v_data := (p_novo_inicio AT TIME ZONE v_fuso)::date;

  PERFORM pg_advisory_xact_lock(hashtext(v_agendamento.tenant_id::text || ':' || v_data::text));

  v_previsao_entrega := public.calcular_fim_efetivo(
    v_agendamento.tenant_id,
    p_novo_inicio,
    coalesce(v_agendamento.duracao_total, v_agendamento.duracao_minutos, 60),
    coalesce(v_agendamento.modo_ocupacao_efetivo, v_agendamento.modo_ocupacao, 'transborda')
  );

  IF v_agendamento.status = 'nao_compareceu' THEN
    v_novo_status := CASE
      WHEN v_agendamento.sinal_status = 'pendente' THEN 'aguardando_confirmacao'
      ELSE 'agendado'
    END;
    v_obs_nova := coalesce(nullif(trim(v_agendamento.observacoes), '') || E'\n', '') ||
      '[Reagendado em ' || to_char(now() AT TIME ZONE v_fuso, 'DD/MM/YYYY HH24:MI') || ' após não comparecimento]';
  ELSE
    v_novo_status := v_agendamento.status;
    v_obs_nova := v_agendamento.observacoes;
  END IF;

  UPDATE public.agendamentos
  SET inicio = p_novo_inicio,
      previsao_entrega = v_previsao_entrega,
      status = v_novo_status,
      observacoes = v_obs_nova,
      updated_at = now()
  WHERE id = v_agendamento.id;

  PERFORM public.recalcular_agendamento_totais(v_agendamento.id);

  RETURN v_agendamento.id;
END;
$$;

REVOKE ALL ON FUNCTION public.reagendar_os_orcamento(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reagendar_os_orcamento(uuid, timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';

