import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Terminal,
  Wrench,
  X,
  Clock,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import {
  type AsaasWebhookItem,
  type HistoricoMonitoramentoAsaas,
  calcularDataIsoDeslocada,
  classificarSaudeWebhookAsaas,
  formatarDataHoraPtBr,
} from '../../utils/asaasMonitor';

interface MonitorWebhookAsaasProps {
  onReconciliado?: () => void;
}

interface ResultadoReconciliacao {
  sucesso: boolean;
  saudavel?: boolean;
  mensagem?: string;
  periodo?: string;
  dry_run?: boolean;
  pagamentos_analisados?: number;
  acoes_aplicadas?: number;
  erros?: string[];
  detalhes?: Array<{
    payment_id: string;
    tenant_id: string;
    status_asaas: string;
    due_date?: string;
    value?: number;
    acao_aplicada: string;
  }>;
  log?: string[];
}

export const MonitorWebhookAsaas: React.FC<MonitorWebhookAsaasProps> = ({ onReconciliado }) => {
  const { showSuccess, showError } = useToast();

  // Estado persistido (via RPC)
  const [ultimaChecagem, setUltimaChecagem] = useState<HistoricoMonitoramentoAsaas | null>(null);
  const [historico, setHistorico] = useState<HistoricoMonitoramentoAsaas[]>([]);
  const [ultimoEvento, setUltimoEvento] = useState<{
    asaas_event_id: string;
    tipo: string;
    created_at: string;
  } | null>(null);
  const [eventos24h, setEventos24h] = useState(0);
  const [cronAtivo, setCronAtivo] = useState(false);

  // Estado ao vivo (via Edge Function asaas-reconciliar)
  const [webhooksAoVivo, setWebhooksAoVivo] = useState<AsaasWebhookItem[] | null>(null);
  const [ambienteAsaas, setAmbienteAsaas] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [reativando, setReativando] = useState(false);

  // Modal de Reconciliação
  const [modalAberto, setModalAberto] = useState(false);
  const [dataInicio, setDataInicio] = useState<string>(() => calcularDataIsoDeslocada(-15));
  const [dataFim, setDataFim] = useState<string>(() => calcularDataIsoDeslocada(0));
  const [reativarJunto, setReativarJunto] = useState(true);
  const [executandoReconciliacao, setExecutandoReconciliacao] = useState(false);
  const [resultadoReconciliacao, setResultadoReconciliacao] = useState<ResultadoReconciliacao | null>(null);

  const carregarResumoPersistido = async () => {
    try {
      const { data, error } = await supabase.rpc('admin_obter_status_monitoramento_asaas');
      if (error) {
        // Caso a migration 0188 ainda não tenha sido aplicada no ambiente, falha silenciosamente
        return;
      }
      if (data) {
        setUltimaChecagem(data.ultima_checagem || null);
        setHistorico(Array.isArray(data.historico) ? data.historico : []);
        setUltimoEvento(data.ultimo_evento || null);
        setEventos24h(Number(data.eventos_24h || 0));
        setCronAtivo(Boolean(data.cron_ativo));
      }
    } catch {
      // Não bloqueia a tela principal de assinaturas
    }
  };

  useEffect(() => {
    carregarResumoPersistido();
  }, []);

  const invocarEdgeFunction = async (payload: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('asaas-reconciliar', {
      body: payload,
    });
    if (error) {
      throw new Error(error.message || 'Erro ao comunicar com a função asaas-reconciliar.');
    }
    if (data?.error) {
      throw new Error(data.error);
    }
    return data;
  };

  const handleVerificarAgora = async () => {
    setVerificando(true);
    try {
      const data = await invocarEdgeFunction({ action: 'status' });
      setWebhooksAoVivo(Array.isArray(data?.webhooks) ? data.webhooks : []);
      setAmbienteAsaas(data?.ambiente_asaas || null);
      if (data?.ultimo_evento) {
        setUltimoEvento(data.ultimo_evento);
      }

      if (data?.saudavel) {
        showSuccess(data.mensagem || 'Webhook Asaas ativo e saudável!');
      } else {
        showError(data?.mensagem || 'Atenção: verifique o status do webhook no Asaas.');
      }
      await carregarResumoPersistido();
    } catch (err: any) {
      showError(err.message || 'Falha ao consultar saúde do webhook Asaas.');
    } finally {
      setVerificando(false);
    }
  };

  const handleReativarAgora = async (webhookId?: string) => {
    setReativando(true);
    try {
      const data = await invocarEdgeFunction({
        action: 'reativar',
        ...(webhookId ? { webhook_id: webhookId } : {}),
      });
      if (Array.isArray(data?.webhooks)) {
        setWebhooksAoVivo(data.webhooks);
      }
      if (data?.sucesso) {
        showSuccess(data.mensagem || 'Fila do webhook Asaas reativada com sucesso!');
      } else {
        showError(data?.mensagem || 'Não foi possível reativar o webhook no Asaas.');
      }
      await carregarResumoPersistido();
    } catch (err: any) {
      showError(err.message || 'Erro ao tentar reativar a fila do webhook.');
    } finally {
      setReativando(false);
    }
  };

  const handleExecutarReconciliacao = async (dryRun: boolean) => {
    setExecutandoReconciliacao(true);
    setResultadoReconciliacao(null);
    try {
      const data = await invocarEdgeFunction({
        action: 'reconciliar',
        data_inicio: dataInicio,
        data_fim: dataFim,
        reativar_webhook: reativarJunto,
        dry_run: dryRun,
      });

      setResultadoReconciliacao(data);
      if (Array.isArray(data?.webhooks)) {
        setWebhooksAoVivo(data.webhooks);
      }

      if (dryRun) {
        showSuccess(data?.mensagem || 'Simulação concluída com sucesso.');
      } else {
        showSuccess(data?.mensagem || 'Reconciliação aplicada com sucesso!');
        if (onReconciliado) onReconciliado();
      }
      await carregarResumoPersistido();
    } catch (err: any) {
      showError(err.message || 'Erro ao executar reconciliação com o Asaas.');
    } finally {
      setExecutandoReconciliacao(false);
    }
  };

  const diagnostico = classificarSaudeWebhookAsaas({
    webhooksAoVivo,
    ultimaChecagem,
  });

  const estilosBanner = {
    saudavel: {
      container: 'bg-emerald-500/5 border-emerald-500/30',
      badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      icone: <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />,
      label: 'ATIVO',
    },
    interrompido: {
      container: 'bg-rose-500/10 border-rose-500/40',
      badge: 'bg-rose-500/20 text-rose-200 border-rose-500/40 animate-pulse',
      icone: <AlertTriangle size={18} className="text-rose-400 shrink-0" />,
      label: 'INTERROMPIDO',
    },
    sem_webhook: {
      container: 'bg-amber-500/10 border-amber-500/30',
      badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
      icone: <AlertTriangle size={18} className="text-amber-400 shrink-0" />,
      label: 'SEM WEBHOOK',
    },
    desconhecido: {
      container: 'bg-graphite-800/80 border-graphite-700',
      badge: 'bg-graphite-700 text-vapor-300 border-graphite-600',
      icone: <Activity size={18} className="text-vapor-400 shrink-0" />,
      label: 'AGUARDANDO CHECK',
    },
  }[diagnostico.nivel];

  return (
    <>
      <div className={`p-4 rounded-xl border transition-all ${estilosBanner.container}`}>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5">{estilosBanner.icone}</div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-vapor-100">
                  Saúde do Webhook Asaas
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${estilosBanner.badge}`}
                >
                  {estilosBanner.label}
                </span>
                {ambienteAsaas && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono uppercase bg-graphite-900 text-vapor-400 border border-graphite-700">
                    {ambienteAsaas}
                  </span>
                )}
                {cronAtivo && (
                  <span
                    className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 flex items-center gap-1"
                    title="Rotina automática diária agendada às 03:15 (Brasília)"
                  >
                    <ShieldCheck size={11} />
                    Cron Diário Ativo
                  </span>
                )}
              </div>

              <p className="text-xs text-vapor-200 font-medium">{diagnostico.titulo}</p>
              <p className="text-[11px] text-vapor-400">{diagnostico.descricao}</p>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[11px] text-vapor-400 font-mono">
                <span className="flex items-center gap-1">
                  <Clock size={11} className="text-vapor-500" />
                  Última checagem: <strong className="text-vapor-200">{formatarDataHoraPtBr(ultimaChecagem?.created_at)}</strong>
                </span>
                <span>
                  Último evento Asaas:{' '}
                  <strong className="text-vapor-200">
                    {ultimoEvento ? `${ultimoEvento.tipo} (${formatarDataHoraPtBr(ultimoEvento.created_at)})` : 'Nenhum ainda'}
                  </strong>
                </span>
                <span>
                  Eventos 24h: <strong className="text-vapor-200">{eventos24h}</strong>
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {diagnostico.precisaReativar && (
              <button
                type="button"
                onClick={() => handleReativarAgora()}
                disabled={reativando}
                className="px-3.5 py-2 rounded-lg bg-rose-500 hover:bg-rose-400 text-white text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer shadow-lg shadow-rose-500/20"
              >
                <RotateCcw size={13} className={reativando ? 'animate-spin' : ''} />
                {reativando ? 'Reativando...' : 'Reativar Fila Agora'}
              </button>
            )}

            <button
              type="button"
              onClick={handleVerificarAgora}
              disabled={verificando}
              className="px-3 py-2 rounded-lg bg-graphite-900 hover:bg-graphite-700 text-vapor-100 border border-graphite-600 text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw size={13} className={verificando ? 'animate-spin' : ''} />
              {verificando ? 'Consultando Asaas...' : 'Verificar Agora'}
            </button>

            <button
              type="button"
              onClick={() => setModalAberto(true)}
              className="px-3 py-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Wrench size={13} />
              Reconciliar & Histórico
            </button>
          </div>
        </div>

        {/* Lista compacta de webhooks quando consultado ao vivo */}
        {webhooksAoVivo && webhooksAoVivo.length > 0 && (
          <div className="mt-3 pt-3 border-t border-graphite-700/70 grid grid-cols-1 md:grid-cols-2 gap-2">
            {webhooksAoVivo.map((wh) => {
              const pausado = wh.interrupted || !wh.enabled;
              return (
                <div
                  key={wh.id}
                  className="p-2.5 rounded-lg bg-graphite-950/70 border border-graphite-800 flex items-center justify-between gap-2 text-[11px]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${pausado ? 'bg-rose-500' : 'bg-emerald-400'}`}
                      />
                      <span className="font-semibold text-vapor-100 truncate">{wh.name || wh.id}</span>
                      <span className="text-[10px] font-mono text-vapor-400">
                        ({wh.interrupted ? 'fila pausada' : wh.enabled ? 'ativo' : 'desabilitado'})
                      </span>
                    </div>
                    <p className="text-[10px] font-mono text-vapor-400 truncate mt-0.5" title={wh.url}>
                      {wh.url}
                    </p>
                  </div>

                  {pausado && (
                    <button
                      type="button"
                      onClick={() => handleReativarAgora(wh.id)}
                      disabled={reativando}
                      className="px-2.5 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 text-[10px] font-bold shrink-0 cursor-pointer"
                    >
                      Reativar
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal de Reconciliação Manual & Histórico */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-graphite-900 border border-graphite-700 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-graphite-800">
              <div>
                <h2 className="text-base font-bold text-vapor-100 flex items-center gap-2">
                  <Wrench size={18} className="text-amber-400" />
                  Webhook Asaas & Reconciliação de Pagamentos
                </h2>
                <p className="text-xs text-vapor-400 mt-0.5">
                  Reative filas interrompidas e sincronize cobranças criadas, pagas ou vencidas direto da API do Asaas.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalAberto(false)}
                className="p-1.5 rounded-lg text-vapor-400 hover:text-vapor-100 hover:bg-graphite-800 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-5">
              {/* Formulário de período */}
              <div className="p-4 rounded-xl bg-graphite-950 border border-graphite-800 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-mono uppercase text-vapor-400">Data Início</label>
                    <input
                      type="date"
                      value={dataInicio}
                      onChange={(e) => setDataInicio(e.target.value)}
                      className="p-2.5 bg-graphite-900 border border-graphite-700 rounded-lg text-xs text-vapor-100 outline-none focus:border-amber-500 font-mono"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-mono uppercase text-vapor-400">Data Fim</label>
                    <input
                      type="date"
                      value={dataFim}
                      onChange={(e) => setDataFim(e.target.value)}
                      className="p-2.5 bg-graphite-900 border border-graphite-700 rounded-lg text-xs text-vapor-100 outline-none focus:border-amber-500 font-mono"
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 text-xs text-vapor-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={reativarJunto}
                    onChange={(e) => setReativarJunto(e.target.checked)}
                    className="rounded border-graphite-600 accent-amber-500"
                  />
                  Reativar automaticamente webhooks interrompidos (<code className="text-amber-300">interrupted: false</code>)
                </label>

                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <button
                    type="button"
                    onClick={() => handleExecutarReconciliacao(true)}
                    disabled={executandoReconciliacao}
                    className="px-4 py-2.5 rounded-lg bg-graphite-800 hover:bg-graphite-700 text-vapor-100 border border-graphite-600 text-xs font-semibold flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                  >
                    <Terminal size={14} />
                    {executandoReconciliacao ? 'Executando...' : 'Simular (Dry-Run)'}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleExecutarReconciliacao(false)}
                    disabled={executandoReconciliacao}
                    className="px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-graphite-950 text-xs font-bold flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                  >
                    <RefreshCw size={14} className={executandoReconciliacao ? 'animate-spin' : ''} />
                    {executandoReconciliacao ? 'Aplicando...' : 'Aplicar Reconciliação Agora'}
                  </button>
                </div>
              </div>

              {/* Resultado da execução atual */}
              {resultadoReconciliacao && (
                <div className="p-4 rounded-xl bg-graphite-950 border border-graphite-700 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs font-bold text-vapor-100">
                      {resultadoReconciliacao.dry_run ? 'Resultado da Simulação (sem alterações)' : 'Resultado Aplicado'}
                    </span>
                    <span className="text-[11px] font-mono text-amber-300">
                      {resultadoReconciliacao.pagamentos_analisados ?? 0} analisados •{' '}
                      {resultadoReconciliacao.acoes_aplicadas ?? 0} ações
                    </span>
                  </div>

                  {resultadoReconciliacao.mensagem && (
                    <p className="text-xs text-vapor-300">{resultadoReconciliacao.mensagem}</p>
                  )}

                  {resultadoReconciliacao.erros && resultadoReconciliacao.erros.length > 0 && (
                    <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-200 space-y-1">
                      {resultadoReconciliacao.erros.map((err, idx) => (
                        <div key={idx}>{err}</div>
                      ))}
                    </div>
                  )}

                  {resultadoReconciliacao.log && resultadoReconciliacao.log.length > 0 && (
                    <pre className="p-3 rounded-lg bg-black/50 border border-graphite-800 text-[10px] font-mono text-vapor-300 max-h-48 overflow-y-auto whitespace-pre-wrap">
                      {resultadoReconciliacao.log.join('\n')}
                    </pre>
                  )}
                </div>
              )}

              {/* Histórico recente de verificações (cron + admin) */}
              <div className="space-y-2">
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-vapor-300">
                  Últimas Verificações (Automáticas e Manuais)
                </h3>
                {historico.length === 0 ? (
                  <p className="text-xs text-vapor-400 p-3 rounded-lg bg-graphite-950 border border-graphite-800">
                    Nenhuma verificação registrada ainda. Clique em &quot;Verificar Agora&quot; ou aguarde o cron diário.
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-56 overflow-y-auto">
                    {historico.map((item) => (
                      <div
                        key={item.id}
                        className="p-2.5 rounded-lg bg-graphite-950 border border-graphite-800 flex items-start justify-between gap-3 text-[11px]"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase font-bold ${
                                item.origem === 'cron'
                                  ? 'bg-cyan-500/15 text-cyan-300'
                                  : 'bg-amber-500/15 text-amber-300'
                              }`}
                            >
                              {item.origem}
                            </span>
                            <span className="font-mono text-vapor-200 uppercase text-[10px]">{item.acao}</span>
                            <span
                              className={`text-[10px] font-bold ${
                                item.webhook_saudavel ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {item.webhook_saudavel ? 'Saudável' : `${item.webhooks_interrompidos} interrompido(s)`}
                            </span>
                          </div>
                          <p className="text-vapor-300 text-[11px]">{item.resumo_mensagem}</p>
                        </div>
                        <span className="text-[10px] font-mono text-vapor-500 shrink-0">
                          {formatarDataHoraPtBr(item.created_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
