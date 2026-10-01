-- ==============================================================================
-- MIGRAÇÃO 0138: CALIBRAÇÃO ESTRATÉGICA DE LIMITES DOS PLANOS (FREE, PRO, STUDIO)
-- Baseada em benchmark competitivo nacional (2025/2026), proteção de margem fiscal
-- e blindagem do Supabase Free Tier (500MB DB / 1GB Storage)
-- ==============================================================================

-- 1. ATUALIZAR TODOS OS RECURSOS E LIMITES EM PUBLIC.PLAN_LIMITS
INSERT INTO public.plan_limits (plano, recurso, limite, updated_at) VALUES
  -- A. NOTAS FISCAIS DE SERVIÇO (Focus NFS-e / Provedor Fiscal)
  -- Free: sem emissão | Pro: 15 notas/mês (protege margem) | Studio: 60 notas/mês
  ('free', 'notas_fiscais_mes', 0, now()),
  ('pro', 'notas_fiscais_mes', 15, now()),
  ('studio', 'notas_fiscais_mes', 60, now()),

  -- B. ATENDIMENTOS E AGENDAMENTOS MENSAIS (Volume Operacional)
  -- Free: até 15 atendimentos/mês (trava no meio do mês de qualquer estética ativa) | Pro: até 150 | Studio: até 500
  ('free', 'atendimentos_mes', 15, now()),
  ('pro', 'atendimentos_mes', 150, now()),
  ('studio', 'atendimentos_mes', 500, now()),
  ('free', 'agendamentos', 15, now()),
  ('pro', 'agendamentos', 150, now()),
  ('studio', 'agendamentos', 500, now()),
  ('free', 'execucoes', 15, now()),
  ('pro', 'execucoes', 150, now()),
  ('studio', 'execucoes', 500, now()),

  -- C. CLIENTES CADASTRADOS NA CARTEIRA (Trava de Expansão)
  -- Free: 20 clientes (atingido em 2 a 3 semanas de trabalho) | Pro: 350 clientes | Studio: Ilimitado (NULL)
  ('free', 'clientes', 20, now()),
  ('pro', 'clientes', 350, now()),
  ('studio', 'clientes', NULL, now()),

  -- D. MEMBROS / USUÁRIOS DA EQUIPE COM LOGIN
  -- Free: 1 (Dono) | Pro: 3 (Dono + 2 operadores) | Studio: 10 usuários
  ('free', 'usuarios', 1, now()),
  ('pro', 'usuarios', 3, now()),
  ('studio', 'usuarios', 10, now()),
  ('free', 'membros', 1, now()),
  ('pro', 'membros', 3, now()),
  ('studio', 'membros', 10, now()),

  -- E. RETENÇÃO DE FOTOS NO STORAGE (Dias de vida útil antes do expurgo automático)
  -- Free: 7 dias (recicla ferozmente o 1GB do Supabase Storage) | Pro: 60 dias | Studio: 180 dias
  ('free', 'retencao_fotos_execucao_dias', 7, now()),
  ('pro', 'retencao_fotos_execucao_dias', 60, now()),
  ('studio', 'retencao_fotos_execucao_dias', 180, now()),

  -- F. ATENDIMENTOS PRESERVADOS (Cota de Vistorias Salvas Eternamente no Portfólio)
  -- Free: 0 | Pro: 15 atendimentos | Studio: 100 atendimentos
  ('free', 'atendimentos_preservados_limite', 0, now()),
  ('pro', 'atendimentos_preservados_limite', 15, now()),
  ('studio', 'atendimentos_preservados_limite', 100, now()),

  -- G. SERVIÇOS NO CATÁLOGO
  -- Free: 10 serviços (permite montar o menu básico) | Pro: 35 serviços | Studio: Ilimitado (NULL)
  ('free', 'servicos', 10, now()),
  ('pro', 'servicos', 35, now()),
  ('studio', 'servicos', NULL, now()),
  ('free', 'servicos_mes', 10, now()),
  ('pro', 'servicos_mes', 35, now()),
  ('studio', 'servicos_mes', NULL, now()),

  -- H. ORÇAMENTOS POR MÊS
  -- Free: 8 orçamentos/mês | Pro: 150 orçamentos/mês | Studio: Ilimitado (NULL)
  ('free', 'orcamentos_mes', 8, now()),
  ('pro', 'orcamentos_mes', 150, now()),
  ('studio', 'orcamentos_mes', NULL, now()),

  -- I. PRODUTOS NO ESTOQUE
  -- Free: 0 (Estoque bloqueado no Free) | Pro: 50 produtos | Studio: Ilimitado (NULL)
  ('free', 'produtos', 0, now()),
  ('pro', 'produtos', 50, now()),
  ('studio', 'produtos', NULL, now())

ON CONFLICT (plano, recurso) DO UPDATE SET
  limite = EXCLUDED.limite,
  updated_at = now();

-- 2. HABILITAR AGENDAMENTO ONLINE NO PLANO FREE (COM TETOS DE 15 ATENDIMENTOS E 20 CLIENTES)
INSERT INTO public.plan_features (plano, feature, habilitado) VALUES
  ('free', 'agendamento_online', true),
  ('pro', 'agendamento_online', true),
  ('studio', 'agendamento_online', true)
ON CONFLICT (plano, feature) DO UPDATE SET
  habilitado = EXCLUDED.habilitado;

-- 3. GARANTIR A POLÍTICA DE EXPURGO ALINHADA COM A NOVA RETENÇÃO
CREATE OR REPLACE FUNCTION public.trg_execucao_foto_expiracao_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_plano TEXT := 'free';
  v_retencao INTEGER := 14;
BEGIN
  -- Se tenant_id for nulo, busca a partir de execucao_id
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

      v_retencao := COALESCE(v_retencao, 14);
      NEW.expirado_em := now() + (v_retencao || ' days')::interval;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 4. VERIFICAÇÃO DE LIMITES: COTA CONTA SOMENTE ATENDIMENTOS FINALIZADOS (CONCLUIDOS)
CREATE OR REPLACE FUNCTION public.verificar_limite(p_recurso text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
  -- REGRA DE NEGÓCIO: Atendimentos contam SOMENTE quando estão finalizados (status = 'concluido')
  IF p_recurso IN ('atendimentos', 'atendimentos_mes', 'execucoes') THEN
    SELECT COUNT(*)::integer INTO v_usado
    FROM public.agendamentos
    WHERE tenant_id = v_tenant_id
      AND status = 'concluido'
      AND date_trunc('month', COALESCE(updated_at, created_at) AT TIME ZONE v_fuso) = date_trunc('month', now() AT TIME ZONE v_fuso);
  ELSIF p_recurso = 'agendamentos' THEN
    SELECT COUNT(*)::integer INTO v_usado
    FROM public.agendamentos
    WHERE tenant_id = v_tenant_id
      AND status != 'cancelado'
      AND date_trunc('month', created_at AT TIME ZONE v_fuso) = date_trunc('month', now() AT TIME ZONE v_fuso);
  ELSIF p_recurso IN ('usuarios', 'membros') THEN
    SELECT COUNT(*)::integer INTO v_usado
    FROM public.tenant_members
    WHERE tenant_id = v_tenant_id AND status = 'ativo';
  ELSIF p_recurso = 'clientes' THEN
    SELECT COUNT(*)::integer INTO v_usado
    FROM public.clientes
    WHERE tenant_id = v_tenant_id;
  ELSIF p_recurso = 'servicos' THEN
    SELECT COUNT(*)::integer INTO v_usado
    FROM public.servicos
    WHERE tenant_id = v_tenant_id AND ativo = true;
  ELSIF p_recurso = 'produtos' THEN
    SELECT COUNT(*)::integer INTO v_usado
    FROM public.produtos
    WHERE tenant_id = v_tenant_id AND ativo = true;
  ELSIF p_recurso = 'orcamentos_mes' THEN
    SELECT COUNT(*)::integer INTO v_usado
    FROM public.orcamentos
    WHERE tenant_id = v_tenant_id
      AND date_trunc('month', created_at AT TIME ZONE v_fuso) = date_trunc('month', now() AT TIME ZONE v_fuso);
  ELSIF p_recurso = 'retencao_fotos_execucao_dias' THEN
    v_usado := COALESCE(v_limite, 14);
  ELSIF p_recurso = 'atendimentos_preservados_limite' THEN
    SELECT COUNT(*)::integer INTO v_usado
    FROM public.execucoes
    WHERE tenant_id = v_tenant_id AND COALESCE(preservada, false) = true;
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
