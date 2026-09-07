import { lazy, type ComponentType } from 'react';

/**
 * Utilitário de carregamento tardio (lazy) com auto-recuperação de cache e novos deploys.
 * 
 * Quando um novo deploy ocorre na Vercel/CDN, chunks JS antigos podem ser purgados do servidor.
 * Caso o usuário esteja com uma aba aberta navegando com referências antigas, o lazyWithRetry
 * intercepta a falha de download do módulo dinâmico e recarrega a página automaticamente
 * para sincronizar o bundle com a versão mais recente.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  componentImport: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    const isRetried = window.sessionStorage.getItem('chunk_reload_retry') === 'true';

    try {
      const component = await componentImport();
      window.sessionStorage.removeItem('chunk_reload_retry');
      return component;
    } catch (error: any) {
      const isDynamicImportError =
        error?.message?.includes('Failed to fetch dynamically imported module') ||
        error?.message?.includes('error loading dynamically imported module') ||
        error?.name === 'TypeError';

      if (!isRetried && isDynamicImportError) {
        console.warn('[lazyWithRetry] Detectado novo bundle na nuvem. Recarregando a aplicação...');
        window.sessionStorage.setItem('chunk_reload_retry', 'true');
        window.location.reload();
        // Retorna promessa pendente para evitar renderizar erro antes do reload
        return new Promise<{ default: T }>(() => {});
      }

      window.sessionStorage.removeItem('chunk_reload_retry');
      throw error;
    }
  });
}
