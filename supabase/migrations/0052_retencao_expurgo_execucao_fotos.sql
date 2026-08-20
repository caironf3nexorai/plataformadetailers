-- Migration 0052: Retenção, Preservação e Expurgo de Fotos de Execução

-- 1. NOVAS COLUNAS EM EXECUCAO_FOTOS
alter table public.execucao_fotos add column if not exists preservada boolean not null default false;
alter table public.execucao_fotos add column if not exists preservada_em timestamptz default null;
alter table public.execucao_fotos add column if not exists preservada_por uuid references public.tenant_members(id) on delete set null;
alter table public.execucao_fotos add column if not exists tentativas_expurgo integer not null default 0;

-- 2. TABELA EXPURGO_LOG
create table if not exists public.expurgo_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  quantidade integer not null default 0,
  bytes_liberados bigint not null default 0,
  erros jsonb default '[]'::jsonb,
  executado_em timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- RLS expurgo_log
alter table public.expurgo_log enable row level security;

drop policy if exists "Dono e gerente vêm expurgo_log do tenant" on public.expurgo_log;
create policy "Dono e gerente vêm expurgo_log do tenant" on public.expurgo_log
  for select using (
    tenant_id in (select meus_tenants())
    and public.tem_papel(tenant_id, array['dono','gerente']::app_role[])
  );

-- 3. SEEDING DOS LIMITES DE RETENÇÃO EM PLAN_LIMITS
insert into public.plan_limits (plano, recurso, limite) values
  ('free', 'retencao_fotos_execucao_dias', 30),
  ('pro', 'retencao_fotos_execucao_dias', 90),
  ('studio', 'retencao_fotos_execucao_dias', 365)
on conflict (plano, recurso) do update set limite = EXCLUDED.limite;

-- 4. BACKFILL SEGURO (FOTOS EXISTENTES RECEBEM +90 DIAS A PARTIR DE AGORA)
update public.execucao_fotos
set expirado_em = now() + interval '90 days'
where expirado_em is null and preservada = false;

-- 5. TRIGGER DE COMPORTAMENTO AO INSERIR FOTO DE EXECUÇÃO
create or replace function public.trg_execucao_foto_expiracao_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_plano plan_code;
  v_retencao integer := 90;
begin
  -- Se expirado_em for nulo e foto não for marcada como preservada no insert
  if NEW.expirado_em is null and not coalesce(NEW.preservada, false) then
    -- JOIN explícito em execucoes para obter tenant_id
    select e.tenant_id into v_tenant_id
    from public.execucoes e
    where e.id = NEW.execucao_id;

    if v_tenant_id is not null then
      select t.plano into v_plano
      from public.tenants t
      where t.id = v_tenant_id;

      select pl.limite into v_retencao
      from public.plan_limits pl
      where pl.plano = v_plano and pl.recurso = 'retencao_fotos_execucao_dias';

      v_retencao := coalesce(v_retencao, 90);
      NEW.expirado_em := now() + (v_retencao || ' days')::interval;
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_execucao_foto_expiracao on public.execucao_fotos;
create trigger trg_execucao_foto_expiracao
  before insert on public.execucao_fotos
  for each row execute function public.trg_execucao_foto_expiracao_fn();

-- 6. RPC PRESERVAR FOTOS DE EXECUÇÃO DO ATENDIMENTO (APENAS DONO E GERENTE DO TENANT)
create or replace function public.preservar_fotos_execucao(
  p_execucao uuid,
  p_preservar boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_member_id uuid;
  v_plano plan_code;
  v_retencao integer := 90;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  -- 1. JOIN explícito em execucoes para recuperar tenant_id
  select e.tenant_id into v_tenant_id
  from public.execucoes e
  where e.id = p_execucao;

  if v_tenant_id is null then
    raise exception 'Execução não encontrada';
  end if;

  -- 2. Validação estrita de isolamento multitenant e papel (Dono ou Gerente)
  select tm.id into v_member_id
  from public.tenant_members tm
  where tm.tenant_id = v_tenant_id
    and tm.user_id = auth.uid()
    and tm.status = 'ativo'
    and tm.role in ('dono', 'gerente')
  limit 1;

  if v_member_id is null then
    raise exception 'Acesso negado: apenas Dono e Gerente deste estabelecimento podem alterar a preservação de fotos.';
  end if;

  if p_preservar then
    -- Preservar: expirado_em vira NULL e marca preservada = true
    update public.execucao_fotos ef
    set preservada = true,
        preservada_em = now(),
        preservada_por = v_member_id,
        expirado_em = null
    where ef.execucao_id = p_execucao;
  else
    -- Despreservar: recalcula expirado_em = now() + retenção do plano do tenant
    select t.plano into v_plano from public.tenants t where t.id = v_tenant_id;
    select pl.limite into v_retencao from public.plan_limits pl where pl.plano = v_plano and pl.recurso = 'retencao_fotos_execucao_dias';
    v_retencao := coalesce(v_retencao, 90);

    update public.execucao_fotos ef
    set preservada = false,
        preservada_em = null,
        preservada_por = null,
        expirado_em = now() + (v_retencao || ' days')::interval
    where ef.execucao_id = p_execucao;
  end if;
end;
$$;

grant execute on function public.preservar_fotos_execucao(uuid, boolean) to authenticated;

-- 7. RPC PARA REGRA MONOTÔNICA DE TROCA DE PLANO DO TENANT
create or replace function public.atualizar_expiracao_fotos_tenant(
  p_tenant uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plano plan_code;
  v_retencao integer := 90;
begin
  select t.plano into v_plano from public.tenants t where t.id = p_tenant;
  if v_plano is null then return; end if;

  select pl.limite into v_retencao from public.plan_limits pl where pl.plano = v_plano and pl.recurso = 'retencao_fotos_execucao_dias';
  v_retencao := coalesce(v_retencao, 90);

  -- Regra monotônica: greatest(expirado_em, now() + nova_retencao)
  -- Linhas com preservada = true não são tocadas
  update public.execucao_fotos ef
  set expirado_em = greatest(ef.expirado_em, now() + (v_retencao || ' days')::interval)
  from public.execucoes e
  where ef.execucao_id = e.id
    and e.tenant_id = p_tenant
    and ef.preservada = false;
end;
$$;

-- 8. RPC DE DIAGNÓSTICO DE OBJETOS ÓRFÃOS NO STORAGE (RESTRITO A SUPER_ADMIN)
create or replace function public.diagnostico_objetos_orfaos()
returns table (
  path text,
  bucket_id text,
  created_at timestamptz,
  size_bytes bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_super_admin boolean := false;
begin
  -- Valida se é super admin da plataforma
  select coalesce(raw_app_meta_data->>'is_super_admin', 'false')::boolean into v_is_super_admin
  from auth.users
  where id = auth.uid();

  if not v_is_super_admin then
    raise exception 'Apenas Administradores da Plataforma podem executar o diagnóstico de objetos órfãos.';
  end if;

  return query
  select 
    obj.name as path,
    obj.bucket_id,
    obj.created_at,
    coalesce((obj.metadata->>'size')::bigint, 0) as size_bytes
  from storage.objects obj
  where obj.bucket_id = 'evidencias'
    and not exists (
      select 1 from public.checkin_fotos cf where cf.path = obj.name
    )
    and not exists (
      select 1 from public.execucao_fotos ef where ef.path = obj.name
    )
    and not exists (
      select 1 from public.checkins c where c.assinatura_path = obj.name
    );
end;
$$;

grant execute on function public.diagnostico_objetos_orfaos() to authenticated;
