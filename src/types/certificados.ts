export interface CertificadoGarantia {
  id: string;
  codigo: string;
  tenant_id: string;
  agendamento_id?: string | null;
  cliente_id: string;
  veiculo_id: string;
  servico_id?: string | null;
  servico_nome: string;
  produto_aplicado?: string | null;
  garantia_meses: number;
  intervalo_manutencao_dias: number;
  data_aplicacao: string;
  data_vencimento: string;
  observacoes?: string | null;
  status: 'ativo' | 'manutencao_pendente' | 'expirado' | 'cancelado';
  created_at?: string;
  updated_at?: string;
}

export interface CertificadoManutencao {
  id: string;
  numero_revisao: number;
  data_realizada: string;
  observacao?: string | null;
}

export interface CertificadoPublicoData {
  encontrado: boolean;
  motivo?: string;
  certificado: {
    id: string;
    codigo: string;
    servico_nome: string;
    produto_aplicado?: string | null;
    garantia_meses: number;
    intervalo_manutencao_dias: number;
    data_aplicacao: string;
    data_vencimento: string;
    observacoes?: string | null;
    status: 'ativo' | 'manutencao_pendente' | 'expirado' | 'cancelado';
    dias_restantes: number;
    dias_passados: number;
    percentual_decorrido: number;
    proxima_revisao_data: string;
    proxima_revisao_dias: number;
    total_revisoes_feitas: number;
  };
  oficina: {
    id: string;
    nome: string;
    slug?: string | null;
    logo_path?: string | null;
    capa_path?: string | null;
    telefone?: string | null;
    endereco?: string | null;
    cidade?: string | null;
    estado?: string | null;
  };
  cliente: {
    nome: string;
    telefone: string;
  };
  veiculo: {
    marca?: string | null;
    modelo: string;
    placa: string;
    cor?: string | null;
    ano?: number | null;
  };
  manutencoes: CertificadoManutencao[];
}
