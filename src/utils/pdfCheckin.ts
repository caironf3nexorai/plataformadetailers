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
import { cabecalhoDocumento, hexToRgb } from './pdf';

interface PDFCheckinData {
  checkin: Checkin;
  avarias: CheckinAvaria[];
  fotos: CheckinFoto[];
  clienteNome: string;
  clienteTelefone: string;
  veiculoModelo: string;
  veiculoPlaca: string;
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
  pdfSubtituloCabecalho?: string | null;
  pdfTextoObservacoesOrcamento?: string | null;
  pdfTextoRodape?: string | null;
  pdfOcultarMarcaDagua?: boolean | null;
}

/**
 * Converte um elemento SVGSVGElement em PNG Base64 através de HTML5 Canvas.
 */
async function svgToPngBase64(svgElement: SVGSVGElement): Promise<string> {
  return new Promise((resolve) => {
    try {
      const xml = new XMLSerializer().serializeToString(svgElement);
      const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();

      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width || 600;
        canvas.height = img.height || 400;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          resolve('');
          return;
        }

        ctx.fillStyle = '#18181b'; // Fundo escuro (graphite-900) para contraste
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);

        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/png'));
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve('');
      };

      img.src = url;
    } catch (err) {
      console.error('[SVG to PNG error]:', err);
      resolve('');
    }
  });
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
  onProgress?: (statusText: string) => void
): Promise<void> {
  if (!data.checkin.assinatura_path) {
    throw new Error('Vistoria de entrada não assinada pelo cliente. Não é possível gerar o documento sem assinatura.');
  }

  const {
    checkin,
    avarias,
    fotos,
    clienteNome,
    clienteTelefone,
    veiculoModelo,
    veiculoPlaca,
    oficinaNome,
    oficinaTelefone,
    oficinaCidadeUF,
    oficinaLogoUrl,
    oficinaDocumento,
    oficinaDocumentoTipo,
    oficinaRazaoSocial,
    svgElements,
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
    pdfSubtituloCabecalho: data.pdfSubtituloCabecalho,
    pdfTextoObservacoesOrcamento: data.pdfTextoObservacoesOrcamento,
    pdfTextoRodape: data.pdfTextoRodape,
    pdfOcultarMarcaDagua: data.pdfOcultarMarcaDagua,
  });

  const isFree = data.planoCodigo === 'free';
  const corFundoSecoesRgb = isFree ? [39, 39, 42] as [number, number, number] : hexToRgb(data.pdfCorFundoSecoes, [39, 39, 42]);
  const corPrimariaRgb = isFree ? [251, 191, 36] as [number, number, number] : hexToRgb(data.pdfCorPrimaria, [245, 158, 11]);

  // 2. Dados do Cliente e Veículo
  doc.setFillColor(corFundoSecoesRgb[0], corFundoSecoesRgb[1], corFundoSecoesRgb[2]);
  doc.roundedRect(pageMargin, y, usableWidth, 22, 2, 2, 'F');

  doc.setTextColor(corPrimariaRgb[0], corPrimariaRgb[1], corPrimariaRgb[2]);
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  doc.text('CLIENTE & VEÍCULO', pageMargin + 4, y + 6);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.text(`Cliente: ${clienteNome} (${clienteTelefone || '—'})`, pageMargin + 4, y + 12);
  doc.text(`Veículo: ${veiculoModelo} | Placa: ${veiculoPlaca.toUpperCase()}`, pageMargin + 4, y + 17);

  doc.text(`KM: ${checkin.km ? checkin.km.toLocaleString('pt-BR') : '—'}`, rightMarginX - 4, y + 12, { align: 'right' });
  doc.text(`Combustível: ${formatarNivelCombustivel(checkin.nivel_combustivel)}`, rightMarginX - 4, y + 17, { align: 'right' });

  y += 28;

  // Helper de formatar rótulos para o PDF
  const formatarLabelItem = (key: string): string => {
    const map: Record<string, string> = {
      farol_baixo: 'Farol baixo',
      farol_alto: 'Farol alto',
      meia_luz: 'Meia luz',
      pisca_dianteiro: 'Pisca dianteiro',
      pisca_traseiro: 'Pisca traseiro',
      lanterna_freio: 'Lanterna freio',
      luz_re: 'Luz de ré',
      luz_placa: 'Luz de placa',
      luz_cabine: 'Luz de cabine',
      oleo_motor: 'Óleo motor',
      fluido_freio: 'Fluido freio',
      arrefecimento: 'Arrefecimento',
      direcao_hidraulica: 'Direção hidráulica',
      parabrisa: 'Água parabrisa',
      painel: 'Painel',
      bancos: 'Bancos',
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
    if (val === 'ruim') return 'RUIM';
    if (val === 'limpo') return 'LIMPO';
    if (val === 'sujo') return 'SUJO';
    if (val === 'extremo') return 'EXTREMO';
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

  // Quebra dinâmica das Luzes do Painel e Observações
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  const luzesTextoCompleto = checkin.luzes_painel && checkin.luzes_painel.length > 0
    ? checkin.luzes_painel.join(', ')
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
  doc.setFillColor(39, 39, 42); // graphite-800
  doc.roundedRect(pageMargin, y, usableWidth, boxHeight, 2, 2, 'F');

  let curY1 = y + 5;
  let curY2 = y + 5;

  // --- COLUNA 1: ILUMINAÇÃO E FLUIDOS ---
  doc.setTextColor(251, 191, 36);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('ILUMINAÇÃO', col1X, curY1);
  curY1 += 4;

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  if (ilumEntries.length === 0) {
    doc.setTextColor(180, 180, 180);
    doc.text('Sem itens testados', col1X, curY1);
    curY1 += 4;
  } else {
    ilumEntries.forEach((it) => {
      doc.setTextColor(220, 220, 220);
      doc.text(`${it.label}: `, col1X, curY1);
      const lWidth = doc.getTextWidth(`${it.label}: `);
      if (it.raw === 'queimado') doc.setTextColor(248, 113, 113);
      else doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.text(it.val, col1X + lWidth, curY1);
      doc.setFont('helvetica', 'normal');
      curY1 += 3.8;
    });
  }

  curY1 += 2;
  doc.setTextColor(251, 191, 36);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('FLUIDOS E NÍVEIS', col1X, curY1);
  curY1 += 4;

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  if (fluidoEntries.length === 0) {
    doc.setTextColor(180, 180, 180);
    doc.text('Sem fluidos verificados', col1X, curY1);
    curY1 += 4;
  } else {
    fluidoEntries.forEach((it) => {
      doc.setTextColor(220, 220, 220);
      doc.text(`${it.label}: `, col1X, curY1);
      const lWidth = doc.getTextWidth(`${it.label}: `);
      if (it.raw === 'baixo' || it.raw === 'ruim') doc.setTextColor(248, 113, 113);
      else doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.text(it.val, col1X + lWidth, curY1);
      doc.setFont('helvetica', 'normal');
      curY1 += 3.8;
    });
  }

  // --- COLUNA 2: SUJIDADE & PAINEL/ESTEPE ---
  doc.setTextColor(251, 191, 36);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('NÍVEIS DE SUJIDADE', col2X, curY2);
  curY2 += 4;

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  if (sujEntries.length === 0) {
    doc.setTextColor(180, 180, 180);
    doc.text('Não informado', col2X, curY2);
    curY2 += 4;
  } else {
    sujEntries.forEach((it) => {
      doc.setTextColor(220, 220, 220);
      doc.text(`${it.label}: `, col2X, curY2);
      const lWidth = doc.getTextWidth(`${it.label}: `);
      if (it.raw === 'sujo' || it.raw === 'extremo') doc.setTextColor(251, 191, 36);
      else doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.text(it.val, col2X + lWidth, curY2);
      doc.setFont('helvetica', 'normal');
      curY2 += 3.8;
    });
  }

  curY2 += 2;
  doc.setTextColor(251, 191, 36);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('PAINEL & ESTEPE', col2X, curY2);
  curY2 += 4;

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(220, 220, 220);
  doc.text('Estepe: ', col2X, curY2);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.text(estepeTxt, col2X + doc.getTextWidth('Estepe: '), curY2);
  doc.setFont('helvetica', 'normal');
  curY2 += 4;

  // Rótulo explícito para condição de entrada
  doc.setTextColor(220, 220, 220);
  doc.text('Luzes acesas no painel na entrada:', col2X, curY2);
  curY2 += 4;

  doc.setFont('helvetica', 'bold');
  if (checkin.luzes_painel && checkin.luzes_painel.length > 0) {
    doc.setTextColor(248, 113, 113); // Vermelho/flare
  } else {
    doc.setTextColor(180, 180, 180); // Neutro
  }

  luzesLines.forEach((line) => {
    doc.text(line, col2X + 2, curY2);
    curY2 += 3.8;
  });

  if (obsLines.length > 0) {
    curY2 += 1;
    doc.setTextColor(220, 220, 220);
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

  if (vistasComAvarias.length > 0 && svgElements) {
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
      const svgEl = svgElements[item.key];
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

      if (svgEl) {
        const pngBase64 = await svgToPngBase64(svgEl);
        if (pngBase64) {
          doc.addImage(pngBase64, 'PNG', diagX, y, diagW, diagH);
        }
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

            // Carimbo de data/hora e descrição abaixo de cada foto
            doc.setFontSize(7);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(200, 200, 200);
            const descTxt = foto.descricao ? ` - ${foto.descricao}` : '';
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
  const termoLines = doc.splitTextToSize(termoTxt, usableWidth - 60);
  termoLines.forEach((line: string, idx: number) => {
    doc.text(line, pageMargin + 4, y + 6 + idx * 3.5);
  });

  if (checkin.assinatura_path) {
    onProgress?.('Carregando assinatura digital do cliente...');
    try {
      const assBase64 = await obterAssinaturaBase64(checkin.assinatura_path);
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
  }

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text(`Assinado por: ${checkin.assinatura_nome || clienteNome}`, pageMargin + 4, y + 22);

  if (checkin.assinado_em) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(`Assinado em: ${formatarData(checkin.assinado_em)} ${formatarHora(checkin.assinado_em)}`, pageMargin + 4, y + 27);
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

  onProgress?.('Finalizando PDF...');
  doc.save(`vistoria_${veiculoPlaca.toUpperCase()}_${checkin.id.substring(0, 6)}.pdf`);
}
