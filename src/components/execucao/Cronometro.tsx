import React from 'react';
import { useTempoExecucao, formatarSegundosHHMMSS } from '../../hooks/useTempoExecucao';
import { formatarDataHora } from '../../utils/datas';

interface CronometroProps {
  execucaoId?: string | null;
  segundosBase?: number;
  contandoDesde?: string | null;
  offsetServidor?: number;
  status?: string | null;
  iniciadoEm?: string | null;
  finalizadoEm?: string | null;
  tamanho?: 'grande' | 'medio' | 'pequeno';
  exibirAbertoDesde?: boolean;
  className?: string;
}

export const Cronometro: React.FC<CronometroProps> = ({
  execucaoId = null,
  segundosBase: propSegundosBase,
  contandoDesde: propContandoDesde,
  offsetServidor: propOffsetServidor = 0,
  status,
  iniciadoEm = null,
  finalizadoEm = null,
  tamanho = 'grande',
  exibirAbertoDesde = true,
  className = '',
}) => {
  // Se execucaoId for fornecido, consome o hook unificado useTempoExecucao
  const hookTempo = useTempoExecucao(execucaoId);

  const segundosBase = propSegundosBase !== undefined ? propSegundosBase : hookTempo.segundosBase;
  const contandoDesde = propContandoDesde !== undefined ? propContandoDesde : hookTempo.contandoDesde;
  const offsetServidor = propOffsetServidor !== 0 ? propOffsetServidor : hookTempo.offsetServidor;
  const segundosTotaisCalc = execucaoId ? hookTempo.segundosTotais : (
    contandoDesde
      ? segundosBase + Math.max(0, Math.floor(((Date.now() + offsetServidor) - new Date(contandoDesde).getTime()) / 1000))
      : segundosBase
  );

  const isFinalizado = Boolean(finalizadoEm) || status === 'finalizado';
  const isPausado = !isFinalizado && !contandoDesde && (status === 'pausado' || segundosBase > 0);

  const sizeClasses = {
    grande: 'text-[32px] sm:text-[40px] leading-none font-bold',
    medio: 'text-[20px] sm:text-[24px] leading-none font-bold',
    pequeno: 'text-[14px] sm:text-[16px] leading-none font-semibold',
  };

  const inicioDt = iniciadoEm ? new Date(iniciadoEm) : null;

  if (isFinalizado) {
    if (segundosTotaisCalc <= 0) {
      return (
        <div className={`flex flex-col gap-1 ${className}`}>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 text-[12px] font-bold font-sans bg-amber-500/10 text-amber-500 rounded border border-amber-500/30">
              Tempo não registrado
            </span>
          </div>
          {exibirAbertoDesde && inicioDt && (
            <span className="text-[11px] font-sans text-vapor-400">
              Aberto em: <strong className="text-vapor-300">{formatarDataHora(inicioDt.toISOString())}</strong>
            </span>
          )}
        </div>
      );
    }

    return (
      <div className={`flex flex-col gap-1 font-mono tabular-nums min-w-0 max-w-full ${className}`}>
        <div className="flex flex-wrap items-center gap-2 max-w-full">
          <span className="font-sans text-[12px] text-vapor-400">Tempo trabalhado:</span>
          <span className={`${sizeClasses[tamanho]} text-amber-300`}>
            {formatarSegundosHHMMSS(segundosTotaisCalc)}
          </span>
          <span className="px-2 py-0.5 text-[10px] sm:text-[11px] font-bold uppercase tracking-wider font-sans bg-mint-500/20 text-mint-400 rounded border border-mint-500/30 shrink-0">
            FINALIZADO
          </span>
        </div>
        {exibirAbertoDesde && inicioDt && (
          <span className="text-[11px] font-sans text-vapor-400">
            Aberto em: <strong className="text-vapor-300">{formatarDataHora(inicioDt.toISOString())}</strong>
          </span>
        )}
      </div>
    );
  }

  const tempoFormatado = formatarSegundosHHMMSS(segundosTotaisCalc);

  return (
    <div className={`flex flex-col gap-1.5 font-mono tabular-nums min-w-0 max-w-full ${className}`}>
      <div className="flex flex-wrap items-center gap-2 max-w-full">
        <span
          className={`${sizeClasses[tamanho]} ${
            isPausado ? 'text-vapor-400' : 'text-amber-400'
          }`}
        >
          {tempoFormatado}
        </span>

        {isPausado ? (
          <span className="px-2 py-0.5 text-[10px] sm:text-[11px] font-bold uppercase tracking-wider font-sans bg-graphite-700 text-vapor-300 rounded border border-graphite-600 shrink-0">
            PAUSADO
          </span>
        ) : (
          <span className="px-2 py-0.5 text-[10px] sm:text-[11px] font-bold uppercase tracking-wider font-sans bg-amber-500/20 text-amber-400 rounded border border-amber-500/30 shrink-0 animate-pulse">
            EM EXECUÇÃO
          </span>
        )}
      </div>

      {exibirAbertoDesde && inicioDt && (
        <span className="text-[11px] font-sans text-vapor-400">
          Aberto desde: <strong className="text-vapor-300">{formatarDataHora(inicioDt.toISOString())}</strong>
        </span>
      )}
    </div>
  );
};
