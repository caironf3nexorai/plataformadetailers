import jsPDF from 'jspdf';
import { formatarData, formatarHora } from './datas';
import { formatarMoeda, formatarCodigoProposta } from './formatters';
import { fetchImageAsBase64, obterAssinaturaBase64 } from './evidencias';
import { cabecalhoDocumento, hexToRgb } from './pdf';
import type { TipoNivelOrcamento } from '../types/orcamento';

export interface PDFOrcamentoItemData {
  servico_nome: string;
  servico_descricao?: string | null;
  preco?: number;
  duracao_minutos?: number;
}

export interface PDFOrcamentoNivelData {
  nivel: TipoNivelOrcamento;
  titulo: string;
  descricao?: string | null;
  valor_total: number;
  valor_original?: number;
  duracao_total: number;
  destaque?: boolean;
  itens: PDFOrcamentoItemData[];
}

export interface PDFOrcamentoData {
  id: string;
  numero?: number | null;
  numero_os?: number | null;
  status: string;
  nivel_aprovado?: TipoNivelOrcamento | null;
  enviado_em?: string | null;
  validade_dias?: number;
  data_validade_limite?: string | null;
  observacoes?: string | null;
  
  // Cliente & Veículo
  clienteNome: string;
  clienteTelefone?: string | null;
  veiculoModelo?: string | null;
  veiculoPlaca?: string | null;
  categoriaNome?: string | null;

  // Oficina
  oficinaNome: string;
  oficinaRazaoSocial?: string | null;
  oficinaDocumento?: string | null;
  oficinaDocumentoTipo?: 'cpf' | 'cnpj' | null;
  oficinaTelefone?: string | null;
  oficinaCidadeUF?: string | null;
  oficinaLogoUrl?: string | null;

  // Assinatura Digital do Cliente
  assinaturaUrl?: string | null;
  assinaturaNome?: string | null;
  assinaturaData?: string | null;

  // Desconto
  desconto?: {
    tipo: 'porcentagem' | 'valor_fixo';
    valor: number;
    motivo?: string | null;
    cupom_codigo?: string | null;
  } | null;

  // Níveis
  niveis: PDFOrcamentoNivelData[];

  // Branding Customizado
  planoCodigo?: string;
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
 * Obtém as dimensões reais de uma imagem em Base64.
 */
function getImageDimensions(base64: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    if (!base64) {
      resolve({ width: 100, height: 100 });
      return;
    }
    const img = new Image();
    img.onload = () => resolve({ width: img.width || 100, height: img.height || 100 });
    img.onerror = () => resolve({ width: 100, height: 100 });
    img.src = base64;
  });
}

/**
 * Desenha imagem mantendo proporção de aspecto.
 */
async function drawProportionalImage(
  doc: jsPDF,
  base64: string,
  format: 'JPEG' | 'PNG',
  boxX: number,
  boxY: number,
  boxWidth: number,
  boxHeight: number
) {
  const { width: realW, height: realH } = await getImageDimensions(base64);
  const scale = Math.min(boxWidth / realW, boxHeight / realH);
  const drawW = realW * scale;
  const drawH = realH * scale;
  const drawX = boxX + (boxWidth - drawW) / 2;
  const drawY = boxY + (boxHeight - drawH) / 2;

  doc.addImage(base64, format, drawX, drawY, drawW, drawH);
}

export async function gerarPDFOrcamento(
  data: PDFOrcamentoData,
  onProgress?: (statusText: string) => void
): Promise<void> {
  onProgress?.('Iniciando geração do PDF do orçamento...');

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 210mm
  const pageMargin = 15;
  const usableWidth = pageWidth - pageMargin * 2; // 180mm
  const rightMarginX = pageMargin + usableWidth;

  // Carregar Logo da oficina
  let logoBase64 = '';
  if (data.oficinaLogoUrl) {
    try {
      onProgress?.('Carregando logo da oficina...');
      logoBase64 = await fetchImageAsBase64(data.oficinaLogoUrl);
    } catch (e) {
      console.error('[PDFOrcamento] Erro ao carregar logo:', e);
    }
  }

  const codProposta = formatarCodigoProposta({ numero: data.numero, numero_os: data.numero_os });

  // 1. Cabeçalho Padronizado
  let y = cabecalhoDocumento(doc, {
    oficinaNome: data.oficinaNome,
    oficinaRazaoSocial: data.oficinaRazaoSocial || undefined,
    oficinaDocumento: data.oficinaDocumento || undefined,
    oficinaDocumentoTipo: data.oficinaDocumentoTipo || undefined,
    oficinaTelefone: data.oficinaTelefone || undefined,
    oficinaCidadeUF: data.oficinaCidadeUF || undefined,
    logoBase64,
    documentoTitulo: data.numero_os ? `Orçamento / OS ${codProposta}` : `Proposta de Orçamento ${codProposta}`,
    dataEmissao: data.enviado_em ? `${formatarData(data.enviado_em)} ${formatarHora(data.enviado_em)}` : formatarData(new Date().toISOString()),
    statusBadge: data.status === 'aprovado' ? 'Orçamento Aprovado' : data.status === 'recusado' ? 'Orçamento Recusado' : 'Proposta em Aberto',
    numeroOS: data.numero_os,
    planoCodigo: data.planoCodigo,
    pdfCorPrimaria: data.pdfCorPrimaria,
    pdfCorFundoCabecalho: data.pdfCorFundoCabecalho,
    pdfCorTextoCabecalho: data.pdfCorTextoCabecalho,
    pdfCorFundoSecoes: data.pdfCorFundoSecoes,
    pdfSubtituloCabecalho: data.pdfSubtituloCabecalho,
    pdfTextoObservacoesOrcamento: data.pdfTextoObservacoesOrcamento,
    pdfTextoRodape: data.pdfTextoRodape,
    pdfOcultarMarcaDagua: data.pdfOcultarMarcaDagua,
  });

  const isFree = data.planoCodigo === 'free';
  const corFundoSecoesRgb = isFree ? [39, 39, 42] as [number, number, number] : hexToRgb(data.pdfCorFundoSecoes, [39, 39, 42]);
  const corPrimariaRgb = isFree ? [251, 191, 36] as [number, number, number] : hexToRgb(data.pdfCorPrimaria, [245, 158, 11]);

  // 2. Bloco Cliente & Veículo
  doc.setFillColor(corFundoSecoesRgb[0], corFundoSecoesRgb[1], corFundoSecoesRgb[2]);
  doc.roundedRect(pageMargin, y, usableWidth, 22, 2, 2, 'F');

  doc.setTextColor(corPrimariaRgb[0], corPrimariaRgb[1], corPrimariaRgb[2]);
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  doc.text('DADOS DO CLIENTE & VEÍCULO', pageMargin + 4, y + 6);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.text(`Cliente: ${data.clienteNome} ${data.clienteTelefone ? `(${data.clienteTelefone})` : ''}`, pageMargin + 4, y + 12);
  doc.text(`Veículo: ${data.veiculoModelo || 'Veículo não especificado'} ${data.veiculoPlaca ? `| Placa: ${data.veiculoPlaca.toUpperCase()}` : ''}`, pageMargin + 4, y + 17);

  if (data.categoriaNome) {
    doc.text(`Categoria: ${data.categoriaNome}`, rightMarginX - 4, y + 12, { align: 'right' });
  }

  if (data.data_validade_limite) {
    doc.setTextColor(251, 191, 36);
    doc.setFont('helvetica', 'bold');
    doc.text(`Validade da Proposta: até ${formatarData(data.data_validade_limite)}`, rightMarginX - 4, y + 17, { align: 'right' });
  }

  y += 28;

  // 3. Apresentação dos Pacotes/Níveis de Orçamento
  onProgress?.('Renderizando opções de serviços...');

  doc.setTextColor(corPrimariaRgb[0], corPrimariaRgb[1], corPrimariaRgb[2]);
  doc.setFontSize(10.5);
  doc.setFont('helvetica', 'bold');
  doc.text('OPÇÕES E NÍVEIS DE SERVIÇOS', pageMargin, y);
  y += 6;

  for (const niv of data.niveis) {
    const isAprovado = data.nivel_aprovado === niv.nivel;

    // Calcula altura necessária para o bloco deste nível
    const numItens = niv.itens ? niv.itens.length : 0;
    const blockHeight = Math.max(28 + numItens * 5, 32);

    if (y + blockHeight > 275) {
      doc.addPage();
      y = 15;
    }

    // Fundo do card
    if (isAprovado) {
      doc.setFillColor(16, 185, 129); // emerald-500 sutil
      doc.roundedRect(pageMargin, y, usableWidth, blockHeight, 2, 2, 'F');
      doc.setFillColor(24, 24, 27); // graphite-950
      doc.roundedRect(pageMargin + 1, y + 1, usableWidth - 2, blockHeight - 2, 1.5, 1.5, 'F');
    } else {
      doc.setFillColor(39, 39, 42); // graphite-800
      doc.roundedRect(pageMargin, y, usableWidth, blockHeight, 2, 2, 'F');
    }

    // Cabeçalho do Nível
    let headY = y + 6;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    if (isAprovado) {
      doc.setTextColor(52, 211, 153); // emerald-400
      doc.text(`[APROVADO] ${niv.titulo.toUpperCase()}`, pageMargin + 4, headY);
    } else {
      doc.setTextColor(255, 255, 255);
      doc.text(niv.titulo.toUpperCase(), pageMargin + 4, headY);
    }

    // Preço e Tempo no canto direito
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(251, 191, 36);
    doc.text(formatarMoeda(niv.valor_total), rightMarginX - 4, headY, { align: 'right' });

    headY += 4;
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(161, 161, 170);
    doc.text(`Duração estimada: ~${niv.duracao_total} minutos`, rightMarginX - 4, headY, { align: 'right' });

    if (niv.descricao) {
      doc.setTextColor(200, 200, 200);
      doc.setFont('helvetica', 'italic');
      doc.text(niv.descricao, pageMargin + 4, headY);
    }

    headY += 6;

    // Divisor fino
    doc.setDrawColor(63, 63, 70);
    doc.line(pageMargin + 4, headY, rightMarginX - 4, headY);
    headY += 4;

    // Lista de Itens do Pacote
    doc.setFontSize(8);
    if (!niv.itens || niv.itens.length === 0) {
      doc.setTextColor(161, 161, 170);
      doc.setFont('helvetica', 'italic');
      doc.text('Nenhum item vinculado a esta opção.', pageMargin + 6, headY);
    } else {
      for (const item of niv.itens) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(255, 255, 255);

        const titleText = `• ${item.servico_nome}`;
        const titleWidth = doc.getTextWidth(titleText);
        doc.text(titleText, pageMargin + 6, headY);

        if (item.servico_descricao) {
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(161, 161, 170);

          const descStartX = pageMargin + 6 + titleWidth + 2.5;
          const maxDescWidth = rightMarginX - 6 - descStartX;

          if (maxDescWidth > 15) {
            const descStr = item.servico_descricao.trim();
            const splitDesc = doc.splitTextToSize(descStr, maxDescWidth);
            doc.text(splitDesc[0], descStartX, headY);
          }
        }

        headY += 4.5;
      }
    }

    y += blockHeight + 5;
  }

  // 4. Seção de Desconto (se houver)
  if (data.desconto && data.desconto.valor > 0) {
    if (y + 16 > 275) {
      doc.addPage();
      y = 15;
    }

    doc.setFillColor(245, 158, 11);
    doc.roundedRect(pageMargin, y, usableWidth, 12, 1.5, 1.5, 'F');
    doc.setTextColor(24, 24, 27);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    
    const descTxt = data.desconto.tipo === 'porcentagem'
      ? `${data.desconto.valor}% OFF`
      : formatarMoeda(data.desconto.valor);
    
    const cupomTxt = data.desconto.cupom_codigo ? ` (CUPOM: ${data.desconto.cupom_codigo})` : '';
    doc.text(`DESCONTO ESPECIAL APLICADO NO ORÇAMENTO: ${descTxt}${cupomTxt}`, pageMargin + 4, y + 7.5);

    y += 16;
  }

  // 5. Observações Gerais
  const temObsBudget = data.observacoes && data.observacoes.trim();
  const temObsBranding = data.pdfTextoObservacoesOrcamento && data.pdfTextoObservacoesOrcamento.trim();

  let obsTextoGlobal = '';
  if (temObsBudget && temObsBranding) {
    if (temObsBudget === temObsBranding) {
      obsTextoGlobal = temObsBudget;
    } else {
      obsTextoGlobal = `${temObsBudget}\n\nTermos e Condições Gerais:\n${temObsBranding}`;
    }
  } else if (temObsBudget) {
    obsTextoGlobal = temObsBudget;
  } else if (temObsBranding) {
    obsTextoGlobal = temObsBranding;
  }

  if (obsTextoGlobal) {
    const splitObs = doc.splitTextToSize(obsTextoGlobal, usableWidth - 8);
    const boxHeight = Math.max(18, 10 + splitObs.length * 4);

    if (y + boxHeight > 275) {
      doc.addPage();
      y = 15;
    }

    doc.setFillColor(39, 39, 42);
    doc.roundedRect(pageMargin, y, usableWidth, boxHeight, 1.5, 1.5, 'F');

    doc.setTextColor(251, 191, 36);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.text('OBSERVAÇÕES E CONDIÇÕES:', pageMargin + 4, y + 5);

    doc.setTextColor(220, 220, 220);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');

    splitObs.forEach((line: string, idx: number) => {
      doc.text(line, pageMargin + 4, y + 9 + idx * 3.5);
    });

    y += boxHeight + 4;
  }

  // 6. Assinatura Digital do Cliente (Se Aprovado e Assinado)
  if (data.assinaturaUrl) {
    onProgress?.('Iniciando renderização da assinatura do cliente...');
    if (y + 35 > 275) {
      doc.addPage();
      y = 15;
    }

    doc.setFillColor(39, 39, 42);
    doc.roundedRect(pageMargin, y, usableWidth, 32, 2, 2, 'F');

    doc.setTextColor(251, 191, 36);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('ACEITE DIGITAL E CONFIRMAÇÃO LEGAL DO CLIENTE', pageMargin + 4, y + 6);

    doc.setTextColor(200, 200, 200);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'italic');
    const termoAceite = '"Declaro que li e concordo com as condições, prazos e valores apresentados nesta proposta de orçamento."';
    const termoLines = doc.splitTextToSize(termoAceite, usableWidth - 60);
    termoLines.forEach((line: string, idx: number) => {
      doc.text(line, pageMargin + 4, y + 11 + idx * 3.5);
    });

    try {
      const assBase64 = await obterAssinaturaBase64(data.assinaturaUrl);
      if (assBase64) {
        const sigW = 48;
        const sigH = 18;
        const sigX = rightMarginX - 52;
        const sigY = y + 2;

        doc.setFillColor(255, 255, 255);
        doc.roundedRect(sigX, sigY, sigW, sigH, 1, 1, 'F');

        await drawProportionalImage(doc, assBase64, 'PNG', sigX, sigY, sigW, sigH);
      }
    } catch (e) {
      console.error('[PDFOrcamento] Erro ao renderizar imagem de assinatura:', e);
    }

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.text(`Assinado por: ${data.assinaturaNome || data.clienteNome}`, pageMargin + 4, y + 22);

    if (data.assinaturaData) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.text(`Confirmado em: ${formatarData(data.assinaturaData)} ${formatarHora(data.assinaturaData)}`, pageMargin + 4, y + 27);
    }

    y += 36;
  }

  onProgress?.('Finalizando PDF do orçamento...');
  const nomeArquivo = `orcamento_${data.veiculoPlaca ? data.veiculoPlaca.toUpperCase() : 'proposta'}_${codProposta.replace('#', '')}.pdf`;
  doc.save(nomeArquivo);
}
