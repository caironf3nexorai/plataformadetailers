import { describe, it, expect } from 'vitest';
import { analisarUrlVideo, formatarTempoVideo } from './PlayerVideoSeguro';

describe('PlayerVideoSeguro - Utilitários de Segurança e Extração de URL', () => {
  it('identifica e extrai corretamente URL padrão do YouTube com controls=0 e sem logo do YouTube', () => {
    const res = analisarUrlVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(res.plataforma).toBe('youtube');
    expect(res.videoId).toBe('dQw4w9WgXcQ');
    expect(res.embedUrl).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(res.embedUrl).toContain('rel=0');
    expect(res.embedUrl).toContain('modestbranding=1');
    expect(res.embedUrl).toContain('enablejsapi=1');
    expect(res.embedUrl).toContain('controls=0');
    expect(res.embedUrl).toContain('disablekb=1');
    expect(res.embedUrl).toContain('fs=0');
    expect(res.embedUrl).toContain('cc_load_policy=0');
    expect(res.embedUrl).toContain('cc_lang_pref=off');
  });

  it('adiciona parâmetro de start quando tempoInicial é informado', () => {
    const res = analisarUrlVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 45);
    expect(res.embedUrl).toContain('&start=45');
  });

  it('adiciona parâmetro end quando tempoFinal é maior que tempoInicial', () => {
    const res = analisarUrlVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 30, false, 75);
    expect(res.embedUrl).toContain('&start=30');
    expect(res.embedUrl).toContain('&end=75');
  });

  it('ignora parâmetro end quando tempoFinal não é maior que tempoInicial', () => {
    const res = analisarUrlVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 60, false, 45);
    expect(res.embedUrl).toContain('&start=60');
    expect(res.embedUrl).not.toContain('&end=');
  });

  it('identifica e extrai URL encurtada do YouTube youtu.be', () => {
    const res = analisarUrlVideo('https://youtu.be/dQw4w9WgXcQ?si=abcdef');
    expect(res.plataforma).toBe('youtube');
    expect(res.videoId).toBe('dQw4w9WgXcQ');
    expect(res.embedUrl).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(res.embedUrl).toContain('controls=0');
  });

  it('identifica e extrai YouTube Shorts', () => {
    const res = analisarUrlVideo('https://www.youtube.com/shorts/dQw4w9WgXcQ');
    expect(res.plataforma).toBe('youtube');
    expect(res.videoId).toBe('dQw4w9WgXcQ');
    expect(res.embedUrl).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ');
  });

  it('identifica e extrai URL do Vimeo', () => {
    const res = analisarUrlVideo('https://vimeo.com/76979871');
    expect(res.plataforma).toBe('vimeo');
    expect(res.videoId).toBe('76979871');
    expect(res.embedUrl).toContain('player.vimeo.com/video/76979871');
    expect(res.embedUrl).toContain('controls=0');
  });

  it('identifica arquivo direto de vídeo (.mp4 / .webm)', () => {
    const res = analisarUrlVideo('https://meuservidor.com/video.mp4?token=123');
    expect(res.plataforma).toBe('arquivo');
    expect(res.embedUrl).toBe('https://meuservidor.com/video.mp4?token=123');
  });

  it('formata tempo em mm:ss e hh:mm:ss corretamente', () => {
    expect(formatarTempoVideo(0)).toBe('00:00');
    expect(formatarTempoVideo(65)).toBe('01:05');
    expect(formatarTempoVideo(3665)).toBe('1:01:05');
  });
});
