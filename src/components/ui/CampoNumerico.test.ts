import { describe, it, expect } from 'vitest';
import { formatarValorNumerico } from './CampoNumerico';

describe('CampoNumerico - formatarValorNumerico', () => {
  describe('comportamento padrão (allowZero = false)', () => {
    it('retorna string vazia para valores nulos, vazios ou indefinidos', () => {
      expect(formatarValorNumerico(null)).toBe('');
      expect(formatarValorNumerico(undefined)).toBe('');
      expect(formatarValorNumerico('')).toBe('');
    });

    it('retorna string vazia quando valor é 0 numérico ou "0" string para exibir placeholder/marca-dágua', () => {
      expect(formatarValorNumerico(0)).toBe('');
      expect(formatarValorNumerico('0')).toBe('');
      expect(formatarValorNumerico('0,00')).toBe('');
    });

    it('formata números positivos com separador decimal em vírgula', () => {
      expect(formatarValorNumerico(150)).toBe('150');
      expect(formatarValorNumerico(12.5)).toBe('12,5');
      expect(formatarValorNumerico('99.90')).toBe('99,90');
      expect(formatarValorNumerico('99,90')).toBe('99,90');
    });
  });

  describe('comportamento com allowZero = true (cortesias e brindes)', () => {
    it('retorna "0,00" para número 0 decimal', () => {
      expect(formatarValorNumerico(0, true, false)).toBe('0,00');
      expect(formatarValorNumerico('0', true, false)).toBe('0,00');
      expect(formatarValorNumerico('0,00', true, false)).toBe('0,00');
    });

    it('retorna "0" para integerOnly com allowZero = true', () => {
      expect(formatarValorNumerico(0, true, true)).toBe('0');
      expect(formatarValorNumerico('0', true, true)).toBe('0');
    });

    it('retorna string vazia para null ou undefined mesmo se allowZero = true', () => {
      expect(formatarValorNumerico(null, true)).toBe('');
      expect(formatarValorNumerico(undefined, true)).toBe('');
      expect(formatarValorNumerico('', true)).toBe('');
    });

    it('preserva valores maiores que zero normalmente', () => {
      expect(formatarValorNumerico(50, true)).toBe('50');
      expect(formatarValorNumerico(25.5, true)).toBe('25,5');
    });
  });
});

