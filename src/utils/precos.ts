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
  | { preco_base?: number | string | null; preco?: number | string | null; valor?: number | string | null };

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
    if (item === null || item === undefined) continue;

    let valorBruto: any = item;
    if (typeof item === 'object') {
      valorBruto = item.preco_base ?? item.preco ?? item.valor;
    }

    if (valorBruto === null || valorBruto === undefined || valorBruto === '') continue;

    const num = typeof valorBruto === 'number'
      ? valorBruto
      : Number(String(valorBruto).replace(',', '.'));

    if (!isNaN(num) && isFinite(num) && num > 0) {
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
