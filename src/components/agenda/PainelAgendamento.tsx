import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { navegarParaAtendimento } from '../../utils/navegacaoAtendimento';
import { supabase } from '../../lib/supabase';
import { usePermissao } from '../../hooks/usePermissao';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { ServiceChip } from '../ui/ServiceChip';
import { 
  MessageCircle, 
  Calendar, 
  Clock, 
  User, 
  Car, 
  Ban, 
  UserX, 
  RotateCcw,
  ClipboardCheck,
  Eye,
  Play,
  Pause,
  CheckCircle2,
  Plus,
  Trash2,
  AlertTriangle,
  DollarSign,
  Printer,
  FileDown
} from 'lucide-react';
import { ModalConfirmacao } from '../ui/ModalConfirmacao';
import type { Agendamento, HorarioDisponivel } from '../../types/agenda';
import { gerarPDFOS } from '../../utils/pdfOS';
import { 
  getLabelFromStatus
} from '../../utils/agenda';
import { 
  formatarData, 
  formatarHora, 
  formatarIntervalo, 
  formatarDataIsoSP,
  montarTimestampLocal,
  parseDateInput
} from '../../utils/datas';
import { formatarMoeda, formatarOS } from '../../utils/formatters';
import { montarLinkWhatsapp } from '../../utils/whatsapp';
import { Cronometro } from '../execucao/Cronometro';
import { ModalFinalizarExecucao } from '../execucao/ModalFinalizarExecucao';
import { notificarAtualizacaoTempo } from '../../hooks/useTempoExecucao';
import { useAuth } from '../../contexts/AuthContext';
import { ModalConfirmarSemVistoria } from '../checkin/ModalConfirmarSemVistoria';
import { dispensarVistoriaAgendamento } from '../../utils/checkin';
import { obterAcaoAgendamento, type CheckinInfo, type ExecucaoInfo } from '../../utils/acaoAgendamento';

interface PainelAgendamentoProps {
  agendamento: Agendamento | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const PainelAgendamento: React.FC<PainelAgendamentoProps> = ({
  agendamento,
  isOpen,
  onClose,
  onSuccess
}) => {
  const navigate = useNavigate();
  const { tenant } = useAuth();
  const { podeGerirServicos } = usePermissao();
  const [checkinInfo, setCheckinInfo] = useState<CheckinInfo | null>(null);
  const [execucaoInfo, setExecucaoInfo] = useState<ExecucaoInfo | null>(null);
  const [startingCheckin, setStartingCheckin] = useState(false);
  const [gerandoPDFOS, setGerandoPDFOS] = useState(false);
  const [startingExec, setStartingExec] = useState(false);
  const [showModalPularVistoria, setShowModalPularVistoria] = useState(false);
  const [pularLoading, setPularLoading] = useState(false);
  const [pauseActionLoading, setPauseActionLoading] = useState(false);
  const [itensList, setItensList] = useState<any[]>([]);
  const [loadingItens, setLoadingItens] = useState(false);

  const handleConfirmarPularVistoria = async () => {
    if (!agendamento || pularLoading) return;
    setPularLoading(true);
    try {
      const execId = await dispensarVistoriaAgendamento(agendamento.id);
      onClose();
      navigate(`/execucao/${execId}`);
    } catch (err: any) {
      console.error('[Painel Pular Vistoria Error]:', err);
      setErrorMessage(err?.message || 'Erro ao dispensar vistoria.');
      setShowModalPularVistoria(false);
    } finally {
      setPularLoading(false);
    }
  };

  // Modal de finalização disparado pelo painel
  const [modalFinalizarPanelState, setModalFinalizarPanelState] = useState<{
    isOpen: boolean;
    execucaoId: string;
    agendamentoId: string;
    tenantId: string;
    placaVeiculo: string;
    servicosNomes: string[];
    pendingRequiredCount: number;
    pendingRequiredNames: string[];
    totalChecklistCount: number;
    concluidosChecklistCount: number;
    agendamentoItens: any[];
    iniciadoEm?: string;
    modoDefinirValorOnly?: boolean;
  } | null>(null);

  // Modal inline para adicionar serviço
  const [showAddServico, setShowAddServico] = useState(false);
  const [servicosDisponiveis, setServicosDisponiveis] = useState<any[]>([]);
  const [selectedAddServicoId, setSelectedAddServicoId] = useState<string>('');
  const [savingAddItem, setSavingAddItem] = useState(false);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);

  // Carrega itens, checkin e execução
  const carregarItens = async (agendamentoId: string) => {
    setLoadingItens(true);
    try {
      const { data, error } = await supabase
        .from('agendamento_itens')
        .select('*, servicos(*)')
        .eq('agendamento_id', agendamentoId)
        .order('ordem');

      if (!error && data) {
        setItensList(data);
      }
    } catch (err) {
      console.error('[PainelAgendamento] erro carregar itens:', err);
    } finally {
      setLoadingItens(false);
    }
  };

  useEffect(() => {
    if (agendamento && isOpen) {
      carregarItens(agendamento.id);

      supabase
        .from('checkins')
        .select('id, finalizado, token_aceite, enviado_em, aceite_tipo')
        .eq('agendamento_id', agendamento.id)
        .maybeSingle()
        .then(({ data }) => {
          setCheckinInfo(data ? {
            id: data.id,
            finalizado: data.finalizado,
            token_aceite: data.token_aceite,
            enviado_em: data.enviado_em,
            aceite_tipo: data.aceite_tipo
          } : null);
        });

      supabase
        .from('execucoes')
        .select('id, status, valor_total_final, iniciado_em, segundos_pausados, segundos_trabalhados, pausado_em, retomado_em, execucao_itens(id, concluido, obrigatorio, item_nome)')
        .eq('agendamento_id', agendamento.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data) {
            const itens = (data as any).execucao_itens || [];
            const pendingReq = itens.filter((i: any) => i.obrigatorio && !i.concluido);
            setExecucaoInfo({
              id: data.id,
              status: data.status,
              valor_total_final: data.valor_total_final,
              iniciado_em: data.iniciado_em,
              segundos_pausados: data.segundos_pausados || 0,
              segundos_trabalhados: data.segundos_trabalhados || 0,
              pausado_em: data.pausado_em,
              retomado_em: data.retomado_em,
              totalItens: itens.length,
              concluidosCount: itens.filter((i: any) => i.concluido).length,
              pendingRequiredCount: pendingReq.length,
              pendingRequiredNames: pendingReq.map((i: any) => i.item_nome || 'Item do checklist'),
            } as any);
          } else {
            setExecucaoInfo(null);
          }
        });
    }
  }, [agendamento, isOpen]);

  const handleIniciarServico = async () => {
    if (!agendamento || startingExec) return;
    setStartingExec(true);
    setErrorMessage(null);
    try {
      if (execucaoInfo?.id) {
        onClose();
        navigate(`/execucao/${execucaoInfo.id}`);
        return;
      }

      const { data, error } = await supabase.rpc('iniciar_execucao', {
        p_agendamento: agendamento.id
      });

      if (error) throw error;

      const execId = typeof data === 'string' ? data : (data?.execucao_id || data?.id);

      if (execId) {
        onClose();
        navigate(`/execucao/${execId}`);
      } else {
        throw new Error('Não foi possível obter o ID da execução.');
      }
    } catch (err: any) {
      console.error('[PainelAgendamento] erro ao iniciar servico:', err);
      let userMessage = 'Não foi possível iniciar o atendimento. Tente novamente.';
      const msg = err?.message || '';
      if (msg.includes('já foi finalizado')) {
        userMessage = 'Este atendimento já foi finalizado.';
      } else if (msg.includes('sem acesso')) {
        userMessage = 'Você não tem permissão para acessar esta oficina.';
      }
      setErrorMessage(userMessage);
    } finally {
      setStartingExec(false);
    }
  };

  // Carrega catálogo para adicionar serviço
  useEffect(() => {
    if (showAddServico && agendamento) {
      supabase
        .from('servicos')
        .select('*')
        .eq('tenant_id', agendamento.tenant_id)
        .eq('ativo', true)
        .order('nome')
        .then(({ data }) => {
          setServicosDisponiveis(data || []);
        });
    }
  }, [showAddServico, agendamento]);

  // Estados de Modais Secundários (Reagendar e Cancelar)
  const [showReagendar, setShowReagendar] = useState(false);
  const [reagendarData, setReagendarData] = useState('');
  const [reagendarHorarios, setReagendarHorarios] = useState<HorarioDisponivel[]>([]);
  const [loadingHorarios, setLoadingHorarios] = useState(false);
  const [selectedHorario, setSelectedHorario] = useState<string | null>(null);
  const [savingReagendar, setSavingReagendar] = useState(false);

  const [showCancelar, setShowCancelar] = useState(false);
  const [motivoCancelamento, setMotivoCancelamento] = useState('');
  const [savingCancelar, setSavingCancelar] = useState(false);

  const [showConfirmNaoCompareceu, setShowConfirmNaoCompareceu] = useState(false);
  const [savingNaoCompareceu, setSavingNaoCompareceu] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen || !agendamento) return null;

  const dataIso = agendamento.inicio;
  const dataFormatada = dataIso ? formatarData(dataIso) : '';
  const horaInicio = dataIso ? formatarHora(dataIso) : '';
  const duracaoTotal = agendamento.duracao_total || agendamento.duracao_minutos || 60;

  let intervaloFormatado = '';
  try {
    if (dataIso) {
      const inicioDate = parseDateInput(dataIso);
      const entregaDate = agendamento.previsao_entrega ? parseDateInput(agendamento.previsao_entrega) : null;

      if (entregaDate && !isNaN(entregaDate.getTime()) && !isNaN(inicioDate.getTime())) {
        const inicioStr = formatarHora(inicioDate);
        const entregaStr = formatarHora(entregaDate);
        const mesmaData = formatarData(inicioDate) === formatarData(entregaDate);

        if (mesmaData) {
          intervaloFormatado = `${inicioStr} — ${entregaStr}`;
        } else {
          intervaloFormatado = `${inicioStr} — (Entrega ${formatarData(entregaDate)} às ${entregaStr})`;
        }
      } else {
        intervaloFormatado = formatarIntervalo(dataIso, duracaoTotal);
      }
    }
  } catch (err) {
    console.error('[PainelAgendamento] erro formatar intervalo:', err);
    intervaloFormatado = dataIso ? formatarIntervalo(dataIso, duracaoTotal) : '';
  }
  
  const precoEstimadoItens = itensList.reduce((acc, item) => {
    return acc + Number(item.preco_estimado ?? 0);
  }, 0);

  const precoEstimadoCalculado = itensList.length > 0
    ? precoEstimadoItens
    : (agendamento.preco_estimado_total ?? agendamento.preco_estimado ?? 0);

  const valorCobradoCalculado = execucaoInfo?.valor_total_final 
    ?? (agendamento as any).valor_total 
    ?? (agendamento as any).valor_total_final 
    ?? null;

  const linkWhatsapp = agendamento.cliente?.telefone 
    ? montarLinkWhatsapp(
        agendamento.cliente.telefone,
        `Olá ${agendamento.cliente.nome}! Confirmamos o agendamento do seu serviço na nossa oficina para o dia ${dataFormatada} às ${horaInicio}.`
      )
    : null;

  // Gerar PDF ou Imprimir OS
  const handleGerarPDFOS = async (acao: 'download' | 'print' = 'download') => {
    if (!agendamento || !tenant) return;
    try {
      setGerandoPDFOS(true);
      const logoUrl = tenant.logo_path
        ? supabase.storage.from('catalogo').getPublicUrl(tenant.logo_path).data.publicUrl
        : undefined;

      const itensFormatados = itensList.map((it: any) => ({
        servico_nome: it.servicos?.nome || it.servico_nome || 'Serviço',
        categoria_nome: it.categoria?.nome,
        preco: Number(it.preco_estimado ?? it.preco_praticado ?? it.preco ?? 0),
        duracao_minutos: it.duracao_minutos || it.servicos?.duracao_minutos,
        quantidade: it.quantidade || 1,
      }));

      await gerarPDFOS(
        {
          numero_os: agendamento.numero_os || 1,
          data_emissao: agendamento.created_at,
          status: agendamento.status || (execucaoInfo?.status === 'finalizado' ? 'concluido' : 'agendado'),
          inicio: agendamento.inicio,
          previsao_entrega: (agendamento as any).previsao_entrega || (agendamento as any).fim,
          concluido_em: (execucaoInfo as any)?.finalizado_em,
          responsavel_nome: 'Oficina / Responsável',
          observacoes: (agendamento as any).observacoes,
          clienteNome: agendamento.cliente?.nome || 'Cliente',
          clienteTelefone: agendamento.cliente?.telefone,
          clienteDocumento: (agendamento.cliente as any)?.documento || (agendamento.cliente as any)?.cpf_cnpj,
          clienteEmail: (agendamento.cliente as any)?.email,
          veiculoModelo: agendamento.veiculo?.modelo || 'Veículo',
          veiculoPlaca: agendamento.veiculo?.placa || '',
          veiculoMarca: agendamento.veiculo?.marca,
          veiculoCor: (agendamento.veiculo as any)?.cor,
          veiculoAno: (agendamento.veiculo as any)?.ano,
          oficinaNome: tenant.nome || 'Oficina',
          oficinaRazaoSocial: tenant.razao_social,
          oficinaDocumento: tenant.documento,
          oficinaDocumentoTipo: tenant.documento_tipo,
          oficinaTelefone: tenant.telefone,
          oficinaCidadeUF: tenant.cidade && tenant.uf ? `${tenant.cidade}/${tenant.uf}` : undefined,
          oficinaLogoUrl: logoUrl,
          planoCodigo: tenant.plano,
          pdfCorPrimaria: tenant.pdf_cor_primaria,
          pdfCorFundoCabecalho: tenant.pdf_cor_fundo_cabecalho,
          pdfCorTextoCabecalho: tenant.pdf_cor_texto_cabecalho,
          pdfCorFundoSecoes: tenant.pdf_cor_fundo_secoes,
          pdfCorTextoSecoes: tenant.pdf_cor_texto_secoes || (tenant?.id ? localStorage.getItem(`tenant_pdf_cor_texto_secoes_${tenant.id}`) : null),
          pdfSubtituloCabecalho: tenant.pdf_subtitulo_cabecalho,
          pdfTextoRodape: tenant.pdf_texto_rodape,
          pdfOcultarMarcaDagua: tenant.pdf_ocultar_marca_dagua,
          itens: itensFormatados,
          valor_total: Number(precoEstimadoCalculado || 0),
          desconto: Number((agendamento as any).desconto_valor || 0),
          forma_pagamento: (agendamento as any).forma_pagamento,
          assinaturaClienteNome: agendamento.cliente?.nome,
        },
        undefined,
        acao
      );
    } catch (err: any) {
      console.error('[PainelAgendamento] Erro ao gerar PDF da OS:', err);
    } finally {
      setGerandoPDFOS(false);
    }
  };

  // Abrir e carregar lista de serviços
  const handleAbrirAddServico = async () => {
    const nextState = !showAddServico;
    setShowAddServico(nextState);
    if (nextState && servicosDisponiveis.length === 0) {
      const { data } = await supabase
        .from('servicos')
        .select('id, nome, duracao_minutos')
        .eq('ativo', true)
        .order('nome');
      if (data) setServicosDisponiveis(data);
    }
  };

  // Adicionar item via RPC
  const handleConfirmAddServico = async () => {
    if (!selectedAddServicoId) return;
    setSavingAddItem(true);
    setErrorMessage(null);
    try {
      const { error } = await supabase.rpc('adicionar_item_agendamento', {
        p_agendamento: agendamento.id,
        p_servico: selectedAddServicoId
      });

      if (error) throw error;

      setShowAddServico(false);
      setSelectedAddServicoId('');
      await carregarItens(agendamento.id);
      onSuccess();
    } catch (err: any) {
      console.error('[PainelAgendamento] erro ao adicionar item:', err);
      setErrorMessage(err.message || 'Não foi possível adicionar o serviço. Verifique a disponibilidade.');
    } finally {
      setSavingAddItem(false);
    }
  };

  // Remover item via RPC
  const handleRemoveItem = async (itemId: string) => {
    setDeletingItemId(itemId);
    setErrorMessage(null);
    try {
      const { error } = await supabase.rpc('remover_item_agendamento', {
        p_agendamento: agendamento.id,
        p_item: itemId
      });

      if (error) throw error;

      await carregarItens(agendamento.id);
      onSuccess();
    } catch (err: any) {
      console.error('[PainelAgendamento] erro ao remover item:', err);
      setErrorMessage(err.message || 'Não foi possível remover o serviço.');
    } finally {
      setDeletingItemId(null);
    }
  };

  // Busca horários para Reagendar
  const handleOpenReagendar = () => {
    setShowReagendar(true);
    setReagendarData(dataIso ? formatarDataIsoSP(dataIso) : '');
    setSelectedHorario(null);
    setErrorMessage(null);
  };

  const handleBuscarHorariosReagendamento = async (dataStr: string) => {
    setReagendarData(dataStr);
    setSelectedHorario(null);
    setLoadingHorarios(true);
    setErrorMessage(null);
    try {
      const payloadItens = itensList.map((i) => ({
        servico_id: i.servico_id,
        combo_id: i.combo_id || null
      }));

      const { data, error } = await supabase.rpc('horarios_disponiveis', {
        p_tenant: agendamento.tenant_id,
        p_data: dataStr,
        p_itens: payloadItens,
        p_categoria: agendamento.categoria_id,
        p_ignorar_agendamento: agendamento.id
      });

      if (error) throw error;
      setReagendarHorarios(data || []);
    } catch (err: any) {
      console.error('[PainelAgendamento] erro horários reagendamento:', err);
      setErrorMessage('Erro ao consultar disponibilidade.');
    } finally {
      setLoadingHorarios(false);
    }
  };

  // Salvar Reagendamento
  const handleConfirmarReagendar = async () => {
    if (!selectedHorario || !reagendarData) return;
    setSavingReagendar(true);
    setErrorMessage(null);
    try {
      const novoInicio = montarTimestampLocal(reagendarData, selectedHorario);
      const { error } = await supabase.rpc('reagendar', {
        p_agendamento: agendamento.id,
        p_novo_inicio: novoInicio
      });

      if (error) throw error;

      setShowReagendar(false);
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('[PainelAgendamento] erro reagendar:', err);
      setErrorMessage(err.message || 'Erro ao reagendar.');
    } finally {
      setSavingReagendar(false);
    }
  };

  // Salvar Cancelamento
  const handleConfirmarCancelar = async () => {
    setSavingCancelar(true);
    setErrorMessage(null);
    try {
      const { error } = await supabase.rpc('cancelar_agendamento', {
        p_agendamento: agendamento.id,
        p_motivo: motivoCancelamento.trim() || null
      });

      if (error) throw error;

      setShowCancelar(false);
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('[PainelAgendamento] erro cancelar:', err);
      setErrorMessage(err.message || 'Erro ao cancelar.');
    } finally {
      setSavingCancelar(false);
    }
  };

  // Marcar como Não Compareceu
  const handleMarcarNaoCompareceu = async () => {
    setSavingNaoCompareceu(true);
    setErrorMessage(null);
    try {
      const { error } = await supabase.rpc('marcar_nao_compareceu', {
        p_agendamento: agendamento.id
      });

      if (error) throw error;

      setShowConfirmNaoCompareceu(false);
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('[PainelAgendamento] erro não compareceu:', err);
      setErrorMessage(err.message || 'Erro ao atualizar status.');
    } finally {
      setSavingNaoCompareceu(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={formatarOS(agendamento.numero_os)}
      subtitle={`Status: ${getLabelFromStatus(agendamento.status)}`}
      icon={<Calendar size={20} className="text-amber-500" />}
      maxWidth="lg"
    >
      <div className="flex flex-col gap-5 pb-6 sm:pb-4">
        <div className="flex flex-col gap-4 font-sans text-[13px]">
          
          {/* LISTA DE SERVIÇOS DO AGENDAMENTO */}
          <div className="bg-graphite-800 p-4 rounded-lg border border-graphite-700 flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-graphite-700/60 pb-2">
              <span className="font-display text-[12px] text-vapor-300 font-bold uppercase tracking-wider">
                Serviços ({itensList.length})
              </span>
              {podeGerirServicos() && agendamento.status !== 'cancelado' && agendamento.status !== 'nao_compareceu' && (
                <button
                  type="button"
                  onClick={handleAbrirAddServico}
                  className="font-sans text-[11px] text-amber-400 hover:text-amber-300 font-medium flex items-center gap-1 transition-colors"
                >
                  <Plus size={12} />
                  Adicionar Serviço
                </button>
              )}
            </div>

            {/* ADICIONAR SERVIÇO INLINE */}
            {showAddServico && (
              <div className="p-3 bg-graphite-900 rounded border border-amber-500/30 flex flex-col gap-2">
                <span className="font-sans text-[11px] text-amber-400 font-bold">
                  Adicionar Serviço ao Agendamento
                </span>
                <select
                  value={selectedAddServicoId}
                  onChange={(e) => setSelectedAddServicoId(e.target.value)}
                  className="w-full bg-graphite-800 border border-graphite-700 rounded px-2.5 py-1.5 text-vapor-100 font-sans text-[12px] outline-none focus:border-amber-500 min-h-[40px]"
                >
                  <option value="">Selecione...</option>
                  {servicosDisponiveis.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nome} ({s.duracao_minutos} min)
                    </option>
                  ))}
                </select>
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="secondary" onClick={() => setShowAddServico(false)} className="text-[11px] py-1">
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    disabled={!selectedAddServicoId || savingAddItem}
                    onClick={handleConfirmAddServico}
                    className="text-[11px] py-1"
                  >
                    {savingAddItem ? 'Adicionando...' : 'Adicionar'}
                  </Button>
                </div>
              </div>
            )}

            {/* LISTAGEM DE ITENS */}
            {loadingItens ? (
              <span className="text-[12px] text-vapor-400 py-2">Carregando itens...</span>
            ) : itensList.length === 0 ? (
              <span className="text-[12px] text-vapor-400 py-2">Nenhum item associado.</span>
            ) : (
              <div className="flex flex-col gap-2">
                {itensList.map((item) => {
                  const serv = item.servicos;
                  return (
                    <div
                      key={item.id}
                      className="p-2.5 rounded bg-graphite-900/60 border border-graphite-700/60 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2.5">
                        <ServiceChip
                          code={serv?.codigo || 'SV'}
                          label={serv?.nome || 'Serviço'}
                          tone={serv?.tom as any || 'vapor'}
                        />
                        <span className="font-mono text-[11px] text-vapor-400">
                          {item.duracao_minutos} min
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        {item.preco_estimado !== null && item.preco_estimado !== undefined && (
                          <span className="font-mono text-[13px] font-bold text-vapor-100">
                            {formatarMoeda(Number(item.preco_estimado))}
                          </span>
                        )}
                        {podeGerirServicos() && itensList.length > 1 && agendamento.status !== 'cancelado' && agendamento.status !== 'nao_compareceu' && (
                          <button
                            type="button"
                            disabled={deletingItemId === item.id}
                            onClick={() => handleRemoveItem(item.id)}
                            className="text-vapor-500 hover:text-flare-400 p-1 rounded transition-colors"
                            title="Remover este serviço"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* TOTALIZADOR */}
            <div className="flex flex-col gap-1.5 pt-2 border-t border-graphite-700/60">
              <div className="flex items-center justify-between">
                <span className="font-sans text-[12px] text-vapor-400">Duração Total:</span>
                <span className="font-mono text-[12px] text-vapor-300">
                  {duracaoTotal && duracaoTotal > 0 ? `${duracaoTotal} min` : 'Duração não definida'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="font-sans text-[12px] text-vapor-400">Valores:</span>
                <div className="flex items-center gap-1.5 font-mono text-[13px]">
                  <span className="text-vapor-300 font-medium">
                    Estimado: {formatarMoeda(Number(precoEstimadoCalculado))}
                  </span>
                  {valorCobradoCalculado !== null && valorCobradoCalculado !== undefined && Number(valorCobradoCalculado) > 0 && (
                    <>
                      <span className="text-vapor-600">·</span>
                      <span className="font-bold text-amber-400">
                        Cobrado: {formatarMoeda(Number(valorCobradoCalculado))}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Horário & Data */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-graphite-800 p-3 rounded-lg border border-graphite-700 flex flex-col gap-1">
              <span className="font-sans text-[11px] text-vapor-400 flex items-center gap-1">
                <Calendar size={13} className="text-amber-500" /> Data
              </span>
              <span className="font-mono text-[14px] font-bold text-vapor-100">
                {dataFormatada}
              </span>
            </div>

            <div className="bg-graphite-800 p-3 rounded-lg border border-graphite-700 flex flex-col gap-1">
              <span className="font-sans text-[11px] text-vapor-400 flex items-center gap-1">
                <Clock size={13} className="text-amber-500" /> Horário Previsto
              </span>
              <span className="font-mono text-[14px] font-bold text-vapor-100">
                {intervaloFormatado}
              </span>
            </div>
          </div>

          {agendamento.previsao_entrega && (
            <div className="bg-graphite-800 p-3 rounded-lg border border-amber-500/30 flex flex-col gap-1">
              <span className="font-sans text-[11px] text-amber-400 flex items-center gap-1 font-bold">
                <Clock size={13} className="text-amber-400" /> Previsão de Entrega (Snapshot)
              </span>
              <span className="font-mono text-[13px] font-bold text-amber-300">
                {formatarData(agendamento.previsao_entrega)} às {formatarHora(agendamento.previsao_entrega)}
              </span>
            </div>
          )}

          {agendamento.transbordo_aceito_em && (
            <div className="p-3 bg-amber-500/10 rounded-lg border border-amber-500/30 flex items-start gap-2 text-amber-300">
              <CheckCircle2 size={16} className="text-amber-400 shrink-0 mt-0.5" />
              <div className="flex flex-col text-[12px] gap-0.5 min-w-0 flex-1">
                <span className="font-bold text-amber-400">Consentimento de Pernoite Auditado</span>
                <span className="leading-snug">Pernoite aceito pelo cliente em <strong className="font-mono text-amber-200">{formatarData(agendamento.transbordo_aceito_em)} às {formatarHora(agendamento.transbordo_aceito_em)}</strong></span>
                {agendamento.transbordo_aceite_user_agent && (
                  <span className="font-mono text-[10px] text-amber-400/70 break-all leading-tight mt-0.5" title={agendamento.transbordo_aceite_user_agent}>
                    Navegador: {agendamento.transbordo_aceite_user_agent}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Cliente e Veículo */}
          <div className="bg-graphite-800 p-3.5 rounded-lg border border-graphite-700 flex flex-col gap-2">
            <div className="flex items-center justify-between border-b border-graphite-700/60 pb-2">
              <span className="text-vapor-400 flex items-center gap-1.5">
                <User size={14} className="text-amber-500" /> Cliente:
              </span>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-vapor-100">
                  {agendamento.cliente?.nome || 'Não informado'}
                </span>
                {linkWhatsapp && (
                  <a
                    href={linkWhatsapp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 rounded bg-mint-500/10 hover:bg-mint-500/20 text-mint-400 border border-mint-500/30"
                    title="Falar no WhatsApp"
                  >
                    <MessageCircle size={14} />
                  </a>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-vapor-400 flex items-center gap-1.5">
                <Car size={14} className="text-amber-500" /> Veículo / Categoria:
              </span>
              <span className="font-mono text-vapor-100">
                {agendamento.veiculo ? `${agendamento.veiculo.placa} (${agendamento.veiculo.modelo || ''}${agendamento.veiculo.cor ? ` • ${agendamento.veiculo.cor}` : ''})` : 'Sem veículo'} • {agendamento.categoria?.nome || 'Categoria'}
              </span>
            </div>
          </div>

          {/* BOTÕES DE IMPRIMIR / GERAR PDF DA OS */}
          <div className="flex items-center gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              onClick={() => handleGerarPDFOS('print')}
              disabled={gerandoPDFOS}
              className="flex-1 h-9 text-xs font-bold flex items-center justify-center gap-1.5 bg-graphite-800 hover:bg-graphite-700 text-vapor-200 border-graphite-700"
            >
              <Printer size={14} className="text-amber-400" />
              <span>Imprimir OS</span>
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => handleGerarPDFOS('download')}
              disabled={gerandoPDFOS}
              className="flex-1 h-9 text-xs font-bold flex items-center justify-center gap-1.5 bg-graphite-800 hover:bg-graphite-700 text-vapor-200 border-graphite-700"
            >
              <FileDown size={14} className="text-cyan-400" />
              <span>{gerandoPDFOS ? 'Gerando...' : 'PDF da OS'}</span>
            </Button>
          </div>

          {agendamento.observacoes && (
            <div className="p-3 bg-graphite-800/80 rounded border border-graphite-700 flex flex-col gap-1">
              <span className="font-sans text-[11px] text-vapor-400 font-medium">Observações:</span>
              <p className="font-sans text-[12px] text-vapor-300 leading-relaxed">
                {agendamento.observacoes}
              </p>
            </div>
          )}

          {errorMessage && (
            <div className="p-3 bg-flare-500/10 border border-flare-500/30 rounded text-flare-400 font-sans text-[12px] flex items-center gap-2">
              <AlertTriangle size={16} className="shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        {/* Modal Inline: Reagendar */}
        {showReagendar && (
          <div className="p-4 bg-graphite-800 rounded-lg border border-amber-500/40 flex flex-col gap-3">
            <span className="font-display text-[13px] text-amber-400 font-bold uppercase tracking-wider">
              Reagendar Agendamento
            </span>
            <div className="flex flex-col gap-1.5">
              <label className="font-mono text-[11px] text-vapor-400">Nova Data</label>
              <input
                type="date"
                value={reagendarData}
                onChange={(e) => handleBuscarHorariosReagendamento(e.target.value)}
                className="bg-graphite-900 border border-graphite-700 rounded px-3 py-2 font-mono text-[13px] text-vapor-100 outline-none focus:border-amber-500 min-h-[44px]"
              />
            </div>

            {loadingHorarios ? (
              <span className="text-[12px] text-vapor-400 text-center py-2">Consultando horários livres...</span>
            ) : (
              <div className="grid grid-cols-3 gap-2 max-h-36 overflow-y-auto">
                {reagendarHorarios.map((slot) => {
                  const isSelected = selectedHorario === slot.horario;
                  const horaFormatada = slot.horario.substring(0, 5);
                  if (!slot.disponivel) {
                    return (
                      <div key={slot.horario} className="p-1.5 rounded border border-graphite-800 bg-graphite-950/60 opacity-50 text-center cursor-not-allowed">
                        <span className="font-mono text-[11px] text-vapor-500 line-through">
                          {horaFormatada}
                        </span>
                      </div>
                    );
                  }
                  return (
                    <button
                      key={slot.horario}
                      type="button"
                      onClick={() => setSelectedHorario(slot.horario)}
                      className={`p-2 rounded border font-mono text-[12px] transition-colors min-h-[40px] ${
                        isSelected
                          ? 'bg-amber-500 text-graphite-950 font-bold border-amber-400'
                          : 'bg-graphite-900 hover:bg-graphite-700 border-graphite-700 text-vapor-100'
                      }`}
                    >
                      {horaFormatada}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-graphite-700">
              <Button type="button" variant="secondary" onClick={() => setShowReagendar(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={!selectedHorario || savingReagendar}
                onClick={handleConfirmarReagendar}
              >
                {savingReagendar ? 'Salvando...' : 'Confirmar Novo Horário'}
              </Button>
            </div>
          </div>
        )}

        {/* Modal Inline: Cancelar */}
        {showCancelar && (
          <div className="p-4 bg-graphite-800 rounded-lg border border-flare-500/40 flex flex-col gap-3">
            <span className="font-display text-[13px] text-flare-400 font-bold uppercase tracking-wider">
              Cancelar Agendamento
            </span>
            <textarea
              rows={2}
              placeholder="Informe o motivo do cancelamento (opcional)..."
              value={motivoCancelamento}
              onChange={(e) => setMotivoCancelamento(e.target.value)}
              className="bg-graphite-900 border border-graphite-700 rounded p-2.5 text-vapor-100 font-sans text-[12px] outline-none focus:border-flare-500"
            />
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setShowCancelar(false)}>
                Voltar
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={savingCancelar}
                onClick={handleConfirmarCancelar}
                className="bg-flare-500/20 text-flare-400 border border-flare-500/40 hover:bg-flare-500/30"
              >
                {savingCancelar ? 'Cancelando...' : 'Confirmar Cancelamento'}
              </Button>
            </div>
          </div>
        )}

        {/* Ações do Agendamento */}
        {!showReagendar && !showCancelar && (() => {
          const acao = obterAcaoAgendamento({
            agendamento,
            checkinInfo,
            execucaoInfo,
            podeVerValor: podeGerirServicos(),
          });

          if (acao.tipo === 'nenhuma') return null;

          return (
            <div className="pt-2 flex flex-col gap-3">
              {/* CRONÔMETRO SE EM EXECUÇÃO */}
              {execucaoInfo?.iniciado_em && execucaoInfo.status !== 'finalizado' && (
                <div className="bg-graphite-950/80 p-3.5 rounded-lg border border-graphite-800 flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase font-semibold text-vapor-400 tracking-wider">
                      {execucaoInfo.status === 'pausado' ? 'TEMPO PAUSADO' : 'TEMPO EM EXECUÇÃO'}
                    </span>
                    <Cronometro
                      execucaoId={execucaoInfo.id}
                      status={execucaoInfo.status}
                      iniciadoEm={execucaoInfo.iniciado_em}
                      tamanho="medio"
                    />
                  </div>
                  {Boolean(execucaoInfo.totalItens && execucaoInfo.totalItens > 0) && (
                    <span className="text-[12px] font-mono font-semibold text-amber-500">
                      {execucaoInfo.concluidosCount || 0} / {execucaoInfo.totalItens} itens
                    </span>
                  )}
                </div>
              )}

              {/* BOTÕES DE AÇÃO PRINCIPAIS */}
              {acao.tipo === 'fazer_vistoria' || acao.tipo === 'continuar_vistoria' ? (
                <div className="flex flex-col gap-2 w-full">
                  <Button
                    type="button"
                    variant="primary"
                    disabled={startingCheckin}
                    onClick={() => {
                      if (startingCheckin) return;
                      setStartingCheckin(true);
                      onClose();
                      navigate(`/checkin/${agendamento.id}`);
                    }}
                    className="w-full min-h-[50px] font-bold flex items-center justify-center gap-2 shadow-md"
                  >
                    <ClipboardCheck size={18} />
                    <span>{startingCheckin ? 'Carregando vistoria...' : acao.label}</span>
                  </Button>

                  {!tenant?.vistoria_obrigatoria && !checkinInfo?.finalizado && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setShowModalPularVistoria(true)}
                      className="w-full min-h-[44px] text-xs font-medium text-vapor-400 hover:text-vapor-200 border border-graphite-700 hover:bg-graphite-800 flex items-center justify-center gap-1.5"
                    >
                      <span>Iniciar sem vistoria</span>
                    </Button>
                  )}
                </div>
              ) : acao.tipo === 'iniciar_servico' ? (
                <div className="flex flex-col gap-2 w-full">
                  {agendamento.vistoria_dispensada && !checkinInfo?.finalizado && (
                    <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-300 text-xs flex items-center justify-between gap-2">
                      <span className="font-sans">Atendimento sem vistoria de entrada registrada.</span>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          navigate(`/checkin/${agendamento.id}`);
                        }}
                        className="text-amber-400 hover:text-amber-300 font-bold underline shrink-0"
                      >
                        Fazer agora
                      </button>
                    </div>
                  )}

                  <Button
                    type="button"
                    variant="primary"
                    disabled={startingExec}
                    onClick={handleIniciarServico}
                    className="w-full min-h-[50px] font-bold flex items-center justify-center gap-2 shadow-md"
                  >
                    {startingExec ? (
                      <>
                        <div className="w-4 h-4 border-2 border-graphite-950 border-t-transparent rounded-full animate-spin" />
                        <span>Iniciando...</span>
                      </>
                    ) : (
                      <>
                        <Play size={18} className="fill-current" />
                        <span>{acao.label}</span>
                      </>
                    )}
                  </Button>
                </div>
              ) : acao.tipo === 'continuar_servico' ? (
                <div className="flex flex-col gap-2.5 w-full">
                  {/* 1. FINALIZAR (Ação primária - Amber, 48px) */}
                  <button
                    type="button"
                    onClick={async () => {
                      if (!execucaoInfo?.id) return;
                      if (execucaoInfo.status === 'em_andamento') {
                        await supabase.rpc('pausar_execucao', { p_execucao: execucaoInfo.id });
                        notificarAtualizacaoTempo(execucaoInfo.id);
                      }

                      const servicosNomes = itensList.map((i: any) => i.servicos?.nome || i.servico_nome || 'Serviço');
                      setModalFinalizarPanelState({
                        isOpen: true,
                        execucaoId: execucaoInfo.id,
                        agendamentoId: agendamento.id,
                        tenantId: agendamento.tenant_id,
                        placaVeiculo: agendamento.veiculo?.placa || 'Sem Veículo',
                        servicosNomes,
                        pendingRequiredCount: (execucaoInfo as any).pendingRequiredCount || 0,
                        pendingRequiredNames: (execucaoInfo as any).pendingRequiredNames || [],
                        totalChecklistCount: execucaoInfo.totalItens || 0,
                        concluidosChecklistCount: execucaoInfo.concluidosCount || 0,
                        agendamentoItens: itensList,
                        iniciadoEm: execucaoInfo.iniciado_em,
                      });
                    }}
                    className="w-full min-h-[48px] h-[48px] rounded-lg bg-amber-500 hover:bg-amber-400 text-graphite-950 font-extrabold font-sans text-[14px] transition-colors flex items-center justify-center gap-2 shadow-md shrink-0 cursor-pointer"
                  >
                    <CheckCircle2 size={18} />
                    <span>Finalizar Atendimento</span>
                  </button>

                  <div className="flex items-center gap-2 w-full">
                    {/* 2. PAUSAR / RETOMAR (Ação secundária - 48px) */}
                    <button
                      type="button"
                      onClick={async () => {
                        if (!execucaoInfo?.id || pauseActionLoading) return;
                        setPauseActionLoading(true);
                        try {
                          if (execucaoInfo.status === 'pausado') {
                            await supabase.rpc('retomar_execucao', { p_execucao: execucaoInfo.id });
                          } else {
                            await supabase.rpc('pausar_execucao', { p_execucao: execucaoInfo.id });
                          }
                          notificarAtualizacaoTempo(execucaoInfo.id);
                          onSuccess();
                          onClose();
                        } catch (err) {
                          console.error('[Painel Pause Error]:', err);
                        } finally {
                          setPauseActionLoading(false);
                        }
                      }}
                      disabled={pauseActionLoading}
                      className={`flex-1 min-h-[48px] h-[48px] rounded-lg font-bold font-sans text-[13px] transition-colors flex items-center justify-center gap-1.5 ${
                        execucaoInfo?.status === 'pausado'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 hover:bg-amber-500/30'
                          : 'bg-graphite-800 hover:bg-graphite-700 text-vapor-100 border border-graphite-700'
                      }`}
                    >
                      {pauseActionLoading ? (
                        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      ) : execucaoInfo?.status === 'pausado' ? (
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

                    {/* 3. ABRIR ATENDIMENTO (Ação terciária - 48px) */}
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        if (execucaoInfo?.id) {
                          navigate(`/execucao/${execucaoInfo.id}`);
                        }
                      }}
                      className="flex-1 min-h-[48px] h-[48px] rounded-lg bg-graphite-900 hover:bg-graphite-800 text-vapor-300 border border-graphite-700 font-medium font-sans text-[13px] transition-colors flex items-center justify-center gap-1.5"
                    >
                      <span>Abrir atendimento</span>
                    </button>
                  </div>
                </div>
              ) : acao.tipo === 'definir_valor' ? (
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => {
                    if (!execucaoInfo?.id) return;
                    const servicosNomes = itensList.map((i: any) => i.servicos?.nome || i.servico_nome || 'Serviço');
                    setModalFinalizarPanelState({
                      isOpen: true,
                      execucaoId: execucaoInfo.id,
                      agendamentoId: agendamento.id,
                      tenantId: agendamento.tenant_id,
                      placaVeiculo: agendamento.veiculo?.placa || 'Sem Veículo',
                      servicosNomes,
                      pendingRequiredCount: 0,
                      pendingRequiredNames: [],
                      totalChecklistCount: execucaoInfo.totalItens || 0,
                      concluidosChecklistCount: execucaoInfo.concluidosCount || 0,
                      agendamentoItens: itensList,
                      iniciadoEm: execucaoInfo.iniciado_em,
                      modoDefinirValorOnly: true,
                    });
                  }}
                  className="w-full min-h-[50px] font-bold flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-graphite-950"
                >
                  <DollarSign size={18} />
                  <span>Definir valor final</span>
                </Button>
              ) : acao.tipo === 'ver_atendimento' ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    onClose();
                    navegarParaAtendimento(navigate, execucaoInfo?.id, agendamento.id);
                  }}
                  className="w-full min-h-[50px] font-bold flex items-center justify-center gap-2"
                >
                  <Eye size={18} />
                  <span>Ver atendimento</span>
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    onClose();
                    if (checkinInfo?.id) {
                      navigate(`/checkin/${checkinInfo.id}/ver`);
                    } else if (execucaoInfo?.id) {
                      navigate(`/execucao/${execucaoInfo.id}`);
                    }
                  }}
                  className="w-full min-h-[50px] font-bold flex items-center justify-center gap-2"
                >
                  <Eye size={18} />
                  <span>{acao.label}</span>
                </Button>
              )}
            </div>
          );
        })()}

        {/* Ações Administrativas - Ocultar estritamente para agendamentos concluídos/cancelados */}
        {podeGerirServicos() && !showReagendar && !showCancelar && (agendamento.status === 'agendado' || agendamento.status === 'confirmado') && (
          <div className="pt-4 border-t border-graphite-800 flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={handleOpenReagendar}
              className="flex items-center gap-1 text-[12px]"
            >
              <RotateCcw size={14} />
              <span>Reagendar</span>
            </Button>

            <Button
              type="button"
              variant="secondary"
              disabled={savingNaoCompareceu}
              onClick={() => setShowConfirmNaoCompareceu(true)}
              className="flex items-center gap-1 text-[12px] text-amber-400 hover:text-amber-300"
            >
              <UserX size={14} />
              <span>Não Compareceu</span>
            </Button>

            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowCancelar(true)}
              className="flex items-center gap-1 text-[12px] bg-flare-500/10 text-flare-400 border border-flare-500/30 hover:bg-flare-500/20"
            >
              <Ban size={14} />
              <span>Cancelar</span>
            </Button>
          </div>
        )}

        <ModalConfirmacao
          isOpen={showConfirmNaoCompareceu}
          onClose={() => setShowConfirmNaoCompareceu(false)}
          onConfirm={handleMarcarNaoCompareceu}
          title="Marcar Não Compareceu"
          mensagem="Deseja marcar este agendamento como 'Não Compareceu'? O horário ficará livre para novos agendamentos."
          textoConfirmar="Confirmar Ausência"
          textoCancelar="Voltar"
          variant="warning"
          loading={savingNaoCompareceu}
        />

        {modalFinalizarPanelState && (
          <ModalFinalizarExecucao
            isOpen={modalFinalizarPanelState.isOpen}
            onClose={() => {
              setModalFinalizarPanelState(null);
              onSuccess();
            }}
            execucaoId={modalFinalizarPanelState.execucaoId}
            agendamentoId={modalFinalizarPanelState.agendamentoId}
            tenantId={modalFinalizarPanelState.tenantId}
            placaVeiculo={modalFinalizarPanelState.placaVeiculo}
            tempoFormatado="00:00:00"
            pendingRequiredCount={modalFinalizarPanelState.pendingRequiredCount}
            pendingRequiredNames={modalFinalizarPanelState.pendingRequiredNames}
            agendamentoItens={modalFinalizarPanelState.agendamentoItens}
            servicosNomes={modalFinalizarPanelState.servicosNomes}
            totalChecklistCount={modalFinalizarPanelState.totalChecklistCount}
            concluidosChecklistCount={modalFinalizarPanelState.concluidosChecklistCount}
            fotosSaidaExistentes={[]}
            iniciadoEm={modalFinalizarPanelState.iniciadoEm}
            modoDefinirValorOnly={modalFinalizarPanelState.modoDefinirValorOnly}
            onSuccess={() => {
              setModalFinalizarPanelState(null);
              onSuccess();
              onClose();
            }}
          />
        )}

        <ModalConfirmarSemVistoria
          isOpen={showModalPularVistoria}
          onClose={() => setShowModalPularVistoria(false)}
          onConfirm={handleConfirmarPularVistoria}
          loading={pularLoading}
        />
      </div>
    </Modal>
  );
};
