import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { PublicLayout } from '../../components/layout/PublicLayout';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { supabase } from '../../lib/supabase';
import { AlertTriangle, CheckCircle2, KeyRound } from 'lucide-react';

export const RecuperarSenha: React.FC = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/entrar`,
      });

      if (error) {
        console.error('[RecuperarSenha Error Original]:', error);
        setErrorMsg('Não foi possível enviar o link de redefinição. Verifique se o e-mail está correto.');
      } else {
        setSuccess(true);
      }
    } catch (err: any) {
      console.error('[RecuperarSenha Exception Original]:', err);
      setErrorMsg('Erro inesperado ao processar solicitação. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <PublicLayout>
      <div className="max-w-md mx-auto w-full flex flex-col gap-6 py-6">
        <div className="text-center flex flex-col gap-2">
          <h1 className="font-display text-[26px] sm:text-[30px] text-vapor-100 uppercase tracking-wide">
            Recuperar Senha
          </h1>
          <p className="font-sans text-[14px] text-vapor-400">
            Enviaremos um link de redefinição para o seu e-mail
          </p>
        </div>

        <Card className="p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-4 shadow-xl">
          {errorMsg && (
            <div className="p-3 bg-flare-400/10 border border-flare-400/30 rounded flex items-center gap-2 text-flare-400 text-[13px]">
              <AlertTriangle size={18} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {success ? (
            <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded flex flex-col items-center text-center gap-3 text-amber-500">
              <CheckCircle2 size={32} />
              <span className="font-sans text-[15px] font-semibold">Link enviado!</span>
              <p className="font-sans text-[13px] text-vapor-400 leading-relaxed">
                Verifique sua caixa de entrada no e-mail <strong className="text-vapor-100">{email}</strong> para redefinir sua senha.
              </p>
              <Link to="/entrar" className="mt-2 w-full">
                <Button type="button" variant="primary" className="w-full min-h-[44px]">
                  Voltar ao Login
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label className="font-sans text-[13px] text-vapor-400 font-medium">E-mail cadastrado</label>
                <Input
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
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
                  'Enviando...'
                ) : (
                  <>
                    <KeyRound size={18} />
                    Enviar Link de Redefinição
                  </>
                )}
              </Button>
            </form>
          )}

          <div className="pt-4 border-t border-graphite-600 text-center">
            <Link to="/entrar" className="font-sans text-[13px] text-vapor-400 hover:text-vapor-100 transition-colors">
              &larr; Voltar para o login
            </Link>
          </div>
        </Card>
      </div>
    </PublicLayout>
  );
};
