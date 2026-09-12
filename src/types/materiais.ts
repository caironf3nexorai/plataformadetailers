export type CategoriaMaterial = 
  | 'Precificação'
  | 'Tráfego Pago'
  | 'Gestão & Vendas'
  | 'Técnica & Polimento'
  | 'Checklists & Processos'
  | 'Geral';

export const CATEGORIAS_MATERIAIS: CategoriaMaterial[] = [
  'Precificação',
  'Tráfego Pago',
  'Gestão & Vendas',
  'Técnica & Polimento',
  'Checklists & Processos',
  'Geral'
];

export interface AcademiaMaterial {
  id: string;
  titulo: string;
  descricao: string | null;
  categoria: CategoriaMaterial | string;
  arquivo_path: string;
  arquivo_nome: string;
  tamanho_bytes: number;
  total_paginas: number;
  capa_url: string | null;
  permitir_download: boolean; // false = 🔒 Apenas Leitor Seguro (DRM Anti-Cópia), true = 📥 Download Liberado
  planos_permitidos: string[];
  ordem: number;
  ativo?: boolean;
  visualizacoes_count?: number;
  downloads_count?: number;
  disponivel_no_plano_atual?: boolean;
  created_at: string;
}
