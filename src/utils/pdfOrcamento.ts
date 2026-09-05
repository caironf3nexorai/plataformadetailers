import jsPDF from 'jspdf';
import { formatarData, formatarHora } from './datas';
import { formatarMoeda, formatarCodigoProposta } from './formatters';
import { fetchImageAsBase64, obterAssinaturaBase64, getEvidenciaSignedUrl } from './evidencias';
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

  // Fotos de Avaliação e Termos (Controle por Check)
  incluirFotos?: boolean;
  fotos?: Array<{ url: string; path?: string; tipo?: 'antes' | 'depois'; descricao?: string; created_at?: string }>;
  incluirTermos?: boolean;
  termosGarantia?: string | null;

  // Assinatura do Usuário/Oficina
  assinaturaUsuarioUrl?: string | null;
  assinaturaUsuarioNome?: string | null;
  assinadoUsuarioEm?: string | null;

  // Branding Customizado
  planoCodigo?: string;
  pdfCorPrimaria?: string;
  pdfCorFundoCabecalho?: string;
  pdfCorTextoCabecalho?: string;
  pdfCorFundoSecoes?: string;
  pdfCorTextoSecoes?: string;
  pdfSubtituloCabecalho?: string;
  pdfTextoObservacoesOrcamento?: string;
  pdfTextoRodape?: string;
  pdfOcultarMarcaDagua?: boolean;
}

/**
 * Desenha uma imagem proporcionalmente dentro da caixa delimitadora
 */
async function drawProportionalImage(
  doc: jsPDF,
  base64: string,
  format: string,
  x: number,
  y: number,
  boxWidth: number,
  boxHeight: number
) {
  try {
    const props = doc.getImageProperties(base64);
    const imgRatio = props.width / props.height;
    const boxRatio = boxWidth / boxHeight;

    let finalW = boxWidth;
    let finalH = boxHeight;
    let offsetX = 0;
    let offsetY = 0;

    if (imgRatio > boxRatio) {
      finalW = boxWidth;
      finalH = boxWidth / imgRatio;
      offsetY = (boxHeight - finalH) / 2;
    } else {
      finalH = boxHeight;
      finalW = boxHeight * imgRatio;
      offsetX = (boxWidth - finalW) / 2;
    }

    doc.addImage(base64, format, x + offsetX, y + offsetY, finalW, finalH);
  } catch (err) {
    doc.addImage(base64, format, x, y, boxWidth, boxHeight);
  }
}

/**
 * Gera o documento em PDF da Proposta Comercial com design refinado,
 * espaçamentos perfeitos e contraste adaptativo (suporta fundo branco ou escuro).
 */
export async function gerarPDFOrcamento(
  data: PDFOrcamentoData,
  onProgress?: (msg: string) => void,
  acao: 'download' | 'print' = 'download'
): Promise<void> {
  onProgress?.('Preparando estrutura do PDF...');

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const pageMargin = 12;
  const usableWidth = pageWidth - pageMargin * 2;
  const rightMarginX = pageWidth - pageMargin;

  // 1. Logotipo da Oficina
  let logoBase64: string | null = null;
  if (data.oficinaLogoUrl) {
    onProgress?.('Carregando logotipo...');
    try {
      logoBase64 = await fetchImageAsBase64(data.oficinaLogoUrl);
    } catch (e) {
      console.error('[PDFOrcamento] Erro ao carregar logo:', e);
    }
  }

  const codProposta = formatarCodigoProposta(data);

  // Renderiza cabeçalho oficial
  let y = cabecalhoDocumento(doc, {
    logoBase64: logoBase64 || undefined,
    oficinaNome: data.oficinaNome,
    oficinaRazaoSocial: data.oficinaRazaoSocial || undefined,
    oficinaDocumento: data.oficinaDocumento || undefined,
    oficinaDocumentoTipo: data.oficinaDocumentoTipo || undefined,
    oficinaTelefone: data.oficinaTelefone || undefined,
    oficinaCidadeUF: data.oficinaCidadeUF || undefined,
    documentoTitulo: `PROPOSTA COMERCIAL ${codProposta}`,
    documentoSubtitulo: `Validade da Proposta: ${data.validade_dias || 7} dias`,
    dataEmissao: data.enviado_em
      ? `${formatarData(data.enviado_em)} ${formatarHora(data.enviado_em)}`
      : `${formatarData(new Date().toISOString())} ${formatarHora(new Date().toISOString())}`,
    statusBadge: data.status === 'aprovado' ? 'STATUS: APROVADO' : 'PROPOSTA COMERCIAL',
    numeroOS: data.numero_os || undefined,
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

  // Detector de Fundo Claro vs Escuro para Alto Contraste Automático
  const lumFundoSecoes = (0.299 * corFundoSecoesRgb[0] + 0.587 * corFundoSecoesRgb[1] + 0.114 * corFundoSecoesRgb[2]) / 255;
  const isLightSecoes = lumFundoSecoes > 0.65;

  // Cor do Texto Principal: respeita a cor escolhida pelo usuário ou adapta automaticamente
  const corTextoPrincipal: [number, number, number] = data.pdfCorTextoSecoes
    ? hexToRgb(data.pdfCorTextoSecoes, isLightSecoes ? [15, 23, 42] : [255, 255, 255])
    : (isLightSecoes ? [15, 23, 42] : [255, 255, 255]);

  const lumTexto = (0.299 * corTextoPrincipal[0] + 0.587 * corTextoPrincipal[1] + 0.114 * corTextoPrincipal[2]) / 255;
  const isTextoEscuro = lumTexto < 0.5;

  const corTextoSecundario: [number, number, number] = isTextoEscuro ? [82, 82, 91] : [203, 213, 225];
  const corBordaCard: [number, number, number] = isLightSecoes ? [203, 213, 225] : [63, 63, 70];
  const corLinhaPar: [number, number, number] = isLightSecoes ? [248, 250, 252] : [28, 28, 32];
  const corLinhaImpar: [number, number, number] = isLightSecoes ? [255, 255, 255] : [34, 34, 39];
  const corHeaderNivelBg: [number, number, number] = isLightSecoes ? [241, 245, 249] : [20, 20, 24];

  // Preço com contraste garantido no claro ou escuro
  const corDestaquePreco: [number, number, number] = isLightSecoes
    ? (corPrimariaRgb[0] > 200 && corPrimariaRgb[1] > 180 ? [180, 83, 9] : corPrimariaRgb)
    : [251, 191, 36];

  // 2. Bloco Cliente e Veículo Unificado
  doc.setFillColor(corFundoSecoesRgb[0], corFundoSecoesRgb[1], corFundoSecoesRgb[2]);
  doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
  doc.setLineWidth(0.25);
  doc.roundedRect(pageMargin, y, usableWidth, 20, 2, 2, 'FD');

  // Coluna Cliente
  doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text('DADOS DO CLIENTE', pageMargin + 5, y + 5.5);

  doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.text(`Nome: ${data.clienteNome}`, pageMargin + 5, y + 11);
  doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
  doc.text(`Telefone: ${data.clienteTelefone || 'Não informado'}`, pageMargin + 5, y + 15.5);

  // Separador vertical sutil entre colunas
  const colCentroX = pageMargin + 92;
  doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
  doc.setLineWidth(0.15);
  doc.line(colCentroX - 6, y + 3, colCentroX - 6, y + 17);

  // Coluna Veículo
  doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text('DADOS DO VEÍCULO', colCentroX, y + 5.5);

  doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.text(`Modelo: ${data.veiculoModelo || 'Não informado'}`, colCentroX, y + 11);
  const placaTxt = data.veiculoPlaca ? data.veiculoPlaca.toUpperCase() : 'Não informada';
  const catTxt = data.categoriaNome ? ` • ${data.categoriaNome}` : '';
  doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
  doc.text(`Placa: ${placaTxt}${catTxt}`, colCentroX, y + 15.5);

  y += 24;

  // 3. Níveis de Proposta (Cartões Unificados e Estruturados)
  onProgress?.('Renderizando opções de proposta...');
  const niveisParaExibir = data.niveis && data.niveis.length > 0 ? data.niveis : [];

  for (let idx = 0; idx < niveisParaExibir.length; idx++) {
    const nivel = niveisParaExibir[idx];
    const isAprovado = data.nivel_aprovado === nivel.nivel;
    const itens = nivel.itens || [];

    const headerHeight = 9.5;
    const descHeight = nivel.descricao ? 5 : 0;
    const itemRowHeight = 6.2;
    const itemsHeight = itens.length * itemRowHeight;
    const cardTotalHeight = headerHeight + descHeight + itemsHeight + 2;

    // Quebra de página inteligente caso o cartão não caiba
    if (y + cardTotalHeight > 275) {
      doc.addPage();
      y = 15;
    }

    // Fundo do Cartão Unificado + Borda
    doc.setFillColor(corFundoSecoesRgb[0], corFundoSecoesRgb[1], corFundoSecoesRgb[2]);
    doc.setDrawColor(isAprovado ? 16 : corBordaCard[0], isAprovado ? 185 : corBordaCard[1], isAprovado ? 129 : corBordaCard[2]);
    doc.setLineWidth(isAprovado ? 0.45 : 0.25);
    doc.roundedRect(pageMargin, y, usableWidth, cardTotalHeight, 2, 2, 'FD');

    // Se aprovado, desenha barra de destaque lateral verde
    if (isAprovado) {
      doc.setFillColor(16, 185, 129);
      doc.roundedRect(pageMargin, y, 2.5, cardTotalHeight, 1, 1, 'F');
    }

    // Barra de Cabeçalho do Cartão
    doc.setFillColor(corHeaderNivelBg[0], corHeaderNivelBg[1], corHeaderNivelBg[2]);
    doc.roundedRect(pageMargin + (isAprovado ? 2.5 : 0), y, usableWidth - (isAprovado ? 2.5 : 0), headerHeight, 1.5, 1.5, 'F');

    // Título do Nível
    doc.setTextColor(isAprovado ? 16 : corDestaquePreco[0], isAprovado ? 185 : corDestaquePreco[1], isAprovado ? 129 : corDestaquePreco[2]);
    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'bold');
    const aprovadoBadge = isAprovado ? '✓ [OPÇÃO APROVADA] ' : '';
    doc.text(`${aprovadoBadge}${nivel.titulo.toUpperCase()}`, pageMargin + 5, y + 6.2);

    // Preço Total do Nível
    doc.setFontSize(10.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
    doc.text(formatarMoeda(nivel.valor_total), rightMarginX - 5, y + 6.5, { align: 'right' });

    let currentCardY = y + headerHeight;

    // Subtítulo / Descrição dentro do cartão
    if (nivel.descricao) {
      doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text(nivel.descricao, pageMargin + 5, currentCardY + 3.8);
      currentCardY += descHeight;
    }

    // Linhas de Serviços dentro do cartão
    if (itens.length > 0) {
      itens.forEach((item, itemIdx) => {
        const isEven = itemIdx % 2 === 0;
        const rowBg = isEven ? corLinhaPar : corLinhaImpar;

        doc.setFillColor(rowBg[0], rowBg[1], rowBg[2]);
        doc.rect(pageMargin + (isAprovado ? 2.5 : 0.2), currentCardY, usableWidth - (isAprovado ? 2.7 : 0.4), itemRowHeight, 'F');

        // Linha divisória sutil
        doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
        doc.setLineWidth(0.15);
        doc.line(pageMargin + 4, currentCardY, rightMarginX - 4, currentCardY);

        // Nome do serviço
        doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.text(`• ${item.servico_nome}`, pageMargin + 5, currentCardY + 4.2);

        // Preço do serviço
        if (item.preco) {
          doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8);
          doc.text(formatarMoeda(item.preco), rightMarginX - 5, currentCardY + 4.2, { align: 'right' });
        }

        currentCardY += itemRowHeight;
      });
    }

    // Espaçamento consistente entre níveis
    y += cardTotalHeight + 4.5;
  }

  // 4. Observações Gerais (Somente se houver texto preenchido)
  const obsTextoGlobal = (data.observacoes || '').trim();
  if (obsTextoGlobal) {
    const splitObs = doc.splitTextToSize(obsTextoGlobal, usableWidth - 10);
    const boxHeight = Math.max(12, 7 + splitObs.length * 4);

    if (y + boxHeight > 275) {
      doc.addPage();
      y = 15;
    }

    doc.setFillColor(corFundoSecoesRgb[0], corFundoSecoesRgb[1], corFundoSecoesRgb[2]);
    doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
    doc.setLineWidth(0.25);
    doc.roundedRect(pageMargin, y, usableWidth, boxHeight, 1.5, 1.5, 'FD');

    doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('OBSERVAÇÕES GERAIS:', pageMargin + 5, y + 5);

    doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    splitObs.forEach((line: string, idx: number) => {
      doc.text(line, pageMargin + 5, y + 9.5 + idx * 3.8);
    });

    y += boxHeight + 4.5;
  }

  // 5. Fotos de Avaliação (Antes e Depois)
  if (data.incluirFotos !== false && data.fotos && data.fotos.length > 0) {
    onProgress?.('Renderizando fotos de avaliação (antes e depois)...');

    const fotosAntes = data.fotos.filter((f) => f.tipo === 'antes' || !f.tipo);
    const fotosDepois = data.fotos.filter((f) => f.tipo === 'depois');

    const renderGrupoFotos = async (titulo: string, fotosLista: typeof data.fotos) => {
      if (!fotosLista || fotosLista.length === 0) return;

      if (y + 40 > 275) {
        doc.addPage();
        y = 15;
      }

      doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      doc.text(titulo, pageMargin, y);
      y += 4.5;

      const photosPerRow = 3;
      const gap = 4;
      const boxWidth = (usableWidth - gap * (photosPerRow - 1)) / photosPerRow;
      const boxHeight = boxWidth * 0.7;

      let photoX = pageMargin;
      let photoY = y;

      for (let i = 0; i < fotosLista.length; i++) {
        const f = fotosLista[i];
        if (photoY + boxHeight + 12 > 280) {
          doc.addPage();
          photoY = 15;
          photoX = pageMargin;
        }

        try {
          let base64 = '';
          if (f.url && f.url.startsWith('data:')) {
            base64 = f.url;
          } else if (f.path) {
            const signed = await getEvidenciaSignedUrl(f.path);
            if (signed) base64 = await fetchImageAsBase64(signed);
          }
          if (!base64 && f.url && f.url.startsWith('http')) {
            base64 = await fetchImageAsBase64(f.url);
          }
          if (!base64 && f.url) {
            const signed = await getEvidenciaSignedUrl(f.url);
            if (signed) base64 = await fetchImageAsBase64(signed);
          }

          if (base64) {
            // Fundo suave neutro para moldura da foto sem faixa preta
            doc.setFillColor(isLightSecoes ? 245 : 24, isLightSecoes ? 247 : 24, isLightSecoes ? 250 : 28);
            doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
            doc.setLineWidth(0.2);
            doc.roundedRect(photoX, photoY, boxWidth, boxHeight, 1.5, 1.5, 'FD');
            await drawProportionalImage(doc, base64, 'JPEG', photoX, photoY, boxWidth, boxHeight);

            if (f.created_at) {
              doc.setFontSize(7);
              doc.setFont('helvetica', 'normal');
              doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
              const descExtra = f.descricao && !f.descricao.startsWith('[') ? ` · ${f.descricao}` : '';
              const horaTexto = `${formatarData(f.created_at)} ${formatarHora(f.created_at)}${descExtra}`;
              doc.text(horaTexto, photoX + boxWidth / 2, photoY + boxHeight + 3.8, { align: 'center' });
            }
          }
        } catch (e) {
          console.error('[PDFOrcamento] Erro ao carregar foto:', e);
        }

        if ((i + 1) % photosPerRow === 0) {
          photoX = pageMargin;
          photoY += boxHeight + 8.5;
        } else {
          photoX += boxWidth + gap;
        }
      }

      y = photoY + (fotosLista.length % photosPerRow !== 0 ? boxHeight + 8.5 : 2);
    };

    if (fotosAntes.length > 0 && fotosDepois.length > 0) {
      await renderGrupoFotos(`FOTOS ANTES · AVALIAÇÃO INICIAL DO VEÍCULO (${fotosAntes.length})`, fotosAntes);
      await renderGrupoFotos(`FOTOS DEPOIS · RESULTADO DOS SERVIÇOS EXECUTADOS (${fotosDepois.length})`, fotosDepois);
    } else if (fotosDepois.length > 0) {
      await renderGrupoFotos(`FOTOS DEPOIS · RESULTADO DOS SERVIÇOS (${fotosDepois.length})`, fotosDepois);
    } else {
      await renderGrupoFotos(`FOTOS E EVIDÊNCIAS DE AVALIAÇÃO DO VEÍCULO (${fotosAntes.length})`, fotosAntes);
    }
  }

  // 6. Termos de Garantia (se marcado incluirTermos)
  if (data.incluirTermos && data.termosGarantia && data.termosGarantia.trim()) {
    const splitTermos = doc.splitTextToSize(data.termosGarantia.trim(), usableWidth - 10);
    const termosBoxH = Math.max(14, 7 + splitTermos.length * 3.8);

    if (y + termosBoxH > 275) {
      doc.addPage();
      y = 15;
    }

    doc.setFillColor(corFundoSecoesRgb[0], corFundoSecoesRgb[1], corFundoSecoesRgb[2]);
    doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
    doc.setLineWidth(0.25);
    doc.roundedRect(pageMargin, y, usableWidth, termosBoxH, 1.5, 1.5, 'FD');

    doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('TERMOS DE GARANTIA E CONDIÇÕES:', pageMargin + 5, y + 5);

    doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
    doc.setFontSize(7.2);
    doc.setFont('helvetica', 'normal');
    splitTermos.forEach((line: string, idx: number) => {
      doc.text(line, pageMargin + 5, y + 9.2 + idx * 3.6);
    });

    y += termosBoxH + 4.5;
  }

  // 7. Bloco de Assinaturas (Digital ou Linhas Físicas para Impressão Manual)
  const temAssinaturaDigital = Boolean(data.assinaturaUrl || data.assinaturaUsuarioUrl);

  if (temAssinaturaDigital) {
    onProgress?.('Iniciando renderização das assinaturas digitais...');
    if (y + 44 > 275) {
      doc.addPage();
      y = 15;
    }

    const boxH = 40;
    doc.setFillColor(corFundoSecoesRgb[0], corFundoSecoesRgb[1], corFundoSecoesRgb[2]);
    doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
    doc.setLineWidth(0.25);
    doc.roundedRect(pageMargin, y, usableWidth, boxH, 2, 2, 'FD');

    doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.text('ACEITE E VALIDAÇÃO DA PROPOSTA COMERCIAL', pageMargin + 5, y + 5.5);

    doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
    doc.setFontSize(7.2);
    doc.setFont('helvetica', 'italic');
    const termoAceite = '"Declaro que li e concordo com as condições, prazos e valores apresentados nesta proposta de orçamento."';
    doc.text(termoAceite, pageMargin + 5, y + 9.5);

    const colW = (usableWidth - 14) / 2;
    const col1X = pageMargin + 5;
    const col2X = pageMargin + 5 + colW + 4;
    const sigStartY = y + 12.5;
    const sigBoxH = 15;

    // COLUNA 1: ASSINATURA DO CLIENTE
    if (data.assinaturaUrl) {
      try {
        const assBase64 = await obterAssinaturaBase64(data.assinaturaUrl);
        if (assBase64) {
          doc.setFillColor(255, 255, 255);
          doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
          doc.roundedRect(col1X, sigStartY, colW, sigBoxH, 1, 1, 'FD');
          await drawProportionalImage(doc, assBase64, 'PNG', col1X, sigStartY, colW, sigBoxH);
        }
      } catch (e) {
        console.error('[PDFOrcamento] Erro ao renderizar assinatura do cliente:', e);
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
      doc.text(`Cliente: ${data.assinaturaNome || data.clienteNome}`, col1X, sigStartY + sigBoxH + 3.5);

      if (data.assinaturaData) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.8);
        doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
        doc.text(`Confirmado em: ${formatarData(data.assinaturaData)} às ${formatarHora(data.assinaturaData)}`, col1X, sigStartY + sigBoxH + 6.8);
      }
    } else {
      // Linha manual cliente
      doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
      doc.setLineWidth(0.3);
      doc.line(col1X, sigStartY + 10, col1X + colW, sigStartY + 10);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
      doc.text(data.clienteNome, col1X + colW / 2, sigStartY + 14, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
      doc.text('Assinatura do Cliente (Pendente)', col1X + colW / 2, sigStartY + 17.5, { align: 'center' });
    }

    // COLUNA 2: ASSINATURA DA OFICINA / RESPONSÁVEL
    if (data.assinaturaUsuarioUrl) {
      try {
        const assOficinaBase64 = await obterAssinaturaBase64(data.assinaturaUsuarioUrl);
        if (assOficinaBase64) {
          doc.setFillColor(255, 255, 255);
          doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
          doc.roundedRect(col2X, sigStartY, colW, sigBoxH, 1, 1, 'FD');
          await drawProportionalImage(doc, assOficinaBase64, 'PNG', col2X, sigStartY, colW, sigBoxH);
        }
      } catch (e) {
        console.error('[PDFOrcamento] Erro ao renderizar assinatura da oficina:', e);
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
      doc.text(`Oficina: ${data.assinaturaUsuarioNome || data.oficinaNome}`, col2X, sigStartY + sigBoxH + 3.5);

      if (data.assinadoUsuarioEm) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.8);
        doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
        doc.text(`Confirmado em: ${formatarData(data.assinadoUsuarioEm)} às ${formatarHora(data.assinadoUsuarioEm)}`, col2X, sigStartY + sigBoxH + 6.8);
      }
    } else {
      // Linha manual oficina
      doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
      doc.setLineWidth(0.3);
      doc.line(col2X, sigStartY + 10, col2X + colW, sigStartY + 10);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
      doc.text(data.assinaturaUsuarioNome || data.oficinaNome, col2X + colW / 2, sigStartY + 14, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
      doc.text('Responsável Técnico / Oficina', col2X + colW / 2, sigStartY + 17.5, { align: 'center' });
    }

    y += boxH + 4;
  } else {
    // Linhas de Assinatura Manual Dupla (Cliente e Oficina) para Via Impressa
    if (y + 34 > 275) {
      doc.addPage();
      y = 15;
    }

    doc.setFillColor(corFundoSecoesRgb[0], corFundoSecoesRgb[1], corFundoSecoesRgb[2]);
    doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
    doc.setLineWidth(0.25);
    doc.roundedRect(pageMargin, y, usableWidth, 32, 2, 2, 'FD');

    doc.setFontSize(7.2);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
    const termoTxt = '"Declaro que li e concordo com os valores, serviços discriminados e prazos estipulados nesta proposta de orçamento."';
    const splitTermo = doc.splitTextToSize(termoTxt, usableWidth - 10);
    splitTermo.forEach((line: string, idx: number) => {
      doc.text(line, pageMargin + 5, y + 5 + idx * 3.5);
    });

    const sigY = y + 13;
    const colW = (usableWidth - 16) / 2;

    // Assinatura Manual do Cliente
    doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
    doc.setLineWidth(0.3);
    doc.line(pageMargin + 5, sigY + 8, pageMargin + 5 + colW, sigY + 8);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
    doc.text(data.clienteNome, pageMargin + 5 + colW / 2, sigY + 12, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
    doc.text('Assinatura do Cliente', pageMargin + 5 + colW / 2, sigY + 15.5, { align: 'center' });

    // Assinatura do Responsável / Usuário
    const col2StartX = rightMarginX - 5 - colW;
    doc.line(col2StartX, sigY + 8, col2StartX + colW, sigY + 8);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
    doc.text(data.assinaturaUsuarioNome || data.oficinaNome, col2StartX + colW / 2, sigY + 12, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
    doc.text('Responsável Técnico / Oficina', col2StartX + colW / 2, sigY + 15.5, { align: 'center' });

    y += 36;
  }

  onProgress?.('Finalizando PDF do orçamento...');
  const nomeArquivo = `orcamento_${data.veiculoPlaca ? data.veiculoPlaca.toUpperCase() : 'proposta'}_${codProposta.replace('#', '')}.pdf`;

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
