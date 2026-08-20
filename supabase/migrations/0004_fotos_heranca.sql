-- Migration 0004: Herança de Imagens de Serviço (Capa da Oficina e Fotos por Grupo)

-- 1. BUCKET PÚBLICO DE CATÁLOGO
-- Garante que o bucket 'catalogo' exista e seja público (Marketing e Agendamento Público)
insert into storage.buckets (id, name, public)
values ('catalogo', 'catalogo', true)
on conflict (id) do update set public = true;

-- 2. ALTERAÇÕES EM TENANTS (Capa Padrão da Oficina)
alter table public.tenants add column if not exists capa_path text;

-- 3. TABELA DE FOTOS POR GRUPO DE SERVIÇO
create table if not exists public.tenant_grupo_fotos (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  grupo text not null,
  grupo_slug text not null,
  foto_path text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (tenant_id, grupo_slug)
);

-- 4. POLÍTICAS DE SEGURANÇA (RLS) PARA TENANT_GRUPO_FOTOS
alter table public.tenant_grupo_fotos enable row level security;

drop policy if exists "Fotos de grupo visíveis por membros do tenant" on public.tenant_grupo_fotos;
create policy "Fotos de grupo visíveis por membros do tenant" on public.tenant_grupo_fotos
  for select using (tenant_id in (select meus_tenants()));

drop policy if exists "Dono e Gerente gerenciam fotos de grupo" on public.tenant_grupo_fotos;
create policy "Dono e Gerente gerenciam fotos de grupo" on public.tenant_grupo_fotos
  for all using (tem_papel(tenant_id, array['dono', 'gerente']::app_role[]));

grant select, insert, update, delete on public.tenant_grupo_fotos to authenticated;

-- 5. POLÍTICAS DE SEGURANÇA (RLS) PARA STORAGE.OBJECTS (BUCKET CATALOGO)

-- Leitura pública irrestrita para qualquer usuário (inclusive deslogados)
drop policy if exists "Leitura pública de objetos do catálogo" on storage.objects;
create policy "Leitura pública de objetos do catálogo" on storage.objects
  for select using (bucket_id = 'catalogo');

-- Dono e Gerente inserem objetos no bucket catalogo
drop policy if exists "Dono e Gerente inserem no catalogo" on storage.objects;
create policy "Dono e Gerente inserem no catalogo" on storage.objects
  for insert with check (
    bucket_id = 'catalogo'
    and array_length(storage.foldername(name), 1) >= 2
    and public.tem_papel(
          (storage.foldername(name))[1]::uuid,
          array['dono','gerente']::app_role[]
        )
  );

-- Dono e Gerente atualizam objetos no bucket catalogo
drop policy if exists "Dono e Gerente atualizam no catalogo" on storage.objects;
create policy "Dono e Gerente atualizam no catalogo" on storage.objects
  for update using (
    bucket_id = 'catalogo'
    and array_length(storage.foldername(name), 1) >= 2
    and public.tem_papel(
          (storage.foldername(name))[1]::uuid,
          array['dono','gerente']::app_role[]
        )
  );

-- Dono e Gerente deletam objetos no bucket catalogo
drop policy if exists "Dono e Gerente deletam no catalogo" on storage.objects;
create policy "Dono e Gerente deletam no catalogo" on storage.objects
  for delete using (
    bucket_id = 'catalogo'
    and array_length(storage.foldername(name), 1) >= 2
    and public.tem_papel(
          (storage.foldername(name))[1]::uuid,
          array['dono','gerente']::app_role[]
        )
  );
