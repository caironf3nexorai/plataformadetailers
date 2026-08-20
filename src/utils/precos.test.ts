import { describe, it, expect } from 'vitest';
import { formatFaixaPreco, formatDuracao } from './precos';

describe('formatFaixaPreco', () => {
  it('deve retornar "Sob avaliação" se o serviço for sob consulta', () => {
    const precos = [40, 50, 90];
    const resultado = formatFaixaPreco(precos, true);
    expect(resultado).toBe('Sob avaliação');
  });

  it('deve retornar "Preço não definido" se a lista de preços estiver vazia ou com valores nulos', () => {
    const precosVazia: (number | null)[] = [];
    const precosNulos: (number | null)[] = [null, null, null];

    expect(formatFaixaPreco(precosVazia)).toBe('Preço não definido');
    expect(formatFaixaPreco(precosNulos)).toBe('Preço não definido');
  });

  it('deve retornar "A partir de R$ X" se todas as categorias tiverem o mesmo preço', () => {
    const precosIguais = [40, 40, 40];
    const resultado = formatFaixaPreco(precosIguais, false);
    expect(resultado).toBe('A partir de R$ 40');
  });

  it('deve retornar "A partir de R$ X a R$ Y" para faixa com preços variados', () => {
    const precosVariados = [40, 60, 90];
    const resultado = formatFaixaPreco(precosVariados, false);
    expect(resultado).toBe('A partir de R$ 40 a R$ 90');
  });

  it('deve desconsiderar valores nulos ao calcular a faixa de preços variados', () => {
    const precosComNulos = [null, 40, null, 90, null];
    const resultado = formatFaixaPreco(precosComNulos, false);
    expect(resultado).toBe('A partir de R$ 40 a R$ 90');
  });

  it('deve desconsiderar valores nulos ao calcular preço único', () => {
    const precosComNulos = [null, 40, null, 40, null];
    const resultado = formatFaixaPreco(precosComNulos, false);
    expect(resultado).toBe('A partir de R$ 40');
  });
});

describe('formatDuracao', () => {
  it('deve formatar duração de minutos menores que 1 hora', () => {
    expect(formatDuracao(40)).toBe('40 min');
  });

  it('deve formatar duração de horas exatas', () => {
    expect(formatDuracao(60)).toBe('1h');
    expect(formatDuracao(120)).toBe('2h');
  });

  it('deve formatar duração mista de horas e minutos', () => {
    expect(formatDuracao(90)).toBe('1h 30min');
    expect(formatDuracao(150)).toBe('2h 30min');
  });

  it('deve retornar "0 min" para valores inválidos ou zero', () => {
    expect(formatDuracao(0)).toBe('0 min');
    expect(formatDuracao(-10)).toBe('0 min');
  });
});
