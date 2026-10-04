import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { 
  Search, 
  Filter, 
  Building2, 
  Users, 
  Clock, 
  AlertTriangle,
  X,
  Eye,
  Activity,
  Edit2,
  Shield,
  LogIn,
  Award,
  Trash2,
  UserX,
  Save
} from 'lucide-react';

interface TenantItem {
  id: string;
  nome: string;
  slug: string;
  plano: 'free' | 'pro' | 'studio';
  cidade: string | null;
  uf: string | null;
  created_at: string;
  nome_alterado_em?: string | null;
  total_membros: number;
  total_clientes: number;
  total_veiculos: number;
  total_agendamentos: number;
  total_execucoes: number;
  ultimo_acesso: string | null;
  agendamento_online_ativo: boolean;
}

interface TenantDetail {
  tenant: TenantItem;
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

export const AdminOficinas: React.FC = () => {
  const { showSuccess, showError } = useToast();
  const navigate = useNavigate();
  const { trocarTenant } = useAuth();

  const handleAcessarOficina = (id: string) => {
    trocarTenant(id);
    navigate('/');
  };

  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [planoFiltro, setPlanoFiltro] = useState<string>('');
  const [ordenacao, setOrdenacao] = useState<'created_at' | 'ultimo_acesso'>('created_at');
  
  // Drawer / Modal detail state
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState<TenantDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Estado para Modal de Alteração Manual de Plano
  const [modalPlanoOpen, setModalPlanoOpen] = useState(false);
  const [targetTenant, setTargetTenant] = useState<{ id: string; nome: string; planoAtual: string } | null>(null);
  const [novoPlano, setNovoPlano] = useState<'free' | 'pro' | 'studio'>('pro');
  const [motivoAudit, setMotivoAudit] = useState('');
  const [salvandoPlano, setSalvandoPlano] = useState(false);

  // Estados para Gestão de Membros (Promover Admin / Tornar Parceiro)
  const [platformAdminsEmails, setPlatformAdminsEmails] = useState<string[]>([]);
  const [parceirosEmails, setParceirosEmails] = useState<Map<string, string>>(new Map());

  const [modalAdminTarget, setModalAdminTarget] = useState<{ nome: string; email: string } | null>(null);
  const [adminNivel, setAdminNivel] = useState<'admin' | 'suporte'>('admin');
  const [adminObservacao, setAdminObservacao] = useState('');
  const [salvandoAdmin, setSalvandoAdmin] = useState(false);

  const [modalParceiroTarget, setModalParceiroTarget] = useState<{ nome: string; email: string; user_id?: string } | null>(null);
  const [parceiroCodigo, setParceiroCodigo] = useState('');
  const [parceiroComissaoTipo, setParceiroComissaoTipo] = useState<'percentual' | 'valor_fixo'>('percentual');
  const [parceiroComissaoValor, setParceiroComissaoValor] = useState('20');
  const [parceiroRecorrente, setParceiroRecorrente] = useState(true);
  const [parceiroPixChave, setParceiroPixChave] = useState('');
  const [salvandoParceiro, setSalvandoParceiro] = useState(false);

  // Estados para Modal de Alteração de Nome da Oficina
  const [modalEditarOficina, setModalEditarOficina] = useState<{
    id: string;
    nome: string;
    slug: string;
    nome_alterado_em?: string | null;
  } | null>(null);
  const [novoNomeOficina, setNovoNomeOficina] = useState('');
  const [ignorarCooldownOficina, setIgnorarCooldownOficina] = useState(false);
  const [salvandoNomeOficina, setSalvandoNomeOficina] = useState(false);

  const calcularSlugPreview = (nome: string, currentSlug: string) => {
    const limpo = (nome || '').toLowerCase().trim();
    if (!limpo) return '—';
    const base = limpo
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'oficina';
    const suffixMatch = currentSlug ? currentSlug.match(/-[a-f0-9]{6}$/) : null;
    return suffixMatch ? `${base}${suffixMatch[0]}` : `${base}-xxxxxx`;
  };

  const handleAbrirModalEditarOficina = (
    id: string,
    nome: string,
    slug: string,
    nome_alterado_em?: string | null
  ) => {
    setModalEditarOficina({ id, nome, slug, nome_alterado_em });
    setNovoNomeOficina(nome || '');
    setIgnorarCooldownOficina(false);
  };

  const handleSalvarNomeOficina = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalEditarOficina) return;
    const nomeLimpo = novoNomeOficina.trim();
    if (!nomeLimpo || nomeLimpo.length < 2) {
      showError('O nome da oficina deve ter pelo menos 2 caracteres.');
      return;
    }

    setSalvandoNomeOficina(true);
    try {
      const { data, error } = await supabase.rpc('admin_atualizar_nome_oficina', {
        p_tenant_id: modalEditarOficina.id,
        p_novo_nome: nomeLimpo,
        p_ignorar_cooldown: ignorarCooldownOficina,
      });

      if (error) throw error;

      const novoSlug = data?.slug || modalEditarOficina.slug;
      const novaDataAlteracao = data?.nome_alterado_em || new Date().toISOString();

      showSuccess(`Nome alterado para "${nomeLimpo}" e endereço atualizado para "/${novoSlug}" com sucesso!`);

      // Atualizar lista de oficinas na memória
      setTenants((prev) =>
        prev.map((t) =>
          t.id === modalEditarOficina.id
            ? {
                ...t,
                nome: nomeLimpo,
                slug: novoSlug,
                nome_alterado_em: novaDataAlteracao,
              }
            : t
        )
      );

      // Se estiver com o modal de detalhes aberto para essa oficina, atualizar no detalhe também
      if (detailData && detailData.tenant.id === modalEditarOficina.id) {
        setDetailData({
          ...detailData,
          tenant: {
            ...detailData.tenant,
            nome: nomeLimpo,
            slug: novoSlug,
            nome_alterado_em: novaDataAlteracao,
          },
        });
      }

      setModalEditarOficina(null);
    } catch (err: any) {
      console.error('[AdminOficinas] Erro ao alterar nome da oficina:', err);
      showError(err.message || 'Erro ao alterar nome da oficina');
    } finally {
      setSalvandoNomeOficina(false);
    }
  };

  // Estados para Modal de Edição de Nome / Dados do Usuário
  const [modalEditarUsuario, setModalEditarUsuario] = useState<{
    user_id?: string;
    email: string;
    nome: string;
    telefone?: string | null;
  } | null>(null);
  const [editNome, setEditNome] = useState('');
  const [editTelefone, setEditTelefone] = useState('');
  const [salvandoUsuario, setSalvandoUsuario] = useState(false);

  const handleAbrirModalEditarUsuario = (m: { user_id?: string; email: string; nome: string; telefone?: string | null }) => {
    setModalEditarUsuario(m);
    setEditNome(m.nome || '');
    setEditTelefone(m.telefone || '');
  };

  const handleSalvarEdicaoUsuario = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalEditarUsuario) return;
    if (!editNome.trim() || editNome.trim().length < 2) {
      showError('O nome deve ter pelo menos 2 caracteres.');
      return;
    }

    setSalvandoUsuario(true);
    try {
      let targetUserId = modalEditarUsuario.user_id;

      if (!targetUserId) {
        const { data: memberData } = await supabase
          .from('tenant_members')
          .select('user_id')
          .eq('email', modalEditarUsuario.email.toLowerCase().trim())
          .not('user_id', 'is', null)
          .limit(1)
          .maybeSingle();

        targetUserId = memberData?.user_id;
      }

      if (!targetUserId) {
        showError('Este membro ainda não concluiu o cadastro inicial (convite pendente).');
        setSalvandoUsuario(false);
        return;
      }

      const { error } = await supabase.rpc('admin_atualizar_usuario_perfil', {
        p_user_id: targetUserId,
        p_nome: editNome.trim(),
        p_telefone: editTelefone.trim() || null,
      });

      if (error) throw error;

      showSuccess(`Nome do usuário atualizado para "${editNome.trim()}" com sucesso!`);
      
      if (detailData) {
        setDetailData({
          ...detailData,
          membros: detailData.membros.map((mb) =>
            mb.email.toLowerCase() === modalEditarUsuario.email.toLowerCase()
              ? { ...mb, nome: editNome.trim(), telefone: editTelefone.trim() || null }
              : mb
          ),
        });
      }

      setModalEditarUsuario(null);
    } catch (err: any) {
      console.error('[AdminOficinas] Erro ao atualizar perfil do usuário:', err);
      showError('Erro ao atualizar usuário', err);
    } finally {
      setSalvandoUsuario(false);
    }
  };

  // Estados para Modal de Exclusão de Oficina e Liberação de E-mail
  const [modalExcluirOpen, setModalExcluirOpen] = useState(false);
  const [tenantParaExcluir, setTenantParaExcluir] = useState<{ id: string; nome: string; slug: string } | null>(null);
  const [excluirAuthUsers, setExcluirAuthUsers] = useState(true);
  const [confirmacaoNome, setConfirmacaoNome] = useState('');
  const [excluindoOficina, setExcluindoOficina] = useState(false);

  // Estados para Modal de Purgação Manual de E-mail
  const [modalPurgarEmailOpen, setModalPurgarEmailOpen] = useState(false);
  const [emailParaPurgar, setEmailParaPurgar] = useState('');
  const [purgandoEmail, setPurgandoEmail] = useState(false);

  const handleConfirmarPurgarEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = emailParaPurgar.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      showError('Informe um e-mail válido para liberar.');
      return;
    }

    setPurgandoEmail(true);
    try {
      const { error } = await supabase.rpc('admin_purgar_usuario_por_email', {
        p_email: cleanEmail,
      });

      if (error) throw error;

      showSuccess(`E-mail "${cleanEmail}" liberado com sucesso do banco de dados e do auth.users!`);
      setEmailParaPurgar('');
      setModalPurgarEmailOpen(false);
      fetchTenants();
    } catch (err: any) {
      console.error('[AdminOficinas] Erro ao purgar e-mail:', err);
      showError('Erro ao purgar e-mail', err);
    } finally {
      setPurgandoEmail(false);
    }
  };

  const handleAbrirModalExcluir = (id: string, nome: string, slug: string) => {
    setTenantParaExcluir({ id, nome, slug });
    setConfirmacaoNome('');
    setExcluirAuthUsers(true);
    setModalExcluirOpen(true);
  };

  const handleConfirmarExclusao = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantParaExcluir) return;

    if (confirmacaoNome.trim().toLowerCase() !== tenantParaExcluir.nome.trim().toLowerCase()) {
      showError(`Digite exatamente "${tenantParaExcluir.nome}" para confirmar.`);
      return;
    }

    setExcluindoOficina(true);
    try {
      const { data, error } = await supabase.rpc('admin_excluir_oficina_e_usuario', {
        p_tenant_id: tenantParaExcluir.id,
        p_excluir_auth_users: excluirAuthUsers,
      });

      if (error) throw error;

      const emailsMsg = data?.emails_liberados?.length 
        ? ` E-mails liberados: ${data.emails_liberados.join(', ')}`
        : '';
      showSuccess(`Oficina "${tenantParaExcluir.nome}" excluída com sucesso!${emailsMsg}`);
      
      setModalExcluirOpen(false);
      setTenantParaExcluir(null);
      if (selectedTenantId === tenantParaExcluir.id) {
        setSelectedTenantId(null);
        setDetailData(null);
      }
      fetchTenants();
    } catch (err: any) {
      console.error('[AdminOficinas] Erro ao excluir oficina:', err);
      showError('Erro ao excluir oficina', err);
    } finally {
      setExcluindoOficina(false);
    }
  };

  const fetchTenants = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('admin_listar_tenants', {
        p_busca: busca.trim() || null,
        p_plano: planoFiltro || null,
        p_limite: 100,
        p_offset: 0
      });

      if (error) throw error;
      setTenants(data || []);
    } catch (err: any) {
      console.error('[AdminOficinas] Erro ao carregar oficinas:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTenants();
  }, [busca, planoFiltro]);

  const handleOpenDetail = async (id: string) => {
    setSelectedTenantId(id);
    setDetailLoading(true);
    setDetailError(null);
    try {
      const [{ data, error }, { data: adminsData }, { data: parceirosData }] = await Promise.all([
        supabase.rpc('admin_detalhe_tenant', { p_tenant_id: id }),
        supabase.from('platform_admins').select('email').eq('ativo', true),
        supabase.from('parceiros').select('email, codigo').eq('ativo', true),
      ]);

      if (error) {
        console.warn('[AdminOficinas] RPC admin_detalhe_tenant falhou, aplicando fallback local:', error.message);
        
        const tenantLocal = tenants.find((t) => t.id === id);
        if (!tenantLocal) {
          throw new Error(error.message || 'Oficina não encontrada.');
        }

        let fallbackMembros: any[] = [];
        try {
          const { data: membersRows } = await supabase
            .from('tenant_members')
            .select('id, user_id, email, role, status')
            .eq('tenant_id', id);

          if (membersRows && membersRows.length > 0) {
            const userIds = membersRows.map((m: any) => m.user_id).filter(Boolean);
            let profilesMap = new Map<string, { nome?: string; telefone?: string }>();
            if (userIds.length > 0) {
              const { data: profs } = await supabase
                .from('profiles')
                .select('id, nome, telefone')
                .in('id', userIds);
              (profs || []).forEach((p: any) => profilesMap.set(p.id, p));
            }

            fallbackMembros = membersRows.map((m: any) => {
              const prof = m.user_id ? profilesMap.get(m.user_id) : null;
              return {
                id: m.id,
                user_id: m.user_id,
                email: m.email,
                nome: prof?.nome || m.email,
                telefone: prof?.telefone || null,
                role: m.role,
                status: m.status,
                ultimo_acesso: null,
              };
            });
          }
        } catch {
          // ignora se RLS na tabela impedir select direto
        }

        setDetailData({
          tenant: tenantLocal,
          membros: fallbackMembros,
          historico_12m: [],
          storage: [],
        });
      } else {
        setDetailData(data);
      }

      if (adminsData) {
        setPlatformAdminsEmails(adminsData.map((a: any) => (a.email || '').toLowerCase()));
      }
      if (parceirosData) {
        const mapP = new Map<string, string>();
        parceirosData.forEach((p: any) => {
          if (p.email) mapP.set(p.email.toLowerCase(), p.codigo);
        });
        setParceirosEmails(mapP);
      }
    } catch (err: any) {
      console.error('[AdminOficinas] Erro ao carregar detalhes:', err);
      setDetailError(err.message || 'Erro ao carregar detalhes da oficina.');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleConfirmarPromocaoAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalAdminTarget) return;

    setSalvandoAdmin(true);
    try {
      const { error } = await supabase.rpc('admin_promover_administrador', {
        p_email: modalAdminTarget.email,
        p_nivel: adminNivel,
        p_observacao: adminObservacao.trim() || `Promovido pela tela de oficinas (${detailData?.tenant.nome || ''})`,
        p_super_admin: false,
      });

      if (error) throw error;

      showSuccess(`Usuário ${modalAdminTarget.nome} (${modalAdminTarget.email}) promovido a Administrador com sucesso!`);
      setPlatformAdminsEmails((prev) => [...prev, modalAdminTarget.email.toLowerCase()]);
      setModalAdminTarget(null);
    } catch (err: any) {
      console.error('[AdminOficinas] Erro ao promover administrador:', err);
      showError('Erro ao promover usuário a administrador', err);
    } finally {
      setSalvandoAdmin(false);
    }
  };

  const handleAbrirModalParceiro = (m: { nome: string; email: string; user_id?: string }) => {
    setModalParceiroTarget(m);
    const primeiroNome = m.nome.split(' ')[0].normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    setParceiroCodigo(primeiroNome || 'PARCEIRO');
    setParceiroComissaoTipo('percentual');
    setParceiroComissaoValor('20');
    setParceiroRecorrente(true);
    setParceiroPixChave('');
  };

  const handleConfirmarTornarParceiro = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalParceiroTarget || !parceiroCodigo.trim()) {
      showError('Informe o código de indicação do parceiro.');
      return;
    }

    setSalvandoParceiro(true);
    try {
      const { error } = await supabase.from('parceiros').insert({
        nome: modalParceiroTarget.nome,
        email: modalParceiroTarget.email.toLowerCase().trim(),
        codigo: parceiroCodigo.trim().toUpperCase(),
        comissao_tipo: parceiroComissaoTipo,
        comissao_valor: parseFloat(parceiroComissaoValor) || 0,
        recorrente: parceiroRecorrente,
        pix_chave: parceiroPixChave.trim() || null,
        user_id: modalParceiroTarget.user_id || null,
        ativo: true,
      });

      if (error) throw error;

      showSuccess(`Parceiro comercial ${modalParceiroTarget.nome} cadastrado com o código "${parceiroCodigo.trim().toUpperCase()}"!`);
      setParceirosEmails((prev) => {
        const novo = new Map(prev);
        novo.set(modalParceiroTarget.email.toLowerCase(), parceiroCodigo.trim().toUpperCase());
        return novo;
      });
      setModalParceiroTarget(null);
    } catch (err: any) {
      console.error('[AdminOficinas] Erro ao cadastrar parceiro:', err);
      showError('Erro ao cadastrar parceiro comercial', err);
    } finally {
      setSalvandoParceiro(false);
    }
  };

  const handleAbrirModalPlano = (tenantId: string, tenantNome: string, planoAtual: string) => {
    setTargetTenant({ id: tenantId, nome: tenantNome, planoAtual });
    setNovoPlano((planoAtual as any) || 'pro');
    setMotivoAudit('');
    setModalPlanoOpen(true);
  };

  const handleSalvarAlteracaoPlano = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetTenant) return;

    if (!motivoAudit.trim()) {
      showError('Informe a justificativa da alteração para auditoria.');
      return;
    }

    setSalvandoPlano(true);
    try {
      const { error } = await supabase.rpc('admin_alterar_plano_manual', {
        p_tenant_id: targetTenant.id,
        p_novo_plano: novoPlano,
        p_motivo: motivoAudit.trim(),
      });

      if (error) throw error;

      showSuccess(`Plano da oficina "${targetTenant.nome}" alterado para ${novoPlano.toUpperCase()} com sucesso!`);
      setModalPlanoOpen(false);
      setTargetTenant(null);

      // Recarrega lista principal
      fetchTenants();
      // Recarrega modal de detalhes se estiver aberto para este mesmo tenant
      if (selectedTenantId === targetTenant.id) {
        handleOpenDetail(targetTenant.id);
      }
    } catch (err: any) {
      console.error('[AdminOficinas] Erro ao alterar plano:', err);
      showError('Erro ao alterar plano da oficina', err);
    } finally {
      setSalvandoPlano(false);
    }
  };

  const isChurnRisk = (ultimoAcesso: string | null) => {
    if (!ultimoAcesso) return true;
    const dias = (new Date().getTime() - new Date(ultimoAcesso).getTime()) / (1000 * 3600 * 24);
    return dias > 30;
  };

  const sortedTenants = [...tenants].sort((a, b) => {
    if (ordenacao === 'ultimo_acesso') {
      const tA = a.ultimo_acesso ? new Date(a.ultimo_acesso).getTime() : 0;
      const tB = b.ultimo_acesso ? new Date(b.ultimo_acesso).getTime() : 0;
      return tB - tA;
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <div className="space-y-6">
      {/* Header Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-heading text-white">Oficinas Cadastradas</h1>
          <p className="text-slate-400 text-sm">
            Visualização agregada do ecossistema de oficinas parceiras e gestão de planos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setEmailParaPurgar('');
              setModalPurgarEmailOpen(true);
            }}
            className="flex items-center space-x-1.5 text-xs font-mono font-bold text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 px-3 py-1.5 rounded-lg transition shadow-sm cursor-pointer"
            title="Exclui um e-mail do auth.users e de todas as tabelas para liberar novo cadastro"
          >
            <UserX className="w-3.5 h-3.5" />
            <span>Liberar E-mail</span>
          </button>

          <div className="flex items-center space-x-2 text-xs font-mono text-slate-400 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg">
            <Building2 className="w-4 h-4 text-amber-500" />
            <span>Total: <strong className="text-white">{tenants.length}</strong> oficinas</span>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-4 shadow-sm">
        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, slug ou cidade..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-end">
          <div className="flex items-center space-x-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              value={planoFiltro}
              onChange={(e) => setPlanoFiltro(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-amber-500/50 cursor-pointer"
            >
              <option value="">Todos os Planos</option>
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="studio">Studio</option>
            </select>
          </div>

          <select
            value={ordenacao}
            onChange={(e) => setOrdenacao(e.target.value as any)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-amber-500/50 cursor-pointer"
          >
            <option value="created_at">Ordenar por Cadastro</option>
            <option value="ultimo_acesso">Ordenar por Último Acesso</option>
          </select>
        </div>
      </div>

      {/* Desktop Table & Mobile Cards */}
      {loading ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-400">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500 mx-auto mb-3"></div>
          <p className="text-sm">Carregando dados das oficinas...</p>
        </div>
      ) : sortedTenants.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-500">
          Nenhuma oficina encontrada com os filtros aplicados.
        </div>
      ) : (
        <>
          {/* Desktop Table (Visible on md+) */}
          <div className="hidden md:block bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-950/80 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th className="px-4 py-3.5">Oficina</th>
                  <th className="px-4 py-3.5">Plano</th>
                  <th className="px-4 py-3.5">Cidade/UF</th>
                  <th className="px-4 py-3.5 text-center">Membros</th>
                  <th className="px-4 py-3.5 text-center">Agendamentos</th>
                  <th className="px-4 py-3.5 text-center">Execuções</th>
                  <th className="px-4 py-3.5">Último Acesso</th>
                  <th className="px-4 py-3.5 text-right font-mono">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {sortedTenants.map((t) => {
                  const churn = isChurnRisk(t.ultimo_acesso);
                  return (
                    <tr key={t.id} className="hover:bg-slate-800/50 transition">
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-white">{t.nome}</span>
                          <button
                            type="button"
                            onClick={() => handleAbrirModalEditarOficina(t.id, t.nome, t.slug, t.nome_alterado_em)}
                            className="p-1 hover:bg-slate-800 text-slate-500 hover:text-amber-400 rounded transition cursor-pointer"
                            title="Alterar Nome da Oficina"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="text-xs text-slate-500 font-mono">/{t.slug}</div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-block px-2.5 py-0.5 rounded text-xs font-mono font-bold uppercase ${
                          t.plano === 'studio' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30' :
                          t.plano === 'pro' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/30' :
                          'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}>
                          {t.plano}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-slate-300">
                        {t.cidade ? `${t.cidade} - ${t.uf || ''}` : <span className="text-slate-600">Não informado</span>}
                      </td>
                      <td className="px-4 py-3.5 text-center font-mono text-slate-200">
                        {t.total_membros}
                      </td>
                      <td className="px-4 py-3.5 text-center font-mono text-slate-200">
                        {t.total_agendamentos}
                      </td>
                      <td className="px-4 py-3.5 text-center font-mono text-slate-200">
                        {t.total_execucoes}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center space-x-2">
                          <span className="font-mono text-xs text-slate-400">
                            {t.ultimo_acesso ? new Date(t.ultimo_acesso).toLocaleDateString('pt-BR') : 'Nunca'}
                          </span>
                          {churn && (
                            <span className="flex items-center space-x-1 text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded font-mono" title="Sem acesso há mais de 30 dias (Risco de Churn)">
                              <AlertTriangle className="w-3 h-3" />
                              <span>&gt;30d</span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right space-x-2">
                        <button
                          type="button"
                          onClick={() => handleAbrirModalEditarOficina(t.id, t.nome, t.slug, t.nome_alterado_em)}
                          className="inline-flex items-center space-x-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 px-2.5 py-1 rounded text-xs font-medium border border-amber-500/30 transition cursor-pointer"
                          title="Alterar nome da oficina"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          <span>Nome</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleAcessarOficina(t.id)}
                          className="inline-flex items-center space-x-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 px-2.5 py-1 rounded text-xs font-medium border border-emerald-500/30 transition cursor-pointer"
                          title="Acessar painel desta oficina no App"
                        >
                          <LogIn className="w-3.5 h-3.5" />
                          <span>Acessar App</span>
                        </button>

                        <button
                          onClick={() => handleAbrirModalPlano(t.id, t.nome, t.plano)}
                          className="inline-flex items-center space-x-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 px-2.5 py-1 rounded text-xs font-medium border border-amber-500/30 transition"
                          title="Alterar plano da oficina"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          <span>Mudar Plano</span>
                        </button>

                        <button
                          onClick={() => handleOpenDetail(t.id)}
                          className="inline-flex items-center space-x-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-2.5 py-1 rounded text-xs font-medium border border-slate-700 transition cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Detalhes</span>
                        </button>

                        <button
                          onClick={() => handleAbrirModalExcluir(t.id, t.nome, t.slug)}
                          className="inline-flex items-center space-x-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 px-2.5 py-1 rounded text-xs font-medium border border-red-500/30 transition cursor-pointer"
                          title="Excluir oficina e liberar e-mail"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Excluir</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Stacked Cards (Visible on sm/mobile 375px) */}
          <div className="md:hidden space-y-4">
            {sortedTenants.map((t) => {
              const churn = isChurnRisk(t.ultimo_acesso);
              return (
                <div key={t.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 shadow-md">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-bold text-white text-base leading-tight truncate">{t.nome}</h3>
                        <button
                          type="button"
                          onClick={() => handleAbrirModalEditarOficina(t.id, t.nome, t.slug, t.nome_alterado_em)}
                          className="p-1 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded transition cursor-pointer shrink-0"
                          title="Alterar Nome da Oficina"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p className="text-xs text-slate-500 font-mono">/{t.slug}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold uppercase ${
                      t.plano === 'studio' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30' :
                      t.plano === 'pro' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/30' :
                      'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}>
                      {t.plano}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 py-2 border-y border-slate-800/80 text-center font-mono text-xs">
                    <div className="bg-slate-950 p-2 rounded">
                      <span className="text-slate-500 block text-[10px]">Membros</span>
                      <strong className="text-slate-200 text-sm">{t.total_membros}</strong>
                    </div>
                    <div className="bg-slate-950 p-2 rounded">
                      <span className="text-slate-500 block text-[10px]">Agend.</span>
                      <strong className="text-slate-200 text-sm">{t.total_agendamentos}</strong>
                    </div>
                    <div className="bg-slate-950 p-2 rounded">
                      <span className="text-slate-500 block text-[10px]">Execuções</span>
                      <strong className="text-slate-200 text-sm">{t.total_execucoes}</strong>
                    </div>
                  </div>

                  {/* Rodapé e Ações do Card (Mobile Safe) */}
                  <div className="space-y-2 pt-2 border-t border-slate-800/80">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center space-x-1.5 text-slate-400">
                        <Clock className="w-3.5 h-3.5 text-slate-500" />
                        <span className="font-mono text-[11px]">
                          Acesso: {t.ultimo_acesso ? new Date(t.ultimo_acesso).toLocaleDateString('pt-BR') : 'Nunca'}
                        </span>
                        {churn && (
                          <span className="bg-amber-500/10 text-amber-400 text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30 font-semibold">
                            Churn?
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 w-full pt-1">
                      <button
                        type="button"
                        onClick={() => handleAbrirModalEditarOficina(t.id, t.nome, t.slug, t.nome_alterado_em)}
                        className="w-full bg-amber-500/10 hover:bg-amber-500/20 active:scale-95 text-amber-400 py-2 px-2.5 rounded-lg text-xs font-medium border border-amber-500/30 flex items-center justify-center space-x-1.5 transition cursor-pointer"
                        title="Alterar nome da oficina"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span>Nome</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleAcessarOficina(t.id)}
                        className="w-full bg-emerald-500/10 hover:bg-emerald-500/20 active:scale-95 text-emerald-400 py-2 px-2.5 rounded-lg text-xs font-medium border border-emerald-500/30 flex items-center justify-center space-x-1.5 transition cursor-pointer"
                        title="Acessar painel desta oficina no App"
                      >
                        <LogIn className="w-3.5 h-3.5" />
                        <span>Acessar</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleAbrirModalPlano(t.id, t.nome, t.plano)}
                        className="w-full bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 py-2 px-2.5 rounded-lg text-xs font-medium border border-slate-700 flex items-center justify-center space-x-1.5 transition cursor-pointer"
                      >
                        <span>Plano</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenDetail(t.id)}
                        className="w-full bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 py-2 px-2.5 rounded-lg text-xs font-semibold border border-slate-700 flex items-center justify-center space-x-1.5 transition cursor-pointer"
                      >
                        <span>Detalhes</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleAbrirModalExcluir(t.id, t.nome, t.slug)}
                        className="w-full bg-red-500/10 hover:bg-red-500/20 active:scale-95 text-red-400 py-2 px-2.5 rounded-lg text-xs font-medium border border-red-500/30 flex items-center justify-center space-x-1.5 transition cursor-pointer col-span-2 sm:col-span-1"
                        title="Excluir oficina"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Excluir</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Detail Drawer Modal */}
      {selectedTenantId && createPortal(
        <div className="fixed inset-0 z-[90] bg-slate-950/80 backdrop-blur-sm flex justify-end">
          <div className="bg-slate-900 border-l border-slate-800 w-full max-w-2xl h-full flex flex-col p-6 overflow-y-auto shadow-2xl animate-in slide-in-from-right duration-200">
            
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div>
                <h2 className="text-xl font-bold text-white">Detalhes da Oficina</h2>
                <p className="text-xs text-slate-400 font-mono">ID: {selectedTenantId}</p>
              </div>
              <button
                onClick={() => { setSelectedTenantId(null); setDetailData(null); }}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {detailLoading ? (
              <div className="flex-1 flex flex-col items-center justify-center p-12 text-slate-400">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500 mb-3"></div>
                <p className="text-sm">Carregando métricas e membros...</p>
              </div>
            ) : detailData ? (
              <div className="space-y-6 pt-6">
                
                {/* Basic info card */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-base font-bold text-white block">{detailData.tenant.nome}</span>
                        <button
                          type="button"
                          onClick={() => handleAbrirModalEditarOficina(detailData.tenant.id, detailData.tenant.nome, detailData.tenant.slug, detailData.tenant.nome_alterado_em)}
                          className="p-1 hover:bg-slate-800 text-slate-400 hover:text-amber-400 rounded-md transition cursor-pointer"
                          title="Alterar Nome da Oficina"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 pt-0.5">
                        <span className="text-xs font-mono uppercase bg-amber-500/10 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded inline-block">
                          Plano {detailData.tenant.plano}
                        </span>
                        <span className="text-xs text-slate-500 font-mono">/{detailData.tenant.slug}</span>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => handleAbrirModalEditarOficina(detailData.tenant.id, detailData.tenant.nome, detailData.tenant.slug, detailData.tenant.nome_alterado_em)}
                        className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition cursor-pointer"
                        title="Alterar Nome da Oficina"
                      >
                        <Edit2 className="w-3.5 h-3.5 text-amber-400" />
                        <span>Alterar Nome</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleAcessarOficina(detailData.tenant.id)}
                        className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-3 py-1.5 rounded-lg text-xs flex items-center space-x-1.5 transition shadow cursor-pointer"
                        title="Acessar painel desta oficina no App"
                      >
                        <LogIn className="w-3.5 h-3.5" />
                        <span>Acessar no App</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleAbrirModalPlano(detailData.tenant.id, detailData.tenant.nome, detailData.tenant.plano)}
                        className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-3 py-1.5 rounded-lg text-xs flex items-center space-x-1.5 transition shadow cursor-pointer"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span>Alterar Plano</span>
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 pt-1">
                    Cidade: {detailData.tenant.cidade ? `${detailData.tenant.cidade} - ${detailData.tenant.uf}` : 'Não cadastrada'}
                  </p>
                  <p className="text-xs text-slate-400">
                    Cadastrada em: {new Date(detailData.tenant.created_at).toLocaleDateString('pt-BR')}
                  </p>
                </div>

                {/* Members list */}
                <div>
                  <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-3 flex items-center space-x-2">
                    <Users className="w-4 h-4 text-amber-500" />
                    <span>Equipe da Oficina ({detailData.membros.length})</span>
                  </h3>
                  <div className="bg-slate-950 border border-slate-800 rounded-xl divide-y divide-slate-800">
                    {detailData.membros.length === 0 ? (
                      <p className="p-4 text-xs text-slate-500 text-center">Nenhum membro cadastrado.</p>
                    ) : (
                      detailData.membros.map((m) => {
                        const isAlreadyAdmin = platformAdminsEmails.includes(m.email.toLowerCase());
                        const parceiroCod = parceirosEmails.get(m.email.toLowerCase());

                        return (
                          <div key={m.id} className="p-3 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs hover:bg-slate-900/50 transition">
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-slate-200">{m.nome}</span>
                                {isAlreadyAdmin && (
                                  <span className="bg-indigo-500/20 text-indigo-400 border border-indigo-500/40 px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 font-sans">
                                    <Shield className="w-3 h-3 text-indigo-400" /> Admin Plataforma
                                  </span>
                                )}
                                {parceiroCod && (
                                  <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 font-sans">
                                    <Award className="w-3 h-3 text-emerald-400" /> Parceiro ({parceiroCod})
                                  </span>
                                )}
                              </div>
                              <div className="text-slate-400 font-mono text-[11px] mt-0.5">{m.email}</div>
                            </div>

                            <div className="flex items-center gap-2 flex-wrap self-end md:self-center">
                              {!isAlreadyAdmin && (
                                <button
                                  onClick={() => {
                                    setModalAdminTarget({ nome: m.nome, email: m.email });
                                    setAdminNivel('admin');
                                    setAdminObservacao('');
                                  }}
                                  className="bg-indigo-950/60 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-800/60 hover:border-indigo-500 px-2.5 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1.5 transition shadow-sm cursor-pointer"
                                  title="Promover este membro a Administrador da Plataforma"
                                >
                                  <Shield className="w-3 h-3 text-indigo-400" />
                                  <span>Promover Admin</span>
                                </button>
                              )}

                              {!parceiroCod && (
                                <button
                                  onClick={() => handleAbrirModalParceiro(m)}
                                  className="bg-emerald-950/60 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-800/60 hover:border-emerald-500 px-2.5 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1.5 transition shadow-sm cursor-pointer"
                                  title="Cadastrar como Parceiro Comercial"
                                >
                                  <Award className="w-3 h-3 text-emerald-400" />
                                  <span>Tornar Parceiro</span>
                                </button>
                              )}

                              <button
                                onClick={() => handleAbrirModalEditarUsuario(m)}
                                className="bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 px-2.5 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1.5 transition shadow-sm cursor-pointer"
                                title="Editar Nome e Telefone deste usuário"
                              >
                                <Edit2 className="w-3 h-3 text-amber-400" />
                                <span>Editar Nome</span>
                              </button>

                              <div className="text-right pl-2 border-l border-slate-800">
                                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px] uppercase">
                                  {m.role} ({m.status})
                                </span>
                                <div className="text-[10px] text-slate-500 mt-0.5 font-mono">
                                  Acesso: {m.ultimo_acesso ? new Date(m.ultimo_acesso).toLocaleDateString('pt-BR') : 'Nunca'}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* 12 Months Activity */}
                <div>
                  <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-3 flex items-center space-x-2">
                    <Activity className="w-4 h-4 text-amber-500" />
                    <span>Histórico dos Últimos 12 Meses</span>
                  </h3>
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 overflow-x-auto">
                    <table className="w-full text-xs text-left font-mono">
                      <thead className="text-slate-500 border-b border-slate-800">
                        <tr>
                          <th className="pb-2">Mês</th>
                          <th className="pb-2 text-center">Agendamentos</th>
                          <th className="pb-2 text-center">Execuções Finalizadas</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-900 text-slate-300">
                        {detailData.historico_12m.map((h) => (
                          <tr key={h.mes}>
                            <td className="py-1.5 text-slate-400">{h.mes}</td>
                            <td className="py-1.5 text-center">{h.agendamentos_criados}</td>
                            <td className="py-1.5 text-center text-emerald-400">{h.execucoes_finalizadas}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Zona de Perigo / Exclusão */}
                <div className="bg-red-950/20 border border-red-900/40 rounded-xl p-4 space-y-3">
                  <div className="flex items-center space-x-2 text-red-400">
                    <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                    <h4 className="text-xs font-bold uppercase tracking-wider">Zona de Exclusão de Oficina</h4>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Deseja apagar esta oficina de testes e liberar o e-mail do proprietário para testar um novo cadastro com link de parceiro/afiliado?
                  </p>
                  <button
                    onClick={() => handleAbrirModalExcluir(detailData.tenant.id, detailData.tenant.nome, detailData.tenant.slug)}
                    className="inline-flex items-center space-x-2 bg-red-600 hover:bg-red-500 text-white font-bold px-3.5 py-2 rounded-lg text-xs uppercase tracking-wider transition cursor-pointer shadow"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Excluir Oficina & Liberar E-mails</span>
                  </button>
                </div>

              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4 my-auto">
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-2xl text-red-400">
                  <AlertTriangle className="w-8 h-8" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-white">Não foi possível carregar os detalhes</h3>
                  <p className="text-xs text-slate-400 max-w-sm">
                    {detailError || 'Ocorreu uma instabilidade ao buscar os dados da oficina.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => selectedTenantId && handleOpenDetail(selectedTenantId)}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs uppercase tracking-wider transition cursor-pointer shadow-lg shadow-amber-950/40"
                >
                  Tentar Novamente
                </button>
              </div>
            )}

          </div>
        </div>,
        document.body
      )}

      {/* Modal de Alteração Manual de Plano */}
      {modalPlanoOpen && targetTenant && createPortal(
        <div className="fixed inset-0 z-[100] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6 flex flex-col gap-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white font-display uppercase tracking-wider text-sm flex items-center gap-2">
                <Shield className="text-amber-500" size={18} />
                Alteração Manual de Plano
              </h3>
              <button onClick={() => setModalPlanoOpen(false)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSalvarAlteracaoPlano} className="flex flex-col gap-4">
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs text-slate-300">
                Oficina: <strong className="text-white">{targetTenant.nome}</strong> (Atual: <span className="uppercase font-mono text-amber-400">{targetTenant.planoAtual}</span>)
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-mono font-bold text-slate-300 uppercase">Novo Plano</label>
                <select
                  value={novoPlano}
                  onChange={(e) => setNovoPlano(e.target.value as any)}
                  className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 focus:border-amber-500 outline-none cursor-pointer"
                >
                  <option value="free">FREE (R$ 0/mês)</option>
                  <option value="pro">PRO (R$ 67/mês)</option>
                  <option value="studio">STUDIO (R$ 147/mês)</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-mono font-bold text-slate-300 uppercase">
                  Motivo / Justificativa (Obrigatório para Auditoria)
                </label>
                <textarea
                  rows={3}
                  value={motivoAudit}
                  onChange={(e) => setMotivoAudit(e.target.value)}
                  placeholder="Ex: Cortesia de upgrade aprovada ou alteração comercial."
                  className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 focus:border-amber-500 outline-none resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={salvandoPlano || !motivoAudit.trim()}
                className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer shadow-lg"
              >
                {salvandoPlano ? 'Salvando...' : 'Confirmar e Auditar Alteração'}
              </button>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Modal Promover a Administrador */}
      {modalAdminTarget && createPortal(
        <div className="fixed inset-0 z-[100] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6 flex flex-col gap-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white font-display uppercase tracking-wider text-sm flex items-center gap-2">
                <Shield className="text-indigo-400" size={18} />
                Promover a Administrador da Plataforma
              </h3>
              <button onClick={() => setModalAdminTarget(null)} className="text-slate-400 hover:text-white cursor-pointer">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleConfirmarPromocaoAdmin} className="flex flex-col gap-4">
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs text-slate-300 space-y-1">
                <div>Membro: <strong className="text-white">{modalAdminTarget.nome}</strong></div>
                <div>E-mail: <span className="text-indigo-400 font-mono">{modalAdminTarget.email}</span></div>
                <div className="text-slate-500 text-[11px] pt-1">Ao promover, este usuário terá acesso ao painel de Super Admin e gestão global da Plataforma Detailers.</div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-mono font-bold text-slate-300 uppercase">Nível de Permissão</label>
                <select
                  value={adminNivel}
                  onChange={(e) => setAdminNivel(e.target.value as any)}
                  className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 focus:border-indigo-500 outline-none cursor-pointer"
                >
                  <option value="admin">Administrador (Controle Total de Edição)</option>
                  <option value="suporte">Suporte (Visualização e Suporte Técnico)</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-mono font-bold text-slate-300 uppercase">Observação / Justificativa</label>
                <input
                  type="text"
                  value={adminObservacao}
                  onChange={(e) => setAdminObservacao(e.target.value)}
                  placeholder="Ex: Novo sócio ou membro da equipe interna"
                  className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 focus:border-indigo-500 outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={salvandoAdmin}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer shadow-lg flex items-center justify-center gap-2"
              >
                <Shield size={16} />
                <span>{salvandoAdmin ? 'Promovendo...' : 'Confirmar Promoção para Admin'}</span>
              </button>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Modal Tornar Parceiro Comercial */}
      {modalParceiroTarget && createPortal(
        <div className="fixed inset-0 z-[100] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6 flex flex-col gap-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white font-display uppercase tracking-wider text-sm flex items-center gap-2">
                <Award className="text-emerald-400" size={18} />
                Cadastrar como Parceiro Comercial
              </h3>
              <button onClick={() => setModalParceiroTarget(null)} className="text-slate-400 hover:text-white cursor-pointer">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleConfirmarTornarParceiro} className="flex flex-col gap-4">
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs text-slate-300 space-y-1">
                <div>Nome: <strong className="text-white">{modalParceiroTarget.nome}</strong></div>
                <div>E-mail: <span className="text-emerald-400 font-mono">{modalParceiroTarget.email}</span></div>
                <div className="text-slate-500 text-[11px] pt-1">O login deste usuário terá acesso ao Portal do Parceiro e link de indicação exclusivo.</div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-mono font-bold text-slate-300 uppercase">Código do Cupom / Link (URL)</label>
                <input
                  type="text"
                  value={parceiroCodigo}
                  onChange={(e) => setParceiroCodigo(e.target.value.toUpperCase().replace(/\s+/g, ''))}
                  placeholder="Ex: MEUCUPOM"
                  className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 font-mono focus:border-emerald-500 outline-none uppercase"
                  required
                />
                <span className="text-[10px] text-slate-500">Link gerado: detailers.app/parceiro/{parceiroCodigo || 'CODIGO'}</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-mono font-bold text-slate-300 uppercase">Comissão</label>
                  <select
                    value={parceiroComissaoTipo}
                    onChange={(e) => setParceiroComissaoTipo(e.target.value as any)}
                    className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 focus:border-emerald-500 outline-none cursor-pointer"
                  >
                    <option value="percentual">Percentual (%)</option>
                    <option value="valor_fixo">Fixo (R$)</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-mono font-bold text-slate-300 uppercase">Valor</label>
                  <input
                    type="number"
                    value={parceiroComissaoValor}
                    onChange={(e) => setParceiroComissaoValor(e.target.value)}
                    className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 focus:border-emerald-500 outline-none"
                    required
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-mono font-bold text-slate-300 uppercase">Chave PIX (Opcional)</label>
                <input
                  type="text"
                  value={parceiroPixChave}
                  onChange={(e) => setParceiroPixChave(e.target.value)}
                  placeholder="CPF, Telefone, E-mail ou Aleatória"
                  className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 focus:border-emerald-500 outline-none"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={parceiroRecorrente}
                  onChange={(e) => setParceiroRecorrente(e.target.checked)}
                  className="w-4 h-4 rounded bg-slate-950 border-slate-800 text-emerald-500 focus:ring-0"
                />
                <span className="text-xs text-slate-300">Comissão recorrente em todas as mensalidades</span>
              </label>

              <button
                type="submit"
                disabled={salvandoParceiro || !parceiroCodigo.trim()}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer shadow-lg flex items-center justify-center gap-2"
              >
                <Award size={16} />
                <span>{salvandoParceiro ? 'Cadastrando...' : 'Confirmar Cadastro de Parceiro'}</span>
              </button>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Modal de Exclusão Definitiva */}
      {modalExcluirOpen && tenantParaExcluir && createPortal(
        <div className="fixed inset-0 z-[100] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-red-900/50 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl p-6 flex flex-col gap-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5 text-red-400">
                <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20">
                  <Trash2 className="w-5 h-5 text-red-500" />
                </div>
                <div>
                  <h3 className="font-bold text-white font-display uppercase tracking-wider text-sm">
                    Excluir Oficina Definitivamente
                  </h3>
                  <p className="text-[11px] text-slate-400">Ação irreversível de limpeza</p>
                </div>
              </div>
              <button 
                onClick={() => { setModalExcluirOpen(false); setTenantParaExcluir(null); }} 
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 bg-red-950/30 border border-red-500/30 rounded-xl space-y-2 text-xs">
              <p className="font-bold text-red-300 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                Atenção: Esta ação não pode ser desfeita!
              </p>
              <ul className="list-disc list-inside text-slate-300 space-y-1 pl-1">
                <li>Todos os dados da oficina (<strong className="text-white">{tenantParaExcluir.nome}</strong>) serão apagados: clientes, veículos, agendamentos, serviços, financeiro e histórico.</li>
                <li>Se a opção abaixo estiver marcada, o usuário de login (<strong className="text-white">auth.users</strong>) será removido, liberando o e-mail para se cadastrar novamente do zero.</li>
              </ul>
            </div>

            <form onSubmit={handleConfirmarExclusao} className="flex flex-col gap-4">
              <label className="flex items-start gap-3 p-3 bg-slate-950 border border-slate-800 rounded-xl cursor-pointer hover:border-slate-700 transition">
                <input
                  type="checkbox"
                  checked={excluirAuthUsers}
                  onChange={(e) => setExcluirAuthUsers(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded bg-slate-900 border-slate-700 text-red-600 focus:ring-0 cursor-pointer"
                />
                <div className="text-xs">
                  <span className="font-bold text-slate-200 block">Excluir usuário do login e liberar o e-mail</span>
                  <span className="text-slate-400 text-[11px] block mt-0.5">
                    Permite usar o mesmo e-mail imediatamente para testar o cadastro através do link de parceiro/afiliado.
                  </span>
                </div>
              </label>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-mono font-bold text-slate-300">
                  Para confirmar, digite o nome da oficina: <span className="text-red-400 select-all font-bold">"{tenantParaExcluir.nome}"</span>
                </label>
                <input
                  type="text"
                  value={confirmacaoNome}
                  onChange={(e) => setConfirmacaoNome(e.target.value)}
                  placeholder={`Digite "${tenantParaExcluir.nome}"`}
                  autoFocus
                  className="p-3 bg-slate-950 border border-slate-800 focus:border-red-500 rounded-xl text-xs text-white font-medium outline-none transition"
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setModalExcluirOpen(false); setTenantParaExcluir(null); }}
                  className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs uppercase tracking-wider transition cursor-pointer"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={excluindoOficina || confirmacaoNome.trim().toLowerCase() !== tenantParaExcluir.nome.trim().toLowerCase()}
                  className="flex-1 py-3 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-lg shadow-red-950/50 flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>{excluindoOficina ? 'Excluindo...' : 'Excluir Definitivamente'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Modal para Purgar / Liberar E-mail do auth.users */}
      {modalPurgarEmailOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-red-500/30 rounded-2xl w-full max-w-md p-6 shadow-2xl shadow-red-950/40 relative">
            <button
              onClick={() => setModalPurgarEmailOpen(false)}
              className="absolute top-4 right-4 text-slate-500 hover:text-white transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-red-500/15 border border-red-500/30 rounded-xl text-red-400 shrink-0">
                <UserX className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white font-heading">
                  Liberar E-mail / Excluir Cadastro
                </h3>
                <p className="text-xs text-slate-400">
                  Desbloqueia um e-mail do sistema de autenticação (auth.users)
                </p>
              </div>
            </div>

            <div className="p-3 bg-red-950/30 border border-red-500/20 rounded-xl text-xs text-red-200 leading-relaxed mb-4">
              <p>
                Use esta ferramenta quando um colaborador ou usuário antigo foi apagado mas o e-mail continua aparecendo como <em>"já cadastrado"</em> ao tentar criar uma conta nova.
              </p>
              <p className="mt-1 font-semibold text-red-300">
                O e-mail será totalmente expurgado e liberado imediatamente para novos cadastros e testes de afiliados.
              </p>
            </div>

            <form onSubmit={handleConfirmarPurgarEmail} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-mono font-bold text-slate-300">
                  E-mail para liberar:
                </label>
                <input
                  type="email"
                  value={emailParaPurgar}
                  onChange={(e) => setEmailParaPurgar(e.target.value)}
                  placeholder="exemplo@gmail.com"
                  autoFocus
                  required
                  className="p-3 bg-slate-950 border border-slate-800 focus:border-red-500 rounded-xl text-xs text-white font-medium outline-none transition"
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalPurgarEmailOpen(false)}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs uppercase tracking-wider transition cursor-pointer"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={purgandoEmail || !emailParaPurgar.trim()}
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-lg shadow-red-950/50 flex items-center justify-center gap-2"
                >
                  <UserX className="w-4 h-4" />
                  <span>{purgandoEmail ? 'Liberando...' : 'Liberar E-mail'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Modal para Editar Nome e Dados do Usuário */}
      {modalEditarUsuario && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-amber-500/30 rounded-2xl w-full max-w-md p-6 shadow-2xl shadow-amber-950/40 relative">
            <button
              onClick={() => setModalEditarUsuario(null)}
              className="absolute top-4 right-4 text-slate-500 hover:text-white transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-amber-500/15 border border-amber-500/30 rounded-xl text-amber-400 shrink-0">
                <Edit2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white font-heading">
                  Editar Nome do Usuário
                </h3>
                <p className="text-xs text-slate-400">
                  {modalEditarUsuario.email}
                </p>
              </div>
            </div>

            <form onSubmit={handleSalvarEdicaoUsuario} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-mono font-bold text-slate-300">
                  Nome Completo *
                </label>
                <input
                  type="text"
                  value={editNome}
                  onChange={(e) => setEditNome(e.target.value)}
                  placeholder="Nome do cliente/usuário"
                  autoFocus
                  required
                  className="p-3 bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-xl text-xs text-white font-medium outline-none transition"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-mono font-bold text-slate-300">
                  Telefone / WhatsApp (opcional)
                </label>
                <input
                  type="text"
                  value={editTelefone}
                  onChange={(e) => setEditTelefone(e.target.value)}
                  placeholder="(11) 99999-9999"
                  className="p-3 bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-xl text-xs text-white font-medium outline-none transition"
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalEditarUsuario(null)}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs uppercase tracking-wider transition cursor-pointer"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={salvandoUsuario || !editNome.trim()}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs uppercase tracking-wider transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-lg shadow-amber-950/50 flex items-center justify-center gap-2"
                >
                  {salvandoUsuario ? (
                    'Salvando...'
                  ) : (
                    <>
                      <Edit2 className="w-4 h-4" />
                      <span>Salvar Nome</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Modal de Alteração de Nome da Oficina */}
      {modalEditarOficina && createPortal(
        <div className="fixed inset-0 z-[100] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6 flex flex-col gap-5 animate-in zoom-in-95 duration-150 relative">
            <button
              onClick={() => setModalEditarOficina(null)}
              className="absolute top-4 right-4 text-slate-500 hover:text-white transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-1">
              <div className="p-3 bg-amber-500/15 border border-amber-500/30 rounded-xl text-amber-400 shrink-0">
                <Building2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white font-heading">
                  Alterar Nome da Oficina
                </h3>
                <p className="text-xs text-slate-400">
                  ID: <span className="font-mono">{modalEditarOficina.id}</span>
                </p>
              </div>
            </div>

            <form onSubmit={handleSalvarNomeOficina} className="flex flex-col gap-4">
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300 space-y-1">
                <div>Nome atual: <strong className="text-white">{modalEditarOficina.nome}</strong></div>
                <div className="text-slate-400">
                  Endereço público atual: <span className="text-amber-400 font-mono">/{modalEditarOficina.slug}</span>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-mono font-bold text-slate-300">
                  Novo Nome da Oficina *
                </label>
                <input
                  type="text"
                  value={novoNomeOficina}
                  onChange={(e) => setNovoNomeOficina(e.target.value)}
                  placeholder="Ex: Detail Car Estética Automotiva"
                  autoFocus
                  required
                  className="p-3 bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-xl text-xs text-white font-medium outline-none transition"
                />
              </div>

              {/* Preview Dinâmico do Slug */}
              <div className="p-3 bg-slate-950/80 border border-slate-800/80 rounded-xl space-y-1 text-xs">
                <span className="text-slate-400 block text-[11px] font-mono uppercase">
                  Novo Endereço Público (Sincronizado):
                </span>
                <span className="font-mono font-bold text-amber-400 text-xs break-all">
                  /{calcularSlugPreview(novoNomeOficina, modalEditarOficina.slug)}
                </span>
                <span className="text-[11px] text-slate-500 block pt-0.5">
                  Ao alterar o nome, o link público (/agendar/...) é recalculado automaticamente.
                </span>
              </div>

              {/* Verificação do Intervalo de 15 Dias */}
              {(() => {
                const dataAlteracao = modalEditarOficina.nome_alterado_em ? new Date(modalEditarOficina.nome_alterado_em) : null;
                const diasPassados = dataAlteracao ? (Date.now() - dataAlteracao.getTime()) / (1000 * 60 * 60 * 24) : 999;
                const diasRestantes = Math.max(0, Math.ceil(15 - diasPassados));
                const emCooldown = diasRestantes > 0;

                return (
                  <div className="space-y-2">
                    {emCooldown && (
                      <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-xs flex items-start gap-2">
                        <AlertTriangle size={15} className="shrink-0 mt-0.5 text-amber-400" />
                        <div>
                          <strong>Aviso de Intervalo:</strong> O nome desta oficina foi alterado recentemente. Faltam{' '}
                          <strong>{diasRestantes} dia(s)</strong> para o prazo regular de 15 dias.
                        </div>
                      </div>
                    )}

                    <label className="flex items-center gap-2.5 p-2.5 bg-slate-950 border border-slate-800 rounded-xl cursor-pointer hover:border-slate-700 transition">
                      <input
                        type="checkbox"
                        checked={ignorarCooldownOficina}
                        onChange={(e) => setIgnorarCooldownOficina(e.target.checked)}
                        className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0 cursor-pointer"
                      />
                      <span className="text-xs text-slate-300">
                        Ignorar intervalo de 15 dias (Super Admin)
                      </span>
                    </label>
                  </div>
                );
              })()}

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalEditarOficina(null)}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs uppercase tracking-wider transition cursor-pointer"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={salvandoNomeOficina || !novoNomeOficina.trim() || novoNomeOficina.trim() === modalEditarOficina.nome}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs uppercase tracking-wider transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-lg shadow-amber-950/50 flex items-center justify-center gap-2"
                >
                  {salvandoNomeOficina ? (
                    'Salvando...'
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      <span>Salvar Nome e Slug</span>
                    </>
                  )}
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
