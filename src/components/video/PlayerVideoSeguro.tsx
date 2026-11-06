import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  ShieldCheck, 
  Play,
  Pause,
  RotateCcw, 
  RotateCw, 
  Volume2,
  Volume1,
  VolumeX,
  Maximize2,
  Minimize2,
  Loader2,
  CheckCircle2
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

// Declaração de tipagem do YouTube IFrame API
declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
    __ytApiPromise?: Promise<void>;
  }
}

export interface PlayerVideoSeguroProps {
  url: string;
  titulo?: string;
  autoPlay?: boolean;
  tempoInicial?: number;
  mostrarWatermark?: boolean;
  textoWatermark?: string;
  className?: string;
  onProgresso?: (dados: {
    segundosAssistidos: number;
    duracaoTotal: number;
    porcentagem: number;
    estaReproduzindo: boolean;
  }) => void;
  onConcluido?: () => void;
  onReady?: () => void;
}

export interface DadosVideoParsed {
  plataforma: 'youtube' | 'vimeo' | 'arquivo' | 'desconhecido';
  videoId: string;
  embedUrl: string;
  urlOriginal: string;
}

/**
 * Formata segundos em mm:ss ou hh:mm:ss
 */
export function formatarTempoVideo(segundos: number): string {
  if (!segundos || isNaN(segundos) || segundos < 0) return '00:00';
  const totalSegs = Math.floor(segundos);
  const mins = Math.floor(totalSegs / 60);
  const secs = totalSegs % 60;
  const hrs = Math.floor(mins / 60);

  if (hrs > 0) {
    const minsRestantes = mins % 60;
    return `${hrs}:${minsRestantes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Analisa e extrai informações essenciais do vídeo, desativando 100% de controles nativos externos
 */
export function analisarUrlVideo(rawUrl: string): DadosVideoParsed {
  if (!rawUrl || !rawUrl.trim()) {
    return {
      plataforma: 'desconhecido',
      videoId: '',
      embedUrl: '',
      urlOriginal: '',
    };
  }

  const clean = rawUrl.trim();

  // 1. YouTube (watch, embed, youtu.be, shorts)
  const ytMatch = clean.match(
    /(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i
  );
  if (ytMatch && ytMatch[1]) {
    const videoId = ytMatch[1];
    // controls=0 remove a barra de controles e logo. enablejsapi=1 permite controle via postMessage/API
    const embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}?enablejsapi=1&controls=0&rel=0&modestbranding=1&iv_load_policy=3&playsinline=1&disablekb=1&fs=0&cc_load_policy=0`;
    return {
      plataforma: 'youtube',
      videoId,
      embedUrl,
      urlOriginal: clean,
    };
  }

  // 2. Vimeo
  const vimeoMatch = clean.match(/(?:vimeo\.com\/(?:video\/)?|player\.vimeo\.com\/video\/)([0-9]+)/i);
  if (vimeoMatch && vimeoMatch[1]) {
    const videoId = vimeoMatch[1];
    return {
      plataforma: 'vimeo',
      videoId,
      embedUrl: `https://player.vimeo.com/video/${videoId}?title=0&byline=0&portrait=0&badge=0&controls=0`,
      urlOriginal: clean,
    };
  }

  // 3. Arquivo de vídeo direto MP4 / WebM / Supabase Storage
  if (/\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(clean) || clean.includes('/storage/v1/object/public/')) {
    return {
      plataforma: 'arquivo',
      videoId: '',
      embedUrl: clean,
      urlOriginal: clean,
    };
  }

  // Fallback
  return {
    plataforma: 'desconhecido',
    videoId: '',
    embedUrl: clean,
    urlOriginal: clean,
  };
}

/**
 * Singleton de carregamento assíncrono e ultra-resiliente da YouTube IFrame API
 */
function carregarYouTubeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();

  if (window.YT && window.YT.Player) {
    return Promise.resolve();
  }

  if (window.__ytApiPromise) {
    return window.__ytApiPromise;
  }

  window.__ytApiPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve();
      return;
    }

    try {
      const existingScript = document.querySelector('script[src*="youtube.com/iframe_api"]');
      if (!existingScript) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        tag.async = true;
        document.head.appendChild(tag);
      }
    } catch {}

    const anteriorCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof anteriorCallback === 'function') {
        try {
          anteriorCallback();
        } catch {}
      }
      resolve();
    };

    let tentativas = 0;
    const interval = setInterval(() => {
      tentativas++;
      if (window.YT && window.YT.Player) {
        clearInterval(interval);
        resolve();
      } else if (tentativas > 120) {
        clearInterval(interval);
        resolve();
      }
    }, 50);
  });

  return window.__ytApiPromise;
}

export const PlayerVideoSeguro: React.FC<PlayerVideoSeguroProps> = ({
  url,
  titulo,
  autoPlay = false,
  tempoInicial = 0,
  mostrarWatermark = true,
  textoWatermark,
  className = '',
  onProgresso,
  onConcluido,
  onReady,
}) => {
  const { tenant, user } = useAuth();
  const videoData = analisarUrlVideo(url);

  // Elementos e referências
  const containerIdRef = useRef(`player_seguro_${Math.random().toString(36).substring(2, 9)}`);
  const iframeContainerRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<any>(null);
  const videoTagRef = useRef<HTMLVideoElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const hideControlsTimerRef = useRef<any>(null);

  // Estados de reprodução e telemetria
  const [carregandoApi, setCarregandoApi] = useState(false);
  const [estaReproduzindo, setEstaReproduzindo] = useState(false);
  const [tempoAtual, setTempoAtual] = useState(tempoInicial || 0);
  const [duracaoTotal, setDuracaoTotal] = useState(0);
  const [estaConcluido, setEstaConcluido] = useState(false);

  // Controles de áudio e UI
  const [volume, setVolume] = useState(100);
  const [isMuted, setIsMuted] = useState(false);
  const [velocidade, setVelocidade] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mostrarControles, setMostrarControles] = useState(true);
  const [feedbackCentral, setFeedbackCentral] = useState<'play' | 'pause' | null>(null);

  // Texto da marca d'água anti-pirataria
  const watermarkFinal = textoWatermark || (
    tenant?.nome 
      ? `EXCLUSIVO • ${tenant.nome.toUpperCase()} • ${user?.email || ''}`
      : `ACESSO EXCLUSIVO • PLATAFORMA DETAILERS`
  );

  const enviarComandoIframe = useCallback((func: string, args: any[] = []) => {
    try {
      const container = iframeContainerRef.current;
      const iframe = container ? container.querySelector('iframe') : null;
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage(
          JSON.stringify({
            event: 'command',
            func,
            args,
          }),
          '*'
        );
      }
    } catch {}
  }, []);

  // 1. INICIALIZAÇÃO RESILIENTE DO PLAYER DO YOUTUBE
  useEffect(() => {
    let ativo = true;

    if (videoData.plataforma !== 'youtube') return;

    carregarYouTubeApi()
      .then(() => {
        if (!ativo) return;

        if (window.YT && window.YT.Player) {
          try {
            if (ytPlayerRef.current && typeof ytPlayerRef.current.destroy === 'function') {
              try { ytPlayerRef.current.destroy(); } catch {}
            }

            const targetElement = document.getElementById(containerIdRef.current);
            if (!targetElement) return;

            ytPlayerRef.current = new window.YT.Player(containerIdRef.current, {
              events: {
                onReady: (event: any) => {
                  if (!ativo) return;
                  setCarregandoApi(false);
                  try {
                    const dur = event.target.getDuration();
                    if (dur && dur > 0) {
                      setDuracaoTotal(Math.round(dur));
                    }
                    if (tempoInicial && tempoInicial > 0) {
                      event.target.seekTo(tempoInicial, true);
                    }
                  } catch {}
                  onReady?.();
                },
                onStateChange: (event: any) => {
                  if (!ativo) return;
                  if (event.data === 1) {
                    setEstaReproduzindo(true);
                    setEstaConcluido(false);
                  } else if (event.data === 0) {
                    setEstaReproduzindo(false);
                    setEstaConcluido(true);
                    onConcluido?.();
                  } else {
                    setEstaReproduzindo(false);
                  }
                },
                onError: () => {
                  if (ativo) setCarregandoApi(false);
                },
              },
            });
          } catch (errInit) {
            console.warn('[PlayerVideoSeguro] Inicializacao YT.Player, postMessage ativo:', errInit);
          }
        }
      })
      .catch(() => {});

    return () => {
      ativo = false;
      if (ytPlayerRef.current && typeof ytPlayerRef.current.destroy === 'function') {
        try {
          ytPlayerRef.current.destroy();
        } catch {}
      }
    };
  }, [videoData.videoId, videoData.plataforma, autoPlay]);

  // 2. ESCUTA MENSAGENS POSTMESSAGE DO YOUTUBE PARA SINCRONIA GARANTIDA
  useEffect(() => {
    if (videoData.plataforma !== 'youtube') return;

    const handleMessage = (event: MessageEvent) => {
      try {
        if (!event.data || typeof event.data !== 'string') return;
        const parsed = JSON.parse(event.data);

        if (parsed.event === 'onStateChange') {
          if (parsed.info === 1) {
            setEstaReproduzindo(true);
            setEstaConcluido(false);
          } else if (parsed.info === 0) {
            setEstaReproduzindo(false);
            setEstaConcluido(true);
            onConcluido?.();
          } else if (parsed.info === 2) {
            setEstaReproduzindo(false);
          }
        }

        if (parsed.event === 'infoDelivery' && parsed.info) {
          if (typeof parsed.info.currentTime === 'number') {
            const segs = Math.floor(parsed.info.currentTime);
            setTempoAtual(segs);
          }
          if (typeof parsed.info.duration === 'number' && parsed.info.duration > 0) {
            setDuracaoTotal(Math.floor(parsed.info.duration));
          }
        }
      } catch {}
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [videoData.plataforma, onConcluido]);

  // 3. MONITORAMENTO DE TEMPO E TELEMETRIA EM ALTA FIDELIDADE
  useEffect(() => {
    if (!estaReproduzindo || videoData.plataforma !== 'youtube') return;

    const interval = setInterval(() => {
      if (ytPlayerRef.current && typeof ytPlayerRef.current.getCurrentTime === 'function') {
        try {
          const cur = ytPlayerRef.current.getCurrentTime() || 0;
          const dur = ytPlayerRef.current.getDuration() || duracaoTotal;

          const segs = Math.floor(cur);
          const duracao = dur > 0 ? Math.floor(dur) : duracaoTotal;
          const pct = duracao > 0 ? Math.min(100, Math.round((segs / duracao) * 100)) : 0;

          setTempoAtual(segs);
          if (duracao > 0 && duracao !== duracaoTotal) {
            setDuracaoTotal(duracao);
          }

          onProgresso?.({
            segundosAssistidos: segs,
            duracaoTotal: duracao,
            porcentagem: pct,
            estaReproduzindo: true,
          });
        } catch {}
      }
    }, 300);

    return () => clearInterval(interval);
  }, [estaReproduzindo, videoData.plataforma, duracaoTotal, onProgresso]);

  // 4. AUTO-HIDE DOS CONTROLES APÓS INATIVIDADE
  const resetarTemporizadorControles = useCallback(() => {
    setMostrarControles(true);
    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current);
    }
    if (estaReproduzindo && !estaConcluido) {
      hideControlsTimerRef.current = setTimeout(() => {
        setMostrarControles(false);
      }, 2800);
    }
  }, [estaReproduzindo, estaConcluido]);

  useEffect(() => {
    resetarTemporizadorControles();
    return () => {
      if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    };
  }, [estaReproduzindo, resetarTemporizadorControles]);

  // 5. SINCRONIZA ESTADO DE FULLSCREEN
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  // REINICIAR VÍDEO
  const reiniciarVideo = useCallback(() => {
    setEstaConcluido(false);
    setTempoAtual(0);

    if (videoData.plataforma === 'youtube') {
      if (ytPlayerRef.current && typeof ytPlayerRef.current.seekTo === 'function') {
        try {
          ytPlayerRef.current.seekTo(0, true);
          ytPlayerRef.current.playVideo();
        } catch {}
      }
      enviarComandoIframe('seekTo', [0, true]);
      enviarComandoIframe('playVideo');
      setEstaReproduzindo(true);
    } else if (videoTagRef.current) {
      videoTagRef.current.currentTime = 0;
      videoTagRef.current.play();
    }
  }, [videoData.plataforma, enviarComandoIframe]);

  // PLAY / PAUSE COM RESILIÊNCIA TOTAL
  const alternarPlayPause = useCallback(() => {
    resetarTemporizadorControles();
    if (estaConcluido) {
      reiniciarVideo();
      return;
    }

    if (videoData.plataforma === 'youtube') {
      let mudou = false;
      if (ytPlayerRef.current && typeof ytPlayerRef.current.getPlayerState === 'function') {
        try {
          const state = ytPlayerRef.current.getPlayerState();
          if (state === 1) {
            ytPlayerRef.current.pauseVideo();
            setEstaReproduzindo(false);
            setFeedbackCentral('pause');
          } else {
            ytPlayerRef.current.playVideo();
            setEstaReproduzindo(true);
            setFeedbackCentral('play');
          }
          mudou = true;
        } catch {}
      }

      // Fallback garantido por postMessage direto para o iframe
      if (!mudou) {
        if (estaReproduzindo) {
          enviarComandoIframe('pauseVideo');
          setEstaReproduzindo(false);
          setFeedbackCentral('pause');
        } else {
          enviarComandoIframe('playVideo');
          setEstaReproduzindo(true);
          setFeedbackCentral('play');
        }
      }
    } else if (videoTagRef.current) {
      if (videoTagRef.current.paused) {
        videoTagRef.current.play();
        setFeedbackCentral('play');
      } else {
        videoTagRef.current.pause();
        setFeedbackCentral('pause');
      }
    }

    setTimeout(() => {
      setFeedbackCentral(null);
    }, 600);
  }, [videoData.plataforma, estaReproduzindo, estaConcluido, reiniciarVideo, enviarComandoIframe, resetarTemporizadorControles]);

  const pularSegundos = useCallback((delta: number) => {
    resetarTemporizadorControles();
    if (videoData.plataforma === 'youtube') {
      const cur = tempoAtual;
      const dur = duracaoTotal > 0 ? duracaoTotal : 9999;
      const novo = Math.max(0, Math.min(dur, cur + delta));

      if (ytPlayerRef.current && typeof ytPlayerRef.current.seekTo === 'function') {
        try {
          ytPlayerRef.current.seekTo(novo, true);
        } catch {}
      }
      enviarComandoIframe('seekTo', [novo, true]);
      setTempoAtual(Math.floor(novo));
    } else if (videoTagRef.current) {
      const cur = videoTagRef.current.currentTime || 0;
      const dur = videoTagRef.current.duration || duracaoTotal;
      const novo = Math.max(0, Math.min(dur, cur + delta));
      videoTagRef.current.currentTime = novo;
      setTempoAtual(Math.floor(novo));
    }
  }, [videoData.plataforma, tempoAtual, duracaoTotal, enviarComandoIframe, resetarTemporizadorControles]);

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    resetarTemporizadorControles();
    if (!progressBarRef.current || duracaoTotal <= 0) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const novoTempo = ratio * duracaoTotal;

    if (videoData.plataforma === 'youtube') {
      if (ytPlayerRef.current && typeof ytPlayerRef.current.seekTo === 'function') {
        try {
          ytPlayerRef.current.seekTo(novoTempo, true);
        } catch {}
      }
      enviarComandoIframe('seekTo', [novoTempo, true]);
    } else if (videoTagRef.current) {
      videoTagRef.current.currentTime = novoTempo;
    }
    setTempoAtual(novoTempo);
  };

  const alternarMute = useCallback(() => {
    resetarTemporizadorControles();
    const novoMute = !isMuted;
    setIsMuted(novoMute);

    if (videoData.plataforma === 'youtube') {
      if (ytPlayerRef.current) {
        try {
          if (novoMute) {
            ytPlayerRef.current.mute();
          } else {
            ytPlayerRef.current.unMute();
            if (volume === 0) {
              setVolume(50);
              ytPlayerRef.current.setVolume(50);
            }
          }
        } catch {}
      }
      enviarComandoIframe(novoMute ? 'mute' : 'unMute');
    } else if (videoTagRef.current) {
      videoTagRef.current.muted = novoMute;
    }
  }, [isMuted, volume, videoData.plataforma, enviarComandoIframe, resetarTemporizadorControles]);

  const alterarVolume = (novoVol: number) => {
    resetarTemporizadorControles();
    setVolume(novoVol);
    setIsMuted(novoVol === 0);

    if (videoData.plataforma === 'youtube') {
      if (ytPlayerRef.current && typeof ytPlayerRef.current.setVolume === 'function') {
        try {
          ytPlayerRef.current.setVolume(novoVol);
          if (novoVol > 0 && ytPlayerRef.current.isMuted()) {
            ytPlayerRef.current.unMute();
          }
        } catch {}
      }
      enviarComandoIframe('setVolume', [novoVol]);
    } else if (videoTagRef.current) {
      videoTagRef.current.volume = novoVol / 100;
      videoTagRef.current.muted = novoVol === 0;
    }
  };

  const cicloVelocidade = useCallback(() => {
    resetarTemporizadorControles();
    const velocidades = [1, 1.25, 1.5, 2];
    const nextIdx = (velocidades.indexOf(velocidade) + 1) % velocidades.length;
    const proxima = velocidades[nextIdx];
    setVelocidade(proxima);

    if (videoData.plataforma === 'youtube') {
      if (ytPlayerRef.current && typeof ytPlayerRef.current.setPlaybackRate === 'function') {
        try {
          ytPlayerRef.current.setPlaybackRate(proxima);
        } catch {}
      }
      enviarComandoIframe('setPlaybackRate', [proxima]);
    } else if (videoTagRef.current) {
      videoTagRef.current.playbackRate = proxima;
    }
  }, [velocidade, videoData.plataforma, enviarComandoIframe, resetarTemporizadorControles]);

  const alternarFullscreen = useCallback(() => {
    resetarTemporizadorControles();
    if (!wrapperRef.current) return;
    if (!document.fullscreenElement) {
      wrapperRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, [resetarTemporizadorControles]);

  const porcentagemProgresso = duracaoTotal > 0 ? Math.min(100, (tempoAtual / duracaoTotal) * 100) : 0;

  return (
    <div 
      ref={wrapperRef}
      onMouseMove={resetarTemporizadorControles}
      onClick={resetarTemporizadorControles}
      onContextMenu={(e) => {
        e.preventDefault();
        return false;
      }}
      className={`relative w-full aspect-video bg-black rounded-xl overflow-hidden shadow-2xl border border-graphite-800 select-none group font-sans ${className}`}
    >
      {/* 1. YOUTUBE COM SAFE-CROP (SCALE 1.25): RENDERIZA IFRAME DIRETO E CORTA 100% DE LOGOS E LINKS */}
      {videoData.plataforma === 'youtube' && (
        <div ref={iframeContainerRef} className="w-full h-full relative overflow-hidden bg-black flex items-center justify-center">
          <div className="w-full h-full pointer-events-none scale-[1.25] transform-gpu origin-center">
            <iframe 
              id={containerIdRef.current} 
              src={videoData.embedUrl}
              title={titulo || 'Vídeo Seguro'}
              className="w-full h-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>

          {/* ESCUDO DE BLOQUEIO INFERIOR SÓLIDO (Garante que nenhuma logo do YouTube apareça em vídeos 9:16) */}
          <div className="absolute bottom-0 inset-x-0 h-16 bg-gradient-to-t from-graphite-950 via-graphite-950/95 to-transparent pointer-events-none z-10" />

          {/* ESCUDO DE BLOQUEIO SUPERIOR SÓLIDO (Garante que nenhum título ou avatar do canal apareça) */}
          <div className="absolute top-0 inset-x-0 h-12 bg-gradient-to-b from-graphite-950/90 via-graphite-950/60 to-transparent pointer-events-none z-10" />

          {carregandoApi && (
            <div className="absolute inset-0 bg-graphite-950 flex flex-col items-center justify-center gap-2 z-20 text-vapor-300">
              <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
              <span className="text-xs font-mono">Carregando player seguro...</span>
            </div>
          )}
        </div>
      )}

      {/* 2. ARQUIVO DIRETO MP4 / WEBM (HOSPEDAGEM NATIVA 100% LIMPA NA PLATAFORMA) */}
      {videoData.plataforma === 'arquivo' && (
        <video
          ref={videoTagRef}
          src={videoData.embedUrl}
          playsInline
          preload="metadata"
          autoPlay={autoPlay}
          onLoadedMetadata={(e) => {
            const el = e.currentTarget;
            if (el.duration && el.duration > 0) {
              setDuracaoTotal(Math.round(el.duration));
            }
            if (tempoInicial && tempoInicial > 0) {
              el.currentTime = tempoInicial;
            }
            setCarregandoApi(false);
            onReady?.();
          }}
          onPlay={() => {
            setEstaReproduzindo(true);
            setEstaConcluido(false);
          }}
          onPause={() => setEstaReproduzindo(false)}
          onEnded={() => {
            setEstaReproduzindo(false);
            setEstaConcluido(true);
            onConcluido?.();
          }}
          onTimeUpdate={(e) => {
            const el = e.currentTarget;
            if (el.duration) {
              const segs = Math.round(el.currentTime);
              const dur = Math.round(el.duration);
              const pct = dur > 0 ? Math.min(100, Math.round((segs / dur) * 100)) : 0;
              setTempoAtual(segs);
              setDuracaoTotal(dur);
              onProgresso?.({
                segundosAssistidos: segs,
                duracaoTotal: dur,
                porcentagem: pct,
                estaReproduzindo: true,
              });
            }
          }}
          className="w-full h-full object-contain bg-black pointer-events-none"
        />
      )}

      {/* 3. VIMEO OU OUTROS */}
      {videoData.plataforma === 'vimeo' && (
        <div className="w-full h-full relative overflow-hidden bg-black flex items-center justify-center">
          <iframe
            src={videoData.embedUrl}
            title={titulo || 'Player de Vídeo'}
            className="w-full h-full border-0 pointer-events-none scale-[1.05]"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}

      {/* CAMADA DE INTERCEPTAÇÃO DE CLIQUES TOTAL (O USUÁRIO NUNCA TOCA NO YOUTUBE) */}
      <div 
        onClick={alternarPlayPause}
        onDoubleClick={alternarFullscreen}
        className="absolute inset-0 z-15 cursor-pointer flex items-center justify-center bg-transparent"
      >
        {feedbackCentral && (
          <div className="w-16 h-16 rounded-full bg-black/80 backdrop-blur-md flex items-center justify-center text-amber-400 animate-ping pointer-events-none shadow-2xl">
            {feedbackCentral === 'play' ? <Play className="w-8 h-8 fill-amber-400 ml-1" /> : <Pause className="w-8 h-8 fill-amber-400" />}
          </div>
        )}

        {!estaReproduzindo && !estaConcluido && !carregandoApi && (
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-amber-500 hover:bg-amber-400 text-graphite-950 flex items-center justify-center shadow-2xl shadow-amber-500/40 transition-all hover:scale-110 active:scale-95 group/btn">
            <Play className="w-8 h-8 sm:w-10 sm:h-10 fill-graphite-950 ml-1 transition-transform group-hover/btn:scale-105" />
          </div>
        )}
      </div>

      {/* MARCA D'ÁGUA ANTI-PIRATARIA TRANSLÚCIDA */}
      {mostrarWatermark && (
        <div className="absolute inset-0 pointer-events-none z-15 overflow-hidden select-none flex items-center justify-center opacity-15 sm:opacity-20">
          <div 
            className="font-mono text-[10px] sm:text-xs text-vapor-100 tracking-wider whitespace-nowrap bg-black/50 px-3 py-1 rounded-lg border border-white/10 shadow-lg"
            style={{ transform: 'rotate(-12deg)' }}
          >
            {watermarkFinal}
          </div>
        </div>
      )}

      {/* TOPO: TÍTULO DA PLATAFORMA & BADGE SEGURO (ZERO YOUTUBE) */}
      <div className={`absolute top-0 left-0 right-0 z-20 p-3 sm:p-4 flex items-center justify-between pointer-events-none transition-opacity duration-300 ${mostrarControles || !estaReproduzindo ? 'opacity-100' : 'opacity-0'}`}>
        <div className="flex items-center gap-2 bg-graphite-950/85 backdrop-blur-md px-2.5 py-1 rounded-lg border border-graphite-800 text-[10px] sm:text-xs font-mono font-semibold text-emerald-400 shadow">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>REPRODUÇÃO PROTEGIDA</span>
        </div>

        {titulo && (
          <span className="hidden sm:inline-block max-w-[50%] truncate text-xs font-semibold text-vapor-200 bg-graphite-950/80 backdrop-blur-md px-2.5 py-1 rounded-lg border border-graphite-800 shadow">
            {titulo}
          </span>
        )}
      </div>

      {/* TELA DE CONCLUSÃO DO VÍDEO (IMPEDE VÍDEOS RECOMENDADOS DO YOUTUBE) */}
      {estaConcluido && (
        <div className="absolute inset-0 z-25 bg-graphite-950/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center space-y-4 animate-in fade-in duration-300">
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-xl shadow-emerald-500/20">
            <CheckCircle2 className="w-10 h-10" />
          </div>

          <div className="space-y-1">
            <h4 className="font-display font-bold text-vapor-100 text-lg">Vídeo Concluído!</h4>
            <p className="text-vapor-400 text-xs max-w-sm">
              Você assistiu este conteúdo na íntegra. Seu progresso foi salvo com sucesso.
            </p>
          </div>

          <button
            type="button"
            onClick={reiniciarVideo}
            className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-graphite-950 font-bold text-xs flex items-center gap-2 shadow-lg shadow-amber-500/20 transition-all hover:scale-105 active:scale-95 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Assistir Novamente</span>
          </button>
        </div>
      )}

      {/* BARRA DE CONTROLES INFERIOR SÓLIDA NATIVA (100% OPACA NA BASE, ZERO YOUTUBE) */}
      <div 
        className={`absolute bottom-0 left-0 right-0 z-20 pt-8 pb-3 px-3 sm:px-4 bg-gradient-to-t from-graphite-950 via-graphite-950/95 to-graphite-950/60 border-t border-graphite-800/80 flex flex-col gap-2 transition-opacity duration-300 pointer-events-auto ${mostrarControles || !estaReproduzindo ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        {/* LINHA 1: BARRA DE PROGRESSO COM SEEK SUAVE */}
        <div 
          ref={progressBarRef}
          onClick={handleSeek}
          className="w-full h-2 group/bar hover:h-3 bg-white/20 hover:bg-white/30 rounded-full cursor-pointer relative transition-all overflow-visible flex items-center"
          title="Clique para avançar ou retroceder"
        >
          <div 
            className="h-full bg-gradient-to-r from-amber-500 to-amber-300 rounded-full relative transition-all duration-75"
            style={{ width: `${porcentagemProgresso}%` }}
          >
            <div className="w-3.5 h-3.5 bg-amber-400 rounded-full shadow-lg border border-graphite-950 absolute -right-1.5 top-1/2 -translate-y-1/2 scale-0 group-hover/bar:scale-100 transition-transform" />
          </div>
        </div>

        {/* LINHA 2: BOTÕES DE REPRODUÇÃO, TEMPO, VOLUME, VELOCIDADE E FULLSCREEN */}
        <div className="flex items-center justify-between text-vapor-200 text-xs">
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={alternarPlayPause}
              className="p-1.5 rounded-lg hover:bg-white/10 text-vapor-100 hover:text-amber-400 transition-colors cursor-pointer"
              title={estaReproduzindo ? 'Pausar (Espaço)' : 'Reproduzir (Espaço)'}
            >
              {estaReproduzindo ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
            </button>

            <button
              type="button"
              onClick={() => pularSegundos(-10)}
              className="p-1.5 rounded-lg hover:bg-white/10 text-vapor-300 hover:text-amber-400 transition-colors cursor-pointer"
              title="Voltar 10 segundos"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => pularSegundos(10)}
              className="p-1.5 rounded-lg hover:bg-white/10 text-vapor-300 hover:text-amber-400 transition-colors cursor-pointer"
              title="Avançar 10 segundos"
            >
              <RotateCw className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1.5 group/vol">
              <button
                type="button"
                onClick={alternarMute}
                className="p-1.5 rounded-lg hover:bg-white/10 text-vapor-300 hover:text-vapor-100 transition-colors cursor-pointer"
                title={isMuted ? 'Desativar Mudo' : 'Silenciar'}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-4 h-4 text-red-400" />
                ) : volume < 50 ? (
                  <Volume1 className="w-4 h-4" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>

              <input
                type="range"
                min="0"
                max="100"
                value={isMuted ? 0 : volume}
                onChange={(e) => alterarVolume(parseInt(e.target.value, 10))}
                className="w-14 sm:w-18 h-1 bg-white/20 accent-amber-500 rounded-lg cursor-pointer"
                title={`Volume: ${isMuted ? 0 : volume}%`}
              />
            </div>

            <div className="font-mono text-[11px] sm:text-xs text-vapor-300 ml-1">
              <span className="text-vapor-100 font-bold">{formatarTempoVideo(tempoAtual)}</span>
              <span className="text-vapor-500 mx-1">/</span>
              <span>{formatarTempoVideo(duracaoTotal)}</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={cicloVelocidade}
              className="px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-[11px] font-mono font-bold text-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
              title="Alterar velocidade de reprodução"
            >
              {velocidade}x
            </button>

            <button
              type="button"
              onClick={alternarFullscreen}
              className="p-1.5 rounded-lg hover:bg-white/10 text-vapor-300 hover:text-vapor-100 transition-colors cursor-pointer"
              title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
