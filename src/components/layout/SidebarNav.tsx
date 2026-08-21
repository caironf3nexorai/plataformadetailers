import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  SprayCan,
  FileText,
  Package,
  TrendingUp,
  Settings,
  LogOut,
  ChevronDown,
  ShieldCheck,
  FlaskConical,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissao } from '../../hooks/usePermissao';
import { usePlano } from '../../hooks/usePlano';
import { Badge } from '../ui/Badge';
import { supabase } from '../../lib/supabase';

export const SidebarNav: React.FC = () => {
  const { tenant, userTenants, trocarTenant, signOut, profile, membership } = useAuth();
  const { isOperador, podeVerFinanceiro, podeGerirEstoque, podeGerirServicos } = usePermissao();
  const { nomePlano } = usePlano();
  const [isPlatformAdminUser, setIsPlatformAdminUser] = useState(false);
  const [feedbacksNovos, setFeedbacksNovos] = useState(0);

  useEffect(() => {
    async function checkAdmin() {
      try {
        const { data } = await supabase.rpc('is_platform_admin');
        if (data) {
          setIsPlatformAdminUser(true);
          const { data: countData } = await supabase.rpc('admin_obter_contador_feedbacks_novos');
          if (countData) setFeedbacksNovos(Number(countData));
        }
      } catch (err) {
        // Silently fail if not admin
      }
    }
    checkAdmin();
  }, []);

  const allNavItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard, visible: !isOperador },
    { path: '/agenda', label: 'Agenda', icon: CalendarDays, visible: true },
    { path: '/clientes', label: 'Clientes', icon: Users, visible: true },
    { path: '/orcamentos', label: 'Orçamentos', icon: FileText, visible: podeVerFinanceiro() },
    { path: '/servicos', label: 'Serviços', icon: SprayCan, visible: podeGerirServicos() },
    { path: '/estoque', label: 'Estoque', icon: Package, visible: podeGerirEstoque() },
    { path: '/diluicao', label: 'Diluição', icon: FlaskConical, visible: true },
    { path: '/financeiro', label: 'Financeiro', icon: TrendingUp, visible: podeVerFinanceiro() },
    { path: '/configuracoes', label: 'Ajustes', icon: Settings, visible: true },
  ];

  const visibleItems = allNavItems.filter((i) => i.visible);

  return (
    <aside className="hidden lg:flex flex-col w-[240px] h-screen fixed left-0 top-0 bg-graphite-800 border-r border-graphite-600 z-10">
      {/* Header do Tenant e Seletor se houver múltiplos */}
      <div className="p-5 border-b border-graphite-600 flex flex-col gap-2">
        {userTenants.length > 1 ? (
          <div className="relative">
            <select
              value={tenant?.id || ''}
              onChange={(e) => trocarTenant(e.target.value)}
              className="w-full bg-graphite-900 border border-graphite-600 rounded px-2.5 py-1.5 font-display text-[14px] text-amber-500 font-bold outline-none cursor-pointer appearance-none pr-8"
            >
              {userTenants.map((ut) => (
                <option key={ut.tenant.id} value={ut.tenant.id}>
                  {ut.tenant.nome}
                </option>
              ))}
            </select>
            <ChevronDown size={16} className="absolute right-2.5 top-2.5 text-vapor-400 pointer-events-none" />
          </div>
        ) : (
          <h1 className="font-display text-[16px] text-vapor-100 font-bold tracking-wider truncate">
            {tenant?.nome || 'Plataforma Detailers'}
          </h1>
        )}

        <div className="flex items-center justify-between">
          <Badge tone="amber">Plano {nomePlano}</Badge>
          {membership && (
            <span className="font-mono text-[11px] text-vapor-400 uppercase tracking-wider">
              {membership.role}
            </span>
          )}
        </div>

        {/* Botão de Atalho para o Painel Admin da Plataforma com Badge em Âmbar */}
        {isPlatformAdminUser && (
          <NavLink
            to="/admin"
            className="mt-1 flex items-center justify-between space-x-2 bg-gradient-to-r from-amber-500/20 to-amber-600/20 border border-amber-500/40 text-amber-400 font-bold text-xs py-2 px-3 rounded-lg hover:bg-amber-500/30 transition shadow-inner"
          >
            <div className="flex items-center space-x-2">
              <ShieldCheck size={16} className="text-amber-400" />
              <span>PAINEL ADMIN</span>
            </div>
            {feedbacksNovos > 0 && (
              <span className="bg-amber-500 text-graphite-950 font-extrabold px-1.5 py-0.5 rounded-full text-[10px] shadow">
                {feedbacksNovos}
              </span>
            )}
          </NavLink>
        )}
      </div>

      {/* Menus Filtrados por Permissão */}
      <nav className="flex-1 py-4 flex flex-col gap-1 overflow-y-auto">
        {visibleItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `relative flex items-center gap-3 px-6 py-3 min-h-[48px] font-sans text-[14px] transition-colors ${
                isActive
                  ? 'text-amber-500 font-medium'
                  : 'text-vapor-400 hover:text-vapor-100'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-amber-500" />
                )}
                <item.icon size={20} className={isActive ? 'text-amber-500' : 'text-vapor-400'} />
                {item.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer com usuário e logout */}
      <div className="p-4 border-t border-graphite-600 flex items-center justify-between gap-2 bg-graphite-800/80">
        <div className="flex flex-col truncate">
          <span className="font-sans text-[13px] font-semibold text-vapor-100 truncate">
            {profile?.nome || 'Usuário'}
          </span>
          <span className="font-sans text-[11px] text-vapor-400 truncate">
            {membership?.email || ''}
          </span>
        </div>

        <button
          type="button"
          onClick={() => signOut()}
          title="Sair da conta"
          className="p-2 text-vapor-400 hover:text-flare-400 hover:bg-graphite-700 rounded transition-colors"
        >
          <LogOut size={18} />
        </button>
      </div>
    </aside>
  );
};
