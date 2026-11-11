export type ContaAuthCategoria =
  | 'orfa_sem_oficina'
  | 'parceiro_sem_oficina'
  | 'admin_plataforma'
  | 'dono_oficina'
  | 'membro_equipe';

export type FiltroContasAuth =
  | 'todas'
  | 'sem_oficina'
  | 'orfas'
  | 'com_oficina'
  | 'parceiros'
  | 'admins';

export interface ContaAuthOficinaVinculo {
  member_id: string;
  tenant_id: string;
  tenant_nome: string;
  tenant_slug: string;
  plano: string;
  role: string;
  status: string;
  total_donos_oficina: number;
}

export interface ContaAuthItem {
  id: string;
  email: string;
  nome: string;
  telefone: string | null;
  email_confirmado: boolean;
  email_confirmed_at: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  is_admin: boolean;
  admin_nivel: string | null;
  admin_ativo: boolean;
  is_super_admin: boolean;
  is_parceiro: boolean;
  parceiro_id: string | null;
  parceiro_codigo: string | null;
  parceiro_ativo: boolean | null;
  total_oficinas: number;
  oficinas: ContaAuthOficinaVinculo[];
  categoria: ContaAuthCategoria;
  pode_purgar: boolean;
  motivo_bloqueio_purga: string | null;
}

export interface ResumoContasAuth {
  totalContas: number;
  comOficina: number;
  semOficina: number;
  orfas: number;
  parceiros: number;
  admins: number;
  naoConfirmadas: number;
}

export function calcularResumoContasAuth(contas: ContaAuthItem[]): ResumoContasAuth {
  return contas.reduce<ResumoContasAuth>(
    (acc, c) => {
      acc.totalContas += 1;
      if (c.total_oficinas > 0) acc.comOficina += 1;
      else acc.semOficina += 1;

      if (c.categoria === 'orfa_sem_oficina') acc.orfas += 1;
      if (c.is_parceiro) acc.parceiros += 1;
      if (c.is_admin) acc.admins += 1;
      if (!c.email_confirmado) acc.naoConfirmadas += 1;
      return acc;
    },
    {
      totalContas: 0,
      comOficina: 0,
      semOficina: 0,
      orfas: 0,
      parceiros: 0,
      admins: 0,
      naoConfirmadas: 0,
    }
  );
}

export function filtrarContasAuth(
  contas: ContaAuthItem[],
  busca: string,
  filtro: FiltroContasAuth
): ContaAuthItem[] {
  const q = (busca || '').trim().toLowerCase();

  return contas.filter((c) => {
    if (filtro === 'sem_oficina' && c.total_oficinas > 0) return false;
    if (filtro === 'orfas' && c.categoria !== 'orfa_sem_oficina') return false;
    if (filtro === 'com_oficina' && c.total_oficinas === 0) return false;
    if (filtro === 'parceiros' && !c.is_parceiro) return false;
    if (filtro === 'admins' && !c.is_admin) return false;

    if (!q) return true;

    const matchBase =
      c.email.toLowerCase().includes(q) ||
      (c.nome || '').toLowerCase().includes(q) ||
      (c.parceiro_codigo || '').toLowerCase().includes(q) ||
      (c.telefone || '').toLowerCase().includes(q);

    if (matchBase) return true;

    return (c.oficinas || []).some((o) =>
      (o.tenant_nome || '').toLowerCase().includes(q)
    );
  });
}

export function obterLabelCategoriaConta(categoria: ContaAuthCategoria): {
  label: string;
  badgeClass: string;
  descricao: string;
} {
  switch (categoria) {
    case 'orfa_sem_oficina':
      return {
        label: 'Órfã (Sem Oficina)',
        badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
        descricao: 'Cadastro incompleto ou usuário antigo sem oficina nem vínculo de parceiro/admin.',
      };
    case 'parceiro_sem_oficina':
      return {
        label: 'Parceiro (Sem Oficina)',
        badgeClass: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
        descricao: 'Parceiro comercial com login exclusivo para o Portal do Parceiro.',
      };
    case 'admin_plataforma':
      return {
        label: 'Admin (Sem Oficina)',
        badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
        descricao: 'Administrador da plataforma sem oficina operacional atrelada.',
      };
    case 'dono_oficina':
      return {
        label: 'Dono de Oficina',
        badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
        descricao: 'Proprietário principal de oficina ativa.',
      };
    case 'membro_equipe':
    default:
      return {
        label: 'Membro de Equipe',
        badgeClass: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
        descricao: 'Gerente ou operador vinculado a uma oficina existente.',
      };
  }
}

export interface ImpactoExclusaoParceiro {
  oficinasCount: number;
  oficinasNomes: string[];
  comissoesCount: number;
  comissoesPagasCount: number;
  valorTotalComissoes: number;
}

export function calcularImpactoExclusaoParceiro(
  parceiroId: string,
  oficinas: Array<{ id: string; nome: string; parceiro_id?: string | null }>,
  comissoes: Array<{ id: string; parceiro_id?: string | null; valor_comissao: number; status: string }>
): ImpactoExclusaoParceiro {
  const oficinasVinculadas = oficinas.filter((o) => o.parceiro_id === parceiroId);
  const comissoesVinculadas = comissoes.filter((c) => c.parceiro_id === parceiroId);

  return {
    oficinasCount: oficinasVinculadas.length,
    oficinasNomes: oficinasVinculadas.map((o) => o.nome),
    comissoesCount: comissoesVinculadas.length,
    comissoesPagasCount: comissoesVinculadas.filter((c) => c.status === 'paga').length,
    valorTotalComissoes: comissoesVinculadas.reduce(
      (acc, c) => acc + (Number(c.valor_comissao) || 0),
      0
    ),
  };
}

