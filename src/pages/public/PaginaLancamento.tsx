import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { 
  Rocket, 
  CheckCircle2, 
  ArrowRight, 
  Clock, 
  Users, 
  ShieldCheck, 
  Sparkles,
  AlertCircle,
  Award
} from 'lucide-react';
import { LogoNuvemWash } from '../../components/ui/LogoNuvemWash';

interface CampanhaPublica {
  valida: boolean;
  motivo?: string;
  codigo: string;
  nome: string;
  plano: string;
  plano_nome: string;
  dias_trial: number;
  limite_usos: number | null;
  total_usos: number;
  vagas_restantes: number | null;
  valido_ate: string | null;
  titulo_destaque?: string;
  descricao?: string;
  beneficios?: string[];
}

export const PaginaLancamento: React.FC = () => {
  const { codigo } = useParams<{ codigo: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [campanha, setCampanha] = useState<CampanhaPublica | null>(null);

  useEffect(() => {
    async function carregarCampanha() {
      if (!codigo) {
        setLoading(false);
        return;
      }
      try {
        const { data, error } = await supabase.rpc('obter_campanha_lancamento_publica', {
          p_codigo: codigo.trim().toUpperCase(),
        });

        if (data && !error) {
          setCampanha(data as CampanhaPublica);
          if ((data as CampanhaPublica).valida) {
            localStorage.setItem('campanha_codigo', (data as CampanhaPublica).codigo);
          }
        } else {
          setCampanha({
            valida: false,
            motivo: 'Não foi possível carregar os dados desta campanha.',
            codigo: codigo.toUpperCase(),
            nome: '',
            plano: 'pro',
            plano_nome: 'Pro',
            dias_trial: 14,
            limite_usos: null,
            total_usos: 0,
            vagas_restantes: null,
            valido_ate: null,
          });
        }
      } catch (err) {
        console.error('Erro ao buscar campanha de lançamento:', err);
      } finally {
        setLoading(false);
      }
    }

    carregarCampanha();
  }, [codigo]);

  const handleIrParaCadastro = () => {
    if (campanha?.codigo) {
      localStorage.setItem('campanha_codigo', campanha.codigo);
      navigate(`/criar-conta?campanha=${encodeURIComponent(campanha.codigo)}`);
    } else {
      navigate('/criar-conta');
    }
  };

  const beneficiosPadrao = [
    'Acesso completo e irrestrito a todas as ferramentas do plano',
    'Vistorias com foto, assinatura digital na tela e geração de PDF',
    'Agendamento online com link personalizado para seus clientes',
    'DRE Financeiro completo, cálculo de margem e comissões da equipe',
    'Sem necessidade de cadastrar cartão de crédito para testar',
  ];

  const listaBeneficios = (campanha?.beneficios && campanha.beneficios.length > 0)
    ? campanha.beneficios
    : beneficiosPadrao;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 md:p-8 selection:bg-amber-500 selection:text-slate-950 relative overflow-hidden font-sans">
      {/* Background Glows */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-full pointer-events-none overflow-hidden -z-10">
        <div className="absolute -top-40 left-1/4 w-[32rem] h-[32rem] bg-gradient-to-br from-amber-500/15 to-yellow-600/5 rounded-full blur-3xl animate-pulse" />
        <div className="absolute top-1/2 right-0 w-96 h-96 bg-amber-600/10 rounded-full blur-3xl" />
      </div>

      {/* Top Header */}
      <header className="max-w-5xl w-full mx-auto flex items-center justify-between py-4 z-10">
        <div className="flex items-center gap-3">
          <LogoNuvemWash size="md" />
        </div>

        <button
          onClick={() => navigate('/entrar')}
          className="text-xs md:text-sm text-slate-300 hover:text-white font-medium transition"
        >
          Já tem uma conta? <span className="text-amber-400 font-bold">Entrar</span>
        </button>
      </header>

      {/* Main Container */}
      <main className="max-w-3xl w-full mx-auto my-auto py-8 text-center z-10">
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-400">
            <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm font-mono">Preparando seu acesso exclusivo de lançamento...</span>
          </div>
        ) : !campanha?.valida ? (
          /* Campanha Inválida / Expirada */
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-8 max-w-xl mx-auto backdrop-blur-md shadow-2xl">
            <div className="w-14 h-14 bg-rose-500/10 text-rose-400 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-rose-500/20">
              <AlertCircle className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Convite Indisponível</h1>
            <p className="text-slate-300 text-sm mb-6 leading-relaxed">
              {campanha?.motivo || 'Este link de campanha não está mais ativo ou as vagas foram preenchidas.'}
            </p>
            <button
              onClick={() => navigate('/criar-conta')}
              className="w-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold py-3.5 px-6 rounded-xl text-sm transition-all shadow-lg flex items-center justify-center gap-2"
            >
              <span>Testar NuvemWash com 14 Dias Grátis</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          /* Campanha Válida e Ativa */
          <>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs md:text-sm font-semibold mb-6 shadow-sm">
              <Rocket className="w-4 h-4 text-amber-400 animate-bounce" />
              <span>Campanha Oficial de Lançamento</span>
            </div>

            <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-white mb-4 leading-tight">
              {campanha.titulo_destaque || (
                <>
                  Você ganhou <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500">{campanha.dias_trial} dias grátis</span> no Plano {campanha.plano_nome}!
                </>
              )}
            </h1>

            <p className="text-slate-300 text-sm sm:text-base md:text-lg max-w-2xl mx-auto mb-8 leading-relaxed">
              {campanha.descricao || (
                <>
                  Aproveite esta condição exclusiva de lançamento da plataforma. Tenha acesso irrestrito a todas as funcionalidades do <strong>Plano {campanha.plano_nome}</strong> por <strong>{campanha.dias_trial} dias completos</strong> sem pagar nada!
                </>
              )}
            </p>

            {/* Badges de Destaque / Vagas */}
            <div className="flex items-center justify-center flex-wrap gap-3 mb-8">
              <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300 font-mono">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>{campanha.dias_trial} dias de degustação livre</span>
              </div>

              {campanha.vagas_restantes !== null && (
                <div className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl border text-xs font-mono font-bold ${
                  campanha.vagas_restantes <= 10
                    ? 'bg-rose-500/15 border-rose-500/40 text-rose-300 animate-pulse'
                    : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                }`}>
                  <Users className="w-3.5 h-3.5" />
                  <span>Restam apenas {campanha.vagas_restantes} vagas</span>
                </div>
              )}

              <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-amber-400 font-mono">
                <Award className="w-3.5 h-3.5" />
                <span>Plano {campanha.plano_nome.toUpperCase()}</span>
              </div>
            </div>

            {/* Card de Benefícios e CTA */}
            <div className="bg-slate-900/90 border border-slate-800/90 backdrop-blur-md rounded-3xl p-6 md:p-8 max-w-xl mx-auto shadow-2xl text-left relative overflow-hidden">
              <div className="absolute top-0 right-0 transform translate-x-4 -translate-y-4 w-32 h-32 bg-amber-500/5 rounded-full blur-2xl pointer-events-none" />

              <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                O que está liberado para sua oficina:
              </h3>

              <div className="space-y-3 mb-8">
                {listaBeneficios.map((beneficio, idx) => (
                  <div key={idx} className="flex items-start gap-3 text-xs sm:text-sm text-slate-200">
                    <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400 shrink-0 mt-0.5" />
                    <span className="leading-snug">{beneficio}</span>
                  </div>
                ))}
              </div>

              <div className="pt-2 border-t border-slate-800 flex flex-col gap-3">
                <button
                  type="button"
                  onClick={handleIrParaCadastro}
                  className="w-full bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-extrabold py-4 px-6 rounded-2xl text-base transition-all shadow-xl shadow-amber-500/20 hover:scale-[1.02] flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>Garantir Minha Vaga ({campanha.dias_trial} Dias Grátis)</span>
                  <ArrowRight className="w-5 h-5" />
                </button>

                <div className="flex items-center justify-center gap-2 text-[11px] text-slate-400 font-medium">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Sem compromisso • Não pede cartão no cadastro • Cancele quando quiser</span>
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-5xl w-full mx-auto text-center py-4 text-xs text-slate-500 z-10">
        NuvemWash • Plataforma de Gestão e Vistorias para Estética Automotiva
      </footer>
    </div>
  );
};
