import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePlano } from '../../hooks/usePlano';
import { supabase } from '../../lib/supabase';
import { AlertTriangle, Sparkles, X, ArrowUpRight } from 'lucide-react';

interface AlertaItem {
  recurso: string;
  nomeRecurso: string;
  usoAtual: number;
  limite: number;
  porcentagem: number;
  atingiu: boolean;
}

export const BannerAlertaLimites: React.FC = () => {
  const { planoAtual, nomePlano, verificarUso } = usePlano();
  const [alertas, setAlertas] = useState<AlertaItem[]>([]);
  const [dismissed, setDismissed] = useState(false);

  const checarConsumo = async () => {
    try {
      // Contadores atuais da oficina
      const [
        { count: countClientes },
        { count: countAgendamentos },
        { count: countExecucoes },
      ] = await Promise.all([
        supabase.from('clientes').select('*', { count: 'exact', head: true }),
        supabase.from('orders').select('*', { count: 'exact', head: true }),
        supabase.from('execucoes').select('*', { count: 'exact', head: true }),
      ]);

      const lista: AlertaItem[] = [];

      // 1. Clientes
      const resClientes = verificarUso('clientes', countClientes || 0);
      if ((resClientes.proximo || resClientes.atingiu) && resClientes.limite) {
        lista.push({
          recurso: 'clientes',
          nomeRecurso: 'Clientes Cadastrados',
          usoAtual: countClientes || 0,
          limite: resClientes.limite,
          porcentagem: resClientes.porcentagem,
          atingiu: resClientes.atingiu,
        });
      }

      // 2. Agendamentos
      const resAgendamentos = verificarUso('agendamentos', countAgendamentos || 0);
      if ((resAgendamentos.proximo || resAgendamentos.atingiu) && resAgendamentos.limite) {
        lista.push({
          recurso: 'agendamentos',
          nomeRecurso: 'Agendamentos',
          usoAtual: countAgendamentos || 0,
          limite: resAgendamentos.limite,
          porcentagem: resAgendamentos.porcentagem,
          atingiu: resAgendamentos.atingiu,
        });
      }

      // 3. Execuções / Vistorias
      const resExecucoes = verificarUso('execucoes', countExecucoes || 0);
      if ((resExecucoes.proximo || resExecucoes.atingiu) && resExecucoes.limite) {
        lista.push({
          recurso: 'execucoes',
          nomeRecurso: 'Vistorias & Execuções',
          usoAtual: countExecucoes || 0,
          limite: resExecucoes.limite,
          porcentagem: resExecucoes.porcentagem,
          atingiu: resExecucoes.atingiu,
        });
      }

      setAlertas(lista);
    } catch (err) {
      console.error('[BannerAlertaLimites] Erro ao checar consumo:', err);
    }
  };

  useEffect(() => {
    checarConsumo();
  }, [planoAtual]);

  if (dismissed || alertas.length === 0) return null;

  const piorAlerta = alertas[0];

  return (
    <div className={`p-4 rounded-xl border flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-lg transition-all animate-in fade-in ${
      piorAlerta.atingiu
        ? 'bg-rose-500/10 border-rose-500/40 text-rose-200'
        : 'bg-amber-500/10 border-amber-500/40 text-amber-200'
    }`}>
      <div className="flex items-start gap-3">
        <div className={`p-2.5 rounded-lg shrink-0 mt-0.5 ${
          piorAlerta.atingiu ? 'bg-rose-500/20 text-rose-400' : 'bg-amber-500/20 text-amber-400'
        }`}>
          <AlertTriangle className="w-5 h-5" />
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-white">
              {piorAlerta.atingiu
                ? `Limite de ${piorAlerta.nomeRecurso} Atingido (${piorAlerta.usoAtual}/${piorAlerta.limite})`
                : `Atenção: Você atingiu ${piorAlerta.porcentagem}% do limite de ${piorAlerta.nomeRecurso}`}
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-graphite-950 font-mono text-amber-400 border border-graphite-800">
              Plano {nomePlano}
            </span>
          </div>

          <p className="text-xs opacity-90 leading-relaxed max-w-2xl">
            {piorAlerta.atingiu
              ? `Sua oficina atingiu a capacidade máxima de ${piorAlerta.nomeRecurso.toLowerCase()} inclusa no seu plano atual. Faça o upgrade agora para desbloquear capacidade ilimitada.`
              : `Você utilizou ${piorAlerta.usoAtual} de ${piorAlerta.limite} ${piorAlerta.nomeRecurso.toLowerCase()} permitidos neste mês. Faça upgrade antecipado para não interromper seus atendimentos.`}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0 self-end md:self-center">
        <Link
          to="/planos"
          className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-4 py-2 rounded-lg text-xs transition flex items-center space-x-1.5 shadow-md"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Fazer Upgrade de Plano</span>
          <ArrowUpRight className="w-3.5 h-3.5" />
        </Link>

        <button
          onClick={() => setDismissed(true)}
          className="p-1 text-slate-400 hover:text-white transition"
          title="Fechar aviso temporariamente"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
