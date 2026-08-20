-- Migration 0011: Check-in de Entrada, Vistoria, Avarias, Assinatura, Entrada Avulsa e Logo da Oficina

-- 1. ATUALIZAÇÃO DAS TABELAS TENANTS E AGENDAMENTOS
alter table public.tenants add column if not exists logo_path text;
alter table public.tenants add column if not exists documento text;
alter table public.tenants add column if not exists documento_tipo text check (documento_tipo in ('cpf', 'cnpj'));
alter table public.tenants add column if not exists razao_social text;
alter table public.agendamentos drop constraint if exists agendamentos_origem_check;
alter table public.agendamentos add constraint agendamentos_origem_check check (origem in ('interno', 'online', 'balcao'));

-- 2. TABELA CHECKINS
create table if not exists public.checkins (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agendamento_id uuid not null references agendamentos(id) on delete cascade,
  veiculo_id uuid references veiculos(id),
  km integer check (km >= 0),
  nivel_combustivel smallint check (nivel_combustivel between 0 and 8),
  luzes_painel text[] not null default '{}',
  estepe boolean,
  iluminacao jsonb not null default '{}',
  sujidade jsonb not null default '{}',
  fluidos jsonb not null default '{}',
  observacoes text,
  assinatura_path text,
  assinado_em timestamptz,
  assinatura_nome text,
  finalizado boolean not null default false,
  criado_por uuid not null references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (agendamento_id)
);

alter table public.checkins enable row level security;

-- 3. TABELA CHECKIN_AVARIAS
create table if not exists public.checkin_avarias (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  checkin_id uuid not null references checkins(id) on delete cascade,
  vista text not null check (vista in ('frente', 'traseira', 'lateral_esquerda', 'lateral_direita', 'superior')),
  pos_x numeric(5,2) not null check (pos_x between 0 and 100),
  pos_y numeric(5,2) not null check (pos_y between 0 and 100),
  tipo text not null check (tipo in ('risco', 'amassado', 'avariado', 'faltante')),
  descricao text,
  created_at timestamptz default now()
);

alter table public.checkin_avarias enable row level security;

-- 4. TABELA CHECKIN_FOTOS
create table if not exists public.checkin_fotos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  checkin_id uuid not null references checkins(id) on delete cascade,
  avaria_id uuid references checkin_avarias(id) on delete set null,
  path text not null,
  descricao text,
  enviado_por uuid not null references auth.users(id),
  created_at timestamptz default now()
);

alter table public.checkin_fotos enable row level security;

-- 5. TRIGGER DE IMUTABILIDADE PARA CHECKINS
create or replace function public.fn_trg_checkin_imutavel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if OLD.finalizado then
    raise exception 'Check-in já assinado pelo cliente. Não pode ser alterado.';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_checkin_imutavel on public.checkins;
create trigger trg_checkin_imutavel
before update on public.checkins
for each row
execute function public.fn_trg_checkin_imutavel();

-- 6. TRIGGER DE IMUTABILIDADE PARA CHECKIN_AVARIAS E CHECKIN_FOTOS
create or replace function public.fn_trg_checkin_filhos_imutavel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_finalizado boolean;
  v_checkin_id uuid;
begin
  if TG_OP = 'DELETE' then
    v_checkin_id := OLD.checkin_id;
  else
    v_checkin_id := NEW.checkin_id;
  end if;

  select finalizado into v_finalizado
  from public.checkins
  where id = v_checkin_id;

  if coalesce(v_finalizado, false) then
    raise exception 'Check-in já assinado pelo cliente. Não pode ser alterado.';
  end if;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_checkin_avarias_imutavel on public.checkin_avarias;
create trigger trg_checkin_avarias_imutavel
before insert or update or delete on public.checkin_avarias
for each row
execute function public.fn_trg_checkin_filhos_imutavel();

drop trigger if exists trg_checkin_fotos_imutavel on public.checkin_fotos;
create trigger trg_checkin_fotos_imutavel
before insert or update or delete on public.checkin_fotos
for each row
execute function public.fn_trg_checkin_filhos_imutavel();

-- 7. RPCS: INICIAR, FINALIZAR E VERIFICAR CHECKIN
create or replace function public.iniciar_checkin(
  p_agendamento uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant uuid;
  v_veiculo uuid;
  v_user uuid;
  v_checkin uuid;
begin
  v_user := auth.uid();
  if v_user is null then
    raise exception 'Usuário não autenticado.';
  end if;

  select ag.tenant_id, ag.veiculo_id into v_tenant, v_veiculo
  from public.agendamentos ag
  where ag.id = p_agendamento;

  if v_tenant is null then
    raise exception 'Agendamento não encontrado.';
  end if;

  if not public.tem_papel(v_tenant, array['dono', 'gerente', 'operador']::app_role[]) then
    raise exception 'Acesso negado. Usuário não é membro ativo desta oficina.';
  end if;

  insert into public.checkins (
    tenant_id,
    agendamento_id,
    veiculo_id,
    criado_por
  ) values (
    v_tenant,
    p_agendamento,
    v_veiculo,
    v_user
  )
  on conflict (agendamento_id) do nothing
  returning id into v_checkin;

  if v_checkin is null then
    select c.id into v_checkin
    from public.checkins c
    where c.agendamento_id = p_agendamento;
  end if;

  return v_checkin;
end;
$$;

create or replace function public.finalizar_checkin(
  p_checkin uuid,
  p_assinatura_path text,
  p_nome text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant uuid;
  v_user uuid;
begin
  v_user := auth.uid();
  if v_user is null then
    raise exception 'Usuário não autenticado.';
  end if;

  select c.tenant_id into v_tenant
  from public.checkins c
  where c.id = p_checkin;

  if v_tenant is null then
    raise exception 'Check-in não encontrado.';
  end if;

  if not public.tem_papel(v_tenant, array['dono', 'gerente', 'operador']::app_role[]) then
    raise exception 'Acesso negado. Usuário não é membro ativo desta oficina.';
  end if;

  update public.checkins
  set finalizado = true,
      assinatura_path = p_assinatura_path,
      assinatura_nome = trim(p_nome),
      assinado_em = now(),
      updated_at = now()
  where id = p_checkin;
end;
$$;

create or replace function public.tem_checkin_finalizado(
  p_agendamento uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_finalizado boolean;
begin
  select c.finalizado into v_finalizado
  from public.checkins c
  where c.agendamento_id = p_agendamento;

  return coalesce(v_finalizado, false);
end;
$$;

-- 8. RPC: ENTRADA AVULSA (COM STATUS = 'confirmado' E ORIGEM = 'balcao')
drop function if exists public.entrada_avulsa(uuid, uuid, uuid, uuid);
drop function if exists public.entrada_avulsa(uuid, uuid, jsonb, uuid, text);

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
begin
  v_user := auth.uid();
  if v_user is null then
    raise exception 'Usuário não autenticado.';
  end if;

  -- Obter tenant do cliente
  select cl.tenant_id into v_tenant
  from public.clientes cl
  where cl.id = p_cliente;

  if v_tenant is null then
    raise exception 'Cliente não encontrado.';
  end if;

  if not public.tem_papel(v_tenant, array['dono', 'gerente', 'operador']::app_role[]) then
    raise exception 'Acesso negado. Usuário não é membro ativo desta oficina.';
  end if;

  if p_itens is null or jsonb_array_length(p_itens) = 0 then
    raise exception 'Selecione ao menos um serviço para a entrada avulsa.';
  end if;

  v_servico_id := (p_itens->0->>'servico_id')::uuid;

  -- 1. Cria agendamento com status 'confirmado' e origem 'balcao'
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
    dias_ocupados
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
    1
  ) returning id into v_agendamento_id;

  -- 2. Insere os itens na tabela agendamento_itens se a tabela existir
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'agendamento_itens') then
    for v_item in select * from jsonb_array_elements(p_itens) loop
      v_servico_id := (v_item->>'servico_id')::uuid;
      v_combo_id := nullif(v_item->>'combo_id', '')::uuid;

      select 
        coalesce(sp.duracao_minutos, 60),
        sp.preco_base,
        s.modo_ocupacao,
        coalesce(s.dias_ocupados, 1)
      into v_duracao, v_preco, v_modo, v_dias
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

    update public.agendamentos set servico_id = v_primeiro_servico where id = v_agendamento_id;

    if exists (select 1 from pg_proc where proname = 'recalcular_agendamento_totais') then
      perform public.recalcular_agendamento_totais(v_agendamento_id);
    end if;
  else
    v_servico_id := (p_itens->0->>'servico_id')::uuid;
    select coalesce(sp.duracao_minutos, 60), sp.preco_base, s.modo_ocupacao, coalesce(s.dias_ocupados, 1)
    into v_duracao, v_preco, v_modo, v_dias
    from public.servicos s
    left join public.servico_precos sp on sp.servico_id = s.id and sp.categoria_id = p_categoria and sp.ativo
    where s.id = v_servico_id and s.tenant_id = v_tenant;

    update public.agendamentos
    set servico_id = v_servico_id,
        duracao_minutos = coalesce(v_duracao, 60),
        modo_ocupacao = coalesce(v_modo, 'slot'),
        preco_estimado = coalesce(v_preco, 0.00)
    where id = v_agendamento_id;
  end if;

  return v_agendamento_id;
end;
$$;

-- 9. REGRAS DE SEGURANÇA (RLS POLICIES)
-- Checkins
drop policy if exists "Membros podem ver checkins do tenant" on public.checkins;
create policy "Membros podem ver checkins do tenant"
  on public.checkins for select
  to authenticated
  using (public.tem_papel(tenant_id, array['dono', 'gerente', 'operador']::app_role[]));

drop policy if exists "Membros podem criar checkins" on public.checkins;
create policy "Membros podem criar checkins"
  on public.checkins for insert
  to authenticated
  with check (public.tem_papel(tenant_id, array['dono', 'gerente', 'operador']::app_role[]));

drop policy if exists "Membros podem atualizar checkins" on public.checkins;
create policy "Membros podem atualizar checkins"
  on public.checkins for update
  to authenticated
  using (public.tem_papel(tenant_id, array['dono', 'gerente', 'operador']::app_role[]));

-- Checkin Avarias
drop policy if exists "Membros podem ver avarias do tenant" on public.checkin_avarias;
create policy "Membros podem ver avarias do tenant"
  on public.checkin_avarias for select
  to authenticated
  using (public.tem_papel(tenant_id, array['dono', 'gerente', 'operador']::app_role[]));

drop policy if exists "Membros podem inserir avarias" on public.checkin_avarias;
create policy "Membros podem inserir avarias"
  on public.checkin_avarias for insert
  to authenticated
  with check (public.tem_papel(tenant_id, array['dono', 'gerente', 'operador']::app_role[]));

drop policy if exists "Membros podem atualizar avarias" on public.checkin_avarias;
create policy "Membros podem atualizar avarias"
  on public.checkin_avarias for update
  to authenticated
  using (public.tem_papel(tenant_id, array['dono', 'gerente', 'operador']::app_role[]));

drop policy if exists "Membros podem deletar avarias" on public.checkin_avarias;
create policy "Membros podem deletar avarias"
  on public.checkin_avarias for delete
  to authenticated
  using (public.tem_papel(tenant_id, array['dono', 'gerente', 'operador']::app_role[]));

-- Checkin Fotos
drop policy if exists "Membros podem ver fotos do tenant" on public.checkin_fotos;
create policy "Membros podem ver fotos do tenant"
  on public.checkin_fotos for select
  to authenticated
  using (public.tem_papel(tenant_id, array['dono', 'gerente', 'operador']::app_role[]));

drop policy if exists "Membros podem inserir fotos" on public.checkin_fotos;
create policy "Membros podem inserir fotos"
  on public.checkin_fotos for insert
  to authenticated
  with check (public.tem_papel(tenant_id, array['dono', 'gerente', 'operador']::app_role[]));

drop policy if exists "Membros podem atualizar fotos" on public.checkin_fotos;
create policy "Membros podem atualizar fotos"
  on public.checkin_fotos for update
  to authenticated
  using (public.tem_papel(tenant_id, array['dono', 'gerente', 'operador']::app_role[]));

drop policy if exists "Membros podem deletar fotos" on public.checkin_fotos;
create policy "Membros podem deletar fotos"
  on public.checkin_fotos for delete
  to authenticated
  using (public.tem_papel(tenant_id, array['dono', 'gerente', 'operador']::app_role[]));

-- Storage Bucket Policies para evidencias (Isolamento multitenant rigoroso)
drop policy if exists "Membros autenticados podem ver evidencias do tenant" on storage.objects;
create policy "Membros autenticados podem ver evidencias do tenant"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'evidencias'
    and array_length(storage.foldername(name), 1) >= 2
    and (storage.foldername(name))[1]::uuid in (select meus_tenants())
  );

drop policy if exists "Membros autenticados podem enviar evidencias do tenant" on storage.objects;
create policy "Membros autenticados podem enviar evidencias do tenant"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'evidencias'
    and array_length(storage.foldername(name), 1) >= 2
    and (storage.foldername(name))[1]::uuid in (select meus_tenants())
  );

drop policy if exists "Membros autenticados podem atualizar evidencias do tenant" on storage.objects;
create policy "Membros autenticados podem atualizar evidencias do tenant"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'evidencias'
    and array_length(storage.foldername(name), 1) >= 2
    and (storage.foldername(name))[1]::uuid in (select meus_tenants())
  );

drop policy if exists "Membros autenticados podem deletar evidencias do tenant" on storage.objects;
create policy "Membros autenticados podem deletar evidencias do tenant"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'evidencias'
    and array_length(storage.foldername(name), 1) >= 2
    and (storage.foldername(name))[1]::uuid in (select meus_tenants())
  );

grant execute on function public.iniciar_checkin(uuid) to authenticated;
grant execute on function public.finalizar_checkin(uuid, text, text) to authenticated;
grant execute on function public.tem_checkin_finalizado(uuid) to authenticated;
grant execute on function public.entrada_avulsa(uuid, uuid, jsonb, uuid, text) to authenticated;
