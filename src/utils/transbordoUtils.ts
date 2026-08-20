import { formatarDataIsoSP, formatarDataHoraResumoSP } from './datas';

export interface InfoTransbordo {
  isTransborda: boolean;
  inicioFormatted: string;
  terminoFormatted: string;
  detalheHoras: string;
  mensagemCompleta: string;
  avisoPernoite: string;
}

/**
 * Formata detalhes de agendamento transbordado (ex: "Início: quinta 20/08 às 16:30 · Término previsto: sexta 21/08 às 08:15")
 */
export function formatarInformacaoTransbordo(
  inicioISO: string,
  terminoPrevistoISO?: string | null
): InfoTransbordo | null {
  if (!inicioISO || !terminoPrevistoISO) return null;

  try {
    const inicioStrIso = formatarDataIsoSP(inicioISO);
    const terminoStrIso = formatarDataIsoSP(terminoPrevistoISO);

    // Se início e término forem no mesmo dia SP, não é transbordo de data
    if (inicioStrIso === terminoStrIso) {
      return null;
    }

    const inicioStr = formatarDataHoraResumoSP(inicioISO);
    const terminoStr = formatarDataHoraResumoSP(terminoPrevistoISO);

    const avisoPernoite = 'Este agendamento transborda para o dia útil seguinte. O veículo permanecerá guardado na oficina.';
    const mensagemCompleta = `Início: ${inicioStr} · Término previsto: ${terminoStr} (Veículo fica na oficina)`;

    return {
      isTransborda: true,
      inicioFormatted: inicioStr,
      terminoFormatted: terminoStr,
      detalheHoras: `${inicioStr} → ${terminoStr}`,
      mensagemCompleta,
      avisoPernoite,
    };
  } catch (err) {
    console.error('Erro ao formatar informações de transbordo:', err);
    return null;
  }
}

/**
 * Verifica se uma determinada data (YYYY-MM-DD) é o dia inicial ou dia de continuação de um agendamento.
 */
export function verificarPapelDiaAgendamento(
  inicioISO: string,
  diaIso: string,
  diasOcupados: number = 1,
  modoOcupacao?: string
): { pertenceAoDia: boolean; isContinuacao: boolean } {
  if (!inicioISO || !diaIso) {
    return { pertenceAoDia: false, isContinuacao: false };
  }

  const inicioDataStr = formatarDataIsoSP(inicioISO) || inicioISO.substring(0, 10);
  if (inicioDataStr === diaIso) {
    return { pertenceAoDia: true, isContinuacao: false };
  }

  const isTransbordaOuMulti = modoOcupacao === 'transborda' || modoOcupacao === 'multiplos_dias' || diasOcupados > 1;
  if (!isTransbordaOuMulti) {
    return { pertenceAoDia: false, isContinuacao: false };
  }

  try {
    const dtInicio = new Date(`${inicioDataStr}T00:00:00-03:00`);
    const dtAlvo = new Date(`${diaIso}T00:00:00-03:00`);

    const maxDias = Math.max(diasOcupados, 2);
    const dtFim = new Date(dtInicio);
    dtFim.setDate(dtFim.getDate() + (maxDias - 1));

    const pertence = dtAlvo > dtInicio && dtAlvo <= dtFim;
    return {
      pertenceAoDia: pertence,
      isContinuacao: pertence,
    };
  } catch {
    return { pertenceAoDia: false, isContinuacao: false };
  }
}
