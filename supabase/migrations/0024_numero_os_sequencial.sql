-- Migration 0024: Numeração Sequencial de OS por Oficina (tenant_id)
-- 1. ADICIONA A COLUNA numero_os NA TABELA AGENDAMENTOS
alter table public.agendamentos
  add column if not exists numero_os integer;

-- 2. CRIA A TABELA DE CONTADORES POR OFICINA
create table if not exists public.tenant_contadores (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  proxima_os integer not null default 1,
  ultimo_marco_exibido integer not null default 0
);

alter table public.tenant_contadores enable row level security;

drop policy if exists "Membros ativos leem contadores de sua oficina" on public.tenant_contadores;
drop policy if exists "Dono e Gerente alteram contadores" on public.tenant_contadores;

create policy "Membros ativos leem contadores de sua oficina" on public.tenant_contadores
  for select using (tenant_id in (select public.meus_tenants()));

create policy "Dono e Gerente alteram contadores" on public.tenant_contadores
  for all using (public.tem_papel(tenant_id, array['dono', 'gerente']::app_role[]));

-- 3. GARANTE UNICIDADE DO numero_os DENTRO DE CADA TENANT
create unique index if not exists agendamentos_numero_os_unico
  on public.agendamentos (tenant_id, numero_os)
  where numero_os is not null;

-- 4. FUNÇÃO ATÔMICA PARA GERAR PRÓXIMO NÚMERO DE OS
create or replace function public.proximo_numero_os(p_tenant uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numero integer;
begin
  insert into public.tenant_contadores (tenant_id, proxima_os)
  values (p_tenant, 1)
  on conflict (tenant_id) do nothing;

  update public.tenant_contadores
  set proxima_os = proxima_os + 1
  where tenant_id = p_tenant
  returning proxima_os - 1 into v_numero;

  return v_numero;
end;
$$;

grant execute on function public.proximo_numero_os(uuid) to authenticated;

-- 5. ATUALIZA RPC criar_agendamento COM numero_os
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
  v_os_num integer;
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

  -- Gera o próximo número de OS de forma atômica
  v_os_num := public.proximo_numero_os(v_tenant);

  insert into public.agendamentos (
    tenant_id, cliente_id, veiculo_id, servico_id, categoria_id,
    inicio, status, origem, observacoes, criado_por, forcado, forcado_por, numero_os
  ) values (
    v_tenant, p_cliente, p_veiculo, v_servico_id, p_categoria,
    p_inicio, 'agendado', 'interno', p_observacoes, auth.uid(),
    p_forcado, case when p_forcado then v_member_id else null end,
    v_os_num
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

-- 6. ATUALIZA RPC entrada_avulsa COM numero_os
create or replace function public.entrada_avulsa(
  p_cliente uuid,
  p_veiculo uuid,
  p_itens jsonb,
  p_categoria uuid,
  p_observacoes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant uuid;
  v_user uuid;
  v_agendamento_id uuid;
  v_item jsonb;
  v_servico_id uuid;
  v_combo_id uuid;
  v_duracao integer;
  v_modo text;
  v_dias integer;
  v_preco numeric(10,2);
  v_ordem smallint := 0;
  v_primeiro_servico uuid;
  v_os_num integer;
begin
  select tenant_id into v_tenant from public.clientes where id = p_cliente;
  if not found then
    raise exception 'Cliente não encontrado.';
  end if;

  select auth.uid() into v_user;

  if not (v_tenant in (select meus_tenants())) or not public.tem_papel(v_tenant, array['dono', 'gerente', 'operador']::app_role[]) then
    raise exception 'Acesso negado. Usuário não é membro desta oficina.';
  end if;

  if p_itens is null or jsonb_array_length(p_itens) = 0 then
    raise exception 'Selecione ao menos um serviço para a entrada avulsa.';
  end if;

  v_servico_id := (p_itens->0->>'servico_id')::uuid;

  v_os_num := public.proximo_numero_os(v_tenant);

  insert into public.agendamentos (
    tenant_id,
    cliente_id,
    veiculo_id,
    servico_id,
    categoria_id,
    inicio,
    status,
    origem,
    observacoes,
    criado_por,
    duracao_total,
    duracao_minutos,
    preco_estimado_total,
    preco_estimado,
    modo_ocupacao,
    dias_ocupados,
    numero_os
  ) values (
    v_tenant,
    p_cliente,
    p_veiculo,
    v_servico_id,
    p_categoria,
    now(),
    'confirmado',
    'balcao',
    p_observacoes,
    v_user,
    0,
    0,
    0.00,
    0.00,
    'slot',
    1,
    v_os_num
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

    if v_primeiro_servico is null then
      v_primeiro_servico := v_servico_id;
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

  update public.agendamentos
  set servico_id = v_primeiro_servico
  where id = v_agendamento_id;

  perform public.recalcular_agendamento_totais(v_agendamento_id);

  return v_agendamento_id;
end;
$$;

-- 7. BACKFILL DETERMINÍSTICO DOS AGENDAMENTOS EXISTENTES
with numerados as (
  select id, tenant_id,
         row_number() over (
           partition by tenant_id
           order by created_at asc, id asc
         ) as n
  from public.agendamentos
  where numero_os is null
)
update public.agendamentos a
set numero_os = numerados.n
from numerados
where a.id = numerados.id;

-- Sincronizar tenant_contadores com a maior OS existente por oficina
insert into public.tenant_contadores (tenant_id, proxima_os)
select tenant_id, max(numero_os) + 1
from public.agendamentos
where numero_os is not null
group by tenant_id
on conflict (tenant_id) do update
set proxima_os = greatest(public.tenant_contadores.proxima_os, excluded.proxima_os);

-- 8. RPC AUXILIAR PARA CONSULTA DE MARCOS E CONTAGEM NA CONFIGURAÇÃO
create or replace function public.obter_contador_os(p_tenant uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer := 0;
  v_ultimo_marco integer := 0;
  v_marcos integer[] := array[50, 100, 250, 500, 1000];
  v_m integer;
  v_novo_marco integer := 0;
  v_nome_oficina text;
begin
  select coalesce(max(numero_os), 0) into v_total
  from public.agendamentos
  where tenant_id = p_tenant;

  select ultimo_marco_exibido into v_ultimo_marco
  from public.tenant_contadores
  where tenant_id = p_tenant;

  select nome into v_nome_oficina from public.tenants where id = p_tenant;

  if v_ultimo_marco is null then
    v_ultimo_marco := 0;
  end if;

  foreach v_m in array v_marcos loop
    if v_total >= v_m and v_ultimo_marco < v_m then
      v_novo_marco := v_m;
    end if;
  end loop;

  if v_novo_marco > 0 then
    update public.tenant_contadores
    set ultimo_marco_exibido = v_novo_marco
    where tenant_id = p_tenant;
  end if;

  return jsonb_build_object(
    'total_atendimentos', v_total,
    'ultimo_marco_exibido', v_ultimo_marco,
    'novo_marco_atingido', case when v_novo_marco > 0 then v_novo_marco else null end,
    'nome_oficina', coalesce(v_nome_oficina, 'Oficina')
  );
end;
$$;

grant execute on function public.obter_contador_os(uuid) to authenticated;
