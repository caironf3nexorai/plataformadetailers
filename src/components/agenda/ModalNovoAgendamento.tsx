import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { ServiceChip } from '../ui/ServiceChip';
import { 
  Search, 
  Plus, 
  Calendar as CalendarIcon, 
  ChevronRight, 
  ChevronLeft,
  AlertTriangle,
  CheckCircle2,
  CalendarX,
  Clock
} from 'lucide-react';
import type { HorarioDisponivel } from '../../types/agenda';
import { traduzirMotivoIndisponivel, formatarHoraCurta, formatarDuracao, calcularTermino } from '../../utils/agenda';
import { formatValorMoeda } from '../../utils/precos';
import { SeletorServicos } from '../servicos/SeletorServicos';
import { AvisoPernoite } from '../compartilhado/AvisoPernoite';
import { montarTimestampLocal, formatarDataIsoSP } from '../../utils/datas';

function obterMotivoPredominante(slots: HorarioDisponivel[]): string {
  const contagem: Record<string, number> = {};
  for (const slot of slots) {
    if (slot.motivo) {
      contagem[slot.motivo] = (contagem[slot.motivo] || 0) + 1;
    }
  }
  let topMotivo = 'Indisponível';
  let maxCount = 0;
  for (const [m, count] of Object.entries(contagem)) {
    if (count > maxCount) {
      maxCount = count;
      topMotivo = m;
    }
  }
  return topMotivo;
}

export interface ItemSelecionado {
  servico_id: string;
  combo_id?: string | null;
  servico: any;
  comboNome?: string;
}

interface ModalNovoAgendamentoProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialDate?: string; // ISO YYYY-MM-DD
}

export const ModalNovoAgendamento: React.FC<ModalNovoAgendamentoProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialDate
}) => {
  const { tenant, membership } = useAuth();
  const isGestor = membership?.role === 'dono' || membership?.role === 'gerente';
  const [step, setStep] = useState<number>(1);

  // Form State
  const [clienteSearch, setClienteSearch] = useState('');
  const [clientesList, setClientesList] = useState<any[]>([]);
  const [selectedCliente, setSelectedCliente] = useState<any | null>(null);

  // Novo cliente inline
  const [showNovoClienteForm, setShowNovoClienteForm] = useState(false);
  const [novoClienteNome, setNovoClienteNome] = useState('');
  const [novoClienteTelefone, setNovoClienteTelefone] = useState('');
  const [savingCliente, setSavingCliente] = useState(false);

  // Veículos do cliente selecionado
  const [veiculosList, setVeiculosList] = useState<any[]>([]);
  const [selectedVeiculo, setSelectedVeiculo] = useState<any | null>(null);
  const [categoriasList, setCategoriasList] = useState<any[]>([]);
  const [selectedCategoria, setSelectedCategoria] = useState<any | null>(null);

  // Serviços e Combos
  const [servicosList, setServicosList] = useState<any[]>([]);
  const [combosList, setCombosList] = useState<any[]>([]);
  const [selectedItens, setSelectedItens] = useState<ItemSelecionado[]>([]);

  // Data e Horário
  const todayStr = formatarDataIsoSP(new Date());
  const [selectedData, setSelectedData] = useState<string>(initialDate || todayStr);
  const [horariosSlots, setHorariosSlots] = useState<HorarioDisponivel[]>([]);
  const [loadingHorarios, setLoadingHorarios] = useState(false);
  const [selectedHorario, setSelectedHorario] = useState<string | null>(null);
  const [rpcError, setRpcError] = useState<string | null>(null);

  // Observações e envio
  const [observacoes, setObservacoes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reseta estado ao abrir o modal
  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setClienteSearch('');
      setSelectedCliente(null);
      setSelectedVeiculo(null);
      setSelectedCategoria(null);
      setSelectedItens([]);
      setSelectedHorario(null);
      setObservacoes('');
      setErrorMessage(null);
      setShowNovoClienteForm(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (initialDate) {
      setSelectedData(initialDate);
    }
  }, [initialDate]);

  // Carrega Clientes ao buscar
  useEffect(() => {
    if (!isOpen || !tenant) return;
    const currentTenantId = tenant.id;

    async function fetchClientes() {
      try {
        let q = supabase
          .from('clientes')
          .select('id, nome, telefone, veiculos(id, placa, modelo, marca, cor, categoria_id, categorias_veiculo(id, nome))')
          .eq('tenant_id', currentTenantId)
          .eq('ativo', true)
          .order('nome', { ascending: true })
          .limit(10);

        if (clienteSearch.trim()) {
          q = q.or(`nome.ilike.%${clienteSearch}%,telefone.ilike.%${clienteSearch}%`);
        }

        const { data, error } = await q;
        if (error) throw error;
        setClientesList(data || []);
      } catch (err) {
        console.error('[ModalNovoAgendamento] erro clientes:', err);
      }
    }

    const timer = setTimeout(fetchClientes, 300);
    return () => clearTimeout(timer);
  }, [isOpen, tenant, clienteSearch]);

  // Carrega Categorias, Serviços e Combos
  useEffect(() => {
    if (!isOpen || !tenant) return;
    const currentTenantId = tenant.id;

    async function fetchCatalog() {
      try {
        const { data: cats } = await supabase
          .from('categorias_veiculo')
          .select('id, nome')
          .eq('tenant_id', currentTenantId)
          .order('ordem');

        const { data: servs } = await supabase
          .from('servicos')
          .select('*, servico_precos(*)')
          .eq('tenant_id', currentTenantId)
          .eq('ativo', true)
          .order('grupo', { ascending: true })
          .order('ordem', { ascending: true });

        const { data: cb } = await supabase
          .from('combos')
          .select('*, combo_servicos(*, servicos(*, servico_precos(*))), combo_precos(*)')
          .eq('tenant_id', currentTenantId)
          .eq('ativo', true)
          .order('ordem');

        setCategoriasList(cats || []);
        setServicosList(servs || []);
        setCombosList(cb || []);
      } catch (err) {
        console.error('[ModalNovoAgendamento] erro catalogo:', err);
      }
    }
    fetchCatalog();
  }, [isOpen, tenant]);

  // Escolha do veículo ou categoria
  const handleSelectVeiculo = (v: any | null) => {
    setSelectedVeiculo(v);
    setSelectedItens([]);
    setSelectedHorario(null);
    if (v && v.categorias_veiculo) {
      setSelectedCategoria(v.categorias_veiculo);
    } else if (v && v.categoria_id) {
      const match = categoriasList.find((c) => c.id === v.categoria_id);
      if (match) setSelectedCategoria(match);
    }
  };

  const handleSelectCategoria = (cat: any) => {
    setSelectedCategoria(cat);
    setSelectedItens([]);
    setSelectedHorario(null);
  };

  // Toggle de serviço individual
  const handleToggleServico = (serv: any) => {
    setSelectedHorario(null);
    const exists = selectedItens.some((i) => i.servico_id === serv.id);
    if (exists) {
      setSelectedItens((prev) => prev.filter((i) => i.servico_id !== serv.id));
    } else {
      setSelectedItens((prev) => [...prev, { servico_id: serv.id, combo_id: null, servico: serv }]);
    }
  };

  // Toggle de combo completo
  const handleToggleCombo = (combo: any) => {
    setSelectedHorario(null);
    const comboServicoIds = (combo.combo_servicos || []).map((cs: any) => cs.servico_id);
    const allSelected = comboServicoIds.every((id: string) => selectedItens.some((i) => i.servico_id === id && i.combo_id === combo.id));

    if (allSelected) {
      // Remove todos os itens desse combo
      setSelectedItens((prev) => prev.filter((i) => i.combo_id !== combo.id));
    } else {
      // Adiciona todos os serviços do combo marcados com combo_id
      const novosItens = [...selectedItens.filter((i) => !comboServicoIds.includes(i.servico_id))];
      (combo.combo_servicos || []).forEach((cs: any) => {
        const serv = cs.servicos || servicosList.find((s) => s.id === cs.servico_id);
        if (serv) {
          novosItens.push({
            servico_id: serv.id,
            combo_id: combo.id,
            comboNome: combo.nome,
            servico: serv
          });
        }
      });
      setSelectedItens(novosItens);
    }
  };



  // Cálculos de Totais para os passos 5 e 6
  let duracaoTotalSum = 0;
  let precoTotalSum = 0;
  const combosContabilizados = new Set<string>();

  selectedItens.forEach((item) => {
    const matchPreco = item.servico?.servico_precos?.find((p: any) => p.categoria_id === selectedCategoria?.id);
    const dur = matchPreco?.duracao_minutos || item.servico?.duracao_minutos || 60;
    duracaoTotalSum += dur;

    if (item.combo_id) {
      if (!combosContabilizados.has(item.combo_id)) {
        combosContabilizados.add(item.combo_id);
        const comboObj = combosList.find((c) => c.id === item.combo_id);
        const comboPrecoObj = comboObj?.combo_precos?.find((cp: any) => cp.categoria_id === selectedCategoria?.id);
        if (comboPrecoObj && comboPrecoObj.preco_base !== null && comboPrecoObj.preco_base !== undefined) {
          precoTotalSum += Number(comboPrecoObj.preco_base);
        } else if (matchPreco && matchPreco.preco_base !== null && matchPreco.preco_base !== undefined) {
          precoTotalSum += Number(matchPreco.preco_base);
        }
      }
    } else {
      if (matchPreco && matchPreco.preco_base !== null && matchPreco.preco_base !== undefined) {
        precoTotalSum += Number(matchPreco.preco_base);
      }
    }
  });

  // Carrega horários livres no Passo 5
  useEffect(() => {
    if (step !== 5 || !tenant || selectedItens.length === 0 || !selectedCategoria || !selectedData) return;
    const currentTenantId = tenant.id;

    setSelectedHorario(null);
    setRpcError(null);

    async function fetchDisponibilidade() {
      setLoadingHorarios(true);
      setErrorMessage(null);
      try {
        const payloadItens = selectedItens.map((i) => ({
          servico_id: i.servico_id,
          combo_id: i.combo_id || null
        }));

        const { data, error } = await supabase.rpc('horarios_disponiveis', {
          p_tenant: currentTenantId,
          p_data: selectedData,
          p_itens: payloadItens,
          p_categoria: selectedCategoria.id
        });

        if (error) {
          console.error('[ModalNovoAgendamento] Erro na RPC horarios_disponiveis:', error);
          setRpcError(error.message || 'Erro no banco de dados ao consultar horários.');
          setHorariosSlots([]);
          return;
        }

        setHorariosSlots(data || []);
      } catch (err: any) {
        console.error('[ModalNovoAgendamento] Exceção disponibilidade:', err);
        setRpcError(err.message || 'Não foi possível carregar os horários.');
        setHorariosSlots([]);
      } finally {
        setLoadingHorarios(false);
      }
    }

    fetchDisponibilidade();
  }, [step, tenant, selectedData, selectedItens, selectedCategoria]);

  // Cria cliente rápido inline
  const handleCreateNovoCliente = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novoClienteNome.trim() || !tenant) return;
    setSavingCliente(true);
    try {
      const { data, error } = await supabase
        .from('clientes')
        .insert({
          tenant_id: tenant.id,
          nome: novoClienteNome.trim(),
          telefone: novoClienteTelefone.trim()
        })
        .select('id, nome, telefone, veiculos(id, placa, modelo, marca, cor, categoria_id, categorias_veiculo(id, nome))')
        .single();

      if (error) throw error;
      setSelectedCliente(data);
      setVeiculosList([]);
      setShowNovoClienteForm(false);
      setNovoClienteNome('');
      setNovoClienteTelefone('');
      setStep(2);
    } catch (err: any) {
      setErrorMessage('Erro ao criar cliente: ' + err.message);
    } finally {
      setSavingCliente(false);
    }
  };

  const [isForcado, setIsForcado] = useState(false);

  // Submeter Agendamento com múltiplos itens
  const handleSubmit = async () => {
    if (!tenant || !selectedCliente || selectedItens.length === 0 || !selectedCategoria || !selectedData || !selectedHorario) return;

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const startIso = montarTimestampLocal(selectedData, selectedHorario);
      const payloadItens = selectedItens.map((i) => ({
        servico_id: i.servico_id,
        combo_id: i.combo_id || null
      }));

      const { error } = await supabase.rpc('criar_agendamento', {
        p_cliente: selectedCliente.id,
        p_veiculo: selectedVeiculo?.id || null,
        p_itens: payloadItens,
        p_categoria: selectedCategoria.id,
        p_inicio: startIso,
        p_observacoes: observacoes.trim() || null,
        p_forcado: isForcado
      });

      if (error) throw error;

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('[ModalNovoAgendamento] erro criar:', err);
      setErrorMessage(err.message || 'Erro ao criar agendamento.');
    } finally {
      setSubmitting(false);
    }
  };

  // Grupos de serviços
  const gruposServicos: Record<string, any[]> = {};
  servicosList.forEach((s) => {
    const grp = s.grupo || 'Outros';
    if (!gruposServicos[grp]) gruposServicos[grp] = [];
    gruposServicos[grp].push(s);
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Novo Agendamento"
      subtitle={`Passo ${step} de 6 — ${
        step === 1 ? '1. Cliente' :
        step === 2 ? '2. Veículo & Categoria' :
        step === 3 ? '3. Serviços & Combos' :
        step === 4 ? '4. Data' :
        step === 5 ? '5. Horário Disponível' : '6. Confirmação'
      }`}
      icon={<CalendarIcon size={20} className="text-amber-500" />}
      maxWidth="xl"
    >
      <div className="flex flex-col gap-4">
        <div className="py-2 flex flex-col gap-4">
          
          {/* PASSO 1: CLIENTE */}
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="font-sans text-[13px] text-vapor-300 font-medium">
                  Selecione o cliente:
                </span>
                <button
                  onClick={() => setShowNovoClienteForm(!showNovoClienteForm)}
                  className="font-sans text-[12px] text-amber-400 hover:underline flex items-center gap-1 min-h-[44px]"
                >
                  <Plus size={14} />
                  <span>{showNovoClienteForm ? 'Voltar para busca' : 'Cadastrar novo'}</span>
                </button>
              </div>

              {showNovoClienteForm ? (
                <form onSubmit={handleCreateNovoCliente} className="flex flex-col gap-3 bg-graphite-800 p-4 rounded-lg border border-graphite-700">
                  <span className="font-display text-[12px] text-vapor-200 uppercase tracking-wider font-semibold">
                    Cadastro Rápido de Cliente
                  </span>
                  <input
                    type="text"
                    required
                    placeholder="Nome completo *"
                    value={novoClienteNome}
                    onChange={(e) => setNovoClienteNome(e.target.value)}
                    className="w-full bg-graphite-900 border border-graphite-700 rounded px-3 py-2 text-vapor-100 font-sans text-[13px] outline-none focus:border-amber-500 min-h-[44px]"
                  />
                  <input
                    type="text"
                    placeholder="Telefone (com DDD)"
                    value={novoClienteTelefone}
                    onChange={(e) => setNovoClienteTelefone(e.target.value)}
                    className="w-full bg-graphite-900 border border-graphite-700 rounded px-3 py-2 text-vapor-100 font-sans text-[13px] outline-none focus:border-amber-500 min-h-[44px]"
                  />
                  <Button type="submit" variant="primary" disabled={savingCliente} className="w-full justify-center">
                    {savingCliente ? 'Salvando...' : 'Cadastrar e Continuar'}
                  </Button>
                </form>
              ) : (
                <>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Buscar cliente por nome ou telefone..."
                      value={clienteSearch}
                      onChange={(e) => setClienteSearch(e.target.value)}
                      className="w-full bg-graphite-800 border border-graphite-700 rounded pl-9 pr-3 py-2.5 text-vapor-100 font-sans text-[13px] outline-none focus:border-amber-500 min-h-[48px]"
                    />
                    <Search size={16} className="absolute left-3 top-3.5 text-vapor-500" />
                  </div>

                  <div className="flex flex-col gap-2 max-h-60 overflow-y-auto">
                    {clientesList.length === 0 ? (
                      <span className="text-[12px] text-vapor-500 text-center py-4">
                        Nenhum cliente encontrado.
                      </span>
                    ) : (
                      clientesList.map((cli) => {
                        const isSelected = selectedCliente?.id === cli.id;
                        return (
                          <button
                            key={cli.id}
                            type="button"
                            onClick={() => {
                              setSelectedCliente(cli);
                              setVeiculosList(cli.veiculos || []);
                            }}
                            className={`p-3 rounded-lg border text-left flex items-center justify-between transition-colors min-h-[48px] ${
                              isSelected
                                ? 'bg-amber-500/10 border-amber-500 text-vapor-100'
                                : 'bg-graphite-800 hover:bg-graphite-700 border-graphite-700 text-vapor-300'
                            }`}
                          >
                            <div className="flex flex-col">
                              <span className="font-sans text-[13px] font-semibold text-vapor-100">
                                {cli.nome}
                              </span>
                              <span className="font-mono text-[11px] text-vapor-400">
                                {cli.telefone || 'Sem telefone'}
                              </span>
                            </div>
                            {isSelected && <CheckCircle2 size={18} className="text-amber-500" />}
                          </button>
                        );
                      })
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* PASSO 2: VEÍCULO & CATEGORIA */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              <span className="font-sans text-[13px] text-vapor-300 font-medium">
                Selecione o veículo do cliente <strong className="text-amber-400">{selectedCliente?.nome}</strong>:
              </span>

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => handleSelectVeiculo(null)}
                  className={`p-3 rounded-lg border text-left flex items-center justify-between transition-colors min-h-[48px] ${
                    selectedVeiculo === null
                      ? 'bg-amber-500/10 border-amber-500 text-vapor-100'
                      : 'bg-graphite-800 hover:bg-graphite-700 border-graphite-700 text-vapor-300'
                  }`}
                >
                  <div className="flex flex-col">
                    <span className="font-sans text-[13px] font-semibold text-vapor-100">
                      Sem veículo definido
                    </span>
                    <span className="font-sans text-[11px] text-vapor-400">
                      (Permite escolher a categoria manualmente)
                    </span>
                  </div>
                  {selectedVeiculo === null && <CheckCircle2 size={18} className="text-amber-500" />}
                </button>

                {veiculosList.map((v) => {
                  const isSelected = selectedVeiculo?.id === v.id;
                  const catNome = v.categorias_veiculo?.nome || 'Geral';
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => handleSelectVeiculo(v)}
                      className={`p-3 rounded-lg border text-left flex items-center justify-between transition-colors min-h-[48px] ${
                        isSelected
                          ? 'bg-amber-500/10 border-amber-500 text-vapor-100'
                          : 'bg-graphite-800 hover:bg-graphite-700 border-graphite-700 text-vapor-300'
                      }`}
                    >
                      <div className="flex flex-col">
                        <span className="font-mono text-[13px] font-bold text-vapor-100">
                          {v.placa} — {v.modelo} ({v.marca}{v.cor ? ` • Cor: ${v.cor}` : ''})
                        </span>
                        <span className="font-sans text-[11px] text-amber-400">
                          Categoria: {catNome}
                        </span>
                      </div>
                      {isSelected && <CheckCircle2 size={18} className="text-amber-500" />}
                    </button>
                  );
                })}
              </div>

              <div className="pt-3 border-t border-graphite-800 flex flex-col gap-2">
                <span className="font-sans text-[12px] text-vapor-400 font-medium">
                  Categoria do veículo para cálculo de valor *:
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {categoriasList.map((cat) => {
                    const isSelected = selectedCategoria?.id === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => handleSelectCategoria(cat)}
                        className={`p-2.5 rounded border font-sans text-[12px] font-medium transition-colors min-h-[44px] ${
                          isSelected
                            ? 'bg-amber-500 text-graphite-950 font-bold border-amber-400'
                            : 'bg-graphite-800 hover:bg-graphite-700 border-graphite-700 text-vapor-300'
                        }`}
                      >
                        {cat.nome}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* PASSO 3: SERVIÇOS & COMBOS (MÚLTIPLA ESCOLHA) */}
          {step === 3 && (
            <SeletorServicos
              categorias={categoriasList}
              selectedCategoria={selectedCategoria}
              onSelectCategoria={handleSelectCategoria}
              servicos={servicosList}
              combos={combosList}
              selectedItens={selectedItens}
              onToggleServico={handleToggleServico}
              onToggleCombo={handleToggleCombo}
              onCloseModal={onClose}
            />
          )}

          {/* PASSO 4: DATA */}
          {step === 4 && (
            <div className="flex flex-col gap-4">
              <span className="font-sans text-[13px] text-vapor-300 font-medium">
                Escolha a data do agendamento:
              </span>

              <div className="flex flex-col gap-2">
                <label className="font-mono text-[12px] text-vapor-400">Data *</label>
                <input
                  type="date"
                  min={todayStr}
                  value={selectedData}
                  onChange={(e) => {
                    setSelectedData(e.target.value);
                    setSelectedHorario(null);
                  }}
                  className="bg-graphite-800 border border-graphite-700 rounded px-3 py-2.5 font-mono text-[14px] text-vapor-100 outline-none focus:border-amber-500 min-h-[48px]"
                />
              </div>
            </div>
          )}

          {/* PASSO 5: HORÁRIO DISPONÍVEL */}
          {step === 5 && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="font-sans text-[13px] text-vapor-300 font-medium">
                  Horários livres em <strong className="font-mono text-amber-400">{selectedData}</strong>:
                </span>
                <span className="font-sans text-[11px] text-vapor-400 font-mono">
                  Duração estimada: {formatarDuracao(duracaoTotalSum)}
                </span>
              </div>

              {loadingHorarios ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2">
                  <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                  <span className="font-sans text-[12px] text-vapor-400">Consultando posições na grade...</span>
                </div>
              ) : rpcError ? (
                <div className="p-5 bg-flare-500/10 border border-flare-500/30 rounded-lg flex flex-col items-center justify-center text-center gap-2 py-6">
                  <AlertTriangle size={28} className="text-flare-400" />
                  <span className="font-sans text-[14px] font-semibold text-flare-400">
                    Não foi possível carregar os horários.
                  </span>
                  <span className="font-sans text-[12px] text-vapor-400">
                    Ocorreu um erro no banco de dados. Tente novamente mais tarde.
                  </span>
                </div>
              ) : horariosSlots.length === 0 ? (
                <div className="p-5 bg-graphite-800 rounded-lg border border-graphite-700 flex flex-col items-center justify-center text-center gap-2 py-6">
                  <CalendarX size={28} className="text-amber-500" />
                  <span className="font-sans text-[14px] font-semibold text-vapor-100">
                    A oficina não abre neste dia.
                  </span>
                  <span className="font-sans text-[12px] text-vapor-400">
                    Ajuste em <strong className="text-amber-400">Configurações &gt; Horários</strong>.
                  </span>
                </div>
              ) : horariosSlots.every((s) => !s.disponivel) ? (
                <div className="flex flex-col gap-3">
                  <div className="p-4 bg-graphite-800 rounded-lg border border-graphite-700 flex flex-col items-center justify-center text-center gap-2 py-4">
                    <Clock size={28} className="text-flare-400" />
                    <span className="font-sans text-[14px] font-semibold text-vapor-100">
                      Nenhum horário livre nesta data.
                    </span>
                    <span className="font-sans text-[12px] text-vapor-400">
                      Motivo: <strong className="text-flare-400">{traduzirMotivoIndisponivel(obterMotivoPredominante(horariosSlots))}</strong>
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-48 overflow-y-auto pr-1 opacity-60">
                    {horariosSlots.map((slot) => (
                      <div
                        key={slot.horario}
                        className="p-2.5 rounded border border-graphite-800 bg-graphite-950/60 flex flex-col justify-between cursor-not-allowed min-h-[56px]"
                      >
                        <span className="font-mono text-[13px] text-vapor-500 line-through">
                          {formatarHoraCurta(slot.horario)}
                        </span>
                        <span className="font-sans text-[10px] text-flare-400 truncate" title={traduzirMotivoIndisponivel(slot.motivo)}>
                          {traduzirMotivoIndisponivel(slot.motivo)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-64 overflow-y-auto pr-1">
                  {horariosSlots.map((slot) => {
                    const isSelected = selectedHorario === slot.horario;
                    const horaDisplay = formatarHoraCurta(slot.horario);

                    if (!slot.disponivel) {
                      return (
                        <div
                          key={slot.horario}
                          className="p-2.5 rounded border border-graphite-800 bg-graphite-950/60 flex flex-col justify-between min-h-[56px]"
                        >
                          <span className="font-mono text-[13px] text-vapor-500 line-through">
                            {horaDisplay}
                          </span>
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-sans text-[10px] text-flare-400 truncate" title={traduzirMotivoIndisponivel(slot.motivo)}>
                              {traduzirMotivoIndisponivel(slot.motivo)}
                            </span>
                            {isGestor && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedHorario(slot.horario);
                                  setIsForcado(true);
                                }}
                                className="text-[9px] font-sans text-amber-400 hover:underline font-bold uppercase shrink-0"
                              >
                                Forçar
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <button
                        key={slot.horario}
                        type="button"
                        onClick={() => setSelectedHorario(slot.horario)}
                        className={`p-3 rounded-lg border flex flex-col items-center justify-center transition-all min-h-[56px] ${
                          isSelected
                            ? 'bg-amber-500 border-amber-400 text-graphite-950 font-bold shadow-lg scale-[1.02]'
                            : 'bg-graphite-800 hover:bg-graphite-700 border-graphite-700 text-vapor-100'
                        }`}
                      >
                        <span className="font-mono text-[15px]">{horaDisplay}</span>
                        <span className="font-sans text-[10px] opacity-80 font-normal">Livre</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* PASSO 6: CONFIRMAÇÃO */}
          {step === 6 && (
            <div className="flex flex-col gap-4">
              <span className="font-display text-[13px] text-amber-400 font-bold uppercase tracking-wider">
                Resumo do Agendamento
              </span>

              <div className="bg-graphite-800 p-4 rounded-lg border border-graphite-700 flex flex-col gap-3 font-sans text-[13px]">
                <div className="flex justify-between border-b border-graphite-700/60 pb-2">
                  <span className="text-vapor-400">Cliente:</span>
                  <span className="font-semibold text-vapor-100">{selectedCliente?.nome}</span>
                </div>

                <div className="flex justify-between border-b border-graphite-700/60 pb-2">
                  <span className="text-vapor-400">Veículo / Categoria:</span>
                  <span className="font-mono text-vapor-100">
                    {selectedVeiculo ? `${selectedVeiculo.placa} (${selectedVeiculo.modelo})` : 'Sem veículo'} • {selectedCategoria?.nome}
                  </span>
                </div>

                <div className="flex flex-col gap-2 border-b border-graphite-700/60 pb-2">
                  <span className="text-vapor-400 font-medium">Serviços Incluídos ({selectedItens.length}):</span>
                  <div className="flex flex-col gap-1.5 pl-2">
                    {selectedItens.map((item) => {
                      const matchPreco = item.servico?.servico_precos?.find((p: any) => p.categoria_id === selectedCategoria?.id);
                      const dur = matchPreco?.duracao_minutos || item.servico?.duracao_minutos || 60;
                      let itemPriceStr = 'A definir';
                      if (item.servico?.sob_consulta) {
                        itemPriceStr = 'Sob consulta';
                      } else if (matchPreco && matchPreco.preco_base !== null && matchPreco.preco_base !== undefined) {
                        itemPriceStr = `R$ ${formatValorMoeda(Number(matchPreco.preco_base))}`;
                      }

                      return (
                        <div key={item.servico_id} className="flex items-center justify-between text-[12px]">
                          <div className="flex items-center gap-2">
                            <ServiceChip code={item.servico?.codigo || 'SV'} label={item.servico?.nome} tone={item.servico?.tom || 'vapor'} />
                            {item.comboNome && (
                              <span className="text-[10px] text-amber-400 font-mono">({item.comboNome})</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-vapor-400">{dur} min</span>
                            <span className="font-mono text-vapor-200">{itemPriceStr}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex justify-between border-b border-graphite-700/60 pb-2">
                  <span className="text-vapor-400">Data e Horário:</span>
                  <span className="font-mono text-vapor-100">
                    {selectedData} às {formatarHoraCurta(selectedHorario || '')}
                    {selectedHorario && (
                      <span className="text-amber-400 ml-1">
                        (Término previsto: {calcularTermino(`${selectedData}T${selectedHorario}:00`, duracaoTotalSum)})
                      </span>
                    )}
                  </span>
                </div>

                <div className="flex justify-between items-center pt-1 font-semibold">
                  <span className="text-vapor-300">Total Estimado ({formatarDuracao(duracaoTotalSum)}):</span>
                  <span className="font-mono text-[16px] text-amber-400 font-extrabold">
                    A partir de R$ {formatValorMoeda(precoTotalSum)}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-sans text-[12px] text-vapor-400">Observações internas (opcional)</label>
                <textarea
                  rows={2}
                  value={observacoes}
                  onChange={(e) => setObservacoes(e.target.value)}
                  placeholder="Ex: Cliente virá acompanhado, atenção especial às rodas..."
                  className="bg-graphite-800 border border-graphite-700 rounded p-2.5 text-vapor-100 font-sans text-[13px] outline-none focus:border-amber-500"
                />
              </div>

              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-2.5">
                <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
                <p className="font-sans text-[11px] text-amber-300 leading-relaxed">
                  O valor é uma estimativa. O preço final é definido na conferência presencial do veículo.
                </p>
              </div>

              {selectedHorario && (() => {
                const slotSelected = horariosSlots.find((s) => s.horario === selectedHorario);
                const startIso = montarTimestampLocal(selectedData, selectedHorario);
                return (
                  <AvisoPernoite
                    inicioISO={startIso}
                    terminoPrevistoISO={slotSelected?.termino_previsto}
                    mode="interno"
                  />
                );
              })()}

              {errorMessage && (
                <div className="p-3 bg-flare-500/10 border border-flare-500/30 rounded text-flare-400 font-sans text-[12px]">
                  {errorMessage}
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer do Modal */}
        <div className="pt-4 border-t border-graphite-800 flex items-center justify-between">
          {step > 1 ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setStep((prev) => prev - 1)}
              className="flex items-center gap-1"
            >
              <ChevronLeft size={16} />
              <span>Voltar</span>
            </Button>
          ) : (
            <div />
          )}

          {step < 6 ? (
            <Button
              type="button"
              variant="primary"
              disabled={
                (step === 1 && !selectedCliente) ||
                (step === 2 && !selectedCategoria) ||
                (step === 3 && selectedItens.length === 0) ||
                (step === 4 && !selectedData) ||
                (step === 5 && !selectedHorario)
              }
              onClick={() => setStep((prev) => prev + 1)}
              className="flex items-center gap-1 font-semibold"
            >
              <span>Próximo</span>
              <ChevronRight size={16} />
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              disabled={submitting}
              onClick={handleSubmit}
              className="flex items-center gap-1 font-bold bg-amber-500 text-graphite-950 hover:bg-amber-400"
            >
              <CheckCircle2 size={16} />
              <span>{submitting ? 'Confirmando...' : 'Confirmar Agendamento'}</span>
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};
