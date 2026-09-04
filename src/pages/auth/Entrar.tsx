import React, { useState } from 'react';
import { useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import { PublicLayout } from '../../components/layout/PublicLayout';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { useAuth } from '../../contexts/AuthContext';
import { AlertTriangle, LogIn } from 'lucide-react';
import { LogoNuvemWash } from '../../components/ui/LogoNuvemWash';

export const Entrar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const conviteParam = searchParams.get('convite');
  const { signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(
    (location.state as any)?.errorMsg || null
  );
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    try {
      const { error } = await signIn(email, password);
      if (error) {
        console.error('[Entrar Error Original]:', error);
        setErrorMsg('E-mail ou senha incorretos. Verifique suas credenciais.');
      } else {
        if (conviteParam) {
          navigate(`/convite/${conviteParam}`);
        } else {
          navigate('/');
        }
      }
    } catch (err: any) {
      console.error('[Entrar Exception Original]:', err);
      setErrorMsg('Não foi possível efetuar o login. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <PublicLayout>
      <div className="max-w-md mx-auto w-full flex flex-col gap-6 py-6">
        <div className="text-center flex flex-col items-center gap-3">
          <LogoNuvemWash size="lg" className="mb-1" />
          <h1 className="font-display text-[24px] sm:text-[28px] text-vapor-100 uppercase tracking-wide">
            Acessar Plataforma
          </h1>
          <p className="font-sans text-[14px] text-vapor-400">
            Acesse o sistema de gestão da sua estética automotiva
          </p>
        </div>

        <Card className="p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-4 shadow-xl">
          {errorMsg && (
            <div className="p-3 bg-flare-400/10 border border-flare-400/30 rounded flex items-center gap-2 text-flare-400 text-[13px]">
              <AlertTriangle size={18} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="font-sans text-[13px] text-vapor-400 font-medium">E-mail</label>
              <Input
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="min-h-[48px]"
              />
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex justify-between items-center">
                <label className="font-sans text-[13px] text-vapor-400 font-medium">Senha</label>
                <Link to="/recuperar-senha" className="font-sans text-[12px] text-amber-500 hover:underline">
                  Esqueceu a senha?
                </Link>
              </div>
              <Input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="min-h-[48px]"
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              disabled={loading}
              className="mt-2 min-h-[48px] w-full font-semibold"
            >
              {loading ? (
                'Entrando...'
              ) : (
                <>
                  <LogIn size={18} />
                  Entrar
                </>
              )}
            </Button>
          </form>

          <div className="pt-4 border-t border-graphite-600 text-center">
            <p className="font-sans text-[13px] text-vapor-400">
              Ainda não tem conta?{' '}
              <Link
                to={conviteParam ? `/criar-conta?convite=${conviteParam}` : '/criar-conta'}
                className="text-amber-500 font-semibold hover:underline"
              >
                Criar conta grátis
              </Link>
            </p>
          </div>
        </Card>

        <div className="flex items-center justify-center gap-4 text-xs text-vapor-400">
          <Link to="/" className="hover:text-amber-400 transition-colors">
            ← Conhecer o NuvemWash
          </Link>
          <span>•</span>
          <Link to="/calculadora" className="hover:text-amber-400 transition-colors">
            Calculadora Grátis
          </Link>
        </div>
      </div>
    </PublicLayout>
  );
};
