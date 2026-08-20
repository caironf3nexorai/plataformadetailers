-- Migration 0048: Helper de Diagnóstico Profundo dos Agendamentos do Database

create or replace function public.listar_todos_agendamentos_debug(p_tenant uuid default null)
returns table (
  id uuid,
  tenant_id uuid,
  inicio timestamptz,
  duracao_minutos integer,
  duracao_total integer,
  modo_ocupacao text,
  modo_ocupacao_efetivo text,
  dias_ocupados smallint,
  status text,
  origem text,
  created_at timestamptz,
  servico_nome text,
  cliente_nome text
)
language plpgsql security definer set search_path = public
as $$
begin
  return query
  select 
    a.id,
    a.tenant_id,
    a.inicio,
    a.duracao_minutos,
    a.duracao_total,
    a.modo_ocupacao,
    a.modo_ocupacao_efetivo,
    a.dias_ocupados,
    a.status,
    a.origem,
    a.created_at,
    s.nome as servico_nome,
    c.nome as cliente_nome
  from public.agendamentos a
  left join public.servicos s on s.id = a.servico_id
  left join public.clientes c on c.id = a.cliente_id
  where (p_tenant is null or a.tenant_id = p_tenant)
  order by a.inicio desc;
end;
$$;

grant execute on function public.listar_todos_agendamentos_debug(uuid) to anon, authenticated;
