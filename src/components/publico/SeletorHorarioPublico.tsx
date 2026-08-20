import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { montarTimestampLocal } from '../../utils/datas';
import { AlertTriangle, Clock } from 'lucide-react';
import { AvisoPernoite } from '../compartilhado/AvisoPernoite';
import { traduzirMotivoIndisponivel } from '../../utils/agenda';

export interface ItemAgendamentoPublico {
  servico_id: string;
  combo_id?: string | null;
}

export interface SlotHorarioPublico {
  horario: string;
  disponivel: boolean;
  motivo_indisponivel?: string;
  motivo?: string;
  termino_previsto?: string;
  transborda?: boolean;
}

interface SeletorHorarioPublicoProps {
  tenantId: string;
  categoriaId: string | null;
  itens: ItemAgendamentoPublico[];
  dataSelecionada: string;
  setDataSelecionada: (data: string) => void;
  horarioSelecionado: string;
  setHorarioSelecionado: (horario: string) => void;
  onSlotSelecionadoObj?: (slot: SlotHorarioPublico | null) => void;
  politicaCancelamento?: string | null;
  aceiteCheck?: boolean;
  onAceiteChange?: (checked: boolean) => void;
  theme?: 'amber' | 'emerald';
}

export const SeletorHorarioPublico: React.FC<SeletorHorarioPublicoProps> = ({
  tenantId,
  categoriaId,
  itens,
  dataSelecionada,
  setDataSelecionada,
  horarioSelecionado,
  setHorarioSelecionado,
  onSlotSelecionadoObj,
  politicaCancelamento,
  aceiteCheck = false,
  onAceiteChange,
  theme = 'amber'
}) => {
  const [slots, setSlots] = useState<SlotHorarioPublico[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [erro, setErro] = useState<string | null>(null);

  // Define data inicial padrão como Hoje caso nenhuma esteja selecionada
  useEffect(() => {
    if (!dataSelecionada) {
      const d = new Date();
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      setDataSelecionada(`${yyyy}-${mm}-${dd}`);
    }
  }, [dataSelecionada, setDataSelecionada]);

  // Lista dos próximos 30 dias futuros (formato local YYYY-MM-DD)
  const proximosDias = Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const diaSemana = d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase();
    const diaMes = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return { dateStr, diaSemana, diaMes, isHoje: i === 0 };
  });

  // Carrega horários disponíveis diretamente da RPC
  useEffect(() => {
    if (!tenantId || !dataSelecionada || !itens || itens.length === 0) {
      setSlots([]);
      return;
    }

    const fetchHorarios = async () => {
      setLoading(true);
      setErro(null);

      // Prepara os itens para a RPC (garantindo servico_id e combo_id no payload jsonb)
      const payloadItens = itens.map((item) => ({
        servico_id: item.servico_id,
        combo_id: item.combo_id || null
      }));

      try {
        console.log('[SeletorHorarioPublico] Chamando RPC horarios_disponiveis:', {
          p_tenant: tenantId,
          p_data: dataSelecionada,
          p_itens: payloadItens,
          p_categoria: categoriaId
        });

        const { data, error } = await supabase.rpc('horarios_disponiveis', {
          p_tenant: tenantId,
          p_data: dataSelecionada,
          p_itens: payloadItens,
          p_categoria: categoriaId || null
        });

        if (error) throw error;

        console.log('[SeletorHorarioPublico] Retorno RPC horarios_disponiveis:', data);

        const slotsFormatados: SlotHorarioPublico[] = (data || []).map((s: any) => ({
          horario: s.horario,
          disponivel: !!s.disponivel,
          motivo_indisponivel: s.motivo || s.motivo_indisponivel,
          termino_previsto: s.termino_previsto,
          transborda: s.transborda
        }));

        setSlots(slotsFormatados);
      } catch (err: any) {
        console.error('[SeletorHorarioPublico] Erro na RPC horarios_disponiveis:', err);
        setErro(err.message || 'Erro ao carregar horários.');
        setSlots([]);
      } finally {
        setLoading(false);
      }
    };

    fetchHorarios();
  }, [tenantId, dataSelecionada, categoriaId, JSON.stringify(itens)]);

  // Notifica o componente pai sobre a alteração do slot selecionado
  useEffect(() => {
    if (onSlotSelecionadoObj) {
      const slotEncontrado = slots.find((s) => s.horario === horarioSelecionado) || null;
      onSlotSelecionadoObj(slotEncontrado);
    }
  }, [horarioSelecionado, slots, onSlotSelecionadoObj]);

  // Estilos dinâmicos de acordo com o tema selecionado
  const isEmerald = theme === 'emerald';
  const accentBorder = isEmerald ? 'border-emerald-500' : 'border-amber-500';
  const accentBg = isEmerald ? 'bg-emerald-500 text-slate-950 font-bold' : 'bg-amber-500 text-graphite-950 font-bold';
  const accentText = isEmerald ? 'text-emerald-400' : 'text-amber-400';
  const activeBtnClass = isEmerald
    ? 'bg-emerald-500 text-slate-950 border-emerald-400 font-bold shadow-md scale-105'
    : 'bg-amber-500 text-graphite-950 border-amber-400 font-bold shadow-md scale-105';

  const slotSelecionadoObj = slots.find((s) => s.horario === horarioSelecionado);
  const inicioIso = montarTimestampLocal(dataSelecionada, horarioSelecionado);

  return (
    <div className="flex flex-col gap-5">
      {/* 1. SELEÇÃO DE DIA */}
      <div className="flex flex-col gap-2">
        <label className="font-mono text-[12px] text-slate-400 uppercase tracking-wider font-bold flex items-center gap-1.5">
          <Clock className={`w-3.5 h-3.5 ${accentText}`} />
          <span>1. Escolha o dia</span>
        </label>

        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
          {proximosDias.map((d) => {
            const isSelected = dataSelecionada === d.dateStr;
            return (
              <button
                key={d.dateStr}
                type="button"
                onClick={() => {
                  setDataSelecionada(d.dateStr);
                  setHorarioSelecionado('');
                }}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border font-mono transition-all shrink-0 min-w-[70px] min-h-[64px] ${
                  isSelected
                    ? accentBg + ' ' + accentBorder + ' shadow-lg scale-105'
                    : 'bg-slate-950 hover:bg-slate-900 border-slate-800 text-slate-300'
                }`}
              >
                <span className="text-[10px] uppercase">{d.diaSemana}</span>
                <span className="text-[16px] font-bold">{d.diaMes}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. SELEÇÃO DE HORÁRIO DISPONÍVEL */}
      {dataSelecionada && (
        <div className="flex flex-col gap-2 pt-1">
          <label className="font-mono text-[12px] text-slate-400 uppercase tracking-wider font-bold flex items-center gap-1.5">
            <Clock className={`w-3.5 h-3.5 ${accentText}`} />
            <span>2. Escolha o horário de entrada</span>
          </label>

          {loading ? (
            <div className="flex items-center gap-2 py-6 text-slate-400 font-sans text-[13px]">
              <div className={`w-4 h-4 border-2 ${accentText} border-t-transparent rounded-full animate-spin`} />
              <span>Verificando agenda disponível...</span>
            </div>
          ) : erro ? (
            <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 font-sans text-[13px] flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{erro}</span>
            </div>
          ) : slots.length === 0 ? (
            <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 text-slate-400 font-sans text-[13px]">
              Nenhum horário disponível para a data selecionada. Escolha outro dia acima.
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2.5">
              {slots.map((s) => {
                const isSelected = horarioSelecionado === s.horario;
                const horaCurta = s.horario.substring(0, 5);

                if (!s.disponivel) {
                  const motivoTraduzido = traduzirMotivoIndisponivel(s.motivo_indisponivel || s.motivo);
                  return (
                    <div
                      key={s.horario}
                      className="p-3 rounded-xl border border-slate-800/60 bg-slate-950/40 text-slate-600 font-mono text-[13px] text-center opacity-40 select-none cursor-not-allowed min-h-[48px] flex items-center justify-center"
                      title={motivoTraduzido ? `Indisponível: ${motivoTraduzido}` : 'Horário indisponível'}
                    >
                      {horaCurta}
                    </div>
                  );
                }

                return (
                  <button
                    key={s.horario}
                    type="button"
                    onClick={() => setHorarioSelecionado(s.horario)}
                    className={`p-3 rounded-xl border font-mono text-[14px] font-bold transition-all min-h-[48px] flex items-center justify-center ${
                      isSelected
                        ? activeBtnClass
                        : 'bg-slate-950 hover:bg-slate-900 border-slate-700 ' + accentText
                    }`}
                  >
                    {horaCurta}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* AVISO DE TRANSBORDO / PERNOITE SE HOUVER */}
      {dataSelecionada && horarioSelecionado && slotSelecionadoObj?.termino_previsto && (
        <AvisoPernoite
          inicioISO={inicioIso}
          terminoPrevistoISO={slotSelecionadoObj.termino_previsto}
          mode="publico"
          politicaCancelamento={politicaCancelamento}
          aceiteCheck={aceiteCheck}
          onAceiteChange={onAceiteChange}
          theme={theme}
        />
      )}
    </div>
  );
};
