-- Migration 0106: Respeitar Matriz de Permissões de Planos no Agendamento Online e Catálogo
-- Garante que funcionalidades desativadas para um plano (como 'agendamento_online' ou 'sinal_pix')
-- sejam estritamente bloqueadas no catálogo público, no fluxo de agendamento e na criação da OS.

-- 1. TENANT_TEM_FEATURE (Ajuste para permitir validações em RPCs públicas e anônimas)
CREATE OR REPLACE FUNCTION public.tenant_tem_feature(p_tenant_id UUID, p_feature TEXT)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plano text;
  v_habilitado BOOLEAN;
BEGIN
  IF p_tenant_id IS NULL OR p_feature IS NULL THEN
    RETURN false;
  END IF;

  SELECT plano INTO v_plano FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT habilitado INTO v_habilitado
  FROM public.plan_features
  WHERE plano = COALESCE(v_plano, 'free') AND feature = p_feature;

  RETURN COALESCE(v_habilitado, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_tem_feature(uuid, text) TO authenticated, anon;


-- 2. CATALOGO_PUBLICO: Informar se agendamento online está liberado pelo plano
CREATE OR REPLACE FUNCTION public.catalogo_publico(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE 
  v_tenant tenants; 
  v_result jsonb;
  v_agendamento_online_liberado boolean;
  v_sinal_pix_liberado boolean;
BEGIN
  SELECT * INTO v_tenant FROM tenants WHERE slug = lower(trim(p_slug));
  IF NOT FOUND THEN 
    RETURN null; 
  END IF;

  -- Checagem dupla: configuração manual da oficina + liberação na matriz do plano
  v_agendamento_online_liberado := (
    COALESCE(v_tenant.agendamento_online_ativo, true)
    AND public.tenant_tem_feature(v_tenant.id, 'agendamento_online')
  );

  v_sinal_pix_liberado := (
    COALESCE(v_tenant.sinal_ativo, false)
    AND public.tenant_tem_feature(v_tenant.id, 'sinal_pix')
  );

  SELECT jsonb_build_object(
    'oficina', jsonb_build_object(
      'id', v_tenant.id,
      'nome', v_tenant.nome,
      'cidade', v_tenant.cidade,
      'uf', v_tenant.uf,
      'telefone', v_tenant.telefone,
      'capa_path', v_tenant.capa_path,
      'agendamento_online_ativo', v_agendamento_online_liberado,
      'sinal_pix_ativo', v_sinal_pix_liberado
    ),
    'categorias', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'nome', c.nome, 'descricao', c.descricao
      ) ORDER BY c.ordem), '[]'::jsonb)
      FROM categorias_veiculo c
      WHERE c.tenant_id = v_tenant.id AND c.ativo
    ),
    'combos', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', cb.id,
        'nome', cb.nome,
        'descricao_publica', cb.descricao_publica,
        'codigo', cb.codigo,
        'foto_path', cb.foto_path,
        'servicos', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', s.id,
            'nome', s.nome,
            'codigo', s.codigo
          ) ORDER BY cs.ordem), '[]'::jsonb)
          FROM combo_servicos cs
          JOIN servicos s ON s.id = cs.servico_id
          WHERE cs.combo_id = cb.id
        ),
        'precos', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'categoria_id', cp.categoria_id,
            'preco_base', cp.preco_base
          )), '[]'::jsonb)
          FROM combo_precos cp
          WHERE cp.combo_id = cb.id
        )
      ) ORDER BY cb.ordem), '[]'::jsonb)
      FROM combos cb
      WHERE cb.tenant_id = v_tenant.id AND cb.ativo AND cb.publico
    ),
    'servicos', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'nome', s.nome, 'grupo', s.grupo,
        'codigo', s.codigo, 'tom', s.tom,
        'descricao_publica', s.descricao_publica,
        'sob_consulta', s.sob_consulta,
        'foto_path', s.foto_path,
        'precos', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'categoria_id', sp.categoria_id,
            'preco_base', sp.preco_base
          )), '[]'::jsonb)
          FROM servico_precos sp
          WHERE sp.servico_id = s.id AND sp.ativo
        )
      ) ORDER BY s.grupo, s.ordem), '[]'::jsonb)
      FROM servicos s
      WHERE s.tenant_id = v_tenant.id AND s.ativo AND s.publico
    ),
    'grupo_fotos', (
      SELECT coalesce(jsonb_object_agg(g.grupo_slug, g.foto_path), '{}'::jsonb)
      FROM tenant_grupo_fotos g WHERE g.tenant_id = v_tenant.id
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.catalogo_publico(text) TO anon, authenticated;


-- 3. CATALOGO_AGENDAMENTO: Bloquear e retornar erro caso o plano não permita agendamento online
CREATE OR REPLACE FUNCTION public.catalogo_agendamento(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant record;
  v_categorias jsonb;
  v_servicos jsonb;
  v_combos jsonb;
  v_agendamento_online_liberado boolean;
  v_sinal_pix_liberado boolean;
BEGIN
  SELECT t.* INTO v_tenant
  FROM public.tenants t
  WHERE t.slug = lower(trim(p_slug));

  IF NOT FOUND THEN
    RETURN jsonb_build_object('erro', 'Oficina não encontrada');
  END IF;

  -- Checagem dupla: configuração manual da oficina + liberação na matriz do plano
  v_agendamento_online_liberado := (
    COALESCE(v_tenant.agendamento_online_ativo, true)
    AND public.tenant_tem_feature(v_tenant.id, 'agendamento_online')
  );

  v_sinal_pix_liberado := (
    COALESCE(v_tenant.sinal_ativo, false)
    AND public.tenant_tem_feature(v_tenant.id, 'sinal_pix')
  );

  -- Se agendamento online não estiver ativo/permitido, retorna bloqueio
  IF NOT v_agendamento_online_liberado THEN
    RETURN jsonb_build_object(
      'erro', 'O agendamento online está desativado para esta oficina ou não disponível no plano contratado.',
      'oficina', jsonb_build_object(
        'id', v_tenant.id,
        'nome', v_tenant.nome,
        'slug', v_tenant.slug,
        'telefone', v_tenant.telefone,
        'cidade', v_tenant.cidade,
        'uf', v_tenant.uf,
        'agendamento_online_ativo', false,
        'sinal_ativo', false
      )
    );
  END IF;

  -- Categorias ativas
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'nome', c.nome,
      'descricao', c.descricao,
      'ordem', c.ordem
    ) ORDER BY c.ordem asc
  ), '[]'::jsonb)
  INTO v_categorias
  FROM public.categorias_veiculo c
  WHERE c.tenant_id = v_tenant.id AND c.ativo = true;

  -- Serviços ativos
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'nome', s.nome,
      'descricao_publica', s.descricao_publica,
      'modo_ocupacao', s.modo_ocupacao,
      'dias_ocupados', s.dias_ocupados,
      'precos', (
        SELECT coalesce(jsonb_agg(
          jsonb_build_object(
            'categoria_id', sp.categoria_id,
            'preco_base', sp.preco_base,
            'duracao_minutos', sp.duracao_minutos
          )
        ), '[]'::jsonb)
        FROM public.servico_precos sp
        WHERE sp.servico_id = s.id AND sp.ativo = true
      )
    ) ORDER BY s.nome asc
  ), '[]'::jsonb)
  INTO v_servicos
  FROM public.servicos s
  WHERE s.tenant_id = v_tenant.id AND s.ativo = true;

  -- Combos ativos
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', cb.id,
      'nome', cb.nome,
      'descricao_publica', cb.descricao_publica,
      'codigo', cb.codigo,
      'foto_path', cb.foto_path
    ) ORDER BY cb.nome asc
  ), '[]'::jsonb)
  INTO v_combos
  FROM public.combos cb
  WHERE cb.tenant_id = v_tenant.id AND cb.ativo = true;

  RETURN jsonb_build_object(
    'oficina', jsonb_build_object(
      'id', v_tenant.id,
      'nome', v_tenant.nome,
      'slug', v_tenant.slug,
      'logo_path', v_tenant.logo_path,
      'telefone', v_tenant.telefone,
      'cidade', v_tenant.cidade,
      'uf', v_tenant.uf,
      'agendamento_online_ativo', v_agendamento_online_liberado,
      'agendamento_exige_confirmacao', coalesce(v_tenant.agendamento_exige_confirmacao, false),
      'antecedencia_minima_horas', coalesce(v_tenant.antecedencia_minima_horas, 2),
      'sinal_ativo', v_sinal_pix_liberado,
      'sinal_tipo', coalesce(v_tenant.sinal_tipo, 'percentual'),
      'sinal_valor', coalesce(v_tenant.sinal_valor, 25.00),
      'sinal_obrigatorio', coalesce(v_tenant.sinal_obrigatorio, false),
      'politica_cancelamento', v_tenant.politica_cancelamento,
      'pix_chave', CASE WHEN v_sinal_pix_liberado THEN v_tenant.pix_chave ELSE NULL END,
      'pix_tipo', CASE WHEN v_sinal_pix_liberado THEN v_tenant.pix_tipo ELSE NULL END,
      'pix_nome_beneficiario', CASE WHEN v_sinal_pix_liberado THEN v_tenant.pix_nome_beneficiario ELSE NULL END,
      'pix_cidade', CASE WHEN v_sinal_pix_liberado THEN v_tenant.pix_cidade ELSE NULL END
    ),
    'categorias', v_categorias,
    'servicos', v_servicos,
    'combos', v_combos
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.catalogo_agendamento(text) TO anon, authenticated;


-- 4. AGENDAR_CLIENTE_ONLINE: Barreira de segurança estrita no momento da gravação
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

  RETURN jsonb_build_object(
    'agendamento_id', v_agendamento_id,
    'numero_os', v_os_num,
    'status', v_status_inicial,
    'valor_total', v_valor_total,
    'duracao_minutos', v_duracao_total,
    'termino_previsto', v_fim_efetivo,
    'is_transbordo', v_is_transbordo,
    'sinal', jsonb_build_object(
      'exigido', (v_sinal_status_final = 'pendente'),
      'valor', v_sinal_valor_calc,
      'status', v_sinal_status_final,
      'pix_payload', v_pix_payload
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.agendar_cliente_online(text, text, text, text, text, uuid, jsonb, timestamptz, text, boolean, text, text) TO anon, authenticated;
