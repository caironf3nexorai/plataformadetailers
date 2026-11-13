/**
 * Fórmulas matemáticas centrais da Mini-Calculadora Interativa NuvemWash
 */

export interface SimulacaoCustosInput {
  despesaFixaMensal: number;
  salarioEquipe: number;
  horasProdutivasMes: number;
  tempoGastoMinutos: number;
  custoQuimico: number;
  precoCobradoAtual: number;
  margemAlvo?: number; // Padrão: 0.40 (40%)
}

export interface SimulacaoCustosResultado {
  custoFixoTotal: number;
  custoHora: number;
  custoMinuto: number;
  custoTempo: number;
  custoTotalReal: number;
  precoIdealNuvemWash: number;
  lucroRealAtual: number;
  margemPercentualAtual: number;
  estaPrejuizo: boolean;
  estaAbaixoIdeal: boolean;
}

export function calcularSimulacaoCustos(input: SimulacaoCustosInput): SimulacaoCustosResultado {
  const despesa = Math.max(0, Number(input.despesaFixaMensal) || 0);
  const salario = Math.max(0, Number(input.salarioEquipe) || 0);
  const horas = Math.max(1, Number(input.horasProdutivasMes) || 1);
  const tempoMin = Math.max(0, Number(input.tempoGastoMinutos) || 0);
  const quimico = Math.max(0, Number(input.custoQuimico) || 0);
  const precoCobrado = Math.max(0, Number(input.precoCobradoAtual) || 0);
  const margemAlvo = typeof input.margemAlvo === 'number' && input.margemAlvo > 0 && input.margemAlvo < 1
    ? input.margemAlvo
    : 0.40;

  const custoFixoTotal = despesa + salario;
  const custoHora = custoFixoTotal / horas;
  const custoMinuto = custoHora / 60;

  const custoTempo = tempoMin * custoMinuto;
  const custoTotalReal = custoTempo + quimico;

  // Preço Ideal com margem alvo: Custo Total / (1 - Margem Alvo)
  const precoIdealNuvemWash = custoTotalReal > 0 ? custoTotalReal / (1 - margemAlvo) : 0;

  const lucroRealAtual = precoCobrado - custoTotalReal;
  const margemPercentualAtual = precoCobrado > 0 ? (lucroRealAtual / precoCobrado) * 100 : 0;

  const estaPrejuizo = lucroRealAtual < 0;
  const estaAbaixoIdeal = precoCobrado < precoIdealNuvemWash;

  return {
    custoFixoTotal,
    custoHora,
    custoMinuto,
    custoTempo,
    custoTotalReal,
    precoIdealNuvemWash,
    lucroRealAtual,
    margemPercentualAtual,
    estaPrejuizo,
    estaAbaixoIdeal,
  };
}
