import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Sparkles, X, PlayCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { PlayerVideoSeguro } from '../video/PlayerVideoSeguro';
import { resolverVideoBoasVindas } from '../../config/tutorialVideos';
import {
  lerWelcomeVistoLocal,
  salvarWelcomeVistoLocal,
  registrarWelcomeModalVisto,
  ONBOARDING_EVENT_WELCOME_VISIBILITY,
} from '../../utils/onboarding';

interface ModalOnboardingVideoFlutuanteProps {
  onConcluido?: () => void;
}

export const ModalOnboardingVideoFlutuante: React.FC<ModalOnboardingVideoFlutuanteProps> = ({
  onConcluido,
}) => {
  const { tenant, membership, loading: authLoading, refetchTenantData } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [aberto, setAberto] = useState(false);
  const [inicializado, setInicializado] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [videoConfig, setVideoConfig] = useState(() => resolverVideoBoasVindas());

  const ehGestor = membership?.role === 'dono' || membership?.role === 'gerente';

  // Carrega a URL do vídeo de boas-vindas configurada no Admin (ou fallback do código)
  useEffect(() => {
    let ativo = true;

    async function carregarVideoConfig() {
      try {
        const { data } = await supabase.rpc('obter_config_plataforma');
        if (!ativo || !data) return;
        setVideoConfig(resolverVideoBoasVindas(data));
      } catch {
        // Usa fallback configurado em TUTORIAL_VIDEOS
      }
    }

    carregarVideoConfig();
    return () => {
      ativo = false;
    };
  }, []);

  // Decide uma única vez na entrada se exibe o Modal de Boas-Vindas (apenas Dono/Gerente com welcome_modal_seen = false)
  useEffect(() => {
    if (authLoading || !tenant?.id) return;

    let ativo = true;

    async function verificarPrimeiroAcesso() {
      if (!ehGestor) {
        if (ativo) {
          setAberto(false);
          setInicializado(true);
        }
        return;
      }

      const jaVistoLocal = lerWelcomeVistoLocal(tenant!.id);
      const jaVistoBanco = Boolean(tenant!.welcome_modal_seen) || Boolean(tenant!.onboarding_concluido);

      if (jaVistoLocal || jaVistoBanco) {
        if (ativo) {
          setAberto(false);
          setInicializado(true);
        }
        return;
      }

      // Guarda defensiva caso a coluna welcome_modal_seen ainda não exista no cache de um ambiente pré-0171
      if (tenant!.welcome_modal_seen === undefined) {
        try {
          const [{ count: qtdOrc }, { count: qtdAg }] = await Promise.all([
            supabase
              .from('orcamentos')
              .select('id', { count: 'exact', head: true })
              .eq('tenant_id', tenant!.id),
            supabase
              .from('agendamentos')
              .select('id', { count: 'exact', head: true })
              .eq('tenant_id', tenant!.id),
          ]);
          if ((qtdOrc || 0) > 0 || (qtdAg || 0) > 0) {
            salvarWelcomeVistoLocal(tenant!.id, true);
            if (ativo) {
              setAberto(false);
              setInicializado(true);
            }
            return;
          }
        } catch {
          // Segue exibindo caso falhe consulta auxiliar
        }
      }

      if (ativo) {
        setAberto(true);
        setInicializado(true);
        window.dispatchEvent(
          new CustomEvent(ONBOARDING_EVENT_WELCOME_VISIBILITY, {
            detail: { aberto: true, visto: false, tenantId: tenant!.id },
          })
        );
      }
    }

    verificarPrimeiroAcesso();
    return () => {
      ativo = false;
    };
  }, [authLoading, tenant?.id, tenant?.welcome_modal_seen, tenant?.onboarding_concluido, ehGestor]);

  // Permite reabrir manualmente sob demanda via Minha Oficina ("Vídeo Tutorial de Iniciação")
  useEffect(() => {
    const handleReabrir = () => {
      setAberto(true);
      window.dispatchEvent(
        new CustomEvent(ONBOARDING_EVENT_WELCOME_VISIBILITY, {
          detail: { aberto: true, tenantId: tenant?.id },
        })
      );
    };

    window.addEventListener('abrir_onboarding_tutorial', handleReabrir);
    return () => window.removeEventListener('abrir_onboarding_tutorial', handleReabrir);
  }, [tenant?.id]);

  // Trava scroll de fundo apenas enquanto o modal estiver visível
  useEffect(() => {
    const isTelaCheia =
      location.pathname.startsWith('/execucao/') || location.pathname.startsWith('/checkin/');
    if (aberto && !isTelaCheia) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [aberto, location.pathname]);

  const concluirEFechar = useCallback(
    async (destino?: string) => {
      if (processando) return;
      setProcessando(true);
      setAberto(false);

      try {
        await registrarWelcomeModalVisto(tenant?.id);
        if (refetchTenantData) {
          await refetchTenantData();
        }
        onConcluido?.();
      } finally {
        setProcessando(false);
        if (destino) {
          navigate(destino);
        }
      }
    },
    [processando, tenant?.id, refetchTenantData, onConcluido, navigate]
  );

  const handleCriarPrimeiroOrcamento = () => {
    void concluirEFechar('/orcamentos?novo=1');
  };

  const handleIrParaPainel = () => {
    const jaNoPainel = location.pathname === '/' || location.pathname === '/dashboard';
    void concluirEFechar(jaNoPainel ? undefined : '/dashboard');
  };

  const isTelaCheia =
    location.pathname.startsWith('/execucao/') || location.pathname.startsWith('/checkin/');

  if (isTelaCheia || !inicializado || !aberto) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-graphite-950/85 backdrop-blur-md animate-fade-in overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-modal-boas-vindas"
    >
      <div className="bg-graphite-900 border border-amber-500/40 rounded-2xl max-w-2xl w-full shadow-2xl flex flex-col my-auto max-h-[94vh] overflow-hidden relative">
        {/* Barra superior de destaque */}
        <div className="h-1 w-full bg-gradient-to-r from-amber-500 via-amber-400 to-sky-500" />

        {/* Botão Fechar discreto */}
        <button
          type="button"
          onClick={handleIrParaPainel}
          disabled={processando}
          className="absolute top-2.5 right-2.5 min-w-[48px] min-h-[48px] flex items-center justify-center rounded-xl bg-graphite-800/80 hover:bg-graphite-700 text-vapor-400 hover:text-vapor-100 border border-graphite-700 transition-colors cursor-pointer z-10"
          title="Ir direto para o Painel Principal"
          aria-label="Fechar boas-vindas"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="p-5 sm:p-7 overflow-y-auto space-y-5">
          {/* Cabeçalho */}
          <div className="space-y-2 pr-8">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-bold uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/30">
              <Sparkles className="w-3.5 h-3.5" />
              PASSO ÚNICO DE ATIVAÇÃO
            </span>

            <h2
              id="titulo-modal-boas-vindas"
              className="text-xl sm:text-2xl font-display font-bold text-vapor-100 leading-tight"
            >
              Bem-vindo ao Nuvem Wash! Sua oficina já veio pré-configurada.
            </h2>

            <p className="text-xs sm:text-sm text-vapor-300 leading-relaxed">
              Assista a este vídeo rápido de 1 minuto e simule seu primeiro orçamento profissional antes de personalizar sua conta.
            </p>
          </div>

          {/* Player de Vídeo Principal (60s) sem travas */}
          {videoConfig.ativo && videoConfig.url ? (
            <div className="rounded-xl overflow-hidden border border-graphite-700 shadow-lg bg-black">
              <PlayerVideoSeguro
                url={videoConfig.url}
                titulo={videoConfig.titulo}
                tempoInicial={videoConfig.tempoInicial || 0}
                tempoFinal={videoConfig.tempoFinal}
                mostrarWatermark={false}
              />
            </div>
          ) : (
            <div className="rounded-xl border border-graphite-700 bg-graphite-950/70 p-5 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                <PlayCircle className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-bold text-vapor-100 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Catálogo inicial, categorias e horários já carregados</span>
                </p>
                <p className="text-xs text-vapor-400 leading-relaxed">
                  Você não precisa configurar nada para testar agora: já incluímos serviços padrão com preços médios sugeridos de mercado. Simule um orçamento e ajuste sua marca com calma pelo guia no Painel.
                </p>
              </div>
            </div>
          )}

          {/* Call to Action (CTA) Único e Destacado */}
          <div className="flex flex-col items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleCriarPrimeiroOrcamento}
              disabled={processando}
              className="w-full min-h-[48px] py-3.5 px-5 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 hover:from-amber-400 hover:to-orange-400 text-graphite-950 font-display font-bold text-sm sm:text-base shadow-lg shadow-amber-500/25 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              <span>🚀 Criar meu 1º Orçamento Personalizado Agora</span>
            </button>

            <button
              type="button"
              onClick={handleIrParaPainel}
              disabled={processando}
              className="min-h-[48px] w-full sm:w-auto inline-flex items-center justify-center text-xs text-vapor-400 hover:text-vapor-200 underline underline-offset-4 py-2 px-4 transition-colors cursor-pointer disabled:opacity-60"
            >
              Ir direto para o Painel Principal
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
