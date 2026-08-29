import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  CheckCheck,
  CheckCircle2,
  Calendar,
  MessageSquare,
  AlertTriangle,
  TrendingDown,
  Building2,
  Info,
  Clock,
  X,
  ChevronRight
} from 'lucide-react';
import { useNotificacoes } from '../../contexts/NotificacoesContext';
import type { ItemNotificacao, TipoNotificacao } from '../../types/notificacao';

interface CentralNotificacoesMenuProps {
  align?: 'left' | 'right';
  className?: string;
}

export const CentralNotificacoesMenu: React.FC<CentralNotificacoesMenuProps> = ({
  align = 'right',
  className = '',
}) => {
  const navigate = useNavigate();
  const { notificacoes, naoLidasCount, marcarComoLida, marcarTodasComoLidas } = useNotificacoes();

  const [isOpen, setIsOpen] = useState(false);
  const [abaAtiva, setAbaAtiva] = useState<'todas' | 'nao_lidas'>('todas');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fechar ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const notificacoesFiltradas = notificacoes.filter((n) => {
    if (abaAtiva === 'nao_lidas') return !n.lida;
    return true;
  });

  const getIconeTipo = (tipo: TipoNotificacao) => {
    switch (tipo) {
      case 'orcamento_aprovado':
        return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
      case 'agendamento_novo':
        return <Calendar className="w-4 h-4 text-amber-400 shrink-0" />;
      case 'feedback_respondido':
        return <MessageSquare className="w-4 h-4 text-sky-400 shrink-0" />;
      case 'feedback_novo':
        return <MessageSquare className="w-4 h-4 text-amber-400 shrink-0" />;
      case 'erro_sistema':
        return <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />;
      case 'downgrade_oficina':
        return <TrendingDown className="w-4 h-4 text-rose-400 shrink-0" />;
      case 'nova_oficina':
        return <Building2 className="w-4 h-4 text-emerald-400 shrink-0" />;
      default:
        return <Info className="w-4 h-4 text-vapor-400 shrink-0" />;
    }
  };

  const handleItemClick = (item: ItemNotificacao) => {
    if (!item.lida) {
      marcarComoLida(item.id);
    }
    setIsOpen(false);
    if (item.link) {
      navigate(item.link);
    }
  };

  const formatarTempo = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMins < 1) return 'Agora';
      if (diffMins < 60) return `${diffMins}m atrás`;
      if (diffHours < 24) return `${diffHours}h atrás`;
      if (diffDays === 1) return 'Ontem';
      if (diffDays < 7) return `${diffDays}d atrás`;
      return date.toLocaleDateString('pt-BR');
    } catch {
      return '';
    }
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Botão do Sino */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Notificações"
        title="Central de Notificações"
        className="relative p-2 rounded-lg text-vapor-300 hover:text-amber-400 hover:bg-graphite-800 transition-colors flex items-center justify-center min-w-[40px] min-h-[40px]"
      >
        <Bell size={20} className={isOpen ? 'text-amber-500' : 'text-vapor-300'} />
        {naoLidasCount > 0 && (
          <span className="absolute top-1.5 right-1.5 flex items-center justify-center min-w-[17px] h-[17px] px-1 bg-amber-500 text-graphite-950 text-[10px] font-black rounded-full shadow-sm animate-pulse">
            {naoLidasCount > 99 ? '99+' : naoLidasCount}
          </span>
        )}
      </button>

      {/* Dropdown Popover */}
      {isOpen && (
        <div
          className={`fixed sm:absolute top-[64px] sm:top-full mt-1.5 ${
            align === 'right' ? 'right-2 sm:right-0' : 'left-2 sm:left-0'
          } w-[calc(100vw-16px)] sm:w-96 max-w-[380px] bg-graphite-900 border border-graphite-700 rounded-2xl shadow-2xl z-50 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150`}
        >
          {/* Header do Popover */}
          <div className="p-3.5 border-b border-graphite-700/80 flex items-center justify-between bg-graphite-800/60">
            <div className="flex items-center gap-2">
              <Bell size={16} className="text-amber-500" />
              <h3 className="font-display text-sm font-bold text-vapor-100 tracking-wide">
                Notificações
              </h3>
              {naoLidasCount > 0 && (
                <span className="text-[10px] font-mono font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.2 rounded-full">
                  {naoLidasCount} nova{naoLidasCount > 1 ? 's' : ''}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              {naoLidasCount > 0 && (
                <button
                  type="button"
                  onClick={marcarTodasComoLidas}
                  className="text-[11px] text-vapor-400 hover:text-amber-400 flex items-center gap-1 px-2 py-1 rounded hover:bg-graphite-700/50 transition-colors"
                  title="Marcar todas como lidas"
                >
                  <CheckCheck size={14} />
                  <span>Ler todas</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1 text-vapor-400 hover:text-vapor-100 rounded hover:bg-graphite-700/50"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Abas: Todas vs Não Lidas */}
          <div className="flex border-b border-graphite-700/60 bg-graphite-950/40 text-xs">
            <button
              type="button"
              onClick={() => setAbaAtiva('todas')}
              className={`flex-1 py-2 font-medium transition-colors border-b-2 ${
                abaAtiva === 'todas'
                  ? 'border-amber-500 text-amber-400 font-bold bg-graphite-800/40'
                  : 'border-transparent text-vapor-400 hover:text-vapor-200'
              }`}
            >
              Todas ({notificacoes.length})
            </button>
            <button
              type="button"
              onClick={() => setAbaAtiva('nao_lidas')}
              className={`flex-1 py-2 font-medium transition-colors border-b-2 ${
                abaAtiva === 'nao_lidas'
                  ? 'border-amber-500 text-amber-400 font-bold bg-graphite-800/40'
                  : 'border-transparent text-vapor-400 hover:text-vapor-200'
              }`}
            >
              Não lidas ({naoLidasCount})
            </button>
          </div>

          {/* Lista de Notificações */}
          <div className="max-h-[380px] overflow-y-auto divide-y divide-graphite-800/60 custom-scrollbar">
            {notificacoesFiltradas.length === 0 ? (
              <div className="p-8 text-center flex flex-col items-center justify-center gap-2 text-vapor-400">
                <CheckCircle2 size={32} className="text-graphite-600 mb-1" />
                <span className="text-xs font-semibold text-vapor-300">Tudo em dia!</span>
                <p className="text-[11px] text-vapor-500 max-w-xs">
                  {abaAtiva === 'nao_lidas'
                    ? 'Você não possui notificações não lidas no momento.'
                    : 'Nenhum evento recente registrado.'}
                </p>
              </div>
            ) : (
              notificacoesFiltradas.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleItemClick(item)}
                  className={`p-3 sm:p-3.5 transition-colors cursor-pointer flex items-start gap-3 hover:bg-graphite-800/60 group ${
                    !item.lida ? 'bg-amber-500/5' : 'bg-transparent'
                  }`}
                >
                  <div className="p-2 rounded-lg bg-graphite-800 border border-graphite-700/60 shrink-0 mt-0.5">
                    {getIconeTipo(item.tipo)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <h4
                        className={`text-xs font-bold truncate ${
                          !item.lida ? 'text-amber-400' : 'text-vapor-200'
                        }`}
                      >
                        {item.titulo}
                      </h4>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] font-mono text-vapor-500 flex items-center gap-1">
                          <Clock size={10} />
                          {formatarTempo(item.created_at)}
                        </span>
                        {!item.lida && (
                          <span className="w-2 h-2 rounded-full bg-amber-500 shadow-sm" />
                        )}
                      </div>
                    </div>

                    <p className="text-[11.5px] text-vapor-400 leading-snug line-clamp-2">
                      {item.mensagem}
                    </p>

                    {item.link && (
                      <div className="mt-1 flex items-center gap-1 text-[10px] text-amber-400/80 font-medium group-hover:text-amber-400">
                        <span>Ver detalhes</span>
                        <ChevronRight size={12} />
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
