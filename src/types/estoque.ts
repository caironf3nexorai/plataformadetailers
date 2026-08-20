export type CategoriaProduto = 'Lavagem' | 'Polimento' | 'Proteção' | 'Interior' | 'Vidros' | 'Insumos' | 'Geral';
export type UnidadeUso = 'ml' | 'g' | 'un';
export type UnidadeCompraDisplay = 'L' | 'ml' | 'kg' | 'g' | 'un';

export interface Produto {
  id: string;
  tenant_id: string;
  nome: string;
  marca?: string;
  categoria: CategoriaProduto | string;
  unidade_uso: UnidadeUso;
  tamanho_compra: number;
  preco_compra: number;
  custo_unitario: number;
  estoque_atual: number;
  estoque_minimo: number;
  rendimento_medio?: number;
  ativo: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ProdutoParaConsumo {
  id: string;
  nome: string;
  marca?: string;
  categoria: string;
  unidade_uso: UnidadeUso;
}

export interface SugestaoConsumo {
  produto_id: string;
  nome: string;
  marca?: string;
  unidade_uso: UnidadeUso;
  quantidade: number;
  frequencia: number;
  percentual_frequencia: number;
}

export interface ItemConsumoExecucao {
  produto_id: string;
  nome: string;
  marca?: string;
  unidade_uso: UnidadeUso;
  quantidade: number | string;
  custo_unitario?: number;
  custo_total?: number;
  sugerido?: boolean;
}

export interface HistoricoConsumoItem {
  execucao_id: string;
  concluido_em?: string;
  servicos_nomes: string;
  produto_nome: string;
  produto_marca?: string;
  quantidade: number;
  unidade_uso: string;
  custo_unitario: number;
  custo_total: number;
}
