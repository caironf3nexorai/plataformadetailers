-- ==============================================================================
-- MIGRAÇÃO 0168: TELEFONE / WHATSAPP OPCIONAL PARA CLIENTES (INCLUINDO LINK PÚBLICO)
-- 1. Permite telefone NULL em public.clientes (clientes sem celular/WhatsApp)
-- 2. Atualiza public.cadastro_rapido para aceitar p_telefone NULL/vazio sem colisão
--    e suportar p_cliente_id opcional (evitando duplicidade ao adicionar veículo)
-- 3. Atualiza public.agendar_orcamento_publico para permitir concluir o agendamento
--    pelo link público do orçamento sem WhatsApp/telefone quando não informado
-- ==============================================================================

-- 1. Tornar public.clientes.telefone opcional e higienizar strings vazias legadas
ALTER TABLE public.clientes
  ALTER COLUMN telefone DROP NOT NULL;

UPDATE public.clientes
SET telefone = NULL
WHERE telefone IS NOT NULL AND trim(telefone) = '';

-- ------------------------------------------------------------------------------
-- 2. RPC CADASTRO_RAPIDO (Telefone opcional + p_cliente_id opcional)
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cadastro_rapido(text, text, text, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.cadastro_rapido(text, text, text, uuid, text, text, text, uuid);

CREATE OR REPLACE FUNCTION public.cadastro_rapido(
  p_nome text,
  p_telefone text DEFAULT NULL,
  p_placa text DEFAULT NULL,
  p_categoria uuid DEFAULT NULL,
  p_marca text DEFAULT NULL,
  p_modelo text DEFAULT NULL,
  p_cor text DEFAULT NULL,
  p_cliente_id uuid DEFAULT NULL
)
RETURNS TABLE (out_cliente_id uuid, out_veiculo_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_tenant_id uuid;
  v_cliente_id uuid;
  v_veiculo_id uuid;
  v_telefone_limpo text;
  v_tel_digitos text;
  v_tel_norm text;
  v_placa_clean text;
  v_existente_id uuid;
  v_existente_cliente_id uuid;
  v_is_generica boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF p_cliente_id IS NOT NULL THEN
    SELECT c.tenant_id, c.id
    INTO v_tenant_id, v_cliente_id
    FROM public.clientes c
    WHERE c.id = p_cliente_id AND COALESCE(c.ativo, true) = true
    LIMIT 1;

    IF v_cliente_id IS NULL THEN
      RAISE EXCEPTION 'Cliente não encontrado.';
    END IF;
  ELSE
    SELECT tm.tenant_id INTO v_tenant_id
    FROM public.tenant_members tm
    WHERE tm.user_id = auth.uid() AND tm.status = 'ativo'
    ORDER BY tm.created_at ASC
    LIMIT 1;

    IF v_tenant_id IS NULL THEN
      RAISE EXCEPTION 'Nenhum tenant ativo encontrado para o usuário.';
    END IF;
  END IF;

  IF NOT public.tem_papel(v_tenant_id, ARRAY['dono', 'gerente']::public.app_role[]) THEN
    RAISE EXCEPTION 'Operadores não podem cadastrar clientes ou veículos.';
  END IF;

  -- 1. Busca por telefone (apenas quando preenchido) ou cria novo cliente
  IF v_cliente_id IS NULL THEN
    IF coalesce(trim(p_nome), '') = '' THEN
      RAISE EXCEPTION 'Nome do cliente é obrigatório.';
    END IF;

    v_telefone_limpo := nullif(trim(p_telefone), '');
    v_tel_digitos := regexp_replace(coalesce(v_telefone_limpo, ''), '\D', '', 'g');

    IF v_telefone_limpo IS NOT NULL AND length(v_tel_digitos) < 8 THEN
      RAISE EXCEPTION 'Informe um WhatsApp ou telefone válido (mínimo 8 dígitos) ou deixe em branco caso o cliente não possua.';
    END IF;

    IF length(v_tel_digitos) >= 8 THEN
      v_tel_norm := public.normalizar_telefone(v_telefone_limpo);

      SELECT c.id INTO v_cliente_id
      FROM public.clientes c
      WHERE c.tenant_id = v_tenant_id
        AND COALESCE(c.ativo, true) = true
        AND (
          c.telefone = v_telefone_limpo
          OR (v_tel_norm IS NOT NULL AND public.normalizar_telefone(c.telefone) = v_tel_norm)
        )
      ORDER BY c.created_at ASC
      LIMIT 1;
    END IF;

    IF v_cliente_id IS NULL THEN
      INSERT INTO public.clientes (tenant_id, nome, telefone)
      VALUES (v_tenant_id, trim(p_nome), v_telefone_limpo)
      RETURNING clientes.id INTO v_cliente_id;
    END IF;
  END IF;

  -- 2. Se informou dados do veículo
  IF p_placa IS NOT NULL AND trim(p_placa) <> '' THEN
    v_placa_clean := upper(trim(p_placa));

    -- Verifica se é placa genérica provisória
    IF v_placa_clean IN ('SEMPLACA', 'SEM PLACA', 'SEM', 'SP', 'NAOTEM', 'TESTE') OR v_placa_clean LIKE 'ORC%' THEN
      v_is_generica := true;
    END IF;

    -- Só reaproveita veículo existente se NÃO for placa genérica compartilhada ou se for do mesmo cliente
    IF NOT v_is_generica THEN
      SELECT v.id, v.cliente_id INTO v_existente_id, v_existente_cliente_id
      FROM public.veiculos v
      WHERE v.tenant_id = v_tenant_id AND v.placa = v_placa_clean
      LIMIT 1;
    ELSE
      SELECT v.id, v.cliente_id INTO v_existente_id, v_existente_cliente_id
      FROM public.veiculos v
      WHERE v.tenant_id = v_tenant_id AND v.cliente_id = v_cliente_id AND v.placa = v_placa_clean
      LIMIT 1;
    END IF;

    IF v_existente_id IS NOT NULL THEN
      v_veiculo_id := v_existente_id;

      IF v_existente_cliente_id IS DISTINCT FROM v_cliente_id THEN
        PERFORM public.transferir_veiculo(v_veiculo_id, v_cliente_id, current_date);
      END IF;

      -- Atualiza dados do veículo com as novas informações fornecidas
      UPDATE public.veiculos
      SET
        modelo = coalesce(nullif(trim(p_modelo), ''), modelo),
        marca = coalesce(nullif(trim(p_marca), ''), marca),
        categoria_id = coalesce(p_categoria, categoria_id),
        cor = coalesce(nullif(trim(p_cor), ''), cor)
      WHERE id = v_veiculo_id;
    ELSE
      IF p_categoria IS NULL THEN
        RAISE EXCEPTION 'Categoria do veículo é obrigatória para novo veículo.';
      END IF;

      -- Se for genérica e já existir para outro cliente, gera placa provisória única
      IF v_is_generica AND EXISTS (SELECT 1 FROM public.veiculos WHERE tenant_id = v_tenant_id AND placa = v_placa_clean) THEN
        v_placa_clean := 'PROV-' || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8);
      END IF;

      INSERT INTO public.veiculos (tenant_id, cliente_id, categoria_id, placa, marca, modelo, cor)
      VALUES (
        v_tenant_id,
        v_cliente_id,
        p_categoria,
        v_placa_clean,
        nullif(trim(p_marca), ''),
        nullif(trim(p_modelo), ''),
        nullif(trim(p_cor), '')
      )
      RETURNING veiculos.id INTO v_veiculo_id;

      INSERT INTO public.veiculo_donos (tenant_id, veiculo_id, cliente_id, inicio, fim)
      VALUES (v_tenant_id, v_veiculo_id, v_cliente_id, current_date, null);
    END IF;
  END IF;

  out_cliente_id := v_cliente_id;
  out_veiculo_id := v_veiculo_id;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cadastro_rapido(text, text, text, uuid, text, text, text, uuid) TO authenticated;

-- ------------------------------------------------------------------------------
-- 3. RPC AGENDAR_ORCAMENTO_PUBLICO (Telefone / WhatsApp opcional no link público)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agendar_orcamento_publico(
  p_token uuid,
  p_inicio timestamptz,
  p_transbordo_aceito boolean DEFAULT false,
  p_user_agent text DEFAULT null,
  p_ip text DEFAULT null,
  p_cliente_nome text DEFAULT null,
  p_cliente_telefone text DEFAULT null,
  p_veiculo_modelo text DEFAULT null,
  p_veiculo_placa text DEFAULT null
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
  v_sinal_status_final text := 'nao_aplicavel';
  v_status_inicial text := 'agendado';
  v_pix_payload text := null;

  -- Variáveis para Opção B (cadastro de cliente/veículo parciais)
  v_cliente_id uuid;
  v_veiculo_id uuid;
  v_categoria_id uuid;
  v_nome_limpo text;
  v_tel_limpo text;
  v_tel_digitos text;
  v_tel_norm text;
  v_modelo_limpo text;
  v_placa_raw text;
  v_placa_final text;
  v_veic_obs text := null;
  v_termo_resp_texto text := '';
  v_termo_gar_texto text := '';
  v_incluir_termo_resp boolean := false;
  v_incluir_termo_gar boolean := false;
BEGIN
  -- 1. Busca Orçamento ESTRITAMENTE pelo Token Público (Eliminando bypass IDOR)
  SELECT o.* INTO v_orcamento
  FROM public.orcamentos o
  WHERE o.token_publico = p_token
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

  IF v_orcamento.agendamento_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este orçamento já possui um agendamento vinculado.';
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

  v_data := (p_inicio AT TIME ZONE coalesce(v_tenant.fuso_horario, 'America/Sao_Paulo'))::date;
  v_hora := (p_inicio AT TIME ZONE coalesce(v_tenant.fuso_horario, 'America/Sao_Paulo'))::time;

  PERFORM pg_advisory_xact_lock(hashtext(v_orcamento.tenant_id::text || ':' || v_data::text));

  v_cliente_id := v_orcamento.cliente_id;
  v_veiculo_id := v_orcamento.veiculo_id;
  v_categoria_id := v_orcamento.categoria_id;

  IF v_categoria_id IS NULL THEN
    SELECT cv.id INTO v_categoria_id
    FROM public.categorias_veiculo cv
    WHERE cv.tenant_id = v_orcamento.tenant_id
    ORDER BY cv.ordem ASC, cv.created_at ASC
    LIMIT 1;
  END IF;

  -- Opção B: Se orçamento não tinha cliente cadastrado, localiza por telefone (quando informado) ou cria cadastro agora
  IF v_cliente_id IS NULL THEN
    v_nome_limpo := nullif(trim(coalesce(p_cliente_nome, v_orcamento.cliente_nome_avulso)), '');
    v_tel_limpo := nullif(trim(coalesce(p_cliente_telefone, v_orcamento.cliente_telefone_avulso)), '');
    v_tel_digitos := regexp_replace(coalesce(v_tel_limpo, ''), '\D', '', 'g');

    IF v_nome_limpo IS NULL OR length(v_nome_limpo) < 2 THEN
      RAISE EXCEPTION 'Informe seu nome completo para concluir o agendamento.';
    END IF;

    IF v_tel_limpo IS NOT NULL AND length(v_tel_digitos) < 8 THEN
      RAISE EXCEPTION 'Informe um WhatsApp ou telefone válido (com DDD) ou marque que não possui celular.';
    END IF;

    IF length(v_tel_digitos) >= 8 THEN
      v_tel_norm := public.normalizar_telefone(v_tel_limpo);

      SELECT c.id INTO v_cliente_id
      FROM public.clientes c
      WHERE c.tenant_id = v_orcamento.tenant_id
        AND COALESCE(c.ativo, true) = true
        AND (
          regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g') = v_tel_digitos
          OR (v_tel_norm IS NOT NULL AND public.normalizar_telefone(c.telefone) = v_tel_norm)
        )
      ORDER BY c.created_at ASC
      LIMIT 1;
    END IF;

    IF v_cliente_id IS NULL THEN
      INSERT INTO public.clientes (
        tenant_id, nome, telefone, origem, ativo
      ) VALUES (
        v_orcamento.tenant_id, v_nome_limpo, v_tel_limpo, 'online', true
      ) RETURNING id INTO v_cliente_id;
    END IF;

    -- Cadastro opcional de veículo caso informado no formulário público ou pré-preenchido
    IF v_veiculo_id IS NULL AND v_categoria_id IS NOT NULL THEN
      v_modelo_limpo := nullif(trim(coalesce(p_veiculo_modelo, v_orcamento.veiculo_descricao_avulsa)), '');
      v_placa_raw := upper(regexp_replace(coalesce(p_veiculo_placa, ''), '[^a-zA-Z0-9]', '', 'g'));

      IF v_modelo_limpo IS NOT NULL OR nullif(v_placa_raw, '') IS NOT NULL THEN
        IF nullif(v_placa_raw, '') IS NULL OR v_placa_raw IN ('SEMPLACA', 'SEM', 'SP', 'NAOTEM', 'TESTE') THEN
          v_placa_final := 'PROV-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
        ELSE
          SELECT v.id INTO v_veiculo_id
          FROM public.veiculos v
          WHERE v.tenant_id = v_orcamento.tenant_id
            AND v.placa = v_placa_raw
            AND v.cliente_id = v_cliente_id
          LIMIT 1;

          IF v_veiculo_id IS NULL THEN
            IF EXISTS (
              SELECT 1 FROM public.veiculos v
              WHERE v.tenant_id = v_orcamento.tenant_id AND v.placa = v_placa_raw
            ) THEN
              v_placa_final := 'PROV-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
              v_veic_obs := 'Placa informada no agendamento online: ' || v_placa_raw;
            ELSE
              v_placa_final := v_placa_raw;
            END IF;
          END IF;
        END IF;

        IF v_veiculo_id IS NULL THEN
          INSERT INTO public.veiculos (
            tenant_id, cliente_id, categoria_id, placa, modelo, observacoes, ativo
          ) VALUES (
            v_orcamento.tenant_id, v_cliente_id, v_categoria_id, v_placa_final, coalesce(v_modelo_limpo, 'Veículo'), v_veic_obs, true
          ) RETURNING id INTO v_veiculo_id;

          INSERT INTO public.veiculo_donos (
            tenant_id, veiculo_id, cliente_id, inicio
          ) VALUES (
            v_orcamento.tenant_id, v_veiculo_id, v_cliente_id, current_date
          );
        END IF;
      END IF;
    END IF;

    UPDATE public.orcamentos
    SET cliente_id = v_cliente_id,
        veiculo_id = coalesce(v_veiculo_id, veiculo_id),
        categoria_id = coalesce(v_categoria_id, categoria_id),
        cliente_nome_avulso = NULL,
        cliente_telefone_avulso = NULL,
        veiculo_descricao_avulsa = CASE WHEN v_veiculo_id IS NOT NULL THEN NULL ELSE veiculo_descricao_avulsa END,
        updated_at = now()
    WHERE id = v_orcamento.id;
  END IF;

  SELECT n.* INTO v_nivel_rec
  FROM public.orcamento_niveis n
  WHERE n.orcamento_id = v_orcamento.id AND n.nivel = v_orcamento.nivel_aprovado;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dados do pacote aprovado não foram encontrados.';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'servico_id', servico_id,
        'combo_id', combo_id,
        'duracao_minutos', duracao_minutos
      )
    ),
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
    v_categoria_id,
    null
  )
  WHERE horario = v_hora;

  IF NOT coalesce(v_is_disponivel, false) THEN
    RAISE EXCEPTION 'O horário selecionado não está mais disponível na agenda.';
  END IF;

  SELECT servico_id INTO v_servico_id_primeiro
  FROM public.orcamento_nivel_itens
  WHERE nivel_id = v_nivel_rec.id
  ORDER BY (CASE WHEN servico_id IS NOT NULL THEN 0 ELSE 1 END), ordem ASC
  LIMIT 1;

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

  IF v_termino_previsto IS NULL THEN
    v_termino_previsto := public.calcular_fim_efetivo(v_orcamento.tenant_id, p_inicio, v_duracao_total_calculada, v_modo_efetivo);
  END IF;

  v_inicio_sp := (p_inicio AT TIME ZONE coalesce(v_tenant.fuso_horario, 'America/Sao_Paulo'))::date;
  v_termino_sp := (v_termino_previsto AT TIME ZONE coalesce(v_tenant.fuso_horario, 'America/Sao_Paulo'))::date;

  IF v_termino_sp > v_inicio_sp THEN
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

  v_incluir_termo_resp := coalesce(v_orcamento.incluir_termo_responsabilidade, v_orcamento.incluir_termos, false);
  v_incluir_termo_gar := coalesce(v_orcamento.incluir_termo_garantia, v_orcamento.incluir_termos, false);

  IF v_incluir_termo_resp THEN
    v_termo_resp_texto := v_orcamento.termo_responsabilidade_texto;
    IF (v_termo_resp_texto IS NULL OR trim(v_termo_resp_texto) = '') AND v_orcamento.termo_responsabilidade_id IS NOT NULL THEN
      SELECT tg.conteudo INTO v_termo_resp_texto
      FROM public.termos_garantia tg
      WHERE tg.id = v_orcamento.termo_responsabilidade_id;
    END IF;
    IF v_termo_resp_texto IS NULL OR trim(v_termo_resp_texto) = '' THEN
      v_termo_resp_texto := coalesce(v_tenant.termo_responsabilidade, '');
    END IF;
  END IF;

  IF v_incluir_termo_gar AND v_orcamento.termo_garantia_id IS NOT NULL THEN
    SELECT tg.conteudo INTO v_termo_gar_texto
    FROM public.termos_garantia tg
    WHERE tg.id = v_orcamento.termo_garantia_id;
  END IF;

  -- Cria o Agendamento
  INSERT INTO public.agendamentos (
    tenant_id, cliente_id, veiculo_id, servico_id, categoria_id, numero_os,
    inicio, duracao_minutos, duracao_total, modo_ocupacao, modo_ocupacao_efetivo, dias_ocupados,
    preco_estimado, preco_estimado_total, status, origem,
    observacoes, sinal_valor, sinal_status, previsao_entrega,
    transbordo_aceito_em, transbordo_aceite_user_agent, transbordo_aceite_ip,
    termo_garantia_id, termo_responsabilidade_texto, termo_garantia_texto
  ) VALUES (
    v_orcamento.tenant_id, v_cliente_id, v_veiculo_id, v_servico_id_primeiro, v_categoria_id, v_os_num,
    p_inicio, v_duracao_total_calculada, v_duracao_total_calculada, coalesce(v_modo_efetivo, 'slot'), coalesce(v_modo_efetivo, 'slot'), coalesce(v_dias_item, 1),
    v_total_calculado, v_total_calculado, v_status_inicial, 'orcamento',
    nullif(v_obs_final, ''), v_sinal_valor_calc, v_sinal_status_final, v_termino_previsto,
    CASE WHEN v_is_transbordo THEN now() ELSE null END,
    CASE WHEN v_is_transbordo THEN p_user_agent ELSE null END,
    CASE WHEN v_is_transbordo THEN p_ip ELSE null END,
    CASE WHEN v_incluir_termo_gar THEN v_orcamento.termo_garantia_id ELSE null END,
    nullif(v_termo_resp_texto, ''),
    nullif(v_termo_gar_texto, '')
  ) RETURNING id INTO v_agendamento_id;

  FOR v_item IN
    SELECT i.*, s.nome AS cat_servico_nome, s.modo_ocupacao AS cat_modo, s.dias_ocupados AS cat_dias
    FROM public.orcamento_nivel_itens i
    LEFT JOIN public.servicos s ON s.id = i.servico_id
    WHERE i.nivel_id = v_nivel_rec.id
    ORDER BY i.ordem ASC
  LOOP
    INSERT INTO public.agendamento_itens (
      tenant_id, agendamento_id, servico_id, combo_id, servico_nome,
      duracao_minutos, preco_estimado, modo_ocupacao, dias_ocupados, ordem
    ) VALUES (
      v_orcamento.tenant_id, v_agendamento_id, v_item.servico_id, v_item.combo_id,
      coalesce(v_item.cat_servico_nome, v_item.servico_nome),
      coalesce(v_item.duracao_minutos, 60), coalesce(v_item.preco, 0),
      coalesce(v_item.cat_modo, v_modo_item, 'transborda'), coalesce(v_item.cat_dias, v_dias_item, 1), v_ordem
    );
    v_ordem := v_ordem + 1;
  END LOOP;

  PERFORM public.recalcular_agendamento_totais(v_agendamento_id);

  UPDATE public.orcamentos
  SET agendamento_id = v_agendamento_id,
      numero_os = v_os_num,
      updated_at = now()
  WHERE id = v_orcamento.id;

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
    'valor_total', v_total_calculado,
    'duracao_minutos', v_duracao_total_calculada,
    'termino_previsto', v_termino_previsto,
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

GRANT EXECUTE ON FUNCTION public.agendar_orcamento_publico(uuid, timestamptz, boolean, text, text, text, text, text, text) TO anon, authenticated;

