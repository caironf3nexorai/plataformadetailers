import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { Gift, Copy, Share2, Award, Users, CheckCircle2, Clock, AlertTriangle, ShieldCheck, CreditCard } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

interface IndicacaoItem {
  id: string;
  created_at: string;
  status: 'pendente' | 'convertida' | 'invalidada';
  convertida_em: string | null;
  indicado: {
    nome: string;
  } | null;
}

export const AbaIndiqueEGanhe: React.FC = () => {
  const { showSuccess, showError } = useToast();

  const [codigoIndicacao, setCodigoIndicacao] = useState<string>('');
  const [diasAcumulados, setDiasAcumulados] = useState<number>(0);
  const [totalConvertidos, setTotalConvertidos] = useState<number>(0);
  const [totalPendentes, setTotalPendentes] = useState<number>(0);
  const [indicacoesLista, setIndicacoesLista] = useState<IndicacaoItem[]>([]);
  const [faixasConquistadas, setFaixasConquistadas] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  const carregarDados = async () => {
    setLoading(true);
    try {
      // 1. Obter tenant atual e código de indicação
      const { data: tenantData, error: errTenant } = await supabase
        .from('tenants')
        .select('id, codigo_indicacao')
        .single();

      if (errTenant) throw errTenant;
      setCodigoIndicacao(tenantData?.codigo_indicacao || '');

      const tenantId = tenantData?.id;
      if (!tenantId) return;

      // 2. Obter total de dias acumulados em creditos_dias
      const { data: dataCreditos, error: errCreditos } = await supabase
        .from('creditos_dias')
        .select('dias')
        .eq('tenant_id', tenantId);

      if (!errCreditos && dataCreditos) {
        const total = dataCreditos.reduce((acc, curr) => acc + (curr.dias || 0), 0);
        setDiasAcumulados(total);
      }

      // 3. Obter lista completa de indicações (pendentes, convertidas e invalidadas)
      const { data: dataIndicacoes, error: errIndicacoes } = await supabase
        .from('indicacoes')
        .select(`
          id,
          created_at,
          status,
          convertida_em,
          indicado:tenants!indicacoes_indicado_tenant_id_fkey(nome)
        `)
        .eq('indicador_tenant_id', tenantId)
        .order('created_at', { ascending: false });

      if (!errIndicacoes && dataIndicacoes) {
        const lista: IndicacaoItem[] = (dataIndicacoes as any[]).map((i) => ({
          id: i.id,
          created_at: i.created_at,
          status: i.status,
          convertida_em: i.convertida_em,
          indicado: Array.isArray(i.indicado) ? i.indicado[0] || null : i.indicado,
        }));
        setIndicacoesLista(lista);
        setTotalConvertidos(lista.filter((i) => i.status === 'convertida').length);
        setTotalPendentes(lista.filter((i) => i.status === 'pendente').length);
      }

      // 4. Obter faixas de metas conquistadas
      const { data: dataMetas, error: errMetas } = await supabase
        .from('quadro_metas_concedidas')
        .select('faixa')
        .eq('tenant_id', tenantId);

      if (!errMetas && dataMetas) {
        setFaixasConquistadas(dataMetas.map((m) => m.faixa));
      }
    } catch (err: any) {
      console.error('Erro ao carregar dados do Indique e Ganhe:', err);
      showError('Erro ao carregar dados de indicação');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarDados();
  }, []);

  const linkConvite = `${window.location.origin}/convite/${codigoIndicacao}`;

  const handleCopiarLink = () => {
    navigator.clipboard.writeText(linkConvite);
    showSuccess('Link de convite copiado para a área de transferência!');
  };

  const handleCompartilharWhatsApp = () => {
    const texto = encodeURIComponent(
      `Olá! Estou usando a NuvemWash na minha estética automotiva e recomendo muito! Cadastre-se pelo meu link exclusivo e ganhe 15 dias extras de bônus além da degustação grátis:\n\n${linkConvite}`
    );
    window.open(`https://api.whatsapp.com/send?text=${texto}`, '_blank');
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-vapor-400 font-sans">
        Carregando informações do Programa Indique e Ganhe...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header Banner */}
      <div className="p-5 sm:p-6 bg-gradient-to-r from-amber-500/10 via-amber-600/5 to-transparent border border-amber-500/20 rounded-2xl flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 overflow-hidden min-w-0 w-full">
        <div className="flex items-start sm:items-center gap-3 sm:gap-4 flex-1 min-w-0">
          <div className="w-12 h-12 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
            <Gift size={24} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-lg sm:text-xl text-vapor-100 uppercase tracking-wide">
              Indique Amigos & Ganhe Dias Grátis
            </h2>
            <p className="font-sans text-xs sm:text-sm text-vapor-400 leading-relaxed">
              Seu amigo ganha <strong>14 dias grátis</strong> ao se cadastrar. Quando ele <strong>assinar um plano pago</strong>, você ganha <strong>+15 dias de uso Pro</strong> e avança no Quadro de Metas!
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
          <Button
            type="button"
            variant="secondary"
            onClick={handleCopiarLink}
            className="flex-1 sm:flex-none shrink-0 flex items-center justify-center gap-2"
          >
            <Copy size={16} />
            <span>Copiar Link</span>
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleCompartilharWhatsApp}
            className="flex-1 sm:flex-none shrink-0 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white border-none"
          >
            <Share2 size={16} />
            <span>WhatsApp</span>
          </Button>
        </div>
      </div>

      {/* Cards de Métricas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card className="p-4 sm:p-5 bg-graphite-800 border-graphite-600 flex items-center gap-3 sm:gap-4 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
            <Clock size={20} />
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="font-sans text-[11px] text-vapor-400 font-semibold uppercase tracking-wider truncate" title="Dias Acumulados">
              Dias Acumulados
            </span>
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span className="font-display text-2xl text-amber-400 font-bold">
                +{diasAcumulados}
              </span>
              <span className="font-sans text-xs text-vapor-300 font-medium">dias</span>
            </div>
          </div>
        </Card>

        <Card className="p-4 sm:p-5 bg-graphite-800 border-graphite-600 flex items-center gap-3 sm:gap-4 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
            <CheckCircle2 size={20} />
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="font-sans text-[11px] text-vapor-400 font-semibold uppercase tracking-wider truncate" title="Assinaturas Convertidas">
              Assinaturas Convertidas
            </span>
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span className="font-display text-2xl text-emerald-400 font-bold">
                {totalConvertidos}
              </span>
              <span className="font-sans text-xs text-vapor-300 font-medium">pagante(s)</span>
            </div>
          </div>
        </Card>

        <Card className="p-4 sm:p-5 bg-graphite-800 border-graphite-600 flex items-center gap-3 sm:gap-4 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center text-yellow-400 shrink-0">
            <Users size={20} />
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="font-sans text-[11px] text-vapor-400 font-semibold uppercase tracking-wider truncate" title="Aguardando Assinatura">
              Aguardando Assinatura
            </span>
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span className="font-display text-2xl text-yellow-400 font-bold">
                {totalPendentes}
              </span>
              <span className="font-sans text-xs text-vapor-300 font-medium">em degustação</span>
            </div>
          </div>
        </Card>

        <Card className="p-4 sm:p-5 bg-graphite-800 border-graphite-600 flex items-center gap-3 sm:gap-4 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
            <Award size={20} />
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="font-sans text-[11px] text-vapor-400 font-semibold uppercase tracking-wider truncate" title="Seu Código Curto">
              Seu Código Curto
            </span>
            <span className="font-mono text-lg sm:text-xl text-amber-400 font-bold tracking-wider truncate">
              {codigoIndicacao || '—'}
            </span>
          </div>
        </Card>
      </div>

      {/* Quadro de Metas Progressivas */}
      <Card className="p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Award className="text-amber-400" size={20} />
            <h3 className="font-display text-lg text-vapor-100 uppercase tracking-wide">
              Quadro de Metas Extra
            </h3>
          </div>
          <span className="font-sans text-xs text-vapor-400">
            Bônus concedido ao atingir cada marca de oficinas assinantes
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
          {/* Meta 5 */}
          <div
            className={`p-4 rounded-xl border flex flex-col justify-between gap-3 ${
              faixasConquistadas.includes(5)
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                : 'bg-graphite-900 border-graphite-700 text-vapor-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm">5 Assinaturas</span>
              {faixasConquistadas.includes(5) ? (
                <span className="flex items-center gap-1 text-xs text-emerald-400 font-semibold">
                  <CheckCircle2 size={14} /> Conquistado
                </span>
              ) : (
                <span className="text-xs text-vapor-400">
                  {totalConvertidos}/5
                </span>
              )}
            </div>
            <div>
              <span className="font-display text-xl font-bold block text-amber-400">
                +30 Dias Bônus
              </span>
              <span className="text-xs text-vapor-400">
                Concede +30 dias ao atingir 5 oficinas com assinatura ativa
              </span>
            </div>
          </div>

          {/* Meta 10 */}
          <div
            className={`p-4 rounded-xl border flex flex-col justify-between gap-3 ${
              faixasConquistadas.includes(10)
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                : 'bg-graphite-900 border-graphite-700 text-vapor-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm">10 Assinaturas</span>
              {faixasConquistadas.includes(10) ? (
                <span className="flex items-center gap-1 text-xs text-emerald-400 font-semibold">
                  <CheckCircle2 size={14} /> Conquistado
                </span>
              ) : (
                <span className="text-xs text-vapor-400">
                  {totalConvertidos}/10
                </span>
              )}
            </div>
            <div>
              <span className="font-display text-xl font-bold block text-amber-400">
                +30 Dias Bônus
              </span>
              <span className="text-xs text-vapor-400">
                Concede +30 dias ao atingir 10 oficinas (+60d total em metas)
              </span>
            </div>
          </div>

          {/* Meta 15 */}
          <div
            className={`p-4 rounded-xl border flex flex-col justify-between gap-3 ${
              faixasConquistadas.includes(15)
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                : 'bg-graphite-900 border-graphite-700 text-vapor-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm">15 Assinaturas</span>
              {faixasConquistadas.includes(15) ? (
                <span className="flex items-center gap-1 text-xs text-emerald-400 font-semibold">
                  <CheckCircle2 size={14} /> Conquistado
                </span>
              ) : (
                <span className="text-xs text-vapor-400">
                  {totalConvertidos}/15
                </span>
              )}
            </div>
            <div>
              <span className="font-display text-xl font-bold block text-amber-400">
                +30 Dias Bônus
              </span>
              <span className="text-xs text-vapor-400">
                Concede +30 dias ao atingir 15 oficinas (+90d total em metas)
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* Histórico das Oficinas Indicadas */}
      <Card className="p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg text-vapor-100 uppercase tracking-wide">
            Oficinas Entradas Pelo Seu Link
          </h3>
          <span className="font-sans text-xs text-vapor-400">
            Acompanhe o status de conversão de cada convite enviado
          </span>
        </div>

        {indicacoesLista.length === 0 ? (
          <div className="py-8 text-center text-vapor-400 text-sm font-sans bg-graphite-900/50 rounded-xl border border-graphite-700">
            Você ainda não possui oficinas indicadas. Compartilhe seu código <strong className="text-amber-400">{codigoIndicacao}</strong> e comece a ganhar dias grátis!
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-sans text-sm">
              <thead>
                <tr className="border-b border-graphite-700 text-vapor-400 text-xs font-semibold uppercase">
                  <th className="py-3 px-4">Nome da Oficina</th>
                  <th className="py-3 px-4">Data do Cadastro</th>
                  <th className="py-3 px-4">Status da Indicação</th>
                  <th className="py-3 px-4 text-right">Seu Bônus</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-graphite-700/50">
                {indicacoesLista.map((item) => (
                  <tr key={item.id} className="hover:bg-graphite-700/30 transition">
                    <td className="py-3 px-4 font-medium text-vapor-100">
                      {item.indicado?.nome || 'Oficina Registrada'}
                    </td>
                    <td className="py-3 px-4 text-vapor-400">
                      {new Date(item.created_at).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="py-3 px-4">
                      {item.status === 'convertida' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                          <CheckCircle2 size={13} /> Assinatura Confirmada
                        </span>
                      ) : item.status === 'pendente' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
                          <Clock size={13} /> Aguardando Assinatura
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-flare-400/10 text-flare-400 border border-flare-400/20 font-medium">
                          <AlertTriangle size={13} /> Invalidada
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-semibold">
                      {item.status === 'convertida' ? (
                        <span className="text-emerald-400 font-mono">+15 Dias Liberados</span>
                      ) : (
                        <span className="text-vapor-500 text-xs font-normal">Pendente</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Regras e Política do Programa */}
      <Card className="p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-4">
        <div className="flex items-center gap-2 text-vapor-100">
          <ShieldCheck size={20} className="text-amber-400" />
          <h3 className="font-display text-lg uppercase tracking-wide">
            Como Funciona o Programa de Indicação?
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-sans text-sm text-vapor-300 mt-1">
          <div className="p-4 rounded-xl bg-graphite-900/60 border border-graphite-700/60 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
              <Gift size={16} />
              <span>1. Convite com Degustação Grátis</span>
            </div>
            <p className="text-xs text-vapor-400 leading-relaxed">
              Sua oficina amiga se cadastra pelo seu link exclusivo e ganha <strong>14 dias grátis</strong> de degustação Pro para experimentar todos os recursos da plataforma.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-graphite-900/60 border border-graphite-700/60 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
              <CreditCard size={16} />
              <span>2. Liberação do Bônus do Indicador</span>
            </div>
            <p className="text-xs text-vapor-400 leading-relaxed">
              O seu bônus de <strong>+15 dias extras de uso Pro</strong> (e a pontuação para o Quadro de Metas) é ativado automaticamente assim que a oficina indicada assinar um plano pago da NuvemWash.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-graphite-900/60 border border-graphite-700/60 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-blue-400 font-semibold text-sm">
              <ShieldCheck size={16} />
              <span>3. Política de Não-Estorno de Bônus</span>
            </div>
            <p className="text-xs text-vapor-400 leading-relaxed">
              Caso a oficina indicada venha a cancelar sua assinatura no futuro, os dias grátis que você já conquistou <strong>permanecem mantidos</strong> na sua conta. O bônus concedido não é estornado após a conversão.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-graphite-900/60 border border-graphite-700/60 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-yellow-400 font-semibold text-sm">
              <Award size={16} />
              <span>4. Metas Acumulativas e Limites</span>
            </div>
            <p className="text-xs text-vapor-400 leading-relaxed">
              Acumule assinaturas convertidas para desbloquear +30d, +60d e +90d extras. Cada oficina pode converter até 50 indicações por mês para garantir o crescimento sustentável da comunidade.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
};
