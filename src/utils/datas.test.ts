import { describe, it, expect } from 'vitest';
import { 
  formatarHora, 
  formatarData, 
  formatarDataHora, 
  formatarIntervalo, 
  calcularTermino,
  formatarDataIsoSP,
  montarTimestampLocal
} from './datas';

describe('Utilitários de Data e Hora (America/Sao_Paulo)', () => {
  it('montarTimestampLocal deve normalizar horarios HH:MM e HH:MM:SS com offset -03:00', () => {
    expect(montarTimestampLocal('2026-08-28', '16:00:00')).toBe('2026-08-28T16:00:00-03:00');
    expect(montarTimestampLocal('2026-08-28', '16:00')).toBe('2026-08-28T16:00:00-03:00');
  });

  it('formatarHora deve converter timestamp UTC para hora local em America/Sao_Paulo', () => {
    expect(formatarHora('2026-08-04T11:00:00Z')).toBe('08:00');
  });

  it('formatarData deve converter timestamp UTC para data local em America/Sao_Paulo', () => {
    expect(formatarData('2026-08-04T11:00:00Z')).toBe('04/08/2026');
  });

  it('formatarIntervalo deve calcular inicio e termino no fuso local', () => {
    expect(formatarIntervalo('2026-08-04T11:00:00Z', 480)).toBe('08:00 — 16:00');
    expect(formatarIntervalo('2026-08-03T12:30:00Z', 40)).toBe('09:30 — 10:10');
  });

  it('um horário perto da meia-noite UTC deve refletir o dia local correto', () => {
    // 01:00 UTC do dia 04/08 é 22:00 do dia 03/08 em America/Sao_Paulo
    const ts = '2026-08-04T01:00:00Z';
    expect(formatarData(ts)).toBe('03/08/2026');
    expect(formatarHora(ts)).toBe('22:00');
    expect(formatarDataHora(ts)).toBe('03/08/2026 22:00');
    expect(formatarDataIsoSP(ts)).toBe('2026-08-03');
  });

  it('calcularTermino deve adicionar os minutos corretamente', () => {
    const inicio = new Date('2026-08-04T11:00:00Z');
    const fim = calcularTermino(inicio, 120);
    expect(fim.toISOString()).toBe('2026-08-04T13:00:00.000Z');
  });
});
