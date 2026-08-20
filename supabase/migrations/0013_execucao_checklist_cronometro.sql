-- Migration 0013: Execução, Checklist, Cronômetro Persistido e Finalização

-- 1. TABELA CHECKLIST_MODELOS
create table if not exists public.checklist_modelos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nome text not null,
  ativo boolean not null default true,
  created_at timestamptz default now(),
  unique (tenant_id, nome)
);

-- 2. TABELA CHECKLIST_MODELO_ITENS
create table if not exists public.checklist_modelo_itens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  modelo_id uuid not null references public.checklist_modelos(id) on delete cascade,
  descricao text not null,
  obrigatorio boolean not null default false,
  ordem integer not null default 0,
  created_at timestamptz default now()
);

-- 3. NOVA COLUNA EM SERVICOS
alter table public.servicos
  add column if not exists checklist_modelo_id uuid references public.checklist_modelos(id) on delete set null;

-- 4. TABELA EXECUCOES
create table if not exists public.execucoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agendamento_id uuid not null references public.agendamentos(id) on delete cascade,
  status text not null default 'em_andamento', -- 'em_andamento', 'pausado', 'finalizado'
  iniciado_em timestamptz not null default now(),
  finalizado_em timestamptz,
  segundos_pausados integer not null default 0,
  pausado_em timestamptz,
  observacoes_saida text,
  valor_total_final numeric(10,2),
  valor_definido_por uuid references auth.users(id),
  valor_definido_em timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (agendamento_id)
);

comment on column public.execucoes.iniciado_em is 'o tempo decorrido é sempre (coalesce(finalizado_em, now()) - iniciado_em) - segundos_pausados. Nunca guarde contagem acumulada no frontend.';

-- 5. TABELA EXECUCAO_ITENS
create table if not exists public.execucao_itens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  execucao_id uuid not null references public.execucoes(id) on delete cascade,
  agendamento_item_id uuid references public.agendamento_itens(id) on delete cascade,
  servico_nome text not null,
  descricao text not null,
  obrigatorio boolean not null default false,
  ordem integer not null default 0,
  concluido boolean not null default false,
  concluido_em timestamptz,
  concluido_por uuid references auth.users(id),
  created_at timestamptz default now()
);

-- 6. TABELA EXECUCAO_VALORES
create table if not exists public.execucao_valores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  execucao_id uuid not null references public.execucoes(id) on delete cascade,
  agendamento_item_id uuid not null references public.agendamento_itens(id) on delete cascade,
  valor_estimado numeric(10,2),
  valor_final numeric(10,2) not null,
  motivo text,
  created_at timestamptz default now(),
  unique (execucao_id, agendamento_item_id)
);

-- 7. TABELA EXECUCAO_FOTOS
create table if not exists public.execucao_fotos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  execucao_id uuid not null references public.execucoes(id) on delete cascade,
  path text not null,
  momento text not null, -- 'durante', 'saida'
  descricao text,
  enviado_por uuid not null references auth.users(id),
  created_at timestamptz default now()
);

-- 8. TABELA EXECUCAO_EXECUTORES
create table if not exists public.execucao_executores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  execucao_id uuid not null references public.execucoes(id) on delete cascade,
  member_id uuid not null references public.tenant_members(id) on delete cascade,
  principal boolean not null default false,
  comissao_tipo public.comissao_tipo,
  comissao_valor numeric(10,2),
  comissao_calculada numeric(10,2),
  created_at timestamptz default now(),
  unique (execucao_id, member_id)
);

-- 9. FUNÇÕES RPC

-- 9.1 INICIAR EXECUÇÃO (IDEMPOTENTE)
drop function if exists public.iniciar_execucao(uuid);
create or replace function public.iniciar_execucao(
  p_agendamento uuid
) returns uuid
language plpgsql
security definer
as $$
declare
  v_tenant_id uuid;
  v_member_id uuid;
  v_execucao_id uuid;
  v_item record;
  v_citem record;
begin
  select a.tenant_id into v_tenant_id
  from public.agendamentos a
  where a.id = p_agendamento;

  if v_tenant_id is null then
    raise exception 'Agendamento não encontrado';
  end if;

  select tm.id into v_member_id
  from public.tenant_members tm
  where tm.tenant_id = v_tenant_id
    and tm.user_id = auth.uid()
    and tm.status = 'ativo'
  limit 1;

  if v_member_id is null then
    raise exception 'Acesso negado: usuário não é membro ativo desta oficina';
  end if;

  insert into public.execucoes (
    tenant_id,
    agendamento_id,
    status,
    iniciado_em
  ) values (
    v_tenant_id,
    p_agendamento,
    'em_andamento',
    now()
  )
  on conflict (agendamento_id) do nothing
  returning id into v_execucao_id;

  if v_execucao_id is null then
    select e.id into v_execucao_id
    from public.execucoes e
    where e.agendamento_id = p_agendamento;
    return v_execucao_id;
  end if;

  -- Copia itens de checklist vinculados aos serviços do agendamento
  for v_item in (
    select ai.id as agendamento_item_id, ai.servico_id, s.nome as servico_nome, s.checklist_modelo_id
    from public.agendamento_itens ai
    join public.servicos s on s.id = ai.servico_id
    where ai.agendamento_id = p_agendamento
  ) loop
    if v_item.checklist_modelo_id is not null then
      for v_citem in (
        select cmi.descricao, cmi.obrigatorio, cmi.ordem
        from public.checklist_modelo_itens cmi
        where cmi.modelo_id = v_item.checklist_modelo_id
        order by cmi.ordem, cmi.created_at
      ) loop
        insert into public.execucao_itens (
          tenant_id,
          execucao_id,
          agendamento_item_id,
          servico_nome,
          descricao,
          obrigatorio,
          ordem
        ) values (
          v_tenant_id,
          v_execucao_id,
          v_item.agendamento_item_id,
          v_item.servico_nome,
          v_citem.descricao,
          v_citem.obrigatorio,
          v_citem.ordem
        );
      end loop;
    end if;
  end loop;

  -- Registra criador como executor principal
  insert into public.execucao_executores (
    tenant_id,
    execucao_id,
    member_id,
    principal
  ) values (
    v_tenant_id,
    v_execucao_id,
    v_member_id,
    true
  ) on conflict (execucao_id, member_id) do nothing;

  -- Atualiza status do agendamento
  update public.agendamentos a
  set status = 'em_andamento', updated_at = now()
  where a.id = p_agendamento;

  return v_execucao_id;
end;
$$;

-- 9.2 PAUSAR EXECUÇÃO (IDEMPOTENTE)
drop function if exists public.pausar_execucao(uuid);
create or replace function public.pausar_execucao(
  p_execucao uuid
) returns void
language plpgsql
security definer
as $$
declare
  v_exec record;
begin
  select e.id, e.status, e.pausado_em into v_exec
  from public.execucoes e
  where e.id = p_execucao;

  if v_exec.id is null then
    raise exception 'Execução não encontrada';
  end if;

  -- Guarda de estado: se já estiver pausado ou pausado_em não for nulo, retorna sem erro
  if v_exec.status = 'pausado' or v_exec.pausado_em is not null then
    return;
  end if;

  update public.execucoes e
  set status = 'pausado',
      pausado_em = now(),
      updated_at = now()
  where e.id = p_execucao;
end;
$$;

-- 9.3 RETOMAR EXECUÇÃO (IDEMPOTENTE)
drop function if exists public.retomar_execucao(uuid);
create or replace function public.retomar_execucao(
  p_execucao uuid
) returns void
language plpgsql
security definer
as $$
declare
  v_exec record;
  v_decorrido integer;
begin
  select e.id, e.status, e.pausado_em, e.segundos_pausados into v_exec
  from public.execucoes e
  where e.id = p_execucao;

  if v_exec.id is null then
    raise exception 'Execução não encontrada';
  end if;

  -- Guarda de estado: se pausado_em for nulo, retorna sem erro
  if v_exec.pausado_em is null then
    return;
  end if;

  v_decorrido := extract(epoch from (now() - v_exec.pausado_em))::integer;
  if v_decorrido < 0 then v_decorrido := 0; end if;

  update public.execucoes e
  set status = 'em_andamento',
      segundos_pausados = coalesce(e.segundos_pausados, 0) + v_decorrido,
      pausado_em = null,
      updated_at = now()
  where e.id = p_execucao;
end;
$$;

-- 9.4 MARCAR ITEM DE CHECKLIST
drop function if exists public.marcar_item(uuid, boolean);
create or replace function public.marcar_item(
  p_item uuid,
  p_concluido boolean
) returns void
language plpgsql
security definer
as $$
begin
  update public.execucao_itens ei
  set concluido = p_concluido,
      concluido_em = case when p_concluido then now() else null end,
      concluido_por = case when p_concluido then auth.uid() else null end
  where ei.id = p_item;
end;
$$;

-- 9.5 FINALIZAR EXECUÇÃO
drop function if exists public.finalizar_execucao(uuid, text);
drop function if exists public.finalizar_execucao(uuid);
create or replace function public.finalizar_execucao(
  p_execucao uuid,
  p_observacoes text default null
) returns void
language plpgsql
security definer
as $$
declare
  v_exec record;
  v_pendentes_count integer;
  v_pendentes_lista text;
  v_decorrido_pausa integer;
begin
  -- 1. PRIMEIRA INSTRUÇÃO: grava finalizado_em = now()
  update public.execucoes e
  set finalizado_em = now(),
      updated_at = now()
  where e.id = p_execucao;

  select e.id, e.tenant_id, e.agendamento_id, e.status, e.pausado_em, e.segundos_pausados into v_exec
  from public.execucoes e
  where e.id = p_execucao;

  if v_exec.id is null then
    raise exception 'Execução não encontrada';
  end if;

  -- Se estava pausado, encerra a pausa
  if v_exec.pausado_em is not null then
    v_decorrido_pausa := extract(epoch from (now() - v_exec.pausado_em))::integer;
    if v_decorrido_pausa < 0 then v_decorrido_pausa := 0; end if;
    
    update public.execucoes e
    set segundos_pausados = coalesce(e.segundos_pausados, 0) + v_decorrido_pausa,
        pausado_em = null
    where e.id = p_execucao;
  end if;

  -- Valida se há itens obrigatórios pendentes
  select count(*), string_agg(ei.descricao, ', ') into v_pendentes_count, v_pendentes_lista
  from public.execucao_itens ei
  where ei.execucao_id = p_execucao
    and ei.obrigatorio = true
    and ei.concluido = false;

  if v_pendentes_count > 0 then
    -- REVERTE finalizado_em para nulo se houver pendência
    update public.execucoes e
    set finalizado_em = null,
        updated_at = now()
    where e.id = p_execucao;

    raise exception 'Existem itens obrigatórios pendentes: %', v_pendentes_lista;
  end if;

  -- Finaliza execução e marca agendamento como concluido
  update public.execucoes e
  set status = 'finalizado',
      observacoes_saida = p_observacoes,
      updated_at = now()
  where e.id = p_execucao;

  update public.agendamentos a
  set status = 'concluido',
      updated_at = now()
  where a.id = v_exec.agendamento_id;
end;
$$;

-- 9.6 DEFINIR VALORES FINAIS E CALCULAR COMISSÕES
drop function if exists public.definir_valores_finais(uuid, jsonb, text);
drop function if exists public.definir_valores_finais(uuid, jsonb);
create or replace function public.definir_valores_finais(
  p_execucao uuid,
  p_valores jsonb,
  p_motivo text default null
) returns void
language plpgsql
security definer
as $$
declare
  v_tenant_id uuid;
  v_agendamento_id uuid;
  v_val_item jsonb;
  v_total_final numeric(10,2) := 0.00;
  v_agendamento_item_id uuid;
  v_val_final numeric(10,2);
  v_motivo_item text;
  v_estimado numeric(10,2);
  v_executor record;
  v_comissao_calculada numeric(10,2);
begin
  select e.tenant_id, e.agendamento_id into v_tenant_id, v_agendamento_id
  from public.execucoes e
  where e.id = p_execucao;

  if v_tenant_id is null then
    raise exception 'Execução não encontrada';
  end if;

  if not public.tem_papel(v_tenant_id, array['dono','gerente']::app_role[]) then
    raise exception 'Acesso negado: apenas Dono e Gerente podem definir valores finais';
  end if;

  if p_valores is not null and jsonb_array_length(p_valores) > 0 then
    for v_val_item in select * from jsonb_array_elements(p_valores) loop
      v_agendamento_item_id := (v_val_item->>'agendamento_item_id')::uuid;
      v_val_final := coalesce((v_val_item->>'valor_final')::numeric(10,2), 0.00);
      v_motivo_item := coalesce(v_val_item->>'motivo', p_motivo);

      select ai.preco_estimado into v_estimado
      from public.agendamento_itens ai
      where ai.id = v_agendamento_item_id;

      insert into public.execucao_valores (
        tenant_id,
        execucao_id,
        agendamento_item_id,
        valor_estimado,
        valor_final,
        motivo
      ) values (
        v_tenant_id,
        p_execucao,
        v_agendamento_item_id,
        v_estimado,
        v_val_final,
        v_motivo_item
      )
      on conflict (execucao_id, agendamento_item_id) do update
      set valor_final = EXCLUDED.valor_final,
          valor_estimado = EXCLUDED.valor_estimado,
          motivo = EXCLUDED.motivo;

      v_total_final := v_total_final + v_val_final;
    end loop;
  end if;

  update public.execucoes e
  set valor_total_final = v_total_final,
      valor_definido_por = auth.uid(),
      valor_definido_em = now(),
      updated_at = now()
  where e.id = p_execucao;

  update public.agendamentos a
  set preco_estimado_total = v_total_final,
      updated_at = now()
  where a.id = v_agendamento_id;

  for v_executor in (
    select 
      ee.id, 
      ee.member_id, 
      cv.tipo as comissao_tipo, 
      cv.valor as comissao_valor
    from public.execucao_executores ee
    cross join lateral public.comissao_vigente(ee.member_id, current_date) cv
    where ee.execucao_id = p_execucao
  ) loop
    v_comissao_calculada := 0.00;

    if v_executor.comissao_tipo = 'percentual' and v_executor.comissao_valor > 0 then
      v_comissao_calculada := (v_total_final * v_executor.comissao_valor) / 100.00;
    elsif v_executor.comissao_tipo = 'valor_fixo' and v_executor.comissao_valor > 0 then
      v_comissao_calculada := v_executor.comissao_valor;
    end if;

    update public.execucao_executores ee
    set comissao_tipo = v_executor.comissao_tipo,
        comissao_valor = v_executor.comissao_valor,
        comissao_calculada = v_comissao_calculada
    where ee.id = v_executor.id;
  end loop;
end;
$$;

-- 9.7 ADICIONAR E REMOVER EXECUTORES / TEMPO DECORRIDO
drop function if exists public.adicionar_executor(uuid, uuid);
create or replace function public.adicionar_executor(
  p_execucao uuid,
  p_member uuid
) returns void
language plpgsql
security definer
as $$
declare
  v_tenant_id uuid;
begin
  select e.tenant_id into v_tenant_id from public.execucoes e where e.id = p_execucao;
  if v_tenant_id is null then raise exception 'Execução não encontrada'; end if;

  insert into public.execucao_executores (tenant_id, execucao_id, member_id, principal)
  values (v_tenant_id, p_execucao, p_member, false)
  on conflict (execucao_id, member_id) do nothing;
end;
$$;

drop function if exists public.remover_executor(uuid, uuid);
create or replace function public.remover_executor(
  p_execucao uuid,
  p_member uuid
) returns void
language plpgsql
security definer
as $$
begin
  delete from public.execucao_executores
  where execucao_id = p_execucao and member_id = p_member;
end;
$$;

drop function if exists public.tempo_decorrido(uuid);
create or replace function public.tempo_decorrido(
  p_execucao uuid
) returns integer
language plpgsql
security definer
as $$
declare
  v_exec record;
  v_total_seconds integer;
  v_pausa_atual integer := 0;
begin
  select e.iniciado_em, e.finalizado_em, e.segundos_pausados, e.status, e.pausado_em
  into v_exec
  from public.execucoes e
  where e.id = p_execucao;

  if v_exec.iniciado_em is null then return 0; end if;

  if v_exec.status = 'pausado' and v_exec.pausado_em is not null then
    v_pausa_atual := extract(epoch from (now() - v_exec.pausado_em))::integer;
    if v_pausa_atual < 0 then v_pausa_atual := 0; end if;
  end if;

  v_total_seconds := extract(epoch from (coalesce(v_exec.finalizado_em, now()) - v_exec.iniciado_em))::integer;
  v_total_seconds := v_total_seconds - coalesce(v_exec.segundos_pausados, 0) - v_pausa_atual;

  if v_total_seconds < 0 then v_total_seconds := 0; end if;

  return v_total_seconds;
end;
$$;

-- 10. TRIGGER DE PROTEÇÃO DE VALOR
drop function if exists public.proteger_valores_execucao() cascade;
create or replace function public.proteger_valores_execucao()
returns trigger
language plpgsql
as $$
begin
  if (NEW.valor_total_final is distinct from OLD.valor_total_final or
      NEW.valor_definido_por is distinct from OLD.valor_definido_por or
      NEW.valor_definido_em is distinct from OLD.valor_definido_em) then
    if not public.tem_papel(NEW.tenant_id, array['dono','gerente']::app_role[]) then
      raise exception 'Apenas Dono e Gerente podem alterar os valores da execução';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_proteger_valores_execucao on public.execucoes;
create trigger trg_proteger_valores_execucao
  before update on public.execucoes
  for each row execute function public.proteger_valores_execucao();

-- 11. ROW LEVEL SECURITY & GRANTS
alter table public.checklist_modelos enable row level security;
alter table public.checklist_modelo_itens enable row level security;
alter table public.execucoes enable row level security;
alter table public.execucao_itens enable row level security;
alter table public.execucao_valores enable row level security;
alter table public.execucao_fotos enable row level security;
alter table public.execucao_executores enable row level security;

-- RLS checklist_modelos
drop policy if exists "Membros podem ver modelos" on public.checklist_modelos;
create policy "Membros podem ver modelos" on public.checklist_modelos for select
  using (tenant_id in (select meus_tenants()));

drop policy if exists "Dono e gerente gerenciam modelos" on public.checklist_modelos;
create policy "Dono e gerente gerenciam modelos" on public.checklist_modelos for all
  using (public.tem_papel(tenant_id, array['dono','gerente']::app_role[]))
  with check (public.tem_papel(tenant_id, array['dono','gerente']::app_role[]));

-- RLS checklist_modelo_itens
drop policy if exists "Membros podem ver itens de modelo" on public.checklist_modelo_itens;
create policy "Membros podem ver itens de modelo" on public.checklist_modelo_itens for select
  using (exists (select 1 from public.checklist_modelos cm where cm.id = modelo_id and cm.tenant_id in (select meus_tenants())));

drop policy if exists "Dono e gerente gerenciam itens de modelo" on public.checklist_modelo_itens;
create policy "Dono e gerente gerenciam itens de modelo" on public.checklist_modelo_itens for all
  using (exists (select 1 from public.checklist_modelos cm where cm.id = modelo_id and public.tem_papel(cm.tenant_id, array['dono','gerente']::app_role[])))
  with check (exists (select 1 from public.checklist_modelos cm where cm.id = modelo_id and public.tem_papel(cm.tenant_id, array['dono','gerente']::app_role[])));

-- RLS execucoes
drop policy if exists "Membros podem ver execucoes" on public.execucoes;
create policy "Membros podem ver execucoes" on public.execucoes for select
  using (tenant_id in (select meus_tenants()));

drop policy if exists "Membros podem gerenciar execucoes" on public.execucoes;
create policy "Membros podem gerenciar execucoes" on public.execucoes for all
  using (public.tem_papel(tenant_id, array['dono','gerente','operador']::app_role[]))
  with check (public.tem_papel(tenant_id, array['dono','gerente','operador']::app_role[]));

-- RLS execucao_itens
drop policy if exists "Membros podem ver execucao_itens" on public.execucao_itens;
create policy "Membros podem ver execucao_itens" on public.execucao_itens for select
  using (tenant_id in (select meus_tenants()));

drop policy if exists "Membros podem gerenciar execucao_itens" on public.execucao_itens;
create policy "Membros podem gerenciar execucao_itens" on public.execucao_itens for all
  using (public.tem_papel(tenant_id, array['dono','gerente','operador']::app_role[]))
  with check (public.tem_papel(tenant_id, array['dono','gerente','operador']::app_role[]));

-- RLS execucao_fotos
drop policy if exists "Membros podem ver execucao_fotos" on public.execucao_fotos;
create policy "Membros podem ver execucao_fotos" on public.execucao_fotos for select
  using (tenant_id in (select meus_tenants()));

drop policy if exists "Membros podem gerenciar execucao_fotos" on public.execucao_fotos;
create policy "Membros podem gerenciar execucao_fotos" on public.execucao_fotos for all
  using (public.tem_papel(tenant_id, array['dono','gerente','operador']::app_role[]))
  with check (public.tem_papel(tenant_id, array['dono','gerente','operador']::app_role[]));

-- RLS execucao_executores
drop policy if exists "Membros podem ver execucao_executores" on public.execucao_executores;
create policy "Membros podem ver execucao_executores" on public.execucao_executores for select
  using (tenant_id in (select meus_tenants()));

drop policy if exists "Membros podem gerenciar execucao_executores" on public.execucao_executores;
create policy "Membros podem gerenciar execucao_executores" on public.execucao_executores for all
  using (public.tem_papel(tenant_id, array['dono','gerente','operador']::app_role[]))
  with check (public.tem_papel(tenant_id, array['dono','gerente','operador']::app_role[]));

-- RLS execucao_valores (Restrito a Dono e Gerente)
drop policy if exists "Dono e gerente vêm execucao_valores" on public.execucao_valores;
create policy "Dono e gerente vêm execucao_valores" on public.execucao_valores for select
  using (public.tem_papel(tenant_id, array['dono','gerente']::app_role[]));

drop policy if exists "Dono e gerente gerenciam execucao_valores" on public.execucao_valores;
create policy "Dono e gerente gerenciam execucao_valores" on public.execucao_valores for all
  using (public.tem_papel(tenant_id, array['dono','gerente']::app_role[]))
  with check (public.tem_papel(tenant_id, array['dono','gerente']::app_role[]));

-- GRANTS
grant execute on function public.iniciar_execucao(uuid) to authenticated;
grant execute on function public.pausar_execucao(uuid) to authenticated;
grant execute on function public.retomar_execucao(uuid) to authenticated;
grant execute on function public.marcar_item(uuid, boolean) to authenticated;
grant execute on function public.finalizar_execucao(uuid, text) to authenticated;
grant execute on function public.definir_valores_finais(uuid, jsonb, text) to authenticated;
grant execute on function public.adicionar_executor(uuid, uuid) to authenticated;
grant execute on function public.remover_executor(uuid, uuid) to authenticated;
grant execute on function public.tempo_decorrido(uuid) to authenticated;

-- 12. SEED DE CHECKLISTS E LINK AUTOMÁTICO
do $$
declare
  v_tenant record;
  v_mod_simples uuid;
  v_mod_detalhada uuid;
  v_mod_vitrificacao uuid;
begin
  for v_tenant in select id from public.tenants loop
    -- 1. Lavagem Simples
    select id into v_mod_simples from public.checklist_modelos where tenant_id = v_tenant.id and nome = 'Lavagem Simples';
    if v_mod_simples is null then
      insert into public.checklist_modelos (tenant_id, nome)
      values (v_tenant.id, 'Lavagem Simples')
      returning id into v_mod_simples;
    end if;

    insert into public.checklist_modelo_itens (tenant_id, modelo_id, descricao, obrigatorio, ordem) values
      (v_tenant.id, v_mod_simples, 'Aspiração interna', false, 1),
      (v_tenant.id, v_mod_simples, 'Lavagem externa', false, 2),
      (v_tenant.id, v_mod_simples, 'Limpeza de rodas e pneus', false, 3),
      (v_tenant.id, v_mod_simples, 'Secagem', false, 4),
      (v_tenant.id, v_mod_simples, 'Pretinho nos pneus', false, 5),
      (v_tenant.id, v_mod_simples, 'Vidros internos e externos', false, 6)
    on conflict do nothing;

    -- 2. Lavagem Detalhada
    select id into v_mod_detalhada from public.checklist_modelos where tenant_id = v_tenant.id and nome = 'Lavagem Detalhada';
    if v_mod_detalhada is null then
      insert into public.checklist_modelos (tenant_id, nome)
      values (v_tenant.id, 'Lavagem Detalhada')
      returning id into v_mod_detalhada;
    end if;

    insert into public.checklist_modelo_itens (tenant_id, modelo_id, descricao, obrigatorio, ordem) values
      (v_tenant.id, v_mod_detalhada, 'Aspiração interna', false, 1),
      (v_tenant.id, v_mod_detalhada, 'Lavagem externa', false, 2),
      (v_tenant.id, v_mod_detalhada, 'Limpeza de rodas e pneus', false, 3),
      (v_tenant.id, v_mod_detalhada, 'Secagem', false, 4),
      (v_tenant.id, v_mod_detalhada, 'Pretinho nos pneus', false, 5),
      (v_tenant.id, v_mod_detalhada, 'Vidros internos e externos', false, 6),
      (v_tenant.id, v_mod_detalhada, 'Descontaminação de pintura', false, 7),
      (v_tenant.id, v_mod_detalhada, 'Limpeza de soleiras', false, 8),
      (v_tenant.id, v_mod_detalhada, 'Limpeza de porta-malas', false, 9),
      (v_tenant.id, v_mod_detalhada, 'Painel e plásticos internos', false, 10),
      (v_tenant.id, v_mod_detalhada, 'Caixas de roda', false, 11)
    on conflict do nothing;

    -- 3. Vitrificação
    select id into v_mod_vitrificacao from public.checklist_modelos where tenant_id = v_tenant.id and nome = 'Vitrificação';
    if v_mod_vitrificacao is null then
      insert into public.checklist_modelos (tenant_id, nome)
      values (v_tenant.id, 'Vitrificação')
      returning id into v_mod_vitrificacao;
    end if;

    insert into public.checklist_modelo_itens (tenant_id, modelo_id, descricao, obrigatorio, ordem) values
      (v_tenant.id, v_mod_vitrificacao, 'Lavagem de descontaminação', false, 1),
      (v_tenant.id, v_mod_vitrificacao, 'Clay bar', false, 2),
      (v_tenant.id, v_mod_vitrificacao, 'Correção de pintura', false, 3),
      (v_tenant.id, v_mod_vitrificacao, 'Limpeza com IPA', true, 4),
      (v_tenant.id, v_mod_vitrificacao, 'Aplicação do coating', true, 5),
      (v_tenant.id, v_mod_vitrificacao, 'Nivelamento', false, 6),
      (v_tenant.id, v_mod_vitrificacao, 'Cura mínima respeitada', true, 7),
      (v_tenant.id, v_mod_vitrificacao, 'Inspeção final sob luz', false, 8)
    on conflict do nothing;

    -- Vínculo automático de serviços existentes
    update public.servicos s set checklist_modelo_id = v_mod_simples where s.tenant_id = v_tenant.id and s.nome ilike '%lavagem simples%' and s.checklist_modelo_id is null;
    update public.servicos s set checklist_modelo_id = v_mod_detalhada where s.tenant_id = v_tenant.id and s.nome ilike '%lavagem detalhada%' and s.checklist_modelo_id is null;
    update public.servicos s set checklist_modelo_id = v_mod_vitrificacao where s.tenant_id = v_tenant.id and (s.nome ilike '%vitrificação%' or s.nome ilike '%vitrificacao%') and s.checklist_modelo_id is null;
  end loop;
end $$;
