import { describe, it, expect } from 'vitest';
import { sanitizarSlug, sanitizarSlugAoDigitar, validarSlugOficina } from './slug';

describe('slug utilities', () => {
  it('sanitiza acentos, espaços e símbolos em slug limpo', () => {
    expect(sanitizarSlug('  Estética Automotiva São José!  ')).toBe('estetica-automotiva-sao-jose');
    expect(sanitizarSlug('Auto--Spa__VIP 2026')).toBe('auto-spa-vip-2026');
  });

  it('preserva hífen final durante digitação mas remove no início', () => {
    expect(sanitizarSlugAoDigitar('-Estética-')).toBe('estetica-');
    expect(sanitizarSlugAoDigitar('detail car ')).toBe('detail-car-');
  });

  it('rejeita slugs curtos, reservados ou iguais ao atual', () => {
    expect(validarSlugOficina('ab').valido).toBe(false);
    expect(validarSlugOficina('admin').valido).toBe(false);
    expect(validarSlugOficina('agendar').valido).toBe(false);
    expect(validarSlugOficina('estetica-silva', 'estetica-silva').valido).toBe(false);

    const valido = validarSlugOficina('Estética Silva Custom', 'estetica-silva-42edbd');
    expect(valido.valido).toBe(true);
    expect(valido.slugSanitizado).toBe('estetica-silva-custom');
    expect(valido.erro).toBeNull();
  });
});

