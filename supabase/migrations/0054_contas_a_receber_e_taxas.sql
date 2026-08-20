-- Migration 0054: Módulo de Contas a Receber, Catálogo de Taxas e Finalização Unificada

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. Catálogo de Formas de Pagamento do Tenant
CREATE TABLE IF NOT EXISTS public.tenant_formas_pagamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('dinheiro', 'pix', 'debito', 'credito', 'fiado', 'outro')),
  permite_parcelar boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.tenant_formas_pagamento ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Membros do tenant podem visualizar formas de pagamento"
  ON public.tenant_formas_pagamento FOR SELECT
  USING (tenant_id IN (SELECT public.meus_tenants()));

CREATE POLICY "Dono e gerente podem gerenciar formas de pagamento"
  ON public.tenant_formas_pagamento FOR ALL
  USING (public.tem_papel(tenant_id, ARRAY['dono', 'gerente']::app_role[]));


-- 2. Tabela de Taxas por Faixa de Parcelas e Vigência (Imutável)
CREATE TABLE IF NOT EXISTS public.forma_pagamento_taxas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  forma_id uuid NOT NULL REFERENCES public.tenant_formas_pagamento(id) ON DELETE CASCADE,
  parcela_min integer NOT NULL DEFAULT 1 CHECK (parcela_min >= 1),
  parcela_max integer NOT NULL DEFAULT 1 CHECK (parcela_max >= parcela_min),
  taxa_percentual numeric(5,2) NOT NULL DEFAULT 0.00 CHECK (taxa_percentual >= 0),
  taxa_fixa numeric(10,2) NOT NULL DEFAULT 0.00 CHECK (taxa_fixa >= 0),
  vigencia_inicio date NOT NULL,
  vigencia_fim date NULL,
  criado_por uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.forma_pagamento_taxas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Apenas Dono e Gerente podem acessar e gerenciar taxas"
  ON public.forma_pagamento_taxas FOR ALL
  USING (public.tem_papel(tenant_id, ARRAY['dono', 'gerente']::app_role[]));

-- Trigger de Imutabilidade Estrita nas Taxas (Permite apenas atualizar vigencia_fim)
CREATE OR REPLACE FUNCTION public.trg_forma_pagamento_taxas_imutavel()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.taxa_percentual <> NEW.taxa_percentual OR
       OLD.taxa_fixa <> NEW.taxa_fixa OR
       OLD.vigencia_inicio <> NEW.vigencia_inicio OR
       OLD.forma_id <> NEW.forma_id OR
       OLD.parcela_min <> NEW.parcela_min OR
       OLD.parcela_max <> NEW.parcela_max THEN
      RAISE EXCEPTION 'Alteração rejeitada: Taxas de pagamento são imutáveis. Encerre a vigência preenchendo vigencia_fim e crie um novo registro.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_forma_pagamento_taxas_imutavel ON public.forma_pagamento_taxas;
CREATE TRIGGER trg_forma_pagamento_taxas_imutavel
  BEFORE UPDATE ON public.forma_pagamento_taxas
  FOR EACH ROW EXECUTE FUNCTION public.trg_forma_pagamento_taxas_imutavel();

-- Trigger contra faixas e vigências sobrepostas
CREATE OR REPLACE FUNCTION public.trg_validar_faixa_taxa_sobreposta()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.forma_pagamento_taxas
    WHERE forma_id = NEW.forma_id
      AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND (NEW.parcela_min <= parcela_max AND NEW.parcela_max >= parcela_min)
      AND (NEW.vigencia_inicio <= COALESCE(vigencia_fim, '9999-12-31'::date) 
           AND COALESCE(NEW.vigencia_fim, '9999-12-31'::date) >= vigencia_inicio)
  ) THEN
    RAISE EXCEPTION 'Conflito: Já existe uma taxa cadastrada para esta forma de pagamento com faixa de parcelas e vigência sobreposta.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_faixa_taxa_sobreposta ON public.forma_pagamento_taxas;
CREATE TRIGGER trg_validar_faixa_taxa_sobreposta
  BEFORE INSERT OR UPDATE ON public.forma_pagamento_taxas
  FOR EACH ROW EXECUTE FUNCTION public.trg_validar_faixa_taxa_sobreposta();


-- 3. Tabela de Recebimentos (Contas a Receber)
CREATE TABLE IF NOT EXISTS public.recebimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  execucao_id uuid REFERENCES public.execucoes(id) ON DELETE SET NULL,
  agendamento_id uuid REFERENCES public.agendamentos(id) ON DELETE SET NULL,
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  forma_id uuid REFERENCES public.tenant_formas_pagamento(id),
  numero_parcela integer NOT NULL DEFAULT 1 CHECK (numero_parcela >= 1),
  total_parcelas integer NOT NULL DEFAULT 1 CHECK (total_parcelas >= numero_parcela),
  valor_bruto numeric(10,2) NOT NULL CHECK (valor_bruto > 0),
  taxa_percentual_snapshot numeric(5,2) NOT NULL DEFAULT 0.00,
  taxa_fixa_snapshot numeric(10,2) NOT NULL DEFAULT 0.00,
  valor_taxa numeric(10,2) NOT NULL DEFAULT 0.00,
  valor_liquido numeric(10,2) NOT NULL DEFAULT 0.00,
  previsto_para date NOT NULL,
  recebido_em timestamptz NULL,
  status text NOT NULL DEFAULT 'previsto' CHECK (status IN ('previsto', 'recebido', 'cancelado')),
  origem text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'sinal_agendamento')),
  observacao text NULL,
  criado_por uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

-- Trava de idempotência do sinal ajustada
CREATE UNIQUE INDEX IF NOT EXISTS uq_recebimentos_sinal_agendamento
  ON public.recebimentos(agendamento_id) 
  WHERE origem = 'sinal_agendamento' AND agendamento_id IS NOT NULL;

ALTER TABLE public.recebimentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Apenas Dono e Gerente podem acessar e gerenciar recebimentos"
  ON public.recebimentos FOR ALL
  USING (public.tem_papel(tenant_id, ARRAY['dono', 'gerente']::app_role[]));


-- 4. Coluna custo_taxas na tabela public.execucoes
ALTER TABLE public.execucoes ADD COLUMN IF NOT EXISTS custo_taxas numeric(10,2) NOT NULL DEFAULT 0.00;


-- 5. Semeador de Formas de Pagamento Padrão por Tenant
CREATE OR REPLACE FUNCTION public.seed_formas_pagamento_tenant(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dinheiro_id uuid;
  v_pix_id uuid;
  v_debito_id uuid;
  v_credito_id uuid;
  v_fiado_id uuid;
BEGIN
  -- Dinheiro
  INSERT INTO public.tenant_formas_pagamento (tenant_id, nome, tipo, permite_parcelar, ordem)
  VALUES (p_tenant_id, 'Dinheiro', 'dinheiro', false, 1)
  ON CONFLICT DO NOTHING RETURNING id INTO v_dinheiro_id;

  IF v_dinheiro_id IS NOT NULL THEN
    INSERT INTO public.forma_pagamento_taxas (tenant_id, forma_id, parcela_min, parcela_max, taxa_percentual, taxa_fixa, vigencia_inicio)
    VALUES (p_tenant_id, v_dinheiro_id, 1, 1, 0.00, 0.00, current_date);
  END IF;

  -- Pix
  INSERT INTO public.tenant_formas_pagamento (tenant_id, nome, tipo, permite_parcelar, ordem)
  VALUES (p_tenant_id, 'Pix', 'pix', false, 2)
  ON CONFLICT DO NOTHING RETURNING id INTO v_pix_id;

  IF v_pix_id IS NOT NULL THEN
    INSERT INTO public.forma_pagamento_taxas (tenant_id, forma_id, parcela_min, parcela_max, taxa_percentual, taxa_fixa, vigencia_inicio)
    VALUES (p_tenant_id, v_pix_id, 1, 1, 0.00, 0.00, current_date);
  END IF;

  -- Cartão de Débito
  INSERT INTO public.tenant_formas_pagamento (tenant_id, nome, tipo, permite_parcelar, ordem)
  VALUES (p_tenant_id, 'Cartão de Débito', 'debito', false, 3)
  ON CONFLICT DO NOTHING RETURNING id INTO v_debito_id;

  IF v_debito_id IS NOT NULL THEN
    INSERT INTO public.forma_pagamento_taxas (tenant_id, forma_id, parcela_min, parcela_max, taxa_percentual, taxa_fixa, vigencia_inicio)
    VALUES (p_tenant_id, v_debito_id, 1, 1, 0.00, 0.00, current_date);
  END IF;

  -- Cartão de Crédito
  INSERT INTO public.tenant_formas_pagamento (tenant_id, nome, tipo, permite_parcelar, ordem)
  VALUES (p_tenant_id, 'Cartão de Crédito', 'credito', true, 4)
  ON CONFLICT DO NOTHING RETURNING id INTO v_credito_id;

  IF v_credito_id IS NOT NULL THEN
    -- Faixa 1x (à vista)
    INSERT INTO public.forma_pagamento_taxas (tenant_id, forma_id, parcela_min, parcela_max, taxa_percentual, taxa_fixa, vigencia_inicio)
    VALUES (p_tenant_id, v_credito_id, 1, 1, 0.00, 0.00, current_date);
    -- Faixa 2x a 6x
    INSERT INTO public.forma_pagamento_taxas (tenant_id, forma_id, parcela_min, parcela_max, taxa_percentual, taxa_fixa, vigencia_inicio)
    VALUES (p_tenant_id, v_credito_id, 2, 6, 0.00, 0.00, current_date);
    -- Faixa 7x a 12x
    INSERT INTO public.forma_pagamento_taxas (tenant_id, forma_id, parcela_min, parcela_max, taxa_percentual, taxa_fixa, vigencia_inicio)
    VALUES (p_tenant_id, v_credito_id, 7, 12, 0.00, 0.00, current_date);
  END IF;

  -- Fiado / Nota Promissória
  INSERT INTO public.tenant_formas_pagamento (tenant_id, nome, tipo, permite_parcelar, ordem)
  VALUES (p_tenant_id, 'Fiado / A Prazo', 'fiado', true, 5)
  ON CONFLICT DO NOTHING RETURNING id INTO v_fiado_id;

  IF v_fiado_id IS NOT NULL THEN
    INSERT INTO public.forma_pagamento_taxas (tenant_id, forma_id, parcela_min, parcela_max, taxa_percentual, taxa_fixa, vigencia_inicio)
    VALUES (p_tenant_id, v_fiado_id, 1, 12, 0.00, 0.00, current_date);
  END IF;
END;
$$;

-- Executa o backfill do catálogo para todos os tenants cadastrados
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.tenants LOOP
    PERFORM public.seed_formas_pagamento_tenant(r.id);
  END LOOP;
END;
$$;


-- 6. Trigger para gerar recebimento automático quando o Sinal for Pago
CREATE OR REPLACE FUNCTION public.trg_processar_sinal_agendamento()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pix_id uuid;
BEGIN
  IF (NEW.sinal_status = 'pago' AND (OLD.sinal_status IS NULL OR OLD.sinal_status <> 'pago')) AND COALESCE(NEW.sinal_valor, 0) > 0 THEN
    SELECT id INTO v_pix_id FROM public.tenant_formas_pagamento
    WHERE tenant_id = NEW.tenant_id AND tipo = 'pix' AND ativo = true LIMIT 1;

    INSERT INTO public.recebimentos (
      tenant_id, agendamento_id, cliente_id, forma_id,
      numero_parcela, total_parcelas, valor_bruto,
      taxa_percentual_snapshot, taxa_fixa_snapshot, valor_taxa, valor_liquido,
      previsto_para, recebido_em, status, origem, observacao
    ) VALUES (
      NEW.tenant_id, NEW.id, NEW.cliente_id, v_pix_id,
      1, 1, NEW.sinal_valor,
      0.00, 0.00, 0.00, NEW.sinal_valor,
      (NEW.inicio AT TIME ZONE 'America/Sao_Paulo')::date,
      COALESCE(NEW.sinal_pago_em, now()),
      'recebido', 'sinal_agendamento', 'Sinal de agendamento pago via Pix'
    )
    ON CONFLICT (agendamento_id) WHERE origem = 'sinal_agendamento' AND agendamento_id IS NOT NULL DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_processar_sinal_agendamento ON public.agendamentos;
CREATE TRIGGER trg_processar_sinal_agendamento
  AFTER INSERT OR UPDATE ON public.agendamentos
  FOR EACH ROW EXECUTE FUNCTION public.trg_processar_sinal_agendamento();


-- 7. Redefinição da RPC fechar_resultado_execucao (Consolidação da Cascata Financeira)
CREATE OR REPLACE FUNCTION public.fechar_resultado_execucao(
  p_execucao uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_exec record;
  v_tempo_efetivo integer := 0;
  v_custo_hora numeric(10,2) := 0;
  v_custo_estrutura numeric(10,2) := 0;
  v_faturamento numeric(10,2) := 0;
  v_custo_produtos numeric(10,2) := 0;
  v_custo_comissao numeric(10,2) := 0;
  v_custo_taxas numeric(10,2) := 0;
  v_lucro_bruto numeric(10,2) := 0;
  v_lucro_liquido numeric(10,2) := 0;
  v_data_ref date;
BEGIN
  SELECT e.id, e.tenant_id, e.agendamento_id, e.valor_total_final, e.tempo_efetivo_minutos,
         e.segundos_trabalhados, e.iniciado_em, e.finalizado_em
  INTO v_exec
  FROM public.execucoes e
  WHERE e.id = p_execucao;

  IF v_exec.id IS NULL THEN RETURN; END IF;

  v_tempo_efetivo := COALESCE(NULLIF(v_exec.tempo_efetivo_minutos, 0), CEIL(COALESCE(v_exec.segundos_trabalhados, 0)::numeric / 60.0)::integer);
  IF v_tempo_efetivo IS NULL OR v_tempo_efetivo <= 0 THEN
    SELECT COALESCE(a.duracao_total, a.duracao_minutos, 60) INTO v_tempo_efetivo
    FROM public.agendamentos a WHERE a.id = v_exec.agendamento_id;
  END IF;
  IF v_tempo_efetivo IS NULL OR v_tempo_efetivo <= 0 THEN v_tempo_efetivo := 60; END IF;

  v_data_ref := date_trunc('month', COALESCE(v_exec.finalizado_em, now()))::date;
  v_custo_hora := public.custo_hora_operacao(v_exec.tenant_id, v_data_ref);
  v_custo_estrutura := round((v_custo_hora * (v_tempo_efetivo::numeric / 60.0)), 2);
  v_faturamento := COALESCE(v_exec.valor_total_final, 0.00);

  SELECT COALESCE(SUM(ec.custo_total), 0.00) INTO v_custo_produtos
  FROM public.execucao_consumos ec WHERE ec.execucao_id = p_execucao;

  SELECT COALESCE(SUM(ee.comissao_calculada), 0.00) INTO v_custo_comissao
  FROM public.execucao_executores ee WHERE ee.execucao_id = p_execucao;

  -- Soma das taxas de TODOS os recebimentos vinculados a esta execução (não cancelados)
  SELECT COALESCE(SUM(r.valor_taxa), 0.00) INTO v_custo_taxas
  FROM public.recebimentos r
  WHERE r.execucao_id = p_execucao AND r.status <> 'cancelado';

  v_lucro_bruto := v_faturamento - (v_custo_produtos + v_custo_comissao + v_custo_taxas);
  v_lucro_liquido := v_lucro_bruto - v_custo_estrutura;

  UPDATE public.execucoes
  SET tempo_efetivo_minutos = v_tempo_efetivo,
      custo_hora_aplicado = v_custo_hora,
      custo_estrutura = v_custo_estrutura,
      custo_produtos = v_custo_produtos,
      custo_comissao = v_custo_comissao,
      custo_taxas = v_custo_taxas,
      lucro_bruto = v_lucro_bruto,
      lucro_liquido = v_lucro_liquido,
      updated_at = now()
  WHERE id = p_execucao;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fechar_resultado_execucao(uuid) TO authenticated;


-- 8. RPC Única de Finalização com Pagamentos (Transação Atômica)
CREATE OR REPLACE FUNCTION public.finalizar_execucao_com_pagamentos(
  p_execucao uuid,
  p_pagamentos jsonb DEFAULT '[]'::jsonb,
  p_valores jsonb DEFAULT '[]'::jsonb,
  p_consumos jsonb DEFAULT '[]'::jsonb,
  p_observacoes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid;
  v_exec record;
  v_item jsonb;
  v_forma_id uuid;
  v_total_parcelas integer;
  v_numero_parcela integer;
  v_valor_bruto numeric(10,2);
  v_previsto_para date;
  v_obs text;
  v_taxa_perc numeric(5,2) := 0.00;
  v_taxa_fixa numeric(10,2) := 0.00;
  v_valor_taxa numeric(10,2) := 0.00;
  v_valor_liquido numeric(10,2) := 0.00;
  v_status text;
  v_recebido_em timestamptz;
  v_soma_pagamentos numeric(10,2) := 0.00;
  v_sinal_pago numeric(10,2) := 0.00;
  v_saldo_restante numeric(10,2);
  v_forma_tipo text;
  v_faturamento_total numeric(10,2);
BEGIN
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

  -- 1. Executa a conclusão operacional do checklist e consumo de produtos
  PERFORM public.concluir_atendimento(p_execucao, p_valores, p_consumos, p_observacoes);

  -- Recarrega valor total final pós conclusão
  SELECT valor_total_final INTO v_faturamento_total FROM public.execucoes WHERE id = p_execucao;

  -- Verifica se houve sinal pago para este agendamento
  SELECT COALESCE(SUM(valor_bruto), 0.00) INTO v_sinal_pago
  FROM public.recebimentos
  WHERE agendamento_id = v_exec.agendamento_id AND origem = 'sinal_agendamento' AND status = 'recebido';

  v_saldo_restante := COALESCE(v_faturamento_total, 0.00) - v_sinal_pago;

  -- 2. Processa os lançamentos de pagamento informados
  IF p_pagamentos IS NOT NULL AND jsonb_array_length(p_pagamentos) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_pagamentos) LOOP
      v_forma_id := (v_item->>'forma_id')::uuid;
      v_total_parcelas := COALESCE((v_item->>'total_parcelas')::integer, 1);
      v_numero_parcela := COALESCE((v_item->>'numero_parcela')::integer, 1);
      v_valor_bruto := (v_item->>'valor_bruto')::numeric(10,2);
      v_previsto_para := COALESCE((v_item->>'previsto_para')::date, current_date);
      v_obs := v_item->>'observacao';

      v_soma_pagamentos := v_soma_pagamentos + v_valor_bruto;

      -- Consulta tipo da forma de pagamento e calcula taxa server-side
      SELECT tipo INTO v_forma_tipo FROM public.tenant_formas_pagamento WHERE id = v_forma_id AND tenant_id = v_tenant;

      SELECT taxa_percentual, taxa_fixa INTO v_taxa_perc, v_taxa_fixa
      FROM public.forma_pagamento_taxas
      WHERE forma_id = v_forma_id
        AND v_total_parcelas BETWEEN parcela_min AND parcela_max
        AND vigencia_inicio <= current_date
        AND (vigencia_fim IS NULL OR vigencia_fim >= current_date)
      LIMIT 1;

      v_taxa_perc := COALESCE(v_taxa_perc, 0.00);
      v_taxa_fixa := COALESCE(v_taxa_fixa, 0.00);

      v_valor_taxa := round(v_valor_bruto * (v_taxa_perc / 100.0) + (v_taxa_fixa / v_total_parcelas::numeric), 2);
      v_valor_liquido := v_valor_bruto - v_valor_taxa;

      -- Pagamentos em dinheiro/pix/débito já entram como 'recebido' no momento se vencimento for hoje
      IF v_forma_tipo IN ('dinheiro', 'pix', 'debito') AND v_previsto_para <= current_date THEN
        v_status := 'recebido';
        v_recebido_em := now();
      ELSE
        v_status := 'previsto';
        v_recebido_em := NULL;
      END IF;

      INSERT INTO public.recebimentos (
        tenant_id, execucao_id, agendamento_id, cliente_id, forma_id,
        numero_parcela, total_parcelas, valor_bruto,
        taxa_percentual_snapshot, taxa_fixa_snapshot, valor_taxa, valor_liquido,
        previsto_para, recebido_em, status, origem, observacao, criado_por
      ) VALUES (
        v_tenant, p_execucao, v_exec.agendamento_id, v_exec.cliente_id, v_forma_id,
        v_numero_parcela, v_total_parcelas, v_valor_bruto,
        v_taxa_perc, v_taxa_fixa, v_valor_taxa, v_valor_liquido,
        v_previsto_para, v_recebido_em, v_status, 'manual', v_obs, auth.uid()
      );
    END LOOP;

    -- Valida se a soma dos pagamentos fecha exatamente com o saldo restante
    IF round(v_soma_pagamentos, 2) <> round(v_saldo_restante, 2) THEN
      RAISE EXCEPTION 'A soma dos pagamentos lançados (R$ %) difere do valor restante a receber (R$ %).', v_soma_pagamentos, v_saldo_restante;
    END IF;
  END IF;

  -- 3. Recalcula o resultado financeiro consolidado da execução na mesma transação
  PERFORM public.fechar_resultado_execucao(p_execucao);
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalizar_execucao_com_pagamentos(uuid, jsonb, jsonb, jsonb, text) TO authenticated;


-- 9. RPC dar_baixa_recebimento (Trava contra re-baixa e validação de tenant)
CREATE OR REPLACE FUNCTION public.dar_baixa_recebimento(
  p_recebimento_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rec record;
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

  UPDATE public.recebimentos
  SET status = 'recebido',
      recebido_em = now()
  WHERE id = p_recebimento_id;

  -- Recalcula o resultado da execução se estiver vinculada
  IF v_rec.execucao_id IS NOT NULL THEN
    PERFORM public.fechar_resultado_execucao(v_rec.execucao_id);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dar_baixa_recebimento(uuid) TO authenticated;


-- 10. RPC obter_contas_a_receber (Consulta para Tela de Cobrança)
CREATE OR REPLACE FUNCTION public.obter_contas_a_receber(
  p_inicio date DEFAULT NULL,
  p_fim date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid;
  v_a_receber_mes numeric(10,2) := 0.00;
  v_vencido numeric(10,2) := 0.00;
  v_recebido_mes numeric(10,2) := 0.00;
  v_itens jsonb;
BEGIN
  v_tenant := (SELECT public.meus_tenants() LIMIT 1);
  IF v_tenant IS NULL OR NOT public.tem_papel(v_tenant, ARRAY['dono', 'gerente']::app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado. Apenas dono e gerente podem consultar contas a receber.';
  END IF;

  -- Totais do mês corrente
  SELECT COALESCE(SUM(valor_bruto), 0.00) INTO v_a_receber_mes
  FROM public.recebimentos
  WHERE tenant_id = v_tenant AND status = 'previsto' AND date_trunc('month', previsto_para) = date_trunc('month', current_date);

  SELECT COALESCE(SUM(valor_bruto), 0.00) INTO v_vencido
  FROM public.recebimentos
  WHERE tenant_id = v_tenant AND status = 'previsto' AND previsto_para < current_date;

  SELECT COALESCE(SUM(valor_bruto), 0.00) INTO v_recebido_mes
  FROM public.recebimentos
  WHERE tenant_id = v_tenant AND status = 'recebido' AND date_trunc('month', recebido_em) = date_trunc('month', current_date);

  -- Lista detalhada das parcelas previstas
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'cliente_id', r.cliente_id,
      'cliente_nome', c.nome,
      'cliente_telefone', c.telefone,
      'forma_nome', fp.nome,
      'forma_tipo', fp.tipo,
      'numero_parcela', r.numero_parcela,
      'total_parcelas', r.total_parcelas,
      'valor_bruto', r.valor_bruto,
      'valor_liquido', r.valor_liquido,
      'previsto_para', r.previsto_para,
      'dias_atraso', GREATEST(0, (current_date - r.previsto_para)),
      'status', r.status,
      'observacao', r.observacao
    ) ORDER BY r.previsto_para ASC
  ), '[]'::jsonb) INTO v_itens
  FROM public.recebimentos r
  JOIN public.clientes c ON c.id = r.cliente_id
  LEFT JOIN public.tenant_formas_pagamento fp ON fp.id = r.forma_id
  WHERE r.tenant_id = v_tenant AND r.status = 'previsto'
    AND (p_inicio IS NULL OR r.previsto_para >= p_inicio)
    AND (p_fim IS NULL OR r.previsto_para <= p_fim);

  RETURN jsonb_build_object(
    'a_receber_mes', v_a_receber_mes,
    'vencido_total', v_vencido,
    'recebido_mes', v_recebido_mes,
    'itens', v_itens
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_contas_a_receber(date, date) TO authenticated;


-- 11. RPC obter_saldo_devedor_cliente (Histórico e Saldo na Ficha do Cliente)
CREATE OR REPLACE FUNCTION public.obter_saldo_devedor_cliente(
  p_cliente_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid;
  v_saldo_devedor numeric(10,2) := 0.00;
  v_historico jsonb;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.clientes WHERE id = p_cliente_id;
  IF v_tenant IS NULL OR NOT (v_tenant IN (SELECT public.meus_tenants())) OR NOT public.tem_papel(v_tenant, ARRAY['dono', 'gerente']::app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  SELECT COALESCE(SUM(valor_bruto), 0.00) INTO v_saldo_devedor
  FROM public.recebimentos
  WHERE tenant_id = v_tenant AND cliente_id = p_cliente_id AND status = 'previsto';

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'forma_nome', fp.nome,
      'numero_parcela', r.numero_parcela,
      'total_parcelas', r.total_parcelas,
      'valor_bruto', r.valor_bruto,
      'valor_liquido', r.valor_liquido,
      'previsto_para', r.previsto_para,
      'recebido_em', r.recebido_em,
      'status', r.status,
      'origem', r.origem
    ) ORDER BY r.created_at DESC
  ), '[]'::jsonb) INTO v_historico
  FROM public.recebimentos r
  LEFT JOIN public.tenant_formas_pagamento fp ON fp.id = r.forma_id
  WHERE r.tenant_id = v_tenant AND r.cliente_id = p_cliente_id;

  RETURN jsonb_build_object(
    'saldo_devedor', v_saldo_devedor,
    'historico', v_historico
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_saldo_devedor_cliente(uuid) TO authenticated;
