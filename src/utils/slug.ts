export const SLUGS_RESERVADOS = new Set([
  'admin',
  'api',
  'app',
  'agendar',
  'agenda',
  'hoje',
  'dashboard',
  'orcamento',
  'orcamentos',
  'vistoria',
  'checkin',
  'execucao',
  'atendimento',
  'termo-risco',
  'garantia',
  'certificado',
  'calculadora',
  'entrar',
  'login',
  'criar-conta',
  'cadastro',
  'convite',
  'lancamento',
  'parceiro',
  'recuperar-senha',
  'redefinir-senha',
  'nova-oficina',
  'termos-de-uso',
  'termos-uso',
  'politica-de-privacidade',
  'politica-privacidade',
  'clientes',
  'veiculos',
  'estoque',
  'financeiro',
  'servicos',
  'precificacao',
  'treinamentos',
  'arquivos-digitais',
  'indique',
  'diluicao',
  'planos',
  'configuracoes',
  'suporte',
  'ajuda',
  'nuvemwash',
]);

/**
 * Sanitiza um texto livre para o formato padrão de slug URL (lowercase ASCII sem acentos).
 */
export function sanitizarSlug(valor: string): string {
  return (valor || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Normaliza durante a digitação preservando um único hífen intermediário no cursor final,
 * para não atrapalhar a digitação de palavras compostas.
 */
export function sanitizarSlugAoDigitar(valor: string): string {
  return (valor || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '');
}

export interface ValidacaoSlugResultado {
  valido: boolean;
  slugSanitizado: string;
  erro: string | null;
}

export function validarSlugOficina(
  valor: string,
  slugAtual?: string | null
): ValidacaoSlugResultado {
  const slugSanitizado = sanitizarSlug(valor);

  if (!slugSanitizado || slugSanitizado.length < 3) {
    return {
      valido: false,
      slugSanitizado,
      erro: 'O endereço (slug) deve ter pelo menos 3 caracteres válidos.',
    };
  }

  if (slugSanitizado.length > 60) {
    return {
      valido: false,
      slugSanitizado,
      erro: 'O endereço (slug) pode ter no máximo 60 caracteres.',
    };
  }

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slugSanitizado)) {
    return {
      valido: false,
      slugSanitizado,
      erro: 'Use apenas letras minúsculas, números e hífens simples.',
    };
  }

  if (SLUGS_RESERVADOS.has(slugSanitizado)) {
    return {
      valido: false,
      slugSanitizado,
      erro: 'Este endereço é reservado pela plataforma. Escolha outro nome para o link.',
    };
  }

  if (slugAtual && slugSanitizado === sanitizarSlug(slugAtual)) {
    return {
      valido: false,
      slugSanitizado,
      erro: 'O novo endereço é idêntico ao atual.',
    };
  }

  return {
    valido: true,
    slugSanitizado,
    erro: null,
  };
}

