import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Clock, Check, Wrench, Sparkles, Car } from 'lucide-react';
import type { CategoriaVeiculo } from '../../types/clientes';
import {
  type UnidadeDuracao,
  converterParaMinutos,
  converterDeMinutos,
  OPCOES_UNIDADE_DURACAO
} from '../../utils/duracao';

interface ModalServicoRapidoProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (novoServico: any) => void;
  categoriaVeiculoId?: string;
  categoriaVeiculoNome?: string;
}

export const ModalServicoRapido: React.FC<ModalServicoRapidoProps> = ({
  isOpen,
  onClose,
  onSuccess,
  categoriaVeiculoId,
  categoriaVeiculoNome,
}) => {
  const { tenant } = useAuth();
  const { showSuccess, showError } = useToast();

  const [nome, setNome] = useState('');
  const [grupo, setGrupo] = useState('Polimento');
  const [descricao, setDescricao] = useState('');
  const [saving, setSaving] = useState(false);

  // Categorias de Veículos do Tenant para Precificação Variável
  const [categorias, setCategorias] = useState<CategoriaVeiculo[]>([]);
  const [servicosExistentes, setServicosExistentes] = useState<{ id: string; nome: string }[]>([]);
  const [loadingCats, setLoadingCats] = useState(false);
  const [unidadePadrao, setUnidadePadrao] = useState<UnidadeDuracao>('min');
  const [precosPorCategoria, setPrecosPorCategoria] = useState<
    Record<string, { preco: string; duracao: string; unidade: UnidadeDuracao }>
  >({});

  // Campo auxiliar para replicar valor base se desejar
  const [valorBaseReplicar, setValorBaseReplicar] = useState('');

  const gruposSugeridos = [
    'Lavagem',
    'Polimento',
    'Proteção e Vitrificação',
    'Higienização',
    'Microreparo e Martelinho',
    'Vidros e Películas',
    'Outros',
  ];

  // Carrega categorias de veículo ativas
  useEffect(() => {
    if (!isOpen || !tenant) return;

    const carregarCategorias = async () => {
      setLoadingCats(true);
      try {
        const { data, error } = await supabase
          .from('categorias_veiculo')
          .select('*')
          .eq('tenant_id', tenant.id)
          .eq('ativo', true)
          .order('ordem', { ascending: true });

        if (error) throw error;
        if (data && data.length > 0) {
          setCategorias(data as CategoriaVeiculo[]);
          const initialMap: Record<string, { preco: string; duracao: string; unidade: UnidadeDuracao }> = {};
          data.forEach((cat) => {
            initialMap[cat.id] = { preco: '', duracao: '60', unidade: 'min' };
          });
          setPrecosPorCategoria(initialMap);
        }

        // Carrega nomes de serviços existentes para validação proativa de duplicatas
        const { data: srvs } = await supabase
          .from('servicos')
          .select('id, nome')
          .eq('tenant_id', tenant.id);
        if (srvs) setServicosExistentes(srvs);
      } catch (err: any) {
        console.error('[ModalServicoRapido] Erro ao carregar categorias:', err);
      } finally {
        setLoadingCats(false);
      }
    };

    carregarCategorias();
  }, [isOpen, tenant]);

  const handlePrecoChange = (catId: string, valor: string) => {
    setPrecosPorCategoria((prev) => ({
      ...prev,
      [catId]: {
        ...prev[catId],
        preco: valor,
      },
    }));
  };

  const handleDuracaoChange = (catId: string, duracao: string) => {
    setPrecosPorCategoria((prev) => ({
      ...prev,
      [catId]: {
        ...prev[catId],
        duracao,
      },
    }));
  };

  const handleUnidadeChange = (catId: string, novaUnidade: UnidadeDuracao) => {
    setPrecosPorCategoria((prev) => {
      const item = prev[catId];
      if (!item) return prev;
      const minsAtuais = converterParaMinutos(Number(item.duracao) || 0, item.unidade);
      const novoValor = converterDeMinutos(minsAtuais, novaUnidade);
      return {
        ...prev,
        [catId]: {
          ...item,
          unidade: novaUnidade,
          duracao: novoValor > 0 ? String(novoValor) : '',
        },
      };
    });
  };

  const handleMudarUnidadePadrao = (novaUnidade: UnidadeDuracao) => {
    setUnidadePadrao(novaUnidade);
    setPrecosPorCategoria((prev) => {
      const updated = { ...prev };
      Object.keys(updated).forEach((catId) => {
        const item = updated[catId];
        const mins = converterParaMinutos(Number(item.duracao) || 0, item.unidade);
        const novoValor = converterDeMinutos(mins, novaUnidade);
        updated[catId] = {
          ...item,
          unidade: novaUnidade,
          duracao: novoValor > 0 ? String(novoValor) : '',
        };
      });
      return updated;
    });
  };

  // Replicar valor base com ajuste de porte opcional
  const handleReplicarValor = () => {
    const baseNum = Number(valorBaseReplicar.replace(',', '.')) || 0;
    if (baseNum <= 0) return;

    setPrecosPorCategoria((prev) => {
      const updated = { ...prev };
      categorias.forEach((cat, idx) => {
        // Sugere progressão leve por porte caso queira, ou o mesmo valor base
        const fator = 1 + idx * 0.25; // ex: Hatch 100, Sedan 125, SUV 150...
        const precoCalculado = Math.round(baseNum * fator);
        updated[cat.id] = {
          ...updated[cat.id],
          preco: (updated[cat.id]?.preco ? updated[cat.id].preco : String(precoCalculado)),
        };
      });
      return updated;
    });
    showSuccess('Valores sugeridos distribuídos por porte de veículo! Ajuste conforme desejar.');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant || !nome.trim()) {
      showError('Informe o nome do serviço.');
      return;
    }

    // Identifica o preço para a categoria do veículo atual do orçamento
    const precoAtualObj = categoriaVeiculoId ? precosPorCategoria[categoriaVeiculoId] : null;
    let precoBasePadrao = 0;
    let duracaoPadrao = 60;

    if (precoAtualObj && precoAtualObj.preco) {
      precoBasePadrao = Number(precoAtualObj.preco.replace(',', '.')) || 0;
      duracaoPadrao = converterParaMinutos(
        Number(precoAtualObj.duracao) || 60,
        precoAtualObj.unidade || unidadePadrao
      );
    } else {
      // Pega o primeiro preço informado
      const primeiraCatPreenchida = Object.values(precosPorCategoria).find((p) => Number(p.preco) > 0);
      if (primeiraCatPreenchida) {
        precoBasePadrao = Number(primeiraCatPreenchida.preco.replace(',', '.')) || 0;
        duracaoPadrao = converterParaMinutos(
          Number(primeiraCatPreenchida.duracao) || 60,
          primeiraCatPreenchida.unidade || unidadePadrao
        );
      }
    }

    setSaving(true);
    try {
      // Calcula modo de ocupação e dias se o serviço tiver duração em dias
      let maxDiasCalculados = 1;
      Object.values(precosPorCategoria).forEach((p) => {
        const u = p.unidade || unidadePadrao;
        if (u === 'dias') {
          const d = Math.ceil(Number(p.duracao) || 1);
          if (d > maxDiasCalculados) maxDiasCalculados = d;
        } else {
          const mins = converterParaMinutos(Number(p.duracao) || 60, u);
          if (mins >= 480) {
            const d = Math.ceil(mins / 480);
            if (d > maxDiasCalculados) maxDiasCalculados = d;
          }
        }
      });

      const modoOcupacaoCalculado = maxDiasCalculados > 1
        ? 'multiplos_dias'
        : (unidadePadrao === 'dias' ? 'dia_inteiro' : 'slot');

      // 1. Verifica se já existe um serviço com esse nome no catálogo deste tenant
      const { data: existenteList } = await supabase
        .from('servicos')
        .select('*')
        .eq('tenant_id', tenant.id)
        .ilike('nome', nome.trim())
        .limit(1);

      const jaExistia = Boolean(existenteList && existenteList.length > 0);
      let servicoData = jaExistia ? existenteList![0] : null;

      if (servicoData) {
        // Se já existe, atualiza diretamente os dados do serviço e garante que fique ativo
        const { data: atualizado, error: updErr } = await supabase
          .from('servicos')
          .update({
            ativo: true,
            grupo: grupo.trim() || servicoData.grupo,
            unidade_duracao: unidadePadrao,
            modo_ocupacao: modoOcupacaoCalculado,
            dias_ocupados: maxDiasCalculados,
          })
          .eq('id', servicoData.id)
          .select('*')
          .single();

        if (!updErr && atualizado) {
          servicoData = atualizado;
        }
      } else {
        // Inserir o novo serviço mestre no catálogo
        const { data: novo, error: servicoErr } = await supabase
          .from('servicos')
          .insert({
            tenant_id: tenant.id,
            nome: nome.trim(),
            grupo: grupo.trim() || 'Geral',
            descricao_publica: descricao.trim() || null,
            unidade_duracao: unidadePadrao,
            modo_ocupacao: modoOcupacaoCalculado,
            dias_ocupados: maxDiasCalculados,
            ativo: true,
          })
          .select('*')
          .single();

        if (servicoErr) {
          // Conflito de unicidade recuperado defensivamente com UPDATE
          if (
            servicoErr.code === '23505' ||
            servicoErr.message?.includes('duplicate key') ||
            servicoErr.message?.includes('servicos_tenant_id_nome')
          ) {
            const { data: recuperados } = await supabase
              .from('servicos')
              .select('*')
              .eq('tenant_id', tenant.id)
              .ilike('nome', nome.trim())
              .limit(1);

            if (recuperados && recuperados.length > 0) {
              servicoData = recuperados[0];
              await supabase
                .from('servicos')
                .update({
                  ativo: true,
                  grupo: grupo.trim() || servicoData.grupo,
                  unidade_duracao: unidadePadrao,
                  modo_ocupacao: modoOcupacaoCalculado,
                  dias_ocupados: maxDiasCalculados,
                })
                .eq('id', servicoData.id);
            } else {
              throw servicoErr;
            }
          } else {
            throw servicoErr;
          }
        } else {
          servicoData = novo;
        }
      }

      if (!servicoData) {
        throw new Error('Não foi possível registrar o serviço.');
      }

      // 2. Prepara as linhas de preço para todas as categorias
      const linhasMatriz = categorias.map((cat) => {
        const catPrecoObj = precosPorCategoria[cat.id];
        const precoNum = Number((catPrecoObj?.preco || '').replace(',', '.')) || (cat.id === categoriaVeiculoId ? precoBasePadrao : 0);
        const duracaoMins = converterParaMinutos(
          Number(catPrecoObj?.duracao) || 60,
          catPrecoObj?.unidade || unidadePadrao
        ) || duracaoPadrao;

        return {
          categoria_id: cat.id,
          preco_base: precoNum,
          duracao_minutos: duracaoMins,
          unidade_duracao: catPrecoObj?.unidade || unidadePadrao,
          duracao_confirmada: true,
        };
      });

      // 3. Salvar matriz de preços via RPC salvar_matriz_precos
      const { error: rpcPrecoErr } = await supabase.rpc('salvar_matriz_precos', {
        p_servico: servicoData.id,
        p_linhas: linhasMatriz,
      });

      // Se a RPC falhar (por exemplo, permissão estrita ou assinatura), faz fallback via insert direto em servico_precos
      if (rpcPrecoErr) {
        console.warn('[ModalServicoRapido] RPC salvar_matriz_precos retornou erro, executando insert direto:', rpcPrecoErr);
        const promessasPrecos = linhasMatriz.map(async (linha) => {
          return supabase.from('servico_precos').upsert(
            {
              tenant_id: tenant.id,
              servico_id: servicoData.id,
              categoria_id: linha.categoria_id,
              preco_base: linha.preco_base,
              duracao_minutos: linha.duracao_minutos,
              duracao_confirmada: true,
              ativo: true,
            },
            { onConflict: 'servico_id,categoria_id' }
          );
        });
        await Promise.all(promessasPrecos);
      }

      if (jaExistia) {
        showSuccess(`Serviço "${servicoData.nome}" já existente no catálogo foi atualizado e selecionado!`);
      } else {
        showSuccess(`Serviço "${nome.trim()}" cadastrado com preços por categoria!`);
      }
      onSuccess(servicoData);
      onClose();

      // Reset
      setNome('');
      setDescricao('');
      setValorBaseReplicar('');
    } catch (err: any) {
      console.error('[Cadastrar Servico Rapido Error]:', err);
      showError('Erro ao cadastrar serviço: ' + (err?.message || err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Cadastrar Novo Serviço"
      maxWidth="lg"
      icon={<Wrench className="text-amber-500" size={22} />}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Aviso explicativo */}
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-300 flex items-start gap-2">
          <Car size={16} className="shrink-0 mt-0.5" />
          <span>
            Cadastre o serviço com precificação variável por categoria (ex: Uno vs BMW). Cada categoria de veículo terá seu valor justo e tempo estimado próprio.
          </span>
        </div>

        {/* Nome do Serviço */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-vapor-300 uppercase tracking-wide">
            Nome do Serviço *
          </label>
          <Input
            type="text"
            placeholder="Ex: Polimento Técnico de Faróis, Remoção de Chuva Ácida..."
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            autoFocus
            className="min-h-[44px]"
          />
          {servicosExistentes.some((s) => s.nome.trim().toLowerCase() === nome.trim().toLowerCase()) && (
            <span className="text-[11px] text-amber-400 font-sans flex items-center gap-1.5 mt-1 bg-amber-500/10 p-1.5 rounded border border-amber-500/30">
              <Sparkles size={13} className="shrink-0 text-amber-400" />
              Este serviço já existe no catálogo. Ao salvar, seus preços e durações por categoria serão atualizados e ele será selecionado.
            </span>
          )}
        </div>

        {/* Grupo / Categoria do Serviço */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-vapor-300 uppercase tracking-wide">
            Grupo do Serviço:
          </label>
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {gruposSugeridos.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGrupo(g)}
                className={`text-[11px] px-2.5 py-1 rounded font-medium border transition-colors ${
                  grupo === g
                    ? 'bg-amber-500 text-graphite-950 border-amber-400 font-bold'
                    : 'bg-graphite-900 text-vapor-300 border-graphite-700 hover:border-graphite-600'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
          <Input
            type="text"
            placeholder="Ou digite outro grupo..."
            value={grupo}
            onChange={(e) => setGrupo(e.target.value)}
            className="min-h-[38px] text-xs"
          />
        </div>

        {/* TABELA DE PREÇO VARIÁVEL POR CATEGORIA DE VEÍCULO */}
        <div className="flex flex-col gap-2 p-3 bg-graphite-900/90 rounded-xl border border-graphite-700">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-graphite-700 pb-2">
            <div className="flex items-center gap-1.5">
              <Car size={16} className="text-amber-400" />
              <span className="text-xs font-bold text-vapor-100 uppercase tracking-wide">
                Preços por Porte / Categoria de Veículo
              </span>
            </div>

            {/* Replicador rápido */}
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                placeholder="R$ Base..."
                value={valorBaseReplicar}
                onChange={(e) => setValorBaseReplicar(e.target.value)}
                className="w-20 bg-graphite-950 border border-graphite-700 rounded px-2 py-1 text-xs text-amber-400 font-mono outline-none"
              />
              <button
                type="button"
                onClick={handleReplicarValor}
                className="px-2 py-1 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/30 rounded text-[11px] font-bold flex items-center gap-1"
                title="Sugerir valores para todas as categorias baseado no porte"
              >
                <Sparkles size={12} />
                <span>Sugerir Portes</span>
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-graphite-800">
              <span className="text-[11px] text-vapor-400 font-medium">Unidade de tempo padrão:</span>
              <div className="inline-flex bg-graphite-950 border border-graphite-700 rounded p-0.5">
                {OPCOES_UNIDADE_DURACAO.map((opt) => (
                  <button
                    key={opt.valor}
                    type="button"
                    onClick={() => handleMudarUnidadePadrao(opt.valor)}
                    className={`px-2 py-0.5 text-[10px] rounded font-bold transition-all ${
                      unidadePadrao === opt.valor
                        ? 'bg-amber-500 text-graphite-950 shadow-sm'
                        : 'text-vapor-400 hover:text-vapor-200'
                    }`}
                  >
                    {opt.rotulo}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {loadingCats ? (
            <div className="py-4 text-center text-xs text-vapor-400 animate-pulse">
              Carregando categorias de veículos...
            </div>
          ) : categorias.length === 0 ? (
            <div className="py-3 text-xs text-vapor-400 italic">
              Nenhuma categoria cadastrada. O serviço será registrado com preço base.
            </div>
          ) : (
            <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
              {categorias.map((cat) => {
                const isAtual = cat.id === categoriaVeiculoId;
                const catPreco = precosPorCategoria[cat.id]?.preco || '';
                const catDuracao = precosPorCategoria[cat.id]?.duracao || '60';
                const catUnidade = precosPorCategoria[cat.id]?.unidade || unidadePadrao;

                return (
                  <div
                    key={cat.id}
                    className={`flex items-center justify-between gap-2 p-2 rounded-lg border transition-colors ${
                      isAtual
                        ? 'bg-amber-500/10 border-amber-500/40 shadow-sm'
                        : 'bg-graphite-950/60 border-graphite-800'
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="font-bold text-xs text-vapor-200 truncate">
                        {cat.nome}
                      </span>
                      {isAtual && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500 text-graphite-950 shrink-0">
                          ★ Carro Deste Orçamento {categoriaVeiculoNome ? `(${categoriaVeiculoNome})` : ''}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {/* Campo de Preço */}
                      <div className="relative flex items-center">
                        <span className="absolute left-2 text-vapor-500 font-mono text-xs">R$</span>
                        <input
                          type="text"
                          placeholder="0,00"
                          value={catPreco}
                          onChange={(e) => handlePrecoChange(cat.id, e.target.value)}
                          className="w-24 pl-7 pr-2 py-1.5 bg-graphite-900 border border-graphite-700 rounded text-xs font-mono font-bold text-amber-400 outline-none focus:border-amber-500"
                        />
                      </div>

                      {/* Campo de Tempo */}
                      <div className="relative flex items-center">
                        <span className="absolute left-2 text-vapor-500">
                          <Clock size={12} />
                        </span>
                        <input
                          type="number"
                          placeholder="60"
                          value={catDuracao}
                          onChange={(e) => handleDuracaoChange(cat.id, e.target.value)}
                          className="w-16 pl-6 pr-1 py-1.5 bg-graphite-900 border border-graphite-700 rounded text-xs font-mono text-vapor-100 outline-none focus:border-amber-500"
                          title="Duração estimada para esta categoria"
                        />
                        <select
                          value={catUnidade}
                          onChange={(e) => handleUnidadeChange(cat.id, e.target.value as UnidadeDuracao)}
                          className="bg-graphite-900 border border-graphite-700 rounded text-[10px] font-sans font-bold text-vapor-300 px-1 py-1 ml-1 outline-none focus:border-amber-500 cursor-pointer"
                          title="Unidade de medida de tempo"
                        >
                          <option value="min">min</option>
                          <option value="horas">h</option>
                          <option value="dias">d</option>
                        </select>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Descrição Opcional */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-vapor-300 uppercase tracking-wide">
            Descrição / Benefícios (Opcional):
          </label>
          <textarea
            rows={2}
            placeholder="Breve descrição dos benefícios ou etapas deste serviço..."
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            className="w-full bg-graphite-900 border border-graphite-700 rounded-lg p-2.5 text-vapor-100 placeholder-vapor-600 font-sans text-xs outline-none focus:border-amber-500"
          />
        </div>

        {/* Botões do Rodapé */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-graphite-800">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={saving}
            className="text-xs h-10 px-4"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={saving}
            className="text-xs font-bold h-10 px-5 flex items-center gap-2 bg-gradient-to-r from-amber-500 to-yellow-500 text-graphite-950"
          >
            <Check size={16} />
            <span>{saving ? 'Cadastrando...' : 'Cadastrar e Usar'}</span>
          </Button>
        </div>
      </form>
    </Modal>
  );
};
