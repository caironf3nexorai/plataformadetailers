import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { usePermissao } from '../hooks/usePermissao';
import { PageHeader } from '../components/layout/PageHeader';
import { StatValue } from '../components/ui/StatValue';
import { Card } from '../components/ui/Card';
import { ServiceChip } from '../components/ui/ServiceChip';
import { Badge } from '../components/ui/Badge';

import {
  Calendar,
  Clock,
  Plus,
  ClipboardCheck,
  Eye,
  Play,
  Pause,
  CheckCircle2,
  AlertTriangle,
  History,
  DollarSign,
} from 'lucide-react';
import type { Agendamento } from '../types/agenda';
import { navegarParaAtendimento } from '../utils/navegacaoAtendimento';
import { getLabelFromStatus, getBadgeToneFromStatus } from '../utils/agenda';
import { formatarHora, formatarDataIsoSP } from '../utils/datas';
import { formatValorMoeda } from '../utils/precos';
import { formatarOS } from '../utils/formatters';
import { obterEstadoDerivadoCronometro, notificarAtualizacaoTempo, type EstadoCronometroDerivado } from '../hooks/useTempoExecucao';
import { PainelAgendamento } from '../components/agenda/PainelAgendamento';
import { ModalEntradaAvulsa } from '../components/checkin/ModalEntradaAvulsa';
import { MilestoneCelebrationModal } from '../components/ui/MilestoneCelebrationModal';
import { useMilestoneCheck } from '../hooks/useMilestoneCheck';
import { Cronometro } from '../components/execucao/Cronometro';
import { ModalFinalizarExecucao } from '../components/execucao/ModalFinalizarExecucao';
import { obterAcaoAgendamento } from '../utils/acaoAgendamento';
import { BannerAlertaLimites } from '../components/layout/BannerAlertaLimites';
import { obterNivelAlertaTempo } from '../utils/cronometro';

export const Hoje: React.FC = () => {
  const navigate = useNavigate();
  const { tenant, membership } = useAuth();
  const { podeVerValor } = usePermissao();
  const { activeMilestone, dismissMilestone, checkMilestone } = useMilestoneCheck();
  const isGestor = membership?.role === 'dono' || membership?.role === 'gerente';

  const [agendamentosHoje, setAgendamentosHoje] = useState<Agendamento[]>([]);
  const [execucoesAbertas, setExecucoesAbertas] = useState<any[]>([]);
  const [orcamentosAprovadosCount, setOrcamentosAprovadosCount] = useState<number>(0);
  const [agendamentosPendentes, setAgendamentosPendentes] = useState<any[]>([]);

  const [checkinsMap, setCheckinsMap] = useState<
    Record<
      string,
      { id: string; finalizado: boolean; token_aceite?: string; enviado_em?: string; aceite_tipo?: string }
    >
  >({});
  const [execucoesMap, setExecucoesMap] = useState<
    Record<
      string,
      {
        id: string;
        status: string;
        valor_total_final: number | null;
        iniciado_em?: string;
        segundos_pausados?: number;
        pausado_em?: string | null;
        totalItens?: number;
        concluidosCount?: number;
      }
    >
  >({});

  const [loading, setLoading] = useState(true);
  const [startingExecId, setStartingExecId] = useState<string | null>(null);
  const [startingCheckinId, setStartingCheckinId] = useState<string | null>(null);
  const [pauseActionLoading, setPauseActionLoading] = useState<string | null>(null);

  // Modal Entrada Avulsa
  const [isModalEntradaOpen, setIsModalEntradaOpen] = useState(false);

  // Painel de Agendamento Selecionado
  const [selectedAgendamento, setSelectedAgendamento] = useState<Agendamento | null>(null);
  const [isPainelOpen, setIsPainelOpen] = useState(false);

  // Modal Finalização da Execução
  const [modalFinalizarState, setModalFinalizarState] = useState<{
    execucaoId: string;
    agendamento: any;
    iniciadoEm: string;
    duracaoEstimadaMinutos: number;
    pendingRequiredCount: number;
    pendingRequiredNames: string[];
    tempoFormatado: string;
    totalItens: number;
    concluidosCount: number;
    modoRetroativoInicial?: boolean;
    modoDefinirValorOnly?: boolean;
  } | null>(null);

  const fetchHojeData = async (isSilent = false) => {
    if (!tenant) return;
    if (!isSilent && agendamentosHoje.length === 0) {
      setLoading(true);
    }

    try {
      const todayStr = formatarDataIsoSP(new Date());
      const startStr = `${todayStr}T00:00:00-03:00`;
      const endStr = `${todayStr}T23:59:59-03:00`;

      // 1. EXECUÇÕES EM ANDAMENTO/PAUSADAS (TODAS AS ABERTAS DO TENANT, INDEPENDE DA DATA DO AGENDAMENTO)
      const { data: openExecsData, error: openErr } = await supabase
        .from('execucoes')
        .select(`
          id,
          agendamento_id,
          status,
          iniciado_em,
          segundos_pausados,
          pausado_em,
          retomado_em,
          valor_total_final,
          execucao_itens(id, concluido, obrigatorio, descricao),
          agendamento:agendamentos(
            *,
            cliente:clientes(id, nome, telefone),
            veiculo:veiculos(id, placa, modelo, marca),
            servico:servicos(id, nome, codigo, tom, grupo),
            categoria:categorias_veiculo(id, nome),
            agendamento_itens(
              id,
              duracao_minutos,
              preco_estimado,
              servicos(id, nome, codigo, tom, grupo)
            )
          )
        `)
        .eq('tenant_id', tenant.id)
        .in('status', ['em_andamento', 'pausado'])
        .order('iniciado_em', { ascending: true });

      if (openErr) throw openErr;
      const openList = (openExecsData as any[]) || [];
      setExecucoesAbertas(openList);

      // Orçamentos aprovados aguardando agendamento
      const { count: approvedCount } = await supabase
        .from('orcamentos')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant.id)
        .eq('status', 'aprovado')
        .is('agendamento_id', null);

      setOrcamentosAprovadosCount(approvedCount || 0);

      // Expirar sinais pendentes vencidos (>24h)
      await supabase.rpc('expirar_sinais_pendentes', { p_tenant_id: tenant.id });

      // Buscar agendamentos online pendentes de confirmação ou de sinal
      const { data: pendentesData } = await supabase
        .from('agendamentos')
        .select(`
          *,
          cliente:clientes(id, nome, telefone),
          veiculo:veiculos(id, placa, modelo, marca),
          servico:servicos(id, nome)
        `)
        .eq('tenant_id', tenant.id)
        .or('status.eq.aguardando_confirmacao,sinal_status.eq.pendente')
        .order('created_at', { ascending: false });

      setAgendamentosPendentes((pendentesData as any[]) || []);



      // 2. AGENDAMENTOS DO DIA SELECIONADO
      const { data, error } = await supabase
        .from('agendamentos')
        .select(`
          *,
          cliente:clientes(id, nome, telefone),
          veiculo:veiculos(id, placa, modelo, marca),
          servico:servicos(id, nome, codigo, tom, grupo),
          categoria:categorias_veiculo(id, nome),
          agendamento_itens(
            id,
            duracao_minutos,
            preco_estimado,
            servicos(id, nome, codigo, tom, grupo)
          )
        `)
        .eq('tenant_id', tenant.id)
        .gte('inicio', startStr)
        .lte('inicio', endStr)
        .order('inicio', { ascending: true });

      if (error) throw error;
      const agList = (data as any[]) || [];
      setAgendamentosHoje(agList);

      if (agList.length > 0 || openList.length > 0) {
        const allAgIds = Array.from(
          new Set([...agList.map((a) => a.id), ...openList.map((o) => o.agendamento_id)])
        );

        // Check-ins
        const { data: chkData } = await supabase
          .from('checkins')
          .select('id, agendamento_id, finalizado, token_aceite, enviado_em, aceite_tipo')
          .in('agendamento_id', allAgIds);

        const chkMap: Record<
          string,
          { id: string; finalizado: boolean; token_aceite?: string; enviado_em?: string; aceite_tipo?: string }
        > = {};
        if (chkData) {
          chkData.forEach((c) => {
            chkMap[c.agendamento_id] = {
              id: c.id,
              finalizado: c.finalizado,
              token_aceite: c.token_aceite,
              enviado_em: c.enviado_em,
              aceite_tipo: c.aceite_tipo,
            };
          });
        }
        setCheckinsMap(chkMap);

        // Execuções para o mapa
        const { data: execData } = await supabase
          .from('execucoes')
          .select('id, agendamento_id, status, valor_total_final, iniciado_em, segundos_pausados, pausado_em, retomado_em, execucao_itens(id, concluido)')
          .in('agendamento_id', allAgIds);

        const exMap: Record<
          string,
          {
            id: string;
            status: string;
            valor_total_final: number | null;
            iniciado_em?: string;
            segundos_pausados?: number;
            pausado_em?: string | null;
            retomado_em?: string | null;
            totalItens?: number;
            concluidosCount?: number;
          }
        > = {};
        if (execData) {
          execData.forEach((e: any) => {
            const itens = e.execucao_itens || [];
            exMap[e.agendamento_id] = {
              id: e.id,
              status: e.status,
              valor_total_final: e.valor_total_final,
              iniciado_em: e.iniciado_em,
              segundos_pausados: e.segundos_pausados || 0,
              pausado_em: e.pausado_em,
              retomado_em: e.retomado_em,
              totalItens: itens.length,
              concluidosCount: itens.filter((i: any) => i.concluido).length,
            };
          });
        }
        setExecucoesMap(exMap);
      } else {
        setCheckinsMap({});
        setExecucoesMap({});
      }
    } catch (err) {
      console.error('[Hoje] erro ao buscar dados:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHojeData(agendamentosHoje.length > 0);
  }, [tenant?.id]);

  // Realtime Supabase para sincronização ao vivo na tela Hoje
  useEffect(() => {
    if (!tenant?.id) return;

    const channel = supabase
      .channel(`realtime-hoje-${tenant.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'agendamentos',
          filter: `tenant_id=eq.${tenant.id}`
        },
        () => {
          console.log('[Realtime Hoje] Alteração em agendamentos detectada, atualizando...');
          fetchHojeData(true);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'execucoes',
          filter: `tenant_id=eq.${tenant.id}`
        },
        () => {
          console.log('[Realtime Hoje] Alteração em execucoes detectada, atualizando...');
          fetchHojeData(true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenant?.id]);

  const handleConfirmarOnline = async (agendamentoId: string) => {
    try {
      const { error } = await supabase.rpc('confirmar_agendamento_online', {
        p_agendamento_id: agendamentoId
      });
      if (error) throw error;
      await fetchHojeData();
    } catch (err: any) {
      console.error('[Hoje] Erro ao confirmar agendamento:', err);
    }
  };

  const handleRecusarOnline = async (agendamentoId: string) => {
    try {
      const { error } = await supabase.rpc('recusar_agendamento_online', {
        p_agendamento_id: agendamentoId,
        p_motivo: 'Recusado pelo estabelecimento'
      });
      if (error) throw error;
      await fetchHojeData();
    } catch (err: any) {
      console.error('[Hoje] Erro ao recusar agendamento:', err);
    }
  };

  const handleRegistrarSinalPago = async (agendamentoId: string) => {
    try {
      const { error } = await supabase.rpc('registrar_sinal_pago', {
        p_agendamento_id: agendamentoId
      });
      if (error) throw error;
      await fetchHojeData();
    } catch (err: any) {
      console.error('[Hoje] Erro ao registrar sinal pago:', err);
    }
  };

  useEffect(() => {
    fetchHojeData();
  }, [tenant?.id]);

  // Função para Iniciar Serviço
  const handleIniciarServico = async (e: React.MouseEvent, agendamentoId: string) => {
    e.stopPropagation();
    if (startingExecId) return;
    setStartingExecId(agendamentoId);

    try {
      if (execucoesMap[agendamentoId]?.id) {
        navigate(`/execucao/${execucoesMap[agendamentoId].id}`);
        return;
      }

      const { data, error } = await supabase.rpc('iniciar_execucao', {
        p_agendamento: agendamentoId,
      });

      if (error) throw error;

      if (typeof data === 'object' && data?.success === false) {
        throw new Error(data?.error || 'Não foi possível abrir o atendimento. Tente novamente.');
      }

      const execId = typeof data === 'string' ? data : (data?.execucao_id || data?.id);

      if (execId) {
        navigate(`/execucao/${execId}`);
      } else {
        await fetchHojeData();
      }
    } catch (err: any) {
      console.error('[Iniciar Serviço Error]:', err);
    } finally {
      setStartingExecId(null);
    }
  };

  const handleTogglePausaCard = async (execId: string, estadoDerivadoCard: EstadoCronometroDerivado) => {
    if (pauseActionLoading) return;
    setPauseActionLoading(execId);

    try {
      if (estadoDerivadoCard === 'pausado_manual' || estadoDerivadoCard === 'pausado_auto') {
        const { error } = await supabase.rpc('retomar_execucao', { p_execucao: execId });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc('pausar_execucao', { p_execucao: execId });
        if (error) throw error;
      }
      notificarAtualizacaoTempo(execId);
      await fetchHojeData();
    } catch (err: any) {
      console.error('[Pausa Card Error]:', err);
    } finally {
      setPauseActionLoading(null);
    }
  };

  const handleFinalizarCard = async (
    exec: any,
    agendamento: any,
    totalItens: number,
    concluidosCount: number,
    pendingRequiredCount: number,
    pendingRequiredNames: string[],
    modoRetroativo = false
  ) => {
    try {
      await supabase
        .from('execucoes')
        .update({ finalizado_em: new Date().toISOString() })
        .eq('id', exec.id);

      notificarAtualizacaoTempo(exec.id);

      setModalFinalizarState({
        execucaoId: exec.id,
        agendamento,
        iniciadoEm: exec.iniciado_em,
        duracaoEstimadaMinutos: agendamento?.duracao_total || agendamento?.duracao_minutos || 60,
        pendingRequiredCount,
        pendingRequiredNames,
        tempoFormatado: '00:00:00',
        totalItens,
        concluidosCount,
        modoRetroativoInicial: modoRetroativo,
      });
    } catch (err) {
      console.error('[Finalizar Card Error]:', err);
    }
  };

  // Métricas do Topo
  const totalVeiculos = agendamentosHoje.length;
  const emAndamentoCount = execucoesAbertas.length;

  const faturadoCalculado = agendamentosHoje
    .filter((a) => a.status === 'concluido')
    .reduce((acc, a) => {
      const exVal = execucoesMap[a.id]?.valor_total_final;
      const val = exVal ?? (a as any).preco_estimado_total ?? (a as any).preco_estimado ?? (a as any).valor_total ?? 0;
      return acc + val;
    }, 0);

  const podeVer = podeVerValor();
  const faturadoDisplay = podeVer ? formatValorMoeda(faturadoCalculado) : 'R$ ***';

  // Filtra execuções abertas iniciadas em datas anteriores
  const hojeIsoStr = formatarDataIsoSP(new Date());
  const execucoesOutrosDias = execucoesAbertas.filter((exec) => {
    if (!exec.iniciado_em) return false;
    const dtIniciado = formatarDataIsoSP(exec.iniciado_em);
    return dtIniciado < hojeIsoStr;
  });

  const renderAcaoBotao = (agendamento: Agendamento) => {
    const checkinInfo = checkinsMap[agendamento.id];
    const execucaoInfo = execucoesMap[agendamento.id];

    const acao = obterAcaoAgendamento({ agendamento, checkinInfo, execucaoInfo, podeVerValor: podeVer });
    const isStartingCheckin = startingCheckinId === agendamento.id;
    const isStartingExec = startingExecId === agendamento.id;

    switch (acao.tipo) {
      case 'nenhuma':
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedAgendamento(agendamento);
              setIsPainelOpen(true);
            }}
            className="px-3.5 py-2 rounded-lg bg-graphite-800/80 hover:bg-graphite-700 text-vapor-300 border border-graphite-700 font-medium font-sans text-[12px] transition-colors flex items-center justify-center gap-1.5 min-h-[36px] shrink-0"
          >
            <Eye size={14} />
            <span>Ver detalhes</span>
          </button>
        );

      case 'fazer_vistoria':
      case 'continuar_vistoria':
        return (
          <button
            type="button"
            disabled={isStartingCheckin}
            onClick={(e) => {
              e.stopPropagation();
              if (isStartingCheckin) return;
              setStartingCheckinId(agendamento.id);
              navigate(`/checkin/${agendamento.id}`);
            }}
            className="px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-graphite-950 font-bold font-sans text-[13px] transition-colors flex items-center justify-center gap-1.5 min-h-[48px] shrink-0"
          >
            {isStartingCheckin ? (
              <div className="w-4 h-4 border-2 border-graphite-950 border-t-transparent rounded-full animate-spin" />
            ) : (
              <ClipboardCheck size={16} />
            )}
            <span>{acao.label}</span>
          </button>
        );

      case 'iniciar_servico':
        return (
          <button
            type="button"
            disabled={isStartingExec}
            onClick={(e) => handleIniciarServico(e, agendamento.id)}
            className="px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-graphite-950 font-bold font-sans text-[13px] transition-colors flex items-center justify-center gap-1.5 min-h-[48px] shrink-0 shadow-md cursor-pointer"
          >
            {isStartingExec ? (
              <>
                <div className="w-4 h-4 border-2 border-graphite-950 border-t-transparent rounded-full animate-spin" />
                <span>Iniciando...</span>
              </>
            ) : (
              <>
                <Play size={16} className="fill-current" />
                <span>{acao.label}</span>
              </>
            )}
          </button>
        );

      case 'continuar_servico':
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (execucaoInfo?.id) {
                navigate(`/execucao/${execucaoInfo.id}`);
              }
            }}
            className="px-4 py-2.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-bold font-sans text-[13px] transition-colors flex items-center justify-center gap-1.5 min-h-[48px] shrink-0"
          >
            <Play size={16} className="fill-current" />
            <span>{acao.label}</span>
          </button>
        );

      case 'definir_valor':
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (execucaoInfo?.id) {
                setModalFinalizarState({
                  execucaoId: execucaoInfo.id,
                  agendamento,
                  iniciadoEm: execucaoInfo.iniciado_em || new Date().toISOString(),
                  duracaoEstimadaMinutos: 60,
                  pendingRequiredCount: 0,
                  pendingRequiredNames: [],
                  tempoFormatado: '00:00:00',
                  totalItens: execucaoInfo.totalItens || 0,
                  concluidosCount: execucaoInfo.concluidosCount || 0,
                  modoDefinirValorOnly: true,
                });
              }
            }}
            className="px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-graphite-950 font-bold font-sans text-[13px] transition-colors flex items-center justify-center gap-1.5 min-h-[48px] shrink-0"
          >
            <DollarSign size={16} />
            <span>Definir valor</span>
          </button>
        );

      case 'ver_atendimento':
      default:
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              navegarParaAtendimento(navigate, execucaoInfo?.id, agendamento.id);
            }}
            className="px-4 py-2.5 rounded-lg bg-graphite-800 hover:bg-graphite-700 text-vapor-200 border border-graphite-600 font-bold font-sans text-[13px] transition-colors flex items-center justify-center gap-1.5 min-h-[48px] shrink-0"
          >
            <Eye size={16} />
            <span>Ver atendimento</span>
          </button>
        );
    }
  };

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      {/* Banner de aviso de limite de plano (se estiver próximo dos 80% ou atingido) */}
      <BannerAlertaLimites />

      {/* Topo com Botão de Entrada Avulsa (56px) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader title="Resumo de Hoje" />

        <button
          type="button"
          onClick={() => setIsModalEntradaOpen(true)}
          className="px-5 py-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-graphite-950 font-display text-[15px] uppercase font-bold tracking-wide transition-all shadow-lg hover:shadow-amber-500/20 flex items-center justify-center gap-2 min-h-[56px]"
        >
          <Plus size={20} strokeWidth={2.5} />
          <span>Entrada de veículo</span>
        </button>
      </div>

      {/* BANNER DE AVISO: ORÇAMENTOS APROVADOS AGUARDANDO AGENDAMENTO */}
      {orcamentosAprovadosCount > 0 && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/40 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-emerald-300 shadow-md">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="shrink-0 text-emerald-400" size={22} />
            <div>
              <span className="text-[14px] font-bold block text-vapor-100">
                {orcamentosAprovadosCount === 1
                  ? '1 orçamento aprovado aguardando agendamento'
                  : `${orcamentosAprovadosCount} orçamentos aprovados aguardando agendamento`}
              </span>
              <span className="text-[12px] text-vapor-400 font-sans">
                O cliente aceitou a proposta! Clique para agendar a execução do serviço.
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate('/orcamentos')}
            className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-graphite-950 font-bold text-[12px] transition-colors shrink-0 font-sans uppercase shadow"
          >
            Ver Orçamentos
          </button>
        </div>
      )}

      {/* BANNER DE AVISO: EXECUÇÕES ABERTAS DE DIAS ANTERIORES */}
      {execucoesOutrosDias.length > 0 && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/40 rounded-xl flex items-center justify-between gap-3 text-amber-300 shadow-md">
          <div className="flex items-center gap-3">
            <AlertTriangle className="shrink-0 text-amber-500 animate-pulse" size={22} />
            <div>
              <span className="text-[14px] font-bold block">
                {execucoesOutrosDias.length === 1
                  ? '1 serviço aberto desde um dia anterior'
                  : `${execucoesOutrosDias.length} serviços abertos de dias anteriores`}
              </span>
              <span className="text-[12px] text-vapor-400 font-sans">
                Execuções ativas continuam visíveis na tela Hoje até que sejam finalizadas.
              </span>
            </div>
          </div>
          <a
            href="#secao-execucoes-abertas"
            className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-graphite-950 font-bold text-[12px] transition-colors shrink-0 font-sans uppercase"
          >
            Ver serviços
          </a>
        </div>
      )}

      {/* SEÇÃO: PENDÊNCIAS DE AGENDAMENTO ONLINE E SINAL */}
      {agendamentosPendentes.length > 0 && (
        <section>
          <h3 className="font-display text-[14px] text-amber-400 uppercase tracking-widest mb-3 font-bold flex items-center gap-2">
            <Clock size={16} /> Solicitações Online / Sinal Pendente ({agendamentosPendentes.length})
          </h3>
          <div className="flex flex-col gap-3">
            {agendamentosPendentes.map((ag) => (
              <Card key={ag.id} className="p-4 bg-graphite-900 border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-vapor-100 text-sm">{ag.cliente?.nome || 'Cliente'}</span>
                    <span className="text-xs text-amber-400 font-mono">OS #{ag.numero_os}</span>
                    {ag.status === 'aguardando_confirmacao' && (
                      <Badge tone="amber">Aguardando Confirmação</Badge>
                    )}
                    {ag.sinal_status === 'pendente' && (
                      <Badge tone="flare">Sinal Pendente</Badge>
                    )}
                  </div>
                  <p className="text-xs text-vapor-400">
                    Veículo: <strong className="text-vapor-200">{ag.veiculo?.modelo || ag.modelo_veiculo || 'Veículo'}</strong> ({ag.veiculo?.placa || ag.placa_veiculo || 'Sem placa'})
                  </p>
                  <p className="text-xs text-vapor-400">
                    Data: <strong className="text-vapor-200">{formatarDataIsoSP(ag.inicio)} às {formatarHora(ag.inicio)}</strong>
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                  {ag.status === 'aguardando_confirmacao' && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleConfirmarOnline(ag.id)}
                        className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-graphite-950 font-bold text-xs rounded-lg transition"
                      >
                        Confirmar Horário
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRecusarOnline(ag.id)}
                        className="px-3 py-1.5 bg-flare-500/20 hover:bg-flare-500/30 text-flare-400 border border-flare-500/30 font-semibold text-xs rounded-lg transition"
                      >
                        Recusar
                      </button>
                    </>
                  )}

                  {ag.sinal_status === 'pendente' && (
                    <button
                      type="button"
                      onClick={() => handleRegistrarSinalPago(ag.id)}
                      className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-graphite-950 font-bold text-xs rounded-lg transition flex items-center gap-1"
                    >
                      <CheckCircle2 size={14} /> Confirmar Sinal Pago
                    </button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Faixa de resumo do dia */}
      <div className="grid grid-cols-3 gap-4 lg:gap-8">
        <StatValue
          label="Veículos hoje"
          value={String(totalVeiculos).padStart(2, '0')}
        />
        <StatValue
          label="Em execução"
          value={String(emAndamentoCount).padStart(2, '0')}
        />
        <StatValue
          label="Concluído hoje"
          value={faturadoDisplay}
        />
      </div>

      {/* SEÇÃO: EM EXECUÇÃO (SEMPRE VISÍVEL SE HOUVER SERVIÇO EM ANDAMENTO OU PAUSADO) */}
      <section id="secao-execucoes-abertas">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-[14px] text-amber-500 uppercase tracking-widest font-bold flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            Em execução ({execucoesAbertas.length})
          </h3>
        </div>

        {execucoesAbertas.length === 0 ? (
          <Card className="p-6 bg-graphite-900 border-graphite-800 text-center text-vapor-400 text-[13px] font-sans">
            Nenhum serviço em execução no momento.
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            {execucoesAbertas.map((exec) => {
              const agendamento = exec.agendamento;
              const duracaoVal = agendamento?.duracao_total || agendamento?.duracao_minutos || 60;
              const duracaoDisplay = duracaoVal > 0 ? `${duracaoVal} min` : '60 min';
              const inicioHora = exec.iniciado_em ? formatarHora(exec.iniciado_em) : '--:--';

              // Alerta de Tempo Excessivo
              const alertInfo = obterNivelAlertaTempo(
                exec.iniciado_em,
                duracaoVal,
                exec.segundos_pausados,
                exec.pausado_em,
                null
              );

              // Estilização do Card conforme Nível de Alerta
              let cardBg = 'bg-graphite-900/90 border-graphite-800';
              if (alertInfo.nivel === 'alerta') {
                cardBg = 'bg-amber-500/10 border-amber-500/50';
              } else if (alertInfo.nivel === 'critico') {
                cardBg = 'bg-flare-400/10 border-flare-400/60';
              }

              const itensList = exec.execucao_itens || [];
              const totalItens = itensList.length;
              const concluidosCount = itensList.filter((i: any) => i.concluido).length;

              const pendingReqItens = itensList.filter((i: any) => i.obrigatorio && !i.concluido);
              const pendingRequiredCount = pendingReqItens.length;
              const pendingRequiredNames = pendingReqItens.map((i: any) => i.descricao);

              const estadoDerivadoCard = obterEstadoDerivadoCronometro({
                statusExecucao: exec.status,
              });

              return (
                <Card
                  key={exec.id}
                  activeBorder={alertInfo.nivel === 'normal'}
                  hasShineSweep={alertInfo.nivel === 'normal'}
                  className={`flex flex-col gap-4 p-5 transition-all ${cardBg}`}
                >
                  {/* ALERTA VISUAL SE O TEMPO PASSOU DO LIMITE */}
                  {alertInfo.nivel !== 'normal' && (
                    <div
                      className={`p-3 rounded-lg flex items-center justify-between gap-3 text-[13px] font-semibold ${
                        alertInfo.nivel === 'critico'
                          ? 'bg-flare-400/20 text-flare-400 border border-flare-400/40'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <AlertTriangle size={18} className="shrink-0" />
                        <span>{alertInfo.mensagemAlert}</span>
                      </div>

                      {/* Botão de Finalização Retroativa para Gestão */}
                      {isGestor && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleFinalizarCard(
                              exec,
                              agendamento,
                              totalItens,
                              concluidosCount,
                              pendingRequiredCount,
                              pendingRequiredNames,
                              true
                            );
                          }}
                          className="px-3 py-1.5 rounded bg-graphite-900 hover:bg-graphite-800 text-vapor-100 border border-graphite-700 font-bold font-sans text-[12px] transition-colors shrink-0 flex items-center gap-1.5"
                        >
                          <History size={14} className="text-amber-400" />
                          <span>Finalizar com outro horário</span>
                        </button>
                      )}
                    </div>
                  )}

                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div
                      className="flex flex-col gap-3 cursor-pointer flex-1"
                      onClick={() => navigate(`/execucao/${exec.id}`)}
                    >
                      <div className="flex items-center gap-4 flex-wrap">
                        <span className="font-mono text-[26px] font-bold text-vapor-100 tracking-tight">
                          {agendamento?.veiculo?.placa || 'Sem Veículo'}
                        </span>
                        <ServiceChip
                          code={agendamento?.servico?.codigo || 'SV'}
                          label={agendamento?.servico?.nome || 'Serviço'}
                          tone={(agendamento?.servico?.tom as any) || 'amber'}
                        />
                        {exec.status === 'pausado' && (
                          <span className="px-2.5 py-1 text-[11px] font-semibold bg-amber-500/20 text-amber-400 rounded-full border border-amber-500/30 font-mono">
                            PAUSADO
                          </span>
                        )}
                      </div>

                      <div className="font-sans text-[15px] text-vapor-400">
                        {agendamento?.veiculo?.modelo || 'Veículo'}{' '}
                        <span className="mx-2 text-graphite-600">•</span>{' '}
                        {agendamento?.cliente?.nome || 'Cliente'}
                      </div>

                      <div className="flex items-center gap-3 text-[12px] text-vapor-400 font-mono pt-1 border-t border-graphite-800/80">
                        <span>
                          Início: <strong className="text-vapor-200">{inicioHora}</strong>
                        </span>
                        <span className="text-graphite-600">•</span>
                        <span>
                          Duração estimada: <strong className="text-vapor-200">{duracaoDisplay}</strong>
                        </span>
                      </div>
                    </div>

                    {/* CRONÔMETRO E AÇÕES DO CARD */}
                    <div className="flex flex-col md:items-end gap-3 shrink-0">
                      <div className="flex flex-col md:items-end gap-1.5 bg-graphite-950/80 p-3.5 rounded-xl border border-graphite-800 w-full md:w-auto">
                        <span className="text-[10px] uppercase font-semibold text-vapor-400 tracking-wider">
                          TEMPO EM EXECUÇÃO
                        </span>
                        <Cronometro
                          execucaoId={exec.id}
                          status={exec.status}
                          iniciadoEm={exec.iniciado_em}
                          finalizadoEm={exec.finalizado_em}
                          tamanho="medio"
                        />
                        {totalItens > 0 && (
                          <div className="flex items-center gap-1.5 text-[12px] font-mono font-semibold text-amber-500 pt-1">
                            <CheckCircle2 size={14} className="text-amber-500 shrink-0" />
                            <span>
                              {concluidosCount} / {totalItens} itens concluídos
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2.5 w-full md:w-auto flex-wrap sm:flex-nowrap">
                        {/* 1. FINALIZAR (Ação primária - Amber, min-h-[48px]) */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleFinalizarCard(
                              exec,
                              agendamento,
                              totalItens,
                              concluidosCount,
                              pendingRequiredCount,
                              pendingRequiredNames,
                              false
                            );
                          }}
                          className="px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-graphite-950 font-extrabold font-sans text-[13px] transition-colors flex items-center justify-center gap-1.5 min-h-[48px] h-[48px] shadow-md shadow-amber-500/10 shrink-0 cursor-pointer"
                        >
                          <CheckCircle2 size={16} />
                          <span>Finalizar</span>
                        </button>

                        {/* 2. PAUSAR / RETOMAR (Ação secundária - Graphite, min-h-[48px]) */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTogglePausaCard(exec.id, estadoDerivadoCard);
                          }}
                          disabled={pauseActionLoading === exec.id}
                          className={`px-3.5 py-2.5 rounded-lg font-bold font-sans text-[13px] transition-colors flex items-center justify-center gap-1.5 min-h-[48px] h-[48px] shrink-0 ${
                            estadoDerivadoCard === 'pausado_auto'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 hover:bg-amber-500/30'
                              : estadoDerivadoCard === 'pausado_manual'
                              ? 'bg-graphite-800 hover:bg-graphite-700 text-vapor-100 border border-graphite-700'
                              : 'bg-graphite-800 hover:bg-graphite-700 text-vapor-100 border border-graphite-700'
                          }`}
                        >
                          {pauseActionLoading === exec.id ? (
                            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          ) : estadoDerivadoCard === 'pausado_auto' || estadoDerivadoCard === 'pausado_manual' ? (
                            <>
                              <Play size={16} className="fill-current text-amber-400" />
                              <span>Retomar</span>
                            </>
                          ) : (
                            <>
                              <Pause size={16} className="fill-current" />
                              <span>Pausar</span>
                            </>
                          )}
                        </button>

                        {/* 3. ABRIR ATENDIMENTO (Ação terciária - Discreta, min-h-[48px]) */}
                        <button
                          type="button"
                          onClick={() => navigate(`/execucao/${exec.id}`)}
                          className="px-3.5 py-2.5 rounded-lg bg-graphite-900 hover:bg-graphite-800 text-vapor-300 border border-graphite-700 font-medium font-sans text-[13px] transition-colors flex items-center justify-center gap-1.5 min-h-[48px] h-[48px] shrink-0"
                        >
                          <span>Abrir atendimento</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Agenda do dia */}
      <section>
        <h3 className="font-display text-[14px] text-vapor-400 uppercase tracking-widest mb-4">
          Agenda de Hoje
        </h3>

        {loading ? (
          <div className="py-12 text-center text-vapor-400 font-sans text-[13px]">
            Carregando agenda de hoje...
          </div>
        ) : agendamentosHoje.length === 0 ? (
          <Card className="p-8 bg-graphite-900 border-graphite-800 text-center flex flex-col items-center gap-2">
            <Calendar size={32} className="text-vapor-500" />
            <span className="text-vapor-300 font-bold text-[15px]">Nenhum agendamento para hoje</span>
            <span className="text-vapor-500 text-[13px]">
              Novos agendamentos e entradas avulsas aparecerão aqui.
            </span>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {agendamentosHoje.map((agendamento) => {
              const hora = formatarHora(agendamento.inicio);
              const duracaoVal = agendamento.duracao_total || agendamento.duracao_minutos;
              const duracaoDisplay = duracaoVal && duracaoVal > 0 ? `${duracaoVal} min` : 'Duração não definida';
              const isCancelado = agendamento.status === 'cancelado' || agendamento.status === 'nao_compareceu';

              return (
                <Card
                  key={agendamento.id}
                  onClick={() => {
                    setSelectedAgendamento(agendamento);
                    setIsPainelOpen(true);
                  }}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer hover:border-graphite-700 transition-all p-4 ${
                    isCancelado
                      ? 'bg-graphite-950/40 border-graphite-800/80 opacity-60 text-vapor-600'
                      : 'bg-graphite-900 border-graphite-800'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    {/* Horário */}
                    <div className="flex flex-col items-center justify-center min-w-[60px] py-1 px-2 bg-graphite-950 rounded-lg border border-graphite-800 shrink-0">
                      <span className={`font-mono text-[16px] font-bold ${isCancelado ? 'text-vapor-500' : 'text-vapor-100'}`}>{hora}</span>
                      <span className="text-[10px] text-vapor-400 uppercase font-mono">{duracaoDisplay}</span>
                    </div>

                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className={`font-mono text-[17px] font-bold ${isCancelado ? 'line-through text-vapor-500' : 'text-vapor-100'}`}>
                          {agendamento.veiculo?.placa || 'Sem Veículo'}
                        </span>
                        <span className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded bg-graphite-800 text-amber-400 border border-graphite-700">
                          {formatarOS(agendamento.numero_os)}
                        </span>
                        {((agendamento.origem as string) === 'agendamento_online' || agendamento.origem === 'online') && (
                          <span className="font-sans text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            Online
                          </span>
                        )}
                        <ServiceChip
                          code={agendamento.servico?.codigo || 'SV'}
                          label={agendamento.servico?.nome || 'Serviço'}
                          tone={(agendamento.servico?.tom as any) || 'amber'}
                        />
                        <Badge tone={getBadgeToneFromStatus(agendamento.status)}>
                          {getLabelFromStatus(agendamento.status)}
                        </Badge>
                      </div>

                      <div className={`font-sans text-[13px] ${isCancelado ? 'text-vapor-600' : 'text-vapor-400'}`}>
                        {agendamento.veiculo?.modelo || 'Veículo'}{' '}
                        <span className="mx-1.5 text-graphite-600">•</span>{' '}
                        {agendamento.cliente?.nome || 'Cliente'}{' '}
                        <span className="mx-1.5 text-graphite-600">•</span>{' '}
                        <span className={isCancelado ? 'line-through text-vapor-500' : ''}>
                          {agendamento.servico?.nome || 'Serviço'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    {renderAcaoBotao(agendamento)}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Painel lateral do agendamento */}
      {selectedAgendamento && (
        <PainelAgendamento
          isOpen={isPainelOpen}
          onClose={() => {
            setIsPainelOpen(false);
            setSelectedAgendamento(null);
          }}
          agendamento={selectedAgendamento}
          onSuccess={fetchHojeData}
        />
      )}

      {/* Modal de Entrada Avulsa */}
      <ModalEntradaAvulsa
        isOpen={isModalEntradaOpen}
        onClose={() => {
          setIsModalEntradaOpen(false);
          fetchHojeData();
        }}
      />

      {/* Modal de Finalização de Execução disparada da tela Hoje */}
      {modalFinalizarState && tenant && (
        <ModalFinalizarExecucao
          isOpen={!!modalFinalizarState}
          onClose={() => {
            setModalFinalizarState(null);
            fetchHojeData();
          }}
          onRevertFinalizadoEm={() => {
            fetchHojeData();
          }}
          execucaoId={modalFinalizarState.execucaoId}
          agendamentoId={modalFinalizarState.agendamento?.id || ''}
          tenantId={tenant.id}
          placaVeiculo={modalFinalizarState.agendamento?.veiculo?.placa || ''}
          tempoFormatado={modalFinalizarState.tempoFormatado}
          pendingRequiredCount={modalFinalizarState.pendingRequiredCount}
          pendingRequiredNames={modalFinalizarState.pendingRequiredNames}
          agendamentoItens={modalFinalizarState.agendamento?.agendamento_itens || []}
          servicosNomes={(modalFinalizarState.agendamento?.agendamento_itens || []).length > 0 ? (modalFinalizarState.agendamento?.agendamento_itens || []).map((i: any) => i.servicos?.nome || i.servico_nome || 'Serviço') : [modalFinalizarState.agendamento?.servico?.nome || 'Serviço']}
          totalChecklistCount={modalFinalizarState.totalItens}
          concluidosChecklistCount={modalFinalizarState.concluidosCount}
          fotosSaidaExistentes={[]}
          modoRetroativoInicial={modalFinalizarState.modoRetroativoInicial}
          modoDefinirValorOnly={modalFinalizarState.modoDefinirValorOnly}
          iniciadoEm={modalFinalizarState.iniciadoEm}
          duracaoEstimadaMinutos={modalFinalizarState.duracaoEstimadaMinutos}
          onSuccess={() => {
            setModalFinalizarState(null);
            fetchHojeData();
            checkMilestone();
          }}
        />
      )}

      <MilestoneCelebrationModal
        isOpen={!!activeMilestone}
        marco={activeMilestone}
        onClose={dismissMilestone}
      />
    </div>
  );
};
