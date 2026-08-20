import React, { createContext, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ShieldAlert, LogOut, Copy, Check } from 'lucide-react';

interface AdminAuthContextType {
  isPlatformAdmin: boolean;
  adminLevel: 'admin' | 'suporte' | null;
  loading: boolean;
  adminEmail: string | null;
}

const AdminAuthContext = createContext<AdminAuthContextType>({
  isPlatformAdmin: false,
  adminLevel: null,
  loading: true,
  adminEmail: null,
});

export const useAdminAuth = () => useContext(AdminAuthContext);

export const AdminGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isPlatformAdmin, setIsPlatformAdmin] = useState<boolean>(false);
  const [adminLevel, setAdminLevel] = useState<'admin' | 'suporte' | null>(null);
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);
  const navigate = useNavigate();

  useEffect(() => {
    async function checkAdminStatus() {
      try {
        setLoading(true);
        const { data: authData } = await supabase.auth.getUser();
        if (!authData?.user) {
          setIsPlatformAdmin(false);
          setLoading(false);
          return;
        }

        setAdminEmail(authData.user.email || null);
        setUserId(authData.user.id);

        // Call RPC is_platform_admin
        const { data: isAdmin, error: rpcErr } = await supabase.rpc('is_platform_admin');
        if (rpcErr || !isAdmin) {
          console.warn('[AdminGuard] Usuário não é admin da plataforma:', authData.user.email, rpcErr?.message);
          setIsPlatformAdmin(false);
          setLoading(false);
          return;
        }

        // Query platform_admins for user level (use maybeSingle to prevent exceptions)
        const { data: adminRecord } = await supabase
          .from('platform_admins')
          .select('nivel, email')
          .eq('user_id', authData.user.id)
          .maybeSingle();

        setIsPlatformAdmin(true);
        setAdminLevel((adminRecord?.nivel as 'admin' | 'suporte') || 'admin');
      } catch (err) {
        console.error('[AdminGuard] Erro ao verificar permissões:', err);
        setIsPlatformAdmin(false);
      } finally {
        setLoading(false);
      }
    }

    checkAdminStatus();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-100 p-4 font-sans">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-amber-500 mb-4"></div>
        <p className="text-slate-400 text-sm font-medium tracking-wide">VERIFICANDO CREDENCIAIS ADMINISTRATIVAS...</p>
      </div>
    );
  }

  // Se não for admin, exibe um painel explicativo em vez de tela preta
  if (!isPlatformAdmin) {
    const sqlSnippet = `INSERT INTO public.platform_admins (user_id, email, nivel, super_admin, criado_por)\nSELECT id, email, 'admin', true, id \nFROM auth.users \nWHERE email = '${adminEmail || 'seu_email@dominio.com'}'\nON CONFLICT (user_id) DO UPDATE SET super_admin = true, nivel = 'admin', ativo = true;`;

    const handleCopy = () => {
      navigator.clipboard.writeText(sqlSnippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4 sm:p-6 font-sans">
        <div className="bg-slate-900 border border-amber-500/30 rounded-2xl max-w-xl w-full p-6 sm:p-8 shadow-2xl space-y-6">
          <div className="flex items-center space-x-3 pb-4 border-b border-slate-800">
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold font-heading text-white">Acesso Restrito ao Painel Admin</h2>
              <p className="text-xs text-slate-400">
                Seu usuário não está registrado na tabela de administradores.
              </p>
            </div>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2 text-xs font-mono">
            <div className="text-slate-400">E-mail Logado: <span className="text-white font-bold">{adminEmail || 'Não identificado'}</span></div>
            <div className="text-slate-400">User ID: <span className="text-slate-300">{userId || 'Não identificado'}</span></div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-300 font-semibold">
              <span>Execute este comando no SQL Editor do Supabase para liberar seu acesso:</span>
              <button
                onClick={handleCopy}
                className="text-amber-400 hover:text-amber-300 flex items-center space-x-1 font-mono text-[11px] bg-amber-500/10 border border-amber-500/30 px-2 py-1 rounded"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copiado!' : 'Copiar SQL'}</span>
              </button>
            </div>
            <pre className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-[11px] font-mono text-amber-300 overflow-x-auto whitespace-pre-wrap">
              {sqlSnippet}
            </pre>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              onClick={() => navigate('/')}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold px-4 py-2.5 rounded-xl text-xs transition flex items-center space-x-2 border border-slate-700"
            >
              <LogOut className="w-4 h-4" />
              <span>Voltar ao Dashboard da Oficina</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AdminAuthContext.Provider value={{ isPlatformAdmin, adminLevel, loading, adminEmail }}>
      {children}
    </AdminAuthContext.Provider>
  );
};
