import { describe, it, expect } from 'vitest';
import {
  CORTESIA_DURACAO_OPCOES,
  adicionarDiasIsoSP,
  calcularDataFimCortesiaISO,
  calcularDiasRestantesISO,
  formatarDataSegura,
  obterResumoStatusAssinatura,
  podeCancelarAssinaturaNoAsaas,
} from './assinatura';

describe('Utilitários de Assinatura & Cortesia', () => {
  it('CORTESIA_DURACAO_OPCOES deve conter os prazos padrão exigidos (15d, 30d, 3m, 6m, 1a e sem prazo)', () => {
    const dias = CORTESIA_DURACAO_OPCOES.map((o) => o.dias);
    expect(dias).toEqual([15, 30, 90, 180, 365, null]);
  });

  it('adicionarDiasIsoSP deve somar dias sem deslocamento de fuso UTC ou virada de mês/ano', () => {
    expect(adicionarDiasIsoSP('2026-10-18', 15)).toBe('2026-11-02');
    expect(adicionarDiasIsoSP('2026-11-11', 30)).toBe('2026-12-11');
    expect(adicionarDiasIsoSP('2026-11-11', 365)).toBe('2027-11-11');
  });

  it('calcularDataFimCortesiaISO deve retornar null para cortesia sem prazo e data ISO para prazos finitos', () => {
    expect(calcularDataFimCortesiaISO(null, '2026-11-11')).toBeNull();
    expect(calcularDataFimCortesiaISO(0, '2026-11-11')).toBeNull();
    expect(calcularDataFimCortesiaISO(-5, '2026-11-11')).toBeNull();
    expect(calcularDataFimCortesiaISO(15, '2026-11-11')).toBe('2026-11-26');
    expect(calcularDataFimCortesiaISO(90, '2026-11-11')).toBe('2027-02-09');
  });

  it('calcularDiasRestantesISO deve retornar 0 quando vencido e contagem exata quando futuro', () => {
    expect(calcularDiasRestantesISO('2026-11-26', '2026-11-11')).toBe(15);
    expect(calcularDiasRestantesISO('2026-11-11', '2026-11-11')).toBe(0);
    expect(calcularDiasRestantesISO('2026-10-18', '2026-11-11')).toBe(0);
    expect(calcularDiasRestantesISO(null, '2026-11-11')).toBeNull();
  });

  it('formatarDataSegura deve formatar YYYY-MM-DD em pt-BR sem voltar um dia no fuso America/Sao_Paulo', () => {
    expect(formatarDataSegura('2026-10-18')).toBe('18/10/2026');
    expect(formatarDataSegura(null)).toBe('—');
  });

  it('podeCancelarAssinaturaNoAsaas só deve permitir cancelar assinaturas pagas com subscription ID no Asaas', () => {
    expect(podeCancelarAssinaturaNoAsaas({ status: 'ativa', asaas_subscription_id: 'sub_123' })).toBe(true);
    expect(podeCancelarAssinaturaNoAsaas({ status: 'atrasada', asaas_subscription_id: 'sub_123' })).toBe(true);
    expect(podeCancelarAssinaturaNoAsaas({ status: 'cortesia', asaas_subscription_id: null })).toBe(false);
    expect(podeCancelarAssinaturaNoAsaas({ status: 'trial', asaas_subscription_id: null })).toBe(false);
    expect(
      podeCancelarAssinaturaNoAsaas({
        status: 'ativa',
        asaas_subscription_id: 'sub_123',
        cancelada_em: '2026-11-01T12:00:00Z',
      })
    ).toBe(false);
  });

  it('obterResumoStatusAssinatura deve distinguir cortesia admin, ativa paga, trial, atrasada e free', () => {
    expect(obterResumoStatusAssinatura('cortesia', { isCortesia: true, plano: 'pro' })).toMatchObject({
      statusEfetivo: 'cortesia',
      label: 'CORTESIA ADMIN',
      isCortesia: true,
    });
    expect(obterResumoStatusAssinatura('ativa', { isCortesia: false, plano: 'pro' })).toMatchObject({
      statusEfetivo: 'ativa',
      label: 'ATIVA (REGULAR)',
      isCortesia: false,
    });
    expect(obterResumoStatusAssinatura('ativa', { isCortesia: false, plano: 'free' })).toMatchObject({
      statusEfetivo: 'cancelada',
      label: 'PLANO GRATUITO',
      isCortesia: false,
    });
  });
});
