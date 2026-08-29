-- ==============================================================================
-- MIGRAÇÃO 0068: AJUSTES DO PROGRAMA DE INDICAÇÃO
-- 1. Status 'pendente' até assinatura paga do indicado
-- 2. Teto mensal elevado para 50 conversões/mês por oficina
-- 3. Função de conversão acionada por pagamento/assinatura
-- 4. Política de não-estorno em caso de cancelamento posterior do indicado
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ATUALIZAÇÃO DA CONSTRAINT DE STATUS DA TABELA DE INDICAÇÕES
-- ------------------------------------------------------------------------------
ALTER TABLE public.indicacoes DROP CONSTRAINT IF EXISTS indicacoes_status_check;
ALTER TABLE public.indicacoes ADD CONSTRAINT indicacoes_status_check 
  CHECK (status IN ('pendente', 'convertida', 'invalidada'));

ALTER TABLE public.indicacoes ALTER COLUMN status SET DEFAULT 'pendente';
ALTER TABLE public.indicacoes ALTER COLUMN convertida_em DROP DEFAULT;

-- ------------------------------------------------------------------------------
-- 2. ATUALIZAÇÃO DA RPC CRIAR OFICINA (CRIA INDICAÇÃO COMO 'PENDENTE')
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
  v_nova_data_indicado date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF coalesce(trim(p_nome), '') = '' THEN
    RAISE EXCEPTION 'Informe o nome da oficina.';
  END IF;

  IF (
    SELECT count(*) FROM tenant_members
    WHERE user_id = auth.uid() AND role = 'dono' AND status IN ('ativo', 'convidado')
  ) >= 3 THEN
    RAISE EXCEPTION 'Limite de oficinas por usuário atingido.';
  END IF;

  v_slug := lower(regexp_replace(p_nome, '[^a-zA-Z0-9]+', '-', 'g'))
            || '-' || substr(gen_random_uuid()::text, 1, 6);

  v_trial_fim := (now() AT TIME ZONE 'America/Sao_Paulo')::date + 14;
  v_codigo_proprio := public.gerar_codigo_indicacao_unico();

  -- 1. Criar Tenant
  INSERT INTO tenants (nome, slug, cidade, uf, telefone, documento, criado_por, plano, codigo_indicacao)
    VALUES (p_nome, v_slug, p_cidade, p_uf, p_telefone, p_documento, auth.uid(), 'pro', v_codigo_proprio)
    RETURNING id INTO v_tenant;

  -- 2. Criar Membro Dono
  INSERT INTO tenant_members (tenant_id, user_id, email, role, status)
    VALUES (
      v_tenant, 
      auth.uid(),
      (SELECT email FROM auth.users WHERE id = auth.uid()),
      'dono', 
      'ativo'
    );

  -- 3. Registrar Assinatura Inicial (Pro Trial 14d)
  INSERT INTO public.assinaturas (
    tenant_id, plano, status, valor_centavos, trial_fim
  ) VALUES (
    v_tenant, 'pro', 'trial', 6700, v_trial_fim
  ) ON CONFLICT (tenant_id) DO NOTHING;

  -- 4. Processar Código de PARCEIRO (Precedência Absoluta)
  IF p_codigo_parceiro IS NOT NULL AND trim(p_codigo_parceiro) != '' THEN
    SELECT * INTO v_parceiro FROM public.parceiros 
    WHERE codigo = upper(trim(p_codigo_parceiro)) AND ativo = true;

    IF FOUND THEN
      INSERT INTO public.parceiro_oficinas (parceiro_id, tenant_id)
      VALUES (v_parceiro.id, v_tenant)
      ON CONFLICT (tenant_id) DO NOTHING;

      -- Parceiro possui precedência absoluta; encerra o processamento
      RETURN v_tenant;
    END IF;
  END IF;

  -- 5. Processar Código de INDICAÇÃO (Criando como PENDENTE)
  IF p_codigo_indicacao IS NOT NULL AND trim(p_codigo_indicacao) != '' THEN
    SELECT * INTO v_indicador FROM public.tenants 
    WHERE codigo_indicacao = upper(trim(p_codigo_indicacao));

    IF FOUND AND v_indicador.id != v_tenant THEN
      -- Trava Anti-Fraude: Verificar e-mail, telefone e documento
      SELECT email INTO v_indicado_email FROM auth.users WHERE id = auth.uid();
      
      SELECT u.email, t.telefone, t.documento INTO v_indicador_email, v_indicador_tel, v_indicador_doc
      FROM public.tenants t
      JOIN public.tenant_members tm ON tm.tenant_id = t.id AND tm.role = 'dono'
      JOIN auth.users u ON u.id = tm.user_id
      WHERE t.id = v_indicador.id LIMIT 1;

      IF lower(trim(coalesce(v_indicado_email,''))) = lower(trim(coalesce(v_indicador_email,'')))
         OR (length(trim(coalesce(p_telefone,''))) > 5 AND trim(p_telefone) = trim(coalesce(v_indicador_tel,'')))
         OR (length(trim(coalesce(p_documento,''))) > 5 AND trim(p_documento) = trim(coalesce(v_indicador_doc,''))) THEN
        -- Auto-indicação detectada! Recusa registro de indicação
        RETURN v_tenant;
      END IF;

      -- Registrar Indicação com status 'pendente' (Aguardando Assinatura do Indicado)
      INSERT INTO public.indicacoes (indicador_tenant_id, indicado_tenant_id, codigo, status, convertida_em)
      VALUES (v_indicador.id, v_tenant, upper(trim(p_codigo_indicacao)), 'pendente', NULL)
      ON CONFLICT (indicado_tenant_id) DO NOTHING;

      -- NOTA: O indicado recebe os 14 dias de degustação padrão (trial Pro).
      -- O bônus do INDICADOR (+15 dias + metas) será acionado quando a oficina indicada efetuar a primeira assinatura paga via RPC processar_conversao_indicacao.
    END IF;
  END IF;

  RETURN v_tenant;
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. RPC PARA PROCESSAR A CONVERSÃO DA INDICAÇÃO QUANDO O INDICADO ASSINA
-- ------------------------------------------------------------------------------
-- POLÍTICA DE CANCELAMENTO POSTERIOR:
-- Se a oficina indicada assinar um plano e posteriormente cancelar sua assinatura,
-- os dias bônus e metas JÁ concedidos ao indicador PERMANECEM VÁLIDOS (não há estorno).
-- O estorno só ocorre se o administrador invalidar manualmente a indicação por fraude.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.processar_conversao_indicacao(p_indicado_tenant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ind RECORD;
  v_indicador RECORD;
  v_agora TIMESTAMP WITH TIME ZONE := NOW();
  v_mes_inicio DATE;
  v_conversoes_mes INT;
  v_indicador_data_base DATE;
  v_nova_data_indicador DATE;
  v_total_conversoes INT;
BEGIN
  -- Buscar indicação pendente para esta oficina indicada
  SELECT * INTO v_ind
  FROM public.indicacoes
  WHERE indicado_tenant_id = p_indicado_tenant_id AND status = 'pendente'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'mensagem', 'Nenhuma indicação pendente encontrada para esta oficina');
  END IF;

  -- Trava de Teto Mensal: Elevada de 10 para 50 conversões por mês por oficina indicadora
  v_mes_inicio := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
  SELECT count(*) INTO v_conversoes_mes
  FROM public.indicacoes
  WHERE indicador_tenant_id = v_ind.indicador_tenant_id
    AND convertida_em >= v_mes_inicio
    AND status = 'convertida';

  IF v_conversoes_mes >= 50 THEN
    RETURN jsonb_build_object('sucesso', false, 'mensagem', 'Limite mensal de 50 conversões atingido para o indicador');
  END IF;

  -- Atualizar status da indicação para 'convertida'
  UPDATE public.indicacoes
  SET status = 'convertida', convertida_em = v_agora
  WHERE id = v_ind.id;

  -- Obter data base atual do indicador (trial_fim ou proximo_vencimento)
  SELECT COALESCE(trial_fim, proximo_vencimento, (now() AT TIME ZONE 'America/Sao_Paulo')::date)
  INTO v_indicador_data_base
  FROM public.assinaturas WHERE tenant_id = v_ind.indicador_tenant_id;

  IF v_indicador_data_base IS NULL THEN
    v_indicador_data_base := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  END IF;

  -- Conceder +15 dias ao INDICADOR
  v_nova_data_indicador := v_indicador_data_base + 15;
  UPDATE public.assinaturas
  SET trial_fim = (CASE WHEN trial_fim IS NOT NULL THEN v_nova_data_indicador ELSE NULL END),
      proximo_vencimento = (CASE WHEN proximo_vencimento IS NOT NULL THEN v_nova_data_indicador ELSE NULL END)
  WHERE tenant_id = v_ind.indicador_tenant_id;

  INSERT INTO public.creditos_dias (tenant_id, dias, origem, referencia_id, observacao, aplicado_em, aplicado_a_data)
  VALUES (v_ind.indicador_tenant_id, 15, 'indicacao', p_indicado_tenant_id, 'Bônus de 15 dias por indicação convertida (assinatura confirmada)', v_agora, v_nova_data_indicador);

  -- Verificar Régua do Quadro de Metas do Indicador (5 -> +30d, 10 -> +60d, 15 -> +90d)
  SELECT count(*) INTO v_total_conversoes
  FROM public.indicacoes
  WHERE indicador_tenant_id = v_ind.indicador_tenant_id AND status = 'convertida';

  -- Faixa 5 indicações (+30d)
  IF v_total_conversoes >= 5 AND NOT EXISTS (SELECT 1 FROM public.quadro_metas_concedidas WHERE tenant_id = v_ind.indicador_tenant_id AND faixa = 5) THEN
    INSERT INTO public.quadro_metas_concedidas (tenant_id, faixa, dias_concedidos) VALUES (v_ind.indicador_tenant_id, 5, 30);
    v_nova_data_indicador := v_nova_data_indicador + 30;
    UPDATE public.assinaturas
    SET trial_fim = (CASE WHEN trial_fim IS NOT NULL THEN v_nova_data_indicador ELSE NULL END),
        proximo_vencimento = (CASE WHEN proximo_vencimento IS NOT NULL THEN v_nova_data_indicador ELSE NULL END)
    WHERE tenant_id = v_ind.indicador_tenant_id;

    INSERT INTO public.creditos_dias (tenant_id, dias, origem, referencia_id, observacao, aplicado_em, aplicado_a_data)
    VALUES (v_ind.indicador_tenant_id, 30, 'meta', p_indicado_tenant_id, 'Bônus de Meta: 5 indicações convertidas (+30 dias)', v_agora, v_nova_data_indicador);
  END IF;

  -- Faixa 10 indicações (+30d extras - totaliza +60d em metas)
  IF v_total_conversoes >= 10 AND NOT EXISTS (SELECT 1 FROM public.quadro_metas_concedidas WHERE tenant_id = v_ind.indicador_tenant_id AND faixa = 10) THEN
    INSERT INTO public.quadro_metas_concedidas (tenant_id, faixa, dias_concedidos) VALUES (v_ind.indicador_tenant_id, 10, 30);
    v_nova_data_indicador := v_nova_data_indicador + 30;
    UPDATE public.assinaturas
    SET trial_fim = (CASE WHEN trial_fim IS NOT NULL THEN v_nova_data_indicador ELSE NULL END),
        proximo_vencimento = (CASE WHEN proximo_vencimento IS NOT NULL THEN v_nova_data_indicador ELSE NULL END)
    WHERE tenant_id = v_ind.indicador_tenant_id;

    INSERT INTO public.creditos_dias (tenant_id, dias, origem, referencia_id, observacao, aplicado_em, aplicado_a_data)
    VALUES (v_ind.indicador_tenant_id, 30, 'meta', p_indicado_tenant_id, 'Bônus de Meta: 10 indicações convertidas (+30 dias extras)', v_agora, v_nova_data_indicador);
  END IF;

  -- Faixa 15 indicações (+30d extras - totaliza +90d em metas)
  IF v_total_conversoes >= 15 AND NOT EXISTS (SELECT 1 FROM public.quadro_metas_concedidas WHERE tenant_id = v_ind.indicador_tenant_id AND faixa = 15) THEN
    INSERT INTO public.quadro_metas_concedidas (tenant_id, faixa, dias_concedidos) VALUES (v_ind.indicador_tenant_id, 15, 30);
    v_nova_data_indicador := v_nova_data_indicador + 30;
    UPDATE public.assinaturas
    SET trial_fim = (CASE WHEN trial_fim IS NOT NULL THEN v_nova_data_indicador ELSE NULL END),
        proximo_vencimento = (CASE WHEN proximo_vencimento IS NOT NULL THEN v_nova_data_indicador ELSE NULL END)
    WHERE tenant_id = v_ind.indicador_tenant_id;

    INSERT INTO public.creditos_dias (tenant_id, dias, origem, referencia_id, observacao, aplicado_em, aplicado_a_data)
    VALUES (v_ind.indicador_tenant_id, 30, 'meta', p_indicado_tenant_id, 'Bônus de Meta: 15 indicações convertidas (+30 dias extras)', v_agora, v_nova_data_indicador);
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'conversao_id', v_ind.id);
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. CONECTAR CONVERSÃO AO REGISTRO DE PAGAMENTO MANUAL / COMPETÊNCIA
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_registrar_pagamento_manual_competencia(
  p_tenant_id UUID,
  p_competencia DATE,
  p_valor_pago_centavos INTEGER DEFAULT 6700
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  INSERT INTO public.pagamentos_competencia (tenant_id, competencia, valor_pago_centavos, confirmado_por)
  VALUES (p_tenant_id, date_trunc('month', p_competencia)::date, p_valor_pago_centavos, auth.uid())
  ON CONFLICT (tenant_id, competencia) 
  DO UPDATE SET valor_pago_centavos = EXCLUDED.valor_pago_centavos, confirmado_em = NOW(), confirmado_por = auth.uid();

  -- Atualizar status da assinatura para 'ativa' se estiver trial/atrasada
  UPDATE public.assinaturas
  SET status = 'ativa', 
      proximo_vencimento = (date_trunc('month', p_competencia) + INTERVAL '1 month' - INTERVAL '1 day')::date
  WHERE tenant_id = p_tenant_id;

  -- Processar conversão de indicação se houver indicação pendente
  PERFORM public.processar_conversao_indicacao(p_tenant_id);

  RETURN jsonb_build_object('sucesso', true);
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. RPC ADMIN PARA CONVERTER OU INVALIDAR MANUALMENTE
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_converter_indicacao_manual(p_indicacao_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ind RECORD;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem converter indicações manualmente';
  END IF;

  SELECT * INTO v_ind FROM public.indicacoes WHERE id = p_indicacao_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Indicação não encontrada';
  END IF;

  RETURN public.processar_conversao_indicacao(v_ind.indicado_tenant_id);
END;
$$;
