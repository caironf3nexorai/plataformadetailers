import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAdminAuth } from '../../components/admin/AdminGuard';
import { 
  Save, 
  AlertTriangle, 
  Check, 
  X,
  Layers
} from 'lucide-react';

interface FeatureItem {
  chave: string;
  nome: string;
  descricao: string | null;
  grupo: string;
  ordem: number;
}

interface PlanFeature {
  id: string;
  plano: 'free' | 'pro' | 'studio';
  feature: string;
  habilitado: boolean;
}

export const AdminPermissoes: React.FC = () => {
  const { adminLevel } = useAdminAuth();
  const isReadOnly = adminLevel === 'suporte';

  const [catalogo, setCatalogo] = useState<FeatureItem[]>([]);
  const [matrix, setMatrix] = useState<Record<string, Record<string, boolean>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchFeatures = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('admin_listar_plan_features');
      if (error) throw error;

      const cat: FeatureItem[] = data.catalogo || [];
      const featList: PlanFeature[] = data.features || [];

      setCatalogo(cat);

      // Build matrix map: matrix[featureKey][planCode] = boolean
      const map: Record<string, Record<string, boolean>> = {};
      cat.forEach((f) => {
        map[f.chave] = { free: false, pro: false, studio: false };
      });

      featList.forEach((pf) => {
        if (!map[pf.feature]) {
          map[pf.feature] = { free: false, pro: false, studio: false };
        }
        map[pf.feature][pf.plano] = pf.habilitado;
      });

      setMatrix(map);
    } catch (err: any) {
      console.error('[AdminPermissoes] Erro ao carregar permissões:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFeatures();
  }, []);

  const handleToggle = (featureKey: string, planCode: string) => {
    if (isReadOnly) return;
    setMatrix((prev) => ({
      ...prev,
      [featureKey]: {
        ...prev[featureKey],
        [planCode]: !prev[featureKey]?.[planCode]
      }
    }));
  };

  const handleSaveAll = async () => {
    if (isReadOnly) return;
    const confirm = window.confirm(
      'Atenção: Desmarcar uma funcionalidade de um plano removerá o acesso de TODAS as oficinas daquele plano imediatamente. Deseja prosseguir?'
    );
    if (!confirm) return;

    setSaving(true);
    setMsg(null);

    try {
      // Build payload array
      const payload: Array<{ plano: string; feature: string; habilitado: boolean }> = [];
      Object.entries(matrix).forEach(([featureKey, planObj]) => {
        Object.entries(planObj).forEach(([planCode, hab]) => {
          payload.push({
            plano: planCode,
            feature: featureKey,
            habilitado: hab
          });
        });
      });

      const { error } = await supabase.rpc('admin_salvar_plan_features', { p_features: payload });
      if (error) throw error;

      setMsg({ type: 'success', text: 'Matriz de permissões atualizada e salva com sucesso!' });
      await fetchFeatures();
    } catch (err: any) {
      setMsg({ type: 'error', text: 'Erro ao salvar permissões: ' + err.message });
    } finally {
      setSaving(false);
    }
  };

  // Group features by category 'grupo'
  const grupos = Array.from(new Set(catalogo.map((c) => c.grupo)));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-heading text-white">Matriz de Permissões (Features)</h1>
          <p className="text-slate-400 text-sm">
            Defina quais funcionalidades estão disponíveis em cada plano de assinatura.
          </p>
        </div>

        <button
          onClick={handleSaveAll}
          disabled={saving || isReadOnly}
          className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold px-4 py-2.5 rounded-lg text-sm transition flex items-center space-x-2 shadow-lg shadow-amber-500/10"
        >
          <Save className="w-4 h-4" />
          <span>{saving ? 'Salvando...' : 'Salvar Matriz em Lote'}</span>
        </button>
      </div>

      {/* Warning Notice */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-center space-x-3 text-amber-300 text-xs sm:text-sm">
        <AlertTriangle className="w-5 h-5 shrink-0 text-amber-400" />
        <div>
          <strong>Aviso de Alteração Global:</strong> Alterar a matriz de recursos afeta todas as oficinas do respectivo plano imediatamente. Todas as alterações são gravadas na trilha de auditoria.
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

      {/* Matrix Table */}
      {loading ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-400">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500 mx-auto mb-3"></div>
          <p className="text-sm">Carregando catálogo de funcionalidades...</p>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="px-6 py-4">Funcionalidade / Módulo</th>
                <th className="px-6 py-4 text-center font-mono w-32">FREE</th>
                <th className="px-6 py-4 text-center font-mono w-32">PRO</th>
                <th className="px-6 py-4 text-center font-mono w-32">STUDIO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {grupos.map((grupo) => (
                <React.Fragment key={grupo}>
                  {/* Category Header Row */}
                  <tr className="bg-slate-950/60 font-bold text-amber-400 text-xs tracking-wider">
                    <td colSpan={4} className="px-6 py-2.5 uppercase border-y border-slate-800/80 flex items-center space-x-2">
                      <Layers className="w-3.5 h-3.5" />
                      <span>{grupo}</span>
                    </td>
                  </tr>

                  {catalogo.filter((c) => c.grupo === grupo).map((feat) => (
                    <tr key={feat.chave} className="hover:bg-slate-800/40 transition">
                      <td className="px-6 py-3.5">
                        <div className="font-semibold text-white">{feat.nome}</div>
                        {feat.descricao && (
                          <div className="text-xs text-slate-400 mt-0.5">{feat.descricao}</div>
                        )}
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">key: {feat.chave}</div>
                      </td>

                      {['free', 'pro', 'studio'].map((planCode) => {
                        const isChecked = matrix[feat.chave]?.[planCode] || false;
                        return (
                          <td key={planCode} className="px-6 py-3.5 text-center">
                            <button
                              type="button"
                              disabled={isReadOnly}
                              onClick={() => handleToggle(feat.chave, planCode)}
                              className={`w-7 h-7 rounded-lg inline-flex items-center justify-center transition border ${
                                isChecked
                                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 shadow-inner'
                                  : 'bg-slate-950 text-slate-600 border-slate-800 hover:border-slate-700'
                              }`}
                            >
                              {isChecked ? <Check className="w-4 h-4" /> : <X className="w-3.5 h-3.5" />}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
