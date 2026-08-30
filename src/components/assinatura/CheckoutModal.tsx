import React, { useState } from 'react';
import { CreditCard, QrCode, ShieldCheck, CheckCircle2, Loader2, AlertCircle, ExternalLink, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  planoCodigo: 'pro' | 'studio';
  planoNome: string;
  precoMensal: string;
  onSuccess?: () => void;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  isOpen,
  onClose,
  planoCodigo,
  planoNome,
  precoMensal,
  onSuccess,
}) => {
  const { showSuccess, showError } = useToast();
  const [formaPagamento, setFormaPagamento] = useState<'cartao' | 'pix'>('cartao');
  const [aceitouTermos, setAceitouTermos] = useState(false);
  const [loading, setLoading] = useState(false);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!aceitouTermos) {
      showError('É necessário aceitar os Termos de Uso e Política de Privacidade para continuar.');
      return;
    }

    setLoading(true);
    setPaymentUrl(null);

    try {
      // 1. Obter sessão do usuário
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Sessão expirada. Faça login novamente.');
      }

      // 2. Chamar Edge Function de Checkout
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/asaas-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          plano: planoCodigo,
          forma_pagamento: formaPagamento,
          term_version: 'v1.0-2026-08',
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Falha ao processar checkout');
      }

      // Se retornou link de pagamento
      if (result.paymentUrl) {
        setPaymentUrl(result.paymentUrl);
      }

      showSuccess(`Assinatura do plano ${planoNome} gerada com sucesso!`);
      if (onSuccess) onSuccess();
    } catch (err: any) {
      showError(err.message || 'Erro ao comunicar com o gateway de pagamento');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-graphite-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-graphite-900 border border-graphite-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Cabeçalho */}
        <div className="p-5 border-b border-graphite-800 flex items-center justify-between bg-graphite-950/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500 font-bold">
              <ShieldCheck size={22} />
            </div>
            <div>
              <h3 className="text-base font-bold text-vapor-100 uppercase tracking-wide">
                Checkout Seguro • Plano {planoNome}
              </h3>
              <p className="text-xs text-vapor-400 font-mono">
                {precoMensal} / mês • Cobrança Recorrente Asaas
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-vapor-400 hover:text-vapor-100 p-1.5 rounded-lg hover:bg-graphite-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Corpo do Modal */}
        <div className="p-6 flex flex-col gap-6 overflow-y-auto">
          {paymentUrl ? (
            <div className="flex flex-col items-center text-center gap-4 py-4">
              <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-500">
                <CheckCircle2 size={32} />
              </div>
              <div className="flex flex-col gap-1">
                <h4 className="text-lg font-bold text-vapor-100">Assinatura Solicitada!</h4>
                <p className="text-xs text-vapor-300 max-w-sm">
                  Sua assinatura foi registrada. Clique no botão abaixo para concluir o pagamento ou cadastrar o cartão no ambiente seguro do Asaas.
                </p>
              </div>
              <a
                href={paymentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3.5 px-4 bg-amber-500 hover:bg-amber-400 text-graphite-950 font-bold rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-amber-500/20"
              >
                Pagar / Cadastrar Cartão no Asaas
                <ExternalLink size={16} />
              </a>
            </div>
          ) : (
            <form onSubmit={handleCheckout} className="flex flex-col gap-6">
              {/* Seleção de Forma de Pagamento */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-mono font-bold text-vapor-300 uppercase tracking-wider">
                  Forma de Pagamento Recorrente
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setFormaPagamento('cartao')}
                    className={`flex items-center justify-center gap-2.5 p-3.5 rounded-xl border font-semibold text-sm transition-all ${
                      formaPagamento === 'cartao'
                        ? 'bg-amber-500/10 border-amber-500 text-amber-500'
                        : 'bg-graphite-800/50 border-graphite-700 text-vapor-300 hover:border-graphite-600'
                    }`}
                  >
                    <CreditCard size={18} />
                    Cartão de Crédito
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormaPagamento('pix')}
                    className={`flex items-center justify-center gap-2.5 p-3.5 rounded-xl border font-semibold text-sm transition-all ${
                      formaPagamento === 'pix'
                        ? 'bg-amber-500/10 border-amber-500 text-amber-500'
                        : 'bg-graphite-800/50 border-graphite-700 text-vapor-300 hover:border-graphite-600'
                    }`}
                  >
                    <QrCode size={18} />
                    PIX Recorrente
                  </button>
                </div>
              </div>

              {/* Informação sobre o Gateway */}
              <div className="bg-graphite-950/60 p-4 rounded-xl border border-graphite-800 flex items-start gap-3">
                <AlertCircle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-vapor-400 leading-relaxed">
                  Você será redirecionado para a página oficial e criptografada do <strong>Asaas</strong> para concluir a digitação do cartão ou gerar o QR Code Pix com total segurança.
                </p>
              </div>

              {/* Checkbox Obrigatório dos Termos Legais */}
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-graphite-950/40 border border-graphite-800">
                <input
                  type="checkbox"
                  id="aceite-termos-checkout"
                  checked={aceitouTermos}
                  onChange={(e) => setAceitouTermos(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-graphite-700 bg-graphite-900 text-amber-500 focus:ring-amber-500 focus:ring-offset-graphite-950 cursor-pointer"
                />
                <label htmlFor="aceite-termos-checkout" className="text-xs text-vapor-300 leading-relaxed cursor-pointer selection:bg-none">
                  Li e aceito os{' '}
                  <a
                    href="/termos-uso"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-amber-500 hover:underline font-semibold"
                  >
                    Termos de Uso (v1.0)
                  </a>{' '}
                  e a{' '}
                  <a
                    href="/politica-de-privacidade"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-amber-500 hover:underline font-semibold"
                  >
                    Política de Privacidade
                  </a>{' '}
                  do NuvemWash.
                </label>
              </div>

              {/* Botão de Submissão */}
              <button
                type="submit"
                disabled={loading || !aceitouTermos}
                className="w-full py-3.5 px-4 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-graphite-950 font-bold rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-amber-500/10 text-sm uppercase tracking-wider"
              >
                {loading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Gerando Assinatura...
                  </>
                ) : (
                  <>
                    Ir para Pagamento no Asaas ({precoMensal})
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
