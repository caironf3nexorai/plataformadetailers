-- ==============================================================================
-- Migration 0181: HOTFIX PRODUÇÃO — public.gerar_fila_lembretes_whatsapp
-- Corrige erro Postgres 42703: "column s.categoria does not exist"
-- A tabela public.servicos utiliza a coluna "grupo" (não "categoria").
-- 100% segura, idempotente e sem sobrecarga de assinatura (zero PGRST203).
-- ==============================================================================

BEGIN;

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
        AND (s.nome ~* 'vitrif|coating|grafeno|protecao|cristaliz' OR COALESCE(s.grupo, '') ~* 'vitrif|estetica|protecao')
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

COMMIT;

