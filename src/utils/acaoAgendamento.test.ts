import { describe, it, expect } from 'vitest';
import { obterAcaoAgendamento } from './acaoAgendamento';
import type { Agendamento } from '../types/agenda';

describe('obterAcaoAgendamento', () => {
  const mockAgendamento: Agendamento = {
    id: 'ag-123',
    tenant_id: 'ten-123',
    cliente_id: 'cli-123',
    veiculo_id: 'vei-123',
    servico_id: 'ser-123',
    categoria_id: 'cat-123',
    inicio: '2026-08-02T10:00:00-03:00',
    status: 'agendado',
    duracao_minutos: 60,
    preco_estimado: 100,
    modo_ocupacao: 'slot',
    dias_ocupados: 1,
    origem: 'interno',
    created_at: '2026-08-02T10:00:00-03:00',
    updated_at: '2026-08-02T10:00:00-03:00',
  };

  it('retorna nenhuma para agendamento cancelado', () => {
    const res = obterAcaoAgendamento({
      agendamento: { ...mockAgendamento, status: 'cancelado' },
      checkinInfo: { id: 'chk-1', finalizado: false },
      execucaoInfo: null,
    });
    expect(res.tipo).toBe('nenhuma');
    expect(res.label).toBe('');
  });

  it('retorna nenhuma para agendamento não compareceu', () => {
    const res = obterAcaoAgendamento({
      agendamento: { ...mockAgendamento, status: 'nao_compareceu' },
      checkinInfo: { id: 'chk-1', finalizado: false },
      execucaoInfo: null,
    });
    expect(res.tipo).toBe('nenhuma');
    expect(res.label).toBe('');
  });

  it('retorna fazer_vistoria quando não há checkin', () => {
    const res = obterAcaoAgendamento({
      agendamento: mockAgendamento,
      checkinInfo: null,
      execucaoInfo: null,
    });
    expect(res.tipo).toBe('fazer_vistoria');
    expect(res.label).toBe('Fazer vistoria');
  });

  it('retorna continuar_vistoria quando vistoria não está finalizada', () => {
    const res = obterAcaoAgendamento({
      agendamento: mockAgendamento,
      checkinInfo: { id: 'chk-1', finalizado: false },
      execucaoInfo: null,
    });
    expect(res.tipo).toBe('continuar_vistoria');
    expect(res.label).toBe('Continuar vistoria');
  });

  it('retorna iniciar_servico quando vistoria está finalizada e serviço não iniciado', () => {
    const res = obterAcaoAgendamento({
      agendamento: mockAgendamento,
      checkinInfo: { id: 'chk-1', finalizado: true },
      execucaoInfo: null,
    });
    expect(res.tipo).toBe('iniciar_servico');
    expect(res.label).toBe('Iniciar serviço');
  });

  it('retorna continuar_servico quando serviço está em andamento', () => {
    const res = obterAcaoAgendamento({
      agendamento: { ...mockAgendamento, status: 'em_andamento' },
      checkinInfo: { id: 'chk-1', finalizado: true },
      execucaoInfo: { id: 'exec-1', status: 'em_andamento', valor_total_final: null },
    });
    expect(res.tipo).toBe('continuar_servico');
    expect(res.label).toBe('Continuar serviço');
  });

  it('retorna definir_valor quando concluído sem valor final para gerente/dono', () => {
    const res = obterAcaoAgendamento({
      agendamento: { ...mockAgendamento, status: 'concluido' },
      checkinInfo: { id: 'chk-1', finalizado: true },
      execucaoInfo: { id: 'exec-1', status: 'finalizado', valor_total_final: null },
      podeVerValor: true,
    });
    expect(res.tipo).toBe('definir_valor');
    expect(res.label).toBe('Definir valor');
  });

  it('retorna ver_atendimento quando concluído com valor final', () => {
    const res = obterAcaoAgendamento({
      agendamento: { ...mockAgendamento, status: 'concluido' },
      checkinInfo: { id: 'chk-1', finalizado: true },
      execucaoInfo: { id: 'exec-1', status: 'finalizado', valor_total_final: 150 },
      podeVerValor: true,
    });
    expect(res.tipo).toBe('ver_atendimento');
    expect(res.label).toBe('Ver atendimento');
  });

  it('retorna iniciar_servico quando vistoria foi dispensada e não há vistoria finalizada', () => {
    const res = obterAcaoAgendamento({
      agendamento: { ...mockAgendamento, vistoria_dispensada: true },
      checkinInfo: null,
      execucaoInfo: null,
    });
    expect(res.tipo).toBe('iniciar_servico');
    expect(res.label).toBe('Iniciar serviço');
  });
});
