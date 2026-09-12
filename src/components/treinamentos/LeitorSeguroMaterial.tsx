import React, { useEffect, useRef, useState, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import * as pdfjsLib from 'pdfjs-dist';
import { 
  X, 
  ChevronLeft, 
  ChevronRight, 
  ZoomIn, 
  ZoomOut, 
  Maximize2, 
  Minimize2, 
  ShieldCheck, 
  Download, 
  AlertCircle,
  Loader2,
  FileText,
  RotateCcw,
  Sparkles
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { AcademiaMaterial } from '../../types/materiais';

// Configurar Worker do PDF.js de forma resiliente
if (typeof window !== 'undefined') {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();
  } catch {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version || '4.0.0'}/build/pdf.worker.min.mjs`;
  }
}

interface PageCanvasItemProps {
  pdfDoc: any;
  pageNum: number;
  scale: number;
  origWidth: number;
  origHeight: number;
  textoWatermark: string;
  permitirDownload: boolean;
  onContextMenu: (e: React.MouseEvent) => void;
  onPageVisible: (pageNum: number) => void;
  onDoubleTap?: () => void;
}

// Sub-componente de página individual com renderização Retina Ultra-HD (High DPR)
const PageCanvasItem: React.FC<PageCanvasItemProps> = memo(({
  pdfDoc,
  pageNum,
  scale,
  origWidth,
  origHeight,
  textoWatermark,
  permitirDownload,
  onContextMenu,
  onPageVisible,
  onDoubleTap
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [shouldRender, setShouldRender] = useState<boolean>(pageNum <= 2);
  const [rendering, setRendering] = useState<boolean>(false);
  const renderTaskRef = useRef<any>(null);

  const displayWidth = Math.floor(origWidth * scale);
  const displayHeight = Math.floor(origHeight * scale);

  // Observador de visibilidade para lazy-rendering e detecção da página ativa
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const renderObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          setShouldRender(true);
        }
      });
    }, { rootMargin: '600px 0px 600px 0px' });

    const activeObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.35) {
          onPageVisible(pageNum);
        }
      });
    }, { threshold: [0.35] });

    renderObserver.observe(el);
    activeObserver.observe(el);

    return () => {
      renderObserver.disconnect();
      activeObserver.disconnect();
    };
  }, [pageNum, onPageVisible]);

  // Renderizar a página no Canvas com Super-Sampling Retina (Ultra Nitidez)
  useEffect(() => {
    if (!shouldRender || !pdfDoc || !canvasRef.current) return;

    let cancelado = false;

    const render = async () => {
      try {
        setRendering(true);
        if (renderTaskRef.current) {
          try {
            renderTaskRef.current.cancel();
          } catch {
            // Ignora cancelamento prévio
          }
        }

        const page = await pdfDoc.getPage(pageNum);
        if (cancelado) return;

        // Multiplicador de nitidez: garante pelo menos 2x no mobile/telas comuns e até 3x em telas Retina
        const pixelRatio = Math.min(Math.max(window.devicePixelRatio || 1, 2), 3);
        const scaledViewport = page.getViewport({ scale: scale * pixelRatio });

        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d', { alpha: false });
        if (!context) return;

        // Configuração de anti-aliasing e alta nitidez de texto
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';

        // Tamanho real do bitmap em memória (alta densidade de pixels)
        canvas.width = Math.floor(scaledViewport.width);
        canvas.height = Math.floor(scaledViewport.height);

        // Tamanho de exibição CSS na tela
        canvas.style.width = `${Math.floor(scaledViewport.width / pixelRatio)}px`;
        canvas.style.height = `${Math.floor(scaledViewport.height / pixelRatio)}px`;

        const renderContext = {
          canvasContext: context,
          viewport: scaledViewport,
        };

        const renderTask = page.render(renderContext);
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        if (!cancelado) setRendering(false);
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') {
          console.error(`[PageCanvasItem] Erro ao renderizar página ${pageNum}:`, err);
        }
        if (!cancelado) setRendering(false);
      }
    };

    render();

    return () => {
      cancelado = true;
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          // Ignora
        }
      }
    };
  }, [shouldRender, pdfDoc, pageNum, scale]);

  return (
    <div 
      ref={containerRef}
      id={`page-container-${pageNum}`}
      onDoubleClick={onDoubleTap}
      className="relative shadow-2xl rounded-sm overflow-hidden bg-white mx-auto my-3 sm:my-5 transition-all select-none shrink-0"
      style={{ 
        width: `${displayWidth}px`, 
        height: `${displayHeight}px`
      }}
    >
      {/* Canvas da Página */}
      <canvas ref={canvasRef} className="block pointer-events-none mx-auto" />

      {/* Escudo Transparente Anti-Clique / Anti-Arrastar (Shield Overlay) */}
      <div 
        className="absolute inset-0 bg-transparent cursor-default pointer-events-auto z-10"
        onContextMenu={onContextMenu}
        onMouseDown={(e) => {
          if (e.detail > 1) {
            e.preventDefault();
          }
        }}
      />

      {/* Marca D'Água Forense Dinâmica (Opacidade balanceada para não atrapalhar leitura) */}
      {!permitirDownload && (
        <div 
          className="absolute inset-0 pointer-events-none z-20 flex flex-col justify-around overflow-hidden select-none opacity-[0.09]"
          style={{ transform: 'rotate(-24deg)', width: '150%', left: '-25%', top: '-25%', height: '150%' }}
        >
          {Array.from({ length: 14 }).map((_, idx) => (
            <div 
              key={idx} 
              className="text-neutral-900 font-extrabold text-[11px] sm:text-[13px] tracking-wider whitespace-nowrap py-4"
            >
              {textoWatermark} &nbsp; • &nbsp; {textoWatermark}
            </div>
          ))}
        </div>
      )}

      {/* Indicador de carregamento da página se ainda estiver processando */}
      {(!shouldRender || rendering) && (
        <div className="absolute inset-0 bg-neutral-900/10 backdrop-blur-[1px] flex items-center justify-center z-30 pointer-events-none">
          <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
        </div>
      )}

      {/* Número da página impresso discretamente no rodapé da folha */}
      <div className="absolute bottom-1 right-2 text-[9px] font-mono text-neutral-400 z-10 pointer-events-none select-none">
        {pageNum}
      </div>
    </div>
  );
});

interface LeitorSeguroMaterialProps {
  material: AcademiaMaterial;
  tenantNome?: string;
  usuarioDocumento?: string;
  onClose: () => void;
}

export const LeitorSeguroMaterial: React.FC<LeitorSeguroMaterialProps> = ({
  material,
  tenantNome = 'Oficina Detailer',
  usuarioDocumento = '',
  onClose
}) => {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);
  const [pageOriginalWidth, setPageOriginalWidth] = useState<number>(595);
  const [pageOriginalHeight, setPageOriginalHeight] = useState<number>(842);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [alertaCopia, setAlertaCopia] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const isZoomManualRef = useRef<boolean>(false);

  // Exibir toast temporário de alerta de segurança
  const dispararAlertaSeguranca = (msg: string) => {
    setAlertaCopia(msg);
    setTimeout(() => {
      setAlertaCopia(null);
    }, 2800);
  };

  // Calcular escala ideal para preencher 100% da largura da tela no mobile ou largura de leitura no desktop
  const calcularFitScale = useCallback((origWidth: number) => {
    const containerW = mainRef.current?.clientWidth || window.innerWidth;
    const isMobile = window.innerWidth < 640;

    if (isMobile) {
      // No mobile: ocupa a largura do celular com margem de 12px de cada lado
      const padding = 24;
      const availableW = Math.max(260, containerW - padding);
      return +(availableW / origWidth).toFixed(2);
    } else {
      // No desktop: largura máxima confortável de leitura (850px)
      const padding = 64;
      const availableW = Math.min(Math.max(400, containerW - padding), 880);
      return +(availableW / origWidth).toFixed(2);
    }
  }, []);

  const ajustarALargura = useCallback(() => {
    if (!pageOriginalWidth) return;
    isZoomManualRef.current = false;
    const fit = calcularFitScale(pageOriginalWidth);
    setScale(fit);
  }, [pageOriginalWidth, calcularFitScale]);

  // Alternar zoom de leitura ampliada (ideal para textos pequenos no celular)
  const alternarZoomLeitura = () => {
    if (!pageOriginalWidth) return;
    const fit = calcularFitScale(pageOriginalWidth);
    if (scale <= fit * 1.1) {
      // Amplia para 160% para leitura confortável de textos pequenos
      isZoomManualRef.current = true;
      setScale(+(fit * 1.6).toFixed(2));
    } else {
      // Volta para ajuste de tela
      ajustarALargura();
    }
  };

  // Carregar o PDF autenticado via buffer em memória
  useEffect(() => {
    let cancelado = false;

    const carregarPDF = async () => {
      setLoading(true);
      setErrorMsg(null);

      try {
        supabase.rpc('registrar_acesso_material', {
          p_material_id: material.id,
          p_tipo: 'visualizacao'
        }).then(undefined, () => {});

        const { data, error } = await supabase.storage
          .from('academia-materiais')
          .download(material.arquivo_path);

        if (error) {
          throw new Error('Não foi possível obter o arquivo do material: ' + error.message);
        }

        if (cancelado) return;

        const arrayBuffer = await data.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({
          data: arrayBuffer,
          cMapUrl: 'https://unpkg.com/pdfjs-dist/cmaps/',
          cMapPacked: true,
        });

        const doc = await loadingTask.promise;
        if (cancelado) return;

        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setCurrentPage(1);

        try {
          const p1 = await doc.getPage(1);
          const unscaledVp = p1.getViewport({ scale: 1.0 });
          const origW = unscaledVp.width || 595;
          const origH = unscaledVp.height || 842;
          setPageOriginalWidth(origW);
          setPageOriginalHeight(origH);
          const initialFit = calcularFitScale(origW);
          setScale(initialFit);
        } catch {
          setScale(1.0);
        }

        setLoading(false);
      } catch (err: any) {
        console.error('[LeitorSeguroMaterial] Erro ao carregar PDF:', err);
        if (!cancelado) {
          setErrorMsg(err.message || 'Erro ao carregar documento.');
          setLoading(false);
        }
      }
    };

    carregarPDF();

    return () => {
      cancelado = true;
    };
  }, [material, calcularFitScale]);

  // Redimensionamento de janela ou rotação do celular
  useEffect(() => {
    const handleResize = () => {
      if (!isZoomManualRef.current && pageOriginalWidth) {
        const fit = calcularFitScale(pageOriginalWidth);
        setScale(fit);
      }
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, [pageOriginalWidth, calcularFitScale]);

  // Bloqueio rigoroso de atalhos de teclado (Ctrl+C, Ctrl+P, Ctrl+S, Ctrl+U, F12)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!material.permitir_download) {
        if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
          e.preventDefault();
          e.stopPropagation();
          dispararAlertaSeguranca('Impressão bloqueada pelo administrador.');
          return false;
        }

        if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
          e.preventDefault();
          e.stopPropagation();
          dispararAlertaSeguranca('Download desativado pelo administrador.');
          return false;
        }

        if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
          e.preventDefault();
          e.stopPropagation();
          dispararAlertaSeguranca('Cópia de texto protegida por direitos autorais.');
          return false;
        }

        if ((e.ctrlKey || e.metaKey) && (e.key === 'u' || e.key === 'U')) {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
      }

      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [material.permitir_download, onClose]);

  // Rolar suavemente até uma página específica
  const rolarParaPagina = (pageNum: number) => {
    if (pageNum < 1 || pageNum > numPages) return;
    const targetEl = document.getElementById(`page-container-${pageNum}`);
    if (targetEl && mainRef.current) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const proximaPagina = () => {
    if (currentPage < numPages) {
      rolarParaPagina(currentPage + 1);
    }
  };

  const paginaAnterior = () => {
    if (currentPage > 1) {
      rolarParaPagina(currentPage - 1);
    }
  };

  const zoomIn = () => {
    isZoomManualRef.current = true;
    setScale(s => Math.min(3.0, +(s + 0.15).toFixed(2)));
  };

  const zoomOut = () => {
    isZoomManualRef.current = true;
    setScale(s => Math.max(0.3, +(s - 0.15).toFixed(2)));
  };

  const alternarFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Download liberado somente se o admin habilitou
  const executarDownload = async () => {
    if (!material.permitir_download) return;

    try {
      supabase.rpc('registrar_acesso_material', {
        p_material_id: material.id,
        p_tipo: 'download'
      }).then(undefined, () => {});

      const { data, error } = await supabase.storage
        .from('academia-materiais')
        .download(material.arquivo_path);

      if (error) throw error;

      const blobUrl = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = material.arquivo_nome || `${material.titulo}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (err: any) {
      console.error('[LeitorSeguro] Erro no download:', err);
      alert('Erro ao realizar download do arquivo.');
    }
  };

  const dataHoje = new Date().toLocaleDateString('pt-BR');
  const textoWatermark = `EXCLUSIVO DETAILERS • ${tenantNome.toUpperCase()} ${usuarioDocumento ? `• ${usuarioDocumento}` : ''} • ACESSO ${dataHoje}`;
  const paginasArray = Array.from({ length: numPages }, (_, i) => i + 1);

  // Previne rolagem da página de fundo enquanto o leitor estiver ativo
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  return createPortal(
    <div 
      ref={containerRef}
      className="fixed inset-0 z-[100] bg-neutral-950 flex flex-col select-none overflow-hidden"
      style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
      onContextMenu={(e) => {
        if (!material.permitir_download) {
          e.preventDefault();
          dispararAlertaSeguranca('Botão direito desativado no leitor seguro.');
        }
      }}
    >
      {/* Estilo CSS embutido para anular impressão */}
      <style>{`
        @media print {
          body, html, * {
            display: none !important;
            visibility: hidden !important;
          }
        }
      `}</style>

      {/* Alerta Flutuante de Segurança (DRM) */}
      {alertaCopia && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 bg-amber-500/90 text-neutral-950 px-4 py-2 rounded-xl text-xs font-bold shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{alertaCopia}</span>
        </div>
      )}

      {/* Barra de Topo */}
      <header className="h-14 bg-neutral-900/95 border-b border-neutral-800 px-3 sm:px-4 flex items-center justify-between gap-2 sm:gap-3 shrink-0 backdrop-blur z-20 shadow-md">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center shrink-0">
            <FileText className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xs sm:text-sm font-bold text-neutral-100 truncate flex items-center gap-2">
              <span className="truncate">{material.titulo}</span>
              <span className="hidden md:inline-block text-[10px] px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-400 border border-neutral-700 font-medium shrink-0">
                {material.categoria}
              </span>
            </h2>
            <div className="flex items-center gap-2 text-[10px] sm:text-[11px] text-neutral-400">
              {material.permitir_download ? (
                <span className="text-emerald-400 flex items-center gap-1 font-medium truncate">
                  <Download className="w-3 h-3 shrink-0" /> Download Liberado
                </span>
              ) : (
                <span className="text-cyan-400 flex items-center gap-1 font-medium truncate">
                  <ShieldCheck className="w-3 h-3 shrink-0" /> Modo Seguro (Anti-Cópia)
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Controles do Cabeçalho */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {/* Navegação de Página Compacta */}
          <div className="flex items-center bg-neutral-800/90 border border-neutral-700 rounded-lg px-1.5 py-1 gap-1 text-xs text-neutral-300">
            <button
              onClick={paginaAnterior}
              disabled={currentPage <= 1}
              title="Página anterior"
              className="p-1 rounded hover:bg-neutral-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-1 text-[11px] sm:text-xs text-neutral-200 font-bold whitespace-nowrap">
              {currentPage} / {numPages || 1}
            </span>
            <button
              onClick={proximaPagina}
              disabled={currentPage >= numPages}
              title="Próxima página"
              className="p-1 rounded hover:bg-neutral-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Botão de Download (Se liberado) */}
          {material.permitir_download && (
            <button
              onClick={executarDownload}
              className="px-2.5 sm:px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-lg shadow-emerald-600/20"
              title="Baixar cópia em PDF"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Baixar PDF</span>
            </button>
          )}

          {/* Fullscreen (Desktop/Tablet) */}
          <button
            onClick={alternarFullscreen}
            className="hidden sm:inline-flex p-2 rounded-lg text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
            title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          {/* Fechar */}
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
            title="Fechar leitor (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Área Central de Leitura com ROLAGEM VERTICAL CONTÍNUA e suporte a PAN HORIZONTAL */}
      <main 
        ref={mainRef}
        className="flex-1 overflow-y-auto overflow-x-auto bg-neutral-950 px-2 sm:px-4 py-4 scroll-smooth"
      >
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 text-neutral-400 py-32">
            <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
            <p className="text-sm font-medium">Carregando documento seguro...</p>
            <span className="text-xs text-neutral-600">Renderizando páginas com nitidez Ultra-HD</span>
          </div>
        ) : errorMsg ? (
          <div className="my-auto bg-rose-500/10 border border-rose-500/30 rounded-2xl p-6 text-center max-w-md mx-auto my-20">
            <AlertCircle className="w-10 h-10 text-rose-400 mx-auto mb-3" />
            <h3 className="text-sm font-bold text-rose-200 mb-1">Falha na Abertura do Arquivo</h3>
            <p className="text-xs text-rose-300 mb-4">{errorMsg}</p>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-xs font-semibold text-neutral-200"
            >
              Voltar aos Materiais
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-start min-w-full pb-16">
            {paginasArray.map(pageNum => (
              <PageCanvasItem
                key={pageNum}
                pdfDoc={pdfDoc}
                pageNum={pageNum}
                scale={scale}
                origWidth={pageOriginalWidth}
                origHeight={pageOriginalHeight}
                textoWatermark={textoWatermark}
                permitirDownload={material.permitir_download}
                onContextMenu={(e) => {
                  if (!material.permitir_download) {
                    e.preventDefault();
                    dispararAlertaSeguranca('Botão direito desativado no leitor seguro.');
                  }
                }}
                onPageVisible={setCurrentPage}
                onDoubleTap={alternarZoomLeitura}
              />
            ))}
          </div>
        )}
      </main>

      {/* Barra Inferior com Controles de Zoom e Modo Leitura */}
      <footer className="h-12 bg-neutral-900/95 border-t border-neutral-800 px-3 sm:px-4 flex items-center justify-between text-[11px] text-neutral-400 shrink-0 z-20 shadow-lg">
        {/* Controles de Zoom para Mobile e Desktop */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={zoomOut}
            title="Diminuir Zoom"
            className="p-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-[11px] text-neutral-300 font-mono w-11 text-center font-bold">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={zoomIn}
            title="Aumentar Zoom"
            className="p-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors"
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          {/* Botão de Ajustar à Largura da Tela */}
          <button
            onClick={ajustarALargura}
            title="Ajustar à largura da tela"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-[11px] text-cyan-400 font-semibold transition-colors ml-1"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden xs:inline">Ajustar</span>
          </button>

          {/* Botão de Ampliação de Leitura (1.6x) */}
          <button
            onClick={alternarZoomLeitura}
            title="Toque duas vezes na folha ou clique aqui para ampliar o texto"
            className="hidden sm:flex items-center gap-1 px-2 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-[11px] text-amber-400 font-semibold transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Modo Leitura</span>
          </button>
        </div>

        {/* Informações e Detalhes */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] sm:hidden text-neutral-400">
            Toque 2x para ampliar
          </span>

          <span className="hidden sm:inline text-neutral-500">
            Oficina: <strong className="text-neutral-300 font-medium">{tenantNome}</strong>
          </span>

          <span className="hidden md:inline text-neutral-600">|</span>

          <span className="hidden md:flex items-center gap-1 text-neutral-500">
            <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
            Detailers DRM Shield 2.0
          </span>
        </div>
      </footer>
    </div>,
    document.body
  );
};
