import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { PublicLayout } from '../components/layout/PublicLayout';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import {
  Car,
  CheckCircle2,
  AlertTriangle,
  Camera,
  RotateCcw,
  Check,
  ShieldCheck,
  Sparkles,
  FileSignature,
  Download,
  Info,
  Layers,
} from 'lucide-react';
import { formatarDataHora } from '../utils/datas';
import { getEvidenciaSignedUrl } from '../utils/evidencias';
import { gerarPDFTermoRisco } from '../utils/pdfTermoRisco';

interface TermoRiscoPublicoData {
  agendamento_id: string;
  numero_os?: number | string | null;
  servico_nome: string;
  observacoes_risco: string;
  texto_legal?: string;
  oficina: {
    nome: string;
    razao_social?: string;
    documento?: string;
    documento_tipo?: 'cpf' | 'cnpj';
    telefone?: string;
    cidade?: string;
    uf?: string;
    logo_url?: string;
    plano?: string;
    pdf_cor_primaria?: string;
    pdf_cor_fundo_cabecalho?: string;
    pdf_cor_texto_cabecalho?: string;
    pdf_cor_fundo_secoes?: string;
    pdf_cor_texto_secoes?: string;
    pdf_subtitulo_cabecalho?: string;
    pdf_texto_rodape?: string;
    pdf_ocultar_marca_dagua?: boolean;
  };
  cliente: {
    nome: string;
    primeiro_nome: string;
    documento?: string;
    telefone?: string;
  };
  veiculo: {
    modelo: string;
    marca?: string;
    placa: string;
    cor?: string;
    ano?: number;
  };
  fotos_antes: Array<{
    path: string;
    descricao?: string;
    tipo?: string;
    created_at?: string;
    url?: string;
  }>;
  fotos_durante: Array<{
    path: string;
    descricao?: string;
    momento?: string;
    created_at?: string;
    url?: string;
  }>;
  assinado: boolean;
  assinado_em?: string;
  assinante_nome?: string;
  assinatura_url?: string;
  erro?: string;
}

export const TermoRiscoPublico: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<TermoRiscoPublicoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Formulário de assinatura
  const [assinanteNome, setAssinanteNome] = useState('');
  const [declaracaoAceita, setDeclaracaoAceita] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formErro, setFormErro] = useState<string | null>(null);
  const [gerandoPDF, setGerandoPDF] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  const fetchDados = async () => {
    const tokenLimpo = (token ?? '').trim();
    if (!tokenLimpo) {
      setError('Token de termo não fornecido.');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data: resData, error: resErr } = await supabase.rpc('obter_termo_risco_publico', {
        p_token: tokenLimpo,
      });

      if (resErr) {
        setError(resErr.message || 'Erro ao carregar dados do termo de risco.');
        return;
      }

      if (resData?.erro) {
        setError(resData.erro);
        return;
      }

      const parsed = resData as TermoRiscoPublicoData;

      // Resolver URLs seguras das fotos de Antes e Durante
      if (parsed.fotos_antes && Array.isArray(parsed.fotos_antes)) {
        parsed.fotos_antes = await Promise.all(
          parsed.fotos_antes.map(async (f) => {
            const url = await getEvidenciaSignedUrl(f.path);
            return { ...f, url: url || f.path };
          })
        );
      }

      if (parsed.fotos_durante && Array.isArray(parsed.fotos_durante)) {
        parsed.fotos_durante = await Promise.all(
          parsed.fotos_durante.map(async (f) => {
            const url = await getEvidenciaSignedUrl(f.path);
            return { ...f, url: url || f.path };
          })
        );
      }

      setData(parsed);
      if (parsed.cliente?.nome && !assinanteNome) {
        setAssinanteNome(parsed.cliente.nome);
      }
    } catch (err: any) {
      setError(err?.message || 'Erro de conexão.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDados();
  }, [token]);

  // Canvas setup
  useEffect(() => {
    if (data && !data.assinado) {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = 180;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      }
    }
  }, [data?.assinado]);

  const getCanvasCoords = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();

    let clientX = 0;
    let clientY = 0;

    if ('touches' in e && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if ('clientX' in e) {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const startDrawing = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    if (submitting || data?.assinado) return;
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCanvasCoords(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    if (!isDrawing || submitting || data?.assinado) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCanvasCoords(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasSignature) setHasSignature(true);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const handleClearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  const handleConfirmSignature = async () => {
    const tokenLimpo = (token ?? '').trim();
    const canvas = canvasRef.current;
    if (!canvas || !tokenLimpo || !hasSignature) return;

    setFormErro(null);

    const nomeClean = assinanteNome.trim();
    if (nomeClean.length < 3) {
      setFormErro('Por favor, informe seu nome completo (mínimo 3 caracteres).');
      return;
    }

    if (!declaracaoAceita) {
      setFormErro('Por favor, marque a declaração de ciência para prosseguir.');
      return;
    }

    setSubmitting(true);
    try {
      const dataUrl = canvas.toDataURL('image/png');

      const { error: rpcErr } = await supabase.rpc('assinar_termo_risco_publico', {
        p_token: tokenLimpo,
        p_assinatura_base64: dataUrl,
        p_nome: nomeClean,
        p_user_agent: navigator.userAgent,
      });

      if (rpcErr) {
        setFormErro('Erro ao registrar assinatura: ' + rpcErr.message);
        return;
      }

      await fetchDados();
    } catch (err: any) {
      setFormErro('Erro ao enviar assinatura: ' + (err?.message || err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleBaixarPDF = async () => {
    if (!data) return;
    try {
      setGerandoPDF(true);
      const fotosA = (data.fotos_antes || []).map((f) => ({
        url: f.url || f.path,
        descricao: f.descricao,
        momento: 'antes',
      }));

      const fotosD = (data.fotos_durante || []).map((f) => ({
        url: f.url || f.path,
        descricao: f.descricao,
        momento: 'durante',
      }));

      await gerarPDFTermoRisco(
        {
          oficinaNome: data.oficina.nome,
          oficinaRazaoSocial: data.oficina.razao_social,
          oficinaDocumento: data.oficina.documento,
          oficinaDocumentoTipo: data.oficina.documento_tipo,
          oficinaTelefone: data.oficina.telefone,
          oficinaCidadeUF:
            data.oficina.cidade && data.oficina.uf
              ? `${data.oficina.cidade}/${data.oficina.uf}`
              : undefined,
          oficinaLogoUrl: data.oficina.logo_url
            ? supabase.storage.from('catalogo').getPublicUrl(data.oficina.logo_url).data.publicUrl
            : undefined,
          planoCodigo: data.oficina.plano,
          pdfCorPrimaria: data.oficina.pdf_cor_primaria,
          pdfCorFundoCabecalho: data.oficina.pdf_cor_fundo_cabecalho,
          pdfCorTextoCabecalho: data.oficina.pdf_cor_texto_cabecalho,
          pdfCorFundoSecoes: data.oficina.pdf_cor_fundo_secoes,
          pdfCorTextoSecoes: data.oficina.pdf_cor_texto_secoes,
          pdfSubtituloCabecalho: data.oficina.pdf_subtitulo_cabecalho,
          pdfTextoRodape: data.oficina.pdf_texto_rodape,
          pdfOcultarMarcaDagua: data.oficina.pdf_ocultar_marca_dagua,

          clienteNome: data.cliente.nome,
          clienteDocumento: data.cliente.documento,
          clienteTelefone: data.cliente.telefone,
          veiculoModelo: data.veiculo.modelo,
          veiculoPlaca: data.veiculo.placa,
          veiculoCor: data.veiculo.cor,
          numeroOS: data.numero_os,

          servicoNome: data.servico_nome,
          riscosObservacoes: data.observacoes_risco,

          fotosAntes: fotosA,
          fotosDurante: fotosD,

          assinaturaDigitalUrl: data.assinado ? data.assinatura_url : null,
          assinaturaDigitalNome: data.assinante_nome,
          assinaturaDigitalEm: data.assinado_em,
        },
        undefined,
        'download',
        false
      );
    } catch (err: any) {
      console.error('[TermoRiscoPublico] Erro ao baixar PDF:', err);
    } finally {
      setGerandoPDF(false);
    }
  };

  if (loading) {
    return (
      <PublicLayout>
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <span className="font-mono text-[14px] text-vapor-400">
            Carregando termo de risco e evidências...
          </span>
        </div>
      </PublicLayout>
    );
  }

  if (error || !data) {
    return (
      <PublicLayout>
        <div className="flex flex-col items-center justify-center py-12 gap-4 text-center max-w-md mx-auto">
          <AlertTriangle size={48} className="text-flare-400" />
          <h2 className="font-display text-[20px] text-vapor-100 uppercase">
            Documento Não Encontrado
          </h2>
          <p className="font-sans text-[14px] text-vapor-400">
            {error || 'Não foi possível encontrar as informações deste termo de risco.'}
          </p>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <div className="w-full max-w-2xl mx-auto flex flex-col gap-6 pb-16 overflow-x-hidden">
        {/* Banner de Status / Boas-vindas */}
        <Card className="p-4 sm:p-6 bg-graphite-800 border-amber-500/30 flex flex-col gap-4 shadow-xl">
          <div className="flex items-center justify-between border-b border-graphite-700 pb-4">
            <div>
              <span className="font-mono text-[11px] text-amber-400 font-bold uppercase tracking-wider block">
                {data.oficina.nome}
              </span>
              <h1 className="font-display text-[22px] text-vapor-100 uppercase tracking-wide">
                Termo de Risco Específico & Vício Oculto (CDC)
              </h1>
            </div>
            {data.assinado ? (
              <span className="px-3 py-1 rounded-full text-[12px] font-mono font-bold bg-emerald-500/20 border border-emerald-400 text-emerald-300 flex items-center gap-1.5 shrink-0">
                <CheckCircle2 size={14} /> Assinado Digitalmente
              </span>
            ) : (
              <span className="px-3 py-1 rounded-full text-[12px] font-mono font-bold bg-amber-500/20 border border-amber-400 text-amber-300 flex items-center gap-1.5 shrink-0">
                <ShieldCheck size={14} /> Aguardando Assinatura
              </span>
            )}
          </div>

          <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-3">
            <Info size={22} className="text-amber-400 shrink-0 mt-0.5" />
            <p className="font-sans text-[13px] text-vapor-300 leading-relaxed">
              Olá, <strong className="text-amber-400">{data.cliente.primeiro_nome}</strong>! Tudo bem?
              <br />
              Durante a etapa de pré-lavagem e preparação técnica do seu veículo, nossa equipe identificou uma condição preexistente que se encontrava encoberta pela sujeira acumulada.
              <br />
              Por transparência e segurança jurídica de ambas as partes, reunimos abaixo o <strong>dossiê comparativo com as fotos de entrada e da anomalia revelada</strong> para sua ciência e assinatura digital.
            </p>
          </div>
        </Card>

        {/* Resumo do Veículo */}
        <Card className="p-4 sm:p-6 bg-graphite-800 border-graphite-700 flex flex-col gap-4">
          <div className="flex items-center gap-3 border-b border-graphite-700 pb-3">
            <Car size={24} className="text-amber-500 shrink-0" />
            <div>
              <h3 className="font-display text-[16px] text-vapor-100 uppercase">
                Identificação do Veículo
              </h3>
              <span className="font-mono text-[12px] text-amber-400 font-bold">
                {data.veiculo.placa}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 font-sans text-[13px]">
            <div className="bg-graphite-900 p-3 rounded-lg border border-graphite-700 flex flex-col">
              <span className="text-vapor-400 text-[11px]">Modelo:</span>
              <strong className="text-vapor-100 font-semibold">{data.veiculo.modelo}</strong>
            </div>

            <div className="bg-graphite-900 p-3 rounded-lg border border-graphite-700 flex flex-col">
              <span className="text-vapor-400 text-[11px]">Cor:</span>
              <strong className="text-vapor-100 font-semibold">
                {data.veiculo.cor || 'Não informada'}
              </strong>
            </div>

            <div className="bg-graphite-900 p-3 rounded-lg border border-graphite-700 flex flex-col">
              <span className="text-vapor-400 text-[11px]">OS Vinculada:</span>
              <strong className="text-amber-400 font-semibold font-mono">
                {data.numero_os ? `#${data.numero_os}` : 'Atendimento Técnico'}
              </strong>
            </div>
          </div>
        </Card>

        {/* Procedimento Técnico e Risco Identificado */}
        <Card className="p-4 sm:p-6 bg-graphite-800 border-amber-500/40 flex flex-col gap-4">
          <div className="flex items-center gap-2 border-b border-graphite-700 pb-3">
            <Sparkles size={20} className="text-amber-400" />
            <h3 className="font-display text-[16px] text-vapor-100 uppercase">
              Procedimento Técnico & Condição Identificada
            </h3>
          </div>

          <div className="flex flex-col gap-3 font-sans">
            <div className="p-3 bg-graphite-900 rounded-lg border border-graphite-700 flex flex-col gap-1">
              <span className="text-vapor-400 text-[11px] font-bold uppercase tracking-wider">
                Serviço com Risco Inerente:
              </span>
              <span className="text-amber-400 font-semibold text-[14px]">
                {data.servico_nome}
              </span>
            </div>

            <div className="p-3.5 bg-amber-500/10 border border-amber-500/40 rounded-lg flex flex-col gap-1.5">
              <span className="text-amber-300 font-bold text-[12px] uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle size={15} />
                Condição Preexistente Revelada Pós Pré-Lavagem:
              </span>
              <p className="text-vapor-100 text-[13px] leading-relaxed whitespace-pre-wrap">
                {data.observacoes_risco}
              </p>
            </div>
          </div>
        </Card>

        {/* DOSSIÊ FOTOGRÁFICO COMPARATIVO: ANTES x DURANTE */}
        <Card className="p-4 sm:p-6 bg-graphite-800 border-graphite-700 flex flex-col gap-5">
          <div className="flex items-center justify-between border-b border-graphite-700 pb-3">
            <div className="flex items-center gap-2">
              <Layers size={20} className="text-amber-400" />
              <h3 className="font-display text-[16px] text-vapor-100 uppercase">
                Dossiê Comparativo de Proteção (CDC)
              </h3>
            </div>
            <span className="font-mono text-[11px] text-vapor-400">
              Antes da Lavagem vs. Pós Pré-Lavagem
            </span>
          </div>

          {/* 1. FOTOS DO ANTES (VISTORIA INICIAL) */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="font-sans text-[12px] font-bold text-vapor-300 uppercase tracking-wide flex items-center gap-1.5">
                <Camera size={14} className="text-vapor-400" />
                1. Antes: Vistoria de Entrada (Como o veículo chegou com sujeira)
              </span>
              <span className="font-mono text-[11px] text-vapor-400">
                {data.fotos_antes?.length || 0} foto(s)
              </span>
            </div>

            {data.fotos_antes && data.fotos_antes.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {data.fotos_antes.map((f, idx) => (
                  <div
                    key={idx}
                    className="flex flex-col gap-1.5 bg-graphite-900 p-2.5 rounded-lg border border-graphite-700"
                  >
                    <img
                      src={f.url || f.path}
                      alt={f.descricao || `Entrada ${idx + 1}`}
                      className="w-full h-44 object-contain rounded bg-graphite-950 border border-graphite-800"
                    />
                    <span className="font-sans text-[11.5px] text-vapor-300 truncate">
                      {f.descricao || 'Veículo no recebimento (estado inicial)'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="font-sans text-[12px] text-vapor-500 italic p-3 bg-graphite-900 rounded-lg border border-graphite-800">
                Nenhuma foto registrada na vistoria inicial.
              </p>
            )}
          </div>

          <div className="border-t border-graphite-700 my-1" />

          {/* 2. FOTOS DO DURANTE (AVARIA REVELADA PÓS PRÉ-LAVAGEM) */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="font-sans text-[12px] font-bold text-amber-400 uppercase tracking-wide flex items-center gap-1.5">
                <Camera size={14} className="text-amber-400" />
                2. Durante: Avaria / Vício Preexistente Revelado após a Pré-Lavagem
              </span>
              <span className="font-mono text-[11px] text-amber-400">
                {data.fotos_durante?.length || 0} foto(s)
              </span>
            </div>

            {data.fotos_durante && data.fotos_durante.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {data.fotos_durante.map((f, idx) => (
                  <div
                    key={idx}
                    className="flex flex-col gap-1.5 bg-graphite-900 p-2.5 rounded-lg border border-amber-500/40"
                  >
                    <img
                      src={f.url || f.path}
                      alt={f.descricao || `Vício revelado ${idx + 1}`}
                      className="w-full h-44 object-contain rounded bg-graphite-950 border border-amber-500/30"
                    />
                    <span className="font-sans text-[11.5px] text-amber-300 font-medium">
                      {f.descricao || 'Avaria preexistente revelada após descontaminação'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="font-sans text-[12px] text-vapor-500 italic p-3 bg-graphite-900 rounded-lg border border-graphite-800">
                Foto de evidência não anexada.
              </p>
            )}
          </div>
        </Card>

        {/* Fundamentação Legal (CDC) */}
        <Card className="p-4 sm:p-6 bg-graphite-800 border-graphite-700 flex flex-col gap-3">
          <div className="flex items-center gap-2 border-b border-graphite-700 pb-3">
            <ShieldCheck size={20} className="text-amber-400" />
            <h3 className="font-display text-[16px] text-vapor-100 uppercase">
              Fundamentação Legal & Código de Defesa do Consumidor
            </h3>
          </div>

          <p className="font-sans text-[12px] text-vapor-300 leading-relaxed">
            Declaro estar ciente de que o serviço possui riscos inerentes à sua execução, especialmente em razão do estado de conservação, manutenção e condições preexistentes do veículo.
          </p>

          <p className="font-sans text-[12px] text-vapor-300 leading-relaxed">
            Autorizo expressamente a <strong>{data.oficina.razao_social || data.oficina.nome}</strong> a realizar o serviço, reconhecendo que a empresa não poderá ser responsabilizada por falhas ou danos decorrentes exclusivamente de defeitos preexistentes ou ocultos, falta de manutenção, desgaste natural, reparos anteriores, componentes ressecados ou já danificados e não identificáveis na recepção visual comum.
          </p>

          <p className="font-sans text-[12px] text-vapor-300 leading-relaxed">
            A empresa compromete-se a executar o serviço com técnica, cautela e procedimentos adequados. O presente documento cumpre os termos dos <strong>arts. 6º, III; 8º; 14, §3º; 40; 46 e 54, §4º, do CDC – Lei nº 8.078/90</strong>.
          </p>
        </Card>

        {/* Bloco de Assinatura Digital do Cliente */}
        <Card className="p-4 sm:p-6 bg-graphite-800 border-amber-500/40 flex flex-col gap-6 shadow-2xl">
          <div className="flex items-center justify-between border-b border-graphite-700 pb-3">
            <div className="flex items-center gap-3">
              <FileSignature size={24} className="text-amber-500 shrink-0" />
              <div>
                <h3 className="font-display text-[18px] text-vapor-100 uppercase">
                  {data.assinado ? 'Assinatura Registrada' : 'Assinatura Digital do Cliente'}
                </h3>
                <p className="font-sans text-[12px] text-vapor-400">
                  {data.assinado
                    ? 'Autorização assinada e arquivada com validade jurídica.'
                    : 'Assine na tela abaixo para autorizar o prosseguimento do serviço.'}
                </p>
              </div>
            </div>

            {data.assinado && (
              <Button
                type="button"
                variant="secondary"
                onClick={handleBaixarPDF}
                disabled={gerandoPDF}
                className="text-[12px] h-8 px-3 font-bold bg-graphite-900 border-graphite-700 hover:border-amber-500 flex items-center gap-1.5"
              >
                <Download size={13} />
                <span>{gerandoPDF ? 'Gerando...' : 'Baixar PDF'}</span>
              </Button>
            )}
          </div>

          {data.assinado ? (
            <div className="flex flex-col gap-4">
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/40 rounded-lg flex flex-col gap-2 text-emerald-300 font-sans text-[13px]">
                <div className="flex items-center gap-2 font-bold text-[14px]">
                  <CheckCircle2 size={18} /> Termo Assinado Digitalmente com Sucesso
                </div>
                <span>
                  Assinado por: <strong>{data.assinante_nome || 'Cliente'}</strong>
                </span>
                {data.assinado_em && (
                  <span className="font-mono text-[12px] text-emerald-400">
                    Data e Hora: {formatarDataHora(data.assinado_em)}
                  </span>
                )}
              </div>

              {data.assinatura_url && (
                <div className="flex flex-col gap-2">
                  <span className="font-sans text-[12px] text-vapor-400">
                    Comprovante da Assinatura:
                  </span>
                  <div className="p-3 bg-graphite-950 rounded-lg border border-graphite-700 flex justify-center">
                    <img
                      src={data.assinatura_url}
                      alt="Assinatura"
                      className="max-h-24 object-contain invert border-b border-amber-500/40 pb-2"
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {/* Nome do Assinante */}
              <div className="flex flex-col gap-1.5">
                <label className="font-sans text-[12px] font-bold text-vapor-200 uppercase tracking-wide">
                  Nome Completo do Assinante / Proprietário:
                </label>
                <input
                  type="text"
                  value={assinanteNome}
                  onChange={(e) => setAssinanteNome(e.target.value)}
                  placeholder="Digite seu nome completo..."
                  className="bg-graphite-900 border border-graphite-700 rounded-lg p-3 text-[13px] text-vapor-100 placeholder-vapor-500 focus:border-amber-500 outline-none"
                />
              </div>

              {/* Checkbox de Declaração */}
              <label className="flex items-start gap-3 p-3 bg-graphite-900 rounded-lg border border-graphite-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={declaracaoAceita}
                  onChange={(e) => setDeclaracaoAceita(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-graphite-600 text-amber-500 focus:ring-amber-500 bg-graphite-800"
                />
                <span className="font-sans text-[12.5px] text-vapor-200 leading-snug">
                  Declaro que examinei as fotos comparativas do estado inicial (<strong>Antes</strong>) e da avaria preexistente revelada após a pré-lavagem (<strong>Durante</strong>), autorizando a oficina a dar continuidade aos serviços adotando as melhores técnicas aplicáveis.
                </span>
              </label>

              {/* Canvas de Assinatura */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="font-sans text-[12px] font-bold text-vapor-200 uppercase tracking-wide">
                    Desenhe sua assinatura no quadro abaixo:
                  </span>
                  {hasSignature && (
                    <button
                      type="button"
                      onClick={handleClearSignature}
                      className="text-[11px] font-mono text-amber-400 hover:text-amber-300 flex items-center gap-1 transition-colors"
                    >
                      <RotateCcw size={12} /> Limpar
                    </button>
                  )}
                </div>

                <div className="w-full bg-graphite-950 border border-dashed border-graphite-700 rounded-lg overflow-hidden relative touch-none">
                  <canvas
                    ref={canvasRef}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                    className="w-full h-[180px] cursor-crosshair"
                  />
                  {!hasSignature && (
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                      <span className="font-sans text-[12px] text-vapor-600 italic">
                        Assine com o dedo ou mouse aqui
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {formErro && (
                <div className="p-3 bg-flare-500/10 border border-flare-500/30 rounded-lg text-flare-400 text-[12px] font-sans">
                  {formErro}
                </div>
              )}

              <Button
                type="button"
                variant="primary"
                onClick={handleConfirmSignature}
                disabled={submitting || !hasSignature || !declaracaoAceita || !assinanteNome.trim()}
                className="w-full h-11 text-[14px] font-bold bg-amber-500 hover:bg-amber-400 text-graphite-950 flex items-center justify-center gap-2 shadow-lg"
              >
                {submitting ? (
                  <span>Registrando Assinatura...</span>
                ) : (
                  <>
                    <Check size={16} />
                    <span>Confirmar e Assinar Termo Digitalmente</span>
                  </>
                )}
              </Button>
            </div>
          )}
        </Card>
      </div>
    </PublicLayout>
  );
};
