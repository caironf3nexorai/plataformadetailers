import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Gift, CheckCircle2, ArrowRight } from 'lucide-react';
import { LogoNuvemWash } from '../../components/ui/LogoNuvemWash';

export const PaginaConvite: React.FC = () => {
  const { codigo } = useParams<{ codigo: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [indicadorNome, setIndicadorNome] = useState<string | null>(null);

  useEffect(() => {
    async function carregarIndicador() {
      if (!codigo) {
        setLoading(false);
        return;
      }
      try {
        const { data, error } = await supabase
          .from('tenants')
          .select('nome')
          .eq('codigo_indicacao', codigo.toUpperCase())
          .single();

        if (data && !error) {
          setIndicadorNome(data.nome);
        }
      } catch (err) {
        console.error('Erro ao buscar indicador:', err);
      } finally {
        setLoading(false);
      }
    }

    carregarIndicador();
  }, [codigo]);

  const handleIrParaCadastro = () => {
    navigate(`/criar-conta?cupom=${codigo || ''}`);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 md:p-8 selection:bg-amber-500 selection:text-slate-950 relative overflow-hidden font-sans">
      {/* Background Glows */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-full pointer-events-none overflow-hidden -z-10">
        <div className="absolute -top-40 left-1/4 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 right-0 w-96 h-96 bg-yellow-500/10 rounded-full blur-3xl" />
      </div>

      <header className="max-w-5xl w-full mx-auto flex items-center justify-between py-4 z-10">
        <div className="flex items-center gap-3">
          <LogoNuvemWash size="md" />
        </div>

        <button
          onClick={() => navigate('/entrar')}
          className="text-xs md:text-sm text-slate-300 hover:text-white font-medium transition"
        >
          Já tem uma conta? Entrar
        </button>
      </header>

      <main className="max-w-3xl w-full mx-auto my-auto py-12 text-center z-10">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs md:text-sm font-medium mb-6">
          <Gift className="w-4 h-4" />
          Convite Exclusivo de Indicação
        </div>

        {loading ? (
          <div className="py-12 text-slate-400 text-sm">Carregando convite...</div>
        ) : (
          <>
            <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-white mb-6 leading-tight">
              {indicadorNome ? (
                <>
                  A oficina <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-yellow-300">{indicadorNome}</span> te convidou para acelerar seu Estética Automotiva!
                </>
              ) : (
                <>
                  Você recebeu um convite especial para o <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-yellow-300">NuvemWash</span>!
                </>
              )}
            </h1>

            <p className="text-slate-300 text-base md:text-lg max-w-2xl mx-auto mb-8 leading-relaxed">
              Ao se cadastrar pelo código de convite <span className="font-mono bg-slate-800 px-2 py-1 rounded text-amber-400 font-bold">{codigo?.toUpperCase()}</span>, você ganha <strong>14 dias de degustação Pro grátis</strong> sem necessidade de cartão de crédito para transformar a gestão da sua estética automotiva!
            </p>

            {/* Benefit Box */}
            <div className="bg-slate-900/80 border border-slate-800 backdrop-blur-md rounded-2xl p-6 mb-8 text-left max-w-xl mx-auto space-y-3">
              <div className="flex items-center gap-3 text-sm text-slate-200">
                <CheckCircle2 className="w-5 h-5 text-amber-400 shrink-0" />
                <span><strong>Gestão Completa de Atendimentos & Vistorias com Foto</strong></span>
              </div>
              <div className="flex items-center gap-3 text-sm text-slate-200">
                <CheckCircle2 className="w-5 h-5 text-amber-400 shrink-0" />
                <span><strong>Agendamento Online Integrado</strong> para seus clientes</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-slate-200">
                <CheckCircle2 className="w-5 h-5 text-amber-400 shrink-0" />
                <span><strong>Sem necessidade de cartão de crédito</strong> no cadastro</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-slate-200">
                <CheckCircle2 className="w-5 h-5 text-amber-400 shrink-0" />
                <span><strong>Acesso completo ao plano Pro</strong> durante 14 dias</span>
              </div>
            </div>

            <button
              onClick={handleIrParaCadastro}
              className="w-full sm:w-auto px-8 py-4 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-950 font-bold text-lg hover:from-amber-400 hover:to-yellow-400 shadow-xl shadow-amber-500/25 transition transform hover:-translate-y-0.5 flex items-center justify-center gap-3 mx-auto"
            >
              <span>Criar Minha Oficina Grátis (14 Dias)</span>
              <ArrowRight className="w-5 h-5" />
            </button>
          </>
        )}
      </main>

      <footer className="max-w-5xl w-full mx-auto py-6 text-center text-xs text-slate-500 z-10 border-t border-slate-900">
        &copy; {new Date().getFullYear()} NuvemWash. Todos os direitos reservados.
      </footer>
    </div>
  );
};
