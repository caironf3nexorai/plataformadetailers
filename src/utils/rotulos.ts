/**
 * Dicionário central de rótulos e traduções para enums, status e tipos do sistema.
 * Impede que valores crus com sublinhado ou termos técnicos sejam exibidos ao usuário.
 */

const MAPA_ROTULOS: Record<string, string> = {
  // Status de Agendamento / Atendimento
  pendente: 'Pendente',
  confirmado: 'Confirmado',
  em_andamento: 'Em andamento',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
  atrasado: 'Atrasado',
  aguardando_confirmacao: 'Aguardando confirmação',

  // Status de Orçamentos
  rascunho: 'Rascunho',
  enviado: 'Enviado ao cliente',
  aprovado: 'Aprovado pelo cliente',
  rejeitado: 'Recusado',
  expirado: 'Expirado',

  // Status de Pagamento / Transações
  pago: 'Pago',
  parcial: 'Pago parcialmente',
  estornado: 'Estornado',

  // Modos de Ocupação de Agenda
  slot: 'Slot de tempo',
  dia_inteiro: 'Dia inteiro',
  multiplos_dias: 'Múltiplos dias',

  // Formas / Origens / Regras de Agendamento
  sinal_agendamento: 'Sinal de agendamento',
  agendamento_online: 'Agendamento online',
  balcao: 'Entrada de balcão',
  manual: 'Cadastro manual',
  valor_fixo: 'Valor fixo',
  percentual: 'Percentual (%)',
  nao_aplicavel: 'Não se aplica',
  transborda: 'Excede capacidade',

  // Preservação de Mídia / Vistorias
  preservada: 'Fotos mantidas',
  expirando: 'A expirar em breve',
  expirada: 'Fotos expiradas',

  // Financeiro / Métricas
  faturamento: 'Faturamento bruto',
  lucro_liquido: 'Lucro líquido',
  carros: 'Veículos atendidos',

  // Perfis / Papéis de Usuário (Roles)
  owner: 'Proprietário (Dono)',
  gerente: 'Gerente da oficina',
  operador: 'Operador / Técnico',
  admin: 'Administrador',
};

/**
 * Formata qualquer valor de enum ou status para uma string legível em português.
 * Se o valor não estiver no dicionário, remove sublinhados e capitaliza adequadamente.
 */
export function formatarRotulo(valor: string | null | undefined): string {
  if (!valor) return '';
  const chave = String(valor).toLowerCase().trim();

  if (MAPA_ROTULOS[chave]) {
    return MAPA_ROTULOS[chave];
  }

  // Fallback: substitui _ por espaço e coloca primeira letra maiúscula
  const textoLimpo = chave.replace(/_/g, ' ');
  return textoLimpo.charAt(0).toUpperCase() + textoLimpo.slice(1);
}

/**
 * Traduz termos técnicos específicos que possam vazar no UI.
 */
export function formatarTermoTecnico(termo: string): string {
  if (!termo) return '';
  const str = String(termo).toLowerCase();
  
  if (str.includes('tenant')) return str.replace(/tenant/g, 'oficina');
  if (str.includes('user_id')) return 'ID do Usuário';
  if (str.includes('cliente_id')) return 'Cliente';
  if (str.includes('veiculo_id')) return 'Veículo';
  
  return formatarRotulo(termo);
}
