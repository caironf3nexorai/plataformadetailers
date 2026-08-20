import React, { createContext, useContext, useEffect, useState } from 'react';
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

  const fetchUserData = async (currentUser: User | null) => {
    if (!currentUser) {
      setProfile(null);
      setUserTenants([]);
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

      // 2. Busca vínculos de tenant ativos do usuário
      const { data: membersData } = await supabase
        .from('tenant_members')
        .select('*, tenant:tenants(*)')
        .eq('user_id', currentUser.id)
        .eq('status', 'ativo');

      if (membersData && membersData.length > 0) {
        const formattedTenants = membersData
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

        setUserTenants(formattedTenants);

        // Define tenant selecionado
        const storedId = localStorage.getItem('detailers_selected_tenant_id');
        const found = formattedTenants.find((t) => t.tenant.id === storedId);
        if (found) {
          setSelectedTenantId(found.tenant.id);
        } else if (formattedTenants.length > 0) {
          setSelectedTenantId(formattedTenants[0].tenant.id);
          localStorage.setItem('detailers_selected_tenant_id', formattedTenants[0].tenant.id);
        }
      } else {
        setUserTenants([]);
        setSelectedTenantId(null);
      }
    } catch (err) {
      console.error('Erro ao carregar dados do usuário:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Session check inicial
    supabase.auth.getSession().then(({ data: { session } }) => {
      const initialUser = session?.user ?? null;
      setUser(initialUser);
      fetchUserData(initialUser);
    });

    // Escuta mudanças no estado de auth
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        fetchUserData(currentUser);
      }
    });

    return () => {
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
    const exists = userTenants.some((t) => t.tenant.id === tenantId);
    if (exists) {
      setSelectedTenantId(tenantId);
      localStorage.setItem('detailers_selected_tenant_id', tenantId);
    }
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
