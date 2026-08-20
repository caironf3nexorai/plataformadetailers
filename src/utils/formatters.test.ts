import { describe, it, expect } from 'vitest';
import { formatPlaca, formatTelefone, cleanTelefone, formatarOS, extrairNumeroOS } from './formatters';

describe('formatPlaca', () => {
  it('deve formatar placa Mercosul sem hífen (5º caractere é letra)', () => {
    expect(formatPlaca('JHC4A80')).toBe('JHC4A80');
    expect(formatPlaca('jhc4a80')).toBe('JHC4A80');
    expect(formatPlaca('JHC-4A80')).toBe('JHC4A80');
  });

  it('deve formatar placa tradicional com hífen (5º caractere é dígito)', () => {
    expect(formatPlaca('ABC1234')).toBe('ABC-1234');
    expect(formatPlaca('abc1234')).toBe('ABC-1234');
    expect(formatPlaca('ABC-1234')).toBe('ABC-1234');
  });

  it('deve lidar com strings parciais ou vazias', () => {
    expect(formatPlaca('')).toBe('');
    expect(formatPlaca('ABC')).toBe('ABC');
    expect(formatPlaca('ABC1')).toBe('ABC-1');
  });
});

describe('formatTelefone', () => {
  it('deve formatar telefones celulares de 11 dígitos', () => {
    expect(formatTelefone('11999998888')).toBe('(11) 99999-8888');
  });

  it('deve formatar telefones fixos de 10 dígitos', () => {
    expect(formatTelefone('1133334444')).toBe('(11) 3333-4444');
  });
});

describe('cleanTelefone', () => {
  it('deve remover caracteres não numéricos', () => {
    expect(cleanTelefone('(11) 99999-8888')).toBe('11999998888');
  });
});

describe('formatarOS', () => {
  it('deve formatar número inteiro com 4 dígitos por padrão', () => {
    expect(formatarOS(42)).toBe('OS 0042');
    expect(formatarOS(130)).toBe('OS 0130');
    expect(formatarOS(1)).toBe('OS 0001');
    expect(formatarOS(9999)).toBe('OS 9999');
  });

  it('deve formatar números com mais de 4 dígitos sem truncar', () => {
    expect(formatarOS(10005)).toBe('OS 10005');
  });

  it('deve retornar OS ---- para valores nulos, indefidos ou <= 0', () => {
    expect(formatarOS(null)).toBe('OS ----');
    expect(formatarOS(undefined)).toBe('OS ----');
    expect(formatarOS(0)).toBe('OS ----');
    expect(formatarOS(-5)).toBe('OS ----');
  });
});

describe('extrairNumeroOS', () => {
  it('deve extrair o número de OS de diferentes formatos de busca', () => {
    expect(extrairNumeroOS('42')).toBe(42);
    expect(extrairNumeroOS('0042')).toBe(42);
    expect(extrairNumeroOS('OS 42')).toBe(42);
    expect(extrairNumeroOS('os 0130')).toBe(130);
    expect(extrairNumeroOS('OS0003')).toBe(3);
  });

  it('deve retornar null para termos sem números', () => {
    expect(extrairNumeroOS('Lavagem')).toBeNull();
    expect(extrairNumeroOS('')).toBeNull();
  });
});


