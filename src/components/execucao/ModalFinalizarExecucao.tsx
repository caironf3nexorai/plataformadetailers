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
  Calendar,
} from 'lucide-react';
import type { ExecucaoFoto } from '../../types/execucao';
import type { ProdutoParaConsumo, ItemConsumoExecucao } from '../../types/estoque';
import { formatarMoeda, parseNumeroFlexivel } from '../../utils/formatters';
import { notificarAtualizacaoTempo } from '../../hooks/useTempoExecucao';
import { Cronometro } from './Cronometro';
import { ModalProduto } from '../estoque/ModalProduto';
import { usePlano } from '../../hooks/usePlano';

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
  numero_parcela?: number;
  valor_bruto: number;
  previsto_para: string;
  observacao?: string;
}

interface ModalFinalizarExecucaoProps {
  isOpen: boolean;
  onClose: () => void;
  execucaoId: string;
  agendamentoId: string;
  tenantId: string;
  placaVeiculo: string;
  tempoFormatado?: string;
  pendingRequiredCount: number;
  pendingRequiredNames?: string[];
  onMarcarTodosPendentes?: () => Promise<void>;
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

const EMPTY_SERVICOS_NOMES: string[] = [];

export const ModalFinalizarExecucao: React.FC<ModalFinalizarExecucaoProps> = ({
  isOpen,
  onClose,
  execucaoId,
  agendamentoId,
  tenantId,
  placaVeiculo,
  tempoFormatado: _tempoProp,
  pendingRequiredCount,
  pendingRequiredNames = [],
  onMarcarTodosPendentes,
  agendamentoItens,
  fotosSaidaExistentes: _fotosSaidaExistentes,
  onSuccess,
  modoRetroativoInicial: _modoRetroativoInicial = false,
  modoDefinirValorOnly = false,
  iniciadoEm: _iniciadoEm,
  duracaoEstimadaMinutos: _duracaoEstimadaMinutos = 60,
  servicosNomes = EMPTY_SERVICOS_NOMES,
  totalChecklistCount,
  concluidosChecklistCount,
}) => {
  const { membership, user: _user } = useAuth();
  const podeVerValor = membership?.role === 'dono' || membership?.role === 'gerente';
  const { planoAtual, temFeature } = usePlano();
  const isPlanoFree = planoAtual === 'free' || !temFeature('relatorios_dre');

  const hasLoadedPrecoRef = useRef(false);
  const [observacoes] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [localPendingCount, setLocalPendingCount] = useState(pendingRequiredCount);
  const [marcandoTodos, setMarcandoTodos] = useState(false);
  const [ignorarPendencias, setIgnorarPendencias] = useState(false);
  const [expandirPendentes, setExpandirPendentes] = useState(false);

  useEffect(() => {
    setLocalPendingCount(pendingRequiredCount);
  }, [pendingRequiredCount]);

  const handleMarcarTodosPendentes = async () => {
    setMarcandoTodos(true);
    setErrorMsg(null);
    try {
      if (onMarcarTodosPendentes) {
        await onMarcarTodosPendentes();
      } else if (execucaoId) {
        const { error: updErr } = await supabase
          .from('execucao_itens')
          .update({
            concluido: true,
            concluido_em: new Date().toISOString(),
          })
          .eq('execucao_id', execucaoId)
          .eq('obrigatorio', true)
          .eq('concluido', false);
        if (updErr) throw updErr;
      }
      setLocalPendingCount(0);
    } catch (err: any) {
      console.error('[handleMarcarTodosPendentes error]:', err);
      setErrorMsg('Não foi possível marcar os itens pendentes automaticamente.');
    } finally {
      setMarcandoTodos(false);
    }
  };

  const [itensPreco, setItensPreco] = useState<ItemPreco[]>([]);

  const [consumos, setConsumos] = useState<ItemConsumoExecucao[]>([]);
  const [_produtosCatalogo, setProdutosCatalogo] = useState<Record<string, { custo_unitario: number }>>({});
  const [produtosDisponiveis, setProdutosDisponiveis] = useState<ProdutoParaConsumo[]>([]);
  const [selectedProdutoId, setSelectedProdutoId] = useState('');
  const [showModalNovoProduto, setShowModalNovoProduto] = useState(false);

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
  const [novoVencimento, setNovoVencimento] = useState(new Date().toISOString().split('T')[0]);
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
            const formasDisponiveis = isPlanoFree
              ? fpData.filter((f) => f.tipo !== 'fiado')
              : fpData;
            setFormasPagamento(formasDisponiveis);
            if (formasDisponiveis.length > 0 && !novoFormaId) {
              setNovoFormaId(formasDisponiveis[0].id);
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

    if (!isOpen) {
      hasLoadedPrecoRef.current = false;
      return;
    }

    if (!hasLoadedPrecoRef.current) {
      hasLoadedPrecoRef.current = true;
      carregarItensPreco();
    }
  }, [isOpen, agendamentoId, execucaoId, tenantId]);

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

  const valorTotalBruto = itensPreco.reduce((acc, curr) => acc + parseNumeroFlexivel(curr.valor_final), 0);
  const numDesconto = parseNumeroFlexivel(descontoValor);
  const valorDesconto = numDesconto > 0
    ? (descontoTipo === 'porcentagem'
        ? Math.round((valorTotalBruto * (numDesconto / 100)) * 100) / 100
        : Math.min(valorTotalBruto, numDesconto))
    : 0;
  const valorTotalComDesconto = Math.max(0, valorTotalBruto - valorDesconto);
  const saldoRestante = Math.max(0, valorTotalComDesconto - sinalPago);
  const somaPagamentosLancados = pagamentosLancados.reduce((acc, p) => acc + p.valor_bruto, 0);
  const diferencaPagamentos = Math.round((saldoRestante - somaPagamentosLancados) * 100) / 100;

  // Se o saldoRestante mudar e houver exatamente 1 pagamento cobrindo o total, ajusta automaticamente
  useEffect(() => {
    if (pagamentosLancados.length === 1) {
      setPagamentosLancados((prev) => [
        {
          ...prev[0],
          valor_bruto: saldoRestante,
        },
      ]);
    } else if (pagamentosLancados.length === 0) {
      setNovoValor(saldoRestante > 0 ? (saldoRestante % 1 === 0 ? String(saldoRestante) : saldoRestante.toFixed(2).replace('.', ',')) : '');
    }
  }, [saldoRestante]);

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

  const handleSalvarNovoProduto = async (data: {
    nome: string;
    marca?: string;
    categoria: string;
    unidade_uso: any;
    tamanho_compra: number;
    preco_compra: number;
    estoque_minimo: number;
    estoque_atual?: number;
  }) => {
    if (!tenantId) return;

    let novoProdutoId = '';
    let custoUnitario = 0;

    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('cadastrar_produto_rapido', {
        p_tenant_id: tenantId,
        p_nome: data.nome,
        p_marca: data.marca || null,
        p_categoria: data.categoria || 'Geral',
        p_unidade_uso: data.unidade_uso || 'ml',
        p_tamanho_compra: data.tamanho_compra,
        p_preco_compra: data.preco_compra || 0,
        p_estoque_minimo: data.estoque_minimo || 0,
        p_estoque_atual: data.estoque_atual || 0,
      });

      if (!rpcErr && rpcRes && rpcRes.id) {
        novoProdutoId = rpcRes.id;
        custoUnitario = rpcRes.custo_unitario || 0;
      } else {
        console.warn('[ModalFinalizarExecucao] RPC cadastrar_produto_rapido falhou, tentando fallback insert direto:', rpcErr);
        const calcCusto = data.tamanho_compra > 0 ? (data.preco_compra || 0) / data.tamanho_compra : 0;
        const { data: directInsert, error: directErr } = await supabase
          .from('produtos')
          .insert({
            tenant_id: tenantId,
            nome: data.nome,
            marca: data.marca || null,
            categoria: data.categoria || 'Geral',
            unidade_uso: data.unidade_uso || 'ml',
            tamanho_compra: data.tamanho_compra,
            preco_compra: data.preco_compra || 0,
            custo_unitario: calcCusto,
            estoque_minimo: data.estoque_minimo || 0,
            estoque_atual: data.estoque_atual || 0,
            ativo: true,
          })
          .select()
          .single();

        if (directErr) throw directErr;
        if (directInsert) {
          novoProdutoId = directInsert.id;
          custoUnitario = directInsert.custo_unitario || 0;
        }
      }

      if (novoProdutoId) {
        const novoProdutoParaConsumo: ProdutoParaConsumo = {
          id: novoProdutoId,
          nome: data.nome,
          marca: data.marca || undefined,
          categoria: data.categoria || 'Geral',
          unidade_uso: data.unidade_uso,
        };

        setProdutosDisponiveis((prev) => {
          const existe = prev.some((p) => p.id === novoProdutoId);
          return existe ? prev : [...prev, novoProdutoParaConsumo];
        });

        setProdutosCatalogo((prev) => ({
          ...prev,
          [novoProdutoId]: { custo_unitario: custoUnitario },
        }));

        // Adiciona automaticamente aos consumos da finalização
        const defaultQtd = data.unidade_uso === 'ml' ? '90' : '10';
        setConsumos((prev) => {
          if (prev.some((c) => c.produto_id === novoProdutoId)) return prev;
          return [
            ...prev,
            {
              produto_id: novoProdutoId,
              nome: data.nome,
              marca: data.marca,
              unidade_uso: data.unidade_uso,
              quantidade: defaultQtd,
              sugerido: false,
            },
          ];
        });

        setSelectedProdutoId('');
        setShowModalNovoProduto(false);
      }
    } catch (err: any) {
      console.error('[handleSalvarNovoProduto Error]:', err);
      throw err;
    }
  };

  // Adicionar lançamento de pagamento no frontend
  const handleAddPagamento = async () => {
    if (!novoFormaId) return;
    const val = parseNumeroFlexivel(novoValor);
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

    if (forma.tipo === 'fiado' && isPlanoFree) {
      setErrorMsg('O parcelamento em Fiado / A Prazo é exclusivo para assinantes a partir do Plano Pro.');
      return;
    }

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

    const gerarItensPagamento = (valorTotal: number): ItemPagamentoLancado[] => {
      if (forma.tipo === 'fiado' && parcelas > 1) {
        const valorBase = Math.floor((valorTotal / parcelas) * 100) / 100;
        let centavosRestantes = Math.round((valorTotal - (valorBase * parcelas)) * 100);

        const itens: ItemPagamentoLancado[] = [];
        const baseDate = new Date(novoVencimento + 'T12:00:00');

        for (let i = 1; i <= parcelas; i++) {
          const parcelaData = new Date(baseDate);
          parcelaData.setMonth(parcelaData.getMonth() + (i - 1));
          const vencStr = parcelaData.toISOString().split('T')[0];

          let valorParcela = valorBase;
          if (centavosRestantes > 0) {
            valorParcela = Math.round((valorParcela + 0.01) * 100) / 100;
            centavosRestantes -= 1;
          }

          itens.push({
            id: Math.random().toString(),
            forma_id: forma.id,
            forma_nome: forma.nome,
            forma_tipo: forma.tipo,
            total_parcelas: parcelas,
            numero_parcela: i,
            valor_bruto: valorParcela,
            previsto_para: vencStr,
            observacao: `Parcela ${i}/${parcelas} combinada para ${vencStr.split('-').reverse().join('/')}`,
          });
        }
        return itens;
      }

      return [
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
          numero_parcela: 1,
          valor_bruto: valorTotal,
          previsto_para: novoVencimento,
          observacao: forma.tipo === 'fiado' ? `Fiado combinado para ${novoVencimento.split('-').reverse().join('/')}` : undefined,
        },
      ];
    };

    setPagamentosLancados((prev) => [...prev, ...gerarItensPagamento(val)]);
    setNovoValor('');
    setErrorMsg(null);
  };

  const handleRemovePagamento = (id: string) => {
    setPagamentosLancados((prev) => prev.filter((p) => p.id !== id));
  };

  // Inserir a diferença exata restante com 1 clique
  const handleInserirDiferenca = async () => {
    if (diferencaPagamentos <= 0) return;
    const forma = formasPagamento.find((f) => f.id === novoFormaId) || formasPagamento[0];
    if (!forma) return;

    if (forma.tipo === 'fiado' && isPlanoFree) {
      setErrorMsg('O parcelamento em Fiado / A Prazo é exclusivo para assinantes a partir do Plano Pro.');
      return;
    }

    const parcelas = parseInt(novoParcelas, 10) || 1;
    let taxaEstimada = false;
    let maqNome = '';

    if (forma.tipo === 'debito' || forma.tipo === 'credito') {
      const maqId = novoMaquininhaId || maquininhas[0]?.id;
      const maqObj = maquininhas.find((m) => m.id === maqId);
      if (maqObj) maqNome = maqObj.nome;

      if (maqId) {
        try {
          const { data: resTaxa } = await supabase.rpc('resolver_taxa_cartao', {
            p_maquininha: maqId,
            p_tipo: forma.tipo,
            p_bandeira: novoBandeiraCodigo || null,
            p_parcelas: parcelas,
          });
          if (resTaxa && resTaxa.length > 0) {
            taxaEstimada = resTaxa[0].taxa_estimada;
          }
        } catch (e) {
          // Ignora
        }
      }
    }

    const gerarItensPagamento = (valorTotal: number): ItemPagamentoLancado[] => {
      if (forma.tipo === 'fiado' && parcelas > 1) {
        const valorBase = Math.floor((valorTotal / parcelas) * 100) / 100;
        let centavosRestantes = Math.round((valorTotal - (valorBase * parcelas)) * 100);

        const itens: ItemPagamentoLancado[] = [];
        const baseDate = new Date(novoVencimento + 'T12:00:00');

        for (let i = 1; i <= parcelas; i++) {
          const parcelaData = new Date(baseDate);
          parcelaData.setMonth(parcelaData.getMonth() + (i - 1));
          const vencStr = parcelaData.toISOString().split('T')[0];

          let valorParcela = valorBase;
          if (centavosRestantes > 0) {
            valorParcela = Math.round((valorParcela + 0.01) * 100) / 100;
            centavosRestantes -= 1;
          }

          itens.push({
            id: Math.random().toString(),
            forma_id: forma.id,
            forma_nome: forma.nome,
            forma_tipo: forma.tipo,
            total_parcelas: parcelas,
            numero_parcela: i,
            valor_bruto: valorParcela,
            previsto_para: vencStr,
            observacao: `Parcela ${i}/${parcelas} combinada para ${vencStr.split('-').reverse().join('/')}`,
          });
        }
        return itens;
      }

      return [
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
          numero_parcela: 1,
          valor_bruto: valorTotal,
          previsto_para: novoVencimento,
          observacao: forma.tipo === 'fiado' ? `Fiado combinado para ${novoVencimento.split('-').reverse().join('/')}` : undefined,
        },
      ];
    };

    setPagamentosLancados((prev) => [...prev, ...gerarItensPagamento(diferencaPagamentos)]);
    setNovoValor('');
    setErrorMsg(null);
  };

  const concluiuRef = useRef(false);

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

      if (isPlanoFree && pagamentosLancados.some((p) => p.forma_tipo === 'fiado')) {
        setErrorMsg('O plano Free não permite finalizações em Fiado / A Prazo. Remova o fiado para continuar ou faça o upgrade para o Plano Pro.');
        return;
      }
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const consumosPayload = consumos
        .filter((c) => parseNumeroFlexivel(c.quantidade) > 0)
        .map((c) => ({
          produto_id: c.produto_id,
          quantidade: parseNumeroFlexivel(c.quantidade),
        }));

      const payloadValores = podeVerValor && itensPreco.length > 0
        ? itensPreco.map((item) => ({
            agendamento_item_id: item.agendamento_item_id,
            valor_final: parseNumeroFlexivel(item.valor_final),
            motivo: item.motivo || null,
          }))
        : [];

      const pagamentosPayload = podeVerValor
        ? pagamentosLancados.map((p) => ({
            forma_id: p.forma_id,
            maquininha_id: p.maquininha_id || null,
            bandeira_codigo: p.bandeira_codigo || null,
            total_parcelas: p.total_parcelas,
            numero_parcela: p.numero_parcela || 1,
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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="xl"
      title={modoDefinirValorOnly ? 'Definir Valor Final do Serviço' : 'Finalizar Execução do Serviço'}
    >
      <div className="w-full min-w-0 max-w-full flex flex-col gap-4 py-1">
        {/* Resumo Compacto da Execução */}
        <div className="p-3 sm:p-3.5 bg-graphite-900 border border-graphite-700 rounded-lg flex flex-col gap-2.5 w-full min-w-0 max-w-full box-border overflow-hidden">
          <div className="flex items-center justify-between min-w-0">
            <span className="font-mono text-[18px] sm:text-[20px] font-bold text-vapor-100 tracking-tight truncate">
              {placaVeiculo || 'Sem Veículo'}
            </span>
          </div>

          {servicosNomes && servicosNomes.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-graphite-800 min-w-0">
              <span className="text-[11px] text-vapor-400 font-sans uppercase font-medium shrink-0">Serviços:</span>
              <span className="text-[13px] text-vapor-200 font-sans font-semibold break-words min-w-0">
                {servicosNomes.join(' • ')}
              </span>
            </div>
          )}

          <div className="pt-2 border-t border-graphite-800 min-w-0">
            {totalChecklistCount !== undefined && totalChecklistCount > 0 ? (
              <span className="inline-block text-[11.5px] sm:text-[12px] font-mono font-semibold text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-md border border-amber-500/20 max-w-full break-words">
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
        <div className="p-3.5 sm:p-4 bg-graphite-900 border border-graphite-700 rounded-lg flex items-center justify-between gap-2 w-full min-w-0 max-w-full box-border">
          <div className="flex items-center gap-3 min-w-0">
            <Clock size={24} className="shrink-0 text-amber-400" />
            <div className="min-w-0">
              <span className="text-[11px] uppercase font-sans text-vapor-400 block font-medium">Tempo Total Decorrido</span>
              <Cronometro
                execucaoId={execucaoId}
                tamanho="medio"
                exibirAbertoDesde={false}
              />
            </div>
          </div>
        </div>

        {localPendingCount > 0 && (
          <div className="p-3.5 sm:p-4 bg-flare-400/10 border border-flare-400/30 rounded-lg flex flex-col gap-3 text-flare-400 w-full min-w-0 max-w-full box-border">
            <div className="flex items-center justify-between gap-2 flex-wrap min-w-0">
              <div className="flex items-center gap-2 font-semibold text-[13px] sm:text-[14px] min-w-0">
                <AlertTriangle size={18} className="shrink-0" />
                <span className="break-words">{localPendingCount} item(ns) obrigatório(s) pendente(s)</span>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {pendingRequiredNames && pendingRequiredNames.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setExpandirPendentes((prev) => !prev)}
                    className="text-xs text-vapor-300 hover:text-vapor-100 underline decoration-dotted transition-colors"
                  >
                    {expandirPendentes ? 'Ocultar itens' : 'Ver quais são'}
                  </button>
                )}

                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={marcandoTodos}
                  onClick={handleMarcarTodosPendentes}
                  className="text-xs h-7 px-2.5 bg-flare-400/20 hover:bg-flare-400/30 text-vapor-100 border-flare-400/40"
                >
                  {marcandoTodos ? 'Marcando...' : 'Marcar todos como feitos'}
                </Button>
              </div>
            </div>

            {expandirPendentes && pendingRequiredNames && pendingRequiredNames.length > 0 && (
              <div className="text-[12px] bg-graphite-950/80 p-3 rounded-md border border-flare-400/20 flex flex-col gap-1 max-h-48 overflow-y-auto">
                <span className="font-semibold text-vapor-200">Etapas pendentes:</span>
                <ul className="list-disc list-inside space-y-1 text-vapor-300">
                  {pendingRequiredNames.map((nome, idx) => (
                    <li key={idx} className="leading-snug break-words">{nome}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="pt-2 border-t border-flare-400/20 flex items-center justify-between min-w-0">
              <label className="flex items-center gap-2 text-[12px] sm:text-[12.5px] text-vapor-300 cursor-pointer select-none min-w-0">
                <input
                  type="checkbox"
                  checked={ignorarPendencias}
                  onChange={(e) => setIgnorarPendencias(e.target.checked)}
                  className="w-4 h-4 rounded text-amber-500 bg-graphite-900 border-graphite-700 focus:ring-0 cursor-pointer shrink-0"
                />
                <span className="min-w-0 break-words leading-tight">Liberar finalização sem preencher checklist obrigatório</span>
              </label>
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
        <div className="p-3.5 sm:p-4 bg-graphite-900 border border-graphite-700 rounded-lg flex flex-col gap-3.5 w-full min-w-0 max-w-full box-border">
          <div className="flex items-center justify-between border-b border-graphite-700 pb-2 min-w-0">
            <div className="flex items-center gap-2 text-amber-500 font-semibold text-[14px] sm:text-[15px] min-w-0">
              <Package size={18} className="shrink-0" />
              <span className="truncate">O que foi usado neste serviço?</span>
            </div>
            <button
              type="button"
              onClick={() => setShowModalNovoProduto(true)}
              className="text-xs font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-1 transition-colors px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 shrink-0"
            >
              <Plus size={14} />
              <span>+ Produto</span>
            </button>
          </div>

          {consumos.map((item) => (
            <div key={item.produto_id} className="flex items-center justify-between gap-2 p-2.5 bg-graphite-800 rounded border border-graphite-700 w-full min-w-0 max-w-full box-border">
              <span className="text-[13px] font-medium text-vapor-100 min-w-0 flex-1 truncate">{item.nome}</span>
              <div className="flex items-center gap-2 shrink-0">
                <input
                  type="text"
                  value={item.quantidade}
                  onChange={(e) => handleUpdateConsumoQtd(item.produto_id, e.target.value)}
                  className="w-16 sm:w-20 text-right font-mono text-[14px] p-1.5 bg-graphite-900 border border-graphite-700 rounded text-vapor-100 min-w-0"
                />
                <button type="button" onClick={() => handleRemoveConsumo(item.produto_id)} className="text-vapor-400 hover:text-flare-400 p-1 shrink-0">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}

          <div className="flex flex-col gap-2 pt-2 border-t border-graphite-700 min-w-0">
            <select
              value={selectedProdutoId}
              onChange={(e) => setSelectedProdutoId(e.target.value)}
              className="w-full bg-graphite-700 text-vapor-100 border border-graphite-600 rounded-md p-2.5 sm:p-3 text-[13px] sm:text-[14px] min-w-0 max-w-full"
            >
              <option value="">-- Selecionar produto consumido --</option>
              {produtosDisponiveis.map((p) => (
                <option key={p.id} value={p.id}>{p.nome} {p.marca ? `(${p.marca})` : ''}</option>
              ))}
            </select>
            <div className="flex items-center justify-between gap-2 flex-wrap pt-1 min-w-0">
              <button
                type="button"
                onClick={() => setShowModalNovoProduto(true)}
                className="text-[12px] text-vapor-400 hover:text-amber-400 transition-colors flex items-center gap-1 underline underline-offset-2 min-w-0"
              >
                <Plus size={13} className="shrink-0" />
                <span className="truncate">Não encontrou o produto? Cadastre aqui</span>
              </button>
              <Button type="button" variant="secondary" size="sm" onClick={handleAddProdutoConsumo} disabled={!selectedProdutoId} className="shrink-0">
                <Plus size={16} />
                <span>Adicionar Produto</span>
              </Button>
            </div>
          </div>
        </div>

        {/* VALORES E FORMAS DE PAGAMENTO (APENAS GESTÃO) */}
        {podeVerValor && (
          <div className="p-3.5 sm:p-4 bg-graphite-900 border border-graphite-700 rounded-lg flex flex-col gap-4 w-full min-w-0 max-w-full box-border">
            <div className="flex items-center justify-between border-b border-graphite-700 pb-2 min-w-0">
              <div className="flex items-center gap-2 text-amber-500 font-semibold text-[14px] sm:text-[15px] min-w-0">
                <DollarSign size={18} className="shrink-0" />
                <span className="truncate">Valores & Formas de Pagamento</span>
              </div>
            </div>

            {/* Valores por serviço */}
            <div className="flex flex-col gap-3 min-w-0">
              {itensPreco.map((item) => (
                <div key={item.agendamento_item_id} className="flex items-center justify-between gap-2.5 p-3 bg-graphite-800 rounded-lg border border-graphite-700 w-full min-w-0 max-w-full box-border">
                  <span className="text-[13px] font-medium text-vapor-100 min-w-0 flex-1 break-words">{item.servico_nome}</span>
                  <div className="relative w-28 sm:w-36 shrink-0">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-mono text-vapor-400">R$</span>
                    <input
                      type="text"
                      value={item.valor_final}
                      onChange={(e) => handleItemValorChange(item.agendamento_item_id, e.target.value)}
                      className="w-full pl-8 pr-2.5 py-2 text-right font-mono text-sm font-bold bg-graphite-900 border border-graphite-700 rounded text-vapor-100 outline-none focus:border-amber-500 min-w-0"
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Bloco de Concessão de Desconto na Finalização */}
            <div className="p-3 sm:p-3.5 bg-graphite-950 rounded-xl border border-graphite-800 flex flex-col gap-3 w-full min-w-0 max-w-full box-border">
              <span className="text-xs font-bold text-vapor-200 uppercase tracking-wider flex items-center gap-1.5 min-w-0">
                <Percent size={14} className="text-amber-500 shrink-0" />
                <span>Desconto na Finalização (Opcional)</span>
              </span>

              {/* Linha 1: Tipo de Desconto & Valor */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 min-w-0">
                <div className="min-w-0">
                  <label className="text-[10px] text-vapor-400 font-semibold uppercase tracking-wider block mb-1">
                    Tipo de Desconto
                  </label>
                  <select
                    value={descontoTipo}
                    onChange={(e) => setDescontoTipo(e.target.value as any)}
                    className="w-full bg-graphite-900 border border-graphite-700 rounded-lg px-3 py-2.5 text-xs text-vapor-100 outline-none focus:border-amber-500 font-sans min-h-[44px]"
                  >
                    <option value="porcentagem">Percentual (%)</option>
                    <option value="valor_fixo">Valor Fixo (R$)</option>
                  </select>
                </div>

                <div className="min-w-0">
                  <label className="text-[10px] text-vapor-400 font-semibold uppercase tracking-wider block mb-1">
                    {descontoTipo === 'porcentagem' ? 'Porcentagem (%)' : 'Valor do Desconto (R$)'}
                  </label>
                  <CampoNumerico
                    prefix={descontoTipo === 'valor_fixo' ? 'R$' : undefined}
                    suffix={descontoTipo === 'porcentagem' ? '%' : undefined}
                    placeholder={descontoTipo === 'porcentagem' ? '10' : '0,00'}
                    value={descontoValor}
                    onChange={(_val, str) => setDescontoValor(str)}
                    wrapperClassName="min-h-[44px] bg-graphite-900 w-full min-w-0 max-w-full"
                  />
                </div>
              </div>

              {/* Linha 2: Motivo do Desconto */}
              <div className="min-w-0">
                <label className="text-[10px] text-vapor-400 font-semibold uppercase tracking-wider block mb-1">
                  Motivo do Desconto {numDesconto > 0 ? '(Obrigatório)*' : '(Opcional)'}
                </label>
                <input
                  type="text"
                  placeholder="Ex: Cortesia comercial, cliente fidelidade, etc."
                  value={descontoMotivo}
                  onChange={(e) => setDescontoMotivo(e.target.value)}
                  className={`w-full bg-graphite-900 border rounded-lg px-3 py-2.5 text-xs text-vapor-100 placeholder:text-graphite-500 outline-none focus:border-amber-500 min-h-[44px] ${
                    numDesconto > 0 && !descontoMotivo.trim()
                      ? 'border-amber-500/80 bg-amber-500/5'
                      : 'border-graphite-700'
                  }`}
                />
              </div>
            </div>

            {/* Total e Abatimento do Sinal */}
            <div className="p-3.5 sm:p-4 bg-graphite-950 rounded-xl border border-graphite-800 flex flex-col gap-2 font-mono text-xs w-full min-w-0 max-w-full box-border">
              <div className="flex justify-between items-center text-vapor-300 min-w-0">
                <span className="truncate">Total Bruto dos Serviços:</span>
                <span className="font-bold text-vapor-100 shrink-0">{formatarMoeda(valorTotalBruto)}</span>
              </div>

              {valorDesconto > 0 && (
                <div className="flex justify-between items-center text-amber-400 min-w-0">
                  <span className="truncate">− Desconto ({descontoTipo === 'porcentagem' ? `${descontoValor}%` : formatarMoeda(valorDesconto)}):</span>
                  <span className="font-bold shrink-0">− {formatarMoeda(valorDesconto)}</span>
                </div>
              )}

              {sinalPago > 0 && (
                <div className="flex justify-between items-center text-mint-400 min-w-0">
                  <span className="truncate">− Sinal Pago Antecipadamente (Pix):</span>
                  <span className="font-bold shrink-0">− {formatarMoeda(sinalPago)}</span>
                </div>
              )}

              <div className="flex justify-between items-center text-sm pt-2 border-t border-graphite-800 text-amber-400 font-bold min-w-0">
                <span>Saldo Restante a Receber:</span>
                <span className="text-base shrink-0">{formatarMoeda(saldoRestante)}</span>
              </div>
            </div>

            {/* LANÇAMENTO DE PAGAMENTOS */}
            {saldoRestante > 0 && (
              <div className="flex flex-col gap-3.5 pt-2 border-t border-graphite-700 w-full min-w-0 max-w-full box-border">
                <span className="text-xs font-bold text-vapor-200 uppercase tracking-wider flex items-center gap-1.5 min-w-0">
                  <CreditCard size={14} className="text-amber-500 shrink-0" />
                  <span>Recebimento do Saldo</span>
                </span>

                {/* Lista de pagamentos já lançados */}
                {pagamentosLancados.map((p) => (
                  <div key={p.id} className="p-3 sm:p-3.5 rounded-xl bg-graphite-800 border border-graphite-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs font-mono w-full min-w-0 max-w-full box-border">
                    <div className="flex flex-col gap-1 min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                        <span className="font-bold text-vapor-100 text-sm">
                          {p.forma_nome} {p.total_parcelas > 1 ? `(${p.numero_parcela ? `Parcela ${p.numero_parcela}/${p.total_parcelas}` : `${p.total_parcelas}x`})` : ''}
                        </span>
                        {p.maquininha_nome && (
                          <span className="text-[11px] font-sans text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 max-w-full truncate">
                            {p.maquininha_nome} {p.bandeira_codigo ? `• ${p.bandeira_codigo.toUpperCase()}` : ''}
                          </span>
                        )}
                        {p.taxa_estimada && (
                          <span className="text-[9px] font-sans font-bold text-amber-300 bg-amber-500/20 px-1.5 py-0.5 rounded shrink-0">
                            Taxa Estimada (0%)
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-vapor-400">Vencimento: {p.previsto_para.split('-').reverse().join('/')}</span>
                      {p.observacao && (
                        <span className="text-[10px] text-vapor-500 italic break-words">{p.observacao}</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between sm:justify-end gap-3 pt-1.5 sm:pt-0 border-t sm:border-t-0 border-graphite-700/60 shrink-0">
                      <span className="font-bold text-amber-400 text-base">{formatarMoeda(p.valor_bruto)}</span>
                      <button
                        type="button"
                        onClick={() => handleRemovePagamento(p.id)}
                        className="p-2 text-vapor-400 hover:text-flare-400 transition-colors rounded-lg hover:bg-graphite-700 shrink-0"
                        title="Remover pagamento"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}

                {/* Bloco Adicionar novo pagamento ou Confirmação de Quitado */}
                {(() => {
                  const saldoTotalmenteLancado = diferencaPagamentos <= 0.009 && pagamentosLancados.length > 0;

                  if (saldoTotalmenteLancado) {
                    return (
                      <div className="p-3.5 bg-mint-500/10 border border-mint-500/30 rounded-xl flex items-center justify-between text-xs font-mono text-mint-400 w-full min-w-0 max-w-full box-border">
                        <div className="flex items-center gap-2 min-w-0">
                          <CheckCircle2 size={18} className="text-mint-400 shrink-0" />
                          <span className="font-semibold break-words">
                            Valor total 100% coberto pelos pagamentos lançados ({formatarMoeda(somaPagamentosLancados)})
                          </span>
                        </div>
                      </div>
                    );
                  }

                  const formaSelecionada = formasPagamento.find((f) => f.id === novoFormaId);
                  const isCartao = formaSelecionada?.tipo === 'debito' || formaSelecionada?.tipo === 'credito';

                  return (
                    <div className="p-3 sm:p-3.5 bg-graphite-950/80 rounded-xl border border-graphite-800 flex flex-col gap-3 w-full min-w-0 max-w-full box-border overflow-hidden">
                      {/* Linha 1: Forma de Pagamento & Parcelas */}
                      <div className="flex flex-col sm:flex-row gap-2.5 w-full min-w-0">
                        <div className="flex-1 min-w-0">
                          <label className="text-[10px] text-vapor-400 font-semibold uppercase tracking-wider block mb-1">
                            Forma de Pagamento
                          </label>
                          <select
                            value={novoFormaId}
                            onChange={(e) => {
                              setErrorMsg(null);
                              setNovoFormaId(e.target.value);
                            }}
                            className="w-full min-w-0 max-w-full bg-graphite-900 border border-graphite-700 rounded-lg px-3 py-2.5 text-xs text-vapor-100 outline-none focus:border-amber-500 font-sans min-h-[44px]"
                          >
                            {formasPagamento
                              .filter((f) => !isPlanoFree || f.tipo !== 'fiado')
                              .map((f) => (
                                <option
                                  key={f.id}
                                  value={f.id}
                                >
                                  {f.nome}
                                </option>
                              ))}
                          </select>
                        </div>

                        {formaSelecionada?.permite_parcelar && (
                          <div className="w-full sm:w-28 shrink-0 min-w-0">
                            <label className="text-[10px] text-vapor-400 font-semibold uppercase tracking-wider block mb-1">
                              Parcelas
                            </label>
                            <select
                              value={novoParcelas}
                              onChange={(e) => setNovoParcelas(e.target.value)}
                              className="w-full min-w-0 max-w-full bg-graphite-900 border border-graphite-700 rounded-lg px-3 py-2.5 text-xs text-vapor-100 outline-none focus:border-amber-500 font-mono text-center min-h-[44px]"
                            >
                              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((num) => (
                                <option key={num} value={num}>{num}x</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>

                      {/* Linha 2 (Cartão): Maquininha & Bandeira */}
                      {isCartao && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-graphite-800/80 w-full min-w-0">
                          <div className="min-w-0">
                            <label className="text-[10px] text-vapor-400 font-semibold uppercase tracking-wider block mb-1">
                              Maquininha
                            </label>
                            <select
                              value={novoMaquininhaId}
                              onChange={(e) => setNovoMaquininhaId(e.target.value)}
                              className="w-full min-w-0 max-w-full bg-graphite-900 border border-graphite-700 rounded-lg px-3 py-2 text-xs text-vapor-100 outline-none focus:border-amber-500 min-h-[44px]"
                            >
                              {maquininhas.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.nome} {m.padrao ? '(Padrão)' : ''}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="min-w-0">
                            <label className="text-[10px] text-vapor-400 font-semibold uppercase tracking-wider block mb-1">
                              Bandeira (Opcional)
                            </label>
                            <select
                              value={novoBandeiraCodigo}
                              onChange={(e) => setNovoBandeiraCodigo(e.target.value)}
                              className="w-full min-w-0 max-w-full bg-graphite-900 border border-graphite-700 rounded-lg px-3 py-2 text-xs text-vapor-100 outline-none focus:border-amber-500 min-h-[44px]"
                            >
                              <option value="">Padrão / Não informada</option>
                              {bandeiras.map((b) => (
                                <option key={b.codigo} value={b.codigo}>{b.nome}</option>
                              ))}
                            </select>
                          </div>

                          {taxaInfoAviso && (
                            <div className="col-span-full pt-1 min-w-0">
                              {taxaInfoAviso.estimada ? (
                                <span className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 p-2 rounded-lg flex items-center gap-1.5 font-mono break-words leading-tight">
                                  <AlertTriangle size={14} className="shrink-0 text-amber-400" />
                                  Taxa não cadastrada para {novoParcelas}x. Será considerada 0% (Taxa estimada).
                                </span>
                              ) : (
                                <span className="text-[11px] text-mint-400 font-mono flex items-center gap-1 bg-mint-500/10 border border-mint-500/20 p-1.5 rounded-lg">
                                  ✓ Taxa aplicável: {taxaInfoAviso.percentual}%
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Linha para Data de Vencimento / Data Combinada (Especialmente para Fiado / A Prazo) */}
                      {(formaSelecionada?.tipo === 'fiado' || formaSelecionada?.tipo === 'boleto' || formaSelecionada?.tipo === 'outros') && (
                        <div className="p-3 bg-graphite-900 border border-amber-500/30 rounded-xl flex flex-col gap-2.5 w-full min-w-0 max-w-full box-border overflow-hidden">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 w-full min-w-0">
                            <label className="text-[10.5px] text-amber-400 font-bold uppercase tracking-wider flex items-center gap-1.5 min-w-0">
                              <Calendar size={13} className="shrink-0 text-amber-400" />
                              <span className="break-words leading-tight">
                                {parseInt(novoParcelas, 10) > 1 ? 'Data da 1ª Parcela (1º Vencimento)' : 'Data Combinada para Pagamento (Vencimento)'}
                              </span>
                            </label>
                            {parseInt(novoParcelas, 10) > 1 && (
                              <span className="text-[10px] text-vapor-400 font-mono shrink-0 self-start sm:self-auto bg-graphite-950 px-2 py-0.5 rounded border border-graphite-800">
                                Parcelamento mensal (+30 dias)
                              </span>
                            )}
                          </div>
                          <input
                            type="date"
                            value={novoVencimento}
                            onChange={(e) => setNovoVencimento(e.target.value)}
                            className="w-full min-w-0 max-w-full block box-border bg-graphite-950 border border-graphite-700 rounded-lg px-3 py-2.5 text-xs text-vapor-100 outline-none focus:border-amber-500 font-mono [color-scheme:dark] min-h-[44px]"
                          />
                          <span className="text-[11px] text-vapor-400 leading-relaxed block break-words">
                            {parseInt(novoParcelas, 10) > 1
                              ? `Ao finalizar, serão criadas ${novoParcelas} parcelas mensais no módulo Contas a Receber com vencimento a cada 30 dias.`
                              : 'Este valor não entrará no caixa de hoje e ficará pendente no Contas a Receber até a data combinada.'}
                          </span>
                        </div>
                      )}

                      {/* Linha 3: Valor a Lançar */}
                      <div className="w-full min-w-0 max-w-full">
                        <label className="text-[10px] text-vapor-400 font-semibold uppercase tracking-wider block mb-1">
                          Valor a Lançar nesta Forma
                        </label>
                        <CampoNumerico
                          prefix="R$"
                          placeholder="0,00"
                          value={novoValor}
                          onChange={(_val, str) => setNovoValor(str)}
                          wrapperClassName="min-h-[44px] bg-graphite-900 w-full min-w-0 max-w-full"
                          className="text-base font-bold text-amber-400"
                        />
                      </div>

                      <Button
                        type="button"
                        variant="secondary"
                        onClick={handleAddPagamento}
                        className="w-full min-h-[44px] py-2.5 text-xs font-semibold uppercase tracking-wide mt-1 flex items-center justify-center gap-1.5"
                      >
                        <Plus size={15} />
                        <span>Adicionar Pagamento</span>
                      </Button>
                    </div>
                  );
                })()}

                {/* Status da soma dos pagamentos */}
                <div className={`p-3 sm:p-3.5 rounded-xl text-xs font-mono flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 w-full min-w-0 max-w-full box-border ${
                  Math.abs(diferencaPagamentos) < 0.01
                    ? 'bg-mint-500/10 text-mint-400 border border-mint-500/30'
                    : 'bg-amber-500/10 text-amber-300 border border-amber-500/30'
                }`}>
                  <div className="flex items-center gap-x-2.5 gap-y-1 flex-wrap min-w-0">
                    <span>Total: <strong className="text-vapor-100">{formatarMoeda(saldoRestante)}</strong></span>
                    <span className="text-vapor-600 hidden sm:inline">•</span>
                    <span>Lançado: <strong className="text-vapor-100">{formatarMoeda(somaPagamentosLancados)}</strong></span>
                    <span className="text-vapor-600 hidden sm:inline">•</span>
                    <span>Falta: <strong className="text-vapor-100">{formatarMoeda(Math.max(0, diferencaPagamentos))}</strong></span>
                  </div>
                  {diferencaPagamentos > 0.01 && (
                    <span className="font-bold text-amber-400 whitespace-nowrap shrink-0 self-start sm:self-auto">
                      Diferença: {formatarMoeda(diferencaPagamentos)}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Rodapé com Ação de Inserir Diferença e Concluir */}
        <div className="flex flex-col sm:flex-row gap-2.5 mt-2 w-full min-w-0">
          {podeVerValor && saldoRestante > 0 && diferencaPagamentos > 0.01 && (
            <Button
              type="button"
              variant="secondary"
              onClick={handleInserirDiferenca}
              className="w-full sm:w-1/2 min-h-[48px] sm:min-h-[56px] text-xs font-bold uppercase tracking-wide border-amber-500/50 text-amber-400 hover:bg-amber-500/10 flex items-center justify-center gap-2"
            >
              <Plus size={18} className="text-amber-400 shrink-0" />
              <span className="truncate">Inserir Diferença ({formatarMoeda(diferencaPagamentos)})</span>
            </Button>
          )}

          <Button
            type="button"
            variant="primary"
            onClick={handleConcluir}
            disabled={loading || (!modoDefinirValorOnly && localPendingCount > 0 && !ignorarPendencias) || (podeVerValor && saldoRestante > 0 && diferencaPagamentos > 0.01)}
            className={`${podeVerValor && saldoRestante > 0 && diferencaPagamentos > 0.01 ? 'w-full sm:w-1/2' : 'w-full'} min-h-[48px] sm:min-h-[56px] text-[15px] sm:text-[16px] font-bold tracking-wide uppercase shadow-lg disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2`}
          >
            {loading ? 'Salvando...' : (
              <>
                <CheckCircle2 size={20} className="shrink-0" />
                <span>Concluir Atendimento</span>
              </>
            )}
          </Button>
        </div>
      </div>
      <ModalProduto
        isOpen={showModalNovoProduto}
        onClose={() => setShowModalNovoProduto(false)}
        onSave={handleSalvarNovoProduto}
      />
    </Modal>
  );
};
