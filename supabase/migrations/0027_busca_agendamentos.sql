-- Migration 0027: RPC para Filtros, Busca de Agendamentos e Histórico de Atendimentos

-- 1. ADICIONA ÍNDICES PARA BUSCA E FILTRAGEM DE AGENDAMENTOS
create index if not exists idx_agendamentos_tenant_status on public.agendamentos(tenant_id, status);
create index if not exists idx_agendamentos_tenant_inicio on public.agendamentos(tenant_id, inicio);
create index if not exists idx_agendamentos_cliente_id on public.agendamentos(cliente_id);
create index if not exists idx_agendamentos_veiculo_id on public.agendamentos(veiculo_id);

-- 2. RECRIA A RPC buscar_agendamentos COM SUPORTE A CLIENTE_ID E VEICULO_ID
drop function if exists public.buscar_agendamentos(uuid, date, date, text[], text, integer, integer);
drop function if exists public.buscar_agendamentos(uuid, date, date, text[], text, uuid, uuid, integer, integer);

create or replace function public.buscar_agendamentos(
  p_tenant uuid,
  p_inicio date default null,
  p_fim date default null,
  p_status text[] default null,
  p_busca text default null,
  p_cliente_id uuid default null,
  p_veiculo_id uuid default null,
  p_limite integer default 30,
  p_offset integer default 0
) returns table (
  id uuid,
  tenant_id uuid,
  cliente_id uuid,
  veiculo_id uuid,
  servico_id uuid,
  categoria_id uuid,
  inicio timestamptz,
  duracao_minutos integer,
  duracao_total integer,
  modo_ocupacao text,
  modo_ocupacao_efetivo text,
  dias_ocupados smallint,
  preco_estimado numeric,
  preco_estimado_total numeric,
  status text,
  origem text,
  observacoes text,
  numero_os integer,
  forcado boolean,
  created_at timestamptz,
  updated_at timestamptz,
  cliente jsonb,
  veiculo jsonb,
  servico jsonb,
  categoria jsonb,
  agendamento_itens jsonb,
  execucao jsonb,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
#variable_conflict use_column
declare
  v_busca_limpa text;
  v_busca_num integer := null;
  v_dono_inicio date := null;
  v_dono_fim date := null;
  v_target_cliente uuid := p_cliente_id;
begin
  -- Valida se o usuário logado é membro ativo do tenant
  if not (p_tenant in (select public.meus_tenants())) then
    raise exception 'Acesso negado.';
  end if;

  -- Trata busca textual e extrai números para comparar com numero_os
  if p_busca is not null and trim(p_busca) <> '' then
    v_busca_limpa := trim(p_busca);
    
    declare
      v_digits text := regexp_replace(lower(v_busca_limpa), '[^0-9]', '', 'g');
    begin
      if v_digits <> '' then
        v_busca_num := v_digits::integer;
      end if;
    exception when others then
      v_busca_num := null;
    end;
  end if;

  -- Se p_veiculo_id for fornecido, descobre o período de propriedade para respeitar privacidade entre proprietários
  if p_veiculo_id is not null then
    if v_target_cliente is null then
      select vd.cliente_id, vd.inicio, vd.fim
      into v_target_cliente, v_dono_inicio, v_dono_fim
      from public.veiculo_donos vd
      where vd.veiculo_id = p_veiculo_id
      order by case when vd.fim is null then 0 else 1 end, vd.inicio desc
      limit 1;
    else
      select vd.inicio, vd.fim
      into v_dono_inicio, v_dono_fim
      from public.veiculo_donos vd
      where vd.veiculo_id = p_veiculo_id and vd.cliente_id = v_target_cliente
      order by vd.inicio desc
      limit 1;
    end if;
  end if;

  return query
  with base as (
    select
      a.id,
      a.tenant_id,
      a.cliente_id,
      a.veiculo_id,
      a.servico_id,
      a.categoria_id,
      a.inicio,
      a.duracao_minutos,
      coalesce(a.duracao_total, a.duracao_minutos) as duracao_total,
      a.modo_ocupacao,
      coalesce(a.modo_ocupacao_efetivo, a.modo_ocupacao) as modo_ocupacao_efetivo,
      a.dias_ocupados,
      a.preco_estimado,
      coalesce(a.preco_estimado_total, a.preco_estimado) as preco_estimado_total,
      a.status,
      a.origem,
      a.observacoes,
      a.numero_os,
      coalesce(a.forcado, false) as forcado,
      a.created_at,
      a.updated_at,
      to_jsonb(c.*) as cliente,
      case when v.id is not null then to_jsonb(v.*) else null end as veiculo,
      case when s.id is not null then to_jsonb(s.*) else null end as servico,
      case when cat.id is not null then to_jsonb(cat.*) else null end as categoria,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', ai.id,
              'agendamento_id', ai.agendamento_id,
              'servico_id', ai.servico_id,
              'duracao_minutos', ai.duracao_minutos,
              'preco_estimado', ai.preco_estimado,
              'ordem', ai.ordem,
              'servicos', to_jsonb(s_item.*)
            ) order by ai.ordem asc
          )
          from public.agendamento_itens ai
          left join public.servicos s_item on s_item.id = ai.servico_id
          where ai.agendamento_id = a.id
        ),
        '[]'::jsonb
      ) as agendamento_itens,
      case when ex.id is not null then to_jsonb(ex.*) else null end as execucao,
      count(*) over() as total_count
    from public.agendamentos a
    join public.clientes c on c.id = a.cliente_id
    left join public.veiculos v on v.id = a.veiculo_id
    left join public.servicos s on s.id = a.servico_id
    left join public.categorias_veiculo cat on cat.id = a.categoria_id
    left join public.execucoes ex on ex.agendamento_id = a.id
    where a.tenant_id = p_tenant
      and (p_cliente_id is null or a.cliente_id = p_cliente_id)
      and (p_veiculo_id is null or (
            a.veiculo_id = p_veiculo_id
            and (v_dono_inicio is null or (a.inicio at time zone 'America/Sao_Paulo')::date >= v_dono_inicio)
            and (v_dono_fim is null or (a.inicio at time zone 'America/Sao_Paulo')::date <= v_dono_fim)
          ))
      and (p_inicio is null or (a.inicio at time zone 'America/Sao_Paulo')::date >= p_inicio)
      and (p_fim is null or (a.inicio at time zone 'America/Sao_Paulo')::date <= p_fim)
      and (p_status is null or cardinality(p_status) = 0 or a.status = any(p_status))
      and (
        v_busca_limpa is null
        or (v_busca_num is not null and a.numero_os = v_busca_num)
        or (v.placa ilike '%' || v_busca_limpa || '%')
        or (c.nome ilike '%' || v_busca_limpa || '%')
        or (c.telefone ilike '%' || v_busca_limpa || '%')
        or (a.observacoes ilike '%' || v_busca_limpa || '%')
      )
    order by a.inicio desc
  )
  select *
  from base
  limit p_limite
  offset p_offset;
end;
$$;

grant execute on function public.buscar_agendamentos(uuid, date, date, text[], text, uuid, uuid, integer, integer) to authenticated;


-- 3. ATUALIZA HISTÓRICO DE CONSUMO POR VEÍCULO PARA RESPEITAR O HISTÓRICO DE PROPRIEDADE
create or replace function public.historico_consumo_veiculo(p_veiculo uuid)
returns table (
  execucao_id uuid,
  concluido_em timestamptz,
  servicos_nomes text,
  produto_nome text,
  produto_marca text,
  quantidade numeric,
  unidade_uso text,
  custo_unitario numeric,
  custo_total numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant_id uuid;
  v_dono_inicio date;
  v_dono_fim date;
begin
  if auth.uid() is null then
    return;
  end if;

  select v.tenant_id into v_tenant_id from public.veiculos v where v.id = p_veiculo;

  if not public.tem_papel(v_tenant_id, array['dono', 'gerente']::app_role[]) then
    return;
  end if;

  -- Descobre o proprietário atual e o período vigente para não vazar consumos de proprietários anteriores
  select vd.inicio, vd.fim
  into v_dono_inicio, v_dono_fim
  from public.veiculo_donos vd
  where vd.veiculo_id = p_veiculo
  order by case when vd.fim is null then 0 else 1 end, vd.inicio desc
  limit 1;

  return query
  select
    e.id as execucao_id,
    e.finalizado_em as concluido_em,
    coalesce((
      select string_agg(s.nome, ', ')
      from public.agendamento_itens ai
      join public.servicos s on s.id = ai.servico_id
      where ai.agendamento_id = e.agendamento_id
    ), 'Serviço') as servicos_nomes,
    p.nome as produto_nome,
    p.marca as produto_marca,
    ec.quantidade,
    p.unidade_uso,
    ec.custo_unitario,
    ec.custo_total
  from public.execucoes e
  join public.agendamentos a on a.id = e.agendamento_id
  join public.execucao_consumos ec on ec.execucao_id = e.id
  join public.produtos p on p.id = ec.produto_id
  where a.veiculo_id = p_veiculo
    and (v_dono_inicio is null or (a.inicio at time zone 'America/Sao_Paulo')::date >= v_dono_inicio)
    and (v_dono_fim is null or (a.inicio at time zone 'America/Sao_Paulo')::date <= v_dono_fim)
  order by e.finalizado_em desc nulls last, ec.created_at desc;
end;
$$;

grant execute on function public.historico_consumo_veiculo(uuid) to authenticated;
