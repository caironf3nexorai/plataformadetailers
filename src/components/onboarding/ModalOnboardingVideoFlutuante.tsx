import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Maximize2,
  Minimize2,
  CheckCircle2,
  Sparkles,
  Clock,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Building2,
  Calendar,
  Tag,
  QrCode,
  ShieldCheck,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';

interface ModalOnboardingVideoFlutuanteProps {
  onConcluido?: () => void;
}

export const ModalOnboardingVideoFlutuante: React.FC<ModalOnboardingVideoFlutuanteProps> = ({ onConcluido }) => {
  const { tenant, refetchTenantData } = useAuth();
  const { showSuccess } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  // Estados principais
  const [visivel, setVisivel] = useState(false);
  const [modoExpandido, setModoExpandido] = useState(true);
  const [colapsado, setColapsado] = useState(false);
  const [carregandoConfig, setCarregandoConfig] = useState(true);
  const [salvandoConclusao, setSalvandoConclusao] = useState(false);

  // Configuração do vídeo
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [videoTitulo, setVideoTitulo] = useState<string>('Tutorial de Iniciação & Configuração da Plataforma');

  // Rastreamento de progresso (% assistida)
  const [segundosAssistidos, setSegundosAssistidos] = useState(0);
  const [duracaoTotalSegundos, setDuracaoTotalSegundos] = useState(300); // 5 min padrão se não detectado
  const [estaReproduzindo, setEstaReproduzindo] = useState(false);
  const intervalRef = useRef<any>(null);

  const storageKeyConcluido = tenant?.id ? `onboarding_tutorial_concluido_${tenant.id}` : null;
  const storageKeyTempo = tenant?.id ? `onboarding_tempo_assistido_${tenant.id}` : null;

  // Carrega configuração e verifica se o tenant já marcou como configurado
  useEffect(() => {
    if (!tenant?.id) return;

    const jaConcluiuLocal = storageKeyConcluido && localStorage.getItem(storageKeyConcluido) === 'true';
    const jaConcluiuBanco = Boolean(tenant.onboarding_concluido);

    if (jaConcluiuLocal || jaConcluiuBanco) {
      setVisivel(false);
      setCarregandoConfig(false);
      return;
    }

    // Carrega tempo previamente assistido do localStorage
    if (storageKeyTempo) {
      const tempoSalvo = parseInt(localStorage.getItem(storageKeyTempo) || '0', 10);
      if (!isNaN(tempoSalvo) && tempoSalvo > 0) {
        setSegundosAssistidos(tempoSalvo);
      }
    }

    async function buscarConfiguracaoVideo() {
      try {
        setCarregandoConfig(true);
        const { data, error } = await supabase.rpc('obter_config_plataforma');
        if (!error && data) {
          if (data.video_onboarding_url) {
            setVideoUrl(data.video_onboarding_url);
          }
          if (data.video_onboarding_titulo) {
            setVideoTitulo(data.video_onboarding_titulo);
          }
          if (data.video_onboarding_ativo === false) {
            setVisivel(false);
            return;
          }
        }
        // Exibe o modal na primeira vez se não estiver em rotas operacionais de tela cheia
        const isTelaCheia = location.pathname.startsWith('/execucao/') || location.pathname.startsWith('/checkin/');
        if (!isTelaCheia) {
          setVisivel(true);
        }
      } catch (err) {
        console.warn('[OnboardingVideo] Erro ao carregar config da plataforma:', err);
        setVisivel(true);
      } finally {
        setCarregandoConfig(false);
      }
    }

    buscarConfiguracaoVideo();
  }, [tenant?.id, tenant?.onboarding_concluido, storageKeyConcluido, storageKeyTempo, location.pathname]);

  // Listener para reabertura manual sob demanda (ex: botão de ajuda ou em configurações)
  useEffect(() => {
    const handleReabrir = () => {
      setVisivel(true);
      setModoExpandido(true);
      setColapsado(false);
    };

    window.addEventListener('abrir_onboarding_tutorial', handleReabrir);
    return () => window.removeEventListener('abrir_onboarding_tutorial', handleReabrir);
  }, []);

  // Timer para contabilizar o tempo e a % assistida enquanto o usuário assiste
  useEffect(() => {
    if (estaReproduzindo && visivel) {
      intervalRef.current = setInterval(() => {
        setSegundosAssistidos((prev) => {
          const prox = Math.min(duracaoTotalSegundos, prev + 1);
          if (storageKeyTempo && prox % 5 === 0) {
            localStorage.setItem(storageKeyTempo, prox.toString());
          }
          return prox;
        });
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [estaReproduzindo, visivel, duracaoTotalSegundos, storageKeyTempo]);

  // Cálculo da porcentagem assistida
  const porcentagemAssistida = Math.min(
    100,
    Math.max(0, Math.round((segundosAssistidos / (duracaoTotalSegundos || 1)) * 100))
  );

  const formatarTempo = (segundos: number) => {
    const mins = Math.floor(segundos / 60);
    const secs = segundos % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Extração ou formatação da URL de embed (YouTube, Vimeo ou MP4)
  const obterEmbedUrl = (rawUrl: string): string => {
    if (!rawUrl || !rawUrl.trim()) {
      // Vídeo demonstrativo oficial de boas-vindas caso o tenant ainda não tenha configurado URL própria
      return 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&enablejsapi=1';
    }

    const clean = rawUrl.trim();
    if (clean.includes('youtube.com/watch')) {
      try {
        const v = new URL(clean).searchParams.get('v');
        return v ? `https://www.youtube-nocookie.com/embed/${v}?rel=0&enablejsapi=1` : clean;
      } catch {
        return clean;
      }
    }
    if (clean.includes('youtu.be/')) {
      const parts = clean.split('youtu.be/');
      const v = parts[1]?.split('?')[0]?.split('&')[0];
      return v ? `https://www.youtube-nocookie.com/embed/${v}?rel=0&enablejsapi=1` : clean;
    }
    if (clean.includes('youtube.com/embed/')) {
      return clean.includes('enablejsapi=1') ? clean : `${clean}${clean.includes('?') ? '&' : '?'}enablejsapi=1`;
    }
    if (clean.includes('vimeo.com/')) {
      const parts = clean.split('vimeo.com/');
      const v = parts[1]?.split('?')[0]?.split('/')[0];
      return v ? `https://player.vimeo.com/video/${v}` : clean;
    }
    return clean;
  };

  // Ação definitiva: "Plataforma Configurada" -> fecha e some para sempre
  const handleMarcarConfigurada = async () => {
    setSalvandoConclusao(true);
    try {
      if (storageKeyConcluido) {
        localStorage.setItem(storageKeyConcluido, 'true');
      }

      // Salva no banco de dados para sincronia permanente
      try {
        await supabase.rpc('marcar_onboarding_concluido', {
          p_tenant_id: tenant?.id,
        });
      } catch (errBanco) {
        console.warn('[Onboarding] Falha ao sincronizar conclusão no banco (mantido local):', errBanco);
      }

      showSuccess('🎉 Parabéns! Sua plataforma foi marcada como configurada com sucesso.');
      setVisivel(false);
      if (onConcluido) onConcluido();
      if (refetchTenantData) await refetchTenantData();
    } finally {
      setSalvandoConclusao(false);
    }
  };

  // Atalho para navegar até as seções cruciais de configuração
  const handleIrPara = (caminho: string) => {
    // Ao clicar em uma seção, minimiza o player automaticamente para ficar no canto da tela executando junto!
    setModoExpandido(false);
    setColapsado(false);
    navigate(caminho);
  };

  if (!visivel || carregandoConfig) {
    return null;
  }

  // Não exibe em rotas administrativas globais de super admin
  if (location.pathname.startsWith('/admin')) {
    return null;
  }

  const etapasSetup = [
    {
      id: 'oficina',
      num: '1',
      titulo: 'Dados da Oficina & Logo',
      descricao: 'Nome fantasia, WhatsApp de contato e logotipo',
      rota: '/configuracoes?aba=oficina',
      icon: Building2,
    },
    {
      id: 'horarios',
      num: '2',
      titulo: 'Horários e Boxes',
      descricao: 'Dias de funcionamento e capacidade de atendimento',
      rota: '/configuracoes?aba=horarios',
      icon: Calendar,
    },
    {
      id: 'servicos',
      num: '3',
      titulo: 'Catálogo de Serviços',
      descricao: 'Serviços oferecidos, preços e tempos de execução',
      rota: '/servicos',
      icon: Tag,
    },
    {
      id: 'agendamento',
      num: '4',
      titulo: 'Agendamento Online & PIX',
      descricao: 'Chave PIX e percentual do sinal de confirmação',
      rota: '/configuracoes?aba=agendamento',
      icon: QrCode,
    },
    {
      id: 'termos',
      num: '5',
      titulo: 'Minutas & Garantias',
      descricao: 'Termos de responsabilidade e garantias com advogado',
      rota: '/configuracoes?aba=termos',
      icon: ShieldCheck,
    },
  ];

  // =========================================================================
  // MODO 1: MINI-PLAYER FLUTUANTE (Picture-in-Picture no Canto Inferior)
  // =========================================================================
  if (!modoExpandido) {
    return (
      <aside 
        aria-label="Player do Tutorial de Configuração"
        className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 flex flex-col items-end pointer-events-auto select-none"
      >
        <div
          className={`bg-graphite-900/95 border border-amber-500/40 shadow-2xl backdrop-blur-xl rounded-2xl overflow-hidden transition-all duration-300 ${
            colapsado ? 'w-72 sm:w-80' : 'w-80 sm:w-96'
          }`}
        >
          {/* Barra de Título do Mini-Player */}
          <div className="bg-graphite-950/80 px-3.5 py-2.5 flex items-center justify-between border-b border-graphite-700/60">
            <div className="flex items-center gap-2 truncate pr-2">
              <div className="w-6 h-6 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                <Sparkles className="w-3.5 h-3.5" />
              </div>
              <div className="truncate">
                <span className="text-xs font-bold text-vapor-100 truncate block font-display tracking-tight">
                  Tutorial de Iniciação
                </span>
                <span className="text-[10px] text-amber-400 font-medium">
                  {porcentagemAssistida}% assistido
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {/* Botão de Colapsar/Expandir Altura */}
              <button
                type="button"
                onClick={() => setColapsado(!colapsado)}
                className="p-1 rounded-md text-vapor-400 hover:text-vapor-100 hover:bg-graphite-800 transition-colors"
                title={colapsado ? 'Expandir Mini-Player' : 'Recolher Mini-Player'}
              >
                {colapsado ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {/* Botão de Maximizar para Tela Cheia / Modal */}
              <button
                type="button"
                onClick={() => setModoExpandido(true)}
                className="p-1 rounded-md text-vapor-400 hover:text-vapor-100 hover:bg-graphite-800 transition-colors"
                title="Maximizar Vídeo"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Conteúdo do Mini-Player (quando não colapsado) */}
          {!colapsado && (
            <div className="p-3 space-y-3">
              {/* Vídeo Embed Compacto */}
              <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden border border-graphite-800 shadow-inner">
                {videoUrl && (videoUrl.includes('.mp4') || videoUrl.includes('.webm')) ? (
                  <video
                    src={videoUrl}
                    controls
                    playsInline
                    onPlay={() => setEstaReproduzindo(true)}
                    onPause={() => setEstaReproduzindo(false)}
                    onEnded={() => {
                      setEstaReproduzindo(false);
                      setSegundosAssistidos(duracaoTotalSegundos);
                    }}
                    onTimeUpdate={(e) => {
                      const videoEl = e.currentTarget;
                      if (videoEl.duration) {
                        setDuracaoTotalSegundos(Math.round(videoEl.duration));
                        setSegundosAssistidos(Math.round(videoEl.currentTime));
                      }
                    }}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <iframe
                    src={obterEmbedUrl(videoUrl)}
                    title="Vídeo Tutorial de Iniciação"
                    className="w-full h-full border-0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                )}
              </div>

              {/* Barra de Progresso e % Assistida */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-vapor-400">
                  <span className="flex items-center gap-1 text-vapor-300 font-semibold">
                    <Clock className="w-3 h-3 text-amber-400" />
                    {formatarTempo(segundosAssistidos)} / {formatarTempo(duracaoTotalSegundos)}
                  </span>
                  <span className="font-bold text-amber-400">{porcentagemAssistida}% concluído</span>
                </div>
                <div className="w-full h-1.5 bg-graphite-800 rounded-full overflow-hidden border border-graphite-700">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 to-amber-300 rounded-full transition-all duration-300"
                    style={{ width: `${porcentagemAssistida}%` }}
                  />
                </div>
              </div>

              {/* Atalhos Rápidos para Ir Executando Enquanto Assiste */}
              <div className="space-y-1.5 pt-1">
                <span className="text-[10px] font-semibold text-vapor-400 uppercase tracking-wider block">
                  Atalhos Rápidos de Configuração:
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleIrPara('/configuracoes?aba=oficina')}
                    className="flex items-center gap-1.5 p-1.5 rounded-lg bg-graphite-800/80 hover:bg-amber-500/10 border border-graphite-700 hover:border-amber-500/40 text-[11px] text-vapor-200 transition-all text-left truncate group"
                  >
                    <Building2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="truncate group-hover:text-amber-300">1. Oficina</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleIrPara('/configuracoes?aba=horarios')}
                    className="flex items-center gap-1.5 p-1.5 rounded-lg bg-graphite-800/80 hover:bg-amber-500/10 border border-graphite-700 hover:border-amber-500/40 text-[11px] text-vapor-200 transition-all text-left truncate group"
                  >
                    <Calendar className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="truncate group-hover:text-amber-300">2. Horários</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleIrPara('/servicos')}
                    className="flex items-center gap-1.5 p-1.5 rounded-lg bg-graphite-800/80 hover:bg-amber-500/10 border border-graphite-700 hover:border-amber-500/40 text-[11px] text-vapor-200 transition-all text-left truncate group"
                  >
                    <Tag className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="truncate group-hover:text-amber-300">3. Serviços</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleIrPara('/configuracoes?aba=agendamento')}
                    className="flex items-center gap-1.5 p-1.5 rounded-lg bg-graphite-800/80 hover:bg-amber-500/10 border border-graphite-700 hover:border-amber-500/40 text-[11px] text-vapor-200 transition-all text-left truncate group"
                  >
                    <QrCode className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="truncate group-hover:text-amber-300">4. PIX & Vitrine</span>
                  </button>
                </div>
              </div>

              {/* BOTÃO PRINCIPAL DEFINITIVO: "Plataforma Configurada" */}
              <div className="pt-2 border-t border-graphite-800">
                <button
                  type="button"
                  onClick={handleMarcarConfigurada}
                  disabled={salvandoConclusao}
                  className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-graphite-950 font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 active:scale-[0.98] transition-all cursor-pointer"
                  title="Finalizar e remover o player da tela permanentemente"
                >
                  <CheckCircle2 className="w-4 h-4 text-graphite-950" />
                  <span>{salvandoConclusao ? 'Salvando...' : 'Plataforma Configurada ✔️'}</span>
                </button>
                <p className="text-[10px] text-center text-vapor-500 mt-1">
                  Clique aqui quando terminar para ocultar o player para sempre.
                </p>
              </div>
            </div>
          )}

          {/* Versão colapsada mínima com barra de progresso */}
          {colapsado && (
            <div className="px-3 py-2 bg-graphite-950/60 border-t border-graphite-800/60 flex items-center justify-between gap-2">
              <div className="w-full h-1.5 bg-graphite-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-400 rounded-full transition-all duration-300"
                  style={{ width: `${porcentagemAssistida}%` }}
                />
              </div>
              <button
                type="button"
                onClick={handleMarcarConfigurada}
                className="shrink-0 px-2 py-1 text-[10px] font-bold bg-emerald-500 text-graphite-950 rounded-md hover:bg-emerald-400 transition-colors"
              >
                Concluir
              </button>
            </div>
          )}
        </div>
      </aside>
    );
  }

  // =========================================================================
  // MODO 2: MODAL CENTRALIZADO EXPANDIDO (Visualização Inicial / Detalhada)
  // =========================================================================
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-graphite-950/85 backdrop-blur-md animate-fade-in overflow-y-auto">
      <div className="bg-graphite-900 border border-amber-500/40 rounded-2xl max-w-4xl w-full shadow-2xl flex flex-col my-auto max-h-[92vh] overflow-hidden">
        {/* Cabeçalho do Modal */}
        <div className="bg-graphite-950/90 px-4 sm:px-6 py-4 border-b border-graphite-700/60 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center text-graphite-950 shadow-md shadow-amber-500/20 shrink-0">
              <Sparkles className="w-5 h-5 font-bold" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-vapor-100 font-display uppercase tracking-wide">
                  {videoTitulo}
                </h3>
                <span className="hidden sm:inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  Guia Oficial
                </span>
              </div>
              <p className="text-xs text-vapor-400">
                Siga as orientações para deixar sua oficina 100% pronta para receber clientes e faturar.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Minimizar para ir executando junto */}
            <button
              type="button"
              onClick={() => setModoExpandido(false)}
              className="px-3 py-1.5 rounded-lg bg-graphite-800 hover:bg-graphite-700 text-vapor-300 hover:text-vapor-100 text-xs font-semibold flex items-center gap-1.5 border border-graphite-700 transition-colors"
              title="Minimizar e continuar no canto da tela enquanto configura"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Minimizar & Navegar</span>
            </button>
          </div>
        </div>

        {/* Corpo do Modal com Scroll Interno */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5">
          {/* Player do Vídeo 16:9 */}
          <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-graphite-800 shadow-2xl">
            {videoUrl && (videoUrl.includes('.mp4') || videoUrl.includes('.webm')) ? (
              <video
                src={videoUrl}
                controls
                playsInline
                autoPlay
                onPlay={() => setEstaReproduzindo(true)}
                onPause={() => setEstaReproduzindo(false)}
                onEnded={() => {
                  setEstaReproduzindo(false);
                  setSegundosAssistidos(duracaoTotalSegundos);
                }}
                onTimeUpdate={(e) => {
                  const videoEl = e.currentTarget;
                  if (videoEl.duration) {
                    setDuracaoTotalSegundos(Math.round(videoEl.duration));
                    setSegundosAssistidos(Math.round(videoEl.currentTime));
                  }
                }}
                className="w-full h-full object-cover"
              />
            ) : (
              <iframe
                src={obterEmbedUrl(videoUrl)}
                title="Vídeo Tutorial de Iniciação"
                className="w-full h-full border-0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            )}
          </div>

          {/* Régua de Progresso do Vídeo */}
          <div className="bg-graphite-950/60 p-3 rounded-xl border border-graphite-800 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-vapor-300 font-medium flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-amber-400" />
                Tempo de Vídeo: <strong className="text-vapor-100">{formatarTempo(segundosAssistidos)}</strong> /{' '}
                {formatarTempo(duracaoTotalSegundos)}
              </span>
              <span className="font-bold text-amber-400">{porcentagemAssistida}% Assistido</span>
            </div>
            <div className="w-full h-2 bg-graphite-800 rounded-full overflow-hidden border border-graphite-700">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-amber-300 rounded-full transition-all duration-300"
                style={{ width: `${porcentagemAssistida}%` }}
              />
            </div>
          </div>

          {/* Roteiro e Atalhos das 5 Etapas de Configuração */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-vapor-200 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              Etapas Essenciais Ensinadas no Vídeo:
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {etapasSetup.map((etapa) => {
                const Icone = etapa.icon;
                return (
                  <button
                    key={etapa.id}
                    type="button"
                    onClick={() => handleIrPara(etapa.rota)}
                    className="p-3 rounded-xl bg-graphite-800/80 hover:bg-amber-500/10 border border-graphite-700 hover:border-amber-500/40 text-left transition-all group flex items-start gap-2.5"
                  >
                    <div className="w-7 h-7 rounded-lg bg-graphite-900 border border-graphite-700 group-hover:border-amber-500/50 flex items-center justify-center text-amber-400 shrink-0 text-xs font-bold">
                      <Icone className="w-3.5 h-3.5" />
                    </div>
                    <div className="truncate">
                      <div className="text-xs font-bold text-vapor-100 group-hover:text-amber-300 truncate flex items-center gap-1">
                        <span>{etapa.titulo}</span>
                        <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <p className="text-[11px] text-vapor-400 truncate">{etapa.descricao}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Rodapé com os dois botões principais de ação */}
        <div className="bg-graphite-950/90 px-4 sm:px-6 py-4 border-t border-graphite-700/60 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-vapor-400 text-center sm:text-left">
            <span>Deseja ir preenchendo enquanto o vídeo rola?</span>{' '}
            <strong className="text-amber-400">O player flutua na tela sem travar sua navegação.</strong>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            {/* Botão para Minimizar e Configurar Junto */}
            <button
              type="button"
              onClick={() => setModoExpandido(false)}
              className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-graphite-800 hover:bg-graphite-700 text-vapor-200 hover:text-vapor-100 font-semibold text-xs border border-graphite-600 transition-all flex items-center justify-center gap-2"
            >
              <Minimize2 className="w-4 h-4 text-amber-400" />
              <span>Configurar Enquanto Assisto</span>
            </button>

            {/* Botão Definitivo: Marcar Plataforma como Configurada */}
            <button
              type="button"
              onClick={handleMarcarConfigurada}
              disabled={salvandoConclusao}
              className="flex-1 sm:flex-initial px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-graphite-950 font-bold text-xs shadow-lg shadow-emerald-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4 text-graphite-950" />
              <span>{salvandoConclusao ? 'Salvando...' : 'Plataforma Configurada ✔️'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
