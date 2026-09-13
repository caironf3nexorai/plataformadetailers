import React, { useEffect, useState } from 'react';
import { 
  Rocket, 
  Plus, 
  Search, 
  Copy, 
  Edit3, 
  Users, 
  X, 
  Check,
  RefreshCw,
  Share2,
  Calendar,
  ExternalLink,
  Power
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';

export interface CampanhaItem {
  id: string;
  codigo: string;
  nome: string;
  plano: 'pro' | 'studio';
  plano_nome: string;
  dias_trial: number;
  limite_usos: number | null;
  total_usos: number;
  valido_ate: string | null;
  ativo: boolean;
  titulo_destaque: string | null;
  descricao: string | null;
  beneficios: string[] | null;
  created_at: string;
  expirado: boolean;
  esgotado: boolean;
}

export const AdminCampanhas: React.FC = () => {
  const { showSuccess, showError } = useToast();

  const [campanhas, setCampanhas] = useState<CampanhaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<'todas' | 'ativas' | 'inativas'>('todas');
  const [copiadoId, setCopiadoId] = useState<string | null>(null);

  // Modal de Criação / Edição
  const [modalAberto, setModalAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [campanhaEmEdicao, setCampanhaEmEdicao] = useState<CampanhaItem | null>(null);

  // Campos do formulário
  const [nome, setNome] = useState('');
  const [codigo, setCodigo] = useState('');
  const [plano, setPlano] = useState<'pro' | 'studio'>('pro');
  const [diasTrial, setDiasTrial] = useState<number>(30);
  const [limiteUsos, setLimiteUsos] = useState<string>('');
  const [validoAte, setValidoAte] = useState<string>('');
  const [tituloDestaque, setTituloDestaque] = useState('');
  const [descricao, setDescricao] = useState('');
  const [beneficiosTexto, setBeneficiosTexto] = useState('');
  const [ativo, setAtivo] = useState(true);

  // Previne rolagem de fundo no modal
  useEffect(() => {
    if (modalAberto) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [modalAberto]);

  const carregarCampanhas = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_listar_campanhas_lancamento');
      if (error) throw error;
      setCampanhas((data as CampanhaItem[]) || []);
    } catch (err: any) {
      console.error('Erro ao carregar campanhas:', err);
      showError(err.message || 'Erro ao listar campanhas de lançamento.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarCampanhas();
  }, []);

  const abrirModalNovo = () => {
    setCampanhaEmEdicao(null);
    setNome('');
    setCodigo('');
    setPlano('pro');
    setDiasTrial(30);
    setLimiteUsos('');
    setValidoAte('');
    setTituloDestaque('');
    setDescricao('');
    setBeneficiosTexto('');
    setAtivo(true);
    setModalAberto(true);
  };

  const abrirModalEditar = (c: CampanhaItem) => {
    setCampanhaEmEdicao(c);
    setNome(c.nome);
    setCodigo(c.codigo);
    setPlano(c.plano);
    setDiasTrial(c.dias_trial);
    setLimiteUsos(c.limite_usos ? String(c.limite_usos) : '');
    setValidoAte(c.valido_ate ? c.valido_ate.split('T')[0] : '');
    setTituloDestaque(c.titulo_destaque || '');
    setDescricao(c.descricao || '');
    setBeneficiosTexto((c.beneficios || []).join('\n'));
    setAtivo(c.ativo);
    setModalAberto(true);
  };

  const handleSalvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) {
      showError('Informe o nome da campanha.');
      return;
    }
    if (!codigo.trim()) {
      showError('Informe o código do link da campanha.');
      return;
    }

    setSalvando(true);
    try {
      const arrayBeneficios = beneficiosTexto
        .split('\n')
        .map((b) => b.trim())
        .filter((b) => b.length > 0);

      const payload = {
        p_id: campanhaEmEdicao ? campanhaEmEdicao.id : null,
        p_codigo: codigo.trim().toUpperCase(),
        p_nome: nome.trim(),
        p_plano: plano,
        p_dias_trial: Number(diasTrial) || 30,
        p_limite_usos: limiteUsos ? parseInt(limiteUsos, 10) : null,
        p_valido_ate: validoAte ? new Date(`${validoAte}T23:59:59`).toISOString() : null,
        p_ativo: ativo,
        p_titulo_destaque: tituloDestaque.trim() || null,
        p_descricao: descricao.trim() || null,
        p_beneficios: arrayBeneficios,
      };

      const { error } = await supabase.rpc('admin_salvar_campanha_lancamento', payload);
      if (error) throw error;

      showSuccess(
        campanhaEmEdicao
          ? 'Campanha atualizada com sucesso!'
          : 'Campanha de lançamento criada com sucesso!'
      );
      setModalAberto(false);
      carregarCampanhas();
    } catch (err: any) {
      console.error('Erro ao salvar campanha:', err);
      showError(err.message || 'Erro ao salvar campanha.');
    } finally {
      setSalvando(false);
    }
  };

  const handleToggleAtivo = async (c: CampanhaItem) => {
    try {
      const novoStatus = !c.ativo;
      const { error } = await supabase.rpc('admin_toggle_campanha_lancamento', {
        p_id: c.id,
        p_ativo: novoStatus,
      });
      if (error) throw error;

      setCampanhas((prev) =>
        prev.map((item) => (item.id === c.id ? { ...item, ativo: novoStatus } : item))
      );
      showSuccess(novoStatus ? `Campanha ${c.codigo} reativada!` : `Campanha ${c.codigo} pausada.`);
    } catch (err: any) {
      showError(err.message || 'Erro ao alterar status da campanha.');
    }
  };

  const obterUrlCampanha = (cod: string) => {
    return `${window.location.origin}/lancamento/${cod}`;
  };

  const handleCopiarLink = (cod: string, id: string) => {
    const url = obterUrlCampanha(cod);
    navigator.clipboard.writeText(url);
    setCopiadoId(id);
    showSuccess(`Link ${cod} copiado para a área de transferência!`);
    setTimeout(() => setCopiadoId(null), 2500);
  };

  const handleCompartilharWhatsApp = (c: CampanhaItem) => {
    const url = obterUrlCampanha(c.codigo);
    const planoFormatado = c.plano === 'studio' ? 'Studio' : 'Pro';
    const texto = `Fala amigo! 🚀 Consegui um acesso exclusivo para você testar o *NuvemWash* (Plataforma de Gestão e Vistorias para Estética Automotiva) com *${c.dias_trial} dias grátis no Plano ${planoFormatado}*!\n\nSem precisar de cartão de crédito. Acesse pelo link exclusivo de lançamento:\n${url}`;
    const urlWpp = `https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}`;
    window.open(urlWpp, '_blank');
  };

  // Filtragem local
  const campanhasFiltradas = campanhas.filter((c) => {
    const matchBusca =
      c.nome.toLowerCase().includes(busca.toLowerCase()) ||
      c.codigo.toLowerCase().includes(busca.toLowerCase());

    if (!matchBusca) return false;

    if (filtroStatus === 'ativas') return c.ativo && !c.expirado && !c.esgotado;
    if (filtroStatus === 'inativas') return !c.ativo || c.expirado || c.esgotado;
    return true;
  });

  // Métricas
  const totalCampanhas = campanhas.length;
  const ativasCount = campanhas.filter((c) => c.ativo && !c.expirado && !c.esgotado).length;
  const totalCadastros = campanhas.reduce((acc, c) => acc + (c.total_usos || 0), 0);
  const totalVagas = campanhas.reduce((acc, c) => acc + (c.limite_usos || 0), 0);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12 font-sans">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2.5">
            <Rocket className="w-7 h-7 text-amber-500" />
            <span>Links de Campanha & Lançamento</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Gere links promocionais com dias de teste (trial) e planos personalizados para campanhas de lançamento.
          </p>
        </div>

        <button
          onClick={abrirModalNovo}
          className="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-sm transition-all shadow-lg flex items-center justify-center gap-2 shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Nova Campanha de Lançamento</span>
        </button>
      </div>

      {/* Cards de Métricas */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex flex-col gap-1">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Campanhas Ativas</span>
          <span className="text-2xl font-mono font-black text-amber-400">{ativasCount} / {totalCampanhas}</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex flex-col gap-1">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Oficinas Convertidas</span>
          <span className="text-2xl font-mono font-black text-emerald-400">{totalCadastros}</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex flex-col gap-1">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Vagas Ofertadas</span>
          <span className="text-2xl font-mono font-black text-slate-100">
            {totalVagas > 0 ? totalVagas : 'Ilimitadas'}
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex flex-col gap-1">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Taxa de Adesão</span>
          <span className="text-2xl font-mono font-black text-blue-400">
            {totalVagas > 0 ? `${Math.round((totalCadastros / totalVagas) * 100)}%` : 'Ativa'}
          </span>
        </div>
      </div>

      {/* Barra de Filtros & Busca */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-900 p-3 rounded-2xl border border-slate-800">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por nome ou código..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:border-amber-500 outline-none"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setFiltroStatus('todas')}
              className={`px-3 py-1 rounded-lg font-medium transition ${
                filtroStatus === 'todas' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              Todas ({campanhas.length})
            </button>
            <button
              onClick={() => setFiltroStatus('ativas')}
              className={`px-3 py-1 rounded-lg font-medium transition ${
                filtroStatus === 'ativas' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              Ativas ({ativasCount})
            </button>
            <button
              onClick={() => setFiltroStatus('inativas')}
              className={`px-3 py-1 rounded-lg font-medium transition ${
                filtroStatus === 'inativas' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              Inativas
            </button>
          </div>

          <button
            onClick={carregarCampanhas}
            className="p-2 bg-slate-950 border border-slate-800 hover:bg-slate-800 text-slate-300 rounded-xl transition"
            title="Atualizar lista"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Lista de Campanhas */}
      {loading ? (
        <div className="py-20 text-center text-slate-400 font-mono text-sm">Carregando campanhas de lançamento...</div>
      ) : campanhasFiltradas.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center max-w-lg mx-auto">
          <Rocket className="w-12 h-12 text-amber-500/40 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-white mb-1">Nenhuma campanha encontrada</h3>
          <p className="text-xs text-slate-400 mb-6">
            Crie sua primeira campanha para gerar um link personalizado com dias de teste para o lançamento da plataforma.
          </p>
          <button
            onClick={abrirModalNovo}
            className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-xs transition inline-flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Criar Nova Campanha</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {campanhasFiltradas.map((c) => {
            const isAtiva = c.ativo && !c.expirado && !c.esgotado;
            const linkUrl = obterUrlCampanha(c.codigo);
            const percentUso = c.limite_usos ? Math.min(100, Math.round((c.total_usos / c.limite_usos) * 100)) : 0;

            return (
              <div
                key={c.id}
                className={`bg-slate-900 border rounded-3xl p-5 sm:p-6 flex flex-col justify-between gap-5 transition-all relative overflow-hidden shadow-lg ${
                  isAtiva
                    ? 'border-slate-800 hover:border-amber-500/40'
                    : 'border-slate-850 opacity-75 bg-slate-900/60'
                }`}
              >
                <div>
                  {/* Top Bar: Badges & Status */}
                  <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-black px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        /{c.codigo}
                      </span>
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider ${
                        c.plano === 'studio'
                          ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                          : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                      }`}>
                        Plano {c.plano_nome.toUpperCase()}
                      </span>
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        {c.dias_trial} Dias Grátis
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {isAtiva ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          Ativa
                        </span>
                      ) : c.esgotado ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full border border-rose-500/20">
                          Esgotada
                        </span>
                      ) : c.expirado ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full border border-slate-700">
                          Expirada
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full border border-slate-700">
                          Pausada
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Nome da Campanha */}
                  <h3 className="text-base font-bold text-white mb-1.5">{c.nome}</h3>
                  {c.descricao && (
                    <p className="text-xs text-slate-400 line-clamp-2 mb-3 leading-relaxed">
                      {c.descricao}
                    </p>
                  )}

                  {/* Detalhes de Vagas e Validade */}
                  <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-850 flex flex-col gap-2 mt-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-amber-400" />
                        Cadastros Realizados:
                      </span>
                      <span className="font-mono font-bold text-white">
                        {c.total_usos} {c.limite_usos ? `/ ${c.limite_usos} vagas` : 'oficinas'}
                      </span>
                    </div>

                    {c.limite_usos && (
                      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            percentUso >= 90 ? 'bg-rose-500' : 'bg-gradient-to-r from-amber-500 to-emerald-400'
                          }`}
                          style={{ width: `${percentUso}%` }}
                        />
                      </div>
                    )}

                    <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-850/80">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-slate-500" />
                        Validade:
                      </span>
                      <span className="font-mono text-slate-300">
                        {c.valido_ate ? new Date(c.valido_ate).toLocaleDateString('pt-BR') : 'Indeterminada'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Ações e Compartilhamento */}
                <div className="pt-3 border-t border-slate-800/80 flex flex-col gap-2.5">
                  {/* Link Preview Bar */}
                  <div className="flex items-center justify-between bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 gap-2">
                    <span className="font-mono text-[11px] text-amber-400 truncate select-all">
                      {linkUrl}
                    </span>
                    <a
                      href={linkUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1 hover:text-white text-slate-400 transition"
                      title="Testar link no navegador"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>

                  {/* Action Buttons Row */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleCopiarLink(c.codigo, c.id)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                          copiadoId === c.id
                            ? 'bg-emerald-500 text-slate-950'
                            : 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-md'
                        }`}
                      >
                        {copiadoId === c.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiadoId === c.id ? 'Copiado!' : 'Copiar Link'}</span>
                      </button>

                      <button
                        onClick={() => handleCompartilharWhatsApp(c)}
                        className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 transition flex items-center gap-1.5 cursor-pointer"
                        title="Enviar convite direto no WhatsApp"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">WhatsApp</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleToggleAtivo(c)}
                        className={`p-1.5 rounded-lg border transition ${
                          c.ativo
                            ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                            : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                        }`}
                        title={c.ativo ? 'Pausar campanha' : 'Reativar campanha'}
                      >
                        <Power className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => abrirModalEditar(c)}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
                        title="Editar campanha"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de Criação / Edição */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-xl w-full p-6 shadow-2xl max-h-[90vh] overflow-y-auto space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Rocket className="w-5 h-5 text-amber-500" />
                <span>{campanhaEmEdicao ? 'Editar Campanha de Lançamento' : 'Nova Campanha de Lançamento'}</span>
              </h2>
              <button
                onClick={() => setModalAberto(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSalvar} className="space-y-4">
              {/* Nome da Campanha */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Nome da Campanha *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Lançamento VIP WhatsApp Grupo 1"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:border-amber-500 outline-none"
                />
              </div>

              {/* Código / Slug do Link */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Código do Link (URL) *
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-slate-500 bg-slate-950 px-3 py-2.5 rounded-xl border border-slate-800 shrink-0">
                    /lancamento/
                  </span>
                  <input
                    type="text"
                    required
                    placeholder="VIP30"
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs font-mono font-bold text-amber-400 uppercase placeholder-slate-500 focus:border-amber-500 outline-none"
                  />
                </div>
                <span className="text-[11px] text-slate-500 mt-1 block">
                  Link gerado: {window.location.origin}/lancamento/{codigo || 'CODIGO'}
                </span>
              </div>

              {/* Plano Concedido */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Plano Concedido para Degustação *
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setPlano('pro')}
                    className={`p-3 rounded-2xl border text-left transition flex flex-col gap-1 cursor-pointer ${
                      plano === 'pro'
                        ? 'bg-amber-500/10 border-amber-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <span className="font-bold text-xs">Plano PRO</span>
                    <span className="text-[11px] opacity-80">Ideal para a maioria das oficinas</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPlano('studio')}
                    className={`p-3 rounded-2xl border text-left transition flex flex-col gap-1 cursor-pointer ${
                      plano === 'studio'
                        ? 'bg-purple-500/10 border-purple-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <span className="font-bold text-xs">Plano STUDIO</span>
                    <span className="text-[11px] opacity-80">Acesso ilimitado e DRE financeiro</span>
                  </button>
                </div>
              </div>

              {/* Dias de Degustação (Trial) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                    Dias de Teste Grátis (Trial) *
                  </label>
                  <span className="text-xs font-mono font-bold text-emerald-400">
                    {diasTrial} dias
                  </span>
                </div>

                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="number"
                    min="1"
                    max="365"
                    required
                    value={diasTrial}
                    onChange={(e) => setDiasTrial(parseInt(e.target.value, 10) || 1)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs font-mono text-white focus:border-amber-500 outline-none"
                  />
                </div>

                {/* Presets rápidos */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] text-slate-500 mr-1">Atalhos:</span>
                  {[14, 21, 30, 45, 60, 90].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDiasTrial(d)}
                      className={`px-2 py-0.5 rounded text-[11px] font-mono transition ${
                        diasTrial === d
                          ? 'bg-amber-500 text-slate-950 font-bold'
                          : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
              </div>

              {/* Limite de Vagas e Validade */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Limite de Vagas (Opcional)
                  </label>
                  <input
                    type="number"
                    min="1"
                    placeholder="Vazio = Ilimitado"
                    value={limiteUsos}
                    onChange={(e) => setLimiteUsos(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:border-amber-500 outline-none font-mono"
                  />
                  <span className="text-[10px] text-slate-500 mt-1 block">Ex: 50 oficinas</span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Data Limite (Opcional)
                  </label>
                  <input
                    type="date"
                    value={validoAte}
                    onChange={(e) => setValidoAte(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:border-amber-500 outline-none font-mono"
                  />
                  <span className="text-[10px] text-slate-500 mt-1 block">Vazio = Sem expiração</span>
                </div>
              </div>

              {/* Título e Descrição Opcionais para a Página */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Título de Destaque na Página (Opcional)
                </label>
                <input
                  type="text"
                  placeholder="Ex: Você ganhou 30 dias de Degustação VIP no Plano Pro!"
                  value={tituloDestaque}
                  onChange={(e) => setTituloDestaque(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:border-amber-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Benefícios em Destaque (1 por linha)
                </label>
                <textarea
                  rows={3}
                  placeholder="Vistorias com assinatura digital&#10;Agendamento online integrado&#10;DRE e cálculo de margem real"
                  value={beneficiosTexto}
                  onChange={(e) => setBeneficiosTexto(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:border-amber-500 outline-none"
                />
              </div>

              {/* Status Ativo */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="campanhaAtiva"
                  checked={ativo}
                  onChange={(e) => setAtivo(e.target.checked)}
                  className="rounded border-slate-800 text-amber-500 focus:ring-0 w-4 h-4 bg-slate-950"
                />
                <label htmlFor="campanhaAtiva" className="text-xs text-slate-300 select-none cursor-pointer">
                  Campanha ativa e recebendo cadastros imediatamente
                </label>
              </div>

              {/* Botoes de Ação */}
              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setModalAberto(false)}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={salvando}
                  className="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-50 text-slate-950 font-bold px-5 py-2.5 rounded-xl text-xs transition shadow-lg flex items-center gap-2 cursor-pointer"
                >
                  {salvando ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <span>Salvar Campanha</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
