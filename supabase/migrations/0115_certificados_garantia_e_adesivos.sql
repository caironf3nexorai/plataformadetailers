-- ==============================================================================
-- MIGRAÇÃO 0115: CERTIFICADOS DIGITAIS DE GARANTIA & ADESIVOS COM QR CODE
-- ==============================================================================

-- 1. TABELA PRINCIPAL DE CERTIFICADOS DE GARANTIA
CREATE TABLE IF NOT EXISTS public.certificados_garantia (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT UNIQUE NOT NULL,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  agendamento_id UUID NULL REFERENCES public.agendamentos(id) ON DELETE SET NULL,
  cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  veiculo_id UUID NOT NULL REFERENCES public.veiculos(id) ON DELETE CASCADE,
  servico_id UUID NULL REFERENCES public.servicos(id) ON DELETE SET NULL,
  servico_nome TEXT NOT NULL,
  produto_aplicado TEXT NULL,
  garantia_meses INTEGER NOT NULL DEFAULT 12,
  intervalo_manutencao_dias INTEGER NOT NULL DEFAULT 60,
  data_aplicacao DATE NOT NULL DEFAULT CURRENT_DATE,
  data_vencimento DATE NOT NULL,
  observacoes TEXT NULL,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'manutencao_pendente', 'expirado', 'cancelado')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_certificados_codigo ON public.certificados_garantia(codigo);
CREATE INDEX IF NOT EXISTS idx_certificados_tenant ON public.certificados_garantia(tenant_id, cliente_id, veiculo_id);
CREATE INDEX IF NOT EXISTS idx_certificados_agendamento ON public.certificados_garantia(agendamento_id);

-- Habilitar RLS
ALTER TABLE public.certificados_garantia ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS para certificados_garantia
DROP POLICY IF EXISTS "Membros do tenant gerenciam certificados" ON public.certificados_garantia;
CREATE POLICY "Membros do tenant gerenciam certificados" ON public.certificados_garantia
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

-- Leitura pública para que qualquer cliente consulte seu certificado via URL / QR Code
DROP POLICY IF EXISTS "Leitura pública de certificados por código" ON public.certificados_garantia;
CREATE POLICY "Leitura pública de certificados por código" ON public.certificados_garantia
  FOR SELECT TO anon, authenticated
  USING (true);


-- 2. TABELA DE HISTÓRICO DE MANUTENÇÕES / REVISÕES PERIÓDICAS DO CERTIFICADO
CREATE TABLE IF NOT EXISTS public.certificado_manutencoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certificado_id UUID NOT NULL REFERENCES public.certificados_garantia(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  numero_revisao INTEGER NOT NULL DEFAULT 1,
  data_realizada DATE NOT NULL DEFAULT CURRENT_DATE,
  observacao TEXT NULL,
  agendamento_id UUID NULL REFERENCES public.agendamentos(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cert_manutencoes ON public.certificado_manutencoes(certificado_id, data_realizada DESC);

-- Habilitar RLS
ALTER TABLE public.certificado_manutencoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Membros do tenant gerenciam manutencoes de certificados" ON public.certificado_manutencoes;
CREATE POLICY "Membros do tenant gerenciam manutencoes de certificados" ON public.certificado_manutencoes
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

DROP POLICY IF EXISTS "Leitura pública de manutenções de certificados" ON public.certificado_manutencoes;
CREATE POLICY "Leitura pública de manutenções de certificados" ON public.certificado_manutencoes
  FOR SELECT TO anon, authenticated
  USING (true);


-- 3. RPCS PARA EMISSÃO E CONSULTA PÚBLICA DE CERTIFICADOS

-- 3.1 Emitir Certificado de Garantia
CREATE OR REPLACE FUNCTION public.emitir_certificado_garantia(p_dados JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_cliente_id UUID;
  v_veiculo_id UUID;
  v_agendamento_id UUID;
  v_servico_id UUID;
  v_servico_nome TEXT;
  v_produto_aplicado TEXT;
  v_meses INTEGER;
  v_intervalo_dias INTEGER;
  v_data_aplicacao DATE;
  v_data_vencimento DATE;
  v_observacoes TEXT;
  v_codigo TEXT;
  v_id UUID;
  v_tentativa INTEGER := 0;
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
    RAISE EXCEPTION 'Oficina não identificada.';
  END IF;

  v_cliente_id := (p_dados->>'cliente_id')::UUID;
  v_veiculo_id := (p_dados->>'veiculo_id')::UUID;
  
  IF p_dados->>'agendamento_id' IS NOT NULL AND trim(p_dados->>'agendamento_id') != '' THEN
    v_agendamento_id := (p_dados->>'agendamento_id')::UUID;
  END IF;

  IF p_dados->>'servico_id' IS NOT NULL AND trim(p_dados->>'servico_id') != '' THEN
    v_servico_id := (p_dados->>'servico_id')::UUID;
  END IF;

  v_servico_nome := COALESCE(trim(p_dados->>'servico_nome'), 'Proteção de Pintura');
  v_produto_aplicado := trim(p_dados->>'produto_aplicado');
  v_meses := COALESCE((p_dados->>'garantia_meses')::INTEGER, 12);
  v_intervalo_dias := COALESCE((p_dados->>'intervalo_manutencao_dias')::INTEGER, 60);
  
  IF p_dados->>'data_aplicacao' IS NOT NULL AND trim(p_dados->>'data_aplicacao') != '' THEN
    v_data_aplicacao := (p_dados->>'data_aplicacao')::DATE;
  ELSE
    v_data_aplicacao := CURRENT_DATE;
  END IF;

  v_data_vencimento := v_data_aplicacao + (v_meses || ' months')::interval;
  v_observacoes := trim(p_dados->>'observacoes');

  -- Gerar código amigável único com prefixo GAR- (ex: GAR-7X9B21)
  LOOP
    v_tentativa := v_tentativa + 1;
    v_codigo := 'GAR-' || upper(substr(md5(random()::text || clock_timestamp()::text || v_tentativa::text), 1, 6));
    
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.certificados_garantia WHERE codigo = v_codigo);
    IF v_tentativa > 15 THEN
      v_codigo := 'GAR-' || upper(substr(gen_random_uuid()::text, 1, 8));
      EXIT;
    END IF;
  END LOOP;

  INSERT INTO public.certificados_garantia (
    codigo,
    tenant_id,
    agendamento_id,
    cliente_id,
    veiculo_id,
    servico_id,
    servico_nome,
    produto_aplicado,
    garantia_meses,
    intervalo_manutencao_dias,
    data_aplicacao,
    data_vencimento,
    observacoes,
    status
  ) VALUES (
    v_codigo,
    v_tenant_id,
    v_agendamento_id,
    v_cliente_id,
    v_veiculo_id,
    v_servico_id,
    v_servico_nome,
    v_produto_aplicado,
    v_meses,
    v_intervalo_dias,
    v_data_aplicacao,
    v_data_vencimento,
    v_observacoes,
    'ativo'
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'sucesso', true,
    'id', v_id,
    'codigo', v_codigo,
    'data_vencimento', v_data_vencimento
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.emitir_certificado_garantia(jsonb) TO authenticated;


-- 3.2 Obter Certificado Público (Acessível por qualquer pessoa pelo Código/QR Code)
CREATE OR REPLACE FUNCTION public.obter_certificado_publico(p_codigo TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cert RECORD;
  v_oficina RECORD;
  v_cliente RECORD;
  v_veiculo RECORD;
  v_manutencoes JSONB;
  v_dias_restantes INTEGER;
  v_dias_totais INTEGER;
  v_dias_passados INTEGER;
  v_pct_decorrido NUMERIC;
  v_status_calculado TEXT;
  v_proxima_revisao_data DATE;
  v_proxima_revisao_dias INTEGER;
  v_ultima_revisao_data DATE;
  v_qtd_revisoes INTEGER;
BEGIN
  IF p_codigo IS NULL OR trim(p_codigo) = '' THEN
    RETURN jsonb_build_object('encontrado', false, 'motivo', 'Código não informado');
  END IF;

  -- Busca o certificado
  SELECT c.*
  INTO v_cert
  FROM public.certificados_garantia c
  WHERE upper(trim(c.codigo)) = upper(trim(p_codigo))
  LIMIT 1;

  IF v_cert.id IS NULL THEN
    RETURN jsonb_build_object('encontrado', false, 'motivo', 'Certificado não encontrado');
  END IF;

  -- Busca os dados públicos da oficina
  SELECT 
    t.id,
    t.nome,
    t.slug,
    t.logo_path,
    t.capa_path,
    t.telefone,
    t.cidade,
    t.uf AS estado
  INTO v_oficina
  FROM public.tenants t
  WHERE t.id = v_cert.tenant_id;

  -- Busca o cliente (primeiro nome para privacidade)
  SELECT 
    c.id,
    c.nome,
    c.telefone
  INTO v_cliente
  FROM public.clientes c
  WHERE c.id = v_cert.cliente_id;

  -- Busca o veículo
  SELECT 
    v.id,
    v.marca,
    v.modelo,
    v.placa,
    v.cor,
    v.ano
  INTO v_veiculo
  FROM public.veiculos v
  WHERE v.id = v_cert.veiculo_id;

  -- Busca as manutenções realizadas
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'numero_revisao', m.numero_revisao,
    'data_realizada', m.data_realizada,
    'observacao', m.observacao
  ) ORDER BY m.numero_revisao ASC), '[]'::jsonb),
  count(m.id),
  max(m.data_realizada)
  INTO v_manutencoes, v_qtd_revisoes, v_ultima_revisao_data
  FROM public.certificado_manutencoes m
  WHERE m.certificado_id = v_cert.id;

  -- Cálculos de tempo e status
  v_dias_totais := (v_cert.data_vencimento - v_cert.data_aplicacao);
  v_dias_passados := (CURRENT_DATE - v_cert.data_aplicacao);
  v_dias_restantes := (v_cert.data_vencimento - CURRENT_DATE);

  IF v_dias_totais > 0 THEN
    v_pct_decorrido := round((v_dias_passados::numeric / v_dias_totais::numeric) * 100, 1);
    IF v_pct_decorrido > 100 THEN v_pct_decorrido := 100; END IF;
    IF v_pct_decorrido < 0 THEN v_pct_decorrido := 0; END IF;
  ELSE
    v_pct_decorrido := 0;
  END IF;

  -- Cálculo da próxima revisão periódica
  IF v_ultima_revisao_data IS NOT NULL THEN
    v_proxima_revisao_data := v_ultima_revisao_data + (v_cert.intervalo_manutencao_dias || ' days')::interval;
  ELSE
    v_proxima_revisao_data := v_cert.data_aplicacao + (v_cert.intervalo_manutencao_dias || ' days')::interval;
  END IF;

  v_proxima_revisao_dias := (v_proxima_revisao_data - CURRENT_DATE);

  -- Status dinâmico
  IF CURRENT_DATE > v_cert.data_vencimento THEN
    v_status_calculado := 'expirado';
  ELSIF v_proxima_revisao_dias < 0 THEN
    v_status_calculado := 'manutencao_pendente';
  ELSE
    v_status_calculado := v_cert.status;
  END IF;

  RETURN jsonb_build_object(
    'encontrado', true,
    'certificado', jsonb_build_object(
      'id', v_cert.id,
      'codigo', v_cert.codigo,
      'servico_nome', v_cert.servico_nome,
      'produto_aplicado', v_cert.produto_aplicado,
      'garantia_meses', v_cert.garantia_meses,
      'intervalo_manutencao_dias', v_cert.intervalo_manutencao_dias,
      'data_aplicacao', v_cert.data_aplicacao,
      'data_vencimento', v_cert.data_vencimento,
      'observacoes', v_cert.observacoes,
      'status', v_status_calculado,
      'dias_restantes', v_dias_restantes,
      'dias_passados', v_dias_passados,
      'percentual_decorrido', v_pct_decorrido,
      'proxima_revisao_data', v_proxima_revisao_data,
      'proxima_revisao_dias', v_proxima_revisao_dias,
      'total_revisoes_feitas', v_qtd_revisoes
    ),
    'oficina', jsonb_build_object(
      'id', v_oficina.id,
      'nome', v_oficina.nome,
      'slug', v_oficina.slug,
      'logo_path', v_oficina.logo_path,
      'capa_path', v_oficina.capa_path,
      'telefone', v_oficina.telefone,
      'cidade', v_oficina.cidade,
      'estado', v_oficina.estado
    ),
    'cliente', jsonb_build_object(
      'nome', COALESCE(split_part(v_cliente.nome, ' ', 1) || ' ' || substr(split_part(v_cliente.nome, ' ', 2), 1, 1) || '.', v_cliente.nome),
      'telefone', CASE WHEN v_cliente.telefone IS NOT NULL AND length(v_cliente.telefone) >= 8 
                  THEN substr(v_cliente.telefone, 1, 4) || '****-' || substr(v_cliente.telefone, length(v_cliente.telefone) - 3)
                  ELSE 'Não informado' END
    ),
    'veiculo', jsonb_build_object(
      'marca', v_veiculo.marca,
      'modelo', v_veiculo.modelo,
      'placa', v_veiculo.placa,
      'cor', v_veiculo.cor,
      'ano', v_veiculo.ano
    ),
    'manutencoes', v_manutencoes
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_certificado_publico(text) TO anon, authenticated;


-- 3.3 Registrar Manutenção / Revisão Periódica em um Certificado
CREATE OR REPLACE FUNCTION public.registrar_manutencao_certificado(
  p_certificado_id UUID,
  p_observacao TEXT DEFAULT NULL,
  p_agendamento_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_prox_numero INTEGER;
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

  IF NOT EXISTS (SELECT 1 FROM public.certificados_garantia WHERE id = p_certificado_id AND tenant_id = v_tenant_id) THEN
    RAISE EXCEPTION 'Certificado não encontrado ou não pertence a esta oficina.';
  END IF;

  SELECT COALESCE(max(numero_revisao), 0) + 1 INTO v_prox_numero
  FROM public.certificado_manutencoes
  WHERE certificado_id = p_certificado_id;

  INSERT INTO public.certificado_manutencoes (
    certificado_id,
    tenant_id,
    numero_revisao,
    data_realizada,
    observacao,
    agendamento_id
  ) VALUES (
    p_certificado_id,
    v_tenant_id,
    v_prox_numero,
    CURRENT_DATE,
    p_observacao,
    p_agendamento_id
  );

  UPDATE public.certificados_garantia
  SET status = 'ativo', updated_at = now()
  WHERE id = p_certificado_id;

  RETURN jsonb_build_object('sucesso', true, 'numero_revisao', v_prox_numero);
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_manutencao_certificado(uuid, text, uuid) TO authenticated;
