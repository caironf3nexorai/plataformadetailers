import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  CheckCircle2 
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

export interface PlayerVideoSeguroProps {
  url: string;
  titulo?: string;
  autoPlay?: boolean;
  tempoInicial?: number;
  mostrarWatermark?: boolean;
  textoWatermark?: string;
  modoCompacto?: boolean;
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
 * Analisa e extrai informacoes essenciais do video, desativando controles nativos
 */
export function analisarUrlVideo(rawUrl: string, tempoInicial = 0, autoPlay = false): DadosVideoParsed {
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
    /(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i
  );
  if (ytMatch && ytMatch[1]) {
    const videoId = ytMatch[1];
    // controls=0 remove a barra e logo do YouTube. enablejsapi=1 permite controle via postMessage sem script externo
    const originParam = typeof window !== 'undefined' && window.location && window.location.origin ? `&origin=${encodeURIComponent(window.location.origin)}` : '';
    const autoPlayParam = autoPlay ? '&autoplay=1' : '';
    const embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}?enablejsapi=1&controls=0&rel=0&modestbranding=1&iv_load_policy=3&playsinline=1&disablekb=1&fs=0&cc_load_policy=0&cc_lang_pref=off${autoPlayParam}${originParam}${tempoInicial && tempoInicial > 0 ? `&start=${Math.floor(tempoInicial)}` : ''}`;
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

  // 3. Arquivo de video direto MP4 / WebM / Supabase Storage
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

export const PlayerVideoSeguro: React.FC<PlayerVideoSeguroProps> = ({
  url,
  titulo,
  autoPlay = false,
  tempoInicial = 0,
  mostrarWatermark = true,
  textoWatermark,
  modoCompacto = false,
  className = '',
  onProgresso,
  onConcluido,
  onReady,
}) => {
  const { tenant, user } = useAuth();

  // Armazena o tempo inicial apenas no momento de montagem do componente.
  // Isso e CRUCIAL: impede que re-renderizacoes com progresso recalculado alterem a embedUrl
  // e forcem o navegador a recarregar o iframe do YouTube continuamente a cada segundo.
  const tempoInicialMontagemRef = useRef(tempoInicial || 0);
  const jaFezSeekInicialRef = useRef(false);
  const urlAnteriorRef = useRef(url);

  if (urlAnteriorRef.current !== url) {
    urlAnteriorRef.current = url;
    tempoInicialMontagemRef.current = tempoInicial || 0;
    jaFezSeekInicialRef.current = false;
  }

  const videoData = useMemo(() => {
    return analisarUrlVideo(url, tempoInicialMontagemRef.current);
  }, [url]);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const videoTagRef = useRef<HTMLVideoElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const hideControlsTimerRef = useRef<any>(null);

  // Estados de reproducao e telemetria
  const [estaReproduzindo, setEstaReproduzindo] = useState(false);
  const [tempoAtual, setTempoAtual] = useState(tempoInicial || 0);
  const [duracaoTotal, setDuracaoTotal] = useState(0);
  const [estaConcluido, setEstaConcluido] = useState(false);

  // Refs de rastreamento para evitar loops e condicoes de corrida
  const tempoAtualRef = useRef(tempoInicial || 0);
  const duracaoTotalRef = useRef(0);
  const estaReproduzindoRef = useRef(false);
  const ultimoSegundoNotificadoRef = useRef(-1);

  useEffect(() => {
    estaReproduzindoRef.current = estaReproduzindo;
  }, [estaReproduzindo]);

  // Controles de audio e UI
  const [volume, setVolume] = useState(100);
  const [isMuted, setIsMuted] = useState(false);
  const [velocidade, setVelocidade] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mostrarControles, setMostrarControles] = useState(true);
  const [feedbackCentral, setFeedbackCentral] = useState<'play' | 'pause' | null>(null);

  // Texto da marca d'agua anti-pirataria
  const watermarkFinal = textoWatermark || (
    tenant?.nome 
      ? `EXCLUSIVO • ${tenant.nome.toUpperCase()} • ${user?.email || ''}`
      : `ACESSO EXCLUSIVO • PLATAFORMA DETAILERS`
  );

  /**
   * Envia comando direto via HTML5 postMessage para o iframe do YouTube
   * ZERO injecao de scripts externos no head (100% imune a violacoes de CSP)
   */
  const feedbackTimeoutRef = useRef<any>(null);
  const dispararFeedback = useCallback((tipo: 'play' | 'pause') => {
    setFeedbackCentral(tipo);
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
    }
    feedbackTimeoutRef.current = setTimeout(() => {
      setFeedbackCentral(null);
    }, 600);
  }, []);

  /**
   * Envia comando direto via HTML5 postMessage para o iframe do YouTube
   * ZERO injecao de scripts externos no head (100% imune a violacoes de CSP)
   */
  const enviarComandoIframe = useCallback((func: string, args?: any) => {
    try {
      const iframe = iframeRef.current;
      if (iframe && iframe.contentWindow) {
        const finalArgs = Array.isArray(args)
          ? args
          : (args !== undefined && args !== null && args !== '' ? [args] : []);

        iframe.contentWindow.postMessage(
          JSON.stringify({
            event: 'command',
            func,
            args: finalArgs,
          }),
          '*'
        );
      }
    } catch {}
  }, []);

  // Reinicia temporizador para esconder controles durante reproducao
  /**
   * Desativa e descarrega modulos de legendas do YouTube
   * Evita legendas cortadas devido a camada de protecao inferior
   */
  const desativarLegendas = useCallback(() => {
    if (videoData.plataforma !== 'youtube') return;
    try {
      const iframe = iframeRef.current;
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func: 'unloadModule', args: ['captions'] }),
          '*'
        );
        iframe.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func: 'unloadModule', args: ['cc'] }),
          '*'
        );
        iframe.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func: 'setOption', args: ['captions', 'track', {}] }),
          '*'
        );
        iframe.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func: 'setOption', args: ['cc', 'track', {}] }),
          '*'
        );
      }
    } catch {}
  }, [videoData.plataforma]);

  const resetarTemporizadorControles = useCallback(() => {
    setMostrarControles(true);
    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current);
    }
    hideControlsTimerRef.current = setTimeout(() => {
      setMostrarControles(false);
    }, 3500);
  }, []);

  /**
   * Dispara notificacao de progresso para o componente pai de forma segura e sincronizada
   */
  const notificarProgresso = useCallback(
    (segundos: number, duracao: number, reproduzindo: boolean) => {
      const segs = Math.floor(segundos);
      if (segs === ultimoSegundoNotificadoRef.current) return;
      ultimoSegundoNotificadoRef.current = segs;

      const dur = duracao > 0 ? duracao : 223;
      const pct = Math.min(100, Math.round((segs / dur) * 100));

      onProgresso?.({
        segundosAssistidos: segs,
        duracaoTotal: dur,
        porcentagem: pct,
        estaReproduzindo: reproduzindo,
      });

      if (duracao > 0 && segs >= duracao) {
        setEstaReproduzindo(false);
        setEstaConcluido(true);
        onConcluido?.();
      }
    },
    [onProgresso, onConcluido]
  );

  // 1. ESCUTA TELEMETRIA E MENSAGENS POSTMESSAGE DO PLAYER
  useEffect(() => {
    if (videoData.plataforma !== 'youtube') return;

    const handleMessage = (event: MessageEvent) => {
      try {
        if (!event.data || typeof event.data !== 'string') return;
        let data: any = null;
        try {
          data = JSON.parse(event.data);
          if (typeof data === 'string') data = JSON.parse(data);
        } catch {
          return;
        }

        if (!data || typeof data !== 'object') return;

        // onStateChange: 1 = PLAYING, 2 = PAUSED, 0 = ENDED, 3 = BUFFERING
        if (data.event === 'onStateChange') {
          if (data.info === 1) {
            setEstaReproduzindo(true);
            setEstaConcluido(false);
            desativarLegendas();
            // NUNCA chamar seekTo aqui! Chamar seekTo aqui gera loop recursivo infinito!
          } else if (data.info === 2) {
            setEstaReproduzindo(false);
          } else if (data.info === 0) {
            setEstaReproduzindo(false);
            setEstaConcluido(true);
            onConcluido?.();
          }
        }

        // infoDelivery: telemetria de segundos atuais e duracao
        if (data.event === 'infoDelivery' && data.info) {
          if (typeof data.info.currentTime === 'number') {
            const segs = Math.floor(data.info.currentTime);
            tempoAtualRef.current = segs;
            setTempoAtual(segs);
            if (estaReproduzindoRef.current) {
              notificarProgresso(segs, duracaoTotalRef.current, true);
            }
          }
          if (typeof data.info.duration === 'number' && data.info.duration > 0) {
            const dur = Math.floor(data.info.duration);
            duracaoTotalRef.current = dur;
            setDuracaoTotal(dur);
          }
          if (typeof data.info.playerState === 'number') {
            if (data.info.playerState === 1) {
              setEstaReproduzindo(true);
              setEstaConcluido(false);
            } else if (data.info.playerState === 2) {
              setEstaReproduzindo(false);
            } else if (data.info.playerState === 0) {
              setEstaReproduzindo(false);
              setEstaConcluido(true);
              onConcluido?.();
            }
          }
        }
      } catch {}
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [videoData.plataforma, desativarLegendas, notificarProgresso, onConcluido]);

  // 2. HANDSHAKE INICIAL COM O YOUTUBE PARA GARANTIR CONEXAO DO POSTMESSAGE
  useEffect(() => {
    if (videoData.plataforma !== 'youtube') return;

    let tentativas = 0;
    const intervalListening = setInterval(() => {
      tentativas++;
      try {
        const iframe = iframeRef.current;
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage(
            JSON.stringify({ event: 'listening', id: 'player_iframe' }),
            '*'
          );
        }
      } catch {}
      if (tentativas >= 5) {
        clearInterval(intervalListening);
      }
    }, 400);

    return () => clearInterval(intervalListening);
  }, [videoData.plataforma]);

  // 3. ENVIO DE MENSAGEM PARA INICIALIZAR TELEMETRIA QUANDO O IFRAME CARREGA
  const handleIframeLoaded = useCallback(() => {
    try {
      const iframe = iframeRef.current;
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage(
          JSON.stringify({
            event: 'listening',
            id: 'player_iframe',
          }),
          '*'
        );
      }
    } catch {}
    desativarLegendas();

    // Executa seekTo inicial UMA UNICA VEZ se tempoInicial for maior que 0
    if (tempoInicialMontagemRef.current > 0 && !jaFezSeekInicialRef.current) {
      jaFezSeekInicialRef.current = true;
      enviarComandoIframe('seekTo', [tempoInicialMontagemRef.current, true]);
    }

    if (autoPlay) {
      enviarComandoIframe('playVideo');
    }

    onReady?.();
  }, [desativarLegendas, enviarComandoIframe, onReady, autoPlay]);

  // PLAY / PAUSE
  const alternarPlayPause = useCallback(() => {
    resetarTemporizadorControles();

    if (estaConcluido) {
      setEstaConcluido(false);
      tempoAtualRef.current = 0;
      setTempoAtual(0);
      if (videoData.plataforma === 'youtube') {
        enviarComandoIframe('seekTo', [0, true]);
        enviarComandoIframe('playVideo');
      } else if (videoTagRef.current) {
        videoTagRef.current.currentTime = 0;
        videoTagRef.current.play();
      }
      setEstaReproduzindo(true);
      dispararFeedback('play');
      return;
    }

    if (videoData.plataforma === 'youtube') {
      if (estaReproduzindo) {
        enviarComandoIframe('pauseVideo');
        dispararFeedback('pause');
      } else {
        enviarComandoIframe('playVideo');
        desativarLegendas();
        dispararFeedback('play');
      }
    } else if (videoTagRef.current) {
      if (estaReproduzindo) {
        videoTagRef.current.pause();
        setEstaReproduzindo(false);
        dispararFeedback('pause');
      } else {
        videoTagRef.current.play();
        setEstaReproduzindo(true);
        dispararFeedback('play');
      }
    }

    setTimeout(() => {
      setFeedbackCentral(null);
    }, 600);
  }, [estaConcluido, videoData.plataforma, estaReproduzindo, enviarComandoIframe, desativarLegendas, resetarTemporizadorControles]);

  // PULAR SEGUNDOS (-10s / +10s)
  const pularSegundos = useCallback((delta: number) => {
    resetarTemporizadorControles();
    const dur = duracaoTotalRef.current > 0 ? duracaoTotalRef.current : (duracaoTotal > 0 ? duracaoTotal : 9999);
    const novo = Math.max(0, Math.min(dur, tempoAtualRef.current + delta));

    tempoAtualRef.current = Math.floor(novo);
    setTempoAtual(Math.floor(novo));

    if (videoData.plataforma === 'youtube') {
      enviarComandoIframe('seekTo', [novo, true]);
    } else if (videoTagRef.current) {
      videoTagRef.current.currentTime = novo;
    }
  }, [duracaoTotal, videoData.plataforma, enviarComandoIframe, resetarTemporizadorControles]);

  // SEEK VIA BARRA DE PROGRESSO
  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    resetarTemporizadorControles();
    const dur = duracaoTotalRef.current > 0 ? duracaoTotalRef.current : duracaoTotal;
    if (!progressBarRef.current || dur <= 0) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const novoTempo = Math.floor(pos * dur);

    tempoAtualRef.current = novoTempo;
    setTempoAtual(novoTempo);

    if (videoData.plataforma === 'youtube') {
      enviarComandoIframe('seekTo', [novoTempo, true]);
    } else if (videoTagRef.current) {
      videoTagRef.current.currentTime = novoTempo;
    }
  };

  // MUTE / UNMUTE
  const alternarMute = () => {
    resetarTemporizadorControles();
    const novoMute = !isMuted;
    setIsMuted(novoMute);

    if (videoData.plataforma === 'youtube') {
      enviarComandoIframe(novoMute ? 'mute' : 'unMute');
    } else if (videoTagRef.current) {
      videoTagRef.current.muted = novoMute;
    }
  };

  // ALTERAR VOLUME (0 - 100)
  const alterarVolume = (novoVol: number) => {
    resetarTemporizadorControles();
    setVolume(novoVol);
    setIsMuted(novoVol === 0);

    if (videoData.plataforma === 'youtube') {
      enviarComandoIframe('setVolume', [novoVol]);
      if (novoVol > 0 && isMuted) {
        enviarComandoIframe('unMute');
      }
    } else if (videoTagRef.current) {
      videoTagRef.current.volume = novoVol / 100;
      videoTagRef.current.muted = novoVol === 0;
    }
  };

  // VELOCIDADE DE REPRODUCAO (1x, 1.25x, 1.5x, 1.75x, 2x)
  const cicloVelocidade = () => {
    resetarTemporizadorControles();
    const taxas = [1, 1.25, 1.5, 1.75, 2];
    const idx = taxas.indexOf(velocidade);
    const proxima = idx === -1 || idx === taxas.length - 1 ? 1 : taxas[idx + 1];
    setVelocidade(proxima);

    if (videoData.plataforma === 'youtube') {
      enviarComandoIframe('setPlaybackRate', [proxima]);
    } else if (videoTagRef.current) {
      videoTagRef.current.playbackRate = proxima;
    }
  };

  // Alternar tela cheia (suporta iOS Safari, Android, Mac e Windows)
  const alternarFullscreen = useCallback(() => {
    resetarTemporizadorControles();

    setIsFullscreen((antigo) => {
      const novo = !antigo;

      // Travar / destravar scroll do body
      if (novo) {
        document.body.style.overflow = 'hidden';
      } else {
        document.body.style.overflow = '';
      }

      // Tenta acionar a API nativa de fullscreen se disponivel no navegador (Desktop/Android)
      try {
        if (novo) {
          if (wrapperRef.current && typeof wrapperRef.current.requestFullscreen === 'function') {
            wrapperRef.current.requestFullscreen().catch(() => {});
          }
        } else {
          if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
            document.exitFullscreen().catch(() => {});
          }
        }
      } catch {}

      return novo;
    });
  }, [resetarTemporizadorControles]);

  // Listener para sincronizar estado de fullscreen nativo
  useEffect(() => {
    const handleFsChange = () => {
      if (!document.fullscreenElement && isFullscreen) {
        setIsFullscreen(false);
        document.body.style.overflow = '';
      }
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, [isFullscreen]);

  // Limpeza de overflow ao desmontar
  useEffect(() => {
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  // Listener para disparo de fullscreen externo (ex: botao "Assistir em Tela Cheia" do modal)
  useEffect(() => {
    const handleAbrirFs = () => {
      if (!isFullscreen) {
        alternarFullscreen();
      }
    };
    window.addEventListener('abrir_player_fullscreen', handleAbrirFs);
    return () => window.removeEventListener('abrir_player_fullscreen', handleAbrirFs);
  }, [isFullscreen, alternarFullscreen]);

  // ATALHOS DE TECLADO (Espaco, Setas, M, F)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        alternarPlayPause();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        pularSegundos(-10);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        pularSegundos(10);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        alterarVolume(Math.min(100, volume + 10));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        alterarVolume(Math.max(0, volume - 10));
      } else if (e.key === 'm' || e.key === 'M') {
        alternarMute();
      } else if (e.key === 'f' || e.key === 'F') {
        alternarFullscreen();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [alternarPlayPause, pularSegundos, volume, isMuted, alternarFullscreen]);

  // REINICIAR VIDEO
  const reiniciarVideo = useCallback(() => {
    setEstaConcluido(false);
    tempoAtualRef.current = 0;
    setTempoAtual(0);
    if (videoTagRef.current) {
      videoTagRef.current.currentTime = 0;
      videoTagRef.current.play();
    } else if (videoData.plataforma === 'youtube') {
      enviarComandoIframe('seekTo', [0, true]);
      enviarComandoIframe('playVideo');
    }
    setEstaReproduzindo(true);
  }, [videoData.plataforma, enviarComandoIframe]);

  const porcentagemProgresso = duracaoTotal > 0 
    ? Math.min(100, (tempoAtual / duracaoTotal) * 100) 
    : 0;

  const wrapperClasses = isFullscreen
    ? 'fixed inset-0 z-[99999] w-screen h-screen bg-black flex flex-col justify-center items-center overflow-hidden'
    : `relative w-full aspect-video bg-black rounded-xl overflow-hidden shadow-2xl border border-graphite-800 select-none group font-sans ${className}`;

  return (
    <div 
      ref={wrapperRef}
      style={{ aspectRatio: isFullscreen ? undefined : '16 / 9' }}
      onMouseMove={resetarTemporizadorControles}
      onMouseEnter={() => setMostrarControles(true)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }}
      className={wrapperClasses}
    >
      {/* BOTAO PARA SAIR DA TELA CHEIA (FIXO NO TOPO DIREITO QUANDO EM FULLSCREEN) */}
      {isFullscreen && (
        <button
          type="button"
          onClick={alternarFullscreen}
          className="absolute top-4 right-4 z-50 px-3.5 py-2 rounded-xl bg-graphite-900/90 hover:bg-black text-white text-xs font-bold flex items-center gap-2 border border-amber-500/40 shadow-2xl backdrop-blur-md cursor-pointer active:scale-95 transition-all"
        >
          <Minimize2 className="w-4 h-4 text-amber-400" />
          <span>Sair da Tela Cheia</span>
        </button>
      )}
      {/* 1. YOUTUBE COM SAFE-CROP DIRETO NO IFRAME E PROPORCAO 16:9 PERFEITA */}
      {videoData.plataforma === 'youtube' && (
        <div className="absolute inset-0 w-full h-full overflow-hidden flex items-center justify-center bg-black">
          <iframe 
            ref={iframeRef}
            id="player_iframe"
            src={videoData.embedUrl}
            title={titulo || 'Player de Video'}
            onLoad={handleIframeLoaded}
            className="absolute inset-0 w-full h-full border-0 origin-center scale-[1.45] sm:scale-[1.15]"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
          {/* VINHETA DE DEGRADE SUPERIOR SUAVE ANTI-LOGO/HEADER YOUTUBE NO MOBILE */}
          <div className="absolute top-0 inset-x-0 h-9 sm:h-0 bg-gradient-to-b from-[#0A0D12]/95 via-[#0A0D12]/50 to-transparent pointer-events-none z-15" />
        </div>
      )}

      {/* 2. ARQUIVO DIRETO MP4 / WEBM (HOSPEDAGEM NATIVA) */}
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
            if (tempoInicialMontagemRef.current && tempoInicialMontagemRef.current > 0) {
              el.currentTime = tempoInicialMontagemRef.current;
            }
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

      {/* 3. VIMEO */}
      {videoData.plataforma === 'vimeo' && (
        <div className="absolute inset-0 w-full h-full overflow-hidden flex items-center justify-center bg-black">
          <iframe
            ref={iframeRef}
            src={videoData.embedUrl}
            title={titulo || 'Player de Video'}
            className="absolute inset-0 w-full h-full border-0 origin-center scale-[1.05]"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}

      {/* CAMADA DE INTERACAO CENTRAL: CAPTURA CLIQUES E BLOQUEIA BOTAO DIREITO */}
      <div 
        onClick={alternarPlayPause}
        onDoubleClick={alternarFullscreen}
        className="absolute inset-0 z-10 cursor-pointer flex items-center justify-center bg-transparent"
      >
        {/* BOTAO PLAY CENTRAL PULSANTE QUANDO PAUSADO */}
        {!estaReproduzindo && !estaConcluido && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              alternarPlayPause();
            }}
            className="w-14 h-14 sm:w-20 sm:h-20 rounded-full bg-gradient-to-tr from-amber-500 to-amber-400 text-graphite-950 flex items-center justify-center shadow-2xl shadow-amber-500/40 hover:scale-110 active:scale-95 transition-all duration-200 border-2 border-white/20 cursor-pointer"
            title="Reproduzir video"
          >
            <Play className="w-6 h-6 sm:w-9 sm:h-9 fill-current ml-0.5 sm:ml-1" />
          </button>
        )}

        {/* FEEDBACK DE ANIMACAO CENTRAL AO CLICAR NA TELA (RIPPLE) */}
        {feedbackCentral && (
          <div className="w-16 h-16 rounded-full bg-black/70 backdrop-blur-sm text-white flex items-center justify-center animate-ping duration-500 pointer-events-none">
            {feedbackCentral === 'play' ? (
              <Play className="w-8 h-8 fill-current ml-0.5" />
            ) : (
              <Pause className="w-8 h-8 fill-current" />
            )}
          </div>
        )}
      </div>

      {/* SELO DE SEGURANCA FLUTUANTE DISCRETO (NAO COME ALTURA DO VIDEO) */}
      <div 
        onClick={(e) => e.stopPropagation()}
        className={`absolute top-2.5 left-2.5 z-20 pointer-events-auto flex items-center gap-2 transition-opacity duration-300 ${mostrarControles || !estaReproduzindo ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        <div className="flex items-center gap-1.5 bg-black/75 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/10 text-[9px] sm:text-[10px] font-mono font-semibold text-emerald-400 shadow">
          <ShieldCheck className="w-3 h-3 text-emerald-400" />
          <span>REPRODUCAO SEGURA</span>
        </div>
      </div>

      {/* MARCA D'AGUA ANTI-PIRATARIA TRANSLUCIDA */}
      {mostrarWatermark && (
        <div className="absolute inset-0 pointer-events-none z-15 overflow-hidden select-none flex items-center justify-center opacity-15 sm:opacity-20">
          <div 
            className="font-mono text-[10px] sm:text-xs text-vapor-100 tracking-wider whitespace-nowrap bg-black/60 px-3 py-1 rounded-lg border border-white/10 shadow-lg"
            style={{ transform: 'rotate(-12deg)' }}
          >
            {watermarkFinal}
          </div>
        </div>
      )}

      {/* CONTROLES DA PLATAFORMA (RODAPE OPACO 100% ANTI-FUGA) */}
      <div 
        onClick={(e) => e.stopPropagation()}
        className={`absolute bottom-0 inset-x-0 z-20 px-1.5 sm:px-4 py-1 sm:py-2.5 bg-[#0A0D12]/95 backdrop-blur-md border-t border-graphite-800 flex flex-col gap-1 sm:gap-2 transition-opacity duration-300 pointer-events-auto ${mostrarControles || !estaReproduzindo ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        {/* LINHA 1: BARRA DE PROGRESSO COM SEEK SUAVE */}
        <div 
          ref={progressBarRef}
          onClick={handleSeek}
          className="w-full h-2 group/bar hover:h-3 bg-white/20 hover:bg-white/30 rounded-full cursor-pointer relative transition-all overflow-visible flex items-center py-1"
          title="Clique para avancar ou retroceder"
        >
          <div 
            className="h-full bg-gradient-to-r from-amber-500 to-amber-300 rounded-full relative transition-all duration-75"
            style={{ width: `${porcentagemProgresso}%` }}
          >
            <div className="w-3.5 h-3.5 bg-amber-400 rounded-full shadow-lg border border-graphite-950 absolute -right-1.5 top-1/2 -translate-y-1/2 scale-100 sm:scale-0 sm:group-hover/bar:scale-100 transition-transform" />
          </div>
        </div>

        {/* LINHA 2: BOTOES DE REPRODUCAO, TEMPO, VOLUME, VELOCIDADE E FULLSCREEN SEM OVERFLOW */}
        <div className="flex items-center justify-between text-vapor-200 text-xs w-full gap-1 overflow-hidden">
          <div className="flex items-center gap-1 sm:gap-2 min-w-0 shrink overflow-hidden">
            <button
              type="button"
              onClick={alternarPlayPause}
              className="p-1.5 sm:p-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-graphite-950 transition-all font-bold shrink-0 cursor-pointer shadow-md"
              title={estaReproduzindo ? 'Pausar (Espaco)' : 'Reproduzir (Espaco)'}
            >
              {estaReproduzindo ? (
                <Pause className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-current" />
              ) : (
                <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-current ml-0.5" />
              )}
            </button>

            {!modoCompacto && (
              <>
                <button
                  type="button"
                  onClick={() => pularSegundos(-10)}
                  className="hidden md:flex p-1.5 rounded-lg hover:bg-white/10 text-vapor-300 hover:text-amber-400 transition-colors cursor-pointer shrink-0"
                  title="Voltar 10 segundos (Seta Esquerda)"
                >
                  <RotateCcw className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => pularSegundos(10)}
                  className="hidden md:flex p-1.5 rounded-lg hover:bg-white/10 text-vapor-300 hover:text-amber-400 transition-colors cursor-pointer shrink-0"
                  title="Avancar 10 segundos (Seta Direita)"
                >
                  <RotateCw className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </button>
              </>
            )}

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={alternarMute}
                className="p-1.5 rounded-lg hover:bg-white/10 text-vapor-300 hover:text-vapor-100 transition-colors cursor-pointer"
                title={isMuted ? 'Desativar Mudo (M)' : 'Silenciar (M)'}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-red-400" />
                ) : volume < 50 ? (
                  <Volume1 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                )}
              </button>

              {!modoCompacto && (
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={isMuted ? 0 : volume}
                  onChange={(e) => alterarVolume(parseInt(e.target.value, 10))}
                  className="hidden lg:block w-14 lg:w-18 h-1 bg-white/20 accent-amber-500 rounded-lg cursor-pointer shrink-0"
                  title={`Volume: ${isMuted ? 0 : volume}%`}
                />
              )}
            </div>

            {!modoCompacto && (
              <div className="font-mono text-[9px] sm:text-xs text-vapor-300 shrink-0 select-none">
                <span className="text-amber-400 font-bold">{formatarTempoVideo(tempoAtual)}</span>
                <span className="text-vapor-500 mx-0.5 sm:mx-1">/</span>
                <span>{formatarTempoVideo(duracaoTotal || 223)}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            <button
              type="button"
              onClick={cicloVelocidade}
              className="px-1.5 sm:px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-[10px] sm:text-[11px] font-mono font-bold text-amber-400 hover:text-amber-300 transition-colors cursor-pointer shrink-0"
              title="Alterar velocidade de reproducao"
            >
              {velocidade}x
            </button>

            {/* BOTAO TELA CHEIA PROMINENTE (SEMPRE VISIVEL) */}
            <button
              type="button"
              id="btn-fullscreen-player-seguro"
              onClick={alternarFullscreen}
              className="p-1.5 sm:px-2 sm:py-1 rounded-lg bg-amber-500/25 hover:bg-amber-500/35 text-amber-300 hover:text-amber-200 border border-amber-500/50 flex items-center gap-1 text-[11px] font-bold shadow-md cursor-pointer transition-all active:scale-95 shrink-0"
              title={isFullscreen ? 'Sair da tela cheia (F)' : 'Tela cheia (F)'}
            >
              {isFullscreen ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5 text-amber-400" />
                  {!modoCompacto && <span className="hidden xl:inline">Normal</span>}
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5 text-amber-400" />
                  {!modoCompacto && <span className="hidden xl:inline">Tela Cheia</span>}
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* TELA DE CONCLUSAO DO VIDEO (IMPEDE VIDEOS RECOMENDADOS) */}
      {estaConcluido && (
        <div className="absolute inset-0 z-30 bg-graphite-950/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center space-y-4 animate-in fade-in duration-300">
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-xl shadow-emerald-500/20">
            <CheckCircle2 className="w-10 h-10" />
          </div>

          <div className="space-y-1">
            <h4 className="font-display font-bold text-vapor-100 text-lg">Video Concluido!</h4>
            <p className="text-vapor-400 text-xs max-w-sm">
              Voce assistiu este conteudo na integra. Seu progresso foi salvo com sucesso.
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
    </div>
  );
};