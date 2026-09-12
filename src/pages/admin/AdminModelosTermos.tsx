import React, { useEffect, useState, useRef } from 'react';
import { 
  FileText, 
  Plus, 
  Search, 
  CheckCircle2, 
  Edit3, 
  Trash2, 
  Sparkles, 
  UploadCloud, 
  Download, 
  Check, 
  X, 
  RefreshCw, 
  Scale,
  ShieldCheck,
  Eye,
  FileCode
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { Modal } from '../../components/ui/Modal';
import { ModalConfirmacao } from '../../components/ui/ModalConfirmacao';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { TIPOS_TERMOS_GARANTIA } from '../../types/termos';
import type { PlataformaModeloTermo } from '../../types/termos';

export const AdminModelosTermos: React.FC = () => {
  const { showSuccess, showError } = useToast();

  const [modelos, setModelos] = useState<PlataformaModeloTermo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [filtroCategoria, setFiltroCategoria] = useState<'todas' | 'responsabilidade' | 'garantia'>('todas');
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'ativos' | 'inativos'>('todos');

  // Modal de Criação / Edição
  const [modalAberto, setModalAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [modeloEmEdicao, setModeloEmEdicao] = useState<PlataformaModeloTermo | null>(null);

  // Campos do formulário
  const [titulo, setTitulo] = useState('');
  const [categoria, setCategoria] = useState<'responsabilidade' | 'garantia'>('responsabilidade');
  const [tipoServico, setTipoServico] = useState<string>('geral');
  const [descricao, setDescricao] = useState('');
  const [conteudoTexto, setConteudoTexto] = useState('');
  const [destaque, setDestaque] = useState(false);
  const [ativo, setAtivo] = useState(true);
  const [permitirDownload, setPermitirDownload] = useState(true);

  // Arquivo anexo (.docx / .pdf)
  const [arquivoUrl, setArquivoUrl] = useState<string | null>(null);
  const [arquivoNome, setArquivoNome] = useState<string | null>(null);
  const [arquivoTipo, setArquivoTipo] = useState<string | null>(null);
  const [arquivoTamanhoBytes, setArquivoTamanhoBytes] = useState<number | null>(null);
  const [arquivoUpload, setArquivoUpload] = useState<File | null>(null);
  const [uploadandoArquivo, setUploadandoArquivo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Modal de Exclusão
  const [modeloParaExcluir, setModeloParaExcluir] = useState<PlataformaModeloTermo | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  // Modal de Pré-Visualização Rápida
  const [modeloVisualizando, setModeloVisualizando] = useState<PlataformaModeloTermo | null>(null);

  const carregarDados = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_listar_modelos_termos');
      if (error) throw error;
      setModelos(data || []);
    } catch (err: any) {
      console.error('Erro ao carregar modelos de termos:', err);
      showError(err.message || 'Erro ao carregar modelos de termos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarDados();
  }, []);

  const abrirModalNovo = () => {
    setModeloEmEdicao(null);
    setTitulo('');
    setCategoria('responsabilidade');
    setTipoServico('geral');
    setDescricao('');
    setConteudoTexto('');
    setDestaque(false);
    setAtivo(true);
    setPermitirDownload(true);
    setArquivoUrl(null);
    setArquivoNome(null);
    setArquivoTipo(null);
    setArquivoTamanhoBytes(null);
    setArquivoUpload(null);
    setModalAberto(true);
  };

  const abrirModalEditar = (item: PlataformaModeloTermo) => {
    setModeloEmEdicao(item);
    setTitulo(item.titulo);
    setCategoria(item.categoria);
    setTipoServico(item.tipo_servico || 'geral');
    setDescricao(item.descricao || '');
    setConteudoTexto(item.conteudo_texto);
    setDestaque(item.destaque);
    setAtivo(item.ativo !== false);
    setPermitirDownload(item.permitir_download !== false);
    setArquivoUrl(item.arquivo_url || null);
    setArquivoNome(item.arquivo_nome || null);
    setArquivoTipo(item.arquivo_tipo || null);
    setArquivoTamanhoBytes(item.arquivo_tamanho_bytes || null);
    setArquivoUpload(null);
    setModalAberto(true);
  };

  const handleSelecionarArquivo = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      if (!['docx', 'doc', 'pdf'].includes(ext)) {
        showError('Formato inválido. Por favor, envie arquivos Word (.docx) ou PDF.');
        return;
      }
      setArquivoUpload(file);
      setArquivoNome(file.name);
      setArquivoTipo(ext === 'pdf' ? 'pdf' : 'docx');
      setArquivoTamanhoBytes(file.size);
    }
  };

  const handleRemoverArquivo = () => {
    setArquivoUpload(null);
    setArquivoUrl(null);
    setArquivoNome(null);
    setArquivoTipo(null);
    setArquivoTamanhoBytes(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSalvarModelo = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!titulo.trim()) {
      showError('Informe o título do modelo.');
      return;
    }

    if (!conteudoTexto.trim()) {
      showError('Informe o conteúdo em texto com as cláusulas do termo.');
      return;
    }

    setSalvando(true);
    try {
      let finalArquivoUrl = arquivoUrl;
      let finalArquivoNome = arquivoNome;
      let finalArquivoTipo = arquivoTipo;
      let finalArquivoTamanho = arquivoTamanhoBytes;

      // Se houver novo arquivo selecionado para upload
      if (arquivoUpload) {
        setUploadandoArquivo(true);
        const timestamp = Date.now();
        const safeName = arquivoUpload.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const caminho = `arquivos/${timestamp}_${safeName}`;

        const { error: uploadError } = await supabase.storage
          .from('modelos-termos')
          .upload(caminho, arquivoUpload, {
            cacheControl: '3600',
            upsert: false
          });

        if (uploadError) {
          console.warn('Erro no upload para bucket modelos-termos:', uploadError);
          // Continua permitindo salvar o texto mesmo que o arquivo falhe, mas avisa
          showError('Falha no upload do arquivo anexo: ' + uploadError.message);
        } else {
          const { data: publicUrlData } = supabase.storage
            .from('modelos-termos')
            .getPublicUrl(caminho);

          finalArquivoUrl = publicUrlData.publicUrl;
          finalArquivoNome = arquivoUpload.name;
          finalArquivoTipo = arquivoUpload.name.split('.').pop()?.toLowerCase() || 'docx';
          finalArquivoTamanho = arquivoUpload.size;
        }
        setUploadandoArquivo(false);
      }

      const { error } = await supabase.rpc('admin_salvar_modelo_termo', {
        p_id: modeloEmEdicao ? modeloEmEdicao.id : null,
        p_titulo: titulo.trim(),
        p_categoria: categoria,
        p_tipo_servico: categoria === 'garantia' ? tipoServico : null,
        p_descricao: descricao.trim() || null,
        p_conteudo_texto: conteudoTexto.trim(),
        p_arquivo_url: finalArquivoUrl,
        p_arquivo_nome: finalArquivoNome,
        p_arquivo_tipo: finalArquivoTipo,
        p_arquivo_tamanho_bytes: finalArquivoTamanho,
        p_destaque: destaque,
        p_ativo: ativo,
        p_permitir_download: permitirDownload
      });

      if (error) throw error;

      showSuccess(modeloEmEdicao ? 'Modelo atualizado com sucesso!' : 'Novo modelo de termo cadastrado!');
      setModalAberto(false);
      await carregarDados();
    } catch (err: any) {
      console.error('Erro ao salvar modelo de termo:', err);
      showError(err.message || 'Erro ao salvar modelo de termo.');
    } finally {
      setSalvando(false);
      setUploadandoArquivo(false);
    }
  };

  const handleToggleAtivo = async (item: PlataformaModeloTermo) => {
    const novoStatus = !(item.ativo !== false);
    try {
      const { error } = await supabase.rpc('admin_toggle_modelo_termo', {
        p_id: item.id,
        p_ativo: novoStatus
      });
      if (error) throw error;

      setModelos((prev) =>
        prev.map((m) => (m.id === item.id ? { ...m, ativo: novoStatus } : m))
      );
      showSuccess(`Modelo ${novoStatus ? 'ativado' : 'pausado'} com sucesso.`);
    } catch (err: any) {
      console.error('Erro ao alterar status:', err);
      showError(err.message || 'Erro ao alterar status do modelo.');
    }
  };

  const handleConfirmarExclusao = async () => {
    if (!modeloParaExcluir) return;
    setExcluindo(true);
    try {
      const { error } = await supabase.rpc('admin_excluir_modelo_termo', {
        p_id: modeloParaExcluir.id
      });
      if (error) throw error;

      showSuccess('Modelo de termo excluído.');
      setModeloParaExcluir(null);
      await carregarDados();
    } catch (err: any) {
      console.error('Erro ao excluir:', err);
      showError(err.message || 'Erro ao excluir modelo.');
    } finally {
      setExcluindo(false);
    }
  };

  // Métricas
  const totalModelos = modelos.length;
  const modelosAtivos = modelos.filter((m) => m.ativo !== false).length;
  const totalDownloads = modelos.reduce((acc, m) => acc + (m.downloads_count || 0), 0);
  const totalAplicacoes = modelos.reduce((acc, m) => acc + (m.aplicacoes_count || 0), 0);

  // Filtragem
  const modelosFiltrados = modelos.filter((item) => {
    if (filtroCategoria !== 'todas' && item.categoria !== filtroCategoria) return false;
    if (filtroStatus === 'ativos' && item.ativo === false) return false;
    if (filtroStatus === 'inativos' && item.ativo !== false) return false;

    if (busca.trim()) {
      const query = busca.toLowerCase();
      const bateTitulo = item.titulo.toLowerCase().includes(query);
      const bateDesc = (item.descricao || '').toLowerCase().includes(query);
      const bateTexto = item.conteudo_texto.toLowerCase().includes(query);
      const bateTipo = (item.tipo_servico || '').toLowerCase().includes(query);
      return bateTitulo || bateDesc || bateTexto || bateTipo;
    }
    return true;
  });

  const formatarTamanho = (bytes: number | null) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 sm:p-3 bg-amber-500/10 text-amber-400 rounded-xl border border-amber-500/20 shadow-inner">
            <Scale className="w-6 h-6 sm:w-7 sm:h-7" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-heading font-black text-xl sm:text-2xl text-slate-100 tracking-tight">
                Biblioteca de Modelos de Termos
              </h1>
              <span className="hidden sm:inline-block px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                SUGESTÕES JURÍDICAS
              </span>
            </div>
            <p className="font-sans text-xs sm:text-sm text-slate-400 mt-0.5">
              Gerencie modelos recomendados de responsabilidade e garantia com download em Word/PDF e aplicação em 1-clique para os detailers.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={carregarDados}
            disabled={loading}
            className="text-xs h-10 px-3 bg-slate-900 border-slate-800 text-slate-300 hover:text-white"
            title="Recarregar dados"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>

          <Button
            type="button"
            variant="primary"
            onClick={abrirModalNovo}
            className="text-xs font-bold h-10 px-4 flex items-center gap-2 bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-950 shadow-lg shadow-amber-500/10"
          >
            <Plus className="w-4 h-4" />
            <span>Novo Modelo de Termo</span>
          </Button>
        </div>
      </div>

      {/* Cards de Métricas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium uppercase tracking-wider">Total de Modelos</span>
            <FileText className="w-4 h-4 text-amber-400" />
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black font-mono text-slate-100">{totalModelos}</span>
            <span className="text-[11px] text-slate-400 ml-2 font-mono">cadastrados</span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium uppercase tracking-wider">Modelos Ativos</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black font-mono text-emerald-400">{modelosAtivos}</span>
            <span className="text-[11px] text-slate-400 ml-2 font-mono">visíveis às oficinas</span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium uppercase tracking-wider">Downloads Word/PDF</span>
            <Download className="w-4 h-4 text-sky-400" />
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black font-mono text-sky-400">{totalDownloads}</span>
            <span className="text-[11px] text-slate-400 ml-2 font-mono">arquivos baixados</span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium uppercase tracking-wider">Aplicações 1-Clique</span>
            <Sparkles className="w-4 h-4 text-yellow-400" />
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black font-mono text-yellow-400">{totalAplicacoes}</span>
            <span className="text-[11px] text-slate-400 ml-2 font-mono">oficinas equipadas</span>
          </div>
        </div>
      </div>

      {/* Barra de Filtros e Busca */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Buscar por título, serviço ou cláusulas..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500/60"
          />
          {busca && (
            <button
              onClick={() => setBusca('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          {/* Categoria */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setFiltroCategoria('todas')}
              className={`px-2.5 py-1.5 rounded-md text-xs font-semibold transition ${
                filtroCategoria === 'todas'
                  ? 'bg-amber-500 text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Todas
            </button>
            <button
              type="button"
              onClick={() => setFiltroCategoria('responsabilidade')}
              className={`px-2.5 py-1.5 rounded-md text-xs font-semibold transition ${
                filtroCategoria === 'responsabilidade'
                  ? 'bg-amber-500 text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Responsabilidade
            </button>
            <button
              type="button"
              onClick={() => setFiltroCategoria('garantia')}
              className={`px-2.5 py-1.5 rounded-md text-xs font-semibold transition ${
                filtroCategoria === 'garantia'
                  ? 'bg-amber-500 text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Garantias
            </button>
          </div>

          {/* Status */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setFiltroStatus('todos')}
              className={`px-2.5 py-1.5 rounded-md text-xs font-semibold transition ${
                filtroStatus === 'todos'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Status: Todos
            </button>
            <button
              type="button"
              onClick={() => setFiltroStatus('ativos')}
              className={`px-2 py-1.5 rounded-md text-xs font-semibold transition ${
                filtroStatus === 'ativos'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Ativos
            </button>
            <button
              type="button"
              onClick={() => setFiltroStatus('inativos')}
              className={`px-2 py-1.5 rounded-md text-xs font-semibold transition ${
                filtroStatus === 'inativos'
                  ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Pausados
            </button>
          </div>
        </div>
      </div>

      {/* Lista de Modelos */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-48 rounded-xl bg-slate-900 border border-slate-800 animate-pulse" />
          ))}
        </div>
      ) : modelosFiltrados.length === 0 ? (
        <div className="text-center py-16 px-4 rounded-xl bg-slate-900/40 border border-slate-800 flex flex-col items-center justify-center gap-3">
          <div className="p-3 bg-slate-800/80 rounded-full text-slate-500">
            <Scale className="w-8 h-8" />
          </div>
          <h3 className="font-heading font-bold text-slate-200 text-base">
            Nenhum modelo de termo encontrado
          </h3>
          <p className="text-xs text-slate-400 max-w-md">
            {busca
              ? 'Nenhum resultado corresponde à sua busca ou filtros selecionados.'
              : 'Comece adicionando modelos de responsabilidade ou garantia para que as oficinas possam utilizar na rotina de detalhamento.'}
          </p>
          <Button
            type="button"
            variant="primary"
            onClick={abrirModalNovo}
            className="text-xs font-bold mt-2"
          >
            Cadastrar Primeiro Modelo
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {modelosFiltrados.map((item) => {
            const rotuloServico =
              item.categoria === 'garantia'
                ? TIPOS_TERMOS_GARANTIA.find((t) => t.tipo === item.tipo_servico)?.label ||
                  item.tipo_servico ||
                  'Geral'
                : null;

            return (
              <div
                key={item.id}
                className={`rounded-xl border p-5 flex flex-col justify-between gap-4 transition shadow-lg ${
                  item.ativo === false
                    ? 'bg-slate-950/60 border-slate-800/60 opacity-75'
                    : 'bg-slate-900/90 border-slate-800 hover:border-slate-700'
                }`}
              >
                {/* Header do Card */}
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {/* Badge Categoria */}
                      <span
                        className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${
                          item.categoria === 'responsabilidade'
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                            : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30'
                        }`}
                      >
                        {item.categoria === 'responsabilidade' ? 'Responsabilidade & Pátio' : 'Termo de Garantia'}
                      </span>

                      {/* Badge Serviço se houver */}
                      {rotuloServico && (
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                          {rotuloServico}
                        </span>
                      )}

                      {/* Selo de Destaque */}
                      {item.destaque && (
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-300 border border-yellow-500/30 flex items-center gap-1">
                          <Sparkles className="w-2.5 h-2.5" />
                          Recomendado Juridicamente
                        </span>
                      )}

                      {/* Selo de Download / Proteção */}
                      {item.permitir_download !== false ? (
                        <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                          <Download className="w-2.5 h-2.5" /> Download Liberado
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 flex items-center gap-1">
                          <ShieldCheck className="w-2.5 h-2.5" /> Apenas Plataforma
                        </span>
                      )}
                    </div>

                    {/* Switch Ativo / Inativo */}
                    <button
                      type="button"
                      onClick={() => handleToggleAtivo(item)}
                      className={`text-xs px-2 py-0.5 rounded font-mono font-semibold flex items-center gap-1 transition ${
                        item.ativo !== false
                          ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}
                      title="Clique para alternar ativação"
                    >
                      {item.ativo !== false ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span>Ativo</span>
                        </>
                      ) : (
                        <>
                          <X className="w-3 h-3 text-slate-400" />
                          <span>Pausado</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Título & Descrição */}
                  <div>
                    <h3 className="text-base font-bold text-slate-100 tracking-tight leading-snug">
                      {item.titulo}
                    </h3>
                    {item.descricao && (
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed line-clamp-2">
                        {item.descricao}
                      </p>
                    )}
                  </div>

                  {/* Prévia do Conteúdo das Cláusulas */}
                  <div className="bg-slate-950/80 rounded-lg p-3 border border-slate-800/80">
                    <p className="text-xs text-slate-300 font-sans leading-relaxed line-clamp-3 whitespace-pre-line">
                      {item.conteudo_texto}
                    </p>
                    <button
                      type="button"
                      onClick={() => setModeloVisualizando(item)}
                      className="mt-2 text-[11px] font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-1"
                    >
                      <Eye className="w-3 h-3" />
                      <span>Ver Cláusulas Completas</span>
                    </button>
                  </div>

                  {/* Arquivo Anexado (Word / PDF) */}
                  {item.arquivo_url ? (
                    <div className="flex items-center justify-between bg-slate-950/60 p-2.5 rounded-lg border border-slate-800 text-xs">
                      <div className="flex items-center gap-2 truncate">
                        <div className="p-1.5 bg-amber-500/10 text-amber-400 rounded">
                          <FileText className="w-4 h-4 shrink-0" />
                        </div>
                        <div className="truncate">
                          <span className="font-medium text-slate-200 truncate block">
                            {item.arquivo_nome || 'Documento Original'}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono uppercase">
                            {item.arquivo_tipo || 'ARQUIVO'} • {formatarTamanho(item.arquivo_tamanho_bytes)}
                          </span>
                        </div>
                      </div>

                      <a
                        href={item.arquivo_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 text-slate-400 hover:text-amber-400 transition"
                        title="Baixar ou abrir arquivo original"
                      >
                        <Download className="w-4 h-4" />
                      </a>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400 italic">
                      <FileCode className="w-3.5 h-3.5" />
                      <span>Sem arquivo Word/PDF anexado (apenas cláusulas em texto)</span>
                    </div>
                  )}
                </div>

                {/* Footer do Card */}
                <div className="flex items-center justify-between pt-3 border-t border-slate-800/80 text-xs">
                  {/* Métricas de Uso */}
                  <div className="flex items-center gap-3 text-slate-400 text-[11px] font-mono">
                    <span title="Downloads do arquivo original">
                      📥 <strong className="text-slate-200">{item.downloads_count || 0}</strong> downloads
                    </span>
                    <span title="Oficinas que aplicaram este termo em 1 clique">
                      ✨ <strong className="text-slate-200">{item.aplicacoes_count || 0}</strong> oficinas
                    </span>
                  </div>

                  {/* Ações */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => abrirModalEditar(item)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition"
                      title="Editar Modelo"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setModeloParaExcluir(item)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition"
                      title="Excluir Modelo"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de Criação / Edição */}
      <Modal
        isOpen={modalAberto}
        onClose={() => !salvando && setModalAberto(false)}
        title={modeloEmEdicao ? 'Editar Modelo de Termo' : 'Cadastrar Modelo de Termo'}
        maxWidth="2xl"
        icon={<Scale className="text-amber-400" size={22} />}
      >
        <form onSubmit={handleSalvarModelo} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Categoria */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
                Categoria do Termo:
              </label>
              <select
                value={categoria}
                onChange={(e) => setCategoria(e.target.value as any)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-100 font-sans text-sm outline-none focus:border-amber-500"
              >
                <option value="responsabilidade">Termo de Responsabilidade & Isenção</option>
                <option value="garantia">Termo de Garantia Específico de Serviço</option>
              </select>
            </div>

            {/* Tipo de Serviço (se garantia) */}
            {categoria === 'garantia' ? (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
                  Especialidade / Serviço:
                </label>
                <select
                  value={tipoServico}
                  onChange={(e) => setTipoServico(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-100 font-sans text-sm outline-none focus:border-amber-500"
                >
                  {TIPOS_TERMOS_GARANTIA.map((t) => (
                    <option key={t.tipo} value={t.tipo}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
                  Escopo de Aplicação:
                </label>
                <div className="p-2.5 bg-slate-900/60 border border-slate-800 rounded-lg text-xs text-amber-400 font-medium">
                  Fixo em 100% dos Orçamentos, Check-in e Vistorias
                </div>
              </div>
            )}
          </div>

          {/* Título */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
              Título do Modelo:
            </label>
            <Input
              type="text"
              placeholder="Ex: Garantia Técnica para Vitrificação Automotiva"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              required
              className="min-h-[42px]"
            />
          </div>

          {/* Descrição Curta */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
              Resumo / Orientações para a Oficina (Opcional):
            </label>
            <Input
              type="text"
              placeholder="Ex: Abrange regras de cura inicial de 7 dias, lavagens com pH neutro e revisões semestrais."
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              className="min-h-[40px]"
            />
          </div>

          {/* Upload de Arquivo Word (.docx) ou PDF */}
          <div className="flex flex-col gap-1.5 p-3.5 bg-slate-900/80 rounded-xl border border-slate-800">
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wide flex items-center justify-between">
              <span>Arquivo Original Word (.docx) ou PDF:</span>
              <span className="text-[11px] text-slate-400 font-normal">Disponível para download pelos clientes</span>
            </label>

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleSelecionarArquivo}
              accept=".docx,.doc,.pdf,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
            />

            {arquivoNome || arquivoUpload ? (
              <div className="flex items-center justify-between bg-slate-950 p-2.5 rounded-lg border border-slate-700">
                <div className="flex items-center gap-2 truncate">
                  <div className="p-1.5 bg-amber-500/10 text-amber-400 rounded">
                    <FileText className="w-4 h-4 shrink-0" />
                  </div>
                  <div className="truncate">
                    <span className="font-medium text-xs text-slate-200 truncate block">
                      {arquivoNome}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono uppercase">
                      {arquivoTipo || 'ARQUIVO'} • {formatarTamanho(arquivoTamanhoBytes)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs px-2 py-1 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition"
                  >
                    Substituir
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoverArquivo}
                    className="p-1 text-slate-400 hover:text-rose-400 rounded transition"
                    title="Remover arquivo"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-slate-700 hover:border-amber-500/60 rounded-lg transition bg-slate-950/40 group"
              >
                <UploadCloud className="w-6 h-6 text-slate-400 group-hover:text-amber-400 transition mb-1" />
                <span className="text-xs font-semibold text-slate-300 group-hover:text-amber-400">
                  Clique para anexar documento Word (.docx) ou PDF
                </span>
                <span className="text-[11px] text-slate-400 mt-0.5">
                  Tamanho máximo recomendado: 15MB
                </span>
              </button>
            )}
          </div>

          {/* Conteúdo em Texto das Cláusulas */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
                Cláusulas Completas do Termo (Texto Formatado):
              </label>
              <span className="text-[11px] font-mono text-slate-400">
                {conteudoTexto.length} caracteres
              </span>
            </div>
            <textarea
              rows={7}
              placeholder="Insira as cláusulas completas aqui. Este texto é o que será aplicado na oficina do detailer em 1 clique..."
              value={conteudoTexto}
              onChange={(e) => setConteudoTexto(e.target.value)}
              required
              className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-slate-100 placeholder-slate-500 font-sans text-xs leading-relaxed outline-none focus:border-amber-500"
            />
          </div>

          {/* Controle de Download vs Uso Exclusivo na Plataforma */}
          <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <span className="text-xs font-semibold text-slate-200 block">
                Permissão de Download pelo Assinante:
              </span>
              <span className="text-[11px] text-slate-400 block mt-0.5">
                {permitirDownload 
                  ? '📥 O assinante pode baixar o arquivo Word/PDF para seu computador.'
                  : '🔒 Exclusivo da plataforma: o assinante só pode aplicar/preencher na oficina (download desativado).'}
              </span>
            </div>

            <label className="flex items-center gap-2 cursor-pointer select-none shrink-0 bg-slate-900 border border-slate-700 px-3 py-1.5 rounded-lg hover:border-amber-500/50 transition">
              <input
                type="checkbox"
                checked={permitirDownload}
                onChange={(e) => setPermitirDownload(e.target.checked)}
                className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-amber-500 focus:ring-0"
              />
              <span className="text-xs font-bold text-amber-400">
                {permitirDownload ? 'Download Liberado' : 'Apenas Plataforma'}
              </span>
            </label>
          </div>

          {/* Checkboxes de Status e Destaque */}
          <div className="flex flex-wrap items-center gap-6 pt-1">
            <label className="flex items-center gap-2 text-xs font-sans text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={destaque}
                onChange={(e) => setDestaque(e.target.checked)}
                className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0"
              />
              <span className="font-semibold text-yellow-300 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" />
                Marcar como "Recomendado Juridicamente" (Destaque no topo)
              </span>
            </label>

            <label className="flex items-center gap-2 text-xs font-sans text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={ativo}
                onChange={(e) => setAtivo(e.target.checked)}
                className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0"
              />
              <span>Disponível para as Oficinas (Ativo)</span>
            </label>
          </div>

          {/* Botões do Rodapé */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModalAberto(false)}
              disabled={salvando || uploadandoArquivo}
              className="text-xs h-10 px-4"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={salvando || uploadandoArquivo}
              className="text-xs font-bold h-10 px-5 flex items-center gap-2 bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-950 shadow"
            >
              {salvando || uploadandoArquivo ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Salvando...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>{modeloEmEdicao ? 'Salvar Alterações' : 'Cadastrar Modelo'}</span>
                </>
              )}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal de Pré-Visualização Completa */}
      {modeloVisualizando && (
        <Modal
          isOpen={Boolean(modeloVisualizando)}
          onClose={() => setModeloVisualizando(null)}
          title={modeloVisualizando.titulo}
          maxWidth="lg"
          icon={<Eye className="text-amber-400" size={22} />}
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase">
                {modeloVisualizando.categoria}
              </span>
              {modeloVisualizando.tipo_servico && (
                <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  {modeloVisualizando.tipo_servico}
                </span>
              )}
            </div>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 max-h-[50vh] overflow-y-auto">
              <p className="text-xs text-slate-200 font-sans leading-relaxed whitespace-pre-line">
                {modeloVisualizando.conteudo_texto}
              </p>
            </div>

            {modeloVisualizando.arquivo_url && (
              <div className="flex items-center justify-between p-3 bg-slate-900 rounded-lg border border-slate-800">
                <span className="text-xs text-slate-300 font-medium">
                  {modeloVisualizando.arquivo_nome || 'Arquivo anexo original'}
                </span>
                <a
                  href={modeloVisualizando.arquivo_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-bold px-3 py-1.5 bg-amber-500 text-slate-950 rounded-md hover:bg-amber-400 transition flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Baixar Arquivo</span>
                </a>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setModeloVisualizando(null)}
                className="text-xs h-9 px-4"
              >
                Fechar
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal de Confirmação para Exclusão */}
      <ModalConfirmacao
        isOpen={Boolean(modeloParaExcluir)}
        onClose={() => setModeloParaExcluir(null)}
        onConfirm={handleConfirmarExclusao}
        titulo="Excluir Modelo de Termo"
        mensagem={`Tem certeza que deseja remover o modelo "${modeloParaExcluir?.titulo}"? Esta ação é irreversível.`}
        textoConfirmar="Excluir Modelo"
        textoCancelar="Cancelar"
        variant="danger"
        loading={excluindo}
      />
    </div>
  );
};
