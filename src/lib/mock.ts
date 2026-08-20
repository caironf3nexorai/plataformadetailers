import type { Agendamento } from '../types';

export const mockAgendamentos: Agendamento[] = [
  {
    id: '1',
    horario: '08:00',
    placa: 'RGT4B21',
    veiculo: 'Chevrolet Onix',
    cliente: 'João Silva',
    codigoServico: 'LV-01',
    nomeServico: 'Lavagem Simples',
    tomServico: 'vapor',
    status: 'concluido'
  },
  {
    id: '2',
    horario: '09:30',
    placa: 'ABC1234',
    veiculo: 'Hyundai HB20',
    cliente: 'Maria Oliveira',
    codigoServico: 'VT-09',
    nomeServico: 'Vitrificação',
    tomServico: 'amber',
    status: 'em_andamento'
  },
  {
    id: '3',
    horario: '11:00',
    placa: 'XYZ9876',
    veiculo: 'Toyota Corolla',
    cliente: 'Carlos Souza',
    codigoServico: 'PL-03',
    nomeServico: 'Polimento',
    tomServico: 'glass',
    status: 'atrasado'
  },
  {
    id: '4',
    horario: '14:00',
    placa: 'QWE4R56',
    veiculo: 'Jeep Compass',
    cliente: 'Ana Costa',
    codigoServico: 'HG-01',
    nomeServico: 'Higienização Interna',
    tomServico: 'mint',
    status: 'agendado'
  },
  {
    id: '5',
    horario: '15:30',
    placa: 'ASD7F89',
    veiculo: 'Fiat Strada',
    cliente: 'Pedro Santos',
    codigoServico: 'LV-02',
    nomeServico: 'Lavagem Detalhada',
    tomServico: 'vapor',
    status: 'agendado'
  },
  {
    id: '6',
    horario: '17:00',
    placa: 'ZXC1V23',
    veiculo: 'Honda Civic',
    cliente: 'Lucas Lima',
    codigoServico: 'VD-05',
    nomeServico: 'Vidros',
    tomServico: 'glass',
    status: 'agendado'
  }
];

// Flag de teste para simular ambiente com e sem serviço ativo
export const HAS_ACTIVE_SERVICE_MOCK = true;
