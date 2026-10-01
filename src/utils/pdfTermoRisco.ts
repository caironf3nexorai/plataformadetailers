import jsPDF from 'jspdf';
import { formatarData, formatarDataHora } from './datas';
import { formatarOS } from './formatters';
import { fetchImageAsBase64, obterAssinaturaBase64 } from './evidencias';
import { cabecalhoDocumento, rodapeDocumento, hexToRgb } from './pdf';

export interface PDFTermoRiscoFoto {
  url: string;
  descricao?: string;
  legenda?: string;
  momento?: 'antes' | 'durante' | string;
  dataHora?: string;
}

export interface PDFTermoRiscoData {
  oficinaNome: string;
  oficinaRazaoSocial?: string | null;
  oficinaDocumento?: string | null;
  oficinaDocumentoTipo?: 'cpf' | 'cnpj' | null;
  oficinaTelefone?: string | null;
  oficinaCidadeUF?: string | null;
  oficinaLogoUrl?: string;
  planoCodigo?: string;
  pdfCorPrimaria?: string | null;
  pdfCorFundoCabecalho?: string | null;
  pdfCorTextoCabecalho?: string | null;
  pdfCorFundoSecoes?: string | null;
  pdfCorTextoSecoes?: string | null;
  pdfSubtituloCabecalho?: string | null;
  pdfTextoRodape?: string | null;
  pdfOcultarMarcaDagua?: boolean | null;

  clienteNome: string;
  clienteDocumento?: string | null;
  clienteTelefone?: string | null;
  veiculoModelo: string;
  veiculoPlaca: string;
  veiculoCor?: string | null;
  numeroOS?: number | string | null;
  dataEmissao?: string | null;

  servicoNome: string;
  riscosObservacoes: string;
  assinaturaClienteNome?: string | null;
  assinaturaTecnicoNome?: string | null;
  responsavelNome?: string | null;

  // Dossiê Fotográfico Antes x Durante
  fotosAntes?: PDFTermoRiscoFoto[];
  fotosDurante?: PDFTermoRiscoFoto[];

  // Assinatura Digital do Cliente
  assinaturaDigitalUrl?: string | null;
  assinaturaDigitalNome?: string | null;
  assinaturaDigitalEm?: string | null;
}

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
  const scale = Math.min(boxWidth / (realW || 1), boxHeight / (realH || 1));

  const drawW = (realW || 1) * scale;
  const drawH = (realH || 1) * scale;

  const drawX = boxX + (boxWidth - drawW) / 2;
  const drawY = boxY + (boxHeight - drawH) / 2;

  doc.addImage(base64, format, drawX, drawY, drawW, drawH);

  return { drawWidth: drawW, drawHeight: drawH, drawX, drawY };
}

export async function gerarPDFTermoRisco(
  data: PDFTermoRiscoData,
  onProgress?: (status: string) => void,
  acao: 'download' | 'print' = 'download',
  imprimirDuasVias: boolean = true
): Promise<void> {
  onProgress?.('Iniciando PDF do Termo de Risco...');
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageMargin = 15;
  const usableWidth = pageWidth - pageMargin * 2;
  const rightMarginX = pageWidth - pageMargin;

  // 1. Carregar Logo
  let logoBase64: string | undefined = undefined;
  if (data.oficinaLogoUrl) {
    onProgress?.('Carregando logotipo...');
    try {
      logoBase64 = await fetchImageAsBase64(data.oficinaLogoUrl);
    } catch {
      logoBase64 = undefined;
    }
  }

  // 2. Carregar Assinatura Digital se houver
  let assinaturaCliBase64: string | undefined = undefined;
  if (data.assinaturaDigitalUrl) {
    onProgress?.('Carregando assinatura digital...');
    try {
      assinaturaCliBase64 = await obterAssinaturaBase64(data.assinaturaDigitalUrl);
    } catch {
      assinaturaCliBase64 = undefined;
    }
  }

  // 3. Cores
  const isFree = data.planoCodigo === 'free';
  const corPrimariaRgb = isFree
    ? ([228, 228, 231] as [number, number, number])
    : hexToRgb(data.pdfCorPrimaria, [245, 158, 11]);

  const corFundoSecoesRgb = isFree
    ? ([255, 255, 255] as [number, number, number])
    : hexToRgb(data.pdfCorFundoSecoes, [255, 255, 255]);

  const lumFundoSecoes =
    (0.299 * corFundoSecoesRgb[0] + 0.587 * corFundoSecoesRgb[1] + 0.114 * corFundoSecoesRgb[2]) / 255;
  const isLightSecoes = lumFundoSecoes > 0.65;

  const corTextoPrincipal: [number, number, number] = data.pdfCorTextoSecoes
    ? hexToRgb(data.pdfCorTextoSecoes, isLightSecoes ? [15, 23, 42] : [255, 255, 255])
    : isLightSecoes
    ? [15, 23, 42]
    : [255, 255, 255];

  const lumTexto =
    (0.299 * corTextoPrincipal[0] + 0.587 * corTextoPrincipal[1] + 0.114 * corTextoPrincipal[2]) / 255;
  const isTextoEscuro = lumTexto < 0.5;

  const corTextoSecundario: [number, number, number] = isTextoEscuro ? [82, 82, 91] : [203, 213, 225];
  const corBordaCard: [number, number, number] = isLightSecoes ? [203, 213, 225] : [63, 63, 70];
  const corDestaquePreco: [number, number, number] = isLightSecoes
    ? corPrimariaRgb[0] > 200 && corPrimariaRgb[1] > 180
      ? [180, 83, 9]
      : corPrimariaRgb
    : [251, 191, 36];

  const osFormatada = data.numeroOS ? formatarOS(Number(data.numeroOS)) : 'S/N';

  // Se já está assinado digitalmente, gera apenas 1 via oficial autenticada
  const isDigital = !!assinaturaCliBase64;
  const totalVias = isDigital ? 1 : (imprimirDuasVias ? 2 : 1);

  for (let via = 1; via <= totalVias; via++) {
    if (via > 1) {
      doc.addPage();
    }

    // 1. Cabeçalho Principal Oficial
    const subTituloCabecalho = data.pdfSubtituloCabecalho
      ? `${data.pdfSubtituloCabecalho} • TERMO DE RISCO`
      : 'TERMO DE CIÊNCIA E AUTORIZAÇÃO (CDC)';

    cabecalhoDocumento(doc, {
      oficinaNome: data.oficinaNome,
      oficinaRazaoSocial: data.oficinaRazaoSocial || undefined,
      oficinaDocumento: data.oficinaDocumento || undefined,
      oficinaDocumentoTipo: data.oficinaDocumentoTipo || undefined,
      oficinaCidadeUF: data.oficinaCidadeUF || undefined,
      oficinaTelefone: data.oficinaTelefone || undefined,
      logoBase64,
      documentoTitulo: 'TERMO DE RISCO ESPECÍFICO',
      documentoSubtitulo: subTituloCabecalho,
      dataEmissao: data.dataEmissao ? formatarData(data.dataEmissao) : new Date().toLocaleDateString('pt-BR'),
      numeroOS: data.numeroOS ? Number(data.numeroOS) : null,
      planoCodigo: data.planoCodigo,
      pdfCorPrimaria: data.pdfCorPrimaria,
      pdfCorFundoCabecalho: data.pdfCorFundoCabecalho,
      pdfCorTextoCabecalho: data.pdfCorTextoCabecalho,
      pdfSubtituloCabecalho: data.pdfSubtituloCabecalho,
    });

    let y = 39;

    // Badge Indicadora da Via ou Autenticação Digital
    const nomeVia = isDigital
      ? 'VIA DIGITAL AUTENTICADA — ASSINATURA ELETRÔNICA CDC'
      : via === 1
      ? '1ª VIA — OFICINA (ARQUIVO)'
      : '2ª VIA — CLIENTE / PROPRIETÁRIO';

    doc.setFillColor(corFundoSecoesRgb[0], corFundoSecoesRgb[1], corFundoSecoesRgb[2]);
    doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
    doc.setLineWidth(0.2);
    doc.roundedRect(pageMargin, y, usableWidth, 7, 1, 1, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
    doc.text(nomeVia, pageMargin + 4, y + 4.8);

    const docRef = data.numeroOS ? `Vinculado à OS #${osFormatada}` : 'Inspeção / Entrada Técnica';
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
    doc.text(docRef, rightMarginX - 4, y + 4.8, { align: 'right' });

    y += 10;

    // 2. Dados do Cliente e Veículo
    doc.setFillColor(corFundoSecoesRgb[0], corFundoSecoesRgb[1], corFundoSecoesRgb[2]);
    doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
    doc.setLineWidth(0.2);
    doc.roundedRect(pageMargin, y, usableWidth, 14, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
    const docCli = data.clienteDocumento ? `  |  CPF/CNPJ: ${data.clienteDocumento}` : '';
    const telCli = data.clienteTelefone ? `  |  Tel: ${data.clienteTelefone}` : '';
    doc.text(`Cliente: ${data.clienteNome}${docCli}${telCli}`, pageMargin + 4, y + 5.5);

    const veicStr = `${data.veiculoModelo || 'Veículo'}${data.veiculoPlaca ? ` - Placa: ${data.veiculoPlaca}` : ''}${
      data.veiculoCor ? ` - Cor: ${data.veiculoCor}` : ''
    }`;
    const dataStr = data.dataEmissao ? formatarData(data.dataEmissao) : new Date().toLocaleDateString('pt-BR');
    doc.text(`Veículo: ${veicStr}  |  Data da Notificação: ${dataStr}`, pageMargin + 4, y + 10.5);

    y += 18;

    // 3. Badge do Serviço Sujeito ao Risco
    doc.setFillColor(corFundoSecoesRgb[0], corFundoSecoesRgb[1], corFundoSecoesRgb[2]);
    doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
    doc.setLineWidth(0.2);
    doc.roundedRect(pageMargin, y, usableWidth, 8, 1.5, 1.5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
    doc.text(`Serviço Técnico Envolvido: ${data.servicoNome || 'Procedimento Técnico Especializado'}`, pageMargin + 4, y + 5.5);

    y += 12;

    // 4. Bloco Destacado: Riscos e Condições Preexistentes (Pós Pré-Lavagem / Inspeção)
    const riscosTexto =
      data.riscosObservacoes?.trim() ||
      'Condição preexistente e riscos técnicos informados e esclarecidos previamente ao cliente.';
    const splitRiscos = doc.splitTextToSize(riscosTexto, usableWidth - 10);
    const boxRiscosH = Math.max(18, 10 + splitRiscos.length * 3.8);

    doc.setFillColor(corFundoSecoesRgb[0], corFundoSecoesRgb[1], corFundoSecoesRgb[2]);
    doc.setDrawColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
    doc.setLineWidth(0.4);
    doc.roundedRect(pageMargin, y, usableWidth, boxRiscosH, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
    doc.text('RISCOS ESPECÍFICOS & VÍCIOS IDENTIFICADOS (PÓS PRÉ-LAVAGEM / INSPEÇÃO):', pageMargin + 5, y + 5.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
    splitRiscos.forEach((l: string, idx: number) => {
      doc.text(l, pageMargin + 5, y + 10 + idx * 3.8);
    });

    y += boxRiscosH + 6;

    // 5. Fundamentação Legal e Declaração de Ciência (Advogado / CDC)
    const p1 =
      'Declaro estar ciente de que o serviço acima possui riscos inerentes à sua execução, especialmente em razão do estado de conservação, manutenção e condições preexistentes do veículo.';
    const p2 = `Autorizo expressamente a ${
      data.oficinaRazaoSocial || data.oficinaNome
    } a realizar o serviço, reconhecendo que a empresa não poderá ser responsabilizada por falhas ou danos decorrentes exclusivamente de defeitos preexistentes ou ocultos, falta de manutenção, desgaste natural, reparos anteriores, adaptações, peças, vedações, chicotes, conectores, módulos ou componentes já danificados, vencidos ou deteriorados e não identificáveis em inspeção visual comum.`;
    const p3 =
      'A empresa compromete-se a executar o serviço com técnica, cautela e procedimentos adequados, permanecendo responsável pelos danos que forem comprovadamente decorrentes de defeito na própria prestação do serviço.';
    const p4 =
      'Declaro ter recebido previamente informações sobre os riscos e autorizo a execução nos termos dos arts. 6º, III; 8º; 14, §3º; 40; 46 e 54, §4º, do Código de Defesa do Consumidor – Lei nº 8.078/90.';

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);

    const renderP = (txt: string) => {
      const split = doc.splitTextToSize(txt, usableWidth);
      split.forEach((linha: string) => {
        doc.text(linha, pageMargin, y);
        y += 3.7;
      });
      y += 1.8;
    };

    renderP(p1);
    renderP(p2);
    renderP(p3);
    renderP(p4);

    y += 2;

    // Declaração Final Destacada
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
    doc.text('Li, compreendi os riscos informados e autorizo a execução do serviço.', pageMargin + usableWidth / 2, y, {
      align: 'center',
    });

    y += 8;

    // 6. Bloco de Assinaturas (2 Colunas: Cliente e Oficina)
    const sigBoxW = (usableWidth - 16) / 2;
    const colCliX = pageMargin + 5;
    const colOfiX = rightMarginX - 5 - sigBoxW;

    // Assinatura Cliente
    if (assinaturaCliBase64) {
      // Desenha imagem da assinatura digital
      try {
        await drawProportionalImage(doc, assinaturaCliBase64, 'PNG', colCliX + (sigBoxW - 44) / 2, y, 44, 11);
      } catch (err) {
        console.warn('[PDF Termo Risco] Erro ao desenhar assinatura digital:', err);
      }

      doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
      doc.setLineWidth(0.3);
      doc.line(colCliX, y + 12, colCliX + sigBoxW, y + 12);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
      doc.text(data.assinaturaDigitalNome || data.assinaturaClienteNome || data.clienteNome, colCliX + sigBoxW / 2, y + 15.5, {
        align: 'center',
      });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
      const dataAssinaturaTexto = data.assinaturaDigitalEm
        ? `Assinado Digitalmente em ${formatarDataHora(data.assinaturaDigitalEm)}`
        : 'Assinado Eletronicamente via Link Seguro';
      doc.text(dataAssinaturaTexto, colCliX + sigBoxW / 2, y + 19, { align: 'center' });
    } else {
      // Assinatura Física / Manual
      doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
      doc.setLineWidth(0.3);
      doc.line(colCliX, y + 10, colCliX + sigBoxW, y + 10);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
      doc.text(data.assinaturaClienteNome || data.clienteNome, colCliX + sigBoxW / 2, y + 14, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
      doc.text('Assinatura do Cliente / Proprietário', colCliX + sigBoxW / 2, y + 17.5, { align: 'center' });
    }

    // Assinatura Oficina
    doc.line(colOfiX, y + 10, colOfiX + sigBoxW, y + 10);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
    doc.text(
      data.assinaturaTecnicoNome || data.responsavelNome || data.oficinaNome,
      colOfiX + sigBoxW / 2,
      y + 14,
      { align: 'center' }
    );
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
    doc.text('Responsável Técnico / Oficina', colOfiX + sigBoxW / 2, y + 17.5, { align: 'center' });

    // 7. PÁGINA ANEXA DE DOSSIÊ FOTOGRÁFICO COMPARATIVO (ANTES x DURANTE)
    const fotosAntes = data.fotosAntes || [];
    const fotosDurante = data.fotosDurante || [];
    const temFotos = fotosAntes.length > 0 || fotosDurante.length > 0;

    if (temFotos) {
      onProgress?.('Gerando anexo fotográfico comparativo...');
      doc.addPage();

      cabecalhoDocumento(doc, {
        oficinaNome: data.oficinaNome,
        oficinaRazaoSocial: data.oficinaRazaoSocial || undefined,
        oficinaDocumento: data.oficinaDocumento || undefined,
        oficinaDocumentoTipo: data.oficinaDocumentoTipo || undefined,
        oficinaCidadeUF: data.oficinaCidadeUF || undefined,
        oficinaTelefone: data.oficinaTelefone || undefined,
        logoBase64,
        documentoTitulo: 'DOSSIÊ FOTOGRÁFICO DE EVIDÊNCIAS',
        documentoSubtitulo: 'ANEXO I — REGISTRO COMPARATIVO CDC (ANTES x DURANTE)',
        dataEmissao: data.dataEmissao ? formatarData(data.dataEmissao) : new Date().toLocaleDateString('pt-BR'),
        numeroOS: data.numeroOS ? Number(data.numeroOS) : null,
        planoCodigo: data.planoCodigo,
        pdfCorPrimaria: data.pdfCorPrimaria,
        pdfCorFundoCabecalho: data.pdfCorFundoCabecalho,
        pdfCorTextoCabecalho: data.pdfCorTextoCabecalho,
        pdfSubtituloCabecalho: data.pdfSubtituloCabecalho,
      });

      let yFoto = 39;

      // Banner Informativo do Anexo
      doc.setFillColor(corFundoSecoesRgb[0], corFundoSecoesRgb[1], corFundoSecoesRgb[2]);
      doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
      doc.setLineWidth(0.2);
      doc.roundedRect(pageMargin, yFoto, usableWidth, 9, 1, 1, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
      doc.text('COMPROVAÇÃO DE VÍCIO PREEXISTENTE ENCOBERTO PELA SUJEIRA', pageMargin + 4, yFoto + 4.2);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
      doc.text(
        'Fotos capturadas na vistoria inicial e após a pré-lavagem e descontaminação técnica, nos termos do art. 6º, III e 14, §3º do CDC.',
        pageMargin + 4,
        yFoto + 7.5
      );

      yFoto += 13;

      // Layout em 2 colunas: Coluna Esquerda = ANTES / Coluna Direita = DURANTE
      const colWidth = (usableWidth - 8) / 2;
      const colEsquerdaX = pageMargin;
      const colDireitaX = pageMargin + colWidth + 8;

      // Título Coluna ANTES
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
      doc.text(`1. ANTES · VISTORIA DE ENTRADA (${fotosAntes.length})`, colEsquerdaX, yFoto);

      // Título Coluna DURANTE
      doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
      doc.text(`2. DURANTE · APÓS PRÉ-LAVAGEM (${fotosDurante.length})`, colDireitaX, yFoto);

      yFoto += 4;

      const maxLinhasFotos = Math.max(fotosAntes.length, fotosDurante.length, 1);
      const limitFotos = Math.min(maxLinhasFotos, 3); // Até 3 pares por folha
      const cardHeight = 62;

      for (let i = 0; i < limitFotos; i++) {
        // Foto Antes
        const fotoA = fotosAntes[i];
        doc.setFillColor(corFundoSecoesRgb[0], corFundoSecoesRgb[1], corFundoSecoesRgb[2]);
        doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
        doc.roundedRect(colEsquerdaX, yFoto, colWidth, cardHeight, 1.5, 1.5, 'FD');

        if (fotoA?.url) {
          try {
            const b64A = fotoA.url.startsWith('data:') ? fotoA.url : await fetchImageAsBase64(fotoA.url);
            if (b64A) {
              await drawProportionalImage(doc, b64A, 'JPEG', colEsquerdaX + 2, yFoto + 2, colWidth - 4, 48);
            }
          } catch (e) {
            console.warn('[PDF Termo Risco] Falha ao carregar foto antes:', e);
          }
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(6.5);
          doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
          const descA = fotoA.descricao || 'Veículo no ato de recebimento (com sujidade inicial)';
          doc.text(doc.splitTextToSize(descA, colWidth - 6)[0] || '', colEsquerdaX + 3, yFoto + 55);
        } else {
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(7);
          doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
          doc.text('Foto de entrada não disponível', colEsquerdaX + colWidth / 2, yFoto + cardHeight / 2, {
            align: 'center',
          });
        }

        // Foto Durante
        const fotoD = fotosDurante[i];
        doc.setFillColor(corFundoSecoesRgb[0], corFundoSecoesRgb[1], corFundoSecoesRgb[2]);
        doc.setDrawColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
        doc.roundedRect(colDireitaX, yFoto, colWidth, cardHeight, 1.5, 1.5, 'FD');

        if (fotoD?.url) {
          try {
            const b64D = fotoD.url.startsWith('data:') ? fotoD.url : await fetchImageAsBase64(fotoD.url);
            if (b64D) {
              await drawProportionalImage(doc, b64D, 'JPEG', colDireitaX + 2, yFoto + 2, colWidth - 4, 48);
            }
          } catch (e) {
            console.warn('[PDF Termo Risco] Falha ao carregar foto durante:', e);
          }
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(6.5);
          doc.setTextColor(corDestaquePreco[0], corDestaquePreco[1], corDestaquePreco[2]);
          const descD = fotoD.descricao || 'Avaria preexistente revelada após pré-lavagem e descontaminação';
          doc.text(doc.splitTextToSize(descD, colWidth - 6)[0] || '', colDireitaX + 3, yFoto + 55);
        } else {
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(7);
          doc.setTextColor(corTextoSecundario[0], corTextoSecundario[1], corTextoSecundario[2]);
          doc.text('Evidência adicional não anexada', colDireitaX + colWidth / 2, yFoto + cardHeight / 2, {
            align: 'center',
          });
        }

        yFoto += cardHeight + 4;
      }

      // Nota de rodapé da página fotográfica
      doc.setFillColor(corFundoSecoesRgb[0], corFundoSecoesRgb[1], corFundoSecoesRgb[2]);
      doc.setDrawColor(corBordaCard[0], corBordaCard[1], corBordaCard[2]);
      doc.roundedRect(pageMargin, yFoto + 1, usableWidth, 9, 1, 1, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(corTextoPrincipal[0], corTextoPrincipal[1], corTextoPrincipal[2]);
      doc.text(
        'Declaração Técnica: O comparativo fotográfico acima atesta fielmente que a condição registrada não foi ocasionada pelos procedimentos da oficina, mas sim revelada após a remoção de impurezas e crostas de sujeira.',
        pageMargin + 3,
        yFoto + 6
      );
    }
  }

  // Rodapé Oficial em todas as páginas
  const totalPaginas = doc.getNumberOfPages();
  for (let p = 1; p <= totalPaginas; p++) {
    doc.setPage(p);
    rodapeDocumento(doc, {
      planoCodigo: data.planoCodigo,
      pdfTextoRodape:
        data.pdfTextoRodape ||
        (isDigital
          ? 'Documento assinado digitalmente com validade jurídica comprovada (Lei nº 8.078/90 e MP 2.200-2/2001).'
          : 'Documento emitido em duas vias (1ª Via: Oficina / 2ª Via: Cliente). Válido mediante aposição de assinaturas físicas.'),
      pdfOcultarMarcaDagua: data.pdfOcultarMarcaDagua,
      paginaAtual: p,
      totalPaginas,
    });
  }

  onProgress?.('Finalizando PDF...');
  const nomeArquivo = `termo_risco_${data.veiculoPlaca.toUpperCase()}_OS${osFormatada.replace(/\s+/g, '_')}${
    isDigital ? '_assinado' : ''
  }.pdf`;

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
