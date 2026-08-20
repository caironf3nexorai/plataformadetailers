-- Migration 0048: Estabilização do Cálculo de Transbordo, Horários Disponíveis, Pré-Registro e Agendamento Online com Sinal PIX

-- 0. Limpeza prévia de sobrecargas e duplicatas para eliminar ambiguidade
drop function if exists public.horarios_disponiveis(uuid, date, jsonb, uuid, uuid);
drop function if exists public.horarios_disponiveis(uuid, date, uuid, uuid, uuid);
drop function if exists public.horarios_disponiveis(uuid, date, uuid, jsonb, uuid);
drop function if exists public.horarios_disponiveis(uuid, date, uuid, jsonb);
drop function if exists public.horarios_disponiveis(uuid, date, jsonb, uuid);

drop function if exists public.pre_registrar_cliente_e_veiculo_online(uuid, text, text, text, text, uuid, text, integer, text);
drop function if exists public.pre_registrar_cliente_e_veiculo_online(uuid, text, text, uuid, text, text, text, integer, text);
drop function if exists public.registrar_cliente_veiculo_publico(uuid, text, text, uuid, text, text, text, integer, text);


-- 1. Função Utilitária: calcular_fim_efetivo
create or replace function public.calcular_fim_efetivo(
  p_tenant uuid,
  p_inicio timestamptz,
  p_duracao_minutos integer,
  p_modo_ocupacao text
) returns timestamptz
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_modo text := coalesce(p_modo_ocupacao, 'slot');
  v_minutos_restantes integer := coalesce(p_duracao_minutos, 60);
  v_inicio_sp timestamp;
  v_calc_date date;
  v_calc_time time;
  v_calc_start timestamptz;
  v_calc_dow smallint;
  v_calc_horario record;
  v_fechamento_ts timestamptz;
  v_janela_minutos integer;
  v_posicao_fim timestamptz;
begin
  if p_inicio is null then
    return null;
  end if;

  if v_modo <> 'transborda' or v_minutos_restantes <= 0 then
    return p_inicio + (v_minutos_restantes || ' minutes')::interval;
  end if;

  v_inicio_sp := p_inicio at time zone 'America/Sao_Paulo';
  v_calc_date := v_inicio_sp::date;
  v_calc_time := v_inicio_sp::time;
  v_calc_start := (v_calc_date || ' ' || v_calc_time)::timestamp at time zone 'America/Sao_Paulo';

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
          return v_posicao_fim;
        else
          v_minutos_restantes := v_minutos_restantes - v_janela_minutos;
        end if;
      end if;
    end if;

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
  end loop;

  return coalesce(v_posicao_fim, p_inicio + (coalesce(p_duracao_minutos, 60) || ' minutes')::interval);
end;
$$;

grant execute on function public.calcular_fim_efetivo(uuid, timestamptz, integer, text) to anon, authenticated;


-- 2. Função Canônica de Pré-Registro Atômico de Cliente e Veículo
create or replace function public.pre_registrar_cliente_e_veiculo_online(
  p_tenant_id uuid,
  p_nome text,
  p_telefone text,
  p_categoria_id uuid default null,
  p_placa text default null,
  p_modelo text default null,
  p_marca text default null,
  p_ano integer default null,
  p_cor text default null
)
returns table (
  cliente_id uuid,
  veiculo_id uuid,
  cliente_novo boolean,
  veiculo_novo boolean,
  aviso text,
  limite_excedido boolean
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant record;
  v_tel_norm text;
  v_placa_norm text;
  v_cliente record;
  v_veiculo record;
  v_cliente_id uuid;
  v_veiculo_id uuid;
  v_cliente_novo boolean := false;
  v_veiculo_novo boolean := false;
  v_aviso text := null;
  v_nome_limpo text;
  v_modelo_limpo text;
  v_obs_linha text;
  v_limite_excedido boolean := false;
begin
  select * into v_tenant from public.tenants where id = p_tenant_id;
  if not found or not coalesce(v_tenant.agendamento_online_ativo, true) then
    raise exception 'Agendamento online indisponível para esta oficina.';
  end if;

  v_nome_limpo := trim(coalesce(p_nome, ''));
  if length(v_nome_limpo) < 2 then
    raise exception 'Nome inválido. Informe pelo menos 2 caracteres.';
  end if;

  v_tel_norm := public.normalizar_telefone(p_telefone);
  if v_tel_norm is null or length(v_tel_norm) not in (10, 11) then
    raise exception 'Telefone inválido.';
  end if;

  if p_categoria_id is not null then
    if not exists (
      select 1 from public.categorias_veiculo
      where id = p_categoria_id and tenant_id = p_tenant_id and ativo
    ) then
      raise exception 'Categoria de veículo inválida para esta oficina.';
    end if;
  end if;

  select * into v_cliente
  from public.clientes
  where tenant_id = p_tenant_id
    and public.normalizar_telefone(telefone) = v_tel_norm
  order by created_at asc
  limit 1;

  if v_cliente.id is not null then
    v_cliente_id := v_cliente.id;
    v_cliente_novo := false;

    if lower(trim(v_cliente.nome)) <> lower(v_nome_limpo) then
      v_obs_linha := '[agendamento online ' || to_char(now(), 'YYYY-MM-DD') || '] Cliente informou o nome "' || v_nome_limpo || '" neste agendamento.';
      update public.clientes
      set observacoes = case
            when observacoes is null or trim(observacoes) = '' then v_obs_linha
            else observacoes || E'\n' || v_obs_linha
          end,
          telefone = coalesce(telefone, p_telefone),
          updated_at = now()
      where id = v_cliente_id;
    else
      if v_cliente.telefone is null then
        update public.clientes set telefone = p_telefone, updated_at = now() where id = v_cliente_id;
      end if;
    end if;
  else
    insert into public.clientes (
      tenant_id, nome, telefone, origem
    ) values (
      p_tenant_id, v_nome_limpo, p_telefone, 'agendamento_online'
    ) returning id into v_cliente_id;

    v_cliente_novo := true;
  end if;

  v_placa_norm := public.normalizar_placa(p_placa);

  if v_placa_norm is not null then
    select * into v_veiculo
    from public.veiculos
    where tenant_id = p_tenant_id
      and public.normalizar_placa(placa) = v_placa_norm
    limit 1;

    v_modelo_limpo := coalesce(nullif(trim(p_modelo), ''), 'Não informado');

    if v_veiculo.id is null then
      if p_categoria_id is null then
        raise exception 'Categoria do veículo é obrigatória para cadastrar placa.';
      end if;

      insert into public.veiculos (
        tenant_id, cliente_id, categoria_id, placa, modelo, marca, ano, cor
      ) values (
        p_tenant_id, v_cliente_id, p_categoria_id, v_placa_norm, v_modelo_limpo, trim(p_marca), p_ano, trim(p_cor)
      ) returning id into v_veiculo_id;

      if not exists (
        select 1 from public.veiculo_donos
        where veiculo_id = v_veiculo_id and cliente_id = v_cliente_id and fim is null
      ) then
        insert into public.veiculo_donos (
          tenant_id, veiculo_id, cliente_id, inicio
        ) values (
          p_tenant_id, v_veiculo_id, v_cliente_id, current_date
        );
      end if;

      v_veiculo_novo := true;

    elsif v_veiculo.cliente_id is null then
      v_veiculo_id := v_veiculo.id;
      v_veiculo_novo := false;

      update public.veiculos
      set cliente_id = v_cliente_id,
          marca = coalesce(marca, trim(p_marca)),
          ano = coalesce(ano, p_ano),
          cor = coalesce(cor, trim(p_cor)),
          updated_at = now()
      where id = v_veiculo_id;

      if not exists (
        select 1 from public.veiculo_donos
        where veiculo_id = v_veiculo_id and cliente_id = v_cliente_id and fim is null
      ) then
        insert into public.veiculo_donos (
          tenant_id, veiculo_id, cliente_id, inicio
        ) values (
          p_tenant_id, v_veiculo_id, v_cliente_id, current_date
        );
      end if;

    elsif v_veiculo.cliente_id = v_cliente_id then
      v_veiculo_id := v_veiculo.id;
      v_veiculo_novo := false;

      update public.veiculos
      set marca = coalesce(marca, trim(p_marca)),
          ano = coalesce(ano, p_ano),
          cor = coalesce(cor, trim(p_cor)),
          updated_at = now()
      where id = v_veiculo_id;

    else
      v_veiculo_id := v_veiculo.id;
      v_veiculo_novo := false;
      v_aviso := 'Placa já cadastrada para outro cliente. Confirmar troca de proprietário no check-in.';
    end if;
  else
    v_veiculo_id := null;
    v_veiculo_novo := false;
  end if;

  return query select v_cliente_id, v_veiculo_id, v_cliente_novo, v_veiculo_novo, v_aviso, v_limite_excedido;
end;
$$;

grant execute on function public.pre_registrar_cliente_e_veiculo_online(uuid, text, text, uuid, text, text, text, integer, text) to anon, authenticated;

-- 2b. Alias para registrar_cliente_veiculo_publico
create or replace function public.registrar_cliente_veiculo_publico(
  p_tenant_id uuid,
  p_nome text,
  p_telefone text,
  p_categoria_id uuid default null,
  p_placa text default null,
  p_modelo text default null,
  p_marca text default null,
  p_ano integer default null,
  p_cor text default null
)
returns table (
  cliente_id uuid,
  veiculo_id uuid,
  cliente_novo boolean,
  veiculo_novo boolean,
  aviso text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query select r.cliente_id, r.veiculo_id, r.cliente_novo, r.veiculo_novo, r.aviso
  from public.pre_registrar_cliente_e_veiculo_online(
    p_tenant_id => p_tenant_id,
    p_nome => p_nome,
    p_telefone => p_telefone,
    p_categoria_id => p_categoria_id,
    p_placa => p_placa,
    p_modelo => p_modelo,
    p_marca => p_marca,
    p_ano => p_ano,
    p_cor => p_cor
  ) r;
end;
$$;

grant execute on function public.registrar_cliente_veiculo_publico(uuid, text, text, uuid, text, text, text, integer, text) to anon, authenticated;


-- 3. RPC Principal horarios_disponiveis (Payload JSONB em p_itens)
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
language plpgsql
security definer
set search_path = public
stable
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
  v_janela_fim_dia1 timestamptz;
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
       and (p_categoria is null or sp.categoria_id = p_categoria)
       and sp.ativo
      where s.id = v_servico_id and s.tenant_id = p_tenant
      limit 1;

      if found then
        v_duracao_total_itens := v_duracao_total_itens + coalesce(v_dur_item, 60);
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

    -- Calcula o horário de término preciso usando a nova função utilitária
    v_posicao_fim := public.calcular_fim_efetivo(p_tenant, v_posicao_inicio, v_duracao_total_itens, v_modo_efetivo);

    -- Limita a janela de sobreposição do primeiro dia para não bloquear horários válidos no início do dia por conta de agendamentos no final do expediente/dias seguintes
    if v_modo_efetivo = 'transborda' then
      v_janela_fim_dia1 := case when v_posicao_fim < v_fechamento_ts then v_posicao_fim else v_fechamento_ts end;
    else
      v_janela_fim_dia1 := v_posicao_fim;
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
          and b.inicio < v_janela_fim_dia1
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
        and a.inicio < v_janela_fim_dia1
        and public.calcular_fim_efetivo(
              a.tenant_id, 
              a.inicio, 
              coalesce(a.duracao_total, a.duracao_minutos, 60), 
              coalesce(a.modo_ocupacao_efetivo, a.modo_ocupacao)
            ) > v_posicao_inicio;

      if v_qtd_agendamentos_ativos >= coalesce(v_horario_func.capacidade, 1) then
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

grant execute on function public.horarios_disponiveis(uuid, date, jsonb, uuid, uuid) to anon, authenticated;

-- 4. SOBRECARGA 1: Serviço Único (uuid, date, uuid, uuid, uuid)
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

grant execute on function public.horarios_disponiveis(uuid, date, uuid, uuid, uuid) to anon, authenticated;

-- 5. SOBRECARGA 2: Chamada Posicional (uuid, date, uuid, jsonb)
create or replace function public.horarios_disponiveis(
  p_tenant uuid,
  p_data date,
  p_categoria uuid,
  p_itens jsonb
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
    p_itens,
    p_categoria,
    null::uuid
  ) hd;
end;
$$;

grant execute on function public.horarios_disponiveis(uuid, date, uuid, jsonb) to anon, authenticated;


-- 6. REFORÇO DA RPC AGENDAR_ONLINE INTEGRADA AO PRÉ-REGISTRO CANÔNICO
create or replace function public.agendar_online(
  p_slug text,
  p_nome text,
  p_telefone text,
  p_placa text,
  p_modelo text,
  p_categoria uuid,
  p_itens jsonb,
  p_inicio timestamptz,
  p_observacoes text default null,
  p_marca text default null,
  p_ano integer default null,
  p_cor text default null,
  p_transbordo_aceito boolean default false,
  p_user_agent text default null,
  p_ip text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant record;
  v_tentativas integer;
  v_min_inicio timestamptz;
  v_max_inicio timestamptz;
  v_data date;
  v_hora time;
  v_slot_rec record;
  v_is_disponivel boolean := false;
  v_termino_previsto timestamptz;
  v_reg record;
  v_cliente_id uuid;
  v_veiculo_id uuid;
  v_agendamento_id uuid;
  v_servico_id_primeiro uuid;
  v_modo_item text;
  v_dias_item smallint;
  v_item jsonb;
  v_duracao_item integer;
  v_preco_item numeric(10,2);
  v_modo_item_loop text;
  v_dias_item_loop integer;
  v_modo_efetivo text := 'slot';
  v_ordem smallint := 1;
  v_total_calculado numeric(10,2) := 0;
  v_duracao_total_calculada integer := 0;
  v_status_inicial text;
  v_sinal_valor_calc numeric(10,2) := 0;
  v_sinal_status_final text := 'nao_aplicavel';
  v_os_num integer;
  v_pix_payload text := null;
  v_agendamento_rec record;
  v_obs_final text;
  v_contagem_clientes integer;
  v_limite_clientes integer;
  v_limite_excedido boolean := false;
  v_is_transbordo boolean := false;
  v_inicio_sp date;
  v_termino_sp date;
begin
  -- 1. Localiza Tenant
  select t.* into v_tenant from public.tenants t where t.slug = p_slug;
  if not found then
    raise exception 'Oficina não encontrada.';
  end if;

  if not coalesce(v_tenant.agendamento_online_ativo, true) then
    raise exception 'O agendamento online está desativado para esta oficina no momento.';
  end if;

  -- 2. Validação básica de itens e datas
  if p_itens is null or jsonb_array_length(p_itens) = 0 then
    raise exception 'Selecione ao menos um serviço para agendar.';
  end if;

  if jsonb_array_length(p_itens) > 10 then
    raise exception 'Não é possível agendar mais de 10 serviços simultaneamente.';
  end if;

  v_min_inicio := now() + (coalesce(v_tenant.antecedencia_minima_horas, 2) || ' hours')::interval;
  if p_inicio < v_min_inicio then
    raise exception 'Agendamento deve ser feito com pelo menos % horas de antecedência.', coalesce(v_tenant.antecedencia_minima_horas, 2);
  end if;

  v_max_inicio := now() + interval '90 days';
  if p_inicio > v_max_inicio then
    raise exception 'Não é possível agendar com mais de 90 dias de antecedência.';
  end if;

  -- 3. Rate Limiting por Telefone (máx 3 agendamentos por hora)
  select count(*) into v_tentativas
  from public.agendamento_online_tentativas
  where tenant_id = v_tenant.id
    and telefone = public.normalizar_telefone(p_telefone)
    and created_at > now() - interval '1 hour';

  if v_tentativas >= 3 then
    raise exception 'Muitas tentativas de agendamento recentes. Aguarde 1 hora antes de tentar novamente.';
  end if;

  -- 4. Validação da Categoria do Veículo
  if p_categoria is null then
    raise exception 'Categoria do veículo é obrigatória.';
  end if;

  if not exists (
    select 1 from public.categorias_veiculo
    where id = p_categoria and tenant_id = v_tenant.id and ativo = true
  ) then
    raise exception 'Categoria de veículo inválida ou inativa.';
  end if;

  -- 5. Validação de Horário via RPC horarios_disponiveis (Chamada Posicional Direta)
  v_data := (p_inicio at time zone 'America/Sao_Paulo')::date;
  v_hora := (p_inicio at time zone 'America/Sao_Paulo')::time;

  for v_slot_rec in
    select * from public.horarios_disponiveis(v_tenant.id, v_data, p_itens, p_categoria)
  loop
    if v_slot_rec.horario = v_hora then
      v_is_disponivel := v_slot_rec.disponivel;
      v_termino_previsto := v_slot_rec.termino_previsto;
      exit;
    end if;
  end loop;

  if not v_is_disponivel then
    raise exception 'O horário selecionado (%) não está mais disponível.', to_char(v_hora, 'HH24:MI');
  end if;

  -- 6. Pre-Registro / Upsert de Cliente e Veículo (Chamada Nomeada Canônica)
  select * into v_reg from public.pre_registrar_cliente_e_veiculo_online(
    p_tenant_id => v_tenant.id,
    p_nome => p_nome,
    p_telefone => p_telefone,
    p_categoria_id => p_categoria,
    p_placa => p_placa,
    p_modelo => p_modelo,
    p_marca => p_marca,
    p_ano => p_ano,
    p_cor => p_cor
  );

  v_cliente_id := v_reg.cliente_id;
  v_veiculo_id := v_reg.veiculo_id;
  v_limite_excedido := coalesce(v_reg.limite_excedido, false);

  -- 7. Métricas do Primeiro Item e Totais
  v_item := p_itens->0;
  v_servico_id_primeiro := (v_item->>'servico_id')::uuid;

  select modo_ocupacao, coalesce(dias_ocupados, 1)
  into v_modo_item, v_dias_item
  from public.servicos
  where id = v_servico_id_primeiro;

  v_modo_item := coalesce(v_modo_item, 'slot');
  v_dias_item := coalesce(v_dias_item, 1);

  if v_modo_item in ('transborda', 'multiplos_dias') or v_dias_item > 1 then
    v_modo_efetivo := v_modo_item;
  end if;

  -- Percorre todos os itens para somar duração total e preço total
  for v_item in select * from jsonb_array_elements(p_itens) loop
    select duracao_minutos, preco_base
    into v_duracao_item, v_preco_item
    from public.servico_precos
    where servico_id = (v_item->>'servico_id')::uuid
      and categoria_id = p_categoria
      and ativo
    limit 1;

    if v_duracao_item is null then
      select duracao_minutos, preco_base
      into v_duracao_item, v_preco_item
      from public.servico_precos
      where servico_id = (v_item->>'servico_id')::uuid
        and ativo
      limit 1;
    end if;

    v_duracao_item := coalesce(v_duracao_item, 60);
    v_preco_item := coalesce(v_preco_item, 0);

    v_duracao_total_calculada := v_duracao_total_calculada + v_duracao_item;
    v_total_calculado := v_total_calculado + v_preco_item;
  end loop;

  -- Se o término previsto não tiver sido retornado pela RPC, calcula o fallback
  if v_termino_previsto is null then
    v_termino_previsto := p_inicio + (v_duracao_total_calculada || ' minutes')::interval;
  end if;

  -- Verifica se é transbordo de data
  v_inicio_sp := (p_inicio at time zone 'America/Sao_Paulo')::date;
  v_termino_sp := (v_termino_previsto at time zone 'America/Sao_Paulo')::date;

  if v_modo_efetivo = 'transborda' or v_termino_sp > v_inicio_sp then
    v_is_transbordo := true;
  end if;

  -- EXIGÊNCIA DE CONSENTIMENTO PARA AGENDAMENTO ONLINE COM PERNOITE
  if v_is_transbordo and not coalesce(p_transbordo_aceito, false) then
    raise exception 'Para agendar um serviço com pernoite, é obrigatório aceitar os termos de permanência do veículo na oficina.';
  end if;

  -- Status Inicial e Sinal
  if coalesce(v_tenant.agendamento_exige_confirmacao, false) then
    v_status_inicial := 'aguardando_confirmacao';
  else
    v_status_inicial := 'confirmado';
  end if;

  if coalesce(v_tenant.sinal_ativo, false) and coalesce(v_tenant.sinal_valor, 0) > 0 then
    if v_tenant.sinal_tipo = 'percentual' then
      v_sinal_valor_calc := round((v_total_calculado * v_tenant.sinal_valor / 100.0), 2);
    else
      v_sinal_valor_calc := v_tenant.sinal_valor;
    end if;

    if v_sinal_valor_calc > v_total_calculado then
      v_sinal_valor_calc := v_total_calculado;
    end if;

    if v_sinal_valor_calc > 0 then
      v_sinal_status_final := 'pendente';
      -- Se o sinal está ativo e tem valor > 0, força o agendamento para aguardando confirmação
      v_status_inicial := 'aguardando_confirmacao';
    end if;
  end if;

  v_os_num := public.proximo_numero_os(v_tenant.id);

  -- Montagem das Observações
  v_obs_final := coalesce(trim(p_observacoes), 'Agendado via Catálogo Online');
  if v_is_transbordo then
    v_obs_final := v_obs_final || E'\n[pernoite aceito via agendamento online]';
  end if;
  if v_reg.aviso is not null then
    v_obs_final := v_obs_final || E'\n' || v_reg.aviso;
  end if;
  if v_limite_excedido then
    v_obs_final := v_obs_final || E'\n[limite de plano excedido]';
  end if;

  -- 8. Inserção do Agendamento
  insert into public.agendamentos (
    tenant_id,
    cliente_id,
    veiculo_id,
    categoria_id,
    servico_id,
    origem,
    status,
    inicio,
    duracao_minutos,
    duracao_total,
    modo_ocupacao,
    modo_ocupacao_efetivo,
    dias_ocupados,
    preco_estimado,
    preco_estimado_total,
    observacoes,
    numero_os,
    sinal_valor,
    sinal_status,
    previsao_entrega,
    transbordo_aceito_em,
    transbordo_aceite_user_agent,
    transbordo_aceite_ip
  ) values (
    v_tenant.id,
    v_cliente_id,
    v_veiculo_id,
    p_categoria,
    v_servico_id_primeiro,
    'online',
    v_status_inicial,
    p_inicio,
    v_duracao_total_calculada,
    v_duracao_total_calculada,
    v_modo_item,
    v_modo_efetivo,
    v_dias_item,
    v_total_calculado,
    v_total_calculado,
    v_obs_final,
    v_os_num,
    v_sinal_valor_calc,
    v_sinal_status_final,
    v_termino_previsto,
    case when v_is_transbordo and p_transbordo_aceito then now() else null end,
    case when v_is_transbordo and p_transbordo_aceito then p_user_agent else null end,
    case when v_is_transbordo and p_transbordo_aceito then p_ip else null end
  ) returning id into v_agendamento_id;

  -- 9. Inserção dos Itens
  v_ordem := 1;
  for v_item in select * from jsonb_array_elements(p_itens) loop
    select modo_ocupacao, coalesce(dias_ocupados, 1)
    into v_modo_item_loop, v_dias_item_loop
    from public.servicos
    where id = (v_item->>'servico_id')::uuid;

    select duracao_minutos, preco_base
    into v_duracao_item, v_preco_item
    from public.servico_precos
    where servico_id = (v_item->>'servico_id')::uuid
      and categoria_id = p_categoria
      and ativo
    limit 1;

    if v_duracao_item is null then
      select duracao_minutos, preco_base
      into v_duracao_item, v_preco_item
      from public.servico_precos
      where servico_id = (v_item->>'servico_id')::uuid
        and ativo
      limit 1;
    end if;

    if not exists (
      select 1 from public.agendamento_itens
      where agendamento_id = v_agendamento_id
        and servico_id = (v_item->>'servico_id')::uuid
    ) then
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
      ) values (
        v_tenant.id,
        v_agendamento_id,
        (v_item->>'servico_id')::uuid,
        nullif(v_item->>'combo_id', '')::uuid,
        coalesce(v_duracao_item, 60),
        coalesce(v_preco_item, 0),
        v_modo_item_loop,
        v_dias_item_loop,
        v_ordem
      );
    end if;

    v_ordem := v_ordem + 1;
  end loop;

  -- 10. Registra tentativa para rate limiting
  insert into public.agendamento_online_tentativas (tenant_id, telefone)
  values (v_tenant.id, public.normalizar_telefone(p_telefone));

  -- 11. Montagem da Chave PIX se houver sinal
  if v_sinal_status_final = 'pendente' and v_sinal_valor_calc > 0 then
    if v_tenant.pix_chave is not null and trim(v_tenant.pix_chave) <> '' then
      v_pix_payload := public.gerar_payload_pix(
        v_tenant.pix_chave,
        coalesce(v_tenant.pix_nome_beneficiario, v_tenant.nome),
        coalesce(v_tenant.pix_cidade, 'SAO PAULO'),
        v_sinal_valor_calc,
        'OS' || lpad(v_os_num::text, 4, '0')
      );
    end if;
  end if;

  select * into v_agendamento_rec from public.agendamentos where id = v_agendamento_id;

  return jsonb_build_object(
    'agendamento_id', v_agendamento_id,
    'numero_os', v_os_num,
    'status', v_agendamento_rec.status,
    'inicio', v_agendamento_rec.inicio,
    'previsao_entrega', v_agendamento_rec.previsao_entrega,
    'duracao_total', v_agendamento_rec.duracao_total,
    'preco_estimado_total', v_agendamento_rec.preco_estimado_total,
    'cliente_id', v_cliente_id,
    'veiculo_id', v_veiculo_id,
    'transborda', v_is_transbordo,
    'sinal', jsonb_build_object(
      'ativo', (v_sinal_status_final = 'pendente'),
      'valor', v_sinal_valor_calc,
      'status', v_sinal_status_final,
      'pix_payload', v_pix_payload,
      'pix_chave_configurada', (v_tenant.pix_chave is not null and trim(v_tenant.pix_chave) <> '')
    )
  );
end;
$$;

grant execute on function public.agendar_online(text, text, text, text, text, uuid, jsonb, timestamptz, text, text, integer, text, boolean, text, text) to anon, authenticated;
