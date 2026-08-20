import jsPDF from 'jspdf';
import { formatarOS } from './formatters';

export interface DadosCabecalhoPDF {
  oficinaNome: string;
  oficinaRazaoSocial?: string;
  oficinaDocumento?: string;
  oficinaDocumentoTipo?: 'cpf' | 'cnpj';
  oficinaCidadeUF?: string;
  oficinaTelefone?: string;
  logoBase64?: string;
  documentoTitulo: string;
  documentoSubtitulo?: string;
  dataEmissao?: string;
  statusBadge?: string;
  numeroOS?: number | null;
  // Personalização por Plano
  planoCodigo?: 'free' | 'pro' | 'studio' | string;
  pdfCorPrimaria?: string | null;
  pdfCorFundoCabecalho?: string | null;
  pdfCorTextoCabecalho?: string | null;
  pdfCorFundoSecoes?: string | null;
  pdfSubtituloCabecalho?: string | null;
  pdfTextoObservacoesOrcamento?: string | null;
  pdfTextoRodape?: string | null;
  pdfOcultarMarcaDagua?: boolean | null;
}

/**
 * Converte um código hexadecimal de cor (#FFFFFF) em um trio RGB [R, G, B].
 */
export function hexToRgb(hex?: string | null, defaultRgb: [number, number, number] = [245, 158, 11]): [number, number, number] {
  if (!hex) return defaultRgb;
  const cleanHex = hex.replace('#', '');
  if (cleanHex.length === 6) {
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
      return [r, g, b];
    }
  }
  return defaultRgb;
}

/**
 * Formata CPF ou CNPJ para exibição oficial em documentos.
 * Retorna string vazia se o documento não for informado.
 */
export function formatarDocumentoLegal(
  documento?: string | null,
  tipo?: 'cpf' | 'cnpj' | null
): string {
  if (!documento) return '';
  const digits = documento.replace(/\D/g, '');
  if (!digits) return '';

  if (tipo === 'cnpj' || digits.length === 14) {
    return `CNPJ ${digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}`;
  }
  if (tipo === 'cpf' || digits.length === 11) {
    return `CPF ${digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')}`;
  }
  return digits;
}

/**
 * Helper reutilizável para gerar o cabeçalho padrão em documentos PDF (Vistoria, Orçamento, Ordem de Serviço).
 * Suporta diferenciação de plano:
 * - Plano Free: Layout monocromático em tons de cinza/grafite.
 * - Plano Pro/Studio: Cores personalizadas de fundo da headline, destaque e subtítulo customizado.
 */
export function cabecalhoDocumento(
  doc: jsPDF,
  dados: DadosCabecalhoPDF
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const headerHeight = 34;
  const isFree = dados.planoCodigo === 'free';

  // Cor de fundo da Headline / Cabeçalho
  const fundoCabecalhoRgb = isFree
    ? [24, 24, 27] as [number, number, number]
    : hexToRgb(dados.pdfCorFundoCabecalho, [24, 24, 27]);

  doc.setFillColor(fundoCabecalhoRgb[0], fundoCabecalhoRgb[1], fundoCabecalhoRgb[2]);
  doc.rect(0, 0, pageWidth, headerHeight, 'F');

  let textStartX = 15;

  // Renderiza a logo à esquerda se fornecida
  if (dados.logoBase64) {
    try {
      const logoWidth = 24;
      const logoHeight = 24;
      doc.addImage(dados.logoBase64, 'PNG', 15, 5, logoWidth, logoHeight);
      textStartX = 43;
    } catch (e) {
      console.error('[PDF Header Logo Error]:', e);
      textStartX = 15;
    }
  }

  // Definição da cor de destaque do título (Mono no Free / Colorida no Pro/Studio)
  const corPrimariaRgb = isFree
    ? [228, 228, 231] as [number, number, number] // zinc-200 monocromático
    : hexToRgb(dados.pdfCorPrimaria, [245, 158, 11]); // Amber padrão ou customizado

  const corTextoCabecalhoRgb = isFree
    ? [212, 212, 216] as [number, number, number]
    : hexToRgb(dados.pdfCorTextoCabecalho, [255, 255, 255]);

  // Nome da Oficina e Razão Social (se disponível)
  doc.setTextColor(corPrimariaRgb[0], corPrimariaRgb[1], corPrimariaRgb[2]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12.5);
  const nomeDisplay = dados.oficinaRazaoSocial
    ? `${dados.oficinaNome.toUpperCase()} (${dados.oficinaRazaoSocial})`
    : dados.oficinaNome.toUpperCase();

  doc.text(nomeDisplay, textStartX, 10);

  // Subtítulo do Cabeçalho (Customizado nos planos Pro/Studio)
  doc.setTextColor(corTextoCabecalhoRgb[0], corTextoCabecalhoRgb[1], corTextoCabecalhoRgb[2]);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);

  const subtituloExibir = (!isFree && dados.pdfSubtituloCabecalho?.trim())
    ? dados.pdfSubtituloCabecalho.trim()
    : (dados.documentoSubtitulo || '');

  const docStr = formatarDocumentoLegal(dados.oficinaDocumento, dados.oficinaDocumentoTipo);
  const infoLinha = [dados.oficinaCidadeUF, dados.oficinaTelefone, docStr, subtituloExibir]
    .filter(Boolean)
    .join(' • ');

  doc.text(infoLinha || 'Plataforma Detailers', textStartX, 16);

  // Título do Documento
  doc.setFontSize(8);
  doc.setTextColor(corTextoCabecalhoRgb[0], corTextoCabecalhoRgb[1], corTextoCabecalhoRgb[2]);
  doc.text(dados.documentoTitulo.toUpperCase(), textStartX, 23);

  // Lado direito: OS, Data e Status
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(corPrimariaRgb[0], corPrimariaRgb[1], corPrimariaRgb[2]);

  if (dados.numeroOS) {
    const osStr = formatarOS(dados.numeroOS);
    const dataStr = dados.dataEmissao ? ` · ${dados.dataEmissao}` : '';
    doc.text(`${osStr}${dataStr}`, pageWidth - 15, 10, { align: 'right' });
  } else if (dados.dataEmissao) {
    doc.text(`DATA: ${dados.dataEmissao}`, pageWidth - 15, 10, { align: 'right' });
  }

  if (dados.statusBadge) {
    doc.setTextColor(244, 244, 245);
    doc.text(dados.statusBadge.toUpperCase(), pageWidth - 15, 16, { align: 'right' });
  }

  // Indicador discreto de Plano Monocromático no topo se for Free
  if (isFree) {
    doc.setFontSize(7);
    doc.setTextColor(113, 113, 122);
    doc.setFont('helvetica', 'normal');
    doc.text('LAYOUT ESSENCIAL (P&B)', pageWidth - 15, 23, { align: 'right' });
  }

  // Posição Y recomendada para início do corpo do documento
  return headerHeight + 8;
}

/**
 * Helper para renderizar o rodapé padrão com suporte a termos de garantia e marca d'água da plataforma.
 */
export function rodapeDocumento(
  doc: jsPDF,
  dados: {
    planoCodigo?: string;
    pdfTextoRodape?: string | null;
    pdfOcultarMarcaDagua?: boolean | null;
    paginaAtual?: number;
    totalPaginas?: number;
  }
): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const isFree = dados.planoCodigo === 'free';

  const footerY = pageHeight - 10;

  doc.setFontSize(7);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(113, 113, 122); // zinc-500

  // Marca d'água obrigatória no Free, opcional no Pro/Studio
  if (isFree || !dados.pdfOcultarMarcaDagua) {
    const marcaTxt = isFree
      ? 'Gerado via Plataforma Detailers — Plano Essencial'
      : 'Gerado via Plataforma Detailers';
    doc.text(marcaTxt, 15, footerY);
  } else if (dados.pdfTextoRodape?.trim()) {
    const termoCurto = dados.pdfTextoRodape.trim().slice(0, 80);
    doc.text(termoCurto, 15, footerY);
  }

  if (dados.paginaAtual && dados.totalPaginas) {
    doc.text(`Página ${dados.paginaAtual} de ${dados.totalPaginas}`, pageWidth - 15, footerY, { align: 'right' });
  }
}
