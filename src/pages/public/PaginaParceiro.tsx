import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Award, CheckCircle2, ArrowRight } from 'lucide-react';
import { LogoNuvemWash } from '../../components/ui/LogoNuvemWash';

export const PaginaParceiro: React.FC = () => {
  const { codigo } = useParams<{ codigo: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [parceiroNome, setParceiroNome] = useState<string | null>(null);

  useEffect(() => {
    async function carregarParceiro() {
      if (!codigo) {
        setLoading(false);
        return;
      }
      try {
        const { data, error } = await supabase
          .from('afiliados')
          .select('nome')
          .eq('codigo', codigo.toUpperCase())
          .single();

        if (data && !error) {
          setParceiroNome(data.nome);
        }
      } catch (err) {
        console.error('Erro ao buscar parceiro:', err);
      } finally {
        setLoading(false);
      }
    }

    carregarParceiro();
  }, [codigo]);

  const handleIrParaCadastro = () => {
    navigate(`/criar-conta?cupom=${codigo || ''}`);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 md:p-8 selection:bg-indigo-500 selection:text-white relative overflow-hidden font-sans">
      {/* Background Glows */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-full pointer-events-none overflow-hidden -z-10">
        <div className="absolute -top-40 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl" />
      </div>

      <header className="max-w-5xl w-full mx-auto flex items-center justify-between py-4 z-10">
        <div className="flex items-center gap-3">
          <LogoNuvemWash size="md" />
        </div>

        <button
          onClick={() => navigate('/login')}
          className="text-xs md:text-sm text-slate-300 hover:text-white font-medium transition"
        >
          Já tem uma conta? Entrar
        </button>
      </header>

      <main className="max-w-3xl w-full mx-auto my-auto py-12 text-center z-10">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs md:text-sm font-medium mb-6">
          <Award className="w-4 h-4" />
          Link de Parceiro Oficial
        </div>

        {loading ? (
          <div className="py-12 text-slate-400 text-sm">Carregando convite de parceiro...</div>
        ) : (
          <>
            <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-white mb-6 leading-tight">
              {parceiroNome ? (
                <>
                  Seja bem-vindo através do nosso parceiro oficial <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-300">{parceiroNome}</span>!
                </>
              ) : (
                <>
                  Você recebeu um link exclusivo de <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-300">Parceiro Oficial</span>!
                </>
              )}
            </h1>

            <p className="text-slate-300 text-base md:text-lg max-w-2xl mx-auto mb-8 leading-relaxed">
              Inicie agora mesmo sua degustação de 14 dias no plano Pro do NuvemWash com o respaldo de um parceiro oficial da nossa rede de estética automotiva.
            </p>

            <div className="bg-slate-900/80 border border-slate-800 backdrop-blur-md rounded-2xl p-6 mb-8 text-left max-w-xl mx-auto space-y-3">
              <div className="flex items-center gap-3 text-sm text-slate-200">
                <CheckCircle2 className="w-5 h-5 text-blue-400 shrink-0" />
                <span><strong>Suporte e Acompanhamento Especializado</strong></span>
              </div>
              <div className="flex items-center gap-3 text-sm text-slate-200">
                <CheckCircle2 className="w-5 h-5 text-blue-400 shrink-0" />
                <span><strong>Acesso total por 14 Dias</strong> a todos os recursos Pro</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-slate-200">
                <CheckCircle2 className="w-5 h-5 text-blue-400 shrink-0" />
                <span><strong>Vínculo direto</strong> com o parceiro credenciado ({codigo?.toUpperCase()})</span>
              </div>
            </div>

            <button
              onClick={handleIrParaCadastro}
              className="w-full sm:w-auto px-8 py-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold text-lg hover:from-blue-500 hover:to-indigo-500 shadow-xl shadow-indigo-500/25 transition transform hover:-translate-y-0.5 flex items-center justify-center gap-3 mx-auto"
            >
              <span>Criar Minha Conta com Parceiro</span>
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
