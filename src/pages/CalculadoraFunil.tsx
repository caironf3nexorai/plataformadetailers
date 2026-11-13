import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock,
  Droplets,
  FileSpreadsheet,
  Layers,
  Lock,
  Play,
  Sparkles,
  Unlock,
} from 'lucide-react';
import { LogoNuvemWash } from '../components/ui/LogoNuvemWash';
import { MiniCalculadoraInterativa } from '../components/calculadora/MiniCalculadoraInterativa';
import { supabase } from '../lib/supabase';
import { formatTelefone } from '../utils/formatters';
import { trackLead } from '../utils/pixel';
import {
  CALCULADORA_LEAD_STORAGE_KEY,
  type CalculadoraLeadErrors,
  type CalculadoraLeadSessao,
  MOMENTOS_ESTETICA,
  SIMULADOR_FILENAME,
  construirUrlCadastroComLead,
  dispararDownloadSimulador,
  normalizarEmbedVideoUrl,
  validarFormularioLead,
} from '../utils/calculadoraLead';

/**
 * Cole aqui o link do seu vídeo explicativo (YouTube, Vimeo ou Panda Video)
 * ou defina VITE_CALCULADORA_VIDEO_URL no .env para renderizar o player automaticamente.
 */
const VIDEO_TUTORIAL_EMBED_URL = import.meta.env.VITE_CALCULADORA_VIDEO_URL || '';

interface CalculadoraFunilProps {
  estadoInicial?: 'captura' | 'obrigado';
}

interface ComparisonItem {
  titulo: string;
  planilhaStatus: string;
  sistemaStatus: string;
  icone: React.ReactNode;
}

const COMPARATIVO_CONVERSAO: ComparisonItem[] = [
  {
    titulo: 'Cronômetro de Pátio ao Vivo na OS',
    planilhaStatus: 'Estimativa cega no papel (o funcionário enrola 40 min e seu lucro vira prejuízo sem você ver)',
    sistemaStatus: 'Controle de tempo real na tela do operador com custo exato de mão de obra registrado na OS',
    icone: <Clock size={18} className="text-amber-500 shrink-0" />,
  },
  {
    titulo: 'Matriz Automática do Hatch à Caminhonete',
    planilhaStatus: 'Cálculo manual e lento serviço por serviço (você perde venda pela demora no orçamento)',
    sistemaStatus: 'Preços em cascata para os 4 portes de veículos calculados em 1 clique com margem blindada',
    icone: <Layers size={18} className="text-glass-400 shrink-0" />,
  },
  {
    titulo: 'Calibração de Snow Foam & Baixa no Estoque',
    planilhaStatus: 'Fórmula estática que a sua equipe ignora e continua jogando galão de R$ 300 pelo ralo',
    sistemaStatus: 'Perfis salvos por lavadora/snow foam com baixa automática de mL direto no estoque da oficina',
    icone: <Droplets size={18} className="text-mint-400 shrink-0" />,
  },
  {
    titulo: 'DRE Líquido com Taxas Reais de Maquininha',
    planilhaStatus: 'Cálculo ilusório que esquece taxas de cartão parcelado, comissões e impostos',
    sistemaStatus: 'Lucro líquido cirúrgico descontando na hora as taxas da sua maquininha, comissões e custos fixos',
    icone: <BarChart3 size={18} className="text-amber-500 shrink-0" />,
  },
];

export const CalculadoraFunil: React.FC<CalculadoraFunilProps> = ({
  estadoInicial = 'captura',
}) => {
  const location = useLocation();
  const navigate = useNavigate();

  const statePayload = (location.state as {
    lead?: CalculadoraLeadSessao;
    downloadMissingFile?: boolean;
  } | null) || null;

  const [etapa, setEtapa] = useState<'captura' | 'obrigado'>(estadoInicial);
  const [nome, setNome] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [momentoEstetica, setMomentoEstetica] = useState('');

  const [fieldErrors, setFieldErrors] = useState<CalculadoraLeadErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [leadSessao, setLeadSessao] = useState<CalculadoraLeadSessao | null>(() => {
    if (statePayload?.lead) return statePayload.lead;
    try {
      const saved = sessionStorage.getItem(CALCULADORA_LEAD_STORAGE_KEY);
      return saved ? (JSON.parse(saved) as CalculadoraLeadSessao) : null;
    } catch {
      return null;
    }
  });

  const [downloading, setDownloading] = useState(false);
  const [downloadAviso, setDownloadAviso] = useState<string | null>(() =>
    statePayload?.downloadMissingFile
      ? `Seu acesso foi liberado! Assim que o arquivo "${SIMULADOR_FILENAME}" estiver publicado em public/downloads/, o download iniciará automaticamente.`
      : null
  );

  // Sincroniza etapa ao navegar entre /calculadora e /calculadora/obrigado
  useEffect(() => {
    setEtapa(estadoInicial);
  }, [estadoInicial]);

  useEffect(() => {
    if (statePayload?.lead) {
      setLeadSessao(statePayload.lead);
    }
  }, [statePayload]);

  const embedUrl = useMemo(
    () => normalizarEmbedVideoUrl(VIDEO_TUTORIAL_EMBED_URL),
    []
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    const validacao = validarFormularioLead({
      nome,
      whatsapp,
      email,
      momento_estetica: momentoEstetica,
    });

    if (!validacao.valido) {
      setFieldErrors(validacao.erros);
      return;
    }

    setFieldErrors({});
    setSubmitting(true);

    try {
      const { normalizado } = validacao;
      let leadId: string | null = null;

      // 1. Grava o lead com RPC SECURITY DEFINER (evita SELECT aberto na tabela para anon)
      const { data: rpcData, error: rpcError } = await supabase.rpc(
        'registrar_lead_calculadora',
        {
          p_nome: normalizado.nome,
          p_whatsapp: normalizado.whatsapp,
          p_email: normalizado.email,
          p_momento_estetica: normalizado.momento_estetica,
        }
      );

      if (rpcError) {
        // Fallback caso o ambiente ainda não tenha aplicado a função RPC, tentando INSERT direto
        const isMissingRpc =
          rpcError.code === '42883' ||
          rpcError.code === 'PGRST202' ||
          rpcError.message?.toLowerCase().includes('registrar_lead_calculadora');

        if (!isMissingRpc) {
          throw rpcError;
        }

        const { error: insertError } = await supabase
          .from('leads_calculadora')
          .insert({
            nome: normalizado.nome,
            whatsapp: normalizado.whatsapp,
            email: normalizado.email,
            momento_estetica: normalizado.momento_estetica,
            downloaded_at: new Date().toISOString(),
            converted_to_user: false,
          });

        if (insertError) {
          throw insertError;
        }
      } else if (typeof rpcData === 'string') {
        leadId = rpcData;
      }

      const novaSessao: CalculadoraLeadSessao = {
        ...normalizado,
        leadId,
        downloadedAt: new Date().toISOString(),
      };

      setLeadSessao(novaSessao);
      try {
        sessionStorage.setItem(
          CALCULADORA_LEAD_STORAGE_KEY,
          JSON.stringify(novaSessao)
        );
      } catch {}

      // 2. Dispara evento de Lead para Meta Pixel / GA4 / TikTok Pixel
      trackLead({
        content_name: 'Simulador Oficial NuvemWash v5',
        content_category: 'Simulador de Precificacao',
        momento_estetica: normalizado.momento_estetica,
      });

      // 3. Dispara o download do arquivo .xlsx
      const downloadRes = await dispararDownloadSimulador();
      const missingFile = Boolean(downloadRes.missingFile);

      if (missingFile) {
        setDownloadAviso(
          `Seu acesso foi liberado! O download automático estará disponível assim que o arquivo "${SIMULADOR_FILENAME}" for colocado em public/downloads/.`
        );
      } else {
        setDownloadAviso(null);
      }

      // 4. Move para tela de Obrigado mantendo compatibilidade com rota dedicada e estado local
      setEtapa('obrigado');
      navigate('/calculadora/obrigado', {
        state: {
          lead: novaSessao,
          downloadMissingFile: missingFile,
        },
      });
    } catch (err: any) {
      console.error('[CalculadoraFunil] Erro ao salvar lead:', err);
      setSubmitError(
        err?.message ||
          'Não foi possível liberar o simulador agora. Verifique sua conexão e tente novamente.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleManualDownload = async () => {
    setDownloading(true);
    setDownloadAviso(null);
    const res = await dispararDownloadSimulador();
    setDownloading(false);

    if (!res.ok) {
      setDownloadAviso(
        res.missingFile
          ? `Arquivo "${SIMULADOR_FILENAME}" ainda não encontrado em /downloads/. Verifique se ele foi adicionado em public/downloads/.`
          : 'Não foi possível iniciar o download automaticamente. Tente novamente em instantes.'
      );
    }
  };

  const handleIrParaCadastro = () => {
    const cadastroUrl = construirUrlCadastroComLead(leadSessao);
    navigate(cadastroUrl, {
      state: {
        fromCalculadora: true,
        lead: leadSessao,
      },
    });
  };

  const primeiroNome = leadSessao?.nome?.trim().split(/\s+/)[0] || '';

  return (
    <div className="min-h-screen bg-graphite-950 text-vapor-100 flex flex-col font-sans selection:bg-amber-500 selection:text-graphite-950">
      {/* Header focado com logo oficial */}
      <header className="border-b border-graphite-600/80 bg-graphite-900/90 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 min-h-[60px] flex items-center justify-between gap-3">
          <Link
            to="/"
            className="flex items-center gap-2 hover:opacity-90 transition-opacity shrink-0"
            aria-label="Página inicial NuvemWash"
          >
            <LogoNuvemWash size="sm" />
          </Link>

          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-graphite-800 border border-graphite-600 text-[11px] font-mono uppercase tracking-wider text-glass-400">
            <FileSpreadsheet size={13} className="shrink-0" />
            <span>Simulador Financeiro Oficial • Download Gratuito</span>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {etapa === 'captura' ? (
          <div className="flex flex-col gap-8">
            {/* Header da Captura: Headline & Choque */}
            <section className="flex flex-col gap-4 text-center items-center max-w-3xl mx-auto">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-500 text-xs font-mono uppercase tracking-wider">
                <AlertTriangle size={14} className="shrink-0 text-amber-500 animate-pulse" />
                <span>DIAGNÓSTICO DE LUCRO REAL • TESTE NO CELULAR</span>
              </div>

              <h1 className="font-display text-[26px] sm:text-[36px] lg:text-[42px] font-extrabold text-vapor-100 leading-[1.12] tracking-tight">
                Você Trabalha 12 Horas por Dia e Não Vê a Cor do Dinheiro? Descubra em 60 Segundos Onde Sua Estética Está Sangrando Lucro.
              </h1>

              <p className="font-sans text-[15px] sm:text-[17px] text-vapor-400 leading-relaxed max-w-2xl">
                Mais de <strong className="text-vapor-100">78% dos donos de estética pagam para trabalhar</strong> porque cobram no olhômetro. Simule abaixo em tempo real com os números da sua oficina antes de baixar o Excel:
              </p>
            </section>

            {/* =============================================================== */}
            {/* PARTE 1: A MINI-CALCULADORA INTERATIVA                          */}
            {/* =============================================================== */}
            <section aria-label="Mini-Calculadora Interativa">
              <MiniCalculadoraInterativa />
            </section>

            {/* =============================================================== */}
            {/* PARTE 2: FORMULÁRIO DE CAPTURA E REDIRECIONAMENTO (SUPABASE)    */}
            {/* =============================================================== */}
            <section
              id="captura-planilha"
              className="bg-graphite-800 border-2 border-amber-500/70 rounded-[8px] p-5 sm:p-7 shadow-2xl flex flex-col gap-6"
            >
              <div className="flex flex-col gap-2 pb-4 border-b border-graphite-600/80">
                <div className="inline-flex items-center gap-1.5 self-start px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-500 text-[11px] font-mono uppercase tracking-wider">
                  <Sparkles size={13} />
                  <span>Leve o Diagnóstico Completo Para a Sua Oficina</span>
                </div>

                <h2 className="font-display text-xl sm:text-2xl font-bold text-vapor-100 leading-tight">
                  Quer fazer a análise completa de Snow Foam, Restauração de Faróis e DRE? Baixe a Planilha Oficial NuvemWash gratuitamente.
                </h2>
                <p className="text-xs sm:text-sm text-vapor-400">
                  Preencha abaixo para receber o arquivo oficial em Excel (.xlsx) com as 5 abas integradas:
                </p>
              </div>

              {submitError && (
                <div className="p-3 rounded-[6px] bg-flare-400/10 border border-flare-400/40 text-flare-400 text-xs flex items-start gap-2">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  <span>{submitError}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} noValidate className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Campo 1: Nome */}
                <div className="flex flex-col gap-1.5 sm:col-span-1">
                  <label
                    htmlFor="lead-nome"
                    className="font-display text-[11px] uppercase tracking-wider text-vapor-400"
                  >
                    Nome *
                  </label>
                  <input
                    id="lead-nome"
                    type="text"
                    autoComplete="name"
                    placeholder="Ex: João da Silva"
                    value={nome}
                    onChange={(e) => {
                      setNome(e.target.value);
                      if (fieldErrors.nome) {
                        setFieldErrors((prev) => ({ ...prev, nome: undefined }));
                      }
                    }}
                    disabled={submitting}
                    className={`w-full min-h-[48px] px-4 rounded-[4px] bg-graphite-900 border ${
                      fieldErrors.nome ? 'border-flare-400' : 'border-graphite-600'
                    } text-[15px] text-vapor-100 placeholder:text-vapor-600 focus:outline-none focus:border-amber-500 transition-colors`}
                    required
                  />
                  {fieldErrors.nome && (
                    <span className="text-xs text-flare-400">{fieldErrors.nome}</span>
                  )}
                </div>

                {/* Campo 2: WhatsApp */}
                <div className="flex flex-col gap-1.5 sm:col-span-1">
                  <label
                    htmlFor="lead-whatsapp"
                    className="font-display text-[11px] uppercase tracking-wider text-vapor-400"
                  >
                    WhatsApp (com DDD) *
                  </label>
                  <input
                    id="lead-whatsapp"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="(11) 99999-9999"
                    value={whatsapp}
                    onChange={(e) => {
                      setWhatsapp(formatTelefone(e.target.value));
                      if (fieldErrors.whatsapp) {
                        setFieldErrors((prev) => ({ ...prev, whatsapp: undefined }));
                      }
                    }}
                    disabled={submitting}
                    className={`w-full min-h-[48px] px-4 rounded-[4px] bg-graphite-900 border ${
                      fieldErrors.whatsapp ? 'border-flare-400' : 'border-graphite-600'
                    } font-mono text-[15px] text-vapor-100 placeholder:text-vapor-600 focus:outline-none focus:border-amber-500 transition-colors`}
                    required
                  />
                  {fieldErrors.whatsapp && (
                    <span className="text-xs text-flare-400">{fieldErrors.whatsapp}</span>
                  )}
                </div>

                {/* Campo 3: E-mail */}
                <div className="flex flex-col gap-1.5 sm:col-span-1">
                  <label
                    htmlFor="lead-email"
                    className="font-display text-[11px] uppercase tracking-wider text-vapor-400"
                  >
                    E-mail *
                  </label>
                  <input
                    id="lead-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="seu@email.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (fieldErrors.email) {
                        setFieldErrors((prev) => ({ ...prev, email: undefined }));
                      }
                    }}
                    disabled={submitting}
                    className={`w-full min-h-[48px] px-4 rounded-[4px] bg-graphite-900 border ${
                      fieldErrors.email ? 'border-flare-400' : 'border-graphite-600'
                    } text-[15px] text-vapor-100 placeholder:text-vapor-600 focus:outline-none focus:border-amber-500 transition-colors`}
                    required
                  />
                  {fieldErrors.email && (
                    <span className="text-xs text-flare-400">{fieldErrors.email}</span>
                  )}
                </div>

                {/* Campo 4: Momento atual da estética */}
                <div className="flex flex-col gap-1.5 sm:col-span-1">
                  <label
                    htmlFor="lead-momento"
                    className="font-display text-[11px] uppercase tracking-wider text-vapor-400"
                  >
                    Momento da sua Estética *
                  </label>
                  <select
                    id="lead-momento"
                    value={momentoEstetica}
                    onChange={(e) => {
                      setMomentoEstetica(e.target.value);
                      if (fieldErrors.momento_estetica) {
                        setFieldErrors((prev) => ({
                          ...prev,
                          momento_estetica: undefined,
                        }));
                      }
                    }}
                    disabled={submitting}
                    className={`w-full min-h-[48px] px-4 rounded-[4px] bg-graphite-900 border ${
                      fieldErrors.momento_estetica
                        ? 'border-flare-400'
                        : 'border-graphite-600'
                    } text-[14px] ${
                      momentoEstetica ? 'text-vapor-100' : 'text-vapor-400'
                    } focus:outline-none focus:border-amber-500 transition-colors`}
                    required
                  >
                    <option value="" disabled>
                      Selecione o momento da sua estética...
                    </option>
                    {MOMENTOS_ESTETICA.map((opcao) => (
                      <option key={opcao} value={opcao} className="bg-graphite-900 text-vapor-100">
                        {opcao}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.momento_estetica && (
                    <span className="text-xs text-flare-400">
                      {fieldErrors.momento_estetica}
                    </span>
                  )}
                </div>

                <div className="sm:col-span-2 flex flex-col gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full min-h-[54px] px-6 py-4 rounded-[6px] bg-amber-500 hover:bg-amber-600 active:scale-[0.99] text-graphite-950 font-display font-extrabold text-[14px] sm:text-[16px] uppercase tracking-wide flex items-center justify-center gap-2 transition-all shadow-xl shadow-amber-500/20 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {submitting ? (
                      <>
                        <span className="w-4 h-4 border-2 border-graphite-950 border-t-transparent rounded-full animate-spin" />
                        <span>LIBERANDO SEU ACESSO...</span>
                      </>
                    ) : (
                      <>
                        <span>LIBERAR PLANILHA OFICIAL EM EXCEL (.XLSX) AGORA</span>
                        <ArrowRight size={18} className="shrink-0" />
                      </>
                    )}
                  </button>

                  <p className="text-[11px] text-vapor-400 text-center leading-relaxed">
                    Download instantâneo do arquivo oficial <span className="font-mono text-vapor-100">.xlsx</span>. Seus dados estão 100% seguros conforme a{' '}
                    <Link to="/politica-de-privacidade" className="text-glass-400 hover:underline">
                      Política de Privacidade
                    </Link>
                    .
                  </p>
                </div>
              </form>
            </section>
          </div>
        ) : (
          /* =================================================================== */
          /* ESTADO DE OBRIGADO / ONBOARDING                                     */
          /* =================================================================== */
          <div className="max-w-4xl mx-auto flex flex-col gap-6 sm:gap-8">
            {/* Banner de Confirmação + Download Secundário */}
            <section className="bg-graphite-800 border border-mint-400/40 rounded-[8px] p-5 sm:p-6 flex flex-col gap-4 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  <div className="w-11 h-11 rounded-[8px] bg-mint-400/15 border border-mint-400/40 text-mint-400 flex items-center justify-center shrink-0">
                    <CheckCircle2 size={24} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-mint-400">
                      Acesso Liberado com Sucesso
                    </span>
                    <h1 className="font-display text-xl sm:text-2xl font-extrabold text-vapor-100 leading-tight">
                      {primeiroNome
                        ? `Parabéns, ${primeiroNome}! Seu Simulador já foi liberado.`
                        : 'Parabéns! Seu Simulador Oficial já foi liberado.'}
                    </h1>
                    <p className="text-xs sm:text-sm text-vapor-400">
                      O download do arquivo <span className="font-mono text-vapor-100">{SIMULADOR_FILENAME}</span> começou automaticamente. Se o navegador do celular bloqueou, clique no botão ao lado:
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleManualDownload}
                  disabled={downloading}
                  className="w-full sm:w-auto shrink-0 min-h-[46px] px-4 py-2.5 rounded-[6px] bg-graphite-700 hover:bg-graphite-600 border border-graphite-600 text-vapor-100 font-sans font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-60"
                >
                  <span>
                    {downloading ? 'Baixando...' : '📥 Baixar Planilha em Excel (.xlsx)'}
                  </span>
                </button>
              </div>

              {downloadAviso && (
                <div className="p-3 rounded-[6px] bg-glass-400/10 border border-glass-400/30 text-glass-400 text-xs flex items-start gap-2">
                  <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                  <span>{downloadAviso}</span>
                </div>
              )}
            </section>

            {/* Espaço em Destaque para Vídeo Tutorial (Exibido automaticamente quando houver URL configurada) */}
            {embedUrl && (
              <section className="bg-graphite-800 border border-graphite-600 rounded-[8px] p-4 sm:p-6 flex flex-col gap-4 shadow-xl">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-[6px] bg-amber-500/15 border border-amber-500/30 text-amber-500 flex items-center justify-center shrink-0">
                      <Play size={16} />
                    </div>
                    <div>
                      <h2 className="font-display text-base sm:text-lg font-bold text-vapor-100">
                        Assista Antes de Abrir: Como Usar o Simulador em 2 Minutos
                      </h2>
                      <p className="text-xs text-vapor-400">
                        O passo a passo rápido para calcular seu Custo do Minuto de Pátio e calibrar a Snow Foam sem erro.
                      </p>
                    </div>
                  </div>
                  <span className="self-start sm:self-auto font-mono text-[11px] uppercase px-2.5 py-1 rounded bg-graphite-900 border border-graphite-600 text-amber-500">
                    Tutorial Rápido
                  </span>
                </div>

                <div className="relative w-full aspect-video rounded-[6px] overflow-hidden border border-graphite-600 bg-graphite-950">
                  <iframe
                    src={embedUrl}
                    title="Tutorial Simulador Oficial NuvemWash"
                    className="absolute inset-0 w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                </div>
              </section>
            )}

            {/* Card de Conversão: Planilha Bloqueada vs Sistema Completo NuvemWash */}
            <section className="bg-graphite-800 border-2 border-amber-500/50 rounded-[8px] p-5 sm:p-7 flex flex-col gap-6 shadow-2xl relative overflow-hidden">
              <div className="flex flex-col gap-2">
                <div className="inline-flex items-center gap-1.5 self-start px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-500 text-[11px] font-mono uppercase tracking-wider">
                  <Sparkles size={13} />
                  <span>⚡ PARE DE ADMINISTRAR SUA ESTÉTICA NO PAPEL</span>
                </div>

                <h2 className="font-display text-xl sm:text-2xl lg:text-3xl font-extrabold text-vapor-100 leading-tight">
                  A planilha te dá o diagnóstico de hoje. O <span className="text-amber-500">NuvemWash</span> automatiza seu lucro no pátio todos os dias.
                </h2>
                <p className="text-xs sm:text-sm text-vapor-400 max-w-2xl leading-relaxed">
                  No dia a dia com a oficina cheia e a mão molhada de shampoo, ninguém para para abrir Excel. Na planilha você gasta 30 minutos sofrendo para calcular um orçamento manual. No NuvemWash, seu cliente recebe e aprova propostas profissionais em 3 níveis no WhatsApp enquanto o pátio roda no piloto automático:
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {COMPARATIVO_CONVERSAO.map((item) => (
                  <div
                    key={item.titulo}
                    className="bg-graphite-900 border border-graphite-600 rounded-[8px] p-4 flex flex-col gap-3"
                  >
                    <div className="flex items-center gap-2.5">
                      {item.icone}
                      <h3 className="font-display text-sm sm:text-[15px] font-bold text-vapor-100">
                        {item.titulo}
                      </h3>
                    </div>

                    <div className="flex flex-col gap-2 text-xs">
                      <div className="flex items-start gap-2 p-2.5 rounded-[4px] bg-graphite-700/70 border border-graphite-600 text-vapor-400">
                        <Lock size={14} className="text-vapor-400 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-mono text-[10px] uppercase tracking-wider block text-vapor-400">
                            Na Planilha Gratuita
                          </span>
                          <span>{item.planilhaStatus}</span>
                        </div>
                      </div>

                      <div className="flex items-start gap-2 p-2.5 rounded-[4px] bg-mint-400/10 border border-mint-400/30 text-vapor-100">
                        <Unlock size={14} className="text-mint-400 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-mono text-[10px] uppercase tracking-wider block text-mint-400 font-semibold">
                            Liberado no NuvemWash
                          </span>
                          <span>{item.sistemaStatus}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleIrParaCadastro}
                  className="w-full min-h-[56px] px-6 py-4 rounded-[6px] bg-amber-500 hover:bg-amber-600 active:scale-[0.99] text-graphite-950 font-display font-extrabold text-[14px] sm:text-[16px] uppercase tracking-wide flex items-center justify-center gap-2 transition-all shadow-xl shadow-amber-500/25 cursor-pointer text-center"
                >
                  <span>🚀 CRIAR MINHA CONTA GRÁTIS E BLINDAR MINHA OFICINA AGORA</span>
                </button>

                <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] sm:text-xs text-vapor-400">
                  <span>✓ Seus dados já estão preenchidos</span>
                  <span>•</span>
                  <span>✓ 15 dias de teste grátis sem cartão</span>
                  <span>•</span>
                  <span>✓ Inclui 27 termos de risco e catálogo pronto</span>
                </div>
              </div>
            </section>
          </div>
        )}
      </main>

      <footer className="border-t border-graphite-600/70 bg-graphite-900 py-5 px-4 sm:px-6 text-xs text-vapor-400">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>© {new Date().getFullYear()} NuvemWash. Todos os direitos reservados.</span>
          <div className="flex items-center gap-4">
            <Link to="/termos-de-uso" className="hover:text-amber-500 transition-colors">
              Termos de Uso
            </Link>
            <span>•</span>
            <Link to="/politica-de-privacidade" className="hover:text-amber-500 transition-colors">
              Privacidade
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

