import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initMetaPixel, getInitializedMetaPixels, trackPageView, trackCompleteRegistration } from './pixel';

describe('Pixel Utilities - Suporte a Multi-Pixel (Meta / Facebook)', () => {
  beforeEach(() => {
    (globalThis as any).window = {
      location: { pathname: '/' },
      fbq: vi.fn(),
    };
    (globalThis as any).document = {
      createElement: vi.fn(() => ({})),
      getElementsByTagName: vi.fn(() => [{ parentNode: { insertBefore: vi.fn() } }]),
    };
  });

  it('inicializa corretamente um único pixel ID', () => {
    initMetaPixel('1148159047650275');
    const initialized = getInitializedMetaPixels();
    expect(initialized).toContain('1148159047650275');
    expect((globalThis as any).window.fbq).toHaveBeenCalledWith('init', '1148159047650275');
  });

  it('inicializa múltiplos pixels separados por vírgula em uma única string', () => {
    initMetaPixel('222333444555666, 777888999000111');
    const initialized = getInitializedMetaPixels();
    expect(initialized).toContain('222333444555666');
    expect(initialized).toContain('777888999000111');
    expect((globalThis as any).window.fbq).toHaveBeenCalledWith('init', '222333444555666');
    expect((globalThis as any).window.fbq).toHaveBeenCalledWith('init', '777888999000111');
  });

  it('ignora IDs duplicados e não reinicializa o mesmo pixel mais de uma vez', () => {
    const callCountBefore = (globalThis as any).window.fbq.mock.calls.filter((c: any[]) => c[0] === 'init' && c[1] === '1148159047650275').length;
    initMetaPixel('1148159047650275');
    const callCountAfter = (globalThis as any).window.fbq.mock.calls.filter((c: any[]) => c[0] === 'init' && c[1] === '1148159047650275').length;
    expect(callCountAfter).toBe(callCountBefore);
  });

  it('dispara eventos de conversão e pageview via fbq', () => {
    trackPageView('/criar-conta');
    expect((globalThis as any).window.fbq).toHaveBeenCalledWith('track', 'PageView');

    trackCompleteRegistration({ status: 'sucesso' });
    expect((globalThis as any).window.fbq).toHaveBeenCalledWith(
      'track',
      'CompleteRegistration',
      expect.objectContaining({
        content_name: 'Cadastro NuvemWash',
        status: 'sucesso',
      })
    );
  });
});
