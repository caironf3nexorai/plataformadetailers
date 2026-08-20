import type { Agendamento } from '../types/agenda';
import { obterEstadoDerivadoCronometro } from '../hooks/useTempoExecucao';

export type TipoAcaoAgendamento =
  | 'fazer_vistoria'
  | 'continuar_vistoria'
  | 'iniciar_servico'
  | 'continuar_servico'
  | 'definir_valor'
  | 'ver_atendimento'
  | 'nenhuma';

export interface CheckinInfo {
  id: string;
  finalizado: boolean;
  token_aceite?: string;
  enviado_em?: string | null;
  aceite_tipo?: string | null;
}

export interface ExecucaoInfo {
  id: string;
  status: string;
  valor_total_final: number | null;
  iniciado_em?: string;
  segundos_pausados?: number;
  segundos_trabalhados?: number;
  pausado_em?: string | null;
  retomado_em?: string | null;
  totalItens?: number;
  concluidosCount?: number;
}

export interface ResultadoAcaoAgendamento {
  tipo: TipoAcaoAgendamento;
  label: string;
  checkinId?: string;
  execucaoId?: string;
  isAguardandoRemoto?: boolean;
}

export function obterAcaoAgendamento(params: {
  agendamento: Agendamento;
  checkinInfo?: CheckinInfo | null;
  execucaoInfo?: ExecucaoInfo | null;
  podeVerValor?: boolean;
}): ResultadoAcaoAgendamento {
  const { agendamento, checkinInfo, execucaoInfo, podeVerValor = false } = params;

  // 1. Agendamento cancelado ou não compareceu -> Nenhuma ação primária
  if (agendamento.status === 'cancelado' || agendamento.status === 'nao_compareceu') {
    return {
      tipo: 'nenhuma',
      label: '',
    };
  }

  // 2. Serviço em execução (em_andamento ou execucao ativa não finalizada) -> "Continuar serviço" ou "Retomar serviço"
  if (agendamento.status === 'em_andamento' || (execucaoInfo && execucaoInfo.status !== 'finalizado')) {
    let label = 'Continuar serviço';

    if (execucaoInfo) {
      const estadoDerivado = obterEstadoDerivadoCronometro({
        statusExecucao: execucaoInfo.status,
      });

      if (estadoDerivado === 'pausado_auto' || estadoDerivado === 'pausado_manual') {
        label = 'Retomar serviço';
      }
    }

    return {
      tipo: 'continuar_servico',
      label,
      execucaoId: execucaoInfo?.id,
      checkinId: checkinInfo?.id,
    };
  }

  // 3. Agendamento concluído / finalizado -> "Definir valor" ou "Ver atendimento"
  if (agendamento.status === 'concluido' || execucaoInfo?.status === 'finalizado') {
    if (execucaoInfo && execucaoInfo.valor_total_final === null && podeVerValor) {
      return {
        tipo: 'definir_valor',
        label: 'Definir valor',
        execucaoId: execucaoInfo.id,
        checkinId: checkinInfo?.id,
      };
    }

    return {
      tipo: 'ver_atendimento',
      label: 'Ver atendimento',
      execucaoId: execucaoInfo?.id,
      checkinId: checkinInfo?.id,
    };
  }

  // 4. Status agendado / confirmado com vistoria finalizada -> "Iniciar serviço"
  if (checkinInfo && checkinInfo.finalizado) {
    return {
      tipo: 'iniciar_servico',
      label: 'Iniciar serviço',
      checkinId: checkinInfo.id,
      execucaoId: execucaoInfo?.id,
    };
  }

  // 5. Status agendado / confirmado com vistoria em andamento -> "Continuar vistoria"
  if (checkinInfo && !checkinInfo.finalizado) {
    return {
      tipo: 'continuar_vistoria',
      label: 'Continuar vistoria',
      checkinId: checkinInfo.id,
      isAguardandoRemoto: Boolean(checkinInfo.enviado_em),
    };
  }

  // 6. Status agendado / confirmado sem vistoria -> "Fazer vistoria"
  return {
    tipo: 'fazer_vistoria',
    label: 'Fazer vistoria',
  };
}
