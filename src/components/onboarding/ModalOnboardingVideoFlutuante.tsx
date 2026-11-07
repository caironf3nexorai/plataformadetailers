import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Minimize2,
  Maximize2,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Sparkles,
  Clock,
  ArrowRight,
  Building2,
  Calendar,
  Tag,
  QrCode,
  ShieldCheck,
  X,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { PlayerVideoSeguro } from '../video/PlayerVideoSeguro';

interface ModalOnboardingVideoFlutuanteProps {
  onConcluido?: () => void;
}

type ModoVisualOnboarding = 'modal' | 'flutuante' | 'fechado' | 'concluido';

export const ModalOnboardingVideoFlutuante: React.FC<ModalOnboardingVideoFlutuanteProps> = ({ onConcluido }) => {
  const { tenant, refetchTenantData } = useAuth();
  const { showSuccess } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  // Chaves de armazenamento
  const storageKeyConcluido = tenant?.id ? `onboarding_tutorial_concluido_${tenant.id}` : null;
  const storageKeyTempo = tenant?.id ? `onboarding_tempo_assistido_${tenant.id}` : null;
  const storageKeyModo = tenant?.id ? `onboarding_video_modo_${tenant.id}` : 'onboarding_video_modo_global';

  // Estado visual unificado: 'modal' | 'flutuante' | 'fechado' | 'concluido'
  const [modoVisual, setModoVisual] = useState<ModoVisualOnboarding>(() => {
    const modoSalvo = sessionStorage.getItem(storageKeyModo) as ModoVisualOnboarding | null;
    return modoSalvo || 'fechado';
  });

  const [colapsado, setColapsado] = useState(false);
  const [carregandoConfig, setCarregandoConfig] = useState(true);
  const [salvandoConclusao, setSalvandoConclusao] = useState(false);

  // Configuração do vídeo
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [videoTitulo, setVideoTitulo] = useState<string>('Tutorial de Iniciação & Configuração da Plataforma');

  // Rastreamento de progresso (% assistida)
  const [segundosAssistidos, setSegundosAssistidos] = useState(0);
  const segundosAssistidosRef = useRef(0);
  const estaReproduzindoRef = useRef(false);
  const [deveAutoPlay, setDeveAutoPlay] = useState(false);

  useEffect(() => {
    segundosAssistidosRef.current = segundosAssistidos;
  }, [segundosAssistidos]);
  const [duracaoTotalSegundos, setDuracaoTotalSegundos] = useState(300); // 5 min padrão

  // Função auxiliar robusta para verificar se o usuário autenticado é Super Admin / Platform Admin
  const checarSeEhAdmin = async (): Promise<boolean> => {
    try {
      const { data: userAuth } = await supabase.auth.getUser();
      const email = userAuth?.user?.email?.toLowerCase() || '';

      // E-mails diretos do administrador/fundador
      if (email.includes('cairon') || email === 'caironf3@gmail.com' || email === 'caironfelipe3@gmail.com') {
        return true;
      }

      // Verificação via RPC is_platform_admin (ativo e estável)
      try {
        const { data: isPlatAdmin } = await supabase.rpc('is_platform_admin');
        if (isPlatAdmin) return true;
      } catch {}

      // Verificação via RPC is_super_admin
      try {
        const { data: isSupAdmin } = await supabase.rpc('is_super_admin');
        if (isSupAdmin) return true;
      } catch {}

      // Verificação direta na tabela platform_admins
      if (userAuth?.user?.id) {
        const { data: adminRow } = await supabase
          .from('platform_admins')
          .select('id, super_admin')
          .eq('user_id', userAuth.user.id)
          .eq('ativo', true)
          .maybeSingle();
        if (adminRow) return true;
      }
    } catch (err) {
      console.warn('[Onboarding] Falha ao verificar privilégios de admin:', err);
    }
    return false;
  };

  // Inicializa configuração e determina modo inicial sem resetar ao trocar de rota
  useEffect(() => {
    let ativo = true;

    async function inicializarTutorial() {
      try {
        setCarregandoConfig(true);

        // 1. Carrega dados do vídeo da plataforma
        try {
          const { data: configData } = await supabase.rpc('obter_config_plataforma');
          if (configData && ativo) {
            if (configData.video_onboarding_url) {
              setVideoUrl(configData.video_onboarding_url);
            }
            if (configData.video_onboarding_titulo) {
              setVideoTitulo(configData.video_onboarding_titulo);
            }
          }
        } catch (errConfig) {
          console.warn('[Onboarding] Falha ao carregar config da plataforma:', errConfig);
        }

        // 2. Carrega tempo previamente assistido do localStorage
        if (storageKeyTempo) {
          const tempoSalvo = parseInt(localStorage.getItem(storageKeyTempo) || '0', 10);
          if (!isNaN(tempoSalvo) && tempoSalvo > 0 && ativo) {
            setSegundosAssistidos(tempoSalvo);
          }
        }

        // 3. Checa estado já salvo nesta sessão do navegador
        const modoSalvoSessao = sessionStorage.getItem(storageKeyModo) as ModoVisualOnboarding | null;
        if (modoSalvoSessao) {
          if (ativo) {
            setModoVisual(modoSalvoSessao);
            setCarregandoConfig(false);
          }
          return;
        }

        // 4. Checa privilégio de Super Admin
        const ehAdmin = await checarSeEhAdmin();
        if (!ativo) return;

        // SE FOR O SUPER ADMIN:
        // Abre como modal na primeira visita da sessão para teste/gravação
        if (ehAdmin) {
          setModoVisual('modal');
          sessionStorage.setItem(storageKeyModo, 'modal');
          setCarregandoConfig(false);
          return;
        }

        // SE FOR USUÁRIO COMUM (Oficinas):
        if (!tenant?.id) {
          setModoVisual('fechado');
          setCarregandoConfig(false);
          return;
        }

        const jaConcluiuLocal = storageKeyConcluido && localStorage.getItem(storageKeyConcluido) === 'true';
        const jaConcluiuBanco = Boolean(tenant.onboarding_concluido);

        // Se já concluiu permanentemente no banco ou no dispositivo
        if (jaConcluiuLocal || jaConcluiuBanco) {
          setModoVisual('concluido');
          sessionStorage.setItem(storageKeyModo, 'concluido');
          setCarregandoConfig(false);
          return;
        }

        // 5. Avalia se a oficina já está configurada/operacional:
        const currentTenantId = tenant.id;
        const [
          { count: totalServicos },
          { count: totalPrecos },
          { count: totalHorarios },
          { count: totalAgendamentos },
          { count: totalOrcamentos }
        ] = await Promise.all([
          supabase
            .from('servicos')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', currentTenantId)
            .eq('ativo', true),
          supabase
            .from('servico_precos')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', currentTenantId)
            .gt('duracao_minutos', 0),
          supabase
            .from('horarios_funcionamento')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', currentTenantId)
            .eq('ativo', true),
          supabase
            .from('agendamentos')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', currentTenantId),
          supabase
            .from('orcamentos')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', currentTenantId),
        ]);

        const temServicosConfigurados = (totalServicos || 0) > 0 && ((totalPrecos || 0) > 0 || (totalHorarios || 0) > 0);
        const temOperacaoAtiva = (totalAgendamentos || 0) > 0 || (totalOrcamentos || 0) > 0;
        const jaEstaConfigurada = temServicosConfigurados || temOperacaoAtiva;

        if (jaEstaConfigurada) {
          if (storageKeyConcluido) {
            localStorage.setItem(storageKeyConcluido, 'true');
          }
          try {
            await supabase.rpc('marcar_onboarding_concluido', { p_tenant_id: currentTenantId });
          } catch {}
          setModoVisual('concluido');
          sessionStorage.setItem(storageKeyModo, 'concluido');
          setCarregandoConfig(false);
          return;
        }

        // Se for oficina nova sem configuração, abre no modo modal
        setModoVisual('modal');
        sessionStorage.setItem(storageKeyModo, 'modal');
      } catch (err) {
        console.warn('[OnboardingVideo] Erro na inicialização:', err);
      } finally {
        if (ativo) setCarregandoConfig(false);
      }
    }

    inicializarTutorial();
    return () => {
      ativo = false;
    };
  }, [tenant?.id, tenant?.onboarding_concluido, storageKeyConcluido, storageKeyTempo, storageKeyModo]);

  // Listener para reabertura sob demanda (ex: botão de ajuda ou em configurações)
  useEffect(() => {
    const handleReabrir = () => {
      setModoVisual('modal');
      sessionStorage.setItem(storageKeyModo, 'modal');
    };

    window.addEventListener('abrir_onboarding_tutorial', handleReabrir);
    return () => window.removeEventListener('abrir_onboarding_tutorial', handleReabrir);
  }, [storageKeyModo]);

    // Callback de alta fidelidade do Player Seguro (YouTube, Vimeo ou MP4)
  const handleProgressoVideo = useCallback(
    (dados: {
      segundosAssistidos: number;
      duracaoTotal: number;
      porcentagem: number;
      estaReproduzindo: boolean;
    }) => {
      estaReproduzindoRef.current = dados.estaReproduzindo;
      segundosAssistidosRef.current = dados.segundosAssistidos;
      setSegundosAssistidos(dados.segundosAssistidos);
      if (dados.duracaoTotal > 0) {
        setDuracaoTotalSegundos(dados.duracaoTotal);
      }
      if (storageKeyTempo && dados.segundosAssistidos > 0) {
        localStorage.setItem(storageKeyTempo, dados.segundosAssistidos.toString());
      }
    },
    [storageKeyTempo]
  );

  const handleConclusaoAutomatica = useCallback(() => {
    setSegundosAssistidos(duracaoTotalSegundos);
    if (storageKeyTempo && duracaoTotalSegundos > 0) {
      localStorage.setItem(storageKeyTempo, duracaoTotalSegundos.toString());
    }
  }, [storageKeyTempo, duracaoTotalSegundos]);

  // Transição do modal para botão flutuante ao fechar ou minimizar
  const handleMinimizarParaFlutuante = (manterReproducao?: boolean | unknown) => {
    const tempoAtual = segundosAssistidosRef.current || segundosAssistidos;
    if (storageKeyTempo && tempoAtual > 0) {
      localStorage.setItem(storageKeyTempo, tempoAtual.toString());
    }
    if (manterReproducao === true || estaReproduzindoRef.current) {
      setDeveAutoPlay(true);
    }
    setModoVisual('flutuante');
    sessionStorage.setItem(storageKeyModo, 'flutuante');
  };

  // Reabertura do modal completo ao clicar no botão flutuante
  const handleExpandirParaModal = () => {
    const tempoAtual = segundosAssistidosRef.current || segundosAssistidos;
    if (storageKeyTempo && tempoAtual > 0) {
      localStorage.setItem(storageKeyTempo, tempoAtual.toString());
    }
    setDeveAutoPlay(estaReproduzindoRef.current);
    setModoVisual('modal');
    sessionStorage.setItem(storageKeyModo, 'modal');
  };

  // Oculta o botão flutuante nesta sessão caso o usuário queira total limpeza visual
  const handleDispensarBotao = () => {
    setModoVisual('fechado');
    sessionStorage.setItem(storageKeyModo, 'fechado');
  };

  // Conclusão definitiva da plataforma (marca no banco e remove para sempre)
  const handleMarcarConfigurada = async () => {
    setSalvandoConclusao(true);
    try {
      if (storageKeyConcluido) {
        localStorage.setItem(storageKeyConcluido, 'true');
      }
      sessionStorage.setItem(storageKeyModo, 'concluido');

      try {
        await supabase.rpc('marcar_onboarding_concluido', {
          p_tenant_id: tenant?.id,
        });
      } catch (errBanco) {
        console.warn('[Onboarding] Falha ao sincronizar conclusão no banco:', errBanco);
      }

      showSuccess('🎉 Parabéns! Sua plataforma foi marcada como configurada com sucesso.');
      setModoVisual('concluido');
      if (onConcluido) onConcluido();
      if (refetchTenantData) await refetchTenantData();
    } finally {
      setSalvandoConclusao(false);
    }
  };

  // Atalho para navegar até as seções cruciais de configuração (minimiza para botão flutuante e preserva reprodução contínua)
  const handleIrPara = (caminho: string) => {
    const tempoAtual = segundosAssistidosRef.current || segundosAssistidos;
    if (storageKeyTempo && tempoAtual > 0) {
      localStorage.setItem(storageKeyTempo, tempoAtual.toString());
    }
    handleMinimizarParaFlutuante(true);
    navigate(caminho);
  };

  // Rota de tela cheia operacional (execução ou check-in) não exibe nada
  const isTelaCheia = location.pathname.startsWith('/execucao/') || location.pathname.startsWith('/checkin/');
  if (isTelaCheia || carregandoConfig || modoVisual === 'fechado' || modoVisual === 'concluido') {
    return null;
  }

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

  

  const etapasSetup = [
    {
      id: 'oficina',
      titulo: 'Dados da Oficina & Logo',
      descricao: 'Nome fantasia, WhatsApp de contato e logotipo',
      rota: '/configuracoes?aba=oficina',
      icon: Building2,
    },
    {
      id: 'horarios',
      titulo: 'Horários e Boxes',
      descricao: 'Dias de funcionamento e capacidade de atendimento',
      rota: '/configuracoes?aba=horarios',
      icon: Calendar,
    },
    {
      id: 'servicos',
      titulo: 'Catálogo de Serviços',
      descricao: 'Serviços oferecidos, preços e tempos de execução',
      rota: '/servicos',
      icon: Tag,
    },
    {
      id: 'agendamento',
      titulo: 'Agendamento Online & PIX',
      descricao: 'Chave PIX e percentual do sinal de confirmação',
      rota: '/configuracoes?aba=agendamento',
      icon: QrCode,
    },
    {
      id: 'termos',
      titulo: 'Minutas & Garantias',
      descricao: 'Termos de responsabilidade e garantias com advogado',
      rota: '/configuracoes?aba=termos',
      icon: ShieldCheck,
    },
  ];

  // =========================================================================
  // MODO 1: BOTÃO FLUTUANTE ELEGANTE E DESOBSTRUÍDO
  // Posicionado estrategicamente à esquerda e acima da BottomNav no mobile,
  // e ao lado da Sidebar no desktop. NUNCA tampa a barra de navegação.
  // =========================================================================
  if (modoVisual === 'flutuante') {
    return (
      <aside
        aria-label="Mini Player do Tutorial da Oficina"
        className="fixed right-3 sm:right-6 bottom-[72px] lg:bottom-6 z-40 flex flex-col items-end pointer-events-auto select-none max-w-[94vw]"
      >
        <div
          className={`bg-graphite-900 border border-amber-500/50 shadow-2xl rounded-2xl overflow-hidden backdrop-blur-xl transition-all duration-300 ${
            colapsado ? 'w-64 sm:w-72' : 'w-72 xs:w-80 sm:w-96'
          }`}
        >
          {/* Barra de Título do Mini-Player */}
          <div className="bg-[#0A0D12] px-3.5 py-2.5 flex items-center justify-between border-b border-graphite-800">
            <div className="flex items-center gap-2 truncate pr-2">
              <div className="w-6 h-6 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                <Sparkles className="w-3.5 h-3.5" />
              </div>
              <div className="truncate text-left">
                <span className="text-xs font-bold text-vapor-100 truncate block font-display tracking-tight">
                  Tutorial da Oficina
                </span>
                <span className="text-[10px] text-amber-400 font-semibold">
                  {porcentagemAssistida}% assistido
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {/* Botão de Colapsar/Expandir Altura */}
              <button
                type="button"
                onClick={() => setColapsado(!colapsado)}
                className="p-1 rounded-md text-vapor-400 hover:text-vapor-100 hover:bg-graphite-800 transition-colors cursor-pointer"
                title={colapsado ? 'Expandir Vídeo' : 'Recolher para barra'}
              >
                {colapsado ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {/* Botão de Maximizar para Modal Completo */}
              <button
                type="button"
                onClick={handleExpandirParaModal}
                className="p-1 rounded-md text-vapor-400 hover:text-vapor-100 hover:bg-graphite-800 transition-colors cursor-pointer"
                title="Maximizar para tela cheia"
              >
                <Maximize2 className="w-4 h-4" />
              </button>

              {/* Botão de Dispensar Mini Player */}
              <button
                type="button"
                onClick={handleDispensarBotao}
                className="p-1 rounded-md text-vapor-400 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                title="Ocultar nesta sessão"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Player de Vídeo Compacto (quando não colapsado) */}
          {!colapsado && (
            <div className="p-2.5 sm:p-3 space-y-2.5 bg-graphite-900">
              <div className="rounded-xl overflow-hidden border border-graphite-800 shadow-md">
                <PlayerVideoSeguro
                  url={videoUrl}
                  titulo={videoTitulo}
                  tempoInicial={segundosAssistidos}
                  autoPlay={deveAutoPlay}
                  modoCompacto={true}
                  onProgresso={handleProgressoVideo}
                  onConcluido={handleConclusaoAutomatica}
                  mostrarWatermark={false}
                  className="rounded-lg"
                />
              </div>

              {/* Barra de Progresso e Ações */}
              <div className="flex items-center justify-between text-[11px] text-vapor-400 px-0.5">
                <span className="flex items-center gap-1 text-vapor-300 font-mono">
                  <Clock className="w-3 h-3 text-amber-400" />
                  {formatarTempo(segundosAssistidos)} / {formatarTempo(duracaoTotalSegundos)}
                </span>
                <button
                  type="button"
                  onClick={handleExpandirParaModal}
                  className="text-amber-400 hover:text-amber-300 font-bold text-[10px] underline cursor-pointer"
                >
                  Ver etapas completas
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>
    );
  }

  // =========================================================================
  // MODO 2: MODAL CENTRALIZADO EXPANDIDO (Visualização Completa do Tutorial)
  // Possui botões claros de Fechar (X) e Minimizar para navegar sem bloqueios.
  // =========================================================================
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-1.5 sm:p-5 bg-graphite-950/85 backdrop-blur-md animate-fade-in overflow-y-auto">
      <div className="bg-graphite-900 border border-amber-500/40 rounded-2xl max-w-4xl w-full shadow-2xl flex flex-col my-auto max-h-[96vh] sm:max-h-[92vh] overflow-hidden">
        {/* Cabeçalho do Modal */}
        <div className="bg-graphite-950/90 px-3.5 sm:px-6 py-3 sm:py-4 border-b border-graphite-700/60 flex items-center justify-between shrink-0">
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
            {/* Minimizar para navegar e deixar o botão flutuante disponível */}
            <button
              type="button"
              onClick={handleMinimizarParaFlutuante}
              className="px-3 py-1.5 rounded-lg bg-graphite-800 hover:bg-graphite-700 text-vapor-300 hover:text-vapor-100 text-xs font-semibold flex items-center gap-1.5 border border-graphite-700 transition-colors cursor-pointer"
              title="Minimizar e continuar navegando pela plataforma"
            >
              <Minimize2 className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Minimizar & Navegar</span>
            </button>

            {/* Botão Fechar (X): Transiciona para o botão flutuante desobstruído */}
            <button
              type="button"
              onClick={handleMinimizarParaFlutuante}
              className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg bg-graphite-800 hover:bg-red-500/20 text-vapor-300 hover:text-red-300 text-xs font-semibold flex items-center gap-1.5 border border-graphite-700 hover:border-red-500/40 transition-colors cursor-pointer"
              title="Fechar modal e manter botão flutuante para quando precisar"
            >
              <X className="w-4 h-4 text-red-400" />
              <span className="text-xs font-semibold">Fechar</span>
            </button>
          </div>
        </div>

        {/* Corpo do Modal com Scroll Interno */}
        <div className="p-2.5 sm:p-6 overflow-y-auto space-y-3 sm:space-y-5">
          {/* Player do Vídeo Seguro com Camuflagem e Escudo Anti-Fuga */}
          <div className="space-y-2">
            <PlayerVideoSeguro
              url={videoUrl}
              titulo={videoTitulo}
              tempoInicial={segundosAssistidos}
              autoPlay={deveAutoPlay}
              onProgresso={handleProgressoVideo}
              onConcluido={handleConclusaoAutomatica}
              mostrarWatermark={true}
            />

            {/* BOTÃO PROMINENTE DE TELA CHEIA (ESPECIALMENTE NO MOBILE) */}
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('abrir_player_fullscreen'));
              }}
              className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-500/20 via-amber-500/10 to-amber-500/20 hover:from-amber-500/30 hover:to-amber-500/30 border border-amber-500/50 text-amber-300 hover:text-amber-200 font-bold text-xs flex items-center justify-center gap-2 shadow-md cursor-pointer active:scale-[0.98] transition-all"
            >
              <Maximize2 className="w-4 h-4 text-amber-400" />
              <span>Assistir em Tela Cheia (Modo Expandido)</span>
            </button>
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
              {etapasSetup.map((etapa, idx) => {
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
                        <span>{idx + 1}. {etapa.titulo}</span>
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

        {/* Rodapé com os botões principais de ação */}
        <div className="bg-graphite-950/90 px-4 sm:px-6 py-4 border-t border-graphite-700/60 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-vapor-400 text-center sm:text-left">
            <span>Deseja ir preenchendo agora?</span>{' '}
            <strong className="text-amber-400">Clique em Minimizar para deixar o botão disponível no canto.</strong>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            {/* Botão para Minimizar e Navegar Livremente */}
            <button
              type="button"
              onClick={handleMinimizarParaFlutuante}
              className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-graphite-800 hover:bg-graphite-700 text-vapor-200 hover:text-vapor-100 font-semibold text-xs border border-graphite-600 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Minimize2 className="w-4 h-4 text-amber-400" />
              <span>Minimizar & Navegar</span>
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
