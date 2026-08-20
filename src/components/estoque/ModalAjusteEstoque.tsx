import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { CampoNumerico } from '../ui/CampoNumerico';
import type { Produto } from '../../types/estoque';

interface ModalAjusteEstoqueProps {
  isOpen: boolean;
  onClose: () => void;
  produto: Produto | null;
  onConfirm: (data: {
    produto_id: string;
    novo_valor: number;
    motivo: string;
  }) => Promise<void>;
}

export const ModalAjusteEstoque: React.FC<ModalAjusteEstoqueProps> = ({
  isOpen,
  onClose,
  produto,
  onConfirm,
}) => {
  const [novoValorInput, setNovoValorInput] = useState<number | ''>('');
  const [motivo, setMotivo] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (produto) {
      setNovoValorInput(produto.estoque_atual);
      setMotivo('');
    }
  }, [produto, isOpen]);

  if (!produto) return null;

  const novoValor = typeof novoValorInput === 'number' ? novoValorInput : produto.estoque_atual;
  const diferenca = novoValor - produto.estoque_atual;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!motivo.trim()) {
      setErrorMsg('Informe o motivo do ajuste de estoque (ex: Inventário, quebra, vazamento).');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      await onConfirm({
        produto_id: produto.id,
        novo_valor: novoValor,
        motivo: motivo.trim(),
      });
      onClose();
    } catch (err: any) {
      console.error('[Ajuste Estoque Error]:', err);
      setErrorMsg(err?.message || 'Erro ao ajustar estoque.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Ajuste de Estoque (Inventário)">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
        <div className="p-3 bg-graphite-900 border border-graphite-700 rounded-md">
          <span className="text-[12px] text-vapor-400 block uppercase font-sans">Produto</span>
          <span className="text-[15px] font-bold text-vapor-100">{produto.nome}</span>
          {produto.marca && <span className="text-[13px] text-vapor-400 ml-2">({produto.marca})</span>}
          <div className="text-[12px] text-vapor-300 mt-1">
            Estoque Atual no Sistema: <strong className="font-mono text-emerald-400">{produto.estoque_atual} {produto.unidade_uso}</strong>
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 bg-flare-400/10 border border-flare-400/30 rounded text-flare-400 text-[13px]">
            {errorMsg}
          </div>
        )}

        <div>
          <label className="text-[13px] font-medium text-vapor-200 block mb-1">
            Novo Estoque Real Contado ({produto.unidade_uso}) *
          </label>
          <CampoNumerico
            placeholder="Ex: 4200"
            value={novoValorInput}
            onChange={(val) => setNovoValorInput(val ?? '')}
            suffix={produto.unidade_uso}
          />
        </div>

        {diferenca !== 0 && (
          <div className={`p-2.5 rounded text-[13px] font-mono ${diferenca > 0 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-flare-400/10 text-flare-400 border border-flare-400/20'}`}>
            Diferença: {diferenca > 0 ? `+${diferenca}` : diferenca} {produto.unidade_uso}
          </div>
        )}

        <div>
          <label className="text-[13px] font-medium text-vapor-200 block mb-1">Motivo do Ajuste *</label>
          <Input
            type="text"
            placeholder="Ex: Contagem de inventário mensal / Vazamento de frasco"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            required
          />
        </div>

        <div className="flex justify-end gap-2 mt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={loading}>
            {loading ? 'Ajustando...' : 'Salvar Ajuste'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
