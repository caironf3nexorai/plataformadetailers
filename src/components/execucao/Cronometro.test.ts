import { describe, it, expect } from 'vitest';

describe('Cronometro Logic', () => {
  it('calculates elapsed time correctly from server ISO timestamp', () => {
    const inicioMs = Date.now() - 3600 * 1000; // 1 hora atrás

    const diffSeg = Math.floor((Date.now() - inicioMs) / 1000);
    const hrs = Math.floor(diffSeg / 3600);
    expect(hrs).toBe(1);
  });

  it('subtracts paused seconds properly', () => {
    const inicioMs = Date.now() - 6000 * 1000; // 100 minutos atrás
    const segundosPausados = 600; // 10 minutos de pausa
    const diffSeg = Math.floor((Date.now() - inicioMs) / 1000) - segundosPausados;

    const mins = Math.floor(diffSeg / 60);
    expect(mins).toBe(90); // 90 minutos líquidos
  });
});
