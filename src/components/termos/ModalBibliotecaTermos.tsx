import React, { useState, useEffect } from 'react';
import { 
  Scale, 
  Sparkles, 
  Download, 
  Copy, 
  Check, 
  Search, 
  Zap, 
  X, 
  RotateCw,
  ChevronDown,
  ChevronUp,
  Lock
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { TIPOS_TERMOS_GARANTIA } from '../../types/termos';
import type { PlataformaModeloTermo } from '../../types/termos';

interface ModalBibliotecaTermosProps {
  isOpen: boolean;
  onClose: () => void;
  onModeloAplicado?: (categoria: 'responsabilidade' | 'garantia', conteudo: string) => void;
}

export const ModalBibliotecaTermos: React.FC<ModalBibliotecaTermosProps> = ({
  isOpen,
  onClose,
  onModeloAplicado,
}) => {
  const { showSuccess, showError } = useToast();

  const [modelos, setModelos] = useState<PlataformaModeloTermo[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [abaAtiva, setAbaAtiva] = useState<'todos' | 'responsabilidade' | 'garantia'>('todos');
  const [filtroServico, setFiltroServico] = useState<string>('todos');
  const [busca, setBusca] = useState<string>('');

  // Estado de expansão de texto
  const [expandidos, setExpandidos] = useState<Record<string, boolean>>({});

  // Estado de aplicação
  const [aplicandoId, setAplicandoId] = useState<string | null>(null);
  const [copiadoId, setCopiadoId] = useState<string | null>(null);

  const carregarModelos = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('listar_modelos_termos');
      if (error) throw error;
      setModelos(data || []);
    } catch (err: any) {
      console.error('Erro ao carregar biblioteca de modelos:', err);
      showError('Não foi possível carregar os modelos jurídicos da plataforma.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      carregarModelos();
    }
  }, [isOpen]);

  const toggleExpandir = (id: string) => {
    setExpandidos((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCopiar = (id: string, texto: string) => {
    navigator.clipboard.writeText(texto);
    setCopiadoId(id);
    showSuccess('Cláusulas copiadas para a área de transferência!');
    setTimeout(() => setCopiadoId(null), 2500);
  };

  const handleDownloadArquivo = async (modelo: PlataformaModeloTermo) => {
    try {
      // Incrementa métrica de download
      supabase.rpc('incrementar_download_modelo_termo', { p_modelo_id: modelo.id });

      if (modelo.arquivo_url) {
        window.open(modelo.arquivo_url, '_blank');
      } else {
        // Gera download de arquivo de texto (.txt) formatado caso não tenha anexo
        const element = document.createElement('a');
        const file = new Blob([modelo.conteudo_texto], { type: 'text/plain;charset=utf-8' });
        element.href = URL.createObjectURL(file);
        element.download = `${modelo.titulo.replace(/[^a-zA-Z0-9]/g, '_')}.txt`;
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
      }
      showSuccess('Download iniciado com sucesso!');
    } catch (err: any) {
      console.error('Erro no download:', err);
      showError('Erro ao baixar o arquivo.');
    }
  };

  const handleAplicarNaOficina = async (modelo: PlataformaModeloTermo) => {
    setAplicandoId(modelo.id);
    try {
      const { data, error } = await supabase.rpc('aplicar_modelo_termo_tenant', {
        p_modelo_id: modelo.id,
      });

      if (error) throw error;

      if (data && data.sucesso) {
        showSuccess(data.mensagem || 'Modelo aplicado à sua oficina com sucesso!');
        if (onModeloAplicado) {
          onModeloAplicado(modelo.categoria, modelo.conteudo_texto);
        }
        // Atualiza contador local
        setModelos((prev) =>
          prev.map((m) => (m.id === modelo.id ? { ...m, aplicacoes_count: (m.aplicacoes_count || 0) + 1 } : m))
        );
      } else {
        showError(data?.mensagem || 'Erro ao aplicar modelo.');
      }
    } catch (err: any) {
      console.error('Erro ao aplicar modelo na oficina:', err);
      showError(err.message || 'Erro ao aplicar o modelo de termo.');
    } finally {
      setAplicandoId(null);
    }
  };

  // Filtragem
  const modelosFiltrados = modelos.filter((m) => {
    if (abaAtiva !== 'todos' && m.categoria !== abaAtiva) return false;
    if (abaAtiva === 'garantia' && filtroServico !== 'todos' && m.tipo_servico !== filtroServico) return false;

    if (busca.trim()) {
      const query = busca.toLowerCase();
      const bateTitulo = m.titulo.toLowerCase().includes(query);
      const bateDesc = (m.descricao || '').toLowerCase().includes(query);
      const bateTexto = m.conteudo_texto.toLowerCase().includes(query);
      return bateTitulo || bateDesc || bateTexto;
    }
    return true;
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Biblioteca de Modelos Jurídicos"
      maxWidth="3xl"
      icon={<Scale className="text-amber-400" size={24} />}
    >
      <div className="flex flex-col gap-4 max-h-[82vh] overflow-hidden -mx-2 px-2">
        {/* Banner Informativo */}
        <div className="bg-gradient-to-r from-amber-500/15 via-slate-900 to-slate-900 border border-amber-500/30 rounded-xl p-3.5 flex items-center justify-between gap-3 shrink-0 shadow-inner">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/20 text-amber-400 rounded-lg shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-100 uppercase tracking-wide flex items-center gap-1.5">
                <span>Modelos Prontos & Validados Juridicamente</span>
                <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  SUGESTÕES DA PLATAFORMA
                </span>
              </h4>
              <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
                Proteja sua oficina com termos de responsabilidade (falhas ocultas, pertences, pátio) e garantias técnicas especializadas por serviço. Baixe em Word/PDF ou aplique diretamente em 1 clique!
              </p>
            </div>
          </div>
        </div>

        {/* Barra de Filtros & Abas */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 shrink-0">
          {/* Abas Principais */}
          <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              type="button"
              onClick={() => setAbaAtiva('todos')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                abaAtiva === 'todos'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Todos ({modelos.length})
            </button>
            <button
              type="button"
              onClick={() => setAbaAtiva('responsabilidade')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                abaAtiva === 'responsabilidade'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Responsabilidade & Falhas Ocultas
            </button>
            <button
              type="button"
              onClick={() => setAbaAtiva('garantia')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                abaAtiva === 'garantia'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Termos de Garantia
            </button>
          </div>

          {/* Campo de Busca */}
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Buscar modelos ou cláusulas..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full pl-8 pr-7 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
            {busca && (
              <button
                type="button"
                onClick={() => setBusca('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Sub-filtro por Serviço (se aba garantia estiver ativa) */}
        {abaAtiva === 'garantia' && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 shrink-0 scrollbar-none">
            <button
              type="button"
              onClick={() => setFiltroServico('todos')}
              className={`px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap transition ${
                filtroServico === 'todos'
                  ? 'bg-slate-800 text-amber-400 border border-amber-500/30'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              Todos os Serviços
            </button>
            {TIPOS_TERMOS_GARANTIA.map((t) => (
              <button
                key={t.tipo}
                type="button"
                onClick={() => setFiltroServico(t.tipo)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap transition ${
                  filtroServico === t.tipo
                    ? 'bg-slate-800 text-amber-400 border border-amber-500/30'
                    : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* Lista de Modelos (Scrollável) */}
        <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3 min-h-[300px] max-h-[58vh]">
          {loading ? (
            <div className="flex flex-col gap-3 py-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-32 rounded-xl bg-slate-900 border border-slate-800 animate-pulse" />
              ))}
            </div>
          ) : modelosFiltrados.length === 0 ? (
            <div className="text-center py-12 px-4 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col items-center justify-center gap-2">
              <Scale className="w-8 h-8 text-slate-600" />
              <p className="text-xs font-bold text-slate-300">Nenhum modelo encontrado</p>
              <p className="text-[11px] text-slate-500">
                {busca ? 'Tente buscar com outros termos.' : 'Nenhum modelo cadastrado nesta categoria no momento.'}
              </p>
            </div>
          ) : (
            modelosFiltrados.map((modelo) => {
              const estaExpandido = Boolean(expandidos[modelo.id]);
              const rotuloServico =
                modelo.categoria === 'garantia'
                  ? TIPOS_TERMOS_GARANTIA.find((t) => t.tipo === modelo.tipo_servico)?.label ||
                    modelo.tipo_servico ||
                    'Geral'
                  : null;

              return (
                <div
                  key={modelo.id}
                  className={`p-4 rounded-xl border transition shadow-md flex flex-col gap-3 ${
                    modelo.destaque
                      ? 'bg-gradient-to-b from-slate-900 to-slate-950 border-amber-500/40 shadow-amber-500/5'
                      : 'bg-slate-900/90 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {/* Topo do Card */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${
                            modelo.categoria === 'responsabilidade'
                              ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                              : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30'
                          }`}
                        >
                          {modelo.categoria === 'responsabilidade' ? 'Responsabilidade Geral' : 'Garantia'}
                        </span>

                        {rotuloServico && (
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                            {rotuloServico}
                          </span>
                        )}

                        {modelo.destaque && (
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-300 border border-yellow-500/30 flex items-center gap-1">
                            <Sparkles className="w-2.5 h-2.5" />
                            Recomendado Juridicamente
                          </span>
                        )}
                      </div>

                      <h3 className="font-heading font-bold text-sm sm:text-base text-slate-100 mt-1">
                        {modelo.titulo}
                      </h3>

                      {modelo.descricao && (
                        <p className="text-xs text-slate-400 leading-relaxed">{modelo.descricao}</p>
                      )}
                    </div>

                    {/* Contadores */}
                    <div className="hidden sm:flex flex-col items-end text-[10px] font-mono text-slate-400 shrink-0">
                      <span>{modelo.aplicacoes_count || 0} oficinas utilizam</span>
                      {modelo.downloads_count > 0 && (
                        <span className="text-slate-500">{modelo.downloads_count} downloads</span>
                      )}
                    </div>
                  </div>

                  {/* Conteúdo em Cláusulas */}
                  <div className="bg-slate-950/90 rounded-lg p-3 border border-slate-800/80">
                    <p
                      className={`text-xs text-slate-300 font-sans leading-relaxed whitespace-pre-line ${
                        !estaExpandido ? 'line-clamp-3' : ''
                      }`}
                    >
                      {modelo.conteudo_texto}
                    </p>

                    <div className="flex items-center justify-between pt-2 mt-2 border-t border-slate-800/60 text-[11px]">
                      <button
                        type="button"
                        onClick={() => toggleExpandir(modelo.id)}
                        className="text-amber-400 hover:text-amber-300 flex items-center gap-1 font-semibold"
                      >
                        {estaExpandido ? (
                          <>
                            <ChevronUp className="w-3.5 h-3.5" />
                            <span>Recolher Cláusulas</span>
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-3.5 h-3.5" />
                            <span>Ler Cláusulas Completas ({modelo.conteudo_texto.length} caracteres)</span>
                          </>
                        )}
                      </button>

                      {modelo.permitir_download !== false && (
                        <button
                          type="button"
                          onClick={() => handleCopiar(modelo.id, modelo.conteudo_texto)}
                          className="text-slate-400 hover:text-slate-200 flex items-center gap-1 font-medium"
                        >
                          {copiadoId === modelo.id ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="text-emerald-400 font-semibold">Copiado!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copiar Texto</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Ações do Card */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-1">
                    {/* Opção A: Download do Arquivo (Apenas se permitir_download for true) */}
                    {modelo.permitir_download !== false ? (
                      <button
                        type="button"
                        onClick={() => handleDownloadArquivo(modelo)}
                        className="text-xs font-semibold px-3 py-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white flex items-center justify-center gap-1.5 transition"
                        title={modelo.arquivo_url ? 'Baixar documento original em Word/PDF' : 'Baixar texto do modelo'}
                      >
                        <Download className="w-3.5 h-3.5 text-amber-400" />
                        <span>{modelo.arquivo_url ? `Baixar ${modelo.arquivo_tipo?.toUpperCase() || 'Arquivo'}` : 'Baixar Texto (.txt)'}</span>
                      </button>
                    ) : (
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-950/60 px-3 py-2 rounded-lg border border-slate-800/80">
                        <Lock className="w-3.5 h-3.5 text-amber-500/70" />
                        <span>Exclusivo para uso interno da plataforma</span>
                      </div>
                    )}

                    {/* Opção B: Aplicar em 1 clique na oficina */}
                    <Button
                      type="button"
                      variant="primary"
                      onClick={() => handleAplicarNaOficina(modelo)}
                      disabled={aplicandoId === modelo.id}
                      className="text-xs font-bold h-9 px-4 flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-950 shadow-md hover:opacity-95"
                    >
                      {aplicandoId === modelo.id ? (
                        <>
                          <RotateCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Aplicando...</span>
                        </>
                      ) : (
                        <>
                          <Zap className="w-3.5 h-3.5 fill-current" />
                          <span>
                            {modelo.categoria === 'responsabilidade'
                              ? 'Aplicar como Termo Fixo da Minha Oficina'
                              : 'Adicionar este Termo de Garantia'}
                          </span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Rodapé do Modal */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs text-slate-400 shrink-0">
          <span className="text-[11px]">
            Você pode personalizar qualquer termo aplicado a qualquer momento nesta tela de configurações.
          </span>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            className="text-xs h-9 px-4 text-slate-300"
          >
            Fechar
          </Button>
        </div>
      </div>
    </Modal>
  );
};
