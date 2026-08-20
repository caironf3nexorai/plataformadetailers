import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  tone?: 'amber' | 'emerald' | 'cyan' | 'graphite' | 'rose' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'secondary',
  tone,
  size = 'md',
  loading = false,
  fullWidth = false,
  className = '',
  disabled,
  ...props
}) => {
  const baseStyles =
    'rounded-[6px] font-sans transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed font-semibold';

  const sizeStyles = {
    sm: 'min-h-[36px] px-3.5 py-1.5 text-[13px]',
    md: 'min-h-[44px] px-5 py-2.5 text-[14px]',
    lg: 'min-h-[52px] px-6 py-3.5 text-[15px]',
  };

  const toneStyles = {
    amber: 'bg-amber-500 text-graphite-950 hover:bg-amber-400 shadow-md shadow-amber-500/10 font-bold',
    emerald: 'bg-emerald-500 text-graphite-950 hover:bg-emerald-400 shadow-md shadow-emerald-500/10 font-bold',
    cyan: 'bg-cyan-500 text-graphite-950 hover:bg-cyan-400 shadow-md shadow-cyan-500/10 font-bold',
    graphite: 'bg-graphite-800 text-vapor-100 hover:bg-graphite-700 border border-graphite-700',
    rose: 'bg-rose-500 text-white hover:bg-rose-600 shadow-md shadow-rose-500/10 font-bold',
    ghost: 'bg-transparent text-vapor-400 hover:text-vapor-100 hover:bg-graphite-800',
  };

  const variants = {
    primary:
      'bg-amber-500 text-graphite-900 hover:bg-amber-600 focus-visible:ring-offset-graphite-900 font-semibold',
    secondary:
      'bg-transparent border border-graphite-600 text-vapor-100 hover:bg-graphite-700 focus-visible:ring-offset-graphite-800',
    ghost:
      'bg-transparent text-vapor-400 hover:text-vapor-100 hover:bg-graphite-700/60',
    danger:
      'bg-flare-500 text-white hover:bg-flare-600 focus-visible:ring-offset-graphite-900 font-semibold',
  };

  const finalColorStyle = tone ? toneStyles[tone] : variants[variant];

  return (
    <button
      disabled={disabled || loading}
      className={`${baseStyles} ${sizeStyles[size]} ${finalColorStyle} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...props}
    >
      {loading ? (
        <>
          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />
          <span>{children}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
};
