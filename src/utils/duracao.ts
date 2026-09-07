/**
 * Utilitário central de conversão e formatação de unidades de duração para serviços.
 * Suporta:
 * - 'min' (minutos)
 * - 'horas' (1 hora = 60 minutos)
 * - 'dias' (1 dia útil de oficina = 8 horas = 480 minutos)
 */

export type UnidadeDuracao = 'min' | 'horas' | 'dias';

export const UnidadeDuracao = {
  MIN: 'min' as const,
  HORAS: 'horas' as const,
  DIAS: 'dias' as const,
};

export const MINUTOS_POR_HORA = 60;
export const MINUTOS_POR_DIA = 480; // 8 horas de expediente padrão em estética automotiva

export const OPCOES_UNIDADE_DURACAO: { valor: UnidadeDuracao; rotulo: string; rotuloCurto: string }[] = [
  { valor: 'min', rotulo: 'Minutos', rotuloCurto: 'min' },
  { valor: 'horas', rotulo: 'Horas', rotuloCurto: 'h' },
  { valor: 'dias', rotulo: 'Dias', rotuloCurto: 'd' },
];

/**
 * Converte um valor numérico na unidade informada para o total em minutos.
 */
export function converterParaMinutos(valor: number, unidade: UnidadeDuracao): number {
  const num = Number(valor) || 0;
  if (num <= 0) return 0;

  switch (unidade) {
    case 'dias':
      return Math.round(num * MINUTOS_POR_DIA);
    case 'horas':
      return Math.round(num * MINUTOS_POR_HORA);
    case 'min':
    default:
      return Math.round(num);
  }
}

/**
 * Converte um total em minutos para o valor numérico na unidade alvo desejada.
 * Preserva até 1 casa decimal se não for inteiro (ex: 90 min -> 1.5 horas).
 */
export function converterDeMinutos(minutos: number, unidadeAlvo: UnidadeDuracao): number {
  const mins = Number(minutos) || 0;
  if (mins <= 0) return 0;

  switch (unidadeAlvo) {
    case 'dias': {
      const dias = mins / MINUTOS_POR_DIA;
      return dias % 1 === 0 ? dias : Math.round(dias * 10) / 10;
    }
    case 'horas': {
      const horas = mins / MINUTOS_POR_HORA;
      return horas % 1 === 0 ? horas : Math.round(horas * 10) / 10;
    }
    case 'min':
    default:
      return Math.round(mins);
  }
}

/**
 * Detecta a melhor unidade sugerida para exibir/editar um determinado valor em minutos.
 */
export function detectarUnidadeSugerida(
  minutos: number,
  modoOcupacao?: string,
  unidadeSalva?: string | null
): UnidadeDuracao {
  if (unidadeSalva === 'dias' || unidadeSalva === 'horas' || unidadeSalva === 'min') {
    return unidadeSalva;
  }

  if (modoOcupacao === 'multiplos_dias' || modoOcupacao === 'dia_inteiro') {
    return 'dias';
  }

  const mins = Number(minutos) || 0;
  if (mins >= MINUTOS_POR_DIA && mins % MINUTOS_POR_DIA === 0) {
    return 'dias';
  }

  if (mins >= MINUTOS_POR_HORA && mins % MINUTOS_POR_HORA === 0) {
    return 'horas';
  }

  return 'min';
}

/**
 * Formata minutos para exibição amigável aos usuários e clientes.
 * Exemplos:
 * - 45 -> "45 min"
 * - 120 -> "2h"
 * - 90 -> "1h 30min"
 * - 480 -> "1 dia"
 * - 960 -> "2 dias"
 */
export function formatarDuracaoAmigavel(
  minutos: number,
  unidadePreferida?: UnidadeDuracao
): string {
  const mins = Number(minutos) || 0;
  if (mins <= 0) return '0 min';

  // Se o usuário explicitou unidade 'horas'
  if (unidadePreferida === 'horas') {
    const h = mins / MINUTOS_POR_HORA;
    if (h % 1 === 0) return `${h}h`;
  }

  // Se o usuário explicitou unidade 'dias' ou se for múltiplo exato de dias (>= 480 min)
  if (unidadePreferida === 'dias' || (mins >= MINUTOS_POR_DIA && mins % MINUTOS_POR_DIA === 0)) {
    const d = mins / MINUTOS_POR_DIA;
    if (d % 1 === 0) {
      return d === 1 ? '1 dia' : `${d} dias`;
    }
  }

  // Se for maior que 1 dia (>= 480 min) com horas ou minutos remanescentes
  if (mins >= MINUTOS_POR_DIA && unidadePreferida !== 'horas') {
    const d = Math.floor(mins / MINUTOS_POR_DIA);
    const resto = mins % MINUTOS_POR_DIA;
    const h = Math.floor(resto / MINUTOS_POR_HORA);
    const m = resto % MINUTOS_POR_HORA;
    const diaTexto = d === 1 ? '1 dia' : `${d} dias`;
    if (h > 0 && m > 0) return `${diaTexto} e ${h}h ${m}min`;
    if (h > 0) return `${diaTexto} e ${h}h`;
    if (m > 0) return `${diaTexto} e ${m}min`;
    return diaTexto;
  }

  // Se for múltiplo exato de horas
  if (mins >= MINUTOS_POR_HORA && mins % MINUTOS_POR_HORA === 0) {
    const h = mins / MINUTOS_POR_HORA;
    return `${h}h`;
  }

  // Horas com minutos restantes (ex: 1h 30min)
  if (mins >= MINUTOS_POR_HORA) {
    const h = Math.floor(mins / MINUTOS_POR_HORA);
    const m = mins % MINUTOS_POR_HORA;
    if (m === 0) return `${h}h`;
    return `${h}h ${m < 10 ? '0' : ''}${m}min`;
  }

  return `${mins} min`;
}

export function formatarDuracao(
  minutos: number,
  unidadePreferida?: UnidadeDuracao
): string {
  return formatarDuracaoAmigavel(minutos, unidadePreferida);
}

