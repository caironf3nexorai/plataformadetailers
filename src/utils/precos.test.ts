import { describe, it, expect } from 'vitest';
import {
  formatFaixaPreco,
  formatDuracao,
  parsePrecoMatrizInput,
  normalizarDuracaoMinutosMatriz,
  isPrecoDefinido,
  servicoTemPrecoSugeridoPendente,
  servicoSemPrecosDefinidos,
} from './precos';

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

  it('deve suportar lista de objetos com preco_base e calcular faixas corretamente', () => {
    const precosObjetos = [
      { categoria_id: 'cat-1', preco_base: 50 },
      { categoria_id: 'cat-2', preco_base: 80 },
      { categoria_id: 'cat-3', preco_base: null }
    ];
    const resultado = formatFaixaPreco(precosObjetos as any, false);
    expect(resultado).toBe('A partir de R$ 50 a R$ 80');
  });

  it('deve suportar lista de objetos com o mesmo preco_base em todas as categorias', () => {
    const precosObjetos = [
      { categoria_id: 'cat-1', preco_base: 50 },
      { categoria_id: 'cat-2', preco_base: 50 }
    ];
    const resultado = formatFaixaPreco(precosObjetos as any, false);
    expect(resultado).toBe('A partir de R$ 50');
  });

  it('não deve retornar NaN mesmo com valores corrompidos ou strings', () => {
    const precosCorrompidos = [
      { categoria_id: 'cat-1', preco_base: 'invalido' },
      { categoria_id: 'cat-2', preco_base: undefined }
    ];
    const resultado = formatFaixaPreco(precosCorrompidos as any, false);
    expect(resultado).toBe('Preço não definido');
    expect(resultado).not.toContain('NaN');
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

describe('parsePrecoMatrizInput', () => {
  it('retorna null para vazio, caracteres parciais ou sob consulta', () => {
    expect(parsePrecoMatrizInput('')).toBeNull();
    expect(parsePrecoMatrizInput('-')).toBeNull();
    expect(parsePrecoMatrizInput(',')).toBeNull();
    expect(parsePrecoMatrizInput('150', true)).toBeNull();
  });

  it('converte formatos PT-BR, ponto decimal e milhar corretamente sem gerar NaN', () => {
    expect(parsePrecoMatrizInput('120,50')).toBe(120.5);
    expect(parsePrecoMatrizInput('120.5')).toBe(120.5);
    expect(parsePrecoMatrizInput('1.250,90')).toBe(1250.9);
    expect(parsePrecoMatrizInput('1.250.000')).toBe(1250000);
    expect(parsePrecoMatrizInput('0')).toBe(0);
    expect(parsePrecoMatrizInput(-10)).toBe(0);
  });
});

describe('normalizarDuracaoMinutosMatriz', () => {
  it('arredonda decimais e aplica fallback seguro para zero ou valores inválidos', () => {
    expect(normalizarDuracaoMinutosMatriz(90.6)).toBe(91);
    expect(normalizarDuracaoMinutosMatriz(0)).toBe(60);
    expect(normalizarDuracaoMinutosMatriz(-15)).toBe(60);
    expect(normalizarDuracaoMinutosMatriz(NaN)).toBe(60);
    expect(normalizarDuracaoMinutosMatriz(45)).toBe(45);
  });
});

describe('detecção de preços sugeridos e serviços sem preço definido', () => {
  it('identifica apenas valores positivos em linhas ativas como preço definido', () => {
    expect(isPrecoDefinido(100)).toBe(true);
    expect(isPrecoDefinido({ preco_base: '85,5' })).toBe(true);
    expect(isPrecoDefinido({ preco_base: 0 })).toBe(false);
    expect(isPrecoDefinido({ preco_base: null })).toBe(false);
    expect(isPrecoDefinido({ preco_base: 100, ativo: false })).toBe(false);
  });

  it('não acusa preços sugeridos quando preco_base é nulo, zero ou serviço é sob consulta', () => {
    expect(
      servicoTemPrecoSugeridoPendente(
        [
          { preco_base: null, duracao_confirmada: false },
          { preco_base: 0, duracao_confirmada: false },
        ],
        false
      )
    ).toBe(false);

    expect(
      servicoTemPrecoSugeridoPendente(
        [{ preco_base: 150, duracao_confirmada: false }],
        true
      )
    ).toBe(false);

    expect(
      servicoTemPrecoSugeridoPendente(
        [{ preco_base: 150, duracao_confirmada: false }],
        false
      )
    ).toBe(true);

    expect(
      servicoTemPrecoSugeridoPendente(
        [{ preco_base: 150, duracao_confirmada: true }],
        false
      )
    ).toBe(false);
  });

  it('detecta corretamente quando um serviço regular não possui preços definidos', () => {
    expect(servicoSemPrecosDefinidos([], false)).toBe(true);
    expect(servicoSemPrecosDefinidos([{ preco_base: null }, { preco_base: 0 }], false)).toBe(true);
    expect(servicoSemPrecosDefinidos([{ preco_base: 90 }], false)).toBe(false);
    expect(servicoSemPrecosDefinidos([], true)).toBe(false);
  });
});
