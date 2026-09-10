import React, { useEffect, useState } from 'react';
import { 
  Ticket, 
  Plus, 
  Search, 
  Filter, 
  CheckCircle2, 
  XCircle, 
  Copy, 
  Edit3, 
  Trash2, 
  Sparkles, 
  DollarSign, 
  Users, 
  Percent, 
  Calendar, 
  X, 
  Check,
  RefreshCw,
  Building
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';

export interface CupomItem {
  id: string;
  codigo: string;
  descricao: string | null;
  desconto_tipo: 'percentual' | 'valor_fixo';
  desconto_valor: number;
  plano_alvo: 'todos' | 'pro' | 'studio';
  duracao_meses: number;
  limite_usos: number | null;
  total_usos: number;
  ativo: boolean;
  origem: 'plataforma' | 'parceiro' | 'banner' | 'campanha';
  parceiro_id: string | null;
  parceiro_nome: string | null;
  valido_ate: string | null;
  created_at: string;
  total_desconto_concedido: number;
}

export const AdminCupons: React.FC = () => {
  const { showSuccess, showError } = useToast();

  const [cupons, setCupons] = useState<CupomItem[]>([]);
  const [parceiros, setParceiros] = useState<{ id: string; nome: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'ativos' | 'inativos'>('todos');
  const [copiadoId, setCopiadoId] = useState<string | null>(null);

  // Modal de Criação / Edição
  const [modalAberto, setModalAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [cupomEmEdicao, setCupomEmEdicao] = useState<CupomItem | null>(null);

  // Campos do formulário
  const [codigo, setCodigo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [descontoTipo, setDescontoTipo] = useState<'percentual' | 'valor_fixo'>('percentual');
  const [descontoValor, setDescontoValor] = useState<number>(10);
  const [planoAlvo, setPlanoAlvo] = useState<'todos' | 'pro' | 'studio'>('todos');
  const [duracaoMeses, setDuracaoMeses] = useState<number>(1);
  const [limiteUsos, setLimiteUsos] = useState<string>('');
  const [origem, setOrigem] = useState<'plataforma' | 'parceiro' | 'banner' | 'campanha'>('plataforma');
  const [parceiroId, setParceiroId] = useState<string>('');
  const [validoAte, setValidoAte] = useState<string>('');
  const [ativo, setAtivo] = useState(true);

  const carregarDados = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_listar_cupons');
      if (error) throw error;
      setCupons(data || []);

      // Carregar parceiros para o seletor
      const { data: parceirosData } = await supabase
        .from('parceiros')
        .select('id, nome')
        .eq('ativo', true)
        .order('nome');
      if (parceirosData) setParceiros(parceirosData);
    } catch (err: any) {
      console.error('Erro ao carregar cupons:', err);
      showError(err.message || 'Erro ao carregar lista de cupons.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarDados();
  }, []);

  const handleCopiarCodigo = (codigoStr: string, id: string) => {
    navigator.clipboard.writeText(codigoStr);
    setCopiadoId(id);
    showSuccess(`Código ${codigoStr} copiado!`);
    setTimeout(() => setCopiadoId(null), 2000);
  };

  const handleToggleAtivo = async (cupom: CupomItem) => {
    try {
      const { error } = await supabase.rpc('admin_toggle_cupom', {
        p_id: cupom.id,
        p_ativo: !cupom.ativo,
      });
      if (error) throw error;
      setCupons(prev => prev.map(c => c.id === cupom.id ? { ...c, ativo: !cupom.ativo } : c));
      showSuccess(`Cupom ${cupom.codigo} ${!cupom.ativo ? 'ativado' : 'desativado'} com sucesso.`);
    } catch (err: any) {
      showError(err.message || 'Erro ao alterar status do cupom.');
    }
  };

  const handleExcluir = async (cupom: CupomItem) => {
    if (!confirm(`Deseja realmente excluir o cupom ${cupom.codigo}? Esta ação é irreversível.`)) return;
    try {
      const { error } = await supabase.rpc('admin_excluir_cupom', { p_id: cupom.id });
      if (error) throw error;
      setCupons(prev => prev.filter(c => c.id !== cupom.id));
      showSuccess(`Cupom ${cupom.codigo} excluído.`);
    } catch (err: any) {
      showError(err.message || 'Erro ao excluir cupom.');
    }
  };

  const abrirModalCriacao = () => {
    setCupomEmEdicao(null);
    setCodigo('');
    setDescricao('');
    setDescontoTipo('percentual');
    setDescontoValor(20);
    setPlanoAlvo('todos');
    setDuracaoMeses(1);
    setLimiteUsos('');
    setOrigem('plataforma');
    setParceiroId('');
    setValidoAte('');
    setAtivo(true);
    setModalAberto(true);
  };

  const abrirModalEdicao = (cupom: CupomItem) => {
    setCupomEmEdicao(cupom);
    setCodigo(cupom.codigo);
    setDescricao(cupom.descricao || '');
    setDescontoTipo(cupom.desconto_tipo);
    setDescontoValor(cupom.desconto_valor);
    setPlanoAlvo(cupom.plano_alvo);
    setDuracaoMeses(cupom.duracao_meses);
    setLimiteUsos(cupom.limite_usos ? String(cupom.limite_usos) : '');
    setOrigem(cupom.origem);
    setParceiroId(cupom.parceiro_id || '');
    setValidoAte(cupom.valido_ate ? cupom.valido_ate.split('T')[0] : '');
    setAtivo(cupom.ativo);
    setModalAberto(true);
  };

  const gerarCodigoAleatorio = () => {
    const sufixos = ['PRO', 'VIP', 'OFF', 'WASH', 'TOP', 'START'];
    const prefixo = sufixos[Math.floor(Math.random() * sufixos.length)];
    const numero = Math.floor(10 + Math.random() * 90);
    setCodigo(`${prefixo}${numero}`);
  };

  const salvarCupom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codigo.trim()) {
      showError('O código do cupom é obrigatório.');
      return;
    }
    if (descontoValor <= 0) {
      showError('O valor do desconto deve ser maior que zero.');
      return;
    }

    setSalvando(true);
    try {
      const payload = {
        p_id: cupomEmEdicao ? cupomEmEdicao.id : null,
        p_codigo: codigo.trim().toUpperCase(),
        p_descricao: descricao.trim() || null,
        p_desconto_tipo: descontoTipo,
        p_desconto_valor: Number(descontoValor),
        p_plano_alvo: planoAlvo,
        p_duracao_meses: Number(duracaoMeses),
        p_limite_usos: limiteUsos ? parseInt(limiteUsos, 10) : null,
        p_ativo: ativo,
        p_origem: origem,
        p_parceiro_id: parceiroId || null,
        p_valido_ate: validoAte ? new Date(`${validoAte}T23:59:59`).toISOString() : null,
      };

      const { error } = await supabase.rpc('admin_salvar_cupom', payload);
      if (error) throw error;

      showSuccess(cupomEmEdicao ? 'Cupom atualizado com sucesso!' : 'Novo cupom criado com sucesso!');
      setModalAberto(false);
      carregarDados();
    } catch (err: any) {
      console.error('Erro ao salvar cupom:', err);
      showError(err.message || 'Erro ao salvar cupom.');
    } finally {
      setSalvando(false);
    }
  };

  // Filtros aplicados
  const cuponsFiltrados = cupons.filter(c => {
    const matchBusca = 
      c.codigo.toLowerCase().includes(busca.toLowerCase()) ||
      (c.descricao && c.descricao.toLowerCase().includes(busca.toLowerCase())) ||
      (c.parceiro_nome && c.parceiro_nome.toLowerCase().includes(busca.toLowerCase()));
    
    if (filtroStatus === 'ativos') return matchBusca && c.ativo;
    if (filtroStatus === 'inativos') return matchBusca && !c.ativo;
    return matchBusca;
  });

  // Métricas
  const totalCupons = cupons.length;
  const cuponsAtivos = cupons.filter(c => c.ativo).length;
  const totalResgates = cupons.reduce((acc, c) => acc + (c.total_usos || 0), 0);
  const totalEconomizado = cupons.reduce((acc, c) => acc + (Number(c.total_desconto_concedido) || 0), 0);

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center space-x-2">
            <Ticket className="w-6 h-6 text-amber-500" />
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-wide">
              CENTRAL DE CUPONS
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Gerencie cupons de desconto para campanhas da plataforma, banners globais e parceiros comerciais.
          </p>
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <button
            onClick={carregarDados}
            disabled={loading}
            className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white transition disabled:opacity-50"
            title="Atualizar dados"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={abrirModalCriacao}
            className="flex-1 sm:flex-none flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs tracking-wider uppercase shadow-lg shadow-amber-500/20 transition transform active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>Novo Cupom</span>
          </button>
        </div>
      </div>

      {/* Cards de Métricas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Total de Cupons</span>
            <Ticket className="w-4 h-4 text-amber-400" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl sm:text-3xl font-black text-white font-mono">{totalCupons}</span>
            <span className="text-xs text-amber-400 font-semibold">{cuponsAtivos} ativos</span>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Cupons Ativos</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono">{cuponsAtivos}</span>
            <span className="text-xs text-slate-500">Prontos para uso</span>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Total de Resgates</span>
            <Users className="w-4 h-4 text-blue-400" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl sm:text-3xl font-black text-white font-mono">{totalResgates}</span>
            <span className="text-xs text-blue-400 font-semibold">Oficinas beneficiadas</span>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Desconto Concedido</span>
            <DollarSign className="w-4 h-4 text-purple-400" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-xl sm:text-2xl font-black text-purple-300 font-mono">
              R$ {totalEconomizado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </span>
            <span className="text-xs text-purple-400 font-semibold">Economia gerada</span>
          </div>
        </div>
      </div>

      {/* Barra de Filtros */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-900/60 border border-slate-800 p-3 rounded-2xl">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por código, descrição ou parceiro..."
            value={busca}
            onChange={e => setBusca(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
          />
        </div>

        <div className="flex items-center space-x-1.5 w-full sm:w-auto">
          <button
            onClick={() => setFiltroStatus('todos')}
            className={`flex-1 sm:flex-none px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              filtroStatus === 'todos'
                ? 'bg-amber-500 text-slate-950 shadow'
                : 'text-slate-400 hover:text-white bg-slate-950 border border-slate-800'
            }`}
          >
            Todos ({cupons.length})
          </button>
          <button
            onClick={() => setFiltroStatus('ativos')}
            className={`flex-1 sm:flex-none px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              filtroStatus === 'ativos'
                ? 'bg-emerald-500 text-slate-950 shadow'
                : 'text-slate-400 hover:text-white bg-slate-950 border border-slate-800'
            }`}
          >
            Ativos ({cuponsAtivos})
          </button>
          <button
            onClick={() => setFiltroStatus('inativos')}
            className={`flex-1 sm:flex-none px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              filtroStatus === 'inativos'
                ? 'bg-rose-500 text-white shadow'
                : 'text-slate-400 hover:text-white bg-slate-950 border border-slate-800'
            }`}
          >
            Inativos ({cupons.length - cuponsAtivos})
          </button>
        </div>
      </div>

      {/* Lista de Cupons */}
      {loading ? (
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 font-mono text-sm">
          Carregando catálogo de cupons...
        </div>
      ) : cuponsFiltrados.length === 0 ? (
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-12 text-center">
          <Ticket className="w-12 h-12 text-slate-600 mx-auto mb-3 opacity-50" />
          <h3 className="text-base font-bold text-white mb-1">Nenhum cupom encontrado</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto mb-4">
            Nenhum cupom corresponde aos filtros selecionados. Crie um novo cupom para suas campanhas ou banners.
          </p>
          <button
            onClick={abrirModalCriacao}
            className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs uppercase"
          >
            <Plus className="w-4 h-4" />
            <span>Criar Primeiro Cupom</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {cuponsFiltrados.map((cupom) => {
            const atingiuLimite = cupom.limite_usos !== null && cupom.total_usos >= cupom.limite_usos;
            const expirou = cupom.valido_ate && new Date(cupom.valido_ate) < new Date();

            return (
              <div 
                key={cupom.id}
                className={`relative bg-slate-900/80 border rounded-2xl p-5 flex flex-col justify-between transition hover:shadow-xl ${
                  !cupom.ativo 
                    ? 'border-slate-800 opacity-60' 
                    : atingiuLimite || expirou
                    ? 'border-amber-500/40'
                    : 'border-amber-500/20 hover:border-amber-500/50 shadow-lg shadow-black/20'
                }`}
              >
                <div>
                  {/* Topo do Card: Código & Ações */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center space-x-2">
                      <div className="flex items-center space-x-1.5 bg-gradient-to-r from-amber-500/20 to-amber-600/10 border border-amber-500/40 px-2.5 py-1 rounded-lg">
                        <Ticket className="w-4 h-4 text-amber-400 shrink-0" />
                        <span className="font-mono font-black text-amber-400 text-sm tracking-wider">
                          {cupom.codigo}
                        </span>
                      </div>
                      <button
                        onClick={() => handleCopiarCodigo(cupom.codigo, cupom.id)}
                        className="p-1 text-slate-500 hover:text-amber-400 transition rounded"
                        title="Copiar código do cupom"
                      >
                        {copiadoId === cupom.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>

                    <div className="flex items-center space-x-1">
                      <button
                        onClick={() => abrirModalEdicao(cupom)}
                        className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
                        title="Editar Cupom"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleExcluir(cupom)}
                        className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition"
                        title="Excluir Cupom"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Valor do Desconto */}
                  <div className="mb-3">
                    <div className="flex items-baseline space-x-2">
                      <span className="text-2xl font-black text-white font-mono">
                        {cupom.desconto_tipo === 'percentual' 
                          ? `${cupom.desconto_valor}% OFF` 
                          : `R$ ${Number(cupom.desconto_valor).toFixed(2)} OFF`}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {cupom.duracao_meses === 1 
                          ? '1ª mensalidade' 
                          : cupom.duracao_meses > 1 
                          ? `por ${cupom.duracao_meses} meses` 
                          : 'vitalício'}
                      </span>
                    </div>
                    {cupom.descricao && (
                      <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                        {cupom.descricao}
                      </p>
                    )}
                  </div>

                  {/* Badges de Regras */}
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                      Plano: {cupom.plano_alvo.toUpperCase()}
                    </span>
                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${
                      cupom.origem === 'parceiro'
                        ? 'bg-purple-500/10 border-purple-500/30 text-purple-400'
                        : cupom.origem === 'banner'
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                        : 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                    }`}>
                      {cupom.origem === 'parceiro' && cupom.parceiro_nome
                        ? `Parceiro: ${cupom.parceiro_nome}`
                        : cupom.origem.toUpperCase()}
                    </span>
                    {expirou && (
                      <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-400">
                        Expirado
                      </span>
                    )}
                    {atingiuLimite && (
                      <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400">
                        Esgotado
                      </span>
                    )}
                  </div>
                </div>

                {/* Rodapé do Card: Progresso de Uso & Toggle Ativo */}
                <div className="border-t border-slate-800/80 pt-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Utilizações:</span>
                    <span className="font-mono font-bold text-slate-200">
                      {cupom.total_usos} {cupom.limite_usos ? `/ ${cupom.limite_usos}` : '(Ilimitado)'}
                    </span>
                  </div>

                  {cupom.limite_usos && (
                    <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-800">
                      <div 
                        className={`h-full rounded-full transition-all ${
                          atingiuLimite ? 'bg-rose-500' : 'bg-amber-500'
                        }`}
                        style={{ width: `${Math.min(100, (cupom.total_usos / cupom.limite_usos) * 100)}%` }}
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[11px] text-slate-500">
                      {cupom.valido_ate ? `Válido até ${new Date(cupom.valido_ate).toLocaleDateString('pt-BR')}` : 'Sem data limite'}
                    </span>

                    <button
                      onClick={() => handleToggleAtivo(cupom)}
                      className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-semibold border transition ${
                        cupom.ativo
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                          : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${cupom.ativo ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                      <span>{cupom.ativo ? 'Ativo' : 'Pausado'}</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de Criação / Edição */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
          <div className="bg-slate-900 border border-amber-500/30 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative my-8">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-5">
              <div className="flex items-center space-x-2">
                <Ticket className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  {cupomEmEdicao ? `Editar Cupom: ${cupomEmEdicao.codigo}` : 'Criar Novo Cupom de Desconto'}
                </h3>
              </div>
              <button
                onClick={() => setModalAberto(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={salvarCupom} className="space-y-4">
              {/* Código do Cupom */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Código Promocional *
                </label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    required
                    placeholder="Ex: DETAILER20"
                    value={codigo}
                    onChange={e => setCodigo(e.target.value.toUpperCase())}
                    className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono font-bold text-amber-400 placeholder-slate-600 focus:outline-none focus:border-amber-500 uppercase"
                  />
                  <button
                    type="button"
                    onClick={gerarCodigoAleatorio}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl border border-slate-700 flex items-center space-x-1"
                    title="Gerar código aleatório"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span>Gerar</span>
                  </button>
                </div>
              </div>

              {/* Descrição */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Descrição / Objetivo da Campanha
                </label>
                <input
                  type="text"
                  placeholder="Ex: 20% de desconto especial do Dia do Detailer"
                  value={descricao}
                  onChange={e => setDescricao(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500"
                />
              </div>

              {/* Regra do Desconto: Tipo & Valor */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Tipo do Desconto
                  </label>
                  <select
                    value={descontoTipo}
                    onChange={e => setDescontoTipo(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value="percentual">Percentual (%)</option>
                    <option value="valor_fixo">Valor Fixo (R$)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Valor do Desconto *
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      required
                      min="0.1"
                      step="0.1"
                      placeholder={descontoTipo === 'percentual' ? 'Ex: 20' : 'Ex: 30.00'}
                      value={descontoValor}
                      onChange={e => setDescontoValor(parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono font-bold text-white focus:outline-none focus:border-amber-500"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">
                      {descontoTipo === 'percentual' ? '%' : 'R$'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Plano Alvo & Duração */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Plano Aplicável
                  </label>
                  <select
                    value={planoAlvo}
                    onChange={e => setPlanoAlvo(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value="todos">Todos os Planos</option>
                    <option value="pro">Apenas Plano Pro</option>
                    <option value="studio">Apenas Plano Studio</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Duração da Recorrência
                  </label>
                  <select
                    value={duracaoMeses}
                    onChange={e => setDuracaoMeses(parseInt(e.target.value, 10))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value="1">Apenas 1ª mensalidade</option>
                    <option value="2">Por 2 meses</option>
                    <option value="3">Por 3 meses</option>
                    <option value="6">Por 6 meses</option>
                    <option value="12">Por 12 meses (1 ano)</option>
                    <option value="0">Vitalício (recorrente sempre)</option>
                  </select>
                </div>
              </div>

              {/* Limite de Usos & Validade */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Limite de Usos (Opcional)
                  </label>
                  <input
                    type="number"
                    min="1"
                    placeholder="Deixe vazio para ilimitado"
                    value={limiteUsos}
                    onChange={e => setLimiteUsos(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Validade Até (Opcional)
                  </label>
                  <input
                    type="date"
                    value={validoAte}
                    onChange={e => setValidoAte(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              {/* Origem e Parceiro Vinculado */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Origem do Cupom
                  </label>
                  <select
                    value={origem}
                    onChange={e => setOrigem(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value="plataforma">Plataforma Geral</option>
                    <option value="banner">Banner Global / Pop-up</option>
                    <option value="parceiro">Parceiro Comercial</option>
                    <option value="campanha">Campanha Especial</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Vincular Parceiro (Opcional)
                  </label>
                  <select
                    value={parceiroId}
                    onChange={e => setParceiroId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value="">Nenhum parceiro</option>
                    {parceiros.map(p => (
                      <option key={p.id} value={p.id}>{p.nome}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Status Ativo */}
              <div className="flex items-center space-x-2 pt-2">
                <input
                  type="checkbox"
                  id="ativoCheckbox"
                  checked={ativo}
                  onChange={e => setAtivo(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-950 text-amber-500 focus:ring-amber-500 w-4 h-4"
                />
                <label htmlFor="ativoCheckbox" className="text-xs text-slate-300 font-semibold cursor-pointer">
                  Cupom ativo imediatamente para uso no Checkout
                </label>
              </div>

              {/* Botões do Modal */}
              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setModalAberto(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs uppercase tracking-wider shadow-lg shadow-amber-500/20 transition disabled:opacity-50"
                >
                  {salvando ? 'Salvando...' : cupomEmEdicao ? 'Salvar Alterações' : 'Criar Cupom'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
