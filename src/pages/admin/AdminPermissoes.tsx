import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAdminAuth } from '../../components/admin/AdminGuard';
import { ModalConfirmacao } from '../../components/ui/ModalConfirmacao';
import { 
  Save, 
  AlertTriangle, 
  Check, 
  X,
  Layers,
  Plus
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

  // Modal para cadastrar nova funcionalidade dinamicamente
  const [showAddModal, setShowAddModal] = useState(false);
  const [novaChave, setNovaChave] = useState('');
  const [novoNome, setNovoNome] = useState('');
  const [novaDesc, setNovaDesc] = useState('');
  const [novoGrupo, setNovoGrupo] = useState('Personalização');
  const [creating, setCreating] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [showConfirmSave, setShowConfirmSave] = useState(false);

  const fetchFeatures = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('admin_listar_plan_features');
      if (error) throw error;

      const cat: FeatureItem[] = data.catalogo || [];
      const featList: PlanFeature[] = data.features || [];

      setCatalogo(cat);

      // Build initial matrix
      const m: Record<string, Record<string, boolean>> = {};
      cat.forEach((f) => {
        m[f.chave] = { free: false, pro: false, studio: false };
      });
      featList.forEach((pf) => {
        if (!m[pf.feature]) {
          m[pf.feature] = { free: false, pro: false, studio: false };
        }
        m[pf.feature][pf.plano] = pf.habilitado;
      });
      setMatrix(m);
    } catch (err: any) {
      setMsg({ type: 'error', text: 'Erro ao carregar permissões: ' + err.message });
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
    setShowConfirmSave(true);
  };

  const executeSaveAll = async () => {
    setShowConfirmSave(false);
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

  const handleCreateFeature = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    if (!novaChave.trim() || !novoNome.trim()) {
      setModalError('Informe o código identificador e o nome da funcionalidade.');
      return;
    }

    try {
      setCreating(true);
      const { error } = await supabase.rpc('admin_cadastrar_feature_catalogo', {
        p_chave: novaChave.trim().toLowerCase().replace(/\s+/g, '_'),
        p_nome: novoNome.trim(),
        p_descricao: novaDesc.trim() || null,
        p_grupo: novoGrupo.trim() || 'Geral',
        p_ordem: catalogo.length + 1
      });

      if (error) throw error;

      setMsg({ type: 'success', text: `Nova funcionalidade "${novoNome}" cadastrada no sistema!` });
      setShowAddModal(false);
      setNovaChave('');
      setNovoNome('');
      setNovaDesc('');
      await fetchFeatures();
    } catch (err: any) {
      setModalError('Erro ao cadastrar funcionalidade: ' + err.message);
    } finally {
      setCreating(false);
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
            Defina quais funcionalidades estão disponíveis em cada plano de assinatura ou cadastre novas.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {!isReadOnly && (
            <button
              onClick={() => setShowAddModal(true)}
              className="bg-slate-800 hover:bg-slate-700 text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition flex items-center space-x-2 border border-slate-700"
            >
              <Plus className="w-4 h-4 text-amber-400" />
              <span>Cadastrar Nova Funcionalidade</span>
            </button>
          )}

          <button
            onClick={handleSaveAll}
            disabled={saving || isReadOnly}
            className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold px-4 py-2.5 rounded-lg text-sm transition flex items-center space-x-2 shadow-lg shadow-amber-500/10"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Salvando...' : 'Salvar Matriz em Lote'}</span>
          </button>
        </div>
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

      {/* Modal: Cadastrar Nova Funcionalidade */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-150">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                <Plus className="w-5 h-5 text-amber-400" />
                <span>Cadastrar Nova Funcionalidade</span>
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateFeature} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">
                  Nome da Funcionalidade *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Personalização de PDF"
                  value={novoNome}
                  onChange={(e) => setNovoNome(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">
                  Código Identificador (Chave) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: personalizacao_pdf"
                  value={novaChave}
                  onChange={(e) => setNovaChave(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-white font-mono text-sm focus:outline-none focus:border-amber-500"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Usado no código e no banco de dados. Ex: personalizacao_pdf, arquivos_digitais.
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">
                  Grupo / Categoria
                </label>
                <input
                  type="text"
                  placeholder="Ex: Personalização, Operacional, Vendas, Financeiro"
                  value={novoGrupo}
                  onChange={(e) => setNovoGrupo(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">
                  Descrição Explicativa
                </label>
                <textarea
                  rows={2}
                  placeholder="Explicação do que este recurso libera na oficina..."
                  value={novaDesc}
                  onChange={(e) => setNovaDesc(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
                />
              </div>

              {modalError && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-xs flex items-center gap-2">
                  <AlertTriangle size={15} className="shrink-0" />
                  <span>{modalError}</span>
                </div>
              )}

              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-400 hover:text-white transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-5 py-2 rounded-lg text-sm transition flex items-center space-x-2"
                >
                  {creating ? 'Cadastrando...' : 'Cadastrar Funcionalidade'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Confirmação para Salvar Matriz */}
      <ModalConfirmacao
        isOpen={showConfirmSave}
        onClose={() => setShowConfirmSave(false)}
        onConfirm={executeSaveAll}
        titulo="Confirmar Alteração de Permissões dos Planos"
        mensagem="Atenção: Desmarcar uma funcionalidade de um plano removerá o acesso de TODAS as oficinas daquele plano imediatamente. Deseja prosseguir?"
        textoConfirmar="Salvar Alterações"
        textoCancelar="Voltar"
        variant="warning"
        loading={saving}
      />
    </div>
  );
};
