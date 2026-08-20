-- Migration 0006: Módulo de Agenda - Grade Fixa, Capacidade, Advisory Locks e Disponibilidade

-- 1. TABELA DE HORÁRIOS DE FUNCIONAMENTO
create table if not exists public.horarios_funcionamento (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  dia_semana smallint not null check (dia_semana between 0 and 6), -- 0=domingo, 1=segunda... 6=sábado
  abre time not null default '08:00',
  fecha time not null default '18:00',
  capacidade smallint not null default 1 check (capacidade > 0),
  ativo boolean not null default true,
  unique (tenant_id, dia_semana)
);

alter table public.horarios_funcionamento enable row level security;

-- 2. NOVA COLUNA NA TABELA TENANTS (GRADE EM MINUTOS)
alter table public.tenants 
add column if not exists grade_minutos smallint not null default 60 check (grade_minutos in (15, 30, 60));

-- 3. TABELA DE BLOQUEIOS DE AGENDA
create table if not exists public.bloqueios_agenda (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  inicio timestamptz not null,
  fim timestamptz not null check (fim > inicio),
  motivo text not null,
  criado_por uuid not null references auth.users(id),
  created_at timestamptz default now()
);

alter table public.bloqueios_agenda enable row level security;

-- 4. TABELA DE AGENDAMENTOS (COM SNAPSHOTS DE SERVIÇO)
create table if not exists public.agendamentos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  cliente_id uuid not null references clientes(id),
  veiculo_id uuid references veiculos(id),
  servico_id uuid not null references servicos(id),
  categoria_id uuid not null references categorias_veiculo(id),
  inicio timestamptz not null,
  duracao_minutos integer not null,
  modo_ocupacao text not null,
  dias_ocupados smallint not null default 1,
  preco_estimado numeric(10,2),
  status text not null default 'agendado' check (status in ('agendado', 'confirmado', 'em_andamento', 'concluido', 'cancelado', 'nao_compareceu')),
  origem text not null default 'interno' check (origem in ('interno', 'online')),
  observacoes text,
  criado_por uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on column public.agendamentos.duracao_minutos is 'duracao_minutos, modo_ocupacao e preco_estimado são cópias do serviço no momento do agendamento. Nunca leia esses valores do catálogo ao exibir um agendamento existente — o dono pode ter alterado o serviço depois.';

create index if not exists idx_agendamentos_tenant_inicio on public.agendamentos(tenant_id, inicio);
create index if not exists idx_agendamentos_tenant_status on public.agendamentos(tenant_id, status);

alter table public.agendamentos enable row level security;

-- 5. SEED E BACKFILL DE HORÁRIOS DE FUNCIONAMENTO
create or replace function public.seed_horarios_funcionamento_tenant(p_tenant_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.horarios_funcionamento (tenant_id, dia_semana, abre, fecha, capacidade, ativo)
  values
    (p_tenant_id, 1, '08:00', '18:00', 1, true), -- Segunda
    (p_tenant_id, 2, '08:00', '18:00', 1, true), -- Terça
    (p_tenant_id, 3, '08:00', '18:00', 1, true), -- Quarta
    (p_tenant_id, 4, '08:00', '18:00', 1, true), -- Quinta
    (p_tenant_id, 5, '08:00', '18:00', 1, true), -- Sexta
    (p_tenant_id, 6, '08:00', '12:00', 1, true), -- Sábado
    (p_tenant_id, 0, '08:00', '18:00', 1, false) -- Domingo
  on conflict (tenant_id, dia_semana) do nothing;
end;
$$;

-- Aplica o backfill para todos os tenants já existentes
do $$
declare r record;
begin
  for r in select id from public.tenants loop
    perform public.seed_horarios_funcionamento_tenant(r.id);
  end loop;
end;
$$;

-- 6. RPC DE CÁLCULO DE DISPONIBILIDADE DA GRADE
-- FUSO HORÁRIO EXPLÍCITO: America/Sao_Paulo em todas as comparações de data/hora
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
  -- Dia da semana extraído na data local (0=Dom, 1=Seg... 6=Sáb)
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

grant execute on function public.horarios_disponiveis(uuid, date, uuid, uuid, uuid) to authenticated;

-- 7. RPC DE CRIAÇÃO SEGUIRA DE AGENDAMENTO (LOCK ADVISORY TRANSACIONAL)
create or replace function public.criar_agendamento(
  p_cliente uuid,
  p_veiculo uuid,
  p_servico uuid,
  p_categoria uuid,
  p_inicio timestamptz,
  p_observacoes text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant uuid;
  v_servico record;
  v_preco numeric(10,2);
  v_data date;
  v_hora time;
  v_is_valido boolean := false;
  v_agendamento_id uuid;
begin
  select tenant_id into v_tenant from public.clientes where id = p_cliente;
  if not found then
    raise exception 'Cliente não encontrado.';
  end if;

  if not (v_tenant in (select meus_tenants())) or not public.tem_papel(v_tenant, array['dono', 'gerente']::app_role[]) then
    raise exception 'Apenas donos ou gerentes podem realizar agendamentos.';
  end if;

  v_data := (p_inicio at time zone 'America/Sao_Paulo')::date;
  v_hora := (p_inicio at time zone 'America/Sao_Paulo')::time;

  -- ADVISORY LOCK TRANSACIONAL CONTRA CONDIÇÃO DE CORRIDA
  perform pg_advisory_xact_lock(hashtext(v_tenant::text || ':' || v_data::text));

  -- Revalida disponibilidade na data/hora exata
  select disponivel into v_is_valido
  from public.horarios_disponiveis(v_tenant, v_data, p_servico, p_categoria, null) hd
  where hd.horario = v_hora;

  if not coalesce(v_is_valido, false) then
    raise exception 'Este horário não está mais disponível. Escolha outro.';
  end if;

  select duracao_minutos, modo_ocupacao, coalesce(dias_ocupados, 1) as dias_ocupados
  into v_servico
  from public.servicos where id = p_servico and tenant_id = v_tenant;

  if not found then
    raise exception 'Serviço não encontrado.';
  end if;

  select preco_base into v_preco
  from public.servico_precos
  where servico_id = p_servico and categoria_id = p_categoria and ativo;

  insert into public.agendamentos (
    tenant_id, cliente_id, veiculo_id, servico_id, categoria_id,
    inicio, duracao_minutos, modo_ocupacao, dias_ocupados, preco_estimado,
    status, origem, observacoes, criado_por
  ) values (
    v_tenant, p_cliente, p_veiculo, p_servico, p_categoria,
    p_inicio, v_servico.duracao_minutos, v_servico.modo_ocupacao, v_servico.dias_ocupados, v_preco,
    'agendado', 'interno', p_observacoes, auth.uid()
  ) returning id into v_agendamento_id;

  return v_agendamento_id;
end;
$$;

grant execute on function public.criar_agendamento(uuid, uuid, uuid, uuid, timestamptz, text) to authenticated;

-- 8. RPC DE REAGENDAMENTO
create or replace function public.reagendar(
  p_agendamento uuid,
  p_novo_inicio timestamptz
) returns void
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_agendamento record;
  v_data date;
  v_hora time;
  v_is_valido boolean := false;
begin
  select * into v_agendamento from public.agendamentos where id = p_agendamento;
  if not found then
    raise exception 'Agendamento não encontrado.';
  end if;

  if not public.tem_papel(v_agendamento.tenant_id, array['dono', 'gerente']::app_role[]) then
    raise exception 'Apenas donos ou gerentes podem reagendar.';
  end if;

  v_data := (p_novo_inicio at time zone 'America/Sao_Paulo')::date;
  v_hora := (p_novo_inicio at time zone 'America/Sao_Paulo')::time;

  -- ADVISORY LOCK TRANSACIONAL
  perform pg_advisory_xact_lock(hashtext(v_agendamento.tenant_id::text || ':' || v_data::text));

  select disponivel into v_is_valido
  from public.horarios_disponiveis(v_agendamento.tenant_id, v_data, v_agendamento.servico_id, v_agendamento.categoria_id, p_agendamento) hd
  where hd.horario = v_hora;

  if not coalesce(v_is_valido, false) then
    raise exception 'Este horário não está mais disponível. Escolha outro.';
  end if;

  update public.agendamentos
  set inicio = p_novo_inicio, updated_at = now()
  where id = p_agendamento;
end;
$$;

grant execute on function public.reagendar(uuid, timestamptz) to authenticated;

-- 9. RPCS DE CANCELAMENTO E NÃO COMPARECEU
create or replace function public.cancelar_agendamento(
  p_agendamento uuid,
  p_motivo text default null
) returns void
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.agendamentos where id = p_agendamento;
  if not found then raise exception 'Agendamento não encontrado.'; end if;

  if not public.tem_papel(v_tenant, array['dono', 'gerente']::app_role[]) then
    raise exception 'Apenas donos ou gerentes podem cancelar agendamentos.';
  end if;

  update public.agendamentos
  set status = 'cancelado',
      observacoes = case 
        when p_motivo is not null and trim(p_motivo) <> '' 
        then coalesce(observacoes || ' | ', '') || 'Motivo cancelamento: ' || trim(p_motivo)
        else observacoes 
      end,
      updated_at = now()
  where id = p_agendamento;
end;
$$;

create or replace function public.marcar_nao_compareceu(
  p_agendamento uuid
) returns void
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.agendamentos where id = p_agendamento;
  if not found then raise exception 'Agendamento não encontrado.'; end if;

  if not public.tem_papel(v_tenant, array['dono', 'gerente']::app_role[]) then
    raise exception 'Apenas donos ou gerentes podem alterar o status do agendamento.';
  end if;

  update public.agendamentos
  set status = 'nao_compareceu', updated_at = now()
  where id = p_agendamento;
end;
$$;

grant execute on function public.cancelar_agendamento(uuid, text) to authenticated;
grant execute on function public.marcar_nao_compareceu(uuid) to authenticated;

-- 10. POLÍTICAS RLS DAS TABELAS

-- horarios_funcionamento
create policy "Membros podem visualizar horarios de funcionamento"
  on public.horarios_funcionamento for select
  using (tenant_id in (select meus_tenants()));

create policy "Dono e gerente podem gerenciar horarios de funcionamento"
  on public.horarios_funcionamento for all
  using (public.tem_papel(tenant_id, array['dono','gerente']::app_role[]));

-- bloqueios_agenda
create policy "Membros podem visualizar bloqueios de agenda"
  on public.bloqueios_agenda for select
  using (tenant_id in (select meus_tenants()));

create policy "Dono e gerente podem gerenciar bloqueios de agenda"
  on public.bloqueios_agenda for all
  using (public.tem_papel(tenant_id, array['dono','gerente']::app_role[]));

-- agendamentos
create policy "Membros podem visualizar agendamentos"
  on public.agendamentos for select
  using (tenant_id in (select meus_tenants()));

create policy "Dono e gerente podem inserir agendamentos"
  on public.agendamentos for insert
  with check (public.tem_papel(tenant_id, array['dono','gerente']::app_role[]));

create policy "Dono e gerente podem atualizar agendamentos"
  on public.agendamentos for update
  using (public.tem_papel(tenant_id, array['dono','gerente']::app_role[]));
