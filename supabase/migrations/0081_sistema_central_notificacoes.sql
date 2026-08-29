-- ==============================================================================
-- MIGRAÇÃO 0081: SISTEMA DA CENTRAL DE NOTIFICAÇÕES IN-APP (SINO 🔔)
-- Eventos pontuais em tempo real com papel mínimo (RBAC), expurgo e isolamento RLS estrito
-- ==============================================================================

-- 1. TABELA PRINCIPAL DE NOTIFICAÇÕES
CREATE TABLE IF NOT EXISTS public.notificacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  destino TEXT NOT NULL CHECK (destino IN ('oficina', 'admin', 'usuario')),
  papel_minimo TEXT NOT NULL DEFAULT 'operador' CHECK (papel_minimo IN ('operador', 'gerente', 'dono')),
  tipo TEXT NOT NULL CHECK (tipo IN (
    'orcamento_aprovado', 
    'agendamento_novo', 
    'feedback_respondido', 
    'feedback_novo', 
    'erro_sistema', 
    'downgrade_oficina', 
    'nova_oficina', 
    'sistema_geral'
  )),
  titulo TEXT NOT NULL,
  mensagem TEXT NOT NULL,
  link TEXT NULL,
  lida BOOLEAN NOT NULL DEFAULT false,
  lida_em TIMESTAMPTZ NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices de performance para busca rápida
CREATE INDEX IF NOT EXISTS idx_notificacoes_tenant_papel_lida 
  ON public.notificacoes(tenant_id, papel_minimo, lida, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notificacoes_destino_admin 
  ON public.notificacoes(destino, lida, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notificacoes_user_lida 
  ON public.notificacoes(user_id, lida, created_at DESC);

-- 2. HABILITAR ROW LEVEL SECURITY (RLS) E POLÍTICAS ESTRITAS
ALTER TABLE public.notificacoes ENABLE ROW LEVEL SECURITY;

-- Política Oficina: Exige estritamente destino='oficina', tenant do usuário e papel_minimo compatível
DROP POLICY IF EXISTS "Oficina visualiza notificacoes por tenant e papel" ON public.notificacoes;
CREATE POLICY "Oficina visualiza notificacoes por tenant e papel" ON public.notificacoes
  FOR SELECT USING (
    destino = 'oficina'
    AND tenant_id IN (SELECT public.meus_tenants())
    AND (
      (papel_minimo = 'operador' AND public.tem_papel(tenant_id, ARRAY['dono', 'gerente', 'operador']::app_role[])) OR
      (papel_minimo = 'gerente' AND public.tem_papel(tenant_id, ARRAY['dono', 'gerente']::app_role[])) OR
      (papel_minimo = 'dono' AND public.tem_papel(tenant_id, ARRAY['dono']::app_role[]))
    )
  );

-- Política Admin da Plataforma: Exige estritamente destino='admin' e is_platform_admin()
DROP POLICY IF EXISTS "Platform admin visualiza notificacoes de admin" ON public.notificacoes;
CREATE POLICY "Platform admin visualiza notificacoes de admin" ON public.notificacoes
  FOR SELECT USING (
    destino = 'admin'
    AND public.is_platform_admin()
  );

-- Política Usuário Direto
DROP POLICY IF EXISTS "Usuario visualiza proprias notificacoes diretas" ON public.notificacoes;
CREATE POLICY "Usuario visualiza proprias notificacoes diretas" ON public.notificacoes
  FOR SELECT USING (
    destino = 'usuario'
    AND user_id = auth.uid()
  );

-- Política de Atualização (marcar como lida)
DROP POLICY IF EXISTS "Permissao para atualizar notificacoes proprias" ON public.notificacoes;
CREATE POLICY "Permissao para atualizar notificacoes proprias" ON public.notificacoes
  FOR UPDATE USING (
    (destino = 'oficina' AND tenant_id IN (SELECT public.meus_tenants()) AND (
      (papel_minimo = 'operador' AND public.tem_papel(tenant_id, ARRAY['dono', 'gerente', 'operador']::app_role[])) OR
      (papel_minimo = 'gerente' AND public.tem_papel(tenant_id, ARRAY['dono', 'gerente']::app_role[])) OR
      (papel_minimo = 'dono' AND public.tem_papel(tenant_id, ARRAY['dono']::app_role[]))
    ))
    OR (destino = 'admin' AND public.is_platform_admin())
    OR (destino = 'usuario' AND user_id = auth.uid())
  );

-- 3. FUNÇÃO INTERNA SECURITY DEFINER PARA EMISSÃO DE NOTIFICAÇÕES
DROP FUNCTION IF EXISTS public.criar_notificacao_interna(uuid, uuid, text, text, text, text, text, text, jsonb);
CREATE OR REPLACE FUNCTION public.criar_notificacao_interna(
  p_tenant_id UUID,
  p_user_id UUID,
  p_destino TEXT,
  p_papel_minimo TEXT,
  p_tipo TEXT,
  p_titulo TEXT,
  p_mensagem TEXT,
  p_link TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.notificacoes (
    tenant_id,
    user_id,
    destino,
    papel_minimo,
    tipo,
    titulo,
    mensagem,
    link,
    metadata,
    created_at
  ) VALUES (
    p_tenant_id,
    p_user_id,
    p_destino,
    COALESCE(p_papel_minimo, 'operador'),
    p_tipo,
    p_titulo,
    p_mensagem,
    p_link,
    COALESCE(p_metadata, '{}'::jsonb),
    now()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- 4. RPCS PARA APLICAÇÃO (OBTER, CONTAR E MARCAR COMO LIDA)

-- A. Obter Notificações
DROP FUNCTION IF EXISTS public.obter_notificacoes(integer, integer, boolean);
CREATE OR REPLACE FUNCTION public.obter_notificacoes(
  p_limite INTEGER DEFAULT 30,
  p_offset INTEGER DEFAULT 0,
  p_apenas_nao_lidas BOOLEAN DEFAULT false
)
RETURNS TABLE (
  id UUID,
  tenant_id UUID,
  destino TEXT,
  papel_minimo TEXT,
  tipo TEXT,
  titulo TEXT,
  mensagem TEXT,
  link TEXT,
  lida BOOLEAN,
  lida_em TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_is_admin BOOLEAN;
BEGIN
  v_is_admin := public.is_platform_admin();

  IF v_is_admin THEN
    -- Admin obtém notificações destinadas ao painel admin
    RETURN QUERY
    SELECT 
      n.id::uuid,
      n.tenant_id::uuid,
      n.destino::text,
      n.papel_minimo::text,
      n.tipo::text,
      n.titulo::text,
      n.mensagem::text,
      n.link::text,
      n.lida::boolean,
      n.lida_em::timestamptz,
      n.metadata::jsonb,
      n.created_at::timestamptz
    FROM public.notificacoes n
    WHERE n.destino = 'admin'
      AND (NOT p_apenas_nao_lidas OR n.lida = false)
    ORDER BY n.created_at DESC
    LIMIT p_limite OFFSET p_offset;
  ELSE
    -- Membro de oficina obtém notificações da oficina respeitando papel_minimo
    v_tenant_id := (SELECT public.meus_tenants() LIMIT 1);
    IF v_tenant_id IS NULL THEN
      RETURN;
    END IF;

    RETURN QUERY
    SELECT 
      n.id::uuid,
      n.tenant_id::uuid,
      n.destino::text,
      n.papel_minimo::text,
      n.tipo::text,
      n.titulo::text,
      n.mensagem::text,
      n.link::text,
      n.lida::boolean,
      n.lida_em::timestamptz,
      n.metadata::jsonb,
      n.created_at::timestamptz
    FROM public.notificacoes n
    WHERE n.destino = 'oficina'
      AND n.tenant_id = v_tenant_id
      AND (
        (n.papel_minimo = 'operador' AND public.tem_papel(v_tenant_id, ARRAY['dono', 'gerente', 'operador']::app_role[])) OR
        (n.papel_minimo = 'gerente' AND public.tem_papel(v_tenant_id, ARRAY['dono', 'gerente']::app_role[])) OR
        (n.papel_minimo = 'dono' AND public.tem_papel(v_tenant_id, ARRAY['dono']::app_role[]))
      )
      AND (NOT p_apenas_nao_lidas OR n.lida = false)
    ORDER BY n.created_at DESC
    LIMIT p_limite OFFSET p_offset;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_notificacoes(integer, integer, boolean) TO authenticated;

-- B. Obter Contador de Não Lidas
DROP FUNCTION IF EXISTS public.obter_contador_notificacoes_nao_lidas();
CREATE OR REPLACE FUNCTION public.obter_contador_notificacoes_nao_lidas()
RETURNS INTEGER
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_count INTEGER := 0;
BEGIN
  IF public.is_platform_admin() THEN
    SELECT COUNT(*)::integer INTO v_count
    FROM public.notificacoes
    WHERE destino = 'admin' AND lida = false;
  ELSE
    v_tenant_id := (SELECT public.meus_tenants() LIMIT 1);
    IF v_tenant_id IS NOT NULL THEN
      SELECT COUNT(*)::integer INTO v_count
      FROM public.notificacoes n
      WHERE n.destino = 'oficina'
        AND n.tenant_id = v_tenant_id
        AND n.lida = false
        AND (
          (n.papel_minimo = 'operador' AND public.tem_papel(v_tenant_id, ARRAY['dono', 'gerente', 'operador']::app_role[])) OR
          (n.papel_minimo = 'gerente' AND public.tem_papel(v_tenant_id, ARRAY['dono', 'gerente']::app_role[])) OR
          (n.papel_minimo = 'dono' AND public.tem_papel(v_tenant_id, ARRAY['dono']::app_role[]))
        );
    END IF;
  END IF;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_contador_notificacoes_nao_lidas() TO authenticated;

-- C. Marcar Notificação Individual como Lida
DROP FUNCTION IF EXISTS public.marcar_notificacao_lida(uuid);
CREATE OR REPLACE FUNCTION public.marcar_notificacao_lida(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.notificacoes
  SET lida = true,
      lida_em = now()
  WHERE id = p_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.marcar_notificacao_lida(uuid) TO authenticated;

-- D. Marcar Todas como Lidas
DROP FUNCTION IF EXISTS public.marcar_todas_notificacoes_lidas();
CREATE OR REPLACE FUNCTION public.marcar_todas_notificacoes_lidas()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_total INTEGER := 0;
BEGIN
  IF public.is_platform_admin() THEN
    WITH atualizadas AS (
      UPDATE public.notificacoes
      SET lida = true, lida_em = now()
      WHERE destino = 'admin' AND lida = false
      RETURNING id
    )
    SELECT COUNT(*)::integer INTO v_total FROM atualizadas;
  ELSE
    v_tenant_id := (SELECT public.meus_tenants() LIMIT 1);
    IF v_tenant_id IS NOT NULL THEN
      WITH atualizadas AS (
        UPDATE public.notificacoes n
        SET lida = true, lida_em = now()
        WHERE n.destino = 'oficina'
          AND n.tenant_id = v_tenant_id
          AND n.lida = false
          AND (
            (n.papel_minimo = 'operador' AND public.tem_papel(v_tenant_id, ARRAY['dono', 'gerente', 'operador']::app_role[])) OR
            (n.papel_minimo = 'gerente' AND public.tem_papel(v_tenant_id, ARRAY['dono', 'gerente']::app_role[])) OR
            (n.papel_minimo = 'dono' AND public.tem_papel(v_tenant_id, ARRAY['dono']::app_role[]))
          )
        RETURNING id
      )
      SELECT COUNT(*)::integer INTO v_total FROM atualizadas;
    END IF;
  END IF;

  RETURN v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.marcar_todas_notificacoes_lidas() TO authenticated;

-- 5. ATUALIZAR GATILHOS E EVENTOS PONTUAIS

-- A. Gatilho em responder_orcamento: Emite notificação de aprovação (papel_minimo: gerente)
DROP FUNCTION IF EXISTS public.responder_orcamento(uuid, text, boolean, text, text);
CREATE OR REPLACE FUNCTION public.responder_orcamento(
  p_token uuid,
  p_nivel text,
  p_aceite boolean,
  p_assinatura_base64 text DEFAULT NULL,
  p_nome_assinante text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_orcamento record;
  v_os_num integer;
  v_nome_limpo text;
  v_cliente_nome text;
  v_nivel_valor integer := 0;
BEGIN
  SELECT o.* INTO v_orcamento
  FROM public.orcamentos o
  WHERE o.token_publico = p_token OR o.id = p_token
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.';
  END IF;

  IF v_orcamento.status IN ('enviado', 'visualizado') AND v_orcamento.enviado_em IS NOT NULL THEN
    IF (v_orcamento.enviado_em::date + coalesce(v_orcamento.validade_dias, 7)) < current_date THEN
      UPDATE public.orcamentos SET status = 'expirado', updated_at = now() WHERE id = v_orcamento.id;
      RAISE EXCEPTION 'Este orçamento está expirado e não aceita mais respostas.';
    END IF;
  END IF;

  IF v_orcamento.status = 'expirado' THEN
    RAISE EXCEPTION 'Este orçamento está expirado e não aceita mais respostas.';
  END IF;

  IF p_aceite THEN
    IF p_nivel IS NULL OR p_nivel NOT IN ('essencial', 'recomendado', 'completo') THEN
      RAISE EXCEPTION 'Nível de orçamento inválido.';
    END IF;

    SELECT total_centavos INTO v_nivel_valor
    FROM public.orcamento_niveis
    WHERE orcamento_id = v_orcamento.id AND nivel = p_nivel;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'O nível escolhido não existe neste orçamento.';
    END IF;

    v_os_num := v_orcamento.numero_os;
    IF v_os_num IS NULL THEN
      v_os_num := public.proximo_numero_os(v_orcamento.tenant_id);
    END IF;

    v_nome_limpo := trim(coalesce(p_nome_assinante, ''));

    UPDATE public.orcamentos
    SET status = 'aprovado',
        nivel_aprovado = p_nivel,
        numero_os = v_os_num,
        respondido_em = now(),
        assinatura_path = coalesce(p_assinatura_base64, assinatura_path),
        assinatura_nome = coalesce(nullif(v_nome_limpo, ''), assinatura_nome),
        assinatura_data = CASE WHEN p_assinatura_base64 IS NOT NULL THEN now() ELSE assinatura_data END,
        updated_at = now()
    WHERE id = v_orcamento.id;

    -- Obter nome do cliente para a notificação
    SELECT COALESCE(c.nome, 'Cliente') INTO v_cliente_nome
    FROM public.clientes c
    WHERE c.id = v_orcamento.cliente_id;

    -- Disparar Notificação Pontual para a Oficina (papel mínimo: gerente)
    PERFORM public.criar_notificacao_interna(
      v_orcamento.tenant_id,
      NULL,
      'oficina',
      'gerente',
      'orcamento_aprovado',
      '🎉 Orçamento Aprovado!',
      COALESCE(v_nome_limpo, v_cliente_nome, 'Cliente') || ' aprovou a proposta #' || LPAD(v_os_num::text, 4, '0') || ' (' || upper(p_nivel) || ') no valor de R$ ' || to_char((COALESCE(v_nivel_valor, 0) / 100.0), 'FM999G999G990D00') || '.',
      '/orcamentos',
      jsonb_build_object('orcamento_id', v_orcamento.id, 'numero_os', v_os_num, 'nivel', p_nivel)
    );
  ELSE
    UPDATE public.orcamentos
    SET status = 'recusado',
        nivel_aprovado = null,
        respondido_em = now(),
        updated_at = now()
    WHERE id = v_orcamento.id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.responder_orcamento(uuid, text, boolean, text, text) TO anon, authenticated;

-- B. Gatilho em enviar_feedback: Emite notificação de feedback novo ou erro automático para o Admin
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
  v_tenant_nome TEXT;
  v_user_id UUID;
  v_papel TEXT;
  v_count_1h INTEGER;
  v_feedback_id UUID;
  v_eh_auto_err BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  v_tenant_id := (SELECT public.meus_tenants() LIMIT 1);
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma oficina associada';
  END IF;

  SELECT nome INTO v_tenant_nome FROM public.tenants WHERE id = v_tenant_id;

  SELECT role INTO v_papel
  FROM public.tenant_members
  WHERE tenant_id = v_tenant_id AND user_id = v_user_id
  LIMIT 1;

  -- Rate limit de 10 feedbacks por hora por oficina
  SELECT COUNT(*) INTO v_count_1h
  FROM public.feedbacks
  WHERE tenant_id = v_tenant_id
    AND created_at > (now() - INTERVAL '1 hour');

  IF v_count_1h >= 10 THEN
    RAISE EXCEPTION 'Limite de envios atingido. Tente novamente mais tarde.';
  END IF;

  INSERT INTO public.feedbacks (
    tenant_id, user_id, papel, tipo, mensagem, tela_origem, user_agent, status
  ) VALUES (
    v_tenant_id, v_user_id, COALESCE(v_papel, 'operador'), p_tipo, p_mensagem, p_tela_origem, p_user_agent, 'novo'
  ) RETURNING id INTO v_feedback_id;

  v_eh_auto_err := (p_mensagem ILIKE '%[AUTO-ERR]%');

  -- Notificar Administradores da Plataforma sobre o evento
  IF v_eh_auto_err THEN
    PERFORM public.criar_notificacao_interna(
      v_tenant_id,
      NULL,
      'admin',
      'operador',
      'erro_sistema',
      '🚨 Erro Automático na Tela',
      'Oficina "' || COALESCE(v_tenant_nome, 'Oficina') || '" registrou: ' || substring(p_mensagem from 1 for 120) || '...',
      '/admin/feedbacks',
      jsonb_build_object('feedback_id', v_feedback_id, 'tipo', p_tipo)
    );
  ELSE
    PERFORM public.criar_notificacao_interna(
      v_tenant_id,
      NULL,
      'admin',
      'operador',
      'feedback_novo',
      '💬 Novo Feedback de Oficina',
      'Oficina "' || COALESCE(v_tenant_nome, 'Oficina') || '" enviou um feedback (' || p_tipo || ').',
      '/admin/feedbacks',
      jsonb_build_object('feedback_id', v_feedback_id, 'tipo', p_tipo)
    );
  END IF;

  RETURN jsonb_build_object(
    'sucesso', true,
    'id', v_feedback_id,
    'mensagem', 'Feedback registrado com sucesso!'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.enviar_feedback(text, text, text, text) TO authenticated;

-- C. Gatilho em admin_atualizar_feedback: Notifica a oficina quando o admin responde
DROP FUNCTION IF EXISTS public.admin_atualizar_feedback(uuid, text, boolean, text);
DROP FUNCTION IF EXISTS public.admin_atualizar_feedback(uuid, text, boolean);
CREATE OR REPLACE FUNCTION public.admin_atualizar_feedback(
  p_id UUID,
  p_status TEXT,
  p_premiado BOOLEAN DEFAULT NULL,
  p_resposta_admin TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_fb RECORD;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  SELECT * INTO v_fb FROM public.feedbacks WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Feedback não encontrado.';
  END IF;

  UPDATE public.feedbacks
  SET status = COALESCE(p_status, status),
      premiado = COALESCE(p_premiado, premiado),
      resposta_admin = COALESCE(p_resposta_admin, resposta_admin),
      respondido_em = CASE WHEN p_resposta_admin IS NOT NULL AND p_resposta_admin <> '' THEN now() ELSE respondido_em END
  WHERE id = p_id;

  -- Se o admin respondeu, dispara notificação pontual para a oficina
  IF p_resposta_admin IS NOT NULL AND trim(p_resposta_admin) <> '' THEN
    PERFORM public.criar_notificacao_interna(
      v_fb.tenant_id,
      v_fb.user_id,
      'oficina',
      'operador',
      'feedback_respondido',
      '📬 Resposta do Suporte da Plataforma',
      'Seu feedback sobre "' || substring(v_fb.mensagem from 1 for 60) || '..." foi respondido: "' || substring(p_resposta_admin from 1 for 100) || '"',
      '/configuracoes',
      jsonb_build_object('feedback_id', v_fb.id)
    );
  END IF;

  RETURN jsonb_build_object('sucesso', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_atualizar_feedback(uuid, text, boolean, text) TO authenticated;

-- D. Gatilho em criar_oficina: Notifica o admin sobre nova oficina cadastrada
DROP FUNCTION IF EXISTS public.criar_oficina(text, text, text, text);
CREATE OR REPLACE FUNCTION public.criar_oficina(
  p_nome text, p_cidade text, p_uf text, p_telefone text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE 
  v_tenant uuid; 
  v_slug text;
  v_trial_fim date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário precisa estar autenticado para criar oficina.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM tenant_members
    WHERE user_id = auth.uid() AND role = 'dono' AND status = 'ativo'
  ) THEN
    RAISE EXCEPTION 'Você já possui uma oficina cadastrada como Dono.';
  END IF;

  v_slug := public.gerar_slug(p_nome);
  v_trial_fim := (current_date + 14);

  INSERT INTO tenants (nome, cidade, uf, telefone, slug, plano)
  VALUES (p_nome, p_cidade, p_uf, p_telefone, v_slug, 'pro')
  RETURNING id INTO v_tenant;

  INSERT INTO tenant_members (tenant_id, user_id, role, status)
  VALUES (v_tenant, auth.uid(), 'dono', 'ativo');

  INSERT INTO assinaturas (
    tenant_id, plano, status, valor_centavos, trial_fim, created_at, updated_at
  ) VALUES (
    v_tenant, 'pro', 'trial', 6700, v_trial_fim, now(), now()
  ) ON CONFLICT (tenant_id) DO NOTHING;

  -- Notificar Admin sobre a Nova Oficina
  PERFORM public.criar_notificacao_interna(
    v_tenant,
    auth.uid(),
    'admin',
    'operador',
    'nova_oficina',
    '🏢 Nova Oficina Cadastrada',
    'A oficina "' || p_nome || '" (' || p_cidade || '/' || p_uf || ') iniciou o Trial Pro de 14 dias.',
    '/admin/oficinas',
    jsonb_build_object('tenant_id', v_tenant, 'plano', 'pro')
  );

  RETURN v_tenant;
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_oficina(text, text, text, text) TO authenticated;

-- E. Rotina Diária: Expurgo de notificações lidas > 90 dias e Notificação de Downgrades para o Admin
DROP FUNCTION IF EXISTS public.processar_rotina_diaria_assinaturas();
CREATE OR REPLACE FUNCTION public.processar_rotina_diaria_assinaturas()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_hoje DATE := current_date;
  v_rec_trial RECORD;
  v_rec_atraso RECORD;
  v_count_trial_rebaixados INTEGER := 0;
  v_count_atraso_rebaixados INTEGER := 0;
  v_count_notificacoes_expurgadas INTEGER := 0;
BEGIN
  -- 1. Rebaixar Trials Vencidos
  FOR v_rec_trial IN
    SELECT a.id, a.tenant_id, a.plano, a.trial_fim, t.nome as tenant_nome
    FROM public.assinaturas a
    JOIN public.tenants t ON t.id = a.tenant_id
    WHERE a.status = 'trial'
      AND a.trial_fim IS NOT NULL
      AND a.trial_fim < v_hoje
  LOOP
    UPDATE public.tenants
    SET plano = 'free', updated_at = now()
    WHERE id = v_rec_trial.tenant_id;

    UPDATE public.assinaturas
    SET plano = 'free',
        status = 'cancelada',
        cancelada_em = now(),
        updated_at = now()
    WHERE id = v_rec_trial.id;

    INSERT INTO public.admin_auditoria (
      admin_user_id, acao, entidade, entidade_id, valor_anterior, valor_novo
    ) VALUES (
      COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
      'trial_expirado_rebaixado_free',
      'tenants',
      v_rec_trial.tenant_id::text,
      jsonb_build_object('plano', v_rec_trial.plano, 'status', 'trial'),
      jsonb_build_object('plano', 'free', 'status', 'cancelada')
    );

    -- Notificar Admin sobre Downgrade por Fim de Trial
    PERFORM public.criar_notificacao_interna(
      v_rec_trial.tenant_id,
      NULL,
      'admin',
      'operador',
      'downgrade_oficina',
      '📉 Fim de Trial: Oficina Rebaixada',
      'A oficina "' || v_rec_trial.tenant_nome || '" encerrou o período de degustação e foi migrada para o plano Free.',
      '/admin/assinaturas',
      jsonb_build_object('tenant_id', v_rec_trial.tenant_id, 'motivo', 'trial_expirado')
    );

    v_count_trial_rebaixados := v_count_trial_rebaixados + 1;
  END LOOP;

  -- 2. Rebaixar Assinaturas em Atraso há mais de 5 dias
  FOR v_rec_atraso IN
    SELECT a.id, a.tenant_id, a.plano, a.atraso_desde, t.nome as tenant_nome
    FROM public.assinaturas a
    JOIN public.tenants t ON t.id = a.tenant_id
    WHERE a.status = 'atrasada'
      AND a.atraso_desde IS NOT NULL
      AND a.atraso_desde < (v_hoje - 5)
  LOOP
    UPDATE public.tenants
    SET plano = 'free', updated_at = now()
    WHERE id = v_rec_atraso.tenant_id;

    UPDATE public.assinaturas
    SET plano = 'free',
        updated_at = now()
    WHERE id = v_rec_atraso.id;

    INSERT INTO public.admin_auditoria (
      admin_user_id, acao, entidade, entidade_id, valor_anterior, valor_novo
    ) VALUES (
      COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
      'inadimplencia_5dias_rebaixado_free',
      'tenants',
      v_rec_atraso.tenant_id::text,
      jsonb_build_object('plano', v_rec_atraso.plano, 'atraso_desde', v_rec_atraso.atraso_desde),
      jsonb_build_object('plano', 'free', 'status', 'atrasada')
    );

    -- Notificar Admin sobre Downgrade por Inadimplência
    PERFORM public.criar_notificacao_interna(
      v_rec_atraso.tenant_id,
      NULL,
      'admin',
      'operador',
      'downgrade_oficina',
      '⚠️ Inadimplência: Oficina Rebaixada',
      'A oficina "' || v_rec_atraso.tenant_nome || '" teve sua assinatura rebaixada para Free após 5 dias de atraso.',
      '/admin/assinaturas',
      jsonb_build_object('tenant_id', v_rec_atraso.tenant_id, 'motivo', 'inadimplencia_5dias')
    );

    v_count_atraso_rebaixados := v_count_atraso_rebaixados + 1;
  END LOOP;

  -- 3. EXPURGO DE NOTIFICAÇÕES LIDAS COM MAIS DE 90 DIAS
  WITH deleted AS (
    DELETE FROM public.notificacoes
    WHERE lida = true
      AND lida_em < (now() - INTERVAL '90 days')
    RETURNING id
  )
  SELECT COUNT(*)::integer INTO v_count_notificacoes_expurgadas FROM deleted;

  RETURN jsonb_build_object(
    'processado_em', now(),
    'trial_rebaixados', v_count_trial_rebaixados,
    'atraso_rebaixados', v_count_atraso_rebaixados,
    'notificacoes_expurgadas_90d', v_count_notificacoes_expurgadas
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.processar_rotina_diaria_assinaturas() TO authenticated, service_role;

-- ==============================================================================
-- 6. CONSULTAS DE VALIDAÇÃO PADRÃO
-- ==============================================================================

-- A. Verificar funções com mesmo nome e parâmetros duplicados
SELECT 
  p.proname AS funcao,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS argumentos,
  count(*) AS ocorrencias
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('obter_notificacoes', 'obter_contador_notificacoes_nao_lidas', 'marcar_notificacao_lida', 'marcar_todas_notificacoes_lidas', 'responder_orcamento', 'enviar_feedback', 'admin_atualizar_feedback', 'criar_oficina', 'processar_rotina_diaria_assinaturas')
GROUP BY p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)
HAVING count(*) > 1;

-- B. Verificar se a tabela de notificações está com RLS devidamente ativo
SELECT 
  schemaname, 
  tablename, 
  rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename = 'notificacoes';
