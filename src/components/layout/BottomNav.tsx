import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, CalendarDays, Users, TrendingUp } from 'lucide-react';
import { usePermissao } from '../../hooks/usePermissao';

export const BottomNav: React.FC = () => {
  const { isOperador, podeVerFinanceiro } = usePermissao();

  const mainNavItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard, visible: !isOperador },
    { path: '/agenda', label: 'Agenda', icon: CalendarDays, visible: true },
    { path: '/clientes', label: 'Clientes', icon: Users, visible: true },
    { path: '/financeiro', label: 'Financeiro', icon: TrendingUp, visible: podeVerFinanceiro() },
  ];

  const visibleItems = mainNavItems.filter((i) => i.visible);

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-graphite-800 border-t border-graphite-600 z-50 flex items-center justify-around pb-safe-area-inset-bottom h-[64px] min-h-[64px] px-2">
      {visibleItems.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          className={({ isActive }) =>
            `flex flex-col items-center justify-center flex-1 h-full min-h-[48px] transition-colors ${
              isActive ? 'text-amber-500' : 'text-vapor-400 hover:text-vapor-100'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <item.icon size={24} className={isActive ? 'text-amber-500' : 'text-vapor-400'} />
              <span className="font-sans text-[10px] mt-1 font-medium">
                {item.label}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
};
