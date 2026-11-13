import { describe, expect, it } from 'vitest';
import { calcularSimulacaoCustos } from './calculadoraSimulacao';

describe('calculadoraSimulacao', () => {
  it('calcula hora técnica e custo minuto com valores padrão', () => {
    const res = calcularSimulacaoCustos({
      despesaFixaMensal: 4200,
      salarioEquipe: 5300,
      horasProdutivasMes: 144,
      tempoGastoMinutos: 90,
      custoQuimico: 15,
      precoCobradoAtual: 100,
    });

    expect(res.custoFixoTotal).toBe(9500);
    expect(res.custoHora).toBeCloseTo(65.9722, 2);
    expect(res.custoMinuto).toBeCloseTo(1.0995, 2);
    expect(res.custoTempo).toBeCloseTo(98.9583, 2);
    expect(res.custoTotalReal).toBeCloseTo(113.9583, 2);
    expect(res.precoIdealNuvemWash).toBeCloseTo(189.9305, 2);

    // Com preço cobrado de R$ 100, há prejuízo real de ~R$ 13,96
    expect(res.lucroRealAtual).toBeCloseTo(-13.9583, 2);
    expect(res.estaPrejuizo).toBe(true);
    expect(res.estaAbaixoIdeal).toBe(true);
  });

  it('identifica lucro real quando o preço cobre o custo total mas fica abaixo do ideal de 40%', () => {
    const res = calcularSimulacaoCustos({
      despesaFixaMensal: 4200,
      salarioEquipe: 5300,
      horasProdutivasMes: 144,
      tempoGastoMinutos: 90,
      custoQuimico: 15,
      precoCobradoAtual: 140,
    });

    expect(res.estaPrejuizo).toBe(false);
    expect(res.lucroRealAtual).toBeCloseTo(26.0416, 2);
    expect(res.estaAbaixoIdeal).toBe(true); // 140 < 189.93
  });

  it('identifica preço blindado quando atinge ou supera a margem alvo de 40%', () => {
    const res = calcularSimulacaoCustos({
      despesaFixaMensal: 4200,
      salarioEquipe: 5300,
      horasProdutivasMes: 144,
      tempoGastoMinutos: 90,
      custoQuimico: 15,
      precoCobradoAtual: 200,
    });

    expect(res.estaPrejuizo).toBe(false);
    expect(res.estaAbaixoIdeal).toBe(false); // 200 >= 189.93
    expect(res.lucroRealAtual).toBeCloseTo(86.0416, 2);
  });
});
