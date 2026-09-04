import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAdminAuth } from '../../components/admin/AdminGuard';
import { ModalConfirmacao } from '../../components/ui/ModalConfirmacao';
import { 
  TrendingUp, 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  Check, 
  X, 
  AlertTriangle, 
  RefreshCw
} from 'lucide-react';

interface ServicoModelo {
  codigo: string;
  nome: string;
  grupo?: string;
}

interface ReferenciaPreco {
  id: string;
  servico_modelo_codigo: string;
  categoria_nome: string;
  porte_cidade: 'nacional' | 'interior' | 'capital' | 'metropolitana';
  preco_min: number;
  preco_max: number;
  fonte: 'plataforma' | 'comunidade';
  amostra: number;
  atualizado_em: string;
}

const CATEGORIAS_PADRAO = ['Hatch', 'Sedan', 'SUV', 'Caminhonete', 'Moto'];
const PORTES_CIDADE = [
  { id: 'nacional', label: 'Nacional (Geral)' },
  { id: 'interior', label: 'Interior / Médio Porte' },
  { id: 'capital', label: 'Capital' },
  { id: 'metropolitana', label: 'Região Metropolitana' }
];

export const AdminPrecificacaoReferencia: React.FC = () => {
  const { adminLevel } = useAdminAuth();
  const isReadOnly = adminLevel === 'suporte';

  const [modelos, setModelos] = useState<ServicoModelo[]>([]);
  const [referencias, setReferencias] = useState<ReferenciaPreco[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Filtros
  const [searchCodigo, setSearchCodigo] = useState('');
  const [filterCategoria, setFilterCategoria] = useState('');
  const [filterPorte, setFilterPorte] = useState('');

  // Modal / Edição
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRef, setEditingRef] = useState<ReferenciaPreco | null>(null);

  const [formCodigo, setFormCodigo] = useState('');
  const [formCategoria, setFormCategoria] = useState('Hatch');
  const [formPorte, setFormPorte] = useState<'nacional' | 'interior' | 'capital' | 'metropolitana'>('nacional');
  const [formPrecoMin, setFormPrecoMin] = useState('');
  const [formPrecoMax, setFormPrecoMax] = useState('');
  const [formFonte, setFormFonte] = useState<'plataforma' | 'comunidade'>('plataforma');
  const [formAmostra, setFormAmostra] = useState('0');
  const [saving, setSaving] = useState(false);
  const [idParaExcluir, setIdParaExcluir] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Carrega serviços modelo
      const { data: modData, error: modErr } = await supabase
        .from('servicos_modelo')
        .select('codigo, nome, grupo')
        .order('codigo');
      
      if (modErr) throw modErr;
      setModelos(modData || []);

      // 2. Carrega referências
      const { data: refData, error: refErr } = await supabase
        .from('servico_modelo_referencia')
        .select('*')
        .order('servico_modelo_codigo')
        .order('categoria_nome');

      if (refErr) throw refErr;
      setReferencias(refData || []);
    } catch (err: any) {
      console.error('[AdminPrecificacaoReferencia] Erro ao carregar dados:', err);
      setError(err.message || 'Erro ao carregar referências de mercado.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleOpenNew = () => {
    setEditingRef(null);
    setFormCodigo(modelos[0]?.codigo || '');
    setFormCategoria('Hatch');
    setFormPorte('nacional');
    setFormPrecoMin('');
    setFormPrecoMax('');
    setFormFonte('plataforma');
    setFormAmostra('0');
    setModalOpen(true);
  };

  const handleOpenEdit = (item: ReferenciaPreco) => {
    setEditingRef(item);
    setFormCodigo(item.servico_modelo_codigo);
    setFormCategoria(item.categoria_nome);
    setFormPorte(item.porte_cidade);
    setFormPrecoMin(item.preco_min.toString());
    setFormPrecoMax(item.preco_max.toString());
    setFormFonte(item.fonte);
    setFormAmostra(item.amostra.toString());
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;
    setError(null);
    setSuccess(null);

    const minVal = parseFloat(formPrecoMin.replace(',', '.'));
    const maxVal = parseFloat(formPrecoMax.replace(',', '.'));

    if (isNaN(minVal) || minVal < 0) {
      setError('Informe um preço mínimo válido.');
      return;
    }
    if (isNaN(maxVal) || maxVal < minVal) {
      setError('Preço máximo deve ser maior ou igual ao mínimo.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        servico_modelo_codigo: formCodigo,
        categoria_nome: formCategoria,
        porte_cidade: formPorte,
        preco_min: minVal,
        preco_max: maxVal,
        fonte: formFonte,
        amostra: parseInt(formAmostra || '0', 10),
        atualizado_em: new Date().toISOString()
      };

      if (editingRef) {
        const { error: updateErr } = await supabase
          .from('servico_modelo_referencia')
          .update(payload)
          .eq('id', editingRef.id);

        if (updateErr) throw updateErr;
        setSuccess('Faixa de referência atualizada com sucesso!');
      } else {
        const { error: insertErr } = await supabase
          .from('servico_modelo_referencia')
          .insert([payload]);

        if (insertErr) throw insertErr;
        setSuccess('Nova faixa de referência cadastrada!');
      }

      setModalOpen(false);
      await loadData();
    } catch (err: any) {
      console.error('[AdminPrecificacao] Erro ao salvar referência:', err);
      setError(err.message || 'Erro ao salvar referência.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: string) => {
    if (isReadOnly) return;
    setIdParaExcluir(id);
  };

  const executeDelete = async () => {
    if (!idParaExcluir || isReadOnly) return;
    const id = idParaExcluir;

    try {
      const { error: delErr } = await supabase
        .from('servico_modelo_referencia')
        .delete()
        .eq('id', id);

      if (delErr) throw delErr;
      setSuccess('Referência excluída com sucesso!');
      await loadData();
    } catch (err: any) {
      console.error('[AdminPrecificacao] Erro ao excluir:', err);
      setError(err.message || 'Erro ao excluir referência.');
    } finally {
      setIdParaExcluir(null);
    }
  };

  const filteredRefs = referencias.filter(r => {
    const matchSearch = !searchCodigo || 
      r.servico_modelo_codigo.toLowerCase().includes(searchCodigo.toLowerCase()) ||
      modelos.find(m => m.codigo === r.servico_modelo_codigo)?.nome.toLowerCase().includes(searchCodigo.toLowerCase());
    const matchCat = !filterCategoria || r.categoria_nome === filterCategoria;
    const matchPorte = !filterPorte || r.porte_cidade === filterPorte;

    return matchSearch && matchCat && matchPorte;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/80 p-6 rounded-2xl border border-amber-500/20 shadow-lg">
        <div>
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl">
              <TrendingUp className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <h1 className="text-xl font-black uppercase text-white tracking-wide font-heading">
                Curadoria de Referências de Mercado
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Gerencie as faixas de preços praticadas (P25 - P75) por serviço modelo, categoria de veículo e porte da cidade.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <button
            onClick={loadData}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition"
            title="Atualizar dados"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {!isReadOnly && (
            <button
              onClick={handleOpenNew}
              className="flex items-center space-x-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl shadow-lg shadow-amber-500/20 text-xs transition"
            >
              <Plus className="w-4 h-4" />
              <span>Nova Faixa de Preço</span>
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="hover:text-white"><X className="w-4 h-4" /></button>
        </div>
      )}

      {success && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-xs flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>{success}</span>
          </div>
          <button onClick={() => setSuccess(null)} className="hover:text-white"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por código ou nome do serviço..."
            value={searchCodigo}
            onChange={(e) => setSearchCodigo(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-200 outline-none focus:border-amber-500"
          />
        </div>

        <div>
          <select
            value={filterCategoria}
            onChange={(e) => setFilterCategoria(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none focus:border-amber-500 cursor-pointer"
          >
            <option value="">Todas as Categorias</option>
            {CATEGORIAS_PADRAO.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        <div>
          <select
            value={filterPorte}
            onChange={(e) => setFilterPorte(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none focus:border-amber-500 cursor-pointer"
          >
            <option value="">Todos os Portes de Cidade</option>
            {PORTES_CIDADE.map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-900/80 rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-mono text-slate-400 uppercase tracking-wider">
                <th className="py-3.5 px-4">Serviço Modelo</th>
                <th className="py-3.5 px-4">Categoria</th>
                <th className="py-3.5 px-4">Porte Cidade</th>
                <th className="py-3.5 px-4 text-right">Faixa de Preço (Min - Max)</th>
                <th className="py-3.5 px-4">Fonte / Amostra</th>
                <th className="py-3.5 px-4 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500 font-mono">
                    Carregando faixas de referência...
                  </td>
                </tr>
              ) : filteredRefs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500 font-mono">
                    Nenhuma faixa de preço cadastrada com os filtros atuais.
                  </td>
                </tr>
              ) : (
                filteredRefs.map((item) => {
                  const mod = modelos.find(m => m.codigo === item.servico_modelo_codigo);
                  return (
                    <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-4 font-mono">
                        <div className="flex items-center space-x-2">
                          <span className="bg-amber-500/10 border border-amber-500/30 text-amber-400 px-2 py-0.5 rounded font-bold">
                            {item.servico_modelo_codigo}
                          </span>
                          <span className="text-slate-200 font-sans font-medium">
                            {mod?.nome || '—'}
                          </span>
                        </div>
                      </td>

                      <td className="py-3 px-4 text-slate-300 font-medium">
                        {item.categoria_nome}
                      </td>

                      <td className="py-3 px-4 text-slate-300">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-mono border ${
                          item.porte_cidade === 'nacional'
                            ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        }`}>
                          {item.porte_cidade}
                        </span>
                      </td>

                      <td className="py-3 px-4 text-right font-mono font-bold text-amber-400">
                        R$ {item.preco_min.toFixed(2)} - R$ {item.preco_max.toFixed(2)}
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex items-center space-x-1.5">
                          <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold font-mono ${
                            item.fonte === 'plataforma'
                              ? 'bg-purple-500/10 border border-purple-500/30 text-purple-400'
                              : 'bg-teal-500/10 border border-teal-500/30 text-teal-400'
                          }`}>
                            {item.fonte}
                          </span>
                          {item.fonte === 'comunidade' && (
                            <span className="text-[10px] text-slate-400 font-mono">
                              ({item.amostra} oficinas)
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center space-x-2">
                          {!isReadOnly && (
                            <>
                              <button
                                onClick={() => handleOpenEdit(item)}
                                className="p-1.5 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg transition"
                                title="Editar"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDelete(item.id)}
                                className="p-1.5 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded-lg transition"
                                title="Excluir"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de Formulário */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <h3 className="font-heading font-black text-sm uppercase text-white tracking-wider flex items-center space-x-2">
                <TrendingUp className="w-4 h-4 text-amber-400" />
                <span>{editingRef ? 'Editar Faixa de Referência' : 'Nova Faixa de Referência'}</span>
              </h3>
              <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-5 space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 font-medium mb-1">Serviço Modelo</label>
                <select
                  value={formCodigo}
                  onChange={(e) => setFormCodigo(e.target.value)}
                  disabled={!!editingRef}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-200 font-mono outline-none focus:border-amber-500"
                >
                  {modelos.map(m => (
                    <option key={m.codigo} value={m.codigo}>
                      {m.codigo} — {m.nome}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Categoria Veículo</label>
                  <select
                    value={formCategoria}
                    onChange={(e) => setFormCategoria(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-200 outline-none focus:border-amber-500 cursor-pointer"
                  >
                    {CATEGORIAS_PADRAO.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">Porte da Cidade</label>
                  <select
                    value={formPorte}
                    onChange={(e) => setFormPorte(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-200 outline-none focus:border-amber-500 cursor-pointer"
                  >
                    {PORTES_CIDADE.map(p => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Preço Mínimo (P25)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-slate-500">R$</span>
                    <input
                      type="text"
                      placeholder="0,00"
                      value={formPrecoMin}
                      onChange={(e) => setFormPrecoMin(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-2.5 font-mono text-slate-100 outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">Preço Máximo (P75)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-slate-500">R$</span>
                    <input
                      type="text"
                      placeholder="0,00"
                      value={formPrecoMax}
                      onChange={(e) => setFormPrecoMax(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-2.5 font-mono text-slate-100 outline-none focus:border-amber-500"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Fonte da Referência</label>
                  <select
                    value={formFonte}
                    onChange={(e) => setFormFonte(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-200 outline-none focus:border-amber-500 cursor-pointer"
                  >
                    <option value="plataforma">Curadoria Plataforma</option>
                    <option value="comunidade">Agregação Comunidade</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">Amostra (Nº Oficinas)</label>
                  <input
                    type="number"
                    value={formAmostra}
                    onChange={(e) => setFormAmostra(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 font-mono text-slate-200 outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-bold transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg font-bold transition flex items-center space-x-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>{saving ? 'Salvando...' : 'Salvar Faixa'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Confirmação para Excluir Referência */}
      <ModalConfirmacao
        isOpen={Boolean(idParaExcluir)}
        onClose={() => setIdParaExcluir(null)}
        onConfirm={executeDelete}
        titulo="Excluir Faixa de Referência"
        mensagem="Tem certeza que deseja excluir esta faixa de referência de mercado? As oficinas da região não terão mais este balizador."
        textoConfirmar="Excluir Faixa"
        textoCancelar="Cancelar"
        variant="danger"
        loading={saving}
      />
    </div>
  );
};
