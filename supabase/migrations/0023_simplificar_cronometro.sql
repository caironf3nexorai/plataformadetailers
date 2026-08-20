-- 0. Garantir colunas na tabela execucoes
alter table public.execucoes
  add column if not exists contando_desde timestamptz,
  add column if not exists segundos_trabalhados integer default 0,
  add column if not exists tempo_efetivo_minutos integer default 0;

comment on column public.execucoes.contando_desde is 'Momento em que o cronômetro começou a contar a fase atual. Nulo quando pausado ou finalizado.';
comment on column public.execucoes.segundos_trabalhados is 'Segundos de trabalho já consolidados até a última pausa.';
comment on column public.execucoes.tempo_efetivo_minutos is 'Tempo efetivo de trabalho consolidado em minutos ao finalizar a execução.';

-- 1. Redefinição da RPC tempo_execucao (Leitura pura com suporte a tempo congelado)
drop function if exists public.tempo_execucao(uuid);

create or replace function public.tempo_execucao(p_execucao uuid)
returns table (
  segundos_base integer,
  contando_desde timestamptz,
  agora_servidor timestamptz
)
language sql stable security definer set search_path = public
as $$
  select
    case
      when e.finalizado_em is not null and e.contando_desde is not null then
        coalesce(e.segundos_trabalhados, 0)::integer + greatest(0, extract(epoch from (e.finalizado_em - e.contando_desde))::integer)
      else
        coalesce(e.segundos_trabalhados, 0)::integer
    end as segundos_base,
    case
      when e.finalizado_em is not null then null
      else e.contando_desde
    end as contando_desde,
    now() as agora_servidor
  from public.execucoes e
  where e.id = p_execucao;
$$;


-- 2. Redefinição da RPC pausar_execucao
drop function if exists public.pausar_execucao(uuid);

create or replace function public.pausar_execucao(p_execucao uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec record;
  v_now timestamptz := now();
  v_adicional integer := 0;
begin
  select id, segundos_trabalhados, contando_desde
  into v_rec
  from public.execucoes
  where id = p_execucao;

  if v_rec.id is null then
    return jsonb_build_object('success', false, 'error', 'Execução não encontrada');
  end if;

  if v_rec.contando_desde is not null then
    v_adicional := extract(epoch from (v_now - v_rec.contando_desde))::integer;
    if v_adicional < 0 then
      v_adicional := 0;
    end if;

    update public.execucoes
    set segundos_trabalhados = coalesce(segundos_trabalhados, 0) + v_adicional,
        contando_desde = null,
        status = 'pausado',
        pausado_em = v_now,
        segundos_pausados = 0,
        updated_at = v_now
    where id = p_execucao;
  else
    update public.execucoes
    set status = 'pausado',
        pausado_em = v_now,
        updated_at = v_now
    where id = p_execucao;
  end if;

  return jsonb_build_object('success', true);
end;
$$;


-- 3. Redefinição da RPC retomar_execucao
drop function if exists public.retomar_execucao(uuid);

create or replace function public.retomar_execucao(p_execucao uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec record;
  v_now timestamptz := now();
begin
  select id, contando_desde
  into v_rec
  from public.execucoes
  where id = p_execucao;

  if v_rec.id is null then
    return jsonb_build_object('success', false, 'error', 'Execução não encontrada');
  end if;

  if v_rec.contando_desde is null then
    update public.execucoes
    set contando_desde = v_now,
        retomado_em = v_now,
        pausado_em = null,
        status = 'em_andamento',
        updated_at = v_now
    where id = p_execucao;
  end if;

  return jsonb_build_object('success', true);
end;
$$;


-- 4. Redefinição da RPC iniciar_execucao
drop function if exists public.iniciar_execucao(uuid);

create or replace function public.iniciar_execucao(p_agendamento uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_now timestamptz := now();
  v_exec_id uuid;
begin
  select tenant_id into v_tenant_id from public.agendamentos where id = p_agendamento;
  if v_tenant_id is null then
    return jsonb_build_object('success', false, 'error', 'Agendamento não encontrado');
  end if;

  select id into v_exec_id from public.execucoes where agendamento_id = p_agendamento;

  if v_exec_id is not null then
    update public.execucoes
    set status = 'em_andamento',
        contando_desde = coalesce(contando_desde, v_now),
        iniciado_em = coalesce(iniciado_em, v_now),
        pausado_em = null,
        finalizado_em = null,
        updated_at = v_now
    where id = v_exec_id;
  else
    insert into public.execucoes (
      tenant_id, agendamento_id, status, iniciado_em, contando_desde, segundos_trabalhados, segundos_pausados
    ) values (
      v_tenant_id, p_agendamento, 'em_andamento', v_now, v_now, 0, 0
    ) returning id into v_exec_id;
  end if;

  update public.agendamentos
  set status = 'em_andamento', updated_at = v_now
  where id = p_agendamento;

  return jsonb_build_object('success', true, 'execucao_id', v_exec_id);
end;
$$;


-- 5. Atualização da RPC fechar_resultado_execucao para usar segundos_trabalhados
drop function if exists public.fechar_resultado_execucao(uuid);

create or replace function public.fechar_resultado_execucao(
  p_execucao uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exec record;
  v_tempo_efetivo_minutos integer;
begin
  select e.id, e.segundos_trabalhados into v_exec
  from public.execucoes e
  where e.id = p_execucao;

  if v_exec.id is null then
    return;
  end if;

  v_tempo_efetivo_minutos := ceil(coalesce(v_exec.segundos_trabalhados, 0)::numeric / 60.0)::integer;
  if v_tempo_efetivo_minutos < 0 then
    v_tempo_efetivo_minutos := 0;
  end if;

  update public.execucoes
  set tempo_efetivo_minutos = v_tempo_efetivo_minutos
  where id = p_execucao;
end;
$$;


-- 6. Redefinição da RPC finalizar_execucao (Consolidação oficial de tempo)
drop function if exists public.finalizar_execucao(uuid, text);

create or replace function public.finalizar_execucao(
  p_execucao uuid,
  p_observacoes text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exec record;
  v_pendentes_count integer;
  v_pendentes_lista text;
  v_segundos_totais integer := 0;
  v_adicional integer := 0;
  v_now timestamptz := now();
  v_fim timestamptz;
  v_tempo_efetivo integer := 0;
  v_marco_inicio timestamptz;
begin
  select e.id, e.tenant_id, e.agendamento_id, e.status, e.iniciado_em, e.contando_desde, e.segundos_trabalhados, e.finalizado_em into v_exec
  from public.execucoes e
  where e.id = p_execucao;

  if v_exec.id is null then
    raise exception 'Execução não encontrada';
  end if;

  select count(*), string_agg(ei.descricao, ', ') into v_pendentes_count, v_pendentes_lista
  from public.execucao_itens ei
  where ei.execucao_id = p_execucao
    and ei.obrigatorio = true
    and ei.concluido = false;

  if v_pendentes_count > 0 then
    update public.execucoes set finalizado_em = null where id = p_execucao;
    raise exception 'Existem itens obrigatórios pendentes no checklist: %', v_pendentes_lista;
  end if;

  -- RAISE NOTICE ANTES DA CONSOLIDAÇÃO
  raise notice 'ANTES CONSOLIDAÇÃO - Execucao: %, contando_desde: %, segundos_trabalhados: %, iniciado_em: %',
    p_execucao, v_exec.contando_desde, v_exec.segundos_trabalhados, v_exec.iniciado_em;

  -- a) Marco de finalização
  v_fim := coalesce(v_exec.finalizado_em, v_now);
  v_segundos_totais := coalesce(v_exec.segundos_trabalhados, 0);

  -- Determina se há tempo em andamento a ser somado
  v_marco_inicio := v_exec.contando_desde;
  if v_marco_inicio is null and v_segundos_totais = 0 and v_exec.iniciado_em is not null then
    v_marco_inicio := v_exec.iniciado_em;
  end if;

  if v_marco_inicio is not null then
    v_adicional := extract(epoch from (v_fim - v_marco_inicio))::integer;
    if v_adicional > 0 then
      v_segundos_totais := v_segundos_totais + v_adicional;
    end if;
  end if;

  -- c) tempo_efetivo_minutos
  v_tempo_efetivo := round(v_segundos_totais::numeric / 60.0)::integer;
  if v_tempo_efetivo < 0 then
    v_tempo_efetivo := 0;
  end if;

  -- b & d) Atualização final com contando_desde = null e finalizado_em = v_fim
  update public.execucoes
  set status = 'finalizado',
      finalizado_em = v_fim,
      segundos_trabalhados = v_segundos_totais,
      contando_desde = null,
      tempo_efetivo_minutos = v_tempo_efetivo,
      observacoes_saida = coalesce(p_observacoes, observacoes_saida),
      pausado_em = null,
      updated_at = v_now
  where id = p_execucao;

  update public.agendamentos
  set status = 'concluido',
      updated_at = v_now
  where id = v_exec.agendamento_id;

  -- RAISE NOTICE DEPOIS DA CONSOLIDAÇÃO
  raise notice 'DEPOIS CONSOLIDAÇÃO - Execucao: %, finalizado_em: %, segundos_totais: %, tempo_efetivo_minutos: %',
    p_execucao, v_fim, v_segundos_totais, v_tempo_efetivo;
end;
$$;


-- 6b. Atualização da RPC finalizar_execucao_retroativo
drop function if exists public.finalizar_execucao_retroativo(uuid, timestamptz, text);

create or replace function public.finalizar_execucao_retroativo(
  p_execucao uuid,
  p_fim timestamptz,
  p_observacoes text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exec record;
  v_member_id uuid;
  v_pendentes_count integer;
  v_pendentes_lista text;
  v_adicional integer := 0;
  v_segundos_totais integer := 0;
  v_tempo_efetivo integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select e.id, e.tenant_id, e.agendamento_id, e.status, e.iniciado_em, e.contando_desde, e.segundos_trabalhados into v_exec
  from public.execucoes e
  where e.id = p_execucao;

  if v_exec.id is null then
    raise exception 'Execução não encontrada';
  end if;

  if not public.tem_papel(v_exec.tenant_id, array['dono', 'gerente']::app_role[]) then
    raise exception 'Apenas donos e gerentes têm permissão para finalizar execução com horário retroativo.';
  end if;

  if p_fim is null then
    raise exception 'Informe um horário de término válido.';
  end if;

  if p_fim < v_exec.iniciado_em then
    raise exception 'O horário de término não pode ser anterior ao horário de início.';
  end if;

  if p_fim > now() then
    raise exception 'O horário de término não pode ser no futuro.';
  end if;

  select count(*), string_agg(ei.descricao, ', ') into v_pendentes_count, v_pendentes_lista
  from public.execucao_itens ei
  where ei.execucao_id = p_execucao
    and ei.obrigatorio = true
    and ei.concluido = false;

  if v_pendentes_count > 0 then
    raise exception 'Existem itens obrigatórios pendentes no checklist: %', v_pendentes_lista;
  end if;

  select tm.id into v_member_id
  from public.tenant_members tm
  where tm.tenant_id = v_exec.tenant_id
    and tm.user_id = auth.uid()
    and tm.ativo = true
  limit 1;

  v_segundos_totais := coalesce(v_exec.segundos_trabalhados, 0);
  if v_exec.contando_desde is not null then
    v_adicional := extract(epoch from (p_fim - v_exec.contando_desde))::integer;
    if v_adicional > 0 then
      v_segundos_totais := v_segundos_totais + v_adicional;
    end if;
  end if;

  v_tempo_efetivo := round(v_segundos_totais::numeric / 60.0)::integer;
  if v_tempo_efetivo < 0 then
    v_tempo_efetivo := 0;
  end if;

  update public.execucoes e
  set finalizado_em = p_fim,
      status = 'finalizado',
      segundos_trabalhados = v_segundos_totais,
      contando_desde = null,
      tempo_efetivo_minutos = v_tempo_efetivo,
      ajuste_manual = true,
      ajustado_por = v_member_id,
      observacoes_saida = coalesce(p_observacoes, e.observacoes_saida),
      pausado_em = null,
      updated_at = now()
  where e.id = p_execucao;

  update public.agendamentos a
  set status = 'concluido',
      updated_at = now()
  where a.id = v_exec.agendamento_id;

  perform public.fechar_resultado_execucao(p_execucao);
end;
$$;


-- 6c. RPC ÚNICA E TRANSACIONAL PARA CONCLUIR ATENDIMENTO (Consolidação em Transação Única)
drop function if exists public.concluir_atendimento(uuid, jsonb, jsonb, text);

create or replace function public.concluir_atendimento(
  p_execucao uuid,
  p_valores jsonb default '[]'::jsonb,
  p_consumos jsonb default '[]'::jsonb,
  p_observacoes text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_exec record;
  v_pendentes_count integer;
  v_pendentes_lista text;
  v_now timestamptz := now();
  v_segundos_totais integer := 0;
  v_tempo_efetivo integer := 0;
  
  -- Variáveis de Consumo
  v_old_consumo record;
  v_item_c jsonb;
  v_produto_id uuid;
  v_quantidade numeric(12,2);
  v_custo_unitario numeric(12,6);
  v_custo_total numeric(12,2);

  -- Variáveis de Valores e Comissão
  v_val_item jsonb;
  v_total_final numeric(10,2) := 0.00;
  v_agendamento_item_id uuid;
  v_val_final numeric(10,2);
  v_motivo_item text;
  v_estimado numeric(10,2);
  v_executor record;
  v_comissao_calculada numeric(10,2);
begin
  -- a) Carregar execução e validar status <> 'finalizado'
  select e.id, e.tenant_id, e.agendamento_id, e.status, e.iniciado_em, e.contando_desde, e.segundos_trabalhados, e.finalizado_em
  into v_exec
  from public.execucoes e
  where e.id = p_execucao;

  if v_exec.id is null then
    raise exception 'Execução não encontrada';
  end if;

  if v_exec.status = 'finalizado' then
    raise exception 'Esta execução já se encontra finalizada.';
  end if;

  -- b) CONSOLIDAÇÃO DO TEMPO PRIMEIRO, antes de qualquer alteração de estado
  v_segundos_totais := coalesce(v_exec.segundos_trabalhados, 0);
  if v_exec.contando_desde is not null then
    v_segundos_totais := v_segundos_totais + greatest(0, extract(epoch from (v_now - v_exec.contando_desde))::integer);
  elsif v_segundos_totais = 0 and v_exec.iniciado_em is not null then
    v_segundos_totais := greatest(0, extract(epoch from (v_now - v_exec.iniciado_em))::integer);
  end if;

  -- c) Validação de itens obrigatórios pendentes do checklist (se houver, reverte a transação inteira)
  select count(*), string_agg(ei.descricao, ', ') into v_pendentes_count, v_pendentes_lista
  from public.execucao_itens ei
  where ei.execucao_id = p_execucao
    and ei.obrigatorio = true
    and ei.concluido = false;

  if v_pendentes_count > 0 then
    raise exception 'Existem itens obrigatórios pendentes no checklist: %', v_pendentes_lista;
  end if;

  -- d) Gravar estado final de execução (contando_desde = null, finalizado_em = v_now, status = 'finalizado')
  v_tempo_efetivo := round(v_segundos_totais::numeric / 60.0)::integer;
  if v_tempo_efetivo < 0 then
    v_tempo_efetivo := 0;
  end if;

  update public.execucoes
  set status = 'finalizado',
      finalizado_em = v_now,
      contando_desde = null,
      segundos_trabalhados = v_segundos_totais,
      tempo_efetivo_minutos = v_tempo_efetivo,
      observacoes_saida = coalesce(p_observacoes, observacoes_saida),
      pausado_em = null,
      updated_at = v_now
  where id = p_execucao;

  -- e) Gravar consumos e estornar estoques anteriores se houver
  for v_old_consumo in
    select produto_id, quantidade from public.execucao_consumos where execucao_id = p_execucao
  loop
    update public.produtos
    set estoque_atual = estoque_atual + v_old_consumo.quantidade
    where id = v_old_consumo.produto_id;
  end loop;

  delete from public.estoque_movimentos where execucao_id = p_execucao and tipo = 'consumo';
  delete from public.execucao_consumos where execucao_id = p_execucao;

  if p_consumos is not null and jsonb_array_length(p_consumos) > 0 then
    for v_item_c in select * from jsonb_array_elements(p_consumos)
    loop
      v_produto_id := (v_item_c->>'produto_id')::uuid;
      v_quantidade := (v_item_c->>'quantidade')::numeric;

      if v_quantidade > 0 then
        select p.custo_unitario into v_custo_unitario
        from public.produtos p
        where p.id = v_produto_id and p.tenant_id = v_exec.tenant_id;

        if v_custo_unitario is null then
          v_custo_unitario := 0;
        end if;

        v_custo_total := round(v_quantidade * v_custo_unitario, 2);

        insert into public.execucao_consumos (
          tenant_id, execucao_id, produto_id, quantidade, custo_unitario, custo_total, registrado_por
        ) values (
          v_exec.tenant_id, p_execucao, v_produto_id, v_quantidade, v_custo_unitario, v_custo_total, auth.uid()
        );

        insert into public.estoque_movimentos (
          tenant_id, produto_id, tipo, quantidade, custo_unitario, custo_total, execucao_id, criado_por
        ) values (
          v_exec.tenant_id, v_produto_id, 'consumo', -v_quantidade, v_custo_unitario, v_custo_total, p_execucao, auth.uid()
        );

        update public.produtos
        set estoque_atual = estoque_atual - v_quantidade
        where id = v_produto_id;
      end if;
    end loop;
  end if;

  -- Recalcular custo_produtos em execucoes
  update public.execucoes
  set custo_produtos = (
    select coalesce(sum(custo_total), 0)
    from public.execucao_consumos
    where execucao_id = p_execucao
  )
  where id = p_execucao;

  -- f) Gravar valores finais e valor_total_final
  if p_valores is not null and jsonb_array_length(p_valores) > 0 then
    for v_val_item in select * from jsonb_array_elements(p_valores) loop
      v_agendamento_item_id := (v_val_item->>'agendamento_item_id')::uuid;
      v_val_final := coalesce((v_val_item->>'valor_final')::numeric(10,2), 0.00);
      v_motivo_item := v_val_item->>'motivo';

      select ai.preco_estimado into v_estimado
      from public.agendamento_itens ai
      where ai.id = v_agendamento_item_id;

      insert into public.execucao_valores (
        tenant_id, execucao_id, agendamento_item_id, valor_estimado, valor_final, motivo
      ) values (
        v_exec.tenant_id, p_execucao, v_agendamento_item_id, v_estimado, v_val_final, v_motivo_item
      )
      on conflict (execucao_id, agendamento_item_id) do update
      set valor_final = EXCLUDED.valor_final,
          valor_estimado = EXCLUDED.valor_estimado,
          motivo = EXCLUDED.motivo;

      v_total_final := v_total_final + v_val_final;
    end loop;
  else
    select coalesce(sum(preco_estimado), 0.00) into v_total_final
    from public.agendamento_itens
    where agendamento_id = v_exec.agendamento_id;
  end if;

  update public.execucoes e
  set valor_total_final = v_total_final,
      valor_definido_por = auth.uid(),
      valor_definido_em = v_now,
      updated_at = v_now
  where e.id = p_execucao;

  -- Recalcular comissões dos executores
  for v_executor in (
    select ee.id, ee.member_id, cv.tipo as comissao_tipo, cv.valor as comissao_valor
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

    update public.execucao_executores
    set comissao_tipo = v_executor.comissao_tipo,
        comissao_valor = v_executor.comissao_valor,
        comissao_calculada = v_comissao_calculada
    where id = v_executor.id;
  end loop;

  -- g) Atualizar agendamento para 'concluido'
  update public.agendamentos
  set status = 'concluido',
      preco_estimado_total = v_total_final,
      updated_at = v_now
  where id = v_exec.agendamento_id;
end;
$$;

grant execute on function public.concluir_atendimento(uuid, jsonb, jsonb, text) to authenticated;


-- 7. MIGRAÇÃO DE DADOS DAS EXECUÇÕES EM ABERTO
update public.execucoes
set segundos_trabalhados = 0,
    contando_desde = case when status = 'em_andamento' then now() else null end,
    segundos_pausados = 0,
    pausado_em = null,
    retomado_em = null
where finalizado_em is null;


-- 8. CORREÇÃO DA RPC definir_valores_finais (Apenas para atendimentos JÁ finalizados)
drop function if exists public.definir_valores_finais(uuid, jsonb, text);
drop function if exists public.definir_valores_finais(uuid, jsonb);
create or replace function public.definir_valores_finais(
  p_execucao uuid,
  p_valores jsonb,
  p_motivo text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_agendamento_id uuid;
  v_status text;
  v_val_item jsonb;
  v_total_final numeric(10,2) := 0.00;
  v_agendamento_item_id uuid;
  v_val_final numeric(10,2);
  v_motivo_item text;
  v_estimado numeric(10,2);
  v_executor record;
  v_comissao_calculada numeric(10,2);
begin
  select e.tenant_id, e.agendamento_id, e.status into v_tenant_id, v_agendamento_id, v_status
  from public.execucoes e
  where e.id = p_execucao;

  if v_tenant_id is null then
    raise exception 'Execução não encontrada';
  end if;

  if v_status <> 'finalizado' then
    raise exception 'Apenas atendimentos com execução finalizada podem ter seus valores redefinidos.';
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


-- 9. RPC CANCELAR FINALIZAÇÃO (REVERTE CONGELAMENTO DO CRONÔMETRO)
drop function if exists public.cancelar_finalizacao(uuid);

create or replace function public.cancelar_finalizacao(
  p_execucao uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_exec record;
begin
  select e.id, e.agendamento_id, e.status into v_exec
  from public.execucoes e
  where e.id = p_execucao;

  if v_exec.id is null then
    return jsonb_build_object('success', false, 'error', 'Execução não encontrada');
  end if;

  if v_exec.status != 'finalizado' then
    update public.execucoes
    set finalizado_em = null,
        contando_desde = coalesce(contando_desde, v_now),
        status = 'em_andamento',
        updated_at = v_now
    where id = p_execucao;

    update public.agendamentos
    set status = 'em_andamento',
        updated_at = v_now
    where id = v_exec.agendamento_id;
  end if;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.cancelar_finalizacao(uuid) to authenticated;


-- 10. LIMPEZA E TRATAMENTO DE REGISTROS INCONSISTENTES EXISTENTES
delete from public.estoque_movimentos where execucao_id = 'ba9d9396-cdaa-4d60-b5a0-5c4fefa618de';
delete from public.execucao_consumos where execucao_id = 'ba9d9396-cdaa-4d60-b5a0-5c4fefa618de';
delete from public.execucao_valores where execucao_id = 'ba9d9396-cdaa-4d60-b5a0-5c4fefa618de';
delete from public.execucao_executores where execucao_id = 'ba9d9396-cdaa-4d60-b5a0-5c4fefa618de';
delete from public.execucao_itens where execucao_id = 'ba9d9396-cdaa-4d60-b5a0-5c4fefa618de';
delete from public.execucao_fotos where execucao_id = 'ba9d9396-cdaa-4d60-b5a0-5c4fefa618de';
delete from public.execucoes where id = 'ba9d9396-cdaa-4d60-b5a0-5c4fefa618de';
update public.agendamentos set status = 'confirmado' where id = 'e1816ee9-1474-4781-83fe-2c87c20cb631';

-- Preencher finalizado_em para qualquer outra execução legada que esteja como 'finalizado' com finalizado_em nulo
update public.execucoes
set finalizado_em = coalesce(updated_at, created_at, now())
where status = 'finalizado' and finalizado_em is null;


-- 11. RESTRICAO DE INTEGRIDADE: PROÍBE status = 'finalizado' COM finalizado_em NULO
alter table public.execucoes
  drop constraint if exists chk_execucoes_finalizado_em;

alter table public.execucoes
  add constraint chk_execucoes_finalizado_em
  check (status <> 'finalizado' or finalizado_em is not null);


-- 12. CORREÇÃO DE POLÍTICA RLS EM PRODUTOS (Leitura para todos os membros ativos da oficina)
drop policy if exists "Dono e Gerente gerenciam produtos" on public.produtos;
drop policy if exists "Membros ativos visualizam produtos" on public.produtos;
drop policy if exists "Dono e Gerente alteram produtos" on public.produtos;

create policy "Membros ativos visualizam produtos" on public.produtos
  for select using (
    tenant_id in (select public.meus_tenants())
  );

create policy "Dono e Gerente alteram produtos" on public.produtos
  for all using (
    public.tem_papel(tenant_id, array['dono', 'gerente']::app_role[])
  );
