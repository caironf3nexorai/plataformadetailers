-- ==============================================================================
-- MIGRAÇÃO 0067: PROGRAMA DE INDICAÇÃO, PARCEIROS E RAZÃO DE CRÉDITOS EM DIAS
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ESTRUTURA DE TABELAS (CRIADAS EM ORDEM DE DEPENDÊNCIA)
-- ------------------------------------------------------------------------------
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS codigo_indicacao TEXT UNIQUE;

-- Tabela de Parceiros Comerciais
CREATE TABLE IF NOT EXISTS public.parceiros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  email TEXT NOT NULL,
  telefone TEXT NULL,
  documento TEXT NULL,
  codigo TEXT NOT NULL UNIQUE,
  comissao_tipo TEXT NOT NULL CHECK (comissao_tipo IN ('percentual', 'valor_fixo')),
  comissao_valor NUMERIC(10,2) NOT NULL,
  recorrente BOOLEAN NOT NULL DEFAULT true,
  pix_chave TEXT NULL,
  pix_tipo TEXT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  observacoes TEXT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.parceiros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parceiros_admin_policy" ON public.parceiros;
CREATE POLICY "parceiros_admin_policy" ON public.parceiros
  FOR ALL USING (public.is_platform_admin());

-- Tabela de Vínculo Parceiro <-> Oficina
CREATE TABLE IF NOT EXISTS public.parceiro_oficinas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parceiro_id UUID NOT NULL REFERENCES public.parceiros(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.parceiro_oficinas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parceiro_oficinas_admin_policy" ON public.parceiro_oficinas;
CREATE POLICY "parceiro_oficinas_admin_policy" ON public.parceiro_oficinas
  FOR ALL USING (public.is_platform_admin());

-- Tabela de Pagamentos de Competência
CREATE TABLE IF NOT EXISTS public.pagamentos_competencia (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  competencia DATE NOT NULL,
  valor_pago_centavos INTEGER NOT NULL DEFAULT 6700,
  confirmado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  confirmado_por UUID NULL REFERENCES auth.users(id),
  UNIQUE (tenant_id, competencia)
);

ALTER TABLE public.pagamentos_competencia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pagamentos_competencia_admin_policy" ON public.pagamentos_competencia;
CREATE POLICY "pagamentos_competencia_admin_policy" ON public.pagamentos_competencia
  FOR ALL USING (public.is_platform_admin());

-- Tabela de Comissões de Parceiros
CREATE TABLE IF NOT EXISTS public.parceiro_comissoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parceiro_id UUID NOT NULL REFERENCES public.parceiros(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  competencia DATE NOT NULL,
  valor_base NUMERIC(10,2) NOT NULL,
  valor_comissao NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('prevista', 'aprovada', 'paga', 'cancelada')) DEFAULT 'prevista',
  pago_em TIMESTAMP WITH TIME ZONE NULL,
  comprovante_path TEXT NULL,
  observacao TEXT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (parceiro_id, tenant_id, competencia)
);

ALTER TABLE public.parceiro_comissoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parceiro_comissoes_admin_policy" ON public.parceiro_comissoes;
CREATE POLICY "parceiro_comissoes_admin_policy" ON public.parceiro_comissoes
  FOR ALL USING (public.is_platform_admin());

-- Tabela de Créditos em Dias
CREATE TABLE IF NOT EXISTS public.creditos_dias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  dias INTEGER NOT NULL,
  origem TEXT NOT NULL CHECK (origem IN ('indicacao', 'indicado', 'meta', 'promocional', 'suporte', 'estorno_invalidacao')),
  referencia_id UUID NULL,
  concedido_por UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  observacao TEXT NULL,
  aplicado_em TIMESTAMP WITH TIME ZONE NULL,
  aplicado_a_data DATE NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.creditos_dias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "creditos_dias_select_policy" ON public.creditos_dias;
CREATE POLICY "creditos_dias_select_policy" ON public.creditos_dias
  FOR SELECT USING (tenant_id IN (SELECT public.meus_tenants()) OR public.is_platform_admin());

-- Tabela de Indicações
CREATE TABLE IF NOT EXISTS public.indicacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  indicador_tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  indicado_tenant_id UUID NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('convertida', 'invalidada')) DEFAULT 'convertida',
  motivo_invalidacao TEXT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  convertida_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.indicacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "indicacoes_select_policy" ON public.indicacoes;
CREATE POLICY "indicacoes_select_policy" ON public.indicacoes
  FOR SELECT USING (indicador_tenant_id IN (SELECT public.meus_tenants()) OR indicado_tenant_id IN (SELECT public.meus_tenants()) OR public.is_platform_admin());

-- Tabela Quadro de Metas Concedidas
CREATE TABLE IF NOT EXISTS public.quadro_metas_concedidas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  faixa INTEGER NOT NULL,
  dias_concedidos INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (tenant_id, faixa)
);

ALTER TABLE public.quadro_metas_concedidas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quadro_metas_select_policy" ON public.quadro_metas_concedidas;
CREATE POLICY "quadro_metas_select_policy" ON public.quadro_metas_concedidas
  FOR SELECT USING (tenant_id IN (SELECT public.meus_tenants()) OR public.is_platform_admin());

-- ------------------------------------------------------------------------------
-- 2. GERADOR DE CÓDIGO E BACKFILL
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gerar_codigo_indicacao_unico()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  res TEXT;
  i INT;
  tentativas INT := 0;
  existe BOOLEAN;
BEGIN
  LOOP
    res := '';
    FOR i IN 1..6 LOOP
      res := res || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;
    
    SELECT EXISTS (SELECT 1 FROM public.tenants WHERE codigo_indicacao = res) INTO existe;
    IF NOT existe AND to_regclass('public.parceiros') IS NOT NULL THEN
      SELECT EXISTS (SELECT 1 FROM public.parceiros WHERE codigo = res) INTO existe;
    END IF;
    
    IF NOT existe OR tentativas > 20 THEN
      RETURN res;
    END IF;
    tentativas := tentativas + 1;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Backfill para tenants sem código de indicação
UPDATE public.tenants 
SET codigo_indicacao = public.gerar_codigo_indicacao_unico() 
WHERE codigo_indicacao IS NULL;

-- ------------------------------------------------------------------------------
-- 3. BUCKET PRIVADO DE COMPROVANTES DE PARCEIRO
-- ------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('comprovantes_parceiros', 'comprovantes_parceiros', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Admin Comprovantes Storage Policy" ON storage.objects;
CREATE POLICY "Admin Comprovantes Storage Policy" ON storage.objects
  FOR ALL USING (bucket_id = 'comprovantes_parceiros' AND public.is_platform_admin());

-- ------------------------------------------------------------------------------
-- 7. RPC OBTENÇÃO DA DATA REAL DE ACESSO (SECURITY DEFINER COM CHECAGEM DE TENANT)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.obter_data_acesso_real(p_tenant_id UUID DEFAULT NULL)
RETURNS DATE
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_data_base DATE;
BEGIN
  IF p_tenant_id IS NOT NULL THEN
    IF NOT (p_tenant_id IN (SELECT public.meus_tenants())) AND NOT public.is_platform_admin() THEN
      RAISE EXCEPTION 'Acesso negado';
    END IF;
    v_tenant_id := p_tenant_id;
  ELSE
    v_tenant_id := (SELECT public.meus_tenants() LIMIT 1);
  END IF;

  IF v_tenant_id IS NULL THEN
    RETURN (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  END IF;

  SELECT COALESCE(trial_fim, proximo_vencimento, created_at::date)
  INTO v_data_base
  FROM public.assinaturas
  WHERE tenant_id = v_tenant_id;

  IF v_data_base IS NULL THEN
    SELECT created_at::date INTO v_data_base FROM public.tenants WHERE id = v_tenant_id;
  END IF;

  RETURN COALESCE(v_data_base, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
END;
$$;

-- ------------------------------------------------------------------------------
-- 8. RPC CRIAR OFICINA ATÔMICA COM PROCESSAMENTO DE INDICAÇÃO OU PARCEIRO
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.criar_oficina(text, text, text, text);
DROP FUNCTION IF EXISTS public.criar_oficina(text, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.criar_oficina(
  p_nome text,
  p_cidade text,
  p_uf text,
  p_telefone text,
  p_codigo_indicacao text DEFAULT NULL,
  p_codigo_parceiro text DEFAULT NULL,
  p_documento text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE 
  v_tenant uuid; 
  v_slug text;
  v_trial_fim date;
  v_codigo_proprio text;
  v_parceiro RECORD;
  v_indicador RECORD;
  v_indicado_email text;
  v_indicador_email text;
  v_indicador_tel text;
  v_indicador_doc text;
  v_mes_inicio date;
  v_conversoes_mes int;
  v_total_conversoes int;
  v_agora timestamp with time zone := now();
  v_nova_data_indicado date;
  v_indicador_data_base date;
  v_nova_data_indicador date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF coalesce(trim(p_nome), '') = '' THEN
    RAISE EXCEPTION 'Informe o nome da oficina.';
  END IF;

  IF (
    SELECT count(*) FROM tenant_members
    WHERE user_id = auth.uid() AND role = 'dono' AND status IN ('ativo', 'convidado')
  ) >= 3 THEN
    RAISE EXCEPTION 'Limite de oficinas por usuário atingido.';
  END IF;

  v_slug := lower(regexp_replace(p_nome, '[^a-zA-Z0-9]+', '-', 'g'))
            || '-' || substr(gen_random_uuid()::text, 1, 6);

  v_trial_fim := (now() AT TIME ZONE 'America/Sao_Paulo')::date + 14;
  v_codigo_proprio := public.gerar_codigo_indicacao_unico();

  -- 1. Criar Tenant
  INSERT INTO tenants (nome, slug, cidade, uf, telefone, documento, criado_por, plano, codigo_indicacao)
    VALUES (p_nome, v_slug, p_cidade, p_uf, p_telefone, p_documento, auth.uid(), 'pro', v_codigo_proprio)
    RETURNING id INTO v_tenant;

  -- 2. Criar Membro Dono
  INSERT INTO tenant_members (tenant_id, user_id, email, role, status)
    VALUES (
      v_tenant, 
      auth.uid(),
      (SELECT email FROM auth.users WHERE id = auth.uid()),
      'dono', 
      'ativo'
    );

  -- 3. Registrar Assinatura Inicial (Pro Trial 14d)
  INSERT INTO public.assinaturas (
    tenant_id, plano, status, valor_centavos, trial_fim
  ) VALUES (
    v_tenant, 'pro', 'trial', 6700, v_trial_fim
  ) ON CONFLICT (tenant_id) DO NOTHING;

  -- 4. Processar Código de PARCEIRO (Precedência Absoluta)
  IF p_codigo_parceiro IS NOT NULL AND trim(p_codigo_parceiro) != '' THEN
    SELECT * INTO v_parceiro FROM public.parceiros 
    WHERE codigo = upper(trim(p_codigo_parceiro)) AND ativo = true;

    IF FOUND THEN
      INSERT INTO public.parceiro_oficinas (parceiro_id, tenant_id)
      VALUES (v_parceiro.id, v_tenant)
      ON CONFLICT (tenant_id) DO NOTHING;

      -- Parceiro possui precedência absoluta; encerra o processamento
      RETURN v_tenant;
    END IF;
  END IF;

  -- 5. Processar Código de INDICAÇÃO (Caso parceiro não tenha sido aplicado)
  IF p_codigo_indicacao IS NOT NULL AND trim(p_codigo_indicacao) != '' THEN
    SELECT * INTO v_indicador FROM public.tenants 
    WHERE codigo_indicacao = upper(trim(p_codigo_indicacao));

    IF FOUND AND v_indicador.id != v_tenant THEN
      -- Trava Anti-Fraude: Verificar e-mail, telefone e documento
      SELECT email INTO v_indicado_email FROM auth.users WHERE id = auth.uid();
      
      SELECT u.email, t.telefone, t.documento INTO v_indicador_email, v_indicador_tel, v_indicador_doc
      FROM public.tenants t
      JOIN public.tenant_members tm ON tm.tenant_id = t.id AND tm.role = 'dono'
      JOIN auth.users u ON u.id = tm.user_id
      WHERE t.id = v_indicador.id LIMIT 1;

      IF lower(trim(coalesce(v_indicado_email,''))) = lower(trim(coalesce(v_indicador_email,'')))
         OR (length(trim(coalesce(p_telefone,''))) > 5 AND trim(p_telefone) = trim(coalesce(v_indicador_tel,'')))
         OR (length(trim(coalesce(p_documento,''))) > 5 AND trim(p_documento) = trim(coalesce(v_indicador_doc,''))) THEN
        -- Auto-indicação detectada! Recusa concessão de bônus
        RETURN v_tenant;
      END IF;

      -- Trava de Teto Mensal: Máximo de 10 conversões por mês por oficina indicadora
      v_mes_inicio := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
      SELECT count(*) INTO v_conversoes_mes
      FROM public.indicacoes
      WHERE indicador_tenant_id = v_indicador.id
        AND convertida_em >= v_mes_inicio
        AND status = 'convertida';

      IF v_conversoes_mes >= 10 THEN
        INSERT INTO public.indicacoes (indicador_tenant_id, indicado_tenant_id, codigo, status)
        VALUES (v_indicador.id, v_tenant, upper(trim(p_codigo_indicacao)), 'convertida');
        RETURN v_tenant;
      END IF;

      -- Registrar Indicação Convertida
      INSERT INTO public.indicacoes (indicador_tenant_id, indicado_tenant_id, codigo, status)
      VALUES (v_indicador.id, v_tenant, upper(trim(p_codigo_indicacao)), 'convertida');

      -- Conceder +15 dias ao INDICADO (Nova Oficina)
      v_nova_data_indicado := v_trial_fim + 15;
      UPDATE public.assinaturas SET trial_fim = v_nova_data_indicado WHERE tenant_id = v_tenant;
      INSERT INTO public.creditos_dias (tenant_id, dias, origem, referencia_id, concedido_por, observacao, aplicado_em, aplicado_a_data)
      VALUES (v_tenant, 15, 'indicado', v_indicador.id, auth.uid(), 'Bônus de 15 dias por cadastro via indicação', v_agora, v_nova_data_indicado);

      -- Conceder +15 dias ao INDICADOR
      SELECT COALESCE(trial_fim, proximo_vencimento, (now() AT TIME ZONE 'America/Sao_Paulo')::date)
      INTO v_indicador_data_base
      FROM public.assinaturas WHERE tenant_id = v_indicador.id;

      v_nova_data_indicador := v_indicador_data_base + 15;
      UPDATE public.assinaturas
      SET trial_fim = (CASE WHEN trial_fim IS NOT NULL THEN v_nova_data_indicador ELSE NULL END),
          proximo_vencimento = (CASE WHEN proximo_vencimento IS NOT NULL THEN v_nova_data_indicador ELSE NULL END)
      WHERE tenant_id = v_indicador.id;

      INSERT INTO public.creditos_dias (tenant_id, dias, origem, referencia_id, concedido_por, observacao, aplicado_em, aplicado_a_data)
      VALUES (v_indicador.id, 15, 'indicacao', v_tenant, auth.uid(), 'Bônus de 15 dias por indicar uma nova oficina', v_agora, v_nova_data_indicador);

      -- Verificar Régua do Quadro de Metas do Indicador (5 -> +30d, 10 -> +60d, 15 -> +90d)
      SELECT count(*) INTO v_total_conversoes
      FROM public.indicacoes
      WHERE indicador_tenant_id = v_indicador.id AND status = 'convertida';

      -- Faixa 5 indicações
      IF v_total_conversoes >= 5 AND NOT EXISTS (SELECT 1 FROM public.quadro_metas_concedidas WHERE tenant_id = v_indicador.id AND faixa = 5) THEN
        INSERT INTO public.quadro_metas_concedidas (tenant_id, faixa, dias_concedidos) VALUES (v_indicador.id, 5, 30);
        v_nova_data_indicador := v_nova_data_indicador + 30;
        UPDATE public.assinaturas
        SET trial_fim = (CASE WHEN trial_fim IS NOT NULL THEN v_nova_data_indicador ELSE NULL END),
            proximo_vencimento = (CASE WHEN proximo_vencimento IS NOT NULL THEN v_nova_data_indicador ELSE NULL END)
        WHERE tenant_id = v_indicador.id;

        INSERT INTO public.creditos_dias (tenant_id, dias, origem, referencia_id, concedido_por, observacao, aplicado_em, aplicado_a_data)
        VALUES (v_indicador.id, 30, 'meta', v_tenant, auth.uid(), 'Bônus de Meta: 5 indicações convertidas (+30 dias)', v_agora, v_nova_data_indicador);
      END IF;

      -- Faixa 10 indicações
      IF v_total_conversoes >= 10 AND NOT EXISTS (SELECT 1 FROM public.quadro_metas_concedidas WHERE tenant_id = v_indicador.id AND faixa = 10) THEN
        INSERT INTO public.quadro_metas_concedidas (tenant_id, faixa, dias_concedidos) VALUES (v_indicador.id, 10, 60);
        v_nova_data_indicador := v_nova_data_indicador + 60;
        UPDATE public.assinaturas
        SET trial_fim = (CASE WHEN trial_fim IS NOT NULL THEN v_nova_data_indicador ELSE NULL END),
            proximo_vencimento = (CASE WHEN proximo_vencimento IS NOT NULL THEN v_nova_data_indicador ELSE NULL END)
        WHERE tenant_id = v_indicador.id;

        INSERT INTO public.creditos_dias (tenant_id, dias, origem, referencia_id, concedido_por, observacao, aplicado_em, aplicado_a_data)
        VALUES (v_indicador.id, 60, 'meta', v_tenant, auth.uid(), 'Bônus de Meta: 10 indicações convertidas (+60 dias)', v_agora, v_nova_data_indicador);
      END IF;

      -- Faixa 15 indicações
      IF v_total_conversoes >= 15 AND NOT EXISTS (SELECT 1 FROM public.quadro_metas_concedidas WHERE tenant_id = v_indicador.id AND faixa = 15) THEN
        INSERT INTO public.quadro_metas_concedidas (tenant_id, faixa, dias_concedidos) VALUES (v_indicador.id, 15, 90);
        v_nova_data_indicador := v_nova_data_indicador + 90;
        UPDATE public.assinaturas
        SET trial_fim = (CASE WHEN trial_fim IS NOT NULL THEN v_nova_data_indicador ELSE NULL END),
            proximo_vencimento = (CASE WHEN proximo_vencimento IS NOT NULL THEN v_nova_data_indicador ELSE NULL END)
        WHERE tenant_id = v_indicador.id;

        INSERT INTO public.creditos_dias (tenant_id, dias, origem, referencia_id, concedido_por, observacao, aplicado_em, aplicado_a_data)
        VALUES (v_indicador.id, 90, 'meta', v_tenant, auth.uid(), 'Bônus de Meta: 15 indicações convertidas (+90 dias)', v_agora, v_nova_data_indicador);
      END IF;

    END IF;
  END IF;

  RETURN v_tenant;
END;
$$;

-- ------------------------------------------------------------------------------
-- 9. RPC ADMIN INVALIDAR INDICAÇÃO (ESTORNO DUPLO E TRATAMENTO NO PASSADO)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_invalidar_indicacao(
  p_indicacao_id UUID,
  p_motivo TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ind RECORD;
  v_agora TIMESTAMP WITH TIME ZONE := NOW();
  v_hoje DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_data_base DATE;
  v_nova_data DATE;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Apenas administradores da plataforma podem invalidar indicações';
  END IF;

  IF p_motivo IS NULL OR length(trim(p_motivo)) = 0 THEN
    RAISE EXCEPTION 'O motivo da invalidação é obrigatório para auditoria';
  END IF;

  SELECT * INTO v_ind FROM public.indicacoes WHERE id = p_indicacao_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Indicação não encontrada';
  END IF;

  IF v_ind.status = 'invalidada' THEN
    RAISE EXCEPTION 'Esta indicação já foi invalidada anteriormente';
  END IF;

  -- 1. Marcar como invalidada
  UPDATE public.indicacoes
  SET status = 'invalidada', motivo_invalidacao = trim(p_motivo)
  WHERE id = p_indicacao_id;

  -- 2. Estorno no Indicador (-15 dias)
  INSERT INTO public.creditos_dias (tenant_id, dias, origem, referencia_id, observacao, concedido_por)
  VALUES (v_ind.indicador_tenant_id, -15, 'estorno_invalidacao', p_indicacao_id, 'Estorno por invalidação: ' || trim(p_motivo), auth.uid());

  SELECT COALESCE(trial_fim, proximo_vencimento, v_hoje) INTO v_data_base 
  FROM public.assinaturas WHERE tenant_id = v_ind.indicador_tenant_id;

  v_nova_data := v_data_base - INTERVAL '15 days';

  IF v_nova_data < v_hoje THEN
    v_nova_data := v_hoje - INTERVAL '1 day';
    UPDATE public.assinaturas SET status = 'cancelada', proximo_vencimento = v_nova_data WHERE tenant_id = v_ind.indicador_tenant_id;
    UPDATE public.tenants SET plano = 'free' WHERE id = v_ind.indicador_tenant_id;
  ELSE
    UPDATE public.assinaturas 
    SET trial_fim = (CASE WHEN trial_fim IS NOT NULL THEN v_nova_data ELSE NULL END), 
        proximo_vencimento = (CASE WHEN proximo_vencimento IS NOT NULL THEN v_nova_data ELSE NULL END) 
    WHERE tenant_id = v_ind.indicador_tenant_id;
  END IF;

  UPDATE public.creditos_dias SET aplicado_em = v_agora, aplicado_a_data = v_nova_data 
  WHERE tenant_id = v_ind.indicador_tenant_id AND aplicado_em IS NULL;

  -- 3. Estorno no Indicado (-15 dias)
  INSERT INTO public.creditos_dias (tenant_id, dias, origem, referencia_id, observacao, concedido_por)
  VALUES (v_ind.indicado_tenant_id, -15, 'estorno_invalidacao', p_indicacao_id, 'Estorno por invalidação: ' || trim(p_motivo), auth.uid());

  SELECT COALESCE(trial_fim, proximo_vencimento, v_hoje) INTO v_data_base 
  FROM public.assinaturas WHERE tenant_id = v_ind.indicado_tenant_id;

  v_nova_data := v_data_base - INTERVAL '15 days';

  IF v_nova_data < v_hoje THEN
    v_nova_data := v_hoje - INTERVAL '1 day';
    UPDATE public.assinaturas SET status = 'cancelada', proximo_vencimento = v_nova_data WHERE tenant_id = v_ind.indicado_tenant_id;
    UPDATE public.tenants SET plano = 'free' WHERE id = v_ind.indicado_tenant_id;
  ELSE
    UPDATE public.assinaturas 
    SET trial_fim = (CASE WHEN trial_fim IS NOT NULL THEN v_nova_data ELSE NULL END), 
        proximo_vencimento = (CASE WHEN proximo_vencimento IS NOT NULL THEN v_nova_data ELSE NULL END) 
    WHERE tenant_id = v_ind.indicado_tenant_id;
  END IF;

  UPDATE public.creditos_dias SET aplicado_em = v_agora, aplicado_a_data = v_nova_data 
  WHERE tenant_id = v_ind.indicado_tenant_id AND aplicado_em IS NULL;

  -- Auditoria
  INSERT INTO public.admin_auditoria (admin_user_id, acao, tabela_afetada, registro_id, detalhes)
  VALUES (
    auth.uid(), 
    'INVALIDAR_INDICAÇÃO', 
    'indicacoes', 
    p_indicacao_id, 
    jsonb_build_object('motivo', p_motivo, 'indicador', v_ind.indicador_tenant_id, 'indicado', v_ind.indicado_tenant_id)
  );

  RETURN jsonb_build_object('sucesso', true);
END;
$$;

-- ------------------------------------------------------------------------------
-- 10. RPCs DE PARCEIRO & APURAÇÃO MENSAL DE COMISSÕES
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_registrar_pagamento_manual_competencia(
  p_tenant_id UUID,
  p_competencia DATE,
  p_valor_pago_centavos INTEGER DEFAULT 6700
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  INSERT INTO public.pagamentos_competencia (tenant_id, competencia, valor_pago_centavos, confirmado_por)
  VALUES (p_tenant_id, date_trunc('month', p_competencia)::date, p_valor_pago_centavos, auth.uid())
  ON CONFLICT (tenant_id, competencia) 
  DO UPDATE SET valor_pago_centavos = EXCLUDED.valor_pago_centavos, confirmado_em = NOW(), confirmado_por = auth.uid();

  RETURN jsonb_build_object('sucesso', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_gerar_comissoes_mensais(p_competencia DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_comp DATE := date_trunc('month', p_competencia)::date;
  v_rec RECORD;
  v_valor_base NUMERIC(10,2);
  v_valor_comissao NUMERIC(10,2);
  v_count INTEGER := 0;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  FOR v_rec IN 
    SELECT po.parceiro_id, po.tenant_id, p.comissao_tipo, p.comissao_valor, p.recorrente, pc.valor_pago_centavos, po.created_at as vinculado_em
    FROM public.parceiro_oficinas po
    JOIN public.parceiros p ON p.id = po.parceiro_id
    JOIN public.pagamentos_competencia pc ON pc.tenant_id = po.tenant_id AND pc.competencia = v_comp
    WHERE p.ativo = true
  LOOP
    -- Se recorrente = false, gera apenas na primeira competência do vínculo
    IF NOT v_rec.recorrente AND date_trunc('month', v_rec.vinculado_em)::date != v_comp THEN
      CONTINUE;
    END IF;

    v_valor_base := (v_rec.valor_pago_centavos / 100.0);

    IF v_rec.comissao_tipo = 'percentual' THEN
      v_valor_comissao := round(v_valor_base * (v_rec.comissao_valor / 100.0), 2);
    ELSE
      v_valor_comissao := v_rec.comissao_valor;
    END IF;

    INSERT INTO public.parceiro_comissoes (
      parceiro_id, tenant_id, competencia, valor_base, valor_comissao, status
    ) VALUES (
      v_rec.parceiro_id, v_rec.tenant_id, v_comp, v_valor_base, v_valor_comissao, 'prevista'
    ) ON CONFLICT (parceiro_id, tenant_id, competencia) DO NOTHING;

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('sucesso', true, 'comissoes_geradas', v_count);
END;
$$;
