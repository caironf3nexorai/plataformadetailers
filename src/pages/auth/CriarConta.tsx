import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { PublicLayout } from '../../components/layout/PublicLayout';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { AlertTriangle, UserPlus, Mail } from 'lucide-react';

export const CriarConta: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const conviteToken = searchParams.get('convite');
  const { signUp, refetchTenantData } = useAuth();

  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [telefone, setTelefone] = useState('');
  const [emailLocked, setEmailLocked] = useState(false);
  const [conviteOficina, setConviteOficina] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [emailConfirmationRequired, setEmailConfirmationRequired] = useState(false);

  // E-mail pré-preenchido e travado para convites
  useEffect(() => {
    if (!conviteToken) return;

    const loadConviteInfo = async () => {
      try {
        const { data, error } = await supabase.rpc('convite_info', { p_token: conviteToken });
        if (!error && data && data.length > 0 && data[0].valido) {
          setEmail(data[0].email);
          setEmailLocked(true);
          setConviteOficina(data[0].oficina);
        }
      } catch (err) {
        console.error('[CriarConta Convite Info Exception]:', err);
      }
    };

    loadConviteInfo();
  }, [conviteToken]);

  const translateAuthError = (err: any): string => {
    console.error('[CriarConta Error Original]:', err);
    const msg = err?.message || '';

    if (msg.includes('User already registered') || msg.includes('already exists')) {
      return 'Este e-mail já está cadastrado. Tente entrar na sua conta ou recuperar a senha.';
    }
    if (msg.includes('Password should be at least')) {
      return 'A senha deve ter pelo menos 6 caracteres.';
    }
    if (msg.includes('rate limit')) {
      return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.';
    }
    if (msg) {
      return `Erro no cadastro: ${msg}`;
    }
    return 'Não foi possível concluir o cadastro. Verifique os dados e tente novamente.';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (password.length < 6) {
      setErrorMsg('A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await signUp(email, password, nome, telefone);
      
      if (error) {
        setErrorMsg(translateAuthError(error));
        setLoading(false);
        return;
      }

      // Verifica se houve criação de sessão ativa imediatamente
      const activeSession = data?.session || (await supabase.auth.getSession()).data.session;

      if (activeSession) {
        if (conviteToken) {
          // Aceite automático do convite após cadastro
          try {
            const { error: aceitarErr } = await supabase.rpc('aceitar_convite', { p_token: conviteToken });
            if (aceitarErr) {
              console.error('[Aceitar Convite RPC Error no Signup]:', aceitarErr);
            }
            await refetchTenantData();
            navigate('/');
            return;
          } catch (err) {
            console.error('[Aceitar Convite Exception no Signup]:', err);
          }
        }
        // Sem convite: vai para o cadastro da nova oficina
        navigate('/nova-oficina');
      } else {
        // Sem sessão: o projeto Supabase exige confirmação por e-mail
        setEmailConfirmationRequired(true);
        setLoading(false);
      }
    } catch (err: any) {
      setErrorMsg(translateAuthError(err));
      setLoading(false);
    }
  };

  return (
    <PublicLayout>
      <div className="max-w-md mx-auto w-full flex flex-col gap-6 py-6">
        <div className="text-center flex flex-col gap-2">
          <h1 className="font-display text-[26px] sm:text-[30px] text-vapor-100 uppercase tracking-wide">
            Criar Sua Conta
          </h1>
          <p className="font-sans text-[14px] text-vapor-400">
            {conviteOficina
              ? `Você foi convidado para a oficina ${conviteOficina}`
              : 'Comece a organizar sua oficina com a Plataforma Detailers'}
          </p>
        </div>

        <Card className="p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-4 shadow-xl">
          {errorMsg && (
            <div className="p-3 bg-flare-400/10 border border-flare-400/30 rounded flex items-center gap-2 text-flare-400 text-[13px]">
              <AlertTriangle size={18} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {emailConfirmationRequired ? (
            <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded flex flex-col items-center text-center gap-4 text-amber-500">
              <Mail size={40} className="shrink-0 text-amber-500" />
              <div className="flex flex-col gap-1">
                <span className="font-sans text-[16px] font-bold">Confirme seu e-mail</span>
                <p className="font-sans text-[13px] text-vapor-400 leading-relaxed">
                  Conta criada com sucesso! Enviamos um e-mail de confirmação para{' '}
                  <strong className="text-vapor-100">{email}</strong>.
                </p>
                <p className="font-sans text-[12px] text-vapor-400 mt-2">
                  Por favor, acesse sua caixa de entrada e clique no link de confirmação antes de entrar na plataforma.
                </p>
              </div>

              <Link to={conviteToken ? `/entrar?convite=${conviteToken}` : '/entrar'} className="w-full mt-2">
                <Button type="button" variant="primary" className="w-full min-h-[44px]">
                  Ir para a tela de Login
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label className="font-sans text-[13px] text-vapor-400 font-medium">Nome completo *</label>
                <Input
                  type="text"
                  placeholder="Ex: João da Silva"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  required
                  className="min-h-[48px]"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-sans text-[13px] text-vapor-400 font-medium">E-mail *</label>
                <Input
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={emailLocked || loading}
                  className="min-h-[48px]"
                />
                {emailLocked && conviteOficina && (
                  <span className="font-sans text-[12px] text-amber-400 mt-1">
                    E-mail vinculado ao convite da oficina <strong>{conviteOficina}</strong>
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-sans text-[13px] text-vapor-400 font-medium">WhatsApp / Telefone</label>
                <Input
                  type="tel"
                  placeholder="(11) 99999-9999"
                  value={telefone}
                  onChange={(e) => setTelefone(e.target.value)}
                  className="min-h-[48px]"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-sans text-[13px] text-vapor-400 font-medium">Senha *</label>
                <Input
                  type="password"
                  placeholder="Mínimo 6 caracteres"
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
                  'Criando conta...'
                ) : (
                  <>
                    <UserPlus size={18} />
                    {conviteToken ? 'Criar conta e Aceitar Convite' : 'Criar conta grátis'}
                  </>
                )}
              </Button>
            </form>
          )}

          {!emailConfirmationRequired && (
            <div className="pt-4 border-t border-graphite-600 text-center">
              <p className="font-sans text-[13px] text-vapor-400">
                Já possui uma conta?{' '}
                <Link
                  to={conviteToken ? `/entrar?convite=${conviteToken}` : '/entrar'}
                  className="text-amber-500 font-semibold hover:underline"
                >
                  Entrar
                </Link>
              </p>
            </div>
          )}
        </Card>
      </div>
    </PublicLayout>
  );
};
