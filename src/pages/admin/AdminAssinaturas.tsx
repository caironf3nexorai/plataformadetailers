import React, { useEffect, useState } from 'react';
import { Shield, DollarSign, Users, Clock, AlertTriangle, Search, Filter, Edit2, CheckCircle, RefreshCw, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';

interface MetricasAssinaturas {
  mrr_centavos: number;
  mrr_reais: number;
  total_ativas: number;
  total_trial: number;
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
  const [motivoAudit, setMotivoAudit] = useState('');
  const [salvandoAlteracao, setSalvandoAlteracao] = useState(false);

  const carregarDados = async () => {
    setLoading(true);
    try {
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

  const handleSalvarAlteracaoManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAssinatura) return;

    if (!motivoAudit.trim()) {
      showError('Por favor, informe a justificativa da alteração manual para auditoria.');
      return;
    }

    setSalvandoAlteracao(true);
    try {
      const { error } = await supabase.rpc('admin_alterar_plano_manual', {
        p_tenant_id: selectedAssinatura.tenant_id,
        p_novo_plano: novoPlano,
        p_motivo: motivoAudit.trim(),
      });

      if (error) throw error;

      showSuccess(`Plano da oficina "${selectedAssinatura.tenant_nome}" alterado para ${novoPlano.toUpperCase()} com sucesso!`);
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

        <button
          onClick={carregarDados}
          className="px-3.5 py-2 rounded-lg bg-graphite-800 hover:bg-graphite-700 text-vapor-200 border border-graphite-600 text-xs font-semibold flex items-center gap-2 transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Atualizar Métricas
        </button>
      </div>

      {/* Cards de Métricas MRR (Somente ativas contam no MRR) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
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
              Somente assinaturas com status ATIVA
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

        {/* Em Trial */}
        <div className="p-5 rounded-xl bg-graphite-800 border border-graphite-700 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold text-amber-400 uppercase tracking-wider">Trials (14d)</span>
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
                assinaturas.map((ass) => (
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
                          ass.status === 'ativa'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : ass.status === 'trial'
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                            : ass.status === 'atrasada'
                            ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                            : 'bg-graphite-700 text-vapor-400 border-graphite-600'
                        }`}
                      >
                        {ass.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-mono font-bold text-vapor-100">
                      R$ {(ass.valor_centavos / 100).toFixed(2)}
                    </td>
                    <td className="py-3.5 px-4 capitalize text-vapor-300">
                      {ass.forma_pagamento || '—'}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-[11px] text-vapor-400">
                      {ass.status === 'trial' && ass.trial_fim
                        ? `Trial até ${new Date(ass.trial_fim).toLocaleDateString('pt-BR')}`
                        : ass.proximo_vencimento
                        ? new Date(ass.proximo_vencimento).toLocaleDateString('pt-BR')
                        : '—'}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => {
                          setSelectedAssinatura(ass);
                          setNovoPlano((ass.plano as any) || 'pro');
                          setMotivoAudit('');
                          setModalOpen(true);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 font-semibold text-xs inline-flex items-center gap-1.5 transition-colors"
                      >
                        <Edit2 size={13} />
                        Alterar Plano
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de Alteração Manual pelo Admin */}
      {modalOpen && selectedAssinatura && (
        <div className="fixed inset-0 z-50 bg-graphite-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-graphite-900 border border-graphite-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6 flex flex-col gap-5">
            <div className="flex items-center justify-between border-b border-graphite-800 pb-3">
              <h3 className="font-bold text-vapor-100 font-display uppercase tracking-wider text-sm flex items-center gap-2">
                <Shield className="text-amber-500" size={18} />
                Alteração Manual de Plano
              </h3>
              <button onClick={() => setModalOpen(false)} className="text-vapor-400 hover:text-vapor-100">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSalvarAlteracaoManual} className="flex flex-col gap-4">
              <div className="p-3 bg-graphite-950 rounded-lg border border-graphite-800 text-xs text-vapor-300">
                Oficina: <strong className="text-vapor-100">{selectedAssinatura.tenant_nome}</strong>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-mono font-bold text-vapor-300 uppercase">Novo Plano</label>
                <select
                  value={novoPlano}
                  onChange={(e) => setNovoPlano(e.target.value as any)}
                  className="p-2.5 bg-graphite-950 border border-graphite-700 rounded-lg text-xs text-vapor-100 focus:border-amber-500 outline-none"
                >
                  <option value="free">FREE (R$ 0/mês)</option>
                  <option value="pro">PRO (R$ 67/mês)</option>
                  <option value="studio">STUDIO (R$ 147/mês)</option>
                </select>
              </div>

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
                className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-graphite-950 font-bold rounded-xl text-xs uppercase tracking-wider transition-all disabled:opacity-50"
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
