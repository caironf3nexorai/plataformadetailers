import React, { useEffect } from 'react';
import { Card } from './Card';
import { X } from 'lucide-react';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl';
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  showCloseButton?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  icon,
  maxWidth = 'md',
  children,
  footer,
  className = '',
  showCloseButton = true,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const maxWidthClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
    '4xl': 'max-w-4xl',
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 overflow-y-auto overflow-x-hidden [overscroll-behavior:contain] animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Card
        className={`w-full ${maxWidthClasses[maxWidth]} bg-graphite-800 border-graphite-600 rounded-xl shadow-2xl overflow-hidden [overscroll-behavior:contain] animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[90vh] ${className}`}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="px-6 py-4 border-b border-graphite-700 bg-graphite-800/90 flex items-start justify-between gap-4 shrink-0">
            <div className="flex flex-col gap-0.5">
              {title && (
                <div className="flex items-center gap-2 text-vapor-100">
                  {icon && <span className="shrink-0">{icon}</span>}
                  <h3 className="font-display text-[18px] uppercase tracking-wide">
                    {title}
                  </h3>
                </div>
              )}
              {subtitle && (
                <p className="font-sans text-[13px] text-vapor-400">
                  {subtitle}
                </p>
              )}
            </div>

            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                className="text-vapor-400 hover:text-vapor-100 p-1.5 rounded-lg hover:bg-graphite-700/60 transition-colors shrink-0 -mr-1"
                aria-label="Fechar"
              >
                <X size={20} />
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className="p-6 overflow-y-auto overflow-x-hidden [overscroll-behavior:contain] flex-1 flex flex-col gap-4">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="px-6 py-4 border-t border-graphite-700 bg-graphite-900/40 flex flex-wrap items-center justify-end gap-2 shrink-0">
            {footer}
          </div>
        )}
      </Card>
    </div>
  );
};
