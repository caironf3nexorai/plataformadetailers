import React from 'react';
import { Sparkles, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface TrialBannerProps {
  diasRestantes: number;
}

export const TrialBanner: React.FC<TrialBannerProps> = ({ diasRestantes }) => {
  const navigate = useNavigate();

  // Exibir somente quando faltar 3 dias ou menos
  if (diasRestantes > 3) return null;

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2.5 text-xs text-amber-200 flex items-center justify-between flex-wrap gap-2 sticky top-0 z-40">
      <div className="flex items-center gap-2.5">
        <div className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
          <Sparkles size={14} />
        </div>
        <span>
          <strong className="font-semibold text-amber-100">Teste Grátis do Plano Pro:</strong> Restam{' '}
          <strong className="text-amber-400 font-mono font-bold">{diasRestantes} dia(s)</strong> de degustação. Assine agora para manter o acesso ininterrupto.
        </span>
      </div>

      <button
        onClick={() => navigate('/planos')}
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-500 text-graphite-950 font-bold hover:bg-amber-400 transition-colors text-xs shrink-0 shadow-sm"
      >
        Ver Planos e Assinar
        <ArrowRight size={12} />
      </button>
    </div>
  );
};
