import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import type { PlanCode } from '../types/auth';

const FALLBACK_LIMITS: Record<PlanCode, Record<string, number | null>> = {
  free: {
    clientes: 20,
    agendamentos: 15,
    atendimentos_mes: 15,
    membros: 1,
    usuarios: 1,
    servicos_mes: 10,
    servicos: 10,
    orcamentos_mes: 8,
    execucoes: 15,
    produtos: 0,
    notas_fiscais_mes: 0,
    retencao_fotos_execucao_dias: 7,
    atendimentos_preservados_limite: 0,
  },
  pro: {
    clientes: 350,
    agendamentos: 150,
    atendimentos_mes: 150,
    membros: 3,
    usuarios: 3,
    servicos_mes: 35,
    servicos: 35,
    orcamentos_mes: 150,
    execucoes: 150,
    produtos: 50,
    notas_fiscais_mes: 15,
    retencao_fotos_execucao_dias: 60,
    atendimentos_preservados_limite: 15,
  },
  studio: {
    clientes: null,
    agendamentos: 500,
    atendimentos_mes: 500,
    membros: 10,
    usuarios: 10,
    servicos_mes: null,
    servicos: null,
    orcamentos_mes: null,
    execucoes: 500,
    produtos: null,
    notas_fiscais_mes: 60,
    retencao_fotos_execucao_dias: 180,
    atendimentos_preservados_limite: 100,
  },
};

const FALLBACK_FEATURES: Record<PlanCode, Record<string, boolean>> = {
  free: {
    agendamento_online: true,
    personalizacao_pdf: false,
    personalizacao_placa_balcao: false,
    arquivos_digitais: true,
    treinamentos: false,
    academia_trial_liberada: false,
    metas_equipe: false,
    programa_indicacao: true,
    relatorios_dre: false,
    whatsapp_mensagens: false,
    emissao_nfe_focus: false,
  },
  pro: {
    agendamento_online: true,
    personalizacao_pdf: true,
    personalizacao_placa_balcao: true,
    arquivos_digitais: true,
    treinamentos: true,
    academia_trial_liberada: false,
    metas_equipe: true,
    programa_indicacao: true,
    relatorios_dre: true,
    whatsapp_mensagens: true,
    emissao_nfe_focus: true,
  },
  studio: {
    agendamento_online: true,
    personalizacao_pdf: true,
    personalizacao_placa_balcao: true,
    arquivos_digitais: true,
    treinamentos: true,
    academia_trial_liberada: false,
    metas_equipe: true,
    programa_indicacao: true,
    relatorios_dre: true,
    whatsapp_mensagens: true,
    emissao_nfe_focus: true,
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

  const [carregandoPermissoes, setCarregandoPermissoes] = useState<boolean>(true);
  const [featuresMap, setFeaturesMap] = useState<Record<string, boolean>>(
    FALLBACK_FEATURES[planoAtual] || FALLBACK_FEATURES.free
  );
  const [limitsMap, setLimitsMap] = useState<Record<string, number | null>>(
    FALLBACK_LIMITS[planoAtual] || FALLBACK_LIMITS.free
  );
  const [statusAssinatura, setStatusAssinatura] = useState<string>('trial');
  const isTrial = statusAssinatura === 'trial';

  const carregarPermissoesDoPlano = useCallback(async () => {
    if (!tenant?.plano) {
      setCarregandoPermissoes(false);
      return;
    }

    try {
      setCarregandoPermissoes(true);

      // 1. Buscar status da assinatura da oficina
      try {
        const { data: assData } = await supabase.rpc('obter_assinatura_tenant', {
          p_tenant_id: tenant.id,
        });
        if (assData?.status) {
          setStatusAssinatura(assData.status);
        }
      } catch (errAss) {
        console.warn('[usePlano] Erro ao buscar status da assinatura:', errAss);
      }

      // 2. Buscar features do plano em tempo real do banco de dados
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

      // 3. Buscar limites numéricos do plano em tempo real
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
    // Regra da Academia do Detailer no Trial:
    // Se a feature for 'treinamentos', e o admin configurou academia_trial_liberada = false,
    // contas em período de testes (trial) ou Free NÃO acessam a academia, apenas planos pagos ativos.
    if (featureKey === 'treinamentos') {
      const trialLiberado = featuresMap['academia_trial_liberada'] ?? false;
      const ehPlanoPagoAtivo = statusAssinatura === 'ativa';

      if (!trialLiberado && !ehPlanoPagoAtivo) {
        return false;
      }
    }

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

  // Verificar uso em relação ao limite local
  const verificarUso = (recursoKey: string, usoAtual: number) => {
    const limite = limiteDe(recursoKey);
    if (limite === null) {
      return { limite: null, uso: usoAtual, atingiu: false, porcentagem: 0, quaseCheio: false, proximo: false };
    }
    const atingiu = usoAtual >= limite;
    const porcentagem = Math.min(100, Math.round((usoAtual / limite) * 100));
    const quaseCheio = porcentagem >= 80;
    const proximo = quaseCheio;
    return { limite, uso: usoAtual, atingiu, porcentagem, quaseCheio, proximo };
  };

  // Consultar se o recurso atingiu o limite ao vivo no banco de dados (tempo real)
  const consultarLimiteAoVivo = async (recursoKey: string) => {
    try {
      const { data, error } = await supabase.rpc('validar_limite_recurso', {
        p_tenant_id: tenant?.id,
        p_recurso: recursoKey,
      });
      if (error) throw error;
      return {
        permitido: Boolean(data?.permitido),
        atingiu: Boolean(data?.atingiu),
        limite: (data?.limite ?? null) as number | null,
        uso: Number(data?.uso || 0),
        mensagem: String(data?.mensagem || ''),
        plano: String(data?.plano || planoAtual),
      };
    } catch (err) {
      console.warn('[usePlano] Erro ao validar limite ao vivo:', err);
      const limite = limiteDe(recursoKey);
      return {
        permitido: true,
        atingiu: false,
        limite,
        uso: 0,
        mensagem: '',
        plano: planoAtual,
      };
    }
  };

  return {
    planoAtual,
    nomePlano: PLAN_NAMES[planoAtual] || planoAtual.toUpperCase(),
    statusAssinatura,
    isTrial,
    temFeature,
    limiteDe,
    verificarUso,
    consultarLimiteAoVivo,
    carregandoPermissoes,
    refetchPermissoes: carregarPermissoesDoPlano,
  };
};
