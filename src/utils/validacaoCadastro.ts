/**
 * Utilitários de Validação para Cadastro de Contas
 * - Bloqueio de e-mails descartáveis, temporários ou de teste óbvio
 * - Validação rigorosa de WhatsApp brasileiro com DDD real e anti-sequência
 */

/**
 * Lista de domínios conhecidos de e-mails descartáveis, temporários ou de teste óbvio.
 */
export const DOMINIOS_EMAIL_DESCARTAVEIS: readonly string[] = [
  'teste.com',
  'test.com',
  'example.com',
  'example.org',
  'example.net',
  'mailinator.com',
  'yopmail.com',
  '10minutemail.com',
  'guerrillamail.com',
  'tempmail.com',
  'throwawaymail.com',
  'sharklasers.com',
  'dispostable.com',
  'getairmail.com',
  'mohmal.com',
  'fakeinbox.com',
  'trashmail.com',
  'nada.ltd',
  'temp-mail.org',
  'emailfake.com',
  'generator.email',
  'crazymailing.com',
  'armyspy.com',
  'cuvox.de',
  'dayrep.com',
  'fleckens.hu',
  'gustr.com',
  'jourrapide.com',
  'rhyta.com',
  'superrito.com',
  'teleworm.us',
  'tinad.org',
];

/**
 * Prefixos comuns usados por curiosos/testes antes do @
 * Ex: teste@, test@, asdf@, aaa@, 123@, fake@, etc.
 */
export const PREFIXOS_TESTE_REGEX = /^(teste|test|asdf|aaa+|123+|fake|naoexiste|abc|exemplo)(\d*|\..*)?$/i;

/**
 * DDDs oficiais de operadoras telefônicas ativas no Brasil.
 */
export const DDDS_VALIDOS_BRASIL: ReadonlySet<number> = new Set([
  // SP
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  // RJ e ES
  21, 22, 24, 27, 28,
  // MG
  31, 32, 33, 34, 35, 37, 38,
  // PR e SC
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  // RS
  51, 53, 54, 55,
  // Centro-Oeste / Norte (DF, GO, TO, MT, MS, AC, RO)
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  // Bahia e Sergipe
  71, 73, 74, 75, 77, 79,
  // Nordeste (PE, AL, PB, RN, CE, PI)
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  // Norte / Maranhão (PA, AP, AM, RR, MA)
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export interface ResultadoValidacao {
  valido: boolean;
  erro?: string;
}

/**
 * Validação de e-mail com bloqueio de provedores descartáveis e prefixos óbvios de teste.
 */
export function validarEmailReal(email: string): ResultadoValidacao {
  const limpo = (email || '').trim().toLowerCase();
  if (!limpo) {
    return { valido: false, erro: 'Informe um e-mail válido.' };
  }

  // Formato básico de e-mail RFC simplificado
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(limpo)) {
    return { valido: false, erro: 'Formato de e-mail inválido. Verifique o endereço digitado.' };
  }

  const partes = limpo.split('@');
  if (partes.length !== 2) {
    return { valido: false, erro: 'Formato de e-mail inválido.' };
  }

  const [localPart, domain] = partes;

  // 1. Checa domínio descartável ou de teste
  if (DOMINIOS_EMAIL_DESCARTAVEIS.includes(domain)) {
    return {
      valido: false,
      erro: 'Por favor, informe um e-mail comercial ou pessoal real para ter acesso à plataforma.',
    };
  }

  // 2. Checa prefixo óbvio de teste (ex: teste@, test@, asdf@, 123@, etc.)
  if (PREFIXOS_TESTE_REGEX.test(localPart)) {
    return {
      valido: false,
      erro: 'Por favor, informe seu e-mail real (não temporário) para criar sua conta.',
    };
  }

  return { valido: true };
}

/**
 * Validação de WhatsApp brasileiro:
 * - Obrigatório (não vazio)
 * - Exatamente 11 dígitos (DDD 2 dígitos + celular de 9 dígitos começando com 9)
 * - DDD pertencente à lista de DDDs ativos no Brasil
 * - Bloqueio de sequências repetidas (ex: 99999-9999, 11111-1111) ou sequenciais óbvias
 */
export function validarWhatsAppBrasileiro(telefone: string): ResultadoValidacao {
  const digits = (telefone || '').replace(/\D/g, '');

  if (!digits) {
    return { valido: false, erro: 'O WhatsApp é obrigatório para contato e suporte da sua oficina.' };
  }

  if (digits.length !== 11) {
    return {
      valido: false,
      erro: 'Informe um WhatsApp válido com DDD + 9 dígitos (ex: (11) 98765-4321).',
    };
  }

  const ddd = parseInt(digits.substring(0, 2), 10);
  if (!DDDS_VALIDOS_BRASIL.has(ddd)) {
    return {
      valido: false,
      erro: `O DDD (${ddd}) não é válido no Brasil. Informe um DDD de operadora válido.`,
    };
  }

  // No Brasil, celular com WhatsApp sempre inicia com 9 após o DDD
  const primeiroDigitoNumero = digits.charAt(2);
  if (primeiroDigitoNumero !== '9') {
    return {
      valido: false,
      erro: 'O número de WhatsApp deve iniciar com o dígito 9 após o DDD (ex: (11) 98765-4321).',
    };
  }

  // Bloqueio de todos os dígitos repetidos (ex: 11111111111, 99999999999)
  if (new Set(digits).size <= 2) {
    return {
      valido: false,
      erro: 'Por favor, informe um número de WhatsApp real e ativo (sequência repetida detectada).',
    };
  }

  // Bloqueio de número com os 9 dígitos do celular todos iguais (ex: 11999999999, 11988888888)
  const corpoNumero = digits.substring(2);
  if (new Set(corpoNumero).size <= 1) {
    return {
      valido: false,
      erro: 'Por favor, informe um número de WhatsApp real e ativo.',
    };
  }

  // Bloqueio de repetição nos últimos 8 dígitos (ex: 11 9 9999-9999, 11 9 1111-1111, 11 9 0000-0000)
  const ultimos8 = digits.substring(3);
  if (new Set(ultimos8).size === 1) {
    return {
      valido: false,
      erro: 'Por favor, informe um número de WhatsApp real e ativo (sequência repetida detectada).',
    };
  }

  // Sequências óbvias sequenciais
  if (
    corpoNumero === '987654321' ||
    corpoNumero === '912345678' ||
    digits === '11912345678' ||
    digits === '11987654321'
  ) {
    return {
      valido: false,
      erro: 'Por favor, informe um número de WhatsApp real.',
    };
  }

  return { valido: true };
}

