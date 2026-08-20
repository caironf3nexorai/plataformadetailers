-- Migration 0010: Correção de criar_agendamento e reagendar (Validação por horarios_disponiveis, Duração e Fuso Horário)

-- 1. RPC criar_agendamento
create or replace function public.criar_agendamento(
  p_cliente uuid,
  p_veiculo uuid,
  p_servico uuid,
  p_categoria uuid,
  p_inicio timestamptz,
  p_observacoes text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant uuid;
  v_duracao_minutos integer;
  v_modo_ocupacao text;
  v_dias_ocupados integer;
  v_preco numeric(10,2);
  v_data date;
  v_hora time;
  v_slot record;
  v_agendamento_id uuid;
begin
  select tenant_id into v_tenant from public.clientes where id = p_cliente;
  if not found then
    raise exception 'Cliente não encontrado.';
  end if;

  if not (v_tenant in (select meus_tenants())) or not public.tem_papel(v_tenant, array['dono', 'gerente']::app_role[]) then
    raise exception 'Apenas donos ou gerentes podem realizar agendamentos.';
  end if;

  -- 3. COMPARAÇÃO DE HORÁRIO: extrai data e hora local em America/Sao_Paulo
  v_data := (p_inicio at time zone 'America/Sao_Paulo')::date;
  v_hora := date_trunc('minute', (p_inicio at time zone 'America/Sao_Paulo'))::time;

  -- ADVISORY LOCK TRANSACIONAL CONTRA CONDIÇÃO DE CORRIDA
  perform pg_advisory_xact_lock(hashtext(v_tenant::text || ':' || v_data::text));

  -- 2. REVALIDE CHAMANDO A MESMA FUNÇÃO (horarios_disponiveis)
  select disponivel, motivo into v_slot
  from public.horarios_disponiveis(v_tenant, v_data, p_servico, p_categoria, null) hd
  where hd.horario = v_hora;

  -- 4. MENSAGEM DE ERRO ÚTIL
  if not found then
    raise exception 'Horário fora da grade de atendimento.';
  end if;

  if not coalesce(v_slot.disponivel, false) then
    raise exception 'Horário indisponível: %', coalesce(v_slot.motivo, 'indisponivel');
  end if;

  -- 1. MESMA CORREÇÃO DE DURAÇÃO: lê duracao_minutos de servico_precos (filtrando por categoria), fallback 60
  select 
    coalesce(sp.duracao_minutos, 60),
    s.modo_ocupacao,
    coalesce(s.dias_ocupados, 1),
    sp.preco_base
  into v_duracao_minutos, v_modo_ocupacao, v_dias_ocupados, v_preco
  from public.servicos s
  left join public.servico_precos sp
    on sp.servico_id = s.id
   and sp.categoria_id = p_categoria
   and sp.ativo
  where s.id = p_servico and s.tenant_id = v_tenant;

  if not found then
    raise exception 'Serviço não encontrado.';
  end if;

  insert into public.agendamentos (
    tenant_id, cliente_id, veiculo_id, servico_id, categoria_id,
    inicio, duracao_minutos, modo_ocupacao, dias_ocupados, preco_estimado,
    status, origem, observacoes, criado_por
  ) values (
    v_tenant, p_cliente, p_veiculo, p_servico, p_categoria,
    p_inicio, v_duracao_minutos, v_modo_ocupacao, v_dias_ocupados, v_preco,
    'agendado', 'interno', p_observacoes, auth.uid()
  ) returning id into v_agendamento_id;

  return v_agendamento_id;
end;
$$;

grant execute on function public.criar_agendamento(uuid, uuid, uuid, uuid, timestamptz, text) to authenticated;

-- 2. RPC reagendar
create or replace function public.reagendar(
  p_agendamento uuid,
  p_novo_inicio timestamptz
) returns void
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_agendamento record;
  v_duracao_minutos integer;
  v_data date;
  v_hora time;
  v_slot record;
begin
  select * into v_agendamento from public.agendamentos where id = p_agendamento;
  if not found then
    raise exception 'Agendamento não encontrado.';
  end if;

  if not public.tem_papel(v_agendamento.tenant_id, array['dono', 'gerente']::app_role[]) then
    raise exception 'Apenas donos ou gerentes podem reagendar.';
  end if;

  -- 3. COMPARAÇÃO DE HORÁRIO: extrai data e hora local em America/Sao_Paulo
  v_data := (p_novo_inicio at time zone 'America/Sao_Paulo')::date;
  v_hora := date_trunc('minute', (p_novo_inicio at time zone 'America/Sao_Paulo'))::time;

  -- ADVISORY LOCK TRANSACIONAL CONTRA CONDIÇÃO DE CORRIDA
  perform pg_advisory_xact_lock(hashtext(v_agendamento.tenant_id::text || ':' || v_data::text));

  -- 2. REVALIDE CHAMANDO A MESMA FUNÇÃO (horarios_disponiveis)
  select disponivel, motivo into v_slot
  from public.horarios_disponiveis(
    v_agendamento.tenant_id,
    v_data,
    v_agendamento.servico_id,
    v_agendamento.categoria_id,
    p_agendamento
  ) hd
  where hd.horario = v_hora;

  -- 4. MENSAGEM DE ERRO ÚTIL
  if not found then
    raise exception 'Horário fora da grade de atendimento.';
  end if;

  if not coalesce(v_slot.disponivel, false) then
    raise exception 'Horário indisponível: %', coalesce(v_slot.motivo, 'indisponivel');
  end if;

  -- 1. MESMA CORREÇÃO DE DURAÇÃO: lê duracao_minutos de servico_precos (filtrando por categoria), fallback 60
  select coalesce(sp.duracao_minutos, 60)
  into v_duracao_minutos
  from public.servicos s
  left join public.servico_precos sp
    on sp.servico_id = s.id
   and sp.categoria_id = v_agendamento.categoria_id
   and sp.ativo
  where s.id = v_agendamento.servico_id and s.tenant_id = v_agendamento.tenant_id;

  update public.agendamentos
  set inicio = p_novo_inicio,
      duracao_minutos = coalesce(v_duracao_minutos, v_agendamento.duracao_minutos, 60),
      updated_at = now()
  where id = p_agendamento;
end;
$$;

grant execute on function public.reagendar(uuid, timestamptz) to authenticated;
