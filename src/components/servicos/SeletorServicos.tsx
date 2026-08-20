import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Layers, Package, Sparkles, AlertTriangle } from 'lucide-react';
import { ServiceChip } from '../ui/ServiceChip';
import { formatarDuracao } from '../../utils/agenda';
import { formatValorMoeda } from '../../utils/precos';

export interface ItemSelecionado {
  servico_id: string;
  combo_id?: string | null;
  servico: any;
  comboNome?: string;
}

export interface SeletorServicosProps {
  categorias: any[];
  selectedCategoria: any | null;
  onSelectCategoria: (categoria: any) => void;
  servicos: any[];
  combos: any[];
  selectedItens: ItemSelecionado[];
  onToggleServico: (servico: any) => void;
  onToggleCombo: (combo: any) => void;
  onCloseModal?: () => void;
}

export const SeletorServicos: React.FC<SeletorServicosProps> = ({
  categorias,
  selectedCategoria,
  onSelectCategoria,
  servicos,
  combos,
  selectedItens,
  onToggleServico,
  onToggleCombo,
  onCloseModal,
}) => {
  const [servicoTab, setServicoTab] = useState<'servicos' | 'combos'>('servicos');

  // Grupos de serviços
  const gruposServicos: Record<string, any[]> = {};
  servicos.forEach((s) => {
    const grp = s.grupo || 'Outros';
    if (!gruposServicos[grp]) gruposServicos[grp] = [];
    gruposServicos[grp].push(s);
  });

  // Cálculos de Totais em Tempo Real
  let duracaoTotalSum = 0;
  let precoTotalSum = 0;
  let temDiaInteiro = false;
  const combosContabilizados = new Set<string>();

  selectedItens.forEach((item) => {
    const matchPreco = item.servico?.servico_precos?.find(
      (p: any) => p.categoria_id === selectedCategoria?.id
    );
    const dur = matchPreco?.duracao_minutos || item.servico?.duracao_minutos || 60;
    duracaoTotalSum += dur;

    if (item.servico?.modo_ocupacao === 'dia_inteiro') {
      temDiaInteiro = true;
    }

    if (item.combo_id) {
      if (!combosContabilizados.has(item.combo_id)) {
        combosContabilizados.add(item.combo_id);
        const comboObj = combos.find((c) => c.id === item.combo_id);
        const comboPrecoObj = comboObj?.combo_precos?.find(
          (cp: any) => cp.categoria_id === selectedCategoria?.id
        );
        if (comboPrecoObj && comboPrecoObj.preco_base !== null && comboPrecoObj.preco_base !== undefined) {
          precoTotalSum += Number(comboPrecoObj.preco_base);
        } else if (matchPreco && matchPreco.preco_base !== null && matchPreco.preco_base !== undefined) {
          precoTotalSum += Number(matchPreco.preco_base);
        }
      }
    } else {
      if (matchPreco && matchPreco.preco_base !== null && matchPreco.preco_base !== undefined) {
        precoTotalSum += Number(matchPreco.preco_base);
      }
    }
  });

  return (
    <div className="flex flex-col gap-4">
      {/* SELEÇÃO DE CATEGORIA POR BOTÕES (iOS SAFARI COMPATÍVEL) */}
      <div className="flex flex-col gap-2">
        <label className="font-sans text-[13px] text-vapor-300 font-medium">
          Categoria do Veículo:
        </label>
        <div className="flex flex-wrap gap-2">
          {categorias.map((cat) => {
            const isSelected = selectedCategoria?.id === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => onSelectCategoria(cat)}
                className={`px-4 py-2.5 rounded-lg border text-[13px] font-medium transition-all min-h-[48px] flex items-center justify-center ${
                  isSelected
                    ? 'bg-amber-500 text-graphite-950 border-amber-500 font-bold shadow-md'
                    : 'bg-graphite-800 text-vapor-200 border-graphite-700 hover:border-graphite-600'
                }`}
              >
                {cat.nome}
              </button>
            );
          })}
        </div>
      </div>

      {selectedCategoria && (
        <div className="flex flex-col gap-4 pt-2 border-t border-graphite-800">
          <div className="flex items-center justify-between">
            <span className="font-sans text-[13px] text-vapor-300 font-medium">
              Escolha os serviços para <strong className="text-amber-400">{selectedCategoria?.nome}</strong>:
            </span>
          </div>

          {/* Abas Serviços e Combos */}
          <div className="flex border-b border-graphite-700">
            <button
              type="button"
              onClick={() => setServicoTab('servicos')}
              className={`px-4 py-2 font-sans text-[13px] font-semibold flex items-center gap-2 border-b-2 transition-colors ${
                servicoTab === 'servicos'
                  ? 'border-amber-500 text-amber-400'
                  : 'border-transparent text-vapor-400 hover:text-vapor-200'
              }`}
            >
              <Layers size={16} />
              <span>Serviços ({servicos.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setServicoTab('combos')}
              className={`px-4 py-2 font-sans text-[13px] font-semibold flex items-center gap-2 border-b-2 transition-colors ${
                servicoTab === 'combos'
                  ? 'border-amber-500 text-amber-400'
                  : 'border-transparent text-vapor-400 hover:text-vapor-200'
              }`}
            >
              <Package size={16} />
              <span>Combos Promocionais ({combos.length})</span>
            </button>
          </div>

          {/* CONTEÚDO DA ABA SERVIÇOS */}
          {servicoTab === 'servicos' && (
            <div className="flex flex-col gap-4 max-h-64 overflow-y-auto pr-1">
              {Object.keys(gruposServicos).length === 0 ? (
                <div className="p-6 bg-graphite-800 rounded-lg border border-graphite-700 text-center flex flex-col items-center gap-3">
                  <span className="font-sans text-[13px] text-vapor-300">
                    Nenhum serviço cadastrado.
                  </span>
                  {onCloseModal && (
                    <Link to="/servicos" onClick={onCloseModal} className="text-amber-400 underline text-[12px]">
                      Ir para Cadastro de Serviços
                    </Link>
                  )}
                </div>
              ) : (
                Object.entries(gruposServicos).map(([grupoNome, servs]) => (
                  <div key={grupoNome} className="flex flex-col gap-2">
                    <span className="font-display text-[11px] text-vapor-400 uppercase tracking-wider font-bold">
                      {grupoNome}
                    </span>
                    {servs.map((serv) => {
                      const isSelected = selectedItens.some((i) => i.servico_id === serv.id);
                      const comboItem = selectedItens.find((i) => i.servico_id === serv.id && i.combo_id);
                      const matchPreco = serv.servico_precos?.find((p: any) => p.categoria_id === selectedCategoria?.id);

                      let precoDisplay = (
                        <span className="font-sans text-[11px] font-medium text-amber-500">
                          Preço não cadastrado
                        </span>
                      );
                      if (serv.sob_consulta) {
                        precoDisplay = <span className="font-sans text-[11px] font-medium text-amber-400">Sob consulta</span>;
                      } else if (matchPreco && matchPreco.preco_base !== null && matchPreco.preco_base !== undefined && Number(matchPreco.preco_base) > 0) {
                        precoDisplay = <span className="font-mono text-[12px] font-bold text-amber-400">R$ {formatValorMoeda(Number(matchPreco.preco_base))}</span>;
                      }

                      const durMin = matchPreco?.duracao_minutos || 60;

                      return (
                        <button
                          key={serv.id}
                          type="button"
                          onClick={() => onToggleServico(serv)}
                          className={`p-3 rounded-lg border text-left flex items-center justify-between transition-colors min-h-[52px] ${
                            isSelected
                              ? 'bg-amber-500/10 border-amber-500 text-vapor-100'
                              : 'bg-graphite-800 hover:bg-graphite-700 border-graphite-700 text-vapor-300'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {}}
                              className="w-5 h-5 accent-amber-500 rounded cursor-pointer shrink-0"
                            />
                            <div className="flex flex-col">
                              <div className="flex items-center gap-2 flex-wrap">
                                <ServiceChip code={serv.codigo || 'SV'} label={serv.nome} tone={serv.tom || 'vapor'} />
                                {comboItem && (
                                  <span className="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] px-1.5 py-0.5 rounded font-mono">
                                    Combo: {comboItem.comboNome}
                                  </span>
                                )}
                              </div>
                              <span className="font-sans text-[11px] text-vapor-400 mt-1">
                                Duração: {durMin} min
                              </span>
                            </div>
                          </div>

                          <div className="font-mono text-[13px] font-bold text-vapor-100 shrink-0 ml-2">
                            {precoDisplay}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          )}

          {/* CONTEÚDO DA ABA COMBOS */}
          {servicoTab === 'combos' && (
            <div className="flex flex-col gap-3 max-h-64 overflow-y-auto pr-1">
              {combos.length === 0 ? (
                <span className="text-[12px] text-vapor-400 text-center py-6">
                  Nenhum combo cadastrado nesta oficina.
                </span>
              ) : (
                combos.map((combo) => {
                  const comboServicoIds = (combo.combo_servicos || []).map((cs: any) => cs.servico_id);
                  const isSelected = comboServicoIds.length > 0 && comboServicoIds.every((id: string) => selectedItens.some((i) => i.servico_id === id && i.combo_id === combo.id));
                  const comboPrecoObj = combo.combo_precos?.find((cp: any) => cp.categoria_id === selectedCategoria?.id);
                  const comboPrecoStr = comboPrecoObj?.preco_base !== null && comboPrecoObj?.preco_base !== undefined
                    ? `R$ ${formatValorMoeda(Number(comboPrecoObj.preco_base))}`
                    : 'Preço sob consulta';

                  return (
                    <button
                      key={combo.id}
                      type="button"
                      onClick={() => onToggleCombo(combo)}
                      className={`p-3.5 rounded-lg border text-left flex flex-col gap-2 transition-colors ${
                        isSelected
                          ? 'bg-amber-500/10 border-amber-500 text-vapor-100'
                          : 'bg-graphite-800 hover:bg-graphite-700 border-graphite-700 text-vapor-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Sparkles size={16} className="text-amber-400 shrink-0" />
                          <span className="font-sans text-[14px] font-bold text-vapor-100">
                            {combo.nome}
                          </span>
                        </div>
                        <span className="font-mono text-[14px] font-bold text-amber-400">
                          {comboPrecoStr}
                        </span>
                      </div>

                      {combo.descricao_publica && (
                        <span className="font-sans text-[12px] text-vapor-400">
                          {combo.descricao_publica}
                        </span>
                      )}

                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {(combo.combo_servicos || []).map((cs: any) => (
                          <span key={cs.servico_id} className="bg-graphite-900 border border-graphite-700 text-vapor-300 text-[11px] px-2 py-0.5 rounded font-sans">
                            + {cs.servicos?.nome || 'Serviço'}
                          </span>
                        ))}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}

          {/* AVISO DE ATENDIMENTO DIA INTEIRO */}
          {temDiaInteiro && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center gap-2 text-amber-300 font-sans text-[12px]">
              <AlertTriangle size={18} className="shrink-0 text-amber-400" />
              <span>Este atendimento ocupará o dia inteiro.</span>
            </div>
          )}

          {/* PAINEL FIXO DE RESUMO DE SELEÇÃO */}
          <div className="p-4 bg-graphite-800 border border-amber-500/40 rounded-lg flex items-center justify-between shadow-lg">
            <div className="flex flex-col">
              <span className="font-sans text-[13px] font-bold text-vapor-100">
                {selectedItens.length} serviço{selectedItens.length !== 1 ? 's' : ''} selecionado{selectedItens.length !== 1 ? 's' : ''}
              </span>
              <span className="font-sans text-[11px] text-vapor-400">
                Duração total: <strong className="text-vapor-200">{formatarDuracao(duracaoTotalSum)}</strong>
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="font-sans text-[10px] text-vapor-400 uppercase tracking-wider">
                A partir de:
              </span>
              <span className="font-mono text-[16px] font-extrabold text-amber-400">
                R$ {formatValorMoeda(precoTotalSum)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
