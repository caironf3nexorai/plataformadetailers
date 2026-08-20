-- Migration 0048: Função de Diagnóstico de Horários e Correção de Conflito de Transbordo

create or replace function public.diagnosticar_conflito_horarios(
  p_tenant uuid,
  p_data date,
  p_itens jsonb,
  p_categoria uuid default null
) returns table (
  slot_horario time,
  disponivel boolean,
  motivo_indisponivel text,
  posicao_inicio timestamptz,
  posicao_fim timestamptz,
  agendamentos_conflitantes jsonb
)
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_dia_semana smallint;
  v_horario_func record;
  v_grade_minutos smallint;
  v_duracao_total_itens integer := 0;
  v_modo_efetivo text := 'slot';
  v_max_dias integer := 1;
  v_item jsonb;
  v_servico_id uuid;
  v_dur_item integer;
  v_modo_item text;
  v_dias_item integer;
  v_posicao_inicio timestamptz;
  v_posicao_fim timestamptz;
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

  v_minutos_restantes integer;
  v_calc_date date;
  v_calc_dow smallint;
  v_calc_horario record;
  v_calc_start timestamptz;
  v_janela_minutos integer;
  v_conflitos jsonb;
begin
  v_dia_semana := extract(dow from p_data)::smallint;

  select * into v_horario_func
  from public.horarios_funcionamento h
  where h.tenant_id = p_tenant and h.dia_semana = v_dia_semana and h.ativo;

  if not found then
    return;
  end if;

  select coalesce(t.grade_minutos, 60) into v_grade_minutos
  from public.tenants t where t.id = p_tenant;

  if p_itens is not null and jsonb_array_length(p_itens) > 0 then
    for v_item in select * from jsonb_array_elements(p_itens) loop
      v_servico_id := (v_item->>'servico_id')::uuid;

      select 
        coalesce(sp.duracao_minutos, 60),
        coalesce(s.modo_ocupacao, 'slot'),
        coalesce(s.dias_ocupados, 1)
      into v_dur_item, v_modo_item, v_dias_item
      from public.servicos s
      left join public.servico_precos sp
        on sp.servico_id = s.id
       and sp.categoria_id = p_categoria
       and sp.ativo
      where s.id = v_servico_id and s.tenant_id = p_tenant;

      if found then
        v_duracao_total_itens := v_duracao_total_itens + v_dur_item;
        if v_dias_item > v_max_dias then v_max_dias := v_dias_item; end if;
        
        if v_modo_item = 'multiplos_dias' then
          v_modo_efetivo := 'multiplos_dias';
        elsif v_modo_item = 'dia_inteiro' and v_modo_efetivo <> 'multiplos_dias' then
          v_modo_efetivo := 'dia_inteiro';
        elsif v_modo_item = 'transborda' and v_modo_efetivo not in ('multiplos_dias', 'dia_inteiro') then
          v_modo_efetivo := 'transborda';
        end if;
      end if;
    end loop;
  end if;

  if v_duracao_total_itens = 0 then
    v_duracao_total_itens := 60;
  end if;

  v_agora_sp := now() at time zone 'America/Sao_Paulo';

  select count(*) into v_total_agendamentos_dia
  from public.agendamentos a
  where a.tenant_id = p_tenant
    and a.status not in ('cancelado', 'nao_compareceu')
    and (a.inicio at time zone 'America/Sao_Paulo')::date <= p_data
    and ((a.inicio at time zone 'America/Sao_Paulo')::date + (coalesce(a.dias_ocupados, 1) - 1)) >= p_data;

  v_slot_time := v_horario_func.abre;
  v_fechamento_ts := (p_data || ' ' || v_horario_func.fecha)::timestamp at time zone 'America/Sao_Paulo';
  v_pos_index := 0;

  while v_slot_time <= (v_horario_func.fecha - (v_grade_minutos || ' minutes')::interval) loop
    v_pos_index := v_pos_index + 1;
    v_posicao_inicio := (p_data || ' ' || v_slot_time)::timestamp at time zone 'America/Sao_Paulo';

    v_is_disponivel := true;
    v_motivo_indisponivel := null;

    if v_modo_efetivo = 'transborda' then
      v_minutos_restantes := v_duracao_total_itens;
      v_calc_date := p_data;
      v_calc_start := v_posicao_inicio;

      while v_minutos_restantes > 0 loop
        v_calc_dow := extract(dow from v_calc_date)::smallint;

        select h.abre, h.fecha, h.ativo
        into v_calc_horario
        from public.horarios_funcionamento h
        where h.tenant_id = p_tenant and h.dia_semana = v_calc_dow;

        if found and v_calc_horario.ativo then
          v_fechamento_ts := (v_calc_date || ' ' || v_calc_horario.fecha)::timestamp at time zone 'America/Sao_Paulo';

          if v_calc_start < v_fechamento_ts then
            v_janela_minutos := extract(epoch from (v_fechamento_ts - v_calc_start))::integer / 60;
            if v_janela_minutos >= v_minutos_restantes then
              v_posicao_fim := v_calc_start + (v_minutos_restantes || ' minutes')::interval;
              v_minutos_restantes := 0;
            else
              v_minutos_restantes := v_minutos_restantes - v_janela_minutos;
              v_calc_date := v_calc_date + interval '1 day';
              v_calc_dow := extract(dow from v_calc_date)::smallint;
              loop
                select h.abre, h.fecha, h.ativo into v_calc_horario
                from public.horarios_funcionamento h
                where h.tenant_id = p_tenant and h.dia_semana = v_calc_dow;

                if found and v_calc_horario.ativo then
                  v_calc_start := (v_calc_date || ' ' || v_calc_horario.abre)::timestamp at time zone 'America/Sao_Paulo';
                  exit;
                else
                  v_calc_date := v_calc_date + interval '1 day';
                  v_calc_dow := extract(dow from v_calc_date)::smallint;
                end if;
              end loop;
            end if;
          else
            v_calc_date := v_calc_date + interval '1 day';
            v_calc_dow := extract(dow from v_calc_date)::smallint;
            loop
              select h.abre, h.fecha, h.ativo into v_calc_horario
              from public.horarios_funcionamento h
              where h.tenant_id = p_tenant and h.dia_semana = v_calc_dow;

              if found and v_calc_horario.ativo then
                v_calc_start := (v_calc_date || ' ' || v_calc_horario.abre)::timestamp at time zone 'America/Sao_Paulo';
                exit;
              else
                v_calc_date := v_calc_date + interval '1 day';
                v_calc_dow := extract(dow from v_calc_date)::smallint;
              end if;
            end loop;
          end if;
        else
          v_calc_date := v_calc_date + interval '1 day';
          v_calc_dow := extract(dow from v_calc_date)::smallint;
          loop
            select h.abre, h.fecha, h.ativo into v_calc_horario
            from public.horarios_funcionamento h
            where h.tenant_id = p_tenant and h.dia_semana = v_calc_dow;

            if found and v_calc_horario.ativo then
              v_calc_start := (v_calc_date || ' ' || v_calc_horario.abre)::timestamp at time zone 'America/Sao_Paulo';
              exit;
            else
              v_calc_date := v_calc_date + interval '1 day';
              v_calc_dow := extract(dow from v_calc_date)::smallint;
            end if;
          end loop;
        end if;
      end loop;
    else
      v_posicao_fim := v_posicao_inicio + (v_duracao_total_itens || ' minutes')::interval;
    end if;

    select jsonb_agg(to_jsonb(a.*))
    into v_conflitos
    from public.agendamentos a
    where a.tenant_id = p_tenant
      and a.status not in ('cancelado', 'nao_compareceu')
      and a.inicio < v_posicao_fim
      and (a.inicio + (coalesce(a.duracao_total, a.duracao_minutos, 60) || ' minutes')::interval) > v_posicao_inicio;

    v_qtd_agendamentos_ativos := coalesce(jsonb_array_length(v_conflitos), 0);

    if v_qtd_agendamentos_ativos >= v_horario_func.capacidade then
      v_is_disponivel := false;
      v_motivo_indisponivel := 'sem_box_livre';
    end if;

    slot_horario := v_slot_time;
    disponivel := v_is_disponivel;
    motivo_indisponivel := v_motivo_indisponivel;
    posicao_inicio := v_posicao_inicio;
    posicao_fim := v_posicao_fim;
    agendamentos_conflitantes := v_conflitos;
    return next;

    v_slot_time := (v_slot_time + (v_grade_minutos || ' minutes')::interval)::time;
  end loop;
end;
$$;
