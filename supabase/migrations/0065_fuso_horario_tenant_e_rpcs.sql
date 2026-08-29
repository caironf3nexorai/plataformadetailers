-- Migration 0065: Estabilização de Fuso Horário Multi-Tenant (fuso_horario em tenants e refatoração de RPCs temporais)

-- 1. ADICIONAR COLUNA FUSO_HORARIO NA TABELA TENANTS
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS fuso_horario text NOT NULL DEFAULT 'America/Sao_Paulo';

-- 2. FUNÇÃO AUXILIAR OBTER_FUSO_TENANT
CREATE OR REPLACE FUNCTION public.obter_fuso_tenant(p_tenant uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fuso text;
BEGIN
  IF p_tenant IS NULL THEN
    RETURN 'America/Sao_Paulo';
  END IF;

  SELECT coalesce(t.fuso_horario, 'America/Sao_Paulo')
  INTO v_fuso
  FROM public.tenants t
  WHERE t.id = p_tenant;

  RETURN coalesce(v_fuso, 'America/Sao_Paulo');
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_fuso_tenant(uuid) TO anon, authenticated;


-- 3. REFATORAR VERIFICAR_LIMITE COM FUSO HORÁRIO DINÂMICO
DROP FUNCTION IF EXISTS public.verificar_limite(text);
CREATE OR REPLACE FUNCTION public.verificar_limite(p_recurso TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_plano TEXT;
  v_limite INTEGER;
  v_usado INTEGER := 0;
  v_excedido BOOLEAN := false;
  v_bloqueio_ativo BOOLEAN := false;
  v_permitido BOOLEAN := true;
  v_fuso TEXT;
BEGIN
  v_tenant_id := (SELECT public.meus_tenants() LIMIT 1);
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('limite', NULL, 'usado', 0, 'excedido', false, 'permitido', true);
  END IF;

  v_fuso := public.obter_fuso_tenant(v_tenant_id);

  SELECT plano INTO v_plano FROM public.tenants WHERE id = v_tenant_id;
  IF v_plano IS NULL THEN
    v_plano := 'free';
  END IF;

  SELECT bloqueio_planos_ativo INTO v_bloqueio_ativo
  FROM public.plataforma_config
  WHERE id = 1;

  -- 1. Obter limite cadastrado para o plano
  SELECT limite INTO v_limite
  FROM public.plan_limits
  WHERE plano = v_plano AND recurso = p_recurso;

  -- 2. Calcular uso atual (com fuso local do tenant para datas)
  IF p_recurso IN ('atendimentos', 'atendimentos_mes') THEN
    SELECT COUNT(*)::integer INTO v_usado
    FROM public.agendamentos
    WHERE tenant_id = v_tenant_id
      AND date_trunc('month', created_at AT TIME ZONE v_fuso) = date_trunc('month', now() AT TIME ZONE v_fuso);
  ELSIF p_recurso IN ('usuarios', 'membros') THEN
    SELECT COUNT(*)::integer INTO v_usado
    FROM public.tenant_members
    WHERE tenant_id = v_tenant_id AND status = 'ativo';
  ELSIF p_recurso = 'clientes' THEN
    SELECT COUNT(*)::integer INTO v_usado
    FROM public.clientes
    WHERE tenant_id = v_tenant_id;
  ELSIF p_recurso = 'retencao_fotos_execucao_dias' THEN
    v_usado := COALESCE(v_limite, 30);
  END IF;

  -- 3. Avaliar excedido e permitido
  IF v_limite IS NOT NULL AND v_usado >= v_limite THEN
    v_excedido := true;
  ELSE
    v_excedido := false;
  END IF;

  IF COALESCE(v_bloqueio_ativo, false) THEN
    v_permitido := NOT v_excedido;
  ELSE
    v_permitido := true;
  END IF;

  RETURN jsonb_build_object(
    'recurso', p_recurso,
    'plano', v_plano,
    'limite', v_limite,
    'usado', v_usado,
    'excedido', v_excedido,
    'permitido', v_permitido,
    'bloqueio_ativo', COALESCE(v_bloqueio_ativo, false)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verificar_limite(text) TO authenticated;


-- 4. REFATORAR DASHBOARD_DONO COM FUSO HORÁRIO DINÂMICO
CREATE OR REPLACE FUNCTION public.dashboard_dono()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid;
  v_fuso text;
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

  v_fuso := public.obter_fuso_tenant(v_tenant);
  v_agora_sp := now() AT TIME ZONE v_fuso;
  v_hoje_sp := v_agora_sp::date;
  v_primeiro_dia_mes := date_trunc('month', v_hoje_sp)::date;
  v_primeiro_dia_mes_ant := date_trunc('month', v_hoje_sp - interval '1 month')::date;
  v_ultimo_dia_mes_ant := (v_primeiro_dia_mes - interval '1 day')::date;

  -----------------------------------------------------------------------------
  -- 1. BLOCO AGORA
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
  SELECT COALESCE(SUM(e.valor_total_final), 0.00) INTO v_faturado_mes
  FROM public.execucoes e
  WHERE e.tenant_id = v_tenant
    AND e.status = 'finalizado'
    AND (e.finalizado_em AT TIME ZONE v_fuso)::date >= v_primeiro_dia_mes;

  SELECT COALESCE(SUM(r.valor_bruto), 0.00) INTO v_recebido_mes
  FROM public.recebimentos r
  WHERE r.tenant_id = v_tenant
    AND r.status = 'recebido'
    AND (r.recebido_em AT TIME ZONE v_fuso)::date >= v_primeiro_dia_mes;

  SELECT COALESCE(SUM(e.valor_total_final), 0.00) INTO v_faturamento_mes_anterior
  FROM public.execucoes e
  WHERE e.tenant_id = v_tenant
    AND e.status = 'finalizado'
    AND (e.finalizado_em AT TIME ZONE v_fuso)::date BETWEEN v_primeiro_dia_mes_ant AND v_ultimo_dia_mes_ant;

  SELECT COALESCE(SUM(e.lucro_liquido), 0.00) INTO v_lucro_liquido_mes_atual
  FROM public.execucoes e
  WHERE e.tenant_id = v_tenant
    AND e.status = 'finalizado'
    AND (e.finalizado_em AT TIME ZONE v_fuso)::date >= v_primeiro_dia_mes;

  SELECT COALESCE(SUM(e.lucro_liquido), 0.00) INTO v_lucro_liquido_mes_anterior
  FROM public.execucoes e
  WHERE e.tenant_id = v_tenant
    AND e.status = 'finalizado'
    AND (e.finalizado_em AT TIME ZONE v_fuso)::date BETWEEN v_primeiro_dia_mes_ant AND v_ultimo_dia_mes_ant;

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
    AND (e.finalizado_em AT TIME ZONE v_fuso)::date >= v_primeiro_dia_mes;

  SELECT count(*) INTO v_carros_concluidos_mes_anterior
  FROM public.execucoes e
  WHERE e.tenant_id = v_tenant
    AND e.status = 'finalizado'
    AND (e.finalizado_em AT TIME ZONE v_fuso)::date BETWEEN v_primeiro_dia_mes_ant AND v_ultimo_dia_mes_ant;

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
      'cliente_nome', cl.nome,
      'valor_total', COALESCE(
        (SELECT n.valor_total FROM public.orcamento_niveis n WHERE n.orcamento_id = o.id ORDER BY n.valor_total DESC LIMIT 1),
        0.00
      ),
      'data_validade_limite', ((o.enviado_em AT TIME ZONE v_fuso)::date + COALESCE(o.validade_dias, 7))
    ) AS obj
    FROM public.orcamentos o
    JOIN public.clientes cl ON cl.id = o.cliente_id
    WHERE o.tenant_id = v_tenant
      AND o.status = 'enviado'
      AND o.enviado_em IS NOT NULL
      AND ((o.enviado_em AT TIME ZONE v_fuso)::date + COALESCE(o.validade_dias, 7)) BETWEEN v_hoje_sp AND (v_hoje_sp + interval '3 days')::date
    ORDER BY ((o.enviado_em AT TIME ZONE v_fuso)::date + COALESCE(o.validade_dias, 7)) ASC
    LIMIT 5
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
    LIMIT 5
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
      'servico_nome', s.nome
    ) AS obj
    FROM public.agendamentos a
    JOIN public.clientes cl ON cl.id = a.cliente_id
    LEFT JOIN public.veiculos v ON v.id = a.veiculo_id
    JOIN public.servicos s ON s.id = a.servico_id
    WHERE a.tenant_id = v_tenant
      AND a.status = 'agendado'
      AND (a.inicio AT TIME ZONE v_fuso)::date BETWEEN v_hoje_sp AND (v_hoje_sp + interval '1 day')::date
    ORDER BY a.inicio ASC
    LIMIT 5
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
    LIMIT 5
  ) t;

  -----------------------------------------------------------------------------
  -- 4. BLOCO SAÚDE
  -----------------------------------------------------------------------------
  SELECT count(*) INTO v_orcamentos_enviados_mes
  FROM public.orcamentos o
  WHERE o.tenant_id = v_tenant
    AND (o.created_at AT TIME ZONE v_fuso)::date >= v_primeiro_dia_mes;

  SELECT count(*) INTO v_orcamentos_aprovados_mes
  FROM public.orcamentos o
  WHERE o.tenant_id = v_tenant
    AND o.status = 'aprovado'
    AND (o.updated_at AT TIME ZONE v_fuso)::date >= v_primeiro_dia_mes;

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


-- 5. REFATORAR OBTER_CONTAS_A_RECEBER COM FUSO HORÁRIO DINÂMICO
CREATE OR REPLACE FUNCTION public.obter_contas_a_receber(
  p_inicio date DEFAULT NULL,
  p_fim date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid;
  v_fuso text;
  v_hoje date;
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

  v_fuso := public.obter_fuso_tenant(v_tenant);
  v_hoje := (now() AT TIME ZONE v_fuso)::date;

  SELECT COALESCE(SUM(valor_bruto), 0.00) INTO v_a_receber_mes
  FROM public.recebimentos
  WHERE tenant_id = v_tenant AND status = 'previsto' AND date_trunc('month', previsto_para) = date_trunc('month', v_hoje);

  SELECT COALESCE(SUM(valor_bruto), 0.00) INTO v_vencido
  FROM public.recebimentos
  WHERE tenant_id = v_tenant AND status = 'previsto' AND previsto_para < v_hoje;

  SELECT COALESCE(SUM(valor_bruto), 0.00) INTO v_recebido_mes
  FROM public.recebimentos
  WHERE tenant_id = v_tenant AND status = 'recebido' AND date_trunc('month', (recebido_em AT TIME ZONE v_fuso)::date) = date_trunc('month', v_hoje);

  SELECT COALESCE(SUM(valor_bruto), 0.00) INTO v_faturamento_taxa_estimada_mes
  FROM public.recebimentos
  WHERE tenant_id = v_tenant AND taxa_estimada = true AND date_trunc('month', (created_at AT TIME ZONE v_fuso)::date) = date_trunc('month', v_hoje);

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
      'dias_atraso', GREATEST(0, (v_hoje - r.previsto_para)),
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


-- 6. REFATORAR HORAS_DISPONIVEIS_MES COM FUSO HORÁRIO DINÂMICO
CREATE OR REPLACE FUNCTION public.horas_disponiveis_mes(
  p_tenant uuid,
  p_mes date
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_fuso text := public.obter_fuso_tenant(p_tenant);
  v_inicio_mes date := date_trunc('month', p_mes)::date;
  v_fim_mes date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_curr date;
  v_dow integer;
  v_horario record;
  v_janela_inicio timestamptz;
  v_janela_fim timestamptz;
  v_janela_segundos numeric;
  v_bloqueio_segundos numeric;
  v_liquido_segundos numeric;
  v_horas_dia numeric := 0;
  v_total_horas numeric := 0;
BEGIN
  PERFORM public.obter_ou_gerar_despesas_mes(p_tenant, p_mes);
  v_curr := v_inicio_mes;
  WHILE v_curr <= v_fim_mes LOOP
    v_dow := extract(dow from v_curr)::integer;

    SELECT hf.ativo, hf.abre, hf.fecha, hf.capacidade
    INTO v_horario
    FROM public.horarios_funcionamento hf
    WHERE hf.tenant_id = p_tenant AND hf.dia_semana = v_dow;

    IF v_horario.ativo = true AND v_horario.abre IS NOT NULL AND v_horario.fecha IS NOT NULL THEN
      v_janela_inicio := (v_curr || ' ' || v_horario.abre)::timestamp AT TIME ZONE v_fuso;
      v_janela_fim := (v_curr || ' ' || v_horario.fecha)::timestamp AT TIME ZONE v_fuso;

      IF v_janela_fim > v_janela_inicio THEN
        v_janela_segundos := extract(epoch from (v_janela_fim - v_janela_inicio));

        SELECT coalesce(sum(
          extract(epoch from (
            least(ba.fim, v_janela_fim) - greatest(ba.inicio, v_janela_inicio)
          ))
        ), 0)
        INTO v_bloqueio_segundos
        FROM public.bloqueios_agenda ba
        WHERE ba.tenant_id = p_tenant
          AND ba.inicio < v_janela_fim
          AND ba.fim > v_janela_inicio;

        v_liquido_segundos := greatest(0, v_janela_segundos - v_bloqueio_segundos);
        v_horas_dia := (v_liquido_segundos / 3600.0) * coalesce(v_horario.capacidade, 1);
        v_total_horas := v_total_horas + v_horas_dia;
      END IF;
    END IF;

    v_curr := v_curr + 1;
  END LOOP;

  RETURN round(v_total_horas, 2);
END;
$$;


-- 7. REFATORAR HORARIOS_DISPONIVEIS COM FUSO HORÁRIO DINÂMICO
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
    AND a.status NOT IN ('cancelado', 'nao_compareceu')
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
          AND a.status NOT IN ('cancelado', 'nao_compareceu')
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
        AND a.status NOT IN ('cancelado', 'nao_compareceu')
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


-- 8. REFATORAR REAGENDAR E CRIAR_AGENDAMENTO COM FUSO HORÁRIO DINÂMICO
CREATE OR REPLACE FUNCTION public.reagendar(
  p_agendamento uuid,
  p_novo_inicio timestamptz
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_agendamento record;
  v_fuso text;
  v_data date;
  v_hora time;
  v_is_valido boolean := false;
  v_itens_json jsonb;
BEGIN
  SELECT * INTO v_agendamento FROM public.agendamentos WHERE id = p_agendamento;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado.';
  END IF;

  IF NOT public.tem_papel(v_agendamento.tenant_id, ARRAY['dono', 'gerente']::app_role[]) THEN
    RAISE EXCEPTION 'Apenas donos ou gerentes podem reagendar.';
  END IF;

  v_fuso := public.obter_fuso_tenant(v_agendamento.tenant_id);
  v_data := (p_novo_inicio AT TIME ZONE v_fuso)::date;
  v_hora := date_trunc('minute', (p_novo_inicio AT TIME ZONE v_fuso))::time;

  PERFORM pg_advisory_xact_lock(hashtext(v_agendamento.tenant_id::text || ':' || v_data::text));

  SELECT coalesce(
    jsonb_agg(jsonb_build_object('servico_id', servico_id, 'combo_id', combo_id)),
    '[]'::jsonb
  )
  INTO v_itens_json
  FROM public.agendamento_itens
  WHERE agendamento_id = p_agendamento;

  IF (v_itens_json IS NULL OR jsonb_array_length(v_itens_json) = 0) AND v_agendamento.servico_id IS NOT NULL THEN
    v_itens_json := jsonb_build_array(jsonb_build_object('servico_id', v_agendamento.servico_id));
  END IF;

  SELECT disponivel INTO v_is_valido
  FROM public.horarios_disponiveis(
    v_agendamento.tenant_id,
    v_data,
    v_itens_json,
    v_agendamento.categoria_id,
    p_agendamento
  ) hd
  WHERE hd.horario = v_hora;

  IF NOT coalesce(v_is_valido, false) THEN
    RAISE EXCEPTION 'Este horário não está disponível na agenda. Escolha outro horário.';
  END IF;

  UPDATE public.agendamentos
  SET inicio = p_novo_inicio,
      updated_at = now()
  WHERE id = p_agendamento;

  PERFORM public.recalcular_agendamento_totais(p_agendamento);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reagendar(uuid, timestamptz) TO authenticated;


CREATE OR REPLACE FUNCTION public.criar_agendamento(
  p_cliente uuid,
  p_veiculo uuid,
  p_itens jsonb,
  p_categoria uuid,
  p_inicio timestamptz,
  p_observacoes text DEFAULT NULL,
  p_forcado boolean DEFAULT FALSE
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
  v_modo text := 'slot';
  v_dias integer := 1;
  v_preco numeric(10,2);
  v_ordem smallint := 0;
  v_member_id uuid;
  v_servico_principal uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.clientes WHERE id = p_cliente;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não encontrado.';
  END IF;

  IF NOT (v_tenant IN (SELECT meus_tenants())) OR NOT public.tem_papel(v_tenant, ARRAY['dono', 'gerente']::app_role[]) THEN
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

  INSERT INTO public.agendamentos (
    tenant_id, cliente_id, veiculo_id, servico_id, categoria_id,
    inicio, status, origem, observacoes, criado_por, forcado, forcado_por,
    modo_ocupacao, modo_ocupacao_efetivo, dias_ocupados
  ) VALUES (
    v_tenant, p_cliente, p_veiculo, v_servico_principal, p_categoria,
    p_inicio, 'agendado', 'interno', p_observacoes, auth.uid(),
    p_forcado, CASE WHEN p_forcado THEN v_member_id ELSE NULL END,
    coalesce(v_modo, 'slot'), coalesce(v_modo, 'slot'), coalesce(v_dias, 1)
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


-- 9. NOTIFICAÇÃO AO POSTGREST PARA RECARREGAR O SCHEMA
NOTIFY pgrst, 'reload schema';
