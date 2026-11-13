import { cleanTelefone, formatTelefone } from './formatters';

export const SIMULADOR_FILENAME = 'NuvemWash_Simulador_Oficial_Precificacao_v5.xlsx';
export const SIMULADOR_DOWNLOAD_PATH = `/downloads/${SIMULADOR_FILENAME}`;
export const CALCULADORA_LEAD_STORAGE_KEY = 'nuvemwash_calculadora_lead';

export const MOMENTOS_ESTETICA = [
  'Começando agora / Garagem',
  'Estética montada (1 a 2 pessoas)',
  'Já tenho equipe (3+ pessoas)',
] as const;

export type MomentoEstetica = (typeof MOMENTOS_ESTETICA)[number];

export interface CalculadoraLeadFormInput {
  nome: string;
  whatsapp: string;
  email: string;
  momento_estetica: string;
}

export interface CalculadoraLeadSessao extends CalculadoraLeadFormInput {
  leadId?: string | null;
  downloadedAt?: string;
}

export interface CalculadoraLeadErrors {
  nome?: string;
  whatsapp?: string;
  email?: string;
  momento_estetica?: string;
}

export function validarFormularioLead(input: CalculadoraLeadFormInput): {
  valido: boolean;
  erros: CalculadoraLeadErrors;
  normalizado: {
    nome: string;
    whatsapp: string;
    email: string;
    momento_estetica: MomentoEstetica;
  };
} {
  const erros: CalculadoraLeadErrors = {};
  const nomeLimpo = input.nome.trim();
  const whatsappDigitos = cleanTelefone(input.whatsapp);
  const whatsappFormatado = formatTelefone(whatsappDigitos);
  const emailLimpo = input.email.trim().toLowerCase();
  const momentoLimpo = input.momento_estetica.trim();

  if (nomeLimpo.length < 2) {
    erros.nome = 'Informe seu nome completo (mínimo 2 caracteres).';
  }

  if (whatsappDigitos.length < 10 || whatsappDigitos.length > 11) {
    erros.whatsapp = 'Informe um WhatsApp válido com DDD (10 ou 11 dígitos).';
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLimpo)) {
    erros.email = 'Informe um e-mail válido.';
  }

  if (!MOMENTOS_ESTETICA.includes(momentoLimpo as MomentoEstetica)) {
    erros.momento_estetica = 'Selecione o momento atual da sua estética.';
  }

  return {
    valido: Object.keys(erros).length === 0,
    erros,
    normalizado: {
      nome: nomeLimpo,
      whatsapp: whatsappFormatado,
      email: emailLimpo,
      momento_estetica: momentoLimpo as MomentoEstetica,
    },
  };
}

/**
 * Converte URLs comuns de YouTube, Vimeo ou Panda Video em URL pronta para <iframe>.
 */
export function normalizarEmbedVideoUrl(rawUrl?: string | null): string | null {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }

    const host = parsed.hostname.toLowerCase();

    // YouTube watch?v=..., shorts/..., embed/..., youtu.be/...
    if (host.includes('youtube.com') || host.includes('youtube-nocookie.com')) {
      if (parsed.pathname.startsWith('/embed/')) {
        return trimmed;
      }
      const videoId = parsed.searchParams.get('v');
      if (videoId) {
        return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?rel=0&modestbranding=1`;
      }
      const shortsMatch = parsed.pathname.match(/^\/shorts\/([A-Za-z0-9_-]+)/);
      if (shortsMatch?.[1]) {
        return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(shortsMatch[1])}?rel=0&modestbranding=1`;
      }
    }

    if (host === 'youtu.be') {
      const videoId = parsed.pathname.replace(/^\/+/, '').split('/')[0];
      if (videoId) {
        return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?rel=0&modestbranding=1`;
      }
    }

    // Vimeo
    if (host === 'vimeo.com' || host === 'www.vimeo.com') {
      const vimeoId = parsed.pathname.replace(/^\/+/, '').split('/')[0];
      if (vimeoId && /^\d+$/.test(vimeoId)) {
        return `https://player.vimeo.com/video/${vimeoId}`;
      }
    }
    if (host === 'player.vimeo.com') {
      return trimmed;
    }

    // Panda Video ou outros players HTTPS diretos de embed
    if (host.includes('pandavideo')) {
      return trimmed;
    }

    return trimmed;
  } catch {
    return null;
  }
}

export function construirUrlCadastroComLead(lead?: Partial<CalculadoraLeadSessao> | null): string {
  const params = new URLSearchParams();
  params.set('origem', 'calculadora');

  if (lead?.nome?.trim()) {
    params.set('nome', lead.nome.trim());
  }
  if (lead?.email?.trim()) {
    params.set('email', lead.email.trim().toLowerCase());
  }
  if (lead?.whatsapp?.trim()) {
    params.set('whatsapp', formatTelefone(lead.whatsapp));
  }
  if (lead?.leadId?.trim()) {
    params.set('lead_id', lead.leadId.trim());
  }

  return `/criar-conta?${params.toString()}`;
}

export async function dispararDownloadSimulador(): Promise<{
  ok: boolean;
  missingFile?: boolean;
}> {
  try {
    const response = await fetch(SIMULADOR_DOWNLOAD_PATH, { cache: 'no-store' });
    const contentType = (response.headers.get('content-type') || '').toLowerCase();

    // Em SPAs (Vite / Vercel), arquivo ausente pode retornar HTTP 200 com index.html
    if (!response.ok || contentType.includes('text/html')) {
      return { ok: false, missingFile: true };
    }

    const blob = await response.blob();
    if (!blob || blob.size === 0) {
      return { ok: false, missingFile: true };
    }

    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = SIMULADOR_FILENAME;
    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => {
      window.URL.revokeObjectURL(blobUrl);
    }, 5000);

    return { ok: true };
  } catch {
    return { ok: false };
  }
}

