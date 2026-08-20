-- Migration 0039: Padronização das RPCs de Orçamento Público para UUID e Correções de Colunas
-- Garante assinaturas únicas com UUID para orcamento_publico, responder_orcamento e agendar_orcamento_publico

-- 1. DROPS EXPLÍCITOS DE TODAS AS ASSINATURAS EXISTENTES
drop function if exists public.orcamento_publico(text);
drop function if exists public.orcamento_publico(uuid);

drop function if exists public.responder_orcamento(text, text, boolean);
drop function if exists public.responder_orcamento(uuid, text, boolean);

drop function if exists public.agendar_orcamento_publico(text, timestamptz);
drop function if exists public.agendar_orcamento_publico(uuid, timestamptz);

-- 2. RECRIE RPC ORCAMENTO_PUBLICO COM ASSINATURA UUID
create or replace function public.orcamento_publico(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_orcamento record;
  v_tenant_nome text;
  v_tenant_logo text;
  v_tenant_tel text;
  v_tenant_cidade text;
  v_tenant_uf text;
  v_tenant_agendamento_cliente boolean := true;
  v_tenant_antecedencia_minima integer := 2;
  v_cliente_nome text;
  v_primeiro_nome text;
  v_veiculo_json jsonb := null;
  v_agendamento_json jsonb := null;
  v_niveis_json jsonb := '[]'::jsonb;
  v_itens_aprovados_json jsonb := '[]'::jsonb;
  v_status_atual text;
  v_usuario_desconto_nome text := null;
  v_desconto_json jsonb := null;
  v_tem_veiculo boolean := false;
  v_tem_agendamento boolean := false;
begin
  select o.* into v_orcamento
  from public.orcamentos o
  where o.token_publico = p_token or o.id = p_token
  limit 1;

  if not found then
    return null;
  end if;

  v_status_atual := v_orcamento.status;

  -- 1. Valida se expirou (considerando enviado_em + validade_dias)
  if v_status_atual in ('enviado', 'visualizado') and v_orcamento.enviado_em is not null then
    if (v_orcamento.enviado_em::date + coalesce(v_orcamento.validade_dias, 7)) < current_date then
      v_status_atual := 'expirado';
      update public.orcamentos
      set status = 'expirado', updated_at = now()
      where id = v_orcamento.id;
    end if;
  end if;

  -- 2. Primeira visualização
  if v_status_atual = 'enviado' then
    v_status_atual := 'visualizado';
    update public.orcamentos
    set status = 'visualizado',
        visualizado_em = coalesce(visualizado_em, now()),
        updated_at = now()
    where id = v_orcamento.id;
  end if;

  -- 3. Informações da Oficina (Tenants)
  select 
    t.nome, 
    t.logo_path, 
    t.telefone, 
    t.cidade, 
    t.uf, 
    coalesce(t.orcamento_agendamento_cliente, true),
    coalesce(t.antecedencia_minima_horas, 2)
  into 
    v_tenant_nome, 
    v_tenant_logo, 
    v_tenant_tel, 
    v_tenant_cidade, 
    v_tenant_uf, 
    v_tenant_agendamento_cliente,
    v_tenant_antecedencia_minima
  from public.tenants t 
  where t.id = v_orcamento.tenant_id;

  -- 4. Cliente (Primeiro nome para personalização)
  select c.nome into v_cliente_nome from public.clientes c where c.id = v_orcamento.cliente_id;
  v_primeiro_nome := split_part(coalesce(v_cliente_nome, 'Cliente'), ' ', 1);

  -- 5. Veículo (Construção segura em JSON com flag booleana)
  if v_orcamento.veiculo_id is not null then
    select jsonb_build_object(
      'placa', v.placa,
      'modelo', v.modelo,
      'marca', v.marca
    ) into v_veiculo_json
    from public.veiculos v 
    where v.id = v_orcamento.veiculo_id;
    if found then
      v_tem_veiculo := true;
    end if;
  end if;

  -- 6. Agendamento vinculado (Construção segura em JSON com flag booleana)
  if v_orcamento.agendamento_id is not null then
    select jsonb_build_object(
      'id', a.id,
      'inicio', a.inicio,
      'status', a.status,
      'numero_os', a.numero_os
    ) into v_agendamento_json
    from public.agendamentos a
    where a.id = v_orcamento.agendamento_id;
    if found then
      v_tem_agendamento := true;
    end if;
  end if;

  -- 7. Desconto concedido
  if v_orcamento.desconto_aplicado_por is not null then
    select p.nome into v_usuario_desconto_nome
    from public.profiles p
    where p.id = v_orcamento.desconto_aplicado_por;
  end if;

  if coalesce(v_orcamento.desconto_valor, 0) > 0 and v_orcamento.desconto_tipo is not null then
    v_desconto_json := jsonb_build_object(
      'tipo', v_orcamento.desconto_tipo,
      'valor', v_orcamento.desconto_valor,
      'motivo', v_orcamento.desconto_motivo,
      'cupom_codigo', v_orcamento.desconto_cupom_codigo,
      'aplicado_em', v_orcamento.desconto_aplicado_em,
      'aplicado_por_nome', coalesce(split_part(v_usuario_desconto_nome, ' ', 1), 'Gestor')
    );
  end if;

  -- 8. Construção dos Níveis e Itens
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'nivel', n.nivel,
      'titulo', n.titulo,
      'descricao', n.descricao,
      'valor_original', n.valor_total,
      'valor_total', case 
        when coalesce(v_orcamento.desconto_valor, 0) > 0 and v_orcamento.desconto_tipo = 'porcentagem' 
          then round(n.valor_total * (1.0 - (v_orcamento.desconto_valor / 100.0)), 2)
        when coalesce(v_orcamento.desconto_valor, 0) > 0 and v_orcamento.desconto_tipo = 'valor_fixo' 
          then greatest(0.00, n.valor_total - v_orcamento.desconto_valor)
        else n.valor_total
      end,
      'duracao_total', n.duracao_total,
      'destaque', n.destaque,
      'ordem', n.ordem,
      'itens', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'servico_id', i.servico_id,
              'servico_nome', s.nome,
              'servico_descricao', s.descricao_publica,
              'preco', i.preco,
              'duracao_minutos', i.duracao_minutos
            ) order by i.ordem asc
          )
          from public.orcamento_nivel_itens i
          join public.servicos s on s.id = i.servico_id
          where i.nivel_id = n.id
        ), '[]'::jsonb
      )
    ) order by n.ordem asc
  ), '[]'::jsonb)
  into v_niveis_json
  from public.orcamento_niveis n
  where n.orcamento_id = v_orcamento.id;

  -- 9. Itens do Nível Aprovado (formato aceito por horarios_disponiveis)
  if v_orcamento.nivel_aprovado is not null then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'servico_id', i.servico_id,
          'combo_id', i.combo_id
        )
      ),
      '[]'::jsonb
    ) into v_itens_aprovados_json
    from public.orcamento_nivel_itens i
    join public.orcamento_niveis n on n.id = i.nivel_id
    where n.orcamento_id = v_orcamento.id and n.nivel = v_orcamento.nivel_aprovado;
  end if;

  return jsonb_build_object(
    'numero', v_orcamento.numero,
    'numero_os', coalesce(
      v_orcamento.numero_os, 
      case when v_tem_agendamento then (v_agendamento_json->>'numero_os')::integer else null end
    ),
    'titulo', v_orcamento.titulo,
    'observacoes', v_orcamento.observacoes,
    'status', v_status_atual,
    'nivel_aprovado', v_orcamento.nivel_aprovado,
    'categoria_id', v_orcamento.categoria_id,
    'itens_aprovados', v_itens_aprovados_json,
    'validade_dias', coalesce(v_orcamento.validade_dias, 7),
    'enviado_em', v_orcamento.enviado_em,
    'data_validade_limite', case when v_orcamento.enviado_em is not null then (v_orcamento.enviado_em::date + coalesce(v_orcamento.validade_dias, 7)) else null end,
    'alteracao_pendente', coalesce(v_orcamento.alteracao_pendente, false),
    'alteracao_historico', coalesce(v_orcamento.alteracao_historico, '[]'::jsonb),
    'desconto', v_desconto_json,
    'oficina', jsonb_build_object(
      'tenant_id', v_orcamento.tenant_id,
      'nome', v_tenant_nome,
      'logo_path', v_tenant_logo,
      'telefone', v_tenant_tel,
      'cidade', v_tenant_cidade,
      'uf', v_tenant_uf,
      'orcamento_agendamento_cliente', v_tenant_agendamento_cliente,
      'antecedencia_minima_horas', v_tenant_antecedencia_minima
    ),
    'cliente_primeiro_nome', v_primeiro_nome,
    'veiculo', v_veiculo_json,
    'agendamento', v_agendamento_json,
    'niveis', v_niveis_json
  );
end;
$$;

grant execute on function public.orcamento_publico(uuid) to anon, authenticated;


-- 3. RECRIE RPC RESPONDER_ORCAMENTO COM ASSINATURA UUID
create or replace function public.responder_orcamento(
  p_token uuid,
  p_nivel text,
  p_aceite boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_orcamento record;
  v_os_num integer;
begin
  select o.* into v_orcamento
  from public.orcamentos o
  where o.token_publico = p_token or o.id = p_token
  limit 1;

  if not found then
    raise exception 'Orçamento não encontrado.';
  end if;

  -- Valida se expirou (considerando enviado_em + validade_dias)
  if v_orcamento.status in ('enviado', 'visualizado') and v_orcamento.enviado_em is not null then
    if (v_orcamento.enviado_em::date + coalesce(v_orcamento.validade_dias, 7)) < current_date then
      update public.orcamentos set status = 'expirado', updated_at = now() where id = v_orcamento.id;
      raise exception 'Este orçamento está expirado e não aceita mais respostas.';
    end if;
  end if;

  if v_orcamento.status = 'expirado' then
    raise exception 'Este orçamento está expirado e não aceita mais respostas.';
  end if;

  if p_aceite then
    if p_nivel is null or p_nivel not in ('essencial', 'recomendado', 'completo') then
      raise exception 'Nível de orçamento inválido.';
    end if;

    if not exists (
      select 1 from public.orcamento_niveis
      where orcamento_id = v_orcamento.id and nivel = p_nivel
    ) then
      raise exception 'O nível escolhido não existe neste orçamento.';
    end if;

    -- Atribui número de OS se ainda não possuir
    v_os_num := v_orcamento.numero_os;
    if v_os_num is null then
      v_os_num := public.proximo_numero_os(v_orcamento.tenant_id);
    end if;

    update public.orcamentos
    set status = 'aprovado',
        nivel_aprovado = p_nivel,
        numero_os = v_os_num,
        respondido_em = now(),
        updated_at = now()
    where id = v_orcamento.id;
  else
    update public.orcamentos
    set status = 'recusado',
        nivel_aprovado = null,
        respondido_em = now(),
        updated_at = now()
    where id = v_orcamento.id;
  end if;
end;
$$;

grant execute on function public.responder_orcamento(uuid, text, boolean) to anon, authenticated;


-- 4. RECRIE RPC AGENDAR_ORCAMENTO_PUBLICO COM ASSINATURA UUID
create or replace function public.agendar_orcamento_publico(
  p_token uuid,
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
  v_antecedencia_minima integer;
  v_agendamento_cliente_habil boolean;
  v_min_inicio timestamptz;
  v_data date;
  v_hora time;
  v_is_disponivel boolean := false;
  v_agendamento_id uuid;
  v_itens_json jsonb := '[]'::jsonb;
  v_item record;
  v_servico_id_primeiro uuid;
  v_modo_item text;
  v_dias_item smallint;
  v_ordem smallint := 0;
begin
  select o.* into v_orcamento
  from public.orcamentos o
  where o.token_publico = p_token or o.id = p_token
  limit 1;

  if not found then
    raise exception 'Orçamento não encontrado.';
  end if;

  if v_orcamento.status = 'expirado' then
    raise exception 'Este orçamento está expirado e não pode ser agendado.';
  end if;

  if v_orcamento.status <> 'aprovado' or v_orcamento.nivel_aprovado is null then
    raise exception 'O orçamento precisa ser aprovado antes do agendamento.';
  end if;

  if v_orcamento.agendamento_id is not null then
    return v_orcamento.agendamento_id;
  end if;

  -- Configurações de agendamento online do tenant
  select coalesce(t.orcamento_agendamento_cliente, true), coalesce(t.antecedencia_minima_horas, 2)
  into v_agendamento_cliente_habil, v_antecedencia_minima
  from public.tenants t where t.id = v_orcamento.tenant_id;

  if not v_agendamento_cliente_habil then
    raise exception 'O agendamento online de orçamentos não está ativado nesta oficina.';
  end if;

  v_min_inicio := now() + (v_antecedencia_minima || ' hours')::interval;
  if p_inicio < v_min_inicio then
    raise exception 'Agendamento deve ser feito com antecedência mínima de % horas.', v_antecedencia_minima;
  end if;

  v_data := (p_inicio at time zone 'America/Sao_Paulo')::date;
  v_hora := (p_inicio at time zone 'America/Sao_Paulo')::time;

  -- Lock transacional por tenant e data
  perform pg_advisory_xact_lock(hashtext(v_orcamento.tenant_id::text || ':' || v_data::text));

  -- Obter dados do nível aprovado
  select n.* into v_nivel_rec
  from public.orcamento_niveis n
  where n.orcamento_id = v_orcamento.id and n.nivel = v_orcamento.nivel_aprovado;

  if not found then
    raise exception 'Dados do pacote aprovado não foram encontrados.';
  end if;

  -- Construir lista de itens do nível aprovado para verificação na RPC horarios_disponiveis
  select coalesce(
    jsonb_agg(jsonb_build_object('servico_id', servico_id, 'combo_id', combo_id)),
    '[]'::jsonb
  )
  into v_itens_json
  from public.orcamento_nivel_itens
  where nivel_id = v_nivel_rec.id;

  -- Validação de disponibilidade de horários
  select disponivel into v_is_disponivel
  from public.horarios_disponiveis(
    v_orcamento.tenant_id,
    v_data,
    v_itens_json,
    v_orcamento.categoria_id,
    null
  )
  where horario = v_hora;

  if not coalesce(v_is_disponivel, false) then
    raise exception 'O horário selecionado não está mais disponível na agenda.';
  end if;

  -- Primeiro serviço do nível aprovado para o campo servico_id legado
  select servico_id into v_servico_id_primeiro
  from public.orcamento_nivel_itens
  where nivel_id = v_nivel_rec.id
  order by ordem asc limit 1;

  if v_servico_id_primeiro is not null then
    select coalesce(s.modo_ocupacao, 'slot'), coalesce(s.dias_ocupados, 1)
    into v_modo_item, v_dias_item
    from public.servicos s
    where s.id = v_servico_id_primeiro;
  end if;

  -- Atribui número de OS se necessário
  if v_orcamento.numero_os is null then
    update public.orcamentos
    set numero_os = public.proximo_numero_os(v_orcamento.tenant_id)
    where id = v_orcamento.id;
  end if;

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
    criado_por
  ) values (
    v_orcamento.tenant_id,
    v_orcamento.cliente_id,
    v_orcamento.veiculo_id,
    v_orcamento.categoria_id,
    v_servico_id_primeiro,
    'online',
    'agendado',
    p_inicio,
    coalesce(v_nivel_rec.duracao_total, 60),
    coalesce(v_nivel_rec.duracao_total, 60),
    coalesce(v_modo_item, 'slot'),
    coalesce(v_modo_item, 'slot'),
    coalesce(v_dias_item, 1),
    v_nivel_rec.valor_total,
    v_nivel_rec.valor_total,
    coalesce(v_orcamento.observacoes, '') || ' (Agendado pelo cliente via Orçamento #' || v_orcamento.numero || ')',
    v_orcamento.criado_por
  )
  returning id into v_agendamento_id;

  for v_item in (
    select i.servico_id, i.combo_id, i.preco, i.duracao_minutos, i.ordem
    from public.orcamento_nivel_itens i
    where i.nivel_id = v_nivel_rec.id
    order by i.ordem asc
  ) loop
    select coalesce(s.modo_ocupacao, 'slot'), coalesce(s.dias_ocupados, 1)
    into v_modo_item, v_dias_item
    from public.servicos s
    where s.id = v_item.servico_id;

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
      v_orcamento.tenant_id,
      v_agendamento_id,
      v_item.servico_id,
      v_item.combo_id,
      coalesce(v_item.duracao_minutos, 60),
      v_item.preco,
      coalesce(v_modo_item, 'slot'),
      coalesce(v_dias_item, 1),
      v_ordem
    );

    v_ordem := v_ordem + 1;
  end loop;

  perform public.recalcular_agendamento_totais(v_agendamento_id);

  update public.orcamentos
  set agendamento_id = v_agendamento_id,
      updated_at = now()
  where id = v_orcamento.id;

  return v_agendamento_id;
end;
$$;

grant execute on function public.agendar_orcamento_publico(uuid, timestamptz) to anon, authenticated;

-- 5. NOTIFICA POSTGREST PARA RECARREGAR SCHEMA
notify pgrst, 'reload schema';
