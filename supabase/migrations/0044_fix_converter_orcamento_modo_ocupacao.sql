-- Migration 0044: Consolidação Definitiva de RPCs e Sobrecargas da Agenda
-- Atualiza constraints, sobrecargas de horarios_disponiveis, criar_agendamento, reagendar, remover_item_agendamento e converter_orcamento_em_agendamento.

-- 1. CONSTRAINT AGENDAMENTOS_ORIGEM_CHECK (Aceita 'interno', 'online', 'balcao', 'orcamento')
do $$
begin
  alter table public.agendamentos drop constraint if exists agendamentos_origem_check;
  alter table public.agendamentos add constraint agendamentos_origem_check
    check (origem in ('interno', 'online', 'balcao', 'orcamento'));
exception
  when others then null;
end;
$$;

-- 2. DROPS PREVENTIVOS DAS ASSINATURAS ANTERIORES PARA EVITAR ERRO 42P13
drop function if exists public.horarios_disponiveis(uuid, date, jsonb, uuid, uuid);
drop function if exists public.horarios_disponiveis(uuid, date, uuid, uuid, uuid);
drop function if exists public.remover_item_agendamento(uuid, uuid);
drop function if exists public.remover_item_agendamento(uuid, uuid, uuid);
drop function if exists public.criar_agendamento(uuid, uuid, jsonb, uuid, timestamptz, text, boolean);
drop function if exists public.criar_agendamento(uuid, uuid, uuid, uuid, timestamptz, text, boolean);
drop function if exists public.reagendar(uuid, timestamptz);
drop function if exists public.converter_orcamento_em_agendamento(uuid, timestamptz);

-- 3. SOBRECARGA 1 DA RPC HORARIOS_DISPONIVEIS (Payload JSONB)
create or replace function public.horarios_disponiveis(
  p_tenant uuid,
  p_data date,
  p_itens jsonb default null,
  p_categoria uuid default null,
  p_ignorar_agendamento uuid default null
) returns table (
  horario time,
  disponivel boolean,
  motivo text,
  termino_previsto timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_dia_semana smallint;
  v_horario_func record;
  v_grade_minutos smallint;
  v_duracao_total_itens integer := 0;
  v_modo_efetivo text := 'slot';
  v_max_dias integer := 1;
  v_item jsonb;
  v_servico_id uuid;
  v_dur_item integer;
  v_modo_item text;
  v_dias_item integer;
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

  v_minutos_restantes integer;
  v_calc_date date;
  v_calc_dow smallint;
  v_calc_horario record;
  v_calc_start timestamptz;
  v_janela_minutos integer;
begin
  v_dia_semana := extract(dow from p_data)::smallint;

  select * into v_horario_func
  from public.horarios_funcionamento h
  where h.tenant_id = p_tenant and h.dia_semana = v_dia_semana and h.ativo;

  if not found then
    return;
  end if;

  select coalesce(t.grade_minutos, 60) into v_grade_minutos
  from public.tenants t where t.id = p_tenant;

  if p_itens is not null and jsonb_array_length(p_itens) > 0 then
    for v_item in select * from jsonb_array_elements(p_itens) loop
      v_servico_id := (v_item->>'servico_id')::uuid;

      select 
        coalesce(sp.duracao_minutos, 60),
        coalesce(s.modo_ocupacao, 'slot'),
        coalesce(s.dias_ocupados, 1)
      into v_dur_item, v_modo_item, v_dias_item
      from public.servicos s
      left join public.servico_precos sp
        on sp.servico_id = s.id
       and sp.categoria_id = p_categoria
       and sp.ativo
      where s.id = v_servico_id and s.tenant_id = p_tenant;

      if found then
        v_duracao_total_itens := v_duracao_total_itens + v_dur_item;
        if v_dias_item > v_max_dias then v_max_dias := v_dias_item; end if;
        
        if v_modo_item = 'multiplos_dias' then
          v_modo_efetivo := 'multiplos_dias';
        elsif v_modo_item = 'dia_inteiro' and v_modo_efetivo <> 'multiplos_dias' then
          v_modo_efetivo := 'dia_inteiro';
        elsif v_modo_item = 'transborda' and v_modo_efetivo not in ('multiplos_dias', 'dia_inteiro') then
          v_modo_efetivo := 'transborda';
        end if;
      end if;
    end loop;
  end if;

  if v_duracao_total_itens = 0 then
    v_duracao_total_itens := 60;
  end if;

  v_agora_sp := now() at time zone 'America/Sao_Paulo';

  select count(*) into v_total_agendamentos_dia
  from public.agendamentos a
  where a.tenant_id = p_tenant
    and a.status not in ('cancelado', 'nao_compareceu')
    and (p_ignorar_agendamento is null or a.id <> p_ignorar_agendamento)
    and (a.inicio at time zone 'America/Sao_Paulo')::date <= p_data
    and ((a.inicio at time zone 'America/Sao_Paulo')::date + (coalesce(a.dias_ocupados, 1) - 1)) >= p_data;

  v_slot_time := v_horario_func.abre;
  v_fechamento_ts := (p_data || ' ' || v_horario_func.fecha)::timestamp at time zone 'America/Sao_Paulo';
  v_pos_index := 0;

  while v_slot_time <= (v_horario_func.fecha - (v_grade_minutos || ' minutes')::interval) loop
    v_pos_index := v_pos_index + 1;
    v_posicao_inicio := (p_data || ' ' || v_slot_time)::timestamp at time zone 'America/Sao_Paulo';

    v_is_disponivel := true;
    v_motivo_indisponivel := null;

    if v_modo_efetivo = 'transborda' then
      v_minutos_restantes := v_duracao_total_itens;
      v_calc_date := p_data;
      v_calc_start := v_posicao_inicio;

      while v_minutos_restantes > 0 loop
        v_calc_dow := extract(dow from v_calc_date)::smallint;

        select h.abre, h.fecha, h.ativo
        into v_calc_horario
        from public.horarios_funcionamento h
        where h.tenant_id = p_tenant and h.dia_semana = v_calc_dow;

        if found and v_calc_horario.ativo then
          v_fechamento_ts := (v_calc_date || ' ' || v_calc_horario.fecha)::timestamp at time zone 'America/Sao_Paulo';

          if v_calc_start < v_fechamento_ts then
            v_janela_minutos := extract(epoch from (v_fechamento_ts - v_calc_start))::integer / 60;
            if v_janela_minutos >= v_minutos_restantes then
              v_posicao_fim := v_calc_start + (v_minutos_restantes || ' minutes')::interval;
              v_minutos_restantes := 0;
            else
              v_minutos_restantes := v_minutos_restantes - v_janela_minutos;
              v_calc_date := v_calc_date + interval '1 day';
              v_calc_dow := extract(dow from v_calc_date)::smallint;
              loop
                select h.abre, h.fecha, h.ativo into v_calc_horario
                from public.horarios_funcionamento h
                where h.tenant_id = p_tenant and h.dia_semana = v_calc_dow;

                if found and v_calc_horario.ativo then
                  v_calc_start := (v_calc_date || ' ' || v_calc_horario.abre)::timestamp at time zone 'America/Sao_Paulo';
                  exit;
                else
                  v_calc_date := v_calc_date + interval '1 day';
                  v_calc_dow := extract(dow from v_calc_date)::smallint;
                end if;
              end loop;
            end if;
          else
            v_calc_date := v_calc_date + interval '1 day';
            v_calc_dow := extract(dow from v_calc_date)::smallint;
            loop
              select h.abre, h.fecha, h.ativo into v_calc_horario
              from public.horarios_funcionamento h
              where h.tenant_id = p_tenant and h.dia_semana = v_calc_dow;

              if found and v_calc_horario.ativo then
                v_calc_start := (v_calc_date || ' ' || v_calc_horario.abre)::timestamp at time zone 'America/Sao_Paulo';
                exit;
              else
                v_calc_date := v_calc_date + interval '1 day';
                v_calc_dow := extract(dow from v_calc_date)::smallint;
              end if;
            end loop;
          end if;
        else
          v_calc_date := v_calc_date + interval '1 day';
          v_calc_dow := extract(dow from v_calc_date)::smallint;
          loop
            select h.abre, h.fecha, h.ativo into v_calc_horario
            from public.horarios_funcionamento h
            where h.tenant_id = p_tenant and h.dia_semana = v_calc_dow;

            if found and v_calc_horario.ativo then
              v_calc_start := (v_calc_date || ' ' || v_calc_horario.abre)::timestamp at time zone 'America/Sao_Paulo';
              exit;
            else
              v_calc_date := v_calc_date + interval '1 day';
              v_calc_dow := extract(dow from v_calc_date)::smallint;
            end if;
          end loop;
        end if;
      end loop;
      v_fechamento_ts := (p_data || ' ' || v_horario_func.fecha)::timestamp at time zone 'America/Sao_Paulo';
    else
      v_posicao_fim := v_posicao_inicio + (v_duracao_total_itens || ' minutes')::interval;
    end if;

    if v_modo_efetivo = 'dia_inteiro' then
      if v_pos_index > 1 then
        v_is_disponivel := false;
        v_motivo_indisponivel := 'dia_inteiro';
      elsif v_total_agendamentos_dia > 0 then
        v_is_disponivel := false;
        v_motivo_indisponivel := 'dia_reservado';
      end if;
    end if;

    if v_modo_efetivo = 'multiplos_dias' then
      if v_pos_index > 1 then
        v_is_disponivel := false;
        v_motivo_indisponivel := 'multiplos_dias';
      end if;
    end if;

    if v_modo_efetivo = 'slot' and v_is_disponivel and v_posicao_fim > v_fechamento_ts then
      v_is_disponivel := false;
      v_motivo_indisponivel := 'nao_cabe_no_expediente';
    end if;

    if v_is_disponivel and v_posicao_inicio < v_agora_sp then
      v_is_disponivel := false;
      v_motivo_indisponivel := 'passado';
    end if;

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

    if v_is_disponivel then
      select exists(
        select 1 from public.agendamentos a
        where a.tenant_id = p_tenant
          and a.status not in ('cancelado', 'nao_compareceu')
          and (p_ignorar_agendamento is null or a.id <> p_ignorar_agendamento)
          and coalesce(a.modo_ocupacao_efetivo, a.modo_ocupacao) in ('dia_inteiro', 'multiplos_dias')
          and (a.inicio at time zone 'America/Sao_Paulo')::date <= p_data
          and ((a.inicio at time zone 'America/Sao_Paulo')::date + (coalesce(a.dias_ocupados, 1) - 1)) >= p_data
      ) into v_sobrepoem_dia_reservado;

      if v_sobrepoem_dia_reservado then
        v_is_disponivel := false;
        v_motivo_indisponivel := 'dia_reservado';
      end if;
    end if;

    if v_is_disponivel then
      select count(*) into v_qtd_agendamentos_ativos
      from public.agendamentos a
      where a.tenant_id = p_tenant
        and a.status not in ('cancelado', 'nao_compareceu')
        and (p_ignorar_agendamento is null or a.id <> p_ignorar_agendamento)
        and a.inicio < v_posicao_fim
        and (a.inicio + (coalesce(a.duracao_total, a.duracao_minutos, 60) || ' minutes')::interval) > v_posicao_inicio;

      if v_qtd_agendamentos_ativos >= v_horario_func.capacidade then
        v_is_disponivel := false;
        v_motivo_indisponivel := 'sem_box_livre';
      end if;
    end if;

    horario := v_slot_time;
    disponivel := v_is_disponivel;
    motivo := v_motivo_indisponivel;
    termino_previsto := v_posicao_fim;
    return next;

    v_slot_time := (v_slot_time + (v_grade_minutos || ' minutes')::interval)::time;
  end loop;
end;
$$;

-- 4. SOBRECARGA 2 DA RPC HORARIOS_DISPONIVEIS (Serviço único UUID)
create or replace function public.horarios_disponiveis(
  p_tenant uuid,
  p_data date,
  p_servico uuid,
  p_categoria uuid,
  p_ignorar_agendamento uuid default null
) returns table (
  horario time,
  disponivel boolean,
  motivo text,
  termino_previsto timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
begin
  return query
  select hd.horario, hd.disponivel, hd.motivo, hd.termino_previsto
  from public.horarios_disponiveis(
    p_tenant,
    p_data,
    case when p_servico is not null then jsonb_build_array(jsonb_build_object('servico_id', p_servico)) else null end,
    p_categoria,
    p_ignorar_agendamento
  ) hd;
end;
$$;

-- 5. RPC REAGENDAR
create or replace function public.reagendar(
  p_agendamento uuid,
  p_novo_inicio timestamptz
) returns void
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_agendamento record;
  v_data date;
  v_hora time;
  v_is_valido boolean := false;
  v_itens_json jsonb;
begin
  select * into v_agendamento from public.agendamentos where id = p_agendamento;
  if not found then
    raise exception 'Agendamento não encontrado.';
  end if;

  if not public.tem_papel(v_agendamento.tenant_id, array['dono', 'gerente']::app_role[]) then
    raise exception 'Apenas donos ou gerentes podem reagendar.';
  end if;

  v_data := (p_novo_inicio at time zone 'America/Sao_Paulo')::date;
  v_hora := date_trunc('minute', (p_novo_inicio at time zone 'America/Sao_Paulo'))::time;

  -- Advisory lock transacional
  perform pg_advisory_xact_lock(hashtext(v_agendamento.tenant_id::text || ':' || v_data::text));

  -- Obtém lista de itens do agendamento
  select coalesce(
    jsonb_agg(jsonb_build_object('servico_id', servico_id, 'combo_id', combo_id)),
    '[]'::jsonb
  )
  into v_itens_json
  from public.agendamento_itens
  where agendamento_id = p_agendamento;

  if (v_itens_json is null or jsonb_array_length(v_itens_json) = 0) and v_agendamento.servico_id is not null then
    v_itens_json := jsonb_build_array(jsonb_build_object('servico_id', v_agendamento.servico_id));
  end if;

  -- Revalida disponibilidade
  select disponivel into v_is_valido
  from public.horarios_disponiveis(
    v_agendamento.tenant_id,
    v_data,
    v_itens_json,
    v_agendamento.categoria_id,
    p_agendamento
  ) hd
  where hd.horario = v_hora;

  if not coalesce(v_is_valido, false) then
    raise exception 'Este horário não está disponível na agenda. Escolha outro horário.';
  end if;

  update public.agendamentos
  set inicio = p_novo_inicio,
      updated_at = now()
  where id = p_agendamento;

  -- Recalcula totais do agendamento
  perform public.recalcular_agendamento_totais(p_agendamento);
end;
$$;

-- 6. RPC CRIAR_AGENDAMENTO (JSONB)
create or replace function public.criar_agendamento(
  p_cliente uuid,
  p_veiculo uuid,
  p_itens jsonb,
  p_categoria uuid,
  p_inicio timestamptz,
  p_observacoes text default null,
  p_forcado boolean default false
) returns uuid
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant uuid;
  v_data date;
  v_hora time;
  v_is_valido boolean := false;
  v_agendamento_id uuid;
  v_item jsonb;
  v_servico_id uuid;
  v_combo_id uuid;
  v_duracao integer;
  v_modo text := 'slot';
  v_dias integer := 1;
  v_preco numeric(10,2);
  v_ordem smallint := 0;
  v_member_id uuid;
  v_servico_principal uuid;
begin
  select tenant_id into v_tenant from public.clientes where id = p_cliente;
  if not found then
    raise exception 'Cliente não encontrado.';
  end if;

  if not (v_tenant in (select meus_tenants())) or not public.tem_papel(v_tenant, array['dono', 'gerente']::app_role[]) then
    raise exception 'Apenas donos ou gerentes podem realizar agendamentos.';
  end if;

  select id into v_member_id
  from public.tenant_members
  where tenant_id = v_tenant and user_id = auth.uid() and status = 'ativo';

  if p_itens is null or jsonb_array_length(p_itens) = 0 then
    raise exception 'Selecione ao menos um serviço para agendar.';
  end if;

  v_data := (p_inicio at time zone 'America/Sao_Paulo')::date;
  v_hora := date_trunc('minute', (p_inicio at time zone 'America/Sao_Paulo'))::time;

  perform pg_advisory_xact_lock(hashtext(v_tenant::text || ':' || v_data::text));

  -- Validação de disponibilidade (ignorada se p_forcado = true)
  if not p_forcado then
    select disponivel into v_is_valido
    from public.horarios_disponiveis(v_tenant, v_data, p_itens, p_categoria, null) hd
    where hd.horario = v_hora;

    if not coalesce(v_is_valido, false) then
      raise exception 'Este horário não está disponível. Utilize a opção de override forçado se for gestor.';
    end if;
  end if;

  v_servico_principal := (p_itens->0->>'servico_id')::uuid;

  if v_servico_principal is not null then
    select coalesce(s.modo_ocupacao, 'slot'), coalesce(s.dias_ocupados, 1)
    into v_modo, v_dias
    from public.servicos s where s.id = v_servico_principal;
  end if;

  insert into public.agendamentos (
    tenant_id, cliente_id, veiculo_id, servico_id, categoria_id,
    inicio, status, origem, observacoes, criado_por, forcado, forcado_por,
    modo_ocupacao, modo_ocupacao_efetivo, dias_ocupados
  ) values (
    v_tenant, p_cliente, p_veiculo, v_servico_principal, p_categoria,
    p_inicio, 'agendado', 'interno', p_observacoes, auth.uid(),
    p_forcado, case when p_forcado then v_member_id else null end,
    coalesce(v_modo, 'slot'), coalesce(v_modo, 'slot'), coalesce(v_dias, 1)
  ) returning id into v_agendamento_id;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_servico_id := (v_item->>'servico_id')::uuid;
    v_combo_id := nullif(v_item->>'combo_id', '')::uuid;

    select 
      coalesce(sp.duracao_minutos, 60),
      coalesce(s.modo_ocupacao, 'slot'),
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

    insert into public.agendamento_itens (
      tenant_id, agendamento_id, servico_id, combo_id,
      duracao_minutos, preco_estimado, modo_ocupacao, dias_ocupados, ordem
    ) values (
      v_tenant, v_agendamento_id, v_servico_id, v_combo_id,
      v_duracao, v_preco, v_modo, v_dias, v_ordem
    );

    v_ordem := v_ordem + 1;
  end loop;

  perform public.recalcular_agendamento_totais(v_agendamento_id);

  return v_agendamento_id;
end;
$$;

-- 7. SOBRECARGA 2 DA RPC CRIAR_AGENDAMENTO (Serviço único UUID)
create or replace function public.criar_agendamento(
  p_cliente uuid,
  p_veiculo uuid,
  p_servico uuid,
  p_categoria uuid,
  p_inicio timestamptz,
  p_observacoes text default null,
  p_forcado boolean default false
) returns uuid
language plpgsql security definer set search_path = public
as $$
begin
  return public.criar_agendamento(
    p_cliente,
    p_veiculo,
    jsonb_build_array(jsonb_build_object('servico_id', p_servico, 'combo_id', null)),
    p_categoria,
    p_inicio,
    p_observacoes,
    p_forcado
  );
end;
$$;

-- 8. RPC REMOVER_ITEM_AGENDAMENTO (Suporta parâmetros p_item ou p_servico)
create or replace function public.remover_item_agendamento(
  p_agendamento uuid,
  p_servico uuid default null,
  p_item uuid default null
) returns void
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_agendamento record;
  v_total_itens integer;
  v_target_id uuid;
begin
  select * into v_agendamento from public.agendamentos where id = p_agendamento;
  if not found then raise exception 'Agendamento não encontrado.'; end if;

  if not public.tem_papel(v_agendamento.tenant_id, array['dono', 'gerente']::app_role[]) then
    raise exception 'Apenas donos ou gerentes podem alterar serviços do agendamento.';
  end if;

  select count(*) into v_total_itens
  from public.agendamento_itens where agendamento_id = p_agendamento;

  if v_total_itens <= 1 then
    raise exception 'O agendamento precisa ter ao menos um serviço. Cancele o agendamento se necessário.';
  end if;

  v_target_id := coalesce(p_item, p_servico);

  delete from public.agendamento_itens
  where agendamento_id = p_agendamento
    and (id = v_target_id or servico_id = v_target_id);

  perform public.recalcular_agendamento_totais(p_agendamento);
end;
$$;

-- 9. RPC CONVERTER_ORCAMENTO_EM_AGENDAMENTO
create or replace function public.converter_orcamento_em_agendamento(
  p_orcamento uuid,
  p_inicio timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_orcamento record;
  v_nivel_rec record;
  v_agendamento_id uuid;
  v_servico_principal uuid;
  v_modo_ocupacao text := 'slot';
  v_dias_ocupados smallint := 1;
  v_os_num integer;
  v_valor_final numeric(10,2);
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select o.* into v_orcamento from public.orcamentos o where o.id = p_orcamento;
  if not found then
    raise exception 'Orçamento não encontrado.';
  end if;

  if not public.tem_papel(v_orcamento.tenant_id, array['dono', 'gerente']::app_role[]) then
    raise exception 'Acesso negado.';
  end if;

  if v_orcamento.status <> 'aprovado' then
    raise exception 'Apenas orçamentos aprovados podem ser convertidos em agendamento.';
  end if;

  if v_orcamento.nivel_aprovado is null then
    raise exception 'Nenhum nível aprovado foi registrado para este orçamento.';
  end if;

  -- Se já possuir agendamento vinculado, retorna o id existente
  if v_orcamento.agendamento_id is not null then
    return v_orcamento.agendamento_id;
  end if;

  -- Busca o nível aprovado
  select n.* into v_nivel_rec
  from public.orcamento_niveis n
  where n.orcamento_id = p_orcamento and n.nivel = v_orcamento.nivel_aprovado;

  if not found then
    raise exception 'Nível aprovado não encontrado.';
  end if;

  -- Pega o primeiro serviço do nível
  select i.servico_id into v_servico_principal
  from public.orcamento_nivel_itens i
  where i.nivel_id = v_nivel_rec.id
  order by i.ordem asc
  limit 1;

  if v_servico_principal is not null then
    select coalesce(s.modo_ocupacao, 'slot'), coalesce(s.dias_ocupados, 1)
    into v_modo_ocupacao, v_dias_ocupados
    from public.servicos s where s.id = v_servico_principal;
  end if;

  -- Calcula o valor final aplicando o desconto (se houver)
  v_valor_final := coalesce(v_nivel_rec.valor_total, 0);
  if v_orcamento.desconto_valor > 0 and v_orcamento.desconto_tipo is not null then
    if v_orcamento.desconto_tipo = 'porcentagem' then
      v_valor_final := round(v_valor_final * (1.0 - (v_orcamento.desconto_valor / 100.0)), 2);
    elsif v_orcamento.desconto_tipo = 'valor_fixo' then
      v_valor_final := greatest(0.00, v_valor_final - v_orcamento.desconto_valor);
    end if;
  end if;

  -- Gera o próximo número sequencial de OS para a oficina
  v_os_num := public.proximo_numero_os(v_orcamento.tenant_id);

  -- Cria o agendamento (Ordem de Serviço)
  insert into public.agendamentos (
    tenant_id,
    cliente_id,
    veiculo_id,
    servico_id,
    categoria_id,
    inicio,
    duracao_minutos,
    duracao_total,
    modo_ocupacao,
    modo_ocupacao_efetivo,
    dias_ocupados,
    preco_estimado,
    preco_estimado_total,
    status,
    origem,
    observacoes,
    criado_por,
    numero_os
  ) values (
    v_orcamento.tenant_id,
    v_orcamento.cliente_id,
    v_orcamento.veiculo_id,
    v_servico_principal,
    v_orcamento.categoria_id,
    p_inicio,
    coalesce(v_nivel_rec.duracao_total, 60),
    coalesce(v_nivel_rec.duracao_total, 60),
    coalesce(v_modo_ocupacao, 'slot'),
    coalesce(v_modo_ocupacao, 'slot'),
    coalesce(v_dias_ocupados, 1),
    v_valor_final,
    v_valor_final,
    'agendado',
    'orcamento',
    coalesce(v_orcamento.observacoes, '') || ' (Convertido do Orçamento ORC' || lpad(v_orcamento.numero::text, 4, '0') || ' - OS ' || lpad(v_os_num::text, 4, '0') || ' - ' || v_nivel_rec.titulo || ')',
    auth.uid(),
    v_os_num
  ) returning id into v_agendamento_id;

  -- Inserir itens do agendamento
  insert into public.agendamento_itens (
    tenant_id,
    agendamento_id,
    servico_id,
    combo_id,
    duracao_minutos,
    preco_estimado,
    modo_ocupacao,
    dias_ocupados,
    ordem
  )
  select
    v_orcamento.tenant_id,
    v_agendamento_id,
    i.servico_id,
    i.combo_id,
    coalesce(i.duracao_minutos, 60),
    coalesce(i.preco, 0),
    coalesce(s.modo_ocupacao, 'slot'),
    coalesce(s.dias_ocupados, 1),
    coalesce(i.ordem, 0)
  from public.orcamento_nivel_itens i
  left join public.servicos s on s.id = i.servico_id
  where i.nivel_id = v_nivel_rec.id;

  -- Recalcula totais do agendamento
  perform public.recalcular_agendamento_totais(v_agendamento_id);

  -- Vincula o agendamento e o numero_os ao orçamento
  update public.orcamentos
  set agendamento_id = v_agendamento_id,
      numero_os = v_os_num,
      updated_at = now()
  where id = p_orcamento;

  return v_agendamento_id;
end;
$$;

-- 10. REGRAS DE PERMISSÃO (GRANTS)
grant execute on function public.horarios_disponiveis(uuid, date, jsonb, uuid, uuid) to anon, authenticated;
grant execute on function public.horarios_disponiveis(uuid, date, uuid, uuid, uuid) to anon, authenticated;
grant execute on function public.criar_agendamento(uuid, uuid, jsonb, uuid, timestamptz, text, boolean) to authenticated;
grant execute on function public.criar_agendamento(uuid, uuid, uuid, uuid, timestamptz, text, boolean) to authenticated;
grant execute on function public.reagendar(uuid, timestamptz) to authenticated;
grant execute on function public.cancelar_agendamento(uuid, text) to authenticated;
grant execute on function public.marcar_nao_compareceu(uuid) to authenticated;
grant execute on function public.adicionar_item_agendamento(uuid, uuid, uuid) to authenticated;
grant execute on function public.remover_item_agendamento(uuid, uuid, uuid) to authenticated;
grant execute on function public.converter_orcamento_em_agendamento(uuid, timestamptz) to authenticated;

notify pgrst, 'reload schema';
