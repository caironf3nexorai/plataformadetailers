import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { PageHeader } from '../../components/layout/PageHeader';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissao } from '../../hooks/usePermissao';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { formatarMoeda, parseNumeroFlexivel, cleanTelefone, formatTelefone } from '../../utils/formatters';
import { Modal } from '../../components/ui/Modal';
import { CampoNumerico } from '../../components/ui/CampoNumerico';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Search,
  ShieldAlert,
  CreditCard,
  User,
  Phone,
  MessageCircle,
  Users,
  Landmark,
  Info,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { NavegacaoFinanceiro } from '../../components/financeiro/NavegacaoFinanceiro';
import { usePlano } from '../../hooks/usePlano';
import { BloqueioRecursoPlano } from '../../components/planos/BloqueioRecursoPlano';
import { marcarPassoOnboarding } from '../../utils/onboarding';

interface ItemContaReceber {
  id: string;
  cliente_id: string;
  cliente_nome: string;
  cliente_telefone: string | null;
  forma_nome: string | null;
  forma_tipo: string | null;
  maquininha_nome?: string | null;
  bandeira_codigo?: string | null;
  taxa_estimada?: boolean;
  numero_parcela: number;
  total_parcelas: number;
  valor_bruto: number;
  valor_liquido: number | null;
  previsto_para: string;
  dias_atraso: number;
  status: 'previsto' | 'recebido' | 'cancelado';
  observacao: string | null;
}

interface FormaQuitacaoOption {
  id: string;
  nome: string;
  tipo: string;
}

const obterDataLocalISO = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const isItemCartao = (formaTipo?: string | null): boolean =>
  formaTipo === 'debito' || formaTipo === 'credito';

const formatarDataBr = (iso?: string | null): string => {
  if (!iso) return '—';
  const parts = iso.substring(0, 10).split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
};

export const ContasReceber: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { tenant } = useAuth();
  const { isDono, isGerente } = usePermissao();
  const { showToast } = useToast();
  const { temFeature, carregandoPermissoes } = usePlano();

  const podeAcessar = isDono || isGerente;

  const abaInicialParam = searchParams.get('aba');
  const [abaOrigem, setAbaOrigem] = useState<'clientes' | 'cartoes'>(
    abaInicialParam === 'cartoes' ? 'cartoes' : 'clientes'
  );

  useEffect(() => {
    const param = searchParams.get('aba');
    if (param === 'cartoes') {
      setAbaOrigem('cartoes');
    } else if (param === 'clientes') {
      setAbaOrigem('clientes');
    }
  }, [searchParams]);

  const handleTrocarAba = (novaAba: 'clientes' | 'cartoes') => {
    setAbaOrigem(novaAba);
    setFiltroStatus('todos');
    if (novaAba === 'cartoes') {
      setSearchParams({ aba: 'cartoes' }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  };

  const [loading, setLoading] = useState(true);
  const [recebidoMes, setRecebidoMes] = useState(0);
  const [faturamentoTaxaEstimadaMes, setFaturamentoTaxaEstimadaMes] = useState(0);
  const [itens, setItens] = useState<ItemContaReceber[]>([]);
  const [formasQuitacao, setFormasQuitacao] = useState<FormaQuitacaoOption[]>([]);

  // Filtros
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'vencidos' | 'vence_hoje' | 'a_vencer'>('todos');
  const [baixandoId, setBaixandoId] = useState<string | null>(null);
  const [itemParaBaixar, setItemParaBaixar] = useState<{
    id: string;
    clienteNome: string;
    valorBruto: number;
    valorLiquido: number;
    valorTaxa: number;
    isCartao: boolean;
    formaNome: string;
    maquininhaNome?: string | null;
    parcelaInfo: string;
    vencimento: string;
  } | null>(null);
  const [valorPagoInput, setValorPagoInput] = useState<string>('');
  const [formaQuitacaoId, setFormaQuitacaoId] = useState<string>('');

  const fetchContasReceber = useCallback(async () => {
    if (!tenant || !podeAcessar) return;
    setLoading(true);
    try {
      const [resContas, resFormas] = await Promise.all([
        supabase.rpc('obter_contas_a_receber', {
          p_inicio: null,
          p_fim: null,
        }),
        supabase
          .from('tenant_formas_pagamento')
          .select('id, nome, tipo')
          .eq('tenant_id', tenant.id)
          .eq('ativo', true)
          .neq('tipo', 'fiado')
          .order('ordem', { ascending: true }),
      ]);

      if (resContas.error) throw resContas.error;

      if (resContas.data) {
        setRecebidoMes(Number(resContas.data.recebido_mes || 0));
        setFaturamentoTaxaEstimadaMes(Number(resContas.data.faturamento_taxa_estimada_mes || 0));
        setItens(Array.isArray(resContas.data.itens) ? resContas.data.itens : []);
      }

      if (!resFormas.error && Array.isArray(resFormas.data)) {
        setFormasQuitacao(resFormas.data as FormaQuitacaoOption[]);
      }
    } catch (err: any) {
      console.error('Erro ao carregar contas a receber:', err);
      showToast(err.message || 'Erro ao carregar dados de contas a receber', 'error');
    } finally {
      setLoading(false);
    }
  }, [tenant, podeAcessar, showToast]);

  useEffect(() => {
    fetchContasReceber();
    if (tenant?.id && podeAcessar) {
      marcarPassoOnboarding(tenant.id, { financeiro_revisado: true, contas_receber_revisado: true });
    }
  }, [tenant?.id, podeAcessar, fetchContasReceber]);

  useEffect(() => {
    const handleAtualizado = () => {
      fetchContasReceber();
    };
    window.addEventListener('financeiro_atualizado', handleAtualizado);
    return () => window.removeEventListener('financeiro_atualizado', handleAtualizado);
  }, [fetchContasReceber]);

  const handleSolicitarBaixa = (item: ItemContaReceber) => {
    const cartao = isItemCartao(item.forma_tipo);
    const bruto = Number(item.valor_bruto ?? 0);
    const liquido = Number(item.valor_liquido ?? bruto);
    const taxa = Math.max(0, Math.round((bruto - liquido) * 100) / 100);
    const valorInicial = cartao ? liquido : bruto;

    setItemParaBaixar({
      id: item.id,
      clienteNome: item.cliente_nome || 'Cliente',
      valorBruto: bruto,
      valorLiquido: liquido,
      valorTaxa: taxa,
      isCartao: cartao,
      formaNome: item.forma_nome || (cartao ? 'Cartão' : 'Fiado / A Prazo'),
      maquininhaNome: item.maquininha_nome,
      parcelaInfo: (item.total_parcelas || 1) > 1 ? `Parcela ${item.numero_parcela || 1}/${item.total_parcelas}` : 'À vista (1/1)',
      vencimento: formatarDataBr(item.previsto_para),
    });
    setValorPagoInput(valorInicial.toFixed(2).replace('.', ','));

    if (!cartao && formasQuitacao.length > 0) {
      const pixDefault = formasQuitacao.find((f) => f.tipo === 'pix') || formasQuitacao[0];
      setFormaQuitacaoId(pixDefault?.id || '');
    } else {
      setFormaQuitacaoId('');
    }
  };

  const handleConfirmarBaixa = async () => {
    if (!itemParaBaixar) return;
    const { id, isCartao } = itemParaBaixar;
    const valPago = parseNumeroFlexivel(valorPagoInput);
    if (valPago <= 0) {
      showToast('O valor recebido deve ser maior que zero.', 'error');
      return;
    }

    setBaixandoId(id);
    try {
      const { data, error } = await supabase.rpc('dar_baixa_recebimento', {
        p_recebimento_id: id,
        p_valor_pago: valPago,
        p_forma_quitacao_id: !isCartao && formaQuitacaoId ? formaQuitacaoId : null,
      });

      if (error) throw error;

      showToast(data?.mensagem || (isCartao ? 'Repasse de cartão confirmado!' : 'Baixa efetuada com sucesso!'), 'success');
      setItemParaBaixar(null);
      await fetchContasReceber();
      window.dispatchEvent(new CustomEvent('financeiro_atualizado'));
    } catch (err: any) {
      console.error('Erro ao dar baixa:', err);
      showToast(err.message || 'Erro ao registrar baixa', 'error');
    } finally {
      setBaixandoId(null);
    }
  };

  const handleCobrarWhatsApp = (item: ItemContaReceber) => {
    const tel = cleanTelefone(item.cliente_telefone);
    if (!tel) {
      showToast('Este cliente não possui telefone cadastrado.', 'error');
      return;
    }
    const primeiroNome = (item.cliente_nome || 'Cliente').split(' ')[0];
    const valorFmt = formatarMoeda(Number(item.valor_bruto ?? 0));
    const dataFmt = formatarDataBr(item.previsto_para);
    const parcelaTxt = (item.total_parcelas || 1) > 1 ? ` (parcela ${item.numero_parcela}/${item.total_parcelas})` : '';
    const oficina = tenant?.nome || 'nossa oficina';
    const atrasado = (item.dias_atraso ?? 0) > 0;
    const mensagem = atrasado
      ? `Olá, ${primeiroNome}! Tudo bem? Aqui é da ${oficina}. Passando para lembrar do valor em aberto de ${valorFmt}${parcelaTxt}, com vencimento em ${dataFmt}. Se já efetuou o pagamento, por favor nos envie o comprovante. Qualquer dúvida, estamos à disposição!`
      : `Olá, ${primeiroNome}! Tudo bem? Aqui é da ${oficina}. Passando para lembrar do vencimento de ${valorFmt}${parcelaTxt} previsto para ${dataFmt}. Caso precise da chave Pix ou de ajuda, é só chamar por aqui!`;

    window.open(`https://wa.me/55${tel}?text=${encodeURIComponent(mensagem)}`, '_blank', 'noopener,noreferrer');
  };

  if (!podeAcessar) {
    return (
      <div className="flex flex-col gap-6 max-w-4xl mx-auto py-12">
        <Card className="p-8 bg-graphite-900 border-graphite-800 text-center flex flex-col items-center gap-4">
          <ShieldAlert size={48} className="text-flare-400" />
          <h2 className="font-display text-xl font-bold text-vapor-100">Acesso Restrito ao Contas a Receber</h2>
          <p className="text-vapor-400 text-sm max-w-md">
            O módulo de cobrança e recebimentos é restrito aos perfis de Dono e Gerente.
          </p>
          <Button variant="secondary" onClick={() => navigate('/hoje')} className="mt-2 text-xs">
            Voltar para o Painel Operacional
          </Button>
        </Card>
      </div>
    );
  }

  if (!carregandoPermissoes && !temFeature('relatorios_dre')) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Contas a Receber" />
        <BloqueioRecursoPlano
          recurso="Contas a Receber & Cobrança"
          descricao="A gestão de parcelas, crediário próprio, controle de inadimplência e baixas parciais de pagamentos está disponível a partir do Plano Pro."
          planoMinimo="Pro"
          beneficios={[
            'Controle de parcelamentos e crediário sem maquininha',
            'Alerta automático de clientes com parcelas em atraso',
            'Baixas parciais com recálculo automático de saldo',
            'Previsão de entradas e fluxo de recebimento no mês',
          ]}
        />
      </div>
    );
  }

  const hojeIso = obterDataLocalISO();
  const mesAtualPrefix = hojeIso.substring(0, 7);

  // Separação limpa: Clientes / Fiado vs Cartões / Maquininha
  const itensClientes = itens.filter((i) => !isItemCartao(i.forma_tipo));
  const itensCartoes = itens.filter((i) => isItemCartao(i.forma_tipo));

  const baseAbaAtual = abaOrigem === 'clientes' ? itensClientes : itensCartoes;

  // Métricas separadas para clareza gerencial (sem contaminar inadimplência com repasses de cartão)
  const totalClientesMes = itensClientes
    .filter((i) => (i.previsto_para || '').startsWith(mesAtualPrefix))
    .reduce((acc, i) => acc + Number(i.valor_bruto ?? 0), 0);
  const totalClientesVencido = itensClientes
    .filter((i) => (i.dias_atraso ?? 0) > 0)
    .reduce((acc, i) => acc + Number(i.valor_bruto ?? 0), 0);
  const qtdClientesVencidos = itensClientes.filter((i) => (i.dias_atraso ?? 0) > 0).length;

  const totalCartoesBruto = itensCartoes.reduce((acc, i) => acc + Number(i.valor_bruto ?? 0), 0);
  const totalCartoesLiquido = itensCartoes.reduce((acc, i) => acc + Number(i.valor_liquido ?? i.valor_bruto ?? 0), 0);
  const totalCartoesTaxas = Math.max(0, Math.round((totalCartoesBruto - totalCartoesLiquido) * 100) / 100);

  // Contadores da aba ativa
  const qtdVencidosAba = baseAbaAtual.filter((i) => (i.dias_atraso ?? 0) > 0).length;
  const qtdVenceHojeAba = baseAbaAtual.filter(
    (i) => (i.dias_atraso ?? 0) === 0 && (i.previsto_para || '').substring(0, 10) === hojeIso
  ).length;
  const qtdAVencerFuturoAba = baseAbaAtual.filter(
    (i) => (i.dias_atraso ?? 0) === 0 && (i.previsto_para || '').substring(0, 10) > hojeIso
  ).length;

  // Filtragem local
  const itensFiltrados = baseAbaAtual.filter((item) => {
    const termo = busca.toLowerCase().trim();
    const bateBusca =
      !termo ||
      (item.cliente_nome || '').toLowerCase().includes(termo) ||
      (item.cliente_telefone && item.cliente_telefone.includes(termo)) ||
      (item.forma_nome && item.forma_nome.toLowerCase().includes(termo)) ||
      (item.maquininha_nome && item.maquininha_nome.toLowerCase().includes(termo)) ||
      (item.observacao && item.observacao.toLowerCase().includes(termo));

    if (!bateBusca) return false;

    const atraso = item.dias_atraso ?? 0;
    const dataIso = (item.previsto_para || '').substring(0, 10);

    if (filtroStatus === 'vencidos') return atraso > 0;
    if (filtroStatus === 'vence_hoje') return atraso === 0 && dataIso === hojeIso;
    if (filtroStatus === 'a_vencer') return atraso === 0 && dataIso > hojeIso;

    return true;
  });

  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageHeader title="Contas a Receber" />
      <NavegacaoFinanceiro />

      {faturamentoTaxaEstimadaMes > 0 && (
        <Card className="p-4 bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <AlertTriangle size={22} className="text-amber-400 shrink-0" />
            <div className="flex flex-col text-xs text-amber-200">
              <span className="font-bold">Faturamento com Taxa Estimada (Não Cadastrada)</span>
              <span>
                {formatarMoeda(faturamentoTaxaEstimadaMes)} do faturamento deste mês foi fechado utilizando taxas de cartão não encontradas na tabela (consideradas 0%).
              </span>
            </div>
          </div>
          <Button
            variant="secondary"
            onClick={() => navigate('/financeiro/taxas')}
            className="text-xs shrink-0 font-semibold"
          >
            Configurar Taxas
          </Button>
        </Card>
      )}

      {/* SELETOR PRINCIPAL DE ORIGEM: CLIENTES/FIADO VS CARTÕES/MAQUININHA */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => handleTrocarAba('clientes')}
          className={`p-4 rounded-xl border text-left transition-all flex items-center justify-between gap-3 ${
            abaOrigem === 'clientes'
              ? 'bg-amber-500/15 border-amber-500 shadow-lg shadow-amber-500/5'
              : 'bg-graphite-900 border-graphite-800 hover:border-graphite-700'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className={`p-2.5 rounded-lg shrink-0 ${abaOrigem === 'clientes' ? 'bg-amber-500 text-graphite-950' : 'bg-graphite-800 text-amber-400'}`}>
              <Users size={18} />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-bold text-sm text-vapor-100">Clientes / Fiado</span>
              <span className="text-[11px] text-vapor-400 truncate">
                Parcelamentos próprios e cobranças em aberto
              </span>
            </div>
          </div>
          <div className="flex flex-col items-end shrink-0">
            <Badge tone={qtdClientesVencidos > 0 ? 'amber' : 'glass'}>
              {itensClientes.length} {itensClientes.length === 1 ? 'título' : 'títulos'}
            </Badge>
            {qtdClientesVencidos > 0 && (
              <span className="text-[10px] font-mono text-amber-400 mt-1">
                {qtdClientesVencidos} em atraso
              </span>
            )}
          </div>
        </button>

        <button
          type="button"
          onClick={() => handleTrocarAba('cartoes')}
          className={`p-4 rounded-xl border text-left transition-all flex items-center justify-between gap-3 ${
            abaOrigem === 'cartoes'
              ? 'bg-sky-500/15 border-sky-500 shadow-lg shadow-sky-500/5'
              : 'bg-graphite-900 border-graphite-800 hover:border-graphite-700'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className={`p-2.5 rounded-lg shrink-0 ${abaOrigem === 'cartoes' ? 'bg-sky-500 text-graphite-950' : 'bg-graphite-800 text-sky-400'}`}>
              <Landmark size={18} />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-bold text-sm text-vapor-100">Cartões / Maquininha</span>
              <span className="text-[11px] text-vapor-400 truncate">
                Repasses previstos da operadora (sem cobrança ao cliente)
              </span>
            </div>
          </div>
          <div className="flex flex-col items-end shrink-0">
            <Badge tone={itensCartoes.length > 0 ? 'glass' : 'mint'}>
              {itensCartoes.length} {itensCartoes.length === 1 ? 'repasse' : 'repasses'}
            </Badge>
            {totalCartoesLiquido > 0 && (
              <span className="text-[10px] font-mono text-mint-400 mt-1">
                Líq. {formatarMoeda(totalCartoesLiquido)}
              </span>
            )}
          </div>
        </button>
      </div>

      {/* CARDS DE DESTAQUE NO TOPO (IBM Plex Mono) */}
      {abaOrigem === 'clientes' ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="p-5 bg-graphite-900 border-graphite-800 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-vapor-400 uppercase tracking-wider">Clientes a Receber no Mês</span>
              <Clock size={20} className="text-amber-400" />
            </div>
            <span className="font-mono text-3xl font-bold text-vapor-100">{formatarMoeda(totalClientesMes)}</span>
            <span className="text-[11px] text-vapor-400">Parcelas de fiado/crediário com vencimento neste mês</span>
          </Card>

          <Card
            className={`p-5 bg-graphite-900 border flex flex-col gap-2 ${
              totalClientesVencido > 0 ? 'border-amber-500/50 bg-amber-500/5' : 'border-graphite-800'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-300 uppercase tracking-wider">Inadimplência Real (Atrasados)</span>
              <AlertTriangle size={20} className="text-amber-400" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-3xl font-bold text-amber-400">{formatarMoeda(totalClientesVencido)}</span>
              {qtdClientesVencidos > 0 && (
                <Badge tone="amber">
                  {qtdClientesVencidos} {qtdClientesVencidos === 1 ? 'título' : 'títulos'}
                </Badge>
              )}
            </div>
            <span className="text-[11px] text-amber-300/80">Exclusivamente clientes em atraso (cartões separados)</span>
          </Card>

          <Card className="p-5 bg-graphite-900 border-graphite-800 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-vapor-400 uppercase tracking-wider">Recebido este Mês</span>
              <CheckCircle2 size={20} className="text-mint-400" />
            </div>
            <span className="font-mono text-3xl font-bold text-mint-400">{formatarMoeda(recebidoMes)}</span>
            <span className="text-[11px] text-vapor-400">Total já quitado e confirmado no caixa este mês</span>
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="p-5 bg-graphite-900 border-graphite-800 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-vapor-400 uppercase tracking-wider">Valor Bruto em Cartões</span>
              <CreditCard size={20} className="text-sky-400" />
            </div>
            <span className="font-mono text-3xl font-bold text-vapor-100">{formatarMoeda(totalCartoesBruto)}</span>
            <span className="text-[11px] text-vapor-400">Total passado na maquininha aguardando repasse</span>
          </Card>

          <Card className="p-5 bg-graphite-900 border-graphite-800 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-vapor-400 uppercase tracking-wider">Taxas da Operadora</span>
              <Info size={20} className="text-amber-400" />
            </div>
            <span className="font-mono text-3xl font-bold text-amber-400">− {formatarMoeda(totalCartoesTaxas)}</span>
            <span className="text-[11px] text-vapor-400">Desconto retido automaticamente pela maquininha</span>
          </Card>

          <Card className="p-5 bg-graphite-900 border-mint-500/30 border flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-mint-300 uppercase tracking-wider">Valor Líquido a Cair no Banco</span>
              <CheckCircle2 size={20} className="text-mint-400" />
            </div>
            <span className="font-mono text-3xl font-bold text-mint-400">{formatarMoeda(totalCartoesLiquido)}</span>
            <span className="text-[11px] text-vapor-400">Valor esperado para conciliação dos repasses</span>
          </Card>
        </div>
      )}

      {/* BARRA DE FILTROS E PESQUISA */}
      <Card className="p-4 bg-graphite-900 border-graphite-800 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          <button
            type="button"
            onClick={() => setFiltroStatus('todos')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              filtroStatus === 'todos'
                ? 'bg-amber-500 text-graphite-950 shadow'
                : 'bg-graphite-800 text-vapor-400 hover:text-vapor-100'
            }`}
          >
            Todos ({baseAbaAtual.length})
          </button>
          <button
            type="button"
            onClick={() => setFiltroStatus('vencidos')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              filtroStatus === 'vencidos'
                ? 'bg-flare-500 text-white shadow'
                : 'bg-graphite-800 text-flare-300 hover:bg-graphite-750'
            }`}
          >
            <AlertTriangle size={13} />
            {abaOrigem === 'clientes' ? 'Em Atraso' : 'Repasse Vencido'} ({qtdVencidosAba})
          </button>
          <button
            type="button"
            onClick={() => setFiltroStatus('vence_hoje')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              filtroStatus === 'vence_hoje'
                ? 'bg-amber-500 text-graphite-950 shadow'
                : 'bg-graphite-800 text-amber-400 hover:bg-graphite-750'
            }`}
          >
            <Clock size={13} />
            {abaOrigem === 'clientes' ? 'Vence Hoje' : 'Previsto Hoje'} ({qtdVenceHojeAba})
          </button>
          <button
            type="button"
            onClick={() => setFiltroStatus('a_vencer')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              filtroStatus === 'a_vencer'
                ? 'bg-amber-500 text-graphite-950 shadow'
                : 'bg-graphite-800 text-vapor-400 hover:text-vapor-100'
            }`}
          >
            A Vencer ({qtdAVencerFuturoAba})
          </button>
        </div>

        <div className="relative w-full sm:w-72">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-vapor-400" />
          <input
            type="text"
            placeholder={
              abaOrigem === 'clientes'
                ? 'Buscar por cliente, telefone ou forma...'
                : 'Buscar por cliente, maquininha ou bandeira...'
            }
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full bg-graphite-950 border border-graphite-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-vapor-100 placeholder:text-vapor-500 outline-none focus:border-amber-500 transition-colors"
          />
        </div>
      </Card>

      {/* LISTA DE RECEBIMENTOS */}
      <Card className="p-4 sm:p-6 bg-graphite-900 border-graphite-800 flex flex-col gap-4">
        {loading ? (
          <div className="py-12 text-center text-vapor-400 font-mono text-sm">Carregando títulos a receber...</div>
        ) : itensFiltrados.length === 0 ? (
          <div className="py-12 text-center flex flex-col items-center gap-2">
            <CheckCircle2 size={36} className="text-mint-400/60" />
            <span className="font-bold text-vapor-200 text-sm">
              {abaOrigem === 'clientes'
                ? 'Nenhuma cobrança de cliente pendente'
                : 'Nenhum repasse de cartão pendente'}
            </span>
            <span className="text-vapor-400 text-xs">
              {busca || filtroStatus !== 'todos'
                ? 'Nenhum resultado encontrado para os filtros selecionados.'
                : abaOrigem === 'clientes'
                ? 'Todos os pagamentos de clientes estão em dia!'
                : 'Todos os repasses da maquininha já foram confirmados no caixa!'}
            </span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-sans">
              <thead>
                <tr className="border-b border-graphite-800 text-vapor-400 uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-3">Cliente</th>
                  <th className="py-3 px-3">
                    {abaOrigem === 'clientes' ? 'Forma / Origem' : 'Cartão / Maquininha'}
                  </th>
                  <th className="py-3 px-3 text-center">Parcela</th>
                  <th className="py-3 px-3 text-right">Valor Bruto</th>
                  {abaOrigem === 'cartoes' && <th className="py-3 px-3 text-right">Taxa</th>}
                  <th className="py-3 px-3 text-right">
                    {abaOrigem === 'cartoes' ? 'Líquido Esperado' : 'Valor Líquido'}
                  </th>
                  <th className="py-3 px-3 text-center">
                    {abaOrigem === 'clientes' ? 'Vencimento' : 'Previsão Repasse'}
                  </th>
                  <th className="py-3 px-3 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-graphite-850">
                {itensFiltrados.map((item) => {
                  const atraso = item.dias_atraso ?? 0;
                  const dataIso = (item.previsto_para || '').substring(0, 10);
                  const isVencido = atraso > 0;
                  const isVenceHoje = !isVencido && dataIso === hojeIso;
                  const dataVenc = formatarDataBr(item.previsto_para);
                  const bruto = Number(item.valor_bruto ?? 0);
                  const liquido = Number(item.valor_liquido ?? bruto);
                  const taxa = Math.max(0, Math.round((bruto - liquido) * 100) / 100);
                  const temWhatsApp = Boolean(cleanTelefone(item.cliente_telefone));

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-graphite-800/40 transition-colors ${
                        isVencido
                          ? abaOrigem === 'clientes'
                            ? 'bg-flare-500/5'
                            : 'bg-sky-500/5'
                          : isVenceHoje
                          ? 'bg-amber-500/5'
                          : ''
                      }`}
                    >
                      {/* Cliente */}
                      <td className="py-3.5 px-3">
                        <div className="flex flex-col gap-0.5">
                          <button
                            type="button"
                            onClick={() => navigate(`/clientes/${item.cliente_id}`)}
                            className="font-bold text-vapor-100 hover:text-amber-400 text-sm text-left transition-colors flex items-center gap-1.5"
                          >
                            <User size={14} className="text-vapor-400 shrink-0" />
                            {item.cliente_nome || 'Cliente'}
                          </button>
                          {item.cliente_telefone && (
                            <span className="text-[11px] font-mono text-vapor-400 flex items-center gap-1">
                              <Phone size={11} className="shrink-0" />
                              {formatTelefone(item.cliente_telefone)}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Forma / Maquininha */}
                      <td className="py-3.5 px-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold text-vapor-200 flex items-center gap-1.5 flex-wrap">
                            <CreditCard size={13} className={abaOrigem === 'cartoes' ? 'text-sky-400 shrink-0' : 'text-amber-500 shrink-0'} />
                            <span>{item.forma_nome || 'A definir'}</span>
                            {item.maquininha_nome && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-graphite-800 border border-graphite-700 text-vapor-300">
                                {item.maquininha_nome}
                                {item.bandeira_codigo ? ` • ${item.bandeira_codigo.toUpperCase()}` : ''}
                              </span>
                            )}
                          </span>
                          {item.taxa_estimada && abaOrigem === 'cartoes' && (
                            <span className="text-[10px] text-amber-300 font-semibold">
                              Taxa estimada (0% — configure na aba Taxas)
                            </span>
                          )}
                          {item.observacao && (
                            <span className="text-[10px] text-vapor-400 italic max-w-xs truncate">{item.observacao}</span>
                          )}
                        </div>
                      </td>

                      {/* Parcela */}
                      <td className="py-3.5 px-3 text-center font-mono text-vapor-300">
                        {(item.total_parcelas || 1) > 1
                          ? `${item.numero_parcela || 1}/${item.total_parcelas}`
                          : 'À vista (1/1)'}
                      </td>

                      {/* Valor Bruto */}
                      <td className="py-3.5 px-3 text-right font-mono text-sm font-bold text-vapor-100">
                        {formatarMoeda(bruto)}
                      </td>

                      {/* Taxa (somente aba Cartões) */}
                      {abaOrigem === 'cartoes' && (
                        <td className="py-3.5 px-3 text-right font-mono text-xs text-amber-400">
                          {taxa > 0 ? `− ${formatarMoeda(taxa)}` : 'R$ 0,00'}
                        </td>
                      )}

                      {/* Valor Líquido */}
                      <td className="py-3.5 px-3 text-right font-mono text-xs text-mint-400 font-semibold">
                        {formatarMoeda(liquido)}
                      </td>

                      {/* Vencimento & Status */}
                      <td className="py-3.5 px-3 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className="font-mono text-xs text-vapor-200">{dataVenc}</span>
                          {isVencido ? (
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold inline-flex items-center gap-1 ${
                                abaOrigem === 'clientes'
                                  ? 'bg-flare-500/20 text-flare-300 border border-flare-500/40'
                                  : 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                              }`}
                            >
                              <AlertTriangle size={10} />
                              {abaOrigem === 'clientes' ? `Vencido há ${atraso}d` : `Previsto há ${atraso}d`}
                            </span>
                          ) : isVenceHoje ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 inline-flex items-center gap-1">
                              <Clock size={10} />
                              {abaOrigem === 'clientes' ? 'Vence Hoje' : 'Repasse Hoje'}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-graphite-800 text-vapor-400 border border-graphite-700">
                              A vencer
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Ações */}
                      <td className="py-3.5 px-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {abaOrigem === 'clientes' && temWhatsApp && (
                            <button
                              type="button"
                              onClick={() => handleCobrarWhatsApp(item)}
                              title="Cobrar no WhatsApp"
                              className="p-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-400 border border-emerald-500/30 transition-colors"
                            >
                              <MessageCircle size={14} />
                            </button>
                          )}
                          <Button
                            variant="primary"
                            onClick={() => handleSolicitarBaixa(item)}
                            disabled={baixandoId === item.id}
                            className="text-xs px-3 py-1 bg-mint-500 hover:bg-mint-400 text-graphite-950 font-bold border-none whitespace-nowrap"
                          >
                            {baixandoId === item.id
                              ? 'Confirmando...'
                              : abaOrigem === 'cartoes'
                              ? 'Confirmar Repasse'
                              : 'Dar Baixa'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Modal Inteligente de Baixa (Clientes vs Repasse de Cartão) */}
      {itemParaBaixar && (
        <Modal
          isOpen={Boolean(itemParaBaixar)}
          onClose={() => setItemParaBaixar(null)}
          title={itemParaBaixar.isCartao ? 'Confirmar Repasse de Cartão' : 'Confirmar Recebimento de Cliente'}
          maxWidth="md"
          footer={
            <div className="flex items-center justify-end gap-3 w-full">
              <Button
                variant="secondary"
                onClick={() => setItemParaBaixar(null)}
                disabled={baixandoId !== null}
              >
                Cancelar
              </Button>
              <Button
                variant="primary"
                onClick={handleConfirmarBaixa}
                disabled={baixandoId !== null}
                className="bg-mint-500 hover:bg-mint-400 text-graphite-950 font-bold"
              >
                {baixandoId
                  ? 'Registrando...'
                  : itemParaBaixar.isCartao
                  ? 'Confirmar Repasse no Caixa'
                  : 'Confirmar Recebimento'}
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-4 py-1">
            {/* Detalhes do Título */}
            <div className="p-3.5 bg-graphite-950 rounded-xl border border-graphite-800 flex flex-col gap-1.5 text-xs">
              <div className="flex justify-between items-center text-vapor-300 font-medium">
                <span>Cliente:</span>
                <span className="font-bold text-vapor-100 text-sm">{itemParaBaixar.clienteNome}</span>
              </div>
              <div className="flex justify-between items-center text-vapor-400">
                <span>Origem:</span>
                <span className="font-mono text-vapor-200">
                  {itemParaBaixar.formaNome}
                  {itemParaBaixar.maquininhaNome ? ` • ${itemParaBaixar.maquininhaNome}` : ''}
                </span>
              </div>
              <div className="flex justify-between items-center text-vapor-400">
                <span>Parcela / Data:</span>
                <span className="font-mono text-vapor-200">
                  {itemParaBaixar.parcelaInfo} • {itemParaBaixar.vencimento}
                </span>
              </div>

              {itemParaBaixar.isCartao ? (
                <div className="pt-2 mt-1 border-t border-graphite-800 flex flex-col gap-1">
                  <div className="flex justify-between items-center text-vapor-400">
                    <span>Valor Bruto Passado:</span>
                    <span className="font-mono text-vapor-200">{formatarMoeda(itemParaBaixar.valorBruto)}</span>
                  </div>
                  <div className="flex justify-between items-center text-amber-400">
                    <span>Taxa Descontada:</span>
                    <span className="font-mono">− {formatarMoeda(itemParaBaixar.valorTaxa)}</span>
                  </div>
                  <div className="flex justify-between items-center text-mint-400 font-bold">
                    <span>Valor Líquido Esperado:</span>
                    <span className="font-mono">{formatarMoeda(itemParaBaixar.valorLiquido)}</span>
                  </div>
                </div>
              ) : (
                <div className="flex justify-between items-center text-vapor-400 pt-1.5 mt-1 border-t border-graphite-800">
                  <span>Valor Previsto da Parcela:</span>
                  <span className="font-mono font-bold text-vapor-100">{formatarMoeda(itemParaBaixar.valorBruto)}</span>
                </div>
              )}
            </div>

            {/* Seletor de Meio de Quitação (Somente para Clientes / Fiado) */}
            {!itemParaBaixar.isCartao && formasQuitacao.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-vapor-200 uppercase tracking-wider">
                  Em qual meio o cliente pagou hoje?
                </label>
                <select
                  value={formaQuitacaoId}
                  onChange={(e) => setFormaQuitacaoId(e.target.value)}
                  className="w-full min-h-[44px] bg-graphite-950 border border-graphite-700 rounded-lg px-3 py-2 text-sm text-vapor-100 outline-none focus:border-amber-500"
                >
                  <option value="">Não especificar</option>
                  {formasQuitacao.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] text-vapor-400">
                  Fica registrado no histórico do recebimento (ex.: Quitado via Pix, Dinheiro ou Cartão).
                </span>
              </div>
            )}

            {/* Input do Valor Efetivamente Recebido */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-vapor-200 uppercase tracking-wider">
                {itemParaBaixar.isCartao ? 'Valor Líquido Creditado no Banco (R$)' : 'Valor Recebido no Caixa (R$)'}
              </label>
              <CampoNumerico
                prefix="R$"
                placeholder="0,00"
                value={valorPagoInput}
                onChange={(_val, str) => setValorPagoInput(str)}
                wrapperClassName="min-h-[44px] bg-graphite-950"
                className="text-lg font-bold text-mint-400"
              />
            </div>

            {/* Aviso Contextual: Cartão vs Fiado */}
            {itemParaBaixar.isCartao ? (
              <div className="p-3 bg-sky-500/10 border border-sky-500/30 rounded-xl flex items-start gap-2.5 text-xs text-sky-200">
                <CheckCircle2 size={16} className="text-sky-400 shrink-0 mt-0.5" />
                <span>
                  Confirmar o valor líquido descontado da taxa quitará o repasse da operadora no caixa{' '}
                  <strong className="text-vapor-100">sem gerar nenhuma cobrança residual ou dívida para o cliente</strong>.
                </span>
              </div>
            ) : (
              (() => {
                const valPago = parseNumeroFlexivel(valorPagoInput);
                const dif = Math.round((valPago - itemParaBaixar.valorBruto) * 100) / 100;

                if (dif > 0) {
                  return (
                    <div className="p-3 bg-mint-500/10 border border-mint-500/30 rounded-xl flex items-start gap-2.5 text-xs text-mint-300">
                      <CheckCircle2 size={16} className="text-mint-400 shrink-0 mt-0.5" />
                      <div>
                        <strong className="block font-bold">Pagamento a mais (+ {formatarMoeda(dif)})</strong>
                        <span>O valor excedente de {formatarMoeda(dif)} será abatido automaticamente da próxima parcela deste cliente.</span>
                      </div>
                    </div>
                  );
                }

                if (dif < 0 && valPago > 0) {
                  const falta = Math.abs(dif);
                  return (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-2.5 text-xs text-amber-300">
                      <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <strong className="block font-bold">Pagamento parcial (falta {formatarMoeda(falta)})</strong>
                        <span>O valor restante de {formatarMoeda(falta)} será transferido para a próxima parcela (ou gerará uma parcela residual caso seja a última).</span>
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="p-2.5 bg-graphite-950/60 rounded-xl border border-graphite-800 text-xs text-vapor-400 text-center font-mono">
                    ✓ Pagamento no valor integral exato da parcela ({formatarMoeda(itemParaBaixar.valorBruto)})
                  </div>
                );
              })()
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};
