import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { MessageSquarePlus, X, Send, AlertTriangle, Lightbulb, Heart, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { obterNomeDaTela } from '../../utils/nomesDeTela';

export const BotaoFeedbackFlutuante: React.FC = () => {
  const location = useLocation();
  const { showSuccess, showError } = useToast();

  const [isOpen, setIsOpen] = useState(false);
  const [tipo, setTipo] = useState<'erro' | 'sugestao' | 'elogio'>('sugestao');
  const [mensagem, setMensagem] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [enviadoComSucesso, setEnviadoComSucesso] = useState(false);

  useEffect(() => {
    const handleSuporteEvent = (e: any) => {
      if (e.detail) {
        setTipo(e.detail.tipo || 'erro');
        if (e.detail.mensagem) {
          setMensagem(e.detail.mensagem);
        }
        setIsOpen(true);
      }
    };
    window.addEventListener('abrir-feedback-suporte', handleSuporteEvent);
    return () => window.removeEventListener('abrir-feedback-suporte', handleSuporteEvent);
  }, []);

  // Não exibe o botão se estiver no painel /admin
  if (location.pathname.startsWith('/admin')) {
    return null;
  }

  const handleEnviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mensagem.trim()) return;

    setEnviando(true);
    try {
      const { error } = await supabase.rpc('enviar_feedback', {
        p_tipo: tipo,
        p_mensagem: mensagem.trim(),
        p_tela_origem: location.pathname,
        p_user_agent: navigator.userAgent,
      });

      if (error) throw error;

      setEnviadoComSucesso(true);
      showSuccess('Feedback enviado com sucesso! Agradecemos sua colaboração.');
      setTimeout(() => {
        setIsOpen(false);
        setEnviadoComSucesso(false);
        setMensagem('');
      }, 2000);
    } catch (err: any) {
      console.error('[Feedback Send Error]:', err);
      showError(err.message || 'Erro ao enviar feedback. Tente novamente.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      {/* Botão Flutuante Discreto no Canto Inferior Direito */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-20 right-4 sm:bottom-6 sm:right-6 z-40 bg-graphite-800/90 hover:bg-amber-500 text-vapor-200 hover:text-graphite-950 p-3 sm:px-4 sm:py-2.5 rounded-full sm:rounded-lg border border-graphite-600 shadow-xl backdrop-blur-md transition-all flex items-center gap-2 group cursor-pointer"
        title="Enviar Feedback ou Sugestão"
      >
        <MessageSquarePlus className="w-5 h-5 text-amber-400 group-hover:text-graphite-950 transition-colors" />
        <span className="hidden sm:inline text-xs font-semibold">Feedback</span>
      </button>

      {/* Modal de Envio */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-graphite-950/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-graphite-900 border border-graphite-700 rounded-xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4">
            {/* Header Modal */}
            <div className="flex items-center justify-between border-b border-graphite-700/60 pb-3">
              <div className="flex items-center gap-2">
                <MessageSquarePlus className="w-5 h-5 text-amber-500" />
                <h3 className="text-base font-bold text-vapor-100 font-display">Enviar Feedback</h3>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-vapor-400 hover:text-vapor-100 p-1 rounded-md hover:bg-graphite-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {enviadoComSucesso ? (
              <div className="py-8 flex flex-col items-center justify-center text-center gap-3">
                <CheckCircle2 className="w-12 h-12 text-emerald-400 animate-bounce" />
                <h4 className="text-lg font-bold text-vapor-100">Feedback Recebido!</h4>
                <p className="text-xs text-vapor-400 max-w-xs">
                  Muito obrigado! Nossa equipe analisa todas as sugestões para evoluir a plataforma.
                </p>
              </div>
            ) : (
              <form onSubmit={handleEnviar} className="space-y-4">
                {/* Seletor de Tipo */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-vapor-300">Qual é o tipo do feedback?</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setTipo('sugestao')}
                      className={`p-2.5 rounded-lg border text-xs font-medium flex flex-col items-center gap-1 transition-all ${
                        tipo === 'sugestao'
                          ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                          : 'bg-graphite-800 border-graphite-700 text-vapor-400 hover:border-graphite-600'
                      }`}
                    >
                      <Lightbulb className="w-4 h-4" />
                      Sugestão
                    </button>
                    <button
                      type="button"
                      onClick={() => setTipo('erro')}
                      className={`p-2.5 rounded-lg border text-xs font-medium flex flex-col items-center gap-1 transition-all ${
                        tipo === 'erro'
                          ? 'bg-flare-500/20 border-flare-500 text-flare-400'
                          : 'bg-graphite-800 border-graphite-700 text-vapor-400 hover:border-graphite-600'
                      }`}
                    >
                      <AlertTriangle className="w-4 h-4" />
                      Problema/Erro
                    </button>
                    <button
                      type="button"
                      onClick={() => setTipo('elogio')}
                      className={`p-2.5 rounded-lg border text-xs font-medium flex flex-col items-center gap-1 transition-all ${
                        tipo === 'elogio'
                          ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                          : 'bg-graphite-800 border-graphite-700 text-vapor-400 hover:border-graphite-600'
                      }`}
                    >
                      <Heart className="w-4 h-4" />
                      Elogio
                    </button>
                  </div>
                </div>

                {/* Campo de Mensagem */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-vapor-300">Sua mensagem</label>
                  <textarea
                    required
                    rows={4}
                    value={mensagem}
                    onChange={(e) => setMensagem(e.target.value)}
                    placeholder="Descreva detalhadamente o que funcionou bem, o erro que ocorreu ou a sua ideia de melhoria..."
                    className="w-full bg-graphite-800 border border-graphite-700 rounded-lg p-3 text-xs text-vapor-100 placeholder-vapor-500 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all resize-none"
                  />
                </div>

                <div className="text-[11px] text-vapor-400 font-sans">
                  Enviando a partir de: <strong className="text-vapor-200 font-semibold">{obterNomeDaTela(location.pathname)}</strong>
                </div>

                {/* Botões */}
                <div className="flex items-center justify-end gap-2 pt-2 border-t border-graphite-700/60">
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="px-3 py-2 rounded-lg text-xs font-semibold text-vapor-400 hover:text-vapor-100 hover:bg-graphite-800 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={enviando || !mensagem.trim()}
                    className="px-4 py-2 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-400 text-graphite-950 transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-amber-500/20"
                  >
                    {enviando ? (
                      'Enviando...'
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        Enviar Feedback
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
};
