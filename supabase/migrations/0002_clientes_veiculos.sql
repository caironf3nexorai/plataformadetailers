-- Migration 0002: Clientes, Veículos e Categorias de Veículo

-- 1. TABELAS

-- Categorias de Veículo (Porte do veículo para precificação)
create table if not exists public.categorias_veiculo (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nome text not null,
  descricao text,
  ordem integer not null default 0,
  ativo boolean not null default true,
  created_at timestamptz default now(),
  unique (tenant_id, nome)
);

-- Clientes
create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nome text not null,
  telefone text not null,
  email text,
  documento text,
  observacoes text,
  origem text not null default 'interno' check (origem in ('interno', 'online')),
  ativo boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_clientes_tenant_telefone on public.clientes(tenant_id, telefone);
create index if not exists idx_clientes_tenant_nome on public.clientes(tenant_id, lower(nome));

-- Veículos
create table if not exists public.veiculos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  cliente_id uuid references public.clientes(id) on delete set null,
  categoria_id uuid not null references public.categorias_veiculo(id),
  placa text not null,
  marca text,
  modelo text,
  cor text,
  ano integer,
  observacoes text,
  ativo boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (tenant_id, placa)
);

-- Histórico de Propriedade do Veículo
create table if not exists public.veiculo_donos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  veiculo_id uuid not null references public.veiculos(id) on delete cascade,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  inicio date not null default current_date,
  fim date,
  created_at timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dono_sem_sobreposicao') then
    alter table public.veiculo_donos add constraint dono_sem_sobreposicao
      exclude using gist (
        veiculo_id with =,
        daterange(inicio, coalesce(fim, 'infinity'::date), '[)') with &&
      );
  end if;
end $$;

comment on table public.veiculo_donos is 'cada serviço executado gravará o cliente_id vigente na data. O histórico do veículo é filtrado por período de propriedade, para que o dono novo não veja os serviços do anterior.';

-- 2. REESCRITA DA FUNÇÃO CRIAR_OFICINA COM SEED DE CATEGORIAS

drop function if exists public.criar_oficina(text, text, text, text);

create or replace function public.criar_oficina(
  p_nome text, p_cidade text, p_uf text, p_telefone text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant uuid;
  v_slug text;
  v_user_email text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  if coalesce(trim(p_nome), '') = '' then
    raise exception 'Informe o nome da oficina.';
  end if;

  if (select count(*) from public.tenant_members tm
       where tm.user_id = auth.uid() and tm.role = 'dono'
         and tm.status in ('ativo','convidado')) >= 3 then
    raise exception 'Limite de oficinas por usuário atingido.';
  end if;

  v_slug := lower(regexp_replace(p_nome, '[^a-zA-Z0-9]+', '-', 'g'))
            || '-' || substr(gen_random_uuid()::text, 1, 6);

  insert into public.tenants (nome, slug, cidade, uf, telefone, criado_por, plano)
    values (p_nome, v_slug, p_cidade, p_uf, p_telefone, auth.uid(), 'free')
    returning tenants.id into v_tenant;

  select u.email into v_user_email from auth.users u where u.id = auth.uid();

  insert into public.tenant_members (tenant_id, user_id, email, role, status)
    values (v_tenant, auth.uid(), v_user_email, 'dono', 'ativo');

  -- Seed de 7 categorias padrão de carroceria
  insert into public.categorias_veiculo (tenant_id, nome, descricao, ordem, ativo)
  values
    (v_tenant, 'Hatch', 'Onix, HB20, Gol, Argo, Polo', 0, true),
    (v_tenant, 'Sedan', 'Corolla, Civic, Virtus, Cronos, Onix Plus', 1, true),
    (v_tenant, 'SUV', 'Creta, Compass, T-Cross, Renegade, Tracker', 2, true),
    (v_tenant, 'Caminhonete', 'Hilux, S10, Ranger, Toro, Strada', 3, true),
    (v_tenant, 'Van / Utilitário', 'Kombi, Master, Sprinter, Ducato', 4, false),
    (v_tenant, 'Caminhão', 'Veículos pesados', 5, false),
    (v_tenant, 'Moto', 'Todas as cilindradas', 6, false);

  return v_tenant;
end;
$$;

grant execute on function public.criar_oficina(text, text, text, text) to authenticated;

-- Backfill para oficinas que já existem:

-- 1. Se a categoria antiga tiver veículo vinculado, renomeia
update public.categorias_veiculo
set nome = 'Hatch', descricao = 'Onix, HB20, Gol, Argo, Polo', ordem = 0
where nome = 'Pequeno' and exists (select 1 from public.veiculos v where v.categoria_id = categorias_veiculo.id);

update public.categorias_veiculo
set nome = 'Sedan', descricao = 'Corolla, Civic, Virtus, Cronos, Onix Plus', ordem = 1
where nome = 'Médio' and exists (select 1 from public.veiculos v where v.categoria_id = categorias_veiculo.id);

update public.categorias_veiculo
set nome = 'SUV', descricao = 'Creta, Compass, T-Cross, Renegade, Tracker', ordem = 2
where nome = 'Grande' and exists (select 1 from public.veiculos v where v.categoria_id = categorias_veiculo.id);

update public.categorias_veiculo
set descricao = 'Hilux, S10, Ranger, Toro, Strada', ordem = 3
where nome = 'Caminhonete' and exists (select 1 from public.veiculos v where v.categoria_id = categorias_veiculo.id);

-- 2. Apaga categorias semeadas antigas sem veículo vinculado
delete from public.categorias_veiculo
where nome in ('Pequeno', 'Médio', 'Grande')
  and not exists (select 1 from public.veiculos v where v.categoria_id = categorias_veiculo.id);

-- 3. Garante a existência de todas as 7 categorias para cada tenant
insert into public.categorias_veiculo (tenant_id, nome, descricao, ordem, ativo)
select t.id, c.nome, c.descricao, c.ordem, c.ativo
from public.tenants t
cross join (values
  ('Hatch', 'Onix, HB20, Gol, Argo, Polo', 0, true),
  ('Sedan', 'Corolla, Civic, Virtus, Cronos, Onix Plus', 1, true),
  ('SUV', 'Creta, Compass, T-Cross, Renegade, Tracker', 2, true),
  ('Caminhonete', 'Hilux, S10, Ranger, Toro, Strada', 3, true),
  ('Van / Utilitário', 'Kombi, Master, Sprinter, Ducato', 4, false),
  ('Caminhão', 'Veículos pesados', 5, false),
  ('Moto', 'Todas as cilindradas', 6, false)
) as c(nome, descricao, ordem, ativo)
where not exists (
  select 1 from public.categorias_veiculo cv where cv.tenant_id = t.id and cv.nome = c.nome
);

-- 3. FUNÇÕES DE NEGÓCIO (SECURITY DEFINER)

-- Transferência de Veículo
drop function if exists public.transferir_veiculo(uuid, uuid, date);

create or replace function public.transferir_veiculo(
  p_veiculo uuid, p_novo_cliente uuid, p_data date
)
returns void
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select v.tenant_id into v_tenant_id from public.veiculos v where v.id = p_veiculo;
  if v_tenant_id is null then
    raise exception 'Veículo não encontrado.';
  end if;

  if not public.tem_papel(v_tenant_id, array['dono', 'gerente']::public.app_role[]) then
    raise exception 'Sem permissão para transferir veículos.';
  end if;

  -- Encerra o período vigente de propriedade
  update public.veiculo_donos vd
  set fim = p_data
  where vd.veiculo_id = p_veiculo and vd.fim is null;

  -- Inicia o novo período de propriedade
  insert into public.veiculo_donos (tenant_id, veiculo_id, cliente_id, inicio, fim)
  values (v_tenant_id, p_veiculo, p_novo_cliente, p_data, null);

  -- Atualiza o cliente_id no registro principal do veículo
  update public.veiculos v
  set cliente_id = p_novo_cliente, updated_at = now()
  where v.id = p_veiculo;
end;
$$;

grant execute on function public.transferir_veiculo(uuid, uuid, date) to authenticated;

-- Consulta dono na data
drop function if exists public.dono_na_data(uuid, date);

create or replace function public.dono_na_data(p_veiculo uuid, p_data date)
returns uuid
language sql stable security definer set search_path = public
as $$
  select vd.cliente_id
  from public.veiculo_donos vd
  where vd.veiculo_id = p_veiculo
    and vd.inicio <= p_data
    and (vd.fim is null or vd.fim > p_data)
  order by vd.inicio desc
  limit 1;
$$;

grant execute on function public.dono_na_data(uuid, date) to authenticated;

-- Cadastro Rápido de Balcão
drop function if exists public.cadastro_rapido(text, text, text, uuid, text, text);

create or replace function public.cadastro_rapido(
  p_nome text,
  p_telefone text,
  p_placa text default null,
  p_categoria uuid default null,
  p_marca text default null,
  p_modelo text default null
)
returns table (out_cliente_id uuid, out_veiculo_id uuid)
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant_id uuid;
  v_cliente_id uuid;
  v_veiculo_id uuid;
  v_placa_clean text;
  v_existente_id uuid;
  v_existente_cliente_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select tm.tenant_id into v_tenant_id
  from public.tenant_members tm
  where tm.user_id = auth.uid() and tm.status = 'ativo'
  limit 1;

  if v_tenant_id is null then
    raise exception 'Nenhum tenant ativo encontrado para o usuário.';
  end if;

  if not public.tem_papel(v_tenant_id, array['dono', 'gerente']::public.app_role[]) then
    raise exception 'Operadores não podem cadastrar clientes ou veículos.';
  end if;

  if coalesce(trim(p_nome), '') = '' then
    raise exception 'Nome do cliente é obrigatório.';
  end if;

  if coalesce(trim(p_telefone), '') = '' then
    raise exception 'Telefone do cliente é obrigatório.';
  end if;

  -- 1. Busca ou cria o cliente pelo telefone
  select c.id into v_cliente_id
  from public.clientes c
  where c.tenant_id = v_tenant_id and c.telefone = trim(p_telefone) and c.ativo = true
  limit 1;

  if v_cliente_id is null then
    insert into public.clientes (tenant_id, nome, telefone)
    values (v_tenant_id, trim(p_nome), trim(p_telefone))
    returning clientes.id into v_cliente_id;
  end if;

  -- 2. Se informou dados do veículo
  if p_placa is not null and trim(p_placa) <> '' then
    v_placa_clean := upper(trim(p_placa));

    select v.id, v.cliente_id into v_existente_id, v_existente_cliente_id
    from public.veiculos v
    where v.tenant_id = v_tenant_id and v.placa = v_placa_clean
    limit 1;

    if v_existente_id is not null then
      v_veiculo_id := v_existente_id;

      if v_existente_cliente_id is distinct from v_cliente_id then
        perform public.transferir_veiculo(v_veiculo_id, v_cliente_id, current_date);
      end if;
    else
      if p_categoria is null then
        raise exception 'Categoria do veículo é obrigatória para novo veículo.';
      end if;

      insert into public.veiculos (tenant_id, cliente_id, categoria_id, placa, marca, modelo)
      values (v_tenant_id, v_cliente_id, p_categoria, v_placa_clean, trim(p_marca), trim(p_modelo))
      returning veiculos.id into v_veiculo_id;

      insert into public.veiculo_donos (tenant_id, veiculo_id, cliente_id, inicio, fim)
      values (v_tenant_id, v_veiculo_id, v_cliente_id, current_date, null);
    end if;
  end if;

  out_cliente_id := v_cliente_id;
  out_veiculo_id := v_veiculo_id;
  return next;
end;
$$;

grant execute on function public.cadastro_rapido(text, text, text, uuid, text, text) to authenticated;

-- Reordenação Atômica de Categorias
drop function if exists public.reordenar_categorias(uuid[]);

create or replace function public.reordenar_categorias(p_ids uuid[])
returns void
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant_id uuid;
  v_id uuid;
  v_idx integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  if array_length(p_ids, 1) is null or array_length(p_ids, 1) = 0 then
    return;
  end if;

  select cv.tenant_id into v_tenant_id from public.categorias_veiculo cv where cv.id = p_ids[1];

  if v_tenant_id is null then
    raise exception 'Categoria não encontrada.';
  end if;

  if not public.tem_papel(v_tenant_id, array['dono']::public.app_role[]) then
    raise exception 'Apenas o dono pode reordenar categorias.';
  end if;

  foreach v_id in array p_ids loop
    update public.categorias_veiculo cv
    set ordem = v_idx
    where cv.id = v_id and cv.tenant_id = v_tenant_id;

    v_idx := v_idx + 1;
  end loop;
end;
$$;

grant execute on function public.reordenar_categorias(uuid[]) to authenticated;

-- 4. POLÍTICAS DE SEGURANÇA (RLS)

alter table public.categorias_veiculo enable row level security;
alter table public.clientes enable row level security;
alter table public.veiculos enable row level security;
alter table public.veiculo_donos enable row level security;

-- Categorias de Veículo
drop policy if exists "Categorias visíveis por membros do tenant" on public.categorias_veiculo;
create policy "Categorias visíveis por membros do tenant" on public.categorias_veiculo
  for select using (tenant_id in (select meus_tenants()));

drop policy if exists "Dono gerencia categorias" on public.categorias_veiculo;
create policy "Dono gerencia categorias" on public.categorias_veiculo
  for all using (tem_papel(tenant_id, array['dono']::app_role[]));

-- Clientes
drop policy if exists "Clientes visíveis por membros do tenant" on public.clientes;
create policy "Clientes visíveis por membros do tenant" on public.clientes
  for select using (tenant_id in (select meus_tenants()));

drop policy if exists "Dono e Gerente gerenciam clientes" on public.clientes;
create policy "Dono e Gerente gerenciam clientes" on public.clientes
  for all using (tem_papel(tenant_id, array['dono', 'gerente']::app_role[]));

-- Veículos
drop policy if exists "Veículos visíveis por membros do tenant" on public.veiculos;
create policy "Veículos visíveis por membros do tenant" on public.veiculos
  for select using (tenant_id in (select meus_tenants()));

drop policy if exists "Dono e Gerente gerenciam veículos" on public.veiculos;
create policy "Dono e Gerente gerenciam veículos" on public.veiculos
  for all using (tem_papel(tenant_id, array['dono', 'gerente']::app_role[]));

-- Histórico de Donos
drop policy if exists "Histórico de donos visível por membros do tenant" on public.veiculo_donos;
create policy "Histórico de donos visível por membros do tenant" on public.veiculo_donos
  for select using (tenant_id in (select meus_tenants()));

drop policy if exists "Dono e Gerente gerenciam histórico de donos" on public.veiculo_donos;
create policy "Dono e Gerente gerenciam histórico de donos" on public.veiculo_donos
  for all using (tem_papel(tenant_id, array['dono', 'gerente']::app_role[]));

-- Grants exclusivos para usuários autenticados (Sem grant para anon)
grant select, insert, update on public.categorias_veiculo to authenticated;
grant select, insert, update on public.clientes to authenticated;
grant select, insert, update on public.veiculos to authenticated;
grant select, insert, update on public.veiculo_donos to authenticated;
