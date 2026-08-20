import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { CampoNumerico } from '../ui/CampoNumerico';
import type { Produto, UnidadeCompraDisplay } from '../../types/estoque';

interface ModalEntradaEstoqueProps {
  isOpen: boolean;
  onClose: () => void;
  produto: Produto | null;
  onConfirm: (data: {
    produto_id: string;
    quantidade: number;
    preco_compra?: number;
    observacao?: string;
  }) => Promise<void>;
}

export const ModalEntradaEstoque: React.FC<ModalEntradaEstoqueProps> = ({
  isOpen,
  onClose,
  produto,
  onConfirm,
}) => {
  const [qtdInput, setQtdInput] = useState<number | ''>('');
  const [unidadeDisplay, setUnidadeDisplay] = useState<UnidadeCompraDisplay>('ml');
  const [novoPrecoInput, setNovoPrecoInput] = useState<number | ''>('');
  const [observacao, setObservacao] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (produto) {
      setQtdInput('');
      setNovoPrecoInput(produto.preco_compra);
      setObservacao('');

      if (produto.unidade_uso === 'ml') {
        setUnidadeDisplay('L');
      } else if (produto.unidade_uso === 'g') {
        setUnidadeDisplay('kg');
      } else {
        setUnidadeDisplay('un');
      }
    }
  }, [produto, isOpen]);

  if (!produto) return null;

  const getQtdBase = (): number => {
    const val = typeof qtdInput === 'number' ? qtdInput : 0;
    if (unidadeDisplay === 'L' || unidadeDisplay === 'kg') return val * 1000;
    return val;
  };

  const qtdBase = getQtdBase();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (qtdBase <= 0) {
      setErrorMsg('Informe uma quantidade de entrada maior que zero.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      await onConfirm({
        produto_id: produto.id,
        quantidade: qtdBase,
        preco_compra: typeof novoPrecoInput === 'number' && novoPrecoInput !== produto.preco_compra ? novoPrecoInput : undefined,
        observacao: observacao.trim() || undefined,
      });
      onClose();
    } catch (err: any) {
      console.error('[Entrada Estoque Error]:', err);
      setErrorMsg(err?.message || 'Erro ao registrar entrada.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Registrar Entrada de Estoque">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
        <div className="p-3 bg-graphite-900 border border-graphite-700 rounded-md">
          <span className="text-[12px] text-vapor-400 block uppercase font-sans">Produto</span>
          <span className="text-[15px] font-bold text-vapor-100">{produto.nome}</span>
          {produto.marca && <span className="text-[13px] text-vapor-400 ml-2">({produto.marca})</span>}
          <div className="text-[12px] text-vapor-300 mt-1">
            Estoque Atual: <strong className="font-mono text-emerald-400">{produto.estoque_atual} {produto.unidade_uso}</strong>
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 bg-flare-400/10 border border-flare-400/30 rounded text-flare-400 text-[13px]">
            {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-[13px] font-medium text-vapor-200 block min-h-[20px] flex items-end">Quantidade Entrando *</label>
            <CampoNumerico
              placeholder="Ex: 1 ou 500"
              value={qtdInput}
              onChange={(val) => setQtdInput(val ?? '')}
              wrapperClassName="min-h-[56px] h-[56px]"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[13px] font-medium text-vapor-200 block min-h-[20px] flex items-end">Unidade</label>
            <select
              value={unidadeDisplay}
              onChange={(e) => setUnidadeDisplay(e.target.value as UnidadeCompraDisplay)}
              className="w-full bg-graphite-700 border border-graphite-600 rounded-md px-4 text-[14px] text-vapor-100 font-mono appearance-none focus:border-amber-500 focus:outline-none min-h-[56px] h-[56px]"
            >
              {produto.unidade_uso === 'ml' && (
                <>
                  <option value="L">L</option>
                  <option value="ml">mL</option>
                </>
              )}
              {produto.unidade_uso === 'g' && (
                <>
                  <option value="kg">kg</option>
                  <option value="g">g</option>
                </>
              )}
              {produto.unidade_uso === 'un' && (
                <option value="un">un</option>
              )}
            </select>
          </div>
        </div>

        {qtdBase > 0 && (
          <div className="text-[12px] text-amber-400 font-mono">
            Será adicionado +{qtdBase} {produto.unidade_uso === 'ml' ? 'mL' : produto.unidade_uso} ao estoque (Novo total: {produto.estoque_atual + qtdBase} {produto.unidade_uso === 'ml' ? 'mL' : produto.unidade_uso}).
          </div>
        )}

        <div>
          <label className="text-[13px] font-medium text-vapor-200 block mb-1">
            Preço do Galão / Embalagem (opcional para atualização de custo)
          </label>
          <CampoNumerico
            prefix="R$"
            placeholder={produto.preco_compra.toFixed(2)}
            value={novoPrecoInput}
            onChange={(val) => setNovoPrecoInput(val ?? '')}
            wrapperClassName="min-h-[48px] h-[48px]"
          />
        </div>

        <div>
          <label className="text-[13px] font-medium text-vapor-200 block mb-1">Observação / Nota Fiscal</label>
          <Input
            type="text"
            placeholder="Ex: Compra Distribuidor X - NF 1234"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-2 mt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={loading}>
            {loading ? 'Gravando...' : 'Confirmar Entrada'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
