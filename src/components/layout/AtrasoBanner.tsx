import React from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';

interface AtrasoBannerProps {
  diasParaRebaixamento: number;
  urlPagamentoAsaas?: string | null;
}

export const AtrasoBanner: React.FC<AtrasoBannerProps> = ({
  diasParaRebaixamento,
  urlPagamentoAsaas,
}) => {
  return (
    <div className="bg-rose-500/10 border-b border-rose-500/30 px-4 py-2.5 text-xs text-rose-200 flex items-center justify-between flex-wrap gap-2 sticky top-0 z-40">
      <div className="flex items-center gap-2.5">
        <div className="w-6 h-6 rounded-full bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 shrink-0">
          <AlertTriangle size={14} />
        </div>
        <span>
          <strong className="font-semibold text-rose-100">Pagamento em atraso:</strong> Tolerância de{' '}
          <strong className="text-amber-400 font-mono font-bold">{diasParaRebaixamento} dia(s)</strong> restante(s) antes do rebaixamento para o plano Free. Seus dados permanecem intactos.
        </span>
      </div>

      {urlPagamentoAsaas && (
        <a
          href={urlPagamentoAsaas}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-500 text-graphite-950 font-bold hover:bg-rose-400 transition-colors text-xs shrink-0 shadow-sm"
        >
          Atualizar Pagamento no Asaas
          <ExternalLink size={12} />
        </a>
      )}
    </div>
  );
};
