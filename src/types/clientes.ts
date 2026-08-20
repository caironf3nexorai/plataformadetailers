export interface CategoriaVeiculo {
  id: string;
  tenant_id: string;
  nome: string;
  descricao?: string | null;
  ordem: number;
  ativo: boolean;
  created_at: string;
}

export interface Cliente {
  id: string;
  tenant_id: string;
  nome: string;
  telefone: string;
  email?: string | null;
  documento?: string | null;
  observacoes?: string | null;
  origem: 'interno' | 'online';
  ativo: boolean;
  created_at: string;
  updated_at: string;
  // Relacionamentos virtuais para UI
  veiculos?: Veiculo[];
}

export interface Veiculo {
  id: string;
  tenant_id: string;
  cliente_id?: string | null;
  categoria_id: string;
  placa: string;
  marca?: string | null;
  modelo?: string | null;
  cor?: string | null;
  ano?: number | null;
  observacoes?: string | null;
  ativo: boolean;
  created_at: string;
  updated_at: string;
  // Relacionamentos virtuais para UI
  categoria?: CategoriaVeiculo;
  cliente?: Cliente;
}

export interface VeiculoDono {
  id: string;
  tenant_id: string;
  veiculo_id: string;
  cliente_id: string;
  inicio: string;
  fim?: string | null;
  created_at: string;
  cliente?: Cliente;
}
