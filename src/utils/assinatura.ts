import { formatarData, formatarDataIsoSP } from './datas';

export interface CortesiaDuracaoOpcao {
  id: string;
  label: string;
  dias: number | null;
  descricao: string;
}

export const CORTESIA_DURACAO_OPCOES: readonly CortesiaDuracaoOpcao[] = [
  { id: '15d', label: '15 dias', dias: 15, descricao: 'Cortesia temporária de 15 dias' },
  { id: '30d', label: '30 dias', dias: 30, descricao: 'Cortesia temporária de 1 mês (30 dias)' },
  { id: '90d', label: '3 meses', dias: 90, descricao: 'Cortesia temporária de 3 meses (90 dias)' },
  { id: '180d', label: '6 meses', dias: 180, descricao: 'Cortesia temporária de 6 meses (180 dias)' },
  { id: '365d', label: '1 ano', dias: 365, descricao: 'Cortesia temporária de 1 ano (365 dias)' },
  { id: 'vitalicia', label: 'Sem prazo', dias: null, descricao: 'Cortesia vitalícia sem expiração automática' },
] as const;

export function obterDataAtualIsoSP(now: Date = new Date()): string {
  return formatarDataIsoSP(now);
}

export function adicionarDiasIsoSP(dataBaseIso: string, dias: number): string {
  if (!dataBaseIso || !/^\d{4}-\d{2}-\d{2}$/.test(dataBaseIso) || !Number.isFinite(dias)) {
    return '';
  }
  const [y, m, d] = dataBaseIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + Math.trunc(dias)));
  const ano = dt.getUTCFullYear();
  const mes = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dia = String(dt.getUTCDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

export function calcularDataFimCortesiaISO(
  dias: number | null | undefined,
  dataBaseIso?: string
): string | null {
  if (dias === null || dias === undefined || !Number.isFinite(dias) || dias <= 0) {
    return null;
  }
  const base = dataBaseIso || obterDataAtualIsoSP();
  const res = adicionarDiasIsoSP(base, Math.trunc(dias));
  return res || null;
}

export function calcularDiasRestantesISO(
  dataFimIso: string | null | undefined,
  hojeIso?: string
): number | null {
  if (!dataFimIso || !/^\d{4}-\d{2}-\d{2}/.test(dataFimIso)) {
    return null;
  }
  const alvo = dataFimIso.slice(0, 10);
  const base = (hojeIso || obterDataAtualIsoSP()).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(alvo) || !/^\d{4}-\d{2}-\d{2}$/.test(base)) {
    return null;
  }
  const [ay, am, ad] = alvo.split('-').map(Number);
  const [by, bm, bd] = base.split('-').map(Number);
  const diffMs = Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd);
  const diffDias = Math.round(diffMs / 86400000);
  return diffDias < 0 ? 0 : diffDias;
}

export function formatarDataSegura(ts: string | null | undefined): string {
  if (!ts) return '—';
  const res = formatarData(ts);
  return res || '—';
}

export function podeCancelarAssinaturaNoAsaas(ass?: {
  status?: string | null;
  cancelada_em?: string | null;
  asaas_subscription_id?: string | null;
} | null): boolean {
  if (!ass) return false;
  if (ass.status === 'cancelada' || ass.status === 'cortesia' || ass.status === 'trial') return false;
  if (ass.cancelada_em) return false;
  return Boolean(ass.asaas_subscription_id && ass.asaas_subscription_id.trim());
}

export interface ResumoStatusAssinatura {
  statusEfetivo: 'ativa' | 'trial' | 'cortesia' | 'atrasada' | 'cancelada';
  tone: 'mint' | 'amber' | 'flare' | 'glass';
  label: string;
  isCortesia: boolean;
}

export function obterResumoStatusAssinatura(
  status?: string | null,
  opts?: { isCortesia?: boolean | null; plano?: string | null }
): ResumoStatusAssinatura {
  const plano = (opts?.plano || '').toLowerCase();
  const ehCortesia = status === 'cortesia' || (Boolean(opts?.isCortesia) && plano !== 'free');

  if (ehCortesia) {
    return {
      statusEfetivo: 'cortesia',
      tone: 'mint',
      label: 'CORTESIA ADMIN',
      isCortesia: true,
    };
  }

  if (status === 'ativa' && plano !== 'free') {
    return {
      statusEfetivo: 'ativa',
      tone: 'mint',
      label: 'ATIVA (REGULAR)',
      isCortesia: false,
    };
  }

  if (status === 'trial') {
    return {
      statusEfetivo: 'trial',
      tone: 'amber',
      label: 'EM DEGUSTAÇÃO (TRIAL)',
      isCortesia: false,
    };
  }

  if (status === 'atrasada') {
    return {
      statusEfetivo: 'atrasada',
      tone: 'flare',
      label: 'PAGAMENTO EM ATRASO',
      isCortesia: false,
    };
  }

  return {
    statusEfetivo: 'cancelada',
    tone: 'glass',
    label: plano === 'free' ? 'PLANO GRATUITO' : 'CANCELADA',
    isCortesia: false,
  };
}
