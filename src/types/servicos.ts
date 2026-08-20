import type { CategoriaVeiculo } from './clientes';
export type { CategoriaVeiculo };

export type ModoOcupacao = 'slot' | 'dia_inteiro' | 'multiplos_dias' | 'transborda';
export type TomChip = 'amber' | 'glass' | 'mint' | 'vapor';

export interface Servico {
  id: string;
  tenant_id: string;
  nome: string;
  grupo: string;
  descricao_interna: string | null;
  descricao_publica: string | null;
  codigo: string | null;
  tom: TomChip;
  modo_ocupacao: ModoOcupacao;
  dias_ocupados: number;
  publico: boolean;
  sob_consulta: boolean;
  foto_path: string | null;
  ordem: number;
  ativo: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ServicoPreco {
  id: string;
  tenant_id: string;
  servico_id: string;
  categoria_id: string;
  preco_base: number | null; // Null se for "Sob Consulta" ou não definido
  duracao_minutos: number;
  duracao_confirmada: boolean;
  ativo: boolean;
  created_at?: string;
  updated_at?: string;
  // Join opcional
  categoria?: CategoriaVeiculo;
}

export interface ServicoModelo {
  id: string;
  nome: string;
  grupo: string;
  descricao_publica: string | null;
  codigo: string;
  modo_ocupacao: ModoOcupacao;
  duracao_sugerida: number;
  ordem: number;
}

export interface MatrizPrecoLinha {
  categoria_id: string;
  preco_base: number | null;
  duracao_minutos: number;
  duracao_confirmada?: boolean;
}

export interface TenantGrupoFoto {
  tenant_id: string;
  grupo: string;
  grupo_slug: string;
  foto_path: string;
  created_at?: string;
  updated_at?: string;
}

export interface Combo {
  id: string;
  tenant_id: string;
  nome: string;
  descricao_publica: string | null;
  codigo: string | null;
  publico: boolean;
  ativo: boolean;
  ordem: number;
  foto_path: string | null;
  created_at?: string;
  updated_at?: string;
  combo_servicos?: ComboServico[];
  combo_precos?: ComboPreco[];
}

export interface ComboServico {
  combo_id: string;
  servico_id: string;
  ordem: number;
  servico?: Servico;
}

export interface ComboPreco {
  id?: string;
  tenant_id?: string;
  combo_id: string;
  categoria_id: string;
  preco_base?: number | null;
  preco?: number;
  categoria?: CategoriaVeiculo;
}

