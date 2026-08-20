import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissao } from '../../hooks/usePermissao';
import { usePlano } from '../../hooks/usePlano';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import {
  HardDrive,
  FolderArchive,
  Download,
  ShieldCheck,
  CheckSquare,
  Square,
  Search,
  AlertTriangle,
  Calendar,
  Car,
  User as UserIcon,
  FileCheck,
  Clock,
} from 'lucide-react';
import { downloadFotosAtendimentoZip } from '../../utils/zipFotos';
import { navegarParaAtendimento } from '../../utils/navegacaoAtendimento';

interface AtendimentoAcervo {
  execucaoId: string;
  agendamentoId: string;
  placa: string;
  modelo: string;
  clienteNome: string;
  dataAtendimento: string;
  qtdVistoria: number;
  qtdExecucao: number;
  totalFotos: number;
  expiradoEm?: string | null;
  diasRestantes?: number | null;
  preservada: boolean;
  fotos: Array<{ id: string; path: string; momento?: string; tipo: 'vistoria' | 'execucao' }>;
}

export const AbaArquivosDigitais: React.FC = () => {
  const navigate = useNavigate();
  const { tenant } = useAuth();
  const { isDono, podeGerirServicos } = usePermissao();
  const { nomePlano, limiteDe } = usePlano();

  const [loading, setLoading] = useState(true);
  const [atendimentosAcervo, setAtendimentosAcervo] = useState<AtendimentoAcervo[]>([]);
  const [qtdVistoriaTotal, setQtdVistoriaTotal] = useState(0);
  const [qtdExecucaoTotal, setQtdExecucaoTotal] = useState(0);

  // Filtro de Busca no Acervo
  const [searchQuery, setSearchQuery] = useState('');

  // Estado para Seleção em Lote do Bloco "Vencendo em Breve"
  const [selectedVencendoIds, setSelectedVencendoIds] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    setErrorMsg(null);

    try {
      // 1. Busca fotos de vistoria (check-in)
      const { data: checkinFotosData, error: checkinErr } = await supabase
        .from('checkin_fotos')
        .select(`
          id,
          path,
          created_at,
          checkins!inner (
            id,
            tenant_id,
            agendamento_id,
            agendamentos (
              id,
              inicio,
              cliente:clientes(nome),
              veiculo:veiculos(placa, modelo)
            )
          )
        `)
        .eq('checkins.tenant_id', tenant.id);

      if (checkinErr) throw checkinErr;

      // 2. Busca fotos de execução
      const { data: execFotosData, error: execErr } = await supabase
        .from('execucao_fotos')
        .select(`
          id,
          path,
          momento,
          expirado_em,
          preservada,
          created_at,
          execucao_id,
          execucoes!inner (
            id,
            tenant_id,
            agendamento_id,
            created_at,
            agendamentos (
              id,
              inicio,
              cliente:clientes(nome),
              veiculo:veiculos(placa, modelo)
            )
          )
        `)
        .eq('execucoes.tenant_id', tenant.id);

      if (execErr) throw execErr;

      setQtdVistoriaTotal(checkinFotosData?.length || 0);
      setQtdExecucaoTotal(execFotosData?.length || 0);

      // Mapa para agrupar acervo por execução / agendamento
      const mapa = new Map<string, AtendimentoAcervo>();

      // Processa fotos de check-in (Vistoria - permanentes)
      if (checkinFotosData) {
        checkinFotosData.forEach((f: any) => {
          const ag = f.checkins?.agendamentos;
          const key = f.checkins?.agendamento_id || f.checkins?.id;
          if (!key) return;

          const placa = ag?.veiculo?.placa || 'Sem placa';
          const modelo = ag?.veiculo?.modelo || '';
          const clienteNome = ag?.cliente?.nome || 'Cliente';
          const dataAtendimento = ag?.inicio || f.created_at;

          if (!mapa.has(key)) {
            mapa.set(key, {
              execucaoId: key,
              agendamentoId: f.checkins?.agendamento_id,
              placa,
              modelo,
              clienteNome,
              dataAtendimento,
              qtdVistoria: 1,
              qtdExecucao: 0,
              totalFotos: 1,
              preservada: true,
              fotos: [{ id: f.id, path: f.path, tipo: 'vistoria' }],
            });
          } else {
            const item = mapa.get(key)!;
            item.qtdVistoria += 1;
            item.totalFotos += 1;
            item.fotos.push({ id: f.id, path: f.path, tipo: 'vistoria' });
          }
        });
      }

      // Processa fotos de execução
      if (execFotosData) {
        execFotosData.forEach((f: any) => {
          const execId = f.execucao_id;
          const ag = f.execucoes?.agendamentos;
          const placa = ag?.veiculo?.placa || 'Sem placa';
          const modelo = ag?.veiculo?.modelo || '';
          const clienteNome = ag?.cliente?.nome || 'Cliente';
          const dataAtendimento = f.execucoes?.created_at || ag?.inicio || f.created_at;

          const expIso = f.expirado_em;
          let dias: number | null = null;
          if (expIso) {
            const expTime = new Date(expIso).getTime();
            dias = Math.max(0, Math.ceil((expTime - Date.now()) / (1000 * 60 * 60 * 24)));
          }

          if (!mapa.has(execId)) {
            mapa.set(execId, {
              execucaoId: execId,
              agendamentoId: f.execucoes?.agendamento_id,
              placa,
              modelo,
              clienteNome,
              dataAtendimento,
              qtdVistoria: 0,
              qtdExecucao: 1,
              totalFotos: 1,
              expiradoEm: expIso,
              diasRestantes: dias,
              preservada: f.preservada || false,
              fotos: [{ id: f.id, path: f.path, momento: f.momento, tipo: 'execucao' }],
            });
          } else {
            const item = mapa.get(execId)!;
            item.qtdExecucao += 1;
            item.totalFotos += 1;
            if (!f.preservada) item.preservada = false; // se tiver ao menos uma não preservada
            if (dias !== null && (item.diasRestantes === undefined || item.diasRestantes === null || dias < item.diasRestantes)) {
              item.diasRestantes = dias;
              item.expiradoEm = expIso;
            }
            item.fotos.push({ id: f.id, path: f.path, momento: f.momento, tipo: 'execucao' });
          }
        });
      }

      setAtendimentosAcervo(Array.from(mapa.values()));
    } catch (err: any) {
      console.error('[AbaArquivosDigitais load error]:', err);
      setErrorMsg('Erro ao carregar arquivos digitais: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [tenant?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Lista de Vencendo em Breve (fotos de execução não preservadas vencendo nos próximos 15 dias)
  const vencendoEmBreve = useMemo(() => {
    return atendimentosAcervo.filter((a) => {
      if (a.qtdExecucao === 0) return false;
      if (a.preservada) return false;
      if (a.diasRestantes === null || a.diasRestantes === undefined) return false;
      return a.diasRestantes <= 15;
    });
  }, [atendimentosAcervo]);

  // Acervo filtrado por busca (cliente ou placa)
  const acervoFiltrado = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return atendimentosAcervo;
    return atendimentosAcervo.filter(
      (a) => a.clienteNome.toLowerCase().includes(q) || a.placa.toLowerCase().includes(q)
    );
  }, [atendimentosAcervo, searchQuery]);

  // Cálculos do Bloco 1 — Resumo de Armazenamento
  const totalFotosCount = qtdVistoriaTotal + qtdExecucaoTotal;
  const estMbVistoria = (qtdVistoriaTotal * 1.5).toFixed(1);
  const estMbExecucao = (qtdExecucaoTotal * 1.5).toFixed(1);
  const estMbTotal = ((qtdVistoriaTotal + qtdExecucaoTotal) * 1.5).toFixed(1);
  const retencaoDiasPlano = limiteDe('retencao_fotos_execucao_dias' as any) || 90;

  // Ações de seleção e preservação
  const handlePreservarAtendimento = async (execucaoId: string, novoStatus: boolean) => {
    setActionLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const { error } = await supabase.rpc('preservar_fotos_execucao', {
        p_execucao: execucaoId,
        p_preservar: novoStatus,
      });
      if (error) throw error;

      setSuccessMsg(
        novoStatus
          ? 'Fotos preservadas com sucesso no acervo permanente.'
          : 'Preservação removida. Fotos voltaram ao ciclo de retenção.'
      );
      await loadData();
    } catch (err: any) {
      console.error('[Preservar error]:', err);
      setErrorMsg('Erro ao alterar preservação: ' + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleSelectVencendoAll = () => {
    if (selectedVencendoIds.size === vencendoEmBreve.length) {
      setSelectedVencendoIds(new Set());
    } else {
      setSelectedVencendoIds(new Set(vencendoEmBreve.map((v) => v.execucaoId)));
    }
  };

  const handleToggleSelectVencendo = (id: string) => {
    setSelectedVencendoIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handlePreservarSelecionados = async () => {
    if (selectedVencendoIds.size === 0) return;
    if (
      !window.confirm(
        `Deseja preservar as fotos de ${selectedVencendoIds.size} atendimento(s) selecionado(s)? Elas passarão ao acervo permanente.`
      )
    ) {
      return;
    }

    setActionLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      for (const id of Array.from(selectedVencendoIds)) {
        const { error } = await supabase.rpc('preservar_fotos_execucao', {
          p_execucao: id,
          p_preservar: true,
        });
        if (error) throw error;
      }

      setSuccessMsg(`${selectedVencendoIds.size} atendimento(s) preservado(s) com sucesso!`);
      setSelectedVencendoIds(new Set());
      await loadData();
    } catch (err: any) {
      console.error('[Preservar Lote error]:', err);
      setErrorMsg('Erro ao preservar fotos em lote: ' + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleBaixarZip = async (item: AtendimentoAcervo) => {
    setDownloadingId(item.execucaoId);
    setErrorMsg(null);
    try {
      await downloadFotosAtendimentoZip(item.placa, item.execucaoId, item.fotos);
    } catch (err: any) {
      console.error('[Download ZIP Error]:', err);
      setErrorMsg('Erro ao baixar arquivo ZIP: ' + err.message);
    } finally {
      setDownloadingId(null);
    }
  };

  if (!podeGerirServicos() && !isDono) {
    return (
      <Card className="p-6 bg-graphite-900 border-graphite-800 text-center">
        <AlertTriangle size={36} className="text-amber-500 mx-auto mb-3" />
        <h3 className="text-lg font-bold text-vapor-100">Acesso Restrito</h3>
        <p className="text-sm text-vapor-400 mt-2">
          Apenas Donos e Gerentes do estabelecimento possuem permissão para visualizar e gerenciar os arquivos digitais e o acervo de fotos.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Mensagens de Feedback */}
      {errorMsg && (
        <div className="p-3.5 bg-flare-400/10 border border-flare-400/30 rounded-lg text-flare-400 text-sm flex items-center gap-2">
          <AlertTriangle size={18} className="shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400 text-sm flex items-center gap-2">
          <ShieldCheck size={18} className="shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center p-12 text-vapor-400 gap-3">
          <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Carregando acervo de arquivos digitais...</span>
        </div>
      ) : totalFotosCount === 0 ? (
        /* ESTADO VAZIO GLOBAL: Oficina sem nenhuma foto */
        <Card className="p-12 bg-graphite-900 border-graphite-800 text-center flex flex-col items-center justify-center gap-3">
          <FolderArchive size={48} className="text-vapor-500" />
          <h3 className="text-base font-bold text-vapor-200">Nenhum arquivo digital ou foto no acervo</h3>
          <p className="text-xs text-vapor-400 max-w-md">
            As fotos registradas durante a vistoria de entrada (check-in) e a execução dos serviços aparecerão aqui organizadas por atendimento.
          </p>
        </Card>
      ) : (
        <>
          {/* ========================================== */}
          {/* BLOCO 1: RESUMO DO ARMAZENAMENTO           */}
          {/* ========================================== */}
          <Card className="p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-5 shadow-lg">
            <div className="flex items-center justify-between border-b border-graphite-700 pb-3">
              <div className="flex items-center gap-2.5">
                <HardDrive size={22} className="text-amber-500" />
                <h3 className="font-display text-[16px] text-vapor-100 uppercase tracking-wide">
                  Resumo do Armazenamento
                </h3>
              </div>
              <Badge tone="amber">Plano {nomePlano.toUpperCase()}</Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Card Total */}
              <div className="p-4 bg-graphite-900 rounded-lg border border-graphite-700 flex flex-col gap-1">
                <span className="font-sans text-[12px] text-vapor-400 uppercase tracking-wider font-semibold flex items-center gap-1.5">
                  <FolderArchive size={14} className="text-amber-500" />
                  Espaço Total Estimado
                </span>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="font-mono text-2xl font-bold text-vapor-100">{estMbTotal} MB</span>
                  <span className="font-mono text-xs text-vapor-400">({totalFotosCount} arquivos)</span>
                </div>
                <span className="font-sans text-[11px] text-vapor-500 mt-1">
                  Calculado com base em foto média de 1.5MB
                </span>
              </div>

              {/* Card Fotos de Vistoria (Permanentes) */}
              <div className="p-4 bg-graphite-900 rounded-lg border border-graphite-700 flex flex-col gap-1">
                <span className="font-sans text-[12px] text-vapor-400 uppercase tracking-wider font-semibold flex items-center gap-1.5">
                  <FileCheck size={14} className="text-mint-400" />
                  Fotos de Vistoria (Check-in)
                </span>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="font-mono text-2xl font-bold text-mint-400">{estMbVistoria} MB</span>
                  <span className="font-mono text-xs text-vapor-400">({qtdVistoriaTotal} fotos)</span>
                </div>
                <span className="font-sans text-[11px] text-mint-400/90 font-medium mt-1 flex items-center gap-1">
                  <ShieldCheck size={12} />
                  Permanentes (nunca expiram)
                </span>
              </div>

              {/* Card Fotos de Execução (Com retenção) */}
              <div className="p-4 bg-graphite-900 rounded-lg border border-graphite-700 flex flex-col gap-1">
                <span className="font-sans text-[12px] text-vapor-400 uppercase tracking-wider font-semibold flex items-center gap-1.5">
                  <Clock size={14} className="text-amber-400" />
                  Fotos de Execução
                </span>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="font-mono text-2xl font-bold text-amber-400">{estMbExecucao} MB</span>
                  <span className="font-mono text-xs text-vapor-400">({qtdExecucaoTotal} fotos)</span>
                </div>
                <span className="font-sans text-[11px] text-vapor-400 mt-1">
                  Retenção padrão: <strong className="text-vapor-200 font-mono">{retencaoDiasPlano} dias</strong>
                </span>
              </div>
            </div>
          </Card>

          {/* ========================================== */}
          {/* BLOCO 2: ACERVO POR ATENDIMENTO           */}
          {/* ========================================== */}
          <Card className="p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-5 shadow-lg">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-graphite-700 pb-4">
              <div>
                <h3 className="font-display text-[16px] text-vapor-100 uppercase tracking-wide flex items-center gap-2">
                  <FolderArchive size={20} className="text-amber-500" />
                  <span>Acervo por Atendimento</span>
                </h3>
                <p className="font-sans text-[12px] text-vapor-400 mt-0.5">
                  Histórico completo de vistorias e execuções com fotos gravadas.
                </p>
              </div>

              {/* Busca por cliente ou placa */}
              <div className="relative min-w-[240px]">
                <Search size={16} className="absolute left-3 top-3 text-vapor-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar por cliente ou placa..."
                  className="w-full bg-graphite-950 border border-graphite-600 rounded-lg pl-9 pr-3 py-2 text-vapor-100 font-sans text-[13px] outline-none focus:border-amber-500"
                />
              </div>
            </div>

            {/* Tabela / Lista do Acervo */}
            {acervoFiltrado.length === 0 ? (
              <div className="p-8 text-center text-vapor-400 font-sans text-xs">
                Nenhum atendimento localizado para a busca "{searchQuery}".
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {acervoFiltrado.map((item) => {
                  const dataFormatada = item.dataAtendimento
                    ? new Date(item.dataAtendimento).toLocaleDateString('pt-BR')
                    : 'Data n/d';

                  return (
                    <div
                      key={item.execucaoId}
                      className="p-4 bg-graphite-900 rounded-lg border border-graphite-700 hover:border-graphite-600 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      {/* Dados do atendimento */}
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[14px] font-bold text-vapor-100 bg-graphite-800 px-2 py-0.5 rounded border border-graphite-600">
                            {item.placa.toUpperCase()}
                          </span>
                          {item.modelo && (
                            <span className="font-sans text-[13px] text-vapor-300 font-medium flex items-center gap-1">
                              <Car size={14} className="text-vapor-400" />
                              {item.modelo}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 font-sans text-[12px] text-vapor-400">
                          <span className="flex items-center gap-1 font-semibold text-vapor-200">
                            <UserIcon size={14} />
                            {item.clienteNome}
                          </span>
                          <span>•</span>
                          <span className="flex items-center gap-1 text-vapor-400 font-mono">
                            <Calendar size={13} />
                            {dataFormatada}
                          </span>
                        </div>

                        {/* Detalhe de contagem de fotos */}
                        <div className="flex items-center gap-2 text-[11px] font-mono mt-1">
                          <span className="text-amber-400 font-bold bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                            {item.totalFotos} foto(s) total
                          </span>
                          {item.qtdVistoria > 0 && (
                            <span className="text-mint-400 bg-mint-500/10 px-2 py-0.5 rounded border border-mint-500/20">
                              {item.qtdVistoria} vistoria
                            </span>
                          )}
                          {item.qtdExecucao > 0 && (
                            <span className="text-vapor-300 bg-graphite-800 px-2 py-0.5 rounded border border-graphite-700">
                              {item.qtdExecucao} execução
                            </span>
                          )}
                          {item.preservada && item.qtdExecucao > 0 && (
                            <span className="text-mint-400 font-bold flex items-center gap-0.5">
                              <ShieldCheck size={12} /> Preservado
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Botões de Ação por linha */}
                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => handleBaixarZip(item)}
                          disabled={downloadingId === item.execucaoId}
                          className="text-xs h-9 px-3 flex items-center gap-1.5"
                          title="Baixar todas as fotos em formato .ZIP"
                        >
                          {downloadingId === item.execucaoId ? (
                            <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <Download size={14} />
                          )}
                          <span>Baixar ZIP</span>
                        </Button>

                        {item.qtdExecucao > 0 && (
                          <Button
                            type="button"
                            variant={item.preservada ? 'secondary' : 'primary'}
                            onClick={() => handlePreservarAtendimento(item.execucaoId, !item.preservada)}
                            disabled={actionLoading}
                            className={`text-xs h-9 px-3 flex items-center gap-1.5 ${
                              item.preservada
                                ? 'bg-mint-500/20 text-mint-400 border-mint-500/40 hover:bg-mint-500/30'
                                : ''
                            }`}
                            title={item.preservada ? 'Remover preservação permanente' : 'Preservar permanentemente no acervo'}
                          >
                            <ShieldCheck size={14} />
                            <span>{item.preservada ? 'Preservado' : 'Preservar'}</span>
                          </Button>
                        )}

                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => navegarParaAtendimento(navigate, item.execucaoId, item.agendamentoId)}
                          className="text-xs h-9 px-3"
                        >
                          Ver
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* ========================================== */}
          {/* BLOCO 3: VENCENDO EM BREVE                */}
          {/* ========================================== */}
          <Card className="p-6 bg-graphite-800 border-amber-500/30 flex flex-col gap-5 shadow-lg">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-graphite-700 pb-4">
              <div>
                <h3 className="font-display text-[16px] text-amber-400 uppercase tracking-wide flex items-center gap-2">
                  <AlertTriangle size={20} className="text-amber-400" />
                  <span>Vencendo em Breve</span>
                </h3>
                <p className="font-sans text-[12px] text-vapor-400 mt-0.5">
                  Atendimentos com fotos de execução expirando nos próximos 15 dias.
                </p>
              </div>

              {/* Botão de Selecionar Todos / Preservar Selecionados */}
              {vencendoEmBreve.length > 0 && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleToggleSelectVencendoAll}
                    className="flex items-center gap-2 text-xs font-semibold text-vapor-200 hover:text-vapor-100"
                  >
                    {selectedVencendoIds.size === vencendoEmBreve.length ? (
                      <CheckSquare size={18} className="text-amber-500" />
                    ) : (
                      <Square size={18} className="text-vapor-400" />
                    )}
                    <span>Selecionar todos ({vencendoEmBreve.length})</span>
                  </button>

                  {selectedVencendoIds.size > 0 && (
                    <Button
                      type="button"
                      variant="primary"
                      onClick={handlePreservarSelecionados}
                      disabled={actionLoading}
                      className="text-xs h-8 px-3 flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-graphite-950 font-bold"
                    >
                      <ShieldCheck size={14} />
                      <span>Preservar ({selectedVencendoIds.size})</span>
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Conteúdo do Bloco 3: Lista de prestes a expirar ou estado vazio relativo */}
            {vencendoEmBreve.length === 0 ? (
              <div className="p-6 bg-graphite-900 border border-graphite-700 rounded-lg text-center flex flex-col items-center justify-center gap-2">
                <ShieldCheck size={36} className="text-mint-400 opacity-90" />
                <h4 className="font-sans text-[14px] font-bold text-vapor-200">
                  Nenhuma foto prestes a expirar nos próximos 15 dias
                </h4>
                <p className="font-sans text-[12px] text-vapor-400 max-w-md">
                  Todas as fotos de execução da sua oficina estão dentro do prazo de retenção ou devidamente preservadas no acervo permanente.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {vencendoEmBreve.map((item) => {
                  const isSelected = selectedVencendoIds.has(item.execucaoId);
                  const dataFormatada = item.expiradoEm
                    ? new Date(item.expiradoEm).toLocaleDateString('pt-BR')
                    : '—';

                  return (
                    <div
                      key={item.execucaoId}
                      className={`p-4 rounded-lg border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                        isSelected
                          ? 'bg-amber-500/10 border-amber-500/60'
                          : 'bg-graphite-900 border-amber-500/30 hover:border-amber-500/50'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          onClick={() => handleToggleSelectVencendo(item.execucaoId)}
                          className="mt-1 text-vapor-400 hover:text-amber-500 shrink-0"
                        >
                          {isSelected ? (
                            <CheckSquare size={20} className="text-amber-500" />
                          ) : (
                            <Square size={20} />
                          )}
                        </button>

                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-[14px] font-bold text-vapor-100 bg-graphite-800 px-2 py-0.5 rounded border border-graphite-700">
                              {item.placa.toUpperCase()}
                            </span>
                            {item.modelo && (
                              <span className="font-sans text-[13px] text-vapor-300 flex items-center gap-1">
                                <Car size={14} className="text-vapor-400" />
                                {item.modelo}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-3 text-xs text-vapor-400 mt-0.5">
                            <span className="flex items-center gap-1 text-vapor-200">
                              <UserIcon size={14} />
                              {item.clienteNome}
                            </span>
                            <span>•</span>
                            <span className="font-mono text-amber-400 font-semibold">
                              {item.qtdExecucao} foto(s) de execução
                            </span>
                          </div>

                          {/* Banner de vencimento */}
                          <div className="mt-1.5 flex items-center gap-2 text-xs font-mono text-amber-300 bg-amber-500/10 px-2.5 py-1 rounded border border-amber-500/20 w-fit">
                            <Calendar size={14} className="text-amber-400 shrink-0" />
                            <span>
                              Expira em <strong className="text-amber-400">{item.diasRestantes} dias</strong> ({dataFormatada})
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Botões de Ação */}
                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => handleBaixarZip(item)}
                          disabled={downloadingId === item.execucaoId}
                          className="text-xs h-9 px-3 flex items-center gap-1.5"
                        >
                          {downloadingId === item.execucaoId ? (
                            <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <Download size={14} />
                          )}
                          <span>ZIP</span>
                        </Button>

                        <Button
                          type="button"
                          variant="primary"
                          onClick={() => handlePreservarAtendimento(item.execucaoId, true)}
                          disabled={actionLoading}
                          className="text-xs h-9 px-3 flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-graphite-950 font-bold"
                        >
                          <ShieldCheck size={14} />
                          <span>Preservar</span>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
};
