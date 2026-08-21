import React from 'react';
import { AlertCircle, HelpCircle, MessageSquarePlus, RefreshCw } from 'lucide-react';
import { type ErroTraduzido, traduzirErro } from '../../utils/erros';

interface AlertaErroProps {
  erro: ErroTraduzido | string | any | null | undefined;
  onTentarNovamente?: () => void;
  className?: string;
  compacto?: boolean;
}

export function abrirModalFeedbackSuporte(erro: ErroTraduzido) {
  const evento = new CustomEvent('abrir-feedback-suporte', {
    detail: {
      tipo: 'erro',
      mensagem: `[Relato de Erro ${erro.codigoRef}]\nTela: ${typeof window !== 'undefined' ? window.location.pathname : ''}\nMensagem: ${erro.mensagem}\nDetalhe técnico: ${erro.detalheTecnico || ''}`,
    }
  });
  window.dispatchEvent(evento);
}

export const AlertaErro: React.FC<AlertaErroProps> = ({
  erro,
  onTentarNovamente,
  className = '',
  compacto = false,
}) => {
  if (!erro) return null;

  const traduzido: ErroTraduzido = typeof erro === 'object' && erro?.codigoRef
    ? erro
    : traduzirErro(erro);

  if (compacto) {
    return (
      <div className={`p-3 bg-rose-950/50 border border-rose-500/40 rounded-lg flex items-start gap-2.5 text-xs text-rose-200 animate-in fade-in ${className}`}>
        <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="font-semibold text-rose-100 flex items-center justify-between gap-2">
            <span>{traduzido.titulo}</span>
            <span className="font-mono text-[10px] text-rose-400/80 bg-rose-900/60 px-1.5 py-0.5 rounded border border-rose-800">
              {traduzido.codigoRef}
            </span>
          </div>
          <p className="leading-relaxed text-rose-200/90">{traduzido.mensagem}</p>
          {traduzido.acao && (
            <p className="text-[11px] text-rose-300 font-medium italic">{traduzido.acao}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`p-4 bg-gradient-to-br from-rose-950/60 via-graphite-900 to-rose-950/40 border border-rose-500/40 rounded-xl shadow-2xl space-y-3 animate-in fade-in zoom-in-95 ${className}`}>
      {/* Header com Título e Tag de Referência */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-rose-500/20 border border-rose-500/40 rounded-lg text-rose-400 shrink-0">
            <AlertCircle className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-rose-100 font-display uppercase tracking-wide">
              {traduzido.titulo}
            </h4>
            <span className="inline-block text-[10px] font-mono font-semibold text-rose-400 bg-rose-900/60 px-2 py-0.5 rounded border border-rose-800/80 mt-0.5">
              Ref: {traduzido.codigoRef}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => abrirModalFeedbackSuporte(traduzido)}
          className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-2.5 py-1.5 rounded-lg border border-amber-500/30 transition-all font-semibold cursor-pointer shrink-0"
          title="Abrir formulário de suporte com detalhes deste erro"
        >
          <MessageSquarePlus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Avisar o suporte</span>
        </button>
      </div>

      {/* Corpo da Mensagem e Ação Sugerida */}
      <div className="space-y-1.5 pl-1 text-xs text-vapor-200">
        <p className="leading-relaxed font-medium">{traduzido.mensagem}</p>
        
        {traduzido.acao && (
          <div className="flex items-start gap-1.5 text-amber-300/90 text-[11px] bg-amber-500/5 p-2 rounded-lg border border-amber-500/20">
            <HelpCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
            <span><strong>Dica:</strong> {traduzido.acao}</span>
          </div>
        )}
      </div>

      {/* Ação opcional Tentar Novamente */}
      {onTentarNovamente && (
        <div className="pt-2 border-t border-rose-900/50 flex justify-end">
          <button
            type="button"
            onClick={onTentarNovamente}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-900/40 hover:bg-rose-900/80 text-rose-200 text-xs font-semibold rounded-lg border border-rose-700 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Tentar novamente
          </button>
        </div>
      )}
    </div>
  );
};
