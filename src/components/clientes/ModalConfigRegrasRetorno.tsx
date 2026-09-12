import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { supabase } from '../../lib/supabase';
import type { RegraRetorno } from '../../types/oportunidades';
import { 
  Plus, 
  Trash2, 
  Save, 
  Clock, 
  MessageSquare, 
  Check, 
  Sparkles
} from 'lucide-react';

interface ModalConfigRegrasRetornoProps {
  isOpen: boolean;
  onClose: () => void;
  onRegrasSalvas: () => void;
}

export const ModalConfigRegrasRetorno: React.FC<ModalConfigRegrasRetornoProps> = ({
  isOpen,
  onClose,
  onRegrasSalvas
}) => {
  const [regras, setRegras] = useState<RegraRetorno[]>([]);
  const [loading, setLoading] = useState(true);
  const [salvandoId, setSalvandoId] = useState<string | null>(null);
  const [sucessoMsg, setSucessoMsg] = useState<string | null>(null);
  const [erroMsg, setErroMsg] = useState<string | null>(null);

  // Formulário de nova regra
  const [showNovaRegra, setShowNovaRegra] = useState(false);
  const [novaRegra, setNovaRegra] = useState({
    titulo: '',
    palavra_chave: '',
    dias_retorno: 60,
    mensagem_whatsapp: 'Olá, {cliente}! Já se passaram {dias} dias da realização do serviço {servico} no seu {veiculo}. Vamos agendar uma manutenção preventiva para esta semana?'
  });
  const [criando, setCriando] = useState(false);

  const carregarRegras = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('listar_regras_retorno');
      if (error) throw error;
      setRegras((data as RegraRetorno[]) || []);
    } catch (err: any) {
      console.error('Erro ao carregar regras de retorno:', err);
      setErroMsg('Erro ao carregar regras: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      carregarRegras();
      setSucessoMsg(null);
      setErroMsg(null);
      setShowNovaRegra(false);
    }
  }, [isOpen]);

  const handleAtualizarRegra = (id: string, campo: keyof RegraRetorno, valor: any) => {
    setRegras(prev => prev.map(r => r.id === id ? { ...r, [campo]: valor } : r));
  };

  const handleSalvarRegra = async (regra: RegraRetorno) => {
    try {
      setSalvandoId(regra.id);
      setErroMsg(null);
      setSucessoMsg(null);

      const { error } = await supabase.rpc('salvar_regra_retorno', {
        p_regra: {
          id: regra.id,
          titulo: regra.titulo,
          servico_id: regra.servico_id || null,
          palavra_chave: regra.palavra_chave || null,
          dias_retorno: Number(regra.dias_retorno) || 60,
          mensagem_whatsapp: regra.mensagem_whatsapp,
          ativo: regra.ativo
        }
      });

      if (error) throw error;

      setSucessoMsg(`Regra "${regra.titulo}" salva com sucesso!`);
      setTimeout(() => setSucessoMsg(null), 3500);
      onRegrasSalvas();
    } catch (err: any) {
      setErroMsg('Erro ao salvar regra: ' + err.message);
    } finally {
      setSalvandoId(null);
    }
  };

  const handleExcluirRegra = async (id: string, titulo: string) => {
    if (!window.confirm(`Deseja realmente excluir a regra de retorno "${titulo}"?`)) return;

    try {
      setSalvandoId(id);
      const { error } = await supabase.rpc('excluir_regra_retorno', { p_regra_id: id });
      if (error) throw error;

      setRegras(prev => prev.filter(r => r.id !== id));
      setSucessoMsg('Regra excluída com sucesso.');
      setTimeout(() => setSucessoMsg(null), 3000);
      onRegrasSalvas();
    } catch (err: any) {
      setErroMsg('Erro ao excluir regra: ' + err.message);
    } finally {
      setSalvandoId(null);
    }
  };

  const handleCriarNovaRegra = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novaRegra.titulo.trim()) {
      setErroMsg('O título da regra é obrigatório.');
      return;
    }

    try {
      setCriando(true);
      setErroMsg(null);

      const { error } = await supabase.rpc('salvar_regra_retorno', {
        p_regra: {
          titulo: novaRegra.titulo.trim(),
          palavra_chave: novaRegra.palavra_chave.trim() || null,
          dias_retorno: Number(novaRegra.dias_retorno) || 60,
          mensagem_whatsapp: novaRegra.mensagem_whatsapp.trim(),
          ativo: true
        }
      });

      if (error) throw error;

      setSucessoMsg(`Nova regra "${novaRegra.titulo}" criada com sucesso!`);
      setShowNovaRegra(false);
      setNovaRegra({
        titulo: '',
        palavra_chave: '',
        dias_retorno: 60,
        mensagem_whatsapp: 'Olá, {cliente}! Já se passaram {dias} dias da realização do serviço {servico} no seu {veiculo}. Vamos agendar uma manutenção preventiva para esta semana?'
      });
      await carregarRegras();
      onRegrasSalvas();
    } catch (err: any) {
      setErroMsg('Erro ao criar regra: ' + err.message);
    } finally {
      setCriando(false);
    }
  };

  const presetsDias = [30, 45, 60, 90, 180];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Prazos e Regras de Manutenção (CRM)"
      maxWidth="3xl"
    >
      <div className="space-y-5">
        {/* Banner Explicativo */}
        <div className="p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-3">
          <Clock className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-vapor-300 space-y-1">
            <p className="font-semibold text-amber-300">
              Personalize o ciclo de manutenção da sua oficina
            </p>
            <p className="leading-relaxed">
              Defina a quantidade de dias para cada serviço (ex: <strong className="text-white">60 dias</strong> para Vitrificação, <strong className="text-white">90 dias</strong> para Higienização). O sistema calcula os clientes que atingiram o prazo e avisa você para chamá-los no WhatsApp!
            </p>
          </div>
        </div>

        {/* Mensagens de Feedback */}
        {sucessoMsg && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs font-semibold text-emerald-300 flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400" />
            <span>{sucessoMsg}</span>
          </div>
        )}

        {erroMsg && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs font-semibold text-rose-300">
            {erroMsg}
          </div>
        )}

        {/* Botão para Nova Regra */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold font-mono uppercase tracking-wider text-vapor-400">
            Regras Ativas ({regras.length})
          </span>
          {!showNovaRegra && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowNovaRegra(true)}
              className="text-xs flex items-center gap-1.5"
            >
              <Plus size={14} />
              <span>Cadastrar Nova Regra</span>
            </Button>
          )}
        </div>

        {/* Formulário de Nova Regra */}
        {showNovaRegra && (
          <form onSubmit={handleCriarNovaRegra} className="p-4 bg-graphite-950 border border-amber-500/30 rounded-xl space-y-3.5 animate-in fade-in duration-150">
            <div className="flex items-center justify-between border-b border-graphite-800 pb-2">
              <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                <Sparkles size={14} />
                Nova Regra de Retorno
              </span>
              <button
                type="button"
                onClick={() => setShowNovaRegra(false)}
                className="text-xs text-vapor-400 hover:text-white"
              >
                Cancelar
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-vapor-300 uppercase mb-1">
                  Nome da Regra *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Manutenção de Vitrificação"
                  value={novaRegra.titulo}
                  onChange={e => setNovaRegra({ ...novaRegra, titulo: e.target.value })}
                  className="w-full bg-graphite-900 border border-graphite-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-vapor-300 uppercase mb-1">
                  Prazo de Retorno (Dias) *
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    required
                    value={novaRegra.dias_retorno}
                    onChange={e => setNovaRegra({ ...novaRegra, dias_retorno: parseInt(e.target.value, 10) || 30 })}
                    className="w-24 bg-graphite-900 border border-graphite-700 rounded-lg px-3 py-2 text-xs text-white font-mono font-bold focus:outline-none focus:border-amber-500"
                  />
                  <span className="text-xs text-vapor-400">dias (~{Math.round(novaRegra.dias_retorno / 30)} meses)</span>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-vapor-300 uppercase mb-1">
                Palavras-chave do Serviço (Opcional)
              </label>
              <input
                type="text"
                placeholder="Ex: vitrifica|coating|ceramica"
                value={novaRegra.palavra_chave}
                onChange={e => setNovaRegra({ ...novaRegra, palavra_chave: e.target.value })}
                className="w-full bg-graphite-900 border border-graphite-700 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-vapor-600 focus:outline-none focus:border-amber-500"
              />
              <span className="text-[10px] text-vapor-500 mt-0.5 block">
                Associa automaticamente a serviços que contenham essas palavras no nome.
              </span>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-vapor-300 uppercase mb-1">
                Mensagem Padrão do WhatsApp
              </label>
              <textarea
                rows={3}
                required
                value={novaRegra.mensagem_whatsapp}
                onChange={e => setNovaRegra({ ...novaRegra, mensagem_whatsapp: e.target.value })}
                className="w-full bg-graphite-900 border border-graphite-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-amber-500"
              />
              <span className="text-[10px] text-vapor-500 block mt-0.5">
                Tags automáticas disponíveis: <code className="text-amber-400 font-mono">{"{cliente}"}</code>, <code className="text-amber-400 font-mono">{"{veiculo}"}</code>, <code className="text-amber-400 font-mono">{"{servico}"}</code>, <code className="text-amber-400 font-mono">{"{dias}"}</code>
              </span>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowNovaRegra(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={criando}
              >
                Salvar Regra
              </Button>
            </div>
          </form>
        )}

        {/* Lista de Regras Existentes */}
        {loading ? (
          <div className="py-8 text-center text-xs text-vapor-400">
            Carregando regras de manutenção...
          </div>
        ) : regras.length === 0 ? (
          <div className="py-8 text-center text-xs text-vapor-400">
            Nenhuma regra cadastrada.
          </div>
        ) : (
          <div className="space-y-4 max-h-[460px] overflow-y-auto pr-1">
            {regras.map((regra) => {
              const isSaving = salvandoId === regra.id;

              return (
                <div 
                  key={regra.id} 
                  className={`p-4 rounded-xl border transition space-y-3 ${
                    regra.ativo 
                      ? 'bg-graphite-900/80 border-graphite-700/80' 
                      : 'bg-graphite-950/40 border-graphite-800 opacity-60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={regra.titulo}
                          onChange={e => handleAtualizarRegra(regra.id, 'titulo', e.target.value)}
                          className="font-semibold text-sm text-white bg-transparent border-b border-transparent hover:border-graphite-600 focus:border-amber-500 focus:bg-graphite-950 px-1 py-0.5 rounded focus:outline-none w-full max-w-sm"
                        />
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border uppercase font-bold ${
                          regra.ativo 
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                            : 'bg-graphite-800 border-graphite-700 text-vapor-400'
                        }`}>
                          {regra.ativo ? 'Ativa' : 'Inativa'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleAtualizarRegra(regra.id, 'ativo', !regra.ativo)}
                        className={`text-xs px-2 py-1 rounded-md border transition ${
                          regra.ativo 
                            ? 'bg-graphite-800 text-vapor-300 border-graphite-700 hover:text-white' 
                            : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                        }`}
                      >
                        {regra.ativo ? 'Desativar' : 'Ativar'}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleExcluirRegra(regra.id, regra.titulo)}
                        title="Excluir regra"
                        className="p-1.5 text-vapor-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-md transition"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  {/* Configuração de Prazos */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-2 border-t border-graphite-800">
                    <div className="sm:col-span-6 space-y-1.5">
                      <label className="block text-[11px] font-semibold text-vapor-400 uppercase">
                        Prazo de Retorno:
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          value={regra.dias_retorno}
                          onChange={e => handleAtualizarRegra(regra.id, 'dias_retorno', parseInt(e.target.value, 10) || 30)}
                          className="w-20 bg-graphite-950 border border-graphite-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono font-bold text-center focus:outline-none focus:border-amber-500"
                        />
                        <span className="text-xs text-vapor-300">
                          dias (~{Math.round(regra.dias_retorno / 30)} meses)
                        </span>
                      </div>

                      {/* Botões Rápidos de Prazos */}
                      <div className="flex flex-wrap gap-1 pt-1">
                        {presetsDias.map((dias) => (
                          <button
                            key={dias}
                            type="button"
                            onClick={() => handleAtualizarRegra(regra.id, 'dias_retorno', dias)}
                            className={`text-[10px] font-mono px-2 py-0.5 rounded transition border ${
                              regra.dias_retorno === dias
                                ? 'bg-amber-500 text-slate-950 font-bold border-amber-500'
                                : 'bg-graphite-950 text-vapor-400 border-graphite-800 hover:text-white'
                            }`}
                          >
                            {dias}d {dias === 60 ? '(2m)' : dias === 90 ? '(3m)' : dias === 180 ? '(6m)' : ''}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="sm:col-span-6 space-y-1.5">
                      <label className="block text-[11px] font-semibold text-vapor-400 uppercase">
                        Palavras-chave de Reconhecimento:
                      </label>
                      <input
                        type="text"
                        value={regra.palavra_chave || ''}
                        onChange={e => handleAtualizarRegra(regra.id, 'palavra_chave', e.target.value)}
                        placeholder="Ex: vitrifica|ceram|coating"
                        className="w-full bg-graphite-950 border border-graphite-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-amber-500"
                      />
                      <span className="text-[10px] text-vapor-500 block">
                        Filtro regex por palavras no nome do serviço
                      </span>
                    </div>
                  </div>

                  {/* Mensagem de WhatsApp */}
                  <div className="space-y-1 pt-1">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-semibold text-vapor-400 uppercase flex items-center gap-1">
                        <MessageSquare size={12} className="text-emerald-400" />
                        <span>Texto da Mensagem no WhatsApp:</span>
                      </label>
                      <span className="text-[10px] text-vapor-500 font-mono">
                        Tags: {"{cliente}"}, {"{veiculo}"}, {"{servico}"}, {"{dias}"}
                      </span>
                    </div>
                    <textarea
                      rows={2}
                      value={regra.mensagem_whatsapp}
                      onChange={e => handleAtualizarRegra(regra.id, 'mensagem_whatsapp', e.target.value)}
                      className="w-full bg-graphite-950 border border-graphite-700 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-amber-500 font-sans"
                    />
                  </div>

                  {/* Botão Salvar Linha */}
                  <div className="flex justify-end pt-1">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      loading={isSaving}
                      onClick={() => handleSalvarRegra(regra)}
                      className="text-xs flex items-center gap-1.5"
                    >
                      <Save size={13} />
                      <span>Salvar Regra</span>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-graphite-800">
          <Button variant="primary" onClick={onClose}>
            Concluir Configurações
          </Button>
        </div>
      </div>
    </Modal>
  );
};
