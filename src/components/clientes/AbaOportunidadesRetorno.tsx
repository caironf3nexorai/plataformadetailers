import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { ModalConfigRegrasRetorno } from './ModalConfigRegrasRetorno';
import type { OportunidadeRetorno } from '../../types/oportunidades';
import { formatarMoeda } from '../../utils/formatters';
import { formatarData } from '../../utils/datas';
import { montarLinkWhatsapp } from '../../utils/whatsapp';
import { 
  Settings2, 
  Search, 
  MessageCircle, 
  Car, 
  AlertCircle, 
  Clock, 
  TrendingUp, 
  CheckCircle2, 
  CalendarPlus,
  RefreshCw,
  Sparkles
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface AbaOportunidadesRetornoProps {
  onTotalOportunidadesChange?: (total: number) => void;
}

export const AbaOportunidadesRetorno: React.FC<AbaOportunidadesRetornoProps> = ({
  onTotalOportunidadesChange
}) => {
  const navigate = useNavigate();
  const [oportunidades, setOportunidades] = useState<OportunidadeRetorno[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState<'acao_necessaria' | 'vencidas' | 'proximas'>('acao_necessaria');
  const [busca, setBusca] = useState('');
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [contatadosMap, setContatadosMap] = useState<Record<string, boolean>>({});

  const carregarOportunidades = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('obter_oportunidades_retorno', {
        p_filtro: filtroStatus
      });

      if (error) throw error;

      const lista = (data as OportunidadeRetorno[]) || [];
      setOportunidades(lista);

      if (onTotalOportunidadesChange) {
        onTotalOportunidadesChange(lista.length);
      }

      // Também aciona a verificação diária de notificações em segundo plano
      try {
        await supabase.rpc('gerar_notificacoes_retorno_diarias');
      } catch {
        // ignora se a função ainda não existir ou falhar em segundo plano
      }
    } catch (err) {
      console.error('Erro ao carregar oportunidades de retorno:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarOportunidades();
  }, [filtroStatus]);

  const handleContatarWhatsApp = async (op: OportunidadeRetorno) => {
    if (!op.cliente_telefone) {
      alert('Este cliente não possui telefone cadastrado.');
      return;
    }

    // Registra no histórico do banco
    try {
      await supabase.rpc('registrar_contato_retorno', {
        p_cliente_id: op.cliente_id,
        p_veiculo_id: op.veiculo_id || null,
        p_regra_id: op.regra_id || null,
        p_observacao: `Mensagem de retorno enviada via WhatsApp (${op.regra_titulo})`
      });

      setContatadosMap(prev => ({
        ...prev,
        [`${op.cliente_id}_${op.veiculo_id}`]: true
      }));
    } catch (err) {
      console.error('Erro ao registrar contato:', err);
    }

    // Abre link do WhatsApp com a mensagem pronta
    const link = montarLinkWhatsapp(op.cliente_telefone, op.mensagem_whatsapp_formatada);
    if (link) {
      window.open(link, '_blank');
    }
  };

  // Métricas calculadas
  const totalVencidas = oportunidades.filter(o => o.status_retorno === 'vencido').length;
  const totalProximas = oportunidades.filter(o => o.status_retorno === 'proximo').length;
  const valorPotencialTotal = oportunidades.reduce((acc, o) => acc + (Number(o.valor_servico) || 0), 0);

  // Filtro de busca local
  const oportunidadesFiltradas = oportunidades.filter(o => {
    if (!busca.trim()) return true;
    const q = busca.toLowerCase();
    return (
      o.cliente_nome?.toLowerCase().includes(q) ||
      o.cliente_telefone?.includes(q) ||
      o.veiculo_modelo?.toLowerCase().includes(q) ||
      o.veiculo_placa?.toLowerCase().includes(q) ||
      o.servico_nome?.toLowerCase().includes(q) ||
      o.regra_titulo?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-5">
      {/* 1. CARDS DE RESUMO & MÉTRICAS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        {/* Vencidas */}
        <div className="bg-graphite-900 border border-rose-500/20 rounded-xl p-4 flex items-center justify-between shadow-sm">
          <div className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
              Manutenções Vencidas
            </span>
            <div className="text-2xl font-black text-white font-mono">{totalVencidas}</div>
            <p className="text-[10px] text-vapor-400">Clientes com prazo estourado</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
            <AlertCircle size={20} />
          </div>
        </div>

        {/* Próximas na Semana */}
        <div className="bg-graphite-900 border border-amber-500/20 rounded-xl p-4 flex items-center justify-between shadow-sm">
          <div className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
              <Clock size={12} className="text-amber-400" />
              Vencendo em 7 Dias
            </span>
            <div className="text-2xl font-black text-white font-mono">{totalProximas}</div>
            <p className="text-[10px] text-vapor-400">Momento ideal para agendar</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <Clock size={20} />
          </div>
        </div>

        {/* Potencial Estimado */}
        <div className="bg-graphite-900 border border-emerald-500/20 rounded-xl p-4 flex items-center justify-between shadow-sm">
          <div className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
              <TrendingUp size={12} className="text-emerald-400" />
              Faturamento Recuperável
            </span>
            <div className="text-2xl font-black text-emerald-300 font-mono">
              {formatarMoeda(valorPotencialTotal)}
            </div>
            <p className="text-[10px] text-vapor-400">Receita estimada em manutenções</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <Sparkles size={20} />
          </div>
        </div>
      </div>

      {/* 2. BARRA DE FERRAMENTAS E FILTROS */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-graphite-900/60 p-3 rounded-xl border border-graphite-800">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          <button
            type="button"
            onClick={() => setFiltroStatus('acao_necessaria')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition border ${
              filtroStatus === 'acao_necessaria'
                ? 'bg-amber-500 text-slate-950 border-amber-500 font-bold shadow-sm'
                : 'bg-graphite-900 text-vapor-300 border-graphite-700 hover:text-white'
            }`}
          >
            Ação Necessária ({totalVencidas + totalProximas})
          </button>

          <button
            type="button"
            onClick={() => setFiltroStatus('vencidas')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition border ${
              filtroStatus === 'vencidas'
                ? 'bg-rose-500 text-white border-rose-500 font-bold shadow-sm'
                : 'bg-graphite-900 text-vapor-300 border-graphite-700 hover:text-white'
            }`}
          >
            🔴 Vencidas ({totalVencidas})
          </button>

          <button
            type="button"
            onClick={() => setFiltroStatus('proximas')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition border ${
              filtroStatus === 'proximas'
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold shadow-sm'
                : 'bg-graphite-900 text-vapor-300 border-graphite-700 hover:text-white'
            }`}
          >
            🟡 Próximas 7 Dias ({totalProximas})
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-60">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-vapor-400" />
            <input
              type="text"
              placeholder="Buscar cliente, carro ou placa..."
              value={busca}
              onChange={e => setBusca(e.target.value)}
              className="w-full bg-graphite-950 border border-graphite-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder:text-vapor-500 focus:outline-none focus:border-amber-500"
            />
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setShowConfigModal(true)}
            className="text-xs flex items-center gap-1.5 whitespace-nowrap"
            title="Configurar periodicidade de dias para cada serviço"
          >
            <Settings2 size={14} className="text-amber-400" />
            <span className="hidden sm:inline">Prazos & Regras</span>
          </Button>

          <button
            type="button"
            onClick={carregarOportunidades}
            title="Atualizar lista"
            className="p-2 text-vapor-400 hover:text-white bg-graphite-800 hover:bg-graphite-700 rounded-lg transition"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* 3. LISTAGEM DE OPORTUNIDADES */}
      {loading ? (
        <div className="bg-graphite-900 border border-graphite-800 rounded-2xl p-12 text-center text-vapor-400">
          <div className="animate-spin rounded-full h-7 w-7 border-2 border-amber-500/20 border-t-amber-500 mx-auto mb-3" />
          <p className="text-xs">Consultando histórico de atendimentos e calculando manutenções...</p>
        </div>
      ) : oportunidadesFiltradas.length === 0 ? (
        <Card className="p-8 text-center bg-graphite-900/60 border-graphite-800">
          <div className="max-w-sm mx-auto space-y-3">
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mx-auto">
              <CheckCircle2 size={24} />
            </div>
            <h3 className="font-bold text-white text-base">Tudo em dia!</h3>
            <p className="text-xs text-vapor-400 leading-relaxed">
              Nenhum cliente com manutenção pendente ou vencendo nos prazos configurados. Seus clientes estão em dia ou os atendimentos ainda são recentes.
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setShowConfigModal(true)}
              className="text-xs"
            >
              Ajustar Prazos de Retorno
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {oportunidadesFiltradas.map((op) => {
            const key = `${op.cliente_id}_${op.veiculo_id}`;
            const jaContatado = contatadosMap[key] || Boolean(op.ultimo_contato_em);
            const isVencido = op.status_retorno === 'vencido';

            return (
              <div
                key={key}
                className={`p-4 rounded-xl border transition flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm ${
                  isVencido
                    ? 'bg-graphite-900/90 border-rose-500/30 hover:border-rose-500/50'
                    : 'bg-graphite-900/90 border-amber-500/20 hover:border-amber-500/40'
                }`}
              >
                {/* Informações do Cliente & Veículo */}
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    isVencido
                      ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                      : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                  }`}>
                    <Car size={20} />
                  </div>

                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-white text-sm truncate">
                        {op.cliente_nome}
                      </span>
                      {op.cliente_telefone && (
                        <span className="text-[11px] font-mono text-vapor-400">
                          ({op.cliente_telefone})
                        </span>
                      )}
                      
                      {/* Badge de Status */}
                      <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border uppercase ${
                        isVencido
                          ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                          : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                      }`}>
                        {isVencido
                          ? `Venceu há ${op.dias_passados - op.dias_retorno_configurado} dias`
                          : `Vence em ${op.dias_retorno_configurado - op.dias_passados} dias`}
                      </span>

                      {jaContatado && (
                        <span className="text-[10px] font-semibold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <CheckCircle2 size={10} />
                          Contatado
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-vapor-300 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-semibold text-white">
                        {op.veiculo_modelo || 'Veículo'} 
                        {op.veiculo_placa && <span className="text-amber-400 font-mono ml-1">[{op.veiculo_placa}]</span>}
                      </span>
                      <span>•</span>
                      <span className="text-vapor-400">
                        Último serviço: <strong className="text-vapor-200">{op.servico_nome}</strong> ({formatarData(op.data_servico)} — há {op.dias_passados} dias)
                      </span>
                      <span>•</span>
                      <span className="text-vapor-400">
                        Regra: <strong className="text-amber-400">{op.regra_titulo}</strong> ({op.dias_retorno_configurado} dias)
                      </span>
                    </div>

                    {/* Preview da Mensagem */}
                    <div className="p-2 bg-graphite-950 rounded-lg text-[11px] text-vapor-300 border border-graphite-800 italic line-clamp-1">
                      "{op.mensagem_whatsapp_formatada}"
                    </div>
                  </div>
                </div>

                {/* Botões de Ação */}
                <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => navigate(`/agenda?cliente_id=${op.cliente_id}&veiculo_id=${op.veiculo_id}`)}
                    className="text-xs flex items-center gap-1.5"
                    title="Abrir novo agendamento para este cliente"
                  >
                    <CalendarPlus size={14} />
                    <span className="hidden sm:inline">Agendar</span>
                  </Button>

                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => handleContatarWhatsApp(op)}
                    className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center gap-1.5 shadow-md shadow-emerald-950"
                  >
                    <MessageCircle size={14} />
                    <span>Contatar no WhatsApp</span>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de Configuração de Regras */}
      <ModalConfigRegrasRetorno
        isOpen={showConfigModal}
        onClose={() => setShowConfigModal(false)}
        onRegrasSalvas={carregarOportunidades}
      />
    </div>
  );
};
