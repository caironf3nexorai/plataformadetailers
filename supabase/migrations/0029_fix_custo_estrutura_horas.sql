-- 0029_fix_custo_estrutura_horas.sql
-- Correção do cálculo do Custo de Estrutura por minutos reais e suporte a minutos em resumo_financeiro

-- 1. Redefinição da RPC fechar_resultado_execucao
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

  -- 1. Determina minutos efetivos reais (usando tempo_efetivo_minutos se > 0, ou ceil dos segundos)
  v_tempo_efetivo := coalesce(nullif(v_exec.tempo_efetivo_minutos, 0), ceil(coalesce(v_exec.segundos_trabalhados, 0)::numeric / 60.0)::integer);

  -- 2. Fallback para duração estimada do agendamento se minutos ainda zerados
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

  -- 3. Custo de estrutura proporcional aos minutos reais (v_tempo_efetivo / 60.0)
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

grant execute on function public.fechar_resultado_execucao(uuid) to authenticated;


-- 2. Redefinição da RPC resumo_financeiro incluindo minutos_trabalhados e maior precisão
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
  v_minutos_trabalhados integer := 0;
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
    coalesce(sum(e.tempo_efetivo_minutos), 0)
  into
    v_faturamento, v_custo_produtos, v_custo_comissao, v_custo_estrutura,
    v_lucro_bruto, v_lucro_liquido, v_atendimentos_count, v_minutos_trabalhados
  from public.execucoes e
  where e.tenant_id = p_tenant
    and e.status = 'finalizado'
    and e.finalizado_em::date >= p_inicio
    and e.finalizado_em::date <= p_fim;

  v_horas_trabalhadas := round(v_minutos_trabalhados::numeric / 60.0, 2);

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
    'minutos_trabalhados', v_minutos_trabalhados,
    'horas_trabalhadas', v_horas_trabalhadas,
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

grant execute on function public.resumo_financeiro(uuid, date, date) to authenticated;

-- 3. Recálculo retroativo de todas as execuções finalizadas
do $$
declare
  r record;
begin
  for r in select id from public.execucoes where status = 'finalizado' loop
    perform public.fechar_resultado_execucao(r.id);
  end loop;
end;
$$;
