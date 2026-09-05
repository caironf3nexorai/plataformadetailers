import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import type { Checkin, CheckinAvaria, CheckinFoto, VistaDiagrama } from '../../types/checkin';
import { formatarData, formatarHora } from '../../utils/datas';
import {
  formatarNivelCombustivel,
  formatarNomeAvaria,
  formatarNomeVista,
} from '../../utils/checkin';
import { getEvidenciaSignedUrl, baixarFoto } from '../../utils/evidencias';
import { gerarPDFCheckin } from '../../utils/pdfCheckin';
import { DiagramaVeiculo } from '../../components/checkin/DiagramaVeiculo';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import {
  Download,
  Lock,
  ArrowLeft,
  Fuel,
  Car,
  User,
  AlertTriangle,
  Camera,
  Play,
  Eye,
  X,
} from 'lucide-react';

export const VisualizarCheckin: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { tenant } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingExec, setStartingExec] = useState(false);

  const [checkin, setCheckin] = useState<Checkin | null>(null);
  const [agendamento, setAgendamento] = useState<any>(null);
  const [avarias, setAvarias] = useState<CheckinAvaria[]>([]);
  const [fotos, setFotos] = useState<CheckinFoto[]>([]);
  const [signedPhotoUrls, setSignedPhotoUrls] = useState<Record<string, string>>({});
  const [assinaturaSignedUrl, setAssinaturaSignedUrl] = useState<string>('');
  const [fotoModal, setFotoModal] = useState<{ url: string; titulo: string; data?: string } | null>(null);

  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<string>('');
  const [destravando, setDestravando] = useState(false);

  const svgRefs = useRef<{ [key in VistaDiagrama]?: SVGSVGElement | null }>({});

  const handleDestravarManual = async () => {
    if (!checkin) return;
    try {
      setDestravando(true);
      const nomeSignatario = checkin.assinatura_nome || agendamento?.cliente?.nome || 'Assinatura Manual';
      const { error: err } = await supabase.rpc('finalizar_checkin', {
        p_checkin: checkin.id,
        p_assinatura_path: 'manual',
        p_nome: nomeSignatario,
      });

      if (err) {
        await supabase
          .from('checkins')
          .update({
            finalizado: true,
            aceite_tipo: 'manual',
            assinatura_nome: nomeSignatario,
            assinado_em: new Date().toISOString(),
          })
          .eq('id', checkin.id);
      } else {
        await supabase
          .from('checkins')
          .update({
            aceite_tipo: 'manual',
          })
          .eq('id', checkin.id);
      }

      await fetchCheckinCompleto();
    } catch (e: any) {
      setError('Erro ao destravar vistoria: ' + (e?.message || e));
    } finally {
      setDestravando(false);
    }
  };

  const handleIniciarServicoAgora = async () => {
    if (!agendamento || startingExec) return;
    setStartingExec(true);
    setError(null);
    try {
      // 1. Verifica se já existe execução
      const { data: execData } = await supabase
        .from('execucoes')
        .select('id')
        .eq('agendamento_id', agendamento.id)
        .maybeSingle();

      if (execData?.id) {
        navigate(`/execucao/${execData.id}`);
        return;
      }

      // 2. Se não existir, chama iniciar_execucao
      const { data: rpcData, error: rpcErr } = await supabase.rpc('iniciar_execucao', {
        p_agendamento: agendamento.id,
      });

      if (rpcErr) throw rpcErr;

      const execId = typeof rpcData === 'string' ? rpcData : (rpcData?.execucao_id || rpcData?.id);
      if (!execId) {
        throw new Error('Não foi possível iniciar o atendimento.');
      }

      navigate(`/execucao/${execId}`);
    } catch (err: any) {
      console.error('[Iniciar Servico Agora Error]:', err);
      let userMessage = 'Não foi possível iniciar o serviço. Tente novamente.';
      const msg = err?.message || '';
      if (msg.includes('já foi finalizado')) {
        userMessage = 'Este atendimento já foi finalizado.';
      } else if (msg.includes('sem acesso')) {
        userMessage = 'Você não tem permissão para acessar esta oficina.';
      }
      setError(userMessage);
    } finally {
      setStartingExec(false);
    }
  };

  useEffect(() => {
    if (id && tenant) {
      fetchCheckinCompleto();
    }
  }, [id, tenant]);

  const fetchCheckinCompleto = async () => {
    if (!id || !tenant) return;
    try {
      setLoading(true);
      setError(null);

      // 1. Checkin
      const { data: chkData, error: chkErr } = await supabase
        .from('checkins')
        .select('*')
        .eq('id', id)
        .single();

      if (chkErr || !chkData) throw new Error('Vistoria de entrada não encontrada.');
      setCheckin(chkData);

      // 2. Agendamento + Cliente + Veiculo
      const { data: agData } = await supabase
        .from('agendamentos')
        .select(`
          id,
          inicio,
          status,
          cliente:clientes(id, nome, telefone),
          veiculo:veiculos(id, modelo, placa, marca, cor),
          servico:servicos(id, nome)
        `)
        .eq('id', chkData.agendamento_id)
        .single();

      setAgendamento(agData);

      // 3. Avarias
      const { data: avData } = await supabase
        .from('checkin_avarias')
        .select('*')
        .eq('checkin_id', id)
        .order('created_at');

      setAvarias(avData || []);

      // 4. Fotos
      const { data: ftData } = await supabase
        .from('checkin_fotos')
        .select('*')
        .eq('checkin_id', id)
        .order('created_at');

      setFotos(ftData || []);

      // 5. Obter Signed URLs das Fotos
      const photoMap: Record<string, string> = {};
      if (ftData) {
        for (const ft of ftData) {
          const sUrl = await getEvidenciaSignedUrl(ft.path);
          if (sUrl) photoMap[ft.id] = sUrl;
        }
      }
      setSignedPhotoUrls(photoMap);

      // Signed URL ou Base64 da Assinatura
      if (chkData.assinatura_path) {
        if (chkData.assinatura_path.startsWith('data:')) {
          setAssinaturaSignedUrl(chkData.assinatura_path);
        } else {
          const assUrl = await getEvidenciaSignedUrl(chkData.assinatura_path);
          setAssinaturaSignedUrl(assUrl);
        }
      }
    } catch (err: any) {
      console.error('[Visualizar Checkin Error]:', err);
      setError(err.message || 'Erro ao carregar dados da vistoria.');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadPDF = async () => {
    if (!checkin || !agendamento || !tenant) return;
    setGeneratingPdf(true);
    setPdfProgress('Iniciando...');
    try {
      const logoUrl = tenant.logo_path
        ? supabase.storage.from('catalogo').getPublicUrl(tenant.logo_path).data.publicUrl
        : undefined;

      await gerarPDFCheckin(
        {
          checkin,
          avarias,
          fotos,
          clienteNome: agendamento.cliente?.nome || 'Cliente',
          clienteTelefone: agendamento.cliente?.telefone || '',
          veiculoModelo: agendamento.veiculo?.modelo || 'Veículo',
          veiculoPlaca: agendamento.veiculo?.placa || '',
          oficinaNome: tenant.nome || 'Oficina',
          oficinaTelefone: tenant.telefone || '',
          oficinaCidadeUF: tenant.cidade && tenant.uf ? `${tenant.cidade}/${tenant.uf}` : undefined,
          oficinaLogoUrl: logoUrl,
          oficinaDocumento: tenant.documento,
          oficinaDocumentoTipo: tenant.documento_tipo,
          oficinaRazaoSocial: tenant.razao_social,
          svgElements: svgRefs.current,
          planoCodigo: tenant.plano,
          pdfCorPrimaria: tenant.pdf_cor_primaria,
          pdfCorFundoCabecalho: tenant.pdf_cor_fundo_cabecalho,
          pdfCorTextoCabecalho: tenant.pdf_cor_texto_cabecalho,
          pdfCorFundoSecoes: tenant.pdf_cor_fundo_secoes,
          pdfCorTextoSecoes: tenant.pdf_cor_texto_secoes || (tenant?.id ? localStorage.getItem(`tenant_pdf_cor_texto_secoes_${tenant.id}`) : null),
          pdfSubtituloCabecalho: tenant.pdf_subtitulo_cabecalho,
          pdfTextoObservacoesOrcamento: tenant.pdf_texto_observacoes_orcamento,
          pdfTextoRodape: tenant.pdf_texto_rodape,
          pdfOcultarMarcaDagua: tenant.pdf_ocultar_marca_dagua,
        },
        (msg) => setPdfProgress(msg)
      );
    } catch (err: any) {
      setError('Erro ao gerar PDF da vistoria: ' + err.message);
    } finally {
      setGeneratingPdf(false);
      setPdfProgress('');
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        <span className="font-mono text-[13px] text-vapor-400">Carregando relatório de vistoria...</span>
      </div>
    );
  }

  if (error || !checkin || !agendamento) {
    return (
      <div className="p-6 max-w-lg mx-auto bg-graphite-800 border border-flare-500/40 rounded-xl text-center flex flex-col gap-4">
        <AlertTriangle size={36} className="text-flare-400 mx-auto" />
        <h3 className="font-display text-[18px] text-vapor-100 uppercase">Erro ao Carregar Vistoria</h3>
        <p className="font-sans text-[14px] text-vapor-400">{error}</p>
        <Button variant="secondary" onClick={() => navigate('/agenda')}>Voltar para Agenda</Button>
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

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto pb-12">
      {/* Topo e Ações */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-graphite-900 p-4 rounded-xl border border-graphite-800">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleVoltar}
            className="p-2 text-vapor-400 hover:text-vapor-100 rounded-lg hover:bg-graphite-800 transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center"
            title="Voltar para a página anterior"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-[18px] sm:text-[20px] text-vapor-100 uppercase tracking-wide">
                Relatório de Vistoria de Entrada
              </h2>
              {checkin.finalizado && (
                <span className="px-2.5 py-1 rounded bg-amber-500/20 text-amber-400 border border-amber-500/40 font-mono text-[11px] font-bold flex items-center gap-1">
                  <Lock size={12} />
                  <span>Imutável</span>
                </span>
              )}
            </div>
            <span className="font-mono text-[12px] text-vapor-400">
              Registrado em {formatarData(checkin.created_at)} às {formatarHora(checkin.created_at)}
            </span>
          </div>
        </div>

        {/* 3 Ações na Ordem Estrita de Uso */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          {/* 1. Iniciar serviço agora — ação principal */}
          <Button
            type="button"
            variant="primary"
            onClick={handleIniciarServicoAgora}
            disabled={startingExec}
            className="min-h-[56px] px-6 text-[15px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20"
          >
            {startingExec ? (
              <div className="w-5 h-5 border-2 border-graphite-950 border-t-transparent rounded-full animate-spin" />
            ) : (
              <Play size={20} className="fill-current" />
            )}
            <span>Iniciar serviço agora</span>
          </Button>

          {/* 2. Enviar/Baixar PDF ao cliente — secundária */}
          <Button
            type="button"
            variant="secondary"
            onClick={handleDownloadPDF}
            disabled={generatingPdf}
            className="min-h-[56px] px-4 font-semibold flex items-center justify-center gap-2 text-vapor-200"
          >
            <Download size={18} />
            <span>{generatingPdf ? pdfProgress || 'Gerando PDF...' : 'Baixar PDF'}</span>
          </Button>

          {/* 3. Voltar — terciária, discreta */}
          <Button
            type="button"
            variant="ghost"
            onClick={handleVoltar}
            className="min-h-[56px] px-3 font-medium text-vapor-400 hover:text-vapor-100 flex items-center justify-center gap-1.5"
          >
            <span>Voltar</span>
          </Button>
        </div>
      </div>

      {/* Card Principal: Cliente e Veículo */}
      <Card className="p-6 bg-graphite-800 border-graphite-700 flex flex-col gap-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-start gap-3 p-3 bg-graphite-900 rounded-lg border border-graphite-700">
            <User size={20} className="text-amber-500 shrink-0 mt-0.5" />
            <div>
              <span className="font-mono text-[11px] text-vapor-400 uppercase">Cliente</span>
              <p className="font-sans text-[15px] font-bold text-vapor-100">{agendamento.cliente?.nome}</p>
              <p className="font-mono text-[12px] text-vapor-400">{agendamento.cliente?.telefone || '—'}</p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 bg-graphite-900 rounded-lg border border-graphite-700">
            <Car size={20} className="text-amber-500 shrink-0 mt-0.5" />
            <div>
              <span className="font-mono text-[11px] text-vapor-400 uppercase">Veículo & Placa</span>
              <p className="font-sans text-[15px] font-bold text-amber-400">{agendamento.veiculo?.modelo}</p>
              <p className="font-mono text-[13px] text-vapor-200">Placa: {agendamento.veiculo?.placa?.toUpperCase()}</p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 bg-graphite-900 rounded-lg border border-graphite-700">
            <Fuel size={20} className="text-amber-500 shrink-0 mt-0.5" />
            <div>
              <span className="font-mono text-[11px] text-vapor-400 uppercase">Vituais de Entrada</span>
              <p className="font-sans text-[14px] text-vapor-100 font-bold">
                KM: {checkin.km ? checkin.km.toLocaleString('pt-BR') : 'Não informado'}
              </p>
              <p className="font-mono text-[12px] text-amber-400">
                Combustível: {formatarNivelCombustivel(checkin.nivel_combustivel)}
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Diagramas das 5 Vistas em Modo Leitura */}
      <Card className="p-6 bg-graphite-800 border-graphite-700 flex flex-col gap-4">
        <h3 className="font-display text-[18px] text-vapor-100 uppercase tracking-wide border-b border-graphite-700 pb-2">
          Diagramas de Avarias Registradas
        </h3>
        <DiagramaVeiculo
          checkinId={checkin.id}
          avarias={avarias}
          fotos={fotos}
          finalizado={true} // Força modo leitura imutável
          onAddAvaria={async () => {}}
          onRemoveAvaria={async () => {}}
          onAddFotoAvaria={async () => {}}
          svgRefs={svgRefs}
        />
      </Card>

      {/* Detalhamento das Avarias Registradas */}
      <Card className="p-6 bg-graphite-800 border-graphite-700 flex flex-col gap-4">
        <h3 className="font-display text-[18px] text-vapor-100 uppercase tracking-wide border-b border-graphite-700 pb-2 flex items-center justify-between">
          <span>Lista de Avarias ({avarias.length})</span>
        </h3>

        {avarias.length === 0 ? (
          <p className="font-sans text-[14px] text-vapor-400 italic">
            Nenhuma avaria marcada no diagrama.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {avarias.map((av, idx) => (
              <div key={av.id} className="p-3 bg-graphite-900 rounded-lg border border-graphite-700 flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="font-display text-[14px] text-amber-400 font-bold uppercase">
                    {idx + 1}. {formatarNomeVista(av.vista)} — {formatarNomeAvaria(av.tipo)}
                  </span>
                  <span className="font-mono text-[11px] text-vapor-500">
                    X: {av.pos_x.toFixed(0)}% | Y: {av.pos_y.toFixed(0)}%
                  </span>
                </div>
                <p className="font-sans text-[13px] text-vapor-200">
                  {av.descricao || 'Sem descrição cadastrada'}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Galeria de Fotos de Vistoria */}
      {fotos.length > 0 && (
        <Card className="p-6 bg-graphite-800 border-graphite-700 flex flex-col gap-4">
          <h3 className="font-display text-[18px] text-vapor-100 uppercase tracking-wide border-b border-graphite-700 pb-2 flex items-center justify-between">
            <span>Galeria de Fotos da Vistoria ({fotos.length})</span>
            <Camera size={20} className="text-amber-500" />
          </h3>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {fotos.map((ft) => {
              const url = signedPhotoUrls[ft.id];
              return (
                <div key={ft.id} className="flex flex-col gap-1">
                  <div
                    onClick={() => {
                      if (url) {
                        setFotoModal({
                          url,
                          titulo: ft.descricao || 'Foto da Vistoria',
                          data: ft.created_at,
                        });
                      }
                    }}
                    className="group relative rounded-lg overflow-hidden border border-graphite-700 bg-graphite-950 aspect-video cursor-pointer hover:border-amber-500 transition-colors"
                  >
                    {url ? (
                      <img src={url} alt={ft.descricao || 'Foto de vistoria'} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-vapor-500 font-mono text-[11px]">
                        Carregando...
                      </div>
                    )}
                    <div className="absolute inset-0 bg-graphite-950/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <Eye size={20} className="text-vapor-100" />
                    </div>
                    {url && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          baixarFoto(
                            url,
                            `vistoria_${agendamento?.veiculo?.placa || 'foto'}_${ft.id.slice(0, 8)}.jpg`
                          );
                        }}
                        className="absolute top-1.5 right-1.5 p-1.5 bg-graphite-950/80 hover:bg-amber-500 hover:text-graphite-950 text-vapor-200 rounded-md border border-graphite-700 opacity-0 group-hover:opacity-100 transition shadow"
                        title="Baixar Foto"
                      >
                        <Download size={13} />
                      </button>
                    )}
                    {ft.descricao && (
                      <div className="absolute inset-x-0 bottom-0 p-1.5 bg-graphite-950/80 backdrop-blur text-[11px] font-sans text-vapor-200 truncate">
                        {ft.descricao}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 font-mono text-[10.5px] text-amber-400 font-semibold px-0.5" title="Data e hora imutável do upload">
                    <Lock size={12} className="shrink-0 text-amber-500" />
                    <span>Upload: {formatarData(ft.created_at)} às {formatarHora(ft.created_at)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Termo e Assinatura Digital do Cliente */}
      <Card className="p-6 bg-graphite-800 border-amber-500/30 flex flex-col gap-4">
        <div className="flex items-center justify-between border-b border-graphite-700 pb-2 flex-wrap gap-2">
          <h3 className="font-display text-[18px] text-vapor-100 uppercase tracking-wide">
            Assinatura e Validação Jurídica
          </h3>
          {!checkin.finalizado && (
            <Button
              type="button"
              variant="secondary"
              onClick={handleDestravarManual}
              disabled={destravando}
              className="text-xs bg-cyan-500/10 border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/20"
            >
              <span>{destravando ? 'Destravando...' : 'Destravar Vistoria (Assinatura Manual)'}</span>
            </Button>
          )}
        </div>

        <div className="p-4 bg-graphite-900 rounded-lg border border-graphite-700 font-sans text-[13px] text-vapor-300 italic leading-relaxed">
          "Declaro que as informações e avarias registradas acima refletem com precisão o estado do veículo na entrega."
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
          <div>
            <span className="font-mono text-[11px] text-vapor-400 uppercase">Signatário:</span>
            <p className="font-sans text-[16px] font-bold text-vapor-100">
              {checkin.assinatura_nome || agendamento.cliente?.nome || 'Cliente'}
            </p>
            {checkin.assinado_em ? (
              <p className="font-mono text-[12px] text-amber-400">
                Data: {formatarData(checkin.assinado_em)} às {formatarHora(checkin.assinado_em)}
              </p>
            ) : (
              <p className="font-mono text-[12px] text-cyan-400">
                Status: Assinatura Manual / Física em Papel
              </p>
            )}
          </div>

          {assinaturaSignedUrl ? (
            <div className="p-2 bg-graphite-950 rounded-lg border border-graphite-700 flex items-center gap-2">
              <img src={assinaturaSignedUrl} alt="Assinatura do cliente" className="h-16 object-contain" />
              <button
                type="button"
                onClick={() => baixarFoto(assinaturaSignedUrl, `assinatura_${agendamento?.veiculo?.placa || 'cliente'}.png`)}
                className="p-1.5 text-vapor-400 hover:text-amber-400 hover:bg-graphite-800 rounded transition"
                title="Baixar Assinatura"
              >
                <Download size={14} />
              </button>
            </div>
          ) : (
            <div className="p-3 bg-graphite-900 rounded-lg border border-graphite-700 text-center flex flex-col items-center">
              <div className="w-40 border-b border-dashed border-vapor-500 my-2" />
              <span className="font-sans text-[11px] text-vapor-400">Assinatura Manual em Papel</span>
            </div>
          )}
        </div>
      </Card>

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
                  <span className="font-mono text-[11px] text-vapor-400">
                    {formatarData(fotoModal.data)} às {formatarHora(fotoModal.data)}
                  </span>
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
                      `vistoria_${agendamento?.veiculo?.placa ? agendamento.veiculo.placa + '_' : ''}${fotoModal.titulo || 'foto'}.jpg`
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
    </div>
  );
};
