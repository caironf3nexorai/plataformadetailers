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
-- (Tabela correta: public.feature_catalogo)
INSERT INTO public.feature_catalogo (chave, nome, descricao, grupo, ordem)
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

-- 3. COTAS MENSAIS DE NFS-E POR PLANO EM PLAN_LIMITS
INSERT INTO public.plan_limits (plano, recurso, limite) VALUES
  ('free', 'notas_fiscais_mes', 0),
  ('pro', 'notas_fiscais_mes', 30),
  ('studio', 'notas_fiscais_mes', 150)
ON CONFLICT (plano, recurso) DO UPDATE SET
  limite = EXCLUDED.limite;

-- 4. TABELA DE CONFIGURAÇÃO FISCAL DO TENANT
CREATE TABLE IF NOT EXISTS public.tenant_config_fiscal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  cnpj TEXT,
  razao_social TEXT,
  nome_fantasia TEXT,
  inscricao_municipal TEXT,
  codigo_tributario_municipio TEXT,
  cnae TEXT,
  cnae_padrao TEXT,
  item_lista_servico TEXT,
  aliquota_iss NUMERIC(5,2) DEFAULT 2.00,
  regime_tributario TEXT DEFAULT '1', -- '1'=Simples Nacional, '4'=MEI, etc.
  ambiente TEXT DEFAULT 'homologacao', -- 'homologacao' ou 'producao'
  token_focus_nfe TEXT,
  proximo_rps INTEGER DEFAULT 1,
  serie_rps TEXT DEFAULT '1',
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uk_tenant_config_fiscal_tenant UNIQUE (tenant_id)
);

-- Garantir que colunas adicionais existam caso a tabela já tenha sido criada
ALTER TABLE public.tenant_config_fiscal ADD COLUMN IF NOT EXISTS cnae_padrao TEXT;
ALTER TABLE public.tenant_config_fiscal ADD COLUMN IF NOT EXISTS item_lista_servico TEXT;

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

-- 5. TABELA DE NOTAS FISCAIS EMITIDAS
CREATE TABLE IF NOT EXISTS public.notas_fiscais (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  atendimento_id UUID REFERENCES public.agendamentos(id) ON DELETE SET NULL,
  execucao_id UUID REFERENCES public.execucoes(id) ON DELETE SET NULL,
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  numero TEXT,
  numero_nfse TEXT,
  serie TEXT DEFAULT '1',
  serie_rps TEXT DEFAULT '1',
  numero_rps INTEGER,
  valor_total NUMERIC(10,2) DEFAULT 0,
  valor_centavos INTEGER DEFAULT 0,
  tomador_nome TEXT,
  tomador_cpf_cnpj TEXT,
  tomador_email TEXT,
  tomador_telefone TEXT,
  discriminacao TEXT,
  discriminacao_servico TEXT,
  status TEXT NOT NULL DEFAULT 'emitida', -- 'emitida', 'processando', 'cancelada', 'erro'
  codigo_verificacao TEXT,
  url_danfe TEXT,
  url_xml TEXT,
  link_pdf TEXT,
  link_xml TEXT,
  motivo_cancelamento TEXT,
  emitido_por UUID REFERENCES auth.users(id),
  emitido_em TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Garantir colunas adicionais para retrocompatibilidade
ALTER TABLE public.notas_fiscais ADD COLUMN IF NOT EXISTS atendimento_id UUID REFERENCES public.agendamentos(id) ON DELETE SET NULL;
ALTER TABLE public.notas_fiscais ADD COLUMN IF NOT EXISTS numero TEXT;
ALTER TABLE public.notas_fiscais ADD COLUMN IF NOT EXISTS serie TEXT DEFAULT '1';
ALTER TABLE public.notas_fiscais ADD COLUMN IF NOT EXISTS valor_total NUMERIC(10,2) DEFAULT 0;
ALTER TABLE public.notas_fiscais ADD COLUMN IF NOT EXISTS tomador_nome TEXT;
ALTER TABLE public.notas_fiscais ADD COLUMN IF NOT EXISTS tomador_cpf_cnpj TEXT;
ALTER TABLE public.notas_fiscais ADD COLUMN IF NOT EXISTS tomador_email TEXT;
ALTER TABLE public.notas_fiscais ADD COLUMN IF NOT EXISTS tomador_telefone TEXT;
ALTER TABLE public.notas_fiscais ADD COLUMN IF NOT EXISTS discriminacao TEXT;
ALTER TABLE public.notas_fiscais ADD COLUMN IF NOT EXISTS url_danfe TEXT;
ALTER TABLE public.notas_fiscais ADD COLUMN IF NOT EXISTS url_xml TEXT;
ALTER TABLE public.notas_fiscais ADD COLUMN IF NOT EXISTS motivo_cancelamento TEXT;
ALTER TABLE public.notas_fiscais ADD COLUMN IF NOT EXISTS emitido_em TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_notas_fiscais_tenant ON public.notas_fiscais(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notas_fiscais_atendimento ON public.notas_fiscais(atendimento_id);
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

-- 6. RPC: OBTER RESUMO FISCAL E CONSUMO DE COTAS NFS-E
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
    AND status IN ('autorizada', 'emitida', 'processando', 'pendente')
    AND created_at >= v_inicio_mes;

  v_total_mes := COALESCE(v_total_mes, 0);

  -- 5. Dados da configuração fiscal
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
    'config', CASE WHEN v_config.id IS NOT NULL THEN row_to_json(v_config)::jsonb ELSE NULL END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_resumo_nfse_tenant(UUID) TO authenticated;

-- 7. RPC: SALVAR CONFIGURAÇÃO FISCAL DO TENANT (SUPORTA JSONB OU PARÂMETROS POSICIONAIS)
CREATE OR REPLACE FUNCTION public.salvar_config_fiscal_tenant(p_config JSONB)
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

  v_clean_cnpj := regexp_replace(COALESCE(p_config->>'cnpj', ''), '[^0-9]', '', 'g');
  IF length(v_clean_cnpj) != 14 THEN
    RAISE EXCEPTION 'CNPJ inválido. Deve conter 14 dígitos.';
  END IF;

  INSERT INTO public.tenant_config_fiscal (
    tenant_id, cnpj, razao_social, nome_fantasia, inscricao_municipal,
    cnae, cnae_padrao, item_lista_servico, aliquota_iss, regime_tributario,
    ambiente, token_focus_nfe, updated_at
  ) VALUES (
    v_tenant,
    v_clean_cnpj,
    trim(COALESCE(p_config->>'razao_social', '')),
    trim(COALESCE(p_config->>'nome_fantasia', p_config->>'razao_social', '')),
    trim(COALESCE(p_config->>'inscricao_municipal', '')),
    trim(COALESCE(p_config->>'cnae_padrao', p_config->>'cnae', '4520-0/05')),
    trim(COALESCE(p_config->>'cnae_padrao', p_config->>'cnae', '4520-0/05')),
    trim(COALESCE(p_config->>'item_lista_servico', '14.01')),
    COALESCE((p_config->>'aliquota_iss')::numeric, 2.00),
    COALESCE(p_config->>'regime_tributario', '1'),
    COALESCE(p_config->>'ambiente', 'homologacao'),
    trim(COALESCE(p_config->>'token_focus_nfe', '')),
    now()
  ) ON CONFLICT (tenant_id) DO UPDATE SET
    cnpj = EXCLUDED.cnpj,
    razao_social = EXCLUDED.razao_social,
    nome_fantasia = EXCLUDED.nome_fantasia,
    inscricao_municipal = EXCLUDED.inscricao_municipal,
    cnae = EXCLUDED.cnae,
    cnae_padrao = EXCLUDED.cnae_padrao,
    item_lista_servico = EXCLUDED.item_lista_servico,
    aliquota_iss = EXCLUDED.aliquota_iss,
    regime_tributario = EXCLUDED.regime_tributario,
    ambiente = EXCLUDED.ambiente,
    token_focus_nfe = COALESCE(NULLIF(EXCLUDED.token_focus_nfe, ''), tenant_config_fiscal.token_focus_nfe),
    updated_at = now();

  RETURN jsonb_build_object('sucesso', true, 'mensagem', 'Configuração fiscal salva com sucesso!');
END;
$$;

GRANT EXECUTE ON FUNCTION public.salvar_config_fiscal_tenant(JSONB) TO authenticated;

-- 8. RPC: REGISTRAR EMISSÃO DE NFS-E COM CONTROLE DE LIMITE DO PLANO
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
  v_tenant := (SELECT public.meus_tenants() LIMIT 1);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Nenhuma oficina associada';
  END IF;

  -- 1. Validar cota mensal do plano
  v_resumo := public.obter_resumo_nfse_tenant(v_tenant);
  IF (v_resumo->>'atingiu_limite')::boolean = true THEN
    RAISE EXCEPTION 'Limite mensal de notas fiscais do plano atingido (% de %). Faça upgrade do plano para continuar emitindo.',
      v_resumo->>'emitidas_mes', v_resumo->>'limite_mensal';
  END IF;

  IF (v_resumo->>'limite_mensal')::integer <= 0 THEN
    RAISE EXCEPTION 'O plano atual não possui cota para emissão de notas fiscais. Faça upgrade para o Plano Pro ou Studio.';
  END IF;

  -- Extrair parâmetros do json
  v_atendimento_id := (p_dados->>'atendimento_id')::uuid;
  v_valor_num := COALESCE((p_dados->>'valor_total')::numeric, (p_dados->>'valor_centavos')::numeric / 100.0, 0);
  v_valor_centavos := round(v_valor_num * 100)::integer;
  v_tomador_nome := trim(COALESCE(p_dados->>'tomador_nome', 'Cliente'));
  v_tomador_doc := trim(COALESCE(p_dados->>'tomador_cpf_cnpj', ''));
  v_tomador_email := trim(COALESCE(p_dados->>'tomador_email', ''));
  v_tomador_tel := trim(COALESCE(p_dados->>'tomador_telefone', ''));
  v_discriminacao := trim(COALESCE(p_dados->>'discriminacao', p_dados->>'discriminacao_servico', 'Serviços de estética automotiva'));

  -- 2. Incrementar número de RPS
  UPDATE public.tenant_config_fiscal
  SET proximo_rps = COALESCE(proximo_rps, 1) + 1,
      updated_at = now()
  WHERE tenant_id = v_tenant
  RETURNING (proximo_rps - 1), COALESCE(serie_rps, '1') INTO v_rps_num, v_rps_serie;

  v_numero := LPAD(COALESCE(v_rps_num, 1)::text, 6, '0');

  -- 3. Inserir registro de NFS-e
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

GRANT EXECUTE ON FUNCTION public.registrar_emissao_nfse(JSONB) TO authenticated;

-- 9. ATUALIZAÇÃO DA RPC ATUALIZAR_REFERENCIAS_COMUNIDADE COM RETORNO FORMATADO
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
      JOIN public.servicos s ON s.id = sp.servico_id
      JOIN public.categorias_veiculo cv ON cv.id = sp.categoria_id
      WHERE s.codigo_modelo = v_mod.codigo
        AND cv.nome = v_cat
        AND sp.ativo = true
        AND sp.preco_base > 0;

      IF v_n_oficinas >= 3 AND v_p25 IS NOT NULL AND v_p75 IS NOT NULL THEN
        INSERT INTO public.servico_modelo_referencia (
          servico_modelo_codigo, categoria_nome, porte_cidade,
          preco_min, preco_max, fonte, amostra, atualizado_em
        ) VALUES (
          v_mod.codigo, v_cat, 'nacional',
          v_p25, v_p75, 'comunidade', v_n_oficinas, now()
        )
        ON CONFLICT (servico_modelo_codigo, categoria_nome, porte_cidade)
        DO UPDATE SET
          preco_min = EXCLUDED.preco_min,
          preco_max = EXCLUDED.preco_max,
          fonte = 'comunidade',
          amostra = EXCLUDED.amostra,
          atualizado_em = now();

        v_total_atualizados := v_total_atualizados + 1;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'sucesso',
    'sucesso', true,
    'registros_atualizados', v_total_atualizados,
    'total_atualizados', v_total_atualizados,
    'mensagem', 'Referências comunitárias recalculadas com sucesso!',
    'atualizado_em', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.atualizar_referencias_comunidade() TO authenticated;
