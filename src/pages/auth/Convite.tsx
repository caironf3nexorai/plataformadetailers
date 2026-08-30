import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { PublicLayout } from '../../components/layout/PublicLayout';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { AlertTriangle, CheckCircle2, UserCheck } from 'lucide-react';
import { LogoNuvemWash } from '../../components/ui/LogoNuvemWash';

export const Convite: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, refetchTenantData } = useAuth();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [conviteInfo, setConviteInfo] = useState<{ email: string; tenantNome: string; role: string } | null>(null);

  useEffect(() => {
    const checkConvite = async () => {
      if (!token) {
        setErrorMsg('Link de convite inválido ou expirado.');
        setLoading(false);
        return;
      }

      try {
        // Usa a RPC security definer convite_info para consultar sem sofrer bloqueio da RLS
        const { data, error } = await supabase.rpc('convite_info', { p_token: token });

        if (error || !data || data.length === 0) {
          console.error('[Convite Info Error]:', error);
          setErrorMsg('Convite não encontrado ou token inválido.');
        } else {
          const info = data[0];
          if (!info.valido) {
            setErrorMsg('Este convite já foi utilizado ou expirou.');
          } else {
            setConviteInfo({
              email: info.email,
              tenantNome: info.oficina,
              role: info.role,
            });
          }
        }
      } catch (err: any) {
        console.error('[Convite Check Exception]:', err);
        setErrorMsg(err?.message || 'Erro ao carregar convite.');
      } finally {
        setLoading(false);
      }
    };

    checkConvite();
  }, [token]);

  const handleAceitarConvite = async () => {
    if (!token || !user) return;
    setLoading(true);
    setErrorMsg(null);

    try {
      // Chama a RPC security definer aceitar_convite para vincular o membro com privilégios elevados
      const { data: _tenantId, error } = await supabase.rpc('aceitar_convite', { p_token: token });

      if (error) {
        console.error('[Aceitar Convite RPC Error]:', error);
        setErrorMsg(error.message || 'Erro ao aceitar convite.');
        setLoading(false);
      } else {
        setSuccess(true);
        await refetchTenantData();
        setTimeout(() => {
          navigate('/');
        }, 1500);
      }
    } catch (err: any) {
      console.error('[Aceitar Convite Exception]:', err);
      setErrorMsg(err?.message || 'Erro ao processar convite.');
      setLoading(false);
    }
  };

  return (
    <PublicLayout>
      <div className="max-w-md mx-auto w-full flex flex-col gap-6 py-6">
        <div className="text-center flex flex-col items-center gap-3">
          <LogoNuvemWash size="lg" className="mb-1" />
          <h1 className="font-display text-[24px] sm:text-[28px] text-vapor-100 uppercase tracking-wide">
            Convite para Equipe
          </h1>
          <p className="font-sans text-[14px] text-vapor-400">
            Você foi convidado para fazer parte de uma equipe no NuvemWash
          </p>
        </div>

        <Card className="p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-4 shadow-xl text-center">
          {loading && (
            <p className="font-sans text-[14px] text-vapor-400 py-4">Verificando convite...</p>
          )}

          {errorMsg && (
            <div className="p-3 bg-flare-400/10 border border-flare-400/30 rounded flex items-center gap-2 text-flare-400 text-[13px] text-left">
              <AlertTriangle size={18} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {success && (
            <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded flex flex-col items-center gap-2 text-amber-500">
              <CheckCircle2 size={32} />
              <span className="font-sans text-[15px] font-semibold">Convite aceito com sucesso!</span>
              <span className="font-sans text-[13px] text-vapor-400">Redirecionando para a plataforma...</span>
            </div>
          )}

          {!loading && !success && conviteInfo && (
            <div className="flex flex-col gap-5">
              <div className="p-4 bg-graphite-700/60 border border-graphite-600 rounded-md flex flex-col items-center gap-2">
                <span className="font-sans text-[13px] text-vapor-400">Você foi convidado para a oficina:</span>
                <span className="font-display text-[20px] text-amber-500 font-bold">{conviteInfo.tenantNome}</span>
                <div className="flex items-center gap-2 mt-1">
                  <span className="font-sans text-[12px] text-vapor-400">Papel:</span>
                  <Badge tone="mint">{conviteInfo.role.toUpperCase()}</Badge>
                </div>
                <span className="font-mono text-[12px] text-vapor-400 mt-1">E-mail: {conviteInfo.email}</span>
              </div>

              {!user ? (
                <div className="flex flex-col gap-3">
                  <p className="font-sans text-[13px] text-vapor-400">
                    Entre ou crie sua conta para aceitar o convite.
                  </p>
                  <div className="flex flex-col gap-2">
                    <Link to={`/entrar?convite=${token}`}>
                      <Button type="button" variant="primary" className="w-full min-h-[48px]">
                        Entrar na minha conta
                      </Button>
                    </Link>
                    <Link to={`/criar-conta?convite=${token}`}>
                      <Button type="button" variant="secondary" className="w-full min-h-[48px]">
                        Criar nova conta
                      </Button>
                    </Link>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleAceitarConvite}
                  className="w-full min-h-[48px] font-semibold"
                >
                  <UserCheck size={18} />
                  Aceitar Convite e Entrar
                </Button>
              )}
            </div>
          )}
        </Card>
      </div>
    </PublicLayout>
  );
};
