-- ==============================================================================
-- MIGRAÇÃO 0123: CAMPANHA LANÇAMENTO 15 DIAS, TRAVA ACADEMIA TRIAL E MÓDULO NFS-E
-- ==============================================================================

-- 1. CAMPANHA OFICIAL DE 15 DIAS (LANCAMENTO15)
INSERT INTO public.campanhas_lancamento (
  codigo, nome, plano, dias_trial, limite_usos, valido_ate, ativo, titulo_destaque, descricao, beneficios
) VALUES (
  'LANCAMENTO15',
  'Lançamento Oficial 15 Dias Pro',
  'pro',
  15,
  NULL, -- Ilimitado para o lançamento
  now() + interval '45 days',
  true,
  'Acesso Exclusivo de Lançamento: 15 Dias Grátis no Plano Pro',
  'Parabéns por fazer parte da turma oficial de lançamento do NuvemWash! Você ganhou 15 dias de degustação completa no Plano Pro para elevar o nível da sua estética automotiva.',
  ARRAY[
    '15 dias de degustação livre sem compromisso',
    'Acesso a todas as ferramentas operacionais do Plano Pro',
    'Vistorias digitais com fotos, assinatura na tela e PDF',
    'Agendamento online personalizado e gestão completa de clientes',
    'DRE Financeiro completo, cálculo de custos e comissões'
  ]
) ON CONFLICT (codigo) DO UPDATE SET
  nome = EXCLUDED.nome,
  plano = EXCLUDED.plano,
  dias_trial = EXCLUDED.dias_trial,
  ativo = true,
  valido_ate = EXCLUDED.valido_ate,
  titulo_destaque = EXCLUDED.titulo_destaque,
  descricao = EXCLUDED.descricao,
  beneficios = EXCLUDED.beneficios;

-- 2. CADASTRO DA FEATURE DE CONTROLE DA ACADEMIA NO TRIAL
INSERT INTO public.catalogo_features (chave, nome, descricao, grupo, ordem)
VALUES (
  'academia_trial_liberada',
  'Liberar Academia no Trial',
  'Quando desativado, a Academia do Detailer e cursos em vídeo ficam bloqueados para contas em período de testes, liberando apenas após ativação/pagamento do plano.',
  'Capacitação & Treinamento',
  28
) ON CONFLICT (chave) DO UPDATE SET
  nome = EXCLUDED.nome,
  descricao = EXCLUDED.descricao,
  grupo = EXCLUDED.grupo,
  ordem = EXCLUDED.ordem;

-- Por padrão, no período de degustação (trial), a academia fica bloqueada até o pagamento
INSERT INTO public.plan_features (plano, feature, habilitado) VALUES
  ('free', 'academia_trial_liberada', false),
  ('pro', 'academia_trial_liberada', false),
  ('studio', 'academia_trial_liberada', false)
ON CONFLICT (plano, feature) DO UPDATE SET
  habilitado = EXCLUDED.habilitado;

-- 3. TABELA DE CONFIGURAÇÃO FISCAL DO TENANT
CREATE TABLE IF NOT EXISTS public.tenant_config_fiscal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  cnpj TEXT,
  razao_social TEXT,
  nome_fantasia TEXT,
  inscricao_municipal TEXT,
  codigo_tributario_municipio TEXT,
  cnae TEXT,
  aliquota_iss NUMERIC(5,2) DEFAULT 2.00,
  regime_tributario TEXT DEFAULT 'simples_nacional',
  ambiente TEXT DEFAULT 'homologacao', -- 'homologacao' ou 'producao'
  token_focus_nfe TEXT,
  proximo_rps INTEGER DEFAULT 1,
  serie_rps TEXT DEFAULT '1',
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uk_tenant_config_fiscal_tenant UNIQUE (tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_config_fiscal_tenant ON public.tenant_config_fiscal(tenant_id);

ALTER TABLE public.tenant_config_fiscal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Membros gerenciam config fiscal de seu tenant" ON public.tenant_config_fiscal;
CREATE POLICY "Membros gerenciam config fiscal de seu tenant" ON public.tenant_config_fiscal
  FOR ALL
  TO authenticated
  USING (tenant_id IN (SELECT public.meus_tenants()))
  WITH CHECK (tenant_id IN (SELECT public.meus_tenants()));

DROP POLICY IF EXISTS "Admins da plataforma gerenciam config fiscal" ON public.tenant_config_fiscal;
CREATE POLICY "Admins da plataforma gerenciam config fiscal" ON public.tenant_config_fiscal
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

GRANT ALL ON public.tenant_config_fiscal TO authenticated;

-- 4. TABELA DE NOTAS FISCAIS EMITIDAS
CREATE TABLE IF NOT EXISTS public.notas_fiscais (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  execucao_id UUID REFERENCES public.execucoes(id) ON DELETE SET NULL,
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  numero_nfse TEXT,
  serie_rps TEXT,
  numero_rps INTEGER,
  valor_centavos INTEGER NOT NULL,
  discriminacao_servico TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'autorizada', -- 'pendente', 'autorizada', 'cancelada', 'erro'
  codigo_verificacao TEXT,
  link_pdf TEXT,
  link_xml TEXT,
  mensagem_retorno TEXT,
  emitido_por UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notas_fiscais_tenant ON public.notas_fiscais(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notas_fiscais_execucao ON public.notas_fiscais(execucao_id);
CREATE INDEX IF NOT EXISTS idx_notas_fiscais_created_at ON public.notas_fiscais(created_at);

ALTER TABLE public.notas_fiscais ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Membros acessam notas fiscais de seu tenant" ON public.notas_fiscais;
CREATE POLICY "Membros acessam notas fiscais de seu tenant" ON public.notas_fiscais
  FOR ALL
  TO authenticated
  USING (tenant_id IN (SELECT public.meus_tenants()))
  WITH CHECK (tenant_id IN (SELECT public.meus_tenants()));

DROP POLICY IF EXISTS "Admins acessam todas as notas fiscais" ON public.notas_fiscais;
CREATE POLICY "Admins acessam todas as notas fiscais" ON public.notas_fiscais
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

GRANT ALL ON public.notas_fiscais TO authenticated;

-- 5. RPC: OBTER RESUMO FISCAL E CONSUMO DE COTAS NFS-E
CREATE OR REPLACE FUNCTION public.obter_resumo_nfse_tenant(p_tenant_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
  v_plano TEXT;
  v_limite INTEGER;
  v_total_mes INTEGER;
  v_config RECORD;
  v_inicio_mes TIMESTAMPTZ;
BEGIN
  v_tenant := COALESCE(p_tenant_id, (SELECT public.meus_tenants() LIMIT 1));
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Tenant não identificado';
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
    AND status IN ('autorizada', 'processando', 'pendente')
    AND created_at >= v_inicio_mes;

  v_total_mes := COALESCE(v_total_mes, 0);

  -- 5. Dados da configuração fiscal
  SELECT * INTO v_config FROM public.tenant_config_fiscal WHERE tenant_id = v_tenant;

  RETURN jsonb_build_object(
    'tenant_id', v_tenant,
    'plano', v_plano,
    'limite_mes', v_limite,
    'total_emitidas_mes', v_total_mes,
    'saldo_restante', GREATEST(0, v_limite - v_total_mes),
    'atingiu_limite', (v_limite > 0 AND v_total_mes >= v_limite),
    'pode_emitir', (v_limite > 0 AND v_total_mes < v_limite),
    'config_preenchida', (v_config.cnpj IS NOT NULL AND v_config.cnpj != ''),
    'config', CASE WHEN v_config.id IS NOT NULL THEN row_to_json(v_config)::jsonb ELSE NULL END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_resumo_nfse_tenant(UUID) TO authenticated;

-- 6. RPC: SALVAR CONFIGURAÇÃO FISCAL DO TENANT
CREATE OR REPLACE FUNCTION public.salvar_config_fiscal_tenant(
  p_cnpj TEXT,
  p_razao_social TEXT,
  p_nome_fantasia TEXT DEFAULT NULL,
  p_inscricao_municipal TEXT DEFAULT NULL,
  p_codigo_tributario_municipio TEXT DEFAULT NULL,
  p_cnae TEXT DEFAULT NULL,
  p_aliquota_iss NUMERIC DEFAULT 2.00,
  p_regime_tributario TEXT DEFAULT 'simples_nacional',
  p_ambiente TEXT DEFAULT 'homologacao',
  p_token_focus_nfe TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
  v_clean_cnpj TEXT;
BEGIN
  v_tenant := (SELECT public.meus_tenants() LIMIT 1);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Nenhuma oficina associada';
  END IF;

  v_clean_cnpj := regexp_replace(p_cnpj, '[^0-9]', '', 'g');
  IF length(v_clean_cnpj) != 14 THEN
    RAISE EXCEPTION 'CNPJ inválido. Deve conter 14 dígitos.';
  END IF;

  INSERT INTO public.tenant_config_fiscal (
    tenant_id, cnpj, razao_social, nome_fantasia, inscricao_municipal,
    codigo_tributario_municipio, cnae, aliquota_iss, regime_tributario,
    ambiente, token_focus_nfe, updated_at
  ) VALUES (
    v_tenant, v_clean_cnpj, trim(p_razao_social), trim(p_nome_fantasia), trim(p_inscricao_municipal),
    trim(p_codigo_tributario_municipio), trim(p_cnae), COALESCE(p_aliquota_iss, 2.00),
    COALESCE(p_regime_tributario, 'simples_nacional'), COALESCE(p_ambiente, 'homologacao'),
    trim(p_token_focus_nfe), now()
  ) ON CONFLICT (tenant_id) DO UPDATE SET
    cnpj = EXCLUDED.cnpj,
    razao_social = EXCLUDED.razao_social,
    nome_fantasia = EXCLUDED.nome_fantasia,
    inscricao_municipal = EXCLUDED.inscricao_municipal,
    codigo_tributario_municipio = EXCLUDED.codigo_tributario_municipio,
    cnae = EXCLUDED.cnae,
    aliquota_iss = EXCLUDED.aliquota_iss,
    regime_tributario = EXCLUDED.regime_tributario,
    ambiente = EXCLUDED.ambiente,
    token_focus_nfe = COALESCE(EXCLUDED.token_focus_nfe, tenant_config_fiscal.token_focus_nfe),
    updated_at = now();

  RETURN jsonb_build_object('sucesso', true, 'mensagem', 'Configuração fiscal salva com sucesso!');
END;
$$;

GRANT EXECUTE ON FUNCTION public.salvar_config_fiscal_tenant(text, text, text, text, text, text, numeric, text, text, text) TO authenticated;

-- 7. RPC: REGISTRAR EMISSÃO DE NFS-E COM CONTROLE DE LIMITE DO PLANO
CREATE OR REPLACE FUNCTION public.registrar_emissao_nfse(
  p_execucao_id UUID,
  p_cliente_id UUID,
  p_valor_centavos INTEGER,
  p_discriminacao TEXT,
  p_numero_nfse TEXT DEFAULT NULL,
  p_codigo_verificacao TEXT DEFAULT NULL,
  p_link_pdf TEXT DEFAULT NULL,
  p_link_xml TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
  v_resumo JSONB;
  v_id UUID;
  v_rps_num INTEGER;
  v_rps_serie TEXT;
BEGIN
  v_tenant := (SELECT public.meus_tenants() LIMIT 1);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Nenhuma oficina associada';
  END IF;

  -- 1. Validar cota mensal do plano
  v_resumo := public.obter_resumo_nfse_tenant(v_tenant);
  IF (v_resumo->>'atingiu_limite')::boolean = true THEN
    RAISE EXCEPTION 'Limite mensal de notas fiscais do plano atingido (% de %). Faça upgrade do plano para continuar emitindo.',
      v_resumo->>'total_emitidas_mes', v_resumo->>'limite_mes';
  END IF;

  IF (v_resumo->>'limite_mes')::integer <= 0 THEN
    RAISE EXCEPTION 'O plano atual não possui cota para emissão de notas fiscais. Faça upgrade para o Plano Pro ou Studio.';
  END IF;

  -- 2. Incrementar número de RPS
  UPDATE public.tenant_config_fiscal
  SET proximo_rps = COALESCE(proximo_rps, 1) + 1,
      updated_at = now()
  WHERE tenant_id = v_tenant
  RETURNING (proximo_rps - 1), COALESCE(serie_rps, '1') INTO v_rps_num, v_rps_serie;

  -- 3. Inserir registro de NFS-e
  INSERT INTO public.notas_fiscais (
    tenant_id, execucao_id, cliente_id, numero_nfse, serie_rps, numero_rps,
    valor_centavos, discriminacao_servico, status, codigo_verificacao,
    link_pdf, link_xml, emitido_por, created_at
  ) VALUES (
    v_tenant, p_execucao_id, p_cliente_id, 
    COALESCE(p_numero_nfse, 'NFS-' || LPAD(COALESCE(v_rps_num, 1)::text, 6, '0')),
    v_rps_serie, v_rps_num, p_valor_centavos, trim(p_discriminacao),
    'autorizada', p_codigo_verificacao, p_link_pdf, p_link_xml,
    auth.uid(), now()
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'sucesso', true,
    'id', v_id,
    'numero_nfse', COALESCE(p_numero_nfse, 'NFS-' || LPAD(COALESCE(v_rps_num, 1)::text, 6, '0')),
    'mensagem', 'NFS-e registrada e autorizada com sucesso!'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_emissao_nfse(uuid, uuid, integer, text, text, text, text, text) TO authenticated;

-- 8. ATUALIZAÇÃO DA RPC ATUALIZAR_REFERENCIAS_COMUNIDADE COM RETORNO FORMATADO
CREATE OR REPLACE FUNCTION public.atualizar_referencias_comunidade()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_mod RECORD;
  v_cat TEXT;
  v_categorias TEXT[] := ARRAY['Hatch', 'Sedan', 'SUV', 'Caminhonete', 'Moto'];
  v_n_oficinas INTEGER;
  v_p25 NUMERIC;
  v_p75 NUMERIC;
  v_total_atualizados INTEGER := 0;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores da plataforma podem acionar este cálculo.';
  END IF;

  FOR v_mod IN SELECT codigo FROM public.servicos_modelo LOOP
    FOREACH v_cat IN ARRAY v_categorias LOOP
      SELECT count(DISTINCT sp.tenant_id),
             round(percentile_cont(0.25) WITHIN GROUP (ORDER BY sp.preco_base))::numeric(10,2),
             round(percentile_cont(0.75) WITHIN GROUP (ORDER BY sp.preco_base))::numeric(10,2)
      INTO v_n_oficinas, v_p25, v_p75
      FROM public.servico_precos sp
      JOIN public.servicos s ON s.id = sp.servico_id AND s.tenant_id = sp.tenant_id
      JOIN public.categorias_veiculo cv ON cv.id = sp.categoria_id AND cv.tenant_id = sp.tenant_id
      WHERE s.codigo = v_mod.codigo
        AND public.categoria_padrao_nome(cv.nome) = v_cat
        AND sp.preco_base IS NOT NULL
        AND sp.preco_base > 0
        AND s.ativo = true
        AND cv.ativo = true;

      -- Atualiza referência se houver pelo menos 1 oficina (ou 5 para consolidação comunitária)
      IF v_n_oficinas >= 1 AND v_p25 IS NOT NULL AND v_p75 IS NOT NULL AND v_p75 >= v_p25 THEN
        INSERT INTO public.servico_modelo_referencia (
          servico_modelo_codigo, categoria_nome, porte_cidade, preco_min, preco_max, fonte, amostra, atualizado_em
        ) VALUES (
          v_mod.codigo, v_cat, 'nacional', v_p25, v_p75, 'comunidade', v_n_oficinas, now()
        )
        ON CONFLICT (servico_modelo_codigo, categoria_nome, porte_cidade) DO UPDATE
        SET preco_min = EXCLUDED.preco_min,
            preco_max = EXCLUDED.preco_max,
            fonte = 'comunidade',
            amostra = EXCLUDED.amostra,
            atualizado_em = now();

        v_total_atualizados := v_total_atualizados + 1;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'sucesso', true,
    'total_atualizados', v_total_atualizados,
    'mensagem', 'Referências comunitárias recalculadas com sucesso!',
    'atualizado_em', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.atualizar_referencias_comunidade() TO authenticated;
