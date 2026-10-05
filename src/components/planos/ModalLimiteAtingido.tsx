import React from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Sparkles, ArrowRight, X, ShieldAlert, Zap } from 'lucide-react';
import { Button } from '../ui/Button';

interface ModalLimiteAtingidoProps {
  isOpen: boolean;
  onClose: () => void;
  recurso: string;
  recursoNome?: string;
  uso?: number | null;
  limite?: number | null;
  planoNome?: string;
  mensagemPersonalizada?: string;
}

const NOMES_RECURSOS: Record<string, { nome: string; descricao: string; proximoPlano: string }> = {
  agendamentos: {
    nome: 'Agendamentos Mensais',
    descricao: 'Sua oficina atingiu o teto de agendamentos permitidos neste mês.',
    proximoPlano: 'Studio (500 agendamentos/mês)',
  },
  atendimentos_mes: {
    nome: 'Atendimentos Mensais',
    descricao: 'Sua oficina atingiu a cota de atendimentos concluídos para este ciclo.',
    proximoPlano: 'Studio (500 atendimentos/mês)',
  },
  clientes: {
    nome: 'Clientes Cadastrados',
    descricao: 'Sua carteira de clientes ativos atingiu o limite contratado.',
    proximoPlano: 'Studio (Clientes Ilimitados)',
  },
  usuarios: {
    nome: 'Membros da Equipe',
    descricao: 'O número de colaboradores ativos atingiu o limite de licenças do seu plano.',
    proximoPlano: 'Studio (Até 10 membros)',
  },
  membros: {
    nome: 'Membros da Equipe',
    descricao: 'O número de colaboradores ativos atingiu o limite de licenças do seu plano.',
    proximoPlano: 'Studio (Até 10 membros)',
  },
  produtos: {
    nome: 'Produtos em Estoque',
    descricao: 'O catálogo de insumos e produtos atingiu o número máximo de itens.',
    proximoPlano: 'Studio (Produtos Ilimitados)',
  },
  orcamentos_mes: {
    nome: 'Orçamentos Mensais',
    descricao: 'O volume mensal de orçamentos gerados atingiu a cota do seu plano.',
    proximoPlano: 'Studio (Orçamentos Ilimitados)',
  },
  servicos: {
    nome: 'Serviços no Catálogo',
    descricao: 'O catálogo de serviços cadastrados atingiu a quantidade máxima permitida.',
    proximoPlano: 'Studio (Serviços Ilimitados)',
  },
};

export const ModalLimiteAtingido: React.FC<ModalLimiteAtingidoProps> = ({
  isOpen,
  onClose,
  recurso,
  recursoNome,
  uso,
  limite,
  planoNome = 'atual',
  mensagemPersonalizada,
}) => {
  const navigate = useNavigate();

  if (!isOpen) return null;

  const info = NOMES_RECURSOS[recurso] || {
    nome: recursoNome || recurso,
    descricao: 'Você atingiu o limite operacional desta funcionalidade para o seu plano atual.',
    proximoPlano: 'Plano Superior com maiores limites',
  };

  const handleIrParaPlanos = () => {
    onClose();
    navigate('/planos');
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div 
        className="relative w-full max-w-lg bg-graphite-900 border border-amber-500/30 rounded-2xl shadow-2xl overflow-hidden text-left"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Glow de fundo */}
        <div className="absolute -top-20 -right-20 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-20 w-48 h-48 bg-flare-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Header com botão fechar */}
        <div className="p-6 pb-4 border-b border-graphite-800 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400">
              <ShieldAlert size={28} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 uppercase">
                  Limite Atingido
                </span>
                <span className="text-xs text-vapor-400 font-mono">
                  Plano {planoNome}
                </span>
              </div>
              <h3 className="text-lg font-bold font-display text-vapor-100 mt-1">
                {info.nome}
              </h3>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-vapor-400 hover:text-vapor-100 hover:bg-graphite-800 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Conteúdo */}
        <div className="p-6 space-y-4">
          <p className="text-sm text-vapor-300 leading-relaxed">
            {mensagemPersonalizada || info.descricao}
          </p>

          {/* Placar de Uso */}
          {limite !== null && limite !== undefined && (
            <div className="p-4 bg-graphite-950/70 border border-graphite-800 rounded-xl flex items-center justify-between">
              <div>
                <span className="text-xs text-vapor-400 block">Capacidade do seu plano:</span>
                <span className="text-xs font-semibold text-vapor-200">
                  {recurso === 'agendamentos' || recurso === 'orcamentos_mes' ? 'Cota mensal renovada dia 1º' : 'Limite operacional simultâneo'}
                </span>
              </div>
              <div className="text-right">
                <span className="text-xl font-bold font-mono text-amber-400">
                  {uso ?? limite} <span className="text-xs text-vapor-400">/ {limite}</span>
                </span>
                <span className="block text-[11px] font-bold text-flare-400 uppercase">
                  100% Utilizado
                </span>
              </div>
            </div>
          )}

          {/* Destaque de Isolamento Seguro */}
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-start gap-2.5 text-xs text-emerald-300">
            <Zap size={16} className="shrink-0 mt-0.5 text-emerald-400" />
            <span>
              <strong>Fique tranquilo:</strong> Apenas a criação de novos itens para esta função específica foi pausada. Todo o restante do seu sistema, cadastros, histórico e financeiro continuam 100% liberados.
            </span>
          </div>

          {/* Recomendação de Upgrade */}
          <div className="p-3.5 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/30 rounded-xl flex items-center justify-between gap-3">
            <div>
              <span className="text-xs text-amber-400 font-semibold block flex items-center gap-1">
                <Sparkles size={12} /> Próximo Nível:
              </span>
              <span className="text-xs text-vapor-200 font-medium">
                {info.proximoPlano}
              </span>
            </div>
          </div>
        </div>

        {/* Rodapé com Ações */}
        <div className="p-6 pt-3 border-t border-graphite-800 flex flex-col-reverse sm:flex-row items-center justify-end gap-3">
          <Button
            variant="secondary"
            onClick={onClose}
            className="w-full sm:w-auto text-xs uppercase tracking-wider"
          >
            Entendi, Fechar
          </Button>

          <Button
            variant="primary"
            onClick={handleIrParaPlanos}
            className="w-full sm:w-auto flex items-center justify-center gap-2 text-xs uppercase tracking-wider shadow-lg shadow-amber-500/20"
          >
            <Sparkles size={14} />
            <span>Fazer Upgrade Agora</span>
            <ArrowRight size={14} />
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
};
