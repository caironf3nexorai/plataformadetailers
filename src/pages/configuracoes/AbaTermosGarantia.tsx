import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { ModalConfirmacao } from '../../components/ui/ModalConfirmacao';
import { EmptyState } from '../../components/ui/EmptyState';
import {
  ShieldCheck,
  Plus,
  Edit2,
  Trash2,
  Save,
  Sparkles,
  Copy,
} from 'lucide-react';
import type {
  TermoGarantia,
  TipoTermoGarantia,
} from '../../types/termos';
import { TIPOS_TERMOS_GARANTIA } from '../../types/termos';

export const AbaTermosGarantia: React.FC = () => {
  const { tenant } = useAuth();
  const { showSuccess, showError } = useToast();

  const [termos, setTermos] = useState<TermoGarantia[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [tipoFiltro, setTipoFiltro] = useState<string>('todos');

  // Modal de Criação / Edição
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [termoEditando, setTermoEditando] = useState<TermoGarantia | null>(null);
  const [tipo, setTipo] = useState<TipoTermoGarantia>('polimento');
  const [titulo, setTitulo] = useState<string>('');
  const [conteudo, setConteudo] = useState<string>('');
  const [padrao, setPadrao] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  // Carregar termos do tenant
  const carregarTermos = async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('termos_garantia')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: true });

      if (error) {
        // Se a tabela ainda não tiver dados ou erro de RLS, tenta carregar do localStorage
        const salvosLocal = localStorage.getItem(`termos_garantia_${tenant.id}`);
        if (salvosLocal) {
          setTermos(JSON.parse(salvosLocal));
        } else {
          setTermos([]);
        }
      } else {
        setTermos(data as TermoGarantia[]);
      }
    } catch (e: any) {
      console.error('[AbaTermosGarantia] Erro ao carregar:', e);
      const salvosLocal = localStorage.getItem(`termos_garantia_${tenant.id}`);
      if (salvosLocal) {
        setTermos(JSON.parse(salvosLocal));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarTermos();
  }, [tenant?.id]);

  const handleNovoTermo = (tipoInicial: TipoTermoGarantia = 'polimento') => {
    setTermoEditando(null);
    setTipo(tipoInicial);
    const def = TIPOS_TERMOS_GARANTIA.find((t) => t.tipo === tipoInicial);
    setTitulo(def?.label || 'Termo de Garantia');
    setConteudo(def?.placeholder || '');
    setPadrao(false);
    setModalOpen(true);
  };

  const handleEditarTermo = (termo: TermoGarantia) => {
    setTermoEditando(termo);
    setTipo(termo.tipo);
    setTitulo(termo.titulo);
    setConteudo(termo.conteudo);
    setPadrao(Boolean(termo.padrao));
    setModalOpen(true);
  };

  const handleUsarTemplate = (t: typeof TIPOS_TERMOS_GARANTIA[0]) => {
    setTipo(t.tipo);
    setTitulo(t.label);
    setConteudo(t.placeholder);
  };

  const handleSalvarTermo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant || !titulo.trim() || !conteudo.trim()) {
      showError('Preencha o título e o conteúdo do termo de garantia.');
      return;
    }

    setSaving(true);
    try {
      if (termoEditando) {
        const { error } = await supabase
          .from('termos_garantia')
          .update({
            tipo,
            titulo: titulo.trim(),
            conteudo: conteudo.trim(),
            padrao,
            updated_at: new Date().toISOString(),
          })
          .eq('id', termoEditando.id);

        if (error) {
          // Fallback para storage local
          const atualizados = termos.map((item) =>
            item.id === termoEditando.id
              ? { ...item, tipo, titulo: titulo.trim(), conteudo: conteudo.trim(), padrao }
              : item
          );
          setTermos(atualizados);
          localStorage.setItem(`termos_garantia_${tenant.id}`, JSON.stringify(atualizados));
        }
        showSuccess('Termo de garantia atualizado com sucesso!');
      } else {
        const { data, error } = await supabase
          .from('termos_garantia')
          .insert({
            tenant_id: tenant.id,
            tipo,
            titulo: titulo.trim(),
            conteudo: conteudo.trim(),
            padrao,
            ativo: true,
          })
          .select('*')
          .single();

        if (error || !data) {
          const novoLocal: TermoGarantia = {
            id: `local_${Date.now()}`,
            tenant_id: tenant.id,
            tipo,
            titulo: titulo.trim(),
            conteudo: conteudo.trim(),
            padrao,
            ativo: true,
            created_at: new Date().toISOString(),
          };
          const atualizados = [...termos, novoLocal];
          setTermos(atualizados);
          localStorage.setItem(`termos_garantia_${tenant.id}`, JSON.stringify(atualizados));
        } else {
          setTermos((prev) => [...prev, data as TermoGarantia]);
        }
        showSuccess('Novo termo de garantia cadastrado!');
      }

      setModalOpen(false);
      await carregarTermos();
    } catch (err: any) {
      console.error('[Salvar Termo Error]:', err);
      showError('Erro ao salvar termo: ' + (err?.message || err));
    } finally {
      setSaving(false);
    }
  };

  const [termoParaExcluir, setTermoParaExcluir] = useState<string | null>(null);
  const [excluindoTermo, setExcluindoTermo] = useState(false);

  const handleSolicitarExcluirTermo = (id: string) => {
    setTermoParaExcluir(id);
  };

  const executeExcluirTermo = async () => {
    if (!tenant || !termoParaExcluir) return;
    const id = termoParaExcluir;
    setExcluindoTermo(true);

    try {
      await supabase.from('termos_garantia').delete().eq('id', id);
      const restantes = termos.filter((t) => t.id !== id);
      setTermos(restantes);
      localStorage.setItem(`termos_garantia_${tenant.id}`, JSON.stringify(restantes));
      showSuccess('Termo de garantia excluído com sucesso.');
    } catch (e: any) {
      console.error('[Excluir Termo Error]:', e);
      showError('Erro ao excluir termo de garantia.');
    } finally {
      setExcluindoTermo(false);
      setTermoParaExcluir(null);
    }
  };

  const termosFiltrados = tipoFiltro === 'todos' ? termos : termos.filter((t) => t.tipo === tipoFiltro);

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      {/* Header explicativo da aba */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-gradient-to-r from-amber-500/10 via-graphite-900 to-graphite-900 p-5 rounded-xl border border-amber-500/30 shadow-md">
        <div className="flex items-center gap-3.5">
          <div className="p-3 bg-amber-500/20 text-amber-400 rounded-xl border border-amber-500/30">
            <ShieldCheck size={28} />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-vapor-100 uppercase tracking-wide">
              Termos de Garantia Personalizados
            </h2>
            <p className="font-sans text-xs text-vapor-300 leading-relaxed max-w-2xl">
              Crie termos jurídicos e operacionais separados por tipo de serviço (Polimento, Lavagem de Motor, Vitrificação, Microreparos, etc.). Eles podem ser selecionados para inserção automática nos orçamentos e impressões em PDF.
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant="primary"
          onClick={() => handleNovoTermo('polimento')}
          className="shrink-0 min-h-[44px] px-4 font-bold text-xs flex items-center gap-2 bg-gradient-to-r from-amber-500 to-yellow-500 text-graphite-950 shadow-md"
        >
          <Plus size={16} />
          <span>Novo Termo de Garantia</span>
        </Button>
      </div>

      {/* Categorias Rápidas de Modelos (Templates Prontos) */}
      <div className="flex flex-col gap-2">
        <span className="font-sans text-xs uppercase font-semibold text-vapor-400 tracking-wider">
          Modelos Recomendados por Especialidade:
        </span>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {TIPOS_TERMOS_GARANTIA.map((t) => {
            const jaExiste = termos.some((item) => item.tipo === t.tipo);
            return (
              <button
                key={t.tipo}
                type="button"
                onClick={() => handleNovoTermo(t.tipo)}
                className="p-3 rounded-lg bg-graphite-900 border border-graphite-700 hover:border-amber-500/60 transition-all text-left flex flex-col justify-between group"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold font-sans text-xs text-vapor-200 group-hover:text-amber-400">
                    {t.label}
                  </span>
                  {jaExiste && (
                    <span className="w-2 h-2 rounded-full bg-emerald-400" title="Já possui termo configurado" />
                  )}
                </div>
                <span className="font-sans text-[11px] text-vapor-400 line-clamp-1 mt-1">
                  {t.descricao}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filtro por Tipo */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setTipoFiltro('todos')}
          className={`px-3 py-1.5 rounded-lg font-sans text-xs font-semibold whitespace-nowrap transition-colors ${
            tipoFiltro === 'todos'
              ? 'bg-amber-500 text-graphite-950 shadow'
              : 'bg-graphite-800 text-vapor-300 hover:bg-graphite-700'
          }`}
        >
          Todos ({termos.length})
        </button>
        {TIPOS_TERMOS_GARANTIA.map((t) => (
          <button
            key={t.tipo}
            type="button"
            onClick={() => setTipoFiltro(t.tipo)}
            className={`px-3 py-1.5 rounded-lg font-sans text-xs font-semibold whitespace-nowrap transition-colors ${
              tipoFiltro === t.tipo
                ? 'bg-amber-500 text-graphite-950 shadow'
                : 'bg-graphite-800 text-vapor-300 hover:bg-graphite-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Lista de Termos Cadastrados */}
      {loading ? (
        <div className="flex flex-col gap-3 py-6">
          <div className="h-20 bg-graphite-800 rounded-lg animate-pulse" />
          <div className="h-20 bg-graphite-800 rounded-lg animate-pulse" />
        </div>
      ) : termosFiltrados.length === 0 ? (
        <div className="flex flex-col items-center">
          <EmptyState
            title="Nenhum termo de garantia cadastrado nesta categoria"
            description="Clique em 'Novo Termo de Garantia' ou escolha um dos modelos acima para criar as diretrizes de garantia da sua oficina."
            icon={<ShieldCheck size={36} />}
          />
          <Button
            type="button"
            variant="primary"
            onClick={() => handleNovoTermo('polimento')}
            className="text-xs font-bold -mt-6"
          >
            Criar Primeiro Termo
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {termosFiltrados.map((termo) => {
            const rotuloTipo = TIPOS_TERMOS_GARANTIA.find((t) => t.tipo === termo.tipo)?.label || termo.tipo;
            return (
              <Card
                key={termo.id}
                className="p-4 bg-graphite-900 border-graphite-700 flex flex-col justify-between gap-3 shadow-md"
              >
                <div className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col">
                      <span className="font-mono text-[11px] font-bold text-amber-400 uppercase tracking-wider">
                        {rotuloTipo}
                      </span>
                      <h3 className="font-sans text-sm font-bold text-vapor-100">{termo.titulo}</h3>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleEditarTermo(termo)}
                        className="p-1.5 text-vapor-400 hover:text-amber-400 hover:bg-graphite-800 rounded transition-colors"
                        title="Editar Termo"
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSolicitarExcluirTermo(termo.id)}
                        className="p-1.5 text-vapor-400 hover:text-flare-400 hover:bg-graphite-800 rounded transition-colors"
                        title="Excluir Termo"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  <p className="font-sans text-xs text-vapor-300 leading-relaxed whitespace-pre-line line-clamp-4 bg-graphite-950/60 p-2.5 rounded-lg border border-graphite-800/80">
                    {termo.conteudo}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-graphite-800 text-[11px] font-mono text-vapor-400">
                  <span>{termo.padrao ? '⭐ Termo Padrão' : 'Termo Ativo'}</span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(termo.conteudo);
                      showSuccess('Texto copiado para a área de transferência!');
                    }}
                    className="flex items-center gap-1 text-amber-400 hover:text-amber-300"
                  >
                    <Copy size={12} />
                    <span>Copiar Texto</span>
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal de Criação / Edição do Termo */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={termoEditando ? 'Editar Termo de Garantia' : 'Cadastrar Termo de Garantia'}
        maxWidth="lg"
        icon={<ShieldCheck className="text-amber-500" size={22} />}
      >
        <form onSubmit={handleSalvarTermo} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-vapor-300 uppercase tracking-wide">
                Tipo / Categoria do Serviço:
              </label>
              <select
                value={tipo}
                onChange={(e) => {
                  const novoTipo = e.target.value as TipoTermoGarantia;
                  setTipo(novoTipo);
                  const def = TIPOS_TERMOS_GARANTIA.find((t) => t.tipo === novoTipo);
                  if (def && (!conteudo || conteudo === TIPOS_TERMOS_GARANTIA.find((x) => x.tipo === tipo)?.placeholder)) {
                    setTitulo(def.label);
                    setConteudo(def.placeholder);
                  }
                }}
                className="w-full bg-graphite-900 border border-graphite-700 rounded-lg p-2.5 text-vapor-100 font-sans text-sm outline-none focus:border-amber-500"
              >
                {TIPOS_TERMOS_GARANTIA.map((t) => (
                  <option key={t.tipo} value={t.tipo}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-vapor-300 uppercase tracking-wide">
                Título do Termo:
              </label>
              <Input
                type="text"
                placeholder="Ex: Garantia de Polimento e Correção de Verniz"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                required
                className="min-h-[42px]"
              />
            </div>
          </div>

          {/* Botão de Sugestão / Template Rápido */}
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-vapor-300 uppercase tracking-wide">
              Texto Legal do Termo e Condições:
            </label>
            <button
              type="button"
              onClick={() => {
                const def = TIPOS_TERMOS_GARANTIA.find((t) => t.tipo === tipo);
                if (def) handleUsarTemplate(def);
              }}
              className="text-[11px] text-amber-400 hover:text-amber-300 flex items-center gap-1 font-semibold"
            >
              <Sparkles size={13} />
              <span>Usar Texto Padrão Recomendado</span>
            </button>
          </div>

          <textarea
            rows={7}
            placeholder="Digite o texto detalhado da garantia, condições de perda de garantia, prazos e orientações pós-serviço para o cliente..."
            value={conteudo}
            onChange={(e) => setConteudo(e.target.value)}
            required
            className="w-full bg-graphite-900 border border-graphite-700 rounded-lg p-3 text-vapor-100 placeholder-vapor-600 font-sans text-xs leading-relaxed outline-none focus:border-amber-500"
          />

          <label className="flex items-center gap-2 text-xs font-sans text-vapor-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={padrao}
              onChange={(e) => setPadrao(e.target.checked)}
              className="w-4 h-4 rounded bg-graphite-900 border-graphite-700 text-amber-500 focus:ring-0"
            />
            <span>Definir como termo padrão sugerido em orçamentos</span>
          </label>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-graphite-800">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModalOpen(false)}
              disabled={saving}
              className="text-xs h-10 px-4"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={saving}
              className="text-xs font-bold h-10 px-5 flex items-center gap-2 bg-gradient-to-r from-amber-500 to-yellow-500 text-graphite-950"
            >
              <Save size={15} />
              <span>{saving ? 'Salvando...' : 'Salvar Termo'}</span>
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal de Confirmação para Excluir Termo */}
      <ModalConfirmacao
        isOpen={Boolean(termoParaExcluir)}
        onClose={() => setTermoParaExcluir(null)}
        onConfirm={executeExcluirTermo}
        titulo="Excluir Termo de Garantia"
        mensagem="Deseja realmente remover este termo de garantia? Ele não será mais sugerido automaticamente na geração de propostas e orçamentos."
        textoConfirmar="Excluir Termo"
        textoCancelar="Cancelar"
        variant="danger"
        loading={excluindoTermo}
      />
    </div>
  );
};
