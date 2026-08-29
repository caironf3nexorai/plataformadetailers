import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import { Menu, FlaskConical } from 'lucide-react';
import { usePermissao } from '../../hooks/usePermissao';

interface TopBarProps {
  onOpenMenu?: () => void;
  isMenuOpen?: boolean;
}

const routeNames: Record<string, string> = {
  '/': 'Dashboard',
  '/dashboard': 'Dashboard',
  '/hoje': 'Agenda',
  '/agenda': 'Agenda',
  '/clientes': 'Clientes',
  '/orcamentos': 'Orçamentos',
  '/servicos': 'Serviços',
  '/servicos/precificacao': 'Precificação Inteligente',
  '/estoque': 'Estoque',
  '/financeiro': 'Financeiro',
  '/financeiro/contas-a-receber': 'Contas a Receber',
  '/financeiro/taxas': 'Formas & Taxas',
  '/treinamentos': 'Academia Detailer',
  '/treinamento': 'Academia Detailer',
  '/arquivos-digitais': 'Arquivos Digitais',
  '/indique': 'Indique e Ganhe',
  '/configuracoes': 'Minha Oficina',
  '/minha-oficina': 'Minha Oficina',
  '/diluicao': 'Calculadora de Diluição',
  '/planos': 'Planos de Assinatura',
};

export const TopBar: React.FC<TopBarProps> = ({ onOpenMenu, isMenuOpen }) => {
  const location = useLocation();
  const { isOperador } = usePermissao();

  let title = routeNames[location.pathname];
  if (!title) {
    if (location.pathname.startsWith('/clientes/')) title = 'Detalhes do Cliente';
    else if (location.pathname.startsWith('/veiculos/')) title = 'Detalhes do Veículo';
    else if (location.pathname.startsWith('/orcamentos/')) title = 'Detalhes do Orçamento';
    else if (location.pathname.startsWith('/servicos/')) title = 'Configurar Serviço';
    else if (location.pathname.startsWith('/checkin/')) title = 'Vistoria de Entrada';
    else if (location.pathname.startsWith('/execucao/')) title = 'Execução de Serviço';
    else if (location.pathname.startsWith('/atendimento/')) title = 'Atendimento Concluído';
    else title = 'Plataforma Detailers';
  }

  // Se operador estiver na rota '/', o título coerente é Agenda
  if (location.pathname === '/' && isOperador) {
    title = 'Agenda';
  }

  return (
    <header 
      className="lg:hidden fixed top-0 left-0 right-0 h-[60px] bg-graphite-900/95 backdrop-blur-md border-b border-graphite-700 flex items-center justify-between px-4 z-40 shadow-sm"
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
    >
      <h1 className="font-display text-[15.5px] font-bold text-vapor-100 tracking-wider truncate max-w-[200px] sm:max-w-xs">
        {title}
      </h1>

      <div className="flex items-center gap-1.5">
        <Link
          to="/diluicao"
          title="Calculadora de Diluição"
          className={`p-2 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center ${
            location.pathname === '/diluicao' 
              ? 'text-amber-500 bg-graphite-800' 
              : 'text-vapor-300 hover:text-amber-400 hover:bg-graphite-800/60'
          }`}
        >
          <FlaskConical size={20} />
        </Link>
        <button 
          type="button"
          onClick={onOpenMenu}
          aria-label="Abrir menu de navegação"
          className={`p-2 -mr-1 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center ${
            isMenuOpen ? 'text-amber-500 bg-graphite-800' : 'text-vapor-200 hover:text-amber-400 hover:bg-graphite-800/60'
          }`}
        >
          <Menu size={22} />
        </button>
      </div>
    </header>
  );
};
