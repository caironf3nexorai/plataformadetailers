-- ==============================================================================
-- MIGRAÇÃO 0175: CORRIGIR PREÇOS SUGERIDOS NA SEMEADURA, TRIGGER E OVERLOADS
-- ==============================================================================
-- Corrige a falha em que perfis recém-criados ou que importavam serviços modelo
-- recebiam linhas em public.servico_precos com preco_base = NULL (exibindo avisos
-- de "tabela média carregada" com todos os serviços em "Preço não definido"):
--
-- 1. Cria public.preco_sugerido_servico_modelo(...) centralizando valores médios
--    realistas por serviço modelo e multiplicador exato por categoria de veículo
--    (corrigindo a colisão de '%caminh%' que capturava 'SUV / Caminhonete').
-- 2. Atualiza public.seed_servicos_iniciais_tenant(UUID) garantindo categorias
--    ativas antes da semeadura, respeito estrito ao plan_limits, proteção contra
--    conflito do índice único servicos_tenant_id_nome_ativo_idx e preenchimento
--    de linhas com preco_base IS NULL OR preco_base <= 0.
-- 3. Elimina eventuais overloads legados de criar_oficina (4 e 8 argumentos) e
--    consolida a assinatura canônica de 7 argumentos (alinhada à 0174).
-- 4. Atualiza public.sincronizar_precos_servico(UUID), public.semear_servicos(...)
--    e o trigger public.fn_sincronizar_nova_categoria() para também preencherem
--    automaticamente os preços médios sugeridos dos serviços modelo (sem jamais
--    sobrescrever preços > 0 definidos manualmente ou alterar serviços sob consulta).
-- 5. Cria a RPC public.preencher_precos_sugeridos_tenant(UUID) para recuperação em
--    1 clique no frontend quando houver serviços sem preço definido.
-- 6. Atualiza public.obter_status_onboarding(UUID) adicionando
--    servicos_com_preco_count para feedback honesto no Painel.
-- 7. Executa backfill idempotente para oficinas/serviços sem preços definidos.
-- ==============================================================================


-- ------------------------------------------------------------------------------
-- 1. FUNÇÃO DETERMINÍSTICA DE PREÇO MÉDIO SUGERIDO DE MERCADO
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.preco_sugerido_servico_modelo(
  p_codigo TEXT,
  p_nome TEXT,
  p_categoria_nome TEXT DEFAULT NULL,
  p_grupo TEXT DEFAULT NULL,
  p_permitir_fallback_grupo BOOLEAN DEFAULT false
)
RETURNS NUMERIC(10,2)
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_codigo TEXT := upper(trim(COALESCE(p_codigo, '')));
  v_nome TEXT;
  v_cat TEXT;
  v_grupo TEXT;
  v_base NUMERIC(10,2) := NULL;
  v_mult NUMERIC(6,2) := 1.00;
BEGIN
  v_nome := lower(translate(trim(COALESCE(p_nome, '')),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'));
  v_cat := lower(translate(trim(COALESCE(p_categoria_nome, '')),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'));
  v_grupo := lower(translate(trim(COALESCE(p_grupo, '')),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'));

  -- 1.1 Referência exata por código do catálogo modelo (Hatch Pequeno)
  v_base := CASE v_codigo
    WHEN 'LV-01' THEN 50.00   -- Lavagem Simples
    WHEN 'LV-02' THEN 140.00  -- Lavagem Detalhada
    WHEN 'LV-03' THEN 120.00  -- Lavagem Técnica de Motor
    WHEN 'LV-04' THEN 90.00   -- Lavagem Detalhada Externa
    WHEN 'LV-05' THEN 100.00  -- Lavagem Detalhada Interna
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
    ELSE NULL
  END;

  -- 1.2 Fallback por nome normalizado quando o código foi alterado/omitido
  IF v_base IS NULL AND v_nome <> '' THEN
    IF v_nome = 'lavagem simples' THEN
      v_base := 50.00;
    ELSIF v_nome = 'lavagem detalhada externa' THEN
      v_base := 90.00;
    ELSIF v_nome = 'lavagem detalhada interna' THEN
      v_base := 100.00;
    ELSIF v_nome = 'lavagem detalhada' THEN
      v_base := 140.00;
    ELSIF v_nome LIKE '%motor%' THEN
      v_base := 120.00;
    ELSIF v_nome LIKE '%higienizacao interna%' THEN
      v_base := 280.00;
    ELSIF v_nome LIKE '%banco%' AND (v_nome LIKE '%higien%' OR v_nome LIKE '%limp%' OR v_nome LIKE '%couro%') THEN
      v_base := 180.00;
    ELSIF v_nome LIKE '%ar-condicionado%' OR v_nome LIKE '%ar condicionado%' OR v_nome LIKE '%oxi%' THEN
      v_base := 90.00;
    ELSIF v_nome LIKE '%polimento comercial%' THEN
      v_base := 450.00;
    ELSIF v_nome LIKE '%polimento tecnico%' THEN
      v_base := 850.00;
    ELSIF v_nome LIKE '%correcao de pintura%' OR v_nome LIKE '%correcao pintura%' THEN
      v_base := 1200.00;
    ELSIF v_nome LIKE '%cristalizacao de vidro%' OR v_nome LIKE '%vidro%' THEN
      v_base := 120.00;
    ELSIF v_nome LIKE '%vitrificacao%' OR v_nome LIKE '%ceramica%' THEN
      v_base := 1500.00;
    ELSIF v_nome LIKE '%cera%' THEN
      v_base := 120.00;
    ELSIF v_nome LIKE '%impermeabilizacao%' THEN
      v_base := 250.00;
    ELSIF p_permitir_fallback_grupo THEN
      IF v_nome LIKE '%lavag%' THEN v_base := 90.00;
      ELSIF v_nome LIKE '%higien%' THEN v_base := 220.00;
      ELSIF v_nome LIKE '%poliment%' OR v_nome LIKE '%espelhament%' THEN v_base := 600.00;
      ELSIF v_nome LIKE '%vitrific%' OR v_nome LIKE '%ppf%' OR v_nome LIKE '%pelicula%' THEN v_base := 1200.00;
      ELSIF v_nome LIKE '%encera%' OR v_nome LIKE '%selante%' OR v_nome LIKE '%prote%' THEN v_base := 180.00;
      END IF;
    END IF;
  END IF;

  -- 1.3 Fallback opcional por grupo (uso explícito sob demanda em preencher_precos_sugeridos_tenant)
  IF v_base IS NULL AND p_permitir_fallback_grupo THEN
    v_base := CASE
      WHEN v_grupo LIKE '%lavag%' THEN 90.00
      WHEN v_grupo LIKE '%higien%' THEN 220.00
      WHEN v_grupo LIKE '%poliment%' THEN 600.00
      WHEN v_grupo LIKE '%vidro%' THEN 120.00
      WHEN v_grupo LIKE '%protec%' THEN 220.00
      WHEN v_grupo LIKE '%motor%' THEN 120.00
      ELSE 120.00
    END;
  END IF;

  IF v_base IS NULL THEN
    RETURN NULL;
  END IF;

  -- 1.4 Multiplicador realista por categoria de veículo
  -- (SUV / Caminhonete é avaliada antes de utilitários/caminhão para evitar colisão)
  IF v_cat ~ '(^|[^a-z])moto' OR v_cat LIKE '%motoc%' THEN
    v_mult := 0.55;
  ELSIF v_cat LIKE '%esport%' OR v_cat LIKE '%coupe%' OR v_cat LIKE '%cupe%' THEN
    v_mult := 1.45;
  ELSIF v_cat LIKE '%suv%' OR v_cat LIKE '%caminhonet%' OR v_cat LIKE '%pickup%' OR v_cat LIKE '%picape%' OR v_cat LIKE '%4x4%' THEN
    v_mult := 1.35;
  ELSIF v_cat LIKE '%van%' OR v_cat LIKE '%utilit%' OR v_cat LIKE '%caminhao%' OR v_cat LIKE '%camiao%' OR v_cat LIKE '%furg%' THEN
    v_mult := 1.50;
  ELSIF v_cat LIKE '%sedan%' THEN
    v_mult := 1.15;
  ELSE
    v_mult := 1.00;
  END IF;

  RETURN GREATEST(30.00, (ROUND((v_base * v_mult) / 5.0) * 5.0)::numeric(10,2));
END;
$function$;

REVOKE ALL ON FUNCTION public.preco_sugerido_servico_modelo(TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preco_sugerido_servico_modelo(TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated, service_role;


-- ------------------------------------------------------------------------------
-- 2. SEED INTERNO ROBUSTO DE SERVIÇOS INICIAIS + PREÇOS MÉDIOS SUGERIDOS
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_servicos_iniciais_tenant(p_tenant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
#variable_conflict use_column
DECLARE
  v_plano TEXT := 'free';
  v_limite INTEGER := NULL;
  v_atuais INTEGER := 0;
  v_inseridos INTEGER := 0;
  v_modelo RECORD;
  v_servico_id UUID;
  v_servico_ativo BOOLEAN;
  v_servico_sob_consulta BOOLEAN;
  v_checklist_id UUID;
  v_cat RECORD;
  v_preco_calc NUMERIC(10,2);
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

  -- Garante que existam categorias de veículo ativas antes de gerar a matriz
  IF NOT EXISTS (
    SELECT 1
    FROM public.categorias_veiculo cv
    WHERE cv.tenant_id = p_tenant_id
      AND COALESCE(cv.ativo, true) = true
  ) THEN
    INSERT INTO public.categorias_veiculo (tenant_id, nome, ordem, ativo) VALUES
      (p_tenant_id, 'Hatch Pequeno', 1, true),
      (p_tenant_id, 'Sedan Médio', 2, true),
      (p_tenant_id, 'SUV / Caminhonete', 3, true),
      (p_tenant_id, 'Esportivo / Coupe', 4, true),
      (p_tenant_id, 'Moto', 5, true)
    ON CONFLICT (tenant_id, nome) DO UPDATE SET ativo = true;
  END IF;

  -- Lê o teto de serviços configurado em plan_limits (normalizado em minúsculas)
  SELECT pl.limite
  INTO v_limite
  FROM public.plan_limits pl
  WHERE lower(trim(pl.plano)) = lower(trim(v_plano))
    AND lower(trim(pl.recurso)) = 'servicos'
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
    v_servico_sob_consulta := false;
    v_checklist_id := NULL;

    -- Prioriza serviço com mesmo nome (para evitar colisão no índice único ativo) e depois código modelo
    SELECT s.id, COALESCE(s.ativo, true), COALESCE(s.sob_consulta, false)
    INTO v_servico_id, v_servico_ativo, v_servico_sob_consulta
    FROM public.servicos s
    WHERE s.tenant_id = p_tenant_id
      AND (
        lower(trim(s.nome)) = lower(trim(v_modelo.nome))
        OR (
          NULLIF(trim(COALESCE(v_modelo.codigo, '')), '') IS NOT NULL
          AND upper(trim(COALESCE(s.codigo, ''))) = upper(trim(v_modelo.codigo))
        )
      )
    ORDER BY
      (lower(trim(s.nome)) = lower(trim(v_modelo.nome))) DESC,
      COALESCE(s.ativo, true) DESC,
      s.created_at DESC
    LIMIT 1;

    -- Vincula checklist modelo equivalente se existir
    SELECT cm.id
    INTO v_checklist_id
    FROM public.checklist_modelos cm
    WHERE cm.tenant_id = p_tenant_id
      AND lower(trim(cm.nome)) = lower(trim(v_modelo.nome))
    LIMIT 1;

    IF v_servico_id IS NULL THEN
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

      -- Reativa somente se não houver outro serviço ativo com exatamente o mesmo nome
      IF NOT EXISTS (
        SELECT 1
        FROM public.servicos s2
        JOIN public.servicos s_alvo ON s_alvo.id = v_servico_id
        WHERE s2.tenant_id = p_tenant_id
          AND s2.id <> v_servico_id
          AND COALESCE(s2.ativo, true) = true
          AND lower(trim(s2.nome)) = lower(trim(s_alvo.nome))
      ) THEN
        UPDATE public.servicos
        SET ativo = true,
            checklist_modelo_id = COALESCE(checklist_modelo_id, v_checklist_id),
            updated_at = now()
        WHERE id = v_servico_id;

        v_atuais := v_atuais + 1;
      END IF;
    END IF;

    IF v_servico_sob_consulta THEN
      CONTINUE;
    END IF;

    FOR v_cat IN
      SELECT cv.id, cv.nome
      FROM public.categorias_veiculo cv
      WHERE cv.tenant_id = p_tenant_id
        AND COALESCE(cv.ativo, true) = true
    LOOP
      v_preco_calc := public.preco_sugerido_servico_modelo(
        v_modelo.codigo,
        v_modelo.nome,
        v_cat.nome,
        v_modelo.grupo,
        false
      );

      IF v_preco_calc IS NOT NULL AND v_preco_calc > 0 THEN
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
          SET preco_base = CASE
                WHEN public.servico_precos.preco_base IS NULL OR public.servico_precos.preco_base <= 0
                THEN EXCLUDED.preco_base
                ELSE public.servico_precos.preco_base
              END,
              duracao_minutos = COALESCE(NULLIF(public.servico_precos.duracao_minutos, 0), EXCLUDED.duracao_minutos),
              ativo = true,
              updated_at = now()
        WHERE public.servico_precos.preco_base IS NULL
           OR public.servico_precos.preco_base <= 0;
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_inseridos;
END;
$function$;

REVOKE ALL ON FUNCTION public.seed_servicos_iniciais_tenant(UUID) FROM PUBLIC, anon, authenticated;


-- ------------------------------------------------------------------------------
-- 3. ELIMINAR OVERLOADS LEGADOS DE CRIAR_OFICINA E GARANTIR ASSINATURA CANÔNICA
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.criar_oficina(text, text, text, text);
DROP FUNCTION IF EXISTS public.criar_oficina(text, text, text, text, text, text, text, text);

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
  v_nome_limpo TEXT;
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
  v_nome_limpo := TRIM(COALESCE(p_nome, ''));
  IF v_nome_limpo = '' OR LENGTH(v_nome_limpo) < 2 THEN
    RAISE EXCEPTION 'Informe o nome da oficina (mínimo 2 caracteres).';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  -- 1. Obter configuração de Trial de Cadastro
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

  -- 2. Validar campanha de lançamento se informada
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

  -- 4. Geração de slug único e código próprio de indicação
  v_slug := public.gerar_slug_oficina(v_nome_limpo);
  v_codigo_proprio := public.gerar_codigo_indicacao_unico();

  -- 5. Criar Tenant
  INSERT INTO public.tenants (
    nome, slug, cidade, uf, telefone, criado_por, plano, codigo_indicacao
  ) VALUES (
    v_nome_limpo, v_slug, p_cidade, p_uf, p_telefone, auth.uid(), v_plano_inicial, v_codigo_proprio
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
          v_nome_limpo,
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
      'Nova Oficina Cadastrada: ' || v_nome_limpo,
      'A oficina "' || v_nome_limpo || '" (' || coalesce(p_cidade, 'Sem cidade') || '/' || coalesce(p_uf, 'UF') || ') acabou de se cadastrar no plano ' || upper(v_plano_inicial) || '.',
      '/admin/oficinas',
      jsonb_build_object('tenant_id', v_tenant, 'nome', v_nome_limpo, 'plano', v_plano_inicial, 'trial_fim', v_trial_fim, 'campanha', v_campanha_usada)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_tenant;
END;
$function$;

REVOKE ALL ON FUNCTION public.criar_oficina(text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_oficina(text, text, text, text, text, text, text) TO authenticated;


-- ------------------------------------------------------------------------------
-- 4. ATUALIZAR SINCRONIZAR_PRECOS_SERVICO, SEMEAR_SERVICOS E TRIGGER DE CATEGORIA
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sincronizar_precos_servico(p_servico uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
#variable_conflict use_column
DECLARE
  v_tenant_id uuid;
  v_nome_servico text;
  v_codigo_servico text;
  v_grupo_servico text;
  v_sob_consulta boolean := false;
  v_modelo_codigo text;
  v_modelo_nome text;
  v_duracao integer := 60;
  v_categoria record;
  v_preco_sugerido numeric(10,2);
  v_count integer := 0;
  v_is_system boolean := false;
  v_autorizado boolean := false;
BEGIN
  v_is_system := (
    auth.uid() IS NULL
    AND (
      auth.role() = 'service_role'
      OR session_user IN ('postgres', 'supabase_admin')
    )
  );

  SELECT s.tenant_id, s.nome, s.codigo, s.grupo, COALESCE(s.sob_consulta, false)
  INTO v_tenant_id, v_nome_servico, v_codigo_servico, v_grupo_servico, v_sob_consulta
  FROM public.servicos s
  WHERE s.id = p_servico;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Serviço não encontrado.';
  END IF;

  IF NOT v_is_system THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Não autenticado';
    END IF;

    SELECT (
      (v_tenant_id IN (SELECT public.meus_tenants()) AND public.tem_papel(v_tenant_id, ARRAY['dono', 'gerente']::public.app_role[]))
      OR public.is_platform_admin()
    ) INTO v_autorizado;

    IF NOT COALESCE(v_autorizado, false) THEN
      RAISE EXCEPTION 'Acesso negado: apenas donos ou gerentes podem sincronizar preços desta oficina.';
    END IF;
  END IF;

  -- Busca correspondência no catálogo modelo (prioridade por código, fallback por nome)
  SELECT sm.codigo, sm.nome, sm.duracao_sugerida
  INTO v_modelo_codigo, v_modelo_nome, v_duracao
  FROM public.servicos_modelo sm
  WHERE (
      NULLIF(trim(COALESCE(v_codigo_servico, '')), '') IS NOT NULL
      AND upper(trim(sm.codigo)) = upper(trim(v_codigo_servico))
    )
    OR lower(trim(sm.nome)) = lower(trim(v_nome_servico))
  ORDER BY (upper(trim(COALESCE(sm.codigo, ''))) = upper(trim(COALESCE(v_codigo_servico, '')))) DESC
  LIMIT 1;

  IF v_duracao IS NULL OR v_duracao <= 0 THEN
    v_duracao := 60;
  END IF;

  FOR v_categoria IN
    SELECT cv.id, cv.nome
    FROM public.categorias_veiculo cv
    WHERE cv.tenant_id = v_tenant_id
      AND COALESCE(cv.ativo, true) = true
  LOOP
    IF v_sob_consulta THEN
      v_preco_sugerido := NULL;
    ELSE
      v_preco_sugerido := public.preco_sugerido_servico_modelo(
        COALESCE(v_modelo_codigo, v_codigo_servico),
        COALESCE(v_modelo_nome, v_nome_servico),
        v_categoria.nome,
        v_grupo_servico,
        false
      );
    END IF;

    INSERT INTO public.servico_precos (
      tenant_id,
      servico_id,
      categoria_id,
      preco_base,
      duracao_minutos,
      duracao_confirmada,
      ativo
    ) VALUES (
      v_tenant_id,
      p_servico,
      v_categoria.id,
      v_preco_sugerido,
      v_duracao,
      false,
      true
    )
    ON CONFLICT (servico_id, categoria_id) DO UPDATE
      SET preco_base = CASE
            WHEN v_sob_consulta THEN NULL
            WHEN public.servico_precos.preco_base IS NULL OR public.servico_precos.preco_base <= 0
            THEN COALESCE(EXCLUDED.preco_base, public.servico_precos.preco_base)
            ELSE public.servico_precos.preco_base
          END,
          duracao_minutos = COALESCE(NULLIF(public.servico_precos.duracao_minutos, 0), EXCLUDED.duracao_minutos),
          ativo = true,
          updated_at = now()
      WHERE (
        (NOT v_sob_consulta)
        AND (public.servico_precos.preco_base IS NULL OR public.servico_precos.preco_base <= 0)
        AND EXCLUDED.preco_base IS NOT NULL
      )
      OR COALESCE(public.servico_precos.ativo, true) = false;

    IF FOUND THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.sincronizar_precos_servico(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sincronizar_precos_servico(uuid) TO authenticated;


DROP FUNCTION IF EXISTS public.semear_servicos(uuid[]);

CREATE OR REPLACE FUNCTION public.semear_servicos(
  p_modelo_ids uuid[],
  p_tenant_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
#variable_conflict use_column
DECLARE
  v_tenant_id uuid;
  v_modelo record;
  v_servico_id uuid;
  v_servico_ativo boolean;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF p_tenant_id IS NOT NULL THEN
    IF NOT (
      p_tenant_id IN (SELECT public.meus_tenants())
      OR public.is_platform_admin()
    ) THEN
      RAISE EXCEPTION 'Acesso negado para a oficina especificada.';
    END IF;
    v_tenant_id := p_tenant_id;
  ELSE
    SELECT tm.tenant_id INTO v_tenant_id
    FROM public.tenant_members tm
    WHERE tm.user_id = auth.uid() AND tm.status = 'ativo'
    LIMIT 1;
  END IF;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Nenhum tenant ativo encontrado para o usuário.';
  END IF;

  IF NOT (
    public.tem_papel(v_tenant_id, ARRAY['dono', 'gerente']::public.app_role[])
    OR public.is_platform_admin()
  ) THEN
    RAISE EXCEPTION 'Apenas o dono ou gerente podem gerenciar serviços.';
  END IF;

  -- Garante categorias ativas para que todos os serviços selecionados já recebam matriz de preços
  IF NOT EXISTS (
    SELECT 1
    FROM public.categorias_veiculo cv
    WHERE cv.tenant_id = v_tenant_id
      AND COALESCE(cv.ativo, true) = true
  ) THEN
    INSERT INTO public.categorias_veiculo (tenant_id, nome, ordem, ativo) VALUES
      (v_tenant_id, 'Hatch Pequeno', 1, true),
      (v_tenant_id, 'Sedan Médio', 2, true),
      (v_tenant_id, 'SUV / Caminhonete', 3, true),
      (v_tenant_id, 'Esportivo / Coupe', 4, true),
      (v_tenant_id, 'Moto', 5, true)
    ON CONFLICT (tenant_id, nome) DO UPDATE SET ativo = true;
  END IF;

  IF p_modelo_ids IS NULL OR array_length(p_modelo_ids, 1) IS NULL OR array_length(p_modelo_ids, 1) = 0 THEN
    RETURN 0;
  END IF;

  FOR v_modelo IN
    SELECT sm.nome, sm.grupo, sm.descricao_publica, sm.codigo, sm.modo_ocupacao, sm.duracao_sugerida, sm.ordem
    FROM public.servicos_modelo sm
    WHERE sm.id = ANY(p_modelo_ids)
    ORDER BY sm.ordem ASC, sm.codigo ASC
  LOOP
    v_servico_id := NULL;
    v_servico_ativo := false;

    SELECT s.id, COALESCE(s.ativo, true)
    INTO v_servico_id, v_servico_ativo
    FROM public.servicos s
    WHERE s.tenant_id = v_tenant_id
      AND (
        lower(trim(s.nome)) = lower(trim(v_modelo.nome))
        OR (
          NULLIF(trim(COALESCE(v_modelo.codigo, '')), '') IS NOT NULL
          AND upper(trim(COALESCE(s.codigo, ''))) = upper(trim(v_modelo.codigo))
        )
      )
    ORDER BY
      (lower(trim(s.nome)) = lower(trim(v_modelo.nome))) DESC,
      COALESCE(s.ativo, true) DESC,
      s.created_at DESC
    LIMIT 1;

    IF v_servico_id IS NULL THEN
      INSERT INTO public.servicos (
        tenant_id, nome, grupo, descricao_publica, codigo, modo_ocupacao, dias_ocupados, publico, sob_consulta, tom, ordem, ativo
      ) VALUES (
        v_tenant_id,
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
        true
      )
      RETURNING id INTO v_servico_id;

      v_count := v_count + 1;
    ELSIF NOT v_servico_ativo THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.servicos s2
        JOIN public.servicos s_alvo ON s_alvo.id = v_servico_id
        WHERE s2.tenant_id = v_tenant_id
          AND s2.id <> v_servico_id
          AND COALESCE(s2.ativo, true) = true
          AND lower(trim(s2.nome)) = lower(trim(s_alvo.nome))
      ) THEN
        UPDATE public.servicos
        SET ativo = true, updated_at = now()
        WHERE id = v_servico_id;
      END IF;
    END IF;

    PERFORM public.sincronizar_precos_servico(v_servico_id);
  END LOOP;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.semear_servicos(uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.semear_servicos(uuid[], uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.fn_sincronizar_nova_categoria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
#variable_conflict use_column
BEGIN
  IF COALESCE(NEW.ativo, true) = false THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.servico_precos (
    tenant_id,
    servico_id,
    categoria_id,
    preco_base,
    duracao_minutos,
    duracao_confirmada,
    ativo
  )
  SELECT
    s.tenant_id,
    s.id,
    NEW.id,
    CASE
      WHEN COALESCE(s.sob_consulta, false) THEN NULL
      ELSE public.preco_sugerido_servico_modelo(
        COALESCE(sm_match.codigo, s.codigo),
        COALESCE(sm_match.nome, s.nome),
        NEW.nome,
        s.grupo,
        false
      )
    END,
    COALESCE(sm_match.duracao_sugerida, 60),
    false,
    true
  FROM public.servicos s
  LEFT JOIN LATERAL (
    SELECT sm.codigo, sm.nome, sm.duracao_sugerida
    FROM public.servicos_modelo sm
    WHERE (
        NULLIF(trim(COALESCE(s.codigo, '')), '') IS NOT NULL
        AND upper(trim(sm.codigo)) = upper(trim(s.codigo))
      )
      OR lower(trim(sm.nome)) = lower(trim(s.nome))
    ORDER BY (upper(trim(COALESCE(sm.codigo, ''))) = upper(trim(COALESCE(s.codigo, '')))) DESC
    LIMIT 1
  ) sm_match ON true
  WHERE s.tenant_id = NEW.tenant_id
    AND COALESCE(s.ativo, true) = true
  ON CONFLICT (servico_id, categoria_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tg_sincronizar_nova_categoria ON public.categorias_veiculo;
CREATE TRIGGER tg_sincronizar_nova_categoria
  AFTER INSERT ON public.categorias_veiculo
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sincronizar_nova_categoria();


-- ------------------------------------------------------------------------------
-- 5. RPC PARA CARREGAR PREÇOS MÉDIOS SUGERIDOS EM 1 CLIQUE (NÃO DESTRUTIVA)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.preencher_precos_sugeridos_tenant(
  p_tenant_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
#variable_conflict use_column
DECLARE
  v_target_tenant_id UUID;
  v_autorizado BOOLEAN := false;
  v_serv RECORD;
  v_cat RECORD;
  v_preco_calc NUMERIC(10,2);
  v_atualizadas INTEGER := 0;
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
    RAISE EXCEPTION 'Acesso negado: apenas donos ou gerentes podem atualizar preços desta oficina.';
  END IF;

  -- Garante categorias padrão caso a oficina ainda não possua nenhuma categoria ativa
  IF NOT EXISTS (
    SELECT 1
    FROM public.categorias_veiculo cv
    WHERE cv.tenant_id = v_target_tenant_id
      AND COALESCE(cv.ativo, true) = true
  ) THEN
    INSERT INTO public.categorias_veiculo (tenant_id, nome, ordem, ativo) VALUES
      (v_target_tenant_id, 'Hatch Pequeno', 1, true),
      (v_target_tenant_id, 'Sedan Médio', 2, true),
      (v_target_tenant_id, 'SUV / Caminhonete', 3, true),
      (v_target_tenant_id, 'Esportivo / Coupe', 4, true),
      (v_target_tenant_id, 'Moto', 5, true)
    ON CONFLICT (tenant_id, nome) DO UPDATE SET ativo = true;
  END IF;

  FOR v_serv IN
    SELECT
      s.id,
      s.nome,
      s.codigo,
      s.grupo,
      sm_match.codigo AS modelo_codigo,
      sm_match.nome AS modelo_nome,
      COALESCE(sm_match.duracao_sugerida, 60) AS modelo_duracao
    FROM public.servicos s
    LEFT JOIN LATERAL (
      SELECT sm.codigo, sm.nome, sm.duracao_sugerida
      FROM public.servicos_modelo sm
      WHERE (
          NULLIF(trim(COALESCE(s.codigo, '')), '') IS NOT NULL
          AND upper(trim(sm.codigo)) = upper(trim(s.codigo))
        )
        OR lower(trim(sm.nome)) = lower(trim(s.nome))
      ORDER BY (upper(trim(COALESCE(sm.codigo, ''))) = upper(trim(COALESCE(s.codigo, '')))) DESC
      LIMIT 1
    ) sm_match ON true
    WHERE s.tenant_id = v_target_tenant_id
      AND COALESCE(s.ativo, true) = true
      AND COALESCE(s.sob_consulta, false) = false
  LOOP
    FOR v_cat IN
      SELECT cv.id, cv.nome
      FROM public.categorias_veiculo cv
      WHERE cv.tenant_id = v_target_tenant_id
        AND COALESCE(cv.ativo, true) = true
    LOOP
      v_preco_calc := public.preco_sugerido_servico_modelo(
        COALESCE(v_serv.modelo_codigo, v_serv.codigo),
        COALESCE(v_serv.modelo_nome, v_serv.nome),
        v_cat.nome,
        v_serv.grupo,
        true
      );

      IF v_preco_calc IS NOT NULL AND v_preco_calc > 0 THEN
        INSERT INTO public.servico_precos (
          tenant_id,
          servico_id,
          categoria_id,
          preco_base,
          duracao_minutos,
          duracao_confirmada,
          ativo
        ) VALUES (
          v_target_tenant_id,
          v_serv.id,
          v_cat.id,
          v_preco_calc,
          v_serv.modelo_duracao,
          false,
          true
        )
        ON CONFLICT (servico_id, categoria_id) DO UPDATE
          SET preco_base = CASE
                WHEN public.servico_precos.preco_base IS NULL OR public.servico_precos.preco_base <= 0
                THEN EXCLUDED.preco_base
                ELSE public.servico_precos.preco_base
              END,
              duracao_minutos = COALESCE(NULLIF(public.servico_precos.duracao_minutos, 0), EXCLUDED.duracao_minutos),
              ativo = true,
              updated_at = now()
        WHERE public.servico_precos.preco_base IS NULL
           OR public.servico_precos.preco_base <= 0
           OR COALESCE(public.servico_precos.ativo, true) = false;

        IF FOUND THEN
          v_atualizadas := v_atualizadas + 1;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'sucesso', true,
    'tenant_id', v_target_tenant_id,
    'linhas_atualizadas', v_atualizadas
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.preencher_precos_sugeridos_tenant(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preencher_precos_sugeridos_tenant(UUID) TO authenticated;


-- ------------------------------------------------------------------------------
-- 6. ATUALIZAR OBTER_STATUS_ONBOARDING COM CONTAGEM REAL DE SERVIÇOS PREENCHIDOS
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.obter_status_onboarding(p_tenant_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_target_tenant_id UUID;
  v_autorizado BOOLEAN := false;
  v_tenant RECORD;
  v_servicos_count INTEGER := 0;
  v_servicos_com_preco_count INTEGER := 0;
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

  SELECT COUNT(*)::integer
  INTO v_servicos_com_preco_count
  FROM public.servicos s
  WHERE s.tenant_id = v_target_tenant_id
    AND COALESCE(s.ativo, true) = true
    AND (
      COALESCE(s.sob_consulta, false) = true
      OR EXISTS (
        SELECT 1
        FROM public.servico_precos sp
        WHERE sp.servico_id = s.id
          AND sp.tenant_id = v_target_tenant_id
          AND COALESCE(sp.ativo, true) = true
          AND sp.preco_base IS NOT NULL
          AND sp.preco_base > 0
      )
    );

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
    'servicos_com_preco_count', v_servicos_com_preco_count,
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
$function$;

REVOKE ALL ON FUNCTION public.obter_status_onboarding(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obter_status_onboarding(UUID) TO authenticated;


-- ------------------------------------------------------------------------------
-- 7. BACKFILL IDEMPOTENTE E SEGURO (SEM SOBRESCREVER PREÇOS DEFINIDOS > 0)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  v_tenant RECORD;
  v_row RECORD;
BEGIN
  -- 7.1 Garante categorias ativas e horários para todas as oficinas, e semeia
  --     oficinas que ainda estão sem serviços ativos e sem orçamentos.
  FOR v_tenant IN
    SELECT t.id
    FROM public.tenants t
  LOOP
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM public.categorias_veiculo cv
        WHERE cv.tenant_id = v_tenant.id
          AND COALESCE(cv.ativo, true) = true
      ) THEN
        INSERT INTO public.categorias_veiculo (tenant_id, nome, ordem, ativo) VALUES
          (v_tenant.id, 'Hatch Pequeno', 1, true),
          (v_tenant.id, 'Sedan Médio', 2, true),
          (v_tenant.id, 'SUV / Caminhonete', 3, true),
          (v_tenant.id, 'Esportivo / Coupe', 4, true),
          (v_tenant.id, 'Moto', 5, true)
        ON CONFLICT (tenant_id, nome) DO UPDATE SET ativo = true;
      END IF;

      IF (SELECT COUNT(*) FROM public.horarios_funcionamento h WHERE h.tenant_id = v_tenant.id) < 7 THEN
        PERFORM public.seed_horarios_funcionamento_tenant(v_tenant.id);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.servicos s
        WHERE s.tenant_id = v_tenant.id
          AND COALESCE(s.ativo, true) = true
      ) AND NOT EXISTS (
        SELECT 1 FROM public.orcamentos o
        WHERE o.tenant_id = v_tenant.id
      ) THEN
        PERFORM public.seed_servicos_iniciais_tenant(v_tenant.id);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;

  -- 7.2 Higieniza preços em serviços "sob consulta"
  UPDATE public.servico_precos sp
  SET preco_base = NULL,
      updated_at = now()
  FROM public.servicos s
  WHERE sp.servico_id = s.id
    AND COALESCE(s.sob_consulta, false) = true
    AND sp.preco_base IS NOT NULL;

  -- 7.3 Popula preços sugeridos faltantes ou zerados em TODOS os serviços modelo
  --     ativos existentes (sem tocar serviços personalizados não-modelo nem
  --     preços já configurados > 0 pelos clientes).
  FOR v_row IN
    SELECT
      s.tenant_id,
      s.id AS servico_id,
      cv.id AS categoria_id,
      public.preco_sugerido_servico_modelo(
        COALESCE(sm_match.codigo, s.codigo),
        COALESCE(sm_match.nome, s.nome),
        cv.nome,
        s.grupo,
        false
      ) AS preco_sugerido,
      COALESCE(sm_match.duracao_sugerida, 60) AS duracao_sugerida
    FROM public.servicos s
    JOIN public.categorias_veiculo cv
      ON cv.tenant_id = s.tenant_id
     AND COALESCE(cv.ativo, true) = true
    LEFT JOIN LATERAL (
      SELECT sm.codigo, sm.nome, sm.duracao_sugerida
      FROM public.servicos_modelo sm
      WHERE (
          NULLIF(trim(COALESCE(s.codigo, '')), '') IS NOT NULL
          AND upper(trim(sm.codigo)) = upper(trim(s.codigo))
        )
        OR lower(trim(sm.nome)) = lower(trim(s.nome))
      ORDER BY (upper(trim(COALESCE(sm.codigo, ''))) = upper(trim(COALESCE(s.codigo, '')))) DESC
      LIMIT 1
    ) sm_match ON true
    WHERE COALESCE(s.ativo, true) = true
      AND COALESCE(s.sob_consulta, false) = false
  LOOP
    IF v_row.preco_sugerido IS NOT NULL AND v_row.preco_sugerido > 0 THEN
      INSERT INTO public.servico_precos (
        tenant_id,
        servico_id,
        categoria_id,
        preco_base,
        duracao_minutos,
        duracao_confirmada,
        ativo
      ) VALUES (
        v_row.tenant_id,
        v_row.servico_id,
        v_row.categoria_id,
        v_row.preco_sugerido,
        v_row.duracao_sugerida,
        false,
        true
      )
      ON CONFLICT (servico_id, categoria_id) DO UPDATE
        SET preco_base = CASE
              WHEN public.servico_precos.preco_base IS NULL OR public.servico_precos.preco_base <= 0
              THEN EXCLUDED.preco_base
              ELSE public.servico_precos.preco_base
            END,
            duracao_minutos = COALESCE(NULLIF(public.servico_precos.duracao_minutos, 0), EXCLUDED.duracao_minutos),
            ativo = true,
            updated_at = now()
      WHERE public.servico_precos.preco_base IS NULL
         OR public.servico_precos.preco_base <= 0;
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
