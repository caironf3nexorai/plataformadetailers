import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarClock,
  X,
  Phone,
  MessageSquare,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowUpRight,
  TrendingUp,
  Receipt,
  FileCheck,
  Check,
  Sparkles
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { formatarMoeda, formatTelefone, cleanTelefone } from '../../utils/formatters';
import { useNavigate } from 'react-router-dom';

export interface ClienteCobrancaItem {
  id: string;
  cliente_id: string;
  cliente_nome: string;
  cliente_telefone: string | null;
  valor: number;
  numero_parcela: number;
  total_parcelas: number;
  previsto_para: string;
  dias_atraso: number;
  observacao: string | null;
  status: string;
}

export interface DespesaRadarItem {
  id: string;
  nome: string;
  categoria: string;
  tipo: string;
  valor_mensal: number;
  confirmado: boolean;
  vigencia_inicio: string;
  vigencia_fim: string | null;
}

export interface MetricasRadar {
  total_receber_hoje: number;
  total_receber_atrasado: number;
  total_receber_geral: number;
  total_despesas_pendentes: number;
  total_despesas_mes: number;
  saldo_esperado_hoje: number;
  qtd_vencendo_hoje: number;
  qtd_atrasados: number;
  qtd_cobrancas_total: number;
  qtd_despesas_pendentes: number;
}

interface ModalRadarFinanceiroDoDiaProps {
  aberto: boolean;
  onFechar: () => void;
  onDispensarHoje: () => void;
  dadosIniciais?: {
    clientes_vencendo_hoje: ClienteCobrancaItem[];
    clientes_atrasados: ClienteCobrancaItem[];
    despesas_mes: DespesaRadarItem[];
    metricas: MetricasRadar;
    nome_oficina?: string;
  } | null;
  onItemBaixado?: () => void;
}

export const ModalRadarFinanceiroDoDia: React.FC<ModalRadarFinanceiroDoDiaProps> = ({
  aberto,
  onFechar,
  onDispensarHoje,
  dadosIniciais,
  onItemBaixado,
}) => {
  const { tenant } = useAuth();
  const { showSuccess, showError } = useToast();
  const navigate = useNavigate();

  const [abaAtiva, setAbaAtiva] = useState<'receber' | 'pagar'>('receber');
  const [carregando, setCarregando] = useState(false);
  const [baixandoId, setBaixandoId] = useState<string | null>(null);

  const [vencendoHoje, setVencendoHoje] = useState<ClienteCobrancaItem[]>(
    dadosIniciais?.clientes_vencendo_hoje || []
  );
  const [atrasados, setAtrasados] = useState<ClienteCobrancaItem[]>(
    dadosIniciais?.clientes_atrasados || []
  );
  const [despesas, setDespesas] = useState<DespesaRadarItem[]>(
    dadosIniciais?.despesas_mes || []
  );
  const [metricas, setMetricas] = useState<MetricasRadar | null>(
    dadosIniciais?.metricas || null
  );
  const [nomeOficina, setNomeOficina] = useState<string>(
    dadosIniciais?.nome_oficina || tenant?.nome || 'Nossa Oficina'
  );

  // Recarregar dados se não fornecidos ou se abrir
  const carregarDados = async () => {
    if (!tenant?.id) return;
    setCarregando(true);
    try {
      const { data, error } = await supabase.rpc('obter_radar_financeiro_do_dia');
      if (error) throw error;
      if (data && !data.erro) {
        setVencendoHoje(data.clientes_vencendo_hoje || []);
        setAtrasados(data.clientes_atrasados || []);
        setDespesas(data.despesas_mes || []);
        setMetricas(data.metricas || null);
        if (data.nome_oficina) setNomeOficina(data.nome_oficina);
      }
    } catch (err: any) {
      console.error('Erro ao carregar radar financeiro:', err);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    if (aberto) {
      if (!dadosIniciais) {
        carregarDados();
      } else {
        setVencendoHoje(dadosIniciais.clientes_vencendo_hoje || []);
        setAtrasados(dadosIniciais.clientes_atrasados || []);
        setDespesas(dadosIniciais.despesas_mes || []);
        setMetricas(dadosIniciais.metricas || null);
        if (dadosIniciais.nome_oficina) setNomeOficina(dadosIniciais.nome_oficina);
      }
    }
  }, [aberto, dadosIniciais]);

  if (!aberto) return null;

  // Gerador de mensagem amigável e link direto no WhatsApp
  const handleCobrarWhatsApp = (item: ClienteCobrancaItem, isAtrasado: boolean) => {
    if (!item.cliente_telefone) {
      showError('Este cliente não possui telefone cadastrado.');
      return;
    }

    const telLimpo = cleanTelefone(item.cliente_telefone);
    if (!telLimpo || telLimpo.length < 10) {
      showError('Telefone do cliente é inválido.');
      return;
    }

    const valorFormatado = formatarMoeda(item.valor);
    const parcelaInfo =
      item.total_parcelas > 1
        ? `da parcela ${item.numero_parcela}/${item.total_parcelas}`
        : 'do seu serviço';

    let mensagem = '';
    if (isAtrasado) {
      const dataFormatada = new Date(item.previsto_para + 'T00:00:00').toLocaleDateString('pt-BR');
      mensagem = `Olá, *${item.cliente_nome.trim()}*! Tudo bem? 😊\n\nAqui é da equipe *${nomeOficina}*.\n\nConsta em nosso sistema uma pendência ${parcelaInfo} no valor de *${valorFormatado}*, com vencimento que foi em *${dataFormatada}* (${item.dias_atraso} dias atrás).\n\nGostaríamos de verificar se está tudo certo ou se prefere que enviemos a nossa chave Pix para regularização.\n\nEstamos à disposição para qualquer dúvida!\nMuito obrigado! 🚗✨`;
    } else {
      mensagem = `Olá, *${item.cliente_nome.trim()}*! Tudo bem? 😊\n\nAqui é da equipe *${nomeOficina}*.\n\nPassando apenas para te lembrar com carinho que hoje vence o pagamento ${parcelaInfo} no valor de *${valorFormatado}*.\n\nCaso já tenha efetuado o pagamento, por favor desconsidere este lembrete.\nSe preferir pagar via Pix ou cartão, é só me responder por aqui que te enviamos os dados!\n\nMuito obrigado pela confiança e um ótimo dia! 🚗✨`;
    }

    const numeroCompleto = telLimpo.startsWith('55') ? telLimpo : `55${telLimpo}`;
    const url = `https://wa.me/${numeroCompleto}?text=${encodeURIComponent(mensagem)}`;
    window.open(url, '_blank');
  };

  // Dar baixa imediata com chamada ao backend
  const handleDarBaixa = async (item: ClienteCobrancaItem) => {
    setBaixandoId(item.id);
    try {
      const { data, error } = await supabase.rpc('dar_baixa_recebimento', {
        p_recebimento_id: item.id,
        p_valor_pago: item.valor,
      });

      if (error) throw error;

      showSuccess(data?.mensagem || `Baixa de ${formatarMoeda(item.valor)} confirmada com sucesso!`);

      // Atualiza o estado local imediatamente
      setVencendoHoje((prev) => prev.filter((i) => i.id !== item.id));
      setAtrasados((prev) => prev.filter((i) => i.id !== item.id));

      if (metricas) {
        setMetricas({
          ...metricas,
          total_receber_hoje: item.dias_atraso === 0 ? Math.max(0, metricas.total_receber_hoje - item.valor) : metricas.total_receber_hoje,
          total_receber_atrasado: item.dias_atraso > 0 ? Math.max(0, metricas.total_receber_atrasado - item.valor) : metricas.total_receber_atrasado,
          total_receber_geral: Math.max(0, metricas.total_receber_geral - item.valor),
          qtd_cobrancas_total: Math.max(0, metricas.qtd_cobrancas_total - 1),
        });
      }

      if (onItemBaixado) onItemBaixado();
    } catch (err: any) {
      console.error('Erro ao dar baixa:', err);
      showError(err.message || 'Erro ao registrar baixa.');
    } finally {
      setBaixandoId(null);
    }
  };

  const totalCobrancas = (vencendoHoje.length + atrasados.length);
  const totalDespesasPendentes = despesas.filter((d) => !d.confirmado).length;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-graphite-950/80 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onFechar();
      }}
    >
      <div className="relative w-full max-w-3xl bg-graphite-900 border border-graphite-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] text-vapor-100">
        
        {/* CABEÇALHO DO MODAL */}
        <div className="p-4 sm:p-5 border-b border-graphite-800 bg-gradient-to-r from-graphite-900 via-graphite-850 to-graphite-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <CalendarClock size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-lg sm:text-xl font-bold text-vapor-100 tracking-wide">
                  Radar Financeiro do Dia
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/30">
                  {new Date().toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                </span>
              </div>
              <p className="text-xs text-vapor-400">
                Cobranças de clientes e contas que mexem com o caixa da sua oficina
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar Radar Financeiro"
            className="p-2 rounded-xl text-vapor-400 hover:text-vapor-100 hover:bg-graphite-800 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X size={20} />
          </button>
        </div>

        {/* CARDS RESUMO / MÉTRICAS DO DIA */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 p-4 sm:px-6 bg-graphite-900/60 border-b border-graphite-800/80">
          <div className="bg-graphite-800/60 border border-mint-500/20 rounded-xl p-3 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-mint-400/90 font-medium mb-1">
              <span>A Receber Hoje</span>
              <TrendingUp size={14} className="text-mint-400" />
            </div>
            <div className="font-mono text-base sm:text-lg font-bold text-mint-400 truncate">
              {formatarMoeda(metricas?.total_receber_hoje || 0)}
            </div>
            <span className="text-[11px] text-vapor-400 mt-0.5">
              {vencendoHoje.length} {vencendoHoje.length === 1 ? 'cliente vence hoje' : 'clientes vencem hoje'}
            </span>
          </div>

          <div className="bg-graphite-800/60 border border-flare-500/20 rounded-xl p-3 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-flare-400/90 font-medium mb-1">
              <span>Fiados em Atraso</span>
              <AlertTriangle size={14} className="text-flare-400" />
            </div>
            <div className="font-mono text-base sm:text-lg font-bold text-flare-400 truncate">
              {formatarMoeda(metricas?.total_receber_atrasado || 0)}
            </div>
            <span className="text-[11px] text-vapor-400 mt-0.5">
              {atrasados.length} {atrasados.length === 1 ? 'pendência acumulada' : 'pendências acumuladas'}
            </span>
          </div>

          <div className="col-span-2 sm:col-span-1 bg-graphite-800/60 border border-graphite-700/60 rounded-xl p-3 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-vapor-300 font-medium mb-1">
              <span>Contas do Mês</span>
              <Receipt size={14} className="text-vapor-400" />
            </div>
            <div className="font-mono text-base sm:text-lg font-bold text-vapor-200 truncate">
              {formatarMoeda(metricas?.total_despesas_mes || 0)}
            </div>
            <span className="text-[11px] text-amber-400/90 mt-0.5">
              {totalDespesasPendentes} a confirmar valor
            </span>
          </div>
        </div>

        {/* NAVEGAÇÃO DE ABAS */}
        <div className="flex border-b border-graphite-800 px-4 sm:px-6 bg-graphite-900 pt-2 gap-2">
          <button
            type="button"
            onClick={() => setAbaAtiva('receber')}
            className={`flex items-center gap-2 pb-2.5 px-3 text-xs sm:text-sm font-semibold border-b-2 transition-colors min-h-[44px] ${
              abaAtiva === 'receber'
                ? 'border-amber-400 text-amber-400'
                : 'border-transparent text-vapor-400 hover:text-vapor-200'
            }`}
          >
            <span>Clientes & Fiados</span>
            {totalCobrancas > 0 && (
              <span className="px-2 py-0.5 text-[11px] font-mono rounded-full bg-amber-500/20 text-amber-300 font-bold">
                {totalCobrancas}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setAbaAtiva('pagar')}
            className={`flex items-center gap-2 pb-2.5 px-3 text-xs sm:text-sm font-semibold border-b-2 transition-colors min-h-[44px] ${
              abaAtiva === 'pagar'
                ? 'border-amber-400 text-amber-400'
                : 'border-transparent text-vapor-400 hover:text-vapor-200'
            }`}
          >
            <span>Contas a Pagar</span>
            {despesas.length > 0 && (
              <span className="px-2 py-0.5 text-[11px] font-mono rounded-full bg-graphite-700 text-vapor-300">
                {despesas.length}
              </span>
            )}
          </button>
        </div>

        {/* CONTEÚDO SCROLLÁVEL */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {carregando ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-vapor-400">
              <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs">Consultando contas e cobranças do dia...</span>
            </div>
          ) : (
            <>
              {/* ABA 1: CLIENTES & FIADOS A RECEBER */}
              {abaAtiva === 'receber' && (
                <div className="space-y-6">
                  {totalCobrancas === 0 ? (
                    <div className="py-12 text-center flex flex-col items-center gap-3 bg-graphite-850/40 border border-graphite-800 rounded-xl p-6">
                      <div className="w-12 h-12 rounded-full bg-mint-500/10 flex items-center justify-center text-mint-400">
                        <CheckCircle2 size={28} />
                      </div>
                      <h3 className="font-display font-bold text-vapor-100 text-base">
                        Tudo em dia por aqui!
                      </h3>
                      <p className="text-xs text-vapor-400 max-w-sm">
                        Nenhum cliente com fiado vencido ou parcela com vencimento para hoje. Excelente gestão de recebimentos!
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          onFechar();
                          navigate('/financeiro/contas-a-receber');
                        }}
                        className="mt-2 text-xs font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-1.5 min-h-[44px]"
                      >
                        Ver todas as contas a receber
                        <ArrowUpRight size={14} />
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* SEÇÃO 1: VENCENDO HOJE */}
                      {vencendoHoje.length > 0 && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                              <Clock size={14} />
                              <span>Vencendo Hoje ({vencendoHoje.length})</span>
                            </h3>
                            <span className="font-mono text-xs font-semibold text-mint-400">
                              Total: {formatarMoeda(vencendoHoje.reduce((acc, i) => acc + i.valor, 0))}
                            </span>
                          </div>

                          <div className="space-y-2.5">
                            {vencendoHoje.map((item) => (
                              <div
                                key={item.id}
                                className="bg-graphite-800/70 border border-amber-500/30 rounded-xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-amber-500/50 transition-all shadow-sm"
                              >
                                <div className="space-y-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-display font-bold text-sm sm:text-base text-vapor-100 truncate">
                                      {item.cliente_nome}
                                    </span>
                                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/40">
                                      VENCE HOJE
                                    </span>
                                    {item.total_parcelas > 1 && (
                                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-graphite-700 text-vapor-300 font-medium">
                                        Parcela {item.numero_parcela}/{item.total_parcelas}
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-3 text-xs text-vapor-400 flex-wrap">
                                    {item.cliente_telefone ? (
                                      <span className="flex items-center gap-1">
                                        <Phone size={12} className="text-vapor-400" />
                                        {formatTelefone(item.cliente_telefone)}
                                      </span>
                                    ) : (
                                      <span className="text-flare-400/80 italic">Sem telefone cadastrado</span>
                                    )}

                                    {item.observacao && (
                                      <span className="text-vapor-400 truncate max-w-xs">
                                        • {item.observacao}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t border-graphite-700/50 sm:border-0">
                                  <div className="text-left sm:text-right">
                                    <span className="text-[10px] uppercase font-semibold text-vapor-400 block">
                                      Valor
                                    </span>
                                    <span className="font-mono text-base font-bold text-mint-400">
                                      {formatarMoeda(item.valor)}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    {item.cliente_telefone && (
                                      <button
                                        type="button"
                                        onClick={() => handleCobrarWhatsApp(item, false)}
                                        title="Cobrar cliente no WhatsApp com mensagem educada"
                                        className="h-10 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-1.5 transition-colors shadow-sm min-h-[44px]"
                                      >
                                        <MessageSquare size={15} />
                                        <span className="hidden sm:inline">WhatsApp</span>
                                        <span className="sm:hidden">Cobrar</span>
                                      </button>
                                    )}

                                    <button
                                      type="button"
                                      disabled={baixandoId === item.id}
                                      onClick={() => handleDarBaixa(item)}
                                      title="Confirmar recebimento do pagamento"
                                      className="h-10 px-3 rounded-lg bg-graphite-700 hover:bg-graphite-600 text-mint-400 font-semibold text-xs flex items-center gap-1.5 transition-colors border border-graphite-600 min-h-[44px]"
                                    >
                                      {baixandoId === item.id ? (
                                        <div className="w-4 h-4 border-2 border-mint-400 border-t-transparent rounded-full animate-spin" />
                                      ) : (
                                        <>
                                          <Check size={15} />
                                          <span>Dar Baixa</span>
                                        </>
                                      )}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* SEÇÃO 2: EM ATRASO (FIADOS ANTERIORES) */}
                      {atrasados.length > 0 && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h3 className="text-xs font-bold text-flare-400 uppercase tracking-wider flex items-center gap-1.5">
                              <AlertTriangle size={14} />
                              <span>Fiados em Atraso ({atrasados.length})</span>
                            </h3>
                            <span className="font-mono text-xs font-semibold text-flare-400">
                              Total: {formatarMoeda(atrasados.reduce((acc, i) => acc + i.valor, 0))}
                            </span>
                          </div>

                          <div className="space-y-2.5">
                            {atrasados.map((item) => (
                              <div
                                key={item.id}
                                className="bg-graphite-800/70 border border-flare-500/30 rounded-xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-flare-500/50 transition-all shadow-sm"
                              >
                                <div className="space-y-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-display font-bold text-sm sm:text-base text-vapor-100 truncate">
                                      {item.cliente_nome}
                                    </span>
                                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-flare-500/20 text-flare-300 font-bold border border-flare-500/40">
                                      {item.dias_atraso} {item.dias_atraso === 1 ? 'DIA ATRASADO' : 'DIAS ATRASADOS'}
                                    </span>
                                    {item.total_parcelas > 1 && (
                                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-graphite-700 text-vapor-300 font-medium">
                                        Parcela {item.numero_parcela}/{item.total_parcelas}
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-3 text-xs text-vapor-400 flex-wrap">
                                    <span className="text-vapor-300">
                                      Venceu em: {new Date(item.previsto_para + 'T00:00:00').toLocaleDateString('pt-BR')}
                                    </span>

                                    {item.cliente_telefone ? (
                                      <span className="flex items-center gap-1">
                                        <Phone size={12} className="text-vapor-400" />
                                        {formatTelefone(item.cliente_telefone)}
                                      </span>
                                    ) : (
                                      <span className="text-flare-400/80 italic">Sem telefone</span>
                                    )}

                                    {item.observacao && (
                                      <span className="text-vapor-400 truncate max-w-xs">
                                        • {item.observacao}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t border-graphite-700/50 sm:border-0">
                                  <div className="text-left sm:text-right">
                                    <span className="text-[10px] uppercase font-semibold text-vapor-400 block">
                                      Pendente
                                    </span>
                                    <span className="font-mono text-base font-bold text-flare-400">
                                      {formatarMoeda(item.valor)}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    {item.cliente_telefone && (
                                      <button
                                        type="button"
                                        onClick={() => handleCobrarWhatsApp(item, true)}
                                        title="Cobrar pendência no WhatsApp com mensagem educada"
                                        className="h-10 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-1.5 transition-colors shadow-sm min-h-[44px]"
                                      >
                                        <MessageSquare size={15} />
                                        <span className="hidden sm:inline">WhatsApp</span>
                                        <span className="sm:hidden">Cobrar</span>
                                      </button>
                                    )}

                                    <button
                                      type="button"
                                      disabled={baixandoId === item.id}
                                      onClick={() => handleDarBaixa(item)}
                                      title="Confirmar recebimento do pagamento"
                                      className="h-10 px-3 rounded-lg bg-graphite-700 hover:bg-graphite-600 text-mint-400 font-semibold text-xs flex items-center gap-1.5 transition-colors border border-graphite-600 min-h-[44px]"
                                    >
                                      {baixandoId === item.id ? (
                                        <div className="w-4 h-4 border-2 border-mint-400 border-t-transparent rounded-full animate-spin" />
                                      ) : (
                                        <>
                                          <Check size={15} />
                                          <span>Dar Baixa</span>
                                        </>
                                      )}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ABA 2: CONTAS A PAGAR / DESPESAS DO MÊS */}
              {abaAtiva === 'pagar' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xs font-bold text-vapor-200 uppercase tracking-wider">
                        Contas & Despesas do Mês
                      </h3>
                      <p className="text-xs text-vapor-400">
                        Custos previstos e variáveis que impactam o custo/hora da oficina
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        onFechar();
                        navigate('/configuracoes');
                      }}
                      className="text-xs font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-1 min-h-[44px]"
                    >
                      <span>Gerenciar Contas</span>
                      <ArrowUpRight size={14} />
                    </button>
                  </div>

                  {despesas.length === 0 ? (
                    <div className="py-10 text-center flex flex-col items-center gap-2 bg-graphite-850/40 border border-graphite-800 rounded-xl p-4">
                      <Receipt size={32} className="text-vapor-400" />
                      <p className="text-xs text-vapor-400">
                        Nenhuma despesa cadastrada para este mês.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {despesas.map((d) => (
                        <div
                          key={d.id}
                          className="bg-graphite-800/60 border border-graphite-700/60 rounded-xl p-3 sm:p-3.5 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-sm text-vapor-100 truncate">
                                {d.nome}
                              </span>
                              <span className="text-[10px] px-2 py-0.5 rounded bg-graphite-700 text-vapor-300">
                                {d.categoria}
                              </span>
                              {!d.confirmado && (
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/30">
                                  Pendente Confirmação
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-vapor-400 block mt-0.5">
                              Tipo: {d.tipo === 'variavel' ? 'Variável (Luz, Água, etc.)' : d.tipo === 'parcelada' ? 'Parcelada' : 'Recorrente'}
                            </span>
                          </div>

                          <div className="text-right">
                            <span className="font-mono text-sm sm:text-base font-bold text-vapor-200 block">
                              {formatarMoeda(d.valor_mensal)}
                            </span>
                            <span className="text-[10px] text-vapor-400">
                              {d.confirmado ? 'Confirmado' : 'Estimado'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* RODAPÉ DE AÇÕES */}
        <div className="p-4 sm:p-5 border-t border-graphite-800 bg-graphite-900 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-vapor-400 w-full sm:w-auto">
            <Sparkles size={15} className="text-amber-400 shrink-0" />
            <span>Este alerta abre 1x por dia ao entrar no sistema.</span>
          </div>

          <div className="flex items-center justify-end gap-2.5 w-full sm:w-auto">
            <button
              type="button"
              onClick={onFechar}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-graphite-700 hover:bg-graphite-800 text-vapor-300 font-medium text-xs transition-colors min-h-[44px]"
            >
              Lembrar mais tarde
            </button>

            <button
              type="button"
              onClick={onDispensarHoje}
              className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-graphite-950 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors shadow-md min-h-[44px]"
            >
              <FileCheck size={16} />
              <span>Entendi / Fechar por hoje</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
