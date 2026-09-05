import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Search, UserCheck, Car, AlertTriangle } from 'lucide-react';

interface ModalAlterarClienteOrcamentoProps {
  isOpen: boolean;
  onClose: () => void;
  orcamentoId: string;
  clienteAtualId: string;
  veiculoAtualId?: string | null;
  categoriaAtualId: string;
  onSuccess: () => void;
}

export const ModalAlterarClienteOrcamento: React.FC<ModalAlterarClienteOrcamentoProps> = ({
  isOpen,
  onClose,
  orcamentoId,
  clienteAtualId,
  veiculoAtualId,
  categoriaAtualId,
  onSuccess,
}) => {
  const { tenant } = useAuth();
  const { showSuccess, showError } = useToast();

  const [clientes, setClientes] = useState<any[]>([]);
  const [veiculos, setVeiculos] = useState<any[]>([]);
  const [categorias, setCategorias] = useState<any[]>([]);
  const [busca, setBusca] = useState('');

  const [selectedClienteId, setSelectedClienteId] = useState(clienteAtualId);
  const [selectedVeiculoId, setSelectedVeiculoId] = useState(veiculoAtualId || '');
  const [selectedCategoriaId, setSelectedCategoriaId] = useState(categoriaAtualId);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !tenant) return;

    setSelectedClienteId(clienteAtualId);
    setSelectedVeiculoId(veiculoAtualId || '');
    setSelectedCategoriaId(categoriaAtualId);
    setBusca('');
    setError(null);

    const carregarDadosIniciais = async () => {
      setLoading(true);
      try {
        const [resClientes, resCategorias] = await Promise.all([
          supabase
            .from('clientes')
            .select('id, nome, telefone')
            .eq('tenant_id', tenant.id)
            .eq('ativo', true)
            .order('nome'),
          supabase
            .from('categorias_veiculo')
            .select('id, nome')
            .eq('tenant_id', tenant.id)
            .order('ordem'),
        ]);

        setClientes(resClientes.data || []);
        setCategorias(resCategorias.data || []);

        // Se já tem cliente atual, carrega os veículos dele
        if (clienteAtualId) {
          const { data: vData } = await supabase
            .from('veiculos')
            .select('id, placa, modelo, marca, cor, categoria_id')
            .eq('cliente_id', clienteAtualId)
            .eq('ativo', true)
            .order('placa');
          setVeiculos(vData || []);
        }
      } catch (err: any) {
        console.error('[ModalAlterarClienteOrcamento] Erro ao carregar:', err);
      } finally {
        setLoading(false);
      }
    };

    carregarDadosIniciais();
  }, [isOpen, tenant, clienteAtualId, veiculoAtualId, categoriaAtualId]);

  // Carrega veículos ao mudar o cliente selecionado
  const handleSelecionarCliente = async (cId: string) => {
    setSelectedClienteId(cId);
    setSelectedVeiculoId('');
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

  const handleSalvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClienteId) {
      setError('Selecione um cliente para vincular ao orçamento.');
      return;
    }
    if (!selectedCategoriaId) {
      setError('Selecione a categoria de carroceria do veículo.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // 1. Tenta RPC atualizar_cliente_orcamento
      const { error: rpcError } = await supabase.rpc('atualizar_cliente_orcamento', {
        p_orcamento_id: orcamentoId,
        p_cliente_id: selectedClienteId,
        p_veiculo_id: selectedVeiculoId || null,
        p_categoria_id: selectedCategoriaId,
      });

      if (rpcError) {
        // Fallback update direto
        const { error: updError } = await supabase
          .from('orcamentos')
          .update({
            cliente_id: selectedClienteId,
            veiculo_id: selectedVeiculoId || null,
            categoria_id: selectedCategoriaId,
            updated_at: new Date().toISOString(),
          })
          .eq('id', orcamentoId);

        if (updError) throw updError;
      }

      showSuccess('Cliente e veículo do orçamento alterados com sucesso!');
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('[ModalAlterarClienteOrcamento] Erro ao salvar:', err);
      setError(err.message || 'Erro ao alterar cliente do orçamento.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Alterar Cliente / Veículo do Orçamento"
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

        {/* SELEÇÃO DO VEÍCULO */}
        <div className="flex flex-col gap-1.5">
          <label className="font-sans text-[13px] font-bold text-vapor-200 flex items-center gap-1.5">
            <Car size={15} className="text-vapor-400" />
            <span>Veículo Associado</span>
          </label>
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
              Este cliente ainda não possui veículos cadastrados.
            </span>
          )}
        </div>

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
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            tone="cyan"
            loading={saving}
          >
            Salvar Alteração
          </Button>
        </div>
      </form>
    </Modal>
  );
};
