import jsPDF from 'jspdf';
import { formatarData, formatarHora } from './datas';
import { formatarMoeda, formatarOS } from './formatters';
import { fetchImageAsBase64 } from './evidencias';
import { cabecalhoDocumento, rodapeDocumento, hexToRgb } from './pdf';

export interface PDFOSItemData {
  servico_nome: string;
  quantidade?: number;
  preco?: number;
  duracao_minutos?: number;
  observacoes?: string | null;
}

export interface PDFOSData {
  id?: string;
  numero_os: number;
  status: string;
  data_emissao?: string | null;
  inicio?: string | null;
  previsao_entrega?: string | null;
  data_conclusao?: string | null;
  concluido_em?: string | null;
  responsavel_nome?: string | null;
  observacoes?: string | null;

  // Cliente
  clienteNome: string;
  clienteTelefone?: string | null;
  clienteEmail?: string | null;
  clienteDocumento?: string | null;

  // Veículo
  veiculoModelo: string;
  veiculoPlaca: string;
  veiculoMarca?: string | null;
  veiculoCor?: string | null;
  veiculoAno?: number | null;
  categoriaNome?: string | null;

  // Oficina & Branding
  oficinaNome: string;
  oficinaRazaoSocial?: string | null;
  oficinaDocumento?: string | null;
  oficinaDocumentoTipo?: 'cpf' | 'cnpj' | null;
  oficinaTelefone?: string | null;
  oficinaCidadeUF?: string | null;
  oficinaLogoUrl?: string | null;

  planoCodigo?: string;
  pdfCorPrimaria?: string | null;
  pdfCorFundoCabecalho?: string | null;
  pdfCorTextoCabecalho?: string | null;
  pdfCorFundoSecoes?: string | null;
  pdfCorTextoSecoes?: string | null;
  pdfSubtituloCabecalho?: string | null;
  pdfTextoRodape?: string | null;
  pdfOcultarMarcaDagua?: boolean | null;

  // Itens de Serviço
  itens: PDFOSItemData[];
  valor_total: number;
  desconto?: number;
  forma_pagamento?: string | null;

  // Assinaturas
  assinaturaClienteUrl?: string | null;
  assinaturaClienteNome?: string | null;
  assinaturaTecnicoNome?: string | null;
}

/**
 * Gera o documento PDF da Ordem de Serviço com suporte completo a temas claro/escuro
 * e personalização livre de cores de fundo e texto.
 */
export async function gerarPDFOS(
  data: PDFOSData,
  onProgress?: (mensagem: string) => void,
  acao: 'download' | 'print' = 'download'
): Promise<void> {
  onProgress?.('Iniciando geração da Ordem de Serviço...');

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 210mm
  const pageMargin = 15;
  const usableWidth = pageWidth - pageMargin * 2; // 180mm
  const rightMarginX = pageMargin + usableWidth;

  // Carregar Logo da oficina se houver
  let logoBase64 = '';
  if (data.oficinaLogoUrl) {
    try {
      onProgress?.('Carregando logo da oficina...');
      logoBase64 = await fetchImageAsBase64(data.oficinaLogoUrl);
    } catch (e) {
      console.error('[PDFOS] Erro ao carregar logo:', e);
    }
  }

  const osFormatada = formatarOS(data.numero_os);

  // Status Badge formatado
  let statusBadgeTxt = 'ORDEM DE SERVIÇO';
  if (data.status === 'concluido') statusBadgeTxt = 'OS CONCLUÍDA';
  else if (data.status === 'em_andamento') statusBadgeTxt = 'OS EM EXECUÇÃO';
  else if (data.status === 'agendado' || data.status === 'confirmado') statusBadgeTxt = 'OS CONFIRMADA';
  else if (data.status === 'cancelado') statusBadgeTxt = 'OS CANCELADA';

  // 1. Cabeçalho Padronizado
  let y = cabecalhoDocumento(doc, {
    oficinaNome: data.oficinaNome,
    oficinaRazaoSocial: data.oficinaRazaoSocial || undefined,
    oficinaDocumento: data.oficinaDocumento || undefined,
    oficinaDocumentoTipo: data.oficinaDocumentoTipo || undefined,
    oficinaTelefone: data.oficinaTelefone || undefined,
    oficinaCidadeUF: data.oficinaCidadeUF || undefined,
    logoBase64: logoBase64 || undefined,
    documentoTitulo: `ORDEM DE SERVIÇO ${osFormatada}`,
    dataEmissao: data.data_emissao
      ? `${formatarData(data.data_emissao)} ${formatarHora(data.data_emissao)}`
      : `${formatarData(new Date().toISOString())} ${formatarHora(new Date().toISOString())}`,
    statusBadge: statusBadgeTxt,
    numeroOS: data.numero_os,
    planoCodigo: data.planoCodigo,
    pdfCorPrimaria: data.pdfCorPrimaria,
    pdfCorFundoCabecalho: data.pdfCorFundoCabecalho,
    pdfCorTextoCabecalho: data.pdfCorTextoCabecalho,
    pdfCorFundoSecoes: data.pdfCorFundoSecoes,
    pdfCorTextoSecoes: data.pdfCorTextoSecoes || undefined,
    pdfSubtituloCabecalho: data.pdfSubtituloCabecalho || undefined,
    pdfTextoRodape: data.pdfTextoRodape || undefined,
    pdfOcultarMarcaDagua: data.pdfOcultarMarcaDagua || undefined,
  });

  const isFree = data.planoCodigo === 'free';
  const corFundoSecoesRgb = isFree ? [39, 39, 42] as [number, number, number] : hexToRgb(data.pdfCorFundoSecoes, [39, 39, 42]);
  const corPrimariaRgb = isFree ? [245, 158, 11] as [number, number, number] : hexToRgb(data.pdfCorPrimaria, [245, 158, 11]);

  // Detector de Luminância e Contraste
  const lumFundoSecoes = (0.299 * corFundoSecoesRgb[0] + 0.587 * corFundoSecoesRgb[1] + 0.114 * corFundoSecoesRgb[2]) / 255;
  const isLightSecoes = lumFundoSecoes > 0.65;

  // Cor do Texto Principal: usa a escolha explícita do usuário ou adapta automaticamente
  const corTextoPrincipal: [number, number, number] = data.pdfCorTextoSecoes
    ? hexToRgb(data.pdfCorTextoSecoes, isLightSecoes ? [15, 23, 42] : [255, 255, 255])
    : (isLightSecoes ? [15, 23, 42] : [255, 255, 255]);

  const lumTexto = (0.299 * corTextoPrincipal[0] + 0.587 * corTextoPrincipal[1] + 0.114 * corTextoPrincipal[2]) / 255;
  const isTextoEscuro = lumTexto < 0.5;

  const corTextoSecundario: [number, number, number] = isTextoEscuro ? [82, 82, 91] : [203, 213, 225];
  const corBordaCard: [number, number, number] = isLightSecoes ? [203, 213, 225] : [63, 63, 70];
  const corLinhaPar: [number, number, number] = isLightSecoes ? [248, 250, 252] : [28, 28, 32];
  const corLinhaImpar: [number, number, number] = isLightSecoes ? [255, 255, 255] : [34, 34, 39];
  const corHeaderTabelaBg: [number, number, number] = isLightSecoes ? [241, 245, 249] : [20, 20, 24];
  const corDestaquePreco: [number, number, number] = isLightSecoes
    ? (corPrimariaRgb[0] > 200 && corPrimariaRgb[1] > 180 ? [180, 83, 9] : corPrimariaRgb)
    : [251, 191, 36];

  // 2. Bloco Cliente, Veículo e Prazos (Cartão Unificado)
  doc.setFillColor(corFundoSecoesRgb[0], corFundoSecoesRgb[1], corFundoSecoesRgb[2]);
  doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
  doc.setLineWidth(0.25);
  doc.roundedRect(pageMargin, y, usableWidth, 26, 2, 2, 'FD');

  // Coluna Esquerda: Cliente
  doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text('DADOS DO CLIENTE', pageMargin + 5, y + 5.5);

  doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.text(`Nome: ${data.clienteNome}`, pageMargin + 5, y + 11.5);
  doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
  doc.text(`Telefone: ${data.clienteTelefone || 'Não informado'}`, pageMargin + 5, y + 16.5);
  if (data.clienteDocumento) {
    doc.text(`CPF/CNPJ: ${data.clienteDocumento}`, pageMargin + 5, y + 21.5);
  } else if (data.clienteEmail) {
    doc.text(`Email: ${data.clienteEmail}`, pageMargin + 5, y + 21.5);
  }

  // Linha divisória sutil 1
  const colCentroX = pageMargin + 66;
  doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
  doc.setLineWidth(0.15);
  doc.line(colCentroX - 4, y + 3, colCentroX - 4, y + 23);

  // Coluna Central: Veículo
  doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text('DADOS DO VEÍCULO', colCentroX, y + 5.5);

  doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.text(`Modelo: ${data.veiculoModelo}`, colCentroX, y + 11.5);
  doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
  doc.text(`Placa: ${data.veiculoPlaca.toUpperCase()}`, colCentroX, y + 16.5);
  const detVeiculo = [data.veiculoMarca, data.veiculoCor, data.veiculoAno ? `Ano ${data.veiculoAno}` : '']
    .filter(Boolean)
    .join(' • ');
  doc.text(detVeiculo || 'Detalhes não especificados', colCentroX, y + 21.5);

  // Linha divisória sutil 2
  const colDirX = pageMargin + 126;
  doc.line(colDirX - 4, y + 3, colDirX - 4, y + 23);

  // Coluna Direita: Datas & Responsável
  doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text('PRAZOS & EXECUÇÃO', colDirX, y + 5.5);

  doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');

  const prevEntrega = data.previsao_entrega
    ? `${formatarData(data.previsao_entrega)} ${formatarHora(data.previsao_entrega)}`
    : 'A combinar';
  doc.text(`Previsão: ${prevEntrega}`, colDirX, y + 11.5);

  const dataTermino = data.data_conclusao || data.concluido_em;
  const conclEm = dataTermino
    ? `${formatarData(dataTermino)} ${formatarHora(dataTermino)}`
    : (data.status === 'concluido' ? 'Concluído' : 'Em andamento');
  doc.text(`Conclusão: ${conclEm}`, colDirX, y + 16.5);

  const respNome = data.responsavel_nome || 'Equipe Técnica';
  doc.text(`Responsável: ${respNome}`, colDirX, y + 21.5);

  y += 30;

  // 3. Tabela de Serviços da Ordem de Serviço
  onProgress?.('Renderizando serviços da OS...');
  doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  doc.text('SERVIÇOS CONTRATADOS / EM EXECUÇÃO', pageMargin, y);
  y += 5;

  // Cabeçalho da Tabela
  doc.setFillColor(corHeaderTabelaBg[0], corHeaderTabelaBg[1], corHeaderTabelaBg[2]);
  doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
  doc.setLineWidth(0.2);
  doc.roundedRect(pageMargin, y, usableWidth, 7, 1, 1, 'FD');

  doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('DESCRIÇÃO DO SERVIÇO', pageMargin + 5, y + 4.8);
  doc.text('QTD', rightMarginX - 60, y + 4.8, { align: 'center' });
  doc.text('DURAÇÃO', rightMarginX - 38, y + 4.8, { align: 'center' });
  doc.text('VALOR TOTAL', rightMarginX - 5, y + 4.8, { align: 'right' });

  y += 7.5;

  // Linhas da Tabela
  const itens = data.itens && data.itens.length > 0 ? data.itens : [];
  if (itens.length === 0) {
    doc.setFillColor(corFundoSecoesRgb[0], corFundoSecoesRgb[1], corFundoSecoesRgb[2]);
    doc.rect(pageMargin, y, usableWidth, 8, 'F');
    doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.text('Nenhum serviço registrado nesta Ordem de Serviço.', pageMargin + 5, y + 5.5);
    y += 9.5;
  } else {
    itens.forEach((item, idx) => {
      if (y + 10 > 270) {
        doc.addPage();
        y = 15;
      }

      const isEven = idx % 2 === 0;
      const rowBg = isEven ? corLinhaPar : corLinhaImpar;

      doc.setFillColor(rowBg[0], rowBg[1], rowBg[2]);
      doc.rect(pageMargin, y, usableWidth, 7.5, 'F');

      // Linha divisória sutil
      doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
      doc.setLineWidth(0.15);
      doc.line(pageMargin, y, rightMarginX, y);

      doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text(`• ${item.servico_nome}`, pageMargin + 5, y + 5);

      doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
      doc.text(String(item.quantidade || 1), rightMarginX - 60, y + 5, { align: 'center' });
      doc.text(item.duracao_minutos ? `${item.duracao_minutos} min` : '—', rightMarginX - 38, y + 5, { align: 'center' });

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
      doc.text(formatarMoeda(item.preco || 0), rightMarginX - 5, y + 5, { align: 'right' });

      y += 7.5;
    });
  }

  y += 4.5;

  // 4. Resumo Financeiro da OS
  if (y + 25 > 270) {
    doc.addPage();
    y = 15;
  }

  doc.setFillColor(corFundoSecoesRgb[0], corFundoSecoesRgb[1], corFundoSecoesRgb[2]);
  doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
  doc.setLineWidth(0.25);
  doc.roundedRect(rightMarginX - 85, y, 85, 24, 2, 2, 'FD');

  doc.setFontSize(8.5);
  doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
  doc.setFont('helvetica', 'normal');

  const subtotal = data.valor_total + (data.desconto || 0);
  doc.text('Subtotal:', rightMarginX - 79, y + 6);
  doc.text(formatarMoeda(subtotal), rightMarginX - 6, y + 6, { align: 'right' });

  if (data.desconto && data.desconto > 0) {
    doc.setTextColor(239, 68, 68);
    doc.text('Desconto:', rightMarginX - 79, y + 11.5);
    doc.text(`- ${formatarMoeda(data.desconto)}`, rightMarginX - 6, y + 11.5, { align: 'right' });
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
  doc.text('TOTAL DA OS:', rightMarginX - 79, y + 18.5);
  doc.text(formatarMoeda(data.valor_total), rightMarginX - 6, y + 18.5, { align: 'right' });

  y += 28;

  // 5. Observações / Instruções
  if (data.observacoes && data.observacoes.trim()) {
    if (y + 20 > 270) {
      doc.addPage();
      y = 15;
    }

    const splitObs = doc.splitTextToSize(data.observacoes.trim(), usableWidth - 10);
    const boxHeight = Math.max(12, 7 + splitObs.length * 4);

    doc.setFillColor(corFundoSecoesRgb[0], corFundoSecoesRgb[1], corFundoSecoesRgb[2]);
    doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
    doc.setLineWidth(0.25);
    doc.roundedRect(pageMargin, y, usableWidth, boxHeight, 1.5, 1.5, 'FD');

    doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('OBSERVAÇÕES E NOTAS DO ATENDIMENTO:', pageMargin + 5, y + 5);

    doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    splitObs.forEach((line: string, i: number) => {
      doc.text(line, pageMargin + 5, y + 9.5 + i * 3.8);
    });

    y += boxHeight + 5;
  }

  // 6. Bloco de Assinaturas (Cliente e Oficina)
  if (y + 36 > 270) {
    doc.addPage();
    y = 15;
  }

  doc.setFillColor(corFundoSecoesRgb[0], corFundoSecoesRgb[1], corFundoSecoesRgb[2]);
  doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
  doc.setLineWidth(0.25);
  doc.roundedRect(pageMargin, y, usableWidth, 34, 2, 2, 'FD');

  // Termo curto de entrega e garantia
  doc.setFontSize(7.2);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
  const termoTxt = '"Declaro que os serviços discriminados nesta Ordem de Serviço foram contratados e/ou vistoriados de acordo com os termos estabelecidos."';
  const splitTermo = doc.splitTextToSize(termoTxt, usableWidth - 10);
  splitTermo.forEach((line: string, idx: number) => {
    doc.text(line, pageMargin + 5, y + 5.5 + idx * 3.5);
  });

  const sigY = y + 14;
  const colW = (usableWidth - 16) / 2;

  // Linha 1: Assinatura do Cliente
  doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
  doc.setLineWidth(0.3);
  doc.line(pageMargin + 5, sigY + 9, pageMargin + 5 + colW, sigY + 9);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
  doc.text(data.assinaturaClienteNome || data.clienteNome, pageMargin + 5 + colW / 2, sigY + 13, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
  doc.text('Assinatura do Cliente', pageMargin + 5 + colW / 2, sigY + 16.5, { align: 'center' });

  // Linha 2: Assinatura da Oficina / Responsável
  const col2StartX = rightMarginX - 5 - colW;
  doc.line(col2StartX, sigY + 9, col2StartX + colW, sigY + 9);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
  doc.text(data.assinaturaTecnicoNome || data.responsavel_nome || data.oficinaNome, col2StartX + colW / 2, sigY + 13, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
  doc.text('Responsável Técnico / Oficina', col2StartX + colW / 2, sigY + 16.5, { align: 'center' });

  // Rodapé padrão
  rodapeDocumento(doc, {
    planoCodigo: data.planoCodigo,
    pdfTextoRodape: data.pdfTextoRodape,
    pdfOcultarMarcaDagua: data.pdfOcultarMarcaDagua,
    paginaAtual: 1,
    totalPaginas: doc.getNumberOfPages(),
  });

  onProgress?.('Finalizando PDF da Ordem de Serviço...');
  const nomeArquivo = `os_${data.veiculoPlaca.toUpperCase()}_${osFormatada.replace(/\s+/g, '_')}.pdf`;

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
    // No mobile (especialmente iOS Safari) e em downloads normais, doc.save é seguro e não causa erro WebKitBlobResource
    doc.save(nomeArquivo);
  }
}
