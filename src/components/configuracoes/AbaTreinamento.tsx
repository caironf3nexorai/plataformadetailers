import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { 
  Play, 
  CheckCircle2, 
  Lock, 
  Clock, 
  Sparkles, 
  X, 
  Info,
  Tv
} from 'lucide-react';
import { usePlano } from '../../hooks/usePlano';
import { getEmbedUrl } from '../../utils/videoExtractor';

interface TreinamentoItem {
  id: string;
  titulo: string;
  descricao: string | null;
  url: string;
  plataforma: 'youtube' | 'vimeo';
  video_id: string;
  categoria: string;
  duracao_minutos: number;
  ordem: number;
  essencial: boolean;
  planos_permitidos: string[];
  disponivel_no_plano_atual: boolean;
  concluido: boolean;
}

export const AbaTreinamento: React.FC = () => {
  const { temFeature, nomePlano } = usePlano();
  const podeAcessarTreinamentos = temFeature('treinamentos');
  const [treinamentos, setTreinamentos] = useState<TreinamentoItem[]>([]);
  const [planoAtual, setPlanoAtual] = useState<string>('free');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Player ativo
  const [activeVideo, setActiveVideo] = useState<TreinamentoItem | null>(null);
  // Modal de upgrade de plano
  const [upgradeModal, setUpgradeModal] = useState<TreinamentoItem | null>(null);

  const fetchTreinamentos = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Tenta obter via RPC
      const { data, error: rpcErr } = await supabase.rpc('obter_treinamentos_assinante');
      
      if (!rpcErr && data) {
        setPlanoAtual(data.plano_atual || 'free');
        setTreinamentos(data.treinamentos || []);
        return;
      }

      // 2. Fallback direto via tabelas se a RPC não existir no DB
      console.warn('[AbaTreinamento] RPC falhou ou não existe, realizando consulta direta:', rpcErr?.message);

      const { data: tenantData } = await supabase
        .from('tenants')
        .select('id, plano')
        .single();
      
      const userPlano = tenantData?.plano || 'free';
      setPlanoAtual(userPlano);

      const { data: vids, error: vidsErr } = await supabase
        .from('treinamentos')
        .select('*')
        .eq('ativo', true)
        .order('ordem', { ascending: true });

      if (vidsErr) throw vidsErr;

      let visualizadosIds: string[] = [];
      if (tenantData?.id) {
        const { data: vis } = await supabase
          .from('treinamento_visualizacoes')
          .select('treinamento_id')
          .eq('tenant_id', tenantData.id)
          .eq('concluido', true);

        if (vis) {
          visualizadosIds = vis.map((v: any) => v.treinamento_id);
        }
      }

      const processados: TreinamentoItem[] = (vids || []).map((t: any) => {
        const disponivel = Array.isArray(t.planos_permitidos) 
          ? t.planos_permitidos.includes(userPlano) 
          : true;

        return {
          id: t.id,
          titulo: t.titulo,
          descricao: t.descricao,
          url: t.url,
          plataforma: t.plataforma || 'youtube',
          video_id: t.video_id,
          categoria: t.categoria || 'Geral',
          duracao_minutos: t.duracao_minutos || 0,
          ordem: t.ordem || 0,
          essencial: !!t.essencial,
          planos_permitidos: t.planos_permitidos || ['free', 'pro', 'studio'],
          disponivel_no_plano_atual: disponivel,
          concluido: visualizadosIds.includes(t.id)
        };
      });

      setTreinamentos(processados);
    } catch (err: any) {
      console.error('[AbaTreinamento] Erro ao carregar treinamentos:', err);
      setTreinamentos([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTreinamentos();
  }, []);

  const handleToggleConcluido = async (treinamento: TreinamentoItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const novoStatus = !treinamento.concluido;

    // Atualização otimista na UI
    setTreinamentos(prev => prev.map(item => 
      item.id === treinamento.id ? { ...item, concluido: novoStatus } : item
    ));

    try {
      const { error: rpcErr } = await supabase.rpc('marcar_treinamento_visualizado', {
        p_treinamento_id: treinamento.id,
        p_concluido: novoStatus
      });

      if (rpcErr) {
        // Fallback via upsert/delete na tabela treinamento_visualizacoes
        const { data: tenantData } = await supabase.from('tenants').select('id').single();
        const { data: userData } = await supabase.auth.getUser();

        if (tenantData?.id && userData?.user?.id) {
          if (novoStatus) {
            await supabase.from('treinamento_visualizacoes').upsert({
              tenant_id: tenantData.id,
              user_id: userData.user.id,
              treinamento_id: treinamento.id,
              concluido: true,
              concluido_em: new Date().toISOString()
            }, { onConflict: 'tenant_id,treinamento_id' });
          } else {
            await supabase.from('treinamento_visualizacoes')
              .delete()
              .eq('tenant_id', tenantData.id)
              .eq('treinamento_id', treinamento.id);
          }
        }
      }
    } catch (err: any) {
      console.error('[AbaTreinamento] Erro ao atualizar progresso:', err);
    }
  };

  // Filtra apenas vídeos disponíveis para o plano atual para calcular a barra de progresso
  const disponiveis = treinamentos.filter(t => t.disponivel_no_plano_atual);
  const concluidosCount = disponiveis.filter(t => t.concluido).length;
  const progressoPercent = disponiveis.length > 0 ? Math.round((concluidosCount / disponiveis.length) * 100) : 0;
  const categorias = Array.from(new Set(treinamentos.map(t => t.categoria || 'Geral')));

  if (!podeAcessarTreinamentos) {
    return (
      <Card className="p-8 bg-graphite-900 border-graphite-800 text-center flex flex-col items-center justify-center gap-3">
        <Lock size={48} className="text-amber-500" />
        <h3 className="text-base font-bold text-vapor-200">Módulo de Treinamentos Bloqueado</h3>
        <p className="text-xs text-vapor-400 max-w-md">
          A área de treinamentos e capacitação não está habilitada para o plano atual da sua oficina ({nomePlano}). Faça upgrade do plano para liberar acesso a todas as videoaulas.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho do Módulo & Barra de Progresso */}
      <div className="bg-graphite-800 p-5 rounded-2xl border border-graphite-600 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <h3 className="font-display text-lg text-vapor-100 font-bold flex items-center gap-2">
              <Tv className="text-amber-500" size={20} />
              <span>Treinamentos e Capacitação da Oficina</span>
            </h3>
            <p className="text-vapor-400 text-xs leading-relaxed">
              Aprenda a utilizar os módulos do sistema e capacite sua equipe para acelerar os resultados da oficina.
            </p>
          </div>

          <div className="shrink-0 font-mono text-xs text-vapor-300 bg-graphite-900 px-3 py-1.5 rounded-lg border border-graphite-700">
            Plano da Oficina: <strong className="text-amber-400 uppercase">{planoAtual}</strong>
          </div>
        </div>

        {/* Barra de Progresso do Assinante */}
        {disponiveis.length > 0 && (
          <div className="space-y-1.5 bg-graphite-900 p-4 rounded-xl border border-graphite-700/60">
            <div className="flex justify-between items-center text-xs font-mono">
              <span className="text-vapor-300 font-medium">Seu Progresso nos Treinamentos:</span>
              <span className="text-amber-400 font-bold">{concluidosCount} de {disponiveis.length} concluídos ({progressoPercent}%)</span>
            </div>

            <div className="w-full h-2.5 bg-graphite-800 rounded-full overflow-hidden border border-graphite-700">
              <div 
                className="h-full bg-gradient-to-r from-amber-500 to-mint-400 transition-all duration-500 rounded-full"
                style={{ width: `${progressoPercent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 bg-flare-400/10 border border-flare-400/30 rounded-xl text-flare-400 text-xs">
          {error}
        </div>
      )}

      {loading ? (
        <Card className="p-12 text-center text-vapor-400 font-mono bg-graphite-800 border-graphite-600">
          Carregando catálogo de treinamentos...
        </Card>
      ) : treinamentos.length === 0 ? (
        <Card className="p-8 text-center bg-graphite-800 border-graphite-600 space-y-3">
          <Info size={32} className="mx-auto text-amber-500" />
          <h4 className="font-display font-bold text-vapor-100 text-base">Nenhum treinamento disponível no momento</h4>
          <p className="text-vapor-400 text-xs max-w-md mx-auto">
            Os vídeos de capacitação estão sendo preparados pela nossa equipe. Em breve novos conteúdos estarão disponíveis aqui.
          </p>
        </Card>
      ) : (
        /* Lista por Categoria */
        <div className="space-y-6">
          {categorias.map((categoriaNome) => {
            const itensCategoria = treinamentos.filter(t => (t.categoria || 'Geral') === categoriaNome);
            if (itensCategoria.length === 0) return null;

            return (
              <div key={categoriaNome} className="space-y-3">
                <h4 className="font-display font-bold text-vapor-200 text-sm uppercase tracking-wider flex items-center gap-2 border-b border-graphite-700/60 pb-2">
                  <Sparkles size={16} className="text-amber-500" />
                  <span>{categoriaNome}</span>
                  <span className="text-vapor-400 text-xs font-mono font-normal">({itensCategoria.length})</span>
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {itensCategoria.map((item) => {
                    const bloquado = !item.disponivel_no_plano_atual;

                    return (
                      <Card 
                        key={item.id}
                        onClick={() => {
                          if (bloquado) {
                            setUpgradeModal(item);
                          } else {
                            setActiveVideo(item);
                          }
                        }}
                        className={`p-4 bg-graphite-800 border transition-all duration-200 shadow-sm flex flex-col justify-between gap-3 cursor-pointer group hover:border-amber-500/60 ${
                          bloquado ? 'opacity-85 bg-graphite-850' : ''
                        }`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2">
                              {bloquado ? (
                                <span className="p-1.5 rounded-md bg-graphite-900 text-amber-500 border border-amber-500/30">
                                  <Lock size={14} />
                                </span>
                              ) : (
                                <span className="p-1.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/30 group-hover:scale-105 transition-transform">
                                  <Play size={14} className="fill-amber-400" />
                                </span>
                              )}
                              <h5 className="font-display font-bold text-vapor-100 text-sm group-hover:text-amber-400 transition-colors">
                                {item.titulo}
                              </h5>
                            </div>

                            {/* Marca de Concluído Toggle */}
                            {!bloquado && (
                              <button
                                type="button"
                                onClick={(e) => handleToggleConcluido(item, e)}
                                title={item.concluido ? 'Marcar como não assistido' : 'Marcar como assistido'}
                                className={`p-1.5 rounded-lg border transition-colors shrink-0 ${
                                  item.concluido
                                    ? 'bg-mint-500/10 text-mint-400 border-mint-500/40'
                                    : 'bg-graphite-900 text-vapor-400 border-graphite-700 hover:text-vapor-100'
                                }`}
                              >
                                <CheckCircle2 size={16} className={item.concluido ? 'fill-mint-400/20' : ''} />
                              </button>
                            )}
                          </div>

                          {item.descricao && (
                            <p className="text-vapor-400 text-xs leading-relaxed line-clamp-2">
                              {item.descricao}
                            </p>
                          )}
                        </div>

                        {/* Rodapé do Card do Vídeo */}
                        <div className="flex items-center justify-between text-[11px] font-mono text-vapor-400 pt-2 border-t border-graphite-700/60">
                          <div className="flex items-center gap-3">
                            <span className="flex items-center gap-1">
                              <Clock size={12} className="text-vapor-400" />
                              {item.duracao_minutos} min
                            </span>
                            {item.essencial && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 text-[10px] font-bold">
                                Essencial
                              </span>
                            )}
                          </div>

                          {bloquado ? (
                            <span className="text-amber-400 font-bold flex items-center gap-1">
                              <span>Disponível no plano superior</span>
                              <Lock size={12} />
                            </span>
                          ) : item.concluido ? (
                            <span className="text-mint-400 font-bold flex items-center gap-1">
                              <span>Assistido</span>
                              <CheckCircle2 size={12} />
                            </span>
                          ) : (
                            <span className="text-amber-500 font-bold group-hover:underline flex items-center gap-1">
                              <span>Assistir aula</span>
                              <Play size={12} />
                            </span>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL PLAYER DE VÍDEO (DOMÍNIO SEM COOKIES) */}
      {activeVideo && (
        <div className="fixed inset-0 bg-graphite-950/85 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="bg-graphite-800 border border-graphite-600 rounded-2xl max-w-4xl w-full p-4 sm:p-6 space-y-4 shadow-2xl relative">
            <div className="flex items-center justify-between gap-4 border-b border-graphite-700 pb-3">
              <div>
                <h4 className="font-display font-bold text-vapor-100 text-base flex items-center gap-2">
                  <span>{activeVideo.titulo}</span>
                  {activeVideo.concluido && (
                    <span className="px-2 py-0.5 rounded bg-mint-500/10 text-mint-400 border border-mint-500/30 text-xs font-mono">
                      Assistido
                    </span>
                  )}
                </h4>
                <p className="text-vapor-400 text-xs">{activeVideo.categoria} • {activeVideo.duracao_minutos} minutos</p>
              </div>

              <button 
                onClick={() => setActiveVideo(null)} 
                className="text-vapor-400 hover:text-vapor-100 p-1.5 rounded-lg bg-graphite-900 border border-graphite-700"
              >
                <X size={20} />
              </button>
            </div>

            {/* Container Responsivo 16:9 */}
            <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden shadow-inner border border-graphite-700">
              <iframe
                src={getEmbedUrl(activeVideo.plataforma, activeVideo.video_id)}
                title={activeVideo.titulo}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full h-full border-0"
              />
            </div>

            {activeVideo.descricao && (
              <p className="text-vapor-300 text-xs leading-relaxed bg-graphite-900 p-3.5 rounded-xl border border-graphite-700">
                {activeVideo.descricao}
              </p>
            )}

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={(e) => {
                  handleToggleConcluido(activeVideo, e);
                  setActiveVideo(prev => prev ? { ...prev, concluido: !prev.concluido } : null);
                }}
                className={`px-4 py-2 rounded-xl text-xs font-bold font-sans flex items-center gap-2 border transition-all ${
                  activeVideo.concluido
                    ? 'bg-mint-500/10 text-mint-400 border-mint-500/40'
                    : 'bg-amber-500 text-graphite-950 border-amber-500 hover:bg-amber-400'
                }`}
              >
                <CheckCircle2 size={16} />
                <span>{activeVideo.concluido ? 'Concluído (Clique para desmarcar)' : 'Marcar como Assistido'}</span>
              </button>

              <Button variant="secondary" onClick={() => setActiveVideo(null)} className="text-xs">
                Fechar Vídeo
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL TEASER UPGRADE DE PLANO */}
      {upgradeModal && (
        <div className="fixed inset-0 bg-graphite-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-graphite-800 border border-amber-500/50 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl relative text-center">
            <button 
              onClick={() => setUpgradeModal(null)} 
              className="absolute right-4 top-4 text-vapor-400 hover:text-vapor-100 p-1"
            >
              <X size={20} />
            </button>

            <div className="inline-flex p-3.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <Lock size={32} />
            </div>

            <div className="space-y-1">
              <h4 className="font-display text-lg text-vapor-100 font-bold">
                Treinamento Exclusivo para Planos Avancados
              </h4>
              <p className="text-vapor-400 text-xs leading-relaxed">
                O vídeo <strong>"{upgradeModal.titulo}"</strong> está disponível para oficinas nos planos Pro ou Studio.
              </p>
            </div>

            <div className="bg-graphite-900 p-4 rounded-xl border border-graphite-700 text-xs text-vapor-300 text-left space-y-1">
              <p className="font-bold text-amber-400">Por que fazer upgrade?</p>
              <p>Além de treinamentos avançados de gestão, você libera ferramentas de cronômetro com múltiplos operadores, relatórios financeiros detalhados e WhatsApp ilimitado.</p>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setUpgradeModal(null)} className="w-full sm:w-auto text-xs">
                Voltar
              </Button>
              <Link to="/planos" className="w-full sm:w-auto">
                <Button variant="primary" className="w-full text-xs font-bold">
                  Conhecer Planos & Upgrade
                </Button>
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
