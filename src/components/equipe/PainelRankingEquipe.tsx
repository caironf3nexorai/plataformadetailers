import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissao } from '../../hooks/usePermissao';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { formatarMoeda } from '../../utils/formatters';
import { obterDatasPeriodo } from '../../utils/financeiroUtils';
import type { TipoFiltroPeriodo } from '../../types/financeiro';
import {
  Trophy,
  Medal,
  Zap,
  DollarSign,
  Car,
  Clock,
  Sparkles,
  Users,
  RotateCcw,
  Lock,
  CheckCircle2,
  TrendingUp,
  Award
} from 'lucide-react';

export interface MembroRanking {
  member_id: string;
  user_id?: string | null;
  nome: string;
  email: string;
  papel: string;
  veiculos_concluidos: number;
  tempo_total_minutos: number;
  tempo_medio_minutos: number;
  faturamento_gerado: number;
  comissao_acumulada: number;
  eh_usuario_atual: boolean;
}

export const PainelRankingEquipe: React.FC = () => {
  const { tenant, user, profile } = useAuth();
  const { isDono, isGerente } = usePermissao();
  const podeVerComissoes = isDono || isGerente;

  const [filtroPeriodo, setFiltroPeriodo] = useState<TipoFiltroPeriodo>('este_mes');
  const [ranking, setRanking] = useState<MembroRanking[]>([]);
  const [loading, setLoading] = useState(true);

  // Formata o nome do membro de forma inteligente
  const formatarNomeMembro = (nome?: string | null, email?: string | null, userId?: string | null) => {
    if (nome && nome.trim()) return nome.trim();
    if (userId && user?.id === userId && profile?.nome?.trim()) {
      return profile.nome.trim();
    }
    if (email && email.trim()) {
      const parte = email.split('@')[0];
      return parte
        .replace(/[._-]+/g, ' ')
        .split(' ')
        .filter(Boolean)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
        .join(' ');
    }
    return 'Membro da Equipe';
  };

  // Formata minutos em string amigável (ex: 1h 25m ou 45m)
  const formatarTempo = (minutos: number) => {
    if (!minutos || minutos <= 0) return '0m';
    const h = Math.floor(minutos / 60);
    const m = Math.round(minutos % 60);
    if (h > 0) return `${h}h ${m > 0 ? `${m}m` : ''}`.trim();
    return `${m}m`;
  };

  const carregarRanking = async () => {
    if (!tenant?.id) return;
    setLoading(true);

    try {
      const { inicio, fim } = obterDatasPeriodo(filtroPeriodo);

      // 1. Tenta carregar via RPC otimizada
      const { data: rpcData, error: rpcErr } = await supabase.rpc('ranking_produtividade_equipe', {
        p_tenant: tenant.id,
        p_inicio: inicio,
        p_fim: fim
      });

      if (!rpcErr && rpcData && Array.isArray(rpcData) && rpcData.length > 0) {
        const formatados: MembroRanking[] = (rpcData as any[]).map((row) => ({
          member_id: row.member_id,
          user_id: row.user_id,
          nome: formatarNomeMembro(row.nome, row.email, row.user_id),
          email: row.email || '',
          papel: row.papel || 'operador',
          veiculos_concluidos: Number(row.veiculos_concluidos) || 0,
          tempo_total_minutos: Number(row.tempo_total_minutos) || 0,
          tempo_medio_minutos: Number(row.tempo_medio_minutos) || 0,
          faturamento_gerado: Number(row.faturamento_gerado) || 0,
          comissao_acumulada: Number(row.comissao_acumulada) || 0,
          eh_usuario_atual: Boolean(row.eh_usuario_atual || (user?.id && row.user_id === user.id))
        }));
        setRanking(formatados);
      } else {
        // 2. Fallback local inteligente caso a RPC ainda não esteja ativa
        await carregarRankingFallback(inicio, fim);
      }
    } catch (err) {
      console.error('Erro ao carregar ranking da equipe:', err);
    } finally {
      setLoading(false);
    }
  };

  // Agregação local resiliente consultando tabelas diretamente
  const carregarRankingFallback = async (inicio: string, fim: string) => {
    if (!tenant?.id) return;

    try {
      const inicioIso = `${inicio}T00:00:00-03:00`;
      const fimIso = `${fim}T23:59:59-03:00`;

      // 1. Busca todos os membros ativos da oficina
      const { data: allMembers } = await supabase
        .from('tenant_members')
        .select('id, user_id, email, role, status')
        .eq('tenant_id', tenant.id)
        .eq('status', 'ativo');

      // 2. Busca perfis para pegar os nomes cadastrados
      const userIds = (allMembers || []).map((m: any) => m.user_id).filter(Boolean);
      let profileMap = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, nome').in('id', userIds);
        profileMap = new Map((profiles || []).map((p: any) => [p.id, p.nome]));
      }

      // 3. Agrupa métricas por member_id começando por todos os membros
      const mapa = new Map<string, {
        member_id: string;
        user_id?: string | null;
        nome: string;
        email: string;
        papel: string;
        veiculos_concluidos: number;
        tempo_total_minutos: number;
        faturamento_gerado: number;
        comissao_acumulada: number;
      }>();

      (allMembers || []).forEach((m: any) => {
        const nomePerfil = profileMap.get(m.user_id);
        const nomeFinal = formatarNomeMembro(nomePerfil, m.email, m.user_id);
        mapa.set(m.id, {
          member_id: m.id,
          user_id: m.user_id,
          nome: nomeFinal,
          email: m.email || '',
          papel: m.role || 'operador',
          veiculos_concluidos: 0,
          tempo_total_minutos: 0,
          faturamento_gerado: 0,
          comissao_acumulada: 0,
        });
      });

      // 4. Busca execuções finalizadas no período
      const { data: execs } = await supabase
        .from('execucoes')
        .select(`
          id,
          status,
          finalizado_em,
          valor_total_final,
          tempo_efetivo_minutos,
          segundos_trabalhados,
          executores:execucao_executores(
            member_id,
            comissao_calculada,
            usuario_id
          )
        `)
        .eq('tenant_id', tenant.id)
        .eq('status', 'finalizado')
        .gte('finalizado_em', inicioIso)
        .lte('finalizado_em', fimIso);

      ((execs as any[]) || []).forEach((e) => {
        const valorExecucao = Number(e.valor_total_final) || 0;
        const tempoMin = Number(e.tempo_efetivo_minutos) || Math.round((Number(e.segundos_trabalhados) || 0) / 60);

        const executores = e.executores || [];
        executores.forEach((ex: any) => {
          if (!ex.member_id) return;
          if (!mapa.has(ex.member_id)) {
            mapa.set(ex.member_id, {
              member_id: ex.member_id,
              user_id: ex.usuario_id,
              nome: formatarNomeMembro(null, null, ex.usuario_id),
              email: '',
              papel: 'operador',
              veiculos_concluidos: 0,
              tempo_total_minutos: 0,
              faturamento_gerado: 0,
              comissao_acumulada: 0
            });
          }

          const registro = mapa.get(ex.member_id)!;
          registro.veiculos_concluidos += 1;
          registro.tempo_total_minutos += tempoMin;
          registro.faturamento_gerado += valorExecucao;
          registro.comissao_acumulada += Number(ex.comissao_calculada) || 0;
        });
      });

      const listaTratada: MembroRanking[] = Array.from(mapa.values()).map((item) => {
        const tempoMedio = item.veiculos_concluidos > 0
          ? Math.round(item.tempo_total_minutos / item.veiculos_concluidos)
          : 0;

        const ehAtual = !!(user?.id && item.user_id === user.id);

        return {
          ...item,
          tempo_medio_minutos: tempoMedio,
          eh_usuario_atual: ehAtual,
          // Se for operador e não for o próprio, oculta comissão
          comissao_acumulada: (podeVerComissoes || ehAtual) ? item.comissao_acumulada : 0
        };
      });

      listaTratada.sort((a, b) => b.veiculos_concluidos - a.veiculos_concluidos || b.faturamento_gerado - a.faturamento_gerado);
      setRanking(listaTratada);
    } catch (err) {
      console.warn('Erro no fallback do ranking:', err);
    }
  };

  useEffect(() => {
    carregarRanking();
  }, [tenant?.id, filtroPeriodo]);

  // Cálculos de Totais e Destaques
  const totalCarrosGeral = ranking.reduce((acc, curr) => acc + curr.veiculos_concluidos, 0);
  const totalFaturamentoGeral = ranking.reduce((acc, curr) => acc + curr.faturamento_gerado, 0);
  const mediaTempoGeral = ranking.length > 0 && totalCarrosGeral > 0
    ? Math.round(ranking.reduce((acc, curr) => acc + curr.tempo_total_minutos, 0) / totalCarrosGeral)
    : 0;

  // Destaques / Badges
  const campeaoVolume = ranking[0];
  const maisAgil = [...ranking]
    .filter((m) => m.veiculos_concluidos >= 2 && m.tempo_medio_minutos > 0)
    .sort((a, b) => a.tempo_medio_minutos - b.tempo_medio_minutos)[0];
  const campeaoFaturamento = [...ranking].sort((a, b) => b.faturamento_gerado - a.faturamento_gerado)[0];

  // Top 3 do Pódio
  const top1 = ranking[0];
  const top2 = ranking[1];
  const top3 = ranking[2];

  const getIniciais = (nome: string) => {
    if (!nome) return 'EQ';
    const partes = nome.trim().split(/\s+/).filter(Boolean);
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  };

  return (
    <div className="flex flex-col gap-6">
      {/* 1. TOPO: TÍTULO & SELETOR DE PERÍODO */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-graphite-900 border border-graphite-800 rounded-2xl shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 shadow-sm">
            <Trophy size={22} />
          </div>
          <div>
            <h3 className="font-display font-black text-lg text-white uppercase tracking-wide flex items-center gap-2">
              <span>Ranking & Produtividade da Equipe</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-amber-500/20 text-amber-400 border border-amber-500/30">
                AO VIVO
              </span>
            </h3>
            <p className="text-xs text-vapor-400">
              Métricas de veículos entregues, velocidade de execução e comissões apuradas.
            </p>
          </div>
        </div>

        {/* Filtro de Período */}
        <div className="flex items-center gap-1.5 bg-graphite-950 p-1 rounded-xl border border-graphite-800">
          {(['hoje', 'esta_semana', 'este_mes', 'mes_passado'] as TipoFiltroPeriodo[]).map((f) => {
            const rotulos: Record<string, string> = {
              hoje: 'Hoje',
              esta_semana: 'Esta Semana',
              este_mes: 'Este Mês',
              mes_passado: 'Mês Passado'
            };
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFiltroPeriodo(f)}
                className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-all whitespace-nowrap ${
                  filtroPeriodo === f
                    ? 'bg-amber-500 text-graphite-950 shadow-sm'
                    : 'text-vapor-400 hover:text-vapor-200 hover:bg-graphite-900'
                }`}
              >
                {rotulos[f]}
              </button>
            );
          })}

          <Button
            type="button"
            variant="ghost"
            onClick={carregarRanking}
            disabled={loading}
            className="p-1.5 text-vapor-400 hover:text-vapor-100"
            title="Atualizar ranking"
          >
            <RotateCcw size={14} className={loading ? 'animate-spin' : ''} />
          </Button>
        </div>
      </div>

      {/* 2. CARDS DE RESUMO GERAL */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Total de Veículos Concluídos */}
        <div className="p-4 rounded-xl bg-graphite-900 border border-graphite-800 flex items-center justify-between shadow-sm">
          <div className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-vapor-400 flex items-center gap-1.5">
              <Car size={14} className="text-amber-400" />
              Veículos Entregues
            </span>
            <div className="text-2xl font-black text-white font-mono">{totalCarrosGeral}</div>
            <p className="text-[10px] text-vapor-400">Total no período selecionado</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <CheckCircle2 size={20} />
          </div>
        </div>

        {/* Tempo Médio por Veículo */}
        <div className="p-4 rounded-xl bg-graphite-900 border border-graphite-800 flex items-center justify-between shadow-sm">
          <div className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-vapor-400 flex items-center gap-1.5">
              <Clock size={14} className="text-blue-400" />
              Tempo Médio Geral
            </span>
            <div className="text-2xl font-black text-white font-mono">{formatarTempo(mediaTempoGeral)}</div>
            <p className="text-[10px] text-vapor-400">Média de execução da oficina</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
            <Zap size={20} />
          </div>
        </div>

        {/* Faturamento Gerado (apenas gestores) */}
        {podeVerComissoes ? (
          <div className="p-4 rounded-xl bg-graphite-900 border border-graphite-800 flex items-center justify-between shadow-sm">
            <div className="space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <DollarSign size={14} />
                Faturamento Equipe
              </span>
              <div className="text-2xl font-black text-emerald-400 font-mono">
                {formatarMoeda(totalFaturamentoGeral)}
              </div>
              <p className="text-[10px] text-vapor-400">Serviços executados pelos membros</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <TrendingUp size={20} />
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-graphite-900 border border-graphite-800 flex items-center justify-between shadow-sm">
            <div className="space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <Award size={14} />
                Sua Posição
              </span>
              <div className="text-2xl font-black text-white font-mono">
                {ranking.findIndex((r) => r.eh_usuario_atual) >= 0
                  ? `#${ranking.findIndex((r) => r.eh_usuario_atual) + 1} no Pódio`
                  : 'Participando'}
              </div>
              <p className="text-[10px] text-vapor-400">Continue produzindo!</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Trophy size={20} />
            </div>
          </div>
        )}

        {/* Membros Ativos */}
        <div className="p-4 rounded-xl bg-graphite-900 border border-graphite-800 flex items-center justify-between shadow-sm">
          <div className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-vapor-400 flex items-center gap-1.5">
              <Users size={14} className="text-purple-400" />
              Operadores Ativos
            </span>
            <div className="text-2xl font-black text-white font-mono">{ranking.length}</div>
            <p className="text-[10px] text-vapor-400">Profissionais com entregas</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
            <Sparkles size={20} />
          </div>
        </div>
      </div>

      {/* 3. PÓDIO VISUAL GAMIFICADO (TOP 3) */}
      {ranking.length > 0 && (
        <Card className="p-6 bg-gradient-to-b from-graphite-900 via-graphite-950 to-graphite-950 border-graphite-800 shadow-xl overflow-hidden relative">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-36 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="flex items-center justify-between mb-6 relative z-10">
            <div className="flex items-center gap-2">
              <Trophy className="text-amber-400" size={20} />
              <h4 className="font-display font-extrabold text-base text-white uppercase tracking-wider">
                Pódio dos Campeões da Oficina
              </h4>
            </div>
            <Badge tone="amber">DESTAQUES DO PERÍODO</Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end pt-4 pb-2 relative z-10 max-w-4xl mx-auto">
            {/* 🥈 2º LUGAR (ESQUERDA) */}
            {top2 ? (
              <div className="order-2 md:order-1 flex flex-col items-center text-center p-5 rounded-2xl bg-graphite-900/90 border border-slate-600 shadow-lg relative">
                <div className="w-9 h-9 rounded-full bg-slate-300 text-slate-900 font-black text-sm flex items-center justify-center absolute -top-4 shadow-md border-2 border-slate-400">
                  2º
                </div>
                <div className="w-16 h-16 rounded-full bg-slate-800 border-2 border-slate-400 flex items-center justify-center font-black text-lg text-slate-200 mt-2 mb-3 shadow-inner">
                  {getIniciais(top2.nome)}
                </div>
                <h5 className="font-display font-bold text-sm text-white truncate max-w-[200px]">
                  {top2.nome}
                </h5>
                <span className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold block mb-3">
                  {top2.papel}
                </span>

                <div className="w-full bg-graphite-950 p-2.5 rounded-xl border border-graphite-800 space-y-1">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-vapor-400">Entregas:</span>
                    <strong className="text-white font-bold">{top2.veiculos_concluidos} carros</strong>
                  </div>
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-vapor-400">Tempo Médio:</span>
                    <strong className="text-slate-300">{formatarTempo(top2.tempo_medio_minutos)}</strong>
                  </div>
                  {(podeVerComissoes || top2.eh_usuario_atual) && (
                    <div className="flex items-center justify-between text-xs font-mono pt-1 border-t border-graphite-800">
                      <span className="text-emerald-400">Comissão:</span>
                      <strong className="text-emerald-400 font-bold">{formatarMoeda(top2.comissao_acumulada)}</strong>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="order-2 md:order-1 hidden md:flex flex-col items-center justify-center p-8 rounded-2xl bg-graphite-950/40 border border-graphite-800/40 text-vapor-500 text-xs text-center italic">
                Aguardando 2º colocado...
              </div>
            )}

            {/* 🥇 1º LUGAR (CENTRO - MAIOR E COM DESTAQUE DOURADO) */}
            {top1 && (
              <div className="order-1 md:order-2 flex flex-col items-center text-center p-6 rounded-3xl bg-gradient-to-b from-amber-500/20 via-graphite-900 to-graphite-950 border-2 border-amber-500 shadow-2xl shadow-amber-500/20 relative -translate-y-2 md:-translate-y-4">
                <div className="w-11 h-11 rounded-full bg-gradient-to-r from-amber-400 to-amber-500 text-graphite-950 font-black text-base flex items-center justify-center absolute -top-5 shadow-xl border-2 border-amber-300">
                  👑 1º
                </div>
                <div className="w-20 h-20 rounded-full bg-amber-500/20 border-3 border-amber-400 flex items-center justify-center font-black text-2xl text-amber-300 mt-2 mb-3 shadow-lg shadow-amber-500/30">
                  {getIniciais(top1.nome)}
                </div>
                <h5 className="font-display font-black text-base text-white truncate max-w-[220px]">
                  {top1.nome}
                </h5>
                <span className="text-[11px] text-amber-400 uppercase tracking-widest font-black block mb-3">
                  ★ CAMPEÃO DA OFICINA ★
                </span>

                <div className="w-full bg-graphite-950 p-3 rounded-xl border border-amber-500/30 space-y-1.5 shadow-inner">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-vapor-400">Veículos:</span>
                    <strong className="text-amber-400 font-extrabold text-sm">{top1.veiculos_concluidos} carros</strong>
                  </div>
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-vapor-400">Tempo Médio:</span>
                    <strong className="text-white font-bold">{formatarTempo(top1.tempo_medio_minutos)}</strong>
                  </div>
                  {(podeVerComissoes || top1.eh_usuario_atual) && (
                    <div className="flex items-center justify-between text-xs font-mono pt-1.5 border-t border-graphite-800">
                      <span className="text-emerald-400 font-semibold">Comissão:</span>
                      <strong className="text-emerald-400 font-black text-sm">{formatarMoeda(top1.comissao_acumulada)}</strong>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 🥉 3º LUGAR (DIREITA) */}
            {top3 ? (
              <div className="order-3 flex flex-col items-center text-center p-5 rounded-2xl bg-graphite-900/90 border border-amber-700/60 shadow-lg relative">
                <div className="w-9 h-9 rounded-full bg-amber-800 text-amber-100 font-black text-sm flex items-center justify-center absolute -top-4 shadow-md border-2 border-amber-600">
                  3º
                </div>
                <div className="w-16 h-16 rounded-full bg-amber-950/60 border-2 border-amber-700 flex items-center justify-center font-black text-lg text-amber-300 mt-2 mb-3 shadow-inner">
                  {getIniciais(top3.nome)}
                </div>
                <h5 className="font-display font-bold text-sm text-white truncate max-w-[200px]">
                  {top3.nome}
                </h5>
                <span className="text-[10px] text-amber-500/80 uppercase tracking-widest font-semibold block mb-3">
                  {top3.papel}
                </span>

                <div className="w-full bg-graphite-950 p-2.5 rounded-xl border border-graphite-800 space-y-1">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-vapor-400">Entregas:</span>
                    <strong className="text-white font-bold">{top3.veiculos_concluidos} carros</strong>
                  </div>
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-vapor-400">Tempo Médio:</span>
                    <strong className="text-amber-200">{formatarTempo(top3.tempo_medio_minutos)}</strong>
                  </div>
                  {(podeVerComissoes || top3.eh_usuario_atual) && (
                    <div className="flex items-center justify-between text-xs font-mono pt-1 border-t border-graphite-800">
                      <span className="text-emerald-400">Comissão:</span>
                      <strong className="text-emerald-400 font-bold">{formatarMoeda(top3.comissao_acumulada)}</strong>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="order-3 hidden md:flex flex-col items-center justify-center p-8 rounded-2xl bg-graphite-950/40 border border-graphite-800/40 text-vapor-500 text-xs text-center italic">
                Aguardando 3º colocado...
              </div>
            )}
          </div>
        </Card>
      )}

      {/* 4. CARDS DE CONQUISTAS / BADGES */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        {/* Mais Produtivo */}
        <div className="p-4 rounded-xl bg-graphite-900 border border-amber-500/30 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
            <Trophy size={24} />
          </div>
          <div className="min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 block">
              🏆 Maior Volume
            </span>
            <strong className="text-sm font-bold text-white truncate block">
              {campeaoVolume ? campeaoVolume.nome : '---'}
            </strong>
            <span className="text-[11px] text-vapor-400 font-mono">
              {campeaoVolume ? `${campeaoVolume.veiculos_concluidos} veículos entregues` : 'Sem registros'}
            </span>
          </div>
        </div>

        {/* Mais Ágil */}
        <div className="p-4 rounded-xl bg-graphite-900 border border-blue-500/30 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
            <Zap size={24} />
          </div>
          <div className="min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400 block">
              ⚡ Mais Ágil
            </span>
            <strong className="text-sm font-bold text-white truncate block">
              {maisAgil ? maisAgil.nome : '---'}
            </strong>
            <span className="text-[11px] text-vapor-400 font-mono">
              {maisAgil ? `Média de ${formatarTempo(maisAgil.tempo_medio_minutos)} por carro` : 'Mínimo 2 carros'}
            </span>
          </div>
        </div>

        {/* Estrela de Faturamento */}
        <div className="p-4 rounded-xl bg-graphite-900 border border-emerald-500/30 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
            <DollarSign size={24} />
          </div>
          <div className="min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 block">
              💎 Maior Faturamento
            </span>
            <strong className="text-sm font-bold text-white truncate block">
              {campeaoFaturamento ? campeaoFaturamento.nome : '---'}
            </strong>
            <span className="text-[11px] text-vapor-400 font-mono">
              {campeaoFaturamento && podeVerComissoes
                ? formatarMoeda(campeaoFaturamento.faturamento_gerado)
                : 'Destaque em receita'}
            </span>
          </div>
        </div>
      </div>

      {/* 5. TABELA COMPLETA DE CLASSIFICAÇÃO */}
      <Card className="p-6 bg-graphite-900 border-graphite-800 flex flex-col gap-4 shadow-xl">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h4 className="font-display font-bold text-base text-white uppercase tracking-wide flex items-center gap-2">
            <Medal size={18} className="text-amber-400" />
            <span>Classificação Geral da Equipe</span>
          </h4>
          <span className="text-xs text-vapor-400">
            {ranking.length} membro(s) classificado(s)
          </span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-vapor-400 text-xs animate-pulse">
            Carregando desempenho da equipe...
          </div>
        ) : ranking.length === 0 ? (
          <div className="p-8 text-center text-vapor-400 text-xs">
            Nenhum atendimento finalizado registrado no período selecionado.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-sans">
              <thead>
                <tr className="border-b border-graphite-800 text-vapor-400 uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-3">Posição</th>
                  <th className="py-3 px-3">Profissional</th>
                  <th className="py-3 px-3 text-center">Veículos</th>
                  <th className="py-3 px-3 text-center">Tempo Médio</th>
                  {podeVerComissoes && <th className="py-3 px-3 text-right">Faturamento</th>}
                  <th className="py-3 px-3 text-right">Comissão</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-graphite-800/60">
                {ranking.map((item, index) => {
                  const isTop1 = index === 0;
                  const isTop2 = index === 1;
                  const isTop3 = index === 2;

                  return (
                    <tr
                      key={item.member_id}
                      className={`hover:bg-graphite-800/40 transition-colors ${
                        item.eh_usuario_atual ? 'bg-amber-500/5 font-semibold' : ''
                      }`}
                    >
                      {/* Posição */}
                      <td className="py-3.5 px-3">
                        <div className="flex items-center gap-2">
                          {isTop1 ? (
                            <span className="w-6 h-6 rounded-full bg-amber-400 text-graphite-950 font-black text-xs flex items-center justify-center shadow">
                              1º
                            </span>
                          ) : isTop2 ? (
                            <span className="w-6 h-6 rounded-full bg-slate-300 text-slate-900 font-bold text-xs flex items-center justify-center">
                              2º
                            </span>
                          ) : isTop3 ? (
                            <span className="w-6 h-6 rounded-full bg-amber-800 text-amber-100 font-bold text-xs flex items-center justify-center">
                              3º
                            </span>
                          ) : (
                            <span className="w-6 h-6 font-mono text-vapor-400 text-center text-xs">
                              #{index + 1}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Nome e Cargo */}
                      <td className="py-3.5 px-3">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                            isTop1
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              : 'bg-graphite-800 text-vapor-300'
                          }`}>
                            {getIniciais(item.nome)}
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="font-bold text-white text-xs truncate flex items-center gap-1.5">
                              {item.nome}
                              {item.eh_usuario_atual && (
                                <Badge tone="amber">VOCÊ</Badge>
                              )}
                            </span>
                            <span className="text-[10px] text-vapor-400 capitalize">
                              {item.papel}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Veículos Concluídos */}
                      <td className="py-3.5 px-3 text-center">
                        <span className="font-mono text-xs font-bold text-white bg-graphite-950 px-2.5 py-1 rounded-md border border-graphite-800">
                          {item.veiculos_concluidos}
                        </span>
                      </td>

                      {/* Tempo Médio */}
                      <td className="py-3.5 px-3 text-center font-mono text-xs text-vapor-300">
                        {formatarTempo(item.tempo_medio_minutos)}
                      </td>

                      {/* Faturamento Gerado (apenas gestores) */}
                      {podeVerComissoes && (
                        <td className="py-3.5 px-3 text-right font-mono text-xs text-vapor-200">
                          {formatarMoeda(item.faturamento_gerado)}
                        </td>
                      )}

                      {/* Comissão Apurada */}
                      <td className="py-3.5 px-3 text-right">
                        {podeVerComissoes || item.eh_usuario_atual ? (
                          <span className="font-mono text-xs font-bold text-emerald-400">
                            {formatarMoeda(item.comissao_acumulada)}
                          </span>
                        ) : (
                          <span className="text-[10px] font-mono text-vapor-500 flex items-center justify-end gap-1" title="Visível apenas para o gestor e para o próprio operador">
                            <Lock size={10} />
                            Sigiloso
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};
