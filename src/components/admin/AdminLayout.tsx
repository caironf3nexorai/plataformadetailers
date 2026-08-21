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
  Lock
} from 'lucide-react';

export const AdminLayout: React.FC = () => {
  const { adminLevel, adminEmail } = useAdminAuth();
  const navigate = useNavigate();

  const navItems = [
    { label: 'Oficinas', path: '/admin/oficinas', icon: Building2 },
    { label: 'Planos', path: '/admin/planos', icon: CreditCard },
    { label: 'Permissões', path: '/admin/planos/permissoes', icon: ShieldCheck },
    { label: 'Feedbacks', path: '/admin/feedbacks', icon: MessageSquare },
    { label: 'Storage', path: '/admin/storage', icon: HardDrive },
    { label: 'Administradores', path: '/admin/administradores', icon: Users },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-amber-500 selection:text-slate-950">
      {/* Top Header Bar */}
      <header className="sticky top-0 z-50 bg-slate-900/95 backdrop-blur border-b border-amber-500/20 shadow-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            
            {/* Logo / Badge */}
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2 bg-gradient-to-r from-amber-500/20 to-amber-600/10 border border-amber-500/40 px-3 py-1.5 rounded-lg shadow-inner">
                <ShieldCheck className="w-5 h-5 text-amber-400" />
                <span className="font-heading font-black tracking-wider text-xs sm:text-sm text-amber-400 uppercase">
                  PAINEL DA PLATAFORMA
                </span>
              </div>
              
              {/* Admin level badge */}
              <span className={`text-xs px-2.5 py-0.5 rounded-full font-mono font-semibold border ${
                adminLevel === 'admin' 
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
              }`}>
                {adminLevel === 'admin' ? 'ADMINISTRADOR' : 'SUPORTE (LEITURA)'}
              </span>
            </div>

            {/* Navigation Tabs (Desktop) */}
            <nav className="hidden md:flex items-center space-x-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={true}
                    className={({ isActive }) =>
                      `flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-all duration-150 ${
                        isActive
                          ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20 font-bold'
                          : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                      }`
                    }
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </nav>

            {/* User info & Exit */}
            <div className="flex items-center space-x-3">
              <span className="hidden lg:inline text-xs text-slate-400 font-mono">
                {adminEmail}
              </span>
              <button
                onClick={() => navigate('/')}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition"
                title="Sair do Painel Admin e voltar para a Oficina"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Voltar ao App</span>
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Navigation Strip */}
        <div className="md:hidden border-t border-slate-800 bg-slate-900/90 px-2 py-1.5 flex justify-around">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={true}
                className={({ isActive }) =>
                  `flex flex-col items-center py-1 px-2 rounded text-xs font-medium ${
                    isActive ? 'text-amber-400 font-bold' : 'text-slate-400 hover:text-slate-200'
                  }`
                }
              >
                <Icon className="w-4 h-4 mb-0.5" />
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
