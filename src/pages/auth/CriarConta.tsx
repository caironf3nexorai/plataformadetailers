import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { PublicLayout } from '../../components/layout/PublicLayout';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { AlertTriangle, UserPlus, Rocket, Eye, EyeOff, Sparkles } from 'lucide-react';
import { LogoNuvemWash } from '../../components/ui/LogoNuvemWash';
import { trackCompleteRegistration } from '../../utils/pixel';
import { formatTelefone } from '../../utils/formatters';
import {
  CALCULADORA_LEAD_STORAGE_KEY,
  type CalculadoraLeadSessao,
} from '../../utils/calculadoraLead';
import {
  validarEmailReal,
  validarWhatsAppBrasileiro,
} from '../../utils/validacaoCadastro';

export const CriarConta: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const conviteToken = searchParams.get('convite');
  const { signUp, refetchTenantData } = useAuth();

  const [nome, setNome] = useState('');
  const [nomeOficina, setNomeOficina] = useState('');
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
  const signedUpEmailRef = useRef<string | null>(null);

  const isUUID = (val: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val.trim());
  const isConviteEquipe = Boolean((conviteToken && isUUID(conviteToken)) || conviteOficina);

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
    // ⚠️ O parâmetro ?convite= é compartilhado entre:
    //   - Convites de EQUIPE: token UUID longo (ex: "550e8400-e29b-41d4-a716-446655440000")
    //   - Códigos de INDICAÇÃO: código curto alfanumérico (ex: "OFICINA123")
    // Só salva como indicação se o valor NÃO parecer um UUID (convite de equipe)
    const codIndicacao = searchParams.get('indicacao')
      || (!searchParams.get('parceiro')
        ? (() => {
            const c = searchParams.get('convite');
            // Não tratar token de convite de equipe (UUID) como código de indicação
            return c && !isUUID(c) ? c : null;
          })()
        : null);

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

  // Pré-preenchimento vindo do Funil da Calculadora (/calculadora) via query params ou router state
  useEffect(() => {
    const stateObj = (location.state as {
      fromCalculadora?: boolean;
      lead?: CalculadoraLeadSessao;
    } | null) || null;

    const origemCalculadora =
      searchParams.get('origem') === 'calculadora' || Boolean(stateObj?.fromCalculadora);

    let sessionLead: CalculadoraLeadSessao | null = null;
    if (origemCalculadora) {
      try {
        const raw = sessionStorage.getItem(CALCULADORA_LEAD_STORAGE_KEY);
        if (raw) sessionLead = JSON.parse(raw) as CalculadoraLeadSessao;
      } catch {}
    }

    const prefillNome = searchParams.get('nome') || stateObj?.lead?.nome || sessionLead?.nome;
    const prefillEmail = searchParams.get('email') || stateObj?.lead?.email || sessionLead?.email;
    const prefillWhatsapp =
      searchParams.get('whatsapp') ||
      searchParams.get('telefone') ||
      stateObj?.lead?.whatsapp ||
      sessionLead?.whatsapp;
    const prefillLeadId =
      searchParams.get('lead_id') || stateObj?.lead?.leadId || sessionLead?.leadId;

    if (prefillLeadId) {
      try {
        sessionStorage.setItem('calculadora_lead_id', prefillLeadId);
      } catch {}
    }

    if (prefillNome) {
      setNome((prev) => (prev.trim() ? prev : prefillNome.trim()));
    }
    if (prefillEmail && !emailLocked && !conviteToken) {
      setEmail((prev) => (prev.trim() ? prev : prefillEmail.trim().toLowerCase()));
    }
    if (prefillWhatsapp) {
      setTelefone((prev) => (prev.trim() ? prev : formatTelefone(prefillWhatsapp)));
    }
  }, [searchParams, location.state, emailLocked, conviteToken]);

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

    if (!isConviteEquipe && nomeOficina.trim().length < 2) {
      setErrorMsg('Informe o nome da sua estética ou oficina (mínimo 2 caracteres).');
      return;
    }

    const resEmail = validarEmailReal(email);
    if (!resEmail.valido) {
      setErrorMsg(resEmail.erro || 'Informe um e-mail válido.');
      return;
    }

    const resZap = validarWhatsAppBrasileiro(telefone);
    if (!resZap.valido) {
      setErrorMsg(resZap.erro || 'Informe um WhatsApp válido com DDD.');
      return;
    }

    if (password.length < 6) {
      setErrorMsg('A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    setLoading(true);

    try {
      const cleanEmail = email.trim().toLowerCase();
      let activeSession =
        signedUpEmailRef.current === cleanEmail
          ? (await supabase.auth.getSession()).data.session
          : null;

      if (!activeSession) {
        const { data, error } = await signUp(cleanEmail, password, nome.trim(), telefone.trim() || undefined);

        if (error) {
          setErrorMsg(translateAuthError(error));
          setLoading(false);
          return;
        }

        signedUpEmailRef.current = cleanEmail;

        // Dispara o evento de conversão para o Meta/Google Ads imediatamente
        trackCompleteRegistration({
          method: 'email',
          email: cleanEmail,
          phone: telefone?.replace(/\D/g, ''),
          convite: isConviteEquipe,
          plano: campanhaInfo?.plano_nome || (trialCadastroAtivo ? 'Trial 15 Dias Pro' : 'Free'),
        });

        activeSession = data?.session || (await supabase.auth.getSession()).data.session;

        if (!activeSession) {
          // Fallback instantâneo: autentica com senha para garantir sessão ativa sem delay
          try {
            const { data: signInData } = await supabase.auth.signInWithPassword({
              email: cleanEmail,
              password,
            });
            if (signInData?.session) {
              activeSession = signInData.session;
            }
          } catch (errSignIn) {
            console.warn('[CriarConta] Tentativa de login imediato pós-signup:', errSignIn);
          }
        }
      }

      if (isConviteEquipe && conviteToken) {
        if (!activeSession) {
          navigate(`/nova-oficina?convite=${conviteToken}`);
          return;
        }
        const { error: aceitarErr } = await supabase.rpc('aceitar_convite', { p_token: conviteToken });
        if (aceitarErr) {
          console.error('[Aceitar Convite RPC Error no Signup]:', aceitarErr);
          setErrorMsg(aceitarErr.message || 'Erro ao aceitar convite da oficina.');
          setLoading(false);
          return;
        }
        await refetchTenantData();
        navigate('/');
        return;
      }

      // Cadastro em 1 passo: cria a oficina e entra direto no painel pré-configurado
      if (activeSession) {
        const parceiroCodigo =
          searchParams.get('parceiro') ||
          searchParams.get('ref') ||
          searchParams.get('cupom') ||
          localStorage.getItem('parceiro_codigo');

        const rawConvite =
          searchParams.get('indicacao') ||
          (!searchParams.get('parceiro') && conviteToken && !isUUID(conviteToken) ? conviteToken : null) ||
          localStorage.getItem('convite_codigo');
        const conviteCodigo = rawConvite && !isUUID(rawConvite) ? rawConvite : null;

        const campanhaCodigo = searchParams.get('campanha') || localStorage.getItem('campanha_codigo');

        const { error: oficinaErr } = await supabase.rpc('criar_oficina', {
          p_nome: nomeOficina.trim(),
          p_cidade: null,
          p_uf: null,
          p_telefone: telefone.trim() || null,
          p_codigo_indicacao: conviteCodigo ? conviteCodigo.trim().toUpperCase() : null,
          p_codigo_parceiro: parceiroCodigo ? parceiroCodigo.trim().toUpperCase() : null,
          p_codigo_campanha: campanhaCodigo ? campanhaCodigo.trim().toUpperCase() : null,
        });

        if (oficinaErr) {
          console.error('[CriarConta criar_oficina RPC Error]:', oficinaErr);
          setErrorMsg(oficinaErr.message || 'Conta criada, mas houve erro ao preparar sua oficina. Clique novamente para concluir.');
          setLoading(false);
          return;
        }

        localStorage.removeItem('convite_codigo');
        localStorage.removeItem('parceiro_codigo');
        localStorage.removeItem('campanha_codigo');
        try {
          const leadId =
            searchParams.get('lead_id') || sessionStorage.getItem('calculadora_lead_id');
          await supabase.rpc('marcar_lead_calculadora_convertido', {
            p_lead_id: leadId && isUUID(leadId) ? leadId : null,
          });
          sessionStorage.removeItem('calculadora_lead_id');
          sessionStorage.removeItem(CALCULADORA_LEAD_STORAGE_KEY);
        } catch {}
        try {
          sessionStorage.removeItem('pending_meta_complete_registration');
        } catch {}

        await refetchTenantData();
        navigate('/');
        return;
      }

      // Fallback caso o provedor exija confirmação prévia antes da criação do tenant
      try {
        sessionStorage.setItem(
          'pending_meta_complete_registration',
          JSON.stringify({
            email: cleanEmail,
            timestamp: Date.now(),
          })
        );
      } catch {}

      const navParams = new URLSearchParams();
      const pCod = searchParams.get('parceiro') || localStorage.getItem('parceiro_codigo');
      const cCod = (conviteToken && !isUUID(conviteToken) ? conviteToken : null) || localStorage.getItem('convite_codigo');
      const campCod = searchParams.get('campanha') || localStorage.getItem('campanha_codigo');
      if (pCod) navParams.set('parceiro', pCod);
      if (cCod) navParams.set('convite', cCod);
      if (campCod) navParams.set('campanha', campCod);

      const qs = navParams.toString() ? `?${navParams.toString()}` : '';
      navigate(`/nova-oficina${qs}`);
    } catch (err: any) {
      setErrorMsg(translateAuthError(err));
      setLoading(false);
    }
  };

  return (
    <PublicLayout mainClassName="flex-1 px-3 sm:px-6 py-2 sm:py-8 max-w-6xl mx-auto w-full">
      <div className="max-w-md mx-auto w-full flex flex-col gap-2.5 sm:gap-6 py-1 sm:py-6">
        <div className="text-center flex flex-col items-center gap-1.5 sm:gap-2.5">
          <LogoNuvemWash size="md" className="sm:hidden mb-0.5" />
          <LogoNuvemWash size="lg" className="hidden sm:block mb-1" />
          <h1 className="font-display text-[20px] sm:text-[28px] text-vapor-100 uppercase tracking-wide leading-tight">
            Criar Sua Conta
          </h1>
          {conviteOficina ? (
            <p className="font-sans text-[13px] sm:text-[14px] text-vapor-300">
              Você foi convidado para a oficina <strong>{conviteOficina}</strong>
            </p>
          ) : (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/35 text-amber-300 text-[11.5px] sm:text-[13px] font-sans font-semibold shadow-sm">
              <Sparkles size={13} className="text-amber-400 shrink-0" />
              <span>
                {campanhaInfo
                  ? `Teste grátis por ${campanhaInfo.dias_trial} dias • Sem cartão de crédito`
                  : trialCadastroAtivo
                  ? `Teste grátis por ${trialDiasPadrao} dias • Sem cartão de crédito`
                  : 'Teste grátis por 15 dias • Sem cartão de crédito'}
              </span>
            </div>
          )}
        </div>

        <Card className="p-3.5 sm:p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-2.5 sm:gap-4 shadow-xl">
          {campanhaInfo && (
            <div className="p-2.5 sm:p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center gap-2 text-amber-400 text-xs font-sans shadow-sm">
              <Rocket size={16} className="shrink-0 text-amber-400 animate-pulse" />
              <span>
                <strong>Convite VIP:</strong> Você terá <strong>{campanhaInfo.dias_trial} dias grátis</strong> no <strong>Plano {campanhaInfo.plano_nome}</strong>!
              </span>
            </div>
          )}

          {errorMsg && (
            <div className="p-2.5 sm:p-3 bg-flare-400/10 border border-flare-400/30 rounded flex items-center gap-2 text-flare-400 text-[12.5px] sm:text-[13px]">
              <AlertTriangle size={16} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:gap-3.5">
            <div className="flex flex-col gap-0.5 sm:gap-1">
              <label className="font-sans text-[12px] sm:text-[13px] text-vapor-400 font-medium">Nome completo *</label>
              <Input
                type="text"
                placeholder="Ex: João da Silva"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                required
                className="!min-h-[42px] sm:!min-h-[48px] h-[42px] sm:h-[48px] text-[13.5px] sm:text-[14px]"
              />
            </div>

            {!isConviteEquipe && (
              <div className="flex flex-col gap-0.5 sm:gap-1">
                <label className="font-sans text-[12px] sm:text-[13px] text-vapor-400 font-medium">Nome da sua Estética / Oficina *</label>
                <Input
                  type="text"
                  placeholder="Ex: Studio Auto Detail"
                  value={nomeOficina}
                  onChange={(e) => setNomeOficina(e.target.value)}
                  required
                  disabled={loading}
                  className="!min-h-[42px] sm:!min-h-[48px] h-[42px] sm:h-[48px] text-[13.5px] sm:text-[14px]"
                />
                <span className="font-sans text-[10.5px] sm:text-[11px] text-vapor-400 leading-tight">
                  Sua oficina já entra pré-configurada com serviços e preços médios do mercado.
                </span>
              </div>
            )}

            <div className="flex flex-col gap-0.5 sm:gap-1">
              <label className="font-sans text-[12px] sm:text-[13px] text-vapor-400 font-medium">E-mail *</label>
              <Input
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={emailLocked || loading}
                className="!min-h-[42px] sm:!min-h-[48px] h-[42px] sm:h-[48px] text-[13.5px] sm:text-[14px]"
              />
              {emailLocked && conviteOficina && (
                <span className="font-sans text-[11px] sm:text-[12px] text-amber-400 mt-0.5">
                  E-mail vinculado ao convite da oficina <strong>{conviteOficina}</strong>
                </span>
              )}
            </div>

            <div className="flex flex-col gap-0.5 sm:gap-1">
              <label className="font-sans text-[12px] sm:text-[13px] text-vapor-400 font-medium">
                WhatsApp / Telefone <span className="text-amber-500 font-bold">*</span>
              </label>
              <Input
                type="tel"
                placeholder="(11) 99999-9999"
                value={telefone}
                onChange={(e) => setTelefone(formatTelefone(e.target.value))}
                required
                className="!min-h-[42px] sm:!min-h-[48px] h-[42px] sm:h-[48px] text-[13.5px] sm:text-[14px]"
              />
            </div>

            <div className="flex flex-col gap-0.5 sm:gap-1">
              <label className="font-sans text-[12px] sm:text-[13px] text-vapor-400 font-medium">Senha *</label>
              <div className="relative flex items-center">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Mínimo 6 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="!min-h-[42px] sm:!min-h-[48px] h-[42px] sm:h-[48px] text-[13.5px] sm:text-[14px] pr-12"
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

            <Button
              type="submit"
              variant="primary"
              disabled={loading}
              className="mt-1 sm:mt-2 !min-h-[44px] sm:!min-h-[48px] h-[44px] sm:h-[48px] w-full font-semibold shadow-lg shadow-amber-500/10 hover:shadow-amber-500/20 text-sm sm:text-base flex items-center justify-center gap-2"
            >
              {loading ? (
                'Criando conta...'
              ) : (
                <>
                  <UserPlus size={18} />
                  {isConviteEquipe ? 'Criar conta e Aceitar Convite' : 'Criar conta grátis e Entrar'}
                </>
              )}
            </Button>

            <p className="font-sans text-[11px] sm:text-[12px] text-vapor-400 text-center leading-snug px-1 pt-0.5">
              Ao criar sua conta, você concorda com nossos{' '}
              <a
                href="/termos-de-uso"
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-400 hover:text-amber-300 underline font-medium"
              >
                Termos de Uso
              </a>{' '}
              e{' '}
              <a
                href="/politica-de-privacidade"
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-400 hover:text-amber-300 underline font-medium"
              >
                Política de Privacidade
              </a>
              .
            </p>
          </form>

          <div className="pt-2 sm:pt-3 border-t border-graphite-600 text-center">
            <p className="font-sans text-[12px] sm:text-[13px] text-vapor-400">
              Já possui uma conta?{' '}
              <Link
                to={conviteToken ? `/entrar?convite=${conviteToken}` : '/entrar'}
                className="text-amber-500 font-semibold hover:underline"
              >
                Entrar
              </Link>
            </p>
          </div>
        </Card>
      </div>
    </PublicLayout>
  );
};
