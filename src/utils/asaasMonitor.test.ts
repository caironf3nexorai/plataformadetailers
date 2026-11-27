import { describe, it, expect } from 'vitest';
import {
  classificarSaudeWebhookAsaas,
  calcularDataIsoDeslocada,
  formatarDataHoraPtBr,
} from './asaasMonitor';

describe('asaasMonitor', () => {
  it('classifica como interrompido quando ha webhook com interrupted=true ao vivo', () => {
    const res = classificarSaudeWebhookAsaas({
      webhooksAoVivo: [
        {
          id: 'wh_1',
          name: 'Asaas Prod',
          url: 'https://proj.supabase.co/functions/v1/asaas-webhook',
          email: 'admin@teste.com',
          enabled: true,
          interrupted: true,
          events: ['PAYMENT_RECEIVED'],
        },
      ],
    });
    expect(res.nivel).toBe('interrompido');
    expect(res.precisaReativar).toBe(true);
  });

  it('classifica como interrompido quando enabled=false mesmo com interrupted=false', () => {
    const res = classificarSaudeWebhookAsaas({
      webhooksAoVivo: [
        {
          id: 'wh_2',
          name: 'Asaas Prod',
          url: 'https://proj.supabase.co/functions/v1/asaas-webhook',
          email: null,
          enabled: false,
          interrupted: false,
          events: [],
        },
      ],
    });
    expect(res.nivel).toBe('interrompido');
    expect(res.precisaReativar).toBe(true);
  });

  it('classifica como saudavel quando todos os webhooks estao ativos e nao interrompidos', () => {
    const res = classificarSaudeWebhookAsaas({
      webhooksAoVivo: [
        {
          id: 'wh_3',
          name: 'Asaas Prod',
          url: 'https://proj.supabase.co/functions/v1/asaas-webhook',
          email: null,
          enabled: true,
          interrupted: false,
          events: ['PAYMENT_CONFIRMED'],
        },
      ],
    });
    expect(res.nivel).toBe('saudavel');
    expect(res.precisaReativar).toBe(false);
  });

  it('classifica como sem_webhook quando a lista ao vivo esta vazia', () => {
    const res = classificarSaudeWebhookAsaas({ webhooksAoVivo: [] });
    expect(res.nivel).toBe('sem_webhook');
    expect(res.precisaReativar).toBe(false);
  });

  it('usa a ultima checagem persistida como fallback quando nao ha consulta ao vivo', () => {
    const res = classificarSaudeWebhookAsaas({
      ultimaChecagem: {
        webhook_saudavel: false,
        webhooks_total: 1,
        webhooks_interrompidos: 1,
        resumo_mensagem: '1 webhook interrompido',
      },
    });
    expect(res.nivel).toBe('interrompido');
    expect(res.precisaReativar).toBe(true);
  });

  it('retorna desconhecido quando nao ha dados ao vivo nem historico', () => {
    const res = classificarSaudeWebhookAsaas({});
    expect(res.nivel).toBe('desconhecido');
    expect(res.precisaReativar).toBe(false);
  });

  it('calcula data deslocada em formato YYYY-MM-DD', () => {
    const ref = new Date(2026, 10, 27, 12, 0, 0); // 2026-11-27
    expect(calcularDataIsoDeslocada(0, ref)).toBe('2026-11-27');
    expect(calcularDataIsoDeslocada(-15, ref)).toBe('2026-11-12');
  });

  it('formata data invalida ou nula com traco', () => {
    expect(formatarDataHoraPtBr(null)).toBe('—');
    expect(formatarDataHoraPtBr('invalido')).toBe('—');
  });
});
