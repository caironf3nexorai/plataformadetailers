import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { registrarVisualizacaoPagina, limparCacheAtividade } from '../../services/activityTracker';

/**
 * Componente invisível que escuta as mudanças de rota e registra
 * 'page_view' de forma leve, respeitando o debounce de 2 minutos e
 * ignorando administradores.
 */
export const ActivityTracker: React.FC = () => {
  const location = useLocation();
  const { user, loading } = useAuth();
  const lastUserRef = useRef<string | null>(null);

  useEffect(() => {
    // Se o usuário mudou (ex: deslogou e logou em outra conta), limpa os caches em memória
    const currentUserId = user?.id ?? null;
    if (lastUserRef.current !== currentUserId) {
      limparCacheAtividade();
      lastUserRef.current = currentUserId;
    }

    if (loading) return;

    if (currentUserId) {
      registrarVisualizacaoPagina(location.pathname, currentUserId);
    }
  }, [location.pathname, user?.id, loading]);

  return null;
};
