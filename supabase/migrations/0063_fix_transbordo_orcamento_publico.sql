-- Migration 0063: Suporte Completo a Transbordo, Agendamento Público e Cobrança de Sinal Pix

-- 1. RPC horarios_disponiveis: libera horários com transbordo por padrão
CREATE OR REPLACE FUNCTION public.horarios_disponiveis(
  p_tenant uuid,
  p_data date,
  p_itens jsonb DEFAULT NULL,
  p_categoria uuid DEFAULT NULL,
  p_ignorar_agendamento uuid DEFAULT NULL
) RETURNS TABLE (
  horario time,
  disponivel boolean,
  motivo text,
  termino_previsto timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
#variable_conflict use_column
DECLARE
  v_dia_semana smallint;
  v_horario_func record;
  v_grade_minutos smallint;
  v_duracao_total_itens integer := 0;
  v_modo_efetivo text := 'transborda';
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
BEGIN
  v_dia_semana := extract(dow from p_data)::smallint;

  SELECT * INTO v_horario_func
  FROM public.horarios_funcionamento h
  WHERE h.tenant_id = p_tenant AND h.dia_semana = v_dia_semana AND h.ativo;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT coalesce(t.grade_minutos, 60) INTO v_grade_minutos
  FROM public.tenants t WHERE t.id = p_tenant;

  IF p_itens IS NOT NULL AND jsonb_array_length(p_itens) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
      v_servico_id := (v_item->>'servico_id')::uuid;

      SELECT 
        coalesce(sp.duracao_minutos, 60),
        coalesce(v_item->>'modo_ocupacao', s.modo_ocupacao, 'transborda'),
        coalesce(s.dias_ocupados, 1)
      INTO v_dur_item, v_modo_item, v_dias_item
      FROM public.servicos s
      LEFT JOIN public.servico_precos sp
        ON sp.servico_id = s.id
       AND (p_categoria IS NULL OR sp.categoria_id = p_categoria)
       AND sp.ativo
      WHERE s.id = v_servico_id AND s.tenant_id = p_tenant
      LIMIT 1;

      IF FOUND THEN
        v_duracao_total_itens := v_duracao_total_itens + coalesce(v_dur_item, 60);
        IF v_dias_item > v_max_dias THEN v_max_dias := v_dias_item; END IF;
        
        IF v_modo_item = 'multiplos_dias' THEN
          v_modo_efetivo := 'multiplos_dias';
        ELSIF v_modo_item = 'dia_inteiro' AND v_modo_efetivo <> 'multiplos_dias' THEN
          v_modo_efetivo := 'dia_inteiro';
        ELSIF v_modo_efetivo NOT IN ('multiplos_dias', 'dia_inteiro') THEN
          v_modo_efetivo := 'transborda';
        END IF;
      END IF;
    END LOOP;
  ELSE
    v_modo_efetivo := 'transborda';
  END IF;

  IF v_duracao_total_itens = 0 THEN
    v_duracao_total_itens := 60;
  END IF;

  v_agora_sp := now() AT TIME ZONE 'America/Sao_Paulo';

  SELECT count(*) INTO v_total_agendamentos_dia
  FROM public.agendamentos a
  WHERE a.tenant_id = p_tenant
    AND a.status NOT IN ('cancelado', 'nao_compareceu')
    AND (p_ignorar_agendamento IS NULL OR a.id <> p_ignorar_agendamento)
    AND (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date <= p_data
    AND ((a.inicio AT TIME ZONE 'America/Sao_Paulo')::date + (coalesce(a.dias_ocupados, 1) - 1)) >= p_data;

  v_slot_time := v_horario_func.abre;
  v_fechamento_ts := (p_data || ' ' || v_horario_func.fecha)::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_pos_index := 0;

  WHILE v_slot_time <= (v_horario_func.fecha - (v_grade_minutos || ' minutes')::interval) LOOP
    v_pos_index := v_pos_index + 1;
    v_posicao_inicio := (p_data || ' ' || v_slot_time)::timestamp AT TIME ZONE 'America/Sao_Paulo';

    v_is_disponivel := true;
    v_motivo_indisponivel := null;

    -- Calcula término efetivo
    v_posicao_fim := public.calcular_fim_efetivo(p_tenant, v_posicao_inicio, v_duracao_total_itens, v_modo_efetivo);

    IF v_modo_efetivo = 'transborda' THEN
      v_janela_fim_dia1 := CASE WHEN v_posicao_fim < v_fechamento_ts THEN v_posicao_fim ELSE v_fechamento_ts END;
    ELSE
      v_janela_fim_dia1 := v_posicao_fim;
    END IF;

    IF v_modo_efetivo = 'dia_inteiro' THEN
      IF v_pos_index > 1 THEN
        v_is_disponivel := false;
        v_motivo_indisponivel := 'dia_inteiro';
      ELSIF v_total_agendamentos_dia > 0 THEN
        v_is_disponivel := false;
        v_motivo_indisponivel := 'dia_reservado';
      END IF;
    END IF;

    IF v_modo_efetivo = 'multiplos_dias' THEN
      IF v_pos_index > 1 THEN
        v_is_disponivel := false;
        v_motivo_indisponivel := 'multiplos_dias';
      END IF;
    END IF;

    IF v_modo_efetivo = 'slot' AND v_is_disponivel AND v_posicao_fim > v_fechamento_ts THEN
      v_is_disponivel := false;
      v_motivo_indisponivel := 'nao_cabe_no_expediente';
    END IF;

    IF v_is_disponivel AND v_posicao_inicio < v_agora_sp THEN
      v_is_disponivel := false;
      v_motivo_indisponivel := 'passado';
    END IF;

    IF v_is_disponivel THEN
      SELECT exists(
        SELECT 1 FROM public.bloqueios_agenda b
        WHERE b.tenant_id = p_tenant
          AND b.inicio < v_janela_fim_dia1
          AND b.fim > v_posicao_inicio
      ) INTO v_sobrepoem_bloqueio;

      IF v_sobrepoem_bloqueio THEN
        v_is_disponivel := false;
        v_motivo_indisponivel := 'bloqueado';
      END IF;
    END IF;

    IF v_is_disponivel THEN
      SELECT exists(
        SELECT 1 FROM public.agendamentos a
        WHERE a.tenant_id = p_tenant
          AND a.status NOT IN ('cancelado', 'nao_compareceu')
          AND (p_ignorar_agendamento IS NULL OR a.id <> p_ignorar_agendamento)
          AND coalesce(a.modo_ocupacao_efetivo, a.modo_ocupacao) IN ('dia_inteiro', 'multiplos_dias')
          AND (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date <= p_data
          AND ((a.inicio AT TIME ZONE 'America/Sao_Paulo')::date + (coalesce(a.dias_ocupados, 1) - 1)) >= p_data
      ) INTO v_sobrepoem_dia_reservado;

      IF v_sobrepoem_dia_reservado THEN
        v_is_disponivel := false;
        v_motivo_indisponivel := 'dia_reservado';
      END IF;
    END IF;

    IF v_is_disponivel THEN
      SELECT count(*) INTO v_qtd_agendamentos_ativos
      FROM public.agendamentos a
      WHERE a.tenant_id = p_tenant
        AND a.status NOT IN ('cancelado', 'nao_compareceu')
        AND (p_ignorar_agendamento IS NULL OR a.id <> p_ignorar_agendamento)
        AND a.inicio < v_janela_fim_dia1
        AND public.calcular_fim_efetivo(
              a.tenant_id, 
              a.inicio, 
              coalesce(a.duracao_total, a.duracao_minutos, 60), 
              coalesce(a.modo_ocupacao_efetivo, a.modo_ocupacao)
            ) > v_posicao_inicio;

      IF v_qtd_agendamentos_ativos >= coalesce(v_horario_func.capacidade, 1) THEN
        v_is_disponivel := false;
        v_motivo_indisponivel := 'sem_box_livre';
      END IF;
    END IF;

    horario := v_slot_time;
    disponivel := v_is_disponivel;
    motivo := v_motivo_indisponivel;
    termino_previsto := v_posicao_fim;
    RETURN NEXT;

    v_slot_time := (v_slot_time + (v_grade_minutos || ' minutes')::interval)::time;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.horarios_disponiveis(uuid, date, jsonb, uuid, uuid) TO anon, authenticated;

-- 2. Atualiza RPC orcamento_publico para incluir agendamento e sinal Pix completos
CREATE OR REPLACE FUNCTION public.orcamento_publico(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_orcamento record;
  v_tenant record;
  v_cliente_nome text;
  v_cliente_tel text;
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
  v_pix_payload text := null;
BEGIN
  SELECT o.* INTO v_orcamento
  FROM public.orcamentos o
  WHERE o.token_publico = p_token OR o.id = p_token
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_status_atual := v_orcamento.status;

  -- Valida expiração
  IF v_status_atual IN ('enviado', 'visualizado') AND v_orcamento.enviado_em IS NOT NULL THEN
    IF (v_orcamento.enviado_em::date + coalesce(v_orcamento.validade_dias, 7)) < current_date THEN
      v_status_atual := 'expirado';
      UPDATE public.orcamentos
      SET status = 'expirado', updated_at = now()
      WHERE id = v_orcamento.id;
    END IF;
  END IF;

  -- Primeira visualização
  IF v_status_atual = 'enviado' THEN
    v_status_atual := 'visualizado';
    UPDATE public.orcamentos
    SET status = 'visualizado',
        visualizado_em = coalesce(visualizado_em, now()),
        updated_at = now()
    WHERE id = v_orcamento.id;
  END IF;

  -- Informações da Oficina
  SELECT t.* INTO v_tenant
  FROM public.tenants t 
  WHERE t.id = v_orcamento.tenant_id;

  -- Cliente
  SELECT c.nome, c.telefone INTO v_cliente_nome, v_cliente_tel FROM public.clientes c WHERE c.id = v_orcamento.cliente_id;
  v_primeiro_nome := split_part(coalesce(v_cliente_nome, 'Cliente'), ' ', 1);

  -- Veículo
  IF v_orcamento.veiculo_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'placa', v.placa,
      'modelo', v.modelo,
      'marca', v.marca,
      'ano', v.ano,
      'cor', v.cor
    ) INTO v_veiculo_json
    FROM public.veiculos v 
    WHERE v.id = v_orcamento.veiculo_id;
    IF FOUND THEN
      v_tem_veiculo := true;
    END IF;
  END IF;

  -- Agendamento vinculado
  IF v_orcamento.agendamento_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', a.id,
      'inicio', a.inicio,
      'status', a.status,
      'numero_os', a.numero_os,
      'duracao_total', coalesce(a.duracao_total, a.duracao_minutos, 60),
      'preco_estimado_total', coalesce(a.preco_estimado_total, a.preco_estimado, 0),
      'previsao_entrega', a.previsao_entrega,
      'sinal', CASE 
        WHEN coalesce(a.sinal_valor, 0) > 0 THEN jsonb_build_object(
          'ativo', true,
          'valor', a.sinal_valor,
          'status', coalesce(a.sinal_status, 'pendente'),
          'pix_chave', v_tenant.pix_chave,
          'pix_payload', CASE 
            WHEN a.sinal_status = 'pendente' AND v_tenant.pix_chave IS NOT NULL AND trim(v_tenant.pix_chave) <> '' THEN
              public.gerar_payload_pix(
                v_tenant.pix_chave,
                coalesce(v_tenant.pix_nome_beneficiario, v_tenant.nome),
                coalesce(v_tenant.pix_cidade, 'SAO PAULO'),
                a.sinal_valor,
                'OS' || lpad(a.numero_os::text, 4, '0')
              )
            ELSE null 
          END
        ) 
        ELSE jsonb_build_object('ativo', false, 'valor', 0) 
      END
    ) INTO v_agendamento_json
    FROM public.agendamentos a
    WHERE a.id = v_orcamento.agendamento_id;
    
    IF FOUND THEN
      v_tem_agendamento := true;
    END IF;
  END IF;

  -- Desconto concedido
  IF v_orcamento.desconto_aplicado_por IS NOT NULL THEN
    SELECT p.nome INTO v_usuario_desconto_nome
    FROM public.profiles p
    WHERE p.id = v_orcamento.desconto_aplicado_por;
  END IF;

  IF coalesce(v_orcamento.desconto_valor, 0) > 0 AND v_orcamento.desconto_tipo IS NOT NULL THEN
    v_desconto_json := jsonb_build_object(
      'tipo', v_orcamento.desconto_tipo,
      'valor', v_orcamento.desconto_valor,
      'motivo', v_orcamento.desconto_motivo,
      'cupom_codigo', v_orcamento.desconto_cupom_codigo,
      'aplicado_em', v_orcamento.desconto_aplicado_em,
      'aplicado_por_nome', coalesce(split_part(v_usuario_desconto_nome, ' ', 1), 'Gestor')
    );
  END IF;

  -- Construção dos Níveis e Itens
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'nivel', n.nivel,
      'titulo', n.titulo,
      'descricao', n.descricao,
      'valor_original', n.valor_total,
      'valor_total', CASE 
        WHEN coalesce(v_orcamento.desconto_valor, 0) > 0 AND v_orcamento.desconto_tipo = 'porcentagem' 
          THEN round(n.valor_total * (1.0 - (v_orcamento.desconto_valor / 100.0)), 2)
        WHEN coalesce(v_orcamento.desconto_valor, 0) > 0 AND v_orcamento.desconto_tipo = 'valor_fixo' 
          THEN greatest(0.00, n.valor_total - v_orcamento.desconto_valor)
        ELSE n.valor_total
      END,
      'duracao_total', n.duracao_total,
      'destaque', n.destaque,
      'ordem', n.ordem,
      'itens', coalesce(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'servico_id', i.servico_id,
              'servico_nome', s.nome,
              'servico_descricao', s.descricao_publica,
              'preco', i.preco,
              'duracao_minutos', i.duracao_minutos
            ) ORDER BY i.ordem ASC
          )
          FROM public.orcamento_nivel_itens i
          JOIN public.servicos s ON s.id = i.servico_id
          WHERE i.nivel_id = n.id
        ), '[]'::jsonb
      )
    ) ORDER BY n.ordem ASC
  ), '[]'::jsonb)
  INTO v_niveis_json
  FROM public.orcamento_niveis n
  WHERE n.orcamento_id = v_orcamento.id;

  -- Itens aprovados
  IF v_orcamento.nivel_aprovado IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(
      jsonb_build_object('servico_id', i.servico_id, 'combo_id', i.combo_id)
    ), '[]'::jsonb)
    INTO v_itens_aprovados_json
    FROM public.orcamento_nivel_itens i
    JOIN public.orcamento_niveis n ON n.id = i.nivel_id
    WHERE n.orcamento_id = v_orcamento.id AND n.nivel = v_orcamento.nivel_aprovado;
  END IF;

  -- Retorno do Objeto JSON
  RETURN jsonb_build_object(
    'numero', v_orcamento.numero,
    'numero_os', v_orcamento.numero_os,
    'titulo', v_orcamento.titulo,
    'observacoes', v_orcamento.observacoes,
    'status', v_status_atual,
    'nivel_aprovado', v_orcamento.nivel_aprovado,
    'categoria_id', v_orcamento.categoria_id,
    'itens_aprovados', v_itens_aprovados_json,
    'validade_dias', coalesce(v_orcamento.validade_dias, 7),
    'enviado_em', v_orcamento.enviado_em,
    'data_validade_limite', CASE 
      WHEN v_orcamento.enviado_em IS NOT NULL THEN (v_orcamento.enviado_em::date + coalesce(v_orcamento.validade_dias, 7))
      ELSE NULL 
    END,
    'assinatura_data', v_orcamento.assinatura_data,
    'assinatura_nome', v_orcamento.assinatura_nome,
    'assinatura_url', v_orcamento.assinatura_path,
    'cliente_primeiro_nome', v_primeiro_nome,
    'cliente_telefone', v_cliente_tel,
    'desconto', v_desconto_json,
    'oficina', jsonb_build_object(
      'tenant_id', v_tenant.id,
      'nome', v_tenant.nome,
      'razao_social', v_tenant.razao_social,
      'documento', v_tenant.documento,
      'documento_tipo', v_tenant.documento_tipo,
      'logo_path', v_tenant.logo_path,
      'telefone', v_tenant.telefone,
      'cidade', v_tenant.cidade,
      'uf', v_tenant.uf,
      'orcamento_agendamento_cliente', coalesce(v_tenant.orcamento_agendamento_cliente, true),
      'antecedencia_minima_horas', coalesce(v_tenant.antecedencia_minima_horas, 2),
      'pdf_texto_observacoes_orcamento', v_tenant.pdf_texto_observacoes_orcamento,
      'sinal_ativo', coalesce(v_tenant.sinal_ativo, false),
      'sinal_valor', coalesce(v_tenant.sinal_valor, 0),
      'pix_chave', v_tenant.pix_chave
    ),
    'veiculo', v_veiculo_json,
    'agendamento', v_agendamento_json,
    'niveis', v_niveis_json
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.orcamento_publico(uuid) TO anon, authenticated;

-- 3. Atualiza RPC agendar_orcamento_publico para calcular sinal Pix e retornar JSON completo
DROP FUNCTION IF EXISTS public.agendar_orcamento_publico(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.agendar_orcamento_publico(uuid, timestamptz, boolean, text, text);

CREATE OR REPLACE FUNCTION public.agendar_orcamento_publico(
  p_token uuid,
  p_inicio timestamptz,
  p_transbordo_aceito boolean DEFAULT false,
  p_user_agent text DEFAULT null,
  p_ip text DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_orcamento record;
  v_tenant record;
  v_nivel_rec record;
  v_antecedencia_minima integer;
  v_agendamento_cliente_habil boolean;
  v_min_inicio timestamptz;
  v_data date;
  v_hora time;
  v_is_disponivel boolean := false;
  v_termino_previsto timestamptz;
  v_agendamento_id uuid;
  v_itens_json jsonb := '[]'::jsonb;
  v_item record;
  v_servico_id_primeiro uuid;
  v_modo_item text;
  v_dias_item smallint;
  v_ordem smallint := 0;
  v_os_num integer;
  v_modo_efetivo text := 'slot';
  v_duracao_total_calculada integer := 0;
  v_total_calculado numeric(10,2) := 0;
  v_is_transbordo boolean := false;
  v_inicio_sp date;
  v_termino_sp date;
  v_obs_final text;
  v_sinal_valor_calc numeric(10,2) := 0;
  v_sinal_status_final text := null;
  v_status_inicial text := 'agendado';
  v_pix_payload text := null;
BEGIN
  -- 1. Busca Orçamento pelo Token Público ou ID
  SELECT o.* INTO v_orcamento
  FROM public.orcamentos o
  WHERE o.token_publico = p_token OR o.id = p_token
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.';
  END IF;

  IF v_orcamento.status = 'expirado' THEN
    RAISE EXCEPTION 'Este orçamento está expirado e não pode ser agendado.';
  END IF;

  IF v_orcamento.status <> 'aprovado' OR v_orcamento.nivel_aprovado IS NULL THEN
    RAISE EXCEPTION 'O orçamento precisa ser aprovado antes do agendamento.';
  END IF;

  SELECT t.* INTO v_tenant FROM public.tenants t WHERE t.id = v_orcamento.tenant_id;

  v_agendamento_cliente_habil := coalesce(v_tenant.orcamento_agendamento_cliente, true);
  v_antecedencia_minima := coalesce(v_tenant.antecedencia_minima_horas, 2);

  IF NOT v_agendamento_cliente_habil THEN
    RAISE EXCEPTION 'O agendamento online de orçamentos não está ativado nesta oficina.';
  END IF;

  v_min_inicio := now() + (v_antecedencia_minima || ' hours')::interval;
  IF p_inicio < v_min_inicio THEN
    RAISE EXCEPTION 'Agendamento deve ser feito com antecedência mínima de % horas.', v_antecedencia_minima;
  END IF;

  v_data := (p_inicio AT TIME ZONE 'America/Sao_Paulo')::date;
  v_hora := (p_inicio AT TIME ZONE 'America/Sao_Paulo')::time;

  PERFORM pg_advisory_xact_lock(hashtext(v_orcamento.tenant_id::text || ':' || v_data::text));

  SELECT n.* INTO v_nivel_rec
  FROM public.orcamento_niveis n
  WHERE n.orcamento_id = v_orcamento.id AND n.nivel = v_orcamento.nivel_aprovado;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dados do pacote aprovado não foram encontrados.';
  END IF;

  SELECT coalesce(
    jsonb_agg(jsonb_build_object('servico_id', servico_id, 'combo_id', combo_id)),
    '[]'::jsonb
  )
  INTO v_itens_json
  FROM public.orcamento_nivel_itens
  WHERE nivel_id = v_nivel_rec.id;

  -- Consulta disponibilidade via RPC horarios_disponiveis
  SELECT disponivel, termino_previsto INTO v_is_disponivel, v_termino_previsto
  FROM public.horarios_disponiveis(
    v_orcamento.tenant_id,
    v_data,
    v_itens_json,
    v_orcamento.categoria_id,
    null
  )
  WHERE horario = v_hora;

  IF NOT coalesce(v_is_disponivel, false) THEN
    RAISE EXCEPTION 'O horário selecionado não está mais disponível na agenda.';
  END IF;

  SELECT servico_id INTO v_servico_id_primeiro
  FROM public.orcamento_nivel_itens
  WHERE nivel_id = v_nivel_rec.id
  ORDER BY ordem ASC LIMIT 1;

  IF v_servico_id_primeiro IS NOT NULL THEN
    SELECT coalesce(s.modo_ocupacao, 'slot'), coalesce(s.dias_ocupados, 1)
    INTO v_modo_item, v_dias_item
    FROM public.servicos s
    WHERE s.id = v_servico_id_primeiro;
  END IF;

  v_modo_item := coalesce(v_modo_item, 'slot');
  v_dias_item := coalesce(v_dias_item, 1);

  IF v_modo_item IN ('transborda', 'multiplos_dias') OR v_dias_item > 1 THEN
    v_modo_efetivo := v_modo_item;
  END IF;

  v_duracao_total_calculada := coalesce(v_nivel_rec.duracao_total, 60);
  v_total_calculado := coalesce(v_nivel_rec.valor_total, 0);

  -- Aplica desconto se houver
  IF coalesce(v_orcamento.desconto_valor, 0) > 0 AND v_orcamento.desconto_tipo IS NOT NULL THEN
    IF v_orcamento.desconto_tipo = 'porcentagem' THEN
      v_total_calculado := round(v_total_calculado * (1.0 - (v_orcamento.desconto_valor / 100.0)), 2);
    ELSIF v_orcamento.desconto_tipo = 'valor_fixo' THEN
      v_total_calculado := greatest(0.00, v_total_calculado - v_orcamento.desconto_valor);
    END IF;
  END IF;

  IF v_termino_previsto IS NULL THEN
    v_termino_previsto := public.calcular_fim_efetivo(v_orcamento.tenant_id, p_inicio, v_duracao_total_calculada, v_modo_efetivo);
  END IF;

  v_inicio_sp := (p_inicio AT TIME ZONE 'America/Sao_Paulo')::date;
  v_termino_sp := (v_termino_previsto AT TIME ZONE 'America/Sao_Paulo')::date;

  IF v_termino_sp > v_inicio_sp THEN
    v_is_transbordo := true;
  END IF;

  IF v_is_transbordo AND NOT coalesce(p_transbordo_aceito, false) THEN
    RAISE EXCEPTION 'Para agendar um serviço com pernoite, é obrigatório aceitar os termos de permanência do veículo na oficina.';
  END IF;

  -- 2. Lógica de Sinal Pix
  IF coalesce(v_tenant.sinal_ativo, false) AND coalesce(v_tenant.sinal_valor, 0) > 0 AND v_total_calculado > 0 THEN
    IF v_tenant.sinal_tipo = 'percentual' THEN
      v_sinal_valor_calc := round((v_total_calculado * v_tenant.sinal_valor / 100.0), 2);
    ELSE
      v_sinal_valor_calc := v_tenant.sinal_valor;
    END IF;

    IF v_sinal_valor_calc > v_total_calculado THEN
      v_sinal_valor_calc := v_total_calculado;
    END IF;

    IF v_sinal_valor_calc > 0 THEN
      v_sinal_status_final := 'pendente';
      v_status_inicial := 'aguardando_confirmacao';
    END IF;
  END IF;

  v_os_num := v_orcamento.numero_os;
  IF v_os_num IS NULL THEN
    v_os_num := public.proximo_numero_os(v_orcamento.tenant_id);
    UPDATE public.orcamentos
    SET numero_os = v_os_num,
        updated_at = now()
    WHERE id = v_orcamento.id;
  END IF;

  v_obs_final := coalesce(v_orcamento.observacoes, '') || ' (Agendado pelo cliente via Orçamento #' || v_orcamento.numero || ')';
  IF v_is_transbordo THEN
    v_obs_final := v_obs_final || E'\n[pernoite aceito via orçamento público]';
  END IF;

  INSERT INTO public.agendamentos (
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
    numero_os,
    previsao_entrega,
    sinal_valor,
    sinal_status,
    transbordo_aceito_em,
    transbordo_aceite_user_agent,
    transbordo_aceite_ip
  ) VALUES (
    v_orcamento.tenant_id,
    v_orcamento.cliente_id,
    v_orcamento.veiculo_id,
    v_orcamento.categoria_id,
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
    v_orcamento.criado_por,
    v_os_num,
    v_termino_previsto,
    v_sinal_valor_calc,
    v_sinal_status_final,
    CASE WHEN v_is_transbordo AND p_transbordo_aceito THEN now() ELSE null END,
    CASE WHEN v_is_transbordo AND p_transbordo_aceito THEN p_user_agent ELSE null END,
    CASE WHEN v_is_transbordo AND p_transbordo_aceito THEN p_ip ELSE null END
  )
  RETURNING id INTO v_agendamento_id;

  v_ordem := 1;
  FOR v_item IN (
    SELECT i.servico_id, i.combo_id, i.preco, i.duracao_minutos, i.ordem
    FROM public.orcamento_nivel_itens i
    WHERE i.nivel_id = v_nivel_rec.id
    ORDER BY i.ordem ASC
  ) LOOP
    SELECT coalesce(s.modo_ocupacao, 'slot'), coalesce(s.dias_ocupados, 1)
    INTO v_modo_item, v_dias_item
    FROM public.servicos s
    WHERE s.id = v_item.servico_id;

    INSERT INTO public.agendamento_itens (
      tenant_id,
      agendamento_id,
      servico_id,
      combo_id,
      duracao_minutos,
      preco_estimado,
      modo_ocupacao,
      dias_ocupados,
      ordem
    ) VALUES (
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
  END LOOP;

  PERFORM public.recalcular_agendamento_totais(v_agendamento_id);

  UPDATE public.orcamentos
  SET agendamento_id = v_agendamento_id,
      updated_at = now()
  WHERE id = v_orcamento.id;

  -- Monta Payload Pix se houver sinal
  IF v_sinal_status_final = 'pendente' AND v_sinal_valor_calc > 0 THEN
    IF v_tenant.pix_chave IS NOT NULL AND trim(v_tenant.pix_chave) <> '' THEN
      v_pix_payload := public.gerar_payload_pix(
        v_tenant.pix_chave,
        coalesce(v_tenant.pix_nome_beneficiario, v_tenant.nome),
        coalesce(v_tenant.pix_cidade, 'SAO PAULO'),
        v_sinal_valor_calc,
        'OS' || lpad(v_os_num::text, 4, '0')
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'agendamento_id', v_agendamento_id,
    'numero_os', v_os_num,
    'status', v_status_inicial,
    'inicio', p_inicio,
    'previsao_entrega', v_termino_previsto,
    'duracao_total', v_duracao_total_calculada,
    'preco_estimado_total', v_total_calculado,
    'sinal', jsonb_build_object(
      'ativo', coalesce(v_tenant.sinal_ativo, false),
      'valor', v_sinal_valor_calc,
      'status', coalesce(v_sinal_status_final, 'sem_sinal'),
      'pix_chave', v_tenant.pix_chave,
      'pix_payload', v_pix_payload
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.agendar_orcamento_publico(uuid, timestamptz, boolean, text, text) TO anon, authenticated;

-- Overload de compatibilidade
CREATE OR REPLACE FUNCTION public.agendar_orcamento_publico(
  p_token uuid,
  p_inicio timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.agendar_orcamento_publico(
    p_token => p_token,
    p_inicio => p_inicio,
    p_transbordo_aceito => false,
    p_user_agent => null,
    p_ip => null
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.agendar_orcamento_publico(uuid, timestamptz) TO anon, authenticated;

-- 4. Atualiza RPC agendar_cliente_online para busca robusta de preços de serviços e sinal Pix
CREATE OR REPLACE FUNCTION public.agendar_cliente_online(
  p_slug text,
  p_cliente_nome text,
  p_cliente_telefone text,
  p_veiculo_placa text,
  p_veiculo_modelo text,
  p_categoria uuid,
  p_itens jsonb,
  p_inicio timestamptz,
  p_observacoes text DEFAULT null,
  p_transbordo_aceito boolean DEFAULT false,
  p_user_agent text DEFAULT null,
  p_ip text DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_tenant record;
  v_cliente_id uuid;
  v_veiculo_id uuid;
  v_antecedencia_minima integer;
  v_min_inicio timestamptz;
  v_data date;
  v_hora time;
  v_is_disponivel boolean := false;
  v_termino_previsto timestamptz;
  v_agendamento_id uuid;
  v_item jsonb;
  v_servico_id_primeiro uuid;
  v_modo_item text;
  v_dias_item smallint;
  v_ordem smallint := 0;
  v_duracao_total_calculada integer := 0;
  v_total_calculado numeric(10,2) := 0;
  v_duracao_item integer;
  v_preco_item numeric(10,2);
  v_os_num integer;
  v_sinal_valor_calc numeric(10,2) := 0;
  v_sinal_status_final text := null;
  v_status_inicial text := 'agendado';
  v_pix_payload text := null;
  v_modo_efetivo text := 'slot';
  v_is_transbordo boolean := false;
  v_inicio_sp date;
  v_termino_sp date;
  v_obs_final text;
BEGIN
  -- 1. Busca Tenant pelo Slug
  SELECT t.* INTO v_tenant
  FROM public.tenants t
  WHERE t.slug = p_slug AND t.ativo
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oficina não encontrada ou inativa.';
  END IF;

  IF NOT coalesce(v_tenant.agendamento_online_ativo, true) THEN
    RAISE EXCEPTION 'O agendamento online não está ativado nesta oficina.';
  END IF;

  v_antecedencia_minima := coalesce(v_tenant.antecedencia_minima_horas, 2);
  v_min_inicio := now() + (v_antecedencia_minima || ' hours')::interval;

  IF p_inicio < v_min_inicio THEN
    RAISE EXCEPTION 'Agendamento deve ser feito com antecedência mínima de % horas.', v_antecedencia_minima;
  END IF;

  v_data := (p_inicio AT TIME ZONE 'America/Sao_Paulo')::date;
  v_hora := (p_inicio AT TIME ZONE 'America/Sao_Paulo')::time;

  PERFORM pg_advisory_xact_lock(hashtext(v_tenant.id::text || ':' || v_data::text));

  -- 2. Valida Disponibilidade
  SELECT disponivel, termino_previsto INTO v_is_disponivel, v_termino_previsto
  FROM public.horarios_disponiveis(v_tenant.id, v_data, p_itens, p_categoria, null)
  WHERE horario = v_hora;

  IF NOT coalesce(v_is_disponivel, false) THEN
    RAISE EXCEPTION 'O horário selecionado não está mais disponível.';
  END IF;

  -- 3. Identifica ou Cria Cliente
  v_cliente_id := public.buscar_ou_criar_cliente_por_telefone(
    p_tenant.id,
    p_cliente_nome,
    p_cliente_telefone
  );

  -- 4. Identifica ou Cria Veículo
  IF p_veiculo_placa IS NOT NULL AND trim(p_veiculo_placa) <> '' THEN
    v_veiculo_id := public.buscar_ou_criar_veiculo_por_placa(
      p_tenant.id,
      v_cliente_id,
      p_veiculo_placa,
      p_veiculo_modelo
    );
  END IF;

  -- 5. Calcula Totais e Modo de Ocupação dos Serviços
  v_servico_id_primeiro := ((p_itens->0)->>'servico_id')::uuid;

  IF v_servico_id_primeiro IS NOT NULL THEN
    SELECT coalesce(s.modo_ocupacao, 'slot'), coalesce(s.dias_ocupados, 1)
    INTO v_modo_item, v_dias_item
    FROM public.servicos s
    WHERE s.id = v_servico_id_primeiro AND s.tenant_id = v_tenant.id;
  END IF;

  v_modo_item := coalesce(v_modo_item, 'slot');
  v_dias_item := coalesce(v_dias_item, 1);

  IF v_modo_item IN ('transborda', 'multiplos_dias') OR v_dias_item > 1 THEN
    v_modo_efetivo := v_modo_item;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    SELECT 
      coalesce(sp.duracao_minutos, 60), 
      coalesce(sp.preco_base, 0)
    INTO v_duracao_item, v_preco_item
    FROM public.servicos s
    LEFT JOIN public.servico_precos sp 
      ON sp.servico_id = s.id 
     AND (p_categoria IS NULL OR sp.categoria_id = p_categoria)
     AND sp.ativo
    WHERE s.id = (v_item->>'servico_id')::uuid
    LIMIT 1;

    v_duracao_item := coalesce(v_duracao_item, 60);
    v_preco_item := coalesce(v_preco_item, 0);

    v_duracao_total_calculada := v_duracao_total_calculada + v_duracao_item;
    v_total_calculado := v_total_calculado + v_preco_item;
  END LOOP;

  IF v_termino_previsto IS NULL THEN
    v_termino_previsto := public.calcular_fim_efetivo(v_tenant.id, p_inicio, v_duracao_total_calculada, v_modo_efetivo);
  END IF;

  v_inicio_sp := (p_inicio AT TIME ZONE 'America/Sao_Paulo')::date;
  v_termino_sp := (v_termino_previsto AT TIME ZONE 'America/Sao_Paulo')::date;

  IF v_termino_sp > v_inicio_sp THEN
    v_is_transbordo := true;
  END IF;

  IF v_is_transbordo AND NOT coalesce(p_transbordo_aceito, false) THEN
    RAISE EXCEPTION 'Para agendar um serviço com pernoite, é obrigatório aceitar os termos de permanência do veículo na oficina.';
  END IF;

  -- Status e Sinal
  IF coalesce(v_tenant.agendamento_exige_confirmacao, false) THEN
    v_status_inicial := 'aguardando_confirmacao';
  ELSE
    v_status_inicial := 'agendado';
  END IF;

  IF coalesce(v_tenant.sinal_ativo, false) AND coalesce(v_tenant.sinal_valor, 0) > 0 AND v_total_calculado > 0 THEN
    IF v_tenant.sinal_tipo = 'percentual' THEN
      v_sinal_valor_calc := round((v_total_calculado * v_tenant.sinal_valor / 100.0), 2);
    ELSE
      v_sinal_valor_calc := v_tenant.sinal_valor;
    END IF;

    IF v_sinal_valor_calc > v_total_calculado THEN
      v_sinal_valor_calc := v_total_calculado;
    END IF;

    IF v_sinal_valor_calc > 0 THEN
      v_sinal_status_final := 'pendente';
      v_status_inicial := 'aguardando_confirmacao';
    END IF;
  END IF;

  v_os_num := public.proximo_numero_os(v_tenant.id);

  v_obs_final := coalesce(trim(p_observacoes), 'Agendado via Catálogo Online');
  IF v_is_transbordo THEN
    v_obs_final := v_obs_final || E'\n[pernoite aceito via agendamento online]';
  END IF;

  INSERT INTO public.agendamentos (
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
    numero_os,
    previsao_entrega,
    sinal_valor,
    sinal_status,
    transbordo_aceito_em,
    transbordo_aceite_user_agent,
    transbordo_aceite_ip
  ) VALUES (
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
    v_tenant.dono_id,
    v_os_num,
    v_termino_previsto,
    v_sinal_valor_calc,
    v_sinal_status_final,
    CASE WHEN v_is_transbordo AND p_transbordo_aceito THEN now() ELSE null END,
    CASE WHEN v_is_transbordo AND p_transbordo_aceito THEN p_user_agent ELSE null END,
    CASE WHEN v_is_transbordo AND p_transbordo_aceito THEN p_ip ELSE null END
  )
  RETURNING id INTO v_agendamento_id;

  v_ordem := 1;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    SELECT 
      coalesce(sp.duracao_minutos, 60), 
      coalesce(sp.preco_base, 0),
      coalesce(s.modo_ocupacao, 'slot'),
      coalesce(s.dias_ocupados, 1)
    INTO v_duracao_item, v_preco_item, v_modo_item, v_dias_item
    FROM public.servicos s
    LEFT JOIN public.servico_precos sp 
      ON sp.servico_id = s.id 
     AND (p_categoria IS NULL OR sp.categoria_id = p_categoria)
     AND sp.ativo
    WHERE s.id = (v_item->>'servico_id')::uuid
    LIMIT 1;

    INSERT INTO public.agendamento_itens (
      tenant_id,
      agendamento_id,
      servico_id,
      duracao_minutos,
      preco_estimado,
      modo_ocupacao,
      dias_ocupados,
      ordem
    ) VALUES (
      v_tenant.id,
      v_agendamento_id,
      (v_item->>'servico_id')::uuid,
      coalesce(v_duracao_item, 60),
      coalesce(v_preco_item, 0),
      coalesce(v_modo_item, 'slot'),
      coalesce(v_dias_item, 1),
      v_ordem
    );

    v_ordem := v_ordem + 1;
  END LOOP;

  PERFORM public.recalcular_agendamento_totais(v_agendamento_id);

  IF v_sinal_status_final = 'pendente' AND v_sinal_valor_calc > 0 THEN
    IF v_tenant.pix_chave IS NOT NULL AND trim(v_tenant.pix_chave) <> '' THEN
      v_pix_payload := public.gerar_payload_pix(
        v_tenant.pix_chave,
        coalesce(v_tenant.pix_nome_beneficiario, v_tenant.nome),
        coalesce(v_tenant.pix_cidade, 'SAO PAULO'),
        v_sinal_valor_calc,
        'OS' || lpad(v_os_num::text, 4, '0')
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'agendamento_id', v_agendamento_id,
    'numero_os', v_os_num,
    'status', v_status_inicial,
    'inicio', p_inicio,
    'previsao_entrega', v_termino_previsto,
    'duracao_total', v_duracao_total_calculada,
    'preco_estimado_total', v_total_calculado,
    'sinal', jsonb_build_object(
      'ativo', coalesce(v_tenant.sinal_ativo, false),
      'valor', v_sinal_valor_calc,
      'status', coalesce(v_sinal_status_final, 'sem_sinal'),
      'pix_chave', v_tenant.pix_chave,
      'pix_payload', v_pix_payload
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.agendar_cliente_online(text, text, text, text, text, uuid, jsonb, timestamptz, text, boolean, text, text) TO anon, authenticated;

-- Overload de compatibilidade
CREATE OR REPLACE FUNCTION public.agendar_cliente_online(
  p_slug text,
  p_cliente_nome text,
  p_cliente_telefone text,
  p_veiculo_placa text,
  p_veiculo_modelo text,
  p_categoria uuid,
  p_itens jsonb,
  p_inicio timestamptz,
  p_observacoes text DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.agendar_cliente_online(
    p_slug => p_slug,
    p_cliente_nome => p_cliente_nome,
    p_cliente_telefone => p_cliente_telefone,
    p_veiculo_placa => p_veiculo_placa,
    p_veiculo_modelo => p_veiculo_modelo,
    p_categoria => p_categoria,
    p_itens => p_itens,
    p_inicio => p_inicio,
    p_observacoes => p_observacoes,
    p_transbordo_aceito => false,
    p_user_agent => null,
    p_ip => null
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.agendar_cliente_online(text, text, text, text, text, uuid, jsonb, timestamptz, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
