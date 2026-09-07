import { describe, it, expect } from 'vitest';
import {
  converterParaMinutos,
  converterDeMinutos,
  detectarUnidadeSugerida,
  formatarDuracaoAmigavel,
} from './duracao';

describe('duracao utils', () => {
  describe('converterParaMinutos', () => {
    it('converte minutos corretamente', () => {
      expect(converterParaMinutos(45, 'min')).toBe(45);
      expect(converterParaMinutos(0, 'min')).toBe(0);
    });

    it('converte horas para minutos (1h = 60min)', () => {
      expect(converterParaMinutos(1, 'horas')).toBe(60);
      expect(converterParaMinutos(2.5, 'horas')).toBe(150);
      expect(converterParaMinutos(4, 'horas')).toBe(240);
    });

    it('converte dias para minutos (1 dia = 480min / 8h de expediente)', () => {
      expect(converterParaMinutos(1, 'dias')).toBe(480);
      expect(converterParaMinutos(2, 'dias')).toBe(960);
      expect(converterParaMinutos(0.5, 'dias')).toBe(240);
    });
  });

  describe('converterDeMinutos', () => {
    it('converte de minutos para minutos', () => {
      expect(converterDeMinutos(45, 'min')).toBe(45);
    });

    it('converte de minutos para horas', () => {
      expect(converterDeMinutos(60, 'horas')).toBe(1);
      expect(converterDeMinutos(90, 'horas')).toBe(1.5);
      expect(converterDeMinutos(120, 'horas')).toBe(2);
    });

    it('converte de minutos para dias', () => {
      expect(converterDeMinutos(480, 'dias')).toBe(1);
      expect(converterDeMinutos(960, 'dias')).toBe(2);
      expect(converterDeMinutos(240, 'dias')).toBe(0.5);
    });
  });

  describe('detectarUnidadeSugerida', () => {
    it('respeita unidade salva se informada', () => {
      expect(detectarUnidadeSugerida(60, undefined, 'horas')).toBe('horas');
      expect(detectarUnidadeSugerida(480, undefined, 'min')).toBe('min');
    });

    it('sugere dias para modo multiplos_dias ou dia_inteiro', () => {
      expect(detectarUnidadeSugerida(120, 'multiplos_dias')).toBe('dias');
      expect(detectarUnidadeSugerida(120, 'dia_inteiro')).toBe('dias');
    });

    it('sugere dias para múltiplos exatos de 480 min', () => {
      expect(detectarUnidadeSugerida(480)).toBe('dias');
      expect(detectarUnidadeSugerida(960)).toBe('dias');
    });

    it('sugere horas para múltiplos exatos de 60 min', () => {
      expect(detectarUnidadeSugerida(60)).toBe('horas');
      expect(detectarUnidadeSugerida(180)).toBe('horas');
    });

    it('sugere minutos para outros valores', () => {
      expect(detectarUnidadeSugerida(45)).toBe('min');
      expect(detectarUnidadeSugerida(90)).toBe('min');
    });
  });

  describe('formatarDuracaoAmigavel', () => {
    it('formata 0 ou negativo como 0 min', () => {
      expect(formatarDuracaoAmigavel(0)).toBe('0 min');
    });

    it('formata minutos avulsos', () => {
      expect(formatarDuracaoAmigavel(45)).toBe('45 min');
    });

    it('formata horas cheias', () => {
      expect(formatarDuracaoAmigavel(60)).toBe('1h');
      expect(formatarDuracaoAmigavel(120)).toBe('2h');
    });

    it('formata horas e minutos compostos', () => {
      expect(formatarDuracaoAmigavel(90)).toBe('1h 30min');
      expect(formatarDuracaoAmigavel(75)).toBe('1h 15min');
    });

    it('formata dias cheios', () => {
      expect(formatarDuracaoAmigavel(480)).toBe('1 dia');
      expect(formatarDuracaoAmigavel(960)).toBe('2 dias');
      expect(formatarDuracaoAmigavel(3360)).toBe('7 dias');
      expect(formatarDuracaoAmigavel(480, 'dias')).toBe('1 dia');
      expect(formatarDuracaoAmigavel(3360, 'dias')).toBe('7 dias');
    });

    it('formata dias com horas remanescentes', () => {
      expect(formatarDuracaoAmigavel(600)).toBe('1 dia e 2h');
      expect(formatarDuracaoAmigavel(510)).toBe('1 dia e 30min');
      expect(formatarDuracaoAmigavel(570)).toBe('1 dia e 1h 30min');
    });
  });
});
