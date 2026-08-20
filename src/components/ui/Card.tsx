import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hasShineSweep?: boolean;
  activeBorder?: boolean;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

export const Card: React.FC<CardProps> = ({ 
  children, 
  className = '', 
  hasShineSweep = false,
  activeBorder = false,
  onClick
}) => {
  return (
    <div 
      onClick={onClick}
      className={`relative overflow-hidden bg-graphite-800 rounded-[8px] p-4 lg:p-6 border ${activeBorder ? 'border-amber-500' : 'border-graphite-600'} ${className}`}
    >
      {children}
      {hasShineSweep && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-[8px]">
          <div className="absolute top-0 bottom-0 left-0 w-[30%] bg-gradient-to-r from-transparent via-white/4 to-transparent animate-shine mix-blend-overlay" />
        </div>
      )}
    </div>
  );
};
