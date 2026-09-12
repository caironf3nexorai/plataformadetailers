import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../lib/supabase';
import { 
  FileText, 
  Lock, 
  Download, 
  Eye, 
  ShieldCheck, 
  AlertCircle,
  Loader2,
  BookOpen
} from 'lucide-react';
import { usePlano } from '../../hooks/usePlano';
import { useAuth } from '../../contexts/AuthContext';
import type { AcademiaMaterial } from '../../types/materiais';
import { CATEGORIAS_MATERIAIS } from '../../types/materiais';
import { LeitorSeguroMaterial } from './LeitorSeguroMaterial';
import { Link } from 'react-router-dom';

export const AbaMateriaisDidaticos: React.FC = () => {
  const { nomePlano } = usePlano();
  const { tenant } = useAuth();
  const [materiais, setMateriais] = useState<AcademiaMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoriaAtiva, setCategoriaAtiva] = useState<string>('Todas');

  // Estado do Leitor Ativo
  const [materialLeitura, setMaterialLeitura] = useState<AcademiaMaterial | null>(null);
  // Modal de upgrade quando bloqueado
  const [upgradeModal, setUpgradeModal] = useState<AcademiaMaterial | null>(null);

  // Previne rolagem de fundo enquanto o modal de upgrade estiver aberto
  useEffect(() => {
    if (upgradeModal) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [upgradeModal]);

  const fetchMateriais = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('obter_materiais_assinante');

      if (!rpcErr && data) {
        const listaBruta: any[] = Array.isArray(data) ? data : (data.materiais || []);
        const userPlano = tenant?.plano || 'free';
        const processados: AcademiaMaterial[] = listaBruta.map((m: any) => {
          const planosPerm: string[] = Array.isArray(m.planos_permitidos) ? m.planos_permitidos : [];
          const disponivel = planosPerm.length === 0 || planosPerm.includes(userPlano);

          return {
            ...m,
            disponivel_no_plano_atual: m.disponivel_no_plano_atual !== undefined
              ? m.disponivel_no_plano_atual
              : disponivel
          };
        });

        setMateriais(processados);
        return;
      }

      // Fallback direto caso a RPC ainda não esteja ativa
      console.warn('[AbaMateriaisDidaticos] RPC indisponível, buscando direto na tabela:', rpcErr?.message);
      const { data: mats, error: tabErr } = await supabase
        .from('academia_materiais')
        .select('*')
        .eq('ativo', true)
        .order('ordem', { ascending: true });

      if (tabErr) throw tabErr;

      const userPlano = tenant?.plano || 'free';
      const processados: AcademiaMaterial[] = (mats || []).map((m: any) => {
        const planosPerm: string[] = Array.isArray(m.planos_permitidos) ? m.planos_permitidos : [];
        const disponivel = planosPerm.length === 0 || planosPerm.includes(userPlano);

        return {
          ...m,
          disponivel_no_plano_atual: disponivel
        };
      });

      setMateriais(processados);
    } catch (err: any) {
      console.error('[AbaMateriaisDidaticos] Erro ao carregar materiais:', err);
      setError(err.message || 'Erro ao carregar os materiais didáticos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMateriais();
  }, [tenant?.plano]);

  const materiaisFiltrados = materiais.filter(m => {
    if (categoriaAtiva === 'Todas') return true;
    return m.categoria.toLowerCase() === categoriaAtiva.toLowerCase();
  });

  const formatarTamanho = (bytes: number) => {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) {
      return `${Math.round(bytes / 1024)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const abrirMaterial = (item: AcademiaMaterial) => {
    if (!item.disponivel_no_plano_atual) {
      setUpgradeModal(item);
      return;
    }
    setMaterialLeitura(item);
  };

  const baixarDireto = async (e: React.MouseEvent, item: AcademiaMaterial) => {
    e.stopPropagation();
    if (!item.permitir_download || !item.disponivel_no_plano_atual) return;

    try {
      supabase.rpc('registrar_acesso_material', {
        p_material_id: item.id,
        p_tipo: 'download'
      }).then(undefined, () => {});

      const { data, error } = await supabase.storage
        .from('academia-materiais')
        .download(item.arquivo_path);

      if (error) throw error;

      const blobUrl = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = item.arquivo_nome || `${item.titulo}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (err: any) {
      console.error('[AbaMateriaisDidaticos] Erro ao baixar material:', err);
      alert('Erro ao baixar o arquivo: ' + err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Banner de Boas-Vindas e Segurança */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-neutral-900 via-neutral-900 to-cyan-950/40 border border-neutral-800 p-6 shadow-xl">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5" /> Biblioteca Exclusiva Detailers
              </span>
              <span className="text-xs text-neutral-400">
                Seu Plano: <strong className="text-neutral-200 uppercase">{nomePlano || 'Pro'}</strong>
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-neutral-100 tracking-tight">
              E-books, Guias & Materiais Técnicos
            </h2>
            <p className="text-xs sm:text-sm text-neutral-400 max-w-2xl mt-1">
              Capacitação completa para sua equipe: planilhas de precificação, guias de tráfego pago, processos de polimento e termos operacionais. 
              Materiais exclusivos lidos diretamente no leitor protegido da plataforma.
            </p>
          </div>

          <div className="shrink-0 flex items-center gap-2 bg-neutral-800/60 border border-neutral-700/60 rounded-xl px-3 py-2 text-xs text-neutral-300">
            <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>Leitor com proteção anti-vazamento</span>
          </div>
        </div>
      </div>

      {/* Filtros por Categoria */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
        <button
          onClick={() => setCategoriaAtiva('Todas')}
          className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
            categoriaAtiva === 'Todas'
              ? 'bg-cyan-500 text-neutral-950 shadow-lg shadow-cyan-500/20'
              : 'bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700'
          }`}
        >
          Todos os Materiais ({materiais.length})
        </button>
        {CATEGORIAS_MATERIAIS.map(cat => {
          const qtd = materiais.filter(m => m.categoria.toLowerCase() === cat.toLowerCase()).length;
          return (
            <button
              key={cat}
              onClick={() => setCategoriaAtiva(cat)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                categoriaAtiva.toLowerCase() === cat.toLowerCase()
                  ? 'bg-cyan-500 text-neutral-950 shadow-lg shadow-cyan-500/20'
                  : 'bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700'
              }`}
            >
              {cat} {qtd > 0 && `(${qtd})`}
            </button>
          );
        })}
      </div>

      {/* Listagem em Grid */}
      {loading ? (
        <div className="py-16 flex flex-col items-center justify-center text-neutral-400 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
          <p className="text-sm">Carregando acervo de materiais...</p>
        </div>
      ) : error ? (
        <div className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-center">
          <AlertCircle className="w-8 h-8 text-rose-400 mx-auto mb-2" />
          <p className="text-xs text-rose-300 font-medium">{error}</p>
        </div>
      ) : materiaisFiltrados.length === 0 ? (
        <div className="py-16 text-center rounded-2xl border border-dashed border-neutral-800 p-8">
          <FileText className="w-12 h-12 text-neutral-600 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-neutral-300">Nenhum material encontrado</h3>
          <p className="text-xs text-neutral-500 max-w-sm mx-auto mt-1">
            {categoriaAtiva === 'Todas' 
              ? 'Nenhum material didático foi disponibilizado no momento. Em breve novos guias serão publicados!'
              : `Não há materiais cadastrados na categoria "${categoriaAtiva}".`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {materiaisFiltrados.map((item) => {
            const bloqueado = !item.disponivel_no_plano_atual;

            return (
              <div
                key={item.id}
                onClick={() => abrirMaterial(item)}
                className={`group relative flex flex-col justify-between rounded-2xl border transition-all cursor-pointer overflow-hidden p-5 ${
                  bloqueado
                    ? 'bg-neutral-900/40 border-neutral-800/80 opacity-80 hover:opacity-100 hover:border-amber-500/40'
                    : 'bg-neutral-900/80 border-neutral-800 hover:border-cyan-500/50 hover:shadow-xl hover:shadow-cyan-500/5'
                }`}
              >
                <div>
                  {/* Topo do Card: Categoria e Badge de Download */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-neutral-800 text-neutral-300 border border-neutral-700">
                      {item.categoria}
                    </span>

                    {bloqueado ? (
                      <span className="flex items-center gap-1 text-[11px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full">
                        <Lock className="w-3 h-3" /> Exclusivo Pro/Studio
                      </span>
                    ) : item.permitir_download ? (
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                        <Download className="w-3 h-3" /> Download Liberado
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 rounded-full">
                        <ShieldCheck className="w-3 h-3" /> Leitura Segura
                      </span>
                    )}
                  </div>

                  {/* Título e Descrição */}
                  <h3 className="text-base font-bold text-neutral-100 group-hover:text-cyan-300 transition-colors mb-2 line-clamp-2">
                    {item.titulo}
                  </h3>

                  {item.descricao && (
                    <p className="text-xs text-neutral-400 line-clamp-3 mb-4 leading-relaxed">
                      {item.descricao}
                    </p>
                  )}
                </div>

                {/* Rodapé do Card */}
                <div className="pt-4 border-t border-neutral-800/80 flex items-center justify-between gap-3 mt-4">
                  <div className="text-[11px] text-neutral-500 flex items-center gap-2">
                    {item.total_paginas > 0 && (
                      <span>{item.total_paginas} págs</span>
                    )}
                    {item.total_paginas > 0 && item.tamanho_bytes > 0 && <span>•</span>}
                    {item.tamanho_bytes > 0 && (
                      <span>{formatarTamanho(item.tamanho_bytes)}</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Botão de Download se liberado */}
                    {item.permitir_download && !bloqueado && (
                      <button
                        onClick={(e) => baixarDireto(e, item)}
                        title="Baixar arquivo PDF"
                        className="p-2 rounded-xl bg-neutral-800 hover:bg-emerald-600 text-neutral-300 hover:text-white transition-colors border border-neutral-700"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    )}

                    {/* Botão Principal de Abrir */}
                    <button
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors ${
                        bloqueado
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 group-hover:bg-amber-500 group-hover:text-neutral-950'
                          : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 group-hover:bg-cyan-500 group-hover:text-neutral-950'
                      }`}
                    >
                      {bloqueado ? (
                        <>
                          <Lock className="w-3.5 h-3.5" />
                          <span>Desbloquear</span>
                        </>
                      ) : (
                        <>
                          <Eye className="w-3.5 h-3.5" />
                          <span>Abrir Leitor</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de Upgrade para Planos Bloqueados */}
      {upgradeModal && createPortal(
        <div className="fixed inset-0 z-[100] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto overflow-x-hidden animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl max-w-md w-full p-6 text-center shadow-2xl relative animate-in fade-in zoom-in-95 my-auto">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto mb-4">
              <Lock className="w-6 h-6 text-amber-400" />
            </div>

            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 uppercase tracking-wider">
              Recurso Exclusivo
            </span>

            <h3 className="text-lg font-bold text-neutral-100 mt-2 mb-2">
              {upgradeModal.titulo}
            </h3>

            <p className="text-xs text-neutral-400 mb-6 leading-relaxed">
              Este material didático está disponível exclusivamente para oficinas nos planos <strong>Pro</strong> e <strong>Studio</strong>.
              Faça o upgrade agora para ter acesso ilimitado a todos os guias, planilhas e e-books da Academia!
            </p>

            <div className="flex flex-col gap-2.5">
              <Link
                to="/planos"
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-neutral-950 font-bold text-xs shadow-lg shadow-amber-500/20 transition-all text-center"
              >
                Conhecer Planos Pro & Studio
              </Link>
              <button
                type="button"
                onClick={() => setUpgradeModal(null)}
                className="w-full py-2 rounded-xl text-xs font-semibold text-neutral-400 hover:text-neutral-200 transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Leitor Seguro em Tela Cheia */}
      {materialLeitura && (
        <LeitorSeguroMaterial
          material={materialLeitura}
          tenantNome={tenant?.nome || 'Oficina Detailer'}
          usuarioDocumento={tenant?.documento || ''}
          onClose={() => setMaterialLeitura(null)}
        />
      )}
    </div>
  );
};
