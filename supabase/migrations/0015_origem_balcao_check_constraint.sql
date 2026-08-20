-- Migration 0015: Atualizar constraint agendamentos_origem_check e RPC entrada_avulsa com suporte a múltiplos itens

-- 1. CONSTRAINT AGENDAMENTOS_ORIGEM_CHECK
alter table public.agendamentos
  drop constraint if exists agendamentos_origem_check;

alter table public.agendamentos
  add constraint agendamentos_origem_check
  check (origem in ('interno', 'online', 'balcao'));

-- 2. RPC ENTRADA_AVULSA COM SUPORTE A MÚLTIPLOS ITENS E CONSULTA DE PREÇO POR CATEGORIA
drop function if exists public.entrada_avulsa(uuid, uuid, uuid, uuid, text);
drop function if exists public.entrada_avulsa(uuid, uuid, jsonb, uuid, text);

create or replace function public.entrada_avulsa(
  p_cliente uuid,
  p_veiculo uuid,
  p_itens jsonb,
  p_categoria uuid,
  p_observacoes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant uuid;
  v_user uuid;
  v_agendamento_id uuid;
  v_item jsonb;
  v_servico_id uuid;
  v_combo_id uuid;
  v_duracao integer;
  v_modo text;
  v_dias integer;
  v_preco numeric(10,2);
  v_ordem smallint := 0;
  v_primeiro_servico uuid;
begin
  -- Busca tenant do cliente
  select tenant_id into v_tenant from public.clientes where id = p_cliente;
  if not found then
    raise exception 'Cliente não encontrado.';
  end if;

  select auth.uid() into v_user;

  -- Valida acesso do usuário
  if not (v_tenant in (select meus_tenants())) or not public.tem_papel(v_tenant, array['dono', 'gerente', 'operador']::app_role[]) then
    raise exception 'Acesso negado. Usuário não é membro desta oficina.';
  end if;

  if p_itens is null or jsonb_array_length(p_itens) = 0 then
    raise exception 'Selecione ao menos um serviço para a entrada avulsa.';
  end if;

  v_servico_id := (p_itens->0->>'servico_id')::uuid;

  -- 1. Cria agendamento com status 'confirmado' e origem 'balcao'
  insert into public.agendamentos (
    tenant_id,
    cliente_id,
    veiculo_id,
    servico_id,
    categoria_id,
    inicio,
    status,
    origem,
    observacoes,
    criado_por,
    duracao_total,
    duracao_minutos,
    preco_estimado_total,
    preco_estimado,
    modo_ocupacao,
    dias_ocupados
  ) values (
    v_tenant,
    p_cliente,
    p_veiculo,
    v_servico_id,
    p_categoria,
    now(),
    'confirmado',
    'balcao',
    p_observacoes,
    v_user,
    0,
    0,
    0.00,
    0.00,
    'slot',
    1
  ) returning id into v_agendamento_id;

  -- 2. Insere os itens na tabela agendamento_itens
  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_servico_id := (v_item->>'servico_id')::uuid;
    v_combo_id := nullif(v_item->>'combo_id', '')::uuid;

    select 
      coalesce(sp.duracao_minutos, 60),
      s.modo_ocupacao,
      coalesce(s.dias_ocupados, 1),
      sp.preco_base
    into v_duracao, v_modo, v_dias, v_preco
    from public.servicos s
    left join public.servico_precos sp
      on sp.servico_id = s.id
     and sp.categoria_id = p_categoria
     and sp.ativo
    where s.id = v_servico_id and s.tenant_id = v_tenant;

    if not found then
      raise exception 'Serviço % não encontrado.', v_servico_id;
    end if;

    if v_primeiro_servico is null then
      v_primeiro_servico := v_servico_id;
    end if;

    insert into public.agendamento_itens (
      tenant_id, agendamento_id, servico_id, combo_id,
      duracao_minutos, preco_estimado, modo_ocupacao, dias_ocupados, ordem
    ) values (
      v_tenant, v_agendamento_id, v_servico_id, v_combo_id,
      v_duracao, v_preco, v_modo, v_dias, v_ordem
    );

    v_ordem := v_ordem + 1;
  end loop;

  -- Garante que o servico_id principal do agendamento esteja preenchido
  update public.agendamentos
  set servico_id = v_primeiro_servico
  where id = v_agendamento_id;

  -- 3. Recalcula totais (duração, valores, modo efetivo e dias de ocupação)
  perform public.recalcular_agendamento_totais(v_agendamento_id);

  return v_agendamento_id;
end;
$$;

grant execute on function public.entrada_avulsa(uuid, uuid, jsonb, uuid, text) to authenticated;
