import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { 
  AlertTriangle, 
  CheckCircle, 
  DollarSign, 
  RefreshCw, 
  Check, 
  Search, 
  Info,
  ChevronDown,
  ChevronUp,
  Zap,
  ArrowUpRight,
  HelpCircle,
  Sliders,
  Building2,
  Package,
  Users,
  X,
  ExternalLink,
  ShieldAlert,
  Sparkles
} from 'lucide-react';

interface PrecificacaoItem {
  servico_preco_id: string;
  servico_id: string;
  servico_nome: string;
  servico_codigo: string | null;
  categoria_id: string;
  categoria_nome: string;
  duracao_minutos: number;
  duracao_fonte: 'medido' | 'estimativa';
  execucoes_count: number;
  volume_mensal: number;
  custo_estrutura: number;
  custo_produtos: number;
  produtos_incompleto: boolean;
  custo_comissao: number;
  custo_total: number;
  preco_atual: number;
  preco_alvo: number;
  margem_atual: number;
  tem_referencia: boolean;
  preco_min: number | null;
  preco_max: number | null;
  fonte_ref: string | null;
  amostra_ref: number;
  status: 'prejuizo' | 'custo_alto' | 'abaixo_alvo' | 'premium' | 'ok' | 'sem_referencia';
  diferenca_unitario: number;
  ganho_mensal: number;
  impacto_financeiro: number;
  nota_explicativa: string | null;
}

interface MatrizResultado {
  tenant_info: {
    porte_cidade: string;
    margem_alvo_percentual: number;
    custo_hora_atual: number;
  };
  resumo_impacto: {
    total_perda_mes: number;
    total_oportunidade_mes: number;
    impacto_total_mes: number;
    total_itens: number;
  };
  itens: PrecificacaoItem[];
}

export const Precificacao: React.FC = () => {
  const [data, setData] = useState<MatrizResultado | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Filtros
  const [filterStatus, setFilterStatus] = useState<string>('todos');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  // Preços simulados por item id
  const [precosSimulados, setPrecosSimulados] = useState<Record<string, number>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [applyingAll, setApplyingAll] = useState(false);

  // Modais explicativos dos cards do topo
  const [topModal, setTopModal] = useState<'perda' | 'oportunidade' | 'custo_hora' | null>(null);

  const fetchMatriz = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: resData, error: resErr } = await supabase.rpc('obter_matriz_precificacao_tenant');
      if (resErr) throw resErr;

      const matriz = resData as MatrizResultado;
      setData(matriz);

      // Inicializa os preços simulados com o preço atual ou preço alvo
      if (matriz?.itens) {
        const initialPrices: Record<string, number> = {};
        matriz.itens.forEach((item: PrecificacaoItem) => {
          initialPrices[item.servico_preco_id] = item.preco_alvo > 0 ? item.preco_alvo : item.preco_atual;
        });
        setPrecosSimulados(initialPrices);
      }
    } catch (err: any) {
      console.error('[Precificacao] Erro ao carregar matriz:', err);
      setError(err.message || 'Erro ao carregar dados de precificação.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMatriz();
  }, []);

  const handleApplySingle = async (item: PrecificacaoItem) => {
    const novoPreco = precosSimulados[item.servico_preco_id] || item.preco_alvo;
    if (!novoPreco || novoPreco <= 0) return;

    setSavingId(item.servico_preco_id);
    setError(null);
    setSuccess(null);

    try {
      const { error: rpcErr } = await supabase.rpc('aplicar_precos_sugeridos', {
        p_itens: [
          {
            servico_preco_id: item.servico_preco_id,
            novo_preco: novoPreco
          }
        ]
      });

      if (rpcErr) throw rpcErr;
      setSuccess(`Preço de "${item.servico_nome} (${item.categoria_nome})" atualizado para R$ ${novoPreco.toFixed(2)} com sucesso!`);
      await fetchMatriz();
    } catch (err: any) {
      console.error('[Precificacao] Erro ao aplicar preço:', err);
      setError(err.message || 'Erro ao aplicar novo preço.');
    } finally {
      setSavingId(null);
    }
  };

  const handleApplyAllSuggested = async () => {
    if (!data?.itens || data.itens.length === 0) return;
    
    const itemsToUpdate = data.itens
      .filter(i => i.status === 'prejuizo' || i.status === 'abaixo_alvo')
      .map(i => ({
        servico_preco_id: i.servico_preco_id,
        novo_preco: i.preco_alvo
      }));

    if (itemsToUpdate.length === 0) {
      setSuccess('Todos os seus preços já estão alinhados com a sua margem alvo!');
      return;
    }

    if (!window.confirm(`Deseja atualizar os preços de ${itemsToUpdate.length} serviços para a margem alvo da sua oficina (${data.tenant_info.margem_alvo_percentual}%)?`)) {
      return;
    }

    setApplyingAll(true);
    setError(null);
    setSuccess(null);

    try {
      const { error: rpcErr } = await supabase.rpc('aplicar_precos_sugeridos', {
        p_itens: itemsToUpdate
      });

      if (rpcErr) throw rpcErr;
      setSuccess(`Preços de ${itemsToUpdate.length} serviços reajustados para a margem alvo!`);
      await fetchMatriz();
    } catch (err: any) {
      console.error('[Precificacao] Erro ao aplicar todos os preços:', err);
      setError(err.message || 'Erro ao aplicar preços em lote.');
    } finally {
      setApplyingAll(false);
    }
  };

  // Filtragem e ordenação dos itens por Oportunidade/Impacto Financeiro DESC
  const filteredItens = (data?.itens || []).filter(item => {
    const matchSearch = !searchQuery || 
      item.servico_nome.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.categoria_nome.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.servico_codigo && item.servico_codigo.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchSearch) return false;

    if (filterStatus === 'prejuizo') return item.status === 'prejuizo';
    if (filterStatus === 'abaixo_alvo') return item.status === 'abaixo_alvo';
    if (filterStatus === 'saudavel') return item.status === 'ok' || item.status === 'premium';
    if (filterStatus === 'sem_referencia') return item.status === 'sem_referencia';

    return true;
  });

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto pb-12 px-2 sm:px-4">
      <PageHeader 
        title="Precificação Inteligente & Margem Real" 
        subtitle="Ranking de oportunidade financeira: entenda os custos reais da sua oficina em frases diretas e simule o ganho de cada reajuste."
        action={
          <Button
            variant="secondary"
            onClick={fetchMatriz}
            disabled={loading}
            className="flex items-center gap-2 text-xs"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Recalcular Matriz</span>
          </Button>
        }
      />

      {/* Mensagens de Erro/Sucesso */}
      {error && (
        <div className="p-4 bg-flare-400/10 border border-flare-400/30 rounded-xl text-flare-400 text-xs flex items-center justify-between shadow-sm">
          <div className="flex items-center space-x-2">
            <AlertTriangle size={16} className="shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="hover:text-vapor-100"><X size={14} /></button>
        </div>
      )}

      {success && (
        <div className="p-4 bg-mint-500/10 border border-mint-500/30 rounded-xl text-mint-400 text-xs flex items-center justify-between shadow-sm">
          <div className="flex items-center space-x-2">
            <Check size={16} className="shrink-0" />
            <span>{success}</span>
          </div>
          <button onClick={() => setSuccess(null)} className="hover:text-vapor-100"><X size={14} /></button>
        </div>
      )}

      {/* Cards de Resumo Financeiro (Clicáveis para explicação) */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Card 1: Perda por Prejuízo */}
          <button 
            type="button"
            onClick={() => setTopModal('perda')}
            className="text-left p-5 bg-graphite-800 hover:bg-graphite-750 border border-graphite-600 rounded-xl transition-all shadow hover:border-flare-400/50 group relative cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="font-sans text-[12px] text-vapor-400 uppercase tracking-wider font-semibold flex items-center gap-1.5">
                <AlertTriangle size={16} className="text-flare-400" />
                Prejuízo Operacional / Mês
              </span>
              <span className="p-1.5 bg-flare-400/10 rounded-md text-flare-400 font-mono text-[10px] font-bold flex items-center gap-1">
                EXPLICAR <HelpCircle size={12} />
              </span>
            </div>
            <div className="mt-3">
              <div className="font-mono text-[26px] sm:text-[30px] font-black text-flare-400">
                R$ {data.resumo_impacto.total_perda_mes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </div>
              <p className="font-sans text-[12px] text-vapor-400 mt-1 flex items-center gap-1">
                <span>Vendas abaixo do custo real de produção.</span>
              </p>
            </div>
          </button>

          {/* Card 2: Oportunidade de Margem Alvo */}
          <button 
            type="button"
            onClick={() => setTopModal('oportunidade')}
            className="text-left p-5 bg-graphite-800 hover:bg-graphite-750 border border-graphite-600 rounded-xl transition-all shadow hover:border-amber-500/50 group relative cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="font-sans text-[12px] text-vapor-400 uppercase tracking-wider font-semibold flex items-center gap-1.5">
                <ArrowUpRight size={16} className="text-amber-500" />
                Oportunidade de Ganho / Mês
              </span>
              <span className="p-1.5 bg-amber-500/10 rounded-md text-amber-400 font-mono text-[10px] font-bold flex items-center gap-1">
                EXPLICAR <HelpCircle size={12} />
              </span>
            </div>
            <div className="mt-3">
              <div className="font-mono text-[26px] sm:text-[30px] font-black text-amber-400">
                R$ {data.resumo_impacto.total_oportunidade_mes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </div>
              <p className="font-sans text-[12px] text-vapor-400 mt-1">
                Ganho extra ao atingir meta de {data.tenant_info.margem_alvo_percentual}% de margem.
              </p>
            </div>
          </button>

          {/* Card 3: Custo Operacional Hora */}
          <button 
            type="button"
            onClick={() => setTopModal('custo_hora')}
            className="text-left p-5 bg-graphite-800 hover:bg-graphite-750 border border-graphite-600 rounded-xl transition-all shadow hover:border-mint-500/50 group relative cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="font-sans text-[12px] text-vapor-400 uppercase tracking-wider font-semibold flex items-center gap-1.5">
                <DollarSign size={16} className="text-mint-400" />
                Custo da Hora Operacional
              </span>
              <span className="p-1.5 bg-mint-500/10 rounded-md text-mint-400 font-mono text-[10px] font-bold flex items-center gap-1 uppercase">
                EXPLICAR <HelpCircle size={12} />
              </span>
            </div>
            <div className="mt-3">
              <div className="font-mono text-[26px] sm:text-[30px] font-black text-mint-400">
                R$ {data.tenant_info.custo_hora_atual.toFixed(2)} <span className="text-[14px] font-normal text-vapor-400">/ hora</span>
              </div>
              <p className="font-sans text-[12px] text-vapor-400 mt-1">
                Custo para sua oficina ficar de portas abertas.
              </p>
            </div>
          </button>
        </div>
      )}

      {/* Modais Explicativos do Topo */}
      {topModal && data && (
        <div className="fixed inset-0 bg-graphite-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-graphite-800 border border-graphite-600 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl relative">
            <button 
              onClick={() => setTopModal(null)} 
              className="absolute right-4 top-4 text-vapor-400 hover:text-vapor-100 p-1"
            >
              <X size={20} />
            </button>

            {topModal === 'perda' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-flare-400 font-display text-[16px] font-bold uppercase">
                  <AlertTriangle size={20} />
                  <span>Como o Prejuízo Operacional é calculado?</span>
                </div>
                <p className="text-vapor-300 text-sm leading-relaxed">
                  Esta soma representa a soma em dinheiro que sua oficina <strong>está perdendo todo mês</strong> ao vender serviços por um valor abaixo do custo real de produção.
                </p>
                <div className="bg-graphite-900 p-4 rounded-xl border border-graphite-700 text-xs space-y-2 text-vapor-300">
                  <p><strong>Custo Real de Produção</strong> = Custo de Estrutura da Oficina + Insumos/Produtos Consumidos + Comissão do Executor.</p>
                  <p className="text-flare-400">Se a soma dos seus custos para um atendimento é R$ 100,00 e você cobra R$ 80,00, você perde R$ 20,00 a cada cliente.</p>
                  <p>Multiplicamos essa perda pela média mensal de atendimentos executados nos últimos 90 dias.</p>
                </div>
              </div>
            )}

            {topModal === 'oportunidade' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-amber-400 font-display text-[16px] font-bold uppercase">
                  <ArrowUpRight size={20} />
                  <span>Como a Oportunidade de Ganho é calculada?</span>
                </div>
                <p className="text-vapor-300 text-sm leading-relaxed">
                  Este valor é o <strong>dinheiro adicional que entra no seu caixa todo mês</strong> se você reajustar os serviços que hoje estão abaixo da margem alvo configurada da sua oficina ({data.tenant_info.margem_alvo_percentual}%).
                </p>
                <div className="bg-graphite-900 p-4 rounded-xl border border-graphite-700 text-xs space-y-2 text-vapor-300">
                  <p><strong>Preço Alvo Sugerido</strong> = Custo Total / (1 - (Margem Alvo / 100)).</p>
                  <p className="text-amber-400">A diferença entre o Preço Alvo e o seu Preço Atual é multiplicada pela quantidade média de atendimentos do mês.</p>
                  <p>O resultado é a receita líquida extra sem precisar trabalhar 1 minuto a mais.</p>
                </div>
              </div>
            )}

            {topModal === 'custo_hora' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-mint-400 font-display text-[16px] font-bold uppercase">
                  <DollarSign size={20} />
                  <span>Como o Custo da Hora Operacional é calculado?</span>
                </div>
                <p className="text-vapor-300 text-sm leading-relaxed">
                  O valor de <strong>R$ {data.tenant_info.custo_hora_atual.toFixed(2)} por hora</strong> é quanto sua oficina gasta apenas por estar aberta.
                </p>
                <div className="bg-graphite-900 p-4 rounded-xl border border-graphite-700 text-xs space-y-2 text-vapor-300">
                  <p><strong>Custo da Hora</strong> = Total das Despesas Fixas Mensais / Horas Trabalháveis do Mês.</p>
                  <p>Despesas Fixas incluem: aluguel, luz, água, salários fixos, ferramentas e licenças.</p>
                  <p className="text-mint-400">Cada serviço consome uma fração dessa hora operacional de acordo com o tempo decorrido.</p>
                </div>
                <div className="pt-2 flex justify-end">
                  <Link 
                    to="/financeiro" 
                    className="inline-flex items-center gap-1.5 text-xs text-amber-500 font-bold hover:underline"
                    onClick={() => setTopModal(null)}
                  >
                    <span>Gerenciar Despesas Fixas em Financeiro</span>
                    <ExternalLink size={14} />
                  </Link>
                </div>
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <Button variant="secondary" onClick={() => setTopModal(null)}>Entendi</Button>
            </div>
          </div>
        </div>
      )}

      {/* Barra de Filtros e Busca */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-graphite-800 p-4 rounded-xl border border-graphite-600 shadow-sm">
        {/* Input de Busca */}
        <div className="relative flex-1 min-w-[240px]">
          <Search size={16} className="text-vapor-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por serviço, código ou categoria..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-graphite-900 border border-graphite-600 rounded-lg pl-9 pr-3 py-2 text-vapor-100 font-sans text-xs outline-none focus:border-amber-500"
          />
        </div>

        {/* Tabs de Filtro por Diagnóstico */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
          <button
            onClick={() => setFilterStatus('todos')}
            className={`px-3 py-1.5 rounded-lg font-display text-[11px] uppercase tracking-wide transition-colors whitespace-nowrap ${
              filterStatus === 'todos' 
                ? 'bg-amber-500 text-graphite-950 font-bold' 
                : 'bg-graphite-900 text-vapor-300 hover:text-vapor-100'
            }`}
          >
            Todos ({data?.resumo_impacto.total_itens || 0})
          </button>
          <button
            onClick={() => setFilterStatus('prejuizo')}
            className={`px-3 py-1.5 rounded-lg font-display text-[11px] uppercase tracking-wide transition-colors whitespace-nowrap ${
              filterStatus === 'prejuizo' 
                ? 'bg-flare-400 text-graphite-950 font-bold' 
                : 'bg-graphite-900 text-flare-400 hover:bg-flare-400/10'
            }`}
          >
            Prejuízo
          </button>
          <button
            onClick={() => setFilterStatus('abaixo_alvo')}
            className={`px-3 py-1.5 rounded-lg font-display text-[11px] uppercase tracking-wide transition-colors whitespace-nowrap ${
              filterStatus === 'abaixo_alvo' 
                ? 'bg-amber-500/20 border border-amber-500/40 text-amber-400 font-bold' 
                : 'bg-graphite-900 text-vapor-300 hover:text-vapor-100'
            }`}
          >
            Abaixo da Margem
          </button>
          <button
            onClick={() => setFilterStatus('saudavel')}
            className={`px-3 py-1.5 rounded-lg font-display text-[11px] uppercase tracking-wide transition-colors whitespace-nowrap ${
              filterStatus === 'saudavel' 
                ? 'bg-mint-500/20 border border-mint-500/40 text-mint-400 font-bold' 
                : 'bg-graphite-900 text-vapor-400 hover:text-vapor-100'
            }`}
          >
            Saudável
          </button>
          <button
            onClick={() => setFilterStatus('sem_referencia')}
            className={`px-3 py-1.5 rounded-lg font-display text-[11px] uppercase tracking-wide transition-colors whitespace-nowrap ${
              filterStatus === 'sem_referencia' 
                ? 'bg-graphite-700 text-vapor-100 font-bold' 
                : 'bg-graphite-900 text-vapor-400 hover:text-vapor-100'
            }`}
          >
            Sem Benchmark
          </button>
        </div>

        {/* Botão Reajustar Todos */}
        <Button
          variant="primary"
          onClick={handleApplyAllSuggested}
          disabled={applyingAll || loading}
          className="flex items-center justify-center gap-2 text-xs shrink-0 font-bold whitespace-nowrap"
        >
          <Zap size={14} />
          <span>{applyingAll ? 'Aplicando...' : 'Aplicar Todos Sugeridos'}</span>
        </Button>
      </div>

      {/* LISTA RANKING DE OPORTUNIDADE (CADA LINHA É UMA HISTÓRIA NARRATIVA) */}
      <div className="space-y-4">
        {loading ? (
          <Card className="p-12 text-center text-vapor-400 font-mono bg-graphite-800 border-graphite-600">
            Carregando ranking de precificação inteligente...
          </Card>
        ) : filteredItens.length === 0 ? (
          <Card className="p-8 text-center bg-graphite-800 border-graphite-600 space-y-4">
            <div className="inline-flex p-3 rounded-full bg-amber-500/10 text-amber-400">
              <Sparkles size={28} />
            </div>
            <h3 className="font-display text-lg text-vapor-100 font-bold">Nenhum serviço encontrado neste filtro</h3>
            <p className="text-vapor-400 text-xs max-w-md mx-auto leading-relaxed">
              {searchQuery || filterStatus !== 'todos' 
                ? 'Tente ajustar os termos da busca ou mudar os filtros no topo.' 
                : 'Sua oficina ainda não possui serviços cadastrados com tabelas de preço ativas. Cadastre serviços e execute seus primeiros atendimentos para alimentar a inteligência financeira.'}
            </p>
            <div className="pt-2 flex justify-center gap-3">
              <Link to="/servicos">
                <Button variant="secondary" className="text-xs">Gerenciar Serviços</Button>
              </Link>
            </div>
          </Card>
        ) : (
          filteredItens.map((item, index) => {
            const isExpanded = expandedItemId === item.servico_preco_id;
            const novoPrecoSimulado = precosSimulados[item.servico_preco_id] ?? item.preco_alvo;

            // Cálculos da Simulação ao vivo
            const lucroPorCarroSimulado = novoPrecoSimulado - item.custo_total;
            const margemSimulada = novoPrecoSimulado > 0 
              ? ((novoPrecoSimulado - item.custo_total) / novoPrecoSimulado) * 100 
              : 0;
            const lucroAMaisMes = (novoPrecoSimulado - item.preco_atual) * item.volume_mensal;

            // Formatação do tempo em horas/minutos
            const duracaoTexto = item.duracao_minutos >= 60 
              ? `${Math.floor(item.duracao_minutos / 60)}h${item.duracao_minutos % 60 > 0 ? `${item.duracao_minutos % 60}m` : ''}`
              : `${item.duracao_minutos} min`;

            return (
              <Card 
                key={item.servico_preco_id} 
                className={`bg-graphite-800 border transition-all duration-200 shadow-md ${
                  isExpanded ? 'border-amber-500 ring-1 ring-amber-500/30' : 'border-graphite-600 hover:border-graphite-500'
                }`}
              >
                {/* Linha Principal (Resumo do Ranking em Frases) */}
                <div className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  {/* Esquerda: Ranking badge, Nome do serviço, Categoria e Frase de Diagnóstico */}
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <span className="font-mono text-xs font-bold px-2 py-1 bg-graphite-900 border border-graphite-700 text-amber-500 rounded shrink-0">
                      #{index + 1}
                    </span>

                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-display font-bold text-vapor-100 text-base">
                          {item.servico_nome}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-graphite-900 border border-graphite-700 text-vapor-300 font-mono text-[11px] font-semibold">
                          {item.categoria_nome}
                        </span>
                        {item.servico_codigo && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 font-mono text-[10px]">
                            {item.servico_codigo}
                          </span>
                        )}
                      </div>

                      {/* FRASE DE DIAGNÓSTICO EM PORTUGUÊS (NENHUM NÚMERO SOLTO) */}
                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        {item.status === 'prejuizo' && (
                          <span className="font-sans text-xs font-bold text-flare-400 flex items-center gap-1.5 bg-flare-400/10 px-2.5 py-1 rounded-md border border-flare-400/30">
                            <AlertTriangle size={14} className="shrink-0" />
                            <span>Você perde R$ {item.diferenca_unitario.toFixed(2)} em cada um destes</span>
                          </span>
                        )}

                        {item.status === 'abaixo_alvo' && (
                          <span className="font-sans text-xs font-bold text-amber-400 flex items-center gap-1.5 bg-amber-500/10 px-2.5 py-1 rounded-md border border-amber-500/30">
                            <ArrowUpRight size={14} className="shrink-0" />
                            <span>Dá para cobrar R$ {(item.preco_alvo - item.preco_atual).toFixed(2)} a mais sem sair da faixa do mercado</span>
                          </span>
                        )}

                        {(item.status === 'ok' || item.status === 'premium') && (
                          <span className="font-sans text-xs font-bold text-mint-400 flex items-center gap-1.5 bg-mint-500/10 px-2.5 py-1 rounded-md border border-mint-500/30">
                            <CheckCircle size={14} className="shrink-0" />
                            <span>Preço saudável (margem de {item.margem_atual.toFixed(1)}%)</span>
                          </span>
                        )}

                        {item.status === 'sem_referencia' && (
                          <span className="font-sans text-xs text-vapor-400 flex items-center gap-1 bg-graphite-900 px-2.5 py-1 rounded-md border border-graphite-700">
                            <Info size={14} className="shrink-0" />
                            <span>Serviço próprio da oficina (sem benchmark público)</span>
                          </span>
                        )}

                        {/* Badges de Qualidade dos Dados */}
                        <div className="flex items-center gap-1 text-[11px] text-vapor-400 font-mono">
                          {item.duracao_fonte === 'medido' ? (
                            <span className="text-mint-400/90" title={`Medido em ${item.execucoes_count} execuções reais`}>
                              • Medido ({item.execucoes_count}x)
                            </span>
                          ) : (
                            <span className="text-amber-500/90" title="Tempo vindo do cadastro (sem medição cronometrada)">
                              • Duração estimativa
                            </span>
                          )}

                          {item.produtos_incompleto && (
                            <span className="text-flare-400 font-semibold" title="Nenhum consumo de produto registrado para este serviço!">
                              • Insumos incompletos
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Direita: Preço atual, volume mensal e Botão de Expandir Explicação */}
                  <div className="flex items-center justify-between md:justify-end gap-4 border-t md:border-t-0 border-graphite-700 pt-3 md:pt-0 shrink-0">
                    <div className="text-left md:text-right space-y-0.5">
                      <div className="text-[11px] text-vapor-400 uppercase tracking-wider font-mono">Cobra Hoje</div>
                      <div className="font-mono text-lg font-extrabold text-vapor-100">
                        R$ {item.preco_atual.toFixed(2)}
                      </div>
                      <div className="text-[11px] text-vapor-400 font-mono">
                        ~{item.volume_mensal} atend./mês
                      </div>
                    </div>

                    <Button
                      variant={isExpanded ? 'primary' : 'secondary'}
                      onClick={() => setExpandedItemId(isExpanded ? null : item.servico_preco_id)}
                      className="flex items-center gap-1.5 text-xs font-bold px-3 py-2"
                    >
                      <span>{isExpanded ? 'Fechar Conta' : 'Ver Conta Inteira'}</span>
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </Button>
                  </div>
                </div>

                {/* CASCA NARRATIVA COMPLETA & SIMULADOR DE PREÇO INTERATIVO (EXPANDIDO) */}
                {isExpanded && (
                  <div className="border-t border-graphite-700 bg-graphite-900/90 p-4 sm:p-6 space-y-6 rounded-b-xl">
                    {/* A. Resumo da Frase de Abertura */}
                    <div className="bg-graphite-950 p-4 rounded-xl border border-graphite-700 space-y-2">
                      <h4 className="font-display font-bold text-vapor-100 text-sm flex items-center gap-2">
                        <span>{item.servico_nome}</span>
                        <span className="text-amber-500 text-xs font-mono">— {item.categoria_nome}</span>
                      </h4>
                      <p className="text-vapor-300 text-xs leading-relaxed">
                        Você cobra <strong className="text-vapor-100">R$ {item.preco_atual.toFixed(2)}</strong> por atendimento. Cada um leva <strong className="text-vapor-100">{duracaoTexto}</strong>, {item.duracao_fonte === 'medido' ? `medido em ${item.execucoes_count} atendimentos reais.` : <span className="text-amber-400 font-medium">estimativa do seu cadastro, ainda sem medição.</span>}
                      </p>
                    </div>

                    {/* B. Cascata Explicativa dos Custos em Frases (Com Links para Origem) */}
                    <div className="space-y-3">
                      <h5 className="font-mono text-xs uppercase tracking-wider text-vapor-400 font-bold">
                        Como Chegamos ao Custo Total
                      </h5>

                      <div className="grid grid-cols-1 gap-2 text-xs">
                        {/* 1. Estrutura */}
                        <div className="p-3.5 bg-graphite-800 rounded-xl border border-graphite-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="space-y-1">
                            <span className="font-bold text-vapor-100 flex items-center gap-1.5">
                              <Building2 size={14} className="text-mint-400 shrink-0" />
                              <span>Estrutura: R$ {item.custo_estrutura.toFixed(2)}</span>
                            </span>
                            <p className="text-vapor-400 text-[11px] leading-relaxed">
                              Sua oficina custa <strong className="text-vapor-200">R$ {data?.tenant_info?.custo_hora_atual?.toFixed(2) || '0.00'}</strong> por hora para existir, e este serviço ocupa <strong className="text-vapor-200">{duracaoTexto}</strong> dela.
                            </p>
                          </div>
                          <Link 
                            to="/financeiro" 
                            className="text-[11px] text-amber-500 hover:underline font-mono font-bold flex items-center gap-1 shrink-0 self-end sm:self-center"
                          >
                            <span>Origem: Despesas Fixas</span>
                            <ExternalLink size={12} />
                          </Link>
                        </div>

                        {/* 2. Produto */}
                        <div className="p-3.5 bg-graphite-800 rounded-xl border border-graphite-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="space-y-1">
                            <span className="font-bold text-vapor-100 flex items-center gap-1.5">
                              <Package size={14} className="text-amber-400 shrink-0" />
                              <span>Produto: R$ {item.custo_produtos.toFixed(2)}</span>
                            </span>
                            <p className="text-vapor-400 text-[11px] leading-relaxed">
                              {item.produtos_incompleto ? (
                                <span className="text-flare-400 font-semibold flex items-center gap-1">
                                  <ShieldAlert size={12} />
                                  Nenhum consumo registrado — este custo está incompleto e o lucro real é menor.
                                </span>
                              ) : (
                                `Média dos insumos consumidos nos atendimentos deste serviço.`
                              )}
                            </p>
                          </div>
                          <Link 
                            to="/estoque" 
                            className="text-[11px] text-amber-500 hover:underline font-mono font-bold flex items-center gap-1 shrink-0 self-end sm:self-center"
                          >
                            <span>Origem: Consumo de Insumos</span>
                            <ExternalLink size={12} />
                          </Link>
                        </div>

                        {/* 3. Mão de Obra */}
                        <div className="p-3.5 bg-graphite-800 rounded-xl border border-graphite-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="space-y-1">
                            <span className="font-bold text-vapor-100 flex items-center gap-1.5">
                              <Users size={14} className="text-blue-400 shrink-0" />
                              <span>Mão de Obra: R$ {item.custo_comissao.toFixed(2)}</span>
                            </span>
                            <p className="text-vapor-400 text-[11px] leading-relaxed">
                              Comissão estimada para o executor com base nas regras ativas da equipe.
                            </p>
                          </div>
                          <Link 
                            to="/configuracoes" 
                            className="text-[11px] text-amber-500 hover:underline font-mono font-bold flex items-center gap-1 shrink-0 self-end sm:self-center"
                          >
                            <span>Origem: Regras de Comissão</span>
                            <ExternalLink size={12} />
                          </Link>
                        </div>

                        {/* Total dos Custos */}
                        <div className="p-3 bg-graphite-950 rounded-xl border border-graphite-700 flex items-center justify-between font-mono text-xs">
                          <span className="font-bold text-vapor-300">Custo Total Real de Produção:</span>
                          <span className="font-black text-flare-400 text-sm">R$ {item.custo_total.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>

                    {/* C. Diagnóstico de Quanto Sobra */}
                    <div className="p-4 bg-graphite-800 rounded-xl border border-graphite-700 space-y-2 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-vapor-200">
                          Sobram <strong className="text-mint-400 font-mono text-sm">R$ {(item.preco_atual - item.custo_total).toFixed(2)}</strong> por carro, ou <strong className="text-mint-400 font-mono">{item.margem_atual.toFixed(1)}%</strong> de margem.
                        </div>
                        <div className="text-vapor-300 font-mono">
                          Meta ({data?.tenant_info?.margem_alvo_percentual || 0}%): <span className="text-amber-400 font-bold">R$ {item.preco_alvo.toFixed(2)}</span>
                        </div>
                      </div>

                      {item.tem_referencia && item.preco_min && item.preco_max && (
                        <div className="text-vapor-400 text-[11px] pt-1 border-t border-graphite-700/60 flex items-center gap-1.5">
                          <Info size={13} className="text-amber-400 shrink-0" />
                          <span>
                            Oficinas parecidas em mercado {data?.tenant_info?.porte_cidade || ''} cobram entre <strong className="text-vapor-200 font-mono">R$ {item.preco_min.toFixed(2)}</strong> e <strong className="text-vapor-200 font-mono">R$ {item.preco_max.toFixed(2)}</strong>.
                          </span>
                        </div>
                      )}
                    </div>

                    {/* D. SIMULADOR INTERATIVO DE PREÇO (O PODER DA DECISÃO) */}
                    <div className="p-5 bg-gradient-to-br from-graphite-950 to-graphite-900 rounded-xl border border-amber-500/40 space-y-5 shadow-lg">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-graphite-700/60 pb-3">
                        <div className="flex items-center gap-2">
                          <Sliders size={18} className="text-amber-500" />
                          <h5 className="font-display font-bold text-vapor-100 text-sm uppercase tracking-wide">
                            Simulador Interativo de Preço
                          </h5>
                        </div>
                        <span className="text-[11px] text-vapor-400 font-mono">
                          Arraste para sentir o impacto real no bolso
                        </span>
                      </div>

                      {/* Controle Slider & Input Numérico */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
                        <div className="md:col-span-2 space-y-3">
                          <div className="flex justify-between items-center text-xs font-mono text-vapor-300">
                            <span>Mínimo (Custo): R$ {item.custo_total.toFixed(2)}</span>
                            <span className="text-amber-400 font-bold">Simulado: R$ {novoPrecoSimulado.toFixed(2)}</span>
                            <span>Máximo: R$ {((item.preco_max || item.preco_alvo * 1.5)).toFixed(2)}</span>
                          </div>

                          <input
                            type="range"
                            min={Math.floor(item.custo_total * 0.9)}
                            max={Math.ceil((item.preco_max || item.preco_alvo * 1.5))}
                            step="1"
                            value={novoPrecoSimulado}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setPrecosSimulados(prev => ({ ...prev, [item.servico_preco_id]: val }));
                            }}
                            className="w-full h-2 bg-graphite-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                          />

                          {/* Régua Visual do Mercado e Custo */}
                          <div className="relative w-full h-6 bg-graphite-800 rounded-md overflow-hidden border border-graphite-700 text-[10px] font-mono">
                            {/* Faixa de Mercado */}
                            {item.tem_referencia && item.preco_min && item.preco_max && (
                              <div 
                                className="absolute top-0 bottom-0 bg-amber-500/20 border-x border-amber-500/40"
                                style={{
                                  left: `${Math.max(0, Math.min(100, ((item.preco_min - item.custo_total * 0.9) / ((item.preco_max || item.preco_alvo * 1.5) - item.custo_total * 0.9)) * 100))}%`,
                                  width: `${Math.max(5, Math.min(100, ((item.preco_max - item.preco_min) / ((item.preco_max || item.preco_alvo * 1.5) - item.custo_total * 0.9)) * 100))}%`
                                }}
                                title="Faixa de Mercado"
                              />
                            )}

                            {/* Marcação do Custo Total */}
                            <div 
                              className="absolute top-0 bottom-0 w-0.5 bg-flare-400 z-10"
                              style={{ left: `${Math.max(0, Math.min(100, ((item.custo_total - item.custo_total * 0.9) / ((item.preco_max || item.preco_alvo * 1.5) - item.custo_total * 0.9)) * 100))}%` }}
                              title="Piso de Custo Real"
                            />

                            {/* Marcador do Preço Simulado */}
                            <div 
                              className="absolute top-0 bottom-0 w-2 bg-amber-500 rounded-sm z-20 shadow-md transform -translate-x-1/2"
                              style={{ left: `${Math.max(0, Math.min(100, ((novoPrecoSimulado - item.custo_total * 0.9) / ((item.preco_max || item.preco_alvo * 1.5) - item.custo_total * 0.9)) * 100))}%` }}
                            />
                          </div>
                        </div>

                        {/* Input Direto */}
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-mono text-vapor-400 block uppercase">
                            Preço Simulado (R$)
                          </label>
                          <input
                            type="number"
                            step="1"
                            value={novoPrecoSimulado}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setPrecosSimulados(prev => ({ ...prev, [item.servico_preco_id]: isNaN(val) ? 0 : val }));
                            }}
                            className="w-full bg-graphite-950 border border-graphite-600 rounded-lg px-3 py-2 font-mono text-base text-vapor-100 font-bold outline-none focus:border-amber-500 text-right"
                          />
                        </div>
                      </div>

                      {/* FRASE DE IMPACTO FINANCEIRO QUE MOVE O DONO */}
                      <div className="p-4 rounded-xl bg-graphite-950 border border-graphite-700 flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div className="space-y-1 text-center sm:text-left">
                          <div className="text-xs font-sans text-vapor-300">
                            {lucroAMaisMes > 0 ? (
                              <span className="text-mint-400 font-bold text-sm leading-relaxed block">
                                🔥 Cobrando R$ {novoPrecoSimulado.toFixed(2)} você ganha R$ {lucroAMaisMes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} a mais por mês
                              </span>
                            ) : lucroAMaisMes < 0 ? (
                              <span className="text-flare-400 font-bold text-sm leading-relaxed block">
                                ⚠️ Reduzindo para R$ {novoPrecoSimulado.toFixed(2)}, seu lucro reduz R$ {Math.abs(lucroAMaisMes).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} por mês
                              </span>
                            ) : (
                              <span className="text-vapor-300 font-bold text-sm leading-relaxed block">
                                Mantendo R$ {novoPrecoSimulado.toFixed(2)}, seu lucro continua R$ {lucroPorCarroSimulado.toFixed(2)} por carro
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-vapor-400 font-mono">
                            Margem resultante: <strong className="text-vapor-100">{margemSimulada.toFixed(1)}%</strong> | Lucro unitário: <strong className="text-vapor-100">R$ {lucroPorCarroSimulado.toFixed(2)} / carro</strong>
                          </p>
                        </div>

                        <Button
                          variant="primary"
                          onClick={() => handleApplySingle(item)}
                          disabled={savingId === item.servico_preco_id}
                          className="w-full sm:w-auto text-xs font-bold px-4 py-2.5 shrink-0 flex items-center justify-center gap-1.5"
                        >
                          <Check size={14} />
                          <span>{savingId === item.servico_preco_id ? 'Salvando...' : `Salvar R$ ${novoPrecoSimulado.toFixed(2)}`}</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
};
