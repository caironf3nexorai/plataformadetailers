-- Migration 0106: Termos de Responsabilidade e Garantia com Rastreabilidade Completa
-- Estabelece Termo Fixo de Responsabilidade (tenants) + Termos Variáveis de Garantia (agendamentos / orcamentos)

-- 1. ADICIONAR TERMO DE RESPONSABILIDADE FIXO NA TABELA TENANTS
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS termo_responsabilidade text DEFAULT NULL;

COMMENT ON COLUMN public.tenants.termo_responsabilidade IS 'Termo Geral Fixo de Responsabilidade da Oficina (falhas ocultas, pertences, manobras, pátio)';

-- Preenche termo padrão caso esteja nulo para tenants existentes
UPDATE public.tenants
SET termo_responsabilidade = 'Declaro estar ciente de que o veículo acima discriminado será submetido aos procedimentos e serviços especializados contratados. Declaro que procedi com a retirada de todos os objetos de valor e pertences pessoais do interior do veículo, isentando a oficina de qualquer responsabilidade sobre itens não expressamente relacionados na vistoria de entrada. Estou ciente de que avarias preexistentes, repinturas anteriores fragilizadas, verniz com espessura reduzida, ressecamento de componentes plásticos/borrachas/chicotes elétricos e microrriscos camuflados por sujidade pesada podem se tornar evidentes durante ou após a execução dos trabalhos técnicos. Autorizo a realização de testes de rodagem estritamente necessários para validação e controle de qualidade dos serviços executados, bem como declaro ciência dos prazos estipulados para retirada do veículo após notificação de conclusão, sob pena de incidência de taxas diárias de permanência em pátio.'
WHERE termo_responsabilidade IS NULL OR trim(termo_responsabilidade) = '';

-- 2. ADICIONAR COLUNAS DE TERMOS NA TABELA AGENDAMENTOS (OS)
ALTER TABLE public.agendamentos
  ADD COLUMN IF NOT EXISTS termo_garantia_id uuid REFERENCES public.termos_garantia(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS termo_responsabilidade_texto text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS termo_garantia_texto text DEFAULT NULL;

COMMENT ON COLUMN public.agendamentos.termo_garantia_id IS 'ID do termo de garantia vinculado a este atendimento';
COMMENT ON COLUMN public.agendamentos.termo_responsabilidade_texto IS 'Snapshot do termo geral de responsabilidade no momento da entrada/aprovação';
COMMENT ON COLUMN public.agendamentos.termo_garantia_texto IS 'Snapshot do termo de garantia no momento da entrada/aprovação';

-- 3. ATUALIZAR RPC ENTRADA_AVULSA COM SUPORTE AO TERMO DE GARANTIA
-- Remove versões antigas para evitar sobrecargas incompatíveis
DROP FUNCTION IF EXISTS public.entrada_avulsa(uuid, uuid, jsonb, uuid, text);
DROP FUNCTION IF EXISTS public.entrada_avulsa(uuid, uuid, jsonb, uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.entrada_avulsa(
  p_cliente uuid,
  p_veiculo uuid,
  p_itens jsonb,
  p_categoria uuid,
  p_observacoes text default null,
  p_termo_garantia_id uuid default null
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_tenant uuid;
  v_user uuid;
  v_agendamento_id uuid;
  v_item jsonb;
  v_servico_id uuid;
  v_combo_id uuid;
  v_duracao integer;
  v_modo text;
  v_dias integer;
  v_preco numeric(10,2);
  v_preco_custom numeric(10,2);
  v_ordem smallint := 0;
  v_primeiro_servico uuid;
  v_os_num integer;
  v_termo_resp_texto text;
  v_termo_gar_texto text;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.clientes WHERE id = p_cliente;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não encontrado.';
  END IF;

  SELECT auth.uid() INTO v_user;

  IF NOT (v_tenant IN (SELECT meus_tenants())) OR NOT public.tem_papel(v_tenant, array['dono', 'gerente', 'operador']::app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado. Usuário não é membro desta oficina.';
  END IF;

  IF p_itens IS NULL OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos um serviço para a entrada avulsa.';
  END IF;

  v_servico_id := (p_itens->0->>'servico_id')::uuid;
  v_combo_id := (p_itens->0->>'combo_id')::uuid;

  IF v_servico_id IS NOT NULL THEN
    v_primeiro_servico := v_servico_id;
  ELSIF v_combo_id IS NOT NULL THEN
    SELECT cs.servico_id INTO v_primeiro_servico
    FROM public.combo_servicos cs
    WHERE cs.combo_id = v_combo_id
    ORDER BY cs.ordem ASC
    LIMIT 1;
  END IF;

  v_os_num := public.proximo_numero_os(v_tenant);

  -- Puxa o Termo Fixo de Responsabilidade do tenant
  SELECT coalesce(t.termo_responsabilidade, '') INTO v_termo_resp_texto
  FROM public.tenants t
  WHERE t.id = v_tenant;

  -- Puxa o Termo de Garantia caso tenha sido selecionado
  IF p_termo_garantia_id IS NOT NULL THEN
    SELECT tg.conteudo INTO v_termo_gar_texto
    FROM public.termos_garantia tg
    WHERE tg.id = p_termo_garantia_id AND tg.tenant_id = v_tenant;
  END IF;

  -- 1. Cria o agendamento
  INSERT INTO public.agendamentos (
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
    observacoes,
    criado_por,
    numero_os,
    termo_garantia_id,
    termo_responsabilidade_texto,
    termo_garantia_texto
  ) VALUES (
    v_tenant,
    p_cliente,
    p_veiculo,
    v_primeiro_servico,
    p_categoria,
    now(),
    60,
    60,
    'slot',
    'slot',
    1,
    0,
    0,
    'em_andamento',
    'balcao',
    p_observacoes,
    v_user,
    v_os_num,
    p_termo_garantia_id,
    nullif(v_termo_resp_texto, ''),
    nullif(v_termo_gar_texto, '')
  ) RETURNING id INTO v_agendamento_id;

  -- 2. Insere os itens
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens)
  LOOP
    v_servico_id := (v_item->>'servico_id')::uuid;
    v_combo_id := (v_item->>'combo_id')::uuid;
    v_preco_custom := CASE 
      WHEN (v_item->>'preco') IS NOT NULL AND trim(v_item->>'preco') <> '' 
      THEN (v_item->>'preco')::numeric 
      ELSE NULL 
    END;

    IF v_servico_id IS NOT NULL THEN
      SELECT s.duracao_minutos, coalesce(s.modo_ocupacao, 'slot'), coalesce(s.dias_ocupados, 1)
      INTO v_duracao, v_modo, v_dias
      FROM public.servicos s
      WHERE s.id = v_servico_id AND s.tenant_id = v_tenant;

      IF v_preco_custom IS NOT NULL THEN
        v_preco := v_preco_custom;
      ELSE
        SELECT coalesce(ps.preco, 0)
        INTO v_preco
        FROM public.precos_servico ps
        WHERE ps.servico_id = v_servico_id AND ps.categoria_id = p_categoria;
      END IF;

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
        v_tenant,
        v_agendamento_id,
        v_servico_id,
        coalesce(v_duracao, 60),
        coalesce(v_preco, 0),
        v_modo,
        v_dias,
        v_ordem
      );
      v_ordem := v_ordem + 1;

    ELSIF v_combo_id IS NOT NULL THEN
      SELECT c.duracao_minutos, coalesce(c.modo_ocupacao, 'slot'), coalesce(c.dias_ocupados, 1)
      INTO v_duracao, v_modo, v_dias
      FROM public.combos c
      WHERE c.id = v_combo_id AND c.tenant_id = v_tenant;

      IF v_preco_custom IS NOT NULL THEN
        v_preco := v_preco_custom;
      ELSE
        SELECT coalesce(pc.preco, 0)
        INTO v_preco
        FROM public.precos_combo pc
        WHERE pc.combo_id = v_combo_id AND pc.categoria_id = p_categoria;
      END IF;

      INSERT INTO public.agendamento_itens (
        tenant_id,
        agendamento_id,
        combo_id,
        duracao_minutos,
        preco_estimado,
        modo_ocupacao,
        dias_ocupados,
        ordem
      ) VALUES (
        v_tenant,
        v_agendamento_id,
        v_combo_id,
        coalesce(v_duracao, 60),
        coalesce(v_preco, 0),
        v_modo,
        v_dias,
        v_ordem
      );
      v_ordem := v_ordem + 1;
    END IF;
  END LOOP;

  PERFORM public.recalcular_agendamento_totais(v_agendamento_id);

  -- 3. Cria a vistoria inicial (Check-in)
  INSERT INTO public.checkins (
    tenant_id,
    agendamento_id,
    veiculo_id,
    criado_por
  ) VALUES (
    v_tenant,
    v_agendamento_id,
    p_veiculo,
    v_user
  );

  RETURN v_agendamento_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.entrada_avulsa(uuid, uuid, jsonb, uuid, text, uuid) TO authenticated;

-- 4. ATUALIZAR CONVERTER_ORCAMENTO_EM_AGENDAMENTO PARA COPIAR OS TERMOS
CREATE OR REPLACE FUNCTION public.converter_orcamento_em_agendamento(
  p_orcamento uuid,
  p_inicio timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_orcamento record;
  v_nivel_rec record;
  v_agendamento_id uuid;
  v_servico_principal uuid;
  v_modo_ocupacao text := 'slot';
  v_dias_ocupados integer := 1;
  v_valor_final numeric(10,2) := 0.00;
  v_os_num integer;
  v_termo_resp_texto text;
  v_termo_gar_texto text;
BEGIN
  SELECT o.* INTO v_orcamento
  FROM public.orcamentos o
  WHERE o.id = p_orcamento;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.';
  END IF;

  IF v_orcamento.status NOT IN ('aprovado', 'finalizado') THEN
    RAISE EXCEPTION 'Apenas orçamentos aprovados podem ser convertidos em agendamento.';
  END IF;

  IF v_orcamento.nivel_aprovado IS NULL THEN
    RAISE EXCEPTION 'Nenhum nível aprovado foi registrado para este orçamento.';
  END IF;

  IF v_orcamento.agendamento_id IS NOT NULL THEN
    RETURN v_orcamento.agendamento_id;
  END IF;

  SELECT n.* INTO v_nivel_rec
  FROM public.orcamento_niveis n
  WHERE n.orcamento_id = p_orcamento AND n.nivel = v_orcamento.nivel_aprovado;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nível aprovado não encontrado.';
  END IF;

  SELECT i.servico_id INTO v_servico_principal
  FROM public.orcamento_nivel_itens i
  WHERE i.nivel_id = v_nivel_rec.id
  ORDER BY i.ordem ASC
  LIMIT 1;

  IF v_servico_principal IS NOT NULL THEN
    SELECT coalesce(s.modo_ocupacao, 'slot'), coalesce(s.dias_ocupados, 1)
    INTO v_modo_ocupacao, v_dias_ocupados
    FROM public.servicos s WHERE s.id = v_servico_principal;
  END IF;

  v_valor_final := coalesce(v_nivel_rec.valor_total, 0);
  IF v_orcamento.desconto_valor > 0 AND v_orcamento.desconto_tipo IS NOT NULL THEN
    IF v_orcamento.desconto_tipo = 'porcentagem' THEN
      v_valor_final := round(v_valor_final * (1.0 - (v_orcamento.desconto_valor / 100.0)), 2);
    ELSIF v_orcamento.desconto_tipo = 'valor_fixo' THEN
      v_valor_final := greatest(0.00, v_valor_final - v_orcamento.desconto_valor);
    END IF;
  END IF;

  v_os_num := v_orcamento.numero_os;
  IF v_os_num IS NULL THEN
    v_os_num := public.proximo_numero_os(v_orcamento.tenant_id);
  END IF;

  -- Termo de responsabilidade do tenant
  SELECT coalesce(t.termo_responsabilidade, '') INTO v_termo_resp_texto
  FROM public.tenants t
  WHERE t.id = v_orcamento.tenant_id;

  -- Termo de garantia vinculado ao orçamento
  IF v_orcamento.termo_garantia_id IS NOT NULL THEN
    SELECT tg.conteudo INTO v_termo_gar_texto
    FROM public.termos_garantia tg
    WHERE tg.id = v_orcamento.termo_garantia_id;
  END IF;

  INSERT INTO public.agendamentos (
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
    observacoes,
    criado_por,
    numero_os,
    termo_garantia_id,
    termo_responsabilidade_texto,
    termo_garantia_texto
  ) VALUES (
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
    v_valor_final,
    v_valor_final,
    'agendado',
    'orcamento',
    coalesce(v_orcamento.observacoes, '') || ' (Convertido do Orçamento ORC' || lpad(v_orcamento.numero::text, 4, '0') || ' - OS ' || lpad(v_os_num::text, 4, '0') || ' - ' || v_nivel_rec.titulo || ')',
    auth.uid(),
    v_os_num,
    v_orcamento.termo_garantia_id,
    nullif(v_termo_resp_texto, ''),
    nullif(v_termo_gar_texto, '')
  ) RETURNING id INTO v_agendamento_id;

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
  )
  SELECT
    v_orcamento.tenant_id,
    v_agendamento_id,
    i.servico_id,
    i.combo_id,
    coalesce(i.duracao_minutos, 60),
    coalesce(i.preco, 0),
    coalesce(s.modo_ocupacao, 'slot'),
    coalesce(s.dias_ocupados, 1),
    coalesce(i.ordem, 0)
  FROM public.orcamento_nivel_itens i
  LEFT JOIN public.servicos s ON s.id = i.servico_id
  WHERE i.nivel_id = v_nivel_rec.id;

  PERFORM public.recalcular_agendamento_totais(v_agendamento_id);

  UPDATE public.orcamentos
  SET agendamento_id = v_agendamento_id,
      numero_os = v_os_num,
      updated_at = now()
  WHERE id = p_orcamento;

  RETURN v_agendamento_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.converter_orcamento_em_agendamento(uuid, timestamptz) TO authenticated;

-- 5. ATUALIZAR AGENDAR_ORCAMENTO_PUBLICO PARA COPIAR OS TERMOS
CREATE OR REPLACE FUNCTION public.agendar_orcamento_publico(
  p_token uuid,
  p_inicio timestamptz,
  p_transbordo_aceito boolean default false,
  p_user_agent text default null,
  p_ip text default null
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
  v_agendamento_id uuid;
  v_itens_json jsonb := '[]'::jsonb;
  v_is_disponivel boolean;
  v_termino_previsto timestamptz;
  v_data date;
  v_hora time;
  v_servico_id_primeiro uuid;
  v_modo_item text := 'slot';
  v_modo_efetivo text := 'slot';
  v_dias_item integer := 1;
  v_duracao_total_calculada integer := 0;
  v_total_calculado numeric(10,2) := 0.00;
  v_item record;
  v_ordem smallint := 0;
  v_os_num integer;
  v_obs_final text;
  v_agendamento_cliente_habil boolean;
  v_antecedencia_minima integer;
  v_min_inicio timestamptz;
  v_is_transbordo boolean := false;
  v_sinal_valor_calc numeric(10,2) := 0.00;
  v_sinal_status_final text := null;
  v_status_inicial text := 'agendado';
  v_termo_resp_texto text;
  v_termo_gar_texto text;
BEGIN
  SELECT o.* INTO v_orcamento
  FROM public.orcamentos o
  WHERE o.token_publico = p_token OR o.id = p_token
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.';
  END IF;

  IF v_orcamento.status NOT IN ('aprovado') THEN
    RAISE EXCEPTION 'Apenas propostas aprovadas podem ser agendadas pelo cliente.';
  END IF;

  IF v_orcamento.agendamento_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este orçamento já possui um agendamento vinculado.';
  END IF;

  SELECT t.* INTO v_tenant
  FROM public.tenants t
  WHERE t.id = v_orcamento.tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oficina não encontrada.';
  END IF;

  v_agendamento_cliente_habil := coalesce(v_tenant.orcamento_agendamento_cliente, true);
  v_antecedencia_minima := coalesce(v_tenant.antecedencia_minima_horas, 2);

  IF NOT v_agendamento_cliente_habil THEN
    RAISE EXCEPTION 'O agendamento online de orçamentos não está ativado nesta oficina.';
  END IF;

  v_min_inicio := now() + (v_antecedencia_minima || ' hours')::interval;
  IF p_inicio < v_min_inicio THEN
    RAISE EXCEPTION 'Agendamento deve ser feito com antecedência mínima de % horas.', v_antecedencia_minima;
  END IF;

  v_data := (p_inicio AT TIME ZONE coalesce(v_tenant.fuso_horario, 'America/Sao_Paulo'))::date;
  v_hora := (p_inicio AT TIME ZONE coalesce(v_tenant.fuso_horario, 'America/Sao_Paulo'))::time;

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
    WHERE s.id = v_servico_id_primeiro AND s.tenant_id = v_orcamento.tenant_id;
  END IF;

  v_modo_item := coalesce(v_modo_item, 'slot');
  v_dias_item := coalesce(v_dias_item, 1);

  IF v_modo_item IN ('transborda', 'multiplos_dias') OR v_dias_item > 1 THEN
    v_modo_efetivo := v_modo_item;
  END IF;

  FOR v_item IN SELECT * FROM public.orcamento_nivel_itens WHERE nivel_id = v_nivel_rec.id LOOP
    v_duracao_total_calculada := v_duracao_total_calculada + coalesce(v_item.duracao_minutos, 60);
    v_total_calculado := v_total_calculado + coalesce(v_item.preco, 0);
  END LOOP;

  IF v_orcamento.desconto_valor > 0 AND v_orcamento.desconto_tipo IS NOT NULL THEN
    IF v_orcamento.desconto_tipo = 'porcentagem' THEN
      v_total_calculado := round(v_total_calculado * (1.0 - (v_orcamento.desconto_valor / 100.0)), 2);
    ELSIF v_orcamento.desconto_tipo = 'valor_fixo' THEN
      v_total_calculado := greatest(0.00, v_total_calculado - v_orcamento.desconto_valor);
    END IF;
  END IF;

  IF v_termino_previsto IS NOT NULL AND (v_termino_previsto AT TIME ZONE coalesce(v_tenant.fuso_horario, 'America/Sao_Paulo'))::date > v_data THEN
    v_is_transbordo := true;
  END IF;

  IF v_is_transbordo AND NOT coalesce(p_transbordo_aceito, false) THEN
    RAISE EXCEPTION 'Para agendar um serviço com pernoite, é obrigatório aceitar os termos de permanência do veículo na oficina.';
  END IF;

  IF coalesce(v_tenant.sinal_ativo, false) AND coalesce(v_tenant.sinal_valor, 0) > 0 AND v_total_calculado > 0 THEN
    IF v_tenant.sinal_tipo = 'percentual' THEN
      v_sinal_valor_calc := round((v_total_calculado * v_tenant.sinal_valor / 100.0), 2);
    ELSE
      v_sinal_valor_calc := least(v_tenant.sinal_valor, v_total_calculado);
    END IF;

    IF v_sinal_valor_calc > 0 THEN
      v_sinal_status_final := 'pendente';
      v_status_inicial := 'aguardando_confirmacao';
    END IF;
  END IF;

  v_os_num := coalesce(v_orcamento.numero_os, public.proximo_numero_os(v_orcamento.tenant_id));

  v_obs_final := coalesce(v_orcamento.observacoes, '');
  IF v_is_transbordo THEN
    v_obs_final := trim(v_obs_final || ' [Transbordo Aceito pelo Cliente: Término previsto em ' || to_char(v_termino_previsto AT TIME ZONE coalesce(v_tenant.fuso_horario, 'America/Sao_Paulo'), 'DD/MM/YYYY às HH24:MI') || ']');
  END IF;

  -- Termo de responsabilidade do tenant
  v_termo_resp_texto := coalesce(v_tenant.termo_responsabilidade, '');

  -- Termo de garantia vinculado ao orçamento
  IF v_orcamento.termo_garantia_id IS NOT NULL THEN
    SELECT tg.conteudo INTO v_termo_gar_texto
    FROM public.termos_garantia tg
    WHERE tg.id = v_orcamento.termo_garantia_id;
  END IF;

  INSERT INTO public.agendamentos (
    tenant_id, cliente_id, veiculo_id, categoria_id, numero_os,
    inicio, duracao_minutos, duracao_total, modo_ocupacao, modo_ocupacao_efetivo, dias_ocupados,
    preco_estimado, preco_estimado_total, status, origem,
    observacoes, sinal_valor, sinal_status, previsao_entrega,
    transbordo_aceito_em, transbordo_aceite_user_agent, transbordo_aceite_ip,
    termo_garantia_id, termo_responsabilidade_texto, termo_garantia_texto
  ) VALUES (
    v_orcamento.tenant_id, v_orcamento.cliente_id, v_orcamento.veiculo_id, v_orcamento.categoria_id, v_os_num,
    p_inicio, v_duracao_total_calculada, v_duracao_total_calculada, coalesce(v_modo_efetivo, 'slot'), coalesce(v_modo_efetivo, 'slot'), coalesce(v_dias_item, 1),
    v_total_calculado, v_total_calculado, v_status_inicial, 'orcamento',
    nullif(v_obs_final, ''), v_sinal_valor_calc, v_sinal_status_final, v_termino_previsto,
    CASE WHEN v_is_transbordo THEN now() ELSE null END,
    CASE WHEN v_is_transbordo THEN p_user_agent ELSE null END,
    CASE WHEN v_is_transbordo THEN p_ip ELSE null END,
    v_orcamento.termo_garantia_id,
    nullif(v_termo_resp_texto, ''),
    nullif(v_termo_gar_texto, '')
  ) RETURNING id INTO v_agendamento_id;

  FOR v_item IN SELECT * FROM public.orcamento_nivel_itens WHERE nivel_id = v_nivel_rec.id LOOP
    INSERT INTO public.agendamento_itens (
      tenant_id, agendamento_id, servico_id, combo_id,
      duracao_minutos, preco_estimado, modo_ocupacao, dias_ocupados, ordem
    ) VALUES (
      v_orcamento.tenant_id, v_agendamento_id, v_item.servico_id, v_item.combo_id,
      coalesce(v_item.duracao_minutos, 60), coalesce(v_item.preco, 0), coalesce(v_modo_item, 'transborda'), coalesce(v_dias_item, 1), v_ordem
    );
    v_ordem := v_ordem + 1;
  END LOOP;

  PERFORM public.recalcular_agendamento_totais(v_agendamento_id);

  UPDATE public.orcamentos
  SET agendamento_id = v_agendamento_id,
      numero_os = v_os_num,
      updated_at = now()
  WHERE id = v_orcamento.id;

  RETURN jsonb_build_object(
    'sucesso', true,
    'agendamento_id', v_agendamento_id,
    'numero_os', v_os_num,
    'inicio', p_inicio,
    'termino_previsto', v_termino_previsto,
    'sinal_valor', v_sinal_valor_calc,
    'sinal_status', v_sinal_status_final
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.agendar_orcamento_publico(uuid, timestamptz, boolean, text, text) TO anon, authenticated;

-- 6. ATUALIZAR ORCAMENTO_PUBLICO PARA RETORNAR AMBOS OS TERMOS
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
  v_niveis_json jsonb := '[]'::jsonb;
  v_veiculo_json jsonb := null;
  v_agendamento_json jsonb := null;
  v_tem_veiculo boolean := false;
  v_tem_agendamento boolean := false;
  v_primeiro_nome text := null;
  v_cliente_tel text := null;
  v_status_atual text;
  v_modo_orc text;
  v_alteracao_pendente boolean := false;
  v_alteracao_historico_json jsonb := '[]'::jsonb;
  v_desconto_json jsonb := null;
  v_usuario_desconto_nome text := null;
  v_itens_aprovados_json jsonb := '[]'::jsonb;
  v_termo_garantia_json jsonb := null;
BEGIN
  SELECT o.* INTO v_orcamento
  FROM public.orcamentos o
  WHERE o.token_publico = p_token OR o.id = p_token
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.';
  END IF;

  SELECT t.* INTO v_tenant
  FROM public.tenants t
  WHERE t.id = v_orcamento.tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oficina não encontrada.';
  END IF;

  v_status_atual := v_orcamento.status;
  IF v_status_atual IN ('enviado', 'visualizado') AND v_orcamento.enviado_em IS NOT NULL THEN
    IF (v_orcamento.enviado_em::date + coalesce(v_orcamento.validade_dias, 7)) < current_date THEN
      v_status_atual := 'expirado';
      UPDATE public.orcamentos SET status = 'expirado', updated_at = now() WHERE id = v_orcamento.id;
    END IF;
  END IF;

  IF v_orcamento.status = 'enviado' AND v_status_atual = 'enviado' THEN
    UPDATE public.orcamentos
    SET status = 'visualizado',
        visualizado_em = now(),
        updated_at = now()
    WHERE id = v_orcamento.id;
    v_status_atual := 'visualizado';
  END IF;

  v_modo_orc := coalesce(v_orcamento.modo_orcamento, '3_niveis');

  IF v_orcamento.cliente_id IS NOT NULL THEN
    SELECT 
      split_part(c.nome, ' ', 1),
      c.telefone
    INTO v_primeiro_nome, v_cliente_tel
    FROM public.clientes c 
    WHERE c.id = v_orcamento.cliente_id;
  END IF;

  IF v_orcamento.veiculo_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', v.id,
      'modelo', v.modelo,
      'placa', v.placa,
      'ano', v.ano,
      'cor', v.cor
    ) INTO v_veiculo_json
    FROM public.veiculos v 
    WHERE v.id = v_orcamento.veiculo_id;
    IF FOUND THEN
      v_tem_veiculo := true;
    END IF;
  END IF;

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

  IF coalesce(v_orcamento.desconto_valor, 0) > 0 AND v_orcamento.desconto_tipo IS NOT NULL THEN
    IF v_orcamento.desconto_aplicado_por IS NOT NULL THEN
      SELECT u.nome INTO v_usuario_desconto_nome 
      FROM public.usuarios u 
      WHERE u.id = v_orcamento.desconto_aplicado_por;
    END IF;

    v_desconto_json := jsonb_build_object(
      'tipo', v_orcamento.desconto_tipo,
      'valor', v_orcamento.desconto_valor,
      'motivo', v_orcamento.desconto_motivo,
      'aplicado_por_nome', v_usuario_desconto_nome
    );
  END IF;

  IF v_modo_orc = 'simples' THEN
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', n.id,
          'nivel', n.nivel,
          'titulo', coalesce(n.titulo, 'Proposta de Serviços'),
          'descricao', n.descricao,
          'valor_total', n.valor_total,
          'valor_original', n.valor_original,
          'duracao_total', n.duracao_total,
          'destaque', false,
          'itens', coalesce(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'id', i.id,
                  'servico_id', i.servico_id,
                  'combo_id', i.combo_id,
                  'servico_nome', coalesce(s.nome, c.nome, 'Serviço'),
                  'servico_descricao', coalesce(s.descricao, c.descricao),
                  'preco', i.preco,
                  'duracao_minutos', i.duracao_minutos,
                  'ordem', i.ordem
                ) ORDER BY i.ordem ASC
              )
              FROM public.orcamento_nivel_itens i
              LEFT JOIN public.servicos s ON s.id = i.servico_id
              LEFT JOIN public.combos c ON c.id = i.combo_id
              WHERE i.nivel_id = n.id
            ),
            '[]'::jsonb
          )
        ) ORDER BY n.nivel ASC
      ),
      '[]'::jsonb
    ) INTO v_niveis_json
    FROM public.orcamento_niveis n
    WHERE n.orcamento_id = v_orcamento.id
      AND n.nivel = 'essencial';

    IF v_niveis_json IS NULL OR jsonb_array_length(v_niveis_json) = 0 THEN
      SELECT coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', n.id,
            'nivel', n.nivel,
            'titulo', coalesce(n.titulo, 'Proposta de Serviços'),
            'descricao', n.descricao,
            'valor_total', n.valor_total,
            'valor_original', n.valor_original,
            'duracao_total', n.duracao_total,
            'destaque', false,
            'itens', coalesce(
              (
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'id', i.id,
                    'servico_id', i.servico_id,
                    'combo_id', i.combo_id,
                    'servico_nome', coalesce(s.nome, c.nome, 'Serviço'),
                    'servico_descricao', coalesce(s.descricao, c.descricao),
                    'preco', i.preco,
                    'duracao_minutos', i.duracao_minutos,
                    'ordem', i.ordem
                  ) ORDER BY i.ordem ASC
                )
                FROM public.orcamento_nivel_itens i
                LEFT JOIN public.servicos s ON s.id = i.servico_id
                LEFT JOIN public.combos c ON c.id = i.combo_id
                WHERE i.nivel_id = n.id
              ),
              '[]'::jsonb
            )
          ) ORDER BY n.valor_total ASC LIMIT 1
        ),
        '[]'::jsonb
      ) INTO v_niveis_json
      FROM public.orcamento_niveis n
      WHERE n.orcamento_id = v_orcamento.id;
    END IF;
  ELSE
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', n.id,
          'nivel', n.nivel,
          'titulo', n.titulo,
          'descricao', n.descricao,
          'valor_total', n.valor_total,
          'valor_original', n.valor_original,
          'duracao_total', n.duracao_total,
          'destaque', n.destaque,
          'itens', coalesce(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'id', i.id,
                  'servico_id', i.servico_id,
                  'combo_id', i.combo_id,
                  'servico_nome', coalesce(s.nome, c.nome, 'Serviço'),
                  'servico_descricao', coalesce(s.descricao, c.descricao),
                  'preco', i.preco,
                  'duracao_minutos', i.duracao_minutos,
                  'ordem', i.ordem
                ) ORDER BY i.ordem ASC
              )
              FROM public.orcamento_nivel_itens i
              LEFT JOIN public.servicos s ON s.id = i.servico_id
              LEFT JOIN public.combos c ON c.id = i.combo_id
              WHERE i.nivel_id = n.id
            ),
            '[]'::jsonb
          )
        ) ORDER BY CASE n.nivel 
          WHEN 'essencial' THEN 1 
          WHEN 'recomendado' THEN 2 
          WHEN 'completo' THEN 3 
          ELSE 4 
        END
      ),
      '[]'::jsonb
    ) INTO v_niveis_json
    FROM public.orcamento_niveis n
    WHERE n.orcamento_id = v_orcamento.id;
  END IF;

  IF v_orcamento.status = 'aprovado' AND v_orcamento.nivel_aprovado IS NOT NULL THEN
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'servico_nome', coalesce(s.nome, c.nome, 'Serviço'),
          'preco', i.preco,
          'duracao_minutos', i.duracao_minutos
        ) ORDER BY i.ordem ASC
      ),
      '[]'::jsonb
    ) INTO v_itens_aprovados_json
    FROM public.orcamento_nivel_itens i
    JOIN public.orcamento_niveis n ON n.id = i.nivel_id
    LEFT JOIN public.servicos s ON s.id = i.servico_id
    LEFT JOIN public.combos c ON c.id = i.combo_id
    WHERE n.orcamento_id = v_orcamento.id 
      AND n.nivel = v_orcamento.nivel_aprovado;
  ELSIF v_modo_orc = 'simples' THEN
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'servico_nome', coalesce(s.nome, c.nome, 'Serviço'),
          'preco', i.preco,
          'duracao_minutos', i.duracao_minutos
        ) ORDER BY i.ordem ASC
      ),
      '[]'::jsonb
    ) INTO v_itens_aprovados_json
    FROM public.orcamento_nivel_itens i
    JOIN public.orcamento_niveis n ON n.id = i.nivel_id
    LEFT JOIN public.servicos s ON s.id = i.servico_id
    LEFT JOIN public.combos c ON c.id = i.combo_id
    WHERE n.orcamento_id = v_orcamento.id 
      AND n.nivel = coalesce(v_orcamento.nivel_aprovado, 'essencial');
  END IF;

  -- Busca o Termo de Garantia vinculado ao orçamento (se houver)
  IF v_orcamento.termo_garantia_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', tg.id,
      'tipo', tg.tipo,
      'titulo', tg.titulo,
      'conteudo', tg.conteudo
    ) INTO v_termo_garantia_json
    FROM public.termos_garantia tg
    WHERE tg.id = v_orcamento.termo_garantia_id;
  END IF;

  RETURN jsonb_build_object(
    'numero', v_orcamento.numero,
    'numero_os', v_orcamento.numero_os,
    'titulo', v_orcamento.titulo,
    'observacoes', v_orcamento.observacoes,
    'status', v_status_atual,
    'modo_orcamento', v_modo_orc,
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
    'incluir_termos', coalesce(v_orcamento.incluir_termos, true),
    'termo_responsabilidade', coalesce(v_tenant.termo_responsabilidade, ''),
    'termo_garantia', v_termo_garantia_json,
    'oficina', jsonb_build_object(
      'tenant_id', v_tenant.id,
      'nome', v_tenant.nome,
      'razao_social', v_tenant.razao_social,
      'documento', v_tenant.documento,
      'documento_tipo', v_tenant.documento_tipo,
      'telefone', v_tenant.telefone,
      'email', v_tenant.email,
      'cidade', v_tenant.cidade,
      'uf', v_tenant.uf,
      'logo_path', v_tenant.logo_path,
      'logo_url', v_tenant.logo_url,
      'orcamento_agendamento_cliente', coalesce(v_tenant.orcamento_agendamento_cliente, true),
      'plano', v_tenant.plano,
      'pdf_cor_primaria', v_tenant.pdf_cor_primaria,
      'pdf_cor_fundo_cabecalho', v_tenant.pdf_cor_fundo_cabecalho,
      'pdf_cor_texto_cabecalho', v_tenant.pdf_cor_texto_cabecalho,
      'pdf_cor_fundo_secoes', v_tenant.pdf_cor_fundo_secoes,
      'pdf_cor_texto_secoes', v_tenant.pdf_cor_texto_secoes,
      'pdf_subtitulo_cabecalho', v_tenant.pdf_subtitulo_cabecalho,
      'pdf_texto_observacoes_orcamento', v_tenant.pdf_texto_observacoes_orcamento,
      'pdf_texto_rodape', v_tenant.pdf_texto_rodape
    ),
    'veiculo', v_veiculo_json,
    'agendamento', v_agendamento_json,
    'niveis', v_niveis_json,
    'alteracao_pendente', v_alteracao_pendente,
    'alteracao_historico', v_alteracao_historico_json
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.orcamento_publico(uuid) TO anon, authenticated;

-- 8. ATUALIZAR RPC VISTORIA_PUBLICA PARA RETORNAR TERMOS DE RESPONSABILIDADE E GARANTIA
CREATE OR REPLACE FUNCTION public.vistoria_publica(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_checkin record;
  v_oficina record;
  v_cliente record;
  v_veiculo record;
  v_agendamento record;
  v_avarias jsonb;
  v_fotos jsonb;
  v_result jsonb;
BEGIN
  IF p_token IS NULL THEN
    RETURN jsonb_build_object('erro', 'Token inválido');
  END IF;

  SELECT c.* INTO v_checkin
  FROM public.checkins c
  WHERE c.token_aceite = p_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('erro', 'Vistoria não encontrada');
  END IF;

  SELECT
    t.id,
    coalesce(t.razao_social, t.nome, 'Oficina') AS nome,
    t.logo_path AS logo_url,
    t.cidade AS cidade,
    t.telefone AS telefone,
    t.termo_responsabilidade
  INTO v_oficina
  FROM public.tenants t
  WHERE t.id = v_checkin.tenant_id;

  SELECT
    a.id,
    a.termo_responsabilidade_texto,
    a.termo_garantia_texto,
    split_part(cl.nome, ' ', 1) AS primeiro_nome
  INTO v_agendamento
  FROM public.agendamentos a
  JOIN public.clientes cl ON cl.id = a.cliente_id
  WHERE a.id = v_checkin.agendamento_id;

  SELECT
    v.modelo,
    v.placa
  INTO v_veiculo
  FROM public.veiculos v
  WHERE v.id = v_checkin.veiculo_id;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'vista', ca.vista,
      'pos_x', ca.pos_x,
      'pos_y', ca.pos_y,
      'tipo', ca.tipo,
      'descricao', ca.descricao
    )
  ), '[]'::jsonb)
  INTO v_avarias
  FROM public.checkin_avarias ca
  WHERE ca.checkin_id = v_checkin.id;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'foto_url', cf.path,
      'descricao', cf.descricao,
      'created_at', cf.created_at
    )
  ), '[]'::jsonb)
  INTO v_fotos
  FROM public.checkin_fotos cf
  WHERE cf.checkin_id = v_checkin.id;

  v_result := jsonb_build_object(
    'oficina', jsonb_build_object(
      'nome', coalesce(v_oficina.nome, 'Oficina'),
      'logo_url', v_oficina.logo_url,
      'cidade', v_oficina.cidade,
      'telefone', v_oficina.telefone
    ),
    'cliente', jsonb_build_object(
      'primeiro_nome', coalesce(v_agendamento.primeiro_nome, 'Cliente')
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
    'enviado_em', v_checkin.enviado_em,
    'termo_responsabilidade', coalesce(v_agendamento.termo_responsabilidade_texto, v_oficina.termo_responsabilidade, ''),
    'termo_garantia', v_agendamento.termo_garantia_texto
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.vistoria_publica(uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
