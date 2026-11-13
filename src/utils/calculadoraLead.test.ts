import { describe, expect, it } from 'vitest';
import {
  construirUrlCadastroComLead,
  MOMENTOS_ESTETICA,
  normalizarEmbedVideoUrl,
  validarFormularioLead,
} from './calculadoraLead';

describe('calculadoraLead', () => {
  it('valida dados corretos e normaliza whatsapp/email', () => {
    const res = validarFormularioLead({
      nome: '  Carlos Detailer  ',
      whatsapp: '11987654321',
      email: ' Carlos@Studio.com.br ',
      momento_estetica: MOMENTOS_ESTETICA[1],
    });

    expect(res.valido).toBe(true);
    expect(res.erros).toEqual({});
    expect(res.normalizado).toEqual({
      nome: 'Carlos Detailer',
      whatsapp: '(11) 98765-4321',
      email: 'carlos@studio.com.br',
      momento_estetica: 'Estética montada (1 a 2 pessoas)',
    });
  });

  it('retorna erros específicos para campos inválidos', () => {
    const res = validarFormularioLead({
      nome: 'A',
      whatsapp: '11999',
      email: 'invalido',
      momento_estetica: 'Outro',
    });

    expect(res.valido).toBe(false);
    expect(res.erros.nome).toBeDefined();
    expect(res.erros.whatsapp).toBeDefined();
    expect(res.erros.email).toBeDefined();
    expect(res.erros.momento_estetica).toBeDefined();
  });

  it('converte URLs de YouTube, Vimeo e Panda Video para embed', () => {
    expect(normalizarEmbedVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1'
    );
    expect(normalizarEmbedVideoUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1'
    );
    expect(normalizarEmbedVideoUrl('https://www.youtube.com/shorts/abc123XYZ')).toBe(
      'https://www.youtube-nocookie.com/embed/abc123XYZ?rel=0&modestbranding=1'
    );
    expect(normalizarEmbedVideoUrl('https://vimeo.com/123456789')).toBe(
      'https://player.vimeo.com/video/123456789'
    );
    expect(
      normalizarEmbedVideoUrl('https://player-vz-abc.tv.pandavideo.com.br/embed/?v=1234')
    ).toBe('https://player-vz-abc.tv.pandavideo.com.br/embed/?v=1234');
    expect(normalizarEmbedVideoUrl('')).toBeNull();
  });

  it('monta URL de cadastro com nome, email, whatsapp e origem', () => {
    const url = construirUrlCadastroComLead({
      nome: 'Carlos Silva',
      email: 'CARLOS@DETAIL.COM',
      whatsapp: '11988887777',
      leadId: 'uuid-123',
    });

    expect(url).toMatch(/^\/(register|criar-conta)\?/);
    expect(url).toContain('origem=calculadora');
    expect(url).toContain('nome=Carlos+Silva');
    expect(url).toContain('email=carlos%40detail.com');
    expect(url).toContain('whatsapp=%2811%29+98888-7777');
    expect(url).toContain('lead_id=uuid-123');
  });
});

