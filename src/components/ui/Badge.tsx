import React from 'react';
import type { StatusServico } from '../../types';

export type BadgeTone = 'amber' | 'mint' | 'glass' | 'vapor' | 'flare' | 'emerald' | 'rose' | 'graphite' | 'cyan';

interface BadgeProps {
  status?: StatusServico;
  tone?: BadgeTone;
  className?: string;
  children?: React.ReactNode;
}

const statusConfig: Record<StatusServico, { label: string; className: string }> = {
  agendado: { label: 'Agendado', className: 'text-vapor-100 bg-vapor-600/20' },
  em_andamento: { label: 'Em andamento', className: 'text-amber-500 bg-amber-500/10' },
  concluido: { label: 'Concluído', className: 'text-mint-400 bg-mint-400/10' },
  atrasado: { label: 'Atrasado', className: 'text-flare-400 bg-flare-400/10' },
};

const toneStyles: Record<string, string> = {
  amber: 'text-amber-400 bg-amber-500/10 border border-amber-500/30',
  mint: 'text-mint-400 bg-mint-400/10 border border-mint-400/20',
  emerald: 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/30',
  cyan: 'text-cyan-400 bg-cyan-500/10 border border-cyan-500/30',
  rose: 'text-rose-400 bg-rose-500/10 border border-rose-500/30',
  graphite: 'text-vapor-400 bg-graphite-800 border border-graphite-700',
  glass: 'text-vapor-100 bg-graphite-700/60 border border-graphite-600',
  vapor: 'text-vapor-400 bg-graphite-800 border border-graphite-600',
  flare: 'text-flare-400 bg-flare-400/10 border border-flare-400/20',
};

export const Badge: React.FC<BadgeProps> = ({ status, tone = 'amber', className = '', children }) => {
  if (status) {
    const config = statusConfig[status];
    return (
      <span className={`px-2 py-1 rounded-[4px] font-sans text-[12px] font-semibold tracking-wide ${config.className} ${className}`}>
        {children || config.label}
      </span>
    );
  }

  const style = toneStyles[tone] || toneStyles.amber;

  return (
    <span className={`px-2 py-0.5 rounded-[4px] font-sans text-[11px] font-semibold uppercase tracking-wider inline-flex items-center gap-1 ${style} ${className}`}>
      {children}
    </span>
  );
};
