-- ==============================================================================
-- Migration 0134: Liberar Horários Excedentes com Transbordo Automático
-- ==============================================================================
-- Elimina a restrição rígida que travava os horários das 08:30 em diante quando
-- o serviço era considerado dia_inteiro. Permite agendar serviços longos ou
-- excedentes em qualquer horário da grade, calculando automaticamente a entrega
-- para o dia útil seguinte (transbordo com pernoite).
-- ==============================================================================

-- 1. Atualizar serviços existentes e modelos para modo transborda
UPDATE public.servicos
SET modo_ocupacao = 'transborda'
WHERE modo_ocupacao = 'dia_inteiro';

UPDATE public.servicos_modelo
SET modo_ocupacao = 'transborda'
WHERE modo_ocupacao = 'dia_inteiro';

-- 2. Garantir cálculo de horas úteis com transbordo na função calcular_fim_efetivo
CREATE OR REPLACE FUNCTION public.calcular_fim_efetivo(
  p_tenant uuid,
  p_inicio timestamptz,
  p_duracao_minutos integer,
  p_modo_ocupacao text
) RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_fuso text := public.obter_fuso_tenant(p_tenant);
  v_modo text := coalesce(p_modo_ocupacao, 'transborda');
  v_minutos_restantes integer := coalesce(p_duracao_minutos, 60);
  v_inicio_sp timestamp;
  v_calc_date date;
  v_calc_time time;
  v_calc_start timestamptz;
  v_calc_dow smallint;
  v_calc_horario record;
  v_fechamento_ts timestamptz;
  v_janela_minutos integer;
  v_posicao_fim timestamptz;
BEGIN
  IF p_inicio IS NULL THEN
    RETURN NULL;
  END IF;

  -- Se for explicitamente slot e duração for menor ou igual a 0
  IF v_minutos_restantes <= 0 THEN
    RETURN p_inicio;
  END IF;

  v_inicio_sp := p_inicio AT TIME ZONE v_fuso;
  v_calc_date := v_inicio_sp::date;
  v_calc_time := v_inicio_sp::time;
  v_calc_start := (v_calc_date || ' ' || v_calc_time)::timestamp AT TIME ZONE v_fuso;

  WHILE v_minutos_restantes > 0 LOOP
    v_calc_dow := extract(dow FROM v_calc_date)::smallint;

    SELECT h.abre, h.fecha, h.ativo
    INTO v_calc_horario
    FROM public.horarios_funcionamento h
    WHERE h.tenant_id = p_tenant AND h.dia_semana = v_calc_dow;

    IF FOUND AND v_calc_horario.ativo THEN
      v_fechamento_ts := (v_calc_date || ' ' || v_calc_horario.fecha)::timestamp AT TIME ZONE v_fuso;

      IF v_calc_start < v_fechamento_ts THEN
        v_janela_minutos := extract(epoch FROM (v_fechamento_ts - v_calc_start))::integer / 60;
        IF v_janela_minutos >= v_minutos_restantes THEN
          v_posicao_fim := v_calc_start + (v_minutos_restantes || ' minutes')::interval;
          RETURN v_posicao_fim;
        ELSE
          v_minutos_restantes := v_minutos_restantes - v_janela_minutos;
        END IF;
      END IF;
    END IF;

    -- Avança para o próximo dia útil
    v_calc_date := v_calc_date + interval '1 day';
    v_calc_dow := extract(dow FROM v_calc_date)::smallint;
    LOOP
      SELECT h.abre, h.fecha, h.ativo INTO v_calc_horario
      FROM public.horarios_funcionamento h
      WHERE h.tenant_id = p_tenant AND h.dia_semana = v_calc_dow;

      IF FOUND AND v_calc_horario.ativo THEN
        v_calc_start := (v_calc_date || ' ' || v_calc_horario.abre)::timestamp AT TIME ZONE v_fuso;
        EXIT;
      ELSE
        v_calc_date := v_calc_date + interval '1 day';
        v_calc_dow := extract(dow FROM v_calc_date)::smallint;
      END IF;
    END LOOP;
  END LOOP;

  RETURN coalesce(v_posicao_fim, p_inicio + (coalesce(p_duracao_minutos, 60) || ' minutes')::interval);
END;
$$;

GRANT EXECUTE ON FUNCTION public.calcular_fim_efetivo(uuid, timestamptz, integer, text) TO anon, authenticated;

-- 3. Função Canônica: horarios_disponiveis sem a trava rígida de v_pos_index > 1
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
  v_sobrepoem_dia_reservado boolean;
  v_qtd_agendamentos_ativos integer;
  v_total_agendamentos_dia integer;
  v_pos_index integer;
  v_is_disponivel boolean;
  v_motivo_indisponivel text;
BEGIN
  v_dia_semana := extract(dow from p_data)::smallint;

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
      v_servico_id := (v_item->>'servico_id')::uuid;

      SELECT 
        coalesce(sp.duracao_minutos, 60),
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
        
        -- Sempre adota o modo de transbordo para permitir o cálculo futuro da entrega
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

    -- Janela de ocupação no dia 1: do início até o menor entre término e o fechamento da loja
    IF v_posicao_fim < v_fechamento_ts THEN
      v_janela_fim_dia1 := v_posicao_fim;
    ELSE
      v_janela_fim_dia1 := v_fechamento_ts;
    END IF;

    -- Se o horário já passou no dia de hoje
    IF v_is_disponivel AND v_posicao_inicio < v_agora_sp THEN
      v_is_disponivel := false;
      v_motivo_indisponivel := 'passado';
    END IF;

    -- Bloqueio administrativo de agenda
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

    -- Box ocupado (conflito de capacidade de atendimento no dia 1)
    IF v_is_disponivel THEN
      SELECT count(*) INTO v_qtd_agendamentos_ativos
      FROM public.agendamentos a
      WHERE a.tenant_id = p_tenant
        AND a.status NOT IN ('cancelado')
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

GRANT EXECUTE ON FUNCTION public.horarios_disponiveis(uuid, date, jsonb, uuid, uuid) TO anon, authenticated;
