-- Migration 0018: Backfill e correção de duração total dos agendamentos

-- 1. Garante que agendamentos com servico_id tenham linha em agendamento_itens
insert into public.agendamento_itens (
  tenant_id, agendamento_id, servico_id, combo_id,
  duracao_minutos, preco_estimado, modo_ocupacao, dias_ocupados, ordem
)
select 
  a.tenant_id,
  a.id,
  a.servico_id,
  null,
  coalesce(sp.duracao_minutos, a.duracao_minutos, 60),
  coalesce(sp.preco_base, a.preco_estimado, 0),
  coalesce(s.modo_ocupacao, 'slot'),
  coalesce(s.dias_ocupados, 1),
  0
from public.agendamentos a
join public.servicos s on s.id = a.servico_id
left join public.servico_precos sp on sp.servico_id = a.servico_id and sp.categoria_id = a.categoria_id and sp.ativo
where a.servico_id is not null
  and not exists (
    select 1 from public.agendamento_itens ai where ai.agendamento_id = a.id
  )
on conflict (agendamento_id, servico_id) do nothing;

-- 2. Recalcula os totais (duração, valor estimado, modo efetivo e dias de ocupação) para TODOS os agendamentos zerados ou nulos
do $$
declare
  v_ag record;
begin
  for v_ag in select id from public.agendamentos where duracao_total is null or duracao_total = 0 loop
    perform public.recalcular_agendamento_totais(v_ag.id);
  end loop;
end;
$$;
