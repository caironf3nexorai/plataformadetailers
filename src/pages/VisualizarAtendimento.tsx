import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
} from 'lucide-react';
import { formatarMoeda, formatarOS } from '../utils/formatters';
import { formatarDataHora } from '../utils/datas';
import { formatarSegundosHHMMSS } from '../hooks/useTempoExecucao';
import { gerarPDFOS } from '../utils/pdfOS';

export const VisualizarAtendimento: React.FC = () => {
  const { id: paramId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { tenant, membership } = useAuth();
  const podeVerCusto = membership?.role === 'dono' || membership?.role === 'gerente';

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [execucao, setExecucao] = useState<any | null>(null);
  const [agendamento, setAgendamento] = useState<any | null>(null);
  const [ordinalCliente, setOrdinalCliente] = useState<number | null>(null);
  const [checkinId, setCheckinId] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<any[]>([]);
  const [consumos, setConsumos] = useState<any[]>([]);
  const [valores, setValores] = useState<any[]>([]);
  const [fotos, setFotos] = useState<{ durante: any[]; saida: any[] }>({ durante: [], saida: [] });
  const [gerandoPDFOS, setGerandoPDFOS] = useState(false);

  const handleGerarPDFOS = async (acao: 'download' | 'print' = 'download') => {
    if (!agendamento || !tenant) return;
    try {
      setGerandoPDFOS(true);
      const logoUrl = tenant.logo_path
        ? supabase.storage.from('catalogo').getPublicUrl(tenant.logo_path).data.publicUrl
        : undefined;

      const itensFormatados = (agendamento.agendamento_itens || []).map((it: any) => ({
        servico_nome: it.servicos?.nome || it.servico_nome || 'Serviço',
        categoria_nome: it.categoria?.nome,
        preco: Number(it.preco_praticado ?? it.preco ?? it.servicos?.preco ?? 0),
        duracao_minutos: it.duracao_minutos || it.servicos?.duracao_minutos,
        quantidade: it.quantidade || 1,
      }));

      if (itensFormatados.length === 0 && agendamento.servico) {
        itensFormatados.push({
          servico_nome: agendamento.servico.nome || 'Serviço',
          preco: Number(agendamento.preco_total || 0),
          duracao_minutos: agendamento.duracao_minutos,
          quantidade: 1,
        });
      }

      await gerarPDFOS(
        {
          numero_os: agendamento.numero_os || 1,
          data_emissao: agendamento.created_at,
          status: agendamento.status || (execucao?.finalizado_em ? 'concluido' : 'em_andamento'),
          inicio: agendamento.inicio,
          previsao_entrega: agendamento.fim,
          concluido_em: execucao?.finalizado_em,
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
          valor_total: Number(agendamento.preco_total || 0),
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
              setAgendamento(agendOnly);
            } else {
              console.warn('[VisualizarAtendimento] Registro não encontrado para paramId:', paramId);
              setErrorMsg('Não foi possível carregar este atendimento.');
            }
          }
        }

        if (execData) {
          setExecucao(execData);
          setAgendamento(execData.agendamentos);

          const execId = execData.id;
          const agendId = execData.agendamento_id;

          // 2. Buscar Check-in (Vistoria)
          if (agendId) {
            const { data: checkinData } = await supabase
              .from('checkins')
              .select('id')
              .eq('agendamento_id', agendId)
              .maybeSingle();

            if (checkinData) {
              setCheckinId(checkinData.id);
            }
          }

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

          if (fotosData) {
            const durante = fotosData.filter((f) => f.tipo === 'durante');
            const saida = fotosData.filter((f) => f.tipo === 'saida');
            setFotos({ durante, saida });
          }
        }

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

  if (errorMsg || (!execucao && !agendamento)) {
    return (
      <div className="p-8 max-w-lg mx-auto text-center flex flex-col items-center gap-4">
        <div className="p-3 bg-flare-500/10 text-flare-400 rounded-full border border-flare-500/20">
          <AlertTriangle size={32} />
        </div>
        <h2 className="text-xl font-bold text-vapor-100">Ops! Algo deu errado.</h2>
        <p className="text-sm text-vapor-400">{errorMsg || 'Atendimento não encontrado.'}</p>
        <Button onClick={() => navigate(-1)} variant="secondary">
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
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg bg-graphite-800 hover:bg-graphite-700 text-vapor-300 border border-graphite-700 transition-colors"
            title="Voltar"
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

          {/* Botão para Vistoria de Entrada se existir */}
          {checkinId && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate(`/checkin/${checkinId}/ver`)}
              className="flex items-center gap-1.5 text-[12px] bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 shrink-0"
            >
              <ClipboardCheck size={16} />
              <span className="hidden sm:inline">Vistoria de Entrada</span>
            </Button>
          )}
        </div>
      </div>

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

      {/* BLOCO 5: FOTOS DE EXECUÇÃO E SAÍDA */}
      <Card className="p-4 flex flex-col gap-4 bg-graphite-900 border-graphite-700">
        <div className="flex items-center gap-2 border-b border-graphite-800 pb-2">
          <Camera size={18} className="text-amber-400" />
          <h2 className="font-display text-[14px] font-bold text-vapor-100 uppercase tracking-wider">
            Fotos e Evidências
          </h2>
        </div>

        {/* Fotos Durante o Serviço */}
        <div className="flex flex-col gap-2">
          <span className="text-[12px] font-sans text-vapor-300 font-semibold">
            Durante o Serviço ({fotos.durante.length})
          </span>
          {fotos.durante.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {fotos.durante.map((f) => (
                <div key={f.id} className="flex flex-col gap-1">
                  <a
                    href={f.signedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="aspect-square rounded-lg bg-graphite-800 border border-graphite-700 overflow-hidden relative group hover:border-amber-500 transition-colors"
                  >
                    <img src={f.signedUrl} alt="Execução" className="w-full h-full object-cover" />
                  </a>
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

        {/* Fotos de Saída */}
        <div className="flex flex-col gap-2 pt-2 border-t border-graphite-800">
          <span className="text-[12px] font-sans text-vapor-300 font-semibold">
            Saída do Veículo ({fotos.saida.length})
          </span>
          {fotos.saida.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {fotos.saida.map((f) => (
                <div key={f.id} className="flex flex-col gap-1">
                  <a
                    href={f.signedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="aspect-square rounded-lg bg-graphite-800 border border-graphite-700 overflow-hidden relative group hover:border-amber-500 transition-colors"
                  >
                    <img src={f.signedUrl} alt="Saída" className="w-full h-full object-cover" />
                  </a>
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
    </div>
  );
};
