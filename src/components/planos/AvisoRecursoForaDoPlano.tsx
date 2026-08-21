import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { usePermissao } from '../../hooks/usePermissao';
import { useAuth } from '../../contexts/AuthContext';

interface AvisoRecursoForaDoPlanoProps {
  featureNome: string;
  planoMinimo?: 'Pro' | 'Studio';
}

export const AvisoRecursoForaDoPlano: React.FC<AvisoRecursoForaDoPlanoProps> = ({
  featureNome,
  planoMinimo = 'Pro',
}) => {
  const { isOperador } = usePermissao();
  const { tenant } = useAuth();

  // Operadores nunca vêm avisos de upgrade/planos
  if (isOperador) return null;

  // Se a oficina já for Pro ou Studio, não exibe aviso se o recurso for Pro
  const planoAtual = tenant?.plano || 'free';
  if (planoAtual === 'studio') return null;
  if (planoAtual === 'pro' && planoMinimo === 'Pro') return null;

  return (
    <div className="mb-6 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 sm:p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-amber-200 text-xs sm:text-sm">
      <div className="flex items-center gap-2.5">
        <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
        <div>
          <span className="font-semibold text-amber-400">Funcionalidade do Plano {planoMinimo}: </span>
          <span>
            {featureNome} está ativa em modo aviso. Ela não será bloqueada durante a fase beta.
          </span>
        </div>
      </div>
      <Link
        to="/planos"
        className="inline-flex items-center gap-1 font-semibold text-amber-400 hover:text-amber-300 hover:underline shrink-0 bg-amber-500/20 px-3 py-1.5 rounded-md transition-colors"
      >
        Conhecer Planos
        <ChevronRight className="w-4 h-4" />
      </Link>
    </div>
  );
};
