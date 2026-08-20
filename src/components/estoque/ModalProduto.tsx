import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { CampoNumerico } from '../ui/CampoNumerico';
import type { Produto, CategoriaProduto, UnidadeUso, UnidadeCompraDisplay } from '../../types/estoque';
import { formatarCustoUnitario } from '../../utils/formatters';

interface ModalProdutoProps {
  isOpen: boolean;
  onClose: () => void;
  produto?: Produto | null;
  onSave: (data: {
    nome: string;
    marca?: string;
    categoria: string;
    unidade_uso: UnidadeUso;
    tamanho_compra: number;
    preco_compra: number;
    estoque_minimo: number;
    estoque_atual?: number;
  }) => Promise<void>;
}

const CATEGORIAS: CategoriaProduto[] = [
  'Lavagem',
  'Polimento',
  'Proteção',
  'Interior',
  'Vidros',
  'Insumos',
  'Geral',
];

export const ModalProduto: React.FC<ModalProdutoProps> = ({
  isOpen,
  onClose,
  produto,
  onSave,
}) => {
  const [nome, setNome] = useState('');
  const [marca, setMarca] = useState('');
  const [categoria, setCategoria] = useState<string>('Geral');
  
  // Bloco de Compra
  const [qtdCompraInput, setQtdCompraInput] = useState<number | ''>(5);
  const [unidadeDisplay, setUnidadeDisplay] = useState<UnidadeCompraDisplay>('L');
  const [precoCompraInput, setPrecoCompraInput] = useState<number | ''>(120);
  
  // Estoque Mínimo e Inicial
  const [estoqueMinimoInput, setEstoqueMinimoInput] = useState<number | ''>(500);
  const [estoqueAtualInput, setEstoqueAtualInput] = useState<number | ''>(5000);
  const [userEditedEstoqueInicial, setUserEditedEstoqueInicial] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Converter tamanho_compra para unidade_uso base (mL, g, un)
  const getTamanhoBase = (qtyVal: number | '', unitVal: UnidadeCompraDisplay): { tamanhoBase: number; unidadeBase: UnidadeUso } => {
    const qty = typeof qtyVal === 'number' ? qtyVal : 0;
    if (unitVal === 'L') return { tamanhoBase: qty * 1000, unidadeBase: 'ml' };
    if (unitVal === 'kg') return { tamanhoBase: qty * 1000, unidadeBase: 'g' };
    if (unitVal === 'ml') return { tamanhoBase: qty, unidadeBase: 'ml' };
    if (unitVal === 'g') return { tamanhoBase: qty, unidadeBase: 'g' };
    return { tamanhoBase: qty, unidadeBase: 'un' };
  };

  const { tamanhoBase, unidadeBase } = getTamanhoBase(qtdCompraInput, unidadeDisplay);
  const precoVal = typeof precoCompraInput === 'number' ? precoCompraInput : 0;
  const custoCalculado = tamanhoBase > 0 ? precoVal / tamanhoBase : 0;

  useEffect(() => {
    if (produto) {
      setNome(produto.nome);
      setMarca(produto.marca || '');
      setCategoria(produto.categoria || 'Geral');
      setPrecoCompraInput(produto.preco_compra);
      setEstoqueMinimoInput(produto.estoque_minimo);
      setEstoqueAtualInput(produto.estoque_atual);
      setUserEditedEstoqueInicial(true);

      if (produto.unidade_uso === 'ml') {
        if (produto.tamanho_compra >= 1000 && produto.tamanho_compra % 1000 === 0) {
          setUnidadeDisplay('L');
          setQtdCompraInput(produto.tamanho_compra / 1000);
        } else {
          setUnidadeDisplay('ml');
          setQtdCompraInput(produto.tamanho_compra);
        }
      } else if (produto.unidade_uso === 'g') {
        if (produto.tamanho_compra >= 1000 && produto.tamanho_compra % 1000 === 0) {
          setUnidadeDisplay('kg');
          setQtdCompraInput(produto.tamanho_compra / 1000);
        } else {
          setUnidadeDisplay('g');
          setQtdCompraInput(produto.tamanho_compra);
        }
      } else {
        setUnidadeDisplay('un');
        setQtdCompraInput(produto.tamanho_compra);
      }
    } else {
      setNome('');
      setMarca('');
      setCategoria('Geral');
      setQtdCompraInput(5);
      setUnidadeDisplay('L');
      setPrecoCompraInput(120);
      setEstoqueMinimoInput(500);
      setEstoqueAtualInput(5000); // Estoque inicial pré-preenchido com tamanho_compra (5L = 5000mL)
      setUserEditedEstoqueInicial(false);
    }
  }, [produto, isOpen]);

  // Atualizar estoque inicial automaticamente ao mudar tamanho_compra para novos produtos (se usuário não alterou manualmente)
  useEffect(() => {
    if (!produto && !userEditedEstoqueInicial) {
      setEstoqueAtualInput(tamanhoBase);
    }
  }, [tamanhoBase, produto, userEditedEstoqueInicial]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) {
      setErrorMsg('Nome do produto é obrigatório.');
      return;
    }
    if (tamanhoBase <= 0) {
      setErrorMsg('Quantidade do produto comprado deve ser maior que zero.');
      return;
    }
    if (precoVal < 0) {
      setErrorMsg('Preço de compra não pode ser negativo.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      await onSave({
        nome: nome.trim(),
        marca: marca.trim() || undefined,
        categoria,
        unidade_uso: unidadeBase,
        tamanho_compra: tamanhoBase,
        preco_compra: precoVal,
        estoque_minimo: typeof estoqueMinimoInput === 'number' ? estoqueMinimoInput : 0,
        estoque_atual: !produto && typeof estoqueAtualInput === 'number' ? estoqueAtualInput : undefined,
      });
      onClose();
    } catch (err: any) {
      console.error('[Save Produto Error]:', err);
      setErrorMsg(err?.message || 'Erro ao salvar produto.');
    } finally {
      setLoading(false);
    }
  };

  const unidadeSymbol = unidadeBase === 'ml' ? 'mL' : unidadeBase;
  const rendimento = produto?.rendimento_medio || 0;
  const estMinVal = typeof estoqueMinimoInput === 'number' ? estoqueMinimoInput : 0;
  const servicosEquivalentes = rendimento > 0 ? Math.floor(estMinVal / rendimento) : 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={produto ? 'Editar Produto' : 'Cadastrar Novo Produto'}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
        {errorMsg && (
          <div className="p-3 bg-flare-400/10 border border-flare-400/30 rounded text-flare-400 text-[13px]">
            {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[13px] font-medium text-vapor-200 block mb-1">Nome do Produto *</label>
            <Input
              type="text"
              placeholder="Ex: Shampoo V-Flock"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="text-[13px] font-medium text-vapor-200 block mb-1">Marca</label>
            <Input
              type="text"
              placeholder="Ex: Vonixx"
              value={marca}
              onChange={(e) => setMarca(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="text-[13px] font-medium text-vapor-200 block mb-1">Categoria</label>
          <select
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            className="w-full bg-graphite-700 border border-graphite-600 rounded-md p-3 text-[14px] text-vapor-100 appearance-none focus:border-amber-500 focus:outline-none min-h-[48px]"
          >
            {CATEGORIAS.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        {/* Bloco de Compra (Central UX Point) */}
        <div className="p-4 bg-graphite-900 border border-amber-500/30 rounded-lg flex flex-col gap-3">
          <label className="text-[13px] font-semibold text-amber-500 uppercase tracking-wide">
            Como você compra este produto?
          </label>

          <div className="grid grid-cols-2 sm:grid-cols-[1fr_auto_1.5fr] gap-3 items-end">
            <div className="flex flex-col gap-1">
              <span className="text-[12px] text-vapor-400 block min-h-[20px] flex items-end">Quantidade</span>
              <CampoNumerico
                placeholder="Ex: 5"
                value={qtdCompraInput}
                onChange={(val) => setQtdCompraInput(val ?? '')}
                wrapperClassName="min-h-[56px] h-[56px] w-full"
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[12px] text-vapor-400 block min-h-[20px] flex items-end">Unidade</span>
              <select
                value={unidadeDisplay}
                onChange={(e) => setUnidadeDisplay(e.target.value as UnidadeCompraDisplay)}
                className="w-full bg-graphite-700 border border-graphite-600 rounded-md px-3 text-[14px] text-vapor-100 font-mono appearance-none focus:border-amber-500 focus:outline-none min-h-[56px] h-[56px]"
              >
                <option value="L">L</option>
                <option value="ml">mL</option>
                <option value="kg">kg</option>
                <option value="g">g</option>
                <option value="un">un</option>
              </select>
            </div>

            <div className="flex flex-col gap-1 col-span-2 sm:col-span-1">
              <span className="text-[12px] text-vapor-400 block min-h-[20px] flex items-end">Preço de Compra</span>
              <CampoNumerico
                prefix="R$"
                placeholder="120.00"
                value={precoCompraInput}
                onChange={(val) => setPrecoCompraInput(val ?? '')}
                wrapperClassName="min-h-[56px] h-[56px] w-full"
              />
            </div>
          </div>

          {/* Custo unitário formatado com pt-BR e 4 casas decimais */}
          <div className="p-3 bg-graphite-800/80 rounded border border-graphite-700 flex items-center justify-between text-[13px]">
            <span className="text-vapor-300">Custo calculated:</span>
            <span className="font-mono font-bold text-emerald-400 text-[14px]">
              {formatarCustoUnitario(custoCalculado, unidadeSymbol)}
            </span>
          </div>
        </div>

        {/* Estoque Mínimo e Inicial */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[13px] font-medium text-vapor-200 block mb-1">
              Estoque Mínimo ({unidadeSymbol})
            </label>
            <CampoNumerico
              placeholder="Ex: 500"
              value={estoqueMinimoInput}
              onChange={(val) => setEstoqueMinimoInput(val ?? '')}
            />
            <span className="text-[11px] text-vapor-400 mt-1 block leading-tight">
              {rendimento > 0 ? (
                <strong className="text-amber-400 font-mono">
                  {estMinVal} {unidadeSymbol} ≈ {servicosEquivalentes} {servicosEquivalentes === 1 ? 'serviço' : 'serviços'}
                </strong>
              ) : (
                'Você será avisado quando o estoque chegar neste nível.'
              )}
            </span>
          </div>

          {!produto && (
            <div>
              <label className="text-[13px] font-medium text-vapor-200 block mb-1">
                Estoque Inicial ({unidadeSymbol})
              </label>
              <CampoNumerico
                placeholder="Ex: 5000"
                value={estoqueAtualInput}
                onChange={(val) => {
                  setEstoqueAtualInput(val ?? '');
                  setUserEditedEstoqueInicial(true);
                }}
              />
              <span className="text-[11px] text-vapor-400 mt-1 block leading-tight">
                Quantidade atual na oficina. Pré-preenchido com a embalagem.
              </span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={loading}>
            {loading ? 'Salvando...' : produto ? 'Atualizar Produto' : 'Cadastrar Produto'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
