  -- Migration 0037: Correção de Orçamento Não Encontrado (Unassigned Record Fix & Universal Token Parsing), Validade Padrão do Tenant, Conversão Automática para OS e Correção de Horários Disponíveis

  -- 1. ADICIONA COLUNA DE VALIDADE PADRÃO DOS ORÇAMENTOS NA TABELA TENANTS
  alter table public.tenants
    add column if not exists orcamento_validade_dias integer not null default 7;

  -- 2. DROP EXPLICITO DE TODAS AS ASSINATURAS DUPLICADAS PARA EVITAR ERRO PGRST203 (POSTGREST AMBIGUITY)
  drop function if exists public.responder_orcamento(uuid, text, boolean);
  drop function if exists public.responder_orcamento(text, text, boolean);

  drop function if exists public.orcamento_publico(uuid);
  drop function if exists public.orcamento_publico(text);

  drop function if exists public.confirmar_alteracao_orcamento(uuid, text, text);
  drop function if exists public.confirmar_alteracao_orcamento(text, text, text);

  drop function if exists public.horarios_disponiveis(uuid, date, uuid, uuid, uuid);
  drop function if exists public.horarios_disponiveis(uuid, date, jsonb, uuid, uuid);

  drop function if exists public.agendar_orcamento_publico(uuid, timestamptz);
  drop function if exists public.agendar_orcamento_publico(text, timestamptz);

  -- 3. ATUALIZA RPC RESPONDER_ORCAMENTO COM ASSINATURA UUID
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

  -- 4. REESCREVE A RPC ORCAMENTO_PUBLICO COM ASSINATURA UUID
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
    v_is_expirado boolean := false;
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

    -- Valida expiração em tempo real baseada em enviado_em + validade_dias
    if v_status_atual in ('enviado', 'visualizado') and v_orcamento.enviado_em is not null then
      if (v_orcamento.enviado_em::date + coalesce(v_orcamento.validade_dias, 7)) < current_date then
        v_is_expirado := true;
        v_status_atual := 'expirado';

        update public.orcamentos
        set status = 'expirado', updated_at = now()
        where id = v_orcamento.id;
      end if;
    end if;

    -- Primeira visualização pelo cliente
    if v_status_atual = 'enviado' and not v_is_expirado then
      update public.orcamentos
      set status = 'visualizado',
          visualizado_em = coalesce(visualizado_em, now()),
          updated_at = now()
      where id = v_orcamento.id;
      
      v_status_atual := 'visualizado';
    end if;

    -- Informações públicas da oficina (Tenants)
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

    -- Cliente (Primeiro nome para personalização)
    select c.nome into v_cliente_nome from public.clientes c where c.id = v_orcamento.cliente_id;
    v_primeiro_nome := split_part(coalesce(v_cliente_nome, 'Cliente'), ' ', 1);

    -- Veículo (Construção segura em JSON se existir)
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

    -- Agendamento vinculado (Construção segura em JSON se existir)
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

    -- Nome do responsável pelo desconto (se houver)
    if v_orcamento.desconto_aplicado_por is not null then
      select p.nome into v_usuario_desconto_nome
      from public.profiles p
      where p.id = v_orcamento.desconto_aplicado_por;
    end if;

    -- Estrutura de Desconto Concedido
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

    -- Construção dos níveis com recalculo de preços com desconto
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

    -- Monta itens do nível aprovado (se houver nível aprovado)
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

  -- 5. ATUALIZA RPC CONFIRMAR_ALTERACAO_ORCAMENTO COM SUPORTE A TEXT
  create or replace function public.confirmar_alteracao_orcamento(
    p_token text,
    p_assinatura_base64 text,
    p_nome_assinante text default null
  )
  returns void
  language plpgsql
  security definer
  set search_path = public
  as $$
  #variable_conflict use_column
  declare
    v_orcamento record;
    v_token_uuid uuid;
    v_numero_int integer;
  begin
    begin
      v_token_uuid := p_token::uuid;
    exception when others then
      v_token_uuid := null;
    end;

    begin
      v_numero_int := regexp_replace(p_token, '\D', '', 'g')::integer;
    exception when others then
      v_numero_int := null;
    end;

    select o.* into v_orcamento
    from public.orcamentos o
    where (v_token_uuid is not null and (o.token_publico = v_token_uuid or o.id = v_token_uuid))
      or (v_numero_int is not null and (o.numero = v_numero_int or o.numero_os = v_numero_int))
    limit 1;

    if not found then
      raise exception 'Orçamento não encontrado.';
    end if;

    update public.orcamentos
    set alteracao_pendente = false,
        assinatura_alteracao_url = p_assinatura_base64,
        assinatura_alteracao_em = now(),
        updated_at = now()
    where id = v_orcamento.id;
  end;
  $$;

  grant execute on function public.confirmar_alteracao_orcamento(text, text, text) to anon, authenticated;

  -- 6. ATUALIZA RPC HORARIOS_DISPONIVEIS COM SUPORTE COMPLETO A MULTI-SERVIÇOS E MODOS DE OCUPAÇÃO (TRANSBORDA, MULTIPLOS DIAS, DIA INTEIRO E SLOT)
  create or replace function public.horarios_disponiveis(
    p_tenant uuid,
    p_data date,
    p_itens jsonb default null,
    p_categoria uuid default null,
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
                select h.abre into v_calc_horario from public.horarios_funcionamento h where h.tenant_id = p_tenant and h.dia_semana = v_calc_dow and h.ativo;
                if found then
                  v_calc_start := (v_calc_date || ' ' || v_calc_horario.abre)::timestamp at time zone 'America/Sao_Paulo';
                end if;
              end if;
            else
              v_calc_date := v_calc_date + interval '1 day';
              v_calc_start := (v_calc_date || ' ' || v_horario_func.abre)::timestamp at time zone 'America/Sao_Paulo';
            end if;
          else
            v_calc_date := v_calc_date + interval '1 day';
            v_calc_start := (v_calc_date || ' ' || v_horario_func.abre)::timestamp at time zone 'America/Sao_Paulo';
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
      return next;

      v_slot_time := (v_slot_time + (v_grade_minutos || ' minutes')::interval)::time;
    end loop;
  end;
  $$;

  grant execute on function public.horarios_disponiveis(uuid, date, jsonb, uuid, uuid) to anon, authenticated;

  -- 7. ATUALIZA RPC AGENDAR_ORCAMENTO_PUBLICO COM ASSINATURA ÚNICA DE TEXT E WRAPPER DE UUID
  create or replace function public.agendar_orcamento_publico(
    p_token text,
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
    v_token_uuid uuid;
    v_numero_int integer;
    v_item record;
    v_servico_id_primeiro uuid;
    v_modo_item text;
    v_dias_item smallint;
    v_ordem smallint := 0;
  begin
    begin
      v_token_uuid := p_token::uuid;
    exception when others then
      v_token_uuid := null;
    end;

    begin
      v_numero_int := regexp_replace(p_token, '\D', '', 'g')::integer;
    exception when others then
      v_numero_int := null;
    end;

    select o.* into v_orcamento
    from public.orcamentos o
    where (v_token_uuid is not null and (o.token_publico = v_token_uuid or o.id = v_token_uuid))
      or (v_numero_int is not null and (o.numero = v_numero_int or o.numero_os = v_numero_int))
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

    select * into v_nivel_rec
    from public.orcamento_niveis
    where orcamento_id = v_orcamento.id and nivel = v_orcamento.nivel_aprovado;

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
      valor_total,
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

  -- 8. BACKFILL: CONVERTE ORÇAMENTOS APROVADOS EXISTENTES SEM NÚMERO DE OS PARA OS
  do $$
  declare
    r record;
    v_os integer;
  begin
    for r in select id, tenant_id from public.orcamentos where status = 'aprovado' and numero_os is null loop
      v_os := public.proximo_numero_os(r.tenant_id);
      update public.orcamentos set numero_os = v_os where id = r.id;
    end loop;
  end;
  $$;

  -- 9. NOTIFICA O POSTGREST PARA RECARREGAR O SCHEMA E ELIMINAR O CACHE ANTERIOR
  notify pgrst, 'reload schema';
