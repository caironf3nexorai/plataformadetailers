import React, { useState, useEffect } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { CampoNumerico } from '../../components/ui/CampoNumerico';
import { Badge } from '../../components/ui/Badge';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissao } from '../../hooks/usePermissao';
import { supabase } from '../../lib/supabase';
import type { DespesaFixa, CategoriaDespesa, TipoDespesa } from '../../types/financeiro';
import { formatarMoeda } from '../../utils/formatters';
import { calcularVigenciaFimParcelada, calcularParcelaAtual, formatarMesAno } from '../../utils/financeiroUtils';
import {
  DollarSign,
  Clock,
  Plus,
  History,
  AlertTriangle,
  AlertCircle,
  Sparkles,
  Building2,
  CheckCircle2,
  Edit2,
  Trash2,
  XCircle,
  Info,
  MoreVertical,
} from 'lucide-react';

const SUGESTOES = [
  { nome: 'Aluguel', categoria: 'Instalacao' as CategoriaDespesa, tipo: 'recorrente' as TipoDespesa },
  { nome: 'Energia elétrica', categoria: 'Instalacao' as CategoriaDespesa, tipo: 'variavel' as TipoDespesa },
  { nome: 'Água e esgoto', categoria: 'Instalacao' as CategoriaDespesa, tipo: 'variavel' as TipoDespesa },
  { nome: 'Gás', categoria: 'Instalacao' as CategoriaDespesa, tipo: 'variavel' as TipoDespesa },
  { nome: 'Internet & Telefone', categoria: 'Servicos' as CategoriaDespesa, tipo: 'recorrente' as TipoDespesa },
  { nome: 'Salários', categoria: 'Pessoal' as CategoriaDespesa, tipo: 'recorrente' as TipoDespesa },
  { nome: 'Pró-labore', categoria: 'Pessoal' as CategoriaDespesa, tipo: 'recorrente' as TipoDespesa },
  { nome: 'Contador', categoria: 'Servicos' as CategoriaDespesa, tipo: 'recorrente' as TipoDespesa },
  { nome: 'Sistema SaaS', categoria: 'Servicos' as CategoriaDespesa, tipo: 'recorrente' as TipoDespesa },
  { nome: 'Financiamento Equipamento', categoria: 'Instalacao' as CategoriaDespesa, tipo: 'parcelada' as TipoDespesa },
];

const CATEGORIAS_ROTULOS: Record<CategoriaDespesa, string> = {
  Instalacao: 'Instalação & Estrutura',
  Pessoal: 'Pessoal & Equipe',
  Servicos: 'Serviços & Sistemas',
  Impostos: 'Impostos & Taxas',
  Outros: 'Outros Custos',
  Geral: 'Geral',
};

const traduzirErroDespesa = (errMessage: string): string => {
  if (
    errMessage.includes('range lower bound must be less than or equal to range upper bound') ||
    errMessage.includes('range_error') ||
    errMessage.includes('A nova vigência precisa começar depois do início da atual.')
  ) {
    return 'A nova vigência precisa começar depois do início da atual.';
  }
  if (
    errMessage.includes('despesa_sem_sobreposicao') ||
    errMessage.includes('exclusion_violation') ||
    errMessage.includes('Já existe uma despesa com este nome')
  ) {
    return 'Já existe uma despesa com este nome vigente neste período.';
  }
  return errMessage;
};

export const AbaDespesasFixas: React.FC = () => {
  const { tenant } = useAuth();
  const { isDono } = usePermissao();

  const [despesas, setDespesas] = useState<DespesaFixa[]>([]);
  const [loading, setLoading] = useState(true);

  // Métricas do topo
  const [totalMensal, setTotalMensal] = useState(0);
  const [horasDisponiveis, setHorasDisponiveis] = useState(0);
  const [custoHora, setCustoHora] = useState(0);
  const [totalPendentes, setTotalPendentes] = useState(0);

  // Estados de confirmação em lote (Contas Variáveis Pendentes)
  const [valoresConfirmacao, setValoresConfirmacao] = useState<Record<string, string>>({});
  const [confirmingBatch, setConfirmingBatch] = useState(false);

  // Estados de Modais
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isModalNovaVigenciaOpen, setIsModalNovaVigenciaOpen] = useState(false);
  const [isModalEditarCadastralOpen, setIsModalEditarCadastralOpen] = useState(false);
  const [isModalCorrigirOpen, setIsModalCorrigirOpen] = useState(false);
  const [isModalEncerrarOpen, setIsModalEncerrarOpen] = useState(false);
  const [isModalConfirmarValorOpen, setIsModalConfirmarValorOpen] = useState(false);

  const [selectedDespesa, setSelectedDespesa] = useState<DespesaFixa | null>(null);
  const [valorConfirmarIndividual, setValorConfirmarIndividual] = useState<string>('');

  // Estado do Menu de Três Pontos por item
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Form State Geral / Cadastro
  const [nome, setNome] = useState('');
  const [categoria, setCategoria] = useState<CategoriaDespesa>('Geral');
  const [tipo, setTipo] = useState<TipoDespesa>('recorrente');
  const [totalParcelas, setTotalParcelas] = useState<number>(12);
  const [parcelaInicial, setParcelaInicial] = useState<number>(1);
  const [valorMensal, setValorMensal] = useState<string>('');
  const [vigenciaInicio, setVigenciaInicio] = useState<string>(
    new Date().toISOString().substring(0, 7) + '-01'
  );
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form State (Atualizar valor / Nova vigência)
  const [novoValor, setNovoValor] = useState<string>('');
  const [novaDataInicio, setNovaDataInicio] = useState<string>(
    new Date().toISOString().substring(0, 7) + '-01'
  );

  const fetchDados = async () => {
    if (!tenant) return;
    setLoading(true);

    try {
      const mesAtualIso = new Date().toISOString().substring(0, 7) + '-01';

      // 1. Garantir clonagem estimativa para o mês atual
      await supabase.rpc('obter_ou_gerar_despesas_mes', {
        p_tenant: tenant.id,
        p_mes: mesAtualIso,
      });

      // 2. Buscar todas as despesas
      const { data, error } = await supabase
        .from('despesas_fixas')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      const listaDespesas: DespesaFixa[] = data || [];
      setDespesas(listaDespesas);

      // 3. Calcular custo por hora da operação via RPC
      const { data: chData } = await supabase.rpc('custo_hora_operacao', {
        p_tenant: tenant.id,
        p_mes: mesAtualIso,
      });

      const { data: hdData } = await supabase.rpc('horas_disponiveis_mes', {
        p_tenant: tenant.id,
        p_mes: mesAtualIso,
      });

      setCustoHora(Number(chData || 0));
      setHorasDisponiveis(Number(hdData || 0));

      // 4. Somar total mensal vigente hoje
      const hojeStr = new Date().toISOString().substring(0, 10);
      const vigentes = listaDespesas.filter(
        (d: DespesaFixa) => d.vigencia_inicio <= hojeStr && (!d.vigencia_fim || d.vigencia_fim >= hojeStr)
      );
      const soma = vigentes.reduce((acc: number, curr: DespesaFixa) => acc + Number(curr.valor_mensal), 0);
      setTotalMensal(soma);

      // 5. Calcular valor total pendente em contas variáveis do mês
      const pendentesMes = vigentes.filter((d) => d.tipo === 'variavel' && d.confirmado === false);
      const somaPendentes = pendentesMes.reduce((acc, curr) => acc + Number(curr.valor_mensal), 0);
      setTotalPendentes(somaPendentes);

      // Inicializar mapa de valores para o banner de confirmação rápida
      const initialMap: Record<string, string> = {};
      pendentesMes.forEach((p) => {
        initialMap[p.id] = String(p.valor_mensal);
      });
      setValoresConfirmacao(initialMap);
    } catch (err: any) {
      console.error('Erro ao carregar despesas fixas:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDados();
  }, [tenant?.id]);

  if (!isDono) {
    return (
      <Card className="p-6 bg-graphite-900 border-graphite-800 text-center">
        <AlertTriangle size={32} className="text-amber-400 mx-auto mb-2" />
        <h3 className="font-bold text-vapor-100">Acesso Restrito</h3>
        <p className="text-vapor-400 text-sm">Apenas o proprietário pode visualizar e gerenciar as despesas fixas.</p>
      </Card>
    );
  }

  const hojeStr = new Date().toISOString().substring(0, 10);
  const despesasVigentes = despesas.filter(
    (d: DespesaFixa) => d.vigencia_inicio <= hojeStr && (!d.vigencia_fim || d.vigencia_fim >= hojeStr)
  );
  const pendentesVariaveis = despesasVigentes.filter((d) => d.tipo === 'variavel' && d.confirmado === false);

  const toggleMenu = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenMenuId((prev) => (prev === id ? null : id));
  };

  const handleOpenAddModal = (sugestao?: { nome: string; categoria: CategoriaDespesa; tipo?: TipoDespesa }) => {
    setNome(sugestao?.nome || '');
    setCategoria(sugestao?.categoria || 'Geral');
    setTipo(sugestao?.tipo || 'recorrente');
    setTotalParcelas(12);
    setParcelaInicial(1);
    setValorMensal('');
    setVigenciaInicio(new Date().toISOString().substring(0, 7) + '-01');
    setErrorMsg(null);
    setIsModalOpen(true);
  };

  const handleConfirmarTodasVariaveis = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant || pendentesVariaveis.length === 0) return;
    setConfirmingBatch(true);
    try {
      const itens = pendentesVariaveis.map((d) => ({
        id: d.id,
        valor:
          parseFloat((valoresConfirmacao[d.id] || String(d.valor_mensal)).replace(',', '.')) ||
          Number(d.valor_mensal),
      }));

      const { error } = await supabase.rpc('confirmar_despesas_variaveis_lote', {
        p_itens: itens,
      });

      if (error) throw error;
      await fetchDados();
    } catch (err: any) {
      console.error('Erro ao confirmar contas variáveis em lote:', err);
    } finally {
      setConfirmingBatch(false);
    }
  };

  // 1. AÇÃO: CONFIRMAR VALOR INDIVIDUAL (VARIÁVEL PENDENTE)
  const handleOpenConfirmarIndividual = (d: DespesaFixa) => {
    setSelectedDespesa(d);
    setValorConfirmarIndividual(String(d.valor_mensal));
    setErrorMsg(null);
    setIsModalConfirmarValorOpen(true);
  };

  const handleSaveConfirmarIndividual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDespesa) return;

    const val = parseFloat(valorConfirmarIndividual.replace(',', '.'));
    if (isNaN(val) || val <= 0) {
      setErrorMsg('Informe um valor mensal válido.');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.rpc('confirmar_despesas_variaveis_lote', {
        p_itens: [{ id: selectedDespesa.id, valor: val }],
      });

      if (error) throw error;

      setIsModalConfirmarValorOpen(false);
      setSelectedDespesa(null);
      fetchDados();
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao confirmar valor.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveNovaDespesa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant) return;
    setErrorMsg(null);

    const val = parseFloat(valorMensal.replace(',', '.'));
    if (isNaN(val) || val <= 0) {
      setErrorMsg('Informe um valor mensal válido.');
      return;
    }
    if (!nome.trim()) {
      setErrorMsg('Informe o nome da despesa.');
      return;
    }

    let vigFim: string | null = null;
    if (tipo === 'parcelada') {
      if (totalParcelas <= 0) {
        setErrorMsg('Informe a quantidade de parcelas.');
        return;
      }
      vigFim = calcularVigenciaFimParcelada(vigenciaInicio, totalParcelas);
    } else if (tipo === 'variavel') {
      const [year, month] = vigenciaInicio.split('-').map(Number);
      const lastDay = new Date(year, month, 0).getDate();
      vigFim = `${vigenciaInicio.substring(0, 7)}-${String(lastDay).padStart(2, '0')}`;
    }

    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user) throw new Error('Usuário não autenticado.');

      const { error } = await supabase.from('despesas_fixas').insert({
        tenant_id: tenant.id,
        nome: nome.trim(),
        categoria,
        tipo,
        total_parcelas: tipo === 'parcelada' ? totalParcelas : null,
        parcela_inicial: tipo === 'parcelada' ? parcelaInicial : 1,
        valor_mensal: val,
        vigencia_inicio: vigenciaInicio,
        vigencia_fim: vigFim,
        confirmado: tipo !== 'variavel',
        confirmado_em: tipo === 'variavel' ? new Date().toISOString() : null,
        confirmado_por: tipo === 'variavel' ? userData.user.id : null,
        criado_por: userData.user.id,
      });

      if (error) throw error;

      setIsModalOpen(false);
      fetchDados();
    } catch (err: any) {
      setErrorMsg(traduzirErroDespesa(err.message || 'Erro ao salvar despesa.'));
    } finally {
      setSaving(false);
    }
  };

  // 2. AÇÃO: EDITAR DADOS CADASTRAIS (NOME E CATEGORIA LIVREMENTE)
  const handleOpenEditarCadastral = (d: DespesaFixa) => {
    setSelectedDespesa(d);
    setNome(d.nome);
    setCategoria(d.categoria);
    setErrorMsg(null);
    setIsModalEditarCadastralOpen(true);
  };

  const handleSaveEditarCadastral = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDespesa) return;
    setErrorMsg(null);

    if (!nome.trim()) {
      setErrorMsg('Informe o nome da despesa.');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('despesas_fixas')
        .update({
          nome: nome.trim(),
          categoria,
        })
        .eq('id', selectedDespesa.id);

      if (error) throw error;

      setIsModalEditarCadastralOpen(false);
      setSelectedDespesa(null);
      fetchDados();
    } catch (err: any) {
      setErrorMsg(traduzirErroDespesa(err.message || 'Erro ao atualizar dados da despesa.'));
    } finally {
      setSaving(false);
    }
  };

  // 3. AÇÃO: ATUALIZAR VALOR (NOVA VIGÊNCIA VIA RPC TRANSACIONAL)
  const handleOpenNovaVigencia = (d: DespesaFixa) => {
    setSelectedDespesa(d);
    setNovoValor(String(d.valor_mensal));
    setNovaDataInicio(new Date().toISOString().substring(0, 7) + '-01');
    setErrorMsg(null);
    setIsModalNovaVigenciaOpen(true);
  };

  const handleConfirmNovaVigencia = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDespesa) return;
    setErrorMsg(null);

    const val = parseFloat(novoValor.replace(',', '.'));
    if (isNaN(val) || val <= 0) {
      setErrorMsg('Informe um valor mensal válido.');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.rpc('nova_vigencia_despesa', {
        p_despesa: selectedDespesa.id,
        p_valor: val,
        p_inicio: novaDataInicio,
      });

      if (error) throw error;

      setIsModalNovaVigenciaOpen(false);
      setSelectedDespesa(null);
      fetchDados();
    } catch (err: any) {
      setErrorMsg(traduzirErroDespesa(err.message || 'Erro ao criar nova vigência.'));
    } finally {
      setSaving(false);
    }
  };

  // 4. AÇÃO: CORRIGIR LANÇAMENTO (FEITO HOJE SEM FECHAMENTOS)
  const handleOpenCorrigir = (d: DespesaFixa) => {
    setSelectedDespesa(d);
    setNome(d.nome);
    setCategoria(d.categoria);
    setTipo(d.tipo);
    setValorMensal(String(d.valor_mensal));
    setVigenciaInicio(d.vigencia_inicio);
    setTotalParcelas(d.total_parcelas || 12);
    setParcelaInicial(d.parcela_inicial || 1);
    setErrorMsg(null);
    setIsModalCorrigirOpen(true);
  };

  const handleSaveCorrigir = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDespesa) return;
    setErrorMsg(null);

    const val = parseFloat(valorMensal.replace(',', '.'));
    if (isNaN(val) || val <= 0) {
      setErrorMsg('Informe um valor mensal válido.');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.rpc('corrigir_despesa_fixa', {
        p_despesa: selectedDespesa.id,
        p_nome: nome.trim(),
        p_categoria: categoria,
        p_tipo: tipo,
        p_valor: val,
        p_vigencia_inicio: vigenciaInicio,
        p_total_parcelas: tipo === 'parcelada' ? totalParcelas : null,
        p_parcela_inicial: tipo === 'parcelada' ? parcelaInicial : 1,
      });

      if (error) throw error;

      setIsModalCorrigirOpen(false);
      setSelectedDespesa(null);
      fetchDados();
    } catch (err: any) {
      setErrorMsg(traduzirErroDespesa(err.message || 'Erro ao corrigir despesa.'));
    } finally {
      setSaving(false);
    }
  };

  const handleExcluirHoje = async () => {
    if (!selectedDespesa) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc('excluir_despesa_fixa', {
        p_despesa: selectedDespesa.id,
      });

      if (error) throw error;

      setIsModalCorrigirOpen(false);
      setSelectedDespesa(null);
      fetchDados();
    } catch (err: any) {
      setErrorMsg(traduzirErroDespesa(err.message || 'Erro ao excluir despesa.'));
    } finally {
      setSaving(false);
    }
  };

  // 5. AÇÃO: ENCERRAR DESPESA (VIGÊNCIA FIM = FIM DO MÊS CORRENTE)
  const handleOpenEncerrar = (d: DespesaFixa) => {
    setSelectedDespesa(d);
    setErrorMsg(null);
    setIsModalEncerrarOpen(true);
  };

  const handleConfirmEncerrar = async () => {
    if (!selectedDespesa) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc('encerrar_despesa_fixa', {
        p_despesa: selectedDespesa.id,
      });

      if (error) throw error;

      setIsModalEncerrarOpen(false);
      setSelectedDespesa(null);
      fetchDados();
    } catch (err: any) {
      setErrorMsg(traduzirErroDespesa(err.message || 'Erro ao encerrar despesa.'));
    } finally {
      setSaving(false);
    }
  };

  // Agrupar despesas vigentes por categoria
  const porCategoria = despesasVigentes.reduce((acc: Record<CategoriaDespesa, DespesaFixa[]>, d: DespesaFixa) => {
    if (!acc[d.categoria]) acc[d.categoria] = [];
    acc[d.categoria].push(d);
    return acc;
  }, {} as Record<CategoriaDespesa, DespesaFixa[]>);

  const mesNomeExtenso = new Date().toLocaleDateString('pt-BR', { month: 'long' });

  return (
    <div className="flex flex-col gap-6">
      {/* 1. TEXTO DE APOIO HISTÓRICO */}
      <div className="p-3.5 rounded-lg bg-graphite-900 border border-graphite-800 flex items-start gap-2.5 text-xs text-vapor-400">
        <Info size={16} className="text-amber-400 shrink-0 mt-0.5" />
        <span>
          As despesas são registradas por período. Ao atualizar um valor, o anterior é preservado — assim seus relatórios de meses passados nunca mudam.
        </span>
      </div>

      {/* 2. BANNER DE CONFIRMAÇÃO DE CONTAS VARIÁVEIS EM LOTE */}
      {pendentesVariaveis.length > 0 && (
        <Card className="p-5 bg-amber-500/10 border border-amber-500/30 flex flex-col gap-4 shadow-lg">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <AlertCircle size={20} className="text-amber-400 shrink-0" />
              <h4 className="font-bold text-sm text-amber-200">
                {pendentesVariaveis.length}{' '}
                {pendentesVariaveis.length === 1 ? 'conta variável aguarda confirmação' : 'contas variáveis aguardam confirmação'}
              </h4>
            </div>
            <span className="text-xs text-amber-400 font-medium">
              Informe o valor real das faturas de {mesNomeExtenso}
            </span>
          </div>

          <form onSubmit={handleConfirmarTodasVariaveis} className="flex flex-col gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {pendentesVariaveis.map((item) => (
                <div key={item.id} className="p-3 bg-graphite-900 border border-graphite-700 rounded-lg flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-vapor-100">{item.nome}</span>
                    <span className="text-[10px] text-amber-400 uppercase tracking-wider font-semibold">
                      Estimado
                    </span>
                  </div>
                  <span className="text-[11px] text-vapor-400">
                    Mês anterior: <strong className="text-vapor-200">{formatarMoeda(item.valor_mensal)}</strong>
                  </span>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-xs text-vapor-400 font-mono">R$</span>
                    <input
                      type="text"
                      value={valoresConfirmacao[item.id] ?? String(item.valor_mensal)}
                      onChange={(e) =>
                        setValoresConfirmacao((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      className="w-full bg-graphite-800 border border-graphite-700 rounded px-2.5 py-1 text-vapor-100 text-xs font-mono outline-none focus:border-amber-500"
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-1">
              <Button type="submit" variant="primary" className="text-xs bg-amber-500 hover:bg-amber-600 text-graphite-950 font-bold" disabled={confirmingBatch}>
                <CheckCircle2 size={14} />
                {confirmingBatch ? 'Confirmando...' : 'Confirmar todas'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* 3. BLOCO DE RESUMO NO TOPO */}
      <Card className="p-6 bg-graphite-900 border-graphite-800">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pb-4 border-b border-graphite-800">
          <div className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-vapor-400 uppercase tracking-wider">
              Despesa Fixa Mensal
            </span>
            <span className="font-mono text-2xl font-bold text-vapor-100">
              {formatarMoeda(totalMensal)}
            </span>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-vapor-400 uppercase tracking-wider">
              Horas Disponíveis no Mês
            </span>
            <span className="font-mono text-2xl font-bold text-vapor-100">
              {horasDisponiveis}h
            </span>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
              <Clock size={15} />
              Custo por Hora de Operação
            </span>
            <span className="font-mono text-2xl font-bold text-amber-400">
              {formatarMoeda(custoHora)} <span className="text-sm font-sans font-normal text-vapor-400">/hora</span>
            </span>
            {totalPendentes > 0 && (
              <span className="text-[11px] text-vapor-400 flex items-center gap-1 mt-0.5">
                <AlertCircle size={12} className="text-amber-400 shrink-0" />
                Inclui {formatarMoeda(totalPendentes)} em contas ainda não confirmadas.
              </span>
            )}
          </div>
        </div>

        <div className="pt-4 flex items-start gap-2 text-vapor-400 font-sans text-xs">
          <AlertCircle size={15} className="shrink-0 text-amber-500 mt-0.5" />
          <span>
            Este é o custo de manter a oficina aberta, independente de quantos carros entrarem. Cada serviço precisa cobrir a parte dele.
          </span>
        </div>
      </Card>

      {/* 4. SUGESTÕES RÁPIDAS */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-vapor-400 uppercase tracking-wider flex items-center gap-1.5">
          <Sparkles size={14} className="text-amber-400" />
          Sugestões rápidas de cadastro
        </span>
        <div className="flex flex-wrap gap-2">
          {SUGESTOES.map((sug) => (
            <button
              key={sug.nome}
              type="button"
              onClick={() => handleOpenAddModal(sug)}
              className="px-3 py-1.5 rounded-lg bg-graphite-800 hover:bg-graphite-700 text-vapor-200 text-xs font-medium border border-graphite-700 transition-colors flex items-center gap-1.5"
            >
              <Plus size={13} className="text-amber-400" />
              <span>{sug.nome}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 5. LISTA DE DESPESAS AGRUPADAS */}
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-bold text-vapor-100 flex items-center gap-2">
          <Building2 size={20} className="text-amber-500" />
          Despesas Vigentes
        </h3>
        <Button variant="primary" onClick={() => handleOpenAddModal()} className="text-xs">
          <Plus size={15} />
          Nova Despesa
        </Button>
      </div>

      {loading ? (
        <Card className="p-8 text-center text-vapor-400 font-mono text-sm">Carregando despesas fixas...</Card>
      ) : Object.keys(porCategoria).length === 0 ? (
        <Card className="p-8 bg-graphite-900 border-graphite-800 text-center flex flex-col items-center gap-3">
          <DollarSign size={40} className="text-vapor-500" />
          <span className="font-bold text-vapor-200">Nenhuma despesa fixa cadastrada</span>
          <span className="text-vapor-400 text-xs max-w-md">
            Cadastre aluguel, energia e salários para calcular o custo/hora e o lucro líquido real de cada atendimento.
          </span>
          <Button variant="primary" onClick={() => handleOpenAddModal()} className="mt-2 text-xs">
            Cadastrar despesas
          </Button>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {(Object.keys(porCategoria) as CategoriaDespesa[]).map((cat) => {
            const itens = porCategoria[cat];
            const subtotalCat = itens.reduce((acc: number, i: DespesaFixa) => acc + Number(i.valor_mensal), 0);

            return (
              <Card key={cat} className="p-4 bg-graphite-900 border-graphite-800 flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-graphite-800 pb-2">
                  <span className="font-bold text-xs uppercase text-vapor-300 tracking-wider">
                    {CATEGORIAS_ROTULOS[cat] || cat} ({itens.length})
                  </span>
                  <span className="font-mono text-xs font-bold text-amber-400">
                    Subtotal: {formatarMoeda(subtotalCat)}/mês
                  </span>
                </div>

                <div className="flex flex-col gap-2.5">
                  {itens.map((item: DespesaFixa) => {
                    const isParcelada = item.tipo === 'parcelada';
                    const isVariavel = item.tipo === 'variavel';
                    const isRecorrente = item.tipo === 'recorrente';

                    const parcAtual = isParcelada
                      ? calcularParcelaAtual(item.vigencia_inicio, hojeStr, item.parcela_inicial || 1)
                      : null;
                    const totParc = item.total_parcelas || 1;
                    const restolhes = isParcelada ? totParc - (parcAtual || 1) + 1 : null;
                    const encerraEm = isParcelada && item.vigencia_fim ? formatarMesAno(item.vigencia_fim) : null;
                    const proximoDeEncerrar = isParcelada && restolhes !== null && restolhes <= 2 && restolhes > 0;

                    const criadaHoje = item.created_at?.substring(0, 10) === hojeStr;

                    return (
                      <div
                        key={item.id}
                        className="p-3.5 rounded-lg bg-graphite-950/70 border border-graphite-800 flex flex-col gap-2.5"
                      >
                        {/* LINHA 1: NOME E VALOR */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-sm text-vapor-100 truncate">{item.nome}</span>
                          <span className="font-mono text-sm font-bold text-vapor-100 shrink-0">
                            {formatarMoeda(Number(item.valor_mensal))}
                            <span className="text-xs font-normal text-vapor-400">
                              {isRecorrente ? '/mês' : isVariavel ? '' : '/mês'}
                            </span>
                          </span>
                        </div>

                        {/* LINHA 2: BADGES DE STATUS E VIGÊNCIA */}
                        <div className="flex items-center justify-between flex-wrap gap-2 text-xs text-vapor-400">
                          <div className="flex items-center gap-2 flex-wrap">
                            {isRecorrente && <Badge tone="vapor">recorrente</Badge>}
                            {isVariavel && (
                              <Badge tone={item.confirmado ? 'glass' : 'amber'}>
                                {item.confirmado ? 'variável' : 'variável · a confirmar'}
                              </Badge>
                            )}
                            {isParcelada && <Badge tone="glass">parcelada</Badge>}

                            {isRecorrente && (
                              <span className="text-vapor-400 text-xs">Vigência desde {formatarMesAno(item.vigencia_inicio)}</span>
                            )}
                            {isVariavel && (
                              <span className="text-xs">
                                {item.confirmado && item.confirmado_em ? (
                                  <span className="text-vapor-400">
                                    confirmado em {new Date(item.confirmado_em).toLocaleDateString('pt-BR')}
                                  </span>
                                ) : (
                                  <span className="text-amber-400 font-medium">
                                    valor estimado
                                  </span>
                                )}
                              </span>
                            )}
                            {isParcelada && (
                              <span className="text-vapor-400 text-xs">
                                parc. {parcAtual}/{totParc} · encerra em {encerraEm}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* LINHA 3: AÇÕES (AÇÃO PRINCIPAL EM LARGURA TOTAL NO MOBILE + MENU 3 PONTOS AO LADO) */}
                        <div className="flex items-center gap-2 pt-1 border-t border-graphite-800/60">
                          {/* Ação Primária da linha */}
                          {isVariavel && !item.confirmado ? (
                            <button
                              type="button"
                              onClick={() => handleOpenConfirmarIndividual(item)}
                              className="flex-1 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-graphite-950 text-xs font-bold transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                            >
                              <CheckCircle2 size={14} />
                              <span>Confirmar valor</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleOpenNovaVigencia(item)}
                              className="flex-1 sm:flex-initial px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs font-medium border border-amber-500/30 transition-colors flex items-center justify-center gap-1.5"
                            >
                              <History size={14} />
                              <span>Atualizar valor</span>
                            </button>
                          )}

                          {/* Menu de Três Pontos com ações secundárias e tooltips claros */}
                          <div className="relative">
                            <button
                              type="button"
                              onClick={(e) => toggleMenu(item.id, e)}
                              className="p-1.5 rounded-lg bg-graphite-800 hover:bg-graphite-700 text-vapor-300 border border-graphite-700 transition-colors flex items-center justify-center"
                              title="Mais opções"
                            >
                              <MoreVertical size={16} />
                            </button>

                            {openMenuId === item.id && (
                              <>
                                <div
                                  className="fixed inset-0 z-30"
                                  onClick={() => setOpenMenuId(null)}
                                />

                                <div className="absolute right-0 top-full mt-1.5 z-40 w-64 bg-graphite-900 border border-graphite-700 rounded-xl shadow-2xl p-1.5 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-100">
                                  {/* Opção Atualizar valor (no menu caso a ação principal seja Confirmar valor) */}
                                  {isVariavel && !item.confirmado && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenMenuId(null);
                                        handleOpenNovaVigencia(item);
                                      }}
                                      className="w-full px-3 py-2 rounded-lg text-left text-xs font-medium text-vapor-200 hover:bg-graphite-800 transition-colors flex flex-col gap-0.5"
                                    >
                                      <div className="flex items-center gap-1.5 font-semibold text-amber-400">
                                        <History size={13} />
                                        <span>Atualizar valor</span>
                                      </div>
                                      <span className="text-[10px] text-vapor-400 leading-tight">
                                        Novo valor a partir de uma data (preserva o histórico)
                                      </span>
                                    </button>
                                  )}

                                  {/* Editar Dados (Nome e Categoria) */}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      handleOpenEditarCadastral(item);
                                    }}
                                    className="w-full px-3 py-2 rounded-lg text-left text-xs font-medium text-vapor-200 hover:bg-graphite-800 transition-colors flex flex-col gap-0.5"
                                  >
                                    <div className="flex items-center gap-1.5 font-semibold text-vapor-200">
                                      <Edit2 size={13} />
                                      <span>Editar dados</span>
                                    </div>
                                    <span className="text-[10px] text-vapor-400 leading-tight">
                                      Editar nome ou categoria sem alterar vigência
                                    </span>
                                  </button>

                                  {/* Corrigir Lançamento (Apenas se criada hoje) */}
                                  {criadaHoje && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenMenuId(null);
                                        handleOpenCorrigir(item);
                                      }}
                                      className="w-full px-3 py-2 rounded-lg text-left text-xs font-medium text-vapor-200 hover:bg-graphite-800 transition-colors flex flex-col gap-0.5"
                                    >
                                      <div className="flex items-center gap-1.5 font-semibold text-flare-300">
                                        <AlertTriangle size={13} />
                                        <span>Corrigir lançamento</span>
                                      </div>
                                      <span className="text-[10px] text-vapor-400 leading-tight">
                                        Corrigir erro de digitação de hoje
                                      </span>
                                    </button>
                                  )}

                                  {/* Encerrar Despesa */}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      handleOpenEncerrar(item);
                                    }}
                                    className="w-full px-3 py-2 rounded-lg text-left text-xs font-medium text-vapor-200 hover:bg-graphite-800 transition-colors flex flex-col gap-0.5"
                                  >
                                    <div className="flex items-center gap-1.5 font-semibold text-vapor-400 hover:text-flare-400">
                                      <XCircle size={13} />
                                      <span>Encerrar despesa</span>
                                    </div>
                                    <span className="text-[10px] text-vapor-400 leading-tight">
                                      Encerrar vigência no final do mês corrente
                                    </span>
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Alerta de Encerramento Próximo */}
                        {proximoDeEncerrar && (
                          <div className="mt-1 p-2 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2">
                            <AlertCircle size={14} className="shrink-0" />
                            <span>
                              {item.nome} encerra em {restolhes} {restolhes === 1 ? 'mês' : 'meses'}.
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* 6. MODAL DE CONFIRMAÇÃO INDIVIDUAL DE CONTA VARIÁVEL */}
      {isModalConfirmarValorOpen && selectedDespesa && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-graphite-900 border border-graphite-700 rounded-xl p-4 sm:p-6 max-w-md w-full flex flex-col gap-4 shadow-2xl overflow-x-hidden">
            <h3 className="font-display text-lg font-bold text-vapor-100 flex items-center gap-2">
              <CheckCircle2 size={20} className="text-amber-500 shrink-0" />
              <span>Confirmar Valor ({selectedDespesa.nome})</span>
            </h3>

            {errorMsg && (
              <div className="p-3 bg-flare-500/10 border border-flare-500/30 text-flare-300 text-xs rounded">
                {errorMsg}
              </div>
            )}

            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded text-xs text-amber-300">
              Mês de referência: <strong>{mesNomeExtenso}</strong>. Preencha o valor real da fatura para finalizar os cálculos financeiros da oficina.
            </div>

            <form onSubmit={handleSaveConfirmarIndividual} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-vapor-300">Valor Real da Fatura (R$)</label>
                <input
                  type="text"
                  value={valorConfirmarIndividual}
                  onChange={(e) => setValorConfirmarIndividual(e.target.value)}
                  required
                  autoFocus
                  className="w-full bg-graphite-800 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 text-sm font-mono outline-none focus:border-amber-500"
                />
                <span className="text-[11px] text-vapor-400">
                  Valor estimado pré-preenchido: {formatarMoeda(selectedDespesa.valor_mensal)}
                </span>
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-graphite-800">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setIsModalConfirmarValorOpen(false);
                    setSelectedDespesa(null);
                  }}
                >
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" disabled={saving} className="bg-amber-500 hover:bg-amber-600 text-graphite-950 font-bold">
                  {saving ? 'Confirmando...' : 'Confirmar Valor'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 7. MODAL DE CADASTRO DE NOVA DESPESA */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-graphite-900 border border-graphite-700 rounded-xl p-4 sm:p-6 max-w-lg w-full flex flex-col gap-4 shadow-2xl overflow-x-hidden">
            <h3 className="font-display text-lg font-bold text-vapor-100 flex items-center gap-2">
              <Plus size={20} className="text-amber-500" />
              Cadastrar Nova Despesa Fixa
            </h3>

            {errorMsg && (
              <div className="p-3 bg-flare-500/10 border border-flare-500/30 text-flare-300 text-xs rounded">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleSaveNovaDespesa} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-vapor-300">Nome da Despesa</label>
                <input
                  type="text"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Ex: Aluguel, Energia, Internet, Água"
                  required
                  className="w-full bg-graphite-800 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 text-sm outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-vapor-300">Categoria</label>
                  <select
                    value={categoria}
                    onChange={(e) => setCategoria(e.target.value as CategoriaDespesa)}
                    className="w-full bg-graphite-800 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 text-sm outline-none focus:border-amber-500"
                  >
                    <option value="Instalacao">Instalação & Estrutura</option>
                    <option value="Pessoal">Pessoal & Equipe</option>
                    <option value="Servicos">Serviços & Sistemas</option>
                    <option value="Impostos">Impostos & Taxas</option>
                    <option value="Outros">Outros Custos</option>
                    <option value="Geral">Geral</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-vapor-300">Tipo de Despesa</label>
                  <select
                    value={tipo}
                    onChange={(e) => setTipo(e.target.value as TipoDespesa)}
                    className="w-full bg-graphite-800 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 text-sm outline-none focus:border-amber-500"
                  >
                    <option value="recorrente">Recorrente (Valor igual todo mês)</option>
                    <option value="variavel">Variável (Recorrente, muda a cada mês - água, luz)</option>
                    <option value="parcelada">Parcelada / Financiamento (Fim previsto)</option>
                  </select>
                </div>
              </div>

              {tipo === 'variavel' && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded text-xs text-amber-300 flex items-start gap-2">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <span>
                    Informe a última conta como valor de referência. A cada virada de mês, o sistema replicará este valor automaticamente como estimativa até você confirmar o valor real do mês.
                  </span>
                </div>
              )}

              {tipo === 'parcelada' && (
                <div className="grid grid-cols-2 gap-4 p-3 bg-graphite-950 border border-graphite-800 rounded-lg">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-vapor-300">Total de Parcelas</label>
                    <CampoNumerico
                      integerOnly
                      value={totalParcelas}
                      onChange={(val) => setTotalParcelas(val || 1)}
                      placeholder="1"
                      wrapperClassName="w-full min-h-[38px]"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-vapor-300">Parcela Inicial</label>
                    <CampoNumerico
                      integerOnly
                      value={parcelaInicial}
                      onChange={(val) => setParcelaInicial(val || 1)}
                      placeholder="1"
                      wrapperClassName="w-full min-h-[38px]"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-vapor-300">
                    {tipo === 'variavel' ? 'Valor de Referência (R$)' : 'Valor Mensal (R$)'}
                  </label>
                  <input
                    type="text"
                    value={valorMensal}
                    onChange={(e) => setValorMensal(e.target.value)}
                    placeholder="0,00"
                    required
                    className="w-full bg-graphite-800 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 text-sm font-mono outline-none focus:border-amber-500"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-vapor-300">Vigência a partir de</label>
                  <input
                    type="date"
                    value={vigenciaInicio}
                    onChange={(e) => setVigenciaInicio(e.target.value)}
                    required
                    className="w-full bg-graphite-800 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 text-sm outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-graphite-800">
                <Button type="button" variant="secondary" onClick={() => setIsModalOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" disabled={saving}>
                  {saving ? 'Salvando...' : 'Salvar Despesa'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 8. MODAL DE EDIÇÃO CADASTRAL (NOME E CATEGORIA LIVREMENTE) */}
      {isModalEditarCadastralOpen && selectedDespesa && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-graphite-900 border border-graphite-700 rounded-xl p-4 sm:p-6 max-w-md w-full flex flex-col gap-4 shadow-2xl overflow-x-hidden">
            <h3 className="font-display text-lg font-bold text-vapor-100 flex items-center gap-2">
              <Edit2 size={20} className="text-amber-500" />
              Editar Dados da Despesa
            </h3>

            {errorMsg && (
              <div className="p-3 bg-flare-500/10 border border-flare-500/30 text-flare-300 text-xs rounded">
                {errorMsg}
              </div>
            )}

            <div className="p-3 bg-graphite-950 border border-graphite-800 rounded text-xs text-vapor-400">
              Nome e categoria podem ser alterados a qualquer momento sem afetar o histórico financeiro da oficina.
            </div>

            <form onSubmit={handleSaveEditarCadastral} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-vapor-300">Nome da Despesa</label>
                <input
                  type="text"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  required
                  className="w-full bg-graphite-800 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 text-sm outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-vapor-300">Categoria</label>
                <select
                  value={categoria}
                  onChange={(e) => setCategoria(e.target.value as CategoriaDespesa)}
                  className="w-full bg-graphite-800 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 text-sm outline-none focus:border-amber-500"
                >
                  <option value="Instalacao">Instalação & Estrutura</option>
                  <option value="Pessoal">Pessoal & Equipe</option>
                  <option value="Servicos">Serviços & Sistemas</option>
                  <option value="Impostos">Impostos & Taxas</option>
                  <option value="Outros">Outros Custos</option>
                  <option value="Geral">Geral</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-graphite-800">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setIsModalEditarCadastralOpen(false);
                    setSelectedDespesa(null);
                  }}
                >
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" disabled={saving}>
                  {saving ? 'Salvando...' : 'Salvar Alterações'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 9. MODAL DE ATUALIZAR VALOR (NOVA VIGÊNCIA) */}
      {isModalNovaVigenciaOpen && selectedDespesa && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-graphite-900 border border-graphite-700 rounded-xl p-4 sm:p-6 max-w-lg w-full flex flex-col gap-4 shadow-2xl overflow-x-hidden">
            <h3 className="font-display text-lg font-bold text-vapor-100 flex items-center gap-2">
              <History size={20} className="text-amber-500" />
              Atualizar Valor ({selectedDespesa.nome})
            </h3>

            {errorMsg && (
              <div className="p-3 bg-flare-500/10 border border-flare-500/30 text-flare-300 text-xs rounded">
                {errorMsg}
              </div>
            )}

            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded text-xs text-amber-300 flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>
                <strong>Meses anteriores mantêm o valor antigo.</strong> Uma nova vigência será iniciada na data escolhida, preservando a integridade dos relatórios passados.
              </span>
            </div>

            <form onSubmit={handleConfirmNovaVigencia} className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-vapor-300">Novo Valor Mensal (R$)</label>
                  <input
                    type="text"
                    value={novoValor}
                    onChange={(e) => setNovoValor(e.target.value)}
                    required
                    className="w-full bg-graphite-800 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 text-sm font-mono outline-none focus:border-amber-500"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-vapor-300">Nova Vigência a partir de</label>
                  <input
                    type="date"
                    value={novaDataInicio}
                    onChange={(e) => setNovaDataInicio(e.target.value)}
                    required
                    className="w-full bg-graphite-800 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 text-sm outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-graphite-800">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setIsModalNovaVigenciaOpen(false);
                    setSelectedDespesa(null);
                  }}
                >
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" disabled={saving}>
                  {saving ? 'Salvando...' : 'Iniciar Nova Vigência'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 10. MODAL DE CORRIGIR LANÇAMENTO (FEITO HOJE) */}
      {isModalCorrigirOpen && selectedDespesa && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-graphite-900 border border-graphite-700 rounded-xl p-4 sm:p-6 max-w-lg w-full flex flex-col gap-4 shadow-2xl overflow-x-hidden">
            <h3 className="font-display text-lg font-bold text-vapor-100 flex items-center gap-2">
              <AlertTriangle size={20} className="text-amber-500 shrink-0" />
              <span>Corrigir Lançamento Realizado Hoje</span>
            </h3>

            {errorMsg && (
              <div className="p-3 bg-flare-500/10 border border-flare-500/30 text-flare-300 text-xs rounded">
                {errorMsg}
              </div>
            )}

            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded text-xs text-amber-300">
              Como esta despesa foi cadastrada hoje e ainda não possui fechamentos vinculados, você pode corrigir todos os seus campos ou excluí-la permanentemente.
            </div>

            <form onSubmit={handleSaveCorrigir} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-vapor-300">Nome da Despesa</label>
                <input
                  type="text"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  required
                  className="w-full bg-graphite-800 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 text-sm outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-vapor-300">Categoria</label>
                  <select
                    value={categoria}
                    onChange={(e) => setCategoria(e.target.value as CategoriaDespesa)}
                    className="w-full bg-graphite-800 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 text-sm outline-none focus:border-amber-500"
                  >
                    <option value="Instalacao">Instalação & Estrutura</option>
                    <option value="Pessoal">Pessoal & Equipe</option>
                    <option value="Servicos">Serviços & Sistemas</option>
                    <option value="Impostos">Impostos & Taxas</option>
                    <option value="Outros">Outros Custos</option>
                    <option value="Geral">Geral</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-vapor-300">Tipo</label>
                  <select
                    value={tipo}
                    onChange={(e) => setTipo(e.target.value as TipoDespesa)}
                    className="w-full bg-graphite-800 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 text-sm outline-none focus:border-amber-500"
                  >
                    <option value="recorrente">Recorrente (Valor igual todo mês)</option>
                    <option value="variavel">Variável (Recorrente, muda a cada mês)</option>
                    <option value="parcelada">Parcelada / Financiamento</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-vapor-300">Valor Mensal (R$)</label>
                  <input
                    type="text"
                    value={valorMensal}
                    onChange={(e) => setValorMensal(e.target.value)}
                    required
                    className="w-full bg-graphite-800 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 text-sm font-mono outline-none focus:border-amber-500"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-vapor-300">Vigência a partir de</label>
                  <input
                    type="date"
                    value={vigenciaInicio}
                    onChange={(e) => setVigenciaInicio(e.target.value)}
                    required
                    className="w-full bg-graphite-800 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 text-sm outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              {/* AÇÕES NO RODAPÉ DO MODAL */}
              <div className="flex flex-col gap-2.5 pt-3 border-t border-graphite-800">
                <Button
                  type="submit"
                  variant="primary"
                  disabled={saving}
                  className="w-full text-xs justify-center font-bold tracking-wider py-2.5"
                >
                  {saving ? 'Salvando...' : 'Salvar Correção'}
                </Button>

                <div className="grid grid-cols-2 gap-2.5">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleExcluirHoje}
                    disabled={saving}
                    className="w-full bg-flare-500/10 hover:bg-flare-500/20 text-flare-300 border-flare-500/30 text-xs justify-center"
                  >
                    <Trash2 size={14} />
                    Excluir
                  </Button>

                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setIsModalCorrigirOpen(false);
                      setSelectedDespesa(null);
                    }}
                    className="w-full text-xs justify-center"
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 11. MODAL DE ENCERRAR DESPESA */}
      {isModalEncerrarOpen && selectedDespesa && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-graphite-900 border border-graphite-700 rounded-xl p-4 sm:p-6 max-w-md w-full flex flex-col gap-4 shadow-2xl overflow-x-hidden">
            <h3 className="font-display text-lg font-bold text-vapor-100 flex items-center gap-2">
              <XCircle size={20} className="text-flare-400" />
              Encerrar Despesa ({selectedDespesa.nome})
            </h3>

            {errorMsg && (
              <div className="p-3 bg-flare-500/10 border border-flare-500/30 text-flare-300 text-xs rounded">
                {errorMsg}
              </div>
            )}

            <p className="text-xs text-vapor-300 leading-relaxed">
              Ao encerrar esta despesa, a vigência será finalizada no último dia do mês corrente.
            </p>

            <div className="p-3 bg-graphite-950 border border-graphite-800 rounded text-xs text-vapor-400">
              A despesa continuará contabilizada nos relatórios até o mês corrente e deixará de entrar no cálculo a partir do mês seguinte. O histórico de relatórios passados não será alterado.
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-graphite-800">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setIsModalEncerrarOpen(false);
                  setSelectedDespesa(null);
                }}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={handleConfirmEncerrar}
                disabled={saving}
                className="bg-flare-500 hover:bg-flare-600 text-white"
              >
                {saving ? 'Encerrando...' : 'Confirmar Encerramento'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
