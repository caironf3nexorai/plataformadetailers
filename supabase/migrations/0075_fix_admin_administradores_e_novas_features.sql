-- ==============================================================================
-- MIGRAÇÃO 0075: CORRIGIR ADMIN_LISTAR_ADMINISTRADORES E EXPANDIR CATÁLOGO DE FEATURES
-- 1. Corrige erro 'structure of query does not match function result type' na lista de admins
-- 2. Adiciona novos recursos no catálogo de permissões (PDF, Arquivos, Treinamento, Metas, WhatsApp, etc.)
-- 3. Adiciona RPCs para cadastrar novas funcionalidades e limites dinamicamente sem código
-- ==============================================================================

-- 1. CORRIGIR TIPAGEM EXPLÍCITA EM ADMIN_LISTAR_ADMINISTRADORES
DROP FUNCTION IF EXISTS public.admin_listar_administradores();

CREATE OR REPLACE FUNCTION public.admin_listar_administradores()
RETURNS TABLE (
  id UUID,
  user_id UUID,
  email TEXT,
  nivel TEXT,
  ativo BOOLEAN,
  super_admin BOOLEAN,
  observacao TEXT,
  created_at TIMESTAMPTZ,
  revogado_em TIMESTAMPTZ,
  criado_por_email TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT 
    pa.id::uuid AS id,
    pa.user_id::uuid AS user_id,
    pa.email::text AS email,
    pa.nivel::text AS nivel,
    pa.ativo::boolean AS ativo,
    pa.super_admin::boolean AS super_admin,
    pa.observacao::text AS observacao,
    pa.created_at::timestamptz AS created_at,
    pa.revogado_em::timestamptz AS revogado_em,
    COALESCE(u_creator.email, 'Sistema')::text AS criado_por_email
  FROM public.platform_admins pa
  LEFT JOIN auth.users u_creator ON u_creator.id = pa.criado_por
  ORDER BY pa.super_admin DESC, pa.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_listar_administradores() TO authenticated;


-- 2. EXPANDIR CATÁLOGO DE FUNCIONALIDADES (FEATURE_CATALOGO)
INSERT INTO public.feature_catalogo (chave, nome, descricao, grupo, ordem) VALUES
  ('personalizacao_pdf', 'Personalização de PDF (Cores e Logo)', 'Cores da marca, logotipo e cabeçalho nos PDFs de vistoria e orçamento', 'Personalização', 12),
  ('arquivos_digitais', 'Arquivos Digitais e Anexos', 'Upload e anexos de fotos, laudos e documentos nos atendimentos', 'Operacional', 13),
  ('treinamentos', 'Módulo de Treinamentos da Plataforma', 'Acesso às aulas em vídeo, tutoriais de uso e onboarding', 'Capacitação', 14),
  ('metas_equipe', 'Metas e Desempenho da Equipe', 'Definição e acompanhamento de metas de faturamento e comissão', 'Gestão', 15),
  ('programa_indicacao', 'Programa Indique e Ganhe', 'Programa de indicações com ganho de dias bônus no plano', 'Vendas', 16),
  ('relatorios_dre', 'DRE e Relatórios Exportáveis', 'Demonstrativo do Resultado do Exercício e exportação de relatórios', 'Financeiro', 17),
  ('whatsapp_mensagens', 'Mensagens WhatsApp Automáticas', 'Disparo de lembretes e links de orçamentos diretamente no WhatsApp', 'Vendas', 18)
ON CONFLICT (chave) DO UPDATE SET
  nome = EXCLUDED.nome,
  descricao = EXCLUDED.descricao,
  grupo = EXCLUDED.grupo,
  ordem = EXCLUDED.ordem;

-- Garantir que as novas features sejam associadas aos planos existentes
INSERT INTO public.plan_features (plano, feature, habilitado) VALUES
  -- Free
  ('free', 'personalizacao_pdf', false),
  ('free', 'arquivos_digitais', true),
  ('free', 'treinamentos', true),
  ('free', 'metas_equipe', false),
  ('free', 'programa_indicacao', true),
  ('free', 'relatorios_dre', false),
  ('free', 'whatsapp_mensagens', false),

  -- Pro
  ('pro', 'personalizacao_pdf', true),
  ('pro', 'arquivos_digitais', true),
  ('pro', 'treinamentos', true),
  ('pro', 'metas_equipe', true),
  ('pro', 'programa_indicacao', true),
  ('pro', 'relatorios_dre', true),
  ('pro', 'whatsapp_mensagens', true),

  -- Studio
  ('studio', 'personalizacao_pdf', true),
  ('studio', 'arquivos_digitais', true),
  ('studio', 'treinamentos', true),
  ('studio', 'metas_equipe', true),
  ('studio', 'programa_indicacao', true),
  ('studio', 'relatorios_dre', true),
  ('studio', 'whatsapp_mensagens', true)
ON CONFLICT (plano, feature) DO NOTHING;


-- 3. RPC PARA O ADMIN CADASTRAR NOVAS FUNCIONALIDADES DINAMICAMENTE NO PAINEL
DROP FUNCTION IF EXISTS public.admin_cadastrar_feature_catalogo(text, text, text, text, integer);
CREATE OR REPLACE FUNCTION public.admin_cadastrar_feature_catalogo(
  p_chave TEXT,
  p_nome TEXT,
  p_descricao TEXT DEFAULT NULL,
  p_grupo TEXT DEFAULT 'Geral',
  p_ordem INTEGER DEFAULT 0
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_chave_clean TEXT;
  v_plano RECORD;
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Apenas administradores da plataforma podem cadastrar recursos.';
  END IF;

  v_chave_clean := LOWER(TRIM(p_chave));
  IF v_chave_clean = '' THEN
    RAISE EXCEPTION 'A chave do recurso não pode ser vazia.';
  END IF;

  -- Inserir ou atualizar recurso no catálogo
  INSERT INTO public.feature_catalogo (chave, nome, descricao, grupo, ordem)
  VALUES (v_chave_clean, p_nome, p_descricao, COALESCE(p_grupo, 'Geral'), COALESCE(p_ordem, 0))
  ON CONFLICT (chave) DO UPDATE SET
    nome = EXCLUDED.nome,
    descricao = EXCLUDED.descricao,
    grupo = EXCLUDED.grupo,
    ordem = EXCLUDED.ordem;

  -- Associar a todos os planos existentes habilitado = true por padrão
  FOR v_plano IN SELECT codigo FROM public.plans LOOP
    INSERT INTO public.plan_features (plano, feature, habilitado)
    VALUES (v_plano.codigo, v_chave_clean, true)
    ON CONFLICT (plano, feature) DO NOTHING;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_cadastrar_feature_catalogo(text, text, text, text, integer) TO authenticated;
