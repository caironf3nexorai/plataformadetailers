import React, { useEffect, useState } from 'react';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { MessageSquare, AlertTriangle, Lightbulb, Heart, Star, CheckCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface MeuFeedback {
  id: string;
  tipo: 'erro' | 'sugestao' | 'elogio';
  mensagem: string;
  tela_origem?: string;
  status: 'novo' | 'em_analise' | 'resolvido' | 'descartado';
  premiado: boolean;
  resposta_admin?: string;
  respondido_em?: string;
  created_at: string;
}

export const AbaFeedbacks: React.FC = () => {
  const { tenant } = useAuth();
  const [feedbacks, setFeedbacks] = useState<MeuFeedback[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMeusFeedbacks = async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('feedbacks')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false });

      if (!error && data) {
        setFeedbacks(data as MeuFeedback[]);
      }
    } catch (err) {
      console.error('[AbaFeedbacks Load Error]:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMeusFeedbacks();
  }, [tenant?.id]);

  const getTipoIcon = (tipo: string) => {
    switch (tipo) {
      case 'erro':
        return <AlertTriangle className="w-4 h-4 text-flare-400" />;
      case 'sugestao':
        return <Lightbulb className="w-4 h-4 text-amber-400" />;
      case 'elogio':
        return <Heart className="w-4 h-4 text-emerald-400" />;
      default:
        return <MessageSquare className="w-4 h-4 text-vapor-400" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'novo':
        return <Badge tone="amber">Recebido</Badge>;
      case 'em_analise':
        return <Badge tone="vapor">Em Análise</Badge>;
      case 'resolvido':
        return <Badge tone="mint">Resolvido</Badge>;
      case 'descartado':
        return <Badge tone="vapor">Arquivado</Badge>;
      default:
        return null;
    }
  };

  return (
    <Card className="p-6 bg-graphite-900 border-graphite-800 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg font-bold text-vapor-100 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-amber-500" />
            Meus Feedbacks e Chamados
          </h3>
          <p className="text-xs text-vapor-400 mt-0.5">
            Acompanhe as respostas da equipe da plataforma aos seus elogios, dúvidas e sugestões.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-vapor-400 font-mono text-xs">Carregando históricos de feedbacks...</div>
      ) : feedbacks.length === 0 ? (
        <div className="p-8 text-center text-vapor-400 text-xs bg-graphite-950 rounded-lg border border-graphite-800">
          Você ainda não enviou nenhum feedback. Use o botão flutuante no canto inferior direito para nos enviar uma sugestão!
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {feedbacks.map((item) => (
            <div
              key={item.id}
              className="p-4 rounded-lg bg-graphite-950 border border-graphite-800 flex flex-col gap-3"
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  {getTipoIcon(item.tipo)}
                  <span className="font-bold text-xs text-vapor-100 capitalize">{item.tipo}</span>
                  {getStatusBadge(item.status)}
                  {item.premiado && (
                    <span className="bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1">
                      <Star className="w-3 h-3 fill-amber-400 text-amber-400" /> Destaque
                    </span>
                  )}
                </div>
                <span className="font-mono text-[11px] text-vapor-400">
                  {new Date(item.created_at).toLocaleString('pt-BR')}
                </span>
              </div>

              <p className="text-xs text-vapor-200 font-sans whitespace-pre-wrap">"{item.mensagem}"</p>

              {item.resposta_admin && (
                <div className="p-3 rounded bg-graphite-900 border border-amber-500/30 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-amber-400 flex items-center gap-1">
                      <CheckCircle className="w-3.5 h-3.5 text-amber-400" /> Resposta da Plataforma:
                    </span>
                    {item.respondido_em && (
                      <span className="font-mono text-[10px] text-vapor-400">
                        {new Date(item.respondido_em).toLocaleString('pt-BR')}
                      </span>
                    )}
                  </div>
                  <p className="text-vapor-200 italic font-sans">"{item.resposta_admin}"</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};
