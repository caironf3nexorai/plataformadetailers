import React, { createContext, useContext, useState, useCallback } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, title?: string) => void;
  showError: (message: string, title?: string) => void;
  showSuccess: (message: string, title?: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'info', title?: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, title, message }]);

    setTimeout(() => {
      removeToast(id);
    }, 4500);
  }, [removeToast]);

  const showError = useCallback((message: string, title?: string) => {
    showToast(message, 'error', title || 'Atenção');
  }, [showToast]);

  const showSuccess = useCallback((message: string, title?: string) => {
    showToast(message, 'success', title || 'Sucesso');
  }, [showToast]);

  return (
    <ToastContext.Provider value={{ showToast, showError, showSuccess }}>
      {children}
      {/* Container de Toasts Flutuante */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2.5 max-w-sm w-full px-4 pointer-events-none">
        {toasts.map((toast) => {
          const isError = toast.type === 'error';
          const isSuccess = toast.type === 'success';

          return (
            <div
              key={toast.id}
              className={`pointer-events-auto flex items-start gap-3 p-4 rounded-xl border shadow-2xl backdrop-blur-md transition-all animate-in slide-in-from-bottom-2 ${
                isError
                  ? 'bg-graphite-900/95 border-flare-500/40 text-vapor-100'
                  : isSuccess
                  ? 'bg-graphite-900/95 border-emerald-500/40 text-vapor-100'
                  : 'bg-graphite-900/95 border-amber-500/40 text-vapor-100'
              }`}
            >
              {isError && <AlertTriangle className="w-5 h-5 text-flare-400 shrink-0 mt-0.5" />}
              {isSuccess && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />}
              {!isError && !isSuccess && <Info className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />}

              <div className="flex-1 font-sans text-xs">
                {toast.title && (
                  <div className="font-semibold text-sm mb-0.5 text-vapor-100">{toast.title}</div>
                )}
                <div className="text-vapor-300 leading-snug">{toast.message}</div>
              </div>

              <button
                onClick={() => removeToast(toast.id)}
                className="text-vapor-400 hover:text-vapor-100 transition-colors p-1"
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    // Fallback amigável caso invocado fora do Provider
    return {
      showToast: (m: string) => console.log('[Toast Info]:', m),
      showError: (m: string) => console.error('[Toast Error]:', m),
      showSuccess: (m: string) => console.log('[Toast Success]:', m),
    };
  }
  return context;
}
