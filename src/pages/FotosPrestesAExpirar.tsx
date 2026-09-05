import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { usePermissao } from '../hooks/usePermissao';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { ModalConfirmacao } from '../components/ui/ModalConfirmacao';
import {
  Archive,
  AlertTriangle,
  Download,
  ShieldCheck,
  CheckSquare,
  Square,
  ArrowLeft,
  Calendar,
  Car,
  User as UserIcon,
} from 'lucide-react';
import { downloadFotosAtendimentoZip } from '../utils/zipFotos';
import { navegarParaAtendimento } from '../utils/navegacaoAtendimento';

interface AtendimentoExpirando {
  execucaoId: string;
  agendamentoId: string;
  placa: string;
  modelo: string;
  clienteNome: string;
  totalFotos: number;
  expiradoEm: string;
  diasRestantes: number;
  preservada: boolean;
  fotos: Array<{ id: string; path: string; momento?: string }>;
}

export const FotosPrestesAExpirarPage: React.FC = () => {
  const navigate = useNavigate();
  const { tenant } = useAuth();
  const { podeGerirServicos } = usePermissao();

  const [loading, setLoading] = useState(true);
  const [atendimentos, setAtendimentos] = useState<AtendimentoExpirando[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showConfirmPreservarLote, setShowConfirmPreservarLote] = useState(false);

  const loadData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    setErrorMsg(null);

    try {
      // Data limite: fotos vencendo nos próximos 15 dias
      const dataLimiteIso = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString();

      // Busca fotos de execução pertencentes ao tenant via JOIN com execucoes
      const { data: fotosData, error: fotosErr } = await supabase
        .from('execucao_fotos')
        .select(`
          id,
          path,
          momento,
          expirado_em,
          preservada,
          execucao_id,
          execucoes!inner (
            id,
            tenant_id,
            agendamento_id,
            agendamentos (
              id,
              cliente:clientes(nome),
              veiculo:veiculos(placa, modelo)
            )
          )
        `)
        .eq('execucoes.tenant_id', tenant.id)
        .eq('preservada', false)
        .not('expirado_em', 'is', null)
        .lte('expirado_em', dataLimiteIso)
        .order('expirado_em', { ascending: true });

      if (fotosErr) throw fotosErr;

      // Agrupa fotos por execução
      const mapaExec = new Map<string, AtendimentoExpirando>();

      if (fotosData) {
        fotosData.forEach((f: any) => {
          const execId = f.execucao_id;
          const ag = f.execucoes?.agendamentos;
          const placa = ag?.veiculo?.placa || 'Sem placa';
          const modelo = ag?.veiculo?.modelo || '';
          const clienteNome = ag?.cliente?.nome || 'Cliente';
          const expIso = f.expirado_em;

          const expTime = new Date(expIso).getTime();
          const dias = Math.max(0, Math.ceil((expTime - Date.now()) / (1000 * 60 * 60 * 24)));

          if (!mapaExec.has(execId)) {
            mapaExec.set(execId, {
              execucaoId: execId,
              agendamentoId: f.execucoes?.agendamento_id,
              placa,
              modelo,
              clienteNome,
              totalFotos: 1,
              expiradoEm: expIso,
              diasRestantes: dias,
              preservada: false,
              fotos: [{ id: f.id, path: f.path, momento: f.momento }],
            });
          } else {
            const item = mapaExec.get(execId)!;
            item.totalFotos += 1;
            item.fotos.push({ id: f.id, path: f.path, momento: f.momento });
          }
        });
      }

      setAtendimentos(Array.from(mapaExec.values()));
    } catch (err: any) {
      console.error('[FotosPrestesAExpirar load error]:', err);
      setErrorMsg('Erro ao carregar lista de fotos prestes a expirar: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [tenant?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Seleção de todos os itens
  const handleToggleSelectAll = () => {
    if (selectedIds.size === atendimentos.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(atendimentos.map((a) => a.execucaoId)));
    }
  };

  // Seleção de item individual
  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Preservar item individual
  const handlePreservarAtendimento = async (execucaoId: string) => {
    setActionLoading(true);
    setErrorMsg(null);
    try {
      const { error } = await supabase.rpc('preservar_fotos_execucao', {
        p_execucao: execucaoId,
        p_preservar: true,
      });
      if (error) throw error;

      setSuccessMsg('Fotos preservadas com sucesso no acervo permanente.');
      await loadData();
    } catch (err: any) {
      console.error('[Preservar error]:', err);
      setErrorMsg('Erro ao preservar fotos: ' + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Preservar em lote os selecionados
  const handlePreservarSelecionados = () => {
    if (selectedIds.size === 0) return;
    setShowConfirmPreservarLote(true);
  };

  const executePreservarSelecionados = async () => {
    setShowConfirmPreservarLote(false);
    if (selectedIds.size === 0) return;

    setActionLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      for (const id of Array.from(selectedIds)) {
        const { error } = await supabase.rpc('preservar_fotos_execucao', {
          p_execucao: id,
          p_preservar: true,
        });
        if (error) throw error;
      }

      setSuccessMsg(`${selectedIds.size} atendimento(s) preservado(s) com sucesso!`);
      setSelectedIds(new Set());
      await loadData();
    } catch (err: any) {
      console.error('[Preservar Lote error]:', err);
      setErrorMsg('Erro ao preservar fotos em lote: ' + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Download ZIP de um atendimento
  const handleBaixarZip = async (item: AtendimentoExpirando) => {
    setDownloadingId(item.execucaoId);
    setErrorMsg(null);
    try {
      await downloadFotosAtendimentoZip(item.placa, item.execucaoId, item.fotos);
    } catch (err: any) {
      console.error('[Download ZIP Error]:', err);
      setErrorMsg('Erro ao baixar ZIP: ' + err.message);
    } finally {
      setDownloadingId(null);
    }
  };

  if (!podeGerirServicos()) {
    return (
      <div className="min-h-screen bg-graphite-950 text-vapor-100 flex items-center justify-center p-4">
        <Card className="p-6 max-w-md bg-graphite-900 border-graphite-800 text-center">
          <AlertTriangle size={36} className="text-amber-500 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-vapor-100">Acesso Restrito</h3>
          <p className="text-sm text-vapor-400 mt-2">
            Apenas Donos e Gerentes do estabelecimento possuem permissão para gerenciar a retenção e expurgo de fotos em lote.
          </p>
          <Button
            onClick={() => {
              if (window.history.state && window.history.state.idx > 0) {
                navigate(-1);
              } else {
                navigate('/hoje');
              }
            }}
            className="mt-4 w-full"
          >
            Voltar
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-graphite-950 text-vapor-100 pb-16">
      {/* CABEÇALHO DA PÁGINA */}
      <header className="bg-graphite-900 border-b border-graphite-800 sticky top-0 z-30 p-4 shadow-md">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (window.history.state && window.history.state.idx > 0) {
                  navigate(-1);
                } else {
                  navigate('/hoje');
                }
              }}
              className="p-2 rounded-lg bg-graphite-800 text-vapor-300 hover:text-vapor-100 transition-colors"
              title="Voltar para a página anterior"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-lg font-extrabold uppercase text-vapor-100 tracking-wide flex items-center gap-2">
                <Archive size={20} className="text-amber-500" />
                <span>Fotos Prestes a Expirar</span>
              </h1>
              <p className="text-[12px] text-vapor-400">
                Atendimentos com fotos de execução vencendo nos próximos 15 dias
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* CONTEÚDO PRINCIPAL */}
      <main className="max-w-4xl mx-auto w-full p-4 flex flex-col gap-4 mt-2">
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

        {/* BARRA DE AÇÕES EM LOTE */}
        {atendimentos.length > 0 && (
          <Card className="p-3.5 bg-graphite-900 border-graphite-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleToggleSelectAll}
                className="flex items-center gap-2 text-sm font-semibold text-vapor-200 hover:text-vapor-100"
              >
                {selectedIds.size === atendimentos.length ? (
                  <CheckSquare size={20} className="text-amber-500" />
                ) : (
                  <Square size={20} className="text-vapor-400" />
                )}
                <span>Selecionar todos ({atendimentos.length})</span>
              </button>

              {selectedIds.size > 0 && (
                <span className="text-xs font-mono px-2 py-1 bg-amber-500/20 text-amber-300 rounded font-bold">
                  {selectedIds.size} selecionado(s)
                </span>
              )}
            </div>

            {selectedIds.size > 0 && (
              <Button
                type="button"
                variant="primary"
                onClick={handlePreservarSelecionados}
                disabled={actionLoading}
                className="text-xs h-9 px-4 flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-graphite-950 font-bold"
              >
                {actionLoading ? (
                  <div className="w-4 h-4 border-2 border-graphite-950 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <ShieldCheck size={16} />
                )}
                <span>Preservar Selecionados no Acervo</span>
              </Button>
            )}
          </Card>
        )}

        {/* LISTAGEM DE ATENDIMENTOS */}
        {loading ? (
          <div className="flex flex-col items-center justify-center p-12 text-vapor-400 gap-3">
            <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Carregando atendimentos e fotos...</span>
          </div>
        ) : atendimentos.length === 0 ? (
          <Card className="p-10 bg-graphite-900 border-graphite-800 text-center flex flex-col items-center justify-center gap-3 text-vapor-400">
            <ShieldCheck size={44} className="text-emerald-400 opacity-80" />
            <h3 className="text-base font-bold text-vapor-200">Nenhum atendimento vencendo nos próximos 15 dias</h3>
            <p className="text-xs text-vapor-400 max-w-md">
              Todas as fotos de execução estão em dia com a política de retenção do seu plano ou preservadas no acervo permanente.
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {atendimentos.map((item) => {
              const isSelected = selectedIds.has(item.execucaoId);
              const dataFormatada = new Date(item.expiradoEm).toLocaleDateString('pt-BR');

              return (
                <Card
                  key={item.execucaoId}
                  className={`p-4 transition-all border ${
                    isSelected
                      ? 'bg-amber-500/10 border-amber-500/60'
                      : 'bg-graphite-900 border-graphite-800 hover:border-graphite-700'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    {/* INFORMAÇÕES DO ATENDIMENTO */}
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        onClick={() => handleToggleSelect(item.execucaoId)}
                        className="mt-1 text-vapor-400 hover:text-amber-500 shrink-0"
                      >
                        {isSelected ? (
                          <CheckSquare size={22} className="text-amber-500" />
                        ) : (
                          <Square size={22} />
                        )}
                      </button>

                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-extrabold text-base text-vapor-100 tracking-wider font-mono bg-graphite-800 px-2 py-0.5 rounded border border-graphite-700">
                            {item.placa.toUpperCase()}
                          </span>
                          {item.modelo && (
                            <span className="text-xs text-vapor-300 font-medium flex items-center gap-1">
                              <Car size={14} className="text-vapor-400" />
                              {item.modelo}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 text-xs text-vapor-400 mt-1">
                          <span className="flex items-center gap-1">
                            <UserIcon size={14} />
                            {item.clienteNome}
                          </span>
                          <span>•</span>
                          <span className="font-semibold text-vapor-300">
                            {item.totalFotos} foto(s) de execução
                          </span>
                        </div>

                        {/* BANNER DE PRAZO DA FOTO */}
                        <div className="mt-2 flex items-center gap-2 text-xs font-mono text-amber-300 bg-amber-500/10 px-2.5 py-1 rounded border border-amber-500/20 w-fit">
                          <Calendar size={14} className="text-amber-400 shrink-0" />
                          <span>
                            Expira em <strong className="text-amber-400">{item.diasRestantes} dias</strong> ({dataFormatada})
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* BOTÕES DE AÇÃO */}
                    <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
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
                        <span>Baixar ZIP</span>
                      </Button>

                      <Button
                        type="button"
                        variant="primary"
                        onClick={() => handlePreservarAtendimento(item.execucaoId)}
                        disabled={actionLoading}
                        className="text-xs h-9 px-3 flex items-center gap-1.5"
                      >
                        <ShieldCheck size={14} />
                        <span>Preservar</span>
                      </Button>

                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => navegarParaAtendimento(navigate, item.execucaoId, item.agendamentoId)}
                        className="text-xs h-9 px-3"
                      >
                        Ver Atendimento
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      {/* Modal de Confirmação para Preservar em Lote */}
      <ModalConfirmacao
        isOpen={showConfirmPreservarLote}
        onClose={() => setShowConfirmPreservarLote(false)}
        onConfirm={executePreservarSelecionados}
        titulo="Preservar Fotos no Acervo Permanente"
        mensagem={`Deseja preservar as fotos de ${selectedIds.size} atendimento(s) selecionado(s)? Elas passarão ao acervo permanente e deixarão de expirar automaticamente.`}
        textoConfirmar="Preservar Fotos"
        textoCancelar="Cancelar"
        variant="info"
        loading={actionLoading}
      />
    </div>
  );
};
