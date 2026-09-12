import jsPDF from 'jspdf';
import { formatarData } from './datas';

export interface DadosAdesivoPDF {
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
  tema?: 'branco' | 'escuro';
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
 * Gera e faz o download direto do PDF do Adesivo de Para-brisa
 * Tamanho: 100mm x 70mm (perfeito para adesivo eletrostático, vinil ou cartão)
 */
export async function baixarPdfAdesivo(dados: DadosAdesivoPDF): Promise<void> {
  const isDark = dados.tema !== 'branco';
  const { certificado, oficina, veiculo } = dados;

  // 100mm de largura por 70mm de altura (paisagem)
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [70, 100],
  });

  // Fundo
  if (isDark) {
    doc.setFillColor(15, 23, 42); // slate-900
    doc.rect(0, 0, 100, 70, 'F');
  } else {
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, 100, 70, 'F');
  }

  // Borda decorativa dourada com cantos arredondados
  doc.setDrawColor(245, 158, 11); // amber-500
  doc.setLineWidth(0.7);
  doc.roundedRect(3.5, 3.5, 93, 63, 2.5, 2.5, 'S');

  // Cabeçalho da Oficina
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(isDark ? 255 : 15, isDark ? 255 : 23, isDark ? 255 : 42);
  const nomeOficinaCortado = oficina.nome.length > 26 ? oficina.nome.slice(0, 24) + '...' : oficina.nome;
  doc.text(nomeOficinaCortado.toUpperCase(), 7, 8.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.setTextColor(217, 119, 6); // amber-600
  doc.text('GARANTIA CERTIFICADA', 7, 11.5);

  // Badge do Código do Certificado
  if (isDark) {
    doc.setFillColor(30, 41, 59); // slate-800
    doc.setDrawColor(245, 158, 11);
    doc.setTextColor(252, 211, 77); // amber-300
  } else {
    doc.setFillColor(254, 243, 199); // amber-100
    doc.setDrawColor(252, 211, 77);
    doc.setTextColor(180, 83, 9); // amber-700
  }
  doc.setLineWidth(0.3);
  doc.roundedRect(68, 5, 25, 6, 1.2, 1.2, 'FD');
  doc.setFont('courier', 'bold');
  doc.setFontSize(7.5);
  doc.text(certificado.codigo, 80.5, 9.2, { align: 'center' });

  // Linha separadora do cabeçalho
  doc.setDrawColor(isDark ? 51 : 226, isDark ? 65 : 232, isDark ? 85 : 240);
  doc.setLineWidth(0.3);
  doc.line(7, 14, 93, 14);

  // Coluna Esquerda: Veículo & Placa
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5);
  doc.setTextColor(isDark ? 148 : 100, isDark ? 163 : 116, isDark ? 184 : 139);
  doc.text('VEÍCULO & PLACA', 7, 17.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(isDark ? 255 : 15, isDark ? 255 : 23, isDark ? 255 : 42);
  const modeloCortado = veiculo.modelo.length > 20 ? veiculo.modelo.slice(0, 18) + '...' : veiculo.modelo;
  doc.text(modeloCortado, 7, 21);

  // Badge da Placa
  if (isDark) {
    doc.setFillColor(30, 41, 59);
    doc.setDrawColor(71, 85, 105);
    doc.setTextColor(252, 211, 77);
  } else {
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(203, 213, 225);
    doc.setTextColor(15, 23, 42);
  }
  doc.setLineWidth(0.25);
  doc.roundedRect(7, 22.5, 20, 4.5, 1, 1, 'FD');
  doc.setFont('courier', 'bold');
  doc.setFontSize(7);
  doc.text(veiculo.placa, 17, 25.8, { align: 'center' });

  // Proteção Aplicada
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5);
  doc.setTextColor(isDark ? 148 : 100, isDark ? 163 : 116, isDark ? 184 : 139);
  doc.text('PROTEÇÃO APLICADA', 7, 30.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(isDark ? 255 : 15, isDark ? 255 : 23, isDark ? 255 : 42);
  const servicoCortado = certificado.servico_nome.length > 24 ? certificado.servico_nome.slice(0, 22) + '...' : certificado.servico_nome;
  doc.text(servicoCortado, 7, 34);

  if (certificado.produto_aplicado) {
    doc.setFont('courier', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(217, 119, 6);
    const prodCortado = certificado.produto_aplicado.length > 24 ? certificado.produto_aplicado.slice(0, 22) + '...' : certificado.produto_aplicado;
    doc.text(prodCortado, 7, 37.5);
  }

  // Box de Datas (Aplicação & Validade)
  const boxTop = certificado.produto_aplicado ? 39.5 : 36.5;
  if (isDark) {
    doc.setFillColor(30, 41, 59);
    doc.setDrawColor(51, 65, 85);
  } else {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
  }
  doc.setLineWidth(0.25);
  doc.roundedRect(7, boxTop, 50, 9.5, 1.2, 1.2, 'FD');

  // Aplicação
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(4.5);
  doc.setTextColor(isDark ? 148 : 100, isDark ? 163 : 116, isDark ? 184 : 139);
  doc.text('APLICAÇÃO', 9, boxTop + 3.5);

  doc.setFont('courier', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(isDark ? 203 : 51, isDark ? 213 : 65, isDark ? 225 : 85);
  doc.text(formatarData(certificado.data_aplicacao), 9, boxTop + 7.5);

  // Validade
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(4.5);
  doc.setTextColor(5, 150, 105); // emerald-600
  doc.text('VALIDADE', 34, boxTop + 3.5);

  doc.setFont('courier', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(5, 150, 105);
  doc.text(formatarData(certificado.data_vencimento), 34, boxTop + 7.5);

  // Próxima Revisão
  if (certificado.proxima_revisao_data) {
    const revTop = boxTop + 11;
    if (isDark) {
      doc.setFillColor(40, 30, 15);
      doc.setDrawColor(245, 158, 11);
      doc.setTextColor(252, 211, 77);
    } else {
      doc.setFillColor(254, 243, 199);
      doc.setDrawColor(245, 158, 11);
      doc.setTextColor(180, 83, 9);
    }
    doc.setLineWidth(0.25);
    doc.roundedRect(7, revTop, 50, 5, 1, 1, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.5);
    doc.text(`Próxima Revisão: ${formatarData(certificado.proxima_revisao_data)}`, 9, revTop + 3.4);
  }

  // Coluna Direita: Box do QR Code
  const qrBoxX = 61;
  const qrBoxY = 17;
  const qrBoxW = 32;
  const qrBoxH = 43;

  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(isDark ? 245 : 203, isDark ? 158 : 213, isDark ? 11 : 225);
  doc.setLineWidth(0.4);
  doc.roundedRect(qrBoxX, qrBoxY, qrBoxW, qrBoxH, 2, 2, 'FD');

  // Adiciona a imagem do QR Code
  const urlCertificado = `${window.location.origin}/garantia/${certificado.codigo}`;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(urlCertificado)}&margin=4&format=png`;
  const qrBase64 = await urlParaBase64(qrCodeUrl);

  if (qrBase64) {
    doc.addImage(qrBase64, 'PNG', qrBoxX + 2.5, qrBoxY + 2.5, 27, 27);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5);
  doc.setTextColor(15, 23, 42);
  doc.text('ESCANEAR PARA AUTENTICAR', qrBoxX + 16, qrBoxY + 34, { align: 'center' });

  doc.setFont('courier', 'bold');
  doc.setFontSize(4.5);
  doc.setTextColor(217, 119, 6);
  doc.text('nuvemwash.com', qrBoxX + 16, qrBoxY + 38, { align: 'center' });

  // Rodapé do Selo
  doc.setDrawColor(isDark ? 51 : 226, isDark ? 65 : 232, isDark ? 85 : 240);
  doc.setLineWidth(0.3);
  doc.line(7, 62.5, 93, 62.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4.5);
  doc.setTextColor(isDark ? 148 : 100, isDark ? 163 : 116, isDark ? 184 : 139);
  doc.text('Autenticação Oficial · NuvemWash', 7, 65.5);

  doc.setFont('courier', 'bold');
  doc.setFontSize(4.5);
  doc.setTextColor(217, 119, 6);
  doc.text('nuvemwash.com', 93, 65.5, { align: 'right' });

  // Dispara o download do PDF
  const nomeArquivo = `adesivo-garantia-${certificado.codigo.toLowerCase()}-${veiculo.placa.toLowerCase()}.pdf`;
  doc.save(nomeArquivo);
}
