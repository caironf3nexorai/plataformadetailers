import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { CampoNumerico } from '../ui/CampoNumerico';
import { ModalServicoRapido } from '../orcamentos/ModalServicoRapido';
import { ModalProduto } from '../estoque/ModalProduto';
import { CadastroRapidoModal } from '../clientes/CadastroRapidoModal';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { formatarMoeda } from '../../utils/formatters';
import type { Cliente, Veiculo } from '../../types/clientes';
import type { Produto, UnidadeUso } from '../../types/estoque';
import {
  Calendar,
  Clock,
  Car,
  User,
  Plus,
  Trash2,
  CheckCircle2,
  CreditCard,
  Sparkles,
  Wrench,
  Package,
} from 'lucide-react';

interface ServicoItem {
  id: string;
  nome: string;
  grupo?: string;
  duracao_minutos: number;
  preco_padrao: number;
  servico_precos?: any[];
}

interface ServicoSelecionado {
  servico_id: string;
  nome: string;
  duracao_minutos: number;
  valor: number;
}

interface MembroEquipe {
  id: string;
  user_id?: string | null;
  email: string;
  nome: string;
  role: string;
  status?: string;
}

interface FormaPagamento {
  id: string;
  nome: string;
  tipo: string;
  permite_parcelar?: boolean;
}

interface ProdutoItemConsumo {
  produto_id: string;
  nome: string;
  marca?: string;
  unidade_uso: string;
  quantidade: string;
  custo_unitario: number;
}

interface ModalLancarServicoRetroativoProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (resultado: { agendamentoId: string; execucaoId: string; numeroOS: number }) => void;
}

export const ModalLancarServicoRetroativo: React.FC<ModalLancarServicoRetroativoProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { tenant } = useAuth();
  const { showSuccess, showError } = useToast();

  // Estados de dados do tenant
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [servicosCatalogo, setServicosCatalogo] = useState<ServicoItem[]>([]);
  const [produtosCatalogo, setProdutosCatalogo] = useState<Produto[]>([]);
  const [membrosEquipe, setMembrosEquipe] = useState<MembroEquipe[]>([]);
  const [formasPagamento, setFormasPagamento] = useState<FormaPagamento[]>([]);
  const [carregandoDados, setCarregandoDados] = useState(false);
  const [showModalServicoRapido, setShowModalServicoRapido] = useState(false);
  const [showModalProduto, setShowModalProduto] = useState(false);
  const [showCadastroClienteModal, setShowCadastroClienteModal] = useState(false);

  // Estados do formulário
  const [dataHora, setDataHora] = useState<string>(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  const [clienteId, setClienteId] = useState<string>('');
  const [veiculoId, setVeiculoId] = useState<string>('');
  const [servicosSelecionados, setServicosSelecionados] = useState<ServicoSelecionado[]>([]);
  const [servicoParaAdicionar, setServicoParaAdicionar] = useState<string>('');
  const [produtosConsumidos, setProdutosConsumidos] = useState<ProdutoItemConsumo[]>([]);
  const [produtoParaConsumo, setProdutoParaConsumo] = useState<string>('');
  const [qtdProdutoParaConsumo, setQtdProdutoParaConsumo] = useState<string>('');
  const [tempoExecucaoMinutos, setTempoExecucaoMinutos] = useState<number>(60);
  const [duracaoCustomizada, setDuracaoCustomizada] = useState<boolean>(false);
  const [executorId, setExecutorId] = useState<string>('');
  const [formaPagamentoId, setFormaPagamentoId] = useState<string>('');
  const [parcelas, setParcelas] = useState<number>(1);
  const [observacoes, setObservacoes] = useState<string>('');
  const [salvando, setSalvando] = useState(false);

  // Sincroniza tempo total com a soma dos serviços se o usuário não tiver customizado manualmente
  useEffect(() => {
    if (!duracaoCustomizada && servicosSelecionados.length > 0) {
      const soma = servicosSelecionados.reduce((acc, s) => acc + (Number(s.duracao_minutos) || 60), 0);
      setTempoExecucaoMinutos(soma > 0 ? soma : 60);
    }
  }, [servicosSelecionados, duracaoCustomizada]);

  // Categoria do veículo atualmente selecionado
  const veiculoSelecionadoObj = veiculos.find((v) => v.id === veiculoId);
  const categoriaVeiculoId = veiculoSelecionadoObj?.categoria_id;

  // Carrega catálogo de serviços com precificação e duração da categoria
  const carregarCatalogoServicos = async (catId?: string) => {
    if (!tenant) return;
    try {
      const { data: servs, error: sErr } = await supabase
        .from('servicos')
        .select('id, nome, grupo, servico_precos(id, preco_base, duracao_minutos, categoria_id)')
        .eq('tenant_id', tenant.id)
        .eq('ativo', true)
        .order('nome', { ascending: true });

      if (sErr) throw sErr;

      if (servs) {
        const formatados: ServicoItem[] = servs.map((s: any) => {
          const precos = s.servico_precos || [];
          const precoCat = catId ? precos.find((p: any) => p.categoria_id === catId) : null;
          const precoFinal = Number(precoCat?.preco_base ?? precos[0]?.preco_base ?? 0);
          const duracaoFinal = Number(precoCat?.duracao_minutos ?? precos[0]?.duracao_minutos ?? 60);

          return {
            id: s.id,
            nome: s.nome,
            grupo: s.grupo || 'Geral',
            duracao_minutos: duracaoFinal > 0 ? duracaoFinal : 60,
            preco_padrao: precoFinal,
            servico_precos: precos,
          };
        });
        setServicosCatalogo(formatados);
      }
    } catch (err: any) {
      console.error('[ModalLancarServicoRetroativo] Erro ao carregar serviços:', err);
    }
  };

  // Carrega membros da equipe com resolução de nomes dos perfis
  const carregarMembrosEquipe = async () => {
    if (!tenant) return;
    try {
      const { data: membersData, error: mErr } = await supabase
        .from('tenant_members')
        .select('id, user_id, email, role, status')
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: true });

      if (mErr) throw mErr;

      if (membersData && membersData.length > 0) {
        const userIds = membersData.map((m: any) => m.user_id).filter(Boolean);
        let profileMap = new Map<string, string>();
        if (userIds.length > 0) {
          const { data: profiles, error: pErr } = await supabase
            .from('profiles')
            .select('id, nome')
            .in('id', userIds);
          if (!pErr && profiles) {
            profileMap = new Map(profiles.map((p: any) => [p.id, p.nome]));
          }
        }

        const formatados: MembroEquipe[] = membersData.map((m: any) => {
          const nomePerfil = m.user_id ? profileMap.get(m.user_id) : null;
          let nomeFinal = nomePerfil?.trim();
          if (!nomeFinal && m.email) {
            const parteAntesArroba = m.email.split('@')[0];
            nomeFinal = parteAntesArroba
              .split(/[._-]/)
              .map((p: string) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
              .join(' ');
          }
          return {
            id: m.id,
            user_id: m.user_id,
            email: m.email,
            nome: nomeFinal || 'Membro da Equipe',
            role: m.role,
            status: m.status,
          };
        });
        setMembrosEquipe(formatados);
      } else {
        setMembrosEquipe([]);
      }
    } catch (err: any) {
      console.error('[ModalLancarServicoRetroativo] Erro ao carregar equipe:', err);
    }
  };

  // Carrega catálogo de produtos para consumo
  const carregarProdutos = async () => {
    if (!tenant) return;
    try {
      const { data, error } = await supabase
        .from('produtos')
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('ativo', true)
        .order('categoria', { ascending: true })
        .order('nome', { ascending: true });

      if (error) throw error;
      if (data) {
        setProdutosCatalogo(data as Produto[]);
      }
    } catch (err: any) {
      console.error('[ModalLancarServicoRetroativo] Erro ao carregar produtos:', err);
    }
  };

  // Carrega catálogo de clientes e seus veículos
  const carregarClientes = async () => {
    if (!tenant) return [];
    try {
      const { data, error } = await supabase
        .from('clientes')
        .select('id, nome, telefone, veiculos:veiculos(*)')
        .eq('tenant_id', tenant.id)
        .eq('ativo', true)
        .order('nome', { ascending: true });

      if (error) throw error;
      if (data) {
        setClientes(data as any);
        return data as any[];
      }
    } catch (err: any) {
      console.error('[ModalLancarServicoRetroativo] Erro ao carregar clientes:', err);
    }
    return [];
  };

  const handleClienteCadastrado = async (novoClienteId: string, novoVeiculoId?: string) => {
    setShowCadastroClienteModal(false);
    showSuccess('Cliente cadastrado com sucesso!');
    const lista = await carregarClientes();
    setClienteId(novoClienteId);
    if (novoVeiculoId) {
      setVeiculoId(novoVeiculoId);
    } else {
      const cli = lista?.find((c: any) => c.id === novoClienteId);
      if (cli && (cli as any).veiculos?.length > 0) {
        setVeiculoId((cli as any).veiculos[0].id);
      }
    }
  };

  // Carrega dados iniciais ao abrir o modal
  useEffect(() => {
    if (!isOpen || !tenant) return;

    const carregarTudo = async () => {
      setCarregandoDados(true);
      try {
        await Promise.all([
          carregarClientes(),
          carregarCatalogoServicos(),
          carregarProdutos(),
          carregarMembrosEquipe(),
          (async () => {
            const { data } = await supabase
              .from('tenant_formas_pagamento')
              .select('id, nome, tipo, permite_parcelar')
              .eq('tenant_id', tenant.id)
              .eq('ativo', true)
              .order('ordem', { ascending: true });
            if (data) {
              setFormasPagamento(data as FormaPagamento[]);
              if (data.length > 0 && !formaPagamentoId) {
                setFormaPagamentoId(data[0].id);
              }
            }
          })(),
        ]);
      } catch (err: any) {
        console.error('[ModalLancarServicoRetroativo] Erro geral ao carregar dados:', err);
      } finally {
        setCarregandoDados(false);
      }
    };

    carregarTudo();
  }, [isOpen, tenant]);

  // Atualiza veículos quando cliente muda
  useEffect(() => {
    if (!clienteId) {
      setVeiculos([]);
      setVeiculoId('');
      return;
    }

    const c = clientes.find((item) => item.id === clienteId);
    if (c && (c as any).veiculos) {
      const vList = (c as any).veiculos as Veiculo[];
      setVeiculos(vList);
      if (vList.length > 0) {
        setVeiculoId(vList[0].id);
      } else {
        setVeiculoId('');
      }
    } else {
      setVeiculos([]);
      setVeiculoId('');
    }
  }, [clienteId, clientes]);

  // Atualiza preços e durações padrão do catálogo quando a categoria do veículo mudar
  useEffect(() => {
    if (servicosCatalogo.length > 0 && categoriaVeiculoId) {
      setServicosCatalogo((prev) =>
        prev.map((s) => {
          const precos = s.servico_precos || [];
          const precoCat = precos.find((p: any) => p.categoria_id === categoriaVeiculoId);
          return {
            ...s,
            preco_padrao: Number(precoCat?.preco_base ?? precos[0]?.preco_base ?? s.preco_padrao ?? 0),
            duracao_minutos: Number(precoCat?.duracao_minutos ?? precos[0]?.duracao_minutos ?? s.duracao_minutos ?? 60),
          };
        })
      );
    }
  }, [categoriaVeiculoId]);

  // Atalhos rápidos de data
  const aplicarAtalhoData = (tipo: 'hoje_cedo' | 'ontem_tarde' | 'dois_dias_atras') => {
    const agora = new Date();
    if (tipo === 'hoje_cedo') {
      agora.setHours(9, 0, 0, 0);
    } else if (tipo === 'ontem_tarde') {
      agora.setDate(agora.getDate() - 1);
      agora.setHours(14, 0, 0, 0);
    } else if (tipo === 'dois_dias_atras') {
      agora.setDate(agora.getDate() - 2);
      agora.setHours(10, 0, 0, 0);
    }
    agora.setMinutes(agora.getMinutes() - agora.getTimezoneOffset());
    setDataHora(agora.toISOString().slice(0, 16));
  };

  // Adicionar serviço à lista
  const handleAdicionarServico = (idParaAdicionar?: string) => {
    const srvId = idParaAdicionar || servicoParaAdicionar;
    if (!srvId) return;
    const srv = servicosCatalogo.find((s) => s.id === srvId);
    if (!srv) return;

    if (servicosSelecionados.some((s) => s.servico_id === srv.id)) {
      showError('Este serviço já foi adicionado ao atendimento.');
      return;
    }

    const precos = srv.servico_precos || [];
    const precoCat = categoriaVeiculoId ? precos.find((p: any) => p.categoria_id === categoriaVeiculoId) : null;
    const precoFinal = Number(precoCat?.preco_base ?? precos[0]?.preco_base ?? srv.preco_padrao ?? 0);
    const duracaoFinal = Number(precoCat?.duracao_minutos ?? precos[0]?.duracao_minutos ?? srv.duracao_minutos ?? 60);

    setServicosSelecionados((prev) => [
      ...prev,
      {
        servico_id: srv.id,
        nome: srv.nome,
        duracao_minutos: duracaoFinal > 0 ? duracaoFinal : 60,
        valor: precoFinal,
      },
    ]);
    setServicoParaAdicionar('');
  };

  const handleRemoverServico = (servicoIdParaRemover: string) => {
    setServicosSelecionados((prev) => prev.filter((s) => s.servico_id !== servicoIdParaRemover));
  };

  const handleAlterarValorServico = (servicoIdAlvo: string, novoValor: number) => {
    setServicosSelecionados((prev) =>
      prev.map((s) => (s.servico_id === servicoIdAlvo ? { ...s, valor: novoValor } : s))
    );
  };

  const handleAlterarDuracaoServico = (servicoIdAlvo: string, novaDuracao: number) => {
    const min = Math.max(1, Math.round(novaDuracao) || 1);
    setServicosSelecionados((prev) =>
      prev.map((s) => (s.servico_id === servicoIdAlvo ? { ...s, duracao_minutos: min } : s))
    );
  };

  // Manipulação de Produtos e Consumos
  const handleSelecionarProdutoParaConsumo = (prodId: string) => {
    setProdutoParaConsumo(prodId);
    if (!prodId) {
      setQtdProdutoParaConsumo('');
      return;
    }
    const prod = produtosCatalogo.find((p) => p.id === prodId);
    if (prod) {
      if (prod.unidade_uso === 'ml') setQtdProdutoParaConsumo('90');
      else if (prod.unidade_uso === 'g') setQtdProdutoParaConsumo('50');
      else setQtdProdutoParaConsumo('1');
    }
  };

  const handleAdicionarProdutoConsumo = (idProdCustom?: string, qtdCustom?: string) => {
    const pId = idProdCustom || produtoParaConsumo;
    if (!pId) return;

    if (produtosConsumidos.some((c) => c.produto_id === pId)) {
      showError('Este produto já foi adicionado ao atendimento.');
      return;
    }

    const prod = produtosCatalogo.find((p) => p.id === pId);
    if (!prod) return;

    const qtdStr = qtdCustom || qtdProdutoParaConsumo || (prod.unidade_uso === 'ml' ? '90' : '1');
    const qtdNum = Number(qtdStr.replace(',', '.')) || 1;

    setProdutosConsumidos((prev) => [
      ...prev,
      {
        produto_id: prod.id,
        nome: prod.nome,
        marca: prod.marca,
        unidade_uso: prod.unidade_uso,
        quantidade: String(qtdNum),
        custo_unitario: Number(prod.custo_unitario) || 0,
      },
    ]);

    setProdutoParaConsumo('');
    setQtdProdutoParaConsumo('');
  };

  const handleRemoverProdutoConsumo = (produtoIdParaRemover: string) => {
    setProdutosConsumidos((prev) => prev.filter((p) => p.produto_id !== produtoIdParaRemover));
  };

  const handleAlterarQtdProduto = (produtoIdAlvo: string, novaQtdStr: string) => {
    setProdutosConsumidos((prev) =>
      prev.map((p) => (p.produto_id === produtoIdAlvo ? { ...p, quantidade: novaQtdStr } : p))
    );
  };

  const handleSalvarNovoProduto = async (data: {
    nome: string;
    marca?: string;
    categoria: string;
    unidade_uso: UnidadeUso;
    tamanho_compra: number;
    preco_compra: number;
    estoque_minimo: number;
    estoque_atual?: number;
  }) => {
    if (!tenant) return;
    try {
      const calcCusto = data.tamanho_compra > 0 ? (data.preco_compra || 0) / data.tamanho_compra : 0;
      const { data: novoProd, error } = await supabase
        .from('produtos')
        .insert({
          tenant_id: tenant.id,
          nome: data.nome,
          marca: data.marca || null,
          categoria: data.categoria,
          unidade_uso: data.unidade_uso,
          tamanho_compra: data.tamanho_compra,
          preco_compra: data.preco_compra,
          custo_unitario: calcCusto,
          estoque_minimo: data.estoque_minimo,
          estoque_atual: data.estoque_atual || 0,
          ativo: true,
        })
        .select('*')
        .single();

      if (error) throw error;

      showSuccess('Produto cadastrado com sucesso!');
      setShowModalProduto(false);
      await carregarProdutos();

      if (novoProd) {
        setProdutosCatalogo((prev) => [novoProd as Produto, ...prev]);
        setProdutosConsumidos((prev) => [
          ...prev,
          {
            produto_id: novoProd.id,
            nome: novoProd.nome,
            marca: novoProd.marca,
            unidade_uso: novoProd.unidade_uso,
            quantidade: novoProd.unidade_uso === 'ml' ? '90' : '1',
            custo_unitario: Number(novoProd.custo_unitario) || calcCusto,
          },
        ]);
      }
    } catch (err: any) {
      console.error('[ModalLancarServicoRetroativo] Erro ao cadastrar produto:', err);
      showError(err.message || 'Erro ao cadastrar produto.');
    }
  };

  const custoTotalProdutos = produtosConsumidos.reduce((acc, p) => {
    const qtd = Number(p.quantidade.replace(',', '.')) || 0;
    return acc + qtd * (p.custo_unitario || 0);
  }, 0);

  // Cálculos de totais
  const valorTotalServicos = servicosSelecionados.reduce((acc, s) => acc + (Number(s.valor) || 0), 0);
  const somaDuracaoServicos = servicosSelecionados.reduce((acc, s) => acc + (Number(s.duracao_minutos) || 60), 0);

  const horasExecucao = Math.floor(tempoExecucaoMinutos / 60);
  const minutosExecucao = tempoExecucaoMinutos % 60;

  const handleMudarHoras = (novasHoras: number) => {
    setDuracaoCustomizada(true);
    const h = Math.max(0, Math.floor(novasHoras) || 0);
    const novoTotal = h * 60 + minutosExecucao;
    setTempoExecucaoMinutos(novoTotal > 0 ? novoTotal : 1);
  };

  const handleMudarMinutos = (novosMin: number) => {
    setDuracaoCustomizada(true);
    const m = Math.max(0, Math.min(59, Math.floor(novosMin) || 0));
    const novoTotal = horasExecucao * 60 + m;
    setTempoExecucaoMinutos(novoTotal > 0 ? novoTotal : 1);
  };

  const atalhosDuracao = [
    { label: '30m', minutos: 30 },
    { label: '45m', minutos: 45 },
    { label: '1h', minutos: 60 },
    { label: '1h 30m', minutos: 90 },
    { label: '2h', minutos: 120 },
    { label: '2h 30m', minutos: 150 },
    { label: '3h', minutos: 180 },
    { label: '4h', minutos: 240 },
    { label: '6h', minutos: 360 },
    { label: '8h (Dia todo)', minutos: 480 },
  ];

  const calcularHorarioTermino = () => {
    try {
      const dInicio = new Date(dataHora);
      if (isNaN(dInicio.getTime())) return null;
      const dFim = new Date(dInicio.getTime() + tempoExecucaoMinutos * 60 * 1000);
      return {
        inicioHora: dInicio.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        inicioData: dInicio.toLocaleDateString('pt-BR'),
        fimHora: dFim.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        fimData: dFim.toLocaleDateString('pt-BR'),
      };
    } catch {
      return null;
    }
  };
  const previewHorario = calcularHorarioTermino();

  // Submissão do lançamento retroativo
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant) return;

    if (!clienteId) {
      showError('Por favor, selecione o cliente.');
      return;
    }

    if (servicosSelecionados.length === 0) {
      showError('Adicione ao menos um serviço realizado.');
      return;
    }

    if (!dataHora) {
      showError('Informe a data e o horário da realização do serviço.');
      return;
    }

    setSalvando(true);
    try {
      const dataIso = new Date(dataHora).toISOString();

      const servicosPayload = servicosSelecionados.map((s) => ({
        servico_id: s.servico_id,
        valor: Number(s.valor) || 0,
        duracao_minutos: Number(s.duracao_minutos) || 60,
      }));

      const formaEscolhida = formasPagamento.find((f) => f.id === formaPagamentoId);
      const pagamentosPayload = formaPagamentoId && valorTotalServicos > 0
        ? [
            {
              forma_id: formaPagamentoId,
              valor_bruto: valorTotalServicos,
              total_parcelas: formaEscolhida?.permite_parcelar ? Math.max(1, parcelas) : 1,
              numero_parcela: 1,
              previsto_para: dataIso.split('T')[0],
            },
          ]
        : [];

      const consumosPayload = produtosConsumidos
        .filter((c) => (Number(c.quantidade.replace(',', '.')) || 0) > 0)
        .map((c) => ({
          produto_id: c.produto_id,
          quantidade: Number(c.quantidade.replace(',', '.')) || 0,
        }));

      const { data, error } = await supabase.rpc('lancar_atendimento_retroativo', {
        p_cliente_id: clienteId,
        p_veiculo_id: veiculoId || null,
        p_data_realizacao: dataIso,
        p_servicos: servicosPayload,
        p_pagamentos: pagamentosPayload,
        p_executor_id: executorId || null,
        p_observacoes: observacoes.trim() || null,
        p_tempo_execucao_minutos: tempoExecucaoMinutos,
        p_consumos: consumosPayload,
      });

      if (error) throw error;

      showSuccess(data?.mensagem || 'Atendimento retroativo lançado com sucesso!');
      if (onSuccess && data) {
        onSuccess({
          agendamentoId: data.agendamento_id,
          execucaoId: data.execucao_id,
          numeroOS: data.numero_os,
        });
      }
      onClose();
    } catch (err: any) {
      console.error('[ModalLancarServicoRetroativo] Erro:', err);
      showError(err.message || 'Erro ao lançar serviço retroativo.', err);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <>
      <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Lançar Serviço Já Realizado"
      icon={<Sparkles size={20} className="text-amber-500" />}
      maxWidth="2xl"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5 py-1">
        {/* Banner Informativo */}
        <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-3 text-xs text-amber-200">
          <Clock size={18} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-semibold text-amber-300">Lançamento Retroativo / Atendimento Concluído</p>
            <p className="text-vapor-300">
              Ideal para registrar serviços realizados na correria ou fora do sistema. O atendimento já nascerá
              concluído, com número de OS, comissão calculada e faturamento registrado na data informada.
            </p>
          </div>
        </div>

        {/* 1. Data e Horário de Realização */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-vapor-200 flex items-center gap-1.5">
              <Calendar size={14} className="text-amber-400" />
              Quando o serviço foi feito? *
            </label>
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="text-vapor-400">Atalhos:</span>
              <button
                type="button"
                onClick={() => aplicarAtalhoData('hoje_cedo')}
                className="px-2 py-0.5 rounded bg-graphite-800 text-vapor-300 hover:text-white border border-graphite-700"
              >
                Hoje 09h
              </button>
              <button
                type="button"
                onClick={() => aplicarAtalhoData('ontem_tarde')}
                className="px-2 py-0.5 rounded bg-graphite-800 text-vapor-300 hover:text-white border border-graphite-700"
              >
                Ontem 14h
              </button>
              <button
                type="button"
                onClick={() => aplicarAtalhoData('dois_dias_atras')}
                className="px-2 py-0.5 rounded bg-graphite-800 text-vapor-300 hover:text-white border border-graphite-700"
              >
                Anteontem
              </button>
            </div>
          </div>
          <Input
            type="datetime-local"
            value={dataHora}
            onChange={(e) => setDataHora(e.target.value)}
            className="min-h-[44px] bg-graphite-900 border-graphite-700 font-mono text-vapor-100"
            required
          />
        </div>

        {/* 2. Cliente & Veículo */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {/* Seletor de Cliente */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-vapor-200 flex items-center gap-1.5">
                <User size={14} className="text-amber-400" />
                Cliente *
              </label>
              <button
                type="button"
                onClick={() => setShowCadastroClienteModal(true)}
                className="text-[11px] font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-1 transition-colors"
                title="Cadastrar um novo cliente rapidamente"
              >
                <Plus size={12} />
                + Novo Cliente
              </button>
            </div>
            <select
              value={clienteId}
              onChange={(e) => setClienteId(e.target.value)}
              className="min-h-[44px] bg-graphite-900 border border-graphite-700 rounded-lg px-3 text-sm text-vapor-100 outline-none focus:border-amber-500"
              required
            >
              <option value="">Selecione o cliente...</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome} {c.telefone ? `(${c.telefone})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Seletor de Veículo */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-vapor-200 flex items-center gap-1.5">
              <Car size={14} className="text-amber-400" />
              Veículo do Cliente
            </label>
            <select
              value={veiculoId}
              onChange={(e) => setVeiculoId(e.target.value)}
              disabled={!clienteId || veiculos.length === 0}
              className="min-h-[44px] bg-graphite-900 border border-graphite-700 rounded-lg px-3 text-sm text-vapor-100 outline-none focus:border-amber-500 disabled:opacity-50"
            >
              <option value="">
                {!clienteId
                  ? 'Selecione um cliente primeiro'
                  : veiculos.length === 0
                  ? 'Nenhum veículo cadastrado'
                  : 'Selecione o veículo...'}
              </option>
              {veiculos.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.placa ? `[${v.placa}]` : ''} {v.modelo || 'Veículo'} {v.marca || ''} {v.cor ? `(${v.cor})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 3. Serviços Realizados */}
        <div className="space-y-3 bg-graphite-900/60 p-4 rounded-xl border border-graphite-800">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-vapor-200 flex items-center gap-1.5">
              <CheckCircle2 size={14} className="text-amber-400" />
              Serviços Realizados *
            </label>
            <span className="text-xs text-vapor-400 font-mono">
              Total: <strong className="text-emerald-400">{formatarMoeda(valorTotalServicos)}</strong>
              {somaDuracaoServicos > 0 && ` • ~${somaDuracaoServicos} min catálogo`}
            </span>
          </div>

          {/* Adicionar Serviço + Botão Cadastrar Serviço */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={servicoParaAdicionar}
              onChange={(e) => setServicoParaAdicionar(e.target.value)}
              className="flex-1 min-w-[200px] min-h-[42px] bg-graphite-950 border border-graphite-700 rounded-lg px-3 text-xs text-vapor-100 outline-none focus:border-amber-500"
            >
              <option value="">
                {servicosCatalogo.length === 0
                  ? 'Nenhum serviço cadastrado ainda...'
                  : 'Selecione um serviço para adicionar...'}
              </option>
              {servicosCatalogo.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome} {s.grupo ? `(${s.grupo})` : ''} — {formatarMoeda(Number(s.preco_padrao) || 0)}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="secondary"
              onClick={() => handleAdicionarServico()}
              disabled={!servicoParaAdicionar}
              className="min-h-[42px] px-3.5 text-xs font-semibold"
            >
              <Plus size={15} />
              Adicionar
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowModalServicoRapido(true)}
              className="min-h-[42px] px-3 text-xs font-semibold border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
              title="Cadastrar um novo serviço no catálogo"
            >
              <Wrench size={14} className="text-amber-400" />
              + Novo Serviço
            </Button>
          </div>

          {/* Aviso quando catálogo está vazio */}
          {servicosCatalogo.length === 0 && !carregandoDados && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-300 flex items-center justify-between gap-3">
              <span>Sua oficina ainda não possui serviços cadastrados no catálogo.</span>
              <button
                type="button"
                onClick={() => setShowModalServicoRapido(true)}
                className="font-bold underline text-amber-400 hover:text-amber-300 shrink-0"
              >
                Cadastrar agora
              </button>
            </div>
          )}

          {/* Lista de Serviços Adicionados */}
          {servicosSelecionados.length === 0 ? (
            <div className="py-4 text-center text-xs text-vapor-400 border border-dashed border-graphite-700 rounded-lg">
              Nenhum serviço adicionado ainda. Escolha no seletor acima.
            </div>
          ) : (
            <div className="space-y-2">
              {servicosSelecionados.map((srv) => (
                <div
                  key={srv.servico_id}
                  className="flex flex-wrap items-center justify-between gap-3 p-2.5 bg-graphite-950 rounded-lg border border-graphite-800"
                >
                  <div className="min-w-[140px] flex-1">
                    <p className="text-xs font-bold text-vapor-100 truncate">{srv.nome}</p>
                    <span className="text-[11px] text-vapor-400">Tempo estimado por serviço</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Duração individual do serviço */}
                    <div className="flex items-center gap-1 bg-graphite-900 border border-graphite-700 rounded-lg px-2 py-1">
                      <Clock size={12} className="text-amber-400 shrink-0" />
                      <input
                        type="number"
                        min="1"
                        max="999"
                        value={srv.duracao_minutos}
                        onChange={(e) => handleAlterarDuracaoServico(srv.servico_id, Number(e.target.value) || 1)}
                        className="w-12 bg-transparent text-xs font-semibold text-vapor-200 text-center outline-none"
                        title="Duração deste serviço específico (em minutos)"
                      />
                      <span className="text-[10px] text-vapor-400">min</span>
                    </div>

                    {/* Preço em R$ */}
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-vapor-400">R$</span>
                      <CampoNumerico
                        placeholder="0,00"
                        value={String(srv.valor || '')}
                        onChange={(_v, str) => handleAlterarValorServico(srv.servico_id, Number(str.replace(',', '.')) || 0)}
                        wrapperClassName="w-24 min-h-[34px] bg-graphite-900 border-graphite-700"
                        className="text-xs font-bold text-emerald-400 text-right"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoverServico(srv.servico_id)}
                      className="p-1.5 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded"
                      title="Remover serviço"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 4. Tempo Real de Execução (Duração do Atendimento pro DRE) */}
        <div className="p-3.5 bg-graphite-900/80 border border-amber-500/30 rounded-xl flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-xs font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
              <Clock size={15} className="text-amber-400" />
              Tempo Real de Execução (Duração do Atendimento) *
            </label>
            <span className="text-xs font-mono font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
              {horasExecucao > 0 ? `${horasExecucao}h ` : ''}{minutosExecucao}min ({tempoExecucaoMinutos} min total)
            </span>
          </div>

          {/* Chips de Seleção Rápida */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-vapor-400 font-medium mr-1">Atalhos:</span>
            {atalhosDuracao.map((at) => (
              <button
                key={at.minutos}
                type="button"
                onClick={() => {
                  setDuracaoCustomizada(true);
                  setTempoExecucaoMinutos(at.minutos);
                }}
                className={`px-2.5 py-1 text-xs rounded-lg transition-colors border ${
                  tempoExecucaoMinutos === at.minutos
                    ? 'bg-amber-500 text-graphite-950 border-amber-400 font-bold shadow-sm'
                    : 'bg-graphite-950 text-vapor-300 border-graphite-800 hover:border-amber-500/50 hover:text-amber-300'
                }`}
              >
                {at.label}
              </button>
            ))}
            {duracaoCustomizada && somaDuracaoServicos > 0 && tempoExecucaoMinutos !== somaDuracaoServicos && (
              <button
                type="button"
                onClick={() => {
                  setDuracaoCustomizada(false);
                  setTempoExecucaoMinutos(somaDuracaoServicos);
                }}
                className="px-2 py-1 text-xs rounded-lg bg-graphite-800 text-amber-300 border border-amber-500/30 hover:bg-amber-500/10 font-semibold transition-colors flex items-center gap-1"
                title="Restaurar soma do tempo dos serviços cadastrados"
              >
                ↺ Soma do catálogo ({somaDuracaoServicos}m)
              </button>
            )}
          </div>

          {/* Inputs Horas e Minutos + Card de Resumo DRE */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div className="flex items-center gap-2">
              <div className="flex-1 flex flex-col gap-1">
                <span className="text-[11px] text-vapor-400 font-medium">Horas:</span>
                <div className="flex items-center bg-graphite-950 border border-graphite-700 rounded-lg px-3 py-2">
                  <input
                    type="number"
                    min="0"
                    max="99"
                    value={horasExecucao}
                    onChange={(e) => handleMudarHoras(Number(e.target.value) || 0)}
                    className="w-full bg-transparent text-sm font-bold text-vapor-100 outline-none text-center"
                  />
                  <span className="text-xs text-vapor-400 font-bold ml-1">h</span>
                </div>
              </div>
              <div className="flex-1 flex flex-col gap-1">
                <span className="text-[11px] text-vapor-400 font-medium">Minutos:</span>
                <div className="flex items-center bg-graphite-950 border border-graphite-700 rounded-lg px-3 py-2">
                  <input
                    type="number"
                    min="0"
                    max="59"
                    step="5"
                    value={minutosExecucao}
                    onChange={(e) => handleMudarMinutos(Number(e.target.value) || 0)}
                    className="w-full bg-transparent text-sm font-bold text-vapor-100 outline-none text-center"
                  />
                  <span className="text-xs text-vapor-400 font-bold ml-1">min</span>
                </div>
              </div>
            </div>

            {/* Preview de Término e Explicação DRE */}
            <div className="p-2.5 bg-graphite-950 rounded-lg border border-graphite-800 flex flex-col justify-center text-xs">
              {previewHorario ? (
                <div className="flex items-center justify-between text-vapor-200">
                  <span>Início: <strong className="text-vapor-100">{previewHorario.inicioHora}</strong></span>
                  <span className="text-vapor-500">➔</span>
                  <span>Término: <strong className="text-amber-400">{previewHorario.fimHora}</strong></span>
                </div>
              ) : (
                <span className="text-vapor-400">Informe a data de início acima</span>
              )}
              <p className="text-[10px] text-vapor-400 mt-1.5 leading-tight">
                💡 Este tempo é computado no <strong>DRE</strong> multiplicando pelo custo-hora fixo da sua estrutura (aluguel, equipe, energia) para apurar o lucro real do serviço.
              </p>
            </div>
          </div>
        </div>

        {/* 4. PRODUTOS E INSUMOS UTILIZADOS (BAIXA DE ESTOQUE E DRE) */}
        <div className="p-3.5 sm:p-4 bg-graphite-900 border border-graphite-800 rounded-xl flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-graphite-800 pb-2.5">
            <div className="flex items-center gap-2">
              <Package size={16} className="text-amber-400" />
              <label className="text-xs font-bold uppercase tracking-wider text-vapor-200">
                Insumos & Produtos Utilizados (Opcional)
              </label>
            </div>
            <div className="flex items-center gap-2">
              {custoTotalProdutos > 0 && (
                <span className="text-xs font-mono font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  CMV: {formatarMoeda(custoTotalProdutos)}
                </span>
              )}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setShowModalProduto(true)}
                className="text-xs h-7 px-2.5 border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
              >
                <Plus size={13} className="text-amber-400" />
                + Novo Produto
              </Button>
            </div>
          </div>

          <p className="text-[11px] text-vapor-400">
            Adicione os químicos e insumos gastos neste atendimento para dar baixa automática no estoque e apurar o custo exato dos produtos (CMV) no seu DRE.
          </p>

          {/* Seletor de Produto + Quantidade + Botão Adicionar */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={produtoParaConsumo}
              onChange={(e) => handleSelecionarProdutoParaConsumo(e.target.value)}
              className="flex-1 min-w-[200px] min-h-[42px] bg-graphite-950 border border-graphite-700 rounded-lg px-3 text-xs text-vapor-100 outline-none focus:border-amber-500"
            >
              <option value="">
                {produtosCatalogo.length === 0
                  ? 'Nenhum produto cadastrado no estoque...'
                  : 'Selecione um produto para adicionar...'}
              </option>
              {produtosCatalogo.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome} {p.marca ? `(${p.marca})` : ''} — Estoque: {p.estoque_atual} {p.unidade_uso}
                </option>
              ))}
            </select>

            {produtoParaConsumo && (
              <div className="flex items-center gap-1 bg-graphite-950 border border-graphite-700 rounded-lg px-2.5 min-h-[42px]">
                <input
                  type="text"
                  placeholder="Qtd"
                  value={qtdProdutoParaConsumo}
                  onChange={(e) => setQtdProdutoParaConsumo(e.target.value)}
                  className="w-16 bg-transparent text-xs text-right text-vapor-100 font-mono outline-none"
                />
                <span className="text-[11px] text-vapor-400 font-bold">
                  {produtosCatalogo.find((p) => p.id === produtoParaConsumo)?.unidade_uso || 'un'}
                </span>
              </div>
            )}

            <Button
              type="button"
              variant="secondary"
              onClick={() => handleAdicionarProdutoConsumo()}
              disabled={!produtoParaConsumo}
              className="min-h-[42px] px-3.5 text-xs font-semibold"
            >
              <Plus size={15} />
              Adicionar
            </Button>
          </div>

          {/* Lista de Produtos Adicionados */}
          {produtosConsumidos.length === 0 ? (
            <div className="py-3 text-center text-xs text-vapor-400 border border-dashed border-graphite-800 rounded-lg">
              Nenhum produto adicionado (se não informar, o atendimento será lançado sem consumo de químicos).
            </div>
          ) : (
            <div className="space-y-2">
              {produtosConsumidos.map((prod) => {
                const qtdNum = Number(prod.quantidade.replace(',', '.')) || 0;
                const custoItem = qtdNum * (prod.custo_unitario || 0);

                return (
                  <div
                    key={prod.produto_id}
                    className="flex items-center justify-between gap-3 p-2.5 bg-graphite-950 rounded-lg border border-graphite-800"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-white text-xs truncate">
                        {prod.nome} {prod.marca && <span className="text-vapor-400 font-normal">({prod.marca})</span>}
                      </div>
                      <div className="text-[10px] text-vapor-400 font-mono">
                        {custoItem > 0 ? `Custo: ${formatarMoeda(custoItem)}` : 'Sem custo unitário cadastrado'}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center bg-graphite-900 border border-graphite-700 rounded px-2 py-1">
                        <input
                          type="text"
                          value={prod.quantidade}
                          onChange={(e) => handleAlterarQtdProduto(prod.produto_id, e.target.value)}
                          className="w-14 bg-transparent text-xs text-right text-vapor-100 font-mono outline-none"
                        />
                        <span className="text-[10px] text-vapor-400 ml-1 font-semibold">{prod.unidade_uso}</span>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoverProdutoConsumo(prod.produto_id)}
                        className="p-1.5 text-vapor-400 hover:text-rose-400 transition"
                        title="Remover produto"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 5. Executor & Pagamento */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {/* Executor / Equipe */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-vapor-200 flex items-center gap-1.5">
              <User size={14} className="text-amber-400" />
              Profissional / Executor (Comissão)
            </label>
            <select
              value={executorId}
              onChange={(e) => setExecutorId(e.target.value)}
              className="min-h-[44px] bg-graphite-900 border border-graphite-700 rounded-lg px-3 text-sm text-vapor-100 outline-none focus:border-amber-500"
            >
              <option value="">Não especificar (ou o próprio dono)</option>
              {membrosEquipe.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome} ({m.role === 'dono' ? 'Dono' : m.role === 'gerente' ? 'Gerente' : 'Operador'})
                </option>
              ))}
            </select>
            <span className="text-[11px] text-vapor-400">
              Se houver regra de comissão cadastrada, o cálculo será automático.
            </span>
          </div>

          {/* Forma de Pagamento */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-vapor-200 flex items-center gap-1.5">
              <CreditCard size={14} className="text-amber-400" />
              Como foi pago?
            </label>
            <select
              value={formaPagamentoId}
              onChange={(e) => setFormaPagamentoId(e.target.value)}
              className="min-h-[44px] bg-graphite-900 border border-graphite-700 rounded-lg px-3 text-sm text-vapor-100 outline-none focus:border-amber-500"
            >
              <option value="">Ainda não recebido / Fiado sem forma</option>
              {formasPagamento.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome} ({f.tipo})
                </option>
              ))}
            </select>

            {/* Parcelas se permitir parcelar */}
            {formasPagamento.find((f) => f.id === formaPagamentoId)?.permite_parcelar && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-vapor-300">Parcelas:</span>
                <select
                  value={parcelas}
                  onChange={(e) => setParcelas(Number(e.target.value) || 1)}
                  className="min-h-[32px] bg-graphite-950 border border-graphite-700 rounded px-2 text-xs text-vapor-100"
                >
                  {[1, 2, 3, 4, 5, 6, 10, 12].map((n) => (
                    <option key={n} value={n}>
                      {n}x de {formatarMoeda(valorTotalServicos / n)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* 5. Observações */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold uppercase tracking-wider text-vapor-200">
            Observações Técnicas / Notas do Atendimento (Opcional)
          </label>
          <textarea
            rows={2}
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
            placeholder="Ex: Cliente trouxe o carro no sábado sem agendamento prévio. Serviço executado e aprovado no balcão."
            className="p-3 bg-graphite-900 border border-graphite-700 rounded-lg text-sm text-vapor-100 outline-none focus:border-amber-500 resize-none"
          />
        </div>

        {/* Rodapé / Botões */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-graphite-800">
          <Button type="button" variant="ghost" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={salvando || carregandoDados}
            className="bg-amber-500 hover:bg-amber-400 text-graphite-950 font-bold min-h-[44px] px-6 flex items-center gap-2"
          >
            <CheckCircle2 size={17} />
            {salvando ? 'Lançando Atendimento...' : 'Salvar Atendimento Concluído'}
          </Button>
        </div>
      </form>
    </Modal>

    <ModalServicoRapido
      isOpen={showModalServicoRapido}
      onClose={() => setShowModalServicoRapido(false)}
      categoriaVeiculoId={categoriaVeiculoId}
      onSuccess={async (novoServico) => {
        setShowModalServicoRapido(false);
        if (novoServico?.id) {
          await carregarCatalogoServicos(categoriaVeiculoId);
          handleAdicionarServico(novoServico.id);
        }
      }}
    />

    <ModalProduto
      isOpen={showModalProduto}
      onClose={() => setShowModalProduto(false)}
      onSave={handleSalvarNovoProduto}
    />

    <CadastroRapidoModal
      isOpen={showCadastroClienteModal}
      onClose={() => setShowCadastroClienteModal(false)}
      onSuccess={handleClienteCadastrado}
    />
  </>
  );
};
