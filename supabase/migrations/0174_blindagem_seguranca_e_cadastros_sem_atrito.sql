-- ==============================================================================
-- MIGRAÇÃO 0174: BLINDAGEM DE SEGURANÇA CRÍTICA E CADASTROS SEM ATRITO
-- ==============================================================================
-- PARTE 1 — SEGURANÇA CRÍTICA (SB-001, SB-002, WhatsApp IDOR/api_key, SB-003,
--           SB-005 e higiene de GRANTS em RPCs SECURITY DEFINER):
--   1.1 Endurece obter_resumo_nfse_tenant(UUID): exige autenticação/tenant ou
--       service_role e remove token_focus_nfe do JSON retornado.
--   1.2 Endurece obter_assinatura_tenant(UUID): exige autenticação e pertencimento
--       ao tenant (ou platform admin / service_role).
--   1.3 Endurece WhatsApp (obter_resumo_whatsapp_tenant, gerar_fila_lembretes_whatsapp,
--       cron_processar_lembretes_whatsapp_todos_tenants, atualizar_status_mensagem_whatsapp)
--       e restringe SELECT de tenant_config_whatsapp a dono/gerente/platform_admin.
--   1.4 Restringe listagem (storage.objects SELECT) dos buckets públicos
--       'catalogo' e 'onboarding-videos' a authenticated autorizado, preservando
--       buckets.public = true para URLs públicas de imagem/vídeo (CDN).
--   1.5 Revoga EXECUTE de PUBLIC/anon e padroniza GRANTs seguros em RPCs críticas
--       incluindo is_super_admin(), atualizar_veiculo() e RPCs de 0123/0124/0149/0171-0173.
--
-- PARTE 2 — REMOÇÃO DE TRAVAS DE QUEBRA ("FRICTIONLESS SAAS"):
--   2.1 Remove bloqueio de duplicidade global por nome em criar_oficina,
--       atualizar_nome_oficina e admin_atualizar_nome_oficina (unicidade real
--       mantida na URL/slug via gerar_slug_oficina e atualizar_slug_oficina).
--   2.2 Evolui cadastro_rapido (assinatura exata 8 args de 0168) para tornar a
--       placa opcional na criação de veículo (gera PROV-... se vazia/genérica)
--       e usar a primeira categoria ativa do tenant quando p_categoria for NULL.
-- ==============================================================================


-- ==============================================================================
-- PARTE 1: BLINDAGEM DE SEGURANÇA CRÍTICA
-- ==============================================================================

-- 1.1 NFS-E: EXIGIR PERTENCIMENTO AO TENANT E REMOVER token_focus_nfe DO PAYLOAD
CREATE OR REPLACE FUNCTION public.obter_resumo_nfse_tenant(p_tenant_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_is_system BOOLEAN;
  v_tenant UUID;
  v_plano TEXT;
  v_limite INTEGER;
  v_total_mes INTEGER;
  v_config RECORD;
  v_inicio_mes TIMESTAMPTZ;
BEGIN
  v_is_system := (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin'));

  IF NOT v_is_system AND auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  v_tenant := COALESCE(p_tenant_id, (SELECT public.meus_tenants() LIMIT 1));
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Tenant não identificado';
  END IF;

  IF NOT v_is_system AND NOT (v_tenant IN (SELECT public.meus_tenants()) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Acesso negado às informações fiscais desta oficina.';
  END IF;

  -- 1. Plano do tenant
  SELECT plano INTO v_plano FROM public.tenants WHERE id = v_tenant;
  v_plano := COALESCE(v_plano, 'free');

  -- 2. Limite numérico do plano
  SELECT limite INTO v_limite
  FROM public.plan_limits
  WHERE plano = v_plano AND recurso = 'notas_fiscais_mes';

  v_limite := COALESCE(v_limite, 0);

  -- 3. Início do mês corrente em UTC
  v_inicio_mes := date_trunc('month', now());

  -- 4. Contagem de notas emitidas/autorizadas no mês corrente
  SELECT COUNT(*)::integer INTO v_total_mes
  FROM public.notas_fiscais
  WHERE tenant_id = v_tenant
    AND status IN ('autorizada', 'emitida', 'processando', 'pendente')
    AND created_at >= v_inicio_mes;

  v_total_mes := COALESCE(v_total_mes, 0);

  -- 5. Dados da configuração fiscal (removendo token sensível token_focus_nfe)
  SELECT * INTO v_config FROM public.tenant_config_fiscal WHERE tenant_id = v_tenant;

  RETURN jsonb_build_object(
    'tenant_id', v_tenant,
    'plano', v_plano,
    'plano_id', v_plano,
    'limite_mes', v_limite,
    'limite_mensal', v_limite,
    'total_emitidas_mes', v_total_mes,
    'emitidas_mes', v_total_mes,
    'saldo_restante', GREATEST(0, v_limite - v_total_mes),
    'disponiveis_mes', GREATEST(0, v_limite - v_total_mes),
    'atingiu_limite', (v_limite > 0 AND v_total_mes >= v_limite),
    'pode_emitir', (v_limite > 0 AND v_total_mes < v_limite),
    'config_preenchida', (v_config.cnpj IS NOT NULL AND v_config.cnpj != ''),
    'configurada', (v_config.cnpj IS NOT NULL AND v_config.cnpj != ''),
    'config', CASE
      WHEN v_config.id IS NOT NULL THEN (row_to_json(v_config)::jsonb - 'token_focus_nfe')
      ELSE NULL
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.obter_resumo_nfse_tenant(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obter_resumo_nfse_tenant(UUID) TO authenticated, service_role;


-- 1.2 ASSINATURA DO TENANT: EXIGIR AUTENTICAÇÃO E PERTENCIMENTO AO TENANT
CREATE OR REPLACE FUNCTION public.obter_assinatura_tenant(p_tenant_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_is_system BOOLEAN;
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
  v_is_system := (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin'));

  IF NOT v_is_system AND auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  v_tenant_id := COALESCE(p_tenant_id, (SELECT public.meus_tenants() LIMIT 1));
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('existe', false, 'status', 'trial', 'plano', 'pro', 'ciclo', 'mensal');
  END IF;

  IF NOT v_is_system AND NOT (v_tenant_id IN (SELECT public.meus_tenants()) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Acesso negado às informações de assinatura desta oficina.';
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = v_tenant_id;
  SELECT * INTO v_ass FROM public.assinaturas WHERE tenant_id = v_tenant_id;

  v_hoje := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

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

  -- VERIFICAÇÃO ATIVA DE EXPIRAÇÃO DE TRIAL
  IF v_status_final = 'trial' AND v_ass.trial_fim IS NOT NULL THEN
    v_dias_trial := v_ass.trial_fim - v_hoje;
    IF v_dias_trial <= 0 THEN
      v_dias_trial := 0;
      v_status_final := 'cancelada';
      v_plano_final := 'free';

      UPDATE public.assinaturas
      SET plano = 'free',
          status = 'cancelada',
          cancelada_em = COALESCE(cancelada_em, now()),
          updated_at = now()
      WHERE id = v_ass.id;

      UPDATE public.tenants
      SET plano = 'free',
          updated_at = now()
      WHERE id = v_tenant_id;
    END IF;
  END IF;

  -- VERIFICAÇÃO DE ATRASO
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

  -- Busca preço dinâmico na tabela plans
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
    'cancelada_em', v_ass.cancelada_em,
    'promo_meses_restantes', v_ass.promo_meses_restantes,
    'promo_valor_normal_centavos', v_ass.promo_valor_normal_centavos,
    'promo_cupom_codigo', v_ass.promo_cupom_codigo,
    'promo_valor_cobrado_centavos', v_ass.valor_centavos
  );
END;
$$;

REVOKE ALL ON FUNCTION public.obter_assinatura_tenant(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obter_assinatura_tenant(UUID) TO authenticated, service_role;


-- 1.3 WHATSAPP IDOR, api_key E TRAVAMENTO DE CRON
-- 1.3a RLS de tenant_config_whatsapp: apenas Donos, Gerentes e Admins visualizam api_key
DROP POLICY IF EXISTS "Membros visualizam config whatsapp do seu tenant" ON public.tenant_config_whatsapp;
DROP POLICY IF EXISTS "Donos e Gerentes visualizam config whatsapp do seu tenant" ON public.tenant_config_whatsapp;

CREATE POLICY "Donos e Gerentes visualizam config whatsapp do seu tenant" ON public.tenant_config_whatsapp
  FOR SELECT
  TO authenticated
  USING (
    (
      tenant_id IN (SELECT public.meus_tenants())
      AND public.tem_papel(tenant_id, ARRAY['dono', 'gerente']::public.app_role[])
    )
    OR public.is_platform_admin()
  );

-- 1.3b obter_resumo_whatsapp_tenant: apenas dono/gerente do tenant, admin plataforma ou sistema
CREATE OR REPLACE FUNCTION public.obter_resumo_whatsapp_tenant(p_tenant_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_is_system BOOLEAN;
  v_tenant UUID;
  v_config RECORD;
  v_total_pendentes INTEGER := 0;
  v_total_enviados_hoje INTEGER := 0;
  v_total_falhas_hoje INTEGER := 0;
  v_ultimas_mensagens JSONB;
BEGIN
  v_is_system := (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin'));

  IF NOT v_is_system AND auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  v_tenant := COALESCE(p_tenant_id, (SELECT public.meus_tenants() LIMIT 1));
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Tenant não identificado';
  END IF;

  IF NOT v_is_system AND NOT (
    (v_tenant IN (SELECT public.meus_tenants()) AND public.tem_papel(v_tenant, ARRAY['dono', 'gerente']::public.app_role[]))
    OR public.is_platform_admin()
  ) THEN
    RAISE EXCEPTION 'Apenas donos ou gerentes podem acessar as configurações de WhatsApp da oficina.';
  END IF;

  SELECT * INTO v_config FROM public.tenant_config_whatsapp WHERE tenant_id = v_tenant;

  SELECT count(*) INTO v_total_pendentes
  FROM public.fila_mensagens_whatsapp
  WHERE tenant_id = v_tenant AND status = 'pendente';

  SELECT count(*) INTO v_total_enviados_hoje
  FROM public.fila_mensagens_whatsapp
  WHERE tenant_id = v_tenant AND status = 'enviado' AND enviado_em::date = CURRENT_DATE;

  SELECT count(*) INTO v_total_falhas_hoje
  FROM public.fila_mensagens_whatsapp
  WHERE tenant_id = v_tenant AND status = 'falha' AND created_at::date = CURRENT_DATE;

  SELECT coalesce(jsonb_agg(row_to_json(m)), '[]'::jsonb)
  INTO v_ultimas_mensagens
  FROM (
    SELECT id, tipo, destinatario_nome, destinatario_telefone, mensagem, status, agendado_para, enviado_em, erro_mensagem, created_at
    FROM public.fila_mensagens_whatsapp
    WHERE tenant_id = v_tenant
    ORDER BY created_at DESC
    LIMIT 50
  ) m;

  RETURN jsonb_build_object(
    'tenant_id', v_tenant,
    'config', CASE WHEN v_config.tenant_id IS NOT NULL THEN row_to_json(v_config)::jsonb ELSE NULL END,
    'total_pendentes', v_total_pendentes,
    'total_enviados_hoje', v_total_enviados_hoje,
    'total_falhas_hoje', v_total_falhas_hoje,
    'mensagens', v_ultimas_mensagens
  );
END;
$$;

REVOKE ALL ON FUNCTION public.obter_resumo_whatsapp_tenant(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obter_resumo_whatsapp_tenant(UUID) TO authenticated, service_role;

-- 1.3c gerar_fila_lembretes_whatsapp: apenas dono/gerente do tenant, admin plataforma ou sistema/cron
CREATE OR REPLACE FUNCTION public.gerar_fila_lembretes_whatsapp(p_tenant_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_is_system BOOLEAN;
  v_tenant UUID;
  v_oficina_nome TEXT;
  v_fuso TEXT;
  v_config RECORD;
  v_count_agendamentos INTEGER := 0;
  v_count_vitrificacoes INTEGER := 0;
  v_count_inativos INTEGER := 0;
  r_item RECORD;
  v_msg TEXT;
  v_tel_limpo TEXT;
  v_hash TEXT;
BEGIN
  v_is_system := (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin'));

  IF NOT v_is_system AND auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  v_tenant := COALESCE(p_tenant_id, (SELECT public.meus_tenants() LIMIT 1));
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Tenant não identificado';
  END IF;

  IF NOT v_is_system AND NOT (
    (v_tenant IN (SELECT public.meus_tenants()) AND public.tem_papel(v_tenant, ARRAY['dono', 'gerente']::public.app_role[]))
    OR public.is_platform_admin()
  ) THEN
    RAISE EXCEPTION 'Acesso negado para gerar fila de lembretes desta oficina.';
  END IF;

  SELECT nome, COALESCE(fuso_horario, 'America/Sao_Paulo')
  INTO v_oficina_nome, v_fuso
  FROM public.tenants
  WHERE id = v_tenant;

  v_oficina_nome := COALESCE(v_oficina_nome, 'Nossa Oficina');
  v_fuso := COALESCE(v_fuso, 'America/Sao_Paulo');

  SELECT * INTO v_config FROM public.tenant_config_whatsapp WHERE tenant_id = v_tenant;
  IF v_config.tenant_id IS NULL THEN
    INSERT INTO public.tenant_config_whatsapp (tenant_id)
    VALUES (v_tenant)
    RETURNING * INTO v_config;
  END IF;

  IF v_config.lembrete_agendamento_ativo THEN
    FOR r_item IN
      SELECT
        a.id AS agendamento_id,
        a.cliente_id,
        c.nome AS cliente_nome,
        c.telefone AS cliente_telefone,
        to_char(a.inicio AT TIME ZONE v_fuso, 'HH24:MI') AS hora_agendamento,
        to_char(a.inicio AT TIME ZONE v_fuso, 'DD/MM/YYYY') AS data_agendamento,
        COALESCE(v.modelo, 'Veículo') AS veiculo_modelo,
        COALESCE(s.nome, 'Serviços Automotivos') AS servico_nome
      FROM public.agendamentos a
      JOIN public.clientes c ON c.id = a.cliente_id AND c.ativo = true
      LEFT JOIN public.veiculos v ON v.id = a.veiculo_id
      LEFT JOIN public.servicos s ON s.id = a.servico_id
      WHERE a.tenant_id = v_tenant
        AND a.status IN ('agendado', 'confirmado')
        AND (a.inicio AT TIME ZONE v_fuso)::date = (CURRENT_DATE + 1)
        AND c.telefone IS NOT NULL
        AND trim(c.telefone) != ''
    LOOP
      v_tel_limpo := regexp_replace(r_item.cliente_telefone, '[^0-9]', '', 'g');
      IF length(v_tel_limpo) >= 10 THEN
        v_hash := md5(v_tenant::text || r_item.cliente_id::text || 'agendamento_' || r_item.agendamento_id::text || CURRENT_DATE::text);

        v_msg := replace(v_config.lembrete_agendamento_template, '{cliente}', split_part(r_item.cliente_nome, ' ', 1));
        v_msg := replace(v_msg, '{hora}', r_item.hora_agendamento);
        v_msg := replace(v_msg, '{data}', r_item.data_agendamento);
        v_msg := replace(v_msg, '{oficina}', v_oficina_nome);
        v_msg := replace(v_msg, '{veiculo}', r_item.veiculo_modelo);
        v_msg := replace(v_msg, '{servicos}', r_item.servico_nome);

        INSERT INTO public.fila_mensagens_whatsapp (
          tenant_id, cliente_id, agendamento_id, tipo,
          destinatario_nome, destinatario_telefone, mensagem, status,
          hash_dedup, agendado_para
        ) VALUES (
          v_tenant, r_item.cliente_id, r_item.agendamento_id, 'agendamento',
          r_item.cliente_nome, v_tel_limpo, v_msg, 'pendente',
          v_hash, now()
        ) ON CONFLICT (hash_dedup) DO NOTHING;

        IF FOUND THEN
          v_count_agendamentos := v_count_agendamentos + 1;
        END IF;
      END IF;
    END LOOP;
  END IF;

  IF v_config.lembrete_vitrificacao_ativo THEN
    FOR r_item IN
      SELECT
        a.id AS agendamento_id,
        a.cliente_id,
        c.nome AS cliente_nome,
        c.telefone AS cliente_telefone,
        v.modelo AS veiculo_modelo,
        s.nome AS servico_nome,
        (CURRENT_DATE - COALESCE(e.finalizado_em, a.inicio)::date) AS dias_passados
      FROM public.agendamentos a
      LEFT JOIN public.execucoes e ON e.agendamento_id = a.id
      JOIN public.clientes c ON c.id = a.cliente_id AND c.ativo = true
      LEFT JOIN public.veiculos v ON v.id = a.veiculo_id
      JOIN public.servicos s ON s.id = a.servico_id
      WHERE a.tenant_id = v_tenant
        AND (a.status = 'concluido' OR e.status = 'finalizado')
        AND (s.nome ~* 'vitrif|coating|grafeno|protecao|cristaliz' OR s.categoria ~* 'vitrif|estetica')
        AND (CURRENT_DATE - COALESCE(e.finalizado_em, a.inicio)::date) BETWEEN (v_config.lembrete_vitrificacao_dias - 5) AND (v_config.lembrete_vitrificacao_dias + 15)
        AND c.telefone IS NOT NULL
        AND trim(c.telefone) != ''
    LOOP
      v_tel_limpo := regexp_replace(r_item.cliente_telefone, '[^0-9]', '', 'g');
      IF length(v_tel_limpo) >= 10 THEN
        v_hash := md5(v_tenant::text || r_item.cliente_id::text || 'vitrificacao_' || r_item.agendamento_id::text || to_char(CURRENT_DATE, 'YYYY_MM'));

        v_msg := replace(v_config.lembrete_vitrificacao_template, '{cliente}', split_part(r_item.cliente_nome, ' ', 1));
        v_msg := replace(v_msg, '{dias}', r_item.dias_passados::text);
        v_msg := replace(v_msg, '{servico}', r_item.servico_nome);
        v_msg := replace(v_msg, '{veiculo}', COALESCE(r_item.veiculo_modelo, 'Veículo'));
        v_msg := replace(v_msg, '{oficina}', v_oficina_nome);

        INSERT INTO public.fila_mensagens_whatsapp (
          tenant_id, cliente_id, agendamento_id, tipo,
          destinatario_nome, destinatario_telefone, mensagem, status,
          hash_dedup, agendado_para
        ) VALUES (
          v_tenant, r_item.cliente_id, r_item.agendamento_id, 'vitrificacao_retorno',
          r_item.cliente_nome, v_tel_limpo, v_msg, 'pendente',
          v_hash, now()
        ) ON CONFLICT (hash_dedup) DO NOTHING;

        IF FOUND THEN
          v_count_vitrificacoes := v_count_vitrificacoes + 1;
        END IF;
      END IF;
    END LOOP;
  END IF;

  IF v_config.lembrete_retorno_inativo_ativo THEN
    FOR r_item IN
      SELECT
        c.id AS cliente_id,
        c.nome AS cliente_nome,
        c.telefone AS cliente_telefone,
        MAX(a.inicio::date) AS ultima_data,
        (CURRENT_DATE - MAX(a.inicio::date)) AS dias_sem_visita
      FROM public.clientes c
      JOIN public.agendamentos a ON a.cliente_id = c.id AND a.tenant_id = v_tenant
      WHERE c.tenant_id = v_tenant
        AND c.ativo = true
        AND a.status = 'concluido'
        AND c.telefone IS NOT NULL
        AND trim(c.telefone) != ''
      GROUP BY c.id, c.nome, c.telefone
      HAVING (CURRENT_DATE - MAX(a.inicio::date)) BETWEEN v_config.lembrete_retorno_inativo_dias AND (v_config.lembrete_retorno_inativo_dias + 7)
    LOOP
      v_tel_limpo := regexp_replace(r_item.cliente_telefone, '[^0-9]', '', 'g');
      IF length(v_tel_limpo) >= 10 THEN
        v_hash := md5(v_tenant::text || r_item.cliente_id::text || 'inativo_' || to_char(CURRENT_DATE, 'YYYY_MM'));

        v_msg := replace(v_config.lembrete_retorno_inativo_template, '{cliente}', split_part(r_item.cliente_nome, ' ', 1));
        v_msg := replace(v_msg, '{veiculo}', 'veículo');
        v_msg := replace(v_msg, '{oficina}', v_oficina_nome);

        INSERT INTO public.fila_mensagens_whatsapp (
          tenant_id, cliente_id, tipo,
          destinatario_nome, destinatario_telefone, mensagem, status,
          hash_dedup, agendado_para
        ) VALUES (
          v_tenant, r_item.cliente_id, 'cliente_inativo',
          r_item.cliente_nome, v_tel_limpo, v_msg, 'pendente',
          v_hash, now()
        ) ON CONFLICT (hash_dedup) DO NOTHING;

        IF FOUND THEN
          v_count_inativos := v_count_inativos + 1;
        END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'sucesso', true,
    'total_enfileirados', (v_count_agendamentos + v_count_vitrificacoes + v_count_inativos),
    'agendamentos_amanha', v_count_agendamentos,
    'manutencoes_vitrificacao', v_count_vitrificacoes,
    'clientes_reativados', v_count_inativos,
    'mensagem', 'Varredura automática concluída! Novas mensagens enfileiradas com sucesso.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.gerar_fila_lembretes_whatsapp(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerar_fila_lembretes_whatsapp(UUID) TO authenticated, service_role;

-- 1.3d cron_processar_lembretes_whatsapp_todos_tenants: estritamente service_role / pg_cron
CREATE OR REPLACE FUNCTION public.cron_processar_lembretes_whatsapp_todos_tenants()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_system BOOLEAN;
  r_tenant RECORD;
  v_tenants_processados INTEGER := 0;
  v_erros INTEGER := 0;
BEGIN
  v_is_system := (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin'));
  IF NOT v_is_system THEN
    RAISE EXCEPTION 'Acesso negado: função exclusiva de agendamento interno (pg_cron / service_role).';
  END IF;

  FOR r_tenant IN
    SELECT t.id, t.nome
    FROM public.tenants t
    WHERE t.ativo = true
  LOOP
    BEGIN
      PERFORM public.gerar_fila_lembretes_whatsapp(r_tenant.id);
      v_tenants_processados := v_tenants_processados + 1;
    EXCEPTION WHEN OTHERS THEN
      v_erros := v_erros + 1;
      RAISE WARNING '[Cron WhatsApp Multi-Tenant] Erro no tenant % (%): %', r_tenant.id, r_tenant.nome, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'sucesso', true,
    'tenants_processados', v_tenants_processados,
    'erros', v_erros,
    'executado_em', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cron_processar_lembretes_whatsapp_todos_tenants() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_processar_lembretes_whatsapp_todos_tenants() TO service_role;

-- 1.3e atualizar_status_mensagem_whatsapp: valida tenant, papel e status permitido
CREATE OR REPLACE FUNCTION public.atualizar_status_mensagem_whatsapp(
  p_id UUID,
  p_status TEXT,
  p_erro TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_is_system BOOLEAN;
  v_tenant UUID;
BEGIN
  v_is_system := (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin'));

  IF NOT v_is_system AND auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('pendente', 'enviando', 'enviado', 'falha', 'cancelado') THEN
    RAISE EXCEPTION 'Status de mensagem inválido: %', COALESCE(p_status, 'NULL');
  END IF;

  SELECT f.tenant_id INTO v_tenant
  FROM public.fila_mensagens_whatsapp f
  WHERE f.id = p_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Mensagem não encontrada na fila.';
  END IF;

  IF NOT v_is_system AND NOT (
    (v_tenant IN (SELECT public.meus_tenants()) AND public.tem_papel(v_tenant, ARRAY['dono', 'gerente']::public.app_role[]))
    OR public.is_platform_admin()
  ) THEN
    RAISE EXCEPTION 'Acesso negado para atualizar mensagem desta oficina.';
  END IF;

  UPDATE public.fila_mensagens_whatsapp
  SET
    status = p_status,
    enviado_em = CASE WHEN p_status = 'enviado' THEN now() ELSE enviado_em END,
    erro_mensagem = p_erro,
    tentativas = tentativas + 1
  WHERE id = p_id;

  RETURN jsonb_build_object('sucesso', true);
END;
$$;

REVOKE ALL ON FUNCTION public.atualizar_status_mensagem_whatsapp(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atualizar_status_mensagem_whatsapp(UUID, TEXT, TEXT) TO authenticated, service_role;


-- 1.4 STORAGE: BLOQUEAR LISTAGEM ANÔNIMA NOS BUCKETS 'catalogo' E 'onboarding-videos'
-- Mantém buckets.public = true para que URLs públicas (/object/public/...) continuem
-- renderizando normalmente no app e nos links públicos de orçamento/agendamento.
DROP POLICY IF EXISTS "Leitura pública de objetos do catálogo" ON storage.objects;
DROP POLICY IF EXISTS "Leitura autenticada de objetos do catálogo por tenant" ON storage.objects;
CREATE POLICY "Leitura autenticada de objetos do catálogo por tenant" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'catalogo'
    AND (
      (
        array_length(storage.foldername(name), 1) >= 1
        AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND (storage.foldername(name))[1]::uuid IN (SELECT public.meus_tenants())
      )
      OR public.is_platform_admin()
    )
  );

DROP POLICY IF EXISTS "Dono e Gerente inserem no catalogo" ON storage.objects;
CREATE POLICY "Dono e Gerente inserem no catalogo" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'catalogo'
    AND (
      (
        array_length(storage.foldername(name), 1) >= 1
        AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND public.tem_papel((storage.foldername(name))[1]::uuid, ARRAY['dono','gerente']::public.app_role[])
      )
      OR public.is_platform_admin()
    )
  );

DROP POLICY IF EXISTS "Dono e Gerente atualizam no catalogo" ON storage.objects;
CREATE POLICY "Dono e Gerente atualizam no catalogo" ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'catalogo'
    AND (
      (
        array_length(storage.foldername(name), 1) >= 1
        AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND public.tem_papel((storage.foldername(name))[1]::uuid, ARRAY['dono','gerente']::public.app_role[])
      )
      OR public.is_platform_admin()
    )
  );

DROP POLICY IF EXISTS "Dono e Gerente deletam no catalogo" ON storage.objects;
CREATE POLICY "Dono e Gerente deletam no catalogo" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'catalogo'
    AND (
      (
        array_length(storage.foldername(name), 1) >= 1
        AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND public.tem_papel((storage.foldername(name))[1]::uuid, ARRAY['dono','gerente']::public.app_role[])
      )
      OR public.is_platform_admin()
    )
  );

DROP POLICY IF EXISTS "Onboarding videos leitura publica" ON storage.objects;
DROP POLICY IF EXISTS "Platform admin le onboarding videos" ON storage.objects;
CREATE POLICY "Platform admin le onboarding videos" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'onboarding-videos'
    AND public.is_platform_admin()
  );


-- 1.5 REVOGAÇÃO DE ANON/PUBLIC E HIGIENE DE RPCs ADICIONAIS
-- 1.5a registrar_emissao_nfse: exigir auth.uid() explicitamente
CREATE OR REPLACE FUNCTION public.registrar_emissao_nfse(p_dados JSONB)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
  v_resumo JSONB;
  v_id UUID;
  v_rps_num INTEGER;
  v_rps_serie TEXT;
  v_valor_num NUMERIC;
  v_valor_centavos INTEGER;
  v_numero TEXT;
  v_atendimento_id UUID;
  v_tomador_nome TEXT;
  v_tomador_doc TEXT;
  v_tomador_email TEXT;
  v_tomador_tel TEXT;
  v_discriminacao TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  v_tenant := (SELECT public.meus_tenants() LIMIT 1);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Nenhuma oficina associada';
  END IF;

  v_resumo := public.obter_resumo_nfse_tenant(v_tenant);
  IF (v_resumo->>'atingiu_limite')::boolean = true THEN
    RAISE EXCEPTION 'Limite mensal de notas fiscais do plano atingido (% de %). Faça upgrade do plano para continuar emitindo.',
      v_resumo->>'emitidas_mes', v_resumo->>'limite_mensal';
  END IF;

  IF (v_resumo->>'limite_mensal')::integer <= 0 THEN
    RAISE EXCEPTION 'O plano atual não possui cota para emissão de notas fiscais. Faça upgrade para o Plano Pro ou Studio.';
  END IF;

  v_atendimento_id := (p_dados->>'atendimento_id')::uuid;
  v_valor_num := COALESCE((p_dados->>'valor_total')::numeric, (p_dados->>'valor_centavos')::numeric / 100.0, 0);
  v_valor_centavos := round(v_valor_num * 100)::integer;
  v_tomador_nome := trim(COALESCE(p_dados->>'tomador_nome', 'Cliente'));
  v_tomador_doc := trim(COALESCE(p_dados->>'tomador_cpf_cnpj', ''));
  v_tomador_email := trim(COALESCE(p_dados->>'tomador_email', ''));
  v_tomador_tel := trim(COALESCE(p_dados->>'tomador_telefone', ''));
  v_discriminacao := trim(COALESCE(p_dados->>'discriminacao', p_dados->>'discriminacao_servico', 'Serviços de estética automotiva'));

  UPDATE public.tenant_config_fiscal
  SET proximo_rps = COALESCE(proximo_rps, 1) + 1,
      updated_at = now()
  WHERE tenant_id = v_tenant
  RETURNING (proximo_rps - 1), COALESCE(serie_rps, '1') INTO v_rps_num, v_rps_serie;

  v_numero := LPAD(COALESCE(v_rps_num, 1)::text, 6, '0');

  INSERT INTO public.notas_fiscais (
    tenant_id, atendimento_id, numero, numero_nfse, serie, serie_rps, numero_rps,
    valor_total, valor_centavos, tomador_nome, tomador_cpf_cnpj, tomador_email, tomador_telefone,
    discriminacao, discriminacao_servico, status, url_danfe, url_xml, emitido_por, emitido_em, created_at
  ) VALUES (
    v_tenant, v_atendimento_id, v_numero, v_numero, v_rps_serie, v_rps_serie, v_rps_num,
    v_valor_num, v_valor_centavos, v_tomador_nome, v_tomador_doc, v_tomador_email, v_tomador_tel,
    v_discriminacao, v_discriminacao, 'emitida',
    'https://api.focusnfe.com.br/v2/nfse/' || v_numero || '/danfe',
    'https://api.focusnfe.com.br/v2/nfse/' || v_numero || '/xml',
    auth.uid(), now(), now()
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'sucesso', true,
    'id', v_id,
    'numero', v_numero,
    'numero_nfse', v_numero,
    'status', 'emitida',
    'mensagem', 'NFS-e autorizada e registrada com sucesso!'
  );
END;
$$;

-- 1.5b atualizar_veiculo: permitir também is_platform_admin() além de membro ativo do tenant
CREATE OR REPLACE FUNCTION public.atualizar_veiculo(
  p_veiculo_id uuid,
  p_cor text default null,
  p_marca text default null,
  p_modelo text default null,
  p_ano integer default null,
  p_placa text default null,
  p_categoria_id uuid default null,
  p_observacoes text default null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_veiculo record;
  v_ret jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT v.* INTO v_veiculo
  FROM public.veiculos v
  WHERE v.id = p_veiculo_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Veículo não encontrado.';
  END IF;

  IF NOT (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid()
        AND tm.tenant_id = v_veiculo.tenant_id
        AND tm.status = 'ativo'
    )
    OR public.is_platform_admin()
  ) THEN
    RAISE EXCEPTION 'Acesso negado ao veículo deste tenant.';
  END IF;

  UPDATE public.veiculos
  SET
    cor = CASE WHEN p_cor IS NOT NULL THEN nullif(trim(p_cor), '') ELSE cor END,
    marca = CASE WHEN p_marca IS NOT NULL THEN nullif(trim(p_marca), '') ELSE marca END,
    modelo = CASE WHEN p_modelo IS NOT NULL THEN nullif(trim(p_modelo), '') ELSE modelo END,
    ano = CASE WHEN p_ano IS NOT NULL THEN p_ano ELSE ano END,
    placa = CASE WHEN p_placa IS NOT NULL AND trim(p_placa) <> '' THEN upper(trim(p_placa)) ELSE placa END,
    categoria_id = CASE WHEN p_categoria_id IS NOT NULL THEN p_categoria_id ELSE categoria_id END,
    observacoes = CASE WHEN p_observacoes IS NOT NULL THEN nullif(trim(p_observacoes), '') ELSE observacoes END,
    updated_at = now()
  WHERE id = p_veiculo_id;

  SELECT jsonb_build_object(
    'id', v.id,
    'tenant_id', v.tenant_id,
    'cliente_id', v.cliente_id,
    'categoria_id', v.categoria_id,
    'placa', v.placa,
    'marca', v.marca,
    'modelo', v.modelo,
    'cor', v.cor,
    'ano', v.ano,
    'observacoes', v.observacoes,
    'ativo', v.ativo,
    'updated_at', v.updated_at
  ) INTO v_ret
  FROM public.veiculos v
  WHERE v.id = p_veiculo_id;

  RETURN v_ret;
END;
$$;

-- 1.5c Revogar PUBLIC/anon de RPCs administrativas e internas sensíveis
REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_platform_admin_editor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin_editor() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.salvar_config_fiscal_tenant(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_config_fiscal_tenant(JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.salvar_config_whatsapp_tenant(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_config_whatsapp_tenant(JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.registrar_emissao_nfse(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_emissao_nfse(JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.atualizar_veiculo(UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atualizar_veiculo(UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.marcar_welcome_modal_visto(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_welcome_modal_visto(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.atualizar_progresso_onboarding(UUID, JSONB, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atualizar_progresso_onboarding(UUID, JSONB, BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.obter_status_onboarding(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obter_status_onboarding(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.atualizar_slug_oficina(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atualizar_slug_oficina(TEXT, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_salvar_config_onboarding(TEXT, TEXT, BOOLEAN, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_salvar_config_onboarding(TEXT, TEXT, BOOLEAN, JSONB) TO authenticated;

REVOKE ALL ON FUNCTION public.salvar_matriz_precos(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_matriz_precos(UUID, JSONB) TO authenticated;


-- ==============================================================================
-- PARTE 2: REMOÇÃO DE TRAVAS DE QUEBRA EM CADASTROS
-- ==============================================================================

-- 2.1 DESBLOQUEAR NOMES HOMÔNIMOS DE OFICINAS (UNICIDADE REAL MANTIDA NO SLUG)
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

  -- Nota: Nomes comerciais não exigem unicidade global; a URL única é garantida
  -- via public.gerar_slug_oficina(v_nome_limpo).

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


-- Atualizar também atualizar_nome_oficina e admin_atualizar_nome_oficina removendo trava de nome duplicado
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

  IF LOWER(TRIM(v_tenant.nome)) = LOWER(v_nome_limpo) THEN
    RAISE EXCEPTION 'O novo nome informado é idêntico ao atual.';
  END IF;

  IF v_tenant.nome_alterado_em IS NOT NULL AND v_tenant.nome_alterado_em > (now() - interval '15 days') THEN
    v_dias_restantes := CEIL(EXTRACT(EPOCH FROM ((v_tenant.nome_alterado_em + interval '15 days') - now())) / 86400.0);
    RAISE EXCEPTION 'O nome da oficina só pode ser alterado a cada 15 dias. Aguarde mais % dia(s) para fazer uma nova alteração.', v_dias_restantes;
  END IF;

  v_novo_slug := public.gerar_slug_oficina(v_nome_limpo, v_tenant_id);

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

REVOKE ALL ON FUNCTION public.atualizar_nome_oficina(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atualizar_nome_oficina(TEXT) TO authenticated;


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

  IF NOT p_ignorar_cooldown AND v_tenant.nome_alterado_em IS NOT NULL AND v_tenant.nome_alterado_em > (now() - interval '15 days') THEN
    v_dias_restantes := CEIL(EXTRACT(EPOCH FROM ((v_tenant.nome_alterado_em + interval '15 days') - now())) / 86400.0);
    RAISE EXCEPTION 'O nome desta oficina foi alterado recentemente. Faltam % dia(s) para o intervalo de 15 dias. Marque a opção de ignorar intervalo caso necessário.', v_dias_restantes;
  END IF;

  v_novo_slug := public.gerar_slug_oficina(v_nome_limpo, p_tenant_id);

  UPDATE public.tenants
  SET nome = v_nome_limpo,
      slug = v_novo_slug,
      nome_alterado_em = now(),
      updated_at = now()
  WHERE id = p_tenant_id;

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

REVOKE ALL ON FUNCTION public.admin_atualizar_nome_oficina(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_atualizar_nome_oficina(UUID, TEXT, BOOLEAN) TO authenticated;


-- 2.2 CADASTRO_RAPIDO SEM PLACA OBRIGATÓRIA E COM FALLBACK DE CATEGORIA
CREATE OR REPLACE FUNCTION public.cadastro_rapido(
  p_nome text,
  p_telefone text DEFAULT NULL,
  p_placa text DEFAULT NULL,
  p_categoria uuid DEFAULT NULL,
  p_marca text DEFAULT NULL,
  p_modelo text DEFAULT NULL,
  p_cor text DEFAULT NULL,
  p_cliente_id uuid DEFAULT NULL
)
RETURNS TABLE (out_cliente_id uuid, out_veiculo_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_tenant_id uuid;
  v_cliente_id uuid;
  v_veiculo_id uuid;
  v_telefone_limpo text;
  v_tel_digitos text;
  v_tel_norm text;
  v_placa_clean text;
  v_categoria_final uuid;
  v_existente_id uuid;
  v_existente_cliente_id uuid;
  v_is_generica boolean := false;
  v_tem_dados_veiculo boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF p_cliente_id IS NOT NULL THEN
    SELECT c.tenant_id, c.id
    INTO v_tenant_id, v_cliente_id
    FROM public.clientes c
    WHERE c.id = p_cliente_id AND COALESCE(c.ativo, true) = true
    LIMIT 1;

    IF v_cliente_id IS NULL THEN
      RAISE EXCEPTION 'Cliente não encontrado.';
    END IF;
  ELSE
    SELECT tm.tenant_id INTO v_tenant_id
    FROM public.tenant_members tm
    WHERE tm.user_id = auth.uid() AND tm.status = 'ativo'
    ORDER BY tm.created_at ASC
    LIMIT 1;

    IF v_tenant_id IS NULL THEN
      RAISE EXCEPTION 'Nenhum tenant ativo encontrado para o usuário.';
    END IF;
  END IF;

  IF NOT (
    public.tem_papel(v_tenant_id, ARRAY['dono', 'gerente']::public.app_role[])
    OR public.is_platform_admin()
  ) THEN
    RAISE EXCEPTION 'Operadores não podem cadastrar clientes ou veículos.';
  END IF;

  -- 1. Busca por telefone (apenas quando preenchido) ou cria novo cliente
  IF v_cliente_id IS NULL THEN
    IF coalesce(trim(p_nome), '') = '' THEN
      RAISE EXCEPTION 'Nome do cliente é obrigatório.';
    END IF;

    v_telefone_limpo := nullif(trim(p_telefone), '');
    v_tel_digitos := regexp_replace(coalesce(v_telefone_limpo, ''), '\D', '', 'g');

    IF v_telefone_limpo IS NOT NULL AND length(v_tel_digitos) < 8 THEN
      RAISE EXCEPTION 'Informe um WhatsApp ou telefone válido (mínimo 8 dígitos) ou deixe em branco caso o cliente não possua.';
    END IF;

    IF length(v_tel_digitos) >= 8 THEN
      v_tel_norm := public.normalizar_telefone(v_telefone_limpo);

      SELECT c.id INTO v_cliente_id
      FROM public.clientes c
      WHERE c.tenant_id = v_tenant_id
        AND COALESCE(c.ativo, true) = true
        AND (
          c.telefone = v_telefone_limpo
          OR (v_tel_norm IS NOT NULL AND public.normalizar_telefone(c.telefone) = v_tel_norm)
        )
      ORDER BY c.created_at ASC
      LIMIT 1;
    END IF;

    IF v_cliente_id IS NULL THEN
      INSERT INTO public.clientes (tenant_id, nome, telefone)
      VALUES (v_tenant_id, trim(p_nome), v_telefone_limpo)
      RETURNING clientes.id INTO v_cliente_id;
    END IF;
  END IF;

  -- 2. Se informou qualquer dado de veículo (placa opcional, modelo, marca, cor ou categoria)
  v_tem_dados_veiculo := (
    nullif(trim(coalesce(p_placa, '')), '') IS NOT NULL
    OR nullif(trim(coalesce(p_modelo, '')), '') IS NOT NULL
    OR nullif(trim(coalesce(p_marca, '')), '') IS NOT NULL
    OR nullif(trim(coalesce(p_cor, '')), '') IS NOT NULL
    OR p_categoria IS NOT NULL
  );

  IF v_tem_dados_veiculo THEN
    v_placa_clean := upper(trim(coalesce(p_placa, '')));

    IF v_placa_clean = ''
       OR v_placa_clean IN ('SEMPLACA', 'SEM PLACA', 'SEM', 'SP', 'NAOTEM', 'TESTE', 'PROV')
       OR v_placa_clean LIKE 'ORC%'
       OR v_placa_clean LIKE 'PROV%' THEN
      v_is_generica := true;
    END IF;

    -- Só reaproveita por placa quando há placa real única informada (ou código ORC/PROV específico existente do mesmo cliente)
    IF NOT v_is_generica THEN
      SELECT v.id, v.cliente_id INTO v_existente_id, v_existente_cliente_id
      FROM public.veiculos v
      WHERE v.tenant_id = v_tenant_id AND v.placa = v_placa_clean
      LIMIT 1;
    ELSIF v_placa_clean <> '' AND (v_placa_clean LIKE 'ORC%' OR v_placa_clean LIKE 'PROV-%') THEN
      SELECT v.id, v.cliente_id INTO v_existente_id, v_existente_cliente_id
      FROM public.veiculos v
      WHERE v.tenant_id = v_tenant_id AND v.cliente_id = v_cliente_id AND v.placa = v_placa_clean
      LIMIT 1;
    END IF;

    IF v_existente_id IS NOT NULL THEN
      v_veiculo_id := v_existente_id;

      IF v_existente_cliente_id IS DISTINCT FROM v_cliente_id THEN
        PERFORM public.transferir_veiculo(v_veiculo_id, v_cliente_id, current_date);
      END IF;

      UPDATE public.veiculos
      SET
        modelo = coalesce(nullif(trim(p_modelo), ''), modelo),
        marca = coalesce(nullif(trim(p_marca), ''), marca),
        categoria_id = coalesce(p_categoria, categoria_id),
        cor = coalesce(nullif(trim(p_cor), ''), cor)
      WHERE id = v_veiculo_id;
    ELSE
      -- Categoria explícita ou primeira categoria ativa da oficina como padrão
      v_categoria_final := p_categoria;
      IF v_categoria_final IS NULL THEN
        SELECT cv.id INTO v_categoria_final
        FROM public.categorias_veiculo cv
        WHERE cv.tenant_id = v_tenant_id
          AND COALESCE(cv.ativo, true) = true
        ORDER BY cv.ordem ASC NULLS LAST, cv.created_at ASC
        LIMIT 1;
      END IF;

      IF v_categoria_final IS NULL THEN
        SELECT cv.id INTO v_categoria_final
        FROM public.categorias_veiculo cv
        WHERE cv.tenant_id = v_tenant_id
        ORDER BY cv.ordem ASC NULLS LAST, cv.created_at ASC
        LIMIT 1;
      END IF;

      IF v_categoria_final IS NULL THEN
        RAISE EXCEPTION 'Nenhuma categoria de veículo cadastrada para esta oficina.';
      END IF;

      -- Gera identificador provisório único se a placa estiver vazia ou genérica
      IF v_placa_clean = ''
         OR v_placa_clean IN ('SEMPLACA', 'SEM PLACA', 'SEM', 'SP', 'NAOTEM', 'TESTE', 'PROV')
         OR EXISTS (SELECT 1 FROM public.veiculos WHERE tenant_id = v_tenant_id AND placa = v_placa_clean) THEN
        v_placa_clean := 'PROV-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));
      END IF;

      INSERT INTO public.veiculos (tenant_id, cliente_id, categoria_id, placa, marca, modelo, cor)
      VALUES (
        v_tenant_id,
        v_cliente_id,
        v_categoria_final,
        v_placa_clean,
        nullif(trim(p_marca), ''),
        coalesce(nullif(trim(p_modelo), ''), 'Veículo'),
        nullif(trim(p_cor), '')
      )
      RETURNING veiculos.id INTO v_veiculo_id;

      INSERT INTO public.veiculo_donos (tenant_id, veiculo_id, cliente_id, inicio, fim)
      VALUES (v_tenant_id, v_veiculo_id, v_cliente_id, current_date, null);
    END IF;
  END IF;

  out_cliente_id := v_cliente_id;
  out_veiculo_id := v_veiculo_id;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.cadastro_rapido(text, text, text, uuid, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cadastro_rapido(text, text, text, uuid, text, text, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
