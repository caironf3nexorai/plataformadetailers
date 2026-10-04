import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { PublicLayout } from '../../components/layout/PublicLayout';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { AlertTriangle, UserPlus, Mail, Rocket, Eye, EyeOff } from 'lucide-react';
import { LogoNuvemWash } from '../../components/ui/LogoNuvemWash';
import { trackCompleteRegistration } from '../../utils/pixel';

export const CriarConta: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const conviteToken = searchParams.get('convite');
  const { signUp, refetchTenantData } = useAuth();

  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [telefone, setTelefone] = useState('');
  const [emailLocked, setEmailLocked] = useState(false);
  const [conviteOficina, setConviteOficina] = useState<string | null>(null);
  const [campanhaInfo, setCampanhaInfo] = useState<{ codigo: string; nome: string; plano_nome: string; dias_trial: number } | null>(null);
  const [trialCadastroAtivo, setTrialCadastroAtivo] = useState<boolean>(true);
  const [trialDiasPadrao, setTrialDiasPadrao] = useState<number>(15);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [emailConfirmationRequired, setEmailConfirmationRequired] = useState(false);
  const [aceitouTermos, setAceitouTermos] = useState(false);

  // Buscar configuração central da plataforma sobre Trial de Cadastro
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const { data } = await supabase.rpc('obter_config_plataforma');
        if (data) {
          if (typeof data.trial_cadastro_ativo === 'boolean') {
            setTrialCadastroAtivo(data.trial_cadastro_ativo);
          }
          if (typeof data.trial_dias_padrao === 'number') {
            setTrialDiasPadrao(data.trial_dias_padrao);
          }
        }
      } catch (err) {
        console.warn('[CriarConta] Erro ao carregar config da plataforma:', err);
      }
    };
    fetchConfig();
  }, []);

  // Captura de Parâmetros de Indicação, Parceiro e Campanha
  useEffect(() => {
    // 1. Parceiro Comercial
    const codParceiro = searchParams.get('parceiro') || searchParams.get('ref') || searchParams.get('cupom');
    if (codParceiro && codParceiro.trim()) {
      localStorage.setItem('parceiro_codigo', codParceiro.trim().toUpperCase());
    }

    // 2. Indicação de Oficina (Indique e Ganhe)
    const codIndicacao = searchParams.get('indicacao') || (!searchParams.get('parceiro') ? searchParams.get('convite') : null);
    if (codIndicacao && codIndicacao.trim()) {
      localStorage.setItem('convite_codigo', codIndicacao.trim().toUpperCase());
    }

    // 3. Campanha de Lançamento
    const codCampanha = searchParams.get('campanha') || localStorage.getItem('campanha_codigo');
    if (codCampanha) {
      const codLimpo = codCampanha.trim().toUpperCase();
      localStorage.setItem('campanha_codigo', codLimpo);
      
      const buscarCampanha = async () => {
        try {
          const { data, error } = await supabase.rpc('obter_campanha_lancamento_publica', { p_codigo: codLimpo });
          if (!error && data && (data as any).valida) {
            setCampanhaInfo(data as any);
          }
        } catch (err) {
          console.error('[CriarConta] Erro ao validar campanha:', err);
        }
      };

      buscarCampanha();
    }
  }, [searchParams]);

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

      // Dispara o evento de ouro de conversão para o Meta/Google Ads
      trackCompleteRegistration({
        method: 'email',
        convite: !!conviteToken,
        plano: campanhaInfo?.plano_nome || (trialCadastroAtivo ? 'Trial 15 Dias Pro' : 'Free'),
      });

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
        // Sem convite: vai para o cadastro da nova oficina preservando parceiro/convite/campanha
        const navParams = new URLSearchParams();
        const pCod = searchParams.get('parceiro') || localStorage.getItem('parceiro_codigo');
        const cCod = searchParams.get('convite') || localStorage.getItem('convite_codigo');
        const campCod = searchParams.get('campanha') || localStorage.getItem('campanha_codigo');
        if (pCod) navParams.set('parceiro', pCod);
        if (cCod) navParams.set('convite', cCod);
        if (campCod) navParams.set('campanha', campCod);

        const qs = navParams.toString() ? `?${navParams.toString()}` : '';
        navigate(`/nova-oficina${qs}`);
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
        <div className="text-center flex flex-col items-center gap-3">
          <LogoNuvemWash size="lg" className="mb-1" />
          <h1 className="font-display text-[24px] sm:text-[28px] text-vapor-100 uppercase tracking-wide">
            Criar Sua Conta
          </h1>
          <p className="font-sans text-[14px] text-vapor-400">
            {conviteOficina
              ? `Você foi convidado para a oficina ${conviteOficina}`
              : 'Comece a organizar sua oficina com o NuvemWash'}
          </p>
        </div>

        <Card className="p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-4 shadow-xl">
          {campanhaInfo && (
            <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center gap-2.5 text-amber-400 text-xs font-sans shadow-sm">
              <Rocket size={18} className="shrink-0 text-amber-400 animate-pulse" />
              <span>
                <strong>Convite VIP de Lançamento Aplicado:</strong> Você terá <strong>{campanhaInfo.dias_trial} dias grátis</strong> no <strong>Plano {campanhaInfo.plano_nome}</strong>!
              </span>
            </div>
          )}

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
                <div className="relative flex items-center">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Mínimo 6 caracteres"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="min-h-[48px] pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 p-1.5 text-vapor-400 hover:text-amber-400 focus:outline-none transition-colors"
                    title={showPassword ? 'Ocultar senha' : 'Visualizar senha'}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* Quadro de Aceite de Termos e Privacidade (LGPD) */}
              <div className="p-3.5 bg-graphite-900/90 border border-graphite-700/80 rounded-xl space-y-2">
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={aceitouTermos}
                    onChange={(e) => setAceitouTermos(e.target.checked)}
                    required
                    className="mt-0.5 w-4 h-4 rounded border-graphite-600 text-amber-500 focus:ring-amber-500 bg-graphite-950 shrink-0 cursor-pointer"
                  />
                  <span className="font-sans text-[12px] text-vapor-300 leading-relaxed">
                    Li e concordo com os{' '}
                    <a
                      href="/termos-de-uso"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-amber-400 hover:text-amber-300 underline font-medium"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Termos de Uso
                    </a>{' '}
                    e a{' '}
                    <a
                      href="/politica-de-privacidade"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-amber-400 hover:text-amber-300 underline font-medium"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Política de Privacidade
                    </a>{' '}
                    do NuvemWash.
                  </span>
                </label>
                <p className="text-[11px] text-vapor-500 font-mono pl-6">
                  {campanhaInfo ? (
                    `Convite Especial ${campanhaInfo.nome}: ${campanhaInfo.dias_trial} dias grátis no Plano ${campanhaInfo.plano_nome}`
                  ) : trialCadastroAtivo ? (
                    `Trial de ${trialDiasPadrao} dias sem cartão • Isolamento de dados LGPD • Cancele quando quiser`
                  ) : (
                    'Crie sua conta em segundos • Isolamento de dados LGPD • Cancele quando quiser'
                  )}
                </p>
              </div>

              <Button
                type="submit"
                variant="primary"
                disabled={loading || !aceitouTermos}
                className={`mt-2 min-h-[48px] w-full font-semibold ${
                  !aceitouTermos ? 'opacity-50 cursor-not-allowed' : ''
                }`}
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
