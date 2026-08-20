-- 0030_atendimentos_periodo_rpc.sql
-- RPC unificada para listar atendimentos finalizados no período com os mesmos filtros do resumo_financeiro

create or replace function public.atendimentos_periodo(
  p_tenant uuid,
  p_inicio date,
  p_fim date
) returns table (
  execucao_id uuid,
  agendamento_id uuid,
  numero_os integer,
  data timestamptz,
  placa text,
  cliente text,
  servicos text,
  tempo_minutos integer,
  valor numeric,
  custo_produtos numeric,
  custo_comissao numeric,
  custo_estrutura numeric,
  lucro_liquido numeric
)
language plpgsql
security definer
stable
set search_path = public
as $$
#variable_conflict use_column
begin
  if not (p_tenant in (select public.meus_tenants())) or not public.tem_papel(p_tenant, array['dono', 'gerente']::app_role[]) then
    raise exception 'Acesso negado. Apenas dono e gerente podem visualizar atendimentos do período.';
  end if;

  return query
  select
    e.id as execucao_id,
    e.agendamento_id,
    a.numero_os,
    e.finalizado_em as data,
    coalesce(v.placa, 'Sem placa') as placa,
    coalesce(c.nome, a.cliente_nome, 'Cliente não informado') as cliente,
    coalesce(
      (
        select string_agg(s.nome, ', ')
        from public.agendamento_itens ai
        join public.servicos s on s.id = ai.servico_id
        where ai.agendamento_id = e.agendamento_id
      ),
      'Serviço'
    ) as servicos,
    coalesce(e.tempo_efetivo_minutos, 0) as tempo_minutos,
    coalesce(e.valor_total_final, 0.00) as valor,
    coalesce(e.custo_produtos, 0.00) as custo_produtos,
    coalesce(e.custo_comissao, 0.00) as custo_comissao,
    coalesce(e.custo_estrutura, 0.00) as custo_estrutura,
    coalesce(e.lucro_liquido, 0.00) as lucro_liquido
  from public.execucoes e
  join public.agendamentos a on a.id = e.agendamento_id
  left join public.clientes c on c.id = a.cliente_id
  left join public.veiculos v on v.id = a.veiculo_id
  where e.tenant_id = p_tenant
    and e.status = 'finalizado'
    and e.finalizado_em::date >= p_inicio
    and e.finalizado_em::date <= p_fim
  order by e.finalizado_em desc;
end;
$$;

grant execute on function public.atendimentos_periodo(uuid, date, date) to authenticated;
