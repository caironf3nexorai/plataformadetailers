import jsPDF from 'jspdf';
import { getFotoPublicUrl } from './imagens';
import type { PlacaBalcaoConfig } from '../types/auth';

export interface DadosPlacaBalcaoPDF {
  oficina: {
    nome: string;
    slug: string;
    logo_path?: string | null;
    telefone?: string | null;
    cidade?: string | null;
    estado?: string | null;
  };
  tema?: 'escuro' | 'branco';
  formato?: 'A4' | 'A5';
  config?: PlacaBalcaoConfig | null;
}

/**
 * Converte cor HEX para tupla RGB [r, g, b]
 */
function hexParaRgb(hex: string): [number, number, number] {
  let c = (hex || '#f59e0b').replace('#', '').trim();
  if (c.length === 3) {
    c = c.split('').map((char) => char + char).join('');
  }
  const num = parseInt(c, 16);
  if (isNaN(num) || c.length !== 6) {
    return [245, 158, 11]; // Fallback amber-500
  }
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/**
 * Verifica se uma cor HEX é escura usando a fórmula de luminosidade perceptiva (YIQ)
 */
function isCorEscura(hex: string): boolean {
  const [r, g, b] = hexParaRgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 < 145;
}

/**
 * Converte uma URL de imagem externa para Data URL Base64 para inclusão no jsPDF
 */
async function urlParaBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Gera e faz o download direto do PDF da Placa de Balcão (Display de Mesa)
 * Formatos: A4 (210x297mm) ou A5 (148x210mm)
 * Suporte a personalização de cores, fundos, tipografia e White-label para planos Pro e Studio
 */
export async function baixarPdfPlacaBalcao(dados: DadosPlacaBalcaoPDF): Promise<void> {
  const { oficina, tema = 'escuro', formato = 'A4', config } = dados;
  const isA5 = formato === 'A5';

  // Cor de fundo personalizada com fallback para o tema
  const corFundoHex = config?.corFundo || (tema === 'escuro' ? '#0b0f19' : '#ffffff');
  const fundoRgb = hexParaRgb(corFundoHex);
  const isDark = isCorEscura(corFundoHex);

  // Cor de destaque personalizada (padrão dourado amber-500)
  const corDestaqueHex = config?.corDestaque || '#f59e0b';
  const destaqueRgb = hexParaRgb(corDestaqueHex);

  // Mapeamento de tipografia
  const fontPrincipal = config?.estiloFonte === 'luxo' ? 'times' : 'helvetica';

  // Dimensões em mm
  const largura = isA5 ? 148 : 210;
  const altura = isA5 ? 210 : 297;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [largura, altura],
  });

  // Fundo com a cor personalizada
  doc.setFillColor(fundoRgb[0], fundoRgb[1], fundoRgb[2]);
  doc.rect(0, 0, largura, altura, 'F');

  // Borda decorativa externa com cantos arredondados na cor de destaque
  const margemBorda = isA5 ? 6 : 8;
  doc.setDrawColor(destaqueRgb[0], destaqueRgb[1], destaqueRgb[2]);
  doc.setLineWidth(isA5 ? 0.8 : 1.2);
  doc.roundedRect(
    margemBorda,
    margemBorda,
    largura - margemBorda * 2,
    altura - margemBorda * 2,
    isA5 ? 4 : 6,
    isA5 ? 4 : 6,
    'S'
  );

  // Segunda borda interna sutil
  doc.setDrawColor(isDark ? 40 : 230, isDark ? 50 : 235, isDark ? 65 : 240);
  doc.setLineWidth(0.3);
  const margemInterna = margemBorda + (isA5 ? 2 : 2.5);
  doc.roundedRect(
    margemInterna,
    margemInterna,
    largura - margemInterna * 2,
    altura - margemInterna * 2,
    isA5 ? 3 : 4.5,
    isA5 ? 3 : 4.5,
    'S'
  );

  let curY = isA5 ? 18 : 26;

  // Logotipo da Oficina (se houver)
  const logoUrl = oficina.logo_path ? getFotoPublicUrl(oficina.logo_path) : null;
  if (logoUrl) {
    const logoBase64 = await urlParaBase64(logoUrl);
    if (logoBase64) {
      const logoTam = isA5 ? 24 : 32;
      const logoX = (largura - logoTam) / 2;

      // Fundo arredondado para a logo
      doc.setFillColor(isDark ? 15 : 255, isDark ? 23 : 255, isDark ? 42 : 255);
      doc.setDrawColor(isDark ? 71 : 203, isDark ? 85 : 213, isDark ? 105 : 225);
      doc.setLineWidth(0.4);
      doc.roundedRect(logoX - 1.5, curY - 1.5, logoTam + 3, logoTam + 3, 2, 2, 'FD');

      doc.addImage(logoBase64, 'PNG', logoX, curY, logoTam, logoTam);
      curY += logoTam + (isA5 ? 5 : 8);
    }
  }

  // Nome da Oficina
  doc.setFont(fontPrincipal, 'bold');
  doc.setFontSize(isA5 ? 15 : 20);
  doc.setTextColor(isDark ? 255 : 15, isDark ? 255 : 23, isDark ? 255 : 42);
  doc.text(oficina.nome.toUpperCase(), largura / 2, curY, { align: 'center' });

  curY += isA5 ? 5 : 7;

  // Subtítulo / Slogan da Oficina
  const sloganTexto = (config?.sloganOficina || 'ESTÉTICA AUTOMOTIVA & CUIDADOS ESPECIAIS').toUpperCase();
  doc.setFont(fontPrincipal, 'bold');
  doc.setFontSize(isA5 ? 7.5 : 10);
  doc.setTextColor(destaqueRgb[0], destaqueRgb[1], destaqueRgb[2]);
  doc.text(sloganTexto, largura / 2, curY, { align: 'center' });

  curY += isA5 ? 6 : 9;

  // Linha divisória
  doc.setDrawColor(isDark ? 51 : 226, isDark ? 65 : 232, isDark ? 85 : 240);
  doc.setLineWidth(0.4);
  const linhaW = isA5 ? 70 : 100;
  doc.line((largura - linhaW) / 2, curY, (largura + linhaW) / 2, curY);

  curY += isA5 ? 8 : 12;

  // Chamada de Ação Principal
  const chamadaTexto = (config?.chamadaPrincipal || 'CONHEÇA NOSSOS SERVIÇOS & AGENDE ONLINE').toUpperCase();
  doc.setFont(fontPrincipal, 'bold');
  doc.setFontSize(isA5 ? 11 : 14.5);
  doc.setTextColor(isDark ? 255 : 15, isDark ? 255 : 23, isDark ? 255 : 42);
  doc.text(chamadaTexto, largura / 2, curY, { align: 'center' });

  curY += isA5 ? 4.5 : 6;

  // Instrução do QR Code
  const instrucaoTexto = config?.instrucaoQr || 'Aponte a câmera do seu celular para o QR Code abaixo:';
  doc.setFont(fontPrincipal, 'normal');
  doc.setFontSize(isA5 ? 8 : 10.5);
  doc.setTextColor(isDark ? 148 : 100, isDark ? 163 : 116, isDark ? 184 : 139);
  doc.text(instrucaoTexto, largura / 2, curY, { align: 'center' });

  curY += isA5 ? 6 : 8;

  // Container do QR Code (Box arredondado com borda na cor de destaque)
  const qrBoxTam = isA5 ? 58 : 78;
  const qrImgTam = isA5 ? 50 : 68;
  const qrBoxX = (largura - qrBoxTam) / 2;

  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(destaqueRgb[0], destaqueRgb[1], destaqueRgb[2]);
  doc.setLineWidth(0.8);
  doc.roundedRect(qrBoxX, curY, qrBoxTam, qrBoxTam, 4, 4, 'FD');

  // Adiciona a imagem do QR Code
  const vitrineUrl = `${window.location.origin}/agendar/${oficina.slug}`;
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(vitrineUrl)}&margin=6&format=png`;
  const qrBase64 = await urlParaBase64(qrApiUrl);

  if (qrBase64) {
    const qrOffset = (qrBoxTam - qrImgTam) / 2;
    doc.addImage(qrBase64, 'PNG', qrBoxX + qrOffset, curY + qrOffset, qrImgTam, qrImgTam);
  }

  curY += qrBoxTam + (isA5 ? 7 : 10);

  // Link curto da vitrine
  doc.setFont('courier', 'bold');
  doc.setFontSize(isA5 ? 8.5 : 11);
  doc.setTextColor(destaqueRgb[0], destaqueRgb[1], destaqueRgb[2]);
  doc.text(vitrineUrl.replace(/^https?:\/\//, ''), largura / 2, curY, { align: 'center' });

  curY += isA5 ? 7 : 11;

  // 3 Destaques / Benefícios (Pills)
  const pillY = curY;
  const pillH = isA5 ? 12 : 16;
  const pillW = isA5 ? 40 : 54;
  const espacoPills = isA5 ? 4 : 6;
  const totalPillsW = pillW * 3 + espacoPills * 2;
  const startPillsX = (largura - totalPillsW) / 2;

  const itens = [
    {
      t1: (config?.pill1Titulo || 'AGENDAMENTO').toUpperCase(),
      t2: config?.pill1Subtexto || 'Rápido pelo Celular'
    },
    {
      t1: (config?.pill2Titulo || 'CATÁLOGO').toUpperCase(),
      t2: config?.pill2Subtexto || 'Preços & Fotos'
    },
    {
      t1: (config?.pill3Titulo || 'GARANTIA').toUpperCase(),
      t2: config?.pill3Subtexto || 'Certificado Digital'
    },
  ];

  itens.forEach((item, idx) => {
    const pX = startPillsX + idx * (pillW + espacoPills);

    doc.setFillColor(isDark ? 20 : 248, isDark ? 28 : 250, isDark ? 45 : 252);
    doc.setDrawColor(isDark ? 45 : 226, isDark ? 55 : 232, isDark ? 75 : 240);
    doc.setLineWidth(0.3);
    doc.roundedRect(pX, pillY, pillW, pillH, 2, 2, 'FD');

    doc.setFont(fontPrincipal, 'bold');
    doc.setFontSize(isA5 ? 6 : 7.5);
    doc.setTextColor(destaqueRgb[0], destaqueRgb[1], destaqueRgb[2]);
    doc.text(item.t1, pX + pillW / 2, pillY + (isA5 ? 4.5 : 6), { align: 'center' });

    doc.setFont(fontPrincipal, 'normal');
    doc.setFontSize(isA5 ? 5.5 : 6.8);
    doc.setTextColor(isDark ? 203 : 71, isDark ? 213 : 85, isDark ? 225 : 105);
    doc.text(item.t2, pX + pillW / 2, pillY + (isA5 ? 8.5 : 11.5), { align: 'center' });
  });

  // Rodapé Oficial
  const footerY = altura - (isA5 ? 11 : 14);
  doc.setDrawColor(isDark ? 40 : 226, isDark ? 50 : 232, isDark ? 65 : 240);
  doc.setLineWidth(0.3);
  doc.line(margemBorda + 4, footerY - 3, largura - margemBorda - 4, footerY - 3);

  doc.setFont(fontPrincipal, 'normal');
  doc.setFontSize(isA5 ? 6 : 7.5);
  doc.setTextColor(isDark ? 148 : 100, isDark ? 163 : 116, isDark ? 184 : 139);

  const localizacao = [oficina.cidade, oficina.estado].filter(Boolean).join(' - ');
  const defaultTextoEsq = [localizacao, oficina.telefone].filter(Boolean).join(' · ') || 'Atendimento Oficial';
  const textoEsq = config?.textoRodapeCustomizado?.trim() || defaultTextoEsq;
  doc.text(textoEsq, margemBorda + 6, footerY);

  // White-label: Se ocultarMarcaNuvemWash for false, imprime a indicação da plataforma
  if (!config?.ocultarMarcaNuvemWash) {
    doc.setFont(fontPrincipal, 'bold');
    doc.setTextColor(destaqueRgb[0], destaqueRgb[1], destaqueRgb[2]);
    doc.text('Plataforma NuvemWash', largura - margemBorda - 6, footerY, { align: 'right' });
  }

  // Download do arquivo
  doc.save(`placa-balcao-${oficina.slug}-${formato.toLowerCase()}.pdf`);
}
