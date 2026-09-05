import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAdminAuth } from '../../components/admin/AdminGuard';
import { 
  Save, 
  Infinity,
  Plus,
  X,
  Layers,
  Sliders,
  Check,
  Ban
} from 'lucide-react';
import { CampoNumerico } from '../../components/ui/CampoNumerico';

interface CatalogoItem {
  chave: string;
  nome: string;
  descricao: string | null;
  grupo: string;
  ordem: number;
}

interface PlanCompleto {
  codigo: string;
  nome: string;
  preco_centavos: number;
  ativo: boolean;
  features: Record<string, boolean>;
  limites: Record<string, number | null>;
}

export const AdminPlanos: React.FC = () => {
  const { adminLevel } = useAdminAuth();
  const isReadOnly = adminLevel === 'suporte';

  const [catalogo, setCatalogo] = useState<CatalogoItem[]>([]);
  const [planos, setPlanos] = useState<PlanCompleto[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingPlanCode, setSavingPlanCode] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Estado de edição por código do plano
  const [editState, setEditState] = useState<Record<string, {
    nome: string;
    preco_reais: string;
    ativo: boolean;
    features: Record<string, boolean>;
    limites: Record<string, { valor: string; ilimitado: boolean }>;
  }>>({});

  // Recursos numéricos padrão do sistema
  const RECURSOS_PADRAO = [
    { chave: 'clientes', nome: 'Clientes Cadastrados', grupo: 'Base de Dados' },
    { chave: 'agendamentos', nome: 'Agendamentos / Mês', grupo: 'Operacional' },
    { chave: 'execucoes', nome: 'Vistorias / Execuções por Mês', grupo: 'Operacional' },
    { chave: 'membros', nome: 'Membros / Operadores da Equipe', grupo: 'Gestão' },
    { chave: 'servicos', nome: 'Serviços / Produtos no Catálogo', grupo: 'Catálogo' },
    { chave: 'retencao_fotos_execucao_dias', nome: 'Retenção de Fotos (Dias)', grupo: 'Armazenamento' },
    { chave: 'atendimentos_preservados_limite', nome: 'Atendimentos Preservados (Cota Fotos)', grupo: 'Armazenamento' },
  ];

  const fetchDadosCompletos = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('admin_listar_planos_completos');
      if (error) throw error;

      const cat: CatalogoItem[] = data.catalogo || [];
      const list: PlanCompleto[] = data.planos || [];

      setCatalogo(cat);

      // Ordenação: free -> pro -> studio -> outros
      const orderPriority: Record<string, number> = { free: 1, pro: 2, studio: 3 };
      const sortedList = list.sort((a, b) => {
        const pA = orderPriority[a.codigo.toLowerCase()] ?? 99;
        const pB = orderPriority[b.codigo.toLowerCase()] ?? 99;
        if (pA !== pB) return pA - pB;
        return a.codigo.localeCompare(b.codigo);
      });

      setPlanos(sortedList);

      // Popular estado de edição
      const initialEdits: typeof editState = {};
      sortedList.forEach((p) => {
        // Features
        const featMap: Record<string, boolean> = { ...p.features };
        cat.forEach((c) => {
          if (featMap[c.chave] === undefined) {
            featMap[c.chave] = p.codigo !== 'free';
          }
        });

        // Limites
        const limMap: Record<string, { valor: string; ilimitado: boolean }> = {};
        
        // Incluir recursos padrão e do catálogo
        const todosRecursos = [
          ...RECURSOS_PADRAO.map(r => r.chave),
          ...cat.map(c => c.chave)
        ];

        todosRecursos.forEach((rec) => {
          const val = p.limites[rec];
          limMap[rec] = {
            valor: val !== null && val !== undefined ? String(val) : '',
            ilimitado: val === null || val === undefined
          };
        });

        initialEdits[p.codigo] = {
          nome: p.nome,
          preco_reais: (p.preco_centavos / 100).toFixed(2).replace('.', ','),
          ativo: p.ativo,
          features: featMap,
          limites: limMap
        };
      });

      setEditState(initialEdits);
    } catch (err: any) {
      console.error('[AdminPlanos] Erro ao carregar dados dos planos:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const [bloqueioAtivo, setBloqueioAtivo] = useState(false);
  const [alterandoBloqueio, setAlterandoBloqueio] = useState(false);

  const fetchConfigPlataforma = async () => {
    try {
      const { data } = await supabase.rpc('obter_config_plataforma');
      if (data && typeof data.bloqueio_planos_ativo === 'boolean') {
        setBloqueioAtivo(data.bloqueio_planos_ativo);
      }
    } catch (err) {
      console.error('Erro ao buscar configuracao da plataforma:', err);
    }
  };

  const handleToggleBloqueio = async (novoValor: boolean) => {
    if (isReadOnly) return;
    setAlterandoBloqueio(true);
    try {
      const { error } = await supabase.rpc('admin_alterar_bloqueio_planos', {
        p_ativo: novoValor
      });
      if (error) throw error;
      setBloqueioAtivo(novoValor);
      setMsg({
        type: 'success',
        text: `Chave Central de Bloqueio ${novoValor ? 'ATIVADA (Impedindo acessos excedidos)' : 'DESATIVADA (Modo Aviso Beta)'}. Registro salvo em auditoria.`
      });
    } catch (err: any) {
      setMsg({ type: 'error', text: 'Erro ao alterar chave de bloqueio: ' + err.message });
    } finally {
      setAlterandoBloqueio(false);
    }
  };

  useEffect(() => {
    fetchDadosCompletos();
    fetchConfigPlataforma();
  }, []);

  // Salvar um plano completo (Preço, Ativo, Features e Limites Numéricos)
  const handleSavePlan = async (codigo: string) => {
    if (isReadOnly) return;
    const item = editState[codigo];
    if (!item) return;

    setSavingPlanCode(codigo);
    setMsg(null);

    try {
      // Preço em centavos
      const cleanPrice = item.preco_reais.replace(/\./g, '').replace(',', '.');
      const precoCentavos = Math.round(parseFloat(cleanPrice || '0') * 100);

      // Formatar limites para a RPC
      const payloadLimites: Record<string, number | null> = {};
      Object.entries(item.limites).forEach(([rec, conf]) => {
        if (conf.ilimitado) {
          payloadLimites[rec] = null;
        } else {
          payloadLimites[rec] = conf.valor ? parseInt(conf.valor, 10) : 0;
        }
      });

      const { error } = await supabase.rpc('admin_salvar_plano_completo', {
        p_codigo: codigo,
        p_nome: item.nome,
        p_preco_centavos: precoCentavos,
        p_ativo: item.ativo,
        p_features: item.features,
        p_limites: payloadLimites
      });

      if (error) throw error;

      setMsg({ type: 'success', text: `Plano '${item.nome}' (Code: ${codigo}) atualizado com todas as permissões e limites numéricos!` });
      await fetchDadosCompletos();
    } catch (err: any) {
      setMsg({ type: 'error', text: 'Erro ao salvar plano: ' + err.message });
    } finally {
      setSavingPlanCode(null);
    }
  };

  // Modal para criar novo plano
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [novoCodigo, setNovoCodigo] = useState('');
  const [novoNome, setNovoNome] = useState('');
  const [novoPrecoReais, setNovoPrecoReais] = useState('0,00');
  const [creating, setCreating] = useState(false);

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly || !novoCodigo.trim() || !novoNome.trim()) return;

    setCreating(true);
    setMsg(null);

    try {
      const cleanPrice = novoPrecoReais.replace(/\./g, '').replace(',', '.');
      const precoCentavos = Math.round(parseFloat(cleanPrice || '0') * 100);

      const { error } = await supabase.rpc('admin_criar_novo_plano', {
        p_codigo: novoCodigo.trim(),
        p_nome: novoNome.trim(),
        p_preco_centavos: precoCentavos
      });

      if (error) throw error;

      setMsg({ type: 'success', text: `Novo plano '${novoNome}' criado com sucesso!` });
      setShowCreateModal(false);
      setNovoCodigo('');
      setNovoNome('');
      setNovoPrecoReais('0,00');
      await fetchDadosCompletos();
    } catch (err: any) {
      setMsg({ type: 'error', text: 'Erro ao criar novo plano: ' + err.message });
    } finally {
      setCreating(false);
    }
  };

  // Agrupamento por categoria do catálogo
  const gruposCat = Array.from(new Set(catalogo.map(c => c.grupo)));

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-heading text-white">Planos, Permissões & Limites Numéricos</h1>
          <p className="text-slate-400 text-sm">
            Gerencie preços, habilite/desabilite funcionalidades e defina limites de operações para cada plano.
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          disabled={isReadOnly}
          className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold px-4 py-2.5 rounded-lg text-sm transition flex items-center space-x-2 shadow-lg shadow-amber-500/10"
        >
          <Plus className="w-4 h-4" />
          <span>Criar Novo Plano</span>
        </button>
      </div>

      {/* Banner da Chave Central Beta */}
      <div className={`p-5 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all ${
        bloqueioAtivo
          ? 'bg-rose-500/10 border-rose-500/40 shadow-lg shadow-rose-500/5'
          : 'bg-amber-500/10 border-amber-500/30 shadow-lg shadow-amber-500/5'
      }`}>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold font-mono uppercase tracking-wider ${
              bloqueioAtivo ? 'bg-rose-500 text-slate-950' : 'bg-amber-500 text-slate-950'
            }`}>
              {bloqueioAtivo ? 'Modo Bloqueio Rígido Ativo' : 'Modo Aviso (Beta)'}
            </span>
            <span className="text-xs text-slate-400 font-mono">Chave Central da Plataforma</span>
          </div>
          <p className="text-xs text-slate-300 font-sans max-w-3xl">
            {bloqueioAtivo
              ? 'O bloqueio está LIGADO. Quando uma oficina atinge os limites numéricos do plano, novos cadastros são bloqueados com avisos de upgrade.'
              : 'O sistema está em MODO AVISO (Beta). Recursos fora do plano exibem aviso de orientação, mas nenhuma ação é travada para os clientes.'}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={bloqueioAtivo}
              disabled={isReadOnly || alterandoBloqueio}
              onChange={(e) => handleToggleBloqueio(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-rose-500"></div>
          </label>
          <span className="text-xs font-bold text-slate-200">
            {bloqueioAtivo ? 'Bloqueio Ligado' : 'Chave Desligada'}
          </span>
        </div>
      </div>

      {/* Toast Feedback */}
      {msg && (
        <div className={`p-4 rounded-xl text-sm font-medium border flex items-center justify-between ${
          msg.type === 'success' 
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
        }`}>
          <span>{msg.text}</span>
          <button onClick={() => setMsg(null)} className="text-xs opacity-70 hover:opacity-100">Fechar</button>
        </div>
      )}

      {/* Plan Grid Completo */}
      {loading ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-400">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500 mx-auto mb-3"></div>
          <p className="text-sm">Carregando catálogo de planos e permissões...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {planos.map((plano) => {
            const item = editState[plano.codigo];
            if (!item) return null;

            const isSaving = savingPlanCode === plano.codigo;

            return (
              <div key={plano.codigo} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between shadow-2xl space-y-6">
                
                {/* 1. CABEÇALHO DO PLANO */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold uppercase tracking-wider text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-lg">
                      PLANO: {plano.codigo}
                    </span>
                    <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
                      <input
                        type="checkbox"
                        checked={item.ativo}
                        disabled={isReadOnly}
                        onChange={(e) => setEditState({
                          ...editState,
                          [plano.codigo]: { ...item, ativo: e.target.checked }
                        })}
                        className="rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-amber-500"
                      />
                      <span className="font-semibold">{item.ativo ? 'Plano Ativo' : 'Inativo'}</span>
                    </label>
                  </div>

                  {/* Nome Comercial e Preço */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">Nome Comercial</label>
                      <input
                        type="text"
                        value={item.nome}
                        disabled={isReadOnly}
                        onChange={(e) => setEditState({
                          ...editState,
                          [plano.codigo]: { ...item, nome: e.target.value }
                        })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-bold focus:outline-none focus:border-amber-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">Preço Mensal (R$)</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-500">R$</span>
                        <input
                          type="text"
                          value={item.preco_reais}
                          disabled={isReadOnly}
                          onChange={(e) => setEditState({
                            ...editState,
                            [plano.codigo]: { ...item, preco_reais: e.target.value }
                          })}
                          placeholder="0,00"
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm font-mono font-bold text-amber-400 focus:outline-none focus:border-amber-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* 2. RECURSOS NUMÉRICOS PADRÃO (CLIENTES, AGENDAMENTOS, ETC) */}
                  <div className="pt-4 border-t border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center space-x-1.5">
                        <Sliders className="w-3.5 h-3.5" />
                        <span>Limites de Operação (Numéricos)</span>
                      </h4>
                    </div>

                    <div className="space-y-2 bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
                      {RECURSOS_PADRAO.map((rec) => {
                        const conf = item.limites[rec.chave] || { valor: '', ilimitado: true };

                        return (
                          <div key={rec.chave} className="flex items-center justify-between text-xs gap-2 py-1 border-b border-slate-800/50 last:border-0">
                            <span className="text-slate-300 font-medium">{rec.nome}:</span>

                            <div className="flex items-center space-x-2">
                              {!conf.ilimitado && (
                                <CampoNumerico
                                  integerOnly
                                  disabled={isReadOnly}
                                  value={conf.valor}
                                  onChange={(val) => {
                                    const newLim = { ...item.limites };
                                    newLim[rec.chave] = { ...conf, valor: val ? String(val) : '' };
                                    setEditState({ ...editState, [plano.codigo]: { ...item, limites: newLim } });
                                  }}
                                  align="right"
                                  placeholder="0"
                                  wrapperClassName="w-20 min-h-[30px]"
                                />
                              )}

                              <button
                                type="button"
                                disabled={isReadOnly}
                                onClick={() => {
                                  const newLim = { ...item.limites };
                                  newLim[rec.chave] = { ...conf, ilimitado: !conf.ilimitado };
                                  setEditState({ ...editState, [plano.codigo]: { ...item, limites: newLim } });
                                }}
                                className={`px-2 py-1 rounded text-[10px] font-mono font-bold border transition flex items-center space-x-1 ${
                                  conf.ilimitado
                                    ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                                    : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'
                                }`}
                              >
                                <Infinity className="w-3 h-3" />
                                <span>{conf.ilimitado ? 'Ilimitado' : 'Limitar'}</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 3. FUNCIONALIDADES & MÓDULOS DO CATÁLOGO COM SELETOR E OPERAÇÕES */}
                  <div className="pt-4 border-t border-slate-800 space-y-3">
                    <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center space-x-1.5">
                      <Layers className="w-3.5 h-3.5" />
                      <span>Funcionalidades & Módulos</span>
                    </h4>

                    <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                      {gruposCat.map((grupo) => (
                        <div key={grupo} className="space-y-1.5">
                          <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider block px-1">
                            • {grupo}
                          </span>

                          <div className="space-y-1.5">
                            {catalogo.filter(c => c.grupo === grupo).map((feat) => {
                              const isEnabled = item.features[feat.chave] ?? false;
                              const limConf = item.limites[feat.chave] || { valor: '', ilimitado: true };

                              return (
                                <div key={feat.chave} className={`p-2.5 rounded-lg border transition ${
                                  isEnabled 
                                    ? 'bg-slate-950 border-slate-800' 
                                    : 'bg-slate-950/40 border-slate-900 opacity-60'
                                }`}>
                                  <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                      <div className="font-semibold text-white text-xs flex items-center space-x-1.5">
                                        <span>{feat.nome}</span>
                                      </div>
                                      <span className="text-[9px] text-slate-500 font-mono block">key: {feat.chave}</span>
                                    </div>

                                    {/* Toggle Habilitado / Desabilitado */}
                                    <button
                                      type="button"
                                      disabled={isReadOnly}
                                      onClick={() => {
                                        const newFeat = { ...item.features, [feat.chave]: !isEnabled };
                                        setEditState({ ...editState, [plano.codigo]: { ...item, features: newFeat } });
                                      }}
                                      className={`px-2 py-1 rounded text-[10px] font-bold border transition flex items-center space-x-1 ${
                                        isEnabled
                                          ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                                          : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                                      }`}
                                    >
                                      {isEnabled ? (
                                        <>
                                          <Check className="w-3 h-3" />
                                          <span>Liberado</span>
                                        </>
                                      ) : (
                                        <>
                                          <Ban className="w-3 h-3" />
                                          <span>Bloqueado</span>
                                        </>
                                      )}
                                    </button>
                                  </div>

                                  {/* Se estiver habilitado, permite definir limite de quantidade de uso */}
                                  {isEnabled && (
                                    <div className="mt-2 pt-2 border-t border-slate-900 flex items-center justify-between text-[11px]">
                                      <span className="text-slate-400 text-[10px]">Qtd / Operações:</span>
                                      <div className="flex items-center space-x-2">
                                        {!limConf.ilimitado && (
                                          <CampoNumerico
                                            integerOnly
                                            disabled={isReadOnly}
                                            value={limConf.valor}
                                            onChange={(val) => {
                                              const newLim = { ...item.limites };
                                              newLim[feat.chave] = { ...limConf, valor: val ? String(val) : '' };
                                              setEditState({ ...editState, [plano.codigo]: { ...item, limites: newLim } });
                                            }}
                                            align="right"
                                            placeholder="Ex: 50"
                                            wrapperClassName="w-16 min-h-[26px]"
                                          />
                                        )}
                                        <button
                                          type="button"
                                          disabled={isReadOnly}
                                          onClick={() => {
                                            const newLim = { ...item.limites };
                                            newLim[feat.chave] = { ...limConf, ilimitado: !limConf.ilimitado };
                                            setEditState({ ...editState, [plano.codigo]: { ...item, limites: newLim } });
                                          }}
                                          className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border transition ${
                                            limConf.ilimitado
                                              ? 'bg-slate-900 text-amber-400 border-amber-500/30'
                                              : 'bg-slate-900 text-slate-400 border-slate-700'
                                          }`}
                                        >
                                          {limConf.ilimitado ? 'Ilimitado' : 'Qtd'}
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                </div>

                {/* BOTÃO SALVAR COMPLETO DO PLANO */}
                <div className="pt-4 border-t border-slate-800">
                  <button
                    onClick={() => handleSavePlan(plano.codigo)}
                    disabled={isSaving || isReadOnly}
                    className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold py-2.5 rounded-lg text-sm transition flex items-center justify-center space-x-2 shadow-lg shadow-amber-500/10"
                  >
                    <Save className="w-4 h-4" />
                    <span>{isSaving ? 'Salvando...' : `Salvar Matriz do Plano ${item.nome}`}</span>
                  </button>
                </div>

              </div>
            );
          })}
        </div>
      )}

      {/* Modal Criar Novo Plano */}
      {showCreateModal && (
        <div 
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !creating) setShowCreateModal(false);
          }}
        >
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                <Plus className="w-5 h-5 text-amber-500" />
                <span>Criar Novo Plano de Assinatura</span>
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreatePlan} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Código do Plano (identificador sem espaços)
                </label>
                <input
                  type="text"
                  required
                  value={novoCodigo}
                  onChange={(e) => setNovoCodigo(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                  placeholder="ex: enterprise, vip, master"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-amber-500/50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Nome Comercial
                </label>
                <input
                  type="text"
                  required
                  value={novoNome}
                  onChange={(e) => setNovoNome(e.target.value)}
                  placeholder="ex: Plano Enterprise"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-amber-500/50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Preço Mensal (R$)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-500">R$</span>
                  <input
                    type="text"
                    value={novoPrecoReais}
                    onChange={(e) => setNovoPrecoReais(e.target.value)}
                    placeholder="299,00"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm font-mono font-bold text-amber-400 focus:outline-none focus:border-amber-500/50"
                  />
                </div>
              </div>

              <div className="pt-4 flex items-center justify-end space-x-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium transition text-xs"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg transition text-xs shadow-lg shadow-amber-500/10"
                >
                  {creating ? 'Criando Plano...' : 'Confirmar e Criar Plano'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
