import { useAuth } from '../contexts/AuthContext';
import type { PlanCode } from '../types/auth';

const PLAN_LIMITS_MATRIX: Record<PlanCode, Record<string, number | null>> = {
  free: {
    usuarios: 1,
    servicos_mes: 20,
    orcamentos_mes: 3,
    produtos: 0,
  },
  pro: {
    usuarios: 3,
    servicos_mes: null,
    orcamentos_mes: null,
    produtos: null,
  },
  studio: {
    usuarios: null,
    servicos_mes: null,
    orcamentos_mes: null,
    produtos: null,
  },
};

const PLAN_NAMES: Record<PlanCode, string> = {
  free: 'Free',
  pro: 'Pro',
  studio: 'Studio',
};

export const usePlano = () => {
  const { tenant } = useAuth();
  const planoAtual: PlanCode = tenant?.plano || 'free';

  const limiteDe = (recurso: 'usuarios' | 'servicos_mes' | 'orcamentos_mes' | 'produtos'): number | null => {
    const limits = PLAN_LIMITS_MATRIX[planoAtual] || PLAN_LIMITS_MATRIX.free;
    return limits[recurso] ?? null;
  };

  return {
    planoAtual,
    nomePlano: PLAN_NAMES[planoAtual] || 'Free',
    limiteDe,
  };
};
