-- Migration 0149: Permitir atualização de perfil do usuário e da oficina com validações avançadas
-- 1. Regra de alteração de nome da oficina: somente a cada 15 dias (cooldown)
-- 2. Validação obrigatória de unicidade de nome da oficina (não permite duplicatas)
-- 3. Atualização automática do slug sincronizado com o novo nome da oficina
-- 4. Suporte a Super Admin com opção de bypass do cooldown em casos de suporte

-- 0. Adicionar coluna para rastrear quando o nome da oficina foi alterado pela última vez
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS nome_alterado_em TIMESTAMPTZ;

-- Índice para busca rápida por nome normalizado
CREATE INDEX IF NOT EXISTS idx_tenants_nome_lower ON public.tenants (LOWER(TRIM(nome)));

-- 1. Garantir validação resiliente de administrador da plataforma (por user_id ou por email)
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE (user_id = auth.uid() OR LOWER(email) = LOWER(COALESCE(auth.jwt()->>'email', '')))
      AND ativo = true AND revogado_em IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.is_platform_admin_editor()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE (user_id = auth.uid() OR LOWER(email) = LOWER(COALESCE(auth.jwt()->>'email', '')))
      AND ativo = true AND revogado_em IS NULL AND nivel = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin_editor() TO authenticated;

-- 2. Função helper para gerar slug limpo e único a partir do nome da oficina
CREATE OR REPLACE FUNCTION public.gerar_slug_oficina(
  p_nome TEXT,
  p_tenant_id UUID DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base TEXT;
  v_sufixo TEXT;
  v_slug_final TEXT;
  v_slug_existente TEXT;
  v_tentativa INT := 0;
BEGIN
  -- 1. Normalizar nome base (remover acentos comuns, caracteres especiais, converter espaços em hífens)
  v_base := LOWER(TRIM(p_nome));
  -- Substituições de acentos PT-BR nativas
  v_base := translate(v_base, 
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 
    'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn');
  -- Remove caracteres não alfanuméricos
  v_base := regexp_replace(v_base, '[^a-z0-9]+', '-', 'g');
  -- Remove hífens no início e fim
  v_base := regexp_replace(v_base, '^-+|-+$', '', 'g');
  
  IF v_base IS NULL OR length(v_base) < 2 THEN
    v_base := 'oficina';
  END IF;

  -- Se o tenant já possui um slug com sufixo de 6 caracteres hexadecimais (ex: axion-detail-42edbd),
  -- preserva o mesmo sufixo para manter identidade e estabilidade do link
  IF p_tenant_id IS NOT NULL THEN
    SELECT slug INTO v_slug_existente FROM public.tenants WHERE id = p_tenant_id;
    IF v_slug_existente IS NOT NULL AND v_slug_existente ~ '-[a-f0-9]{6}$' THEN
      v_sufixo := substring(v_slug_existente from '-[a-f0-9]{6}$');
    END IF;
  END IF;

  IF v_sufixo IS NOT NULL THEN
    v_slug_final := v_base || v_sufixo;
    IF NOT EXISTS (
      SELECT 1 FROM public.tenants 
      WHERE slug = v_slug_final 
        AND id <> COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
    ) THEN
      RETURN v_slug_final;
    END IF;
  END IF;

  -- Se não tinha sufixo ou houve colisão, gera novo sufixo de 6 caracteres hexadecimais
  LOOP
    v_tentativa := v_tentativa + 1;
    v_slug_final := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
    
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.tenants 
      WHERE slug = v_slug_final 
        AND id <> COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
    ) OR v_tentativa > 20;
  END LOOP;

  RETURN v_slug_final;
END;
$$;

GRANT EXECUTE ON FUNCTION public.gerar_slug_oficina(TEXT, UUID) TO authenticated;

-- 3. RPC para o próprio usuário atualizar seu perfil pessoal (nome e telefone)
CREATE OR REPLACE FUNCTION public.atualizar_meu_perfil(
  p_nome TEXT,
  p_telefone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_nome_limpo TEXT;
  v_tel_limpo TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  v_nome_limpo := TRIM(p_nome);
  IF v_nome_limpo IS NULL OR LENGTH(v_nome_limpo) < 2 THEN
    RAISE EXCEPTION 'O nome deve ter pelo menos 2 caracteres.';
  END IF;

  v_tel_limpo := NULLIF(TRIM(p_telefone), '');

  -- Atualiza ou insere em public.profiles
  INSERT INTO public.profiles (id, nome, telefone)
  VALUES (v_user_id, v_nome_limpo, v_tel_limpo)
  ON CONFLICT (id) DO UPDATE
  SET 
    nome = EXCLUDED.nome,
    telefone = COALESCE(EXCLUDED.telefone, public.profiles.telefone),
    updated_at = now();

  -- Sincroniza metadados do auth.users
  UPDATE auth.users
  SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
    'nome', v_nome_limpo,
    'telefone', COALESCE(v_tel_limpo, raw_user_meta_data->>'telefone')
  )
  WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_user_id,
    'nome', v_nome_limpo,
    'telefone', v_tel_limpo
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.atualizar_meu_perfil(TEXT, TEXT) TO authenticated;

-- 4. RPC para o Dono da Oficina alterar o nome da Oficina (com regra de 15 dias, unicidade e atualização de slug)
CREATE OR REPLACE FUNCTION public.atualizar_nome_oficina(
  p_novo_nome TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_nome_limpo TEXT;
  v_novo_slug TEXT;
  v_tenant RECORD;
  v_dias_restantes INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  -- Obter tenant onde o usuário autenticado é Dono ativo
  SELECT tenant_id INTO v_tenant_id
  FROM public.tenant_members
  WHERE user_id = auth.uid() AND role = 'dono' AND status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: apenas o proprietário da oficina pode alterar o nome.';
  END IF;

  v_nome_limpo := TRIM(p_novo_nome);
  IF v_nome_limpo IS NULL OR LENGTH(v_nome_limpo) < 2 THEN
    RAISE EXCEPTION 'O nome da oficina deve ter pelo menos 2 caracteres.';
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = v_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oficina não encontrada.';
  END IF;

  -- Se o nome for exatamente idêntico ao atual
  IF LOWER(TRIM(v_tenant.nome)) = LOWER(v_nome_limpo) THEN
    RAISE EXCEPTION 'O novo nome informado é idêntico ao atual.';
  END IF;

  -- 1. Verificação se o nome já existe em outra oficina
  IF EXISTS (
    SELECT 1 FROM public.tenants
    WHERE LOWER(TRIM(nome)) = LOWER(v_nome_limpo)
      AND id <> v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Já existe uma oficina cadastrada com o nome "%". Por favor, escolha um nome diferente.', v_nome_limpo;
  END IF;

  -- 2. Regra de intervalo de 15 dias para alteração
  IF v_tenant.nome_alterado_em IS NOT NULL AND v_tenant.nome_alterado_em > (now() - interval '15 days') THEN
    v_dias_restantes := CEIL(EXTRACT(EPOCH FROM ((v_tenant.nome_alterado_em + interval '15 days') - now())) / 86400.0);
    RAISE EXCEPTION 'O nome da oficina só pode ser alterado a cada 15 dias. Aguarde mais % dia(s) para fazer uma nova alteração.', v_dias_restantes;
  END IF;

  -- 3. Gerar novo slug sincronizado diretamente com o novo nome
  v_novo_slug := public.gerar_slug_oficina(v_nome_limpo, v_tenant_id);

  -- 4. Atualizar tenant com novo nome, novo slug e timestamp de alteração
  UPDATE public.tenants
  SET nome = v_nome_limpo,
      slug = v_novo_slug,
      nome_alterado_em = now(),
      updated_at = now()
  WHERE id = v_tenant_id;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_tenant_id,
    'nome', v_nome_limpo,
    'slug', v_novo_slug,
    'nome_alterado_em', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.atualizar_nome_oficina(TEXT) TO authenticated;

-- 5. RPC para o Super Admin alterar o nome de qualquer Oficina (com suporte a bypass de cooldown opcional)
DROP FUNCTION IF EXISTS public.admin_atualizar_nome_oficina(UUID, TEXT);
DROP FUNCTION IF EXISTS public.admin_atualizar_nome_oficina(UUID, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION public.admin_atualizar_nome_oficina(
  p_tenant_id UUID,
  p_novo_nome TEXT,
  p_ignorar_cooldown BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nome_limpo TEXT;
  v_novo_slug TEXT;
  v_tenant RECORD;
  v_dias_restantes INT;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores da plataforma podem alterar o nome da oficina.';
  END IF;

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'ID da oficina é obrigatório.';
  END IF;

  v_nome_limpo := TRIM(p_novo_nome);
  IF v_nome_limpo IS NULL OR LENGTH(v_nome_limpo) < 2 THEN
    RAISE EXCEPTION 'O nome da oficina deve ter pelo menos 2 caracteres.';
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oficina não encontrada.';
  END IF;

  -- 1. Verificação se o nome já existe em outra oficina
  IF EXISTS (
    SELECT 1 FROM public.tenants
    WHERE LOWER(TRIM(nome)) = LOWER(v_nome_limpo)
      AND id <> p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Já existe uma oficina cadastrada com o nome "%". Por favor, escolha um nome diferente.', v_nome_limpo;
  END IF;

  -- 2. Regra de intervalo de 15 dias (respeitada a menos que o Super Admin marque ignorar)
  IF NOT p_ignorar_cooldown AND v_tenant.nome_alterado_em IS NOT NULL AND v_tenant.nome_alterado_em > (now() - interval '15 days') THEN
    v_dias_restantes := CEIL(EXTRACT(EPOCH FROM ((v_tenant.nome_alterado_em + interval '15 days') - now())) / 86400.0);
    RAISE EXCEPTION 'O nome desta oficina foi alterado recentemente. Faltam % dia(s) para o intervalo de 15 dias. Marque a opção de ignorar intervalo caso necessário.', v_dias_restantes;
  END IF;

  -- 3. Gerar novo slug sincronizado diretamente com o novo nome
  v_novo_slug := public.gerar_slug_oficina(v_nome_limpo, p_tenant_id);

  -- 4. Atualizar tenant com novo nome, novo slug e timestamp de alteração
  UPDATE public.tenants
  SET nome = v_nome_limpo,
      slug = v_novo_slug,
      nome_alterado_em = now(),
      updated_at = now()
  WHERE id = p_tenant_id;

  -- Registrar na auditoria do admin
  INSERT INTO public.admin_auditoria (
    admin_user_id, acao, entidade, entidade_id, valor_anterior, valor_novo
  ) VALUES (
    auth.uid(),
    'admin_alterar_nome_oficina',
    'tenants',
    p_tenant_id::text,
    jsonb_build_object('nome', v_tenant.nome, 'slug', v_tenant.slug),
    jsonb_build_object('nome', v_nome_limpo, 'slug', v_novo_slug, 'ignorado_cooldown', p_ignorar_cooldown)
  );

  RETURN jsonb_build_object(
    'success', true,
    'id', p_tenant_id,
    'nome', v_nome_limpo,
    'slug', v_novo_slug,
    'nome_alterado_em', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_atualizar_nome_oficina(UUID, TEXT, BOOLEAN) TO authenticated;

-- 6. RPC para o Super Admin atualizar o perfil de qualquer usuário/proprietário
CREATE OR REPLACE FUNCTION public.admin_atualizar_usuario_perfil(
  p_user_id UUID,
  p_nome TEXT,
  p_telefone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nome_limpo TEXT;
  v_tel_limpo TEXT;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores da plataforma podem executar esta ação.';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'ID do usuário é obrigatório.';
  END IF;

  v_nome_limpo := TRIM(p_nome);
  IF v_nome_limpo IS NULL OR LENGTH(v_nome_limpo) < 2 THEN
    RAISE EXCEPTION 'O nome deve ter pelo menos 2 caracteres.';
  END IF;

  v_tel_limpo := NULLIF(TRIM(p_telefone), '');

  INSERT INTO public.profiles (id, nome, telefone)
  VALUES (p_user_id, v_nome_limpo, v_tel_limpo)
  ON CONFLICT (id) DO UPDATE
  SET 
    nome = EXCLUDED.nome,
    telefone = COALESCE(EXCLUDED.telefone, public.profiles.telefone),
    updated_at = now();

  UPDATE auth.users
  SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
    'nome', v_nome_limpo,
    'telefone', COALESCE(v_tel_limpo, raw_user_meta_data->>'telefone')
  )
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'id', p_user_id,
    'nome', v_nome_limpo,
    'telefone', v_tel_limpo
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_atualizar_usuario_perfil(UUID, TEXT, TEXT) TO authenticated;

-- 7. Atualizar admin_detalhe_tenant para retornar nome_alterado_em
DROP FUNCTION IF EXISTS public.admin_detalhe_tenant(UUID);
CREATE OR REPLACE FUNCTION public.admin_detalhe_tenant(p_tenant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant RECORD;
  v_membros JSONB;
  v_historico_12m JSONB;
  v_storage JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oficina não encontrada';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', tm.id,
    'user_id', tm.user_id,
    'email', tm.email,
    'nome', COALESCE(p.nome, u.raw_user_meta_data->>'nome', tm.email),
    'telefone', COALESCE(p.telefone, u.raw_user_meta_data->>'telefone', null),
    'role', tm.role,
    'status', tm.status,
    'ultimo_acesso', GREATEST(
      COALESCE(u.last_sign_in_at, '1970-01-01 00:00:00+00'::timestamptz), 
      COALESCE(p.last_seen_at, '1970-01-01 00:00:00+00'::timestamptz)
    )
  )), '[]'::jsonb)
  INTO v_membros
  FROM public.tenant_members tm
  LEFT JOIN public.profiles p ON p.id = tm.user_id
  LEFT JOIN auth.users u ON u.id = tm.user_id
  WHERE tm.tenant_id = p_tenant_id;

  WITH meses AS (
    SELECT generate_series(
      date_trunc('month', now() - interval '11 months'),
      date_trunc('month', now()),
      interval '1 month'
    )::date AS mes
  ),
  ag AS (
    SELECT date_trunc('month', created_at)::date AS mes, COUNT(*) AS cnt
    FROM public.agendamentos
    WHERE tenant_id = p_tenant_id AND created_at >= (now() - interval '12 months')
    GROUP BY 1
  ),
  ex AS (
    SELECT date_trunc('month', iniciado_em)::date AS mes, COUNT(*) AS cnt
    FROM public.execucoes
    WHERE tenant_id = p_tenant_id AND status = 'finalizado' AND iniciado_em >= (now() - interval '12 months')
    GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'mes', to_char(m.mes, 'YYYY-MM'),
    'agendamentos_criados', COALESCE(ag.cnt, 0),
    'execucoes_finalizadas', COALESCE(ex.cnt, 0)
  ) ORDER BY m.mes ASC), '[]'::jsonb)
  INTO v_historico_12m
  FROM meses m
  LEFT JOIN ag ON ag.mes = m.mes
  LEFT JOIN ex ON ex.mes = m.mes;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'bucket', bucket,
    'total_arquivos', total_arquivos,
    'total_bytes', total_bytes,
    'calculado_em', calculado_em
  )), '[]'::jsonb)
  INTO v_storage
  FROM public.storage_uso_snapshot
  WHERE tenant_id = p_tenant_id
    AND calculado_em = (SELECT MAX(calculado_em) FROM public.storage_uso_snapshot WHERE tenant_id = p_tenant_id);

  RETURN jsonb_build_object(
    'tenant', jsonb_build_object(
      'id', v_tenant.id,
      'nome', v_tenant.nome,
      'slug', v_tenant.slug,
      'plano', v_tenant.plano,
      'cidade', v_tenant.cidade,
      'uf', v_tenant.uf,
      'created_at', v_tenant.created_at,
      'nome_alterado_em', v_tenant.nome_alterado_em,
      'agendamento_online_ativo', v_tenant.agendamento_online_ativo
    ),
    'membros', v_membros,
    'historico_12m', v_historico_12m,
    'storage', COALESCE(v_storage, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_detalhe_tenant(UUID) TO authenticated;

-- 8. Atualizar criar_oficina para validar se o nome já existe antes de cadastrar
CREATE OR REPLACE FUNCTION public.criar_oficina(
  p_nome text,
  p_cidade text DEFAULT NULL,
  p_uf text DEFAULT NULL,
  p_telefone text DEFAULT NULL,
  p_codigo_indicacao text DEFAULT NULL,
  p_codigo_parceiro text DEFAULT NULL,
  p_documento text DEFAULT NULL,
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
  v_valor_centavos INTEGER := 6700;

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

  -- 3. Definição do plano e trial inicial
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
      v_valor_centavos := 6700;
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
    nome, slug, cidade, uf, telefone, documento, criado_por, plano, codigo_indicacao
  ) VALUES (
    p_nome, v_slug, p_cidade, p_uf, p_telefone, p_documento, auth.uid(), v_plano_inicial, v_codigo_proprio
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
      trial_fim = EXCLUDED.trial_fim, 
      valor_centavos = EXCLUDED.valor_centavos, 
      updated_at = now();

  -- 8. Seeder inicial essencial (categorias de veículos e checklist padrão)
  BEGIN
    PERFORM public.seed_categorias_padrao(v_tenant);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    PERFORM public.seed_checklist_itens_padrao(v_tenant);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- 9. Registrar vínculo de indicação ou parceiro se aplicável
  IF p_codigo_parceiro IS NOT NULL AND trim(p_codigo_parceiro) != '' THEN
    BEGIN
      SELECT * INTO v_parceiro
      FROM public.parceiros
      WHERE upper(trim(codigo_cupom)) = upper(trim(p_codigo_parceiro))
        AND ativo = true
      LIMIT 1;

      IF FOUND THEN
        INSERT INTO public.indicacoes (
          indicador_user_id, indicado_tenant_id, codigo_usado, status, created_at, updated_at
        ) VALUES (
          v_parceiro.user_id, v_tenant, v_parceiro.codigo_cupom, 'ativo', now(), now()
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  ELSIF p_codigo_indicacao IS NOT NULL AND trim(p_codigo_indicacao) != '' THEN
    BEGIN
      SELECT id, criado_por INTO v_indicador
      FROM public.tenants
      WHERE upper(trim(codigo_indicacao)) = upper(trim(p_codigo_indicacao))
      LIMIT 1;

      IF FOUND AND v_indicador.criado_por <> auth.uid() THEN
        INSERT INTO public.indicacoes (
          indicador_user_id, indicado_tenant_id, codigo_usado, status, created_at, updated_at
        ) VALUES (
          v_indicador.criado_por, v_tenant, upper(trim(p_codigo_indicacao)), 'ativo', now(), now()
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  RETURN v_tenant;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.criar_oficina(text, text, text, text, text, text, text, text) TO authenticated;
