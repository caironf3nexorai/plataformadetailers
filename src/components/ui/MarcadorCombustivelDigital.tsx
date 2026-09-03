import React from 'react';
import { Fuel, AlertTriangle } from 'lucide-react';

export interface MarcadorCombustivelDigitalProps {
  /** Nível de 0 a 8 */
  value: number | null | undefined;
  /** Callback ao mudar o nível */
  onChange: (novoNivel: number) => void;
  /** Desabilitar interação */
  disabled?: boolean;
  className?: string;
}

interface NivelInfo {
  pct: number;
  label: string;
  sublabel: string;
  corStatus: 'reserva' | 'baixo' | 'normal' | 'cheio';
}

const NIVEIS_INFO: Record<number, NivelInfo> = {
  0: { pct: 0, label: 'Reserva / Vazio', sublabel: '0%', corStatus: 'reserva' },
  1: { pct: 12, label: 'Reserva Final', sublabel: '12%', corStatus: 'reserva' },
  2: { pct: 25, label: '1/4 do Tanque', sublabel: '25%', corStatus: 'baixo' },
  3: { pct: 37, label: '37% do Tanque', sublabel: '37%', corStatus: 'baixo' },
  4: { pct: 50, label: 'Meio Tanque', sublabel: '50%', corStatus: 'normal' },
  5: { pct: 62, label: '62% do Tanque', sublabel: '62%', corStatus: 'normal' },
  6: { pct: 75, label: '3/4 do Tanque', sublabel: '75%', corStatus: 'cheio' },
  7: { pct: 87, label: '87% do Tanque', sublabel: '87%', corStatus: 'cheio' },
  8: { pct: 100, label: 'Tanque Cheio', sublabel: '100%', corStatus: 'cheio' },
};

export const MarcadorCombustivelDigital: React.FC<MarcadorCombustivelDigitalProps> = ({
  value,
  onChange,
  disabled = false,
  className = '',
}) => {
  const currentVal = value !== null && value !== undefined ? Math.max(0, Math.min(8, Number(value))) : 4;
  const info = NIVEIS_INFO[currentVal] || NIVEIS_INFO[4];

  // Cores dinâmicas do display digital
  const getDisplayColors = () => {
    switch (info.corStatus) {
      case 'reserva':
        return {
          bg: 'bg-red-500/10 border-red-500/40 text-red-400',
          glow: 'rgba(239, 68, 68, 0.4)',
          text: 'text-red-400',
          barActive: 'bg-gradient-to-r from-red-600 to-red-500 shadow-[0_0_10px_rgba(239,68,68,0.7)]',
        };
      case 'baixo':
        return {
          bg: 'bg-amber-500/10 border-amber-500/40 text-amber-400',
          glow: 'rgba(245, 158, 11, 0.4)',
          text: 'text-amber-400',
          barActive: 'bg-gradient-to-r from-amber-500 to-yellow-400 shadow-[0_0_10px_rgba(245,158,11,0.7)]',
        };
      case 'normal':
        return {
          bg: 'bg-cyan-500/10 border-cyan-500/40 text-cyan-400',
          glow: 'rgba(6, 182, 212, 0.4)',
          text: 'text-cyan-400',
          barActive: 'bg-gradient-to-r from-sky-500 to-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.7)]',
        };
      case 'cheio':
      default:
        return {
          bg: 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400',
          glow: 'rgba(16, 185, 129, 0.4)',
          text: 'text-emerald-400',
          barActive: 'bg-gradient-to-r from-cyan-400 to-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.7)]',
        };
    }
  };

  const colors = getDisplayColors();

  return (
    <div
      className={`p-4 sm:p-5 rounded-2xl bg-gradient-to-b from-graphite-900 via-graphite-900 to-graphite-950 border border-graphite-700/80 shadow-xl flex flex-col gap-4 select-none ${className}`}
    >
      {/* CABEÇALHO DO CLUSTER DIGITAL */}
      <div className="flex items-center justify-between gap-3 border-b border-graphite-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className={`p-2 rounded-xl border ${colors.bg}`}>
            <Fuel size={20} className={colors.text} />
          </div>
          <div className="flex flex-col">
            <span className="font-sans text-[11px] uppercase tracking-wider text-vapor-400 font-bold flex items-center gap-1.5">
              Marcador Digital de Combustível
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-graphite-800 text-vapor-400 border border-graphite-700">
                Lado do Tanque ◀
              </span>
            </span>
            <span className="font-display text-[15px] font-bold text-vapor-100 flex items-center gap-2">
              {info.label}
              {info.corStatus === 'reserva' && (
                <span className="inline-flex items-center gap-1 text-[11px] font-mono text-red-400 animate-pulse font-bold">
                  <AlertTriangle size={13} /> RESERVA
                </span>
              )}
            </span>
          </div>
        </div>

        {/* GRANDE VISOR DIGITAL COM LEITURA EM % */}
        <div className="flex flex-col items-end">
          <span
            className={`font-mono text-2xl sm:text-3xl font-extrabold tracking-tight ${colors.text}`}
            style={{ textShadow: `0 0 12px ${colors.glow}` }}
          >
            {info.sublabel}
          </span>
          <span className="font-sans text-[10px] text-vapor-500 uppercase tracking-widest font-semibold">
            Nível do Tanque
          </span>
        </div>
      </div>

      {/* SEGMENTOS DE LED ESTILO PAINEL DIGITAL DE CARRO */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-[11px] font-mono font-bold text-vapor-400 px-1">
          <span className="flex items-center gap-1 text-red-400">
            <span>E</span>
            <span className="text-[9px] opacity-70">(Vazio)</span>
          </span>
          <span className="text-vapor-500 hidden sm:inline">25%</span>
          <span className="text-cyan-400">50%</span>
          <span className="text-vapor-500 hidden sm:inline">75%</span>
          <span className="flex items-center gap-1 text-emerald-400">
            <span className="text-[9px] opacity-70">(Cheio)</span>
            <span>F</span>
          </span>
        </div>

        {/* 8 BARRAS DE LED INTERATIVAS */}
        <div className="grid grid-cols-8 gap-1.5 sm:gap-2 p-2 bg-graphite-950 rounded-xl border border-graphite-800/80 shadow-inner">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((seg) => {
            const isLit = currentVal >= seg;
            // Cores do segmento conforme a posição no painel
            let litColorClass = 'bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]';
            if (seg <= 2) {
              litColorClass = 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]';
            } else if (seg <= 4) {
              litColorClass = 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.8)]';
            } else if (seg <= 6) {
              litColorClass = 'bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.8)]';
            } else {
              litColorClass = 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]';
            }

            return (
              <button
                key={seg}
                type="button"
                disabled={disabled}
                onClick={() => onChange(seg)}
                className={`h-9 sm:h-11 rounded-md transition-all duration-200 relative group flex items-center justify-center ${
                  isLit
                    ? `${litColorClass} border border-white/20`
                    : 'bg-graphite-900 border border-graphite-800 hover:bg-graphite-850'
                } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                title={`Nível ${seg * 12.5}%`}
              >
                {/* Reflexo vítreo superior do LED */}
                <div className="absolute inset-x-0 top-0 h-1/3 bg-white/15 rounded-t-sm pointer-events-none" />
                <span
                  className={`font-mono text-[10px] font-extrabold ${
                    isLit ? 'text-graphite-950' : 'text-vapor-600 group-hover:text-vapor-400'
                  }`}
                >
                  {seg}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* BARRA DE CORRER (SLIDER INTERATIVO) */}
      <div className="flex flex-col gap-2 pt-1">
        <div className="flex items-center justify-between text-xs text-vapor-400 font-medium">
          <span>Deslize a barra para calibrar:</span>
          <span className="font-mono text-vapor-300 font-bold">{info.label} ({info.sublabel})</span>
        </div>

        <div className="relative flex items-center w-full py-1">
          <input
            type="range"
            min={0}
            max={8}
            step={1}
            value={currentVal}
            disabled={disabled}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full h-3 bg-graphite-950 rounded-lg appearance-none cursor-pointer accent-amber-500 focus:outline-none border border-graphite-700 disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>

        {/* ATALHOS RÁPIDOS AUTOMOTIVOS */}
        <div className="flex items-center justify-between gap-1 sm:gap-2 pt-1">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(0)}
            className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-mono font-bold transition-colors ${
              currentVal === 0
                ? 'bg-red-500/20 border-red-500 text-red-300'
                : 'bg-graphite-800 border-graphite-700 text-vapor-400 hover:text-vapor-200'
            }`}
          >
            Vazio (0%)
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(2)}
            className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-mono font-bold transition-colors ${
              currentVal === 2
                ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                : 'bg-graphite-800 border-graphite-700 text-vapor-400 hover:text-vapor-200'
            }`}
          >
            1/4 (25%)
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(4)}
            className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-mono font-bold transition-colors ${
              currentVal === 4
                ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                : 'bg-graphite-800 border-graphite-700 text-vapor-400 hover:text-vapor-200'
            }`}
          >
            Meio (50%)
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(6)}
            className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-mono font-bold transition-colors ${
              currentVal === 6
                ? 'bg-sky-500/20 border-sky-500 text-sky-300'
                : 'bg-graphite-800 border-graphite-700 text-vapor-400 hover:text-vapor-200'
            }`}
          >
            3/4 (75%)
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(8)}
            className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-mono font-bold transition-colors ${
              currentVal === 8
                ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                : 'bg-graphite-800 border-graphite-700 text-vapor-400 hover:text-vapor-200'
            }`}
          >
            Cheio (100%)
          </button>
        </div>
      </div>
    </div>
  );
};
