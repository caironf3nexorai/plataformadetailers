import React, { useEffect, useState } from 'react';
import { Shield, DollarSign, Users, Clock, AlertTriangle, Search, Filter, Edit2, CheckCircle, RefreshCw, X, Gift, Play } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import {
  CORTESIA_DURACAO_OPCOES,
  calcularDataFimCortesiaISO,
  formatarDataSegura,
  obterResumoStatusAssinatura,
} from '../../utils/assinatura';

interface MetricasAssinaturas {
  mrr_centavos: number;
  mrr_reais: number;
  total_ativas: number;
  total_trial: number;
  total_cortesias?: number;
  total_atrasadas: number;
  total_canceladas: number;
}

interface ItemAssinatura {
  id: string;
  tenant_id: string;
  tenant_nome: string;
  dono_email: string;
  plano: string;
  status: string;
  forma_pagamento: string;
  valor_centavos: number;
  trial_fim: string | null;
  proximo_vencimento: string | null;
  atraso_desde: string | null;
  asaas_customer_id: string | null;
  asaas_subscription_id: string | null;
  created_at: string;
  is_cortesia?: boolean;
  cortesia_ate?: string | null;
}

export const AdminAssinaturas: React.FC = () => {
  const { showSuccess, showError } = useToast();

  const [metricas, setMetricas] = useState<MetricasAssinaturas | null>(null);
  const [assinaturas, setAssinaturas] = useState<ItemAssinatura[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFiltro, setStatusFiltro] = useState<string>('');
  const [busca, setBusca] = useState<string>('');

  // Estado para Modal de Alteração Manual de Plano
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedAssinatura, setSelectedAssinatura] = useState<ItemAssinatura | null>(null);
  const [novoPlano, setNovoPlano] = useState<'free' | 'pro' | 'studio'>('pro');
  const [isCortesiaAdmin, setIsCortesiaAdmin] = useState(true);
  const [duracaoCortesiaOpcao, setDuracaoCortesiaOpcao] = useState<string>('30d');
  const [diasCustomCortesia, setDiasCustomCortesia] = useState<string>('30');
  const [motivoAudit, setMotivoAudit] = useState('');
  const [salvandoAlteracao, setSalvandoAlteracao] = useState(false);
  const [executandoRotina, setExecutandoRotina] = useState(false);
  const [planosCadastrados, setPlanosCadastrados] = useState<{ codigo: string; nome: string; preco_centavos: number }[]>([]);

  const carregarDados = async () => {
    setLoading(true);
    try {
      // 0. Carregar planos ativos do banco de dados em tempo real
      const { data: pData } = await supabase
        .from('plans')
        .select('codigo, nome, preco_centavos')
        .eq('ativo', true)
        .order('preco_centavos', { ascending: true });
      if (pData && pData.length > 0) {
        setPlanosCadastrados(pData);
      }

      // 1. Obter métricas gerais (MRR conta APENAS assinaturas ativas)
      const { data: dataMetricas, error: errMetricas } = await supabase.rpc('admin_obter_metricas_assinaturas');
      if (errMetricas) throw errMetricas;
      setMetricas(dataMetricas);

      // 2. Listar assinaturas
      const { data: dataLista, error: errLista } = await supabase.rpc('admin_listar_assinaturas', {
        p_status: statusFiltro || null,
        p_busca: busca || null,
      });
      if (errLista) throw errLista;
      setAssinaturas(dataLista || []);
    } catch (err: any) {
      console.error('Erro ao carregar painel admin de assinaturas:', err);
      showError(err.message || 'Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarDados();
  }, [statusFiltro, busca]);

  const resolverDiasCortesia = (): number | null => {
    if (novoPlano === 'free') return null;
    if (duracaoCortesiaOpcao === 'vitalicia') return null;
    if (duracaoCortesiaOpcao === 'custom') {
      const n = parseInt(diasCustomCortesia, 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    const found = CORTESIA_DURACAO_OPCOES.find((o) => o.id === duracaoCortesiaOpcao);
    return found ? found.dias : 30;
  };

  const handleExecutarRotinaAgora = async () => {
    setExecutandoRotina(true);
    try {
      const { data, error } = await supabase.rpc('admin_executar_rotina_assinaturas');
      if (error) throw error;

      const total =
        (data?.trial_rebaixados || 0) +
        (data?.cortesia_rebaixados || 0) +
        (data?.atraso_rebaixados || 0) +
        (data?.cancelado_rebaixados || 0);

      showSuccess(
        total > 0
          ? `Rotina executada: ${total} oficina(s) expirada(s) rebaixada(s) para Free (Trials: ${data?.trial_rebaixados || 0}, Cortesias: ${data?.cortesia_rebaixados || 0}, Atrasos: ${data?.atraso_rebaixados || 0}, Canceladas: ${data?.cancelado_rebaixados || 0}).`
          : 'Verificação concluída: nenhuma oficina com trial, cortesia ou atraso expirado no momento.'
      );
      carregarDados();
    } catch (err: any) {
      showError(err.message || 'Erro ao executar rotina de verificação');
    } finally {
      setExecutandoRotina(false);
    }
  };

  const handleSalvarAlteracaoManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAssinatura) return;

    if (!motivoAudit.trim()) {
      showError('Por favor, informe a justificativa da alteração manual para auditoria.');
      return;
    }

    const diasFinal = resolverDiasCortesia();
    if (novoPlano !== 'free' && duracaoCortesiaOpcao === 'custom' && (!diasFinal || diasFinal <= 0)) {
      showError('Informe uma quantidade de dias válida (maior que zero).');
      return;
    }

    setSalvandoAlteracao(true);
    try {
      const { error } = await supabase.rpc('admin_alterar_plano_manual', {
        p_tenant_id: selectedAssinatura.tenant_id,
        p_novo_plano: novoPlano,
        p_motivo: motivoAudit.trim(),
        p_dias_cortesia: novoPlano === 'free' ? null : diasFinal,
        p_cortesia_ate: null,
        p_is_cortesia: novoPlano === 'free' ? false : isCortesiaAdmin,
      });

      if (error) throw error;

      const resumoPrazo =
        novoPlano === 'free'
          ? 'rebaixado para Free'
          : isCortesiaAdmin
            ? diasFinal
              ? `como cortesia de ${diasFinal} dia(s)`
              : 'como cortesia vitalícia'
            : 'como assinatura comercial ativa';

      showSuccess(`Plano da oficina "${selectedAssinatura.tenant_nome}" alterado para ${novoPlano.toUpperCase()} (${resumoPrazo}) com sucesso!`);
      setModalOpen(false);
      carregarDados();
    } catch (err: any) {
      showError(err.message || 'Erro ao alterar plano manualmente');
    } finally {
      setSalvandoAlteracao(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header Admin */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-graphite-700 pb-4">
        <div>
          <h1 className="text-xl font-bold font-display text-vapor-100 uppercase tracking-wider flex items-center gap-2">
            <Shield className="text-amber-500" size={22} />
            Gestão Global de Assinaturas & MRR
          </h1>
          <p className="text-xs text-vapor-400">
            Monitoramento de receita recorrente mensal, degustações e alterações manuais auditadas.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleExecutarRotinaAgora}
            disabled={executandoRotina}
            className="px-3.5 py-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
            title="Verifica imediatamente trials, cortesias e atrasos vencidos e rebaixa para Free"
          >
            <Play size={13} className={executandoRotina ? 'animate-pulse' : ''} />
            {executandoRotina ? 'Verificando...' : 'Verificar Expirados Agora'}
          </button>

          <button
            onClick={carregarDados}
            className="px-3.5 py-2 rounded-lg bg-graphite-800 hover:bg-graphite-700 text-vapor-200 border border-graphite-600 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Atualizar Métricas
          </button>
        </div>
      </div>

      {/* Cards de Métricas MRR (Somente ativas não-cortesia contam no MRR) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
        {/* Card MRR */}
        <div className="p-5 rounded-xl bg-graphite-800 border border-emerald-500/30 flex flex-col justify-between shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-wider">MRR (Recorrente)</span>
            <DollarSign className="text-emerald-400" size={20} />
          </div>
          <div className="mt-3">
            <span className="text-2xl font-extrabold font-mono text-vapor-100">
              R$ {(metricas?.mrr_reais || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] text-vapor-400 block mt-0.5">
              Exclui cortesias, trials e free
            </span>
          </div>
        </div>

        {/* Total Ativas */}
        <div className="p-5 rounded-xl bg-graphite-800 border border-graphite-700 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold text-vapor-300 uppercase tracking-wider">Ativas</span>
            <CheckCircle className="text-emerald-400" size={20} />
          </div>
          <div className="mt-3">
            <span className="text-2xl font-extrabold font-mono text-vapor-100">
              {metricas?.total_ativas || 0}
            </span>
            <span className="text-[10px] text-vapor-400 block mt-0.5">Oficinas pagantes</span>
          </div>
        </div>

        {/* Cortesias */}
        <div className="p-5 rounded-xl bg-graphite-800 border border-cyan-500/30 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold text-cyan-300 uppercase tracking-wider">Cortesias</span>
            <Gift className="text-cyan-400" size={20} />
          </div>
          <div className="mt-3">
            <span className="text-2xl font-extrabold font-mono text-vapor-100">
              {metricas?.total_cortesias || 0}
            </span>
            <span className="text-[10px] text-vapor-400 block mt-0.5">Sem cobrança / fora MRR</span>
          </div>
        </div>

        {/* Em Trial */}
        <div className="p-5 rounded-xl bg-graphite-800 border border-graphite-700 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold text-amber-400 uppercase tracking-wider">Trials</span>
            <Clock className="text-amber-400" size={20} />
          </div>
          <div className="mt-3">
            <span className="text-2xl font-extrabold font-mono text-vapor-100">
              {metricas?.total_trial || 0}
            </span>
            <span className="text-[10px] text-vapor-400 block mt-0.5">Em degustação</span>
          </div>
        </div>

        {/* Atrasadas */}
        <div className="p-5 rounded-xl bg-graphite-800 border border-graphite-700 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold text-rose-400 uppercase tracking-wider">Atrasadas</span>
            <AlertTriangle className="text-rose-400" size={20} />
          </div>
          <div className="mt-3">
            <span className="text-2xl font-extrabold font-mono text-vapor-100">
              {metricas?.total_atrasadas || 0}
            </span>
            <span className="text-[10px] text-vapor-400 block mt-0.5">Tolerância ≤ 5 dias</span>
          </div>
        </div>

        {/* Canceladas */}
        <div className="p-5 rounded-xl bg-graphite-800 border border-graphite-700 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold text-vapor-400 uppercase tracking-wider">Canceladas</span>
            <Users className="text-vapor-400" size={20} />
          </div>
          <div className="mt-3">
            <span className="text-2xl font-extrabold font-mono text-vapor-100">
              {metricas?.total_canceladas || 0}
            </span>
            <span className="text-[10px] text-vapor-400 block mt-0.5">Sem cobrança ativa</span>
          </div>
        </div>
      </div>

      {/* Filtros e Busca */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-graphite-800/60 p-4 rounded-xl border border-graphite-700">
        <div className="relative w-full sm:w-80">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-vapor-400" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por oficina, email ou ID Asaas..."
            className="w-full pl-9 pr-3 py-2 bg-graphite-950 border border-graphite-700 rounded-lg text-xs text-vapor-100 focus:border-amber-500 outline-none"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter size={16} className="text-vapor-400 shrink-0" />
          <select
            value={statusFiltro}
            onChange={(e) => setStatusFiltro(e.target.value)}
            className="w-full sm:w-48 py-2 px-3 bg-graphite-950 border border-graphite-700 rounded-lg text-xs text-vapor-100 focus:border-amber-500 outline-none cursor-pointer"
          >
            <option value="">Todos os Status</option>
            <option value="ativa">Ativas</option>
            <option value="cortesia">Cortesias Admin</option>
            <option value="trial">Trial</option>
            <option value="atrasada">Atrasadas</option>
            <option value="cancelada">Canceladas</option>
          </select>
        </div>
      </div>

      {/* Tabela de Assinaturas */}
      <div className="bg-graphite-800 rounded-xl border border-graphite-700 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-vapor-200">
            <thead className="bg-graphite-950/80 text-vapor-400 font-mono uppercase tracking-wider text-[11px] border-b border-graphite-700">
              <tr>
                <th className="py-3.5 px-4">Oficina / Dono</th>
                <th className="py-3.5 px-4">Plano</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4">Valor</th>
                <th className="py-3.5 px-4">Pagamento</th>
                <th className="py-3.5 px-4">Vencimento / Trial</th>
                <th className="py-3.5 px-4 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-graphite-700/60 font-sans">
              {assinaturas.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-vapor-400 font-mono">
                    Nenhuma assinatura encontrada.
                  </td>
                </tr>
              ) : (
                assinaturas.map((ass) => {
                  const resumo = obterResumoStatusAssinatura(ass.status, {
                    isCortesia: ass.is_cortesia,
                    plano: ass.plano,
                  });
                  return (
                    <tr key={ass.id} className="hover:bg-graphite-700/30 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-vapor-100">{ass.tenant_nome}</span>
                          <span className="text-[11px] text-vapor-400">{ass.dono_email || 'Sem email'}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold uppercase text-amber-400">
                        {ass.plano}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                            resumo.isCortesia
                              ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'
                              : resumo.statusEfetivo === 'ativa'
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                : resumo.statusEfetivo === 'trial'
                                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                  : resumo.statusEfetivo === 'atrasada'
                                    ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                                    : 'bg-graphite-700 text-vapor-400 border-graphite-600'
                          }`}
                        >
                          {resumo.isCortesia ? 'cortesia' : ass.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-vapor-100">
                        {resumo.isCortesia ? (
                          <span className="text-cyan-300">R$ 0,00 (Cortesia)</span>
                        ) : (
                          `R$ ${(ass.valor_centavos / 100).toFixed(2)}`
                        )}
                      </td>
                      <td className="py-3.5 px-4 capitalize text-vapor-300">
                        {resumo.isCortesia ? 'Cortesia Admin' : ass.forma_pagamento || '—'}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px] text-vapor-400">
                        {resumo.isCortesia
                          ? ass.cortesia_ate
                            ? `Cortesia até ${formatarDataSegura(ass.cortesia_ate)}`
                            : 'Cortesia vitalícia'
                          : ass.status === 'trial' && ass.trial_fim
                            ? `Trial até ${formatarDataSegura(ass.trial_fim)}`
                            : ass.proximo_vencimento
                              ? formatarDataSegura(ass.proximo_vencimento)
                              : '—'}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          onClick={() => {
                            setSelectedAssinatura(ass);
                            setNovoPlano((ass.plano as any) || 'pro');
                            setIsCortesiaAdmin(true);
                            setDuracaoCortesiaOpcao('30d');
                            setDiasCustomCortesia('30');
                            setMotivoAudit('');
                            setModalOpen(true);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 font-semibold text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Edit2 size={13} />
                          Alterar Plano
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de Alteração Manual pelo Admin */}
      {modalOpen && selectedAssinatura && (
        <div className="fixed inset-0 z-50 bg-graphite-950/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-graphite-900 border border-graphite-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl p-6 flex flex-col gap-5 my-auto">
            <div className="flex items-center justify-between border-b border-graphite-800 pb-3">
              <h3 className="font-bold text-vapor-100 font-display uppercase tracking-wider text-sm flex items-center gap-2">
                <Shield className="text-amber-500" size={18} />
                Alteração Manual de Plano
              </h3>
              <button onClick={() => setModalOpen(false)} className="text-vapor-400 hover:text-vapor-100 cursor-pointer">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSalvarAlteracaoManual} className="flex flex-col gap-4">
              <div className="p-3 bg-graphite-950 rounded-lg border border-graphite-800 text-xs text-vapor-300">
                Oficina: <strong className="text-vapor-100">{selectedAssinatura.tenant_nome}</strong>
              </div>

              {selectedAssinatura.asaas_subscription_id && (
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200 leading-relaxed">
                  <strong>Atenção:</strong> Esta oficina possui assinatura Asaas (<span className="font-mono">{selectedAssinatura.asaas_subscription_id}</span>). Alterar manualmente pelo Admin não cancela cobranças recorrentes ativas no Asaas.
                </div>
              )}

              <div className="flex flex-col gap-1">
                <label className="text-xs font-mono font-bold text-vapor-300 uppercase">Novo Plano</label>
                <select
                  value={novoPlano}
                  onChange={(e) => setNovoPlano(e.target.value as any)}
                  className="p-2.5 bg-graphite-950 border border-graphite-700 rounded-lg text-xs text-vapor-100 focus:border-amber-500 outline-none cursor-pointer"
                >
                  {planosCadastrados.length > 0 ? (
                    planosCadastrados.map((p) => (
                      <option key={p.codigo} value={p.codigo}>
                        {p.nome.toUpperCase()} (R$ {(p.preco_centavos / 100).toFixed(2).replace('.', ',')}/mês)
                      </option>
                    ))
                  ) : (
                    <>
                      <option value="free">FREE</option>
                      <option value="pro">PRO</option>
                      <option value="studio">STUDIO</option>
                    </>
                  )}
                </select>
              </div>

              {novoPlano !== 'free' ? (
                <>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-mono font-bold text-vapor-300 uppercase">Tipo de Concessão</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setIsCortesiaAdmin(true)}
                        className={`p-2.5 rounded-lg border text-left transition cursor-pointer ${
                          isCortesiaAdmin
                            ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-200'
                            : 'bg-graphite-950 border-graphite-700 text-vapor-400 hover:border-graphite-600'
                        }`}
                      >
                        <span className="text-xs font-bold block">Cortesia Admin</span>
                        <span className="text-[10px] opacity-80">Sem cobrança / Fora do MRR</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsCortesiaAdmin(false)}
                        className={`p-2.5 rounded-lg border text-left transition cursor-pointer ${
                          !isCortesiaAdmin
                            ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-200'
                            : 'bg-graphite-950 border-graphite-700 text-vapor-400 hover:border-graphite-600'
                        }`}
                      >
                        <span className="text-xs font-bold block">Ativo Comercial</span>
                        <span className="text-[10px] opacity-80">Pago manual / Conta no MRR</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-mono font-bold text-vapor-300 uppercase">
                      {isCortesiaAdmin ? 'Duração da Cortesia (Rebaixamento Automático)' : 'Vigência / Próximo Vencimento'}
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {CORTESIA_DURACAO_OPCOES.map((op) => (
                        <button
                          key={op.id}
                          type="button"
                          onClick={() => setDuracaoCortesiaOpcao(op.id)}
                          className={`py-2 px-2 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                            duracaoCortesiaOpcao === op.id
                              ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                              : 'bg-graphite-950 border-graphite-700 text-vapor-300 hover:border-graphite-600'
                          }`}
                        >
                          {op.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setDuracaoCortesiaOpcao('custom')}
                        className={`py-2 px-2 rounded-lg border text-xs font-semibold transition cursor-pointer col-span-3 ${
                          duracaoCortesiaOpcao === 'custom'
                            ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                            : 'bg-graphite-950 border-graphite-700 text-vapor-400 hover:border-graphite-600'
                        }`}
                      >
                        Outro prazo (informar dias)
                      </button>
                    </div>

                    {duracaoCortesiaOpcao === 'custom' && (
                      <div className="flex items-center gap-2 pt-1">
                        <input
                          type="number"
                          min={1}
                          max={3650}
                          value={diasCustomCortesia}
                          onChange={(e) => setDiasCustomCortesia(e.target.value)}
                          placeholder="Dias (ex: 45)"
                          className="w-32 p-2 bg-graphite-950 border border-graphite-700 focus:border-amber-500 rounded-lg text-xs text-vapor-100 outline-none font-mono"
                        />
                        <span className="text-xs text-vapor-400">dias a partir de hoje</span>
                      </div>
                    )}

                    {(() => {
                      const diasPrev = resolverDiasCortesia();
                      const dataFimIso = calcularDataFimCortesiaISO(diasPrev);
                      return (
                        <div className="mt-1 p-2.5 rounded-lg bg-graphite-950 border border-graphite-800 text-[11px] text-vapor-300 leading-relaxed">
                          {dataFimIso ? (
                            isCortesiaAdmin ? (
                              <span>
                                ⏳ Acesso liberado sem cobrança até <strong className="text-cyan-300">{formatarDataSegura(dataFimIso)}</strong> ({diasPrev} dias). Após essa data, a rotina diária rebaixa automaticamente para <strong className="text-vapor-100">FREE</strong>.
                              </span>
                            ) : (
                              <span>
                                📅 Plano ativo no MRR com próximo vencimento em <strong className="text-emerald-300">{formatarDataSegura(dataFimIso)}</strong>.
                              </span>
                            )
                          ) : (
                            <span>
                              ♾️ <strong className="text-amber-300">Sem prazo definido (vitalício):</strong> esta oficina não será rebaixada automaticamente pelo cron. {isCortesiaAdmin ? 'Não gera cobrança no Asaas e não entra no MRR.' : ''}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </>
              ) : (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-200">
                  A oficina será rebaixada imediatamente para o plano <strong>FREE</strong> e eventuais cortesias ativas serão encerradas.
                </div>
              )}

              <div className="flex flex-col gap-1">
                <label className="text-xs font-mono font-bold text-vapor-300 uppercase">
                  Motivo / Justificativa (Obrigatório para Auditoria)
                </label>
                <textarea
                  rows={3}
                  value={motivoAudit}
                  onChange={(e) => setMotivoAudit(e.target.value)}
                  placeholder="Ex: Concessão de cortesia de 1 mês ou ajuste comercial solicitado pelo cliente."
                  className="p-2.5 bg-graphite-950 border border-graphite-700 rounded-lg text-xs text-vapor-100 focus:border-amber-500 outline-none resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={salvandoAlteracao || !motivoAudit.trim()}
                className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-graphite-950 font-bold rounded-xl text-xs uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer"
              >
                {salvandoAlteracao ? 'Salvando...' : 'Confirmar e Auditar Alteração'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
