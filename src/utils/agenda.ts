import type { AgendamentoStatus } from '../types/agenda';
import {
  formatarHora,
  formatarDataIsoSP,
  parseDateInput,
  calcularTermino as calcularTerminoDate,
} from './datas';
import { extrairNumeroOS } from './formatters';
import { formatarDuracaoAmigavel } from './duracao';

export type PeriodoListaFiltro = 'todos' | 'hoje' | 'semana' | 'mes' | 'personalizado';
export type VisaoAgendaModo = 'dia' | 'semana' | 'mes' | 'lista';

/**
 * Monta o link direto para localizar um agendamento específico na Agenda Completa.
 */
export function obterLinkAgendaAgendamento(
  agendamentoId?: string | null,
  inicioOuData?: string | null
): string {
  const params = new URLSearchParams();
  params.set('aba', 'agenda');

  const idLimpo = (agendamentoId || '').trim();
  if (idLimpo && idLimpo !== 'undefined' && idLimpo !== 'null') {
    params.set('agendamentoId', idLimpo);
  }

  if (inicioOuData) {
    const dataIso = formatarDataIsoSP(inicioOuData);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dataIso)) {
      params.set('data', dataIso);
    }
  }

  return `/agenda?${params.toString()}`;
}

/**
 * Calcula o intervalo YYYY-MM-DD (America/Sao_Paulo) para os filtros da visão Lista / Busca.
 * Quando período é 'todos', retorna null para buscar em todo o histórico/futuro.
 */
export function resolverPeriodoFiltroLista(
  periodo: PeriodoListaFiltro,
  dataInicioCustom?: string,
  dataFimCustom?: string,
  referenciaHoje: Date = new Date()
): { inicio: string | null; fim: string | null } {
  if (periodo === 'todos') {
    return { inicio: null, fim: null };
  }

  const hojeIso = formatarDataIsoSP(referenciaHoje);
  const baseSP = parseDateInput(hojeIso);

  if (periodo === 'personalizado') {
    const ini = (dataInicioCustom || '').trim() || hojeIso;
    const fimRaw = (dataFimCustom || '').trim() || ini;
    return ini <= fimRaw ? { inicio: ini, fim: fimRaw } : { inicio: fimRaw, fim: ini };
  }

  if (periodo === 'hoje') {
    return { inicio: hojeIso, fim: hojeIso };
  }

  if (periodo === 'semana') {
    const dayOfWeek = baseSP.getDay();
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(baseSP);
    monday.setDate(baseSP.getDate() + diffToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return {
      inicio: formatarDataIsoSP(monday),
      fim: formatarDataIsoSP(sunday),
    };
  }

  // 'mes'
  const year = baseSP.getFullYear();
  const month = baseSP.getMonth();
  const primeiroDia = new Date(year, month, 1, 12, 0, 0);
  const ultimoDia = new Date(year, month + 1, 0, 12, 0, 0);
  return {
    inicio: formatarDataIsoSP(primeiroDia),
    fim: formatarDataIsoSP(ultimoDia),
  };
}

/**
 * Calcula o intervalo YYYY-MM-DD (America/Sao_Paulo) para as visões de calendário (Dia / Semana / Mês).
 */
export function resolverPeriodoVisaoCalendario(
  viewMode: 'dia' | 'semana' | 'mes',
  selectedDate: Date
): { inicio: string; fim: string } {
  const refIso = formatarDataIsoSP(selectedDate) || formatarDataIsoSP(new Date());
  const refSP = parseDateInput(refIso);

  if (viewMode === 'dia') {
    return { inicio: refIso, fim: refIso };
  }

  if (viewMode === 'semana') {
    const dayOfWeek = refSP.getDay();
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(refSP);
    monday.setDate(refSP.getDate() + diffToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return {
      inicio: formatarDataIsoSP(monday),
      fim: formatarDataIsoSP(sunday),
    };
  }

  const year = refSP.getFullYear();
  const month = refSP.getMonth();
  const firstDay = new Date(year, month, 1, 12, 0, 0);
  const lastDay = new Date(year, month + 1, 0, 12, 0, 0);

  let startDayOfWeek = firstDay.getDay();
  if (startDayOfWeek === 0) startDayOfWeek = 7;
  const inicioGrid = new Date(year, month, 1 - (startDayOfWeek - 1), 12, 0, 0);

  let endDayOfWeek = lastDay.getDay();
  if (endDayOfWeek === 0) endDayOfWeek = 7;
  const diasExtrasFim = 7 - endDayOfWeek;
  const fimGrid = new Date(year, month, lastDay.getDate() + diasExtrasFim, 12, 0, 0);

  return {
    inicio: formatarDataIsoSP(inicioGrid),
    fim: formatarDataIsoSP(fimGrid),
  };
}

/**
 * Ordena os atendimentos de um dia em ordem cronológica (pernoite/continuação primeiro, seguido do horário inicial crescente).
 */
export function ordenarItensAgendaDia<
  T extends { ag: { inicio?: string | null }; papel: { isContinuacao: boolean } }
>(itens: T[]): T[] {
  return [...itens].sort((a, b) => {
    if (a.papel.isContinuacao !== b.papel.isContinuacao) {
      return a.papel.isContinuacao ? -1 : 1;
    }
    const ta = a.ag.inicio ? Date.parse(a.ag.inicio) : 0;
    const tb = b.ag.inicio ? Date.parse(b.ag.inicio) : 0;
    return (isNaN(ta) ? 0 : ta) - (isNaN(tb) ? 0 : tb);
  });
}

function normalizarTextoSimples(txt: string): string {
  return txt
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Fallback local de busca textual em agendamentos: OS, placa (com ou sem hífen), cliente, telefone (só dígitos ou formatado) e modelo/observações.
 */
export function agendamentoBateBuscaTexto(
  ag: {
    numero_os?: number | null;
    observacoes?: string | null;
    veiculo?: { placa?: string | null; modelo?: string | null; marca?: string | null } | null;
    cliente?: { nome?: string | null; telefone?: string | null } | null;
  },
  busca: string
): boolean {
  const termo = normalizarTextoSimples(busca);
  if (!termo) return true;

  const numOs = extrairNumeroOS(busca);
  if (numOs !== null && ag.numero_os === numOs) return true;

  const placaRaw = normalizarTextoSimples(ag.veiculo?.placa || '');
  const placaSemHifen = placaRaw.replace(/[^a-z0-9]/g, '');
  const termoAlnum = termo.replace(/[^a-z0-9]/g, '');
  if (placaRaw.includes(termo) || (termoAlnum.length >= 2 && placaSemHifen.includes(termoAlnum))) {
    return true;
  }

  const modelo = normalizarTextoSimples(ag.veiculo?.modelo || '');
  const marca = normalizarTextoSimples(ag.veiculo?.marca || '');
  if (modelo.includes(termo) || marca.includes(termo)) return true;

  const nomeCliente = normalizarTextoSimples(ag.cliente?.nome || '');
  if (nomeCliente.includes(termo)) return true;

  const telDigits = (ag.cliente?.telefone || '').replace(/\D/g, '');
  const termoDigits = busca.replace(/\D/g, '');
  if (
    (ag.cliente?.telefone || '').toLowerCase().includes(termo) ||
    (termoDigits.length >= 3 && telDigits.includes(termoDigits))
  ) {
    return true;
  }

  const obs = normalizarTextoSimples(ag.observacoes || '');
  return obs.includes(termo);
}

export function traduzirMotivoIndisponivel(motivo?: string | null): string {
  if (!motivo) return 'Indisponível';
  switch (motivo) {
    case 'nao_cabe_no_expediente':
      return 'Excede o horário de expediente';
    case 'bloqueado':
      return 'Horário bloqueado';
    case 'passado':
      return 'Horário já passou';
    case 'dia_reservado':
      return 'Dia reservado para serviço exclusivo';
    case 'sem_box_livre':
      return 'Sem box livre neste horário';
    case 'dia_inteiro':
      return 'Serviço de dia inteiro (selecione a 1ª vaga)';
    default:
      return 'Indisponível';
  }
}

export function getLabelFromStatus(status: AgendamentoStatus): string {
  switch (status) {
    case 'agendado':
      return 'Agendado';
    case 'aguardando_confirmacao':
      return 'Aguardando confirmação';
    case 'confirmado':
      return 'Confirmado';
    case 'em_andamento':
      return 'Em andamento';
    case 'concluido':
      return 'Concluído';
    case 'cancelado':
      return 'Cancelado';
    case 'nao_compareceu':
      return 'Não compareceu';
    default:
      return status;
  }
}

export function getBadgeToneFromStatus(status: AgendamentoStatus): 'vapor' | 'glass' | 'amber' | 'mint' | 'flare' {
  switch (status) {
    case 'agendado':
      return 'vapor';
    case 'aguardando_confirmacao':
      return 'amber';
    case 'confirmado':
      return 'glass';
    case 'em_andamento':
      return 'amber';
    case 'concluido':
      return 'mint';
    case 'cancelado':
      return 'flare';
    case 'nao_compareceu':
      return 'flare';
    default:
      return 'vapor';
  }
}


export function calcularTermino(inicioIso: string, duracaoMinutos: number): string {
  try {
    const end = calcularTerminoDate(inicioIso, duracaoMinutos);
    if (isNaN(end.getTime())) return '';
    return formatarHora(end);
  } catch {
    return '';
  }
}

export function formatarHoraCurta(horario: string): string {
  if (!horario) return '';
  const parts = horario.split(':');
  if (parts.length >= 2) {
    return `${parts[0]}:${parts[1]}`;
  }
  return horario;
}

export function getNomeDiaSemana(diaSemana: number): string {
  const dias = [
    'Domingo',
    'Segunda-feira',
    'Terça-feira',
    'Quarta-feira',
    'Quinta-feira',
    'Sexta-feira',
    'Sábado'
  ];
  return dias[diaSemana] || '';
}

export function formatarDuracao(minutos: number, unidadePreferida?: 'min' | 'horas' | 'dias'): string {
  return formatarDuracaoAmigavel(minutos, unidadePreferida);
}

