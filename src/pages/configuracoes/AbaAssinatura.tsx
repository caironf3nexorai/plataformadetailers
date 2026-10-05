import React, { useEffect, useState } from 'react';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ShieldCheck, Calendar, CreditCard, AlertTriangle, ExternalLink, RefreshCw, XCircle, CheckCircle2, Sparkles } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { CheckoutModal } from '../../components/assinatura/CheckoutModal';
import { ModalConfirmacao } from '../../components/ui/ModalConfirmacao';
import { useNavigate } from 'react-router-dom';

export const AbaAssinatura: React.FC = () => {
  const { showSuccess, showError } = useToast();
  const { tenant, refetchTenantData } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [cancelando, setCancelando] = useState(false);
  const [showConfirmCancelar, setShowConfirmCancelar] = useState(false);
  const [assinatura, setAssinatura] = useState<any>(null);
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const [precosCentavos, setPrecosCentavos] = useState<Record<string, number>>({
    free: 0,
  });
  const [precosAnuaisCentavos, setPrecosAnuaisCentavos] = useState<Record<string, number>>({
    free: 0,
  });

  const formatarPrecoMensal = (centavos?: number) => {
    if (centavos === undefined || centavos === null) return '...';
    const reais = centavos / 100;
    return reais.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  const [selectedPlano, setSelectedPlano] = useState<{
    codigo: 'pro' | 'studio';
    nome: string;
    preco: string;
    precoAnual?: string;
    cicloInicial?: 'mensal' | 'anual';
  }>({
    codigo: 'pro',
    nome: 'Pro',
    preco: formatarPrecoMensal(precosCentavos['pro']),
    precoAnual: precosAnuaisCentavos['pro'] ? `${formatarPrecoMensal(precosAnuaisCentavos['pro'])} / ano` : undefined,
    cicloInicial: 'anual',
  });

  const carregarAssinatura = async () => {
    setLoading(true);
    try {
      // 1. Carregar assinatura do tenant
      try {
        const { data, error } = await supabase.rpc('obter_assinatura_tenant', {
          p_tenant_id: tenant?.id,
        });
        if (!error && data) {
          setAssinatura(data);
        }
      } catch (e) {
        console.warn('[AbaAssinatura] Erro ao obter assinatura do tenant:', e);
      }

      // 2. Carrega preços atualizados dos planos
      try {
        const { data: rpcData, error: rpcErr } = await supabase.rpc('obter_planos_publicos');
        let planosList: any[] = [];
        if (Array.isArray(rpcData)) {
          planosList = rpcData;
        } else if (typeof rpcData === 'string') {
          try { planosList = JSON.parse(rpcData); } catch {}
        }

        if (!rpcErr && planosList.length > 0) {
          const mapaM: Record<string, number> = {};
          const mapaA: Record<string, number> = {};
          planosList.forEach((p: any) => {
            const cod = String(p.codigo).toLowerCase();
            if (p.codigo && typeof p.preco_centavos === 'number') {
              mapaM[cod] = p.preco_centavos;
            }
            if (typeof p.preco_anual_centavos === 'number' && p.preco_anual_centavos > 0) {
              mapaA[cod] = p.preco_anual_centavos;
            } else if (typeof p.preco_centavos === 'number') {
              mapaA[cod] = p.preco_centavos * 10;
            }
          });
          setPrecosCentavos((prev) => ({ ...prev, ...mapaM }));
          setPrecosAnuaisCentavos((prev) => ({ ...prev, ...mapaA }));
          if (mapaM['pro'] !== undefined) {
            setSelectedPlano((prev) => ({
              ...prev,
              preco: formatarPrecoMensal(mapaM['pro']),
              precoAnual: `${formatarPrecoMensal(mapaA['pro'] ?? 68400)} / ano`,
            }));
          }
        } else {
          // Fallback tabela plans
          const { data: plansData } = await supabase
            .from('plans')
            .select('codigo, preco_centavos, preco_anual_centavos');
          if (plansData && plansData.length > 0) {
            const mapaM: Record<string, number> = {};
            const mapaA: Record<string, number> = {};
            plansData.forEach((p) => {
              const cod = p.codigo.toLowerCase();
              if (p.codigo && typeof p.preco_centavos === 'number') {
                mapaM[cod] = p.preco_centavos;
              }
              if (typeof p.preco_anual_centavos === 'number' && p.preco_anual_centavos > 0) {
                mapaA[cod] = p.preco_anual_centavos;
              } else if (typeof p.preco_centavos === 'number') {
                mapaA[cod] = p.preco_centavos * 10;
              }
            });
            setPrecosCentavos((prev) => ({ ...prev, ...mapaM }));
            setPrecosAnuaisCentavos((prev) => ({ ...prev, ...mapaA }));
            if (mapaM['pro'] !== undefined) {
              setSelectedPlano((prev) => ({
                ...prev,
                preco: formatarPrecoMensal(mapaM['pro']),
                precoAnual: `${formatarPrecoMensal(mapaA['pro'] ?? 68400)} / ano`,
              }));
            }
          }
        }
      } catch (errPlans) {
        console.warn('[AbaAssinatura] Erro ao buscar precos:', errPlans);
      }
    } catch (err: any) {
      console.error('Erro ao carregar assinatura:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarAssinatura();
  }, []);

  const handleCancelarAssinatura = () => {
    setShowConfirmCancelar(true);
  };

  const executeCancelarAssinatura = async () => {
    setShowConfirmCancelar(false);
    setCancelando(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sessão expirada');

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/asaas-cancelar-assinatura`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Erro ao cancelar assinatura');

      showSuccess('Assinatura cancelada com sucesso. Seu acesso continuará ativo até o término do ciclo atual.');
      await carregarAssinatura();
    } catch (err: any) {
      showError(err.message || 'Falha ao cancelar assinatura.');
    } finally {
      setCancelando(false);
    }
  };

  const statusToneMap: Record<string, 'mint' | 'amber' | 'flare' | 'glass'> = {
    ativa: 'mint',
    trial: 'amber',
    atrasada: 'flare',
    cancelada: 'glass',
  };

  const statusLabelMap: Record<string, string> = {
    ativa: 'ATIVA (REGULAR)',
    trial: 'EM DEGUSTAÇÃO (TRIAL)',
    atrasada: 'PAGAMENTO EM ATRASO',
    cancelada: 'CANCELADA',
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-vapor-400 font-mono text-sm">
        Carregando informações da assinatura...
      </div>
    );
  }

  const planoSigla = (assinatura?.plano || 'free').toUpperCase();
  const cicloAssinatura = assinatura?.ciclo || 'mensal';

  const isEmTrial = assinatura?.status === 'trial' || tenant?.status === 'trial' || (!assinatura?.status && tenant?.plano === 'pro');
  const statusAssin = isEmTrial ? 'trial' : (assinatura?.status || 'trial');
  const jaCancelada = !!assinatura?.cancelada_em;

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <Card className="p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-graphite-700 pb-4 gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500 font-bold shrink-0">
              <ShieldCheck size={22} />
            </div>
            <div>
              <h3 className="font-display text-[18px] text-vapor-100 uppercase tracking-wide">
                Assinatura & Cobrança Asaas
              </h3>
              <p className="text-xs text-vapor-400">
                Gerenciamento de plano, periodicidade e renovação automática.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {jaCancelada && (
              <Badge tone="flare">NÃO RENOVA</Badge>
            )}
            <Badge tone={statusToneMap[statusAssin] || 'amber'}>
              {statusLabelMap[statusAssin] || 'EM DEGUSTAÇÃO (TRIAL)'}
            </Badge>
          </div>
        </div>

        {/* Detalhes do Plano */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-graphite-900/60 border border-graphite-700 flex flex-col gap-1">
            <span className="text-xs text-vapor-400 font-mono uppercase tracking-wider">
              {isEmTrial ? 'Plano em Degustação' : 'Plano Contratado'}
            </span>
            <span className="text-xl font-bold font-display text-vapor-100 flex items-center gap-2">
              {planoSigla}
              {isEmTrial && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 font-bold">
                  TRIAL
                </span>
              )}
            </span>
            <span className="text-xs text-vapor-400">
              {planoSigla === 'FREE'
                ? 'R$ 0,00 / mês'
                : cicloAssinatura === 'anual'
                ? `${formatarPrecoMensal(precosAnuaisCentavos[planoSigla.toLowerCase()] ?? (precosCentavos[planoSigla.toLowerCase()] ? precosCentavos[planoSigla.toLowerCase()] * 10 : assinatura?.valor_centavos))} / ano`
                : `${formatarPrecoMensal(precosCentavos[planoSigla.toLowerCase()] ?? assinatura?.valor_centavos)} / mês`}
            </span>
          </div>

          <div className="p-4 rounded-xl bg-graphite-900/60 border border-graphite-700 flex flex-col gap-1">
            <span className="text-xs text-vapor-400 font-mono uppercase tracking-wider">Ciclo de Cobrança</span>
            <span className="text-base font-bold text-vapor-100 flex items-center gap-2">
              {cicloAssinatura === 'anual' ? (
                <>
                  <Sparkles size={16} className="text-amber-400" />
                  <span>Anual (12 Meses)</span>
                </>
              ) : (
                <>
                  <Calendar size={16} className="text-vapor-300" />
                  <span>Mensal (30 Dias)</span>
                </>
              )}
            </span>
            <span className="text-xs text-vapor-400">
              {cicloAssinatura === 'anual' ? 'Desconto de até 15% aplicado' : 'Sem fidelidade contratual'}
            </span>
          </div>

          <div className="p-4 rounded-xl bg-graphite-900/60 border border-graphite-700 flex flex-col gap-1">
            <span className="text-xs text-vapor-400 font-mono uppercase tracking-wider">Forma de Pagamento</span>
            <span className="text-base font-bold text-vapor-100 flex items-center gap-2">
              <CreditCard size={16} className="text-amber-500" />
              {assinatura?.forma_pagamento === 'cartao' ? 'Cartão de Crédito' : assinatura?.forma_pagamento === 'pix' ? 'PIX' : 'Gratuito / Não cadastrado'}
            </span>
            {assinatura?.proximo_vencimento && (
              <span className="text-xs text-vapor-400 flex items-center gap-1 mt-1">
                <Calendar size={12} /> {jaCancelada ? 'Acesso válido até:' : 'Renovação em:'} {new Date(assinatura.proximo_vencimento).toLocaleDateString('pt-BR')}
              </span>
            )}
          </div>
        </div>

        {/* Aviso de Assinatura com Renovação Cancelada mantendo vigência */}
        {jaCancelada && assinatura?.proximo_vencimento && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3">
            <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-200">
              <p className="font-bold uppercase tracking-wide">Renovação Automática Desativada</p>
              <p className="text-vapor-300 mt-1">
                Sua assinatura não será renovada automaticamente. Conforme as diretrizes contratadas, todo o seu acesso e benefícios permanecem <strong>100% liberados até {new Date(assinatura.proximo_vencimento).toLocaleDateString('pt-BR')}</strong> sem qualquer corte ou cobrança adicional.
              </p>
            </div>
          </div>
        )}

        {/* Banner / Card de Upgrade para Plano Anual (quando está no Mensal ou Free) */}
        {!jaCancelada && (planoSigla === 'FREE' || cicloAssinatura === 'mensal') && (
          <div className="p-4 sm:p-5 rounded-xl bg-gradient-to-r from-amber-500/15 via-amber-500/5 to-graphite-900/60 border border-amber-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                <Sparkles size={20} />
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-vapor-100 uppercase tracking-wide">
                    {planoSigla === 'FREE' ? 'Fazer Upgrade para o Plano PRO' : 'Economize até 15% com o Plano Anual'}
                  </span>
                  <Badge tone="amber">2 MESES GRÁTIS</Badge>
                </div>
                <span className="text-xs text-vapor-400 mt-0.5">
                  Assine 12 meses por apenas{' '}
                  <strong className="text-amber-400 font-bold font-mono">
                    {formatarPrecoMensal(precosAnuaisCentavos['pro'] ?? (precosCentavos['pro'] ? precosCentavos['pro'] * 10 : assinatura?.valor_centavos))} / ano
                  </strong>{' '}
                  (em até 12x no cartão de crédito ou à vista no PIX).
                </span>
              </div>
            </div>

            <Button
              onClick={() => {
                const centavosProM = precosCentavos['pro'] ?? assinatura?.valor_centavos;
                const centavosProA = precosAnuaisCentavos['pro'] ?? (centavosProM ? centavosProM * 10 : undefined);
                setSelectedPlano({
                  codigo: 'pro',
                  nome: 'Pro',
                  preco: formatarPrecoMensal(centavosProM),
                  precoAnual: centavosProA ? `${formatarPrecoMensal(centavosProA)} / ano` : undefined,
                  cicloInicial: 'anual',
                });
                setCheckoutModalOpen(true);
              }}
              variant="primary"
              className="text-xs font-bold shrink-0 shadow-lg shadow-amber-500/10 w-full sm:w-auto"
            >
              {planoSigla === 'FREE' ? 'Assinar Anual (12x no Cartão ou PIX)' : 'Migrar para Plano Anual'}
            </Button>
          </div>
        )}

        {/* Alerta de Trial */}
        {(assinatura?.status === 'trial' || tenant?.status === 'trial') && (
          <div className="p-4 rounded-xl bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-graphite-900 border border-amber-500/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 size={22} className="text-amber-400 shrink-0" />
              <div className="flex flex-col">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-amber-200 uppercase tracking-wide">
                    Período de Degustação do Plano Pro (14 Dias)
                  </span>
                  {assinatura?.dias_trial_restantes !== undefined && (
                    <Badge tone="amber">{assinatura.dias_trial_restantes} dia(s) restantes</Badge>
                  )}
                </div>
                <span className="text-xs text-amber-300/90 mt-1 leading-relaxed">
                  Não precisa esperar os 14 dias terminarem! Ative sua assinatura definitiva agora para garantir seu plano e validar as comissões de parceiro.
                </span>
              </div>
            </div>

            <Button
              onClick={() => {
                const centavosProM = precosCentavos['pro'] ?? assinatura?.valor_centavos;
                const centavosProA = precosAnuaisCentavos['pro'] ?? (centavosProM ? centavosProM * 10 : undefined);
                setSelectedPlano({
                  codigo: 'pro',
                  nome: 'Pro',
                  preco: formatarPrecoMensal(centavosProM),
                  precoAnual: centavosProA ? `${formatarPrecoMensal(centavosProA)} / ano` : undefined,
                  cicloInicial: 'anual',
                });
                setCheckoutModalOpen(true);
              }}
              variant="primary"
              className="text-xs font-bold shrink-0 shadow-md shadow-amber-500/20 w-full sm:w-auto"
            >
              <CreditCard size={14} className="mr-1.5" />
              Assinar Agora (Anual ou Mensal)
            </Button>
          </div>
        )}

        {/* Alerta de Atraso */}
        {assinatura?.status === 'atrasada' && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <AlertTriangle size={20} className="text-rose-400 shrink-0" />
              <div className="flex flex-col">
                <span className="text-xs font-bold text-rose-200 uppercase tracking-wide">
                  Inadimplência de Pagamento
                </span>
                <span className="text-xs text-rose-300">
                  Tolerância de <strong>{assinatura.dias_para_rebaixamento} dia(s)</strong> antes do rebaixamento para Free.
                </span>
              </div>
            </div>

            {assinatura.url_pagamento_asaas && (
              <a
                href={assinatura.url_pagamento_asaas}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-rose-500 hover:bg-rose-400 text-graphite-950 font-bold rounded-lg text-xs flex items-center gap-1.5 transition-colors shadow-sm"
              >
                Pagar no Asaas
                <ExternalLink size={14} />
              </a>
            )}
          </div>
        )}

        {/* Ações da Assinatura */}
        <div className="pt-4 border-t border-graphite-700 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate('/planos')}
              className="text-xs flex items-center gap-2 flex-1 sm:flex-none justify-center"
            >
              <RefreshCw size={14} />
              Trocar de Plano / Comparar
            </Button>

            {assinatura?.url_pagamento_asaas && (
              <a
                href={assinatura.url_pagamento_asaas}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3.5 py-2 rounded-lg bg-graphite-900 hover:bg-graphite-700 text-amber-400 border border-amber-500/30 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors flex-1 sm:flex-none"
              >
                Atualizar Cartão / Fatura
                <ExternalLink size={13} />
              </a>
            )}
          </div>

          {/* Botão de Cancelamento que aciona a Edge Function */}
          {assinatura?.status !== 'cancelada' && !jaCancelada && (
            <button
              type="button"
              onClick={handleCancelarAssinatura}
              disabled={cancelando}
              className="px-3.5 py-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer w-full sm:w-auto"
            >
              <XCircle size={14} />
              {cancelando ? 'Cancelando...' : 'Cancelar Assinatura'}
            </button>
          )}
        </div>
      </Card>

      <CheckoutModal
        isOpen={checkoutModalOpen}
        onClose={() => setCheckoutModalOpen(false)}
        planoCodigo={selectedPlano.codigo}
        planoNome={selectedPlano.nome}
        precoMensal={selectedPlano.preco}
        precoAnual={selectedPlano.precoAnual}
        cicloInicial={selectedPlano.cicloInicial}
        onSuccess={async () => {
          setCheckoutModalOpen(false);
          await carregarAssinatura();
          await refetchTenantData();
        }}
      />

      {/* Modal de Confirmação para Cancelar Assinatura */}
      <ModalConfirmacao
        isOpen={showConfirmCancelar}
        onClose={() => setShowConfirmCancelar(false)}
        onConfirm={executeCancelarAssinatura}
        titulo={cicloAssinatura === 'anual' ? 'Confirmar Cancelamento do Plano Anual' : 'Confirmar Cancelamento da Assinatura'}
        mensagem={
          cicloAssinatura === 'anual'
            ? `Tem certeza que deseja cancelar sua assinatura anual? A renovação automática dos próximos anos será desativada. Conforme nossa política de assinatura anual (com até 15% de desconto promocional), seu plano e todos os seus recursos permanecerão 100% liberados até o término dos 12 meses já pagos (${
                assinatura?.proximo_vencimento
                  ? new Date(assinatura.proximo_vencimento).toLocaleDateString('pt-BR')
                  : 'período contratado'
              }). Não haverá novas cobranças.`
            : `Tem certeza que deseja cancelar sua assinatura mensal? A renovação automática será cancelada e seu acesso permanecerá ativo até o fim do período já pago (${
                assinatura?.proximo_vencimento
                  ? new Date(assinatura.proximo_vencimento).toLocaleDateString('pt-BR')
                  : 'término do ciclo'
              }).`
        }
        textoConfirmar={cicloAssinatura === 'anual' ? 'Cancelar Renovação Automática' : 'Cancelar Assinatura'}
        textoCancelar="Manter Assinatura"
        variant="danger"
        loading={cancelando}
      />
    </div>
  );
};

