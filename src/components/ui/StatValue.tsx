import React from 'react';

interface StatValueProps {
  label: string;
  value: string;
}

export const StatValue: React.FC<StatValueProps> = ({ label, value }) => {
  return (
    <div className="flex flex-col">
      <span className="font-display text-[11px] text-vapor-400 mb-1 uppercase">
        {label}
      </span>
      <span className="font-mono text-[24px] lg:text-[28px] text-vapor-100 font-medium">
        {value}
      </span>
    </div>
  );
};
