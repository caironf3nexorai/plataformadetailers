-- ==============================================================================
-- MIGRAÇÃO 0136: TRAVAR ACADEMIA DE MATERIAIS APÓS PAGAMENTO & TOGGLE TRIAL NO ADMIN
-- ==============================================================================

-- 1. ADICIONAR CAMPOS DE CONTROLE DO TRIAL EM plataforma_config
ALTER TABLE public.plataforma_config
  ADD COLUMN IF NOT EXISTS trial_cadastro_ativo BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS trial_dias_padrao INTEGER NOT NULL DEFAULT 15;

-- 2. ATUALIZAR RPC obter_config_plataforma()
DROP FUNCTION IF EXISTS public.obter_config_plataforma();
CREATE OR REPLACE FUNCTION public.obter_config_plataforma()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_res JSONB;
BEGIN
  SELECT jsonb_build_object(
    'bloqueio_planos_ativo', COALESCE(bloqueio_planos_ativo, false),
    'trial_cadastro_ativo', COALESCE(trial_cadastro_ativo, true),
    'trial_dias_padrao', COALESCE(trial_dias_padrao, 15),
    'updated_at', updated_at
  ) INTO v_res
  FROM public.plataforma_config
  WHERE id = 1;

  RETURN COALESCE(v_res, jsonb_build_object(
    'bloqueio_planos_ativo', false,
    'trial_cadastro_ativo', true,
    'trial_dias_padrao', 15
  ));
END;
$$;
GRANT EXECUTE ON FUNCTION public.obter_config_plataforma() TO authenticated, anon;

-- 3. RPC PARA ALTERAR A CHAVE DE TRIAL DE CADASTRO NO PAINEL ADMIN
DROP FUNCTION IF EXISTS public.admin_alterar_trial_cadastro(boolean, integer);
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

  SELECT trial_cadastro_ativo, trial_dias_padrao
  INTO v_antigo_ativo, v_antigo_dias
  FROM public.plataforma_config
  WHERE id = 1;

  UPDATE public.plataforma_config
  SET trial_cadastro_ativo = p_ativo,
      trial_dias_padrao = COALESCE(p_dias, 15),
      updated_at = now()
  WHERE id = 1;

  -- Registrar log de auditoria
  INSERT INTO public.admin_audit_logs (
    admin_id,
    acao,
    entidade,
    entidade_id,
    dados_anteriores,
    dados_novos
  ) VALUES (
    auth.uid(),
    'alterar_trial_cadastro',
    'plataforma_config',
    '1',
    jsonb_build_object('trial_cadastro_ativo', v_antigo_ativo, 'trial_dias_padrao', v_antigo_dias),
    jsonb_build_object('trial_cadastro_ativo', p_ativo, 'trial_dias_padrao', p_dias)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_alterar_trial_cadastro(boolean, integer) TO authenticated;

-- 4. ATUALIZAR CRIAR_OFICINA COM SUPORTE AO TOGGLE DE TRIAL DE CADASTRO
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
  v_status_inicial text := 'trial';
  v_valor_centavos integer := 6700;
  v_dias_trial_concedidos integer := 15;
  v_trial_ativo_config boolean := true;
  v_dias_trial_config integer := 15;
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

  -- Obter configuração central da plataforma sobre Trial de Cadastro
  SELECT COALESCE(trial_cadastro_ativo, true), COALESCE(trial_dias_padrao, 15)
  INTO v_trial_ativo_config, v_dias_trial_config
  FROM public.plataforma_config
  WHERE id = 1;

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

  -- Se não houve campanha com trial explícito, respeitar o toggle do Painel Admin
  IF v_campanha_usada IS NULL THEN
    IF NOT v_trial_ativo_config THEN
      -- ADMIN DESLIGOU OS 15 DIAS GRÁTIS: entra direto no plano FREE sem trial!
      v_plano_inicial := 'free';
      v_status_inicial := 'ativa';
      v_dias_trial_concedidos := 0;
      v_trial_fim := NULL;
      v_valor_centavos := 0;
    ELSE
      -- ADMIN MANTEVE LIGADO: ganha os dias configurados (padrão 15) no plano PRO
      v_plano_inicial := 'pro';
      v_status_inicial := 'trial';
      v_dias_trial_concedidos := v_dias_trial_config;
      v_trial_fim := (current_date + v_dias_trial_concedidos);
      v_valor_centavos := 6700;
    END IF;
  ELSE
    -- Com campanha promocional:
    v_status_inicial := 'trial';
    v_trial_fim := (current_date + v_dias_trial_concedidos);
  END IF;

  v_slug := lower(regexp_replace(p_nome, '[^a-zA-Z0-9]+', '-', 'g'))
            || '-' || substr(gen_random_uuid()::text, 1, 6);

  v_codigo_proprio := public.gerar_codigo_indicacao_unico();

  -- 1. Criar Tenant com o plano definido (ou free se trial desligado)
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

  -- 3. Registrar Assinatura Inicial (Trial Pro ou Free Ativo)
  INSERT INTO public.assinaturas (
    tenant_id, plano, status, valor_centavos, trial_fim, created_at, updated_at
  ) VALUES (
    v_tenant, v_plano_inicial, v_status_inicial, v_valor_centavos, v_trial_fim, now(), now()
  ) ON CONFLICT (tenant_id) DO UPDATE
  SET plano = EXCLUDED.plano, status = EXCLUDED.status, trial_fim = EXCLUDED.trial_fim, updated_at = now();

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

  -- 10. Notificar Administradores da Plataforma
  PERFORM public.notificar_admin(
    'nova_oficina',
    'Nova Oficina Cadastrada: ' || p_nome,
    'A oficina "' || p_nome || '" (' || coalesce(p_cidade, 'Sem cidade') || '/' || coalesce(p_uf, 'UF') || ') acabou de se cadastrar no plano ' || upper(v_plano_inicial) || '.' ||
    CASE WHEN v_campanha_usada IS NOT NULL THEN ' Campanha: ' || v_campanha_usada || '.' ELSE '' END ||
    CASE WHEN NOT v_trial_ativo_config AND v_campanha_usada IS NULL THEN ' (Trial desativado: iniciou no Plano Free).' ELSE '' END,
    '/admin/oficinas',
    jsonb_build_object('tenant_id', v_tenant, 'nome', p_nome, 'plano', v_plano_inicial, 'trial_fim', v_trial_fim, 'campanha', v_campanha_usada)
  );

  RETURN v_tenant;
END;
$$;
GRANT EXECUTE ON FUNCTION public.criar_oficina(text, text, text, text, text, text, text, text) TO authenticated;

-- 5. ATUALIZAR RPC obter_materiais_assinante(text) PARA RESTRINGIR ACESSO A ASSINANTES COM PAGAMENTO CONFIRMADO
DROP FUNCTION IF EXISTS public.obter_materiais_assinante(text);
CREATE OR REPLACE FUNCTION public.obter_materiais_assinante(
  p_categoria TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_tenant_id UUID;
  v_plano TEXT := 'free';
  v_status_assinatura TEXT := 'trial';
  v_is_admin BOOLEAN := false;
  v_tem_pagamento_ativo BOOLEAN := false;
  v_resultado JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('erro', 'Não autenticado');
  END IF;

  v_is_admin := public.is_platform_admin();

  -- Localiza o tenant ativo do usuário autenticado através de tenant_members
  SELECT tm.tenant_id, COALESCE(t.plano::text, 'free')
  INTO v_tenant_id, v_plano
  FROM public.tenant_members tm
  JOIN public.tenants t ON t.id = tm.tenant_id
  WHERE tm.user_id = v_user_id AND tm.status = 'ativo'
  LIMIT 1;

  -- Se for admin da plataforma, libera modo completo
  IF v_tenant_id IS NULL AND v_is_admin THEN
    SELECT t.id, COALESCE(t.plano::text, 'studio')
    INTO v_tenant_id, v_plano
    FROM public.tenants t
    LIMIT 1;
  END IF;

  -- Fallback para proprietário do tenant
  IF v_tenant_id IS NULL THEN
    SELECT t.id, COALESCE(t.plano::text, 'free')
    INTO v_tenant_id, v_plano
    FROM public.tenants t
    WHERE t.criado_por = v_user_id
    LIMIT 1;
  END IF;

  IF v_plano IS NULL THEN
    v_plano := 'free';
  END IF;

  -- Verificar status da assinatura no Asaas
  IF v_tenant_id IS NOT NULL THEN
    SELECT status INTO v_status_assinatura
    FROM public.assinaturas
    WHERE tenant_id = v_tenant_id;
  END IF;

  -- REGRA DE NEGÓCIO: Academia de Materiais é liberada SOMENTE após pagamento confirmado no Asaas!
  -- Em período de degustação (trial), mesmo estando no plano Pro, os materiais didáticos permanecem bloqueados.
  v_tem_pagamento_ativo := v_is_admin OR (
    v_status_assinatura = 'ativa' AND v_plano != 'free'
  );

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'titulo', m.titulo,
    'descricao', m.descricao,
    'categoria', m.categoria,
    'arquivo_path', m.arquivo_path,
    'arquivo_nome', m.arquivo_nome,
    'tamanho_bytes', m.tamanho_bytes,
    'total_paginas', m.total_paginas,
    'capa_url', m.capa_url,
    'permitir_download', m.permitir_download,
    'planos_permitidos', m.planos_permitidos,
    'ordem', m.ordem,
    'disponivel_no_plano_atual', (
      v_is_admin
      OR (
        v_tem_pagamento_ativo
        AND (
          m.planos_permitidos IS NULL 
          OR cardinality(m.planos_permitidos) = 0
          OR v_plano = ANY(m.planos_permitidos)
        )
      )
    ),
    'requer_pagamento_confirmado', (
      NOT v_is_admin AND NOT v_tem_pagamento_ativo
    ),
    'is_trial', (v_status_assinatura = 'trial'),
    'created_at', m.created_at
  ) ORDER BY m.ordem ASC, m.created_at DESC), '[]'::jsonb)
  INTO v_resultado
  FROM public.academia_materiais m
  WHERE m.ativo = true
    AND (p_categoria IS NULL OR m.categoria = p_categoria);

  RETURN jsonb_build_object(
    'plano_atual', v_plano,
    'status_assinatura', v_status_assinatura,
    'tem_pagamento_ativo', v_tem_pagamento_ativo,
    'materiais', v_resultado
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.obter_materiais_assinante(text) TO authenticated;

-- 6. PROTEÇÃO DO BUCKET academia-materiais NO STORAGE (APENAS PAGANTES ATIVOS E ADMINS)
UPDATE storage.buckets
SET public = false
WHERE id = 'academia-materiais';

DROP POLICY IF EXISTS "Academia materiais visualizacao autenticados" ON storage.objects;
CREATE POLICY "Academia materiais visualizacao autenticados" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'academia-materiais'
    AND (
      public.is_platform_admin()
      OR EXISTS (
        SELECT 1
        FROM public.tenant_members tm
        JOIN public.assinaturas a ON a.tenant_id = tm.tenant_id
        JOIN public.tenants t ON t.id = tm.tenant_id
        WHERE tm.user_id = auth.uid()
          AND tm.status = 'ativo'
          AND a.status = 'ativa'
          AND t.plano != 'free'
      )
    )
  );
