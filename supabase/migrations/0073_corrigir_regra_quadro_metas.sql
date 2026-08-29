-- ==============================================================================
-- MIGRAÇÃO 0073: CORRIGIR REGRA DE CONCESSÃO DO QUADRO DE METAS
-- Faixa 5:  +30 dias extras ao atingir 5 indicados ativos (Acumula +30d em metas)
-- Faixa 10: +30 dias extras ao atingir 10 indicados ativos (Acumula +60d em metas)
-- Faixa 15: +30 dias extras ao atingir 15 indicados ativos (Acumula +90d em metas)
-- ==============================================================================

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

  -- Trava de Teto Mensal: Elevada para 50 conversões por mês por oficina indicadora
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

  -- Conceder +15 dias padrão por indicação convertida ao INDICADOR
  v_nova_data_indicador := v_indicador_data_base + 15;
  UPDATE public.assinaturas
  SET trial_fim = (CASE WHEN trial_fim IS NOT NULL THEN v_nova_data_indicador ELSE NULL END),
      proximo_vencimento = (CASE WHEN proximo_vencimento IS NOT NULL THEN v_nova_data_indicador ELSE NULL END)
  WHERE tenant_id = v_ind.indicador_tenant_id;

  INSERT INTO public.creditos_dias (tenant_id, dias, origem, referencia_id, observacao, aplicado_em, aplicado_a_data)
  VALUES (v_ind.indicador_tenant_id, 15, 'indicacao', p_indicado_tenant_id, 'Bônus de 15 dias por indicação convertida (assinatura confirmada)', v_agora, v_nova_data_indicador);

  -- Verificar Régua do Quadro de Metas do Indicador (5 -> +30d, 10 -> +30d, 15 -> +30d)
  SELECT count(*) INTO v_total_conversoes
  FROM public.indicacoes
  WHERE indicador_tenant_id = v_ind.indicador_tenant_id AND status = 'convertida';

  -- Faixa 5 indicações (+30d extras)
  IF v_total_conversoes >= 5 AND NOT EXISTS (SELECT 1 FROM public.quadro_metas_concedidas WHERE tenant_id = v_ind.indicador_tenant_id AND faixa = 5) THEN
    INSERT INTO public.quadro_metas_concedidas (tenant_id, faixa, dias_concedidos) VALUES (v_ind.indicador_tenant_id, 5, 30);
    v_nova_data_indicador := v_nova_data_indicador + 30;
    UPDATE public.assinaturas
    SET trial_fim = (CASE WHEN trial_fim IS NOT NULL THEN v_nova_data_indicador ELSE NULL END),
        proximo_vencimento = (CASE WHEN proximo_vencimento IS NOT NULL THEN v_nova_data_indicador ELSE NULL END)
    WHERE tenant_id = v_ind.indicador_tenant_id;

    INSERT INTO public.creditos_dias (tenant_id, dias, origem, referencia_id, observacao, aplicado_em, aplicado_a_data)
    VALUES (v_ind.indicador_tenant_id, 30, 'meta', p_indicado_tenant_id, 'Bônus de Meta: 5 indicações convertidas (+30 dias extras)', v_agora, v_nova_data_indicador);
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
