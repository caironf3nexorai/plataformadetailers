-- ==============================================================================
-- MIGRAÇÃO 0124: AUTOMAÇÃO WHATSAPP PILOTO AUTOMÁTICO, FILA DE DISPARO E CRON
-- ==============================================================================

-- 1. TABELA DE CONFIGURAÇÃO DE WHATSAPP DA OFICINA
CREATE TABLE IF NOT EXISTS public.tenant_config_whatsapp (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'evolution_api', -- 'evolution_api', 'z_api', 'meta_api'
  api_url TEXT,                                   -- URL da VPS (ex: http://ip-da-vps:8080 ou https://zap.meusite.com)
  api_key TEXT,                                   -- Chave Global da Evolution API
  instance_name TEXT,                             -- Nome da instância da oficina
  instance_status TEXT NOT NULL DEFAULT 'desconectado', -- 'desconectado', 'conectando', 'conectado'
  numero_conectado TEXT,
  
  -- Automação 1: Lembrete de Agendamento 24h antes
  lembrete_agendamento_ativo BOOLEAN NOT NULL DEFAULT true,
  lembrete_agendamento_horas INTEGER NOT NULL DEFAULT 24,
  lembrete_agendamento_template TEXT NOT NULL DEFAULT 'Olá {cliente}! Lembrete do seu agendamento amanhã às {hora} na {oficina} para o veículo {veiculo} ({servicos}). Podemos confirmar sua presença?',
  
  -- Automação 2: Manutenção de Vitrificação / Coating / Retornos
  lembrete_vitrificacao_ativo BOOLEAN NOT NULL DEFAULT true,
  lembrete_vitrificacao_dias INTEGER NOT NULL DEFAULT 180,
  lembrete_vitrificacao_template TEXT NOT NULL DEFAULT 'Olá {cliente}! Passaram-se {dias} dias desde a aplicação de {servico} no seu {veiculo}. Para manter a garantia e a proteção hidrofóbica em dia, está na hora da manutenção preventiva! Vamos agendar sua revisão?',
  
  -- Automação 3: Reativação de Clientes Inativos / Sumidos
  lembrete_retorno_inativo_ativo BOOLEAN NOT NULL DEFAULT true,
  lembrete_retorno_inativo_dias INTEGER NOT NULL DEFAULT 60,
  lembrete_retorno_inativo_template TEXT NOT NULL DEFAULT 'Olá {cliente}! Sentimos sua falta aqui na {oficina}. Seu {veiculo} já está precisando daquele trato especial? Responda aqui para reservarmos seu horário com prioridade!',
  
  horario_envio_padrao TIME NOT NULL DEFAULT '08:30:00',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS para tenant_config_whatsapp
ALTER TABLE public.tenant_config_whatsapp ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuários gerenciam config de whatsapp do seu tenant" ON public.tenant_config_whatsapp;
CREATE POLICY "Usuários gerenciam config de whatsapp do seu tenant" ON public.tenant_config_whatsapp
  FOR ALL
  TO authenticated
  USING (tenant_id IN (SELECT public.meus_tenants()))
  WITH CHECK (tenant_id IN (SELECT public.meus_tenants()));

GRANT ALL ON public.tenant_config_whatsapp TO authenticated;

-- 2. TABELA DE FILA DE MENSAGENS WHATSAPP
CREATE TABLE IF NOT EXISTS public.fila_mensagens_whatsapp (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  agendamento_id UUID REFERENCES public.agendamentos(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL, -- 'agendamento', 'vitrificacao_retorno', 'cliente_inativo', 'manual'
  destinatario_nome TEXT NOT NULL,
  destinatario_telefone TEXT NOT NULL,
  mensagem TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente', -- 'pendente', 'enviando', 'enviado', 'falha', 'cancelado'
  agendado_para TIMESTAMPTZ NOT NULL DEFAULT now(),
  enviado_em TIMESTAMPTZ,
  tentativas INTEGER NOT NULL DEFAULT 0,
  erro_mensagem TEXT,
  hash_dedup TEXT UNIQUE, -- Chave de deduplicação diária
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fila_whatsapp_tenant_status ON public.fila_mensagens_whatsapp(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_fila_whatsapp_agendado_status ON public.fila_mensagens_whatsapp(agendado_para, status);

-- RLS para fila_mensagens_whatsapp
ALTER TABLE public.fila_mensagens_whatsapp ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuários acessam fila whatsapp do seu tenant" ON public.fila_mensagens_whatsapp;
CREATE POLICY "Usuários acessam fila whatsapp do seu tenant" ON public.fila_mensagens_whatsapp
  FOR ALL
  TO authenticated
  USING (tenant_id IN (SELECT public.meus_tenants()))
  WITH CHECK (tenant_id IN (SELECT public.meus_tenants()));

GRANT ALL ON public.fila_mensagens_whatsapp TO authenticated;

-- 3. RPC: SALVAR CONFIGURAÇÃO DE WHATSAPP DO TENANT
DROP FUNCTION IF EXISTS public.salvar_config_whatsapp_tenant(JSONB);
CREATE OR REPLACE FUNCTION public.salvar_config_whatsapp_tenant(p_config JSONB)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
BEGIN
  v_tenant := (SELECT public.meus_tenants() LIMIT 1);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Nenhuma oficina associada';
  END IF;

  INSERT INTO public.tenant_config_whatsapp (
    tenant_id,
    provider,
    api_url,
    api_key,
    instance_name,
    instance_status,
    numero_conectado,
    lembrete_agendamento_ativo,
    lembrete_agendamento_horas,
    lembrete_agendamento_template,
    lembrete_vitrificacao_ativo,
    lembrete_vitrificacao_dias,
    lembrete_vitrificacao_template,
    lembrete_retorno_inativo_ativo,
    lembrete_retorno_inativo_dias,
    lembrete_retorno_inativo_template,
    horario_envio_padrao,
    updated_at
  ) VALUES (
    v_tenant,
    COALESCE(p_config->>'provider', 'evolution_api'),
    trim(COALESCE(p_config->>'api_url', '')),
    trim(COALESCE(p_config->>'api_key', '')),
    COALESCE(NULLIF(trim(p_config->>'instance_name'), ''), 'oficina_' || replace(v_tenant::text, '-', '')),
    COALESCE(p_config->>'instance_status', 'desconectado'),
    trim(COALESCE(p_config->>'numero_conectado', '')),
    COALESCE((p_config->>'lembrete_agendamento_ativo')::boolean, true),
    COALESCE((p_config->>'lembrete_agendamento_horas')::integer, 24),
    COALESCE(p_config->>'lembrete_agendamento_template', 'Olá {cliente}! Lembrete do seu agendamento amanhã às {hora} na {oficina} para o veículo {veiculo} ({servicos}). Podemos confirmar sua presença?'),
    COALESCE((p_config->>'lembrete_vitrificacao_ativo')::boolean, true),
    COALESCE((p_config->>'lembrete_vitrificacao_dias')::integer, 180),
    COALESCE(p_config->>'lembrete_vitrificacao_template', 'Olá {cliente}! Passaram-se {dias} dias desde a aplicação de {servico} no seu {veiculo}. Para manter a garantia e a proteção hidrofóbica em dia, está na hora da manutenção preventiva! Vamos agendar sua revisão?'),
    COALESCE((p_config->>'lembrete_retorno_inativo_ativo')::boolean, true),
    COALESCE((p_config->>'lembrete_retorno_inativo_dias')::integer, 60),
    COALESCE(p_config->>'lembrete_retorno_inativo_template', 'Olá {cliente}! Sentimos sua falta aqui na {oficina}. Seu {veiculo} já está precisando daquele trato especial? Responda aqui para reservarmos seu horário com prioridade!'),
    COALESCE((p_config->>'horario_envio_padrao')::time, '08:30:00'::time),
    now()
  ) ON CONFLICT (tenant_id) DO UPDATE SET
    provider = EXCLUDED.provider,
    api_url = COALESCE(NULLIF(EXCLUDED.api_url, ''), tenant_config_whatsapp.api_url),
    api_key = COALESCE(NULLIF(EXCLUDED.api_key, ''), tenant_config_whatsapp.api_key),
    instance_name = COALESCE(NULLIF(EXCLUDED.instance_name, ''), tenant_config_whatsapp.instance_name),
    instance_status = COALESCE(EXCLUDED.instance_status, tenant_config_whatsapp.instance_status),
    numero_conectado = COALESCE(NULLIF(EXCLUDED.numero_conectado, ''), tenant_config_whatsapp.numero_conectado),
    lembrete_agendamento_ativo = EXCLUDED.lembrete_agendamento_ativo,
    lembrete_agendamento_horas = EXCLUDED.lembrete_agendamento_horas,
    lembrete_agendamento_template = EXCLUDED.lembrete_agendamento_template,
    lembrete_vitrificacao_ativo = EXCLUDED.lembrete_vitrificacao_ativo,
    lembrete_vitrificacao_dias = EXCLUDED.lembrete_vitrificacao_dias,
    lembrete_vitrificacao_template = EXCLUDED.lembrete_vitrificacao_template,
    lembrete_retorno_inativo_ativo = EXCLUDED.lembrete_retorno_inativo_ativo,
    lembrete_retorno_inativo_dias = EXCLUDED.lembrete_retorno_inativo_dias,
    lembrete_retorno_inativo_template = EXCLUDED.lembrete_retorno_inativo_template,
    horario_envio_padrao = EXCLUDED.horario_envio_padrao,
    updated_at = now();

  RETURN jsonb_build_object('sucesso', true, 'mensagem', 'Configurações de WhatsApp salvas com sucesso!');
END;
$$;

GRANT EXECUTE ON FUNCTION public.salvar_config_whatsapp_tenant(JSONB) TO authenticated;

-- 4. RPC: GERAR FILA DE LEMBRETES AUTOMÁTICOS (POR TENANT)
DROP FUNCTION IF EXISTS public.gerar_fila_lembretes_whatsapp(UUID);
CREATE OR REPLACE FUNCTION public.gerar_fila_lembretes_whatsapp(p_tenant_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
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
  v_tenant := COALESCE(p_tenant_id, (SELECT public.meus_tenants() LIMIT 1));
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Tenant não identificado';
  END IF;

  SELECT nome, COALESCE(fuso_horario, 'America/Sao_Paulo')
  INTO v_oficina_nome, v_fuso
  FROM public.tenants
  WHERE id = v_tenant;

  v_oficina_nome := COALESCE(v_oficina_nome, 'Nossa Oficina');
  v_fuso := COALESCE(v_fuso, 'America/Sao_Paulo');

  -- Obter ou criar configuração padrão
  SELECT * INTO v_config FROM public.tenant_config_whatsapp WHERE tenant_id = v_tenant;
  IF v_config.tenant_id IS NULL THEN
    INSERT INTO public.tenant_config_whatsapp (tenant_id)
    VALUES (v_tenant)
    RETURNING * INTO v_config;
  END IF;

  -- ============================================================================
  -- REGRA 1: AGENDAMENTOS DO DIA SEGUINTE (Avisar 24h antes)
  -- Usa o calendário nativo da plataforma (public.agendamentos)
  -- ============================================================================
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

  -- ============================================================================
  -- REGRA 2: MANUTENÇÃO DE VITRIFICAÇÃO / COATING (180 dias / prazo da regra)
  -- ============================================================================
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
        -- Identifica serviços de vitrificação / proteção de pintura
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

  -- ============================================================================
  -- REGRA 3: CLIENTES SUMIDOS HÁ MAIS DE X DIAS (Reativação de Base)
  -- ============================================================================
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

GRANT EXECUTE ON FUNCTION public.gerar_fila_lembretes_whatsapp(UUID) TO authenticated;

-- 5. RPC GLOBAL DO ROBÔ: EXECUTA A VARREDURA PARA TODOS OS TENANTS (MULTI-TENANT)
DROP FUNCTION IF EXISTS public.cron_processar_lembretes_whatsapp_todos_tenants();
CREATE OR REPLACE FUNCTION public.cron_processar_lembretes_whatsapp_todos_tenants()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r_tenant RECORD;
  v_tenants_processados INTEGER := 0;
  v_erros INTEGER := 0;
BEGIN
  -- Percorre todos os tenants ativos da plataforma
  FOR r_tenant IN 
    SELECT t.id, t.nome 
    FROM public.tenants t
    WHERE t.ativo = true
  LOOP
    BEGIN
      PERFORM public.gerar_fila_lembretes_whatsapp(r_tenant.id);
      v_tenants_processados := v_tenants_processados + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Se falhar em um tenant isolado, não interrompe os outros 999 tenants!
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

GRANT EXECUTE ON FUNCTION public.cron_processar_lembretes_whatsapp_todos_tenants() TO authenticated;

-- 6. AGENDAMENTO NO PG_CRON: DIARIAMENTE ÀS 11:30 UTC (08:30 HORÁRIO DE BRASÍLIA)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('cron_lembretes_whatsapp_diario');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    PERFORM cron.schedule(
      'cron_lembretes_whatsapp_diario',
      '30 11 * * *', -- 11:30 UTC = 08:30 Brasília
      'SELECT public.cron_processar_lembretes_whatsapp_todos_tenants()'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

-- 7. RPC: OBTER RESUMO E FILA DE MENSAGENS WHATSAPP
DROP FUNCTION IF EXISTS public.obter_resumo_whatsapp_tenant(UUID);
CREATE OR REPLACE FUNCTION public.obter_resumo_whatsapp_tenant(p_tenant_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
  v_config RECORD;
  v_total_pendentes INTEGER := 0;
  v_total_enviados_hoje INTEGER := 0;
  v_total_falhas_hoje INTEGER := 0;
  v_ultimas_mensagens JSONB;
BEGIN
  v_tenant := COALESCE(p_tenant_id, (SELECT public.meus_tenants() LIMIT 1));
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Tenant não identificado';
  END IF;

  SELECT * INTO v_config FROM public.tenant_config_whatsapp WHERE tenant_id = v_tenant;

  -- Contagens
  SELECT count(*) INTO v_total_pendentes
  FROM public.fila_mensagens_whatsapp
  WHERE tenant_id = v_tenant AND status = 'pendente';

  SELECT count(*) INTO v_total_enviados_hoje
  FROM public.fila_mensagens_whatsapp
  WHERE tenant_id = v_tenant AND status = 'enviado' AND enviado_em::date = CURRENT_DATE;

  SELECT count(*) INTO v_total_falhas_hoje
  FROM public.fila_mensagens_whatsapp
  WHERE tenant_id = v_tenant AND status = 'falha' AND created_at::date = CURRENT_DATE;

  -- Últimas 50 mensagens
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

GRANT EXECUTE ON FUNCTION public.obter_resumo_whatsapp_tenant(UUID) TO authenticated;

-- 8. RPC: ATUALIZAR STATUS DE MENSAGEM ENVIADA
DROP FUNCTION IF EXISTS public.atualizar_status_mensagem_whatsapp(UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.atualizar_status_mensagem_whatsapp(
  p_id UUID,
  p_status TEXT,
  p_erro TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
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

GRANT EXECUTE ON FUNCTION public.atualizar_status_mensagem_whatsapp(UUID, TEXT, TEXT) TO authenticated;
