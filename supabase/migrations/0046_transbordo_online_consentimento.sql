-- 0046_transbordo_online_consentimento.sql
-- Adiciona suporte a snapshot de previsão de entrega e consentimento explícito no agendamento online com pernoite.

-- 1. ADICIONA NOVAS COLUNAS NA TABELA AGENDAMENTOS
alter table public.agendamentos
  add column if not exists previsao_entrega timestamptz,
  add column if not exists transbordo_aceito_em timestamptz,
  add column if not exists transbordo_aceite_user_agent text,
  add column if not exists transbordo_aceite_ip text;

-- 2. DROPS PREVENTIVOS DE SOBRECARGAS ANTERIORES DA RPC AGENDAR_ONLINE
drop function if exists public.agendar_online(text, text, text, text, text, uuid, jsonb, timestamptz, text);
drop function if exists public.agendar_online(text, text, text, text, text, uuid, jsonb, timestamptz, text, text, integer, text);
drop function if exists public.agendar_online(text, text, text, text, text, uuid, jsonb, timestamptz, text, text, integer, text, boolean, text, text);

-- 3. CRIAÇÃO DA RPC AGENDAR_ONLINE COM SUPORTE A CONSENTIMENTO E PREVISÃO DE ENTREGA
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
    raise exception 'O horário escolhido deve ter antecedência mínima de % horas.', coalesce(v_tenant.antecedencia_minima_horas, 2);
  end if;

  v_max_inicio := now() + interval '90 days';
  if p_inicio > v_max_inicio then
    raise exception 'Agendamentos online só podem ser realizados para os próximos 90 dias.';
  end if;

  -- 3. Rate limiting por telefone (Máximo 5 por telefone em 24h)
  select count(*) into v_tentativas
  from public.agendamento_online_tentativas
  where tenant_id = v_tenant.id
    and telefone = public.normalizar_telefone(p_telefone)
    and created_at >= (now() - interval '24 hours');

  if v_tentativas >= 5 then
    raise exception 'Muitos agendamentos hoje. Entre em contato com a oficina.';
  end if;

  -- 4. Pré-Registro Atômico de Cliente e Veículo
  select * into v_reg from public.registrar_cliente_veiculo_publico(
    v_tenant.id,
    p_nome,
    p_telefone,
    p_categoria,
    p_placa,
    p_modelo,
    p_marca,
    p_ano,
    p_cor
  );

  v_cliente_id := v_reg.cliente_id;
  v_veiculo_id := v_reg.veiculo_id;

  -- 5. Checagem de Limite de Clientes do Plano (Aviso se excedido)
  if v_reg.cliente_novo then
    select count(*) into v_contagem_clientes from public.clientes where tenant_id = v_tenant.id and ativo;
    select limite into v_limite_clientes from public.plan_limits where plano = v_tenant.plano and recurso = 'clientes';
    if v_limite_clientes is not null and v_contagem_clientes > v_limite_clientes then
      v_limite_excedido := true;
    end if;
  end if;

  -- 6. Validação de Disponibilidade na Agenda
  v_data := (p_inicio at time zone 'America/Sao_Paulo')::date;
  v_hora := (p_inicio at time zone 'America/Sao_Paulo')::time;

  select h.disponivel, h.termino_previsto into v_slot_rec
  from public.horarios_disponiveis(v_tenant.id, v_data, p_itens, p_categoria, null::uuid) h
  where h.horario = v_hora
  limit 1;

  v_is_disponivel := coalesce(v_slot_rec.disponivel, false);
  v_termino_previsto := v_slot_rec.termino_previsto;

  if not v_is_disponivel then
    raise exception 'O horário selecionado não está mais disponível. Por favor, escolha outro horário.';
  end if;

  -- 7. Processamento dos Itens do Agendamento
  v_item := p_itens->0;
  v_servico_id_primeiro := (v_item->>'servico_id')::uuid;

  select modo_ocupacao, coalesce(dias_ocupados, 1)
  into v_modo_item, v_dias_item
  from public.servicos
  where id = v_servico_id_primeiro;

  if v_modo_item is null then
    raise exception 'Serviço selecionado não foi encontrado.';
  end if;

  v_modo_efetivo := coalesce(v_modo_item, 'slot');

  for v_item in select * from jsonb_array_elements(p_itens) loop
    select modo_ocupacao, coalesce(dias_ocupados, 1)
    into v_modo_item_loop, v_dias_item_loop
    from public.servicos
    where id = (v_item->>'servico_id')::uuid;

    if v_modo_item_loop = 'multiplos_dias' then
      v_modo_efetivo := 'multiplos_dias';
    elsif v_modo_item_loop = 'dia_inteiro' and v_modo_efetivo <> 'multiplos_dias' then
      v_modo_efetivo := 'dia_inteiro';
    elsif v_modo_item_loop = 'transborda' and v_modo_efetivo not in ('multiplos_dias', 'dia_inteiro') then
      v_modo_efetivo := 'transborda';
    end if;

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
      if coalesce(v_tenant.sinal_obrigatorio, false) then
        v_status_inicial := 'aguardando_confirmacao';
      end if;
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
    ) on conflict (agendamento_id, servico_id) do nothing;

    v_ordem := v_ordem + 1;
  end loop;

  -- 10. Registra tentativa para rate limiting
  insert into public.agendamento_online_tentativas (tenant_id, telefone)
  values (v_tenant.id, public.normalizar_telefone(p_telefone));

  -- 11. Montagem da Chave PIX se houver sinal
  if v_sinal_status_final = 'pendente' and v_sinal_valor_calc > 0 then
    if v_tenant.pix_chave is not null and trim(v_tenant.pix_chave) <> '' then
      v_pix_payload := public.gerar_payload_pix_estatico(
        v_tenant.pix_chave,
        coalesce(v_tenant.pix_nome_beneficiario, v_tenant.nome),
        coalesce(v_tenant.pix_cidade, 'BRASILIA'),
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
      'pix_payload', v_pix_payload
    )
  );
end;
$$;

grant execute on function public.agendar_online(text, text, text, text, text, uuid, jsonb, timestamptz, text, text, integer, text, boolean, text, text) to anon, authenticated;
