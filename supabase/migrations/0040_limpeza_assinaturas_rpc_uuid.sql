  -- Migration 0040: Padronização Estrita das RPCs Públicas para Parâmetro UUID e Remoção de Duplicatas TEXT
  -- Esta migration garante a remoção de todas as sobrecargas TEXT e valida a unicidade das RPCs públicas.

  -- 1. DROPS EXPLÍCITOS DE TODAS AS ASSINATURAS (TEXT E UUID)
  drop function if exists public.orcamento_publico(text);
  drop function if exists public.orcamento_publico(uuid);

  drop function if exists public.responder_orcamento(text, text, boolean);
  drop function if exists public.responder_orcamento(uuid, text, boolean);

  drop function if exists public.agendar_orcamento_publico(text, timestamptz);
  drop function if exists public.agendar_orcamento_publico(uuid, timestamptz);

  drop function if exists public.confirmar_alteracao_orcamento(text, text, text);
  drop function if exists public.confirmar_alteracao_orcamento(uuid, text, text);

  drop function if exists public.vistoria_publica(text);
  drop function if exists public.vistoria_publica(uuid);

  drop function if exists public.aceitar_vistoria_remoto(text, text, text, text);
  drop function if exists public.aceitar_vistoria_remoto(uuid, text, text, text);
  drop function if exists public.aceitar_vistoria_remoto(text, text, text, text, text);
  drop function if exists public.aceitar_vistoria_remoto(uuid, text, text, text, text);


  -- 2. RECRIAR RPC ORCAMENTO_PUBLICO(UUID)
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

    -- Valida expiração (enviado_em + validade_dias)
    if v_status_atual in ('enviado', 'visualizado') and v_orcamento.enviado_em is not null then
      if (v_orcamento.enviado_em::date + coalesce(v_orcamento.validade_dias, 7)) < current_date then
        v_status_atual := 'expirado';
        update public.orcamentos
        set status = 'expirado', updated_at = now()
        where id = v_orcamento.id;
      end if;
    end if;

    -- Primeira visualização
    if v_status_atual = 'enviado' then
      v_status_atual := 'visualizado';
      update public.orcamentos
      set status = 'visualizado',
          visualizado_em = coalesce(visualizado_em, now()),
          updated_at = now()
      where id = v_orcamento.id;
    end if;

    -- Informações da Oficina
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

    -- Cliente (Primeiro nome)
    select c.nome into v_cliente_nome from public.clientes c where c.id = v_orcamento.cliente_id;
    v_primeiro_nome := split_part(coalesce(v_cliente_nome, 'Cliente'), ' ', 1);

    -- Veículo
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

    -- Agendamento vinculado
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

    -- Desconto concedido
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

    -- Construção dos Níveis e Itens
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

    -- Itens do Nível Aprovado
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


  -- 3. RECRIAR RPC RESPONDER_ORCAMENTO(UUID)
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


  -- 4. RECRIAR RPC AGENDAR_ORCAMENTO_PUBLICO(UUID)
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
    v_os_num integer;
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

    perform pg_advisory_xact_lock(hashtext(v_orcamento.tenant_id::text || ':' || v_data::text));

    select n.* into v_nivel_rec
    from public.orcamento_niveis n
    where n.orcamento_id = v_orcamento.id and n.nivel = v_orcamento.nivel_aprovado;

    if not found then
      raise exception 'Dados do pacote aprovado não foram encontrados.';
    end if;

    select coalesce(
      jsonb_agg(jsonb_build_object('servico_id', servico_id, 'combo_id', combo_id)),
      '[]'::jsonb
    )
    into v_itens_json
    from public.orcamento_nivel_itens
    where nivel_id = v_nivel_rec.id;

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

    v_os_num := v_orcamento.numero_os;
    if v_os_num is null then
      v_os_num := public.proximo_numero_os(v_orcamento.tenant_id);
      update public.orcamentos
      set numero_os = v_os_num,
          updated_at = now()
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
      criado_por,
      numero_os
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
      v_orcamento.criado_por,
      v_os_num
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


  -- 5. RECRIAR RPC VISTORIA_PUBLICA(UUID)
  create or replace function public.vistoria_publica(p_token uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  as $$
  #variable_conflict use_column
  declare
    v_checkin record;
    v_oficina record;
    v_cliente record;
    v_veiculo record;
    v_avarias jsonb;
    v_fotos jsonb;
    v_result jsonb;
  begin
    if p_token is null then
      return jsonb_build_object('erro', 'Token inválido');
    end if;

    select c.* into v_checkin
    from public.checkins c
    where c.token_aceite = p_token;

    if not found then
      return jsonb_build_object('erro', 'Vistoria não encontrada');
    end if;

    select
      coalesce(t.razao_social, t.nome, 'Oficina') as nome,
      t.logo_path as logo_url,
      t.cidade as cidade,
      t.telefone as telefone
    into v_oficina
    from public.tenants t
    where t.id = v_checkin.tenant_id;

    select
      split_part(cl.nome, ' ', 1) as primeiro_nome
    into v_cliente
    from public.agendamentos a
    join public.clientes cl on cl.id = a.cliente_id
    where a.id = v_checkin.agendamento_id;

    select
      v.modelo,
      v.placa
    into v_veiculo
    from public.veiculos v
    where v.id = v_checkin.veiculo_id;

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'vista', ca.vista,
        'pos_x', ca.pos_x,
        'pos_y', ca.pos_y,
        'tipo', ca.tipo,
        'descricao', ca.descricao
      )
    ), '[]'::jsonb)
    into v_avarias
    from public.checkin_avarias ca
    where ca.checkin_id = v_checkin.id;

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'foto_url', cf.path,
        'descricao', cf.descricao,
        'created_at', cf.created_at
      )
    ), '[]'::jsonb)
    into v_fotos
    from public.checkin_fotos cf
    where cf.checkin_id = v_checkin.id;

    v_result := jsonb_build_object(
      'oficina', jsonb_build_object(
        'nome', coalesce(v_oficina.nome, 'Oficina'),
        'logo_url', v_oficina.logo_url,
        'cidade', v_oficina.cidade,
        'telefone', v_oficina.telefone
      ),
      'cliente', jsonb_build_object(
        'primeiro_nome', coalesce(v_cliente.primeiro_nome, 'Cliente')
      ),
      'veiculo', jsonb_build_object(
        'modelo', coalesce(v_veiculo.modelo, 'Veículo'),
        'placa', coalesce(v_veiculo.placa, '---')
      ),
      'km', v_checkin.km,
      'nivel_combustivel', v_checkin.nivel_combustivel,
      'iluminacao', v_checkin.iluminacao,
      'sujidade', v_checkin.sujidade,
      'fluidos', v_checkin.fluidos,
      'luzes_painel', v_checkin.luzes_painel,
      'estepe', v_checkin.estepe,
      'observacoes', v_checkin.observacoes,
      'avarias', v_avarias,
      'fotos', v_fotos,
      'finalizado', v_checkin.finalizado,
      'finalizado_em', v_checkin.assinado_em,
      'assinatura_url', v_checkin.assinatura_path,
      'assinante_nome', v_checkin.assinatura_nome,
      'aceite_tipo', v_checkin.aceite_tipo,
      'enviado_em', v_checkin.enviado_em
    );

    return v_result;
  end;
  $$;

  grant execute on function public.vistoria_publica(uuid) to anon, authenticated;


  -- 6. RECRIAR RPC ACEITAR_VISTORIA_REMOTO(UUID)
  create or replace function public.aceitar_vistoria_remoto(
    p_token uuid,
    p_assinatura_base64 text,
    p_nome text,
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
    v_checkin record;
    v_tentativas integer;
    v_nome_limpo text;
  begin
    if p_token is null then
      raise exception 'Token de vistoria inválido.';
    end if;

    select * into v_checkin
    from public.checkins c
    where c.token_aceite = p_token
    for update;

    if not found then
      raise exception 'Vistoria não encontrada.';
    end if;

    v_tentativas := coalesce(v_checkin.tentativas_aceite, 0) + 1;
    update public.checkins
    set tentativas_aceite = v_tentativas
    where id = v_checkin.id;

    if v_tentativas > 10 then
      raise exception 'Muitas tentativas. Entre em contato com a oficina.';
    end if;

    if v_checkin.enviado_em is null then
      raise exception 'Esta vistoria não foi enviada para aceite remoto.';
    end if;

    if v_checkin.finalizado then
      raise exception 'Esta vistoria já se encontra finalizada e assinada.';
    end if;

    v_nome_limpo := trim(coalesce(p_nome, ''));
    if length(v_nome_limpo) < 3 then
      raise exception 'O nome do assinante deve conter no mínimo 3 caracteres.';
    end if;

    if p_assinatura_base64 is null or (
      not (p_assinatura_base64 like 'data:image/png;base64,%' or p_assinatura_base64 like 'data:image/jpeg;base64,%')
    ) then
      raise exception 'Formato de imagem da assinatura inválido. Deve ser PNG ou JPEG em base64.';
    end if;

    if length(p_assinatura_base64) > 500000 then
      raise exception 'Tamanho da imagem da assinatura excede o limite permitido.';
    end if;

    update public.checkins
    set
      finalizado = true,
      assinado_em = now(),
      aceite_tipo = 'remoto',
      assinatura_path = p_assinatura_base64,
      assinatura_nome = v_nome_limpo,
      aceite_user_agent = p_user_agent,
      aceite_ip = p_ip
    where id = v_checkin.id;

    return jsonb_build_object(
      'sucesso', true,
      'mensagem', 'Vistoria assinada com sucesso.'
    );
  end;
  $$;

  -- 8. TRIGGER TRAVA: GARANTIR NUMERO_OS EM QUALQUER INSERT EM AGENDAMENTOS
  create or replace function public.tg_garantir_numero_os()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $$
  begin
    if NEW.numero_os is null then
      NEW.numero_os := public.proximo_numero_os(NEW.tenant_id);
    end if;
    return NEW;
  end;
  $$;

  drop trigger if exists trg_garantir_numero_os on public.agendamentos;
  create trigger trg_garantir_numero_os
    before insert on public.agendamentos
    for each row
    execute function public.tg_garantir_numero_os();


  -- 9. BACKFILL DOS AGENDAMENTOS SEM NUMERO_OS E SINCRONIZAÇÃO DO CONTADOR
  with faltantes as (
    select id, tenant_id,
           row_number() over (partition by tenant_id order by created_at) as n
    from public.agendamentos where numero_os is null
  ),
  base as (
    select tenant_id, coalesce(max(numero_os), 0) as ultimo
    from public.agendamentos where numero_os is not null
    group by tenant_id
  )
  update public.agendamentos a
  set numero_os = coalesce(b.ultimo, 0) + f.n
  from faltantes f
  left join base b on b.tenant_id = f.tenant_id
  where a.id = f.id;

  update public.tenant_contadores tc
  set proxima_os = sub.maior + 1
  from (
    select tenant_id, max(numero_os) as maior
    from public.agendamentos group by tenant_id
  ) sub
  where tc.tenant_id = sub.tenant_id
    and tc.proxima_os <= sub.maior;


  -- 10. NOTIFICAR POSTGREST
  notify pgrst, 'reload schema';


  -- 8. VERIFICAÇÃO AUTOMÁTICA DE UNICIDADE (FALHA SE SOBER SOBRECARGA COM PARAMETRO TEXT)
  do $$
  declare
    v_dup_count integer;
    v_dup_list text;
  begin
    select count(*), string_agg(p.oid::regprocedure::text, ', ')
    into v_dup_count, v_dup_list
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'orcamento_publico',
        'responder_orcamento',
        'agendar_orcamento_publico',
        'vistoria_publica',
        'aceitar_vistoria_remoto'
      )
      and exists (
        select 1 
        from unnest(p.proargtypes) argtype 
        join pg_type t on t.oid = argtype 
        where t.typname = 'text' and p.proargtypes[0] = argtype
      );

    if v_dup_count > 0 then
      raise exception 'ERRO DE INTEGRIDADE: Foram encontradas assinaturas legadas com primeiro parâmetro TEXT: %', v_dup_list;
    end if;
  end;
  $$;
