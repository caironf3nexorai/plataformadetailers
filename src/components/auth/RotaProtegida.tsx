import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import type { AppRole } from '../../types/auth';
import { AcessoNegado } from '../../pages/auth/AcessoNegado';

interface RotaProtegidaProps {
  allowedRoles?: AppRole[];
}

export const RotaProtegida: React.FC<RotaProtegidaProps> = ({ allowedRoles }) => {
  const { user, tenant, membership, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-graphite-900 flex items-center justify-center p-4 text-vapor-400 font-sans text-[14px]">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <span>Carregando sessão...</span>
        </div>
      </div>
    );
  }

  const searchParams = new URLSearchParams(location.search);
  const conviteParam = searchParams.get('convite') || (location.state as any)?.convite;

  // 1. Sem usuário logado -> vai para login (preservando convite se houver)
  if (!user) {
    const loginTarget = conviteParam ? `/entrar?convite=${conviteParam}` : '/entrar';
    return <Navigate to={loginTarget} replace />;
  }

  // 2. Com usuário logado mas sem oficina ativa -> vai para criação de oficina, A MENOS que esteja no fluxo de convite
  if (!tenant) {
    if (location.pathname.startsWith('/convite/') || conviteParam) {
      if (conviteParam && !location.pathname.startsWith('/convite/')) {
        return <Navigate to={`/convite/${conviteParam}`} replace />;
      }
      return <Outlet />;
    }
    return <Navigate to="/nova-oficina" replace />;
  }

  // 3. Com papéis restritos -> se não tiver permissão, mostra tela de Acesso Negado
  if (allowedRoles && allowedRoles.length > 0 && membership) {
    if (!allowedRoles.includes(membership.role)) {
      return <AcessoNegado />;
    }
  }

  return <Outlet />;
};
