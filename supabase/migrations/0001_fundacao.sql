-- Migration 0001: Fundação de Dados, Tenancy, RLS, Planos e Comissões
-- Executar no SQL Editor do Supabase

-- 1. EXTENSÕES E TIPOS ENUM
create extension if not exists btree_gist;

create type app_role as enum ('dono', 'gerente', 'operador');
create type plan_code as enum ('free', 'pro', 'studio');
create type comissao_tipo as enum ('nenhuma', 'percentual', 'valor_fixo');
create type member_status as enum ('ativo', 'convidado', 'inativo');

-- 2. TABELAS DE DOMÍNIO DE BASE

-- Profiles (espelho de auth.users)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null default '',
  telefone text,
  created_at timestamptz default now()
);

-- Tenants (oficina)
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  slug text unique not null,
  plano plan_code not null default 'free',
  telefone text,
  cidade text,
  uf text,
  criado_por uuid not null references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Tenant Members (vínculo usuário <-> oficina)
create table public.tenant_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  email text not null,
  role app_role not null default 'operador',
  status member_status not null default 'convidado',
  convite_token uuid default gen_random_uuid(),
  created_at timestamptz default now(),
  unique (tenant_id, email)
);

-- Comissão Regras (histórico imutável de vigência)
create table public.comissao_regras (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid not null references public.tenant_members(id) on delete cascade,
  tipo comissao_tipo not null default 'nenhuma',
  valor numeric(10,2) not null default 0,
  vigencia_inicio date not null,
  vigencia_fim date,
  criado_por uuid not null references auth.users(id),
  created_at timestamptz default now()
);

-- Constraint de não sobreposição de comissão por membro
alter table public.comissao_regras add constraint comissao_sem_sobreposicao
  exclude using gist (
    member_id with =,
    daterange(vigencia_inicio, coalesce(vigencia_fim, 'infinity'::date), '[)') with &&
  );

-- cada regra é imutável após criada. Alterar a comissão de alguém significa encerrar a vigência atual e criar uma nova regra. Períodos passados nunca mudam.

-- Tabelas de Planos e Limites
create table public.plans (
  codigo plan_code primary key,
  nome text not null,
  preco_centavos integer not null default 0,
  ativo boolean not null default true
);

create table public.plan_limits (
  plano plan_code not null references public.plans(codigo),
  recurso text not null,
  limite integer, -- nulo = ilimitado
  primary key (plano, recurso)
);

-- Seed de Planos e Limites
insert into public.plans (codigo, nome, preco_centavos, ativo) values
  ('free', 'Free', 0, true),
  ('pro', 'Pro', 8900, true),
  ('studio', 'Studio', 18900, true)
on conflict (codigo) do nothing;

insert into public.plan_limits (plano, recurso, limite) values
  ('free', 'usuarios', 1),
  ('free', 'servicos_mes', 20),
  ('free', 'orcamentos_mes', 3),
  ('free', 'produtos', 0),
  ('pro', 'usuarios', 3),
  ('pro', 'servicos_mes', null),
  ('pro', 'orcamentos_mes', null),
  ('pro', 'produtos', null),
  ('studio', 'usuarios', null),
  ('studio', 'servicos_mes', null),
  ('studio', 'orcamentos_mes', null),
  ('studio', 'produtos', null)
on conflict (plano, recurso) do nothing;

-- Storage Bucket para evidências
insert into storage.buckets (id, name, public) 
values ('evidencias', 'evidencias', false) 
on conflict (id) do nothing;


-- 3. FUNÇÕES SECURITY DEFINER (Prevenção de Recursão em RLS)

create or replace function public.meus_tenants()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select tenant_id from tenant_members
  where user_id = auth.uid() and status = 'ativo'
$$;

create or replace function public.tem_papel(p_tenant uuid, p_roles app_role[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from tenant_members
    where tenant_id = p_tenant
      and user_id = auth.uid()
      and status = 'ativo'
      and role = any(p_roles)
  )
$$;

create or replace function public.dentro_do_limite(p_tenant uuid, p_recurso text, p_contagem integer)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_plano plan_code;
  v_limite integer;
begin
  select plano into v_plano from tenants where id = p_tenant;
  select limite into v_limite from plan_limits
    where plano = v_plano and recurso = p_recurso;
  if v_limite is null then return true; end if;
  return p_contagem < v_limite;
end;
$$;

create or replace function public.comissao_vigente(p_member uuid, p_data date)
returns table (tipo comissao_tipo, valor numeric)
language sql stable security definer set search_path = public
as $$
  select coalesce(r.tipo, 'nenhuma'::comissao_tipo), coalesce(r.valor, 0)
  from (select 1) x
  left join comissao_regras r
    on r.member_id = p_member
   and r.vigencia_inicio <= p_data
   and (r.vigencia_fim is null or r.vigencia_fim > p_data)
$$;

-- RPC: Criação atômica de Oficina
create or replace function public.criar_oficina(
  p_nome text, p_cidade text, p_uf text, p_telefone text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare 
  v_tenant uuid; 
  v_slug text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  -- Proteção 1: Nome obrigatório
  if coalesce(trim(p_nome), '') = '' then
    raise exception 'Informe o nome da oficina.';
  end if;

  -- Proteção 2: Limite de 3 oficinas por usuário
  if (
    select count(*) from tenant_members
    where user_id = auth.uid() and role = 'dono' and status in ('ativo', 'convidado')
  ) >= 3 then
    raise exception 'Limite de oficinas por usuário atingido.';
  end if;

  v_slug := lower(regexp_replace(p_nome, '[^a-zA-Z0-9]+', '-', 'g'))
            || '-' || substr(gen_random_uuid()::text, 1, 6);

  insert into tenants (nome, slug, cidade, uf, telefone, criado_por, plano)
    values (p_nome, v_slug, p_cidade, p_uf, p_telefone, auth.uid(), 'free')
    returning id into v_tenant;

  insert into tenant_members (tenant_id, user_id, email, role, status)
    values (
      v_tenant, 
      auth.uid(),
      (select email from auth.users where id = auth.uid()),
      'dono', 
      'ativo'
    );

  return v_tenant;
end;
$$;

-- RPC: Troca Atômica de Comissão
create or replace function public.nova_regra_comissao(
  p_member uuid, p_tipo comissao_tipo, p_valor numeric, p_inicio date
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_new_rule_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select tenant_id into v_tenant_id from tenant_members where id = p_member;
  if v_tenant_id is null then
    raise exception 'Membro não encontrado.';
  end if;

  -- Validação de segurança interna para security definer
  if not tem_papel(v_tenant_id, array['dono']::app_role[]) then
    raise exception 'Apenas donos podem gerenciar comissões.';
  end if;

  if p_inicio < current_date then
    raise exception 'A vigência não pode começar no passado. Períodos já fechados são imutáveis.';
  end if;

  -- Encerra a vigência anterior na data de início da nova
  update comissao_regras
    set vigencia_fim = p_inicio
    where member_id = p_member and vigencia_fim is null;

  -- Cria a nova regra
  insert into comissao_regras (tenant_id, member_id, tipo, valor, vigencia_inicio, criado_por)
    values (v_tenant_id, p_member, p_tipo, p_valor, p_inicio, auth.uid())
    returning id into v_new_rule_id;

  return v_new_rule_id;
end;
$$;


-- 4. TRIGGERS DE INTEGRIDADE E REGRAS DE NEGÓCIO

-- Trigger: criação automática de perfil no signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, nome, telefone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', ''),
    new.raw_user_meta_data->>'telefone'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Trigger: validação de limite de usuários no plano
create or replace function public.check_tenant_user_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_contagem integer;
begin
  if new.status in ('ativo', 'convidado') then
    select count(*) into v_contagem 
      from tenant_members 
      where tenant_id = new.tenant_id 
        and status in ('ativo', 'convidado');

    if not dentro_do_limite(new.tenant_id, 'usuarios', v_contagem) then
      raise exception 'Limite de usuários do plano atingido. Faça upgrade para adicionar mais pessoas.';
    end if;
  end if;
  return new;
end;
$$;

create or replace trigger before_tenant_member_insert
  before insert on public.tenant_members
  for each row execute function public.check_tenant_user_limit();

-- Trigger: imutabilidade de regras de comissão (UPDATE)
create or replace function public.protect_comissao_regras_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Permite apenas definir vigencia_fim quando antes era nula
  if old.tipo != new.tipo 
     or old.valor != new.valor 
     or old.vigencia_inicio != new.vigencia_inicio 
     or old.member_id != new.member_id 
     or old.tenant_id != new.tenant_id 
     or (old.vigencia_fim is not null and old.vigencia_fim != new.vigencia_fim) then
    raise exception 'Regra de comissão é imutável. Encerre a vigência atual e crie uma nova regra.';
  end if;
  return new;
end;
$$;

create or replace trigger before_comissao_regras_update
  before update on public.comissao_regras
  for each row execute function public.protect_comissao_regras_update();

-- Trigger: imutabilidade de regras de comissão (DELETE)
create or replace function public.protect_comissao_regras_delete()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  raise exception 'Regra de comissão é imutável. Encerre a vigência atual e crie uma nova regra.';
  return null;
end;
$$;

create or replace trigger before_comissao_regras_delete
  before delete on public.comissao_regras
  for each row execute function public.protect_comissao_regras_delete();

-- Trigger: proibição de vigência retroativa (INSERT)
create or replace function public.check_comissao_no_retroactive()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.vigencia_inicio < current_date then
    raise exception 'A vigência não pode começar no passado. Períodos já fechados são imutáveis.';
  end if;
  return new;
end;
$$;

create or replace trigger before_comissao_regras_insert
  before insert on public.comissao_regras
  for each row execute function public.check_comissao_no_retroactive();


-- 5. ROW LEVEL SECURITY (RLS) & POLÍCITAS DE ACESSO

alter table public.profiles enable row level security;
alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.comissao_regras enable row level security;
alter table public.plans enable row level security;
alter table public.plan_limits enable row level security;

-- Profiles
create policy "Perfil próprio: leitura" on public.profiles
  for select using (id = auth.uid());

create policy "Perfil próprio: edição" on public.profiles
  for update using (id = auth.uid());

-- Tenants
create policy "Tenants visíveis por membros ativos" on public.tenants
  for select using (id in (select meus_tenants()));

create policy "Autenticado cria tenant" on public.tenants
  for insert with check (criado_por = auth.uid());

create policy "Dono edita tenant" on public.tenants
  for update using (tem_papel(id, array['dono']::app_role[]));

-- Tenant Members
create policy "Membros visíveis pelo mesmo tenant" on public.tenant_members
  for select using (tenant_id in (select meus_tenants()));

create policy "Dono gerencia membros" on public.tenant_members
  for all using (tem_papel(tenant_id, array['dono']::app_role[]));

create policy "Membro aceita próprio convite" on public.tenant_members
  for update using (
    (user_id is null or user_id = auth.uid()) 
    and email = (select email from auth.users where id = auth.uid())
  );

-- Comissao Regras
create policy "Comissões visíveis por dono, gerente ou próprio membro" on public.comissao_regras
  for select using (
    tenant_id in (select meus_tenants()) 
    and (
      tem_papel(tenant_id, array['dono', 'gerente']::app_role[]) 
      or member_id in (select id from tenant_members where user_id = auth.uid())
    )
  );

create policy "Dono insere comissão" on public.comissao_regras
  for insert with check (tem_papel(tenant_id, array['dono']::app_role[]));

create policy "Dono encerra vigência da comissão" on public.comissao_regras
  for update using (tem_papel(tenant_id, array['dono']::app_role[]));

-- Plans & Plan Limits
create policy "Planos visíveis por autenticados" on public.plans
  for select using (auth.role() = 'authenticated');

create policy "Limites de planos visíveis por autenticados" on public.plan_limits
  for select using (auth.role() = 'authenticated');

-- Storage Evidências
-- estas fotos são prova em disputa com cliente. Vazamento entre tenants é problema jurídico, não apenas técnico.

create policy "Ver evidencias do tenant" on storage.objects
  for select using (
    bucket_id = 'evidencias' 
    and (storage.foldername(name))[1]::uuid in (select meus_tenants())
  );

create policy "Inserir evidencias do tenant" on storage.objects
  for insert with check (
    bucket_id = 'evidencias' 
    and (storage.foldername(name))[1]::uuid in (select meus_tenants())
  );

create policy "Deletar evidencias do tenant" on storage.objects
  for delete using (
    bucket_id = 'evidencias' 
    and (storage.foldername(name))[1]::uuid in (select meus_tenants())
  );

-- 10. FUNÇÕES SECURITY DEFINER PARA GESTÃO DE CONVITES

create or replace function public.convite_info(p_token uuid)
returns table (oficina text, email text, role app_role, valido boolean)
language sql stable security definer set search_path = public
as $$
  select t.nome as oficina, m.email, m.role, (m.status = 'convidado') as valido
  from tenant_members m
  join tenants t on t.id = m.tenant_id
  where m.convite_token = p_token
$$;

grant execute on function public.convite_info(uuid) to anon, authenticated;

create or replace function public.aceitar_convite(p_token uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_member tenant_members;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Entre ou crie sua conta para aceitar o convite.';
  end if;

  select * into v_member
  from tenant_members
  where convite_token = p_token and status = 'convidado';

  if not found then
    raise exception 'Convite não encontrado, expirado ou já utilizado.';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  update tenant_members
  set user_id = auth.uid(),
      status = 'ativo',
      email = coalesce(v_email, email)
  where id = v_member.id;

  return v_member.tenant_id;
end;
$$;

grant execute on function public.aceitar_convite(uuid) to authenticated;

