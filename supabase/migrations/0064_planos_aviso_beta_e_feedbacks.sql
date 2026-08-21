-- ==============================================================================
-- MIGRAÇÃO 0064: PLANOS EM MODO AVISO (BETA), CHAVE CENTRAL E FEEDBACKS
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ESTRUTURA E SEMEAÇÃO DE PLANOS, LIMITES E RECURSOS
-- ------------------------------------------------------------------------------

-- Garantir que a tabela plan_limits existe
CREATE TABLE IF NOT EXISTS public.plan_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plano TEXT NOT NULL REFERENCES public.plans(codigo) ON DELETE CASCADE,
  recurso TEXT NOT NULL,
  limite INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plano, recurso)
);

ALTER TABLE public.plan_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Plan limits select" ON public.plan_limits;
CREATE POLICY "Plan limits select" ON public.plan_limits
  FOR SELECT USING (true);

-- Semear/Atualizar os 4 recursos de limites por plano
INSERT INTO public.plan_limits (plano, recurso, limite) VALUES
  ('free', 'atendimentos_mes', 30),
  ('pro', 'atendimentos_mes', 300),
  ('studio', 'atendimentos_mes', NULL),
  ('free', 'usuarios', 1),
  ('pro', 'usuarios', 5),
  ('studio', 'usuarios', NULL),
  ('free', 'clientes', 100),
  ('pro', 'clientes', NULL),
  ('studio', 'clientes', NULL),
  ('free', 'retencao_fotos_execucao_dias', 30),
  ('pro', 'retencao_fotos_execucao_dias', 90),
  ('studio', 'retencao_fotos_execucao_dias', 365)
ON CONFLICT (plano, recurso) DO UPDATE
SET limite = EXCLUDED.limite;

-- Garantir catálogo completo de 11 funcionalidades do prompt
INSERT INTO public.feature_catalogo (chave, nome, descricao, grupo, ordem) VALUES
  ('agenda_clientes', 'Agenda e clientes', 'Acesso completo a gestão de clientes e agenda', 'Operacional', 1),
  ('vistoria_assinatura_pdf', 'Vistoria com assinatura e PDF', 'Check-in com assinatura digital do cliente e geração de PDF', 'Operacional', 2),
  ('calculadora_diluicao', 'Calculadora de diluição', 'Cálculo de dosagem de produtos químicos', 'Operacional', 3),
  ('agendamento_online', 'Agendamento online', 'Página pública de agendamento do cliente', 'Vendas', 4),
  ('orcamentos_tres_niveis', 'Orçamento em três níveis', 'Apresentação de propostas Essencial, Recomendado e Premium', 'Vendas', 5),
  ('sinal_pix', 'Sinal por Pix', 'Cobrança de sinal PIX no agendamento público', 'Vendas', 6),
  ('financeiro_completo_margem', 'Financeiro completo e margem', 'Controle de caixa, relatórios e cálculo de margem', 'Financeiro', 7),
  ('estoque', 'Estoque', 'Controle de movimentações de produtos e insumos', 'Gestão', 8),
  ('comissoes', 'Comissões', 'Gestão de comissões da equipe', 'Financeiro', 9),
  ('taxas_bandeira_maquininhas', 'Taxas por bandeira e múltiplas maquininhas', 'Cálculo de taxas de cartão por maquininha', 'Financeiro', 10),
  ('multiplos_executores', 'Múltiplos executores por atendimento', 'Atribuição de múltiplos profissionais na mesma OS', 'Execução', 11)
ON CONFLICT (chave) DO UPDATE SET
  nome = EXCLUDED.nome,
  descricao = EXCLUDED.descricao,
  grupo = EXCLUDED.grupo,
  ordem = EXCLUDED.ordem;

-- Configurar a matriz de permissões por plano (plan_features)
INSERT INTO public.plan_features (plano, feature, habilitado) VALUES
  -- Free
  ('free', 'agenda_clientes', true),
  ('free', 'vistoria_assinatura_pdf', true),
  ('free', 'calculadora_diluicao', true),
  ('free', 'agendamento_online', false),
  ('free', 'orcamentos_tres_niveis', false),
  ('free', 'sinal_pix', false),
  ('free', 'financeiro_completo_margem', false),
  ('free', 'estoque', false),
  ('free', 'comissoes', false),
  ('free', 'taxas_bandeira_maquininhas', false),
  ('free', 'multiplos_executores', false),

  -- Pro
  ('pro', 'agenda_clientes', true),
  ('pro', 'vistoria_assinatura_pdf', true),
  ('pro', 'calculadora_diluicao', true),
  ('pro', 'agendamento_online', true),
  ('pro', 'orcamentos_tres_niveis', true),
  ('pro', 'sinal_pix', true),
  ('pro', 'financeiro_completo_margem', true),
  ('pro', 'estoque', true),
  ('pro', 'comissoes', true),
  ('pro', 'taxas_bandeira_maquininhas', true),
  ('pro', 'multiplos_executores', false),

  -- Studio
  ('studio', 'agenda_clientes', true),
  ('studio', 'vistoria_assinatura_pdf', true),
  ('studio', 'calculadora_diluicao', true),
  ('studio', 'agendamento_online', true),
  ('studio', 'orcamentos_tres_niveis', true),
  ('studio', 'sinal_pix', true),
  ('studio', 'financeiro_completo_margem', true),
  ('studio', 'estoque', true),
  ('studio', 'comissoes', true),
  ('studio', 'taxas_bandeira_maquininhas', true),
  ('studio', 'multiplos_executores', true)
ON CONFLICT (plano, feature) DO UPDATE
SET habilitado = EXCLUDED.habilitado, updated_at = now();


-- ------------------------------------------------------------------------------
-- 2. CHAVE CENTRAL DO BETA (plataforma_config) & AUDITORIA
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.plataforma_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  bloqueio_planos_ativo BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.plataforma_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Configuracao da plataforma visivel para autenticados" ON public.plataforma_config;
CREATE POLICY "Configuracao da plataforma visivel para autenticados" ON public.plataforma_config
  FOR SELECT USING (true);

-- Semear registro unico com a chave DESLIGADA por padrao
INSERT INTO public.plataforma_config (id, bloqueio_planos_ativo)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

-- RPC para obter configuracao central
DROP FUNCTION IF EXISTS public.obter_config_plataforma();
CREATE OR REPLACE FUNCTION public.obter_config_plataforma()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_res JSONB;
BEGIN
  SELECT jsonb_build_object(
    'bloqueio_planos_ativo', bloqueio_planos_ativo,
    'updated_at', updated_at
  ) INTO v_res
  FROM public.plataforma_config
  WHERE id = 1;

  RETURN COALESCE(v_res, jsonb_build_object('bloqueio_planos_ativo', false));
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_config_plataforma() TO authenticated, anon;

-- RPC para alterar a chave central com AUDITORIA obrigatoria
DROP FUNCTION IF EXISTS public.admin_alterar_bloqueio_planos(boolean);
CREATE OR REPLACE FUNCTION public.admin_alterar_bloqueio_planos(p_ativo BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_antigo BOOLEAN;
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Apenas o administrador da plataforma pode alterar as configurações do sistema.';
  END IF;

  SELECT bloqueio_planos_ativo INTO v_antigo
  FROM public.plataforma_config
  WHERE id = 1;

  UPDATE public.plataforma_config
  SET bloqueio_planos_ativo = p_ativo,
      updated_at = now()
  WHERE id = 1;

  -- Gravar na tabela de auditoria com valor anterior e novo
  INSERT INTO public.admin_auditoria (
    admin_user_id, acao, entidade, entidade_id, valor_anterior, valor_novo
  ) VALUES (
    auth.uid(),
    'bloqueio_planos_alterado',
    'plataforma_config',
    '1',
    jsonb_build_object('bloqueio_planos_ativo', COALESCE(v_antigo, false)),
    jsonb_build_object('bloqueio_planos_ativo', p_ativo)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_alterar_bloqueio_planos(boolean) TO authenticated;


-- ------------------------------------------------------------------------------
-- 3. FUNÇÃO DE VERIFICAÇÃO DE LIMITES (verificar_limite)
-- ------------------------------------------------------------------------------

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
BEGIN
  v_tenant_id := (SELECT public.meus_tenants() LIMIT 1);
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('limite', NULL, 'usado', 0, 'excedido', false, 'permitido', true);
  END IF;

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

  -- 2. Calcular uso atual (com fuso America/Sao_Paulo para datas)
  IF p_recurso IN ('atendimentos', 'atendimentos_mes') THEN
    SELECT COUNT(*)::integer INTO v_usado
    FROM public.agendamentos
    WHERE tenant_id = v_tenant_id
      AND date_trunc('month', created_at AT TIME ZONE 'America/Sao_Paulo') = date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo');
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

  -- Se a chave estiver DESLIGADA, permitido é SEMPRE verdadeiro!
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


-- ------------------------------------------------------------------------------
-- 4. TABELA DE FEEDBACKS & RPCs
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.feedbacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  papel TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('erro', 'sugestao', 'elogio')),
  mensagem TEXT NOT NULL,
  tela_origem TEXT NULL,
  user_agent TEXT NULL,
  status TEXT NOT NULL DEFAULT 'novo' CHECK (status IN ('novo', 'em_analise', 'resolvido', 'descartado')),
  premiado BOOLEAN NOT NULL DEFAULT false,
  resposta_admin TEXT NULL,
  respondido_em TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.feedbacks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Oficina ve apenas proprios feedbacks" ON public.feedbacks;
CREATE POLICY "Oficina ve apenas proprios feedbacks" ON public.feedbacks
  FOR SELECT USING (
    tenant_id IN (SELECT public.meus_tenants())
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS "Oficina cria feedbacks no proprio tenant" ON public.feedbacks;
CREATE POLICY "Oficina cria feedbacks no proprio tenant" ON public.feedbacks
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT public.meus_tenants())
  );

DROP POLICY IF EXISTS "Platform admin atualiza feedbacks" ON public.feedbacks;
CREATE POLICY "Platform admin atualiza feedbacks" ON public.feedbacks
  FOR UPDATE USING (public.is_platform_admin());

-- RPC para enviar feedback derivando tenant_id e aplicando rate limit
DROP FUNCTION IF EXISTS public.enviar_feedback(text, text, text, text);
CREATE OR REPLACE FUNCTION public.enviar_feedback(
  p_tipo TEXT,
  p_mensagem TEXT,
  p_tela_origem TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_user_id UUID;
  v_papel TEXT;
  v_count_1h INTEGER;
  v_feedback_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  v_tenant_id := (SELECT public.meus_tenants() LIMIT 1);
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma oficina associada';
  END IF;

  -- Obter o papel do usuario na oficina
  SELECT role INTO v_papel
  FROM public.tenant_members
  WHERE tenant_id = v_tenant_id AND user_id = v_user_id AND status = 'ativo'
  LIMIT 1;

  IF v_papel IS NULL THEN
    v_papel := 'operador';
  END IF;

  -- Trava de limite de envios por usuario por hora (maximo 10 por hora)
  SELECT COUNT(*)::integer INTO v_count_1h
  FROM public.feedbacks
  WHERE user_id = v_user_id AND created_at >= (now() - INTERVAL '1 hour');

  IF v_count_1h >= 10 THEN
    RAISE EXCEPTION 'Limite de envios de feedback atingido (máximo 10 por hora). Tente novamente em breve.';
  END IF;

  INSERT INTO public.feedbacks (
    tenant_id, user_id, papel, tipo, mensagem, tela_origem, user_agent
  ) VALUES (
    v_tenant_id, v_user_id, v_papel, p_tipo, p_mensagem, p_tela_origem, p_user_agent
  )
  RETURNING id INTO v_feedback_id;

  RETURN jsonb_build_object('success', true, 'id', v_feedback_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.enviar_feedback(text, text, text, text) TO authenticated;

-- RPC leve para o contador de feedbacks novos (usada no botão do Admin)
DROP FUNCTION IF EXISTS public.admin_obter_contador_feedbacks_novos();
CREATE OR REPLACE FUNCTION public.admin_obter_contador_feedbacks_novos()
RETURNS INTEGER
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cnt INTEGER := 0;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*)::integer INTO v_cnt
  FROM public.feedbacks
  WHERE status = 'novo';

  RETURN COALESCE(v_cnt, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_obter_contador_feedbacks_novos() TO authenticated;

-- RPC para listagem de feedbacks no Painel Admin
DROP FUNCTION IF EXISTS public.admin_listar_feedbacks(text, text, uuid, integer, integer);
CREATE OR REPLACE FUNCTION public.admin_listar_feedbacks(
  p_tipo TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_tenant_id UUID DEFAULT NULL,
  p_limite INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  tenant_id UUID,
  tenant_nome TEXT,
  user_id UUID,
  user_email TEXT,
  papel TEXT,
  tipo TEXT,
  mensagem TEXT,
  tela_origem TEXT,
  user_agent TEXT,
  status TEXT,
  premiado BOOLEAN,
  resposta_admin TEXT,
  respondido_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Apenas o administrador da plataforma pode visualizar o painel de feedbacks.';
  END IF;

  RETURN QUERY
  SELECT 
    f.id,
    f.tenant_id,
    t.nome AS tenant_nome,
    f.user_id,
    u.email AS user_email,
    f.papel,
    f.tipo,
    f.mensagem,
    f.tela_origem,
    f.user_agent,
    f.status,
    f.premiado,
    f.resposta_admin,
    f.respondido_em,
    f.created_at
  FROM public.feedbacks f
  JOIN public.tenants t ON t.id = f.tenant_id
  LEFT JOIN auth.users u ON u.id = f.user_id
  WHERE (p_tipo IS NULL OR p_tipo = '' OR f.tipo = p_tipo)
    AND (p_status IS NULL OR p_status = '' OR f.status = p_status)
    AND (p_tenant_id IS NULL OR f.tenant_id = p_tenant_id)
  ORDER BY f.created_at DESC
  LIMIT p_limite OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_listar_feedbacks(text, text, uuid, integer, integer) TO authenticated;

-- RPC para responder/atualizar feedback
DROP FUNCTION IF EXISTS public.admin_atualizar_feedback(uuid, text, boolean, text);
CREATE OR REPLACE FUNCTION public.admin_atualizar_feedback(
  p_id UUID,
  p_status TEXT,
  p_premiado BOOLEAN,
  p_resposta_admin TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_respondido TIMESTAMPTZ := NULL;
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Apenas o administrador da plataforma pode atualizar ou responder feedbacks.';
  END IF;

  IF p_resposta_admin IS NOT NULL AND trim(p_resposta_admin) <> '' THEN
    v_respondido := now();
  END IF;

  UPDATE public.feedbacks
  SET status = p_status,
      premiado = p_premiado,
      resposta_admin = COALESCE(p_resposta_admin, resposta_admin),
      respondido_em = CASE WHEN p_resposta_admin IS NOT NULL THEN now() ELSE respondido_em END
  WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_atualizar_feedback(uuid, text, boolean, text) TO authenticated;

-- RPC para a oficina visualizar seus próprios envios e respostas ("Meus Envios")
DROP FUNCTION IF EXISTS public.obter_meus_feedbacks();
CREATE OR REPLACE FUNCTION public.obter_meus_feedbacks()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_res JSONB;
BEGIN
  v_tenant_id := (SELECT public.meus_tenants() LIMIT 1);
  IF v_tenant_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'id', f.id,
    'tipo', f.tipo,
    'mensagem', f.mensagem,
    'status', f.status,
    'premiado', f.premiado,
    'resposta_admin', f.resposta_admin,
    'respondido_em', f.respondido_em,
    'created_at', f.created_at
  ) ORDER BY f.created_at DESC)
  INTO v_res
  FROM public.feedbacks f
  WHERE f.tenant_id = v_tenant_id AND f.user_id = auth.uid();

  RETURN COALESCE(v_res, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_meus_feedbacks() TO authenticated;


-- ------------------------------------------------------------------------------
-- 5. TRIGGERS DE BLOQUEIO NO BANCO DE DADOS (CRIAÇÃO DE ATENDIMENTO, CLIENTE, MEMBRO)
-- ------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.checar_limite_trigger() CASCADE;
CREATE OR REPLACE FUNCTION public.checar_limite_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_recurso TEXT;
  v_res JSONB;
BEGIN
  IF TG_TABLE_NAME = 'agendamentos' THEN
    v_recurso := 'atendimentos_mes';
  ELSIF TG_TABLE_NAME = 'clientes' THEN
    v_recurso := 'clientes';
  ELSIF TG_TABLE_NAME = 'tenant_members' THEN
    v_recurso := 'usuarios';
  ELSE
    RETURN NEW;
  END IF;

  v_res := public.verificar_limite(v_recurso);

  IF (v_res->>'permitido')::boolean = false THEN
    RAISE EXCEPTION 'Limite do plano excedido para o recurso "%". O modo de bloqueio de planos está ativo.', v_recurso;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_checar_limite_agendamentos ON public.agendamentos;
CREATE TRIGGER trg_checar_limite_agendamentos
  BEFORE INSERT ON public.agendamentos
  FOR EACH ROW EXECUTE FUNCTION public.checar_limite_trigger();

DROP TRIGGER IF EXISTS trg_checar_limite_clientes ON public.clientes;
CREATE TRIGGER trg_checar_limite_clientes
  BEFORE INSERT ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.checar_limite_trigger();

DROP TRIGGER IF EXISTS trg_checar_limite_tenant_members ON public.tenant_members;
CREATE TRIGGER trg_checar_limite_tenant_members
  BEFORE INSERT ON public.tenant_members
  FOR EACH ROW EXECUTE FUNCTION public.checar_limite_trigger();

