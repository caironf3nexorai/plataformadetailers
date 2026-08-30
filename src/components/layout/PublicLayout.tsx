import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../ui/Button';
import { useAuth } from '../../contexts/AuthContext';
import { LogOut, Wrench } from 'lucide-react';
import { LogoNuvemWash } from '../ui/LogoNuvemWash';

interface PublicLayoutProps {
  children: React.ReactNode;
}

export const PublicLayout: React.FC<PublicLayoutProps> = ({ children }) => {
  const { user, tenant, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/entrar');
  };

  return (
    <div className="min-h-screen bg-graphite-900 text-vapor-100 flex flex-col font-sans selection:bg-amber-500 selection:text-graphite-900">
      {/* Header Simples */}
      <header className="h-[64px] border-b border-graphite-600 bg-graphite-800/80 backdrop-blur-md sticky top-0 z-40 px-4 sm:px-8 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 hover:opacity-90 transition-opacity">
          <LogoNuvemWash size="sm" />
        </Link>

        <div className="flex items-center gap-3">
          {user ? (
            <div className="flex items-center gap-3">
              {tenant && (
                <Link to="/">
                  <Button variant="secondary" className="text-[13px] px-3 py-1.5 min-h-[36px] flex items-center gap-1.5">
                    <Wrench size={15} />
                    <span>Minha Oficina</span>
                  </Button>
                </Link>
              )}
              <span className="hidden sm:inline font-mono text-[12px] text-vapor-400 max-w-[180px] truncate" title={user.email || ''}>
                {user.email}
              </span>
              <Button
                type="button"
                variant="ghost"
                onClick={handleSignOut}
                className="text-[13px] text-vapor-300 hover:text-flare-400 px-3 py-1.5 min-h-[36px] flex items-center gap-1.5"
                title="Sair da conta atual"
              >
                <LogOut size={15} />
                <span className="hidden sm:inline">Sair</span>
              </Button>
            </div>
          ) : (
            <>
              <Link
                to="/entrar"
                className="text-[14px] font-sans text-vapor-300 hover:text-vapor-100 transition-colors px-3 py-2 min-h-[44px] flex items-center font-medium"
              >
                Entrar
              </Link>
              <Link to="/criar-conta">
                <Button
                  type="button"
                  variant="primary"
                  className="text-[13px] px-4 py-2 min-h-[44px] font-semibold"
                >
                  Criar conta
                </Button>
              </Link>
            </>
          )}
        </div>
      </header>

      {/* Conteúdo Principal */}
      <main className="flex-1 px-4 sm:px-6 py-8 max-w-6xl mx-auto w-full">
        {children}
      </main>

      {/* Rodapé Público Padrão */}
      <footer className="border-t border-graphite-800 bg-graphite-900/60 py-6 px-4 sm:px-8 mt-auto text-xs text-vapor-500">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-display font-semibold text-vapor-300 tracking-wider">
              NuvemWash
            </span>
            <span>&copy; {new Date().getFullYear()}</span>
          </div>
          <div className="flex items-center gap-4">
            <Link
              to="/termos-de-uso"
              className="text-vapor-400 hover:text-amber-400 transition-colors font-medium"
            >
              Termos de Uso
            </Link>
            <span>•</span>
            <Link
              to="/politica-de-privacidade"
              className="text-vapor-400 hover:text-amber-400 transition-colors font-medium"
            >
              Política de Privacidade
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
};
