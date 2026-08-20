export type AppRole = 'dono' | 'gerente' | 'operador';
export type PlanCode = 'free' | 'pro' | 'studio';
export type ComissaoTipo = 'nenhuma' | 'percentual' | 'valor_fixo';
export type MemberStatus = 'ativo' | 'convidado' | 'inativo';

export interface Profile {
  id: string;
  nome: string;
  telefone?: string | null;
  created_at?: string;
}

export interface Tenant {
  id: string;
  nome: string;
  slug: string;
  plano: PlanCode;
  telefone?: string | null;
  cidade?: string | null;
  uf?: string | null;
  criado_por: string;
  capa_path?: string | null;
  logo_path?: string | null;
  logo_url?: string | null;
  documento?: string | null;
  documento_tipo?: 'cpf' | 'cnpj' | null;
  razao_social?: string | null;
  orcamento_agendamento_cliente?: boolean;
  orcamento_validade_dias?: number;
  antecedencia_minima_horas?: number;
  pdf_cor_primaria?: string | null;
  pdf_cor_fundo_cabecalho?: string | null;
  pdf_cor_texto_cabecalho?: string | null;
  pdf_cor_fundo_secoes?: string | null;
  pdf_subtitulo_cabecalho?: string | null;
  pdf_texto_observacoes_orcamento?: string | null;
  pdf_texto_rodape?: string | null;
  pdf_ocultar_marca_dagua?: boolean | null;
  created_at?: string;
  updated_at?: string;
}

export interface TenantMember {
  id: string;
  tenant_id: string;
  user_id?: string | null;
  email: string;
  role: AppRole;
  status: MemberStatus;
  convite_token?: string | null;
  created_at?: string;
  nome_usuario?: string; // vindo de join com profiles se disponível
}

export interface ComissaoRegra {
  id: string;
  tenant_id: string;
  member_id: string;
  tipo: ComissaoTipo;
  valor: number;
  vigencia_inicio: string;
  vigencia_fim?: string | null;
  criado_por: string;
  created_at?: string;
}

export interface Plan {
  codigo: PlanCode;
  nome: string;
  preco_centavos: number;
  ativo: boolean;
}

export interface PlanLimit {
  plano: PlanCode;
  recurso: string;
  limite: number | null;
}
