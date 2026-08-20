import { describe, it, expect } from 'vitest';
import { 
  traduzirMotivoIndisponivel, 
  getLabelFromStatus, 
  getBadgeToneFromStatus, 
  calcularTermino,
  formatarHoraCurta,
  getNomeDiaSemana
} from './agenda';

describe('Agenda Utilities', () => {
  it('traduz motivos de indisponibilidade em português', () => {
    expect(traduzirMotivoIndisponivel('nao_cabe_no_expediente')).toBe('Excede o horário de expediente');
    expect(traduzirMotivoIndisponivel('bloqueado')).toBe('Horário bloqueado');
    expect(traduzirMotivoIndisponivel('passado')).toBe('Horário já passou');
    expect(traduzirMotivoIndisponivel('dia_reservado')).toBe('Dia reservado para serviço exclusivo');
    expect(traduzirMotivoIndisponivel('sem_box_livre')).toBe('Sem box livre neste horário');
    expect(traduzirMotivoIndisponivel(null)).toBe('Indisponível');
  });

  it('retorna labels de status legíveis', () => {
    expect(getLabelFromStatus('agendado')).toBe('Agendado');
    expect(getLabelFromStatus('confirmado')).toBe('Confirmado');
    expect(getLabelFromStatus('em_andamento')).toBe('Em andamento');
    expect(getLabelFromStatus('concluido')).toBe('Concluído');
    expect(getLabelFromStatus('cancelado')).toBe('Cancelado');
    expect(getLabelFromStatus('nao_compareceu')).toBe('Não compareceu');
  });

  it('retorna tons visuais por status', () => {
    expect(getBadgeToneFromStatus('agendado')).toBe('vapor');
    expect(getBadgeToneFromStatus('em_andamento')).toBe('amber');
    expect(getBadgeToneFromStatus('concluido')).toBe('mint');
    expect(getBadgeToneFromStatus('cancelado')).toBe('flare');
  });

  it('calcula o horário de término corretamente', () => {
    // 2026-08-01T08:00:00.000Z -> adiciona 90 minutos
    const inicio = '2026-08-01T08:00:00.000Z';
    const termino = calcularTermino(inicio, 90);
    expect(termino).toMatch(/^\d{2}:\d{2}$/);
  });

  it('formata horários de string HH:mm:ss para HH:mm', () => {
    expect(formatarHoraCurta('08:00:00')).toBe('08:00');
    expect(formatarHoraCurta('14:30')).toBe('14:30');
  });

  it('retorna o nome do dia da semana em português', () => {
    expect(getNomeDiaSemana(0)).toBe('Domingo');
    expect(getNomeDiaSemana(1)).toBe('Segunda-feira');
    expect(getNomeDiaSemana(6)).toBe('Sábado');
  });
});
