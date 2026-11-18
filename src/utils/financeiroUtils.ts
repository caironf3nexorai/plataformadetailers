import type { TipoFiltroPeriodo } from '../types/financeiro';

/**
 * Calcula a data de término (último dia do mês final) para uma despesa parcelada,
 * considerando o total de parcelas e a parcela inicial (padrão = 1).
 */
export function calcularVigenciaFimParcelada(
  inicioDateStr: string,
  totalParcelas: number,
  parcelaInicial: number = 1
): string {
  if (!inicioDateStr || totalParcelas <= 0) return '';
  const [ano, mes] = inicioDateStr.split('-').map(Number);
  if (!ano || !mes) return '';

  const inicialSeguro = Math.max(1, parcelaInicial || 1);
  const parcelasRestantes = Math.max(1, totalParcelas - inicialSeguro + 1);
  const totalMeses = (mes - 1) + (parcelasRestantes - 1);
  const anoFinal = ano + Math.floor(totalMeses / 12);
  const mesFinal = (totalMeses % 12) + 1;

  // Obter último dia do mês final
  const ultimoDia = new Date(anoFinal, mesFinal, 0).getDate();
  const mesPadded = String(mesFinal).padStart(2, '0');
  const diaPadded = String(ultimoDia).padStart(2, '0');

  return `${anoFinal}-${mesPadded}-${diaPadded}`;
}

/**
 * Calcula a parcela atual relativa a um mês de referência
 */
export function calcularParcelaAtual(vigenciaInicioStr: string, dataRefStr: string = new Date().toISOString(), parcelaInicial: number = 1): number {
  if (!vigenciaInicioStr) return 1;
  const [anoIni, mesIni] = vigenciaInicioStr.split('-').map(Number);
  const [anoRef, mesRef] = dataRefStr.split('-').map(Number);

  if (!anoIni || !mesIni || !anoRef || !mesRef) return 1;

  const diffMeses = (anoRef - anoIni) * 12 + (mesRef - mesIni);
  const parcela = diffMeses + (parcelaInicial || 1);
  return Math.max(1, parcela);
}

/**
 * Formata ano-mês como MM/YYYY (ex: 07/2029)
 */
export function formatarMesAno(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length < 2) return dateStr;
  return `${parts[1]}/${parts[0]}`;
}

/**
 * Retorna as datas de início e fim no formato YYYY-MM-DD para um filtro de período.
 * Nota: 'este_mes' vai estritamente do primeiro dia do mês ao último dia do mês.
 */
export function obterDatasPeriodo(
  filtro: TipoFiltroPeriodo,
  customInicio?: string,
  customFim?: string,
  baseDate: Date = new Date()
): { inicio: string; fim: string } {
  const formatIsoDate = (d: Date) => d.toISOString().split('T')[0];

  const ano = baseDate.getFullYear();
  const mes = baseDate.getMonth(); // 0..11

  if (filtro === 'hoje') {
    const hojeStr = formatIsoDate(baseDate);
    return { inicio: hojeStr, fim: hojeStr };
  }

  if (filtro === 'esta_semana') {
    const diaSemana = baseDate.getDay(); // 0 = dom, 1 = seg...
    const diffSeg = diaSemana === 0 ? -6 : 1 - diaSemana;
    const seg = new Date(baseDate);
    seg.setDate(baseDate.getDate() + diffSeg);

    const dom = new Date(seg);
    dom.setDate(seg.getDate() + 6);

    return { inicio: formatIsoDate(seg), fim: formatIsoDate(dom) };
  }

  if (filtro === 'este_mes') {
    const primeiroDia = new Date(ano, mes, 1);
    const ultimoDia = new Date(ano, mes + 1, 0);
    return { inicio: formatIsoDate(primeiroDia), fim: formatIsoDate(ultimoDia) };
  }

  if (filtro === 'mes_passado') {
    const primeiroDia = new Date(ano, mes - 1, 1);
    const ultimoDia = new Date(ano, mes, 0);
    return { inicio: formatIsoDate(primeiroDia), fim: formatIsoDate(ultimoDia) };
  }

  if (filtro === 'personalizado' && customInicio && customFim) {
    return { inicio: customInicio, fim: customFim };
  }

  // Fallback para este mês
  const primeiroDia = new Date(ano, mes, 1);
  const ultimoDia = new Date(ano, mes + 1, 0);
  return { inicio: formatIsoDate(primeiroDia), fim: formatIsoDate(ultimoDia) };
}

/**
 * Calcula os componentes da cascata financeira
 */
export function calcularCascata(
  faturamento: number,
  custoProdutos: number,
  comissoes: number,
  custoEstrutura: number
) {
  const fat = Math.max(0, faturamento);
  const prod = Math.max(0, custoProdutos);
  const com = Math.max(0, comissoes);
  const est = Math.max(0, custoEstrutura);

  const lucroBruto = fat - prod - com;
  const margemBruta = fat > 0 ? (lucroBruto / fat) * 100 : 0;

  const lucroLiquido = lucroBruto - est;
  const margemLiquida = fat > 0 ? (lucroLiquido / fat) * 100 : 0;

  return {
    faturamento: fat,
    custoProdutos: prod,
    comissoes: com,
    lucroBruto,
    margemBruta,
    custoEstrutura: est,
    lucroLiquido,
    margemLiquida,
  };
}

/**
 * Calcula status de vencimento mensal de uma despesa fixa protegendo meses curtos
 * (fevereiro 28/29 e meses de 30 dias) e dados legados onde dia_vencimento é null/undefined.
 */
export function calcularInfoVencimentoDespesa(
  diaVencimento: number | null | undefined,
  estaPago: boolean,
  hojeIso: string
): {
  status: 'pago' | 'atrasada' | 'vence_hoje' | 'vence_em_breve' | 'pendente';
  diasAtraso: number;
  diaEfetivo: number | null;
} {
  if (estaPago) {
    return { status: 'pago', diasAtraso: 0, diaEfetivo: diaVencimento ?? null };
  }
  if (diaVencimento == null || !Number.isFinite(diaVencimento) || diaVencimento < 1 || diaVencimento > 31) {
    return { status: 'pendente', diasAtraso: 0, diaEfetivo: null };
  }
  const [ano, mes, diaHoje] = hojeIso.split('-').map(Number);
  if (!ano || !mes || !diaHoje) {
    return { status: 'pendente', diasAtraso: 0, diaEfetivo: diaVencimento };
  }
  const ultimoDiaMes = new Date(ano, mes, 0).getDate();
  const diaEfetivo = Math.min(Math.trunc(diaVencimento), ultimoDiaMes);
  if (diaEfetivo < diaHoje) {
    return { status: 'atrasada', diasAtraso: diaHoje - diaEfetivo, diaEfetivo };
  }
  if (diaEfetivo === diaHoje) {
    return { status: 'vence_hoje', diasAtraso: 0, diaEfetivo };
  }
  if (diaEfetivo - diaHoje <= 3) {
    return { status: 'vence_em_breve', diasAtraso: 0, diaEfetivo };
  }
  return { status: 'pendente', diasAtraso: 0, diaEfetivo };
}

/**
 * Regra canônica de acesso granular a Contas a Pagar / Despesas Fixas:
 * - Dono: sempre true
 * - Gerente: true somente se pode_gerenciar_despesas === true (default false para legados)
 * - Operador ou indefinido: sempre false
 */
export function podeUsuarioGerenciarDespesas(
  role?: string | null,
  podeGerenciarFlag?: boolean | null
): boolean {
  if (role === 'dono') return true;
  if (role === 'gerente') return Boolean(podeGerenciarFlag);
  return false;
}
