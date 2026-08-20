-- Migration 0026: Módulo Financeiro (Despesas Fixas, Custo/Hora, Lucro Real e Comissões)

create extension if not exists btree_gist;

-- 1. Tabela despesas_fixas
create table if not exists public.despesas_fixas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nome text not null,
  categoria text not null default 'Geral' check (categoria in ('Instalacao', 'Pessoal', 'Servicos', 'Impostos', 'Outros', 'Geral')),
  tipo text not null default 'recorrente' check (tipo in ('recorrente', 'parcelada', 'variavel')),
  total_parcelas smallint,
  parcela_inicial smallint default 1,
  valor_mensal numeric(10,2) not null check (valor_mensal >= 0),
  vigencia_inicio date not null,
  vigencia_fim date,
  confirmado boolean not null default true,
  confirmado_em timestamptz,
  confirmado_por uuid references auth.users(id),
  despesa_pai_id uuid references public.despesas_fixas(id) on delete set null,
  criado_por uuid not null references auth.users(id),
  created_at timestamptz default now()
);

-- Garantir alter table e constraints para bancos já existentes
alter table public.despesas_fixas drop constraint if exists despesas_fixas_tipo_check;
alter table public.despesas_fixas add constraint despesas_fixas_tipo_check check (tipo in ('recorrente', 'parcelada', 'variavel'));

alter table public.despesas_fixas
  add column if not exists confirmado boolean not null default true,
  add column if not exists confirmado_em timestamptz,
  add column if not exists confirmado_por uuid references auth.users(id),
  add column if not exists despesa_pai_id uuid references public.despesas_fixas(id) on delete set null;

-- Constraint de não sobreposição por nome dentro da mesma oficina
alter table public.despesas_fixas drop constraint if exists despesa_sem_sobreposicao;
alter table public.despesas_fixas add constraint despesa_sem_sobreposicao
  exclude using gist (
    tenant_id with =,
    nome with =,
    daterange(vigencia_inicio, coalesce(vigencia_fim, 'infinity'::date), '[)') with &&
  );

-- Trigger de imutabilidade para despesas_fixas (permite confirmar despesas variáveis pendentes)
create or replace function public.trg_despesas_fixas_imutabilidade()
returns trigger
language plpgsql
security definer
set search_path = public
create or replace function public.trg_despesas_fixas_imutabilidade()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'UPDATE' then
    -- Permite editar nome e categoria livremente.
    -- Bloqueia alterações em tenant_id, tipo, parcelas, vigencia_inicio e criado_por
    if OLD.tenant_id <> NEW.tenant_id or
       OLD.tipo <> NEW.tipo or
       coalesce(OLD.total_parcelas, 0) <> coalesce(NEW.total_parcelas, 0) or
       coalesce(OLD.parcela_inicial, 0) <> coalesce(NEW.parcela_inicial, 0) or
       OLD.vigencia_inicio <> NEW.vigencia_inicio or
       OLD.criado_por <> NEW.criado_por then
      raise exception 'Alteração rejeitada: tenant, tipo, parcelamento, vigência inicial e criador de despesas fixas são imutáveis.';
    end if;

    -- Se for tentativa de alteração de valor_mensal direta sem ser conta variável pendente
    if OLD.valor_mensal <> NEW.valor_mensal then
      if not (OLD.tipo = 'variavel' and OLD.confirmado = false) and (OLD.created_at::date <> current_date) then
        raise exception 'Alteração rejeitada: para alterar valores de vigência ativa, utilize a opção "Atualizar valor" para preservar o histórico.';
      end if;
    end if;
  end if;

  if TG_OP = 'INSERT' then
    if NEW.vigencia_inicio < date_trunc('month', current_date)::date then
      raise exception 'Não é permitido cadastrar despesas fixas com vigência anterior ao mês corrente.';
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_despesas_fixas_imutabilidade on public.despesas_fixas;
create trigger trg_despesas_fixas_imutabilidade
  before insert or update on public.despesas_fixas
  for each row execute function public.trg_despesas_fixas_imutabilidade();


-- 2. Novas colunas na tabela execucoes (todas com add column if not exists)
alter table public.execucoes
  add column if not exists custo_comissao numeric(10,2) not null default 0,
  add column if not exists tempo_efetivo_minutos integer,
  add column if not exists custo_hora_aplicado numeric(10,2),
  add column if not exists custo_estrutura numeric(10,2) not null default 0,
  add column if not exists lucro_bruto numeric(10,2),
  add column if not exists lucro_liquido numeric(10,2);


-- 2.1 Função para gerar automaticamente despesas variáveis do mês a partir do mês anterior
create or replace function public.obter_ou_gerar_despesas_mes(
  p_tenant uuid,
  p_mes date
) returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_inicio_mes date := date_trunc('month', p_mes)::date;
  v_fim_mes date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_inicio_mes_ant date := (date_trunc('month', p_mes) - interval '1 month')::date;
  v_fim_mes_ant date := (date_trunc('month', p_mes) - interval '1 day')::date;
  v_rec record;
  v_pai_id uuid;
begin
  for v_rec in
    select d.*
    from public.despesas_fixas d
    where d.tenant_id = p_tenant
      and d.tipo = 'variavel'
      and d.vigencia_inicio <= v_fim_mes_ant
      and (d.vigencia_fim is null or d.vigencia_fim >= v_inicio_mes_ant)
      and not exists (
        select 1 from public.despesas_fixas d_atual
        where d_atual.tenant_id = p_tenant
          and d_atual.tipo = 'variavel'
          and (
            d_atual.id = d.id 
            or d_atual.despesa_pai_id = coalesce(d.despesa_pai_id, d.id)
            or lower(trim(d_atual.nome)) = lower(trim(d.nome))
          )
          and d_atual.vigencia_inicio <= v_fim_mes
          and (d_atual.vigencia_fim is null or d_atual.vigencia_fim >= v_inicio_mes)
      )
  loop
    v_pai_id := coalesce(v_rec.despesa_pai_id, v_rec.id);

    insert into public.despesas_fixas (
      tenant_id,
      nome,
      categoria,
      tipo,
      valor_mensal,
      vigencia_inicio,
      vigencia_fim,
      confirmado,
      confirmado_em,
      confirmado_por,
      despesa_pai_id,
      criado_por
    ) values (
      p_tenant,
      v_rec.nome,
      v_rec.categoria,
      'variavel',
      v_rec.valor_mensal,
      v_inicio_mes,
      v_fim_mes,
      false, -- aguardando confirmacao
      null,
      null,
      v_pai_id,
      v_rec.criado_por
    );
  end loop;
end;
$$;

-- 2.2 RPC para confirmar despesas variáveis em lote
create or replace function public.confirmar_despesas_variaveis_lote(
  p_itens jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_item jsonb;
  v_id uuid;
  v_valor numeric(10,2);
  v_tenant uuid;
begin
  if p_itens is null or jsonb_array_length(p_itens) = 0 then
    return;
  end if;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_id := (v_item->>'id')::uuid;
    v_valor := coalesce((v_item->>'valor')::numeric(10,2), 0.00);

    select tenant_id into v_tenant from public.despesas_fixas where id = v_id;
    if found then
      if not (v_tenant in (select public.meus_tenants())) or not public.tem_papel(v_tenant, array['dono', 'gerente']::app_role[]) then
        raise exception 'Acesso negado.';
      end if;

      update public.despesas_fixas
      set valor_mensal = v_valor,
          confirmado = true,
          confirmado_em = now(),
          confirmado_por = auth.uid()
      where id = v_id;
    end if;
  end loop;
end;
$$;

grant execute on function public.confirmar_despesas_variaveis_lote(jsonb) to authenticated;
grant execute on function public.obter_ou_gerar_despesas_mes(uuid, date) to authenticated;


-- 3. Função para calcular horas disponíveis no mês (descontando bloqueios de agenda em America/Sao_Paulo)
create or replace function public.horas_disponiveis_mes(
  p_tenant uuid,
  p_mes date
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_inicio_mes date := date_trunc('month', p_mes)::date;
  v_fim_mes date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_curr date;
  v_dow integer;
  v_horario record;
  v_janela_inicio timestamptz;
  v_janela_fim timestamptz;
  v_janela_segundos numeric;
  v_bloqueio_segundos numeric;
  v_liquido_segundos numeric;
  v_horas_dia numeric := 0;
  v_total_horas numeric := 0;
begin
  -- Garante que despesas variáveis do mês anterior foram clonadas como estimativa para o mês atual
  perform public.obter_ou_gerar_despesas_mes(p_tenant, p_mes);
  v_curr := v_inicio_mes;
  while v_curr <= v_fim_mes loop
    v_dow := extract(dow from v_curr)::integer;

    select hf.ativo, hf.abre, hf.fecha, hf.capacidade
    into v_horario
    from public.horarios_funcionamento hf
    where hf.tenant_id = p_tenant and hf.dia_semana = v_dow;

    if v_horario.ativo = true and v_horario.abre is not null and v_horario.fecha is not null then
      v_janela_inicio := (v_curr || ' ' || v_horario.abre)::timestamp at time zone 'America/Sao_Paulo';
      v_janela_fim := (v_curr || ' ' || v_horario.fecha)::timestamp at time zone 'America/Sao_Paulo';

      if v_janela_fim > v_janela_inicio then
        v_janela_segundos := extract(epoch from (v_janela_fim - v_janela_inicio));

        -- Calcula a soma dos segundos de interseção dos bloqueios com o expediente do dia
        select coalesce(sum(
          extract(epoch from (
            least(ba.fim, v_janela_fim) - greatest(ba.inicio, v_janela_inicio)
          ))
        ), 0)
        into v_bloqueio_segundos
        from public.bloqueios_agenda ba
        where ba.tenant_id = p_tenant
          and ba.inicio < v_janela_fim
          and ba.fim > v_janela_inicio;

        v_liquido_segundos := greatest(0, v_janela_segundos - v_bloqueio_segundos);
        v_horas_dia := (v_liquido_segundos / 3600.0) * coalesce(v_horario.capacidade, 1);
        v_total_horas := v_total_horas + v_horas_dia;
      end if;
    end if;

    v_curr := v_curr + 1;
  end loop;

  return round(v_total_horas, 2);
end;
$$;


-- 4. Função para custo por hora de operação
create or replace function public.custo_hora_operacao(
  p_tenant uuid,
  p_mes date
) returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_inicio_mes date := date_trunc('month', p_mes)::date;
  v_fim_mes date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_horas_disp numeric := 0;
  v_total_despesas numeric := 0;
begin
  v_horas_disp := public.horas_disponiveis_mes(p_tenant, p_mes);
  if v_horas_disp <= 0 then
    return 0.00;
  end if;

  select coalesce(sum(df.valor_mensal), 0.00)
  into v_total_despesas
  from public.despesas_fixas df
  where df.tenant_id = p_tenant
    and df.vigencia_inicio <= v_fim_mes
    and (df.vigencia_fim is null or df.vigencia_fim >= v_inicio_mes);

  if v_total_despesas <= 0 then
    return 0.00;
  end if;

  return round(v_total_despesas / v_horas_disp, 2);
end;
$$;


-- 5. Função fechar_resultado_execucao (Snapshot financeiro de cada atendimento)
create or replace function public.fechar_resultado_execucao(
  p_execucao uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_exec record;
  v_tempo_efetivo integer := 0;
  v_custo_hora numeric(10,2) := 0;
  v_custo_estrutura numeric(10,2) := 0;
  v_faturamento numeric(10,2) := 0;
  v_custo_produtos numeric(10,2) := 0;
  v_custo_comissao numeric(10,2) := 0;
  v_lucro_bruto numeric(10,2) := 0;
  v_lucro_liquido numeric(10,2) := 0;
  v_data_ref date;
begin
  select e.id, e.tenant_id, e.agendamento_id, e.valor_total_final, e.tempo_efetivo_minutos,
         e.segundos_trabalhados, e.iniciado_em, e.finalizado_em
  into v_exec
  from public.execucoes e
  where e.id = p_execucao;

  if v_exec.id is null then
    return;
  end if;

  v_tempo_efetivo := coalesce(v_exec.tempo_efetivo_minutos, round(coalesce(v_exec.segundos_trabalhados, 0)::numeric / 60.0)::integer);

  if v_tempo_efetivo is null or v_tempo_efetivo <= 0 then
    select coalesce(a.duracao_total, a.duracao_minutos, 60)
    into v_tempo_efetivo
    from public.agendamentos a
    where a.id = v_exec.agendamento_id;
  end if;

  if v_tempo_efetivo is null or v_tempo_efetivo <= 0 then
    v_tempo_efetivo := 60;
  end if;

  v_data_ref := date_trunc('month', coalesce(v_exec.finalizado_em, now()))::date;
  v_custo_hora := public.custo_hora_operacao(v_exec.tenant_id, v_data_ref);

  v_custo_estrutura := round((v_custo_hora * (v_tempo_efetivo::numeric / 60.0)), 2);
  v_faturamento := coalesce(v_exec.valor_total_final, 0.00);

  select coalesce(sum(ec.custo_total), 0.00)
  into v_custo_produtos
  from public.execucao_consumos ec
  where ec.execucao_id = p_execucao;

  select coalesce(sum(ee.comissao_calculada), 0.00)
  into v_custo_comissao
  from public.execucao_executores ee
  where ee.execucao_id = p_execucao;

  v_lucro_bruto := v_faturamento - (v_custo_produtos + v_custo_comissao);
  v_lucro_liquido := v_lucro_bruto - v_custo_estrutura;

  update public.execucoes
  set tempo_efetivo_minutos = v_tempo_efetivo,
      custo_hora_aplicado = v_custo_hora,
      custo_estrutura = v_custo_estrutura,
      custo_produtos = v_custo_produtos,
      custo_comissao = v_custo_comissao,
      lucro_bruto = v_lucro_bruto,
      lucro_liquido = v_lucro_liquido,
      updated_at = now()
  where id = p_execucao;
end;
$$;


-- 6. Atualização de concluir_atendimento para invocar fechar_resultado_execucao ao final
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
  
  v_old_consumo record;
  v_item_c jsonb;
  v_produto_id uuid;
  v_quantidade numeric(12,2);
  v_custo_unitario numeric(12,6);
  v_custo_total numeric(12,2);

  v_val_item jsonb;
  v_total_final numeric(10,2) := 0.00;
  v_agendamento_item_id uuid;
  v_val_final numeric(10,2);
  v_motivo_item text;
  v_estimado numeric(10,2);
  v_executor record;
  v_comissao_calculada numeric(10,2);
begin
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

  v_segundos_totais := coalesce(v_exec.segundos_trabalhados, 0);
  if v_exec.contando_desde is not null then
    v_segundos_totais := v_segundos_totais + greatest(0, extract(epoch from (v_now - v_exec.contando_desde))::integer);
  elsif v_segundos_totais = 0 and v_exec.iniciado_em is not null then
    v_segundos_totais := greatest(0, extract(epoch from (v_now - v_exec.iniciado_em))::integer);
  end if;

  select count(*), string_agg(ei.descricao, ', ') into v_pendentes_count, v_pendentes_lista
  from public.execucao_itens ei
  where ei.execucao_id = p_execucao
    and ei.obrigatorio = true
    and ei.concluido = false;

  if v_pendentes_count > 0 then
    raise exception 'Existem itens obrigatórios pendentes no checklist: %', v_pendentes_lista;
  end if;

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

  update public.execucoes
  set custo_produtos = (
    select coalesce(sum(custo_total), 0)
    from public.execucao_consumos
    where execucao_id = p_execucao
  )
  where id = p_execucao;

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

  for v_executor in (
    select ee.id, ee.member_id, cv.tipo as comissao_tipo, cv.valor as comissao_valor
    from public.execucao_executores ee
    cross join lateral public.comissao_vigente(ee.member_id, (v_now at time zone 'America/Sao_Paulo')::date) cv
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

  update public.agendamentos
  set status = 'concluido',
      preco_estimado_total = v_total_final,
      updated_at = v_now
  where id = v_exec.agendamento_id;

  -- Chamada síncrona do fechamento de resultado financeiro
  perform public.fechar_resultado_execucao(p_execucao);
end;
$$;


-- 7. Função resumo_financeiro (Acumulado da cascata, métricas e ocupação)
create or replace function public.resumo_financeiro(
  p_tenant uuid,
  p_inicio date,
  p_fim date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_faturamento numeric := 0;
  v_custo_produtos numeric := 0;
  v_custo_comissao numeric := 0;
  v_custo_estrutura numeric := 0;
  v_lucro_bruto numeric := 0;
  v_lucro_liquido numeric := 0;
  v_margem_bruta numeric := 0;
  v_margem_liquida numeric := 0;
  v_atendimentos_count integer := 0;
  v_ticket_medio numeric := 0;
  v_horas_trabalhadas numeric := 0;
  v_custo_hora_medio numeric := 0;
  v_horas_disponiveis numeric := 0;
  v_has_despesas boolean := false;
  v_total_despesas_pendentes numeric := 0;
  v_despesas_pendentes_count integer := 0;

  v_dias integer;
  v_ant_inicio date;
  v_ant_fim date;
  v_ant_faturamento numeric := 0;
  v_ant_lucro_liquido numeric := 0;
  v_ant_atendimentos integer := 0;
  v_variacao_faturamento numeric := 0;
  v_variacao_lucro numeric := 0;
  v_variacao_atendimentos numeric := 0;
begin
  if not (p_tenant in (select public.meus_tenants())) or not public.tem_papel(p_tenant, array['dono', 'gerente']::app_role[]) then
    raise exception 'Acesso negado. Apenas dono e gerente podem visualizar o resumo financeiro.';
  end if;

  -- Garante a clonagem estimativa de despesas variáveis do mês
  perform public.obter_ou_gerar_despesas_mes(p_tenant, date_trunc('month', p_inicio)::date);

  select exists (
    select 1 from public.despesas_fixas df where df.tenant_id = p_tenant
  ) into v_has_despesas;

  select coalesce(sum(valor_mensal), 0), count(*)
  into v_total_despesas_pendentes, v_despesas_pendentes_count
  from public.despesas_fixas
  where tenant_id = p_tenant
    and tipo = 'variavel'
    and confirmado = false
    and vigencia_inicio <= p_fim
    and (vigencia_fim is null or vigencia_fim >= p_inicio);

  select
    coalesce(sum(e.valor_total_final), 0),
    coalesce(sum(e.custo_produtos), 0),
    coalesce(sum(e.custo_comissao), 0),
    coalesce(sum(e.custo_estrutura), 0),
    coalesce(sum(e.lucro_bruto), 0),
    coalesce(sum(e.lucro_liquido), 0),
    count(e.id),
    coalesce(sum(e.tempo_efetivo_minutos), 0) / 60.0
  into
    v_faturamento, v_custo_produtos, v_custo_comissao, v_custo_estrutura,
    v_lucro_bruto, v_lucro_liquido, v_atendimentos_count, v_horas_trabalhadas
  from public.execucoes e
  where e.tenant_id = p_tenant
    and e.status = 'finalizado'
    and e.finalizado_em::date >= p_inicio
    and e.finalizado_em::date <= p_fim;

  if v_faturamento > 0 then
    v_margem_bruta := round((v_lucro_bruto / v_faturamento) * 100.0, 1);
    v_margem_liquida := round((v_lucro_liquido / v_faturamento) * 100.0, 1);
  end if;

  if v_atendimentos_count > 0 then
    v_ticket_medio := round(v_faturamento / v_atendimentos_count, 2);
  end if;

  v_custo_hora_medio := public.custo_hora_operacao(p_tenant, date_trunc('month', p_inicio)::date);
  v_horas_disponiveis := public.horas_disponiveis_mes(p_tenant, date_trunc('month', p_inicio)::date);

  v_dias := (p_fim - p_inicio) + 1;
  v_ant_fim := p_inicio - 1;
  v_ant_inicio := v_ant_fim - v_dias + 1;

  select
    coalesce(sum(e.valor_total_final), 0),
    coalesce(sum(e.lucro_liquido), 0),
    count(e.id)
  into v_ant_faturamento, v_ant_lucro_liquido, v_ant_atendimentos
  from public.execucoes e
  where e.tenant_id = p_tenant
    and e.status = 'finalizado'
    and e.finalizado_em::date >= v_ant_inicio
    and e.finalizado_em::date <= v_ant_fim;

  if v_ant_faturamento > 0 then
    v_variacao_faturamento := round(((v_faturamento - v_ant_faturamento) / v_ant_faturamento) * 100.0, 1);
  end if;

  if v_ant_lucro_liquido <> 0 then
    v_variacao_lucro := round(((v_lucro_liquido - v_ant_lucro_liquido) / abs(v_ant_lucro_liquido)) * 100.0, 1);
  end if;

  if v_ant_atendimentos > 0 then
    v_variacao_atendimentos := round(((v_atendimentos_count - v_ant_atendimentos)::numeric / v_ant_atendimentos::numeric) * 100.0, 1);
  end if;

  return jsonb_build_object(
    'faturamento', v_faturamento,
    'custo_produtos', v_custo_produtos,
    'custo_comissao', v_custo_comissao,
    'lucro_bruto', v_lucro_bruto,
    'margem_bruta', v_margem_bruta,
    'custo_estrutura', v_custo_estrutura,
    'lucro_liquido', v_lucro_liquido,
    'margem_liquida', v_margem_liquida,
    'atendimentos_count', v_atendimentos_count,
    'ticket_medio', v_ticket_medio,
    'horas_trabalhadas', round(v_horas_trabalhadas, 1),
    'horas_disponiveis', round(v_horas_disponiveis, 1),
    'custo_hora_medio', v_custo_hora_medio,
    'tem_despesas', v_has_despesas,
    'total_despesas_pendentes', v_total_despesas_pendentes,
    'despesas_pendentes_count', v_despesas_pendentes_count,
    'comparativo', jsonb_build_object(
      'ant_faturamento', v_ant_faturamento,
      'ant_lucro_liquido', v_ant_lucro_liquido,
      'ant_atendimentos', v_ant_atendimentos,
      'variacao_faturamento', v_variacao_faturamento,
      'variacao_lucro', v_variacao_lucro,
      'variacao_atendimentos', v_variacao_atendimentos
    )
  );
end;
$$;


-- 8. Função rentabilidade_por_servico (Lucro por hora e margem)
create or replace function public.rentabilidade_por_servico(
  p_tenant uuid,
  p_inicio date,
  p_fim date
) returns table (
  servico_id uuid,
  servico_nome text,
  servico_codigo text,
  quantidade integer,
  faturamento_total numeric,
  custo_medio numeric,
  lucro_liquido_total numeric,
  lucro_liquido_medio numeric,
  margem_percentual numeric,
  tempo_medio_minutos integer,
  lucro_por_hora numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not (p_tenant in (select public.meus_tenants())) or not public.tem_papel(p_tenant, array['dono', 'gerente']::app_role[]) then
    raise exception 'Acesso negado.';
  end if;

  return query
  -- RATEIO PROPORCIONAL: Quando um atendimento possui múltiplos serviços (agendamento_itens),
  -- os valores globais da execução (faturamento, custos e lucro líquido) são rateados
  -- proporcionalmente com base no preco_estimado de cada item sobre o total do agendamento.
  -- Isso evita duplicação de faturamento/lucro ao agrupar por serviço.
  with itens_rateados as (
    select
      e.id as execucao_id,
      ai.servico_id,
      s.nome as servico_nome,
      s.codigo as servico_codigo,
      coalesce(
        ai.duracao_minutos,
        round(coalesce(e.tempo_efetivo_minutos, 60)::numeric * (
          case 
            when coalesce(tot.total_estimado, 0) > 0 then
              coalesce(ai.preco_estimado, 0) / tot.total_estimado
            else
              1.0 / count(*) over(partition by e.id)
          end
        ))
      )::integer as tempo_item,
      coalesce(e.valor_total_final, 0) * (
        case 
          when coalesce(tot.total_estimado, 0) > 0 then
            coalesce(ai.preco_estimado, 0) / tot.total_estimado
          else
            1.0 / count(*) over(partition by e.id)
        end
      ) as faturamento_item,
      (coalesce(e.custo_produtos, 0) + coalesce(e.custo_comissao, 0) + coalesce(e.custo_estrutura, 0)) * (
        case 
          when coalesce(tot.total_estimado, 0) > 0 then
            coalesce(ai.preco_estimado, 0) / tot.total_estimado
          else
            1.0 / count(*) over(partition by e.id)
        end
      ) as custo_item,
      coalesce(e.lucro_liquido, 0) * (
        case 
          when coalesce(tot.total_estimado, 0) > 0 then
            coalesce(ai.preco_estimado, 0) / tot.total_estimado
          else
            1.0 / count(*) over(partition by e.id)
        end
      ) as lucro_liquido_item
    from public.execucoes e
    join public.agendamentos a on a.id = e.agendamento_id
    join public.agendamento_itens ai on ai.agendamento_id = a.id
    join public.servicos s on s.id = ai.servico_id
    join lateral (
      select nullif(sum(coalesce(ai2.preco_estimado, 0)), 0) as total_estimado
      from public.agendamento_itens ai2
      where ai2.agendamento_id = a.id
    ) tot on true
    where e.tenant_id = p_tenant
      and e.status = 'finalizado'
      and e.finalizado_em::date >= p_inicio
      and e.finalizado_em::date <= p_fim
  )
  select
    ir.servico_id,
    ir.servico_nome,
    ir.servico_codigo,
    count(distinct ir.execucao_id)::integer as quantidade,
    round(coalesce(sum(ir.faturamento_item), 0), 2)::numeric as faturamento_total,
    round(coalesce(avg(ir.custo_item), 0), 2)::numeric as custo_medio,
    round(coalesce(sum(ir.lucro_liquido_item), 0), 2)::numeric as lucro_liquido_total,
    round(coalesce(avg(ir.lucro_liquido_item), 0), 2)::numeric as lucro_liquido_medio,
    case
      when sum(ir.faturamento_item) > 0 then round((sum(ir.lucro_liquido_item) / sum(ir.faturamento_item)) * 100.0, 1)
      else 0.0
    end::numeric as margem_percentual,
    round(coalesce(avg(ir.tempo_item), 0))::integer as tempo_medio_minutos,
    case
      when sum(coalesce(ir.tempo_item, 0)) > 0 then
        round(sum(ir.lucro_liquido_item) / (sum(ir.tempo_item)::numeric / 60.0), 2)
      else 0.0
    end::numeric as lucro_por_hora
  from itens_rateados ir
  group by ir.servico_id, ir.servico_nome, ir.servico_codigo;
end;
$$;


-- 9. Função comissoes_a_pagar
create or replace function public.comissoes_a_pagar(
  p_tenant uuid,
  p_inicio date,
  p_fim date
) returns table (
  member_id uuid,
  nome text,
  servicos integer,
  total numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not (p_tenant in (select public.meus_tenants())) or not public.tem_papel(p_tenant, array['dono']::app_role[]) then
    raise exception 'Acesso negado. Apenas o dono pode acessar comissões a pagar.';
  end if;

  return query
  select
    ee.member_id,
    coalesce(nullif(trim(p.nome), ''), tm.email) as nome,
    count(distinct ee.execucao_id)::integer as servicos,
    coalesce(sum(ee.comissao_calculada), 0)::numeric as total
  from public.execucao_executores ee
  join public.execucoes e on e.id = ee.execucao_id
  join public.tenant_members tm on tm.id = ee.member_id
  left join public.profiles p on p.id = tm.user_id
  where e.tenant_id = p_tenant
    and e.status = 'finalizado'
    and e.finalizado_em::date >= p_inicio
    and e.finalizado_em::date <= p_fim
  group by ee.member_id, tm.email, p.nome;
end;
$$;


-- 10. Função de recálculo de pendentes
create or replace function public.recalcular_resultados_pendentes(
  p_tenant uuid default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exec record;
  v_count integer := 0;
begin
  for v_exec in
    select id from public.execucoes
    where status = 'finalizado'
      and (p_tenant is null or tenant_id = p_tenant)
      and lucro_liquido is null
  loop
    perform public.fechar_resultado_execucao(v_exec.id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;


-- 10.1 RPC para criar nova vigência de valor mensal para uma despesa
create or replace function public.nova_vigencia_despesa(
  p_despesa uuid,
  p_valor numeric,
  p_inicio date
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_despesa public.despesas_fixas%rowtype;
  v_fim_antiga date;
  v_nova_id uuid;
  v_pai_id uuid;
begin
  select * into v_despesa
  from public.despesas_fixas
  where id = p_despesa;

  if not found then
    raise exception 'Despesa não encontrada.';
  end if;

  if not (v_despesa.tenant_id in (select public.meus_tenants())) or not public.tem_papel(v_despesa.tenant_id, array['dono']::app_role[]) then
    raise exception 'Acesso negado. Apenas o proprietário pode alterar valores de despesas.';
  end if;

  if p_valor is null or p_valor <= 0 then
    raise exception 'Informe um valor mensal válido maior que zero.';
  end if;

  if p_inicio < v_despesa.vigencia_inicio then
    raise exception 'A nova vigência precisa começar depois do início da atual.';
  end if;

  -- Se p_inicio for exatamente igual à vigencia_inicio da atual, substitui o valor
  if p_inicio = v_despesa.vigencia_inicio then
    update public.despesas_fixas
    set valor_mensal = p_valor,
        confirmado = true,
        confirmado_em = now(),
        confirmado_por = auth.uid()
    where id = v_despesa.id;

    return v_despesa.id;
  end if;

  -- Se p_inicio > v_despesa.vigencia_inicio, encerra a anterior 1 dia antes
  v_fim_antiga := (p_inicio - interval '1 day')::date;

  if v_fim_antiga < v_despesa.vigencia_inicio then
    raise exception 'A nova vigência precisa começar depois do início da atual.';
  end if;

  -- 1. Encerrar a vigência anterior
  update public.despesas_fixas
  set vigencia_fim = v_fim_antiga
  where id = v_despesa.id;

  -- 2. Criar o novo registro de vigência
  v_pai_id := coalesce(v_despesa.despesa_pai_id, v_despesa.id);

  insert into public.despesas_fixas (
    tenant_id,
    nome,
    categoria,
    tipo,
    total_parcelas,
    parcela_inicial,
    valor_mensal,
    vigencia_inicio,
    vigencia_fim,
    confirmado,
    confirmado_em,
    confirmado_por,
    despesa_pai_id,
    criado_por
  ) values (
    v_despesa.tenant_id,
    v_despesa.nome,
    v_despesa.categoria,
    v_despesa.tipo,
    v_despesa.total_parcelas,
    v_despesa.parcela_inicial,
    p_valor,
    p_inicio,
    v_despesa.vigencia_fim,
    true,
    now(),
    auth.uid(),
    v_pai_id,
    auth.uid()
  ) returning id into v_nova_id;

  return v_nova_id;
exception
  when exclusion_violation then
    raise exception 'Já existe uma despesa com este nome vigente neste período.';
  when range_error then
    raise exception 'A nova vigência precisa começar depois do início da atual.';
end;
$$;

-- 10.2 RPC para corrigir erro de digitação no lançamento de hoje
create or replace function public.corrigir_despesa_fixa(
  p_despesa uuid,
  p_nome text,
  p_categoria text,
  p_tipo text,
  p_valor numeric,
  p_vigencia_inicio date,
  p_total_parcelas integer default null,
  p_parcela_inicial integer default 1
) returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_despesa public.despesas_fixas%rowtype;
  v_exec_count integer := 0;
begin
  select * into v_despesa
  from public.despesas_fixas
  where id = p_despesa;

  if not found then
    raise exception 'Despesa não encontrada.';
  end if;

  if not (v_despesa.tenant_id in (select public.meus_tenants())) or not public.tem_papel(v_despesa.tenant_id, array['dono']::app_role[]) then
    raise exception 'Acesso negado.';
  end if;

  if v_despesa.created_at::date <> current_date then
    raise exception 'Apenas lançamentos criados hoje podem ser corrigidos integralmente.';
  end if;

  select count(*) into v_exec_count
  from public.execucoes e
  where e.tenant_id = v_despesa.tenant_id
    and e.status = 'finalizado'
    and coalesce(e.custo_hora_aplicado, 0) > 0
    and e.updated_at > v_despesa.created_at
    and e.finalizado_em::date >= v_despesa.vigencia_inicio
    and (v_despesa.vigencia_fim is null or e.finalizado_em::date <= v_despesa.vigencia_fim);

  if v_exec_count > 0 then
    raise exception 'Esta despesa já foi usada no cálculo de % atendimento(s) concluído(s). Para alterar o valor, use "Atualizar valor" — o histórico será preservado.', v_exec_count;
  end if;

  update public.despesas_fixas
  set nome = trim(p_nome),
      categoria = p_categoria,
      tipo = p_tipo,
      valor_mensal = p_valor,
      vigencia_inicio = p_vigencia_inicio,
      total_parcelas = case when p_tipo = 'parcelada' then p_total_parcelas else null end,
      parcela_inicial = case when p_tipo = 'parcelada' then p_parcela_inicial else 1 end
  where id = p_despesa;
end;
$$;

-- 10.3 RPC para excluir despesa criada hoje sem fechamentos
create or replace function public.excluir_despesa_fixa(
  p_despesa uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_despesa public.despesas_fixas%rowtype;
  v_exec_count integer := 0;
begin
  select * into v_despesa
  from public.despesas_fixas
  where id = p_despesa;

  if not found then
    raise exception 'Despesa não encontrada.';
  end if;

  if not (v_despesa.tenant_id in (select public.meus_tenants())) or not public.tem_papel(v_despesa.tenant_id, array['dono']::app_role[]) then
    raise exception 'Acesso negado.';
  end if;

  if v_despesa.created_at::date <> current_date then
    raise exception 'Apenas despesas criadas hoje podem ser excluídas. Para despesas mais antigas, utilize a opção "Encerrar".';
  end if;

  select count(*) into v_exec_count
  from public.execucoes e
  where e.tenant_id = v_despesa.tenant_id
    and e.status = 'finalizado'
    and coalesce(e.custo_hora_aplicado, 0) > 0
    and e.updated_at > v_despesa.created_at
    and e.finalizado_em::date >= v_despesa.vigencia_inicio
    and (v_despesa.vigencia_fim is null or e.finalizado_em::date <= v_despesa.vigencia_fim);

  if v_exec_count > 0 then
    raise exception 'Esta despesa já foi usada no cálculo de % atendimento(s) concluído(s). Para alterar o valor, use "Atualizar valor" — o histórico será preservado.', v_exec_count;
  end if;

  delete from public.despesas_fixas where id = p_despesa;
end;
$$;

-- 10.4 RPC para encerrar vigência de despesa no final do mês corrente
create or replace function public.encerrar_despesa_fixa(
  p_despesa uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_despesa public.despesas_fixas%rowtype;
  v_fim_mes date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
begin
  select * into v_despesa
  from public.despesas_fixas
  where id = p_despesa;

  if not found then
    raise exception 'Despesa não encontrada.';
  end if;

  if not (v_despesa.tenant_id in (select public.meus_tenants())) or not public.tem_papel(v_despesa.tenant_id, array['dono']::app_role[]) then
    raise exception 'Acesso negado.';
  end if;

  if v_despesa.vigencia_fim is not null and v_despesa.vigencia_fim <= v_fim_mes then
    raise exception 'Esta despesa já se encontra encerrada.';
  end if;

  update public.despesas_fixas
  set vigencia_fim = v_fim_mes
  where id = p_despesa;
end;
$$;


-- 11. RLS e Grants
alter table public.despesas_fixas enable row level security;

drop policy if exists despesas_fixas_select on public.despesas_fixas;
create policy despesas_fixas_select on public.despesas_fixas
  for select to authenticated
  using (tenant_id in (select public.meus_tenants()) and public.tem_papel(tenant_id, array['dono']::app_role[]));

drop policy if exists despesas_fixas_insert on public.despesas_fixas;
create policy despesas_fixas_insert on public.despesas_fixas
  for insert to authenticated
  with check (tenant_id in (select public.meus_tenants()) and public.tem_papel(tenant_id, array['dono']::app_role[]));

drop policy if exists despesas_fixas_update on public.despesas_fixas;
create policy despesas_fixas_update on public.despesas_fixas
  for update to authenticated
  using (tenant_id in (select public.meus_tenants()) and public.tem_papel(tenant_id, array['dono']::app_role[]))
  with check (tenant_id in (select public.meus_tenants()) and public.tem_papel(tenant_id, array['dono']::app_role[]));

grant execute on function public.horas_disponiveis_mes(uuid, date) to authenticated;
grant execute on function public.custo_hora_operacao(uuid, date) to authenticated;
grant execute on function public.fechar_resultado_execucao(uuid) to authenticated;
grant execute on function public.resumo_financeiro(uuid, date, date) to authenticated;
grant execute on function public.rentabilidade_por_servico(uuid, date, date) to authenticated;
grant execute on function public.comissoes_a_pagar(uuid, date, date) to authenticated;
grant execute on function public.recalcular_resultados_pendentes(uuid) to authenticated;
grant execute on function public.nova_vigencia_despesa(uuid, numeric, date) to authenticated;
grant execute on function public.corrigir_despesa_fixa(uuid, text, text, text, numeric, date, integer, integer) to authenticated;
grant execute on function public.excluir_despesa_fixa(uuid) to authenticated;
grant execute on function public.encerrar_despesa_fixa(uuid) to authenticated;

-- 12. Execução inicial de recálculo dos atendimentos concluídos anteriormente
select public.recalcular_resultados_pendentes(null);
