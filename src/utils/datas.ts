// Helpers para formatação de data e hora com fuso horário fixo America/Sao_Paulo

export const TIMEZONE_SAO_PAULO = 'America/Sao_Paulo';

export function parseDateInput(ts: string | Date | number): Date {
  if (ts instanceof Date) return ts;
  if (typeof ts === 'number') return new Date(ts);
  if (!ts) return new Date(NaN);
  if (typeof ts === 'string' && ts.length === 10 && ts.includes('-')) {
    // Strings no formato YYYY-MM-DD sao interpretadas como meio-dia em SP para evitar deslocamento UTC
    return new Date(`${ts}T12:00:00-03:00`);
  }
  return new Date(ts);
}

export function formatarHora(ts: string | Date | number): string {
  const date = parseDateInput(ts);
  if (isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIMEZONE_SAO_PAULO,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(date);
}

export function formatarData(ts: string | Date | number): string {
  const date = parseDateInput(ts);
  if (isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIMEZONE_SAO_PAULO,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);
}

export function formatarDataHora(ts: string | Date | number): string {
  const date = parseDateInput(ts);
  if (isNaN(date.getTime())) return '';
  const data = formatarData(date);
  const hora = formatarHora(date);
  return `${data} ${hora}`;
}

export function calcularTermino(ts: string | Date | number, minutos: number): Date {
  const date = parseDateInput(ts);
  if (isNaN(date.getTime())) return new Date(NaN);
  return new Date(date.getTime() + minutos * 60 * 1000);
}

export function formatarIntervalo(ts: string | Date | number, minutos: number): string {
  const inicio = parseDateInput(ts);
  if (isNaN(inicio.getTime())) return '';
  const fim = calcularTermino(inicio, minutos);
  return `${formatarHora(inicio)} — ${formatarHora(fim)}`;
}

/**
 * Retorna a data no formato ISO YYYY-MM-DD ajustada para o fuso local America/Sao_Paulo.
 * Útil para queries e agrupamentos por dia.
 */
export function formatarDataIsoSP(ts: string | Date | number): string {
  const date = parseDateInput(ts);
  if (isNaN(date.getTime())) return '';
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE_SAO_PAULO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date); // en-CA retorna YYYY-MM-DD
  return partes;
}

/**
 * Converte string do input datetime-local (YYYY-MM-DDTHH:mm) para ISO com fuso horário -03:00.
 */
export function datetimeLocalToIsoSP(val: string): string {
  if (!val) return '';
  const normalized = val.length === 16 ? `${val}:00` : val;
  return `${normalized}-03:00`;
}

/**
 * Converte timestamp ISO para YYYY-MM-DDTHH:mm em America/Sao_Paulo para preenchimento de <input type="datetime-local">.
 */
export function isoToDatetimeLocalSP(ts: string | Date | number): string {
  const date = parseDateInput(ts);
  if (isNaN(date.getTime())) return '';

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE_SAO_PAULO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(date);
  const partMap: Record<string, string> = {};
  parts.forEach((p) => {
    partMap[p.type] = p.value;
  });

  const year = partMap.year || '1970';
  const month = partMap.month || '01';
  const day = partMap.day || '01';
  const hour = partMap.hour || '00';
  const minute = partMap.minute || '00';

  return `${year}-${month}-${day}T${hour}:${minute}`;
}

/**
 * Retorna o nome do dia da semana em português em America/Sao_Paulo (ex: "quinta", "sexta", "sábado").
 */
export function getNomeDiaSemanaSP(ts: string | Date | number): string {
  const date = parseDateInput(ts);
  if (isNaN(date.getTime())) return '';

  const dayEn = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE_SAO_PAULO,
    weekday: 'short'
  }).format(date);

  const map: Record<string, string> = {
    Sun: 'domingo',
    Mon: 'segunda',
    Tue: 'terça',
    Wed: 'quarta',
    Thu: 'quinta',
    Fri: 'sexta',
    Sat: 'sábado'
  };

  return map[dayEn] || '';
}

/**
 * Formata data e hora no padrão extenso com fuso America/Sao_Paulo: "quinta 20/08 às 16:30"
 */
export function formatarDataHoraResumoSP(ts: string | Date | number): string {
  const date = parseDateInput(ts);
  if (isNaN(date.getTime())) return '';

  const diaNome = getNomeDiaSemanaSP(date);
  const diaMes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIMEZONE_SAO_PAULO,
    day: '2-digit',
    month: '2-digit'
  }).format(date);

  const horaStr = formatarHora(date);

  return `${diaNome} ${diaMes} às ${horaStr}`;
}

/**
 * Combina uma data (YYYY-MM-DD) e um horário (HH:MM ou HH:MM:SS) em um timestamp ISO com offset -03:00.
 * Normaliza o horário se ele tiver apenas 5 caracteres (HH:MM) ou se já trouxer os segundos (HH:MM:SS).
 */
export function montarTimestampLocal(data: string, horario: string): string {
  if (!data || !horario) return '';
  const h = horario.trim();
  const horaNormalizada = h.length === 5 ? `${h}:00` : h;
  return `${data.trim()}T${horaNormalizada}-03:00`;
}


