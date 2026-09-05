import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { LogoNuvemWash } from '../../components/ui/LogoNuvemWash';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Award, AlertTriangle, ArrowRight, Lock, Mail } from 'lucide-react';

export const LoginParceiro: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error || !data.user) {
        throw new Error('E-mail ou senha inválidos. Verifique suas credenciais de parceiro.');
      }

      // Validar se o usuário possui registro de parceiro
      const { data: dadosPainel, error: errPainel } = await supabase.rpc('parceiro_obter_dados_painel');

      if (errPainel || !dadosPainel?.is_parceiro) {
        // Tentar verificar diretamente na tabela de parceiros por e-mail
        const { data: parceiroRow } = await supabase
          .from('parceiros')
          .select('id')
          .ilike('email', email.trim())
          .maybeSingle();

        if (!parceiroRow) {
          await supabase.auth.signOut();
          throw new Error('Este e-mail não está cadastrado como parceiro comercial oficial da plataforma.');
        }
      }

      navigate('/parceiro/painel');
    } catch (err: any) {
      console.error('[Login Parceiro Error]:', err);
      setErrorMsg(err.message || 'Erro ao realizar login de parceiro.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 md:p-8 relative overflow-hidden font-sans selection:bg-amber-500 selection:text-slate-950">
      {/* Background Glows */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-full pointer-events-none overflow-hidden -z-10">
        <div className="absolute -top-40 left-1/3 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-10 right-10 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
      </div>

      <header className="max-w-5xl w-full mx-auto flex items-center justify-between py-4 z-10">
        <LogoNuvemWash size="md" />
        <Link
          to="/entrar"
          className="text-xs md:text-sm text-slate-400 hover:text-white transition flex items-center gap-1"
        >
          <span>Acesso Oficina</span>
          <ArrowRight size={14} />
        </Link>
      </header>

      <main className="max-w-md w-full mx-auto my-auto py-8 z-10">
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-semibold mb-3">
            <Award size={14} />
            Programa de Parceiros Comerciais
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
            Portal do Parceiro
          </h1>
          <p className="text-slate-400 text-sm mt-1.5">
            Acompanhe suas indicações, métricas de comissão e gerencie sua Chave PIX.
          </p>
        </div>

        <Card className="p-6 md:p-8 bg-slate-900/90 border-slate-800 backdrop-blur-xl shadow-2xl rounded-2xl flex flex-col gap-5">
          {errorMsg && (
            <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-xs flex items-start gap-2.5">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span className="leading-relaxed">{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-300">E-mail Cadastrado</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <Input
                  type="email"
                  placeholder="parceiro@exemplo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="pl-10 h-12 bg-slate-950/60 border-slate-700 text-slate-100 rounded-xl focus:border-amber-500 text-sm"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300">Senha de Acesso</label>
                <Link to="/recuperar-senha" className="text-xs text-amber-400 hover:underline">
                  Esqueci minha senha
                </Link>
              </div>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="pl-10 h-12 bg-slate-950/60 border-slate-700 text-slate-100 rounded-xl focus:border-amber-500 text-sm"
                />
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              disabled={loading}
              className="w-full h-12 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/20 mt-2 flex items-center justify-center gap-2"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <span>Entrar no Painel</span>
                  <ArrowRight size={16} />
                </>
              )}
            </Button>
          </form>
        </Card>

        <p className="text-center text-xs text-slate-500 mt-6">
          Dúvidas sobre o programa de afiliados? Fale com nosso time de atendimento.
        </p>
      </main>

      <footer className="text-center py-4 text-xs text-slate-600">
        NuvemWash © 2026 • Plataforma de Gestão Detailers
      </footer>
    </div>
  );
};
