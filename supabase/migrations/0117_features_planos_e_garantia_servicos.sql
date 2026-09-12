-- Migration 0117: Configurações de Garantia nos Serviços e Registro de Novas Features nos Planos

-- 1. ADICIONAR COLUNAS DE GARANTIA NA TABELA DE SERVIÇOS
ALTER TABLE public.servicos
ADD COLUMN IF NOT EXISTS tem_garantia BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS garantia_meses INTEGER DEFAULT 12,
ADD COLUMN IF NOT EXISTS garantia_intervalo_dias INTEGER DEFAULT 60,
ADD COLUMN IF NOT EXISTS garantia_produto_padrao TEXT,
ADD COLUMN IF NOT EXISTS garantia_cuidados TEXT;

COMMENT ON COLUMN public.servicos.tem_garantia IS 'Indica se este serviço gera Certificado de Garantia e Etiqueta Eletrostática de Para-brisa.';
COMMENT ON COLUMN public.servicos.garantia_meses IS 'Prazo padrão de garantia em meses (ex: 12, 24, 36).';
COMMENT ON COLUMN public.servicos.garantia_intervalo_dias IS 'Intervalo recomendado em dias para manutenções preventivas (ex: 60 dias).';
COMMENT ON COLUMN public.servicos.garantia_produto_padrao IS 'Nome ou marca do produto de proteção aplicado por padrão (ex: Vonixx V-Paint 3 Anos).';
COMMENT ON COLUMN public.servicos.garantia_cuidados IS 'Orientações padrão de cuidados e preservação no pós-venda.';

-- 2. CADASTRAR NOVAS FUNCIONALIDADES NO CATÁLOGO DE FEATURES DA PLATAFORMA
INSERT INTO public.feature_catalogo (chave, nome, descricao, grupo, ordem) VALUES
  ('certificados_garantia', 'Certificado Digital de Garantia', 'Emissão de certificados digitais com QR Code e link público de consulta para o cliente', 'Pós-Venda', 19),
  ('adesivos_parabrisa', 'Adesivos de Para-brisa para Impressão', 'Gerador de etiquetas de para-brisa prontas para impressão com QR Code', 'Pós-Venda', 20),
  ('crm_retorno_oportunidades', 'CRM de Retorno e Manutenções', 'Radar de manutenções com lembretes automáticos e mensagens no WhatsApp', 'Vendas', 21),
  ('vitrine_digital_qrcode', 'Vitrine Digital & Placa de Balcão', 'Placa de balcão personalizada para impressão com QR Code e vitrine pública de serviços', 'Vendas', 22),
  ('academia_materiais', 'Download de Materiais Didáticos', 'Download de modelos editáveis de termos, apostilas técnicas e artes profissionais', 'Capacitação', 23)
ON CONFLICT (chave) DO UPDATE SET
  nome = EXCLUDED.nome,
  descricao = EXCLUDED.descricao,
  grupo = EXCLUDED.grupo,
  ordem = EXCLUDED.ordem;

-- 3. VINCULAR AS NOVAS FUNCIONALIDADES AOS PLANOS EXISTENTES NA MATRIZ
INSERT INTO public.plan_features (plano, feature, habilitado) VALUES
  -- Plano Free (Básico: Vitrine ativa para divulgação, pós-venda avançado restrito para incentivar upgrade)
  ('free', 'certificados_garantia', false),
  ('free', 'adesivos_parabrisa', false),
  ('free', 'crm_retorno_oportunidades', false),
  ('free', 'vitrine_digital_qrcode', true),
  ('free', 'academia_materiais', false),

  -- Plano Pro (Acesso completo a todas as ferramentas)
  ('pro', 'certificados_garantia', true),
  ('pro', 'adesivos_parabrisa', true),
  ('pro', 'crm_retorno_oportunidades', true),
  ('pro', 'vitrine_digital_qrcode', true),
  ('pro', 'academia_materiais', true),

  -- Plano Studio (Acesso completo a todas as ferramentas)
  ('studio', 'certificados_garantia', true),
  ('studio', 'adesivos_parabrisa', true),
  ('studio', 'crm_retorno_oportunidades', true),
  ('studio', 'vitrine_digital_qrcode', true),
  ('studio', 'academia_materiais', true)
ON CONFLICT (plano, feature) DO NOTHING;
