import React, { useState, useEffect, useMemo } from 'react';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import {
  Package,
  Plus,
  AlertTriangle,
  Search,
  Edit2,
  Sliders,
  Lock,
  Sparkles,
} from 'lucide-react';
import type { Produto } from '../types/estoque';
import { formatarCustoUnitario } from '../utils/formatters';
import { ModalProduto } from '../components/estoque/ModalProduto';
import { ModalEntradaEstoque } from '../components/estoque/ModalEntradaEstoque';
import { ModalAjusteEstoque } from '../components/estoque/ModalAjusteEstoque';
import { AvisoRecursoForaDoPlano } from '../components/planos/AvisoRecursoForaDoPlano';

export const Estoque: React.FC = () => {
  const { tenant, membership } = useAuth();
  const podeGerenciar = membership?.role === 'dono' || membership?.role === 'gerente';

  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoria, setSelectedCategoria] = useState<string>('todas');

  // Modais
  const [modalProdutoOpen, setModalProdutoOpen] = useState(false);
  const [produtoEditando, setProdutoEditando] = useState<Produto | null>(null);

  const [modalEntradaOpen, setModalEntradaOpen] = useState(false);
  const [produtoEntrada, setProdutoEntrada] = useState<Produto | null>(null);

  const [modalAjusteOpen, setModalAjusteOpen] = useState(false);
  const [produtoAjuste, setProdutoAjuste] = useState<Produto | null>(null);

  const loadProdutos = async () => {
    if (!tenant || !podeGerenciar) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('produtos')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('categoria')
        .order('nome');

      if (error) throw error;
      setProdutos(data || []);
    } catch (err) {
      console.error('[Load Produtos Error]:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProdutos();
  }, [tenant?.id, podeGerenciar]);

  // Produtos abaixo do estoque mínimo
  const produtosAlerta = useMemo(() => {
    return produtos.filter(
      (p) => p.ativo && p.estoque_atual <= p.estoque_minimo
    );
  }, [produtos]);

  // Produtos filtrados por busca e categoria
  const produtosFiltrados = useMemo(() => {
    return produtos.filter((p) => {
      const matchSearch =
        p.nome.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.marca && p.marca.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchCat =
        selectedCategoria === 'todas' || p.categoria === selectedCategoria;
      return matchSearch && matchCat;
    });
  }, [produtos, searchQuery, selectedCategoria]);

  // Agrupar por categoria
  const produtosAgrupados = useMemo(() => {
    const map = new Map<string, Produto[]>();
    produtosFiltrados.forEach((p) => {
      const cat = p.categoria || 'Geral';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(p);
    });
    return map;
  }, [produtosFiltrados]);

  // Acesso negado para operador
  if (!podeGerenciar) {
    return (
      <div>
        <PageHeader title="Estoque e Custos" />
        <div className="p-8 bg-graphite-900 border border-graphite-700 rounded-lg flex flex-col items-center justify-center text-center gap-4 my-6">
          <div className="w-16 h-16 rounded-full bg-flare-400/10 border border-flare-400/30 flex items-center justify-center text-flare-400">
            <Lock size={32} />
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="text-[18px] font-bold text-vapor-100">Acesso Restrito à Gestão</h3>
            <p className="text-[14px] text-vapor-400 max-w-md">
              O módulo de Estoque, Preço de Compra e Custos Gerenciais é acessível apenas para Donos e Gerentes da oficina.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Handlers para cadastrar/editar
  const handleSaveProduto = async (data: {
    nome: string;
    marca?: string;
    categoria: string;
    unidade_uso: string;
    tamanho_compra: number;
    preco_compra: number;
    estoque_minimo: number;
    estoque_atual?: number;
  }) => {
    if (!tenant) return;

    if (produtoEditando) {
      const { error } = await supabase
        .from('produtos')
        .update({
          nome: data.nome,
          marca: data.marca || null,
          categoria: data.categoria,
          unidade_uso: data.unidade_uso,
          tamanho_compra: data.tamanho_compra,
          preco_compra: data.preco_compra,
          estoque_minimo: data.estoque_minimo,
        })
        .eq('id', produtoEditando.id);

      if (error) throw error;
    } else {
      const { error } = await supabase.from('produtos').insert({
        tenant_id: tenant.id,
        nome: data.nome,
        marca: data.marca || null,
        categoria: data.categoria,
        unidade_uso: data.unidade_uso,
        tamanho_compra: data.tamanho_compra,
        preco_compra: data.preco_compra,
        estoque_minimo: data.estoque_minimo,
        estoque_atual: data.estoque_atual || 0,
      });

      if (error) throw error;
    }

    await loadProdutos();
  };

  const handleEntradaEstoque = async (data: {
    produto_id: string;
    quantidade: number;
    preco_compra?: number;
    observacao?: string;
  }) => {
    const { error } = await supabase.rpc('registrar_entrada_estoque', {
      p_produto: data.produto_id,
      p_quantidade: data.quantidade,
      p_preco_compra: data.preco_compra || null,
      p_observacao: data.observacao || null,
    });

    if (error) throw error;
    await loadProdutos();
  };

  const handleAjusteEstoque = async (data: {
    produto_id: string;
    novo_valor: number;
    motivo: string;
  }) => {
    const { error } = await supabase.rpc('ajustar_estoque', {
      p_produto: data.produto_id,
      p_novo_valor: data.novo_valor,
      p_motivo: data.motivo,
    });

    if (error) throw error;
    await loadProdutos();
  };

  const formatEstoqueDisplay = (qtd: number, unidade: string) => {
    if (unidade === 'ml') {
      if (qtd >= 1000) {
        return `${qtd.toLocaleString('pt-BR')} mL (${(qtd / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} L)`;
      }
      return `${qtd.toLocaleString('pt-BR')} mL`;
    }
    if (unidade === 'g') {
      if (qtd >= 1000) {
        return `${qtd.toLocaleString('pt-BR')} g (${(qtd / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg)`;
      }
      return `${qtd.toLocaleString('pt-BR')} g`;
    }
    return `${qtd.toLocaleString('pt-BR')} un`;
  };

  return (
    <div className="flex flex-col gap-6">
      <AvisoRecursoForaDoPlano featureNome="Controle de Estoque" planoMinimo="Pro" />
      <PageHeader
        title="Estoque & Custos de Produtos"
        action={
          <Button
            variant="primary"
            onClick={() => {
              setProdutoEditando(null);
              setModalProdutoOpen(true);
            }}
            className="flex items-center gap-2"
          >
            <Plus size={18} />
            <span>Novo Produto</span>
          </Button>
        }
      />

      {/* Alerta de Produtos Abaixo do Estoque Mínimo */}
      {produtosAlerta.length > 0 && (
        <div className="p-4 bg-flare-400/10 border border-flare-400/30 rounded-lg flex items-center justify-between gap-4 text-flare-400">
          <div className="flex items-center gap-3">
            <AlertTriangle size={24} className="shrink-0" />
            <div>
              <span className="font-bold text-[15px]">
                {produtosAlerta.length} {produtosAlerta.length === 1 ? 'produto está' : 'produtos estão'} abaixo do estoque mínimo
              </span>
              <p className="text-[12px] text-vapor-300">
                {produtosAlerta.map((p) => `${p.nome} (${p.estoque_atual} ${p.unidade_uso})`).join(', ')}
              </p>
            </div>
          </div>
          <span className="px-3 py-1 bg-flare-400/20 text-[12px] font-bold rounded-full border border-flare-400/40 uppercase tracking-wide shrink-0">
            Aviso de Reposição
          </span>
        </div>
      )}

      {/* Barra de Filtros e Busca */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-graphite-900 p-3 rounded-lg border border-graphite-700">
        <div className="relative w-full sm:w-80">
          <Search size={18} className="absolute left-3 top-3.5 text-vapor-400" />
          <Input
            type="text"
            placeholder="Buscar por produto ou marca..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 min-h-[44px]"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
          <button
            onClick={() => setSelectedCategoria('todas')}
            className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors shrink-0 ${selectedCategoria === 'todas' ? 'bg-amber-500 text-graphite-950 font-bold' : 'bg-graphite-800 text-vapor-300 hover:text-vapor-100'}`}
          >
            Todas Categorias
          </button>
          {['Lavagem', 'Polimento', 'Proteção', 'Interior', 'Vidros', 'Insumos', 'Geral'].map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategoria(cat)}
              className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors shrink-0 ${selectedCategoria === cat ? 'bg-amber-500 text-graphite-950 font-bold' : 'bg-graphite-800 text-vapor-300 hover:text-vapor-100'}`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Conteúdo Principal */}
      {loading ? (
        <div className="p-12 text-center text-vapor-400">Carregando catálogo de estoque...</div>
      ) : produtos.length === 0 ? (
        <div className="p-12 bg-graphite-900 border border-graphite-700 rounded-lg flex flex-col items-center justify-center text-center gap-4">
          <Package size={48} className="text-amber-500/50" />
          <div className="flex flex-col gap-1">
            <h3 className="text-[18px] font-bold text-vapor-100">Nenhum produto cadastrado</h3>
            <p className="text-[14px] text-vapor-400 max-w-md">
              Cadastre os produtos que sua oficina consome para calcular automaticamente o custo unitário e o custo real de cada serviço.
            </p>
          </div>
          <Button
            variant="primary"
            onClick={() => {
              setProdutoEditando(null);
              setModalProdutoOpen(true);
            }}
            className="mt-2"
          >
            Cadastrar Primeiro Produto
          </Button>
        </div>
      ) : produtosFiltrados.length === 0 ? (
        <div className="p-8 text-center text-vapor-400">Nenhum produto encontrado para a busca.</div>
      ) : (
        <div className="flex flex-col gap-6">
          {Array.from(produtosAgrupados.entries()).map(([categoria, items]) => (
            <div key={categoria} className="flex flex-col gap-3">
              <div className="flex items-center gap-2 border-b border-graphite-700 pb-2">
                <span className="text-[14px] font-bold uppercase tracking-wider text-amber-500">
                  {categoria}
                </span>
                <span className="text-[12px] text-vapor-400 font-mono">({items.length})</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {items.map((produto) => {
                  const isMinimo = produto.estoque_atual <= produto.estoque_minimo;
                  const isAtencao =
                    !isMinimo && produto.estoque_atual <= produto.estoque_minimo * 1.5;

                  const barPct = Math.min(
                    100,
                    Math.max(
                      5,
                      produto.estoque_minimo > 0
                        ? (produto.estoque_atual / (produto.estoque_minimo * 2)) * 100
                        : 100
                    )
                  );

                  return (
                    <div
                      key={produto.id}
                      className="p-4 bg-graphite-900 border border-graphite-700 rounded-lg flex flex-col justify-between gap-4 hover:border-graphite-600 transition-colors"
                    >
                      {/* Topo do Card */}
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="text-[15px] font-bold text-vapor-100">{produto.nome}</h4>
                          {produto.marca && (
                            <span className="text-[12px] text-vapor-400 block">{produto.marca}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            title="Entrada de Estoque"
                            onClick={() => {
                              setProdutoEntrada(produto);
                              setModalEntradaOpen(true);
                            }}
                            className="p-1.5 rounded hover:bg-emerald-500/20 text-emerald-400 transition-colors"
                          >
                            <Plus size={16} />
                          </button>
                          <button
                            title="Ajuste de Estoque"
                            onClick={() => {
                              setProdutoAjuste(produto);
                              setModalAjusteOpen(true);
                            }}
                            className="p-1.5 rounded hover:bg-amber-500/20 text-amber-400 transition-colors"
                          >
                            <Sliders size={16} />
                          </button>
                          <button
                            title="Editar Produto"
                            onClick={() => {
                              setProdutoEditando(produto);
                              setModalProdutoOpen(true);
                            }}
                            className="p-1.5 rounded hover:bg-graphite-700 text-vapor-400 hover:text-vapor-100 transition-colors"
                          >
                            <Edit2 size={16} />
                          </button>
                        </div>
                      </div>

                      {/* Bloco de Nível de Estoque */}
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-[13px]">
                          <span className="text-vapor-400">Estoque Atual:</span>
                          <span className="font-mono font-bold text-vapor-100 text-[14px]">
                            {formatEstoqueDisplay(produto.estoque_atual, produto.unidade_uso)}
                          </span>
                        </div>

                        {/* Barra de Nível */}
                        <div className="w-full h-2 bg-graphite-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              isMinimo
                                ? 'bg-flare-400'
                                : isAtencao
                                ? 'bg-amber-500'
                                : 'bg-emerald-500'
                            }`}
                            style={{ width: `${barPct}%` }}
                          />
                        </div>

                        <div className="flex items-center justify-between text-[11px] text-vapor-400">
                          <span>Mínimo: {produto.estoque_minimo} {produto.unidade_uso}</span>
                          {isMinimo && (
                            <span className="text-flare-400 font-bold uppercase">Reposição!</span>
                          )}
                        </div>
                      </div>

                      {/* Rodapé do Card com Custos */}
                      <div className="p-2.5 bg-graphite-800/80 rounded border border-graphite-700 flex flex-col gap-1 text-[12px]">
                        <div className="flex justify-between items-center">
                          <span className="text-vapor-400">Custo Unitário:</span>
                          <span className="font-mono font-semibold text-emerald-400">
                            {formatarCustoUnitario(produto.custo_unitario, produto.unidade_uso === 'ml' ? 'mL' : produto.unidade_uso)}
                          </span>
                        </div>
                        {produto.rendimento_medio && (
                          <div className="flex justify-between items-center text-vapor-400">
                            <span className="flex items-center gap-1">
                              <Sparkles size={12} className="text-amber-500" />
                              <span>Rendimento médio:</span>
                            </span>
                            <span className="font-mono font-medium text-vapor-200">
                              ≈ {produto.rendimento_medio} {produto.unidade_uso} / serviço
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modais */}
      <ModalProduto
        isOpen={modalProdutoOpen}
        onClose={() => setModalProdutoOpen(false)}
        produto={produtoEditando}
        onSave={handleSaveProduto}
      />

      <ModalEntradaEstoque
        isOpen={modalEntradaOpen}
        onClose={() => setModalEntradaOpen(false)}
        produto={produtoEntrada}
        onConfirm={handleEntradaEstoque}
      />

      <ModalAjusteEstoque
        isOpen={modalAjusteOpen}
        onClose={() => setModalAjusteOpen(false)}
        produto={produtoAjuste}
        onConfirm={handleAjusteEstoque}
      />
    </div>
  );
};
