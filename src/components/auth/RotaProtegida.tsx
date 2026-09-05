import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import type { AppRole } from '../../types/auth';
import { AcessoNegado } from '../../pages/auth/AcessoNegado';
import { supabase } from '../../lib/supabase';

interface RotaProtegidaProps {
  allowedRoles?: AppRole[];
}

const LandingPage = React.lazy(() => import('../../pages/LandingPage').then(m => ({ default: m.LandingPage })));

export const RotaProtegida: React.FC<RotaProtegidaProps> = ({ allowedRoles }) => {
  const { user, tenant, membership, loading } = useAuth();
  const location = useLocation();

  const [partnerChecked, setPartnerChecked] = React.useState(false);
  const [isPartnerOnly, setIsPartnerOnly] = React.useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    async function checkPartnerStatus() {
      if (user && !tenant) {
        try {
          const { data } = await supabase.rpc('obter_status_usuario_atual');
          if (!active) return;
          if (data?.is_admin) {
            setIsPlatformAdmin(true);
          }
          if (data?.is_partner && !data?.is_admin) {
            setIsPartnerOnly(true);
          }
        } catch (e) {
          // Fallback silencioso
        } finally {
          if (active) setPartnerChecked(true);
        }
      } else {
        if (active) setPartnerChecked(true);
      }
    }
    checkPartnerStatus();
    return () => { active = false; };
  }, [user, tenant]);

  if (loading || (user && !tenant && !partnerChecked)) {
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

  // 1. Sem usuário logado
  if (!user) {
    // Se acessou a raiz '/', exibe a Landing Page de alta conversão
    if (location.pathname === '/') {
      return (
        <React.Suspense
          fallback={
            <div className="min-h-screen bg-graphite-950 flex items-center justify-center text-amber-500">
              Carregando...
            </div>
          }
        >
          <LandingPage />
        </React.Suspense>
      );
    }

    // Se acessou o atalho '/diluicao' de fora da plataforma, redireciona para a calculadora pública
    if (location.pathname === '/diluicao') {
      return <Navigate to="/calculadora" replace />;
    }

    const loginTarget = conviteParam ? `/entrar?convite=${conviteParam}` : '/entrar';
    return <Navigate to={loginTarget} replace />;
  }

  // 2. Com usuário logado mas sem oficina ativa
  if (!tenant) {
    if (location.pathname.startsWith('/convite/') || conviteParam) {
      if (conviteParam && !location.pathname.startsWith('/convite/')) {
        return <Navigate to={`/convite/${conviteParam}`} replace />;
      }
      return <Outlet />;
    }

    // Se for um usuário parceiro comercial sem oficina, direciona para seu painel de parceiro
    if (isPartnerOnly) {
      return <Navigate to="/parceiro/painel" replace />;
    }

    // Se for um administrador da plataforma sem oficina ativa, direciona para o painel admin
    if (isPlatformAdmin) {
      return <Navigate to="/admin" replace />;
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
