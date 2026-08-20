import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissao } from '../../hooks/usePermissao';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { ServiceChip } from '../ui/ServiceChip';
import { EmptyState } from '../ui/EmptyState';
import { Wrench, Clock, ChevronRight } from 'lucide-react';
import type { Agendamento } from '../../types/agenda';
import { getLabelFromStatus, getBadgeToneFromStatus } from '../../utils/agenda';
import { formatarData, formatarHora } from '../../utils/datas';
import { formatarOS, formatarMoeda } from '../../utils/formatters';
import { navegarParaAtendimento } from '../../utils/navegacaoAtendimento';

interface HistoricoServicosProps {
  clienteId?: string;
  veiculoId?: string;
  modo: 'cliente' | 'veiculo';
}

export const HistoricoServicos: React.FC<HistoricoServicosProps> = ({
  clienteId,
  veiculoId,
  modo,
}) => {
  const navigate = useNavigate();
  const { tenant } = useAuth();
  const { podeVerValor } = usePermissao();

  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchHistorico = async () => {
    if (!tenant) return;
    setLoading(true);

    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('buscar_agendamentos', {
        p_tenant: tenant.id,
        p_inicio: null,
        p_fim: null,
        p_status: null,
        p_busca: null,
        p_cliente_id: clienteId || null,
        p_veiculo_id: veiculoId || null,
        p_limite: 100,
        p_offset: 0,
      });

      if (!rpcError && rpcData) {
        setAgendamentos(rpcData as unknown as Agendamento[]);
      } else {
        // Fallback em caso de erro na RPC
        let query = supabase
          .from('agendamentos')
          .select(`
            *,
            cliente:clientes(id, nome, telefone),
            veiculo:veiculos(id, placa, modelo, marca),
            servico:servicos(id, nome, codigo, tom, grupo),
            categoria:categorias_veiculo(id, nome),
            agendamento_itens(
              id,
              duracao_minutos,
              preco_estimado,
              servicos(id, nome, codigo, tom, grupo)
            ),
            execucao:execucoes(id, status, valor_total_final, finalizado_em)
          `)
          .eq('tenant_id', tenant.id)
          .order('inicio', { ascending: false });

        if (modo === 'cliente' && clienteId) {
          query = query.eq('cliente_id', clienteId);
        } else if (modo === 'veiculo' && veiculoId) {
          query = query.eq('veiculo_id', veiculoId);
        }

        const { data: fallbackData } = await query;
        if (fallbackData) {
          setAgendamentos(fallbackData as Agendamento[]);
        }
      }
    } catch (err) {
      console.error('[HistoricoServicos] Erro ao carregar histórico:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistorico();
  }, [tenant, clienteId, veiculoId, modo]);

  // Cálculos do Resumo no topo
  const totalAtendimentos = agendamentos.length;
  
  // Data do último atendimento
  const ultimoAtendimento = agendamentos.length > 0 && agendamentos[0].inicio 
    ? formatarData(agendamentos[0].inicio)
    : null;

  // Total gasto (apenas concluídos e com permissão)
  const totalGasto = agendamentos.reduce((sum, ag) => {
    if (ag.status === 'concluido') {
      const valor = ag.execucao?.valor_total_final 
        ?? ag.preco_estimado_total 
        ?? ag.preco_estimado 
        ?? 0;
      return sum + Number(valor);
    }
    return sum;
  }, 0);

  if (loading) {
    return (
      <div className="flex flex-col gap-3 py-6">
        <div className="h-6 bg-graphite-700 rounded w-1/3 animate-pulse" />
        <div className="h-24 bg-graphite-800 rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header da Seção de Histórico */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-graphite-800 pb-3">
        <h3 className="font-display text-[18px] text-vapor-100 uppercase tracking-wide flex items-center gap-2">
          <Wrench size={20} className="text-amber-500" />
          <span>Histórico de Serviços</span>
        </h3>

        {/* RESUMO NO TOPO DO HISTÓRICO */}
        {totalAtendimentos > 0 && (
          <div className="flex items-center gap-2 flex-wrap font-mono text-[12px] text-vapor-300 bg-graphite-900 px-3 py-1.5 rounded-lg border border-graphite-800">
            <span>
              <strong>{totalAtendimentos}</strong> {totalAtendimentos === 1 ? 'atendimento' : 'atendimentos'}
            </span>
            {ultimoAtendimento && (
              <>
                <span className="text-graphite-600">•</span>
                <span>último em <strong>{ultimoAtendimento}</strong></span>
              </>
            )}
            {podeVerValor() && (
              <>
                <span className="text-graphite-600">•</span>
                <span className="text-emerald-400 font-bold">
                  Total gasto: {formatarMoeda(totalGasto)}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Lista de Atendimentos */}
      {agendamentos.length === 0 ? (
        <EmptyState
          icon={<Wrench size={40} strokeWidth={1.5} />}
          title="Nenhum serviço registrado."
          description={
            modo === 'cliente'
              ? 'O histórico de atendimentos deste cliente aparecerá aqui.'
              : 'O histórico de atendimentos deste veículo aparecerá aqui.'
          }
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {agendamentos.map((ag) => {
            const isCancelado = ag.status === 'cancelado' || ag.status === 'nao_compareceu';
            const isConcluido = ag.status === 'concluido';

            const firstServ = ag.agendamento_itens?.[0]?.servicos || ag.servico;
            const extraCount = Math.max(0, (ag.agendamento_itens?.length || 1) - 1);
            const tempoMin = ag.duracao_total || ag.duracao_minutos || 0;

            const valorCobrado = ag.execucao?.valor_total_final 
              ?? ag.preco_estimado_total 
              ?? ag.preco_estimado;

            // Estilos visuais por status
            let cardBgStyle = 'bg-graphite-900 border-graphite-700 text-vapor-100 hover:border-amber-500/50';
            if (isConcluido) {
              cardBgStyle = 'bg-graphite-900/90 border-emerald-500/30 text-vapor-100 hover:border-emerald-500/60';
            } else if (isCancelado) {
              cardBgStyle = 'bg-graphite-950/40 border-graphite-800/80 text-vapor-500 opacity-60';
            }

            return (
              <Card
                key={ag.id}
                onClick={() => navegarParaAtendimento(navigate, (ag as any).execucao_id, ag.id)}
                className={`p-3.5 cursor-pointer transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 group ${cardBgStyle}`}
              >
                {/* Lado Esquerdo: OS, Data/Hora, Veículo/Cliente */}
                <div className="flex items-center gap-3">
                  <div className="flex flex-col items-center justify-center bg-graphite-800 px-3 py-1.5 rounded border border-graphite-700 shrink-0 min-w-[75px]">
                    <span className="font-mono text-[12px] font-bold text-amber-400">
                      {formatarOS(ag.numero_os)}
                    </span>
                    <span className="font-mono text-[10px] text-vapor-400">
                      {ag.inicio ? formatarData(ag.inicio) : 'Sem data'}
                    </span>
                  </div>

                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Na página do cliente, exibe o veículo. Na página do veículo, exibe o cliente. */}
                      {modo === 'cliente' ? (
                        <span className={`font-mono text-[14px] font-bold ${isCancelado ? 'line-through text-vapor-500' : 'text-vapor-100 group-hover:text-amber-400'}`}>
                          {ag.veiculo ? `${ag.veiculo.placa} (${ag.veiculo.modelo || 'Sem modelo'})` : 'Sem veículo'}
                        </span>
                      ) : (
                        <span className={`font-sans text-[14px] font-bold ${isCancelado ? 'line-through text-vapor-500' : 'text-vapor-100 group-hover:text-amber-400'}`}>
                          {ag.cliente?.nome || 'Cliente não informado'}
                        </span>
                      )}

                      {ag.inicio && (
                        <span className="font-mono text-[11px] text-vapor-400">
                          às {formatarHora(ag.inicio)}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-[12px] text-vapor-400 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Clock size={12} />
                        {tempoMin} min
                      </span>

                      {modo === 'cliente' && ag.cliente?.nome && (
                        <>
                          <span className="text-graphite-600">•</span>
                          <span className="truncate max-w-[200px]">{ag.cliente.nome}</span>
                        </>
                      )}

                      {modo === 'veiculo' && ag.veiculo?.placa && (
                        <>
                          <span className="text-graphite-600">•</span>
                          <span className="font-mono">{ag.veiculo.placa}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Lado Direito: Chips de Serviços, Status, Valor e Setinha */}
                <div className="flex items-center gap-2.5 shrink-0 justify-between sm:justify-end flex-wrap">
                  <div className="flex items-center gap-1">
                    <ServiceChip
                      code={firstServ?.codigo || 'SV'}
                      label={firstServ?.nome || 'Serviço'}
                      tone={firstServ?.tom as any || 'vapor'}
                    />
                    {extraCount > 0 && (
                      <span className="bg-graphite-800 text-amber-400 border border-graphite-700 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded">
                        +{extraCount}
                      </span>
                    )}
                  </div>

                  <Badge tone={getBadgeToneFromStatus(ag.status)}>
                    {getLabelFromStatus(ag.status)}
                  </Badge>

                  {/* Valor Cobrado (Apenas concluído e podeVerValor) */}
                  {isConcluido && podeVerValor() && (
                    <span className="font-mono text-[13px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded">
                      {formatarMoeda(valorCobrado)}
                    </span>
                  )}

                  <ChevronRight size={16} className="text-vapor-500 group-hover:text-amber-400 transition-colors hidden sm:block" />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};
