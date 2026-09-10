import React, { useEffect, useState } from 'react';
import { 
  Megaphone, 
  Plus, 
  Search, 
  CheckCircle2, 
  X, 
  Gift, 
  Ticket, 
  Sparkles, 
  Eye, 
  RefreshCw, 
  Trash2, 
  Edit3, 
  Calendar, 
  ExternalLink,
  Info,
  Clock,
  Radio,
  Award
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';

export interface ComunicadoItem {
  id: string;
  titulo: string;
  mensagem: string;
  tipo: 'aviso' | 'promocao' | 'brinde' | 'novidade' | 'alerta';
  badge_texto: string | null;
  cor_tema: 'amber' | 'emerald' | 'purple' | 'blue' | 'rose';
  imagem_url: string | null;
  acao_tipo: 'nenhuma' | 'link' | 'cupom' | 'brinde_dias' | 'brinde_custom';
  acao_label: string | null;
  acao_link: string | null;
  cupom_id: string | null;
  cupom_codigo: string | null;
  dias_bonus: number | null;
  publico_alvo: 'todos' | 'free' | 'pro' | 'studio';
  obrigatorio: boolean;
  ativo: boolean;
  data_inicio: string;
  data_fim: string | null;
  created_at: string;
  total_visualizacoes: number;
  total_resgates: number;
}

interface CupomOpcao {
  id: string;
  codigo: string;
  desconto_tipo: string;
  desconto_valor: number;
}

export const AdminComunicados: React.FC = () => {
  const { showSuccess, showError } = useToast();

  const [comunicados, setComunicados] = useState<ComunicadoItem[]>([]);
  const [cuponsDisponiveis, setCuponsDisponiveis] = useState<CupomOpcao[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [filtroTipo, setFiltroTipo] = useState<string>('todos');

  // Modal
  const [modalAberto, setModalAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [comunicadoEmEdicao, setComunicadoEmEdicao] = useState<ComunicadoItem | null>(null);

  // Formulário
  const [titulo, setTitulo] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [tipo, setTipo] = useState<'aviso' | 'promocao' | 'brinde' | 'novidade' | 'alerta'>('aviso');
  const [badgeTexto, setBadgeTexto] = useState('');
  const [corTema, setCorTema] = useState<'amber' | 'emerald' | 'purple' | 'blue' | 'rose'>('amber');
  const [imagemUrl, setImagemUrl] = useState('');
  const [acaoTipo, setAcaoTipo] = useState<'nenhuma' | 'link' | 'cupom' | 'brinde_dias' | 'brinde_custom'>('nenhuma');
  const [acaoLabel, setAcaoLabel] = useState('');
  const [acaoLink, setAcaoLink] = useState('');
  const [cupomId, setCupomId] = useState<string>('');
  const [diasBonus, setDiasBonus] = useState<string>('');
  const [publicoAlvo, setPublicoAlvo] = useState<'todos' | 'free' | 'pro' | 'studio'>('todos');
  const [obrigatorio, setObrigatorio] = useState(false);
  const [ativo, setAtivo] = useState(true);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');

  const carregarDados = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_listar_comunicados');
      if (error) throw error;
      setComunicados(data || []);

      // Carregar cupons ativos para o dropdown
      const { data: cuponsData } = await supabase
        .from('plataforma_cupons')
        .select('id, codigo, desconto_tipo, desconto_valor')
        .eq('ativo', true)
        .order('created_at', { ascending: false });
      if (cuponsData) setCuponsDisponiveis(cuponsData);
    } catch (err: any) {
      console.error('Erro ao listar comunicados:', err);
      showError(err.message || 'Erro ao carregar comunicados.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarDados();
  }, []);

  const handleToggleAtivo = async (comunicado: ComunicadoItem) => {
    try {
      const { error } = await supabase.rpc('admin_toggle_comunicado', {
        p_id: comunicado.id,
        p_ativo: !comunicado.ativo,
      });
      if (error) throw error;
      setComunicados(prev => prev.map(c => c.id === comunicado.id ? { ...c, ativo: !comunicado.ativo } : c));
      showSuccess(`Comunicado ${!comunicado.ativo ? 'ativado para disparo' : 'pausado'}.`);
    } catch (err: any) {
      showError(err.message || 'Erro ao alterar status.');
    }
  };

  const handleExcluir = async (comunicado: ComunicadoItem) => {
    if (!confirm(`Deseja realmente excluir o comunicado "${comunicado.titulo}"?`)) return;
    try {
      const { error } = await supabase.rpc('admin_excluir_comunicado', { p_id: comunicado.id });
      if (error) throw error;
      setComunicados(prev => prev.filter(c => c.id !== comunicado.id));
      showSuccess('Comunicado excluído.');
    } catch (err: any) {
      showError(err.message || 'Erro ao excluir comunicado.');
    }
  };

  const abrirModalCriacao = () => {
    setComunicadoEmEdicao(null);
    setTitulo('');
    setMensagem('');
    setTipo('brinde');
    setBadgeTexto('🎁 PRESENTE DO DIA DO DETAILER');
    setCorTema('amber');
    setImagemUrl('');
    setAcaoTipo('brinde_dias');
    setAcaoLabel('Resgatar Meu Presente 🎁');
    setAcaoLink('');
    setCupomId('');
    setDiasBonus('15');
    setPublicoAlvo('todos');
    setObrigatorio(false);
    setAtivo(true);
    setDataInicio(new Date().toISOString().slice(0, 16));
    setDataFim('');
    setModalAberto(true);
  };

  const abrirModalEdicao = (c: ComunicadoItem) => {
    setComunicadoEmEdicao(c);
    setTitulo(c.titulo);
    setMensagem(c.mensagem);
    setTipo(c.tipo);
    setBadgeTexto(c.badge_texto || '');
    setCorTema(c.cor_tema);
    setImagemUrl(c.imagem_url || '');
    setAcaoTipo(c.acao_tipo);
    setAcaoLabel(c.acao_label || '');
    setAcaoLink(c.acao_link || '');
    setCupomId(c.cupom_id || '');
    setDiasBonus(c.dias_bonus ? String(c.dias_bonus) : '');
    setPublicoAlvo(c.publico_alvo);
    setObrigatorio(c.obrigatorio);
    setAtivo(c.ativo);
    setDataInicio(c.data_inicio ? c.data_inicio.slice(0, 16) : '');
    setDataFim(c.data_fim ? c.data_fim.slice(0, 16) : '');
    setModalAberto(true);
  };

  const salvarComunicado = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!titulo.trim() || !mensagem.trim()) {
      showError('Título e mensagem são obrigatórios.');
      return;
    }

    setSalvando(true);
    try {
      const payload = {
        p_id: comunicadoEmEdicao ? comunicadoEmEdicao.id : null,
        p_titulo: titulo.trim(),
        p_mensagem: mensagem.trim(),
        p_tipo: tipo,
        p_badge_texto: badgeTexto.trim() || null,
        p_cor_tema: corTema,
        p_imagem_url: imagemUrl.trim() || null,
        p_acao_tipo: acaoTipo,
        p_acao_label: acaoLabel.trim() || null,
        p_acao_link: acaoLink.trim() || null,
        p_cupom_id: (acaoTipo === 'cupom' && cupomId) ? cupomId : null,
        p_dias_bonus: (acaoTipo === 'brinde_dias' && diasBonus) ? parseInt(diasBonus, 10) : null,
        p_publico_alvo: publicoAlvo,
        p_obrigatorio: obrigatorio,
        p_ativo: ativo,
        p_data_inicio: dataInicio ? new Date(dataInicio).toISOString() : new Date().toISOString(),
        p_data_fim: dataFim ? new Date(dataFim).toISOString() : null,
      };

      const { error } = await supabase.rpc('admin_salvar_comunicado', payload);
      if (error) throw error;

      showSuccess(comunicadoEmEdicao ? 'Comunicado atualizado!' : 'Comunicado disparado com sucesso!');
      setModalAberto(false);
      carregarDados();
    } catch (err: any) {
      console.error('Erro ao salvar comunicado:', err);
      showError(err.message || 'Erro ao salvar comunicado.');
    } finally {
      setSalvando(false);
    }
  };

  // Cores CSS helper
  const getThemeClasses = (tema: string) => {
    switch (tema) {
      case 'emerald': return { bg: 'bg-emerald-500/10', border: 'border-emerald-500/40', text: 'text-emerald-400', button: 'bg-emerald-500 text-slate-950 hover:bg-emerald-400' };
      case 'purple': return { bg: 'bg-purple-500/10', border: 'border-purple-500/40', text: 'text-purple-400', button: 'bg-purple-500 text-white hover:bg-purple-400' };
      case 'blue': return { bg: 'bg-blue-500/10', border: 'border-blue-500/40', text: 'text-blue-400', button: 'bg-blue-500 text-white hover:bg-blue-400' };
      case 'rose': return { bg: 'bg-rose-500/10', border: 'border-rose-500/40', text: 'text-rose-400', button: 'bg-rose-500 text-white hover:bg-rose-400' };
      case 'amber':
      default: return { bg: 'bg-amber-500/10', border: 'border-amber-500/40', text: 'text-amber-400', button: 'bg-amber-500 text-slate-950 hover:bg-amber-400' };
    }
  };

  const comunicadosFiltrados = comunicados.filter(c => {
    const matchBusca = c.titulo.toLowerCase().includes(busca.toLowerCase()) || c.mensagem.toLowerCase().includes(busca.toLowerCase());
    if (filtroTipo !== 'todos') return matchBusca && c.tipo === filtroTipo;
    return matchBusca;
  });

  const totalAtivos = comunicados.filter(c => c.ativo).length;
  const totalViews = comunicados.reduce((acc, c) => acc + (c.total_visualizacoes || 0), 0);
  const totalResgates = comunicados.reduce((acc, c) => acc + (c.total_resgates || 0), 0);

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center space-x-2">
            <Megaphone className="w-6 h-6 text-amber-500" />
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-wide">
              QUADRO DE AVISOS & BANNERS
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Dispare banners e pop-ups globais com promoções, presentes do Dia do Detailer e novidades para os usuários.
          </p>
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <button
            onClick={carregarDados}
            disabled={loading}
            className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white transition disabled:opacity-50"
            title="Atualizar lista"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={abrirModalCriacao}
            className="flex-1 sm:flex-none flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs tracking-wider uppercase shadow-lg shadow-amber-500/20 transition transform active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>Novo Comunicado / Brinde</span>
          </button>
        </div>
      </div>

      {/* Cards de Métricas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Criados</span>
            <Megaphone className="w-4 h-4 text-amber-400" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl sm:text-3xl font-black text-white font-mono">{comunicados.length}</span>
            <span className="text-xs text-amber-400 font-semibold">{totalAtivos} ativos</span>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Campanhas no Ar</span>
            <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono">{totalAtivos}</span>
            <span className="text-xs text-slate-500">Exibindo aos tenants</span>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Visualizações</span>
            <Eye className="w-4 h-4 text-blue-400" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl sm:text-3xl font-black text-white font-mono">{totalViews}</span>
            <span className="text-xs text-blue-400 font-semibold">Oficinas impactadas</span>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Brindes Resgatados</span>
            <Gift className="w-4 h-4 text-purple-400" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl sm:text-3xl font-black text-purple-300 font-mono">{totalResgates}</span>
            <span className="text-xs text-purple-400 font-semibold">Presentes entregues</span>
          </div>
        </div>
      </div>

      {/* Barra de Filtros */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-900/60 border border-slate-800 p-3 rounded-2xl">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por título ou mensagem..."
            value={busca}
            onChange={e => setBusca(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
          />
        </div>

        <div className="flex items-center space-x-1.5 w-full sm:w-auto overflow-x-auto scrollbar-none">
          {['todos', 'brinde', 'promocao', 'novidade', 'aviso'].map((t) => (
            <button
              key={t}
              onClick={() => setFiltroTipo(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition shrink-0 ${
                filtroTipo === t
                  ? 'bg-amber-500 text-slate-950 font-bold shadow'
                  : 'text-slate-400 hover:text-white bg-slate-950 border border-slate-800'
              }`}
            >
              {t === 'todos' ? 'Todos' : t}
            </button>
          ))}
        </div>
      </div>

      {/* Lista de Comunicados */}
      {loading ? (
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 font-mono text-sm">
          Carregando avisos e banners...
        </div>
      ) : comunicadosFiltrados.length === 0 ? (
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-12 text-center">
          <Megaphone className="w-12 h-12 text-slate-600 mx-auto mb-3 opacity-50" />
          <h3 className="text-base font-bold text-white mb-1">Nenhum aviso configurado</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto mb-4">
            Crie seu primeiro comunicado ou brinde para surpreender os detailers assim que acessarem o sistema.
          </p>
          <button
            onClick={abrirModalCriacao}
            className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs uppercase"
          >
            <Plus className="w-4 h-4" />
            <span>Criar Comunicado</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {comunicadosFiltrados.map((comunicado) => {
            const theme = getThemeClasses(comunicado.cor_tema);

            return (
              <div
                key={comunicado.id}
                className={`relative bg-slate-900/90 border rounded-2xl p-5 flex flex-col justify-between transition ${
                  !comunicado.ativo 
                    ? 'border-slate-800 opacity-60' 
                    : `${theme.border} shadow-lg shadow-black/20`
                }`}
              >
                <div>
                  {/* Topo do Card */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {comunicado.badge_texto && (
                        <span className={`text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full border ${theme.bg} ${theme.border} ${theme.text}`}>
                          {comunicado.badge_texto}
                        </span>
                      )}
                      <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                        {comunicado.tipo.toUpperCase()}
                      </span>
                      <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-slate-800/80 text-slate-400">
                        Alvo: {comunicado.publico_alvo.toUpperCase()}
                      </span>
                    </div>

                    <div className="flex items-center space-x-1 shrink-0">
                      <button
                        onClick={() => abrirModalEdicao(comunicado)}
                        className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
                        title="Editar"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleExcluir(comunicado)}
                        className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition"
                        title="Excluir"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Título & Mensagem */}
                  <h3 className="text-base font-black text-white mb-2 leading-tight">
                    {comunicado.titulo}
                  </h3>
                  <p className="text-xs text-slate-300 whitespace-pre-line line-clamp-3 mb-4">
                    {comunicado.mensagem}
                  </p>

                  {/* Banner / Imagem se houver */}
                  {comunicado.imagem_url && (
                    <div className="mb-4 rounded-xl overflow-hidden border border-slate-800 max-h-36">
                      <img 
                        src={comunicado.imagem_url} 
                        alt="Banner" 
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                      />
                    </div>
                  )}

                  {/* Configuração de Ação */}
                  {comunicado.acao_tipo !== 'nenhuma' && (
                    <div className={`p-3 rounded-xl border mb-4 flex items-center justify-between ${theme.bg} ${theme.border}`}>
                      <div className="flex items-center space-x-2">
                        {comunicado.acao_tipo === 'brinde_dias' && <Gift className={`w-4 h-4 ${theme.text}`} />}
                        {comunicado.acao_tipo === 'cupom' && <Ticket className={`w-4 h-4 ${theme.text}`} />}
                        {comunicado.acao_tipo === 'link' && <ExternalLink className={`w-4 h-4 ${theme.text}`} />}
                        <span className="text-xs font-bold text-white">
                          {comunicado.acao_label || 'Ação configurada'}
                        </span>
                      </div>

                      {comunicado.dias_bonus && (
                        <span className="text-xs font-mono font-bold text-amber-400">
                          +{comunicado.dias_bonus} dias Pro
                        </span>
                      )}
                      {comunicado.cupom_codigo && (
                        <span className="text-xs font-mono font-black text-amber-400 bg-amber-500/20 px-2 py-0.5 rounded border border-amber-500/30">
                          {comunicado.cupom_codigo}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Rodapé: Métricas de Alcance & Status */}
                <div className="border-t border-slate-800/80 pt-3 flex items-center justify-between">
                  <div className="flex items-center space-x-3 text-xs text-slate-400">
                    <span className="flex items-center space-x-1" title="Visualizações">
                      <Eye className="w-3.5 h-3.5 text-blue-400" />
                      <span className="font-mono font-bold text-slate-200">{comunicado.total_visualizacoes}</span>
                    </span>
                    {comunicado.acao_tipo !== 'nenhuma' && (
                      <span className="flex items-center space-x-1" title="Resgates realizados">
                        <Gift className="w-3.5 h-3.5 text-purple-400" />
                        <span className="font-mono font-bold text-slate-200">{comunicado.total_resgates}</span>
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() => handleToggleAtivo(comunicado)}
                    className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-semibold border transition ${
                      comunicado.ativo
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                        : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${comunicado.ativo ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                    <span>{comunicado.ativo ? 'No Ar' : 'Pausado'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de Criação / Edição */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md">
          <div className="bg-slate-900 border border-amber-500/30 rounded-3xl w-full max-w-4xl shadow-2xl relative flex flex-col max-h-[90vh] overflow-hidden">
            {/* Faixa Iluminada de Topo */}
            <div className="h-1.5 w-full bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600 shrink-0" />

            {/* Cabeçalho Fixo */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0 bg-slate-900/90">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
                  <Megaphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white uppercase tracking-wide">
                    {comunicadoEmEdicao ? 'Editar Comunicado / Brinde' : 'Criar Novo Comunicado Global'}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Configure os dados do aviso, presente ou promoção que será exibido aos detailers.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setModalAberto(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Formulário com Corpo Rolável */}
            <form onSubmit={salvarComunicado} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-6 overflow-y-auto flex-1 space-y-5">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  {/* COLUNA ESQUERDA: Mensagem & Visual */}
                  <div className="space-y-4">
                    <div className="border-b border-slate-800 pb-2">
                      <span className="text-xs font-black text-amber-400 uppercase tracking-wider">
                        1. Conteúdo e Visual
                      </span>
                    </div>

                    {/* Tipo e Cor do Tema */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1">
                          Tipo do Comunicado
                        </label>
                        <select
                          value={tipo}
                          onChange={e => {
                            const novoTipo = e.target.value as any;
                            setTipo(novoTipo);
                            if (novoTipo === 'brinde') {
                              setBadgeTexto('🎁 PRESENTE EXCLUSIVO DO DIA DO DETAILER');
                              setAcaoTipo('brinde_dias');
                              setAcaoLabel('Resgatar Meu Presente 🎁');
                              setDiasBonus('15');
                            } else if (novoTipo === 'promocao') {
                              setBadgeTexto('🔥 OFERTA LIMITADA');
                              setAcaoTipo('cupom');
                              setAcaoLabel('Aproveitar Desconto 🏷️');
                            }
                          }}
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                        >
                          <option value="brinde">Brinde / Presente 🎁</option>
                          <option value="promocao">Promoção / Desconto 🔥</option>
                          <option value="novidade">Novidade ✨</option>
                          <option value="aviso">Aviso / Notícia 📢</option>
                          <option value="alerta">Alerta Importante ⚠️</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1">
                          Cor de Destaque
                        </label>
                        <select
                          value={corTema}
                          onChange={e => setCorTema(e.target.value as any)}
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                        >
                          <option value="amber">Âmbar (Dourado)</option>
                          <option value="emerald">Esmeralda (Verde)</option>
                          <option value="purple">Roxo VIP</option>
                          <option value="blue">Azul Tecnologia</option>
                          <option value="rose">Rubro Alerta</option>
                        </select>
                      </div>
                    </div>

                    {/* Badge de Topo */}
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1">
                        Badge de Topo (Opcional)
                      </label>
                      <input
                        type="text"
                        placeholder="Ex: 🎁 PRESENTE DO DIA DO DETAILER"
                        value={badgeTexto}
                        onChange={e => setBadgeTexto(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                      />
                    </div>

                    {/* Título */}
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1">
                        Título Principal *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Ex: Parabéns Detailer! Você ganhou 15 dias de Plano Pro grátis"
                        value={titulo}
                        onChange={e => setTitulo(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs font-bold text-white focus:outline-none focus:border-amber-500"
                      />
                    </div>

                    {/* Mensagem */}
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1">
                        Mensagem Completa *
                      </label>
                      <textarea
                        required
                        rows={4}
                        placeholder="Descreva a mensagem ou detalhes do presente com clareza..."
                        value={mensagem}
                        onChange={e => setMensagem(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                      />
                    </div>

                    {/* Banner Imagem URL */}
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1">
                        URL da Imagem / Banner (Opcional)
                      </label>
                      <input
                        type="url"
                        placeholder="https://exemplo.com/banner.jpg"
                        value={imagemUrl}
                        onChange={e => setImagemUrl(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>

                  {/* COLUNA DIREITA: Ação / Resgate & Envio */}
                  <div className="space-y-4">
                    <div className="border-b border-slate-800 pb-2">
                      <span className="text-xs font-black text-amber-400 uppercase tracking-wider">
                        2. Ação de Resgate e Envio
                      </span>
                    </div>

                    {/* Bloco de Ação / Resgate */}
                    <div className="bg-slate-950/80 border border-slate-800 p-4 rounded-2xl space-y-3">
                      <div className="text-[11px] font-bold text-amber-400 uppercase tracking-wider flex items-center space-x-1.5">
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Configurar Botão / Resgate</span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                            Tipo de Ação
                          </label>
                          <select
                            value={acaoTipo}
                            onChange={e => setAcaoTipo(e.target.value as any)}
                            className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                          >
                            <option value="nenhuma">Apenas ler e fechar</option>
                            <option value="brinde_dias">Dias Bônus Pro (+Dias)</option>
                            <option value="cupom">Cupom de Desconto</option>
                            <option value="link">Abrir Link</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                            Texto do Botão
                          </label>
                          <input
                            type="text"
                            placeholder="Ex: Resgatar Presente 🎁"
                            value={acaoLabel}
                            onChange={e => setAcaoLabel(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                          />
                        </div>
                      </div>

                      {/* Sub-configurações específicas */}
                      {acaoTipo === 'brinde_dias' && (
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                            Dias Bônus a Creditar *
                          </label>
                          <input
                            type="number"
                            required
                            min="1"
                            placeholder="Ex: 15"
                            value={diasBonus}
                            onChange={e => setDiasBonus(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono font-bold text-amber-400 focus:outline-none focus:border-amber-500"
                          />
                        </div>
                      )}

                      {acaoTipo === 'cupom' && (
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                            Selecionar Cupom Cadastrado *
                          </label>
                          <select
                            value={cupomId}
                            onChange={e => setCupomId(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                          >
                            <option value="">Selecione um cupom ativo...</option>
                            {cuponsDisponiveis.map(c => (
                              <option key={c.id} value={c.id}>
                                {c.codigo} — {c.desconto_tipo === 'percentual' ? `${c.desconto_valor}% OFF` : `R$ ${c.desconto_valor} OFF`}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {acaoTipo === 'link' && (
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                            URL de Destino *
                          </label>
                          <input
                            type="text"
                            placeholder="Ex: /planos ou https://..."
                            value={acaoLink}
                            onChange={e => setAcaoLink(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                          />
                        </div>
                      )}
                    </div>

                    {/* Segmentação & Datas */}
                    <div className="bg-slate-950/80 border border-slate-800 p-4 rounded-2xl space-y-3">
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                          Público-Alvo
                        </label>
                        <select
                          value={publicoAlvo}
                          onChange={e => setPublicoAlvo(e.target.value as any)}
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                        >
                          <option value="todos">Todas as Oficinas</option>
                          <option value="free">Apenas Plano Free</option>
                          <option value="pro">Apenas Plano Pro</option>
                          <option value="studio">Apenas Plano Studio</option>
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                            Início da Exibição
                          </label>
                          <input
                            type="datetime-local"
                            value={dataInicio}
                            onChange={e => setDataInicio(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                            Fim da Exibição
                          </label>
                          <input
                            type="datetime-local"
                            value={dataFim}
                            onChange={e => setDataFim(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Checkboxes de Ativação */}
                    <div className="space-y-2 pt-1">
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id="comunicadoAtivo"
                          checked={ativo}
                          onChange={e => setAtivo(e.target.checked)}
                          className="rounded border-slate-700 bg-slate-950 text-amber-500 focus:ring-amber-500 w-4 h-4"
                        />
                        <label htmlFor="comunicadoAtivo" className="text-xs text-slate-300 font-semibold cursor-pointer">
                          Disparo Imediato (Colocar no ar agora)
                        </label>
                      </div>

                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id="comunicadoObrigatorio"
                          checked={obrigatorio}
                          onChange={e => setObrigatorio(e.target.checked)}
                          className="rounded border-slate-700 bg-slate-950 text-amber-500 focus:ring-amber-500 w-4 h-4"
                        />
                        <label htmlFor="comunicadoObrigatorio" className="text-xs text-slate-300 font-semibold cursor-pointer">
                          Exigir confirmação de leitura (sem botão X)
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Rodapé Fixo */}
              <div className="flex items-center justify-end space-x-3 px-6 py-4 border-t border-slate-800 bg-slate-900/90 shrink-0">
                <button
                  type="button"
                  onClick={() => setModalAberto(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs uppercase tracking-wider shadow-lg shadow-amber-500/20 transition disabled:opacity-50"
                >
                  {salvando ? 'Salvando...' : comunicadoEmEdicao ? 'Salvar Alterações' : 'Disparar Comunicado'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
