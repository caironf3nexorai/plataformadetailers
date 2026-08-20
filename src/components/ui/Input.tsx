import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className="flex flex-col w-full">
        {label && (
          <label htmlFor={inputId} className="font-display text-[11px] text-vapor-400 mb-1.5 uppercase">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`bg-graphite-900 border ${error ? 'border-flare-400' : 'border-graphite-600'} rounded-[4px] px-4 min-h-[48px] font-sans text-[14px] text-vapor-100 placeholder:text-vapor-600 focus-visible:ring-offset-graphite-800 [touch-action:manipulation] ${className}`}
          {...props}
        />
        {error && (
          <span className="font-sans text-[12px] text-flare-400 mt-1">
            {error}
          </span>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
