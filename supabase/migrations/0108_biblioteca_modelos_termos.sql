-- ==============================================================================
-- MIGRAÇÃO 0108: BIBLIOTECA DE MODELOS DE TERMOS JURÍDICOS (ADMIN & TENANTS)
-- ==============================================================================

-- 1. BUCKET DE ARMAZENAMENTO PARA ARQUIVOS WORD (.DOCX) E PDF
INSERT INTO storage.buckets (id, name, public)
VALUES ('modelos-termos', 'modelos-termos', true)
ON CONFLICT (id) DO NOTHING;

-- Políticas do Storage para o Bucket modelos-termos
DROP POLICY IF EXISTS "Modelos termos download publico autenticado" ON storage.objects;
CREATE POLICY "Modelos termos download publico autenticado" ON storage.objects
  FOR SELECT USING (bucket_id = 'modelos-termos');

DROP POLICY IF EXISTS "Platform admin insere modelos termos" ON storage.objects;
CREATE POLICY "Platform admin insere modelos termos" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'modelos-termos' 
    AND public.is_platform_admin()
  );

DROP POLICY IF EXISTS "Platform admin atualiza modelos termos" ON storage.objects;
CREATE POLICY "Platform admin atualiza modelos termos" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'modelos-termos' 
    AND public.is_platform_admin()
  );

DROP POLICY IF EXISTS "Platform admin deleta modelos termos" ON storage.objects;
CREATE POLICY "Platform admin deleta modelos termos" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'modelos-termos' 
    AND public.is_platform_admin()
  );

-- 2. TABELA DE MODELOS DE TERMOS DA PLATAFORMA
CREATE TABLE IF NOT EXISTS public.plataforma_modelos_termos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo TEXT NOT NULL,
  categoria TEXT NOT NULL CHECK (categoria IN ('responsabilidade', 'garantia')),
  tipo_servico TEXT NULL, -- Para termos de garantia: 'polimento', 'vitrificacao', 'lavagem_motor', 'higienizacao', 'insulfilm', 'microreparo', 'geral'
  descricao TEXT NULL,
  conteudo_texto TEXT NOT NULL,
  arquivo_url TEXT NULL,
  arquivo_nome TEXT NULL,
  arquivo_tipo TEXT NULL, -- 'docx', 'pdf'
  arquivo_tamanho_bytes BIGINT NULL,
  destaque BOOLEAN NOT NULL DEFAULT false,
  ativo BOOLEAN NOT NULL DEFAULT true,
  downloads_count INTEGER NOT NULL DEFAULT 0,
  aplicacoes_count INTEGER NOT NULL DEFAULT 0,
  criado_por UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_modelos_termos_categoria ON public.plataforma_modelos_termos(categoria, ativo);
CREATE INDEX IF NOT EXISTS idx_modelos_termos_destaque ON public.plataforma_modelos_termos(destaque, created_at DESC);

-- 3. RLS
ALTER TABLE public.plataforma_modelos_termos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admin gerencia modelos termos" ON public.plataforma_modelos_termos;
CREATE POLICY "Platform admin gerencia modelos termos" ON public.plataforma_modelos_termos
  FOR ALL USING (public.is_platform_admin());

DROP POLICY IF EXISTS "Tenants podem visualizar modelos de termos ativos" ON public.plataforma_modelos_termos;
CREATE POLICY "Tenants podem visualizar modelos de termos ativos" ON public.plataforma_modelos_termos
  FOR SELECT USING (ativo = true);

-- 4. RPCS PARA TENANTS E ADMIN

-- 4.1 Listar Modelos de Termos para as Oficinas
DROP FUNCTION IF EXISTS public.listar_modelos_termos(text);
CREATE OR REPLACE FUNCTION public.listar_modelos_termos(
  p_categoria TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res JSONB;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'titulo', m.titulo,
    'categoria', m.categoria,
    'tipo_servico', m.tipo_servico,
    'descricao', m.descricao,
    'conteudo_texto', m.conteudo_texto,
    'arquivo_url', m.arquivo_url,
    'arquivo_nome', m.arquivo_nome,
    'arquivo_tipo', m.arquivo_tipo,
    'arquivo_tamanho_bytes', m.arquivo_tamanho_bytes,
    'destaque', m.destaque,
    'downloads_count', m.downloads_count,
    'aplicacoes_count', m.aplicacoes_count,
    'created_at', m.created_at
  ) ORDER BY m.destaque DESC, m.created_at DESC), '[]'::jsonb)
  INTO v_res
  FROM public.plataforma_modelos_termos m
  WHERE m.ativo = true
    AND (p_categoria IS NULL OR m.categoria = p_categoria);

  RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.listar_modelos_termos(text) TO authenticated, anon;

-- 4.2 Aplicar Modelo de Termo na Oficina Atual (1-Clique)
DROP FUNCTION IF EXISTS public.aplicar_modelo_termo_tenant(uuid);
CREATE OR REPLACE FUNCTION public.aplicar_modelo_termo_tenant(
  p_modelo_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_modelo RECORD;
  v_novo_termo_id UUID;
BEGIN
  v_tenant_id := (SELECT public.meus_tenants() LIMIT 1);
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'mensagem', 'Oficina não identificada.');
  END IF;

  SELECT * INTO v_modelo
  FROM public.plataforma_modelos_termos
  WHERE id = p_modelo_id AND ativo = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'mensagem', 'Modelo de termo não encontrado.');
  END IF;

  IF v_modelo.categoria = 'responsabilidade' THEN
    -- Atualiza o termo fixo geral de responsabilidade da oficina
    UPDATE public.tenants
    SET termo_responsabilidade = v_modelo.conteudo_texto, updated_at = now()
    WHERE id = v_tenant_id;
  ELSE
    -- Cria um novo registro de termo de garantia para o tenant
    INSERT INTO public.termos_garantia (
      tenant_id,
      tipo,
      titulo,
      conteudo,
      padrao,
      ativo
    ) VALUES (
      v_tenant_id,
      COALESCE(v_modelo.tipo_servico, 'geral'),
      v_modelo.titulo,
      v_modelo.conteudo_texto,
      false,
      true
    )
    RETURNING id INTO v_novo_termo_id;
  END IF;

  -- Incrementa contador de aplicações
  UPDATE public.plataforma_modelos_termos
  SET aplicacoes_count = aplicacoes_count + 1, updated_at = now()
  WHERE id = p_modelo_id;

  RETURN jsonb_build_object(
    'sucesso', true,
    'categoria', v_modelo.categoria,
    'termo_garantia_id', v_novo_termo_id,
    'mensagem', CASE 
      WHEN v_modelo.categoria = 'responsabilidade' 
      THEN 'Termo de Responsabilidade da sua oficina atualizado com sucesso!'
      ELSE 'Novo Termo de Garantia adicionado com sucesso à sua oficina!'
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.aplicar_modelo_termo_tenant(uuid) TO authenticated;

-- 4.3 Incrementar Download de Arquivo
DROP FUNCTION IF EXISTS public.incrementar_download_modelo_termo(uuid);
CREATE OR REPLACE FUNCTION public.incrementar_download_modelo_termo(
  p_modelo_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.plataforma_modelos_termos
  SET downloads_count = downloads_count + 1, updated_at = now()
  WHERE id = p_modelo_id;

  RETURN jsonb_build_object('sucesso', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.incrementar_download_modelo_termo(uuid) TO authenticated, anon;

-- 4.4 Admin Listar Modelos de Termos
DROP FUNCTION IF EXISTS public.admin_listar_modelos_termos();
CREATE OR REPLACE FUNCTION public.admin_listar_modelos_termos()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso restrito a administradores da plataforma.';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'titulo', m.titulo,
    'categoria', m.categoria,
    'tipo_servico', m.tipo_servico,
    'descricao', m.descricao,
    'conteudo_texto', m.conteudo_texto,
    'arquivo_url', m.arquivo_url,
    'arquivo_nome', m.arquivo_nome,
    'arquivo_tipo', m.arquivo_tipo,
    'arquivo_tamanho_bytes', m.arquivo_tamanho_bytes,
    'destaque', m.destaque,
    'ativo', m.ativo,
    'downloads_count', m.downloads_count,
    'aplicacoes_count', m.aplicacoes_count,
    'created_at', m.created_at
  ) ORDER BY m.created_at DESC), '[]'::jsonb)
  INTO v_res
  FROM public.plataforma_modelos_termos m;

  RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_listar_modelos_termos() TO authenticated;

-- 4.5 Admin Salvar Modelo de Termo
DROP FUNCTION IF EXISTS public.admin_salvar_modelo_termo(uuid, text, text, text, text, text, text, text, text, bigint, boolean, boolean);
CREATE OR REPLACE FUNCTION public.admin_salvar_modelo_termo(
  p_id UUID DEFAULT NULL,
  p_titulo TEXT DEFAULT NULL,
  p_categoria TEXT DEFAULT 'responsabilidade',
  p_tipo_servico TEXT DEFAULT NULL,
  p_descricao TEXT DEFAULT NULL,
  p_conteudo_texto TEXT DEFAULT NULL,
  p_arquivo_url TEXT DEFAULT NULL,
  p_arquivo_nome TEXT DEFAULT NULL,
  p_arquivo_tipo TEXT DEFAULT NULL,
  p_arquivo_tamanho_bytes BIGINT DEFAULT NULL,
  p_destaque BOOLEAN DEFAULT false,
  p_ativo BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso restrito a administradores da plataforma.';
  END IF;

  IF p_titulo IS NULL OR trim(p_titulo) = '' THEN
    RAISE EXCEPTION 'O título do modelo é obrigatório.';
  END IF;

  IF p_conteudo_texto IS NULL OR trim(p_conteudo_texto) = '' THEN
    RAISE EXCEPTION 'O conteúdo do termo é obrigatório.';
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE public.plataforma_modelos_termos SET
      titulo = trim(p_titulo),
      categoria = p_categoria,
      tipo_servico = p_tipo_servico,
      descricao = trim(p_descricao),
      conteudo_texto = trim(p_conteudo_texto),
      arquivo_url = p_arquivo_url,
      arquivo_nome = p_arquivo_nome,
      arquivo_tipo = p_arquivo_tipo,
      arquivo_tamanho_bytes = p_arquivo_tamanho_bytes,
      destaque = p_destaque,
      ativo = p_ativo,
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.plataforma_modelos_termos (
      titulo, categoria, tipo_servico, descricao, conteudo_texto,
      arquivo_url, arquivo_nome, arquivo_tipo, arquivo_tamanho_bytes,
      destaque, ativo, criado_por
    ) VALUES (
      trim(p_titulo), p_categoria, p_tipo_servico, trim(p_descricao), trim(p_conteudo_texto),
      p_arquivo_url, p_arquivo_nome, p_arquivo_tipo, p_arquivo_tamanho_bytes,
      p_destaque, p_ativo, auth.uid()
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_salvar_modelo_termo(uuid, text, text, text, text, text, text, text, text, bigint, boolean, boolean) TO authenticated;

-- 4.6 Admin Toggle Modelo de Termo
DROP FUNCTION IF EXISTS public.admin_toggle_modelo_termo(uuid, boolean);
CREATE OR REPLACE FUNCTION public.admin_toggle_modelo_termo(p_id UUID, p_ativo BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso restrito a administradores da plataforma.';
  END IF;

  UPDATE public.plataforma_modelos_termos
  SET ativo = p_ativo, updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('sucesso', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_toggle_modelo_termo(uuid, boolean) TO authenticated;

-- 4.7 Admin Excluir Modelo de Termo
DROP FUNCTION IF EXISTS public.admin_excluir_modelo_termo(uuid);
CREATE OR REPLACE FUNCTION public.admin_excluir_modelo_termo(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso restrito a administradores da plataforma.';
  END IF;

  DELETE FROM public.plataforma_modelos_termos WHERE id = p_id;
  RETURN jsonb_build_object('sucesso', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_excluir_modelo_termo(uuid) TO authenticated;

-- ------------------------------------------------------------------------------
-- 5. SEED DE MODELOS INICIAIS JURIDICAMENTE EMBASADOS
-- ------------------------------------------------------------------------------
INSERT INTO public.plataforma_modelos_termos (
  titulo, categoria, tipo_servico, descricao, conteudo_texto, destaque, ativo
) VALUES
(
  'Termo Geral de Responsabilidade & Isenção de Falhas Ocultas',
  'responsabilidade',
  NULL,
  'Modelo padrão e juridicamente robusto que protege a oficina contra alegações de falhas preexistentes, danos em repinturas frágeis, itens deixados no interior e estabelece regras de pátio e testes de rodagem.',
  'Declaro estar ciente de que o veículo acima discriminado será submetido aos procedimentos e serviços especializados contratados. Declaro que procedi com a retirada de todos os objetos de valor e pertences pessoais do interior do veículo, isentando a oficina de qualquer responsabilidade sobre itens não expressamente relacionados na vistoria de entrada. Estou ciente de que avarias preexistentes, repinturas anteriores fragilizadas, verniz com espessura reduzida, ressecamento de componentes plásticos/borrachas/chicotes elétricos e microrriscos camuflados por sujidade pesada podem se tornar evidentes durante ou após a execução dos trabalhos técnicos. Autorizo a realização de testes de rodagem estritamente necessários para validação e controle de qualidade dos serviços executados, bem como declaro ciência dos prazos estipulados para retirada do veículo após notificação de conclusão, sob pena de incidência de taxas diárias de permanência em pátio.',
  true,
  true
),
(
  'Garantia Técnica para Vitrificação / Proteção Cerâmica',
  'garantia',
  'vitrificacao',
  'Cláusula de garantia para revestimentos cerâmicos (vitrificadores), cobrindo propriedades hidrofóbicas e brilho, e especificando cuidados essenciais com lavagens e manutenção periódica.',
  'A presente garantia cobre as propriedades hidrofóbicas, brilho e proteção química do revestimento cerâmico aplicado sobre a pintura original do veículo, condicionada ao cumprimento rigoroso dos seguintes cuidados: 1) Respeitar o tempo de cura total inicial de 7 (sete) dias sem lavagens mecânicas ou uso de produtos químicos; 2) Utilizar exclusivamente shampoos de pH neutro específicos para estética automotiva em lavagens posteriores; 3) Realizar as revisões e manutenções periódicas na oficina a cada 6 (seis) meses; 4) A garantia não cobre danos decorrentes de chuva ácida prolongada não lavada, dejetos de pássaros e seiva de árvores não removidos imediatamente, atritos físicos, lavagens em postos com rolos automáticos ou produtos alcalinos/ácidos abrasivos.',
  true,
  true
),
(
  'Garantia Técnica para Polimento Técnico e Correção de Pintura',
  'garantia',
  'polimento',
  'Cláusula de garantia para polimento e remoção de marcas e hologramas, resguardando a oficina quanto à espessura residual do verniz e manutenção pós-entrega.',
  'Garantimos a entrega do veículo livre de marcas de boina, hologramas ou manchas decorrentes do processo de correção da pintura executado. O cliente reconhece que riscos profundos que atingiram a camada base (tinta) ou vernizes repintados anteriormente que apresentem espessura crítica não podem ser totalmente nivelados por razões de preservação da integridade estrutural da peça. A garantia não cobre novos microrriscos (swirls) causados por lavagens incorretas, panos ásperos, secagens inadequadas ou atrito físico ocorridos após a entrega técnica do veículo.',
  false,
  true
),
(
  'Termo de Garantia e Cuidados para Lavagem Técnica de Motor',
  'garantia',
  'lavagem_motor',
  'Termo especializado para limpeza detalhada de cofre de motor, delimitando responsabilidades sobre módulos elétricos e peças ressecadas.',
  'A limpeza técnica do compartimento do motor é realizada através de processo detalhado a seco/vapor com isolamento prévio dos componentes eletrônicos sensíveis (módulos, centrais, chicotes e bobinas). A garantia assegura a correta aplicação de verniz de proteção térmica e limpeza técnica. A oficina não se responsabiliza por anomalias elétricas preexistentes, conectores ressecados por tempo e caloria natural do veículo, sensores com infiltração prévia ou falhas de ignição derivadas de desgaste natural das peças antes da execução dos serviços.',
  false,
  true
)
ON CONFLICT DO NOTHING;
