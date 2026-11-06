/**
 * Extrator de URL de Vídeo para Módulo de Treinamento e Aulas
 * Suporta links normais, encurtados, embed do YouTube, Vimeo e Arquivos Nativos Diretos (.mp4 / Storage).
 * 
 * SUPORTE A HOSPEDAGEM NATIVA:
 * Vídeos hospedados nativamente no Supabase Storage ou CDNs em formato MP4 eliminam 100% de
 * vínculos com o YouTube, não exibem logos externas nem links para sites de terceiros,
 * garantindo proteção total contra cancelamentos e retenção de alunos.
 */

export interface ExtrairVideoResult {
  plataforma: 'youtube' | 'vimeo' | 'arquivo';
  video_id: string;
  embedUrl: string;
}

export function parseVideoUrl(inputUrl: string): ExtrairVideoResult {
  if (!inputUrl || typeof inputUrl !== 'string') {
    throw new Error('Link de vídeo não reconhecido. Por favor, insira um link válido do YouTube, Vimeo ou arquivo direto de vídeo (.mp4).');
  }

  const cleanUrl = inputUrl.trim();

  // 1. YOUTUBE REGEX PATTERNS (watch, youtu.be, embed, shorts)
  const ytMatch = cleanUrl.match(/(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
  if (ytMatch && ytMatch[1]) {
    const videoId = ytMatch[1];
    return {
      plataforma: 'youtube',
      video_id: videoId,
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`
    };
  }

  // 2. VIMEO REGEX PATTERNS (vimeo.com/123456789)
  const vimeoMatch = cleanUrl.match(/(?:vimeo\.com\/(?:video\/)?|player\.vimeo\.com\/video\/)([0-9]+)/i);
  if (vimeoMatch && vimeoMatch[1]) {
    const videoId = vimeoMatch[1];
    return {
      plataforma: 'vimeo',
      video_id: videoId,
      embedUrl: `https://player.vimeo.com/video/${videoId}`
    };
  }

  // 3. ARQUIVO DIRETO DE VÍDEO (MP4, WEBM, STORAGE NATIVO)
  if (/\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(cleanUrl) || cleanUrl.includes('/storage/v1/object/public/')) {
    return {
      plataforma: 'arquivo',
      video_id: cleanUrl,
      embedUrl: cleanUrl
    };
  }

  throw new Error('Link de vídeo não reconhecido. Por favor, insira um link válido do YouTube, Vimeo ou link direto de vídeo MP4.');
}

/**
 * Retorna a URL pronta para reprodução a partir da plataforma e id
 */
export function getEmbedUrl(plataforma: string, videoId: string): string {
  if (plataforma === 'youtube') {
    return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`;
  }
  if (plataforma === 'vimeo') {
    return `https://player.vimeo.com/video/${videoId}`;
  }
  if (plataforma === 'arquivo') {
    return videoId;
  }
  return '';
}
