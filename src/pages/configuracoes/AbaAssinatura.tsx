import React, { useEffect, useState } from 'react';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ShieldCheck, Calendar, CreditCard, AlertTriangle, ExternalLink, RefreshCw, XCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { CheckoutModal } from '../../components/assinatura/CheckoutModal';
import { useNavigate } from 'react-router-dom';

export const AbaAssinatura: React.FC = () => {
  const { showSuccess, showError } = useToast();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [cancelando, setCancelando] = useState(false);
  const [assinatura, setAssinatura] = useState<any>(null);
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const [selectedPlano, setSelectedPlano] = useState<{
    codigo: 'pro' | 'studio';
    nome: string;
    preco: string;
  }>({
    codigo: 'pro',
    nome: 'Pro',
    preco: 'R$ 67,00',
  });

  const carregarAssinatura = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('obter_assinatura_tenant');
      if (error) throw error;
      setAssinatura(data);
    } catch (err: any) {
      console.error('Erro ao carregar assinatura:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarAssinatura();
  }, []);

  const handleCancelarAssinatura = async () => {
    if (!window.confirm('Tem certeza que deseja cancelar sua assinatura? O plano será alterado ao fim do período atual.')) {
      return;
    }

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

      showSuccess('Assinatura cancelada com sucesso no Asaas e no sistema.');
      await carregarAssinatura();
    } catch (err: any) {
      showError(err.message || 'Erro ao efetuar cancelamento');
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

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <Card className="p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-graphite-700 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500 font-bold">
              <ShieldCheck size={22} />
            </div>
            <div>
              <h3 className="font-display text-[18px] text-vapor-100 uppercase tracking-wide">
                Assinatura & Cobrança Asaas
              </h3>
              <p className="text-xs text-vapor-400">
                Gerenciamento de plano, forma de pagamento e renovação.
              </p>
            </div>
          </div>

          <Badge tone={statusToneMap[assinatura?.status || 'ativa'] || 'glass'}>
            {statusLabelMap[assinatura?.status] || 'STATUS DESCONHECIDO'}
          </Badge>
        </div>

        {/* Detalhes do Plano */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-graphite-900/60 border border-graphite-700 flex flex-col gap-1">
            <span className="text-xs text-vapor-400 font-mono uppercase tracking-wider">Plano Ativo</span>
            <span className="text-xl font-bold font-display text-vapor-100">
              {planoSigla}
            </span>
            <span className="text-xs text-vapor-400">
              {planoSigla === 'FREE' ? 'R$ 0,00 / mês' : planoSigla === 'PRO' ? 'R$ 67,00 / mês' : 'R$ 147,00 / mês'}
            </span>
          </div>

          <div className="p-4 rounded-xl bg-graphite-900/60 border border-graphite-700 flex flex-col gap-1">
            <span className="text-xs text-vapor-400 font-mono uppercase tracking-wider">Forma de Pagamento</span>
            <span className="text-base font-bold text-vapor-100 flex items-center gap-2">
              <CreditCard size={16} className="text-amber-500" />
              {assinatura?.forma_pagamento === 'cartao' ? 'Cartão de Crédito' : assinatura?.forma_pagamento === 'pix' ? 'PIX Recorrente' : 'Gratuito / Não cadastrado'}
            </span>
            {assinatura?.proximo_vencimento && (
              <span className="text-xs text-vapor-400 flex items-center gap-1 mt-1">
                <Calendar size={12} /> Renovação em: {new Date(assinatura.proximo_vencimento).toLocaleDateString('pt-BR')}
              </span>
            )}
          </div>
        </div>

        {/* Alerta de Trial */}
        {assinatura?.status === 'trial' && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <CheckCircle2 size={20} className="text-amber-400 shrink-0" />
              <div className="flex flex-col">
                <span className="text-xs font-bold text-amber-200 uppercase tracking-wide">
                  Período de Degustação do Plano Pro (14 Dias)
                </span>
                <span className="text-xs text-amber-300">
                  Restam <strong>{assinatura.dias_trial_restantes} dia(s)</strong> de trial. Assine antes do término para manter o acesso.
                </span>
              </div>
            </div>

            <Button
              onClick={() => {
                setSelectedPlano({ codigo: 'pro', nome: 'Pro', preco: 'R$ 67,00' });
                setCheckoutModalOpen(true);
              }}
              variant="primary"
              className="text-xs font-bold shrink-0"
            >
              Assinar Agora
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
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate('/planos')}
              className="text-xs flex items-center gap-2"
            >
              <RefreshCw size={14} />
              Trocar de Plano / Comparar
            </Button>

            {assinatura?.url_pagamento_asaas && (
              <a
                href={assinatura.url_pagamento_asaas}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3.5 py-2 rounded-lg bg-graphite-900 hover:bg-graphite-700 text-amber-400 border border-amber-500/30 text-xs font-medium flex items-center gap-1.5 transition-colors"
              >
                Atualizar Cartão / Fatura
                <ExternalLink size={13} />
              </a>
            )}
          </div>

          {/* AJUSTE 1: Botão de Cancelamento que aciona a Edge Function */}
          {assinatura?.status !== 'cancelada' && (
            <button
              type="button"
              onClick={handleCancelarAssinatura}
              disabled={cancelando}
              className="px-3.5 py-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-medium flex items-center gap-1.5 transition-colors"
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
        onSuccess={() => {
          setCheckoutModalOpen(false);
          carregarAssinatura();
        }}
      />
    </div>
  );
};
