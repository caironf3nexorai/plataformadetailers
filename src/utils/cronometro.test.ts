import { describe, it, expect } from 'vitest';
import { calcularSegundosDecorridos, obterNivelAlertaTempo } from './cronometro';
import { datetimeLocalToIsoSP, isoToDatetimeLocalSP } from './datas';

describe('cronometro utils', () => {
  it('calcula segundos decorridos corretamente', () => {
    const inicio = '2026-08-03T10:00:00-03:00';
    const fim = '2026-08-03T11:00:00-03:00'; // 1h = 3600s
    const decorrido = calcularSegundosDecorridos(inicio, 300, null, fim);
    expect(decorrido).toBe(3300); // 3600 - 300
  });

  it('retorna nível normal se serviço estiver finalizado', () => {
    const inicio = '2026-08-01T10:00:00-03:00';
    const fim = '2026-08-01T12:00:00-03:00';
    const info = obterNivelAlertaTempo(inicio, 60, 0, null, fim);
    expect(info.nivel).toBe('normal');
  });

  it('calcula o limite usando max(duracao * 2, 480min = 8h)', () => {
    // Para serviço curto de 60min, limite = max(120, 480) = 480min (8h)
    const inicioCurto = new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString(); // 9 horas atrás
    const infoCurto = obterNivelAlertaTempo(inicioCurto, 60);
    expect(infoCurto.nivel).toBe('alerta');

    // Para vitrificação de 8h (480min), limite = max(960, 480) = 960min (16h)
    const inicioLongo = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(); // 10 horas atrás (menos que 16h)
    const infoLongo = obterNivelAlertaTempo(inicioLongo, 480);
    expect(infoLongo.nivel).toBe('normal'); // Não deve alertar em 10h para um serviço de 8h!
  });

  it('dispara nível crítico para execuções abertas por mais de 24 horas', () => {
    const inicio25h = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const info = obterNivelAlertaTempo(inicio25h, 60);
    expect(info.nivel).toBe('critico');
    expect(info.decorridoHoras).toBeGreaterThanOrEqual(25);
  });
});

describe('datas SP timezone helpers', () => {
  it('converte datetime-local para ISO com sufixo -03:00', () => {
    const input = '2026-08-03T14:30';
    const iso = datetimeLocalToIsoSP(input);
    expect(iso).toBe('2026-08-03T14:30:00-03:00');
  });

  it('converte ISO para datetime-local no fuso SP', () => {
    const iso = '2026-08-03T17:30:00-03:00';
    const localStr = isoToDatetimeLocalSP(iso);
    expect(localStr).toBe('2026-08-03T17:30');
  });
});
