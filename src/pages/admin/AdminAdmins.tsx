import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAdminAuth } from '../../components/admin/AdminGuard';
import { 
  UserPlus, 
  Lock, 
  Trash2, 
  CheckCircle2, 
  Crown,
  X
} from 'lucide-react';

interface AdminUserItem {
  id: string;
  user_id: string;
  email: string;
  nivel: 'admin' | 'suporte';
  ativo: boolean;
  super_admin: boolean;
  observacao: string | null;
  created_at: string;
  revogado_em: string | null;
  criado_por_email: string | null;
}

export const AdminAdmins: React.FC = () => {
  const { adminLevel } = useAdminAuth();
  const isReadOnly = adminLevel === 'suporte';

  const [admins, setAdmins] = useState<AdminUserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modal form state
  const [novoEmail, setNovoEmail] = useState('');
  const [novoNivel, setNovoNivel] = useState<'admin' | 'suporte'>('admin');
  const [isSuperAdminCheck, setIsSuperAdminCheck] = useState(false);
  const [observacao, setObservacao] = useState('');

  const fetchAdmins = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('admin_listar_administradores');
      if (error) throw error;
      setAdmins(data || []);
    } catch (err: any) {
      console.error('[AdminAdmins] Erro ao listar administradores:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdmins();
  }, []);

  const handlePromoteAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly || !novoEmail.trim()) return;

    setSubmitting(true);
    setMsg(null);

    try {
      const { error } = await supabase.rpc('admin_promover_administrador', {
        p_email: novoEmail.trim(),
        p_nivel: novoNivel,
        p_observacao: observacao.trim() || null,
        p_super_admin: isSuperAdminCheck
      });

      if (error) throw error;

      setMsg({ type: 'success', text: `Usuário '${novoEmail}' promovido a ${novoNivel.toUpperCase()} com sucesso!` });
      setShowModal(false);
      setNovoEmail('');
      setObservacao('');
      setIsSuperAdminCheck(false);
      await fetchAdmins();
    } catch (err: any) {
      setMsg({ type: 'error', text: 'Erro ao promover administrador: ' + err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevokeAdmin = async (id: string, email: string, isSuper: boolean) => {
    if (isReadOnly) return;
    if (isSuper) {
      alert('Operação Negada: O Super Admin é imutável e não pode ser revogado.');
      return;
    }

    const confirm = window.confirm(`Tem certeza que deseja revogar as permissões administrativas do usuário '${email}'?`);
    if (!confirm) return;

    try {
      const { error } = await supabase.rpc('admin_revogar_administrador', { p_admin_id: id });
      if (error) throw error;

      setMsg({ type: 'success', text: `Acesso administrativo de '${email}' revogado.` });
      await fetchAdmins();
    } catch (err: any) {
      setMsg({ type: 'error', text: 'Erro ao revogar acesso: ' + err.message });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-heading text-white">Administradores da Plataforma</h1>
          <p className="text-slate-400 text-sm">
            Gestão de credenciais com hierarquia e proteção de Super Admin imutável.
          </p>
        </div>

        <button
          onClick={() => setShowModal(true)}
          disabled={isReadOnly}
          className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold px-4 py-2.5 rounded-lg text-sm transition flex items-center space-x-2 shadow-lg shadow-amber-500/10"
        >
          <UserPlus className="w-4 h-4" />
          <span>Promover Novo Administrador</span>
        </button>
      </div>

      {/* Super Admin Protection Banner */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-center space-x-3 text-amber-300 text-xs sm:text-sm">
        <Crown className="w-5 h-5 shrink-0 text-amber-400" />
        <div>
          <strong>Regra do Super Admin Imutável:</strong> O criador da plataforma possui controle permanente e proteção contra remoção por outros administradores.
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

      {/* Table of Admins */}
      {loading ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-400">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500 mx-auto mb-3"></div>
          <p className="text-sm">Carregando administradores...</p>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="px-6 py-4">Administrador / E-mail</th>
                <th className="px-6 py-4">Nível de Acesso</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Promovido Por</th>
                <th className="px-6 py-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {admins.map((adm) => (
                <tr key={adm.id} className="hover:bg-slate-800/40 transition">
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-white">{adm.email}</span>
                      {adm.super_admin && (
                        <span className="inline-flex items-center space-x-1 bg-amber-500/20 text-amber-400 border border-amber-500/40 text-[10px] font-mono px-2 py-0.5 rounded font-bold">
                          <Crown className="w-3 h-3 text-amber-400" />
                          <span>SUPER ADMIN</span>
                        </span>
                      )}
                    </div>
                    {adm.observacao && (
                      <p className="text-xs text-slate-400 mt-0.5">{adm.observacao}</p>
                    )}
                  </td>

                  <td className="px-6 py-4">
                    <span className={`inline-block px-2.5 py-0.5 rounded text-xs font-mono font-bold uppercase ${
                      adm.nivel === 'admin' 
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                    }`}>
                      {adm.nivel}
                    </span>
                  </td>

                  <td className="px-6 py-4">
                    {adm.ativo ? (
                      <span className="inline-flex items-center space-x-1 text-emerald-400 text-xs font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Ativo</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center space-x-1 text-rose-400 text-xs font-semibold">
                        <X className="w-3.5 h-3.5" />
                        <span>Revogado</span>
                      </span>
                    )}
                  </td>

                  <td className="px-6 py-4 text-xs font-mono text-slate-400">
                    {adm.criado_por_email || 'Sistema (Bootstrap)'}
                  </td>

                  <td className="px-6 py-4 text-right">
                    {adm.super_admin ? (
                      <span className="inline-flex items-center space-x-1 text-xs text-slate-500 font-mono" title="Super Admin é Imutável">
                        <Lock className="w-3.5 h-3.5 text-amber-500" />
                        <span>Protegido</span>
                      </span>
                    ) : (
                      <button
                        onClick={() => handleRevokeAdmin(adm.id, adm.email, adm.super_admin)}
                        disabled={!adm.ativo || isReadOnly}
                        className="bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-30 text-rose-400 px-3 py-1 rounded text-xs font-semibold border border-rose-500/30 transition flex items-center space-x-1 ml-auto"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Revogar</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Promover Administrador */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                <UserPlus className="w-5 h-5 text-amber-500" />
                <span>Promover Administrador</span>
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handlePromoteAdmin} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  E-mail do Usuário Já Cadastrado
                </label>
                <input
                  type="email"
                  required
                  value={novoEmail}
                  onChange={(e) => setNovoEmail(e.target.value)}
                  placeholder="usuario@oficina.com.br"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-amber-500/50"
                />
                <span className="text-[11px] text-slate-500 mt-1 block">
                  O usuário precisa ter uma conta criada na plataforma antes de ser promovido.
                </span>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Nível de Permissão
                </label>
                <select
                  value={novoNivel}
                  onChange={(e) => setNovoNivel(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-amber-500/50"
                >
                  <option value="admin">Administrador (Leitura + Alterações)</option>
                  <option value="suporte">Suporte (Somente Leitura)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Observação / Justificativa
                </label>
                <input
                  type="text"
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  placeholder="Ex: Responsável pelo suporte técnico"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-amber-500/50"
                />
              </div>

              <div className="pt-4 flex items-center justify-end space-x-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium transition text-xs"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg transition text-xs shadow-lg shadow-amber-500/10"
                >
                  {submitting ? 'Promovendo...' : 'Confirmar Promoção'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
