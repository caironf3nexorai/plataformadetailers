import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { AdesivoParabrisaModal } from '../garantia/AdesivoParabrisaModal';
import { ModalRegistrarRevisao } from '../garantia/ModalRegistrarRevisao';
import { formatarData } from '../../utils/datas';
import { montarLinkWhatsapp } from '../../utils/whatsapp';
import {
  ShieldCheck,
  Search,
  Car,
  Clock,
  Sparkles,
  MessageCircle,
  Printer,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  Check,
  Copy,
  History,
  Phone,
  RotateCcw,
  Award
} from 'lucide-react';

interface GarantiaItem {
  id: string;
  codigo: string;
  agendamento_id?: string | null;
  servico_nome: string;
  produto_aplicado?: string | null;
  garantia_meses: number;
  intervalo_manutencao_dias: number;
  data_aplicacao: string;
  data_vencimento: string;
  observacoes?: string | null;
  status: 'ativo' | 'manutencao_pendente' | 'expirado' | 'cancelado';
  created_at: string;
  cliente?: {
    id: string;
    nome: string;
    telefone: string;
    documento?: string | null;
  } | null;
  veiculo?: {
    id: string;
    marca: string;
    modelo: string;
    placa: string;
    cor?: string | null;
    ano?: number | null;
  } | null;
  manutencoes?: Array<{
    id: string;
    numero_revisao: number;
    data_realizada: string;
    observacao?: string | null;
  }>;
  // Campos calculados
  diasRestantes: number;
  proximaRevisaoData: string;
  proximaRevisaoDias: number;
  statusCalculado: 'ativo' | 'revisao_pendente' | 'revisao_proxima' | 'expirado' | 'cancelado';
  totalRevisoes: number;
}

interface AbaGarantiasProps {
  onTotalGarantiasChange?: (total: number) => void;
}

export const AbaGarantias: React.FC<AbaGarantiasProps> = ({ onTotalGarantiasChange }) => {
  const { tenant } = useAuth();
  const [garantias, setGarantias] = useState<GarantiaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<'todas' | 'ativas' | 'pendentes' | 'vencidas'>('todas');
  const [copiadoId, setCopiadoId] = useState<string | null>(null);

  // Modais
  const [adesivoModalItem, setAdesivoModalItem] = useState<GarantiaItem | null>(null);
  const [revisaoModalItem, setRevisaoModalItem] = useState<GarantiaItem | null>(null);

  const carregarGarantias = async () => {
    if (!tenant?.id) return;
    setLoading(true);

    try {
      const { data, error } = await supabase
        .from('certificados_garantia')
        .select(`
          *,
          cliente:clientes(id, nome, telefone, documento),
          veiculo:veiculos(id, marca, modelo, placa, cor, ano),
          manutencoes:certificado_manutencoes(id, numero_revisao, data_realizada, observacao)
        `)
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);

      const listaTratada: GarantiaItem[] = ((data as any[]) || []).map((item) => {
        const dataVenc = new Date(item.data_vencimento + 'T12:00:00');
        const dataAplic = new Date(item.data_aplicacao + 'T12:00:00');
        const diasRestantes = Math.ceil((dataVenc.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));

        // Determina a última revisão feita
        const manutencoes = item.manutencoes || [];
        manutencoes.sort((a: any, b: any) => new Date(b.data_realizada).getTime() - new Date(a.data_realizada).getTime());
        const ultimaRevisao = manutencoes[0];

        // Próxima revisão
        const baseCalculo = ultimaRevisao
          ? new Date(ultimaRevisao.data_realizada + 'T12:00:00')
          : dataAplic;

        const proxRevDate = new Date(baseCalculo);
        proxRevDate.setDate(proxRevDate.getDate() + (item.intervalo_manutencao_dias || 60));
        const proximaRevisaoDias = Math.ceil((proxRevDate.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
        const proximaRevisaoData = proxRevDate.toISOString().split('T')[0];

        // Status calculado
        let statusCalc: GarantiaItem['statusCalculado'] = 'ativo';
        if (item.status === 'cancelado') {
          statusCalc = 'cancelado';
        } else if (diasRestantes <= 0) {
          statusCalc = 'expirado';
        } else if (proximaRevisaoDias < 0) {
          statusCalc = 'revisao_pendente';
        } else if (proximaRevisaoDias <= 30) {
          statusCalc = 'revisao_proxima';
        } else {
          statusCalc = 'ativo';
        }

        return {
          ...item,
          diasRestantes,
          proximaRevisaoData,
          proximaRevisaoDias,
          statusCalculado: statusCalc,
          totalRevisoes: manutencoes.length,
          manutencoes
        };
      });

      setGarantias(listaTratada);

      if (onTotalGarantiasChange) {
        onTotalGarantiasChange(listaTratada.length);
      }
    } catch (err) {
      console.error('Erro ao carregar certificados de garantia:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarGarantias();
  }, [tenant?.id]);

  const handleCopiarLink = async (codigo: string) => {
    const url = `${window.location.origin}/garantia/${codigo}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiadoId(codigo);
      setTimeout(() => setCopiadoId(null), 2500);
    } catch {
      // fallback
    }
  };

  const handleEnviarWhatsApp = (item: GarantiaItem) => {
    if (!item.cliente?.telefone) {
      alert('Cliente sem telefone cadastrado.');
      return;
    }

    const primeiroNome = item.cliente.nome.split(' ')[0];
    const urlCertificado = `${window.location.origin}/garantia/${item.codigo}`;
    const veiculoNome = `${item.veiculo?.modelo || 'Veículo'}${item.veiculo?.placa ? ` (${item.veiculo.placa})` : ''}`;

    let texto = '';
    if (item.statusCalculado === 'revisao_pendente') {
      texto = `Olá ${primeiroNome}! Tudo bem?\n\nPassando aqui da *${tenant?.nome || 'Nossa Oficina'}* para lembrar que a revisão periódica da garantia de *${item.servico_nome}* do seu *${veiculoNome}* está no período de manutenção!\n\nA revisão é rápida e essencial para manter o brilho e a hidrorrepelência máxima da proteção.\n\n🛡️ Seu Certificado Oficial:\n${urlCertificado}\n\nPodemos agendar sua revisão para esta semana?`;
    } else if (item.statusCalculado === 'revisao_proxima') {
      texto = `Olá ${primeiroNome}! Tudo bem?\n\nPassando aqui da *${tenant?.nome || 'Nossa Oficina'}* para lembrar que em breve chega a data da revisão preventiva da garantia de *${item.servico_nome}* do seu *${veiculoNome}*.\n\n🛡️ Seu Certificado Oficial:\n${urlCertificado}\n\nQual dia fica melhor para fazermos essa manutenção?`;
    } else {
      texto = `Olá ${primeiroNome}! Tudo bem?\n\nSegue o link do seu *Certificado Digital de Garantia* da *${item.servico_nome}* realizada no seu *${veiculoNome}* aqui na *${tenant?.nome || 'Nossa Oficina'}*:\n\n🛡️ Acesse seu Certificado e instruções de cuidados:\n${urlCertificado}\n\nQualquer dúvida estamos à disposição!`;
    }

    const link = montarLinkWhatsapp(item.cliente.telefone, texto);
    if (link) {
      window.open(link, '_blank');
    }
  };

  // Métricas
  const totalAtivas = garantias.filter((g) => g.statusCalculado === 'ativo' || g.statusCalculado === 'revisao_proxima').length;
  const totalPendentes = garantias.filter((g) => g.statusCalculado === 'revisao_pendente').length;
  const totalVencidas = garantias.filter((g) => g.statusCalculado === 'expirado').length;
  const veiculosUnicos = new Set(garantias.map((g) => g.veiculo?.placa).filter(Boolean)).size;

  // Filtros
  const garantiasFiltradas = garantias.filter((g) => {
    // Filtro de status
    if (filtroStatus === 'ativas' && g.statusCalculado !== 'ativo' && g.statusCalculado !== 'revisao_proxima') return false;
    if (filtroStatus === 'pendentes' && g.statusCalculado !== 'revisao_pendente') return false;
    if (filtroStatus === 'vencidas' && g.statusCalculado !== 'expirado') return false;

    // Filtro de busca
    if (!busca.trim()) return true;
    const q = busca.toLowerCase();
    return (
      g.codigo.toLowerCase().includes(q) ||
      g.cliente?.nome.toLowerCase().includes(q) ||
      g.cliente?.telefone.includes(q) ||
      g.veiculo?.modelo.toLowerCase().includes(q) ||
      g.veiculo?.placa.toLowerCase().includes(q) ||
      g.servico_nome.toLowerCase().includes(q) ||
      (g.produto_aplicado && g.produto_aplicado.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-5">
      {/* 1. CARDS DE RESUMO & MÉTRICAS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Ativas */}
        <div className="bg-graphite-900 border border-emerald-500/20 rounded-xl p-4 flex items-center justify-between shadow-sm">
          <div className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-emerald-400" />
              Garantias Ativas
            </span>
            <div className="text-2xl font-black text-white font-mono">{totalAtivas}</div>
            <p className="text-[10px] text-vapor-400">Proteções vigentes e em dia</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <CheckCircle2 size={20} />
          </div>
        </div>

        {/* Revisão Pendente */}
        <div className="bg-graphite-900 border border-amber-500/30 rounded-xl p-4 flex items-center justify-between shadow-sm">
          <div className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
              <Clock size={14} className="text-amber-400" />
              Revisão Pendente
            </span>
            <div className="text-2xl font-black text-amber-300 font-mono">{totalPendentes}</div>
            <p className="text-[10px] text-vapor-400">Necessitam retorno de manutenção</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <AlertCircle size={20} />
          </div>
        </div>

        {/* Veículos Protegidos */}
        <div className="bg-graphite-900 border border-graphite-700 rounded-xl p-4 flex items-center justify-between shadow-sm">
          <div className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-vapor-300 flex items-center gap-1.5">
              <Car size={14} className="text-vapor-400" />
              Veículos Protegidos
            </span>
            <div className="text-2xl font-black text-white font-mono">{veiculosUnicos}</div>
            <p className="text-[10px] text-vapor-400">Carros com selo da sua oficina</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-graphite-800 border border-graphite-700 flex items-center justify-center text-vapor-300">
            <Award size={20} />
          </div>
        </div>

        {/* Vencidas / Expiradas */}
        <div className="bg-graphite-900 border border-graphite-800 rounded-xl p-4 flex items-center justify-between shadow-sm">
          <div className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-vapor-400 flex items-center gap-1.5">
              <History size={14} className="text-vapor-500" />
              Garantias Expiradas
            </span>
            <div className="text-2xl font-black text-vapor-300 font-mono">{totalVencidas}</div>
            <p className="text-[10px] text-vapor-400">Oportunidade para nova aplicação</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-graphite-800/80 border border-graphite-700 flex items-center justify-center text-vapor-400">
            <RotateCcw size={20} />
          </div>
        </div>
      </div>

      {/* 2. BARRA DE FERRAMENTAS E FILTROS */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-graphite-900/60 p-3 rounded-xl border border-graphite-800">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          <button
            type="button"
            onClick={() => setFiltroStatus('todas')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition border ${
              filtroStatus === 'todas'
                ? 'bg-amber-500 text-slate-950 border-amber-500 font-bold shadow-sm'
                : 'bg-graphite-800 text-vapor-300 border-graphite-700 hover:text-white'
            }`}
          >
            Todas ({garantias.length})
          </button>

          <button
            type="button"
            onClick={() => setFiltroStatus('ativas')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition border flex items-center gap-1.5 ${
              filtroStatus === 'ativas'
                ? 'bg-emerald-500 text-slate-950 border-emerald-500 font-bold shadow-sm'
                : 'bg-graphite-800 text-vapor-300 border-graphite-700 hover:text-emerald-400'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>Ativas ({totalAtivas})</span>
          </button>

          <button
            type="button"
            onClick={() => setFiltroStatus('pendentes')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition border flex items-center gap-1.5 ${
              filtroStatus === 'pendentes'
                ? 'bg-amber-500 text-slate-950 border-amber-500 font-bold shadow-sm'
                : 'bg-graphite-800 text-vapor-300 border-graphite-700 hover:text-amber-400'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span>Revisão Pendente ({totalPendentes})</span>
          </button>

          <button
            type="button"
            onClick={() => setFiltroStatus('vencidas')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition border ${
              filtroStatus === 'vencidas'
                ? 'bg-rose-500 text-white border-rose-500 font-bold shadow-sm'
                : 'bg-graphite-800 text-vapor-300 border-graphite-700 hover:text-rose-400'
            }`}
          >
            Vencidas ({totalVencidas})
          </button>
        </div>

        {/* Busca */}
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-vapor-400" size={16} />
          <input
            type="text"
            placeholder="Buscar por placa, cliente, código GAR ou serviço..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-graphite-800 border border-graphite-700 rounded-lg text-xs text-vapor-100 placeholder:text-vapor-500 focus:outline-none focus:border-amber-500"
          />
        </div>
      </div>

      {/* 3. LISTA DE GARANTIAS */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="p-5 bg-graphite-800 border-graphite-700 animate-pulse flex flex-col gap-3">
              <div className="h-5 bg-graphite-700 rounded w-1/2" />
              <div className="h-4 bg-graphite-700 rounded w-3/4" />
              <div className="h-10 bg-graphite-700 rounded w-full mt-2" />
            </Card>
          ))}
        </div>
      ) : garantiasFiltradas.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck size={48} className="text-vapor-500" strokeWidth={1.5} />}
          title={
            busca
              ? 'Nenhum certificado encontrado para esta busca.'
              : filtroStatus !== 'todas'
              ? 'Nenhum certificado com este status.'
              : 'Nenhum certificado de garantia emitido ainda.'
          }
          description={
            busca
              ? 'Tente buscar por outro termo, placa ou código.'
              : 'Os certificados são emitidos na finalização de atendimentos com serviços de vitrificação e proteção.'
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {garantiasFiltradas.map((item) => {
            const isPendente = item.statusCalculado === 'revisao_pendente';
            const isExpirado = item.statusCalculado === 'expirado';
            const isProxima = item.statusCalculado === 'revisao_proxima';

            return (
              <Card
                key={item.id}
                className={`p-5 bg-graphite-900 border transition-all flex flex-col justify-between gap-4 ${
                  isPendente
                    ? 'border-amber-500/40 shadow-lg shadow-amber-500/5'
                    : isExpirado
                    ? 'border-graphite-800 opacity-90'
                    : 'border-graphite-700/80 hover:border-graphite-600'
                }`}
              >
                {/* Topo do Card: Código & Status */}
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                        <ShieldCheck size={20} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                            {item.codigo}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopiarLink(item.codigo)}
                            className="text-vapor-400 hover:text-vapor-100 text-[10px] flex items-center gap-1 transition-colors"
                            title="Copiar link público do certificado"
                          >
                            {copiadoId === item.codigo ? (
                              <Check size={13} className="text-mint-400" />
                            ) : (
                              <Copy size={13} />
                            )}
                          </button>
                        </div>
                        <h4 className="font-display font-extrabold text-sm text-vapor-100 mt-1 leading-tight">
                          {item.servico_nome}
                        </h4>
                      </div>
                    </div>

                    {/* Badge de Status */}
                    {isExpirado ? (
                      <span className="px-2 py-0.5 rounded-md font-mono text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                        Expirado
                      </span>
                    ) : isPendente ? (
                      <span className="px-2 py-0.5 rounded-md font-mono text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse flex items-center gap-1">
                        <Clock size={11} />
                        Revisão Pendente
                      </span>
                    ) : isProxima ? (
                      <span className="px-2 py-0.5 rounded-md font-mono text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        Revisão Próxima
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-md font-mono text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                        <CheckCircle2 size={11} />
                        Garantia Ativa
                      </span>
                    )}
                  </div>

                  {/* Detalhes: Veículo & Cliente */}
                  <div className="grid grid-cols-2 gap-3 p-3 bg-graphite-950/70 rounded-xl border border-graphite-800/80">
                    <div>
                      <span className="text-[9px] uppercase tracking-wider font-extrabold text-vapor-400 block mb-0.5">
                        Veículo & Placa
                      </span>
                      <div className="text-xs font-bold text-vapor-100 truncate">
                        {item.veiculo?.modelo || 'Veículo'}
                      </div>
                      <span className="inline-block px-1.5 py-0.5 mt-0.5 rounded font-mono text-[10.5px] font-bold bg-graphite-800 border border-graphite-700 text-amber-300">
                        {item.veiculo?.placa || 'Sem placa'}
                      </span>
                    </div>

                    <div>
                      <span className="text-[9px] uppercase tracking-wider font-extrabold text-vapor-400 block mb-0.5">
                        Cliente
                      </span>
                      <div className="text-xs font-bold text-vapor-100 truncate">
                        {item.cliente?.nome || 'Cliente não vinculado'}
                      </div>
                      {item.cliente?.telefone && (
                        <span className="text-[10.5px] text-vapor-400 font-mono flex items-center gap-1 mt-0.5">
                          <Phone size={10} className="text-amber-500" />
                          {item.cliente.telefone}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Produto & Datas */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-1 border-t border-graphite-800">
                    {item.produto_aplicado ? (
                      <div>
                        <span className="text-[9px] uppercase tracking-wider font-bold text-vapor-400 block">
                          Produto Aplicado
                        </span>
                        <span className="font-mono text-xs font-bold text-amber-400">
                          {item.produto_aplicado}
                        </span>
                      </div>
                    ) : (
                      <div>
                        <span className="text-[9px] uppercase tracking-wider font-bold text-vapor-400 block">
                          Duração
                        </span>
                        <span className="font-mono text-xs text-vapor-300">
                          {item.garantia_meses} meses
                        </span>
                      </div>
                    )}

                    <div className="text-right">
                      <span className="text-[9px] uppercase tracking-wider font-bold text-vapor-400 block">
                        Validade da Garantia
                      </span>
                      <span className={`font-mono text-xs font-bold ${isExpirado ? 'text-rose-400' : 'text-emerald-400'}`}>
                        {formatarData(item.data_vencimento)}
                        {!isExpirado && (
                          <span className="text-[10px] text-vapor-400 font-normal ml-1">
                            ({item.diasRestantes}d)
                          </span>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Box de Próxima Revisão & Histórico */}
                  <div className={`p-2.5 rounded-xl border text-xs flex items-center justify-between gap-2 ${
                    isPendente
                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                      : 'bg-graphite-950 border-graphite-800 text-vapor-300'
                  }`}>
                    <div className="flex items-center gap-2">
                      <Sparkles size={14} className={isPendente ? 'text-amber-400 shrink-0' : 'text-vapor-500 shrink-0'} />
                      <div>
                        <span className="text-[10px] uppercase font-bold text-vapor-400 block leading-tight">
                          Próxima Manutenção
                        </span>
                        <span className="font-mono text-xs font-semibold text-vapor-100">
                          {formatarData(item.proximaRevisaoData)}
                          {isPendente && (
                            <span className="text-amber-400 font-bold ml-1.5">
                              (Vencida há {Math.abs(item.proximaRevisaoDias)} dias)
                            </span>
                          )}
                          {!isPendente && item.proximaRevisaoDias >= 0 && (
                            <span className="text-vapor-400 ml-1.5">
                              (em {item.proximaRevisaoDias} dias)
                            </span>
                          )}
                        </span>
                      </div>
                    </div>

                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-graphite-800 text-vapor-300 border border-graphite-700 shrink-0">
                      {item.totalRevisoes} rev. feitas
                    </span>
                  </div>
                </div>

                {/* Barra de Ações Rápidas */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-graphite-800">
                  <div className="flex items-center gap-1.5">
                    {/* Botão Registrar Revisão */}
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setRevisaoModalItem(item)}
                      className="text-xs py-1.5 px-2.5 flex items-center gap-1.5 border-graphite-700 hover:border-amber-500/50"
                      title="Registrar manutenção periódica da garantia"
                    >
                      <Sparkles size={13} className="text-amber-400" />
                      <span>Registrar Revisão</span>
                    </Button>

                    {/* Botão Adesivo de Para-brisa */}
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setAdesivoModalItem(item)}
                      className="text-xs py-1.5 px-2.5 flex items-center gap-1.5 border-graphite-700 hover:border-amber-500/50"
                      title="Imprimir ou baixar adesivo com QR Code"
                    >
                      <Printer size={13} className="text-vapor-300" />
                      <span>Adesivo</span>
                    </Button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {/* Botão WhatsApp */}
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => handleEnviarWhatsApp(item)}
                      className="text-xs py-1.5 px-2.5 flex items-center gap-1.5 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                      title="Enviar lembrete ou certificado via WhatsApp"
                    >
                      <MessageCircle size={13} />
                      <span>WhatsApp</span>
                    </Button>

                    {/* Ver Certificado Público */}
                    <a
                      href={`/garantia/${item.codigo}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 rounded-lg bg-graphite-800 hover:bg-graphite-700 text-vapor-300 hover:text-vapor-100 border border-graphite-700 transition-colors"
                      title="Abrir página pública do certificado"
                    >
                      <ExternalLink size={14} />
                    </a>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* MODAL ADESIVO DE PARA-BRISA */}
      {adesivoModalItem && (
        <AdesivoParabrisaModal
          isOpen={!!adesivoModalItem}
          onClose={() => setAdesivoModalItem(null)}
          certificado={{
            codigo: adesivoModalItem.codigo,
            servico_nome: adesivoModalItem.servico_nome,
            produto_aplicado: adesivoModalItem.produto_aplicado,
            data_aplicacao: adesivoModalItem.data_aplicacao,
            data_vencimento: adesivoModalItem.data_vencimento,
            proxima_revisao_data: adesivoModalItem.proximaRevisaoData
          }}
          oficina={{
            nome: tenant?.nome || 'Oficina Detailer',
            logo_path: tenant?.logo_path,
            telefone: tenant?.telefone
          }}
          veiculo={{
            modelo: adesivoModalItem.veiculo?.modelo || 'Veículo',
            placa: adesivoModalItem.veiculo?.placa || 'Sem placa',
            cor: adesivoModalItem.veiculo?.cor
          }}
        />
      )}

      {/* MODAL REGISTRAR REVISÃO */}
      {revisaoModalItem && (
        <ModalRegistrarRevisao
          isOpen={!!revisaoModalItem}
          onClose={() => setRevisaoModalItem(null)}
          onSucesso={() => {
            carregarGarantias();
          }}
          certificado={{
            id: revisaoModalItem.id,
            codigo: revisaoModalItem.codigo,
            servico_nome: revisaoModalItem.servico_nome,
            produto_aplicado: revisaoModalItem.produto_aplicado,
            intervalo_manutencao_dias: revisaoModalItem.intervalo_manutencao_dias,
            cliente_nome: revisaoModalItem.cliente?.nome || '',
            veiculo_modelo: revisaoModalItem.veiculo?.modelo || 'Veículo',
            veiculo_placa: revisaoModalItem.veiculo?.placa || 'Sem placa',
            total_revisoes: revisaoModalItem.totalRevisoes
          }}
        />
      )}
    </div>
  );
};
