export type StatusOrcamento = 
  | 'rascunho'
  | 'enviado'
  | 'visualizado'
  | 'aprovado'
  | 'recusado'
  | 'expirado';

export type TipoNivelOrcamento = 'essencial' | 'recomendado' | 'completo';

export interface OrcamentoNivelItem {
  id: string;
  tenant_id: string;
  nivel_id: string;
  servico_id: string;
  combo_id?: string | null;
  preco: number;
  duracao_minutos: number;
  incluido: boolean;
  ordem: number;
  servico?: {
    id: string;
    nome: string;
    codigo?: string;
    tom?: string;
    descricao_publica?: string;
  };
}

export interface OrcamentoNivel {
  id: string;
  tenant_id: string;
  orcamento_id: string;
  nivel: TipoNivelOrcamento;
  titulo: string;
  descricao?: string | null;
  valor_total: number;
  duracao_total: number;
  destaque: boolean;
  ordem: number;
  itens?: OrcamentoNivelItem[];
}

export interface Orcamento {
  id: string;
  tenant_id: string;
  numero: number;
  numero_os?: number | null;
  cliente_id: string;
  veiculo_id?: string | null;
  categoria_id: string;
  titulo?: string | null;
  observacoes?: string | null;
  status: StatusOrcamento;
  nivel_aprovado?: TipoNivelOrcamento | null;
  validade_dias: number;
  enviado_em?: string | null;
  visualizado_em?: string | null;
  respondido_em?: string | null;
  token_publico: string;
  agendamento_id?: string | null;
  criado_por: string;
  created_at: string;
  updated_at: string;
  desconto_tipo?: 'porcentagem' | 'valor_fixo' | null;
  desconto_valor?: number;
  desconto_motivo?: string | null;
  desconto_cupom_codigo?: string | null;
  desconto_aplicado_por?: string | null;
  desconto_aplicado_em?: string | null;
  cliente?: {
    id: string;
    nome: string;
    telefone?: string;
  };
  veiculo?: {
    id: string;
    placa: string;
    modelo?: string;
    marca?: string;
  };
  categoria?: {
    id: string;
    nome: string;
  };
  niveis?: OrcamentoNivel[];
}

export interface OrcamentoPublicoItem {
  servico_id: string;
  servico_nome: string;
  servico_descricao?: string | null;
  preco: number;
  duracao_minutos: number;
}

export interface OrcamentoPublicoNivel {
  nivel: TipoNivelOrcamento;
  titulo: string;
  descricao?: string | null;
  valor_original?: number;
  valor_total: number;
  duracao_total: number;
  destaque: boolean;
  ordem: number;
  itens: OrcamentoPublicoItem[];
}

export interface OrcamentoPublicoData {
  numero: number;
  numero_os?: number | null;
  titulo?: string | null;
  observacoes?: string | null;
  status: StatusOrcamento;
  nivel_aprovado?: TipoNivelOrcamento | null;
  categoria_id?: string;
  itens_aprovados?: Array<{ servico_id: string; combo_id?: string | null }>;
  validade_dias: number;
  enviado_em?: string | null;
  data_validade_limite?: string | null;
  alteracao_pendente?: boolean;
  alteracao_historico?: Array<{
    id: string;
    solicitado_em: string;
    nivel: string;
    titulo_nivel: string;
    valor_total: number;
    motivo: string;
    status: 'pendente' | 'assinado';
    assinado_em?: string;
    assinante?: string;
  }>;
  assinatura_data?: string | null;
  assinatura_nome?: string | null;
  assinatura_url?: string | null;
  cliente_telefone?: string | null;
  desconto?: {
    tipo: 'porcentagem' | 'valor_fixo';
    valor: number;
    motivo?: string | null;
    cupom_codigo?: string | null;
    aplicado_em?: string | null;
    aplicado_por_nome?: string | null;
  } | null;
  oficina: {
    tenant_id?: string;
    nome: string;
    razao_social?: string | null;
    documento?: string | null;
    documento_tipo?: 'cpf' | 'cnpj' | null;
    logo_path?: string | null;
    logo_url?: string | null;
    telefone?: string | null;
    cidade?: string | null;
    uf?: string | null;
    orcamento_agendamento_cliente?: boolean;
    antecedencia_minima_horas?: number;
    pdf_texto_observacoes_orcamento?: string | null;
  };
  cliente_primeiro_nome: string;
  veiculo?: {
    placa: string;
    modelo?: string | null;
    marca?: string | null;
  } | null;
  agendamento?: {
    id: string;
    inicio: string;
    status: string;
    numero_os?: number | null;
    duracao_total?: number;
    preco_estimado_total?: number;
    previsao_entrega?: string | null;
    sinal?: {
      ativo: boolean;
      valor: number;
      status?: string;
      pix_chave?: string | null;
      pix_payload?: string | null;
    } | null;
  } | null;
  niveis: OrcamentoPublicoNivel[];
  erro?: string;
}
