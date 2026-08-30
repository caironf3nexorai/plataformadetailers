-- ==============================================================================
-- MIGRAÇÃO 0082: ELIMINAÇÃO DEFINITIVA DE SOBRECARGAS DE FUNÇÕES (PGRST203)
-- BASEADA ESTRITAMENTE NO SCHEMA REAL DO BANCO DE DADOS
-- ------------------------------------------------------------------------------
-- Regras Absolutas:
-- 1. Uma única assinatura de função visível na API por nome (sem sobrecargas).
-- 2. Uso estrito das tabelas e colunas reais existentes no schema.
-- 3. Uso estrito dos valores literais permitidos nos CHECK constraints.
-- 4. Zera contando_desde e consolida tempo_efetivo_minutos ao finalizar.
-- ==============================================================================

-- ==============================================================================
-- 0. CORREÇÃO DE INTEGRIDADE: ZERAR CRONÔMETROS DE EXECUÇÕES FINALIZADAS
-- ==============================================================================
UPDATE public.execucoes
SET segundos_trabalhados = coalesce(segundos_trabalhados, 0) + greatest(0, extract(epoch from (coalesce(finalizado_em, now()) - contando_desde))::integer),
    tempo_efetivo_minutos = round((coalesce(segundos_trabalhados, 0) + greatest(0, extract(epoch from (coalesce(finalizado_em, now()) - contando_desde))::integer))::numeric / 60.0)::integer,
    contando_desde = NULL,
    status = 'finalizado',
    updated_at = now()
WHERE finalizado_em IS NOT NULL AND contando_desde IS NOT NULL;


-- ==============================================================================
-- 1. DROPS EXPLÍCITOS DE TODAS AS SOBRECARGAS E WRAPPERS LEGADOS
-- ==============================================================================

-- 1.1 Criar Agendamento (Remove sobrecargas com p_servico e sem p_forcado)
DROP FUNCTION IF EXISTS public.criar_agendamento(uuid, uuid, uuid, uuid, timestamptz, text, boolean);
DROP FUNCTION IF EXISTS public.criar_agendamento(uuid, uuid, uuid, uuid, timestamptz, text);
DROP FUNCTION IF EXISTS public.criar_agendamento(uuid, uuid, jsonb, uuid, timestamptz, text);

-- 1.2 Horários Disponíveis (Remove sobrecargas com p_servico UUID e 4 parâmetros)
DROP FUNCTION IF EXISTS public.horarios_disponiveis(uuid, date, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.horarios_disponiveis(uuid, date, uuid, uuid);
DROP FUNCTION IF EXISTS public.horarios_disponiveis(uuid, date, jsonb, uuid);

-- 1.3 Agendar Orçamento Público (Remove sobrecargas de 2 parâmetros e versão TEXT de 5 parâmetros)
DROP FUNCTION IF EXISTS public.agendar_orcamento_publico(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.agendar_orcamento_publico(text, timestamptz, boolean, text, text);
DROP FUNCTION IF EXISTS public.agendar_orcamento_publico(text, timestamptz);

-- 1.4 Agendar Online / Agendar Cliente Online (Remove sobrecargas de 9 e 15 parâmetros)
DROP FUNCTION IF EXISTS public.agendar_online(text, text, text, text, text, uuid, jsonb, timestamptz, text, text, integer, text, boolean, text, text);
DROP FUNCTION IF EXISTS public.agendar_online(text, text, text, text, text, uuid, jsonb, timestamptz, text);
DROP FUNCTION IF EXISTS public.agendar_cliente_online(text, text, text, text, text, uuid, jsonb, timestamptz, text);

-- 1.5 Finalizar Execução com Pagamentos (Remove versão legada de 5 parâmetros sem desconto)
DROP FUNCTION IF EXISTS public.finalizar_execucao_com_pagamentos(uuid, jsonb, jsonb, jsonb, text);

-- 1.6 Concluir Atendimento (Garante assinatura única)
DROP FUNCTION IF EXISTS public.concluir_atendimento(uuid, jsonb, jsonb, text);

-- 1.7 Criar Oficina (Remove versão legada de 4 parâmetros)
DROP FUNCTION IF EXISTS public.criar_oficina(text, text, text, text);


-- ==============================================================================
-- 2. FUNÇÕES AUXILIARES CANÔNICAS (PIX & CRC16)
-- ==============================================================================

-- 2.0.1 GERAR_PAYLOAD_PIX (Canônica: 5 parâmetros text/numeric)
CREATE OR REPLACE FUNCTION public.gerar_payload_pix(
  p_chave text,
  p_nome text,
  p_cidade text,
  p_valor numeric,
  p_txid text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chave text;
  v_nome text;
  v_cidade text;
  v_txid text;
  v_valor_str text;
  v_merchant_account text;
  v_additional_data text;
  v_raw_payload text;
  v_crc integer := 65535; -- 0xFFFF
  v_len integer;
  v_i integer;
  v_j integer;
  v_char_code integer;
  v_crc_hex text;
BEGIN
  IF p_chave IS NULL OR trim(p_chave) = '' THEN
    RETURN NULL;
  END IF;

  v_chave := trim(p_chave);

  -- Sanitização do Nome do Beneficiário (Caixa alta, sem acentos, máx 25 chars)
  v_nome := upper(translate(coalesce(trim(p_nome), 'OFICINA'), 
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 
    'AAAAAEEEEIIIIOOOOOUUUUCAAAAAEEEEIIIIOOOOOUUUUC'));
  v_nome := regexp_replace(v_nome, '[^A-Z0-9 ]', '', 'g');
  IF length(v_nome) = 0 THEN v_nome := 'OFICINA'; END IF;
  v_nome := substring(v_nome from 1 for 25);

  -- Sanitização da Cidade (Caixa alta, sem acentos, máx 15 chars)
  v_cidade := upper(translate(coalesce(trim(p_cidade), 'SAO PAULO'), 
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 
    'AAAAAEEEEIIIIOOOOOUUUUCAAAAAEEEEIIIIOOOOOUUUUC'));
  v_cidade := regexp_replace(v_cidade, '[^A-Z0-9 ]', '', 'g');
  IF length(v_cidade) = 0 THEN v_cidade := 'SAO PAULO'; END IF;
  v_cidade := substring(v_cidade from 1 for 15);

  -- Sanitização do TxID (máx 25 chars alfanuméricos)
  v_txid := upper(regexp_replace(coalesce(trim(p_txid), '***'), '[^A-Za-z0-9]', '', 'g'));
  IF length(v_txid) = 0 THEN v_txid := '***'; END IF;
  v_txid := substring(v_txid from 1 for 25);

  -- Formatação do Valor
  IF p_valor IS NOT NULL AND p_valor > 0 THEN
    v_valor_str := trim(to_char(p_valor, 'FM9999990.00'));
  ELSE
    v_valor_str := NULL;
  END IF;

  -- Construção dos Blocos EMV
  v_merchant_account := '0014br.gov.bcb.pix' || '01' || lpad(length(v_chave)::text, 2, '0') || v_chave;
  v_additional_data := '05' || lpad(length(v_txid)::text, 2, '0') || v_txid;

  v_raw_payload := '000201' ||
    '26' || lpad(length(v_merchant_account)::text, 2, '0') || v_merchant_account ||
    '52040000' ||
    '5303986';

  IF v_valor_str IS NOT NULL THEN
    v_raw_payload := v_raw_payload || '54' || lpad(length(v_valor_str)::text, 2, '0') || v_valor_str;
  END IF;

  v_raw_payload := v_raw_payload ||
    '5802BR' ||
    '59' || lpad(length(v_nome)::text, 2, '0') || v_nome ||
    '60' || lpad(length(v_cidade)::text, 2, '0') || v_cidade ||
    '62' || lpad(length(v_additional_data)::text, 2, '0') || v_additional_data ||
    '6304';

  -- Algoritmo CRC16-CCITT (Polinômio 0x1021 / Inicial 0xFFFF)
  v_len := length(v_raw_payload);
  FOR v_i IN 1..v_len LOOP
    v_char_code := ascii(substring(v_raw_payload from v_i for 1));
    v_crc := v_crc # (v_char_code * 256);
    FOR v_j IN 1..8 LOOP
      IF (v_crc & 32768) <> 0 THEN
        v_crc := ((v_crc * 2) & 65535) # 4129;
      ELSE
        v_crc := (v_crc * 2) & 65535;
      END IF;
    END LOOP;
  END LOOP;

  v_crc_hex := lpad(upper(to_hex(v_crc)), 4, '0');
  RETURN v_raw_payload || v_crc_hex;
END;
$$;

GRANT EXECUTE ON FUNCTION public.gerar_payload_pix(text, text, text, numeric, text) TO anon, authenticated;

-- 2.0.2 GERAR_PAYLOAD_PIX_ESTATICO (Wrapper canônico para compatibilidade de nomenclatura)
CREATE OR REPLACE FUNCTION public.gerar_payload_pix_estatico(
  p_chave text,
  p_nome text,
  p_cidade text,
  p_valor numeric,
  p_txid text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.gerar_payload_pix(p_chave, p_nome, p_cidade, p_valor, p_txid);
END;
$$;

GRANT EXECUTE ON FUNCTION public.gerar_payload_pix_estatico(text, text, text, numeric, text) TO anon, authenticated;


-- ==============================================================================
-- 3. RECRIAR/GARANTIR AS ASSINATURAS CANÔNICAS ÚNICAS
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 3.1 PRE_REGISTRAR_CLIENTE_E_VEICULO_ONLINE
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pre_registrar_cliente_e_veiculo_online(
  p_tenant_id uuid,
  p_nome text,
  p_telefone text,
  p_categoria_id uuid default null,
  p_placa text default null,
  p_modelo text default null,
  p_marca text default null,
  p_ano integer default null,
  p_cor text default null
)
RETURNS table (
  cliente_id uuid,
  veiculo_id uuid,
  cliente_novo boolean,
  veiculo_novo boolean,
  aviso text,
  limite_excedido boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_tenant record;
  v_tel_norm text;
  v_cliente record;
  v_veiculo record;
  v_cliente_id uuid;
  v_veiculo_id uuid;
  v_cliente_novo boolean := false;
  v_veiculo_novo boolean := false;
  v_aviso text := null;
  v_nome_limpo text;
  v_modelo_limpo text;
  v_obs_linha text;
  v_limite_excedido boolean := false;
BEGIN
  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND OR NOT coalesce(v_tenant.agendamento_online_ativo, true) THEN
    RAISE EXCEPTION 'Agendamento online indisponível para esta oficina.';
  END IF;

  v_nome_limpo := trim(coalesce(p_nome, ''));
  IF length(v_nome_limpo) < 2 THEN
    RAISE EXCEPTION 'Nome inválido. Informe pelo menos 2 caracteres.';
  END IF;

  v_tel_norm := public.normalizar_telefone(p_telefone);
  IF v_tel_norm IS NULL OR length(v_tel_norm) NOT IN (10, 11) THEN
    RAISE EXCEPTION 'Telefone inválido.';
  END IF;

  IF p_categoria_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.categorias_veiculo
      WHERE id = p_categoria_id AND tenant_id = p_tenant_id AND ativo
    ) THEN
      RAISE EXCEPTION 'Categoria de veículo inválida para esta oficina.';
    END IF;
  END IF;

  SELECT * INTO v_cliente
  FROM public.clientes
  WHERE tenant_id = p_tenant_id
    AND public.normalizar_telefone(telefone) = v_tel_norm
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_cliente.id IS NOT NULL THEN
    v_cliente_id := v_cliente.id;
    v_cliente_novo := false;

    IF lower(trim(v_cliente.nome)) <> lower(v_nome_limpo) THEN
      v_obs_linha := '[agendamento online ' || to_char(now(), 'YYYY-MM-DD') || '] Cliente informou o nome "' || v_nome_limpo || '" neste agendamento.';
      UPDATE public.clientes
      SET observacoes = CASE
            WHEN observacoes IS NULL OR trim(observacoes) = '' THEN v_obs_linha
            ELSE observacoes || E'\n' || v_obs_linha
          END,
          updated_at = now()
      WHERE id = v_cliente_id;
    END IF;
  ELSE
    INSERT INTO public.clientes (tenant_id, nome, telefone)
    VALUES (p_tenant_id, v_nome_limpo, v_tel_norm)
    RETURNING id INTO v_cliente_id;

    v_cliente_novo := true;
  END IF;

  IF p_placa IS NOT NULL AND trim(p_placa) <> '' THEN
    SELECT * INTO v_veiculo
    FROM public.veiculos
    WHERE tenant_id = p_tenant_id
      AND public.normalizar_placa(placa) = public.normalizar_placa(p_placa)
    LIMIT 1;

    v_modelo_limpo := coalesce(nullif(trim(p_modelo), ''), 'Não informado');

    IF v_veiculo.id IS NOT NULL THEN
      v_veiculo_id := v_veiculo.id;
      v_veiculo_novo := false;

      IF v_veiculo.cliente_id <> v_cliente_id THEN
        v_aviso := 'Veículo de placa ' || upper(trim(p_placa)) || ' pertencia a outro cliente e foi reatribuído.';
        UPDATE public.veiculos
        SET cliente_id = v_cliente_id,
            categoria_id = coalesce(p_categoria_id, categoria_id),
            modelo = case when v_modelo_limpo <> 'Não informado' then v_modelo_limpo else modelo end,
            updated_at = now()
        WHERE id = v_veiculo_id;
      ELSE
        IF p_categoria_id IS NOT NULL AND v_veiculo.categoria_id <> p_categoria_id THEN
          UPDATE public.veiculos
          SET categoria_id = p_categoria_id,
              modelo = case when v_modelo_limpo <> 'Não informado' then v_modelo_limpo else modelo end,
              updated_at = now()
          WHERE id = v_veiculo_id;
        END IF;
      END IF;
    ELSE
      INSERT INTO public.veiculos (
        tenant_id, cliente_id, categoria_id, placa, modelo, marca, ano, cor
      ) VALUES (
        p_tenant_id, v_cliente_id, p_categoria_id,
        public.normalizar_placa(p_placa), v_modelo_limpo,
        p_marca, p_ano, p_cor
      ) RETURNING id INTO v_veiculo_id;

      v_veiculo_novo := true;
    END IF;
  ELSE
    v_veiculo_id := null;
    v_veiculo_novo := false;
  END IF;

  RETURN QUERY SELECT v_cliente_id, v_veiculo_id, v_cliente_novo, v_veiculo_novo, v_aviso, v_limite_excedido;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pre_registrar_cliente_e_veiculo_online(uuid, text, text, uuid, text, text, text, integer, text) TO anon, authenticated;


-- ------------------------------------------------------------------------------
-- 3.2 HORARIOS_DISPONIVEIS (Canônica: 5 parâmetros com p_itens JSONB)
-- ------------------------------------------------------------------------------
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
  v_fuso text := public.obter_fuso_tenant(p_tenant);
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

  v_agora_sp := now() AT TIME ZONE v_fuso;

  SELECT count(*) INTO v_total_agendamentos_dia
  FROM public.agendamentos a
  WHERE a.tenant_id = p_tenant
    AND a.status NOT IN ('cancelado')
    AND (p_ignorar_agendamento IS NULL OR a.id <> p_ignorar_agendamento)
    AND (a.inicio AT TIME ZONE v_fuso)::date <= p_data
    AND ((a.inicio AT TIME ZONE v_fuso)::date + (coalesce(a.dias_ocupados, 1) - 1)) >= p_data;

  v_slot_time := v_horario_func.abre;
  v_fechamento_ts := (p_data || ' ' || v_horario_func.fecha)::timestamp AT TIME ZONE v_fuso;
  v_pos_index := 0;

  WHILE v_slot_time <= (v_horario_func.fecha - (v_grade_minutos || ' minutes')::interval) LOOP
    v_pos_index := v_pos_index + 1;
    v_posicao_inicio := (p_data || ' ' || v_slot_time)::timestamp AT TIME ZONE v_fuso;

    v_is_disponivel := true;
    v_motivo_indisponivel := null;

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
          AND a.status NOT IN ('cancelado')
          AND (p_ignorar_agendamento IS NULL OR a.id <> p_ignorar_agendamento)
          AND coalesce(a.modo_ocupacao_efetivo, a.modo_ocupacao) IN ('dia_inteiro', 'multiplos_dias')
          AND (a.inicio AT TIME ZONE v_fuso)::date <= p_data
          AND ((a.inicio AT TIME ZONE v_fuso)::date + (coalesce(a.dias_ocupados, 1) - 1)) >= p_data
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
        AND a.status NOT IN ('cancelado')
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


-- ------------------------------------------------------------------------------
-- 3.3 CRIAR_AGENDAMENTO (Canônica: 7 parâmetros com p_itens JSONB)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.criar_agendamento(
  p_cliente uuid,
  p_veiculo uuid,
  p_itens jsonb,
  p_categoria uuid,
  p_inicio timestamptz,
  p_observacoes text DEFAULT NULL,
  p_forcado boolean DEFAULT FALSE
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_tenant uuid;
  v_fuso text;
  v_data date;
  v_hora time;
  v_is_valido boolean := false;
  v_agendamento_id uuid;
  v_item jsonb;
  v_servico_id uuid;
  v_combo_id uuid;
  v_duracao integer;
  v_duracao_total integer := 0;
  v_modo text := 'slot';
  v_dias integer := 1;
  v_preco numeric(10,2);
  v_preco_total numeric(10,2) := 0;
  v_ordem smallint := 0;
  v_member_id uuid;
  v_servico_principal uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.clientes WHERE id = p_cliente;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não encontrado.';
  END IF;

  IF NOT (v_tenant IN (SELECT public.meus_tenants())) OR NOT public.tem_papel(v_tenant, ARRAY['dono', 'gerente']::app_role[]) THEN
    RAISE EXCEPTION 'Apenas donos ou gerentes podem realizar agendamentos.';
  END IF;

  v_fuso := public.obter_fuso_tenant(v_tenant);

  SELECT id INTO v_member_id
  FROM public.tenant_members
  WHERE tenant_id = v_tenant AND user_id = auth.uid() AND status = 'ativo';

  IF p_itens IS NULL OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos um serviço para agendar.';
  END IF;

  v_data := (p_inicio AT TIME ZONE v_fuso)::date;
  v_hora := date_trunc('minute', (p_inicio AT TIME ZONE v_fuso))::time;

  PERFORM pg_advisory_xact_lock(hashtext(v_tenant::text || ':' || v_data::text));

  IF NOT p_forcado THEN
    SELECT disponivel INTO v_is_valido
    FROM public.horarios_disponiveis(v_tenant, v_data, p_itens, p_categoria, null) hd
    WHERE hd.horario = v_hora;

    IF NOT coalesce(v_is_valido, false) THEN
      RAISE EXCEPTION 'Este horário não está disponível. Utilize a opção de override forçado se for gestor.';
    END IF;
  END IF;

  v_servico_principal := (p_itens->0->>'servico_id')::uuid;

  IF v_servico_principal IS NOT NULL THEN
    SELECT coalesce(s.modo_ocupacao, 'slot'), coalesce(s.dias_ocupados, 1)
    INTO v_modo, v_dias
    FROM public.servicos s WHERE s.id = v_servico_principal;
  END IF;

  -- Pré-calcula duração total dos itens
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_servico_id := (v_item->>'servico_id')::uuid;
    SELECT coalesce(sp.duracao_minutos, 60), coalesce(sp.preco_base, 0)
    INTO v_duracao, v_preco
    FROM public.servicos s
    LEFT JOIN public.servico_precos sp ON sp.servico_id = s.id AND sp.categoria_id = p_categoria AND sp.ativo
    WHERE s.id = v_servico_id AND s.tenant_id = v_tenant;

    v_duracao_total := v_duracao_total + coalesce(v_duracao, 60);
    v_preco_total := v_preco_total + coalesce(v_preco, 0);
  END LOOP;

  IF v_duracao_total = 0 THEN v_duracao_total := 60; END IF;

  INSERT INTO public.agendamentos (
    tenant_id, cliente_id, veiculo_id, servico_id, categoria_id,
    inicio, duracao_minutos, duracao_total, modo_ocupacao, modo_ocupacao_efetivo, dias_ocupados,
    preco_estimado, preco_estimado_total, status, origem, observacoes, criado_por, forcado, forcado_por, sinal_status
  ) VALUES (
    v_tenant, p_cliente, p_veiculo, v_servico_principal, p_categoria,
    p_inicio, v_duracao_total, v_duracao_total, coalesce(v_modo, 'slot'), coalesce(v_modo, 'slot'), coalesce(v_dias, 1),
    v_preco_total, v_preco_total, 'agendado', 'interno', p_observacoes, auth.uid(),
    p_forcado, CASE WHEN p_forcado THEN v_member_id ELSE NULL END, 'nao_aplicavel'
  ) RETURNING id INTO v_agendamento_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_servico_id := (v_item->>'servico_id')::uuid;
    v_combo_id := nullif(v_item->>'combo_id', '')::uuid;

    SELECT 
      coalesce(sp.duracao_minutos, 60),
      coalesce(s.modo_ocupacao, 'slot'),
      coalesce(s.dias_ocupados, 1),
      sp.preco_base
    INTO v_duracao, v_modo, v_dias, v_preco
    FROM public.servicos s
    LEFT JOIN public.servico_precos sp
      ON sp.servico_id = s.id
     AND sp.categoria_id = p_categoria
     AND sp.ativo
    WHERE s.id = v_servico_id AND s.tenant_id = v_tenant;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Serviço % não encontrado.', v_servico_id;
    END IF;

    INSERT INTO public.agendamento_itens (
      tenant_id, agendamento_id, servico_id, combo_id,
      duracao_minutos, preco_estimado, modo_ocupacao, dias_ocupados, ordem
    ) VALUES (
      v_tenant, v_agendamento_id, v_servico_id, v_combo_id,
      v_duracao, v_preco, v_modo, v_dias, v_ordem
    );

    v_ordem := v_ordem + 1;
  END LOOP;

  PERFORM public.recalcular_agendamento_totais(v_agendamento_id);

  RETURN v_agendamento_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_agendamento(uuid, uuid, jsonb, uuid, timestamptz, text, boolean) TO authenticated;


-- ------------------------------------------------------------------------------
-- 3.4 AGENDAR_CLIENTE_ONLINE (Canônica: 12 parâmetros)
-- ------------------------------------------------------------------------------
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
  WHERE t.slug = p_slug
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oficina não encontrada.';
  END IF;

  IF NOT coalesce(v_tenant.agendamento_online_ativo, true) THEN
    RAISE EXCEPTION 'O agendamento online não está ativado nesta oficina.';
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
      RAISE EXCEPTION 'Serviço % não encontrado ou inativo.', (v_item->>'servico_id');
    END IF;

    SELECT * INTO v_sp
    FROM public.servico_precos sp
    WHERE sp.servico_id = v_servico.id AND sp.categoria_id = p_categoria;

    v_preco_item := coalesce(v_sp.preco_base, 0);
    v_duracao_item := coalesce(v_sp.duracao_minutos, 60);

    v_duracao_total := v_duracao_total + v_duracao_item;
    v_valor_total := v_valor_total + v_preco_item;

    IF coalesce(v_item->>'modo_ocupacao', v_servico.modo_ocupacao, 'transborda') = 'dia_inteiro' THEN
      v_modo_efetivo := 'dia_inteiro';
      v_max_dias := greatest(v_max_dias, coalesce(v_servico.dias_ocupados, 1));
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

  -- 4. Grava Consentimento Legal (LGPD sem ON CONFLICT silencioso)
  INSERT INTO public.consentimentos_publicos (
    tenant_id, tipo, identificador, documento_versao, aceito_em, ip, user_agent
  ) VALUES (
    v_tenant.id, 'agendamento_online', v_tel_norm, 'v1.0-2026-08', now(), p_ip, p_user_agent
  );

  -- 5. Tratamento de Sinal Pix e Status Inicial
  IF coalesce(v_tenant.sinal_ativo, false) AND coalesce(v_tenant.sinal_valor, 0) > 0 AND v_valor_total > 0 THEN
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

  -- 8. Gera payload Pix com TxID curto baseado no número de OS (máx 25 chars)
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

-- ------------------------------------------------------------------------------
-- 3.5 AGENDAR_ONLINE (Canônica: 12 parâmetros - Alias único para agendar_cliente_online)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agendar_online(
  p_slug text,
  p_nome text,
  p_telefone text,
  p_placa text,
  p_modelo text,
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
BEGIN
  RETURN public.agendar_cliente_online(
    p_slug => p_slug,
    p_cliente_nome => p_nome,
    p_cliente_telefone => p_telefone,
    p_veiculo_placa => p_placa,
    p_veiculo_modelo => p_modelo,
    p_categoria => p_categoria,
    p_itens => p_itens,
    p_inicio => p_inicio,
    p_observacoes => p_observacoes,
    p_transbordo_aceito => p_transbordo_aceito,
    p_user_agent => p_user_agent,
    p_ip => p_ip
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.agendar_online(text, text, text, text, text, uuid, jsonb, timestamptz, text, boolean, text, text) TO anon, authenticated;


-- ------------------------------------------------------------------------------
-- 3.6 RESPONDER_ORCAMENTO
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.responder_orcamento(uuid, text, boolean, text, text);
DROP FUNCTION IF EXISTS public.responder_orcamento(uuid, text, boolean);
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
  v_cliente_nome text;
  v_nivel_valor numeric(10,2) := 0;
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

    SELECT coalesce(valor_total, 0) INTO v_nivel_valor
    FROM public.orcamento_niveis
    WHERE orcamento_id = v_orcamento.id AND nivel = p_nivel;

    IF NOT FOUND THEN
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

    -- Obter nome do cliente para a notificação
    SELECT COALESCE(c.nome, 'Cliente') INTO v_cliente_nome
    FROM public.clientes c
    WHERE c.id = v_orcamento.cliente_id;

    -- Disparar Notificação Pontual para a Oficina (papel mínimo: gerente)
    PERFORM public.criar_notificacao_interna(
      v_orcamento.tenant_id,
      NULL,
      'oficina',
      'gerente',
      'orcamento_aprovado',
      '🎉 Orçamento Aprovado!',
      COALESCE(v_nome_limpo, v_cliente_nome, 'Cliente') || ' aprovou a proposta #' || LPAD(v_os_num::text, 4, '0') || ' (' || upper(p_nivel) || ') no valor de R$ ' || to_char(COALESCE(v_nivel_valor, 0), 'FM999G999G990D00') || '.',
      '/orcamentos',
      jsonb_build_object('orcamento_id', v_orcamento.id, 'numero_os', v_os_num, 'nivel', p_nivel)
    );
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


-- ------------------------------------------------------------------------------
-- 3.7 AGENDAR_ORCAMENTO_PUBLICO (Canônica: 5 parâmetros com p_token UUID)
-- ------------------------------------------------------------------------------
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
  v_sinal_status_final text := 'nao_aplicavel';
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

  v_os_num := public.proximo_numero_os(v_orcamento.tenant_id);

  v_obs_final := coalesce(v_orcamento.observacoes, '');
  IF v_is_transbordo THEN
    v_obs_final := trim(v_obs_final || ' [Transbordo Aceito pelo Cliente: Término previsto em ' || to_char(v_termino_previsto AT TIME ZONE coalesce(v_tenant.fuso_horario, 'America/Sao_Paulo'), 'DD/MM/YYYY às HH24:MI') || ']');
  END IF;

  -- 6. Cria o Agendamento (Schema estrito com origem = 'orcamento')
  INSERT INTO public.agendamentos (
    tenant_id, cliente_id, veiculo_id, categoria_id, numero_os,
    inicio, duracao_minutos, duracao_total, modo_ocupacao, modo_ocupacao_efetivo, dias_ocupados,
    preco_estimado, preco_estimado_total, status, origem,
    observacoes, sinal_valor, sinal_status, previsao_entrega,
    transbordo_aceito_em, transbordo_aceite_user_agent, transbordo_aceite_ip
  ) VALUES (
    v_orcamento.tenant_id, v_orcamento.cliente_id, v_orcamento.veiculo_id, v_orcamento.categoria_id, v_os_num,
    p_inicio, v_duracao_total_calculada, v_duracao_total_calculada, coalesce(v_modo_efetivo, 'slot'), coalesce(v_modo_efetivo, 'slot'), coalesce(v_dias_item, 1),
    v_total_calculado, v_total_calculado, v_status_inicial, 'orcamento',
    nullif(v_obs_final, ''), v_sinal_valor_calc, v_sinal_status_final, v_termino_previsto,
    CASE WHEN v_is_transbordo THEN now() ELSE null END,
    CASE WHEN v_is_transbordo THEN p_user_agent ELSE null END,
    CASE WHEN v_is_transbordo THEN p_ip ELSE null END
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

  -- Atualiza o orcamento associando o agendamento_id (sem alterar status para convertido)
  UPDATE public.orcamentos
  SET agendamento_id = v_agendamento_id,
      updated_at = now()
  WHERE id = v_orcamento.id;

  -- 8. Gera payload Pix com TxID curto baseado no número de OS (máx 25 chars)
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

GRANT EXECUTE ON FUNCTION public.agendar_orcamento_publico(uuid, timestamptz, boolean, text, text) TO anon, authenticated;


-- ------------------------------------------------------------------------------
-- 3.8 CONCLUIR_ATENDIMENTO (Canônica: 4 parâmetros com consolidação estrita de tempo)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.concluir_atendimento(
  p_execucao uuid,
  p_valores jsonb DEFAULT '[]'::jsonb,
  p_consumos jsonb DEFAULT '[]'::jsonb,
  p_observacoes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_exec record;
  v_pendentes_count integer;
  v_pendentes_lista text;
  v_now timestamptz := now();
  v_segundos_totais integer := 0;
  v_tempo_efetivo integer := 0;
  
  v_old_consumo record;
  v_item_c jsonb;
  v_produto_id uuid;
  v_quantidade numeric(12,2);
  v_custo_unitario numeric(12,6);
  v_custo_total numeric(12,2);

  v_val_item jsonb;
  v_total_final numeric(10,2) := 0.00;
  v_agendamento_item_id uuid;
  v_val_final numeric(10,2);
  v_motivo_item text;
  v_estimado numeric(10,2);
  v_executor record;
  v_comissao_calculada numeric(10,2);
BEGIN
  -- 1. Carrega execução e valida status
  SELECT e.id, e.tenant_id, e.agendamento_id, e.status, e.iniciado_em, e.contando_desde, e.segundos_trabalhados, e.finalizado_em
  INTO v_exec
  FROM public.execucoes e
  WHERE e.id = p_execucao;

  IF v_exec.id IS NULL THEN
    RAISE EXCEPTION 'Execução não encontrada.';
  END IF;

  IF v_exec.status = 'finalizado' THEN
    RAISE EXCEPTION 'Esta execução já se encontra finalizada.';
  END IF;

  -- 2. Consolidação estrita do cronômetro (Zera contando_desde)
  v_segundos_totais := coalesce(v_exec.segundos_trabalhados, 0);
  IF v_exec.contando_desde IS NOT NULL THEN
    v_segundos_totais := v_segundos_totais + greatest(0, extract(epoch from (v_now - v_exec.contando_desde))::integer);
  ELSIF v_segundos_totais = 0 AND v_exec.iniciado_em IS NOT NULL THEN
    v_segundos_totais := greatest(0, extract(epoch from (v_now - v_exec.iniciado_em))::integer);
  END IF;

  -- 3. Validação de checklist obrigatório
  SELECT count(*), string_agg(ei.descricao, ', ') INTO v_pendentes_count, v_pendentes_lista
  FROM public.execucao_itens ei
  WHERE ei.execucao_id = p_execucao
    AND ei.obrigatorio = true
    AND ei.concluido = false;

  IF v_pendentes_count > 0 THEN
    RAISE EXCEPTION 'Existem itens obrigatórios pendentes no checklist: %', v_pendentes_lista;
  END IF;

  v_tempo_efetivo := round(v_segundos_totais::numeric / 60.0)::integer;
  IF v_tempo_efetivo < 0 THEN v_tempo_efetivo := 0; END IF;

  -- 4. Grava status = finalizado e ZERA contando_desde
  UPDATE public.execucoes
  SET status = 'finalizado',
      finalizado_em = coalesce(v_exec.finalizado_em, v_now),
      contando_desde = NULL,
      segundos_trabalhados = v_segundos_totais,
      tempo_efetivo_minutos = v_tempo_efetivo,
      observacoes_saida = coalesce(p_observacoes, observacoes_saida),
      pausado_em = NULL,
      updated_at = v_now
  WHERE id = p_execucao;

  -- 5. Grava consumos de produtos
  FOR v_old_consumo IN
    SELECT produto_id, quantidade FROM public.execucao_consumos WHERE execucao_id = p_execucao
  LOOP
    UPDATE public.produtos
    SET estoque_atual = estoque_atual + v_old_consumo.quantidade
    WHERE id = v_old_consumo.produto_id;
  END LOOP;

  DELETE FROM public.estoque_movimentos WHERE execucao_id = p_execucao AND tipo = 'consumo';
  DELETE FROM public.execucao_consumos WHERE execucao_id = p_execucao;

  IF p_consumos IS NOT NULL AND jsonb_array_length(p_consumos) > 0 THEN
    FOR v_item_c IN SELECT * FROM jsonb_array_elements(p_consumos) LOOP
      v_produto_id := (v_item_c->>'produto_id')::uuid;
      v_quantidade := (v_item_c->>'quantidade')::numeric;

      IF v_quantidade > 0 THEN
        SELECT p.custo_unitario INTO v_custo_unitario
        FROM public.produtos p
        WHERE p.id = v_produto_id AND p.tenant_id = v_exec.tenant_id;

        IF v_custo_unitario IS NULL THEN v_custo_unitario := 0; END IF;
        v_custo_total := round(v_quantidade * v_custo_unitario, 2);

        INSERT INTO public.execucao_consumos (
          tenant_id, execucao_id, produto_id, quantidade, custo_unitario, custo_total, registrado_por
        ) VALUES (
          v_exec.tenant_id, p_execucao, v_produto_id, v_quantidade, v_custo_unitario, v_custo_total, auth.uid()
        );

        INSERT INTO public.estoque_movimentos (
          tenant_id, produto_id, tipo, quantidade, custo_unitario, custo_total, execucao_id, criado_por
        ) VALUES (
          v_exec.tenant_id, v_produto_id, 'consumo', -v_quantidade, v_custo_unitario, v_custo_total, p_execucao, auth.uid()
        );

        UPDATE public.produtos
        SET estoque_atual = estoque_atual - v_quantidade
        WHERE id = v_produto_id;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.execucoes
  SET custo_produtos = (
    SELECT coalesce(sum(custo_total), 0)
    FROM public.execucao_consumos
    WHERE execucao_id = p_execucao
  )
  WHERE id = p_execucao;

  -- 6. Grava valores finais
  IF p_valores IS NOT NULL AND jsonb_array_length(p_valores) > 0 THEN
    FOR v_val_item IN SELECT * FROM jsonb_array_elements(p_valores) LOOP
      v_agendamento_item_id := (v_val_item->>'agendamento_item_id')::uuid;
      v_val_final := coalesce((v_val_item->>'valor_final')::numeric(10,2), 0.00);
      v_motivo_item := v_val_item->>'motivo';

      SELECT ai.preco_estimado INTO v_estimado
      FROM public.agendamento_itens ai
      WHERE ai.id = v_agendamento_item_id;

      INSERT INTO public.execucao_valores (
        tenant_id, execucao_id, agendamento_item_id, valor_estimado, valor_final, motivo
      ) VALUES (
        v_exec.tenant_id, p_execucao, v_agendamento_item_id, v_estimado, v_val_final, v_motivo_item
      )
      ON CONFLICT (execucao_id, agendamento_item_id) DO UPDATE
      SET valor_final = EXCLUDED.valor_final,
          valor_estimado = EXCLUDED.valor_estimado,
          motivo = EXCLUDED.motivo;

      v_total_final := v_total_final + v_val_final;
    END LOOP;
  ELSE
    SELECT coalesce(sum(preco_estimado), 0.00) INTO v_total_final
    FROM public.agendamento_itens
    WHERE agendamento_id = v_exec.agendamento_id;
  END IF;

  UPDATE public.execucoes
  SET valor_total_final = v_total_final,
      valor_definido_por = auth.uid(),
      valor_definido_em = v_now,
      updated_at = v_now
  WHERE id = p_execucao;

  -- 7. Recalcula comissões dos executores
  FOR v_executor IN (
    SELECT ee.id, ee.member_id, cv.tipo AS comissao_tipo, cv.valor AS comissao_valor
    FROM public.execucao_executores ee
    CROSS JOIN LATERAL public.comissao_vigente(ee.member_id, current_date) cv
    WHERE ee.execucao_id = p_execucao
  ) LOOP
    v_comissao_calculada := 0.00;
    IF v_executor.comissao_tipo = 'percentual' AND v_executor.comissao_valor > 0 THEN
      v_comissao_calculada := (v_total_final * v_executor.comissao_valor) / 100.00;
    ELSIF v_executor.comissao_tipo = 'valor_fixo' AND v_executor.comissao_valor > 0 THEN
      v_comissao_calculada := v_executor.comissao_valor;
    END IF;

    UPDATE public.execucao_executores
    SET comissao_tipo = v_executor.comissao_tipo,
        comissao_valor = v_executor.comissao_valor,
        comissao_calculada = v_comissao_calculada
    WHERE id = v_executor.id;
  END LOOP;

  -- 8. Atualiza agendamento para 'concluido'
  UPDATE public.agendamentos
  SET status = 'concluido',
      preco_estimado_total = v_total_final,
      updated_at = v_now
  WHERE id = v_exec.agendamento_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.concluir_atendimento(uuid, jsonb, jsonb, text) TO authenticated;


-- ------------------------------------------------------------------------------
-- 3.9 FINALIZAR_EXECUCAO_COM_PAGAMENTOS (Canônica: 8 parâmetros com tabela recebimentos)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalizar_execucao_com_pagamentos(
  p_execucao uuid,
  p_pagamentos jsonb DEFAULT '[]'::jsonb,
  p_valores jsonb DEFAULT '[]'::jsonb,
  p_consumos jsonb DEFAULT '[]'::jsonb,
  p_observacoes text DEFAULT NULL,
  p_desconto_tipo text DEFAULT NULL,
  p_desconto_valor numeric DEFAULT 0,
  p_desconto_motivo text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_exec record;
  v_item jsonb;
  v_forma_id uuid;
  v_maquininha_id uuid;
  v_bandeira_codigo text;
  v_total_parcelas integer;
  v_numero_parcela integer;
  v_valor_bruto numeric(10,2);
  v_previsto_para date;
  v_obs text;
  v_taxa_perc numeric(5,2) := 0.00;
  v_taxa_fixa numeric(10,2) := 0.00;
  v_taxa_estimada boolean := false;
  v_valor_taxa numeric(10,2) := 0.00;
  v_valor_liquido numeric(10,2) := 0.00;
  v_status text;
  v_recebido_em timestamptz;
  v_soma_pagamentos numeric(10,2) := 0.00;
  v_sinal_pago numeric(10,2) := 0.00;
  v_saldo_restante numeric(10,2);
  v_forma_tipo text;
  v_faturamento_bruto numeric(10,2);
  v_faturamento_com_desconto numeric(10,2);
  v_desc_val numeric(10,2);
  v_desc_tipo_norm text;
BEGIN
  -- 1. Carrega execução e cliente do agendamento
  SELECT e.id, e.tenant_id, e.agendamento_id, a.cliente_id
  INTO v_exec
  FROM public.execucoes e
  JOIN public.agendamentos a ON a.id = e.agendamento_id
  WHERE e.id = p_execucao;

  IF v_exec.id IS NULL THEN
    RAISE EXCEPTION 'Execução não encontrada.';
  END IF;

  v_tenant := v_exec.tenant_id;
  IF NOT (v_tenant IN (SELECT public.meus_tenants())) OR NOT public.tem_papel(v_tenant, ARRAY['dono', 'gerente']::app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado. Apenas dono ou gerente podem finalizar atendimento com dados financeiros.';
  END IF;

  -- 2. Conclusão operacional de itens, consumos e tempo trabalhado
  PERFORM public.concluir_atendimento(p_execucao, p_valores, p_consumos, p_observacoes);

  -- Recarrega valor total bruto após conclusão dos itens
  SELECT valor_total_final INTO v_faturamento_bruto FROM public.execucoes WHERE id = p_execucao;
  v_faturamento_com_desconto := COALESCE(v_faturamento_bruto, 0.00);

  -- 3. Processa aplicação de desconto na finalização
  v_desc_val := COALESCE(p_desconto_valor, 0.00);
  IF v_desc_val > 0 THEN
    IF p_desconto_motivo IS NULL OR trim(p_desconto_motivo) = '' THEN
      RAISE EXCEPTION 'O motivo do desconto é obrigatório quando há concessão de desconto.';
    END IF;

    v_desc_tipo_norm := lower(trim(coalesce(p_desconto_tipo, '')));

    IF v_desc_tipo_norm IN ('porcentagem', 'percentual', '%') THEN
      v_faturamento_com_desconto := round(v_faturamento_bruto - (v_faturamento_bruto * v_desc_val / 100.0), 2);
      v_desc_tipo_norm := 'porcentagem';
    ELSIF v_desc_tipo_norm IN ('valor_fixo', 'fixo', 'reais', 'dinheiro', 'moeda') THEN
      v_faturamento_com_desconto := greatest(0.00, round(v_faturamento_bruto - v_desc_val, 2));
      v_desc_tipo_norm := 'valor_fixo';
    ELSE
      RAISE EXCEPTION 'Tipo de desconto inválido: %', p_desconto_tipo;
    END IF;

    UPDATE public.execucoes
    SET desconto_tipo = v_desc_tipo_norm,
        desconto_valor = v_desc_val,
        desconto_motivo = trim(p_desconto_motivo),
        desconto_aplicado_por = auth.uid(),
        valor_total_final = v_faturamento_com_desconto,
        observacoes_saida = coalesce(p_observacoes, observacoes_saida),
        updated_at = now()
    WHERE id = p_execucao;
  ELSE
    IF p_observacoes IS NOT NULL THEN
      UPDATE public.execucoes
      SET observacoes_saida = p_observacoes,
          updated_at = now()
      WHERE id = p_execucao;
    END IF;
  END IF;

  -- 4. Verifica sinal pré-pago em agendamentos (sinal_status = 'pago')
  SELECT COALESCE(sinal_valor, 0.00) INTO v_sinal_pago
  FROM public.agendamentos
  WHERE id = v_exec.agendamento_id AND sinal_status = 'pago';

  v_soma_pagamentos := v_sinal_pago;

  -- 5. Insere cada parcela estritamente na tabela recebimentos
  IF p_pagamentos IS NOT NULL AND jsonb_array_length(p_pagamentos) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_pagamentos) LOOP
      v_forma_id := (v_item->>'forma_id')::uuid;
      IF v_forma_id IS NULL THEN
        v_forma_id := (v_item->>'forma_pagamento_id')::uuid;
      END IF;

      v_maquininha_id := (v_item->>'maquininha_id')::uuid;
      v_bandeira_codigo := v_item->>'bandeira_codigo';
      v_total_parcelas := COALESCE((v_item->>'total_parcelas')::integer, 1);
      v_numero_parcela := COALESCE((v_item->>'numero_parcela')::integer, 1);
      v_valor_bruto := (v_item->>'valor_bruto')::numeric;
      v_previsto_para := COALESCE((v_item->>'previsto_para')::date, CURRENT_DATE);
      v_obs := COALESCE(v_item->>'observacao', v_item->>'observacoes');

      IF v_valor_bruto IS NULL OR v_valor_bruto <= 0 THEN
        RAISE EXCEPTION 'O valor de cada parcela deve ser maior que zero.';
      END IF;

      SELECT tipo INTO v_forma_tipo
      FROM public.tenant_formas_pagamento
      WHERE id = v_forma_id AND tenant_id = v_tenant;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Forma de pagamento não encontrada.';
      END IF;

      -- Resolução de taxas da maquininha (5 parâmetros canônicos)
      IF v_maquininha_id IS NOT NULL THEN
        SELECT taxa_percentual, taxa_fixa, taxa_estimada
        INTO v_taxa_perc, v_taxa_fixa, v_taxa_estimada
        FROM public.resolver_taxa_cartao(
          v_maquininha_id,
          v_forma_tipo,
          v_bandeira_codigo,
          v_total_parcelas,
          CURRENT_DATE
        );
      ELSE
        v_taxa_perc := 0.00;
        v_taxa_fixa := 0.00;
        v_taxa_estimada := false;
      END IF;

      v_valor_taxa := round((v_valor_bruto * (COALESCE(v_taxa_perc, 0.00) / 100.0)) + COALESCE(v_taxa_fixa, 0.00), 2);
      v_valor_liquido := greatest(0.00, v_valor_bruto - v_valor_taxa);

      IF v_forma_tipo IN ('dinheiro', 'pix') THEN
        v_status := 'recebido';
        v_recebido_em := now();
      ELSE
        v_status := 'previsto';
        v_recebido_em := NULL;
      END IF;

      INSERT INTO public.recebimentos (
        tenant_id, execucao_id, agendamento_id, cliente_id,
        forma_id, maquininha_id, bandeira_codigo,
        valor_bruto, taxa_percentual_snapshot, taxa_fixa_snapshot, taxa_estimada,
        valor_taxa, valor_liquido, total_parcelas, numero_parcela,
        status, origem, previsto_para, recebido_em, observacao, criado_por
      ) VALUES (
        v_tenant, p_execucao, v_exec.agendamento_id, v_exec.cliente_id,
        v_forma_id, v_maquininha_id, v_bandeira_codigo,
        v_valor_bruto, COALESCE(v_taxa_perc, 0.00), COALESCE(v_taxa_fixa, 0.00), v_taxa_estimada,
        v_valor_taxa, v_valor_liquido, v_total_parcelas, v_numero_parcela,
        v_status, 'manual', v_previsto_para, v_recebido_em, v_obs, auth.uid()
      );

      v_soma_pagamentos := v_soma_pagamentos + v_valor_bruto;
    END LOOP;
  END IF;

  -- 6. Validação de consistência do caixa
  v_saldo_restante := round(v_faturamento_com_desconto - v_soma_pagamentos, 2);
  IF abs(v_saldo_restante) > 0.05 THEN
    RAISE EXCEPTION 'A soma dos pagamentos informados (R$ %) somada ao sinal (R$ %) não confere com o total devido (R$ %). Diferença: R$ %',
      (v_soma_pagamentos - v_sinal_pago), v_sinal_pago, v_faturamento_com_desconto, v_saldo_restante;
  END IF;

  -- 7. Consolidação da Cascata Financeira (fechar_resultado_execucao)
  PERFORM public.fechar_resultado_execucao(p_execucao);
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalizar_execucao_com_pagamentos(uuid, jsonb, jsonb, jsonb, text, text, numeric, text) TO authenticated;


-- ------------------------------------------------------------------------------
-- 3.10 CRIAR_OFICINA (Canônica: 7 parâmetros com semeadura completa)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.criar_oficina(
  p_nome text,
  p_cidade text,
  p_uf text,
  p_telefone text,
  p_codigo_indicacao text DEFAULT NULL,
  p_codigo_parceiro text DEFAULT NULL,
  p_documento text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE 
  v_tenant uuid; 
  v_slug text;
  v_trial_fim date;
  v_codigo_proprio text;
  v_parceiro RECORD;
  v_indicador RECORD;
  v_indicado_email text;
  v_indicador_email text;
  v_indicador_tel text;
  v_indicador_doc text;
  v_agora timestamp with time zone := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário precisa estar autenticado para criar oficina.';
  END IF;

  IF coalesce(trim(p_nome), '') = '' THEN
    RAISE EXCEPTION 'Informe o nome da oficina.';
  END IF;

  IF (
    SELECT count(*) FROM public.tenant_members
    WHERE user_id = auth.uid() AND role = 'dono' AND status IN ('ativo', 'convidado')
  ) >= 3 THEN
    RAISE EXCEPTION 'Limite de oficinas por usuário atingido.';
  END IF;

  v_slug := lower(regexp_replace(p_nome, '[^a-zA-Z0-9]+', '-', 'g'))
            || '-' || substr(gen_random_uuid()::text, 1, 6);

  v_trial_fim := (current_date + 14);
  v_codigo_proprio := public.gerar_codigo_indicacao_unico();

  -- 1. Criar Tenant
  INSERT INTO public.tenants (nome, slug, cidade, uf, telefone, documento, criado_por, plano, codigo_indicacao)
    VALUES (p_nome, v_slug, p_cidade, p_uf, p_telefone, p_documento, auth.uid(), 'pro', v_codigo_proprio)
    RETURNING id INTO v_tenant;

  -- 2. Criar Membro Dono
  INSERT INTO public.tenant_members (tenant_id, user_id, email, role, status)
    VALUES (
      v_tenant, 
      auth.uid(),
      (SELECT email FROM auth.users WHERE id = auth.uid()),
      'dono', 
      'ativo'
    );

  -- 3. Registrar Assinatura Inicial (Pro Trial 14d)
  INSERT INTO public.assinaturas (
    tenant_id, plano, status, valor_centavos, trial_fim, created_at, updated_at
  ) VALUES (
    v_tenant, 'pro', 'trial', 6700, v_trial_fim, now(), now()
  ) ON CONFLICT (tenant_id) DO NOTHING;

  -- 4. Semeadura de 7 Categorias Padrão
  INSERT INTO public.categorias_veiculo (tenant_id, nome, descricao, ordem, ativo)
  VALUES
    (v_tenant, 'Hatch', 'Onix, HB20, Gol, Argo, Polo', 0, true),
    (v_tenant, 'Sedan', 'Corolla, Civic, Virtus, Cronos, Onix Plus', 1, true),
    (v_tenant, 'SUV', 'Creta, Compass, T-Cross, Renegade, Tracker', 2, true),
    (v_tenant, 'Caminhonete', 'Hilux, S10, Ranger, Toro, Strada', 3, true),
    (v_tenant, 'Van / Utilitário', 'Kombi, Master, Sprinter, Ducato', 4, false),
    (v_tenant, 'Caminhão', 'Veículos pesados', 5, false),
    (v_tenant, 'Moto', 'Todas as cilindradas', 6, false)
  ON CONFLICT (tenant_id, nome) DO NOTHING;

  -- 5. Semeadura de 7 Horários de Funcionamento
  PERFORM public.seed_horarios_funcionamento_tenant(v_tenant);

  -- 6. Semeadura de 5 Formas de Pagamento
  PERFORM public.seed_formas_pagamento_tenant(v_tenant);

  -- 7. Semeadura de 1 Maquininha Padrão
  IF NOT EXISTS (SELECT 1 FROM public.tenant_maquininhas WHERE tenant_id = v_tenant AND padrao = true) THEN
    INSERT INTO public.tenant_maquininhas (tenant_id, nome, padrao, ordem)
    VALUES (v_tenant, 'Maquininha Padrão', true, 1);
  END IF;

  -- 8. Processar Código de PARCEIRO (Precedência Absoluta)
  IF p_codigo_parceiro IS NOT NULL AND trim(p_codigo_parceiro) != '' THEN
    SELECT * INTO v_parceiro FROM public.parceiros 
    WHERE codigo = upper(trim(p_codigo_parceiro)) AND ativo = true;

    IF FOUND THEN
      INSERT INTO public.parceiro_oficinas (parceiro_id, tenant_id)
      VALUES (v_parceiro.id, v_tenant)
      ON CONFLICT (tenant_id) DO NOTHING;
    END IF;
  END IF;

  -- 9. Processar Código de INDICAÇÃO (Criando como PENDENTE)
  IF (p_codigo_parceiro IS NULL OR trim(p_codigo_parceiro) = '') 
     AND p_codigo_indicacao IS NOT NULL AND trim(p_codigo_indicacao) != '' THEN
    SELECT * INTO v_indicador FROM public.tenants 
    WHERE codigo_indicacao = upper(trim(p_codigo_indicacao));

    IF FOUND AND v_indicador.id != v_tenant THEN
      SELECT email INTO v_indicado_email FROM auth.users WHERE id = auth.uid();
      
      SELECT u.email, t.telefone, t.documento INTO v_indicador_email, v_indicador_tel, v_indicador_doc
      FROM public.tenants t
      JOIN public.tenant_members tm ON tm.tenant_id = t.id AND tm.role = 'dono'
      JOIN auth.users u ON u.id = tm.user_id
      WHERE t.id = v_indicador.id LIMIT 1;

      IF lower(trim(coalesce(v_indicado_email,''))) != lower(trim(coalesce(v_indicador_email,'')))
         AND NOT (length(trim(coalesce(p_telefone,''))) > 5 AND trim(p_telefone) = trim(coalesce(v_indicador_tel,'')))
         AND NOT (length(trim(coalesce(p_documento,''))) > 5 AND trim(p_documento) = trim(coalesce(v_indicador_doc,''))) THEN
        
        INSERT INTO public.indicacoes (indicador_tenant_id, indicado_tenant_id, codigo, status, convertida_em)
        VALUES (v_indicador.id, v_tenant, upper(trim(p_codigo_indicacao)), 'pendente', NULL)
        ON CONFLICT (indicado_tenant_id) DO NOTHING;
      END IF;
    END IF;
  END IF;

  -- 10. Notificar Admin sobre a Nova Oficina
  PERFORM public.criar_notificacao_interna(
    v_tenant,
    auth.uid(),
    'admin',
    'operador',
    'nova_oficina',
    '🏢 Nova Oficina Cadastrada',
    'A oficina "' || p_nome || '" (' || coalesce(p_cidade, '-') || '/' || coalesce(p_uf, '-') || ') iniciou o Trial Pro de 14 dias.',
    '/admin/oficinas',
    jsonb_build_object('tenant_id', v_tenant, 'plano', 'pro')
  );

  RETURN v_tenant;
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_oficina(text, text, text, text, text, text, text) TO authenticated;


-- ==============================================================================
-- 4. RECARGA DO SCHEMA DO POSTGREST
-- ==============================================================================
NOTIFY pgrst, 'reload schema';
