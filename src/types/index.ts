export type StatusServico = 'agendado' | 'em_andamento' | 'concluido' | 'atrasado';

export interface Agendamento {
  id: string;
  horario: string;
  placa: string;
  veiculo: string;
  cliente: string;
  codigoServico: string;
  nomeServico: string;
  tomServico: 'amber' | 'glass' | 'mint' | 'vapor';
  status: StatusServico;
}

export interface ServiceChipProps {
  code: string;
  label?: string;
  tone: 'amber' | 'glass' | 'mint' | 'vapor';
}

export * from './checkin';
