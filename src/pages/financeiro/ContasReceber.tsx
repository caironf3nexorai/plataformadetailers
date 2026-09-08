import React, { useState, useEffect } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { PageHeader } from '../../components/layout/PageHeader';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissao } from '../../hooks/usePermissao';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { formatarMoeda, parseNumeroFlexivel } from '../../utils/formatters';
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
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface ItemContaReceber {
  id: string;
  cliente_id: string;
  cliente_nome: string;
  cliente_telefone: string | null;
  forma_nome: string | null;
  forma_tipo: string | null;
  numero_parcela: number;
  total_parcelas: number;
  valor_bruto: number;
  valor_liquido: number;
  previsto_para: string;
  dias_atraso: number;
  status: 'previsto' | 'recebido' | 'cancelado';
  observacao: string | null;
}

import { NavegacaoFinanceiro } from '../../components/financeiro/NavegacaoFinanceiro';

export const ContasReceber: React.FC = () => {
  const navigate = useNavigate();
  const { tenant } = useAuth();
  const { isDono, isGerente } = usePermissao();
  const { showToast } = useToast();

  const podeAcessar = isDono || isGerente;

  const [loading, setLoading] = useState(true);
  const [aReceberMes, setAReceberMes] = useState(0);
  const [vencidoTotal, setVencidoTotal] = useState(0);
  const [recebidoMes, setRecebidoMes] = useState(0);
  const [faturamentoTaxaEstimadaMes, setFaturamentoTaxaEstimadaMes] = useState(0);
  const [itens, setItens] = useState<ItemContaReceber[]>([]);

  // Filtros
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'vencidos' | 'a_vencer'>('todos');
  const [baixandoId, setBaixandoId] = useState<string | null>(null);
  const [itemParaBaixar, setItemParaBaixar] = useState<{
    id: string;
    clienteNome: string;
    valor: number;
    parcelaInfo: string;
    vencimento: string;
  } | null>(null);
  const [valorPagoInput, setValorPagoInput] = useState<string>('');

  const fetchContasReceber = async () => {
    if (!tenant || !podeAcessar) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('obter_contas_a_receber', {
        p_inicio: null,
        p_fim: null,
      });

      if (error) throw error;

      if (data) {
        setAReceberMes(Number(data.a_receber_mes || 0));
        setVencidoTotal(Number(data.vencido_total || 0));
        setRecebidoMes(Number(data.recebido_mes || 0));
        setFaturamentoTaxaEstimadaMes(Number(data.faturamento_taxa_estimada_mes || 0));
        setItens(data.itens || []);
      }
    } catch (err: any) {
      console.error('Erro ao carregar contas a receber:', err);
      showToast(err.message || 'Erro ao carregar dados de contas a receber', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContasReceber();
  }, [tenant?.id]);

  const handleSolicitarBaixa = (item: ItemContaReceber) => {
    setItemParaBaixar({
      id: item.id,
      clienteNome: item.cliente_nome,
      valor: item.valor_bruto,
      parcelaInfo: item.total_parcelas > 1 ? `Parcela ${item.numero_parcela}/${item.total_parcelas}` : 'À vista (1/1)',
      vencimento: new Date(item.previsto_para + 'T00:00:00').toLocaleDateString('pt-BR'),
    });
    setValorPagoInput(item.valor_bruto.toFixed(2).replace('.', ','));
  };

  const handleConfirmarBaixa = async () => {
    if (!itemParaBaixar) return;
    const { id } = itemParaBaixar;
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
      });

      if (error) throw error;

      showToast(data?.mensagem || 'Baixa efetuada com sucesso!', 'success');
      setItemParaBaixar(null);
      await fetchContasReceber();
    } catch (err: any) {
      console.error('Erro ao dar baixa:', err);
      showToast(err.message || 'Erro ao registrar baixa', 'error');
    } finally {
      setBaixandoId(null);
    }
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

  // Filtragem local
  const itensFiltrados = itens.filter((item) => {
    const termo = busca.toLowerCase().trim();
    const bateBusca =
      !termo ||
      item.cliente_nome.toLowerCase().includes(termo) ||
      (item.cliente_telefone && item.cliente_telefone.includes(termo)) ||
      (item.forma_nome && item.forma_nome.toLowerCase().includes(termo)) ||
      (item.observacao && item.observacao.toLowerCase().includes(termo));

    if (!bateBusca) return false;

    if (filtroStatus === 'vencidos') return item.dias_atraso > 0;
    if (filtroStatus === 'a_vencer') return item.dias_atraso === 0;

    return true;
  });

  const qtdVencidos = itens.filter((i) => i.dias_atraso > 0).length;

  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageHeader
        title="Contas a Receber"
      />
      <NavegacaoFinanceiro />

      {faturamentoTaxaEstimadaMes > 0 && (
        <Card className="p-4 bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-4">
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

      {/* CARDS DE DESTAQUE NO TOPO (IBM Plex Mono) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* A Receber no Mês */}
        <Card className="p-5 bg-graphite-900 border-graphite-800 flex flex-col gap-2 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-vapor-400 uppercase tracking-wider">A Receber este Mês</span>
            <Clock size={20} className="text-amber-400" />
          </div>
          <span className="font-mono text-3xl font-bold text-vapor-100">{formatarMoeda(aReceberMes)}</span>
          <span className="text-[11px] text-vapor-400">Parcelas e títulos com vencimento no mês corrente</span>
        </Card>

        {/* Total Vencido */}
        <Card className={`p-5 bg-graphite-900 border flex flex-col gap-2 relative overflow-hidden ${
          vencidoTotal > 0 ? 'border-amber-500/50 bg-amber-500/5' : 'border-graphite-800'
        }`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-300 uppercase tracking-wider">Em Atraso (Vencido)</span>
            <AlertTriangle size={20} className="text-amber-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-3xl font-bold text-amber-400">{formatarMoeda(vencidoTotal)}</span>
            {qtdVencidos > 0 && (
              <span className="font-mono text-xs">
                <Badge tone="amber">
                  {qtdVencidos} {qtdVencidos === 1 ? 'título' : 'títulos'}
                </Badge>
              </span>
            )}
          </div>
          <span className="text-[11px] text-amber-300/80">Cobranças com vencimento anterior a hoje</span>
        </Card>

        {/* Recebido no Mês */}
        <Card className="p-5 bg-graphite-900 border-graphite-800 flex flex-col gap-2 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-vapor-400 uppercase tracking-wider">Recebido este Mês</span>
            <CheckCircle2 size={20} className="text-mint-400" />
          </div>
          <span className="font-mono text-3xl font-bold text-mint-400">{formatarMoeda(recebidoMes)}</span>
          <span className="text-[11px] text-vapor-400">Total já quitado e confirmado no caixa este mês</span>
        </Card>
      </div>

      {/* BARRA DE FILTROS E PESQUISA */}
      <Card className="p-4 bg-graphite-900 border-graphite-800 flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Filtros por status */}
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
            Todos ({itens.length})
          </button>
          <button
            type="button"
            onClick={() => setFiltroStatus('vencidos')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              filtroStatus === 'vencidos'
                ? 'bg-amber-500 text-graphite-950 shadow'
                : 'bg-graphite-800 text-amber-400 hover:bg-graphite-750'
            }`}
          >
            <AlertTriangle size={13} />
            Vencidos ({qtdVencidos})
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
            A Vencer ({itens.length - qtdVencidos})
          </button>
        </div>

        {/* Input de Busca */}
        <div className="relative w-full sm:w-72">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-vapor-400" />
          <input
            type="text"
            placeholder="Buscar por cliente, telefone ou forma..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full bg-graphite-950 border border-graphite-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-vapor-100 placeholder:text-vapor-500 outline-none focus:border-amber-500 transition-colors"
          />
        </div>
      </Card>

      {/* LISTA DE RECEBIMENTOS */}
      <Card className="p-6 bg-graphite-900 border-graphite-800 flex flex-col gap-4">
        {loading ? (
          <div className="py-12 text-center text-vapor-400 font-mono text-sm">Carregando títulos a receber...</div>
        ) : itensFiltrados.length === 0 ? (
          <div className="py-12 text-center flex flex-col items-center gap-2">
            <CheckCircle2 size={36} className="text-mint-400/60" />
            <span className="font-bold text-vapor-200 text-sm">Nenhuma conta a receber pendente</span>
            <span className="text-vapor-400 text-xs">
              {busca || filtroStatus !== 'todos'
                ? 'Nenhum resultado encontrado para os filtros selecionados.'
                : 'Todos os pagamentos e cobranças estão em dia!'}
            </span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-sans">
              <thead>
                <tr className="border-b border-graphite-800 text-vapor-400 uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-3">Cliente</th>
                  <th className="py-3 px-3">Forma de Pagamento</th>
                  <th className="py-3 px-3 text-center">Parcela</th>
                  <th className="py-3 px-3 text-right">Valor Bruto</th>
                  <th className="py-3 px-3 text-right">Valor Líquido</th>
                  <th className="py-3 px-3 text-center">Vencimento</th>
                  <th className="py-3 px-3 text-center">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-graphite-850">
                {itensFiltrados.map((item) => {
                  const isVencido = item.dias_atraso > 0;
                  const dataVenc = new Date(item.previsto_para + 'T00:00:00').toLocaleDateString('pt-BR');

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-graphite-800/40 transition-colors ${
                        isVencido ? 'bg-amber-500/5' : ''
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
                            {item.cliente_nome}
                          </button>
                          {item.cliente_telefone && (
                            <span className="text-[11px] font-mono text-vapor-400 flex items-center gap-1">
                              <Phone size={11} className="shrink-0" />
                              {item.cliente_telefone}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Forma de Pagamento */}
                      <td className="py-3.5 px-3">
                        <div className="flex flex-col">
                          <span className="font-semibold text-vapor-200 flex items-center gap-1.5">
                            <CreditCard size={13} className="text-amber-500 shrink-0" />
                            {item.forma_nome || 'A definir'}
                          </span>
                          {item.observacao && (
                            <span className="text-[10px] text-vapor-400 italic max-w-xs truncate">{item.observacao}</span>
                          )}
                        </div>
                      </td>

                      {/* Parcela */}
                      <td className="py-3.5 px-3 text-center font-mono text-vapor-300">
                        {item.total_parcelas > 1 ? `${item.numero_parcela}/${item.total_parcelas}` : 'À vista (1/1)'}
                      </td>

                      {/* Valor Bruto */}
                      <td className="py-3.5 px-3 text-right font-mono text-sm font-bold text-vapor-100">
                        {formatarMoeda(item.valor_bruto)}
                      </td>

                      {/* Valor Líquido */}
                      <td className="py-3.5 px-3 text-right font-mono text-xs text-mint-400 font-semibold">
                        {formatarMoeda(item.valor_liquido)}
                      </td>

                      {/* Vencimento & Badge */}
                      <td className="py-3.5 px-3 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className="font-mono text-xs text-vapor-200">{dataVenc}</span>
                          {isVencido ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 inline-flex items-center gap-1">
                              <AlertTriangle size={10} />
                              Vencido há {item.dias_atraso}d
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-graphite-800 text-vapor-400 border border-graphite-700">
                              A vencer
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Ação Dar Baixa */}
                      <td className="py-3.5 px-3 text-center">
                        <Button
                          variant="primary"
                          onClick={() => handleSolicitarBaixa(item)}
                          disabled={baixandoId === item.id}
                          className="text-xs px-3 py-1 bg-mint-500 hover:bg-mint-400 text-graphite-950 font-bold border-none"
                        >
                          {baixandoId === item.id ? 'Baixando...' : 'Dar Baixa'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Modal Inteligente de Baixa com Ajuste de Valor */}
      {itemParaBaixar && (
        <Modal
          isOpen={Boolean(itemParaBaixar)}
          onClose={() => setItemParaBaixar(null)}
          title="Confirmar Recebimento"
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
                {baixandoId ? 'Registrando...' : 'Confirmar Recebimento'}
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-4 py-1">
            {/* Detalhes do Cliente e Parcela */}
            <div className="p-3.5 bg-graphite-950 rounded-xl border border-graphite-800 flex flex-col gap-1 text-xs">
              <div className="flex justify-between items-center text-vapor-300 font-medium">
                <span>Cliente:</span>
                <span className="font-bold text-vapor-100 text-sm">{itemParaBaixar.clienteNome}</span>
              </div>
              <div className="flex justify-between items-center text-vapor-400">
                <span>Cobrança:</span>
                <span className="font-mono text-vapor-200">{itemParaBaixar.parcelaInfo} • Vencimento {itemParaBaixar.vencimento}</span>
              </div>
              <div className="flex justify-between items-center text-vapor-400 pt-1 border-t border-graphite-850">
                <span>Valor Previsto da Parcela:</span>
                <span className="font-mono font-bold text-vapor-100">{formatarMoeda(itemParaBaixar.valor)}</span>
              </div>
            </div>

            {/* Input do Valor Efetivamente Pago */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-vapor-200 uppercase tracking-wider">
                Valor Recebido no Caixa (R$)
              </label>
              <CampoNumerico
                prefix="R$"
                placeholder="0,00"
                value={valorPagoInput}
                onChange={(_val, str) => setValorPagoInput(str)}
                wrapperClassName="min-h-[44px] bg-graphite-950"
                className="text-lg font-bold text-mint-400"
              />
              <span className="text-[11px] text-vapor-400">
                Informe o valor real pago pelo cliente. Se for diferente do valor previsto, o sistema ajustará a próxima parcela automaticamente.
              </span>
            </div>

            {/* Cálculo da Diferença ao Vivo */}
            {(() => {
              const valPago = parseNumeroFlexivel(valorPagoInput);
              const dif = Math.round((valPago - itemParaBaixar.valor) * 100) / 100;

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
                      <span>O valor restante de {formatarMoeda(falta)} será somado e transferido para a próxima parcela deste cliente.</span>
                    </div>
                  </div>
                );
              }

              return (
                <div className="p-2.5 bg-graphite-950/60 rounded-xl border border-graphite-800 text-xs text-vapor-400 text-center font-mono">
                  ✓ Pagamento no valor integral exato da parcela ({formatarMoeda(itemParaBaixar.valor)})
                </div>
              );
            })()}
          </div>
        </Modal>
      )}
    </div>
  );
};
