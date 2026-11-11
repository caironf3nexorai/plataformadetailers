import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { useAdminAuth } from '../../components/admin/AdminGuard';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Award, Plus, DollarSign, Upload, CheckCircle2, Search, Ticket, Zap, Pencil, X, Trash2, AlertTriangle } from 'lucide-react';
import { calcularImpactoExclusaoParceiro } from '../../utils/adminContas';

interface ParceiroItem {
  id: string;
  nome: string;
  email: string;
  telefone: string | null;
  codigo: string;
  comissao_tipo: 'percentual' | 'valor_fixo';
  comissao_valor: number;
  recorrente: boolean;
  pix_chave: string | null;
  pix_tipo: string | null;
  user_id?: string | null;
  ativo: boolean;
  desconto_tipo?: 'nenhum' | 'percentual' | 'valor_fixo';
  desconto_valor?: number;
  created_at: string;
}

interface ComissãoItem {
  id: string;
  parceiro_id?: string;
  competencia: string;
  valor_base: number;
  valor_comissao: number;
  status: 'prevista' | 'aprovada' | 'paga' | 'cancelada';
  pago_em: string | null;
  comprovante_path: string | null;
  parceiro: { nome: string; pix_chave: string } | null;
  tenant: { nome: string } | null;
}

interface OficinaItem {
  id: string;
  nome: string;
  cidade: string | null;
  uf: string | null;
  parceiro_id?: string | null;
  parceiro_nome?: string | null;
  parceiro_codigo?: string | null;
}

interface UsuarioPlataformaItem {
  id: string;
  nome: string;
  email: string;
  telefone?: string | null;
  tenant_nome?: string | null;
}

export const AdminParceiros: React.FC = () => {
  const { showSuccess, showError } = useToast();
  const { adminLevel } = useAdminAuth();
  const isReadOnly = adminLevel === 'suporte';

  const [parceiros, setParceiros] = useState<ParceiroItem[]>([]);
  const [comissoes, setComissoes] = useState<ComissãoItem[]>([]);
  const [oficinas, setOficinas] = useState<OficinaItem[]>([]);
  const [usuariosPlataforma, setUsuariosPlataforma] = useState<UsuarioPlataformaItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Filtro de busca na secao de pagamento
  const [buscaOficina, setBuscaOficina] = useState('');
  const [modoSelecaoPagamento, setModoSelecaoPagamento] = useState<'parceiro' | 'oficina'>('parceiro');
  const [parceiroIdPagamento, setParceiroIdPagamento] = useState('');

  // Filtro de busca na Tabela de Parceiros
  const [buscaParceiro, setBuscaParceiro] = useState('');

  // Modal Novo Parceiro
  const [modalNovoParceiro, setModalNovoParceiro] = useState(false);
  const [usuarioSelecionadoId, setUsuarioSelecionadoId] = useState('');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [codigo, setCodigo] = useState('');
  const [comissaoTipo, setComissaoTipo] = useState<'percentual' | 'valor_fixo'>('percentual');
  const [comissaoValor, setComissaoValor] = useState('20');
  const [descontoTipo, setDescontoTipo] = useState<'nenhum' | 'percentual' | 'valor_fixo'>('nenhum');
  const [descontoValor, setDescontoValor] = useState('0');
  const [recorrente, setRecorrente] = useState(true);
  const [pixChave, setPixChave] = useState('');
  const [salvandoParceiro, setSalvandoParceiro] = useState(false);

  // Modal Vincular Oficina ao Parceiro
  const [parceiroVinculoTarget, setParceiroVinculoTarget] = useState<ParceiroItem | null>(null);
  const [tenantIdVinculo, setTenantIdVinculo] = useState('');
  const [salvandoVinculo, setSalvandoVinculo] = useState(false);

  // Modal Editar Parceiro
  const [parceiroEditando, setParceiroEditando] = useState<ParceiroItem | null>(null);
  const [editNome, setEditNome] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editTelefone, setEditTelefone] = useState('');
  const [editCodigo, setEditCodigo] = useState('');
  const [editComissaoTipo, setEditComissaoTipo] = useState<'percentual' | 'valor_fixo'>('percentual');
  const [editComissaoValor, setEditComissaoValor] = useState('20');
  const [editDescontoTipo, setEditDescontoTipo] = useState<'nenhum' | 'percentual' | 'valor_fixo'>('nenhum');
  const [editDescontoValor, setEditDescontoValor] = useState('0');
  const [editRecorrente, setEditRecorrente] = useState(true);
  const [editPixChave, setEditPixChave] = useState('');
  const [editUsuarioId, setEditUsuarioId] = useState('');
  const [editAtivo, setEditAtivo] = useState(true);
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);

  // Modal Excluir Parceiro
  const [parceiroParaExcluir, setParceiroParaExcluir] = useState<ParceiroItem | null>(null);
  const [desativarCuponsAoExcluir, setDesativarCuponsAoExcluir] = useState(true);
  const [excluindoParceiro, setExcluindoParceiro] = useState(false);

  // Pagamento de Competência Manual
  const [tenantIdPagamento, setTenantIdPagamento] = useState('');
  const [competenciaInput, setCompetenciaInput] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [registrandoPagamento, setRegistrandoPagamento] = useState(false);

  const carregarDados = async () => {
    setLoading(true);
    try {
      // 1. Carregar Parceiros
      const { data: dataP, error: errP } = await supabase
        .from('parceiros')
        .select('*')
        .order('created_at', { ascending: false });

      if (errP) throw errP;
      setParceiros(dataP || []);

      // 2. Carregar Comissões
      const { data: dataC, error: errC } = await supabase
        .from('parceiro_comissoes')
        .select(`
          id,
          parceiro_id,
          competencia,
          valor_base,
          valor_comissao,
          status,
          pago_em,
          comprovante_path,
          parceiro:parceiros(nome, pix_chave),
          tenant:tenants(nome)
        `)
        .order('competencia', { ascending: false });

      if (!errC && dataC) {
        setComissoes(dataC as any[]);
      }

      // 3. Carregar Oficinas (Tenants) com vínculo de parceiro via RPC administrativa
      const { data: dataTenants, error: errT } = await supabase.rpc('admin_listar_tenants', {
        p_busca: null,
        p_plano: null,
        p_limite: 500,
        p_offset: 0,
      });

      if (errT) throw errT;

      const { data: dataVinculos, error: errV } = await supabase
        .from('parceiro_oficinas')
        .select(`
          tenant_id,
          parceiro_id,
          parceiro:parceiros(nome, codigo)
        `);

      const mapVinculos = new Map<string, { parceiro_id: string; parceiro_nome: string; parceiro_codigo: string }>();
      if (!errV && dataVinculos) {
        dataVinculos.forEach((v: any) => {
          if (v.tenant_id && v.parceiro) {
            mapVinculos.set(v.tenant_id, {
              parceiro_id: v.parceiro_id,
              parceiro_nome: v.parceiro.nome,
              parceiro_codigo: v.parceiro.codigo,
            });
          }
        });
      }

      const listaOficinas: OficinaItem[] = (dataTenants || []).map((t: any) => {
        const vinc = mapVinculos.get(t.id);
        return {
          id: t.id,
          nome: t.nome,
          cidade: t.cidade,
          uf: t.uf,
          parceiro_id: vinc?.parceiro_id,
          parceiro_nome: vinc?.parceiro_nome,
          parceiro_codigo: vinc?.parceiro_codigo,
        };
      });

      setOficinas(listaOficinas);

      // 4. Carregar Usuários Registrados da Plataforma via RPC admin_listar_usuarios_para_parceiro
      try {
        const { data: dataRpc, error: errRpc } = await supabase.rpc('admin_listar_usuarios_para_parceiro');
        if (!errRpc && dataRpc && dataRpc.length > 0) {
          const listaUsers: UsuarioPlataformaItem[] = dataRpc.map((u: any) => ({
            id: u.id,
            nome: u.nome || u.email,
            email: u.email,
            telefone: u.telefone,
            tenant_nome: u.tenant_nome,
          }));
          setUsuariosPlataforma(listaUsers);
        } else {
          // Fallback via profiles ou tenant_members
          const { data: dataProfiles } = await supabase
            .from('profiles')
            .select('id, nome, telefone')
            .order('created_at', { ascending: false });

          if (dataProfiles && dataProfiles.length > 0) {
            const listaUsers: UsuarioPlataformaItem[] = dataProfiles.map((p: any) => ({
              id: p.id,
              nome: p.nome || 'Usuário',
              email: 'usuario@plataforma.com',
              telefone: p.telefone,
            }));
            setUsuariosPlataforma(listaUsers);
          }
        }
      } catch (errUsers) {
        console.warn('Erro ao listar usuários para parceiro:', errUsers);
      }

    } catch (err: any) {
      console.error('Erro ao carregar parceiros:', err);
      showError('Erro ao carregar dados de parceiros');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarDados();
  }, []);

  const handleAbrirEdicao = (p: ParceiroItem) => {
    setParceiroEditando(p);
    setEditNome(p.nome);
    setEditEmail(p.email);
    setEditTelefone(p.telefone || '');
    setEditCodigo(p.codigo);
    setEditComissaoTipo(p.comissao_tipo);
    setEditComissaoValor(String(p.comissao_valor));
    setEditDescontoTipo(p.desconto_tipo || 'nenhum');
    setEditDescontoValor(String(p.desconto_valor || 0));
    setEditRecorrente(p.recorrente);
    setEditPixChave(p.pix_chave || '');
    setEditUsuarioId(p.user_id || '');
    setEditAtivo(p.ativo);
  };

  const handleSalvarEdicaoParceiro = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!parceiroEditando) return;

    if (!editNome.trim() || !editEmail.trim() || !editCodigo.trim()) {
      showError('Preencha os campos obrigatórios.');
      return;
    }

    setSalvandoEdicao(true);
    try {
      const { error } = await supabase
        .from('parceiros')
        .update({
          nome: editNome.trim(),
          email: editEmail.trim().toLowerCase(),
          telefone: editTelefone.trim() || null,
          codigo: editCodigo.trim().toUpperCase(),
          comissao_tipo: editComissaoTipo,
          comissao_valor: parseFloat(editComissaoValor) || 0,
          desconto_tipo: editDescontoTipo,
          desconto_valor: parseFloat(editDescontoValor) || 0,
          recorrente: editRecorrente,
          pix_chave: editPixChave.trim() || null,
          user_id: editUsuarioId ? editUsuarioId : null,
          ativo: editAtivo,
        })
        .eq('id', parceiroEditando.id);

      if (error) throw error;

      showSuccess('Dados do parceiro atualizados com sucesso!');
      setParceiroEditando(null);
      await carregarDados();
    } catch (err: any) {
      console.error('Erro ao atualizar parceiro:', err);
      showError(err.message || 'Erro ao atualizar parceiro');
    } finally {
      setSalvandoEdicao(false);
    }
  };

  const handleSelecionarUsuarioParaParceiro = (uId: string) => {
    setUsuarioSelecionadoId(uId);
    if (!uId) return;

    const userObj = usuariosPlataforma.find((u) => u.id === uId);
    if (userObj) {
      setNome(userObj.nome);
      setEmail(userObj.email);
      if (userObj.telefone) setTelefone(userObj.telefone);
      
      // Sugerir código baseado no nome/email
      const nomeLimpo = userObj.nome.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      setCodigo(`${nomeLimpo || 'PARC'}10`);
    }
  };

  const handleSalvarVinculoOficina = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!parceiroVinculoTarget || !tenantIdVinculo) {
      showError('Selecione uma oficina para vincular.');
      return;
    }

    setSalvandoVinculo(true);
    try {
      const { error } = await supabase.rpc('admin_vincular_oficina_parceiro', {
        p_tenant_id: tenantIdVinculo,
        p_parceiro_id: parceiroVinculoTarget.id,
      });

      if (error) {
        const { error: upsertErr } = await supabase
          .from('parceiro_oficinas')
          .upsert(
            { parceiro_id: parceiroVinculoTarget.id, tenant_id: tenantIdVinculo },
            { onConflict: 'tenant_id' }
          );
        if (upsertErr) throw upsertErr;
      }

      showSuccess(`Oficina vinculada com sucesso ao parceiro "${parceiroVinculoTarget.nome}"!`);
      setParceiroVinculoTarget(null);
      setTenantIdVinculo('');
      await carregarDados();
    } catch (err: any) {
      console.error('Erro ao vincular oficina:', err);
      showError(err.message || 'Erro ao vincular oficina');
    } finally {
      setSalvandoVinculo(false);
    }
  };

  const handleDesvincularOficina = async (oficina: OficinaItem) => {
    if (isReadOnly) return;
    if (!confirm(`Desvincular a oficina "${oficina.nome}" deste parceiro?`)) return;

    try {
      const { error } = await supabase.rpc('admin_vincular_oficina_parceiro', {
        p_tenant_id: oficina.id,
        p_parceiro_id: null,
      });
      if (error) throw error;

      showSuccess(`Oficina "${oficina.nome}" desvinculada do parceiro.`);
      await carregarDados();
    } catch (err: any) {
      console.error('Erro ao desvincular oficina:', err);
      showError(err.message || 'Erro ao desvincular oficina');
    }
  };

  const handleAbrirExclusaoParceiro = (p: ParceiroItem) => {
    if (isReadOnly) return;
    setParceiroParaExcluir(p);
    setDesativarCuponsAoExcluir(true);
  };

  const handleConfirmarExclusaoParceiro = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!parceiroParaExcluir || isReadOnly) return;

    setExcluindoParceiro(true);
    try {
      const { data, error } = await supabase.rpc('admin_excluir_parceiro', {
        p_parceiro_id: parceiroParaExcluir.id,
        p_desativar_cupons: desativarCuponsAoExcluir,
      });

      if (error) throw error;

      const oficinasMsg = data?.oficinas_desvinculadas
        ? ` ${data.oficinas_desvinculadas} oficina(s) desvinculada(s).`
        : '';
      const comissoesMsg = data?.comissoes_removidas
        ? ` ${data.comissoes_removidas} comissão(ões) removida(s).`
        : '';

      showSuccess(`Parceiro "${parceiroParaExcluir.nome}" (${parceiroParaExcluir.codigo}) excluído com sucesso!${oficinasMsg}${comissoesMsg}`);

      if (parceiroIdPagamento === parceiroParaExcluir.id) {
        setParceiroIdPagamento('');
        setTenantIdPagamento('');
      }
      setParceiroParaExcluir(null);
      await carregarDados();
    } catch (err: any) {
      console.error('Erro ao excluir parceiro:', err);
      showError(err.message || 'Erro ao excluir parceiro comercial');
    } finally {
      setExcluindoParceiro(false);
    }
  };

  const handleCriarParceiro = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim() || !email.trim() || !codigo.trim()) {
      showError('Preencha os campos obrigatórios.');
      return;
    }

    setSalvandoParceiro(true);
    try {
      const { error } = await supabase.from('parceiros').insert({
        nome: nome.trim(),
        email: email.trim().toLowerCase(),
        telefone: telefone.trim() || null,
        codigo: codigo.trim().toUpperCase(),
        comissao_tipo: comissaoTipo,
        comissao_valor: parseFloat(comissaoValor) || 0,
        desconto_tipo: descontoTipo,
        desconto_valor: parseFloat(descontoValor) || 0,
        recorrente,
        pix_chave: pixChave.trim() || null,
        user_id: usuarioSelecionadoId || null,
        ativo: true,
      });

      if (error) throw error;

      showSuccess('Parceiro comercial cadastrado com sucesso!');
      setModalNovoParceiro(false);
      setUsuarioSelecionadoId('');
      setNome('');
      setEmail('');
      setTelefone('');
      setCodigo('');
      setPixChave('');
      setDescontoTipo('nenhum');
      setDescontoValor('0');
      await carregarDados();
    } catch (err: any) {
      console.error('Erro ao salvar parceiro:', err);
      showError(err.message || 'Erro ao cadastrar parceiro');
    } finally {
      setSalvandoParceiro(false);
    }
  };

  const handleRegistrarPagamentoOficina = async (tenantIdTarget?: string) => {
    const idParaUsar = tenantIdTarget || tenantIdPagamento;
    if (!idParaUsar || !idParaUsar.trim() || !competenciaInput) {
      showError('Selecione uma oficina e informe a competência.');
      return;
    }

    setRegistrandoPagamento(true);
    try {
      const { error } = await supabase.rpc('admin_registrar_pagamento_manual_competencia', {
        p_tenant_id: idParaUsar.trim(),
        p_competencia: competenciaInput,
      });

      if (error) throw error;

      const oficinaObj = oficinas.find((o) => o.id === idParaUsar);
      showSuccess(`Pagamento de competência para "${oficinaObj?.nome || 'Oficina'}" registrado com sucesso!`);
      if (!tenantIdTarget) {
        setTenantIdPagamento('');
      }
    } catch (err: any) {
      console.error('Erro ao registrar pagamento:', err);
      showError(err.message || 'Erro ao registrar pagamento');
    } finally {
      setRegistrandoPagamento(false);
    }
  };

  const handleGerarComissoesMensais = async () => {
    try {
      const { data, error } = await supabase.rpc('admin_gerar_comissoes_mensais', {
        p_competencia: competenciaInput,
      });

      if (error) throw error;

      showSuccess(`Apuração concluída! ${data.comissoes_geradas || 0} comissões geradas.`);
      await carregarDados();
    } catch (err: any) {
      console.error('Erro ao apurar comissões:', err);
      showError(err.message || 'Erro ao apurar comissões');
    }
  };

  const handleUploadComprovante = async (comissaoId: string, file: File) => {
    try {
      const path = `${comissaoId}/${Date.now()}_${file.name}`;
      const { error: errUpload } = await supabase.storage
        .from('comprovantes_parceiros')
        .upload(path, file, { upsert: true });

      if (errUpload) throw errUpload;

      const { error: errUpdate } = await supabase
        .from('parceiro_comissoes')
        .update({
          comprovante_path: path,
          status: 'paga',
          pago_em: new Date().toISOString(),
        })
        .eq('id', comissaoId);

      if (errUpdate) throw errUpdate;

      showSuccess('Comprovante enviado e comissão marcada como PAGA!');
      await carregarDados();
    } catch (err: any) {
      console.error('Erro ao enviar comprovante:', err);
      showError('Erro ao enviar comprovante');
    }
  };

  // Oficinas filtradas por busca no seletor de pagamentos
  const oficinasFiltradas = oficinas.filter(
    (o) =>
      o.nome.toLowerCase().includes(buscaOficina.toLowerCase()) ||
      (o.cidade && o.cidade.toLowerCase().includes(buscaOficina.toLowerCase())) ||
      (o.parceiro_nome && o.parceiro_nome.toLowerCase().includes(buscaOficina.toLowerCase())) ||
      (o.parceiro_codigo && o.parceiro_codigo.toLowerCase().includes(buscaOficina.toLowerCase()))
  );

  // Parceiros filtrados na Tabela de Parceiros
  const parceirosFiltrados = parceiros.filter(
    (p) =>
      p.nome.toLowerCase().includes(buscaParceiro.toLowerCase()) ||
      p.email.toLowerCase().includes(buscaParceiro.toLowerCase()) ||
      p.codigo.toLowerCase().includes(buscaParceiro.toLowerCase()) ||
      (p.pix_chave && p.pix_chave.toLowerCase().includes(buscaParceiro.toLowerCase()))
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-vapor-100 uppercase tracking-wide flex items-center gap-2">
            <Award className="text-blue-400" size={24} />
            Programa de Parceiros Comerciais
          </h1>
          <p className="font-sans text-sm text-vapor-400">
            Cadastre parceiros, configure cupons de desconto, confirme pagamentos manuais e apure comissões recorrentes.
          </p>
        </div>

        <Button
          type="button"
          variant="primary"
          disabled={isReadOnly}
          onClick={() => setModalNovoParceiro(true)}
          className="flex items-center gap-2 disabled:opacity-50"
        >
          <Plus size={18} />
          <span>Novo Parceiro</span>
        </Button>
      </div>

      {/* Seção 1: Confirmação de Pagamento de Competência & Apuração */}
      <Card className="p-6 bg-graphite-800 border-graphite-600 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-graphite-700 pb-3">
          <h2 className="font-display text-lg text-vapor-100 uppercase tracking-wide flex items-center gap-2">
            <DollarSign className="text-emerald-400" size={20} />
            Confirmação Manual de Competência
          </h2>

          <div className="flex items-center gap-1 bg-graphite-900 p-1 rounded-lg border border-graphite-700 text-xs">
            <button
              type="button"
              onClick={() => {
                setModoSelecaoPagamento('parceiro');
                setTenantIdPagamento('');
              }}
              className={`px-3 py-1 rounded-md font-medium transition ${
                modoSelecaoPagamento === 'parceiro'
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'text-vapor-400 hover:text-vapor-200'
              }`}
            >
              Por Parceiro
            </button>
            <button
              type="button"
              onClick={() => {
                setModoSelecaoPagamento('oficina');
                setParceiroIdPagamento('');
              }}
              className={`px-3 py-1 rounded-md font-medium transition ${
                modoSelecaoPagamento === 'oficina'
                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                  : 'text-vapor-400 hover:text-vapor-200'
              }`}
            >
              Por Oficina
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {modoSelecaoPagamento === 'parceiro' ? (
            <div className="space-y-1">
              <label className="text-xs text-vapor-400 font-medium">Selecionar Parceiro Cadastrado *</label>
              <select
                value={parceiroIdPagamento}
                onChange={(e) => {
                  const pId = e.target.value;
                  setParceiroIdPagamento(pId);
                  const pObj = parceiros.find((p) => p.id === pId);
                  if (pObj) {
                    const linked = oficinas.filter((o) => o.parceiro_id === pObj.id);
                    if (linked.length > 0) {
                      setTenantIdPagamento(linked[0].id);
                    } else {
                      setTenantIdPagamento('');
                    }
                  } else {
                    setTenantIdPagamento('');
                  }
                }}
                className="w-full bg-graphite-900 border border-graphite-700 rounded-lg p-2.5 text-vapor-100 text-xs focus:ring-1 focus:ring-amber-500 font-sans"
              >
                <option value="">-- Selecione um Parceiro ({parceiros.length}) --</option>
                {parceiros.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome} (Cupom: {p.codigo}) {p.pix_chave ? `- PIX: ${p.pix_chave}` : ''}
                  </option>
                ))}
              </select>

              {parceiroIdPagamento && (() => {
                const pSel = parceiros.find((p) => p.id === parceiroIdPagamento);
                const ofsLinked = oficinas.filter((o) => o.parceiro_id === parceiroIdPagamento);
                return (
                  <div className="p-2.5 bg-graphite-900/80 rounded-lg border border-graphite-700/80 text-xs space-y-1.5 mt-2">
                    <div className="flex items-center justify-between text-amber-400 font-semibold">
                      <span>Cupom: {pSel?.codigo}</span>
                      <span className="text-vapor-400 font-normal">PIX: {pSel?.pix_chave || 'Não informada'}</span>
                    </div>
                    {ofsLinked.length > 0 ? (
                      <div className="space-y-1">
                        <span className="text-[10px] text-vapor-400 block">Oficina Vinculada para Receber Pagamento:</span>
                        <select
                          value={tenantIdPagamento}
                          onChange={(e) => setTenantIdPagamento(e.target.value)}
                          className="w-full bg-graphite-800 border border-graphite-600 rounded p-1.5 text-vapor-100 text-xs"
                        >
                          {ofsLinked.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.nome} {o.cidade ? `(${o.cidade}/${o.uf || ''})` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="text-[11px] text-amber-300 italic">
                        Este parceiro ainda não possui oficinas vinculadas. Você pode atribuir uma oficina na tabela abaixo.
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="space-y-1">
              <label className="text-xs text-vapor-400 font-medium">Selecionar Oficina (Tenant) *</label>
              <div className="space-y-1">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Filtrar por oficina ou parceiro..."
                    value={buscaOficina}
                    onChange={(e) => setBuscaOficina(e.target.value)}
                    className="w-full bg-graphite-900 border border-graphite-700 rounded-t-lg px-3 py-1.5 text-xs text-vapor-100 placeholder-vapor-400"
                  />
                  <Search size={12} className="absolute right-3 top-2.5 text-vapor-400" />
                </div>
                <select
                  value={tenantIdPagamento}
                  onChange={(e) => setTenantIdPagamento(e.target.value)}
                  className="w-full bg-graphite-900 border border-graphite-700 rounded-b-lg p-2.5 text-vapor-100 text-xs focus:ring-1 focus:ring-amber-500 font-sans"
                >
                  <option value="">-- Selecione uma Oficina ({oficinasFiltradas.length}) --</option>
                  {oficinasFiltradas.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nome} {o.cidade ? `(${o.cidade}/${o.uf || ''})` : ''} {o.parceiro_nome ? `[Parceiro: ${o.parceiro_nome}]` : '[Sem Parceiro]'}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs text-vapor-400 font-medium">Competência (AAAA-MM-01) *</label>
            <Input
              type="date"
              value={competenciaInput}
              onChange={(e) => setCompetenciaInput(e.target.value)}
              className="bg-graphite-900 border-graphite-700 text-vapor-100"
            />
          </div>

          <div className="flex items-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => handleRegistrarPagamentoOficina()}
              disabled={isReadOnly || registrandoPagamento || !tenantIdPagamento}
              className="w-full text-xs disabled:opacity-40"
            >
              {registrandoPagamento ? 'Registrando...' : 'Confirmar Pagamento'}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={isReadOnly}
              onClick={handleGerarComissoesMensais}
              className="w-full text-xs bg-indigo-600 hover:bg-indigo-500 text-white border-none disabled:opacity-40"
            >
              Apurar Comissões
            </Button>
          </div>
        </div>
      </Card>

      {/* Lista de Parceiros & Oficinas Vinculadas */}
      <Card className="p-6 bg-graphite-800 border-graphite-600 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg text-vapor-100 uppercase tracking-wide">
              Parceiros Cadastrados ({parceirosFiltrados.length})
            </h2>
            <span className="text-xs text-vapor-400 font-sans">
              Gerencie parceiros, vincule oficinas, edite comissões/cupons ou confirme pagamentos.
            </span>
          </div>

          <div className="relative w-full sm:w-64">
            <input
              type="text"
              placeholder="Buscar parceiro por nome, código ou e-mail..."
              value={buscaParceiro}
              onChange={(e) => setBuscaParceiro(e.target.value)}
              className="w-full bg-graphite-900 border border-graphite-700 rounded-lg px-3 py-1.5 text-xs text-vapor-100 placeholder-vapor-400 focus:ring-1 focus:ring-amber-500"
            />
            <Search size={14} className="absolute right-3 top-2 text-vapor-400" />
          </div>
        </div>

        {loading ? (
          <div className="py-8 text-center text-vapor-400 text-sm">Carregando parceiros...</div>
        ) : parceirosFiltrados.length === 0 ? (
          <div className="py-8 text-center text-vapor-400 text-sm">
            {buscaParceiro ? `Nenhum parceiro encontrado para "${buscaParceiro}".` : 'Nenhum parceiro cadastrado.'}
          </div>
        ) : (
          <>
            {/* Tabela Desktop Compacta (sem cortar a coluna Ações) */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-left font-sans text-xs xl:text-sm">
                <thead>
                  <tr className="border-b border-graphite-700 text-vapor-400 text-[11px] font-semibold uppercase">
                    <th className="py-3 px-3">Nome / E-mail</th>
                    <th className="py-3 px-3">Código / Cupom</th>
                    <th className="py-3 px-3">Comissão</th>
                    <th className="py-3 px-3">Desconto p/ Oficina</th>
                    <th className="py-3 px-3">Oficinas Vinculadas</th>
                    <th className="py-3 px-3">Chave PIX</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-graphite-700/50">
                  {parceirosFiltrados.map((p) => {
                    const oficinasDoParceiro = oficinas.filter((o) => o.parceiro_id === p.id);

                    return (
                      <tr key={p.id} className="hover:bg-graphite-700/30 transition align-top">
                        <td className="py-3 px-3 max-w-[190px]">
                          <div className="font-medium text-vapor-100 truncate" title={p.nome}>
                            {p.nome}
                          </div>
                          <div className="text-xs text-vapor-400 truncate" title={p.email}>
                            {p.email}
                          </div>
                          {p.telefone && <div className="text-[10px] text-vapor-500">{p.telefone}</div>}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span className="font-mono font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 text-xs">
                            {p.codigo}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-bold text-emerald-400 whitespace-nowrap">
                          {p.comissao_tipo === 'percentual' ? `${p.comissao_valor}%` : `R$ ${p.comissao_valor.toFixed(2)}`}
                          <div className="text-[10px] text-vapor-400 font-normal">
                            {p.recorrente ? 'Recorrente' : 'Apenas 1ª mensalidade'}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-xs font-semibold text-blue-400 whitespace-nowrap">
                          {p.desconto_tipo === 'percentual' && (p.desconto_valor || 0) > 0 ? (
                            <span className="inline-flex items-center gap-1 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                              <Ticket size={12} /> {p.desconto_valor}% OFF
                            </span>
                          ) : p.desconto_tipo === 'valor_fixo' && (p.desconto_valor || 0) > 0 ? (
                            <span className="inline-flex items-center gap-1 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                              <Ticket size={12} /> R$ {p.desconto_valor?.toFixed(2)} OFF
                            </span>
                          ) : (
                            <span className="text-vapor-500">Sem Desconto</span>
                          )}
                        </td>
                        <td className="py-3 px-3 min-w-[180px]">
                          <div className="space-y-1.5">
                            {oficinasDoParceiro.length === 0 ? (
                              <span className="text-xs text-vapor-500 italic block">Nenhuma oficina atrelada</span>
                            ) : (
                              <div className="flex flex-col gap-1.5 max-h-32 overflow-y-auto pr-1">
                                {oficinasDoParceiro.map((of) => (
                                  <div
                                    key={of.id}
                                    className="flex items-center justify-between gap-1.5 p-1.5 rounded bg-graphite-900/60 border border-graphite-700/60 text-xs"
                                  >
                                    <span className="text-vapor-200 font-medium truncate max-w-[115px]" title={of.nome}>
                                      {of.nome}
                                    </span>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        type="button"
                                        disabled={isReadOnly}
                                        onClick={() => {
                                          setTenantIdPagamento(of.id);
                                          handleRegistrarPagamentoOficina(of.id);
                                        }}
                                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 border border-emerald-500/30 text-[10px] font-semibold transition disabled:opacity-40 cursor-pointer"
                                        title="Confirmar pagamento de competência para esta oficina"
                                      >
                                        <Zap size={10} />
                                        <span>Pgto</span>
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isReadOnly}
                                        onClick={() => handleDesvincularOficina(of)}
                                        className="inline-flex items-center justify-center p-1 rounded bg-rose-500/15 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30 text-[10px] transition disabled:opacity-40 cursor-pointer"
                                        title={`Desvincular ${of.nome} deste parceiro`}
                                      >
                                        <X size={11} />
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                            <button
                              type="button"
                              disabled={isReadOnly}
                              onClick={() => {
                                setParceiroVinculoTarget(p);
                                setTenantIdVinculo('');
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 text-[10px] font-semibold transition disabled:opacity-40 cursor-pointer"
                            >
                              <Plus size={12} />
                              <span>Atribuir Oficina</span>
                            </button>
                          </div>
                        </td>
                        <td className="py-3 px-3 font-mono text-xs text-vapor-300 max-w-[130px] truncate" title={p.pix_chave || ''}>
                          {p.pix_chave || '—'}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="flex flex-col gap-1">
                            {p.ativo ? (
                              <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium w-fit">Ativo</span>
                            ) : (
                              <span className="text-[11px] px-2 py-0.5 rounded bg-flare-400/10 text-flare-400 border border-flare-400/20 font-medium w-fit">Inativo</span>
                            )}
                            {p.user_id ? (
                              <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-mono font-medium">
                                <CheckCircle2 size={11} /> Login Ativo
                              </span>
                            ) : (
                              <span className="text-[10px] text-vapor-500 flex items-center gap-1 font-mono" title="O parceiro será vinculado automaticamente quando cadastrar ou logar com este e-mail">
                                ⚪ Aguardando Login
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          <div className="flex flex-col items-end gap-1.5">
                            <button
                              type="button"
                              disabled={isReadOnly}
                              onClick={() => handleAbrirEdicao(p)}
                              className="inline-flex items-center justify-center gap-1.5 w-[88px] px-2.5 py-1.5 text-xs font-semibold text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg transition disabled:opacity-40 cursor-pointer"
                            >
                              <Pencil size={13} />
                              <span>Editar</span>
                            </button>
                            <button
                              type="button"
                              disabled={isReadOnly}
                              onClick={() => handleAbrirExclusaoParceiro(p)}
                              className="inline-flex items-center justify-center gap-1.5 w-[88px] px-2.5 py-1.5 text-xs font-semibold text-rose-300 hover:text-white bg-rose-500/15 hover:bg-rose-600/30 border border-rose-500/40 rounded-lg transition disabled:opacity-40 cursor-pointer"
                              title="Excluir parceiro comercial"
                            >
                              <Trash2 size={13} />
                              <span>Excluir</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Cards Responsivos Mobile / Tablet */}
            <div className="lg:hidden space-y-3">
              {parceirosFiltrados.map((p) => {
                const oficinasDoParceiro = oficinas.filter((o) => o.parceiro_id === p.id);

                return (
                  <div
                    key={p.id}
                    className="bg-graphite-900/80 border border-graphite-700 rounded-xl p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-vapor-100 truncate">{p.nome}</div>
                        <div className="text-xs text-vapor-400 break-all">{p.email}</div>
                        {p.telefone && <div className="text-[11px] text-vapor-500 mt-0.5">{p.telefone}</div>}
                      </div>
                      <span className="font-mono font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 text-xs shrink-0">
                        {p.codigo}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-graphite-700/70">
                      <div>
                        <span className="text-[10px] text-vapor-500 block">Comissão</span>
                        <span className="font-bold text-emerald-400">
                          {p.comissao_tipo === 'percentual' ? `${p.comissao_valor}%` : `R$ ${p.comissao_valor.toFixed(2)}`}
                        </span>{' '}
                        <span className="text-[10px] text-vapor-400">
                          ({p.recorrente ? 'Recorrente' : '1ª mensalidade'})
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-vapor-500 block">Desconto Cupom</span>
                        {p.desconto_tipo === 'percentual' && (p.desconto_valor || 0) > 0 ? (
                          <span className="text-blue-400 font-semibold">{p.desconto_valor}% OFF</span>
                        ) : p.desconto_tipo === 'valor_fixo' && (p.desconto_valor || 0) > 0 ? (
                          <span className="text-blue-400 font-semibold">R$ {p.desconto_valor?.toFixed(2)} OFF</span>
                        ) : (
                          <span className="text-vapor-500">Sem Desconto</span>
                        )}
                      </div>
                      <div className="col-span-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] font-mono text-vapor-300 truncate">
                          PIX: {p.pix_chave || '—'}
                        </span>
                        <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${
                          p.ativo
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-flare-400/10 text-flare-400 border border-flare-400/20'
                        }`}>
                          {p.ativo ? 'Ativo' : 'Inativo'}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1.5 pt-2 border-t border-graphite-700/70">
                      <span className="text-[11px] text-vapor-400 font-semibold block">
                        Oficinas Vinculadas ({oficinasDoParceiro.length})
                      </span>
                      {oficinasDoParceiro.map((of) => (
                        <div
                          key={of.id}
                          className="flex items-center justify-between gap-2 p-2 rounded bg-graphite-950/70 border border-graphite-700/60 text-xs"
                        >
                          <span className="text-vapor-200 font-medium truncate">{of.nome}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              disabled={isReadOnly}
                              onClick={() => {
                                setTenantIdPagamento(of.id);
                                handleRegistrarPagamentoOficina(of.id);
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-semibold disabled:opacity-40"
                            >
                              <Zap size={10} />
                              <span>Pgto</span>
                            </button>
                            <button
                              type="button"
                              disabled={isReadOnly}
                              onClick={() => handleDesvincularOficina(of)}
                              className="inline-flex items-center justify-center p-1 rounded bg-rose-500/15 text-rose-400 border border-rose-500/30 text-[10px] disabled:opacity-40"
                              title={`Desvincular ${of.nome}`}
                            >
                              <X size={11} />
                            </button>
                          </div>
                        </div>
                      ))}
                      <button
                        type="button"
                        disabled={isReadOnly}
                        onClick={() => {
                          setParceiroVinculoTarget(p);
                          setTenantIdVinculo('');
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-500/10 text-blue-400 border border-blue-500/30 text-xs font-semibold disabled:opacity-40"
                      >
                        <Plus size={12} />
                        <span>Atribuir Oficina</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-graphite-700">
                      <button
                        type="button"
                        disabled={isReadOnly}
                        onClick={() => handleAbrirEdicao(p)}
                        className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg disabled:opacity-40"
                      >
                        <Pencil size={13} />
                        <span>Editar</span>
                      </button>
                      <button
                        type="button"
                        disabled={isReadOnly}
                        onClick={() => handleAbrirExclusaoParceiro(p)}
                        className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold text-rose-300 bg-rose-500/15 hover:bg-rose-600/30 border border-rose-500/40 rounded-lg disabled:opacity-40"
                      >
                        <Trash2 size={13} />
                        <span>Excluir Parceiro</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>

      {/* Relatório de Comissões Apuradas */}
      <Card className="p-6 bg-graphite-800 border-graphite-600 space-y-4">
        <h2 className="font-display text-lg text-vapor-100 uppercase tracking-wide">
          Comissões Apuradas por Competência
        </h2>

        {comissoes.length === 0 ? (
          <div className="py-8 text-center text-vapor-400 text-sm">Nenhuma comissão apurada ainda.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-sans text-sm">
              <thead>
                <tr className="border-b border-graphite-700 text-vapor-400 text-xs font-semibold uppercase">
                  <th className="py-3 px-4">Competência</th>
                  <th className="py-3 px-4">Parceiro</th>
                  <th className="py-3 px-4">Oficina</th>
                  <th className="py-3 px-4">Valor Base</th>
                  <th className="py-3 px-4">Comissão</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Comprovante / Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-graphite-700/50">
                {comissoes.map((c) => (
                  <tr key={c.id} className="hover:bg-graphite-700/30 transition">
                    <td className="py-3 px-4 font-mono text-vapor-300">{c.competencia}</td>
                    <td className="py-3 px-4 font-medium text-vapor-100">
                      <div>{c.parceiro?.nome || '—'}</div>
                      <div className="text-xs text-vapor-400 font-mono">PIX: {c.parceiro?.pix_chave || '—'}</div>
                    </td>
                    <td className="py-3 px-4 text-vapor-200">{c.tenant?.nome || '—'}</td>
                    <td className="py-3 px-4 text-vapor-300">R$ {c.valor_base.toFixed(2)}</td>
                    <td className="py-3 px-4 font-bold text-emerald-400">R$ {c.valor_comissao.toFixed(2)}</td>
                    <td className="py-3 px-4">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                        c.status === 'paga'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      }`}>
                        {c.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {c.status !== 'paga' ? (
                        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer transition">
                          <Upload size={14} />
                          <span>Anexar Comprovante PIX</span>
                          <input
                            type="file"
                            accept="image/*,application/pdf"
                            onChange={(e) => {
                              if (e.target.files && e.target.files[0]) {
                                handleUploadComprovante(c.id, e.target.files[0]);
                              }
                            }}
                            className="hidden"
                          />
                        </label>
                      ) : (
                        <span className="text-xs text-emerald-400 font-semibold inline-flex items-center gap-1">
                          <CheckCircle2 size={14} /> PAGO
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Modal Cadastro de Novo Parceiro */}
      {modalNovoParceiro && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !salvandoParceiro) setModalNovoParceiro(false);
          }}
        >
          <div className="bg-graphite-800 border border-graphite-600 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-graphite-700 pb-3">
              <h3 className="font-display text-lg text-vapor-100 uppercase tracking-wide">
                Cadastrar Novo Parceiro Comercial
              </h3>
              <button
                type="button"
                onClick={() => setModalNovoParceiro(false)}
                disabled={salvandoParceiro}
                className="text-vapor-400 hover:text-vapor-100 p-1 rounded-lg hover:bg-graphite-700/60 transition disabled:opacity-50"
                aria-label="Fechar"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCriarParceiro} className="space-y-3 font-sans text-sm">
              <div className="p-3 bg-graphite-900/90 rounded-xl border border-blue-500/30 space-y-1.5">
                <label className="text-xs text-blue-400 font-semibold block">
                  Vincular a Usuário Cadastrado na Plataforma (Opcional)
                </label>
                <select
                  value={usuarioSelecionadoId}
                  onChange={(e) => handleSelecionarUsuarioParaParceiro(e.target.value)}
                  className="w-full bg-graphite-900 border border-graphite-700 rounded-lg p-2 text-vapor-100 text-xs focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">-- Cadastrar Parceiro Externo / Manual --</option>
                  {usuariosPlataforma.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nome} ({u.email}) {u.tenant_nome ? `- Oficina: ${u.tenant_nome}` : ''}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-vapor-400 block">
                  Selecionar um usuário preenche automaticamente os dados e associa sua conta.
                </span>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-vapor-400">Nome Completo / Empresa *</label>
                <Input
                  type="text"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  required
                  className="bg-graphite-900 border-graphite-700 text-vapor-100"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-vapor-400">E-mail *</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="bg-graphite-900 border-graphite-700 text-vapor-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-vapor-400">Telefone / WhatsApp</label>
                  <Input
                    type="tel"
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                    className="bg-graphite-900 border-graphite-700 text-vapor-100"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-vapor-400">Código Único / Cupom *</label>
                  <Input
                    type="text"
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                    placeholder="Ex: AUTO10"
                    required
                    className="bg-graphite-900 border-graphite-700 text-vapor-100 font-mono uppercase"
                  />
                </div>
              </div>

              {/* Comissão do Parceiro */}
              <div className="p-3 rounded-xl bg-graphite-900/60 border border-graphite-700/60 space-y-2">
                <span className="text-xs font-semibold text-amber-400 block">Comissão do Parceiro (Ganhos)</span>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] text-vapor-400">Tipo de Comissão</label>
                    <select
                      value={comissaoTipo}
                      onChange={(e) => setComissaoTipo(e.target.value as any)}
                      className="w-full bg-graphite-900 border border-graphite-700 rounded-lg p-2 text-vapor-100 text-xs"
                    >
                      <option value="percentual">Percentual (%)</option>
                      <option value="valor_fixo">Valor Fixo (R$)</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-vapor-400">Valor da Comissão</label>
                    <Input
                      type="number"
                      value={comissaoValor}
                      onChange={(e) => setComissaoValor(e.target.value)}
                      className="bg-graphite-900 border-graphite-700 text-vapor-100 text-xs py-1.5"
                    />
                  </div>
                </div>
              </div>

              {/* Desconto p/ Oficina (Cupom) */}
              <div className="p-3 rounded-xl bg-graphite-900/60 border border-graphite-700/60 space-y-2">
                <span className="text-xs font-semibold text-blue-400 block">Desconto Oferecido à Oficina (Cupom)</span>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] text-vapor-400">Tipo de Desconto</label>
                    <select
                      value={descontoTipo}
                      onChange={(e) => setDescontoTipo(e.target.value as any)}
                      className="w-full bg-graphite-900 border border-graphite-700 rounded-lg p-2 text-vapor-100 text-xs"
                    >
                      <option value="nenhum">Sem Desconto</option>
                      <option value="percentual">Percentual (% OFF)</option>
                      <option value="valor_fixo">Valor Fixo (R$ OFF)</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-vapor-400">Valor do Desconto</label>
                    <Input
                      type="number"
                      value={descontoValor}
                      disabled={descontoTipo === 'nenhum'}
                      onChange={(e) => setDescontoValor(e.target.value)}
                      className="bg-graphite-900 border-graphite-700 text-vapor-100 text-xs py-1.5 disabled:opacity-50"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-vapor-400">Chave PIX para Pagamento</label>
                <Input
                  type="text"
                  placeholder="E-mail, CPF, Telefone ou Aleatória"
                  value={pixChave}
                  onChange={(e) => setPixChave(e.target.value)}
                  className="bg-graphite-900 border-graphite-700 text-vapor-100 font-mono text-xs"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="recorrente_cb"
                  checked={recorrente}
                  onChange={(e) => setRecorrente(e.target.checked)}
                  className="w-4 h-4 accent-amber-500"
                />
                <label htmlFor="recorrente_cb" className="text-xs text-vapor-300 cursor-pointer">
                  Comissão Recorrente em todas as mensalidades pagas
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setModalNovoParceiro(false)}
                  disabled={salvandoParceiro}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={salvandoParceiro}
                >
                  {salvandoParceiro ? 'Salvando...' : 'Cadastrar Parceiro'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Vincular Oficina ao Parceiro */}
      {parceiroVinculoTarget && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !salvandoVinculo) setParceiroVinculoTarget(null);
          }}
        >
          <div className="bg-graphite-800 border border-graphite-600 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-graphite-700 pb-3">
              <h3 className="font-display text-lg text-vapor-100 uppercase tracking-wide flex items-center gap-2">
                <Plus className="text-blue-400" size={20} />
                Atribuir Oficina a Parceiro
              </h3>
              <button
                type="button"
                onClick={() => setParceiroVinculoTarget(null)}
                disabled={salvandoVinculo}
                className="text-vapor-400 hover:text-vapor-100 p-1 rounded-lg hover:bg-graphite-700/60 transition disabled:opacity-50"
                aria-label="Fechar"
              >
                <X size={20} />
              </button>
            </div>

            <p className="text-xs text-vapor-300 font-sans">
              Selecione uma oficina cadastrada na plataforma para atrelá-la ao parceiro{' '}
              <strong className="text-amber-400">{parceiroVinculoTarget.nome}</strong> (Cupom:{' '}
              <strong className="font-mono text-amber-400">{parceiroVinculoTarget.codigo}</strong>).
            </p>

            <form onSubmit={handleSalvarVinculoOficina} className="space-y-4 font-sans text-sm">
              <div className="space-y-1">
                <label className="text-xs text-vapor-400">Selecionar Oficina (Tenant) *</label>
                <select
                  value={tenantIdVinculo}
                  onChange={(e) => setTenantIdVinculo(e.target.value)}
                  required
                  className="w-full bg-graphite-900 border border-graphite-700 rounded-lg p-2.5 text-vapor-100 text-xs focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">-- Selecione uma Oficina ({oficinas.length}) --</option>
                  {oficinas.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nome} {o.cidade ? `(${o.cidade}/${o.uf || ''})` : ''}{' '}
                      {o.parceiro_nome ? `[Atualmente em: ${o.parceiro_nome}]` : '[Sem parceiro]'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setParceiroVinculoTarget(null)}
                  disabled={salvandoVinculo}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={salvandoVinculo || !tenantIdVinculo}
                  className="bg-blue-600 hover:bg-blue-500 border-none"
                >
                  {salvandoVinculo ? 'Salvando...' : 'Confirmar Vínculo'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Editar Parceiro Existente */}
      {parceiroEditando && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !salvandoEdicao) setParceiroEditando(null);
          }}
        >
          <div className="bg-graphite-800 border border-graphite-600 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-graphite-700 pb-3">
              <div className="flex items-center gap-2">
                <h3 className="font-display text-lg text-vapor-100 uppercase tracking-wide flex items-center gap-2">
                  <Pencil className="text-amber-400" size={18} />
                  Editar Parceiro Comercial
                </h3>
                <span className="text-xs font-mono text-amber-400 font-bold bg-amber-500/10 px-2 py-0.5 rounded">
                  {parceiroEditando.codigo}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setParceiroEditando(null)}
                disabled={salvandoEdicao}
                className="text-vapor-400 hover:text-vapor-100 p-1 rounded-lg hover:bg-graphite-700/60 transition disabled:opacity-50"
                aria-label="Fechar"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSalvarEdicaoParceiro} className="space-y-3 font-sans text-sm">
              <div className="p-3 bg-graphite-900/90 rounded-xl border border-blue-500/30 space-y-1.5">
                <label className="text-xs text-blue-400 font-semibold block">
                  Vínculo com Usuário da Plataforma (Login)
                </label>
                <select
                  value={editUsuarioId}
                  onChange={(e) => {
                    setEditUsuarioId(e.target.value);
                    if (e.target.value) {
                      const uObj = usuariosPlataforma.find((u) => u.id === e.target.value);
                      if (uObj) {
                        if (!editNome) setEditNome(uObj.nome);
                        if (!editEmail) setEditEmail(uObj.email);
                        if (uObj.telefone && !editTelefone) setEditTelefone(uObj.telefone);
                      }
                    }
                  }}
                  className="w-full bg-graphite-900 border border-graphite-700 rounded-lg p-2 text-vapor-100 text-xs focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">-- Vínculo Automático por E-mail --</option>
                  {usuariosPlataforma.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nome} ({u.email}) {u.tenant_nome ? `- Oficina: ${u.tenant_nome}` : ''}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-vapor-400 block">
                  {editUsuarioId 
                    ? '✅ Conta vinculada: este usuário acessa o Painel de Parceiros ao logar no sistema.'
                    : 'Deixando em automático, o sistema vinculará assim que o e-mail acima for logado ou cadastrado.'}
                </span>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-vapor-400">Nome Completo / Empresa *</label>
                <Input
                  type="text"
                  value={editNome}
                  onChange={(e) => setEditNome(e.target.value)}
                  required
                  className="bg-graphite-900 border-graphite-700 text-vapor-100"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-vapor-400">E-mail *</label>
                <Input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  required
                  className="bg-graphite-900 border-graphite-700 text-vapor-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-vapor-400">Telefone / WhatsApp</label>
                  <Input
                    type="tel"
                    value={editTelefone}
                    onChange={(e) => setEditTelefone(e.target.value)}
                    className="bg-graphite-900 border-graphite-700 text-vapor-100"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-vapor-400">Código Único / Cupom *</label>
                  <Input
                    type="text"
                    value={editCodigo}
                    onChange={(e) => setEditCodigo(e.target.value.toUpperCase())}
                    required
                    className="bg-graphite-900 border-graphite-700 text-vapor-100 font-mono uppercase"
                  />
                </div>
              </div>

              {/* Comissão do Parceiro */}
              <div className="p-3 rounded-xl bg-graphite-900/60 border border-graphite-700/60 space-y-2">
                <span className="text-xs font-semibold text-amber-400 block">Comissão do Parceiro (Ganhos)</span>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] text-vapor-400">Tipo de Comissão</label>
                    <select
                      value={editComissaoTipo}
                      onChange={(e) => setEditComissaoTipo(e.target.value as any)}
                      className="w-full bg-graphite-900 border border-graphite-700 rounded-lg p-2 text-vapor-100 text-xs"
                    >
                      <option value="percentual">Percentual (%)</option>
                      <option value="valor_fixo">Valor Fixo (R$)</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-vapor-400">Valor da Comissão</label>
                    <Input
                      type="number"
                      value={editComissaoValor}
                      onChange={(e) => setEditComissaoValor(e.target.value)}
                      className="bg-graphite-900 border-graphite-700 text-vapor-100 text-xs py-1.5"
                    />
                  </div>
                </div>
              </div>

              {/* Desconto p/ Oficina (Cupom) */}
              <div className="p-3 rounded-xl bg-graphite-900/60 border border-graphite-700/60 space-y-2">
                <span className="text-xs font-semibold text-blue-400 block">Desconto Oferecido à Oficina (Cupom)</span>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] text-vapor-400">Tipo de Desconto</label>
                    <select
                      value={editDescontoTipo}
                      onChange={(e) => setEditDescontoTipo(e.target.value as any)}
                      className="w-full bg-graphite-900 border border-graphite-700 rounded-lg p-2 text-vapor-100 text-xs"
                    >
                      <option value="nenhum">Sem Desconto</option>
                      <option value="percentual">Percentual (% OFF)</option>
                      <option value="valor_fixo">Valor Fixo (R$ OFF)</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-vapor-400">Valor do Desconto</label>
                    <Input
                      type="number"
                      value={editDescontoValor}
                      disabled={editDescontoTipo === 'nenhum'}
                      onChange={(e) => setEditDescontoValor(e.target.value)}
                      className="bg-graphite-900 border-graphite-700 text-vapor-100 text-xs py-1.5 disabled:opacity-50"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-vapor-400">Chave PIX para Pagamento</label>
                <Input
                  type="text"
                  placeholder="E-mail, CPF, Telefone ou Aleatória"
                  value={editPixChave}
                  onChange={(e) => setEditPixChave(e.target.value)}
                  className="bg-graphite-900 border-graphite-700 text-vapor-100 font-mono text-xs"
                />
              </div>

              <div className="flex flex-col gap-2 pt-1">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="edit_recorrente_cb"
                    checked={editRecorrente}
                    onChange={(e) => setEditRecorrente(e.target.checked)}
                    className="w-4 h-4 accent-amber-500"
                  />
                  <label htmlFor="edit_recorrente_cb" className="text-xs text-vapor-300 cursor-pointer">
                    Comissão Recorrente em todas as mensalidades pagas
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="edit_ativo_cb"
                    checked={editAtivo}
                    onChange={(e) => setEditAtivo(e.target.checked)}
                    className="w-4 h-4 accent-emerald-500"
                  />
                  <label htmlFor="edit_ativo_cb" className="text-xs text-vapor-300 cursor-pointer">
                    Parceiro Ativo (pode vincular oficinas e receber comissões)
                  </label>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-graphite-700/70">
                <button
                  type="button"
                  disabled={salvandoEdicao || isReadOnly}
                  onClick={() => {
                    const alvo = parceiroEditando;
                    setParceiroEditando(null);
                    if (alvo) handleAbrirExclusaoParceiro(alvo);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-rose-300 hover:text-white bg-rose-500/15 hover:bg-rose-600/30 border border-rose-500/40 transition disabled:opacity-40 cursor-pointer"
                >
                  <Trash2 size={13} />
                  <span>Excluir Parceiro</span>
                </button>

                <div className="flex items-center gap-2 ml-auto">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setParceiroEditando(null)}
                    disabled={salvandoEdicao}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={salvandoEdicao}
                  >
                    {salvandoEdicao ? 'Salvando...' : 'Salvar Alterações'}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Confirmar Exclusão de Parceiro */}
      {parceiroParaExcluir && createPortal(
        (() => {
          const impacto = calcularImpactoExclusaoParceiro(parceiroParaExcluir.id, oficinas, comissoes);
          return (
            <div
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-150"
              onClick={(e) => {
                if (e.target === e.currentTarget && !excluindoParceiro) {
                  setParceiroParaExcluir(null);
                }
              }}
            >
              <div className="bg-slate-900 border border-rose-500/40 rounded-2xl max-w-md w-full p-6 shadow-2xl shadow-rose-950/50 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400">
                      <Trash2 size={18} />
                    </div>
                    <div>
                      <h3 className="font-heading text-base font-bold text-white uppercase tracking-wide">
                        Excluir Parceiro Comercial
                      </h3>
                      <p className="text-[11px] text-slate-400">
                        Código: <span className="font-mono text-amber-400 font-bold">{parceiroParaExcluir.codigo}</span>
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={excluindoParceiro}
                    onClick={() => setParceiroParaExcluir(null)}
                    className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition disabled:opacity-50"
                    aria-label="Fechar"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-1 text-xs">
                  <div className="text-white font-semibold">{parceiroParaExcluir.nome}</div>
                  <div className="text-slate-400 font-mono">{parceiroParaExcluir.email}</div>
                </div>

                <div className="p-3.5 bg-rose-950/30 border border-rose-500/30 rounded-xl space-y-2 text-xs text-slate-200">
                  <div className="font-bold text-rose-300 flex items-center gap-1.5">
                    <AlertTriangle size={14} className="text-rose-400 shrink-0" />
                    <span>Resumo do impacto ao excluir este parceiro:</span>
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-300 pl-0.5">
                    <li>
                      <strong>{impacto.oficinasCount}</strong> oficina(s) vinculada(s) serão apenas desvinculadas
                      <span className="text-slate-400"> (os dados das oficinas NÃO são apagados).</span>
                    </li>
                    <li>
                      <strong>{impacto.comissoesCount}</strong> comissão(ões) registrada(s) (total R${' '}
                      {impacto.valorTotalComissoes.toFixed(2)}) serão removidas deste histórico.
                      {impacto.comissoesPagasCount > 0 && (
                        <span className="text-amber-300 font-semibold block pl-4 mt-0.5">
                          Atenção: {impacto.comissoesPagasCount} comissão(ões) já consta(m) como PAGA(S).
                        </span>
                      )}
                    </li>
                    <li>
                      A conta de login do usuário no Supabase (caso tenha) permanecerá intacta; se também quiser remover o login, acesse <strong>Contas (Auth)</strong>.
                    </li>
                  </ul>
                </div>

                <form onSubmit={handleConfirmarExclusaoParceiro} className="space-y-4">
                  <label className="flex items-start gap-2.5 p-3 bg-slate-950 border border-slate-800 rounded-xl cursor-pointer hover:border-slate-700 transition">
                    <input
                      type="checkbox"
                      checked={desativarCuponsAoExcluir}
                      onChange={(e) => setDesativarCuponsAoExcluir(e.target.checked)}
                      className="w-4 h-4 mt-0.5 rounded bg-slate-900 border-slate-700 text-rose-500 focus:ring-0 cursor-pointer"
                    />
                    <div className="text-xs">
                      <span className="font-semibold text-slate-200 block">
                        Desativar cupons vinculados a este parceiro
                      </span>
                      <span className="text-[11px] text-slate-400 block mt-0.5">
                        Desatrelará e desativará na Central de Cupons qualquer cupom ligado ao parceiro.
                      </span>
                    </div>
                  </label>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setParceiroParaExcluir(null)}
                      disabled={excluindoParceiro}
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="submit"
                      tone="rose"
                      disabled={excluindoParceiro}
                      className="flex items-center gap-1.5"
                    >
                      <Trash2 size={14} />
                      <span>{excluindoParceiro ? 'Excluindo...' : 'Confirmar Exclusão'}</span>
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          );
        })(),
        document.body
      )}
    </div>
  );
};

