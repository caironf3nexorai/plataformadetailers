-- Migration 0062: Dashboard do Dono, Metas Mensais e Otimização de Consultas

-- 1. TABELA TENANT_METAS
CREATE TABLE IF NOT EXISTS public.tenant_metas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  mes date NOT NULL, -- primeiro dia do mês, ex: '2026-08-01'
  tipo text NOT NULL CHECK (tipo IN ('faturamento', 'lucro_liquido', 'carros')),
  valor numeric(12,2) NOT NULL CHECK (valor >= 0),
  criado_por uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE (tenant_id, mes)
);

ALTER TABLE public.tenant_metas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Membros podem visualizar metas do tenant" ON public.tenant_metas;
CREATE POLICY "Membros podem visualizar metas do tenant"
  ON public.tenant_metas FOR SELECT
  USING (tenant_id IN (SELECT public.meus_tenants()));

DROP POLICY IF EXISTS "Dono e gerente podem gerenciar metas" ON public.tenant_metas;
CREATE POLICY "Dono e gerente podem gerenciar metas"
  ON public.tenant_metas FOR ALL
  USING (public.tem_papel(tenant_id, ARRAY['dono', 'gerente']::app_role[]));


-- 2. ÍNDICES DE OTIMIZAÇÃO DE PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_agendamentos_tenant_status_inicio ON public.agendamentos(tenant_id, status, inicio);
CREATE INDEX IF NOT EXISTS idx_execucoes_tenant_status_finalizado ON public.execucoes(tenant_id, status, finalizado_em);
CREATE INDEX IF NOT EXISTS idx_recebimentos_tenant_status_previsto ON public.recebimentos(tenant_id, status, previsto_para);
CREATE INDEX IF NOT EXISTS idx_recebimentos_tenant_status_recebido ON public.recebimentos(tenant_id, status, recebido_em);
CREATE INDEX IF NOT EXISTS idx_tenant_metas_tenant_mes ON public.tenant_metas(tenant_id, mes);
CREATE INDEX IF NOT EXISTS idx_checkins_tenant_finalizado ON public.checkins(tenant_id, finalizado);
CREATE INDEX IF NOT EXISTS idx_produtos_tenant_alerta ON public.produtos(tenant_id, ativo, estoque_atual, estoque_minimo);


-- 3. RPC SALVAR_TENANT_META (COM BLOQUEIO DE OPERADOR)
CREATE OR REPLACE FUNCTION public.salvar_tenant_meta(
  p_mes date,
  p_tipo text,
  p_valor numeric
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid;
  v_primeiro_dia date;
BEGIN
  v_tenant := (SELECT public.meus_tenants() LIMIT 1);
  IF v_tenant IS NULL OR NOT public.tem_papel(v_tenant, ARRAY['dono', 'gerente']::app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado: apenas Donos ou Gerentes podem salvar metas mensais.';
  END IF;

  IF p_tipo NOT IN ('faturamento', 'lucro_liquido', 'carros') THEN
    RAISE EXCEPTION 'Tipo de meta inválido. Escolha entre faturamento, lucro_liquido ou carros.';
  END IF;

  IF COALESCE(p_valor, -1) < 0 THEN
    RAISE EXCEPTION 'O valor da meta deve ser maior ou igual a zero.';
  END IF;

  v_primeiro_dia := date_trunc('month', p_mes)::date;

  INSERT INTO public.tenant_metas (
    tenant_id, mes, tipo, valor, criado_por
  ) VALUES (
    v_tenant, v_primeiro_dia, p_tipo, round(p_valor, 2), auth.uid()
  )
  ON CONFLICT (tenant_id, mes) DO UPDATE
  SET tipo = EXCLUDED.tipo,
      valor = EXCLUDED.valor,
      criado_por = EXCLUDED.criado_por,
      created_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.salvar_tenant_meta(date, text, numeric) TO authenticated;


-- 4. RPC DASHBOARD_DONO (UNIFICADO COM REGRAS CONTÁBEIS E ALERTAS DE AÇÃO)
CREATE OR REPLACE FUNCTION public.dashboard_dono()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid;
  v_agora_sp timestamptz;
  v_hoje_sp date;
  v_primeiro_dia_mes date;
  v_primeiro_dia_mes_ant date;
  v_ultimo_dia_mes_ant date;
  
  -- Bloco Agora
  v_em_execucao_count integer := 0;
  v_aguardando_inicio_count integer := 0;
  v_concluidos_hoje_count integer := 0;
  v_atrasados_entrega_count integer := 0;
  v_pernoite_hoje_count integer := 0;
  v_carros_na_oficina_count integer := 0;
  v_previsao_atraso_lista jsonb := '[]'::jsonb;
  
  -- Bloco Dinheiro
  v_faturado_mes numeric(12,2) := 0.00;
  v_recebido_mes numeric(12,2) := 0.00;
  v_faturamento_mes_anterior numeric(12,2) := 0.00;
  v_lucro_liquido_mes_atual numeric(12,2) := 0.00;
  v_lucro_liquido_mes_anterior numeric(12,2) := 0.00;
  v_a_receber_pendente numeric(12,2) := 0.00;
  v_vencido_total numeric(12,2) := 0.00;
  v_carros_concluidos_mes_atual integer := 0;
  v_carros_concluidos_mes_anterior integer := 0;
  v_ticket_medio numeric(12,2) := 0.00;
  v_ticket_medio_anterior numeric(12,2) := 0.00;
  
  -- Meta
  v_meta_rec record;
  v_meta_obj jsonb := null;
  v_meta_atual numeric(12,2) := 0.00;
  v_meta_pct numeric(5,1) := 0.0;
  
  -- Bloco Precisa de Ação
  v_vistorias_sem_assinatura_count integer := 0;
  v_vistorias_sem_assinatura_lista jsonb := '[]'::jsonb;
  v_produtos_estoque_baixo_count integer := 0;
  v_produtos_estoque_baixo_lista jsonb := '[]'::jsonb;
  v_orcamentos_expirando_count integer := 0;
  v_orcamentos_expirando_lista jsonb := '[]'::jsonb;
  v_contas_vencidas_count integer := 0;
  v_contas_vencidas_lista jsonb := '[]'::jsonb;
  v_agendamentos_sem_confirmacao_count integer := 0;
  v_agendamentos_sem_confirmacao_lista jsonb := '[]'::jsonb;
  v_atendimentos_taxa_estimada_count integer := 0;
  v_atendimentos_taxa_estimada_lista jsonb := '[]'::jsonb;
  
  -- Bloco Saúde
  v_orcamentos_enviados_mes integer := 0;
  v_orcamentos_aprovados_mes integer := 0;
  v_taxa_conversao_orcamentos_pct numeric(5,1) := 0.0;
  v_margem_media_pct numeric(5,1) := 0.0;
  v_comparativo_faturamento_pct numeric(5,1) := 0.0;
  v_comparativo_ticket_pct numeric(5,1) := 0.0;

BEGIN
  v_tenant := (SELECT public.meus_tenants() LIMIT 1);
  IF v_tenant IS NULL OR NOT public.tem_papel(v_tenant, ARRAY['dono', 'gerente']::app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado: apenas Donos ou Gerentes podem acessar o Dashboard de Gestão.';
  END IF;

  v_agora_sp := now() AT TIME ZONE 'America/Sao_Paulo';
  v_hoje_sp := v_agora_sp::date;
  v_primeiro_dia_mes := date_trunc('month', v_hoje_sp)::date;
  v_primeiro_dia_mes_ant := date_trunc('month', v_hoje_sp - interval '1 month')::date;
  v_ultimo_dia_mes_ant := (v_primeiro_dia_mes - interval '1 day')::date;

  -----------------------------------------------------------------------------
  -- 1. BLOCO AGORA
  -----------------------------------------------------------------------------
  -- Em execução (cronômetro ativo ou pausado)
  SELECT count(*) INTO v_em_execucao_count
  FROM public.execucoes e
  WHERE e.tenant_id = v_tenant AND e.status IN ('em_andamento', 'pausado');

  -- Aguardando início (agendados ou confirmados para hoje sem execução iniciada)
  SELECT count(*) INTO v_aguardando_inicio_count
  FROM public.agendamentos a
  WHERE a.tenant_id = v_tenant
    AND a.status IN ('agendado', 'confirmado')
    AND (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date = v_hoje_sp
    AND NOT EXISTS (SELECT 1 FROM public.execucoes e WHERE e.agendamento_id = a.id);

  -- Concluídos Hoje
  SELECT count(*) INTO v_concluidos_hoje_count
  FROM public.agendamentos a
  WHERE a.tenant_id = v_tenant
    AND a.status = 'concluido'
    AND ((a.updated_at AT TIME ZONE 'America/Sao_Paulo')::date = v_hoje_sp
         OR EXISTS (SELECT 1 FROM public.execucoes e WHERE e.agendamento_id = a.id AND (e.finalizado_em AT TIME ZONE 'America/Sao_Paulo')::date = v_hoje_sp));

  -- Pernoite hoje (veículos que dormem na oficina hoje por agendamento de múltiplos dias ou transbordo)
  SELECT count(*) INTO v_pernoite_hoje_count
  FROM public.agendamentos a
  WHERE a.tenant_id = v_tenant
    AND a.status IN ('agendado', 'confirmado', 'em_andamento')
    AND (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date <= v_hoje_sp
    AND ((a.inicio AT TIME ZONE 'America/Sao_Paulo')::date + COALESCE(a.dias_ocupados, 1) - 1) > v_hoje_sp;

  -- Carros na Oficina (soma dos em execução + aguardando no dia)
  v_carros_na_oficina_count := v_em_execucao_count + v_aguardando_inicio_count;

  -- Atrasados entrega (com previsão de entrega estourada)
  SELECT count(*) INTO v_atrasados_entrega_count
  FROM public.agendamentos a
  WHERE a.tenant_id = v_tenant
    AND a.status IN ('agendado', 'confirmado', 'em_andamento')
    AND a.previsao_entrega IS NOT NULL
    AND a.previsao_entrega < now();

  -- Lista dos atrasados
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'agendamento_id', a.id,
      'cliente_nome', c.nome,
      'veiculo_modelo', COALESCE(v.modelo, 'Veículo'),
      'veiculo_placa', COALESCE(v.placa, ''),
      'servico_nome', s.nome,
      'previsao_entrega', a.previsao_entrega,
      'minutos_atraso', FLOOR(EXTRACT(EPOCH FROM (now() - a.previsao_entrega)) / 60)
    ) ORDER BY a.previsao_entrega ASC
  ), '[]'::jsonb) INTO v_previsao_atraso_lista
  FROM public.agendamentos a
  JOIN public.clientes c ON c.id = a.cliente_id
  LEFT JOIN public.veiculos v ON v.id = a.veiculo_id
  JOIN public.servicos s ON s.id = a.servico_id
  WHERE a.tenant_id = v_tenant
    AND a.status IN ('agendado', 'confirmado', 'em_andamento')
    AND a.previsao_entrega IS NOT NULL
    AND a.previsao_entrega < now();


  -----------------------------------------------------------------------------
  -- 2. BLOCO DINHEIRO
  -----------------------------------------------------------------------------
  -- Faturado no mês (Competência: soma dos totais das execuções finalizadas no mês)
  SELECT COALESCE(SUM(e.valor_total_final), 0.00) INTO v_faturado_mes
  FROM public.execucoes e
  WHERE e.tenant_id = v_tenant
    AND e.status = 'finalizado'
    AND (e.finalizado_em AT TIME ZONE 'America/Sao_Paulo')::date >= v_primeiro_dia_mes;

  -- Recebido no mês (Caixa: soma dos recebimentos com status 'recebido' pagos no mês)
  SELECT COALESCE(SUM(r.valor_bruto), 0.00) INTO v_recebido_mes
  FROM public.recebimentos r
  WHERE r.tenant_id = v_tenant
    AND r.status = 'recebido'
    AND (r.recebido_em AT TIME ZONE 'America/Sao_Paulo')::date >= v_primeiro_dia_mes;

  -- Faturado no mês anterior
  SELECT COALESCE(SUM(e.valor_total_final), 0.00) INTO v_faturamento_mes_anterior
  FROM public.execucoes e
  WHERE e.tenant_id = v_tenant
    AND e.status = 'finalizado'
    AND (e.finalizado_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_primeiro_dia_mes_ant AND v_ultimo_dia_mes_ant;

  -- Lucro Líquido no mês atual
  SELECT COALESCE(SUM(e.lucro_liquido), 0.00) INTO v_lucro_liquido_mes_atual
  FROM public.execucoes e
  WHERE e.tenant_id = v_tenant
    AND e.status = 'finalizado'
    AND (e.finalizado_em AT TIME ZONE 'America/Sao_Paulo')::date >= v_primeiro_dia_mes;

  -- Lucro Líquido no mês anterior
  SELECT COALESCE(SUM(e.lucro_liquido), 0.00) INTO v_lucro_liquido_mes_anterior
  FROM public.execucoes e
  WHERE e.tenant_id = v_tenant
    AND e.status = 'finalizado'
    AND (e.finalizado_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_primeiro_dia_mes_ant AND v_ultimo_dia_mes_ant;

  -- A receber pendente (todos os previstos)
  SELECT COALESCE(SUM(r.valor_bruto), 0.00) INTO v_a_receber_pendente
  FROM public.recebimentos r
  WHERE r.tenant_id = v_tenant AND r.status = 'previsto';

  -- Vencido total (previsto para datas anteriores a hoje)
  SELECT COALESCE(SUM(r.valor_bruto), 0.00) INTO v_vencido_total
  FROM public.recebimentos r
  WHERE r.tenant_id = v_tenant AND r.status = 'previsto' AND r.previsto_para < v_hoje_sp;

  -- Carros concluídos no mês atual
  SELECT count(*) INTO v_carros_concluidos_mes_atual
  FROM public.execucoes e
  WHERE e.tenant_id = v_tenant
    AND e.status = 'finalizado'
    AND (e.finalizado_em AT TIME ZONE 'America/Sao_Paulo')::date >= v_primeiro_dia_mes;

  -- Carros concluídos no mês anterior
  SELECT count(*) INTO v_carros_concluidos_mes_anterior
  FROM public.execucoes e
  WHERE e.tenant_id = v_tenant
    AND e.status = 'finalizado'
    AND (e.finalizado_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_primeiro_dia_mes_ant AND v_ultimo_dia_mes_ant;

  -- Ticket Médio
  IF v_carros_concluidos_mes_atual > 0 THEN
    v_ticket_medio := round((v_faturado_mes / v_carros_concluidos_mes_atual::numeric), 2);
  END IF;

  IF v_carros_concluidos_mes_anterior > 0 THEN
    v_ticket_medio_anterior := round((v_faturamento_mes_anterior / v_carros_concluidos_mes_anterior::numeric), 2);
  END IF;

  -- Meta Mensal
  SELECT * INTO v_meta_rec
  FROM public.tenant_metas tm
  WHERE tm.tenant_id = v_tenant AND tm.mes = v_primeiro_dia_mes;

  IF v_meta_rec.id IS NOT NULL THEN
    IF v_meta_rec.tipo = 'faturamento' THEN
      v_meta_atual := v_faturado_mes;
    ELSIF v_meta_rec.tipo = 'lucro_liquido' THEN
      v_meta_atual := v_lucro_liquido_mes_atual;
    ELSIF v_meta_rec.tipo = 'carros' THEN
      v_meta_atual := v_carros_concluidos_mes_atual::numeric;
    END IF;

    IF v_meta_rec.valor > 0 THEN
      v_meta_pct := round((v_meta_atual / v_meta_rec.valor) * 100.0, 1);
    END IF;

    v_meta_obj := jsonb_build_object(
      'id', v_meta_rec.id,
      'mes', v_meta_rec.mes,
      'tipo', v_meta_rec.tipo,
      'valor_meta', v_meta_rec.valor,
      'valor_atual', v_meta_atual,
      'progresso_pct', LEAST(v_meta_pct, 999.9)
    );
  END IF;


  -----------------------------------------------------------------------------
  -- 3. BLOCO PRECISA DE AÇÃO
  -----------------------------------------------------------------------------
  -- 1. Vistorias sem assinatura
  SELECT count(*) INTO v_vistorias_sem_assinatura_count
  FROM public.checkins c
  WHERE c.tenant_id = v_tenant AND (c.finalizado = false OR c.assinado_em IS NULL OR c.assinatura_path IS NULL);

  SELECT COALESCE(jsonb_agg(t.obj), '[]'::jsonb) INTO v_vistorias_sem_assinatura_lista
  FROM (
    SELECT jsonb_build_object(
      'checkin_id', c.id,
      'agendamento_id', c.agendamento_id,
      'cliente_nome', cl.nome,
      'veiculo_modelo', COALESCE(v.modelo, 'Veículo'),
      'created_at', c.created_at
    ) AS obj
    FROM public.checkins c
    JOIN public.agendamentos a ON a.id = c.agendamento_id
    JOIN public.clientes cl ON cl.id = a.cliente_id
    LEFT JOIN public.veiculos v ON v.id = a.veiculo_id
    WHERE c.tenant_id = v_tenant AND (c.finalizado = false OR c.assinado_em IS NULL OR c.assinatura_path IS NULL)
    ORDER BY c.created_at DESC
    LIMIT 5
  ) t;

  -- 2. Produtos com estoque baixo
  SELECT count(*) INTO v_produtos_estoque_baixo_count
  FROM public.produtos p
  WHERE p.tenant_id = v_tenant AND p.ativo = true AND p.estoque_atual <= p.estoque_minimo;

  SELECT COALESCE(jsonb_agg(t.obj), '[]'::jsonb) INTO v_produtos_estoque_baixo_lista
  FROM (
    SELECT jsonb_build_object(
      'produto_id', p.id,
      'nome', p.nome,
      'marca', p.marca,
      'estoque_atual', p.estoque_atual,
      'estoque_minimo', p.estoque_minimo,
      'unidade_uso', p.unidade_uso
    ) AS obj
    FROM public.produtos p
    WHERE p.tenant_id = v_tenant AND p.ativo = true AND p.estoque_atual <= p.estoque_minimo
    ORDER BY (p.estoque_minimo - p.estoque_atual) DESC
    LIMIT 5
  ) t;

  -- 3. Orçamentos expirando (nos próximos 3 dias)
  SELECT count(*) INTO v_orcamentos_expirando_count
  FROM public.orcamentos o
  WHERE o.tenant_id = v_tenant
    AND o.status = 'enviado'
    AND o.enviado_em IS NOT NULL
    AND (o.enviado_em::date + COALESCE(o.validade_dias, 7)) BETWEEN v_hoje_sp AND (v_hoje_sp + interval '3 days')::date;

  SELECT COALESCE(jsonb_agg(t.obj), '[]'::jsonb) INTO v_orcamentos_expirando_lista
  FROM (
    SELECT jsonb_build_object(
      'orcamento_id', o.id,
      'numero_os', o.numero_os,
      'cliente_nome', cl.nome,
      'valor_total', COALESCE(
        (SELECT n.valor_total FROM public.orcamento_niveis n WHERE n.orcamento_id = o.id ORDER BY n.valor_total DESC LIMIT 1),
        0.00
      ),
      'data_validade_limite', (o.enviado_em::date + COALESCE(o.validade_dias, 7))
    ) AS obj
    FROM public.orcamentos o
    JOIN public.clientes cl ON cl.id = o.cliente_id
    WHERE o.tenant_id = v_tenant
      AND o.status = 'enviado'
      AND o.enviado_em IS NOT NULL
      AND (o.enviado_em::date + COALESCE(o.validade_dias, 7)) BETWEEN v_hoje_sp AND (v_hoje_sp + interval '3 days')::date
    ORDER BY (o.enviado_em::date + COALESCE(o.validade_dias, 7)) ASC
    LIMIT 5
  ) t;

  -- 4. Contas vencidas
  SELECT count(*) INTO v_contas_vencidas_count
  FROM public.recebimentos r
  WHERE r.tenant_id = v_tenant AND r.status = 'previsto' AND r.previsto_para < v_hoje_sp;

  SELECT COALESCE(jsonb_agg(t.obj), '[]'::jsonb) INTO v_contas_vencidas_lista
  FROM (
    SELECT jsonb_build_object(
      'recebimento_id', r.id,
      'cliente_nome', cl.nome,
      'valor_bruto', r.valor_bruto,
      'previsto_para', r.previsto_para,
      'dias_atraso', (v_hoje_sp - r.previsto_para)
    ) AS obj
    FROM public.recebimentos r
    JOIN public.clientes cl ON cl.id = r.cliente_id
    WHERE r.tenant_id = v_tenant AND r.status = 'previsto' AND r.previsto_para < v_hoje_sp
    ORDER BY r.previsto_para ASC
    LIMIT 5
  ) t;

  -- 5. Agendamentos sem confirmação (hoje ou amanhã com status agendado)
  SELECT count(*) INTO v_agendamentos_sem_confirmacao_count
  FROM public.agendamentos a
  WHERE a.tenant_id = v_tenant
    AND a.status = 'agendado'
    AND (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_hoje_sp AND (v_hoje_sp + interval '1 day')::date;

  SELECT COALESCE(jsonb_agg(t.obj), '[]'::jsonb) INTO v_agendamentos_sem_confirmacao_lista
  FROM (
    SELECT jsonb_build_object(
      'agendamento_id', a.id,
      'cliente_nome', cl.nome,
      'veiculo_modelo', COALESCE(v.modelo, 'Veículo'),
      'inicio', a.inicio,
      'servico_nome', s.nome
    ) AS obj
    FROM public.agendamentos a
    JOIN public.clientes cl ON cl.id = a.cliente_id
    LEFT JOIN public.veiculos v ON v.id = a.veiculo_id
    JOIN public.servicos s ON s.id = a.servico_id
    WHERE a.tenant_id = v_tenant
      AND a.status = 'agendado'
      AND (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_hoje_sp AND (v_hoje_sp + interval '1 day')::date
    ORDER BY a.inicio ASC
    LIMIT 5
  ) t;

  -- 6. Atendimentos com taxa estimada
  SELECT count(*) INTO v_atendimentos_taxa_estimada_count
  FROM public.recebimentos r
  WHERE r.tenant_id = v_tenant AND r.taxa_estimada = true;

  SELECT COALESCE(jsonb_agg(t.obj), '[]'::jsonb) INTO v_atendimentos_taxa_estimada_lista
  FROM (
    SELECT jsonb_build_object(
      'recebimento_id', r.id,
      'cliente_nome', cl.nome,
      'valor_bruto', r.valor_bruto,
      'created_at', r.created_at
    ) AS obj
    FROM public.recebimentos r
    JOIN public.clientes cl ON cl.id = r.cliente_id
    WHERE r.tenant_id = v_tenant AND r.taxa_estimada = true
    ORDER BY r.created_at DESC
    LIMIT 5
  ) t;


  -----------------------------------------------------------------------------
  -- 4. BLOCO SAÚDE
  -----------------------------------------------------------------------------
  SELECT count(*) INTO v_orcamentos_enviados_mes
  FROM public.orcamentos o
  WHERE o.tenant_id = v_tenant
    AND (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date >= v_primeiro_dia_mes;

  SELECT count(*) INTO v_orcamentos_aprovados_mes
  FROM public.orcamentos o
  WHERE o.tenant_id = v_tenant
    AND o.status = 'aprovado'
    AND (o.updated_at AT TIME ZONE 'America/Sao_Paulo')::date >= v_primeiro_dia_mes;

  IF v_orcamentos_enviados_mes > 0 THEN
    v_taxa_conversao_orcamentos_pct := round((v_orcamentos_aprovados_mes::numeric / v_orcamentos_enviados_mes::numeric) * 100.0, 1);
  END IF;

  IF v_faturado_mes > 0 THEN
    v_margem_media_pct := round((v_lucro_liquido_mes_atual / v_faturado_mes) * 100.0, 1);
  END IF;

  IF v_faturamento_mes_anterior > 0 THEN
    v_comparativo_faturamento_pct := round(((v_faturado_mes - v_faturamento_mes_anterior) / v_faturamento_mes_anterior) * 100.0, 1);
  END IF;

  IF v_ticket_medio_anterior > 0 THEN
    v_comparativo_ticket_pct := round(((v_ticket_medio - v_ticket_medio_anterior) / v_ticket_medio_anterior) * 100.0, 1);
  END IF;


  -----------------------------------------------------------------------------
  -- RETORNO UNIFICADO JSONB
  -----------------------------------------------------------------------------
  RETURN jsonb_build_object(
    'agora', jsonb_build_object(
      'carros_na_oficina', v_carros_na_oficina_count,
      'em_execucao', v_em_execucao_count,
      'aguardando_inicio', v_aguardando_inicio_count,
      'concluidos_hoje', v_concluidos_hoje_count,
      'atrasados_entrega', v_atrasados_entrega_count,
      'pernoite_hoje', v_pernoite_hoje_count,
      'previsao_atraso_lista', v_previsao_atraso_lista
    ),
    'dinheiro', jsonb_build_object(
      'faturado_mes', v_faturado_mes,
      'recebido_mes', v_recebido_mes,
      'faturamento_mes_anterior', v_faturamento_mes_anterior,
      'lucro_liquido_mes_atual', v_lucro_liquido_mes_atual,
      'lucro_liquido_mes_anterior', v_lucro_liquido_mes_anterior,
      'a_receber_pendente', v_a_receber_pendente,
      'vencido_total', v_vencido_total,
      'ticket_medio', v_ticket_medio,
      'meta', v_meta_obj
    ),
    'precisa_de_acao', jsonb_build_object(
      'vistorias_sem_assinatura_count', v_vistorias_sem_assinatura_count,
      'vistorias_sem_assinatura_lista', v_vistorias_sem_assinatura_lista,
      'produtos_estoque_baixo_count', v_produtos_estoque_baixo_count,
      'produtos_estoque_baixo_lista', v_produtos_estoque_baixo_lista,
      'orcamentos_expirando_count', v_orcamentos_expirando_count,
      'orcamentos_expirando_lista', v_orcamentos_expirando_lista,
      'contas_vencidas_count', v_contas_vencidas_count,
      'contas_vencidas_lista', v_contas_vencidas_lista,
      'agendamentos_sem_confirmacao_count', v_agendamentos_sem_confirmacao_count,
      'agendamentos_sem_confirmacao_lista', v_agendamentos_sem_confirmacao_lista,
      'atendimentos_taxa_estimada_count', v_atendimentos_taxa_estimada_count,
      'atendimentos_taxa_estimada_lista', v_atendimentos_taxa_estimada_lista
    ),
    'saude', jsonb_build_object(
      'taxa_conversao_orcamentos_pct', v_taxa_conversao_orcamentos_pct,
      'margem_media_pct', v_margem_media_pct,
      'comparativo_faturamento_pct', v_comparativo_faturamento_pct,
      'comparativo_ticket_pct', v_comparativo_ticket_pct,
      'carros_concluidos_mes_atual', v_carros_concluidos_mes_atual,
      'carros_concluidos_mes_anterior', v_carros_concluidos_mes_anterior
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_dono() TO authenticated;
