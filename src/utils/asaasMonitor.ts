export interface AsaasWebhookItem {
  id: string;
  name: string;
  url: string;
  email: string | null;
  enabled: boolean;
  interrupted: boolean;
  apiVersion?: number;
  sendType?: string;
  events: string[];
}

export interface HistoricoMonitoramentoAsaas {
  id: string;
  origem: 'admin' | 'cron';
  acao: 'status' | 'reativar' | 'reconciliar';
  executado_por: string | null;
  webhook_saudavel: boolean;
  webhooks_total: number;
  webhooks_interrompidos: number;
  pagamentos_analisados: number;
  acoes_aplicadas: number;
  erros_count: number;
  resumo_mensagem: string;
  created_at: string;
}

export type NivelSaudeWebhook = 'saudavel' | 'interrompido' | 'sem_webhook' | 'desconhecido';

export interface DiagnosticoSaudeWebhook {
  nivel: NivelSaudeWebhook;
  titulo: string;
  descricao: string;
  precisaReativar: boolean;
}

/**
 * Classifica o estado geral de saúde dos webhooks Asaas com base na consulta ao vivo
 * ou na última checagem persistida no banco.
 */
export function classificarSaudeWebhookAsaas(params: {
  webhooksAoVivo?: AsaasWebhookItem[] | null;
  ultimaChecagem?: Pick<
    HistoricoMonitoramentoAsaas,
    'webhook_saudavel' | 'webhooks_total' | 'webhooks_interrompidos' | 'resumo_mensagem'
  > | null;
}): DiagnosticoSaudeWebhook {
  const { webhooksAoVivo, ultimaChecagem } = params;

  if (Array.isArray(webhooksAoVivo)) {
    if (webhooksAoVivo.length === 0) {
      return {
        nivel: 'sem_webhook',
        titulo: 'Nenhum webhook configurado no Asaas',
        descricao: 'Cadastre a URL da Edge Function asaas-webhook no painel do Asaas para receber eventos.',
        precisaReativar: false,
      };
    }

    const interrompidos = webhooksAoVivo.filter((w) => w.interrupted || !w.enabled);
    if (interrompidos.length > 0) {
      return {
        nivel: 'interrompido',
        titulo: `${interrompidos.length} webhook(s) interrompido(s) no Asaas`,
        descricao:
          'A fila de entrega do Asaas está pausada ou desabilitada. Clique em "Reativar Fila Agora" para despausar.',
        precisaReativar: true,
      };
    }

    return {
      nivel: 'saudavel',
      titulo: `${webhooksAoVivo.length} webhook(s) ativo(s) e saudável(is)`,
      descricao: 'Fila de sincronização ativa no Asaas e pronta para entregar eventos em tempo real.',
      precisaReativar: false,
    };
  }

  if (ultimaChecagem) {
    if (ultimaChecagem.webhooks_interrompidos > 0) {
      return {
        nivel: 'interrompido',
        titulo: 'Webhook interrompido na última verificação',
        descricao: ultimaChecagem.resumo_mensagem,
        precisaReativar: true,
      };
    }
    if (ultimaChecagem.webhooks_total === 0) {
      return {
        nivel: 'sem_webhook',
        titulo: 'Nenhum webhook detectado',
        descricao: ultimaChecagem.resumo_mensagem,
        precisaReativar: false,
      };
    }
    if (ultimaChecagem.webhook_saudavel) {
      return {
        nivel: 'saudavel',
        titulo: 'Webhook saudável na última verificação',
        descricao: ultimaChecagem.resumo_mensagem,
        precisaReativar: false,
      };
    }
  }

  return {
    nivel: 'desconhecido',
    titulo: 'Status ainda não verificado ao vivo',
    descricao: 'Clique em "Verificar Agora" para consultar a fila de webhooks diretamente na API do Asaas.',
    precisaReativar: false,
  };
}

/** Calcula data ISO YYYY-MM-DD deslocada em dias (útil para filtros padrão de reconciliação) */
export function calcularDataIsoDeslocada(offsetDias: number, referencia: Date = new Date()): string {
  const alvo = new Date(referencia.getTime() + offsetDias * 86400000);
  const ano = alvo.getFullYear();
  const mes = String(alvo.getMonth() + 1).padStart(2, '0');
  const dia = String(alvo.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

export function formatarDataHoraPtBr(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
