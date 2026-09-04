import React, { useState } from 'react';
import { PageHeader } from '../components/layout/PageHeader';
import { DiluicaoCalculator } from '../features/diluicao/DiluicaoCalculator';
import { Button } from '../components/ui/Button';
import { Share2, Check, MessageCircle, ExternalLink, Sparkles } from 'lucide-react';

export const DiluicaoInterna: React.FC = () => {
  const [copiado, setCopiado] = useState(false);

  const handleCopiarLink = async () => {
    try {
      const url = `${window.location.origin}/calculadora`;
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    }
  };

  const handleCompartilharWhatsApp = () => {
    const url = `${window.location.origin}/calculadora`;
    const mensagem = encodeURIComponent(
      `🧪 Calculadora de Diluição Profissional para Estética Automotiva:\n` +
      `Descubra a proporção exata para Snow Foam manual e de lavadora sem desperdício de produto!\n\n` +
      `Acesse grátis aqui: ${url}`
    );
    window.open(`https://api.whatsapp.com/send?text=${mensagem}`, '_blank');
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Calculadora de Diluição"
        subtitle="Calibração para snow foam manual e lavadoras de alta pressão"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleCopiarLink}
              className={`text-xs h-9 px-3.5 border-graphite-600 flex items-center gap-1.5 transition-all ${
                copiado
                  ? 'bg-emerald-950 border-emerald-500 text-emerald-300'
                  : 'text-vapor-200 hover:text-amber-400 hover:border-amber-500/50'
              }`}
              title="Copiar link público para compartilhar com outras pessoas"
            >
              {copiado ? <Check size={14} className="text-emerald-400" /> : <Share2 size={14} />}
              <span>{copiado ? 'Link Copiado!' : 'Copiar Link da Calculadora'}</span>
            </Button>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleCompartilharWhatsApp}
              className="text-xs h-9 px-3.5 border-emerald-500/30 text-emerald-400 hover:bg-emerald-950/40 flex items-center gap-1.5"
              title="Compartilhar no WhatsApp"
            >
              <MessageCircle size={14} />
              <span>Enviar no WhatsApp</span>
            </Button>
          </div>
        }
      />

      {/* Card informativo sobre o compartilhamento externo */}
      <div className="bg-graphite-800/80 border border-graphite-700/80 rounded-xl p-3.5 sm:p-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-vapor-300">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/15 text-amber-400 flex items-center justify-center shrink-0">
            <Sparkles size={16} />
          </div>
          <div>
            <p className="font-semibold text-vapor-100">
              Compartilhe a ferramenta com outros profissionais ou clientes
            </p>
            <p className="text-vapor-400 text-[11px] sm:text-xs">
              Quem acessar pelo link externo usará a calculadora limpa, sem necessidade de cadastro nem login.
            </p>
          </div>
        </div>
        <a
          href="/calculadora"
          target="_blank"
          rel="noopener noreferrer"
          className="text-vapor-400 hover:text-amber-400 flex items-center gap-1 text-xs shrink-0 underline"
        >
          <span>Abrir link público</span>
          <ExternalLink size={12} />
        </a>
      </div>

      <DiluicaoCalculator variant="interno" />
    </div>
  );
};
