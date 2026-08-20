-- Migration 0059: Eliminar Ambiguidade em horarios_disponiveis e Adicionar Suporte a Assinatura Digital no Aceite de Orçamentos

-- 1. Drops explícitos de TODAS as sobrecargas antigas de horarios_disponiveis
DROP FUNCTION IF EXISTS public.horarios_disponiveis(uuid, date, jsonb, uuid, uuid);
DROP FUNCTION IF EXISTS public.horarios_disponiveis(uuid, date, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.horarios_disponiveis(uuid, date, uuid, jsonb, uuid);
DROP FUNCTION IF EXISTS public.horarios_disponiveis(uuid, date, uuid, jsonb);
DROP FUNCTION IF EXISTS public.horarios_disponiveis(uuid, date, jsonb, uuid);

-- 2. RPC CANÔNICA ÚNICA: horarios_disponiveis (Payload JSONB em p_itens)
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
        coalesce(s.modo_ocupacao, 'slot'),
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
        ELSIF v_modo_item = 'transborda' AND v_modo_efetivo NOT IN ('multiplos_dias', 'dia_inteiro') THEN
          v_modo_efetivo := 'transborda';
        END IF;
      END IF;
    END LOOP;
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

-- 3. HELPER ÚNICO DE SERVIÇO INDIVIDUAL (Parâmetro p_servico UUID para evitar ambiguidade)
CREATE OR REPLACE FUNCTION public.horarios_disponiveis(
  p_tenant uuid,
  p_data date,
  p_servico uuid,
  p_categoria uuid,
  p_ignorar_agendamento uuid DEFAULT NULL
) RETURNS TABLE (
  horario time,
  disponivel boolean,
  motivo text,
  termino_previsto timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT hd.horario, hd.disponivel, hd.motivo, hd.termino_previsto
  FROM public.horarios_disponiveis(
    p_tenant,
    p_data,
    CASE WHEN p_servico IS NOT NULL THEN jsonb_build_array(jsonb_build_object('servico_id', p_servico)) ELSE null END,
    p_categoria,
    p_ignorar_agendamento
  ) hd;
END;
$$;

GRANT EXECUTE ON FUNCTION public.horarios_disponiveis(uuid, date, uuid, uuid, uuid) TO anon, authenticated;


-- 4. ATUALIZAÇÃO DA RPC RESPONDER_ORCAMENTO PARA SUPORTAR ASSINATURA DIGITAL NO ACEITE
DROP FUNCTION IF EXISTS public.responder_orcamento(uuid, text, boolean);
DROP FUNCTION IF EXISTS public.responder_orcamento(uuid, text, boolean, text, text);

CREATE OR REPLACE FUNCTION public.responder_orcamento(
  p_token uuid,
  p_nivel text,
  p_aceite boolean,
  p_assinatura_base64 text DEFAULT NULL,
  p_nome_assinante text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_orcamento record;
  v_os_num integer;
  v_nome_limpo text;
BEGIN
  SELECT o.* INTO v_orcamento
  FROM public.orcamentos o
  WHERE o.token_publico = p_token OR o.id = p_token
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.';
  END IF;

  IF v_orcamento.status IN ('enviado', 'visualizado') AND v_orcamento.enviado_em IS NOT NULL THEN
    IF (v_orcamento.enviado_em::date + coalesce(v_orcamento.validade_dias, 7)) < current_date THEN
      UPDATE public.orcamentos SET status = 'expirado', updated_at = now() WHERE id = v_orcamento.id;
      RAISE EXCEPTION 'Este orçamento está expirado e não aceita mais respostas.';
    END IF;
  END IF;

  IF v_orcamento.status = 'expirado' THEN
    RAISE EXCEPTION 'Este orçamento está expirado e não aceita mais respostas.';
  END IF;

  IF p_aceite THEN
    IF p_nivel IS NULL OR p_nivel NOT IN ('essencial', 'recomendado', 'completo') THEN
      RAISE EXCEPTION 'Nível de orçamento inválido.';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.orcamento_niveis
      WHERE orcamento_id = v_orcamento.id AND nivel = p_nivel
    ) THEN
      RAISE EXCEPTION 'O nível escolhido não existe neste orçamento.';
    END IF;

    v_os_num := v_orcamento.numero_os;
    IF v_os_num IS NULL THEN
      v_os_num := public.proximo_numero_os(v_orcamento.tenant_id);
    END IF;

    v_nome_limpo := trim(coalesce(p_nome_assinante, ''));

    UPDATE public.orcamentos
    SET status = 'aprovado',
        nivel_aprovado = p_nivel,
        numero_os = v_os_num,
        respondido_em = now(),
        assinatura_path = coalesce(p_assinatura_base64, assinatura_path),
        assinatura_nome = coalesce(nullif(v_nome_limpo, ''), assinatura_nome),
        assinatura_data = CASE WHEN p_assinatura_base64 IS NOT NULL THEN now() ELSE assinatura_data END,
        updated_at = now()
    WHERE id = v_orcamento.id;
ELSE
    UPDATE public.orcamentos
    SET status = 'recusado',
        nivel_aprovado = null,
        respondido_em = now(),
        updated_at = now()
    WHERE id = v_orcamento.id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.responder_orcamento(uuid, text, boolean, text, text) TO anon, authenticated;


-- 5. ATUALIZAÇÃO DE ORCAMENTO_PUBLICO PARA INCLUIR DADOS DA ASSINATURA DO ACEITE
CREATE OR REPLACE FUNCTION public.orcamento_publico(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_orcamento record;
  v_tenant_nome text;
  v_tenant_razao text;
  v_tenant_doc text;
  v_tenant_doc_tipo text;
  v_tenant_logo text;
  v_tenant_tel text;
  v_tenant_cidade text;
  v_tenant_uf text;
  v_tenant_agendamento_cliente boolean := true;
  v_tenant_antecedencia_minima integer := 2;
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
  SELECT 
    t.nome,
    t.razao_social,
    t.documento,
    t.documento_tipo,
    t.logo_path, 
    t.telefone, 
    t.cidade, 
    t.uf, 
    coalesce(t.orcamento_agendamento_cliente, true),
    coalesce(t.antecedencia_minima_horas, 2)
  INTO 
    v_tenant_nome, 
    v_tenant_razao,
    v_tenant_doc,
    v_tenant_doc_tipo,
    v_tenant_logo, 
    v_tenant_tel, 
    v_tenant_cidade, 
    v_tenant_uf, 
    v_tenant_agendamento_cliente,
    v_tenant_antecedencia_minima
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
      'numero_os', a.numero_os
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

  -- Itens do Nível Aprovado
  IF v_orcamento.nivel_aprovado IS NOT NULL THEN
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'servico_id', i.servico_id,
          'combo_id', i.combo_id
        )
      ),
      '[]'::jsonb
    ) INTO v_itens_aprovados_json
    FROM public.orcamento_nivel_itens i
    JOIN public.orcamento_niveis n ON n.id = i.nivel_id
    WHERE n.orcamento_id = v_orcamento.id AND n.nivel = v_orcamento.nivel_aprovado;
  END IF;

  RETURN jsonb_build_object(
    'id', v_orcamento.id,
    'numero', v_orcamento.numero,
    'numero_os', coalesce(
      v_orcamento.numero_os, 
      CASE WHEN v_tem_agendamento THEN (v_agendamento_json->>'numero_os')::integer ELSE null END
    ),
    'titulo', v_orcamento.titulo,
    'observacoes', v_orcamento.observacoes,
    'status', v_status_atual,
    'nivel_aprovado', v_orcamento.nivel_aprovado,
    'categoria_id', v_orcamento.categoria_id,
    'itens_aprovados', v_itens_aprovados_json,
    'validade_dias', coalesce(v_orcamento.validade_dias, 7),
    'enviado_em', v_orcamento.enviado_em,
    'data_validade_limite', CASE WHEN v_orcamento.enviado_em IS NOT NULL THEN (v_orcamento.enviado_em::date + coalesce(v_orcamento.validade_dias, 7)) ELSE null END,
    'alteracao_pendente', coalesce(v_orcamento.alteracao_pendente, false),
    'alteracao_historico', coalesce(v_orcamento.alteracao_historico, '[]'::jsonb),
    'assinatura_url', v_orcamento.assinatura_path,
    'assinatura_nome', v_orcamento.assinatura_nome,
    'assinatura_data', v_orcamento.assinatura_data,
    'desconto', v_desconto_json,
    'oficina', jsonb_build_object(
      'tenant_id', v_orcamento.tenant_id,
      'nome', v_tenant_nome,
      'razao_social', v_tenant_razao,
      'documento', v_tenant_doc,
      'documento_tipo', v_tenant_doc_tipo,
      'logo_path', v_tenant_logo,
      'telefone', v_tenant_tel,
      'cidade', v_tenant_cidade,
      'uf', v_tenant_uf,
      'orcamento_agendamento_cliente', v_tenant_agendamento_cliente,
      'antecedencia_minima_horas', v_tenant_antecedencia_minima
    ),
    'cliente_nome', v_cliente_nome,
    'cliente_telefone', v_cliente_tel,
    'cliente_primeiro_nome', v_primeiro_nome,
    'veiculo', v_veiculo_json,
    'agendamento', v_agendamento_json,
    'niveis', v_niveis_json
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.orcamento_publico(uuid) TO anon, authenticated;
