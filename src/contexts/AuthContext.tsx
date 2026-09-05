import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Profile, Tenant, TenantMember } from '../types/auth';

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  tenant: Tenant | null;
  membership: TenantMember | null;
  userTenants: { tenant: Tenant; membership: TenantMember }[];
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (
    email: string,
    password: string,
    nome: string,
    telefone?: string
  ) => Promise<{ data: { user: User | null; session: Session | null } | null; error: Error | null }>;
  signOut: () => Promise<void>;
  trocarTenant: (tenantId: string) => void;
  refetchTenantData: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [userTenants, setUserTenants] = useState<{ tenant: Tenant; membership: TenantMember }[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(() => {
    return localStorage.getItem('detailers_selected_tenant_id');
  });
  const [loading, setLoading] = useState<boolean>(true);
  const currentUserRef = useRef<string | null>(null);

  const fetchUserData = async (currentUser: User | null, isBackground = false) => {
    if (!currentUser) {
      setProfile(null);
      setUserTenants([]);
      currentUserRef.current = null;
      setLoading(false);
      return;
    }

    try {
      // 1. Busca perfil
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .single();

      if (profileData) {
        setProfile(profileData as Profile);
      }

      // Atualiza atividade do usuário (touch last_seen_at) para rastreamento de acesso real
      (async () => {
        try {
          await supabase.rpc('touch_user_activity');
        } catch {}
      })();

      // 2. Busca vínculos de tenant ativos do usuário
      const { data: membersData } = await supabase
        .from('tenant_members')
        .select('*, tenant:tenants(*)')
        .eq('user_id', currentUser.id)
        .eq('status', 'ativo');

      let tenantsList: Array<{ tenant: Tenant; membership: TenantMember }> = [];

      if (membersData && membersData.length > 0) {
        tenantsList = membersData
          .filter((m: any) => m.tenant)
          .map((m: any) => ({
            tenant: m.tenant as Tenant,
            membership: {
              id: m.id,
              tenant_id: m.tenant_id,
              user_id: m.user_id,
              email: m.email,
              role: m.role,
              status: m.status,
              convite_token: m.convite_token,
              created_at: m.created_at,
            } as TenantMember,
          }));
      }

      // 3. Se for Administrador da Plataforma, também carrega as oficinas da plataforma
      // Isso permite que o admin acerte oficinas no app sem ser obrigado a cadastrar uma nova oficina pessoal
      try {
        const { data: isPlatformAdmin } = await supabase.rpc('is_platform_admin');
        if (isPlatformAdmin) {
          const { data: allTenants } = await supabase.rpc('admin_listar_tenants', {
            p_busca: null,
            p_plano: null,
            p_limite: 100,
            p_offset: 0,
          });

          if (allTenants && allTenants.length > 0) {
            allTenants.forEach((t: any) => {
              if (!tenantsList.some((ut) => ut.tenant.id === t.id)) {
                tenantsList.push({
                  tenant: {
                    id: t.id,
                    nome: t.nome,
                    slug: t.slug,
                    plano: t.plano,
                    cidade: t.cidade,
                    uf: t.uf,
                    criado_por: currentUser.id,
                    created_at: t.created_at,
                    updated_at: t.created_at,
                  } as Tenant,
                  membership: {
                    id: `admin-${t.id}`,
                    tenant_id: t.id,
                    user_id: currentUser.id,
                    email: currentUser.email || '',
                    role: 'dono',
                    status: 'ativo',
                    convite_token: null,
                    created_at: t.created_at,
                  } as TenantMember,
                });
              }
            });
          }
        }
      } catch (errAdmin) {
        console.warn('[AuthContext] Falha ao carregar oficinas para platform admin:', errAdmin);
      }

      if (tenantsList.length > 0) {
        setUserTenants(tenantsList);

        // Define tenant selecionado
        const storedId = localStorage.getItem('detailers_selected_tenant_id');
        const found = tenantsList.find((t) => t.tenant.id === storedId);
        if (found) {
          setSelectedTenantId(found.tenant.id);
        } else {
          setSelectedTenantId((prev) => {
            if (prev && tenantsList.some((t) => t.tenant.id === prev)) return prev;
            localStorage.setItem('detailers_selected_tenant_id', tenantsList[0].tenant.id);
            return tenantsList[0].tenant.id;
          });
        }
      } else {
        setUserTenants([]);
        setSelectedTenantId(null);
      }
      currentUserRef.current = currentUser.id;
    } catch (err) {
      console.error('Erro ao carregar dados do usuário:', err);
    } finally {
      if (!isBackground) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    let mounted = true;

    // Escuta mudanças no estado de auth e inicialização
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      const currentUser = session?.user ?? null;
      setUser(currentUser);

      if (event === 'TOKEN_REFRESHED') {
        // Renovação periódica de token do Supabase ao alternar abas/foco: não desmonta nem ativa loading
        if (currentUser) {
          (async () => {
            try {
              await supabase.rpc('touch_user_activity');
            } catch {}
          })();
        }
        return;
      }

      if (currentUser) {
        const isAlreadyLoaded = currentUserRef.current === currentUser.id;
        await fetchUserData(currentUser, isAlreadyLoaded);
      } else if (event === 'INITIAL_SESSION' || event === 'SIGNED_OUT') {
        currentUserRef.current = null;
        setProfile(null);
        setUserTenants([]);
        setLoading(false);
      }
    });

    // Fallback de segurança para getSession se onAuthStateChange demorar
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      if (session?.user) {
        setUser(session.user);
        const isAlreadyLoaded = currentUserRef.current === session.user.id;
        fetchUserData(session.user, isAlreadyLoaded);
      } else {
        // Apenas conclui loading se não houver sessão ativa
        setLoading(false);
      }
    }).catch((err) => {
      console.warn('[AuthContext] Erro ao recuperar sessão inicial:', err);
      if (mounted) setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setLoading(false);
        return { error: error as Error | null };
      }
      if (data?.user) {
        setUser(data.user);
        await fetchUserData(data.user);
      } else {
        setLoading(false);
      }
      return { error: null };
    } catch (err: any) {
      setLoading(false);
      return { error: err as Error };
    }
  };

  const signUp = async (email: string, password: string, nome: string, telefone?: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          nome,
          telefone,
        },
      },
    });
    return { data, error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem('detailers_selected_tenant_id');
    setUser(null);
    setProfile(null);
    setUserTenants([]);
    setSelectedTenantId(null);
  };

  const trocarTenant = (tenantId: string) => {
    setSelectedTenantId(tenantId);
    localStorage.setItem('detailers_selected_tenant_id', tenantId);
  };

  const refetchTenantData = async () => {
    if (user) {
      await fetchUserData(user);
    }
  };

  // Tenant e Membership ativos
  const activePair = userTenants.find((t) => t.tenant.id === selectedTenantId) || userTenants[0] || null;
  const activeTenant = activePair ? activePair.tenant : null;
  const activeMembership = activePair ? activePair.membership : null;

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        tenant: activeTenant,
        membership: activeMembership,
        userTenants,
        loading,
        signIn,
        signUp,
        signOut,
        trocarTenant,
        refetchTenantData,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  }
  return context;
};
