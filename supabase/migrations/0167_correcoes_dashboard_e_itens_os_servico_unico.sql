-- ==============================================================================
-- MIGRAÇÃO 0167: CORREÇÕES COMPLEMENTARES PARA DASHBOARD E ITENS DE OS
-- Aplicável de forma incremental após a 0166:
-- 1. public.dashboard_dono:
--    - Inclui orçamentos sem cliente vinculado (cliente_nome_avulso) na lista de
--      orçamentos a vencer via LEFT JOIN em public.clientes.
--    - Preenche servico_nome com fallback em agendamento_itens (servico_nome)
--      para OS criadas somente com Serviço Único nas listas de atraso e
--      agendamentos sem confirmação.
-- 2. public.adicionar_item_agendamento:
--    - Inclui 'duracao_minutos' no JSON enviado a horarios_disponiveis para
--      considerar a duração real de Serviços Únicos já presentes na OS.
--    - Popula servico_nome ao inserir/atualizar em agendamento_itens e usa
--      o fuso horário configurado da oficina via obter_fuso_tenant.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. RPC DASHBOARD_DONO
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.dashboard_dono();
DROP FUNCTION IF EXISTS public.dashboard_dono(text);

CREATE OR REPLACE FUNCTION public.dashboard_dono(p_periodo text DEFAULT 'este_mes')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_tenant uuid;
  v_fuso text;
  v_agora_sp timestamptz;
  v_hoje_sp date;
  v_primeiro_dia_mes date;
  v_primeiro_dia_mes_ant date;
  v_ultimo_dia_mes_ant date;

  -- Datas do intervalo selecionado
  v_inicio_periodo date;
  v_fim_periodo date;
  v_inicio_ant date;
  v_fim_ant date;

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
  IF v_tenant IS NULL THEN
    IF public.is_platform_admin() THEN
      SELECT id INTO v_tenant FROM public.tenants LIMIT 1;
    END IF;
  END IF;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Nenhuma oficina ativa identificada.';
  END IF;

  v_fuso := public.obter_fuso_tenant(v_tenant);
  v_agora_sp := now() AT TIME ZONE v_fuso;
  v_hoje_sp := v_agora_sp::date;
  v_primeiro_dia_mes := date_trunc('month', v_hoje_sp)::date;
  v_primeiro_dia_mes_ant := date_trunc('month', v_hoje_sp - interval '1 month')::date;
  v_ultimo_dia_mes_ant := (v_primeiro_dia_mes - interval '1 day')::date;

  -- Determinação do intervalo do filtro selecionado
  IF p_periodo = 'hoje' THEN
    v_inicio_periodo := v_hoje_sp;
    v_fim_periodo := v_hoje_sp;
    v_inicio_ant := (v_hoje_sp - interval '1 day')::date;
    v_fim_ant := (v_hoje_sp - interval '1 day')::date;
  ELSIF p_periodo = '7dias' THEN
    v_inicio_periodo := (v_hoje_sp - interval '6 days')::date;
    v_fim_periodo := v_hoje_sp;
    v_inicio_ant := (v_hoje_sp - interval '13 days')::date;
    v_fim_ant := (v_hoje_sp - interval '7 days')::date;
  ELSIF p_periodo = '30dias' THEN
    v_inicio_periodo := (v_hoje_sp - interval '29 days')::date;
    v_fim_periodo := v_hoje_sp;
    v_inicio_ant := (v_hoje_sp - interval '59 days')::date;
    v_fim_ant := (v_hoje_sp - interval '30 days')::date;
  ELSIF p_periodo = 'mes_passado' THEN
    v_inicio_periodo := v_primeiro_dia_mes_ant;
    v_fim_periodo := v_ultimo_dia_mes_ant;
    v_inicio_ant := date_trunc('month', v_primeiro_dia_mes_ant - interval '1 month')::date;
    v_fim_ant := (v_primeiro_dia_mes_ant - interval '1 day')::date;
  ELSE -- 'este_mes'
    v_inicio_periodo := v_primeiro_dia_mes;
    v_fim_periodo := v_hoje_sp;
    v_inicio_ant := v_primeiro_dia_mes_ant;
    v_fim_ant := v_ultimo_dia_mes_ant;
  END IF;

  -----------------------------------------------------------------------------
  -- 1. BLOCO AGORA (Sempre reflete o momento atual ao vivo da oficina)
  -----------------------------------------------------------------------------
  SELECT count(*) INTO v_em_execucao_count
  FROM public.execucoes e
  WHERE e.tenant_id = v_tenant AND e.status IN ('em_andamento', 'pausado');

  SELECT count(*) INTO v_aguardando_inicio_count
  FROM public.agendamentos a
  WHERE a.tenant_id = v_tenant
    AND a.status IN ('agendado', 'confirmado')
    AND (a.inicio AT TIME ZONE v_fuso)::date = v_hoje_sp
    AND NOT EXISTS (SELECT 1 FROM public.execucoes e WHERE e.agendamento_id = a.id);

  SELECT count(*) INTO v_concluidos_hoje_count
  FROM public.agendamentos a
  WHERE a.tenant_id = v_tenant
    AND a.status = 'concluido'
    AND ((a.updated_at AT TIME ZONE v_fuso)::date = v_hoje_sp
         OR EXISTS (SELECT 1 FROM public.execucoes e WHERE e.agendamento_id = a.id AND (e.finalizado_em AT TIME ZONE v_fuso)::date = v_hoje_sp));

  SELECT count(*) INTO v_pernoite_hoje_count
  FROM public.agendamentos a
  WHERE a.tenant_id = v_tenant
    AND a.status IN ('agendado', 'confirmado', 'em_andamento')
    AND (a.inicio AT TIME ZONE v_fuso)::date <= v_hoje_sp
    AND ((a.inicio AT TIME ZONE v_fuso)::date + COALESCE(a.dias_ocupados, 1) - 1) > v_hoje_sp;

  v_carros_na_oficina_count := v_em_execucao_count + v_aguardando_inicio_count;

  SELECT count(*) INTO v_atrasados_entrega_count
  FROM public.agendamentos a
  WHERE a.tenant_id = v_tenant
    AND a.status IN ('agendado', 'confirmado', 'em_andamento')
    AND a.previsao_entrega IS NOT NULL
    AND a.previsao_entrega < now();

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'agendamento_id', a.id,
      'cliente_nome', c.nome,
      'veiculo_modelo', COALESCE(v.modelo, 'Veículo'),
      'veiculo_placa', COALESCE(v.placa, ''),
      'servico_nome', COALESCE(
        (
          SELECT string_agg(COALESCE(s2.nome, ai.servico_nome, 'Serviço'), ', ' ORDER BY ai.ordem ASC, ai.created_at ASC)
          FROM public.agendamento_itens ai
          LEFT JOIN public.servicos s2 ON s2.id = ai.servico_id
          WHERE ai.agendamento_id = a.id
        ),
        s.nome,
        'Serviço Único'
      ),
      'previsao_entrega', a.previsao_entrega,
      'minutos_atraso', FLOOR(EXTRACT(EPOCH FROM (now() - a.previsao_entrega)) / 60)
    ) ORDER BY a.previsao_entrega ASC
  ), '[]'::jsonb) INTO v_previsao_atraso_lista
  FROM public.agendamentos a
  JOIN public.clientes c ON c.id = a.cliente_id
  LEFT JOIN public.veiculos v ON v.id = a.veiculo_id
  LEFT JOIN public.servicos s ON s.id = a.servico_id
  WHERE a.tenant_id = v_tenant
    AND a.status IN ('agendado', 'confirmado', 'em_andamento')
    AND a.previsao_entrega IS NOT NULL
    AND a.previsao_entrega < now();

  -----------------------------------------------------------------------------
  -- 2. BLOCO DINHEIRO (Filtrado pelo período selecionado)
  -----------------------------------------------------------------------------
  SELECT COALESCE(SUM(e.valor_total_final), 0.00) INTO v_faturado_mes
  FROM public.execucoes e
  WHERE e.tenant_id = v_tenant
    AND e.status = 'finalizado'
    AND (e.finalizado_em AT TIME ZONE v_fuso)::date BETWEEN v_inicio_periodo AND v_fim_periodo;

  SELECT COALESCE(SUM(r.valor_bruto), 0.00) INTO v_recebido_mes
  FROM public.recebimentos r
  WHERE r.tenant_id = v_tenant
    AND r.status = 'recebido'
    AND (r.recebido_em AT TIME ZONE v_fuso)::date BETWEEN v_inicio_periodo AND v_fim_periodo;

  SELECT COALESCE(SUM(e.valor_total_final), 0.00) INTO v_faturamento_mes_anterior
  FROM public.execucoes e
  WHERE e.tenant_id = v_tenant
    AND e.status = 'finalizado'
    AND (e.finalizado_em AT TIME ZONE v_fuso)::date BETWEEN v_inicio_ant AND v_fim_ant;

  SELECT COALESCE(SUM(e.lucro_liquido), 0.00) INTO v_lucro_liquido_mes_atual
  FROM public.execucoes e
  WHERE e.tenant_id = v_tenant
    AND e.status = 'finalizado'
    AND (e.finalizado_em AT TIME ZONE v_fuso)::date BETWEEN v_inicio_periodo AND v_fim_periodo;

  SELECT COALESCE(SUM(e.lucro_liquido), 0.00) INTO v_lucro_liquido_mes_anterior
  FROM public.execucoes e
  WHERE e.tenant_id = v_tenant
    AND e.status = 'finalizado'
    AND (e.finalizado_em AT TIME ZONE v_fuso)::date BETWEEN v_inicio_ant AND v_fim_ant;

  SELECT COALESCE(SUM(r.valor_bruto), 0.00) INTO v_a_receber_pendente
  FROM public.recebimentos r
  WHERE r.tenant_id = v_tenant AND r.status = 'previsto';

  SELECT COALESCE(SUM(r.valor_bruto), 0.00) INTO v_vencido_total
  FROM public.recebimentos r
  WHERE r.tenant_id = v_tenant AND r.status = 'previsto' AND r.previsto_para < v_hoje_sp;

  SELECT count(*) INTO v_carros_concluidos_mes_atual
  FROM public.execucoes e
  WHERE e.tenant_id = v_tenant
    AND e.status = 'finalizado'
    AND (e.finalizado_em AT TIME ZONE v_fuso)::date BETWEEN v_inicio_periodo AND v_fim_periodo;

  SELECT count(*) INTO v_carros_concluidos_mes_anterior
  FROM public.execucoes e
  WHERE e.tenant_id = v_tenant
    AND e.status = 'finalizado'
    AND (e.finalizado_em AT TIME ZONE v_fuso)::date BETWEEN v_inicio_ant AND v_fim_ant;

  IF v_carros_concluidos_mes_atual > 0 THEN
    v_ticket_medio := round((v_faturado_mes / v_carros_concluidos_mes_atual::numeric), 2);
  END IF;

  IF v_carros_concluidos_mes_anterior > 0 THEN
    v_ticket_medio_anterior := round((v_faturamento_mes_anterior / v_carros_concluidos_mes_anterior::numeric), 2);
  END IF;

  -- Meta Mensal
  SELECT * INTO v_meta_rec
  FROM public.tenant_metas tm
  WHERE tm.tenant_id = v_tenant AND tm.mes = date_trunc('month', v_inicio_periodo)::date;

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
      'veiculo_placa', COALESCE(v.placa, ''),
      'created_at', c.created_at
    ) AS obj
    FROM public.checkins c
    JOIN public.agendamentos a ON a.id = c.agendamento_id
    JOIN public.clientes cl ON cl.id = a.cliente_id
    LEFT JOIN public.veiculos v ON v.id = a.veiculo_id
    WHERE c.tenant_id = v_tenant AND (c.finalizado = false OR c.assinado_em IS NULL OR c.assinatura_path IS NULL)
    ORDER BY c.created_at DESC
    LIMIT 20
  ) t;

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
    LIMIT 20
  ) t;

  SELECT count(*) INTO v_orcamentos_expirando_count
  FROM public.orcamentos o
  WHERE o.tenant_id = v_tenant
    AND o.status = 'enviado'
    AND o.enviado_em IS NOT NULL
    AND ((o.enviado_em AT TIME ZONE v_fuso)::date + COALESCE(o.validade_dias, 7)) BETWEEN v_hoje_sp AND (v_hoje_sp + interval '3 days')::date;

  SELECT COALESCE(jsonb_agg(t.obj), '[]'::jsonb) INTO v_orcamentos_expirando_lista
  FROM (
    SELECT jsonb_build_object(
      'orcamento_id', o.id,
      'numero_os', o.numero_os,
      'cliente_nome', COALESCE(cl.nome, NULLIF(trim(o.cliente_nome_avulso), ''), 'Cliente não vinculado'),
      'valor_total', COALESCE(
        (SELECT n.valor_total FROM public.orcamento_niveis n WHERE n.orcamento_id = o.id ORDER BY n.valor_total DESC LIMIT 1),
        0.00
      ),
      'data_validade_limite', ((o.enviado_em AT TIME ZONE v_fuso)::date + COALESCE(o.validade_dias, 7))
    ) AS obj
    FROM public.orcamentos o
    LEFT JOIN public.clientes cl ON cl.id = o.cliente_id
    WHERE o.tenant_id = v_tenant
      AND o.status = 'enviado'
      AND o.enviado_em IS NOT NULL
      AND ((o.enviado_em AT TIME ZONE v_fuso)::date + COALESCE(o.validade_dias, 7)) BETWEEN v_hoje_sp AND (v_hoje_sp + interval '3 days')::date
    ORDER BY ((o.enviado_em AT TIME ZONE v_fuso)::date + COALESCE(o.validade_dias, 7)) ASC
    LIMIT 20
  ) t;

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
    LIMIT 20
  ) t;

  SELECT count(*) INTO v_agendamentos_sem_confirmacao_count
  FROM public.agendamentos a
  WHERE a.tenant_id = v_tenant
    AND a.status = 'agendado'
    AND (a.inicio AT TIME ZONE v_fuso)::date BETWEEN v_hoje_sp AND (v_hoje_sp + interval '1 day')::date;

  SELECT COALESCE(jsonb_agg(t.obj), '[]'::jsonb) INTO v_agendamentos_sem_confirmacao_lista
  FROM (
    SELECT jsonb_build_object(
      'agendamento_id', a.id,
      'cliente_nome', cl.nome,
      'veiculo_modelo', COALESCE(v.modelo, 'Veículo'),
      'inicio', a.inicio,
      'servico_nome', COALESCE(
        (
          SELECT string_agg(COALESCE(s2.nome, ai.servico_nome, 'Serviço'), ', ' ORDER BY ai.ordem ASC, ai.created_at ASC)
          FROM public.agendamento_itens ai
          LEFT JOIN public.servicos s2 ON s2.id = ai.servico_id
          WHERE ai.agendamento_id = a.id
        ),
        s.nome,
        'Serviço Único'
      )
    ) AS obj
    FROM public.agendamentos a
    JOIN public.clientes cl ON cl.id = a.cliente_id
    LEFT JOIN public.veiculos v ON v.id = a.veiculo_id
    LEFT JOIN public.servicos s ON s.id = a.servico_id
    WHERE a.tenant_id = v_tenant
      AND a.status = 'agendado'
      AND (a.inicio AT TIME ZONE v_fuso)::date BETWEEN v_hoje_sp AND (v_hoje_sp + interval '1 day')::date
    ORDER BY a.inicio ASC
    LIMIT 20
  ) t;

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
    LIMIT 20
  ) t;

  -----------------------------------------------------------------------------
  -- 4. BLOCO SAÚDE (Filtrado pelo período selecionado)
  -----------------------------------------------------------------------------
  SELECT count(*) INTO v_orcamentos_enviados_mes
  FROM public.orcamentos o
  WHERE o.tenant_id = v_tenant
    AND (o.created_at AT TIME ZONE v_fuso)::date BETWEEN v_inicio_periodo AND v_fim_periodo;

  SELECT count(*) INTO v_orcamentos_aprovados_mes
  FROM public.orcamentos o
  WHERE o.tenant_id = v_tenant
    AND o.status = 'aprovado'
    AND (o.updated_at AT TIME ZONE v_fuso)::date BETWEEN v_inicio_periodo AND v_fim_periodo;

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

GRANT EXECUTE ON FUNCTION public.dashboard_dono(text) TO authenticated;

-- ------------------------------------------------------------------------------
-- 2. RPC ADICIONAR_ITEM_AGENDAMENTO
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.adicionar_item_agendamento(uuid, uuid);
DROP FUNCTION IF EXISTS public.adicionar_item_agendamento(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.adicionar_item_agendamento(uuid, uuid, uuid, boolean);

CREATE OR REPLACE FUNCTION public.adicionar_item_agendamento(
  p_agendamento uuid,
  p_servico uuid,
  p_combo uuid DEFAULT null,
  p_forcar boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_agendamento record;
  v_fuso text;
  v_data date;
  v_hora time;
  v_itens_atuais jsonb;
  v_novos_itens jsonb;
  v_duracao_item integer;
  v_modo_item text;
  v_dias_item integer;
  v_preco_item numeric(10,2);
  v_is_valido boolean := false;
  v_novos_minutos integer;
  v_termino_previsto text;
  v_servico_nome text;
  v_execucao record;
  v_categoria_id uuid;
BEGIN
  SELECT * INTO v_agendamento FROM public.agendamentos WHERE id = p_agendamento;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado.'; END IF;

  IF NOT public.tem_papel(v_agendamento.tenant_id, ARRAY['dono', 'gerente']::app_role[]) THEN
    RAISE EXCEPTION 'Apenas donos ou gerentes podem alterar serviços do agendamento.';
  END IF;

  v_fuso := coalesce(public.obter_fuso_tenant(v_agendamento.tenant_id), 'America/Sao_Paulo');

  -- Se o agendamento já está em andamento/concluído ou se p_forcar = true, NÃO bloqueia por horário de fechamento
  IF v_agendamento.status NOT IN ('em_andamento', 'concluido') AND NOT coalesce(p_forcar, false) THEN
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
    INTO v_itens_atuais
    FROM public.agendamento_itens WHERE agendamento_id = p_agendamento;

    v_novos_itens := v_itens_atuais || jsonb_build_array(jsonb_build_object('servico_id', p_servico, 'combo_id', p_combo));

    v_data := (v_agendamento.inicio AT TIME ZONE v_fuso)::date;
    v_hora := date_trunc('minute', (v_agendamento.inicio AT TIME ZONE v_fuso))::time;

    PERFORM pg_advisory_xact_lock(hashtext(v_agendamento.tenant_id::text || ':' || v_data::text));

    SELECT disponivel INTO v_is_valido
    FROM public.horarios_disponiveis(v_agendamento.tenant_id, v_data, v_novos_itens, v_agendamento.categoria_id, p_agendamento) hd
    WHERE hd.horario = v_hora;

    IF NOT coalesce(v_is_valido, false) THEN
      SELECT coalesce(sum(duracao_minutos), 0) INTO v_novos_minutos
      FROM (
        SELECT duracao_minutos FROM public.agendamento_itens WHERE agendamento_id = p_agendamento
        UNION ALL
        SELECT coalesce(sp.duracao_minutos, s.duracao_minutos, 60)
        FROM public.servicos s
        LEFT JOIN public.servico_precos sp ON sp.servico_id = s.id AND sp.categoria_id = v_agendamento.categoria_id AND sp.ativo
        WHERE s.id = p_servico
      ) sub;

      v_termino_previsto := to_char((v_agendamento.inicio + (v_novos_minutos || ' minutes')::interval) AT TIME ZONE v_fuso, 'HH24:MI');

      RAISE EXCEPTION 'O atendimento passaria a terminar às %, depois do fechamento. Reagende ou remova um serviço.', v_termino_previsto;
    END IF;
  END IF;

  v_categoria_id := v_agendamento.categoria_id;

  SELECT
    s.nome,
    coalesce(sp.duracao_minutos, s.duracao_minutos, 60),
    coalesce(s.modo_ocupacao, 'slot'),
    coalesce(s.dias_ocupados, 1),
    sp.preco_base
  INTO v_servico_nome, v_duracao_item, v_modo_item, v_dias_item, v_preco_item
  FROM public.servicos s
  LEFT JOIN public.servico_precos sp
    ON sp.servico_id = s.id
   AND sp.categoria_id = v_categoria_id
   AND sp.ativo
  WHERE s.id = p_servico AND s.tenant_id = v_agendamento.tenant_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Serviço não encontrado.'; END IF;

  -- Fallback de preço se a categoria do veículo não tiver preço específico ativo
  IF v_preco_item IS NULL THEN
    SELECT coalesce(preco_base, 0), coalesce(duracao_minutos, v_duracao_item)
    INTO v_preco_item, v_duracao_item
    FROM public.servico_precos
    WHERE servico_id = p_servico AND tenant_id = v_agendamento.tenant_id AND ativo
    ORDER BY preco_base DESC
    LIMIT 1;
  END IF;
  v_preco_item := coalesce(v_preco_item, 0);

  -- Insere o item na tabela agendamento_itens (mantendo servico_nome preenchido)
  INSERT INTO public.agendamento_itens (
    tenant_id, agendamento_id, servico_id, combo_id, servico_nome,
    duracao_minutos, preco_estimado, modo_ocupacao, dias_ocupados, ordem
  ) VALUES (
    v_agendamento.tenant_id, p_agendamento, p_servico, p_combo, v_servico_nome,
    v_duracao_item, v_preco_item, v_modo_item, v_dias_item, 99
  )
  ON CONFLICT (agendamento_id, servico_id) DO UPDATE
  SET servico_nome = excluded.servico_nome,
      duracao_minutos = excluded.duracao_minutos,
      preco_estimado = excluded.preco_estimado;

  -- Se já houver execução aberta/em andamento, sincroniza também em execucao_itens
  SELECT * INTO v_execucao FROM public.execucoes WHERE agendamento_id = p_agendamento ORDER BY created_at DESC LIMIT 1;
  IF FOUND AND v_execucao.id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.execucao_itens
      WHERE execucao_id = v_execucao.id AND servico_nome = v_servico_nome
    ) THEN
      INSERT INTO public.execucao_itens (
        tenant_id,
        execucao_id,
        servico_nome,
        descricao,
        obrigatorio,
        ordem,
        concluido
      ) VALUES (
        v_agendamento.tenant_id,
        v_execucao.id,
        v_servico_nome,
        'Item adicionado via gestão do atendimento',
        true,
        99,
        false
      );
    END IF;
  END IF;

  -- Recalcula totais do agendamento
  PERFORM public.recalcular_agendamento_totais(p_agendamento);
END;
$$;

GRANT EXECUTE ON FUNCTION public.adicionar_item_agendamento(uuid, uuid, uuid, boolean) TO authenticated;

-- Atualiza schema cache do PostgREST
NOTIFY pgrst, 'reload schema';
