-- 0042_fix_agendar_online_veiculo_categoria.sql
-- Correção na RPC public.agendar_online:
-- 1. Valida p_categoria contra categorias_veiculo do tenant.
-- 2. Se placa informada e veículo novo, insere categoria_id e grava histórico em veiculo_donos.
-- 3. Se placa informada e veículo existente, reutiliza o veículo existente sem alterar o dono.
-- 4. Se placa não informada, mantém veiculo_id nulo no agendamento.
-- 5. Usa p_itens (jsonb) e null::uuid ao chamar a RPC horarios_disponiveis.

create or replace function public.agendar_online(
  p_slug text,
  p_nome text,
  p_telefone text,
  p_placa text,
  p_modelo text,
  p_categoria uuid,
  p_itens jsonb,
  p_inicio timestamptz,
  p_observacoes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant record;
  v_tel_limpo text;
  v_placa_limpa text;
  v_tentativas integer;
  v_min_inicio timestamptz;
  v_max_inicio timestamptz;
  v_data date;
  v_hora time;
  v_is_disponivel boolean := false;
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
begin
  -- 1. Localiza o tenant pelo slug
  select t.* into v_tenant from public.tenants t where t.slug = p_slug;
  if not found then
    raise exception 'Oficina não encontrada.';
  end if;

  if not coalesce(v_tenant.agendamento_online_ativo, true) then
    raise exception 'O agendamento online está desativado para esta oficina no momento.';
  end if;

  -- 2. Sanitização e Validações das Entradas
  if length(trim(coalesce(p_nome, ''))) < 3 then
    raise exception 'Por favor, informe seu nome completo (pelo menos 3 caracteres).';
  end if;

  v_tel_limpo := regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g');
  if length(v_tel_limpo) not in (10, 11) then
    raise exception 'Por favor, informe um número de telefone/WhatsApp válido com DDD (10 ou 11 dígitos).';
  end if;

  -- Validação da Categoria do Veículo
  if p_categoria is null then
    raise exception 'Categoria de veículo é obrigatória.';
  end if;

  if not exists (
    select 1 from public.categorias_veiculo
    where id = p_categoria and tenant_id = v_tenant.id and ativo
  ) then
    raise exception 'Categoria de veículo inválida.';
  end if;

  if p_placa is not null and trim(p_placa) <> '' then
    v_placa_limpa := upper(regexp_replace(trim(p_placa), '[^A-Za-z0-9]', '', 'g'));
    if not (v_placa_limpa ~ '^[A-Z]{3}[0-9]{4}$' or v_placa_limpa ~ '^[A-Z]{3}[0-9][A-Z][0-9]{2}$') then
      raise exception 'A placa informada é inválida. Use o formato AAA9999 ou AAA9A99.';
    end if;
  else
    v_placa_limpa := null;
  end if;

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

  -- 3. Rate-limiting por Telefone (Máximo 5 agendamentos por telefone em 24h)
  select count(*) into v_tentativas
  from public.agendamento_online_tentativas
  where tenant_id = v_tenant.id
    and telefone = v_tel_limpo
    and created_at >= (now() - interval '24 hours');

  if v_tentativas >= 5 then
    raise exception 'Muitos agendamentos hoje. Entre em contato com a oficina.';
  end if;

  -- 4. Cliente: busca por telefone no tenant ou cria novo
  select id into v_cliente_id
  from public.clientes
  where tenant_id = v_tenant.id and regexp_replace(coalesce(telefone, ''), '[^0-9]', '', 'g') = v_tel_limpo
  limit 1;

  if v_cliente_id is null then
    insert into public.clientes (
      tenant_id, nome, telefone, origem
    ) values (
      v_tenant.id, trim(p_nome), v_tel_limpo, 'online'
    ) returning id into v_cliente_id;
  end if;

  -- 5. Veículo: se placa informada, busca existente ou cria com categoria_id e registro de dono
  if v_placa_limpa is not null then
    select id into v_veiculo_id
    from public.veiculos
    where tenant_id = v_tenant.id and placa = v_placa_limpa
    limit 1;

    if v_veiculo_id is null then
      insert into public.veiculos (
        tenant_id, cliente_id, categoria_id, placa, modelo
      ) values (
        v_tenant.id, v_cliente_id, p_categoria, v_placa_limpa, trim(coalesce(p_modelo, 'Veículo'))
      ) returning id into v_veiculo_id;

      insert into public.veiculo_donos (
        tenant_id, veiculo_id, cliente_id, inicio
      ) values (
        v_tenant.id, v_veiculo_id, v_cliente_id, current_date
      );
    end if;
  else
    v_veiculo_id := null;
  end if;

  -- 6. Lock Transacional por Tenant e Data para evitar corridas
  v_data := (p_inicio at time zone 'America/Sao_Paulo')::date;
  v_hora := date_trunc('minute', (p_inicio at time zone 'America/Sao_Paulo'))::time;
  perform pg_advisory_xact_lock(hashtext(v_tenant.id::text), hashtext(v_data::text));

  -- Primeiro serviço do agendamento
  v_servico_id_primeiro := (p_itens->0->>'servico_id')::uuid;

  -- 7. Revalidação de disponibilidade estrita com p_itens (jsonb) e null::uuid
  select disponivel into v_is_disponivel
  from public.horarios_disponiveis(
    v_tenant.id,
    v_data,
    p_itens,
    p_categoria,
    null::uuid
  ) hd
  where hd.horario = v_hora;

  if not coalesce(v_is_disponivel, false) then
    raise exception 'O horário selecionado não está mais disponível. Por favor, escolha outro horário.';
  end if;

  -- Busca modo de ocupação do primeiro serviço
  select coalesce(s.modo_ocupacao, 'slot'), coalesce(s.dias_ocupados, 1)
  into v_modo_item, v_dias_item
  from public.servicos s where s.id = v_servico_id_primeiro;

  -- Status inicial baseado na configuração de confirmação
  if coalesce(v_tenant.agendamento_exige_confirmacao, false) then
    v_status_inicial := 'aguardando_confirmacao';
  else
    v_status_inicial := 'agendado';
  end if;

  -- 8. Insere o Agendamento
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
    observacoes
  ) values (
    v_tenant.id,
    v_cliente_id,
    v_veiculo_id,
    p_categoria,
    v_servico_id_primeiro,
    'online',
    v_status_inicial,
    p_inicio,
    60,
    60,
    coalesce(v_modo_item, 'slot'),
    coalesce(v_modo_item, 'slot'),
    coalesce(v_dias_item, 1),
    0.00,
    0.00,
    coalesce(trim(p_observacoes), '')
  ) returning id, numero_os into v_agendamento_id, v_os_num;

  -- 9. Insere os Itens do Agendamento
  for v_item in select * from jsonb_array_elements(p_itens) loop
    select 
      coalesce(sp.duracao_minutos, 60),
      coalesce(sp.preco_base, 0.00),
      s.modo_ocupacao,
      coalesce(s.dias_ocupados, 1)
    into v_duracao_item, v_preco_item, v_modo_item_loop, v_dias_item_loop
    from public.servicos s
    left join public.servico_precos sp 
      on sp.servico_id = s.id 
     and sp.categoria_id = p_categoria 
     and sp.ativo = true
    where s.id = (v_item->>'servico_id')::uuid;

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
      v_duracao_item,
      v_preco_item,
      coalesce(v_modo_item_loop, 'slot'),
      coalesce(v_dias_item_loop, 1),
      v_ordem
    );

    v_ordem := v_ordem + 1;
  end loop;

  -- Recalcula totais do agendamento
  perform public.recalcular_agendamento_totais(v_agendamento_id);

  -- 10. Cálculo de Sinal Pix (se ativo no tenant)
  select preco_estimado_total into v_total_calculado
  from public.agendamentos where id = v_agendamento_id;

  if coalesce(v_tenant.sinal_ativo, false) and v_total_calculado > 0 then
    if v_tenant.sinal_tipo = 'percentual' then
      v_sinal_valor_calc := round(v_total_calculado * (coalesce(v_tenant.sinal_valor, 25.00) / 100.0), 2);
    else
      v_sinal_valor_calc := least(v_total_calculado, coalesce(v_tenant.sinal_valor, 0.00));
    end if;

    v_sinal_status_final := 'pendente';

    -- Gera o Payload Pix EMV no Servidor se houver chave cadastrada
    if v_tenant.pix_chave is not null and trim(v_tenant.pix_chave) <> '' then
      v_pix_payload := public.gerar_payload_pix(
        v_tenant.pix_chave,
        v_tenant.pix_nome_beneficiario,
        v_tenant.pix_cidade,
        v_sinal_valor_calc,
        'OS' || lpad(v_os_num::text, 4, '0')
      );
    end if;

    update public.agendamentos
    set sinal_valor = v_sinal_valor_calc,
        sinal_status = v_sinal_status_final
    where id = v_agendamento_id;
  end if;

  -- Registra a tentativa para rate-limiting
  insert into public.agendamento_online_tentativas (tenant_id, telefone)
  values (v_tenant.id, v_tel_limpo);

  -- Retorna JSONB completo para a tela de confirmação
  select a.* into v_agendamento_rec from public.agendamentos a where a.id = v_agendamento_id;

  return jsonb_build_object(
    'agendamento_id', v_agendamento_id,
    'numero_os', v_os_num,
    'status', v_agendamento_rec.status,
    'inicio', v_agendamento_rec.inicio,
    'duracao_total', v_agendamento_rec.duracao_total,
    'preco_estimado_total', v_agendamento_rec.preco_estimado_total,
    'sinal', jsonb_build_object(
      'ativo', coalesce(v_tenant.sinal_ativo, false),
      'obrigatorio', coalesce(v_tenant.sinal_obrigatorio, false),
      'valor', v_sinal_valor_calc,
      'status', v_sinal_status_final,
      'pix_chave', v_tenant.pix_chave,
      'pix_tipo', v_tenant.pix_tipo,
      'pix_nome_beneficiario', v_tenant.pix_nome_beneficiario,
      'pix_cidade', v_tenant.pix_cidade,
      'pix_payload', v_pix_payload
    ),
    'oficina', jsonb_build_object(
      'nome', v_tenant.nome,
      'telefone', v_tenant.telefone,
      'politica_cancelamento', v_tenant.politica_cancelamento
    )
  );
end;
$$;

grant execute on function public.agendar_online(text, text, text, text, text, uuid, jsonb, timestamptz, text) to anon, authenticated;

notify pgrst, 'reload schema';
