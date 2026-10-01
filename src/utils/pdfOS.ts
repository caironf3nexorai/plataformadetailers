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
  clienteEndereco?: string | null;

  // Veículo
  veiculoModelo: string;
  veiculoPlaca: string;
  veiculoMarca?: string | null;
  veiculoCor?: string | null;
  veiculoAno?: number | null;
  veiculoKm?: number | string | null;
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

  // Assinaturas e Termos
  assinaturaClienteUrl?: string | null;
  assinaturaClienteNome?: string | null;
  assinaturaTecnicoNome?: string | null;
  termoResponsabilidade?: string | null;
  termoGarantia?: string | null;
  garantiaMeses?: number | null;
  incluirTermoRisco?: boolean | null;
  termoRiscoServico?: string | null;
  termoRiscoObservacoes?: string | null;
  termoRiscoTexto?: string | null;
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
  const somaItens = itens.reduce((acc, it) => acc + (Number(it.preco) || 0) * (it.quantidade || 1), 0);
  if (itens.length === 1 && somaItens === 0 && data.valor_total > 0) {
    itens[0].preco = data.valor_total;
  } else if (itens.length > 1 && somaItens === 0 && data.valor_total > 0) {
    itens[0].preco = data.valor_total;
  }

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

  // 6. Bloco de Termos e Assinaturas (Cliente e Oficina)
  const termoRespCustom = data.termoResponsabilidade;
  const termoGarCustom = data.termoGarantia;

  let termoTxt = termoRespCustom && !data.incluirTermoRisco
    ? `Declaração de Responsabilidade & Ciência: ${termoRespCustom}`
    : (data.incluirTermoRisco
      ? '"Declaro que os serviços discriminados nesta Ordem de Serviço foram contratados e vistoriados. Condições técnicas e riscos específicos aceitos conforme Anexo Contratual emitido."'
      : '"Declaro que os serviços discriminados nesta Ordem de Serviço foram contratados e/ou vistoriados de acordo com os termos estabelecidos."');

  if (data.garantiaMeses) {
    const prazoStr = `${data.garantiaMeses} ${data.garantiaMeses === 1 ? 'mês' : 'meses'}`;
    termoTxt += `\n[TERMO DE GARANTIA: A ${data.oficinaNome} garante os serviços executados pelo prazo de ${prazoStr} informado nesta OS, exclusivamente contra falhas decorrentes da execução do serviço. EXCLUSÕES: acidentes, impactos, desgaste natural, falta de manutenção, uso inadequado, produtos químicos ou corrosivos, seivas, dejetos de aves, agentes ambientais, lavagem incorreta, intervenção de terceiros, defeitos preexistentes ou problemas sem relação com o serviço realizado. O cliente declara estar ciente das condições e orientações de conservação.]`;
  } else if (termoGarCustom) {
    termoTxt += `\n[Garantia do Atendimento: ${termoGarCustom}]`;
  }

  doc.setFontSize(6.8);
  doc.setFont('helvetica', 'italic');
  const splitTermo = doc.splitTextToSize(termoTxt, usableWidth - 10);
  const termosHeight = 7 + splitTermo.length * 3.1;
  const totalBoxHeight = Math.max(38, termosHeight + 22);

  if (y + totalBoxHeight > 270) {
    doc.addPage();
    y = 15;
  }

  doc.setFillColor(corFundoSecoesRgb[0], corFundoSecoesRgb[1], corFundoSecoesRgb[2]);
  doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
  doc.setLineWidth(0.25);
  doc.roundedRect(pageMargin, y, usableWidth, totalBoxHeight, 2, 2, 'FD');

  doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
  splitTermo.forEach((line: string, idx: number) => {
    doc.text(line, pageMargin + 5, y + 5 + idx * 3.1);
  });

  const sigY = y + termosHeight + 2;
  const colW = (usableWidth - 16) / 2;

  // Linha 1: Assinatura do Cliente
  doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
  doc.setLineWidth(0.3);
  doc.line(pageMargin + 5, sigY + 8, pageMargin + 5 + colW, sigY + 8);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
  doc.text(data.assinaturaClienteNome || data.clienteNome, pageMargin + 5 + colW / 2, sigY + 12, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
  doc.text('Assinatura do Cliente', pageMargin + 5 + colW / 2, sigY + 15.5, { align: 'center' });

  // Linha 2: Assinatura da Oficina / Responsável
  const col2StartX = rightMarginX - 5 - colW;
  doc.line(col2StartX, sigY + 8, col2StartX + colW, sigY + 8);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
  doc.text(data.assinaturaTecnicoNome || data.responsavel_nome || data.oficinaNome, col2StartX + colW / 2, sigY + 12, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.text('Responsável Técnico / Oficina', col2StartX + colW / 2, sigY + 15.5, { align: 'center' });

  // 7. TERMO DE CIÊNCIA E AUTORIZAÇÃO DE SERVIÇO COM RISCO ESPECÍFICO (FOLHA SEPARADA DEDICADA)
  if (data.incluirTermoRisco) {
    onProgress?.('Renderizando Termo de Risco em folha separada...');
    doc.addPage();
    let yRisco = 14;

    // Cores específicas para Documento Legal Impresso (Garantia de 100% de Contraste e Legibilidade no Papel)
    const corDocTextoDark: [number, number, number] = [15, 23, 42]; // Slate-900: texto principal escuro e nítido
    const corDocTextoMuted: [number, number, number] = [71, 85, 105]; // Slate-600: texto secundário
    const corDocBorda: [number, number, number] = [203, 213, 225]; // Slate-300: bordas elegantes
    const corDocFundoCard: [number, number, number] = [248, 250, 252]; // Slate-50: fundo sutil
    const corDocAccent: [number, number, number] = [180, 83, 9]; // Amber-700: destaque formal

    // 1. Cabeçalho Oficial da Empresa / Oficina
    doc.setFillColor(corDocFundoCard[0], corDocFundoCard[1], corDocFundoCard[2]);
    doc.setDrawColor(corDocBorda[0], corDocBorda[1], corDocBorda[2]);
    doc.setLineWidth(0.3);
    doc.roundedRect(pageMargin, yRisco, usableWidth, 20, 1.5, 1.5, 'FD');

    // Nome / Razão Social
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(corDocTextoDark[0], corDocTextoDark[1], corDocTextoDark[2]);
    const nomeOficinaCabecalho = data.oficinaRazaoSocial || data.oficinaNome || 'OFICINA ESPECIALIZADA';
    doc.text(nomeOficinaCabecalho, pageMargin + 5, yRisco + 6.5);

    // Dados da Oficina (CNPJ, Telefone, Cidade)
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(corDocTextoMuted[0], corDocTextoMuted[1], corDocTextoMuted[2]);
    const docOfi = data.oficinaDocumento ? `CNPJ/CPF: ${data.oficinaDocumento}` : '';
    const telOfi = data.oficinaTelefone ? `Tel: ${data.oficinaTelefone}` : '';
    const cidOfi = data.oficinaCidadeUF ? `${data.oficinaCidadeUF}` : '';
    const infoOficinaLinha = [docOfi, telOfi, cidOfi].filter(Boolean).join(' • ');
    if (infoOficinaLinha) {
      doc.text(infoOficinaLinha, pageMargin + 5, yRisco + 11.5);
    }

    // Linha de Conformidade CDC
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(corDocAccent[0], corDocAccent[1], corDocAccent[2]);
    doc.text(`ANEXO CONTRATUAL À ORDEM DE SERVIÇO #${osFormatada} — INSTRUMENTO DE CONFORMIDADE COM A LEI Nº 8.078/1990 (CDC)`, pageMargin + 5, yRisco + 16.5);

    yRisco += 25;

    // 2. Título Central Destacado
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(corDocAccent[0], corDocAccent[1], corDocAccent[2]);
    doc.text('TERMO DE CIÊNCIA E AUTORIZAÇÃO DE SERVIÇO COM RISCO TÉCNICO', pageMargin + usableWidth / 2, yRisco, { align: 'center' });
    yRisco += 4;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(corDocTextoMuted[0], corDocTextoMuted[1], corDocTextoMuted[2]);
    doc.text('Declaração de Esclarecimento Prévio, Vícios Preexistentes e Autorização Expressa de Execução (Arts. 6º, 8º, 14, 40 e 54 do CDC)', pageMargin + usableWidth / 2, yRisco, { align: 'center' });
    yRisco += 3;

    doc.setDrawColor(corDocAccent[0], corDocAccent[1], corDocAccent[2]);
    doc.setLineWidth(0.4);
    doc.line(pageMargin + 10, yRisco, rightMarginX - 10, yRisco);
    yRisco += 6;

    // 3. Quadro de Qualificação das Partes e do Veículo (Dossiê)
    const boxDossieH = 35;
    doc.setFillColor(corDocFundoCard[0], corDocFundoCard[1], corDocFundoCard[2]);
    doc.setDrawColor(corDocBorda[0], corDocBorda[1], corDocBorda[2]);
    doc.setLineWidth(0.25);
    doc.roundedRect(pageMargin, yRisco, usableWidth, boxDossieH, 1.5, 1.5, 'FD');

    // Título da Seção do Quadro
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(corDocAccent[0], corDocAccent[1], corDocAccent[2]);
    doc.text('1. DADOS DE IDENTIFICAÇÃO E QUALIFICAÇÃO DAS PARTES', pageMargin + 5, yRisco + 5);

    const col1X = pageMargin + 5;
    const col2X = pageMargin + (usableWidth / 2) + 2;
    const linY1 = yRisco + 10;
    const linY2 = yRisco + 15;
    const linY3 = yRisco + 20;
    const linY4 = yRisco + 25;
    const linY5 = yRisco + 30;

    // Divisória vertical no meio do quadro
    doc.setDrawColor(corDocBorda[0], corDocBorda[1], corDocBorda[2]);
    doc.setLineWidth(0.15);
    doc.line(col2X - 4, yRisco + 7, col2X - 4, yRisco + boxDossieH - 2);

    // COLUNA 1: CONTRATANTE (CLIENTE)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(corDocTextoDark[0], corDocTextoDark[1], corDocTextoDark[2]);
    doc.text('CONTRATANTE (CLIENTE):', col1X, linY1);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    // Nome
    doc.text(`Nome: ${data.clienteNome || '________________________________________'}`, col1X, linY2);
    // CPF / CNPJ (se tiver, mostra; se não, linha para caneta)
    const cpfTxt = data.clienteDocumento ? `CPF/CNPJ: ${data.clienteDocumento}` : 'CPF/CNPJ: ____________________________________';
    doc.text(cpfTxt, col1X, linY3);
    // Telefone
    const telTxt = data.clienteTelefone ? `Telefone/WhatsApp: ${data.clienteTelefone}` : 'Telefone/WhatsApp: ____________________________';
    doc.text(telTxt, col1X, linY4);
    // Endereço ou E-mail
    const endTxt = data.clienteEndereco ? `Endereço: ${data.clienteEndereco}` : (data.clienteEmail ? `E-mail: ${data.clienteEmail}` : 'Endereço: ____________________________________');
    doc.text(endTxt, col1X, linY5);

    // COLUNA 2: VEÍCULO & CONTRATADA
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(corDocTextoDark[0], corDocTextoDark[1], corDocTextoDark[2]);
    doc.text('VEÍCULO OBJETO DO ATENDIMENTO:', col2X, linY1);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    // Modelo e Marca
    const modeloMarca = `${data.veiculoMarca ? data.veiculoMarca + ' ' : ''}${data.veiculoModelo || 'Não informado'}`;
    doc.text(`Veículo: ${modeloMarca}`, col2X, linY2);
    // Placa e Cor
    const placaTxt = data.veiculoPlaca ? data.veiculoPlaca.toUpperCase() : '_________';
    const corTxt = data.veiculoCor || '________';
    doc.text(`Placa: ${placaTxt}   |   Cor: ${corTxt}`, col2X, linY3);
    // Ano e KM
    const anoTxt = data.veiculoAno ? String(data.veiculoAno) : '________';
    const kmTxt = data.veiculoKm ? `${data.veiculoKm} km` : '___________ km';
    doc.text(`Ano/Modelo: ${anoTxt}   |   KM: ${kmTxt}`, col2X, linY4);
    // Data de Emissão / Vistoria
    const dataDoc = data.data_emissao ? formatarData(data.data_emissao) : new Date().toLocaleDateString('pt-BR');
    doc.text(`Data da OS / Emissão: ${dataDoc}`, col2X, linY5);

    yRisco += boxDossieH + 5;

    // 4. Procedimento(s) com Risco Técnico
    const servicoTitulo = data.termoRiscoServico || 'Procedimentos Especializados com Risco Técnico';
    doc.setFillColor(corDocFundoCard[0], corDocFundoCard[1], corDocFundoCard[2]);
    doc.setDrawColor(corDocBorda[0], corDocBorda[1], corDocBorda[2]);
    doc.setLineWidth(0.25);
    doc.roundedRect(pageMargin, yRisco, usableWidth, 9, 1.2, 1.2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    doc.setTextColor(corDocTextoDark[0], corDocTextoDark[1], corDocTextoDark[2]);
    doc.text(`2. PROCEDIMENTO TÉCNICO ENVOLVIDO: ${servicoTitulo}`, pageMargin + 5, yRisco + 5.8);
    yRisco += 13;

    // 5. Fundamentação Legal e Declaração de Ciência (CDC Arts. 6º, 8º, 14, 40, 46 e 54)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(corDocAccent[0], corDocAccent[1], corDocAccent[2]);
    doc.text('3. DECLARAÇÃO DE ESCLARECIMENTO PRÉVIO E LIMITES DE RESPONSABILIDADE (CDC)', pageMargin, yRisco);
    yRisco += 4;

    const p1 = 'I. DO DEVER DE INFORMAÇÃO E RISCOS INERENTES (Arts. 6º, III e 8º do CDC): O contratante declara ter sido prévia e adequadamente esclarecido pela equipe técnica acerca da metodologia de execução dos serviços contratados, seus limites técnicos e os riscos inerentes à intervenção, especialmente em razão do estado de conservação, histórico e condições preexistentes do veículo.';
    const p2 = `II. DOS VÍCIOS OCULTOS E CONDICIONANTES PRÉVIAS (Art. 14, §3º, I e II do CDC): O contratante autoriza a execução dos serviços ciente de que a ${nomeOficinaCabecalho} não poderá ser responsabilizada por danos, quebras, falhas mecânicas, elétricas ou estéticas decorrentes exclusivamente de vícios preexistentes, desgastes naturais do tempo e uso, repinturas anteriores inadequadas, verniz fino/ressecado, conectores, borrachas ou chicotes fragilizados e componentes danificados não identificáveis em inspeção visual preliminar.`;
    const p3 = 'III. DO PADRÃO TÉCNICO E BOA-FÉ: A empresa compromete-se a executar os procedimentos com técnica adequada, ferramentas profissionais e cautela, permanecendo responsável pelos danos que forem comprovadamente decorrentes de defeito culposo direto na prestação dos serviços.';

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(corDocTextoDark[0], corDocTextoDark[1], corDocTextoDark[2]);

    const renderP = (txt: string) => {
      const split = doc.splitTextToSize(txt, usableWidth);
      split.forEach((linha: string) => {
        doc.text(linha, pageMargin, yRisco);
        yRisco += 3.6;
      });
      yRisco += 1.8;
    };

    renderP(p1);
    renderP(p2);
    renderP(p3);

    // 6. Bloco de Riscos Específicos Informados (Art. 54, §4º do CDC)
    let textoRiscosExibir = data.termoRiscoObservacoes?.trim() || '';
    if (!textoRiscosExibir && data.termoResponsabilidade && data.termoResponsabilidade.trim()) {
      textoRiscosExibir = data.termoResponsabilidade.trim();
    }
    if (!textoRiscosExibir) {
      textoRiscosExibir = '• Vistoria preliminar realizada com o cliente. Riscos inerentes ao estado de conservação, pintura, componentes e agregados esclarecidos e aceitos.\n• Cuidados posteriores de cura, lavagem e preservação informados pelo técnico responsável.';
    }

    const splitRiscos = doc.splitTextToSize(textoRiscosExibir, usableWidth - 10);
    const boxRiscosH = Math.max(16, 8 + splitRiscos.length * 3.5);

    // Se não couber na folha atual com assinaturas, cria nova página
    if (yRisco + boxRiscosH + 45 > 280) {
      doc.addPage();
      yRisco = 15;
    }

    doc.setFillColor(corDocFundoCard[0], corDocFundoCard[1], corDocFundoCard[2]);
    doc.setDrawColor(corDocAccent[0], corDocAccent[1], corDocAccent[2]);
    doc.setLineWidth(0.35);
    doc.roundedRect(pageMargin, yRisco, usableWidth, boxRiscosH, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.6);
    doc.setTextColor(corDocAccent[0], corDocAccent[1], corDocAccent[2]);
    doc.text('4. RISCOS ESPECÍFICOS & CONDIÇÕES IDENTIFICADAS (ART. 54, §4º DO CDC):', pageMargin + 5, yRisco + 5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(corDocTextoDark[0], corDocTextoDark[1], corDocTextoDark[2]);
    splitRiscos.forEach((l: string, idx: number) => {
      doc.text(l, pageMargin + 5, yRisco + 9.5 + idx * 3.5);
    });

    yRisco += boxRiscosH + 6;

    // 7. Declaração expressa de consentimento
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    doc.setTextColor(corDocAccent[0], corDocAccent[1], corDocAccent[2]);
    doc.text('Declaro que li, compreendi os riscos informados e autorizo expressamente a execução dos serviços.', pageMargin + usableWidth / 2, yRisco, { align: 'center' });
    yRisco += 7;

    // Local e Data formal
    const cidadeOficina = data.oficinaCidadeUF ? data.oficinaCidadeUF.split('/')[0].trim() : '';
    const localDataStr = `${cidadeOficina ? cidadeOficina + ' - ' : ''}${dataDoc}`;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(corDocTextoMuted[0], corDocTextoMuted[1], corDocTextoMuted[2]);
    doc.text(`Local e Data: ${localDataStr}`, pageMargin + 5, yRisco);
    yRisco += 5;

    // Colunas de Assinatura
    const sigBoxW = (usableWidth - 16) / 2;
    const colCliX = pageMargin + 5;
    const colOfiX = rightMarginX - 5 - sigBoxW;

    // Linha Cliente
    doc.setDrawColor(corDocTextoDark[0], corDocTextoDark[1], corDocTextoDark[2]);
    doc.setLineWidth(0.35);
    doc.line(colCliX, yRisco + 12, colCliX + sigBoxW, yRisco + 12);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(corDocTextoDark[0], corDocTextoDark[1], corDocTextoDark[2]);
    doc.text(data.assinaturaClienteNome || data.clienteNome || 'Cliente / Contratante', colCliX + sigBoxW / 2, yRisco + 16, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(corDocTextoMuted[0], corDocTextoMuted[1], corDocTextoMuted[2]);
    const docAssinatura = data.clienteDocumento ? `CPF/CNPJ: ${data.clienteDocumento}` : 'Assinatura / Aceite do Cliente';
    doc.text(docAssinatura, colCliX + sigBoxW / 2, yRisco + 19.5, { align: 'center' });

    // Linha Oficina
    doc.line(colOfiX, yRisco + 12, colOfiX + sigBoxW, yRisco + 12);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(corDocTextoDark[0], corDocTextoDark[1], corDocTextoDark[2]);
    doc.text(data.assinaturaTecnicoNome || data.responsavel_nome || data.oficinaRazaoSocial || data.oficinaNome, colOfiX + sigBoxW / 2, yRisco + 16, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(corDocTextoMuted[0], corDocTextoMuted[1], corDocTextoMuted[2]);
    doc.text('Responsável Técnico / Oficina', colOfiX + sigBoxW / 2, yRisco + 19.5, { align: 'center' });
  }

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
