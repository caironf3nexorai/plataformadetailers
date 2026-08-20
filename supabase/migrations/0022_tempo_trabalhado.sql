-- Migration 0022: Função tempo_trabalhado, Colunas segundos_trabalhados e retomado_em, Consolidação de Pausas, Offset de Relógio do Servidor e Recálculo Financeiro

-- 1. Colunas para registrar o tempo acumulado e o marco de retomada
alter table public.execucoes
  add column if not exists retomado_em timestamptz,
  add column if not exists segundos_trabalhados integer not null default 0;

-- 2. Função pausar_execucao (consolida o tempo trabalhado da fase atual em segundos_trabalhados)
create or replace function public.pausar_execucao(
  p_execucao uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exec record;
  v_inicio_fase timestamptz;
  v_decorrido_fase integer := 0;
begin
  select e.id, e.status, e.iniciado_em, e.retomado_em, e.segundos_trabalhados
  into v_exec
  from public.execucoes e
  where e.id = p_execucao;

  if v_exec.id is null then
    raise exception 'Execução não encontrada';
  end if;

  if v_exec.status = 'pausado' then
    return;
  end if;

  v_inicio_fase := coalesce(v_exec.retomado_em, v_exec.iniciado_em);
  if v_inicio_fase is not null then
    v_decorrido_fase := greatest(0, extract(epoch from (now() - v_inicio_fase))::integer);
  end if;

  update public.execucoes e
  set status = 'pausado',
      pausado_em = now(),
      segundos_trabalhados = coalesce(e.segundos_trabalhados, 0) + v_decorrido_fase,
      updated_at = now()
  where e.id = p_execucao;
end;
$$;

-- 3. Função retomar_execucao (limpa pausado_em e grava o novo marco em retomado_em)
create or replace function public.retomar_execucao(
  p_execucao uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exec record;
begin
  select e.id, e.status into v_exec
  from public.execucoes e
  where e.id = p_execucao;

  if v_exec.id is null then
    raise exception 'Execução não encontrada';
  end if;

  update public.execucoes e
  set status = 'em_andamento',
      pausado_em = null,
      retomado_em = now(),
      updated_at = now()
  where e.id = p_execucao;
end;
$$;

-- 4. Função tempo_trabalhado (calcula os segundos acumulados efetivos)
create or replace function public.tempo_trabalhado(
  p_execucao uuid
) returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_exec record;
  v_inicio_fase timestamptz;
  v_decorrido_fase integer := 0;
  v_total integer := 0;
  v_agora_sp timestamp;
  v_iniciado_date date;
  v_retomado_date date;
  v_esta_overnight boolean := false;
begin
  select e.id, e.tenant_id, e.iniciado_em, e.finalizado_em, e.pausado_em, e.segundos_trabalhados, e.status, e.retomado_em
  into v_exec
  from public.execucoes e
  where e.id = p_execucao;

  if v_exec.id is null or v_exec.iniciado_em is null then
    return 0;
  end if;

  v_total := coalesce(v_exec.segundos_trabalhados, 0);

  v_agora_sp := now() at time zone 'America/Sao_Paulo';
  v_iniciado_date := (v_exec.iniciado_em at time zone 'America/Sao_Paulo')::date;
  v_retomado_date := case when v_exec.retomado_em is not null then (v_exec.retomado_em at time zone 'America/Sao_Paulo')::date else null end;

  if v_iniciado_date < v_agora_sp::date and (v_retomado_date is null or v_retomado_date < v_agora_sp::date) then
    v_esta_overnight := true;
  end if;

  -- Se está em andamento e não em pernoite nem finalizado, soma a fase atual rodando
  if v_exec.status = 'em_andamento' and v_exec.finalizado_em is null and not v_esta_overnight then
    v_inicio_fase := coalesce(v_exec.retomado_em, v_exec.iniciado_em);
    if v_inicio_fase is not null then
      v_decorrido_fase := greatest(0, extract(epoch from (now() - v_inicio_fase))::integer);
      v_total := v_total + v_decorrido_fase;
    end if;
  end if;

  return greatest(0, v_total);
end;
$$;

-- 5. Função tempo_execucao (retorna segundos_base, contando_desde e agora_servidor para sincronia total de relógio)
create or replace function public.tempo_execucao(
  p_execucao uuid
) returns table (
  segundos_base integer,
  contando_desde timestamptz,
  agora_servidor timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_exec record;
  v_agora_sp timestamp;
  v_iniciado_date date;
  v_retomado_date date;
  v_esta_overnight boolean := false;
  v_agora_server timestamptz := now();
begin
  select e.id, e.iniciado_em, e.finalizado_em, e.pausado_em, e.retomado_em, e.status, e.segundos_trabalhados
  into v_exec
  from public.execucoes e
  where e.id = p_execucao;

  if v_exec.id is null or v_exec.iniciado_em is null then
    return query select 0::integer, null::timestamptz, v_agora_server;
    return;
  end if;

  v_agora_sp := v_agora_server at time zone 'America/Sao_Paulo';
  v_iniciado_date := (v_exec.iniciado_em at time zone 'America/Sao_Paulo')::date;
  v_retomado_date := case when v_exec.retomado_em is not null then (v_exec.retomado_em at time zone 'America/Sao_Paulo')::date else null end;

  if v_iniciado_date < v_agora_sp::date and (v_retomado_date is null or v_retomado_date < v_agora_sp::date) then
    v_esta_overnight := true;
  end if;

  if v_exec.finalizado_em is not null or v_exec.status = 'pausado' or v_esta_overnight then
    return query select coalesce(v_exec.segundos_trabalhados, 0), null::timestamptz, v_agora_server;
  else
    return query select coalesce(v_exec.segundos_trabalhados, 0), coalesce(v_exec.retomado_em, v_exec.iniciado_em), v_agora_server;
  end if;
end;
$$;

-- 6. Função fechar_resultado_execucao para gravar tempo_efetivo_minutos usando tempo_trabalhado
create or replace function public.fechar_resultado_execucao(
  p_execucao uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exec record;
  v_custo_minuto numeric(10,4) := 0;
  v_tempo_efetivo integer := 0;
  v_custo_estrutura numeric(10,2) := 0;
  v_faturamento numeric(10,2) := 0;
  v_custo_produtos numeric(10,2) := 0;
  v_comissao numeric(10,2) := 0;
  v_lucro_bruto numeric(10,2) := 0;
  v_lucro_liquido numeric(10,2) := 0;
begin
  select e.id, e.tenant_id, e.valor_total_final, e.iniciado_em, e.finalizado_em
  into v_exec
  from public.execucoes e
  where e.id = p_execucao;

  if v_exec.id is null or v_exec.finalizado_em is null then
    return;
  end if;

  v_tempo_efetivo := round(public.tempo_trabalhado(p_execucao) / 60.0)::integer;

  select coalesce(t.custo_minuto_estrutura, 0)
  into v_custo_minuto
  from public.tenants t
  where t.id = v_exec.tenant_id;

  v_custo_estrutura := round(v_tempo_efetivo * v_custo_minuto, 2);
  v_faturamento := coalesce(v_exec.valor_total_final, 0);

  select coalesce(sum(coalesce(c.custo_total, 0)), 0)
  into v_custo_produtos
  from public.execucao_consumo c
  where c.execucao_id = p_execucao;

  select coalesce(sum(coalesce(te.valor_comissao, 0)), 0)
  into v_comissao
  from public.execucao_tecnicos te
  where te.execucao_id = p_execucao;

  v_lucro_bruto := v_faturamento - (v_custo_produtos + v_comissao);
  v_lucro_liquido := v_lucro_bruto - v_custo_estrutura;

  update public.execucoes
  set tempo_efetivo_minutos = v_tempo_efetivo,
      custo_estrutura = v_custo_estrutura,
      custo_produtos = v_custo_produtos,
      valor_comissao_tecnicos = v_comissao,
      lucro_bruto = v_lucro_bruto,
      lucro_liquido = v_lucro_liquido,
      resultado_fechado_em = now(),
      updated_at = now()
  where id = p_execucao;
end;
$$;

-- 7. Correção de dado corrompido para a execução de teste
update public.execucoes
set segundos_pausados = 0,
    segundos_trabalhados = 0,
    pausado_em = null,
    retomado_em = now(),
    updated_at = now()
where id = 'e8f9e85d-d2b0-4272-9e21-b38b67d25518';
