import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Plus, Trash2, Edit, CheckSquare, AlertCircle } from 'lucide-react';
import type { ChecklistModelo, ChecklistModeloItem } from '../../types/execucao';

export const AbaChecklists: React.FC = () => {
  const { tenant, membership } = useAuth();
  const podeEditar = membership?.role === 'dono' || membership?.role === 'gerente';

  const [modelos, setModelos] = useState<ChecklistModelo[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Modal Novo Modelo
  const [modalNovoOpen, setModalNovoOpen] = useState(false);
  const [novoNome, setNovoNome] = useState('');
  const [savingModelo, setSavingModelo] = useState(false);

  // Modal Gerenciar Itens
  const [modeloSelecionado, setModeloSelecionado] = useState<ChecklistModelo | null>(null);
  const [itens, setItens] = useState<ChecklistModeloItem[]>([]);
  const [novaDescricao, setNovaDescricao] = useState('');
  const [novaObservacao, setNovaObservacao] = useState('');
  const [novoObrigatorio, setNovoObrigatorio] = useState(false);
  const [savingItem, setSavingItem] = useState(false);

  const loadModelos = useCallback(async () => {
    if (!tenant) return;
    try {
      const { data, error } = await supabase
        .from('checklist_modelos')
        .select('*, itens:checklist_modelo_itens(*)')
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setModelos(data || []);
    } catch (err: any) {
      console.error('[Load Checklists Error]:', err);
      setErrorMsg(err?.message || 'Erro ao carregar modelos de checklist.');
    } finally {
      setLoading(false);
    }
  }, [tenant?.id]);

  useEffect(() => {
    loadModelos();
  }, [loadModelos]);

  const handleCriarModelo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant || !novoNome.trim()) return;
    setSavingModelo(true);
    setErrorMsg(null);

    try {
      const { error } = await supabase.from('checklist_modelos').insert({
        tenant_id: tenant.id,
        nome: novoNome.trim(),
        ativo: true,
      });

      if (error) throw error;

      setNovoNome('');
      setModalNovoOpen(false);
      loadModelos();
    } catch (err: any) {
      console.error('[Criar Modelo Error]:', err);
      setErrorMsg(err?.message || 'Erro ao criar modelo de checklist.');
    } finally {
      setSavingModelo(false);
    }
  };

  // Edição inline de item
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingDescricao, setEditingDescricao] = useState('');
  const [editingObservacao, setEditingObservacao] = useState('');
  const [savingEditItem, setSavingEditItem] = useState(false);

  const handleIniciarEdicaoItem = (item: ChecklistModeloItem) => {
    setEditingItemId(item.id);
    setEditingDescricao(item.descricao);
    setEditingObservacao(item.observacao || '');
  };

  const handleCancelarEdicaoItem = () => {
    setEditingItemId(null);
    setEditingDescricao('');
    setEditingObservacao('');
  };

  const handleSalvarEdicaoItem = async (itemId: string) => {
    if (!editingDescricao.trim()) return;
    setSavingEditItem(true);
    try {
      const { error } = await supabase
        .from('checklist_modelo_itens')
        .update({
          descricao: editingDescricao.trim(),
          observacao: editingObservacao.trim() || null,
        })
        .eq('id', itemId);

      if (error) throw error;

      setItens((prev) =>
        prev.map((i) =>
          i.id === itemId
            ? { ...i, descricao: editingDescricao.trim(), observacao: editingObservacao.trim() || null }
            : i
        )
      );
      setEditingItemId(null);
      loadModelos();
    } catch (err: any) {
      console.error('[Salvar Edicao Item Error]:', err);
      setErrorMsg(err?.message || 'Erro ao salvar item.');
    } finally {
      setSavingEditItem(false);
    }
  };

  const handleAbrirItens = async (modelo: ChecklistModelo) => {
    setModeloSelecionado(modelo);
    setEditingItemId(null);
    try {
      const { data, error } = await supabase
        .from('checklist_modelo_itens')
        .select('*')
        .eq('modelo_id', modelo.id)
        .order('ordem', { ascending: true });

      if (error) throw error;
      setItens(data || []);
    } catch (err: any) {
      console.error('[Load Itens Error]:', err);
    }
  };

  const handleAdicionarItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant || !modeloSelecionado || !novaDescricao.trim()) return;
    setSavingItem(true);

    try {
      const proximaOrdem = itens.length + 1;
      const { data, error } = await supabase
        .from('checklist_modelo_itens')
        .insert({
          tenant_id: tenant.id,
          modelo_id: modeloSelecionado.id,
          descricao: novaDescricao.trim(),
          observacao: novaObservacao.trim() || null,
          obrigatorio: novoObrigatorio,
          ordem: proximaOrdem,
        })
        .select('*')
        .single();

      if (error) throw error;

      setItens((prev) => [...prev, data]);
      setNovaDescricao('');
      setNovaObservacao('');
      setNovoObrigatorio(false);
      loadModelos();
    } catch (err: any) {
      console.error('[Adicionar Item Error]:', err);
      setErrorMsg(err?.message || 'Erro ao adicionar item.');
    } finally {
      setSavingItem(false);
    }
  };

  const handleRemoverItem = async (itemId: string) => {
    try {
      const { error } = await supabase.from('checklist_modelo_itens').delete().eq('id', itemId);
      if (error) throw error;
      setItens((prev) => prev.filter((i) => i.id !== itemId));
      loadModelos();
    } catch (err: any) {
      console.error('[Remover Item Error]:', err);
    }
  };

  const handleToggleObrigatorioItem = async (item: ChecklistModeloItem) => {
    const novoObs = !item.obrigatorio;
    setItens((prev) => prev.map((i) => (i.id === item.id ? { ...i, obrigatorio: novoObs } : i)));

    try {
      const { error } = await supabase
        .from('checklist_modelo_itens')
        .update({ obrigatorio: novoObs })
        .eq('id', item.id);
      if (error) throw error;
    } catch (err) {
      loadModelos();
    }
  };

  const handleExcluirModelo = async (modeloId: string) => {
    try {
      const { error } = await supabase.from('checklist_modelos').delete().eq('id', modeloId);
      if (error) throw error;
      loadModelos();
    } catch (err: any) {
      console.error('[Excluir modelo error]:', err);
      setErrorMsg(err?.message || 'Erro ao excluir modelo.');
    }
  };

  if (loading) {
    return <div className="p-4 text-vapor-400 text-center">Carregando modelos de checklist...</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[18px] font-bold text-vapor-100 uppercase tracking-wide">
            Modelos de Checklist
          </h2>
          <p className="text-[13px] text-vapor-400">
            Configure os padrões de checklist aplicados durante a execução dos serviços
          </p>
        </div>

        {podeEditar && (
          <Button
            type="button"
            variant="primary"
            onClick={() => setModalNovoOpen(true)}
            className="min-h-[44px]"
          >
            <Plus size={18} />
            <span>Novo Modelo</span>
          </Button>
        )}
      </div>

      {errorMsg && (
        <div className="p-3 bg-flare-400/10 border border-flare-400/30 rounded text-flare-400 text-[13px] flex items-center gap-2">
          <AlertCircle size={18} className="shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* LISTA DE MODELOS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {modelos.map((modelo) => {
          const qtdItens = modelo.itens?.length || 0;
          return (
            <Card key={modelo.id} className="p-5 bg-graphite-800 border-graphite-600 flex flex-col justify-between gap-4">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[16px] text-vapor-100">{modelo.nome}</span>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-graphite-700 text-vapor-300 font-mono">
                    {qtdItens} itens
                  </span>
                </div>

                <div className="flex flex-col gap-1 mt-1">
                  {modelo.itens?.slice(0, 4).map((item) => (
                    <div key={item.id} className="text-[13px] text-vapor-300 flex items-center gap-2">
                      <CheckSquare size={14} className="text-amber-500 shrink-0" />
                      <span className="truncate">{item.descricao}</span>
                      {item.obrigatorio && (
                        <span className="text-[10px] text-flare-400 font-bold ml-auto">*</span>
                      )}
                    </div>
                  ))}
                  {qtdItens > 4 && (
                    <span className="text-[12px] text-vapor-400 italic">
                      + {qtdItens - 4} item(ns)
                    </span>
                  )}
                </div>
              </div>

              {podeEditar && (
                <div className="flex items-center gap-2 pt-3 border-t border-graphite-700">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => handleAbrirItens(modelo)}
                    className="flex-1 min-h-[36px] text-[13px]"
                  >
                    <Edit size={16} />
                    <span>Gerenciar Itens</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleExcluirModelo(modelo.id)}
                    className="text-flare-400 hover:text-flare-300 min-h-[36px]"
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* MODAL NOVO MODELO */}
      <Modal isOpen={modalNovoOpen} onClose={() => setModalNovoOpen(false)} title="Novo Modelo de Checklist">
        <form onSubmit={handleCriarModelo} className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1">
            <label className="text-[13px] text-vapor-400 font-medium">Nome do Modelo *</label>
            <Input
              type="text"
              placeholder="Ex: Polimento Técnico"
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              required
              className="min-h-[48px]"
            />
          </div>

          <Button type="submit" variant="primary" disabled={savingModelo} className="min-h-[48px] mt-2">
            {savingModelo ? 'Criando...' : 'Criar Modelo'}
          </Button>
        </form>
      </Modal>

      {/* MODAL GERENCIAR ITENS DO MODELO */}
      {modeloSelecionado && (
        <Modal
          isOpen={!!modeloSelecionado}
          onClose={() => setModeloSelecionado(null)}
          title={`Itens: ${modeloSelecionado.nome}`}
        >
          <div className="flex flex-col gap-4 py-2 max-h-[75vh] overflow-y-auto pr-1">
            {/* FORM ADICIONAR ITEM */}
            <form onSubmit={handleAdicionarItem} className="flex flex-col gap-3 p-3 bg-graphite-900 rounded border border-graphite-700">
              <span className="text-[13px] font-bold text-vapor-200">Adicionar Item</span>
              <div className="flex flex-col gap-2">
                <Input
                  type="text"
                  placeholder="Descrição do item... *"
                  value={novaDescricao}
                  onChange={(e) => setNovaDescricao(e.target.value)}
                  required
                  className="min-h-[44px]"
                />
                <Input
                  type="text"
                  placeholder="Instrução opcional. Ex: usar pH neutro, não aplicar em couro."
                  value={novaObservacao}
                  onChange={(e) => setNovaObservacao(e.target.value)}
                  className="min-h-[44px]"
                />
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer text-[13px] text-vapor-300">
                    <input
                      type="checkbox"
                      checked={novoObrigatorio}
                      onChange={(e) => setNovoObrigatorio(e.target.checked)}
                      className="accent-amber-500 w-4 h-4"
                    />
                    <span>Item obrigatório para finalização</span>
                  </label>

                  <Button type="submit" variant="primary" disabled={savingItem} className="min-h-[36px] px-3 text-[13px]">
                    <Plus size={16} />
                    <span>Adicionar</span>
                  </Button>
                </div>
              </div>
            </form>

            {/* LISTA DOS ITENS */}
            <div className="flex flex-col gap-2">
              {itens.map((item) => (
                <div
                  key={item.id}
                  className="p-3 bg-graphite-800 rounded border border-graphite-700 flex flex-col gap-2"
                >
                  {editingItemId === item.id ? (
                    <div className="flex flex-col gap-2 w-full">
                      <Input
                        type="text"
                        placeholder="Descrição do item... *"
                        value={editingDescricao}
                        onChange={(e) => setEditingDescricao(e.target.value)}
                        required
                        className="min-h-[40px] text-[13px]"
                      />
                      <Input
                        type="text"
                        placeholder="Instrução opcional. Ex: usar pH neutro, não aplicar em couro."
                        value={editingObservacao}
                        onChange={(e) => setEditingObservacao(e.target.value)}
                        className="min-h-[40px] text-[13px]"
                      />
                      <div className="flex items-center justify-end gap-2 pt-1">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={handleCancelarEdicaoItem}
                          className="min-h-[32px] text-[12px] px-2.5"
                        >
                          Cancelar
                        </Button>
                        <Button
                          type="button"
                          variant="primary"
                          disabled={savingEditItem || !editingDescricao.trim()}
                          onClick={() => handleSalvarEdicaoItem(item.id)}
                          className="min-h-[32px] text-[12px] px-3"
                        >
                          {savingEditItem ? 'Salvando...' : 'Salvar'}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex flex-col flex-1">
                        <span className="text-[14px] text-vapor-100 font-medium">{item.descricao}</span>
                        {item.observacao && (
                          <span className="text-[12px] text-vapor-400 font-normal mt-0.5">{item.observacao}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleToggleObrigatorioItem(item)}
                          className={`text-[11px] font-bold px-2 py-0.5 rounded border transition-colors ${
                            item.obrigatorio
                              ? 'bg-flare-400/20 text-flare-400 border-flare-400/40'
                              : 'bg-graphite-700 text-vapor-400 border-graphite-600'
                          }`}
                        >
                          {item.obrigatorio ? 'Obrigatório' : 'Opcional'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleIniciarEdicaoItem(item)}
                          className="text-vapor-400 hover:text-amber-400 p-1 transition-colors"
                          title="Editar item"
                        >
                          <Edit size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoverItem(item.id)}
                          className="text-vapor-400 hover:text-flare-400 p-1 transition-colors"
                          title="Excluir item"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
