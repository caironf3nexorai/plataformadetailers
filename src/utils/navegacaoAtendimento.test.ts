import { describe, it, expect, vi } from 'vitest';
import { obterLinkAtendimento, navegarParaAtendimento } from './navegacaoAtendimento';

describe('navegacaoAtendimento', () => {
  it('obterLinkAtendimento usa execucaoId prioritariamente', () => {
    const link = obterLinkAtendimento('exec-123', 'agend-456');
    expect(link).toBe('/atendimento/exec-123');
  });

  it('obterLinkAtendimento usa agendamentoId como fallback quando execucaoId for ausente', () => {
    const link = obterLinkAtendimento(null, 'agend-456');
    expect(link).toBe('/atendimento/agend-456');
  });

  it('obterLinkAtendimento retorna null para IDs indefinidos ou strings "undefined"', () => {
    expect(obterLinkAtendimento(undefined, undefined)).toBeNull();
    expect(obterLinkAtendimento('undefined', 'null')).toBeNull();
    expect(obterLinkAtendimento('', '')).toBeNull();
  });

  it('navegarParaAtendimento chama navigate quando ID for valido', () => {
    const navigateMock = vi.fn();
    navegarParaAtendimento(navigateMock, 'exec-999');
    expect(navigateMock).toHaveBeenCalledWith('/atendimento/exec-999');
  });

  it('navegarParaAtendimento bloqueia navegacao e nao chama navigate se ID for invalido', () => {
    const navigateMock = vi.fn();

    navegarParaAtendimento(navigateMock, undefined, undefined);

    expect(navigateMock).not.toHaveBeenCalled();
  });
});
