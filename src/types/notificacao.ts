export type TipoNotificacao = 
  | 'orcamento_aprovado' 
  | 'agendamento_novo' 
  | 'feedback_respondido' 
  | 'feedback_novo' 
  | 'erro_sistema' 
  | 'downgrade_oficina' 
  | 'nova_oficina' 
  | 'sistema_geral';

export type DestinoNotificacao = 'oficina' | 'admin' | 'usuario';
export type PapelMinimoNotificacao = 'operador' | 'gerente' | 'dono';

export interface ItemNotificacao {
  id: string;
  tenant_id: string | null;
  destino: DestinoNotificacao;
  papel_minimo: PapelMinimoNotificacao;
  tipo: TipoNotificacao;
  titulo: string;
  mensagem: string;
  link?: string | null;
  lida: boolean;
  lida_em?: string | null;
  metadata?: Record<string, any>;
  created_at: string;
}
