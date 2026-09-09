import React from 'react';
import { Link } from 'react-router-dom';
import { Lock, Sparkles, ChevronRight, ArrowLeft } from 'lucide-react';
import { usePlano } from '../../hooks/usePlano';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

interface BloqueioRecursoPlanoProps {
  recurso: string;
  descricao?: string;
  planoMinimo?: 'Pro' | 'Studio';
  beneficios?: string[];
}

export const BloqueioRecursoPlano: React.FC<BloqueioRecursoPlanoProps> = ({
  recurso,
  descricao,
  planoMinimo = 'Pro',
  beneficios = [],
}) => {
  const { nomePlano } = usePlano();

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8 max-w-2xl mx-auto min-h-[500px]">
      <Card className="w-full p-6 sm:p-8 bg-graphite-900 border-graphite-700/80 rounded-2xl shadow-2xl flex flex-col items-center text-center gap-6 relative overflow-hidden">
        {/* Glow de fundo */}
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Ícone com badge */}
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl bg-graphite-800 border border-graphite-600 flex items-center justify-center text-amber-400 shadow-inner">
            <Lock size={32} />
          </div>
          <span className="absolute -bottom-2 -right-2 px-2 py-0.5 bg-amber-500 text-graphite-950 text-[10px] font-mono font-extrabold uppercase rounded-full shadow">
            {planoMinimo}
          </span>
        </div>

        {/* Títulos e Explicação */}
        <div className="flex flex-col gap-2 max-w-md">
          <span className="font-mono text-[11px] text-amber-400 uppercase tracking-widest font-semibold flex items-center justify-center gap-1">
            <Sparkles size={12} /> Recurso Exclusivo do Plano {planoMinimo}
          </span>
          <h2 className="font-display text-xl sm:text-2xl font-bold text-vapor-100">
            {recurso}
          </h2>
          <p className="font-sans text-sm text-vapor-400 leading-relaxed">
            {descricao ||
              `A funcionalidade ${recurso} está desativada para o seu plano atual (${nomePlano}). Para desbloquear este recurso e impulsionar a sua operação, faça upgrade para o plano ${planoMinimo}.`}
          </p>
        </div>

        {/* Benefícios em destaque */}
        {beneficios.length > 0 && (
          <div className="w-full bg-graphite-950/60 border border-graphite-800/80 rounded-xl p-4 text-left">
            <span className="font-sans text-xs font-semibold text-vapor-300 block mb-2">
              Com o Plano {planoMinimo} você tem:
            </span>
            <ul className="space-y-1.5 text-xs text-vapor-400 font-sans">
              {beneficios.map((b, idx) => (
                <li key={idx} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Ações */}
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto pt-2">
          <Link to="/planos" className="w-full sm:w-auto">
            <Button variant="primary" className="w-full sm:w-auto flex items-center justify-center gap-2">
              <Sparkles size={16} />
              <span>Conhecer Plano {planoMinimo}</span>
              <ChevronRight size={16} />
            </Button>
          </Link>
          <Link to="/" className="w-full sm:w-auto">
            <Button variant="secondary" className="w-full sm:w-auto flex items-center justify-center gap-2">
              <ArrowLeft size={16} />
              <span>Voltar ao Dashboard</span>
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
};
