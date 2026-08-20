-- Migration 0012: Múltiplos Serviços por Atendimento e Combos

-- 1. TABELA COMBOS
create table if not exists public.combos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nome text not null,
  descricao_publica text,
  codigo text,
  publico boolean not null default false,
  ativo boolean not null default true,
  ordem integer not null default 0,
  foto_path text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (tenant_id, nome)
);

-- 2. TABELA COMBO_SERVICOS
create table if not exists public.combo_servicos (
  combo_id uuid not null references public.combos(id) on delete cascade,
  servico_id uuid not null references public.servicos(id) on delete cascade,
  ordem smallint not null default 0,
  primary key (combo_id, servico_id)
);

-- 3. TABELA COMBO_PRECOS
create table if not exists public.combo_precos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  combo_id uuid not null references public.combos(id) on delete cascade,
  categoria_id uuid not null references public.categorias_veiculo(id) on delete cascade,
  preco_base numeric(10,2),
  unique (combo_id, categoria_id)
);

-- 4. TABELA AGENDAMENTO_ITENS
create table if not exists public.agendamento_itens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agendamento_id uuid not null references public.agendamentos(id) on delete cascade,
  servico_id uuid not null references public.servicos(id),
  combo_id uuid references public.combos(id),
  duracao_minutos integer not null,
  preco_estimado numeric(10,2),
  modo_ocupacao text not null,
  dias_ocupados smallint not null default 1,
  ordem smallint not null default 0,
  created_at timestamptz default now(),
  unique (agendamento_id, servico_id)
);

-- 5. ALTERAÇÕES NA TABELA AGENDAMENTOS
alter table public.agendamentos alter column servico_id drop not null;
alter table public.agendamentos add column if not exists duracao_total integer not null default 60;
alter table public.agendamentos add column if not exists preco_estimado_total numeric(10,2);
alter table public.agendamentos add column if not exists modo_ocupacao_efetivo text not null default 'slot';

-- 6. FUNÇÃO E TRIGGER DE RECÁLCULO DE TOTAIS DO AGENDAMENTO
create or replace function public.recalcular_agendamento_totais(p_agendamento_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_categoria_id uuid;
  v_duracao_sum integer := 0;
  v_max_dias smallint := 1;
  v_modo_efetivo text := 'slot';
  v_preco_total numeric(10,2) := 0;
  v_rec record;
  v_combo_preco numeric(10,2);
  v_combos_processados uuid[] := array[]::uuid[];
begin
  select categoria_id into v_categoria_id
  from public.agendamentos where id = p_agendamento_id;

  if not found then
    return;
  end if;

  for v_rec in (
    select * from public.agendamento_itens
    where agendamento_id = p_agendamento_id
    order by ordem asc, created_at asc
  ) loop
    -- 1. Soma durações
    v_duracao_sum := v_duracao_sum + v_rec.duracao_minutos;

    -- 2. Maior dias_ocupados
    if v_rec.dias_ocupados > v_max_dias then
      v_max_dias := v_rec.dias_ocupados;
    end if;

    -- 3. Modo de ocupação efetivo: multiplos_dias > dia_inteiro > slot
    if v_rec.modo_ocupacao = 'multiplos_dias' then
      v_modo_efetivo := 'multiplos_dias';
    elsif v_rec.modo_ocupacao = 'dia_inteiro' and v_modo_efetivo <> 'multiplos_dias' then
      v_modo_efetivo := 'dia_inteiro';
    end if;

    -- 4. Preço com combo: itens pertencentes ao mesmo combo somam o preço fechado do combo para a categoria
    if v_rec.combo_id is not null then
      if not (v_rec.combo_id = any(v_combos_processados)) then
        v_combos_processados := array_append(v_combos_processados, v_rec.combo_id);
        select preco_base into v_combo_preco
        from public.combo_precos
        where combo_id = v_rec.combo_id and categoria_id = v_categoria_id;

        if v_combo_preco is not null then
          v_preco_total := v_preco_total + v_combo_preco;
        else
          v_preco_total := v_preco_total + coalesce(v_rec.preco_estimado, 0);
        end if;
      end if;
    else
      -- Item avulso
      v_preco_total := v_preco_total + coalesce(v_rec.preco_estimado, 0);
    end if;
  end loop;

  -- Atualiza o agendamento pai
  update public.agendamentos
  set duracao_total = v_duracao_sum,
      preco_estimado_total = v_preco_total,
      modo_ocupacao_efetivo = v_modo_efetivo,
      dias_ocupados = v_max_dias,
      updated_at = now()
  where id = p_agendamento_id;
end;
$$;

create or replace function public.fn_trg_agendamento_itens_recalcular()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'DELETE' then
    perform public.recalcular_agendamento_totais(OLD.agendamento_id);
    return OLD;
  else
    perform public.recalcular_agendamento_totais(NEW.agendamento_id);
    return NEW;
  end if;
end;
$$;

drop trigger if exists trg_agendamento_itens_recalcular on public.agendamento_itens;
create trigger trg_agendamento_itens_recalcular
after insert or update or delete on public.agendamento_itens
for each row execute function public.fn_trg_agendamento_itens_recalcular();

-- 7. BACKFILL DOS AGENDAMENTOS EXISTENTES
insert into public.agendamento_itens (
  tenant_id, agendamento_id, servico_id, combo_id,
  duracao_minutos, preco_estimado, modo_ocupacao, dias_ocupados, ordem
)
select 
  a.tenant_id, a.id, a.servico_id, null,
  coalesce(a.duracao_minutos, 60),
  a.preco_estimado,
  coalesce(a.modo_ocupacao, 'slot'),
  coalesce(a.dias_ocupados, 1),
  0
from public.agendamentos a
where a.servico_id is not null
  and not exists (select 1 from public.agendamento_itens i where i.agendamento_id = a.id);

-- Recalcula explicitamente todos os agendamentos após o backfill
do $$
declare r record;
begin
  for r in select id from public.agendamentos loop
    perform public.recalcular_agendamento_totais(r.id);
  end loop;
end $$;

-- 8. VALIDAÇÃO DE INTEGRIDADE DO BACKFILL (ABORTA SE HOUVER ÓRFÃO)
do $$
declare v_orfaos integer;
begin
  select count(*) into v_orfaos
  from public.agendamentos a
  where not exists (
    select 1 from public.agendamento_itens i where i.agendamento_id = a.id
  );
  if v_orfaos > 0 then
    raise exception 'Migração incompleta: % agendamentos sem itens', v_orfaos;
  end if;
end $$;

-- 9. FUNÇÕES E RPCS ATUALIZADAS

-- 9.1 criar_agendamento com p_itens jsonb
create or replace function public.criar_agendamento(
  p_cliente uuid,
  p_veiculo uuid,
  p_itens jsonb,
  p_categoria uuid,
  p_inicio timestamptz,
  p_observacoes text default null
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
begin
  select tenant_id into v_tenant from public.clientes where id = p_cliente;
  if not found then
    raise exception 'Cliente não encontrado.';
  end if;

  if not (v_tenant in (select meus_tenants())) or not public.tem_papel(v_tenant, array['dono', 'gerente']::app_role[]) then
    raise exception 'Apenas donos ou gerentes podem realizar agendamentos.';
  end if;

  if p_itens is null or jsonb_array_length(p_itens) = 0 then
    raise exception 'Selecione ao menos um serviço para agendar.';
  end if;

  v_data := (p_inicio at time zone 'America/Sao_Paulo')::date;
  v_hora := date_trunc('minute', (p_inicio at time zone 'America/Sao_Paulo'))::time;

  -- Advisory lock transacional
  perform pg_advisory_xact_lock(hashtext(v_tenant::text || ':' || v_data::text));

  -- Revalida disponibilidade usando a lista de itens
  select disponivel into v_is_valido
  from public.horarios_disponiveis(v_tenant, v_data, p_itens, p_categoria, null) hd
  where hd.horario = v_hora;

  if not coalesce(v_is_valido, false) then
    raise exception 'Este horário não está mais disponível. Escolha outro.';
  end if;

  v_servico_id := (p_itens->0->>'servico_id')::uuid;

  insert into public.agendamentos (
    tenant_id, cliente_id, veiculo_id, servico_id, categoria_id,
    inicio, status, origem, observacoes, criado_por
  ) values (
    v_tenant, p_cliente, p_veiculo, v_servico_id, p_categoria,
    p_inicio, 'agendado', 'interno', p_observacoes, auth.uid()
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

    insert into public.agendamento_itens (
      tenant_id, agendamento_id, servico_id, combo_id,
      duracao_minutos, preco_estimado, modo_ocupacao, dias_ocupados, ordem
    ) values (
      v_tenant, v_agendamento_id, v_servico_id, v_combo_id,
      v_duracao, v_preco, v_modo, v_dias, v_ordem
    );

    v_ordem := v_ordem + 1;
  end loop;

  perform public.recalcular_agendamento_totais(v_agendamento_id);

  return v_agendamento_id;
end;
$$;

-- 9.2 horarios_disponiveis (nova assinatura com p_itens jsonb)
create or replace function public.horarios_disponiveis(
  p_tenant uuid,
  p_data date,
  p_itens jsonb,
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
        s.modo_ocupacao,
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

  while v_slot_time < v_horario_func.fecha loop
    v_pos_index := v_pos_index + 1;
    v_posicao_inicio := (p_data || ' ' || v_slot_time)::timestamp at time zone 'America/Sao_Paulo';
    v_posicao_fim := v_posicao_inicio + (v_duracao_total_itens || ' minutes')::interval;

    v_is_disponivel := true;
    v_motivo_indisponivel := null;

    -- Regra 1: dia_inteiro
    if v_modo_efetivo = 'dia_inteiro' then
      if v_pos_index > 1 then
        v_is_disponivel := false;
        v_motivo_indisponivel := 'dia_inteiro';
      elsif v_total_agendamentos_dia > 0 then
        v_is_disponivel := false;
        v_motivo_indisponivel := 'dia_reservado';
      end if;
    end if;

    -- Regra 2: Ultrapassa fechamento
    if v_is_disponivel and v_posicao_fim > v_fechamento_ts then
      v_is_disponivel := false;
      v_motivo_indisponivel := 'nao_cabe_no_expediente';
    end if;

    -- Regra 3: Passado
    if v_is_disponivel and v_posicao_inicio < v_agora_sp then
      v_is_disponivel := false;
      v_motivo_indisponivel := 'passado';
    end if;

    -- Regra 4: Bloqueios
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

    -- Regra 5: Sobreposição com dia_inteiro ou multiplos_dias
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

    -- Regra 6: Capacidade de boxes
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
    return next;

    v_slot_time := (v_slot_time + (v_grade_minutos || ' minutes')::interval)::time;
  end loop;
end;
$$;

-- 9.3 WRAPPER com assinatura legada
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
begin
  return query select * from public.horarios_disponiveis(
    p_tenant,
    p_data,
    jsonb_build_array(jsonb_build_object('servico_id', p_servico, 'combo_id', null)),
    p_categoria,
    p_ignorar_agendamento
  );
end;
$$;

-- 9.4 adicionar_item_agendamento e remover_item_agendamento
create or replace function public.adicionar_item_agendamento(
  p_agendamento uuid,
  p_servico uuid,
  p_combo uuid default null
) returns void
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
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
begin
  select * into v_agendamento from public.agendamentos where id = p_agendamento;
  if not found then raise exception 'Agendamento não encontrado.'; end if;

  if not public.tem_papel(v_agendamento.tenant_id, array['dono', 'gerente']::app_role[]) then
    raise exception 'Apenas donos ou gerentes podem alterar serviços do agendamento.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('servico_id', servico_id, 'combo_id', combo_id)), '[]'::jsonb)
  into v_itens_atuais
  from public.agendamento_itens where agendamento_id = p_agendamento;

  v_novos_itens := v_itens_atuais || jsonb_build_array(jsonb_build_object('servico_id', p_servico, 'combo_id', p_combo));

  v_data := (v_agendamento.inicio at time zone 'America/Sao_Paulo')::date;
  v_hora := (v_agendamento.inicio at time zone 'America/Sao_Paulo')::time;

  perform pg_advisory_xact_lock(hashtext(v_agendamento.tenant_id::text || ':' || v_data::text));

  select disponivel into v_is_valido
  from public.horarios_disponiveis(v_agendamento.tenant_id, v_data, v_novos_itens, v_agendamento.categoria_id, p_agendamento) hd
  where hd.horario = v_hora;

  if not coalesce(v_is_valido, false) then
    select coalesce(sum(duracao_minutos), 0) into v_novos_minutos
    from (
      select duracao_minutos from public.agendamento_itens where agendamento_id = p_agendamento
      union all
      select coalesce(sp.duracao_minutos, 60)
      from public.servicos s
      left join public.servico_precos sp on sp.servico_id = s.id and sp.categoria_id = v_agendamento.categoria_id and sp.ativo
      where s.id = p_servico
    ) sub;

    v_termino_previsto := to_char((v_agendamento.inicio + (v_novos_minutos || ' minutes')::interval) at time zone 'America/Sao_Paulo', 'HH24:MI');

    raise exception 'O atendimento passaria a terminar às %, depois do fechamento. Reagende ou remova um serviço.', v_termino_previsto;
  end if;

  select 
    coalesce(sp.duracao_minutos, 60),
    s.modo_ocupacao,
    coalesce(s.dias_ocupados, 1),
    sp.preco_base
  into v_duracao_item, v_modo_item, v_dias_item, v_preco_item
  from public.servicos s
  left join public.servico_precos sp
    on sp.servico_id = s.id
   and sp.categoria_id = v_agendamento.categoria_id
   and sp.ativo
  where s.id = p_servico and s.tenant_id = v_agendamento.tenant_id;

  if not found then raise exception 'Serviço não encontrado.'; end if;

  insert into public.agendamento_itens (
    tenant_id, agendamento_id, servico_id, combo_id,
    duracao_minutos, preco_estimado, modo_ocupacao, dias_ocupados, ordem
  ) values (
    v_agendamento.tenant_id, p_agendamento, p_servico, p_combo,
    v_duracao_item, v_preco_item, v_modo_item, v_dias_item, 99
  );
end;
$$;

create or replace function public.remover_item_agendamento(
  p_agendamento uuid,
  p_servico uuid
) returns void
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_agendamento record;
  v_total_itens integer;
begin
  select * into v_agendamento from public.agendamentos where id = p_agendamento;
  if not found then raise exception 'Agendamento não encontrado.'; end if;

  if not public.tem_papel(v_agendamento.tenant_id, array['dono', 'gerente']::app_role[]) then
    raise exception 'Apenas donos ou gerentes podem alterar serviços do agendamento.';
  end if;

  select count(*) into v_total_itens
  from public.agendamento_itens where agendamento_id = p_agendamento;

  if v_total_itens <= 1 then
    raise exception 'O agendamento precisa ter ao menos um serviço. Cancele o agendamento se necessário.';
  end if;

  delete from public.agendamento_itens
  where agendamento_id = p_agendamento and servico_id = p_servico;
end;
$$;

-- 9.5 catalogo_publico com combos incluídos
create or replace function public.catalogo_publico(p_slug text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare 
  v_tenant tenants; 
  v_result jsonb;
begin
  select * into v_tenant from tenants where slug = lower(trim(p_slug));
  if not found then 
    return null; 
  end if;

  select jsonb_build_object(
    'oficina', jsonb_build_object(
      'nome', v_tenant.nome,
      'cidade', v_tenant.cidade,
      'uf', v_tenant.uf,
      'telefone', v_tenant.telefone,
      'capa_path', v_tenant.capa_path
    ),
    'categorias', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'nome', c.nome, 'descricao', c.descricao
      ) order by c.ordem), '[]'::jsonb)
      from categorias_veiculo c
      where c.tenant_id = v_tenant.id and c.ativo
    ),
    'combos', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', cb.id,
        'nome', cb.nome,
        'descricao_publica', cb.descricao_publica,
        'codigo', cb.codigo,
        'foto_path', cb.foto_path,
        'servicos', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', s.id,
            'nome', s.nome,
            'codigo', s.codigo
          ) order by cs.ordem), '[]'::jsonb)
          from combo_servicos cs
          join servicos s on s.id = cs.servico_id
          where cs.combo_id = cb.id
        ),
        'precos', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'categoria_id', cp.categoria_id,
            'preco_base', cp.preco_base
          )), '[]'::jsonb)
          from combo_precos cp
          where cp.combo_id = cb.id
        )
      ) order by cb.ordem), '[]'::jsonb)
      from combos cb
      where cb.tenant_id = v_tenant.id and cb.ativo and cb.publico
    ),
    'servicos', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'nome', s.nome, 'grupo', s.grupo,
        'codigo', s.codigo, 'tom', s.tom,
        'descricao_publica', s.descricao_publica,
        'sob_consulta', s.sob_consulta,
        'foto_path', s.foto_path,
        'precos', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'categoria_id', sp.categoria_id,
            'preco_base', sp.preco_base
          )), '[]'::jsonb)
          from servico_precos sp
          where sp.servico_id = s.id and sp.ativo
        )
      ) order by s.grupo, s.ordem), '[]'::jsonb)
      from servicos s
      where s.tenant_id = v_tenant.id and s.ativo and s.publico
    ),
    'grupo_fotos', (
      select coalesce(jsonb_object_agg(g.grupo_slug, g.foto_path), '{}'::jsonb)
      from tenant_grupo_fotos g where g.tenant_id = v_tenant.id
    )
  ) into v_result;

  return v_result;
end;
$$;

-- 10. REGRAS DE SEGURANÇA (RLS) E PERMISSÕES
alter table public.combos enable row level security;
alter table public.combo_servicos enable row level security;
alter table public.combo_precos enable row level security;
alter table public.agendamento_itens enable row level security;

-- RLS combos
drop policy if exists "Membros podem ver combos" on public.combos;
create policy "Membros podem ver combos" on public.combos for select using (tenant_id in (select meus_tenants()));

drop policy if exists "Dono e gerente gerenciam combos" on public.combos;
create policy "Dono e gerente gerenciam combos" on public.combos for all 
  using (public.tem_papel(tenant_id, array['dono','gerente']::app_role[]))
  with check (public.tem_papel(tenant_id, array['dono','gerente']::app_role[]));

-- RLS combo_servicos
drop policy if exists "Membros podem ver combo_servicos" on public.combo_servicos;
create policy "Membros podem ver combo_servicos" on public.combo_servicos for select using (
  exists (select 1 from public.combos c where c.id = combo_id and c.tenant_id in (select meus_tenants()))
);

drop policy if exists "Dono e gerente gerenciam combo_servicos" on public.combo_servicos;
create policy "Dono e gerente gerenciam combo_servicos" on public.combo_servicos for all 
  using (
    exists (select 1 from public.combos c where c.id = combo_id and public.tem_papel(c.tenant_id, array['dono','gerente']::app_role[]))
  )
  with check (
    exists (select 1 from public.combos c where c.id = combo_id and public.tem_papel(c.tenant_id, array['dono','gerente']::app_role[]))
  );

-- RLS combo_precos
drop policy if exists "Membros podem ver combo_precos" on public.combo_precos;
create policy "Membros podem ver combo_precos" on public.combo_precos for select using (tenant_id in (select meus_tenants()));

drop policy if exists "Dono e gerente gerenciam combo_precos" on public.combo_precos;
create policy "Dono e gerente gerenciam combo_precos" on public.combo_precos for all 
  using (public.tem_papel(tenant_id, array['dono','gerente']::app_role[]))
  with check (public.tem_papel(tenant_id, array['dono','gerente']::app_role[]));

-- RLS agendamento_itens
drop policy if exists "Membros podem ver agendamento_itens" on public.agendamento_itens;
create policy "Membros podem ver agendamento_itens" on public.agendamento_itens for select using (tenant_id in (select meus_tenants()));

drop policy if exists "Dono e gerente gerenciam agendamento_itens" on public.agendamento_itens;
create policy "Dono e gerente gerenciam agendamento_itens" on public.agendamento_itens for all 
  using (public.tem_papel(tenant_id, array['dono','gerente']::app_role[]))
  with check (public.tem_papel(tenant_id, array['dono','gerente']::app_role[]));

-- GRANTS
grant execute on function public.criar_agendamento(uuid, uuid, jsonb, uuid, timestamptz, text) to authenticated;
grant execute on function public.horarios_disponiveis(uuid, date, jsonb, uuid, uuid) to authenticated;
grant execute on function public.horarios_disponiveis(uuid, date, uuid, uuid, uuid) to authenticated;
grant execute on function public.adicionar_item_agendamento(uuid, uuid, uuid) to authenticated;
grant execute on function public.remover_item_agendamento(uuid, uuid) to authenticated;
grant execute on function public.recalcular_agendamento_totais(uuid) to authenticated;
