import { describe, it, expect } from 'vitest';
import {
  calcularVigenciaFimParcelada,
  calcularParcelaAtual,
  formatarMesAno,
  obterDatasPeriodo,
  calcularCascata,
} from './financeiroUtils';

describe('financeiroUtils', () => {
  it('deve calcular vigencia_fim para despesa parcelada de 36 parcelas', () => {
    const fim = calcularVigenciaFimParcelada('2026-08-01', 36);
    expect(fim).toBe('2029-07-31');
  });

  it('deve calcular vigencia_fim para despesa de 12 parcelas', () => {
    const fim = calcularVigenciaFimParcelada('2026-01-15', 12);
    expect(fim).toBe('2026-12-31');
  });

  it('deve calcular a parcela atual corretamente', () => {
    const parcela = calcularParcelaAtual('2026-08-01', '2027-03-10', 1);
    // Agosto/2026 (parc 1) ate Março/2027 = +7 meses -> parcela 8
    expect(parcela).toBe(8);
  });

  it('deve formatar data ISO em formato MM/YYYY', () => {
    expect(formatarMesAno('2029-07-31')).toBe('07/2029');
  });

  it('deve gerar periodo "este_mes" cobrindo do dia 1 ao ultimo dia do mes', () => {
    const refDate = new Date(2026, 7, 15); // Agosto de 2026
    const p = obterDatasPeriodo('este_mes', undefined, undefined, refDate);
    expect(p.inicio).toBe('2026-08-01');
    expect(p.fim).toBe('2026-08-31');
  });

  it('deve calcular cascata financeira corretamente', () => {
    const res = calcularCascata(4850, 312.4, 485, 851.2);
    expect(res.faturamento).toBe(4850);
    expect(res.custoProdutos).toBe(312.4);
    expect(res.comissoes).toBe(485);
    expect(res.lucroBruto).toBeCloseTo(4052.6, 2);
    expect(res.custoEstrutura).toBe(851.2);
    expect(res.lucroLiquido).toBeCloseTo(3201.4, 2);
    expect(res.margemBruta).toBeCloseTo(83.55, 1);
    expect(res.margemLiquida).toBeCloseTo(66.0, 1);
  });
});
