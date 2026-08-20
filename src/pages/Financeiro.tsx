import React, { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { PageHeader } from '../components/layout/PageHeader';
import { useAuth } from '../contexts/AuthContext';
import { usePermissao } from '../hooks/usePermissao';
import { supabase } from '../lib/supabase';
import type {
  ResumoFinanceiro,
  RentabilidadeServico,
  ComissaoPagar,
  TipoFiltroPeriodo,
} from '../types/financeiro';
import { formatarMoeda, formatarTempoTrabalhado } from '../utils/formatters';
import { navegarParaAtendimento } from '../utils/navegacaoAtendimento';
import { obterDatasPeriodo } from '../utils/financeiroUtils';
import {
  TrendingUp,
  AlertTriangle,
  AlertCircle,
  Clock,
  ChevronRight,
  ShieldAlert,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  Layers,
  Award,
  Users,
  Info,
} from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';

import { NavegacaoFinanceiro } from '../components/financeiro/NavegacaoFinanceiro';

export const Financeiro: React.FC = () => {
  const navigate = useNavigate();
  const { tenant } = useAuth();
  const { isDono, isGerente } = usePermissao();

  const podeVerFinanceiro = isDono || isGerente;

  // Estado dos Filtros de Período
  const [filtroPeriodo, setFiltroPeriodo] = useState<TipoFiltroPeriodo>('este_mes');
  const [customInicio, setCustomInicio] = useState('');
  const [customFim, setCustomFim] = useState('');

  // Estados de Dados
  const [resumo, setResumo] = useState<ResumoFinanceiro | null>(null);
  const [rentabilidade, setRentabilidade] = useState<RentabilidadeServico[]>([]);
  const [comissoes, setComissoes] = useState<ComissaoPagar[]>([]);
  const [atendimentosPeriodo, setAtendimentosPeriodo] = useState<any[]>([]);

  const [loading, setLoading] = useState(true);

  const fetchDadosFinanceiros = async () => {
    if (!tenant || !podeVerFinanceiro) return;
    setLoading(true);

    try {
      const { inicio, fim } = obterDatasPeriodo(
        filtroPeriodo,
        customInicio || undefined,
        customFim || undefined
      );

      // 1. Resumo Financeiro (RPC)
      const { data: resData, error: resError } = await supabase.rpc('resumo_financeiro', {
        p_tenant: tenant.id,
        p_inicio: inicio,
        p_fim: fim,
      });
      if (resError) throw resError;
      setResumo(resData as ResumoFinanceiro);

      // 2. Rentabilidade por Serviço (RPC)
      const { data: rentData, error: rentError } = await supabase.rpc('rentabilidade_por_servico', {
        p_tenant: tenant.id,
        p_inicio: inicio,
        p_fim: fim,
      });
      if (rentError) throw rentError;
      setRentabilidade(rentData || []);

      // 3. Comissões a Pagar (RPC - Apenas para Dono)
      if (isDono) {
        const { data: comData, error: comError } = await supabase.rpc('comissoes_a_pagar', {
          p_tenant: tenant.id,
          p_inicio: inicio,
          p_fim: fim,
        });
        if (!comError) setComissoes(comData || []);
      }

      // 4. Lista de Atendimentos Finalizados no Período (RPC Unificada com a Cascata)
      const { data: atData, error: atError } = await supabase.rpc('atendimentos_periodo', {
        p_tenant: tenant.id,
        p_inicio: inicio,
        p_fim: fim,
      });
      if (!atError && atData) {
        setAtendimentosPeriodo(atData);
        if (atData.length > 0) {
          console.log('[Financeiro] Primeiro atendimento do período:', atData[0]);
        }
      }
    } catch (err) {
      console.error('Erro ao carregar dados financeiros:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDadosFinanceiros();
  }, [tenant?.id, filtroPeriodo, customInicio, customFim]);

  if (!podeVerFinanceiro) {
    return (
      <div className="flex flex-col gap-6 max-w-4xl mx-auto py-12">
        <Card className="p-8 bg-graphite-900 border-graphite-800 text-center flex flex-col items-center gap-4">
          <ShieldAlert size={48} className="text-flare-400" />
          <h2 className="font-display text-xl font-bold text-vapor-100">Acesso Restrito ao Painel Financeiro</h2>
          <p className="text-vapor-400 text-sm max-w-md">
            As informações de faturamento, rentabilidade e custos da oficina são restritas a proprietários e gerentes.
          </p>
          <Button variant="secondary" onClick={() => navigate('/hoje')} className="mt-2 text-xs">
            Voltar para o Painel Operacional
          </Button>
        </Card>
      </div>
    );
  }

  const { inicio: inicioFormat, fim: fimFormat } = obterDatasPeriodo(
    filtroPeriodo,
    customInicio || undefined,
    customFim || undefined
  );

  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageHeader title="DRE & Saúde Financeira" />
      <NavegacaoFinanceiro />

      {/* 1. SELETOR DE PERÍODO */}
      <Card className="p-4 bg-graphite-900 border-graphite-800 flex flex-col gap-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {(['hoje', 'esta_semana', 'este_mes', 'mes_passado', 'personalizado'] as TipoFiltroPeriodo[]).map((f) => {
              const labels: Record<TipoFiltroPeriodo, string> = {
                hoje: 'Hoje',
                esta_semana: 'Esta Semana',
                este_mes: 'Este Mês',
                mes_passado: 'Mês Passado',
                personalizado: 'Personalizado',
              };
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFiltroPeriodo(f)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                    filtroPeriodo === f
                      ? 'bg-amber-500 text-graphite-950 shadow'
                      : 'bg-graphite-800 text-vapor-400 hover:text-vapor-100 hover:bg-graphite-700'
                  }`}
                >
                  {labels[f]}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 text-xs font-mono text-vapor-400 bg-graphite-950 px-3 py-1.5 rounded-lg border border-graphite-800">
            <Calendar size={14} className="text-amber-500" />
            <span>Período: {inicioFormat.split('-').reverse().join('/')} a {fimFormat.split('-').reverse().join('/')}</span>
          </div>
        </div>

        {filtroPeriodo === 'este_mes' && (
          <div className="text-[11px] text-vapor-400 flex items-center gap-1.5 bg-graphite-950/60 px-3 py-1.5 rounded border border-graphite-850">
            <Info size={13} className="text-amber-400 shrink-0" />
            <span>
              'Este Mês' contempla do dia 1 ao último dia do mês ({inicioFormat.split('-').reverse().join('/')} a {fimFormat.split('-').reverse().join('/')}), pois as despesas fixas são apuradas por mês de competência.
            </span>
          </div>
        )}

        {filtroPeriodo === 'personalizado' && (
          <div className="flex items-center gap-3 pt-2 border-t border-graphite-800">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-vapor-400">Data Inicial</label>
              <input
                type="date"
                value={customInicio}
                onChange={(e) => setCustomInicio(e.target.value)}
                className="bg-graphite-800 border border-graphite-700 rounded px-2.5 py-1 text-xs text-vapor-100 outline-none focus:border-amber-500"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-vapor-400">Data Final</label>
              <input
                type="date"
                value={customFim}
                onChange={(e) => setCustomFim(e.target.value)}
                className="bg-graphite-800 border border-graphite-700 rounded px-2.5 py-1 text-xs text-vapor-100 outline-none focus:border-amber-500"
              />
            </div>
          </div>
        )}
      </Card>

      {/* ALERTA DE SEM DESPESAS FIXAS */}
      {resumo && !resumo.tem_despesas && (
        <Card className="p-4 bg-amber-500/10 border border-amber-500/30 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={24} className="text-amber-400 shrink-0 mt-0.5" />
            <div className="flex flex-col">
              <span className="font-bold text-amber-200 text-sm">Você ainda não sabe seu lucro real</span>
              <span className="text-amber-300/80 text-xs">
                Cadastre suas despesas fixas para calcular o custo/hora e descobrir quanto sua oficina lucra de verdade.
              </span>
            </div>
          </div>
          {isDono && (
            <Link to="/configuracoes">
              <Button variant="primary" className="text-xs">
                Cadastrar Despesas Fixas
              </Button>
            </Link>
          )}
        </Card>
      )}

      {loading ? (
        <Card className="p-12 text-center text-vapor-400 font-mono text-sm">Calculando saúde financeira...</Card>
      ) : resumo ? (
        <>
          {/* 2. CASCATA DE RESULTADO FINANCEIRO (DRE RESUMIDA) */}
          <Card className="p-6 bg-graphite-900 border-graphite-800 flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-vapor-100 flex items-center gap-2">
                <Layers size={20} className="text-amber-500" />
                Demonstrativo de Resultado (Cascata de Lucro)
              </h3>
              <Badge tone="vapor">Mês de Competência</Badge>
            </div>

            <div className="flex flex-col gap-3 font-sans">
              {/* Linha 1: Faturamento */}
              <div className="flex items-center justify-between p-3.5 rounded-lg bg-graphite-950 border border-graphite-800">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-vapor-100 text-sm">Faturamento Bruto</span>
                  <span className="text-xs text-vapor-400">(Preço cobrado aos clientes)</span>
                </div>
                <div className="flex items-center gap-3">
                  {resumo.comparativo.variacao_faturamento !== 0 && (
                    <span
                      className={`text-xs font-mono flex items-center gap-0.5 ${
                        resumo.comparativo.variacao_faturamento > 0 ? 'text-mint-400' : 'text-flare-400'
                      }`}
                    >
                      {resumo.comparativo.variacao_faturamento > 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                      {resumo.comparativo.variacao_faturamento > 0 ? '+' : ''}
                      {resumo.comparativo.variacao_faturamento}% vs anterior
                    </span>
                  )}
                  <span className="font-mono text-lg font-bold text-vapor-100">
                    {formatarMoeda(resumo.faturamento)}
                  </span>
                </div>
              </div>

              {/* Linha 2: Custos de Produtos */}
              <div className="flex items-center justify-between px-4 py-2 text-xs text-vapor-400 border-l-2 border-flare-500/50 pl-4">
                <span>− Consumo de Produtos (Custo Direto)</span>
                <span className="font-mono text-flare-300 font-semibold">
                  − {formatarMoeda(resumo.custo_produtos)}
                </span>
              </div>

              {/* Linha 3: Comissões */}
              <div className="flex items-center justify-between px-4 py-2 text-xs text-vapor-400 border-l-2 border-flare-500/50 pl-4">
                <span>− Comissões da Equipe</span>
                <span className="font-mono text-flare-300 font-semibold">
                  − {formatarMoeda(resumo.custo_comissao)}
                </span>
              </div>

              {/* Linha 4: Lucro Bruto */}
              <div className="flex items-center justify-between p-3.5 rounded-lg bg-graphite-800/80 border border-graphite-700 my-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-vapor-200 text-sm">Lucro Bruto</span>
                  <Badge tone={resumo.margem_bruta >= 50 ? 'mint' : 'amber'}>
                    Margem Bruta: {resumo.margem_bruta}%
                  </Badge>
                </div>
                <span className="font-mono text-md font-bold text-vapor-100">
                  {formatarMoeda(resumo.lucro_bruto)}
                </span>
              </div>

              {/* Linha 5: Rateio de Estrutura */}
              <div className="flex items-center justify-between px-4 py-2 text-xs text-vapor-400 border-l-2 border-amber-500/50 pl-4">
                <span className="flex items-center gap-1.5">
                  − Custo de Estrutura Rateado ({formatarTempoTrabalhado(resumo.minutos_trabalhados ?? resumo.horas_trabalhadas, resumo.minutos_trabalhados !== undefined)} × {formatarMoeda(resumo.custo_hora_medio)}/h)
                </span>
                <span className="font-mono text-amber-400 font-semibold">
                  − {formatarMoeda(resumo.custo_estrutura)}
                </span>
              </div>

              {/* Linha 6: LUCRO LÍQUIDO REAL (DESTAQUE MÁXIMO) */}
              <div
                className={`flex items-center justify-between p-5 rounded-xl border-2 transition-all mt-2 ${
                  resumo.lucro_liquido >= 0
                    ? 'bg-mint-500/10 border-mint-500/40 shadow-lg shadow-mint-500/5'
                    : 'bg-flare-500/10 border-flare-500/40 shadow-lg shadow-flare-500/5'
                }`}
              >
                <div className="flex flex-col gap-1">
                  <span className="font-display text-sm uppercase tracking-wider font-bold text-vapor-100 flex items-center gap-2">
                    <Award size={18} className={resumo.lucro_liquido >= 0 ? 'text-mint-400' : 'text-flare-400'} />
                    Lucro Líquido Real (O que sobra no bolso)
                  </span>
                  <span className="text-xs text-vapor-400">
                    Resultado final após pagar produtos, equipe e a estrutura da oficina.
                  </span>
                </div>

                <div className="flex flex-col items-end gap-1">
                  <div className="flex items-center gap-3">
                    <Badge tone={resumo.lucro_liquido >= 0 ? 'mint' : 'flare'}>
                      Margem Líquida: {resumo.margem_liquida}%
                    </Badge>
                    <span
                      className={`font-mono text-2xl font-black ${
                        resumo.lucro_liquido >= 0 ? 'text-mint-400' : 'text-flare-400'
                      }`}
                    >
                      {formatarMoeda(resumo.lucro_liquido)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* 3. INDICADORES SECUNDÁRIOS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-4 bg-graphite-900 border-graphite-800 flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-vapor-400 uppercase tracking-wider">
                Atendimentos Concluídos
              </span>
              <span className="font-mono text-2xl font-bold text-vapor-100">
                {resumo.atendimentos_count}
              </span>
            </Card>

            <Card className="p-4 bg-graphite-900 border-graphite-800 flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-vapor-400 uppercase tracking-wider">
                Ticket Médio
              </span>
              <span className="font-mono text-2xl font-bold text-vapor-100">
                {formatarMoeda(resumo.ticket_medio)}
              </span>
            </Card>

            <Card className="p-4 bg-graphite-900 border-graphite-800 flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-vapor-400 uppercase tracking-wider">
                Custo por Hora da Operação
              </span>
              <span className="font-mono text-2xl font-bold text-amber-400">
                {formatarMoeda(resumo.custo_hora_medio)}
              </span>
              {!!resumo.total_despesas_pendentes && resumo.total_despesas_pendentes > 0 && (
                <span className="text-[10px] text-vapor-400 flex items-center gap-1 mt-0.5">
                  <AlertCircle size={11} className="text-amber-400 shrink-0" />
                  Inclui {formatarMoeda(resumo.total_despesas_pendentes)} em contas ainda não confirmadas.
                </span>
              )}
            </Card>

            <Card className="p-4 bg-graphite-900 border-graphite-800 flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-vapor-400 uppercase tracking-wider">
                Ocupação de Horas
              </span>
              <span className="font-mono text-2xl font-bold text-vapor-100">
                {formatarTempoTrabalhado(resumo.minutos_trabalhados ?? resumo.horas_trabalhadas, resumo.minutos_trabalhados !== undefined)}{' '}
                <span className="text-xs text-vapor-400 font-sans font-normal">
                  de {resumo.horas_disponiveis}h disponíveis
                </span>
              </span>
            </Card>
          </div>

          {/* 4. RENTABILIDADE POR SERVIÇO (TABELA DE LUCRO POR HORA) */}
          <Card className="p-6 bg-graphite-900 border-graphite-800 flex flex-col gap-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="font-display text-lg font-bold text-vapor-100 flex items-center gap-2">
                <TrendingUp size={20} className="text-mint-400" />
                Rentabilidade por Serviço (Ranking por Lucro/Hora)
              </h3>
              <span className="text-xs text-vapor-400">
                Serviços com maior lucro por hora rendem mais dinheiro no mesmo tempo de box.
              </span>
            </div>

            {rentabilidade.length === 0 ? (
              <div className="p-8 text-center text-vapor-400 text-sm">
                Nenhum serviço concluído no período selecionado.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-sans">
                  <thead>
                    <tr className="border-b border-graphite-800 text-vapor-400 uppercase tracking-wider text-[11px]">
                      <th className="py-3 px-3">Serviço</th>
                      <th className="py-3 px-3 text-center">Qtd</th>
                      <th className="py-3 px-3 text-right">Faturamento</th>
                      <th className="py-3 px-3 text-right">Custo Médio</th>
                      <th className="py-3 px-3 text-right">Lucro Líq. Total</th>
                      <th className="py-3 px-3 text-center">Margem</th>
                      <th className="py-3 px-3 text-center">Tempo Médio</th>
                      <th className="py-3 px-3 text-right text-amber-400 font-bold">Lucro / Hora</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-graphite-850">
                    {rentabilidade
                      .sort((a: RentabilidadeServico, b: RentabilidadeServico) => b.lucro_por_hora - a.lucro_por_hora)
                      .map((item: RentabilidadeServico) => {
                        const isPrejuizo = item.lucro_liquido_total < 0;

                        return (
                          <tr
                            key={item.servico_id}
                            className={`hover:bg-graphite-800/40 transition-colors ${
                              isPrejuizo ? 'bg-flare-500/5' : ''
                            }`}
                          >
                            <td className="py-3 px-3">
                              <div className="flex flex-col">
                                <span className="font-bold text-vapor-100 text-sm">{item.servico_nome}</span>
                                {item.servico_codigo && (
                                  <span className="text-[10px] font-mono text-vapor-400">{item.servico_codigo}</span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-3 text-center font-mono text-vapor-200">{item.quantidade}</td>
                            <td className="py-3 px-3 text-right font-mono text-vapor-100">{formatarMoeda(item.faturamento_total)}</td>
                            <td className="py-3 px-3 text-right font-mono text-vapor-400">{formatarMoeda(item.custo_medio)}</td>
                            <td
                              className={`py-3 px-3 text-right font-mono font-bold ${
                                isPrejuizo ? 'text-flare-400' : 'text-vapor-100'
                              }`}
                            >
                              {formatarMoeda(item.lucro_liquido_total)}
                            </td>
                            <td className="py-3 px-3 text-center">
                              <Badge tone={isPrejuizo ? 'flare' : item.margem_percentual >= 50 ? 'mint' : 'amber'}>
                                {item.margem_percentual}%
                              </Badge>
                            </td>
                            <td className="py-3 px-3 text-center font-mono text-vapor-300">
                              {item.tempo_medio_minutos} min
                            </td>
                            <td className="py-3 px-3 text-right font-mono font-bold text-sm text-amber-400">
                              {formatarMoeda(item.lucro_por_hora)}/h
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* 5. COMISSÕES A PAGAR (EXCLUSIVO PARA DONO) */}
          {isDono && (
            <Card className="p-6 bg-graphite-900 border-graphite-800 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-bold text-vapor-100 flex items-center gap-2">
                  <Users size={20} className="text-amber-500" />
                  Comissões da Equipe a Pagamento
                </h3>
                <Badge tone="vapor">Período Selecionado</Badge>
              </div>

              {comissoes.length === 0 ? (
                <div className="p-6 text-center text-vapor-400 text-xs">
                  Nenhuma comissão apurada para os atendimentos do período.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {comissoes.map((c: ComissaoPagar) => (
                    <div key={c.member_id} className="p-4 rounded-lg bg-graphite-950 border border-graphite-800 flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="font-bold text-vapor-100 text-sm">{c.nome}</span>
                        <span className="text-xs text-vapor-400">{c.servicos} serviço(s) realizado(s)</span>
                      </div>
                      <span className="font-mono text-lg font-bold text-amber-400">{formatarMoeda(c.total)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* 6. ATENDIMENTOS FINALIZADOS DO PERÍODO */}
          <Card className="p-6 bg-graphite-900 border-graphite-800 flex flex-col gap-4">
            <h3 className="font-display text-lg font-bold text-vapor-100 flex items-center gap-2">
              <Clock size={20} className="text-vapor-300" />
              Atendimentos do Período ({atendimentosPeriodo.length})
            </h3>

            {/* AVISO DE CONSISTÊNCIA: Faturamento > 0 mas lista de atendimentos vazia */}
            {resumo.faturamento > 0 && atendimentosPeriodo.length === 0 && (
              <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/40 text-amber-300 text-xs flex items-center gap-2">
                <AlertTriangle size={18} className="text-amber-400 shrink-0" />
                <span>
                  Há faturamento no período ({formatarMoeda(resumo.faturamento)}), mas nenhum atendimento listado. Verifique os filtros.
                </span>
              </div>
            )}

            {atendimentosPeriodo.length === 0 ? (
              <div className="p-6 text-center text-vapor-400 text-xs">Sem atendimentos finalizados neste período.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-sans">
                  <thead>
                    <tr className="border-b border-graphite-800 text-vapor-400 uppercase tracking-wider text-[11px]">
                      <th className="py-3 px-3">OS</th>
                      <th className="py-3 px-3">Data</th>
                      <th className="py-3 px-3">Cliente</th>
                      <th className="py-3 px-3">Veículo/Placa</th>
                      <th className="py-3 px-3">Serviços</th>
                      <th className="py-3 px-3 text-right">Valor Final</th>
                      <th className="py-3 px-3 text-center">Tempo</th>
                      <th className="py-3 px-3 text-right">Estrutura</th>
                      <th className="py-3 px-3 text-right">Lucro Líquido</th>
                      <th className="py-3 px-3 text-center">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-graphite-850">
                    {atendimentosPeriodo.map((exec: any) => {
                      const osNum = exec.numero_os;
                      const osStr = osNum ? `#${String(osNum).padStart(4, '0')}` : '—';
                      const lucro = Number(exec.lucro_liquido || 0);
                      const dataStr = exec.data ? new Date(exec.data).toLocaleDateString('pt-BR') : '—';

                      return (
                        <tr
                          key={exec.execucao_id || exec.agendamento_id}
                          onClick={() => navegarParaAtendimento(navigate, exec.execucao_id, exec.agendamento_id)}
                          className="hover:bg-graphite-800/40 transition-colors cursor-pointer"
                        >
                          <td className="py-3 px-3 font-mono font-bold text-amber-500">{osStr}</td>
                          <td className="py-3 px-3 font-mono text-vapor-400">{dataStr}</td>
                          <td className="py-3 px-3 font-bold text-vapor-100">{exec.cliente || '—'}</td>
                          <td className="py-3 px-3 font-mono text-vapor-300">{exec.placa || '—'}</td>
                          <td className="py-3 px-3 text-vapor-200">{exec.servicos || '—'}</td>
                          <td className="py-3 px-3 text-right font-mono text-vapor-100">{formatarMoeda(exec.valor)}</td>
                          <td className="py-3 px-3 text-center font-mono text-vapor-300">{formatarTempoTrabalhado(exec.tempo_minutos, true)}</td>
                          <td className="py-3 px-3 text-right font-mono text-amber-400">{formatarMoeda(exec.custo_estrutura)}</td>
                          <td className={`py-3 px-3 text-right font-mono font-bold ${lucro >= 0 ? 'text-mint-400' : 'text-flare-400'}`}>
                            {formatarMoeda(lucro)}
                          </td>
                          <td className="py-3 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => navegarParaAtendimento(navigate, exec.execucao_id, exec.agendamento_id)}
                              className="px-2.5 py-1 rounded bg-graphite-800 hover:bg-graphite-700 text-vapor-200 text-[11px] font-semibold transition-colors inline-flex items-center gap-1"
                            >
                              Ver Ficha
                              <ChevronRight size={13} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
};
