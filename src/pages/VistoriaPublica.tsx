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
} from 'lucide-react';
import { formatarData, formatarHora } from '../utils/datas';
import { formatarNomeVista, formatarNomeAvaria } from '../utils/checkin';
import type { VistaDiagrama, TipoAvaria } from '../types/checkin';

interface VistoriaPublicaData {
  oficina: {
    nome: string;
    logo_url?: string;
    cidade?: string;
    telefone?: string;
  };
  cliente: {
    primeiro_nome: string;
  };
  veiculo: {
    modelo: string;
    placa: string;
  };
  km?: number;
  nivel_combustivel?: number;
  iluminacao?: Record<string, string>;
  sujidade?: Record<string, string>;
  fluidos?: Record<string, string>;
  luzes_painel?: string[];
  estepe?: boolean;
  observacoes?: string;
  avarias?: Array<{
    vista: string;
    pos_x: number;
    pos_y: number;
    tipo: string;
    descricao?: string;
  }>;
  fotos?: Array<{
    foto_url: string;
    tipo?: string;
    descricao?: string;
    created_at?: string;
  }>;
  finalizado: boolean;
  finalizado_em?: string;
  assinatura_url?: string;
  assinante_nome?: string;
  aceite_tipo?: string;
  enviado_em?: string;
  erro?: string;
}

export const VistoriaPublica: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<VistoriaPublicaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Formulário de assinatura
  const [assinanteNome, setAssinanteNome] = useState('');
  const [declaracaoAceita, setDeclaracaoAceita] = useState(false);
  const [consentimentoPrivacidade, setConsentimentoPrivacidade] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  const fetchVistoria = async () => {
    const tokenLimpo = (token ?? '').trim();
    if (!tokenLimpo) {
      setError('Token de vistoria não fornecido.');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      console.log('token:', JSON.stringify(tokenLimpo), 'tipo:', typeof tokenLimpo);
      const { data: resData, error: resErr } = await supabase.rpc('vistoria_publica', {
        p_token: tokenLimpo,
      });

      if (resErr) {
        setError(resErr.message || 'Erro ao carregar dados da vistoria.');
        return;
      }

      if (resData?.erro) {
        setError(resData.erro);
        return;
      }

      const vistoriaData = resData as VistoriaPublicaData;

      // Buscar Signed URLs seguras das evidências via Edge Function (sem expor bucket nem paths)
      try {
        const { data: evidenciasRes, error: _fnErr } = await supabase.functions.invoke('evidencias-aceite', {
          body: { token_aceite: tokenLimpo },
        });

        if (evidenciasRes?.error) {
          if (evidenciasRes.expirado) {
            setError(evidenciasRes.error || 'Este link de vistoria expirou.');
            return;
          }
        }

        if (evidenciasRes?.fotos && Array.isArray(evidenciasRes.fotos)) {
          vistoriaData.fotos = evidenciasRes.fotos;
        }

        if (evidenciasRes?.finalizado) {
          vistoriaData.finalizado = true;
          if (evidenciasRes.assinante_nome) {
            vistoriaData.assinante_nome = evidenciasRes.assinante_nome;
          }
          if (evidenciasRes.assinatura_url) {
            vistoriaData.assinatura_url = evidenciasRes.assinatura_url;
          }
        }
      } catch (edgeErr) {
        console.warn('[VistoriaPublica]: Chamada da Edge Function evidencias-aceite ignorada ou falhou.', edgeErr);
      }

      setData(vistoriaData);
    } catch (err: any) {
      setError(err.message || 'Erro de conexão.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVistoria();
  }, [token]);

  // Setup Canvas Assinatura
  useEffect(() => {
    if (data && !data.finalizado) {
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
  }, [data?.finalizado]);

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
    if (submitting || data?.finalizado) return;
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
    if (!isDrawing || submitting || data?.finalizado) return;
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

  const [formErro, setFormErro] = useState<string | null>(null);

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
      setFormErro('Por favor, marque a declaração de conferência para prosseguir.');
      return;
    }

    setSubmitting(true);
    try {
      const dataUrl = canvas.toDataURL('image/png');

      console.log('token:', JSON.stringify(tokenLimpo), 'tipo:', typeof tokenLimpo);
      const { error: rpcErr } = await supabase.rpc('aceitar_vistoria_remoto', {
        p_token: tokenLimpo,
        p_assinatura_base64: dataUrl,
        p_nome: nomeClean,
        p_user_agent: navigator.userAgent,
      });

      if (rpcErr) {
        setFormErro('Erro ao confirmar assinatura: ' + rpcErr.message);
        return;
      }

      await fetchVistoria();
    } catch (err: any) {
      setFormErro('Erro ao enviar assinatura: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <PublicLayout>
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <span className="font-mono text-[14px] text-vapor-400">Carregando dados da vistoria...</span>
        </div>
      </PublicLayout>
    );
  }

  if (error || !data) {
    return (
      <PublicLayout>
        <div className="flex flex-col items-center justify-center py-12 gap-4 text-center max-w-md mx-auto">
          <AlertTriangle size={48} className="text-flare-400" />
          <h2 className="font-display text-[20px] text-vapor-100 uppercase">Link de Vistoria Inválido</h2>
          <p className="font-sans text-[14px] text-vapor-400">
            {error || 'Não foi possível encontrar as informações desta vistoria de entrada.'}
          </p>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <div className="w-full max-w-2xl mx-auto flex flex-col gap-6 pb-12 overflow-x-hidden">
        {/* Banner de Boas-vindas / Status */}
        <Card className="p-4 sm:p-6 bg-graphite-800 border-amber-500/30 flex flex-col gap-4 shadow-xl">
          <div className="flex items-center justify-between border-b border-graphite-700 pb-4">
            <div>
              <span className="font-mono text-[11px] text-amber-400 font-bold uppercase tracking-wider block">
                {data.oficina.nome}
              </span>
              <h1 className="font-display text-[22px] text-vapor-100 uppercase tracking-wide">
                Vistoria de Entrada
              </h1>
            </div>
            {data.finalizado ? (
              <span className="px-3 py-1 rounded-full text-[12px] font-mono font-bold bg-emerald-500/20 border border-emerald-400 text-emerald-300 flex items-center gap-1.5 shrink-0">
                <CheckCircle2 size={14} /> Assinada
              </span>
            ) : (
              <span className="px-3 py-1 rounded-full text-[12px] font-mono font-bold bg-amber-500/20 border border-amber-400 text-amber-300 flex items-center gap-1.5 shrink-0">
                <ShieldCheck size={14} /> Aguardando Assinatura
              </span>
            )}
          </div>

          <p className="font-sans text-[13px] text-vapor-300 leading-relaxed">
            Olá, <strong className="text-amber-400">{data.cliente.primeiro_nome}</strong>! Por favor, confira os dados da vistoria de entrada do seu veículo antes de iniciarmos os serviços.
          </p>
        </Card>

        {/* Resumo do Veículo */}
        <Card className="p-4 sm:p-6 bg-graphite-800 border-graphite-700 flex flex-col gap-4">
          <div className="flex items-center gap-3 border-b border-graphite-700 pb-3">
            <Car size={24} className="text-amber-500 shrink-0" />
            <div>
              <h3 className="font-display text-[16px] text-vapor-100 uppercase">Identificação do Veículo</h3>
              <span className="font-mono text-[12px] text-amber-400 font-bold">{data.veiculo.placa}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-sans text-[13px]">
            <div className="bg-graphite-900 p-3 rounded-lg border border-graphite-700 flex flex-col">
              <span className="text-vapor-400 text-[11px]">Modelo:</span>
              <strong className="text-vapor-100 font-semibold">{data.veiculo.modelo}</strong>
            </div>

            <div className="bg-graphite-900 p-3 rounded-lg border border-graphite-700 flex flex-col">
              <span className="text-vapor-400 text-[11px]">Quilometragem:</span>
              <strong className="text-vapor-100 font-semibold font-mono">
                {data.km ? `${data.km.toLocaleString()} km` : 'Não informada'}
              </strong>
            </div>

            <div className="bg-graphite-900 p-3 rounded-lg border border-graphite-700 flex flex-col">
              <span className="text-vapor-400 text-[11px]">Combustível:</span>
              <strong className="text-amber-400 font-semibold font-mono">
                {data.nivel_combustivel === 0
                  ? 'E (Vazio)'
                  : data.nivel_combustivel === 8
                  ? 'F (Cheio)'
                  : `${data.nivel_combustivel || 0}/8`}
              </strong>
            </div>

            <div className="bg-graphite-900 p-3 rounded-lg border border-graphite-700 flex flex-col">
              <span className="text-vapor-400 text-[11px]">Estepe:</span>
              <strong className="text-vapor-100 font-semibold">
                {data.estepe === true ? 'Sim' : data.estepe === false ? 'Ausente' : 'N/A'}
              </strong>
            </div>
          </div>
        </Card>

        {/* Inspeção Externa, Sujidade e Fluidos */}
        <Card className="p-4 sm:p-6 bg-graphite-800 border-graphite-700 flex flex-col gap-4">
          <h3 className="font-display text-[16px] text-vapor-100 uppercase border-b border-graphite-700 pb-3 flex items-center gap-2">
            <Sparkles size={20} className="text-amber-500" /> Checklist de Estado Geral
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Iluminação */}
            <div className="bg-graphite-900 p-3 rounded-lg border border-graphite-700 flex flex-col gap-2">
              <span className="font-mono text-[11px] text-amber-400 font-bold uppercase">Iluminação Externa</span>
              {data.iluminacao && Object.keys(data.iluminacao).length > 0 ? (
                <div className="flex flex-col gap-1.5 text-[12px]">
                  {Object.entries(data.iluminacao).map(([k, v]) => (
                    <div key={k} className="flex justify-between border-b border-graphite-800 pb-1">
                      <span className="text-vapor-300 capitalize">{k.replace('_', ' ')}</span>
                      <strong className={v === 'queimado' ? 'text-flare-400' : 'text-vapor-100'}>
                        {v === 'ok' ? 'OK' : v === 'queimado' ? 'Queimado' : 'N/A'}
                      </strong>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-vapor-500 text-[12px] italic">Sem itens testados</span>
              )}
            </div>

            {/* Sujidade */}
            <div className="bg-graphite-900 p-3 rounded-lg border border-graphite-700 flex flex-col gap-2">
              <span className="font-mono text-[11px] text-amber-400 font-bold uppercase">Nível de Sujidade</span>
              {data.sujidade && Object.keys(data.sujidade).length > 0 ? (
                <div className="flex flex-col gap-1.5 text-[12px]">
                  {Object.entries(data.sujidade).map(([k, v]) => (
                    <div key={k} className="flex justify-between border-b border-graphite-800 pb-1">
                      <span className="text-vapor-300 capitalize">{k.replace('_', ' ')}</span>
                      <strong className="text-amber-400 uppercase font-mono">{v}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-vapor-500 text-[12px] italic">Sem itens informados</span>
              )}
            </div>
          </div>
        </Card>

        {/* Marcações de Avaria */}
        <Card className="p-4 sm:p-6 bg-graphite-800 border-graphite-700 flex flex-col gap-4">
          <h3 className="font-display text-[16px] text-vapor-100 uppercase border-b border-graphite-700 pb-3 flex items-center justify-between">
            <span>Avarias Registradas</span>
            <span className="font-mono text-[12px] text-amber-400 font-bold">
              {data.avarias?.length || 0} marcação(ões)
            </span>
          </h3>

          {data.avarias && data.avarias.length > 0 ? (
            <div className="flex flex-col gap-2">
              {data.avarias.map((av, idx) => (
                <div key={idx} className="p-3 bg-graphite-900 rounded-lg border border-graphite-700 flex flex-col gap-1">
                  <div className="flex items-center justify-between font-sans text-[13px]">
                    <strong className="text-amber-400 font-bold">
                      {idx + 1}. {formatarNomeVista(av.vista as VistaDiagrama)} — {formatarNomeAvaria(av.tipo as TipoAvaria)}
                    </strong>
                  </div>
                  {av.descricao && (
                    <p className="font-sans text-[12px] text-vapor-300 italic pl-3 border-l-2 border-amber-500/40">
                      {av.descricao}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="font-sans text-[13px] text-vapor-400 italic">
              Nenhuma avaria ou risco registrado no momento da recepção do veículo.
            </p>
          )}
        </Card>

        {/* Galeria de Fotos */}
        {data.fotos && data.fotos.length > 0 && (
          <Card className="p-4 sm:p-6 bg-graphite-800 border-graphite-700 flex flex-col gap-4">
            <h3 className="font-display text-[16px] text-vapor-100 uppercase border-b border-graphite-700 pb-3 flex items-center gap-2">
              <Camera size={20} className="text-amber-500" /> Evidências Fotográficas ({data.fotos.length})
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {data.fotos.map((f, idx) => (
                <div key={idx} className="flex flex-col gap-2 bg-graphite-900 p-3 rounded-lg border border-graphite-700">
                  <img
                    src={f.foto_url}
                    alt={f.descricao || `Foto ${idx + 1}`}
                    className="w-full h-56 object-contain rounded bg-graphite-950 border border-graphite-800"
                  />
                  {f.descricao && <span className="font-sans text-[12px] text-vapor-200">{f.descricao}</span>}
                  {f.created_at && (
                    <span className="font-mono text-[11px] text-vapor-400">
                      {formatarData(f.created_at)} {formatarHora(f.created_at)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Bloco de Assinatura Digital / Confirmação */}
        <Card className="p-4 sm:p-6 bg-graphite-800 border-amber-500/40 flex flex-col gap-6 shadow-2xl">
          <div className="flex items-center gap-3 border-b border-graphite-700 pb-3">
            <FileSignature size={24} className="text-amber-500 shrink-0" />
            <div>
              <h3 className="font-display text-[18px] text-vapor-100 uppercase">
                {data.finalizado ? 'Assinatura do Aceite' : 'Assinatura Digital do Cliente'}
              </h3>
              <p className="font-sans text-[12px] text-vapor-400">
                {data.finalizado
                  ? 'Vistoria devidamente aprovada e registrada.'
                  : 'Assine na tela para validar a vistoria de entrada.'}
              </p>
            </div>
          </div>

          {data.finalizado ? (
            <div className="flex flex-col gap-4">
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/40 rounded-lg flex flex-col gap-2 text-emerald-300 font-sans text-[13px]">
                <div className="flex items-center gap-2 font-bold text-[14px]">
                  <CheckCircle2 size={18} /> Vistoria Aceita e Finalizada Remotamente
                </div>
                <span>Assinado por: <strong>{data.assinante_nome || 'Cliente'}</strong></span>
                {data.finalizado_em && (
                  <span className="font-mono text-[12px] text-emerald-400">
                    Data: {formatarData(data.finalizado_em)} às {formatarHora(data.finalizado_em)}
                  </span>
                )}
              </div>

              {data.assinatura_url && (
                <div className="flex flex-col gap-2">
                  <span className="font-sans text-[12px] text-vapor-400">Assinatura Digital Registrada:</span>
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
              <div className="flex flex-col gap-2">
                <label className="font-sans text-[13px] text-vapor-200 font-semibold">
                  Seu Nome Completo: <span className="text-flare-400">*</span>
                </label>
                <input
                  type="text"
                  value={assinanteNome}
                  onChange={(e) => setAssinanteNome(e.target.value)}
                  placeholder="Digite seu nome completo"
                  className="appearance-none bg-graphite-700 border border-graphite-600 rounded-lg p-3 text-vapor-100 placeholder-vapor-500 font-sans text-[14px] outline-none focus:border-amber-500 min-h-[48px]"
                />
              </div>

              {/* Canvas de Assinatura */}
              <div className="flex flex-col gap-2">
                <label className="font-sans text-[13px] text-vapor-200 font-semibold">
                  Desenhe sua Assinatura na Caixa Abaixo: <span className="text-flare-400">*</span>
                </label>
                <div className="relative rounded-lg border-2 border-dashed border-graphite-600 bg-graphite-950 overflow-hidden">
                  <canvas
                    ref={canvasRef}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                    className="w-full h-44 cursor-crosshair touch-none"
                  />
                  {!hasSignature && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-vapor-500 font-sans text-[13px] font-medium">
                      Assine aqui usando o dedo ou o mouse
                    </div>
                  )}
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleClearSignature}
                    disabled={!hasSignature || submitting}
                    className="px-3 py-1.5 rounded text-[12px] text-vapor-400 hover:text-vapor-100 hover:bg-graphite-700 disabled:opacity-40 transition-colors flex items-center gap-1.5"
                  >
                    <RotateCcw size={14} /> Limpar Assinatura
                  </button>
                </div>
              </div>

              {/* Declaração Legal */}
              <label className="flex items-start gap-3 p-3 bg-graphite-900 rounded-lg border border-graphite-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={declaracaoAceita}
                  onChange={(e) => setDeclaracaoAceita(e.target.checked)}
                  className="mt-0.5 w-5 h-5 rounded border-graphite-600 text-amber-500 focus:ring-amber-500 bg-graphite-950 shrink-0 cursor-pointer"
                />
                <span className="font-sans text-[12px] text-vapor-300 leading-relaxed italic">
                  "Declaro que conferi e que as informações e avarias registradas refletem com precisão o estado do meu veículo na entrega à oficina."
                </span>
              </label>

              {/* Consentimento Legal LGPD */}
              <label className="flex items-start gap-3 p-3 bg-graphite-900 rounded-lg border border-graphite-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={consentimentoPrivacidade}
                  onChange={(e) => setConsentimentoPrivacidade(e.target.checked)}
                  className="mt-0.5 w-5 h-5 rounded border-graphite-600 text-amber-500 focus:ring-amber-500 bg-graphite-950 shrink-0 cursor-pointer"
                />
                <span className="font-sans text-[12px] text-vapor-300 leading-relaxed">
                  Autorizo a oficina a guardar meus dados e as fotos do meu veículo para registro do atendimento.{' '}
                  <a
                    href="/politica-de-privacidade"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-amber-400 hover:text-amber-300 underline font-medium"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Política de Privacidade
                  </a>
                </span>
              </label>

              {formErro && (
                <div className="p-3.5 bg-flare-500/10 border border-flare-500/30 rounded-lg text-flare-400 font-sans text-[13px] flex items-center gap-2">
                  <AlertTriangle size={16} className="shrink-0" />
                  <span>{formErro}</span>
                </div>
              )}

              {/* Botão de Confirmação */}
              <Button
                type="button"
                variant="primary"
                onClick={handleConfirmSignature}
                disabled={submitting || !hasSignature || !declaracaoAceita || !consentimentoPrivacidade || assinanteNome.trim().length < 3}
                className="w-full min-h-[52px] font-bold text-[15px] flex items-center justify-center gap-2 shadow-lg"
              >
                <Check size={20} />
                <span>{submitting ? 'Gravando Assinatura...' : 'Confirmar e Assinar Vistoria'}</span>
              </Button>
            </div>
          )}
        </Card>
      </div>
    </PublicLayout>
  );
};
