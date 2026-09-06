-- ==============================================================================
-- MIGRAÇÃO 0094: AJUSTES DA PLATAFORMA (INDICAÇÕES, DASHBOARD, AGENDA E ASSINATURA)
-- ==============================================================================

-- 1. RPC ADMIN_LISTAR_TODAS_INDICACOES (Para o painel AdminIndicacoes)
CREATE OR REPLACE FUNCTION public.admin_listar_todas_indicacoes()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso restrito a administradores da plataforma.';
  END IF;

  RETURN (
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'id', i.id,
        'codigo', i.codigo,
        'status', i.status,
        'motivo_invalidacao', i.motivo_invalidacao,
        'created_at', i.created_at,
        'indicador', CASE WHEN t_ind.id IS NOT NULL THEN jsonb_build_object('id', t_ind.id, 'nome', t_ind.nome) ELSE null END,
        'indicado', CASE WHEN t_indicado.id IS NOT NULL THEN jsonb_build_object('id', t_indicado.id, 'nome', t_indicado.nome) ELSE null END
      ) ORDER BY i.created_at DESC
    ), '[]'::jsonb)
    FROM public.indicacoes i
    LEFT JOIN public.tenants t_ind ON t_ind.id = i.indicador_tenant_id
    LEFT JOIN public.tenants t_indicado ON t_indicado.id = i.indicado_tenant_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_listar_todas_indicacoes() TO authenticated;


-- 2. WRAPPER OBTER_RESUMO_ASSINATURA_TENANT
CREATE OR REPLACE FUNCTION public.obter_resumo_assinatura_tenant()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.obter_assinatura_tenant();
$$;

GRANT EXECUTE ON FUNCTION public.obter_resumo_assinatura_tenant() TO authenticated;


-- 3. RPC BUSCAR_AGENDAMENTOS (9 Parâmetros canônicos com suporte a busca e paginação)
CREATE OR REPLACE FUNCTION public.buscar_agendamentos(
  p_tenant uuid,
  p_inicio date default null,
  p_fim date default null,
  p_status text[] default null,
  p_busca text default null,
  p_cliente_id uuid default null,
  p_veiculo_id uuid default null,
  p_limite integer default 30,
  p_offset integer default 0
) RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  cliente_id uuid,
  veiculo_id uuid,
  servico_id uuid,
  categoria_id uuid,
  inicio timestamptz,
  duracao_minutos integer,
  duracao_total integer,
  modo_ocupacao text,
  modo_ocupacao_efetivo text,
  dias_ocupados smallint,
  preco_estimado numeric,
  preco_estimado_total numeric,
  status text,
  origem text,
  observacoes text,
  numero_os integer,
  forcado boolean,
  created_at timestamptz,
  updated_at timestamptz,
  cliente jsonb,
  veiculo jsonb,
  servico jsonb,
  categoria jsonb,
  agendamento_itens jsonb,
  execucao jsonb,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
#variable_conflict use_column
DECLARE
  v_busca_limpa text;
  v_busca_num integer := null;
  v_dono_inicio date := null;
  v_dono_fim date := null;
  v_target_cliente uuid := p_cliente_id;
BEGIN
  -- Valida se o usuário logado é membro ativo do tenant ou admin da plataforma
  IF NOT (p_tenant IN (SELECT public.meus_tenants())) AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  -- Trata busca textual e extrai números para comparar com numero_os
  IF p_busca IS NOT NULL AND trim(p_busca) <> '' THEN
    v_busca_limpa := trim(p_busca);
    BEGIN
      IF regexp_replace(lower(v_busca_limpa), '[^0-9]', '', 'g') <> '' THEN
        v_busca_num := (regexp_replace(lower(v_busca_limpa), '[^0-9]', '', 'g'))::integer;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_busca_num := null;
    END;
  END IF;

  -- Se p_veiculo_id for fornecido, descobre o período de propriedade
  IF p_veiculo_id IS NOT NULL THEN
    IF v_target_cliente IS NULL THEN
      SELECT vd.cliente_id, vd.inicio, vd.fim
      INTO v_target_cliente, v_dono_inicio, v_dono_fim
      FROM public.veiculo_donos vd
      WHERE vd.veiculo_id = p_veiculo_id
      ORDER BY CASE WHEN vd.fim IS NULL THEN 0 ELSE 1 END, vd.inicio DESC
      LIMIT 1;
    ELSE
      SELECT vd.inicio, vd.fim
      INTO v_dono_inicio, v_dono_fim
      FROM public.veiculo_donos vd
      WHERE vd.veiculo_id = p_veiculo_id AND vd.cliente_id = v_target_cliente
      ORDER BY vd.inicio DESC
      LIMIT 1;
    END IF;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      a.id,
      a.tenant_id,
      a.cliente_id,
      a.veiculo_id,
      a.servico_id,
      a.categoria_id,
      a.inicio,
      a.duracao_minutos,
      coalesce(a.duracao_total, a.duracao_minutos) AS duracao_total,
      a.modo_ocupacao,
      coalesce(a.modo_ocupacao_efetivo, a.modo_ocupacao) AS modo_ocupacao_efetivo,
      a.dias_ocupados,
      a.preco_estimado,
      coalesce(a.preco_estimado_total, a.preco_estimado) AS preco_estimado_total,
      a.status,
      a.origem,
      a.observacoes,
      a.numero_os,
      coalesce(a.forcado, false) AS forcado,
      a.created_at,
      a.updated_at,
      to_jsonb(c.*) AS cliente,
      CASE WHEN v.id IS NOT NULL THEN to_jsonb(v.*) ELSE null END AS veiculo,
      CASE WHEN s.id IS NOT NULL THEN to_jsonb(s.*) ELSE null END AS servico,
      CASE WHEN cat.id IS NOT NULL THEN to_jsonb(cat.*) ELSE null END AS categoria,
      coalesce(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', ai.id,
              'agendamento_id', ai.agendamento_id,
              'servico_id', ai.servico_id,
              'duracao_minutos', ai.duracao_minutos,
              'preco_estimado', ai.preco_estimado,
              'ordem', ai.ordem,
              'servicos', to_jsonb(s_item.*)
            ) ORDER BY ai.ordem ASC
          )
          FROM public.agendamento_itens ai
          LEFT JOIN public.servicos s_item ON s_item.id = ai.servico_id
          WHERE ai.agendamento_id = a.id
        ),
        '[]'::jsonb
      ) AS agendamento_itens,
      CASE WHEN ex.id IS NOT NULL THEN to_jsonb(ex.*) ELSE null END AS execucao,
      count(*) OVER() AS total_count
    FROM public.agendamentos a
    JOIN public.clientes c ON c.id = a.cliente_id
    LEFT JOIN public.veiculos v ON v.id = a.veiculo_id
    LEFT JOIN public.servicos s ON s.id = a.servico_id
    LEFT JOIN public.categorias_veiculo cat ON cat.id = a.categoria_id
    LEFT JOIN public.execucoes ex ON ex.agendamento_id = a.id
    WHERE a.tenant_id = p_tenant
      AND (p_cliente_id IS NULL OR a.cliente_id = p_cliente_id)
      AND (p_veiculo_id IS NULL OR (
            a.veiculo_id = p_veiculo_id
            AND (v_dono_inicio IS NULL OR (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date >= v_dono_inicio)
            AND (v_dono_fim IS NULL OR (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date <= v_dono_fim)
          ))
      AND (p_inicio IS NULL OR (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date >= p_inicio)
      AND (p_fim IS NULL OR (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date <= p_fim)
      AND (p_status IS NULL OR cardinality(p_status) = 0 OR a.status = ANY(p_status))
      AND (
        v_busca_limpa IS NULL
        OR (v_busca_num IS NOT NULL AND a.numero_os = v_busca_num)
        OR (v.placa ILIKE '%' || v_busca_limpa || '%')
        OR (c.nome ILIKE '%' || v_busca_limpa || '%')
        OR (c.telefone ILIKE '%' || v_busca_limpa || '%')
        OR (a.observacoes ILIKE '%' || v_busca_limpa || '%')
      )
    ORDER BY a.inicio DESC
  )
  SELECT *
  FROM base
  LIMIT p_limite
  OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.buscar_agendamentos(uuid, date, date, text[], text, uuid, uuid, integer, integer) TO authenticated;


-- 4. RPC CRIAR_AGENDAMENTO COM SUPORTE A PREÇO PRATICADO/CUSTOMIZADO NO ITEM
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

  IF NOT (v_tenant IN (SELECT public.meus_tenants())) AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado.';
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

  -- Pré-calcula duração e preço total dos itens (respeitando preço customizado se enviado)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_servico_id := (v_item->>'servico_id')::uuid;
    SELECT coalesce(sp.duracao_minutos, 60), coalesce(sp.preco_base, 0)
    INTO v_duracao, v_preco
    FROM public.servicos s
    LEFT JOIN public.servico_precos sp ON sp.servico_id = s.id AND sp.categoria_id = p_categoria AND sp.ativo
    WHERE s.id = v_servico_id AND s.tenant_id = v_tenant;

    -- Se o item possuir preço negociado informado, utiliza-o
    IF v_item ? 'preco' AND (v_item->>'preco') IS NOT NULL AND trim(v_item->>'preco') <> '' THEN
      v_preco := (v_item->>'preco')::numeric(10,2);
    ELSIF v_item ? 'preco_estimado' AND (v_item->>'preco_estimado') IS NOT NULL AND trim(v_item->>'preco_estimado') <> '' THEN
      v_preco := (v_item->>'preco_estimado')::numeric(10,2);
    END IF;

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

    IF v_item ? 'preco' AND (v_item->>'preco') IS NOT NULL AND trim(v_item->>'preco') <> '' THEN
      v_preco := (v_item->>'preco')::numeric(10,2);
    ELSIF v_item ? 'preco_estimado' AND (v_item->>'preco_estimado') IS NOT NULL AND trim(v_item->>'preco_estimado') <> '' THEN
      v_preco := (v_item->>'preco_estimado')::numeric(10,2);
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


-- 5. RPC DASHBOARD_DONO COM SUPORTE DINÂMICO A PERÍODO
DROP FUNCTION IF EXISTS public.dashboard_dono();
DROP FUNCTION IF EXISTS public.dashboard_dono(text);

CREATE OR REPLACE FUNCTION public.dashboard_dono(p_periodo text DEFAULT 'este_mes')
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
      'servico_nome', s.nome,
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
      'servico_nome', s.nome
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
