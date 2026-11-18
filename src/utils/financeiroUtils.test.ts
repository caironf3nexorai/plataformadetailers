import { describe, it, expect } from 'vitest';
import {
  calcularVigenciaFimParcelada,
  calcularParcelaAtual,
  formatarMesAno,
  obterDatasPeriodo,
  calcularCascata,
  calcularInfoVencimentoDespesa,
  podeUsuarioGerenciarDespesas,
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

  it('deve considerar parcelaInicial ao calcular vigencia_fim de financiamento em andamento', () => {
    // 12 parcelas no total, começando da parcela 5 em novembro/2026 -> 8 meses restantes (nov/2026 a jun/2027)
    const fim = calcularVigenciaFimParcelada('2026-11-01', 12, 5);
    expect(fim).toBe('2027-06-30');
    // Última parcela (12 de 12) -> encerra no próprio mês
    expect(calcularVigenciaFimParcelada('2026-11-01', 12, 12)).toBe('2026-11-30');
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

  describe('calcularInfoVencimentoDespesa (Null Safety + Meses Curtos)', () => {
    it('trata dados legados com dia_vencimento null ou undefined sem erro', () => {
      expect(calcularInfoVencimentoDespesa(null, false, '2026-11-17')).toEqual({
        status: 'pendente',
        diasAtraso: 0,
        diaEfetivo: null,
      });
      expect(calcularInfoVencimentoDespesa(undefined, false, '2026-11-17')).toEqual({
        status: 'pendente',
        diasAtraso: 0,
        diaEfetivo: null,
      });
    });

    it('ajusta dia 31 para 28 em fevereiro (não bissexto), 29 em bissexto e 30 em abril', () => {
      expect(calcularInfoVencimentoDespesa(31, false, '2026-02-28')).toEqual({
        status: 'vence_hoje',
        diasAtraso: 0,
        diaEfetivo: 28,
      });
      expect(calcularInfoVencimentoDespesa(31, false, '2028-02-29')).toEqual({
        status: 'vence_hoje',
        diasAtraso: 0,
        diaEfetivo: 29,
      });
      expect(calcularInfoVencimentoDespesa(31, false, '2026-04-30')).toEqual({
        status: 'vence_hoje',
        diasAtraso: 0,
        diaEfetivo: 30,
      });
    });

    it('marca conta vencida como atrasada com contagem exata de dias e zera quando paga', () => {
      expect(calcularInfoVencimentoDespesa(10, false, '2026-11-17')).toEqual({
        status: 'atrasada',
        diasAtraso: 7,
        diaEfetivo: 10,
      });
      expect(calcularInfoVencimentoDespesa(10, true, '2026-11-17')).toEqual({
        status: 'pago',
        diasAtraso: 0,
        diaEfetivo: 10,
      });
    });
  });

  describe('podeUsuarioGerenciarDespesas (Matriz de Papéis)', () => {
    it('libera sempre para dono, mesmo sem flag preenchida', () => {
      expect(podeUsuarioGerenciarDespesas('dono', false)).toBe(true);
      expect(podeUsuarioGerenciarDespesas('dono', undefined)).toBe(true);
      expect(podeUsuarioGerenciarDespesas('dono', null)).toBe(true);
    });

    it('libera gerente SOMENTE quando flag pode_gerenciar_despesas for true (bloqueia legados)', () => {
      expect(podeUsuarioGerenciarDespesas('gerente', true)).toBe(true);
      expect(podeUsuarioGerenciarDespesas('gerente', false)).toBe(false);
      expect(podeUsuarioGerenciarDespesas('gerente', undefined)).toBe(false);
      expect(podeUsuarioGerenciarDespesas('gerente', null)).toBe(false);
    });

    it('bloqueia operador e papéis indefinidos mesmo se flag vier true', () => {
      expect(podeUsuarioGerenciarDespesas('operador', true)).toBe(false);
      expect(podeUsuarioGerenciarDespesas(undefined, true)).toBe(false);
      expect(podeUsuarioGerenciarDespesas(null, true)).toBe(false);
    });
  });
});
