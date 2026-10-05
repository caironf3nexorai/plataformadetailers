-- Migration 0150: Permitir atualização de dados cadastrais da oficina e garantir compatibilidade de sinal no agendamento online

-- 1. RPC para Dono da Oficina atualizar dados cadastrais (telefone, cidade, uf, documento, razão social)
CREATE OR REPLACE FUNCTION public.atualizar_dados_oficina(
  p_telefone TEXT,
  p_cidade TEXT,
  p_uf TEXT,
  p_documento TEXT DEFAULT NULL,
  p_documento_tipo TEXT DEFAULT NULL,
  p_razao_social TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_tel_limpo TEXT;
  v_cidade_limpa TEXT;
  v_uf_limpa TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  SELECT tenant_id INTO v_tenant_id
  FROM public.tenant_members
  WHERE user_id = auth.uid() AND role = 'dono' AND status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: apenas o proprietário da oficina pode alterar os dados cadastrais.';
  END IF;

  v_tel_limpo := NULLIF(TRIM(p_telefone), '');
  v_cidade_limpa := NULLIF(TRIM(p_cidade), '');
  v_uf_limpa := NULLIF(UPPER(TRIM(p_uf)), '');

  UPDATE public.tenants
  SET
    telefone = v_tel_limpo,
    cidade = v_cidade_limpa,
    uf = v_uf_limpa,
    documento = NULLIF(TRIM(p_documento), ''),
    documento_tipo = NULLIF(TRIM(p_documento_tipo), ''),
    razao_social = NULLIF(TRIM(p_razao_social), ''),
    updated_at = now()
  WHERE id = v_tenant_id;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_tenant_id,
    'telefone', v_tel_limpo,
    'cidade', v_cidade_limpa,
    'uf', v_uf_limpa
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.atualizar_dados_oficina(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;


-- 2. Atualização de agendar_cliente_online para retornar tanto 'ativo' quanto 'exigido' no objeto de sinal
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
  v_antecedencia_minima integer;
  v_min_inicio timestamptz;
  v_duracao_total integer := 0;
  v_valor_total numeric := 0;
  v_fim timestamptz;
  v_fim_efetivo timestamptz;
  v_data date;
  v_hora time;
  v_tel_norm text;
  v_reg record;
  v_agendamento_id uuid;
  v_item jsonb;
  v_servico record;
  v_sp record;
  v_preco_item numeric;
  v_duracao_item integer;
  v_disp record;
  v_max_dias integer := 1;
  v_modo_efetivo text := 'slot';
  v_is_transbordo boolean := false;
  v_inicio_sp date;
  v_termino_sp date;
  v_obs_final text;
  v_sinal_valor_calc numeric(10,2) := 0;
  v_sinal_status_final text := 'nao_aplicavel';
  v_status_inicial text := 'agendado';
  v_pix_payload text := null;
  v_ordem smallint := 0;
  v_os_num integer;
BEGIN
  -- 1. Busca Tenant pelo Slug
  SELECT t.* INTO v_tenant
  FROM public.tenants t
  WHERE t.slug = lower(trim(p_slug))
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oficina não encontrada.';
  END IF;

  -- 1.1 Valida se agendamento online está ativado na oficina E permitido no plano atual
  IF NOT (
    COALESCE(v_tenant.agendamento_online_ativo, true)
    AND public.tenant_tem_feature(v_tenant.id, 'agendamento_online')
  ) THEN
    RAISE EXCEPTION 'O agendamento online não está disponível para esta oficina no plano contratado.';
  END IF;

  v_antecedencia_minima := coalesce(v_tenant.antecedencia_minima_horas, 2);
  v_min_inicio := now() + (v_antecedencia_minima || ' hours')::interval;

  IF p_inicio < v_min_inicio THEN
    RAISE EXCEPTION 'Agendamento deve ser feito com antecedência mínima de % horas.', v_antecedencia_minima;
  END IF;

  v_data := (p_inicio AT TIME ZONE coalesce(v_tenant.fuso_horario, 'America/Sao_Paulo'))::date;
  v_hora := (p_inicio AT TIME ZONE coalesce(v_tenant.fuso_horario, 'America/Sao_Paulo'))::time;

  PERFORM pg_advisory_xact_lock(hashtext(v_tenant.id::text || ':' || v_data::text));

  -- 2. Valida disponibilidade do slot
  SELECT * INTO v_disp
  FROM public.horarios_disponiveis(
    p_tenant => v_tenant.id,
    p_data => v_data,
    p_itens => p_itens,
    p_categoria => p_categoria
  ) hd
  WHERE hd.horario = v_hora;

  IF NOT FOUND OR NOT v_disp.disponivel THEN
    RAISE EXCEPTION 'Horário indisponível: %', coalesce(v_disp.motivo, 'fora_do_expediente');
  END IF;

  IF p_itens IS NULL OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'Nenhum serviço selecionado.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    SELECT * INTO v_servico
    FROM public.servicos s
    WHERE s.id = (v_item->>'servico_id')::uuid AND s.tenant_id = v_tenant.id AND s.ativo;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Serviço % não encontrado ou inativo.', v_item->>'servico_id';
    END IF;

    SELECT * INTO v_sp
    FROM public.servico_precos sp
    WHERE sp.servico_id = v_servico.id AND sp.categoria_id = p_categoria AND sp.ativo;

    v_preco_item := coalesce(v_sp.preco_base, 0);
    v_duracao_item := coalesce(v_sp.duracao_minutos, 60);

    v_valor_total := v_valor_total + v_preco_item;
    v_duracao_total := v_duracao_total + v_duracao_item;

    IF coalesce(v_servico.modo_ocupacao, 'transborda') = 'multiplos_dias' THEN
      v_modo_efetivo := 'multiplos_dias';
      v_max_dias := greatest(v_max_dias, coalesce(v_servico.dias_ocupados, 1));
    ELSIF coalesce(v_servico.modo_ocupacao, 'transborda') = 'dia_inteiro' AND v_modo_efetivo <> 'multiplos_dias' THEN
      v_modo_efetivo := 'dia_inteiro';
    END IF;
  END LOOP;

  v_fim := p_inicio + (v_duracao_total || ' minutes')::interval;
  v_fim_efetivo := public.calcular_fim_efetivo(v_tenant.id, p_inicio, v_duracao_total, v_modo_efetivo);

  v_inicio_sp := (p_inicio AT TIME ZONE coalesce(v_tenant.fuso_horario, 'America/Sao_Paulo'))::date;
  v_termino_sp := (v_fim_efetivo AT TIME ZONE coalesce(v_tenant.fuso_horario, 'America/Sao_Paulo'))::date;
  IF v_termino_sp > v_inicio_sp THEN
    v_is_transbordo := true;
  END IF;

  IF v_is_transbordo AND NOT coalesce(p_transbordo_aceito, false) THEN
    RAISE EXCEPTION 'Este agendamento ultrapassa o horário de expediente e requer aceite explícito de transbordo.';
  END IF;

  -- 3. Registra Cliente e Veículo
  SELECT * INTO v_reg
  FROM public.pre_registrar_cliente_e_veiculo_online(
    p_tenant_id => v_tenant.id,
    p_nome => p_cliente_nome,
    p_telefone => p_cliente_telefone,
    p_categoria_id => p_categoria,
    p_placa => p_veiculo_placa,
    p_modelo => p_veiculo_modelo,
    p_marca => null,
    p_ano => null,
    p_cor => null
  );

  v_tel_norm := public.normalizar_telefone(p_cliente_telefone);

  -- 4. Grava Consentimento Legal
  INSERT INTO public.consentimentos_publicos (
    tenant_id, tipo, identificador, documento_versao, aceito_em, ip, user_agent
  ) VALUES (
    v_tenant.id, 'agendamento_online', v_tel_norm, 'v1.0-2026-08', now(), p_ip, p_user_agent
  );

  -- 5. Tratamento de Sinal Pix e Status Inicial (somente se a oficina ativou E o plano liberar 'sinal_pix')
  IF coalesce(v_tenant.sinal_ativo, false) 
     AND public.tenant_tem_feature(v_tenant.id, 'sinal_pix')
     AND coalesce(v_tenant.sinal_valor, 0) > 0 
     AND v_valor_total > 0 THEN
    IF v_tenant.sinal_tipo = 'percentual' THEN
      v_sinal_valor_calc := round((v_valor_total * v_tenant.sinal_valor / 100.0), 2);
    ELSE
      v_sinal_valor_calc := least(v_tenant.sinal_valor, v_valor_total);
    END IF;

    IF v_sinal_valor_calc > 0 THEN
      v_sinal_status_final := 'pendente';
      v_status_inicial := 'aguardando_confirmacao';
    END IF;
  END IF;

  IF v_sinal_status_final <> 'pendente' THEN
    IF coalesce(v_tenant.agendamento_exige_confirmacao, false) THEN
      v_status_inicial := 'aguardando_confirmacao';
    ELSE
      v_status_inicial := 'agendado';
    END IF;
  END IF;

  v_os_num := public.proximo_numero_os(v_tenant.id);

  v_obs_final := coalesce(p_observacoes, '');
  IF v_is_transbordo THEN
    v_obs_final := trim(v_obs_final || ' [Transbordo Aceito pelo Cliente: Término previsto em ' || to_char(v_fim_efetivo AT TIME ZONE coalesce(v_tenant.fuso_horario, 'America/Sao_Paulo'), 'DD/MM/YYYY às HH24:MI') || ']');
  END IF;

  -- 6. Cria o Agendamento (Schema estrito)
  INSERT INTO public.agendamentos (
    tenant_id, cliente_id, veiculo_id, categoria_id, numero_os,
    inicio, duracao_minutos, duracao_total, modo_ocupacao, modo_ocupacao_efetivo, dias_ocupados,
    preco_estimado, preco_estimado_total, status, origem,
    observacoes, sinal_valor, sinal_status, previsao_entrega,
    transbordo_aceito_em, transbordo_aceite_user_agent, transbordo_aceite_ip
  ) VALUES (
    v_tenant.id, v_reg.cliente_id, v_reg.veiculo_id, p_categoria, v_os_num,
    p_inicio, v_duracao_total, v_duracao_total, coalesce(v_modo_efetivo, 'slot'), coalesce(v_modo_efetivo, 'slot'), coalesce(v_max_dias, 1),
    v_valor_total, v_valor_total, v_status_inicial, 'online',
    nullif(v_obs_final, ''), v_sinal_valor_calc, v_sinal_status_final, v_fim_efetivo,
    CASE WHEN v_is_transbordo THEN now() ELSE null END,
    CASE WHEN v_is_transbordo THEN p_user_agent ELSE null END,
    CASE WHEN v_is_transbordo THEN p_ip ELSE null END
  ) RETURNING id INTO v_agendamento_id;

  -- 7. Itens do Agendamento
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_servico := NULL;
    v_sp := NULL;

    SELECT * INTO v_servico
    FROM public.servicos s
    WHERE s.id = (v_item->>'servico_id')::uuid;

    SELECT * INTO v_sp
    FROM public.servico_precos sp
    WHERE sp.servico_id = v_servico.id AND sp.categoria_id = p_categoria;

    v_preco_item := coalesce(v_sp.preco_base, 0);
    v_duracao_item := coalesce(v_sp.duracao_minutos, 60);

    INSERT INTO public.agendamento_itens (
      tenant_id, agendamento_id, servico_id, combo_id,
      duracao_minutos, preco_estimado, modo_ocupacao, dias_ocupados, ordem
    ) VALUES (
      v_tenant.id, v_agendamento_id, v_servico.id, nullif(v_item->>'combo_id', '')::uuid,
      v_duracao_item, v_preco_item, coalesce(v_servico.modo_ocupacao, 'transborda'), coalesce(v_servico.dias_ocupados, 1), v_ordem
    );

    v_ordem := v_ordem + 1;
  END LOOP;

  PERFORM public.recalcular_agendamento_totais(v_agendamento_id);

  -- 8. Gera payload Pix caso sinal seja exigido
  IF v_sinal_status_final = 'pendente' AND v_sinal_valor_calc > 0 AND v_tenant.pix_chave IS NOT NULL AND trim(v_tenant.pix_chave) <> '' THEN
    v_pix_payload := public.gerar_payload_pix(
      v_tenant.pix_chave,
      v_tenant.pix_nome_beneficiario,
      v_tenant.pix_cidade,
      v_sinal_valor_calc,
      'AG' || v_os_num::text
    );
  END IF;

  -- 9. Retorna com 'ativo' E 'exigido' para compatibilidade total com o front-end
  RETURN jsonb_build_object(
    'agendamento_id', v_agendamento_id,
    'numero_os', v_os_num,
    'status', v_status_inicial,
    'valor_total', v_valor_total,
    'duracao_minutos', v_duracao_total,
    'termino_previsto', v_fim_efetivo,
    'is_transbordo', v_is_transbordo,
    'sinal', jsonb_build_object(
      'ativo', (v_sinal_status_final = 'pendente'),
      'exigido', (v_sinal_status_final = 'pendente'),
      'valor', v_sinal_valor_calc,
      'status', v_sinal_status_final,
      'pix_payload', v_pix_payload
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.agendar_cliente_online(text, text, text, text, text, uuid, jsonb, timestamptz, text, boolean, text, text) TO anon, authenticated;
