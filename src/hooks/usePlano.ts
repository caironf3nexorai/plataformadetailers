import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import type { PlanCode } from '../types/auth';

const FALLBACK_LIMITS: Record<PlanCode, Record<string, number | null>> = {
  free: {
    clientes: 15,
    agendamentos: 20,
    membros: 1,
    usuarios: 1,
    servicos_mes: 20,
    orcamentos_mes: 10,
    execucoes: 20,
    produtos: 10,
  },
  pro: {
    clientes: 300,
    agendamentos: null,
    membros: 5,
    usuarios: 5,
    servicos_mes: null,
    orcamentos_mes: null,
    execucoes: null,
    produtos: null,
  },
  studio: {
    clientes: null,
    agendamentos: null,
    membros: null,
    usuarios: null,
    servicos_mes: null,
    orcamentos_mes: null,
    execucoes: null,
    produtos: null,
  },
};

const FALLBACK_FEATURES: Record<PlanCode, Record<string, boolean>> = {
  free: {
    personalizacao_pdf: false,
    arquivos_digitais: true,
    treinamentos: true,
    metas_equipe: false,
    programa_indicacao: true,
    relatorios_dre: false,
    whatsapp_mensagens: false,
  },
  pro: {
    personalizacao_pdf: true,
    arquivos_digitais: true,
    treinamentos: true,
    metas_equipe: true,
    programa_indicacao: true,
    relatorios_dre: true,
    whatsapp_mensagens: true,
  },
  studio: {
    personalizacao_pdf: true,
    arquivos_digitais: true,
    treinamentos: true,
    metas_equipe: true,
    programa_indicacao: true,
    relatorios_dre: true,
    whatsapp_mensagens: true,
  },
};

const PLAN_NAMES: Record<string, string> = {
  free: 'Free',
  pro: 'Pro',
  studio: 'Studio',
};

export const usePlano = () => {
  const { tenant } = useAuth();
  const planoAtual: PlanCode = (tenant?.plano as PlanCode) || 'free';

  const [featuresMap, setFeaturesMap] = useState<Record<string, boolean>>(
    FALLBACK_FEATURES[planoAtual] || FALLBACK_FEATURES.free
  );
  const [limitsMap, setLimitsMap] = useState<Record<string, number | null>>(
    FALLBACK_LIMITS[planoAtual] || FALLBACK_LIMITS.free
  );
  const [carregandoPermissoes, setCarregandoPermissoes] = useState(true);

  const carregarPermissoesDoPlano = useCallback(async () => {
    if (!tenant?.plano) {
      setCarregandoPermissoes(false);
      return;
    }

    try {
      setCarregandoPermissoes(true);

      // Buscar features do plano em tempo real do banco de dados
      const { data: featData } = await supabase
        .from('plan_features')
        .select('feature, habilitado')
        .eq('plano', tenant.plano);

      if (featData && featData.length > 0) {
        const mapF: Record<string, boolean> = { ...(FALLBACK_FEATURES[planoAtual] || {}) };
        featData.forEach((row) => {
          mapF[row.feature] = row.habilitado;
        });
        setFeaturesMap(mapF);
      }

      // Buscar limites numéricos do plano em tempo real
      const { data: limData } = await supabase
        .from('plan_limits')
        .select('recurso, limite')
        .eq('plano', tenant.plano);

      if (limData && limData.length > 0) {
        const mapL: Record<string, number | null> = { ...(FALLBACK_LIMITS[planoAtual] || {}) };
        limData.forEach((row) => {
          mapL[row.recurso] = row.limite;
        });
        setLimitsMap(mapL);
      }
    } catch (err) {
      console.warn('[usePlano] Erro ao carregar permissões dinâmicas do plano:', err);
    } finally {
      setCarregandoPermissoes(false);
    }
  }, [tenant?.plano, planoAtual]);

  useEffect(() => {
    carregarPermissoesDoPlano();
  }, [carregarPermissoesDoPlano]);

  // Verificar se uma funcionalidade está liberada no plano atual
  const temFeature = (featureKey: string): boolean => {
    if (featuresMap[featureKey] !== undefined) {
      return featuresMap[featureKey];
    }
    // Caso não exista no banco, fallback por tipo de plano
    return (FALLBACK_FEATURES[planoAtual] || {})[featureKey] ?? (planoAtual !== 'free');
  };

  // Obter o limite numérico de um recurso no plano atual (null = ilimitado)
  const limiteDe = (recursoKey: string): number | null => {
    if (limitsMap[recursoKey] !== undefined) {
      return limitsMap[recursoKey];
    }
    return (FALLBACK_LIMITS[planoAtual] || {})[recursoKey] ?? null;
  };

  // Verificar se o uso atual está próximo ou atingiu o limite do plano
  const verificarUso = (recursoKey: string, usoAtual: number) => {
    const limite = limiteDe(recursoKey);
    if (limite === null || limite === undefined || limite <= 0) {
      return { atingiu: false, proximo: false, porcentagem: 0, limite: null };
    }

    const porcentagem = Math.round((usoAtual / limite) * 100);
    const atingiu = usoAtual >= limite;
    const proximo = porcentagem >= 80 && !atingiu;

    return { atingiu, proximo, porcentagem, limite };
  };

  return {
    planoAtual,
    nomePlano: PLAN_NAMES[planoAtual] || planoAtual.toUpperCase(),
    temFeature,
    limiteDe,
    verificarUso,
    carregandoPermissoes,
    refetchPermissoes: carregarPermissoesDoPlano,
  };
};
