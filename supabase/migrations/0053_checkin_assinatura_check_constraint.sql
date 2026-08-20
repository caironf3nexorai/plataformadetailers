-- Migration 0053: Restrições CHECK para assinatura_path e caminhos de fotos contra corrupção JSON

-- 1. Desativar temporariamente o trigger de imutabilidade para permitir a normalização técnica
alter table public.checkins disable trigger user;

update public.checkins
set assinatura_path = assinatura_path::jsonb ->> 'path'
where assinatura_path like '{%'
  and (assinatura_path::jsonb ->> 'path') is not null;

-- Reativar os triggers do usuário
alter table public.checkins enable trigger user;

-- 2. Restrição CHECK na tabela public.checkins (aceita NULL, caminhos relativos e prefixo 'data:')
alter table public.checkins
  drop constraint if exists chk_checkins_assinatura_path_not_json;

alter table public.checkins
  add constraint chk_checkins_assinatura_path_not_json
  check (assinatura_path is null or assinatura_path not like '{%');

-- 3. Restrição CHECK na tabela public.checkin_fotos
alter table public.checkin_fotos
  drop constraint if exists chk_checkin_fotos_path_not_json;

alter table public.checkin_fotos
  add constraint chk_checkin_fotos_path_not_json
  check (path not like '{%');

-- 4. Restrição CHECK na tabela public.execucao_fotos
alter table public.execucao_fotos
  drop constraint if exists chk_execucao_fotos_path_not_json;

alter table public.execucao_fotos
  add constraint chk_execucao_fotos_path_not_json
  check (path not like '{%');

comment on constraint chk_checkins_assinatura_path_not_json on public.checkins is 'Impede que o retorno JSON do upload seja gravado no lugar do caminho da assinatura ou base64.';
comment on constraint chk_checkin_fotos_path_not_json on public.checkin_fotos is 'Garante que caminhos de fotos de vistoria sejam válidos e não objetos JSON.';
comment on constraint chk_execucao_fotos_path_not_json on public.execucao_fotos is 'Garante que caminhos de fotos de execução sejam válidos e não objetos JSON.';
