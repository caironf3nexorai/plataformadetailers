import { describe, it, expect } from 'vitest';
import {
  isNomeClienteValido,
  obterNomeClienteOrcamento,
  obterPrimeiroNomeClienteOrcamento,
  obterNomePreferencialPublico,
  resolverAgendamentoVinculadoOrcamento,
  isAgendamentoOrcamentoAtivo,
  isAgendamentoOrcamentoNaoCompareceu,
  obterBadgeAgendamentoOrcamento,
} from './orcamento';

describe('utils/orcamento - captura de nome e vínculo de agendamento', () => {
  describe('isNomeClienteValido', () => {
    it('rejeita vazios, nomes curtos e placeholders genéricos', () => {
      expect(isNomeClienteValido(null)).toBe(false);
      expect(isNomeClienteValido('')).toBe(false);
      expect(isNomeClienteValido('A')).toBe(false);
      expect(isNomeClienteValido('Cliente')).toBe(false);
      expect(isNomeClienteValido('cliente')).toBe(false);
      expect(isNomeClienteValido('Não informado')).toBe(false);
      expect(isNomeClienteValido('nao informado')).toBe(false);
      expect(isNomeClienteValido('Sem nome')).toBe(false);
    });

    it('aceita nomes reais', () => {
      expect(isNomeClienteValido('João Silva')).toBe(true);
      expect(isNomeClienteValido('Ed')).toBe(true);
    });
  });

  describe('obterNomeClienteOrcamento e obterPrimeiroNomeClienteOrcamento', () => {
    it('prioriza cliente cadastrado mesmo se assinatura tiver outro nome', () => {
      const orc = {
        cliente: { id: 'c1', nome: 'Carlos Mendes' },
        cliente_nome_avulso: 'Outra Pessoa',
        assinatura_nome: 'Esposa Mendes',
      };
      expect(obterNomeClienteOrcamento(orc)).toBe('Carlos Mendes');
      expect(obterPrimeiroNomeClienteOrcamento(orc)).toBe('Carlos');
    });

    it('usa assinatura_nome quando orçamento não tem cliente vinculado nem nome avulso', () => {
      const orc = {
        cliente: null as any,
        cliente_nome_avulso: null,
        assinatura_nome: 'João Pereira Santos',
      };
      expect(obterNomeClienteOrcamento(orc)).toBe('João Pereira Santos');
      expect(obterPrimeiroNomeClienteOrcamento(orc)).toBe('João');
    });

    it('aproveita nome completo da assinatura se oficina informou apenas o primeiro nome avulso', () => {
      const orc = {
        cliente_nome_avulso: 'João',
        assinatura_nome: 'João Batista Oliveira',
      };
      expect(obterNomeClienteOrcamento(orc)).toBe('João Batista Oliveira');
    });

    it('ignora assinatura genérica e retorna fallback', () => {
      const orc = {
        cliente_nome_avulso: null,
        assinatura_nome: 'Cliente',
      };
      expect(obterNomeClienteOrcamento(orc, 'Cliente não informado')).toBe('Cliente não informado');
      expect(obterPrimeiroNomeClienteOrcamento(orc)).toBe('Cliente');
    });
  });

  describe('obterNomePreferencialPublico', () => {
    it('prefere nome completo avulso ou de assinatura ao invés de truncar no primeiro nome', () => {
      expect(
        obterNomePreferencialPublico({
          tem_cliente_cadastrado: false,
          cliente_primeiro_nome: 'João',
          cliente_nome_avulso: 'João',
          assinatura_nome: 'João Batista',
        })
      ).toBe('João Batista');

      expect(
        obterNomePreferencialPublico({
          tem_cliente_cadastrado: false,
          cliente_primeiro_nome: null,
          cliente_nome_avulso: null,
          assinatura_nome: 'Mariana Costa',
        })
      ).toBe('Mariana Costa');
    });
  });

  describe('resolverAgendamentoVinculadoOrcamento e isAgendamentoOrcamentoAtivo', () => {
    it('retorna ativo quando agendamento existe e não está cancelado', () => {
      const orc = {
        agendamento_id: 'ag-1',
        agendamento: { id: 'ag-1', status: 'agendado', inicio: '2026-11-10T10:00:00Z', numero_os: 42 },
      };
      expect(isAgendamentoOrcamentoAtivo(orc)).toBe(true);
      expect(resolverAgendamentoVinculadoOrcamento(orc)).toEqual({
        id: 'ag-1',
        status: 'agendado',
        inicio: '2026-11-10T10:00:00Z',
        numero_os: 42,
      });
    });

    it('desconsidera agendamento cancelado para permitir novo agendamento', () => {
      const orc = {
        agendamento_id: 'ag-1',
        agendamento: { id: 'ag-1', status: 'cancelado', inicio: '2026-11-10T10:00:00Z', numero_os: 42 },
      };
      expect(isAgendamentoOrcamentoAtivo(orc)).toBe(false);
      expect(resolverAgendamentoVinculadoOrcamento(orc)).toBeNull();
    });

    it('desconsidera quando join retorna explicitamente null (registro excluído)', () => {
      const orc = {
        agendamento_id: 'ag-deleted',
        agendamento: null,
      };
      expect(isAgendamentoOrcamentoAtivo(orc)).toBe(false);
    });

    it('mantém vínculo pelo agendamento_id quando join não foi carregado (undefined)', () => {
      const orc = {
        agendamento_id: 'ag-2',
      };
      expect(isAgendamentoOrcamentoAtivo(orc)).toBe(true);
      expect(resolverAgendamentoVinculadoOrcamento(orc)?.id).toBe('ag-2');
    });

    it('identifica corretamente quando a OS vinculada foi marcada como nao_compareceu', () => {
      const orcNoShow = {
        agendamento_id: 'ag-3',
        agendamento: { id: 'ag-3', status: 'nao_compareceu', inicio: '2026-11-10T10:00:00Z', numero_os: 88 },
      };
      expect(isAgendamentoOrcamentoAtivo(orcNoShow)).toBe(true);
      expect(isAgendamentoOrcamentoNaoCompareceu(orcNoShow)).toBe(true);
      expect(obterBadgeAgendamentoOrcamento(orcNoShow)).toEqual({
        label: 'OS Não Compareceu',
        tone: 'flare',
      });
    });

    it('retorna badges distintos por status real da OS vinculada', () => {
      expect(obterBadgeAgendamentoOrcamento({ agendamento_id: null, agendamento: null })).toEqual({
        label: 'Aguardando agenda',
        tone: 'amber',
      });
      expect(
        obterBadgeAgendamentoOrcamento({
          agendamento_id: 'a1',
          agendamento: { id: 'a1', status: 'agendado' },
        })
      ).toEqual({ label: 'OS Agendada', tone: 'cyan' });
      expect(
        obterBadgeAgendamentoOrcamento({
          agendamento_id: 'a2',
          agendamento: { id: 'a2', status: 'confirmado' },
        })
      ).toEqual({ label: 'OS Confirmada', tone: 'cyan' });
      expect(
        obterBadgeAgendamentoOrcamento({
          agendamento_id: 'a3',
          agendamento: { id: 'a3', status: 'aguardando_confirmacao' },
        })
      ).toEqual({ label: 'OS Aguardando Sinal', tone: 'amber' });
      expect(
        obterBadgeAgendamentoOrcamento({
          agendamento_id: 'a4',
          agendamento: { id: 'a4', status: 'em_andamento' },
        })
      ).toEqual({ label: 'OS em Andamento', tone: 'amber' });
      expect(
        obterBadgeAgendamentoOrcamento({
          agendamento_id: 'a5',
          agendamento: { id: 'a5', status: 'concluido' },
        })
      ).toEqual({ label: 'OS Concluída', tone: 'mint' });
      expect(
        obterBadgeAgendamentoOrcamento({
          agendamento_id: 'a6',
          agendamento: { id: 'a6', status: 'cancelado' },
        })
      ).toEqual({ label: 'Aguardando agenda', tone: 'amber' });
    });
  });
});

