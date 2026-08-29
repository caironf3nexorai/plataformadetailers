import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAdminAuth } from '../../components/admin/AdminGuard';
import { 
  Tv, 
  Plus, 
  Edit3, 
  CheckCircle2, 
  Sparkles, 
  X,
  ArrowUp,
  ArrowDown,
  Building2,
  Clock,
  Eye,
  AlertTriangle
} from 'lucide-react';
import { parseVideoUrl, getEmbedUrl } from '../../utils/videoExtractor';

interface AdminTreinamentoItem {
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
  ativo: boolean;
  created_at: string;
  planos_permitidos: string[];
  oficinas_assistiram_count: number;
}

export const AdminTreinamentos: React.FC = () => {
  const { adminLevel } = useAdminAuth();
  const isReadOnly = adminLevel === 'suporte';

  const [treinamentos, setTreinamentos] = useState<AdminTreinamentoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [url, setUrl] = useState('');
  const [categoria, setCategoria] = useState('Geral');
  const [duracaoMinutos, setDuracaoMinutos] = useState<number>(5);
  const [ordem, setOrdem] = useState<number>(0);
  const [essencial, setEssencial] = useState(false);
  const [ativo, setAtivo] = useState(true);
  const [planos, setPlanos] = useState<string[]>(['free', 'pro', 'studio']);
  const [urlParseError, setUrlParseError] = useState<string | null>(null);

  // Video Preview
  const [previewVideo, setPreviewVideo] = useState<AdminTreinamentoItem | null>(null);

  const fetchTreinamentos = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_obter_treinamentos');
      if (error) throw error;
      setTreinamentos(data || []);
    } catch (err: any) {
      console.error('[AdminTreinamentos] Erro ao buscar treinamentos:', err);
      setMsg({ type: 'error', text: 'Erro ao carregar treinamentos: ' + err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTreinamentos();
  }, []);

  const openNewModal = () => {
    setEditingId(null);
    setTitulo('');
    setDescricao('');
    setUrl('');
    setCategoria('Geral');
    setDuracaoMinutos(5);
    setOrdem(treinamentos.length + 1);
    setEssencial(false);
    setAtivo(true);
    setPlanos(['free', 'pro', 'studio']);
    setUrlParseError(null);
    setShowModal(true);
  };

  const openEditModal = (item: AdminTreinamentoItem) => {
    setEditingId(item.id);
    setTitulo(item.titulo);
    setDescricao(item.descricao || '');
    setUrl(item.url);
    setCategoria(item.categoria || 'Geral');
    setDuracaoMinutos(item.duracao_minutos || 0);
    setOrdem(item.ordem || 0);
    setEssencial(item.essencial);
    setAtivo(item.ativo);
    setPlanos(item.planos_permitidos || []);
    setUrlParseError(null);
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;
    setUrlParseError(null);
    setSubmitting(true);
    setMsg(null);

    // Valida extração de vídeo do YouTube/Vimeo
    let parsed: { plataforma: 'youtube' | 'vimeo'; video_id: string };
    try {
      parsed = parseVideoUrl(url);
    } catch (err: any) {
      setUrlParseError(err.message || 'Link de vídeo não reconhecido. Por favor, insira um link válido do YouTube ou Vimeo.');
      setSubmitting(false);
      return;
    }

    try {
      const { error } = await supabase.rpc('admin_salvar_treinamento', {
        p_id: editingId || null,
        p_titulo: titulo.trim(),
        p_descricao: descricao.trim() || null,
        p_url: url.trim(),
        p_plataforma: parsed.plataforma,
        p_video_id: parsed.video_id,
        p_categoria: categoria.trim() || 'Geral',
        p_duracao_minutos: Number(duracaoMinutos) || 0,
        p_ordem: Number(ordem) || 0,
        p_essencial: essencial,
        p_ativo: ativo,
        p_planos: planos
      });

      if (error) throw error;

      setMsg({ type: 'success', text: editingId ? 'Treinamento atualizado com sucesso!' : 'Novo treinamento cadastrado com sucesso!' });
      setShowModal(false);
      await fetchTreinamentos();
    } catch (err: any) {
      setMsg({ type: 'error', text: 'Erro ao salvar treinamento: ' + err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleAtivo = async (item: AdminTreinamentoItem) => {
    if (isReadOnly) return;
    try {
      const { error } = await supabase.rpc('admin_salvar_treinamento', {
        p_id: item.id,
        p_ativo: !item.ativo,
        p_planos: item.planos_permitidos
      });

      if (error) throw error;
      await fetchTreinamentos();
    } catch (err: any) {
      console.error('[AdminTreinamentos] Erro ao alterar status:', err);
    }
  };

  const handleReorder = async (item: AdminTreinamentoItem, delta: number) => {
    if (isReadOnly) return;
    const novaOrdem = Math.max(0, (item.ordem || 0) + delta);
    try {
      const { error } = await supabase.rpc('admin_salvar_treinamento', {
        p_id: item.id,
        p_ordem: novaOrdem,
        p_planos: item.planos_permitidos
      });
      if (error) throw error;
      await fetchTreinamentos();
    } catch (err: any) {
      console.error('[AdminTreinamentos] Erro ao reordenar:', err);
    }
  };

  const handlePlanoCheck = (planoCodigo: string) => {
    setPlanos(prev => 
      prev.includes(planoCodigo)
        ? prev.filter(p => p !== planoCodigo)
        : [...prev, planoCodigo]
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-heading text-white flex items-center gap-2">
            <Tv className="text-amber-500" />
            <span>Módulo de Treinamentos da Plataforma</span>
          </h1>
          <p className="text-slate-400 text-sm">
            Cadastre vídeos de onboarding, capacitação e boas práticas para as oficinas assinantes.
          </p>
        </div>

        <button
          onClick={openNewModal}
          disabled={isReadOnly}
          className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold px-4 py-2.5 rounded-lg text-sm transition flex items-center space-x-2 shadow-lg shadow-amber-500/10"
        >
          <Plus className="w-4 h-4" />
          <span>Cadastrar Novo Treinamento</span>
        </button>
      </div>

      {/* Nota de Segurança sobre Vídeos Não Listados */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-slate-300 text-xs sm:text-sm space-y-1">
        <p className="font-bold text-amber-400 flex items-center gap-1.5">
          <Sparkles className="w-4 h-4" />
          <span>Nota sobre Vídeos Não Listados (YouTube / Vimeo):</span>
        </p>
        <p className="text-slate-400 leading-relaxed">
          Vídeos marcados como "Não Listados" no YouTube ou Vimeo não aparecem em pesquisas públicas, mas qualquer pessoa com o link tem acesso ao conteúdo. Este formato é ideal para tutoriais e treinamentos operacionais do sistema.
        </p>
      </div>

      {msg && (
        <div className={`p-4 rounded-xl text-sm font-medium border flex items-center justify-between ${
          msg.type === 'success' 
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
        }`}>
          <span>{msg.text}</span>
          <button onClick={() => setMsg(null)} className="text-xs opacity-70 hover:opacity-100">Fechar</button>
        </div>
      )}

      {/* Lista de Treinamentos */}
      {loading ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-400">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500 mx-auto mb-3"></div>
          <p className="text-sm">Carregando catálogo de treinamentos...</p>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="px-4 py-4 text-center">Ordem</th>
                <th className="px-6 py-4">Treinamento / Categoria</th>
                <th className="px-4 py-4">Duração</th>
                <th className="px-4 py-4">Planos Permitidos</th>
                <th className="px-6 py-4 text-center">Oficinas Engajadas</th>
                <th className="px-4 py-4">Status</th>
                <th className="px-6 py-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {treinamentos.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-500 font-mono">
                    Nenhum treinamento cadastrado ainda. Clique em "Cadastrar Novo Treinamento".
                  </td>
                </tr>
              ) : (
                treinamentos.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/40 transition">
                    {/* Botões de Reordenamento */}
                    <td className="px-4 py-4 text-center">
                      <div className="flex flex-col items-center justify-center gap-1 font-mono text-xs">
                        <button
                          onClick={() => handleReorder(item, -1)}
                          disabled={isReadOnly || item.ordem <= 0}
                          className="p-1 text-slate-400 hover:text-amber-400 disabled:opacity-20"
                          title="Subir ordem"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <span className="font-bold text-amber-400">{item.ordem}</span>
                        <button
                          onClick={() => handleReorder(item, 1)}
                          disabled={isReadOnly}
                          className="p-1 text-slate-400 hover:text-amber-400 disabled:opacity-20"
                          title="Descer ordem"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>

                    {/* Título e Categoria */}
                    <td className="px-6 py-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <strong className="text-white text-sm">{item.titulo}</strong>
                          {item.essencial && (
                            <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold">
                              Essencial (Onboarding)
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 font-mono">
                          Categoria: <span className="text-slate-300">{item.categoria}</span> • {item.plataforma.toUpperCase()} ({item.video_id})
                        </p>
                      </div>
                    </td>

                    {/* Duração */}
                    <td className="px-4 py-4 font-mono text-xs text-slate-300 whitespace-nowrap">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        {item.duracao_minutos} min
                      </span>
                    </td>

                    {/* Planos Permitidos */}
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-1 flex-wrap font-mono text-[10px]">
                        {(item.planos_permitidos || []).map(p => (
                          <span key={p} className="px-2 py-0.5 rounded bg-slate-800 text-amber-400 border border-slate-700 uppercase font-bold">
                            {p}
                          </span>
                        ))}
                      </div>
                    </td>

                    {/* Métrica: Oficinas Distintas Assistiram */}
                    <td className="px-6 py-4 text-center">
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-950 border border-slate-800 rounded-lg text-emerald-400 font-mono text-xs font-bold">
                        <Building2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>{item.oficinas_assistiram_count} oficina(s)</span>
                      </div>
                    </td>

                    {/* Status Ativo */}
                    <td className="px-4 py-4">
                      <button
                        onClick={() => handleToggleAtivo(item)}
                        disabled={isReadOnly}
                        className={`inline-flex items-center space-x-1 text-xs font-semibold px-2.5 py-1 rounded border transition ${
                          item.ativo
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                            : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                        }`}
                      >
                        {item.ativo ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Ativo</span>
                          </>
                        ) : (
                          <>
                            <X className="w-3.5 h-3.5" />
                            <span>Inativo</span>
                          </>
                        )}
                      </button>
                    </td>

                    {/* Ações */}
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          onClick={() => setPreviewVideo(item)}
                          className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition"
                          title="Visualizar Vídeo"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openEditModal(item)}
                          disabled={isReadOnly}
                          className="p-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 rounded-lg transition border border-amber-500/30"
                          title="Editar Treinamento"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Formulário (Novo / Editar) */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-xl w-full p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                <Tv className="w-5 h-5 text-amber-500" />
                <span>{editingId ? 'Editar Treinamento' : 'Cadastrar Novo Treinamento'}</span>
              </h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {urlParseError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{urlParseError}</span>
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Título do Treinamento *</label>
                <input
                  type="text"
                  required
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  placeholder="Ex: Como Configurar a Tabela de Serviços e Preços"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-amber-500/50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Link do Vídeo (YouTube ou Vimeo) *</label>
                <input
                  type="url"
                  required
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setUrlParseError(null);
                  }}
                  placeholder="Ex: https://www.youtube.com/watch?v=... ou https://youtu.be/..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-amber-500/50"
                />
                <span className="text-[11px] text-slate-500 mt-1 block">
                  Aceita URLs normais, encurtadas (youtu.be), embed ou vimeo.com. O identificador é extraído automaticamente.
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Categoria *</label>
                  <input
                    type="text"
                    required
                    value={categoria}
                    onChange={(e) => setCategoria(e.target.value)}
                    placeholder="Ex: Primeiro Uso, Serviços..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-amber-500/50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Duração (Minutos) *</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={duracaoMinutos}
                    onChange={(e) => setDuracaoMinutos(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-amber-500/50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Ordem de Exibição</label>
                  <input
                    type="number"
                    min={0}
                    value={ordem}
                    onChange={(e) => setOrdem(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-amber-500/50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Descrição / O que o aluno vai aprender</label>
                <textarea
                  rows={3}
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  placeholder="Resumo do conteúdo apresentado na aula..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-amber-500/50"
                />
              </div>

              {/* Escolha de Planos Permitidos */}
              <div className="space-y-1.5 p-3 bg-slate-950 border border-slate-800 rounded-lg">
                <label className="block text-xs font-bold text-slate-300">Planos onde o vídeo fica disponível:</label>
                <div className="flex items-center gap-4 text-xs font-mono text-slate-300 pt-1">
                  {['free', 'pro', 'studio'].map((planoCod) => (
                    <label key={planoCod} className="flex items-center gap-2 cursor-pointer uppercase">
                      <input
                        type="checkbox"
                        checked={planos.includes(planoCod)}
                        onChange={() => handlePlanoCheck(planoCod)}
                        className="w-4 h-4 accent-amber-500 rounded"
                      />
                      <span>{planoCod}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={essencial}
                      onChange={(e) => setEssencial(e.target.checked)}
                      className="w-4 h-4 accent-amber-500 rounded"
                    />
                    <span>Marcar como <strong>Essencial (Primeiros Passos)</strong></span>
                  </label>

                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ativo}
                      onChange={(e) => setAtivo(e.target.checked)}
                      className="w-4 h-4 accent-amber-500 rounded"
                    />
                    <span>Ativo no catálogo</span>
                  </label>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium transition text-xs flex-1 sm:flex-none"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg transition text-xs shadow-lg shadow-amber-500/10 flex-1 sm:flex-none"
                  >
                    {submitting ? 'Salvando...' : 'Salvar Treinamento'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Preview Vídeo */}
      {previewVideo && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-3xl w-full p-6 space-y-4 shadow-2xl relative">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h4 className="text-base font-bold text-white">{previewVideo.titulo}</h4>
              <button onClick={() => setPreviewVideo(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden border border-slate-800">
              <iframe
                src={getEmbedUrl(previewVideo.plataforma, previewVideo.video_id)}
                title={previewVideo.titulo}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full h-full border-0"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
