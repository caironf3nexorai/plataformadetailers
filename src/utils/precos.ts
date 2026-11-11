/**
 * Formata um valor numérico para o padrão de moeda pt-BR sem o símbolo "R$".
 */
export const formatValorMoeda = (valor: number): string => {
  if (valor === null || valor === undefined || isNaN(valor) || !isFinite(valor)) {
    return '0';
  }
  return valor.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
};

export type PrecoItem =
  | number
  | string
  | null
  | undefined
  | {
      preco_base?: number | string | null;
      preco?: number | string | null;
      valor?: number | string | null;
      duracao_confirmada?: boolean | null;
      ativo?: boolean | null;
    };

/**
 * Extrai um número de preço válido e estritamente positivo (> 0) de um item de preço.
 */
export const extrairPrecoPositivo = (item: PrecoItem): number | null => {
  if (item === null || item === undefined) return null;

  let valorBruto: any = item;
  if (typeof item === 'object') {
    if (item.ativo === false) return null;
    valorBruto = item.preco_base ?? item.preco ?? item.valor;
  }

  if (valorBruto === null || valorBruto === undefined || valorBruto === '') return null;

  const num =
    typeof valorBruto === 'number'
      ? valorBruto
      : Number(String(valorBruto).trim().replace(',', '.'));

  if (!isNaN(num) && isFinite(num) && num > 0) {
    return num;
  }

  return null;
};

/**
 * Retorna true quando o item/célula possui um preço definido positivo (> 0).
 */
export const isPrecoDefinido = (item: PrecoItem): boolean => {
  return extrairPrecoPositivo(item) !== null;
};

/**
 * Retorna true quando um serviço (não "sob consulta") possui pelo menos um
 * preço sugerido positivo (> 0) ainda com confirmação de duração/tabela pendente.
 */
export const servicoTemPrecoSugeridoPendente = (
  precos: PrecoItem[] | null | undefined,
  sobConsulta: boolean = false
): boolean => {
  if (sobConsulta || !precos || !Array.isArray(precos)) {
    return false;
  }

  return precos.some((item) => {
    if (!item || typeof item !== 'object') return false;
    if (item.ativo === false) return false;
    if (item.duracao_confirmada) return false;
    return isPrecoDefinido(item);
  });
};

/**
 * Retorna true quando um serviço (não "sob consulta") não possui nenhum preço
 * válido (> 0) definido em suas categorias ativas.
 */
export const servicoSemPrecosDefinidos = (
  precos: PrecoItem[] | null | undefined,
  sobConsulta: boolean = false
): boolean => {
  if (sobConsulta) {
    return false;
  }
  if (!precos || !Array.isArray(precos) || precos.length === 0) {
    return true;
  }

  return !precos.some((item) => isPrecoDefinido(item));
};

/**
 * Retorna a faixa de preço descritiva para exibição no catálogo ou lista.
 * Padrões de retorno:
 * - sobConsulta = true: "Sob avaliação"
 * - Sem preços configurados: "Preço não definido"
 * - Todos os preços iguais: "A partir de R$ X"
 * - Preços variados: "A partir de R$ X a R$ Y"
 */
export const formatFaixaPreco = (
  precos: PrecoItem[] | null | undefined,
  sobConsulta: boolean = false
): string => {
  if (sobConsulta) {
    return 'Sob avaliação';
  }

  if (!precos || !Array.isArray(precos)) {
    return 'Preço não definido';
  }

  const validPrices: number[] = [];

  for (const item of precos) {
    const num = extrairPrecoPositivo(item);
    if (num !== null) {
      validPrices.push(num);
    }
  }

  if (validPrices.length === 0) {
    return 'Preço não definido';
  }

  const min = Math.min(...validPrices);
  const max = Math.max(...validPrices);

  if (min === max) {
    return `A partir de R$ ${formatValorMoeda(min)}`;
  }

  return `A partir de R$ ${formatValorMoeda(min)} a R$ ${formatValorMoeda(max)}`;
};

/**
 * Formata duração em minutos para exibição legível (ex: "40 min", "2h", "1h 30min")
 */
export const formatDuracao = (minutos: number): string => {
  if (!minutos || minutos <= 0) return '0 min';
  if (minutos < 60) return `${minutos} min`;
  
  const horas = Math.floor(minutos / 60);
  const minsRestantes = minutos % 60;
  
  if (minsRestantes === 0) {
    return `${horas}h`;
  }
  
  return `${horas}h ${minsRestantes}min`;
};

/**
 * Converte texto digitado na Matriz de Preços para número válido (ou null se vazio/sob consulta).
 * Evita NaN, valores negativos e overflow do numeric(10,2) no PostgreSQL.
 */
export const parsePrecoMatrizInput = (
  valor: string | number | null | undefined,
  sobConsulta: boolean = false
): number | null => {
  if (sobConsulta) return null;
  if (valor === null || valor === undefined) return null;

  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) return null;
    const clamped = Math.min(99999999.99, Math.max(0, valor));
    return Math.round(clamped * 100) / 100;
  }

  let texto = valor.trim().replace(/^R\$\s*/i, '').replace(/\s+/g, '');
  if (!texto || texto === '-' || texto === ',' || texto === '.' || texto.toLowerCase() === 'null' || texto.toLowerCase() === 'nan') {
    return null;
  }

  const temVirgula = texto.includes(',');
  const temPonto = texto.includes('.');

  if (temVirgula && temPonto) {
    if (texto.lastIndexOf(',') > texto.lastIndexOf('.')) {
      texto = texto.replace(/\./g, '').replace(',', '.');
    } else {
      texto = texto.replace(/,/g, '');
    }
  } else if (temVirgula) {
    const partes = texto.split(',');
    texto = `${partes[0]}.${partes.slice(1).join('')}`;
  } else if ((texto.match(/\./g) || []).length > 1) {
    texto = texto.replace(/\./g, '');
  }

  const num = Number(texto);
  if (!Number.isFinite(num)) return null;

  const clamped = Math.min(99999999.99, Math.max(0, num));
  return Math.round(clamped * 100) / 100;
};

/**
 * Garante duração em minutos inteira e válida (>= 1 min) ao salvar na Matriz de Preços.
 */
export const normalizarDuracaoMinutosMatriz = (
  duracaoMinutos: number | string | null | undefined,
  fallback: number = 60
): number => {
  const num = typeof duracaoMinutos === 'number'
    ? duracaoMinutos
    : Number(String(duracaoMinutos ?? '').replace(',', '.'));

  if (!Number.isFinite(num) || num <= 0) {
    return fallback;
  }

  return Math.min(525600, Math.max(1, Math.round(num)));
};
