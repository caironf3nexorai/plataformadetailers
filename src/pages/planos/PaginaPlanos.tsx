import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Check, X, Sparkles, ShieldCheck, Zap, CreditCard } from 'lucide-react';
import { usePermissao } from '../../hooks/usePermissao';
import { useAuth } from '../../contexts/AuthContext';
import { CheckoutModal } from '../../components/assinatura/CheckoutModal';
import { supabase } from '../../lib/supabase';

export const PaginaPlanos: React.FC = () => {
  const { isOperador } = usePermissao();
  const { tenant, refetchTenantData } = useAuth();

  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const [precosCentavos, setPrecosCentavos] = useState<Record<string, number>>({
    free: 0,
    pro: 100, // R$ 1,00 conforme configurado no Admin
    studio: 14700,
  });

  const formatarPrecoCard = (centavos: number) => {
    const reais = centavos / 100;
    if (reais === 0) return 'R$ 0';
    if (reais % 1 === 0) return `R$ ${reais}`;
    return reais.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  const formatarPrecoMensal = (centavos: number) => {
    const reais = centavos / 100;
    return reais.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  useEffect(() => {
    async function carregarPrecos() {
      try {
        console.log('[PaginaPlanos] Buscando preços dos planos...');
        
        // 1. Tenta carregar pela RPC obter_planos_publicos
        const { data: rpcData, error: rpcErr } = await supabase.rpc('obter_planos_publicos');
        let planosList: any[] = [];
        if (Array.isArray(rpcData)) {
          planosList = rpcData;
        } else if (typeof rpcData === 'string') {
          try {
            planosList = JSON.parse(rpcData);
          } catch {}
        }

        if (!rpcErr && planosList.length > 0) {
          const mapa: Record<string, number> = {};
          planosList.forEach((p: any) => {
            if (p.codigo && typeof p.preco_centavos === 'number') {
              mapa[String(p.codigo).toLowerCase()] = p.preco_centavos;
            }
          });
          console.log('[PaginaPlanos] Preços carregados via RPC:', mapa);
          setPrecosCentavos((prev) => ({ ...prev, ...mapa }));
          return;
        }

        // 2. Fallback: select direto na tabela plans
        const { data: plansData, error: plansErr } = await supabase
          .from('plans')
          .select('codigo, preco_centavos, ativo');

        if (!plansErr && plansData && plansData.length > 0) {
          const mapa: Record<string, number> = {};
          plansData.forEach((p) => {
            if (p.codigo && typeof p.preco_centavos === 'number') {
              mapa[p.codigo.toLowerCase()] = p.preco_centavos;
            }
          });
          console.log('[PaginaPlanos] Preços carregados via plans table:', mapa);
          setPrecosCentavos((prev) => ({ ...prev, ...mapa }));
        }
      } catch (err) {
        console.warn('[PaginaPlanos] Erro ao carregar preços dinâmicos:', err);
      }
    }

    carregarPrecos();
  }, []);

  const [selectedPlano, setSelectedPlano] = useState<{
    codigo: 'pro' | 'studio';
    nome: string;
    preco: string;
  }>({
    codigo: 'pro',
    nome: 'Pro',
    preco: formatarPrecoMensal(precosCentavos['pro'] ?? 100),
  });

  // Restrição estrita: Operadores não têm acesso à página de planos
  if (isOperador) {
    return <Navigate to="/" replace />;
  }

  const planoAtual = tenant?.plano || 'free';

  const planos = [
    {
      id: 'free',
      codigo: 'free',
      nome: 'Free',
      descricao: 'Para quem está começando e quer substituir o caderno com segurança.',
      preco: formatarPrecoCard(precosCentavos['free'] ?? 0),
      precoMensal: formatarPrecoMensal(precosCentavos['free'] ?? 0),
      periodo: '/mês',
      destaque: false,
      limites: [
        '30 atendimentos por mês',
        '1 usuário da equipe',
        '100 clientes cadastrados',
        '30 dias de retenção de fotos',
      ],
      features: [
        { nome: 'Agenda e clientes', incluso: true },
        { nome: 'Vistoria com assinatura e PDF', incluso: true },
        { nome: 'Calculadora de diluição', incluso: true },
        { nome: 'Agendamento online', incluso: false },
        { nome: 'Orçamento em três níveis', incluso: false },
        { nome: 'Sinal por Pix', incluso: false },
        { nome: 'Financeiro completo e margem', incluso: false },
        { nome: 'Estoque', incluso: false },
        { nome: 'Comissões', incluso: false },
        { nome: 'Taxas por bandeira/maquininhas', incluso: false },
        { nome: 'Múltiplos executores por OS', incluso: false },
      ],
    },
    {
      id: 'pro',
      codigo: 'pro',
      nome: 'Pro',
      descricao: 'Ideal para oficinas em crescimento que buscam mais clientes e lucro real.',
      preco: formatarPrecoCard(precosCentavos['pro'] ?? 100),
      precoMensal: formatarPrecoMensal(precosCentavos['pro'] ?? 100),
      periodo: '/mês',
      destaque: true,
      limites: [
        '300 atendimentos por mês',
        '5 usuários da equipe',
        'Clientes ilimitados',
        '90 dias de retenção de fotos',
      ],
      features: [
        { nome: 'Agenda e clientes', incluso: true },
        { nome: 'Vistoria com assinatura e PDF', incluso: true },
        { nome: 'Calculadora de diluição', incluso: true },
        { nome: 'Agendamento online', incluso: true },
        { nome: 'Orçamento em três níveis', incluso: true },
        { nome: 'Sinal por Pix', incluso: true },
        { nome: 'Financeiro completo e margem', incluso: true },
        { nome: 'Estoque', incluso: true },
        { nome: 'Comissões', incluso: true },
        { nome: 'Taxas por bandeira/maquininhas', incluso: true },
        { nome: 'Múltiplos executores por OS', incluso: false },
      ],
    },
    {
      id: 'studio',
      codigo: 'studio',
      nome: 'Studio',
      descricao: 'Para operações consolidadas e equipes de alta performance.',
      preco: formatarPrecoCard(precosCentavos['studio'] ?? 14700),
      precoMensal: formatarPrecoMensal(precosCentavos['studio'] ?? 14700),
      periodo: '/mês',
      destaque: false,
      limites: [
        'Atendimentos ilimitados',
        'Usuários da equipe ilimitados',
        'Clientes ilimitados',
        '365 dias de retenção de fotos',
      ],
      features: [
        { nome: 'Agenda e clientes', incluso: true },
        { nome: 'Vistoria com assinatura e PDF', incluso: true },
        { nome: 'Calculadora de diluição', incluso: true },
        { nome: 'Agendamento online', incluso: true },
        { nome: 'Orçamento em três níveis', incluso: true },
        { nome: 'Sinal por Pix', incluso: true },
        { nome: 'Financeiro completo e margem', incluso: true },
        { nome: 'Estoque', incluso: true },
        { nome: 'Comissões', incluso: true },
        { nome: 'Taxas por bandeira/maquininhas', incluso: true },
        { nome: 'Múltiplos executores por OS', incluso: true },
      ],
    },
  ];

  const handleAbrirCheckout = (p: typeof planos[0]) => {
    if (p.codigo === 'free') return;
    setSelectedPlano({
      codigo: p.codigo as 'pro' | 'studio',
      nome: p.nome,
      preco: p.precoMensal,
    });
    setCheckoutModalOpen(true);
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Topo / Header */}
      <div className="text-center max-w-3xl mx-auto space-y-3">
        <div className="inline-flex items-center gap-2 bg-amber-500/10 text-amber-400 border border-amber-500/20 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider">
          <Zap className="w-3.5 h-3.5" />
          Planos e Cobrança Recorrente Asaas
        </div>
        <h1 className="text-2xl sm:text-4xl font-extrabold font-display tracking-tight text-vapor-100 uppercase">
          Escolha o Plano Ideal para a Sua Oficina
        </h1>
        <p className="text-sm sm:text-base text-vapor-400">
          Aumente a margem de lucro, encante clientes com vistorias profissionais e escale a operação da sua estética automotiva.
        </p>
      </div>

      {/* Cards Comparativos */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch pt-4">
        {planos.map((p) => {
          const isCurrent = planoAtual === p.id;

          return (
            <div
              key={p.id}
              className={`relative rounded-xl p-6 flex flex-col justify-between transition-all border ${
                p.destaque
                  ? 'bg-graphite-800/90 border-amber-500 shadow-lg shadow-amber-500/10'
                  : 'bg-graphite-800/40 border-graphite-600 hover:border-graphite-500'
              }`}
            >
              {p.destaque && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-amber-500 text-graphite-950 px-3 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider flex items-center gap-1 shadow">
                  <Sparkles className="w-3 h-3" /> Mais Recomendado
                </div>
              )}

              {isCurrent && (
                <div className="absolute top-4 right-4 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
                  Seu Plano Atual
                </div>
              )}

              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-bold text-vapor-100 font-display">{p.nome}</h3>
                  <p className="text-xs text-vapor-400 mt-1 min-h-[36px]">{p.descricao}</p>
                </div>

                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-extrabold text-vapor-100 font-mono">{p.preco}</span>
                  <span className="text-xs text-vapor-400">{p.periodo}</span>
                </div>

                {/* Limites principais */}
                <div className="border-t border-b border-graphite-600/60 py-3 space-y-2 text-xs">
                  <span className="font-semibold text-vapor-300 block uppercase tracking-wider text-[10px]">
                    Capacidade & Limites
                  </span>
                  {p.limites.map((lim, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-vapor-200">
                      <ShieldCheck className="w-4 h-4 text-amber-500 shrink-0" />
                      <span>{lim}</span>
                    </div>
                  ))}
                </div>

                {/* Lista de Features */}
                <div className="space-y-2.5 text-xs">
                  <span className="font-semibold text-vapor-300 block uppercase tracking-wider text-[10px]">
                    Funcionalidades Incluídas
                  </span>
                  {p.features.map((feat, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      {feat.incluso ? (
                        <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : (
                        <X className="w-4 h-4 text-vapor-600 shrink-0" />
                      )}
                      <span className={feat.incluso ? 'text-vapor-200 font-medium' : 'text-vapor-500 line-through'}>
                        {feat.nome}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Botão de Ação */}
              <div className="mt-8 pt-4">
                {isCurrent ? (
                  <button
                    disabled
                    className="w-full py-2.5 rounded-lg bg-graphite-700 text-vapor-400 font-semibold text-sm cursor-default border border-graphite-600"
                  >
                    Plano Ativo
                  </button>
                ) : p.codigo === 'free' ? (
                  <button
                    disabled
                    className="w-full py-2.5 rounded-lg bg-graphite-800 text-vapor-500 font-semibold text-sm cursor-default border border-graphite-700"
                  >
                    Plano Básico Gratuito
                  </button>
                ) : (
                  <button
                    onClick={() => handleAbrirCheckout(p)}
                    className={`w-full py-2.5 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transition-all ${
                      p.destaque
                        ? 'bg-amber-500 text-graphite-950 hover:bg-amber-400 shadow-md shadow-amber-500/20 font-bold'
                        : 'bg-graphite-700 text-vapor-100 hover:bg-graphite-600 border border-graphite-500'
                    }`}
                  >
                    <CreditCard className="w-4 h-4" />
                    Assinar {p.nome} ({p.precoMensal}/mês)
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal de Checkout */}
      <CheckoutModal
        isOpen={checkoutModalOpen}
        onClose={() => setCheckoutModalOpen(false)}
        planoCodigo={selectedPlano.codigo}
        planoNome={selectedPlano.nome}
        precoMensal={selectedPlano.preco}
        onSuccess={async () => {
          setCheckoutModalOpen(false);
          await refetchTenantData();
        }}
      />
    </div>
  );
};
