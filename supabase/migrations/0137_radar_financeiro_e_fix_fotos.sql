-- ==============================================================================
-- MIGRAÇÃO 0137: RADAR FINANCEIRO DIÁRIO (VENCIMENTOS & COBRANÇA) + CORREÇÃO RLS EXECUÇÃO FOTOS
-- ==============================================================================

-- 1. CORREÇÃO DE RLS E AUTO-PREENCHIMENTO DE FOTOS DE EXECUÇÃO (Incorporada defensivamente)
CREATE OR REPLACE FUNCTION public.trg_execucao_foto_expiracao_fn()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_plano text;
  v_retencao integer := 90;
BEGIN
  -- Auto-preencher tenant_id a partir da execução vinculada se não fornecido
  IF NEW.tenant_id IS NULL AND NEW.execucao_id IS NOT NULL THEN
    SELECT e.tenant_id INTO NEW.tenant_id
    FROM public.execucoes e
    WHERE e.id = NEW.execucao_id;
  END IF;

  -- Calcular data de expiração da foto conforme o plano do tenant
  IF NEW.expirado_em IS NULL AND NOT COALESCE(NEW.preservada, false) THEN
    v_tenant_id := NEW.tenant_id;
    IF v_tenant_id IS NULL AND NEW.execucao_id IS NOT NULL THEN
      SELECT e.tenant_id INTO v_tenant_id
      FROM public.execucoes e
      WHERE e.id = NEW.execucao_id;
    END IF;

    IF v_tenant_id IS NOT NULL THEN
      SELECT t.plano INTO v_plano
      FROM public.tenants t
      WHERE t.id = v_tenant_id;

      SELECT pl.limite INTO v_retencao
      FROM public.plan_limits pl
      WHERE pl.plano = v_plano AND pl.recurso = 'retencao_fotos_execucao_dias';

      v_retencao := COALESCE(v_retencao, 90);
      NEW.expirado_em := now() + (v_retencao || ' days')::interval;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_execucao_foto_expiracao ON public.execucao_fotos;
CREATE TRIGGER trg_execucao_foto_expiracao
  BEFORE INSERT ON public.execucao_fotos
  FOR EACH ROW EXECUTE FUNCTION public.trg_execucao_foto_expiracao_fn();

ALTER TABLE public.execucao_fotos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Membros podem ver execucao_fotos" ON public.execucao_fotos;
CREATE POLICY "Membros podem ver execucao_fotos" ON public.execucao_fotos FOR SELECT
  USING (
    tenant_id IN (SELECT public.meus_tenants())
    OR
    execucao_id IN (
      SELECT id FROM public.execucoes WHERE tenant_id IN (SELECT public.meus_tenants())
    )
    OR
    public.is_platform_admin()
  );

DROP POLICY IF EXISTS "Membros podem gerenciar execucao_fotos" ON public.execucao_fotos;
CREATE POLICY "Membros podem gerenciar execucao_fotos" ON public.execucao_fotos FOR ALL
  USING (
    public.tem_papel(tenant_id, ARRAY['dono','gerente','operador']::public.app_role[])
    OR
    execucao_id IN (
      SELECT id FROM public.execucoes WHERE tenant_id IN (SELECT public.meus_tenants())
    )
    OR
    public.is_platform_admin()
  )
  WITH CHECK (
    public.tem_papel(tenant_id, ARRAY['dono','gerente','operador']::public.app_role[])
    OR
    execucao_id IN (
      SELECT id FROM public.execucoes WHERE tenant_id IN (SELECT public.meus_tenants())
    )
    OR
    public.is_platform_admin()
  );

-- ==============================================================================
-- 2. RPC: OBTER RADAR FINANCEIRO DO DIA (VENCIMENTOS DO DIA, FIADOS ATRASADOS E CONTAS)
-- ==============================================================================
DROP FUNCTION IF EXISTS public.obter_radar_financeiro_do_dia();
CREATE OR REPLACE FUNCTION public.obter_radar_financeiro_do_dia()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_tenant_id uuid;
  v_hoje date := CURRENT_DATE;
  v_inicio_mes date := date_trunc('month', CURRENT_DATE)::date;
  v_fim_mes date := (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date;
  v_vencendo_hoje jsonb;
  v_atrasados jsonb;
  v_despesas jsonb;
  v_total_receber_hoje numeric(10,2) := 0.00;
  v_total_receber_atrasado numeric(10,2) := 0.00;
  v_total_despesas_pendentes numeric(10,2) := 0.00;
  v_total_despesas_mes numeric(10,2) := 0.00;
  v_qtd_vencendo_hoje integer := 0;
  v_qtd_atrasados integer := 0;
  v_qtd_despesas_pendentes integer := 0;
  v_nome_oficina text := 'Oficina';
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('erro', 'Não autenticado');
  END IF;

  -- Localiza o tenant ativo onde o usuário possui papel de dono ou gerente
  SELECT tm.tenant_id, COALESCE(t.nome, 'Nossa Oficina')
  INTO v_tenant_id, v_nome_oficina
  FROM public.tenant_members tm
  JOIN public.tenants t ON t.id = tm.tenant_id
  WHERE tm.user_id = v_user_id 
    AND tm.status = 'ativo'
    AND tm.role IN ('dono', 'gerente')
  LIMIT 1;

  -- Fallback para proprietário do tenant
  IF v_tenant_id IS NULL THEN
    SELECT t.id, COALESCE(t.nome, 'Nossa Oficina')
    INTO v_tenant_id, v_nome_oficina
    FROM public.tenants t
    WHERE t.criado_por = v_user_id
    LIMIT 1;
  END IF;

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object(
      'data_referencia', v_hoje,
      'vazio', true,
      'mensagem', 'Nenhum tenant associado com papel de gestão.'
    );
  END IF;

  -- 1. Clientes com parcelas / fiados vencendo EXATAMENTE HOJE
  SELECT 
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'cliente_id', r.cliente_id,
      'cliente_nome', COALESCE(c.nome, 'Cliente não identificado'),
      'cliente_telefone', c.telefone,
      'valor', r.valor_bruto,
      'numero_parcela', r.numero_parcela,
      'total_parcelas', r.total_parcelas,
      'previsto_para', r.previsto_para,
      'dias_atraso', 0,
      'observacao', r.observacao,
      'status', r.status
    ) ORDER BY r.valor_bruto DESC), '[]'::jsonb),
    COALESCE(SUM(r.valor_bruto), 0.00),
    COUNT(r.id)
  INTO v_vencendo_hoje, v_total_receber_hoje, v_qtd_vencendo_hoje
  FROM public.recebimentos r
  JOIN public.clientes c ON c.id = r.cliente_id
  WHERE r.tenant_id = v_tenant_id
    AND r.status = 'previsto'
    AND r.previsto_para = v_hoje;

  -- 2. Clientes com parcelas / fiados EM ATRASO (Vencimento passado e ainda não pago)
  SELECT 
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'cliente_id', r.cliente_id,
      'cliente_nome', COALESCE(c.nome, 'Cliente não identificado'),
      'cliente_telefone', c.telefone,
      'valor', r.valor_bruto,
      'numero_parcela', r.numero_parcela,
      'total_parcelas', r.total_parcelas,
      'previsto_para', r.previsto_para,
      'dias_atraso', (v_hoje - r.previsto_para),
      'observacao', r.observacao,
      'status', r.status
    ) ORDER BY r.previsto_para ASC, r.valor_bruto DESC), '[]'::jsonb),
    COALESCE(SUM(r.valor_bruto), 0.00),
    COUNT(r.id)
  INTO v_atrasados, v_total_receber_atrasado, v_qtd_atrasados
  FROM public.recebimentos r
  JOIN public.clientes c ON c.id = r.cliente_id
  WHERE r.tenant_id = v_tenant_id
    AND r.status = 'previsto'
    AND r.previsto_para < v_hoje;

  -- 3. Contas do mês (Despesas fixas, recorrentes ou variáveis pendentes de confirmação)
  SELECT 
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', df.id,
      'nome', df.nome,
      'categoria', df.categoria,
      'tipo', df.tipo,
      'valor_mensal', df.valor_mensal,
      'confirmado', df.confirmado,
      'vigencia_inicio', df.vigencia_inicio,
      'vigencia_fim', df.vigencia_fim
    ) ORDER BY df.confirmado ASC, df.valor_mensal DESC), '[]'::jsonb),
    COALESCE(SUM(CASE WHEN NOT df.confirmado THEN df.valor_mensal ELSE 0 END), 0.00),
    COALESCE(SUM(df.valor_mensal), 0.00),
    COUNT(CASE WHEN NOT df.confirmado THEN 1 END)
  INTO v_despesas, v_total_despesas_pendentes, v_total_despesas_mes, v_qtd_despesas_pendentes
  FROM public.despesas_fixas df
  WHERE df.tenant_id = v_tenant_id
    AND df.vigencia_inicio <= v_fim_mes
    AND (df.vigencia_fim IS NULL OR df.vigencia_fim >= v_inicio_mes);

  RETURN jsonb_build_object(
    'data_referencia', v_hoje,
    'nome_oficina', v_nome_oficina,
    'clientes_vencendo_hoje', v_vencendo_hoje,
    'clientes_atrasados', v_atrasados,
    'despesas_mes', v_despesas,
    'metricas', jsonb_build_object(
      'total_receber_hoje', v_total_receber_hoje,
      'total_receber_atrasado', v_total_receber_atrasado,
      'total_receber_geral', (v_total_receber_hoje + v_total_receber_atrasado),
      'total_despesas_pendentes', v_total_despesas_pendentes,
      'total_despesas_mes', v_total_despesas_mes,
      'saldo_esperado_hoje', (v_total_receber_hoje - v_total_despesas_pendentes),
      'qtd_vencendo_hoje', v_qtd_vencendo_hoje,
      'qtd_atrasados', v_qtd_atrasados,
      'qtd_cobrancas_total', (v_qtd_vencendo_hoje + v_qtd_atrasados),
      'qtd_despesas_pendentes', v_qtd_despesas_pendentes
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_radar_financeiro_do_dia() TO authenticated;

-- ==============================================================================
-- 3. BLOQUEIO DE FIADO NO BANCO DE DADOS PARA TENANTS NO PLANO FREE
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.trg_recebimentos_bloqueio_fiado_free_fn()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_forma_tipo text;
  v_plano text;
BEGIN
  IF NEW.forma_id IS NOT NULL THEN
    SELECT tipo INTO v_forma_tipo FROM public.tenant_formas_pagamento WHERE id = NEW.forma_id;
    IF v_forma_tipo = 'fiado' THEN
      SELECT COALESCE(plano::text, 'free') INTO v_plano FROM public.tenants WHERE id = NEW.tenant_id;
      IF v_plano = 'free' THEN
        RAISE EXCEPTION 'O parcelamento em Fiado / A Prazo é exclusivo para assinantes a partir do Plano Pro.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recebimentos_bloqueio_fiado_free ON public.recebimentos;
CREATE TRIGGER trg_recebimentos_bloqueio_fiado_free
  BEFORE INSERT ON public.recebimentos
  FOR EACH ROW EXECUTE FUNCTION public.trg_recebimentos_bloqueio_fiado_free_fn();

