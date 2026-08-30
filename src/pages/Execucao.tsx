import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { navegarParaAtendimento } from '../utils/navegacaoAtendimento';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import {
  Play,
  Pause,
  CheckSquare,
  Square,
  Camera,
  Users,
  CheckCircle,
  ArrowLeft,
  AlertCircle,
  AlertTriangle,
  Plus,
  Trash2,
  Settings,
  Eye,
  Download,
  ShieldCheck,
  Archive,
} from 'lucide-react';
import { usePermissao } from '../hooks/usePermissao';
import { ModalFinalizarExecucao } from '../components/execucao/ModalFinalizarExecucao';
import { Cronometro } from '../components/execucao/Cronometro';
import { useTempoExecucao, obterEstadoDerivadoCronometro, notificarAtualizacaoTempo } from '../hooks/useTempoExecucao';
import { uploadExecucaoFoto, getEvidenciaSignedUrl } from '../utils/evidencias';
import { downloadFotosAtendimentoZip } from '../utils/zipFotos';
import type { Execucao, ExecucaoItem, ExecucaoFoto, ExecucaoExecutor } from '../types/execucao';

interface MembroEquipeExecucao {
  member_id: string;
  rotulo: string;
  email: string;
  papel: string;
  status: string;
  ja_executor: boolean;
}

export const ExecucaoPage: React.FC = () => {
  const { id: execucaoId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { tenant, user } = useAuth();
  const { podeGerirServicos } = usePermissao();

  const [execucao, setExecucao] = useState<Execucao | null>(null);
  const [agendamento, setAgendamento] = useState<any>(null);
  const [itens, setItens] = useState<ExecucaoItem[]>([]);
  const [fotos, setFotos] = useState<ExecucaoFoto[]>([]);
  const [executores, setExecutores] = useState<ExecucaoExecutor[]>([]);
  const [membrosTenant, setMembrosTenant] = useState<MembroEquipeExecucao[]>([]);
  const [teamLoadError, setTeamLoadError] = useState<string | null>(null);
  const [actionExecutorLoading, setActionExecutorLoading] = useState(false);

  const [loading, setLoading] = useState(true);
  const [pauseActionLoading, setPauseActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [modalFinalizarOpen, setModalFinalizarOpen] = useState(false);
  const [uploadingFoto, setUploadingFoto] = useState(false);
  const [showAddExecutor, setShowAddExecutor] = useState(false);

  // Estados para inclusão e remoção de etapas avulsas
  const [novoItemText, setNovoItemText] = useState<Record<string, string>>({});
  const [showAddForm, setShowAddForm] = useState<Record<string, boolean>>({});
  const [addingItemLoading, setAddingItemLoading] = useState(false);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  // Carrega os dados da execução com retry de até 3 tentativas (300ms de intervalo)
  const loadExecucaoData = useCallback(async () => {
    if (!execucaoId) return;

    setLoading(true);
    setErrorMsg(null);

    try {
      // 1. Execução com retry (3 tentativas)
      let execData: Execucao | null = null;
      let execErr: any = null;
      const maxAttempts = 3;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const { data, error } = await supabase
          .from('execucoes')
          .select('*')
          .eq('id', execucaoId)
          .single();

        if (!error && data) {
          execData = data;
          break;
        }

        execErr = error;
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }

      if (!execData) {
        throw execErr || new Error('Não foi possível encontrar a execução.');
      }
      setExecucao(execData);

      // 2. Agendamento + Veículo + Cliente
      const { data: agData } = await supabase
        .from('agendamentos')
        .select('*, veiculo:veiculos(*), cliente:clientes(*), itens:agendamento_itens(*, servicos(id, nome))')
        .eq('id', execData.agendamento_id)
        .maybeSingle();
      setAgendamento(agData);

      // 3. Itens do checklist
      const { data: itensData } = await supabase
        .from('execucao_itens')
        .select('*')
        .eq('execucao_id', execucaoId)
        .order('ordem', { ascending: true })
        .order('created_at', { ascending: true });
      setItens(itensData || []);

      // 4. Fotos
      const { data: fotosData } = await supabase
        .from('execucao_fotos')
        .select('*')
        .eq('execucao_id', execucaoId)
        .order('created_at', { ascending: true });

      if (fotosData) {
        const fotosComUrl = await Promise.all(
          fotosData.map(async (foto) => {
            const signedUrl = await getEvidenciaSignedUrl(foto.path);
            return { ...foto, signedUrl };
          })
        );
        setFotos(fotosComUrl);
      }

      // 5. Executores
      const { data: execsData } = await supabase
        .from('execucao_executores')
        .select('*, member:tenant_members(*)')
        .eq('execucao_id', execucaoId);
      setExecutores(execsData || []);

      // 6. Membros da oficina (via RPC sem embed)
      const { data: mems, error: memsErr } = await supabase.rpc('listar_membros_execucao', {
        p_execucao_id: execucaoId,
      });

      if (memsErr) {
        console.error('[listar_membros_execucao error]:', memsErr);
        setTeamLoadError('Não foi possível carregar a equipe. Tente de novo.');
      } else {
        setTeamLoadError(null);
        setMembrosTenant(mems || []);
      }
    } catch (err: any) {
      console.error('[Execucao load error]:', err);
      setErrorMsg('Não foi possível abrir o atendimento. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }, [execucaoId]);

  useEffect(() => {
    loadExecucaoData();
  }, [loadExecucaoData]);

  const tempoHook = useTempoExecucao(execucaoId || null);

  const estadoDerivado = execucao
    ? obterEstadoDerivadoCronometro({
        statusExecucao: execucao.status,
      })
    : 'rodando';

  // Alternar Pausa / Retomada (Guarda de estado contra duplo clique)
  const handleTogglePausa = async () => {
    if (!execucao || pauseActionLoading) return;
    setPauseActionLoading(true);

    const eraPausado = estadoDerivado === 'pausado_manual' || estadoDerivado === 'pausado_auto';

    // Atualização otimista local imediata
    if (eraPausado) {
      tempoHook.retomarOtimista();
    } else {
      tempoHook.pausarOtimista();
    }

    try {
      if (eraPausado) {
        const { error } = await supabase.rpc('retomar_execucao', { p_execucao: execucao.id });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc('pausar_execucao', { p_execucao: execucao.id });
        if (error) throw error;
      }
      notificarAtualizacaoTempo(execucao.id);
      await tempoHook.recarregar();
      await loadExecucaoData();
    } catch (err: any) {
      console.error('[Pausa/Retomada Error]:', err);
      setErrorMsg(err?.message || 'Erro ao alterar pausa da execução.');
      await tempoHook.recarregar();
    } finally {
      setPauseActionLoading(false);
    }
  };

  // Marcar/Desmarcar item do checklist com feedback otimista
  const handleToggleItem = async (itemId: string, novoConcluido: boolean) => {
    if (execucao?.status === 'finalizado') {
      setErrorMsg('Não é possível alterar itens de checklist de uma execução finalizada.');
      return;
    }

    // Feedback Otimista imediato na UI
    setItens((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, concluido: novoConcluido } : item))
    );

    try {
      const { error } = await supabase.rpc('marcar_item', {
        p_item: itemId,
        p_concluido: novoConcluido,
      });

      if (error) {
        // Em caso de falha, reverte otimista
        setItens((prev) =>
          prev.map((item) => (item.id === itemId ? { ...item, concluido: !novoConcluido } : item))
        );
        setErrorMsg('Falha na sincronização de rede ao marcar item. Tente novamente.');
      }
    } catch (err) {
      setItens((prev) =>
        prev.map((item) => (item.id === itemId ? { ...item, concluido: !novoConcluido } : item))
      );
      setErrorMsg('Falha ao conectar com o servidor.');
    }
  };

  // Adicionar item avulso na execução
  const handleAdicionarItemAvulso = async (agendamentoItemId: string, servicoNome: string) => {
    if (execucao?.status === 'finalizado') {
      setErrorMsg('Não é possível adicionar etapas a uma execução finalizada.');
      return;
    }

    const key = agendamentoItemId || servicoNome;
    const text = (novoItemText[key] || '').trim();
    if (!text) return;

    setAddingItemLoading(true);
    setErrorMsg(null);

    try {
      const { error } = await supabase.rpc('adicionar_item_execucao', {
        p_execucao: execucaoId,
        p_agendamento_item: agendamentoItemId || null,
        p_descricao: text,
      });

      if (error) throw error;

      setNovoItemText((prev) => ({ ...prev, [key]: '' }));
      setShowAddForm((prev) => ({ ...prev, [key]: false }));
      setNoticeMsg('Etapa adicionada apenas neste atendimento.');
      setTimeout(() => setNoticeMsg(null), 4000);

      await loadExecucaoData();
    } catch (err: any) {
      console.error('[adicionar_item_execucao error]:', err);
      setErrorMsg(err?.message || 'Erro ao adicionar etapa.');
    } finally {
      setAddingItemLoading(false);
    }
  };

  // Remover item avulso da execução
  const handleRemoverItemAvulso = async (itemId: string) => {
    if (execucao?.status === 'finalizado') {
      setErrorMsg('Não é possível remover etapas de uma execução finalizada.');
      return;
    }

    try {
      const { error } = await supabase.rpc('remover_item_execucao', {
        p_item_id: itemId,
      });

      if (error) throw error;

      await loadExecucaoData();
    } catch (err: any) {
      console.error('[remover_item_execucao error]:', err);
      setErrorMsg(err?.message || 'Erro ao remover etapa.');
    }
  };

  // Abrir modal de finalização pausando o cronômetro se estiver rodando
  const handleAbrirModalFinalizar = async () => {
    if (!execucao) return;

    try {
      if (execucao.status === 'em_andamento') {
        const { error } = await supabase.rpc('pausar_execucao', { p_execucao: execucao.id });
        if (error) throw error;
        setExecucao((prev) => (prev ? { ...prev, status: 'pausado', contando_desde: null } : null));
        notificarAtualizacaoTempo(execucao.id);
      }

      setModalFinalizarOpen(true);
    } catch (err: any) {
      console.error('[Abrir Modal Finalizar Error]:', err);
      setErrorMsg(err?.message || 'Erro ao pausar cronômetro para finalização.');
    }
  };

  const [uploadProgressText, setUploadProgressText] = useState<string>('');
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [preservarLoading, setPreservarLoading] = useState(false);

  // Upload de foto durante o serviço (múltiplos arquivos com processamento sequencial)
  const handleUploadFotoDurante = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0 || !user || !tenant || !execucaoId) return;
    const files = Array.from(e.target.files);
    setUploadingFoto(true);
    setErrorMsg(null);

    const placa = agendamento?.veiculo?.placa || '';

    try {
      for (let idx = 0; idx < files.length; idx++) {
        const file = files[idx];
        setUploadProgressText(`Processando foto ${idx + 1} de ${files.length}...`);

        const { path, capturadaEm } = await uploadExecucaoFoto(tenant.id, execucaoId, file, placa);

        const { data: fotoData, error: dbErr } = await supabase
          .from('execucao_fotos')
          .insert({
            execucao_id: execucaoId,
            path,
            momento: 'durante',
            enviado_por: user.id,
            capturada_em: capturadaEm,
          })
          .select('*')
          .single();

        if (dbErr) throw dbErr;

        const signedUrl = await getEvidenciaSignedUrl(path);
        setFotos((prev) => [...prev, { ...fotoData, signedUrl }]);
      }
    } catch (err: any) {
      console.error('[Upload foto durante Error]:', err);
      setErrorMsg(err?.message || 'Erro ao enviar foto(s).');
    } finally {
      setUploadingFoto(false);
      setUploadProgressText('');
    }
  };

  // Baixar todas as fotos em ZIP
  const handleBaixarTodasZip = async () => {
    if (!fotos || fotos.length === 0 || !execucaoId) return;
    setDownloadingZip(true);
    setErrorMsg(null);
    try {
      const placa = agendamento?.veiculo?.placa || 'veiculo';
      await downloadFotosAtendimentoZip(placa, execucaoId, fotos as any);
    } catch (err: any) {
      console.error('[Download ZIP Error]:', err);
      setErrorMsg('Erro ao gerar arquivo ZIP das fotos: ' + err.message);
    } finally {
      setDownloadingZip(false);
    }
  };

  // Preservar / Despreservar Fotos do Atendimento (Apenas Dono / Gerente)
  const handleTogglePreservarFotos = async (preservarAtual: boolean) => {
    if (!execucaoId) return;
    const confirmMsg = preservarAtual
      ? 'Deseja remover a preservação das fotos deste atendimento? Elas voltarão a contar o prazo de expurgo normal do seu plano.'
      : 'Deseja preservar as fotos deste atendimento? Elas deixarão de contar prazo de expurgo e passarão a ocupar espaço no acervo permanentemente.';

    if (!window.confirm(confirmMsg)) return;

    setPreservarLoading(true);
    setErrorMsg(null);

    try {
      const { error } = await supabase.rpc('preservar_fotos_execucao', {
        p_execucao: execucaoId,
        p_preservar: !preservarAtual,
      });

      if (error) throw error;
      await loadExecucaoData();
    } catch (err: any) {
      console.error('[Preservar fotos error]:', err);
      setErrorMsg(err?.message || 'Erro ao alterar preservação das fotos.');
    }
  };

  // Adicionar Co-Executor
  const handleAddExecutor = async (memberId: string) => {
    if (!execucaoId || actionExecutorLoading) return;
    setActionExecutorLoading(true);
    setErrorMsg(null);
    try {
      const { error } = await supabase.rpc('adicionar_executor_execucao', {
        p_execucao_id: execucaoId,
        p_member_id: memberId,
      });
      if (error) throw error;
      await loadExecucaoData();
    } catch (err: any) {
      console.error('[Add executor error]:', err);
      setErrorMsg('Não foi possível adicionar o membro à equipe. Tente novamente.');
    } finally {
      setActionExecutorLoading(false);
    }
  };

  // Remover Executor
  const handleRemoveExecutor = async (memberId: string) => {
    if (!execucaoId || actionExecutorLoading) return;
    if (!window.confirm('Remover este executor do atendimento?')) return;
    setActionExecutorLoading(true);
    setErrorMsg(null);
    try {
      const { error } = await supabase.rpc('remover_executor_execucao', {
        p_execucao_id: execucaoId,
        p_member_id: memberId,
      });
      if (error) throw error;
      await loadExecucaoData();
    } catch (err: any) {
      console.error('[Remove executor error]:', err);
      setErrorMsg('Não foi possível remover o executor. Tente novamente.');
    } finally {
      setActionExecutorLoading(false);
    }
  };

  // Agrupamento dos serviços (do agendamento ou dos itens de execução)
  const servicosComItens = React.useMemo(() => {
    const map = new Map<string, { agendamentoItemId: string; servicoNome: string; itens: ExecucaoItem[] }>();

    // 1. Popula com serviços cadastrados no agendamento
    if (agendamento?.itens && Array.isArray(agendamento.itens)) {
      agendamento.itens.forEach((agItem: any) => {
        const nome = agItem.servicos?.nome || agItem.servico_nome || 'Serviço';
        map.set(agItem.id, {
          agendamentoItemId: agItem.id,
          servicoNome: nome,
          itens: [],
        });
      });
    }

    // 2. Preenche com itens de execução
    itens.forEach((item) => {
      let key = item.agendamento_item_id;
      if (key && map.has(key)) {
        map.get(key)!.itens.push(item);
      } else {
        const matchEntry = Array.from(map.values()).find((val) => val.servicoNome === item.servico_nome);
        if (matchEntry) {
          matchEntry.itens.push(item);
        } else {
          const fallbackKey = key || item.id;
          map.set(fallbackKey, {
            agendamentoItemId: item.agendamento_item_id || '',
            servicoNome: item.servico_nome || 'Serviço',
            itens: [item],
          });
        }
      }
    });

    return Array.from(map.values());
  }, [agendamento, itens]);

  const totalItens = itens.length;
  const concluidosCount = itens.filter((i) => i.concluido).length;

  const pendingRequiredItems = itens.filter((i) => i.obrigatorio && !i.concluido);
  const pendingRequiredNames = pendingRequiredItems.map((i) => `${i.servico_nome}: ${i.descricao}`);

  if (loading) {
    return (
      <div className="min-h-screen bg-graphite-950 text-vapor-100 flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-[14px] text-vapor-400 font-sans">Carregando atendimento...</span>
        </div>
      </div>
    );
  }

  if (errorMsg || !execucao) {
    return (
      <div className="min-h-screen bg-graphite-950 text-vapor-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full p-6 bg-graphite-900 border border-graphite-800 rounded-xl text-center flex flex-col items-center gap-4 shadow-xl">
          <div className="p-3 bg-flare-400/10 text-flare-400 rounded-full border border-flare-400/20">
            <AlertTriangle size={32} />
          </div>
          <h2 className="text-lg font-bold text-vapor-100 font-display">Ops! Atendimento indisponível</h2>
          <p className="text-sm text-vapor-400 font-sans leading-relaxed">
            {errorMsg || 'Não foi possível abrir o atendimento. Tente novamente.'}
          </p>
          <div className="flex items-center justify-center gap-3 mt-2 w-full">
            <Button onClick={() => loadExecucaoData()} variant="primary" className="flex-1">
              Tentar Novamente
            </Button>
            <Button onClick={() => navigate('/')} variant="secondary" className="flex-1">
              Voltar para Hoje
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-graphite-950 text-vapor-100 flex flex-col pb-28">
      {/* TOPO FIXO — Cronômetro de 2 metros e informações do veículo */}
      <header className="sticky top-0 z-40 bg-graphite-900 border-b border-graphite-700 shadow-xl px-4 py-3">
        <div className="max-w-xl mx-auto flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-1 text-[13px] text-vapor-400 hover:text-vapor-100 transition-colors"
            >
              <ArrowLeft size={18} />
              <span>Hoje</span>
            </button>

            <div className="flex items-center gap-2">
              <span className="text-[12px] uppercase font-bold text-vapor-400 tracking-wider">
                {agendamento?.veiculo?.modelo || 'Veículo'}
              </span>
              <span className="px-2 py-0.5 text-[12px] font-mono font-bold bg-amber-500/20 text-amber-400 rounded border border-amber-500/30">
                {agendamento?.veiculo?.placa || 'PLACA'}
              </span>
            </div>
          </div>

          {/* CRONÔMETRO GRANDE VISÍVEL A 2 METROS */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-graphite-950 p-3.5 rounded-lg border border-graphite-800 gap-3">
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[10px] uppercase font-semibold text-vapor-400 tracking-wider mb-1">
                {estadoDerivado !== 'rodando' ? 'STATUS DO TEMPO' : 'TEMPO EM EXECUÇÃO'}
              </span>
              {execucao && (
                <Cronometro
                  execucaoId={execucaoId}
                  status={execucao.status}
                  iniciadoEm={execucao.iniciado_em}
                  finalizadoEm={execucao.finalizado_em}
                  tamanho="grande"
                />
              )}
            </div>

            {/* BOTÃO DE PAUSA / RETOMADA (Oculto quando finalizado) */}
            {execucao?.status !== 'finalizado' && (
              <Button
                type="button"
                variant={estadoDerivado !== 'rodando' ? 'primary' : 'secondary'}
                onClick={handleTogglePausa}
                disabled={pauseActionLoading}
                className={`w-full sm:w-auto min-h-[52px] px-5 font-bold text-[14px] flex items-center justify-center gap-2 shrink-0 ${
                  estadoDerivado === 'pausado_auto'
                    ? 'bg-amber-500 hover:bg-amber-400 text-graphite-950 shadow-lg shadow-amber-500/20'
                    : ''
                }`}
              >
                {pauseActionLoading ? (
                  <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : estadoDerivado === 'pausado_auto' ? (
                  <>
                    <Play size={20} className="fill-current text-graphite-950" />
                    <span className="font-extrabold uppercase">Retomar serviço</span>
                  </>
                ) : estadoDerivado === 'pausado_manual' ? (
                  <>
                    <Play size={20} className="fill-current" />
                    <span>RETOMAR</span>
                  </>
                ) : (
                  <>
                    <Pause size={20} className="fill-current" />
                    <span>PAUSAR</span>
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* CONTEÚDO DA EXECUÇÃO */}
      <main className="max-w-xl mx-auto w-full p-4 flex flex-col gap-6">
        {errorMsg && (
          <div className="p-3 bg-flare-400/10 border border-flare-400/30 rounded-lg text-flare-400 text-[13px] flex items-center gap-2">
            <AlertCircle size={18} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* NOTICE DISCRETO AO ADICIONAR ETAPA AVULSA */}
        {noticeMsg && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-400 text-[13px] flex items-center justify-between gap-2">
            <span>{noticeMsg}</span>
            <button
              type="button"
              onClick={() => setNoticeMsg(null)}
              className="text-amber-400 hover:text-amber-200 text-lg leading-none"
            >
              &times;
            </button>
          </div>
        )}

        {/* PROGRESSO GERAL */}
        <div className="flex items-center justify-between bg-graphite-900 p-3.5 rounded-lg border border-graphite-800">
          <div className="flex items-center gap-2">
            <CheckCircle size={20} className="text-amber-500" />
            <span className="text-[14px] font-medium text-vapor-200">Progresso do Checklist</span>
          </div>
          <span className="font-mono text-[16px] font-bold text-amber-500">
            {concluidosCount} / {totalItens}
          </span>
        </div>

        {/* CHECKLIST AGRUPADO POR SERVIÇO */}
        {servicosComItens.length === 0 ? (
          <Card className="p-6 bg-graphite-900 border-graphite-800 text-center flex flex-col items-center gap-3 text-vapor-400">
            <CheckSquare size={36} className="text-vapor-500" />
            <span className="text-[14px] text-vapor-200 font-medium">
              Nenhuma etapa cadastrada para este serviço.
            </span>
            {podeGerirServicos() && (
              <button
                type="button"
                onClick={() => navigate('/configuracoes?aba=checklists')}
                className="mt-1 px-4 py-2.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[13px] font-semibold transition-colors flex items-center gap-2"
              >
                <Settings size={16} />
                <span>Configurações &gt; Checklists</span>
              </button>
            )}
          </Card>
        ) : (
          servicosComItens.map(({ agendamentoItemId, servicoNome, itens: itensServico }) => {
            const servConcluidos = itensServico.filter((i) => i.concluido).length;
            const servTotal = itensServico.length;
            const isFinalizado = execucao?.status === 'finalizado';
            const formKey = agendamentoItemId || servicoNome;

            return (
              <section key={formKey} className="flex flex-col gap-3 bg-graphite-900/60 p-4 rounded-xl border border-graphite-800">
                {/* CABEÇALHO DO SERVIÇO */}
                <div className="flex items-center justify-between px-1">
                  <h2 className="text-[15px] font-bold text-vapor-100 uppercase tracking-wide">
                    {servicoNome}
                  </h2>
                  <span className="text-[12px] font-mono font-medium text-vapor-400">
                    {servConcluidos}/{servTotal}
                  </span>
                </div>

                {/* LISTA DE ITENS */}
                {itensServico.length === 0 ? (
                  <div className="p-3 bg-graphite-900/40 rounded-lg text-center text-vapor-400 text-[13px] border border-graphite-800/60">
                    Nenhuma etapa cadastrada para este serviço.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {itensServico.map((item) => (
                      <div
                        key={item.id}
                        className={`min-h-[56px] w-full p-4 rounded-lg border text-left flex items-center justify-between gap-3 transition-all ${
                          item.concluido
                            ? 'bg-emerald-950/30 border-emerald-500/40 text-vapor-300'
                            : 'bg-graphite-900 border-graphite-700 hover:border-amber-500/50 text-vapor-100 shadow-md'
                        }`}
                      >
                        <button
                          type="button"
                          disabled={isFinalizado}
                          onClick={() => handleToggleItem(item.id, !item.concluido)}
                          className="flex items-center gap-3.5 flex-1 text-left"
                        >
                          {item.concluido ? (
                            <CheckSquare size={24} className="text-emerald-400 shrink-0" />
                          ) : (
                            <Square size={24} className="text-vapor-400 shrink-0" />
                          )}
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span
                                className={`text-[15px] font-medium leading-snug ${
                                  item.concluido ? 'line-through text-vapor-400' : ''
                                }`}
                              >
                                {item.descricao}
                              </span>
                              {item.origem === 'avulso' && (
                                <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-graphite-800 text-amber-400 border border-graphite-700">
                                  avulso
                                </span>
                              )}
                            </div>
                            {item.observacao && (
                              <span className="text-[12px] text-vapor-400 font-normal leading-tight">
                                {item.observacao}
                              </span>
                            )}
                          </div>
                        </button>

                        <div className="flex items-center gap-2 shrink-0">
                          {item.obrigatorio && (
                            <span
                              className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${
                                item.concluido
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                  : 'bg-flare-400/20 text-flare-400 border-flare-400/40'
                              }`}
                            >
                              Obrigatório
                            </span>
                          )}

                          {item.origem === 'avulso' && !isFinalizado && (
                            <button
                              type="button"
                              title="Remover etapa avulsa"
                              onClick={() => handleRemoverItemAvulso(item.id)}
                              className="p-1.5 text-vapor-400 hover:text-flare-400 hover:bg-flare-400/10 rounded transition-colors"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* BOTÃO E FORMULÁRIO DE ADICIONAR ETAPA AVULSA */}
                {!isFinalizado && (
                  <div className="pt-1">
                    {showAddForm[formKey] ? (
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mt-2 bg-graphite-950 p-2.5 rounded-lg border border-graphite-800">
                        <input
                          type="text"
                          placeholder="Descrição da nova etapa..."
                          value={novoItemText[formKey] || ''}
                          onChange={(e) =>
                            setNovoItemText((prev) => ({
                              ...prev,
                              [formKey]: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter')
                              handleAdicionarItemAvulso(agendamentoItemId, servicoNome);
                          }}
                          className="flex-1 bg-graphite-900 border border-graphite-700 rounded-md px-3 py-2 text-[14px] text-vapor-100 focus:outline-none focus:border-amber-500"
                          autoFocus
                        />
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            type="button"
                            variant="primary"
                            disabled={addingItemLoading || !(novoItemText[formKey] || '').trim()}
                            onClick={() => handleAdicionarItemAvulso(agendamentoItemId, servicoNome)}
                            className="px-3 py-2 text-[13px] font-bold"
                          >
                            Adicionar
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() =>
                              setShowAddForm((prev) => ({
                                ...prev,
                                [formKey]: false,
                              }))
                            }
                            className="px-3 py-2 text-[13px]"
                          >
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setShowAddForm((prev) => ({
                            ...prev,
                            [formKey]: true,
                          }))
                        }
                        className="mt-1 self-start text-[13px] font-semibold text-amber-500 hover:text-amber-400 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-amber-500/10 transition-colors"
                      >
                        <Plus size={16} />
                        <span>Adicionar etapa</span>
                      </button>
                    )}
                  </div>
                )}
              </section>
            );
          })
        )}

        {/* CARD DE AVISO DE EXPURGO DE FOTOS DE EXECUÇÃO */}
        {(() => {
          const fotoPreservada = fotos.find((f) => (f as any).preservada);
          const fotoComExpiracao = fotos.find((f) => (f as any).expirado_em && !(f as any).preservada);

          let diasRestantes: number | null = null;
          let dataLimiteStr = '';

          if (fotoComExpiracao && (fotoComExpiracao as any).expirado_em) {
            const expIso = (fotoComExpiracao as any).expirado_em;
            const expTime = new Date(expIso).getTime();
            diasRestantes = Math.max(0, Math.ceil((expTime - Date.now()) / (1000 * 60 * 60 * 24)));
            dataLimiteStr = new Date(expIso).toLocaleDateString('pt-BR');
          }

          const isAmberWarning = diasRestantes !== null && diasRestantes <= 15;

          return (
            <Card className={`p-4 transition-colors ${
              fotoPreservada
                ? 'bg-graphite-900 border-emerald-500/30'
                : isAmberWarning
                ? 'bg-amber-500/10 border-amber-500/50 text-amber-200'
                : 'bg-graphite-900 border-graphite-800'
            }`}>
              <div className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {fotoPreservada ? (
                      <ShieldCheck size={20} className="text-emerald-400 shrink-0" />
                    ) : (
                      <Archive size={20} className={isAmberWarning ? 'text-amber-400 shrink-0' : 'text-vapor-400 shrink-0'} />
                    )}
                    <div>
                      <h4 className="text-[13px] font-bold uppercase tracking-wide text-vapor-200">
                        {fotoPreservada ? 'Fotos Preservadas' : 'Retenção de Fotos de Execução'}
                      </h4>
                      <p className="text-[12px] text-vapor-400 mt-0.5">
                        {fotoPreservada ? (
                          <span className="text-emerald-400 font-medium">
                            Este atendimento foi marcado para preservação no acervo permanente.
                          </span>
                        ) : fotoComExpiracao ? (
                          <span>
                            As fotos deste atendimento serão apagadas em{' '}
                            <strong className="font-mono text-[13px] text-amber-400">{diasRestantes} dias</strong>, no dia{' '}
                            <strong className="font-mono text-[13px] text-amber-400">{dataLimiteStr}</strong>.
                          </span>
                        ) : (
                          <span>Fotos de execução sujeitas ao prazo de retenção do plano.</span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-graphite-800/60">
                  {fotos.length > 0 && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={handleBaixarTodasZip}
                      disabled={downloadingZip}
                      className="text-[12px] h-8 px-3 flex items-center gap-1.5"
                    >
                      {downloadingZip ? (
                        <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Download size={14} />
                      )}
                      <span>Baixar todas (.zip)</span>
                    </Button>
                  )}

                  {podeGerirServicos() && (
                    <Button
                      type="button"
                      variant={fotoPreservada ? 'secondary' : 'primary'}
                      onClick={() => handleTogglePreservarFotos(!!fotoPreservada)}
                      disabled={preservarLoading}
                      className={`text-[12px] h-8 px-3 flex items-center gap-1.5 ${
                        fotoPreservada ? 'bg-graphite-800 hover:bg-graphite-700 text-vapor-200' : ''
                      }`}
                    >
                      {preservarLoading ? (
                        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <ShieldCheck size={14} />
                      )}
                      <span>{fotoPreservada ? 'Remover Preservação' : 'Preservar Estas Fotos'}</span>
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          );
        })()}

        {/* FOTOS DE EXECUÇÃO */}
        <section className="flex flex-col gap-3 pt-2 border-t border-graphite-800">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-bold uppercase text-vapor-300 tracking-wide flex items-center gap-2">
              <Camera size={18} className="text-amber-500" />
              <span>Fotos Durante a Execução</span>
            </h3>
            <span className="text-[12px] text-vapor-400">({fotos.length} fotos)</span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {fotos.map((foto) => (
              <div key={foto.id} className="relative aspect-square rounded-lg overflow-hidden bg-graphite-900 border border-graphite-700">
                <img src={foto.signedUrl || foto.path} alt="Durante" className="w-full h-full object-cover" />
              </div>
            ))}

            <label className="flex flex-col items-center justify-center aspect-square rounded-lg border-2 border-dashed border-graphite-600 hover:border-amber-500 bg-graphite-900 cursor-pointer text-vapor-400 hover:text-amber-500 transition-colors">
              {uploadingFoto ? (
                <div className="flex flex-col items-center gap-1">
                  <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-[9px] font-mono text-amber-400 text-center px-1">{uploadProgressText || 'Enviando...'}</span>
                </div>
              ) : (
                <>
                  <Camera size={24} />
                  <span className="text-[11px] font-semibold mt-1">Tirar foto</span>
                </>
              )}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleUploadFotoDurante}
                disabled={uploadingFoto}
                className="hidden"
              />
            </label>
          </div>
        </section>

        {/* EXECUTORES / CO-TRABALHADORES */}
        <section className="flex flex-col gap-3 pt-2 border-t border-graphite-800">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-bold uppercase text-vapor-300 tracking-wide flex items-center gap-2">
              <Users size={18} className="text-amber-500" />
              <span>Equipe na Execução</span>
            </h3>
            {execucao?.status !== 'finalizado' && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowAddExecutor(!showAddExecutor)}
                className="text-[12px] h-8 px-3"
              >
                <Plus size={14} />
                <span>{showAddExecutor ? 'Fechar' : 'Adicionar'}</span>
              </Button>
            )}
          </div>

          {teamLoadError && (
            <div className="p-3 bg-flare-500/10 border border-flare-500/30 rounded-lg text-flare-400 text-xs">
              {teamLoadError}
            </div>
          )}

          {/* Lista de Executores Atuais */}
          <div className="flex flex-wrap gap-2">
            {executores.map((exec) => {
              const emailMembro = exec.member?.email || (exec as any).email || 'Membro';
              const papelMembro = exec.member?.role || '';
              const isConvidado = exec.member?.status === 'convidado';
              return (
                <div
                  key={exec.id}
                  className="flex items-center gap-2 px-3 py-1.5 bg-graphite-900 border border-graphite-700 rounded-full text-[13px] text-vapor-200"
                >
                  <span className="font-sans font-medium">{emailMembro}</span>
                  {exec.principal && (
                    <span className="text-[10px] bg-amber-500/20 text-amber-400 font-bold px-1.5 py-0.5 rounded uppercase">
                      Principal
                    </span>
                  )}
                  {papelMembro && papelMembro !== 'operador' && (
                    <span className="text-[10px] bg-graphite-800 text-vapor-400 px-1.5 py-0.5 rounded capitalize">
                      {papelMembro}
                    </span>
                  )}
                  {isConvidado && (
                    <span className="text-[10px] bg-zinc-800 text-zinc-400 border border-zinc-700 px-1.5 py-0.5 rounded">
                      não acessa o sistema
                    </span>
                  )}
                  {execucao?.status !== 'finalizado' && executores.length > 1 && (
                    <button
                      type="button"
                      title="Remover executor"
                      disabled={actionExecutorLoading}
                      onClick={() => handleRemoveExecutor(exec.member_id)}
                      className="text-vapor-400 hover:text-flare-400 transition-colors ml-1 p-0.5"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Bloco Adicionar Membro da Equipe */}
          {showAddExecutor && execucao?.status !== 'finalizado' && (
            <div className="p-3 bg-graphite-900 border border-graphite-700 rounded-lg flex flex-col gap-2.5">
              <span className="text-[12px] font-semibold text-vapor-300">
                Selecionar membro da equipe:
              </span>
              {membrosTenant.length === 0 ? (
                <span className="text-[12px] text-vapor-400 italic">
                  Nenhum outro membro cadastrado. Cadastre em Ajustes &gt; Equipe.
                </span>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {membrosTenant.map((membro) => {
                    const jaExecutor = membro.ja_executor || executores.some((e) => e.member_id === membro.member_id);
                    return (
                      <Button
                        key={membro.member_id}
                        type="button"
                        variant={jaExecutor ? 'ghost' : 'secondary'}
                        disabled={jaExecutor || actionExecutorLoading}
                        onClick={() => handleAddExecutor(membro.member_id)}
                        className={`text-[12px] h-8 px-3 flex items-center gap-1.5 ${
                          jaExecutor ? 'opacity-60 cursor-not-allowed border-graphite-800 text-vapor-500' : ''
                        }`}
                      >
                        <span>{membro.rotulo || membro.email}</span>
                        {membro.papel && (
                          <span className="text-[10px] text-vapor-500">({membro.papel})</span>
                        )}
                        {membro.status === 'convidado' && (
                          <span className="text-[10px] text-zinc-400 italic">
                            (não acessa o sistema)
                          </span>
                        )}
                        {jaExecutor && <span className="text-[10px] text-amber-400 font-bold ml-1">✓ Já adicionado</span>}
                      </Button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      {/* RODAPÉ FIXO — BOTÃO DE FINALIZAÇÃO 56PX */}
      <footer className="fixed bottom-0 left-0 right-0 z-40 bg-graphite-900 border-t border-graphite-700 p-4 shadow-2xl">
        <div className="max-w-xl mx-auto flex flex-col gap-1.5">
          {pendingRequiredItems.length > 0 && execucao?.status !== 'finalizado' && (
            <div className="flex items-center justify-center gap-1.5 text-[12px] font-mono text-amber-400 font-medium">
              <AlertTriangle size={14} className="shrink-0" />
              <span>{pendingRequiredItems.length} item(ns) obrigatório(s) pendente(s)</span>
            </div>
          )}
          {execucao?.status === 'finalizado' ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => navegarParaAtendimento(navigate, execucaoId, agendamento?.id)}
              className="w-full min-h-[56px] text-[16px] font-bold tracking-wide uppercase shadow-lg"
            >
              <Eye size={22} />
              <span>Ver Ficha do Atendimento</span>
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              onClick={handleAbrirModalFinalizar}
              className="w-full min-h-[56px] text-[16px] font-bold tracking-wide uppercase shadow-lg"
            >
              <CheckCircle size={22} />
              <span>Finalizar Serviço</span>
            </Button>
          )}
        </div>
      </footer>

      {/* MODAL DE FINALIZAÇÃO */}
      {execucaoId && tenant && agendamento && (
        <ModalFinalizarExecucao
          isOpen={modalFinalizarOpen}
          onClose={() => setModalFinalizarOpen(false)}
          execucaoId={execucaoId}
          agendamentoId={agendamento.id}
          tenantId={tenant.id}
          placaVeiculo={agendamento.veiculo?.placa || ''}
          pendingRequiredCount={pendingRequiredItems.length}
          pendingRequiredNames={pendingRequiredNames}
          agendamentoItens={agendamento.itens || []}
          fotosSaidaExistentes={fotos.filter((f) => f.momento === 'saida')}
          onSuccess={() => {
            navigate('/hoje');
          }}
        />
      )}
    </div>
  );
};
