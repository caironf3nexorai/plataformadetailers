-- Migration 0105: Baixa Flexível em Contas a Receber com Ajuste na Próxima Parcela
-- Permite receber valor parcial (jogando a falta para a próxima parcela) ou excedente (abatendo da próxima)

CREATE OR REPLACE FUNCTION public.dar_baixa_recebimento(
  p_recebimento_id uuid,
  p_valor_pago numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rec record;
  v_valor_final numeric(10,2);
  v_dif numeric(10,2);
  v_prox record;
  v_msg text;
  v_falta numeric(10,2);
BEGIN
  SELECT * INTO v_rec FROM public.recebimentos WHERE id = p_recebimento_id;

  IF v_rec.id IS NULL THEN
    RAISE EXCEPTION 'Recebimento não encontrado.';
  END IF;

  IF NOT (v_rec.tenant_id IN (SELECT public.meus_tenants())) OR NOT public.tem_papel(v_rec.tenant_id, ARRAY['dono', 'gerente']::app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado. Apenas dono e gerente podem dar baixa em recebimentos.';
  END IF;

  IF v_rec.status <> 'previsto' THEN
    RAISE EXCEPTION 'Operação rejeitada: Este recebimento já se encontra com status % e não pode ser re-baixado.', v_rec.status;
  END IF;

  v_valor_final := COALESCE(p_valor_pago, v_rec.valor_bruto);
  IF v_valor_final <= 0 THEN
    RAISE EXCEPTION 'O valor recebido deve ser maior que zero.';
  END IF;

  v_dif := round(v_valor_final - v_rec.valor_bruto, 2);

  -- 1. Valor Exato: baixa simples
  IF v_dif = 0 THEN
    UPDATE public.recebimentos
    SET status = 'recebido',
        recebido_em = now()
    WHERE id = p_recebimento_id;
    v_msg := 'Baixa confirmada com sucesso pelo valor integral.';

  -- 2. Valor A MAIS: quita parcela atual e abate o excedente da próxima
  ELSIF v_dif > 0 THEN
    UPDATE public.recebimentos
    SET valor_bruto = v_valor_final,
        valor_liquido = GREATEST(0.00, v_valor_final - valor_taxa),
        status = 'recebido',
        recebido_em = now(),
        observacao = TRIM(COALESCE(observacao, '') || ' • Recebido R$ ' || v_valor_final || ' (+ R$ ' || v_dif || ' abatido da próxima parcela)')
    WHERE id = p_recebimento_id;

    -- Localiza próxima parcela prevista vinculada à mesma execução
    SELECT * INTO v_prox FROM public.recebimentos
    WHERE execucao_id = v_rec.execucao_id
      AND status = 'previsto'
      AND id <> p_recebimento_id
    ORDER BY numero_parcela ASC, previsto_para ASC
    LIMIT 1;

    IF v_prox.id IS NOT NULL THEN
      IF v_prox.valor_bruto > v_dif THEN
        UPDATE public.recebimentos
        SET valor_bruto = round(valor_bruto - v_dif, 2),
            valor_liquido = round(GREATEST(0.00, valor_liquido - v_dif), 2),
            observacao = TRIM(COALESCE(observacao, '') || ' • Abatido R$ ' || v_dif || ' pago antecipadamente na parcela ' || v_rec.numero_parcela)
        WHERE id = v_prox.id;
        v_msg := 'Baixa de R$ ' || v_valor_final || ' confirmada. O excedente de R$ ' || v_dif || ' foi abatido da parcela ' || v_prox.numero_parcela || '.';
      ELSE
        -- Excedente cobre a parcela seguinte por completo
        UPDATE public.recebimentos
        SET status = 'recebido',
            recebido_em = now(),
            observacao = TRIM(COALESCE(observacao, '') || ' • Quitado integralmente com excedente da parcela ' || v_rec.numero_parcela)
        WHERE id = v_prox.id;
        v_msg := 'Baixa de R$ ' || v_valor_final || ' confirmada. A parcela ' || v_prox.numero_parcela || ' foi quitada integralmente!';
      END IF;
    ELSE
      v_msg := 'Baixa de R$ ' || v_valor_final || ' confirmada no caixa.';
    END IF;

  -- 3. Valor A MENOS: quita o que foi pago e transfere a falta para a próxima parcela
  ELSE
    v_falta := ABS(v_dif);

    UPDATE public.recebimentos
    SET valor_bruto = v_valor_final,
        valor_liquido = GREATEST(0.00, v_valor_final - valor_taxa),
        status = 'recebido',
        recebido_em = now(),
        observacao = TRIM(COALESCE(observacao, '') || ' • Pago parcial de R$ ' || v_valor_final || ' (restante R$ ' || v_falta || ' transferido)')
    WHERE id = p_recebimento_id;

    -- Localiza próxima parcela prevista
    SELECT * INTO v_prox FROM public.recebimentos
    WHERE execucao_id = v_rec.execucao_id
      AND status = 'previsto'
      AND id <> p_recebimento_id
    ORDER BY numero_parcela ASC, previsto_para ASC
    LIMIT 1;

    IF v_prox.id IS NOT NULL THEN
      UPDATE public.recebimentos
      SET valor_bruto = round(valor_bruto + v_falta, 2),
          valor_liquido = round(valor_liquido + v_falta, 2),
          observacao = TRIM(COALESCE(observacao, '') || ' • Somado R$ ' || v_falta || ' restante da parcela ' || v_rec.numero_parcela)
      WHERE id = v_prox.id;
      v_msg := 'Baixa parcial de R$ ' || v_valor_final || ' registrada. O saldo de R$ ' || v_falta || ' foi transferido para a parcela ' || v_prox.numero_parcela || '.';
    ELSE
      -- Gera parcela residual para 30 dias se for a última parcela
      INSERT INTO public.recebimentos (
        tenant_id, execucao_id, agendamento_id, cliente_id, forma_id,
        numero_parcela, total_parcelas, valor_bruto,
        valor_liquido, previsto_para, status, origem, observacao, criado_por
      ) VALUES (
        v_rec.tenant_id, v_rec.execucao_id, v_rec.agendamento_id, v_rec.cliente_id, v_rec.forma_id,
        v_rec.total_parcelas + 1, v_rec.total_parcelas + 1, v_falta,
        v_falta, (v_rec.previsto_para + INTERVAL '30 days')::date, 'previsto', 'manual',
        'Saldo residual da parcela ' || v_rec.numero_parcela, auth.uid()
      );
      v_msg := 'Baixa parcial de R$ ' || v_valor_final || ' registrada. Como era a última parcela, foi gerada uma parcela residual de R$ ' || v_falta || ' para o mês seguinte.';
    END IF;
  END IF;

  -- Recalcula o resultado financeiro da execução se estiver vinculada
  IF v_rec.execucao_id IS NOT NULL THEN
    PERFORM public.fechar_resultado_execucao(v_rec.execucao_id);
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'mensagem', v_msg);
END;
$$;

GRANT EXECUTE ON FUNCTION public.dar_baixa_recebimento(uuid, numeric) TO authenticated;
