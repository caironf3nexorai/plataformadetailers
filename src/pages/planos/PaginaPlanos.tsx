import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Check, X, Sparkles, ShieldCheck, Zap, CreditCard, Clock } from 'lucide-react';
import { usePermissao } from '../../hooks/usePermissao';
import { useAuth } from '../../contexts/AuthContext';
import { usePlano } from '../../hooks/usePlano';
import { CheckoutModal } from '../../components/assinatura/CheckoutModal';
import { supabase } from '../../lib/supabase';

export const PaginaPlanos: React.FC = () => {
  const { isOperador } = usePermissao();
  const { tenant, refetchTenantData } = useAuth();
  const { planoAtual: planoHook, statusAssinatura, isTrial } = usePlano();

  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const [ciclo, setCiclo] = useState<'mensal' | 'anual'>('anual');
  const [precosCentavos, setPrecosCentavos] = useState<Record<string, number>>({
    free: 0,
    pro: 6700,
    studio: 14700,
  });
  const [precosAnuaisCentavos, setPrecosAnuaisCentavos] = useState<Record<string, number>>({
    free: 0,
    pro: 68400,
    studio: 149900,
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
          const mapaM: Record<string, number> = {};
          const mapaA: Record<string, number> = {};
          planosList.forEach((p: any) => {
            const cod = String(p.codigo).toLowerCase();
            if (typeof p.preco_centavos === 'number') {
              mapaM[cod] = p.preco_centavos;
            }
            if (typeof p.preco_anual_centavos === 'number' && p.preco_anual_centavos > 0) {
              mapaA[cod] = p.preco_anual_centavos;
            } else if (typeof p.preco_centavos === 'number') {
              mapaA[cod] = p.preco_centavos * 10;
            }
          });
          console.log('[PaginaPlanos] Preços carregados via RPC:', { mapaM, mapaA });
          setPrecosCentavos((prev) => ({ ...prev, ...mapaM }));
          setPrecosAnuaisCentavos((prev) => ({ ...prev, ...mapaA }));
          return;
        }

        // 2. Fallback: select direto na tabela plans
        const { data: plansData, error: plansErr } = await supabase
          .from('plans')
          .select('codigo, preco_centavos, preco_anual_centavos, ativo');

        if (!plansErr && plansData && plansData.length > 0) {
          const mapaM: Record<string, number> = {};
          const mapaA: Record<string, number> = {};
          plansData.forEach((p: any) => {
            const cod = p.codigo.toLowerCase();
            if (typeof p.preco_centavos === 'number') {
              mapaM[cod] = p.preco_centavos;
            }
            if (typeof p.preco_anual_centavos === 'number' && p.preco_anual_centavos > 0) {
              mapaA[cod] = p.preco_anual_centavos;
            } else if (typeof p.preco_centavos === 'number') {
              mapaA[cod] = p.preco_centavos * 10;
            }
          });
          console.log('[PaginaPlanos] Preços carregados via plans table:', { mapaM, mapaA });
          setPrecosCentavos((prev) => ({ ...prev, ...mapaM }));
          setPrecosAnuaisCentavos((prev) => ({ ...prev, ...mapaA }));
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
    precoAnual?: string;
    ciclo: 'mensal' | 'anual';
  }>({
    codigo: 'pro',
    nome: 'Pro',
    preco: formatarPrecoMensal(precosCentavos['pro'] ?? 6700),
    precoAnual: `${formatarPrecoMensal(precosAnuaisCentavos['pro'] ?? 68400)} / ano`,
    ciclo: 'anual',
  });

  // Restrição estrita: Operadores não têm acesso à página de planos
  if (isOperador) {
    return <Navigate to="/" replace />;
  }

  const planoAtual = tenant?.plano || planoHook || 'free';
  const emTrial = isTrial || statusAssinatura === 'trial' || tenant?.status === 'trial' || (planoAtual === 'pro' && statusAssinatura !== 'ativa');

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
        'Até 15 atendimentos por mês',
        'Até 20 clientes na carteira',
        'Até 10 serviços no catálogo',
        '1 usuário da equipe (proprietário)',
        '7 dias de retenção de fotos',
        'Sem emissão de NFS-e fiscal',
      ],
      features: [
        { nome: 'Agenda e clientes', incluso: true },
        { nome: 'Vistoria com assinatura e PDF', incluso: true },
        { nome: 'Agendamento online (link público)', incluso: true },
        { nome: 'Orçamento em três níveis', incluso: false },
        { nome: 'Cobrança de sinal Pix no agendamento', incluso: false },
        { nome: 'Financeiro completo e DRE', incluso: false },
        { nome: 'Radar de Fiados e Cobrança', incluso: false },
        { nome: 'Estoque de produtos', incluso: false },
        { nome: 'Emissão de NFS-e', incluso: false },
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
        'Até 150 atendimentos por mês',
        '3 usuários da equipe',
        'Até 350 clientes cadastrados',
        '60 dias de retenção de fotos',
        '15 notas fiscais / mês (NFS-e)',
        '15 fotos preservadas no portfólio',
      ],
      features: [
        { nome: 'Agenda e clientes', incluso: true },
        { nome: 'Vistoria com assinatura e PDF', incluso: true },
        { nome: 'Calculadora de diluição', incluso: true },
        { nome: 'Agendamento online e Sinal Pix', incluso: true },
        { nome: 'Orçamento em três níveis', incluso: true },
        { nome: 'Financeiro completo e DRE', incluso: true },
        { nome: 'Radar de Fiados e Cobrança no WhatsApp', incluso: true },
        { nome: 'Estoque (até 50 produtos)', incluso: true },
        { nome: 'Comissões da equipe', incluso: true },
        { nome: 'Taxas por bandeira/maquininhas', incluso: true },
        { nome: 'Emissão de NFS-e (15 notas/mês)', incluso: true },
        { nome: 'Múltiplos executores por OS', incluso: false },
      ],
    },
    {
      id: 'studio',
      codigo: 'studio',
      nome: 'Studio',
      descricao: 'Para operações consolidadas, equipes robustas e múltiplos boxes.',
      preco: formatarPrecoCard(precosCentavos['studio'] ?? 14700),
      precoMensal: formatarPrecoMensal(precosCentavos['studio'] ?? 14700),
      periodo: '/mês',
      destaque: false,
      limites: [
        'Até 500 atendimentos por mês',
        '10 usuários da equipe',
        'Clientes ilimitados',
        '180 dias de retenção de fotos',
        '60 notas fiscais / mês (NFS-e)',
        '100 fotos preservadas no portfólio',
      ],
      features: [
        { nome: 'Tudo incluso do Plano Pro', incluso: true },
        { nome: 'Múltiplos executores na mesma OS', incluso: true },
        { nome: 'Emissão de NFS-e expandida (60 notas/mês)', incluso: true },
        { nome: 'Estoque de produtos ilimitado', incluso: true },
        { nome: 'Comissões escalonadas por metas', incluso: true },
        { nome: 'Automação de WhatsApp (Robô Lembretes)', incluso: true },
        { nome: 'Suporte prioritário VIP', incluso: true },
      ],
    },
  ];

  const handleAbrirCheckout = (p: typeof planos[0]) => {
    if (p.codigo === 'free') return;
    const anualCentavos = precosAnuaisCentavos[p.codigo] ?? (precosCentavos[p.codigo] * 10);
    const precoAnualFormatado = `${formatarPrecoMensal(anualCentavos)} / ano`;

    setSelectedPlano({
      codigo: p.codigo as 'pro' | 'studio',
      nome: p.nome,
      preco: p.precoMensal,
      precoAnual: precoAnualFormatado,
      ciclo: ciclo,
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

      {/* Banner de Degustação / Trial Ativo */}
      {emTrial && (
        <div className="max-w-4xl mx-auto p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-graphite-900 border border-amber-500/40 shadow-lg flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 text-left">
            <div className="w-12 h-12 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
              <Clock className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-vapor-100 uppercase tracking-wide">
                  Período de Degustação Gratuito (Trial) Ativo
                </span>
                <span className="bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                  14 Dias Grátis
                </span>
              </div>
              <p className="text-xs text-vapor-300 mt-1 leading-relaxed">
                Você <strong>não precisa esperar os 14 dias terminarem</strong> para assinar! Você pode efetivar sua assinatura definitiva agora mesmo via PIX ou Cartão (com desconto anual de até 15%) para garantir sua conta sem interrupções e validar todas as comissões e integrações em tempo real.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              const proPlano = planos.find((x) => x.id === 'pro') || planos[1];
              handleAbrirCheckout(proPlano);
            }}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-gradient-to-r from-amber-500 to-yellow-500 text-graphite-950 hover:bg-amber-400 shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 shrink-0 transition-all cursor-pointer"
          >
            <CreditCard className="w-4 h-4" />
            Ativar Plano Pro Agora
          </button>
        </div>
      )}

      {/* Seletor de Ciclo (Mensal vs Anual com Desconto) */}
      <div className="flex flex-col items-center justify-center gap-2 pt-2">
        <div className="inline-flex p-1.5 rounded-2xl bg-graphite-900 border border-graphite-700 shadow-inner">
          <button
            type="button"
            onClick={() => setCiclo('mensal')}
            className={`px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
              ciclo === 'mensal'
                ? 'bg-graphite-700 text-vapor-100 shadow'
                : 'text-vapor-400 hover:text-vapor-200'
            }`}
          >
            Cobrança Mensal
          </button>
          <button
            type="button"
            onClick={() => setCiclo('anual')}
            className={`px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer ${
              ciclo === 'anual'
                ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-graphite-950 shadow-md shadow-amber-500/20 font-extrabold'
                : 'text-amber-400 hover:text-amber-300'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Anual (Até 12x no Cartão ou PIX)</span>
            <span className="bg-graphite-950/20 px-2 py-0.5 rounded-full text-[10px] tracking-normal font-black uppercase">
              Economize até 15%
            </span>
          </button>
        </div>
        <p className="text-xs text-vapor-400 text-center">
          {ciclo === 'anual'
            ? '✨ Economize o equivalente a quase 2 meses no plano anual. Pague em até 12x no cartão de crédito ou à vista via PIX.'
            : 'Cobrança mensal renovada a cada 30 dias sem fidelidade.'}
        </p>
      </div>

      {/* Cards Comparativos */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch pt-2">
        {planos.map((p) => {
          const isCurrent = planoAtual === p.id;
          const isCurrentPaid = isCurrent && !emTrial && statusAssinatura === 'ativa';
          const isCurrentTrial = isCurrent && emTrial;

          return (
            <div
              key={p.id}
              className={`relative rounded-xl p-6 flex flex-col justify-between transition-all border ${
                p.destaque
                  ? 'bg-graphite-800/90 border-amber-500 shadow-lg shadow-amber-500/10'
                  : 'bg-graphite-800/40 border-graphite-600 hover:border-graphite-500'
              }`}
            >
              {p.destaque && !isCurrentTrial && !isCurrentPaid && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-amber-500 text-graphite-950 px-3 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider flex items-center gap-1 shadow">
                  <Sparkles className="w-3 h-3" /> Mais Recomendado
                </div>
              )}

              {isCurrentPaid && (
                <div className="absolute top-4 right-4 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" /> Seu Plano Ativo
                </div>
              )}

              {isCurrentTrial && (
                <div className="absolute top-4 right-4 bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Degustação (Trial)
                </div>
              )}

              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-bold text-vapor-100 font-display">{p.nome}</h3>
                  <p className="text-xs text-vapor-400 mt-1 min-h-[36px]">{p.descricao}</p>
                </div>

                {/* Exibição de Preço Dinâmico (Mensal ou Anual) */}
                <div className="space-y-1">
                  {p.codigo === 'free' ? (
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-extrabold text-vapor-100 font-mono">R$ 0</span>
                      <span className="text-xs text-vapor-400">/mês</span>
                    </div>
                  ) : ciclo === 'anual' ? (
                    <div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-3xl font-extrabold text-amber-400 font-mono">
                          {formatarPrecoMensal(Math.round((precosAnuaisCentavos[p.codigo] || (precosCentavos[p.codigo] * 10)) / 12))}
                        </span>
                        <span className="text-xs text-vapor-400 font-medium">/mês</span>
                      </div>
                      <div className="mt-1 flex flex-col gap-0.5">
                        <span className="text-xs text-vapor-300 font-mono">
                          Total de {formatarPrecoMensal(precosAnuaisCentavos[p.codigo] || (precosCentavos[p.codigo] * 10))} / ano (até 12x)
                        </span>
                        <span className="text-[11px] text-emerald-400 font-semibold">
                          Economize {formatarPrecoCard((precosCentavos[p.codigo] * 12) - (precosAnuaisCentavos[p.codigo] || (precosCentavos[p.codigo] * 10)))} ao ano
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-extrabold text-vapor-100 font-mono">{p.preco}</span>
                        <span className="text-xs text-vapor-400">{p.periodo}</span>
                      </div>
                      <span className="text-[11px] text-vapor-400 block mt-1">Cobrado mês a mês sem fidelidade</span>
                    </div>
                  )}
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
                {isCurrentPaid ? (
                  <button
                    disabled
                    className="w-full py-2.5 rounded-lg bg-graphite-700 text-vapor-400 font-semibold text-sm cursor-default border border-graphite-600"
                  >
                    Plano Ativo
                  </button>
                ) : isCurrentTrial ? (
                  <button
                    type="button"
                    onClick={() => handleAbrirCheckout(p)}
                    className="w-full py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-yellow-500 text-graphite-950 hover:bg-amber-400 shadow-md shadow-amber-500/20 transition-all cursor-pointer"
                  >
                    <CreditCard className="w-4 h-4" />
                    Ativar {p.nome} {ciclo === 'anual' ? '(Plano Anual)' : `(${p.precoMensal}/mês)`}
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
                    type="button"
                    onClick={() => handleAbrirCheckout(p)}
                    className={`w-full py-2.5 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer ${
                      p.destaque
                        ? 'bg-amber-500 text-graphite-950 hover:bg-amber-400 shadow-md shadow-amber-500/20 font-bold'
                        : 'bg-graphite-700 text-vapor-100 hover:bg-graphite-600 border border-graphite-500'
                    }`}
                  >
                    <CreditCard className="w-4 h-4" />
                    Assinar {p.nome} {ciclo === 'anual' ? '(Anual)' : `(${p.precoMensal}/mês)`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <CheckoutModal
        isOpen={checkoutModalOpen}
        onClose={() => setCheckoutModalOpen(false)}
        planoCodigo={selectedPlano.codigo}
        planoNome={selectedPlano.nome}
        precoMensal={selectedPlano.preco}
        precoAnual={selectedPlano.precoAnual}
        cicloInicial={selectedPlano.ciclo}
        onSuccess={async () => {
          setCheckoutModalOpen(false);
          await refetchTenantData();
        }}
      />
    </div>
  );
};

