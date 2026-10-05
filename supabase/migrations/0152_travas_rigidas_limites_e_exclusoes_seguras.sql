-- ==============================================================================
-- MIGRAÇÃO 0152: TRAVAS RÍGIDAS DE LIMITES DE PLANOS E EXCLUSÕES SEGURAS
-- 1. Verificação ao vivo e em tempo real de limites de recursos por plano (plan_limits)
-- 2. Bloqueio cirúrgico e isolado do recurso atingido (sem afetar o restante da plataforma)
-- 3. Travas de backend (Triggers + RPCs) para agendamentos, clientes, membros, produtos, etc.
-- 4. Exclusões essenciais com auditoria (Clientes, Veículos, Cancelar Atendimentos, Produtos)
-- 5. Blindagem jurídica permanente: Vistorias e Termos de Custódia NUNCA podem ser apagados
-- ==============================================================================

-- 1. FUNÇÃO CANÔNICA DE VALIDAÇÃO DE LIMITES AO VIVO
CREATE OR REPLACE FUNCTION public.validar_limite_recurso(
  p_tenant_id UUID DEFAULT NULL,
  p_recurso TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_fuso TEXT;
  v_plano TEXT;
  v_limite INTEGER;
  v_usado INTEGER := 0;
  v_atingiu BOOLEAN := false;
  v_permitido BOOLEAN := true;
  v_nome_recurso TEXT;
  v_mensagem TEXT;
BEGIN
  -- 1. Resolução do Tenant ID
  v_tenant_id := COALESCE(p_tenant_id, (SELECT public.meus_tenants() LIMIT 1));
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object(
      'permitido', true,
      'atingiu', false,
      'recurso', p_recurso,
      'plano', 'free',
      'limite', NULL,
      'uso', 0,
      'mensagem', 'Tenant não identificado.'
    );
  END IF;

  -- 2. Fuso e Plano atual do Tenant
  v_fuso := public.obter_fuso_tenant(v_tenant_id);
  SELECT COALESCE(plano, 'free') INTO v_plano FROM public.tenants WHERE id = v_tenant_id;
  IF v_plano IS NULL THEN
    v_plano := 'free';
  END IF;

  -- 3. Busca o Limite configurado diretamente na tabela plan_limits (AO VIVO)
  SELECT limite INTO v_limite
  FROM public.plan_limits
  WHERE plano = v_plano AND recurso = p_recurso;

  -- Se não há limite cadastrado ou limite é NULL, o recurso é ILIMITADO
  IF v_limite IS NULL THEN
    RETURN jsonb_build_object(
      'permitido', true,
      'atingiu', false,
      'recurso', p_recurso,
      'plano', v_plano,
      'limite', NULL,
      'uso', 0,
      'mensagem', 'Recurso ilimitado neste plano.'
    );
  END IF;

  -- 4. Contabilização em Tempo Real do Uso Atual
  IF p_recurso = 'agendamentos' THEN
    v_nome_recurso := 'agendamentos no mês';
    SELECT COUNT(*)::integer INTO v_usado
    FROM public.agendamentos
    WHERE tenant_id = v_tenant_id
      AND status != 'cancelado'
      AND date_trunc('month', created_at AT TIME ZONE v_fuso) = date_trunc('month', now() AT TIME ZONE v_fuso);

  ELSIF p_recurso IN ('atendimentos', 'atendimentos_mes', 'execucoes') THEN
    v_nome_recurso := 'atendimentos concluídos no mês';
    SELECT COUNT(*)::integer INTO v_usado
    FROM public.agendamentos
    WHERE tenant_id = v_tenant_id
      AND status = 'concluido'
      AND date_trunc('month', COALESCE(updated_at, created_at) AT TIME ZONE v_fuso) = date_trunc('month', now() AT TIME ZONE v_fuso);

  ELSIF p_recurso = 'clientes' THEN
    v_nome_recurso := 'clientes ativos na carteira';
    SELECT COUNT(*)::integer INTO v_usado
    FROM public.clientes
    WHERE tenant_id = v_tenant_id
      AND COALESCE(ativo, true) = true;

  ELSIF p_recurso IN ('usuarios', 'membros') THEN
    v_nome_recurso := 'membros da equipe';
    SELECT COUNT(*)::integer INTO v_usado
    FROM public.tenant_members
    WHERE tenant_id = v_tenant_id
      AND status = 'ativo';

  ELSIF p_recurso = 'produtos' THEN
    v_nome_recurso := 'produtos no estoque';
    SELECT COUNT(*)::integer INTO v_usado
    FROM public.produtos
    WHERE tenant_id = v_tenant_id
      AND COALESCE(ativo, true) = true;

  ELSIF p_recurso = 'servicos' THEN
    v_nome_recurso := 'serviços no catálogo';
    SELECT COUNT(*)::integer INTO v_usado
    FROM public.servicos
    WHERE tenant_id = v_tenant_id
      AND COALESCE(ativo, true) = true;

  ELSIF p_recurso = 'orcamentos_mes' THEN
    v_nome_recurso := 'orçamentos criados no mês';
    SELECT COUNT(*)::integer INTO v_usado
    FROM public.orcamentos
    WHERE tenant_id = v_tenant_id
      AND date_trunc('month', created_at AT TIME ZONE v_fuso) = date_trunc('month', now() AT TIME ZONE v_fuso);

  ELSIF p_recurso = 'notas_fiscais_mes' THEN
    v_nome_recurso := 'notas fiscais emitidas no mês';
    SELECT COUNT(*)::integer INTO v_usado
    FROM public.notas_fiscais
    WHERE tenant_id = v_tenant_id
      AND status != 'cancelada'
      AND date_trunc('month', created_at AT TIME ZONE v_fuso) = date_trunc('month', now() AT TIME ZONE v_fuso);

  ELSE
    v_nome_recurso := p_recurso;
    v_usado := 0;
  END IF;

  -- 5. Avaliação do Limite Rígido (Hard Limit)
  IF v_limite IS NOT NULL AND v_usado >= v_limite THEN
    v_atingiu := true;
    v_permitido := false;
    v_mensagem := 'Você atingiu o limite de ' || v_nome_recurso || ' do Plano ' || upper(v_plano) || ' (' || v_usado || ' de ' || v_limite || '). Faça upgrade para continuar utilizando esta funcionalidade.';
  ELSE
    v_atingiu := false;
    v_permitido := true;
    v_mensagem := 'Limite disponível (' || v_usado || ' de ' || v_limite || ').';
  END IF;

  RETURN jsonb_build_object(
    'permitido', v_permitido,
    'atingiu', v_atingiu,
    'recurso', p_recurso,
    'plano', v_plano,
    'limite', v_limite,
    'uso', v_usado,
    'mensagem', v_mensagem
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validar_limite_recurso(UUID, TEXT) TO anon, authenticated;


-- 2. FUNÇÃO QUE DISPARA EXCEÇÃO CASO O LIMITE SEJA ATINGIDO (TRAVA DE SEGURANÇA)
CREATE OR REPLACE FUNCTION public.travar_se_limite_atingido(
  p_tenant_id UUID,
  p_recurso TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res JSONB;
BEGIN
  v_res := public.validar_limite_recurso(p_tenant_id, p_recurso);
  IF NOT (v_res->>'permitido')::boolean THEN
    RAISE EXCEPTION 'LIMITE_PLANO_ATINGIDO: %', (v_res->>'mensagem')
      USING ERRCODE = 'P0001',
            HINT = p_recurso;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.travar_se_limite_atingido(UUID, TEXT) TO anon, authenticated;


-- 3. ATUALIZA A FUNÇÃO VERIFICAR_LIMITE EXISTENTE PARA USAR A LÓGICA UNIFICADA
CREATE OR REPLACE FUNCTION public.verificar_limite(p_recurso text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.validar_limite_recurso(NULL, p_recurso);
END;
$$;

GRANT EXECUTE ON FUNCTION public.verificar_limite(text) TO authenticated;


-- 4. TRIGGERS DE TRAVA AUTOMÁTICA EM INSERTS DE RECURSOS

-- 4.1 Trava em Agendamentos
CREATE OR REPLACE FUNCTION public.check_limite_agendamentos_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.tenant_id IS NOT NULL AND COALESCE(NEW.status, 'agendado') != 'cancelado' THEN
    PERFORM public.travar_se_limite_atingido(NEW.tenant_id, 'agendamentos');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_limite_agendamentos ON public.agendamentos;
CREATE TRIGGER trg_check_limite_agendamentos
  BEFORE INSERT ON public.agendamentos
  FOR EACH ROW
  EXECUTE FUNCTION public.check_limite_agendamentos_trigger();


-- 4.2 Trava em Clientes
CREATE OR REPLACE FUNCTION public.check_limite_clientes_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.tenant_id IS NOT NULL AND COALESCE(NEW.ativo, true) = true THEN
    PERFORM public.travar_se_limite_atingido(NEW.tenant_id, 'clientes');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_limite_clientes ON public.clientes;
CREATE TRIGGER trg_check_limite_clientes
  BEFORE INSERT ON public.clientes
  FOR EACH ROW
  EXECUTE FUNCTION public.check_limite_clientes_trigger();


-- 4.3 Trava em Membros / Usuários da Equipe
CREATE OR REPLACE FUNCTION public.check_limite_membros_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.tenant_id IS NOT NULL AND COALESCE(NEW.status, 'ativo') = 'ativo' THEN
    PERFORM public.travar_se_limite_atingido(NEW.tenant_id, 'usuarios');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_limite_membros ON public.tenant_members;
CREATE TRIGGER trg_check_limite_membros
  BEFORE INSERT ON public.tenant_members
  FOR EACH ROW
  EXECUTE FUNCTION public.check_limite_membros_trigger();


-- 4.4 Trava em Produtos de Estoque
CREATE OR REPLACE FUNCTION public.check_limite_produtos_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.tenant_id IS NOT NULL AND COALESCE(NEW.ativo, true) = true THEN
    PERFORM public.travar_se_limite_atingido(NEW.tenant_id, 'produtos');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_limite_produtos ON public.produtos;
CREATE TRIGGER trg_check_limite_produtos
  BEFORE INSERT ON public.produtos
  FOR EACH ROW
  EXECUTE FUNCTION public.check_limite_produtos_trigger();


-- 4.5 Trava em Serviços do Catálogo
CREATE OR REPLACE FUNCTION public.check_limite_servicos_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.tenant_id IS NOT NULL AND COALESCE(NEW.ativo, true) = true THEN
    PERFORM public.travar_se_limite_atingido(NEW.tenant_id, 'servicos');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_limite_servicos ON public.servicos;
CREATE TRIGGER trg_check_limite_servicos
  BEFORE INSERT ON public.servicos
  FOR EACH ROW
  EXECUTE FUNCTION public.check_limite_servicos_trigger();


-- 4.6 Trava em Orçamentos
CREATE OR REPLACE FUNCTION public.check_limite_orcamentos_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.tenant_id IS NOT NULL THEN
    PERFORM public.travar_se_limite_atingido(NEW.tenant_id, 'orcamentos_mes');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_limite_orcamentos ON public.orcamentos;
CREATE TRIGGER trg_check_limite_orcamentos
  BEFORE INSERT ON public.orcamentos
  FOR EACH ROW
  EXECUTE FUNCTION public.check_limite_orcamentos_trigger();


-- 5. ATUALIZAR AGENDAR_CLIENTE_ONLINE COM VERIFICAÇÃO AMIGÁVEL DE CAPACIDADE MENSAL
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
  v_limite_check jsonb;
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

  -- 1.2 Valida se o plano da oficina atingiu o limite mensal de agendamentos
  v_limite_check := public.validar_limite_recurso(v_tenant.id, 'agendamentos');
  IF NOT (v_limite_check->>'permitido')::boolean THEN
    RAISE EXCEPTION 'A capacidade máxima de agendamentos online desta oficina foi atingida para este mês. Por favor, entre em contato diretamente pelo WhatsApp para verificar disponibilidade.';
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


-- 6. RPCs DE EXCLUSÃO ESSENCIAL E CANCELAMENTO SEGURO

-- 6.1 Cancelamento Seguro de Atendimento
CREATE OR REPLACE FUNCTION public.cancelar_atendimento(
  p_atendimento_id UUID,
  p_motivo TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agendamento RECORD;
  v_tenant_id UUID;
BEGIN
  SELECT * INTO v_agendamento
  FROM public.agendamentos
  WHERE id = p_atendimento_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Atendimento não encontrado.';
  END IF;

  v_tenant_id := v_agendamento.tenant_id;

  IF NOT (v_tenant_id IN (SELECT public.meus_tenants())) AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: você não tem permissão para cancelar este atendimento.';
  END IF;

  -- Atualiza o agendamento
  UPDATE public.agendamentos
  SET status = 'cancelado',
      observacoes = CASE 
        WHEN p_motivo IS NOT NULL AND trim(p_motivo) != '' 
        THEN COALESCE(observacoes || E'\n', '') || '[Cancelamento]: ' || trim(p_motivo)
        ELSE observacoes
      END,
      updated_at = now()
  WHERE id = p_atendimento_id;

  -- Atualiza execução vinculada se existir
  UPDATE public.execucoes
  SET status = 'cancelado',
      updated_at = now()
  WHERE agendamento_id = p_atendimento_id;

  -- Cancela recebimentos não liquidados
  UPDATE public.recebimentos
  SET status = 'cancelado',
      updated_at = now()
  WHERE agendamento_id = p_atendimento_id
    AND status IN ('previsto', 'pendente');

  RETURN jsonb_build_object(
    'sucesso', true,
    'id', p_atendimento_id,
    'status', 'cancelado',
    'mensagem', 'Atendimento cancelado com sucesso. O horário foi liberado.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancelar_atendimento(UUID, TEXT) TO authenticated;


-- 6.2 Inativação / Exclusão de Cliente
CREATE OR REPLACE FUNCTION public.inativar_ou_excluir_cliente(p_cliente_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_tem_historico BOOLEAN := false;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM public.clientes WHERE id = p_cliente_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não encontrado.';
  END IF;

  IF NOT (v_tenant_id IN (SELECT public.meus_tenants())) AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  -- Verifica agendamentos ou orçamentos
  SELECT EXISTS(
    SELECT 1 FROM public.agendamentos WHERE cliente_id = p_cliente_id
    UNION ALL
    SELECT 1 FROM public.orcamentos WHERE cliente_id = p_cliente_id
  ) INTO v_tem_historico;

  IF v_tem_historico THEN
    UPDATE public.clientes
    SET ativo = false, updated_at = now()
    WHERE id = p_cliente_id;

    RETURN jsonb_build_object(
      'sucesso', true,
      'acao', 'inativado',
      'mensagem', 'Cliente inativado com sucesso (histórico de atendimentos e orçamentos preservado).'
    );
  ELSE
    DELETE FROM public.clientes WHERE id = p_cliente_id;
    RETURN jsonb_build_object(
      'sucesso', true,
      'acao', 'excluido',
      'mensagem', 'Cliente excluído com sucesso do banco de dados.'
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.inativar_ou_excluir_cliente(UUID) TO authenticated;


-- 6.3 Inativação / Exclusão de Veículo
CREATE OR REPLACE FUNCTION public.inativar_ou_excluir_veiculo(p_veiculo_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_tem_historico BOOLEAN := false;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM public.veiculos WHERE id = p_veiculo_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Veículo não encontrado.';
  END IF;

  IF NOT (v_tenant_id IN (SELECT public.meus_tenants())) AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  -- Verifica agendamentos ou vistorias
  SELECT EXISTS(
    SELECT 1 FROM public.agendamentos WHERE veiculo_id = p_veiculo_id
    UNION ALL
    SELECT 1 FROM public.checkins WHERE veiculo_id = p_veiculo_id
  ) INTO v_tem_historico;

  IF v_tem_historico THEN
    UPDATE public.veiculos
    SET ativo = false, updated_at = now()
    WHERE id = p_veiculo_id;

    RETURN jsonb_build_object(
      'sucesso', true,
      'acao', 'inativado',
      'mensagem', 'Veículo inativado com sucesso (histórico de serviços preservado).'
    );
  ELSE
    DELETE FROM public.veiculos WHERE id = p_veiculo_id;
    RETURN jsonb_build_object(
      'sucesso', true,
      'acao', 'excluido',
      'mensagem', 'Veículo excluído com sucesso do sistema.'
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.inativar_ou_excluir_veiculo(UUID) TO authenticated;


-- 6.4 Inativação / Exclusão de Produto de Estoque
CREATE OR REPLACE FUNCTION public.inativar_ou_excluir_produto(p_produto_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_tem_historico BOOLEAN := false;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM public.produtos WHERE id = p_produto_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto não encontrado.';
  END IF;

  IF NOT (v_tenant_id IN (SELECT public.meus_tenants())) AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  -- Verifica movimentações ou consumos em serviços
  SELECT EXISTS(
    SELECT 1 FROM public.movimentacoes_estoque WHERE produto_id = p_produto_id
    UNION ALL
    SELECT 1 FROM public.servico_produtos WHERE produto_id = p_produto_id
  ) INTO v_tem_historico;

  IF v_tem_historico THEN
    UPDATE public.produtos
    SET ativo = false, updated_at = now()
    WHERE id = p_produto_id;

    RETURN jsonb_build_object(
      'sucesso', true,
      'acao', 'inativado',
      'mensagem', 'Produto inativado no estoque (histórico de movimentações preservado).'
    );
  ELSE
    DELETE FROM public.produtos WHERE id = p_produto_id;
    RETURN jsonb_build_object(
      'sucesso', true,
      'acao', 'excluido',
      'mensagem', 'Produto excluído permanentemente do estoque.'
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.inativar_ou_excluir_produto(UUID) TO authenticated;


-- 7. BLINDAGEM JURÍDICA IMUTÁVEL: VISTORIAS E TERMOS NUNCA PODEM SER APAGADOS
CREATE OR REPLACE FUNCTION public.proteger_vistorias_exclusao()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Vistorias, laudos de check-in/check-out e termos de responsabilidade constituem documentos jurídicos comprobatórios de custódia veicular e não podem ser excluídos do sistema.'
    USING ERRCODE = 'P0002';
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_checkins_delete ON public.checkins;
CREATE TRIGGER trg_proteger_checkins_delete
  BEFORE DELETE ON public.checkins
  FOR EACH ROW
  EXECUTE FUNCTION public.proteger_vistorias_exclusao();

DROP TRIGGER IF EXISTS trg_proteger_checkin_avarias_delete ON public.checkin_avarias;
CREATE TRIGGER trg_proteger_checkin_avarias_delete
  BEFORE DELETE ON public.checkin_avarias
  FOR EACH ROW
  EXECUTE FUNCTION public.proteger_vistorias_exclusao();

DROP TRIGGER IF EXISTS trg_proteger_checkin_fotos_delete ON public.checkin_fotos;
CREATE TRIGGER trg_proteger_checkin_fotos_delete
  BEFORE DELETE ON public.checkin_fotos
  FOR EACH ROW
  EXECUTE FUNCTION public.proteger_vistorias_exclusao();

DROP TRIGGER IF EXISTS trg_proteger_aceites_termos_delete ON public.aceites_termos;
CREATE TRIGGER trg_proteger_aceites_termos_delete
  BEFORE DELETE ON public.aceites_termos
  FOR EACH ROW
  EXECUTE FUNCTION public.proteger_vistorias_exclusao();
