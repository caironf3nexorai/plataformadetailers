import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { CanvasAssinatura } from '../components/checkin/CanvasAssinatura';
import { Modal } from '../components/ui/Modal';
import {
  ShieldCheck,
  Clock,
  Check,
  Star,
  AlertTriangle,
  CheckCircle2,
  Phone,
  Calendar as CalendarIcon,
  Sparkles,
  PenTool,
  RefreshCw,
  Tag,
  FileText,
  Copy
} from 'lucide-react';
import type { OrcamentoPublicoData, TipoNivelOrcamento } from '../types/orcamento';
import { SeletorHorarioPublico, type ItemAgendamentoPublico, type SlotHorarioPublico } from '../components/publico/SeletorHorarioPublico';
import { formatarData, formatarDataHora, montarTimestampLocal } from '../utils/datas';
import { formatarInformacaoTransbordo } from '../utils/transbordoUtils';
import { formatarMoeda, formatarCodigoProposta } from '../utils/formatters';
import { getFotoPublicUrl } from '../utils/imagens';
import { gerarPDFOrcamento, type PDFOrcamentoNivelData } from '../utils/pdfOrcamento';
import { gerarQrCodeUrl } from '../utils/qrCodeSvg';

export const OrcamentoPublico: React.FC = () => {
  const { token } = useParams<{ token: string }>();

  const [data, setData] = useState<OrcamentoPublicoData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [responding, setResponding] = useState<boolean>(false);
  const [escolhaSucesso, setEscolhaSucesso] = useState<string | null>(null);

  // Estados do Agendamento Online
  const [dataSelecionada, setDataSelecionada] = useState<string>('');
  const [horarioSelecionado, setHorarioSelecionado] = useState<string>('');
  const [slotSelecionadoObj, setSlotSelecionadoObj] = useState<SlotHorarioPublico | null>(null);
  const [transbordoAceito, setTransbordoAceito] = useState<boolean>(false);
  const [agendando, setAgendando] = useState<boolean>(false);
  const [erroAgendamento, setErroAgendamento] = useState<string | null>(null);
  const [copiadoPix, setCopiadoPix] = useState<boolean>(false);

  // Reseta aceite do pernoite ao mudar data ou horario
  useEffect(() => {
    setTransbordoAceito(false);
  }, [dataSelecionada, horarioSelecionado]);

  const timestampInicioCalc = dataSelecionada && horarioSelecionado ? montarTimestampLocal(dataSelecionada, horarioSelecionado) : '';
  const infoTransbordoSelecionado = slotSelecionadoObj?.termino_previsto
    ? formatarInformacaoTransbordo(timestampInicioCalc, slotSelecionadoObj.termino_previsto)
    : null;
  const isTransbordoSlot = !!infoTransbordoSelecionado;

  // Estados de Assinatura Digital no Aceite
  const [showModalAceiteAssinatura, setShowModalAceiteAssinatura] = useState<boolean>(false);
  const [nivelPendenteAceite, setNivelPendenteAceite] = useState<TipoNivelOrcamento | null>(null);
  const [gerandoPDF, setGerandoPDF] = useState<boolean>(false);

  // Estados de Assinatura Digital de Alteração
  const [nomeAssinante, setNomeAssinante] = useState<string>('');
  const [assinando, setAssinando] = useState<boolean>(false);

  // Helper para sanitização e validação de token UUID
  const sanitizeToken = (t?: string): string => (t ?? '').trim();
  const isUuid = (t: string): boolean =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t);

  const fetchOrcamentoPublico = async () => {
    const tokenLimpo = sanitizeToken(token);
    if (!tokenLimpo || !isUuid(tokenLimpo)) {
      console.log('[OrcamentoPublico] token inválido ou ausente:', JSON.stringify(token), 'tipo:', typeof token);
      setLoading(false);
      return;
    }
    if (!data) {
      setLoading(true);
    }

    try {
      console.log('token:', JSON.stringify(tokenLimpo), 'tipo:', typeof tokenLimpo);
      const { data: resData, error } = await supabase.rpc('orcamento_publico', {
        p_token: tokenLimpo,
      });

      if (error) throw error;
      if (resData) {
        const parsed = resData as OrcamentoPublicoData;
        setData(parsed);
        if (parsed.status === 'aprovado' && parsed.nivel_aprovado) {
          setEscolhaSucesso(parsed.nivel_aprovado);
        }
        if (parsed.cliente_primeiro_nome && !nomeAssinante) {
          setNomeAssinante(parsed.cliente_primeiro_nome);
        }
      }
    } catch (err: any) {
      console.error('[OrcamentoPublico] Erro ao carregar orçamento:', err?.message || err, err?.details, err?.hint || '');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrcamentoPublico();
  }, [token]);

  // Inicia ou recusa a resposta do orçamento
  const handleResponder = async (nivel: TipoNivelOrcamento, aceite: boolean) => {
    const tokenLimpo = sanitizeToken(token);
    if (!tokenLimpo || !isUuid(tokenLimpo) || responding) return;

    if (aceite) {
      // Abre modal para coletar assinatura e nome antes de aprovar
      setNivelPendenteAceite(nivel);
      setShowModalAceiteAssinatura(true);
      return;
    }

    // Se recusou, envia recusa direta
    setResponding(true);
    try {
      const { error } = await supabase.rpc('responder_orcamento', {
        p_token: tokenLimpo,
        p_nivel: nivel,
        p_aceite: false,
      });
      if (error) throw error;
      await fetchOrcamentoPublico();
    } catch (err: any) {
      console.error('[OrcamentoPublico] Erro ao recusar orçamento:', err);
      setErroAgendamento(err.message || 'Erro ao processar recusa. Tente novamente.');
    } finally {
      setResponding(false);
    }
  };

  // Confirmação com Assinatura Digital do Aceite do Orçamento
  const handleConfirmarAceiteComAssinatura = async (blob: Blob) => {
    const tokenLimpo = sanitizeToken(token);
    if (!tokenLimpo || !isUuid(tokenLimpo) || !nivelPendenteAceite) return;
    setResponding(true);

    try {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        const base64data = reader.result as string;
        const { error } = await supabase.rpc('responder_orcamento', {
          p_token: tokenLimpo,
          p_nivel: nivelPendenteAceite,
          p_aceite: true,
          p_assinatura_base64: base64data,
          p_nome_assinante: nomeAssinante || data?.cliente_primeiro_nome || 'Cliente',
        });

        if (error) throw error;

        // Se o cliente já tinha selecionado data e horário no calendário, conclui o agendamento imediatamente
        if (dataSelecionada && horarioSelecionado) {
          if (isTransbordoSlot && !transbordoAceito) {
            setErroAgendamento('Você precisa aceitar os termos de permanência do veículo para continuar.');
            return;
          }
          const inicioIso = montarTimestampLocal(dataSelecionada, horarioSelecionado);
          await supabase.rpc('agendar_orcamento_publico', {
            p_token: tokenLimpo,
            p_inicio: inicioIso,
            p_transbordo_aceito: isTransbordoSlot ? transbordoAceito : false,
            p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
            p_ip: null,
          });
        }

        setEscolhaSucesso(nivelPendenteAceite);
        setShowModalAceiteAssinatura(false);
        setNivelPendenteAceite(null);
        await fetchOrcamentoPublico();
      };
    } catch (err: any) {
      console.error('[OrcamentoPublico] Erro ao confirmar aceite com assinatura:', err);
      setErroAgendamento(err.message || 'Erro ao confirmar aceite. Tente novamente.');
    } finally {
      setResponding(false);
    }
  };

  // Gerar PDF do Orçamento
  const handleGerarPDF = async () => {
    if (!data) return;
    setGerandoPDF(true);
    try {
      const niveisFormatados: PDFOrcamentoNivelData[] = (data.niveis || []).map((n) => ({
        nivel: n.nivel,
        titulo: n.titulo,
        descricao: n.descricao,
        valor_total: n.valor_total,
        valor_original: n.valor_original,
        duracao_total: n.duracao_total,
        destaque: n.destaque,
        itens: (n.itens || []).map((i: any) => ({
          servico_nome: i.servico_nome || 'Serviço',
          servico_descricao: i.servico_descricao,
          preco: i.preco !== undefined && i.preco !== null ? Number(i.preco) : 0,
          duracao_minutos: i.duracao_minutos,
        })),
      }));

      await gerarPDFOrcamento({
        id: String(data.numero || 'orcamento'),
        numero: data.numero,
        numero_os: data.numero_os,
        status: data.status,
        nivel_aprovado: data.nivel_aprovado,
        enviado_em: data.enviado_em,
        validade_dias: data.validade_dias,
        data_validade_limite: data.data_validade_limite,
        observacoes: data.observacoes,
        clienteNome: data.cliente_primeiro_nome || 'Cliente',
        clienteTelefone: data.cliente_telefone,
        veiculoModelo: data.veiculo?.modelo,
        veiculoPlaca: data.veiculo?.placa,
        veiculoCor: data.veiculo?.cor || null,
        oficinaNome: data.oficina?.nome || 'Oficina',
        oficinaRazaoSocial: data.oficina?.razao_social,
        oficinaDocumento: data.oficina?.documento,
        oficinaDocumentoTipo: data.oficina?.documento_tipo as any,
        oficinaTelefone: data.oficina?.telefone,
        oficinaCidadeUF: data.oficina?.cidade ? `${data.oficina.cidade}/${data.oficina.uf || ''}` : undefined,
        oficinaLogoUrl: getFotoPublicUrl(data.oficina?.logo_path) || data.oficina?.logo_url,
        assinaturaUrl: data.assinatura_url,
        assinaturaNome: data.assinatura_nome,
        assinaturaData: data.assinatura_data,
        desconto: data.desconto,
        niveis: niveisFormatados,
        planoCodigo: (data.oficina as any)?.plano || undefined,
        pdfCorPrimaria: (data.oficina as any)?.pdf_cor_primaria || undefined,
        pdfCorFundoCabecalho: (data.oficina as any)?.pdf_cor_fundo_cabecalho || undefined,
        pdfCorTextoCabecalho: (data.oficina as any)?.pdf_cor_texto_cabecalho || undefined,
        pdfCorFundoSecoes: (data.oficina as any)?.pdf_cor_fundo_secoes || undefined,
        pdfCorTextoSecoes: (data.oficina as any)?.pdf_cor_texto_secoes || undefined,
        pdfSubtituloCabecalho: (data.oficina as any)?.pdf_subtitulo_cabecalho || undefined,
        pdfTextoObservacoesOrcamento: data.oficina?.pdf_texto_observacoes_orcamento || undefined,
        pdfTextoRodape: (data.oficina as any)?.pdf_texto_rodape || undefined,
        pdfOcultarMarcaDagua: (data.oficina as any)?.pdf_ocultar_marca_dagua ?? undefined,
      });
    } catch (err: any) {
      console.error('[OrcamentoPublico] Erro ao gerar PDF:', err);
    } finally {
      setGerandoPDF(false);
    }
  };

  // Executa o agendamento final pelo cliente
  const handleConfirmarAgendamento = async () => {
    const tokenLimpo = sanitizeToken(token);
    if (!tokenLimpo || !isUuid(tokenLimpo) || !dataSelecionada || !horarioSelecionado || agendando) return;

    if (isTransbordoSlot && !transbordoAceito) {
      setErroAgendamento('Você precisa aceitar os termos de permanência do veículo na oficina para continuar.');
      return;
    }

    // Se o orçamento ainda não possui assinatura registrada no banco, exige a assinatura primeiro!
    if (!data?.assinatura_url) {
      setNivelPendenteAceite(data?.nivel_aprovado || 'recomendado');
      setShowModalAceiteAssinatura(true);
      return;
    }

    setAgendando(true);
    setErroAgendamento(null);

    try {
      const inicioIso = montarTimestampLocal(dataSelecionada, horarioSelecionado);

      const { error } = await supabase.rpc('agendar_orcamento_publico', {
        p_token: tokenLimpo,
        p_inicio: inicioIso,
        p_transbordo_aceito: isTransbordoSlot ? transbordoAceito : false,
        p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        p_ip: null,
      });

      if (error) throw error;

      await fetchOrcamentoPublico();
    } catch (err: any) {
      console.error('[OrcamentoPublico] Erro ao agendar horário:', err);
      setErroAgendamento(err.message || 'Não foi possível concluir o agendamento. Escolha outro horário.');
    } finally {
      setAgendando(false);
    }
  };

  const handleCopiarPix = (pixPayload?: string) => {
    if (!pixPayload) return;
    navigator.clipboard.writeText(pixPayload);
    setCopiadoPix(true);
    setTimeout(() => setCopiadoPix(false), 3000);
  };

  // Executa a confirmação por assinatura digital de alteração do orçamento
  const handleSalvarAssinaturaAlteracao = async (blob: Blob) => {
    const tokenLimpo = sanitizeToken(token);
    if (!tokenLimpo || !isUuid(tokenLimpo)) return;
    setAssinando(true);

    try {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        const base64data = reader.result as string;
        console.log('token:', JSON.stringify(tokenLimpo), 'tipo:', typeof tokenLimpo);
        const { error } = await supabase.rpc('confirmar_alteracao_orcamento', {
          p_token: tokenLimpo,
          p_assinatura_base64: base64data,
          p_nome_assinante: nomeAssinante || data?.cliente_primeiro_nome || 'Cliente',
        });

        if (error) throw error;
        await fetchOrcamentoPublico();
      };
    } catch (err: any) {
      console.error('[OrcamentoPublico] Erro ao assinar alteração:', err);
      setErroAgendamento('Erro ao confirmar assinatura: ' + (err.message || 'Tente novamente.'));
    } finally {
      setAssinando(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-graphite-950 text-vapor-100 flex flex-col items-center justify-center p-4">
        <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="font-sans text-[14px] text-vapor-300">Carregando proposta...</p>
      </div>
    );
  }

  if (!data || data.erro) {
    return (
      <div className="min-h-screen bg-graphite-950 text-vapor-100 flex flex-col items-center justify-center p-4">
        <Card className="p-6 max-w-md w-full bg-graphite-900 border-graphite-800 text-center flex flex-col items-center gap-4">
          <AlertTriangle size={48} className="text-amber-500" />
          <h2 className="font-display text-[20px] uppercase tracking-wide text-vapor-100">
            Orçamento não encontrado
          </h2>
          <p className="font-sans text-[14px] text-vapor-400">
            O link pode ter expirado ou estar incorreto. Verifique o endereço recebido com a oficina.
          </p>
        </Card>
      </div>
    );
  }

  const isExpirado = data.status === 'expirado';
  const isAprovado = data.status === 'aprovado' || escolhaSucesso !== null;
  const isRecusado = data.status === 'recusado' && !isAprovado;
  const isAgendado = !!data.agendamento;

  // Permite responder OU TROCAR de pacote enquanto o agendamento NÃO estiver finalizado
  const podeTrocarOuResponder = !isExpirado && !isRecusado && !isAgendado;

  const logoUrlResolved = getFotoPublicUrl(data.oficina?.logo_path) || data.oficina?.logo_url;

  // Busca dados do nível aprovado
  const nivelAprovadoObj = (data.niveis || []).find(
    (n) => n.nivel === (data.nivel_aprovado || escolhaSucesso)
  );

  return (
    <div className="min-h-screen bg-graphite-950 text-vapor-100 flex flex-col items-center pb-16 px-4 pt-6 max-w-full overflow-x-hidden">
      <div className="max-w-4xl w-full flex flex-col gap-6">
        {/* CABEÇALHO DA OFICINA */}
        <div className="bg-graphite-900 border border-graphite-800 rounded-2xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl">
          <div className="flex items-center gap-3.5">
            {logoUrlResolved ? (
              <img
                src={logoUrlResolved}
                alt={data.oficina.nome}
                className="w-14 h-14 rounded-xl object-cover border border-graphite-700 shrink-0"
              />
            ) : (
              <div className="w-14 h-14 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center justify-center text-amber-400 font-display text-[22px] font-bold shrink-0">
                {data.oficina.nome.substring(0, 2).toUpperCase()}
              </div>
            )}

            <div className="flex flex-col text-center sm:text-left">
              <h1 className="font-display text-[20px] sm:text-[24px] uppercase tracking-wide text-vapor-100">
                {data.oficina.nome}
              </h1>
              <span className="font-sans text-[13px] text-vapor-400 flex items-center justify-center sm:justify-start gap-1.5">
                <ShieldCheck size={14} className="text-emerald-400" />
                Estúdio Especializado de Detalhamento
                {data.oficina.cidade && ` • ${data.oficina.cidade}/${data.oficina.uf}`}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-center sm:justify-end">
            <Button
              tone="graphite"
              size="sm"
              onClick={handleGerarPDF}
              loading={gerandoPDF}
              className="flex items-center gap-2 min-h-[48px] px-4 rounded-xl"
            >
              <FileText size={16} className="text-amber-400" />
              <span>Baixar PDF</span>
            </Button>

            {data.oficina.telefone && (
              <a
                href={`https://api.whatsapp.com/send?phone=55${data.oficina.telefone.replace(/\D/g, '')}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 bg-graphite-800 hover:bg-graphite-700 text-vapor-200 border border-graphite-700 px-4 py-2.5 rounded-xl font-sans text-[13px] transition-colors min-h-[48px]"
              >
                <Phone size={15} className="text-emerald-400" />
                <span>Falar com a oficina</span>
              </a>
            )}
          </div>
        </div>

        {/* SAUDAÇÃO E INFORMAÇÕES DO VEÍCULO */}
        <div className="flex flex-col gap-2 text-center sm:text-left">
          <h2 className="font-display text-[24px] sm:text-[30px] uppercase tracking-wide text-vapor-100">
            Olá, <span className="text-amber-400">{data.cliente_primeiro_nome}</span>!
          </h2>
          <p className="font-sans text-[15px] text-vapor-300">
            Preparamos três opções exclusivas para o seu{' '}
            <strong className="text-vapor-100">
              {data.veiculo ? `${data.veiculo.modelo || 'veículo'} (${data.veiculo.placa})${data.veiculo.cor ? ` • Cor: ${data.veiculo.cor}` : ''}` : 'veículo'}
            </strong>.
          </p>

          {/* BADGES DE STATUS / VALIDADE / CÓDIGO DA PROPOSTA / DESCONTO */}
          <div className="flex items-center gap-3 justify-center sm:justify-start mt-1 flex-wrap">
            <span className={`font-mono text-[12px] font-bold px-3 py-1 rounded-lg border ${data.numero_os ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30' : 'bg-amber-500/10 text-amber-400 border-amber-500/30'}`}>
              {formatarCodigoProposta(data)}
            </span>

            {data.data_validade_limite && (
              <span className="font-mono text-[12px] text-vapor-400 bg-graphite-900 border border-graphite-800 px-3 py-1 rounded-lg flex items-center gap-1.5">
                <CalendarIcon size={13} className="text-amber-500" />
                Válido até {formatarData(data.data_validade_limite)}
              </span>
            )}

            {data.desconto && (
              <span className="font-mono text-[12px] text-amber-300 bg-amber-500/10 border border-amber-500/30 px-3 py-1 rounded-lg flex items-center gap-1.5 font-bold">
                <Tag size={13} className="text-amber-400 shrink-0" />
                Desconto Concedido:{' '}
                {data.desconto.tipo === 'porcentagem'
                  ? `${data.desconto.valor}% OFF`
                  : formatarMoeda(data.desconto.valor)}
                {data.desconto.cupom_codigo && ` (${data.desconto.cupom_codigo})`}
              </span>
            )}

            {isExpirado && (
              <Badge tone="rose">Proposta Expirada</Badge>
            )}

            {isAprovado && !isAgendado && (
              <Badge tone="emerald">Opção Selecionada (Pendente de Agendamento)</Badge>
            )}

            {isAgendado && (
              <Badge tone="emerald">Agendamento Confirmado</Badge>
            )}
          </div>
        </div>

        {/* SEÇÃO DE CONFIRMAÇÃO DE ALTERAÇÃO DO ORÇAMENTO PELA OFICINA (COM ASSINATURA DIGITAL) */}
        {data.alteracao_pendente && (
          <Card className="p-6 bg-graphite-900 border-2 border-amber-500 rounded-2xl flex flex-col gap-6 shadow-2xl">
            <div className="flex flex-col gap-1 border-b border-graphite-800 pb-4">
              <div className="flex items-center gap-2 text-amber-400 font-mono text-[12px] uppercase font-bold tracking-wider">
                <PenTool size={16} />
                <span>Assinatura Digital Solicitada</span>
              </div>
              <h3 className="font-display text-[22px] text-vapor-100 uppercase tracking-wide">
                Confirmação de Atualização de Orçamento
              </h3>
              <p className="font-sans text-[14px] text-vapor-300">
                A oficina realizou uma atualização nos serviços ou valores deste orçamento. Por favor, revise as informações abaixo e faça sua assinatura digital para validar o novo acordo.
              </p>
            </div>

            {/* DETALHES DA ALTERAÇÃO */}
            {data.alteracao_historico && data.alteracao_historico.length > 0 && (
              <div className="bg-graphite-950 p-4 rounded-xl border border-graphite-800 flex flex-col gap-3">
                <span className="font-mono text-[11px] text-vapor-400 uppercase tracking-wider font-bold">
                  Resumo da Atualização:
                </span>
                {data.alteracao_historico.slice(-1).map((hist, idx) => (
                  <div key={idx} className="flex flex-col gap-1 font-sans text-[14px]">
                    <div className="flex items-center justify-between">
                      <span className="text-vapor-200 font-bold">{hist.titulo_nivel}</span>
                      <span className="font-mono text-amber-400 font-bold text-[16px]">
                        {formatarMoeda(hist.valor_total)}
                      </span>
                    </div>
                    {hist.motivo && (
                      <p className="text-[13px] text-vapor-400 italic bg-graphite-900/60 p-2.5 rounded-lg border border-graphite-800 mt-1">
                        "{hist.motivo}"
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* FORMULÁRIO DE ASSINATURA DIGITAL */}
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="font-sans text-[13px] font-bold text-vapor-200">
                  Nome Completo do Assinante: <span className="text-amber-400">*</span>
                </label>
                <input
                  type="text"
                  value={nomeAssinante}
                  onChange={(e) => setNomeAssinante(e.target.value)}
                  placeholder="Digite seu nome completo"
                  className="w-full bg-graphite-950 border border-graphite-700 rounded-xl px-4 py-3 text-vapor-100 font-sans text-[14px] focus:outline-none focus:border-amber-500 min-h-[48px]"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-sans text-[13px] font-bold text-vapor-200 flex items-center gap-1.5">
                  <PenTool size={14} className="text-amber-400" />
                  <span>Desenhe sua assinatura digital na caixa abaixo:</span>
                </label>
                <CanvasAssinatura
                  onSaveSignature={handleSalvarAssinaturaAlteracao}
                  disabled={assinando}
                />
              </div>
            </div>
          </Card>
        )}

        {/* MENSAGEM DE AGENDAMENTO CONCLUÍDO E SINAL PIX */}
        {isAprovado && data.agendamento && (
          <Card className="p-6 bg-graphite-900 border-2 border-emerald-500/50 rounded-2xl flex flex-col items-center text-center gap-4 shadow-2xl">
            <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center justify-center text-emerald-400">
              <CheckCircle2 size={36} />
            </div>

            <div className="space-y-1">
              <h3 className="font-display text-[22px] text-vapor-100 uppercase tracking-wide">
                {data.agendamento.sinal?.ativo && (data.agendamento.sinal.valor || 0) > 0 && data.agendamento.status === 'aguardando_confirmacao'
                  ? 'Agendamento Solicitado - Aguardando Sinal'
                  : 'Agendamento Confirmado!'}
              </h3>
              <p className="font-sans text-[14px] text-vapor-300">
                OS <strong className="text-amber-400 font-mono">#{data.agendamento.numero_os}</strong> · {data.oficina.nome}
              </p>
            </div>

            <div className="w-full bg-graphite-950 p-4 rounded-xl border border-graphite-800 text-left space-y-2 font-sans text-[13px] text-vapor-300">
              <div className="flex justify-between">
                <span className="text-vapor-400">Data & Horário:</span>
                <span className="text-amber-400 font-bold font-mono">{formatarDataHora(data.agendamento.inicio)}</span>
              </div>
              {data.agendamento.previsao_entrega && (
                <div className="flex justify-between">
                  <span className="text-vapor-400">Previsão de Término/Entrega:</span>
                  <span className="text-emerald-400 font-bold font-mono">{formatarDataHora(data.agendamento.previsao_entrega)}</span>
                </div>
              )}
              {data.agendamento.preco_estimado_total ? (
                <div className="flex justify-between border-t border-graphite-800/80 pt-2 font-bold text-vapor-100">
                  <span>Valor Total da Proposta:</span>
                  <span className="text-amber-400">{formatarMoeda(data.agendamento.preco_estimado_total)}</span>
                </div>
              ) : null}
            </div>

            {/* BLOCO DE COBRANÇA DE SINAL PIX */}
            {data.agendamento.sinal?.ativo && (data.agendamento.sinal.valor || 0) > 0 ? (
              <div className="w-full bg-amber-500/10 border border-amber-500/30 p-4 rounded-xl text-left space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-amber-400 text-[14px]">Sinal Solicitado para Confirmar a Vaga:</span>
                  <span className="font-mono text-[18px] font-extrabold text-amber-400">
                    {formatarMoeda(data.agendamento.sinal.valor)}
                  </span>
                </div>

                {data.agendamento.sinal.pix_payload ? (
                  <div className="bg-graphite-950 p-4 rounded-xl border border-graphite-800 text-center space-y-3">
                    <p className="text-[13px] text-vapor-200 font-medium">Escaneie o QR Code abaixo ou copie a chave Pix Copia e Cola:</p>
                    
                    <img 
                      src={gerarQrCodeUrl(data.agendamento.sinal.pix_payload)} 
                      alt="QR Code Pix Sinal" 
                      className="w-44 h-44 mx-auto rounded-lg bg-white p-2 border border-graphite-700 shadow-md" 
                    />

                    <Button
                      tone="amber"
                      size="md"
                      onClick={() => handleCopiarPix(data.agendamento?.sinal?.pix_payload || undefined)}
                      className="w-full flex items-center justify-center gap-2 font-bold min-h-[44px]"
                    >
                      {copiadoPix ? <Check size={16} /> : <Copy size={16} />}
                      <span>{copiadoPix ? 'Código Pix Copiado!' : 'Copiar Código Pix (Copia e Cola)'}</span>
                    </Button>
                  </div>
                ) : (
                  <div className="p-3 bg-graphite-950 rounded-xl border border-amber-500/20 text-center text-[13px] text-amber-300">
                    Solicite a chave Pix da oficina ou envie o comprovante diretamente pelo WhatsApp abaixo para garantir sua vaga.
                  </div>
                )}

                <p className="text-[12px] text-vapor-400 leading-relaxed">
                  <strong>Importante:</strong> Após efetuar o pagamento, envie o comprovante no botão abaixo para que nossa equipe valide a sua reserva.
                </p>
              </div>
            ) : null}

            {/* BOTÃO WHATSAPP DE CONTATO / ENVIO DE COMPROVANTE */}
            <a
              href={`https://wa.me/${data.oficina.telefone?.replace(/\D/g, '')}?text=${encodeURIComponent(
                `Olá! Efetuei o agendamento da proposta (OS #${data.agendamento.numero_os}) para ${formatarDataHora(data.agendamento.inicio)}.`
              )}`}
              target="_blank"
              rel="noreferrer"
              className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-400 text-graphite-950 font-bold rounded-xl flex items-center justify-center gap-2 transition shadow-lg text-[15px] min-h-[48px]"
            >
              <Phone size={18} /> Enviar Comprovante no WhatsApp
            </a>
          </Card>
        )}

        {/* MENSAGEM DE EXPIRAÇÃO */}
        {isExpirado && (
          <Card className="p-5 bg-rose-500/10 border-rose-500/30 flex items-center gap-3 text-rose-300 font-sans text-[14px]">
            <AlertTriangle size={24} className="shrink-0 text-rose-400" />
            <span>
              Esta proposta atingiu a data limite de validade. Entre em contato com a oficina para solicitar a atualização das opções.
            </span>
          </Card>
        )}

        {/* BANNER DE INFORMAÇÃO QUANDO O CLIENTE JÁ ESCOLHEU UM PACOTE MAS AINDA NÃO AGENDOU */}
        {isAprovado && !isAgendado && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-center justify-between gap-3 text-amber-300 font-sans text-[13.5px]">
            <div className="flex items-center gap-2.5">
              <Sparkles size={18} className="text-amber-400 shrink-0" />
              <span>
                Você escolheu o pacote <strong className="text-vapor-100 uppercase">{nivelAprovadoObj?.titulo}</strong>. Escolha a data e horário abaixo para agendar, ou selecione outro pacote nos cards se desejar alterar sua escolha.
              </span>
            </div>
          </div>
        )}

        {/* OS TRÊS CARDS DE NÍVEL LADO A LADO COM SUPORTE A TROCA DE ESCOLHA */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
          {(data.niveis || []).map((n) => {
            const isDestaque = n.destaque;
            const isEstaAprovada = isAprovado && (data.nivel_aprovado === n.nivel || escolhaSucesso === n.nivel);

            // Definição da ordem mobile (< 768px): Recomendado primeiro (order-1), Essencial (order-2), Completo (order-3)
            let orderClass = 'order-3 md:order-3';
            if (n.nivel === 'recomendado') orderClass = 'order-1 md:order-2';
            if (n.nivel === 'essencial') orderClass = 'order-2 md:order-1';

            return (
              <Card
                key={n.nivel}
                className={`p-6 pt-7 flex flex-col justify-between gap-6 relative transition-all overflow-visible ${orderClass} ${isEstaAprovada
                    ? 'bg-emerald-950/30 border-2 border-emerald-500 shadow-2xl'
                    : isDestaque
                      ? 'bg-graphite-900 border-2 border-amber-500 shadow-2xl shadow-amber-500/10 md:-translate-y-2'
                      : 'bg-graphite-900 border-graphite-800'
                  }`}
              >
                {/* BADGES DE DESTAQUE COM OVERFLOW-VISIBLE */}
                {isDestaque && !isEstaAprovada && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-amber-500 text-graphite-950 font-mono text-[11px] font-bold uppercase tracking-widest px-3.5 py-1 rounded-full flex items-center gap-1.5 shadow-lg z-10 whitespace-nowrap">
                    <Star size={13} fill="currentColor" />
                    <span>Mais Escolhido</span>
                  </div>
                )}

                {isEstaAprovada && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-emerald-500 text-graphite-950 font-mono text-[11px] font-bold uppercase tracking-widest px-3.5 py-1 rounded-full flex items-center gap-1.5 shadow-lg z-10 whitespace-nowrap">
                    <Check size={13} strokeWidth={3} />
                    <span>{isAgendado ? 'Sua Escolha' : 'Sua Escolha Atual'}</span>
                  </div>
                )}

                {/* HEADER DO CARD - ALTURA MÍNIMA FIXA PARA ALINHAMENTO HORIZONTAL */}
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1 min-h-[84px]">
                    <h3 className="font-display text-[20px] uppercase tracking-wide text-vapor-100">
                      {n.titulo}
                    </h3>
                    {n.descricao ? (
                      <p className="font-sans text-[13px] text-vapor-400 line-clamp-2 leading-tight">
                        {n.descricao}
                      </p>
                    ) : (
                      <span className="font-sans text-[13px] text-vapor-500 italic">
                        Sem descrição adicional
                      </span>
                    )}
                  </div>

                  {/* PREÇO E TEMPO */}
                  <div className="flex flex-col bg-graphite-950/60 p-3.5 rounded-xl border border-graphite-800">
                    <span className="font-mono text-[11px] text-vapor-400 uppercase tracking-wider">
                      Investimento Total
                    </span>
                    <div className="flex items-baseline gap-2 flex-wrap">
                      {n.valor_original && n.valor_original > n.valor_total && (
                        <span className="font-mono text-[16px] text-vapor-500 line-through">
                          {formatarMoeda(n.valor_original)}
                        </span>
                      )}
                      <span className="font-mono text-[26px] font-bold text-amber-400">
                        {formatarMoeda(n.valor_total)}
                      </span>
                    </div>
                    <span className="font-mono text-[12px] text-vapor-400 flex items-center gap-1 mt-0.5">
                      <Clock size={13} /> Tempo estimado: {n.duracao_total} minutos
                    </span>
                  </div>

                  {/* LISTA DE SERVIÇOS INCLUÍDOS */}
                  <div className="flex flex-col gap-2">
                    <span className="font-mono text-[11px] text-vapor-400 uppercase tracking-wider">
                      O que está incluído:
                    </span>
                    <ul className="flex flex-col gap-2.5">
                      {n.itens.map((it, idx) => (
                        <li key={idx} className="flex items-start gap-2.5 font-sans text-[13.5px]">
                          <div className="p-0.5 bg-emerald-500/20 text-emerald-400 rounded mt-0.5 shrink-0">
                            <Check size={13} strokeWidth={2.5} />
                          </div>
                          <div className="flex flex-col flex-1 min-w-0">
                            <span
                              title={it.servico_nome}
                              className="font-bold text-vapor-100 line-clamp-2 leading-snug break-words"
                            >
                              {it.servico_nome}
                            </span>
                            {it.servico_descricao && (
                              <span className="text-[12px] text-vapor-400 line-clamp-2 leading-tight">
                                {it.servico_descricao}
                              </span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* BOTÃO DE ESCOLHA / TROCA */}
                {podeTrocarOuResponder && (
                  <Button
                    tone={isEstaAprovada ? 'emerald' : isDestaque ? 'amber' : 'graphite'}
                    size="lg"
                    onClick={() => handleResponder(n.nivel, true)}
                    loading={responding}
                    disabled={isEstaAprovada}
                    className="w-full flex items-center justify-center gap-2 mt-4 font-bold min-h-[48px]"
                  >
                    {isEstaAprovada ? (
                      <>
                        <Check size={16} />
                        <span>Pacote Selecionado</span>
                      </>
                    ) : isAprovado ? (
                      <>
                        <RefreshCw size={15} />
                        <span>Trocar para esta opção</span>
                      </>
                    ) : (
                      <span>Escolher esta opção</span>
                    )}
                  </Button>
                )}
              </Card>
            );
          })}
        </div>

        {/* CARD DE OBSERVAÇÕES E TERMOS DO ORÇAMENTO */}
        {(data.observacoes || data.oficina?.pdf_texto_observacoes_orcamento) && (
          <Card className="p-5 bg-graphite-900 border border-graphite-800 rounded-2xl flex flex-col gap-3 mt-4 shadow-xl">
            <div className="flex items-center gap-2 text-amber-400 font-sans font-bold text-[14px] uppercase tracking-wide">
              <FileText size={16} />
              <span>Observações & Termos da Proposta</span>
            </div>
            {data.observacoes && (
              <div className="font-sans text-[13px] text-vapor-200 whitespace-pre-wrap leading-relaxed bg-graphite-950 p-3.5 rounded-xl border border-graphite-800">
                {data.observacoes}
              </div>
            )}
            {data.oficina?.pdf_texto_observacoes_orcamento && data.oficina.pdf_texto_observacoes_orcamento !== data.observacoes && (
              <div className="font-sans text-[12px] text-vapor-400 whitespace-pre-wrap leading-relaxed border-t border-graphite-800 pt-3 mt-1">
                <span className="font-bold text-vapor-300 block mb-1">Termos e Condições Gerais:</span>
                {data.oficina.pdf_texto_observacoes_orcamento}
              </div>
            )}
          </Card>
        )}

        {/* OPÇÃO DE RECUSAR SE AINDA PUDER RESPONDER */}
        {podeTrocarOuResponder && !isAprovado && (
          <div className="flex justify-center mt-2">
            <button
              onClick={() => handleResponder('essencial', false)}
              disabled={responding}
              className="font-sans text-[13px] text-vapor-400 hover:text-rose-400 transition-colors underline underline-offset-4 p-2 min-h-[44px]"
            >
              Não tenho interesse no momento
            </button>
          </div>
        )}

        {/* PARTE 2: AGENDAMENTO ONLINE DE HORÁRIO PELO CLIENTE (EXIBIDO APÓS APROVAÇÃO E SE AINDA NÃO AGENDOU) */}
        {isAprovado && !data.agendamento && data.oficina?.orcamento_agendamento_cliente !== false && (() => {
          const nivelAprovado = data.niveis?.find((n) => n.nivel === (data.nivel_aprovado || escolhaSucesso));
          const itensLocais = nivelAprovado?.itens?.map((i) => ({ servico_id: i.servico_id })) || [];
          const itensParaConsulta: ItemAgendamentoPublico[] = (data.itens_aprovados && data.itens_aprovados.length > 0)
            ? data.itens_aprovados
            : itensLocais;

          return (
            <Card className="p-6 bg-graphite-900 border-2 border-amber-500/60 rounded-2xl flex flex-col gap-6 shadow-2xl mt-4">
              <div className="flex flex-col gap-1 border-b border-graphite-800 pb-4">
                <h3 className="font-display text-[20px] text-vapor-100 uppercase tracking-wide flex items-center gap-2">
                  <Sparkles className="text-amber-500" size={22} />
                  <span>Escolha a Data e Horário para o Atendimento</span>
                </h3>
                <p className="font-sans text-[14px] text-vapor-300">
                  Selecione o dia e horário de sua preferência para agendar o serviço{' '}
                  <strong className="text-amber-400">{nivelAprovadoObj?.titulo || 'escolhido'}</strong>.
                </p>
              </div>

              <SeletorHorarioPublico
                tenantId={data.oficina?.tenant_id || ''}
                categoriaId={data.categoria_id || null}
                itens={itensParaConsulta}
                dataSelecionada={dataSelecionada}
                setDataSelecionada={setDataSelecionada}
                horarioSelecionado={horarioSelecionado}
                setHorarioSelecionado={setHorarioSelecionado}
                onSlotSelecionadoObj={setSlotSelecionadoObj}
                politicaCancelamento={data.oficina?.pdf_texto_observacoes_orcamento}
                aceiteCheck={transbordoAceito}
                onAceiteChange={setTransbordoAceito}
                theme="amber"
              />

              {/* CONFIRMAÇÃO DO AGENDAMENTO */}
              {dataSelecionada && horarioSelecionado && (
                <div className="p-4 bg-graphite-950 rounded-xl border border-graphite-800 flex flex-col gap-3 mt-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-graphite-800 pb-3">
                    <div className="flex flex-col">
                      <span className="font-sans text-[12px] text-vapor-400">Resumo da Escolha:</span>
                      <span className="font-display text-[16px] text-vapor-100 uppercase">
                        {nivelAprovadoObj?.titulo} • {formatarMoeda(nivelAprovadoObj?.valor_total || 0)}
                      </span>
                    </div>

                    <div className="flex flex-col sm:items-end">
                      <span className="font-sans text-[12px] text-vapor-400">Data & Horário Selecionado:</span>
                      <span className="font-mono text-[15px] font-bold text-amber-400">
                        {formatarData(dataSelecionada)} às {horarioSelecionado.substring(0, 5)}
                      </span>
                    </div>
                  </div>

                  {erroAgendamento && (
                    <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-300 font-sans text-[13px] flex items-center gap-2">
                      <AlertTriangle size={16} className="shrink-0 text-rose-400" />
                      <span>{erroAgendamento}</span>
                    </div>
                  )}

                  <Button
                    tone="amber"
                    size="lg"
                    onClick={handleConfirmarAgendamento}
                    loading={agendando}
                    disabled={agendando || (isTransbordoSlot && !transbordoAceito)}
                    className="w-full flex items-center justify-center gap-2 font-bold min-h-[52px] text-[15px]"
                  >
                    <CheckCircle2 size={18} />
                    <span>Confirmar Agendamento</span>
                  </Button>
                </div>
              )}
            </Card>
          );
        })()}

        {/* Rodapé Legal Público */}
        <footer className="py-8 text-center text-xs text-vapor-500 border-t border-graphite-800/80 mt-8 max-w-3xl mx-auto w-full">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <span>{data.oficina?.nome || 'Oficina'} • NuvemWash</span>
            <div className="flex items-center gap-4">
              <Link to="/termos-de-uso" target="_blank" className="text-vapor-400 hover:text-amber-400 transition-colors">
                Termos de Uso
              </Link>
              <span>•</span>
              <Link to="/politica-de-privacidade" target="_blank" className="text-vapor-400 hover:text-amber-400 transition-colors">
                Política de Privacidade
              </Link>
            </div>
          </div>
        </footer>
      </div>

      {/* MODAL DE ASSINATURA DIGITAL DE ACEITE DO ORÇAMENTO */}
      <Modal
        isOpen={showModalAceiteAssinatura}
        onClose={() => {
          if (!responding) {
            setShowModalAceiteAssinatura(false);
            setNivelPendenteAceite(null);
          }
        }}
        title="Aceite e Assinatura Digital"
        subtitle="Por favor, confirme seu nome e assine no quadro abaixo para aprovar esta proposta."
        maxWidth="lg"
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="font-sans text-[13px] font-medium text-vapor-300">
              Nome Completo do Assinante
            </label>
            <input
              type="text"
              value={nomeAssinante}
              onChange={(e) => setNomeAssinante(e.target.value)}
              placeholder="Digite seu nome completo"
              className="bg-graphite-900 border border-graphite-700 rounded-lg px-3.5 py-2.5 text-[14px] text-vapor-100 placeholder:text-vapor-500 focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-sans text-[13px] font-medium text-vapor-300">
              Sua Assinatura Digital
            </label>
            <CanvasAssinatura
              onSaveSignature={handleConfirmarAceiteComAssinatura}
              saveButtonText="Aprovar Proposta com Assinatura"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};
