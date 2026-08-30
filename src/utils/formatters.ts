/**
 * Formata telefone brasileiro no padrão (00) 00000-0000 ou (00) 0000-0000
 */
export function formatTelefone(value: string): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

/**
 * Remove a formatação e retorna apenas os dígitos do telefone
 */
export function cleanTelefone(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Formata placa de veículo (padrão tradicional ABC-1234 ou Mercosul ABC1D23)
 * Regra:
 * - 5º caractere é LETRA -> Mercosul, sem hífen (ex: JHC4A80)
 * - 5º caractere é DÍGITO -> Tradicional, com hífen (ex: ABC-1234)
 */
export function formatPlaca(value: string): string {
  if (!value) return '';
  const clean = value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 7);

  if (clean.length >= 5 && /[A-Z]/.test(clean[4])) {
    // Placa Mercosul (5º caractere é letra)
    return clean;
  }

  if (clean.length > 3) {
    // Placa tradicional (5º caractere é dígito)
    return `${clean.slice(0, 3)}-${clean.slice(3)}`;
  }

  return clean;
}

/**
 * Formata valor monetário no padrão BRL pt-BR (ex: "R$ 120,00")
 */
export function formatarMoeda(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || isNaN(valor)) return 'R$ 0,00';
  return valor.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Formata custo unitário de produto com 4 casas decimais e vírgula pt-BR (ex: "R$ 0,0240 por mL")
 */
export function formatarCustoUnitario(valor: number | null | undefined, unidade: string = 'mL'): string {
  const normUnidade = unidade === 'ml' ? 'mL' : unidade;
  if (valor === null || valor === undefined || isNaN(valor)) return `R$ 0,0000 por ${normUnidade}`;
  const formattedVal = valor.toLocaleString('pt-BR', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
  return `R$ ${formattedVal} por ${normUnidade}`;
}

/**
 * Formata número de Ordem de Serviço (OS) com 4 dígitos por padrão (ex: 42 -> "OS 0042", 130 -> "OS 0130")
 */
export function formatarOS(numero?: number | null, padLength = 4): string {
  if (numero === null || numero === undefined || isNaN(numero) || numero <= 0) {
    return 'OS ----';
  }
  return `OS ${String(numero).padStart(padLength, '0')}`;
}

/**
 * Formata número de Orçamento (ORC) com 4 dígitos por padrão (ex: 1 -> "ORC0001", 42 -> "ORC0042")
 */
export function formatarOrcamento(numero?: number | null, padLength = 4): string {
  if (numero === null || numero === undefined || isNaN(numero) || numero <= 0) {
    return 'ORC----';
  }
  return `ORC${String(numero).padStart(padLength, '0')}`;
}

/**
 * Retorna o código de identificação da proposta:
 * - Se convertida em OS / agendada, exibe a OS (ex: "OS 0001").
 * - Caso contrário (orçamento pendente/em rascunho/recusado), exibe o orçamento (ex: "ORC0001").
 */
export function formatarCodigoProposta(
  item: { numero?: number | null; numero_os?: number | null; status?: string; agendamento?: { numero_os?: number | null } | null },
  padLength = 4
): string {
  const osNum = item.numero_os || item.agendamento?.numero_os;
  if (osNum && osNum > 0) {
    return formatarOS(osNum, padLength);
  }
  return formatarOrcamento(item.numero, padLength);
}

/**
 * Extrai o número de OS de uma string de busca flexível (ex: "OS 42", "0042", "os 0130" -> 42 ou 130)
 */
export function extrairNumeroOS(query: string): number | null {
  if (!query) return null;
  const limpo = query.toLowerCase().replace(/os/g, '').replace(/\D/g, '');
  if (!limpo) return null;
  const num = parseInt(limpo, 10);
  return isNaN(num) || num <= 0 ? null : num;
}

/**
 * Formata tempo trabalhado em formato amigável para serviços curtos e longos:
 * - Se < 60 min: "5 min trabalhados"
 * - Se >= 60 min: "2h30 trabalhadas" ou "1h trabalhada"
 */
export function formatarTempoTrabalhado(val: number | null | undefined, ehMinutos = false): string {
  if (val === null || val === undefined || isNaN(val) || val <= 0) {
    return '0 min';
  }

  const totalMinutos = ehMinutos ? Math.round(val) : Math.round(val * 60);

  if (totalMinutos <= 0) return '0 min';

  if (totalMinutos < 60) {
    return `${totalMinutos} min trabalhados`;
  }

  const horas = Math.floor(totalMinutos / 60);
  const mins = totalMinutos % 60;

  if (mins === 0) {
    return `${horas}h trabalhada${horas > 1 ? 's' : ''}`;
  }

  return `${horas}h${String(mins).padStart(2, '0')} trabalhadas`;
}

/**
 * Converte de forma resiliente números ou strings monetárias/decimais (PT-BR ou formato JS) para float.
 * Trata casos como: 620.5, "620.5", "620,50", "1.620,50", "1,620.50", "15", null, undefined.
 */
export function parseNumeroFlexivel(val: number | string | undefined | null): number {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const str = String(val).trim();
  if (!str) return 0;

  const hasComma = str.includes(',');
  const hasDot = str.includes('.');

  if (hasComma && hasDot) {
    if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
      // PT-BR com milhar: 1.234,56 -> 1234.56
      const clean = str.replace(/\./g, '').replace(',', '.');
      const num = parseFloat(clean);
      return isNaN(num) ? 0 : num;
    } else {
      // US com milhar: 1,234.56 -> 1234.56
      const clean = str.replace(/,/g, '');
      const num = parseFloat(clean);
      return isNaN(num) ? 0 : num;
    }
  }

  if (hasComma) {
    // PT-BR sem milhar: 620,50 -> 620.50
    const clean = str.replace(',', '.');
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
  }

  // Decimal JS nativo ou inteiro: "620.50" / "15" -> 620.50 / 15
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}
