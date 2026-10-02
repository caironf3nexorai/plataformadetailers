-- ==============================================================================
-- MIGRAÇÃO 0143: CRIAR FUNÇÃO notificar_admin E BLINDAR criar_oficina
-- ==============================================================================

-- 1. CRIAR A FUNÇÃO notificar_admin
-- Permite que qualquer processo interno do banco envie notificações para administradores
-- da plataforma sem risco de quebra de transação.
CREATE OR REPLACE FUNCTION public.notificar_admin(
  p_tipo TEXT,
  p_titulo TEXT,
  p_mensagem TEXT,
  p_link TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Se a tabela de notificações existir, insere de forma segura
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
      NULL,
      NULL,
      'admin',
      NULL,
      p_tipo,
      p_titulo,
      p_mensagem,
      p_link,
      COALESCE(p_metadata, '{}'::jsonb),
      now()
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN OTHERS THEN
    -- Fallback silencioso: nunca abortar uma transação crítica (como criação de oficina)
    v_id := NULL;
  END;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notificar_admin(TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated, anon, service_role;

-- 2. BLINDAR A FUNÇÃO criar_oficina
-- Garante que se qualquer notificação ou serviço secundário falhar, a oficina
-- é criada com 100% de sucesso sem travar o cadastro do cliente.
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
    v_status_inicial := 'trial';
    v_trial_fim := (current_date + v_dias_trial_concedidos);
  END IF;

  v_slug := lower(regexp_replace(p_nome, '[^a-zA-Z0-9]+', '-', 'g'))
            || '-' || substr(gen_random_uuid()::text, 1, 6);

  v_codigo_proprio := public.gerar_codigo_indicacao_unico();

  -- 1. Criar Tenant
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

  -- 3. Registrar Assinatura Inicial
  INSERT INTO public.assinaturas (
    tenant_id, plano, status, valor_centavos, trial_fim, created_at, updated_at
  ) VALUES (
    v_tenant, v_plano_inicial, v_status_inicial, v_valor_centavos, v_trial_fim, now(), now()
  ) ON CONFLICT (tenant_id) DO UPDATE
  SET plano = EXCLUDED.plano, status = EXCLUDED.status, trial_fim = EXCLUDED.trial_fim, updated_at = now();

  -- 4. Semeadura de Categorias Padrão
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

  -- 5. Semeadura de Horários de Funcionamento (Protegido)
  BEGIN
    PERFORM public.seed_horarios_funcionamento_tenant(v_tenant);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- 6. Semeadura de Formas de Pagamento (Protegido)
  BEGIN
    PERFORM public.seed_formas_pagamento_tenant(v_tenant);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- 7. Semeadura de Maquininha Padrão
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

  -- 10. Notificar Administradores da Plataforma (Blindado com try/catch)
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
    -- Nunca interromper o cadastro da oficina se houver falha de notificação
    NULL;
  END;

  RETURN v_tenant;
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_oficina(text, text, text, text, text, text, text, text) TO authenticated;
