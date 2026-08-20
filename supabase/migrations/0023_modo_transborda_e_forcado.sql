-- Migration 0023: Modo de Ocupação Transborda, Override Forçado de Agendamento e Atualização de Catálogo

-- 1. Permite o valor 'transborda' na coluna modo_ocupacao da tabela servicos
alter table public.servicos
  drop constraint if exists servicos_modo_ocupacao_check;

alter table public.servicos
  add constraint servicos_modo_ocupacao_check
  check (modo_ocupacao in ('slot', 'dia_inteiro', 'multiplos_dias', 'transborda'));

-- 2. Adiciona colunas para agendamento forçado pela gestão
alter table public.agendamentos
  add column if not exists forcado boolean not null default false,
  add column if not exists forcado_por uuid references public.tenant_members(id) on delete set null;

-- 3. Atualiza os serviços do catálogo para o modo 'transborda'
update public.servicos
set modo_ocupacao = 'transborda'
where codigo in ('POL_TEC', 'CORR_PINT', 'VITRIF')
  or nome ilike '%polimento técnico%'
  or nome ilike '%correção de pintura%'
  or nome ilike '%vitrificação%';

-- 4. Atualiza RPC horarios_disponiveis com suporte a 'transborda'
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

  select s.duracao_minutos, s.modo_ocupacao, coalesce(s.dias_ocupados, 1) as dias_ocupados
  into v_servico
  from public.servicos s where s.id = p_servico;

  if not found then
    return;
  end if;

  v_agora_sp := now() at time zone 'America/Sao_Paulo';

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

    v_is_disponivel := true;
    v_motivo_indisponivel := null;

    if v_servico.modo_ocupacao = 'transborda' then
      v_minutos_restantes := coalesce(v_servico.duracao_minutos, 60);
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
              select h.abre into v_calc_horario from public.horarios_funcionamento h where h.tenant_id = p_tenant and h.dia_semana = v_calc_dow and h.ativo;
              if found then
                v_calc_start := (v_calc_date || ' ' || v_calc_horario.abre)::timestamp at time zone 'America/Sao_Paulo';
              end if;
            end if;
          else
            v_calc_date := v_calc_date + interval '1 day';
            v_calc_start := (v_calc_date || ' ' || v_horario_func.abre)::timestamp at time zone 'America/Sao_Paulo';
          end if;
        else
          v_calc_date := v_calc_date + interval '1 day';
          v_calc_start := (v_calc_date || ' ' || v_horario_func.abre)::timestamp at time zone 'America/Sao_Paulo';
        end if;
      end loop;
    else
      v_posicao_fim := v_posicao_inicio + (v_servico.duracao_minutos || ' minutes')::interval;
    end if;

    if v_servico.modo_ocupacao = 'dia_inteiro' then
      if v_pos_index > 1 then
        v_is_disponivel := false;
        v_motivo_indisponivel := 'dia_inteiro';
      elsif v_total_agendamentos_dia > 0 then
        v_is_disponivel := false;
        v_motivo_indisponivel := 'dia_reservado';
      end if;
    end if;

    if v_servico.modo_ocupacao <> 'transborda' and v_is_disponivel and v_posicao_fim > v_fechamento_ts then
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
    termino_previsto := v_posicao_fim;
    return next;

    v_slot_time := (v_slot_time + (v_grade_minutos || ' minutes')::interval)::time;
  end loop;
end;
$$;

-- 5. Atualiza criar_agendamento para permitir p_forcado boolean default false
create or replace function public.criar_agendamento(
  p_cliente uuid,
  p_veiculo uuid,
  p_itens jsonb,
  p_categoria uuid,
  p_inicio timestamptz,
  p_observacoes text default null,
  p_forcado boolean default false
) returns uuid
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant uuid;
  v_data date;
  v_hora time;
  v_is_valido boolean := false;
  v_agendamento_id uuid;
  v_item jsonb;
  v_servico_id uuid;
  v_combo_id uuid;
  v_duracao integer;
  v_modo text;
  v_dias integer;
  v_preco numeric(10,2);
  v_ordem smallint := 0;
  v_member_id uuid;
begin
  select tenant_id into v_tenant from public.clientes where id = p_cliente;
  if not found then
    raise exception 'Cliente não encontrado.';
  end if;

  if not (v_tenant in (select meus_tenants())) or not public.tem_papel(v_tenant, array['dono', 'gerente']::app_role[]) then
    raise exception 'Apenas donos ou gerentes podem realizar agendamentos.';
  end if;

  select id into v_member_id
  from public.tenant_members
  where tenant_id = v_tenant and user_id = auth.uid() and status = 'ativo';

  if p_itens is null or jsonb_array_length(p_itens) = 0 then
    raise exception 'Selecione ao menos um serviço para agendar.';
  end if;

  v_data := (p_inicio at time zone 'America/Sao_Paulo')::date;
  v_hora := date_trunc('minute', (p_inicio at time zone 'America/Sao_Paulo'))::time;

  perform pg_advisory_xact_lock(hashtext(v_tenant::text || ':' || v_data::text));

  -- Validação de disponibilidade (ignorada se p_forcado = true)
  if not p_forcado then
    select disponivel into v_is_valido
    from public.horarios_disponiveis(v_tenant, v_data, (p_itens->0->>'servico_id')::uuid, p_categoria, null) hd
    where hd.horario = v_hora;

    if not coalesce(v_is_valido, false) then
      raise exception 'Este horário não está disponível. Utilize a opção de override forçado se for gestor.';
    end if;
  end if;

  v_servico_id := (p_itens->0->>'servico_id')::uuid;

  insert into public.agendamentos (
    tenant_id, cliente_id, veiculo_id, servico_id, categoria_id,
    inicio, status, origem, observacoes, criado_por, forcado, forcado_por
  ) values (
    v_tenant, p_cliente, p_veiculo, v_servico_id, p_categoria,
    p_inicio, 'agendado', 'interno', p_observacoes, auth.uid(),
    p_forcado, case when p_forcado then v_member_id else null end
  ) returning id into v_agendamento_id;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_servico_id := (v_item->>'servico_id')::uuid;
    v_combo_id := nullif(v_item->>'combo_id', '')::uuid;

    select 
      coalesce(sp.duracao_minutos, 60),
      s.modo_ocupacao,
      coalesce(s.dias_ocupados, 1),
      sp.preco_base
    into v_duracao, v_modo, v_dias, v_preco
    from public.servicos s
    left join public.servico_precos sp
      on sp.servico_id = s.id
     and sp.categoria_id = p_categoria
     and sp.ativo
    where s.id = v_servico_id and s.tenant_id = v_tenant;

    if not found then
      raise exception 'Serviço % não encontrado.', v_servico_id;
    end if;

    v_ordem := v_ordem + 1;

    insert into public.agendamento_itens (
      agendamento_id, servico_id, combo_id, duracao_minutos,
      preco_estimado, ordem
    ) values (
      v_agendamento_id, v_servico_id, v_combo_id, v_duracao,
      v_preco, v_ordem
    );
  end loop;

  perform public.recalcular_totais_agendamento(v_agendamento_id);
  return v_agendamento_id;
end;
$$;
