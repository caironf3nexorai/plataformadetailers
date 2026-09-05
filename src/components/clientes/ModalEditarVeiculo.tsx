import React, { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { CampoNumerico } from '../ui/CampoNumerico';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { formatPlaca } from '../../utils/formatters';
import type { CategoriaVeiculo } from '../../types/clientes';
import { Car, AlertTriangle, Palette, Save } from 'lucide-react';

export interface VeiculoEditavel {
  id: string;
  placa: string;
  modelo?: string | null;
  marca?: string | null;
  cor?: string | null;
  ano?: number | null;
  categoria_id?: string;
  observacoes?: string | null;
}

interface ModalEditarVeiculoProps {
  isOpen: boolean;
  onClose: () => void;
  veiculo: VeiculoEditavel | null;
  onSuccess?: (veiculoAtualizado: VeiculoEditavel) => void;
}

const SUGESTOES_CORES = [
  'Preto',
  'Branco',
  'Prata',
  'Cinza',
  'Vermelho',
  'Azul',
  'Verde',
  'Bordô',
];

export const ModalEditarVeiculo: React.FC<ModalEditarVeiculoProps> = ({
  isOpen,
  onClose,
  veiculo,
  onSuccess,
}) => {
  const { tenant } = useAuth();
  const { showSuccess, showError } = useToast();

  const [placa, setPlaca] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [marca, setMarca] = useState('');
  const [modelo, setModelo] = useState('');
  const [cor, setCor] = useState('');
  const [ano, setAno] = useState<string>('');
  const [observacoes, setObservacoes] = useState('');

  const [categorias, setCategorias] = useState<CategoriaVeiculo[]>([]);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Carrega lista de categorias do tenant
  useEffect(() => {
    if (!isOpen || !tenant) return;

    const fetchCategorias = async () => {
      try {
        const { data, error } = await supabase
          .from('categorias_veiculo')
          .select('*')
          .eq('tenant_id', tenant.id)
          .eq('ativo', true)
          .order('ordem', { ascending: true });

        if (!error && data) {
          // Desduplicação defensiva por nome normalizado
          const unicosMap = new Map<string, CategoriaVeiculo>();
          data.forEach((c) => {
            const key = c.nome.trim().toLowerCase();
            if (!unicosMap.has(key)) unicosMap.set(key, c);
          });
          setCategorias(Array.from(unicosMap.values()));
        }
      } catch (err) {
        console.error('[ModalEditarVeiculo] Erro ao buscar categorias:', err);
      }
    };

    fetchCategorias();
  }, [isOpen, tenant]);

  // Preenche dados do formulário ao abrir modal com veículo
  useEffect(() => {
    if (veiculo) {
      setPlaca(veiculo.placa || '');
      setCategoriaId(veiculo.categoria_id || '');
      setMarca(veiculo.marca || '');
      setModelo(veiculo.modelo || '');
      setCor(veiculo.cor || '');
      setAno(veiculo.ano ? String(veiculo.ano) : '');
      setObservacoes(veiculo.observacoes || '');
      setErrorMsg(null);
    }
  }, [veiculo, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!veiculo || !tenant) return;
    setErrorMsg(null);

    const cleanPlaca = placa.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (!cleanPlaca) {
      setErrorMsg('A placa do veículo é obrigatória.');
      return;
    }

    setSaving(true);
    try {
      const updatePayload: Record<string, any> = {
        placa: cleanPlaca,
        marca: marca.trim() || null,
        modelo: modelo.trim() || null,
        cor: cor.trim() || null,
        ano: ano ? parseInt(ano, 10) : null,
        observacoes: observacoes.trim() || null,
        updated_at: new Date().toISOString(),
      };

      if (categoriaId) {
        updatePayload.categoria_id = categoriaId;
      }

      // 1. Tenta atualizar direto na tabela veiculos
      const { data: updData, error: updErr } = await supabase
        .from('veiculos')
        .update(updatePayload)
        .eq('id', veiculo.id)
        .select('*')
        .maybeSingle();

      if (updErr) {
        // Fallback: se houver restrição RLS, tenta pela RPC atualizar_veiculo
        const { data: rpcData, error: rpcErr } = await supabase.rpc('atualizar_veiculo', {
          p_veiculo_id: veiculo.id,
          p_cor: cor.trim() || null,
          p_marca: marca.trim() || null,
          p_modelo: modelo.trim() || null,
          p_ano: ano ? parseInt(ano, 10) : null,
          p_placa: cleanPlaca,
          p_categoria_id: categoriaId || null,
          p_observacoes: observacoes.trim() || null,
        });

        if (rpcErr) throw updErr;
        const finalObj = (rpcData || { ...veiculo, ...updatePayload }) as VeiculoEditavel;
        showSuccess('Veículo atualizado com sucesso!');
        onSuccess?.(finalObj);
        onClose();
        return;
      }

      const finalObj = (updData || { ...veiculo, ...updatePayload }) as VeiculoEditavel;
      showSuccess('Veículo atualizado com sucesso!');
      onSuccess?.(finalObj);
      onClose();
    } catch (err: any) {
      console.error('[ModalEditarVeiculo] Erro ao atualizar veículo:', err);
      const msg = err.message || 'Não foi possível salvar os dados do veículo.';
      setErrorMsg(msg);
      showError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Editar Veículo: ${veiculo?.placa || ''}`}
      icon={<Car size={20} className="text-amber-500" />}
      maxWidth="lg"
    >
      {errorMsg && (
        <div className="mb-4 p-3 bg-flare-400/10 border border-flare-400/30 rounded text-flare-400 text-[13px] flex items-center gap-2">
          <AlertTriangle size={16} className="shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-vapor-300 font-medium">Placa *</label>
            <Input
              type="text"
              placeholder="ABC-1234 ou ABC1D23"
              value={placa}
              onChange={(e) => setPlaca(formatPlaca(e.target.value))}
              required
              className="min-h-[44px] font-mono text-[16px] uppercase tracking-wider text-amber-400 font-bold"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-vapor-300 font-medium">Categoria</label>
            <select
              value={categoriaId}
              onChange={(e) => setCategoriaId(e.target.value)}
              className="min-h-[44px] px-3 bg-graphite-900 border border-graphite-700 rounded-lg text-vapor-100 font-sans text-[14px] focus:border-amber-500 focus:outline-none"
            >
              <option value="">Selecione uma categoria...</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome} {c.descricao ? `(${c.descricao})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* CAMPO DE COR COM DESTAQUE E SUGESTÕES */}
        <div className="p-3 bg-graphite-900/90 rounded-lg border border-amber-500/30 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <label className="font-sans text-[13px] text-amber-400 font-bold flex items-center gap-1.5 uppercase tracking-wide">
              <Palette size={15} />
              Cor do Veículo
            </label>
            <span className="text-[11px] text-vapor-400">Aparecerá nos orçamentos e vistorias</span>
          </div>

          <Input
            type="text"
            placeholder="Ex: Preto Ninja, Prata Lunar, Branco Perolizado..."
            value={cor}
            onChange={(e) => setCor(e.target.value)}
            className="min-h-[44px] font-sans text-[15px] text-vapor-100"
          />

          {/* Atalhos rápidos de cores comuns */}
          <div className="flex items-center gap-1.5 flex-wrap pt-1">
            <span className="text-[11px] text-vapor-400 mr-1">Sugestões:</span>
            {SUGESTOES_CORES.map((sugestao) => (
              <button
                key={sugestao}
                type="button"
                onClick={() => setCor(sugestao)}
                className={`px-2 py-0.5 rounded text-[11px] font-sans transition-colors border ${
                  cor.trim().toLowerCase() === sugestao.toLowerCase()
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold'
                    : 'bg-graphite-800 text-vapor-400 hover:text-vapor-200 border-graphite-700 hover:border-graphite-600'
                }`}
              >
                {sugestao}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-vapor-300 font-medium">Marca</label>
            <Input
              type="text"
              placeholder="Ex: Honda, Toyota..."
              value={marca}
              onChange={(e) => setMarca(e.target.value)}
              className="min-h-[44px]"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-vapor-300 font-medium">Modelo</label>
            <Input
              type="text"
              placeholder="Ex: Civic, Corolla..."
              value={modelo}
              onChange={(e) => setModelo(e.target.value)}
              className="min-h-[44px]"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-vapor-300 font-medium">Ano</label>
            <CampoNumerico
              integerOnly
              placeholder="Ex: 2022"
              value={ano}
              onChange={(_, valStr) => setAno(valStr)}
              wrapperClassName="min-h-[44px]"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="font-sans text-[13px] text-vapor-300 font-medium">
            Observações Técnicas / Cuidados
          </label>
          <textarea
            rows={2}
            placeholder="Ex: Pintura original sem verniz, película térmica, pequenos riscos na porta..."
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
            className="p-3 bg-graphite-900 border border-graphite-700 rounded-lg text-vapor-100 font-sans text-[14px] outline-none focus:border-amber-500 transition-colors"
          />
        </div>

        <div className="flex justify-end gap-3 mt-2 pt-3 border-t border-graphite-800">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={saving}
            className="min-h-[44px] px-4"
          >
            Cancelar
          </Button>

          <Button
            type="submit"
            variant="primary"
            disabled={saving}
            className="min-h-[44px] px-6 font-semibold flex items-center gap-2"
          >
            <Save size={18} />
            {saving ? 'Salvando...' : 'Salvar Alterações'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
