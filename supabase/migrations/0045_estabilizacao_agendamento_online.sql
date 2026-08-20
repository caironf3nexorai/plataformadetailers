-- 0045_estabilizacao_agendamento_online.sql
-- Regra Zero: Estabilização do Agendamento Online e Pré-Registro Atômico de Cliente/Veículo

-- 0. Atualização e Compatibilização das CHECK Constraints de Origem
alter table public.clientes drop constraint if exists clientes_origem_check;
alter table public.clientes add constraint clientes_origem_check
  check (origem in ('interno', 'online', 'agendamento_online', 'balcao', 'orcamento'));

alter table public.agendamentos drop constraint if exists agendamentos_origem_check;
alter table public.agendamentos add constraint agendamentos_origem_check
  check (origem in ('interno', 'online', 'agendamento_online', 'balcao', 'orcamento'));

-- 1. Normalização de Telefone (IMMUTABLE)
create or replace function public.normalizar_telefone(p_telefone text)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_num text;
begin
  if p_telefone is null then
    return null;
  end if;

  -- Remove caracteres não numéricos
  v_num := regexp_replace(p_telefone, '[^0-9]', '', 'g');

  -- Remove prefixo país 55 quando presente em 12 ou 13 dígitos
  if (length(v_num) = 12 or length(v_num) = 13) and v_num ~ '^55' then
    v_num := substring(v_num from 3);
  end if;

  -- Adiciona 9º dígito em celulares com 10 dígitos (DDD + 8 dígitos iniciando em 6..9)
  if length(v_num) = 10 and substring(v_num from 3 for 1) in ('6', '7', '8', '9') then
    v_num := substring(v_num from 1 for 2) || '9' || substring(v_num from 3);
  end if;

  if length(v_num) = 0 then
    return null;
  end if;

  return v_num;
end;
$$;

grant execute on function public.normalizar_telefone(text) to anon, authenticated;

-- 2. Normalização de Placa (IMMUTABLE)
create or replace function public.normalizar_placa(p_placa text)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_placa text;
begin
  if p_placa is null then
    return null;
  end if;

  v_placa := upper(regexp_replace(p_placa, '[^A-Za-z0-9]', '', 'g'));

  if length(v_placa) = 0 then
    return null;
  end if;

  return v_placa;
end;
$$;

grant execute on function public.normalizar_placa(text) to anon, authenticated;

-- 3. Índices de Normalização
create index if not exists idx_clientes_tenant_telefone_norm
  on public.clientes (tenant_id, public.normalizar_telefone(telefone));

create index if not exists idx_veiculos_tenant_placa_norm
  on public.veiculos (tenant_id, public.normalizar_placa(placa));

-- 4. Função de Pré-Registro Atômico de Cliente e Veículo
drop function if exists public.registrar_cliente_veiculo_publico(uuid, text, text, uuid, text, text, text, integer, text);

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
begin
  -- 1. Validação de Tenant
  select * into v_tenant from public.tenants where id = p_tenant_id;
  if not found or not coalesce(v_tenant.agendamento_online_ativo, true) then
    raise exception 'Agendamento online indisponível.';
  end if;

  -- 2. Validação dos Campos Obrigatórios
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

  -- 3. Identificação / Criação do Cliente
  select * into v_cliente
  from public.clientes
  where tenant_id = p_tenant_id
    and public.normalizar_telefone(telefone) = v_tel_norm
  order by created_at asc
  limit 1;

  if v_cliente.id is not null then
    v_cliente_id := v_cliente.id;
    v_cliente_novo := false;

    -- Se nome informado for diferente do nome cadastrado, registra observação
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
    -- Criação de Novo Cliente
    insert into public.clientes (
      tenant_id, nome, telefone, origem
    ) values (
      p_tenant_id, v_nome_limpo, p_telefone, 'agendamento_online'
    ) returning id into v_cliente_id;

    v_cliente_novo := true;
  end if;

  -- 4. Identificação / Criação do Veículo (Se Placa Informada)
  v_placa_norm := public.normalizar_placa(p_placa);

  if v_placa_norm is not null then
    select * into v_veiculo
    from public.veiculos
    where tenant_id = p_tenant_id
      and public.normalizar_placa(placa) = v_placa_norm
    limit 1;

    v_modelo_limpo := coalesce(nullif(trim(p_modelo), ''), 'Não informado');

    if v_veiculo.id is null then
      -- Caso 1: Veículo não existe -> criar
      if p_categoria_id is null then
        raise exception 'Categoria do veículo é obrigatória para cadastrar placa.';
      end if;

      insert into public.veiculos (
        tenant_id, cliente_id, categoria_id, placa, modelo, marca, ano, cor
      ) values (
        p_tenant_id, v_cliente_id, p_categoria_id, v_placa_norm, v_modelo_limpo, trim(p_marca), p_ano, trim(p_cor)
      ) returning id into v_veiculo_id;

      insert into public.veiculo_donos (
        tenant_id, veiculo_id, cliente_id, inicio
      ) values (
        p_tenant_id, v_veiculo_id, v_cliente_id, current_date
      );

      v_veiculo_novo := true;

    elsif v_veiculo.cliente_id is null then
      -- Caso 2: Veículo existe sem dono vinculado
      v_veiculo_id := v_veiculo.id;
      v_veiculo_novo := false;

      update public.veiculos
      set cliente_id = v_cliente_id,
          marca = coalesce(marca, trim(p_marca)),
          ano = coalesce(ano, p_ano),
          cor = coalesce(cor, trim(p_cor)),
          updated_at = now()
      where id = v_veiculo_id;

      insert into public.veiculo_donos (
        tenant_id, veiculo_id, cliente_id, inicio
      ) values (
        p_tenant_id, v_veiculo_id, v_cliente_id, current_date
      );

    elsif v_veiculo.cliente_id = v_cliente_id then
      -- Caso 3: Veículo pertence ao mesmo cliente
      v_veiculo_id := v_veiculo.id;
      v_veiculo_novo := false;

      update public.veiculos
      set marca = coalesce(marca, trim(p_marca)),
          ano = coalesce(ano, p_ano),
          cor = coalesce(cor, trim(p_cor)),
          updated_at = now()
      where id = v_veiculo_id;

    else
      -- Caso 4: Veículo pertence a outro cliente
      v_veiculo_id := v_veiculo.id;
      v_veiculo_novo := false;
      v_aviso := 'Placa já cadastrada para outro cliente. Confirmar troca de proprietário no check-in.';
    end if;
  else
    v_veiculo_id := null;
    v_veiculo_novo := false;
  end if;

  return query select v_cliente_id, v_veiculo_id, v_cliente_novo, v_veiculo_novo, v_aviso;
end;
$$;

grant execute on function public.registrar_cliente_veiculo_publico(uuid, text, text, uuid, text, text, text, integer, text) to anon, authenticated;

-- 5. Atualização da RPC public.agendar_online Integrada ao Pré-Registro
drop function if exists public.agendar_online(text, text, text, text, text, uuid, jsonb, timestamptz, text);

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
  p_cor text default null
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
  v_is_disponivel boolean := false;
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

  -- 5. Checagem de Limite de Clientes do Plano (Gravado como aviso se excedido, sem bloquear)
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

  select coalesce(
    (
      select h.disponivel
      from public.horarios_disponiveis(v_tenant.id, v_data, p_itens, p_categoria, null::uuid) h
      where h.horario = v_hora
      limit 1
    ),
    false
  ) into v_is_disponivel;

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

    v_duracao_item := coalesce(v_duracao_item, 60);
    v_preco_item := coalesce(v_preco_item, 0);

    v_duracao_total_calculada := v_duracao_total_calculada + v_duracao_item;
    v_total_calculado := v_total_calculado + v_preco_item;
  end loop;

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
    sinal_status
  ) values (
    v_tenant.id,
    v_cliente_id,
    v_veiculo_id,
    p_categoria,
    v_servico_id_primeiro,
    'agendamento_online',
    v_status_inicial,
    p_inicio,
    v_duracao_total_calculada,
    v_duracao_total_calculada,
    v_modo_item,
    v_modo_item,
    v_dias_item,
    v_total_calculado,
    v_total_calculado,
    v_obs_final,
    v_os_num,
    v_sinal_valor_calc,
    v_sinal_status_final
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
    );

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
    'duracao_total', v_agendamento_rec.duracao_total,
    'preco_estimado_total', v_agendamento_rec.preco_estimado_total,
    'cliente_id', v_cliente_id,
    'veiculo_id', v_veiculo_id,
    'sinal', jsonb_build_object(
      'ativo', (v_sinal_status_final = 'pendente'),
      'valor', v_sinal_valor_calc,
      'status', v_sinal_status_final,
      'pix_payload', v_pix_payload
    )
  );
end;
$$;

grant execute on function public.agendar_online(text, text, text, text, text, uuid, jsonb, timestamptz, text, text, integer, text) to anon, authenticated;
