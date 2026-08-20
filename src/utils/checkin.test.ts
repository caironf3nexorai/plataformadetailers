import { describe, it, expect } from 'vitest';
import {
  clampedPercentage,
  formatarNivelCombustivel,
  formatarNomeAvaria,
  formatarNomeVista,
  formatarSujidade,
  formatarIluminacao,
  formatarFluido,
} from './checkin';

describe('checkin utils', () => {
  it('clampedPercentage limita entre 0 e 100', () => {
    expect(clampedPercentage(-15)).toBe(0);
    expect(clampedPercentage(50.456)).toBe(50.46);
    expect(clampedPercentage(150)).toBe(100);
    expect(clampedPercentage(NaN)).toBe(0);
  });

  it('formatarNivelCombustivel converte oitavos corretamente', () => {
    expect(formatarNivelCombustivel(0)).toBe('E (Vazio)');
    expect(formatarNivelCombustivel(4)).toBe('1/2 (Meio)');
    expect(formatarNivelCombustivel(8)).toBe('F (Cheio)');
    expect(formatarNivelCombustivel(null)).toBe('Não informado');
  });

  it('formatarNomeAvaria formata os tipos corretamente', () => {
    expect(formatarNomeAvaria('risco')).toBe('Risco');
    expect(formatarNomeAvaria('amassado')).toBe('Amassado');
    expect(formatarNomeAvaria('avariado')).toBe('Avariado');
    expect(formatarNomeAvaria('faltante')).toBe('Faltante');
  });

  it('formatarNomeVista formata as vistas corretamente', () => {
    expect(formatarNomeVista('frente')).toBe('Frente');
    expect(formatarNomeVista('lateral_esquerda')).toBe('Lateral Esquerda');
    expect(formatarNomeVista('superior')).toBe('Vista Superior');
  });

  it('formatarSujidade, formatarIluminacao e formatarFluido retornam rótulos amigáveis', () => {
    expect(formatarSujidade('extremo')).toBe('Extremo');
    expect(formatarIluminacao('queimado')).toBe('Queimado');
    expect(formatarFluido('baixo')).toBe('Baixo');
  });
});
