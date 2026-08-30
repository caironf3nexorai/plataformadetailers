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
  X,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissao } from '../../hooks/usePermissao';
import { usePlano } from '../../hooks/usePlano';
import { Badge } from '../ui/Badge';
import { LogoNuvemWash } from '../ui/LogoNuvemWash';
import { supabase } from '../../lib/supabase';

interface MobileNavDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface NavItem {
  path: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  visible: boolean;
}

interface NavGroup {
  titulo: string;
  itens: NavItem[];
}

export const MobileNavDrawer: React.FC<MobileNavDrawerProps> = ({ isOpen, onClose }) => {
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

  // Prevenir rolagem do body quando o drawer estiver aberto
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const navGroups: NavGroup[] = [
    {
      titulo: 'OPERAÇÃO',
      itens: [
        { path: '/', label: 'Dashboard (Painel)', icon: LayoutDashboard, visible: !isOperador },
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
        { path: '/servicos/precificacao', label: 'Precificação Inteligente', icon: DollarSign, visible: podeVerFinanceiro() },
      ],
    },
    {
      titulo: 'RECURSOS & CONTEÚDO',
      itens: [
        { path: '/treinamentos', label: 'Academia Detailer', icon: GraduationCap, visible: true },
        { path: '/arquivos-digitais', label: 'Arquivos Digitais', icon: FolderArchive, visible: podeGerirServicos() },
        { path: '/diluicao', label: 'Calculadora de Diluição', icon: FlaskConical, visible: true },
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

  if (!isOpen) return null;

  return (
    <div className="lg:hidden fixed inset-0 z-50 flex justify-end">
      {/* Overlay com Backdrop Blur */}
      <div 
        className="fixed inset-0 bg-graphite-950/80 backdrop-blur-sm transition-opacity duration-300"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer deslizante pela DIREITA (Thumb reach / Ergonomia) */}
      <aside 
        className="relative w-[85%] max-w-[320px] h-full bg-graphite-900 border-l border-graphite-700 shadow-2xl flex flex-col z-10 animate-slide-in-right"
        style={{
          paddingTop: 'max(12px, env(safe-area-inset-top, 0px))',
          paddingBottom: 'max(16px, env(safe-area-inset-bottom, 0px))',
        }}
      >
        {/* Header do Drawer */}
        <div className="p-4 border-b border-graphite-700 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <LogoNuvemWash size="xs" height={22} />
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 -mr-1.5 text-vapor-300 hover:text-amber-500 hover:bg-graphite-800 rounded-lg transition-colors"
              title="Fechar menu"
            >
              <X size={22} />
            </button>
          </div>

          {/* Nome da Oficina / Seletor de Tenant */}
          {userTenants.length > 1 ? (
            <div className="relative">
              <select
                value={tenant?.id || ''}
                onChange={(e) => trocarTenant(e.target.value)}
                className="w-full bg-graphite-800 border border-graphite-600 rounded px-2.5 py-1.5 font-display text-[13px] text-amber-500 font-bold outline-none cursor-pointer appearance-none pr-8"
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
            <h2 className="font-display text-[15px] text-vapor-100 font-bold tracking-wider truncate">
              {tenant?.nome || 'NuvemWash'}
            </h2>
          )}

          {/* Badges de Plano e Cargo */}
          <div className="flex items-center justify-between gap-2">
            <Badge tone="amber">Plano {nomePlano}</Badge>
            {membership && (
              <span className="font-mono text-[10px] text-amber-400/90 font-bold uppercase tracking-wider px-2 py-0.5 bg-graphite-800 border border-graphite-700 rounded">
                {membership.role}
              </span>
            )}
          </div>

          {/* Atalho para o Painel Admin (se admin) */}
          {isPlatformAdminUser && (
            <NavLink
              to="/admin"
              onClick={onClose}
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

        {/* Lista de Navegação Categorizada com Permissões */}
        <nav className="flex-1 py-3 px-2 flex flex-col gap-4 overflow-y-auto custom-scrollbar">
          {navGroups.map((grupo) => {
            const itensVisiveis = grupo.itens.filter((item) => item.visible);
            if (itensVisiveis.length === 0) return null;

            return (
              <div key={grupo.titulo} className="flex flex-col">
                <div className="px-3 pb-1 pt-1">
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
                      onClick={onClose}
                      className={({ isActive }) =>
                        `relative flex items-center gap-3 px-3 py-2.5 rounded-lg min-h-[42px] font-sans text-[13.5px] transition-colors ${
                          isActive
                            ? 'text-amber-500 font-medium bg-graphite-800 border border-amber-500/30'
                            : 'text-vapor-300 hover:text-vapor-100 hover:bg-graphite-800/60'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
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

        {/* Rodapé com Perfil e Logout */}
        <div className="p-3 border-t border-graphite-700 bg-graphite-900/90 flex items-center justify-between gap-2">
          <div className="flex flex-col truncate pr-2">
            <span className="font-sans text-[12.5px] font-semibold text-vapor-100 truncate">
              {profile?.nome || 'Usuário'}
            </span>
            <span className="font-sans text-[11px] text-vapor-400 truncate">
              {membership?.email || ''}
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              onClose();
              signOut();
            }}
            title="Sair da conta"
            className="p-2 text-vapor-400 hover:text-flare-400 hover:bg-graphite-800 rounded-lg transition-colors flex items-center gap-1.5 shrink-0"
          >
            <LogOut size={17} />
            <span className="text-xs font-semibold">Sair</span>
          </button>
        </div>
      </aside>
    </div>
  );
};
