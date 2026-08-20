import React from 'react';

interface ServiceChipProps {
  code?: string | null;
  label?: string;
  tone: 'amber' | 'glass' | 'mint' | 'vapor';
}

const toneMap = {
  amber: 'border-amber-500 text-amber-500',
  glass: 'border-glass-400 text-glass-400',
  mint: 'border-mint-400 text-mint-400',
  vapor: 'border-vapor-400 text-vapor-400'
};

export const ServiceChip: React.FC<ServiceChipProps> = ({ code, label, tone }) => {
  return (
    <div className="flex items-center gap-2">
      {code && (
        <div className={`px-1.5 py-0.5 rounded-[2px] border ${toneMap[tone]} bg-transparent flex items-center justify-center`}>
          <span className="font-mono text-[11px] font-semibold tracking-[0.08em] leading-none">
            {code}
          </span>
        </div>
      )}
      {label && (
        <span className="font-sans text-[13px] text-vapor-400">
          {label}
        </span>
      )}
    </div>
  );
};
