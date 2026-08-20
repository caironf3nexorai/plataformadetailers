export type AgendamentoStatus = 
  | 'agendado'
  | 'confirmado'
  | 'em_andamento'
  | 'concluido'
  | 'cancelado'
  | 'nao_compareceu';

export type ModoOcupacao = 'slot' | 'dia_inteiro' | 'multiplos_dias' | 'transborda';

export interface HorarioFuncionamento {
  id: string;
  tenant_id: string;
  dia_semana: number; // 0=Dom, 1=Seg... 6=Sáb
  abre: string;
  fecha: string;
  capacidade: number;
  ativo: boolean;
}

export interface BloqueioAgenda {
  id: string;
  tenant_id: string;
  inicio: string;
  fim: string;
  motivo: string;
  criado_por: string;
  created_at: string;
}

export interface AgendamentoItem {
  id: string;
  tenant_id: string;
  agendamento_id: string;
  servico_id: string;
  combo_id?: string | null;
  duracao_minutos: number;
  preco_estimado?: number | null;
  modo_ocupacao: ModoOcupacao;
  dias_ocupados: number;
  ordem: number;
  created_at?: string;
  servico?: {
    id: string;
    nome: string;
    codigo?: string | null;
    tom: string;
    grupo: string;
  };
  servicos?: {
    id: string;
    nome: string;
    codigo?: string | null;
    tom: string;
    grupo: string;
  };
}

export interface Agendamento {
  id: string;
  tenant_id: string;
  numero_os?: number | null;
  cliente_id: string;
  veiculo_id?: string | null;
  servico_id?: string | null;
  categoria_id: string;
  inicio: string; // ISO string
  duracao_minutos: number;
  duracao_total?: number;
  modo_ocupacao: ModoOcupacao;
  modo_ocupacao_efetivo?: ModoOcupacao;
  dias_ocupados: number;
  preco_estimado?: number | null;
  preco_estimado_total?: number | null;
  forcado?: boolean;
  forcado_por?: string | null;
  status: AgendamentoStatus;
  origem: 'interno' | 'online' | 'balcao' | 'orcamento';
  observacoes?: string | null;
  criado_por?: string | null;
  previsao_entrega?: string | null;
  transbordo_aceito_em?: string | null;
  transbordo_aceite_user_agent?: string | null;
  transbordo_aceite_ip?: string | null;
  created_at: string;
  updated_at: string;
  cliente?: {
    id: string;
    nome: string;
    telefone: string;
  };
  veiculo?: {
    id: string;
    placa: string;
    modelo: string;
    marca: string;
  } | null;
  servico?: {
    id: string;
    nome: string;
    codigo?: string | null;
    tom: string;
    grupo: string;
  };
  agendamento_itens?: AgendamentoItem[];
  categoria?: {
    id: string;
    nome: string;
  };
  execucao?: {
    id: string;
    status: string;
    valor_total_final?: number | null;
    finalizado_em?: string | null;
  } | null;
}


export interface HorarioDisponivel {
  horario: string;
  disponivel: boolean;
  motivo?: string | null;
  termino_previsto?: string | null;
}
