-- Migration 0008: Backfill Garantido de Horários de Funcionamento e Ajuste de Fuso no Dow

-- 1. Garante que todos os tenants possuam 7 linhas em horarios_funcionamento (dias 0 a 6)
insert into public.horarios_funcionamento (tenant_id, dia_semana, abre, fecha, capacidade, ativo)
select t.id, d.dia_semana, d.abre::time, d.fecha::time, 1, d.ativo
from public.tenants t
cross join (
  values
    (1, '08:00', '18:00', true),  -- Segunda
    (2, '08:00', '18:00', true),  -- Terça
    (3, '08:00', '18:00', true),  -- Quarta
    (4, '08:00', '18:00', true),  -- Quinta
    (5, '08:00', '18:00', true),  -- Sexta
    (6, '08:00', '12:00', true),  -- Sábado
    (0, '08:00', '18:00', false)  -- Domingo
) as d(dia_semana, abre, fecha, ativo)
on conflict (tenant_id, dia_semana) do nothing;

-- 2. Atualiza a RPC horarios_disponiveis com comentário explícito de fuso e derive do DOW a partir de date puro
create or replace function public.horarios_disponiveis(
  p_tenant uuid,
  p_data date,
  p_servico uuid,
  p_categoria uuid,
  p_ignorar_agendamento uuid default null
) returns table (
  horario time,
  disponivel boolean,
  motivo text
)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_dia_semana smallint;
  v_horario_func record;
  v_grade_minutos smallint;
  v_servico record;
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
begin
  -- FUSO HORÁRIO EXPLÍCITO: p_data já é o tipo date local (ex: '2026-08-03' = 1, segunda-feira).
  -- O extract(dow from p_data) deriva o dia da semana local sem conversão para UTC.
  v_dia_semana := extract(dow from p_data)::smallint;

  select * into v_horario_func
  from public.horarios_funcionamento h
  where h.tenant_id = p_tenant and h.dia_semana = v_dia_semana and h.ativo;

  -- Se a oficina não abre ou está inativa neste dia da semana, retorna 0 linhas
  if not found then
    return;
  end if;

  select coalesce(t.grade_minutos, 60) into v_grade_minutos
  from public.tenants t where t.id = p_tenant;

  select s.duracao_minutos, s.modo_ocupacao, coalesce(s.dias_ocupados, 1) as dias_ocupados
  into v_servico
  from public.servicos s where s.id = p_servico;

  if not found then
    return;
  end if;

  v_agora_sp := now() at time zone 'America/Sao_Paulo';

  -- Total de agendamentos no dia para verificar exclusividade de dia_inteiro
  select count(*) into v_total_agendamentos_dia
  from public.agendamentos a
  where a.tenant_id = p_tenant
    and a.status not in ('cancelado', 'nao_compareceu')
    and (p_ignorar_agendamento is null or a.id <> p_ignorar_agendamento)
    and (a.inicio at time zone 'America/Sao_Paulo')::date <= p_data
    and ((a.inicio at time zone 'America/Sao_Paulo')::date + (a.dias_ocupados - 1)) >= p_data;

  v_slot_time := v_horario_func.abre;
  v_fechamento_ts := (p_data || ' ' || v_horario_func.fecha)::timestamp at time zone 'America/Sao_Paulo';
  v_pos_index := 0;

  while v_slot_time <= (v_horario_func.fecha - (v_grade_minutos || ' minutes')::interval) loop
    v_pos_index := v_pos_index + 1;
    v_posicao_inicio := (p_data || ' ' || v_slot_time)::timestamp at time zone 'America/Sao_Paulo';
    v_posicao_fim := v_posicao_inicio + (v_servico.duracao_minutos || ' minutes')::interval;

    v_is_disponivel := true;
    v_motivo_indisponivel := null;

    -- Regra 1: Serviço dia_inteiro exige ser a 1ª posição e que o dia esteja totalmente livre
    if v_servico.modo_ocupacao = 'dia_inteiro' then
      if v_pos_index > 1 then
        v_is_disponivel := false;
        v_motivo_indisponivel := 'dia_inteiro';
      elsif v_total_agendamentos_dia > 0 then
        v_is_disponivel := false;
        v_motivo_indisponivel := 'dia_reservado';
      end if;
    end if;

    -- Regra 2: Duração ultrapassa horário de fechamento
    if v_is_disponivel and v_posicao_fim > v_fechamento_ts then
      v_is_disponivel := false;
      v_motivo_indisponivel := 'nao_cabe_no_expediente';
    end if;

    -- Regra 3: Posição passada no dia de hoje
    if v_is_disponivel and v_posicao_inicio < v_agora_sp then
      v_is_disponivel := false;
      v_motivo_indisponivel := 'passado';
    end if;

    -- Regra 4: Sobreposição com bloqueios de agenda
    if v_is_disponivel then
      select exists(
        select 1 from public.bloqueios_agenda b
        where b.tenant_id = p_tenant
          and b.inicio < v_posicao_fim
          and b.fim > v_posicao_inicio
      ) into v_sobrepoem_bloqueio;

      if v_sobrepoem_bloqueio then
        v_is_disponivel := false;
        v_motivo_indisponivel := 'bloqueado';
      end if;
    end if;

    -- Regra 5: Sobreposição com agendamentos dia_inteiro ou multiplos_dias
    if v_is_disponivel then
      select exists(
        select 1 from public.agendamentos a
        where a.tenant_id = p_tenant
          and a.status not in ('cancelado', 'nao_compareceu')
          and (p_ignorar_agendamento is null or a.id <> p_ignorar_agendamento)
          and a.modo_ocupacao in ('dia_inteiro', 'multiplos_dias')
          and (a.inicio at time zone 'America/Sao_Paulo')::date <= p_data
          and ((a.inicio at time zone 'America/Sao_Paulo')::date + (a.dias_ocupados - 1)) >= p_data
      ) into v_sobrepoem_dia_reservado;

      if v_sobrepoem_dia_reservado then
        v_is_disponivel := false;
        v_motivo_indisponivel := 'dia_reservado';
      end if;
    end if;

    -- Regra 6: Capacidade de boxes simultâneos no horário
    if v_is_disponivel then
      select count(*) into v_qtd_agendamentos_ativos
      from public.agendamentos a
      where a.tenant_id = p_tenant
        and a.status not in ('cancelado', 'nao_compareceu')
        and (p_ignorar_agendamento is null or a.id <> p_ignorar_agendamento)
        and a.inicio < v_posicao_fim
        and (a.inicio + (a.duracao_minutos || ' minutes')::interval) > v_posicao_inicio;

      if v_qtd_agendamentos_ativos >= v_horario_func.capacidade then
        v_is_disponivel := false;
        v_motivo_indisponivel := 'sem_box_livre';
      end if;
    end if;

    horario := v_slot_time;
    disponivel := v_is_disponivel;
    motivo := v_motivo_indisponivel;
    return next;

    v_slot_time := (v_slot_time + (v_grade_minutos || ' minutes')::interval)::time;
  end loop;
end;
$$;
