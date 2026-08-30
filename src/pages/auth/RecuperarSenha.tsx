import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PublicLayout } from '../../components/layout/PublicLayout';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { supabase } from '../../lib/supabase';
import { AlertTriangle, CheckCircle2, KeyRound, Lock, ArrowRight } from 'lucide-react';
import { LogoNuvemWash } from '../../components/ui/LogoNuvemWash';

export const RecuperarSenha: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  // Estados para modo de redefinição de senha
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [senhaRedefinidaComSucesso, setSenhaRedefinidaComSucesso] = useState(false);

  // Detecta se o usuário acessou a tela através do link de redefinição enviado por e-mail
  useEffect(() => {
    // 1. Escuta o evento PASSWORD_RECOVERY do Supabase Auth
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecoveryMode(true);
      }
    });

    // 2. Fallback: analisa se a URL contém hash ou parâmetros de recovery
    const hash = window.location.hash;
    const search = window.location.search;
    if (hash.includes('type=recovery') || search.includes('type=recovery')) {
      setIsRecoveryMode(true);
    }

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, []);

  // Solicitar envio do e-mail de recuperação
  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    try {
      const redirectUrl = `${window.location.origin}/recuperar-senha`;
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: redirectUrl,
      });

      if (error) {
        console.error('[RecuperarSenha Error]:', error);
        setErrorMsg('Não foi possível enviar o link de redefinição. Verifique se o e-mail está correto.');
      } else {
        setEmailSent(true);
      }
    } catch (err: any) {
      console.error('[RecuperarSenha Exception]:', err);
      setErrorMsg('Erro inesperado ao processar solicitação. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  // Salvar a nova senha
  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (novaSenha.length < 6) {
      setErrorMsg('A nova senha deve ter pelo menos 6 caracteres.');
      return;
    }

    if (novaSenha !== confirmarSenha) {
      setErrorMsg('As senhas digitadas não coincidem.');
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: novaSenha,
      });

      if (error) {
        console.error('[UpdatePassword Error]:', error);
        setErrorMsg(error.message || 'Erro ao atualizar senha. O link pode ter expirado.');
      } else {
        setSenhaRedefinidaComSucesso(true);
      }
    } catch (err: any) {
      console.error('[UpdatePassword Exception]:', err);
      setErrorMsg('Erro inesperado ao atualizar a senha. Tente novamente.');
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
            {isRecoveryMode ? 'Criar Nova Senha' : 'Recuperar Senha'}
          </h1>
          <p className="font-sans text-[14px] text-vapor-400">
            {isRecoveryMode
              ? 'Digite sua nova senha de acesso abaixo'
              : 'Enviaremos um link de redefinição para o seu e-mail'}
          </p>
        </div>

        <Card className="p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-4 shadow-xl">
          {errorMsg && (
            <div className="p-3 bg-flare-400/10 border border-flare-400/30 rounded flex items-center gap-2 text-flare-400 text-[13px]">
              <AlertTriangle size={18} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* SUCESSO AO REDEFINIR A NOVA SENHA */}
          {senhaRedefinidaComSucesso ? (
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded flex flex-col items-center text-center gap-3 text-emerald-400">
              <CheckCircle2 size={36} />
              <span className="font-sans text-[16px] font-bold">Senha alterada com sucesso!</span>
              <p className="font-sans text-[13px] text-vapor-300 leading-relaxed">
                Sua senha foi redefinida com segurança. Você já pode fazer login na plataforma.
              </p>
              <Button
                type="button"
                variant="primary"
                onClick={() => navigate('/entrar')}
                className="mt-2 w-full min-h-[44px] flex items-center justify-center gap-2"
              >
                <span>Fazer Login</span>
                <ArrowRight size={16} />
              </Button>
            </div>
          ) : isRecoveryMode ? (
            /* FORMULÁRIO PARA DIGITAR A NOVA SENHA */
            <form onSubmit={handleUpdatePassword} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label className="font-sans text-[13px] text-vapor-400 font-medium">Nova Senha *</label>
                <Input
                  type="password"
                  placeholder="Mínimo 6 caracteres"
                  value={novaSenha}
                  onChange={(e) => setNovaSenha(e.target.value)}
                  required
                  className="min-h-[48px]"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-sans text-[13px] text-vapor-400 font-medium">Confirmar Nova Senha *</label>
                <Input
                  type="password"
                  placeholder="Repita a nova senha"
                  value={confirmarSenha}
                  onChange={(e) => setConfirmarSenha(e.target.value)}
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
                  'Salvando nova senha...'
                ) : (
                  <>
                    <Lock size={18} />
                    Salvar Nova Senha
                  </>
                )}
              </Button>
            </form>
          ) : emailSent ? (
            /* E-MAIL DE RECUPERAÇÃO ENVIADO */
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
            /* FORMULÁRIO DE SOLICITAÇÃO DE E-MAIL */
            <form onSubmit={handleRequestReset} className="flex flex-col gap-4">
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
