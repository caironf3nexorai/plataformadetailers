  -- Migration 0034: Permite que clientes escolham horário ao aprovar orçamento online

  -- 1. Novas colunas em public.tenants
  alter table public.tenants
    add column if not exists orcamento_agendamento_cliente boolean not null default true,
    add column if not exists antecedencia_minima_horas smallint not null default 2;

  -- 2. Atualiza orcamento_publico para retornar configuracoes de agendamento online e agendamento existente
  create or replace function public.orcamento_publico(p_token uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  as $$
  #variable_conflict use_column
  declare
    v_orcamento record;
    
    -- Variáveis escalares tipadas (evita erro "record not assigned yet")
    v_tenant_id uuid;
    v_tenant_nome text;
    v_tenant_logo_path text;
    v_tenant_telefone text;
    v_tenant_cidade text;
    v_tenant_uf text;
    v_tenant_agendamento_cliente boolean;
    v_tenant_antecedencia_minima smallint;

    v_cliente_nome text;

    v_veiculo_placa text := null;
    v_veiculo_modelo text := null;
    v_veiculo_marca text := null;

    v_agendamento_id uuid := null;
    v_agendamento_inicio timestamptz := null;
    v_agendamento_status text := null;

    v_niveis_json jsonb;
    v_primeiro_nome text;
    v_is_expirado boolean := false;
    v_status_atual text;
    v_servico_principal_id uuid := null;
  begin
    select o.* into v_orcamento from public.orcamentos o where o.token_publico = p_token;
    if not found then
      return jsonb_build_object('erro', 'Orçamento não encontrado');
    end if;

    v_status_atual := v_orcamento.status;

    -- Valida se está expirado no momento do acesso
    if v_status_atual in ('enviado', 'visualizado') and v_orcamento.enviado_em is not null then
      if (v_orcamento.enviado_em::date + v_orcamento.validade_dias) < current_date then
        v_is_expirado := true;
        v_status_atual := 'expirado';

        update public.orcamentos
        set status = 'expirado', updated_at = now()
        where id = v_orcamento.id;
      end if;
    end if;

    -- Registra primeira visualização se ainda 'enviado' e dentro da validade
    if v_status_atual = 'enviado' and not v_is_expirado then
      update public.orcamentos
      set status = 'visualizado',
          visualizado_em = coalesce(visualizado_em, now()),
          updated_at = now()
      where id = v_orcamento.id;
      
      v_status_atual := 'visualizado';
    end if;

    -- Informações públicas da oficina (variáveis escalares)
    select t.id, t.nome, t.logo_path, t.telefone, t.cidade, t.uf,
          coalesce(t.orcamento_agendamento_cliente, true),
          coalesce(t.antecedencia_minima_horas, 2)
    into v_tenant_id, v_tenant_nome, v_tenant_logo_path, v_tenant_telefone, v_tenant_cidade, v_tenant_uf,
        v_tenant_agendamento_cliente, v_tenant_antecedencia_minima
    from public.tenants t where t.id = v_orcamento.tenant_id;

    -- Cliente
    select c.nome into v_cliente_nome from public.clientes c where c.id = v_orcamento.cliente_id;
    v_primeiro_nome := split_part(coalesce(v_cliente_nome, 'Cliente'), ' ', 1);

    -- Veículo (apenas se veiculo_id não for nulo)
    if v_orcamento.veiculo_id is not null then
      select v.placa, v.modelo, v.marca
      into v_veiculo_placa, v_veiculo_modelo, v_veiculo_marca
      from public.veiculos v where v.id = v_orcamento.veiculo_id;
    end if;

    -- Dados do agendamento (apenas se agendamento_id não for nulo)
    if v_orcamento.agendamento_id is not null then
      select a.id, a.inicio, a.status
      into v_agendamento_id, v_agendamento_inicio, v_agendamento_status
      from public.agendamentos a where a.id = v_orcamento.agendamento_id;
    end if;

    -- Busca o primeiro serviço do nível recomendado ou essencial para consulta de horários
    select i.servico_id into v_servico_principal_id
    from public.orcamento_niveis n
    join public.orcamento_nivel_itens i on i.nivel_id = n.id
    where n.orcamento_id = v_orcamento.id
    order by case when n.nivel = 'recomendado' then 1 else 2 end, i.ordem asc
    limit 1;

    -- Níveis e serviços em formato limpo
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'nivel', n.nivel,
        'titulo', n.titulo,
        'descricao', n.descricao,
        'valor_total', n.valor_total,
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

    return jsonb_build_object(
      'numero', v_orcamento.numero,
      'titulo', v_orcamento.titulo,
      'observacoes', v_orcamento.observacoes,
      'status', v_status_atual,
      'nivel_aprovado', v_orcamento.nivel_aprovado,
      'categoria_id', v_orcamento.categoria_id,
      'servico_principal_id', v_servico_principal_id,
      'validade_dias', v_orcamento.validade_dias,
      'enviado_em', v_orcamento.enviado_em,
      'data_validade_limite', case when v_orcamento.enviado_em is not null then (v_orcamento.enviado_em::date + v_orcamento.validade_dias) else null end,
      'oficina', jsonb_build_object(
        'tenant_id', v_tenant_id,
        'nome', coalesce(v_tenant_nome, 'Oficina'),
        'logo_path', v_tenant_logo_path,
        'telefone', v_tenant_telefone,
        'cidade', v_tenant_cidade,
        'uf', v_tenant_uf,
        'orcamento_agendamento_cliente', coalesce(v_tenant_agendamento_cliente, true),
        'antecedencia_minima_horas', coalesce(v_tenant_antecedencia_minima, 2)
      ),
      'cliente_primeiro_nome', v_primeiro_nome,
      'veiculo', case when v_veiculo_placa is not null then jsonb_build_object(
        'placa', v_veiculo_placa,
        'modelo', v_veiculo_modelo,
        'marca', v_veiculo_marca
      ) else null end,
      'agendamento', case when v_agendamento_id is not null then jsonb_build_object(
        'id', v_agendamento_id,
        'inicio', v_agendamento_inicio,
        'status', v_agendamento_status
      ) else null end,
      'niveis', v_niveis_json
    );
  end;
  $$;

  grant execute on function public.orcamento_publico(uuid) to anon, authenticated;

  -- 3. RPC AGENDAR_ORCAMENTO_PUBLICO (CLIENTE SELECIONA DATA E HORA DEPOIS DE APROVAR)
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
    v_antecedencia_minima smallint;
    v_agendamento_cliente_habil boolean;
    v_nivel_rec record;
    v_servico_principal uuid;
    v_modo_ocupacao text := 'slot';
    v_dias_ocupados smallint := 1;
    v_agendamento_id uuid;
    v_data date;
    v_hora time;
    v_is_disponivel boolean := false;
    v_min_inicio timestamptz;
  begin
    select o.* into v_orcamento from public.orcamentos o where o.token_publico = p_token;
    if not found then
      raise exception 'Orçamento não encontrado.';
    end if;

    if v_orcamento.status <> 'aprovado' then
      raise exception 'Apenas orçamentos aprovados podem ser agendados.';
    end if;

    if v_orcamento.agendamento_id is not null then
      return v_orcamento.agendamento_id;
    end if;

    select coalesce(t.antecedencia_minima_horas, 2), coalesce(t.orcamento_agendamento_cliente, true)
    into v_antecedencia_minima, v_agendamento_cliente_habil
    from public.tenants t where t.id = v_orcamento.tenant_id;

    if not v_agendamento_cliente_habil then
      raise exception 'O agendamento automático pelo cliente não está habilitado para esta oficina.';
    end if;

    v_min_inicio := now() + (v_antecedencia_minima || ' hours')::interval;
    if p_inicio < v_min_inicio then
      raise exception 'O horário escolhido deve ter antecedência mínima de % horas.', v_antecedencia_minima;
    end if;

    v_data := (p_inicio at time zone 'America/Sao_Paulo')::date;
    v_hora := date_trunc('minute', (p_inicio at time zone 'America/Sao_Paulo'))::time;

    -- Lock por tenant e data para evitar corrida
    perform pg_advisory_xact_lock(hashtext(v_orcamento.tenant_id::text), hashtext(v_data::text));

    -- Busca o nível aprovado
    select n.* into v_nivel_rec
    from public.orcamento_niveis n
    where n.orcamento_id = v_orcamento.id and n.nivel = v_orcamento.nivel_aprovado;

    if not found then
      raise exception 'Nível aprovado não encontrado.';
    end if;

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

    -- Revalidação rigorosa de disponibilidade no servidor
    select disponivel into v_is_disponivel
    from public.horarios_disponiveis(
      v_orcamento.tenant_id,
      v_data,
      v_servico_principal,
      v_orcamento.categoria_id,
      null
    ) hd
    where hd.horario = v_hora;

    if not coalesce(v_is_disponivel, false) then
      raise exception 'O horário selecionado não está mais disponível. Por favor, escolha outro horário.';
    end if;

    -- Cria o agendamento com todos os campos NOT NULL preenchidos
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
      observacoes
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
      coalesce(v_nivel_rec.valor_total, 0),
      coalesce(v_nivel_rec.valor_total, 0),
      'agendado',
      'online',
      coalesce(v_orcamento.observacoes, '') || ' (Agendado pelo cliente via Orçamento #' || v_orcamento.numero || ' - ' || v_nivel_rec.titulo || ')'
    ) returning id into v_agendamento_id;

    -- Inserir itens do agendamento
    insert into public.agendamento_itens (
      tenant_id, agendamento_id, servico_id, combo_id, duracao_minutos, preco_estimado, modo_ocupacao, dias_ocupados, ordem
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

    -- Vincula o agendamento ao orçamento
    update public.orcamentos
    set agendamento_id = v_agendamento_id,
        updated_at = now()
    where id = v_orcamento.id;

    return v_agendamento_id;
  end;
  $$;

  grant execute on function public.agendar_orcamento_publico(uuid, timestamptz) to anon, authenticated;
  grant execute on function public.horarios_disponiveis(uuid, date, jsonb, uuid, uuid) to anon, authenticated;
  grant execute on function public.horarios_disponiveis(uuid, date, uuid, uuid, uuid) to anon, authenticated;
