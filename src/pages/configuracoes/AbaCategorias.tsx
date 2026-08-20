import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import type { CategoriaVeiculo } from '../../types/clientes';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Edit2,
  Plus,
  Tag,
} from 'lucide-react';

export const AbaCategorias: React.FC = () => {
  const { tenant } = useAuth();
  const [categorias, setCategorias] = useState<CategoriaVeiculo[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Estado Modal Criar/Editar
  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoriaVeiculo | null>(null);
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [saving, setSaving] = useState(false);

  // Estado para desativação com confirmação/aviso
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);

  const fetchCategorias = async () => {
    if (!tenant) return;
    setLoading(true);

    try {
      const { data, error } = await supabase
        .from('categorias_veiculo')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('ordem', { ascending: true });

      if (!error && data) {
        setCategorias(data as CategoriaVeiculo[]);
      }
    } catch (err) {
      console.error('Erro ao carregar categorias:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCategorias();
  }, [tenant?.id]);

  const handleOpenCreateModal = () => {
    setEditingCategory(null);
    setNome('');
    setDescricao('');
    setErrorMsg(null);
    setShowModal(true);
  };

  const handleOpenEditModal = (cat: CategoriaVeiculo) => {
    setEditingCategory(cat);
    setNome(cat.nome);
    setDescricao(cat.descricao || '');
    setErrorMsg(null);
    setShowModal(true);
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant || !nome.trim()) return;
    setSaving(true);
    setErrorMsg(null);

    try {
      if (editingCategory) {
        // Update
        const { error } = await supabase
          .from('categorias_veiculo')
          .update({
            nome: nome.trim(),
            descricao: descricao.trim() || null,
          })
          .eq('id', editingCategory.id);

        if (error) throw error;
      } else {
        // Insert
        const novaOrdem = categorias.length;
        const { error } = await supabase.from('categorias_veiculo').insert({
          tenant_id: tenant.id,
          nome: nome.trim(),
          descricao: descricao.trim() || null,
          ordem: novaOrdem,
          ativo: true,
        });

        if (error) throw error;
      }

      setShowModal(false);
      await fetchCategorias();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao salvar categoria.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleAtivo = async (cat: CategoriaVeiculo) => {
    try {
      const { error } = await supabase
        .from('categorias_veiculo')
        .update({ ativo: !cat.ativo })
        .eq('id', cat.id);

      if (!error) {
        setDeactivatingId(null);
        await fetchCategorias();
      }
    } catch (err) {
      console.error('Erro ao alterar status da categoria:', err);
    }
  };

  const handleMove = async (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= categorias.length) return;

    const newArr = [...categorias];
    const [moved] = newArr.splice(index, 1);
    newArr.splice(targetIndex, 0, moved);

    setCategorias(newArr);

    // Envia array reordenado para RPC atômica reordenar_categorias
    const ids = newArr.map((c) => c.id);
    try {
      const { error } = await supabase.rpc('reordenar_categorias', { p_ids: ids });
      if (error) {
        console.error('[Reordenar Categorias Error]:', error);
        await fetchCategorias();
      }
    } catch (err) {
      console.error('[Reordenar Categorias Exception]:', err);
      await fetchCategorias();
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {/* Texto de Apoio no Topo */}
      <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center gap-3 text-amber-500">
        <Tag size={24} className="shrink-0" />
        <p className="font-sans text-[13px] leading-relaxed">
          As categorias definem o preço dos seus serviços. Uma lavagem em caminhonete custa mais que em hatch.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="font-display text-[18px] text-vapor-100 uppercase tracking-wide">
          Categorias de Veículo ({categorias.length})
        </h3>
        <Button type="button" variant="primary" onClick={handleOpenCreateModal} className="min-h-[40px] px-3">
          <Plus size={16} />
          Nova Categoria
        </Button>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 bg-graphite-800 rounded animate-pulse" />
          ))}
        </div>
      ) : categorias.length === 0 ? (
        <Card className="p-6 bg-graphite-800 border-graphite-600 text-center">
          <p className="font-sans text-[14px] text-vapor-400 italic">Nenhuma categoria cadastrada.</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {categorias.map((cat, idx) => (
            <Card
              key={cat.id}
              className={`p-4 bg-graphite-800 border-graphite-600 flex items-center justify-between gap-4 transition-all ${
                !cat.ativo ? 'opacity-50' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                {/* Botões de Reordenação */}
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => handleMove(idx, 'up')}
                    disabled={idx === 0}
                    className="p-1 text-vapor-400 hover:text-amber-500 disabled:opacity-20 disabled:hover:text-vapor-400 transition-colors"
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMove(idx, 'down')}
                    disabled={idx === categorias.length - 1}
                    className="p-1 text-vapor-400 hover:text-amber-500 disabled:opacity-20 disabled:hover:text-vapor-400 transition-colors"
                  >
                    <ArrowDown size={14} />
                  </button>
                </div>

                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="font-sans text-[15px] font-bold text-vapor-100">{cat.nome}</span>
                    <Badge tone={cat.ativo ? 'mint' : 'glass'}>
                      {cat.ativo ? 'ATIVA' : 'INATIVA'}
                    </Badge>
                  </div>
                  {cat.descricao && (
                    <span className="font-sans text-[12px] text-vapor-400 mt-0.5">{cat.descricao}</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleOpenEditModal(cat)}
                  className="p-2 text-vapor-400 hover:text-vapor-100 hover:bg-graphite-700 rounded transition-colors"
                >
                  <Edit2 size={16} />
                </button>

                {cat.ativo ? (
                  <button
                    type="button"
                    onClick={() => setDeactivatingId(cat.id)}
                    className="px-2.5 py-1 text-[12px] font-sans bg-flare-400/10 text-flare-400 hover:bg-flare-400/20 border border-flare-400/30 rounded transition-colors"
                  >
                    Desativar
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleToggleAtivo(cat)}
                    className="px-2.5 py-1 text-[12px] font-sans bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30 rounded transition-colors"
                  >
                    Ativar
                  </button>
                )}
              </div>

              {/* Confirmador de Desativação */}
              {deactivatingId === cat.id && (
                <div className="absolute inset-0 z-10 bg-graphite-900/95 p-4 rounded border border-flare-400/40 flex items-center justify-between gap-4">
                  <p className="font-sans text-[12px] text-flare-400 leading-snug">
                    <strong>Aviso:</strong> Veículos nesta categoria continuam cadastrados, mas ela não aparecerá em novos cadastros.
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button type="button" variant="ghost" onClick={() => setDeactivatingId(null)} className="min-h-[32px] px-2 text-[12px]">
                      Cancelar
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      onClick={() => handleToggleAtivo(cat)}
                      className="min-h-[32px] px-3 text-[12px] bg-flare-400 hover:bg-flare-500 text-white border-none"
                    >
                      Confirmar
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Modal Criar / Editar Categoria */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingCategory ? 'Editar Categoria' : 'Nova Categoria'}
        icon={<Tag size={20} className="text-amber-500" />}
        maxWidth="md"
      >
        {errorMsg && (
          <div className="p-3 bg-flare-400/10 border border-flare-400/30 rounded text-flare-400 text-[13px] flex items-center gap-2">
            <AlertTriangle size={16} />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSaveCategory} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-vapor-400 font-medium">Nome da Categoria *</label>
            <Input
              type="text"
              placeholder="Ex: SUV / Picape Média"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              autoFocus
              className="min-h-[44px]"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-vapor-400 font-medium">Exemplos / Descrição</label>
            <Input
              type="text"
              placeholder="Ex: Compass, Corolla Cross, HRV"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              className="min-h-[44px]"
            />
          </div>

          <div className="flex justify-end gap-2 mt-2 pt-3 border-t border-graphite-700">
            <Button type="button" variant="ghost" onClick={() => setShowModal(false)} className="min-h-[44px]">
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={saving} className="min-h-[44px]">
              <Check size={18} />
              {saving ? 'Salvando...' : 'Salvar Categoria'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
