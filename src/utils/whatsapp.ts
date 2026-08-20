/**
 * Utilitários para formatação de telefones e geração de links de agendamento no WhatsApp.
 */

/**
 * Limpa o telefone mantendo apenas os dígitos e garante o DDI 55 (Brasil).
 * Retorna null para valores nulos, vazios ou inválidos (< 10 dígitos).
 */
export function formatarTelefoneWhatsapp(telefone: string | null | undefined): string | null {
  if (!telefone) return null;

  // Remove tudo que não for dígito
  const digitos = telefone.replace(/\D/g, '');

  if (digitos.length < 10) return null;

  // Se já começar com 55 e tiver tamanho de número brasileiro completo (12 ou 13 dígitos), mantém
  if (digitos.startsWith('55') && (digitos.length === 12 || digitos.length === 13)) {
    return digitos;
  }

  return `55${digitos}`;
}

/**
 * Monta o texto de agendamento padronizado.
 * Ex: "Olá! Vi o catálogo e quero agendar Polimento para meu SUV."
 * Ex sem categoria: "Olá! Vi o catálogo e quero agendar Polimento."
 */
export function montarMensagemAgendamento(servicoNome: string, categoriaNome?: string | null): string {
  const servico = servicoNome?.trim() || 'um serviço';
  const categoria = categoriaNome?.trim();

  if (categoria) {
    return `Olá! Vi o catálogo e quero agendar ${servico} para meu ${categoria}.`;
  }

  return `Olá! Vi o catálogo e quero agendar ${servico}.`;
}

/**
 * Monta a URL completa do WhatsApp (https://wa.me/55...?text=...)
 * Retorna null se o telefone for nulo ou inválido.
 */
export function montarLinkWhatsapp(telefone: string | null | undefined, mensagem: string): string | null {
  const numFormatado = formatarTelefoneWhatsapp(telefone);
  if (!numFormatado) return null;

  const msgEncoded = encodeURIComponent(mensagem);
  return `https://wa.me/${numFormatado}?text=${msgEncoded}`;
}
