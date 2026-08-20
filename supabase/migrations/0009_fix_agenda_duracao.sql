-- Migration 0009: Correção do Join de Duração de Serviços em servico_precos

-- 1. RPC horarios_disponiveis corrigida
create or replace function public.horarios_disponiveis(
  p_tenant uuid,
  p_data date,
  p_servico uuid,
  p_categoria uuid,
  p_ignorar_agendamento uuid default null
) returns table (
  horario time,
  disponivel boolean,
  motivo text
)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_dia_semana smallint;
  v_horario_func record;
  v_grade_minutos smallint;
  v_duracao_minutos integer;
  v_modo_ocupacao text;
  v_dias_ocupados integer;
  v_posicao_inicio timestamptz;
  v_posicao_fim timestamptz;
  v_slot_time time;
  v_fechamento_ts timestamptz;
  v_agora_sp timestamptz;
  v_sobrepoem_bloqueio boolean;
  v_sobrepoem_dia_reservado boolean;
  v_qtd_agendamentos_ativos integer;
  v_total_agendamentos_dia integer;
  v_pos_index integer;
  v_is_disponivel boolean;
  v_motivo_indisponivel text;
begin
  -- Dia da semana extraído diretamente da date local (0=Dom, 1=Seg... 6=Sáb)
  v_dia_semana := extract(dow from p_data)::smallint;

  select * into v_horario_func
  from public.horarios_funcionamento h
  where h.tenant_id = p_tenant and h.dia_semana = v_dia_semana and h.ativo;

  -- Se a oficina não abre neste dia da semana, retorna 0 linhas
  if not found then
    return;
  end if;

  select coalesce(t.grade_minutos, 60) into v_grade_minutos
  from public.tenants t where t.id = p_tenant;

  -- duracao_minutos vive na tabela servico_precos (categoria x serviço)
  -- modo_ocupacao e dias_ocupados pertencem à tabela raiz servicos
  select 
    coalesce(sp.duracao_minutos, 60),
    s.modo_ocupacao,
    coalesce(s.dias_ocupados, 1)
  into v_duracao_minutos, v_modo_ocupacao, v_dias_ocupados
  from public.servicos s
  left join public.servico_precos sp
    on sp.servico_id = s.id
   and sp.categoria_id = p_categoria
   and sp.ativo
  where s.id = p_servico and s.tenant_id = p_tenant;

  if not found then
    return;
  end if;

  v_agora_sp := now() at time zone 'America/Sao_Paulo';

  -- Total de agendamentos no dia para verificar exclusividade de dia_inteiro
  select count(*) into v_total_agendamentos_dia
  from public.agendamentos a
  where a.tenant_id = p_tenant
    and a.status not in ('cancelado', 'nao_compareceu')
    and (p_ignorar_agendamento is null or a.id <> p_ignorar_agendamento)
    and (a.inicio at time zone 'America/Sao_Paulo')::date <= p_data
    and ((a.inicio at time zone 'America/Sao_Paulo')::date + (a.dias_ocupados - 1)) >= p_data;

  v_slot_time := v_horario_func.abre;
  v_fechamento_ts := (p_data || ' ' || v_horario_func.fecha)::timestamp at time zone 'America/Sao_Paulo';
  v_pos_index := 0;

  while v_slot_time <= (v_horario_func.fecha - (v_grade_minutos || ' minutes')::interval) loop
    v_pos_index := v_pos_index + 1;
    v_posicao_inicio := (p_data || ' ' || v_slot_time)::timestamp at time zone 'America/Sao_Paulo';
    v_posicao_fim := v_posicao_inicio + (v_duracao_minutos || ' minutes')::interval;

    v_is_disponivel := true;
    v_motivo_indisponivel := null;

    -- Regra 1: Serviço dia_inteiro exige ser a 1ª posição e que o dia esteja totalmente livre
    if v_modo_ocupacao = 'dia_inteiro' then
      if v_pos_index > 1 then
        v_is_disponivel := false;
        v_motivo_indisponivel := 'dia_inteiro';
      elsif v_total_agendamentos_dia > 0 then
        v_is_disponivel := false;
        v_motivo_indisponivel := 'dia_reservado';
      end if;
    end if;

    -- Regra 2: Duração ultrapassa horário de fechamento
    if v_is_disponivel and v_posicao_fim > v_fechamento_ts then
      v_is_disponivel := false;
      v_motivo_indisponivel := 'nao_cabe_no_expediente';
    end if;

    -- Regra 3: Posição passada no dia de hoje
    if v_is_disponivel and v_posicao_inicio < v_agora_sp then
      v_is_disponivel := false;
      v_motivo_indisponivel := 'passado';
    end if;

    -- Regra 4: Sobreposição com bloqueios de agenda
    if v_is_disponivel then
      select exists(
        select 1 from public.bloqueios_agenda b
        where b.tenant_id = p_tenant
          and b.inicio < v_posicao_fim
          and b.fim > v_posicao_inicio
      ) into v_sobrepoem_bloqueio;

      if v_sobrepoem_bloqueio then
        v_is_disponivel := false;
        v_motivo_indisponivel := 'bloqueado';
      end if;
    end if;

    -- Regra 5: Sobreposição com agendamentos dia_inteiro ou multiplos_dias
    if v_is_disponivel then
      select exists(
        select 1 from public.agendamentos a
        where a.tenant_id = p_tenant
          and a.status not in ('cancelado', 'nao_compareceu')
          and (p_ignorar_agendamento is null or a.id <> p_ignorar_agendamento)
          and a.modo_ocupacao in ('dia_inteiro', 'multiplos_dias')
          and (a.inicio at time zone 'America/Sao_Paulo')::date <= p_data
          and ((a.inicio at time zone 'America/Sao_Paulo')::date + (a.dias_ocupados - 1)) >= p_data
      ) into v_sobrepoem_dia_reservado;

      if v_sobrepoem_dia_reservado then
        v_is_disponivel := false;
        v_motivo_indisponivel := 'dia_reservado';
      end if;
    end if;

    -- Regra 6: Capacidade de boxes simultâneos no horário
    if v_is_disponivel then
      select count(*) into v_qtd_agendamentos_ativos
      from public.agendamentos a
      where a.tenant_id = p_tenant
        and a.status not in ('cancelado', 'nao_compareceu')
        and (p_ignorar_agendamento is null or a.id <> p_ignorar_agendamento)
        and a.inicio < v_posicao_fim
        and (a.inicio + (a.duracao_minutos || ' minutes')::interval) > v_posicao_inicio;

      if v_qtd_agendamentos_ativos >= v_horario_func.capacidade then
        v_is_disponivel := false;
        v_motivo_indisponivel := 'sem_box_livre';
      end if;
    end if;

    horario := v_slot_time;
    disponivel := v_is_disponivel;
    motivo := v_motivo_indisponivel;
    return next;

    v_slot_time := (v_slot_time + (v_grade_minutos || ' minutes')::interval)::time;
  end loop;
end;
$$;

-- 2. RPC criar_agendamento corrigida
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
  v_is_valido boolean := false;
  v_agendamento_id uuid;
begin
  select tenant_id into v_tenant from public.clientes where id = p_cliente;
  if not found then
    raise exception 'Cliente não encontrado.';
  end if;

  if not (v_tenant in (select meus_tenants())) or not public.tem_papel(v_tenant, array['dono', 'gerente']::app_role[]) then
    raise exception 'Apenas donos ou gerentes podem realizar agendamentos.';
  end if;

  v_data := (p_inicio at time zone 'America/Sao_Paulo')::date;
  v_hora := (p_inicio at time zone 'America/Sao_Paulo')::time;

  -- ADVISORY LOCK TRANSACIONAL CONTRA CONDIÇÃO DE CORRIDA
  perform pg_advisory_xact_lock(hashtext(v_tenant::text || ':' || v_data::text));

  -- Revalida disponibilidade na data/hora exata
  select disponivel into v_is_valido
  from public.horarios_disponiveis(v_tenant, v_data, p_servico, p_categoria, null) hd
  where hd.horario = v_hora;

  if not coalesce(v_is_valido, false) then
    raise exception 'Este horário não está mais disponível. Escolha outro.';
  end if;

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
