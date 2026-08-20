-- Migration 0038: Suporte Completo ao Modo Transborda, Override Forçado para Gestão e Notificação de Pernoite

-- 1. ADICIONA VALOR 'transborda' NA CONSTRAINT MODO_OCUPACAO DA TABELA SERVICOS
alter table public.servicos
  drop constraint if exists servicos_modo_ocupacao_check;

alter table public.servicos
  add constraint servicos_modo_ocupacao_check
  check (modo_ocupacao in ('slot', 'dia_inteiro', 'multiplos_dias', 'transborda'));

-- 2. GARANTE COLUNAS DE OVERRIDE FORÇADO NA TABELA AGENDAMENTOS
alter table public.agendamentos
  add column if not exists forcado boolean not null default false,
  add column if not exists forcado_por uuid references public.tenant_members(id) on delete set null;

-- 3. ATUALIZA OS SERVIÇOS DO CATÁLOGO PADRÃO PARA O MODO 'transborda'
update public.servicos
set modo_ocupacao = 'transborda'
where codigo in ('POL_TEC', 'CORR_PINT', 'VITRIF')
   or nome ilike '%polimento técnico%'
   or nome ilike '%correção de pintura%'
   or nome ilike '%vitrificação%';

-- 4. DROP OBRIGATÓRIO DAS DUAS ASSINATURAS DA RPC HORARIOS_DISPONIVEIS (POIS A TABELA DE RETORNO ADICIONA A COLUNA TERMINO_PREVISTO)
drop function if exists public.horarios_disponiveis(uuid, date, jsonb, uuid, uuid);
drop function if exists public.horarios_disponiveis(uuid, date, uuid, uuid, uuid);

-- 5. REESCREVE A RPC HORARIOS_DISPONIVEIS COM SUPORTE A TRANSBORDA E COLUNA TERMINO_PREVISTO
create or replace function public.horarios_disponiveis(
  p_tenant uuid,
  p_data date,
  p_itens jsonb default null,
  p_categoria uuid default null,
  p_ignorar_agendamento uuid default null
) returns table (
  horario time,
  disponivel boolean,
  motivo text,
  termino_previsto timestamptz
)
language plpgsql stable security definer set search_path = public
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
        
        -- Hierarquia do modo efetivo: multiplos_dias > dia_inteiro > transborda > slot
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
    and (p_ignorar_agendamento is null or a.id <> p_ignorar_agendamento)
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
      v_fechamento_ts := (p_data || ' ' || v_horario_func.fecha)::timestamp at time zone 'America/Sao_Paulo';
    else
      v_posicao_fim := v_posicao_inicio + (v_duracao_total_itens || ' minutes')::interval;
    end if;

    if v_modo_efetivo = 'dia_inteiro' then
      if v_pos_index > 1 then
        v_is_disponivel := false;
        v_motivo_indisponivel := 'dia_inteiro';
      elsif v_total_agendamentos_dia > 0 then
        v_is_disponivel := false;
        v_motivo_indisponivel := 'dia_reservado';
      end if;
    end if;

    if v_modo_efetivo = 'multiplos_dias' then
      if v_pos_index > 1 then
        v_is_disponivel := false;
        v_motivo_indisponivel := 'multiplos_dias';
      end if;
    end if;

    if v_modo_efetivo = 'slot' and v_is_disponivel and v_posicao_fim > v_fechamento_ts then
      v_is_disponivel := false;
      v_motivo_indisponivel := 'nao_cabe_no_expediente';
    end if;

    if v_is_disponivel and v_posicao_inicio < v_agora_sp then
      v_is_disponivel := false;
      v_motivo_indisponivel := 'passado';
    end if;

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

    if v_is_disponivel then
      select exists(
        select 1 from public.agendamentos a
        where a.tenant_id = p_tenant
          and a.status not in ('cancelado', 'nao_compareceu')
          and (p_ignorar_agendamento is null or a.id <> p_ignorar_agendamento)
          and coalesce(a.modo_ocupacao_efetivo, a.modo_ocupacao) in ('dia_inteiro', 'multiplos_dias')
          and (a.inicio at time zone 'America/Sao_Paulo')::date <= p_data
          and ((a.inicio at time zone 'America/Sao_Paulo')::date + (coalesce(a.dias_ocupados, 1) - 1)) >= p_data
      ) into v_sobrepoem_dia_reservado;

      if v_sobrepoem_dia_reservado then
        v_is_disponivel := false;
        v_motivo_indisponivel := 'dia_reservado';
      end if;
    end if;

    if v_is_disponivel then
      select count(*) into v_qtd_agendamentos_ativos
      from public.agendamentos a
      where a.tenant_id = p_tenant
        and a.status not in ('cancelado', 'nao_compareceu')
        and (p_ignorar_agendamento is null or a.id <> p_ignorar_agendamento)
        and a.inicio < v_posicao_fim
        and (a.inicio + (coalesce(a.duracao_total, a.duracao_minutos, 60) || ' minutes')::interval) > v_posicao_inicio;

      if v_qtd_agendamentos_ativos >= v_horario_func.capacidade then
        v_is_disponivel := false;
        v_motivo_indisponivel := 'sem_box_livre';
      end if;
    end if;

    horario := v_slot_time;
    disponivel := v_is_disponivel;
    motivo := v_motivo_indisponivel;
    termino_previsto := v_posicao_fim;
    return next;

    v_slot_time := (v_slot_time + (v_grade_minutos || ' minutes')::interval)::time;
  end loop;
end;
$$;

grant execute on function public.horarios_disponiveis(uuid, date, jsonb, uuid, uuid) to anon, authenticated;

-- 6. REESCREVE WRAPPER LEGADO DE HORARIOS_DISPONIVEIS
create or replace function public.horarios_disponiveis(
  p_tenant uuid,
  p_data date,
  p_servico uuid,
  p_categoria uuid,
  p_ignorar_agendamento uuid default null
) returns table (
  horario time,
  disponivel boolean,
  motivo text,
  termino_previsto timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
begin
  return query
  select hd.horario, hd.disponivel, hd.motivo, hd.termino_previsto
  from public.horarios_disponiveis(
    p_tenant,
    p_data,
    case when p_servico is not null then jsonb_build_array(jsonb_build_object('servico_id', p_servico)) else null end,
    p_categoria,
    p_ignorar_agendamento
  ) hd;
end;
$$;

grant execute on function public.horarios_disponiveis(uuid, date, uuid, uuid, uuid) to anon, authenticated;

-- 7. RECARREGA CACHE DO POSTGREST
notify pgrst, 'reload schema';
