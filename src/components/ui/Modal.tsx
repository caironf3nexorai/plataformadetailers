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
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 md:p-8 overflow-y-auto overflow-x-hidden [overscroll-behavior:contain] animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Card
        className={`w-full ${maxWidthClasses[maxWidth]} my-auto bg-graphite-800 border-graphite-600 rounded-2xl shadow-2xl overflow-hidden [overscroll-behavior:contain] animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-4rem)] ${className}`}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="px-4.5 py-3.5 sm:px-7 sm:py-5 border-b border-graphite-700 bg-graphite-800/95 flex items-start justify-between gap-3 shrink-0">
            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
              {title && (
                <div className="flex items-center gap-2.5 text-vapor-100">
                  {icon && <span className="shrink-0">{icon}</span>}
                  <h3 className="font-display text-[16px] sm:text-[18px] uppercase tracking-wide truncate">
                    {title}
                  </h3>
                </div>
              )}
              {subtitle && (
                <p className="font-sans text-[12px] sm:text-[13px] text-vapor-400 truncate">
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
        <div className="p-4 sm:p-7 overflow-y-auto overflow-x-hidden [overscroll-behavior:contain] flex-1 flex flex-col gap-4.5 [-webkit-overflow-scrolling:touch]">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="px-4.5 py-3.5 sm:px-7 sm:py-4.5 border-t border-graphite-700 bg-graphite-900/50 flex flex-wrap items-center justify-end gap-3 shrink-0">
            {footer}
          </div>
        )}
      </Card>
    </div>
  );
};
