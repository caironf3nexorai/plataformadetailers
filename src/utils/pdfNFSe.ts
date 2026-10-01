import jsPDF from 'jspdf';
import { formatarData, formatarHora } from './datas';
import { formatarMoeda } from './formatters';
import { rodapeDocumento } from './pdf';

export interface DadosNFSePDF {
  numero: string;
  serie?: string;
  codigoVerificacao?: string;
  dataEmissao: string | Date;
  status?: string;
  ambiente?: 'homologacao' | 'producao';
  prestador: {
    razaoSocial: string;
    nomeFantasia?: string;
    cnpj: string;
    inscricaoMunicipal?: string;
    telefone?: string;
    email?: string;
    cidade?: string;
    uf?: string;
  };
  tomador: {
    nome: string;
    cpfCnpj?: string;
    telefone?: string;
    email?: string;
    endereco?: string;
  };
  servico: {
    discriminacao: string;
    itemListaServico?: string;
    cnae?: string;
    valorTotal: number;
    aliquotaIss: number;
    valorIss?: number;
    issRetido?: boolean;
  };
  numeroOS?: number | string | null;
  formaPagamento?: string | null;
  statusPagamento?: string | null;
  planoCodigo?: string;
  pdfTextoRodape?: string | null;
  pdfOcultarMarcaDagua?: boolean | null;
}

/**
 * Gera o espelho oficial do DANFSe (Documento Auxiliar da Nota Fiscal de Serviço Eletrônica)
 * com layout formal de prefeitura, campos fiscais padronizados e suporte a Homologação e Produção.
 */
export async function gerarDanfsePDF(
  dados: DadosNFSePDF,
  acao: 'download' | 'print' = 'download'
): Promise<void> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 210mm
  const pageMargin = 12;
  const usableWidth = pageWidth - pageMargin * 2; // 186mm
  const rightMarginX = pageMargin + usableWidth;

  const isHomologacao = dados.ambiente !== 'producao';

  let y = pageMargin;

  // 1. CABEÇALHO DO DOCUMENTO FISCAL
  doc.setDrawColor(30, 41, 59); // slate-800
  doc.setLineWidth(0.4);
  doc.setFillColor(248, 250, 252); // slate-50
  doc.roundedRect(pageMargin, y, usableWidth, 24, 1.5, 1.5, 'FD');

  // Coluna 1: Título Oficial
  doc.setTextColor(15, 23, 42); // slate-900
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  const cidadeUf = dados.prestador.cidade
    ? `MUNICÍPIO DE ${dados.prestador.cidade.toUpperCase()}${dados.prestador.uf ? ` - ${dados.prestador.uf.toUpperCase()}` : ''}`
    : 'SECRETARIA MUNICIPAL DA FAZENDA';
  doc.text(cidadeUf, pageMargin + 4, y + 6);

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(51, 65, 85);
  doc.text('NOTA FISCAL DE SERVIÇOS ELETRÔNICA — NFS-e', pageMargin + 4, y + 11);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('RPS (Recibo Provisório de Serviços) emitido pelo sistema', pageMargin + 4, y + 16);
  if (dados.numeroOS) {
    doc.text(`Vinculado à Ordem de Serviço #${dados.numeroOS}`, pageMargin + 4, y + 20);
  }

  // Coluna 2: Informações da Nota (Lado Direito)
  const boxDirW = 65;
  const boxDirX = rightMarginX - boxDirW;
  doc.line(boxDirX - 2, y, boxDirX - 2, y + 24);

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(`NÚMERO DA NOTA:`, boxDirX + 2, y + 6);
  doc.setTextColor(180, 83, 9); // Amber-700
  doc.setFontSize(9);
  doc.text(`${dados.numero}`, boxDirX + 38, y + 6);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(51, 65, 85);
  doc.text(`Série RPS: ${dados.serie || '1'}`, boxDirX + 2, y + 11);
  const dataFormatada = formatarData(dados.dataEmissao);
  const horaFormatada = formatarHora(dados.dataEmissao);
  doc.text(`Emissão: ${dataFormatada} às ${horaFormatada}`, boxDirX + 2, y + 15);

  const codVerif = dados.codigoVerificacao || `${dados.numero.padStart(6, '0')}-HOMOLOG-${new Date().getFullYear()}`;
  doc.text(`Cód. Verificação: ${codVerif}`, boxDirX + 2, y + 19);

  y += 27;

  // MARCA D'ÁGUA DE HOMOLOGAÇÃO
  if (isHomologacao) {
    doc.setFillColor(254, 243, 199); // amber-100
    doc.setDrawColor(245, 158, 11); // amber-500
    doc.setLineWidth(0.3);
    doc.roundedRect(pageMargin, y, usableWidth, 7, 1, 1, 'FD');

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(180, 83, 9);
    doc.text(
      '[ AMBIENTE DE HOMOLOGAÇÃO E TESTES — DOCUMENTO SEM VALIDADE FISCAL ]',
      pageMargin + usableWidth / 2,
      y + 4.8,
      { align: 'center' }
    );
    y += 9.5;
  }

  // 2. PRESTADOR DE SERVIÇOS
  doc.setFillColor(241, 245, 249); // slate-100
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.25);
  doc.roundedRect(pageMargin, y, usableWidth, 23, 1.5, 1.5, 'FD');

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text('DADOS DO PRESTADOR DE SERVIÇOS', pageMargin + 4, y + 5);

  const formatarDoc = (doc?: string | null) => {
    if (!doc) return '—';
    const d = doc.replace(/\D/g, '');
    if (d.length === 14) {
      return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    }
    if (d.length === 11) {
      return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    }
    return doc;
  };

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(51, 65, 85);
  doc.text(`Razão Social: ${dados.prestador.razaoSocial || 'Oficina Detailer'}`, pageMargin + 4, y + 10);
  if (dados.prestador.nomeFantasia) {
    doc.text(`Nome Fantasia: ${dados.prestador.nomeFantasia}`, pageMargin + 4, y + 14);
  }
  doc.text(`CNPJ: ${formatarDoc(dados.prestador.cnpj)}`, pageMargin + 4, y + 18);
  doc.text(`Inscrição Municipal: ${dados.prestador.inscricaoMunicipal || 'Isento / Não inf.'}`, pageMargin + 70, y + 18);

  const contatoPrestador = [dados.prestador.telefone, dados.prestador.email].filter(Boolean).join(' | ');
  if (contatoPrestador) {
    doc.text(`Contato: ${contatoPrestador}`, pageMargin + 130, y + 18);
  }

  y += 26;

  // 3. TOMADOR DE SERVIÇOS (CLIENTE)
  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.25);
  doc.roundedRect(pageMargin, y, usableWidth, 19, 1.5, 1.5, 'FD');

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text('DADOS DO TOMADOR DE SERVIÇOS (CLIENTE)', pageMargin + 4, y + 5);

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(51, 65, 85);
  doc.text(`Nome / Razão Social: ${dados.tomador.nome || 'Cliente'}`, pageMargin + 4, y + 10);
  doc.text(`CPF / CNPJ: ${formatarDoc(dados.tomador.cpfCnpj)}`, pageMargin + 4, y + 15);

  const contatoTomador = [dados.tomador.telefone, dados.tomador.email].filter(Boolean).join(' | ');
  if (contatoTomador) {
    doc.text(`Contato: ${contatoTomador}`, pageMargin + 70, y + 15);
  }

  y += 22;

  // 4. DISCRIMINAÇÃO DOS SERVIÇOS PRESTADOS
  const descLinhas: string[] = doc.splitTextToSize(
    dados.servico.discriminacao || 'Serviços de estética e detalhamento automotivo.',
    usableWidth - 8
  );

  const altCardDisc = Math.max(30, 12 + descLinhas.length * 3.8);

  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.25);
  doc.roundedRect(pageMargin, y, usableWidth, altCardDisc, 1.5, 1.5, 'FD');

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text('DISCRIMINAÇÃO DOS SERVIÇOS PRESTADOS', pageMargin + 4, y + 5.5);

  doc.setFontSize(7.2);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(51, 65, 85);
  let curDescY = y + 10.5;
  descLinhas.forEach((linha) => {
    doc.text(linha, pageMargin + 4, curDescY);
    curDescY += 3.8;
  });

  y += altCardDisc + 4;

  // 5. CÓDIGO DO SERVIÇO & TRIBUTAÇÃO
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.25);
  doc.roundedRect(pageMargin, y, usableWidth, 14, 1.5, 1.5, 'FD');

  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(71, 85, 105);
  doc.text('ITEM DA LISTA DE SERVIÇOS (LC 116/2003)', pageMargin + 4, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.text(
    `${dados.servico.itemListaServico || '14.01'} — Serviços de lavagem, lubrificação e polimento de veículos automotores.`,
    pageMargin + 4,
    y + 9.5
  );

  if (dados.servico.cnae) {
    doc.text(`CNAE: ${dados.servico.cnae}`, rightMarginX - 45, y + 9.5);
  }

  y += 17;

  // 6. VALORES TRIBUTÁRIOS E TOTAIS
  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.25);
  doc.roundedRect(pageMargin, y, usableWidth, 22, 1.5, 1.5, 'FD');

  const colValW = usableWidth / 4;

  // Linha 1 de Cabeçalhos de Valores
  doc.setFontSize(6.8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 116, 139);
  doc.text('VALOR TOTAL DOS SERVIÇOS', pageMargin + 4, y + 5);
  doc.text('BASE DE CÁLCULO', pageMargin + colValW + 4, y + 5);
  doc.text('ALÍQUOTA ISS', pageMargin + colValW * 2 + 4, y + 5);
  doc.text('VALOR DO ISS', pageMargin + colValW * 3 + 4, y + 5);

  // Linha 2 com os Valores Numéricos
  const valorTotal = dados.servico.valorTotal || 0;
  const aliquota = dados.servico.aliquotaIss || 2.0;
  const valorIss = dados.servico.valorIss ?? (valorTotal * (aliquota / 100));

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(formatarMoeda(valorTotal), pageMargin + 4, y + 11);
  doc.text(formatarMoeda(valorTotal), pageMargin + colValW + 4, y + 11);
  doc.text(`${aliquota.toFixed(2)}%`, pageMargin + colValW * 2 + 4, y + 11);
  doc.text(formatarMoeda(valorIss), pageMargin + colValW * 3 + 4, y + 11);

  // Linha 3 de Informações Complementares
  doc.setFontSize(6.8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  const formaPgtoStr = dados.formaPagamento ? ` | Forma de Pagamento: ${dados.formaPagamento.toUpperCase()}` : '';
  const statusPgtoStr = dados.statusPagamento ? ` (${dados.statusPagamento.toUpperCase()})` : '';
  doc.text(
    `ISS Retido na Fonte: ${dados.servico.issRetido ? 'SIM' : 'NÃO'} | Regime: Simples Nacional${formaPgtoStr}${statusPgtoStr}`,
    pageMargin + 4,
    y + 17
  );

  y += 26;

  // 7. AVISO LEGAL E DE AUTENTICIDADE NO RODAPÉ
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(100, 116, 139);
  doc.text(
    'A autenticidade desta NFS-e pode ser verificada no portal da prefeitura emissora através do código de verificação acima.',
    pageMargin + usableWidth / 2,
    y + 4,
    { align: 'center' }
  );
  doc.text(
    'Documento emitido eletronicamente pela Plataforma Detailers / NuvemWash com autenticação em nuvem.',
    pageMargin + usableWidth / 2,
    y + 8,
    { align: 'center' }
  );

  // Rodapé padrão
  rodapeDocumento(doc, {
    planoCodigo: dados.planoCodigo,
    pdfTextoRodape: dados.pdfTextoRodape,
    pdfOcultarMarcaDagua: dados.pdfOcultarMarcaDagua,
    paginaAtual: 1,
    totalPaginas: 1,
  });

  const nomeArquivo = `nfse_${dados.numero.padStart(6, '0')}.pdf`;
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
