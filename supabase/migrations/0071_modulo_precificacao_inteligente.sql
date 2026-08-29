-- Migration 0071: Módulo de Precificação Inteligente & Referências de Mercado
-- 1. Novas colunas em public.tenants
-- 2. Tabela public.servico_modelo_referencia (RLS e Seed de mercado)
-- 3. Função public.categoria_padrao_nome (Mapeamento estável)
-- 4. RPC public.obter_matriz_precificacao_tenant (Custo real, Margem, Referência, Diagnóstico)
-- 5. RPC public.aplicar_precos_sugeridos (Atualização em lote/individual sem p_tenant)
-- 6. RPC public.atualizar_referencias_comunidade (Agregação P25-P75 para 5+ oficinas)
-- 7. Agendamento pg_cron mensal

-- 1. NOVAS COLUNAS EM TENANTS
ALTER TABLE public.tenants 
  ADD COLUMN IF NOT EXISTS porte_cidade TEXT DEFAULT 'interior' CHECK (porte_cidade IN ('nacional', 'interior', 'capital', 'metropolitana')),
  ADD COLUMN IF NOT EXISTS margem_alvo_percentual NUMERIC(5,2) DEFAULT 40.00 CHECK (margem_alvo_percentual >= 0 AND margem_alvo_percentual < 100);

-- 2. TABELA DE REFERÊNCIA DE PREÇOS DE MERCADO
CREATE TABLE IF NOT EXISTS public.servico_modelo_referencia (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  servico_modelo_codigo TEXT NOT NULL REFERENCES public.servicos_modelo(codigo) ON DELETE CASCADE,
  categoria_nome TEXT NOT NULL,
  porte_cidade TEXT NOT NULL DEFAULT 'nacional' CHECK (porte_cidade IN ('nacional', 'interior', 'capital', 'metropolitana')),
  preco_min NUMERIC(10,2) NOT NULL CHECK (preco_min >= 0),
  preco_max NUMERIC(10,2) NOT NULL CHECK (preco_max >= preco_min),
  fonte TEXT NOT NULL DEFAULT 'plataforma' CHECK (fonte IN ('plataforma', 'comunidade')),
  amostra INTEGER NOT NULL DEFAULT 0,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_servico_modelo_ref UNIQUE (servico_modelo_codigo, categoria_nome, porte_cidade)
);

-- RLS para servico_modelo_referencia
ALTER TABLE public.servico_modelo_referencia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Leitura autenticada referencias" ON public.servico_modelo_referencia;
CREATE POLICY "Leitura autenticada referencias" ON public.servico_modelo_referencia
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admin gerencia referencias" ON public.servico_modelo_referencia;
CREATE POLICY "Admin gerencia referencias" ON public.servico_modelo_referencia
  FOR ALL USING (public.is_platform_admin_editor());

GRANT SELECT ON public.servico_modelo_referencia TO authenticated;
GRANT ALL ON public.servico_modelo_referencia TO service_role;

-- SEED INICIAL DE REFERÊNCIAS DA PLATAFORMA (Porte: nacional, Fonte: plataforma)
INSERT INTO public.servico_modelo_referencia (servico_modelo_codigo, categoria_nome, porte_cidade, preco_min, preco_max, fonte, amostra)
VALUES
  -- Lavagem Simples (LV-01)
  ('LV-01', 'Hatch', 'nacional', 40.00, 70.00, 'plataforma', 0),
  ('LV-01', 'Sedan', 'nacional', 50.00, 85.00, 'plataforma', 0),
  ('LV-01', 'SUV', 'nacional', 60.00, 110.00, 'plataforma', 0),
  ('LV-01', 'Caminhonete', 'nacional', 70.00, 130.00, 'plataforma', 0),
  ('LV-01', 'Moto', 'nacional', 30.00, 60.00, 'plataforma', 0),

  -- Lavagem Detalhada (LV-02)
  ('LV-02', 'Hatch', 'nacional', 120.00, 180.00, 'plataforma', 0),
  ('LV-02', 'Sedan', 'nacional', 150.00, 220.00, 'plataforma', 0),
  ('LV-02', 'SUV', 'nacional', 180.00, 260.00, 'plataforma', 0),
  ('LV-02', 'Caminhonete', 'nacional', 200.00, 300.00, 'plataforma', 0),
  ('LV-02', 'Moto', 'nacional', 80.00, 140.00, 'plataforma', 0),

  -- Lavagem Técnica de Motor (LV-03)
  ('LV-03', 'Hatch', 'nacional', 90.00, 150.00, 'plataforma', 0),
  ('LV-03', 'Sedan', 'nacional', 100.00, 160.00, 'plataforma', 0),
  ('LV-03', 'SUV', 'nacional', 120.00, 190.00, 'plataforma', 0),
  ('LV-03', 'Caminhonete', 'nacional', 130.00, 220.00, 'plataforma', 0),

  -- Higienização Interna (HG-01)
  ('HG-01', 'Hatch', 'nacional', 250.00, 380.00, 'plataforma', 0),
  ('HG-01', 'Sedan', 'nacional', 280.00, 420.00, 'plataforma', 0),
  ('HG-01', 'SUV', 'nacional', 350.00, 520.00, 'plataforma', 0),
  ('HG-01', 'Caminhonete', 'nacional', 380.00, 580.00, 'plataforma', 0),

  -- Higienização de Bancos (HG-02)
  ('HG-02', 'Hatch', 'nacional', 180.00, 280.00, 'plataforma', 0),
  ('HG-02', 'Sedan', 'nacional', 200.00, 300.00, 'plataforma', 0),
  ('HG-02', 'SUV', 'nacional', 250.00, 380.00, 'plataforma', 0),
  ('HG-02', 'Caminhonete', 'nacional', 270.00, 420.00, 'plataforma', 0),

  -- Higienização de Ar-Condicionado (HG-03)
  ('HG-03', 'Hatch', 'nacional', 80.00, 130.00, 'plataforma', 0),
  ('HG-03', 'Sedan', 'nacional', 90.00, 140.00, 'plataforma', 0),
  ('HG-03', 'SUV', 'nacional', 100.00, 160.00, 'plataforma', 0),
  ('HG-03', 'Caminhonete', 'nacional', 110.00, 170.00, 'plataforma', 0),

  -- Polimento Comercial (PL-01)
  ('PL-01', 'Hatch', 'nacional', 350.00, 550.00, 'plataforma', 0),
  ('PL-01', 'Sedan', 'nacional', 400.00, 650.00, 'plataforma', 0),
  ('PL-01', 'SUV', 'nacional', 500.00, 800.00, 'plataforma', 0),
  ('PL-01', 'Caminhonete', 'nacional', 550.00, 900.00, 'plataforma', 0),

  -- Polimento Técnico (PL-02)
  ('PL-02', 'Hatch', 'nacional', 650.00, 950.00, 'plataforma', 0),
  ('PL-02', 'Sedan', 'nacional', 750.00, 1150.00, 'plataforma', 0),
  ('PL-02', 'SUV', 'nacional', 900.00, 1400.00, 'plataforma', 0),
  ('PL-02', 'Caminhonete', 'nacional', 1000.00, 1600.00, 'plataforma', 0),

  -- Correção de Pintura (PL-03)
  ('PL-03', 'Hatch', 'nacional', 1200.00, 1800.00, 'plataforma', 0),
  ('PL-03', 'Sedan', 'nacional', 1400.00, 2100.00, 'plataforma', 0),
  ('PL-03', 'SUV', 'nacional', 1700.00, 2600.00, 'plataforma', 0),
  ('PL-03', 'Caminhonete', 'nacional', 1900.00, 2900.00, 'plataforma', 0),

  -- Cristalização de Vidros (VT-01)
  ('VT-01', 'Hatch', 'nacional', 120.00, 190.00, 'plataforma', 0),
  ('VT-01', 'Sedan', 'nacional', 140.00, 220.00, 'plataforma', 0),
  ('VT-01', 'SUV', 'nacional', 160.00, 250.00, 'plataforma', 0),
  ('VT-01', 'Caminhonete', 'nacional', 180.00, 280.00, 'plataforma', 0),

  -- Vitrificação de Pintura (VT-09)
  ('VT-09', 'Hatch', 'nacional', 900.00, 1500.00, 'plataforma', 0),
  ('VT-09', 'Sedan', 'nacional', 1100.00, 1800.00, 'plataforma', 0),
  ('VT-09', 'SUV', 'nacional', 1300.00, 2200.00, 'plataforma', 0),
  ('VT-09', 'Caminhonete', 'nacional', 1500.00, 2500.00, 'plataforma', 0),

  -- Cera de Proteção (PR-01)
  ('PR-01', 'Hatch', 'nacional', 80.00, 140.00, 'plataforma', 0),
  ('PR-01', 'Sedan', 'nacional', 90.00, 160.00, 'plataforma', 0),
  ('PR-01', 'SUV', 'nacional', 110.00, 190.00, 'plataforma', 0),
  ('PR-01', 'Caminhonete', 'nacional', 130.00, 220.00, 'plataforma', 0),
  ('PR-01', 'Moto', 'nacional', 50.00, 90.00, 'plataforma', 0),

  -- Impermeabilização de Bancos (PR-02)
  ('PR-02', 'Hatch', 'nacional', 200.00, 320.00, 'plataforma', 0),
  ('PR-02', 'Sedan', 'nacional', 220.00, 350.00, 'plataforma', 0),
  ('PR-02', 'SUV', 'nacional', 280.00, 420.00, 'plataforma', 0),
  ('PR-02', 'Caminhonete', 'nacional', 300.00, 460.00, 'plataforma', 0)
ON CONFLICT (servico_modelo_codigo, categoria_nome, porte_cidade) DO NOTHING;

-- 3. FUNÇÃO AUXILIAR DE MAPEAMENTO ESTÁVEL DE CATEGORIA
CREATE OR REPLACE FUNCTION public.categoria_padrao_nome(p_nome TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_lower TEXT := lower(coalesce(trim(p_nome), ''));
BEGIN
  IF v_lower LIKE '%hatch%' OR v_lower LIKE '%pequeno%' THEN
    RETURN 'Hatch';
  ELSIF v_lower LIKE '%sedan%' OR v_lower LIKE '%médio%' OR v_lower LIKE '%medio%' THEN
    RETURN 'Sedan';
  ELSIF v_lower LIKE '%suv%' OR v_lower LIKE '%grande%' OR v_lower LIKE '%crossover%' THEN
    RETURN 'SUV';
  ELSIF v_lower LIKE '%caminhonete%' OR v_lower LIKE '%picape%' OR v_lower LIKE '%pickup%' THEN
    RETURN 'Caminhonete';
  ELSIF v_lower LIKE '%moto%' OR v_lower LIKE '%motocicleta%' THEN
    RETURN 'Moto';
  ELSE
    RETURN trim(p_nome);
  END IF;
END;
$$;

-- 4. RPC PRINCIPAL: OBTER MATRIZ DE PRECIFICAÇÃO DO TENANT (ZERO p_tenant)
CREATE OR REPLACE FUNCTION public.obter_matriz_precificacao_tenant()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_tenant UUID;
  v_porte_cidade TEXT := 'interior';
  v_margem_alvo NUMERIC(5,2) := 40.00;
  v_custo_hora NUMERIC(10,2) := 0.00;

  v_rec RECORD;
  v_duracao INTEGER := 60;
  v_duracao_fonte TEXT := 'estimativa';
  v_execucoes_count INTEGER := 0;

  v_custo_estrutura NUMERIC(10,2) := 0.00;
  v_custo_produtos NUMERIC(10,2) := 0.00;
  v_produtos_incompleto BOOLEAN := false;

  v_custo_comissao NUMERIC(10,2) := 0.00;
  v_custo_total NUMERIC(10,2) := 0.00;

  v_preco_atual NUMERIC(10,2) := 0.00;
  v_preco_alvo NUMERIC(10,2) := 0.00;
  v_margem_atual NUMERIC(5,1) := 0.0;

  v_ref RECORD;
  v_cat_padrao TEXT;
  v_tem_referencia BOOLEAN := false;
  v_preco_min NUMERIC(10,2);
  v_preco_max NUMERIC(10,2);
  v_fonte_ref TEXT;
  v_amostra_ref INTEGER := 0;

  v_status TEXT;
  v_diferenca_unitario NUMERIC(10,2) := 0.00;
  v_ganho_mensal NUMERIC(10,2) := 0.00;
  v_volume_mensal INTEGER := 1;
  v_impacto_financeiro NUMERIC(10,2) := 0.00;
  v_nota_explicativa TEXT;

  v_itens JSONB := '[]'::jsonb;
  v_item_json JSONB;
  v_total_perda_mes NUMERIC(10,2) := 0.00;
  v_total_oportunidade_mes NUMERIC(10,2) := 0.00;
  v_comissao_media NUMERIC(5,2) := 0.00;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT tm.tenant_id INTO v_tenant
  FROM public.tenant_members tm
  WHERE tm.user_id = auth.uid() 
    AND tm.status = 'ativo'
    AND tm.role IN ('dono', 'gerente')
  LIMIT 1;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Acesso negado. Apenas dono e gerente podem visualizar a precificação.';
  END IF;

  SELECT t.porte_cidade, coalesce(t.margem_alvo_percentual, 40.00)
  INTO v_porte_cidade, v_margem_alvo
  FROM public.tenants t
  WHERE t.id = v_tenant;

  IF v_porte_cidade IS NULL THEN
    v_porte_cidade := 'interior';
  END IF;

  v_custo_hora := public.custo_hora_operacao(v_tenant, current_date);

  -- Calcula média da comissão configurada na oficina
  SELECT coalesce(avg(case when cv.tipo = 'percentual' and cv.valor > 0 then cv.valor else 10.0 end), 10.0)
  INTO v_comissao_media
  FROM public.tenant_members tm
  CROSS JOIN LATERAL public.comissao_vigente(tm.id, current_date) cv
  WHERE tm.tenant_id = v_tenant AND tm.status = 'ativo';

  FOR v_rec IN
    SELECT 
      sp.id AS sp_id,
      sp.servico_id,
      s.nome AS servico_nome,
      s.codigo AS servico_codigo,
      sm.codigo AS modelo_codigo_existente,
      sp.categoria_id,
      cv.nome AS categoria_nome,
      sp.preco_base AS preco_atual,
      sp.duracao_minutos AS duracao_cadastro
    FROM public.servico_precos sp
    JOIN public.servicos s ON s.id = sp.servico_id
    LEFT JOIN public.servicos_modelo sm ON sm.codigo = s.codigo
    JOIN public.categorias_veiculo cv ON cv.id = sp.categoria_id
    WHERE sp.tenant_id = v_tenant AND s.ativo = true AND cv.ativo = true
    ORDER BY s.ordem ASC, cv.ordem ASC
  LOOP
    v_duracao := v_rec.duracao_cadastro;
    v_duracao_fonte := 'estimativa';
    v_execucoes_count := 0;

    -- Duração medicação x estimativa
    SELECT count(e.id), round(percentile_cont(0.5) WITHIN GROUP (ORDER BY coalesce(e.tempo_efetivo_minutos, 60)))::integer
    INTO v_execucoes_count, v_duracao
    FROM public.execucoes e
    JOIN public.agendamentos a ON a.id = e.agendamento_id
    JOIN public.agendamento_itens ai ON ai.agendamento_id = a.id
    WHERE e.tenant_id = v_tenant
      AND e.status = 'finalizado'
      AND ai.servico_id = v_rec.servico_id
      AND a.veiculo_id IN (SELECT v.id FROM public.veiculos v WHERE v.categoria_id = v_rec.categoria_id);

    IF v_execucoes_count >= 3 AND v_duracao IS NOT NULL AND v_duracao > 0 THEN
      v_duracao_fonte := 'medido';
    ELSE
      v_duracao := coalesce(v_rec.duracao_cadastro, 60);
      v_duracao_fonte := 'estimativa';
    END IF;

    -- Volume mensal dos últimos 90 dias dividido por 3 (mínimo 1)
    SELECT greatest(1, round(count(e.id)::numeric / 3.0)::integer)
    INTO v_volume_mensal
    FROM public.execucoes e
    JOIN public.agendamentos a ON a.id = e.agendamento_id
    JOIN public.agendamento_itens ai ON ai.agendamento_id = a.id
    WHERE e.tenant_id = v_tenant
      AND e.status = 'finalizado'
      AND ai.servico_id = v_rec.servico_id
      AND e.finalizado_em >= (current_date - interval '90 days');

    -- Custo Estrutura
    v_custo_estrutura := round((v_custo_hora * (v_duracao::numeric / 60.0)), 2);

    -- Custo Insumos/Produtos
    v_produtos_incompleto := false;
    SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ec_tot.total_exec))::numeric(10,2)
    INTO v_custo_produtos
    FROM (
      SELECT ec.execucao_id, sum(ec.custo_total) AS total_exec
      FROM public.execucao_consumos ec
      JOIN public.execucoes e ON e.id = ec.execucao_id
      JOIN public.agendamentos a ON a.id = e.agendamento_id
      JOIN public.agendamento_itens ai ON ai.agendamento_id = a.id
      WHERE e.tenant_id = v_tenant AND ai.servico_id = v_rec.servico_id
      GROUP BY ec.execucao_id
    ) ec_tot;

    IF v_custo_produtos IS NULL OR v_custo_produtos <= 0 THEN
      v_custo_produtos := 0.00;
      v_produtos_incompleto := true;
    END IF;

    -- Preço atual
    v_preco_atual := coalesce(v_rec.preco_atual, 0.00);

    -- Custo Comissão
    v_custo_comissao := round((v_preco_atual * coalesce(v_comissao_media, 10.00) / 100.00), 2);

    -- Custo Total
    v_custo_total := v_custo_estrutura + v_custo_produtos + v_custo_comissao;

    -- Preço Alvo (Margem Desejada)
    IF v_margem_alvo >= 99.0 THEN
      v_preco_alvo := round(v_custo_total * 2.0, 2);
    ELSE
      v_preco_alvo := round(v_custo_total / (1.0 - (v_margem_alvo / 100.0)), 2);
    END IF;

    -- Margem Atual
    IF v_preco_atual > 0 THEN
      v_margem_atual := round(((v_preco_atual - v_custo_total) / v_preco_atual) * 100.0, 1);
    ELSE
      v_margem_atual := 0.0;
    END IF;

    -- BUSCA REFERÊNCIA DE MERCADO (POR CÓDIGO DO MODELO E CATEGORIA PADRÃO)
    v_tem_referencia := false;
    v_preco_min := NULL;
    v_preco_max := NULL;
    v_fonte_ref := NULL;
    v_amostra_ref := 0;
    v_nota_explicativa := NULL;

    IF v_rec.servico_codigo IS NOT NULL AND v_rec.modelo_codigo_existente IS NOT NULL THEN
      v_cat_padrao := public.categoria_padrao_nome(v_rec.categoria_nome);

      -- Tenta porte da cidade do tenant primeiro, depois cai para 'nacional'
      SELECT r.preco_min, r.preco_max, r.fonte, r.amostra
      INTO v_ref
      FROM public.servico_modelo_referencia r
      WHERE r.servico_modelo_codigo = v_rec.servico_codigo
        AND r.categoria_nome = v_cat_padrao
        AND r.porte_cidade = v_porte_cidade;

      IF v_ref.preco_min IS NULL THEN
        SELECT r.preco_min, r.preco_max, r.fonte, r.amostra
        INTO v_ref
        FROM public.servico_modelo_referencia r
        WHERE r.servico_modelo_codigo = v_rec.servico_codigo
          AND r.categoria_nome = v_cat_padrao
          AND r.porte_cidade = 'nacional';
      END IF;

      IF v_ref.preco_min IS NOT NULL THEN
        v_tem_referencia := true;
        v_preco_min := v_ref.preco_min;
        v_preco_max := v_ref.preco_max;
        v_fonte_ref := v_ref.fonte;
        v_amostra_ref := v_ref.amostra;
      END IF;
    END IF;

    IF NOT v_tem_referencia THEN
      v_nota_explicativa := 'Serviço próprio da oficina (sem modelo de referência no catálogo)';
    END IF;

    -- DIAGNÓSTICO E SUGESTÃO
    v_status := 'ok';
    v_diferenca_unitario := 0.00;
    v_ganho_mensal := 0.00;
    v_impacto_financeiro := 0.00;

    IF v_preco_atual > 0 AND v_preco_atual < v_custo_total THEN
      v_status := 'prejuizo';
      v_diferenca_unitario := round(v_custo_total - v_preco_atual, 2);
      v_impacto_financeiro := (v_custo_total - v_preco_atual) * v_volume_mensal * 2.0; -- Prioridade alta para prejuízos
      v_total_perda_mes := v_total_perda_mes + ((v_custo_total - v_preco_atual) * v_volume_mensal);
    ELSIF v_tem_referencia AND v_custo_total > v_preco_max THEN
      v_status := 'custo_alto';
      v_impacto_financeiro := (v_custo_total - v_preco_max) * v_volume_mensal;
    ELSIF v_preco_atual < v_preco_alvo THEN
      v_status := 'abaixo_alvo';
      v_ganho_mensal := round((v_preco_alvo - v_preco_atual) * v_volume_mensal, 2);
      v_impacto_financeiro := (v_preco_alvo - v_preco_atual) * v_volume_mensal;
      v_total_oportunidade_mes := v_total_oportunidade_mes + v_ganho_mensal;
    ELSIF v_tem_referencia AND v_preco_atual > v_preco_max THEN
      v_status := 'premium';
    ELSE
      v_status := 'ok';
    END IF;

    IF NOT v_tem_referencia AND v_status <> 'prejuizo' THEN
      v_status := 'sem_referencia';
    END IF;

    v_item_json := jsonb_build_object(
      'servico_preco_id', v_rec.sp_id,
      'servico_id', v_rec.servico_id,
      'servico_nome', v_rec.servico_nome,
      'servico_codigo', v_rec.servico_codigo,
      'categoria_id', v_rec.categoria_id,
      'categoria_nome', v_rec.categoria_nome,
      'duracao_minutos', v_duracao,
      'duracao_fonte', v_duracao_fonte,
      'execucoes_count', v_execucoes_count,
      'volume_mensal', v_volume_mensal,
      'custo_estrutura', v_custo_estrutura,
      'custo_produtos', v_custo_produtos,
      'produtos_incompleto', v_produtos_incompleto,
      'custo_comissao', v_custo_comissao,
      'custo_total', v_custo_total,
      'preco_atual', v_preco_atual,
      'preco_alvo', v_preco_alvo,
      'margem_atual', v_margem_atual,
      'tem_referencia', v_tem_referencia,
      'preco_min', v_preco_min,
      'preco_max', v_preco_max,
      'fonte_ref', v_fonte_ref,
      'amostra_ref', v_amostra_ref,
      'status', v_status,
      'diferenca_unitario', v_diferenca_unitario,
      'ganho_mensal', v_ganho_mensal,
      'impacto_financeiro', v_impacto_financeiro,
      'nota_explicativa', v_nota_explicativa
    );

    v_itens := jsonb_insert(v_itens, '{0}', v_item_json);
  END LOOP;

  -- Ordena os itens por impacto_financeiro DESC
  SELECT coalesce(jsonb_agg(elem ORDER BY (elem->>'impacto_financeiro')::numeric DESC), '[]'::jsonb)
  INTO v_itens
  FROM jsonb_array_elements(v_itens) AS elem;

  RETURN jsonb_build_object(
    'tenant_info', jsonb_build_object(
      'porte_cidade', v_porte_cidade,
      'margem_alvo_percentual', v_margem_alvo,
      'custo_hora_atual', v_custo_hora
    ),
    'resumo_impacto', jsonb_build_object(
      'total_perda_mes', round(v_total_perda_mes, 2),
      'total_oportunidade_mes', round(v_total_oportunidade_mes, 2),
      'impacto_total_mes', round(v_total_perda_mes + v_total_oportunidade_mes, 2),
      'total_itens', jsonb_array_length(v_itens)
    ),
    'itens', v_itens
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_matriz_precificacao_tenant() TO authenticated;

-- 5. RPC: APLICAR PREÇOS SUGERIDOS (ZERO p_tenant)
CREATE OR REPLACE FUNCTION public.aplicar_precos_sugeridos(
  p_itens JSONB
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_tenant UUID;
  v_item JSONB;
  v_sp_id UUID;
  v_novo_preco NUMERIC(10,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT tm.tenant_id INTO v_tenant
  FROM public.tenant_members tm
  WHERE tm.user_id = auth.uid() 
    AND tm.status = 'ativo'
    AND tm.role IN ('dono', 'gerente')
  LIMIT 1;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Acesso negado. Apenas dono e gerente podem atualizar preços.';
  END IF;

  IF p_itens IS NULL OR jsonb_array_length(p_itens) = 0 THEN
    RETURN;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_sp_id := (v_item->>'servico_preco_id')::uuid;
    v_novo_preco := (v_item->>'novo_preco')::numeric(10,2);

    IF v_sp_id IS NOT NULL AND v_novo_preco > 0 THEN
      UPDATE public.servico_precos
      SET preco_base = v_novo_preco,
          updated_at = now()
      WHERE id = v_sp_id AND tenant_id = v_tenant;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.aplicar_precos_sugeridos(jsonb) TO authenticated;

-- 6. RPC: ATUALIZAR REFERÊNCIAS DA COMUNIDADE (AGREGAÇÃO P25-P75 PARA N >= 5 OFICINAS)
CREATE OR REPLACE FUNCTION public.atualizar_referencias_comunidade()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_mod RECORD;
  v_cat TEXT;
  v_categorias TEXT[] := ARRAY['Hatch', 'Sedan', 'SUV', 'Caminhonete', 'Moto'];
  v_n_oficinas INTEGER;
  v_p25 NUMERIC(10,2);
  v_p75 NUMERIC(10,2);
BEGIN
  FOR v_mod IN SELECT codigo FROM public.servicos_modelo LOOP
    FOREACH v_cat IN ARRAY v_categorias LOOP
      -- Conta número de oficinas distintas com preço ativo cadastrado para este modelo e categoria
      SELECT count(DISTINCT sp.tenant_id),
             round(percentile_cont(0.25) WITHIN GROUP (ORDER BY sp.preco_base))::numeric(10,2),
             round(percentile_cont(0.75) WITHIN GROUP (ORDER BY sp.preco_base))::numeric(10,2)
      INTO v_n_oficinas, v_p25, v_p75
      FROM public.servico_precos sp
      JOIN public.servicos s ON s.id = sp.servico_id AND s.tenant_id = sp.tenant_id
      JOIN public.categorias_veiculo cv ON cv.id = sp.categoria_id AND cv.tenant_id = sp.tenant_id
      WHERE s.codigo = v_mod.codigo
        AND public.categoria_padrao_nome(cv.nome) = v_cat
        AND sp.preco_base IS NOT NULL
        AND sp.preco_base > 0
        AND s.ativo = true
        AND cv.ativo = true;

      -- Se houver 5 ou mais oficinas distintas, atualiza a faixa de referência com dados da comunidade
      IF v_n_oficinas >= 5 AND v_p25 IS NOT NULL AND v_p75 IS NOT NULL AND v_p75 >= v_p25 THEN
        INSERT INTO public.servico_modelo_referencia (
          servico_modelo_codigo, categoria_nome, porte_cidade, preco_min, preco_max, fonte, amostra, atualizado_em
        ) VALUES (
          v_mod.codigo, v_cat, 'nacional', v_p25, v_p75, 'comunidade', v_n_oficinas, now()
        )
        ON CONFLICT (servico_modelo_codigo, categoria_nome, porte_cidade) DO UPDATE
        SET preco_min = EXCLUDED.preco_min,
            preco_max = EXCLUDED.preco_max,
            fonte = 'comunidade',
            amostra = EXCLUDED.amostra,
            atualizado_em = now();
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.atualizar_referencias_comunidade() TO authenticated;

-- 7. AGENDAMENTO NO PG_CRON (RODA UMA VEZ POR MÊS NO DIA 1 ÀS 03:00)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('atualizar_referencias_comunidade_mensal', '0 3 1 * *', 'SELECT public.atualizar_referencias_comunidade()');
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Ignora se o pg_cron não estiver instalado no projeto local Supabase
  NULL;
END $$;
