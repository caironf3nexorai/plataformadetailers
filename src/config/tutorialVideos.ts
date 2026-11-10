import type { EtapaOnboardingId } from '../utils/onboarding';

export interface ConfigTutorialVideo {
  id: string;
  titulo: string;
  descricao: string;
  /** Cole aqui a URL do vídeo (YouTube, Vimeo ou MP4/Supabase Storage). */
  url: string;
  /** Segundo inicial opcional para iniciar em um trecho específico do vídeo. */
  tempoInicial?: number;
  /** Segundo final opcional para encerrar automaticamente o trecho curto. */
  tempoFinal?: number;
  rotaDestino: string;
  labelBotao: string;
}

export interface TutorialEtapaOverride {
  url?: string;
  tempoInicial?: number;
  tempoFinal?: number;
}

export interface PlataformaVideosConfig {
  video_onboarding_url?: string | null;
  video_onboarding_titulo?: string | null;
  video_onboarding_ativo?: boolean | null;
  videos_tutoriais_etapas?: Partial<Record<EtapaOnboardingId | 'boas_vindas', TutorialEtapaOverride>> | null;
}

export const ETAPAS_TUTORIAIS_ORDEM: EtapaOnboardingId[] = [
  'etapa_2',
  'etapa_3',
  'etapa_4',
  'etapa_5',
  'etapa_6',
  'etapa_7',
  'etapa_8',
];

/**
 * Configuração central e fácil de editar para os vídeos curtos do Onboarding Progressivo.
 * Os links e trechos também podem ser configurados sem código no Painel Admin (Campanhas & Trial).
 */
export const TUTORIAL_VIDEOS: {
  boasVindasFallback: {
    url: string;
    titulo: string;
    tempoInicial?: number;
    tempoFinal?: number;
  };
  etapas: Record<EtapaOnboardingId, ConfigTutorialVideo>;
} = {
  boasVindasFallback: {
    url: '',
    titulo: 'Bem-vindo ao Nuvem Wash (60s)',
    tempoInicial: 0,
    tempoFinal: undefined,
  },
  etapas: {
    etapa_2: {
      id: 'etapa_2',
      titulo: 'Como criar e enviar seu 1º Orçamento',
      descricao:
        'Veja em 30s como selecionar veículo, escolher serviços pré-carregados e gerar o link profissional para o WhatsApp.',
      url: '',
      tempoInicial: 0,
      tempoFinal: undefined,
      rotaDestino: '/orcamentos?novo=1',
      labelBotao: 'Ir para esta configuração agora',
    },
    etapa_3: {
      id: 'etapa_3',
      titulo: 'Personalizar Nome, Logo e Porte da Estética',
      descricao:
        'Coloque sua marca nos PDFs, na Vitrine Online e calibre a referência regional da sua cidade.',
      url: '',
      tempoInicial: 0,
      tempoFinal: undefined,
      rotaDestino: '/configuracoes?aba=oficina',
      labelBotao: 'Ir para esta configuração agora',
    },
    etapa_4: {
      id: 'etapa_4',
      titulo: 'Revisar Preços e Serviços da sua Região',
      descricao:
        'A oficina já nasce com serviços e preços médios sugeridos. Aprenda a ajustar seus valores em segundos na matriz.',
      url: '',
      tempoInicial: 0,
      tempoFinal: undefined,
      rotaDestino: '/servicos',
      labelBotao: 'Ir para esta configuração agora',
    },
    etapa_5: {
      id: 'etapa_5',
      titulo: 'Configurar Horários, Capacidade e Vistoria',
      descricao:
        'Ajuste os dias de funcionamento, boxes simultâneos por hora e defina se a vistoria de entrada é obrigatória.',
      url: '',
      tempoInicial: 0,
      tempoFinal: undefined,
      rotaDestino: '/configuracoes?aba=horarios',
      labelBotao: 'Ir para esta configuração agora',
    },
    etapa_6: {
      id: 'etapa_6',
      titulo: 'Blindar a Estética com Termos e Garantias (CDC)',
      descricao:
        'Ative em 1 clique a minuta jurídica de responsabilidade e falhas ocultas para proteger sua operação.',
      url: '',
      tempoInicial: 0,
      tempoFinal: undefined,
      rotaDestino: '/configuracoes?aba=termos',
      labelBotao: 'Ir para esta configuração agora',
    },
    etapa_7: {
      id: 'etapa_7',
      titulo: 'Ativar Vitrine Online e Sinal Pix sem Taxas',
      descricao:
        'Libere o agendamento online 24h com sua Chave Pix direta para reduzir faltas (No-Show).',
      url: '',
      tempoInicial: 0,
      tempoFinal: undefined,
      rotaDestino: '/configuracoes?aba=agendamento',
      labelBotao: 'Ir para esta configuração agora',
    },
    etapa_8: {
      id: 'etapa_8',
      titulo: 'Equipe, Cargos e Comissões',
      descricao:
        'Veja como convidar operadores com acesso restrito, configurar comissões ou marcar que você trabalha sozinho.',
      url: '',
      tempoInicial: 0,
      tempoFinal: undefined,
      rotaDestino: '/configuracoes?aba=equipe',
      labelBotao: 'Ir para esta configuração agora',
    },
  },
};

/**
 * Resolve o vídeo de boas-vindas combinando a configuração salva no Painel Admin
 * (tabela `plataforma_config`) com o fallback local de `TUTORIAL_VIDEOS`.
 */
export function resolverVideoBoasVindas(configRemota?: PlataformaVideosConfig | null): {
  url: string;
  titulo: string;
  ativo: boolean;
  tempoInicial?: number;
  tempoFinal?: number;
} {
  const overrideBv = configRemota?.videos_tutoriais_etapas?.boas_vindas;
  const urlAdmin = configRemota?.video_onboarding_url?.trim();
  const ativo =
    typeof configRemota?.video_onboarding_ativo === 'boolean'
      ? configRemota.video_onboarding_ativo
      : true;

  return {
    url: urlAdmin || TUTORIAL_VIDEOS.boasVindasFallback.url || '',
    titulo:
      configRemota?.video_onboarding_titulo?.trim() ||
      TUTORIAL_VIDEOS.boasVindasFallback.titulo,
    ativo,
    tempoInicial:
      typeof overrideBv?.tempoInicial === 'number' && !Number.isNaN(overrideBv.tempoInicial)
        ? overrideBv.tempoInicial
        : TUTORIAL_VIDEOS.boasVindasFallback.tempoInicial,
    tempoFinal:
      typeof overrideBv?.tempoFinal === 'number' && !Number.isNaN(overrideBv.tempoFinal)
        ? overrideBv.tempoFinal
        : TUTORIAL_VIDEOS.boasVindasFallback.tempoFinal,
  };
}

/**
 * Mescla os tutoriais curtos configurados no Painel Admin (`videos_tutoriais_etapas`)
 * sobre os valores padrão definidos em `TUTORIAL_VIDEOS.etapas`.
 */
export function resolverTutoriaisEtapas(
  configRemota?: PlataformaVideosConfig | null
): Record<EtapaOnboardingId, ConfigTutorialVideo> {
  const overrides = configRemota?.videos_tutoriais_etapas || {};
  const resultado = {} as Record<EtapaOnboardingId, ConfigTutorialVideo>;

  for (const etapaId of ETAPAS_TUTORIAIS_ORDEM) {
    const base = TUTORIAL_VIDEOS.etapas[etapaId];
    const ov = overrides?.[etapaId];
    const urlRemota = typeof ov?.url === 'string' ? ov.url.trim() : '';

    resultado[etapaId] = {
      ...base,
      url: urlRemota || base.url || '',
      tempoInicial:
        typeof ov?.tempoInicial === 'number' && !Number.isNaN(ov.tempoInicial)
          ? ov.tempoInicial
          : base.tempoInicial,
      tempoFinal:
        typeof ov?.tempoFinal === 'number' && !Number.isNaN(ov.tempoFinal)
          ? ov.tempoFinal
          : base.tempoFinal,
    };
  }

  return resultado;
}


