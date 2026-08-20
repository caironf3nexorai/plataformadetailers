import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

const MARCOS_OS = [50, 100, 250, 500, 1000];

export function useMilestoneCheck() {
  const { tenant } = useAuth();
  const [activeMilestone, setActiveMilestone] = useState<number | null>(null);

  const checkMilestone = async () => {
    if (!tenant) return;

    try {
      const { data: contador } = await supabase
        .from('tenant_contadores')
        .select('proxima_os, ultimo_marco_exibido')
        .eq('tenant_id', tenant.id)
        .maybeSingle();

      if (!contador) return;

      const totalOS = (contador.proxima_os || 1) - 1;
      const ultimoMarco = contador.ultimo_marco_exibido || 0;

      // Encontrar o maior marco atingido que ainda não foi exibido
      const marcoNovo = [...MARCOS_OS].reverse().find(
        (m) => totalOS >= m && ultimoMarco < m
      );

      if (marcoNovo) {
        setActiveMilestone(marcoNovo);

        // Atualizar imediatamente no banco para nunca repetir a exibição
        await supabase
          .from('tenant_contadores')
          .update({ ultimo_marco_exibido: marcoNovo })
          .eq('tenant_id', tenant.id);
      }
    } catch (err) {
      console.error('[Milestone Check Error]:', err);
    }
  };

  useEffect(() => {
    checkMilestone();
  }, [tenant?.id]);

  const dismissMilestone = () => {
    setActiveMilestone(null);
  };

  return {
    activeMilestone,
    dismissMilestone,
    checkMilestone,
  };
}
