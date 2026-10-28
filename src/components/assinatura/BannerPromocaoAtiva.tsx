import React, { useState } from 'react';
import { Sparkles, AlertCircle, X, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface BannerPromocaoAtivaProps {
  assinatura: {
    plano?: string;
    promo_meses_restantes?: number | null;
    promo_valor_normal_centavos?: number | null;
    promo_cupom_codigo?: string | null;
    promo_valor_cobrado_centavos?: number | null;
    valor_centavos?: number;
  } | null;
}

export const BannerPromocaoAtiva: React.FC<BannerPromocaoAtivaProps> = ({ assinatura }) => {
  const navigate = useNavigate();
  const [dispensado, setDispensado] = useState(() => {
    return sessionStorage.getItem('banner_promo_dispensado') === 'true';
  });

  if (dispensado || !assinatura) return null;

  const mesesRestantes = assinatura.promo_meses_restantes;
  if (!mesesRestantes || mesesRestantes <= 0) return null;

  const cupom = assinatura.promo_cupom_codigo || 'PROMOCIONAL';
  const valorPromoCentavos = assinatura.promo_valor_cobrado_centavos ?? assinatura.valor_centavos ?? 0;
  const valorNormalCentavos = assinatura.promo_valor_normal_centavos ?? 5700;

  const valorPromoStr = (valorPromoCentavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const valorNormalStr = (valorNormalCentavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const isUltimoMes = mesesRestantes === 1;

  const handleDispensar = () => {
    sessionStorage.setItem('banner_promo_dispensado', 'true');
    setDispensado(true);
  };

  return (
    <div className={`w-full mb-4 px-4 py-3 rounded-2xl border transition-all shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
      isUltimoMes
        ? 'bg-gradient-to-r from-amber-500/20 via-slate-900 to-amber-600/10 border-amber-500/50 shadow-amber-500/10'
        : 'bg-gradient-to-r from-blue-500/15 via-slate-900 to-purple-600/10 border-blue-500/40 shadow-blue-500/10'
    }`}>
      <div className="flex items-start sm:items-center gap-3">
        <div className={`p-2 rounded-xl shrink-0 ${
          isUltimoMes ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400'
        }`}>
          {isUltimoMes ? <AlertCircle size={20} className="animate-pulse" /> : <Sparkles size={20} />}
        </div>
        <div className="text-xs text-slate-200 leading-relaxed">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="font-black uppercase tracking-wider text-white">
              {isUltimoMes ? '⚠️ ÚLTIMO MÊS PROMOCIONAL' : '🏷️ CONDIÇÃO PROMOCIONAL ATIVA'}
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-800 text-amber-300 border border-slate-700">
              Cupom: {cupom}
            </span>
          </div>
          <p className="text-slate-300">
            {isUltimoMes ? (
              <>
                Esta é sua <strong>última fatura com desconto a {valorPromoStr}</strong>. A partir da próxima mensalidade, sua assinatura renovará automaticamente pelo valor integral de <strong className="text-white">{valorNormalStr}/mês</strong>.
              </>
            ) : (
              <>
                Você está pagando <strong>{valorPromoStr}/mês</strong>. Restam <strong>{mesesRestantes} mensalidades</strong> com desconto. Após esse período, o plano voltará ao valor normal de <strong className="text-white">{valorNormalStr}/mês</strong>.
              </>
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
        <button
          onClick={() => navigate('/configuracoes/assinatura')}
          className="text-[11px] font-bold text-amber-400 hover:text-amber-300 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition"
        >
          <span>Ver Assinatura</span>
          <ArrowRight size={12} />
        </button>
        <button
          onClick={handleDispensar}
          className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          title="Dispensar aviso por hoje"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
};
