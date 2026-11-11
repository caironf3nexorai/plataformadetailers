import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Award,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Info,
  Lock,
  Mail,
  Phone,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  UserCheck,
  UserX,
  Users,
  X,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { useAdminAuth } from '../../components/admin/AdminGuard';
import { formatarDataSegura } from '../../utils/assinatura';
import { formatarDataHora } from '../../utils/datas';
import { formatTelefone } from '../../utils/formatters';
import {
  type ContaAuthItem,
  type FiltroContasAuth,
  calcularResumoContasAuth,
  filtrarContasAuth,
  obterLabelCategoriaConta,
} from '../../utils/adminContas';

export const AdminContasAuth: React.FC = () => {
  const { showSuccess, showError } = useToast();
  const { adminLevel } = useAdminAuth();
  const navigate = useNavigate();
  const isReadOnly = adminLevel === 'suporte';

  const [contas, setContas] = useState<ContaAuthItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<FiltroContasAuth>('todas');
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);

  const [contaParaPurgar, setContaParaPurgar] = useState<ContaAuthItem | null>(null);
  const [purgando, setPurgando] = useState(false);

  const carregarContas = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('admin_listar_contas_auth', {
        p_busca: null,
        p_filtro: null,
      });

      if (error) throw error;

      const normalizadas: ContaAuthItem[] = (data || []).map((row: any) => ({
        ...row,
        oficinas: Array.isArray(row.oficinas) ? row.oficinas : [],
      }));

      setContas(normalizadas);
    } catch (err: any) {
      console.error('[AdminContasAuth] Erro ao listar contas auth:', err);
      showError('Erro ao carregar contas de autenticação', err);
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    carregarContas();
  }, [carregarContas]);

  const resumo = useMemo(() => calcularResumoContasAuth(contas), [contas]);

  const contasFiltradas = useMemo(
    () => filtrarContasAuth(contas, busca, filtro),
    [contas, busca, filtro]
  );

  const handleCopiarEmail = async (email: string) => {
    try {
      await navigator.clipboard.writeText(email);
      setCopiedEmail(email);
      setTimeout(() => setCopiedEmail((curr) => (curr === email ? null : curr)), 2000);
    } catch {
      showError('Não foi possível copiar o e-mail para a área de transferência.');
    }
  };

  const handleConfirmarPurgar = async () => {
    if (!contaParaPurgar || isReadOnly || !contaParaPurgar.pode_purgar) return;

    setPurgando(true);
    try {
      const { data, error } = await supabase.rpc('admin_purgar_usuario_por_email', {
        p_email: contaParaPurgar.email,
      });

      if (error) throw error;

      showSuccess(
        data?.mensagem ||
          `E-mail "${contaParaPurgar.email}" excluído e liberado com sucesso!`
      );
      setContaParaPurgar(null);
      await carregarContas();
    } catch (err: any) {
      console.error('[AdminContasAuth] Erro ao purgar conta:', err);
      showError('Erro ao liberar e-mail', err);
    } finally {
      setPurgando(false);
    }
  };

  const filtrosOpcoes: Array<{ id: FiltroContasAuth; label: string; count: number }> = [
    { id: 'todas', label: 'Todas', count: resumo.totalContas },
    { id: 'orfas', label: 'Somente Órfãs', count: resumo.orfas },
    { id: 'sem_oficina', label: 'Sem Oficina', count: resumo.semOficina },
    { id: 'com_oficina', label: 'Com Oficina', count: resumo.comOficina },
    { id: 'parceiros', label: 'Parceiros', count: resumo.parceiros },
    { id: 'admins', label: 'Admins', count: resumo.admins },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-heading text-white flex items-center gap-2.5">
            <UserCheck className="w-6 h-6 text-amber-500 shrink-0" />
            <span>Contas Cadastradas (Auth)</span>
          </h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Auditoria completa do <code className="text-amber-400 font-mono text-xs">auth.users</code> no Supabase, incluindo contas órfãs, equipe extra, parceiros e admins.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/admin/oficinas')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 transition cursor-pointer"
          >
            <Building2 className="w-3.5 h-3.5 text-amber-400" />
            <span>Ver Oficinas</span>
          </button>

          <button
            type="button"
            onClick={carregarContas}
            disabled={loading}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 transition shadow-lg shadow-amber-500/10 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'Atualizando...' : 'Atualizar'}</span>
          </button>
        </div>
      </div>

      {/* Explicação da diferença Auth vs Painel de Oficinas */}
      <div className="bg-slate-900/90 border border-amber-500/25 rounded-xl p-4 flex items-start gap-3 text-xs sm:text-sm text-slate-300">
        <Info className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-white">
            Por que existem {resumo.totalContas} e-mails no Auth e menos oficinas no painel?
          </p>
          <p className="text-slate-400 text-xs leading-relaxed">
            A aba <strong className="text-slate-200">Oficinas</strong> lista 1 linha por oficina (<code className="text-slate-300">tenants</code>), enquanto o Supabase Auth guarda todo login criado:
            {' '}<strong className="text-rose-300">{resumo.orfas} órfã(s)</strong> (cadastros incompletos ou colaboradores antigos desvinculados),
            {' '}<strong className="text-blue-300">{resumo.parceiros} parceiro(s)</strong>,
            {' '}<strong className="text-amber-300">{resumo.admins} admin(s)</strong> e membros adicionais de equipe em oficinas compartilhadas. Contas órfãs podem ser excluídas aqui com segurança para liberar o e-mail.
          </p>
        </div>
      </div>

      {/* Cards KPI (atalhos de filtro) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <button
          type="button"
          onClick={() => setFiltro('todas')}
          className={`text-left p-4 rounded-xl border transition cursor-pointer ${
            filtro === 'todas'
              ? 'bg-slate-900 border-amber-500/60 shadow-lg shadow-amber-500/5'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Total no Auth</span>
            <Users className="w-4 h-4 text-amber-400" />
          </div>
          <p className="text-2xl font-bold text-white mt-1.5 font-mono">
            {resumo.totalContas}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {resumo.naoConfirmadas} com e-mail não confirmado
          </p>
        </button>

        <button
          type="button"
          onClick={() => setFiltro('orfas')}
          className={`text-left p-4 rounded-xl border transition cursor-pointer ${
            filtro === 'orfas'
              ? 'bg-rose-950/30 border-rose-500/60 shadow-lg shadow-rose-500/5'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Contas Órfãs</span>
            <UserX className="w-4 h-4 text-rose-400" />
          </div>
          <p className={`text-2xl font-bold mt-1.5 font-mono ${resumo.orfas > 0 ? 'text-rose-400' : 'text-white'}`}>
            {resumo.orfas}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Sem oficina, parceiro ou admin
          </p>
        </button>

        <button
          type="button"
          onClick={() => setFiltro('sem_oficina')}
          className={`text-left p-4 rounded-xl border transition cursor-pointer ${
            filtro === 'sem_oficina'
              ? 'bg-blue-950/25 border-blue-500/60 shadow-lg shadow-blue-500/5'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Total Sem Oficina</span>
            <Mail className="w-4 h-4 text-blue-400" />
          </div>
          <p className="text-2xl font-bold text-blue-300 mt-1.5 font-mono">
            {resumo.semOficina}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Órfãs + Parceiros/Admins exclusivos
          </p>
        </button>

        <button
          type="button"
          onClick={() => setFiltro('com_oficina')}
          className={`text-left p-4 rounded-xl border transition cursor-pointer ${
            filtro === 'com_oficina'
              ? 'bg-emerald-950/25 border-emerald-500/60 shadow-lg shadow-emerald-500/5'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Com Oficina</span>
            <Building2 className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-bold text-emerald-400 mt-1.5 font-mono">
            {resumo.comOficina}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Donos e membros ativos de equipe
          </p>
        </button>
      </div>

      {/* Barra de Busca e Filtros */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por e-mail, nome, telefone, código ou oficina..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-8 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
            />
            {busca && (
              <button
                type="button"
                onClick={() => setBusca('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200"
                title="Limpar busca"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="text-xs font-mono text-slate-400">
            Exibindo <strong className="text-white">{contasFiltradas.length}</strong> de{' '}
            <strong className="text-white">{contas.length}</strong> contas
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {filtrosOpcoes.map((opt) => {
            const ativo = filtro === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFiltro(opt.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer flex items-center gap-1.5 ${
                  ativo
                    ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-sm'
                    : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700 hover:text-white'
                }`}
              >
                <span>{opt.label}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                    ativo
                      ? 'bg-slate-950/20 text-slate-950 font-bold'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {opt.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Lista / Tabela */}
      {loading ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-400">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500 mx-auto mb-3" />
          <p className="text-sm">Carregando contas do Supabase Auth...</p>
        </div>
      ) : contasFiltradas.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-400 space-y-2">
          <Users className="w-8 h-8 text-slate-600 mx-auto" />
          <p className="text-sm font-medium text-slate-300">
            Nenhuma conta encontrada para os filtros atuais.
          </p>
          {(busca || filtro !== 'todas') && (
            <button
              type="button"
              onClick={() => {
                setBusca('');
                setFiltro('todas');
              }}
              className="text-xs text-amber-400 hover:text-amber-300 underline cursor-pointer"
            >
              Limpar filtros e exibir todas
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Tabela Desktop */}
          <div className="hidden lg:block bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="bg-slate-950 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="px-5 py-3.5">Usuário / E-mail</th>
                    <th className="px-5 py-3.5">Classificação & Papéis</th>
                    <th className="px-5 py-3.5">Oficinas Vinculadas</th>
                    <th className="px-5 py-3.5">Cadastro & Acesso</th>
                    <th className="px-5 py-3.5 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {contasFiltradas.map((conta) => {
                    const cat = obterLabelCategoriaConta(conta.categoria);
                    return (
                      <tr key={conta.id} className="hover:bg-slate-800/35 transition align-top">
                        {/* Usuário / E-mail */}
                        <td className="px-5 py-4 space-y-1.5 min-w-[240px]">
                          <div className="font-semibold text-white">{conta.nome}</div>
                          <div className="flex items-center gap-1.5 text-xs font-mono text-slate-300">
                            <span className="break-all">{conta.email}</span>
                            <button
                              type="button"
                              onClick={() => handleCopiarEmail(conta.email)}
                              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition shrink-0 cursor-pointer"
                              title="Copiar e-mail"
                            >
                              {copiedEmail === conta.email ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 pt-0.5">
                            {conta.email_confirmado ? (
                              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 font-medium">
                                <CheckCircle2 className="w-3 h-3" />
                                E-mail confirmado
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/25 font-medium">
                                <Clock className="w-3 h-3" />
                                Pendente confirmação
                              </span>
                            )}

                            {conta.telefone && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 font-mono">
                                <Phone className="w-3 h-3 text-slate-500" />
                                {formatTelefone(conta.telefone)}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Classificação & Papéis */}
                        <td className="px-5 py-4 space-y-1.5 min-w-[200px]">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold border ${cat.badgeClass}`}
                            title={cat.descricao}
                          >
                            {cat.label}
                          </span>

                          <div className="flex flex-wrap gap-1.5">
                            {conta.is_super_admin && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                                <Shield className="w-3 h-3" />
                                SUPER ADMIN
                              </span>
                            )}

                            {conta.is_admin && !conta.is_super_admin && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 uppercase font-bold">
                                <Shield className="w-3 h-3" />
                                Admin ({conta.admin_nivel || 'admin'})
                              </span>
                            )}

                            {conta.is_parceiro && (
                              <span
                                className={`inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border font-bold ${
                                  conta.parceiro_ativo === false
                                    ? 'bg-slate-800 text-slate-400 border-slate-700'
                                    : 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                                }`}
                              >
                                <Award className="w-3 h-3" />
                                Parceiro: {conta.parceiro_codigo}
                                {conta.parceiro_ativo === false ? ' (Inativo)' : ''}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Oficinas Vinculadas */}
                        <td className="px-5 py-4 min-w-[220px]">
                          {conta.oficinas.length === 0 ? (
                            <span className="text-xs text-slate-500 italic">
                              Nenhuma oficina vinculada
                            </span>
                          ) : (
                            <div className="space-y-1.5">
                              {conta.oficinas.map((of) => (
                                <div
                                  key={of.member_id}
                                  className="flex flex-wrap items-center gap-1.5 bg-slate-950/80 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs"
                                >
                                  <Building2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                  <span className="font-semibold text-slate-200 truncate max-w-[140px]">
                                    {of.tenant_nome}
                                  </span>
                                  <span className="text-[10px] font-mono uppercase px-1.5 py-0.2 rounded bg-slate-800 text-slate-300">
                                    {of.role}
                                  </span>
                                  <span
                                    className={`text-[10px] font-mono uppercase px-1.5 py-0.2 rounded ${
                                      of.plano === 'studio'
                                        ? 'bg-purple-500/20 text-purple-300'
                                        : of.plano === 'pro'
                                        ? 'bg-amber-500/20 text-amber-300'
                                        : 'bg-slate-800 text-slate-400'
                                    }`}
                                  >
                                    {of.plano}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>

                        {/* Cadastro & Último Acesso */}
                        <td className="px-5 py-4 text-xs space-y-1 whitespace-nowrap">
                          <div className="text-slate-300">
                            <span className="text-slate-500">Cadastro:</span>{' '}
                            <span className="font-mono">{formatarDataSegura(conta.created_at)}</span>
                          </div>
                          <div className="text-slate-400">
                            <span className="text-slate-500">Último login:</span>{' '}
                            <span className="font-mono">
                              {conta.last_sign_in_at
                                ? formatarDataHora(conta.last_sign_in_at)
                                : 'Nunca acessou'}
                            </span>
                          </div>
                        </td>

                        {/* Ações */}
                        <td className="px-5 py-4 text-right min-w-[180px]">
                          {conta.pode_purgar ? (
                            <button
                              type="button"
                              disabled={isReadOnly}
                              onClick={() => setContaParaPurgar(conta)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-40 text-rose-300 border border-rose-500/30 transition cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Liberar / Excluir</span>
                            </button>
                          ) : (
                            <div className="flex flex-col items-end gap-1.5">
                              <span
                                className="inline-flex items-center gap-1 text-xs font-mono text-slate-500 bg-slate-950 border border-slate-800 px-2.5 py-1 rounded-lg"
                                title={conta.motivo_bloqueio_purga || 'Conta protegida'}
                              >
                                <Lock className="w-3 h-3 text-amber-500" />
                                <span>Protegida</span>
                              </span>
                              {conta.motivo_bloqueio_purga && (
                                <p className="text-[11px] text-slate-500 max-w-[210px] leading-snug text-right">
                                  {conta.motivo_bloqueio_purga}
                                </p>
                              )}
                              {conta.motivo_bloqueio_purga?.includes('aba Oficinas') && (
                                <button
                                  type="button"
                                  onClick={() => navigate('/admin/oficinas')}
                                  className="inline-flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 font-semibold cursor-pointer"
                                >
                                  <span>Abrir Oficinas</span>
                                  <ExternalLink className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Cards Mobile / Tablet */}
          <div className="lg:hidden space-y-3">
            {contasFiltradas.map((conta) => {
              const cat = obterLabelCategoriaConta(conta.categoria);
              return (
                <div
                  key={conta.id}
                  className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="font-semibold text-white truncate">{conta.nome}</div>
                      <div className="flex items-center gap-1.5 text-xs font-mono text-slate-300 break-all">
                        <span>{conta.email}</span>
                        <button
                          type="button"
                          onClick={() => handleCopiarEmail(conta.email)}
                          className="p-1 rounded hover:bg-slate-800 text-slate-400 shrink-0"
                          title="Copiar e-mail"
                        >
                          {copiedEmail === conta.email ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border shrink-0 ${cat.badgeClass}`}
                    >
                      {cat.label}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    {conta.email_confirmado ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                        <CheckCircle2 className="w-3 h-3" />
                        Confirmado
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/25">
                        <Clock className="w-3 h-3" />
                        Pendente
                      </span>
                    )}

                    {conta.is_parceiro && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30 font-mono">
                        <Award className="w-3 h-3" />
                        {conta.parceiro_codigo}
                      </span>
                    )}

                    {conta.is_admin && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono">
                        <Shield className="w-3 h-3" />
                        {conta.is_super_admin ? 'SUPER ADMIN' : `Admin (${conta.admin_nivel})`}
                      </span>
                    )}
                  </div>

                  {conta.oficinas.length > 0 && (
                    <div className="space-y-1 pt-1 border-t border-slate-800/80">
                      <span className="text-[11px] text-slate-500 font-semibold uppercase">
                        Oficinas:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {conta.oficinas.map((of) => (
                          <span
                            key={of.member_id}
                            className="inline-flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200"
                          >
                            <Building2 className="w-3 h-3 text-amber-400" />
                            <span>{of.tenant_nome}</span>
                            <span className="text-[10px] font-mono uppercase text-slate-400">
                              ({of.role} • {of.plano})
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-800">
                    <div>
                      <div>Criado: {formatarDataSegura(conta.created_at)}</div>
                      <div>
                        Login:{' '}
                        {conta.last_sign_in_at
                          ? formatarDataHora(conta.last_sign_in_at)
                          : 'Nunca'}
                      </div>
                    </div>

                    {conta.pode_purgar ? (
                      <button
                        type="button"
                        disabled={isReadOnly}
                        onClick={() => setContaParaPurgar(conta)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-40 text-rose-300 border border-rose-500/30"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Liberar / Excluir</span>
                      </button>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 text-xs text-slate-500 font-mono"
                        title={conta.motivo_bloqueio_purga || 'Conta protegida'}
                      >
                        <Lock className="w-3.5 h-3.5 text-amber-500" />
                        <span>Protegida</span>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Modal de Confirmação de Exclusão / Liberação */}
      {contaParaPurgar &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
            <div className="bg-slate-900 border border-rose-500/35 rounded-2xl w-full max-w-lg p-6 shadow-2xl shadow-rose-950/40 space-y-4">
              <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 shrink-0">
                    <UserX className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">
                      Excluir Conta do Auth & Liberar E-mail
                    </h3>
                    <p className="text-xs text-slate-400">
                      Remoção permanente de credenciais no Supabase
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => !purgando && setContaParaPurgar(null)}
                  className="text-slate-400 hover:text-white p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-white text-sm">{contaParaPurgar.nome}</span>
                  <span
                    className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${
                      obterLabelCategoriaConta(contaParaPurgar.categoria).badgeClass
                    }`}
                  >
                    {obterLabelCategoriaConta(contaParaPurgar.categoria).label}
                  </span>
                </div>
                <div className="font-mono text-amber-300 break-all">{contaParaPurgar.email}</div>
                <div className="text-slate-500">
                  Cadastrado em {formatarDataSegura(contaParaPurgar.created_at)}
                </div>
              </div>

              {contaParaPurgar.is_parceiro && (
                <div className="p-3 bg-amber-950/30 border border-amber-500/30 rounded-xl text-xs text-amber-200 flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    Esta conta está vinculada ao parceiro{' '}
                    <strong className="font-mono">{contaParaPurgar.parceiro_codigo}</strong>.
                    O login será removido do Portal do Parceiro, mas o cadastro comercial e o histórico de comissões permanecerão na aba{' '}
                    <strong>Parceiros</strong> (onde também podem ser excluídos, se desejar).
                  </div>
                </div>
              )}

              {contaParaPurgar.total_oficinas > 0 && (
                <div className="p-3 bg-amber-950/30 border border-amber-500/30 rounded-xl text-xs text-amber-200 flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    Esta conta é membro de equipe em{' '}
                    <strong>{contaParaPurgar.total_oficinas} oficina(s)</strong> (
                    {contaParaPurgar.oficinas.map((o) => o.tenant_nome).join(', ')}).
                    Os vínculos com essas oficinas também serão removidos.
                  </div>
                </div>
              )}

              <div className="p-3.5 bg-rose-950/30 border border-rose-500/25 rounded-xl text-xs text-rose-200 space-y-1">
                <p className="font-semibold text-rose-300 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  Ação irreversível:
                </p>
                <p className="text-slate-300 leading-relaxed">
                  O usuário será removido de <code className="text-white">auth.users</code>,{' '}
                  <code className="text-white">profiles</code> e convites pendentes, liberando o e-mail imediatamente para novos cadastros.
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  disabled={purgando}
                  onClick={() => setContaParaPurgar(null)}
                  className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 font-bold rounded-xl text-xs transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={purgando}
                  onClick={handleConfirmarPurgar}
                  className="px-4 py-2.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition flex items-center gap-1.5 shadow-lg shadow-rose-950/50 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>{purgando ? 'Excluindo...' : 'Confirmar Exclusão Permanente'}</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
