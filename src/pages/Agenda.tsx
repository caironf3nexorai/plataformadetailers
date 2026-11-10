import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { usePermissao } from '../hooks/usePermissao';
import { PageHeader } from '../components/layout/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { ServiceChip } from '../components/ui/ServiceChip';
import { ScrollableTabs } from '../components/ui/ScrollableTabs';
import { 
  Calendar as CalendarIcon, 
  CalendarDays,
  LayoutDashboard,
  ChevronLeft, 
  ChevronRight, 
  Plus,
  Search,
  Filter,
  X,
  RotateCcw,
  List,
  MapPin,
  ExternalLink
} from 'lucide-react';
import type { Agendamento, HorarioFuncionamento, AgendamentoStatus } from '../types/agenda';
import { 
  getLabelFromStatus, 
  getBadgeToneFromStatus, 
  getNomeDiaSemana,
  formatarDuracao,
  resolverPeriodoFiltroLista,
  resolverPeriodoVisaoCalendario,
  ordenarItensAgendaDia,
  agendamentoBateBuscaTexto,
  type PeriodoListaFiltro,
  type VisaoAgendaModo
} from '../utils/agenda';
import { 
  formatarHora, 
  formatarData, 
  formatarDataIsoSP,
  parseDateInput
} from '../utils/datas';
import { formatarOS, formatarMoeda } from '../utils/formatters';
import { ModalNovoAgendamento } from '../components/agenda/ModalNovoAgendamento';
import { PainelAgendamento } from '../components/agenda/PainelAgendamento';
import { verificarPapelDiaAgendamento } from '../utils/transbordoUtils';
import { Hoje } from './Hoje';

const DEFAULT_STATUS_FILTRO: AgendamentoStatus[] = ['agendado', 'confirmado', 'em_andamento'];

const ALL_STATUSES: { id: AgendamentoStatus; label: string; dotClass: string }[] = [
  { id: 'agendado', label: 'Agendado', dotClass: 'bg-vapor-400' },
  { id: 'confirmado', label: 'Confirmado', dotClass: 'bg-glass-400' },
  { id: 'em_andamento', label: 'Em andamento', dotClass: 'bg-amber-500' },
  { id: 'concluido', label: 'Concluído', dotClass: 'bg-mint-400' },
  { id: 'cancelado', label: 'Cancelado', dotClass: 'bg-flare-400' },
  { id: 'nao_compareceu', label: 'Não compareceu', dotClass: 'bg-flare-400' },
];

interface LocateAgendamentoRequest {
  agendamentoId: string;
  data?: string | null;
  requestKey: number;
}

function isSameStatusSelection(a: AgendamentoStatus[], b: AgendamentoStatus[]): boolean {
  return a.length === b.length && b.every((item) => a.includes(item));
}

function parseIsoDateSafe(dateStr?: string | null): Date | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const parsed = parseDateInput(dateStr);
  return isNaN(parsed.getTime()) ? null : parsed;
}

interface VisaoAgendaProps {
  initialNovoAgendamento?: boolean;
  initialClienteId?: string;
  initialVeiculoId?: string;
  locateRequest?: LocateAgendamentoRequest | null;
}

const VisaoAgenda: React.FC<VisaoAgendaProps> = ({
  initialNovoAgendamento = false,
  initialClienteId,
  initialVeiculoId,
  locateRequest = null,
}) => {
  const { tenant } = useAuth();
  const { podeGerirServicos, podeVerValor } = usePermissao();

  // Visão: 'dia' | 'semana' | 'mes' | 'lista'
  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024;
  const [viewMode, setViewMode] = useState<VisaoAgendaModo>(() => {
    const saved = localStorage.getItem('agenda_view_mode');
    if (locateRequest?.agendamentoId) {
      if (saved === 'dia' || saved === 'semana') return saved;
      return isDesktop ? 'semana' : 'dia';
    }
    if (saved && ['dia', 'semana', 'mes', 'lista'].includes(saved)) {
      return saved as VisaoAgendaModo;
    }
    return isDesktop ? 'semana' : 'dia';
  });

  // Data Selecionada (Referência)
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const locateDate = parseIsoDateSafe(locateRequest?.data);
    if (locateDate) return locateDate;
    const saved = localStorage.getItem('agenda_selected_date');
    if (saved) {
      const parsed = new Date(saved);
      if (!isNaN(parsed.getTime())) return parsed;
    }
    return new Date();
  });

  useEffect(() => {
    localStorage.setItem('agenda_view_mode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem('agenda_selected_date', selectedDate.toISOString());
  }, [selectedDate]);
  
  // Filtros
  const [statusFiltro, setStatusFiltro] = useState<AgendamentoStatus[]>(DEFAULT_STATUS_FILTRO);
  const [periodoFiltro, setPeriodoFiltro] = useState<PeriodoListaFiltro>('semana');
  const [dataInicioCustom, setDataInicioCustom] = useState<string>('');
  const [dataFimCustom, setDataFimCustom] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState<boolean>(false);

  // Snapshot do estado antes da busca para restaurar ao limpar pesquisa
  const searchSnapshotRef = useRef<{
    viewMode: VisaoAgendaModo;
    periodoFiltro: PeriodoListaFiltro;
    statusFiltro: AgendamentoStatus[];
  } | null>(null);

  // Paginação da visão Lista
  const [page, setPage] = useState<number>(1);
  const [totalCount, setTotalCount] = useState<number>(0);

  // Agendamentos, Horários e Contadores por Status
  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
  const [horariosFunc, setHorariosFunc] = useState<HorarioFuncionamento[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);

  // Localização e destaque de agendamento (via Orçamento -> Ver na Agenda)
  const [highlightedAgendamentoId, setHighlightedAgendamentoId] = useState<string | null>(
    locateRequest?.agendamentoId || null
  );
  const [locatedAgendamento, setLocatedAgendamento] = useState<Agendamento | null>(null);
  const [locateNoticeError, setLocateNoticeError] = useState<string | null>(null);
  const locateHandledKeyRef = useRef<number>(0);
  const locateFetchedKeyRef = useRef<number>(0);
  const locateDismissedKeyRef = useRef<number>(0);
  const pendingScrollKeyRef = useRef<number>(0);

  // Modais
  const [isModalNovoOpen, setIsModalNovoOpen] = useState<boolean>(initialNovoAgendamento);
  const [targetClienteId, setTargetClienteId] = useState<string | undefined>(initialClienteId);
  const [targetVeiculoId, setTargetVeiculoId] = useState<string | undefined>(initialVeiculoId);
  const [selectedAgendamento, setSelectedAgendamento] = useState<Agendamento | null>(null);
  const [isPainelOpen, setIsPainelOpen] = useState<boolean>(false);

  const fetchSeqRef = useRef<number>(0);

  useEffect(() => {
    if (initialNovoAgendamento) {
      setIsModalNovoOpen(true);
      setTargetClienteId(initialClienteId);
      setTargetVeiculoId(initialVeiculoId);
    }
  }, [initialNovoAgendamento, initialClienteId, initialVeiculoId]);

  // Localiza um agendamento específico na agenda (vindo de Orçamento ou conversão)
  useEffect(() => {
    if (!locateRequest?.agendamentoId || !tenant?.id) return;

    if (locateHandledKeyRef.current !== locateRequest.requestKey) {
      locateHandledKeyRef.current = locateRequest.requestKey;
      pendingScrollKeyRef.current = locateRequest.requestKey;

      searchSnapshotRef.current = null;
      setSearchTerm('');
      setDebouncedSearch('');
      setDataInicioCustom('');
      setDataFimCustom('');
      setLocateNoticeError(null);
      setLocatedAgendamento(null);
      setHighlightedAgendamentoId(locateRequest.agendamentoId);
      setViewMode((prev) => (prev === 'mes' || prev === 'lista' ? (isDesktop ? 'semana' : 'dia') : prev));

      const preDate = parseIsoDateSafe(locateRequest.data);
      if (preDate) {
        setSelectedDate(preDate);
      }
    }

    if (
      locateFetchedKeyRef.current === locateRequest.requestKey ||
      locateDismissedKeyRef.current === locateRequest.requestKey
    ) {
      return;
    }

    let cancelled = false;

    supabase
      .from('agendamentos')
      .select(`
        *,
        cliente:clientes(id, nome, telefone),
        veiculo:veiculos(id, placa, modelo, marca, cor),
        servico:servicos(id, nome, codigo, tom, grupo),
        categoria:categorias_veiculo(id, nome),
        agendamento_itens(
          id,
          duracao_minutos,
          preco_estimado,
          servico_nome,
          servicos(id, nome, codigo, tom, grupo)
        ),
        execucao:execucoes(id, status, valor_total_final, finalizado_em)
      `)
      .eq('tenant_id', tenant.id)
      .eq('id', locateRequest.agendamentoId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || locateDismissedKeyRef.current === locateRequest.requestKey) return;
        locateFetchedKeyRef.current = locateRequest.requestKey;

        if (error || !data) {
          setLocatedAgendamento(null);
          setLocateNoticeError('Não foi possível localizar este agendamento na agenda.');
          return;
        }

        const target = data as unknown as Agendamento;
        setLocatedAgendamento(target);
        setLocateNoticeError(null);

        if (target.inicio) {
          const targetDayIso = formatarDataIsoSP(target.inicio);
          const parsedDay = parseIsoDateSafe(targetDayIso);
          if (parsedDay) {
            setSelectedDate(parsedDay);
          }
        }

        setStatusFiltro((prev) => {
          if (prev.length === 0 || prev.includes(target.status)) return prev;
          return [...prev, target.status];
        });
      });

    return () => {
      cancelled = true;
    };
  }, [locateRequest?.requestKey, locateRequest?.agendamentoId, locateRequest?.data, tenant?.id, isDesktop]);

  // Rola suavemente até o card do agendamento localizado assim que renderizar
  useEffect(() => {
    if (loading || !highlightedAgendamentoId || pendingScrollKeyRef.current === 0) return;

    const frame = window.requestAnimationFrame(() => {
      const targetEl =
        document.querySelector(`[data-agendamento-id="${highlightedAgendamentoId}"][data-agendamento-primary="true"]`) ||
        document.querySelector(`[data-agendamento-id="${highlightedAgendamentoId}"]`);

      if (targetEl instanceof HTMLElement) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        pendingScrollKeyRef.current = 0;
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [agendamentos, loading, viewMode, selectedDate, highlightedAgendamentoId]);

  // Debounce inteligente do campo de busca (250ms): busca em todo o período e em todos os status automaticamente
  useEffect(() => {
    const timer = setTimeout(() => {
      const trimmed = searchTerm.trim();
      setDebouncedSearch(trimmed);

      if (trimmed !== '') {
        if (!searchSnapshotRef.current) {
          searchSnapshotRef.current = {
            viewMode,
            periodoFiltro,
            statusFiltro,
          };
        }
        if (viewMode !== 'lista') {
          setViewMode('lista');
        }
        if (periodoFiltro !== 'todos' && periodoFiltro !== 'personalizado') {
          setPeriodoFiltro('todos');
        }
        if (isSameStatusSelection(statusFiltro, DEFAULT_STATUS_FILTRO)) {
          setStatusFiltro([]);
        }
      } else if (searchSnapshotRef.current) {
        const snap = searchSnapshotRef.current;
        searchSnapshotRef.current = null;
        setViewMode(snap.viewMode);
        setPeriodoFiltro(snap.periodoFiltro);
        setStatusFiltro(snap.statusFiltro);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Reseta página ao mudar filtros ou modo de visão
  useEffect(() => {
    setPage(1);
  }, [statusFiltro, periodoFiltro, dataInicioCustom, dataFimCustom, debouncedSearch, selectedDate, viewMode]);

  // Helper de cálculo do intervalo de datas dos filtros
  const getDatasFiltro = (): { inicio: string | null; fim: string | null } => {
    if (viewMode === 'lista') {
      return resolverPeriodoFiltroLista(periodoFiltro, dataInicioCustom, dataFimCustom);
    }
    return resolverPeriodoVisaoCalendario(viewMode, selectedDate);
  };

  // Verifica se algum filtro difere do padrão contextual
  const isStatusDefault = isSameStatusSelection(statusFiltro, DEFAULT_STATUS_FILTRO);
  const isSearchActive = debouncedSearch.trim() !== '' || searchTerm.trim() !== '';
  const isPeriodoListaFiltered =
    viewMode === 'lista' &&
    (periodoFiltro !== 'semana' || Boolean(dataInicioCustom) || Boolean(dataFimCustom));
  const isFiltered = !isStatusDefault || isSearchActive || isPeriodoListaFiltered;

  const countFiltrosAtivos =
    (!isStatusDefault ? 1 : 0) +
    (isPeriodoListaFiltered ? 1 : 0) +
    (isSearchActive ? 1 : 0);

  const handleClearSearch = () => {
    setSearchTerm('');
    setDebouncedSearch('');
    if (searchSnapshotRef.current) {
      const snap = searchSnapshotRef.current;
      searchSnapshotRef.current = null;
      setViewMode(snap.viewMode);
      setPeriodoFiltro(snap.periodoFiltro);
      setStatusFiltro(snap.statusFiltro);
    }
  };

  const handleSelectViewMode = (nextMode: VisaoAgendaModo) => {
    if (nextMode !== 'lista' && searchTerm.trim() !== '') {
      searchSnapshotRef.current = null;
      setSearchTerm('');
      setDebouncedSearch('');
      if (statusFiltro.length === 0) {
        setStatusFiltro(DEFAULT_STATUS_FILTRO);
      }
      if (periodoFiltro === 'todos') {
        setPeriodoFiltro('semana');
      }
    }
    setViewMode(nextMode);
  };

  const handleLimparFiltros = () => {
    searchSnapshotRef.current = null;
    setStatusFiltro(DEFAULT_STATUS_FILTRO);
    setPeriodoFiltro('semana');
    setDataInicioCustom('');
    setDataFimCustom('');
    setSearchTerm('');
    setDebouncedSearch('');
  };

  const handleClearLocate = () => {
    locateDismissedKeyRef.current = locateRequest?.requestKey || locateHandledKeyRef.current;
    setHighlightedAgendamentoId(null);
    setLocatedAgendamento(null);
    setLocateNoticeError(null);
    pendingScrollKeyRef.current = 0;
  };

  const toggleStatusFiltro = (status: AgendamentoStatus) => {
    if (statusFiltro.includes(status)) {
      setStatusFiltro(statusFiltro.filter((s) => s !== status));
    } else {
      setStatusFiltro([...statusFiltro, status]);
    }
  };

  // Carrega os dados da agenda e contadores por status
  const fetchAgendaData = async (isLoadMore = false, isSilent = false) => {
    if (!tenant) return;
    const seq = ++fetchSeqRef.current;

    if (isLoadMore) {
      setLoadingMore(true);
    } else if (!isSilent && agendamentos.length === 0) {
      setLoading(true);
    }

    try {
      // 1. Horários de funcionamento
      const { data: hfunc } = await supabase
        .from('horarios_funcionamento')
        .select('*')
        .eq('tenant_id', tenant.id);
      if (seq !== fetchSeqRef.current) return;
      setHorariosFunc(hfunc || []);

      // 2. Intervalo de datas
      const { inicio, fim } = getDatasFiltro();

      // 3. Contadores por status para o período selecionado (dispensável durante busca textual)
      if (!debouncedSearch.trim()) {
        let statusQuery = supabase
          .from('agendamentos')
          .select('status')
          .eq('tenant_id', tenant.id);

        if (inicio) {
          statusQuery = statusQuery.gte('inicio', `${inicio}T00:00:00-03:00`);
        }
        if (fim) {
          statusQuery = statusQuery.lte('inicio', `${fim}T23:59:59-03:00`);
        }

        const { data: statusData } = await statusQuery;
        if (seq !== fetchSeqRef.current) return;

        const counts: Record<string, number> = {};
        (statusData || []).forEach((item) => {
          counts[item.status] = (counts[item.status] || 0) + 1;
        });
        setStatusCounts(counts);
      }

      // 4. Busca agendamentos via RPC buscar_agendamentos
      const limite = 30;
      const currentPage = isLoadMore ? page + 1 : 1;
      const offset = (currentPage - 1) * limite;

      const { data: rpcData, error: rpcError } = await supabase.rpc('buscar_agendamentos', {
        p_tenant: tenant.id,
        p_inicio: inicio,
        p_fim: fim,
        p_status: statusFiltro.length > 0 ? statusFiltro : null,
        p_busca: debouncedSearch.trim() || null,
        p_cliente_id: null,
        p_veiculo_id: null,
        p_limite: viewMode === 'lista' ? limite : 500,
        p_offset: viewMode === 'lista' ? offset : 0,
      });

      if (seq !== fetchSeqRef.current) return;

      if (!rpcError && rpcData) {
        const fetchedAgendamentos = rpcData as unknown as Agendamento[];
        if (isLoadMore) {
          setAgendamentos((prev) => [...prev, ...fetchedAgendamentos]);
          setPage(currentPage);
        } else {
          setAgendamentos(fetchedAgendamentos);
          setPage(1);
        }

        if (rpcData.length > 0 && (rpcData[0] as any).total_count !== undefined) {
          setTotalCount(Number((rpcData[0] as any).total_count));
        } else {
          setTotalCount(fetchedAgendamentos.length);
        }
      } else {
        // Fallback em caso de erro na RPC
        console.warn('[Agenda] Fallback para consulta padrão:', rpcError?.message);
        let query = supabase
          .from('agendamentos')
          .select(`
            *,
            cliente:clientes(id, nome, telefone),
            veiculo:veiculos(id, placa, modelo, marca, cor),
            servico:servicos(id, nome, codigo, tom, grupo),
            categoria:categorias_veiculo(id, nome),
            agendamento_itens(
              id,
              duracao_minutos,
              preco_estimado,
              servico_nome,
              servicos(id, nome, codigo, tom, grupo)
            ),
            execucao:execucoes(id, status, valor_total_final, finalizado_em)
          `, { count: 'exact' })
          .eq('tenant_id', tenant.id)
          .order('inicio', { ascending: viewMode !== 'lista' });

        if (inicio) {
          query = query.gte('inicio', `${inicio}T00:00:00-03:00`);
        }
        if (fim) {
          query = query.lte('inicio', `${fim}T23:59:59-03:00`);
        }
        if (statusFiltro.length > 0) {
          query = query.in('status', statusFiltro);
        }

        const { data: fallbackData, count, error: fallbackError } = await query;
        if (fallbackError) throw fallbackError;
        if (seq !== fetchSeqRef.current) return;

        let filteredFallback = (fallbackData as any[]) || [];
        if (debouncedSearch.trim()) {
          filteredFallback = filteredFallback.filter((ag) =>
            agendamentoBateBuscaTexto(ag, debouncedSearch)
          );
        }

        setAgendamentos(filteredFallback);
        setTotalCount(debouncedSearch.trim() ? filteredFallback.length : (count || filteredFallback.length));
      }
    } catch (err) {
      console.error('[Agenda] erro fetch:', err);
    } finally {
      if (seq === fetchSeqRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  const fetchAgendaRef = useRef(fetchAgendaData);
  fetchAgendaRef.current = fetchAgendaData;

  useEffect(() => {
    fetchAgendaData(false, agendamentos.length > 0);
  }, [tenant?.id, selectedDate, statusFiltro, periodoFiltro, dataInicioCustom, dataFimCustom, debouncedSearch, viewMode]);

  // Supabase Realtime: Atualização ao vivo da agenda sem precisar dar F5/refresh
  useEffect(() => {
    if (!tenant?.id) return;

    const channel = supabase
      .channel(`realtime-agenda-${tenant.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'agendamentos',
          filter: `tenant_id=eq.${tenant.id}`
        },
        () => {
          console.log('[Realtime Agenda] Alteração detectada em agendamentos, atualizando...');
          fetchAgendaRef.current(false, true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenant?.id]);

  // Controles de Navegação de Data
  const handlePrev = () => {
    const d = parseDateInput(formatarDataIsoSP(selectedDate));
    if (viewMode === 'dia') d.setDate(d.getDate() - 1);
    else if (viewMode === 'semana') d.setDate(d.getDate() - 7);
    else d.setMonth(d.getMonth() - 1);
    setSelectedDate(d);
  };

  const handleNext = () => {
    const d = parseDateInput(formatarDataIsoSP(selectedDate));
    if (viewMode === 'dia') d.setDate(d.getDate() + 1);
    else if (viewMode === 'semana') d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
    setSelectedDate(d);
  };

  const handleHoje = () => {
    setSelectedDate(new Date());
    setPeriodoFiltro('semana');
  };

  // Helper para Segunda a Domingo da Semana Atual (normalizado em America/Sao_Paulo)
  const getDiasDaSemana = () => {
    const baseSP = parseDateInput(formatarDataIsoSP(selectedDate));
    const dayOfWeek = baseSP.getDay();
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(baseSP);
    monday.setDate(baseSP.getDate() + diffToMonday);

    const dias = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      dias.push(d);
    }
    return dias;
  };

  // Helper para Dias do Mês (normalizado em America/Sao_Paulo)
  const getDiasDoMes = () => {
    const baseSP = parseDateInput(formatarDataIsoSP(selectedDate));
    const year = baseSP.getFullYear();
    const month = baseSP.getMonth();
    const firstDay = new Date(year, month, 1, 12, 0, 0);
    const lastDay = new Date(year, month + 1, 0, 12, 0, 0);

    const dias = [];
    let startDayOfWeek = firstDay.getDay();
    if (startDayOfWeek === 0) startDayOfWeek = 7;

    for (let i = 1 - (startDayOfWeek - 1); i <= lastDay.getDate(); i++) {
      dias.push(new Date(year, month, i, 12, 0, 0));
    }
    return dias;
  };

  const dateTitle = () => {
    if (viewMode === 'dia') {
      return formatarData(selectedDate);
    }
    if (viewMode === 'semana') {
      const dias = getDiasDaSemana();
      const inicio = formatarData(dias[0]);
      const fim = formatarData(dias[6]);
      return `${inicio} — ${fim}`;
    }
    if (viewMode === 'lista') {
      return `${totalCount} ${totalCount === 1 ? 'resultado' : 'resultados'}`;
    }
    return selectedDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
  };

  const totalPeriodoCount = Object.values(statusCounts).reduce((acc, n) => acc + n, 0);
  const locatedFromList = highlightedAgendamentoId
    ? agendamentos.find((a) => a.id === highlightedAgendamentoId) || null
    : null;
  const resolvedLocatedAgendamento = locatedFromList || locatedAgendamento;
  const locatedDiaIso = resolvedLocatedAgendamento?.inicio
    ? formatarDataIsoSP(resolvedLocatedAgendamento.inicio)
    : (locateRequest?.data || null);

  const openAgendamentoPainel = (ag: Agendamento) => {
    setSelectedAgendamento(ag);
    setIsPainelOpen(true);
  };

  const handleCardKeyDown = (e: React.KeyboardEvent, ag: Agendamento) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openAgendamentoPainel(ag);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Header com Título e Ação de Criar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader title="Agenda" />

        {podeGerirServicos() && (
          <Button
            variant="primary"
            onClick={() => setIsModalNovoOpen(true)}
            className="flex items-center justify-center gap-2 font-bold bg-amber-500 text-graphite-950 hover:bg-amber-600 min-h-[46px] shrink-0 cursor-pointer"
          >
            <Plus size={18} />
            <span>Novo Agendamento</span>
          </Button>
        )}
      </div>

      {/* ═══════════════════════════════════════
          CENTRAL DE BUSCA, NAVEGAÇÃO E FILTROS
      ═══════════════════════════════════════ */}
      <Card className="p-0 bg-graphite-900 border-graphite-700 overflow-hidden shadow-md">
        {/* Linha 1: Busca + Visões (Dia / Semana / Mês / Lista) + Toggle Mobile */}
        <div className="p-3 sm:p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Campo de Busca */}
          <div className="relative flex-1 min-w-0">
            <label htmlFor="agenda-busca-input" className="sr-only">
              Buscar agendamento por cliente, placa, telefone ou número da OS
            </label>
            <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-vapor-400 pointer-events-none" />
            <input
              id="agenda-busca-input"
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && searchTerm) {
                  e.preventDefault();
                  handleClearSearch();
                }
              }}
              placeholder="Buscar cliente, placa, telefone ou OS..."
              className="w-full bg-graphite-950 border border-graphite-700 rounded-[6px] pl-10 pr-10 py-2 font-sans text-[13px] text-vapor-100 placeholder:text-vapor-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/40 min-h-[42px] transition-colors"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={handleClearSearch}
                aria-label="Limpar busca"
                title="Limpar busca (Esc)"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded flex items-center justify-center text-vapor-400 hover:text-vapor-100 hover:bg-graphite-800 cursor-pointer transition-colors"
              >
                <X size={15} />
              </button>
            )}
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-2 flex-wrap">
            {/* Seletor de Visão */}
            <div
              role="tablist"
              aria-label="Modo de exibição da agenda"
              className="flex items-center gap-1 bg-graphite-950 p-1 rounded-[6px] border border-graphite-700"
            >
              {(
                [
                  { id: 'dia', label: 'Dia' },
                  { id: 'semana', label: 'Semana' },
                  { id: 'mes', label: 'Mês' },
                  { id: 'lista', label: 'Lista', withIcon: true },
                ] as { id: VisaoAgendaModo; label: string; withIcon?: boolean }[]
              ).map((tab) => {
                const isActive = viewMode === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => handleSelectViewMode(tab.id)}
                    className={`px-3 py-1.5 rounded-[4px] font-sans text-[12px] transition-colors min-h-[36px] flex items-center gap-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                      isActive
                        ? 'bg-amber-500 text-graphite-950 font-bold'
                        : 'text-vapor-400 hover:text-vapor-100 hover:bg-graphite-800 font-medium'
                    }`}
                  >
                    {tab.withIcon && <List size={14} />}
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Botão Filtros no Mobile */}
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsMobileFilterOpen(!isMobileFilterOpen)}
              aria-expanded={isMobileFilterOpen}
              className="md:hidden flex items-center gap-1.5 min-h-[42px] px-3 cursor-pointer"
            >
              <Filter size={15} />
              <span>Status</span>
              {countFiltrosAtivos > 0 && (
                <span className="bg-amber-500 text-graphite-950 px-1.5 py-0.5 rounded text-[11px] font-mono font-bold">
                  {countFiltrosAtivos}
                </span>
              )}
            </Button>
          </div>
        </div>

        {/* Linha 2 Contextual: Navegação no Calendário OU Período da Lista/Busca */}
        <div className="px-3 sm:px-4 py-2.5 bg-graphite-950/60 border-t border-graphite-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          {viewMode !== 'lista' ? (
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                type="button"
                variant="secondary"
                onClick={handlePrev}
                aria-label="Período anterior"
                className="px-2.5 min-h-[38px] cursor-pointer"
              >
                <ChevronLeft size={16} />
              </Button>

              <Button
                type="button"
                variant="secondary"
                onClick={handleHoje}
                className="font-sans text-[12px] min-h-[38px] px-3.5 cursor-pointer"
              >
                Hoje
              </Button>

              <Button
                type="button"
                variant="secondary"
                onClick={handleNext}
                aria-label="Próximo período"
                className="px-2.5 min-h-[38px] cursor-pointer"
              >
                <ChevronRight size={16} />
              </Button>

              <span className="font-mono text-[14px] font-bold text-vapor-100 capitalize ml-1">
                {dateTitle()}
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5 w-full sm:w-auto">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-display text-[11px] font-bold text-vapor-400 uppercase tracking-wider">
                  Período:
                </span>
                <div className="flex items-center flex-wrap gap-1 bg-graphite-900 p-1 rounded-[6px] border border-graphite-700">
                  {(
                    [
                      { id: 'todos', label: 'Todo o período' },
                      { id: 'hoje', label: 'Hoje' },
                      { id: 'semana', label: 'Esta semana' },
                      { id: 'mes', label: 'Este mês' },
                      { id: 'personalizado', label: 'Personalizado' },
                    ] as { id: PeriodoListaFiltro; label: string }[]
                  ).map((p) => {
                    const isActive = periodoFiltro === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPeriodoFiltro(p.id)}
                        className={`px-2.5 py-1 rounded-[4px] font-sans text-[12px] transition-colors min-h-[32px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                          isActive
                            ? 'bg-amber-500 text-graphite-950 font-bold'
                            : 'text-vapor-400 hover:text-vapor-100 hover:bg-graphite-800 font-medium'
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {periodoFiltro === 'personalizado' && (
                <div className="flex items-center gap-3 flex-wrap pt-0.5">
                  <label className="flex items-center gap-2 font-sans text-[12px] text-vapor-400">
                    <span>De:</span>
                    <input
                      type="date"
                      value={dataInicioCustom}
                      onChange={(e) => setDataInicioCustom(e.target.value)}
                      className="bg-graphite-900 border border-graphite-700 rounded-[4px] px-2.5 py-1 text-vapor-100 font-mono text-[12px] min-h-[36px] focus:outline-none focus:border-amber-500"
                    />
                  </label>
                  <label className="flex items-center gap-2 font-sans text-[12px] text-vapor-400">
                    <span>Até:</span>
                    <input
                      type="date"
                      value={dataFimCustom}
                      onChange={(e) => setDataFimCustom(e.target.value)}
                      className="bg-graphite-900 border border-graphite-700 rounded-[4px] px-2.5 py-1 text-vapor-100 font-mono text-[12px] min-h-[36px] focus:outline-none focus:border-amber-500"
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          {/* Resumo + Limpar filtros (discreto, sem ruído visual) */}
          <div className="flex items-center gap-3 justify-between sm:justify-end shrink-0">
            <span className="font-mono text-[12px] text-vapor-400">
              {isSearchActive
                ? `${totalCount} ${totalCount === 1 ? 'resultado encontrado' : 'resultados encontrados'}`
                : viewMode === 'lista'
                ? `${totalCount} ${totalCount === 1 ? 'atendimento' : 'atendimentos'}`
                : `${totalPeriodoCount} ${totalPeriodoCount === 1 ? 'atendimento' : 'atendimentos'}`}
            </span>

            {isFiltered && (
              <button
                type="button"
                onClick={handleLimparFiltros}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[4px] bg-graphite-800 hover:bg-graphite-700 text-vapor-100 border border-graphite-600 font-sans text-[12px] font-medium transition-colors min-h-[34px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
              >
                <RotateCcw size={13} />
                <span>Limpar filtros</span>
              </button>
            )}
          </div>
        </div>

        {/* Linha 3: Filtro de Status com contadores reais inline */}
        <div className={`px-3 sm:px-4 py-2.5 border-t border-graphite-800 flex-col gap-2 ${isMobileFilterOpen ? 'flex' : 'hidden md:flex'}`}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-display text-[11px] font-bold text-vapor-400 uppercase tracking-wider mr-1">
                Status:
              </span>

              <button
                type="button"
                aria-pressed={statusFiltro.length === 0}
                onClick={() => setStatusFiltro([])}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] font-sans text-[12px] border transition-colors min-h-[34px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                  statusFiltro.length === 0
                    ? 'bg-graphite-800 text-vapor-100 border-amber-500 font-semibold'
                    : 'bg-graphite-950 text-vapor-400 border-graphite-800 hover:border-graphite-600 hover:text-vapor-100 font-medium'
                }`}
              >
                <span>Todos</span>
                {!isSearchActive && (
                  <span className="font-mono text-[11px] text-vapor-400">
                    {totalPeriodoCount}
                  </span>
                )}
              </button>

              {ALL_STATUSES.map((st) => {
                const isActive = statusFiltro.includes(st.id);
                const count = statusCounts[st.id] || 0;
                return (
                  <button
                    key={st.id}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => toggleStatusFiltro(st.id)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] font-sans text-[12px] border transition-colors min-h-[34px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                      isActive
                        ? 'bg-graphite-800 text-vapor-100 border-amber-500/70 font-semibold'
                        : `bg-graphite-950 text-vapor-400 border-graphite-800 hover:border-graphite-600 hover:text-vapor-100 font-medium ${
                            !isSearchActive && count === 0 ? 'opacity-65' : ''
                          }`
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${st.dotClass}`} />
                    <span>{st.label}</span>
                    {!isSearchActive && (
                      <span className={`font-mono text-[11px] ${isActive ? 'text-amber-500 font-semibold' : 'text-vapor-600'}`}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {isSearchActive && (
              <span className="font-sans text-[11px] text-vapor-400">
                {periodoFiltro === 'todos' && statusFiltro.length === 0
                  ? 'Buscando em todo o histórico (todos os status)'
                  : 'Busca filtrada pelo período/status acima'}
              </span>
            )}
          </div>
        </div>
      </Card>

      {/* ═══════════════════════════════════════
          DESTAQUE DO AGENDAMENTO LOCALIZADO
      ═══════════════════════════════════════ */}
      {locateNoticeError && (
        <div className="px-4 py-3 rounded-md bg-graphite-900 border border-flare-400/50 flex items-center justify-between gap-3">
          <span className="font-sans text-[13px] text-flare-400">{locateNoticeError}</span>
          <button
            type="button"
            onClick={handleClearLocate}
            aria-label="Fechar aviso"
            className="text-vapor-400 hover:text-vapor-100 p-1 rounded cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {highlightedAgendamentoId && !locateNoticeError && (
        <div className="px-4 py-3 rounded-md bg-amber-500/10 border border-amber-500/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <MapPin size={17} className="text-amber-500 shrink-0" />
            <div className="flex items-center gap-2 flex-wrap font-sans text-[13px] text-vapor-100">
              {resolvedLocatedAgendamento ? (
                <>
                  <span className="font-bold text-amber-500">Agendamento localizado:</span>
                  <span className="font-mono font-bold">
                    {formatarOS(resolvedLocatedAgendamento.numero_os)}
                  </span>
                  {resolvedLocatedAgendamento.inicio && (
                    <span className="font-mono text-vapor-100">
                      • {formatarData(resolvedLocatedAgendamento.inicio)} às {formatarHora(resolvedLocatedAgendamento.inicio)}
                    </span>
                  )}
                  {(resolvedLocatedAgendamento.veiculo?.placa || resolvedLocatedAgendamento.cliente?.nome) && (
                    <span className="text-vapor-400">
                      • {[resolvedLocatedAgendamento.veiculo?.placa, resolvedLocatedAgendamento.cliente?.nome].filter(Boolean).join(' — ')}
                    </span>
                  )}
                </>
              ) : (
                <span className="font-semibold text-amber-500">Localizando agendamento na agenda...</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {viewMode !== 'dia' && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  const targetDay = parseIsoDateSafe(locatedDiaIso);
                  if (targetDay) setSelectedDate(targetDay);
                  setViewMode('dia');
                }}
                className="min-h-[36px] text-[12px] cursor-pointer"
              >
                Focar no dia
              </Button>
            )}
            {resolvedLocatedAgendamento && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => openAgendamentoPainel(resolvedLocatedAgendamento)}
                className="min-h-[36px] text-[12px] flex items-center gap-1.5 cursor-pointer"
              >
                <ExternalLink size={13} />
                <span>Abrir ficha</span>
              </Button>
            )}
            <button
              type="button"
              onClick={handleClearLocate}
              aria-label="Fechar destaque"
              title="Remover destaque"
              className="w-8 h-8 rounded flex items-center justify-center text-vapor-400 hover:text-vapor-100 hover:bg-graphite-800 cursor-pointer transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════
          CONTEÚDO DA AGENDA
      ═══════════════════════════════════════ */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="w-10 h-10 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <span className="font-sans text-[13px] text-vapor-400 uppercase tracking-widest">
            Carregando agendamentos...
          </span>
        </div>
      ) : (
        <>
          {/* ESTADO VAZIO EXPLÍCITO QUANDO NÃO HÁ RESULTADOS NA BUSCA OU LISTA */}
          {agendamentos.length === 0 && (viewMode === 'lista' || debouncedSearch.trim() !== '') ? (
            <Card className="p-12 bg-graphite-900 border-graphite-800 text-center flex flex-col items-center gap-3">
              <CalendarIcon size={40} className="text-vapor-600" />
              <span className="font-display text-[16px] text-vapor-100 uppercase font-bold">
                {debouncedSearch.trim()
                  ? `Nenhum atendimento encontrado para "${debouncedSearch.trim()}"`
                  : 'Nenhum atendimento encontrado com esses filtros'}
              </span>
              <span className="font-sans text-[13px] text-vapor-400 max-w-md">
                {debouncedSearch.trim()
                  ? 'Verifique a grafia do nome, placa, telefone ou número da OS, ou ajuste os filtros acima.'
                  : 'Tente selecionar outros status ou ampliar o período exibido.'}
              </span>
              {isFiltered && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleLimparFiltros}
                  className="mt-2 flex items-center gap-2 text-amber-500 border-amber-500/40 cursor-pointer"
                >
                  <RotateCcw size={16} />
                  <span>Limpar filtros</span>
                </Button>
              )}
            </Card>
          ) : (
            <>
              {/* VISÃO DIA (Vertical Timeline) */}
              {viewMode === 'dia' && (() => {
                const diaIso = formatarDataIsoSP(selectedDate);
                const agendamentosDiaView = ordenarItensAgendaDia(
                  agendamentos
                    .map((a) => {
                      const papel = verificarPapelDiaAgendamento(
                        a.inicio,
                        diaIso,
                        a.dias_ocupados,
                        a.modo_ocupacao_efetivo || a.modo_ocupacao
                      );
                      return { ag: a, papel };
                    })
                    .filter((item) => item.papel.pertenceAoDia)
                );

                if (agendamentosDiaView.length === 0) {
                  return (
                    <Card className="p-10 bg-graphite-900 border-graphite-800 text-center flex flex-col items-center gap-2">
                      <CalendarIcon size={36} className="text-vapor-600" />
                      <span className="font-display text-[15px] text-vapor-100 uppercase font-bold">
                        Nenhum atendimento agendado para este dia
                      </span>
                      <span className="font-sans text-[12px] text-vapor-400">
                        Use o botão acima para adicionar um novo atendimento nesta data.
                      </span>
                    </Card>
                  );
                }

                return (
                  <div className="flex flex-col gap-3">
                    {agendamentosDiaView.map(({ ag, papel }) => {
                      const isContinuacao = papel.isContinuacao;
                      const hora = isContinuacao ? 'Cont.' : (ag.inicio ? formatarHora(ag.inicio) : '');
                      const isCancelado = ag.status === 'cancelado' || ag.status === 'nao_compareceu';
                      const isHighlighted = highlightedAgendamentoId === ag.id;
                      const firstItem = ag.agendamento_itens?.[0];
                      const firstServ = firstItem?.servicos || ag.servico;
                      const firstServNome = firstServ?.nome || (firstItem as any)?.servico_nome || 'Serviço';
                      const firstServCode = firstServ?.codigo || ((firstItem as any)?.servico_nome ? 'UN' : 'SV');
                      const extraCount = Math.max(0, (ag.agendamento_itens?.length || 1) - 1);
                      const durTotal = ag.duracao_total || ag.duracao_minutos;

                      return (
                        <div
                          key={`${ag.id}-${isContinuacao ? 'cont' : 'start'}`}
                          data-agendamento-id={ag.id}
                          data-agendamento-primary={!isContinuacao ? 'true' : undefined}
                          role="button"
                          tabIndex={0}
                          onClick={() => openAgendamentoPainel(ag)}
                          onKeyDown={(e) => handleCardKeyDown(e, ag)}
                          className={`p-4 rounded-md border cursor-pointer transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                            isHighlighted
                              ? 'bg-amber-500/10 border-amber-500 ring-2 ring-amber-500/60 shadow-[0_0_24px_rgba(255,138,61,0.2)]'
                              : isContinuacao
                              ? 'border-dashed border-amber-500/60 bg-amber-500/5 hover:border-amber-500'
                              : isCancelado
                              ? 'opacity-60 bg-graphite-950/60 border-graphite-800 hover:border-graphite-700'
                              : 'bg-graphite-900 border-graphite-800 hover:border-graphite-600'
                          }`}
                        >
                          <div className="flex items-center gap-4">
                            <div className="flex flex-col items-center justify-center bg-graphite-800 px-3 py-2 rounded-[6px] border border-graphite-700 shrink-0 min-w-[70px]">
                              <span className="font-mono text-[16px] font-bold text-amber-500">
                                {hora}
                              </span>
                              <span className="font-sans text-[10px] text-vapor-400">
                                {formatarDuracao(durTotal)}
                              </span>
                            </div>

                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                {isHighlighted && (
                                  <span className="text-[10px] bg-amber-500 text-graphite-950 px-2 py-0.5 rounded font-display font-bold uppercase tracking-wider">
                                    Localizado
                                  </span>
                                )}
                                {isContinuacao && (
                                  <span className="text-[10px] bg-amber-500 text-graphite-950 px-2 py-0.5 rounded font-extrabold uppercase">
                                    Pernoite / Continuação
                                  </span>
                                )}
                                <span className={`font-mono text-[16px] font-bold text-vapor-100 ${isCancelado ? 'line-through' : ''}`}>
                                  {ag.veiculo ? `${ag.veiculo.placa} (${ag.veiculo.modelo || ''}${ag.veiculo.cor ? ` • ${ag.veiculo.cor}` : ''})` : 'Sem veículo'}
                                </span>
                                <span className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded bg-graphite-800 text-amber-500 border border-graphite-700">
                                  {formatarOS(ag.numero_os)}
                                </span>
                                {((ag.origem as string) === 'agendamento_online' || ag.origem === 'online') && (
                                  <span className="font-sans text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-500 border border-amber-500/30">
                                    Online
                                  </span>
                                )}
                                <Badge tone={getBadgeToneFromStatus(ag.status)}>
                                  {getLabelFromStatus(ag.status)}
                                </Badge>
                              </div>

                              <div className={`font-sans text-[13px] ${isCancelado ? 'text-vapor-600' : 'text-vapor-400'}`}>
                                {ag.cliente?.nome || 'Cliente'} <span className="mx-1 text-graphite-600">•</span> <span className={isCancelado ? 'line-through' : ''}>{firstServNome}</span>
                              </div>
                            </div>
                          </div>

                          <div className="shrink-0 flex items-center gap-1.5">
                            <ServiceChip
                              code={firstServCode}
                              label={firstServNome}
                              tone={firstServ?.tom as any || 'vapor'}
                            />
                            {extraCount > 0 && (
                              <span className="bg-graphite-800 text-amber-500 border border-graphite-700 font-mono text-[11px] font-bold px-1.5 py-0.5 rounded">
                                +{extraCount}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* VISÃO SEMANA (Grade de Colunas) */}
              {viewMode === 'semana' && (
                <div className="grid grid-cols-1 md:grid-cols-7 gap-3 overflow-x-auto">
                  {getDiasDaSemana().map((dia) => {
                    const diaIso = formatarDataIsoSP(dia);
                    const diaSemanaNum = dia.getDay();
                    const hfunc = horariosFunc.find((h) => h.dia_semana === diaSemanaNum);
                    const isAtivo = hfunc?.ativo ?? false;

                    const agendamentosDoDia = ordenarItensAgendaDia(
                      agendamentos
                        .map((a) => {
                          const papel = verificarPapelDiaAgendamento(
                            a.inicio,
                            diaIso,
                            a.dias_ocupados,
                            a.modo_ocupacao_efetivo || a.modo_ocupacao
                          );
                          return { ag: a, papel };
                        })
                        .filter((item) => item.papel.pertenceAoDia)
                    );

                    const isHoje = formatarDataIsoSP(new Date()) === diaIso;
                    const isLocatedDay = Boolean(highlightedAgendamentoId && locatedDiaIso === diaIso);

                    return (
                      <div
                        key={diaIso}
                        className={`flex flex-col rounded-md border p-3 min-h-[300px] min-w-0 transition-colors ${
                          isLocatedDay
                            ? 'bg-graphite-900 border-amber-500/80 shadow-lg'
                            : isHoje
                            ? 'bg-graphite-900 border-amber-500/50 shadow-lg'
                            : isAtivo
                            ? 'bg-graphite-900 border-graphite-800'
                            : 'bg-graphite-950/60 border-graphite-800/60 opacity-60'
                        }`}
                      >
                        <div className="flex flex-col pb-2 mb-3 border-b border-graphite-800">
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-display text-[11px] text-vapor-400 uppercase tracking-wider">
                              {getNomeDiaSemana(diaSemanaNum).substring(0, 3)}
                            </span>
                            {isLocatedDay && (
                              <span className="font-display text-[9px] bg-amber-500 text-graphite-950 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                                Alvo
                              </span>
                            )}
                          </div>
                          <span className="font-mono text-[16px] font-bold text-vapor-100">
                            {dia.getDate()}
                          </span>
                          {!isAtivo && (
                            <span className="font-sans text-[10px] text-flare-400 font-medium">Fechado</span>
                          )}
                        </div>

                        <div className="flex-1 flex flex-col gap-2 min-w-0">
                          {agendamentosDoDia.map(({ ag, papel }) => {
                            const isContinuacao = papel.isContinuacao;
                            const hora = isContinuacao ? 'Cont.' : (ag.inicio ? formatarHora(ag.inicio) : '');
                            const isCancelado = ag.status === 'cancelado' || ag.status === 'nao_compareceu';
                            const isHighlighted = highlightedAgendamentoId === ag.id;
                            const modoEfetivo = ag.modo_ocupacao_efetivo || ag.modo_ocupacao;
                            const isDiaInteiro = modoEfetivo === 'dia_inteiro';
                            const firstItem = ag.agendamento_itens?.[0];
                            const firstServ = firstItem?.servicos || ag.servico;
                            const firstServNome = firstServ?.nome || (firstItem as any)?.servico_nome || 'Serviço';
                            const extraCount = Math.max(0, (ag.agendamento_itens?.length || 1) - 1);

                            return (
                              <div
                                key={`${ag.id}-${papel.isContinuacao ? 'cont' : 'start'}`}
                                data-agendamento-id={ag.id}
                                data-agendamento-primary={!isContinuacao ? 'true' : undefined}
                                role="button"
                                tabIndex={0}
                                onClick={() => openAgendamentoPainel(ag)}
                                onKeyDown={(e) => handleCardKeyDown(e, ag)}
                                className={`p-2.5 rounded-[6px] border cursor-pointer flex flex-col gap-1 min-w-0 overflow-hidden transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                                  isHighlighted
                                    ? 'bg-amber-500/15 border-amber-500 ring-2 ring-amber-500/70 shadow-[0_0_20px_rgba(255,138,61,0.25)]'
                                    : isContinuacao
                                    ? 'bg-amber-500/10 border-dashed border-amber-500/60 hover:border-amber-500 text-amber-500'
                                    : isDiaInteiro
                                    ? 'bg-amber-500/15 border-amber-500/80 hover:border-amber-500 text-vapor-100'
                                    : isCancelado
                                    ? 'bg-graphite-950 border-graphite-800 hover:border-graphite-700 opacity-60'
                                    : 'bg-graphite-800 border-graphite-700 hover:border-graphite-600 hover:bg-graphite-700/70 text-vapor-100'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-1 flex-wrap min-w-0">
                                  <span className="font-mono text-[11px] font-bold text-amber-500 flex items-center gap-1 shrink-0">
                                    {isContinuacao && (
                                      <span className="text-[9px] bg-amber-500 text-graphite-950 px-1 rounded font-extrabold uppercase">
                                        Pernoite
                                      </span>
                                    )}
                                    <span>{hora}</span>
                                  </span>
                                  <Badge
                                    tone={getBadgeToneFromStatus(ag.status)}
                                    className="max-w-full whitespace-normal text-left leading-tight text-[9px] px-1.5 py-0.5 tracking-wide"
                                  >
                                    {getLabelFromStatus(ag.status)}
                                  </Badge>
                                </div>

                                <div className="flex items-center justify-between gap-1 flex-wrap">
                                  <span className={`font-mono text-[12px] font-semibold text-vapor-100 ${isCancelado ? 'line-through' : ''}`}>
                                    {ag.veiculo?.placa || 'Sem Veículo'}
                                  </span>
                                  <span className="font-mono text-[10px] text-amber-500 font-semibold">
                                    {formatarOS(ag.numero_os)}
                                  </span>
                                </div>

                                <span className="font-sans text-[11px] text-vapor-400 truncate">
                                  {firstServNome} {extraCount > 0 ? `(+${extraCount})` : ''}
                                </span>

                                {isHighlighted && (
                                  <span className="mt-0.5 self-start text-[9px] bg-amber-500 text-graphite-950 px-1.5 py-0.5 rounded font-display font-bold uppercase tracking-wider">
                                    Localizado
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* VISÃO MÊS (Grid de Calendário) */}
              {viewMode === 'mes' && (
                <div className="grid grid-cols-7 gap-2">
                  {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((d) => (
                    <div key={d} className="text-center font-display text-[11px] text-vapor-400 uppercase py-1">
                      {d}
                    </div>
                  ))}

                  {getDiasDoMes().map((dia, idx) => {
                    const diaIso = formatarDataIsoSP(dia);
                    const agsDoDia = agendamentos.filter((a) => {
                      const papel = verificarPapelDiaAgendamento(
                        a.inicio,
                        diaIso,
                        a.dias_ocupados,
                        a.modo_ocupacao_efetivo || a.modo_ocupacao
                      );
                      return papel.pertenceAoDia && a.status !== 'cancelado';
                    });
                    const countAg = agsDoDia.length;
                    const isCurrentMonth = dia.getMonth() === selectedDate.getMonth();
                    const isHoje = formatarDataIsoSP(new Date()) === diaIso;

                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setSelectedDate(dia);
                          setViewMode('dia');
                        }}
                        className={`p-2 min-h-[75px] rounded-md border text-left flex flex-col justify-between transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                          !isCurrentMonth
                            ? 'bg-graphite-950/40 border-graphite-800/40 opacity-40'
                            : isHoje
                            ? 'bg-graphite-900 border-amber-500/60 shadow'
                            : 'bg-graphite-900 border-graphite-800 hover:border-graphite-600'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className={`font-mono text-[12px] font-bold ${isHoje ? 'text-amber-500' : 'text-vapor-100'}`}>
                            {dia.getDate()}
                          </span>
                          {countAg > 0 && (
                            <span className="font-mono text-[10px] bg-amber-500/20 text-amber-500 border border-amber-500/40 px-1.5 py-0.5 rounded font-bold">
                              {countAg}
                            </span>
                          )}
                        </div>

                        {countAg > 0 && (
                          <div className="flex flex-col gap-0.5 mt-1 overflow-hidden">
                            {agsDoDia.slice(0, 2).map((ag, i) => (
                              <span key={i} className="text-[10px] font-mono text-vapor-100 truncate bg-graphite-800/80 px-1 py-0.5 rounded border border-graphite-700">
                                {ag.veiculo?.placa || ag.cliente?.nome?.split(' ')[0] || 'Agendado'}
                              </span>
                            ))}
                            {countAg > 2 && (
                              <span className="text-[9px] font-sans text-amber-500 font-semibold pl-0.5">
                                +{countAg - 2} mais
                              </span>
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* ═══════════════════════════════════════
                  VISÃO "LISTA" (Cronológica Decrescente)
              ═══════════════════════════════════════ */}
              {viewMode === 'lista' && (
                <div className="flex flex-col gap-3">
                  <div className="bg-graphite-900 border border-graphite-800 rounded-md overflow-hidden shadow-md">
                    <div className="divide-y divide-graphite-800">
                      {agendamentos.map((ag) => {
                        const hora = ag.inicio ? formatarHora(ag.inicio) : '';
                        const dataFormatada = ag.inicio ? formatarData(ag.inicio) : '';
                        const isCancelado = ag.status === 'cancelado' || ag.status === 'nao_compareceu';
                        const isHighlighted = highlightedAgendamentoId === ag.id;
                        const firstItem = ag.agendamento_itens?.[0];
                        const firstServ = firstItem?.servicos || ag.servico;
                        const firstServNome = firstServ?.nome || (firstItem as any)?.servico_nome || 'Serviço';
                        const firstServCode = firstServ?.codigo || ((firstItem as any)?.servico_nome ? 'UN' : 'SV');
                        const extraCount = Math.max(0, (ag.agendamento_itens?.length || 1) - 1);
                        
                        // Valor cobrado (Apenas para concluídos e gestores)
                        const valorCobrado = ag.execucao?.valor_total_final 
                          ?? ag.preco_estimado_total 
                          ?? ag.preco_estimado;

                        return (
                          <div
                            key={ag.id}
                            data-agendamento-id={ag.id}
                            data-agendamento-primary="true"
                            role="button"
                            tabIndex={0}
                            onClick={() => openAgendamentoPainel(ag)}
                            onKeyDown={(e) => handleCardKeyDown(e, ag)}
                            className={`p-4 cursor-pointer transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500 ${
                              isHighlighted
                                ? 'bg-amber-500/10 ring-1 ring-inset ring-amber-500'
                                : isCancelado
                                ? 'opacity-60 bg-graphite-950/40 hover:bg-graphite-800/40'
                                : 'hover:bg-graphite-800/60'
                            }`}
                          >
                            {/* Bloco 1: OS, Data/Hora, Veículo, Cliente */}
                            <div className="flex items-start md:items-center gap-4 flex-1">
                              <div className="flex flex-col items-center justify-center bg-graphite-800 px-3 py-2 rounded-[6px] border border-graphite-700 shrink-0 min-w-[80px]">
                                <span className="font-mono text-[13px] font-bold text-amber-500">
                                  {formatarOS(ag.numero_os)}
                                </span>
                                <span className="font-mono text-[11px] text-vapor-400">
                                  {hora}
                                </span>
                              </div>

                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {isHighlighted && (
                                    <span className="text-[10px] bg-amber-500 text-graphite-950 px-2 py-0.5 rounded font-display font-bold uppercase tracking-wider">
                                      Localizado
                                    </span>
                                  )}
                                  <span className={`font-mono text-[15px] font-bold text-vapor-100 ${isCancelado ? 'line-through' : ''}`}>
                                    {ag.veiculo ? `${ag.veiculo.placa} (${ag.veiculo.modelo || ''}${ag.veiculo.cor ? ` • ${ag.veiculo.cor}` : ''})` : 'Sem veículo'}
                                  </span>
                                  <span className="font-sans text-[12px] text-vapor-400">
                                    • {dataFormatada}
                                  </span>
                                  {((ag.origem as string) === 'agendamento_online' || ag.origem === 'online') && (
                                    <span className="font-sans text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-500 border border-amber-500/30">
                                      Online
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2 text-[13px] text-vapor-400 flex-wrap">
                                  <span className="font-medium text-vapor-100">
                                    {ag.cliente?.nome || 'Cliente não informado'}
                                  </span>
                                  {ag.cliente?.telefone && (
                                    <span className="font-mono text-[12px] text-vapor-400">
                                      ({ag.cliente.telefone})
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Bloco 2: Serviços, Status e Valor Cobrado */}
                            <div className="flex items-center gap-3 flex-wrap shrink-0 justify-between md:justify-end">
                              {/* Chip do Serviço */}
                              <div className="flex items-center gap-1.5">
                                <ServiceChip
                                  code={firstServCode}
                                  label={firstServNome}
                                  tone={firstServ?.tom as any || 'vapor'}
                                />
                                {extraCount > 0 && (
                                  <span className="bg-graphite-800 text-amber-500 border border-graphite-700 font-mono text-[11px] font-bold px-1.5 py-0.5 rounded">
                                    +{extraCount}
                                  </span>
                                )}
                              </div>

                              {/* Badge de Status */}
                              <Badge tone={getBadgeToneFromStatus(ag.status)}>
                                {getLabelFromStatus(ag.status)}
                              </Badge>

                              {/* Valor Cobrado (Apenas para Concluído e Gestores - Dono / Gerente) */}
                              {ag.status === 'concluido' && podeVerValor() && (
                                <div className="flex items-center gap-1 bg-mint-400/10 text-mint-400 border border-mint-400/30 px-2.5 py-1 rounded font-mono text-[13px] font-bold">
                                  <span>{formatarMoeda(valorCobrado)}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Paginação: Carregar mais */}
                  {agendamentos.length < totalCount && (
                    <div className="flex justify-center pt-2 pb-6">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => fetchAgendaData(true)}
                        disabled={loadingMore}
                        className="px-6 py-2.5 font-sans text-[13px] font-semibold text-amber-500 border-amber-500/40 hover:bg-amber-500/10 min-h-[44px] cursor-pointer"
                      >
                        {loadingMore ? 'Carregando...' : `Carregar mais (${agendamentos.length} de ${totalCount})`}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Modal de Novo Agendamento */}
      <ModalNovoAgendamento
        isOpen={isModalNovoOpen}
        onClose={() => {
          setIsModalNovoOpen(false);
          setTargetClienteId(undefined);
          setTargetVeiculoId(undefined);
        }}
        onSuccess={() => {
          fetchAgendaData();
        }}
        initialDate={formatarDataIsoSP(selectedDate)}
        initialClienteId={targetClienteId}
        initialVeiculoId={targetVeiculoId}
      />

      {/* Painel de Detalhes e Ações do Agendamento */}
      <PainelAgendamento
        agendamento={selectedAgendamento}
        isOpen={isPainelOpen}
        onClose={() => {
          setIsPainelOpen(false);
          setSelectedAgendamento(null);
        }}
        onSuccess={() => {
          fetchAgendaData();
        }}
      />
    </div>
  );
};

interface AgendaProps {
  abaInicial?: 'hoje' | 'agenda';
}

export const Agenda: React.FC<AgendaProps> = ({ abaInicial = 'hoje' }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();

  const queryNovo = searchParams.get('novoAgendamento') === 'true';
  const queryClienteSnake = searchParams.get('cliente_id');
  const stateNovo = !!(location.state as any)?.openNovoAgendamento;
  const isNovoAgendamentoRequested = queryNovo || stateNovo || Boolean(queryClienteSnake);

  const paramClienteId =
    searchParams.get('clienteId') ||
    queryClienteSnake ||
    (location.state as any)?.clienteId;
  const paramVeiculoId =
    searchParams.get('veiculoId') ||
    searchParams.get('veiculo_id') ||
    (location.state as any)?.veiculoId;

  const paramAba = searchParams.get('aba');
  const paramAgendamentoId =
    searchParams.get('agendamentoId') ||
    (location.state as any)?.agendamentoId;
  const paramData =
    searchParams.get('data') ||
    (location.state as any)?.data;

  const locateSignature = paramAgendamentoId
    ? `${location.key}:${paramAgendamentoId}:${paramData || ''}`
    : null;
  const handledLocateSignatureRef = useRef<string | null>(locateSignature);

  const [locateRequest, setLocateRequest] = useState<LocateAgendamentoRequest | null>(() =>
    paramAgendamentoId
      ? {
          agendamentoId: paramAgendamentoId,
          data: paramData,
          requestKey: Date.now(),
        }
      : null
  );

  const [activeTab, setActiveTab] = useState<'hoje' | 'agenda'>(() => {
    if (isNovoAgendamentoRequested || paramAgendamentoId || paramAba === 'agenda') return 'agenda';
    if (paramAba === 'hoje') return 'hoje';
    const saved = localStorage.getItem('agenda_active_tab');
    if (saved === 'hoje' || saved === 'agenda') return saved;
    return abaInicial;
  });

  useEffect(() => {
    let paramsMudaram = false;
    const next = new URLSearchParams(searchParams);

    if (isNovoAgendamentoRequested) {
      setActiveTab('agenda');
      if (queryNovo || queryClienteSnake) {
        next.delete('novoAgendamento');
        next.delete('clienteId');
        next.delete('veiculoId');
        next.delete('cliente_id');
        next.delete('veiculo_id');
        paramsMudaram = true;
      }
    }

    if (paramAgendamentoId) {
      setActiveTab('agenda');
      if (locateSignature && handledLocateSignatureRef.current !== locateSignature) {
        handledLocateSignatureRef.current = locateSignature;
        setLocateRequest({
          agendamentoId: paramAgendamentoId,
          data: paramData,
          requestKey: Date.now(),
        });
      }
      if (searchParams.has('agendamentoId') || searchParams.has('data') || searchParams.has('aba')) {
        next.delete('agendamentoId');
        next.delete('data');
        next.delete('aba');
        paramsMudaram = true;
      }
    } else if (paramAba === 'agenda' || paramAba === 'hoje') {
      setActiveTab(paramAba);
      next.delete('aba');
      paramsMudaram = true;
    }

    if (paramsMudaram) {
      setSearchParams(next, { replace: true });
    }
  }, [isNovoAgendamentoRequested, paramAgendamentoId, paramAba, locateSignature]);

  useEffect(() => {
    localStorage.setItem('agenda_active_tab', activeTab);
  }, [activeTab]);

  return (
    <div className="flex flex-col gap-6">
      {/* Abas Superiores com ScrollableTabs */}
      <div className="border-b border-graphite-600 pb-2">
        <ScrollableTabs
          items={[
            { id: 'hoje', label: 'Resumo de Hoje', icon: LayoutDashboard },
            { id: 'agenda', label: 'Agenda Completa', icon: CalendarDays },
          ]}
          activeId={activeTab}
          onChange={(id) => setActiveTab(id as any)}
          variant="sport"
          showQuickSelect={false}
        />
      </div>

      {activeTab === 'hoje' ? (
        <Hoje />
      ) : (
        <VisaoAgenda
          initialNovoAgendamento={isNovoAgendamentoRequested}
          initialClienteId={paramClienteId}
          initialVeiculoId={paramVeiculoId}
          locateRequest={locateRequest}
        />
      )}
    </div>
  );
};
