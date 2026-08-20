import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PublicLayout } from '../../components/layout/PublicLayout';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { AlertTriangle, Building2, LogOut } from 'lucide-react';

export const NovaOficina: React.FC = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading, refetchTenantData, signOut } = useAuth();

  const [nome, setNome] = useState('');
  const [cidade, setCidade] = useState('');
  const [uf, setUf] = useState('');
  const [telefone, setTelefone] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Validação de sessão e convite pendente no carregamento da tela
  useEffect(() => {
    const checkSession = async () => {
      if (authLoading) return;

      const searchParams = new URLSearchParams(window.location.search);
      const conviteParam = searchParams.get('convite');
      if (conviteParam) {
        navigate(`/convite/${conviteParam}`, { replace: true });
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session || !session.user) {
        navigate('/entrar', {
          state: { errorMsg: 'Sua sessão expirou. Entre novamente para continuar.' },
          replace: true,
        });
      }
    };

    checkSession();
  }, [authLoading, user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!nome.trim()) {
      setErrorMsg('Informe o nome da oficina.');
      return;
    }

    setLoading(true);

    try {
      // Valida existência de sessão ativa antes de chamar a RPC
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || !session.user) {
        setLoading(false);
        navigate('/entrar', {
          state: { errorMsg: 'Sua sessão expirou. Entre novamente para continuar.' },
          replace: true,
        });
        return;
      }

      // Chamada RPC para criação atômica da oficina e do membro dono
      const { data: _tenantId, error } = await supabase.rpc('criar_oficina', {
        p_nome: nome.trim(),
        p_cidade: cidade.trim() || null,
        p_uf: uf.trim().toUpperCase() || null,
        p_telefone: telefone.trim() || null,
      });

      if (error) {
        console.error('[NovaOficina RPC Error]:', error);
        setErrorMsg(error.message || 'Erro ao cadastrar oficina.');
        setLoading(false);
      } else {
        await refetchTenantData();
        navigate('/');
      }
    } catch (err: any) {
      console.error('[NovaOficina Exception]:', err);
      setErrorMsg(err?.message || 'Erro inesperado.');
      setLoading(false);
    }
  };

  const handleSwitchAccount = async () => {
    await signOut();
    navigate('/entrar');
  };

  if (authLoading) {
    return (
      <PublicLayout>
        <div className="max-w-md mx-auto w-full flex flex-col gap-6 py-12 text-center">
          <Card className="p-6 bg-graphite-800 border-graphite-600">
            <p className="font-sans text-[14px] text-vapor-400">Verificando autenticação...</p>
          </Card>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <div className="max-w-md mx-auto w-full flex flex-col gap-6 py-6">
        <div className="text-center flex flex-col gap-2">
          <h1 className="font-display text-[26px] sm:text-[30px] text-vapor-100 uppercase tracking-wide">
            Cadastrar Sua Oficina
          </h1>
          <p className="font-sans text-[14px] text-vapor-400">
            Informe os dados do seu estúdio ou oficina de estética automotiva
          </p>
          {user && (
            <div className="mt-2 text-[13px] text-vapor-400 font-sans flex items-center justify-center gap-2 bg-graphite-800/80 py-2 px-4 rounded-full border border-graphite-700 max-w-fit mx-auto shadow-sm">
              <span>Conectado como <strong className="text-vapor-200 font-mono">{user.email}</strong></span>
              <span className="text-graphite-500">•</span>
              <button
                type="button"
                onClick={handleSwitchAccount}
                className="text-amber-500 hover:text-amber-400 hover:underline font-semibold flex items-center gap-1 cursor-pointer"
              >
                <LogOut size={13} />
                <span>Entrar em outra conta</span>
              </button>
            </div>
          )}
        </div>

        <Card className="p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-4 shadow-xl">
          {errorMsg && (
            <div className="p-3 bg-flare-400/10 border border-flare-400/30 rounded flex items-center gap-2 text-flare-400 text-[13px]">
              <AlertTriangle size={18} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="font-sans text-[13px] text-vapor-400 font-medium">Nome da Oficina *</label>
              <Input
                type="text"
                placeholder="Ex: Studio Detailers SP"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                required
                disabled={loading}
                className="min-h-[48px]"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2 flex flex-col gap-1">
                <label className="font-sans text-[13px] text-vapor-400 font-medium">Cidade</label>
                <Input
                  type="text"
                  placeholder="São Paulo"
                  value={cidade}
                  onChange={(e) => setCidade(e.target.value)}
                  disabled={loading}
                  className="min-h-[48px]"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-sans text-[13px] text-vapor-400 font-medium">UF</label>
                <Input
                  type="text"
                  placeholder="SP"
                  maxLength={2}
                  value={uf}
                  onChange={(e) => setUf(e.target.value)}
                  disabled={loading}
                  className="min-h-[48px] uppercase"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="font-sans text-[13px] text-vapor-400 font-medium">Telefone / WhatsApp</label>
              <Input
                type="tel"
                placeholder="(11) 99999-9999"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                disabled={loading}
                className="min-h-[48px]"
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              disabled={loading}
              className="mt-2 min-h-[48px] w-full font-semibold"
            >
              {loading ? (
                'Criando oficina...'
              ) : (
                <>
                  <Building2 size={18} />
                  Concluir Cadastro
                </>
              )}
            </Button>
          </form>
        </Card>
      </div>
    </PublicLayout>
  );
};
