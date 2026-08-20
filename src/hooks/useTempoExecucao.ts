import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export type EstadoCronometroDerivado = 'rodando' | 'pausado_manual' | 'pausado_auto';

export const EVENTO_ATUALIZACAO_TEMPO = 'tempo_execucao_updated';

export function notificarAtualizacaoTempo(execucaoId?: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENTO_ATUALIZACAO_TEMPO, { detail: { execucaoId } }));
  }
}

export function obterEstadoDerivadoCronometro(params: {
  statusExecucao: string;
  contandoDesde?: string | null;
  estaPausadoOvernight?: boolean;
}): EstadoCronometroDerivado {
  if (params.statusExecucao === 'pausado') {
    return 'pausado_manual';
  }
  if (params.statusExecucao === 'em_andamento' && params.estaPausadoOvernight) {
    return 'pausado_auto';
  }
  return 'rodando';
}

export interface UseTempoExecucaoReturn {
  segundosBase: number;
  contandoDesde: string | null;
  offsetServidor: number;
  loading: boolean;
  error: any;
  segundosTotais: number;
  tempoFormatado: string;
  recarregar: () => Promise<void>;
  pausarOtimista: () => void;
  retomarOtimista: () => void;
}

export function formatarSegundosHHMMSS(totaisSegundos: number): string {
  const s = Math.max(0, Math.floor(totaisSegundos));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
}

export function useTempoExecucao(execucaoId: string | null): UseTempoExecucaoReturn {
  const [segundosBase, setSegundosBase] = useState<number>(0);
  const [contandoDesde, setContandoDesde] = useState<string | null>(null);
  const [offsetServidor, setOffsetServidor] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<any>(null);
  const [nowMs, setNowMs] = useState<number>(Date.now());

  const fetchTempo = useCallback(async () => {
    if (!execucaoId) {
      setLoading(false);
      return;
    }

    try {
      const { data, error: rpcErr } = await supabase.rpc('tempo_execucao', { p_execucao: execucaoId });

      console.log('[useTempoExecucao] RPC Bruto:', { execucaoId, data, rpcErr });

      if (rpcErr) {
        console.error('[useTempoExecucao] Erro retornado pela RPC tempo_execucao:', rpcErr);
        setError(rpcErr);
        return;
      }

      if (!data || !Array.isArray(data) || data.length === 0) {
        console.error('[useTempoExecucao] Array retornado pela RPC está vazio ou inválido:', data);
        return;
      }

      const row = data[0];
      if (row) {
        const sBase = typeof row.segundos_base === 'number' ? row.segundos_base : 0;
        setSegundosBase(sBase);
        setContandoDesde(row.contando_desde || null);

        if (row.agora_servidor) {
          const serverMs = new Date(row.agora_servidor).getTime();
          if (!isNaN(serverMs)) {
            setOffsetServidor(serverMs - Date.now());
          }
        }
      }
    } catch (err) {
      console.error('[useTempoExecucao] Exceção durante consulta de tempo:', err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [execucaoId]);

  useEffect(() => {
    fetchTempo();
  }, [fetchTempo]);

  // Listener global para sincronizar múltiplos componentes com o mesmo estado
  useEffect(() => {
    const handleUpdate = (e: Event) => {
      const customEvent = e as CustomEvent;
      const targetId = customEvent.detail?.execucaoId;
      if (!execucaoId || !targetId || targetId === execucaoId) {
        console.log('[useTempoExecucao] Evento de atualização recebido, recarregando RPC...');
        fetchTempo();
      }
    };

    window.addEventListener(EVENTO_ATUALIZACAO_TEMPO, handleUpdate);
    return () => window.removeEventListener(EVENTO_ATUALIZACAO_TEMPO, handleUpdate);
  }, [execucaoId, fetchTempo]);

  // Tick a cada 1 segundo se houver cronômetro correndo
  useEffect(() => {
    setNowMs(Date.now());

    if (!contandoDesde) return;

    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [contandoDesde]);

  // Cálculo dos segundos acumulados ao vivo
  let segundosTotais = segundosBase;
  if (contandoDesde) {
    const agoraAjustado = nowMs + offsetServidor;
    const desdeMs = new Date(contandoDesde).getTime();
    if (!isNaN(desdeMs)) {
      const decorrido = Math.max(0, Math.floor((agoraAjustado - desdeMs) / 1000));
      segundosTotais = segundosBase + decorrido;
    }
  }

  // Atualização otimista local ao pausar
  const pausarOtimista = useCallback(() => {
    let acumuladoAtual = segundosBase;
    if (contandoDesde) {
      const agoraAjustado = Date.now() + offsetServidor;
      const desdeMs = new Date(contandoDesde).getTime();
      if (!isNaN(desdeMs)) {
        acumuladoAtual += Math.max(0, Math.floor((agoraAjustado - desdeMs) / 1000));
      }
    }
    setSegundosBase(acumuladoAtual);
    setContandoDesde(null);
  }, [segundosBase, contandoDesde, offsetServidor]);

  // Atualização otimista local ao retomar
  const retomarOtimista = useCallback(() => {
    setContandoDesde(new Date().toISOString());
  }, []);

  return {
    segundosBase,
    contandoDesde,
    offsetServidor,
    loading,
    error,
    segundosTotais,
    tempoFormatado: formatarSegundosHHMMSS(segundosTotais),
    recarregar: fetchTempo,
    pausarOtimista,
    retomarOtimista,
  };
}
