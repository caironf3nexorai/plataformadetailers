import { describe, it, expect } from 'vitest';
import {
  isNomeClienteValido,
  obterNomeClienteOrcamento,
  obterPrimeiroNomeClienteOrcamento,
  obterNomePreferencialPublico,
  resolverAgendamentoVinculadoOrcamento,
  isAgendamentoOrcamentoAtivo,
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
  });
});

