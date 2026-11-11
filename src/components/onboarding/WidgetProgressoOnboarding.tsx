import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  EyeOff,
  Play,
  ShieldCheck,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  resolverTutoriaisEtapas,
  type ConfigTutorialVideo,
} from '../../config/tutorialVideos';
import {
  calcularProgressoOnboarding,
  lerProgressLocal,
  lerWidgetOcultoLocal,
  lerWidgetRecolhidoLocal,
  marcarPassoOnboarding,
  mergeOnboardingFlags,
  ONBOARDING_EVENT_PROGRESSO,
  salvarProgressLocal,
  salvarWidgetOcultoLocal,
  salvarWidgetRecolhidoLocal,
  type EtapaOnboardingCalculada,
  type EtapaOnboardingId,
  type OnboardingProgressFlags,
  type StatusOnboardingInput,
} from '../../utils/onboarding';
import { ModalTutorialVideoCurto } from './ModalTutorialVideoCurto';

interface RawStatusRpc {
  plano?: string;
  servicos_count?: number;
  servicos_com_preco_count?: number;
  servicos_confirmados_count?: number;
  orcamentos_count?: number;
  termos_garantia_count?: number;
  membros_count?: number;
  onboarding_progress?: OnboardingProgressFlags;
  onboarding_widget_oculto?: boolean;
  tem_logo?: boolean;
  tem_identidade?: boolean;
  tem_pix?: boolean;
  sinal_ativo?: boolean;
  tem_termo_resp_custom?: boolean;
}

export const WidgetProgressoOnboarding: React.FC = () => {
  const { tenant, membership, refetchTenantData } = useAuth();
  const navigate = useNavigate();

  const ehGestor = membership?.role === 'dono' || membership?.role === 'gerente';

  const [carregando, setCarregando] = useState(true);
  const [statusInput, setStatusInput] = useState<StatusOnboardingInput | null>(null);
  const [widgetOculto, setWidgetOculto] = useState<boolean>(() =>
    lerWidgetOcultoLocal(tenant?.id) || Boolean(tenant?.onboarding_widget_oculto)
  );
  const [recolhido, setRecolhido] = useState<boolean>(() =>
    lerWidgetRecolhidoLocal(tenant?.id)
  );
  const [fase2AbertaManual, setFase2AbertaManual] = useState<boolean | null>(null);
  const [mostrarConcluidas, setMostrarConcluidas] = useState(false);
  const [tutorialSelecionado, setTutorialSelecionado] = useState<ConfigTutorialVideo | null>(null);
  const [tutoriaisPorEtapa, setTutoriaisPorEtapa] = useState<
    Record<EtapaOnboardingId, ConfigTutorialVideo>
  >(() => resolverTutoriaisEtapas());
  const [salvandoPassoId, setSalvandoPassoId] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    async function carregarTutoriaisConfig() {
      try {
        const { data } = await supabase.rpc('obter_config_plataforma');
        if (!ativo || !data) return;
        setTutoriaisPorEtapa(resolverTutoriaisEtapas(data));
      } catch {
        // Mantém fallback local de src/config/tutorialVideos.ts
      }
    }
    carregarTutoriaisConfig();
    return () => {
      ativo = false;
    };
  }, []);

  useEffect(() => {
    if (!tenant?.id) return;
    setRecolhido(lerWidgetRecolhidoLocal(tenant.id));
    if (tenant.onboarding_widget_oculto || lerWidgetOcultoLocal(tenant.id)) {
      setWidgetOculto(true);
    } else {
      setWidgetOculto(false);
    }
  }, [tenant?.id, tenant?.onboarding_widget_oculto]);

  const carregarStatusOnboarding = useCallback(async () => {
    if (!tenant?.id || !ehGestor) {
      setCarregando(false);
      return;
    }

    const flagsLocais = lerProgressLocal(tenant.id);
    const flagsTenant = (tenant.onboarding_progress || {}) as OnboardingProgressFlags;

    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('obter_status_onboarding', {
        p_tenant_id: tenant.id,
      });

      if (!rpcError && rpcData) {
        const raw = rpcData as RawStatusRpc;
        const mergedFlags = mergeOnboardingFlags(
          mergeOnboardingFlags(flagsTenant, raw.onboarding_progress),
          flagsLocais
        );
        salvarProgressLocal(tenant.id, mergedFlags);

        const ocultoFinal = Boolean(raw.onboarding_widget_oculto) || lerWidgetOcultoLocal(tenant.id);
        if (ocultoFinal) {
          salvarWidgetOcultoLocal(tenant.id, true);
        }
        setWidgetOculto(ocultoFinal);

        setStatusInput({
          plano: raw.plano || tenant.plano || 'free',
          servicosCount: Number(raw.servicos_count ?? 0),
          servicosComPrecoCount:
            raw.servicos_com_preco_count !== undefined
              ? Number(raw.servicos_com_preco_count)
              : undefined,
          servicosConfirmadosCount: Number(raw.servicos_confirmados_count ?? 0),
          orcamentosCount: Number(raw.orcamentos_count ?? 0),
          termosGarantiaCount: Number(raw.termos_garantia_count ?? 0),
          membrosCount: Number(raw.membros_count ?? 1),
          temLogo: Boolean(raw.tem_logo),
          temIdentidade: Boolean(raw.tem_identidade),
          temPix: Boolean(raw.tem_pix),
          sinalAtivo: Boolean(raw.sinal_ativo),
          temTermoRespCustom: Boolean(raw.tem_termo_resp_custom),
          progress: mergedFlags,
        });
        setCarregando(false);
        return;
      }

      // Fallback resiliente caso a migração 0171/0175 ainda não tenha sido executada no banco
      const [resServs, resPrecos, resOrcs, resTermos, resMembros] = await Promise.all([
        supabase
          .from('servicos')
          .select('id, sob_consulta')
          .eq('tenant_id', tenant.id)
          .eq('ativo', true),
        supabase
          .from('servico_precos')
          .select('servico_id, duracao_confirmada, preco_base')
          .eq('tenant_id', tenant.id)
          .eq('ativo', true),
        supabase
          .from('orcamentos')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant.id),
        supabase
          .from('termos_garantia')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant.id)
          .eq('ativo', true),
        supabase
          .from('tenant_members')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant.id)
          .in('status', ['ativo', 'convidado']),
      ]);

      const servsAtivos = resServs.data || [];
      const servsAtivosIds = new Set(servsAtivos.map((s: any) => s.id));
      const precosAtivos = (resPrecos.data || []).filter((p: any) =>
        servsAtivosIds.has(p.servico_id)
      );

      const servicosConfirmadosDistintos = new Set(
        precosAtivos
          .filter((row: any) => Boolean(row.duracao_confirmada))
          .map((row: any) => row.servico_id)
          .filter(Boolean)
      ).size;

      const idsComPrecoPositivo = new Set(
        precosAtivos
          .filter(
            (row: any) =>
              row.preco_base !== null &&
              row.preco_base !== undefined &&
              Number(row.preco_base) > 0
          )
          .map((row: any) => row.servico_id)
          .filter(Boolean)
      );

      const servicosComPrecoDistintos = servsAtivos.filter(
        (s: any) => Boolean(s.sob_consulta) || idsComPrecoPositivo.has(s.id)
      ).length;

      const mergedFlags = mergeOnboardingFlags(flagsTenant, flagsLocais);
      const temLogo = Boolean(
        (tenant.logo_path && tenant.logo_path.trim()) ||
          (tenant.logo_url && tenant.logo_url.trim())
      );
      const temIdentidade = Boolean(
        (tenant.documento && tenant.documento.trim()) ||
          (tenant.razao_social && tenant.razao_social.trim()) ||
          tenant.nome_alterado_em
      );
      const temPix = Boolean(tenant.pix_chave && tenant.pix_chave.trim());
      const temTermoRespCustom = Boolean(
        tenant.termo_responsabilidade && tenant.termo_responsabilidade.trim()
      );

      setStatusInput({
        plano: tenant.plano || 'free',
        servicosCount: servsAtivos.length,
        servicosComPrecoCount: servicosComPrecoDistintos,
        servicosConfirmadosCount: servicosConfirmadosDistintos,
        orcamentosCount: Number(resOrcs.count ?? 0),
        termosGarantiaCount: Number(resTermos.count ?? 0),
        membrosCount: Number(resMembros.count ?? 1),
        temLogo,
        temIdentidade,
        temPix,
        sinalAtivo: Boolean(tenant.sinal_ativo),
        temTermoRespCustom,
        progress: mergedFlags,
      });
    } catch (err) {
      console.warn('[WidgetProgressoOnboarding] Erro ao consultar status:', err);
    } finally {
      setCarregando(false);
    }
  }, [tenant, ehGestor]);

  useEffect(() => {
    carregarStatusOnboarding();
  }, [carregarStatusOnboarding]);

  useEffect(() => {
    const handleAtualizacao = () => {
      carregarStatusOnboarding();
    };
    window.addEventListener(ONBOARDING_EVENT_PROGRESSO, handleAtualizacao);
    return () => {
      window.removeEventListener(ONBOARDING_EVENT_PROGRESSO, handleAtualizacao);
    };
  }, [carregarStatusOnboarding]);

  const resultado = useMemo(() => {
    if (!statusInput) return null;
    return calcularProgressoOnboarding(statusInput);
  }, [statusInput]);

  if (!ehGestor || !tenant?.id || widgetOculto) {
    return null;
  }

  if (carregando || !resultado || !statusInput) {
    return null;
  }

  const handleToggleRecolhido = () => {
    const proximo = !recolhido;
    setRecolhido(proximo);
    salvarWidgetRecolhidoLocal(tenant.id, proximo);
  };

  const handleOcultarGuiaDefinitivo = async () => {
    setWidgetOculto(true);
    salvarWidgetOcultoLocal(tenant.id, true);
    await marcarPassoOnboarding(tenant.id, {}, true);
    await refetchTenantData();
  };

  const handleToggleManual = async (
    e: React.MouseEvent,
    etapa: EtapaOnboardingCalculada
  ) => {
    e.stopPropagation();
    const proximoManual = !etapa.concluidaManual;
    setSalvandoPassoId(etapa.id);

    const patch: OnboardingProgressFlags = {
      manual: {
        [etapa.id]: proximoManual,
      },
    };

    // Se usuário desmarcar manualmente a etapa 8 que havia marcado como "Trabalho sozinho", limpa o atalho também
    if (etapa.id === 'etapa_8' && !proximoManual && statusInput.progress.trabalho_sozinho) {
      patch.trabalho_sozinho = false;
    }

    const updatedFlags = await marcarPassoOnboarding(tenant.id, patch);
    setStatusInput((prev) =>
      prev
        ? {
            ...prev,
            progress: updatedFlags,
          }
        : prev
    );
    setSalvandoPassoId(null);
  };

  const handleMarcarTrabalhoSozinho = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSalvandoPassoId('etapa_8');
    const updatedFlags = await marcarPassoOnboarding(tenant.id, {
      trabalho_sozinho: true,
      manual: { etapa_8: true },
    });
    setStatusInput((prev) =>
      prev
        ? {
            ...prev,
            progress: updatedFlags,
          }
        : prev
    );
    setSalvandoPassoId(null);
  };

  const etapasFase1 = resultado.etapas.filter((et) => et.fase === 1);
  const etapasFase1Pendentes = etapasFase1.filter((et) => !et.concluida);
  const etapasFase2 = resultado.etapas.filter((et) => et.fase === 2);
  const etapasFase2Pendentes = etapasFase2.filter((et) => !et.concluida);
  const etapasConcluidasLista = resultado.etapas.filter((et) => et.concluida);
  const mostrarFase2 =
    fase2AbertaManual !== null ? fase2AbertaManual : resultado.fase1Concluida;

  const renderLinhaEtapa = (etapa: EtapaOnboardingCalculada) => {
    const tutorialConfig = tutoriaisPorEtapa[etapa.id];
    const concluida = etapa.concluida;
    const salvandoEsta = salvandoPassoId === etapa.id;

    return (
      <div
        key={etapa.id}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          navigate(etapa.rota);
        }}
        className={`group flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-3 py-2.5 rounded-xl border transition-all cursor-pointer ${
          concluida
            ? 'bg-emerald-500/[0.04] border-emerald-500/25 hover:border-emerald-500/40'
            : 'bg-graphite-900/75 border-graphite-800 hover:border-amber-500/45 hover:bg-graphite-900'
        }`}
      >
        <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
          {/* Checkbox Manual (área de toque 48x48px com caixa visual 20x20px) */}
          <button
            type="button"
            disabled={salvandoEsta}
            onClick={(e) => handleToggleManual(e, etapa)}
            title={
              etapa.concluidaAuto
                ? 'Etapa detectada automaticamente pelos dados da sua oficina'
                : etapa.concluidaManual
                ? 'Desmarcar conclusão manual'
                : 'Marcar como concluído manualmente (caso queira manter o padrão atual)'
            }
            aria-label={`Marcar etapa ${etapa.numero} como concluída`}
            className="w-12 h-12 -my-3 -ml-2.5 flex items-center justify-center shrink-0 cursor-pointer"
          >
            <span
              className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                concluida
                  ? 'bg-emerald-500 border-emerald-400 text-graphite-950'
                  : 'bg-graphite-950 border-graphite-600 text-transparent hover:border-amber-500'
              }`}
            >
              <Check size={13} strokeWidth={3} />
            </span>
          </button>

          {/* Título + Subtítulo clicáveis para redirecionamento direto */}
          <button
            type="button"
            onClick={() => navigate(etapa.rota)}
            className="flex flex-col min-w-0 flex-1 text-left cursor-pointer rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`font-sans text-[13px] font-semibold leading-snug break-words transition-colors ${
                  concluida
                    ? 'text-vapor-300 line-through decoration-emerald-500/40'
                    : 'text-vapor-100 group-hover:text-amber-300'
                }`}
              >
                {etapa.numero}. {etapa.titulo}
              </span>
              <span
                className={`font-mono text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${
                  concluida
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                    : 'bg-graphite-800 text-vapor-400 border-graphite-700'
                }`}
              >
                {concluida ? 'Concluída' : `+${resultado.percentualPorEtapa}%`}
              </span>
            </div>
            {!concluida && (
              <span className="font-sans text-[11px] text-vapor-400 leading-snug line-clamp-2 break-words">
                {etapa.subtitulo}
              </span>
            )}
          </button>
        </div>

        {/* Ações à Direita apenas para tarefas pendentes */}
        {!concluida && (
          <div className="flex items-center flex-wrap gap-2 shrink-0 pl-10 sm:pl-0 self-end sm:self-center">
            {etapa.id === 'etapa_8' && (
              <button
                type="button"
                disabled={salvandoEsta}
                onClick={handleMarcarTrabalhoSozinho}
                className="inline-flex items-center gap-1 px-3 py-1.5 min-h-[48px] sm:min-h-[34px] rounded-lg bg-graphite-800 hover:bg-emerald-500/15 text-vapor-200 hover:text-emerald-300 border border-graphite-700 hover:border-emerald-500/35 text-[11px] font-semibold transition-colors whitespace-nowrap"
                title="Marcar imediatamente que você atende sozinho no estúdio"
              >
                <UserCheck size={12} />
                <span>Trabalho sozinho</span>
              </button>
            )}

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setTutorialSelecionado(tutorialConfig);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[48px] sm:min-h-[34px] rounded-lg bg-graphite-800/90 hover:bg-amber-500/15 text-vapor-300 hover:text-amber-300 border border-graphite-700 hover:border-amber-500/35 text-[11px] font-semibold transition-colors whitespace-nowrap"
              title="Assistir tutorial rápido de 30 segundos"
            >
              <Play size={11} className="fill-current text-amber-400" />
              <span>Ver Tutorial</span>
            </button>

            <ChevronRight
              size={15}
              aria-hidden="true"
              className="text-vapor-500 group-hover:text-amber-400 transition-colors hidden sm:block"
            />
          </div>
        )}
      </div>
    );
  };

  // MODO RECOLHIDO (1 linha discreta no topo)
  if (recolhido) {
    return (
      <>
        <Card className="px-4 py-2.5 bg-graphite-900/90 border-graphite-700/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {resultado.tudoConcluido ? (
              <CheckCircle2 size={17} className="text-emerald-400 shrink-0" />
            ) : (
              <Sparkles size={17} className="text-amber-400 shrink-0" />
            )}
            <div className="flex items-center gap-3 min-w-0 flex-1 flex-wrap sm:flex-nowrap">
              <span className="font-sans text-xs sm:text-[13px] font-semibold text-vapor-100 leading-snug sm:whitespace-nowrap">
                Configuração da sua Estética:{' '}
                <strong
                  className={
                    resultado.tudoConcluido ? 'text-emerald-400' : 'text-amber-400'
                  }
                >
                  {resultado.porcentagem}% concluída
                </strong>
              </span>
              <div className="w-full sm:w-40 h-2 bg-graphite-950 rounded-full overflow-hidden border border-graphite-800">
                <div
                  className={`h-full transition-all duration-500 ease-out rounded-full ${
                    resultado.tudoConcluido
                      ? 'bg-emerald-500'
                      : 'bg-gradient-to-r from-amber-500 to-amber-300'
                  }`}
                  style={{ width: `${resultado.porcentagem}%` }}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-2 shrink-0 self-end sm:self-center">
            {resultado.tudoConcluido && (
              <button
                type="button"
                onClick={handleOcultarGuiaDefinitivo}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 min-h-[48px] sm:min-h-[34px] rounded-lg text-[11px] font-semibold text-vapor-300 hover:text-vapor-100 hover:bg-graphite-800 transition-colors"
              >
                <EyeOff size={12} />
                <span>Ocultar este guia do painel</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleToggleRecolhido}
              className="inline-flex items-center gap-1 px-3 py-1.5 min-h-[48px] sm:min-h-[34px] rounded-lg bg-graphite-800 hover:bg-graphite-700 text-vapor-200 border border-graphite-700 text-[11px] font-semibold transition-colors"
            >
              <span>Expandir guia</span>
              <ChevronDown size={13} />
            </button>
          </div>
        </Card>

        <ModalTutorialVideoCurto
          aberto={Boolean(tutorialSelecionado)}
          videoConfig={tutorialSelecionado}
          onFechar={() => setTutorialSelecionado(null)}
          onIrParaConfiguracao={(rota) => navigate(rota)}
        />
      </>
    );
  }

  // MODO EXPANDIDO (Calmo, 2 Fases Progressivas)
  return (
    <>
      <Card
        className={`p-4 sm:p-5 flex flex-col gap-4 transition-colors ${
          resultado.tudoConcluido
            ? 'bg-gradient-to-br from-emerald-950/25 via-graphite-900 to-graphite-900 border-emerald-500/40'
            : 'bg-graphite-900/95 border-graphite-700/80'
        }`}
      >
        {/* Cabeçalho + Barra de Progresso */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 flex-wrap">
                {resultado.tudoConcluido ? (
                  <Badge tone="mint" className="text-[10px] font-bold px-2.5 py-0.5">
                    <span className="flex items-center gap-1">
                      <CheckCircle2 size={11} />
                      Estética 100% Configurada!
                    </span>
                  </Badge>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/25 font-mono text-[10px] font-bold text-amber-400 uppercase tracking-wider">
                    <Sparkles size={11} />
                    Guia de Configuração
                  </span>
                )}
              </div>

              <h3 className="font-display text-base sm:text-lg text-vapor-100 uppercase tracking-wide flex items-center gap-2 flex-wrap">
                <span>
                  Configuração da sua Estética:{' '}
                  <span
                    className={
                      resultado.tudoConcluido ? 'text-emerald-400' : 'text-amber-400'
                    }
                  >
                    {resultado.porcentagem}% concluída
                  </span>
                </span>
              </h3>

              <p className="font-sans text-xs text-vapor-400 leading-relaxed">
                {resultado.tudoConcluido
                  ? 'Excelente trabalho! Sua estética está blindada e pronta para operar com orçamento, agenda e proteção jurídica completos.'
                  : 'Sua conta já nasceu funcional para orçar hoje mesmo. Avance nos passos no seu ritmo ou marque manualmente o que preferir manter no padrão.'}
              </p>
            </div>

            <div className="flex items-center flex-wrap gap-2 shrink-0 self-end sm:self-start">
              {resultado.tudoConcluido && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleOcultarGuiaDefinitivo}
                  className="text-xs px-3 py-1.5 min-h-[48px] sm:min-h-[34px] flex items-center gap-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/35"
                >
                  <EyeOff size={13} />
                  <span>Ocultar este guia do painel</span>
                </Button>
              )}

              <button
                type="button"
                onClick={handleToggleRecolhido}
                className="inline-flex items-center gap-1 px-3 py-1.5 min-h-[48px] sm:min-h-[34px] rounded-lg bg-graphite-800 hover:bg-graphite-700 text-vapor-300 border border-graphite-700 text-[11px] font-semibold transition-colors"
                title="Recolher guia para uma barra compacta"
              >
                <span>Recolher</span>
                <ChevronUp size={13} />
              </button>
            </div>
          </div>

          {/* Barra Animada */}
          <div className="w-full h-2.5 bg-graphite-950 rounded-full overflow-hidden border border-graphite-800">
            <div
              className={`h-full transition-all duration-500 ease-out rounded-full ${
                resultado.tudoConcluido
                  ? 'bg-gradient-to-r from-emerald-500 to-mint-400'
                  : 'bg-gradient-to-r from-amber-500 via-amber-400 to-emerald-400'
              }`}
              style={{ width: `${resultado.porcentagem}%` }}
            />
          </div>
        </div>

        {/* Etapa 1 — Exibida na área ativa apenas enquanto nenhuma tarefa adicional foi concluída */}
        {etapasConcluidasLista.length === 0 && (
          <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/25 text-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-5 h-5 rounded-md bg-emerald-500 text-graphite-950 flex items-center justify-center shrink-0">
                <Check size={13} strokeWidth={3} />
              </span>
              <span className="font-sans font-medium text-emerald-200 leading-snug line-clamp-2 break-words">
                1. {resultado.etapa1Texto}
              </span>
            </div>
            <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0">
              {resultado.basePercentual}% pronto
            </span>
          </div>
        )}

        {/* FASE 1 — Comece em 2 Minutos (exibe apenas tarefas pendentes; concluídas somem da lista) */}
        {etapasFase1Pendentes.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between px-1">
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-vapor-300">
                Fase 1 — Comece em 2 Minutos
              </span>
              <span className="font-mono text-[10px] text-vapor-400">
                {etapasFase1Pendentes.length}{' '}
                {etapasFase1Pendentes.length === 1 ? 'pendente' : 'pendentes'}
              </span>
            </div>

            <div className="flex flex-col gap-2">{etapasFase1Pendentes.map(renderLinhaEtapa)}</div>
          </div>
        )}

        {/* FASE 2 — Blindar Estética para Rodar sem Dor de Cabeça (exibe apenas pendentes) */}
        {etapasFase2Pendentes.length > 0 && (
          <div className="pt-1 border-t border-graphite-800/80 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setFase2AbertaManual(!mostrarFase2)}
              className="w-full min-h-[48px] flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-graphite-950/60 hover:bg-graphite-800/70 border border-graphite-800 transition-colors text-left"
            >
              <div className="flex items-center gap-2 min-w-0">
                <ShieldCheck size={15} className="text-amber-400 shrink-0" />
                <span className="font-sans text-xs font-medium text-vapor-200 leading-snug line-clamp-2 break-words">
                  {mostrarFase2
                    ? 'Fase 2 — Blindar Estética para Rodar sem Dor de Cabeça'
                    : `Pronto para colocar na rua? Ver ${etapasFase2Pendentes.length} ajuste${etapasFase2Pendentes.length === 1 ? '' : 's'} essencia${etapasFase2Pendentes.length === 1 ? 'l' : 'is'}`}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-graphite-900 text-vapor-300 border border-graphite-700">
                  {etapasFase2Pendentes.length} pendente{etapasFase2Pendentes.length === 1 ? '' : 's'}
                </span>
                {mostrarFase2 ? (
                  <ChevronUp size={14} className="text-vapor-400" />
                ) : (
                  <ChevronDown size={14} className="text-vapor-400" />
                )}
              </div>
            </button>

            {mostrarFase2 && (
              <div className="flex flex-col gap-2 pt-1">
                {etapasFase2Pendentes.map(renderLinhaEtapa)}
              </div>
            )}
          </div>
        )}

        {/* Gaveta discreta e recolhida por padrão para etapas já concluídas (zero poluição visual no painel) */}
        {etapasConcluidasLista.length > 0 && (
          <div className="pt-1 border-t border-graphite-800/70 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setMostrarConcluidas((prev) => !prev)}
              className="self-start min-h-[48px] sm:min-h-[32px] inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-400/90 hover:text-emerald-300 transition-colors cursor-pointer"
            >
              <CheckCircle2 size={13} />
              <span>
                {mostrarConcluidas
                  ? `Ocultar etapas concluídas (${etapasConcluidasLista.length + 1})`
                  : `Ver etapas já concluídas (${etapasConcluidasLista.length + 1})`}
              </span>
              {mostrarConcluidas ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>

            {mostrarConcluidas && (
              <div className="flex flex-col gap-1.5 pt-1">
                <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-emerald-500/[0.04] border border-emerald-500/20 text-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-5 h-5 rounded-md bg-emerald-500 text-graphite-950 flex items-center justify-center shrink-0">
                      <Check size={13} strokeWidth={3} />
                    </span>
                    <span className="font-sans text-[12px] text-vapor-300 line-through decoration-emerald-500/40 leading-snug line-clamp-2 break-words">
                      1. {resultado.etapa1Texto}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 shrink-0">
                    {resultado.basePercentual}% base
                  </span>
                </div>
                {etapasConcluidasLista.map(renderLinhaEtapa)}
              </div>
            )}
          </div>
        )}
      </Card>

      <ModalTutorialVideoCurto
        aberto={Boolean(tutorialSelecionado)}
        videoConfig={tutorialSelecionado}
        onFechar={() => setTutorialSelecionado(null)}
        onIrParaConfiguracao={(rota) => navigate(rota)}
      />
    </>
  );
};

