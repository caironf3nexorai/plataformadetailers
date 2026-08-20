export type VistaDiagrama = 'frente' | 'traseira' | 'lateral_esquerda' | 'lateral_direita' | 'superior';

export type TipoAvaria = 'risco' | 'amassado' | 'avariado' | 'faltante';

export type EstadoIluminacao = 'ok' | 'queimado' | 'nao_testado';

export type NivelSujidade = 'limpo' | 'leve' | 'medio' | 'sujo' | 'extremo';

export type EstadoFluido = 'ok' | 'baixo' | 'ruim' | 'nao_verificado';

export interface Checkin {
  id: string;
  tenant_id: string;
  agendamento_id: string;
  veiculo_id: string | null;
  km: number | null;
  nivel_combustivel: number | null; // 0 a 8 (oitavos)
  luzes_painel: string[];
  estepe: boolean | null;
  iluminacao: Record<string, EstadoIluminacao>;
  sujidade: Record<string, NivelSujidade>;
  fluidos: Record<string, EstadoFluido>;
  observacoes: string | null;
  assinatura_path: string | null;
  assinado_em: string | null;
  assinatura_nome: string | null;
  token_aceite?: string;
  aceite_tipo?: 'presencial' | 'remoto' | null;
  aceite_ip?: string | null;
  aceite_user_agent?: string | null;
  enviado_em?: string | null;
  tentativas_aceite?: number;
  finalizado: boolean;
  criado_por: string;
  created_at: string;
  updated_at: string;
}

export interface CheckinAvaria {
  id: string;
  tenant_id: string;
  checkin_id: string;
  vista: VistaDiagrama;
  pos_x: number; // 0-100
  pos_y: number; // 0-100
  tipo: TipoAvaria;
  descricao: string | null;
  created_at: string;
}

export interface CheckinFoto {
  id: string;
  tenant_id: string;
  checkin_id: string;
  avaria_id: string | null;
  path: string;
  descricao: string | null;
  enviado_por: string;
  created_at: string;
}
