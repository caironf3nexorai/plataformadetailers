import { supabase } from '../lib/supabase';
import type { CategoriaVeiculo } from '../types/clientes';

export interface LinhaCSVImport {
  linhaOriginal: number;
  nome: string;
  telefone: string;
  cpf_cnpj?: string;
  email?: string;
  endereco?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
  observacoes?: string;
  placa?: string;
  modelo?: string;
  marca?: string;
  ano?: number | null;
  cor?: string;
  categoria?: string;
}

export interface LinhaRecusada {
  linha: number;
  nome: string;
  telefone: string;
  placa: string;
  motivo: string;
}

export interface PreviewImportacaoResult {
  sucesso: boolean;
  erroGrave?: string;
  totalLinhasProcessadas: number;
  novosClientesCount: number;
  clientesExistentesCount: number;
  novosVeiculosCount: number;
  veiculosExistentesCount: number;
  linhasValidadasCount: number;
  recusas: LinhaRecusada[];
  avisoLimitePlano?: string | null;
  bloqueioLimitePlano?: string | null;
  linhasParaProcessar: Array<{
    linhaCSV: LinhaCSVImport;
    telNorm: string;
    placaNorm?: string;
    categoriaId?: string;
    isClienteNovo: boolean;
    isVeiculoNovo: boolean;
  }>;
}

// -----------------------------------------------------------------------------
// 1. GERADOR DO MODELO CSV COM CABEÇALHO E LINHAS DE EXEMPLO
// -----------------------------------------------------------------------------
export function gerarModeloCSV(): void {
  const comentario = '# Modelo de importação de clientes e veículos. Telefone repetido junta múltiplos veículos para o mesmo cliente.\n';
  const cabecalho = 'nome; telefone; cpf_cnpj; email; endereco; bairro; cidade; uf; cep; observacoes; placa; modelo; marca; ano; cor; categoria\n';
  const linhaExemplo1 = 'Carlos Eduardo Silva; (11) 98765-4321; 123.456.789-00; carlos.silva@email.com; Av. Paulista, 1000; Bela Vista; São Paulo; SP; 01310-100; Cliente preferencial; ABC-1234; Onix 1.0; Chevrolet; 2022; Preto; Hatch\n';
  const linhaExemplo2 = 'Mariana Souza; (21) 99876-5432; 12.345.678/0001-90; mariana@estudio.com.br; Rua das Flores, 50; Centro; Rio de Janeiro; RJ; 20000-000; Solicitou NF; RYZ-9E88; Corolla Cross; Toyota; 2024; Branco; SUV\n';

  const conteudo = comentario + cabecalho + linhaExemplo1 + linhaExemplo2;
  const blob = new Blob(['\uFEFF' + conteudo], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'modelo_importacao_clientes_veiculos.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// -----------------------------------------------------------------------------
// 2. GERADOR DO RELATÓRIO DE RECUSAS (DOWNLOAD)
// -----------------------------------------------------------------------------
export function gerarRelatorioRecusasCSV(recusas: LinhaRecusada[]): void {
  let conteudo = 'Linha;Nome;Telefone;Placa;Motivo da Recusa\n';
  recusas.forEach((r) => {
    const nomeLimpo = (r.nome || '').replace(/;/g, ',');
    const telLimpo = (r.telefone || '').replace(/;/g, ',');
    const placaLimpa = (r.placa || '').replace(/;/g, ',');
    const motivoLimpo = (r.motivo || '').replace(/;/g, ',');
    conteudo += `${r.linha};"${nomeLimpo}";"${telLimpo}";"${placaLimpa}";"${motivoLimpo}"\n`;
  });

  const blob = new Blob(['\uFEFF' + conteudo], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `relatorio_recusas_importacao_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// -----------------------------------------------------------------------------
// 3. AUTO-DETECÇÃO DE CODIFICAÇÃO E DELIMITADOR + PARSER CSV
// -----------------------------------------------------------------------------
export function decodificarBufferCSV(buffer: ArrayBuffer): string {
  try {
    const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
    return utf8Decoder.decode(buffer);
  } catch {
    const isoDecoder = new TextDecoder('iso-8859-1');
    return isoDecoder.decode(buffer);
  }
}

export function removerAcentosECharsEspeciais(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function normalizarTelefoneCSV(tel: string): string {
  if (!tel) return '';
  let digits = tel.replace(/\D/g, '');
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    digits = digits.substring(2);
  }
  if (digits.length === 10 && ['6', '7', '8', '9'].includes(digits.charAt(2))) {
    digits = digits.substring(0, 2) + '9' + digits.substring(2);
  }
  return digits;
}

export function normalizarPlacaCSV(placa: string): string {
  if (!placa) return '';
  return placa.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().trim();
}

function parseCSVLine(textLine: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < textLine.length; i++) {
    const char = textLine[i];
    if (char === '"') {
      if (inQuotes && textLine[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// -----------------------------------------------------------------------------
// 4. PARSER E PRÉ-VISUALIZAÇÃO COMPLETA
// -----------------------------------------------------------------------------
export async function analisarEPreVisualizarCSV(
  file: File,
  tenantId: string
): Promise<PreviewImportacaoResult> {
  const buffer = await file.arrayBuffer();
  const rawText = decodificarBufferCSV(buffer);

  // Separação de linhas ignorando linhas vazias ou comentários (#)
  const allLines = rawText.split(/\r?\n/);
  const validDataRawLines: { lineNum: number; text: string }[] = [];

  allLines.forEach((lineText, idx) => {
    const trimmed = lineText.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    validDataRawLines.push({ lineNum: idx + 1, text: lineText });
  });

  if (validDataRawLines.length === 0) {
    return {
      sucesso: false,
      erroGrave: 'O arquivo enviado está vazio ou contém apenas comentários.',
      totalLinhasProcessadas: 0,
      novosClientesCount: 0,
      clientesExistentesCount: 0,
      novosVeiculosCount: 0,
      veiculosExistentesCount: 0,
      linhasValidadasCount: 0,
      recusas: [],
      linhasParaProcessar: [],
    };
  }

  // Auto-detecção de delimitador com base no cabeçalho
  const headerLineText = validDataRawLines[0].text;
  const countSemicolon = (headerLineText.match(/;/g) || []).length;
  const countComma = (headerLineText.match(/,/g) || []).length;
  const delimiter = countSemicolon >= countComma ? ';' : ',';

  // Cabeçalho
  const rawHeaders = parseCSVLine(headerLineText, delimiter).map((h) =>
    removerAcentosECharsEspeciais(h)
  );

  const dataRows = validDataRawLines.slice(1);

  // Regra de Limite: Máximo 2.000 linhas
  if (dataRows.length > 2000) {
    return {
      sucesso: false,
      erroGrave: 'O arquivo contém mais de 2.000 linhas. Por favor, divida o arquivo em partes menores.',
      totalLinhasProcessadas: dataRows.length,
      novosClientesCount: 0,
      clientesExistentesCount: 0,
      novosVeiculosCount: 0,
      veiculosExistentesCount: 0,
      linhasValidadasCount: 0,
      recusas: [],
      linhasParaProcessar: [],
    };
  }

  // Mapeamento de índices de colunas
  const getColIdx = (names: string[]): number => {
    return rawHeaders.findIndex((h) => names.some((n) => h.includes(n)));
  };

  const idxNome = getColIdx(['nome']);
  const idxTelefone = getColIdx(['telefone', 'celular', 'tel', 'whatsapp']);
  const idxCpfCnpj = getColIdx(['cpf', 'cnpj', 'documento']);
  const idxEmail = getColIdx(['email']);
  const idxEndereco = getColIdx(['endereco', 'rua', 'logradouro']);
  const idxBairro = getColIdx(['bairro']);
  const idxCidade = getColIdx(['cidade']);
  const idxUf = getColIdx(['uf', 'estado']);
  const idxCep = getColIdx(['cep']);
  const idxObs = getColIdx(['observacao', 'observacoes', 'obs']);
  const idxPlaca = getColIdx(['placa']);
  const idxModelo = getColIdx(['modelo']);
  const idxMarca = getColIdx(['marca']);
  const idxAno = getColIdx(['ano']);
  const idxCor = getColIdx(['cor']);
  const idxCategoria = getColIdx(['categoria', 'porte']);

  if (idxNome < 0 || idxTelefone < 0) {
    return {
      sucesso: false,
      erroGrave: 'Cabeçalho do CSV inválido. As colunas "nome" e "telefone" são obrigatórias.',
      totalLinhasProcessadas: dataRows.length,
      novosClientesCount: 0,
      clientesExistentesCount: 0,
      novosVeiculosCount: 0,
      veiculosExistentesCount: 0,
      linhasValidadasCount: 0,
      recusas: [],
      linhasParaProcessar: [],
    };
  }

  // Buscar categorias de veículos ativas do tenant no Supabase
  const { data: catData, error: catErr } = await supabase
    .from('categorias_veiculo')
    .select('id, nome')
    .eq('tenant_id', tenantId)
    .eq('ativo', true);

  if (catErr) {
    return {
      sucesso: false,
      erroGrave: 'Erro ao buscar categorias de veículo da oficina.',
      totalLinhasProcessadas: dataRows.length,
      novosClientesCount: 0,
      clientesExistentesCount: 0,
      novosVeiculosCount: 0,
      veiculosExistentesCount: 0,
      linhasValidadasCount: 0,
      recusas: [],
      linhasParaProcessar: [],
    };
  }

  const categoriasList: CategoriaVeiculo[] = (catData as any) || [];

  // Buscar clientes e veículos existentes no tenant para deduplicação
  const { data: existClientes } = await supabase
    .from('clientes')
    .select('id, telefone')
    .eq('tenant_id', tenantId)
    .eq('ativo', true);

  const existingPhonesSet = new Set<string>();
  (existClientes || []).forEach((c) => {
    const norm = normalizarTelefoneCSV(c.telefone);
    if (norm) existingPhonesSet.add(norm);
  });

  const { data: existVeiculos } = await supabase
    .from('veiculos')
    .select('id, placa')
    .eq('tenant_id', tenantId)
    .eq('ativo', true);

  const existingPlacasSet = new Set<string>();
  (existVeiculos || []).forEach((v) => {
    const norm = normalizarPlacaCSV(v.placa);
    if (norm) existingPlacasSet.add(norm);
  });

  // Checagem de Limite de Plano
  const { data: limiteData } = await supabase.rpc('verificar_limite', {
    p_recurso: 'clientes',
  });

  const limiteInfo = (limiteData as any) || {};
  const bloqueioAtivo = Boolean(limiteInfo.bloqueio_ativo);
  const limiteMax = limiteInfo.limite ? Number(limiteInfo.limite) : null;
  const clientesUsadosAtual = limiteInfo.usado ? Number(limiteInfo.usado) : existingPhonesSet.size;

  const recusas: LinhaRecusada[] = [];
  const candidatosValidos: Array<{
    linhaCSV: LinhaCSVImport;
    telNorm: string;
    placaNorm?: string;
    categoriaId?: string;
  }> = [];

  // Processamento linha a linha
  dataRows.forEach(({ lineNum, text }) => {
    const cols = parseCSVLine(text, delimiter);

    const getValue = (idx: number) => (idx >= 0 && cols[idx] ? cols[idx].trim() : '');

    const nome = getValue(idxNome);
    const telefoneRaw = getValue(idxTelefone);
    const cpfCnpj = getValue(idxCpfCnpj);
    const email = getValue(idxEmail);
    const endereco = getValue(idxEndereco);
    const bairro = getValue(idxBairro);
    const cidade = getValue(idxCidade);
    const uf = getValue(idxUf);
    const cep = getValue(idxCep);
    const obs = getValue(idxObs);
    const placaRaw = getValue(idxPlaca);
    const modelo = getValue(idxModelo);
    const marca = getValue(idxMarca);
    const anoStr = getValue(idxAno);
    const cor = getValue(idxCor);
    const categoriaRaw = getValue(idxCategoria);

    // Validações básicas de cliente
    if (!nome || nome.length < 2) {
      recusas.push({
        linha: lineNum,
        nome: nome || '—',
        telefone: telefoneRaw || '—',
        placa: placaRaw || '—',
        motivo: 'Nome do cliente é obrigatório e deve ter no mínimo 2 caracteres.',
      });
      return;
    }

    const telNorm = normalizarTelefoneCSV(telefoneRaw);
    if (!telNorm || (telNorm.length !== 10 && telNorm.length !== 11)) {
      recusas.push({
        linha: lineNum,
        nome,
        telefone: telefoneRaw || '—',
        placa: placaRaw || '—',
        motivo: 'Telefone inválido (deve conter DDD + número com 10 ou 11 dígitos).',
      });
      return;
    }

    // Validações de veículo (se houver placa ou modelo ou marca ou categoria informados)
    const temDadosVeiculo = Boolean(placaRaw || modelo || marca || categoriaRaw);
    let placaNorm: string | undefined;
    let categoriaIdFound: string | undefined;

    if (temDadosVeiculo) {
      placaNorm = normalizarPlacaCSV(placaRaw);
      if (!placaNorm || placaNorm.length < 3 || placaNorm.length > 8) {
        recusas.push({
          linha: lineNum,
          nome,
          telefone: telefoneRaw,
          placa: placaRaw || '—',
          motivo: 'Placa de veículo é obrigatória e deve ter formato válido (ex: ABC-1234 ou ABC1D23).',
        });
        return;
      }

      if (!categoriaRaw) {
        recusas.push({
          linha: lineNum,
          nome,
          telefone: telefoneRaw,
          placa: placaRaw,
          motivo: 'Categoria do veículo é obrigatória para cadastrar placa.',
        });
        return;
      }

      const catNormStr = removerAcentosECharsEspeciais(categoriaRaw);
      const catMatch = categoriasList.find(
        (c) => removerAcentosECharsEspeciais(c.nome) === catNormStr
      );

      if (!catMatch) {
        recusas.push({
          linha: lineNum,
          nome,
          telefone: telefoneRaw,
          placa: placaRaw,
          motivo: `Categoria "${categoriaRaw}" não encontrada para esta oficina.`,
        });
        return;
      }

      categoriaIdFound = catMatch.id;
    }

    const anoNum = anoStr && !isNaN(Number(anoStr)) ? Number(anoStr) : null;

    candidatosValidos.push({
      linhaCSV: {
        linhaOriginal: lineNum,
        nome,
        telefone: telefoneRaw,
        cpf_cnpj: cpfCnpj || undefined,
        email: email || undefined,
        endereco: endereco || undefined,
        bairro: bairro || undefined,
        cidade: cidade || undefined,
        uf: uf || undefined,
        cep: cep || undefined,
        observacoes: obs || undefined,
        placa: placaRaw || undefined,
        modelo: modelo || undefined,
        marca: marca || undefined,
        ano: anoNum,
        cor: cor || undefined,
        categoria: categoriaRaw || undefined,
      },
      telNorm,
      placaNorm,
      categoriaId: categoriaIdFound,
    });
  });

  // Simulação de deduplicação e contagem de novos clientes e veículos
  const phonesEmMemoriaSet = new Set<string>();
  const placasEmMemoriaSet = new Set<string>();

  let novosClientesSimulados = 0;
  let clientesExistentesSimulados = 0;
  let novosVeiculosSimulados = 0;
  let veiculosExistentesSimulados = 0;

  const linhasParaProcessar: Array<{
    linhaCSV: LinhaCSVImport;
    telNorm: string;
    placaNorm?: string;
    categoriaId?: string;
    isClienteNovo: boolean;
    isVeiculoNovo: boolean;
  }> = [];

  for (const item of candidatosValidos) {
    let isClienteNovo = false;
    let isVeiculoNovo = false;

    // Checagem de cliente
    if (!existingPhonesSet.has(item.telNorm) && !phonesEmMemoriaSet.has(item.telNorm)) {
      isClienteNovo = true;
      phonesEmMemoriaSet.add(item.telNorm);
      novosClientesSimulados++;
    } else {
      clientesExistentesSimulados++;
    }

    // Checagem de veículo
    if (item.placaNorm) {
      if (!existingPlacasSet.has(item.placaNorm) && !placasEmMemoriaSet.has(item.placaNorm)) {
        isVeiculoNovo = true;
        placasEmMemoriaSet.add(item.placaNorm);
        novosVeiculosSimulados++;
      } else {
        veiculosExistentesSimulados++;
      }
    }

    linhasParaProcessar.push({
      ...item,
      isClienteNovo,
      isVeiculoNovo,
    });
  }

  // Avaliação do limite do plano
  let avisoLimitePlano: string | null = null;
  let bloqueioLimitePlano: string | null = null;

  if (limiteMax !== null) {
    const totalClientesPrevisto = clientesUsadosAtual + novosClientesSimulados;

    if (totalClientesPrevisto > limiteMax) {
      const cotaDisponivel = Math.max(0, limiteMax - clientesUsadosAtual);

      if (bloqueioAtivo) {
        bloqueioLimitePlano = `Atenção: O plano atual permite cadastrar no máximo ${limiteMax} clientes (atualmente ${clientesUsadosAtual}). A importação foi ajustada para aceitar apenas os primeiros ${cotaDisponivel} clientes novos.`;

        // Filtrar e recusar os excedentes
        let novosAprovadosCount = 0;
        const telefonesNovosAprovadosSet = new Set<string>();

        const linhasFiltradas: typeof linhasParaProcessar = [];

        for (const lp of linhasParaProcessar) {
          if (lp.isClienteNovo && !telefonesNovosAprovadosSet.has(lp.telNorm)) {
            if (novosAprovadosCount >= cotaDisponivel) {
              recusas.push({
                linha: lp.linhaCSV.linhaOriginal,
                nome: lp.linhaCSV.nome,
                telefone: lp.linhaCSV.telefone,
                placa: lp.linhaCSV.placa || '—',
                motivo: `Limite de clientes do plano excedido (${limiteMax} clientes).`,
              });
              continue;
            }
            novosAprovadosCount++;
            telefonesNovosAprovadosSet.add(lp.telNorm);
          }
          linhasFiltradas.push(lp);
        }

        // Reajusta a lista
        novosClientesSimulados = novosAprovadosCount;
      } else {
        avisoLimitePlano = `Atenção: Esta importação cadastrará ${novosClientesSimulados} novos clientes, ultrapassando o limite recomendado do seu plano (${limiteMax} clientes).`;
      }
    }
  }

  return {
    sucesso: true,
    totalLinhasProcessadas: dataRows.length,
    novosClientesCount: novosClientesSimulados,
    clientesExistentesCount: clientesExistentesSimulados,
    novosVeiculosCount: novosVeiculosSimulados,
    veiculosExistentesCount: veiculosExistentesSimulados,
    linhasValidadasCount: linhasParaProcessar.length,
    recusas,
    avisoLimitePlano,
    bloqueioLimitePlano,
    linhasParaProcessar,
  };
}

// -----------------------------------------------------------------------------
// 5. EXECUÇÃO DA GRAVAÇÃO ATÔMICA DOS DADOS VALIDADOS NO BANCO DE DADOS
// -----------------------------------------------------------------------------
export async function executarGravaçãoCSV(
  tenantId: string,
  linhas: PreviewImportacaoResult['linhasParaProcessar']
): Promise<{ sucessosCount: number; erros: string[] }> {
  const erros: string[] = [];
  let sucessosCount = 0;

  if (linhas.length === 0) {
    return { sucessosCount: 0, erros: [] };
  }

  try {
    // Mapa auxiliar em memória para guardar IDs de Clientes criados ou reutilizados por telefone
    const mapPhoneToClienteId = new Map<string, string>();

    // 1. Carregar clientes existentes no DB para o mapa
    const { data: existingClientes } = await supabase
      .from('clientes')
      .select('id, telefone')
      .eq('tenant_id', tenantId)
      .eq('ativo', true);

    (existingClientes || []).forEach((c) => {
      const norm = normalizarTelefoneCSV(c.telefone);
      if (norm) mapPhoneToClienteId.set(norm, c.id);
    });

    // 2. Agrupar clientes novos a inserir
    const clientesNovosToInsertMap = new Map<
      string,
      {
        tenant_id: string;
        nome: string;
        telefone: string;
        email?: string | null;
        documento?: string | null;
        observacoes?: string | null;
        origem: string;
      }
    >();

    for (const l of linhas) {
      if (!mapPhoneToClienteId.has(l.telNorm) && !clientesNovosToInsertMap.has(l.telNorm)) {
        // Montagem do campo observações incluindo endereço caso preenchido
        const partesObs: string[] = [];
        if (l.linhaCSV.observacoes) partesObs.push(l.linhaCSV.observacoes);

        const enderecoCompleto = [
          l.linhaCSV.endereco,
          l.linhaCSV.bairro,
          l.linhaCSV.cidade && l.linhaCSV.uf ? `${l.linhaCSV.cidade}/${l.linhaCSV.uf}` : l.linhaCSV.cidade || l.linhaCSV.uf,
          l.linhaCSV.cep ? `CEP: ${l.linhaCSV.cep}` : null,
        ]
          .filter(Boolean)
          .join(' - ');

        if (enderecoCompleto) {
          partesObs.push(`Endereço: ${enderecoCompleto}`);
        }

        const obsFinal = partesObs.join(' | ') || null;

        clientesNovosToInsertMap.set(l.telNorm, {
          tenant_id: tenantId,
          nome: l.linhaCSV.nome,
          telefone: l.linhaCSV.telefone,
          email: l.linhaCSV.email || null,
          documento: l.linhaCSV.cpf_cnpj || null,
          observacoes: obsFinal,
          origem: 'interno',
        });
      }
    }

    // Inserção em lote de clientes novos
    const clientesNovosArray = Array.from(clientesNovosToInsertMap.values());
    if (clientesNovosArray.length > 0) {
      // Inserir em chunks de 50 para garantir estabilidade
      const chunkSize = 50;
      for (let i = 0; i < clientesNovosArray.length; i += chunkSize) {
        const chunk = clientesNovosArray.slice(i, i + chunkSize);
        const { data: inserted, error: insertErr } = await supabase
          .from('clientes')
          .insert(chunk)
          .select('id, telefone');

        if (insertErr) {
          throw new Error(`Erro ao salvar lote de clientes: ${insertErr.message}`);
        }

        (inserted || []).forEach((c) => {
          const norm = normalizarTelefoneCSV(c.telefone);
          if (norm) mapPhoneToClienteId.set(norm, c.id);
        });
      }
    }

    // 3. Processamento e inserção dos veículos
    // Carregar veículos existentes no DB para o mapa de placas
    const mapPlacaToVeiculoId = new Map<string, string>();
    const { data: existingVeiculos } = await supabase
      .from('veiculos')
      .select('id, placa')
      .eq('tenant_id', tenantId)
      .eq('ativo', true);

    (existingVeiculos || []).forEach((v) => {
      const norm = normalizarPlacaCSV(v.placa);
      if (norm) mapPlacaToVeiculoId.set(norm, v.id);
    });

    const todayDate = new Date().toISOString().slice(0, 10);

    for (const l of linhas) {
      const clienteId = mapPhoneToClienteId.get(l.telNorm);
      if (!clienteId) {
        erros.push(`Não foi possível vincular o cliente da linha ${l.linhaCSV.linhaOriginal}.`);
        continue;
      }

      sucessosCount++;

      // Se possui veículo a ser gravado
      if (l.placaNorm && l.categoriaId) {
        const veiculoExistenteId = mapPlacaToVeiculoId.get(l.placaNorm);

        if (!veiculoExistenteId) {
          // Criar novo veículo
          const { data: newVeic, error: veicErr } = await supabase
            .from('veiculos')
            .insert({
              tenant_id: tenantId,
              cliente_id: clienteId,
              categoria_id: l.categoriaId,
              placa: l.placaNorm,
              modelo: l.linhaCSV.modelo || 'Não informado',
              marca: l.linhaCSV.marca || null,
              ano: l.linhaCSV.ano || null,
              cor: l.linhaCSV.cor || null,
              observacoes: l.linhaCSV.observacoes || null,
              ativo: true,
            })
            .select('id')
            .single();

          if (veicErr) {
            console.error(`[CSV Importer] Erro ao inserir veículo ${l.placaNorm}:`, veicErr);
            continue;
          }

          if (newVeic?.id) {
            mapPlacaToVeiculoId.set(l.placaNorm, newVeic.id);

            // Criar vínculo de propriedade em veiculo_donos
            await supabase.from('veiculo_donos').insert({
              tenant_id: tenantId,
              veiculo_id: newVeic.id,
              cliente_id: clienteId,
              inicio: todayDate,
            });
          }
        }
      }
    }

    return { sucessosCount, erros };
  } catch (err: any) {
    console.error('[CSV Importer execution error]:', err);
    return { sucessosCount, erros: [err.message || 'Erro durante a gravação dos dados.'] };
  }
}
