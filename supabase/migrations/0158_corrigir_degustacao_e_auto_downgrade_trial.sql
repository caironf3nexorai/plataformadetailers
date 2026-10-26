-- ==============================================================================
-- MIGRAÇÃO 0158: CORREÇÃO DEFINITIVA DO CONTROLE DE TRIAL E DEGUSTAÇÃO
-- ==============================================================================
-- 1. Corrige public.obter_assinatura_tenant para auto-rebaixar trials vencidos para 'free'
--    sempre que a assinatura for consultada (independente de cron de servidor).
-- 2. Atualiza public.criar_oficina para respeitar 100% a chave de degustação desativada.
-- 3. Atualiza public.admin_alterar_trial_cadastro para sincronizar ambas as colunas
--    (trial_cadastro_ativo e trial_ativo).
-- 4. Executa varredura de retrocompatibilidade para rebaixar todas as oficinas com
--    trial já expirado (> 15 dias sem contratação de plano).
-- ==============================================================================

-- 1. Sincronizar colunas na tabela plataforma_config
UPDATE public.plataforma_config
SET trial_ativo = COALESCE(trial_cadastro_ativo, trial_ativo, true),
    trial_cadastro_ativo = COALESCE(trial_cadastro_ativo, trial_ativo, true),
    trial_dias = COALESCE(trial_dias_padrao, trial_dias, 15),
    trial_dias_padrao = COALESCE(trial_dias_padrao, trial_dias, 15)
WHERE id = 1;

-- 2. Atualizar a RPC admin_alterar_trial_cadastro para atualizar todas as colunas espelhadas
CREATE OR REPLACE FUNCTION public.admin_alterar_trial_cadastro(
  p_ativo BOOLEAN,
  p_dias INTEGER DEFAULT 15
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_antigo_ativo BOOLEAN;
  v_antigo_dias INTEGER;
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Apenas o administrador da plataforma pode alterar as configurações de trial.';
  END IF;

  SELECT COALESCE(trial_cadastro_ativo, trial_ativo, true), COALESCE(trial_dias_padrao, trial_dias, 15)
  INTO v_antigo_ativo, v_antigo_dias
  FROM public.plataforma_config
  WHERE id = 1;

  UPDATE public.plataforma_config
  SET trial_cadastro_ativo = p_ativo,
      trial_ativo = p_ativo,
      trial_dias_padrao = COALESCE(p_dias, 15),
      trial_dias = COALESCE(p_dias, 15),
      updated_at = now()
  WHERE id = 1;

  -- Registrar log de auditoria defensivo
  BEGIN
    INSERT INTO public.admin_auditoria (
      admin_user_id,
      acao,
      entidade,
      entidade_id,
      valor_anterior,
      valor_novo
    ) VALUES (
      auth.uid(),
      'alterar_trial_cadastro',
      'plataforma_config',
      '1',
      jsonb_build_object('trial_cadastro_ativo', v_antigo_ativo, 'trial_dias_padrao', v_antigo_dias),
      jsonb_build_object('trial_cadastro_ativo', p_ativo, 'trial_dias_padrao', p_dias)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_alterar_trial_cadastro(BOOLEAN, INTEGER) TO authenticated;

-- 3. Atualizar public.obter_assinatura_tenant com AUTO-DOWNGRADE caso o trial esteja vencido
CREATE OR REPLACE FUNCTION public.obter_assinatura_tenant(p_tenant_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
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
  v_plano_final TEXT;
  v_valor_dinamico INTEGER;
BEGIN
  v_tenant_id := COALESCE(p_tenant_id, (SELECT public.meus_tenants() LIMIT 1));
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('existe', false, 'status', 'trial', 'plano', 'pro', 'ciclo', 'mensal');
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = v_tenant_id;
  SELECT * INTO v_ass FROM public.assinaturas WHERE tenant_id = v_tenant_id;

  v_hoje := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  -- Se não possui registro de assinatura, verificar se a oficina é Free ou Pro
  IF NOT FOUND THEN
    SELECT preco_centavos INTO v_valor_dinamico FROM public.plans WHERE codigo = 'pro';
    RETURN jsonb_build_object(
      'existe', false,
      'plano', COALESCE(v_tenant.plano::text, 'free'),
      'status', CASE WHEN v_tenant.plano = 'free' THEN 'cancelada' ELSE 'trial' END,
      'ciclo', 'mensal',
      'valor_centavos', COALESCE(v_valor_dinamico, 0),
      'dias_trial_restantes', 0
    );
  END IF;

  v_status_final := v_ass.status;
  v_plano_final := COALESCE(v_ass.plano, v_tenant.plano, 'pro');

  -- VERIFICAÇÃO ATIVA DE EXPIRAÇÃO DE TRIAL:
  -- Se o status for trial e a data trial_fim já passou da data de hoje,
  -- realiza o downgrade automático e atômico para o plano FREE.
  IF v_status_final = 'trial' AND v_ass.trial_fim IS NOT NULL THEN
    v_dias_trial := v_ass.trial_fim - v_hoje;
    IF v_dias_trial <= 0 THEN
      v_dias_trial := 0;
      v_status_final := 'cancelada';
      v_plano_final := 'free';

      -- Atualiza assinatura para cancelada/free
      UPDATE public.assinaturas
      SET plano = 'free',
          status = 'cancelada',
          cancelada_em = COALESCE(cancelada_em, now()),
          updated_at = now()
      WHERE id = v_ass.id;

      -- Atualiza tenant para free
      UPDATE public.tenants
      SET plano = 'free',
          updated_at = now()
      WHERE id = v_tenant_id;
    END IF;
  END IF;

  -- VERIFICAÇÃO DE ATRASO:
  IF v_status_final = 'atrasada' AND v_ass.atraso_desde IS NOT NULL THEN
    v_dias_atraso := v_hoje - v_ass.atraso_desde;
    v_dias_para_rebaixamento := 5 - v_dias_atraso;
    IF v_dias_para_rebaixamento <= 0 THEN
      v_dias_para_rebaixamento := 0;
      v_status_final := 'cancelada';
      v_plano_final := 'free';

      UPDATE public.assinaturas
      SET plano = 'free',
          status = 'cancelada',
          updated_at = now()
      WHERE id = v_ass.id;

      UPDATE public.tenants
      SET plano = 'free',
          updated_at = now()
      WHERE id = v_tenant_id;
    END IF;
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
  WHERE p.codigo = v_plano_final;

  RETURN jsonb_build_object(
    'existe', true,
    'id', v_ass.id,
    'tenant_id', v_ass.tenant_id,
    'plano', v_plano_final,
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

-- 4. Atualizar criar_oficina para respeitar 100% a chave de degustação desativada
DROP FUNCTION IF EXISTS public.criar_oficina(text, text, text, text, text, text, text);
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

-- 5. REBAIXAMENTO IMEDIATO DE TODAS AS OFICINAS COM TRIAL VENCIDO
-- Atualiza tenants e assinaturas que já passaram da data limite do trial (ex: 15 dias passados)
DO $$
DECLARE
  v_hoje DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  -- Rebaixa assinaturas vencidas para free
  UPDATE public.assinaturas
  SET plano = 'free',
      status = 'cancelada',
      cancelada_em = COALESCE(cancelada_em, now()),
      updated_at = now()
  WHERE status = 'trial'
    AND trial_fim IS NOT NULL
    AND trial_fim < v_hoje;

  -- Rebaixa os tenants correspondentes para free
  UPDATE public.tenants t
  SET plano = 'free',
      updated_at = now()
  FROM public.assinaturas a
  WHERE a.tenant_id = t.id
    AND a.status = 'cancelada'
    AND a.plano = 'free'
    AND t.plano != 'free';
END $$;
