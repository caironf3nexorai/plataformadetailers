import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, CalendarDays, Users, TrendingUp, Menu } from 'lucide-react';
import { usePermissao } from '../../hooks/usePermissao';

interface BottomNavProps {
  onOpenMenu?: () => void;
  isMenuOpen?: boolean;
}

export const BottomNav: React.FC<BottomNavProps> = ({ onOpenMenu, isMenuOpen }) => {
  const { isOperador, podeVerFinanceiro } = usePermissao();

  // Para Dono e Gerente: 5 itens (Painel, Agenda, Clientes, Financeiro, Menu)
  // Para Operador: 3 itens (Agenda, Clientes, Menu)
  // Botões inacessíveis para o papel NÃO existem na barra.
  const navItems = isOperador
    ? [
        { path: '/agenda', label: 'Agenda', icon: CalendarDays },
        { path: '/clientes', label: 'Clientes', icon: Users },
      ]
    : [
        { path: '/', label: 'Painel', icon: LayoutDashboard },
        { path: '/agenda', label: 'Agenda', icon: CalendarDays },
        { path: '/clientes', label: 'Clientes', icon: Users },
        ...(podeVerFinanceiro() ? [{ path: '/financeiro', label: 'Financeiro', icon: TrendingUp }] : []),
      ];

  return (
    <nav 
      className="lg:hidden fixed bottom-0 left-0 right-0 bg-graphite-900 border-t border-graphite-700 z-40 flex items-center justify-around px-1 shadow-lg"
      style={{ 
        paddingBottom: 'max(6px, env(safe-area-inset-bottom, 0px))',
        height: 'calc(58px + env(safe-area-inset-bottom, 0px))',
      }}
    >
      {navItems.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.path === '/'}
          className={({ isActive }) =>
            `flex flex-col items-center justify-center flex-1 h-full min-h-[44px] transition-colors ${
              isActive ? 'text-amber-500 font-semibold' : 'text-vapor-400 hover:text-vapor-100'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <item.icon size={21} className={isActive ? 'text-amber-500' : 'text-vapor-400'} />
              <span className="font-sans text-[10.5px] mt-0.5 tracking-tight">
                {item.label}
              </span>
            </>
          )}
        </NavLink>
      ))}

      {/* Botão de Menu Interativo que aciona o Drawer Mobile */}
      <button
        type="button"
        onClick={onOpenMenu}
        className={`flex flex-col items-center justify-center flex-1 h-full min-h-[44px] transition-colors ${
          isMenuOpen ? 'text-amber-500 font-semibold' : 'text-vapor-400 hover:text-vapor-100'
        }`}
        title="Abrir menu de funcionalidades"
      >
        <Menu size={22} className={isMenuOpen ? 'text-amber-500' : 'text-vapor-400'} />
        <span className="font-sans text-[10.5px] mt-0.5 tracking-tight">
          Menu
        </span>
      </button>
    </nav>
  );
};
