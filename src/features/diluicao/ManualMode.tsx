import React, { useState } from 'react';
import type { DiluicaoConvention } from './types';
import { calculateManualDilution } from './calc';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';

export const ManualMode: React.FC = () => {
  const [volumeStr, setVolumeStr] = useState<string>('1000');
  const [ratioXStr, setRatioXStr] = useState<string>('10');
  const [convention, setConvention] = useState<DiluicaoConvention>('agua');

  const handleQuickVolume = (ml: number) => {
    setVolumeStr(ml.toString());
  };

  const result = calculateManualDilution(volumeStr, ratioXStr, convention);

  return (
    <div className="flex flex-col gap-6">
      {/* Bloco de Entradas */}
      <Card className="p-5 sm:p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-5">
        <h3 className="font-display text-[16px] text-vapor-100 uppercase tracking-wide">
          Snow Foam Manual (Pulverizador / Borrifador)
        </h3>

        {/* Volume do Frasco */}
        <div className="flex flex-col gap-2">
          <label className="font-sans text-[13px] text-vapor-400 font-medium">
            Volume do frasco
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleQuickVolume(500)}
              className={`min-h-[48px] px-4 rounded text-[14px] font-mono transition-colors border ${
                volumeStr === '500'
                  ? 'bg-amber-500/10 border-amber-500 text-amber-500 font-semibold'
                  : 'bg-graphite-700 border-graphite-600 text-vapor-100 hover:border-vapor-400'
              }`}
            >
              500 mL
            </button>
            <button
              type="button"
              onClick={() => handleQuickVolume(1000)}
              className={`min-h-[48px] px-4 rounded text-[14px] font-mono transition-colors border ${
                volumeStr === '1000'
                  ? 'bg-amber-500/10 border-amber-500 text-amber-500 font-semibold'
                  : 'bg-graphite-700 border-graphite-600 text-vapor-100 hover:border-vapor-400'
              }`}
            >
              1 L
            </button>
            <button
              type="button"
              onClick={() => handleQuickVolume(2000)}
              className={`min-h-[48px] px-4 rounded text-[14px] font-mono transition-colors border ${
                volumeStr === '2000'
                  ? 'bg-amber-500/10 border-amber-500 text-amber-500 font-semibold'
                  : 'bg-graphite-700 border-graphite-600 text-vapor-100 hover:border-vapor-400'
              }`}
            >
              2 L
            </button>

            <div className="flex-1 min-w-[140px]">
              <Input
                type="text"
                inputMode="decimal"
                placeholder="Volume em mL"
                value={volumeStr}
                onChange={(e) => setVolumeStr(e.target.value)}
                className="font-mono min-h-[48px]"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Proporção de Diluição */}
          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-vapor-400 font-medium">
              Diluição (1 : X)
            </label>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[16px] text-vapor-400 font-bold">1 :</span>
              <Input
                type="text"
                inputMode="decimal"
                placeholder="ex: 10 ou 12,5"
                value={ratioXStr}
                onChange={(e) => setRatioXStr(e.target.value)}
                className="font-mono min-h-[48px] flex-1"
              />
            </div>
          </div>

          {/* Convenção de Diluição */}
          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-vapor-400 font-medium">
              Convenção
            </label>
            <select
              value={convention}
              onChange={(e) => setConvention(e.target.value as DiluicaoConvention)}
              className="w-full min-h-[48px] px-3 bg-graphite-700 border border-graphite-600 rounded text-vapor-100 font-sans text-[14px] focus:outline-none focus:border-amber-500"
            >
              <option value="agua">Partes de água (1 parte produto : X água)</option>
              <option value="totais">Partes totais (1 parte produto em X final)</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Bloco de Resultado */}
      <Card className="p-5 sm:p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-2">
        <h4 className="font-sans text-[12px] text-vapor-400 uppercase tracking-widest font-semibold">
          Resultado da Proporção
        </h4>

        {result.isValid ? (
          <div className="flex flex-col gap-2 mt-1">
            <p className="font-sans text-[15px] sm:text-[16px] text-vapor-100 leading-relaxed">
              Diluição por {convention === 'agua' ? 'partes de água' : 'partes totais'} (
              {result.conventionText}):{' '}
              <span className="font-mono text-amber-500 font-bold">
                1:{ratioXStr.replace('.', ',')} = {result.produtoFormatted} mL + {result.aguaFormatted} mL
              </span>
            </p>
            <p className="font-sans text-[12px] text-vapor-400">
              (produto + água)
            </p>
          </div>
        ) : (
          <div className="py-4 text-center border border-dashed border-graphite-600 rounded">
            <p className="font-sans text-[14px] text-vapor-400">
              Informe o volume do frasco e a diluição para ver a dosagem exata.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
};
