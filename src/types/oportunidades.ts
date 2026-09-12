export interface RegraRetorno {
  id: string;
  titulo: string;
  servico_id?: string | null;
  servico_nome?: string | null;
  palavra_chave?: string | null;
  dias_retorno: number;
  mensagem_whatsapp: string;
  ativo: boolean;
  ordem: number;
  created_at?: string;
}

export interface OportunidadeRetorno {
  agendamento_id: string;
  cliente_id: string;
  cliente_nome: string;
  cliente_telefone: string;
  veiculo_id: string;
  veiculo_modelo: string;
  veiculo_placa: string;
  servico_id?: string | null;
  servico_nome: string;
  valor_servico: number;
  data_servico: string;
  dias_passados: number;
  regra_id: string;
  regra_titulo: string;
  dias_retorno_configurado: number;
  data_prevista_retorno: string;
  status_retorno: 'vencido' | 'proximo' | 'em_dia';
  ultimo_contato_em?: string | null;
  mensagem_whatsapp_formatada: string;
}
