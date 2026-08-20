import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAdminAuth } from '../../components/admin/AdminGuard';
import { 
  HardDrive, 
  RefreshCw, 
  AlertTriangle, 
  FileText, 
  Clock
} from 'lucide-react';

interface StorageSnapshotItem {
  id: string;
  tenant_id: string;
  tenant_nome: string;
  tenant_slug: string;
  bucket: 'evidencias' | 'catalogo';
  total_arquivos: number;
  total_bytes: number;
  calculado_em: string;
}

export const AdminStorage: React.FC = () => {
  const { adminLevel } = useAdminAuth();
  const isReadOnly = adminLevel === 'suporte';

  const [snapshots, setSnapshots] = useState<StorageSnapshotItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalculating] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchSnapshots = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('admin_obter_storage_snapshots');
      if (error) throw error;
      setSnapshots(data || []);
    } catch (err: any) {
      console.error('[AdminStorage] Erro ao carregar snapshots:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSnapshots();
  }, []);

  const handleRecalculate = async () => {
    if (isReadOnly) return;
    setRecalculating(true);
    setMsg(null);
    try {
      const { error } = await supabase.rpc('admin_recalcular_storage');
      if (error) throw error;
      setMsg({ type: 'success', text: 'Recálculo de storage executado com sucesso!' });
      await fetchSnapshots();
    } catch (err: any) {
      setMsg({ type: 'error', text: 'Erro ao recalculado storage: ' + err.message });
    } finally {
      setRecalculating(false);
    }
  };

  // Helper formatting bytes to MB or GB
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) {
      return (mb / 1024).toFixed(2) + ' GB';
    }
    return mb.toFixed(2) + ' MB';
  };

  // Group snapshots by tenant
  const tenantMap: Record<string, {
    tenant_id: string;
    nome: string;
    slug: string;
    evidenciasBytes: number;
    evidenciasFiles: number;
    catalogoBytes: number;
    catalogoFiles: number;
    totalBytes: number;
    calculadoEm: string | null;
  }> = {};

  snapshots.forEach((s) => {
    if (!tenantMap[s.tenant_id]) {
      tenantMap[s.tenant_id] = {
        tenant_id: s.tenant_id,
        nome: s.tenant_nome,
        slug: s.tenant_slug,
        evidenciasBytes: 0,
        evidenciasFiles: 0,
        catalogoBytes: 0,
        catalogoFiles: 0,
        totalBytes: 0,
        calculadoEm: s.calculado_em
      };
    }

    if (s.bucket === 'evidencias') {
      tenantMap[s.tenant_id].evidenciasBytes += Number(s.total_bytes);
      tenantMap[s.tenant_id].evidenciasFiles += s.total_arquivos;
    } else if (s.bucket === 'catalogo') {
      tenantMap[s.tenant_id].catalogoBytes += Number(s.total_bytes);
      tenantMap[s.tenant_id].catalogoFiles += s.total_arquivos;
    }

    tenantMap[s.tenant_id].totalBytes += Number(s.total_bytes);
  });

  const sortedTenantList = Object.values(tenantMap).sort((a, b) => b.totalBytes - a.totalBytes);

  // Platform totals
  const totalPlatformBytes = sortedTenantList.reduce((acc, t) => acc + t.totalBytes, 0);
  const totalPlatformFiles = snapshots.reduce((acc, s) => acc + s.total_arquivos, 0);
  const ultimoCalculo = snapshots.length > 0 ? snapshots[0].calculado_em : null;

  // Threshold default: 1 GB (1,073,741,824 bytes)
  const THRESHOLD_1GB = 1073741824;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-heading text-white">Monitoramento de Storage</h1>
          <p className="text-slate-400 text-sm">
            Consumo de espaço nos buckets de evidências jurídicas e catálogo público.
          </p>
        </div>

        <button
          onClick={handleRecalculate}
          disabled={recalculating || isReadOnly}
          className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold px-4 py-2.5 rounded-lg text-sm transition flex items-center space-x-2 shadow-lg shadow-amber-500/10"
        >
          <RefreshCw className={`w-4 h-4 ${recalculating ? 'animate-spin' : ''}`} />
          <span>{recalculating ? 'Recalculando...' : 'Recalcular Storage sob Demanda'}</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
          <div className="flex items-center space-x-3 text-slate-400 mb-2">
            <HardDrive className="w-5 h-5 text-amber-500" />
            <span className="text-xs font-semibold uppercase tracking-wider">Total Plataforma</span>
          </div>
          <div className="font-mono text-3xl font-black text-amber-400">
            {formatBytes(totalPlatformBytes)}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Soma de todos os buckets ativos</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
          <div className="flex items-center space-x-3 text-slate-400 mb-2">
            <FileText className="w-5 h-5 text-indigo-400" />
            <span className="text-xs font-semibold uppercase tracking-wider">Total de Arquivos</span>
          </div>
          <div className="font-mono text-3xl font-black text-white">
            {totalPlatformFiles.toLocaleString('pt-BR')}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Fotos e provas registradas</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
          <div className="flex items-center space-x-3 text-slate-400 mb-2">
            <Clock className="w-5 h-5 text-emerald-400" />
            <span className="text-xs font-semibold uppercase tracking-wider">Snapshot Atualizado Em</span>
          </div>
          <div className="font-mono text-sm font-bold text-slate-200 mt-2">
            {ultimoCalculo ? new Date(ultimoCalculo).toLocaleString('pt-BR') : 'Nunca executado'}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Calculado sob demanda</p>
        </div>
      </div>

      {/* Toast */}
      {msg && (
        <div className={`p-4 rounded-xl text-sm font-medium border flex items-center justify-between ${
          msg.type === 'success' 
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
        }`}>
          <span>{msg.text}</span>
          <button onClick={() => setMsg(null)} className="text-xs opacity-70 hover:opacity-100">Fechar</button>
        </div>
      )}

      {/* List per Workshop */}
      {loading ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-400">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500 mx-auto mb-3"></div>
          <p className="text-sm">Carregando snapshots de armazenamento...</p>
        </div>
      ) : sortedTenantList.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-500">
          Nenhum snapshot de storage registrado até o momento. Clique em &quot;Recalcular Storage sob Demanda&quot; para atualizar.
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="px-6 py-4">Oficina</th>
                <th className="px-6 py-4">Evidências (Privado)</th>
                <th className="px-6 py-4">Catálogo (Público)</th>
                <th className="px-6 py-4 font-mono text-right">Total Consumido</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {sortedTenantList.map((t) => {
                const aboveThreshold = t.totalBytes >= THRESHOLD_1GB;
                const pct = totalPlatformBytes > 0 ? (t.totalBytes / totalPlatformBytes) * 100 : 0;

                return (
                  <tr key={t.tenant_id} className="hover:bg-slate-800/40 transition">
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-white">{t.nome}</span>
                        {aboveThreshold && (
                          <span className="flex items-center space-x-1 text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded font-mono font-bold" title="Oficina consumindo mais de 1 GB">
                            <AlertTriangle className="w-3 h-3" />
                            <span>&gt;1GB</span>
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 font-mono">/{t.slug}</div>
                      
                      {/* Proportion bar */}
                      <div className="w-36 bg-slate-950 rounded-full h-1.5 mt-2 overflow-hidden border border-slate-800">
                        <div className="bg-amber-500 h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%` }}></div>
                      </div>
                    </td>

                    <td className="px-6 py-4 font-mono text-xs">
                      <div className="text-slate-200 font-bold">{formatBytes(t.evidenciasBytes)}</div>
                      <div className="text-slate-500">{t.evidenciasFiles} arquivos</div>
                    </td>

                    <td className="px-6 py-4 font-mono text-xs">
                      <div className="text-slate-200 font-bold">{formatBytes(t.catalogoBytes)}</div>
                      <div className="text-slate-500">{t.catalogoFiles} arquivos</div>
                    </td>

                    <td className="px-6 py-4 text-right font-mono font-bold text-amber-400 text-base">
                      {formatBytes(t.totalBytes)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
