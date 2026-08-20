-- Migration 0019: Seed de Checklists Modelo, Suporte a Etapas Avulsas e Governança de Execução

-- 1. Coluna de Origem em Execucao_Itens
alter table public.execucao_itens
  add column if not exists origem text not null default 'modelo' check (origem in ('modelo', 'avulso'));

-- 2. RPC Adicionar Item Avulso na Execução
create or replace function public.adicionar_item_execucao(
  p_execucao uuid,
  p_agendamento_item uuid,
  p_descricao text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exec record;
  v_member_id uuid;
  v_servico_nome text;
  v_max_ordem integer;
  v_new_item_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  if coalesce(trim(p_descricao), '') = '' then
    raise exception 'A descrição da etapa não pode ser vazia.';
  end if;

  select e.id, e.tenant_id, e.status
  into v_exec
  from public.execucoes e
  where e.id = p_execucao;

  if v_exec.id is null then
    raise exception 'Execução não encontrada.';
  end if;

  if v_exec.status = 'finalizado' then
    raise exception 'Não é possível adicionar etapas a uma execução finalizada.';
  end if;

  select tm.id into v_member_id
  from public.tenant_members tm
  where tm.tenant_id = v_exec.tenant_id
    and tm.user_id = auth.uid()
    and tm.status = 'ativo'
  limit 1;

  if v_member_id is null then
    raise exception 'Acesso negado: usuário não é membro ativo desta oficina';
  end if;

  select s.nome into v_servico_nome
  from public.agendamento_itens ai
  join public.servicos s on s.id = ai.servico_id
  where ai.id = p_agendamento_item;

  if v_servico_nome is null then
    select ei.servico_nome into v_servico_nome
    from public.execucao_itens ei
    where ei.execucao_id = p_execucao and ei.agendamento_item_id = p_agendamento_item
    limit 1;
  end if;

  if v_servico_nome is null then
    v_servico_nome := 'Serviço';
  end if;

  select coalesce(max(ordem), 0) + 1 into v_max_ordem
  from public.execucao_itens
  where execucao_id = p_execucao and agendamento_item_id = p_agendamento_item;

  insert into public.execucao_itens (
    tenant_id,
    execucao_id,
    agendamento_item_id,
    servico_nome,
    descricao,
    obrigatorio,
    ordem,
    origem
  ) values (
    v_exec.tenant_id,
    p_execucao,
    p_agendamento_item,
    v_servico_nome,
    trim(p_descricao),
    false,
    v_max_ordem,
    'avulso'
  )
  returning id into v_new_item_id;

  return v_new_item_id;
end;
$$;

grant execute on function public.adicionar_item_execucao(uuid, uuid, text) to authenticated;

-- 3. RPC Remover Item Avulso da Execução
create or replace function public.remover_item_execucao(
  p_item_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_exec_status text;
  v_member_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select ei.id, ei.execucao_id, ei.tenant_id, ei.origem
  into v_item
  from public.execucao_itens ei
  where ei.id = p_item_id;

  if v_item.id is null then
    raise exception 'Item de checklist não encontrado.';
  end if;

  if v_item.origem <> 'avulso' then
    raise exception 'Apenas etapas avulsas adicionadas durante a execução podem ser removidas.';
  end if;

  select e.status into v_exec_status
  from public.execucoes e
  where e.id = v_item.execucao_id;

  if v_exec_status = 'finalizado' then
    raise exception 'Não é possível remover etapas de uma execução finalizada.';
  end if;

  select tm.id into v_member_id
  from public.tenant_members tm
  where tm.tenant_id = v_item.tenant_id
    and tm.user_id = auth.uid()
    and tm.status = 'ativo'
  limit 1;

  if v_member_id is null then
    raise exception 'Acesso negado: usuário não é membro ativo desta oficina';
  end if;

  delete from public.execucao_itens where id = p_item_id;
end;
$$;

grant execute on function public.remover_item_execucao(uuid) to authenticated;

-- 4. Atualização da RPC marcar_item com Bloqueio pós-finalização
create or replace function public.marcar_item(
  p_item uuid,
  p_concluido boolean
) returns void
language plpgsql
security definer
as $$
declare
  v_exec_status text;
begin
  select e.status into v_exec_status
  from public.execucao_itens ei
  join public.execucoes e on e.id = ei.execucao_id
  where ei.id = p_item;

  if v_exec_status = 'finalizado' then
    raise exception 'Não é possível alterar itens de checklist de uma execução finalizada.';
  end if;

  update public.execucao_itens ei
  set concluido = p_concluido,
      concluido_em = case when p_concluido then now() else null end,
      concluido_por = case when p_concluido then auth.uid() else null end
  where ei.id = p_item;
end;
$$;

-- 5. Seed de Checklists para os Demais 10 Serviços Modelo
do $$
declare
  v_tenant record;
  v_mod_id uuid;
begin
  for v_tenant in select id from public.tenants loop

    -- 1. Higienização Interna
    select id into v_mod_id from public.checklist_modelos where tenant_id = v_tenant.id and nome = 'Higienização Interna';
    if v_mod_id is null then
      insert into public.checklist_modelos (tenant_id, nome) values (v_tenant.id, 'Higienização Interna') returning id into v_mod_id;
    end if;

    insert into public.checklist_modelo_itens (tenant_id, modelo_id, descricao, obrigatorio, ordem) values
      (v_tenant.id, v_mod_id, 'Aspiração completa', false, 1),
      (v_tenant.id, v_mod_id, 'Limpeza de plásticos e painel', false, 2),
      (v_tenant.id, v_mod_id, 'Higienização de bancos', false, 3),
      (v_tenant.id, v_mod_id, 'Limpeza de carpetes', false, 4),
      (v_tenant.id, v_mod_id, 'Limpeza de teto', false, 5),
      (v_tenant.id, v_mod_id, 'Vidros internos', false, 6),
      (v_tenant.id, v_mod_id, 'Finalização com odorizante', false, 7)
    on conflict do nothing;

    update public.servicos set checklist_modelo_id = v_mod_id
    where tenant_id = v_tenant.id and nome ilike '%higienização interna%' and checklist_modelo_id is null;


    -- 2. Higienização de Bancos
    select id into v_mod_id from public.checklist_modelos where tenant_id = v_tenant.id and nome = 'Higienização de Bancos';
    if v_mod_id is null then
      insert into public.checklist_modelos (tenant_id, nome) values (v_tenant.id, 'Higienização de Bancos') returning id into v_mod_id;
    end if;

    insert into public.checklist_modelo_itens (tenant_id, modelo_id, descricao, obrigatorio, ordem) values
      (v_tenant.id, v_mod_id, 'Aspiração', false, 1),
      (v_tenant.id, v_mod_id, 'Aplicação do produto', false, 2),
      (v_tenant.id, v_mod_id, 'Extração/escovação', false, 3),
      (v_tenant.id, v_mod_id, 'Secagem', false, 4),
      (v_tenant.id, v_mod_id, 'Inspeção final', false, 5)
    on conflict do nothing;

    update public.servicos set checklist_modelo_id = v_mod_id
    where tenant_id = v_tenant.id and nome ilike '%higienização de bancos%' and checklist_modelo_id is null;


    -- 3. Higienização de Ar-Condicionado
    select id into v_mod_id from public.checklist_modelos where tenant_id = v_tenant.id and nome = 'Higienização de Ar-Condicionado';
    if v_mod_id is null then
      insert into public.checklist_modelos (tenant_id, nome) values (v_tenant.id, 'Higienização de Ar-Condicionado') returning id into v_mod_id;
    end if;

    insert into public.checklist_modelo_itens (tenant_id, modelo_id, descricao, obrigatorio, ordem) values
      (v_tenant.id, v_mod_id, 'Verificação do filtro', false, 1),
      (v_tenant.id, v_mod_id, 'Aplicação do produto na admissão', false, 2),
      (v_tenant.id, v_mod_id, 'Circulação com ventilação máxima', false, 3),
      (v_tenant.id, v_mod_id, 'Higienização das saídas de ar', false, 4),
      (v_tenant.id, v_mod_id, 'Teste de odor', false, 5)
    on conflict do nothing;

    update public.servicos set checklist_modelo_id = v_mod_id
    where tenant_id = v_tenant.id and (nome ilike '%ar-condicionado%' or nome ilike '%ar condicionado%') and checklist_modelo_id is null;


    -- 4. Lavagem Técnica de Motor
    select id into v_mod_id from public.checklist_modelos where tenant_id = v_tenant.id and nome = 'Lavagem Técnica de Motor';
    if v_mod_id is null then
      insert into public.checklist_modelos (tenant_id, nome) values (v_tenant.id, 'Lavagem Técnica de Motor') returning id into v_mod_id;
    end if;

    insert into public.checklist_modelo_itens (tenant_id, modelo_id, descricao, obrigatorio, ordem) values
      (v_tenant.id, v_mod_id, 'Proteção de componentes elétricos', false, 1),
      (v_tenant.id, v_mod_id, 'Aplicação do desengraxante', false, 2),
      (v_tenant.id, v_mod_id, 'Escovação', false, 3),
      (v_tenant.id, v_mod_id, 'Enxágue controlado', false, 4),
      (v_tenant.id, v_mod_id, 'Secagem com ar comprimido', false, 5),
      (v_tenant.id, v_mod_id, 'Aplicação de finalizador', false, 6)
    on conflict do nothing;

    update public.servicos set checklist_modelo_id = v_mod_id
    where tenant_id = v_tenant.id and nome ilike '%motor%' and checklist_modelo_id is null;


    -- 5. Polimento Comercial
    select id into v_mod_id from public.checklist_modelos where tenant_id = v_tenant.id and nome = 'Polimento Comercial';
    if v_mod_id is null then
      insert into public.checklist_modelos (tenant_id, nome) values (v_tenant.id, 'Polimento Comercial') returning id into v_mod_id;
    end if;

    insert into public.checklist_modelo_itens (tenant_id, modelo_id, descricao, obrigatorio, ordem) values
      (v_tenant.id, v_mod_id, 'Lavagem prévia', false, 1),
      (v_tenant.id, v_mod_id, 'Descontaminação', false, 2),
      (v_tenant.id, v_mod_id, 'Polimento em etapa única', false, 3),
      (v_tenant.id, v_mod_id, 'Remoção de resíduo', false, 4),
      (v_tenant.id, v_mod_id, 'Inspeção sob luz', false, 5)
    on conflict do nothing;

    update public.servicos set checklist_modelo_id = v_mod_id
    where tenant_id = v_tenant.id and nome ilike '%polimento comercial%' and checklist_modelo_id is null;


    -- 6. Polimento Técnico
    select id into v_mod_id from public.checklist_modelos where tenant_id = v_tenant.id and nome = 'Polimento Técnico';
    if v_mod_id is null then
      insert into public.checklist_modelos (tenant_id, nome) values (v_tenant.id, 'Polimento Técnico') returning id into v_mod_id;
    end if;

    insert into public.checklist_modelo_itens (tenant_id, modelo_id, descricao, obrigatorio, ordem) values
      (v_tenant.id, v_mod_id, 'Lavagem de descontaminação', false, 1),
      (v_tenant.id, v_mod_id, 'Clay bar', false, 2),
      (v_tenant.id, v_mod_id, 'Medição de camada', false, 3),
      (v_tenant.id, v_mod_id, 'Corte', false, 4),
      (v_tenant.id, v_mod_id, 'Refino', false, 5),
      (v_tenant.id, v_mod_id, 'Lustro', false, 6),
      (v_tenant.id, v_mod_id, 'Inspeção sob luz', false, 7)
    on conflict do nothing;

    update public.servicos set checklist_modelo_id = v_mod_id
    where tenant_id = v_tenant.id and nome ilike '%polimento técnico%' and checklist_modelo_id is null;


    -- 7. Correção de Pintura
    select id into v_mod_id from public.checklist_modelos where tenant_id = v_tenant.id and nome = 'Correção de Pintura';
    if v_mod_id is null then
      insert into public.checklist_modelos (tenant_id, nome) values (v_tenant.id, 'Correção de Pintura') returning id into v_mod_id;
    end if;

    insert into public.checklist_modelo_itens (tenant_id, modelo_id, descricao, obrigatorio, ordem) values
      (v_tenant.id, v_mod_id, 'Lavagem de descontaminação', false, 1),
      (v_tenant.id, v_mod_id, 'Clay bar', false, 2),
      (v_tenant.id, v_mod_id, 'Medição de camada', true, 3),
      (v_tenant.id, v_mod_id, 'Corte pesado', false, 4),
      (v_tenant.id, v_mod_id, 'Refino', false, 5),
      (v_tenant.id, v_mod_id, 'Lustro', false, 6),
      (v_tenant.id, v_mod_id, 'Limpeza com IPA', true, 7),
      (v_tenant.id, v_mod_id, 'Inspeção sob luz', false, 8)
    on conflict do nothing;

    update public.servicos set checklist_modelo_id = v_mod_id
    where tenant_id = v_tenant.id and (nome ilike '%correção de pintura%' or nome ilike '%correcao de pintura%') and checklist_modelo_id is null;


    -- 8. Cristalização de Vidros
    select id into v_mod_id from public.checklist_modelos where tenant_id = v_tenant.id and nome = 'Cristalização de Vidros';
    if v_mod_id is null then
      insert into public.checklist_modelos (tenant_id, nome) values (v_tenant.id, 'Cristalização de Vidros') returning id into v_mod_id;
    end if;

    insert into public.checklist_modelo_itens (tenant_id, modelo_id, descricao, obrigatorio, ordem) values
      (v_tenant.id, v_mod_id, 'Limpeza dos vidros', false, 1),
      (v_tenant.id, v_mod_id, 'Descontaminação', false, 2),
      (v_tenant.id, v_mod_id, 'Aplicação do cristalizador', false, 3),
      (v_tenant.id, v_mod_id, 'Remoção do excesso', false, 4),
      (v_tenant.id, v_mod_id, 'Polimento final', false, 5)
    on conflict do nothing;

    update public.servicos set checklist_modelo_id = v_mod_id
    where tenant_id = v_tenant.id and (nome ilike '%cristalização%' or nome ilike '%cristalizacao%') and checklist_modelo_id is null;


    -- 9. Cera de Proteção
    select id into v_mod_id from public.checklist_modelos where tenant_id = v_tenant.id and nome = 'Cera de Proteção';
    if v_mod_id is null then
      insert into public.checklist_modelos (tenant_id, nome) values (v_tenant.id, 'Cera de Proteção') returning id into v_mod_id;
    end if;

    insert into public.checklist_modelo_itens (tenant_id, modelo_id, descricao, obrigatorio, ordem) values
      (v_tenant.id, v_mod_id, 'Lavagem', false, 1),
      (v_tenant.id, v_mod_id, 'Secagem', false, 2),
      (v_tenant.id, v_mod_id, 'Aplicação da cera', false, 3),
      (v_tenant.id, v_mod_id, 'Tempo de cura respeitado', false, 4),
      (v_tenant.id, v_mod_id, 'Remoção e lustro', false, 5)
    on conflict do nothing;

    update public.servicos set checklist_modelo_id = v_mod_id
    where tenant_id = v_tenant.id and nome ilike '%cera%' and checklist_modelo_id is null;


    -- 10. Impermeabilização de Bancos
    select id into v_mod_id from public.checklist_modelos where tenant_id = v_tenant.id and nome = 'Impermeabilização de Bancos';
    if v_mod_id is null then
      insert into public.checklist_modelos (tenant_id, nome) values (v_tenant.id, 'Impermeabilização de Bancos') returning id into v_mod_id;
    end if;

    insert into public.checklist_modelo_itens (tenant_id, modelo_id, descricao, obrigatorio, ordem) values
      (v_tenant.id, v_mod_id, 'Limpeza prévia', false, 1),
      (v_tenant.id, v_mod_id, 'Secagem completa', true, 2),
      (v_tenant.id, v_mod_id, 'Aplicação do impermeabilizante', false, 3),
      (v_tenant.id, v_mod_id, 'Cura respeitada', true, 4),
      (v_tenant.id, v_mod_id, 'Inspeção', false, 5)
    on conflict do nothing;

    update public.servicos set checklist_modelo_id = v_mod_id
    where tenant_id = v_tenant.id and (nome ilike '%impermeabilização%' or nome ilike '%impermeabilizacao%') and checklist_modelo_id is null;

  end loop;
end $$;
