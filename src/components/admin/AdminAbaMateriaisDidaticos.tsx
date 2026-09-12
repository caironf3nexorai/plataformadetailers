import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../lib/supabase';
import { 
  FileText, 
  Plus, 
  Edit3, 
  Trash2, 
  Download, 
  Lock, 
  ShieldCheck, 
  UploadCloud, 
  X, 
  Check, 
  RefreshCw, 
  Sparkles, 
  Eye, 
  FileCheck
} from 'lucide-react';
import type { AcademiaMaterial } from '../../types/materiais';
import { CATEGORIAS_MATERIAIS } from '../../types/materiais';
import { LeitorSeguroMaterial } from '../treinamentos/LeitorSeguroMaterial';

interface AdminAbaMateriaisDidaticosProps {
  isReadOnly?: boolean;
}

export const AdminAbaMateriaisDidaticos: React.FC<AdminAbaMateriaisDidaticosProps> = ({ isReadOnly = false }) => {
  const [materiais, setMateriais] = useState<AcademiaMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modal de Cadastro / Edição
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  // Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [titulo, setTitulo] = useState('');
  const [categoria, setCategoria] = useState('Precificação');
  const [descricao, setDescricao] = useState('');
  const [arquivoPath, setArquivoPath] = useState('');
  const [arquivoNome, setArquivoNome] = useState('');
  const [tamanhoBytes, setTamanhoBytes] = useState<number>(0);
  const [totalPaginas, setTotalPaginas] = useState<number>(0);
  const [permitirDownload, setPermitirDownload] = useState(false);
  const [planosPermitidos, setPlanosPermitidos] = useState<string[]>(['pro', 'studio']);
  const [ordem, setOrdem] = useState<number>(0);
  const [ativo, setAtivo] = useState(true);

  // File Ref
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Modal de Exclusão
  const [materialParaExcluir, setMaterialParaExcluir] = useState<AcademiaMaterial | null>(null);
  const [deletando, setDeletando] = useState(false);

  // Leitor de Preview
  const [previewMaterial, setPreviewMaterial] = useState<AcademiaMaterial | null>(null);

  // Previne rolagem de fundo enquanto modais estiverem abertos
  useEffect(() => {
    if (showModal || materialParaExcluir) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [showModal, materialParaExcluir]);

  const fetchMateriais = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_obter_materiais');
      if (error) throw error;
      setMateriais(data || []);
    } catch (err: any) {
      console.error('[AdminAbaMateriaisDidaticos] Erro ao buscar materiais:', err);
      setMsg({ type: 'error', text: 'Erro ao carregar materiais: ' + err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMateriais();
  }, []);

  const openNewModal = () => {
    setEditingId(null);
    setTitulo('');
    setCategoria('Precificação');
    setDescricao('');
    setArquivoPath('');
    setArquivoNome('');
    setTamanhoBytes(0);
    setTotalPaginas(0);
    setPermitirDownload(false); // Padrão: Modo Seguro (Anti-Cópia/Download)
    setPlanosPermitidos(['pro', 'studio']);
    setOrdem(materiais.length + 1);
    setAtivo(true);
    setSelectedFile(null);
    setShowModal(true);
  };

  const openEditModal = (item: AcademiaMaterial) => {
    setEditingId(item.id);
    setTitulo(item.titulo);
    setCategoria(item.categoria);
    setDescricao(item.descricao || '');
    setArquivoPath(item.arquivo_path);
    setArquivoNome(item.arquivo_nome);
    setTamanhoBytes(item.tamanho_bytes || 0);
    setTotalPaginas(item.total_paginas || 0);
    setPermitirDownload(Boolean(item.permitir_download));
    setPlanosPermitidos(item.planos_permitidos || ['pro', 'studio']);
    setOrdem(item.ordem || 0);
    setAtivo(item.ativo !== false);
    setSelectedFile(null);
    setShowModal(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        setMsg({ type: 'error', text: 'Por favor selecione um arquivo em formato PDF (.pdf).' });
        return;
      }
      setSelectedFile(file);
      setArquivoNome(file.name);
      setTamanhoBytes(file.size);
      if (!titulo.trim()) {
        const nomeLimpo = file.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
        setTitulo(nomeLimpo.charAt(0).toUpperCase() + nomeLimpo.slice(1));
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!titulo.trim()) {
      setMsg({ type: 'error', text: 'Informe o título do material.' });
      return;
    }

    if (!editingId && !selectedFile && !arquivoPath) {
      setMsg({ type: 'error', text: 'Selecione um arquivo PDF para upload.' });
      return;
    }

    setSubmitting(true);
    try {
      let finalPath = arquivoPath;
      let finalNome = arquivoNome;
      let finalTamanho = tamanhoBytes;

      // Realiza upload do arquivo para o bucket academia-materiais
      if (selectedFile) {
        setUploadingFile(true);
        setUploadProgress('Enviando arquivo PDF para o Storage...');
        const timestamp = Date.now();
        const safeName = selectedFile.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        finalPath = `pdfs/${timestamp}_${safeName}`;

        const { error: uploadErr } = await supabase.storage
          .from('academia-materiais')
          .upload(finalPath, selectedFile, {
            cacheControl: '3600',
            upsert: false
          });

        if (uploadErr) {
          throw new Error('Falha no upload para o bucket academia-materiais: ' + uploadErr.message);
        }

        finalNome = selectedFile.name;
        finalTamanho = selectedFile.size;
        setUploadingFile(false);
      }

      setUploadProgress('Salvando registro do material...');
      const payload = {
        id: editingId || null,
        titulo: titulo.trim(),
        categoria,
        descricao: descricao.trim() || null,
        arquivo_path: finalPath,
        arquivo_nome: finalNome,
        tamanho_bytes: finalTamanho,
        total_paginas: totalPaginas || 0,
        permitir_download: permitirDownload,
        planos_permitidos: planosPermitidos,
        ordem,
        ativo
      };

      const { error } = await supabase.rpc('admin_salvar_material', {
        p_material: payload
      });

      if (error) throw error;

      setMsg({ 
        type: 'success', 
        text: editingId ? 'Material atualizado com sucesso!' : 'Novo material didático publicado com sucesso!' 
      });
      setShowModal(false);
      await fetchMateriais();
    } catch (err: any) {
      console.error('[AdminAbaMateriaisDidaticos] Erro ao salvar:', err);
      setMsg({ type: 'error', text: err.message || 'Erro ao salvar material.' });
    } finally {
      setSubmitting(false);
      setUploadingFile(false);
      setUploadProgress(null);
    }
  };

  const handleToggleAtivo = async (item: AcademiaMaterial) => {
    try {
      const payload = {
        id: item.id,
        titulo: item.titulo,
        categoria: item.categoria,
        descricao: item.descricao,
        arquivo_path: item.arquivo_path,
        arquivo_nome: item.arquivo_nome,
        tamanho_bytes: item.tamanho_bytes,
        total_paginas: item.total_paginas,
        permitir_download: item.permitir_download,
        planos_permitidos: item.planos_permitidos,
        ordem: item.ordem,
        ativo: !item.ativo
      };

      const { error } = await supabase.rpc('admin_salvar_material', {
        p_material: payload
      });

      if (error) throw error;
      setMateriais(prev => prev.map(m => m.id === item.id ? { ...m, ativo: !m.ativo } : m));
    } catch (err: any) {
      setMsg({ type: 'error', text: 'Erro ao alterar status: ' + err.message });
    }
  };

  const handleExcluir = async () => {
    if (!materialParaExcluir) return;
    setDeletando(true);
    try {
      const { error } = await supabase.rpc('admin_excluir_material', {
        p_material_id: materialParaExcluir.id
      });
      if (error) throw error;

      // Opcionalmente remove arquivo do storage
      if (materialParaExcluir.arquivo_path) {
        await supabase.storage
          .from('academia-materiais')
          .remove([materialParaExcluir.arquivo_path]);
      }

      setMsg({ type: 'success', text: 'Material excluído com sucesso!' });
      setMaterialParaExcluir(null);
      await fetchMateriais();
    } catch (err: any) {
      setMsg({ type: 'error', text: 'Erro ao excluir material: ' + err.message });
    } finally {
      setDeletando(false);
    }
  };

  const formatarTamanho = (bytes: number) => {
    if (!bytes) return '0 KB';
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const togglePlano = (p: string) => {
    setPlanosPermitidos(prev => 
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
    );
  };

  return (
    <div className="space-y-6">
      {/* Topo com Descrição e Ação */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-5 rounded-2xl">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <FileText className="text-amber-500 w-5 h-5" />
            <span>Materiais Didáticos, E-books & Manuais em PDF</span>
          </h2>
          <p className="text-slate-400 text-xs mt-1">
            Cadastre apostilas, e-books de precificação, tráfego pago e checklists. Defina se o material é blindado para leitura segura na plataforma ou liberado para download.
          </p>
        </div>

        <button
          onClick={openNewModal}
          disabled={isReadOnly}
          className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-xs transition flex items-center gap-2 shadow-lg shadow-amber-500/10 shrink-0 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Cadastrar Novo Material</span>
        </button>
      </div>

      {/* Dica de Compressão de Armazenamento do Supabase */}
      <div className="bg-gradient-to-r from-amber-500/10 via-slate-900 to-slate-900 border border-amber-500/30 rounded-xl p-4 text-xs text-slate-300 flex items-start gap-3 shadow-inner">
        <Sparkles className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <strong className="text-amber-300 font-bold block">
            Dica para economizar armazenamento no Supabase Storage:
          </strong>
          <p className="text-slate-400 leading-relaxed">
            PDFs exportados do Canva ou Illustrator costumam pesar entre 20MB e 50MB. Antes de fazer o upload, recomendamos passar o arquivo em ferramentas gratuitas como 
            {' '}<a href="https://www.ilovepdf.com/pt/comprimir_pdf" target="_blank" rel="noreferrer" className="text-amber-400 underline font-semibold">IlovePDF</a> ou 
            {' '}<a href="https://tinywow.com/tools/compress-pdf" target="_blank" rel="noreferrer" className="text-amber-400 underline font-semibold">TinyWow</a>. 
            Isso comprime o arquivo para <strong>1MB a 2MB</strong> com 100% de nitidez para leitura na tela!
          </p>
        </div>
      </div>

      {msg && (
        <div className={`p-4 rounded-xl text-xs font-medium border flex items-center justify-between ${
          msg.type === 'success' 
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
        }`}>
          <span>{msg.text}</span>
          <button onClick={() => setMsg(null)} className="text-xs opacity-70 hover:opacity-100">Fechar</button>
        </div>
      )}

      {/* Tabela de Materiais */}
      {loading ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-400">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500 mx-auto mb-3"></div>
          <p className="text-sm">Carregando catálogo de materiais...</p>
        </div>
      ) : materiais.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-500">
          <FileText className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-300">Nenhum material didático cadastrado</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
            Clique em "Cadastrar Novo Material" para subir seus primeiros e-books, guias de precificação ou checklists em PDF.
          </p>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th className="px-4 py-4 text-center">Ordem</th>
                  <th className="px-5 py-4">Material / Categoria</th>
                  <th className="px-4 py-4">Arquivo & Peso</th>
                  <th className="px-4 py-4">Modo de Acesso</th>
                  <th className="px-4 py-4">Planos Permitidos</th>
                  <th className="px-4 py-4 text-center">Engajamento</th>
                  <th className="px-4 py-4">Status</th>
                  <th className="px-5 py-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {materiais.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/40 transition">
                    <td className="px-4 py-4 text-center font-mono font-bold text-amber-400">
                      {item.ordem}
                    </td>

                    <td className="px-5 py-4">
                      <div>
                        <strong className="text-white text-sm block font-medium">
                          {item.titulo}
                        </strong>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] px-2 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700 font-medium">
                            {item.categoria}
                          </span>
                          {item.descricao && (
                            <span className="text-slate-400 text-[11px] truncate max-w-xs block">
                              {item.descricao}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-4 font-mono text-slate-300">
                      <div className="flex items-center gap-1.5">
                        <FileCheck className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span className="truncate max-w-[120px]" title={item.arquivo_nome}>
                          {item.arquivo_nome}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-500 block mt-0.5">
                        {formatarTamanho(item.tamanho_bytes)}
                      </span>
                    </td>

                    {/* Modo de Acesso (Seguro vs Download) */}
                    <td className="px-4 py-4">
                      {item.permitir_download ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px] font-semibold">
                          <Download className="w-3 h-3" /> Download Liberado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-[11px] font-semibold" title="Usuário só visualiza no leitor seguro com marca d'água forense">
                          <ShieldCheck className="w-3 h-3" /> Leitor Seguro (Anti-Cópia)
                        </span>
                      )}
                    </td>

                    {/* Planos Permitidos */}
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-1 flex-wrap font-mono text-[10px]">
                        {(item.planos_permitidos || []).map(p => (
                          <span key={p} className="px-1.5 py-0.5 rounded bg-slate-800 text-amber-400 border border-slate-700 uppercase font-bold">
                            {p}
                          </span>
                        ))}
                      </div>
                    </td>

                    {/* Métricas */}
                    <td className="px-4 py-4 text-center font-mono text-[11px]">
                      <span className="text-slate-300 block">{item.visualizacoes_count || 0} visualizações</span>
                      {item.permitir_download && (
                        <span className="text-emerald-400 text-[10px] block">{item.downloads_count || 0} downloads</span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-4">
                      <button
                        onClick={() => handleToggleAtivo(item)}
                        disabled={isReadOnly}
                        className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg border transition ${
                          item.ativo
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                            : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                        }`}
                      >
                        {item.ativo ? (
                          <>
                            <Check className="w-3 h-3" /> Ativo
                          </>
                        ) : (
                          <>
                            <X className="w-3 h-3" /> Pausado
                          </>
                        )}
                      </button>
                    </td>

                    {/* Ações */}
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setPreviewMaterial(item)}
                          className="p-1.5 rounded-lg bg-slate-800 text-cyan-400 hover:bg-slate-700 hover:text-cyan-300 transition"
                          title="Abrir no Leitor Seguro"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => openEditModal(item)}
                          disabled={isReadOnly}
                          className="p-1.5 rounded-lg bg-slate-800 text-amber-400 hover:bg-slate-700 hover:text-amber-300 transition"
                          title="Editar material"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setMaterialParaExcluir(item)}
                          disabled={isReadOnly}
                          className="p-1.5 rounded-lg bg-slate-800 text-rose-400 hover:bg-slate-700 hover:text-rose-300 transition"
                          title="Excluir material"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de Cadastro / Edição */}
      {showModal && createPortal(
        <div className="fixed inset-0 z-[100] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto overflow-x-hidden animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-5 sm:p-6 my-auto shadow-2xl relative animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto overflow-x-hidden">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-5">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <FileText className="text-amber-500 w-5 h-5 shrink-0" />
                <span>{editingId ? 'Editar Material Didático' : 'Cadastrar Novo Material Didático'}</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                disabled={submitting}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Título */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Título do Material: *
                </label>
                <input
                  type="text"
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  placeholder="Ex: Guia Completo de Precificação para Detailers"
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-amber-500"
                />
              </div>

              {/* Categoria e Ordem */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    Categoria:
                  </label>
                  <select
                    value={categoria}
                    onChange={(e) => setCategoria(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-amber-500"
                  >
                    {CATEGORIAS_MATERIAIS.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    Ordem de Exibição:
                  </label>
                  <input
                    type="number"
                    value={ordem}
                    onChange={(e) => setOrdem(parseInt(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              {/* Descrição */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Breve Descrição / O que o assinante aprenderá:
                </label>
                <textarea
                  rows={2}
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  placeholder="Resumo dos tópicos abordados no documento..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-white placeholder-slate-500 outline-none focus:border-amber-500"
                />
              </div>

              {/* Upload do Arquivo PDF */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 block">
                  Arquivo em PDF: *
                </label>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".pdf,application/pdf"
                  className="hidden"
                />

                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-700 hover:border-amber-500/60 bg-slate-950/60 rounded-xl p-4 text-center cursor-pointer transition group"
                >
                  <UploadCloud className="w-8 h-8 text-slate-400 group-hover:text-amber-400 mx-auto mb-1.5 transition" />
                  <p className="text-xs font-semibold text-slate-200 group-hover:text-amber-300">
                    {selectedFile 
                      ? selectedFile.name 
                      : arquivoNome 
                        ? `Arquivo Atual: ${arquivoNome}` 
                        : 'Clique para selecionar o arquivo PDF'}
                  </p>
                  <span className="text-[11px] text-slate-500 mt-0.5 block">
                    {selectedFile 
                      ? `Tamanho: ${formatarTamanho(selectedFile.size)}` 
                      : arquivoPath 
                        ? `Tamanho salvo: ${formatarTamanho(tamanhoBytes)}` 
                        : 'Formato suportado: .PDF'}
                  </span>
                </div>
              </div>

              {/* Bloco de Proteção Anti-Cópia vs Download */}
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-amber-400" />
                    Política de Acesso e Proteção de Conteúdo:
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  <label 
                    onClick={() => setPermitirDownload(false)}
                    className={`p-3 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
                      !permitirDownload 
                        ? 'bg-cyan-500/10 border-cyan-500 text-cyan-300' 
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Lock className="w-4 h-4 text-cyan-400 shrink-0" />
                      <strong className="text-xs">🔒 Leitor Seguro (DRM)</strong>
                    </div>
                    <p className="text-[10px] opacity-80 leading-relaxed">
                      Download e cópia bloqueados. Leitura apenas na plataforma com marca d'água forense.
                    </p>
                  </label>

                  <label 
                    onClick={() => setPermitirDownload(true)}
                    className={`p-3 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
                      permitirDownload 
                        ? 'bg-emerald-500/10 border-emerald-500 text-emerald-300' 
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Download className="w-4 h-4 text-emerald-400 shrink-0" />
                      <strong className="text-xs">📥 Download Liberado</strong>
                    </div>
                    <p className="text-[10px] opacity-80 leading-relaxed">
                      Assinante pode baixar o arquivo PDF completo para o computador ou imprimir.
                    </p>
                  </label>
                </div>
              </div>

              {/* Planos Permitidos */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  Planos com Acesso Liberado:
                </label>
                <div className="flex items-center gap-4 text-xs text-slate-300">
                  {['free', 'pro', 'studio'].map(p => (
                    <label key={p} className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={planosPermitidos.includes(p)}
                        onChange={() => togglePlano(p)}
                        className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-amber-500 focus:ring-0"
                      />
                      <span className="uppercase font-semibold text-slate-200">{p}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Ativo */}
              <div className="pt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={ativo}
                    onChange={(e) => setAtivo(e.target.checked)}
                    className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-amber-500 focus:ring-0"
                  />
                  <span>Disponível imediatamente para as oficinas (Ativo)</span>
                </label>
              </div>

              {uploadProgress && (
                <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 text-center animate-pulse">
                  {uploadProgress}
                </div>
              )}

              {/* Botões do Rodapé */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  disabled={submitting}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting || uploadingFile}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-slate-950 flex items-center gap-2 shadow-lg shadow-amber-500/20 disabled:opacity-50 shrink-0 transition"
                >
                  {submitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Processando...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>{editingId ? 'Salvar Alterações' : 'Publicar Material'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Modal de Exclusão */}
      {materialParaExcluir && createPortal(
        <div className="fixed inset-0 z-[100] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto overflow-x-hidden animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-6 text-center shadow-2xl my-auto">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center mx-auto mb-3">
              <Trash2 className="w-6 h-6 text-rose-400" />
            </div>
            <h3 className="text-base font-bold text-white">Excluir Material Didático</h3>
            <p className="text-xs text-slate-400 mt-1 mb-5">
              Tem certeza que deseja remover <strong>{materialParaExcluir.titulo}</strong>? O arquivo será despublicado imediatamente.
            </p>
            <div className="flex gap-2 justify-center">
              <button
                type="button"
                onClick={() => setMaterialParaExcluir(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleExcluir}
                disabled={deletando}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-50 transition"
              >
                {deletando ? 'Excluindo...' : 'Sim, Excluir'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Preview no Leitor Seguro */}
      {previewMaterial && (
        <LeitorSeguroMaterial
          material={previewMaterial}
          tenantNome="Detailers Admin (Visualização)"
          usuarioDocumento="ADMINISTRADOR"
          onClose={() => setPreviewMaterial(null)}
        />
      )}
    </div>
  );
};
