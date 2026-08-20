import { supabase } from '../lib/supabase';

export const DEFAULT_SERVICE_PLACEHOLDER =
  'https://images.unsplash.com/photo-1607860108855-64acf2078ed9?auto=format&fit=crop&w=800&q=80';

/**
 * Converte um nome de grupo em um slug determinístico sem acentos e sem caracteres especiais.
 * Exemplo: "Higienização" -> "higienizacao"
 * Exemplo: "Polimento / Correção" -> "polimento-correcao"
 */
export const slugifyGrupo = (text: string): string => {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

/**
 * Valida o tipo MIME do arquivo enviado. Aceita apenas JPG, JPEG, PNG e WEBP.
 */
export const validateImageFile = (
  file: File
): { valid: boolean; ext: string; error?: string } => {
  const allowedMimeTypes: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };

  const ext = allowedMimeTypes[file.type.toLowerCase()];
  if (!ext) {
    return {
      valid: false,
      ext: '',
      error: 'Formato inválido. Envie apenas imagens JPG, PNG ou WEBP.',
    };
  }

  return { valid: true, ext };
};

/**
 * Retorna a URL pública de uma foto armazenada no bucket público 'catalogo'.
 */
export const getFotoPublicUrl = (path: string | null | undefined): string | null => {
  if (!path) return null;
  const { data } = supabase.storage.from('catalogo').getPublicUrl(path);
  return data?.publicUrl || null;
};

/**
 * Resolve a imagem de exibição do serviço seguindo a ordem estrita de precedência:
 * 1. Foto própria do serviço (servico.foto_path)
 * 2. Foto do grupo de serviços (grupoFotos[grupo])
 * 3. Capa padrão da oficina (tenantCapaPath)
 * 4. Placeholder de fallback
 */
export const fotoDoServico = (
  servico: { foto_path?: string | null; grupo?: string } | null | undefined,
  grupoFotos: Record<string, string | null | undefined> = {},
  tenantCapaPath: string | null | undefined = null
): string => {
  if (!servico) {
    if (tenantCapaPath) {
      const url = getFotoPublicUrl(tenantCapaPath);
      if (url) return url;
    }
    return DEFAULT_SERVICE_PLACEHOLDER;
  }

  // 1. Foto própria do serviço
  if (servico.foto_path) {
    const url = getFotoPublicUrl(servico.foto_path);
    if (url) return url;
  }

  // 2. Foto do grupo
  if (servico.grupo) {
    const grupoSlug = slugifyGrupo(servico.grupo);
    const grupoPath = grupoFotos[servico.grupo] || grupoFotos[grupoSlug];
    if (grupoPath) {
      const url = getFotoPublicUrl(grupoPath);
      if (url) return url;
    }
  }

  // 3. Capa da oficina
  if (tenantCapaPath) {
    const url = getFotoPublicUrl(tenantCapaPath);
    if (url) return url;
  }

  // 4. Placeholder padrão
  return DEFAULT_SERVICE_PLACEHOLDER;
};
