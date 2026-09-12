import React, { useRef, useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { getFotoPublicUrl } from '../../utils/imagens';
import { baixarPdfPlacaBalcao } from '../../utils/pdfPlacaBalcao';
import { useAuth } from '../../contexts/AuthContext';
import { usePlano } from '../../hooks/usePlano';
import { supabase } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';
import type { PlacaBalcaoConfig } from '../../types/auth';
import {
  QrCode,
  Printer,
  Download,
  FileDown,
  Sparkles,
  Sun,
  Moon,
  ExternalLink,
  ShieldCheck,
  Zap,
  Tag,
  Palette,
  Lock,
  Check,
  RotateCcw,
  Sliders,
  Eye,
  ArrowRight,
  Info,
  Type
} from 'lucide-react';

interface ModalPlacaBalcaoProps {
  isOpen: boolean;
  onClose: () => void;
  oficina: {
    nome: string;
    slug: string;
    logo_path?: string | null;
    telefone?: string | null;
    cidade?: string | null;
    estado?: string | null;
  };
}

const DEFAULT_CONFIG: PlacaBalcaoConfig = {
  corDestaque: '#f59e0b',
  corFundo: '#090d16',
  estiloFonte: 'moderna',
  sloganOficina: 'Estética Automotiva & Cuidados Especiais',
  chamadaPrincipal: 'Conheça Nossos Serviços & Agende Online',
  instrucaoQr: 'Aponte a câmera do seu celular para o QR Code abaixo:',
  pill1Titulo: 'Agendamento',
  pill1Subtexto: 'Rápido & Direto',
  pill2Titulo: 'Catálogo',
  pill2Subtexto: 'Fotos & Valores',
  pill3Titulo: 'Garantia',
  pill3Subtexto: 'Consulta Digital',
  ocultarMarcaNuvemWash: false,
  textoRodapeCustomizado: '',
};

const PRESET_CORES = [
  { nome: 'Dourado Luxo', hex: '#f59e0b' },
  { nome: 'Vermelho Racing', hex: '#ef4444' },
  { nome: 'Azul Safira', hex: '#3b82f6' },
  { nome: 'Verde Esmeralda', hex: '#10b981' },
  { nome: 'Roxo Studio', hex: '#8b5cf6' },
  { nome: 'Cobre / Bronze', hex: '#d97706' },
  { nome: 'Prata / Carbono', hex: '#94a3b8' },
];

const PRESET_FUNDOS = [
  { nome: 'Preto Ônix', hex: '#090d16' },
  { nome: 'Dark Grafite', hex: '#121826' },
  { nome: 'Azul Noturno', hex: '#0f172a' },
  { nome: 'Cinza Titanium', hex: '#1e293b' },
  { nome: 'Branco Puro', hex: '#ffffff' },
  { nome: 'Cinza Papel', hex: '#f8fafc' },
];

const ESTILOS_FONTE = [
  {
    id: 'moderna' as const,
    nome: 'Moderna / Tech',
    descricao: 'Sans-serif limpo, contemporâneo e de alta legibilidade',
    fontFamilyClass: 'font-display',
    fontCssFamily: "'Outfit', 'Montserrat', sans-serif",
    amostra: 'DETAIL STUDIO'
  },
  {
    id: 'luxo' as const,
    nome: 'Elegante / Luxo',
    descricao: 'Serif sofisticado para estética automotiva boutique e alto padrão',
    fontFamilyClass: 'font-serif',
    fontCssFamily: "'Playfair Display', 'Georgia', serif",
    amostra: 'PREMIUM CARE'
  },
  {
    id: 'esportiva' as const,
    nome: 'Esportiva / Racing',
    descricao: 'Visual marcante, condensado e agressivo para detailers de performance',
    fontFamilyClass: 'font-mono font-black tracking-wider',
    fontCssFamily: "'Rajdhani', 'Impact', sans-serif",
    amostra: 'MOTORSPORT'
  },
  {
    id: 'minimalista' as const,
    nome: 'Minimalista / Clean',
    descricao: 'Simplicidade nórdica com foco nas informações essenciais',
    fontFamilyClass: 'font-sans font-medium',
    fontCssFamily: "'Inter', 'Roboto', sans-serif",
    amostra: 'AUTO DETAIL'
  }
];

// Função para checar se a cor é escura
const isCorEscura = (hex: string): boolean => {
  let c = (hex || '#090d16').replace('#', '').trim();
  if (c.length === 3) c = c.split('').map((char) => char + char).join('');
  const num = parseInt(c, 16);
  if (isNaN(num) || c.length !== 6) return true;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 < 145;
};

export const ModalPlacaBalcao: React.FC<ModalPlacaBalcaoProps> = ({
  isOpen,
  onClose,
  oficina
}) => {
  const navigate = useNavigate();
  const { tenant, refetchTenantData } = useAuth();
  const { planoAtual, temFeature } = usePlano();
  const podePersonalizar = temFeature('personalizacao_placa_balcao') || planoAtual === 'pro' || planoAtual === 'studio';

  const placaRef = useRef<HTMLDivElement>(null);
  const [abaModal, setAbaModal] = useState<'visualizar' | 'personalizar'>('visualizar');
  const [tema, setTema] = useState<'escuro' | 'branco'>('escuro');
  const [formato, setFormato] = useState<'A5' | 'A4'>('A5');
  const [baixandoPdf, setBaixandoPdf] = useState(false);
  const [baixandoQr, setBaixandoQr] = useState(false);

  // Estados de Personalização
  const [config, setConfig] = useState<PlacaBalcaoConfig>(DEFAULT_CONFIG);
  const [salvando, setSalvando] = useState(false);
  const [msgSucesso, setMsgSucesso] = useState<string | null>(null);
  const [msgErro, setMsgErro] = useState<string | null>(null);

  // Carrega configurações do tenant ou localStorage
  useEffect(() => {
    if (!tenant) return;

    let configCarregada: PlacaBalcaoConfig = { ...DEFAULT_CONFIG };

    if (tenant.placa_balcao_config && typeof tenant.placa_balcao_config === 'object') {
      configCarregada = { ...DEFAULT_CONFIG, ...tenant.placa_balcao_config };
    } else {
      const salvoLocal = localStorage.getItem(`placa_balcao_config_${tenant.id}`);
      if (salvoLocal) {
        try {
          const parsed = JSON.parse(salvoLocal);
          configCarregada = { ...DEFAULT_CONFIG, ...parsed };
        } catch {}
      }
    }

    setConfig(configCarregada);
  }, [tenant?.id, (tenant as any)?.placa_balcao_config]);

  // Cor de destaque e cor de fundo ativas
  const corDestaque = config.corDestaque || '#f59e0b';
  const corFundoAtiva = config.corFundo || (tema === 'escuro' ? '#090d16' : '#ffffff');
  const isDark = isCorEscura(corFundoAtiva);

  // Obter estilo de fonte ativo
  const estiloFonteAtivo = ESTILOS_FONTE.find((e) => e.id === config.estiloFonte) || ESTILOS_FONTE[0];

  const vitrineUrl = `${window.location.origin}/agendar/${oficina.slug}`;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(vitrineUrl)}&margin=6&format=png`;
  const logoUrl = oficina.logo_path ? getFotoPublicUrl(oficina.logo_path) : null;

  const handleSalvarConfig = async () => {
    if (!tenant?.id) return;
    setSalvando(true);
    setMsgSucesso(null);
    setMsgErro(null);

    try {
      localStorage.setItem(`placa_balcao_config_${tenant.id}`, JSON.stringify(config));

      const { error } = await supabase
        .from('tenants')
        .update({ placa_balcao_config: config })
        .eq('id', tenant.id);

      if (error) {
        console.warn('Aviso: Coluna placa_balcao_config pode não estar migrada no banco ainda. Config salva em cache local.', error);
      } else {
        await refetchTenantData();
      }

      setMsgSucesso('Configurações da placa salvas com sucesso!');
      setTimeout(() => setMsgSucesso(null), 3000);
    } catch (err: any) {
      console.error('Erro ao salvar:', err);
      setMsgErro('Erro ao salvar no banco. Suas alterações foram salvas neste navegador.');
    } finally {
      setSalvando(false);
    }
  };

  const handleRestaurarPadrao = () => {
    if (window.confirm('Deseja restaurar o design, cores e fontes originais da placa?')) {
      setConfig(DEFAULT_CONFIG);
      if (tenant?.id) {
        localStorage.removeItem(`placa_balcao_config_${tenant.id}`);
        supabase.from('tenants').update({ placa_balcao_config: null }).eq('id', tenant.id).then(() => {
          refetchTenantData();
        });
      }
      setMsgSucesso('Configurações restauradas para o padrão.');
      setTimeout(() => setMsgSucesso(null), 3000);
    }
  };

  const handleBaixarPdf = async () => {
    try {
      setBaixandoPdf(true);
      await baixarPdfPlacaBalcao({
        oficina,
        tema,
        formato,
        config: {
          ...config,
          corFundo: corFundoAtiva
        }
      });
    } catch (err) {
      console.error('Erro ao gerar PDF da placa:', err);
    } finally {
      setBaixandoPdf(false);
    }
  };

  const handleBaixarQrPng = async () => {
    try {
      setBaixandoQr(true);
      const res = await fetch(qrCodeUrl);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `qrcode-balcao-${oficina.slug}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Erro ao baixar QR code:', err);
    } finally {
      setBaixandoQr(false);
    }
  };

  const handleImprimir = () => {
    const placaEl = placaRef.current;
    if (!placaEl) return;

    const oldIframe = document.getElementById('iframe-impressao-placa');
    if (oldIframe) {
      try {
        document.body.removeChild(oldIframe);
      } catch {}
    }

    const iframe = document.createElement('iframe');
    iframe.id = 'iframe-impressao-placa';
    iframe.style.position = 'fixed';
    iframe.style.top = '-10000px';
    iframe.style.left = '-10000px';
    iframe.style.width = '850px';
    iframe.style.height = '1200px';
    iframe.style.border = 'none';
    iframe.setAttribute('title', 'Impressão da Placa de Balcão');
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      window.print();
      return;
    }

    const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
      .map((el) => el.outerHTML)
      .join('\n');

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Placa de Balcão - ${oficina.nome}</title>
          ${styles}
          <style>
            @page {
              size: ${formato === 'A5' ? 'A5 portrait' : 'A4 portrait'};
              margin: 0mm;
            }
            * {
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
              color-adjust: exact !important;
              box-sizing: border-box;
            }
            html, body {
              background: #ffffff !important;
              margin: 0 !important;
              padding: 0 !important;
              width: 100% !important;
              height: auto !important;
            }
            .print-wrapper {
              display: flex;
              align-items: center;
              justify-content: center;
              padding-top: ${formato === 'A5' ? '12mm' : '20mm'};
              padding-bottom: ${formato === 'A5' ? '12mm' : '20mm'};
              width: 100%;
            }
            #area-impressao-placa {
              width: ${formato === 'A5' ? '135mm' : '185mm'} !important;
              max-width: 100% !important;
              box-shadow: none !important;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
              border: 3px solid ${corDestaque} !important;
              border-radius: 20px !important;
              background: ${corFundoAtiva} !important;
              color: ${isDark ? '#ffffff' : '#0f172a'} !important;
              font-family: ${estiloFonteAtivo.fontCssFamily} !important;
            }
          </style>
        </head>
        <body>
          <div class="print-wrapper">
            ${placaEl.outerHTML}
          </div>
        </body>
      </html>
    `);
    doc.close();

    const triggerPrint = () => {
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch (e) {
          console.error('Erro na impressão da placa:', e);
        }
        setTimeout(() => {
          try {
            document.body.removeChild(iframe);
          } catch {}
        }, 3000);
      }, 250);
    };

    const imgs = doc.querySelectorAll('img');
    let loaded = 0;
    const total = imgs.length;

    if (total === 0) {
      triggerPrint();
    } else {
      let printed = false;
      const checkAll = () => {
        if (!printed) {
          printed = true;
          triggerPrint();
        }
      };

      imgs.forEach((img) => {
        if (img.complete) {
          loaded++;
          if (loaded >= total) checkAll();
        } else {
          img.onload = () => {
            loaded++;
            if (loaded >= total) checkAll();
          };
          img.onerror = () => {
            loaded++;
            if (loaded >= total) checkAll();
          };
        }
      });

      setTimeout(checkAll, 1200);
    }
  };

  const handleIrParaPlanos = () => {
    onClose();
    navigate('/configuracoes?aba=plano');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Placa de Balcão & Display de Recepção"
      subtitle="Display para acrílico de mesa com QR Code da sua vitrine digital"
      icon={<QrCode size={20} className="text-amber-500" />}
      maxWidth="xl"
    >
      <div className="flex flex-col gap-5">
        {/* NAVEGADOR DE ABAS: VISUALIZAR vs PERSONALIZAR */}
        <div className="flex items-center justify-between border-b border-graphite-800 pb-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAbaModal('visualizar')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                abaModal === 'visualizar'
                  ? 'bg-amber-500 text-graphite-950 shadow-sm shadow-amber-500/10'
                  : 'text-vapor-400 hover:text-vapor-200 hover:bg-graphite-800'
              }`}
            >
              <Eye size={14} />
              <span>Visualizar & Imprimir</span>
            </button>

            <button
              type="button"
              onClick={() => setAbaModal('personalizar')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                abaModal === 'personalizar'
                  ? 'bg-amber-500 text-graphite-950 shadow-sm shadow-amber-500/10'
                  : 'text-vapor-400 hover:text-vapor-200 hover:bg-graphite-800'
              }`}
            >
              <Sliders size={14} />
              <span>Personalizar Display</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded font-black tracking-wider ${
                podePersonalizar
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              }`}>
                {podePersonalizar ? 'PRO' : 'BLOQUEADO'}
              </span>
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-vapor-400">
            <span>Fonte:</span>
            <strong className="font-mono text-vapor-200">{estiloFonteAtivo.nome.split('/')[0]}</strong>
            <span className="mx-1">•</span>
            <span>Formato:</span>
            <strong className="font-mono text-vapor-200">{formato}</strong>
          </div>
        </div>

        {/* FEEDBACK DE SUCESSO / ERRO */}
        {msgSucesso && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-xs flex items-center gap-2">
            <Check size={16} className="shrink-0" />
            <span>{msgSucesso}</span>
          </div>
        )}
        {msgErro && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-xs flex items-center gap-2">
            <Info size={16} className="shrink-0" />
            <span>{msgErro}</span>
          </div>
        )}

        {/* ======================================================== */}
        {/* ABA 1: VISUALIZAR & IMPRIMIR                             */}
        {/* ======================================================== */}
        {abaModal === 'visualizar' && (
          <>
            {/* Controles Rápidos de Formato e Estilo */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-graphite-900/80 rounded-xl border border-graphite-800">
              <div className="flex items-center gap-2">
                <span className="text-xs text-vapor-400 font-medium">Formato do Display:</span>
                <div className="flex items-center gap-1 bg-graphite-950 p-1 rounded-lg border border-graphite-700">
                  <button
                    type="button"
                    onClick={() => setFormato('A5')}
                    className={`text-xs px-2.5 py-1 rounded font-semibold transition ${
                      formato === 'A5'
                        ? 'bg-amber-500 text-graphite-950 shadow-sm'
                        : 'text-vapor-400 hover:text-vapor-100'
                    }`}
                    title="A5 (148x210mm) - Tamanho ideal para display de mesa em acrílico"
                  >
                    A5 (Mesa / Acrílico)
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormato('A4')}
                    className={`text-xs px-2.5 py-1 rounded font-semibold transition ${
                      formato === 'A4'
                        ? 'bg-amber-500 text-graphite-950 shadow-sm'
                        : 'text-vapor-400 hover:text-vapor-100'
                    }`}
                    title="A4 (210x297mm) - Tamanho folha inteira para quadro de parede ou balcão grande"
                  >
                    A4 (Folha Inteira)
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-vapor-400 font-medium">Estilo Visual:</span>
                <div className="flex items-center gap-1 bg-graphite-950 p-1 rounded-lg border border-graphite-700">
                  <button
                    type="button"
                    onClick={() => {
                      setTema('escuro');
                      if (!config.corFundo || config.corFundo === '#ffffff') {
                        setConfig({ ...config, corFundo: '#090d16' });
                      }
                    }}
                    className={`text-xs px-2.5 py-1 rounded font-semibold flex items-center gap-1.5 transition ${
                      isDark
                        ? 'bg-amber-500 text-graphite-950 shadow-sm'
                        : 'text-vapor-400 hover:text-vapor-100'
                    }`}
                  >
                    <Moon size={13} />
                    <span>Dark</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTema('branco');
                      setConfig({ ...config, corFundo: '#ffffff' });
                    }}
                    className={`text-xs px-2.5 py-1 rounded font-semibold flex items-center gap-1.5 transition ${
                      !isDark
                        ? 'bg-amber-500 text-graphite-950 shadow-sm'
                        : 'text-vapor-400 hover:text-vapor-100'
                    }`}
                    title="Fundo branco com economia de tinta"
                  >
                    <Sun size={13} />
                    <span>Clean</span>
                  </button>
                </div>
              </div>
            </div>

            {/* ÁREA DE PRÉVIA DA PLACA (RENDERIZAÇÃO FIEL) */}
            <div className="flex justify-center p-3 sm:p-6 bg-graphite-950/90 rounded-2xl border border-graphite-800 overflow-y-auto max-h-[520px]">
              <div
                id="area-impressao-placa"
                ref={placaRef}
                style={{
                  borderColor: corDestaque,
                  backgroundColor: corFundoAtiva,
                  color: isDark ? '#ffffff' : '#0f172a',
                  fontFamily: estiloFonteAtivo.fontCssFamily
                }}
                className={`w-full max-w-[390px] sm:max-w-[420px] p-6 sm:p-8 rounded-3xl border-[3px] shadow-2xl relative overflow-hidden transition-all text-center flex flex-col items-center justify-between gap-5 ${
                  isDark ? 'text-white' : 'text-slate-900 shadow-xl'
                }`}
              >
                {/* Brilhos decorativos no tema escuro */}
                {isDark && (
                  <>
                    <div
                      style={{ backgroundColor: `${corDestaque}1a` }}
                      className="absolute -top-16 -right-16 w-36 h-36 rounded-full blur-2xl pointer-events-none"
                    />
                    <div
                      style={{ backgroundColor: `${corDestaque}1a` }}
                      className="absolute -bottom-16 -left-16 w-36 h-36 rounded-full blur-2xl pointer-events-none"
                    />
                  </>
                )}

                {/* Topo da Placa: Logotipo & Nome */}
                <div className="flex flex-col items-center gap-2.5 w-full">
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt={oficina.nome}
                      className={`w-14 h-14 sm:w-16 sm:h-16 rounded-2xl object-contain border p-1 shadow-md ${
                        isDark ? 'bg-graphite-950 border-graphite-700' : 'bg-white border-slate-200'
                      }`}
                    />
                  ) : (
                    <div
                      style={{
                        backgroundColor: `${corDestaque}25`,
                        borderColor: `${corDestaque}60`,
                        color: corDestaque
                      }}
                      className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl border flex items-center justify-center font-black text-xl shadow-md"
                    >
                      {oficina.nome.slice(0, 2).toUpperCase()}
                    </div>
                  )}

                  <div>
                    <h2 className={`font-black text-lg sm:text-xl uppercase tracking-wider leading-tight ${
                      isDark ? 'text-white' : 'text-slate-900'
                    }`}>
                      {oficina.nome}
                    </h2>
                    <span
                      style={{ color: corDestaque }}
                      className="text-[11px] font-bold uppercase tracking-widest block mt-0.5"
                    >
                      {config.sloganOficina || 'Estética Automotiva & Cuidados Especiais'}
                    </span>
                  </div>

                  <div className={`w-24 h-0.5 mt-1 rounded-full ${isDark ? 'bg-graphite-800' : 'bg-slate-200'}`} />
                </div>

                {/* Chamada Principal de Ação */}
                <div className="space-y-1">
                  <h3 className={`font-black text-sm sm:text-base uppercase tracking-wide leading-snug ${
                    isDark ? 'text-vapor-100' : 'text-slate-900'
                  }`}>
                    {config.chamadaPrincipal || 'Conheça Nossos Serviços & Agende Online'}
                  </h3>
                  <p className={`text-xs ${isDark ? 'text-vapor-400' : 'text-slate-500'}`}>
                    {config.instrucaoQr || 'Aponte a câmera do seu celular para o QR Code abaixo:'}
                  </p>
                </div>

                {/* Container do QR Code Central */}
                <div
                  style={{ borderColor: corDestaque }}
                  className="p-3.5 sm:p-4 rounded-3xl bg-white border-2 shadow-2xl flex flex-col items-center justify-center gap-1.5 transition-transform hover:scale-[1.02]"
                >
                  <img
                    src={qrCodeUrl}
                    alt="QR Code da Vitrine"
                    className="w-44 h-44 sm:w-48 sm:h-48 object-contain rounded"
                  />
                  <span className="text-[9px] text-slate-800 font-black tracking-wider uppercase">
                    Acesse Agora pelo Celular
                  </span>
                </div>

                {/* Link Curto da Vitrine */}
                <div
                  style={{ color: corDestaque }}
                  className="font-mono text-xs font-bold tracking-wide"
                >
                  {vitrineUrl.replace(/^https?:\/\//, '')}
                </div>

                {/* 3 Destaques / Benefícios */}
                <div className="grid grid-cols-3 gap-2 w-full pt-2">
                  <div className={`p-2 rounded-xl border text-center ${
                    isDark ? 'bg-graphite-950/70 border-graphite-800' : 'bg-slate-50 border-slate-200'
                  }`}>
                    <Zap size={14} style={{ color: corDestaque }} className="mx-auto mb-1" />
                    <span
                      style={{ color: corDestaque }}
                      className="text-[9px] uppercase font-bold block leading-tight"
                    >
                      {config.pill1Titulo || 'Agendamento'}
                    </span>
                    <span className={`text-[8px] block mt-0.5 leading-tight ${isDark ? 'text-vapor-400' : 'text-slate-500'}`}>
                      {config.pill1Subtexto || 'Rápido & Direto'}
                    </span>
                  </div>

                  <div className={`p-2 rounded-xl border text-center ${
                    isDark ? 'bg-graphite-950/70 border-graphite-800' : 'bg-slate-50 border-slate-200'
                  }`}>
                    <Tag size={14} style={{ color: corDestaque }} className="mx-auto mb-1" />
                    <span
                      style={{ color: corDestaque }}
                      className="text-[9px] uppercase font-bold block leading-tight"
                    >
                      {config.pill2Titulo || 'Catálogo'}
                    </span>
                    <span className={`text-[8px] block mt-0.5 leading-tight ${isDark ? 'text-vapor-400' : 'text-slate-500'}`}>
                      {config.pill2Subtexto || 'Preços & Fotos'}
                    </span>
                  </div>

                  <div className={`p-2 rounded-xl border text-center ${
                    isDark ? 'bg-graphite-950/70 border-graphite-800' : 'bg-slate-50 border-slate-200'
                  }`}>
                    <ShieldCheck size={14} style={{ color: corDestaque }} className="mx-auto mb-1" />
                    <span
                      style={{ color: corDestaque }}
                      className="text-[9px] uppercase font-bold block leading-tight"
                    >
                      {config.pill3Titulo || 'Garantia'}
                    </span>
                    <span className={`text-[8px] block mt-0.5 leading-tight ${isDark ? 'text-vapor-400' : 'text-slate-500'}`}>
                      {config.pill3Subtexto || 'Consulta Digital'}
                    </span>
                  </div>
                </div>

                {/* Rodapé Oficial da Placa */}
                <div className={`w-full pt-3 border-t flex items-center justify-between text-[10px] font-sans ${
                  isDark ? 'border-graphite-800 text-vapor-400' : 'border-slate-200 text-slate-500'
                }`}>
                  <span className="truncate pr-2">
                    {config.textoRodapeCustomizado?.trim() ||
                      [oficina.cidade, oficina.estado].filter(Boolean).join(' - ') + (oficina.telefone ? ` · ${oficina.telefone}` : '') ||
                      'Atendimento Oficial'}
                  </span>

                  {!config.ocultarMarcaNuvemWash && (
                    <span
                      style={{ color: corDestaque }}
                      className="font-bold font-mono shrink-0"
                    >
                      NuvemWash
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* BOTÕES DE AÇÃO NO RODAPÉ */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 pt-3 border-t border-graphite-800">
              <div className="flex items-center gap-2">
                <a
                  href={vitrineUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-2 rounded-lg bg-graphite-800 hover:bg-graphite-700 text-vapor-200 border border-graphite-700 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <ExternalLink size={14} />
                  <span>Testar Link</span>
                </a>

                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleBaixarQrPng}
                  disabled={baixandoQr}
                  className="text-xs py-2 px-3 flex items-center gap-1.5"
                  title="Baixar somente a imagem PNG do QR Code"
                >
                  <Download size={14} />
                  <span>{baixandoQr ? 'Baixando...' : 'QR Code (PNG)'}</span>
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleBaixarPdf}
                  disabled={baixandoPdf}
                  className="text-xs py-2 px-3.5 font-semibold flex items-center gap-1.5 border-graphite-600 hover:border-amber-500/50"
                  title={`Baixar arquivo PDF vetorizado no formato ${formato}`}
                >
                  <FileDown size={15} className="text-amber-400" />
                  <span>{baixandoPdf ? 'Gerando...' : `Baixar PDF (${formato})`}</span>
                </Button>

                <Button
                  type="button"
                  variant="primary"
                  onClick={handleImprimir}
                  className="text-xs py-2 px-4 font-bold bg-amber-500 hover:bg-amber-400 text-graphite-950 flex items-center gap-1.5 shadow-md"
                  title="Imprimir placa de balcão diretamente"
                >
                  <Printer size={15} />
                  <span>Imprimir Placa ({formato})</span>
                </Button>
              </div>
            </div>
          </>
        )}

        {/* ======================================================== */}
        {/* ABA 2: PERSONALIZAR DISPLAY                              */}
        {/* ======================================================== */}
        {abaModal === 'personalizar' && (
          <div className="flex flex-col gap-5">
            {/* Se NÃO puder personalizar (Plano Free): Banner de Bloqueio */}
            {!podePersonalizar ? (
              <div className="p-6 bg-gradient-to-br from-amber-500/10 via-graphite-900 to-graphite-900 border border-amber-500/30 rounded-2xl flex flex-col gap-4 text-center items-center">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                  <Lock size={24} />
                </div>
                <div className="space-y-1.5 max-w-md">
                  <h4 className="font-display font-black text-lg text-white uppercase tracking-wider">
                    Personalização Exclusiva para Planos Pro e Studio
                  </h4>
                  <p className="text-xs text-vapor-300 leading-relaxed">
                    Assine o plano <strong className="text-amber-400">Pro</strong> ou <strong className="text-amber-400">Studio</strong> para personalizar sua Placa de Balcão: altere cores de destaque, <strong>cor de fundo</strong>, <strong>estilo de tipografia</strong>, títulos, chamadas e ative o modo <strong>White-label 100% livre da marca NuvemWash</strong>!
                  </p>
                </div>

                <div className="pt-2 flex items-center gap-3">
                  <Button
                    type="button"
                    variant="primary"
                    onClick={handleIrParaPlanos}
                    className="text-xs py-2 px-4 font-bold bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-graphite-950 flex items-center gap-2 shadow-lg shadow-amber-500/10"
                  >
                    <Sparkles size={15} />
                    <span>Conhecer Planos & Fazer Upgrade</span>
                    <ArrowRight size={14} />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                {/* Banner de Recurso Liberado */}
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-emerald-400 font-bold">
                    <Sparkles size={16} />
                    <span>Recurso Pro & Studio Liberado: Personalize cores, fundos, fontes e textos com visualização instantânea.</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold uppercase">
                    {planoAtual}
                  </span>
                </div>

                {/* 1. COR DE DESTAQUE */}
                <div className="p-4 bg-graphite-900 border border-graphite-800 rounded-xl space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-vapor-200">
                    <Palette size={15} className="text-amber-400" />
                    <span>1. Cor de Destaque da Marca (Bordas, Ícones e Títulos)</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {PRESET_CORES.map((preset) => (
                      <button
                        key={preset.hex}
                        type="button"
                        onClick={() => setConfig({ ...config, corDestaque: preset.hex })}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition ${
                          config.corDestaque?.toLowerCase() === preset.hex.toLowerCase()
                            ? 'border-white bg-graphite-800 text-white shadow-sm'
                            : 'border-graphite-700 bg-graphite-950 text-vapor-400 hover:text-vapor-200'
                        }`}
                      >
                        <span
                          className="w-3.5 h-3.5 rounded-full border border-white/20"
                          style={{ backgroundColor: preset.hex }}
                        />
                        <span>{preset.nome}</span>
                      </button>
                    ))}
                  </div>

                  {/* Seletor Customizado HEX */}
                  <div className="flex items-center gap-3 pt-1">
                    <span className="text-xs text-vapor-400">Ou escolha cor personalizada:</span>
                    <div className="flex items-center gap-2 bg-graphite-950 px-2 py-1 rounded-lg border border-graphite-700">
                      <input
                        type="color"
                        value={config.corDestaque || '#f59e0b'}
                        onChange={(e) => setConfig({ ...config, corDestaque: e.target.value })}
                        className="w-6 h-6 rounded cursor-pointer bg-transparent border-none"
                      />
                      <input
                        type="text"
                        value={config.corDestaque || '#f59e0b'}
                        onChange={(e) => setConfig({ ...config, corDestaque: e.target.value })}
                        className="bg-transparent text-xs font-mono text-vapor-100 uppercase w-20 outline-none"
                      />
                    </div>
                  </div>
                </div>

                {/* 2. COR DE FUNDO DA PLACA */}
                <div className="p-4 bg-graphite-900 border border-graphite-800 rounded-xl space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-vapor-200">
                    <Moon size={15} className="text-amber-400" />
                    <span>2. Cor de Fundo da Placa</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {PRESET_FUNDOS.map((fundo) => {
                      const isFundoAtivo = (config.corFundo || '#090d16').toLowerCase() === fundo.hex.toLowerCase();
                      return (
                        <button
                          key={fundo.hex}
                          type="button"
                          onClick={() => setConfig({ ...config, corFundo: fundo.hex })}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition ${
                            isFundoAtivo
                              ? 'border-amber-400 bg-graphite-800 text-white shadow-sm'
                              : 'border-graphite-700 bg-graphite-950 text-vapor-400 hover:text-vapor-200'
                          }`}
                        >
                          <span
                            className="w-3.5 h-3.5 rounded-full border border-white/20"
                            style={{ backgroundColor: fundo.hex }}
                          />
                          <span>{fundo.nome}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Seletor Customizado HEX de Fundo */}
                  <div className="flex items-center gap-3 pt-1">
                    <span className="text-xs text-vapor-400">Ou cor livre de fundo:</span>
                    <div className="flex items-center gap-2 bg-graphite-950 px-2 py-1 rounded-lg border border-graphite-700">
                      <input
                        type="color"
                        value={config.corFundo || '#090d16'}
                        onChange={(e) => setConfig({ ...config, corFundo: e.target.value })}
                        className="w-6 h-6 rounded cursor-pointer bg-transparent border-none"
                      />
                      <input
                        type="text"
                        value={config.corFundo || '#090d16'}
                        onChange={(e) => setConfig({ ...config, corFundo: e.target.value })}
                        className="bg-transparent text-xs font-mono text-vapor-100 uppercase w-20 outline-none"
                      />
                    </div>
                  </div>
                </div>

                {/* 3. ESTILO DE TIPOGRAFIA / FONTE */}
                <div className="p-4 bg-graphite-900 border border-graphite-800 rounded-xl space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-vapor-200">
                    <Type size={15} className="text-amber-400" />
                    <span>3. Estilo de Tipografia / Fonte</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {ESTILOS_FONTE.map((estilo) => {
                      const isAtivo = (config.estiloFonte || 'moderna') === estilo.id;
                      return (
                        <div
                          key={estilo.id}
                          onClick={() => setConfig({ ...config, estiloFonte: estilo.id })}
                          className={`p-3 rounded-xl border cursor-pointer transition-all flex flex-col justify-between gap-1.5 ${
                            isAtivo
                              ? 'bg-amber-500/10 border-amber-500 text-white shadow-md shadow-amber-500/5'
                              : 'bg-graphite-950 border-graphite-800 text-vapor-400 hover:border-graphite-700 hover:text-vapor-200'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-vapor-100">{estilo.nome}</span>
                            {isAtivo && <Check size={14} className="text-amber-400" />}
                          </div>
                          <p className="text-[11px] text-vapor-400 leading-snug">{estilo.descricao}</p>
                          <div
                            style={{ fontFamily: estilo.fontCssFamily }}
                            className="text-xs pt-1 text-amber-400 font-semibold truncate border-t border-graphite-800/80 mt-1"
                          >
                            Exemplo: {estilo.amostra}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 4. TEXTOS E SLOGAN */}
                <div className="p-4 bg-graphite-900 border border-graphite-800 rounded-xl space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-vapor-200">
                    <Tag size={15} className="text-amber-400" />
                    <span>4. Slogan e Chamadas da Placa</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] text-vapor-400 font-medium">Slogan / Especialidade (Subtítulo Topo):</label>
                      <Input
                        type="text"
                        value={config.sloganOficina || ''}
                        onChange={(e) => setConfig({ ...config, sloganOficina: e.target.value })}
                        placeholder="Ex: Studio de Proteção & Estética Automotiva"
                        className="text-xs"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] text-vapor-400 font-medium">Chamada Principal (Headline):</label>
                      <Input
                        type="text"
                        value={config.chamadaPrincipal || ''}
                        onChange={(e) => setConfig({ ...config, chamadaPrincipal: e.target.value })}
                        placeholder="Ex: Conheça Nossos Serviços & Agende Online"
                        className="text-xs"
                      />
                    </div>

                    <div className="sm:col-span-2 space-y-1">
                      <label className="text-[11px] text-vapor-400 font-medium">Instrução do QR Code:</label>
                      <Input
                        type="text"
                        value={config.instrucaoQr || ''}
                        onChange={(e) => setConfig({ ...config, instrucaoQr: e.target.value })}
                        placeholder="Ex: Aponte a câmera do seu celular para o QR Code abaixo:"
                        className="text-xs"
                      />
                    </div>
                  </div>
                </div>

                {/* 5. 3 DESTAQUES INFORMATIVOS (PILLS) */}
                <div className="p-4 bg-graphite-900 border border-graphite-800 rounded-xl space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-vapor-200">
                    <Zap size={15} className="text-amber-400" />
                    <span>5. Os 3 Blocos de Destaque (Abaixo do QR Code)</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Bloco 1 */}
                    <div className="p-2.5 bg-graphite-950 rounded-lg border border-graphite-800 space-y-2">
                      <span className="text-[10px] font-bold uppercase text-amber-400 block">Destaque 1 (Ícone Raio)</span>
                      <Input
                        type="text"
                        value={config.pill1Titulo || ''}
                        onChange={(e) => setConfig({ ...config, pill1Titulo: e.target.value })}
                        placeholder="Título (ex: Agendamento)"
                        className="text-xs"
                      />
                      <Input
                        type="text"
                        value={config.pill1Subtexto || ''}
                        onChange={(e) => setConfig({ ...config, pill1Subtexto: e.target.value })}
                        placeholder="Subtexto (ex: Rápido & Direto)"
                        className="text-xs"
                      />
                    </div>

                    {/* Bloco 2 */}
                    <div className="p-2.5 bg-graphite-950 rounded-lg border border-graphite-800 space-y-2">
                      <span className="text-[10px] font-bold uppercase text-amber-400 block">Destaque 2 (Ícone Catálogo)</span>
                      <Input
                        type="text"
                        value={config.pill2Titulo || ''}
                        onChange={(e) => setConfig({ ...config, pill2Titulo: e.target.value })}
                        placeholder="Título (ex: Catálogo)"
                        className="text-xs"
                      />
                      <Input
                        type="text"
                        value={config.pill2Subtexto || ''}
                        onChange={(e) => setConfig({ ...config, pill2Subtexto: e.target.value })}
                        placeholder="Subtexto (ex: Preços & Fotos)"
                        className="text-xs"
                      />
                    </div>

                    {/* Bloco 3 */}
                    <div className="p-2.5 bg-graphite-950 rounded-lg border border-graphite-800 space-y-2">
                      <span className="text-[10px] font-bold uppercase text-amber-400 block">Destaque 3 (Ícone Escudo)</span>
                      <Input
                        type="text"
                        value={config.pill3Titulo || ''}
                        onChange={(e) => setConfig({ ...config, pill3Titulo: e.target.value })}
                        placeholder="Título (ex: Garantia)"
                        className="text-xs"
                      />
                      <Input
                        type="text"
                        value={config.pill3Subtexto || ''}
                        onChange={(e) => setConfig({ ...config, pill3Subtexto: e.target.value })}
                        placeholder="Subtexto (ex: Consulta Digital)"
                        className="text-xs"
                      />
                    </div>
                  </div>
                </div>

                {/* 6. WHITE-LABEL & RODAPÉ */}
                <div className="p-4 bg-graphite-900 border border-graphite-800 rounded-xl space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-vapor-200">
                    <ShieldCheck size={15} className="text-amber-400" />
                    <span>6. Modo White-Label & Rodapé</span>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-graphite-950 rounded-lg border border-graphite-800">
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold text-vapor-100 block">
                        Ocultar marca "NuvemWash" do Rodapé
                      </span>
                      <p className="text-[11px] text-vapor-400">
                        Remove qualquer menção à plataforma na placa impressa para sua estética ficar 100% white-label.
                      </p>
                    </div>

                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={!!config.ocultarMarcaNuvemWash}
                        onChange={(e) => setConfig({ ...config, ocultarMarcaNuvemWash: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-graphite-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-graphite-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                    </label>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-vapor-400 font-medium">
                      Texto do Rodapé Personalizado (opcional):
                    </label>
                    <Input
                      type="text"
                      value={config.textoRodapeCustomizado || ''}
                      onChange={(e) => setConfig({ ...config, textoRodapeCustomizado: e.target.value })}
                      placeholder="Ex: Siga nosso Instagram @estetica_studio · WhatsApp (11) 99999-9999"
                      className="text-xs"
                    />
                    <p className="text-[10px] text-vapor-500">
                      Deixe vazio para usar automaticamente a cidade, estado e telefone cadastrados.
                    </p>
                  </div>
                </div>

                {/* BOTÕES DE SALVAR E RESTAURAR */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-graphite-800">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleRestaurarPadrao}
                    className="text-xs text-vapor-400 hover:text-vapor-200 flex items-center gap-1.5"
                  >
                    <RotateCcw size={13} />
                    <span>Restaurar Padrão</span>
                  </Button>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setAbaModal('visualizar')}
                      className="text-xs py-2 px-3"
                    >
                      <span>Ver Resultado</span>
                    </Button>

                    <Button
                      type="button"
                      variant="primary"
                      onClick={handleSalvarConfig}
                      disabled={salvando}
                      className="text-xs py-2 px-4 font-bold bg-amber-500 hover:bg-amber-400 text-graphite-950 flex items-center gap-1.5 shadow-md"
                    >
                      <Check size={14} />
                      <span>{salvando ? 'Salvando...' : 'Salvar Personalização'}</span>
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};
