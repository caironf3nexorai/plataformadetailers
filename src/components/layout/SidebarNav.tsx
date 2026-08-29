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
  LogOut,
  ChevronDown,
  ShieldCheck,
  FlaskConical,
  Gift,
  DollarSign,
  GraduationCap,
  FolderArchive,
  Building2,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissao } from '../../hooks/usePermissao';
import { usePlano } from '../../hooks/usePlano';
import { Badge } from '../ui/Badge';
import { CentralNotificacoesMenu } from '../notificacoes/CentralNotificacoesMenu';
import { supabase } from '../../lib/supabase';

interface NavItem {
  path: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  visible: boolean;
  badge?: string | number;
}

interface NavGroup {
  titulo: string;
  itens: NavItem[];
}

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

  const navGroups: NavGroup[] = [
    {
      titulo: 'OPERAÇÃO',
      itens: [
        { path: '/', label: 'Dashboard', icon: LayoutDashboard, visible: !isOperador },
        { path: '/agenda', label: 'Agenda', icon: CalendarDays, visible: true },
        { path: '/clientes', label: 'Clientes', icon: Users, visible: true },
        { path: '/orcamentos', label: 'Orçamentos', icon: FileText, visible: podeVerFinanceiro() },
        { path: '/servicos', label: 'Serviços', icon: SprayCan, visible: podeGerirServicos() },
        { path: '/estoque', label: 'Estoque', icon: Package, visible: podeGerirEstoque() },
      ],
    },
    {
      titulo: 'FINANCEIRO & ESTRATÉGIA',
      itens: [
        { path: '/financeiro', label: 'Financeiro', icon: TrendingUp, visible: podeVerFinanceiro() },
        { path: '/servicos/precificacao', label: 'Precificação', icon: DollarSign, visible: podeVerFinanceiro() },
      ],
    },
    {
      titulo: 'RECURSOS & CONTEÚDO',
      itens: [
        { path: '/treinamentos', label: 'Academia Detailer', icon: GraduationCap, visible: true },
        { path: '/arquivos-digitais', label: 'Arquivos Digitais', icon: FolderArchive, visible: podeGerirServicos() },
        { path: '/diluicao', label: 'Diluição', icon: FlaskConical, visible: true },
        { path: '/indique', label: 'Indique e Ganhe', icon: Gift, visible: true },
      ],
    },
    {
      titulo: 'GESTÃO & SISTEMA',
      itens: [
        { path: '/configuracoes', label: 'Minha Oficina', icon: Building2, visible: true },
      ],
    },
  ];

  return (
    <aside className="hidden lg:flex flex-col w-[240px] h-screen fixed left-0 top-0 bg-graphite-800 border-r border-graphite-600 z-10">
      {/* Header do Tenant e Seletor se houver múltiplos */}
      <div className="p-5 border-b border-graphite-600 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          {userTenants.length > 1 ? (
            <div className="relative flex-1">
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
            <h1 className="font-display text-[15.5px] text-vapor-100 font-bold tracking-wider truncate flex-1">
              {tenant?.nome || 'Plataforma Detailers'}
            </h1>
          )}

          <CentralNotificacoesMenu align="left" />
        </div>

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

      {/* Menus Filtrados por Permissão e Agrupados por Categoria */}
      <nav className="flex-1 py-3 flex flex-col gap-4 overflow-y-auto custom-scrollbar">
        {navGroups.map((grupo) => {
          const itensVisiveis = grupo.itens.filter((item) => item.visible);
          if (itensVisiveis.length === 0) return null;

          return (
            <div key={grupo.titulo} className="flex flex-col">
              <div className="px-6 pb-1.5 pt-1">
                <span className="font-mono text-[10px] uppercase font-semibold tracking-wider text-vapor-400/80">
                  {grupo.titulo}
                </span>
              </div>

              <div className="flex flex-col gap-0.5">
                {itensVisiveis.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === '/'}
                    className={({ isActive }) =>
                      `relative flex items-center gap-3 px-6 py-2.5 min-h-[40px] font-sans text-[13.5px] transition-colors ${
                        isActive
                          ? 'text-amber-500 font-medium bg-graphite-700/40'
                          : 'text-vapor-400 hover:text-vapor-100 hover:bg-graphite-700/20'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <div className="absolute left-0 top-0 bottom-0 w-[2.5px] bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
                        )}
                        <item.icon size={18} className={isActive ? 'text-amber-500' : 'text-vapor-400'} />
                        <span className="truncate">{item.label}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
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
