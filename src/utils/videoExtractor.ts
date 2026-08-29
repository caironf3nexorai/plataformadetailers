/**
 * Extrator de URL de Vídeo para Módulo de Treinamento
 * Suporta links normais, encurtados, embed e com parâmetros do YouTube e Vimeo.
 * 
 * NOTA DE SEGURANÇA SOBRE VÍDEOS NÃO LISTADOS:
 * Vídeos marcados como "Não Listados" no YouTube ou Vimeo não são secretos, apenas não aparecem
 * em buscas públicas nem no canal do autor. Qualquer pessoa com o link do vídeo consegue assistir,
 * independentemente do plano contratado. Este recurso é excelente para treinamentos de uso da plataforma,
 * mas não deve ser utilizado para armazenar dados estritamente confidenciais ou sensíveis.
 */

export interface ExtrairVideoResult {
  plataforma: 'youtube' | 'vimeo';
  video_id: string;
  embedUrl: string;
}

export function parseVideoUrl(inputUrl: string): ExtrairVideoResult {
  if (!inputUrl || typeof inputUrl !== 'string') {
    throw new Error('Link de vídeo não reconhecido. Por favor, insira um link válido do YouTube ou Vimeo.');
  }

  const cleanUrl = inputUrl.trim();

  // YOUTUBE REGEX PATTERNS
  // 1. standard watch: youtube.com/watch?v=VIDEO_ID
  // 2. short link: youtu.be/VIDEO_ID
  // 3. embed link: youtube.com/embed/VIDEO_ID
  // 4. shorts link: youtube.com/shorts/VIDEO_ID
  const ytMatch = cleanUrl.match(/(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
  if (ytMatch && ytMatch[1]) {
    const videoId = ytMatch[1];
    return {
      plataforma: 'youtube',
      video_id: videoId,
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`
    };
  }

  // VIMEO REGEX PATTERNS
  // 1. standard link: vimeo.com/123456789
  // 2. player link: player.vimeo.com/video/123456789
  const vimeoMatch = cleanUrl.match(/(?:vimeo\.com\/(?:video\/)?|player\.vimeo\.com\/video\/)([0-9]+)/i);
  if (vimeoMatch && vimeoMatch[1]) {
    const videoId = vimeoMatch[1];
    return {
      plataforma: 'vimeo',
      video_id: videoId,
      embedUrl: `https://player.vimeo.com/video/${videoId}`
    };
  }

  throw new Error('Link de vídeo não reconhecido. Por favor, insira um link válido do YouTube ou Vimeo.');
}

/**
 * Retorna a URL de embed pronta a partir da plataforma e id
 */
export function getEmbedUrl(plataforma: string, videoId: string): string {
  if (plataforma === 'youtube') {
    return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`;
  }
  if (plataforma === 'vimeo') {
    return `https://player.vimeo.com/video/${videoId}`;
  }
  return '';
}
