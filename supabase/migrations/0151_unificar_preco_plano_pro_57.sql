-- Migration 0151: Precificação 100% Dinâmica Orientada pela Tabela Plans e Sincronização Geral
-- ==============================================================================

-- 1. Sincronizar dinamicamente todas as assinaturas existentes com o preço atual da tabela plans
UPDATE public.assinaturas a
SET valor_centavos = CASE 
      WHEN a.ciclo = 'anual' AND p.preco_anual_centavos IS NOT NULL AND p.preco_anual_centavos > 0 THEN p.preco_anual_centavos
      ELSE p.preco_centavos
    END,
    updated_at = now()
FROM public.plans p
WHERE p.codigo = a.plano;

-- 2. Atualizar admin_salvar_plano_completo para refletir alterações em tempo real em todas as assinaturas (mensal e anual)
DROP FUNCTION IF EXISTS public.admin_salvar_plano_completo(TEXT, TEXT, INTEGER, BOOLEAN, JSONB, JSONB);
DROP FUNCTION IF EXISTS public.admin_salvar_plano_completo(TEXT, TEXT, INTEGER, BOOLEAN, JSONB, JSONB, INTEGER);
CREATE OR REPLACE FUNCTION public.admin_salvar_plano_completo(
  p_codigo TEXT,
  p_nome TEXT,
  p_preco_centavos INTEGER,
  p_ativo BOOLEAN,
  p_features JSONB,
  p_limites JSONB,
  p_preco_anual_centavos INTEGER DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_key TEXT;
  v_val JSONB;
  v_limite_num INTEGER;
  v_hab BOOLEAN;
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Permissão negada. Apenas administradores editores podem alterar planos.';
  END IF;

  -- Atualiza o plano na tabela plans
  UPDATE public.plans
  SET 
    nome = TRIM(p_nome),
    preco_centavos = p_preco_centavos,
    preco_anual_centavos = p_preco_anual_centavos,
    ativo = p_ativo,
    updated_at = NOW()
  WHERE codigo = LOWER(TRIM(p_codigo));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plano % não encontrado.', p_codigo;
  END IF;

  -- Atualiza em tempo real o valor de todas as assinaturas mensais deste plano (ativas, trial, atrasadas)
  UPDATE public.assinaturas
  SET valor_centavos = p_preco_centavos,
      updated_at = NOW()
  WHERE plano = LOWER(TRIM(p_codigo)) AND (ciclo IS NULL OR ciclo = 'mensal');

  -- Se foi informado valor anual, atualiza também as assinaturas anuais
  IF p_preco_anual_centavos IS NOT NULL AND p_preco_anual_centavos > 0 THEN
    UPDATE public.assinaturas
    SET valor_centavos = p_preco_anual_centavos,
        updated_at = NOW()
    WHERE plano = LOWER(TRIM(p_codigo)) AND ciclo = 'anual';
  END IF;

  IF p_features IS NOT NULL AND jsonb_typeof(p_features) = 'object' THEN
    FOR v_key, v_val IN SELECT * FROM jsonb_each(p_features)
    LOOP
      v_hab := (v_val::text = 'true');
      INSERT INTO public.plan_features (plano, feature, habilitado, updated_at)
      VALUES (LOWER(TRIM(p_codigo)), v_key, v_hab, NOW())
      ON CONFLICT (plano, feature) DO UPDATE
      SET habilitado = EXCLUDED.habilitado, updated_at = NOW();
    END LOOP;
  END IF;

  IF p_limites IS NOT NULL AND jsonb_typeof(p_limites) = 'object' THEN
    FOR v_key, v_val IN SELECT * FROM jsonb_each(p_limites)
    LOOP
      IF v_val IS NULL OR jsonb_typeof(v_val) = 'null' OR v_val::text = 'null' THEN
        v_limite_num := NULL;
      ELSE
        v_limite_num := (v_val::text)::INTEGER;
      END IF;

      INSERT INTO public.plan_limits (plano, recurso, limite, updated_at)
      VALUES (LOWER(TRIM(p_codigo)), v_key, v_limite_num, NOW())
      ON CONFLICT (plano, recurso) DO UPDATE
      SET limite = EXCLUDED.limite, updated_at = NOW();
    END LOOP;
  END IF;

  INSERT INTO public.audit_logs (usuario_id, email, acao, entidade, registro_id, detalhes)
  VALUES (
    auth.uid(),
    public.current_admin_email(),
    'ATUALIZAR_PLANO_COMPLETO',
    'plans',
    p_codigo,
    jsonb_build_object(
      'nome', p_nome,
      'preco_centavos', p_preco_centavos,
      'preco_anual_centavos', p_preco_anual_centavos,
      'ativo', p_ativo,
      'features', p_features,
      'limites', p_limites
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_salvar_plano_completo(TEXT, TEXT, INTEGER, BOOLEAN, JSONB, JSONB, INTEGER) TO authenticated;

-- 3. Atualizar obter_assinatura_tenant para retornar sempre o preço dinâmico ativo da tabela plans
CREATE OR REPLACE FUNCTION public.obter_assinatura_tenant(p_tenant_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_ass RECORD;
  v_tenant RECORD;
  v_hoje DATE;
  v_dias_trial INTEGER := 0;
  v_dias_atraso INTEGER := 0;
  v_dias_para_rebaixamento INTEGER := 0;
  v_status_final TEXT;
  v_valor_dinamico INTEGER;
BEGIN
  v_tenant_id := COALESCE(p_tenant_id, (SELECT public.meus_tenants() LIMIT 1));
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('existe', false, 'status', 'trial', 'plano', 'pro', 'ciclo', 'mensal');
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = v_tenant_id;
  SELECT * INTO v_ass FROM public.assinaturas WHERE tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    SELECT preco_centavos INTO v_valor_dinamico FROM public.plans WHERE codigo = 'pro';
    RETURN jsonb_build_object(
      'existe', false,
      'plano', COALESCE(v_tenant.plano::text, 'pro'),
      'status', 'trial',
      'ciclo', 'mensal',
      'valor_centavos', COALESCE(v_valor_dinamico, 0),
      'dias_trial_restantes', 15
    );
  END IF;

  -- Busca o preço dinâmico em tempo real na tabela plans
  SELECT 
    CASE 
      WHEN COALESCE(v_ass.ciclo, 'mensal') = 'anual' AND p.preco_anual_centavos IS NOT NULL AND p.preco_anual_centavos > 0 
        THEN p.preco_anual_centavos
      ELSE p.preco_centavos
    END
  INTO v_valor_dinamico
  FROM public.plans p
  WHERE p.codigo = COALESCE(v_ass.plano, v_tenant.plano, 'pro');

  v_hoje := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_status_final := v_ass.status;

  IF v_status_final = 'trial' AND v_ass.trial_fim IS NOT NULL THEN
    v_dias_trial := v_ass.trial_fim - v_hoje;
    IF v_dias_trial < 0 THEN v_dias_trial := 0; END IF;
  END IF;

  IF v_status_final = 'atrasada' AND v_ass.atraso_desde IS NOT NULL THEN
    v_dias_atraso := v_hoje - v_ass.atraso_desde;
    v_dias_para_rebaixamento := 5 - v_dias_atraso;
    IF v_dias_para_rebaixamento < 0 THEN v_dias_para_rebaixamento := 0; END IF;
  END IF;

  RETURN jsonb_build_object(
    'existe', true,
    'id', v_ass.id,
    'tenant_id', v_ass.tenant_id,
    'plano', COALESCE(v_ass.plano, v_tenant.plano, 'pro'),
    'status', v_status_final,
    'ciclo', COALESCE(v_ass.ciclo, 'mensal'),
    'forma_pagamento', v_ass.forma_pagamento,
    'valor_centavos', COALESCE(v_valor_dinamico, v_ass.valor_centavos, 0),
    'trial_fim', v_ass.trial_fim,
    'dias_trial_restantes', v_dias_trial,
    'proximo_vencimento', v_ass.proximo_vencimento,
    'atraso_desde', v_ass.atraso_desde,
    'dias_atraso', v_dias_atraso,
    'dias_para_rebaixamento', v_dias_para_rebaixamento,
    'url_pagamento_asaas', v_ass.url_pagamento_asaas,
    'asaas_subscription_id', v_ass.asaas_subscription_id,
    'cancelada_em', v_ass.cancelada_em
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_assinatura_tenant(UUID) TO authenticated, service_role;

-- 4. Atualizar validar_cupom para consultar a tabela plans de forma estritamente dinâmica
DROP FUNCTION IF EXISTS public.validar_cupom(text, text);
DROP FUNCTION IF EXISTS public.validar_cupom(text, text, text);
CREATE OR REPLACE FUNCTION public.validar_cupom(
  p_codigo TEXT,
  p_plano TEXT,
  p_ciclo TEXT DEFAULT 'mensal'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cupom RECORD;
  v_tenant_id UUID;
  v_preco_centavos INT;
  v_valor_original NUMERIC(10,2);
  v_valor_desconto NUMERIC(10,2);
  v_valor_final NUMERIC(10,2);
  v_ja_usou BOOLEAN;
BEGIN
  IF p_codigo IS NULL OR trim(p_codigo) = '' THEN
    RETURN jsonb_build_object('valido', false, 'mensagem', 'Código do cupom não informado.');
  END IF;

  v_tenant_id := (SELECT public.meus_tenants() LIMIT 1);

  SELECT * INTO v_cupom
  FROM public.plataforma_cupons
  WHERE upper(trim(codigo)) = upper(trim(p_codigo));

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valido', false, 'mensagem', 'Cupom não encontrado ou inválido.');
  END IF;

  IF NOT v_cupom.ativo THEN
    RETURN jsonb_build_object('valido', false, 'mensagem', 'Este cupom está inativo no momento.');
  END IF;

  IF v_cupom.data_expiracao IS NOT NULL AND v_cupom.data_expiracao < current_date THEN
    RETURN jsonb_build_object('valido', false, 'mensagem', 'Este cupom já expirou.');
  END IF;

  IF v_cupom.limite_usos IS NOT NULL AND v_cupom.usos_atuais >= v_cupom.limite_usos THEN
    RETURN jsonb_build_object('valido', false, 'mensagem', 'O limite de utilizações deste cupom foi atingido.');
  END IF;

  IF v_cupom.plano_alvo != 'todos' AND lower(trim(v_cupom.plano_alvo)) != lower(trim(p_plano)) THEN
    RETURN jsonb_build_object('valido', false, 'mensagem', format('Este cupom é exclusivo para o plano %s.', upper(v_cupom.plano_alvo)));
  END IF;

  IF v_tenant_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.plataforma_cupons_usos
      WHERE cupom_id = v_cupom.id AND tenant_id = v_tenant_id
    ) INTO v_ja_usou;

    IF v_ja_usou THEN
      RETURN jsonb_build_object('valido', false, 'mensagem', 'Sua oficina já utilizou este cupom anteriormente.');
    END IF;
  END IF;

  -- Busca o preço dinâmico do plano na tabela plans
  IF lower(trim(p_ciclo)) = 'anual' THEN
    SELECT COALESCE(preco_anual_centavos, preco_centavos * 10) INTO v_preco_centavos
    FROM public.plans
    WHERE codigo = lower(trim(p_plano));
  ELSE
    SELECT preco_centavos INTO v_preco_centavos
    FROM public.plans
    WHERE codigo = lower(trim(p_plano));
  END IF;

  IF v_preco_centavos IS NULL THEN
    RETURN jsonb_build_object('valido', false, 'mensagem', 'Plano selecionado não encontrado na base de planos.');
  END IF;

  v_valor_original := round(v_preco_centavos / 100.0, 2);

  IF v_cupom.desconto_tipo = 'percentual' THEN
    v_valor_desconto := round(v_valor_original * (v_cupom.desconto_valor / 100.0), 2);
  ELSE
    v_valor_desconto := v_cupom.desconto_valor;
  END IF;

  IF v_valor_desconto > v_valor_original THEN
    v_valor_desconto := v_valor_original;
  END IF;

  v_valor_final := round(v_valor_original - v_valor_desconto, 2);
  IF v_valor_final < 0 THEN v_valor_final := 0; END IF;

  RETURN jsonb_build_object(
    'valido', true,
    'id', v_cupom.id,
    'codigo', v_cupom.codigo,
    'descricao', v_cupom.descricao,
    'desconto_tipo', v_cupom.desconto_tipo,
    'desconto_valor', v_cupom.desconto_valor,
    'duracao_meses', v_cupom.duracao_meses,
    'ciclo', p_ciclo,
    'valor_original', v_valor_original,
    'valor_desconto', v_valor_desconto,
    'valor_final', v_valor_final,
    'mensagem', 'Cupom aplicado com sucesso!'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validar_cupom(text, text, text) TO authenticated, anon;

-- 5. Atualizar criar_oficina para consultar dinamicamente a tabela plans
DROP FUNCTION IF EXISTS public.criar_oficina(text, text, text, text, text, text, text, text);
CREATE OR REPLACE FUNCTION public.criar_oficina(
  p_nome TEXT,
  p_cidade TEXT,
  p_uf TEXT,
  p_telefone TEXT,
  p_documento TEXT DEFAULT NULL,
  p_codigo_indicador TEXT DEFAULT NULL,
  p_documento_tipo TEXT DEFAULT NULL,
  p_codigo_campanha TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
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
  v_valor_centavos INTEGER := 0;

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

  -- 1. Obter configuração de Trial de Cadastro de forma defensiva
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
        AND (expira_em IS NULL OR expira_em > now());

      IF FOUND THEN
        v_campanha_usada := v_campanha.codigo;
        v_plano_inicial := v_campanha.plano_concedido;
        v_dias_trial_concedidos := v_campanha.dias_trial;
        v_valor_centavos := v_campanha.valor_mensal_centavos;

        UPDATE public.campanhas_lancamento
        SET total_usos = total_usos + 1
        WHERE id = v_campanha.id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_campanha_usada := NULL;
    END;
  END IF;

  -- 3. Definição do plano e trial inicial com busca dinâmica na tabela plans
  IF v_campanha_usada IS NULL THEN
    IF NOT v_trial_ativo_config THEN
      v_plano_inicial := 'free';
      v_status_inicial := 'ativo';
      v_dias_trial_concedidos := 0;
      v_trial_fim := NULL;
      v_valor_centavos := 0;
    ELSE
      v_plano_inicial := 'pro';
      v_status_inicial := 'trial';
      v_dias_trial_concedidos := v_dias_trial_config;
      v_trial_fim := (current_date + v_dias_trial_concedidos);
      
      -- Busca dinâmica do preço do plano na tabela plans
      SELECT preco_centavos INTO v_valor_centavos 
      FROM public.plans 
      WHERE codigo = v_plano_inicial;
      
      IF v_valor_centavos IS NULL THEN
        SELECT preco_centavos INTO v_valor_centavos FROM public.plans WHERE codigo = 'pro';
      END IF;
    END IF;
  ELSE
    v_status_inicial := 'trial';
    v_trial_fim := (current_date + v_dias_trial_concedidos);
  END IF;

  -- 4. Geração de slug através da função unificada
  v_slug := public.gerar_slug_oficina(p_nome);
  v_codigo_proprio := public.gerar_codigo_indicacao_unico();

  -- 5. Criar Tenant
  INSERT INTO public.tenants (
    nome, slug, cidade, uf, telefone, documento, documento_tipo, criado_por, plano, codigo_indicacao
  ) VALUES (
    p_nome, v_slug, p_cidade, p_uf, p_telefone, p_documento, p_documento_tipo, auth.uid(), v_plano_inicial, v_codigo_proprio
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

  -- 8. Semeaduras padrão (Categorias de Veículo)
  INSERT INTO public.categorias_veiculo (tenant_id, nome, ordem, ativo) VALUES
    (v_tenant, 'Hatch Pequeno', 1, true),
    (v_tenant, 'Sedan Médio', 2, true),
    (v_tenant, 'SUV / Caminhonete', 3, true),
    (v_tenant, 'Esportivo / Coupe', 4, true),
    (v_tenant, 'Moto', 5, true);

  -- 9. Semeaduras padrão (Formas de Pagamento)
  INSERT INTO public.formas_pagamento (tenant_id, nome, tipo, taxa_tipo, taxa_valor, prazo_dias, ativo, ordem) VALUES
    (v_tenant, 'Dinheiro', 'dinheiro', 'porcentagem', 0.00, 0, true, 1),
    (v_tenant, 'PIX', 'pix', 'porcentagem', 0.00, 0, true, 2),
    (v_tenant, 'Cartão de Débito', 'debito', 'porcentagem', 1.99, 1, true, 3),
    (v_tenant, 'Cartão de Crédito', 'credito', 'porcentagem', 3.99, 30, true, 4);

  -- 10. Processar Indicação se houver
  IF p_codigo_indicador IS NOT NULL AND trim(p_codigo_indicador) != '' THEN
    BEGIN
      SELECT p.*, u.email as usuario_email, u.raw_user_meta_data 
      INTO v_parceiro
      FROM public.parceiros p
      JOIN auth.users u ON u.id = p.user_id
      WHERE upper(p.codigo_cupom) = upper(trim(p_codigo_indicador))
        AND p.status = 'ativo'
      LIMIT 1;

      IF FOUND THEN
        SELECT email INTO v_indicado_email FROM auth.users WHERE id = auth.uid();
        
        INSERT INTO public.parceiro_indicacoes (
          parceiro_id, indicado_tenant_id, indicado_email, status, 
          trial_dias, trial_expira_em, updated_at
        ) VALUES (
          v_parceiro.id, v_tenant, v_indicado_email, 'instalado',
          v_dias_trial_concedidos, v_trial_fim, now()
        );
      ELSE
        SELECT t.*, u.email as usuario_email, tm.telefone as tel_membro
        INTO v_indicador
        FROM public.tenants t
        JOIN public.tenant_members tm ON tm.tenant_id = t.id AND tm.role = 'dono'
        JOIN auth.users u ON u.id = tm.user_id
        WHERE upper(t.codigo_indicacao) = upper(trim(p_codigo_indicador))
        LIMIT 1;

        IF FOUND AND v_indicador.id <> v_tenant THEN
          SELECT email INTO v_indicado_email FROM auth.users WHERE id = auth.uid();

          INSERT INTO public.indicacoes (
            indicador_tenant_id, indicado_tenant_id, codigo_usado, status
          ) VALUES (
            v_indicador.id, v_tenant, upper(trim(p_codigo_indicador)), 'instalado'
          );
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN v_tenant;
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_oficina(text, text, text, text, text, text, text, text) TO authenticated;

-- 6. Atualizar admin_registrar_pagamento_manual_competencia para valor 100% dinâmico
DROP FUNCTION IF EXISTS public.admin_registrar_pagamento_manual_competencia(UUID, DATE, INTEGER);
DROP FUNCTION IF EXISTS public.admin_registrar_pagamento_manual_competencia(UUID, DATE);
CREATE OR REPLACE FUNCTION public.admin_registrar_pagamento_manual_competencia(
  p_tenant_id UUID,
  p_competencia DATE,
  p_valor_pago_centavos INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_valor INTEGER;
  v_comp DATE := date_trunc('month', p_competencia)::date;
  v_res_parceiro JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores da plataforma podem registrar pagamentos manuais';
  END IF;

  IF p_valor_pago_centavos IS NOT NULL AND p_valor_pago_centavos > 0 THEN
    v_valor := p_valor_pago_centavos;
  ELSE
    -- Busca dinâmica do valor do plano da oficina diretamente na tabela plans
    SELECT COALESCE(
      CASE WHEN a.ciclo = 'anual' AND p.preco_anual_centavos > 0 THEN p.preco_anual_centavos ELSE p.preco_centavos END,
      p.preco_centavos
    ) INTO v_valor
    FROM public.assinaturas a
    JOIN public.plans p ON p.codigo = a.plano
    WHERE a.tenant_id = p_tenant_id
    LIMIT 1;

    IF v_valor IS NULL THEN
      SELECT preco_centavos INTO v_valor FROM public.plans WHERE codigo = 'pro' LIMIT 1;
    END IF;
  END IF;

  -- 1. Registra na tabela de pagamentos de competência
  INSERT INTO public.pagamentos_competencia (tenant_id, competencia, valor_pago_centavos, confirmado_por, confirmado_em)
  VALUES (p_tenant_id, v_comp, v_valor, auth.uid(), NOW())
  ON CONFLICT (tenant_id, competencia) 
  DO UPDATE SET valor_pago_centavos = EXCLUDED.valor_pago_centavos, confirmado_em = NOW(), confirmado_por = auth.uid();

  -- 2. Atualizar status da assinatura para 'ativa' se estiver trial ou atrasada
  UPDATE public.assinaturas
  SET status = 'ativa', 
      valor_centavos = v_valor,
      proximo_vencimento = (v_comp + INTERVAL '1 month' - INTERVAL '1 day')::date,
      updated_at = NOW()
  WHERE tenant_id = p_tenant_id;

  -- 3. Atualizar status do tenant
  UPDATE public.tenants
  SET status = 'ativo',
      updated_at = NOW()
  WHERE id = p_tenant_id;

  -- 4. Processar conversão de indicação se houver indicação pendente entre oficinas
  PERFORM public.processar_conversao_indicacao(p_tenant_id);

  -- 5. Processar comissão de parceiro comercial se a oficina foi indicada por um parceiro
  SELECT public.admin_processar_comissao_parceiro_competencia(p_tenant_id, v_comp, v_valor) INTO v_res_parceiro;

  RETURN jsonb_build_object(
    'sucesso', true,
    'tenant_id', p_tenant_id,
    'competencia', v_comp,
    'valor_pago_centavos', v_valor,
    'comissao_parceiro', v_res_parceiro
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_registrar_pagamento_manual_competencia(UUID, DATE, INTEGER) TO authenticated;

-- 7. RPC Admin: Excluir Treinamento em Vídeo da Academia do Detailer
DROP FUNCTION IF EXISTS public.admin_excluir_treinamento(UUID);
CREATE OR REPLACE FUNCTION public.admin_excluir_treinamento(
  p_treinamento_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso restrito a administradores.';
  END IF;

  DELETE FROM public.treinamentos WHERE id = p_treinamento_id;

  RETURN jsonb_build_object('sucesso', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_excluir_treinamento(UUID) TO authenticated;
