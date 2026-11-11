import { describe, it, expect } from 'vitest';
import {
  calcularImpactoExclusaoParceiro,
  calcularResumoContasAuth,
  filtrarContasAuth,
  obterLabelCategoriaConta,
  type ContaAuthItem,
} from './adminContas';

const makeConta = (overrides: Partial<ContaAuthItem> = {}): ContaAuthItem => ({
  id: 'u-1',
  email: 'teste@detailer.com',
  nome: 'Usuário Teste',
  telefone: null,
  email_confirmado: true,
  email_confirmed_at: '2026-10-18T10:00:00Z',
  created_at: '2026-10-18T10:00:00Z',
  last_sign_in_at: '2026-10-18T12:00:00Z',
  is_admin: false,
  admin_nivel: null,
  admin_ativo: false,
  is_super_admin: false,
  is_parceiro: false,
  parceiro_id: null,
  parceiro_codigo: null,
  parceiro_ativo: null,
  total_oficinas: 1,
  oficinas: [
    {
      member_id: 'm-1',
      tenant_id: 't-1',
      tenant_nome: 'Studio Alpha',
      tenant_slug: 'studio-alpha',
      plano: 'pro',
      role: 'dono',
      status: 'ativo',
      total_donos_oficina: 1,
    },
  ],
  categoria: 'dono_oficina',
  pode_purgar: false,
  motivo_bloqueio_purga: 'Dono único da oficina "Studio Alpha".',
  ...overrides,
});

describe('Utilitários de Contas Auth & Exclusão de Parceiro', () => {
  it('calcula corretamente o resumo entre contas com oficina, órfãs, parceiros e admins', () => {
    const contas: ContaAuthItem[] = [
      makeConta({ id: '1', email: 'dono@oficina.com' }),
      makeConta({
        id: '2',
        email: 'orfa@teste.com',
        total_oficinas: 0,
        oficinas: [],
        categoria: 'orfa_sem_oficina',
        email_confirmado: false,
        pode_purgar: true,
        motivo_bloqueio_purga: null,
      }),
      makeConta({
        id: '3',
        email: 'parceiro@afiliado.com',
        is_parceiro: true,
        parceiro_id: 'p-1',
        parceiro_codigo: 'CAR10',
        total_oficinas: 0,
        oficinas: [],
        categoria: 'parceiro_sem_oficina',
        pode_purgar: true,
        motivo_bloqueio_purga: null,
      }),
      makeConta({
        id: '4',
        email: 'admin@plataforma.com',
        is_admin: true,
        admin_ativo: true,
        is_super_admin: true,
        total_oficinas: 0,
        oficinas: [],
        categoria: 'admin_plataforma',
        pode_purgar: false,
      }),
    ];

    expect(calcularResumoContasAuth(contas)).toEqual({
      totalContas: 4,
      comOficina: 1,
      semOficina: 3,
      orfas: 1,
      parceiros: 1,
      admins: 1,
      naoConfirmadas: 1,
    });
  });

  it('filtra contas por categoria, busca textual por oficina e código de parceiro', () => {
    const contas: ContaAuthItem[] = [
      makeConta({ id: '1', email: 'alpha@oficina.com' }),
      makeConta({
        id: '2',
        email: 'incompleto@gmail.com',
        nome: 'Sem Oficina',
        total_oficinas: 0,
        oficinas: [],
        categoria: 'orfa_sem_oficina',
        pode_purgar: true,
        motivo_bloqueio_purga: null,
      }),
      makeConta({
        id: '3',
        email: 'joao@parceiro.com',
        nome: 'João Parceiro',
        is_parceiro: true,
        parceiro_codigo: 'JOAO20',
        total_oficinas: 0,
        oficinas: [],
        categoria: 'parceiro_sem_oficina',
      }),
    ];

    expect(filtrarContasAuth(contas, '', 'orfas')).toHaveLength(1);
    expect(filtrarContasAuth(contas, '', 'sem_oficina')).toHaveLength(2);
    expect(filtrarContasAuth(contas, 'Studio Alpha', 'todas').map((c) => c.id)).toEqual(['1']);
    expect(filtrarContasAuth(contas, 'joao20', 'parceiros').map((c) => c.id)).toEqual(['3']);
  });

  it('retorna rótulo descritivo para categoria órfã', () => {
    const meta = obterLabelCategoriaConta('orfa_sem_oficina');
    expect(meta.label).toContain('Órfã');
    expect(meta.badgeClass).toContain('rose');
  });

  it('calcula impacto de exclusão de parceiro incluindo comissões pagas e oficinas vinculadas', () => {
    const impacto = calcularImpactoExclusaoParceiro(
      'p-1',
      [
        { id: 't-1', nome: 'Oficina A', parceiro_id: 'p-1' },
        { id: 't-2', nome: 'Oficina B', parceiro_id: 'p-2' },
        { id: 't-3', nome: 'Oficina C', parceiro_id: 'p-1' },
      ],
      [
        { id: 'c-1', parceiro_id: 'p-1', valor_comissao: 11.4, status: 'paga' },
        { id: 'c-2', parceiro_id: 'p-1', valor_comissao: 11.4, status: 'prevista' },
        { id: 'c-3', parceiro_id: 'p-2', valor_comissao: 20, status: 'paga' },
      ]
    );

    expect(impacto.oficinasCount).toBe(2);
    expect(impacto.oficinasNomes).toEqual(['Oficina A', 'Oficina C']);
    expect(impacto.comissoesCount).toBe(2);
    expect(impacto.comissoesPagasCount).toBe(1);
    expect(impacto.valorTotalComissoes).toBeCloseTo(22.8, 2);
  });
});

