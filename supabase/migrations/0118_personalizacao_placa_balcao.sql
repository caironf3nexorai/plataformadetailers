-- Migration 0118: Personalização da Placa de Balcão / Display de Mesa para Planos Pro e Studio

-- 1. ADICIONAR COLUNA DE CONFIGURAÇÃO DA PLACA DE BALCÃO NA TABELA TENANTS
ALTER TABLE public.tenants
ADD COLUMN IF NOT EXISTS placa_balcao_config jsonb DEFAULT NULL;

COMMENT ON COLUMN public.tenants.placa_balcao_config IS 'Configurações de personalização visual e textual da placa de balcão (cores, slogans, chamadas, 3 destaques e white-label) para assinantes Pro e Studio.';

-- 2. CADASTRAR FUNCIONALIDADE NO CATÁLOGO DE FEATURES DA PLATAFORMA
INSERT INTO public.feature_catalogo (chave, nome, descricao, grupo, ordem) VALUES
  ('personalizacao_placa_balcao', 'Personalização da Placa de Balcão', 'Personalização de cores, textos, chamadas e remoção de marca (White-label) no display de recepção', 'Vendas', 24)
ON CONFLICT (chave) DO UPDATE SET
  nome = EXCLUDED.nome,
  descricao = EXCLUDED.descricao,
  grupo = EXCLUDED.grupo,
  ordem = EXCLUDED.ordem;

-- 3. VINCULAR A FUNCIONALIDADE AOS PLANOS EXISTENTES NA MATRIZ
INSERT INTO public.plan_features (plano, feature, habilitado) VALUES
  ('free', 'personalizacao_placa_balcao', false),
  ('pro', 'personalizacao_placa_balcao', true),
  ('studio', 'personalizacao_placa_balcao', true)
ON CONFLICT (plano, feature) DO UPDATE SET
  habilitado = EXCLUDED.habilitado;
