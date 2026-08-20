export type CategoriaDespesa = 'Instalacao' | 'Pessoal' | 'Servicos' | 'Impostos' | 'Outros' | 'Geral';
export type TipoDespesa = 'recorrente' | 'parcelada' | 'variavel';

export interface DespesaFixa {
  id: string;
  tenant_id: string;
  nome: string;
  categoria: CategoriaDespesa;
  tipo: TipoDespesa;
  total_parcelas?: number | null;
  parcela_inicial?: number | null;
  valor_mensal: number;
  vigencia_inicio: string;
  vigencia_fim?: string | null;
  confirmado?: boolean;
  confirmado_em?: string | null;
  confirmado_por?: string | null;
  despesa_pai_id?: string | null;
  criado_por: string;
  created_at: string;
}

export interface ResumoFinanceiroComparativo {
  ant_faturamento: number;
  ant_lucro_liquido: number;
  ant_atendimentos: number;
  variacao_faturamento: number;
  variacao_lucro: number;
  variacao_atendimentos: number;
}

export interface ResumoFinanceiro {
  faturamento: number;
  custo_produtos: number;
  custo_comissao: number;
  lucro_bruto: number;
  margem_bruta: number;
  custo_estrutura: number;
  lucro_liquido: number;
  margem_liquida: number;
  atendimentos_count: number;
  ticket_medio: number;
  minutos_trabalhados?: number;
  horas_trabalhadas: number;
  horas_disponiveis: number;
  custo_hora_medio: number;
  tem_despesas: boolean;
  total_despesas_pendentes?: number;
  despesas_pendentes_count?: number;
  comparativo: ResumoFinanceiroComparativo;
}

export interface RentabilidadeServico {
  servico_id: string;
  servico_nome: string;
  servico_codigo: string;
  quantidade: number;
  faturamento_total: number;
  custo_medio: number;
  lucro_liquido_total: number;
  lucro_liquido_medio: number;
  margem_percentual: number;
  tempo_medio_minutos: number;
  lucro_por_hora: number;
}

export interface ComissaoPagar {
  member_id: string;
  nome: string;
  servicos: number;
  total: number;
}

export type TipoFiltroPeriodo = 'hoje' | 'esta_semana' | 'este_mes' | 'mes_passado' | 'personalizado';
