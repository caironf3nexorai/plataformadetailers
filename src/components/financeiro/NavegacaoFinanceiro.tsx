import React from 'react';
import { NavLink } from 'react-router-dom';
import { TrendingUp, Clock, CreditCard } from 'lucide-react';

export const NavegacaoFinanceiro: React.FC = () => {
  const tabs = [
    {
      to: '/financeiro',
      label: 'DRE & Saúde',
      icon: TrendingUp,
      end: true,
    },
    {
      to: '/financeiro/contas-a-receber',
      label: 'Contas a Receber',
      icon: Clock,
      end: false,
    },
    {
      to: '/financeiro/taxas',
      label: 'Formas & Taxas',
      icon: CreditCard,
      end: false,
    },
  ];

  return (
    <div className="flex items-center gap-2 border-b border-graphite-800 pb-3 mb-2 overflow-x-auto">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                isActive
                  ? 'bg-amber-500 text-graphite-950 shadow-md shadow-amber-500/10'
                  : 'bg-graphite-900 text-vapor-400 hover:text-vapor-100 hover:bg-graphite-800 border border-graphite-800'
              }`
            }
          >
            <Icon size={16} />
            <span>{tab.label}</span>
          </NavLink>
        );
      })}
    </div>
  );
};
