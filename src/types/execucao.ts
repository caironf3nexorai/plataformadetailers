import type { AppRole, ComissaoTipo } from './auth';

export type ExecucaoStatus = 'em_andamento' | 'pausado' | 'finalizado';

export interface ChecklistModelo {
  id: string;
  tenant_id: string;
  nome: string;
  ativo: boolean;
  created_at: string;
  itens?: ChecklistModeloItem[];
}

export interface ChecklistModeloItem {
  id: string;
  tenant_id: string;
  modelo_id: string;
  descricao: string;
  obrigatorio: boolean;
  ordem: number;
  observacao?: string | null;
  created_at: string;
}

export interface Execucao {
  id: string;
  tenant_id: string;
  agendamento_id: string;
  status: ExecucaoStatus;
  iniciado_em: string;
  finalizado_em: string | null;
  segundos_pausados: number;
  segundos_trabalhados?: number;
  pausado_em: string | null;
  retomado_em?: string | null;
  observacoes_saida: string | null;
  valor_total_final: number | null;
  valor_definido_por: string | null;
  valor_definido_em: string | null;
  tempo_efetivo_minutos?: number | null;
  created_at: string;
  updated_at: string;
  itens?: ExecucaoItem[];
  valores?: ExecucaoValor[];
  fotos?: ExecucaoFoto[];
  executores?: ExecucaoExecutor[];
}

export interface ExecucaoItem {
  id: string;
  tenant_id: string;
  execucao_id: string;
  agendamento_item_id: string | null;
  servico_nome: string;
  descricao: string;
  obrigatorio: boolean;
  ordem: number;
  concluido: boolean;
  concluido_em: string | null;
  concluido_por: string | null;
  origem?: 'modelo' | 'avulso';
  observacao?: string | null;
  created_at: string;
}

export interface ExecucaoValor {
  id: string;
  tenant_id: string;
  execucao_id: string;
  agendamento_item_id: string;
  valor_estimado: number | null;
  valor_final: number;
  motivo: string | null;
  created_at: string;
}

export interface ExecucaoFoto {
  id: string;
  tenant_id: string;
  execucao_id: string;
  path: string;
  momento: 'durante' | 'saida';
  descricao: string | null;
  enviado_por: string;
  created_at: string;
  signedUrl?: string;
}

export interface ExecucaoExecutor {
  id: string;
  tenant_id: string;
  execucao_id: string;
  member_id: string;
  principal: boolean;
  comissao_tipo: ComissaoTipo | null;
  comissao_valor: number | null;
  comissao_calculada: number | null;
  created_at: string;
  member?: {
    id: string;
    email: string;
    role: AppRole;
    status?: string;
  };
}
