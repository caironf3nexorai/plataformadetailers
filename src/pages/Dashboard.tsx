import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { SportGaugeCard } from '../components/ui/SportGauge';
import { useAuth } from '../contexts/AuthContext';
import { usePermissao } from '../hooks/usePermissao';
import { supabase } from '../lib/supabase';
import {
  Car,
  Clock,
  CheckCircle2,
  AlertTriangle,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Target,
  FileSignature,
  Package,
  FileText,
  AlertCircle,
  Calendar,
  Percent,
  Sparkles,
  ShieldCheck,
  Moon,
  Info,
  CreditCard,
  X,
  ExternalLink,
  Tv,
  Gauge,
  Zap,
} from 'lucide-react';

interface DashboardData {
  agora: {
    carros_na_oficina: number;
    em_execucao: number;
    aguardando_inicio: number;
    concluidos_hoje: number;
    atrasados_entrega: number;
    pernoite_hoje: number;
    previsao_atraso_lista: Array<{
      agendamento_id: string;
      cliente_nome: string;
      veiculo_modelo: string;
      servico_nome: string;
      previsao_entrega: string;
      minutos_atraso: number;
    }>;
  };
  dinheiro: {
    faturado_mes: number;
    recebido_mes: number;
    faturamento_mes_anterior: number;
    lucro_liquido_mes_atual: number;
    lucro_liquido_mes_anterior: number;
    a_receber_pendente: number;
    vencido_total: number;
    ticket_medio: number;
    meta: {
      id: string;
      mes: string;
      tipo: 'faturamento' | 'lucro_liquido' | 'carros';
      valor_meta: number;
      valor_atual: number;
      progresso_pct: number;
    } | null;
  };
  precisa_de_acao: {
    vistorias_sem_assinatura_count: number;
    vistorias_sem_assinatura_lista: any[];
    produtos_estoque_baixo_count: number;
    produtos_estoque_baixo_lista: any[];
    orcamentos_expirando_count: number;
    orcamentos_expirando_lista: any[];
    contas_vencidas_count: number;
    contas_vencidas_lista: any[];
    agendamentos_sem_confirmacao_count: number;
    agendamentos_sem_confirmacao_lista: any[];
    atendimentos_taxa_estimada_count: number;
    atendimentos_taxa_estimada_lista: any[];
  };
  saude: {
    taxa_conversao_orcamentos_pct: number;
    margem_media_pct: number;
    comparativo_faturamento_pct: number;
    comparativo_ticket_pct: number;
    carros_concluidos_mes_atual: number;
    carros_concluidos_mes_anterior: number;
  };
}

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { tenant } = useAuth();
  const { isOperador } = usePermissao();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtroPeriodo, setFiltroPeriodo] = useState<'hoje' | '7dias' | '30dias' | 'este_mes' | 'mes_passado'>('este_mes');
  const [modalAcao, setModalAcao] = useState<{
    titulo: string;
    tipo: 'vistorias' | 'estoque' | 'orcamentos' | 'contas' | 'sem_confirmacao' | 'taxas';
    itens: any[];
  } | null>(null);

  const [treinamentoOnboarding, setTreinamentoOnboarding] = useState<{
    total: number;
    concluidos: number;
  } | null>(null);
  const [dismissedTreinamento, setDismissedTreinamento] = useState(() => {
    return localStorage.getItem('dismiss_onboarding_treinamento') === 'true';
  });

  useEffect(() => {
    const fetchTreinamentosOnboarding = async () => {
      try {
        const { data: vids } = await supabase.rpc('obter_treinamentos_assinante');
        if (vids && Array.isArray(vids)) {
          const essenciais = vids.filter((v: any) => v.essencial);
          if (essenciais.length > 0) {
            const concluidos = essenciais.filter((v: any) => v.concluido).length;
            setTreinamentoOnboarding({
              total: essenciais.length,
              concluidos
            });
          }
        }
      } catch (err) {
        console.error('[Dashboard] Erro ao carregar treinamentos de onboarding:', err);
      }
    };

    if (!isOperador && tenant) {
      fetchTreinamentosOnboarding();
    }
  }, [tenant?.id, isOperador]);

  // Se o usuário for operador, redireciona para a visão do dia na Agenda
  useEffect(() => {
    if (isOperador) {
      navigate('/agenda', { replace: true });
    }
  }, [isOperador, navigate]);

  const carregarDashboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('dashboard_dono');

      if (rpcError) {
        throw rpcError;
      }

      setData(rpcData as DashboardData);
    } catch (err: any) {
      console.error('[Dashboard RPC Error]:', err);
      setError(err.message || 'Erro ao carregar dados do dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOperador) {
      carregarDashboard();
    }
  }, [tenant?.id, isOperador]);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(val || 0);
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6 animate-pulse p-4">
        <div className="h-8 bg-graphite-800 rounded w-64" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="h-28 bg-graphite-800 rounded-xl" />
          <div className="h-28 bg-graphite-800 rounded-xl" />
          <div className="h-28 bg-graphite-800 rounded-xl" />
          <div className="h-28 bg-graphite-800 rounded-xl" />
        </div>
        <div className="h-44 bg-graphite-800 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
        <AlertCircle size={48} className="text-flare-400" />
        <h2 className="font-display text-xl text-vapor-100 uppercase">Falha ao carregar Dashboard</h2>
        <p className="font-sans text-vapor-400 text-sm max-w-md">{error}</p>
        <Button variant="secondary" onClick={carregarDashboard}>
          Tentar Novamente
        </Button>
      </div>
    );
  }

  const agora = data?.agora;
  const dinheiro = data?.dinheiro;
  const acao = data?.precisa_de_acao;
  const saude = data?.saude;

  // Verificação de Empty State para tenants novos sem dados lançados
  const isTenantNovo =
    (agora?.carros_na_oficina === 0) &&
    (dinheiro?.faturado_mes === 0) &&
    (dinheiro?.recebido_mes === 0) &&
    (saude?.carros_concluidos_mes_atual === 0);

  const totalAcoesUrgentes =
    (acao?.vistorias_sem_assinatura_count || 0) +
    (acao?.produtos_estoque_baixo_count || 0) +
    (acao?.orcamentos_expirando_count || 0) +
    (acao?.contas_vencidas_count || 0) +
    (acao?.agendamentos_sem_confirmacao_count || 0) +
    (acao?.atendimentos_taxa_estimada_count || 0);

  return (
    <div className="flex flex-col gap-6 pb-12 max-w-7xl mx-auto w-full">
      {/* CABEÇALHO DO DASHBOARD COM TELEMETRIA & SELETOR DE PERÍODO */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-graphite-800 pb-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl text-vapor-100 uppercase tracking-wide flex items-center gap-2.5">
            <Gauge className="text-amber-500" size={28} />
            <span>Cabine de Gestão</span>
          </h1>
          <p className="font-sans text-xs sm:text-sm text-vapor-400 mt-0.5">
            Visão executiva consolidada e telemetria da sua operação
          </p>
        </div>

        {/* Seletor de Período estilo Cockpit Esportivo */}
        <div className="flex items-center gap-1 bg-graphite-950/90 p-1.5 rounded-xl border border-graphite-700/80 overflow-x-auto scrollbar-none self-start sm:self-auto shadow-inner">
          {[
            { id: 'hoje', label: 'Hoje' },
            { id: '7dias', label: '7 Dias' },
            { id: '30dias', label: '30 Dias' },
            { id: 'este_mes', label: 'Este Mês' },
            { id: 'mes_passado', label: 'Mês Passado' },
          ].map((periodo) => (
            <button
              key={periodo.id}
              type="button"
              onClick={() => setFiltroPeriodo(periodo.id as any)}
              className={`px-3 py-1.5 rounded-lg font-sans text-xs font-semibold whitespace-nowrap transition-all ${
                filtroPeriodo === periodo.id
                  ? 'bg-amber-500 text-graphite-950 shadow-md shadow-amber-500/20 font-bold scale-[1.02]'
                  : 'text-vapor-400 hover:text-vapor-100 hover:bg-graphite-800/80'
              }`}
            >
              {periodo.label}
            </button>
          ))}
        </div>
      </div>

      {/* --------------------------------------------------------------------- */}
      {/* COCKPIT DE TELEMETRIA ESPORTIVA (MANÔMETROS / INSTRUMENT CLUSTER) */}
      {/* --------------------------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm text-vapor-100 uppercase tracking-wider flex items-center gap-2">
            <Zap size={17} className="text-amber-500" />
            <span>Telemetria de Performance</span>
          </h2>
          <span className="font-mono text-[11px] text-amber-500 font-semibold flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
            Cockpit Ativo
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-5">
          {/* Manômetro 1: Volume de Agendamentos / Atendimentos */}
          <SportGaugeCard
            title="Agendamentos"
            variant="cyan"
            icon={Calendar}
            value={saude?.carros_concluidos_mes_atual || agora?.carros_na_oficina || 0}
            min={0}
            max={Math.max(25, (saude?.carros_concluidos_mes_anterior || 0) * 1.4, (saude?.carros_concluidos_mes_atual || 0) * 1.2)}
            formattedValue={`${saude?.carros_concluidos_mes_atual || agora?.carros_na_oficina || 0}`}
            subtitle="Volume total do período"
            badge={
              <Badge tone="glass" className="text-[10px]">
                {saude?.carros_concluidos_mes_anterior ? `vs ${saude.carros_concluidos_mes_anterior} ant.` : 'Ao Vivo'}
              </Badge>
            }
            footerInfo={
              <div className="flex items-center justify-between text-[11px] font-mono text-vapor-400">
                <span>{agora?.carros_na_oficina || 0} na oficina hoje</span>
                <span className="text-glass-400 font-bold">{agora?.em_execucao || 0} em execução</span>
              </div>
            }
            onClick={() => navigate('/agenda')}
          />

          {/* Manômetro 2: Faturamento Total */}
          <SportGaugeCard
            title="Faturamento Total"
            variant="mint"
            icon={DollarSign}
            value={dinheiro?.faturado_mes || 0}
            min={0}
            max={
              dinheiro?.meta?.valor_meta && dinheiro.meta.tipo === 'faturamento'
                ? dinheiro.meta.valor_meta
                : Math.max(10000, (dinheiro?.faturado_mes || 0) * 1.25)
            }
            formattedValue={formatCurrency(dinheiro?.faturado_mes || 0)}
            subtitle="Receitas no período"
            badge={
              <Badge tone="mint" className="text-[10px]">
                {(saude?.comparativo_faturamento_pct || 0) >= 0
                  ? `+${saude?.comparativo_faturamento_pct || 0}%`
                  : `${saude?.comparativo_faturamento_pct || 0}%`}
              </Badge>
            }
            footerInfo={
              <div className="flex items-center justify-between text-[11px] font-mono text-vapor-400">
                <span>Caixa: {formatCurrency(dinheiro?.recebido_mes || 0)}</span>
                <span className="text-mint-400 font-bold">
                  {dinheiro?.lucro_liquido_mes_atual
                    ? `Lucro: ${formatCurrency(dinheiro.lucro_liquido_mes_atual)}`
                    : ''}
                </span>
              </div>
            }
            onClick={() => navigate('/financeiro')}
          />

          {/* Manômetro 3: Meta do Mês / Progresso */}
          <SportGaugeCard
            title={
              dinheiro?.meta
                ? `Meta (${dinheiro.meta.tipo === 'faturamento' ? 'Faturamento' : dinheiro.meta.tipo === 'lucro_liquido' ? 'Lucro' : 'Veículos'})`
                : 'Meta do Mês'
            }
            variant="amber"
            icon={Target}
            value={dinheiro?.meta?.progresso_pct || 0}
            min={0}
            max={100}
            formattedValue={`${dinheiro?.meta?.progresso_pct || 0}%`}
            subtitle={
              dinheiro?.meta
                ? `Alvo: ${
                    dinheiro.meta.tipo === 'carros'
                      ? `${dinheiro.meta.valor_meta} veículos`
                      : formatCurrency(dinheiro.meta.valor_meta)
                  }`
                : 'Defina a meta do mês'
            }
            badge={
              <Badge tone="amber" className="text-[10px]">
                {dinheiro?.meta ? `${dinheiro.meta.progresso_pct}% Atingido` : 'Configurar'}
              </Badge>
            }
            footerInfo={
              <div className="flex items-center justify-between text-[11px] font-mono text-vapor-400">
                <span>
                  Realizado:{' '}
                  {dinheiro?.meta
                    ? dinheiro.meta.tipo === 'carros'
                      ? `${dinheiro.meta.valor_atual} v.`
                      : formatCurrency(dinheiro.meta.valor_atual)
                    : 'R$ 0,00'}
                </span>
                <span className="text-amber-400 font-bold">Ajustar ➔</span>
              </div>
            }
            onClick={() => navigate('/ajustes')}
          />
        </div>
      </section>

      {/* WIDGET DISCRETO: PRIMEIROS PASSOS DA OFICINA (TREINAMENTO ESSENCIAL) */}
      {treinamentoOnboarding &&
        !dismissedTreinamento &&
        treinamentoOnboarding.concluidos < treinamentoOnboarding.total && (
          <Card className="p-5 bg-graphite-800 border-amber-500/40 relative overflow-hidden">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-500 shrink-0">
                  <Tv size={24} />
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-display text-base text-vapor-100 uppercase tracking-wide">
                      Primeiros Passos da Oficina
                    </h3>
                    <Badge tone="amber" className="text-[11px]">
                      {treinamentoOnboarding.concluidos} de {treinamentoOnboarding.total} concluídos
                    </Badge>
                  </div>
                  <p className="font-sans text-xs text-vapor-300">
                    Assista aos treinamentos essenciais para acelerar a configuração da sua oficina e aproveitar ao máximo a plataforma.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 self-end sm:self-center shrink-0">
                <Button
                  onClick={() => navigate('/ajustes?aba=treinamento')}
                  className="text-xs min-h-[38px] px-3.5 bg-amber-500 hover:bg-amber-400 text-graphite-950 font-bold"
                >
                  Assistir Treinamentos
                </Button>
                <button
                  onClick={() => {
                    localStorage.setItem('dismiss_onboarding_treinamento', 'true');
                    setDismissedTreinamento(true);
                  }}
                  className="text-xs text-vapor-400 hover:text-vapor-200 underline px-1 py-1"
                  title="Dispensar aviso de onboarding"
                >
                  Dispensar
                </button>
              </div>
            </div>
          </Card>
      )}

      {/* GUIA DE BOAS-VINDAS / EMPTY STATE PARA NOVOS TENANTS */}
      {isTenantNovo && (
        <Card className="p-6 bg-gradient-to-r from-graphite-800 via-graphite-900 to-graphite-800 border-amber-500/40 relative overflow-hidden">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative z-10">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-500 shrink-0">
                <Sparkles size={28} />
              </div>
              <div className="flex flex-col gap-1">
                <h3 className="font-display text-lg text-vapor-100 uppercase tracking-wide flex items-center gap-2">
                  Bem-vindo ao NuvemWash!
                </h3>
                <p className="font-sans text-sm text-vapor-300 max-w-xl">
                  Seu estabelecimento está pronto para começar. Crie seu primeiro agendamento, cadastre produtos e defina suas metas mensais para ativar os indicadores da sua cabine.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <Button onClick={() => navigate('/agenda')} className="text-xs">
                Novo Agendamento
              </Button>
              <Button variant="secondary" onClick={() => navigate('/ajustes')} className="text-xs">
                Definir Meta do Mês
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* BLOCO 1: AGORA (Operacional em Tempo Real) */}
      {/* --------------------------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base text-vapor-100 uppercase tracking-wider flex items-center gap-2">
            <Clock size={18} className="text-amber-500" />
            <span>Agora na Oficina</span>
          </h2>
          <span className="font-mono text-xs text-vapor-400">Tempo Real</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Card: Carros na Oficina */}
          <Card
            onClick={() => navigate('/agenda')}
            className="p-4 bg-graphite-800 border-graphite-600 hover:border-amber-500/60 transition-all cursor-pointer flex flex-col justify-between gap-2 group"
          >
            <div className="flex items-center justify-between">
              <span className="font-sans text-xs text-vapor-400 font-medium">Na Oficina</span>
              <Car size={16} className="text-vapor-400 group-hover:text-amber-500 transition-colors" />
            </div>
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-2xl font-bold text-vapor-100">
                {agora?.carros_na_oficina || 0}
              </span>
              <span className="font-sans text-[10px] text-vapor-400">hoje</span>
            </div>
          </Card>

          {/* Card: Em Execução */}
          <Card
            onClick={() => navigate('/agenda')}
            className="p-4 bg-graphite-800 border-graphite-600 hover:border-amber-500/60 transition-all cursor-pointer flex flex-col justify-between gap-2 group"
          >
            <div className="flex items-center justify-between">
              <span className="font-sans text-xs text-vapor-400 font-medium">Em Execução</span>
              <Clock size={16} className="text-amber-500 animate-pulse" />
            </div>
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-2xl font-bold text-amber-500">
                {agora?.em_execucao || 0}
              </span>
              <span className="font-sans text-[10px] text-vapor-400">cronômetro</span>
            </div>
          </Card>

          {/* Card: Aguardando Início */}
          <Card
            onClick={() => navigate('/agenda')}
            className="p-4 bg-graphite-800 border-graphite-600 hover:border-amber-500/60 transition-all cursor-pointer flex flex-col justify-between gap-2 group"
          >
            <div className="flex items-center justify-between">
              <span className="font-sans text-xs text-vapor-400 font-medium">Aguardando</span>
              <Calendar size={16} className="text-vapor-400 group-hover:text-amber-500 transition-colors" />
            </div>
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-2xl font-bold text-vapor-100">
                {agora?.aguardando_inicio || 0}
              </span>
              <span className="font-sans text-[10px] text-vapor-400">na fila</span>
            </div>
          </Card>

          {/* Card: Concluídos Hoje */}
          <Card
            onClick={() => navigate('/agenda')}
            className="p-4 bg-graphite-800 border-graphite-600 hover:border-amber-500/60 transition-all cursor-pointer flex flex-col justify-between gap-2 group"
          >
            <div className="flex items-center justify-between">
              <span className="font-sans text-xs text-vapor-400 font-medium">Concluídos</span>
              <CheckCircle2 size={16} className="text-mint-400" />
            </div>
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-2xl font-bold text-mint-400">
                {agora?.concluidos_hoje || 0}
              </span>
              <span className="font-sans text-[10px] text-vapor-400">hoje</span>
            </div>
          </Card>

          {/* Card: Pernoite Hoje */}
          <Card
            onClick={() => navigate('/agenda')}
            className="p-4 bg-graphite-800 border-graphite-600 hover:border-amber-500/60 transition-all cursor-pointer flex flex-col justify-between gap-2 group"
          >
            <div className="flex items-center justify-between">
              <span className="font-sans text-xs text-vapor-400 font-medium">Pernoite Hoje</span>
              <Moon size={16} className="text-indigo-400" />
            </div>
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-2xl font-bold text-vapor-100">
                {agora?.pernoite_hoje || 0}
              </span>
              <span className="font-sans text-[10px] text-vapor-400">dormem hoje</span>
            </div>
          </Card>

          {/* Card: Atrasados Entrega */}
          <Card
            onClick={() => navigate('/agenda')}
            className={`p-4 bg-graphite-800 border-graphite-600 hover:border-amber-500/60 transition-all cursor-pointer flex flex-col justify-between gap-2 group ${
              (agora?.atrasados_entrega || 0) > 0 ? 'border-amber-500/80 bg-amber-500/5' : ''
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-sans text-xs text-vapor-400 font-medium">Atraso Entrega</span>
              <AlertTriangle
                size={16}
                className={(agora?.atrasados_entrega || 0) > 0 ? 'text-amber-500' : 'text-vapor-400'}
              />
            </div>
            <div className="flex items-baseline justify-between">
              <span
                className={`font-mono text-2xl font-bold ${
                  (agora?.atrasados_entrega || 0) > 0 ? 'text-amber-500' : 'text-vapor-100'
                }`}
              >
                {agora?.atrasados_entrega || 0}
              </span>
              <span className="font-sans text-[10px] text-vapor-400">fora do prazo</span>
            </div>
          </Card>
        </div>
      </section>

      {/* --------------------------------------------------------------------- */}
      {/* BLOCO 2: DINHEIRO (Faturamento, Caixa, Competência e Meta) */}
      {/* --------------------------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base text-vapor-100 uppercase tracking-wider flex items-center gap-2">
            <DollarSign size={18} className="text-mint-400" />
            <span>Desempenho Financeiro</span>
          </h2>
          <span className="font-mono text-xs text-vapor-400">Mês Atual</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card: Faturado no Mês (Competência) */}
          <Card
            onClick={() => navigate('/financeiro')}
            className="p-5 bg-graphite-800 border-graphite-600 hover:border-mint-400/60 transition-all cursor-pointer flex flex-col justify-between gap-3 group"
          >
            <div className="flex items-start justify-between">
              <div className="flex flex-col">
                <span className="font-sans text-xs text-vapor-400 font-medium">Faturado no Mês</span>
                <span className="font-mono text-[11px] text-mint-400 font-semibold uppercase">
                  (Regime de Competência)
                </span>
              </div>
              <DollarSign size={18} className="text-mint-400" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-mono text-2xl font-bold text-vapor-100">
                {formatCurrency(dinheiro?.faturado_mes || 0)}
              </span>
              <span className="font-sans text-xs text-vapor-400">
                Execuções concluídas neste mês
              </span>
            </div>
          </Card>

          {/* Card: Recebido no Mês (Caixa) */}
          <Card
            onClick={() => navigate('/financeiro')}
            className="p-5 bg-graphite-800 border-graphite-600 hover:border-mint-400/60 transition-all cursor-pointer flex flex-col justify-between gap-3 group"
          >
            <div className="flex items-start justify-between">
              <div className="flex flex-col">
                <span className="font-sans text-xs text-vapor-400 font-medium">Recebido no Mês</span>
                <span className="font-mono text-[11px] text-amber-500 font-semibold uppercase">
                  (Regime de Caixa)
                </span>
              </div>
              <CreditCard size={18} className="text-amber-500" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-mono text-2xl font-bold text-vapor-100">
                {formatCurrency(dinheiro?.recebido_mes || 0)}
              </span>
              <span className="font-sans text-xs text-vapor-400">
                Dinheiro efetivamente em caixa
              </span>
            </div>
          </Card>

          {/* Card: Lucro Líquido */}
          <Card
            onClick={() => navigate('/financeiro')}
            className="p-5 bg-graphite-800 border-graphite-600 hover:border-mint-400/60 transition-all cursor-pointer flex flex-col justify-between gap-3 group"
          >
            <div className="flex items-start justify-between">
              <span className="font-sans text-xs text-vapor-400 font-medium">Lucro Líquido</span>
              <TrendingUp size={18} className="text-mint-400" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-mono text-2xl font-bold text-mint-400">
                {formatCurrency(dinheiro?.lucro_liquido_mes_atual || 0)}
              </span>
              <span className="font-sans text-xs text-vapor-400">
                Após custos de materiais e despesas
              </span>
            </div>
          </Card>

          {/* Card: A Receber & Vencidos */}
          <Card
            onClick={() => navigate('/financeiro')}
            className={`p-5 bg-graphite-800 border-graphite-600 hover:border-mint-400/60 transition-all cursor-pointer flex flex-col justify-between gap-3 group ${
              (dinheiro?.vencido_total || 0) > 0 ? 'border-amber-500/70' : ''
            }`}
          >
            <div className="flex items-start justify-between">
              <span className="font-sans text-xs text-vapor-400 font-medium">A Receber / Vencidos</span>
              <AlertCircle
                size={18}
                className={(dinheiro?.vencido_total || 0) > 0 ? 'text-amber-500' : 'text-vapor-400'}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-mono text-2xl font-bold text-vapor-100">
                {formatCurrency(dinheiro?.a_receber_pendente || 0)}
              </span>
              <span
                className={`font-sans text-xs ${
                  (dinheiro?.vencido_total || 0) > 0 ? 'text-amber-500 font-semibold' : 'text-vapor-400'
                }`}
              >
                {(dinheiro?.vencido_total || 0) > 0
                  ? `⚠️ ${formatCurrency(dinheiro?.vencido_total || 0)} em atraso`
                  : 'Nenhum título em atraso'}
              </span>
            </div>
          </Card>
        </div>

        {/* Linha de Meta Mensal */}
        <Card className="p-5 bg-graphite-800 border-graphite-600">
          {dinheiro?.meta ? (
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-500">
                  <Target size={22} />
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-sm text-vapor-100 uppercase tracking-wide">
                      Meta do Mês ({dinheiro.meta.tipo === 'faturamento' ? 'Faturamento' : dinheiro.meta.tipo === 'lucro_liquido' ? 'Lucro Líquido' : 'Veículos Concluídos'})
                    </span>
                    <Badge tone="amber" className="text-[10px]">
                      {dinheiro.meta.progresso_pct}% Atingido
                    </Badge>
                  </div>
                  <span className="font-mono text-xs text-vapor-400">
                    Realizado: {dinheiro.meta.tipo === 'carros' ? `${dinheiro.meta.valor_atual} veículos` : formatCurrency(dinheiro.meta.valor_atual)} | Meta: {dinheiro.meta.tipo === 'carros' ? `${dinheiro.meta.valor_meta} veículos` : formatCurrency(dinheiro.meta.valor_meta)}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3 w-full md:w-64 shrink-0">
                <div className="w-full bg-graphite-950 h-3 rounded-full overflow-hidden border border-graphite-700 p-0.5">
                  <div
                    className="bg-amber-500 h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(dinheiro.meta.progresso_pct, 100)}%` }}
                  />
                </div>
                <Button
                  variant="ghost"
                  onClick={() => navigate('/ajustes')}
                  className="text-xs text-vapor-400 hover:text-vapor-100 shrink-0"
                >
                  Alterar
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Target size={20} className="text-amber-500 shrink-0" />
                <span className="font-sans text-sm text-vapor-300">
                  Nenhuma meta definida para o mês corrente.
                </span>
              </div>
              <Button
                variant="secondary"
                onClick={() => navigate('/ajustes')}
                className="text-xs shrink-0"
              >
                Definir Meta do Mês
              </Button>
            </div>
          )}
        </Card>
      </section>

      {/* --------------------------------------------------------------------- */}
      {/* BLOCO 3: PRECISA DE AÇÃO (Alertas Urgentes em Amber-500) */}
      {/* --------------------------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base text-vapor-100 uppercase tracking-wider flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-500" />
            <span>Precisa de Ação</span>
          </h2>
          {totalAcoesUrgentes > 0 ? (
            <Badge tone="amber" className="text-xs">
              {totalAcoesUrgentes} item(ns) pendente(s)
            </Badge>
          ) : (
            <span className="font-mono text-xs text-mint-400">Tudo sob controle ✨</span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Alerta 1: Vistorias sem Assinatura */}
          <Card
            onClick={() => {
              if (acao?.vistorias_sem_assinatura_count === 1 && acao.vistorias_sem_assinatura_lista?.[0]?.agendamento_id) {
                navigate(`/checkin/${acao.vistorias_sem_assinatura_lista[0].agendamento_id}`);
              } else if ((acao?.vistorias_sem_assinatura_count || 0) > 0) {
                setModalAcao({
                  titulo: 'Vistorias Pendentes de Assinatura',
                  tipo: 'vistorias',
                  itens: acao?.vistorias_sem_assinatura_lista || []
                });
              } else {
                navigate('/agenda');
              }
            }}
            className={`p-4 bg-graphite-800 border-graphite-600 hover:border-amber-500/60 transition-all cursor-pointer flex flex-col justify-between gap-3 group ${
              (acao?.vistorias_sem_assinatura_count || 0) > 0 ? 'border-amber-500/80 bg-amber-500/5' : ''
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileSignature
                  size={18}
                  className={(acao?.vistorias_sem_assinatura_count || 0) > 0 ? 'text-amber-500' : 'text-vapor-400'}
                />
                <span className="font-sans text-xs font-semibold text-vapor-200">Vistorias Pendentes</span>
              </div>
              <span
                className={`font-mono text-lg font-bold ${
                  (acao?.vistorias_sem_assinatura_count || 0) > 0 ? 'text-amber-500' : 'text-vapor-400'
                }`}
              >
                {acao?.vistorias_sem_assinatura_count || 0}
              </span>
            </div>
            <p className="font-sans text-xs text-vapor-400">
              Check-ins abertos aguardando assinatura do cliente.
            </p>
          </Card>

          {/* Alerta 2: Produtos em Estoque Baixo */}
          <Card
            onClick={() => {
              if ((acao?.produtos_estoque_baixo_count || 0) > 0) {
                setModalAcao({
                  titulo: 'Produtos com Estoque Crítico',
                  tipo: 'estoque',
                  itens: acao?.produtos_estoque_baixo_lista || []
                });
              } else {
                navigate('/estoque');
              }
            }}
            className={`p-4 bg-graphite-800 border-graphite-600 hover:border-amber-500/60 transition-all cursor-pointer flex flex-col justify-between gap-3 group ${
              (acao?.produtos_estoque_baixo_count || 0) > 0 ? 'border-amber-500/80 bg-amber-500/5' : ''
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package
                  size={18}
                  className={(acao?.produtos_estoque_baixo_count || 0) > 0 ? 'text-amber-500' : 'text-vapor-400'}
                />
                <span className="font-sans text-xs font-semibold text-vapor-200">Estoque Crítico</span>
              </div>
              <span
                className={`font-mono text-lg font-bold ${
                  (acao?.produtos_estoque_baixo_count || 0) > 0 ? 'text-amber-500' : 'text-vapor-400'
                }`}
              >
                {acao?.produtos_estoque_baixo_count || 0}
              </span>
            </div>
            <p className="font-sans text-xs text-vapor-400">
              Produtos atingiram ou estão abaixo do limite mínimo.
            </p>
          </Card>

          {/* Alerta 3: Orçamentos Expirando */}
          <Card
            onClick={() => {
              if (acao?.orcamentos_expirando_count === 1 && acao.orcamentos_expirando_lista?.[0]?.orcamento_id) {
                navigate(`/orcamentos/${acao.orcamentos_expirando_lista[0].orcamento_id}`);
              } else if ((acao?.orcamentos_expirando_count || 0) > 0) {
                setModalAcao({
                  titulo: 'Orçamentos a Vencer (Próximos 3 Dias)',
                  tipo: 'orcamentos',
                  itens: acao?.orcamentos_expirando_lista || []
                });
              } else {
                navigate('/orcamentos');
              }
            }}
            className={`p-4 bg-graphite-800 border-graphite-600 hover:border-amber-500/60 transition-all cursor-pointer flex flex-col justify-between gap-3 group ${
              (acao?.orcamentos_expirando_count || 0) > 0 ? 'border-amber-500/80 bg-amber-500/5' : ''
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText
                  size={18}
                  className={(acao?.orcamentos_expirando_count || 0) > 0 ? 'text-amber-500' : 'text-vapor-400'}
                />
                <span className="font-sans text-xs font-semibold text-vapor-200">Orçamentos a Vencer</span>
              </div>
              <span
                className={`font-mono text-lg font-bold ${
                  (acao?.orcamentos_expirando_count || 0) > 0 ? 'text-amber-500' : 'text-vapor-400'
                }`}
              >
                {acao?.orcamentos_expirando_count || 0}
              </span>
            </div>
            <p className="font-sans text-xs text-vapor-400">
              Propostas enviadas prestes a perder a validade (3 dias).
            </p>
          </Card>

          {/* Alerta 4: Contas Vencidas */}
          <Card
            onClick={() => {
              if ((acao?.contas_vencidas_count || 0) > 0) {
                setModalAcao({
                  titulo: 'Contas a Receber Vencidas',
                  tipo: 'contas',
                  itens: acao?.contas_vencidas_lista || []
                });
              } else {
                navigate('/financeiro/contas-a-receber');
              }
            }}
            className={`p-4 bg-graphite-800 border-graphite-600 hover:border-amber-500/60 transition-all cursor-pointer flex flex-col justify-between gap-3 group ${
              (acao?.contas_vencidas_count || 0) > 0 ? 'border-amber-500/80 bg-amber-500/5' : ''
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle
                  size={18}
                  className={(acao?.contas_vencidas_count || 0) > 0 ? 'text-amber-500' : 'text-vapor-400'}
                />
                <span className="font-sans text-xs font-semibold text-vapor-200">Contas Vencidas</span>
              </div>
              <span
                className={`font-mono text-lg font-bold ${
                  (acao?.contas_vencidas_count || 0) > 0 ? 'text-amber-500' : 'text-vapor-400'
                }`}
              >
                {acao?.contas_vencidas_count || 0}
              </span>
            </div>
            <p className="font-sans text-xs text-vapor-400">
              Títulos a receber pendentes com data de vencimento ultrapassada.
            </p>
          </Card>

          {/* Alerta 5: Agendamentos Sem Confirmação */}
          <Card
            onClick={() => {
              if (acao?.agendamentos_sem_confirmacao_count === 1 && acao.agendamentos_sem_confirmacao_lista?.[0]?.agendamento_id) {
                navigate(`/atendimento/${acao.agendamentos_sem_confirmacao_lista[0].agendamento_id}`);
              } else if ((acao?.agendamentos_sem_confirmacao_count || 0) > 0) {
                setModalAcao({
                  titulo: 'Agendamentos Sem Confirmação',
                  tipo: 'sem_confirmacao',
                  itens: acao?.agendamentos_sem_confirmacao_lista || []
                });
              } else {
                navigate('/agenda');
              }
            }}
            className={`p-4 bg-graphite-800 border-graphite-600 hover:border-amber-500/60 transition-all cursor-pointer flex flex-col justify-between gap-3 group ${
              (acao?.agendamentos_sem_confirmacao_count || 0) > 0 ? 'border-amber-500/80 bg-amber-500/5' : ''
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar
                  size={18}
                  className={(acao?.agendamentos_sem_confirmacao_count || 0) > 0 ? 'text-amber-500' : 'text-vapor-400'}
                />
                <span className="font-sans text-xs font-semibold text-vapor-200">Sem Confirmação</span>
              </div>
              <span
                className={`font-mono text-lg font-bold ${
                  (acao?.agendamentos_sem_confirmacao_count || 0) > 0 ? 'text-amber-500' : 'text-vapor-400'
                }`}
              >
                {acao?.agendamentos_sem_confirmacao_count || 0}
              </span>
            </div>
            <p className="font-sans text-xs text-vapor-400">
              Agendamentos de hoje/amanhã aguardando confirmação do cliente.
            </p>
          </Card>

          {/* Alerta 6: Atendimentos com Taxa Estimada */}
          <Card
            onClick={() => {
              if ((acao?.atendimentos_taxa_estimada_count || 0) > 0) {
                setModalAcao({
                  titulo: 'Atendimentos com Taxas Estimadas',
                  tipo: 'taxas',
                  itens: acao?.atendimentos_taxa_estimada_lista || []
                });
              } else {
                navigate('/financeiro/taxas');
              }
            }}
            className={`p-4 bg-graphite-800 border-graphite-600 hover:border-amber-500/60 transition-all cursor-pointer flex flex-col justify-between gap-3 group ${
              (acao?.atendimentos_taxa_estimada_count || 0) > 0 ? 'border-amber-500/80 bg-amber-500/5' : ''
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CreditCard
                  size={18}
                  className={(acao?.atendimentos_taxa_estimada_count || 0) > 0 ? 'text-amber-500' : 'text-vapor-400'}
                />
                <span className="font-sans text-xs font-semibold text-vapor-200">Taxas Estimadas</span>
              </div>
              <span
                className={`font-mono text-lg font-bold ${
                  (acao?.atendimentos_taxa_estimada_count || 0) > 0 ? 'text-amber-500' : 'text-vapor-400'
                }`}
              >
                {acao?.atendimentos_taxa_estimada_count || 0}
              </span>
            </div>
            <p className="font-sans text-xs text-vapor-400">
              Recebimentos com taxas de cartão não configuradas (estimadas).
            </p>
          </Card>
        </div>
      </section>

      {/* --------------------------------------------------------------------- */}
      {/* BLOCO 4: SAÚDE DO NEGÓCIO & COMPARATIVOS MÊS ANTERIOR */}
      {/* --------------------------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base text-vapor-100 uppercase tracking-wider flex items-center gap-2">
            <ShieldCheck size={18} className="text-mint-400" />
            <span>Saúde do Negócio</span>
          </h2>
          <span className="font-mono text-xs text-vapor-400">Comparativo Mensal</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Metric: Margem Média */}
          <Card className="p-5 bg-graphite-800 border-graphite-600 flex flex-col justify-between gap-2">
            <span className="font-sans text-xs text-vapor-400 font-medium">Margem Líquida Média</span>
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-2xl font-bold text-mint-400">
                {saude?.margem_media_pct || 0}%
              </span>
              <Percent size={18} className="text-mint-400" />
            </div>
            <span className="font-sans text-[11px] text-vapor-400">
              Lucro Líquido / Faturamento no Mês
            </span>
          </Card>

          {/* Metric: Taxa de Conversão de Orçamentos */}
          <Card className="p-5 bg-graphite-800 border-graphite-600 flex flex-col justify-between gap-2">
            <span className="font-sans text-xs text-vapor-400 font-medium">Conversão Orçamentos</span>
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-2xl font-bold text-vapor-100">
                {saude?.taxa_conversao_orcamentos_pct || 0}%
              </span>
              <Percent size={18} className="text-vapor-400" />
            </div>
            <span className="font-sans text-[11px] text-vapor-400">
              Propostas aprovadas sobre total enviado
            </span>
          </Card>

          {/* Metric: Comparativo Faturamento vs Mês Anterior */}
          <Card className="p-5 bg-graphite-800 border-graphite-600 flex flex-col justify-between gap-2">
            <span className="font-sans text-xs text-vapor-400 font-medium">Crescimento Faturamento</span>
            <div className="flex items-baseline justify-between">
              <span
                className={`font-mono text-2xl font-bold ${
                  (saude?.comparativo_faturamento_pct || 0) >= 0 ? 'text-mint-400' : 'text-flare-400'
                }`}
              >
                {(saude?.comparativo_faturamento_pct || 0) >= 0 ? '+' : ''}
                {saude?.comparativo_faturamento_pct || 0}%
              </span>
              {(saude?.comparativo_faturamento_pct || 0) >= 0 ? (
                <TrendingUp size={18} className="text-mint-400" />
              ) : (
                <TrendingDown size={18} className="text-flare-400" />
              )}
            </div>
            <span className="font-sans text-[11px] text-vapor-400">
              Em relação a {formatCurrency(dinheiro?.faturamento_mes_anterior || 0)} do mês anterior
            </span>
          </Card>

          {/* Metric: Carros Concluídos Comparativo */}
          <Card className="p-5 bg-graphite-800 border-graphite-600 flex flex-col justify-between gap-2">
            <span className="font-sans text-xs text-vapor-400 font-medium">Volume de Atendimentos</span>
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-2xl font-bold text-vapor-100">
                {saude?.carros_concluidos_mes_atual || 0}
              </span>
              <span className="font-mono text-xs text-vapor-400">
                vs {saude?.carros_concluidos_mes_anterior || 0} ant.
              </span>
            </div>
            <span className="font-sans text-[11px] text-vapor-400">
              Veículos com serviço finalizado no mês
            </span>
          </Card>
        </div>
      </section>

      {/* --------------------------------------------------------------------- */}
      {/* NOTA AUDITORIA DE BANCO DE DADOS */}
      {/* --------------------------------------------------------------------- */}
      <footer className="mt-4 p-4 bg-graphite-900/60 rounded-lg border border-graphite-700/60 flex items-start gap-3">
        <Info size={16} className="text-amber-500 shrink-0 mt-0.5" />
        <div className="flex flex-col gap-1 text-xs text-vapor-400 font-sans leading-relaxed">
          <strong className="text-vapor-200 font-semibold">Auditoria de Schema & Estado de Entrega:</strong>
          <span>
            Os status de atendimento auditados no banco acompanham o ciclo de agendamento (Agendado, Confirmado, Em andamento, Concluído) e execução (Em andamento, Pausado, Finalizado). A conclusão da execução marca o atendimento como Concluído instantaneamente, consolidando a produtividade do dia com total integridade.
          </span>
        </div>
      </footer>

      {/* MODAL DETALHADO DE ALERTAS DE AÇÃO */}
      {modalAcao && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <Card className="max-w-xl w-full bg-graphite-900 border-graphite-700 shadow-2xl p-6 flex flex-col gap-4 max-h-[85vh] overflow-hidden">
            <div className="flex items-center justify-between border-b border-graphite-800 pb-3">
              <h3 className="font-display text-base text-vapor-100 uppercase tracking-wide flex items-center gap-2">
                <AlertTriangle size={18} className="text-amber-500" />
                <span>{modalAcao.titulo}</span>
              </h3>
              <button
                type="button"
                onClick={() => setModalAcao(null)}
                className="p-1 rounded-lg text-vapor-400 hover:text-vapor-100 hover:bg-graphite-800 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex flex-col gap-3 overflow-y-auto pr-1">
              {modalAcao.itens.length === 0 ? (
                <p className="text-sm text-vapor-400 text-center py-6">
                  Nenhum item pendente nesta categoria.
                </p>
              ) : (
                modalAcao.itens.map((item: any, idx: number) => (
                  <div
                    key={idx}
                    className="p-3.5 bg-graphite-800 border border-graphite-700 rounded-lg flex items-center justify-between gap-3 hover:border-amber-500/40 transition-colors"
                  >
                    <div className="flex flex-col gap-1 text-xs">
                      {modalAcao.tipo === 'vistorias' && (
                        <>
                          <span className="font-bold text-vapor-100 text-sm">{item.cliente_nome}</span>
                          <span className="text-vapor-300 font-mono">{item.veiculo_modelo || 'Veículo'}</span>
                          <span className="text-[11px] text-vapor-400">
                            Check-in criado em {item.created_at ? new Date(item.created_at).toLocaleDateString('pt-BR') : 'Data n/d'}
                          </span>
                        </>
                      )}

                      {modalAcao.tipo === 'estoque' && (
                        <>
                          <span className="font-bold text-vapor-100 text-sm">{item.nome}</span>
                          <span className="text-vapor-300">{item.marca}</span>
                          <span className="text-[11px] text-amber-400 font-mono">
                            Estoque atual: {item.estoque_atual} / Mínimo: {item.estoque_minimo}
                          </span>
                        </>
                      )}

                      {modalAcao.tipo === 'orcamentos' && (
                        <>
                          <span className="font-bold text-vapor-100 text-sm">
                            Orçamento #{item.numero_os || '00' + (idx + 1)} - {item.cliente_nome}
                          </span>
                          <span className="text-vapor-200 font-mono font-bold">
                            {formatCurrency(item.valor_total)}
                          </span>
                          <span className="text-[11px] text-amber-400">
                            Vencimento em: {item.data_validade_limite}
                          </span>
                        </>
                      )}

                      {modalAcao.tipo === 'contas' && (
                        <>
                          <span className="font-bold text-vapor-100 text-sm">{item.cliente_nome}</span>
                          <span className="text-vapor-200 font-mono font-bold">
                            {formatCurrency(item.valor_bruto)}
                          </span>
                          <span className="text-[11px] text-flare-400 font-semibold">
                            Vencido há {item.dias_atraso} dia(s)
                          </span>
                        </>
                      )}

                      {modalAcao.tipo === 'sem_confirmacao' && (
                        <>
                          <span className="font-bold text-vapor-100 text-sm">{item.cliente_nome}</span>
                          <span className="text-vapor-300">{item.veiculo_modelo} - {item.servico_nome}</span>
                          <span className="text-[11px] text-vapor-400">
                            Agendado para: {item.inicio ? new Date(item.inicio).toLocaleString('pt-BR') : 'Sem data'}
                          </span>
                        </>
                      )}

                      {modalAcao.tipo === 'taxas' && (
                        <>
                          <span className="font-bold text-vapor-100 text-sm">{item.cliente_nome}</span>
                          <span className="text-vapor-200 font-mono font-bold">
                            {formatCurrency(item.valor_bruto)}
                          </span>
                          <span className="text-[11px] text-amber-400">
                            Taxa não configurada (calculada como estimativa)
                          </span>
                        </>
                      )}
                    </div>

                    <Button
                      type="button"
                      variant="primary"
                      className="text-xs h-8 px-3 shrink-0 flex items-center gap-1"
                      onClick={() => {
                        setModalAcao(null);
                        if (modalAcao.tipo === 'vistorias' && item.agendamento_id) {
                          navigate(`/checkin/${item.agendamento_id}`);
                        } else if (modalAcao.tipo === 'estoque') {
                          navigate('/estoque');
                        } else if (modalAcao.tipo === 'orcamentos' && item.orcamento_id) {
                          navigate(`/orcamentos/${item.orcamento_id}`);
                        } else if (modalAcao.tipo === 'contas') {
                          navigate('/financeiro/contas-a-receber');
                        } else if (modalAcao.tipo === 'sem_confirmacao' && item.agendamento_id) {
                          navigate(`/atendimento/${item.agendamento_id}`);
                        } else if (modalAcao.tipo === 'taxas') {
                          navigate('/financeiro/taxas');
                        }
                      }}
                    >
                      <span>Abrir</span>
                      <ExternalLink size={12} />
                    </Button>
                  </div>
                ))
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-graphite-800">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setModalAcao(null)}
                className="text-xs px-4"
              >
                Fechar
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};
