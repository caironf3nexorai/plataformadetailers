import { supabase } from '../lib/supabase';

export type EtapaOnboardingId =
  | 'etapa_2'
  | 'etapa_3'
  | 'etapa_4'
  | 'etapa_5'
  | 'etapa_6'
  | 'etapa_7'
  | 'etapa_8';

export type OnboardingProgressFlags = {
  oficina_personalizada?: boolean;
  catalogo_revisado?: boolean;
  horarios_revisados?: boolean;
  termos_revisados?: boolean;
  vitrine_revisada?: boolean;
  trabalho_sozinho?: boolean;
  equipe_configurada?: boolean;
  manual?: Partial<Record<EtapaOnboardingId, boolean>>;
  [key: string]: unknown;
};

export interface StatusOnboardingInput {
  plano?: string;
  servicosCount: number;
  servicosConfirmadosCount: number;
  orcamentosCount: number;
  termosGarantiaCount: number;
  membrosCount: number;
  temLogo: boolean;
  temIdentidade: boolean;
  temPix: boolean;
  sinalAtivo: boolean;
  temTermoRespCustom: boolean;
  progress: OnboardingProgressFlags;
}

export interface EtapaOnboardingCalculada {
  id: EtapaOnboardingId;
  numero: 2 | 3 | 4 | 5 | 6 | 7 | 8;
  fase: 1 | 2;
  titulo: string;
  subtitulo: string;
  rota: string;
  concluida: boolean;
  concluidaAuto: boolean;
  concluidaManual: boolean;
}

export interface ResultadoProgressoOnboarding {
  basePercentual: number;
  percentualPorEtapa: number;
  porcentagem: number;
  totalEtapasExtras: number;
  etapasConcluidas: number;
  fase1Concluida: boolean;
  tudoConcluido: boolean;
  etapa1Texto: string;
  etapas: EtapaOnboardingCalculada[];
}

export const ONBOARDING_EVENT_PROGRESSO = 'onboarding_progresso_atualizado';
export const ONBOARDING_EVENT_WELCOME_VISIBILITY = 'onboarding_welcome_visibility';

const STORAGE_WELCOME_PREFIX = 'onboarding_welcome_seen_v2_';
const STORAGE_PROGRESS_PREFIX = 'onboarding_progress_v2_';
const STORAGE_OCULTO_PREFIX = 'onboarding_widget_oculto_v2_';
const STORAGE_RECOLHIDO_PREFIX = 'onboarding_widget_recolhido_v2_';

export function mergeOnboardingFlags(
  atual?: OnboardingProgressFlags | null,
  novo?: OnboardingProgressFlags | null
): OnboardingProgressFlags {
  const base: OnboardingProgressFlags = { ...(atual || {}) };
  const patch: OnboardingProgressFlags = { ...(novo || {}) };

  const manualAtual = base.manual || {};
  const manualPatch = patch.manual;

  const { manual: _ignored, ...restoPatch } = patch;
  const resultado: OnboardingProgressFlags = {
    ...base,
    ...restoPatch,
  };

  if (manualPatch && typeof manualPatch === 'object') {
    resultado.manual = {
      ...manualAtual,
      ...manualPatch,
    };
  } else if (Object.keys(manualAtual).length > 0) {
    resultado.manual = { ...manualAtual };
  }

  return resultado;
}

export function lerWelcomeVistoLocal(tenantId?: string | null): boolean {
  if (!tenantId || typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(`${STORAGE_WELCOME_PREFIX}${tenantId}`) === 'true';
  } catch {
    return false;
  }
}

export function salvarWelcomeVistoLocal(tenantId?: string | null, visto = true): void {
  if (!tenantId || typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${STORAGE_WELCOME_PREFIX}${tenantId}`, visto ? 'true' : 'false');
  } catch {
    // noop
  }
}

export function lerProgressLocal(tenantId?: string | null): OnboardingProgressFlags {
  if (!tenantId || typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(`${STORAGE_PROGRESS_PREFIX}${tenantId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function salvarProgressLocal(
  tenantId?: string | null,
  flags?: OnboardingProgressFlags | null
): void {
  if (!tenantId || typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${STORAGE_PROGRESS_PREFIX}${tenantId}`, JSON.stringify(flags || {}));
  } catch {
    // noop
  }
}

export function lerWidgetOcultoLocal(tenantId?: string | null): boolean {
  if (!tenantId || typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(`${STORAGE_OCULTO_PREFIX}${tenantId}`) === 'true';
  } catch {
    return false;
  }
}

export function salvarWidgetOcultoLocal(tenantId?: string | null, oculto = false): void {
  if (!tenantId || typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${STORAGE_OCULTO_PREFIX}${tenantId}`, oculto ? 'true' : 'false');
  } catch {
    // noop
  }
}

export function lerWidgetRecolhidoLocal(tenantId?: string | null): boolean {
  if (!tenantId || typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(`${STORAGE_RECOLHIDO_PREFIX}${tenantId}`) === 'true';
  } catch {
    return false;
  }
}

export function salvarWidgetRecolhidoLocal(tenantId?: string | null, recolhido = false): void {
  if (!tenantId || typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${STORAGE_RECOLHIDO_PREFIX}${tenantId}`, recolhido ? 'true' : 'false');
  } catch {
    // noop
  }
}

export async function registrarWelcomeModalVisto(tenantId?: string | null): Promise<void> {
  if (!tenantId) return;
  salvarWelcomeVistoLocal(tenantId, true);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(ONBOARDING_EVENT_WELCOME_VISIBILITY, {
        detail: { aberto: false, visto: true, tenantId },
      })
    );
  }
  try {
    await supabase.rpc('marcar_welcome_modal_visto', { p_tenant_id: tenantId });
  } catch {
    // Mantém fallback local sem bloquear navegação
  }
}

export async function marcarPassoOnboarding(
  tenantId: string | null | undefined,
  chaves: OnboardingProgressFlags,
  ocultarWidget?: boolean
): Promise<OnboardingProgressFlags> {
  const atual = lerProgressLocal(tenantId);
  const merged = mergeOnboardingFlags(atual, chaves);

  if (tenantId) {
    salvarProgressLocal(tenantId, merged);
    if (typeof ocultarWidget === 'boolean') {
      salvarWidgetOcultoLocal(tenantId, ocultarWidget);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(ONBOARDING_EVENT_PROGRESSO, {
          detail: { tenantId, chaves: merged, ocultarWidget },
        })
      );
    }

    try {
      const { data } = await supabase.rpc('atualizar_progresso_onboarding', {
        p_tenant_id: tenantId,
        p_chaves: chaves,
        p_ocultar_widget: typeof ocultarWidget === 'boolean' ? ocultarWidget : null,
      });
      if (data?.onboarding_progress) {
        const synced = mergeOnboardingFlags(merged, data.onboarding_progress);
        salvarProgressLocal(tenantId, synced);
        return synced;
      }
    } catch {
      // Fallback local já persistido acima
    }
  }

  return merged;
}

/**
 * Calcula o progresso total baseado no Efeito Endowed Progress:
 * - Base inicial (Etapa 1): 16% sempre concluída (conta + X serviços médios pré-carregados)
 * - 7 etapas práticas (2 a 8) de 12% cada = 84% -> Total exato = 100%
 */
export function calcularProgressoOnboarding(
  input: StatusOnboardingInput
): ResultadoProgressoOnboarding {
  const progress = input.progress || {};
  const manual = progress.manual || {};

  const isFree = (input.plano || 'free').toLowerCase() === 'free';

  const orcamentoAuto = input.orcamentosCount >= 1;
  const oficinaAuto =
    input.temLogo || input.temIdentidade || Boolean(progress.oficina_personalizada);
  const servicosAuto =
    input.servicosConfirmadosCount > 0 || Boolean(progress.catalogo_revisado);
  const horariosAuto = Boolean(progress.horarios_revisados);
  const termosAuto =
    input.temTermoRespCustom ||
    input.termosGarantiaCount > 0 ||
    Boolean(progress.termos_revisados);
  const vitrineAuto =
    input.temPix || input.sinalAtivo || Boolean(progress.vitrine_revisada);
  const equipeAuto =
    input.membrosCount >= 2 ||
    Boolean(progress.trabalho_sozinho) ||
    Boolean(progress.equipe_configurada);

  const etapaDefs: Array<{
    id: EtapaOnboardingId;
    numero: 2 | 3 | 4 | 5 | 6 | 7 | 8;
    fase: 1 | 2;
    titulo: string;
    subtitulo: string;
    rota: string;
    auto: boolean;
  }> = [
    {
      id: 'etapa_2',
      numero: 2,
      fase: 1,
      titulo: 'Simular 1º Orçamento Personalizado',
      subtitulo: 'Monte uma proposta profissional para enviar no WhatsApp do cliente',
      rota: input.orcamentosCount === 0 ? '/orcamentos?novo=1' : '/orcamentos',
      auto: orcamentoAuto,
    },
    {
      id: 'etapa_3',
      numero: 3,
      fase: 1,
      titulo: 'Personalizar Nome, Logo e Porte da Estética',
      subtitulo: 'Deixe orçamentos, PDFs e a Vitrine com a cara da sua estética',
      rota: '/configuracoes?aba=oficina',
      auto: oficinaAuto,
    },
    {
      id: 'etapa_4',
      numero: 4,
      fase: 1,
      titulo: 'Revisar Preços e Serviços da Região',
      subtitulo: 'Os serviços vieram com médias nacionais — ajuste à sua tabela',
      rota: '/servicos',
      auto: servicosAuto,
    },
    {
      id: 'etapa_5',
      numero: 5,
      fase: 2,
      titulo: 'Horários, Capacidade e Vistoria',
      subtitulo: 'Defina expediente, quantos carros atende por hora e regra de check-in',
      rota: '/configuracoes?aba=horarios',
      auto: horariosAuto,
    },
    {
      id: 'etapa_6',
      numero: 6,
      fase: 2,
      titulo: 'Termos da Oficina e Garantias (CDC)',
      subtitulo: 'Resguarde sua estética contra danos preexistentes e falhas ocultas',
      rota: '/configuracoes?aba=termos',
      auto: termosAuto,
    },
    {
      id: 'etapa_7',
      numero: 7,
      fase: 2,
      titulo: 'Vitrine Online e Sinal Pix',
      subtitulo: 'Receba agendamentos no seu link público e peça sinal via Pix sem taxas',
      rota: '/configuracoes?aba=agendamento',
      auto: vitrineAuto,
    },
    {
      id: 'etapa_8',
      numero: 8,
      fase: 2,
      titulo: 'Equipe e Comissões',
      subtitulo: isFree
        ? 'Você trabalha sozinho ou tem equipe? (Plano Free inclui 1 acesso do dono)'
        : 'Convide operadores ou confirme se atende sozinho no estúdio',
      rota: '/configuracoes?aba=equipe',
      auto: equipeAuto,
    },
  ];

  const etapas: EtapaOnboardingCalculada[] = etapaDefs.map((def) => {
    const concluidaManual = manual[def.id] === true;
    const concluidaAuto = def.auto;
    return {
      id: def.id,
      numero: def.numero,
      fase: def.fase,
      titulo: def.titulo,
      subtitulo: def.subtitulo,
      rota: def.rota,
      concluida: concluidaAuto || concluidaManual,
      concluidaAuto,
      concluidaManual,
    };
  });

  const basePercentual = 16;
  const percentualPorEtapa = 12;
  const etapasConcluidas = etapas.filter((e) => e.concluida).length;
  const porcentagem = Math.min(100, basePercentual + etapasConcluidas * percentualPorEtapa);
  const fase1Concluida = etapas.filter((e) => e.fase === 1).every((e) => e.concluida);
  const tudoConcluido = etapasConcluidas === etapas.length && porcentagem === 100;

  const servicosLabel =
    input.servicosCount === 1
      ? '1 serviço padrão carregado'
      : `${input.servicosCount} serviços padrão carregados`;

  const etapa1Texto =
    input.servicosCount > 0
      ? `Conta criada e ${servicosLabel} (com valores médios sugeridos)`
      : 'Conta criada e estrutura base pré-configurada';

  return {
    basePercentual,
    percentualPorEtapa,
    porcentagem,
    totalEtapasExtras: etapas.length,
    etapasConcluidas,
    fase1Concluida,
    tudoConcluido,
    etapa1Texto,
    etapas,
  };
}

