-- ==============================================================================
-- MIGRAÇÃO 0113: OPORTUNIDADES DE RETORNO (CRM DE REATIVAÇÃO) & REGRAS DO DONO
-- ==============================================================================

-- 1. TABELA DE REGRAS DE RETORNO DO TENANT (Customizáveis pelo Dono da Oficina)
CREATE TABLE IF NOT EXISTS public.regras_retorno_tenant (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  servico_id UUID NULL REFERENCES public.servicos(id) ON DELETE SET NULL,
  palavra_chave TEXT NULL,
  titulo TEXT NOT NULL,
  dias_retorno INTEGER NOT NULL DEFAULT 60,
  mensagem_whatsapp TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  ordem INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_regras_retorno_tenant ON public.regras_retorno_tenant(tenant_id, ativo);

-- Habilitar RLS
ALTER TABLE public.regras_retorno_tenant ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Membros do tenant gerenciam regras de retorno" ON public.regras_retorno_tenant;
CREATE POLICY "Membros do tenant gerenciam regras de retorno" ON public.regras_retorno_tenant
  FOR ALL TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm 
      WHERE tm.user_id = auth.uid() AND tm.status = 'ativo'
    )
    OR public.is_platform_admin()
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm 
      WHERE tm.user_id = auth.uid() AND tm.status = 'ativo'
    )
    OR public.is_platform_admin()
  );


-- 2. TABELA DE HISTÓRICO DE CONTATOS DE RETORNO
CREATE TABLE IF NOT EXISTS public.historico_contatos_retorno (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  veiculo_id UUID NULL REFERENCES public.veiculos(id) ON DELETE SET NULL,
  regra_id UUID NULL REFERENCES public.regras_retorno_tenant(id) ON DELETE SET NULL,
  observacao TEXT NULL,
  contatado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  contatado_por UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_historico_contatos_cli ON public.historico_contatos_retorno(tenant_id, cliente_id, contatado_em DESC);

-- Habilitar RLS
ALTER TABLE public.historico_contatos_retorno ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Membros do tenant gerenciam historico de contatos" ON public.historico_contatos_retorno;
CREATE POLICY "Membros do tenant gerenciam historico de contatos" ON public.historico_contatos_retorno
  FOR ALL TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm 
      WHERE tm.user_id = auth.uid() AND tm.status = 'ativo'
    )
    OR public.is_platform_admin()
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm 
      WHERE tm.user_id = auth.uid() AND tm.status = 'ativo'
    )
    OR public.is_platform_admin()
  );


-- 3. RPCS PARA GESTÃO DE REGRAS DE RETORNO

-- 3.1 Listar Regras (com criação automática dos padrões se a oficina ainda não tiver)
CREATE OR REPLACE FUNCTION public.listar_regras_retorno()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_count INTEGER;
  v_resultado JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT tm.tenant_id INTO v_tenant_id
  FROM public.tenant_members tm
  WHERE tm.user_id = auth.uid() AND tm.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    SELECT t.id INTO v_tenant_id
    FROM public.tenants t
    WHERE t.criado_por = auth.uid()
    LIMIT 1;
  END IF;

  IF v_tenant_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Se não existir nenhuma regra cadastrada, popula as 4 regras essenciais da estética
  SELECT count(*) INTO v_count
  FROM public.regras_retorno_tenant
  WHERE tenant_id = v_tenant_id;

  IF v_count = 0 THEN
    INSERT INTO public.regras_retorno_tenant (
      tenant_id, titulo, dias_retorno, palavra_chave, mensagem_whatsapp, ordem
    ) VALUES 
    (
      v_tenant_id,
      'Manutenção de Vitrificação',
      60,
      'vitrifica|ceram|coating',
      'Olá, {cliente}! Tudo bem? Passando para lembrar que já faz {dias} dias da vitrificação do seu {veiculo}. Para manter a garantia e o brilho intenso da proteção cerâmica, é hora da manutenção preventiva. Vamos agendar para essa semana?',
      1
    ),
    (
      v_tenant_id,
      'Higienização Interna & Estofados',
      90,
      'higieniz|couro|estofad|bancos',
      'Olá, {cliente}! Já se passaram {dias} dias desde a última higienização interna do seu {veiculo}. Que tal agendarmos uma nova limpeza profunda para manter o interior sempre novo e cheiroso?',
      2
    ),
    (
      v_tenant_id,
      'Proteção de Pintura (Cera / Selante)',
      45,
      'cera|selant|cristaliz',
      'Olá, {cliente}! Já completamos {dias} dias da aplicação de proteção do seu {veiculo}. Vamos renovar o brilho e a proteção hidro-repelente contra chuva ácida e sol?',
      3
    ),
    (
      v_tenant_id,
      'Revisão Geral & Lavagem Periódica',
      30,
      'lavag|geral|detalhada|ducha',
      'Olá, {cliente}! Faz cerca de {dias} dias que seu {veiculo} recebeu nossos cuidados. Gostaria de garantir um horário na agenda para dar aquele talento nesta semana?',
      4
    );
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'titulo', r.titulo,
    'servico_id', r.servico_id,
    'servico_nome', s.nome,
    'palavra_chave', r.palavra_chave,
    'dias_retorno', r.dias_retorno,
    'mensagem_whatsapp', r.mensagem_whatsapp,
    'ativo', r.ativo,
    'ordem', r.ordem,
    'created_at', r.created_at
  ) ORDER BY r.ordem ASC, r.created_at ASC), '[]'::jsonb)
  INTO v_resultado
  FROM public.regras_retorno_tenant r
  LEFT JOIN public.servicos s ON s.id = r.servico_id
  WHERE r.tenant_id = v_tenant_id;

  RETURN v_resultado;
END;
$$;

GRANT EXECUTE ON FUNCTION public.listar_regras_retorno() TO authenticated;


-- 3.2 Salvar Regra de Retorno (Criar ou Atualizar)
CREATE OR REPLACE FUNCTION public.salvar_regra_retorno(p_regra JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_id UUID;
  v_servico_id UUID;
  v_dias INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT tm.tenant_id INTO v_tenant_id
  FROM public.tenant_members tm
  WHERE tm.user_id = auth.uid() AND tm.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    SELECT t.id INTO v_tenant_id FROM public.tenants t WHERE t.criado_por = auth.uid() LIMIT 1;
  END IF;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Oficina não encontrada.';
  END IF;

  IF p_regra->>'id' IS NOT NULL AND trim(p_regra->>'id') != '' THEN
    v_id := (p_regra->>'id')::UUID;
  END IF;

  IF p_regra->>'servico_id' IS NOT NULL AND trim(p_regra->>'servico_id') != '' THEN
    v_servico_id := (p_regra->>'servico_id')::UUID;
  END IF;

  v_dias := COALESCE((p_regra->>'dias_retorno')::INTEGER, 60);
  IF v_dias < 1 THEN
    v_dias := 30;
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE public.regras_retorno_tenant
    SET
      titulo = trim(p_regra->>'titulo'),
      servico_id = v_servico_id,
      palavra_chave = trim(p_regra->>'palavra_chave'),
      dias_retorno = v_dias,
      mensagem_whatsapp = trim(p_regra->>'mensagem_whatsapp'),
      ativo = COALESCE((p_regra->>'ativo')::BOOLEAN, true),
      updated_at = now()
    WHERE id = v_id AND tenant_id = v_tenant_id;
  ELSE
    INSERT INTO public.regras_retorno_tenant (
      tenant_id,
      titulo,
      servico_id,
      palavra_chave,
      dias_retorno,
      mensagem_whatsapp,
      ativo,
      ordem
    ) VALUES (
      v_tenant_id,
      trim(p_regra->>'titulo'),
      v_servico_id,
      trim(p_regra->>'palavra_chave'),
      v_dias,
      trim(p_regra->>'mensagem_whatsapp'),
      COALESCE((p_regra->>'ativo')::BOOLEAN, true),
      0
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.salvar_regra_retorno(jsonb) TO authenticated;


-- 3.3 Excluir Regra de Retorno
CREATE OR REPLACE FUNCTION public.excluir_regra_retorno(p_regra_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT tm.tenant_id INTO v_tenant_id
  FROM public.tenant_members tm
  WHERE tm.user_id = auth.uid() AND tm.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    SELECT t.id INTO v_tenant_id FROM public.tenants t WHERE t.criado_por = auth.uid() LIMIT 1;
  END IF;

  DELETE FROM public.regras_retorno_tenant
  WHERE id = p_regra_id AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object('sucesso', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.excluir_regra_retorno(uuid) TO authenticated;


-- 4. RPC PRINCIPAL: OBTER OPORTUNIDADES DE RETORNO DO TENANT
CREATE OR REPLACE FUNCTION public.obter_oportunidades_retorno(
  p_filtro TEXT DEFAULT 'acao_necessaria' -- 'acao_necessaria', 'vencidas', 'proximas', 'todas'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_resultado JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT tm.tenant_id INTO v_tenant_id
  FROM public.tenant_members tm
  WHERE tm.user_id = auth.uid() AND tm.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    SELECT t.id INTO v_tenant_id FROM public.tenants t WHERE t.criado_por = auth.uid() LIMIT 1;
  END IF;

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('erro', 'Oficina não encontrada');
  END IF;

  -- Consulta os últimos serviços finalizados por veículo e cruza com as regras de retorno
  WITH ultimos_atendimentos AS (
    SELECT DISTINCT ON (a.cliente_id, a.veiculo_id)
      a.id AS agendamento_id,
      a.cliente_id,
      a.veiculo_id,
      a.servico_id,
      COALESCE(s.nome, 'Atendimento Geral') AS servico_nome,
      COALESCE(a.preco_estimado_total, a.preco_estimado, 0) AS valor_servico,
      COALESCE(e.finalizado_em, a.inicio, a.created_at) AS data_conclusao
    FROM public.agendamentos a
    LEFT JOIN public.execucoes e ON e.agendamento_id = a.id
    LEFT JOIN public.servicos s ON s.id = a.servico_id
    WHERE a.tenant_id = v_tenant_id
      AND (a.status = 'concluido' OR e.status = 'finalizado')
      AND a.cliente_id IS NOT NULL
      AND a.veiculo_id IS NOT NULL
    ORDER BY a.cliente_id, a.veiculo_id, COALESCE(e.finalizado_em, a.inicio, a.created_at) DESC
  ),
  oportunidades_calculadas AS (
    SELECT
      u.agendamento_id,
      u.cliente_id,
      c.nome AS cliente_nome,
      c.telefone AS cliente_telefone,
      u.veiculo_id,
      v.modelo AS veiculo_modelo,
      v.placa AS veiculo_placa,
      u.servico_id,
      u.servico_nome,
      u.valor_servico,
      u.data_conclusao::date AS data_servico,
      (CURRENT_DATE - u.data_conclusao::date) AS dias_passados,
      r.id AS regra_id,
      r.titulo AS regra_titulo,
      r.dias_retorno AS dias_retorno_configurado,
      (u.data_conclusao::date + (r.dias_retorno || ' days')::interval)::date AS data_prevista_retorno,
      r.mensagem_whatsapp AS template_mensagem,
      hc.contatado_em AS ultimo_contato_em,
      CASE 
        WHEN (CURRENT_DATE - u.data_conclusao::date) >= r.dias_retorno THEN 'vencido'
        WHEN (CURRENT_DATE - u.data_conclusao::date) >= (r.dias_retorno - 7) THEN 'proximo'
        ELSE 'em_dia'
      END AS status_retorno
    FROM ultimos_atendimentos u
    JOIN public.clientes c ON c.id = u.cliente_id AND c.ativo = true
    JOIN public.veiculos v ON v.id = u.veiculo_id AND v.ativo = true
    -- Cruza com a regra de retorno mais adequada para esse serviço
    CROSS JOIN LATERAL (
      SELECT reg.id, reg.titulo, reg.dias_retorno, reg.mensagem_whatsapp
      FROM public.regras_retorno_tenant reg
      WHERE reg.tenant_id = v_tenant_id AND reg.ativo = true
        AND (
          reg.servico_id = u.servico_id
          OR (reg.palavra_chave IS NOT NULL AND u.servico_nome ~* reg.palavra_chave)
        )
      ORDER BY (CASE WHEN reg.servico_id = u.servico_id THEN 1 ELSE 2 END) ASC, reg.ordem ASC
      LIMIT 1
    ) r
    -- Pega se já foi contatado recentemente
    LEFT JOIN LATERAL (
      SELECT contatado_em 
      FROM public.historico_contatos_retorno h
      WHERE h.tenant_id = v_tenant_id 
        AND h.cliente_id = u.cliente_id 
        AND h.veiculo_id = u.veiculo_id
      ORDER BY h.contatado_em DESC
      LIMIT 1
    ) hc ON true
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'agendamento_id', o.agendamento_id,
    'cliente_id', o.cliente_id,
    'cliente_nome', o.cliente_nome,
    'cliente_telefone', o.cliente_telefone,
    'veiculo_id', o.veiculo_id,
    'veiculo_modelo', o.veiculo_modelo,
    'veiculo_placa', o.veiculo_placa,
    'servico_id', o.servico_id,
    'servico_nome', o.servico_nome,
    'valor_servico', o.valor_servico,
    'data_servico', o.data_servico,
    'dias_passados', o.dias_passados,
    'regra_id', o.regra_id,
    'regra_titulo', o.regra_titulo,
    'dias_retorno_configurado', o.dias_retorno_configurado,
    'data_prevista_retorno', o.data_prevista_retorno,
    'status_retorno', o.status_retorno,
    'ultimo_contato_em', o.ultimo_contato_em,
    'mensagem_whatsapp_formatada', (
      replace(
        replace(
          replace(
            replace(
              o.template_mensagem,
              '{cliente}', COALESCE(split_part(o.cliente_nome, ' ', 1), 'Cliente')
            ),
            '{veiculo}', COALESCE(o.veiculo_modelo, 'Veículo')
          ),
          '{servico}', COALESCE(o.servico_nome, 'Serviço')
        ),
        '{dias}', o.dias_passados::text
      )
    )
  ) ORDER BY 
    CASE WHEN o.status_retorno = 'vencido' THEN 1 WHEN o.status_retorno = 'proximo' THEN 2 ELSE 3 END ASC,
    o.dias_passados DESC
  ), '[]'::jsonb)
  INTO v_resultado
  FROM oportunidades_calculadas o
  WHERE (
    (p_filtro = 'acao_necessaria' AND o.status_retorno IN ('vencido', 'proximo'))
    OR (p_filtro = 'vencidas' AND o.status_retorno = 'vencido')
    OR (p_filtro = 'proximas' AND o.status_retorno = 'proximo')
    OR (p_filtro = 'todas')
  );

  RETURN v_resultado;
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_oportunidades_retorno(text) TO authenticated;


-- 5. RPC PARA REGISTRAR CONTATO REALIZADO
CREATE OR REPLACE FUNCTION public.registrar_contato_retorno(
  p_cliente_id UUID,
  p_veiculo_id UUID DEFAULT NULL,
  p_regra_id UUID DEFAULT NULL,
  p_observacao TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT tm.tenant_id INTO v_tenant_id
  FROM public.tenant_members tm
  WHERE tm.user_id = auth.uid() AND tm.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    SELECT t.id INTO v_tenant_id FROM public.tenants t WHERE t.criado_por = auth.uid() LIMIT 1;
  END IF;

  INSERT INTO public.historico_contatos_retorno (
    tenant_id,
    cliente_id,
    veiculo_id,
    regra_id,
    observacao,
    contatado_por
  ) VALUES (
    v_tenant_id,
    p_cliente_id,
    p_veiculo_id,
    p_regra_id,
    p_observacao,
    auth.uid()
  );

  RETURN jsonb_build_object('sucesso', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_contato_retorno(uuid, uuid, uuid, text) TO authenticated;


-- 6. RPC DE NOTIFICAÇÃO DIÁRIA DE OPORTUNIDADES
CREATE OR REPLACE FUNCTION public.gerar_notificacoes_retorno_diarias()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_total_vencidas INTEGER := 0;
  v_total_proximas INTEGER := 0;
  v_ja_notificado BOOLEAN := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'motivo', 'Não autenticado');
  END IF;

  SELECT tm.tenant_id INTO v_tenant_id
  FROM public.tenant_members tm
  WHERE tm.user_id = auth.uid() AND tm.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    SELECT t.id INTO v_tenant_id FROM public.tenants t WHERE t.criado_por = auth.uid() LIMIT 1;
  END IF;

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'motivo', 'Oficina não encontrada');
  END IF;

  -- Checa se já gerou notificação desse tipo nas últimas 24 horas para não sobrecarregar
  SELECT EXISTS (
    SELECT 1 FROM public.notificacoes
    WHERE tenant_id = v_tenant_id
      AND tipo = 'oportunidade_retorno'
      AND created_at >= (now() - interval '24 hours')
  ) INTO v_ja_notificado;

  IF v_ja_notificado THEN
    RETURN jsonb_build_object('sucesso', true, 'notificado', false, 'motivo', 'Já notificado hoje');
  END IF;

  -- Conta oportunidades
  WITH oportunidades AS (
    SELECT jsonb_array_elements(public.obter_oportunidades_retorno('acao_necessaria')) AS item
  )
  SELECT 
    COUNT(*) FILTER (WHERE item->>'status_retorno' = 'vencido'),
    COUNT(*) FILTER (WHERE item->>'status_retorno' = 'proximo')
  INTO v_total_vencidas, v_total_proximas
  FROM oportunidades;

  IF (v_total_vencidas + v_total_proximas) > 0 THEN
    INSERT INTO public.notificacoes (
      tenant_id,
      tipo,
      titulo,
      mensagem,
      link,
      metadata
    ) VALUES (
      v_tenant_id,
      'oportunidade_retorno',
      format('Oportunidades de Retorno: %s manutenções pendentes', (v_total_vencidas + v_total_proximas)),
      format('Você tem %s manutenções vencidas e %s previstas para os próximos 7 dias. Clique para contatar via WhatsApp.', v_total_vencidas, v_total_proximas),
      '/clientes?aba=oportunidades',
      jsonb_build_object('vencidas', v_total_vencidas, 'proximas', v_total_proximas)
    );

    RETURN jsonb_build_object('sucesso', true, 'notificado', true, 'total', (v_total_vencidas + v_total_proximas));
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'notificado', false, 'total', 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.gerar_notificacoes_retorno_diarias() TO authenticated;
