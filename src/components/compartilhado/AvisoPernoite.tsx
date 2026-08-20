import React from 'react';
import { AlertTriangle, Calendar, Clock, ShieldAlert } from 'lucide-react';
import { formatarInformacaoTransbordo } from '../../utils/transbordoUtils';

export interface AvisoPernoiteProps {
  inicioISO: string;
  terminoPrevistoISO?: string | null;
  mode?: 'interno' | 'publico';
  politicaCancelamento?: string | null;
  aceiteCheck?: boolean;
  onAceiteChange?: (checked: boolean) => void;
  theme?: 'amber' | 'emerald';
}

/**
 * Componente Compartilhado de Aviso de Pernoite / Transbordo
 * Utilizado no modal interno de agendamentos e no fluxo público de clientes.
 */
export const AvisoPernoite: React.FC<AvisoPernoiteProps> = ({
  inicioISO,
  terminoPrevistoISO,
  mode = 'interno',
  politicaCancelamento,
  aceiteCheck = false,
  onAceiteChange,
  theme = 'amber'
}) => {
  const info = formatarInformacaoTransbordo(inicioISO, terminoPrevistoISO);

  if (!info) return null;

  // Cálculo das diárias/noites de permanência do veículo
  const calcularNoites = (): number => {
    try {
      const dtInicio = new Date(inicioISO);
      const dtFim = new Date(terminoPrevistoISO!);
      const msPorDia = 1000 * 60 * 60 * 24;
      const diffMs = dtFim.getTime() - dtInicio.getTime();
      const noites = Math.round(diffMs / msPorDia);
      return noites > 0 ? noites : 1;
    } catch {
      return 1;
    }
  };

  const noites = calcularNoites();
  const isEmerald = theme === 'emerald';
  const borderClass = isEmerald ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10';
  const textClass = isEmerald ? 'text-emerald-300' : 'text-amber-300';
  const titleClass = isEmerald ? 'text-emerald-400' : 'text-amber-400';
  const highlightClass = isEmerald ? 'text-emerald-400' : 'text-amber-400';
  const iconColor = isEmerald ? 'text-emerald-400' : 'text-amber-400';

  if (mode === 'interno') {
    return (
      <div className={`p-3.5 ${borderClass} rounded-xl flex items-start gap-2.5 border`}>
        <AlertTriangle size={18} className={`${iconColor} shrink-0 mt-0.5`} />
        <div className="flex flex-col gap-1">
          <span className={`font-sans text-[12px] font-bold ${titleClass}`}>
            Aviso de Agendamento com Pernoite
          </span>
          <p className={`font-sans text-[12px] ${textClass} leading-relaxed`}>
            {info.avisoPernoite}
          </p>
          <span className={`font-mono text-[11px] ${textClass} font-bold mt-0.5`}>
            {info.mensagemCompleta}
          </span>
        </div>
      </div>
    );
  }

  // MODO PÚBLICO (COM CONSENTIMENTO DO CLIENTE)
  return (
    <div className={`p-4 ${borderClass} border rounded-2xl flex flex-col gap-4 shadow-lg`}>
      {/* Cabeçalho do Alerta */}
      <div className="flex items-center gap-2.5">
        <div className={`p-2 rounded-xl bg-slate-950/60 border ${isEmerald ? 'border-emerald-500/30' : 'border-amber-500/30'}`}>
          <AlertTriangle className={`w-5 h-5 ${iconColor}`} />
        </div>
        <div className="flex flex-col">
          <h4 className={`font-sans text-[14px] font-bold tracking-tight ${titleClass}`}>
            Agendamento com Pernoite
          </h4>
          <span className="font-sans text-[12px] text-slate-300">
            Este serviço ultrapassa o expediente do dia e continuará no próximo dia útil.
          </span>
        </div>
      </div>

      {/* Resumo do Período de Permanência */}
      <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 flex flex-col gap-2 font-sans text-[13px]">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
          <span className="text-slate-400 flex items-center gap-1.5 text-[12px]">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            Entrada na Oficina:
          </span>
          <span className="font-mono font-bold text-slate-200">{info.inicioFormatted}</span>
        </div>

        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
          <span className="text-slate-400 flex items-center gap-1.5 text-[12px]">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            Retirada Permitida a partir de:
          </span>
          <span className={`font-mono font-bold text-[14px] ${highlightClass}`}>
            {info.terminoFormatted}
          </span>
        </div>

        <div className="text-[12px] text-slate-300 font-medium pt-0.5 flex items-center gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span>
            O veículo permanecerá guardado em nossa estrutura por <strong>{noites} {noites === 1 ? 'noite' : 'noites'}</strong>.
          </span>
        </div>
      </div>

      {/* Política de Cancelamento (se houver) */}
      {politicaCancelamento && (
        <div className="p-3 bg-slate-950/50 rounded-xl border border-slate-800/60 text-[12px] text-slate-300">
          <span className="font-bold text-slate-200 block mb-1">Política de Cancelamento da Oficina:</span>
          <p className="leading-relaxed text-slate-400">{politicaCancelamento}</p>
        </div>
      )}

      {/* Checkbox de Consentimento com Alvo de Toque de 56px */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onAceiteChange?.(!aceiteCheck)}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            onAceiteChange?.(!aceiteCheck);
          }
        }}
        className={`flex items-start gap-3 p-3.5 rounded-xl border ${
          aceiteCheck
            ? isEmerald
              ? 'border-emerald-500 bg-emerald-950/40 shadow-emerald-950/20'
              : 'border-amber-500 bg-amber-950/40 shadow-amber-950/20'
            : 'border-slate-800 bg-slate-950/90 hover:bg-slate-900'
        } cursor-pointer min-h-[56px] transition-all select-none`}
      >
        <input
          type="checkbox"
          checked={aceiteCheck}
          onChange={() => {}}
          className={`w-6 h-6 mt-0.5 rounded border-slate-700 ${
            isEmerald ? 'text-emerald-500 focus:ring-emerald-500' : 'text-amber-500 focus:ring-amber-500'
          } shrink-0 cursor-pointer pointer-events-none`}
        />
        <span className="font-sans text-[13px] text-slate-200 leading-snug">
          Estou ciente de que meu veículo permanecerá guardado na oficina até{' '}
          <strong className={`font-mono font-bold ${highlightClass}`}>{info.terminoFormatted}</strong> e concordo em deixá-lo durante esse período.
        </span>
      </div>
    </div>
  );
};
