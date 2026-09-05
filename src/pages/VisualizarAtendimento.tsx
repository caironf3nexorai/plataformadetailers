import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import {
  ArrowLeft,
  Clock,
  CheckSquare,
  Package,
  Camera,
  ClipboardCheck,
  DollarSign,
  User,
  Car,
  AlertTriangle,
  ShieldCheck,
  CheckCircle2,
  Printer,
  FileDown,
  Download,
  Eye,
  X,
  AlertCircle,
} from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { formatarMoeda, formatarOS } from '../utils/formatters';
import { formatarDataHora } from '../utils/datas';
import { formatarSegundosHHMMSS } from '../hooks/useTempoExecucao';
import { gerarPDFOS } from '../utils/pdfOS';
import { getEvidenciaSignedUrl, baixarFoto } from '../utils/evidencias';

export const VisualizarAtendimento: React.FC = () => {
  const { id: paramId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { tenant, membership } = useAuth();
  const podeVerCusto = membership?.role === 'dono' || membership?.role === 'gerente';

  const [avisoNavegacao, setAvisoNavegacao] = useState<string | null>(() => (location.state as any)?.aviso || null);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [execucao, setExecucao] = useState<any | null>(null);
  const [agendamento, setAgendamento] = useState<any | null>(null);
  const [ordinalCliente, setOrdinalCliente] = useState<number | null>(null);
  const [checkinId, setCheckinId] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<any[]>([]);
  const [consumos, setConsumos] = useState<any[]>([]);
  const [valores, setValores] = useState<any[]>([]);
  const [fotos, setFotos] = useState<{ vistoria: any[]; durante: any[]; saida: any[] }>({
    vistoria: [],
    durante: [],
    saida: [],
  });
  const [fotoModal, setFotoModal] = useState<{ url: string; titulo: string; data?: string } | null>(null);
  const [gerandoPDFOS, setGerandoPDFOS] = useState(false);
  const [modalAvisoSemVistoriaOpen, setModalAvisoSemVistoriaOpen] = useState(false);

  const handleGerarPDFOS = async (acao: 'download' | 'print' = 'download') => {
    if (!agendamento || !tenant) return;
    try {
      setGerandoPDFOS(true);
      const logoUrl = tenant.logo_path
        ? supabase.storage.from('catalogo').getPublicUrl(tenant.logo_path).data.publicUrl
        : undefined;

      // 1. Tempo real trabalhado na execução (se concluído)
      const tempoRealTrabalhadoMinutos = execucao?.tempo_efetivo_minutos && execucao.tempo_efetivo_minutos > 0
        ? execucao.tempo_efetivo_minutos
        : (segundosTrabalhados > 0 ? Math.round(segundosTrabalhados / 60) : undefined);

      const rawItens = (agendamento.agendamento_itens || []);
      const itensFormatados = rawItens.map((it: any) => ({
        servico_nome: it.servicos?.nome || it.servico_nome || 'Serviço',
        categoria_nome: it.categoria?.nome,
        preco: Number(it.preco_estimado ?? it.preco_praticado ?? it.preco ?? it.valor ?? it.servicos?.preco ?? 0),
        duracao_minutos: (agendamento.status === 'concluido' && tempoRealTrabalhadoMinutos && rawItens.length <= 1)
          ? tempoRealTrabalhadoMinutos
          : (it.duracao_minutos || it.servicos?.duracao_minutos || agendamento.duracao_total || agendamento.duracao_minutos),
        quantidade: it.quantidade || 1,
      }));

      const totalItens = itensFormatados.reduce((acc: number, it: any) => acc + (it.preco * (it.quantidade || 1)), 0);
      const valorFinalTotal = Number(
        execucao?.valor_total_final ?? 
        agendamento.preco_estimado_total ?? 
        agendamento.preco_total ?? 
        totalItens
      );

      // Se há um serviço único ou item principal e o valor final faturado foi ajustado (ex: R$ 150),
      // alinha o preço do item para bater com o total faturado no documento da OS
      if (itensFormatados.length === 1 && valorFinalTotal > 0) {
        itensFormatados[0].preco = valorFinalTotal;
      } else if (itensFormatados.length > 1 && totalItens === 0 && valorFinalTotal > 0) {
        itensFormatados[0].preco = valorFinalTotal;
      }

      if (itensFormatados.length === 0 && agendamento.servico) {
        itensFormatados.push({
          servico_nome: agendamento.servico.nome || 'Serviço',
          preco: valorFinalTotal,
          duracao_minutos: tempoRealTrabalhadoMinutos || agendamento.duracao_minutos || agendamento.duracao_total,
          quantidade: 1,
        });
      }

      const dataConclusao = execucao?.finalizado_em || (agendamento.status === 'concluido' ? agendamento.fim : undefined);

      await gerarPDFOS(
        {
          numero_os: agendamento.numero_os || 1,
          data_emissao: agendamento.created_at,
          status: agendamento.status || (execucao?.finalizado_em ? 'concluido' : 'em_andamento'),
          inicio: agendamento.inicio,
          previsao_entrega: agendamento.fim,
          concluido_em: dataConclusao,
          data_conclusao: dataConclusao,
          responsavel_nome: 'Oficina / Responsável',
          observacoes: agendamento.observacoes || execucao?.observacoes,
          clienteNome: agendamento.cliente?.nome || 'Cliente',
          clienteTelefone: agendamento.cliente?.telefone,
          clienteDocumento: agendamento.cliente?.documento || agendamento.cliente?.cpf_cnpj,
          clienteEmail: agendamento.cliente?.email,
          veiculoModelo: agendamento.veiculo?.modelo || 'Veículo',
          veiculoPlaca: agendamento.veiculo?.placa || '',
          veiculoMarca: agendamento.veiculo?.marca,
          veiculoCor: agendamento.veiculo?.cor,
          veiculoAno: agendamento.veiculo?.ano,
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
          valor_total: valorFinalTotal,
          desconto: Number(agendamento.desconto_valor || 0),
          forma_pagamento: agendamento.forma_pagamento,
          assinaturaClienteNome: agendamento.cliente?.nome,
        },
        undefined,
        acao
      );
    } catch (err: any) {
      console.error('[Gerar PDF OS Error]:', err);
    } finally {
      setGerandoPDFOS(false);
    }
  };

  useEffect(() => {
    const fetchAtendimento = async () => {
      if (!paramId) return;
      setLoading(true);
      setErrorMsg(null);

      try {
        console.log('[VisualizarAtendimento] Buscando atendimento para paramId:', paramId);
        let execData: any = null;

        const { data: byExecId, error: err1 } = await supabase
          .from('execucoes')
          .select('*, agendamentos(*, cliente:clientes(*), veiculo:veiculos(*), agendamento_itens(*, servicos(*)))')
          .eq('id', paramId)
          .maybeSingle();

        if (err1) {
          console.error('[VisualizarAtendimento] Erro ao buscar por execucao.id:', { paramId, error: err1 });
        }

        let agendOnlyData: any = null;
        let checkinDirectData: any = null;

        if (byExecId) {
          execData = byExecId;
        } else {
          const { data: byAgendId, error: err2 } = await supabase
            .from('execucoes')
            .select('*, agendamentos(*, cliente:clientes(*), veiculo:veiculos(*), agendamento_itens(*, servicos(*)))')
            .eq('agendamento_id', paramId)
            .maybeSingle();

          if (err2) {
            console.error('[VisualizarAtendimento] Erro ao buscar por execucao.agendamento_id:', { paramId, error: err2 });
          }

          if (byAgendId) {
            execData = byAgendId;
          } else {
            // Tentar carregar agendamento isolado
            const { data: agendOnly, error: err3 } = await supabase
              .from('agendamentos')
              .select('*, cliente:clientes(*), veiculo:veiculos(*), agendamento_itens(*, servicos(*))')
              .eq('id', paramId)
              .maybeSingle();

            if (err3) {
              console.error('[VisualizarAtendimento] Erro ao buscar por agendamento.id:', { paramId, error: err3 });
            }

            if (agendOnly) {
              agendOnlyData = agendOnly;
              setAgendamento(agendOnly);
            } else {
              // Tentar carregar se paramId for o ID direto da vistoria (check-in)
              const { data: chkDirect } = await supabase
                .from('checkins')
                .select('*, agendamento:agendamentos(*, cliente:clientes(*), veiculo:veiculos(*), agendamento_itens(*, servicos(*)))')
                .eq('id', paramId)
                .maybeSingle();

              if (chkDirect) {
                checkinDirectData = chkDirect;
                if (chkDirect.agendamento) {
                  agendOnlyData = chkDirect.agendamento;
                  setAgendamento(chkDirect.agendamento);
                }
              } else {
                console.warn('[VisualizarAtendimento] Registro não encontrado para paramId:', paramId);
                setErrorMsg('Não foi possível carregar este atendimento.');
              }
            }
          }
        }

        const currentAgend = execData?.agendamentos || agendOnlyData;
        if (currentAgend) {
          setAgendamento(currentAgend);
        }
        if (execData) {
          setExecucao(execData);
        }

        const execId = execData?.id;
        const agendId = execData?.agendamento_id || agendOnlyData?.id || currentAgend?.id;

        let fotosVistoria: any[] = [];
        let fotosDurante: any[] = [];
        let fotosSaida: any[] = [];

        // 2. Buscar Check-in (Vistoria)
        let chkId = checkinDirectData?.id;
        if (!chkId && agendId) {
          const { data: checkinData, error: checkinErr } = await supabase
            .from('checkins')
            .select('id, created_at, km, nivel_combustivel')
            .eq('agendamento_id', agendId)
            .maybeSingle();

          if (checkinErr) {
            console.error('[VisualizarAtendimento] Erro ao buscar check-in:', checkinErr);
          }
          if (checkinData) {
            chkId = checkinData.id;
          }
        }

        // Se ainda não achou chkId, tenta ver se paramId é o próprio checkin_id
        if (!chkId && paramId) {
          const { data: chkById } = await supabase
            .from('checkins')
            .select('id')
            .eq('id', paramId)
            .maybeSingle();
          if (chkById) {
            chkId = chkById.id;
          }
        }

        if (chkId) {
          setCheckinId(chkId);

          const { data: chkFotos, error: errChkFotos } = await supabase
            .from('checkin_fotos')
            .select('*')
            .eq('checkin_id', chkId)
            .order('created_at', { ascending: true });

          if (errChkFotos) {
            console.error('[VisualizarAtendimento] Erro ao buscar checkin_fotos:', errChkFotos);
          }

          if (chkFotos && chkFotos.length > 0) {
            fotosVistoria = await Promise.all(
              chkFotos.map(async (ft: any) => {
                const signedUrl = await getEvidenciaSignedUrl(ft.path);
                return { ...ft, signedUrl: signedUrl || ft.path, tipo: 'vistoria' };
              })
            );
          }
        }

        // Fallback: se fotosVistoria ainda estiver vazia, tenta buscar por paramId direto na tabela checkin_fotos
        if (fotosVistoria.length === 0 && paramId) {
          const { data: directChkFotos } = await supabase
            .from('checkin_fotos')
            .select('*')
            .eq('checkin_id', paramId)
            .order('created_at', { ascending: true });

          if (directChkFotos && directChkFotos.length > 0) {
            fotosVistoria = await Promise.all(
              directChkFotos.map(async (ft: any) => {
                const signedUrl = await getEvidenciaSignedUrl(ft.path);
                return { ...ft, signedUrl: signedUrl || ft.path, tipo: 'vistoria' };
              })
            );
          }
        }

        if (execId) {
          // 3. Buscar Checklist (execucao_itens)
          const { data: itemsData } = await supabase
            .from('execucao_itens')
            .select('*, executor:perfis(nome)')
            .eq('execucao_id', execId)
            .order('ordem', { ascending: true });

          setChecklist(itemsData || []);

          // 4. Buscar Insumos (execucao_consumos)
          const { data: consumosData } = await supabase
            .from('execucao_consumos')
            .select('*, produto:produtos(nome, unidade_uso)')
            .eq('execucao_id', execId);

          setConsumos(consumosData || []);

          // 5. Buscar Valores (execucao_valores)
          const { data: valoresData } = await supabase
            .from('execucao_valores')
            .select('*, agendamento_item:agendamento_itens(servico_nome)')
            .eq('execucao_id', execId);

          setValores(valoresData || []);

          // 6. Buscar Fotos (execucao_fotos)
          const { data: fotosData } = await supabase
            .from('execucao_fotos')
            .select('*')
            .eq('execucao_id', execId)
            .order('created_at', { ascending: true });

          if (fotosData && fotosData.length > 0) {
            const fotosComUrl = await Promise.all(
              fotosData.map(async (f: any) => {
                const signedUrl = await getEvidenciaSignedUrl(f.path);
                return { ...f, signedUrl: signedUrl || f.path };
              })
            );
            fotosDurante = fotosComUrl.filter((f) => f.momento === 'durante' || f.tipo === 'durante');
            fotosSaida = fotosComUrl.filter((f) => f.momento === 'saida' || f.tipo === 'saida');
          }
        }

        setFotos({ vistoria: fotosVistoria, durante: fotosDurante, saida: fotosSaida });

        // Buscar ordinal do cliente ("Xº atendimento deste cliente")
        const targetAgend = execData?.agendamentos || agendamento;
        if (targetAgend?.cliente_id && targetAgend?.numero_os) {
          const { count } = await supabase
            .from('agendamentos')
            .select('id', { count: 'exact', head: true })
            .eq('cliente_id', targetAgend.cliente_id)
            .lte('numero_os', targetAgend.numero_os)
            .not('status', 'eq', 'cancelado');

          setOrdinalCliente(count || null);
        }
      } catch (err: any) {
        console.error('Erro ao carregar ficha do atendimento:', err);
        setErrorMsg(err.message || 'Erro ao carregar ficha do atendimento.');
      } finally {
        setLoading(false);
      }
    };

    fetchAtendimento();
  }, [paramId]);

  if (loading) {
    return (
      <div className="p-8 text-center text-vapor-400 flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        <span>Carregando atendimento...</span>
      </div>
    );
  }

  const handleVoltar = () => {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      navigate('/hoje');
    }
  };

  if (errorMsg || (!execucao && !agendamento)) {
    return (
      <div className="p-8 max-w-lg mx-auto text-center flex flex-col items-center gap-4">
        <div className="p-3 bg-flare-500/10 text-flare-400 rounded-full border border-flare-500/20">
          <AlertTriangle size={32} />
        </div>
        <h2 className="text-xl font-bold text-vapor-100">Ops! Algo deu errado.</h2>
        <p className="text-sm text-vapor-400">{errorMsg || 'Atendimento não encontrado.'}</p>
        <Button onClick={handleVoltar} variant="secondary">
          Voltar
        </Button>
      </div>
    );
  }

  const veiculo = agendamento?.veiculo;
  const cliente = agendamento?.cliente;
  const segundosTrabalhados = Number(execucao?.segundos_trabalhados || 0);

  const statusAtual = agendamento?.status || (execucao?.finalizado_em ? 'concluido' : 'em_andamento');

  const handleConfirmarAgendamento = async () => {
    if (!agendamento?.id) return;
    try {
      const { error } = await supabase
        .from('agendamentos')
        .update({ status: 'confirmado' })
        .eq('id', agendamento.id);
      if (error) throw error;
      setAgendamento((prev: any) => ({ ...prev, status: 'confirmado' }));
    } catch (err: any) {
      console.error('Erro ao confirmar agendamento:', err);
    }
  };

  const renderStatusBadge = () => {
    switch (statusAtual) {
      case 'agendado':
        return (
          <span className="px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider font-sans bg-amber-500/20 text-amber-400 rounded-full border border-amber-500/30">
            AGENDADO · A CONFIRMAR
          </span>
        );
      case 'confirmado':
        return (
          <span className="px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider font-sans bg-sky-500/20 text-sky-400 rounded-full border border-sky-500/30">
            CONFIRMADO
          </span>
        );
      case 'em_andamento':
        return (
          <span className="px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider font-sans bg-amber-500/20 text-amber-300 rounded-full border border-amber-500/30 animate-pulse">
            EM EXECUÇÃO
          </span>
        );
      case 'cancelado':
        return (
          <span className="px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider font-sans bg-flare-500/20 text-flare-400 rounded-full border border-flare-500/30">
            CANCELADO
          </span>
        );
      case 'concluido':
      default:
        return (
          <span className="px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider font-sans bg-mint-500/20 text-mint-400 rounded-full border border-mint-500/30">
            CONCLUÍDO
          </span>
        );
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto flex flex-col gap-6 pb-24">
      {/* NAVEGAÇÃO DE VOLTA & TÍTULO */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-graphite-700 pb-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleVoltar}
            className="p-2 rounded-lg bg-graphite-800 hover:bg-graphite-700 text-vapor-300 border border-graphite-700 transition-colors"
            title="Voltar para a página anterior"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-display text-[20px] font-bold text-vapor-100 uppercase tracking-tight">
                Ficha do Atendimento
              </h1>
              {renderStatusBadge()}
            </div>
            <span className="font-mono text-[12px] text-vapor-400">
              {formatarOS(agendamento?.numero_os)}
              {ordinalCliente ? ` · ${ordinalCliente}º atendimento deste cliente` : ''}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Botão de confirmação para agendamentos pendentes */}
          {agendamento?.status === 'agendado' && (
            <Button
              type="button"
              variant="primary"
              onClick={handleConfirmarAgendamento}
              className="flex items-center gap-1.5 text-[12px] bg-sky-500 hover:bg-sky-400 text-graphite-950 font-bold shrink-0"
            >
              <CheckCircle2 size={16} />
              <span>Confirmar Agendamento</span>
            </Button>
          )}

          {/* Botão de Imprimir OS */}
          <Button
            type="button"
            variant="secondary"
            onClick={() => handleGerarPDFOS('print')}
            disabled={gerandoPDFOS}
            className="flex items-center gap-1.5 text-[12px] bg-graphite-800 hover:bg-graphite-700 text-vapor-200 border border-graphite-600 shrink-0"
            title="Imprimir Ordem de Serviço"
          >
            <Printer size={16} className="text-amber-400" />
            <span className="hidden sm:inline">Imprimir OS</span>
          </Button>

          {/* Botão de Baixar PDF da OS */}
          <Button
            type="button"
            variant="secondary"
            onClick={() => handleGerarPDFOS('download')}
            disabled={gerandoPDFOS}
            className="flex items-center gap-1.5 text-[12px] bg-graphite-800 hover:bg-graphite-700 text-vapor-200 border border-graphite-600 shrink-0"
            title="Baixar PDF da Ordem de Serviço"
          >
            <FileDown size={16} className="text-cyan-400" />
            <span className="hidden sm:inline">{gerandoPDFOS ? 'Gerando...' : 'PDF da OS'}</span>
          </Button>

          {/* Botão para Vistoria de Entrada (com feedback claro se não realizada) */}
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              if (checkinId) {
                navigate(`/checkin/${checkinId}/ver`);
              } else {
                setModalAvisoSemVistoriaOpen(true);
              }
            }}
            className="flex items-center gap-1.5 text-[12px] bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 shrink-0"
            title={checkinId ? 'Visualizar vistoria de entrada' : 'Aviso sobre vistoria de entrada'}
          >
            <ClipboardCheck size={16} />
            <span className="hidden sm:inline">Vistoria de Entrada</span>
          </Button>
        </div>
      </div>

      {/* BANNER DE AVISO DE VISTORIA NÃO REALIZADA */}
      {avisoNavegacao && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/40 rounded-xl flex items-center justify-between gap-3 text-amber-300 shadow-md animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            <AlertCircle className="shrink-0 text-amber-400" size={20} />
            <span className="text-[13px] font-sans text-vapor-200 font-medium">
              {avisoNavegacao}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setAvisoNavegacao(null)}
            className="text-vapor-400 hover:text-vapor-200 p-1"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* BLOCO 1: RESUMO DO VEÍCULO E CLIENTE */}
      <Card className="p-4 flex flex-col gap-4 bg-graphite-900 border-graphite-700">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Veículo */}
          <div className="flex items-start gap-3 p-3 rounded-lg bg-graphite-800/80 border border-graphite-700">
            <Car size={22} className="text-amber-400 shrink-0 mt-0.5" />
            <div className="flex flex-col">
              <span className="text-[11px] font-sans text-vapor-400 uppercase font-medium">Veículo / Placa</span>
              <span className="font-mono text-[16px] font-bold text-vapor-100">
                {veiculo?.placa || 'Sem placa'} {veiculo?.modelo ? `(${veiculo.modelo})` : ''}
              </span>
              <span className="text-[12px] text-vapor-400 font-sans">
                {veiculo?.marca || ''} {veiculo?.cor ? `• ${veiculo.cor}` : ''}
              </span>
            </div>
          </div>

          {/* Cliente */}
          <div className="flex items-start gap-3 p-3 rounded-lg bg-graphite-800/80 border border-graphite-700">
            <User size={22} className="text-amber-400 shrink-0 mt-0.5" />
            <div className="flex flex-col">
              <span className="text-[11px] font-sans text-vapor-400 uppercase font-medium">Cliente</span>
              <span className="font-sans text-[15px] font-bold text-vapor-100">
                {cliente?.nome || 'Não informado'}
              </span>
              <span className="font-mono text-[12px] text-vapor-400">
                {cliente?.telefone || cliente?.email || 'Sem contato'}
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* BLOCO 2: TEMPO TRABALHADO E REGISTRO DE HORÁRIOS */}
      <Card className="p-4 flex flex-col gap-3 bg-graphite-900 border-graphite-700">
        <div className="flex items-center gap-2 border-b border-graphite-800 pb-2">
          <Clock size={18} className="text-amber-400" />
          <h2 className="font-display text-[14px] font-bold text-vapor-100 uppercase tracking-wider">
            Tempo e Duração do Atendimento
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
          <div className="p-3 bg-graphite-800/80 rounded border border-graphite-700 flex flex-col gap-1">
            <span className="text-[11px] text-vapor-400 font-sans">Início do Serviço</span>
            <span className="font-mono text-[13px] font-semibold text-vapor-100">
              {execucao?.iniciado_em ? formatarDataHora(execucao.iniciado_em) : 'Não registrado'}
            </span>
          </div>

          <div className="p-3 bg-graphite-800/80 rounded border border-graphite-700 flex flex-col gap-1">
            <span className="text-[11px] text-vapor-400 font-sans">Término do Serviço</span>
            <span className="font-mono text-[13px] font-semibold text-vapor-100">
              {execucao?.finalizado_em ? formatarDataHora(execucao.finalizado_em) : 'Não registrado'}
            </span>
          </div>

          <div className="p-3 bg-graphite-800/80 rounded border border-graphite-700 flex flex-col gap-1">
            <span className="text-[11px] text-vapor-400 font-sans">Tempo Trabalhado</span>
            {segundosTrabalhados > 0 ? (
              <span className="font-mono text-[16px] font-bold text-amber-300">
                {formatarSegundosHHMMSS(segundosTrabalhados)}
              </span>
            ) : (
              <span className="text-[12px] font-bold text-amber-500 font-sans">
                Tempo não registrado
              </span>
            )}
          </div>
        </div>
      </Card>

      {/* BLOCO 3: SERVIÇOS EXECUTADOS & CHECKLIST FINAL */}
      <Card className="p-4 flex flex-col gap-3 bg-graphite-900 border-graphite-700">
        <div className="flex items-center gap-2 border-b border-graphite-800 pb-2">
          <CheckSquare size={18} className="text-amber-400" />
          <h2 className="font-display text-[14px] font-bold text-vapor-100 uppercase tracking-wider">
            Serviços e Checklist de Execução
          </h2>
        </div>

        {checklist.length > 0 ? (
          <div className="flex flex-col gap-2">
            {checklist.map((item) => (
              <div
                key={item.id}
                className="p-3 rounded-lg bg-graphite-800/80 border border-graphite-700/80 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-5 h-5 rounded flex items-center justify-center border ${
                      item.concluido
                        ? 'bg-mint-500/20 border-mint-500/50 text-mint-400'
                        : 'bg-graphite-900 border-graphite-600 text-vapor-500'
                    }`}
                  >
                    {item.concluido && <CheckSquare size={14} />}
                  </div>
                  <div className="flex flex-col">
                    <span className="font-sans text-[13px] font-semibold text-vapor-100">
                      {item.descricao}
                    </span>
                    {item.concluido_em && (
                      <span className="font-mono text-[11px] text-vapor-400">
                        Concluído às {formatarDataHora(item.concluido_em)}
                        {item.executor?.nome ? ` por ${item.executor.nome}` : ''}
                      </span>
                    )}
                  </div>
                </div>

                <span
                  className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded ${
                    item.concluido
                      ? 'bg-mint-500/10 text-mint-400 border border-mint-500/30'
                      : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                  }`}
                >
                  {item.concluido ? 'OK' : 'PENDENTE'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <span className="text-[13px] font-sans text-vapor-400 italic">
            Nenhuma etapa de checklist registrada para este serviço.
          </span>
        )}
      </Card>

      {/* BLOCO 4: PRODUTOS CONSUMIDOS DO ESTOQUE */}
      <Card className="p-4 flex flex-col gap-3 bg-graphite-900 border-graphite-700">
        <div className="flex items-center gap-2 border-b border-graphite-800 pb-2">
          <Package size={18} className="text-amber-400" />
          <h2 className="font-display text-[14px] font-bold text-vapor-100 uppercase tracking-wider">
            Insumos e Produtos Consumidos
          </h2>
        </div>

        {consumos.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {consumos.map((c) => (
              <div
                key={c.id}
                className="p-3 bg-graphite-800/80 rounded-lg border border-graphite-700 flex items-center justify-between"
              >
                <span className="font-sans text-[13px] font-medium text-vapor-200">
                  {c.produto?.nome || 'Produto'}
                </span>
                <span className="font-mono text-[13px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                  {c.quantidade} {c.produto?.unidade_uso || 'un'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <span className="text-[13px] font-sans text-vapor-400 italic">
            Nenhum insumo ou produto registrado neste atendimento.
          </span>
        )}
      </Card>

      {/* BLOCO 5: FOTOS E EVIDÊNCIAS (VISTORIA, EXECUÇÃO E SAÍDA) */}
      <Card className="p-4 flex flex-col gap-5 bg-graphite-900 border-graphite-700">
        <div className="flex items-center gap-2 border-b border-graphite-800 pb-2">
          <Camera size={18} className="text-amber-400" />
          <h2 className="font-display text-[14px] font-bold text-vapor-100 uppercase tracking-wider">
            Fotos e Evidências do Atendimento
          </h2>
        </div>

        {/* 5.1 Fotos de Vistoria de Entrada (Check-in) */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-sans text-mint-400 font-semibold flex items-center gap-1.5">
              <span>Vistoria de Entrada / Check-in ({fotos.vistoria.length})</span>
            </span>
            {checkinId && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => navigate(`/checkin/${checkinId}/ver`)}
                className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 h-7 px-2"
              >
                <ClipboardCheck size={14} />
                <span>Ver Vistoria Completa</span>
              </Button>
            )}
          </div>
          {fotos.vistoria.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {fotos.vistoria.map((f) => (
                <div key={f.id} className="flex flex-col gap-1">
                  <div
                    onClick={() => setFotoModal({ url: f.signedUrl, titulo: f.descricao || 'Foto da Vistoria', data: f.created_at })}
                    className="aspect-square rounded-lg bg-graphite-800 border border-mint-500/30 overflow-hidden relative group hover:border-mint-400 transition-colors cursor-pointer"
                  >
                    <img src={f.signedUrl} alt="Vistoria" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                    <div className="absolute inset-0 bg-graphite-950/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <Eye size={20} className="text-vapor-100" />
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        baixarFoto(
                          f.signedUrl,
                          `vistoria_${agendamento?.veiculo?.placa || 'foto'}_${f.id.slice(0, 8)}.jpg`
                        );
                      }}
                      className="absolute top-1.5 right-1.5 p-1.5 bg-graphite-950/80 hover:bg-amber-500 hover:text-graphite-950 text-vapor-200 rounded-md border border-graphite-700 opacity-0 group-hover:opacity-100 transition shadow"
                      title="Baixar Foto"
                    >
                      <Download size={13} />
                    </button>
                  </div>
                  {f.descricao && (
                    <span className="font-sans text-[11px] text-vapor-200 truncate" title={f.descricao}>
                      {f.descricao}
                    </span>
                  )}
                  {f.created_at && (
                    <span className="font-mono text-[10px] text-mint-400 font-medium px-0.5 truncate" title="Data do check-in">
                      Check-in: {formatarDataHora(f.created_at)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <span className="text-[12px] font-sans text-vapor-400 italic">
              {checkinId
                ? 'Nenhuma foto registrada na vistoria inicial.'
                : 'Você não realizou vistoria de entrada neste serviço.'}
            </span>
          )}
        </div>

        {/* 5.2 Fotos Durante o Serviço */}
        <div className="flex flex-col gap-2 pt-2 border-t border-graphite-800">
          <span className="text-[12px] font-sans text-vapor-300 font-semibold">
            Durante o Serviço ({fotos.durante.length})
          </span>
          {fotos.durante.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {fotos.durante.map((f) => (
                <div key={f.id} className="flex flex-col gap-1">
                  <div
                    onClick={() => setFotoModal({ url: f.signedUrl, titulo: 'Foto Durante o Serviço', data: f.created_at })}
                    className="aspect-square rounded-lg bg-graphite-800 border border-graphite-700 overflow-hidden relative group hover:border-amber-500 transition-colors cursor-pointer"
                  >
                    <img src={f.signedUrl} alt="Execução" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                    <div className="absolute inset-0 bg-graphite-950/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <Eye size={20} className="text-vapor-100" />
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        baixarFoto(
                          f.signedUrl,
                          `execucao_${agendamento?.veiculo?.placa || 'foto'}_${f.id.slice(0, 8)}.jpg`
                        );
                      }}
                      className="absolute top-1.5 right-1.5 p-1.5 bg-graphite-950/80 hover:bg-amber-500 hover:text-graphite-950 text-vapor-200 rounded-md border border-graphite-700 opacity-0 group-hover:opacity-100 transition shadow"
                      title="Baixar Foto"
                    >
                      <Download size={13} />
                    </button>
                  </div>
                  {f.created_at && (
                    <span className="font-mono text-[10px] text-amber-400 font-medium px-0.5 truncate" title="Data e hora imutável">
                      Upload: {formatarDataHora(f.created_at)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <span className="text-[12px] font-sans text-vapor-400 italic">Nenhuma foto registrada durante a execução.</span>
          )}
        </div>

        {/* 5.3 Fotos de Saída */}
        <div className="flex flex-col gap-2 pt-2 border-t border-graphite-800">
          <span className="text-[12px] font-sans text-vapor-300 font-semibold">
            Saída do Veículo ({fotos.saida.length})
          </span>
          {fotos.saida.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {fotos.saida.map((f) => (
                <div key={f.id} className="flex flex-col gap-1">
                  <div
                    onClick={() => setFotoModal({ url: f.signedUrl, titulo: 'Foto de Saída do Veículo', data: f.created_at })}
                    className="aspect-square rounded-lg bg-graphite-800 border border-graphite-700 overflow-hidden relative group hover:border-amber-500 transition-colors cursor-pointer"
                  >
                    <img src={f.signedUrl} alt="Saída" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                    <div className="absolute inset-0 bg-graphite-950/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <Eye size={20} className="text-vapor-100" />
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        baixarFoto(
                          f.signedUrl,
                          `saida_${agendamento?.veiculo?.placa || 'foto'}_${f.id.slice(0, 8)}.jpg`
                        );
                      }}
                      className="absolute top-1.5 right-1.5 p-1.5 bg-graphite-950/80 hover:bg-amber-500 hover:text-graphite-950 text-vapor-200 rounded-md border border-graphite-700 opacity-0 group-hover:opacity-100 transition shadow"
                      title="Baixar Foto"
                    >
                      <Download size={13} />
                    </button>
                  </div>
                  {f.created_at && (
                    <span className="font-mono text-[10px] text-amber-400 font-medium px-0.5 truncate" title="Data e hora imutável">
                      Upload: {formatarDataHora(f.created_at)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <span className="text-[12px] font-sans text-vapor-400 italic">Nenhuma foto de saída registrada.</span>
          )}
        </div>
      </Card>

      {/* BLOCO 6: REGISTRO FINANCEIRO (RESTRITO PARA DONO E GERENTE) */}
      {podeVerCusto ? (
        <Card className="p-4 flex flex-col gap-4 bg-graphite-900 border-amber-500/40">
          <div className="flex items-center justify-between border-b border-graphite-800 pb-2">
            <div className="flex items-center gap-2">
              <DollarSign size={18} className="text-amber-400" />
              <h2 className="font-display text-[14px] font-bold text-amber-400 uppercase tracking-wider">
                Detalhamento Financeiro (Gestão)
              </h2>
            </div>
            <span className="px-2 py-0.5 text-[10px] font-sans font-bold bg-graphite-800 text-vapor-400 rounded border border-graphite-700">
              RESTRITO
            </span>
          </div>

          <div className="flex flex-col gap-3">
            {/* Itens e Valores Finais */}
            <div className="flex flex-col gap-2">
              <span className="text-[12px] font-sans text-vapor-300 font-semibold">Valores por Item</span>
              {valores.length > 0 ? (
                valores.map((v) => (
                  <div key={v.id} className="p-3 bg-graphite-800/80 rounded-lg border border-graphite-700 flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="font-sans text-[13px] text-vapor-100 font-semibold">
                        {v.agendamento_item?.servico_nome || 'Serviço'}
                      </span>
                      <div className="flex items-center gap-2">
                        {v.valor_estimado !== v.valor_final && (
                          <span className="font-mono text-[12px] text-vapor-400 line-through">
                            {formatarMoeda(Number(v.valor_estimado))}
                          </span>
                        )}
                        <span className="font-mono text-[14px] font-bold text-amber-400">
                          {formatarMoeda(Number(v.valor_final))}
                        </span>
                      </div>
                    </div>
                    {v.motivo && (
                      <span className="text-[11px] font-sans text-vapor-400 italic">
                        Motivo: {v.motivo}
                      </span>
                    )}
                  </div>
                ))
              ) : (
                <div className="p-3 bg-graphite-800/80 rounded-lg border border-graphite-700 flex items-center justify-between">
                  <span className="font-sans text-[13px] text-vapor-300">Valor Total do Serviço</span>
                  <span className="font-mono text-[16px] font-bold text-amber-400">
                    {execucao?.valor_total_final !== null && execucao?.valor_total_final !== undefined
                      ? formatarMoeda(Number(execucao.valor_total_final))
                      : 'A definir'}
                  </span>
                </div>
              )}
            </div>

            {/* Resumo Consolidado de Custos, Estrutura e Lucro Líquido */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-graphite-800">
              <div className="p-3 bg-graphite-800/80 rounded border border-graphite-700 flex flex-col gap-1">
                <span className="text-[11px] text-vapor-400 font-sans">Valor Faturado</span>
                <span className="font-mono text-[16px] font-bold text-amber-400">
                  {execucao?.valor_total_final !== null && execucao?.valor_total_final !== undefined
                    ? formatarMoeda(Number(execucao.valor_total_final))
                    : formatarMoeda(0)}
                </span>
              </div>

              <div className="p-3 bg-graphite-800/80 rounded border border-graphite-700 flex flex-col gap-1">
                <span className="text-[11px] text-vapor-400 font-sans">Custo de Produtos</span>
                <span className="font-mono text-[14px] font-semibold text-flare-300">
                  − {formatarMoeda(Number(execucao?.custo_produtos || 0))}
                </span>
              </div>

              <div className="p-3 bg-graphite-800/80 rounded border border-graphite-700 flex flex-col justify-between gap-1">
                <span className="text-[11px] text-vapor-400 font-sans">Custo de Estrutura</span>
                {execucao?.custo_estrutura && Number(execucao.custo_estrutura) > 0 ? (
                  <span className="font-mono text-[14px] font-semibold text-amber-400">
                    − {formatarMoeda(Number(execucao.custo_estrutura))}
                  </span>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-sans text-vapor-400 font-medium">
                      não calculado
                    </span>
                    <span className="text-[10px] text-vapor-500 font-sans leading-tight">
                      Cadastre suas despesas fixas para ver o lucro real
                    </span>
                  </div>
                )}
              </div>

              <div className="p-3 bg-graphite-800/80 rounded border border-graphite-700 flex flex-col gap-1">
                <span className="text-[11px] text-vapor-400 font-sans font-bold">Lucro Líquido Real</span>
                <span className={`font-mono text-[16px] font-bold ${Number(execucao?.lucro_liquido || 0) >= 0 ? 'text-mint-400' : 'text-flare-400'}`}>
                  {execucao?.lucro_liquido !== null && execucao?.lucro_liquido !== undefined
                    ? formatarMoeda(Number(execucao.lucro_liquido))
                    : '—'}
                </span>
              </div>
            </div>

            {/* Alerta de Tempo Não Registrado */}
            {segundosTrabalhados === 0 && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center gap-2 text-amber-500 text-[13px] font-sans font-medium mt-1">
                <AlertTriangle size={18} className="shrink-0" />
                <span>Custo de estrutura não calculado: este atendimento não tem tempo registrado.</span>
              </div>
            )}
          </div>
        </Card>
      ) : (
        <div className="p-3.5 bg-graphite-900 border border-graphite-800 rounded-lg flex items-center justify-between text-vapor-400 text-[12px] font-sans">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-mint-400" />
            <span>Valores financeiros visíveis apenas para perfil de Gestão (Dono / Gerente).</span>
          </div>
        </div>
      )}

      {/* Modal Lightbox de Foto */}
      {fotoModal && (
        <div 
          className="fixed inset-0 z-50 bg-graphite-950/90 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setFotoModal(null)}
        >
          <div 
            className="relative max-w-3xl w-full bg-graphite-900 border border-graphite-700 rounded-xl overflow-hidden shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-3 border-b border-graphite-800 flex items-center justify-between bg-graphite-950/50">
              <div className="flex flex-col">
                <span className="font-sans text-[13px] font-bold text-vapor-100">{fotoModal.titulo}</span>
                {fotoModal.data && (
                  <span className="font-mono text-[11px] text-vapor-400">{formatarDataHora(fotoModal.data)}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    baixarFoto(
                      fotoModal.url,
                      `foto_${agendamento?.veiculo?.placa ? agendamento.veiculo.placa + '_' : ''}${fotoModal.titulo || 'foto'}.jpg`
                    )
                  }
                  className="h-8 px-3 text-xs flex items-center gap-1.5 text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                  title="Baixar foto no computador"
                >
                  <Download size={13} />
                  <span>Baixar Foto</span>
                </Button>
                <button
                  type="button"
                  onClick={() => setFotoModal(null)}
                  className="p-1.5 text-vapor-400 hover:text-vapor-100 hover:bg-graphite-800 rounded-lg transition"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            <div className="p-2 flex items-center justify-center bg-black/50 max-h-[75vh] overflow-auto">
              <img src={fotoModal.url} alt={fotoModal.titulo} className="max-w-full max-h-[70vh] object-contain rounded" />
            </div>
          </div>
        </div>
      )}

      {/* Modal Aviso Vistoria Não Realizada */}
      {modalAvisoSemVistoriaOpen && (
        <Modal
          isOpen={modalAvisoSemVistoriaOpen}
          onClose={() => setModalAvisoSemVistoriaOpen(false)}
          title="Vistoria de Entrada Não Realizada"
          maxWidth="sm"
        >
          <div className="flex flex-col gap-4 text-sm font-sans text-vapor-200 p-1">
            <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-3 text-amber-300">
              <AlertCircle size={22} className="shrink-0 text-amber-400 mt-0.5" />
              <div className="flex flex-col gap-1">
                <span className="font-bold text-vapor-100">Nenhuma vistoria registrada</span>
                <span className="text-xs text-vapor-300 leading-relaxed">
                  Você não realizou vistoria de entrada neste serviço. Este atendimento foi iniciado diretamente sem checklist de entrada ou a vistoria foi dispensada no momento da entrada.
                </span>
              </div>
            </div>
            <div className="flex justify-end pt-1">
              <Button
                type="button"
                variant="primary"
                onClick={() => setModalAvisoSemVistoriaOpen(false)}
                className="w-full sm:w-auto"
              >
                Entendido
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
