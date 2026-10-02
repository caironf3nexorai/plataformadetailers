-- Migration 0146: Vincular Retroativamente Oficina Teste Parceiro e Blindar Fluxo de Indicação/Parceiros
-- 1. Vincula a oficina de teste ao parceiro 'TESTETES10'
-- 2. Ativa o plano Pro e credita a comissão do parceiro (R$ 13,40 - 20%)
-- 3. Atualiza a RPC criar_oficina para detectar códigos de parceiro mesmo se passados em p_codigo_indicacao
-- 4. Cria RPC admin_vincular_oficina_parceiro para gestão segura no painel admin

-- ==============================================================================
-- 1. VINCULAR RETROATIVAMENTE A OFICINA TESTE AO PARCEIRO TESTETES10
-- ==============================================================================
DO $$
DECLARE
  v_parceiro_id UUID;
  v_tenant_id UUID := '37aa41e4-9088-4ba0-842d-b58ff034350b';
  v_comp DATE;
BEGIN
  -- Localizar o parceiro pelo código TESTETES10 ou id
  SELECT id INTO v_parceiro_id 
  FROM public.parceiros 
  WHERE codigo = 'TESTETES10' OR id = 'b5148aa2-6080-47f4-b356-95c935ef715f'
  LIMIT 1;

  IF v_parceiro_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenants WHERE id = v_tenant_id) THEN
    -- 1.1 Inserir vínculo na tabela parceiro_oficinas
    INSERT INTO public.parceiro_oficinas (parceiro_id, tenant_id)
    VALUES (v_parceiro_id, v_tenant_id)
    ON CONFLICT (tenant_id) DO UPDATE SET parceiro_id = EXCLUDED.parceiro_id;

    -- 1.2 Atualizar o status e plano do Tenant para ativo / pro
    UPDATE public.tenants
    SET status = 'ativo',
        plano = 'pro',
        updated_at = NOW()
    WHERE id = v_tenant_id;

    -- 1.3 Atualizar ou inserir assinatura ativa
    v_comp := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;

    INSERT INTO public.assinaturas (
      tenant_id, plano, status, valor_centavos, proximo_vencimento, updated_at
    ) VALUES (
      v_tenant_id, 'pro', 'ativa', 6700, (v_comp + INTERVAL '1 month' - INTERVAL '1 day')::date, NOW()
    )
    ON CONFLICT (tenant_id) DO UPDATE SET
      plano = 'pro',
      status = 'ativa',
      valor_centavos = 6700,
      proximo_vencimento = (v_comp + INTERVAL '1 month' - INTERVAL '1 day')::date,
      updated_at = NOW();

    -- 1.4 Registrar pagamento da competência
    INSERT INTO public.pagamentos_competencia (tenant_id, competencia, valor_pago_centavos, confirmado_em)
    VALUES (v_tenant_id, v_comp, 6700, NOW())
    ON CONFLICT (tenant_id, competencia)
    DO UPDATE SET valor_pago_centavos = EXCLUDED.valor_pago_centavos, confirmado_em = NOW();

    -- 1.5 Creditar a comissão de 20% (R$ 13,40) aprovada para o parceiro
    INSERT INTO public.parceiro_comissoes (
      parceiro_id, tenant_id, competencia, valor_base, valor_comissao, status
    ) VALUES (
      v_parceiro_id, v_tenant_id, v_comp, 67.00, 13.40, 'aprovada'
    )
    ON CONFLICT (parceiro_id, tenant_id, competencia)
    DO UPDATE SET
      valor_base = EXCLUDED.valor_base,
      valor_comissao = EXCLUDED.valor_comissao,
      status = 'aprovada';

    RAISE NOTICE 'Oficina % vinculada com sucesso ao parceiro % com comissão creditada.', v_tenant_id, v_parceiro_id;
  END IF;
END $$;

-- ==============================================================================
-- 2. BLINDAR RPC CRIAR_OFICINA COM SUPORTE DÚPLICE A PARCEIROS E INDICAÇÕES
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.criar_oficina(
  p_nome text,
  p_cidade text DEFAULT NULL::text,
  p_uf text DEFAULT NULL::text,
  p_telefone text DEFAULT NULL::text,
  p_documento text DEFAULT NULL::text,
  p_codigo_indicacao text DEFAULT NULL::text,
  p_codigo_parceiro text DEFAULT NULL::text,
  p_codigo_campanha text DEFAULT NULL::text
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

  -- Variáveis de controle de Trial/Plano
  v_trial_ativo_config BOOLEAN := true;
  v_dias_trial_config INTEGER := 15;
  v_plano_inicial TEXT := 'pro';
  v_status_inicial TEXT := 'trial';
  v_dias_trial_concedidos INTEGER := 15;
  v_trial_fim DATE;
  v_valor_centavos INTEGER := 6700;

  -- Variáveis de Campanha
  v_campanha RECORD;
  v_campanha_usada TEXT := NULL;
BEGIN
  -- 0. Validar parâmetros básicos
  IF p_nome IS NULL OR trim(p_nome) = '' THEN
    RAISE EXCEPTION 'O nome da oficina é obrigatório';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  -- 1. Consultar Configurações Globais da Plataforma
  SELECT 
    COALESCE(trial_ativo, true),
    COALESCE(trial_dias, 15)
  INTO 
    v_trial_ativo_config,
    v_dias_trial_config
  FROM public.plataforma_config
  ORDER BY id ASC
  LIMIT 1;

  IF v_dias_trial_config IS NULL OR v_dias_trial_config <= 0 THEN
    v_dias_trial_config := 15;
  END IF;

  -- 2. Verificar se foi fornecido um Código de Campanha de Lançamento
  IF p_codigo_campanha IS NOT NULL AND trim(p_codigo_campanha) != '' THEN
    SELECT * INTO v_campanha
    FROM public.campanhas_lancamento
    WHERE upper(codigo) = upper(trim(p_codigo_campanha))
      AND ativo = true
      AND (data_fim IS NULL OR data_fim >= current_date)
      AND (limite_usos IS NULL OR usos_atuais < limite_usos)
    LIMIT 1;

    IF FOUND THEN
      v_plano_inicial := COALESCE(v_campanha.plano_concedido, 'pro');
      v_status_inicial := 'trial';
      v_dias_trial_concedidos := COALESCE(v_campanha.dias_trial, v_dias_trial_config);
      v_trial_fim := (current_date + v_dias_trial_concedidos);
      v_valor_centavos := 6700;
      v_campanha_usada := v_campanha.codigo;

      -- Incrementar contador de usos da campanha
      UPDATE public.campanhas_lancamento
      SET usos_atuais = usos_atuais + 1,
          updated_at = now()
      WHERE id = v_campanha.id;
    END IF;
  END IF;

  -- 3. Se nenhuma campanha válida foi aplicada, aplicar regra geral de Trial
  IF v_campanha_usada IS NULL THEN
    IF NOT v_trial_ativo_config THEN
      -- ADMIN DESLIGOU O TRIAL: entra direto no plano FREE
      v_plano_inicial := 'free';
      v_status_inicial := 'ativo';
      v_dias_trial_concedidos := 0;
      v_trial_fim := NULL;
      v_valor_centavos := 0;
    ELSE
      -- ADMIN MANTEVE LIGADO: ganha os dias configurados no plano PRO
      v_plano_inicial := 'pro';
      v_status_inicial := 'trial';
      v_dias_trial_concedidos := v_dias_trial_config;
      v_trial_fim := (current_date + v_dias_trial_concedidos);
      v_valor_centavos := 6700;
    END IF;
  ELSE
    v_status_inicial := 'trial';
    v_trial_fim := (current_date + v_dias_trial_concedidos);
  END IF;

  v_slug := lower(regexp_replace(p_nome, '[^a-zA-Z0-9]+', '-', 'g'))
            || '-' || substr(gen_random_uuid()::text, 1, 6);

  v_codigo_proprio := public.gerar_codigo_indicacao_unico();

  -- 4. Criar Tenant
  INSERT INTO public.tenants (nome, slug, cidade, uf, telefone, documento, criado_por, plano, codigo_indicacao)
    VALUES (p_nome, v_slug, p_cidade, p_uf, p_telefone, p_documento, auth.uid(), v_plano_inicial, v_codigo_proprio)
    RETURNING id INTO v_tenant;

  -- 5. Criar Membro Dono
  INSERT INTO public.tenant_members (tenant_id, user_id, email, role, status)
    VALUES (
      v_tenant, 
      auth.uid(),
      (SELECT email FROM auth.users WHERE id = auth.uid()),
      'dono', 
      'ativo'
    );

  -- 6. Registrar Assinatura Inicial
  INSERT INTO public.assinaturas (
    tenant_id, plano, status, valor_centavos, trial_fim, created_at, updated_at
  ) VALUES (
    v_tenant, v_plano_inicial, v_status_inicial, v_valor_centavos, v_trial_fim, now(), now()
  ) ON CONFLICT (tenant_id) DO UPDATE
  SET plano = EXCLUDED.plano, status = EXCLUDED.status, trial_fim = EXCLUDED.trial_fim, updated_at = now();

  -- 7. Semeadura de Categorias Padrão
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

  -- 8. Semeaduras Auxiliares
  BEGIN
    PERFORM public.seed_horarios_funcionamento_tenant(v_tenant);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    PERFORM public.seed_formas_pagamento_tenant(v_tenant);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  IF NOT EXISTS (SELECT 1 FROM public.tenant_maquininhas WHERE tenant_id = v_tenant AND padrao = true) THEN
    INSERT INTO public.tenant_maquininhas (tenant_id, nome, padrao, ordem)
    VALUES (v_tenant, 'Maquininha Padrão', true, 1);
  END IF;

  -- 9. Processar Código de PARCEIRO COMERCIAL (Precedência Absoluta)
  -- Analisa tanto p_codigo_parceiro quanto p_codigo_indicacao como fallback
  IF p_codigo_parceiro IS NOT NULL AND trim(p_codigo_parceiro) != '' THEN
    SELECT * INTO v_parceiro FROM public.parceiros 
    WHERE upper(codigo) = upper(trim(p_codigo_parceiro)) AND ativo = true;

    IF FOUND THEN
      INSERT INTO public.parceiro_oficinas (parceiro_id, tenant_id)
      VALUES (v_parceiro.id, v_tenant)
      ON CONFLICT (tenant_id) DO UPDATE SET parceiro_id = EXCLUDED.parceiro_id;
    END IF;
  ELSIF p_codigo_indicacao IS NOT NULL AND trim(p_codigo_indicacao) != '' THEN
    -- Fallback inteligente: se o código informado foi de parceiro
    SELECT * INTO v_parceiro FROM public.parceiros 
    WHERE upper(codigo) = upper(trim(p_codigo_indicacao)) AND ativo = true;

    IF FOUND THEN
      INSERT INTO public.parceiro_oficinas (parceiro_id, tenant_id)
      VALUES (v_parceiro.id, v_tenant)
      ON CONFLICT (tenant_id) DO UPDATE SET parceiro_id = EXCLUDED.parceiro_id;
    END IF;
  END IF;

  -- 10. Processar Código de INDICAÇÃO DE OFICINA (Indique e Ganhe)
  -- Somente se a oficina NÃO tiver sido vinculada a um parceiro comercial
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

  -- 11. Notificar Administradores da Plataforma
  BEGIN
    PERFORM public.notificar_admin(
      'nova_oficina',
      'Nova Oficina Cadastrada: ' || p_nome,
      'A oficina "' || p_nome || '" (' || coalesce(p_cidade, 'Sem cidade') || '/' || coalesce(p_uf, 'UF') || ') acabou de se cadastrar no plano ' || upper(v_plano_inicial) || '.' ||
      CASE WHEN v_campanha_usada IS NOT NULL THEN ' Campanha: ' || v_campanha_usada || '.' ELSE '' END ||
      CASE WHEN NOT v_trial_ativo_config AND v_campanha_usada IS NULL THEN ' (Trial desativado: iniciou no Plano Free).' ELSE '' END,
      '/admin/oficinas',
      jsonb_build_object('tenant_id', v_tenant, 'nome', p_nome, 'plano', v_plano_inicial, 'trial_fim', v_trial_fim, 'campanha', v_campanha_usada)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_tenant;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.criar_oficina(text, text, text, text, text, text, text, text) TO authenticated;

-- ==============================================================================
-- 3. RPC ADMIN PARA VINCULAR OU ALTERAR PARCEIRO DE UMA OFICINA COM SECURITY DEFINER
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.admin_vincular_oficina_parceiro(
  p_tenant_id UUID,
  p_parceiro_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Apenas administradores da plataforma podem vincular parceiros a oficinas.';
  END IF;

  IF p_parceiro_id IS NULL THEN
    DELETE FROM public.parceiro_oficinas WHERE tenant_id = p_tenant_id;
    RETURN jsonb_build_object('sucesso', true, 'removido', true);
  END IF;

  INSERT INTO public.parceiro_oficinas (parceiro_id, tenant_id)
  VALUES (p_parceiro_id, p_tenant_id)
  ON CONFLICT (tenant_id) DO UPDATE SET parceiro_id = EXCLUDED.parceiro_id;

  RETURN jsonb_build_object('sucesso', true, 'parceiro_id', p_parceiro_id, 'tenant_id', p_tenant_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_vincular_oficina_parceiro(UUID, UUID) TO authenticated, service_role;
