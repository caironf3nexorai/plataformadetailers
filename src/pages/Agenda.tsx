import React, { useState, useEffect } from 'react';
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
  List
} from 'lucide-react';
import type { Agendamento, HorarioFuncionamento, AgendamentoStatus } from '../types/agenda';
import { 
  getLabelFromStatus, 
  getBadgeToneFromStatus, 
  getNomeDiaSemana 
} from '../utils/agenda';
import { 
  formatarHora, 
  formatarData, 
  formatarDataIsoSP 
} from '../utils/datas';
import { formatarOS, formatarMoeda, extrairNumeroOS } from '../utils/formatters';
import { ModalNovoAgendamento } from '../components/agenda/ModalNovoAgendamento';
import { PainelAgendamento } from '../components/agenda/PainelAgendamento';
import { verificarPapelDiaAgendamento } from '../utils/transbordoUtils';
import { Hoje } from './Hoje';

const ALL_STATUSES: { id: AgendamentoStatus; label: string }[] = [
  { id: 'agendado', label: 'Agendado' },
  { id: 'confirmado', label: 'Confirmado' },
  { id: 'em_andamento', label: 'Em andamento' },
  { id: 'concluido', label: 'Concluído' },
  { id: 'cancelado', label: 'Cancelado' },
  { id: 'nao_compareceu', label: 'Não compareceu' },
];

const VisaoAgenda: React.FC = () => {
  const { tenant } = useAuth();
  const { podeGerirServicos, podeVerValor } = usePermissao();

  // Visão: 'dia' | 'semana' | 'mes' | 'lista'
  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024;
  const [viewMode, setViewMode] = useState<'dia' | 'semana' | 'mes' | 'lista'>(() => {
    const saved = localStorage.getItem('agenda_view_mode');
    if (saved && ['dia', 'semana', 'mes', 'lista'].includes(saved)) {
      return saved as any;
    }
    return isDesktop ? 'semana' : 'dia';
  });

  // Data Selecionada (Referência)
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
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
  const [statusFiltro, setStatusFiltro] = useState<AgendamentoStatus[]>([
    'agendado', 
    'confirmado', 
    'em_andamento'
  ]);
  const [periodoFiltro, setPeriodoFiltro] = useState<'hoje' | 'semana' | 'mes' | 'personalizado'>('semana');
  const [dataInicioCustom, setDataInicioCustom] = useState<string>('');
  const [dataFimCustom, setDataFimCustom] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState<boolean>(false);

  // Paginação da visão Lista
  const [page, setPage] = useState<number>(1);
  const [totalCount, setTotalCount] = useState<number>(0);

  // Agendamentos, Horários e Contadores por Status
  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
  const [horariosFunc, setHorariosFunc] = useState<HorarioFuncionamento[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);

  // Modais
  const [isModalNovoOpen, setIsModalNovoOpen] = useState<boolean>(false);
  const [selectedAgendamento, setSelectedAgendamento] = useState<Agendamento | null>(null);
  const [isPainelOpen, setIsPainelOpen] = useState<boolean>(false);

  // Debounce do campo de busca (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      if (searchTerm.trim() !== '' && viewMode !== 'lista') {
        setViewMode('lista');
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Reseta página ao mudar filtros ou modo de visão
  useEffect(() => {
    setPage(1);
  }, [statusFiltro, periodoFiltro, dataInicioCustom, dataFimCustom, debouncedSearch, selectedDate, viewMode]);

  // Helper de cálculo do intervalo de datas dos filtros
  const getDatasFiltro = () => {
    if (periodoFiltro === 'personalizado') {
      return {
        inicio: dataInicioCustom || formatarDataIsoSP(selectedDate),
        fim: dataFimCustom || dataInicioCustom || formatarDataIsoSP(selectedDate),
      };
    }

    const modo = viewMode === 'lista' ? periodoFiltro : viewMode;

    if (modo === 'hoje' || modo === 'dia') {
      const dStr = modo === 'hoje' ? formatarDataIsoSP(new Date()) : formatarDataIsoSP(selectedDate);
      return { inicio: dStr, fim: dStr };
    }

    if (modo === 'semana') {
      const dayOfWeek = selectedDate.getDay();
      const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(selectedDate);
      monday.setDate(selectedDate.getDate() + diffToMonday);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return {
        inicio: formatarDataIsoSP(monday),
        fim: formatarDataIsoSP(sunday),
      };
    }

    if (modo === 'mes') {
      const year = selectedDate.getFullYear();
      const month = selectedDate.getMonth();
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);

      let startDayOfWeek = firstDay.getDay();
      if (startDayOfWeek === 0) startDayOfWeek = 7;
      const inicioGrid = new Date(year, month, 1 - (startDayOfWeek - 1));

      let endDayOfWeek = lastDay.getDay();
      if (endDayOfWeek === 0) endDayOfWeek = 7;
      const diasExtrasFim = 7 - endDayOfWeek;
      const fimGrid = new Date(year, month, lastDay.getDate() + diasExtrasFim);

      return {
        inicio: formatarDataIsoSP(inicioGrid),
        fim: formatarDataIsoSP(fimGrid),
      };
    }

    const dStr = formatarDataIsoSP(selectedDate);
    return { inicio: dStr, fim: dStr };
  };

  // Verifica se algum filtro difere do padrão
  const defaultStatus = ['agendado', 'confirmado', 'em_andamento'];
  const isStatusDefault = 
    statusFiltro.length === 3 && 
    defaultStatus.every((s) => statusFiltro.includes(s as any));
  const isFiltered = 
    !isStatusDefault || 
    periodoFiltro !== 'semana' || 
    debouncedSearch.trim() !== '' || 
    Boolean(dataInicioCustom) || 
    Boolean(dataFimCustom);

  const countFiltrosAtivos = 
    (!isStatusDefault ? 1 : 0) + 
    (periodoFiltro !== 'semana' ? 1 : 0) + 
    (debouncedSearch.trim() !== '' ? 1 : 0);

  const handleLimparFiltros = () => {
    setStatusFiltro(['agendado', 'confirmado', 'em_andamento']);
    setPeriodoFiltro('semana');
    setDataInicioCustom('');
    setDataFimCustom('');
    setSearchTerm('');
    setDebouncedSearch('');
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
      setHorariosFunc(hfunc || []);

      // 2. Intervalo de datas
      const { inicio, fim } = getDatasFiltro();

      // 3. Contadores por status para o período selecionado
      const { data: statusData } = await supabase
        .from('agendamentos')
        .select('status')
        .eq('tenant_id', tenant.id)
        .gte('inicio', `${inicio}T00:00:00-03:00`)
        .lte('inicio', `${fim}T23:59:59-03:00`);

      const counts: Record<string, number> = {};
      (statusData || []).forEach((item) => {
        counts[item.status] = (counts[item.status] || 0) + 1;
      });
      setStatusCounts(counts);

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
            veiculo:veiculos(id, placa, modelo, marca),
            servico:servicos(id, nome, codigo, tom, grupo),
            categoria:categorias_veiculo(id, nome),
            agendamento_itens(
              id,
              duracao_minutos,
              preco_estimado,
              servicos(id, nome, codigo, tom, grupo)
            ),
            execucao:execucoes(id, status, valor_total_final, finalizado_em)
          `, { count: 'exact' })
          .eq('tenant_id', tenant.id)
          .gte('inicio', `${inicio}T00:00:00-03:00`)
          .lte('inicio', `${fim}T23:59:59-03:00`)
          .order('inicio', { ascending: viewMode !== 'lista' });

        if (statusFiltro.length > 0) {
          query = query.in('status', statusFiltro);
        }

        const { data: fallbackData, count, error: fallbackError } = await query;
        if (fallbackError) throw fallbackError;

        let filteredFallback = (fallbackData as any[]) || [];
        if (debouncedSearch.trim()) {
          const term = debouncedSearch.toLowerCase().trim();
          const numOs = extrairNumeroOS(debouncedSearch);
          filteredFallback = filteredFallback.filter((ag) => {
            const matchesOs = numOs !== null && ag.numero_os === numOs;
            const matchesPlaca = ag.veiculo?.placa?.toLowerCase().includes(term);
            const matchesNome = ag.cliente?.nome?.toLowerCase().includes(term);
            const matchesTel = ag.cliente?.telefone?.includes(term);
            return matchesOs || matchesPlaca || matchesNome || matchesTel;
          });
        }

        setAgendamentos(filteredFallback);
        setTotalCount(count || filteredFallback.length);
      }
    } catch (err) {
      console.error('[Agenda] erro fetch:', err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchAgendaData(false, agendamentos.length > 0);
  }, [tenant?.id, selectedDate, statusFiltro, periodoFiltro, dataInicioCustom, dataFimCustom, debouncedSearch, viewMode]);

  // Supabase Realtime: Atualização ao vivo da agenda sem precisas dar F5/refresh
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
          fetchAgendaData(false, true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenant?.id]);

  // Controles de Navegação de Data
  const handlePrev = () => {
    const d = new Date(selectedDate);
    if (viewMode === 'dia') d.setDate(d.getDate() - 1);
    else if (viewMode === 'semana') d.setDate(d.getDate() - 7);
    else d.setMonth(d.getMonth() - 1);
    setSelectedDate(d);
  };

  const handleNext = () => {
    const d = new Date(selectedDate);
    if (viewMode === 'dia') d.setDate(d.getDate() + 1);
    else if (viewMode === 'semana') d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
    setSelectedDate(d);
  };

  const handleHoje = () => {
    setSelectedDate(new Date());
    setPeriodoFiltro('semana');
  };

  // Helper para Segunda a Domingo da Semana Atual
  const getDiasDaSemana = () => {
    const dayOfWeek = selectedDate.getDay();
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(selectedDate);
    monday.setDate(selectedDate.getDate() + diffToMonday);

    const dias = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      dias.push(d);
    }
    return dias;
  };

  // Helper para Dias do Mês
  const getDiasDoMes = () => {
    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    const dias = [];
    let startDayOfWeek = firstDay.getDay();
    if (startDayOfWeek === 0) startDayOfWeek = 7;

    for (let i = 1 - (startDayOfWeek - 1); i <= lastDay.getDate(); i++) {
      dias.push(new Date(year, month, i));
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
      return `Resultados (${agendamentos.length})`;
    }
    return selectedDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
  };

  // Texto formatado de contadores por status para o período selecionado
  const renderContadorStatusText = () => {
    const parts = [];
    if (statusCounts['agendado']) parts.push(`${statusCounts['agendado']} agendados`);
    if (statusCounts['em_andamento']) parts.push(`${statusCounts['em_andamento']} em andamento`);
    if (statusCounts['concluido']) parts.push(`${statusCounts['concluido']} concluídos`);
    
    if (parts.length === 0) return '0 atendimentos no período';
    return parts.join(' · ');
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header com Título e Ação de Criar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader title="Agenda" />

        {podeGerirServicos() && (
          <Button
            variant="primary"
            onClick={() => setIsModalNovoOpen(true)}
            className="flex items-center justify-center gap-2 font-bold bg-amber-500 text-graphite-950 hover:bg-amber-400 min-h-[48px] shrink-0"
          >
            <Plus size={18} />
            <span>Novo Agendamento</span>
          </Button>
        )}
      </div>

      {/* ═══════════════════════════════════════
          BARRA DE FILTROS E BUSCA
      ═══════════════════════════════════════ */}
      <Card className="p-4 bg-graphite-900 border-graphite-700 flex flex-col gap-4 shadow-md">
        {/* Linha 1: Busca + Período + Botão Filtrar (Mobile) + Limpar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Campo de Busca */}
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-vapor-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por placa, cliente, telefone ou OS (ex: 42, OS 0042, JHC4A80)..."
              className="w-full bg-graphite-950 border border-graphite-700 rounded-lg pl-10 pr-9 py-2 font-sans text-[13px] text-vapor-100 placeholder:text-vapor-500 focus:outline-none focus:border-amber-500 min-h-[42px]"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-vapor-400 hover:text-vapor-100"
              >
                <X size={16} />
              </button>
            )}
          </div>

          {/* Seletor de Período */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center bg-graphite-800 p-1 rounded-lg border border-graphite-700">
              <button
                onClick={() => setPeriodoFiltro('hoje')}
                className={`px-2.5 py-1 rounded font-sans text-[12px] font-medium transition-colors ${
                  periodoFiltro === 'hoje'
                    ? 'bg-amber-500 text-graphite-950 font-bold'
                    : 'text-vapor-400 hover:text-vapor-100'
                }`}
              >
                Hoje
              </button>
              <button
                onClick={() => setPeriodoFiltro('semana')}
                className={`px-2.5 py-1 rounded font-sans text-[12px] font-medium transition-colors ${
                  periodoFiltro === 'semana'
                    ? 'bg-amber-500 text-graphite-950 font-bold'
                    : 'text-vapor-400 hover:text-vapor-100'
                }`}
              >
                Esta semana
              </button>
              <button
                onClick={() => setPeriodoFiltro('mes')}
                className={`px-2.5 py-1 rounded font-sans text-[12px] font-medium transition-colors ${
                  periodoFiltro === 'mes'
                    ? 'bg-amber-500 text-graphite-950 font-bold'
                    : 'text-vapor-400 hover:text-vapor-100'
                }`}
              >
                Este mês
              </button>
              <button
                onClick={() => setPeriodoFiltro('personalizado')}
                className={`px-2.5 py-1 rounded font-sans text-[12px] font-medium transition-colors ${
                  periodoFiltro === 'personalizado'
                    ? 'bg-amber-500 text-graphite-950 font-bold'
                    : 'text-vapor-400 hover:text-vapor-100'
                }`}
              >
                Personalizado
              </button>
            </div>

            {/* Botão Filtrar no Mobile */}
            <Button
              variant="secondary"
              onClick={() => setIsMobileFilterOpen(!isMobileFilterOpen)}
              className="md:hidden flex items-center gap-1.5 min-h-[40px]"
            >
              <Filter size={16} />
              <span>Filtrar</span>
              {countFiltrosAtivos > 0 && (
                <span className="bg-amber-500 text-graphite-950 px-1.5 py-0.5 rounded-full text-[11px] font-bold ml-1">
                  {countFiltrosAtivos}
                </span>
              )}
            </Button>

            {/* Botão Limpar Filtros */}
            {isFiltered && (
              <Button
                variant="secondary"
                onClick={handleLimparFiltros}
                className="flex items-center gap-1.5 text-flare-400 hover:text-flare-300 border-flare-500/30 min-h-[40px]"
              >
                <RotateCcw size={14} />
                <span>Limpar filtros</span>
              </Button>
            )}
          </div>
        </div>

        {/* Período Personalizado (Datas De / Até) */}
        {periodoFiltro === 'personalizado' && (
          <div className="flex items-center gap-3 bg-graphite-950 p-3 rounded-lg border border-graphite-800 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="font-sans text-[12px] text-vapor-400">De:</span>
              <input
                type="date"
                value={dataInicioCustom}
                onChange={(e) => setDataInicioCustom(e.target.value)}
                className="bg-graphite-900 border border-graphite-700 rounded px-2.5 py-1 text-vapor-100 font-mono text-[12px] focus:outline-none focus:border-amber-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="font-sans text-[12px] text-vapor-400">Até:</span>
              <input
                type="date"
                value={dataFimCustom}
                onChange={(e) => setDataFimCustom(e.target.value)}
                className="bg-graphite-900 border border-graphite-700 rounded px-2.5 py-1 text-vapor-100 font-mono text-[12px] focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>
        )}

        {/* Linha 2: Chips de Status + Contador por Status */}
        <div className={`flex-col gap-3 ${isMobileFilterOpen ? 'flex' : 'hidden md:flex'}`}>
          <div className="flex items-center justify-between gap-3 flex-wrap border-t border-graphite-800 pt-3">
            {/* Chips Clicáveis de Status */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-sans text-[11px] font-semibold text-vapor-400 uppercase tracking-wider mr-1">
                Status:
              </span>
              {ALL_STATUSES.map((st) => {
                const isActive = statusFiltro.includes(st.id);
                return (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => toggleStatusFiltro(st.id)}
                    className={`px-3 py-1 rounded-full font-sans text-[12px] font-semibold transition-all border ${
                      isActive
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/60 shadow-sm'
                        : 'bg-graphite-950 text-vapor-400 border-graphite-800 hover:border-graphite-700 hover:text-vapor-200'
                    }`}
                  >
                    {st.label}
                  </button>
                );
              })}
            </div>

            {/* Contador por Status no Período Selecionado */}
            <div className="font-mono text-[12px] text-amber-400 bg-graphite-950 px-3 py-1 rounded-lg border border-graphite-800">
              {renderContadorStatusText()}
            </div>
          </div>
        </div>
      </Card>

      {/* ═══════════════════════════════════════
          BARRA DE CONTROLES: NAVEGAÇÃO & ABAS
      ═══════════════════════════════════════ */}
      <Card className="p-3 bg-graphite-900 border-graphite-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md">
        <div className="flex items-center gap-2">
          {viewMode !== 'lista' && (
            <>
              <Button variant="secondary" onClick={handlePrev} className="px-2.5 min-h-[40px]">
                <ChevronLeft size={16} />
              </Button>

              <Button variant="secondary" onClick={handleHoje} className="font-sans text-[12px] min-h-[40px]">
                Hoje
              </Button>

              <Button variant="secondary" onClick={handleNext} className="px-2.5 min-h-[40px]">
                <ChevronRight size={16} />
              </Button>
            </>
          )}

          <span className="font-mono text-[14px] font-bold text-vapor-100 capitalize ml-2">
            {dateTitle()}
          </span>
        </div>

        {/* Abas Dia / Semana / Mês / Lista */}
        <div className="flex items-center gap-1 bg-graphite-800 p-1 rounded-lg border border-graphite-700">
          <button
            onClick={() => setViewMode('dia')}
            className={`px-3 py-1.5 rounded font-sans text-[12px] font-medium transition-colors min-h-[36px] ${
              viewMode === 'dia'
                ? 'bg-amber-500 text-graphite-950 font-bold shadow'
                : 'text-vapor-400 hover:text-vapor-100'
            }`}
          >
            Dia
          </button>
          <button
            onClick={() => setViewMode('semana')}
            className={`px-3 py-1.5 rounded font-sans text-[12px] font-medium transition-colors min-h-[36px] ${
              viewMode === 'semana'
                ? 'bg-amber-500 text-graphite-950 font-bold shadow'
                : 'text-vapor-400 hover:text-vapor-100'
            }`}
          >
            Semana
          </button>
          <button
            onClick={() => setViewMode('mes')}
            className={`px-3 py-1.5 rounded font-sans text-[12px] font-medium transition-colors min-h-[36px] ${
              viewMode === 'mes'
                ? 'bg-amber-500 text-graphite-950 font-bold shadow'
                : 'text-vapor-400 hover:text-vapor-100'
            }`}
          >
            Mês
          </button>
          <button
            onClick={() => setViewMode('lista')}
            className={`px-3 py-1.5 rounded font-sans text-[12px] font-medium transition-colors min-h-[36px] flex items-center gap-1.5 ${
              viewMode === 'lista'
                ? 'bg-amber-500 text-graphite-950 font-bold shadow'
                : 'text-vapor-400 hover:text-vapor-100'
            }`}
          >
            <List size={14} />
            <span>Lista</span>
          </button>
        </div>
      </Card>

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
          {/* ESTADO VAZIO EXPLÍCITO QUANDO NÃO HÁ RESULTADOS */}
          {agendamentos.length === 0 ? (
            <Card className="p-12 bg-graphite-900 border-graphite-800 text-center flex flex-col items-center gap-3">
              <CalendarIcon size={40} className="text-vapor-500" />
              <span className="font-display text-[16px] text-vapor-200 uppercase font-bold">
                Nenhum atendimento encontrado com esses filtros
              </span>
              <span className="font-sans text-[13px] text-vapor-400 max-w-md">
                Tente ajustar a busca por texto, selecionar outros status ou alterar o período de exibição.
              </span>
              {isFiltered && (
                <Button
                  variant="secondary"
                  onClick={handleLimparFiltros}
                  className="mt-2 flex items-center gap-2 text-amber-400 border-amber-500/40"
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
                const agendamentosDiaView = agendamentos
                  .map((a) => {
                    const papel = verificarPapelDiaAgendamento(
                      a.inicio,
                      diaIso,
                      a.dias_ocupados,
                      a.modo_ocupacao_efetivo || a.modo_ocupacao
                    );
                    return { ag: a, papel };
                  })
                  .filter((item) => item.papel.pertenceAoDia);

                return (
                  <div className="flex flex-col gap-3">
                    {agendamentosDiaView.map(({ ag, papel }) => {
                      const isContinuacao = papel.isContinuacao;
                      const hora = isContinuacao ? 'Cont.' : (ag.inicio ? formatarHora(ag.inicio) : '');
                      const isCancelado = ag.status === 'cancelado' || ag.status === 'nao_compareceu';
                      const firstServ = ag.agendamento_itens?.[0]?.servicos || ag.servico;
                      const extraCount = Math.max(0, (ag.agendamento_itens?.length || 1) - 1);
                      const durTotal = ag.duracao_total || ag.duracao_minutos;

                      return (
                        <Card
                          key={`${ag.id}-${isContinuacao ? 'cont' : 'start'}`}
                          onClick={() => {
                            setSelectedAgendamento(ag);
                            setIsPainelOpen(true);
                          }}
                          className={`p-4 bg-graphite-900 border-graphite-800 hover:border-graphite-700 cursor-pointer transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                            isContinuacao
                              ? 'border-dashed border-amber-500/60 bg-amber-500/5'
                              : isCancelado
                              ? 'opacity-60 bg-graphite-950/40'
                              : ''
                          }`}
                        >
                          <div className="flex items-center gap-4">
                            <div className="flex flex-col items-center justify-center bg-graphite-800 px-3 py-2 rounded-lg border border-graphite-700 shrink-0 min-w-[70px]">
                              <span className="font-mono text-[16px] font-bold text-amber-400">
                                {hora}
                              </span>
                              <span className="font-sans text-[10px] text-vapor-400">
                                {durTotal} min
                              </span>
                            </div>

                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                {isContinuacao && (
                                  <span className="text-[10px] bg-amber-500 text-graphite-950 px-2 py-0.5 rounded font-extrabold uppercase">
                                    Pernoite / Continuação
                                  </span>
                                )}
                                <span className={`font-mono text-[16px] font-bold text-vapor-100 ${isCancelado ? 'line-through' : ''}`}>
                                  {ag.veiculo ? `${ag.veiculo.placa} (${ag.veiculo.modelo})` : 'Sem veículo'}
                                </span>
                                <span className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded bg-graphite-800 text-amber-400 border border-graphite-700">
                                  {formatarOS(ag.numero_os)}
                                </span>
                                {((ag.origem as string) === 'agendamento_online' || ag.origem === 'online') && (
                                  <span className="font-sans text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                    Online
                                  </span>
                                )}
                                <Badge tone={getBadgeToneFromStatus(ag.status)}>
                                  {getLabelFromStatus(ag.status)}
                                </Badge>
                              </div>

                              <div className={`font-sans text-[13px] ${isCancelado ? 'text-vapor-500' : 'text-vapor-400'}`}>
                                {ag.cliente?.nome || 'Cliente'} <span className="mx-1 text-graphite-600">•</span> <span className={isCancelado ? 'line-through' : ''}>{firstServ?.nome || 'Serviço'}</span>
                              </div>
                            </div>
                          </div>

                          <div className="shrink-0 flex items-center gap-1.5">
                            <ServiceChip
                              code={firstServ?.codigo || 'SV'}
                              label={firstServ?.nome || 'Serviço'}
                              tone={firstServ?.tom as any || 'vapor'}
                            />
                            {extraCount > 0 && (
                              <span className="bg-graphite-800 text-amber-400 border border-graphite-700 font-mono text-[11px] font-bold px-1.5 py-0.5 rounded">
                                +{extraCount}
                              </span>
                            )}
                          </div>
                        </Card>
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

                    const agendamentosDoDia = agendamentos
                      .map((a) => {
                        const papel = verificarPapelDiaAgendamento(
                          a.inicio,
                          diaIso,
                          a.dias_ocupados,
                          a.modo_ocupacao_efetivo || a.modo_ocupacao
                        );
                        return { ag: a, papel };
                      })
                      .filter((item) => item.papel.pertenceAoDia);

                    const isHoje = formatarDataIsoSP(new Date()) === diaIso;

                    return (
                      <div
                        key={diaIso}
                        className={`flex flex-col rounded-lg border p-3 min-h-[300px] transition-colors ${
                          isHoje
                            ? 'bg-graphite-900 border-amber-500/60 shadow-lg'
                            : isAtivo
                            ? 'bg-graphite-900 border-graphite-800'
                            : 'bg-graphite-950/60 border-graphite-800/60 opacity-60'
                        }`}
                      >
                        <div className="flex flex-col pb-2 mb-3 border-b border-graphite-800">
                          <span className="font-display text-[11px] text-vapor-400 uppercase tracking-wider">
                            {getNomeDiaSemana(diaSemanaNum).substring(0, 3)}
                          </span>
                          <span className="font-mono text-[16px] font-bold text-vapor-100">
                            {dia.getDate()}
                          </span>
                          {!isAtivo && (
                            <span className="font-sans text-[10px] text-flare-400 font-medium">Fechado</span>
                          )}
                        </div>

                        <div className="flex-1 flex flex-col gap-2">
                          {agendamentosDoDia.map(({ ag, papel }) => {
                            const isContinuacao = papel.isContinuacao;
                            const hora = isContinuacao ? 'Cont.' : (ag.inicio ? formatarHora(ag.inicio) : '');
                            const isCancelado = ag.status === 'cancelado' || ag.status === 'nao_compareceu';
                            const modoEfetivo = ag.modo_ocupacao_efetivo || ag.modo_ocupacao;
                            const isDiaInteiro = modoEfetivo === 'dia_inteiro';
                            const firstServ = ag.agendamento_itens?.[0]?.servicos || ag.servico;
                            const extraCount = Math.max(0, (ag.agendamento_itens?.length || 1) - 1);

                            return (
                              <div
                                key={`${ag.id}-${papel.isContinuacao ? 'cont' : 'start'}`}
                                onClick={() => {
                                  setSelectedAgendamento(ag);
                                  setIsPainelOpen(true);
                                }}
                                className={`p-2.5 rounded-lg border cursor-pointer flex flex-col gap-1 transition-all hover:scale-[1.01] ${
                                  isContinuacao
                                    ? 'bg-amber-500/10 border-dashed border-amber-500/60 text-amber-300'
                                    : isDiaInteiro
                                    ? 'bg-amber-500/15 border-amber-500 text-amber-300'
                                    : isCancelado
                                    ? 'bg-graphite-950 border-graphite-800 opacity-60'
                                    : 'bg-graphite-800 border-graphite-700 text-vapor-200'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-mono text-[11px] font-bold text-amber-400 flex items-center gap-1">
                                    {isContinuacao && (
                                      <span className="text-[9px] bg-amber-500 text-graphite-950 px-1 rounded font-extrabold uppercase">
                                        Pernoite
                                      </span>
                                    )}
                                    <span>{hora}</span>
                                  </span>
                                  <Badge tone={getBadgeToneFromStatus(ag.status)}>
                                    {getLabelFromStatus(ag.status)}
                                  </Badge>
                                </div>

                                <div className="flex items-center justify-between gap-1 flex-wrap">
                                  <span className={`font-mono text-[12px] font-semibold text-vapor-100 ${isCancelado ? 'line-through' : ''}`}>
                                    {ag.veiculo?.placa || 'Sem Veículo'}
                                  </span>
                                  <span className="font-mono text-[10px] text-amber-400 font-semibold">
                                    {formatarOS(ag.numero_os)}
                                  </span>
                                </div>

                                <span className="font-sans text-[11px] text-vapor-400 truncate">
                                  {firstServ?.nome || 'Serviço'} {extraCount > 0 ? `(+${extraCount})` : ''}
                                </span>
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
                        className={`p-2 min-h-[75px] rounded-lg border text-left flex flex-col justify-between transition-colors ${
                          !isCurrentMonth
                            ? 'bg-graphite-950/40 border-graphite-800/40 opacity-40'
                            : isHoje
                            ? 'bg-graphite-900 border-amber-500/60 shadow'
                            : 'bg-graphite-900 border-graphite-800 hover:border-graphite-700'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className={`font-mono text-[12px] font-bold ${isHoje ? 'text-amber-400' : 'text-vapor-300'}`}>
                            {dia.getDate()}
                          </span>
                          {countAg > 0 && (
                            <span className="font-sans text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.5 rounded font-extrabold">
                              {countAg}
                            </span>
                          )}
                        </div>

                        {countAg > 0 && (
                          <div className="flex flex-col gap-0.5 mt-1 overflow-hidden">
                            {agsDoDia.slice(0, 2).map((ag, i) => (
                              <span key={i} className="text-[10px] font-mono text-vapor-300 truncate bg-graphite-800/80 px-1 py-0.5 rounded border border-graphite-700">
                                {ag.veiculo?.placa || ag.cliente?.nome?.split(' ')[0] || 'Agendado'}
                              </span>
                            ))}
                            {countAg > 2 && (
                              <span className="text-[9px] font-sans text-amber-400 font-semibold pl-0.5">
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
                  NOVA VISÃO "LISTA" (Cronológica Decrescente)
              ═══════════════════════════════════════ */}
              {viewMode === 'lista' && (
                <div className="flex flex-col gap-3">
                  <div className="bg-graphite-900 border border-graphite-800 rounded-lg overflow-hidden shadow-md">
                    <div className="divide-y divide-graphite-800">
                      {agendamentos.map((ag) => {
                        const hora = ag.inicio ? formatarHora(ag.inicio) : '';
                        const dataFormatada = ag.inicio ? formatarData(ag.inicio) : '';
                        const isCancelado = ag.status === 'cancelado' || ag.status === 'nao_compareceu';
                        const firstServ = ag.agendamento_itens?.[0]?.servicos || ag.servico;
                        const extraCount = Math.max(0, (ag.agendamento_itens?.length || 1) - 1);
                        
                        // Valor cobrado (Apenas para concluídos e gestores)
                        const valorCobrado = ag.execucao?.valor_total_final 
                          ?? ag.preco_estimado_total 
                          ?? ag.preco_estimado;

                        return (
                          <div
                            key={ag.id}
                            onClick={() => {
                              setSelectedAgendamento(ag);
                              setIsPainelOpen(true);
                            }}
                            className={`p-4 hover:bg-graphite-800/60 cursor-pointer transition-all flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                              isCancelado ? 'opacity-60 bg-graphite-950/40' : ''
                            }`}
                          >
                            {/* Bloco 1: OS, Data/Hora, Veículo, Cliente */}
                            <div className="flex items-start md:items-center gap-4 flex-1">
                              <div className="flex flex-col items-center justify-center bg-graphite-800 px-3 py-2 rounded-lg border border-graphite-700 shrink-0 min-w-[80px]">
                                <span className="font-mono text-[13px] font-bold text-amber-400">
                                  {formatarOS(ag.numero_os)}
                                </span>
                                <span className="font-mono text-[11px] text-vapor-300">
                                  {hora}
                                </span>
                              </div>

                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={`font-mono text-[15px] font-bold text-vapor-100 ${isCancelado ? 'line-through' : ''}`}>
                                    {ag.veiculo ? `${ag.veiculo.placa} (${ag.veiculo.modelo})` : 'Sem veículo'}
                                  </span>
                                  <span className="font-sans text-[12px] text-vapor-400">
                                    • {dataFormatada}
                                  </span>
                                  {((ag.origem as string) === 'agendamento_online' || ag.origem === 'online') && (
                                    <span className="font-sans text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                      Online
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2 text-[13px] text-vapor-300 flex-wrap">
                                  <span className="font-medium text-vapor-200">
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
                                  code={firstServ?.codigo || 'SV'}
                                  label={firstServ?.nome || 'Serviço'}
                                  tone={firstServ?.tom as any || 'vapor'}
                                />
                                {extraCount > 0 && (
                                  <span className="bg-graphite-800 text-amber-400 border border-graphite-700 font-mono text-[11px] font-bold px-1.5 py-0.5 rounded">
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
                                <div className="flex items-center gap-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded font-mono text-[13px] font-bold">
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
                        variant="secondary"
                        onClick={() => fetchAgendaData(true)}
                        disabled={loadingMore}
                        className="px-6 py-2.5 font-sans text-[13px] font-semibold text-amber-400 border-amber-500/40 hover:bg-amber-500/10 min-h-[44px]"
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
        onClose={() => setIsModalNovoOpen(false)}
        onSuccess={() => {
          fetchAgendaData();
        }}
        initialDate={formatarDataIsoSP(selectedDate)}
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
  const [activeTab, setActiveTab] = useState<'hoje' | 'agenda'>(() => {
    const saved = localStorage.getItem('agenda_active_tab');
    if (saved === 'hoje' || saved === 'agenda') return saved;
    return abaInicial;
  });

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

      {activeTab === 'hoje' ? <Hoje /> : <VisaoAgenda />}
    </div>
  );
};
