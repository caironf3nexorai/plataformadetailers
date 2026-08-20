import React, { useState, useEffect, useRef } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { CampoNumerico } from '../ui/CampoNumerico';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Clock,
  AlertCircle,
  Package,
  Plus,
  Trash2,
  CreditCard,
  Percent,
} from 'lucide-react';
import type { ExecucaoFoto } from '../../types/execucao';
import type { ProdutoParaConsumo, ItemConsumoExecucao } from '../../types/estoque';
import { formatarMoeda } from '../../utils/formatters';
import { useTempoExecucao, notificarAtualizacaoTempo } from '../../hooks/useTempoExecucao';

interface ItemPreco {
  agendamento_item_id: string;
  servico_nome: string;
  valor_estimado: number;
  valor_final: number | string;
  motivo: string;
}

interface FormaPagamentoOption {
  id: string;
  nome: string;
  tipo: string;
  permite_parcelar: boolean;
}

interface MaquininhaOption {
  id: string;
  nome: string;
  padrao: boolean;
}

interface BandeiraOption {
  codigo: string;
  nome: string;
}

interface ItemPagamentoLancado {
  id: string;
  forma_id: string;
  forma_nome: string;
  forma_tipo: string;
  maquininha_id?: string;
  maquininha_nome?: string;
  bandeira_codigo?: string;
  taxa_estimada?: boolean;
  total_parcelas: number;
  valor_bruto: number;
  previsto_para: string;
  observacao?: string;
}

const parseQtdNumber = (val: number | string | undefined | null): number => {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (!val.trim()) return 0;
  const normalized = val.replace(/\./g, '').replace(',', '.');
  const num = parseFloat(normalized);
  return isNaN(num) ? 0 : num;
};

const parseValNumber = (val: number | string | undefined | null): number => {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (!val.trim()) return 0;
  const normalized = val.replace(/\./g, '').replace(',', '.');
  const num = parseFloat(normalized);
  return isNaN(num) ? 0 : num;
};

interface ModalFinalizarExecucaoProps {
  isOpen: boolean;
  onClose: () => void;
  onRevertFinalizadoEm?: () => void;
  execucaoId: string;
  agendamentoId: string;
  tenantId: string;
  placaVeiculo: string;
  tempoFormatado?: string;
  pendingRequiredCount: number;
  pendingRequiredNames: string[];
  agendamentoItens: Array<{ id: string; servico_nome: string; preco_aplicado?: number; preco_estimado?: number; valor_estimado?: number }>;
  fotosSaidaExistentes: ExecucaoFoto[];
  onSuccess: () => void;
  modoRetroativoInicial?: boolean;
  modoDefinirValorOnly?: boolean;
  iniciadoEm?: string;
  duracaoEstimadaMinutos?: number;
  servicosNomes?: string[];
  totalChecklistCount?: number;
  concluidosChecklistCount?: number;
}

export const ModalFinalizarExecucao: React.FC<ModalFinalizarExecucaoProps> = ({
  isOpen,
  onClose,
  onRevertFinalizadoEm,
  execucaoId,
  agendamentoId,
  tenantId,
  placaVeiculo,
  tempoFormatado: tempoProp,
  pendingRequiredCount,
  agendamentoItens,
  fotosSaidaExistentes: _fotosSaidaExistentes,
  onSuccess,
  modoRetroativoInicial: _modoRetroativoInicial = false,
  modoDefinirValorOnly = false,
  iniciadoEm: _iniciadoEm,
  duracaoEstimadaMinutos: _duracaoEstimadaMinutos = 60,
  servicosNomes = [],
  totalChecklistCount,
  concluidosChecklistCount,
}) => {
  const { membership, user: _user } = useAuth();
  const podeVerValor = membership?.role === 'dono' || membership?.role === 'gerente';

  const tempoHook = useTempoExecucao(execucaoId);

  const [observacoes] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [itensPreco, setItensPreco] = useState<ItemPreco[]>([]);

  const [consumos, setConsumos] = useState<ItemConsumoExecucao[]>([]);
  const [_produtosCatalogo, setProdutosCatalogo] = useState<Record<string, { custo_unitario: number }>>({});
  const [produtosDisponiveis, setProdutosDisponiveis] = useState<ProdutoParaConsumo[]>([]);
  const [selectedProdutoId, setSelectedProdutoId] = useState('');

  // Estados de Formas de Pagamento, Maquininhas, Bandeiras & Desconto
  const [formasPagamento, setFormasPagamento] = useState<FormaPagamentoOption[]>([]);
  const [maquininhas, setMaquininhas] = useState<MaquininhaOption[]>([]);
  const [bandeiras, setBandeiras] = useState<BandeiraOption[]>([]);
  const [sinalPago, setSinalPago] = useState(0);
  const [pagamentosLancados, setPagamentosLancados] = useState<ItemPagamentoLancado[]>([]);

  // Inputs de Desconto na Finalização
  const [descontoTipo, setDescontoTipo] = useState<'porcentagem' | 'valor_fixo'>('porcentagem');
  const [descontoValor, setDescontoValor] = useState('');
  const [descontoMotivo, setDescontoMotivo] = useState('');

  // Inputs do novo pagamento
  const [novoFormaId, setNovoFormaId] = useState('');
  const [novoMaquininhaId, setNovoMaquininhaId] = useState('');
  const [novoBandeiraCodigo, setNovoBandeiraCodigo] = useState('');
  const [novoParcelas, setNovoParcelas] = useState('1');
  const [novoValor, setNovoValor] = useState('');
  const [novoVencimento] = useState(new Date().toISOString().split('T')[0]);
  const [taxaInfoAviso, setTaxaInfoAviso] = useState<{ percentual: number; estimada: boolean } | null>(null);



  // Carregar Formas de Pagamento, Maquininhas, Bandeiras e Sinal Pago ao abrir modal
  useEffect(() => {
    if (isOpen && podeVerValor && tenantId) {
      const loadFinanceiroData = async () => {
        try {
          // 1. Carrega formas de pagamento
          const { data: fpData } = await supabase
            .from('tenant_formas_pagamento')
            .select('id, nome, tipo, permite_parcelar')
            .eq('tenant_id', tenantId)
            .eq('ativo', true)
            .order('ordem', { ascending: true });

          if (fpData) {
            setFormasPagamento(fpData);
            if (fpData.length > 0 && !novoFormaId) {
              setNovoFormaId(fpData[0].id);
            }
          }

          // 2. Carrega maquininhas
          const { data: maqData } = await supabase
            .from('tenant_maquininhas')
            .select('id, nome, padrao')
            .eq('tenant_id', tenantId)
            .eq('ativo', true)
            .order('padrao', { ascending: false });

          if (maqData) {
            setMaquininhas(maqData);
            if (maqData.length > 0 && !novoMaquininhaId) {
              setNovoMaquininhaId(maqData[0].id);
            }
          }

          // 3. Carrega bandeiras
          const { data: bandData } = await supabase
            .from('bandeiras')
            .select('codigo, nome')
            .order('ordem', { ascending: true });

          if (bandData) {
            setBandeiras(bandData);
          }

          // 4. Carrega se houve sinal pago
          if (agendamentoId) {
            const { data: recData } = await supabase
              .from('recebimentos')
              .select('valor_bruto')
              .eq('agendamento_id', agendamentoId)
              .eq('origem', 'sinal_agendamento')
              .eq('status', 'recebido');

            if (recData && recData.length > 0) {
              const totalSinal = recData.reduce((acc, r) => acc + Number(r.valor_bruto), 0);
              setSinalPago(totalSinal);
            } else {
              setSinalPago(0);
            }
          }
        } catch (err) {
          console.error('Erro ao carregar dados de pagamento:', err);
        }
      };
      loadFinanceiroData();
    }
  }, [isOpen, podeVerValor, tenantId, agendamentoId]);

  // Consulta taxa aplicável em tempo real
  useEffect(() => {
    const calcularTaxaAtual = async () => {
      const forma = formasPagamento.find((f) => f.id === novoFormaId);
      if (!forma || (forma.tipo !== 'debito' && forma.tipo !== 'credito')) {
        setTaxaInfoAviso(null);
        return;
      }
      const maqId = novoMaquininhaId || maquininhas[0]?.id;
      if (!maqId) return;

      const parcelasNum = parseInt(novoParcelas, 10) || 1;
      const { data: resTaxa } = await supabase.rpc('resolver_taxa_cartao', {
        p_maquininha: maqId,
        p_tipo: forma.tipo,
        p_bandeira: novoBandeiraCodigo || null,
        p_parcelas: parcelasNum,
      });

      if (resTaxa && resTaxa.length > 0) {
        setTaxaInfoAviso({
          percentual: resTaxa[0].taxa_percentual,
          estimada: resTaxa[0].taxa_estimada,
        });
      }
    };

    if (podeVerValor && novoFormaId) {
      calcularTaxaAtual();
    }
  }, [novoFormaId, novoMaquininhaId, novoParcelas, novoBandeiraCodigo, formasPagamento, maquininhas, podeVerValor]);

  useEffect(() => {
    const carregarItensPreco = async () => {
      let sourceItens = agendamentoItens || [];

      if (sourceItens.length === 0 && agendamentoId) {
        const { data: dbItens } = await supabase
          .from('agendamento_itens')
          .select('*, servicos(id, nome)')
          .eq('agendamento_id', agendamentoId);

        if (dbItens && dbItens.length > 0) {
          sourceItens = dbItens;
        } else if (tenantId) {
          const sNome = servicosNomes.length > 0 ? servicosNomes.join(' • ') : 'Serviço';
          const { data: newItem } = await supabase
            .from('agendamento_itens')
            .insert({
              tenant_id: tenantId,
              agendamento_id: agendamentoId,
              servico_nome: sNome,
              preco_estimado: 0,
              preco_aplicado: 0,
            })
            .select()
            .single();

          if (newItem) {
            sourceItens = [newItem];
          }
        }
      }

      let execValoresMap: Record<string, { valor_final: number; motivo: string }> = {};
      if (execucaoId) {
        const { data: dbValores } = await supabase
          .from('execucao_valores')
          .select('agendamento_item_id, valor_final, motivo')
          .eq('execucao_id', execucaoId);

        if (dbValores) {
          dbValores.forEach((v: any) => {
            if (v.agendamento_item_id) {
              execValoresMap[v.agendamento_item_id] = {
                valor_final: v.valor_final,
                motivo: v.motivo || '',
              };
            }
          });
        }
      }

      if (sourceItens.length > 0) {
        setItensPreco(
          sourceItens.map((item: any) => {
            const valorEst = item.preco_estimado ?? item.valor_estimado ?? item.preco_unitario ?? 0;
            const numEst = Number(valorEst) || 0;
            const sNome = item.servico_nome || item.servicos?.nome || (servicosNomes.length > 0 ? servicosNomes.join(' • ') : 'Serviço');

            const recorded = execValoresMap[item.id];
            const valFinalStr = recorded && recorded.valor_final !== null && recorded.valor_final !== undefined
              ? String(recorded.valor_final)
              : String(numEst);

            return {
              agendamento_item_id: item.id,
              servico_nome: sNome,
              valor_estimado: numEst,
              valor_final: valFinalStr,
              motivo: recorded?.motivo || '',
            };
          })
        );
      }
    };

    if (isOpen) {
      carregarItensPreco();
    }
  }, [isOpen, agendamentoItens, agendamentoId, execucaoId, servicosNomes, tenantId]);

  // Carregar produtos para consumo
  useEffect(() => {
    if (isOpen && execucaoId) {
      const loadConsumosData = async () => {
        try {
          const { data: prodsData } = await supabase.rpc('produtos_para_consumo', { p_tenant: tenantId });
          if (prodsData) setProdutosDisponiveis(prodsData);

          if (podeVerValor) {
            const { data: fullProds } = await supabase
              .from('produtos')
              .select('id, custo_unitario')
              .eq('tenant_id', tenantId);

            if (fullProds) {
              const map: Record<string, { custo_unitario: number }> = {};
              fullProds.forEach((p) => {
                map[p.id] = { custo_unitario: p.custo_unitario };
              });
              setProdutosCatalogo(map);
            }
          }

          const { data: sugData, error: sugErr } = await supabase.rpc('sugerir_consumo', { p_execucao: execucaoId });
          if (!sugErr && sugData && Array.isArray(sugData) && sugData.length > 0) {
            const items: ItemConsumoExecucao[] = sugData.map((s: any) => ({
              produto_id: s.produto_id,
              nome: s.nome,
              marca: s.marca,
              unidade_uso: s.unidade_uso,
              quantidade: s.quantidade !== undefined && s.quantidade !== null ? String(s.quantidade) : '0',
              sugerido: true,
            }));
            setConsumos(items);
          } else {
            setConsumos([]);
          }
        } catch (err) {
          console.error('[Load Consumos Data Error]:', err);
        }
      };

      loadConsumosData();
    }
  }, [isOpen, execucaoId, tenantId, podeVerValor]);

  const valorTotalBruto = itensPreco.reduce((acc, curr) => acc + parseValNumber(curr.valor_final), 0);
  const numDesconto = parseValNumber(descontoValor);
  const valorDesconto = numDesconto > 0
    ? (descontoTipo === 'porcentagem'
        ? Math.round((valorTotalBruto * (numDesconto / 100)) * 100) / 100
        : Math.min(valorTotalBruto, numDesconto))
    : 0;
  const valorTotalComDesconto = Math.max(0, valorTotalBruto - valorDesconto);
  const saldoRestante = Math.max(0, valorTotalComDesconto - sinalPago);
  const somaPagamentosLancados = pagamentosLancados.reduce((acc, p) => acc + p.valor_bruto, 0);
  const diferencaPagamentos = Math.round((saldoRestante - somaPagamentosLancados) * 100) / 100;

  // Preenche valor inicial no campo de pagamento com o saldo restante se estiver zerado
  useEffect(() => {
    if (saldoRestante > 0 && pagamentosLancados.length === 0 && (!novoValor || parseFloat(novoValor) === 0)) {
      setNovoValor(String(saldoRestante));
    }
  }, [saldoRestante, pagamentosLancados]);

  const handleItemValorChange = (agendamento_item_id: string, novoValorStr: string) => {
    setItensPreco((prev) =>
      prev.map((item) =>
        item.agendamento_item_id === agendamento_item_id ? { ...item, valor_final: novoValorStr } : item
      )
    );
  };

  const handleAddProdutoConsumo = () => {
    if (!selectedProdutoId) return;
    const prod = produtosDisponiveis.find((p) => p.id === selectedProdutoId);
    if (!prod) return;

    if (consumos.some((c) => c.produto_id === selectedProdutoId)) {
      setErrorMsg('Este produto já foi adicionado à lista de consumo.');
      return;
    }

    setConsumos((prev) => [
      ...prev,
      {
        produto_id: prod.id,
        nome: prod.nome,
        marca: prod.marca,
        unidade_uso: prod.unidade_uso as any,
        quantidade: prod.unidade_uso === 'ml' ? '90' : '10',
        sugerido: false,
      },
    ]);
    setSelectedProdutoId('');
    setErrorMsg(null);
  };

  const handleUpdateConsumoQtd = (produto_id: string, qtdStr: string) => {
    setConsumos((prev) =>
      prev.map((c) => (c.produto_id === produto_id ? { ...c, quantidade: qtdStr } : c))
    );
  };

  const handleRemoveConsumo = (produto_id: string) => {
    setConsumos((prev) => prev.filter((c) => c.produto_id !== produto_id));
  };

  // Adicionar lançamento de pagamento no frontend
  const handleAddPagamento = async () => {
    if (!novoFormaId) return;
    const val = parseValNumber(novoValor);
    if (val <= 0) {
      setErrorMsg('Informe um valor de pagamento maior que zero.');
      return;
    }

    if (numDesconto > 0 && !descontoMotivo.trim()) {
      setErrorMsg('O motivo do desconto é obrigatório quando há concessão de desconto.');
      return;
    }

    const forma = formasPagamento.find((f) => f.id === novoFormaId);
    if (!forma) return;

    const parcelas = parseInt(novoParcelas, 10) || 1;
    let taxaEstimada = false;
    let maqNome = '';

    if (forma.tipo === 'debito' || forma.tipo === 'credito') {
      const maqId = novoMaquininhaId || maquininhas[0]?.id;
      const maqObj = maquininhas.find((m) => m.id === maqId);
      if (maqObj) maqNome = maqObj.nome;

      if (maqId) {
        const { data: resTaxa } = await supabase.rpc('resolver_taxa_cartao', {
          p_maquininha: maqId,
          p_tipo: forma.tipo,
          p_bandeira: novoBandeiraCodigo || null,
          p_parcelas: parcelas,
        });
        if (resTaxa && resTaxa.length > 0) {
          taxaEstimada = resTaxa[0].taxa_estimada;
        }
      }
    }

    setPagamentosLancados((prev) => [
      ...prev,
      {
        id: Math.random().toString(),
        forma_id: forma.id,
        forma_nome: forma.nome,
        forma_tipo: forma.tipo,
        maquininha_id: (forma.tipo === 'debito' || forma.tipo === 'credito') ? (novoMaquininhaId || maquininhas[0]?.id) : undefined,
        maquininha_nome: maqNome,
        bandeira_codigo: (forma.tipo === 'debito' || forma.tipo === 'credito') ? (novoBandeiraCodigo || undefined) : undefined,
        taxa_estimada: taxaEstimada,
        total_parcelas: parcelas,
        valor_bruto: val,
        previsto_para: novoVencimento,
      },
    ]);

    setNovoValor('');
    setErrorMsg(null);
  };

  const handleRemovePagamento = (id: string) => {
    setPagamentosLancados((prev) => prev.filter((p) => p.id !== id));
  };

  const concluiuRef = useRef(false);

  const handleCancelarFinalizacao = async () => {
    if (execucaoId && !concluiuRef.current && !modoDefinirValorOnly) {
      try {
        await supabase.rpc('cancelar_finalizacao', { p_execucao: execucaoId });
      } catch (err) {
        console.error('[cancelar_finalizacao Error]:', err);
        await supabase
          .from('execucoes')
          .update({ finalizado_em: null, contando_desde: new Date().toISOString(), status: 'em_andamento' })
          .eq('id', execucaoId);
      }
      onRevertFinalizadoEm?.();
      notificarAtualizacaoTempo(execucaoId);
    }
  };

  useEffect(() => {
    if (isOpen) concluiuRef.current = false;
    return () => {
      if (isOpen && !concluiuRef.current && execucaoId && !modoDefinirValorOnly) {
        supabase.rpc('cancelar_finalizacao', { p_execucao: execucaoId }).then(() => {
          onRevertFinalizadoEm?.();
          notificarAtualizacaoTempo(execucaoId);
        });
      }
    };
  }, [isOpen, execucaoId, modoDefinirValorOnly]);

  const handleConcluir = async () => {
    if (!modoDefinirValorOnly && pendingRequiredCount > 0) {
      setErrorMsg(`Existem ${pendingRequiredCount} itens obrigatórios pendentes no checklist.`);
      return;
    }

    if (podeVerValor) {
      if (itensPreco.length === 0 || valorTotalBruto <= 0) {
        setErrorMsg('Informe o valor final de cada serviço.');
        return;
      }

      if (numDesconto > 0 && !descontoMotivo.trim()) {
        setErrorMsg('Informe o motivo do desconto concedido na finalização.');
        return;
      }

      // Validação estrita da soma dos pagamentos versus saldo a receber
      if (saldoRestante > 0) {
        if (pagamentosLancados.length === 0) {
          setErrorMsg('Informe as formas de pagamento para o saldo a receber.');
          return;
        }
        if (Math.abs(diferencaPagamentos) > 0.01) {
          setErrorMsg(
            `A soma dos pagamentos lançados (${formatarMoeda(somaPagamentosLancados)}) difere do saldo a receber (${formatarMoeda(saldoRestante)}). Diferença: ${formatarMoeda(Math.abs(diferencaPagamentos))}.`
          );
          return;
        }
      }
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const consumosPayload = consumos
        .filter((c) => parseQtdNumber(c.quantidade) > 0)
        .map((c) => ({
          produto_id: c.produto_id,
          quantidade: parseQtdNumber(c.quantidade),
        }));

      const payloadValores = podeVerValor && itensPreco.length > 0
        ? itensPreco.map((item) => ({
            agendamento_item_id: item.agendamento_item_id,
            valor_final: parseValNumber(item.valor_final),
            motivo: item.motivo || null,
          }))
        : [];

      const pagamentosPayload = podeVerValor
        ? pagamentosLancados.map((p) => ({
            forma_id: p.forma_id,
            maquininha_id: p.maquininha_id || null,
            bandeira_codigo: p.bandeira_codigo || null,
            total_parcelas: p.total_parcelas,
            numero_parcela: 1,
            valor_bruto: p.valor_bruto,
            previsto_para: p.previsto_para,
            observacao: p.observacao || null,
          }))
        : [];

      // RPC ÚNICA E TRANSACIONAL
      const { error: concErr } = await supabase.rpc('finalizar_execucao_com_pagamentos', {
        p_execucao: execucaoId,
        p_pagamentos: pagamentosPayload,
        p_valores: payloadValores,
        p_consumos: consumosPayload,
        p_observacoes: observacoes.trim() || null,
        p_desconto_tipo: numDesconto > 0 ? descontoTipo : null,
        p_desconto_valor: numDesconto,
        p_desconto_motivo: numDesconto > 0 ? descontoMotivo.trim() : null,
      });

      if (concErr) throw concErr;

      concluiuRef.current = true;
      notificarAtualizacaoTempo(execucaoId);
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('[Finalizar Execucao Error]:', err);
      setErrorMsg(err?.message || 'Erro ao concluir execução.');
    } finally {
      setLoading(false);
    }
  };

  const segundosReais = tempoHook.segundosTotais;
  const exibeTempoZerado = segundosReais === 0;
  const textoTempoFormatado = exibeTempoZerado
    ? 'Tempo não registrado'
    : tempoHook.tempoFormatado || tempoProp || '00:00:00';

  return (
    <Modal
      isOpen={isOpen}
      onClose={async () => {
        await handleCancelarFinalizacao();
        onClose();
      }}
      title={modoDefinirValorOnly ? 'Definir Valor Final do Serviço' : 'Finalizar Execução do Serviço'}
    >
      <div className="w-full max-w-lg mx-auto flex flex-col gap-5 py-2 max-h-[80vh] overflow-y-auto overflow-x-hidden pr-1">
        {/* Resumo Compacto da Execução */}
        <div className="p-3.5 bg-graphite-900 border border-graphite-700 rounded-lg flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[20px] font-bold text-vapor-100 tracking-tight">
              {placaVeiculo || 'Sem Veículo'}
            </span>
          </div>

          {servicosNomes && servicosNomes.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-graphite-800">
              <span className="text-[11px] text-vapor-400 font-sans uppercase font-medium">Serviços:</span>
              <span className="text-[13px] text-vapor-200 font-sans font-semibold">
                {servicosNomes.join(' • ')}
              </span>
            </div>
          )}

          <div className="pt-2 border-t border-graphite-800">
            {totalChecklistCount !== undefined && totalChecklistCount > 0 ? (
              <span className="inline-block text-[12px] font-mono font-semibold text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-md border border-amber-500/20">
                Checklist: {concluidosChecklistCount || 0} / {totalChecklistCount} {totalChecklistCount === 1 ? 'item' : 'itens'} ({Math.round(((concluidosChecklistCount || 0) / totalChecklistCount) * 100)}%)
              </span>
            ) : (
              <span className="text-[12px] font-sans text-vapor-400 italic">
                Nenhuma etapa cadastrada
              </span>
            )}
          </div>
        </div>

        {/* Bloco de Tempo Total */}
        <div className="p-4 bg-graphite-900 border border-graphite-700 rounded-lg flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Clock size={24} className={`shrink-0 ${exibeTempoZerado ? 'text-amber-500' : 'text-amber-400'}`} />
            <div>
              <span className="text-[11px] uppercase font-sans text-vapor-400 block font-medium">Tempo Total Decorrido</span>
              <span className="font-mono text-[22px] font-bold text-vapor-100">
                {textoTempoFormatado}
              </span>
            </div>
          </div>
        </div>

        {pendingRequiredCount > 0 && (
          <div className="p-4 bg-flare-400/10 border border-flare-400/30 rounded-lg flex flex-col gap-3 text-flare-400">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 font-semibold text-[14px]">
                <AlertTriangle size={18} className="shrink-0" />
                <span>{pendingRequiredCount} item(ns) obrigatório(s) pendente(s)</span>
              </div>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="p-3 bg-flare-400/10 border border-flare-400/30 rounded text-flare-400 text-[13px] flex items-center gap-2">
            <AlertCircle size={18} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Consumo de produtos */}
        <div className="p-4 bg-graphite-900 border border-graphite-700 rounded-lg flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-graphite-700 pb-2">
            <div className="flex items-center gap-2 text-amber-500 font-semibold text-[15px]">
              <Package size={18} />
              <span>O que foi usado neste serviço?</span>
            </div>
          </div>

          {consumos.map((item) => (
            <div key={item.produto_id} className="flex items-center justify-between gap-2 p-2.5 bg-graphite-800 rounded border border-graphite-700">
              <span className="text-[13px] font-medium text-vapor-100">{item.nome}</span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={item.quantidade}
                  onChange={(e) => handleUpdateConsumoQtd(item.produto_id, e.target.value)}
                  className="w-20 text-right font-mono text-[14px] p-1.5 bg-graphite-900 border border-graphite-700 rounded text-vapor-100"
                />
                <button type="button" onClick={() => handleRemoveConsumo(item.produto_id)} className="text-vapor-400 hover:text-flare-400">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}

          <div className="flex flex-col gap-2 pt-2 border-t border-graphite-700">
            <select
              value={selectedProdutoId}
              onChange={(e) => setSelectedProdutoId(e.target.value)}
              className="w-full bg-graphite-700 text-vapor-100 border border-graphite-600 rounded-md p-3 text-[14px]"
            >
              <option value="">-- Selecionar produto consumido --</option>
              {produtosDisponiveis.map((p) => (
                <option key={p.id} value={p.id}>{p.nome} {p.marca ? `(${p.marca})` : ''}</option>
              ))}
            </select>
            <Button type="button" variant="secondary" onClick={handleAddProdutoConsumo} disabled={!selectedProdutoId}>
              <Plus size={18} />
              <span>Adicionar Produto</span>
            </Button>
          </div>
        </div>

        {/* VALORES E FORMAS DE PAGAMENTO (APENAS GESTÃO) */}
        {podeVerValor && (
          <div className="p-4 bg-graphite-900 border border-graphite-700 rounded-lg flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-graphite-700 pb-2">
              <div className="flex items-center gap-2 text-amber-500 font-semibold text-[15px]">
                <DollarSign size={18} />
                <span>Valores & Formas de Pagamento</span>
              </div>
            </div>

            {/* Valores por serviço */}
            <div className="flex flex-col gap-3">
              {itensPreco.map((item) => (
                <div key={item.agendamento_item_id} className="flex items-center justify-between gap-3 p-3 bg-graphite-800 rounded-lg border border-graphite-700">
                  <span className="text-[13px] font-medium text-vapor-100">{item.servico_nome}</span>
                  <div className="relative w-36">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono text-vapor-400">R$</span>
                    <input
                      type="text"
                      value={item.valor_final}
                      onChange={(e) => handleItemValorChange(item.agendamento_item_id, e.target.value)}
                      className="w-full pl-8 pr-3 py-2 text-right font-mono text-sm font-bold bg-graphite-900 border border-graphite-700 rounded text-vapor-100 outline-none focus:border-amber-500"
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Bloco de Concessão de Desconto na Finalização */}
            <div className="p-3 bg-graphite-950 rounded-lg border border-graphite-800 flex flex-col gap-3">
              <span className="text-xs font-bold text-vapor-200 uppercase tracking-wider flex items-center gap-1.5">
                <Percent size={14} className="text-amber-500" />
                Desconto na Finalização (Opcional)
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <select
                  value={descontoTipo}
                  onChange={(e) => setDescontoTipo(e.target.value as any)}
                  className="bg-graphite-900 border border-graphite-700 rounded px-2.5 py-1.5 text-xs text-vapor-100 outline-none focus:border-amber-500"
                >
                  <option value="porcentagem">Percentual (%)</option>
                  <option value="valor_fixo">Valor Fixo (R$)</option>
                </select>

                <CampoNumerico
                  prefix={descontoTipo === 'valor_fixo' ? 'R$' : undefined}
                  suffix={descontoTipo === 'porcentagem' ? '%' : undefined}
                  placeholder={descontoTipo === 'porcentagem' ? '10' : '0,00'}
                  value={descontoValor}
                  onChange={(val) => setDescontoValor(val ? String(val) : '')}
                  wrapperClassName="min-h-[34px]"
                />

                <input
                  type="text"
                  placeholder="Motivo do desconto (obrigatório)*"
                  value={descontoMotivo}
                  onChange={(e) => setDescontoMotivo(e.target.value)}
                  className={`bg-graphite-900 border rounded px-2.5 py-1.5 text-xs text-vapor-100 outline-none focus:border-amber-500 ${
                    numDesconto > 0 && !descontoMotivo.trim()
                      ? 'border-amber-500/80 bg-amber-500/5'
                      : 'border-graphite-700'
                  }`}
                />
              </div>
            </div>

            {/* Total e Abatimento do Sinal */}
            <div className="p-3 bg-graphite-950 rounded-lg border border-graphite-800 flex flex-col gap-2 font-mono text-xs">
              <div className="flex justify-between items-center text-vapor-300">
                <span>Total Bruto dos Serviços:</span>
                <span className="font-bold text-vapor-100">{formatarMoeda(valorTotalBruto)}</span>
              </div>

              {valorDesconto > 0 && (
                <div className="flex justify-between items-center text-amber-400">
                  <span>− Desconto ({descontoTipo === 'porcentagem' ? `${descontoValor}%` : formatarMoeda(valorDesconto)}):</span>
                  <span className="font-bold">− {formatarMoeda(valorDesconto)}</span>
                </div>
              )}

              {sinalPago > 0 && (
                <div className="flex justify-between items-center text-mint-400">
                  <span>− Sinal Pago Antecipadamente (Pix):</span>
                  <span className="font-bold">− {formatarMoeda(sinalPago)}</span>
                </div>
              )}

              <div className="flex justify-between items-center text-sm pt-2 border-t border-graphite-800 text-amber-400 font-bold">
                <span>Saldo Restante a Receber:</span>
                <span className="text-base">{formatarMoeda(saldoRestante)}</span>
              </div>
            </div>

            {/* LANÇAMENTO DE PAGAMENTOS */}
            {saldoRestante > 0 && (
              <div className="flex flex-col gap-3 pt-2 border-t border-graphite-700">
                <span className="text-xs font-bold text-vapor-200 uppercase tracking-wider flex items-center gap-1.5">
                  <CreditCard size={14} className="text-amber-500" />
                  Recebimento do Saldo
                </span>

                {/* Lista de pagamentos já lançados */}
                {pagamentosLancados.map((p) => (
                  <div key={p.id} className="p-2.5 rounded bg-graphite-800 border border-graphite-700 flex items-center justify-between text-xs font-mono">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-vapor-100">{p.forma_nome} {p.total_parcelas > 1 ? `(${p.total_parcelas}x)` : ''}</span>
                        {p.maquininha_nome && (
                          <span className="text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                            {p.maquininha_nome} {p.bandeira_codigo ? `• ${p.bandeira_codigo.toUpperCase()}` : ''}
                          </span>
                        )}
                        {p.taxa_estimada && (
                          <span className="text-[9px] font-bold text-amber-300 bg-amber-500/20 px-1.5 py-0.5 rounded">
                            Taxa Estimada (0%)
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-vapor-400">Vencimento: {p.previsto_para.split('-').reverse().join('/')}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-amber-400">{formatarMoeda(p.valor_bruto)}</span>
                      <button type="button" onClick={() => handleRemovePagamento(p.id)} className="text-vapor-400 hover:text-flare-400">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}

                {/* Adicionar novo pagamento */}
                {(() => {
                  const formaSelecionada = formasPagamento.find((f) => f.id === novoFormaId);
                  const isCartao = formaSelecionada?.tipo === 'debito' || formaSelecionada?.tipo === 'credito';

                  return (
                    <div className="flex flex-col gap-2 pt-1">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <select
                          value={novoFormaId}
                          onChange={(e) => setNovoFormaId(e.target.value)}
                          className="bg-graphite-950 border border-graphite-700 rounded px-2.5 py-1.5 text-xs text-vapor-100 outline-none focus:border-amber-500"
                        >
                          {formasPagamento.map((f) => (
                            <option key={f.id} value={f.id}>{f.nome}</option>
                          ))}
                        </select>

                        {formaSelecionada?.permite_parcelar && (
                          <select
                            value={novoParcelas}
                            onChange={(e) => setNovoParcelas(e.target.value)}
                            className="bg-graphite-950 border border-graphite-700 rounded px-2.5 py-1.5 text-xs text-vapor-100 outline-none focus:border-amber-500 font-mono"
                          >
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((num) => (
                              <option key={num} value={num}>{num}x</option>
                            ))}
                          </select>
                        )}

                        <CampoNumerico
                          prefix="R$"
                          placeholder="Valor R$"
                          value={novoValor}
                          onChange={(val) => setNovoValor(val ? String(val) : '')}
                          wrapperClassName="min-h-[34px]"
                        />
                      </div>

                      {/* Campos adicionais para Cartão (Maquininha e Bandeira) */}
                      {isCartao && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-2 rounded bg-graphite-950/80 border border-graphite-800">
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-vapor-400 font-semibold uppercase">Maquininha</label>
                            <select
                              value={novoMaquininhaId}
                              onChange={(e) => setNovoMaquininhaId(e.target.value)}
                              className="bg-graphite-900 border border-graphite-700 rounded px-2 py-1 text-xs text-vapor-100 outline-none focus:border-amber-500"
                            >
                              {maquininhas.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.nome} {m.padrao ? '(Padrão)' : ''}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-vapor-400 font-semibold uppercase">Bandeira (Opcional)</label>
                            <select
                              value={novoBandeiraCodigo}
                              onChange={(e) => setNovoBandeiraCodigo(e.target.value)}
                              className="bg-graphite-900 border border-graphite-700 rounded px-2 py-1 text-xs text-vapor-100 outline-none focus:border-amber-500"
                            >
                              <option value="">Padrão / Não informada</option>
                              {bandeiras.map((b) => (
                                <option key={b.codigo} value={b.codigo}>{b.nome}</option>
                              ))}
                            </select>
                          </div>

                          {taxaInfoAviso && (
                            <div className="col-span-full pt-1">
                              {taxaInfoAviso.estimada ? (
                                <span className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 p-1.5 rounded flex items-center gap-1.5 font-mono">
                                  <AlertTriangle size={12} className="shrink-0 text-amber-400" />
                                  Taxa não cadastrada para {novoParcelas}x. Será considerada 0% (Taxa estimada).
                                </span>
                              ) : (
                                <span className="text-[11px] text-mint-400 font-mono flex items-center gap-1">
                                  ✓ Taxa aplicável: {taxaInfoAviso.percentual}%
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                <Button type="button" variant="secondary" onClick={handleAddPagamento} className="text-xs py-1.5">
                  <Plus size={14} />
                  <span>Adicionar Pagamento</span>
                </Button>

                {/* Status da soma dos pagamentos */}
                <div className={`p-2.5 rounded text-xs font-mono flex items-center justify-between ${
                  Math.abs(diferencaPagamentos) < 0.01
                    ? 'bg-mint-500/10 text-mint-400 border border-mint-500/30'
                    : 'bg-amber-500/10 text-amber-300 border border-amber-500/30'
                }`}>
                  <span>Lançado: {formatarMoeda(somaPagamentosLancados)} / Restante: {formatarMoeda(saldoRestante)}</span>
                  {Math.abs(diferencaPagamentos) >= 0.01 && (
                    <span className="font-bold text-amber-400">Dif: {formatarMoeda(diferencaPagamentos)}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <Button
          type="button"
          variant="primary"
          onClick={handleConcluir}
          disabled={loading || (!modoDefinirValorOnly && pendingRequiredCount > 0) || (podeVerValor && saldoRestante > 0 && Math.abs(diferencaPagamentos) >= 0.01)}
          className="w-full min-h-[56px] text-[16px] font-bold tracking-wide uppercase mt-2 shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? 'Salvando...' : (
            <>
              <CheckCircle2 size={20} />
              <span>Concluir Atendimento</span>
            </>
          )}
        </Button>
      </div>
    </Modal>
  );
};
