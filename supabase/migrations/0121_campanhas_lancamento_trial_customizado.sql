-- ==============================================================================
-- MIGRAÇÃO 0121: GERADOR DE LINKS DE CAMPANHA DE LANÇAMENTO (TRIAL & PLANOS CUSTOMIZADOS)
-- ==============================================================================

-- 1. TABELA CAMPANHAS_LANCAMENTO
CREATE TABLE IF NOT EXISTS public.campanhas_lancamento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT NOT NULL,
  nome TEXT NOT NULL,
  plano TEXT NOT NULL DEFAULT 'pro' REFERENCES public.plans(codigo),
  dias_trial INTEGER NOT NULL DEFAULT 30,
  limite_usos INTEGER NULL, -- NULL = ilimitado
  total_usos INTEGER NOT NULL DEFAULT 0,
  valido_ate TIMESTAMPTZ NULL, -- NULL = sem expiração
  ativo BOOLEAN NOT NULL DEFAULT true,
  titulo_destaque TEXT NULL,
  descricao TEXT NULL,
  beneficios TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uk_campanhas_lancamento_codigo UNIQUE (codigo)
);

-- Índices de busca rápida
CREATE INDEX IF NOT EXISTS idx_campanhas_lancamento_codigo ON public.campanhas_lancamento(codigo);
CREATE INDEX IF NOT EXISTS idx_campanhas_lancamento_ativo ON public.campanhas_lancamento(ativo);

-- 2. POLÍTICAS DE SEGURANÇA (RLS)
ALTER TABLE public.campanhas_lancamento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Campanhas visíveis publicamente se ativas" ON public.campanhas_lancamento;
CREATE POLICY "Campanhas visíveis publicamente se ativas" ON public.campanhas_lancamento
  FOR SELECT USING (ativo = true AND (valido_ate IS NULL OR valido_ate > now()));

DROP POLICY IF EXISTS "Admins gerenciam campanhas_lancamento" ON public.campanhas_lancamento;
CREATE POLICY "Admins gerenciam campanhas_lancamento" ON public.campanhas_lancamento
  FOR ALL USING (public.is_platform_admin());

GRANT SELECT ON public.campanhas_lancamento TO anon, authenticated;
GRANT ALL ON public.campanhas_lancamento TO authenticated;

-- 3. SEED INICIAL COM CAMPANHAS DE EXEMPLO/LANÇAMENTO
INSERT INTO public.campanhas_lancamento (codigo, nome, plano, dias_trial, limite_usos, valido_ate, ativo, titulo_destaque, descricao, beneficios)
VALUES 
  (
    'VIP30',
    'Lançamento VIP 30 Dias Pro',
    'pro',
    30,
    100,
    now() + interval '30 days',
    true,
    'Degustação VIP de 30 Dias no Plano Pro',
    'Convite oficial para os membros pioneiros do NuvemWash. Desfrute de todas as ferramentas Pro por 30 dias sem compromisso.',
    ARRAY[
      'Acesso completo a todas as funcionalidades do Plano Pro',
      'Atendimentos, orçamentos e vistorias digitais sem taxa de adesão',
      'Agendamento online e painel de clientes integrados',
      '30 dias de degustação livre sem necessidade de cartão'
    ]
  ),
  (
    'STUDIO45',
    'Lançamento Embaixadores Studio 45d',
    'studio',
    45,
    50,
    now() + interval '45 days',
    true,
    'Acesso Studio Completo de 45 Dias',
    'Acesso irrestrito com todos os recursos avançados, DRE financeiro, comissões de equipe e muito mais.',
    ARRAY[
      'Plano Studio sem limitações de capacidade',
      'DRE e Saúde Financeira com cálculo real de margem de lucro',
      'Controle completo de comissões e produtividade da equipe',
      '45 dias de degustação completa para transformar sua estética automotiva'
    ]
  )
ON CONFLICT (codigo) DO NOTHING;

-- 4. RPC: ADMIN_LISTAR_CAMPANHAS_LANCAMENTO
CREATE OR REPLACE FUNCTION public.admin_listar_campanhas_lancamento()
RETURNS TABLE (
  id UUID,
  codigo TEXT,
  nome TEXT,
  plano TEXT,
  plano_nome TEXT,
  dias_trial INTEGER,
  limite_usos INTEGER,
  total_usos INTEGER,
  valido_ate TIMESTAMPTZ,
  ativo BOOLEAN,
  titulo_destaque TEXT,
  descricao TEXT,
  beneficios TEXT[],
  created_at TIMESTAMPTZ,
  expirado BOOLEAN,
  esgotado BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  RETURN QUERY
  SELECT 
    c.id,
    c.codigo,
    c.nome,
    c.plano,
    p.nome AS plano_nome,
    c.dias_trial,
    c.limite_usos,
    c.total_usos,
    c.valido_ate,
    c.ativo,
    c.titulo_destaque,
    c.descricao,
    c.beneficios,
    c.created_at,
    (c.valido_ate IS NOT NULL AND c.valido_ate <= now()) AS expirado,
    (c.limite_usos IS NOT NULL AND c.total_usos >= c.limite_usos) AS esgotado
  FROM public.campanhas_lancamento c
  LEFT JOIN public.plans p ON p.codigo = c.plano
  ORDER BY c.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_listar_campanhas_lancamento() TO authenticated;

-- 5. RPC: ADMIN_SALVAR_CAMPANHA_LANCAMENTO
CREATE OR REPLACE FUNCTION public.admin_salvar_campanha_lancamento(
  p_id UUID DEFAULT NULL,
  p_codigo TEXT DEFAULT NULL,
  p_nome TEXT DEFAULT NULL,
  p_plano TEXT DEFAULT 'pro',
  p_dias_trial INTEGER DEFAULT 30,
  p_limite_usos INTEGER DEFAULT NULL,
  p_valido_ate TIMESTAMPTZ DEFAULT NULL,
  p_ativo BOOLEAN DEFAULT true,
  p_titulo_destaque TEXT DEFAULT NULL,
  p_descricao TEXT DEFAULT NULL,
  p_beneficios TEXT[] DEFAULT ARRAY[]::TEXT[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_codigo_limpo TEXT;
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Permissão negada. Apenas administradores editores podem alterar campanhas.';
  END IF;

  v_codigo_limpo := upper(trim(regexp_replace(coalesce(p_codigo, ''), '[^a-zA-Z0-9_-]+', '', 'g')));

  IF length(v_codigo_limpo) < 3 THEN
    RAISE EXCEPTION 'O código da campanha deve ter pelo menos 3 caracteres alfanuméricos.';
  END IF;

  IF coalesce(trim(p_nome), '') = '' THEN
    RAISE EXCEPTION 'Informe um nome descritivo para a campanha.';
  END IF;

  IF p_dias_trial < 1 OR p_dias_trial > 365 THEN
    RAISE EXCEPTION 'A quantidade de dias de trial deve ser entre 1 e 365 dias.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.plans WHERE codigo = lower(trim(p_plano))) THEN
    RAISE EXCEPTION 'Plano informado inválido.';
  END IF;

  IF p_id IS NOT NULL THEN
    -- Edição
    UPDATE public.campanhas_lancamento
    SET 
      codigo = v_codigo_limpo,
      nome = trim(p_nome),
      plano = lower(trim(p_plano)),
      dias_trial = p_dias_trial,
      limite_usos = p_limite_usos,
      valido_ate = p_valido_ate,
      ativo = p_ativo,
      titulo_destaque = trim(p_titulo_destaque),
      descricao = trim(p_descricao),
      beneficios = p_beneficios,
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_id;
  ELSE
    -- Criação
    INSERT INTO public.campanhas_lancamento (
      codigo, nome, plano, dias_trial, limite_usos, valido_ate, ativo, titulo_destaque, descricao, beneficios
    ) VALUES (
      v_codigo_limpo, trim(p_nome), lower(trim(p_plano)), p_dias_trial, p_limite_usos, p_valido_ate, p_ativo, trim(p_titulo_destaque), trim(p_descricao), p_beneficios
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_salvar_campanha_lancamento(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, TIMESTAMPTZ, BOOLEAN, TEXT, TEXT, TEXT[]) TO authenticated;

-- 6. RPC: ADMIN_TOGGLE_CAMPANHA_LANCAMENTO
CREATE OR REPLACE FUNCTION public.admin_toggle_campanha_lancamento(
  p_id UUID,
  p_ativo BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Permissão negada.';
  END IF;

  UPDATE public.campanhas_lancamento
  SET ativo = p_ativo, updated_at = now()
  WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_toggle_campanha_lancamento(UUID, BOOLEAN) TO authenticated;

-- 7. RPC PÚBLICA: OBTER_CAMPANHA_LANCAMENTO_PUBLICA
CREATE OR REPLACE FUNCTION public.obter_campanha_lancamento_publica(p_codigo TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campanha RECORD;
  v_plano_nome TEXT;
  v_valida BOOLEAN := true;
  v_motivo_invalido TEXT := NULL;
BEGIN
  SELECT c.*, p.nome AS nome_plano INTO v_campanha
  FROM public.campanhas_lancamento c
  LEFT JOIN public.plans p ON p.codigo = c.plano
  WHERE upper(c.codigo) = upper(trim(p_codigo));

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valida', false, 'motivo', 'Campanha ou código de convite não encontrado.');
  END IF;

  IF NOT v_campanha.ativo THEN
    v_valida := false;
    v_motivo_invalido := 'Esta campanha de lançamento foi encerrada temporariamente.';
  ELSIF v_campanha.valido_ate IS NOT NULL AND v_campanha.valido_ate <= now() THEN
    v_valida := false;
    v_motivo_invalido := 'O prazo de validade desta campanha já expirou.';
  ELSIF v_campanha.limite_usos IS NOT NULL AND v_campanha.total_usos >= v_campanha.limite_usos THEN
    v_valida := false;
    v_motivo_invalido := 'Todas as vagas promocionais desta campanha foram preenchidas.';
  END IF;

  RETURN jsonb_build_object(
    'valida', v_valida,
    'motivo', v_motivo_invalido,
    'codigo', v_campanha.codigo,
    'nome', v_campanha.nome,
    'plano', v_campanha.plano,
    'plano_nome', v_campanha.nome_plano,
    'dias_trial', v_campanha.dias_trial,
    'limite_usos', v_campanha.limite_usos,
    'total_usos', v_campanha.total_usos,
    'vagas_restantes', CASE WHEN v_campanha.limite_usos IS NOT NULL THEN GREATEST(0, v_campanha.limite_usos - v_campanha.total_usos) ELSE NULL END,
    'valido_ate', v_campanha.valido_ate,
    'titulo_destaque', v_campanha.titulo_destaque,
    'descricao', v_campanha.descricao,
    'beneficios', v_campanha.beneficios
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_campanha_lancamento_publica(TEXT) TO anon, authenticated;

-- 8. ATUALIZAR CRIAR_OFICINA COM SUPORTE A P_CODIGO_CAMPANHA
CREATE OR REPLACE FUNCTION public.criar_oficina(
  p_nome text,
  p_cidade text,
  p_uf text,
  p_telefone text,
  p_codigo_indicacao text DEFAULT NULL,
  p_codigo_parceiro text DEFAULT NULL,
  p_documento text DEFAULT NULL,
  p_codigo_campanha text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE 
  v_tenant uuid; 
  v_slug text;
  v_trial_fim date;
  v_plano_inicial text := 'pro';
  v_valor_centavos integer := 6700;
  v_dias_trial_concedidos integer := 14;
  v_codigo_proprio text;
  v_parceiro RECORD;
  v_indicador RECORD;
  v_campanha RECORD;
  v_campanha_usada text := NULL;
  v_indicado_email text;
  v_indicador_email text;
  v_indicador_tel text;
  v_indicador_doc text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário precisa estar autenticado para criar oficina.';
  END IF;

  IF coalesce(trim(p_nome), '') = '' THEN
    RAISE EXCEPTION 'Informe o nome da oficina.';
  END IF;

  IF (
    SELECT count(*) FROM public.tenant_members
    WHERE user_id = auth.uid() AND role = 'dono' AND status IN ('ativo', 'convidado')
  ) >= 3 THEN
    RAISE EXCEPTION 'Limite de oficinas por usuário atingido.';
  END IF;

  -- 0. Validar e Aplicar Campanha de Lançamento se informada
  IF p_codigo_campanha IS NOT NULL AND trim(p_codigo_campanha) != '' THEN
    SELECT * INTO v_campanha FROM public.campanhas_lancamento
    WHERE upper(codigo) = upper(trim(p_codigo_campanha)) AND ativo = true;

    IF FOUND 
       AND (v_campanha.valido_ate IS NULL OR v_campanha.valido_ate > now())
       AND (v_campanha.limite_usos IS NULL OR v_campanha.total_usos < v_campanha.limite_usos) THEN
      
      v_plano_inicial := v_campanha.plano;
      v_dias_trial_concedidos := v_campanha.dias_trial;
      v_campanha_usada := v_campanha.nome;

      IF v_plano_inicial = 'studio' THEN
        v_valor_centavos := 18900;
      ELSE
        v_valor_centavos := 6700;
      END IF;

      -- Incrementar uso da campanha de lançamento
      UPDATE public.campanhas_lancamento
      SET total_usos = total_usos + 1, updated_at = now()
      WHERE id = v_campanha.id;
    END IF;
  END IF;

  v_slug := lower(regexp_replace(p_nome, '[^a-zA-Z0-9]+', '-', 'g'))
            || '-' || substr(gen_random_uuid()::text, 1, 6);

  v_trial_fim := (current_date + v_dias_trial_concedidos);
  v_codigo_proprio := public.gerar_codigo_indicacao_unico();

  -- 1. Criar Tenant com o plano definido pela campanha (ou default 'pro')
  INSERT INTO public.tenants (nome, slug, cidade, uf, telefone, documento, criado_por, plano, codigo_indicacao)
    VALUES (p_nome, v_slug, p_cidade, p_uf, p_telefone, p_documento, auth.uid(), v_plano_inicial, v_codigo_proprio)
    RETURNING id INTO v_tenant;

  -- 2. Criar Membro Dono
  INSERT INTO public.tenant_members (tenant_id, user_id, email, role, status)
    VALUES (
      v_tenant, 
      auth.uid(),
      (SELECT email FROM auth.users WHERE id = auth.uid()),
      'dono', 
      'ativo'
    );

  -- 3. Registrar Assinatura Inicial com o Trial Customizado da Campanha
  INSERT INTO public.assinaturas (
    tenant_id, plano, status, valor_centavos, trial_fim, created_at, updated_at
  ) VALUES (
    v_tenant, v_plano_inicial, 'trial', v_valor_centavos, v_trial_fim, now(), now()
  ) ON CONFLICT (tenant_id) DO UPDATE
  SET plano = EXCLUDED.plano, status = 'trial', trial_fim = EXCLUDED.trial_fim, updated_at = now();

  -- 4. Semeadura de 7 Categorias Padrão
  INSERT INTO public.categorias_veiculo (tenant_id, nome, descricao, ordem, ativo)
  VALUES
    (v_tenant, 'Hatch', 'Onix, HB20, Gol, Argo, Polo', 0, true),
    (v_tenant, 'Sedan', 'Corolla, Civic, Virtus, Cronos, Onix Plus', 1, true),
    (v_tenant, 'SUV', 'Creta, Compass, T-Cross, Renegade, Tracker', 2, true),
    (v_tenant, 'Caminhonete', 'Hilux, S10, Ranger, Toro, Strada', 3, true),
    (v_tenant, 'Van / Utilitário', 'Kombi, Master, Sprinter, Ducato', 4, false),
    (v_tenant, 'Caminhão', 'Veículos pesados', 5, false),
    (v_tenant, 'Moto', 'Todas as cilindradas', 6, false)
  ON CONFLICT (tenant_id, nome) DO NOTHING;

  -- 5. Semeadura de 7 Horários de Funcionamento
  PERFORM public.seed_horarios_funcionamento_tenant(v_tenant);

  -- 6. Semeadura de 5 Formas de Pagamento
  PERFORM public.seed_formas_pagamento_tenant(v_tenant);

  -- 7. Semeadura de 1 Maquininha Padrão
  IF NOT EXISTS (SELECT 1 FROM public.tenant_maquininhas WHERE tenant_id = v_tenant AND padrao = true) THEN
    INSERT INTO public.tenant_maquininhas (tenant_id, nome, padrao, ordem)
    VALUES (v_tenant, 'Maquininha Padrão', true, 1);
  END IF;

  -- 8. Processar Código de PARCEIRO (Precedência Absoluta)
  IF p_codigo_parceiro IS NOT NULL AND trim(p_codigo_parceiro) != '' THEN
    SELECT * INTO v_parceiro FROM public.parceiros 
    WHERE codigo = upper(trim(p_codigo_parceiro)) AND ativo = true;

    IF FOUND THEN
      INSERT INTO public.parceiro_oficinas (parceiro_id, tenant_id)
      VALUES (v_parceiro.id, v_tenant)
      ON CONFLICT (tenant_id) DO NOTHING;
    END IF;
  END IF;

  -- 9. Processar Código de INDICAÇÃO (Criando como PENDENTE)
  IF (p_codigo_parceiro IS NULL OR trim(p_codigo_parceiro) = '') 
     AND p_codigo_indicacao IS NOT NULL AND trim(p_codigo_indicacao) != '' THEN
    SELECT * INTO v_indicador FROM public.tenants 
    WHERE codigo_indicacao = upper(trim(p_codigo_indicacao));

    IF FOUND AND v_indicador.id != v_tenant THEN
      SELECT email INTO v_indicado_email FROM auth.users WHERE id = auth.uid();
      
      SELECT u.email, t.telefone, t.documento INTO v_indicador_email, v_indicador_tel, v_indicador_doc
      FROM public.tenants t
      JOIN public.tenant_members tm ON tm.tenant_id = t.id AND tm.role = 'dono'
      JOIN auth.users u ON u.id = tm.user_id
      WHERE t.id = v_indicador.id LIMIT 1;

      IF lower(trim(coalesce(v_indicado_email,''))) != lower(trim(coalesce(v_indicador_email,'')))
         AND NOT (length(trim(coalesce(p_telefone,''))) > 5 AND trim(p_telefone) = trim(coalesce(v_indicador_tel,'')))
         AND NOT (length(trim(coalesce(p_documento,''))) > 5 AND trim(p_documento) = trim(coalesce(v_indicador_doc,''))) THEN
        
        INSERT INTO public.indicacoes (indicador_tenant_id, indicado_tenant_id, codigo, status, convertida_em)
        VALUES (v_indicador.id, v_tenant, upper(trim(p_codigo_indicacao)), 'pendente', NULL)
        ON CONFLICT (indicado_tenant_id) DO NOTHING;
      END IF;
    END IF;
  END IF;

  -- 10. Notificar Admin sobre a Nova Oficina
  PERFORM public.criar_notificacao_interna(
    v_tenant,
    auth.uid(),
    'admin',
    'operador',
    'nova_oficina',
    '🏢 Nova Oficina Cadastrada',
    'A oficina "' || p_nome || '" (' || coalesce(p_cidade, '-') || '/' || coalesce(p_uf, '-') || ') iniciou o Trial ' || upper(v_plano_inicial) || ' de ' || v_dias_trial_concedidos || ' dias' || CASE WHEN v_campanha_usada IS NOT NULL THEN ' (Campanha: ' || v_campanha_usada || ')' ELSE '' END || '.',
    '/admin/oficinas',
    jsonb_build_object('tenant_id', v_tenant, 'plano', v_plano_inicial, 'dias_trial', v_dias_trial_concedidos, 'campanha', v_campanha_usada)
  );

  RETURN v_tenant;
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_oficina(text, text, text, text, text, text, text, text) TO authenticated;
