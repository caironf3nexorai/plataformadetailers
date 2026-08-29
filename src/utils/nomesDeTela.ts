/**
 * Mapeador central de rotas de URL para nomes legíveis de tela.
 * Usado em modais de feedback, relatórios e navegação.
 */

export interface MapeamentoRota {
  padrao: RegExp;
  nome: string;
}

const ROTAS_MAPEADAS: MapeamentoRota[] = [
  // Dashboard principal
  { padrao: /^\/$/, nome: 'Painel Principal (Hoje)' },
  { padrao: /^\/dashboard$/, nome: 'Painel de Gestão' },

  // Atendimentos / Agenda
  { padrao: /^\/agenda$/, nome: 'Agenda de Atendimentos' },
  { padrao: /^\/atendimentos\/[^\/]+$/, nome: 'Detalhes do Atendimento' },
  { padrao: /^\/execucao\/[^\/]+$/, nome: 'Execução do Atendimento' },
  { padrao: /^\/checkin\/[^\/]+$/, nome: 'Vistoria de Entrada' },
  { padrao: /^\/checkout\/[^\/]+$/, nome: 'Vistoria de Saída' },

  // Clientes e Veículos
  { padrao: /^\/clientes$/, nome: 'Lista de Clientes' },
  { padrao: /^\/clientes\/[^\/]+$/, nome: 'Ficha do Cliente' },
  { padrao: /^\/veiculos\/[^\/]+$/, nome: 'Ficha do Veículo' },

  // Orçamentos
  { padrao: /^\/orcamentos$/, nome: 'Orçamentos' },
  { padrao: /^\/orcamentos\/[^\/]+$/, nome: 'Detalhes do Orçamento' },

  // Serviços e Catálogo
  { padrao: /^\/servicos$/, nome: 'Catálogo de Serviços' },
  { padrao: /^\/servicos\/novo$/, nome: 'Novo Serviço' },
  { padrao: /^\/servicos\/precificacao$/, nome: 'Precificação Inteligente' },
  { padrao: /^\/servicos\/[^\/]+$/, nome: 'Editar Serviço' },
  { padrao: /^\/servicos\/matriz$/, nome: 'Matriz de Preços' },

  // Financeiro
  { padrao: /^\/financeiro$/, nome: 'Painel Financeiro' },
  { padrao: /^\/financeiro\/contas-a-receber$/, nome: 'Contas a Receber' },
  { padrao: /^\/financeiro\/formas-pagamento$/, nome: 'Formas de Pagamento' },

  // Recursos e Treinamentos
  { padrao: /^\/treinamentos?$/, nome: 'Academia Detailer' },
  { padrao: /^\/academia$/, nome: 'Academia Detailer' },
  { padrao: /^\/arquivos-digitais$/, nome: 'Arquivos Digitais' },
  { padrao: /^\/diluicao$/, nome: 'Calculadora de Diluição' },
  { padrao: /^\/indique$/, nome: 'Indique e Ganhe' },

  // Estoque
  { padrao: /^\/estoque$/, nome: 'Controle de Estoque' },

  // Vistorias & Galeria
  { padrao: /^\/vistorias$/, nome: 'Histórico de Vistorias' },
  { padrao: /^\/vistorias\/expirando$/, nome: 'Fotos Prestes a Expirar' },

  // Minha Oficina / Configurações
  { padrao: /^\/configuracoes$/, nome: 'Minha Oficina' },
  { padrao: /^\/minha-oficina$/, nome: 'Minha Oficina' },
  { padrao: /^\/configuracoes\/equipe$/, nome: 'Gestão da Equipe' },

  // Páginas Jurídicas
  { padrao: /^\/termos-(?:de-)?uso$/, nome: 'Termos de Uso' },
  { padrao: /^\/politica-(?:de-)?privacidade$/, nome: 'Política de Privacidade' },

  // Admin da Plataforma
  { padrao: /^\/admin$/, nome: 'Painel Admin' },
  { padrao: /^\/admin\/oficinas$/, nome: 'Admin - Oficinas' },
  { padrao: /^\/admin\/planos$/, nome: 'Admin - Planos' },
  { padrao: /^\/admin\/permissoes$/, nome: 'Admin - Permissões' },
  { padrao: /^\/admin\/feedbacks$/, nome: 'Admin - Feedbacks' },
];

/**
 * Converte um pathname da URL (ex: /clientes/7eab290d-a525-4a55-bb8b-c4f4227da698)
 * em um nome amigável (ex: "Ficha do Cliente").
 */
export function obterNomeDaTela(pathname: string): string {
  if (!pathname) return 'Início';
  
  // Limpa trailing slash se houver
  const cleanPath = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

  for (const rota of ROTAS_MAPEADAS) {
    if (rota.padrao.test(cleanPath)) {
      return rota.nome;
    }
  }

  // Fallback inteligente para rotas não mapeadas especificamente
  const partes = cleanPath.split('/').filter(Boolean);
  if (partes.length === 0) return 'Início';

  const primeiraParte = partes[0].toLowerCase();
  switch (primeiraParte) {
    case 'clientes':
      return 'Ficha do Cliente';
    case 'veiculos':
      return 'Ficha do Veículo';
    case 'atendimentos':
    case 'agendamentos':
      return 'Atendimentos';
    case 'execucao':
      return 'Execução do Atendimento';
    case 'checkin':
      return 'Vistoria de Entrada';
    case 'checkout':
      return 'Vistoria de Saída';
    case 'orcamentos':
      return 'Orçamentos';
    case 'servicos':
      return 'Catálogo de Serviços';
    case 'financeiro':
      return 'Financeiro';
    case 'treinamentos':
    case 'treinamento':
    case 'academia':
      return 'Academia Detailer';
    case 'arquivos-digitais':
      return 'Arquivos Digitais';
    case 'diluicao':
      return 'Calculadora de Diluição';
    case 'indique':
      return 'Indique e Ganhe';
    case 'configuracoes':
    case 'minha-oficina':
    case 'ajustes':
      return 'Minha Oficina';
    default:
      return primeiraParte.charAt(0).toUpperCase() + primeiraParte.slice(1);
  }
}
