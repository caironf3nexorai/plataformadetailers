// Centralized helper for service execution time calculations and alert thresholds

export type NivelAlertaTempo = 'normal' | 'alerta' | 'critico';

export interface AlertInfo {
  nivel: NivelAlertaTempo;
  decorridoHoras: number;
  mensagemAlert?: string;
}

/**
 * Calculates total elapsed time in seconds, accounting for pause intervals and finalization freezes.
 */
export function calcularSegundosDecorridos(
  iniciadoEm: string | Date,
  segundosPausados: number = 0,
  pausadoEm?: string | Date | null,
  finalizadoEm?: string | Date | null
): number {
  if (!iniciadoEm) return 0;

  const tIniciado = new Date(iniciadoEm).getTime();
  if (isNaN(tIniciado)) return 0;

  let tFim: number;

  if (finalizadoEm) {
    tFim = new Date(finalizadoEm).getTime();
  } else if (pausadoEm) {
    tFim = new Date(pausadoEm).getTime();
  } else {
    tFim = Date.now();
  }

  if (isNaN(tFim)) return 0;

  const totalBrutoSegundos = Math.floor((tFim - tIniciado) / 1000);
  const decorridoLiquido = totalBrutoSegundos - (segundosPausados || 0);

  return Math.max(0, decorridoLiquido);
}

/**
 * Determines alert level for open executions based on estimated duration.
 * Threshold = max(duracaoMinutosEstimada * 2, 480 min / 8h).
 * Escalates to 'critico' if open for >= 24h (1440 min).
 */
export function obterNivelAlertaTempo(
  iniciadoEm: string | Date,
  duracaoMinutosEstimada: number = 60,
  segundosPausados: number = 0,
  pausadoEm?: string | Date | null,
  finalizadoEm?: string | Date | null
): AlertInfo {
  if (finalizadoEm) {
    return { nivel: 'normal', decorridoHoras: 0 };
  }

  const decorridoSegundos = calcularSegundosDecorridos(
    iniciadoEm,
    segundosPausados,
    pausadoEm,
    finalizadoEm
  );

  const decorridoMinutos = Math.floor(decorridoSegundos / 60);
  const decorridoHoras = Math.floor(decorridoMinutos / 60);

  // Threshold: max(duracao * 2, 8 horas = 480 minutos)
  const limiteMinutos = Math.max((duracaoMinutosEstimada || 60) * 2, 480);

  if (decorridoMinutos >= 1440) {
    // 24 horas ou mais
    return {
      nivel: 'critico',
      decorridoHoras,
      mensagemAlert: `Este serviço está aberto há ${decorridoHoras}h. Esqueceu de finalizar?`,
    };
  }

  if (decorridoMinutos >= limiteMinutos) {
    return {
      nivel: 'alerta',
      decorridoHoras,
      mensagemAlert: `Este serviço está aberto há ${decorridoHoras}h. Esqueceu de finalizar?`,
    };
  }

  return {
    nivel: 'normal',
    decorridoHoras,
  };
}
