import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { CampoNumerico } from '../ui/CampoNumerico';
import { ServiceChip } from '../ui/ServiceChip';
import { ModalConfirmacao } from '../ui/ModalConfirmacao';
import { 
  Plus, 
  Package, 
  Pencil, 
  Trash2, 
  Globe, 
  AlertTriangle, 
  Check, 
  Sparkles
} from 'lucide-react';
import type { Combo, Servico, CategoriaVeiculo } from '../../types/servicos';
import { formatValorMoeda } from '../../utils/precos';

interface ComboComDetalhes extends Combo {
  combo_servicos: {
    id: string;
    combo_id: string;
    servico_id: string;
    ordem: number;
    servicos?: Servico;
    servico?: Servico;
  }[];
  combo_precos: {
    id: string;
    tenant_id?: string;
    combo_id: string;
    categoria_id: string;
    preco_base?: number | null;
    preco?: number;
  }[];
}

export const GerenciadorCombos: React.FC = () => {
  const { tenant } = useAuth();
  const [combos, setCombos] = useState<ComboComDetalhes[]>([]);
  const [servicosDisponiveis, setServicosDisponiveis] = useState<Servico[]>([]);
  const [categorias, setCategorias] = useState<CategoriaVeiculo[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // State Modal Form
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCombo, setEditingCombo] = useState<ComboComDetalhes | null>(null);
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [publico, setPublico] = useState(true);
  const [ativo, setAtivo] = useState(true);
  const [selectedServicoIds, setSelectedServicoIds] = useState<string[]>([]);
  const [precosPorCategoria, setPrecosPorCategoria] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  // State Delete Confirmation
  const [deletingComboId, setDeletingComboId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchCombos = async () => {
    if (!tenant) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      // 1. Fetch combos with services & category prices
      const { data: combosData, error: cErr } = await supabase
        .from('combos')
        .select(`
          *,
          combo_servicos(*, servicos(*)),
          combo_precos(*)
        `)
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false });

      if (cErr) throw cErr;
      setCombos(combosData as ComboComDetalhes[] || []);

      // 2. Fetch available active services
      const { data: servsData } = await supabase
        .from('servicos')
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('ativo', true)
        .order('nome');

      setServicosDisponiveis(servsData || []);

      // 3. Fetch categories
      const { data: catData } = await supabase
        .from('categorias_veiculo')
        .select('*')
        .order('ordem');

      setCategorias(catData || []);
    } catch (err: any) {
      console.error('[GerenciadorCombos Error]:', err);
      setErrorMsg(err.message || 'Erro ao carregar combos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCombos();
  }, [tenant?.id]);

  const handleOpenModal = (comboToEdit?: ComboComDetalhes) => {
    setErrorMsg(null);
    if (comboToEdit) {
      setEditingCombo(comboToEdit);
      setNome(comboToEdit.nome);
      setDescricao(comboToEdit.descricao_publica || '');
      setPublico(comboToEdit.publico);
      setAtivo(comboToEdit.ativo);
      setSelectedServicoIds(comboToEdit.combo_servicos.map((cs) => cs.servico_id));

      const mapPrecos: Record<string, number> = {};
      comboToEdit.combo_precos.forEach((cp) => {
        mapPrecos[cp.categoria_id] = Number(cp.preco);
      });
      setPrecosPorCategoria(mapPrecos);
    } else {
      setEditingCombo(null);
      setNome('');
      setDescricao('');
      setPublico(true);
      setAtivo(true);
      setSelectedServicoIds([]);
      setPrecosPorCategoria({});
    }
    setIsModalOpen(true);
  };

  const handleToggleServicoSelection = (servicoId: string) => {
    setSelectedServicoIds((prev) =>
      prev.includes(servicoId) ? prev.filter((id) => id !== servicoId) : [...prev, servicoId]
    );
  };


  const handleSaveCombo = async () => {
    if (!nome.trim()) {
      setErrorMsg('O nome do combo é obrigatório.');
      return;
    }
    if (selectedServicoIds.length < 2) {
      setErrorMsg('Selecione pelo menos 2 serviços para formar um combo.');
      return;
    }

    if (!tenant) return;

    setSaving(true);
    setErrorMsg(null);

    try {
      let comboId = editingCombo?.id;

      if (editingCombo) {
        // Update combo info
        const { error: uErr } = await supabase
          .from('combos')
          .update({
            nome: nome.trim(),
            descricao_publica: descricao.trim() || null,
            publico,
            ativo,
            updated_at: new Date().toISOString()
          })
          .eq('id', editingCombo.id);

        if (uErr) throw uErr;
      } else {
        // Insert combo
        const { data: newCombo, error: iErr } = await supabase
          .from('combos')
          .insert({
            tenant_id: tenant.id,
            nome: nome.trim(),
            descricao_publica: descricao.trim() || null,
            publico,
            ativo
          })
          .select()
          .single();

        if (iErr) throw iErr;
        comboId = newCombo.id;
      }

      if (comboId) {
        // Sync combo_servicos
        await supabase.from('combo_servicos').delete().eq('combo_id', comboId);
        
        const comboServicosInsert = selectedServicoIds.map((servico_id, index) => ({
          combo_id: comboId,
          servico_id,
          ordem: index + 1
        }));

        const { error: csErr } = await supabase.from('combo_servicos').insert(comboServicosInsert);
        if (csErr) throw csErr;

        // Sync combo_precos
        await supabase.from('combo_precos').delete().eq('combo_id', comboId);

        const comboPrecosInsert = Object.entries(precosPorCategoria)
          .filter(([_, preco]) => preco > 0)
          .map(([categoria_id, preco]) => ({
            combo_id: comboId,
            categoria_id,
            preco
          }));

        if (comboPrecosInsert.length > 0) {
          const { error: cpErr } = await supabase.from('combo_precos').insert(comboPrecosInsert);
          if (cpErr) throw cpErr;
        }
      }

      setIsModalOpen(false);
      await fetchCombos();
    } catch (err: any) {
      console.error('[Save Combo Error]:', err);
      setErrorMsg(err.message || 'Erro ao salvar combo.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCombo = async () => {
    if (!deletingComboId) return;
    setDeleting(true);
    setErrorMsg(null);

    try {
      const { error } = await supabase.from('combos').delete().eq('id', deletingComboId);
      if (error) throw error;

      setDeletingComboId(null);
      await fetchCombos();
    } catch (err: any) {
      console.error('[Delete Combo Error]:', err);
      setErrorMsg(err.message || 'Erro ao remover combo.');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="py-8 text-center font-sans text-[13px] text-vapor-400">
        Carregando combos e pacotes...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Dynamic Header & Actions */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-[16px] text-vapor-100 uppercase tracking-wide flex items-center gap-2">
            <Package className="text-amber-500" size={18} />
            Combos & Pacotes Promocionais ({combos.length})
          </h2>
          <p className="font-sans text-[13px] text-vapor-400">
            Combine serviços populares com preços especiais para atrair mais agendamentos.
          </p>
        </div>

        <Button
          type="button"
          variant="primary"
          onClick={() => handleOpenModal()}
          className="font-semibold shrink-0"
        >
          <Plus size={16} />
          Criar Novo Combo
        </Button>
      </div>

      {errorMsg && (
        <div className="p-3.5 bg-flare-400/10 border border-flare-400/30 rounded flex items-center gap-2 text-flare-400 text-[13px]">
          <AlertTriangle size={18} className="shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Combos Grid */}
      {combos.length === 0 ? (
        <Card className="p-8 bg-graphite-900 border-graphite-800 text-center flex flex-col items-center gap-3">
          <Package size={32} className="text-vapor-500" />
          <span className="font-display text-[15px] text-vapor-200 uppercase font-bold">
            Nenhum combo cadastrado
          </span>
          <span className="font-sans text-[13px] text-vapor-400 max-w-md">
            Combos incentivam seus clientes a contratar pacotes completos (ex: Lavagem + Polimento + Cristalização).
          </span>
          <Button
            type="button"
            variant="primary"
            onClick={() => handleOpenModal()}
            className="mt-2 font-semibold"
          >
            Criar Primeiro Combo
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {combos.map((combo) => {
            const numServicos = combo.combo_servicos.length;
            const minPreco = combo.combo_precos.length > 0 
              ? Math.min(...combo.combo_precos.map((p) => Number(p.preco ?? p.preco_base ?? 0)))
              : null;

            return (
              <Card
                key={combo.id}
                className={`p-4 bg-graphite-800 border-graphite-700 hover:border-graphite-600 flex flex-col justify-between gap-4 transition-all ${
                  !combo.ativo ? 'opacity-60 bg-graphite-950/40' : ''
                }`}
              >
                <div className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="font-display text-[16px] font-bold text-vapor-100">
                          {combo.nome}
                        </span>
                        {combo.publico && (
                          <Badge tone="mint">
                            <span className="flex items-center gap-1">
                              <Globe size={10} /> Público
                            </span>
                          </Badge>
                        )}
                        {!combo.ativo && (
                          <Badge tone="flare">Inativo</Badge>
                        )}
                      </div>
                      {combo.descricao_publica && (
                        <p className="font-sans text-[12px] text-vapor-400 line-clamp-2">
                          {combo.descricao_publica}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleOpenModal(combo)}
                        className="p-1.5 rounded hover:bg-graphite-700 text-vapor-400 hover:text-amber-400 transition-colors"
                        title="Editar combo"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingComboId(combo.id)}
                        className="p-1.5 rounded hover:bg-graphite-700 text-vapor-400 hover:text-flare-400 transition-colors"
                        title="Excluir combo"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  {/* Included Services */}
                  <div className="flex flex-col gap-1.5 pt-2 border-t border-graphite-700/60">
                    <span className="font-sans text-[11px] text-vapor-400 uppercase tracking-wider font-semibold">
                      Serviços inclusos ({numServicos}):
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {combo.combo_servicos.map((cs) => (
                        <ServiceChip
                          key={cs.id}
                          code={cs.servicos?.codigo || 'SV'}
                          label={cs.servicos?.nome || 'Serviço'}
                          tone={cs.servicos?.tom as any || 'vapor'}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Footer Pricing Summary */}
                <div className="flex items-center justify-between pt-3 border-t border-graphite-700">
                  <span className="font-sans text-[12px] text-vapor-400">Preço do Combo:</span>
                  <span className="font-mono text-[15px] font-bold text-amber-400">
                    {minPreco !== null ? `A partir de R$ ${formatValorMoeda(minPreco)}` : 'Preço individual'}
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal Criar / Editar Combo */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingCombo ? 'Editar Combo' : 'Novo Combo de Serviços'}
        subtitle="Combine serviços para criar ofertas exclusivas"
        icon={<Sparkles size={20} className="text-amber-500" />}
        maxWidth="lg"
      >
        <div className="flex flex-col gap-5">
          {errorMsg && (
            <div className="p-3 bg-flare-500/10 border border-flare-500/30 rounded text-flare-400 font-sans text-[12px] flex items-center gap-2">
              <AlertTriangle size={16} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[11px] text-vapor-400 uppercase tracking-wider">
              Nome do Combo *
            </label>
            <input
              type="text"
              placeholder="Ex: Combo Proteção Total (Lavagem + Polimento)"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="bg-graphite-800 border border-graphite-700 rounded px-3 py-2 text-vapor-100 font-sans text-[13px] outline-none focus:border-amber-500 min-h-[44px]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[11px] text-vapor-400 uppercase tracking-wider">
              Descrição Pública
            </label>
            <textarea
              rows={2}
              placeholder="Descreva as vantagens deste combo para seus clientes..."
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              className="bg-graphite-800 border border-graphite-700 rounded p-2.5 text-vapor-100 font-sans text-[12px] outline-none focus:border-amber-500"
            />
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer select-none font-sans text-[13px] text-vapor-200">
              <input
                type="checkbox"
                checked={publico}
                onChange={(e) => setPublico(e.target.checked)}
                className="w-4 h-4 accent-amber-500 rounded bg-graphite-800 border-graphite-600"
              />
              <span>Exibir no catálogo público</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer select-none font-sans text-[13px] text-vapor-200">
              <input
                type="checkbox"
                checked={ativo}
                onChange={(e) => setAtivo(e.target.checked)}
                className="w-4 h-4 accent-amber-500 rounded bg-graphite-800 border-graphite-600"
              />
              <span>Ativo para agendamento</span>
            </label>
          </div>

          {/* Seleção de Serviços */}
          <div className="flex flex-col gap-2">
            <label className="font-mono text-[11px] text-vapor-400 uppercase tracking-wider">
              Serviços Inclusos (Mínimo 2) *
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto p-1 bg-graphite-900 rounded border border-graphite-800">
              {servicosDisponiveis.map((s) => {
                const isSelected = selectedServicoIds.includes(s.id);
                return (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => handleToggleServicoSelection(s.id)}
                    className={`p-2 rounded border text-left flex items-center justify-between transition-colors min-h-[40px] ${
                      isSelected
                        ? 'bg-amber-500/15 border-amber-500 text-amber-300'
                        : 'bg-graphite-800 hover:bg-graphite-750 border-graphite-700 text-vapor-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <ServiceChip code={s.codigo} tone={s.tom as any || 'vapor'} />
                      <span className="font-sans text-[12px] font-medium truncate">{s.nome}</span>
                    </div>
                    {isSelected && <Check size={16} className="text-amber-400 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Preços por Categoria */}
          <div className="flex flex-col gap-2 pt-2 border-t border-graphite-700">
            <label className="font-mono text-[11px] text-vapor-400 uppercase tracking-wider">
              Preço Promocional por Categoria (R$)
            </label>
            <p className="font-sans text-[11px] text-vapor-500">
              Deixe em branco ou 0 para usar a soma dos preços individuais dos serviços.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {categorias.map((cat) => (
                <div key={cat.id} className="flex items-center justify-between bg-graphite-800 p-2 rounded border border-graphite-700">
                  <span className="font-sans text-[12px] text-vapor-200">{cat.nome}</span>
                  <CampoNumerico
                    prefix="R$"
                    placeholder="0,00"
                    value={precosPorCategoria[cat.id] ?? ''}
                    onChange={(val) => {
                      setPrecosPorCategoria((prev) => ({
                        ...prev,
                        [cat.id]: val || 0
                      }));
                    }}
                    align="right"
                    wrapperClassName="w-28 min-h-[36px]"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-graphite-700">
            <Button type="button" variant="secondary" onClick={() => setIsModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={saving}
              onClick={handleSaveCombo}
              className="font-semibold"
            >
              {saving ? 'Salvando...' : editingCombo ? 'Salvar Alterações' : 'Criar Combo'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal Confirmar Exclusão */}
      <ModalConfirmacao
        isOpen={!!deletingComboId}
        onClose={() => setDeletingComboId(null)}
        onConfirm={handleDeleteCombo}
        title="Excluir Combo"
        mensagem="Tem certeza que deseja remover este combo? Isso não afetará agendamentos passados criados com ele."
        textoConfirmar="Excluir"
        textoCancelar="Cancelar"
        variant="danger"
        loading={deleting}
      />
    </div>
  );
};
