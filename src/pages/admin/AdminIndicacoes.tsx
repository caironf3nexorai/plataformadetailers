import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Gift, AlertTriangle, Search, CheckCircle2, XCircle, ShieldAlert, Clock } from 'lucide-react';

interface IndicacaoAdminItem {
  id: string;
  codigo: string;
  status: 'pendente' | 'convertida' | 'invalidada';
  motivo_invalidacao: string | null;
  created_at: string;
  indicador: {
    id: string;
    nome: string;
  } | null;
  indicado: {
    id: string;
    nome: string;
  } | null;
}

export const AdminIndicacoes: React.FC = () => {
  const { showSuccess, showError } = useToast();

  const [indicacoes, setIndicacoes] = useState<IndicacaoAdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');

  // Modal de Invalidação
  const [indicacaoParaInvalidar, setIndicacaoParaInvalidar] = useState<IndicacaoAdminItem | null>(null);
  const [motivoInvalidacao, setMotivoInvalidacao] = useState('');
  const [processando, setProcessando] = useState(false);

  const carregarIndicacoes = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('indicacoes')
        .select(`
          id,
          codigo,
          status,
          motivo_invalidacao,
          created_at,
          indicador:tenants!indicacoes_indicador_tenant_id_fkey(id, nome),
          indicado:tenants!indicacoes_indicado_tenant_id_fkey(id, nome)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setIndicacoes(data as any[]);
    } catch (err: any) {
      console.error('Erro ao carregar indicações:', err);
      showError('Erro ao carregar indicações');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarIndicacoes();
  }, []);

  const handleConfirmarInvalidacao = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!indicacaoParaInvalidar) return;

    if (!motivoInvalidacao.trim()) {
      showError('Informe o motivo da invalidação.');
      return;
    }

    setProcessando(true);
    try {
      const { error } = await supabase.rpc('admin_invalidar_indicacao', {
        p_indicacao_id: indicacaoParaInvalidar.id,
        p_motivo: motivoInvalidacao.trim(),
      });

      if (error) throw error;

      showSuccess('Indicação invalidada e estornos de -15 dias aplicados com sucesso!');
      setIndicacaoParaInvalidar(null);
      setMotivoInvalidacao('');
      await carregarIndicacoes();
    } catch (err: any) {
      console.error('Erro ao invalidar indicação:', err);
      showError(err.message || 'Erro ao invalidar indicação');
    } finally {
      setProcessando(false);
    }
  };

  const handleConverterManualmente = async (item: IndicacaoAdminItem) => {
    if (!confirm(`Confirma a conversão manual da indicação para ${item.indicado?.nome || 'a oficina indicada'}? O bônus de +15 dias será concedido ao indicador.`)) {
      return;
    }

    setProcessando(true);
    try {
      const { error } = await supabase.rpc('admin_converter_indicacao_manual', {
        p_indicacao_id: item.id,
      });

      if (error) throw error;

      showSuccess('Indicação convertida e bônus concedido ao indicador com sucesso!');
      await carregarIndicacoes();
    } catch (err: any) {
      console.error('Erro ao converter indicação:', err);
      showError(err.message || 'Erro ao converter indicação');
    } finally {
      setProcessando(false);
    }
  };

  const filtradas = indicacoes.filter((item) => {
    const termo = busca.toLowerCase();
    return (
      item.codigo?.toLowerCase().includes(termo) ||
      item.indicador?.nome?.toLowerCase().includes(termo) ||
      item.indicado?.nome?.toLowerCase().includes(termo)
    );
  });

  const totalConvertidas = indicacoes.filter((i) => i.status === 'convertida').length;
  const totalPendentes = indicacoes.filter((i) => i.status === 'pendente').length;
  const totalInvalidadas = indicacoes.filter((i) => i.status === 'invalidada').length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl text-vapor-100 uppercase tracking-wide flex items-center gap-2">
          <Gift className="text-amber-400" size={24} />
          Gestão de Indicações & Bônus
        </h1>
        <p className="font-sans text-sm text-vapor-400">
          Acompanhe todas as indicações, aprove conversões ou execute estornos auditados em caso de fraude.
        </p>
      </div>

      {/* Métricas Principais */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-5 bg-graphite-800 border-graphite-600">
          <span className="text-xs text-vapor-400 uppercase font-semibold block">Total de Indicações</span>
          <span className="text-2xl font-bold text-vapor-100 font-display">{indicacoes.length}</span>
        </Card>
        <Card className="p-5 bg-graphite-800 border-graphite-600">
          <span className="text-xs text-amber-400 uppercase font-semibold block">Aguardando Assinatura</span>
          <span className="text-2xl font-bold text-amber-400 font-display">{totalPendentes}</span>
        </Card>
        <Card className="p-5 bg-graphite-800 border-graphite-600">
          <span className="text-xs text-emerald-400 uppercase font-semibold block">Convertidas (Válidas)</span>
          <span className="text-2xl font-bold text-emerald-400 font-display">{totalConvertidas}</span>
        </Card>
        <Card className="p-5 bg-graphite-800 border-graphite-600">
          <span className="text-xs text-flare-400 uppercase font-semibold block">Invalidadas / Estornadas</span>
          <span className="text-2xl font-bold text-flare-400 font-display">{totalInvalidadas}</span>
        </Card>
      </div>

      {/* Barra de Busca */}
      <Card className="p-4 bg-graphite-800 border-graphite-600 flex items-center gap-3">
        <Search size={18} className="text-vapor-400 shrink-0" />
        <Input
          type="text"
          placeholder="Buscar por código ou nome de oficina..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="bg-graphite-900 border-graphite-700 text-vapor-100 placeholder-vapor-500"
        />
      </Card>

      {/* Tabela de Indicações */}
      <Card className="p-6 bg-graphite-800 border-graphite-600">
        {loading ? (
          <div className="py-8 text-center text-vapor-400 text-sm">Carregando indicações...</div>
        ) : filtradas.length === 0 ? (
          <div className="py-8 text-center text-vapor-400 text-sm">Nenhuma indicação encontrada.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-sans text-sm">
              <thead>
                <tr className="border-b border-graphite-700 text-vapor-400 text-xs font-semibold uppercase">
                  <th className="py-3 px-4">Código</th>
                  <th className="py-3 px-4">Indicador (Quem Convidou)</th>
                  <th className="py-3 px-4">Indicado (Nova Oficina)</th>
                  <th className="py-3 px-4">Data</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-graphite-700/50">
                {filtradas.map((item) => (
                  <tr key={item.id} className="hover:bg-graphite-700/30 transition">
                    <td className="py-3 px-4 font-mono font-bold text-amber-400">{item.codigo}</td>
                    <td className="py-3 px-4 font-medium text-vapor-100">{item.indicador?.nome || '—'}</td>
                    <td className="py-3 px-4 text-vapor-200">{item.indicado?.nome || '—'}</td>
                    <td className="py-3 px-4 text-vapor-400">
                      {new Date(item.created_at).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="py-3 px-4">
                      {item.status === 'convertida' ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                          <CheckCircle2 size={12} /> Convertida
                        </span>
                      ) : item.status === 'pendente' ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
                          <Clock size={12} /> Aguardando Assinatura
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-flare-400/10 text-flare-400 border border-flare-400/20 font-medium" title={item.motivo_invalidacao || ''}>
                          <XCircle size={12} /> Invalidada
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {item.status === 'pendente' && (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => handleConverterManualmente(item)}
                          disabled={processando}
                          className="text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-400/10"
                        >
                          <CheckCircle2 size={14} className="mr-1 inline" />
                          Aprovar Conversão
                        </Button>
                      )}
                      {item.status === 'convertida' && (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            setIndicacaoParaInvalidar(item);
                            setMotivoInvalidacao('');
                          }}
                          disabled={processando}
                          className="text-xs text-flare-400 hover:text-flare-300 hover:bg-flare-400/10"
                        >
                          <ShieldAlert size={14} className="mr-1 inline" />
                          Invalidar & Estornar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Modal de Invalidação Auditada */}
      {indicacaoParaInvalidar && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-graphite-800 border border-graphite-600 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-flare-400">
              <AlertTriangle size={24} />
              <h3 className="font-display text-lg text-vapor-100 uppercase tracking-wide">
                Invalidar Indicação
              </h3>
            </div>

            <p className="font-sans text-sm text-vapor-300">
              Esta ação cancelará a indicação entre <strong>{indicacaoParaInvalidar.indicador?.nome}</strong> e <strong>{indicacaoParaInvalidar.indicado?.nome}</strong> e lançará um <strong>estorno duplo de -15 dias</strong> em ambas as contas.
            </p>

            <form onSubmit={handleConfirmarInvalidacao} className="space-y-4">
              <div className="space-y-1">
                <label className="font-sans text-xs text-vapor-400 font-medium">Motivo da Invalidação *</label>
                <Input
                  type="text"
                  placeholder="Ex: Auto-indicação detectada / Fraude no cadastro"
                  value={motivoInvalidacao}
                  onChange={(e) => setMotivoInvalidacao(e.target.value)}
                  required
                  className="bg-graphite-900 border-graphite-700 text-vapor-100"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIndicacaoParaInvalidar(null)}
                  disabled={processando}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={processando}
                  className="bg-flare-500 hover:bg-flare-400 text-white border-none"
                >
                  {processando ? 'Invalidando...' : 'Confirmar Estorno Duplo'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
