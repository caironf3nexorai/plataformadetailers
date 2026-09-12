import React, { useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ShieldCheck, Printer, Download, Copy, Check, Sparkles, ExternalLink, FileDown } from 'lucide-react';
import { formatarData } from '../../utils/datas';
import { getFotoPublicUrl } from '../../utils/imagens';
import { baixarPdfAdesivo } from '../../utils/pdfAdesivo';

interface AdesivoParabrisaModalProps {
  isOpen: boolean;
  onClose: () => void;
  certificado: {
    codigo: string;
    servico_nome: string;
    produto_aplicado?: string | null;
    data_aplicacao: string;
    data_vencimento: string;
    proxima_revisao_data?: string | null;
  };
  oficina: {
    nome: string;
    logo_path?: string | null;
    telefone?: string | null;
  };
  veiculo: {
    modelo: string;
    placa: string;
    cor?: string | null;
  };
}

export const AdesivoParabrisaModal: React.FC<AdesivoParabrisaModalProps> = ({
  isOpen,
  onClose,
  certificado,
  oficina,
  veiculo
}) => {
  const stickerRef = useRef<HTMLDivElement>(null);
  const [copiado, setCopiado] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const [baixandoPdf, setBaixandoPdf] = useState(false);

  const urlCertificado = `${window.location.origin}/garantia/${certificado.codigo}`;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(urlCertificado)}&margin=8&format=png`;

  const handleCopiarLink = async () => {
    try {
      await navigator.clipboard.writeText(urlCertificado);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      // fallback
    }
  };

  const handleBaixarPdf = async () => {
    try {
      setBaixandoPdf(true);
      await baixarPdfAdesivo({
        certificado,
        oficina,
        veiculo,
        tema: 'escuro',
      });
    } catch (err) {
      console.error('Erro ao gerar PDF do adesivo:', err);
    } finally {
      setBaixandoPdf(false);
    }
  };

  const handleImprimir = () => {
    const stickerEl = stickerRef.current;
    if (!stickerEl) return;

    // Remove qualquer iframe residual anterior se existir
    const oldIframe = document.getElementById('iframe-impressao-adesivo');
    if (oldIframe) {
      try {
        document.body.removeChild(oldIframe);
      } catch {}
    }

    // Cria um iframe posicionado fora da tela para impressão isolada
    const iframe = document.createElement('iframe');
    iframe.id = 'iframe-impressao-adesivo';
    iframe.style.position = 'fixed';
    iframe.style.top = '-10000px';
    iframe.style.left = '-10000px';
    iframe.style.width = '850px';
    iframe.style.height = '1100px';
    iframe.style.border = 'none';
    iframe.setAttribute('title', 'Impressão do Adesivo');
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      window.print();
      return;
    }

    // Clona todos os estilos CSS da aplicação (Tailwind, fontes e cores)
    const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
      .map((el) => el.outerHTML)
      .join('\n');

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Adesivo de Garantia - ${certificado.codigo}</title>
          ${styles}
          <style>
            @page {
              size: auto;
              margin: 0mm; /* Suprime os cabeçalhos/rodapés automáticos do navegador */
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
              padding-top: 25mm;
              padding-bottom: 25mm;
              width: 100%;
            }
            #area-impressao-adesivo {
              width: 420px !important;
              max-width: 420px !important;
              background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #000000 100%) !important;
              color: #ffffff !important;
              box-shadow: none !important;
              border: 2px solid #f59e0b !important;
              border-radius: 24px !important;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }
          </style>
        </head>
        <body>
          <div class="print-wrapper">
            ${stickerEl.outerHTML}
          </div>
        </body>
      </html>
    `);
    doc.close();

    // Aguarda imagens carregarem antes de acionar a impressão
    const triggerPrint = () => {
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch (e) {
          console.error('Erro ao acionar impressão:', e);
        }
        setTimeout(() => {
          try {
            document.body.removeChild(iframe);
          } catch {
            // ignore
          }
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

  const handleBaixarImagem = async () => {
    try {
      setBaixando(true);
      const response = await fetch(qrCodeUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `qrcode-garantia-${certificado.codigo}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Erro ao baixar QR code:', err);
    } finally {
      setBaixando(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Adesivo de Para-brisa & QR Code" maxWidth="lg">
      {/* Estilo para garantir isolamento se o usuário der Ctrl+P no navegador */}
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #area-impressao-adesivo, #area-impressao-adesivo * {
            visibility: visible !important;
          }
          #area-impressao-adesivo {
            position: absolute !important;
            left: 50% !important;
            top: 20mm !important;
            transform: translateX(-50%) !important;
            margin: 0 !important;
            width: 420px !important;
            box-shadow: none !important;
            border: 2px solid #f59e0b !important;
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #000000 100%) !important;
            color: #ffffff !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          @page {
            margin: 0mm;
            size: auto;
          }
        }
      `}</style>

      <div className="flex flex-col gap-5">
        <div className="bg-graphite-900/70 p-3.5 rounded-lg border border-graphite-800">
          <p className="text-xs text-vapor-400 leading-relaxed">
            Imprima este selo em papel adesivo transparente/eletrostático para colar no para-brisa do carro ou entregue como cartão no porta-luvas. O cliente aponta a câmera do celular no QR Code e confere a garantia autenticada em tempo real.
          </p>
        </div>

        {/* CONTAINER DO ADESIVO / CARTÃO (ÁREA IMPRIMÍVEL COM DESIGN ORIGINAL ESCURO) */}
        <div className="flex justify-center p-2 sm:p-4 bg-graphite-950/80 rounded-xl border border-graphite-800">
          <div
            id="area-impressao-adesivo"
            ref={stickerRef}
            className="w-full max-w-[420px] p-5 sm:p-6 rounded-3xl border-2 border-amber-500/50 shadow-2xl relative overflow-hidden bg-gradient-to-br from-slate-900 via-graphite-900 to-black text-white transition-all"
          >
            {/* Brilhos sutis decorativos de fundo */}
            <div className="absolute -top-12 -right-12 w-32 h-32 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />
            <div className="absolute -bottom-12 -left-12 w-32 h-32 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />

            {/* Cabeçalho da Oficina */}
            <div className="flex items-center justify-between border-b border-graphite-800/80 pb-3 mb-3.5">
              <div className="flex items-center gap-2.5">
                {oficina.logo_path ? (
                  <img
                    src={getFotoPublicUrl(oficina.logo_path) || ''}
                    alt={oficina.nome}
                    className="w-10 h-10 rounded-xl object-contain border border-graphite-700 bg-graphite-950 p-1"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-400 flex items-center justify-center font-black text-sm">
                    {oficina.nome.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div>
                  <h4 className="font-display font-black text-[14px] sm:text-[15px] uppercase tracking-wide leading-tight text-white">
                    {oficina.nome}
                  </h4>
                  <span className="text-[10.5px] text-amber-400 font-bold tracking-wider uppercase flex items-center gap-1 mt-0.5">
                    <ShieldCheck size={12} className="text-amber-400 shrink-0" />
                    Garantia Certificada
                  </span>
                </div>
              </div>

              <span className="px-2.5 py-1 rounded-lg font-mono text-[11px] font-bold border border-amber-500/40 bg-amber-500/20 text-amber-300 shadow-sm">
                {certificado.codigo}
              </span>
            </div>

            {/* Corpo: Dados do Veículo & Proteção */}
            <div className="grid grid-cols-3 gap-3 items-center">
              <div className="col-span-2 space-y-2">
                <div>
                  <span className="text-[9px] uppercase tracking-wider font-extrabold text-vapor-400 block">
                    Veículo & Placa
                  </span>
                  <div className="text-[14px] font-black text-white leading-tight mt-0.5">
                    {veiculo.modelo}
                  </div>
                  <span className="inline-block px-1.5 py-0.5 mt-1 rounded font-mono text-[11px] font-bold bg-graphite-800 border border-graphite-700 text-amber-300">
                    {veiculo.placa}
                  </span>
                </div>

                <div>
                  <span className="text-[9px] uppercase tracking-wider font-extrabold text-vapor-400 block">
                    Proteção Aplicada
                  </span>
                  <div className="text-[13px] font-extrabold text-white leading-tight mt-0.5">
                    {certificado.servico_nome}
                  </div>
                  {certificado.produto_aplicado && (
                    <span className="text-[11px] text-amber-400 font-mono font-bold block mt-0.5">
                      {certificado.produto_aplicado}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-graphite-800">
                  <div>
                    <span className="text-[8.5px] uppercase tracking-wider font-bold text-vapor-400 block">
                      Aplicação
                    </span>
                    <span className="text-[11.5px] font-mono font-bold text-white">
                      {formatarData(certificado.data_aplicacao)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[8.5px] uppercase tracking-wider text-emerald-400 font-bold block">
                      Validade
                    </span>
                    <span className="text-[11.5px] font-mono font-bold text-emerald-400">
                      {formatarData(certificado.data_vencimento)}
                    </span>
                  </div>
                </div>

                {certificado.proxima_revisao_data && (
                  <div className="p-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-[9.5px] flex items-center gap-1.5 font-semibold text-amber-300">
                    <Sparkles size={11} className="shrink-0 text-amber-400" />
                    <span>
                      Próxima Revisão: <strong>{formatarData(certificado.proxima_revisao_data)}</strong>
                    </span>
                  </div>
                )}
              </div>

              {/* Box do QR Code (Cartão Branco com QR escuro nítido) */}
              <div className="col-span-1 flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-2xl bg-white shadow-xl">
                <img
                  src={qrCodeUrl}
                  alt={`QR Code ${certificado.codigo}`}
                  className="w-24 h-24 sm:w-26 sm:h-26 object-contain rounded"
                />
                <span className="text-[7.5px] text-slate-900 font-black tracking-tight uppercase text-center leading-tight mt-0.5">
                  Escanear para Autenticar
                </span>
              </div>
            </div>

            {/* Rodapé do Selo */}
            <div className="mt-3.5 pt-2 border-t border-graphite-800/80 flex items-center justify-between text-[9.5px] font-sans text-vapor-400">
              <span>Autenticação Oficial · NuvemWash</span>
              <span className="text-amber-400 font-mono font-bold">nuvemwash.com</span>
            </div>
          </div>
        </div>

        {/* BOTÕES DE AÇÃO */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-graphite-700">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={handleCopiarLink}
              className="text-xs flex items-center gap-1.5 py-2"
            >
              {copiado ? <Check size={14} className="text-mint-400" /> : <Copy size={14} />}
              <span>{copiado ? 'Link Copiado!' : 'Copiar Link'}</span>
            </Button>

            <a
              href={urlCertificado}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-2 rounded-lg bg-graphite-800 hover:bg-graphite-700 text-vapor-200 border border-graphite-600 text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <ExternalLink size={14} />
              <span>Ver Certificado</span>
            </a>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={handleBaixarImagem}
              disabled={baixando}
              className="text-xs flex items-center gap-1.5 py-2"
              title="Baixar imagem PNG do QR Code isolado"
            >
              <Download size={14} />
              <span>{baixando ? 'Baixando...' : 'QR Code'}</span>
            </Button>

            <Button
              type="button"
              variant="secondary"
              onClick={handleBaixarPdf}
              disabled={baixandoPdf}
              className="text-xs flex items-center gap-1.5 py-2 font-medium border-graphite-600 hover:border-amber-500/50"
              title="Baixar arquivo PDF de alta resolução (100x70mm) do adesivo"
            >
              <FileDown size={14} className="text-amber-400" />
              <span>{baixandoPdf ? 'Gerando...' : 'Baixar PDF'}</span>
            </Button>

            <Button
              type="button"
              variant="primary"
              onClick={handleImprimir}
              className="text-xs flex items-center gap-1.5 py-2 font-bold bg-amber-500 hover:bg-amber-400 text-graphite-950 shadow-md"
              title="Imprimir somente o adesivo (1 página limpa)"
            >
              <Printer size={15} />
              <span>Imprimir Adesivo</span>
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
