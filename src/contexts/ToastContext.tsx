import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import { traduzirErro } from '../utils/erros';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextData {
  showToast: (message: string, type?: ToastType) => void;
  showError: (message: string | any, rawError?: any) => void;
  showSuccess: (message: string) => void;
}

const ToastContext = createContext<ToastContextData>({} as ToastContextData);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);

    setTimeout(() => {
      removeToast(id);
    }, 4000);
  }, [removeToast]);

  const showError = useCallback((userMsg: string | any, rawError?: any) => {
    const erroAlvo = rawError || userMsg;
    const traduzido = traduzirErro(erroAlvo);
    
    let finalMsg = traduzido.mensagem;
    if (typeof userMsg === 'string' && userMsg && !userMsg.includes('SELECT') && !userMsg.includes('ERROR:')) {
      if (userMsg !== traduzido.mensagem && traduzido.ehInesperado) {
        finalMsg = `${userMsg}: ${traduzido.mensagem}`;
      }
    }
    
    console.error('[Plataforma Detailers Error]', traduzido.codigoRef, rawError || userMsg);
    showToast(finalMsg, 'error');
  }, [showToast]);

  const showSuccess = useCallback((message: string) => {
    showToast(message, 'success');
  }, [showToast]);

  return (
    <ToastContext.Provider value={{ showToast, showError, showSuccess }}>
      {children}
      {/* CONTAINER DOS TOASTS (FIXO NO CANTO SUPERIOR DIREITO) */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-3 sm:px-0">
        {toasts.map((toast) => {
          let bgColor = 'bg-graphite-900 border-graphite-700 text-vapor-100';
          let icon = <Info size={18} className="text-cyan-400 shrink-0" />;

          if (toast.type === 'success') {
            bgColor = 'bg-emerald-950 border-emerald-500/50 text-emerald-100';
            icon = <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />;
          } else if (toast.type === 'error') {
            bgColor = 'bg-rose-950 border-rose-500/50 text-rose-100';
            icon = <XCircle size={18} className="text-rose-400 shrink-0" />;
          } else if (toast.type === 'warning') {
            bgColor = 'bg-amber-950 border-amber-500/50 text-amber-100';
            icon = <AlertTriangle size={18} className="text-amber-400 shrink-0" />;
          }

          return (
            <div
              key={toast.id}
              className={`pointer-events-auto flex items-start justify-between gap-3 p-3.5 rounded-xl border shadow-2xl transition-all animate-in fade-in slide-in-from-top-2 ${bgColor}`}
            >
              <div className="flex items-start gap-2.5">
                {icon}
                <span className="font-sans text-[13px] font-medium leading-snug break-words">
                  {toast.message}
                </span>
              </div>
              <button
                onClick={() => removeToast(toast.id)}
                className="text-vapor-400 hover:text-vapor-100 p-0.5 rounded transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => useContext(ToastContext);
