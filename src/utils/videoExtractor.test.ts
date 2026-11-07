import { describe, it, expect } from 'vitest';
import { parseVideoUrl, getEmbedUrl } from './videoExtractor';

describe('videoExtractor - Suporte Híbrido: YouTube, Vimeo e Arquivos Nativos MP4', () => {
  it('identifica e extrai links padrão do YouTube', () => {
    const res = parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(res.plataforma).toBe('youtube');
    expect(res.video_id).toBe('dQw4w9WgXcQ');
    expect(res.embedUrl).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ');
  });

  it('identifica e extrai links encurtados youtu.be', () => {
    const res = parseVideoUrl('https://youtu.be/dQw4w9WgXcQ');
    expect(res.plataforma).toBe('youtube');
    expect(res.video_id).toBe('dQw4w9WgXcQ');
  });

  it('identifica links do Vimeo', () => {
    const res = parseVideoUrl('https://vimeo.com/76979871');
    expect(res.plataforma).toBe('vimeo');
    expect(res.video_id).toBe('76979871');
  });

  it('identifica e extrai arquivos de vídeo MP4 nativos (Hospedagem na Plataforma)', () => {
    const res = parseVideoUrl('https://meusite.com/storage/v1/object/public/academia-materiais/aula1.mp4');
    expect(res.plataforma).toBe('arquivo');
    expect(res.video_id).toBe('https://meusite.com/storage/v1/object/public/academia-materiais/aula1.mp4');
    expect(res.embedUrl).toBe('https://meusite.com/storage/v1/object/public/academia-materiais/aula1.mp4');
  });

  it('retorna a URL de embed correta em getEmbedUrl para arquivos nativos', () => {
    const url = 'https://meusite.com/storage/aula.mp4';
    expect(getEmbedUrl('arquivo', url)).toBe(url);
  });

  it('lança erro para links inválidos ou não reconhecidos', () => {
    expect(() => parseVideoUrl('https://google.com')).toThrow();
  });
});
