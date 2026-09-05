import jsPDF from 'jspdf';
import type { Checkin, CheckinAvaria, CheckinFoto, VistaDiagrama } from '../types/checkin';
import {
  formatarData,
  formatarHora,
} from './datas';
import {
  formatarNivelCombustivel,
  formatarNomeAvaria,
  formatarNomeVista,
} from './checkin';
import { fetchImageAsBase64, getEvidenciaSignedUrl, obterAssinaturaBase64 } from './evidencias';
import { cabecalhoDocumento, rodapeDocumento, hexToRgb } from './pdf';

interface PDFCheckinData {
  checkin: Checkin;
  avarias: CheckinAvaria[];
  fotos: CheckinFoto[];
  clienteNome: string;
  clienteTelefone: string;
  veiculoModelo: string;
  veiculoPlaca: string;
  veiculoCor?: string | null;
  oficinaNome: string;
  oficinaTelefone: string;
  oficinaCidadeUF?: string;
  oficinaLogoUrl?: string;
  oficinaDocumento?: string | null;
  oficinaDocumentoTipo?: 'cpf' | 'cnpj' | null;
  oficinaRazaoSocial?: string | null;
  svgElements?: { [key: string]: SVGSVGElement | null };
  numeroOS?: number | null;
  planoCodigo?: string;
  pdfCorPrimaria?: string | null;
  pdfCorFundoCabecalho?: string | null;
  pdfCorTextoCabecalho?: string | null;
  pdfCorFundoSecoes?: string | null;
  pdfCorTextoSecoes?: string | null;
  pdfSubtituloCabecalho?: string | null;
  pdfTextoObservacoesOrcamento?: string | null;
  pdfTextoRodape?: string | null;
  pdfOcultarMarcaDagua?: boolean | null;
}

/**
 * Converte uma string SVG autocontida (com xmlns e estilos inline) em PNG Base64 através do HTML5 Canvas.
 * Utiliza Data URI em Base64 para evitar bloqueio de Canvas Tainted (SecurityError) no WebKit/Safari/Chrome.
 */
async function svgStringToPngBase64(svgString: string, width = 800, height = 320): Promise<string> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      const encodedSvg = 'data:image/svg+xml;base64,' + window.btoa(unescape(encodeURIComponent(svgString)));

      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve('');
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/png'));
        } catch (canvasErr) {
          console.error('[Canvas toDataURL Error]:', canvasErr);
          resolve('');
        }
      };

      img.onerror = (err) => {
        console.warn('[SVG data URI error, tentando blob fallback]:', err);
        try {
          const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
          const url = URL.createObjectURL(svgBlob);
          const fallbackImg = new Image();
          fallbackImg.onload = () => {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(fallbackImg, 0, 0, width, height);
                URL.revokeObjectURL(url);
                resolve(canvas.toDataURL('image/png'));
                return;
              }
              URL.revokeObjectURL(url);
              resolve('');
            } catch {
              URL.revokeObjectURL(url);
              resolve('');
            }
          };
          fallbackImg.onerror = () => {
            URL.revokeObjectURL(url);
            resolve('');
          };
          fallbackImg.src = url;
        } catch {
          resolve('');
        }
      };

      img.src = encodedSvg;
    } catch (err) {
      console.error('[SVG string to PNG exception]:', err);
      resolve('');
    }
  });
}

/**
 * Gera uma string SVG pura, padronizada e autocontida para cada vista do veículo,
 * embutindo as marcações de avaria e seus respectivos números sequenciais para o PDF.
 */
function gerarSvgSilhuetaStandalone(
  vista: VistaDiagrama,
  avariasNaVista: CheckinAvaria[],
  todasAvarias: CheckinAvaria[]
): string {
  let pathContent = '';

  switch (vista) {
    case 'lateral_esquerda':
    case 'lateral_direita':
      pathContent = `
        <g stroke="#cbd5e1" stroke-width="2.2" fill="none">
          <!-- Teto, capô e porta-malas -->
          <path d="M 20,80 C 60,35 120,30 180,30 C 240,30 280,50 310,65 L 375,70 C 390,75 395,90 390,105 L 385,125 L 15,125 L 12,95 Z" stroke="#e2e8f0" stroke-width="2.5" />
          <!-- Vidros -->
          <path d="M 80,70 L 120,38 L 185,38 L 185,70 Z" fill="#27272a" stroke="#64748b" stroke-width="1.5" opacity="0.8" />
          <path d="M 190,38 L 245,38 L 280,70 L 190,70 Z" fill="#27272a" stroke="#64748b" stroke-width="1.5" opacity="0.8" />
          <!-- Rodas -->
          <circle cx="75" cy="125" r="22" fill="#09090b" stroke="#94a3b8" stroke-width="3" />
          <circle cx="75" cy="125" r="11" fill="#18181b" stroke="#cbd5e1" stroke-width="2" />
          <circle cx="315" cy="125" r="22" fill="#09090b" stroke="#94a3b8" stroke-width="3" />
          <circle cx="315" cy="125" r="11" fill="#18181b" stroke="#cbd5e1" stroke-width="2" />
          <!-- Divisão de portas e maçanetas -->
          <line x1="185" y1="38" x2="185" y2="125" stroke="#64748b" stroke-width="1.5" />
          <rect x="150" y="78" width="16" height="4" rx="1" fill="#cbd5e1" />
          <rect x="220" y="78" width="16" height="4" rx="1" fill="#cbd5e1" />
        </g>
      `;
      break;

    case 'frente':
      pathContent = `
        <g stroke="#cbd5e1" stroke-width="2.2" fill="none">
          <!-- Carroceria -->
          <path d="M 40,110 C 50,55 70,35 100,35 C 130,35 270,35 300,35 C 330,35 350,55 360,110 L 365,130 L 35,130 Z" stroke="#e2e8f0" stroke-width="2.5" />
          <!-- Parabrisa -->
          <path d="M 65,55 C 95,42 305,42 335,55 L 345,85 L 55,85 Z" fill="#27272a" stroke="#64748b" stroke-width="1.5" opacity="0.8" />
          <!-- Faróis -->
          <rect x="45" y="92" width="45" height="20" rx="4" fill="#fef08a" opacity="0.9" stroke="#eab308" stroke-width="2" />
          <rect x="310" y="92" width="45" height="20" rx="4" fill="#fef08a" opacity="0.9" stroke="#eab308" stroke-width="2" />
          <!-- Grade frontal -->
          <rect x="105" y="95" width="190" height="28" rx="3" fill="#09090b" stroke="#64748b" stroke-width="1.5" />
        </g>
      `;
      break;

    case 'traseira':
      pathContent = `
        <g stroke="#cbd5e1" stroke-width="2.2" fill="none">
          <!-- Carroceria -->
          <path d="M 40,110 C 50,55 70,35 100,35 C 130,35 270,35 300,35 C 330,35 350,55 360,110 L 365,130 L 35,130 Z" stroke="#e2e8f0" stroke-width="2.5" />
          <!-- Vidro traseiro -->
          <path d="M 65,55 C 95,42 305,42 335,55 L 345,85 L 55,85 Z" fill="#27272a" stroke="#64748b" stroke-width="1.5" opacity="0.8" />
          <!-- Lanternas traseiras -->
          <rect x="45" y="92" width="45" height="20" rx="4" fill="#f87171" opacity="0.9" stroke="#dc2626" stroke-width="2" />
          <rect x="310" y="92" width="45" height="20" rx="4" fill="#f87171" opacity="0.9" stroke="#dc2626" stroke-width="2" />
          <!-- Placa -->
          <rect x="140" y="100" width="120" height="20" rx="2" fill="#ffffff" stroke="#000000" stroke-width="1.5" />
        </g>
      `;
      break;

    case 'superior':
      pathContent = `
        <g stroke="#cbd5e1" stroke-width="2.2" fill="none">
          <!-- Contorno superior -->
          <path d="M 40,20 C 80,12 320,12 360,20 C 380,40 380,120 360,140 C 320,148 80,148 40,140 C 20,120 20,40 40,20 Z" stroke="#e2e8f0" stroke-width="2.5" />
          <!-- Vidro dianteiro e traseiro -->
          <path d="M 70,30 C 120,25 280,25 330,30 L 320,55 C 260,50 140,50 80,55 Z" fill="#27272a" stroke="#64748b" stroke-width="1.5" opacity="0.8" />
          <path d="M 70,130 C 120,135 280,135 330,130 L 320,105 C 260,110 140,110 80,105 Z" fill="#27272a" stroke="#64748b" stroke-width="1.5" opacity="0.8" />
          <!-- Teto / Solar -->
          <rect x="80" y="55" width="240" height="50" fill="#09090b" stroke="#64748b" stroke-width="1.5" />
        </g>
      `;
      break;
  }

  // Desenhar cada avaria presente nesta vista com seu símbolo e número correspondente à lista
  const avariasMarkup = avariasNaVista
    .map((av) => {
      const cx = (av.pos_x * 400) / 100;
      const cy = (av.pos_y * 160) / 100;
      const globalIdx = todasAvarias.findIndex((a) => a.id === av.id) + 1;

      let icone = '';
      if (av.tipo === 'risco') {
        icone = `<circle cx="${cx}" cy="${cy}" r="8" fill="none" stroke="#f97316" stroke-width="3" />`;
      } else if (av.tipo === 'amassado') {
        icone = `<circle cx="${cx}" cy="${cy}" r="8" fill="#ea580c" stroke="#ffffff" stroke-width="2" />`;
      } else if (av.tipo === 'avariado') {
        icone = `
          <line x1="${cx - 7}" y1="${cy - 7}" x2="${cx + 7}" y2="${cy + 7}" stroke="#ef4444" stroke-width="3.5" />
          <line x1="${cx + 7}" y1="${cy - 7}" x2="${cx - 7}" y2="${cy + 7}" stroke="#ef4444" stroke-width="3.5" />
        `;
      } else if (av.tipo === 'faltante') {
        icone = `<polygon points="${cx},${cy - 8} ${cx - 8},${cy + 7} ${cx + 8},${cy + 7}" fill="#dc2626" stroke="#ffffff" stroke-width="2" />`;
      }

      // Badge numérico para rastreamento visual direto com o item da lista
      const badgeMarkup = globalIdx > 0
        ? `
          <circle cx="${cx + 9}" cy="${cy - 9}" r="6.5" fill="#f59e0b" stroke="#18181b" stroke-width="1.2" />
          <text x="${cx + 9}" y="${cy - 6.5}" font-family="Helvetica, Arial, sans-serif" font-size="7.5" font-weight="bold" fill="#000000" text-anchor="middle" dominant-baseline="middle">${globalIdx}</text>
        `
        : '';

      return `
        <g>
          <!-- Halo de destaque -->
          <circle cx="${cx}" cy="${cy}" r="13" fill="#f59e0b" fill-opacity="0.25" stroke="#f59e0b" stroke-width="1" />
          ${icone}
          ${badgeMarkup}
        </g>
      `;
    })
    .join('\n');

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="800" height="320" viewBox="0 0 400 160">
      <rect width="400" height="160" rx="8" fill="#18181b" stroke="#3f3f46" stroke-width="2" />
      ${pathContent}
      ${avariasMarkup}
    </svg>
  `.trim();
}

/**
 * Obtém as dimensões reais (largura e altura em pixels) de uma imagem em Base64.
 */
function getImageDimensions(base64: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    if (!base64) {
      resolve({ width: 100, height: 100 });
      return;
    }
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.width || 100, height: img.height || 100 });
    };
    img.onerror = () => {
      resolve({ width: 100, height: 100 });
    };
    img.src = base64;
  });
}

/**
 * Desenha uma imagem dentro de uma caixa delimitadora (boxX, boxY, boxWidth, boxHeight)
 * mantendo a proporção original da imagem (sem esticar ou achatá-la) e alinhando-a ao centro.
 */
async function drawProportionalImage(
  doc: jsPDF,
  base64: string,
  format: 'JPEG' | 'PNG',
  boxX: number,
  boxY: number,
  boxWidth: number,
  boxHeight: number
): Promise<{ drawWidth: number; drawHeight: number; drawX: number; drawY: number }> {
  const { width: realW, height: realH } = await getImageDimensions(base64);
  const scale = Math.min(boxWidth / realW, boxHeight / realH);

  const drawW = realW * scale;
  const drawH = realH * scale;

  const drawX = boxX + (boxWidth - drawW) / 2;
  const drawY = boxY + (boxHeight - drawH) / 2;

  doc.addImage(base64, format, drawX, drawY, drawW, drawH);

  return { drawWidth: drawW, drawHeight: drawH, drawX, drawY };
}

export async function gerarPDFCheckin(
  data: PDFCheckinData,
  onProgress?: (statusText: string) => void,
  acao: 'download' | 'print' = 'download'
): Promise<void> {
  const {
    checkin,
    avarias,
    fotos,
    clienteNome,
    clienteTelefone,
    veiculoModelo,
    veiculoPlaca,
    veiculoCor,
    oficinaNome,
    oficinaTelefone,
    oficinaCidadeUF,
    oficinaLogoUrl,
    oficinaDocumento,
    oficinaDocumentoTipo,
    oficinaRazaoSocial,
    numeroOS,
  } = data;

  onProgress?.('Iniciando montagem do relatório PDF...');

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 210mm
  const pageMargin = 15; // Margem oficial de 15mm em todos os lados
  const usableWidth = pageWidth - pageMargin * 2; // 180mm de largura útil
  const rightMarginX = pageMargin + usableWidth; // 195mm

  // Carregar Logo em Base64 se disponível
  let logoBase64 = '';
  if (oficinaLogoUrl) {
    try {
      onProgress?.('Carregando logo da oficina...');
      logoBase64 = await fetchImageAsBase64(oficinaLogoUrl);
    } catch (e) {
      console.error('Erro ao baixar logo para o PDF:', e);
    }
  }

  // 1. Cabeçalho Padronizado com Margens de 15mm
  let y = cabecalhoDocumento(doc, {
    oficinaNome,
    oficinaRazaoSocial: oficinaRazaoSocial || undefined,
    oficinaDocumento: oficinaDocumento || undefined,
    oficinaDocumentoTipo: (oficinaDocumentoTipo as any) || undefined,
    oficinaTelefone,
    oficinaCidadeUF,
    logoBase64,
    documentoTitulo: 'Vistoria de Entrada do Veículo',
    dataEmissao: `${formatarData(checkin.created_at)} ${formatarHora(checkin.created_at)}`,
    statusBadge: checkin.finalizado ? 'Assinado e Confirmado' : 'Em Preenchimento',
    numeroOS,
    planoCodigo: data.planoCodigo,
    pdfCorPrimaria: data.pdfCorPrimaria,
    pdfCorFundoCabecalho: data.pdfCorFundoCabecalho,
    pdfCorTextoCabecalho: data.pdfCorTextoCabecalho,
    pdfCorFundoSecoes: data.pdfCorFundoSecoes,
    pdfCorTextoSecoes: data.pdfCorTextoSecoes || undefined,
    pdfSubtituloCabecalho: data.pdfSubtituloCabecalho,
    pdfTextoObservacoesOrcamento: data.pdfTextoObservacoesOrcamento,
    pdfTextoRodape: data.pdfTextoRodape,
    pdfOcultarMarcaDagua: data.pdfOcultarMarcaDagua,
  });

  const isFree = data.planoCodigo === 'free';
  const corFundoSecoesRgb = isFree ? [39, 39, 42] as [number, number, number] : hexToRgb(data.pdfCorFundoSecoes, [39, 39, 42]);
  const corPrimariaRgb = isFree ? [245, 158, 11] as [number, number, number] : hexToRgb(data.pdfCorPrimaria, [245, 158, 11]);

  // Detector de Fundo Claro vs Escuro
  const lumFundoSecoes = (0.299 * corFundoSecoesRgb[0] + 0.587 * corFundoSecoesRgb[1] + 0.114 * corFundoSecoesRgb[2]) / 255;
  const isLightSecoes = lumFundoSecoes > 0.65;

  const corTextoPrincipal: [number, number, number] = data.pdfCorTextoSecoes
    ? hexToRgb(data.pdfCorTextoSecoes, isLightSecoes ? [15, 23, 42] : [255, 255, 255])
    : (isLightSecoes ? [15, 23, 42] : [255, 255, 255]);

  const lumTexto = (0.299 * corTextoPrincipal[0] + 0.587 * corTextoPrincipal[1] + 0.114 * corTextoPrincipal[2]) / 255;
  const isTextoEscuro = lumTexto < 0.5;

  const corTextoSecundario: [number, number, number] = isTextoEscuro ? [82, 82, 91] : [203, 213, 225];
  const corBordaCard: [number, number, number] = isLightSecoes ? [203, 213, 225] : [63, 63, 70];
  const corDestaquePreco: [number, number, number] = isLightSecoes
    ? (corPrimariaRgb[0] > 200 && corPrimariaRgb[1] > 180 ? [180, 83, 9] : corPrimariaRgb)
    : [251, 191, 36];

  // 2. Dados do Cliente e Veículo
  doc.setFillColor(corFundoSecoesRgb[0], corFundoSecoesRgb[1], corFundoSecoesRgb[2]);
  doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
  doc.setLineWidth(0.25);
  doc.roundedRect(pageMargin, y, usableWidth, 22, 2, 2, 'FD');

  doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  doc.text('CLIENTE & VEÍCULO', pageMargin + 5, y + 6);

  doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.text(`Cliente: ${clienteNome} (${clienteTelefone || '—'})`, pageMargin + 5, y + 12);
  const corFormatada = ` | Cor: ${veiculoCor?.trim() || 'Não informada'}`;
  doc.text(`Veículo: ${veiculoModelo} | Placa: ${veiculoPlaca.toUpperCase()}${corFormatada}`, pageMargin + 5, y + 17);

  doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
  doc.text(`KM: ${checkin.km ? checkin.km.toLocaleString('pt-BR') : '—'}`, rightMarginX - 5, y + 12, { align: 'right' });
  doc.text(`Combustível: ${formatarNivelCombustivel(checkin.nivel_combustivel)}`, rightMarginX - 5, y + 17, { align: 'right' });

  y += 28;

  // Helper de formatar rótulos para o PDF com mapeamento completo de todas as abas
  const formatarLabelItem = (key: string): string => {
    const map: Record<string, string> = {
      farol_baixo: 'Farol baixo',
      farol_alto: 'Farol alto',
      meia_luz: 'Meia luz',
      pisca_dianteiro: 'Pisca dianteiro',
      pisca_traseiro: 'Pisca traseiro',
      lanterna_freio: 'Lanterna freio',
      luz_re: 'Luz de ré',
      neblina: 'Farol neblina',
      placa: 'Luz de placa',
      luz_cabine: 'Luz de cabine',
      motor: 'Cofre do motor',
      chassi: 'Chassi / Rodas',
      carroceria: 'Carroceria / Lataria',
      bancos: 'Bancos / Estofados',
      carpete: 'Carpete / Tapetes',
      painel: 'Painel / Console',
      interior_geral: 'Interior geral',
      oleo_motor: 'Óleo motor',
      fluido_freio: 'Fluido freio',
      freio: 'Fluido de freio',
      arrefecimento: 'Arrefecimento',
      direcao: 'Direção hidráulica',
      direcao_hidraulica: 'Direção hidráulica',
      parabrisa: 'Água parabrisa',
      tapetes: 'Tapetes',
      portamalas: 'Porta-malas',
      teto: 'Teto',
      vidros: 'Vidros',
      externo: 'Exterior',
    };
    if (map[key]) return map[key];
    return key.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  };

  const formatarValorEstado = (val: string): string => {
    if (val === 'ok') return 'OK';
    if (val === 'queimado') return 'QUEIMADO';
    if (val === 'baixo') return 'BAIXO';
    if (val === 'medio') return 'MÉDIO';
    if (val === 'alto') return 'ALTO';
    if (val === 'ruim') return 'RUIM';
    if (val === 'limpo') return 'LIMPO';
    if (val === 'sujo') return 'SUJO';
    if (val === 'extremo') return 'EXTREMO';
    if (val === 'avariado') return 'AVARIADO';
    return val.toUpperCase();
  };

  // Preparar listas omitindo "nao_testado" / "nao_verificado"
  const ilumEntries = Object.entries(checkin.iluminacao || {})
    .filter(([_, v]) => v !== 'nao_testado')
    .map(([k, v]) => ({ label: formatarLabelItem(k), val: formatarValorEstado(v), raw: v }));

  const fluidoEntries = Object.entries(checkin.fluidos || {})
    .filter(([_, v]) => v !== 'nao_verificado')
    .map(([k, v]) => ({ label: formatarLabelItem(k), val: formatarValorEstado(v), raw: v }));

  const sujEntries = Object.entries(checkin.sujidade || {})
    .map(([k, v]) => ({ label: formatarLabelItem(k), val: formatarValorEstado(v), raw: v }));

  const estepeTxt = checkin.estepe === true ? 'Sim' : checkin.estepe === false ? 'Não' : 'Não verificado';

  // Largura útil de cada coluna no bloco de inspeção
  const colW = (usableWidth - 6) / 2; // 87mm por coluna
  const col1X = pageMargin + 4;
  const col2X = pageMargin + usableWidth / 2 + 3;

  // Formatação humanizada das Luzes do Painel
  const mapLuzesPainel: Record<string, string> = {
    injecao: 'Injeção eletrônica',
    bateria: 'Bateria / Alternador',
    oleo: 'Pressão do óleo',
    abs: 'ABS',
    airbag: 'Airbag',
    temperatura: 'Temperatura motor',
    freio: 'Freio / Fluido',
    tpms: 'Pressão pneus (TPMS)',
    motor: 'Check engine',
  };

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  const luzesTextoCompleto = checkin.luzes_painel && checkin.luzes_painel.length > 0
    ? checkin.luzes_painel.map((l) => mapLuzesPainel[l] || l.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())).join(', ')
    : 'Nenhuma luz de advertência acesa';
  const luzesLines: string[] = doc.splitTextToSize(luzesTextoCompleto, colW - 4);

  const obsLines: string[] = checkin.observacoes
    ? doc.splitTextToSize(`Obs: ${checkin.observacoes}`, colW - 4)
    : [];

  // Calcular altura exata e dinâmica do retângulo de fundo
  const countLeft = 2 + Math.max(ilumEntries.length, 1) + Math.max(fluidoEntries.length, 1);
  const countRight = 2 + Math.max(sujEntries.length, 1) + 2 + luzesLines.length + obsLines.length;
  const maxLines = Math.max(countLeft, countRight);
  // Adiciona 10mm de folga segura (+ 4mm de padding inferior) para garantir que fluidos não fiquem cortados
  const boxHeight = Math.max(maxLines * 4.5 + 10, 40);

  // Desenhar bloco de fundo com altura calculada
  doc.setFillColor(corFundoSecoesRgb[0], corFundoSecoesRgb[1], corFundoSecoesRgb[2]);
  doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
  doc.setLineWidth(0.25);
  doc.roundedRect(pageMargin, y, usableWidth, boxHeight, 2, 2, 'FD');

  let curY1 = y + 5;
  let curY2 = y + 5;

  // --- COLUNA 1: ILUMINAÇÃO E FLUIDOS ---
  doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('ILUMINAÇÃO', col1X, curY1);
  curY1 += 4;

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  if (ilumEntries.length === 0) {
    doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
    doc.text('Sem itens testados', col1X, curY1);
    curY1 += 4;
  } else {
    ilumEntries.forEach((it) => {
      doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
      doc.text(`${it.label}: `, col1X, curY1);
      const lWidth = doc.getTextWidth(`${it.label}: `);
      if (it.raw === 'queimado') doc.setTextColor(248, 113, 113);
      else doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
      doc.setFont('helvetica', 'bold');
      doc.text(it.val, col1X + lWidth, curY1);
      doc.setFont('helvetica', 'normal');
      curY1 += 3.8;
    });
  }

  curY1 += 2;
  doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('FLUIDOS E NÍVEIS', col1X, curY1);
  curY1 += 4;

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  if (fluidoEntries.length === 0) {
    doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
    doc.text('Sem fluidos verificados', col1X, curY1);
    curY1 += 4;
  } else {
    fluidoEntries.forEach((it) => {
      doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
      doc.text(`${it.label}: `, col1X, curY1);
      const lWidth = doc.getTextWidth(`${it.label}: `);
      if (it.raw === 'baixo' || it.raw === 'ruim') doc.setTextColor(248, 113, 113);
      else doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
      doc.setFont('helvetica', 'bold');
      doc.text(it.val, col1X + lWidth, curY1);
      doc.setFont('helvetica', 'normal');
      curY1 += 3.8;
    });
  }

  // --- COLUNA 2: SUJIDADE & PAINEL/ESTEPE ---
  doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('NÍVEIS DE SUJIDADE', col2X, curY2);
  curY2 += 4;

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  if (sujEntries.length === 0) {
    doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
    doc.text('Não informado', col2X, curY2);
    curY2 += 4;
  } else {
    sujEntries.forEach((it) => {
      doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
      doc.text(`${it.label}: `, col2X, curY2);
      const lWidth = doc.getTextWidth(`${it.label}: `);
      if (it.raw === 'sujo' || it.raw === 'extremo') doc.setTextColor(251, 191, 36);
      else doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
      doc.setFont('helvetica', 'bold');
      doc.text(it.val, col2X + lWidth, curY2);
      doc.setFont('helvetica', 'normal');
      curY2 += 3.8;
    });
  }

  curY2 += 2;
  doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('PAINEL & ESTEPE', col2X, curY2);
  curY2 += 4;

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
  doc.text('Estepe: ', col2X, curY2);
  doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
  doc.setFont('helvetica', 'bold');
  doc.text(estepeTxt, col2X + doc.getTextWidth('Estepe: '), curY2);
  doc.setFont('helvetica', 'normal');
  curY2 += 4;

  // Rótulo explícito para condição de entrada
  doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
  doc.text('Luzes acesas no painel na entrada:', col2X, curY2);
  curY2 += 4;

  doc.setFont('helvetica', 'bold');
  if (checkin.luzes_painel && checkin.luzes_painel.length > 0) {
    doc.setTextColor(248, 113, 113); // Vermelho/flare
  } else {
    doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]); // Neutro
  }

  luzesLines.forEach((line) => {
    doc.text(line, col2X + 2, curY2);
    curY2 += 3.8;
  });

  if (obsLines.length > 0) {
    curY2 += 1;
    doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
    doc.setFont('helvetica', 'italic');
    obsLines.forEach((line) => {
      doc.text(line, col2X, curY2);
      curY2 += 3.8;
    });
  }

  y += boxHeight + 6;

  // 4. Diagrama de Avarias do Veículo em Grade de 2 Colunas (APENAS VISTAS COM AVARIAS)
  const vistasKeys: { key: VistaDiagrama; label: string }[] = [
    { key: 'frente', label: 'Frente' },
    { key: 'traseira', label: 'Traseira' },
    { key: 'lateral_esquerda', label: 'Lateral Esquerda' },
    { key: 'lateral_direita', label: 'Lateral Direita' },
    { key: 'superior', label: 'Vista Superior' },
  ];

  const vistasComAvarias = vistasKeys.filter((vItem) =>
    avarias.some((a) => a.vista === vItem.key)
  );

  if (vistasComAvarias.length > 0) {
    onProgress?.('Renderizando diagramas das vistas com avarias...');

    if (y + 55 > 270) {
      doc.addPage();
      y = 15;
    }

    doc.setTextColor(245, 158, 11);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('DIAGRAMAS DE AVARIAS DO VEÍCULO', pageMargin, y);
    y += 6;

    const diagW = (usableWidth - 6) / 2; // ~87mm
    const diagH = 42; // Altura proporcional

    for (let i = 0; i < vistasComAvarias.length; i++) {
      const item = vistasComAvarias[i];
      const col = i % 2; // 0 ou 1
      const diagX = pageMargin + col * (diagW + 6);

      if (col === 0 && i > 0) {
        y += diagH + 10;
      }

      // Verificação de quebra de página: garante que imagem E rótulo fiquem juntos na mesma página
      if (y + diagH + 10 > 270) {
        doc.addPage();
        y = 15;
      }

      const avariasDaVista = avarias.filter((a) => a.vista === item.key);
      const svgString = gerarSvgSilhuetaStandalone(item.key, avariasDaVista, avarias);
      const pngBase64 = await svgStringToPngBase64(svgString, 800, 320);
      if (pngBase64) {
        doc.addImage(pngBase64, 'PNG', diagX, y, diagW, diagH);
      }

      // Título da vista centralizado abaixo da imagem
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(251, 191, 36);
      doc.text(item.label.toUpperCase(), diagX + diagW / 2, y + diagH + 4, { align: 'center' });
    }

    y += diagH + 12;
  }

  // 5. Lista de Avarias Registradas
  if (y + 15 > 270) {
    doc.addPage();
    y = 15;
  }

  doc.setTextColor(245, 158, 11);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(`MARCAÇÕES DE AVARIA REGISTRADAS (${avarias.length})`, pageMargin, y);
  y += 5;

  if (avarias.length === 0) {
    doc.setTextColor(200, 200, 200);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'italic');
    doc.text('Nenhuma avaria ou risco marcado no diagrama.', pageMargin + 4, y);
    y += 6;
  } else {
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    avarias.forEach((av, idx) => {
      const vistaNome = formatarNomeVista(av.vista);
      const tipoNome = formatarNomeAvaria(av.tipo);

      let fullLine = `${idx + 1}. ${vistaNome} — ${tipoNome}`;
      if (av.descricao && av.descricao.trim()) {
        fullLine += `: ${av.descricao.trim()}`;
      }

      const wrappedLines: string[] = doc.splitTextToSize(fullLine, usableWidth - 6);
      const itemHeight = wrappedLines.length * 4;

      if (y + itemHeight > 270) {
        doc.addPage();
        y = 15;
      }

      doc.setTextColor(251, 191, 36);
      doc.setFont('helvetica', 'bold');
      doc.text(wrappedLines[0], pageMargin + 2, y);

      if (wrappedLines.length > 1) {
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'normal');
        for (let l = 1; l < wrappedLines.length; l++) {
          doc.text(wrappedLines[l], pageMargin + 6, y + l * 3.8);
        }
      }

      y += itemHeight + 2;
    });
  }

  y += 4;

  // 6. Fotos de Entrada & Avarias
  if (fotos.length > 0) {
    if (y + 40 > 275) {
      doc.addPage();
      y = 15;
    }

    doc.setTextColor(245, 158, 11);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(`FOTOS DE VISTORIA E AVARIAS (${fotos.length})`, pageMargin, y);
    y += 6;

    const photosPerRow = 2;
    const gap = 6;
    const boxWidth = (usableWidth - gap) / 2; // ~87mm por caixa de foto
    const boxHeight = 65; // ~65mm de altura para fotos nítidas como prova

    let photoX = pageMargin;
    let photoY = y;

    for (let i = 0; i < fotos.length; i++) {
      const foto = fotos[i];
      onProgress?.(`Baixando e convertendo foto ${i + 1} de ${fotos.length}...`);

      try {
        const signedUrl = await getEvidenciaSignedUrl(foto.path);
        if (signedUrl) {
          const base64 = await fetchImageAsBase64(signedUrl);
          if (base64) {
            if (photoY + boxHeight + 10 > 275) {
              doc.addPage();
              photoY = 15;
              photoX = pageMargin;
            }

            // Fundo escuro sutil para a moldura da foto
            doc.setFillColor(24, 24, 27);
            doc.roundedRect(photoX, photoY, boxWidth, boxHeight, 1.5, 1.5, 'F');

            // Desenho proporcional mantendo aspect ratio real da foto (retrato ou paisagem)
            await drawProportionalImage(doc, base64, 'JPEG', photoX, photoY, boxWidth, boxHeight);

            // Carimbo de data/hora imutável e descrição abaixo de cada foto
            doc.setFontSize(6.8);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(245, 158, 11);
            const descTxt = foto.descricao ? ` · ${foto.descricao}` : '';
            doc.text(
              `${formatarData(foto.created_at)} ${formatarHora(foto.created_at)}${descTxt}`,
              photoX + boxWidth / 2,
              photoY + boxHeight + 4,
              { align: 'center' }
            );
          }
        }
      } catch (e) {
        console.error('Erro ao inserir foto no PDF:', e);
      }

      if ((i + 1) % photosPerRow === 0) {
        photoX = pageMargin;
        photoY += boxHeight + 10;
      } else {
        photoX += boxWidth + gap;
      }
    }

    y = photoY + (fotos.length % photosPerRow !== 0 ? boxHeight + 10 : 2);
  }

  // 7. Rodapé com Assinatura e Termo Legal
  if (y + 35 > 275) {
    doc.addPage();
    y = 15;
  }

  doc.setFillColor(39, 39, 42); // graphite-800
  doc.roundedRect(pageMargin, y, usableWidth, 32, 2, 2, 'F');

  doc.setTextColor(200, 200, 200);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'italic');
  const termoTxt = '"Declaro que as informações e avarias registradas acima refletem com precisão o estado do veículo na entrega."';
  const termoLines = doc.splitTextToSize(termoTxt, usableWidth - 68);
  termoLines.forEach((line: string, idx: number) => {
    doc.text(line, pageMargin + 4, y + 6 + idx * 3.5);
  });

  const sigPathOrData = checkin.assinatura_path || (checkin as any).assinatura_url || (checkin as any).assinatura_base64;

  if (sigPathOrData) {
    onProgress?.('Carregando assinatura digital do cliente...');
    try {
      const assBase64 = await obterAssinaturaBase64(sigPathOrData);
      if (assBase64) {
        const sigBoxW = 48;
        const sigBoxH = 18;
        const sigBoxX = rightMarginX - 52;
        const sigBoxY = y + 2;

        // Desenha retângulo de fundo branco para PNGs de assinatura transparentes
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(sigBoxX, sigBoxY, sigBoxW, sigBoxH, 1, 1, 'F');

        // Desenho proporcional da assinatura
        await drawProportionalImage(doc, assBase64, 'PNG', sigBoxX, sigBoxY, sigBoxW, sigBoxH);
      }
    } catch (e) {
      console.error('Erro ao carregar assinatura no PDF:', e);
    }
  } else {
    // Bloco para Assinatura Manual / Física no papel
    const sigBoxW = 60;
    const sigBoxX = rightMarginX - 64;
    const sigBoxY = y + 3;

    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(sigBoxX, sigBoxY + 12, sigBoxX + sigBoxW, sigBoxY + 12);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(180, 180, 180);
    doc.text('Assinatura Manual do Cliente', sigBoxX + sigBoxW / 2, sigBoxY + 16, { align: 'center' });
  }

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  const nomeSignatario = checkin.assinatura_nome || clienteNome || 'Cliente';
  doc.text(`Signatário: ${nomeSignatario}`, pageMargin + 4, y + 22);

  if (checkin.assinado_em) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(`Assinado em: ${formatarData(checkin.assinado_em)} ${formatarHora(checkin.assinado_em)}`, pageMargin + 4, y + 27);
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(251, 191, 36);
    doc.text('Via impressa para coleta de assinatura física / manual', pageMargin + 4, y + 27);
  }

  // Nota legal de carimbos de fotos no rodapé
  doc.setFontSize(7);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(161, 161, 170); // zinc-400
  doc.text(
    'Datas registradas pelo sistema no momento do envio das imagens.',
    pageMargin + 4,
    y + 36
  );

  // Rodapé padrão em todas as páginas
  const totalPaginas = doc.getNumberOfPages();
  for (let p = 1; p <= totalPaginas; p++) {
    doc.setPage(p);
    rodapeDocumento(doc, {
      planoCodigo: data.planoCodigo,
      pdfTextoRodape: data.pdfTextoRodape,
      pdfOcultarMarcaDagua: data.pdfOcultarMarcaDagua,
      paginaAtual: p,
      totalPaginas,
    });
  }

  onProgress?.('Finalizando PDF da vistoria...');
  const nomeArquivo = `vistoria_${veiculoPlaca.toUpperCase()}_${checkin.id.substring(0, 6)}.pdf`;

  const isMobile = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  if (acao === 'print' && !isMobile) {
    try {
      doc.autoPrint();
      const blobUrl = doc.output('bloburl');
      const win = window.open(blobUrl, '_blank');
      if (!win) {
        doc.save(nomeArquivo);
      }
    } catch {
      doc.save(nomeArquivo);
    }
  } else {
    doc.save(nomeArquivo);
  }
}
