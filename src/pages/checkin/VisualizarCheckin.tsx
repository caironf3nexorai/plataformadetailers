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
import { getEvidenciaSignedUrl } from '../../utils/evidencias';
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
} from 'lucide-react';

export const VisualizarCheckin: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { tenant } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [checkin, setCheckin] = useState<Checkin | null>(null);
  const [agendamento, setAgendamento] = useState<any>(null);
  const [avarias, setAvarias] = useState<CheckinAvaria[]>([]);
  const [fotos, setFotos] = useState<CheckinFoto[]>([]);
  const [signedPhotoUrls, setSignedPhotoUrls] = useState<Record<string, string>>({});
  const [assinaturaSignedUrl, setAssinaturaSignedUrl] = useState<string>('');

  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<string>('');

  const svgRefs = useRef<{ [key in VistaDiagrama]?: SVGSVGElement | null }>({});

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

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto pb-12">
      {/* Topo e Ações */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-graphite-900 p-4 rounded-xl border border-graphite-800">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="p-2 text-vapor-400 hover:text-vapor-100 rounded-lg hover:bg-graphite-800 transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-[20px] text-vapor-100 uppercase tracking-wide">
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

        <Button
          type="button"
          variant="primary"
          onClick={handleDownloadPDF}
          disabled={generatingPdf}
          className="min-h-[50px] font-semibold flex items-center gap-2"
        >
          <Download size={18} />
          <span>{generatingPdf ? pdfProgress || 'Gerando PDF...' : 'Baixar PDF da Vistoria'}</span>
        </Button>
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
                  <div className="group relative rounded-lg overflow-hidden border border-graphite-700 bg-graphite-950 aspect-video">
                    {url ? (
                      <img src={url} alt={ft.descricao || 'Foto de vistoria'} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-vapor-500 font-mono text-[11px]">
                        Carregando...
                      </div>
                    )}
                    {ft.descricao && (
                      <div className="absolute inset-x-0 bottom-0 p-1.5 bg-graphite-950/80 backdrop-blur text-[11px] font-sans text-vapor-200 truncate">
                        {ft.descricao}
                      </div>
                    )}
                  </div>
                  <span className="font-mono text-[11px] text-vapor-400 px-0.5">
                    {formatarData(ft.created_at)} {formatarHora(ft.created_at)}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Termo e Assinatura Digital do Cliente */}
      <Card className="p-6 bg-graphite-800 border-amber-500/30 flex flex-col gap-4">
        <h3 className="font-display text-[18px] text-vapor-100 uppercase tracking-wide border-b border-graphite-700 pb-2">
          Assinatura e Validação Jurídica
        </h3>

        <div className="p-4 bg-graphite-900 rounded-lg border border-graphite-700 font-sans text-[13px] text-vapor-300 italic leading-relaxed">
          "Declaro que as informações e avarias registradas acima refletem com precisão o estado do veículo na entrega."
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
          <div>
            <span className="font-mono text-[11px] text-vapor-400 uppercase">Assinado por:</span>
            <p className="font-sans text-[16px] font-bold text-vapor-100">
              {checkin.assinatura_nome || agendamento.cliente?.nome}
            </p>
            {checkin.assinado_em && (
              <p className="font-mono text-[12px] text-amber-400">
                Data: {formatarData(checkin.assinado_em)} às {formatarHora(checkin.assinado_em)}
              </p>
            )}
          </div>

          {assinaturaSignedUrl && (
            <div className="p-2 bg-graphite-950 rounded-lg border border-graphite-700">
              <img src={assinaturaSignedUrl} alt="Assinatura do cliente" className="h-16 object-contain" />
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};
