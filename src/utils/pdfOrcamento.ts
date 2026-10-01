import jsPDF from 'jspdf';
import { formatarData, formatarHora } from './datas';
import { formatarMoeda, formatarCodigoProposta } from './formatters';
import { fetchImageAsBase64, obterAssinaturaBase64, getEvidenciaSignedUrl } from './evidencias';
import { cabecalhoDocumento, rodapeDocumento, hexToRgb } from './pdf';
import { formatarDuracao } from './agenda';
import type { TipoNivelOrcamento } from '../types/orcamento';
import { 
  TERMO_RESPONSABILIDADE_PADRAO, 
  TERMO_GARANTIA_PADRAO_ADVOGADO, 
  preencherVariaveisTermo,
  gerarTermoDinamicoServicos,
  type ServicoParaTermo,
} from '../types/termos';

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
  modo_orcamento?: 'simples' | '3_niveis' | string | null;
  
  // Cliente & Veículo
  clienteNome: string;
  clienteTelefone?: string | null;
  clienteCpfCnpj?: string | null;
  clienteEmail?: string | null;
  clienteEndereco?: string | null;
  veiculoModelo?: string | null;
  veiculoMarca?: string | null;
  veiculoPlaca?: string | null;
  veiculoCor?: string | null;
  veiculoAno?: number | string | null;
  veiculoKm?: number | string | null;
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
  incluirTermoResponsabilidade?: boolean;
  incluirTermoGarantia?: boolean;
  garantiaMeses?: number | null;
  termosGarantia?: string | null;
  termoResponsabilidade?: string | null;

  // Termo de Ciência e Autorização com Risco Específico (Folha Separada)
  incluirTermoRisco?: boolean;
  termoRiscoServico?: string | null;
  termoRiscoObservacoes?: string | null;
  termoRiscoTexto?: string | null;

  // Assinatura do Usuário/Oficina
  assinaturaUsuarioUrl?: string | null;
  assinaturaUsuarioNome?: string | null;
  assinadoUsuarioEm?: string | null;

  // Branding Customizado
  planoCodigo?: string | null;
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
  const diasValidade = data.validade_dias || 7;
  let dataValidadeLimiteStr = data.data_validade_limite;
  if (!dataValidadeLimiteStr) {
    const baseDt = data.enviado_em ? new Date(data.enviado_em) : new Date();
    baseDt.setDate(baseDt.getDate() + diasValidade);
    dataValidadeLimiteStr = baseDt.toISOString().split('T')[0];
  }
  const validadeTextoCompleto = `Válido até ${formatarData(dataValidadeLimiteStr)} (${diasValidade} dias)`;

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
    documentoSubtitulo: validadeTextoCompleto,
    validadeTexto: validadeTextoCompleto,
    dataEmissao: data.enviado_em
      ? `${formatarData(data.enviado_em)} ${formatarHora(data.enviado_em)}`
      : `${formatarData(new Date().toISOString())} ${formatarHora(new Date().toISOString())}`,
    statusBadge: data.status === 'aprovado' ? 'STATUS: APROVADO' : 'PROPOSTA COMERCIAL',
    numeroOS: data.numero_os || undefined,
    planoCodigo: data.planoCodigo || undefined,
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

  // 2. Bloco Cliente e Veículo Unificado (com Validade)
  doc.setFillColor(corFundoSecoesRgb[0], corFundoSecoesRgb[1], corFundoSecoesRgb[2]);
  doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
  doc.setLineWidth(0.25);
  doc.roundedRect(pageMargin, y, usableWidth, 24, 2, 2, 'FD');

  // Coluna Cliente
  doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text('DADOS DO CLIENTE', pageMargin + 5, y + 5.5);

  doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.text(`Nome: ${data.clienteNome}`, pageMargin + 5, y + 10.5);
  doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
  doc.text(`Telefone: ${data.clienteTelefone || 'Não informado'}`, pageMargin + 5, y + 15);

  // Separador vertical sutil entre colunas
  const colCentroX = pageMargin + 92;
  doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
  doc.setLineWidth(0.15);
  doc.line(colCentroX - 6, y + 3, colCentroX - 6, y + 15.5);

  // Coluna Veículo
  doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text('DADOS DO VEÍCULO', colCentroX, y + 5.5);

  doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.text(`Modelo: ${data.veiculoModelo || 'Não informado'}`, colCentroX, y + 10.5);
  const placaTxt = data.veiculoPlaca ? data.veiculoPlaca.toUpperCase() : 'Não informada';
  const catTxt = data.categoriaNome ? ` • ${data.categoriaNome}` : '';
  const corTxt = ` • Cor: ${data.veiculoCor?.trim() || 'Não informada'}`;
  doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
  doc.text(`Placa: ${placaTxt}${catTxt}${corTxt}`, colCentroX, y + 15);

  // Linha divisória horizontal para a Validade da Proposta
  doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
  doc.setLineWidth(0.15);
  doc.line(pageMargin + 5, y + 17.5, rightMarginX - 5, y + 17.5);

  doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.text('PRAZO DE VALIDADE DA PROPOSTA:', pageMargin + 5, y + 21.5);
  doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
  doc.setFont('helvetica', 'normal');
  doc.text(validadeTextoCompleto, pageMargin + 60, y + 21.5);

  y += 28;

  // 3. Níveis de Proposta (Cartões Unificados e Estruturados)
  onProgress?.('Renderizando opções de proposta...');
  const isModoSimples = data.modo_orcamento === 'simples' || data.niveis.length === 1;
  const niveisParaExibir = isModoSimples
    ? (data.niveis && data.niveis.filter((n) => n.nivel === 'essencial').length > 0
        ? data.niveis.filter((n) => n.nivel === 'essencial')
        : (data.niveis && data.niveis.length > 0 ? [data.niveis[0]] : []))
    : (data.niveis && data.niveis.length > 0 ? data.niveis : []);

  for (let idx = 0; idx < niveisParaExibir.length; idx++) {
    const nivel = niveisParaExibir[idx];
    const isAprovado = isModoSimples
      ? (data.status === 'aprovado' || data.status === 'em_andamento' || data.status === 'concluido' || data.nivel_aprovado === nivel.nivel)
      : (data.nivel_aprovado === nivel.nivel);
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
    const duracaoNivel = nivel.duracao_total || (itens || []).reduce((acc, it) => acc + (it.duracao_minutos || 0), 0);
    const duracaoTextoNivel = duracaoNivel > 0 ? ` • ${formatarDuracao(duracaoNivel)}` : '';
    const aprovadoBadge = isAprovado ? (isModoSimples ? '[PROPOSTA APROVADA] ' : '[OPÇÃO APROVADA] ') : '';
    const tituloNivelTexto = isModoSimples && (!nivel.titulo || nivel.titulo.toLowerCase() === 'essencial')
      ? 'PROPOSTA DE SERVIÇOS'
      : nivel.titulo.toUpperCase();
    doc.text(`${aprovadoBadge}${tituloNivelTexto}${duracaoTextoNivel}`, pageMargin + 5, y + 6.2);

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

        // Nome do serviço e duração estimada
        const duracaoItemTxt = item.duracao_minutos && item.duracao_minutos > 0 ? ` [${formatarDuracao(item.duracao_minutos)}]` : '';
        let textoServico = `• ${item.servico_nome}${duracaoItemTxt}`;
        const maxLarguraTexto = usableWidth - 40;
        if (doc.getTextWidth(textoServico) > maxLarguraTexto) {
          while (doc.getTextWidth(textoServico + '...') > maxLarguraTexto && textoServico.length > 5) {
            textoServico = textoServico.slice(0, -1);
          }
          textoServico = textoServico + '...';
        }

        doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.text(textoServico, pageMargin + 5, currentCardY + 4.2);

        // Preço do serviço
        if (typeof item.preco === 'number') {
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

    const fotosAntes = data.fotos.filter((f) => 
      f.tipo === 'antes' || 
      (f.descricao && f.descricao.includes('[ANTES]')) ||
      (!f.tipo && (!f.descricao || !f.descricao.includes('[DEPOIS]')))
    );
    const fotosDepois = data.fotos.filter((f) => 
      f.tipo === 'depois' || 
      (f.descricao && f.descricao.includes('[DEPOIS]'))
    );

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

            // Carimbo identificador do momento da foto (ANTES vs DEPOIS)
            const ehDepois = f.tipo === 'depois' || (f.descricao && f.descricao.includes('[DEPOIS]'));
            const carimboTexto = ehDepois ? 'DEPOIS' : 'ANTES';
            const badgeW = 16;
            const badgeH = 4.2;
            const badgeX = photoX + 2;
            const badgeY = photoY + 2;

            doc.setFillColor(ehDepois ? 6 : 15, ehDepois ? 78 : 23, ehDepois ? 59 : 42);
            doc.setDrawColor(ehDepois ? 52 : 34, ehDepois ? 211 : 211, ehDepois ? 153 : 238);
            doc.setLineWidth(0.25);
            doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 0.8, 0.8, 'FD');

            doc.setTextColor(ehDepois ? 52 : 34, ehDepois ? 211 : 211, ehDepois ? 153 : 238);
            doc.setFontSize(6.2);
            doc.setFont('helvetica', 'bold');
            doc.text(carimboTexto, badgeX + badgeW / 2, badgeY + 3.0, { align: 'center' });

            if (f.created_at) {
              doc.setFontSize(7);
              doc.setFont('helvetica', 'normal');
              doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
              const descLimpa = f.descricao ? f.descricao.replace(/\[ANTES\]/g, '').replace(/\[DEPOIS\]/g, '').trim() : '';
              const descExtra = descLimpa ? ` - ${descLimpa}` : '';
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
      await renderGrupoFotos(`FOTOS DE ENTRADA (ESTADO ANTERIOR - VISTORIA) - ${fotosAntes.length} ${fotosAntes.length === 1 ? 'REGISTRO' : 'REGISTROS'}`, fotosAntes);
      await renderGrupoFotos(`FOTOS DE SAÍDA / CONCLUSÃO (DEPOIS DOS SERVIÇOS) - ${fotosDepois.length} ${fotosDepois.length === 1 ? 'REGISTRO' : 'REGISTROS'}`, fotosDepois);
    } else if (fotosDepois.length > 0) {
      await renderGrupoFotos(`FOTOS DE SAÍDA / CONCLUSÃO (DEPOIS DOS SERVIÇOS) - ${fotosDepois.length} ${fotosDepois.length === 1 ? 'REGISTRO' : 'REGISTROS'}`, fotosDepois);
    } else {
      await renderGrupoFotos(`FOTOS DE ENTRADA (ESTADO ANTERIOR - VISTORIA) - ${fotosAntes.length} ${fotosAntes.length === 1 ? 'REGISTRO' : 'REGISTROS'}`, fotosAntes);
    }
  }

  // 6. Termos Contratuais (Responsabilidade e Garantia)
  // SE a emissão em folha separada (Anexo CDC - data.incluirTermoRisco) estiver ATIVA,
  // o Termo de Responsabilidade & Riscos Técnicos é emitido exclusivamente no Anexo Dedicado (Seção 8),
  // evitando duplicidade do mesmo texto na proposta e no anexo, e mantendo a proposta comercial em 1 página.
  const deveIncluirResp = (
    data.incluirTermoResponsabilidade !== undefined
      ? data.incluirTermoResponsabilidade
      : (data.incluirTermos !== false)
  ) && !data.incluirTermoRisco;

  const deveIncluirGar = data.incluirTermoGarantia !== undefined
    ? data.incluirTermoGarantia
    : (data.incluirTermos !== false);

  // 6.1 Termo Fixo de Responsabilidade & Falhas Ocultas (Geral da Oficina ou Dinâmico por Serviços)
  if (deveIncluirResp) {
    let textoResp = (data.termoResponsabilidade && data.termoResponsabilidade.trim()) || TERMO_RESPONSABILIDADE_PADRAO;

    // Se o termo for o padrão estático ou não possuir as cláusulas técnicas dos serviços da proposta, enriquece dinamicamente
    if (
      !textoResp ||
      textoResp.trim() === TERMO_RESPONSABILIDADE_PADRAO.trim() ||
      !textoResp.includes('CONDIÇÕES TÉCNICAS E RISCOS ESPECÍFICOS')
    ) {
      const servicosExtraidos: ServicoParaTermo[] = [];
      const nomesVistos = new Set<string>();

      // Se houver nível aprovado, prioriza os itens dele, senão usa todos os itens dos níveis da proposta
      const niveisFiltrados = data.nivel_aprovado
        ? data.niveis.filter((n) => n.nivel === data.nivel_aprovado)
        : data.niveis;

      (niveisFiltrados.length > 0 ? niveisFiltrados : data.niveis).forEach((n) => {
        (n.itens || []).forEach((it) => {
          const nome = it.servico_nome?.trim();
          if (nome && !nomesVistos.has(nome.toLowerCase())) {
            nomesVistos.add(nome.toLowerCase());
            servicosExtraidos.push({
              nome,
              grupo: undefined,
              riscos_especificos_padrao: null,
            });
          }
        });
      });

      if (servicosExtraidos.length > 0) {
        const veicStr = `${data.veiculoModelo || 'Veículo'}${data.veiculoMarca ? ` (${data.veiculoMarca})` : ''} - Placa: ${data.veiculoPlaca || 'N/I'}`;
        const textoDinamico = gerarTermoDinamicoServicos(servicosExtraidos, {
          nomeEmpresa: data.oficinaRazaoSocial || data.oficinaNome || 'Oficina Especializada',
          prazoGarantia: `${data.garantiaMeses || 3} meses`,
          servicoContratado: servicosExtraidos.map((s) => s.nome).join(', '),
          clienteNome: data.clienteNome || '',
          clienteCpf: data.clienteCpfCnpj || '',
          veiculoPlaca: veicStr,
          data: formatarData(data.enviado_em || new Date().toISOString()),
        });
        if (textoDinamico && textoDinamico.includes('CONDIÇÕES TÉCNICAS E RISCOS ESPECÍFICOS')) {
          textoResp = textoDinamico;
        }
      }
    }

    if (textoResp) {
      const splitResp = doc.splitTextToSize(textoResp.trim(), usableWidth - 10);
      const respBoxH = Math.max(14, 7 + splitResp.length * 3.6);

      if (y + respBoxH > 275) {
        doc.addPage();
        y = 15;
      }

      doc.setFillColor(corFundoSecoesRgb[0], corFundoSecoesRgb[1], corFundoSecoesRgb[2]);
      doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
      doc.setLineWidth(0.25);
      doc.roundedRect(pageMargin, y, usableWidth, respBoxH, 1.5, 1.5, 'FD');

      doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.text('TERMO DE RESPONSABILIDADE, FALHAS OCULTAS E CONDIÇÕES GERAIS:', pageMargin + 5, y + 5);

      doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
      doc.setFontSize(6.8);
      doc.setFont('helvetica', 'normal');
      splitResp.forEach((line: string, idx: number) => {
        doc.text(line, pageMargin + 5, y + 8.8 + idx * 3.4);
      });

      y += respBoxH + 3.5;
    }
  }

  // 6.2 Termo de Garantia do Serviço (Padrão com Prazo Selecionado e Exclusões)
  if (deveIncluirGar) {
    const prazoStr = data.garantiaMeses ? `${data.garantiaMeses} ${data.garantiaMeses === 1 ? 'mês' : 'meses'}` : '3 meses';
    let textoBaseGarantia = (data.termosGarantia && data.termosGarantia.trim()) || TERMO_GARANTIA_PADRAO_ADVOGADO;

    // Se for o texto padrão geral do CDC e houver serviços especializados de proteção, anexa as exclusões e cuidados técnicos
    if (
      (!data.termosGarantia || data.termosGarantia.trim() === TERMO_GARANTIA_PADRAO_ADVOGADO.trim()) &&
      data.niveis && data.niveis.length > 0
    ) {
      const todosNomes = data.niveis
        .flatMap((n) => (n.itens || []).map((i) => (i.servico_nome || '').toLowerCase()))
        .join(' ');

      const condicoesExtras: string[] = [];
      if (todosNomes.includes('vitrific') || todosNomes.includes('coating') || todosNomes.includes('ceramico')) {
        condicoesExtras.push('CUIDADOS DE GARANTIA PARA VITRIFICAÇÃO / COATING: Respeitar 7 dias de cura inicial sem lavagem química; utilizar exclusivamente shampoo de pH neutro e realizar revisões semestrais na oficina.');
      }
      if (todosNomes.includes('insulfilm') || todosNomes.includes('pelicula') || todosNomes.includes('película')) {
        condicoesExtras.push('CUIDADOS DE GARANTIA PARA PELÍCULAS: É estritamente proibido acionar ou abaixar os vidros nas primeiras 72 horas para cura da fixação da cola.');
      }
      if (todosNomes.includes('ppf')) {
        condicoesExtras.push('CUIDADOS DE GARANTIA PARA PPF: Não utilizar lavadoras de alta pressão com jato pontual a menos de 50cm das quinas e bordas da película.');
      }

      if (condicoesExtras.length > 0) {
        textoBaseGarantia = `${textoBaseGarantia}\n\n${condicoesExtras.join('\n')}`;
      }
    }

    const textoFinalGarantia = preencherVariaveisTermo(textoBaseGarantia, {
      nomeEmpresa: data.oficinaRazaoSocial || data.oficinaNome,
      prazoGarantia: prazoStr,
    });

    const splitTermos = doc.splitTextToSize(textoFinalGarantia.trim(), usableWidth - 10);
    const termosBoxH = Math.max(14, 7 + splitTermos.length * 3.6);

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
    doc.text(`TERMO DE GARANTIA DO SERVIÇO (${prazoStr.toUpperCase()}):`, pageMargin + 5, y + 5);

    doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
    doc.setFontSize(6.8);
    doc.setFont('helvetica', 'normal');
    splitTermos.forEach((line: string, idx: number) => {
      doc.text(line, pageMargin + 5, y + 8.8 + idx * 3.4);
    });

    y += termosBoxH + 4;
  }

  // 7. Bloco de Assinaturas (Digital ou Linhas Físicas para Impressão Manual)
  const temAssinaturaDigital = Boolean(data.assinaturaUrl || data.assinaturaUsuarioUrl);

  if (temAssinaturaDigital) {
    onProgress?.('Iniciando renderização das assinaturas digitais...');

    doc.setFontSize(7.2);
    doc.setFont('helvetica', 'italic');
    const termoAceite = data.incluirTermoRisco
      ? '"Declaro que li e concordo com os valores, serviços discriminados e prazos estipulados nesta proposta. Condições técnicas e riscos específicos aceitos conforme Anexo Contratual emitido."'
      : '"Declaro que li e concordo com as condições, prazos e valores apresentados nesta proposta de orçamento."';
    const splitTermoAceite = doc.splitTextToSize(termoAceite, usableWidth - 10);
    const termoAceiteH = splitTermoAceite.length * 3.3;
    const sigBoxH = 15;
    const boxH = Math.max(38, 12 + termoAceiteH + sigBoxH + 8);

    if (y + boxH + 4 > 275) {
      doc.addPage();
      y = 15;
    }

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
    splitTermoAceite.forEach((line: string, idx: number) => {
      doc.text(line, pageMargin + 5, y + 9.5 + idx * 3.3);
    });

    const colW = (usableWidth - 14) / 2;
    const col1X = pageMargin + 5;
    const col2X = pageMargin + 5 + colW + 4;
    const sigStartY = y + 10.5 + termoAceiteH;

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
      const nomeCliExibir = doc.splitTextToSize(`Cliente: ${data.assinaturaNome || data.clienteNome}`, colW);
      doc.text(nomeCliExibir[0] || '', col1X, sigStartY + sigBoxH + 3.5);

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
      doc.text('Assinatura do Cliente', col1X + colW / 2, sigStartY + 17.5, { align: 'center' });
    }

    // COLUNA 2: OFICINA (DIGITAL OU SELO DE EMISSÃO)
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
    const termoTxt = data.incluirTermoRisco
      ? '"Declaro que li e concordo com os valores, serviços discriminados e prazos estipulados nesta proposta. Condições técnicas e riscos específicos aceitos conforme Anexo Contratual emitido."'
      : '"Declaro que li e concordo com os valores, serviços discriminados e prazos estipulados nesta proposta de orçamento."';
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

  // 8. TERMO DE CIÊNCIA E AUTORIZAÇÃO DE SERVIÇO COM RISCO ESPECÍFICO (FOLHA SEPARADA DEDICADA)
  if (data.incluirTermoRisco) {
    onProgress?.('Renderizando Termo de Risco em folha separada...');
    doc.addPage();
    let yRisco = 14;

    // Cores específicas para Documento Legal Impresso (Garantia de 100% de Contraste e Legibilidade no Papel)
    // NUNCA usar texto branco em folha A4 separada para impressão!
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
    const numRef = data.numero ? `#${formatarCodigoProposta(data)}` : (data.numero_os ? `OS #${data.numero_os}` : `#${data.id.substring(0, 8)}`);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(corDocAccent[0], corDocAccent[1], corDocAccent[2]);
    doc.text(`ANEXO CONTRATUAL AO ORÇAMENTO ${numRef} — INSTRUMENTO DE CONFORMIDADE COM A LEI Nº 8.078/1990 (CDC)`, pageMargin + 5, yRisco + 16.5);

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
    const cpfTxt = data.clienteCpfCnpj ? `CPF/CNPJ: ${data.clienteCpfCnpj}` : 'CPF/CNPJ: ____________________________________';
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
    const dataDoc = data.enviado_em ? formatarData(data.enviado_em) : new Date().toLocaleDateString('pt-BR');
    doc.text(`Data da Proposta/Emissão: ${dataDoc}`, col2X, linY5);

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

    // COLUNA CLIENTE
    if (data.assinaturaUrl) {
      try {
        const assBase64 = await obterAssinaturaBase64(data.assinaturaUrl);
        if (assBase64) {
          doc.setFillColor(255, 255, 255);
          doc.setDrawColor(corDocBorda[0], corDocBorda[1], corDocBorda[2]);
          doc.roundedRect(colCliX, yRisco, sigBoxW, 14, 1, 1, 'FD');
          await drawProportionalImage(doc, assBase64, 'PNG', colCliX, yRisco, sigBoxW, 14);
        }
      } catch (e) {
        console.error('[PDFOrcamento] Erro assinatura termo risco:', e);
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(corDocTextoDark[0], corDocTextoDark[1], corDocTextoDark[2]);
      doc.text(`Assinado Digitalmente: ${data.assinaturaNome || data.clienteNome}`, colCliX, yRisco + 18);
      if (data.assinaturaData) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.8);
        doc.setTextColor(corDocTextoMuted[0], corDocTextoMuted[1], corDocTextoMuted[2]);
        doc.text(`Aceite em: ${formatarData(data.assinaturaData)} às ${formatarHora(data.assinaturaData)}`, colCliX, yRisco + 22);
      }
    } else {
      doc.setDrawColor(corDocTextoDark[0], corDocTextoDark[1], corDocTextoDark[2]);
      doc.setLineWidth(0.35);
      doc.line(colCliX, yRisco + 12, colCliX + sigBoxW, yRisco + 12);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(corDocTextoDark[0], corDocTextoDark[1], corDocTextoDark[2]);
      doc.text(data.clienteNome || 'Cliente / Contratante', colCliX + sigBoxW / 2, yRisco + 16, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.setTextColor(corDocTextoMuted[0], corDocTextoMuted[1], corDocTextoMuted[2]);
      const docAssinatura = data.clienteCpfCnpj ? `CPF/CNPJ: ${data.clienteCpfCnpj}` : 'Assinatura / Aceite do Cliente';
      doc.text(docAssinatura, colCliX + sigBoxW / 2, yRisco + 19.5, { align: 'center' });
    }

    // COLUNA OFICINA
    if (data.assinaturaUsuarioUrl) {
      try {
        const assOficinaBase64 = await obterAssinaturaBase64(data.assinaturaUsuarioUrl);
        if (assOficinaBase64) {
          doc.setFillColor(255, 255, 255);
          doc.setDrawColor(corDocBorda[0], corDocBorda[1], corDocBorda[2]);
          doc.roundedRect(colOfiX, yRisco, sigBoxW, 14, 1, 1, 'FD');
          await drawProportionalImage(doc, assOficinaBase64, 'PNG', colOfiX, yRisco, sigBoxW, 14);
        }
      } catch (e) {
        console.error('[PDFOrcamento] Erro assinatura oficina termo risco:', e);
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(corDocTextoDark[0], corDocTextoDark[1], corDocTextoDark[2]);
      doc.text(`Confirmado por: ${data.assinaturaUsuarioNome || data.oficinaNome}`, colOfiX, yRisco + 18);
      if (data.assinadoUsuarioEm) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.8);
        doc.setTextColor(corDocTextoMuted[0], corDocTextoMuted[1], corDocTextoMuted[2]);
        doc.text(`Em: ${formatarData(data.assinadoUsuarioEm)} às ${formatarHora(data.assinadoUsuarioEm)}`, colOfiX, yRisco + 22);
      }
    } else {
      doc.setDrawColor(corDocTextoDark[0], corDocTextoDark[1], corDocTextoDark[2]);
      doc.setLineWidth(0.35);
      doc.line(colOfiX, yRisco + 12, colOfiX + sigBoxW, yRisco + 12);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(corDocTextoDark[0], corDocTextoDark[1], corDocTextoDark[2]);
      doc.text(data.assinaturaUsuarioNome || data.oficinaRazaoSocial || data.oficinaNome, colOfiX + sigBoxW / 2, yRisco + 16, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.setTextColor(corDocTextoMuted[0], corDocTextoMuted[1], corDocTextoMuted[2]);
      doc.text('Responsável Técnico / Oficina', colOfiX + sigBoxW / 2, yRisco + 19.5, { align: 'center' });
    }
  }

  // Rodapé padrão em todas as páginas
  const totalPaginas = doc.getNumberOfPages();
  for (let p = 1; p <= totalPaginas; p++) {
    doc.setPage(p);
    rodapeDocumento(doc, {
      planoCodigo: data.planoCodigo || undefined,
      pdfTextoRodape: data.pdfTextoRodape,
      pdfOcultarMarcaDagua: data.pdfOcultarMarcaDagua,
      paginaAtual: p,
      totalPaginas,
    });
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
