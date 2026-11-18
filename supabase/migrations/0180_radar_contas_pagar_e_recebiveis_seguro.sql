-- ==============================================================================
-- Migration 0180: Permissão Granular de Gerente em Despesas, Vencimentos e Baixa
-- de Contas a Pagar no Radar Financeiro + Blindagem de Recebíveis (Fiado vs Cartão)
-- 100% Aditiva, Retrocompatível e Blindada contra PGRST203 (Zero Sobrecargas)
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. PERMISSÃO GRANULAR DE GERENTE EM TENANT_MEMBERS (DEFAULT FALSE)
-- ------------------------------------------------------------------------------
ALTER TABLE public.tenant_members
  ADD COLUMN IF NOT EXISTS pode_gerenciar_despesas boolean NOT NULL DEFAULT false;

-- Protege contra escalação de privilégio (apenas dono ou admin pode alterar role ou pode_gerenciar_despesas)
CREATE OR REPLACE FUNCTION public.trg_tenant_members_proteger_permissoes_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.pode_gerenciar_despesas IS DISTINCT FROM OLD.pode_gerenciar_despesas)
       OR (NEW.role IS DISTINCT FROM OLD.role) THEN
      IF auth.uid() IS NOT NULL
         AND NOT public.is_platform_admin()
         AND NOT public.tem_papel(OLD.tenant_id, ARRAY['dono']::app_role[]) THEN
        RAISE EXCEPTION 'Acesso negado: apenas o proprietário pode alterar papéis ou permissões financeiras de membros.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenant_members_proteger_permissoes ON public.tenant_members;
CREATE TRIGGER trg_tenant_members_proteger_permissoes
  BEFORE UPDATE ON public.tenant_members
  FOR EACH ROW EXECUTE FUNCTION public.trg_tenant_members_proteger_permissoes_fn();

-- Helper centralizado: true para Dono (sempre), criador do tenant, platform admin
-- ou Gerente ativo com pode_gerenciar_despesas = true
CREATE OR REPLACE FUNCTION public.pode_gerenciar_despesas(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = auth.uid()
      AND tm.status = 'ativo'
      AND (
        tm.role = 'dono'
        OR (tm.role = 'gerente' AND COALESCE(tm.pode_gerenciar_despesas, false) = true)
      )
  )
  OR EXISTS (
    SELECT 1
    FROM public.tenants t
    WHERE t.id = p_tenant_id
      AND t.criado_por = auth.uid()
  )
  OR public.is_platform_admin();
$$;

GRANT EXECUTE ON FUNCTION public.pode_gerenciar_despesas(uuid) TO authenticated;

-- RPC dedicada para o Dono ligar/desligar permissão de despesas do Gerente
DROP FUNCTION IF EXISTS public.atualizar_permissao_despesas_membro(uuid, boolean);
CREATE OR REPLACE FUNCTION public.atualizar_permissao_despesas_membro(
  p_member_id uuid,
  p_pode_gerenciar boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.tenant_members%rowtype;
BEGIN
  SELECT * INTO v_member FROM public.tenant_members WHERE id = p_member_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membro da equipe não encontrado.';
  END IF;

  IF NOT public.tem_papel(v_member.tenant_id, ARRAY['dono']::app_role[])
     AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado. Apenas o proprietário pode alterar permissões da equipe.';
  END IF;

  IF v_member.role = 'dono' THEN
    RETURN jsonb_build_object('sucesso', true, 'pode_gerenciar_despesas', true);
  END IF;

  IF v_member.role <> 'gerente' THEN
    UPDATE public.tenant_members
    SET pode_gerenciar_despesas = false
    WHERE id = p_member_id;
    RETURN jsonb_build_object('sucesso', true, 'pode_gerenciar_despesas', false);
  END IF;

  UPDATE public.tenant_members
  SET pode_gerenciar_despesas = COALESCE(p_pode_gerenciar, false)
  WHERE id = p_member_id;

  RETURN jsonb_build_object(
    'sucesso', true,
    'pode_gerenciar_despesas', COALESCE(p_pode_gerenciar, false)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.atualizar_permissao_despesas_membro(uuid, boolean) TO authenticated;


-- ------------------------------------------------------------------------------
-- 2. DIA DE VENCIMENTO EM DESPESAS_FIXAS + IMUTABILIDADE + RLS GRANULAR
-- ------------------------------------------------------------------------------
ALTER TABLE public.despesas_fixas
  ADD COLUMN IF NOT EXISTS dia_vencimento smallint;

ALTER TABLE public.despesas_fixas
  DROP CONSTRAINT IF EXISTS despesas_fixas_dia_vencimento_check;

ALTER TABLE public.despesas_fixas
  ADD CONSTRAINT despesas_fixas_dia_vencimento_check
  CHECK (dia_vencimento IS NULL OR (dia_vencimento >= 1 AND dia_vencimento <= 31));

-- Trigger de imutabilidade atualizada (permite editar nome, categoria e dia_vencimento livremente)
CREATE OR REPLACE FUNCTION public.trg_despesas_fixas_imutabilidade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.tenant_id <> NEW.tenant_id OR
       OLD.tipo <> NEW.tipo OR
       COALESCE(OLD.total_parcelas, 0) <> COALESCE(NEW.total_parcelas, 0) OR
       COALESCE(OLD.parcela_inicial, 0) <> COALESCE(NEW.parcela_inicial, 0) OR
       OLD.vigencia_inicio <> NEW.vigencia_inicio OR
       OLD.criado_por IS DISTINCT FROM NEW.criado_por THEN
      RAISE EXCEPTION 'Alteração rejeitada: tenant, tipo, parcelamento, vigência inicial e criador de despesas fixas são imutáveis.';
    END IF;

    IF OLD.valor_mensal <> NEW.valor_mensal THEN
      IF NOT (OLD.tipo = 'variavel' AND OLD.confirmado = false) AND (OLD.created_at::date <> CURRENT_DATE) THEN
        RAISE EXCEPTION 'Alteração rejeitada: para alterar valores de vigência ativa, utilize a opção "Atualizar valor" para preservar o histórico.';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.vigencia_inicio < date_trunc('month', CURRENT_DATE)::date THEN
      RAISE EXCEPTION 'Não é permitido cadastrar despesas fixas com vigência anterior ao mês corrente.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_despesas_fixas_imutabilidade ON public.despesas_fixas;
CREATE TRIGGER trg_despesas_fixas_imutabilidade
  BEFORE INSERT OR UPDATE ON public.despesas_fixas
  FOR EACH ROW EXECUTE FUNCTION public.trg_despesas_fixas_imutabilidade();

-- Políticas RLS em public.despesas_fixas usando pode_gerenciar_despesas(tenant_id)
ALTER TABLE public.despesas_fixas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS despesas_fixas_select ON public.despesas_fixas;
CREATE POLICY despesas_fixas_select ON public.despesas_fixas
  FOR SELECT TO authenticated
  USING (public.pode_gerenciar_despesas(tenant_id));

DROP POLICY IF EXISTS despesas_fixas_insert ON public.despesas_fixas;
CREATE POLICY despesas_fixas_insert ON public.despesas_fixas
  FOR INSERT TO authenticated
  WITH CHECK (public.pode_gerenciar_despesas(tenant_id));

DROP POLICY IF EXISTS despesas_fixas_update ON public.despesas_fixas;
CREATE POLICY despesas_fixas_update ON public.despesas_fixas
  FOR UPDATE TO authenticated
  USING (public.pode_gerenciar_despesas(tenant_id))
  WITH CHECK (public.pode_gerenciar_despesas(tenant_id));

DROP POLICY IF EXISTS despesas_fixas_delete ON public.despesas_fixas;
CREATE POLICY despesas_fixas_delete ON public.despesas_fixas
  FOR DELETE TO authenticated
  USING (public.pode_gerenciar_despesas(tenant_id));


-- ------------------------------------------------------------------------------
-- 3. TABELA DE CONTROLE MENSAL DE PAGAMENTOS (public.despesas_fixas_pagamentos)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.despesas_fixas_pagamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  despesa_id uuid NOT NULL REFERENCES public.despesas_fixas(id) ON DELETE CASCADE,
  competencia_mes date NOT NULL,
  valor_pago numeric(10,2) NOT NULL CHECK (valor_pago >= 0),
  pago_em timestamptz NOT NULL DEFAULT now(),
  pago_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_despesas_fixas_pagamentos_comp UNIQUE (despesa_id, competencia_mes)
);

CREATE INDEX IF NOT EXISTS idx_despesas_fixas_pagamentos_tenant_comp
  ON public.despesas_fixas_pagamentos (tenant_id, competencia_mes);

ALTER TABLE public.despesas_fixas_pagamentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS despesas_fixas_pagamentos_select ON public.despesas_fixas_pagamentos;
CREATE POLICY despesas_fixas_pagamentos_select ON public.despesas_fixas_pagamentos
  FOR SELECT TO authenticated
  USING (public.pode_gerenciar_despesas(tenant_id));

DROP POLICY IF EXISTS despesas_fixas_pagamentos_insert ON public.despesas_fixas_pagamentos;
CREATE POLICY despesas_fixas_pagamentos_insert ON public.despesas_fixas_pagamentos
  FOR INSERT TO authenticated
  WITH CHECK (public.pode_gerenciar_despesas(tenant_id));

DROP POLICY IF EXISTS despesas_fixas_pagamentos_update ON public.despesas_fixas_pagamentos;
CREATE POLICY despesas_fixas_pagamentos_update ON public.despesas_fixas_pagamentos
  FOR UPDATE TO authenticated
  USING (public.pode_gerenciar_despesas(tenant_id))
  WITH CHECK (public.pode_gerenciar_despesas(tenant_id));

DROP POLICY IF EXISTS despesas_fixas_pagamentos_delete ON public.despesas_fixas_pagamentos;
CREATE POLICY despesas_fixas_pagamentos_delete ON public.despesas_fixas_pagamentos
  FOR DELETE TO authenticated
  USING (public.pode_gerenciar_despesas(tenant_id));

-- RPC: Confirmar pagamento de uma despesa na competência (padrão = mês atual no fuso do tenant)
DROP FUNCTION IF EXISTS public.confirmar_pagamento_despesa(uuid, date, numeric, text);
CREATE OR REPLACE FUNCTION public.confirmar_pagamento_despesa(
  p_despesa_id uuid,
  p_competencia date DEFAULT NULL,
  p_valor_pago numeric DEFAULT NULL,
  p_observacao text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_despesa public.despesas_fixas%rowtype;
  v_fuso text;
  v_hoje date;
  v_comp date;
  v_valor numeric(10,2);
  v_pag_id uuid;
BEGIN
  SELECT * INTO v_despesa FROM public.despesas_fixas WHERE id = p_despesa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Despesa não encontrada.';
  END IF;

  IF NOT public.pode_gerenciar_despesas(v_despesa.tenant_id) THEN
    RAISE EXCEPTION 'Acesso negado. Você não possui permissão para confirmar pagamentos de despesas fixas.';
  END IF;

  v_fuso := public.obter_fuso_tenant(v_despesa.tenant_id);
  v_hoje := (now() AT TIME ZONE v_fuso)::date;
  v_comp := date_trunc('month', COALESCE(p_competencia, v_hoje))::date;
  v_valor := COALESCE(p_valor_pago, v_despesa.valor_mensal, 0.00);

  IF v_valor < 0 THEN
    RAISE EXCEPTION 'O valor pago não pode ser negativo.';
  END IF;

  -- Se for despesa variável ainda com valor estimado pendente, confirma automaticamente
  IF v_despesa.tipo = 'variavel' AND v_despesa.confirmado = false THEN
    UPDATE public.despesas_fixas
    SET valor_mensal = v_valor,
        confirmado = true,
        confirmado_em = now(),
        confirmado_por = auth.uid()
    WHERE id = v_despesa.id;
  END IF;

  INSERT INTO public.despesas_fixas_pagamentos (
    tenant_id, despesa_id, competencia_mes, valor_pago, pago_em, pago_por, observacao
  ) VALUES (
    v_despesa.tenant_id, v_despesa.id, v_comp, v_valor, now(), auth.uid(), NULLIF(trim(COALESCE(p_observacao, '')), '')
  )
  ON CONFLICT (despesa_id, competencia_mes)
  DO UPDATE SET
    valor_pago = EXCLUDED.valor_pago,
    pago_em = now(),
    pago_por = auth.uid(),
    observacao = COALESCE(EXCLUDED.observacao, despesas_fixas_pagamentos.observacao)
  RETURNING id INTO v_pag_id;

  RETURN jsonb_build_object(
    'sucesso', true,
    'pagamento_id', v_pag_id,
    'despesa_id', v_despesa.id,
    'competencia_mes', v_comp,
    'valor_pago', v_valor,
    'mensagem', 'Pagamento de "' || v_despesa.nome || '" confirmado com sucesso!'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirmar_pagamento_despesa(uuid, date, numeric, text) TO authenticated;

-- RPC: Desfazer pagamento de uma despesa na competência (estorno seguro de clique acidental)
DROP FUNCTION IF EXISTS public.desfazer_pagamento_despesa(uuid, date);
CREATE OR REPLACE FUNCTION public.desfazer_pagamento_despesa(
  p_despesa_id uuid,
  p_competencia date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_despesa public.despesas_fixas%rowtype;
  v_fuso text;
  v_hoje date;
  v_comp date;
BEGIN
  SELECT * INTO v_despesa FROM public.despesas_fixas WHERE id = p_despesa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Despesa não encontrada.';
  END IF;

  IF NOT public.pode_gerenciar_despesas(v_despesa.tenant_id) THEN
    RAISE EXCEPTION 'Acesso negado. Você não possui permissão para estornar pagamentos de despesas fixas.';
  END IF;

  v_fuso := public.obter_fuso_tenant(v_despesa.tenant_id);
  v_hoje := (now() AT TIME ZONE v_fuso)::date;
  v_comp := date_trunc('month', COALESCE(p_competencia, v_hoje))::date;

  DELETE FROM public.despesas_fixas_pagamentos
  WHERE despesa_id = v_despesa.id
    AND competencia_mes = v_comp;

  RETURN jsonb_build_object(
    'sucesso', true,
    'despesa_id', v_despesa.id,
    'competencia_mes', v_comp,
    'mensagem', 'Pagamento de "' || v_despesa.nome || '" desfeito para esta competência.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.desfazer_pagamento_despesa(uuid, date) TO authenticated;


-- ------------------------------------------------------------------------------
-- 4. ATUALIZAÇÃO DAS RPCS DE DESPESAS FIXAS (USAR pode_gerenciar_despesas + PROPAGAÇÃO DE dia_vencimento)
-- ------------------------------------------------------------------------------

-- 4.1 obter_ou_gerar_despesas_mes (propaga dia_vencimento ao clonar variáveis)
CREATE OR REPLACE FUNCTION public.obter_ou_gerar_despesas_mes(
  p_tenant uuid,
  p_mes date
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_inicio_mes date := date_trunc('month', p_mes)::date;
  v_fim_mes date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_inicio_mes_ant date := (date_trunc('month', p_mes) - interval '1 month')::date;
  v_fim_mes_ant date := (date_trunc('month', p_mes) - interval '1 day')::date;
  v_rec record;
  v_pai_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT (p_tenant IN (SELECT public.meus_tenants()) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  FOR v_rec IN
    SELECT d.*
    FROM public.despesas_fixas d
    WHERE d.tenant_id = p_tenant
      AND d.tipo = 'variavel'
      AND d.vigencia_inicio <= v_fim_mes_ant
      AND (d.vigencia_fim IS NULL OR d.vigencia_fim >= v_inicio_mes_ant)
      AND NOT EXISTS (
        SELECT 1 FROM public.despesas_fixas d_atual
        WHERE d_atual.tenant_id = p_tenant
          AND d_atual.tipo = 'variavel'
          AND (
            d_atual.id = d.id
            OR d_atual.despesa_pai_id = COALESCE(d.despesa_pai_id, d.id)
            OR lower(trim(d_atual.nome)) = lower(trim(d.nome))
          )
          AND d_atual.vigencia_inicio <= v_fim_mes
          AND (d_atual.vigencia_fim IS NULL OR d_atual.vigencia_fim >= v_inicio_mes)
      )
  LOOP
    v_pai_id := COALESCE(v_rec.despesa_pai_id, v_rec.id);
    INSERT INTO public.despesas_fixas (
      tenant_id, nome, categoria, valor_mensal, vigencia_inicio, vigencia_fim,
      tipo, dia_vencimento, despesa_pai_id, confirmado, confirmado_em, confirmado_por, criado_por
    ) VALUES (
      p_tenant, v_rec.nome, COALESCE(v_rec.categoria, 'Geral'), v_rec.valor_mensal, v_inicio_mes, v_fim_mes,
      'variavel', v_rec.dia_vencimento, v_pai_id, false, NULL, NULL, COALESCE(v_rec.criado_por, auth.uid())
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_ou_gerar_despesas_mes(uuid, date) TO authenticated;

-- 4.2 confirmar_despesas_variaveis_lote
CREATE OR REPLACE FUNCTION public.confirmar_despesas_variaveis_lote(
  p_itens jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_item jsonb;
  v_id uuid;
  v_valor numeric(10,2);
  v_tenant uuid;
BEGIN
  IF p_itens IS NULL OR jsonb_array_length(p_itens) = 0 THEN
    RETURN;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_id := (v_item->>'id')::uuid;
    v_valor := COALESCE((v_item->>'valor')::numeric(10,2), 0.00);

    SELECT tenant_id INTO v_tenant FROM public.despesas_fixas WHERE id = v_id;
    IF FOUND THEN
      IF NOT public.pode_gerenciar_despesas(v_tenant) THEN
        RAISE EXCEPTION 'Acesso negado. Você não possui permissão para confirmar despesas.';
      END IF;

      UPDATE public.despesas_fixas
      SET valor_mensal = v_valor,
          confirmado = true,
          confirmado_em = now(),
          confirmado_por = auth.uid()
      WHERE id = v_id;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirmar_despesas_variaveis_lote(jsonb) TO authenticated;

-- 4.3 nova_vigencia_despesa (propaga dia_vencimento + usa pode_gerenciar_despesas)
CREATE OR REPLACE FUNCTION public.nova_vigencia_despesa(
  p_despesa uuid,
  p_valor numeric,
  p_inicio date
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_despesa public.despesas_fixas%rowtype;
  v_fim_antiga date;
  v_nova_id uuid;
  v_pai_id uuid;
BEGIN
  SELECT * INTO v_despesa FROM public.despesas_fixas WHERE id = p_despesa;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Despesa não encontrada.';
  END IF;

  IF NOT public.pode_gerenciar_despesas(v_despesa.tenant_id) THEN
    RAISE EXCEPTION 'Acesso negado. Você não possui permissão para alterar valores de despesas.';
  END IF;

  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'Informe um valor mensal válido maior que zero.';
  END IF;

  IF p_inicio < v_despesa.vigencia_inicio THEN
    RAISE EXCEPTION 'A nova vigência precisa começar depois do início da atual.';
  END IF;

  IF p_inicio = v_despesa.vigencia_inicio THEN
    UPDATE public.despesas_fixas
    SET valor_mensal = p_valor,
        confirmado = true,
        confirmado_em = now(),
        confirmado_por = auth.uid()
    WHERE id = v_despesa.id;

    RETURN v_despesa.id;
  END IF;

  v_fim_antiga := (p_inicio - interval '1 day')::date;
  IF v_fim_antiga < v_despesa.vigencia_inicio THEN
    RAISE EXCEPTION 'A nova vigência precisa começar depois do início da atual.';
  END IF;

  UPDATE public.despesas_fixas
  SET vigencia_fim = v_fim_antiga
  WHERE id = v_despesa.id;

  v_pai_id := COALESCE(v_despesa.despesa_pai_id, v_despesa.id);

  INSERT INTO public.despesas_fixas (
    tenant_id, nome, categoria, tipo, total_parcelas, parcela_inicial,
    valor_mensal, vigencia_inicio, vigencia_fim, dia_vencimento,
    confirmado, confirmado_em, confirmado_por, despesa_pai_id, criado_por
  ) VALUES (
    v_despesa.tenant_id, v_despesa.nome, v_despesa.categoria, v_despesa.tipo,
    v_despesa.total_parcelas, v_despesa.parcela_inicial,
    p_valor, p_inicio, v_despesa.vigencia_fim, v_despesa.dia_vencimento,
    true, now(), auth.uid(), v_pai_id, auth.uid()
  ) RETURNING id INTO v_nova_id;

  RETURN v_nova_id;
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'Já existe uma despesa com este nome vigente neste período.';
  WHEN data_exception THEN
    RAISE EXCEPTION 'A nova vigência precisa começar depois do início da atual.';
END;
$$;

GRANT EXECUTE ON FUNCTION public.nova_vigencia_despesa(uuid, numeric, date) TO authenticated;

-- 4.4 corrigir_despesa_fixa (DROP assinatura antiga na mesma transação — ZERO PGRST203)
DROP FUNCTION IF EXISTS public.corrigir_despesa_fixa(uuid, text, text, text, numeric, date, integer, integer);
DROP FUNCTION IF EXISTS public.corrigir_despesa_fixa(uuid, text, text, text, numeric, date, integer, integer, smallint);

CREATE OR REPLACE FUNCTION public.corrigir_despesa_fixa(
  p_despesa uuid,
  p_nome text,
  p_categoria text,
  p_tipo text,
  p_valor numeric,
  p_vigencia_inicio date,
  p_total_parcelas integer DEFAULT NULL,
  p_parcela_inicial integer DEFAULT 1,
  p_dia_vencimento smallint DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_despesa public.despesas_fixas%rowtype;
  v_exec_count integer := 0;
BEGIN
  SELECT * INTO v_despesa FROM public.despesas_fixas WHERE id = p_despesa;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Despesa não encontrada.';
  END IF;

  IF NOT public.pode_gerenciar_despesas(v_despesa.tenant_id) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  IF v_despesa.created_at::date <> CURRENT_DATE THEN
    RAISE EXCEPTION 'Apenas lançamentos criados hoje podem ser corrigidos integralmente.';
  END IF;

  SELECT count(*) INTO v_exec_count
  FROM public.execucoes e
  WHERE e.tenant_id = v_despesa.tenant_id
    AND e.status = 'finalizado'
    AND COALESCE(e.custo_hora_aplicado, 0) > 0
    AND e.updated_at > v_despesa.created_at
    AND e.finalizado_em::date >= v_despesa.vigencia_inicio
    AND (v_despesa.vigencia_fim IS NULL OR e.finalizado_em::date <= v_despesa.vigencia_fim);

  IF v_exec_count > 0 THEN
    RAISE EXCEPTION 'Esta despesa já foi usada no cálculo de % atendimento(s) concluído(s). Para alterar o valor, use "Atualizar valor" — o histórico será preservado.', v_exec_count;
  END IF;

  UPDATE public.despesas_fixas
  SET nome = trim(p_nome),
      categoria = p_categoria,
      tipo = p_tipo,
      valor_mensal = p_valor,
      vigencia_inicio = p_vigencia_inicio,
      total_parcelas = CASE WHEN p_tipo = 'parcelada' THEN p_total_parcelas ELSE NULL END,
      parcela_inicial = CASE WHEN p_tipo = 'parcelada' THEN p_parcela_inicial ELSE 1 END,
      dia_vencimento = p_dia_vencimento
  WHERE id = p_despesa;
END;
$$;

GRANT EXECUTE ON FUNCTION public.corrigir_despesa_fixa(uuid, text, text, text, numeric, date, integer, integer, smallint) TO authenticated;

-- 4.5 excluir_despesa_fixa
CREATE OR REPLACE FUNCTION public.excluir_despesa_fixa(
  p_despesa uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_despesa public.despesas_fixas%rowtype;
  v_exec_count integer := 0;
BEGIN
  SELECT * INTO v_despesa FROM public.despesas_fixas WHERE id = p_despesa;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Despesa não encontrada.';
  END IF;

  IF NOT public.pode_gerenciar_despesas(v_despesa.tenant_id) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  IF v_despesa.created_at::date <> CURRENT_DATE THEN
    RAISE EXCEPTION 'Apenas despesas criadas hoje podem ser excluídas. Para despesas mais antigas, utilize a opção "Encerrar".';
  END IF;

  SELECT count(*) INTO v_exec_count
  FROM public.execucoes e
  WHERE e.tenant_id = v_despesa.tenant_id
    AND e.status = 'finalizado'
    AND COALESCE(e.custo_hora_aplicado, 0) > 0
    AND e.updated_at > v_despesa.created_at
    AND e.finalizado_em::date >= v_despesa.vigencia_inicio
    AND (v_despesa.vigencia_fim IS NULL OR e.finalizado_em::date <= v_despesa.vigencia_fim);

  IF v_exec_count > 0 THEN
    RAISE EXCEPTION 'Esta despesa já foi usada no cálculo de % atendimento(s) concluído(s). Para alterar o valor, use "Atualizar valor" — o histórico será preservado.', v_exec_count;
  END IF;

  DELETE FROM public.despesas_fixas WHERE id = p_despesa;
END;
$$;

GRANT EXECUTE ON FUNCTION public.excluir_despesa_fixa(uuid) TO authenticated;

-- 4.6 encerrar_despesa_fixa
CREATE OR REPLACE FUNCTION public.encerrar_despesa_fixa(
  p_despesa uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_despesa public.despesas_fixas%rowtype;
  v_fim_mes date := (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date;
BEGIN
  SELECT * INTO v_despesa FROM public.despesas_fixas WHERE id = p_despesa;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Despesa não encontrada.';
  END IF;

  IF NOT public.pode_gerenciar_despesas(v_despesa.tenant_id) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  IF v_despesa.vigencia_fim IS NOT NULL AND v_despesa.vigencia_fim <= v_fim_mes THEN
    RAISE EXCEPTION 'Esta despesa já se encontra encerrada.';
  END IF;

  UPDATE public.despesas_fixas
  SET vigencia_fim = v_fim_mes
  WHERE id = p_despesa;
END;
$$;

GRANT EXECUTE ON FUNCTION public.encerrar_despesa_fixa(uuid) TO authenticated;


-- ------------------------------------------------------------------------------
-- 5. SANEAMENTO RETROATIVO SEGURO: CARTÕES DE DÉBITO PRESOS COMO 'previsto'
-- (Corrige regressão da migration 0082 limpando falsa inadimplência imediata)
-- ------------------------------------------------------------------------------
UPDATE public.recebimentos r
SET status = 'recebido',
    recebido_em = COALESCE(r.recebido_em, r.created_at, now())
FROM public.tenant_formas_pagamento fp
WHERE r.forma_id = fp.id
  AND fp.tipo = 'debito'
  AND r.status = 'previsto'
  AND r.previsto_para <= CURRENT_DATE;


-- ------------------------------------------------------------------------------
-- 6. EVOLUÇÃO DE public.obter_radar_financeiro_do_dia()
-- - Fuso horário do tenant
-- - Proteção LEAST() para meses curtos (fev/30 dias)
-- - Filtro de segurança: gerente sem permissão recebe despesas_mes = []
-- - Separação limpa: Fiados/Clientes vs Cartões Previstos
-- ------------------------------------------------------------------------------
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
  v_fuso text;
  v_hoje date;
  v_inicio_mes date;
  v_fim_mes date;
  v_ultimo_dia_mes integer;
  v_pode_ver_despesas boolean := false;

  v_vencendo_hoje jsonb := '[]'::jsonb;
  v_atrasados jsonb := '[]'::jsonb;
  v_cartoes_previstos jsonb := '[]'::jsonb;
  v_despesas jsonb := '[]'::jsonb;

  v_total_receber_hoje numeric(10,2) := 0.00;
  v_total_receber_atrasado numeric(10,2) := 0.00;
  v_total_cartoes_previstos numeric(10,2) := 0.00;
  v_total_despesas_pendentes numeric(10,2) := 0.00;
  v_total_despesas_pagas numeric(10,2) := 0.00;
  v_total_despesas_mes numeric(10,2) := 0.00;

  v_qtd_vencendo_hoje integer := 0;
  v_qtd_atrasados integer := 0;
  v_qtd_cartoes_previstos integer := 0;
  v_qtd_despesas_pendentes integer := 0;
  v_qtd_despesas_vencendo_ou_atrasadas integer := 0;
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
      'data_referencia', CURRENT_DATE,
      'vazio', true,
      'mensagem', 'Nenhum tenant associado com papel de gestão.'
    );
  END IF;

  v_fuso := public.obter_fuso_tenant(v_tenant_id);
  v_hoje := (now() AT TIME ZONE v_fuso)::date;
  v_inicio_mes := date_trunc('month', v_hoje)::date;
  v_fim_mes := (date_trunc('month', v_hoje) + interval '1 month - 1 day')::date;
  v_ultimo_dia_mes := EXTRACT(DAY FROM v_fim_mes)::int;
  v_pode_ver_despesas := public.pode_gerenciar_despesas(v_tenant_id);

  -- 1. Clientes com parcelas / fiados vencendo EXATAMENTE HOJE (Exclui cartões)
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'cliente_id', r.cliente_id,
      'cliente_nome', COALESCE(c.nome, 'Cliente não identificado'),
      'cliente_telefone', c.telefone,
      'forma_nome', COALESCE(fp.nome, 'Fiado / A Prazo'),
      'forma_tipo', COALESCE(fp.tipo, 'fiado'),
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
  LEFT JOIN public.tenant_formas_pagamento fp ON fp.id = r.forma_id
  WHERE r.tenant_id = v_tenant_id
    AND r.status = 'previsto'
    AND r.previsto_para = v_hoje
    AND COALESCE(fp.tipo, 'fiado') NOT IN ('debito', 'credito');

  -- 2. Clientes com parcelas / fiados EM ATRASO (Exclui cartões)
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'cliente_id', r.cliente_id,
      'cliente_nome', COALESCE(c.nome, 'Cliente não identificado'),
      'cliente_telefone', c.telefone,
      'forma_nome', COALESCE(fp.nome, 'Fiado / A Prazo'),
      'forma_tipo', COALESCE(fp.tipo, 'fiado'),
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
  LEFT JOIN public.tenant_formas_pagamento fp ON fp.id = r.forma_id
  WHERE r.tenant_id = v_tenant_id
    AND r.status = 'previsto'
    AND r.previsto_para < v_hoje
    AND COALESCE(fp.tipo, 'fiado') NOT IN ('debito', 'credito');

  -- 3. Repasses de Cartão previstos (separados de fiado para visibilidade limpa)
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'cliente_id', r.cliente_id,
      'cliente_nome', COALESCE(c.nome, 'Cliente não identificado'),
      'forma_nome', COALESCE(fp.nome, 'Cartão'),
      'forma_tipo', fp.tipo,
      'valor_bruto', r.valor_bruto,
      'valor_liquido', r.valor_liquido,
      'valor_taxa', r.valor_taxa,
      'numero_parcela', r.numero_parcela,
      'total_parcelas', r.total_parcelas,
      'previsto_para', r.previsto_para,
      'dias_atraso', GREATEST(0, (v_hoje - r.previsto_para)),
      'status', r.status
    ) ORDER BY r.previsto_para ASC, r.valor_bruto DESC), '[]'::jsonb),
    COALESCE(SUM(r.valor_liquido), 0.00),
    COUNT(r.id)
  INTO v_cartoes_previstos, v_total_cartoes_previstos, v_qtd_cartoes_previstos
  FROM public.recebimentos r
  JOIN public.clientes c ON c.id = r.cliente_id
  JOIN public.tenant_formas_pagamento fp ON fp.id = r.forma_id
  WHERE r.tenant_id = v_tenant_id
    AND r.status = 'previsto'
    AND fp.tipo IN ('debito', 'credito');

  -- 4. Contas do mês (SOMENTE se o usuário possuir permissão pode_gerenciar_despesas)
  IF v_pode_ver_despesas THEN
    WITH base_despesas AS (
      SELECT
        df.id,
        df.nome,
        df.categoria,
        df.tipo,
        df.valor_mensal,
        df.confirmado,
        df.vigencia_inicio,
        df.vigencia_fim,
        df.dia_vencimento,
        CASE
          WHEN df.dia_vencimento IS NOT NULL THEN
            make_date(
              EXTRACT(YEAR FROM v_hoje)::int,
              EXTRACT(MONTH FROM v_hoje)::int,
              LEAST(df.dia_vencimento::int, v_ultimo_dia_mes)
            )
          ELSE NULL
        END AS data_vencimento_mes,
        (dfp.id IS NOT NULL) AS pago,
        dfp.pago_em,
        dfp.valor_pago
      FROM public.despesas_fixas df
      LEFT JOIN public.despesas_fixas_pagamentos dfp
        ON dfp.despesa_id = df.id
       AND dfp.competencia_mes = v_inicio_mes
      WHERE df.tenant_id = v_tenant_id
        AND df.vigencia_inicio <= v_fim_mes
        AND (df.vigencia_fim IS NULL OR df.vigencia_fim >= v_inicio_mes)
    ),
    classificadas AS (
      SELECT
        bd.*,
        CASE
          WHEN bd.pago THEN 'pago'
          WHEN bd.data_vencimento_mes IS NOT NULL AND bd.data_vencimento_mes < v_hoje THEN 'atrasada'
          WHEN bd.data_vencimento_mes IS NOT NULL AND bd.data_vencimento_mes = v_hoje THEN 'vence_hoje'
          WHEN bd.data_vencimento_mes IS NOT NULL AND bd.data_vencimento_mes > v_hoje
               AND bd.data_vencimento_mes <= (v_hoje + interval '3 days')::date THEN 'vence_em_breve'
          ELSE 'pendente'
        END AS status_pagamento,
        CASE
          WHEN NOT bd.pago AND bd.data_vencimento_mes IS NOT NULL AND bd.data_vencimento_mes < v_hoje
            THEN (v_hoje - bd.data_vencimento_mes)
          ELSE 0
        END AS dias_atraso
      FROM base_despesas bd
    )
    SELECT
      COALESCE(jsonb_agg(jsonb_build_object(
        'id', c.id,
        'nome', c.nome,
        'categoria', c.categoria,
        'tipo', c.tipo,
        'valor_mensal', c.valor_mensal,
        'confirmado', c.confirmado,
        'vigencia_inicio', c.vigencia_inicio,
        'vigencia_fim', c.vigencia_fim,
        'dia_vencimento', c.dia_vencimento,
        'data_vencimento_mes', c.data_vencimento_mes,
        'pago', c.pago,
        'pago_em', c.pago_em,
        'valor_pago', c.valor_pago,
        'status_pagamento', c.status_pagamento,
        'dias_atraso', c.dias_atraso
      ) ORDER BY
        CASE c.status_pagamento
          WHEN 'atrasada' THEN 1
          WHEN 'vence_hoje' THEN 2
          WHEN 'vence_em_breve' THEN 3
          WHEN 'pendente' THEN 4
          ELSE 5
        END ASC,
        c.data_vencimento_mes ASC NULLS LAST,
        c.valor_mensal DESC
      ), '[]'::jsonb),
      COALESCE(SUM(CASE WHEN NOT c.pago THEN c.valor_mensal ELSE 0 END), 0.00),
      COALESCE(SUM(CASE WHEN c.pago THEN COALESCE(c.valor_pago, c.valor_mensal) ELSE 0 END), 0.00),
      COALESCE(SUM(c.valor_mensal), 0.00),
      COUNT(CASE WHEN NOT c.pago OR NOT c.confirmado THEN 1 END),
      COUNT(CASE WHEN (NOT c.pago AND c.status_pagamento IN ('atrasada', 'vence_hoje')) OR (c.tipo = 'variavel' AND NOT c.confirmado) THEN 1 END)
    INTO
      v_despesas,
      v_total_despesas_pendentes,
      v_total_despesas_pagas,
      v_total_despesas_mes,
      v_qtd_despesas_pendentes,
      v_qtd_despesas_vencendo_ou_atrasadas
    FROM classificadas c;
  END IF;

  RETURN jsonb_build_object(
    'data_referencia', v_hoje,
    'nome_oficina', v_nome_oficina,
    'pode_ver_despesas', v_pode_ver_despesas,
    'clientes_vencendo_hoje', v_vencendo_hoje,
    'clientes_atrasados', v_atrasados,
    'cartoes_previstos', v_cartoes_previstos,
    'despesas_mes', v_despesas,
    'metricas', jsonb_build_object(
      'total_receber_hoje', v_total_receber_hoje,
      'total_receber_atrasado', v_total_receber_atrasado,
      'total_receber_geral', (v_total_receber_hoje + v_total_receber_atrasado),
      'total_cartoes_previstos', v_total_cartoes_previstos,
      'total_despesas_pendentes', v_total_despesas_pendentes,
      'total_despesas_pagas', v_total_despesas_pagas,
      'total_despesas_mes', v_total_despesas_mes,
      'saldo_esperado_hoje', (v_total_receber_hoje - v_total_despesas_pendentes),
      'qtd_vencendo_hoje', v_qtd_vencendo_hoje,
      'qtd_atrasados', v_qtd_atrasados,
      'qtd_cobrancas_total', (v_qtd_vencendo_hoje + v_qtd_atrasados),
      'qtd_cartoes_previstos', v_qtd_cartoes_previstos,
      'qtd_despesas_pendentes', v_qtd_despesas_pendentes,
      'qtd_despesas_vencendo_ou_atrasadas', v_qtd_despesas_vencendo_ou_atrasadas
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_radar_financeiro_do_dia() TO authenticated;


-- ------------------------------------------------------------------------------
-- 7. FINALIZAR_EXECUCAO_COM_PAGAMENTOS (Assinatura Canônica Única — Zero PGRST203)
-- - Restaura 'debito' (previsto_para <= v_hoje) como 'recebido'
-- - Aceita 'recebido_no_ato' opcional dentro do JSONB para cartões
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.finalizar_execucao_com_pagamentos(uuid, jsonb, jsonb, jsonb, text);
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_fuso text;
  v_hoje date;
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
  v_recebido_no_ato boolean := false;
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
  v_desc_tipo_norm text;
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

  v_fuso := public.obter_fuso_tenant(v_tenant);
  v_hoje := (now() AT TIME ZONE v_fuso)::date;

  PERFORM public.concluir_atendimento(p_execucao, p_valores, p_consumos, p_observacoes);

  SELECT valor_total_final INTO v_faturamento_bruto FROM public.execucoes WHERE id = p_execucao;
  v_faturamento_com_desconto := COALESCE(v_faturamento_bruto, 0.00);

  v_desc_val := COALESCE(p_desconto_valor, 0.00);
  IF v_desc_val > 0 THEN
    IF p_desconto_motivo IS NULL OR trim(p_desconto_motivo) = '' THEN
      RAISE EXCEPTION 'O motivo do desconto é obrigatório quando há concessão de desconto.';
    END IF;

    v_desc_tipo_norm := lower(trim(COALESCE(p_desconto_tipo, '')));

    IF v_desc_tipo_norm IN ('porcentagem', 'percentual', '%') THEN
      v_faturamento_com_desconto := round(v_faturamento_bruto - (v_faturamento_bruto * v_desc_val / 100.0), 2);
      v_desc_tipo_norm := 'porcentagem';
    ELSIF v_desc_tipo_norm IN ('valor_fixo', 'fixo', 'reais', 'dinheiro', 'moeda') THEN
      v_faturamento_com_desconto := greatest(0.00, round(v_faturamento_bruto - v_desc_val, 2));
      v_desc_tipo_norm := 'valor_fixo';
    ELSE
      RAISE EXCEPTION 'Tipo de desconto inválido: %', p_desconto_tipo;
    END IF;

    UPDATE public.execucoes
    SET desconto_tipo = v_desc_tipo_norm,
        desconto_valor = v_desc_val,
        desconto_motivo = trim(p_desconto_motivo),
        desconto_aplicado_por = auth.uid(),
        valor_total_final = v_faturamento_com_desconto,
        observacoes_saida = COALESCE(p_observacoes, observacoes_saida),
        updated_at = now()
    WHERE id = p_execucao;
  ELSE
    IF p_observacoes IS NOT NULL THEN
      UPDATE public.execucoes
      SET observacoes_saida = p_observacoes,
          updated_at = now()
      WHERE id = p_execucao;
    END IF;
  END IF;

  SELECT COALESCE(sinal_valor, 0.00) INTO v_sinal_pago
  FROM public.agendamentos
  WHERE id = v_exec.agendamento_id AND sinal_status = 'pago';

  v_soma_pagamentos := v_sinal_pago;

  IF p_pagamentos IS NOT NULL AND jsonb_array_length(p_pagamentos) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_pagamentos) LOOP
      v_forma_id := (v_item->>'forma_id')::uuid;
      IF v_forma_id IS NULL THEN
        v_forma_id := (v_item->>'forma_pagamento_id')::uuid;
      END IF;

      v_maquininha_id := NULLIF(v_item->>'maquininha_id', '')::uuid;
      v_bandeira_codigo := NULLIF(trim(COALESCE(v_item->>'bandeira_codigo', '')), '');
      v_total_parcelas := COALESCE((v_item->>'total_parcelas')::integer, 1);
      v_numero_parcela := COALESCE((v_item->>'numero_parcela')::integer, 1);
      v_valor_bruto := (v_item->>'valor_bruto')::numeric;
      v_previsto_para := COALESCE((v_item->>'previsto_para')::date, v_hoje);
      v_obs := COALESCE(v_item->>'observacao', v_item->>'observacoes');
      v_recebido_no_ato := COALESCE((v_item->>'recebido_no_ato')::boolean, false);

      IF v_valor_bruto IS NULL OR v_valor_bruto <= 0 THEN
        RAISE EXCEPTION 'O valor de cada parcela deve ser maior que zero.';
      END IF;

      SELECT tipo INTO v_forma_tipo
      FROM public.tenant_formas_pagamento
      WHERE id = v_forma_id AND tenant_id = v_tenant;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Forma de pagamento não encontrada.';
      END IF;

      IF v_maquininha_id IS NOT NULL THEN
        SELECT taxa_percentual, taxa_fixa, taxa_estimada
        INTO v_taxa_perc, v_taxa_fixa, v_taxa_estimada
        FROM public.resolver_taxa_cartao(
          v_maquininha_id,
          v_forma_tipo,
          v_bandeira_codigo,
          v_total_parcelas,
          v_hoje
        );
      ELSE
        v_taxa_perc := 0.00;
        v_taxa_fixa := 0.00;
        v_taxa_estimada := false;
      END IF;

      v_valor_taxa := round((v_valor_bruto * (COALESCE(v_taxa_perc, 0.00) / 100.0)) + COALESCE(v_taxa_fixa, 0.00), 2);
      v_valor_liquido := greatest(0.00, v_valor_bruto - v_valor_taxa);

      IF v_forma_tipo IN ('dinheiro', 'pix') THEN
        v_status := 'recebido';
        v_recebido_em := now();
      ELSIF v_forma_tipo = 'debito' AND v_previsto_para <= v_hoje THEN
        v_status := 'recebido';
        v_recebido_em := now();
      ELSIF v_forma_tipo = 'credito' AND v_recebido_no_ato = true THEN
        v_status := 'recebido';
        v_recebido_em := now();
      ELSE
        v_status := 'previsto';
        v_recebido_em := NULL;
      END IF;

      INSERT INTO public.recebimentos (
        tenant_id, execucao_id, agendamento_id, cliente_id,
        forma_id, maquininha_id, bandeira_codigo,
        valor_bruto, taxa_percentual_snapshot, taxa_fixa_snapshot, taxa_estimada,
        valor_taxa, valor_liquido, total_parcelas, numero_parcela,
        status, origem, previsto_para, recebido_em, observacao, criado_por
      ) VALUES (
        v_tenant, p_execucao, v_exec.agendamento_id, v_exec.cliente_id,
        v_forma_id, v_maquininha_id, v_bandeira_codigo,
        v_valor_bruto, COALESCE(v_taxa_perc, 0.00), COALESCE(v_taxa_fixa, 0.00), v_taxa_estimada,
        v_valor_taxa, v_valor_liquido, v_total_parcelas, v_numero_parcela,
        v_status, 'manual', v_previsto_para, v_recebido_em, v_obs, auth.uid()
      );

      v_soma_pagamentos := v_soma_pagamentos + v_valor_bruto;
    END LOOP;
  END IF;

  v_saldo_restante := round(v_faturamento_com_desconto - v_soma_pagamentos, 2);
  IF abs(v_saldo_restante) > 0.05 THEN
    RAISE EXCEPTION 'A soma dos pagamentos informados (R$ %) somada ao sinal (R$ %) não confere com o total devido (R$ %). Diferença: R$ %',
      (v_soma_pagamentos - v_sinal_pago), v_sinal_pago, v_faturamento_com_desconto, v_saldo_restante;
  END IF;

  PERFORM public.fechar_resultado_execucao(p_execucao);
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalizar_execucao_com_pagamentos(uuid, jsonb, jsonb, jsonb, text, text, numeric, text) TO authenticated;


-- ------------------------------------------------------------------------------
-- 8. OBTER_SALDO_DEVEDOR_CLIENTE (Exclui cartões do saldo devedor do cliente)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.obter_saldo_devedor_cliente(
  p_cliente_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_saldo_devedor numeric(10,2) := 0.00;
  v_historico jsonb;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.clientes WHERE id = p_cliente_id;
  IF v_tenant IS NULL OR NOT (v_tenant IN (SELECT public.meus_tenants())) OR NOT public.tem_papel(v_tenant, ARRAY['dono', 'gerente']::app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  -- Saldo devedor contabiliza APENAS dívidas reais do cliente (exclui repasses de maquininha/cartão)
  SELECT COALESCE(SUM(r.valor_bruto), 0.00) INTO v_saldo_devedor
  FROM public.recebimentos r
  LEFT JOIN public.tenant_formas_pagamento fp ON fp.id = r.forma_id
  WHERE r.tenant_id = v_tenant
    AND r.cliente_id = p_cliente_id
    AND r.status = 'previsto'
    AND COALESCE(fp.tipo, 'fiado') NOT IN ('debito', 'credito');

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'forma_nome', fp.nome,
      'forma_tipo', fp.tipo,
      'numero_parcela', r.numero_parcela,
      'total_parcelas', r.total_parcelas,
      'valor_bruto', r.valor_bruto,
      'valor_liquido', r.valor_liquido,
      'previsto_para', r.previsto_para,
      'recebido_em', r.recebido_em,
      'status', r.status,
      'origem', r.origem,
      'observacao', r.observacao
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


-- ------------------------------------------------------------------------------
-- 9. DAR_BAIXA_RECEBIMENTO (Zero PGRST203 + Blindagem para Cartões + Forma de Quitação)
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.dar_baixa_recebimento(uuid);
DROP FUNCTION IF EXISTS public.dar_baixa_recebimento(uuid, numeric);
DROP FUNCTION IF EXISTS public.dar_baixa_recebimento(uuid, numeric, uuid);

CREATE OR REPLACE FUNCTION public.dar_baixa_recebimento(
  p_recebimento_id uuid,
  p_valor_pago numeric DEFAULT NULL,
  p_forma_quitacao_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec record;
  v_forma_tipo text;
  v_forma_quit_nome text;
  v_sufixo_quit text := '';
  v_valor_final numeric(10,2);
  v_dif numeric(10,2);
  v_prox record;
  v_msg text;
  v_falta numeric(10,2);
BEGIN
  SELECT r.*, COALESCE(fp.tipo, 'fiado') AS forma_tipo_atual
  INTO v_rec
  FROM public.recebimentos r
  LEFT JOIN public.tenant_formas_pagamento fp ON fp.id = r.forma_id
  WHERE r.id = p_recebimento_id;

  IF v_rec.id IS NULL THEN
    RAISE EXCEPTION 'Recebimento não encontrado.';
  END IF;

  IF NOT (v_rec.tenant_id IN (SELECT public.meus_tenants())) OR NOT public.tem_papel(v_rec.tenant_id, ARRAY['dono', 'gerente']::app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado. Apenas dono e gerente podem dar baixa em recebimentos.';
  END IF;

  IF v_rec.status <> 'previsto' THEN
    RAISE EXCEPTION 'Operação rejeitada: Este recebimento já se encontra com status % e não pode ser re-baixado.', v_rec.status;
  END IF;

  v_forma_tipo := v_rec.forma_tipo_atual;

  IF p_forma_quitacao_id IS NOT NULL THEN
    SELECT nome INTO v_forma_quit_nome
    FROM public.tenant_formas_pagamento
    WHERE id = p_forma_quitacao_id AND tenant_id = v_rec.tenant_id;

    IF v_forma_quit_nome IS NOT NULL THEN
      v_sufixo_quit := ' • Quitado via ' || v_forma_quit_nome;
    END IF;
  END IF;

  -- Proteção específica para repasses de Cartão (Débito/Crédito):
  -- Nunca cria parcela residual de fiado para o cliente ao conciliar valor líquido da operadora
  IF v_forma_tipo IN ('debito', 'credito') THEN
    v_valor_final := COALESCE(p_valor_pago, v_rec.valor_liquido, v_rec.valor_bruto);
    IF v_valor_final <= 0 THEN
      RAISE EXCEPTION 'O valor recebido deve ser maior que zero.';
    END IF;

    UPDATE public.recebimentos
    SET valor_liquido = v_valor_final,
        valor_taxa = CASE
          WHEN v_valor_final <= valor_bruto THEN round(valor_bruto - v_valor_final, 2)
          ELSE valor_taxa
        END,
        status = 'recebido',
        recebido_em = now(),
        observacao = NULLIF(TRIM(COALESCE(observacao, '') || ' • Repasse confirmado (R$ ' || v_valor_final || ')' || v_sufixo_quit), '')
    WHERE id = p_recebimento_id;

    IF v_rec.execucao_id IS NOT NULL THEN
      PERFORM public.fechar_resultado_execucao(v_rec.execucao_id);
    END IF;

    RETURN jsonb_build_object(
      'sucesso', true,
      'mensagem', 'Repasse de cartão confirmado no caixa (R$ ' || v_valor_final || ').'
    );
  END IF;

  -- Fluxo para Fiado / A Prazo / Outros (com ajuste inteligente de parcial/excedente)
  v_valor_final := COALESCE(p_valor_pago, v_rec.valor_bruto);
  IF v_valor_final <= 0 THEN
    RAISE EXCEPTION 'O valor recebido deve ser maior que zero.';
  END IF;

  v_dif := round(v_valor_final - v_rec.valor_bruto, 2);

  IF v_dif = 0 THEN
    UPDATE public.recebimentos
    SET status = 'recebido',
        recebido_em = now(),
        observacao = CASE
          WHEN v_sufixo_quit <> '' THEN NULLIF(TRIM(COALESCE(observacao, '') || v_sufixo_quit), '')
          ELSE observacao
        END
    WHERE id = p_recebimento_id;
    v_msg := 'Baixa confirmada com sucesso pelo valor integral.' || v_sufixo_quit;

  ELSIF v_dif > 0 THEN
    UPDATE public.recebimentos
    SET valor_bruto = v_valor_final,
        valor_liquido = GREATEST(0.00, v_valor_final - valor_taxa),
        status = 'recebido',
        recebido_em = now(),
        observacao = TRIM(COALESCE(observacao, '') || ' • Recebido R$ ' || v_valor_final || ' (+ R$ ' || v_dif || ' abatido da próxima parcela)' || v_sufixo_quit)
    WHERE id = p_recebimento_id;

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

  ELSE
    v_falta := ABS(v_dif);

    UPDATE public.recebimentos
    SET valor_bruto = v_valor_final,
        valor_liquido = GREATEST(0.00, v_valor_final - valor_taxa),
        status = 'recebido',
        recebido_em = now(),
        observacao = TRIM(COALESCE(observacao, '') || ' • Pago parcial de R$ ' || v_valor_final || ' (restante R$ ' || v_falta || ' transferido)' || v_sufixo_quit)
    WHERE id = p_recebimento_id;

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

  IF v_rec.execucao_id IS NOT NULL THEN
    PERFORM public.fechar_resultado_execucao(v_rec.execucao_id);
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'mensagem', v_msg);
END;
$$;

GRANT EXECUTE ON FUNCTION public.dar_baixa_recebimento(uuid, numeric, uuid) TO authenticated;


-- ------------------------------------------------------------------------------
-- 10. DASHBOARD_DONO (Contabiliza Fiados <= hoje + Despesas vencendo/atrasadas
--     respeitando pode_gerenciar_despesas, sem vazar dados para gerentes sem flag)
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.dashboard_dono();
DROP FUNCTION IF EXISTS public.dashboard_dono(text);

CREATE OR REPLACE FUNCTION public.dashboard_dono(p_periodo text DEFAULT 'este_mes')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_tenant uuid;
  v_fuso text;
  v_agora_sp timestamptz;
  v_hoje_sp date;
  v_primeiro_dia_mes date;
  v_fim_mes date;
  v_ultimo_dia_mes integer;
  v_primeiro_dia_mes_ant date;
  v_ultimo_dia_mes_ant date;
  v_pode_ver_despesas boolean := false;

  v_inicio_periodo date;
  v_fim_periodo date;
  v_inicio_ant date;
  v_fim_ant date;

  v_em_execucao_count integer := 0;
  v_aguardando_inicio_count integer := 0;
  v_concluidos_hoje_count integer := 0;
  v_atrasados_entrega_count integer := 0;
  v_pernoite_hoje_count integer := 0;
  v_carros_na_oficina_count integer := 0;
  v_previsao_atraso_lista jsonb := '[]'::jsonb;

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

  v_meta_rec record;
  v_meta_obj jsonb := NULL;
  v_meta_atual numeric(12,2) := 0.00;
  v_meta_pct numeric(5,1) := 0.0;

  v_vistorias_sem_assinatura_count integer := 0;
  v_vistorias_sem_assinatura_lista jsonb := '[]'::jsonb;
  v_produtos_estoque_baixo_count integer := 0;
  v_produtos_estoque_baixo_lista jsonb := '[]'::jsonb;
  v_orcamentos_expirando_count integer := 0;
  v_orcamentos_expirando_lista jsonb := '[]'::jsonb;
  v_contas_vencidas_count integer := 0;
  v_despesas_alerta_count integer := 0;
  v_contas_vencidas_lista jsonb := '[]'::jsonb;
  v_agendamentos_sem_confirmacao_count integer := 0;
  v_agendamentos_sem_confirmacao_lista jsonb := '[]'::jsonb;
  v_atendimentos_taxa_estimada_count integer := 0;
  v_atendimentos_taxa_estimada_lista jsonb := '[]'::jsonb;

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
  v_fim_mes := (date_trunc('month', v_hoje_sp) + interval '1 month - 1 day')::date;
  v_ultimo_dia_mes := EXTRACT(DAY FROM v_fim_mes)::int;
  v_primeiro_dia_mes_ant := date_trunc('month', v_hoje_sp - interval '1 month')::date;
  v_ultimo_dia_mes_ant := (v_primeiro_dia_mes - interval '1 day')::date;
  v_pode_ver_despesas := public.pode_gerenciar_despesas(v_tenant);

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
  ELSE
    v_inicio_periodo := v_primeiro_dia_mes;
    v_fim_periodo := v_hoje_sp;
    v_inicio_ant := v_primeiro_dia_mes_ant;
    v_fim_ant := v_ultimo_dia_mes_ant;
  END IF;

  -- 1. BLOCO AGORA
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

  -- 2. BLOCO DINHEIRO
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

  -- Total vencido de clientes (exclui repasses de cartão)
  SELECT COALESCE(SUM(r.valor_bruto), 0.00) INTO v_vencido_total
  FROM public.recebimentos r
  LEFT JOIN public.tenant_formas_pagamento fp ON fp.id = r.forma_id
  WHERE r.tenant_id = v_tenant
    AND r.status = 'previsto'
    AND r.previsto_para < v_hoje_sp
    AND COALESCE(fp.tipo, 'fiado') NOT IN ('debito', 'credito');

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

  -- 3. BLOCO PRECISA DE AÇÃO
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

  -- Fiados / clientes vencendo hoje ou em atraso (exclui cartões)
  SELECT count(*) INTO v_contas_vencidas_count
  FROM public.recebimentos r
  LEFT JOIN public.tenant_formas_pagamento fp ON fp.id = r.forma_id
  WHERE r.tenant_id = v_tenant
    AND r.status = 'previsto'
    AND r.previsto_para <= v_hoje_sp
    AND COALESCE(fp.tipo, 'fiado') NOT IN ('debito', 'credito');

  -- Soma contas a pagar vencendo hoje ou atrasadas (ou variáveis pendentes) SOMENTE se usuário pode ver despesas
  IF v_pode_ver_despesas THEN
    SELECT count(*) INTO v_despesas_alerta_count
    FROM public.despesas_fixas df
    LEFT JOIN public.despesas_fixas_pagamentos dfp
      ON dfp.despesa_id = df.id
     AND dfp.competencia_mes = v_primeiro_dia_mes
    WHERE df.tenant_id = v_tenant
      AND df.vigencia_inicio <= v_fim_mes
      AND (df.vigencia_fim IS NULL OR df.vigencia_fim >= v_primeiro_dia_mes)
      AND (
        (
          dfp.id IS NULL
          AND df.dia_vencimento IS NOT NULL
          AND make_date(
            EXTRACT(YEAR FROM v_hoje_sp)::int,
            EXTRACT(MONTH FROM v_hoje_sp)::int,
            LEAST(df.dia_vencimento::int, v_ultimo_dia_mes)
          ) <= v_hoje_sp
        )
        OR (df.tipo = 'variavel' AND df.confirmado = false)
      );

    v_contas_vencidas_count := v_contas_vencidas_count + COALESCE(v_despesas_alerta_count, 0);
  END IF;

  SELECT COALESCE(jsonb_agg(t.obj), '[]'::jsonb) INTO v_contas_vencidas_lista
  FROM (
    SELECT jsonb_build_object(
      'recebimento_id', r.id,
      'cliente_nome', cl.nome,
      'valor_bruto', r.valor_bruto,
      'previsto_para', r.previsto_para,
      'dias_atraso', GREATEST(0, (v_hoje_sp - r.previsto_para))
    ) AS obj
    FROM public.recebimentos r
    JOIN public.clientes cl ON cl.id = r.cliente_id
    LEFT JOIN public.tenant_formas_pagamento fp ON fp.id = r.forma_id
    WHERE r.tenant_id = v_tenant
      AND r.status = 'previsto'
      AND r.previsto_para <= v_hoje_sp
      AND COALESCE(fp.tipo, 'fiado') NOT IN ('debito', 'credito')
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

  -- 4. BLOCO SAÚDE
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
-- 11. AUTO-AUDITORIA ANTI-PGRST203 NO CATÁLOGO pg_proc (ABORTA SE HOUVER SOBRECARGA)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  v_duplicadas text;
BEGIN
  SELECT string_agg(proname || ' (' || cnt || ' assinaturas)', ', ')
  INTO v_duplicadas
  FROM (
    SELECT p.proname, count(*) AS cnt
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'pode_gerenciar_despesas',
        'atualizar_permissao_despesas_membro',
        'confirmar_pagamento_despesa',
        'desfazer_pagamento_despesa',
        'obter_ou_gerar_despesas_mes',
        'confirmar_despesas_variaveis_lote',
        'nova_vigencia_despesa',
        'corrigir_despesa_fixa',
        'excluir_despesa_fixa',
        'encerrar_despesa_fixa',
        'obter_radar_financeiro_do_dia',
        'finalizar_execucao_com_pagamentos',
        'obter_saldo_devedor_cliente',
        'dar_baixa_recebimento',
        'dashboard_dono'
      )
    GROUP BY p.proname
    HAVING count(*) > 1
  ) dup;

  IF v_duplicadas IS NOT NULL THEN
    RAISE EXCEPTION 'ALERTA PGRST203: Sobrecarga de função detectada em public: %', v_duplicadas;
  END IF;
END;
$$;

COMMIT;

