import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import type { ItemNotificacao } from '../types/notificacao';

interface NotificacoesContextType {
  notificacoes: ItemNotificacao[];
  naoLidasCount: number;
  carregando: boolean;
  carregarNotificacoes: () => Promise<void>;
  marcarComoLida: (id: string) => Promise<void>;
  marcarTodasComoLidas: () => Promise<void>;
}

const NotificacoesContext = createContext<NotificacoesContextType | undefined>(undefined);

const POLLING_INTERVAL_MS = 120_000; // 2 minutos conforme especificação

export const NotificacoesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, tenant } = useAuth();
  const [notificacoes, setNotificacoes] = useState<ItemNotificacao[]>([]);
  const [naoLidasCount, setNaoLidasCount] = useState<number>(0);
  const [carregando, setCarregando] = useState<boolean>(false);

  const carregarNotificacoes = useCallback(async () => {
    if (!user) {
      setNotificacoes([]);
      setNaoLidasCount(0);
      setCarregando(false);
      return;
    }

    setCarregando(true);
    try {
      // 1. Obter contador rápido de não lidas
      const { data: countData, error: errCount } = await supabase.rpc('obter_contador_notificacoes_nao_lidas');
      if (!errCount && typeof countData === 'number') {
        setNaoLidasCount(countData);
      }

      // 2. Obter lista das últimas 30 notificações
      const { data: listaData, error: errLista } = await supabase.rpc('obter_notificacoes', {
        p_limite: 30,
        p_offset: 0,
        p_apenas_nao_lidas: false,
      });

      if (!errLista && Array.isArray(listaData)) {
        setNotificacoes(listaData);
      }
    } catch (err) {
      console.warn('[Notificacoes] Falha silenciosa ao carregar:', err);
    } finally {
      setCarregando(false);
    }
  }, [user?.id, tenant?.id]);

  // Carregamento inicial e Polling de 2 minutos
  useEffect(() => {
    if (!user) return;

    carregarNotificacoes();

    const intervalId = setInterval(() => {
      carregarNotificacoes();
    }, POLLING_INTERVAL_MS);

    // Atualização imediata quando a aba volta ao foco ou visibilidade
    const handleFocus = () => {
      carregarNotificacoes();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        carregarNotificacoes();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [user?.id, tenant?.id, carregarNotificacoes]);

  // Marcar uma notificação individual como lida
  const marcarComoLida = async (id: string) => {
    // Atualização otimista na UI
    setNotificacoes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, lida: true, lida_em: new Date().toISOString() } : n))
    );
    setNaoLidasCount((prev) => Math.max(0, prev - 1));

    try {
      await supabase.rpc('marcar_notificacao_lida', { p_id: id });
    } catch (err) {
      console.error('[Notificacoes] Erro ao marcar como lida:', err);
    }
  };

  // Marcar todas as notificações como lidas
  const marcarTodasComoLidas = async () => {
    // Atualização otimista
    setNotificacoes((prev) =>
      prev.map((n) => ({ ...n, lida: true, lida_em: new Date().toISOString() }))
    );
    setNaoLidasCount(0);

    try {
      await supabase.rpc('marcar_todas_notificacoes_lidas');
    } catch (err) {
      console.error('[Notificacoes] Erro ao marcar todas como lidas:', err);
    }
  };

  return (
    <NotificacoesContext.Provider
      value={{
        notificacoes,
        naoLidasCount,
        carregando,
        carregarNotificacoes,
        marcarComoLida,
        marcarTodasComoLidas,
      }}
    >
      {children}
    </NotificacoesContext.Provider>
  );
};

export const useNotificacoes = (): NotificacoesContextType => {
  const context = useContext(NotificacoesContext);
  if (!context) {
    throw new Error('useNotificacoes deve ser usado dentro de um NotificacoesProvider');
  }
  return context;
};
