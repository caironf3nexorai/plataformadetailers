-- ==============================================================================
-- MIGRACAO 0165: SUPORTE A VIDEOS NATIVOS HOSPEDADOS (MP4/WEBM/STORAGE)
-- ==============================================================================
-- Permite que videos de treinamento sejam hospedados nativamente na plataforma
-- (Supabase Storage, CDN ou URL direta de video), sem depender de YouTube ou Vimeo,
-- eliminando completamente logos externas, recomendacoes e riscos de vazamento.
-- ==============================================================================

-- 1. Atualizar constraint da tabela treinamentos para permitir 'arquivo'
ALTER TABLE public.treinamentos DROP CONSTRAINT IF EXISTS treinamentos_plataforma_check;
ALTER TABLE public.treinamentos ADD CONSTRAINT treinamentos_plataforma_check CHECK (plataforma IN ('youtube', 'vimeo', 'arquivo'));

-- 2. Comentario de documentacao
COMMENT ON COLUMN public.treinamentos.plataforma IS 'Plataforma de hospedagem do video: youtube, vimeo ou arquivo (hospedado nativamente no storage/CDN)';
