import type { AgendamentoStatus } from '../types/agenda';
import { formatarHora, calcularTermino as calcularTerminoDate } from './datas';

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

export function formatarDuracao(minutos: number): string {
  if (!minutos || minutos <= 0) return '0 min';
  const horas = Math.floor(minutos / 60);
  const mins = minutos % 60;
  if (horas === 0) return `${mins}min`;
  if (mins === 0) return `${horas}h 00min`;
  return `${horas}h ${mins < 10 ? '0' : ''}${mins}min`;
}

