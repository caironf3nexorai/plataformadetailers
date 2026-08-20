-- Migration 0055: Taxas de cartão por maquininha, bandeira e parcela exata, mais desconto na finalização

-- 1. TABELA TENANT_MAQUININHAS
CREATE TABLE IF NOT EXISTS public.tenant_maquininhas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  padrao boolean NOT NULL DEFAULT false,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_maquininha_padrao 
  ON public.tenant_maquininhas(tenant_id) WHERE padrao = true;

ALTER TABLE public.tenant_maquininhas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Membros do tenant podem visualizar maquininhas" ON public.tenant_maquininhas;
CREATE POLICY "Membros do tenant podem visualizar maquininhas"
  ON public.tenant_maquininhas FOR SELECT
  USING (tenant_id IN (SELECT public.meus_tenants()));

DROP POLICY IF EXISTS "Dono e gerente podem gerenciar maquininhas" ON public.tenant_maquininhas;
CREATE POLICY "Dono e gerente podem gerenciar maquininhas"
  ON public.tenant_maquininhas FOR ALL
  USING (public.tem_papel(tenant_id, ARRAY['dono', 'gerente']::app_role[]));


-- 2. TABELA BANDEIRAS (Catálogo Global Universal)
CREATE TABLE IF NOT EXISTS public.bandeiras (
  codigo text PRIMARY KEY,
  nome text NOT NULL,
  ordem integer NOT NULL DEFAULT 0
);

ALTER TABLE public.bandeiras ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Todos autenticados podem visualizar bandeiras" ON public.bandeiras;
CREATE POLICY "Todos autenticados podem visualizar bandeiras"
  ON public.bandeiras FOR SELECT
  TO authenticated
  USING (true);

-- Seeding do catálogo universal de bandeiras
INSERT INTO public.bandeiras (codigo, nome, ordem) VALUES
  ('visa', 'Visa', 1),
  ('mastercard', 'Mastercard', 2),
  ('elo', 'Elo', 3),
  ('amex', 'American Express', 4),
  ('hipercard', 'Hipercard', 5)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, ordem = EXCLUDED.ordem;


-- 3. TABELA TAXAS_CARTAO (Substitui forma_pagamento_taxas)
CREATE TABLE IF NOT EXISTS public.taxas_cartao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  maquininha_id uuid NOT NULL REFERENCES public.tenant_maquininhas(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('debito', 'credito')),
  bandeira_codigo text NULL REFERENCES public.bandeiras(codigo) ON DELETE SET NULL,
  parcelas integer NOT NULL CHECK (parcelas BETWEEN 1 AND 24),
  taxa_percentual numeric(5,2) NOT NULL CHECK (taxa_percentual >= 0),
  taxa_fixa numeric(10,2) NOT NULL DEFAULT 0.00 CHECK (taxa_fixa >= 0),
  vigencia_inicio date NOT NULL,
  vigencia_fim date NULL,
  criado_por uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.taxas_cartao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Apenas Dono e Gerente podem acessar e gerenciar taxas_cartao" ON public.taxas_cartao;
CREATE POLICY "Apenas Dono e Gerente podem acessar e gerenciar taxas_cartao"
  ON public.taxas_cartao FOR ALL
  USING (public.tem_papel(tenant_id, ARRAY['dono', 'gerente']::app_role[]));

-- Trigger de imutabilidade estrita nas taxas_cartao
CREATE OR REPLACE FUNCTION public.trg_taxas_cartao_imutavel()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.taxa_percentual <> NEW.taxa_percentual OR
       OLD.taxa_fixa <> NEW.taxa_fixa OR
       OLD.vigencia_inicio <> NEW.vigencia_inicio OR
       OLD.maquininha_id <> NEW.maquininha_id OR
       OLD.tipo <> NEW.tipo OR
       OLD.bandeira_codigo IS DISTINCT FROM NEW.bandeira_codigo OR
       OLD.parcelas <> NEW.parcelas THEN
      RAISE EXCEPTION 'Alteração rejeitada: Taxas de cartão são imutáveis. Encerre a vigência preenchendo vigencia_fim e crie um novo registro.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_taxas_cartao_imutavel ON public.taxas_cartao;
CREATE TRIGGER trg_taxas_cartao_imutavel
  BEFORE UPDATE ON public.taxas_cartao
  FOR EACH ROW EXECUTE FUNCTION public.trg_taxas_cartao_imutavel();

-- Trigger para validar vigências sobrepostas por maquininha, tipo, bandeira e parcela
CREATE OR REPLACE FUNCTION public.trg_validar_taxa_cartao_sobreposta()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.taxas_cartao
    WHERE maquininha_id = NEW.maquininha_id
      AND tipo = NEW.tipo
      AND bandeira_codigo IS NOT DISTINCT FROM NEW.bandeira_codigo
      AND parcelas = NEW.parcelas
      AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND (NEW.vigencia_inicio <= COALESCE(vigencia_fim, '9999-12-31'::date) 
           AND COALESCE(NEW.vigencia_fim, '9999-12-31'::date) >= vigencia_inicio)
  ) THEN
    RAISE EXCEPTION 'Conflito: Já existe uma taxa cadastrada para esta maquininha, bandeira, parcela e vigência sobreposta.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_taxa_cartao_sobreposta ON public.taxas_cartao;
CREATE TRIGGER trg_validar_taxa_cartao_sobreposta
  BEFORE INSERT OR UPDATE ON public.taxas_cartao
  FOR EACH ROW EXECUTE FUNCTION public.trg_validar_taxa_cartao_sobreposta();


-- 4. MIGRAÇÃO DE FORMA_PAGAMENTO_TAXAS -> TAXAS_CARTAO & TENANT_MAQUININHAS
DO $$
DECLARE
  r RECORD;
  v_maq_id uuid;
  v_convertidas integer := 0;
  t_row RECORD;
  p integer;
BEGIN
  -- 1. Cria a maquininha padrão para todos os tenants existentes
  FOR r IN SELECT id FROM public.tenants LOOP
    SELECT id INTO v_maq_id FROM public.tenant_maquininhas WHERE tenant_id = r.id AND padrao = true LIMIT 1;
    IF v_maq_id IS NULL THEN
      INSERT INTO public.tenant_maquininhas (tenant_id, nome, padrao, ordem)
      VALUES (r.id, 'Maquininha Padrão', true, 1)
      RETURNING id INTO v_maq_id;
    END IF;
  END LOOP;

  -- 2. Converte linhas antigas da tabela forma_pagamento_taxas se ela existir
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'forma_pagamento_taxas') THEN
    FOR t_row IN 
      SELECT fpt.*, fp.tipo as forma_tipo
      FROM public.forma_pagamento_taxas fpt
      JOIN public.tenant_formas_pagamento fp ON fp.id = fpt.forma_id
    LOOP
      SELECT id INTO v_maq_id FROM public.tenant_maquininhas WHERE tenant_id = t_row.tenant_id AND padrao = true LIMIT 1;
      IF v_maq_id IS NOT NULL AND t_row.forma_tipo IN ('debito', 'credito') THEN
        FOR p IN t_row.parcela_min..t_row.parcela_max LOOP
          INSERT INTO public.taxas_cartao (
            tenant_id, maquininha_id, tipo, bandeira_codigo, parcelas,
            taxa_percentual, taxa_fixa, vigencia_inicio, vigencia_fim, criado_por, created_at
          ) VALUES (
            t_row.tenant_id, v_maq_id, t_row.forma_tipo, NULL, p,
            t_row.taxa_percentual, t_row.taxa_fixa, t_row.vigencia_inicio, t_row.vigencia_fim, t_row.criado_por, t_row.created_at
          )
          ON CONFLICT DO NOTHING;
          v_convertidas := v_convertidas + 1;
        END LOOP;
      END IF;
    END LOOP;
    
    RAISE NOTICE 'Migração de forma_pagamento_taxas concluída: % linhas convertidas para taxas_cartao.', v_convertidas;
    DROP TABLE IF EXISTS public.forma_pagamento_taxas CASCADE;
  END IF;
END;
$$;


-- 5. ALTERAÇÕES EM RECEBIMENTOS E EXECUCOES
ALTER TABLE public.recebimentos ADD COLUMN IF NOT EXISTS maquininha_id uuid REFERENCES public.tenant_maquininhas(id);
ALTER TABLE public.recebimentos ADD COLUMN IF NOT EXISTS bandeira_codigo text REFERENCES public.bandeiras(codigo);
ALTER TABLE public.recebimentos ADD COLUMN IF NOT EXISTS taxa_estimada boolean NOT NULL DEFAULT false;

ALTER TABLE public.execucoes ADD COLUMN IF NOT EXISTS desconto_tipo text CHECK (desconto_tipo IN ('porcentagem', 'valor_fixo'));
ALTER TABLE public.execucoes ADD COLUMN IF NOT EXISTS desconto_valor numeric(10,2);
ALTER TABLE public.execucoes ADD COLUMN IF NOT EXISTS desconto_motivo text;
ALTER TABLE public.execucoes ADD COLUMN IF NOT EXISTS desconto_aplicado_por uuid REFERENCES auth.users(id);


-- 6. RPC RESOLVER_TAXA_CARTAO
CREATE OR REPLACE FUNCTION public.resolver_taxa_cartao(
  p_maquininha uuid,
  p_tipo text,
  p_bandeira text,
  p_parcelas integer,
  p_data date DEFAULT current_date
) RETURNS TABLE (
  taxa_percentual numeric(5,2),
  taxa_fixa numeric(10,2),
  taxa_estimada boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_perc numeric(5,2);
  v_fixa numeric(10,2);
  v_bandeira_clean text;
BEGIN
  v_bandeira_clean := nullif(trim(p_bandeira), '');

  -- 1. Busca exata com bandeira informada
  IF v_bandeira_clean IS NOT NULL THEN
    SELECT tc.taxa_percentual, tc.taxa_fixa INTO v_perc, v_fixa
    FROM public.taxas_cartao tc
    WHERE tc.maquininha_id = p_maquininha
      AND tc.tipo = p_tipo
      AND tc.bandeira_codigo = v_bandeira_clean
      AND tc.parcelas = p_parcelas
      AND tc.vigencia_inicio <= p_data
      AND (tc.vigencia_fim IS NULL OR tc.vigencia_fim >= p_data)
    ORDER BY tc.vigencia_inicio DESC LIMIT 1;
  END IF;

  -- 2. Se não encontrou com a bandeira informada, busca a taxa padrão (bandeira_codigo IS NULL)
  IF v_perc IS NULL THEN
    SELECT tc.taxa_percentual, tc.taxa_fixa INTO v_perc, v_fixa
    FROM public.taxas_cartao tc
    WHERE tc.maquininha_id = p_maquininha
      AND tc.tipo = p_tipo
      AND tc.bandeira_codigo IS NULL
      AND tc.parcelas = p_parcelas
      AND tc.vigencia_inicio <= p_data
      AND (tc.vigencia_fim IS NULL OR tc.vigencia_fim >= p_data)
    ORDER BY tc.vigencia_inicio DESC LIMIT 1;
  END IF;

  -- 3. Se nenhuma taxa foi encontrada, retorna taxa zero e sinaliza como estimada
  IF v_perc IS NULL THEN
    RETURN QUERY SELECT 0.00::numeric(5,2), 0.00::numeric(10,2), true;
  ELSE
    RETURN QUERY SELECT v_perc, v_fixa, false;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolver_taxa_cartao(uuid, text, text, integer, date) TO authenticated;


-- 7. RPC SALVAR_TAXAS_CARTAO_LOTE (Salvamento em Lote com Fechamento de Vigência)
CREATE OR REPLACE FUNCTION public.salvar_taxas_cartao_lote(
  p_maquininha_id uuid,
  p_vigencia_inicio date,
  p_taxas jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid;
  v_item jsonb;
  v_tipo text;
  v_bandeira text;
  v_parcelas integer;
  v_perc numeric(5,2);
  v_fixa numeric(10,2);
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.tenant_maquininhas WHERE id = p_maquininha_id;
  IF v_tenant IS NULL OR NOT (v_tenant IN (SELECT public.meus_tenants())) OR NOT public.tem_papel(v_tenant, ARRAY['dono', 'gerente']::app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado. Apenas dono e gerente podem configurar taxas de cartão.';
  END IF;

  IF p_vigencia_inicio IS NULL THEN
    RAISE EXCEPTION 'A data de início da vigência é obrigatória.';
  END IF;

  -- Encerra vigência das taxas anteriores da mesma maquininha
  UPDATE public.taxas_cartao
  SET vigencia_fim = GREATEST(vigencia_inicio, p_vigencia_inicio - interval '1 day')::date
  WHERE maquininha_id = p_maquininha_id
    AND (vigencia_fim IS NULL OR vigencia_fim >= p_vigencia_inicio);

  -- Insere novas taxas
  IF p_taxas IS NOT NULL AND jsonb_array_length(p_taxas) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_taxas) LOOP
      v_tipo := v_item->>'tipo';
      v_bandeira := nullif(trim(v_item->>'bandeira_codigo'), '');
      v_parcelas := (v_item->>'parcelas')::integer;
      v_perc := (v_item->>'taxa_percentual')::numeric(5,2);
      v_fixa := COALESCE((v_item->>'taxa_fixa')::numeric(10,2), 0.00);

      IF v_perc IS NOT NULL AND v_perc >= 0 THEN
        INSERT INTO public.taxas_cartao (
          tenant_id, maquininha_id, tipo, bandeira_codigo, parcelas,
          taxa_percentual, taxa_fixa, vigencia_inicio, criado_por
        ) VALUES (
          v_tenant, p_maquininha_id, v_tipo, v_bandeira, v_parcelas,
          v_perc, v_fixa, p_vigencia_inicio, auth.uid()
        );
      END IF;
    END LOOP;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.salvar_taxas_cartao_lote(uuid, date, jsonb) TO authenticated;


-- 8. REDEFINIÇÃO DA RPC FINALIZAR_EXECUCAO_COM_PAGAMENTOS (Suporte a Maquininhas, Bandeiras, Taxa Estimada e Desconto)
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  -- 1. Conclusão operacional de itens e consumos
  PERFORM public.concluir_atendimento(p_execucao, p_valores, p_consumos, p_observacoes);

  -- Recarrega valor total bruto após conclusão dos itens
  SELECT valor_total_final INTO v_faturamento_bruto FROM public.execucoes WHERE id = p_execucao;
  v_faturamento_com_desconto := COALESCE(v_faturamento_bruto, 0.00);

  -- 2. Processa aplicação de desconto na finalização (se houver)
  v_desc_val := COALESCE(p_desconto_valor, 0.00);
  IF v_desc_val > 0 THEN
    IF p_desconto_motivo IS NULL OR trim(p_desconto_motivo) = '' THEN
      RAISE EXCEPTION 'O motivo do desconto é obrigatório quando há concessão de desconto.';
    END IF;

    IF p_desconto_tipo NOT IN ('porcentagem', 'valor_fixo') THEN
      RAISE EXCEPTION 'Tipo de desconto inválido. Use "porcentagem" ou "valor_fixo".';
    END IF;

    IF p_desconto_tipo = 'porcentagem' THEN
      v_faturamento_com_desconto := round(v_faturamento_bruto * (1.0 - (v_desc_val / 100.0)), 2);
    ELSE
      v_faturamento_com_desconto := GREATEST(0.00, v_faturamento_bruto - v_desc_val);
    END IF;

    UPDATE public.execucoes
    SET desconto_tipo = p_desconto_tipo,
        desconto_valor = v_desc_val,
        desconto_motivo = trim(p_desconto_motivo),
        desconto_aplicado_por = auth.uid(),
        valor_total_final = v_faturamento_com_desconto
    WHERE id = p_execucao;
  END IF;

  -- Sinal pago via Pix
  SELECT COALESCE(SUM(valor_bruto), 0.00) INTO v_sinal_pago
  FROM public.recebimentos
  WHERE agendamento_id = v_exec.agendamento_id AND origem = 'sinal_agendamento' AND status = 'recebido';

  v_saldo_restante := v_faturamento_com_desconto - v_sinal_pago;

  -- 3. Processa lançamentos de pagamento
  IF p_pagamentos IS NOT NULL AND jsonb_array_length(p_pagamentos) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_pagamentos) LOOP
      v_forma_id := (v_item->>'forma_id')::uuid;
      v_maquininha_id := nullif(v_item->>'maquininha_id', '')::uuid;
      v_bandeira_codigo := nullif(trim(v_item->>'bandeira_codigo'), '');
      v_total_parcelas := COALESCE((v_item->>'total_parcelas')::integer, 1);
      v_numero_parcela := COALESCE((v_item->>'numero_parcela')::integer, 1);
      v_valor_bruto := (v_item->>'valor_bruto')::numeric(10,2);
      v_previsto_para := COALESCE((v_item->>'previsto_para')::date, current_date);
      v_obs := v_item->>'observacao';

      v_soma_pagamentos := v_soma_pagamentos + v_valor_bruto;

      -- Tipo da forma de pagamento
      SELECT tipo INTO v_forma_tipo FROM public.tenant_formas_pagamento WHERE id = v_forma_id AND tenant_id = v_tenant;

      -- Resolução de taxa server-side para cartão de débito/crédito
      IF v_forma_tipo IN ('debito', 'credito') THEN
        IF v_maquininha_id IS NULL THEN
          SELECT id INTO v_maquininha_id FROM public.tenant_maquininhas WHERE tenant_id = v_tenant AND padrao = true LIMIT 1;
        END IF;

        SELECT r.taxa_percentual, r.taxa_fixa, r.taxa_estimada
        INTO v_taxa_perc, v_taxa_fixa, v_taxa_estimada
        FROM public.resolver_taxa_cartao(v_maquininha_id, v_forma_tipo, v_bandeira_codigo, v_total_parcelas, current_date) r;
      ELSE
        v_taxa_perc := 0.00;
        v_taxa_fixa := 0.00;
        v_taxa_estimada := false;
      END IF;

      v_taxa_perc := COALESCE(v_taxa_perc, 0.00);
      v_taxa_fixa := COALESCE(v_taxa_fixa, 0.00);

      v_valor_taxa := round(v_valor_bruto * (v_taxa_perc / 100.0) + (v_taxa_fixa / v_total_parcelas::numeric), 2);
      v_valor_liquido := v_valor_bruto - v_valor_taxa;

      IF v_forma_tipo IN ('dinheiro', 'pix', 'debito') AND v_previsto_para <= current_date THEN
        v_status := 'recebido';
        v_recebido_em := now();
      ELSE
        v_status := 'previsto';
        v_recebido_em := NULL;
      END IF;

      INSERT INTO public.recebimentos (
        tenant_id, execucao_id, agendamento_id, cliente_id, forma_id,
        maquininha_id, bandeira_codigo, taxa_estimada,
        numero_parcela, total_parcelas, valor_bruto,
        taxa_percentual_snapshot, taxa_fixa_snapshot, valor_taxa, valor_liquido,
        previsto_para, recebido_em, status, origem, observacao, criado_por
      ) VALUES (
        v_tenant, p_execucao, v_exec.agendamento_id, v_exec.cliente_id, v_forma_id,
        v_maquininha_id, v_bandeira_codigo, v_taxa_estimada,
        v_numero_parcela, v_total_parcelas, v_valor_bruto,
        v_taxa_perc, v_taxa_fixa, v_valor_taxa, v_valor_liquido,
        v_previsto_para, v_recebido_em, v_status, 'manual', v_obs, auth.uid()
      );
    END LOOP;

    -- Validação do valor pago contra o saldo restante (pós-desconto)
    IF round(v_soma_pagamentos, 2) <> round(v_saldo_restante, 2) THEN
      RAISE EXCEPTION 'A soma dos pagamentos lançados (R$ %) difere do valor total a receber pós-desconto (R$ %).', v_soma_pagamentos, v_saldo_restante;
    END IF;
  END IF;

  -- 4. Consolida resultado financeiro
  PERFORM public.fechar_resultado_execucao(p_execucao);
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalizar_execucao_com_pagamentos(uuid, jsonb, jsonb, jsonb, text, text, numeric, text) TO authenticated;


-- 9. ATUALIZAÇÃO DA RPC OBTER_CONTAS_A_RECEBER (Indicador de Faturamento Fechado com Taxa Estimada)
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
  v_faturamento_taxa_estimada_mes numeric(10,2) := 0.00;
  v_itens jsonb;
BEGIN
  v_tenant := (SELECT public.meus_tenants() LIMIT 1);
  IF v_tenant IS NULL OR NOT public.tem_papel(v_tenant, ARRAY['dono', 'gerente']::app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado. Apenas dono e gerente podem consultar contas a receber.';
  END IF;

  SELECT COALESCE(SUM(valor_bruto), 0.00) INTO v_a_receber_mes
  FROM public.recebimentos
  WHERE tenant_id = v_tenant AND status = 'previsto' AND date_trunc('month', previsto_para) = date_trunc('month', current_date);

  SELECT COALESCE(SUM(valor_bruto), 0.00) INTO v_vencido
  FROM public.recebimentos
  WHERE tenant_id = v_tenant AND status = 'previsto' AND previsto_para < current_date;

  SELECT COALESCE(SUM(valor_bruto), 0.00) INTO v_recebido_mes
  FROM public.recebimentos
  WHERE tenant_id = v_tenant AND status = 'recebido' AND date_trunc('month', recebido_em) = date_trunc('month', current_date);

  -- Faturamento do mês onde a taxa foi estimada (não cadastrada)
  SELECT COALESCE(SUM(valor_bruto), 0.00) INTO v_faturamento_taxa_estimada_mes
  FROM public.recebimentos
  WHERE tenant_id = v_tenant AND taxa_estimada = true AND date_trunc('month', created_at) = date_trunc('month', current_date);

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'cliente_id', r.cliente_id,
      'cliente_nome', c.nome,
      'cliente_telefone', c.telefone,
      'forma_nome', fp.nome,
      'forma_tipo', fp.tipo,
      'maquininha_nome', tm.nome,
      'bandeira_codigo', r.bandeira_codigo,
      'taxa_estimada', r.taxa_estimada,
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
  LEFT JOIN public.tenant_maquininhas tm ON tm.id = r.maquininha_id
  WHERE r.tenant_id = v_tenant AND r.status = 'previsto'
    AND (p_inicio IS NULL OR r.previsto_para >= p_inicio)
    AND (p_fim IS NULL OR r.previsto_para <= p_fim);

  RETURN jsonb_build_object(
    'a_receber_mes', v_a_receber_mes,
    'vencido_total', v_vencido,
    'recebido_mes', v_recebido_mes,
    'faturamento_taxa_estimada_mes', v_faturamento_taxa_estimada_mes,
    'itens', v_itens
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_contas_a_receber(date, date) TO authenticated;
