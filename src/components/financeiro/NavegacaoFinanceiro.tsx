import React from 'react';
import { NavLink } from 'react-router-dom';
import { TrendingUp, Clock, CreditCard } from 'lucide-react';
import { ScrollableTabs } from '../ui/ScrollableTabs';

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
    <div className="border-b border-graphite-800 pb-2 mb-3">
      <ScrollableTabs showQuickSelect={false}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                `flex items-center gap-2 px-4 py-2.5 rounded-xl font-display text-[13.5px] uppercase tracking-wide whitespace-nowrap transition-all select-none ${
                  isActive
                    ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-graphite-950 font-bold shadow-md shadow-amber-500/20 border border-amber-400/50 scale-[1.02]'
                    : 'bg-graphite-800/90 text-vapor-300 hover:text-vapor-100 hover:bg-graphite-700/80 border border-graphite-700/80'
                }`
              }
            >
              <Icon size={16} />
              <span>{tab.label}</span>
            </NavLink>
          );
        })}
      </ScrollableTabs>
    </div>
  );
};

