import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAdminAuth } from './AdminGuard';
import { 
  Building2, 
  CreditCard, 
  ShieldCheck, 
  HardDrive, 
  Users,
  MessageSquare,
  LogOut, 
  Lock,
  DollarSign,
  Gift,
  Award,
  TrendingUp,
  Tv
} from 'lucide-react';
import { CentralNotificacoesMenu } from '../notificacoes/CentralNotificacoesMenu';
import { LogoNuvemWash } from '../ui/LogoNuvemWash';

export const AdminLayout: React.FC = () => {
  const { adminLevel, adminEmail } = useAdminAuth();
  const navigate = useNavigate();

  const navItems = [
    { label: 'Oficinas', path: '/admin/oficinas', icon: Building2 },
    { label: 'Assinaturas & MRR', path: '/admin/assinaturas', icon: DollarSign },
    { label: 'Treinamentos', path: '/admin/treinamentos', icon: Tv },
    { label: 'Ref. Mercado', path: '/admin/referencias-preco', icon: TrendingUp },
    { label: 'Indicações', path: '/admin/indicacoes', icon: Gift },
    { label: 'Parceiros', path: '/admin/parceiros', icon: Award },
    { label: 'Planos', path: '/admin/planos', icon: CreditCard },
    { label: 'Permissões', path: '/admin/planos/permissoes', icon: ShieldCheck },
    { label: 'Feedbacks', path: '/admin/feedbacks', icon: MessageSquare },
    { label: 'Storage', path: '/admin/storage', icon: HardDrive },
    { label: 'Admins', path: '/admin/administradores', icon: Users },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-amber-500 selection:text-slate-950">
      {/* Top Header Bar */}
      <header className="sticky top-0 z-50 bg-slate-900/95 backdrop-blur border-b border-amber-500/20 shadow-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 gap-3">
            
            {/* Logo / Badge (Fixed Left) */}
            <div className="flex items-center space-x-3 shrink-0">
              <NavLink to="/" className="hover:opacity-90 transition-opacity">
                <LogoNuvemWash size="xs" height={22} />
              </NavLink>
              <div className="flex items-center space-x-1.5 bg-gradient-to-r from-amber-500/20 to-amber-600/10 border border-amber-500/40 px-2 py-1 rounded-lg shadow-inner">
                <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="font-heading font-black tracking-wider text-[11px] text-amber-400 uppercase hidden sm:inline">
                  PAINEL ADMIN
                </span>
              </div>
              
              {/* Admin level badge */}
              <span className={`text-[10px] sm:text-xs px-2 py-0.5 rounded-full font-mono font-semibold border shrink-0 ${
                adminLevel === 'admin' 
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
              }`}>
                {adminLevel === 'admin' ? 'ADMIN' : 'LEITURA'}
              </span>
            </div>

            {/* Navigation Tabs (Desktop Scrollable Container) */}
            <nav className="hidden md:flex items-center space-x-1 overflow-x-auto py-1 scrollbar-none max-w-xl xl:max-w-3xl">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={true}
                    className={({ isActive }) =>
                      `flex items-center space-x-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all duration-150 shrink-0 ${
                        isActive
                          ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20 font-bold'
                          : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                      }`
                    }
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </nav>

            {/* User info, Notifications & Exit (Fixed Right) */}
            <div className="flex items-center space-x-2 shrink-0">
              <CentralNotificacoesMenu align="right" />
              <span className="hidden xl:inline text-[11px] text-slate-400 font-mono max-w-[150px] truncate">
                {adminEmail}
              </span>
              <button
                onClick={() => navigate('/')}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 transition shrink-0 shadow-sm"
                title="Sair do Painel Admin e voltar para a Oficina"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Voltar ao App</span>
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Navigation Strip */}
        <div className="md:hidden border-t border-slate-800 bg-slate-900/90 px-2 py-1.5 flex items-center space-x-1 overflow-x-auto scrollbar-none">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={true}
                className={({ isActive }) =>
                  `flex items-center space-x-1 py-1 px-2.5 rounded text-xs font-medium whitespace-nowrap shrink-0 ${
                    isActive ? 'bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30' : 'text-slate-400 hover:text-slate-200'
                  }`
                }
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      </header>

      {/* Support Mode Warning Banner */}
      {adminLevel === 'suporte' && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 text-center text-amber-300 text-xs sm:text-sm flex items-center justify-center space-x-2">
          <Lock className="w-4 h-4 shrink-0 text-amber-400" />
          <span>
            <strong>Modo Suporte Ativo:</strong> Você possui acesso de leitura. Alterações em planos, permissões e limites estão desabilitadas.
          </span>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        <Outlet />
      </main>
    </div>
  );
};
