-- ==============================================================================
-- MIGRAÇÃO 0171: ONBOARDING PROGRESSIVO, BOAS-VINDAS ÚNICO E SEED AUTOMÁTICO
-- ==============================================================================
-- 1. Adiciona colunas de Onboarding Progressivo em public.tenants:
--    - welcome_modal_seen (exibe o modal de boas-vindas apenas uma única vez)
--    - onboarding_progress (flags JSONB manuais e de revisão das abas)
--    - onboarding_widget_oculto (permite ocultar o guia após concluir 100%)
-- 2. Cria public.seed_servicos_iniciais_tenant(UUID) respeitando plan_limits
--    e populando servico_precos com preços médios sugeridos por categoria
--    (duracao_confirmada = false para sinalizar ajuste regional ao dono).
-- 3. Atualiza public.criar_oficina mantendo 100% da lógica de trial/campanhas
--    e restaurando seed_horarios_funcionamento_tenant + seed_servicos_iniciais_tenant.
-- 4. Executa backfill seguro para:
--    - marcar welcome_modal_seen = true em contas já ativas;
--    - semear horários e serviços padrão nos leads presos com conta vazia (0158),
--      preservando welcome_modal_seen = false para quem ainda tem 0 orçamentos.
-- 5. Cria RPCs SECURITY DEFINER:
--    - marcar_welcome_modal_visto
--    - atualizar_progresso_onboarding
--    - obter_status_onboarding
-- ==============================================================================

-- 1. COLUNAS EM PUBLIC.TENANTS
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS welcome_modal_seen BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS onboarding_widget_oculto BOOLEAN NOT NULL DEFAULT false;

-- 2. HELPER INTERNO PARA SEMEADURA DE SERVIÇOS INICIAIS + PREÇOS MÉDIOS DE MERCADO
CREATE OR REPLACE FUNCTION public.seed_servicos_iniciais_tenant(p_tenant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_plano TEXT := 'free';
  v_limite INTEGER := NULL;
  v_atuais INTEGER := 0;
  v_inseridos INTEGER := 0;
  v_modelo RECORD;
  v_servico_id UUID;
  v_servico_ativo BOOLEAN;
  v_checklist_id UUID;
  v_cat RECORD;
  v_preco_hatch NUMERIC(10,2);
  v_mult NUMERIC(6,2);
  v_preco_calc NUMERIC(10,2);
  v_cat_nome TEXT;
BEGIN
  IF p_tenant_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(t.plano, 'free')
  INTO v_plano
  FROM public.tenants t
  WHERE t.id = p_tenant_id;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Lê o teto de serviços configurado em plan_limits para o plano atual
  SELECT pl.limite
  INTO v_limite
  FROM public.plan_limits pl
  WHERE pl.plano = v_plano
    AND pl.recurso = 'servicos'
  LIMIT 1;

  -- Conta serviços ativos já existentes
  SELECT COUNT(*)::integer
  INTO v_atuais
  FROM public.servicos s
  WHERE s.tenant_id = p_tenant_id
    AND COALESCE(s.ativo, true) = true;

  FOR v_modelo IN
    SELECT
      sm.codigo,
      sm.nome,
      sm.grupo,
      sm.descricao_publica,
      sm.modo_ocupacao,
      sm.duracao_sugerida,
      sm.ordem
    FROM public.servicos_modelo sm
    ORDER BY sm.ordem ASC, sm.codigo ASC
  LOOP
    v_servico_id := NULL;
    v_servico_ativo := false;
    v_checklist_id := NULL;

    SELECT s.id, COALESCE(s.ativo, true)
    INTO v_servico_id, v_servico_ativo
    FROM public.servicos s
    WHERE s.tenant_id = p_tenant_id
      AND lower(trim(s.nome)) = lower(trim(v_modelo.nome))
    ORDER BY COALESCE(s.ativo, true) DESC, s.created_at DESC
    LIMIT 1;

    -- Vincula checklist modelo se existir para este tenant com nome equivalente
    SELECT cm.id
    INTO v_checklist_id
    FROM public.checklist_modelos cm
    WHERE cm.tenant_id = p_tenant_id
      AND lower(trim(cm.nome)) = lower(trim(v_modelo.nome))
    LIMIT 1;

    IF v_servico_id IS NULL THEN
      -- Respeita rigorosamente o limite do plano antes de inserir (evita exception no trigger trg_check_limite_servicos)
      IF v_limite IS NOT NULL AND v_atuais >= v_limite THEN
        EXIT;
      END IF;

      INSERT INTO public.servicos (
        tenant_id,
        nome,
        grupo,
        descricao_publica,
        codigo,
        modo_ocupacao,
        dias_ocupados,
        publico,
        sob_consulta,
        tom,
        ordem,
        ativo,
        checklist_modelo_id
      ) VALUES (
        p_tenant_id,
        v_modelo.nome,
        v_modelo.grupo,
        v_modelo.descricao_publica,
        v_modelo.codigo,
        COALESCE(v_modelo.modo_ocupacao, 'slot'),
        CASE WHEN v_modelo.modo_ocupacao = 'multiplos_dias' THEN 2 ELSE 1 END,
        false,
        false,
        'vapor',
        COALESCE(v_modelo.ordem, 0),
        true,
        v_checklist_id
      )
      RETURNING id INTO v_servico_id;

      v_atuais := v_atuais + 1;
      v_inseridos := v_inseridos + 1;
    ELSIF NOT v_servico_ativo THEN
      IF v_limite IS NOT NULL AND v_atuais >= v_limite THEN
        CONTINUE;
      END IF;

      UPDATE public.servicos
      SET ativo = true,
          checklist_modelo_id = COALESCE(checklist_modelo_id, v_checklist_id),
          updated_at = now()
      WHERE id = v_servico_id;

      v_atuais := v_atuais + 1;
    END IF;

    -- Preço médio base de referência (Hatch Pequeno) no mercado brasileiro de estética automotiva
    v_preco_hatch := CASE v_modelo.codigo
      WHEN 'LV-01' THEN 50.00   -- Lavagem Simples
      WHEN 'LV-04' THEN 90.00   -- Lavagem Detalhada Externa
      WHEN 'LV-02' THEN 140.00  -- Lavagem Detalhada
      WHEN 'LV-05' THEN 100.00  -- Lavagem Detalhada Interna
      WHEN 'LV-03' THEN 120.00  -- Lavagem Técnica de Motor
      WHEN 'HG-01' THEN 280.00  -- Higienização Interna
      WHEN 'HG-02' THEN 180.00  -- Higienização de Bancos
      WHEN 'HG-03' THEN 90.00   -- Higienização de Ar-Condicionado
      WHEN 'PL-01' THEN 450.00  -- Polimento Comercial
      WHEN 'PL-02' THEN 850.00  -- Polimento Técnico
      WHEN 'PL-03' THEN 1200.00 -- Correção de Pintura
      WHEN 'VT-01' THEN 120.00  -- Cristalização de Vidros
      WHEN 'VT-09' THEN 1500.00 -- Vitrificação de Pintura
      WHEN 'PR-01' THEN 120.00  -- Cera de Proteção
      WHEN 'PR-02' THEN 250.00  -- Impermeabilização de Bancos
      ELSE 120.00
    END;

    -- Popula matriz de preços por categoria ativa com duracao_confirmada = false
    FOR v_cat IN
      SELECT cv.id, cv.nome
      FROM public.categorias_veiculo cv
      WHERE cv.tenant_id = p_tenant_id
        AND COALESCE(cv.ativo, true) = true
    LOOP
      v_cat_nome := lower(coalesce(v_cat.nome, ''));

      IF v_cat_nome LIKE '%moto%' THEN
        v_mult := 0.55;
      ELSIF v_cat_nome LIKE '%esport%' OR v_cat_nome LIKE '%coupe%' OR v_cat_nome LIKE '%cup%' THEN
        v_mult := 1.45;
      ELSIF v_cat_nome LIKE '%van%' OR v_cat_nome LIKE '%utilit%' OR v_cat_nome LIKE '%caminh%' THEN
        v_mult := 1.50;
      ELSIF v_cat_nome LIKE '%suv%' OR v_cat_nome LIKE '%caminhonet%' OR v_cat_nome LIKE '%pickup%' OR v_cat_nome LIKE '%4x4%' THEN
        v_mult := 1.35;
      ELSIF v_cat_nome LIKE '%sedan%' THEN
        v_mult := 1.15;
      ELSE
        v_mult := 1.00;
      END IF;

      -- Arredonda para múltiplos de R$ 5 (mínimo R$ 30) para parecer realista e limpo
      v_preco_calc := GREATEST(30.00, (ROUND((v_preco_hatch * v_mult) / 5.0) * 5.0)::numeric(10,2));

      INSERT INTO public.servico_precos (
        tenant_id,
        servico_id,
        categoria_id,
        preco_base,
        duracao_minutos,
        duracao_confirmada,
        ativo
      ) VALUES (
        p_tenant_id,
        v_servico_id,
        v_cat.id,
        v_preco_calc,
        COALESCE(v_modelo.duracao_sugerida, 60),
        false,
        true
      )
      ON CONFLICT (servico_id, categoria_id) DO UPDATE
        SET preco_base = COALESCE(public.servico_precos.preco_base, EXCLUDED.preco_base),
            duracao_minutos = COALESCE(NULLIF(public.servico_precos.duracao_minutos, 0), EXCLUDED.duracao_minutos),
            ativo = true,
            updated_at = now()
      WHERE public.servico_precos.preco_base IS NULL;
    END LOOP;
  END LOOP;

  RETURN v_inseridos;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_servicos_iniciais_tenant(UUID) FROM public, anon, authenticated;

-- 3. ATUALIZAR CRIAR_OFICINA PRESERVANDO 100% DA LÓGICA DE 0158 + SEED HORÁRIOS E SERVIÇOS
CREATE OR REPLACE FUNCTION public.criar_oficina(
  p_nome text,
  p_cidade text DEFAULT NULL,
  p_uf text DEFAULT NULL,
  p_telefone text DEFAULT NULL,
  p_codigo_indicacao text DEFAULT NULL,
  p_codigo_parceiro text DEFAULT NULL,
  p_codigo_campanha text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID;
  v_slug TEXT;
  v_parceiro RECORD;
  v_indicador RECORD;
  v_codigo_proprio TEXT;
  v_indicado_email TEXT;
  v_indicador_email TEXT;
  v_indicador_tel TEXT;
  v_indicador_doc TEXT;

  v_trial_ativo_config BOOLEAN := true;
  v_dias_trial_config INTEGER := 15;
  v_plano_inicial TEXT := 'pro';
  v_status_inicial TEXT := 'trial';
  v_dias_trial_concedidos INTEGER := 15;
  v_trial_fim DATE;
  v_valor_centavos INTEGER := 5700;

  v_campanha RECORD;
  v_campanha_usada TEXT := NULL;
BEGIN
  -- Validações essenciais
  IF p_nome IS NULL OR trim(p_nome) = '' THEN
    RAISE EXCEPTION 'O nome da oficina é obrigatório';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  -- Validação de duplicidade de nome
  IF EXISTS (
    SELECT 1 FROM public.tenants
    WHERE LOWER(TRIM(nome)) = LOWER(TRIM(p_nome))
  ) THEN
    RAISE EXCEPTION 'Já existe uma oficina cadastrada com o nome "%". Por favor, escolha outro nome para sua oficina.', TRIM(p_nome);
  END IF;

  -- 1. Obter configuração de Trial de Cadastro de forma estrita
  BEGIN
    SELECT 
      COALESCE(trial_cadastro_ativo, trial_ativo, true),
      COALESCE(trial_dias_padrao, trial_dias, 15)
    INTO 
      v_trial_ativo_config,
      v_dias_trial_config
    FROM public.plataforma_config
    WHERE id = 1;
  EXCEPTION WHEN OTHERS THEN
    v_trial_ativo_config := true;
    v_dias_trial_config := 15;
  END;

  IF v_dias_trial_config IS NULL OR v_dias_trial_config <= 0 THEN
    v_dias_trial_config := 15;
  END IF;

  -- 2. Validar campanha de lançamento se informada (permite trial específico se houver campanha ativa)
  IF p_codigo_campanha IS NOT NULL AND trim(p_codigo_campanha) != '' THEN
    BEGIN
      SELECT * INTO v_campanha
      FROM public.campanhas_lancamento
      WHERE upper(trim(codigo)) = upper(trim(p_codigo_campanha))
        AND ativo = true
        AND (expira_em IS NULL OR expira_em > now())
        AND (limite_usos IS NULL OR total_usos < limite_usos)
      LIMIT 1;

      IF FOUND THEN
        v_campanha_usada := v_campanha.codigo;
        v_plano_inicial := COALESCE(v_campanha.plano_concedido, 'pro');
        v_status_inicial := 'trial';
        v_dias_trial_concedidos := COALESCE(v_campanha.dias_trial, v_dias_trial_config);
        v_trial_fim := (current_date + v_dias_trial_concedidos);
        v_valor_centavos := v_campanha.valor_mensal_centavos;

        UPDATE public.campanhas_lancamento
        SET total_usos = total_usos + 1,
            updated_at = now()
        WHERE id = v_campanha.id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_campanha_usada := NULL;
    END;
  END IF;

  -- 3. Definição do plano e trial inicial
  IF v_campanha_usada IS NULL THEN
    -- SE A CHAVE DE DEGUSTAÇÃO ESTIVER DESATIVADA -> ENTRA DIRETO NO FREE SEM TRIAL
    IF NOT v_trial_ativo_config THEN
      v_plano_inicial := 'free';
      v_status_inicial := 'cancelada';
      v_dias_trial_concedidos := 0;
      v_trial_fim := NULL;
      v_valor_centavos := 0;
    ELSE
      v_plano_inicial := 'pro';
      v_status_inicial := 'trial';
      v_dias_trial_concedidos := v_dias_trial_config;
      v_trial_fim := (current_date + v_dias_trial_concedidos);
      
      SELECT preco_centavos INTO v_valor_centavos 
      FROM public.plans 
      WHERE codigo = v_plano_inicial;
      
      IF v_valor_centavos IS NULL THEN
        v_valor_centavos := 5700;
      END IF;
    END IF;
  END IF;

  -- 4. Geração de slug através da função unificada
  v_slug := public.gerar_slug_oficina(p_nome);
  v_codigo_proprio := public.gerar_codigo_indicacao_unico();

  -- 5. Criar Tenant
  INSERT INTO public.tenants (
    nome, slug, cidade, uf, telefone, criado_por, plano, codigo_indicacao
  ) VALUES (
    p_nome, v_slug, p_cidade, p_uf, p_telefone, auth.uid(), v_plano_inicial, v_codigo_proprio
  ) RETURNING id INTO v_tenant;

  -- 6. Criar Membro Dono
  INSERT INTO public.tenant_members (tenant_id, user_id, email, role, status)
  VALUES (
    v_tenant, 
    auth.uid(),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    'dono', 
    'ativo'
  );

  -- 7. Registrar Assinatura Inicial
  INSERT INTO public.assinaturas (
    tenant_id, plano, status, ciclo, valor_centavos, trial_fim, created_at, updated_at
  ) VALUES (
    v_tenant, v_plano_inicial, v_status_inicial, 'mensal', v_valor_centavos, v_trial_fim, now(), now()
  ) ON CONFLICT (tenant_id) DO UPDATE
  SET plano = EXCLUDED.plano, 
      status = EXCLUDED.status, 
      valor_centavos = EXCLUDED.valor_centavos,
      trial_fim = EXCLUDED.trial_fim, 
      updated_at = now();

  -- 8. Categorias de Veículo padrão
  INSERT INTO public.categorias_veiculo (tenant_id, nome, ordem, ativo) VALUES
    (v_tenant, 'Hatch Pequeno', 1, true),
    (v_tenant, 'Sedan Médio', 2, true),
    (v_tenant, 'SUV / Caminhonete', 3, true),
    (v_tenant, 'Esportivo / Coupe', 4, true),
    (v_tenant, 'Moto', 5, true);

  -- 9. Formas de pagamento padrão
  BEGIN
    INSERT INTO public.tenant_formas_pagamento (tenant_id, nome, tipo, taxa_padrao, ativo, ordem) VALUES
      (v_tenant, 'Dinheiro', 'dinheiro', 0.00, true, 1),
      (v_tenant, 'PIX', 'pix', 0.00, true, 2),
      (v_tenant, 'Cartão de Débito', 'debito', 1.99, true, 3),
      (v_tenant, 'Cartão de Crédito à Vista', 'credito_vista', 3.49, true, 4);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  IF NOT EXISTS (SELECT 1 FROM public.tenant_maquininhas WHERE tenant_id = v_tenant AND padrao = true) THEN
    INSERT INTO public.tenant_maquininhas (tenant_id, nome, padrao, ordem)
    VALUES (v_tenant, 'Maquininha Padrão', true, 1);
  END IF;

  -- 9.5. Horários padrão (segunda a sábado) + Serviços modelo com preços médios sugeridos
  PERFORM public.seed_horarios_funcionamento_tenant(v_tenant);
  PERFORM public.seed_servicos_iniciais_tenant(v_tenant);

  -- 10. Checagem e Vinculação de Parceiro
  BEGIN
    IF p_codigo_parceiro IS NOT NULL AND trim(p_codigo_parceiro) != '' THEN
      SELECT * INTO v_parceiro FROM public.parceiros 
      WHERE upper(codigo) = upper(trim(p_codigo_parceiro)) AND ativo = true;

      IF FOUND THEN
        INSERT INTO public.parceiro_oficinas (parceiro_id, tenant_id)
        VALUES (v_parceiro.id, v_tenant)
        ON CONFLICT (tenant_id) DO UPDATE SET parceiro_id = EXCLUDED.parceiro_id;
      END IF;
    ELSIF p_codigo_indicacao IS NOT NULL AND trim(p_codigo_indicacao) != '' THEN
      SELECT * INTO v_parceiro FROM public.parceiros 
      WHERE upper(codigo) = upper(trim(p_codigo_indicacao)) AND ativo = true;

      IF FOUND THEN
        INSERT INTO public.parceiro_oficinas (parceiro_id, tenant_id)
        VALUES (v_parceiro.id, v_tenant)
        ON CONFLICT (tenant_id) DO UPDATE SET parceiro_id = EXCLUDED.parceiro_id;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- 11. Indicação entre Oficinas
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.parceiro_oficinas WHERE tenant_id = v_tenant)
       AND p_codigo_indicacao IS NOT NULL AND trim(p_codigo_indicacao) != '' THEN
      SELECT * INTO v_indicador FROM public.tenants 
      WHERE upper(codigo_indicacao) = upper(trim(p_codigo_indicacao));

      IF FOUND AND v_indicador.id != v_tenant THEN
        SELECT email INTO v_indicado_email FROM auth.users WHERE id = auth.uid();
        
        SELECT u.email, t.telefone, t.documento INTO v_indicador_email, v_indicador_tel, v_indicador_doc
        FROM public.tenants t
        JOIN auth.users u ON u.id = t.criado_por
        WHERE t.id = v_indicador.id;

        INSERT INTO public.indicacoes_oficina (
          indicador_tenant_id,
          indicado_tenant_id,
          status,
          indicado_nome_oficina,
          indicado_email,
          indicador_email,
          indicador_telefone,
          indicador_documento
        ) VALUES (
          v_indicador.id,
          v_tenant,
          'pendente',
          p_nome,
          v_indicado_email,
          v_indicador_email,
          v_indicador_tel,
          v_indicador_doc
        ) ON CONFLICT (indicado_tenant_id) DO NOTHING;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- 12. Notificação ao Administrador
  BEGIN
    PERFORM public.notificar_admin(
      'nova_oficina',
      'Nova Oficina Cadastrada: ' || p_nome,
      'A oficina "' || p_nome || '" (' || coalesce(p_cidade, 'Sem cidade') || '/' || coalesce(p_uf, 'UF') || ') acabou de se cadastrar no plano ' || upper(v_plano_inicial) || '.',
      '/admin/oficinas',
      jsonb_build_object('tenant_id', v_tenant, 'nome', p_nome, 'plano', v_plano_inicial, 'trial_fim', v_trial_fim, 'campanha', v_campanha_usada)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_tenant;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.criar_oficina(text, text, text, text, text, text, text) TO authenticated;

-- 4. BACKFILL DE CONTAS EXISTENTES E RESGATE DE LEADS COM CONTA VAZIA (IMPACTO 0158)
DO $$
DECLARE
  v_rec RECORD;
BEGIN
  -- A) Oficinas já ativas (onboarding concluído, ou já possuem orçamentos/agendamentos)
  --    não são interrompidas novamente pelo Modal de Boas-Vindas.
  UPDATE public.tenants t
  SET welcome_modal_seen = true
  WHERE COALESCE(t.welcome_modal_seen, false) = false
    AND (
      COALESCE(t.onboarding_concluido, false) = true
      OR EXISTS (SELECT 1 FROM public.orcamentos o WHERE o.tenant_id = t.id)
      OR EXISTS (SELECT 1 FROM public.agendamentos a WHERE a.tenant_id = t.id)
    );

  -- B) Garante horários padrão para qualquer oficina criada após 0158 que esteja sem os 7 dias semeados
  FOR v_rec IN
    SELECT t.id
    FROM public.tenants t
    WHERE (
      SELECT COUNT(*) FROM public.horarios_funcionamento h WHERE h.tenant_id = t.id
    ) < 7
  LOOP
    BEGIN
      PERFORM public.seed_horarios_funcionamento_tenant(v_rec.id);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;

  -- C) Resgate dos leads recentes com 0 serviços ativos e 0 orçamentos:
  --    semeia categorias (se faltarem), horários e serviços padrão respeitando o plan_limits,
  --    mantendo welcome_modal_seen = false para que vejam o novo fluxo na próxima entrada.
  FOR v_rec IN
    SELECT t.id
    FROM public.tenants t
    WHERE NOT EXISTS (
      SELECT 1 FROM public.servicos s
      WHERE s.tenant_id = t.id AND COALESCE(s.ativo, true) = true
    )
      AND NOT EXISTS (
        SELECT 1 FROM public.orcamentos o
        WHERE o.tenant_id = t.id
      )
  LOOP
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM public.categorias_veiculo cv
        WHERE cv.tenant_id = v_rec.id AND COALESCE(cv.ativo, true) = true
      ) THEN
        INSERT INTO public.categorias_veiculo (tenant_id, nome, ordem, ativo) VALUES
          (v_rec.id, 'Hatch Pequeno', 1, true),
          (v_rec.id, 'Sedan Médio', 2, true),
          (v_rec.id, 'SUV / Caminhonete', 3, true),
          (v_rec.id, 'Esportivo / Coupe', 4, true),
          (v_rec.id, 'Moto', 5, true)
        ON CONFLICT (tenant_id, nome) DO UPDATE SET ativo = true;
      END IF;

      PERFORM public.seed_horarios_funcionamento_tenant(v_rec.id);
      PERFORM public.seed_servicos_iniciais_tenant(v_rec.id);

      -- Mantém welcome_modal_seen = false para leads com 0 orçamentos e sem operação iniciada
      UPDATE public.tenants
      SET welcome_modal_seen = false
      WHERE id = v_rec.id
        AND COALESCE(onboarding_concluido, false) = false
        AND NOT EXISTS (SELECT 1 FROM public.orcamentos o WHERE o.tenant_id = v_rec.id)
        AND NOT EXISTS (SELECT 1 FROM public.agendamentos a WHERE a.tenant_id = v_rec.id);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END $$;

-- 5. RPC: MARCAR MODAL DE BOAS-VINDAS COMO VISTO
CREATE OR REPLACE FUNCTION public.marcar_welcome_modal_visto(p_tenant_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_tenant_id UUID;
  v_autorizado BOOLEAN := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  v_target_tenant_id := COALESCE(p_tenant_id, (SELECT public.meus_tenants() LIMIT 1));
  IF v_target_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma oficina localizada para este usuário';
  END IF;

  SELECT (
    (v_target_tenant_id IN (SELECT public.meus_tenants()) AND public.tem_papel(v_target_tenant_id, ARRAY['dono', 'gerente']::public.app_role[]))
    OR public.is_platform_admin()
  ) INTO v_autorizado;

  IF NOT COALESCE(v_autorizado, false) THEN
    RAISE EXCEPTION 'Acesso negado: apenas donos ou gerentes podem atualizar o onboarding desta oficina.';
  END IF;

  UPDATE public.tenants
  SET welcome_modal_seen = true,
      updated_at = now()
  WHERE id = v_target_tenant_id;

  RETURN jsonb_build_object(
    'sucesso', true,
    'tenant_id', v_target_tenant_id,
    'welcome_modal_seen', true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.marcar_welcome_modal_visto(UUID) TO authenticated;

-- 6. RPC: ATUALIZAR PROGRESSO DO ONBOARDING PROGRESSIVO (MERGE SEGURO + OCULTAR WIDGET)
CREATE OR REPLACE FUNCTION public.atualizar_progresso_onboarding(
  p_tenant_id UUID DEFAULT NULL,
  p_chaves JSONB DEFAULT '{}'::jsonb,
  p_ocultar_widget BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_tenant_id UUID;
  v_autorizado BOOLEAN := false;
  v_atual JSONB;
  v_novo JSONB;
  v_manual JSONB;
  v_merged JSONB;
  v_oculto_final BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  v_target_tenant_id := COALESCE(p_tenant_id, (SELECT public.meus_tenants() LIMIT 1));
  IF v_target_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma oficina localizada para este usuário';
  END IF;

  SELECT (
    (v_target_tenant_id IN (SELECT public.meus_tenants()) AND public.tem_papel(v_target_tenant_id, ARRAY['dono', 'gerente']::public.app_role[]))
    OR public.is_platform_admin()
  ) INTO v_autorizado;

  IF NOT COALESCE(v_autorizado, false) THEN
    RAISE EXCEPTION 'Acesso negado: apenas donos ou gerentes podem atualizar o progresso da oficina.';
  END IF;

  SELECT COALESCE(onboarding_progress, '{}'::jsonb), COALESCE(onboarding_widget_oculto, false)
  INTO v_atual, v_oculto_final
  FROM public.tenants
  WHERE id = v_target_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oficina não encontrada';
  END IF;

  v_atual := COALESCE(v_atual, '{}'::jsonb);
  v_novo := COALESCE(p_chaves, '{}'::jsonb);

  IF v_novo ? 'manual' AND jsonb_typeof(v_novo->'manual') = 'object' THEN
    v_manual := COALESCE(v_atual->'manual', '{}'::jsonb) || COALESCE(v_novo->'manual', '{}'::jsonb);
    v_merged := v_atual || (v_novo - 'manual');
    v_merged := jsonb_set(v_merged, '{manual}', v_manual, true);
  ELSE
    v_merged := v_atual || v_novo;
  END IF;

  IF p_ocultar_widget IS NOT NULL THEN
    v_oculto_final := p_ocultar_widget;
  END IF;

  UPDATE public.tenants
  SET onboarding_progress = v_merged,
      onboarding_widget_oculto = v_oculto_final,
      updated_at = now()
  WHERE id = v_target_tenant_id;

  RETURN jsonb_build_object(
    'sucesso', true,
    'tenant_id', v_target_tenant_id,
    'onboarding_progress', v_merged,
    'onboarding_widget_oculto', v_oculto_final
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.atualizar_progresso_onboarding(UUID, JSONB, BOOLEAN) TO authenticated;

-- 7. RPC: OBTER STATUS CONSOLIDADO DO ONBOARDING PROGRESSIVO (UMA ÚNICA CONSULTA)
CREATE OR REPLACE FUNCTION public.obter_status_onboarding(p_tenant_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_tenant_id UUID;
  v_autorizado BOOLEAN := false;
  v_tenant RECORD;
  v_servicos_count INTEGER := 0;
  v_servicos_confirmados_count INTEGER := 0;
  v_orcamentos_count INTEGER := 0;
  v_termos_garantia_count INTEGER := 0;
  v_membros_count INTEGER := 0;
  v_horarios_count INTEGER := 0;
  v_tem_logo BOOLEAN := false;
  v_tem_identidade BOOLEAN := false;
  v_tem_pix BOOLEAN := false;
  v_sinal_ativo BOOLEAN := false;
  v_tem_termo_resp BOOLEAN := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  v_target_tenant_id := COALESCE(p_tenant_id, (SELECT public.meus_tenants() LIMIT 1));
  IF v_target_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma oficina localizada para este usuário';
  END IF;

  SELECT (
    v_target_tenant_id IN (SELECT public.meus_tenants())
    OR public.is_platform_admin()
  ) INTO v_autorizado;

  IF NOT COALESCE(v_autorizado, false) THEN
    RAISE EXCEPTION 'Acesso negado para consultar o status desta oficina.';
  END IF;

  SELECT * INTO v_tenant
  FROM public.tenants
  WHERE id = v_target_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oficina não encontrada';
  END IF;

  v_tem_logo := (
    NULLIF(trim(COALESCE(v_tenant.logo_path, '')), '') IS NOT NULL
    OR NULLIF(trim(COALESCE(v_tenant.logo_url, '')), '') IS NOT NULL
  );

  v_tem_identidade := (
    NULLIF(trim(COALESCE(v_tenant.documento, '')), '') IS NOT NULL
    OR NULLIF(trim(COALESCE(v_tenant.razao_social, '')), '') IS NOT NULL
    OR v_tenant.nome_alterado_em IS NOT NULL
  );

  v_tem_pix := (NULLIF(trim(COALESCE(v_tenant.pix_chave, '')), '') IS NOT NULL);
  v_sinal_ativo := COALESCE(v_tenant.sinal_ativo, false);
  v_tem_termo_resp := (NULLIF(trim(COALESCE(v_tenant.termo_responsabilidade, '')), '') IS NOT NULL);

  SELECT COUNT(*)::integer
  INTO v_servicos_count
  FROM public.servicos s
  WHERE s.tenant_id = v_target_tenant_id
    AND COALESCE(s.ativo, true) = true;

  SELECT COUNT(DISTINCT sp.servico_id)::integer
  INTO v_servicos_confirmados_count
  FROM public.servico_precos sp
  JOIN public.servicos s ON s.id = sp.servico_id
  WHERE sp.tenant_id = v_target_tenant_id
    AND COALESCE(s.ativo, true) = true
    AND COALESCE(sp.ativo, true) = true
    AND COALESCE(sp.duracao_confirmada, false) = true;

  SELECT COUNT(*)::integer
  INTO v_orcamentos_count
  FROM public.orcamentos o
  WHERE o.tenant_id = v_target_tenant_id;

  SELECT COUNT(*)::integer
  INTO v_termos_garantia_count
  FROM public.termos_garantia tg
  WHERE tg.tenant_id = v_target_tenant_id
    AND COALESCE(tg.ativo, true) = true;

  SELECT COUNT(*)::integer
  INTO v_membros_count
  FROM public.tenant_members tm
  WHERE tm.tenant_id = v_target_tenant_id
    AND tm.status IN ('ativo', 'convidado');

  SELECT COUNT(*)::integer
  INTO v_horarios_count
  FROM public.horarios_funcionamento h
  WHERE h.tenant_id = v_target_tenant_id;

  RETURN jsonb_build_object(
    'tenant_id', v_target_tenant_id,
    'plano', COALESCE(v_tenant.plano, 'free'),
    'porte_cidade', COALESCE(v_tenant.porte_cidade, 'interior'),
    'welcome_modal_seen', COALESCE(v_tenant.welcome_modal_seen, false),
    'onboarding_progress', COALESCE(v_tenant.onboarding_progress, '{}'::jsonb),
    'onboarding_widget_oculto', COALESCE(v_tenant.onboarding_widget_oculto, false),
    'onboarding_concluido', COALESCE(v_tenant.onboarding_concluido, false),
    'servicos_count', v_servicos_count,
    'servicos_confirmados_count', v_servicos_confirmados_count,
    'orcamentos_count', v_orcamentos_count,
    'termos_garantia_count', v_termos_garantia_count,
    'membros_count', v_membros_count,
    'horarios_count', v_horarios_count,
    'tem_logo', v_tem_logo,
    'tem_identidade', v_tem_identidade,
    'tem_pix', v_tem_pix,
    'sinal_ativo', v_sinal_ativo,
    'tem_termo_resp_custom', v_tem_termo_resp
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_status_onboarding(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

