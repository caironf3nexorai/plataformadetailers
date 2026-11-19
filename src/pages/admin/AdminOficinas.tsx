import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { useAdminAuth } from '../../components/admin/AdminGuard';
import { 
  Search, 
  Building2, 
  Users, 
  Clock, 
  AlertTriangle,
  X,
  Activity,
  Edit2,
  LogIn,
  UserX,
  UserCheck,
  MessageCircle,
  Gift,
  Car,
  ChevronRight,
  ChevronLeft,
  History,
  Check,
  Sliders
} from 'lucide-react';
import { formatTelefone, cleanTelefone } from '../../utils/formatters';
import {
  CORTESIA_DURACAO_OPCOES,
  calcularDataFimCortesiaISO,
  formatarDataSegura,
} from '../../utils/assinatura';

export interface ContaRadarItem {
  tenant_id: string;
  nome_estetica: string;
  slug: string;
  plano: 'free' | 'pro' | 'studio';
  cidade: string | null;
  uf: string | null;
  dono_id: string | null;
  nome_dono: string;
  telefone_dono: string | null;
  email_dono: string | null;
  data_cadastro: string;
  ultimo_acesso: string | null;
  ultima_acao_label: string | null;
  ultima_acao_em: string | null;
  assinatura_status: string;
  trial_fim: string | null;
  dias_trial_restantes: number;
  total_clientes_reais: number;
  total_servicos: number;
  total_servicos_customizados: number;
  total_agendamentos: number;
  total_execucoes: number;
  total_vistorias: number;
  total_veiculos: number;
  score: 'operando' | 'configurando' | 'so_cadastro';
}

export interface RadarResumo {
  total_contas: number;
  total_ativos_hoje: number;
  total_operando: number;
  total_trial_vencendo: number;
}

export interface RadarPaginacao {
  pagina_atual: number;
  limite: number;
  total_filtrados: number;
  total_paginas: number;
}

export interface UserActivityLogItem {
  id: string;
  user_id: string;
  user_nome: string;
  user_email: string;
  event_type: 'page_view' | 'action';
  route: string | null;
  label: string;
  created_at: string;
}

interface TenantDetailLegacy {
  membros: Array<{
    id: string;
    user_id?: string;
    email: string;
    nome: string;
    telefone?: string | null;
    role: string;
    status: string;
    ultimo_acesso: string | null;
  }>;
  historico_12m: Array<{
    mes: string;
    agendamentos_criados: number;
    execucoes_finalizadas: number;
  }>;
  storage: Array<{
    bucket: string;
    total_arquivos: number;
    total_bytes: number;
    calculado_em: string;
  }>;
}

function formatarTempoRelativo(isoString?: string | null): string {
  if (!isoString) return 'Nunca acessou';
  const data = new Date(isoString);
  const agora = new Date();
  const diffSegundos = Math.floor((agora.getTime() - data.getTime()) / 1000);

  if (diffSegundos < 60) return 'agora mesmo';
  if (diffSegundos < 3600) return `há ${Math.floor(diffSegundos / 60)} min`;
  if (diffSegundos < 86400) return `há ${Math.floor(diffSegundos / 3600)}h`;
  if (diffSegundos < 172800) return 'ontem';
  const dias = Math.floor(diffSegundos / 86400);
  if (dias < 30) return `há ${dias} dias`;
  return formatarDataSegura(isoString);
}

function obterLinkWhatsApp(telefone?: string | null, nomeOficina?: string): string | null {
  if (!telefone) return null;
  const limpo = cleanTelefone(telefone);
  if (!limpo || limpo.length < 8) return null;
  const ddi = limpo.startsWith('55') ? limpo : `55${limpo}`;
  const texto = encodeURIComponent(`Olá! Aqui é da equipe da Plataforma Detailers. Como estão os testes na ${nomeOficina || 'sua oficina'}?`);
  return `https://wa.me/${ddi}?text=${texto}`;
}

export const AdminOficinas: React.FC = () => {
  const { showSuccess, showError } = useToast();
  const navigate = useNavigate();
  const { trocarTenant } = useAuth();
  const { adminLevel } = useAdminAuth();
  const isReadOnly = adminLevel === 'suporte';

  // Estados do Radar
  const [contas, setContas] = useState<ContaRadarItem[]>([]);
  const [resumo, setResumo] = useState<RadarResumo>({
    total_contas: 0,
    total_ativos_hoje: 0,
    total_operando: 0,
    total_trial_vencendo: 0,
  });
  const [paginacao, setPaginacao] = useState<RadarPaginacao>({
    pagina_atual: 1,
    limite: 20,
    total_filtrados: 0,
    total_paginas: 1,
  });

  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [buscaDebounced, setBuscaDebounced] = useState('');
  const [scoreFiltro, setScoreFiltro] = useState<'todos' | 'operando' | 'configurando' | 'so_cadastro'>('todos');
  const [paginaAtual, setPaginaAtual] = useState(1);

  // Estados do Drawer e Detalhes
  const [selectedConta, setSelectedConta] = useState<ContaRadarItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'timeline' | 'membros' | 'geral'>('timeline');
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [timelineLogs, setTimelineLogs] = useState<UserActivityLogItem[]>([]);
  const [legacyDetail, setLegacyDetail] = useState<TenantDetailLegacy | null>(null);
  const [estendendoTrial, setEstendendoTrial] = useState(false);

  // Modais Administrativos
  const [modalPlanoOpen, setModalPlanoOpen] = useState(false);
  const [targetTenant, setTargetTenant] = useState<{
    id: string;
    nome: string;
    planoAtual: string;
    asaasSubId?: string | null;
  } | null>(null);
  const [novoPlano, setNovoPlano] = useState<'free' | 'pro' | 'studio'>('pro');
  const [isCortesiaAdmin, setIsCortesiaAdmin] = useState(true);
  const [duracaoCortesiaId, setDuracaoCortesiaId] = useState<string>('30d');
  const [motivoCortesia, setMotivoCortesia] = useState('');
  const [savingPlano, setSavingPlano] = useState(false);

  // Modal Nome Oficina
  const [modalEditarOficina, setModalEditarOficina] = useState<{
    id: string;
    nome: string;
    slug: string;
    nome_alterado_em?: string | null;
  } | null>(null);
  const [novoNomeOficina, setNovoNomeOficina] = useState('');
  const [novoSlugOficina, setNovoSlugOficina] = useState('');
  const [salvandoNomeOficina, setSalvandoNomeOficina] = useState(false);

  // Modal Editar Usuário
  const [modalEditarUsuario, setModalEditarUsuario] = useState<{
    user_id?: string;
    email: string;
    nome: string;
    telefone?: string | null;
  } | null>(null);
  const [novoNomeUsuario, setNovoNomeUsuario] = useState('');
  const [novoTelefoneUsuario, setNovoTelefoneUsuario] = useState('');
  const [salvandoUsuario, setSalvandoUsuario] = useState(false);

  // Modal Exclusão
  const [modalExcluirOpen, setModalExcluirOpen] = useState(false);
  const [tenantParaExcluir, setTenantParaExcluir] = useState<{ id: string; nome: string; slug: string } | null>(null);
  const [confirmacaoNomeExclusao, setConfirmacaoNomeExclusao] = useState('');
  const [purgarAuthNaExclusao, setPurgarAuthNaExclusao] = useState(true);
  const [excluindoTenant, setExcluindoTenant] = useState(false);

  // Modal Purgar E-mail
  const [modalPurgarEmailOpen, setModalPurgarEmailOpen] = useState(false);
  const [emailParaPurgar, setEmailParaPurgar] = useState('');
  const [purgandoEmail, setPurgandoEmail] = useState(false);

  // Debounce na barra de busca (400ms)
  useEffect(() => {
    const handler = setTimeout(() => {
      setBuscaDebounced(busca);
      setPaginaAtual(1);
    }, 400);
    return () => clearTimeout(handler);
  }, [busca]);

  // Carrega Radar de Ativação
  const carregarRadar = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_obter_radar_ativacao', {
        p_pagina: paginaAtual,
        p_limite: 20,
        p_busca: buscaDebounced.trim() || null,
        p_score: scoreFiltro !== 'todos' ? scoreFiltro : null,
      });

      if (error) throw error;

      if (data) {
        setResumo(data.resumo || {
          total_contas: 0,
          total_ativos_hoje: 0,
          total_operando: 0,
          total_trial_vencendo: 0,
        });
        setPaginacao(data.paginacao || {
          pagina_atual: 1,
          limite: 20,
          total_filtrados: 0,
          total_paginas: 1,
        });
        setContas(data.contas || []);
      }
    } catch (err: any) {
      console.error('[AdminRadar] Erro ao carregar radar:', err);
      showError(err.message || 'Erro ao carregar dados do Radar de Ativação.');
    } finally {
      setLoading(false);
    }
  }, [paginaAtual, buscaDebounced, scoreFiltro, showError]);

  useEffect(() => {
    carregarRadar();
  }, [carregarRadar]);

  // Atualização em Tempo Real (Supabase Realtime) no Radar e Timeline ao vivo
  useEffect(() => {
    const canal = supabase
      .channel('radar_user_activity_realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'user_activity_logs',
        },
        async () => {
          // 1. Atualiza lista do radar e cards de métricas em segundo plano
          carregarRadar();

          // 2. Se houver uma oficina com a timeline aberta, atualiza a timeline automaticamente
          if (selectedConta) {
            try {
              const { data: logsData, error: logsError } = await supabase.rpc('admin_obter_timeline_usuario', {
                p_tenant_id: selectedConta.tenant_id,
                p_limite: 50,
              });
              if (!logsError && logsData) {
                setTimelineLogs(logsData);
              }
            } catch (err) {
              console.warn('[AdminRadar] Erro ao sincronizar timeline realtime:', err);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, [carregarRadar, selectedConta]);

  // Carrega Timeline e Detalhes da Conta Selecionada
  const handleAbrirDrawer = async (conta: ContaRadarItem) => {
    setSelectedConta(conta);
    setDrawerOpen(true);
    setDrawerTab('timeline');
    setLoadingTimeline(true);

    try {
      // 1. Busca timeline cronológica
      const { data: logsData, error: logsError } = await supabase.rpc('admin_obter_timeline_usuario', {
        p_tenant_id: conta.tenant_id,
        p_limite: 50,
      });

      if (!logsError && logsData) {
        setTimelineLogs(logsData);
      } else {
        setTimelineLogs([]);
      }

      // 2. Busca dados de apoio (membros legados e storage)
      const { data: detailData } = await supabase.rpc('admin_detalhe_tenant', {
        p_tenant_id: conta.tenant_id,
      });

      if (detailData) {
        setLegacyDetail(detailData);
      }
    } catch (err) {
      console.error('[AdminRadar] Erro ao carregar timeline:', err);
      setTimelineLogs([]);
    } finally {
      setLoadingTimeline(false);
    }
  };

  // Estender Trial em +15 dias com um clique
  const handleEstenderTrial = async (tenantId: string) => {
    if (isReadOnly) {
      showError('Apenas administradores editores podem estender trial.');
      return;
    }

    setEstendendoTrial(true);
    try {
      const { data, error } = await supabase.rpc('admin_estender_trial', {
        p_tenant_id: tenantId,
        p_dias: 15,
      });

      if (error) throw error;

      showSuccess(`Trial estendido em +15 dias com sucesso! Novo vencimento: ${formatarDataSegura(data.novo_trial_fim)}`);

      // Atualiza estado local da conta selecionada
      if (selectedConta && selectedConta.tenant_id === tenantId) {
        setSelectedConta({
          ...selectedConta,
          trial_fim: data.novo_trial_fim,
          dias_trial_restantes: data.dias_restantes,
          assinatura_status: 'trial',
        });
      }

      // Atualiza na listagem
      setContas(prev => prev.map(c => {
        if (c.tenant_id === tenantId) {
          return {
            ...c,
            trial_fim: data.novo_trial_fim,
            dias_trial_restantes: data.dias_restantes,
            assinatura_status: 'trial',
          };
        }
        return c;
      }));

      // Recarrega radar para métricas atualizadas
      carregarRadar();
    } catch (err: any) {
      console.error('[AdminRadar] Erro ao estender trial:', err);
      showError(err.message || 'Erro ao estender o período de testes.');
    } finally {
      setEstendendoTrial(false);
    }
  };

  const handleAcessarOficina = (id: string) => {
    trocarTenant(id);
    navigate('/');
  };

  // Handlers Administrativos Legados
  const handleAbrirModalPlano = (id: string, nome: string, plano: string, asaasSubId?: string | null) => {
    setTargetTenant({ id, nome, planoAtual: plano, asaasSubId });
    setNovoPlano(plano as any);
    setIsCortesiaAdmin(true);
    setDuracaoCortesiaId('30d');
    setMotivoCortesia('');
    setModalPlanoOpen(true);
  };

  const handleAlterarPlanoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetTenant || isReadOnly) return;
    setSavingPlano(true);

    try {
      let dataFimIso: string | null = null;
      const opcaoCortesia = CORTESIA_DURACAO_OPCOES.find(o => o.id === duracaoCortesiaId);
      if (isCortesiaAdmin && novoPlano !== 'free') {
        dataFimIso = calcularDataFimCortesiaISO(opcaoCortesia?.dias);
      }

      const { error } = await supabase.rpc('admin_alterar_plano_manual', {
        p_tenant_id: targetTenant.id,
        p_novo_plano: novoPlano,
        p_is_cortesia: isCortesiaAdmin && novoPlano !== 'free',
        p_cortesia_ate: dataFimIso,
        p_motivo: motivoCortesia.trim() || (isCortesiaAdmin ? `Cortesia concedida (${opcaoCortesia?.label || '30 dias'})` : 'Ajuste administrativo'),
      });

      if (error) throw error;

      showSuccess(`Plano de "${targetTenant.nome}" atualizado com sucesso!`);
      setModalPlanoOpen(false);
      carregarRadar();
      if (selectedConta) {
        handleAbrirDrawer(selectedConta);
      }
    } catch (err: any) {
      showError(err.message || 'Erro ao alterar plano.');
    } finally {
      setSavingPlano(false);
    }
  };

  const handleAbrirModalExcluir = (id: string, nome: string, slug: string) => {
    setTenantParaExcluir({ id, nome, slug });
    setConfirmacaoNomeExclusao('');
    setPurgarAuthNaExclusao(true);
    setModalExcluirOpen(true);
  };

  const handleConfirmarExcluir = async () => {
    if (!tenantParaExcluir || isReadOnly) return;
    if (confirmacaoNomeExclusao.trim() !== tenantParaExcluir.nome.trim()) {
      showError('O nome digitado não coincide com o nome da oficina.');
      return;
    }

    setExcluindoTenant(true);
    try {
      const { error } = await supabase.rpc('admin_excluir_oficina_e_usuario', {
        p_tenant_id: tenantParaExcluir.id,
        p_purga_auth: purgarAuthNaExclusao,
      });

      if (error) throw error;

      showSuccess(`Oficina "${tenantParaExcluir.nome}" excluída com sucesso.`);
      setModalExcluirOpen(false);
      setDrawerOpen(false);
      setSelectedConta(null);
      carregarRadar();
    } catch (err: any) {
      showError(err.message || 'Erro ao excluir oficina.');
    } finally {
      setExcluindoTenant(false);
    }
  };

  const handleAbrirModalEditarOficina = (id: string, nome: string, slug: string, alteradoEm?: string | null) => {
    setModalEditarOficina({ id, nome, slug, nome_alterado_em: alteradoEm });
    setNovoNomeOficina(nome);
    setNovoSlugOficina(slug);
  };

  const handleSalvarNomeOficina = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalEditarOficina || isReadOnly) return;
    setSalvandoNomeOficina(true);

    try {
      const { error } = await supabase.rpc('admin_atualizar_nome_oficina', {
        p_tenant_id: modalEditarOficina.id,
        p_novo_nome: novoNomeOficina.trim(),
        p_novo_slug: novoSlugOficina.trim() || null,
      });

      if (error) throw error;

      showSuccess('Nome da oficina atualizado com sucesso.');
      setModalEditarOficina(null);
      carregarRadar();
      if (selectedConta) {
        setSelectedConta({
          ...selectedConta,
          nome_estetica: novoNomeOficina.trim(),
          slug: novoSlugOficina.trim() || selectedConta.slug,
        });
      }
    } catch (err: any) {
      showError(err.message || 'Erro ao atualizar nome da oficina.');
    } finally {
      setSalvandoNomeOficina(false);
    }
  };

  const handleAbrirModalEditarUsuario = (m: { user_id?: string; email: string; nome: string; telefone?: string | null }) => {
    setModalEditarUsuario(m);
    setNovoNomeUsuario(m.nome || '');
    setNovoTelefoneUsuario(m.telefone || '');
  };

  const handleSalvarEditarUsuario = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalEditarUsuario || isReadOnly) return;
    setSalvandoUsuario(true);

    try {
      const { error } = await supabase.rpc('admin_atualizar_usuario_perfil', {
        p_target_email: modalEditarUsuario.email,
        p_target_user_id: modalEditarUsuario.user_id || null,
        p_novo_nome: novoNomeUsuario.trim(),
        p_novo_telefone: novoTelefoneUsuario.trim() || null,
      });

      if (error) throw error;

      showSuccess('Perfil do usuário atualizado com sucesso.');
      setModalEditarUsuario(null);
      carregarRadar();
      if (selectedConta) {
        handleAbrirDrawer(selectedConta);
      }
    } catch (err: any) {
      showError(err.message || 'Erro ao atualizar usuário.');
    } finally {
      setSalvandoUsuario(false);
    }
  };

  const handlePurgarEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailParaPurgar.trim() || isReadOnly) return;
    setPurgandoEmail(true);

    try {
      const { error } = await supabase.rpc('admin_purgar_usuario_por_email', {
        p_email: emailParaPurgar.trim(),
      });

      if (error) throw error;

      showSuccess(`E-mail ${emailParaPurgar.trim()} purgado com sucesso.`);
      setModalPurgarEmailOpen(false);
      setEmailParaPurgar('');
      carregarRadar();
    } catch (err: any) {
      showError(err.message || 'Erro ao purgar e-mail.');
    } finally {
      setPurgandoEmail(false);
    }
  };

  // Renderizadores de Badges
  const renderScoreBadge = (score: 'operando' | 'configurando' | 'so_cadastro') => {
    switch (score) {
      case 'operando':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-sm shadow-emerald-500/10">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Operando no Pátio
          </span>
        );
      case 'configurando':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            Configurando
          </span>
        );
      case 'so_cadastro':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
            <span className="w-2 h-2 rounded-full bg-rose-400" />
            Só cadastrou
          </span>
        );
    }
  };

  const renderTrialBadge = (c: ContaRadarItem) => {
    if (c.assinatura_status === 'ativa') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
          <Check className="w-3 h-3 text-emerald-400" /> Assinatura Ativa
        </span>
      );
    }

    if (c.assinatura_status === 'cortesia') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-medium bg-purple-500/10 text-purple-300 border border-purple-500/20">
          <Gift className="w-3 h-3 text-purple-400" /> Cortesia
        </span>
      );
    }

    if (c.dias_trial_restantes > 0) {
      if (c.dias_trial_restantes <= 3) {
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
            <Clock className="w-3 h-3 text-amber-400" /> {c.dias_trial_restantes}d de trial
          </span>
        );
      }
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-medium bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
          <Clock className="w-3 h-3 text-cyan-400" /> {c.dias_trial_restantes}d de trial
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono text-slate-400 bg-slate-800/80 border border-slate-700">
        Free / Expirado
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header do Radar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold font-heading text-white">Radar de Ativação de Contas</h1>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              Tempo Real
            </span>
          </div>
          <p className="text-slate-400 text-sm">
            Monitore o engajamento real, ative contas pelo WhatsApp e conceda extensão de trial com 1 clique.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/admin/contas')}
            className="flex items-center space-x-1.5 text-xs font-mono font-bold text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 px-3 py-1.5 rounded-lg transition shadow-sm cursor-pointer"
            title="Ver todas as contas no Supabase Auth"
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Contas Auth</span>
          </button>

          <button
            type="button"
            disabled={isReadOnly}
            onClick={() => {
              setEmailParaPurgar('');
              setModalPurgarEmailOpen(true);
            }}
            className="flex items-center space-x-1.5 text-xs font-mono font-bold text-red-400 hover:text-red-300 disabled:opacity-40 disabled:cursor-not-allowed bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 px-3 py-1.5 rounded-lg transition shadow-sm cursor-pointer"
            title="Exclui um e-mail do auth.users para liberar novo cadastro"
          >
            <UserX className="w-3.5 h-3.5" />
            <span>Liberar E-mail</span>
          </button>
        </div>
      </div>

      {/* 4 Cards de Resumo no Topo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Card 1: Total de Contas */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col justify-between shadow-lg">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs sm:text-sm font-medium">Total de Contas</span>
            <div className="p-2 rounded-xl bg-slate-800 text-slate-300">
              <Building2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-white font-mono">
            {resumo.total_contas}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Estéticas cadastradas</p>
        </div>

        {/* Card 2: Ativos Hoje */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col justify-between shadow-lg">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs sm:text-sm font-medium">Ativos Hoje</span>
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <div className="text-2xl sm:text-3xl font-extrabold text-emerald-400 font-mono">
              {resumo.total_ativos_hoje}
            </div>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Acessaram nas últimas 24h</p>
        </div>

        {/* Card 3: Operando no Pátio */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col justify-between shadow-lg">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs sm:text-sm font-medium">Operando no Pátio</span>
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
              <Car className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-white font-mono">
            {resumo.total_operando}
          </div>
          <p className="text-[11px] text-emerald-500/90 font-medium mt-1">🟢 Clientes + OS/Vistoria</p>
        </div>

        {/* Card 4: Trial Vencendo */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col justify-between shadow-lg">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs sm:text-sm font-medium">Trial Vencendo</span>
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-amber-400 font-mono">
            {resumo.total_trial_vencendo}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">⏳ Vence em até 3 dias</p>
        </div>
      </div>

      {/* Barra de Pesquisa e Filtros Rápidos por Score */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col lg:flex-row items-center justify-between gap-4 shadow-sm">
        {/* Input de Busca */}
        <div className="relative w-full lg:w-96">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por estética, dono, e-mail ou WhatsApp..."
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/50 transition"
          />
        </div>

        {/* Pílulas de Filtro por Score */}
        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto justify-start lg:justify-end">
          <button
            type="button"
            onClick={() => { setScoreFiltro('todos'); setPaginaAtual(1); }}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
              scoreFiltro === 'todos'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            Todos
          </button>

          <button
            type="button"
            onClick={() => { setScoreFiltro('operando'); setPaginaAtual(1); }}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
              scoreFiltro === 'operando'
                ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                : 'bg-slate-950 text-slate-400 hover:text-emerald-400 border border-slate-800'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            🟢 Operando
          </button>

          <button
            type="button"
            onClick={() => { setScoreFiltro('configurando'); setPaginaAtual(1); }}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
              scoreFiltro === 'configurando'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'bg-slate-950 text-slate-400 hover:text-amber-400 border border-slate-800'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            🟡 Configurando
          </button>

          <button
            type="button"
            onClick={() => { setScoreFiltro('so_cadastro'); setPaginaAtual(1); }}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
              scoreFiltro === 'so_cadastro'
                ? 'bg-rose-500 text-white shadow-md shadow-rose-500/20'
                : 'bg-slate-950 text-slate-400 hover:text-rose-400 border border-slate-800'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
            🔴 Só cadastrou
          </button>
        </div>
      </div>

      {/* Conteúdo: Loading, Vazio ou Dados */}
      {loading ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-16 text-center text-slate-400 shadow-lg">
          <div className="animate-spin rounded-full h-9 w-9 border-t-2 border-b-2 border-amber-500 mx-auto mb-3" />
          <p className="text-sm font-medium">Varrendo atividades e calculando scores do radar...</p>
        </div>
      ) : contas.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-16 text-center text-slate-500 shadow-lg">
          <p className="text-base font-semibold text-slate-300">Nenhuma conta encontrada</p>
          <p className="text-xs text-slate-500 mt-1">Tente ajustar os filtros de busca ou de score de uso.</p>
        </div>
      ) : (
        <>
          {/* VISUALIZAÇÃO DESKTOP (md: acima) - Tabela Completa */}
          <div className="hidden md:block bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="bg-slate-950/80 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="px-4 py-3.5">Estética & Dono</th>
                    <th className="px-4 py-3.5">WhatsApp / Contato</th>
                    <th className="px-4 py-3.5 text-center">Score de Uso</th>
                    <th className="px-4 py-3.5 text-center">Contadores Reais</th>
                    <th className="px-4 py-3.5">Status & Trial</th>
                    <th className="px-4 py-3.5">Última Atividade</th>
                    <th className="px-4 py-3.5 text-right font-mono">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {contas.map((c) => {
                    const waLink = obterLinkWhatsApp(c.telefone_dono, c.nome_estetica);
                    return (
                      <tr 
                        key={c.tenant_id} 
                        onClick={() => handleAbrirDrawer(c)}
                        className="hover:bg-slate-800/60 transition cursor-pointer group"
                      >
                        {/* Estética & Dono */}
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white group-hover:text-amber-400 transition">{c.nome_estetica}</span>
                            <span className="text-[10px] font-mono uppercase bg-slate-800 px-1.5 py-0.5 rounded text-slate-400 border border-slate-700">
                              {c.plano}
                            </span>
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            {c.nome_dono} {c.cidade ? `• ${c.cidade}/${c.uf}` : ''}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            {c.email_dono}
                          </div>
                        </td>

                        {/* WhatsApp / Contato */}
                        <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                          {waLink ? (
                            <a
                              href={waLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 transition shadow-sm"
                              title="Abrir conversa de ativação no WhatsApp"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                              <span>{formatTelefone(c.telefone_dono || '')}</span>
                            </a>
                          ) : (
                            <span className="text-xs text-slate-500 italic">Sem telefone</span>
                          )}
                        </td>

                        {/* Score de Uso */}
                        <td className="px-4 py-3.5 text-center">
                          {renderScoreBadge(c.score)}
                        </td>

                        {/* Contadores Reais */}
                        <td className="px-4 py-3.5 text-center font-mono text-xs">
                          <div className="flex items-center justify-center gap-2 text-slate-300">
                            <span title="Clientes Reais">👥 <strong className="text-white">{c.total_clientes_reais}</strong></span>
                            <span className="text-slate-600">•</span>
                            <span title="Serviços">🛠️ <strong className="text-white">{c.total_servicos}</strong></span>
                            <span className="text-slate-600">•</span>
                            <span title="Agendamentos / OS">📋 <strong className="text-white">{c.total_agendamentos}</strong></span>
                            <span className="text-slate-600">•</span>
                            <span title="Vistorias">🔍 <strong className="text-white">{c.total_vistorias}</strong></span>
                          </div>
                        </td>

                        {/* Status & Trial */}
                        <td className="px-4 py-3.5">
                          {renderTrialBadge(c)}
                        </td>

                        {/* Última Atividade */}
                        <td className="px-4 py-3.5">
                          <div className="text-xs text-slate-200 font-medium">
                            {formatarTempoRelativo(c.ultimo_acesso)}
                          </div>
                          {c.ultima_acao_label && (
                            <div className="text-[11px] text-slate-500 truncate max-w-[180px]" title={c.ultima_acao_label}>
                              {c.ultima_acao_label}
                            </div>
                          )}
                        </td>

                        {/* Ações */}
                        <td className="px-4 py-3.5 text-right font-mono" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleAcessarOficina(c.tenant_id)}
                              className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-emerald-400 rounded-lg transition cursor-pointer"
                              title="Acessar painel desta oficina no App"
                            >
                              <LogIn className="w-4 h-4" />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleAbrirDrawer(c)}
                              className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-amber-400 rounded-lg transition cursor-pointer"
                              title="Ver histórico e timeline"
                            >
                              <History className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* VISUALIZAÇÃO MOBILE (< md) - Cards Empilhados Sem Scroll */}
          <div className="block md:hidden space-y-3.5">
            {contas.map((c) => {
              const waLink = obterLinkWhatsApp(c.telefone_dono, c.nome_estetica);
              return (
                <div 
                  key={c.tenant_id} 
                  className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-md"
                >
                  {/* Topo do Card */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h3 className="font-bold text-white text-base leading-tight">{c.nome_estetica}</h3>
                        <span className="text-[10px] font-mono uppercase bg-slate-800 px-1.5 py-0.2 rounded text-slate-400 border border-slate-700">
                          {c.plano}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {c.nome_dono} {c.cidade ? `• ${c.cidade}/${c.uf}` : ''}
                      </p>
                    </div>
                    {renderScoreBadge(c.score)}
                  </div>

                  {/* Status do Trial e Último Acesso */}
                  <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800/80">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-slate-400">Último:</span>
                      <span className="font-medium text-slate-200">{formatarTempoRelativo(c.ultimo_acesso)}</span>
                    </div>
                    <div>
                      {renderTrialBadge(c)}
                    </div>
                  </div>

                  {/* Contadores em linha */}
                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl px-3 py-2 flex items-center justify-around text-xs font-mono text-slate-300">
                    <span title="Clientes">👥 <strong className="text-white">{c.total_clientes_reais}</strong></span>
                    <span className="text-slate-700">•</span>
                    <span title="Serviços">🛠️ <strong className="text-white">{c.total_servicos}</strong></span>
                    <span className="text-slate-700">•</span>
                    <span title="Agendamentos">📋 <strong className="text-white">{c.total_agendamentos}</strong></span>
                    <span className="text-slate-700">•</span>
                    <span title="Vistorias">🔍 <strong className="text-white">{c.total_vistorias}</strong></span>
                  </div>

                  {/* Última Ação do Usuário */}
                  {c.ultima_acao_label && (
                    <p className="text-[11px] text-slate-400 truncate">
                      Última ação: <strong className="text-slate-200">{c.ultima_acao_label}</strong>
                    </p>
                  )}

                  {/* Dois Botões Grandes na Base */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleAbrirDrawer(c)}
                      className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl font-bold text-xs bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 transition cursor-pointer shadow-sm"
                    >
                      <History className="w-4 h-4 text-amber-400" />
                      <span>Ver Histórico</span>
                    </button>

                    {waLink ? (
                      <a
                        href={waLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl font-bold text-xs bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-950 transition cursor-pointer"
                      >
                        <MessageCircle className="w-4 h-4" />
                        <span>WhatsApp</span>
                      </a>
                    ) : (
                      <button
                        type="button"
                        disabled
                        className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl font-semibold text-xs bg-slate-800/40 text-slate-600 border border-slate-800 cursor-not-allowed"
                      >
                        <MessageCircle className="w-4 h-4" />
                        <span>Sem WhatsApp</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Paginação */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-sm">
            <div className="text-xs text-slate-400 font-mono">
              Página <strong className="text-white">{paginacao.pagina_atual}</strong> de <strong className="text-white">{paginacao.total_paginas}</strong> (Total: <strong className="text-amber-400">{paginacao.total_filtrados}</strong> contas)
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={paginaAtual <= 1}
                onClick={() => setPaginaAtual(prev => Math.max(1, prev - 1))}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-950 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed border border-slate-800 text-slate-300 flex items-center gap-1 transition cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Anterior
              </button>

              <button
                type="button"
                disabled={paginaAtual >= paginacao.total_paginas}
                onClick={() => setPaginaAtual(prev => Math.min(paginacao.total_paginas, prev + 1))}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-950 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed border border-slate-800 text-slate-300 flex items-center gap-1 transition cursor-pointer"
              >
                Próxima
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* DRAWER LATERAL (Desktop) & MODAL TELA CHEIA / BOTTOM SHEET (Mobile) */}
      {drawerOpen && selectedConta && createPortal(
        <div className="fixed inset-0 z-[90] bg-slate-950/80 backdrop-blur-sm flex justify-end animate-in fade-in duration-200">
          <div className="bg-slate-900 border-l border-slate-800 w-full max-w-2xl h-full flex flex-col overflow-hidden shadow-2xl animate-in slide-in-from-right duration-200">
            
            {/* Header do Drawer */}
            <div className="p-4 sm:p-6 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg sm:text-xl font-bold text-white leading-tight">
                    {selectedConta.nome_estetica}
                  </h2>
                  <button
                    type="button"
                    onClick={() => handleAbrirModalEditarOficina(selectedConta.tenant_id, selectedConta.nome_estetica, selectedConta.slug)}
                    className="p-1 hover:bg-slate-800 text-slate-400 hover:text-amber-400 rounded-lg transition cursor-pointer"
                    title="Alterar Nome da Oficina"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400 mt-1 flex-wrap">
                  <span>Dono: <strong className="text-slate-200">{selectedConta.nome_dono}</strong></span>
                  <span>•</span>
                  <span>{selectedConta.email_dono}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => { setDrawerOpen(false); setSelectedConta(null); }}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Ações de Destaque no Topo do Drawer (+15 Dias e WhatsApp) */}
            <div className="p-4 sm:p-6 bg-slate-950/30 border-b border-slate-800/80 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {renderScoreBadge(selectedConta.score)}
                  {renderTrialBadge(selectedConta)}
                </div>

                {/* Botão +15 Dias de Trial (Oculto se assinatura for ativa) */}
                {selectedConta.assinatura_status !== 'ativa' && (
                  <button
                    type="button"
                    disabled={isReadOnly || estendendoTrial}
                    onClick={() => handleEstenderTrial(selectedConta.tenant_id)}
                    className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-bold text-xs sm:text-sm bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 shadow-lg shadow-amber-500/20 transition disabled:opacity-50 cursor-pointer"
                  >
                    <Clock className="w-4 h-4" />
                    <span>{estendendoTrial ? 'Estendendo...' : '+15 Dias de Trial'}</span>
                  </button>
                )}
              </div>

              {/* Botões de Acesso Rápido */}
              <div className="flex items-center gap-2 flex-wrap pt-1">
                {obterLinkWhatsApp(selectedConta.telefone_dono, selectedConta.nome_estetica) && (
                  <a
                    href={obterLinkWhatsApp(selectedConta.telefone_dono, selectedConta.nome_estetica)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 transition shadow-sm"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    <span>WhatsApp ({formatTelefone(selectedConta.telefone_dono || '')})</span>
                  </a>
                )}

                <button
                  type="button"
                  onClick={() => handleAcessarOficina(selectedConta.tenant_id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
                >
                  <LogIn className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Acessar no App</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleAbrirModalPlano(selectedConta.tenant_id, selectedConta.nome_estetica, selectedConta.plano)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
                >
                  <Edit2 className="w-3.5 h-3.5 text-amber-400" />
                  <span>Alterar Plano</span>
                </button>
              </div>
            </div>

            {/* Abas do Drawer */}
            <div className="flex items-center border-b border-slate-800 px-4 sm:px-6 bg-slate-950/20">
              <button
                type="button"
                onClick={() => setDrawerTab('timeline')}
                className={`py-3 px-4 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 transition cursor-pointer ${
                  drawerTab === 'timeline'
                    ? 'border-amber-500 text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <History className="w-4 h-4 text-amber-400" />
                <span>Histórico de Atividade</span>
              </button>

              <button
                type="button"
                onClick={() => setDrawerTab('membros')}
                className={`py-3 px-4 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 transition cursor-pointer ${
                  drawerTab === 'membros'
                    ? 'border-amber-500 text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Users className="w-4 h-4 text-slate-400" />
                <span>Membros da Equipe</span>
              </button>

              <button
                type="button"
                onClick={() => setDrawerTab('geral')}
                className={`py-3 px-4 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 transition cursor-pointer ${
                  drawerTab === 'geral'
                    ? 'border-amber-500 text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Sliders className="w-4 h-4 text-slate-400" />
                <span>Gerenciamento</span>
              </button>
            </div>

            {/* Corpo do Drawer */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
              
              {/* ABA 1: TIMELINE CRONOLÓGICA */}
              {drawerTab === 'timeline' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Rastreamento Recente
                    </span>
                    <span className="text-xs font-mono text-slate-500">
                      {timelineLogs.length} registros
                    </span>
                  </div>

                  {loadingTimeline ? (
                    <div className="py-12 text-center text-slate-400">
                      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500 mx-auto mb-2" />
                      <p className="text-xs">Carregando histórico do usuário...</p>
                    </div>
                  ) : timelineLogs.length === 0 ? (
                    <div className="p-6 bg-slate-950/60 border border-slate-800/80 rounded-2xl text-center text-slate-400 space-y-2">
                      <History className="w-8 h-8 text-slate-600 mx-auto" />
                      <p className="font-semibold text-slate-300 text-sm">Nenhum evento registrado ainda.</p>
                      <p className="text-xs text-slate-500">
                        Conta criada em {formatarDataSegura(selectedConta.data_cadastro)}. Os eventos de navegação e ações de pátio aparecerão aqui automaticamente.
                      </p>
                    </div>
                  ) : (
                    <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
                      {timelineLogs.map((log) => (
                        <div key={log.id} className="relative group">
                          {/* Nó da Timeline */}
                          <span className={`absolute -left-[19px] top-1.5 w-3 h-3 rounded-full border-2 border-slate-900 ${
                            log.event_type === 'action' ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50' : 'bg-cyan-400'
                          }`} />

                          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 hover:border-slate-700 transition">
                            <div className="flex items-center justify-between gap-2">
                              <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded font-bold ${
                                log.event_type === 'action' 
                                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' 
                                  : 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
                              }`}>
                                {log.event_type === 'action' ? 'Ação' : 'Página'}
                              </span>
                              <span className="text-[11px] text-slate-500 font-mono">
                                {new Date(log.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                              </span>
                            </div>
                            <p className="text-sm font-bold text-white mt-1.5">{log.label}</p>
                            {log.route && (
                              <p className="text-[11px] text-slate-500 font-mono truncate mt-0.5">{log.route}</p>
                            )}
                            <p className="text-[10px] text-slate-400 mt-1">Por: {log.user_nome || log.user_email}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ABA 2: MEMBROS DA EQUIPE */}
              {drawerTab === 'membros' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Membros Vinculados
                    </span>
                  </div>

                  {!legacyDetail?.membros || legacyDetail.membros.length === 0 ? (
                    <div className="p-6 bg-slate-950/60 border border-slate-800/80 rounded-2xl text-center text-slate-400 text-xs">
                      Nenhum membro encontrado.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {legacyDetail.membros.map((m) => (
                        <div key={m.id} className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white text-sm">{m.nome}</span>
                              <span className="text-[10px] font-mono uppercase bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded border border-slate-700">
                                {m.role}
                              </span>
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5">{m.email}</p>
                            {m.telefone && (
                              <p className="text-xs text-slate-500 font-mono">{formatTelefone(m.telefone)}</p>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleAbrirModalEditarUsuario(m)}
                              className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-amber-400 rounded-lg transition cursor-pointer"
                              title="Editar Perfil do Usuário"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ABA 3: GERENCIAMENTO & EXCLUSÃO */}
              {drawerTab === 'geral' && (
                <div className="space-y-6">
                  <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-3">
                    <h4 className="text-sm font-bold text-white">Dados da Oficina</h4>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-slate-500 block">Slug público:</span>
                        <span className="text-slate-300 font-mono">/{selectedConta.slug}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Data de Cadastro:</span>
                        <span className="text-slate-300 font-mono">{formatarDataSegura(selectedConta.data_cadastro)}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Cidade / UF:</span>
                        <span className="text-slate-300">{selectedConta.cidade ? `${selectedConta.cidade}/${selectedConta.uf}` : 'Não informada'}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Vencimento Trial:</span>
                        <span className="text-slate-300 font-mono">{selectedConta.trial_fim ? formatarDataSegura(selectedConta.trial_fim) : 'Sem trial'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Zona de Perigo */}
                  <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center gap-2 text-red-400 font-bold text-sm">
                      <AlertTriangle className="w-4 h-4" />
                      <span>Zona de Perigo</span>
                    </div>
                    <p className="text-xs text-slate-400">
                      A exclusão é definitiva e removerá todos os clientes, veículos, ordens de serviço e fotos da oficina.
                    </p>
                    <button
                      type="button"
                      disabled={isReadOnly}
                      onClick={() => handleAbrirModalExcluir(selectedConta.tenant_id, selectedConta.nome_estetica, selectedConta.slug)}
                      className="w-full py-2.5 px-4 rounded-xl text-xs font-bold text-red-300 hover:text-white bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 transition cursor-pointer"
                    >
                      Excluir Oficina Definitivamente
                    </button>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL DE ALTERAÇÃO MANUAL DE PLANO */}
      {modalPlanoOpen && targetTenant && createPortal(
        <div className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <h3 className="text-lg font-bold text-white">Alterar Plano — {targetTenant.nome}</h3>
              <button onClick={() => setModalPlanoOpen(false)} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAlterarPlanoSubmit} className="space-y-4 pt-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Novo Plano</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['free', 'pro', 'studio'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setNovoPlano(p)}
                      className={`py-2 px-3 rounded-xl text-xs font-bold uppercase transition cursor-pointer ${
                        novoPlano === p
                          ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                          : 'bg-slate-950 text-slate-400 border border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {novoPlano !== 'free' && (
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300">Conceder como Cortesia</span>
                    <input
                      type="checkbox"
                      checked={isCortesiaAdmin}
                      onChange={(e) => setIsCortesiaAdmin(e.target.checked)}
                      className="w-4 h-4 rounded text-amber-500 focus:ring-0 cursor-pointer"
                    />
                  </div>

                  {isCortesiaAdmin && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1">Duração da Cortesia</label>
                      <select
                        value={duracaoCortesiaId}
                        onChange={(e) => setDuracaoCortesiaId(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"
                      >
                        {CORTESIA_DURACAO_OPCOES.map(opt => (
                          <option key={opt.id} value={opt.id}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Motivo do Ajuste</label>
                <input
                  type="text"
                  value={motivoCortesia}
                  onChange={(e) => setMotivoCortesia(e.target.value)}
                  placeholder="Ex: Parceria comercial, teste estendido..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"
                />
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setModalPlanoOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingPlano}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 transition cursor-pointer"
                >
                  {savingPlano ? 'Salvando...' : 'Confirmar Alteração'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL EDITAR NOME DA OFICINA */}
      {modalEditarOficina && createPortal(
        <div className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-base font-bold text-white mb-4">Editar Nome da Oficina</h3>
            <form onSubmit={handleSalvarNomeOficina} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Nome da Oficina</label>
                <input
                  type="text"
                  value={novoNomeOficina}
                  onChange={(e) => setNovoNomeOficina(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Slug da URL</label>
                <input
                  type="text"
                  value={novoSlugOficina}
                  onChange={(e) => setNovoSlugOficina(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalEditarOficina(null)}
                  className="px-4 py-2 text-xs text-slate-400 hover:text-white cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoNomeOficina}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 transition cursor-pointer"
                >
                  {salvandoNomeOficina ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL EDITAR PERFIL DO USUÁRIO */}
      {modalEditarUsuario && createPortal(
        <div className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-base font-bold text-white mb-1">Editar Usuário</h3>
            <p className="text-xs text-slate-500 mb-4">{modalEditarUsuario.email}</p>

            <form onSubmit={handleSalvarEditarUsuario} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Nome Completo</label>
                <input
                  type="text"
                  value={novoNomeUsuario}
                  onChange={(e) => setNovoNomeUsuario(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Telefone / WhatsApp</label>
                <input
                  type="text"
                  value={novoTelefoneUsuario}
                  onChange={(e) => setNovoTelefoneUsuario(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalEditarUsuario(null)}
                  className="px-4 py-2 text-xs text-slate-400 hover:text-white cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoUsuario}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 transition cursor-pointer"
                >
                  {salvandoUsuario ? 'Salvando...' : 'Salvar Usuário'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL EXCLUSÃO DEFINITIVA */}
      {modalExcluirOpen && tenantParaExcluir && createPortal(
        <div className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-red-500/30 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center gap-2 text-red-400 mb-2 font-bold text-base">
              <AlertTriangle className="w-5 h-5" />
              <span>Confirmar Exclusão</span>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Você está prestes a excluir permanentemente a oficina <strong className="text-white">{tenantParaExcluir.nome}</strong>.
            </p>

            <div className="space-y-3 pt-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Digite <strong className="text-white">{tenantParaExcluir.nome}</strong> para confirmar:
                </label>
                <input
                  type="text"
                  value={confirmacaoNomeExclusao}
                  onChange={(e) => setConfirmacaoNomeExclusao(e.target.value)}
                  placeholder="Nome exato da oficina"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="purgaAuth"
                  checked={purgarAuthNaExclusao}
                  onChange={(e) => setPurgarAuthNaExclusao(e.target.checked)}
                  className="rounded text-red-500 focus:ring-0 cursor-pointer"
                />
                <label htmlFor="purgaAuth" className="text-xs text-slate-400 cursor-pointer">
                  Liberar e-mail do dono no Auth (permite criar nova conta)
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setModalExcluirOpen(false)}
                  className="px-4 py-2 text-xs text-slate-400 hover:text-white cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={excluindoTenant || confirmacaoNomeExclusao.trim() !== tenantParaExcluir.nome.trim()}
                  onClick={handleConfirmarExcluir}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-500 disabled:opacity-30 disabled:cursor-not-allowed text-white transition cursor-pointer"
                >
                  {excluindoTenant ? 'Excluindo...' : 'Excluir Definitivamente'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL PURGAR E-MAIL */}
      {modalPurgarEmailOpen && createPortal(
        <div className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-base font-bold text-white mb-2">Liberar E-mail Órfão</h3>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              Remove o e-mail do <code className="text-amber-400">auth.users</code> para que o cliente possa se cadastrar novamente do zero.
            </p>

            <form onSubmit={handlePurgarEmail} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">E-mail a ser liberado</label>
                <input
                  type="email"
                  value={emailParaPurgar}
                  onChange={(e) => setEmailParaPurgar(e.target.value)}
                  placeholder="cliente@email.com"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalPurgarEmailOpen(false)}
                  className="px-4 py-2 text-xs text-slate-400 hover:text-white cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={purgandoEmail}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-500 text-white transition cursor-pointer"
                >
                  {purgandoEmail ? 'Liberando...' : 'Liberar E-mail'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
};
