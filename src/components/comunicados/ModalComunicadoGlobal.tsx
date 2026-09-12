import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { 
  Megaphone, 
  Gift, 
  Ticket, 
  Sparkles, 
  X, 
  Check, 
  Copy, 
  ArrowRight, 
  CheckCircle2, 
  Flame, 
  AlertTriangle,
  Zap
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';

interface ComunicadoAtivo {
  id: string;
  titulo: string;
  mensagem: string;
  tipo: 'aviso' | 'promocao' | 'brinde' | 'novidade' | 'alerta';
  badge_texto: string | null;
  cor_tema: 'amber' | 'emerald' | 'purple' | 'blue' | 'rose';
  imagem_url: string | null;
  acao_tipo: 'nenhuma' | 'link' | 'cupom' | 'brinde_dias' | 'brinde_custom';
  acao_label: string | null;
  acao_link: string | null;
  dias_bonus: number | null;
  cupom_codigo: string | null;
  cupom_desconto_tipo: string | null;
  cupom_desconto_valor: number | null;
  obrigatorio: boolean;
  acao_payload: any;
}

export const ModalComunicadoGlobal: React.FC = () => {
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();
  const { tenant, loading: authLoading } = useAuth();

  const [comunicado, setComunicado] = useState<ComunicadoAtivo | null>(null);
  const [visivel, setVisivel] = useState(false);
  const [processandoAcao, setProcessandoAcao] = useState(false);
  const [resgatadoSucesso, setResgatadoSucesso] = useState(false);
  const [mensagemSucesso, setMensagemSucesso] = useState('');
  const [cupomCopiado, setCupomCopiado] = useState(false);

  useEffect(() => {
    // Só busca comunicados quando a autenticação e o tenant estiverem prontos
    if (authLoading || !tenant?.id) return;

    let ativo = true;

    async function checarComunicados() {
      try {
        const { data, error } = await supabase.rpc('obter_comunicado_pendente');
        if (error) {
          console.error('[ModalComunicadoGlobal] Erro ao obter comunicado pendente:', error);
          return;
        }

        if (ativo && data && data.id) {
          setComunicado(data);
          // Aguarda 800ms para renderizar a interface primeiro
          setTimeout(() => {
            if (ativo) setVisivel(true);
          }, 800);
        }
      } catch (err) {
        console.error('[ModalComunicadoGlobal] Falha inesperada ao checar comunicados:', err);
      }
    }

    checarComunicados();

    return () => {
      ativo = false;
    };
  }, [authLoading, tenant?.id]);

  if (!visivel || !comunicado) return null;

  const handleDispensar = async () => {
    try {
      await supabase.rpc('marcar_comunicado_visualizado', { p_comunicado_id: comunicado.id });
    } catch (err) {
      // Silently catch
    } finally {
      setVisivel(false);
    }
  };

  const handleCopiarCupom = (codigo: string) => {
    navigator.clipboard.writeText(codigo);
    setCupomCopiado(true);
    showSuccess(`Cupom ${codigo} copiado com sucesso!`);
    setTimeout(() => setCupomCopiado(false), 3000);
  };

  const handleExecutarAcao = async () => {
    setProcessandoAcao(true);
    try {
      // Se for resgate de dias bônus
      if (comunicado.acao_tipo === 'brinde_dias') {
        const { data, error } = await supabase.rpc('resgatar_brinde_comunicado', {
          p_comunicado_id: comunicado.id,
        });

        if (error) throw error;

        setResgatadoSucesso(true);
        setMensagemSucesso(
          data?.mensagem || `Parabéns! +${comunicado.dias_bonus} dias foram adicionados ao seu plano!`
        );
        showSuccess('🎁 Presente creditado na sua conta!');
        return;
      }

      // Se for cupom
      if (comunicado.acao_tipo === 'cupom' && comunicado.cupom_codigo) {
        handleCopiarCupom(comunicado.cupom_codigo);
        await supabase.rpc('resgatar_brinde_comunicado', { p_comunicado_id: comunicado.id });
        setResgatadoSucesso(true);
        setMensagemSucesso(`Cupom ${comunicado.cupom_codigo} resgatado e copiado para a área de transferência!`);
        return;
      }

      // Se for link
      if (comunicado.acao_tipo === 'link' && comunicado.acao_link) {
        await supabase.rpc('marcar_comunicado_visualizado', { p_comunicado_id: comunicado.id });
        setVisivel(false);
        if (comunicado.acao_link.startsWith('/')) {
          navigate(comunicado.acao_link);
        } else {
          window.open(comunicado.acao_link, '_blank');
        }
        return;
      }

      // Padrão: apenas marcar lido
      await handleDispensar();
    } catch (err: any) {
      console.error('Erro ao processar ação do comunicado:', err);
      showError(err.message || 'Falha ao resgatar brinde.');
    } finally {
      setProcessandoAcao(false);
    }
  };

  // Cores CSS personalizadas
  const getThemeStyles = (tema: string) => {
    switch (tema) {
      case 'emerald':
        return {
          glow: 'shadow-[0_0_50px_-10px_rgba(16,185,129,0.3)] border-emerald-500/40',
          badgeBg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
          buttonPrimary: 'bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 font-black shadow-lg shadow-emerald-500/20',
          iconColor: 'text-emerald-400',
        };
      case 'purple':
        return {
          glow: 'shadow-[0_0_50px_-10px_rgba(168,85,247,0.3)] border-purple-500/40',
          badgeBg: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
          buttonPrimary: 'bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white font-black shadow-lg shadow-purple-500/20',
          iconColor: 'text-purple-400',
        };
      case 'blue':
        return {
          glow: 'shadow-[0_0_50px_-10px_rgba(59,130,246,0.3)] border-blue-500/40',
          badgeBg: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
          buttonPrimary: 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-black shadow-lg shadow-blue-500/20',
          iconColor: 'text-blue-400',
        };
      case 'rose':
        return {
          glow: 'shadow-[0_0_50px_-10px_rgba(244,63,94,0.3)] border-rose-500/40',
          badgeBg: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
          buttonPrimary: 'bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-400 hover:to-rose-500 text-white font-black shadow-lg shadow-rose-500/20',
          iconColor: 'text-rose-400',
        };
      case 'amber':
      default:
        return {
          glow: 'shadow-[0_0_50px_-10px_rgba(245,158,11,0.3)] border-amber-500/40',
          badgeBg: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
          buttonPrimary: 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black shadow-lg shadow-amber-500/20',
          iconColor: 'text-amber-400',
        };
    }
  };

  const theme = getThemeStyles(comunicado.cor_tema);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className={`relative w-full max-w-lg bg-slate-900 border rounded-3xl overflow-hidden shadow-2xl transition-all transform animate-in zoom-in-95 duration-200 ${theme.glow}`}
      >
        {/* Faixa Superior Iluminada */}
        <div className="h-1.5 w-full bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600" />

        {/* Botão Fechar X (se não for obrigatório) */}
        {!comunicado.obrigatorio && (
          <button
            onClick={handleDispensar}
            className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full bg-slate-800/80 hover:bg-slate-800 border border-slate-700/50 transition z-10"
            title="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {/* Banner Imagem Ilustrativa */}
        {comunicado.imagem_url && (
          <div className="w-full max-h-48 overflow-hidden relative border-b border-slate-800">
            <img 
              src={comunicado.imagem_url} 
              alt={comunicado.titulo} 
              className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent" />
          </div>
        )}

        <div className="p-6 sm:p-7">
          {/* Badge Comemorativo / Tipo */}
          <div className="flex items-center space-x-2 mb-3">
            {comunicado.badge_texto ? (
              <div className={`flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider border shadow-sm ${theme.badgeBg}`}>
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span>{comunicado.badge_texto}</span>
              </div>
            ) : (
              <div className={`flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border ${theme.badgeBg}`}>
                {comunicado.tipo === 'brinde' && <Gift className="w-3.5 h-3.5 shrink-0" />}
                {comunicado.tipo === 'promocao' && <Flame className="w-3.5 h-3.5 shrink-0" />}
                {comunicado.tipo === 'alerta' && <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
                {comunicado.tipo === 'novidade' && <Zap className="w-3.5 h-3.5 shrink-0" />}
                {comunicado.tipo === 'aviso' && <Megaphone className="w-3.5 h-3.5 shrink-0" />}
                <span>{comunicado.tipo.toUpperCase()}</span>
              </div>
            )}
          </div>

          {/* Título */}
          <h2 className="text-xl sm:text-2xl font-black text-white leading-snug mb-3">
            {comunicado.titulo}
          </h2>

          {/* Mensagem */}
          <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-line mb-6 font-normal">
            {comunicado.mensagem}
          </div>

          {/* Estado de Sucesso pós-resgate */}
          {resgatadoSucesso ? (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 text-center space-y-3 mb-4 animate-in zoom-in-95 duration-200">
              <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <p className="text-sm font-bold text-emerald-300">
                {mensagemSucesso}
              </p>
              
              {comunicado.acao_tipo === 'cupom' && (
                <button
                  onClick={() => {
                    handleDispensar();
                    navigate('/planos');
                  }}
                  className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-wider shadow-lg transition"
                >
                  <span>Ir para Planos e Usar Cupom</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Se for Cupom, exibe o Voucher Interativo */}
              {comunicado.acao_tipo === 'cupom' && comunicado.cupom_codigo && (
                <div className="mb-6 p-4 rounded-2xl bg-gradient-to-r from-amber-500/15 via-amber-500/5 to-amber-600/15 border border-amber-500/30 flex items-center justify-between gap-3">
                  <div className="flex items-center space-x-3">
                    <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 shrink-0">
                      <Ticket className="w-6 h-6" />
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-amber-400 tracking-wider block">
                        Seu Cupom Exclusivo
                      </span>
                      <span className="text-lg sm:text-xl font-mono font-black text-white tracking-widest">
                        {comunicado.cupom_codigo}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleCopiarCupom(comunicado.cupom_codigo!)}
                    className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition shadow shrink-0"
                  >
                    {cupomCopiado ? (
                      <>
                        <Check className="w-4 h-4 text-slate-950" />
                        <span>Copiado!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>Copiar</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Se for Brinde de Dias Bônus */}
              {comunicado.acao_tipo === 'brinde_dias' && comunicado.dias_bonus && (
                <div className="mb-6 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center space-x-3">
                  <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 shrink-0">
                    <Gift className="w-6 h-6 animate-bounce" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-white block">
                      +{comunicado.dias_bonus} Dias de Plano Pro Grátis
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Clique no botão abaixo para adicionar imediatamente à sua conta.
                    </span>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Botões de Ação */}
          <div className="flex flex-col sm:flex-row items-center justify-end gap-2.5 pt-2">
            {/* Botão Secundário para dispensar se não for obrigatório e houver ação secundária */}
            {!comunicado.obrigatorio && comunicado.acao_tipo !== 'nenhuma' && !resgatadoSucesso && (
              <button
                type="button"
                onClick={handleDispensar}
                className="w-full sm:w-auto px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold uppercase tracking-wider transition"
              >
                Lembrar Mais Tarde
              </button>
            )}

            {/* Se já resgatou sucesso, exibe botão Fechar */}
            {resgatadoSucesso ? (
              <button
                type="button"
                onClick={handleDispensar}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold uppercase tracking-wider transition"
              >
                Fechar
              </button>
            ) : comunicado.acao_tipo === 'nenhuma' ? (
              /* Apenas ler e fechar / Confirmação de leitura (ex: "CONFIRMAR TESTE" ou "OK, Entendido") */
              <button
                type="button"
                onClick={handleDispensar}
                className={`w-full sm:w-auto flex items-center justify-center space-x-2 px-6 py-3 rounded-xl text-xs font-black uppercase tracking-wider transition transform active:scale-95 shadow-lg ${theme.buttonPrimary}`}
              >
                <Check className="w-4 h-4" />
                <span>{comunicado.acao_label || 'OK, Entendido'}</span>
              </button>
            ) : (
              /* Ações interativas: Cupom, Brinde ou Link */
              <button
                type="button"
                onClick={handleExecutarAcao}
                disabled={processandoAcao}
                className={`w-full sm:w-auto flex items-center justify-center space-x-2 px-6 py-3 rounded-xl text-xs uppercase tracking-wider transition transform active:scale-95 disabled:opacity-50 ${theme.buttonPrimary}`}
              >
                {comunicado.acao_tipo === 'brinde_dias' && <Gift className="w-4 h-4" />}
                {comunicado.acao_tipo === 'cupom' && <Ticket className="w-4 h-4" />}
                {comunicado.acao_tipo === 'link' && <ArrowRight className="w-4 h-4" />}
                <span>
                  {processandoAcao 
                    ? 'Processando...' 
                    : comunicado.acao_label || (comunicado.acao_tipo === 'brinde_dias' ? 'Resgatar Presente 🎁' : 'Aproveitar Agora')}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
