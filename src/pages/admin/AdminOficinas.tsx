import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { 
  Search, 
  Filter, 
  Building2, 
  Users, 
  Clock, 
  AlertTriangle,
  X,
  Eye,
  Activity
} from 'lucide-react';

interface TenantItem {
  id: string;
  nome: string;
  slug: string;
  plano: 'free' | 'pro' | 'studio';
  cidade: string | null;
  uf: string | null;
  created_at: string;
  total_membros: number;
  total_clientes: number;
  total_veiculos: number;
  total_agendamentos: number;
  total_execucoes: number;
  ultimo_acesso: string | null;
  agendamento_online_ativo: boolean;
}

interface TenantDetail {
  tenant: TenantItem;
  membros: Array<{
    id: string;
    email: string;
    nome: string;
    role: string;
    status: string;
    ultimo_acesso: string | null;
  }>;
  historico_12m: Array<{
    mes: string;
    agendamentos_criados: number;
    execucoes_finalizadas: number;
  }>;
  storage: Array<{
    bucket: string;
    total_arquivos: number;
    total_bytes: number;
    calculado_em: string;
  }>;
}

export const AdminOficinas: React.FC = () => {
  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [planoFiltro, setPlanoFiltro] = useState<string>('');
  const [ordenacao, setOrdenacao] = useState<'created_at' | 'ultimo_acesso'>('created_at');
  
  // Drawer / Modal detail state
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState<TenantDetail | null>(null);

  const fetchTenants = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('admin_listar_tenants', {
        p_busca: busca.trim() || null,
        p_plano: planoFiltro || null,
        p_limite: 100,
        p_offset: 0
      });

      if (error) throw error;
      setTenants(data || []);
    } catch (err: any) {
      console.error('[AdminOficinas] Erro ao carregar oficinas:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTenants();
  }, [busca, planoFiltro]);

  const handleOpenDetail = async (id: string) => {
    setSelectedTenantId(id);
    setDetailLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_detalhe_tenant', { p_tenant_id: id });
      if (error) throw error;
      setDetailData(data);
    } catch (err: any) {
      console.error('[AdminOficinas] Erro ao carregar detalhes:', err.message);
    } finally {
      setDetailLoading(false);
    }
  };

  const isChurnRisk = (ultimoAcesso: string | null) => {
    if (!ultimoAcesso) return true;
    const dias = (new Date().getTime() - new Date(ultimoAcesso).getTime()) / (1000 * 3600 * 24);
    return dias > 30;
  };

  const sortedTenants = [...tenants].sort((a, b) => {
    if (ordenacao === 'ultimo_acesso') {
      const tA = a.ultimo_acesso ? new Date(a.ultimo_acesso).getTime() : 0;
      const tB = b.ultimo_acesso ? new Date(b.ultimo_acesso).getTime() : 0;
      return tB - tA;
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <div className="space-y-6">
      {/* Header Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-heading text-white">Oficinas Cadastradas</h1>
          <p className="text-slate-400 text-sm">
            Visualização agregada do ecossistema de oficinas parceiras.
          </p>
        </div>
        <div className="flex items-center space-x-2 text-xs font-mono text-slate-400 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg">
          <Building2 className="w-4 h-4 text-amber-500" />
          <span>Total: <strong className="text-white">{tenants.length}</strong> oficinas</span>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-4 shadow-sm">
        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, slug ou cidade..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-end">
          <div className="flex items-center space-x-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              value={planoFiltro}
              onChange={(e) => setPlanoFiltro(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-amber-500/50"
            >
              <option value="">Todos os Planos</option>
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="studio">Studio</option>
            </select>
          </div>

          <select
            value={ordenacao}
            onChange={(e) => setOrdenacao(e.target.value as any)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-amber-500/50"
          >
            <option value="created_at">Ordenar por Cadastro</option>
            <option value="ultimo_acesso">Ordenar por Último Acesso</option>
          </select>
        </div>
      </div>

      {/* Desktop Table & Mobile Cards */}
      {loading ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-400">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500 mx-auto mb-3"></div>
          <p className="text-sm">Carregando dados das oficinas...</p>
        </div>
      ) : sortedTenants.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-500">
          Nenhuma oficina encontrada com os filtros aplicados.
        </div>
      ) : (
        <>
          {/* Desktop Table (Visible on md+) */}
          <div className="hidden md:block bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-950/80 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th className="px-4 py-3.5">Oficina</th>
                  <th className="px-4 py-3.5">Plano</th>
                  <th className="px-4 py-3.5">Cidade/UF</th>
                  <th className="px-4 py-3.5 text-center">Membros</th>
                  <th className="px-4 py-3.5 text-center">Agendamentos</th>
                  <th className="px-4 py-3.5 text-center">Execuções</th>
                  <th className="px-4 py-3.5">Último Acesso</th>
                  <th className="px-4 py-3.5 text-right font-mono">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {sortedTenants.map((t) => {
                  const churn = isChurnRisk(t.ultimo_acesso);
                  return (
                    <tr key={t.id} className="hover:bg-slate-800/50 transition">
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-white">{t.nome}</div>
                        <div className="text-xs text-slate-500 font-mono">/{t.slug}</div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-block px-2.5 py-0.5 rounded text-xs font-mono font-bold uppercase ${
                          t.plano === 'studio' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30' :
                          t.plano === 'pro' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/30' :
                          'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}>
                          {t.plano}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-slate-300">
                        {t.cidade ? `${t.cidade} - ${t.uf || ''}` : <span className="text-slate-600">Não informado</span>}
                      </td>
                      <td className="px-4 py-3.5 text-center font-mono text-slate-200">
                        {t.total_membros}
                      </td>
                      <td className="px-4 py-3.5 text-center font-mono text-slate-200">
                        {t.total_agendamentos}
                      </td>
                      <td className="px-4 py-3.5 text-center font-mono text-slate-200">
                        {t.total_execucoes}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center space-x-2">
                          <span className="font-mono text-xs text-slate-400">
                            {t.ultimo_acesso ? new Date(t.ultimo_acesso).toLocaleDateString('pt-BR') : 'Nunca'}
                          </span>
                          {churn && (
                            <span className="flex items-center space-x-1 text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded font-mono" title="Sem acesso há mais de 30 dias (Risco de Churn)">
                              <AlertTriangle className="w-3 h-3" />
                              <span>&gt;30d</span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <button
                          onClick={() => handleOpenDetail(t.id)}
                          className="inline-flex items-center space-x-1 bg-slate-800 hover:bg-slate-700 text-amber-400 px-2.5 py-1 rounded text-xs font-medium border border-slate-700 transition"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Detalhes</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Stacked Cards (Visible on sm/mobile 375px) */}
          <div className="md:hidden space-y-4">
            {sortedTenants.map((t) => {
              const churn = isChurnRisk(t.ultimo_acesso);
              return (
                <div key={t.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 shadow-md">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-bold text-white text-base">{t.nome}</h3>
                      <p className="text-xs text-slate-500 font-mono">/{t.slug}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold uppercase ${
                      t.plano === 'studio' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30' :
                      t.plano === 'pro' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/30' :
                      'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}>
                      {t.plano}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 py-2 border-y border-slate-800/80 text-center font-mono text-xs">
                    <div className="bg-slate-950 p-2 rounded">
                      <span className="text-slate-500 block text-[10px]">Membros</span>
                      <strong className="text-slate-200 text-sm">{t.total_membros}</strong>
                    </div>
                    <div className="bg-slate-950 p-2 rounded">
                      <span className="text-slate-500 block text-[10px]">Agend.</span>
                      <strong className="text-slate-200 text-sm">{t.total_agendamentos}</strong>
                    </div>
                    <div className="bg-slate-950 p-2 rounded">
                      <span className="text-slate-500 block text-[10px]">Execuções</span>
                      <strong className="text-slate-200 text-sm">{t.total_execucoes}</strong>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-1">
                    <div className="flex items-center space-x-1 text-slate-400">
                      <Clock className="w-3.5 h-3.5" />
                      <span className="font-mono">
                        Acesso: {t.ultimo_acesso ? new Date(t.ultimo_acesso).toLocaleDateString('pt-BR') : 'Nunca'}
                      </span>
                      {churn && (
                        <span className="bg-amber-500/10 text-amber-400 text-[10px] px-1 rounded border border-amber-500/30">
                          Churn?
                        </span>
                      )}
                    </div>

                    <button
                      onClick={() => handleOpenDetail(t.id)}
                      className="bg-slate-800 hover:bg-slate-700 text-amber-400 px-3 py-1 rounded text-xs font-semibold border border-slate-700"
                    >
                      Ver Detalhes
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Detail Drawer Modal */}
      {selectedTenantId && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex justify-end">
          <div className="bg-slate-900 border-l border-slate-800 w-full max-w-2xl h-full flex flex-col p-6 overflow-y-auto shadow-2xl animate-in slide-in-from-right duration-200">
            
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div>
                <h2 className="text-xl font-bold text-white">Detalhes da Oficina</h2>
                <p className="text-xs text-slate-400 font-mono">ID: {selectedTenantId}</p>
              </div>
              <button
                onClick={() => { setSelectedTenantId(null); setDetailData(null); }}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {detailLoading ? (
              <div className="flex-1 flex flex-col items-center justify-center p-12 text-slate-400">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500 mb-3"></div>
                <p className="text-sm">Carregando métricas e membros...</p>
              </div>
            ) : detailData ? (
              <div className="space-y-6 pt-6">
                
                {/* Basic info card */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-bold text-white">{detailData.tenant.nome}</span>
                    <span className="text-xs font-mono uppercase bg-amber-500/10 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded">
                      Plano {detailData.tenant.plano}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Cidade: {detailData.tenant.cidade ? `${detailData.tenant.cidade} - ${detailData.tenant.uf}` : 'Não cadastrada'}
                  </p>
                  <p className="text-xs text-slate-400">
                    Cadastrada em: {new Date(detailData.tenant.created_at).toLocaleDateString('pt-BR')}
                  </p>
                </div>

                {/* Members list */}
                <div>
                  <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-3 flex items-center space-x-2">
                    <Users className="w-4 h-4 text-amber-500" />
                    <span>Equipe da Oficina ({detailData.membros.length})</span>
                  </h3>
                  <div className="bg-slate-950 border border-slate-800 rounded-xl divide-y divide-slate-800">
                    {detailData.membros.length === 0 ? (
                      <p className="p-4 text-xs text-slate-500 text-center">Nenhum membro cadastrado.</p>
                    ) : (
                      detailData.membros.map((m) => (
                        <div key={m.id} className="p-3 flex items-center justify-between text-xs">
                          <div>
                            <div className="font-semibold text-slate-200">{m.nome}</div>
                            <div className="text-slate-400 font-mono">{m.email}</div>
                          </div>
                          <div className="text-right">
                            <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px] uppercase">
                              {m.role} ({m.status})
                            </span>
                            <div className="text-[10px] text-slate-500 mt-0.5">
                              Acesso: {m.ultimo_acesso ? new Date(m.ultimo_acesso).toLocaleDateString('pt-BR') : 'Nunca'}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* 12 Months Activity */}
                <div>
                  <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-3 flex items-center space-x-2">
                    <Activity className="w-4 h-4 text-amber-500" />
                    <span>Histórico dos Últimos 12 Meses</span>
                  </h3>
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 overflow-x-auto">
                    <table className="w-full text-xs text-left font-mono">
                      <thead className="text-slate-500 border-b border-slate-800">
                        <tr>
                          <th className="pb-2">Mês</th>
                          <th className="pb-2 text-center">Agendamentos</th>
                          <th className="pb-2 text-center">Execuções Finalizadas</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-900 text-slate-300">
                        {detailData.historico_12m.map((h) => (
                          <tr key={h.mes}>
                            <td className="py-1.5 text-slate-400">{h.mes}</td>
                            <td className="py-1.5 text-center">{h.agendamentos_criados}</td>
                            <td className="py-1.5 text-center text-emerald-400">{h.execucoes_finalizadas}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>
            ) : null}

          </div>
        </div>
      )}
    </div>
  );
};
