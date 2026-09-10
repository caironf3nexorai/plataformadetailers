import React, { useEffect, useState } from 'react';
import { 
  AlertTriangle, 
  ExternalLink, 
  X, 
  ShieldCheck, 
  Sparkles, 
  ArrowRight,
  Clock
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface ModalAvisoAssinaturaProps {
  assinatura: {
    status?: string;
    dias_para_rebaixamento?: number;
    url_pagamento_asaas?: string | null;
    dias_trial_restantes?: number;
  } | null;
}

export const ModalAvisoAssinatura: React.FC<ModalAvisoAssinaturaProps> = ({ assinatura }) => {
  const navigate = useNavigate();
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    if (!assinatura) return;

    // Se a assinatura está atrasada
    if (assinatura.status === 'atrasada') {
      const dispensadoSessao = sessionStorage.getItem('aviso_atraso_dispensado');
      if (!dispensadoSessao) {
        // Exibir após 600ms para carregar a tela primeiro
        const timer = setTimeout(() => setAberto(true), 600);
        return () => clearTimeout(timer);
      }
    }

    // Se o trial está nos últimos 3 dias
    if (assinatura.status === 'trial' && (assinatura.dias_trial_restantes ?? 14) <= 3) {
      const dispensadoSessao = sessionStorage.getItem('aviso_trial_dispensado');
      if (!dispensadoSessao) {
        const timer = setTimeout(() => setAberto(true), 600);
        return () => clearTimeout(timer);
      }
    }
  }, [assinatura]);

  if (!aberto || !assinatura) return null;

  const isAtrasada = assinatura.status === 'atrasada';
  const diasAtraso = assinatura.dias_para_rebaixamento ?? 5;
  const diasTrial = assinatura.dias_trial_restantes ?? 3;

  const fecharModal = () => {
    if (isAtrasada) {
      sessionStorage.setItem('aviso_atraso_dispensado', 'true');
    } else {
      sessionStorage.setItem('aviso_trial_dispensado', 'true');
    }
    setAberto(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className={`relative w-full max-w-md bg-slate-900 border rounded-3xl p-6 sm:p-7 shadow-2xl transition-all transform animate-in zoom-in-95 duration-200 ${
          isAtrasada 
            ? 'border-rose-500/40 shadow-[0_0_50px_-10px_rgba(244,63,94,0.3)]' 
            : 'border-amber-500/40 shadow-[0_0_50px_-10px_rgba(245,158,11,0.3)]'
        }`}
      >
        {/* Faixa Superior Colorida */}
        <div 
          className={`absolute top-0 left-0 right-0 h-1.5 rounded-t-3xl ${
            isAtrasada 
              ? 'bg-gradient-to-r from-rose-500 via-rose-400 to-rose-600' 
              : 'bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600'
          }`} 
        />

        {/* Botão Fechar */}
        <button
          onClick={fecharModal}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full bg-slate-800/80 hover:bg-slate-800 border border-slate-700/50 transition"
          title="Fechar aviso"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Cabeçalho do Pop-up */}
        <div className="flex items-center space-x-2.5 mb-4">
          <div className={`p-2.5 rounded-2xl border ${
            isAtrasada 
              ? 'bg-rose-500/20 border-rose-500/40 text-rose-400' 
              : 'bg-amber-500/20 border-amber-500/40 text-amber-400'
          }`}>
            {isAtrasada ? <AlertTriangle className="w-6 h-6 animate-pulse" /> : <Sparkles className="w-6 h-6" />}
          </div>
          <div>
            <span className={`text-[10px] font-black uppercase tracking-widest block ${
              isAtrasada ? 'text-rose-400' : 'text-amber-400'
            }`}>
              {isAtrasada ? '⚠️ PENDÊNCIA DE PAGAMENTO' : '✨ TESTE GRÁTIS PRO'}
            </span>
            <h3 className="text-lg font-black text-white leading-tight">
              {isAtrasada ? 'Regularize sua Assinatura' : 'Degustação Quase no Fim'}
            </h3>
          </div>
        </div>

        {/* Mensagem Explicativa */}
        <div className="space-y-3 text-xs text-slate-300 leading-relaxed mb-6">
          {isAtrasada ? (
            <>
              <p>
                Identificamos uma pendência na renovação da sua mensalidade.
              </p>
              <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-200">
                <span className="font-bold block text-rose-100 mb-1">
                  Tolerância de {diasAtraso} dia(s) restante(s)
                </span>
                <span>
                  Após este prazo, sua conta será rebaixada para o plano Free.
                </span>
              </div>
              <div className="flex items-center space-x-2 text-[11px] text-slate-400">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Seus clientes, veículos e dados financeiros permanecem 100% seguros e intactos.</span>
              </div>
            </>
          ) : (
            <>
              <p>
                Você está aproveitando os recursos exclusivos do <strong>Plano Pro</strong>.
              </p>
              <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-200">
                <span className="font-bold block text-amber-100 mb-1">
                  Restam apenas {diasTrial} dia(s) de teste
                </span>
                <span>
                  Assine agora para manter ordens de serviço ilimitadas, orçamentos em 3 níveis e catálogo público.
                </span>
              </div>
            </>
          )}
        </div>

        {/* Botões de Ação */}
        <div className="flex flex-col sm:flex-row items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={fecharModal}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition"
          >
            Lembrar Mais Tarde
          </button>

          {isAtrasada && assinatura.url_pagamento_asaas ? (
            <a
              href={assinatura.url_pagamento_asaas}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto inline-flex items-center justify-center space-x-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-400 hover:to-rose-500 text-white font-black text-xs uppercase tracking-wider shadow-lg shadow-rose-500/20 transition"
            >
              <span>Atualizar no Asaas</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          ) : (
            <button
              type="button"
              onClick={() => {
                fecharModal();
                navigate('/planos');
              }}
              className="w-full sm:w-auto inline-flex items-center justify-center space-x-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs uppercase tracking-wider shadow-lg shadow-amber-500/20 transition"
            >
              <span>Ver Planos e Assinar</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
