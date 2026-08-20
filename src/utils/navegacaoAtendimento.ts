import type { NavigateFunction } from 'react-router-dom';

/**
 * Retorna a rota da ficha de atendimento (/atendimento/:id) garantindo que um ID válido
 * (execucaoId ou agendamentoId) seja fornecido.
 * Retorna null se nenhum ID válido for informado.
 */
export function obterLinkAtendimento(
  execucaoId?: string | null,
  agendamentoId?: string | null
): string | null {
  const idValido = execucaoId || agendamentoId;
  if (!idValido || idValido === 'undefined' || idValido === 'null') {
    console.error('[navegacaoAtendimento] Tentativa de gerar link de atendimento com ID inválido/undefined:', {
      execucaoId,
      agendamentoId,
    });
    return null;
  }
  return `/atendimento/${idValido}`;
}

/**
 * Utilitário seguro para navegação até a ficha de atendimento (/atendimento/:id).
 * Impede navegação para rotas com ID 'undefined' ou 'null', exibindo aviso e logando erro.
 */
export function navegarParaAtendimento(
  navigate: NavigateFunction,
  execucaoId?: string | null,
  agendamentoId?: string | null
): void {
  const link = obterLinkAtendimento(execucaoId, agendamentoId);
  if (!link) {
    console.error('[navegacaoAtendimento] Bloqueando navegação para rota inválida.', { execucaoId, agendamentoId });
    return;
  }
  navigate(link);
}
