-- Migration 0051: Adicionar coluna capturada_em para metadados EXIF
alter table public.checkin_fotos add column if not exists capturada_em timestamptz default null;
alter table public.execucao_fotos add column if not exists capturada_em timestamptz default null;

comment on column public.checkin_fotos.capturada_em is 'Data/hora original da captura da foto da câmera (lida do EXIF). Prova jurídica imutável.';
comment on column public.execucao_fotos.capturada_em is 'Data/hora original da captura da foto da câmera (lida do EXIF).';
