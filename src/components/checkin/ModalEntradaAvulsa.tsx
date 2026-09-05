import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { User, Car, Wrench, Plus, ChevronDown, Check, RotateCcw } from 'lucide-react';
import { SeletorServicos, type ItemSelecionado } from '../servicos/SeletorServicos';
import { AlertaErro } from '../ui/AlertaErro';

interface ModalEntradaAvulsaProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ModalEntradaAvulsa: React.FC<ModalEntradaAvulsaProps> = ({
  isOpen,
  onClose,
}) => {
  const navigate = useNavigate();
  const { tenant } = useAuth();

  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Listas
  const [clientes, setClientes] = useState<any[]>([]);
  const [veiculos, setVeiculos] = useState<any[]>([]);
  const [servicos, setServicos] = useState<any[]>([]);
  const [combos, setCombos] = useState<any[]>([]);
  const [categorias, setCategorias] = useState<any[]>([]);

  // Seleções
  const [selectedCliente, setSelectedCliente] = useState<string>('');
  const [selectedVeiculo, setSelectedVeiculo] = useState<string>('');
  const [selectedCategoriaObj, setSelectedCategoriaObj] = useState<any | null>(null);
  const [selectedItens, setSelectedItens] = useState<ItemSelecionado[]>([]);

  // Estados de Criação Rápida
  const [showNovoCliente, setShowNovoCliente] = useState(false);
  const [novoClienteNome, setNovoClienteNome] = useState('');
  const [novoClienteTelefone, setNovoClienteTelefone] = useState('');

  const [showNovoVeiculo, setShowNovoVeiculo] = useState(false);
  const [novoVeiculoModelo, setNovoVeiculoModelo] = useState('');
  const [novoVeiculoPlaca, setNovoVeiculoPlaca] = useState('');
  const [novoVeiculoCor, setNovoVeiculoCor] = useState('');
  const [novoClienteData, setNovoClienteData] = useState<{ nome: string; telefone: string | null } | null>(null);
  const [novoVeiculoData, setNovoVeiculoData] = useState<{ modelo: string; placa: string; cor: string | null; categoria_id: string | null } | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rascunhoRestaurado, setRascunhoRestaurado] = useState(false);

  const DRAFT_KEY = tenant ? `nuvemwash_draft_entrada_avulsa_${tenant.id}` : null;

  const limparDraft = () => {
    if (DRAFT_KEY) {
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch (e) {
        console.warn('Erro ao limpar rascunho:', e);
      }
    }
    setStep(1);
    setSelectedCliente('');
    setSelectedVeiculo('');
    setSelectedCategoriaObj(categorias.length > 0 ? categorias[0] : null);
    setSelectedItens([]);
    setNovoClienteData(null);
    setNovoVeiculoData(null);
    setShowNovoCliente(false);
    setShowNovoVeiculo(false);
    setNovoClienteNome('');
    setNovoClienteTelefone('');
    setNovoVeiculoModelo('');
    setNovoVeiculoPlaca('');
    setNovoVeiculoCor('');
    setRascunhoRestaurado(false);
    setError(null);
  };

  useEffect(() => {
    if (isOpen && tenant) {
      fetchInicial();

      // Tentar restaurar rascunho salvo do localStorage
      let restaurou = false;
      if (DRAFT_KEY) {
        try {
          const salvo = localStorage.getItem(DRAFT_KEY);
          if (salvo) {
            const parsed = JSON.parse(salvo);
            if (parsed && (parsed.selectedCliente || parsed.step > 1)) {
              setStep(parsed.step || 1);
              setSelectedCliente(parsed.selectedCliente || '');
              setSelectedVeiculo(parsed.selectedVeiculo || '');
              setSelectedCategoriaObj(parsed.selectedCategoriaObj || null);
              setSelectedItens(parsed.selectedItens || []);
              setRascunhoRestaurado(true);
              restaurou = true;
            }
          }
        } catch (e) {
          console.warn('Erro ao ler rascunho de entrada:', e);
        }
      }

      if (!restaurou) {
        setStep(1);
        setSelectedCliente('');
        setSelectedVeiculo('');
        setSelectedCategoriaObj(null);
        setSelectedItens([]);
        setRascunhoRestaurado(false);
      }

      setError(null);
      setShowNovoCliente(false);
      setShowNovoVeiculo(false);
    }
  }, [isOpen, tenant]);

  // Salvar rascunho automaticamente conforme usuário avança
  useEffect(() => {
    if (isOpen && tenant && DRAFT_KEY && (selectedCliente || selectedVeiculo || selectedItens.length > 0)) {
      try {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({
            step,
            selectedCliente,
            selectedVeiculo,
            selectedCategoriaObj,
            selectedItens,
          })
        );
      } catch (e) {
        console.warn('Erro ao salvar rascunho de entrada:', e);
      }
    }
  }, [step, selectedCliente, selectedVeiculo, selectedCategoriaObj, selectedItens, isOpen, tenant, DRAFT_KEY]);


  const fetchInicial = async () => {
    if (!tenant) return;
    try {
      setLoading(true);
      setError(null);

      // Buscar Clientes
      const { data: clData } = await supabase
        .from('clientes')
        .select('id, nome, telefone')
        .eq('tenant_id', tenant.id)
        .eq('ativo', true)
        .order('nome');
      setClientes(clData || []);

      // Buscar Serviços (sem filtro por publico ou preco_base, com servico_precos)
      const { data: srvData } = await supabase
        .from('servicos')
        .select('*, servico_precos(*)')
        .eq('tenant_id', tenant.id)
        .eq('ativo', true)
        .order('grupo', { ascending: true })
        .order('ordem', { ascending: true });
      setServicos(srvData || []);

      // Buscar Combos
      const { data: cbData } = await supabase
        .from('combos')
        .select('*, combo_servicos(*, servicos(*, servico_precos(*))), combo_precos(*)')
        .eq('tenant_id', tenant.id)
        .eq('ativo', true)
        .order('ordem');
      setCombos(cbData || []);

      // Buscar Categorias
      const { data: catData } = await supabase
        .from('categorias_veiculo')
        .select('id, nome')
        .eq('tenant_id', tenant.id)
        .order('ordem');
      setCategorias(catData || []);
      if (catData && catData.length > 0) {
        setSelectedCategoriaObj(catData[0]);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Buscar Veículos do Cliente Selecionado
  useEffect(() => {
    if (!selectedCliente || !tenant) {
      setVeiculos([]);
      setSelectedVeiculo('');
      return;
    }
    const fetchVeiculos = async () => {
      const { data } = await supabase
        .from('veiculos')
        .select('id, modelo, placa, marca, cor, categoria_id, categorias_veiculo(id, nome)')
        .eq('cliente_id', selectedCliente)
        .eq('tenant_id', tenant.id);

      setVeiculos(data || []);
      if (data && data.length > 0) {
        const v = data[0];
        setSelectedVeiculo(v.id);
        if (v.categorias_veiculo) {
          setSelectedCategoriaObj(v.categorias_veiculo);
        } else if (v.categoria_id) {
          const matchCat = categorias.find((c) => c.id === v.categoria_id);
          if (matchCat) setSelectedCategoriaObj(matchCat);
        }
      } else {
        setSelectedVeiculo('');
      }
    };
    fetchVeiculos();
  }, [selectedCliente, tenant, categorias]);

  // Escolha de Categoria
  const handleSelectCategoria = (cat: any) => {
    setSelectedCategoriaObj(cat);
    setSelectedItens([]);
  };

  // Toggle de Serviço com Preço Base da Categoria
  const handleToggleServico = (serv: any) => {
    const exists = selectedItens.some((i) => i.servico_id === serv.id);
    if (exists) {
      setSelectedItens((prev) => prev.filter((i) => i.servico_id !== serv.id));
    } else {
      const matchPreco = serv.servico_precos?.find(
        (p: any) => p.categoria_id === selectedCategoriaObj?.id
      );
      const precoBase = matchPreco?.preco_base !== undefined && matchPreco?.preco_base !== null
        ? Number(matchPreco.preco_base)
        : Number(serv.preco_base || 0);

      setSelectedItens((prev) => [
        ...prev,
        { servico_id: serv.id, combo_id: null, servico: serv, preco: precoBase },
      ]);
    }
  };

  // Atualizar Preço Customizado do Item
  const handleAtualizarPrecoItem = (servico_id: string, novoPrecoStr: string) => {
    const limpo = novoPrecoStr.replace(',', '.');
    const valorNum = parseFloat(limpo);
    setSelectedItens((prev) =>
      prev.map((it) => (it.servico_id === servico_id ? { ...it, preco: isNaN(valorNum) ? 0 : valorNum } : it))
    );
  };

  // Toggle de Combo
  const handleToggleCombo = (combo: any) => {
    const comboServicoIds = (combo.combo_servicos || []).map((cs: any) => cs.servico_id);
    const allSelected = comboServicoIds.every((id: string) =>
      selectedItens.some((i) => i.servico_id === id && i.combo_id === combo.id)
    );

    if (allSelected) {
      setSelectedItens((prev) => prev.filter((i) => i.combo_id !== combo.id));
    } else {
      const comboPrecoObj = combo.combo_precos?.find(
        (cp: any) => cp.categoria_id === selectedCategoriaObj?.id
      );
      const comboPreco = comboPrecoObj?.preco_base !== undefined && comboPrecoObj?.preco_base !== null
        ? Number(comboPrecoObj.preco_base)
        : Number(combo.preco_base || 0);

      const novosItens = [...selectedItens.filter((i) => !comboServicoIds.includes(i.servico_id))];
      (combo.combo_servicos || []).forEach((cs: any, idx: number) => {
        const serv = cs.servicos || servicos.find((s) => s.id === cs.servico_id);
        if (serv) {
          novosItens.push({
            servico_id: serv.id,
            combo_id: combo.id,
            comboNome: combo.nome,
            servico: serv,
            preco: idx === 0 ? comboPreco : 0, // Atribui o preço ao primeiro item do combo
          });
        }
      });
      setSelectedItens(novosItens);
    }
  };

  // Confirmar Cliente Rápido em memória (salva apenas no registro da entrada)
  const handleCriarCliente = () => {
    if (!novoClienteNome.trim()) return;
    const tempId = `temp_novo_cliente_${Date.now()}`;
    const novoObj = {
      id: tempId,
      nome: novoClienteNome.trim(),
      telefone: novoClienteTelefone.trim() || null,
      isTemp: true,
    };
    setNovoClienteData({
      nome: novoClienteNome.trim(),
      telefone: novoClienteTelefone.trim() || null,
    });
    setClientes((prev) => [novoObj, ...prev.filter((c) => !c.isTemp)]);
    setSelectedCliente(tempId);
    setShowNovoCliente(false);
    setNovoClienteNome('');
    setNovoClienteTelefone('');
    setVeiculos([]);
    setSelectedVeiculo('');
  };

  // Confirmar Veículo Rápido em memória (salva apenas no registro da entrada)
  const handleCriarVeiculo = () => {
    if (!novoVeiculoModelo.trim() || !novoVeiculoPlaca.trim()) return;
    const tempId = `temp_novo_veiculo_${Date.now()}`;
    const novoObj = {
      id: tempId,
      modelo: novoVeiculoModelo.trim(),
      placa: novoVeiculoPlaca.trim().toUpperCase(),
      cor: novoVeiculoCor.trim() || null,
      categoria_id: selectedCategoriaObj?.id || null,
      isTemp: true,
    };
    setNovoVeiculoData({
      modelo: novoVeiculoModelo.trim(),
      placa: novoVeiculoPlaca.trim().toUpperCase(),
      cor: novoVeiculoCor.trim() || null,
      categoria_id: selectedCategoriaObj?.id || null,
    });
    setVeiculos((prev) => [novoObj, ...prev.filter((v) => !v.isTemp)]);
    setSelectedVeiculo(tempId);
    setShowNovoVeiculo(false);
    setNovoVeiculoModelo('');
    setNovoVeiculoPlaca('');
    setNovoVeiculoCor('');
  };

  // Submeter Entrada Avulsa (com persistência atômica de cliente e veículo se forem novos)
  const handleSubmit = async () => {
    if (!selectedCliente || !selectedVeiculo || selectedItens.length === 0 || !selectedCategoriaObj) {
      setError('Por favor, preencha todos os campos obrigatórios e selecione ao menos um serviço.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      let clienteIdFinal = selectedCliente;
      let veiculoIdFinal = selectedVeiculo;

      // 1. Salva cliente no banco agora, se for novo
      if (novoClienteData && selectedCliente.startsWith('temp_novo_cliente')) {
        const { data: clCriado, error: errCl } = await supabase
          .from('clientes')
          .insert({
            tenant_id: tenant!.id,
            nome: novoClienteData.nome,
            telefone: novoClienteData.telefone || null,
          })
          .select('id')
          .single();

        if (errCl) throw new Error('Erro ao cadastrar cliente: ' + errCl.message);
        clienteIdFinal = clCriado.id;
      }

      // 2. Salva veículo no banco agora, se for novo
      if (novoVeiculoData && selectedVeiculo.startsWith('temp_novo_veiculo')) {
        const { data: vCriado, error: errV } = await supabase
          .from('veiculos')
          .insert({
            tenant_id: tenant!.id,
            cliente_id: clienteIdFinal,
            modelo: novoVeiculoData.modelo,
            placa: novoVeiculoData.placa,
            cor: novoVeiculoData.cor || null,
            categoria_id: selectedCategoriaObj?.id || null,
          })
          .select('id')
          .single();

        if (errV) throw new Error('Erro ao cadastrar veículo: ' + errV.message);
        veiculoIdFinal = vCriado.id;
      }

      const payloadItens = selectedItens.map((i) => ({
        servico_id: i.servico_id,
        combo_id: i.combo_id || null,
        preco: i.preco !== undefined ? Number(i.preco) : undefined,
      }));

      const { data: agendamentoId, error: rpcError } = await supabase.rpc('entrada_avulsa', {
        p_cliente: clienteIdFinal,
        p_veiculo: veiculoIdFinal,
        p_itens: payloadItens,
        p_categoria: selectedCategoriaObj.id,
      });

      if (rpcError) throw rpcError;

      limparDraft();
      onClose();
      // Redireciona imediatamente para a vistoria de entrada
      navigate(`/checkin/${agendamentoId}`);
    } catch (err: any) {
      console.error('[Entrada Avulsa Error]:', err);
      setError(err.message || 'Erro ao registrar entrada de veículo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Entrada de Veículo no Pátio (Balcão)">
      <div className="flex flex-col gap-4">
        {/* Barra Superior com Stepper e Botão Limpar e Recomeçar */}
        <div className="flex items-center justify-between pb-1">
          <span className="text-[11px] font-sans text-vapor-400 font-medium">
            Passo {step} de 3
          </span>
          {(selectedCliente || selectedVeiculo || selectedItens.length > 0 || step > 1) && (
            <button
              type="button"
              onClick={limparDraft}
              className="text-xs text-vapor-400 hover:text-amber-400 flex items-center gap-1.5 transition py-1 px-2 rounded hover:bg-graphite-800"
              title="Limpar todos os campos e recomeçar"
            >
              <RotateCcw size={13} />
              <span>Limpar e recomeçar</span>
            </button>
          )}
        </div>

        {/* Stepper Superior */}
        <div className="grid grid-cols-3 gap-2 pb-2 border-b border-graphite-700 font-display text-[12px] uppercase">
          <div className={`p-2 rounded text-center flex items-center justify-center gap-1.5 ${step === 1 ? 'bg-amber-500 text-graphite-950 font-bold' : 'bg-graphite-800 text-vapor-400'}`}>
            <User size={14} />
            <span>1. Cliente</span>
          </div>
          <div className={`p-2 rounded text-center flex items-center justify-center gap-1.5 ${step === 2 ? 'bg-amber-500 text-graphite-950 font-bold' : 'bg-graphite-800 text-vapor-400'}`}>
            <Car size={14} />
            <span>2. Veículo</span>
          </div>
          <div className={`p-2 rounded text-center flex items-center justify-center gap-1.5 ${step === 3 ? 'bg-amber-500 text-graphite-950 font-bold' : 'bg-graphite-800 text-vapor-400'}`}>
            <Wrench size={14} />
            <span>3. Serviços</span>
          </div>
        </div>

        {rascunhoRestaurado && (
          <div className="p-2.5 bg-blue-500/10 border border-blue-500/30 rounded-lg flex items-center justify-between text-xs text-blue-300">
            <span>Rascunho de entrada recuperado de onde você parou.</span>
            <button
              type="button"
              onClick={limparDraft}
              className="text-amber-400 hover:text-amber-300 font-bold underline"
            >
              Recomeçar
            </button>
          </div>
        )}

        {error && (
          <AlertaErro erro={error} />
        )}

        {/* PASSO 1: Selecionar ou Criar Cliente */}
        {step === 1 && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <label className="font-sans text-[13px] text-vapor-300 font-medium">Selecione o Cliente:</label>
              <button
                type="button"
                onClick={() => setShowNovoCliente(!showNovoCliente)}
                className="text-[12px] text-amber-400 hover:underline flex items-center gap-1 min-h-[40px]"
              >
                <Plus size={14} />
                <span>Novo Cliente</span>
              </button>
            </div>

            {showNovoCliente ? (
              <div className="p-3 bg-graphite-900 border border-graphite-700 rounded-lg flex flex-col gap-3">
                <input
                  type="text"
                  placeholder="Nome do cliente"
                  value={novoClienteNome}
                  onChange={(e) => setNovoClienteNome(e.target.value)}
                  className="bg-graphite-950 border border-graphite-700 rounded p-2.5 text-vapor-100 font-sans text-[14px]"
                />
                <input
                  type="text"
                  placeholder="Telefone (WhatsApp)"
                  value={novoClienteTelefone}
                  onChange={(e) => setNovoClienteTelefone(e.target.value)}
                  className="bg-graphite-950 border border-graphite-700 rounded p-2.5 text-vapor-100 font-sans text-[14px]"
                />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={() => setShowNovoCliente(false)}>Cancelar</Button>
                  <Button type="button" variant="primary" onClick={handleCriarCliente} disabled={!novoClienteNome.trim()}>Salvar Cliente</Button>
                </div>
              </div>
            ) : clientes.length <= 6 ? (
              <div className="flex flex-col gap-2 max-h-60 overflow-y-auto">
                {clientes.map((c) => {
                  const isSelected = selectedCliente === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedCliente(c.id)}
                      className={`p-3 rounded-lg border text-left flex items-center justify-between transition-colors min-h-[52px] ${
                        isSelected
                          ? 'bg-amber-500/10 border-amber-500 text-vapor-100 font-bold'
                          : 'bg-graphite-800 hover:bg-graphite-700 border-graphite-700 text-vapor-300'
                      }`}
                    >
                      <div className="flex flex-col">
                        <span className="font-sans text-[14px]">{c.nome}</span>
                        {c.telefone && <span className="font-sans text-[11px] text-vapor-400">{c.telefone}</span>}
                      </div>
                      {isSelected && <Check size={18} className="text-amber-400" />}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="relative">
                <select
                  value={selectedCliente}
                  onChange={(e) => setSelectedCliente(e.target.value)}
                  className="w-full appearance-none bg-graphite-700 text-vapor-100 border border-graphite-600 rounded-lg p-3 pr-10 font-sans text-[14px] outline-none focus:border-amber-500 min-h-[56px]"
                >
                  <option value="" className="bg-graphite-800 text-vapor-300">-- Selecione o cliente --</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id} className="bg-graphite-800 text-vapor-100">
                      {c.nome} {c.telefone ? `(${c.telefone})` : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-vapor-400 pointer-events-none" />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-graphite-700">
              <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
              <Button type="button" variant="primary" disabled={!selectedCliente} onClick={() => setStep(2)}>Avançar para Veículo</Button>
            </div>
          </div>
        )}

        {/* PASSO 2: Selecionar ou Criar Veículo */}
        {step === 2 && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <label className="font-sans text-[13px] text-vapor-300 font-medium">Selecione o Veículo:</label>
              <button
                type="button"
                onClick={() => setShowNovoVeiculo(!showNovoVeiculo)}
                className="text-[12px] text-amber-400 hover:underline flex items-center gap-1 min-h-[40px]"
              >
                <Plus size={14} />
                <span>Novo Veículo</span>
              </button>
            </div>

            {showNovoVeiculo ? (
              <div className="p-3 bg-graphite-900 border border-graphite-700 rounded-lg flex flex-col gap-3">
                <input
                  type="text"
                  placeholder="Modelo (ex: Azzera, Honda Civic)"
                  value={novoVeiculoModelo}
                  onChange={(e) => setNovoVeiculoModelo(e.target.value)}
                  className="bg-graphite-950 border border-graphite-700 rounded p-2.5 text-vapor-100 font-sans text-[14px]"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Placa (ex: NKT4469)"
                    value={novoVeiculoPlaca}
                    onChange={(e) => setNovoVeiculoPlaca(e.target.value)}
                    className="bg-graphite-950 border border-graphite-700 rounded p-2.5 text-vapor-100 font-sans text-[14px] uppercase"
                  />
                  <input
                    type="text"
                    placeholder="Cor (ex: Preto, Prata, Branco)"
                    value={novoVeiculoCor}
                    onChange={(e) => setNovoVeiculoCor(e.target.value)}
                    className="bg-graphite-950 border border-graphite-700 rounded p-2.5 text-vapor-100 font-sans text-[14px]"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={() => setShowNovoVeiculo(false)}>Cancelar</Button>
                  <Button type="button" variant="primary" onClick={handleCriarVeiculo} disabled={!novoVeiculoModelo.trim() || !novoVeiculoPlaca.trim()}>Salvar Veículo</Button>
                </div>
              </div>
            ) : veiculos.length === 0 ? (
              <div className="p-4 bg-graphite-900 rounded border border-graphite-700 text-center text-[13px] text-vapor-400">
                Nenhum veículo cadastrado para este cliente.{' '}
                <button type="button" onClick={() => setShowNovoVeiculo(true)} className="text-amber-400 underline font-semibold">Cadastrar agora</button>
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-60 overflow-y-auto">
                {veiculos.map((v) => {
                  const isSelected = selectedVeiculo === v.id;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => {
                        setSelectedVeiculo(v.id);
                        if (v.categorias_veiculo) {
                          setSelectedCategoriaObj(v.categorias_veiculo);
                        } else if (v.categoria_id) {
                          const matchCat = categorias.find((c) => c.id === v.categoria_id);
                          if (matchCat) setSelectedCategoriaObj(matchCat);
                        }
                      }}
                      className={`p-3.5 rounded-lg border text-left flex items-center justify-between transition-colors min-h-[52px] ${
                        isSelected
                          ? 'bg-amber-500/10 border-amber-500 text-vapor-100 font-bold'
                          : 'bg-graphite-800 hover:bg-graphite-700 border-graphite-700 text-vapor-300'
                      }`}
                    >
                      <div className="flex flex-col">
                        <span className="font-sans text-[14px] font-bold text-vapor-100">{v.modelo}</span>
                        <span className="font-mono text-[12px] text-amber-400 font-semibold">Placa: {v.placa}</span>
                      </div>
                      {isSelected && <Check size={18} className="text-amber-400" />}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex justify-between gap-2 pt-2 border-t border-graphite-700">
              <Button type="button" variant="secondary" onClick={() => setStep(1)}>Voltar</Button>
              <Button type="button" variant="primary" disabled={!selectedVeiculo} onClick={() => setStep(3)}>Avançar para Serviços</Button>
            </div>
          </div>
        )}

        {/* PASSO 3: Selecionar Serviços (SeletorServicos Compartilhado) */}
        {step === 3 && (
          <div className="flex flex-col gap-4">
            <SeletorServicos
              categorias={categorias}
              selectedCategoria={selectedCategoriaObj}
              onSelectCategoria={handleSelectCategoria}
              servicos={servicos}
              combos={combos}
              selectedItens={selectedItens}
              onToggleServico={handleToggleServico}
              onToggleCombo={handleToggleCombo}
              onCloseModal={onClose}
            />

            {/* Lista de Valores Editáveis para Serviços Selecionados */}
            {selectedItens.length > 0 && (
              <div className="p-3 bg-graphite-900 border border-graphite-700 rounded-lg flex flex-col gap-2.5">
                <div className="flex items-center justify-between border-b border-graphite-800 pb-2">
                  <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                    Valores dos Serviços na Entrada (Editável)
                  </span>
                  <span className="text-[11px] text-vapor-400">
                    Ajuste o valor real combinado
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {selectedItens.map((it) => (
                    <div
                      key={it.servico_id}
                      className="flex items-center justify-between gap-3 p-2.5 bg-graphite-800 rounded border border-graphite-700"
                    >
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="text-xs font-bold text-vapor-100 truncate">
                          {it.servico?.nome || 'Serviço'}
                        </span>
                        {it.comboNome && (
                          <span className="text-[10px] text-amber-400 font-mono">
                            Combo: {it.comboNome}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 w-32 shrink-0">
                        <span className="text-xs font-mono text-vapor-400">R$</span>
                        <input
                          type="number"
                          step="0.01"
                          value={it.preco !== undefined ? it.preco : ''}
                          onChange={(e) => handleAtualizarPrecoItem(it.servico_id, e.target.value)}
                          className="w-full bg-graphite-950 border border-graphite-700 rounded px-2 py-1 text-right font-mono text-xs text-vapor-100 font-bold outline-none focus:border-amber-500"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-400 text-[12px]">
              Ao registrar a entrada, o atendimento será criado com status <strong>'confirmado'</strong> e você será direcionado imediatamente para a vistoria de entrada.
            </div>

            <div className="flex justify-between gap-2 pt-2 border-t border-graphite-700">
              <Button type="button" variant="secondary" onClick={() => setStep(2)}>Voltar</Button>
              <Button
                type="button"
                variant="primary"
                disabled={selectedItens.length === 0 || !selectedCategoriaObj || loading}
                onClick={handleSubmit}
                className="min-h-[50px] font-semibold"
              >
                {loading ? 'Registrando Entrada...' : 'Confirmar Entrada & Ir para Vistoria'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
