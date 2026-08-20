-- Migration 0057: Personalização Completa de Documentos PDF por Plano de Assinatura (Free vs Pro/Studio)

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS pdf_cor_primaria text DEFAULT '#f59e0b',
  ADD COLUMN IF NOT EXISTS pdf_cor_fundo_cabecalho text DEFAULT '#18181b',
  ADD COLUMN IF NOT EXISTS pdf_cor_texto_cabecalho text DEFAULT '#ffffff',
  ADD COLUMN IF NOT EXISTS pdf_cor_fundo_secoes text DEFAULT '#27272a',
  ADD COLUMN IF NOT EXISTS pdf_subtitulo_cabecalho text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pdf_texto_observacoes_orcamento text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pdf_texto_rodape text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pdf_ocultar_marca_dagua boolean DEFAULT false;

COMMENT ON COLUMN public.tenants.pdf_cor_primaria IS 'Cor de destaque para títulos e valores nos PDFs (planos Pro/Studio)';
COMMENT ON COLUMN public.tenants.pdf_cor_fundo_cabecalho IS 'Cor de fundo da Headline / Cabeçalho do PDF (planos Pro/Studio)';
COMMENT ON COLUMN public.tenants.pdf_cor_texto_cabecalho IS 'Cor do texto do cabeçalho (#ffffff ou #18181b)';
COMMENT ON COLUMN public.tenants.pdf_cor_fundo_secoes IS 'Cor de fundo das caixas e cartões de informação no corpo do PDF';
COMMENT ON COLUMN public.tenants.pdf_subtitulo_cabecalho IS 'Subtítulo personalizado para o cabeçalho dos documentos';
COMMENT ON COLUMN public.tenants.pdf_texto_observacoes_orcamento IS 'Observações padrão e condições comerciais para o orçamento';
COMMENT ON COLUMN public.tenants.pdf_texto_rodape IS 'Termos de garantia ou observações personalizadas para o rodapé do PDF';
COMMENT ON COLUMN public.tenants.pdf_ocultar_marca_dagua IS 'Oculta a indicação da plataforma no rodapé (apenas Pro e Studio)';
