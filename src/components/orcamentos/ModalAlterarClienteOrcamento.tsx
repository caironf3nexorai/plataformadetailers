import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Search, UserCheck, Car, AlertTriangle, UserPlus, Pencil, Plus } from 'lucide-react';

interface ModalAlterarClienteOrcamentoProps {
  isOpen: boolean;
  onClose: () => void;
  orcamentoId: string;
  clienteAtualId?: string | null;
  veiculoAtualId?: string | null;
  categoriaAtualId?: string | null;
  dadosAvulsosInicial?: {
    nome?: string | null;
    telefone?: string | null;
    veiculoDescricao?: string | null;
  };
  modoInicial?: 'selecionar' | 'cadastrar' | 'editar';
  onSuccess: () => void;
}

type AbaModal = 'selecionar' | 'cadastrar' | 'editar';

function parseVeiculoDescricaoAvulsa(desc?: string | null): {
  modelo: string;
  cor: string;
  placa: string;
} {
  const parts = (desc || '')
    .split('•')
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length === 0) return { modelo: '', cor: '', placa: '' };
  if (parts.length === 1) return { modelo: parts[0], cor: '', placa: '' };
  if (parts.length === 2) {
    const looksLikePlaca = /^[A-Za-z]{3}-?[0-9][A-Za-z0-9][0-9]{2}$/.test(parts[1]);
    return looksLikePlaca
      ? { modelo: parts[0], cor: '', placa: parts[1].toUpperCase() }
      : { modelo: parts[0], cor: parts[1], placa: '' };
  }
  return {
    modelo: parts[0],
    cor: parts[1],
    placa: parts.slice(2).join(' ').toUpperCase(),
  };
}

export const ModalAlterarClienteOrcamento: React.FC<ModalAlterarClienteOrcamentoProps> = ({
  isOpen,
  onClose,
  orcamentoId,
  clienteAtualId,
  veiculoAtualId,
  categoriaAtualId,
  dadosAvulsosInicial,
  modoInicial,
  onSuccess,
}) => {
  const { tenant } = useAuth();
  const { showSuccess } = useToast();

  const [abaAtiva, setAbaAtiva] = useState<AbaModal>('selecionar');

  const [clientes, setClientes] = useState<any[]>([]);
  const [veiculos, setVeiculos] = useState<any[]>([]);
  const [categorias, setCategorias] = useState<any[]>([]);
  const [busca, setBusca] = useState('');

  const [selectedClienteId, setSelectedClienteId] = useState(clienteAtualId || '');
  const [selectedVeiculoId, setSelectedVeiculoId] = useState(veiculoAtualId || '');
  const [selectedCategoriaId, setSelectedCategoriaId] = useState(categoriaAtualId || '');

  // Campos para cadastro de novo cliente completo
  const [cadNome, setCadNome] = useState('');
  const [cadTelefone, setCadTelefone] = useState('');
  const [cadDocumento, setCadDocumento] = useState('');
  const [cadModelo, setCadModelo] = useState('');
  const [cadCor, setCadCor] = useState('');
  const [cadPlaca, setCadPlaca] = useState('');

  // Campos para edição do cliente atualmente vinculado
  const [editNome, setEditNome] = useState('');
  const [editTelefone, setEditTelefone] = useState('');
  const [editDocumento, setEditDocumento] = useState('');

  // Novo veículo inline para cliente existente / em edição
  const [showNovoVeiculoForm, setShowNovoVeiculoForm] = useState(false);
  const [nvModelo, setNvModelo] = useState('');
  const [nvCor, setNvCor] = useState('');
  const [nvPlaca, setNvPlaca] = useState('');

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !tenant) return;

    const initialTab: AbaModal =
      modoInicial && (modoInicial !== 'editar' || clienteAtualId)
        ? modoInicial
        : clienteAtualId
          ? 'selecionar'
          : 'cadastrar';

    setAbaAtiva(initialTab);
    setSelectedClienteId(clienteAtualId || '');
    setSelectedVeiculoId(veiculoAtualId || '');
    setSelectedCategoriaId(categoriaAtualId || '');
    setBusca('');
    setError(null);

    const parsedVeiculo = parseVeiculoDescricaoAvulsa(dadosAvulsosInicial?.veiculoDescricao);
    setCadNome(dadosAvulsosInicial?.nome || '');
    setCadTelefone(dadosAvulsosInicial?.telefone || '');
    setCadDocumento('');
    setCadModelo(parsedVeiculo.modelo);
    setCadCor(parsedVeiculo.cor);
    setCadPlaca(parsedVeiculo.placa);

    setShowNovoVeiculoForm(false);
    setNvModelo(parsedVeiculo.modelo);
    setNvCor(parsedVeiculo.cor);
    setNvPlaca(parsedVeiculo.placa);

    const carregarDadosIniciais = async () => {
      setLoading(true);
      try {
        const [resClientes, resCategorias] = await Promise.all([
          supabase
            .from('clientes')
            .select('id, nome, telefone, documento')
            .eq('tenant_id', tenant.id)
            .eq('ativo', true)
            .order('nome'),
          supabase
            .from('categorias_veiculo')
            .select('id, nome, ativo, ordem')
            .eq('tenant_id', tenant.id)
            .order('ordem'),
        ]);

        const listaClientes = resClientes.data || [];
        setClientes(listaClientes);

        const rawCats = resCategorias.data || [];
        const catsAtivas = rawCats.filter((c: any) => c.ativo !== false);
        const listaCats = catsAtivas.length > 0 ? catsAtivas : rawCats;
        setCategorias(listaCats);

        if (!categoriaAtualId && listaCats.length > 0) {
          setSelectedCategoriaId(listaCats[0].id);
        }

        if (clienteAtualId) {
          const clienteAtual = listaClientes.find((c: any) => c.id === clienteAtualId);
          if (clienteAtual) {
            setEditNome(clienteAtual.nome || '');
            setEditTelefone(clienteAtual.telefone || '');
            setEditDocumento(clienteAtual.documento || '');
          } else {
            const { data: cSingle } = await supabase
              .from('clientes')
              .select('id, nome, telefone, documento')
              .eq('id', clienteAtualId)
              .maybeSingle();
            if (cSingle) {
              setEditNome(cSingle.nome || '');
              setEditTelefone(cSingle.telefone || '');
              setEditDocumento(cSingle.documento || '');
            }
          }

          const { data: vData } = await supabase
            .from('veiculos')
            .select('id, placa, modelo, marca, cor, categoria_id')
            .eq('cliente_id', clienteAtualId)
            .eq('ativo', true)
            .order('placa');
          setVeiculos(vData || []);
        } else {
          setEditNome('');
          setEditTelefone('');
          setEditDocumento('');
          setVeiculos([]);
        }
      } catch (err: any) {
        console.error('[ModalAlterarClienteOrcamento] Erro ao carregar:', err);
      } finally {
        setLoading(false);
      }
    };

    carregarDadosIniciais();
  }, [
    isOpen,
    tenant,
    clienteAtualId,
    veiculoAtualId,
    categoriaAtualId,
    dadosAvulsosInicial?.nome,
    dadosAvulsosInicial?.telefone,
    dadosAvulsosInicial?.veiculoDescricao,
    modoInicial,
  ]);

  // Carrega veículos ao mudar o cliente selecionado
  const handleSelecionarCliente = async (cId: string) => {
    setSelectedClienteId(cId);
    setSelectedVeiculoId('');
    setShowNovoVeiculoForm(false);
    if (!cId) {
      setVeiculos([]);
      return;
    }

    try {
      const { data: vData } = await supabase
        .from('veiculos')
        .select('id, placa, modelo, marca, cor, categoria_id')
        .eq('cliente_id', cId)
        .eq('ativo', true)
        .order('placa');

      setVeiculos(vData || []);
      if (vData && vData.length > 0) {
        setSelectedVeiculoId(vData[0].id);
        if (vData[0].categoria_id) {
          setSelectedCategoriaId(vData[0].categoria_id);
        }
      }
    } catch (err) {
      console.error('[ModalAlterarClienteOrcamento] Erro ao buscar veículos:', err);
    }
  };

  const handleSelecionarVeiculo = (vId: string) => {
    setSelectedVeiculoId(vId);
    if (!vId) return;
    setShowNovoVeiculoForm(false);
    const vObj = veiculos.find((v) => v.id === vId);
    if (vObj?.categoria_id) {
      setSelectedCategoriaId(vObj.categoria_id);
    }
  };

  const clientesFiltrados = clientes.filter((c) => {
    if (!busca.trim()) return true;
    const q = busca.toLowerCase();
    return (c.nome || '').toLowerCase().includes(q) || (c.telefone || '').includes(q);
  });

  const criarVeiculoParaCliente = async (
    targetClienteId: string,
    categoriaId: string,
    modelo: string,
    cor: string,
    placaInput: string
  ): Promise<string> => {
    if (!tenant) throw new Error('Oficina não identificada.');
    const rawPlaca = placaInput.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const isGenerica = !rawPlaca || ['SEMPLACA', 'SEM', 'SP', 'NAOTEM', 'TESTE'].includes(rawPlaca);
    const cleanPlaca = isGenerica
      ? `PROV-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`
      : rawPlaca;

    if (!isGenerica) {
      const { data: existingV } = await supabase
        .from('veiculos')
        .select('id, cliente_id')
        .eq('tenant_id', tenant.id)
        .eq('placa', cleanPlaca)
        .maybeSingle();

      if (existingV?.id) {
        if (existingV.cliente_id && existingV.cliente_id !== targetClienteId) {
          throw new Error(`A placa ${cleanPlaca} já está cadastrada para outro cliente.`);
        }
        await supabase
          .from('veiculos')
          .update({
            cliente_id: targetClienteId,
            categoria_id: categoriaId,
            modelo: modelo.trim() || undefined,
            cor: cor.trim() || undefined,
            ativo: true,
          })
          .eq('id', existingV.id);
        return existingV.id;
      }
    }

    const { data: novoV, error: vErr } = await supabase
      .from('veiculos')
      .insert({
        tenant_id: tenant.id,
        cliente_id: targetClienteId,
        categoria_id: categoriaId,
        placa: cleanPlaca,
        modelo: modelo.trim() || 'Veículo',
        cor: cor.trim() || null,
      })
      .select('id')
      .single();

    if (vErr || !novoV) {
      throw new Error(vErr?.message || 'Erro ao cadastrar veículo.');
    }

    await supabase.from('veiculo_donos').insert({
      tenant_id: tenant.id,
      veiculo_id: novoV.id,
      cliente_id: targetClienteId,
    });

    return novoV.id;
  };

  const vincularNoOrcamento = async (
    cId: string,
    vId: string | null,
    catId: string
  ) => {
    const { error: rpcError } = await supabase.rpc('atualizar_cliente_orcamento', {
      p_orcamento_id: orcamentoId,
      p_cliente_id: cId,
      p_veiculo_id: vId,
      p_categoria_id: catId,
    });

    if (rpcError) {
      const { error: updError } = await supabase
        .from('orcamentos')
        .update({
          cliente_id: cId,
          veiculo_id: vId,
          categoria_id: catId,
          cliente_nome_avulso: null,
          cliente_telefone_avulso: null,
          veiculo_descricao_avulsa: vId ? null : undefined,
          updated_at: new Date().toISOString(),
        })
        .eq('id', orcamentoId);

      if (updError) throw updError;
    }
  };

  const handleSalvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant) return;

    const finalCatId = selectedCategoriaId || categorias[0]?.id || '';
    if (!finalCatId) {
      setError('Selecione a categoria de carroceria do veículo.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (abaAtiva === 'cadastrar') {
        if (!cadNome.trim()) {
          throw new Error('Informe o nome completo do cliente.');
        }
        const telDigits = cadTelefone.replace(/\D/g, '');
        if (telDigits.length < 8) {
          throw new Error('Informe um telefone / WhatsApp válido (mín. 8 dígitos).');
        }

        const temVeiculo = Boolean(cadModelo.trim() || cadPlaca.trim() || cadCor.trim());
        let cleanPlaca: string | null = null;
        if (temVeiculo) {
          const rawPlaca = cadPlaca.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
          const isGenerica = !rawPlaca || ['SEMPLACA', 'SEM', 'SP', 'NAOTEM', 'TESTE'].includes(rawPlaca);
          cleanPlaca = isGenerica
            ? `PROV-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`
            : rawPlaca;
        }

        const { data: cadData, error: cadErr } = await supabase.rpc('cadastro_rapido', {
          p_nome: cadNome.trim(),
          p_telefone: cadTelefone.trim(),
          p_placa: cleanPlaca,
          p_categoria: cleanPlaca ? finalCatId : null,
          p_marca: null,
          p_modelo: cleanPlaca ? (cadModelo.trim() || 'Veículo') : null,
          p_cor: cleanPlaca ? (cadCor.trim() || null) : null,
        });

        if (cadErr) throw cadErr;
        const res = Array.isArray(cadData) ? cadData[0] : cadData;
        const novoClienteId = res?.out_cliente_id || res?.cliente_id;
        const novoVeiculoId = res?.out_veiculo_id || res?.veiculo_id || null;

        if (!novoClienteId) {
          throw new Error('Não foi possível criar ou localizar o cliente.');
        }

        if (cadDocumento.trim()) {
          await supabase
            .from('clientes')
            .update({
              nome: cadNome.trim(),
              documento: cadDocumento.trim(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', novoClienteId);
        }

        if (novoVeiculoId) {
          await supabase
            .from('veiculos')
            .update({
              modelo: cadModelo.trim() || 'Veículo',
              cor: cadCor.trim() || null,
              categoria_id: finalCatId,
            })
            .eq('id', novoVeiculoId);
        }

        await vincularNoOrcamento(novoClienteId, novoVeiculoId, finalCatId);
        showSuccess('Cliente cadastrado e vinculado ao orçamento!');
      } else if (abaAtiva === 'editar') {
        if (!clienteAtualId) {
          throw new Error('Nenhum cliente vinculado para editar.');
        }
        if (!editNome.trim()) {
          throw new Error('O nome do cliente é obrigatório.');
        }
        if (editTelefone.replace(/\D/g, '').length < 8) {
          throw new Error('Informe um telefone / WhatsApp válido.');
        }

        const { error: updCliErr } = await supabase
          .from('clientes')
          .update({
            nome: editNome.trim(),
            telefone: editTelefone.trim(),
            documento: editDocumento.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', clienteAtualId);

        if (updCliErr) throw updCliErr;

        let finalVeiculoId = selectedVeiculoId || null;
        if (showNovoVeiculoForm && (nvModelo.trim() || nvPlaca.trim() || nvCor.trim())) {
          finalVeiculoId = await criarVeiculoParaCliente(
            clienteAtualId,
            finalCatId,
            nvModelo,
            nvCor,
            nvPlaca
          );
        }

        await vincularNoOrcamento(clienteAtualId, finalVeiculoId, finalCatId);
        showSuccess('Dados do cliente atualizados e vinculados ao orçamento!');
      } else {
        // Aba 'selecionar'
        if (!selectedClienteId) {
          throw new Error('Selecione um cliente para vincular ao orçamento.');
        }

        let finalVeiculoId = selectedVeiculoId || null;
        if (showNovoVeiculoForm && (nvModelo.trim() || nvPlaca.trim() || nvCor.trim())) {
          finalVeiculoId = await criarVeiculoParaCliente(
            selectedClienteId,
            finalCatId,
            nvModelo,
            nvCor,
            nvPlaca
          );
        }

        await vincularNoOrcamento(selectedClienteId, finalVeiculoId, finalCatId);
        showSuccess('Cliente e veículo do orçamento atualizados com sucesso!');
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('[ModalAlterarClienteOrcamento] Erro ao salvar:', err);
      const msg = err?.message || 'Erro ao salvar dados do cliente no orçamento.';
      setError(msg.replace(/^.*?LIMITE_PLANO_ATINGIDO:\s*/, ''));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={clienteAtualId ? 'Alterar ou Editar Cliente / Veículo' : 'Preencher / Vincular Cliente'}
      icon={<UserCheck size={20} className="text-cyan-400" />}
      maxWidth="md"
    >
      <form onSubmit={handleSalvar} className="flex flex-col gap-4">
        {error && (
          <div className="p-3 bg-flare-400/10 border border-flare-400/30 rounded-lg text-flare-400 text-[13px] flex items-center gap-2">
            <AlertTriangle size={16} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ABAS DE AÇÃO */}
        <div className={`grid gap-1.5 bg-graphite-900 p-1 rounded-lg border border-graphite-700 ${clienteAtualId ? 'grid-cols-3' : 'grid-cols-2'}`}>
          <button
            type="button"
            onClick={() => {
              setAbaAtiva('selecionar');
              setError(null);
            }}
            className={`py-2 px-2 text-xs font-bold rounded flex items-center justify-center gap-1.5 transition-colors ${
              abaAtiva === 'selecionar'
                ? 'bg-cyan-500 text-graphite-950 shadow'
                : 'text-vapor-400 hover:text-vapor-200'
            }`}
          >
            <Search size={13} />
            <span>Selecionar</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setAbaAtiva('cadastrar');
              setError(null);
            }}
            className={`py-2 px-2 text-xs font-bold rounded flex items-center justify-center gap-1.5 transition-colors ${
              abaAtiva === 'cadastrar'
                ? 'bg-cyan-500 text-graphite-950 shadow'
                : 'text-vapor-400 hover:text-vapor-200'
            }`}
          >
            <UserPlus size={13} />
            <span>Novo Cliente</span>
          </button>
          {clienteAtualId && (
            <button
              type="button"
              onClick={() => {
                setAbaAtiva('editar');
                setError(null);
              }}
              className={`py-2 px-2 text-xs font-bold rounded flex items-center justify-center gap-1.5 transition-colors ${
                abaAtiva === 'editar'
                  ? 'bg-cyan-500 text-graphite-950 shadow'
                  : 'text-vapor-400 hover:text-vapor-200'
              }`}
            >
              <Pencil size={13} />
              <span>Editar Atual</span>
            </button>
          )}
        </div>

        {abaAtiva === 'selecionar' && (
          <>
            {/* BUSCA DE CLIENTE */}
            <div className="flex flex-col gap-1.5">
              <label className="font-sans text-[13px] font-bold text-vapor-200">
                Selecionar Cliente Ativo *
              </label>
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-vapor-400" />
                <input
                  type="text"
                  placeholder="Buscar cliente por nome ou telefone..."
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  className="w-full bg-graphite-900 border border-graphite-700 rounded-lg pl-9 pr-3 py-2 text-vapor-100 text-[13px] outline-none focus:border-cyan-500"
                />
              </div>

              <select
                value={selectedClienteId}
                onChange={(e) => handleSelecionarCliente(e.target.value)}
                required
                className="w-full bg-graphite-900 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 text-[14px] outline-none focus:border-cyan-500"
              >
                <option value="">Selecione um cliente...</option>
                {clientesFiltrados.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome} {c.telefone ? `(${c.telefone})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* SELEÇÃO / CRIAÇÃO RÁPIDA DE VEÍCULO */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="font-sans text-[13px] font-bold text-vapor-200 flex items-center gap-1.5">
                  <Car size={15} className="text-vapor-400" />
                  <span>Veículo Associado</span>
                </label>
                {selectedClienteId && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowNovoVeiculoForm((prev) => !prev);
                      if (!showNovoVeiculoForm) setSelectedVeiculoId('');
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-cyan-400 hover:text-cyan-300"
                  >
                    <Plus size={12} />
                    {showNovoVeiculoForm ? 'Usar veículo existente' : 'Novo Veículo'}
                  </button>
                )}
              </div>

              {!showNovoVeiculoForm ? (
                <>
                  <select
                    value={selectedVeiculoId}
                    onChange={(e) => handleSelecionarVeiculo(e.target.value)}
                    className="w-full bg-graphite-900 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 text-[14px] outline-none focus:border-cyan-500"
                  >
                    <option value="">Nenhum veículo específico (apenas categoria)</option>
                    {veiculos.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.placa} — {v.modelo || 'Sem modelo'}{v.cor ? ` (${v.cor})` : ''}
                      </option>
                    ))}
                  </select>
                  {selectedClienteId && veiculos.length === 0 && (
                    <span className="text-[12px] text-vapor-400 italic">
                      Este cliente ainda não possui veículos. Clique em &quot;+ Novo Veículo&quot; acima se quiser cadastrar.
                    </span>
                  )}
                </>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-2.5 bg-graphite-900/70 border border-cyan-500/30 rounded-lg">
                  <input
                    type="text"
                    placeholder="Modelo (Ex: Civic)"
                    value={nvModelo}
                    onChange={(e) => setNvModelo(e.target.value)}
                    className="bg-graphite-800 border border-graphite-700 rounded px-2.5 py-1.5 text-xs text-vapor-100 outline-none focus:border-cyan-500"
                  />
                  <input
                    type="text"
                    placeholder="Cor (Opcional)"
                    value={nvCor}
                    onChange={(e) => setNvCor(e.target.value)}
                    className="bg-graphite-800 border border-graphite-700 rounded px-2.5 py-1.5 text-xs text-vapor-100 outline-none focus:border-cyan-500"
                  />
                  <input
                    type="text"
                    placeholder="Placa (Opcional)"
                    value={nvPlaca}
                    onChange={(e) => setNvPlaca(e.target.value)}
                    className="bg-graphite-800 border border-graphite-700 rounded px-2.5 py-1.5 text-xs text-vapor-100 font-mono uppercase outline-none focus:border-cyan-500"
                  />
                </div>
              )}
            </div>
          </>
        )}

        {abaAtiva === 'cadastrar' && (
          <div className="flex flex-col gap-3 p-3 bg-graphite-900/70 border border-graphite-700 rounded-lg">
            <span className="text-[11px] font-bold text-cyan-400 uppercase tracking-wider">
              Cadastro Completo do Cliente para Proposta / OS
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-vapor-300">Nome Completo *</label>
                <input
                  type="text"
                  placeholder="Ex: Carlos Mendes"
                  value={cadNome}
                  onChange={(e) => setCadNome(e.target.value)}
                  required
                  className="bg-graphite-800 border border-graphite-700 rounded px-2.5 py-1.5 text-xs text-vapor-100 outline-none focus:border-cyan-500"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-vapor-300">WhatsApp / Telefone *</label>
                <input
                  type="tel"
                  placeholder="(00) 00000-0000"
                  value={cadTelefone}
                  onChange={(e) => setCadTelefone(e.target.value)}
                  required
                  className="bg-graphite-800 border border-graphite-700 rounded px-2.5 py-1.5 text-xs text-vapor-100 outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-vapor-300">CPF / CNPJ (Opcional)</label>
              <input
                type="text"
                placeholder="Somente se desejar preencher agora"
                value={cadDocumento}
                onChange={(e) => setCadDocumento(e.target.value)}
                className="bg-graphite-800 border border-graphite-700 rounded px-2.5 py-1.5 text-xs text-vapor-100 outline-none focus:border-cyan-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1 border-t border-graphite-800">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-vapor-300">Modelo do Veículo</label>
                <input
                  type="text"
                  placeholder="Ex: Civic G10"
                  value={cadModelo}
                  onChange={(e) => setCadModelo(e.target.value)}
                  className="bg-graphite-800 border border-graphite-700 rounded px-2.5 py-1.5 text-xs text-vapor-100 outline-none focus:border-cyan-500"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-vapor-300">Cor</label>
                <input
                  type="text"
                  placeholder="Ex: Preto"
                  value={cadCor}
                  onChange={(e) => setCadCor(e.target.value)}
                  className="bg-graphite-800 border border-graphite-700 rounded px-2.5 py-1.5 text-xs text-vapor-100 outline-none focus:border-cyan-500"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-vapor-300">Placa (Opcional)</label>
                <input
                  type="text"
                  placeholder="Ex: BRA2E19"
                  value={cadPlaca}
                  onChange={(e) => setCadPlaca(e.target.value)}
                  className="bg-graphite-800 border border-graphite-700 rounded px-2.5 py-1.5 text-xs text-vapor-100 font-mono uppercase outline-none focus:border-cyan-500"
                />
              </div>
            </div>
          </div>
        )}

        {abaAtiva === 'editar' && (
          <div className="flex flex-col gap-3 p-3 bg-graphite-900/70 border border-graphite-700 rounded-lg">
            <span className="text-[11px] font-bold text-cyan-400 uppercase tracking-wider">
              Editar Dados do Cliente Vinculado
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-vapor-300">Nome Completo *</label>
                <input
                  type="text"
                  value={editNome}
                  onChange={(e) => setEditNome(e.target.value)}
                  required
                  className="bg-graphite-800 border border-graphite-700 rounded px-2.5 py-1.5 text-xs text-vapor-100 outline-none focus:border-cyan-500"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-vapor-300">WhatsApp / Telefone *</label>
                <input
                  type="tel"
                  value={editTelefone}
                  onChange={(e) => setEditTelefone(e.target.value)}
                  required
                  className="bg-graphite-800 border border-graphite-700 rounded px-2.5 py-1.5 text-xs text-vapor-100 outline-none focus:border-cyan-500"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-vapor-300">CPF / CNPJ (Opcional)</label>
              <input
                type="text"
                value={editDocumento}
                onChange={(e) => setEditDocumento(e.target.value)}
                className="bg-graphite-800 border border-graphite-700 rounded px-2.5 py-1.5 text-xs text-vapor-100 outline-none focus:border-cyan-500"
              />
            </div>

            <div className="flex flex-col gap-1.5 pt-1 border-t border-graphite-800">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-vapor-300">Veículo</label>
                <button
                  type="button"
                  onClick={() => {
                    setShowNovoVeiculoForm((prev) => !prev);
                    if (!showNovoVeiculoForm) setSelectedVeiculoId('');
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-cyan-400 hover:text-cyan-300"
                >
                  <Plus size={12} />
                  {showNovoVeiculoForm ? 'Usar veículo existente' : 'Novo Veículo'}
                </button>
              </div>
              {!showNovoVeiculoForm ? (
                <select
                  value={selectedVeiculoId}
                  onChange={(e) => handleSelecionarVeiculo(e.target.value)}
                  className="w-full bg-graphite-800 border border-graphite-700 rounded px-2.5 py-1.5 text-xs text-vapor-100 outline-none focus:border-cyan-500"
                >
                  <option value="">Nenhum veículo específico</option>
                  {veiculos.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.placa} — {v.modelo || 'Sem modelo'}{v.cor ? ` (${v.cor})` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    type="text"
                    placeholder="Modelo (Ex: Civic)"
                    value={nvModelo}
                    onChange={(e) => setNvModelo(e.target.value)}
                    className="bg-graphite-800 border border-graphite-700 rounded px-2 py-1.5 text-xs text-vapor-100 outline-none focus:border-cyan-500"
                  />
                  <input
                    type="text"
                    placeholder="Cor"
                    value={nvCor}
                    onChange={(e) => setNvCor(e.target.value)}
                    className="bg-graphite-800 border border-graphite-700 rounded px-2 py-1.5 text-xs text-vapor-100 outline-none focus:border-cyan-500"
                  />
                  <input
                    type="text"
                    placeholder="Placa (Opcional)"
                    value={nvPlaca}
                    onChange={(e) => setNvPlaca(e.target.value)}
                    className="bg-graphite-800 border border-graphite-700 rounded px-2 py-1.5 text-xs text-vapor-100 font-mono uppercase outline-none focus:border-cyan-500"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* CATEGORIA DE CARROCERIA */}
        <div className="flex flex-col gap-1.5">
          <label className="font-sans text-[13px] font-bold text-vapor-200">
            Categoria do Veículo (Precificação) *
          </label>
          <select
            value={selectedCategoriaId}
            onChange={(e) => setSelectedCategoriaId(e.target.value)}
            required
            className="w-full bg-graphite-900 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 text-[14px] outline-none focus:border-cyan-500"
          >
            <option value="">Selecione a categoria...</option>
            {categorias.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.nome}
              </option>
            ))}
          </select>
        </div>

        {/* BOTÕES DE AÇÃO */}
        <div className="flex justify-end gap-2.5 pt-2 border-t border-graphite-700">
          <Button
            type="button"
            tone="graphite"
            onClick={onClose}
            disabled={saving || loading}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            tone="cyan"
            loading={saving}
            disabled={loading}
          >
            {abaAtiva === 'cadastrar' ? 'Cadastrar e Vincular' : 'Salvar Alteração'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
