import React, { useState, useEffect } from 'react';
import { 
  MessageSquare, 
  Search, 
  Filter, 
  AlertTriangle, 
  Lightbulb, 
  Heart, 
  Star, 
  Send,
  Building2,
  User,
  X,
  Check,
  CheckCircle2,
  Code,
  ChevronDown,
  ChevronUp,
  Copy,
  AlertCircle,
  Terminal
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { useAdminAuth } from '../../components/admin/AdminGuard';
import { traduzirErro } from '../../utils/erros';

interface FeedbackItem {
  id: string;
  tenant_id: string;
  tenant_nome: string;
  user_id: string;
  user_email: string;
  papel: string;
  tipo: 'erro' | 'sugestao' | 'elogio';
  mensagem: string;
  tela_origem?: string;
  user_agent?: string;
  status: 'novo' | 'em_analise' | 'resolvido' | 'descartado';
  premiado: boolean;
  resposta_admin?: string;
  respondido_em?: string;
  created_at: string;
}

interface AutoErrorParsed {
  isAutoErr: boolean;
  refCode?: string;
  tela?: string;
  mensagemPrincipal: string;
  detalheAmigavel?: string;
  dadosJsonTecnico?: string;
}

function parseMensagemFeedback(raw: string): AutoErrorParsed {
  if (!raw || (!raw.startsWith('[AUTO-ERR]') && !raw.includes('[REF: ERR-'))) {
    return {
      isAutoErr: false,
      mensagemPrincipal: raw,
    };
  }

  // Extrair código de referência
  const refMatch = raw.match(/\[REF:\s*([^\]]+)\]/);
  const refCode = refMatch ? refMatch[1].trim() : undefined;

  // Extrair tela
  const telaMatch = raw.match(/\[TELA:\s*([^\]]+)\]/);
  const tela = telaMatch ? telaMatch[1].trim() : undefined;

  // Extrair título e mensagem gravados (se houver)
  const tituloMatch = raw.match(/\[TITULO:\s*([^\]]+)\]/);
  const tituloGravado = tituloMatch ? tituloMatch[1].trim() : undefined;

  const msgMatch = raw.match(/\[MSG:\s*([^\]]+)\]/);
  const msgGravada = msgMatch ? msgMatch[1].trim() : undefined;

  // Limpar tags
  let corpo = raw
    .replace(/\[AUTO-ERR\]/g, '')
    .replace(/\[REF:\s*[^\]]+\]/g, '')
    .replace(/\[TELA:\s*[^\]]+\]/g, '')
    .replace(/\[TITULO:\s*[^\]]+\]/g, '')
    .replace(/\[MSG:\s*[^\]]+\]/g, '')
    .trim();

  let detalheAmigavel: string | undefined = undefined;
  let dadosJsonTecnico: string | undefined = undefined;

  // Extrair JSON caso haja (ex: erro retornado pelo Asaas)
  const jsonMatch = corpo.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    const rawJson = jsonMatch[0];
    try {
      const parsed = JSON.parse(rawJson);
      dadosJsonTecnico = JSON.stringify(parsed, null, 2);

      if (parsed.errors && Array.isArray(parsed.errors) && parsed.errors.length > 0) {
        detalheAmigavel = parsed.errors.map((e: any) => e.description || e.code).join(' • ');
      } else if (parsed.message) {
        detalheAmigavel = parsed.message;
      } else if (parsed.error) {
        detalheAmigavel = typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error);
      }
    } catch (e) {
      dadosJsonTecnico = rawJson;
    }

    corpo = corpo.replace(rawJson, '').trim();
    if (corpo.endsWith(':')) {
      corpo = corpo.slice(0, -1).trim();
    }
  }

  // Se não foi extraído JSON, guarda o log técnico bruto para inspeção
  const logBruto = corpo;
  if (!dadosJsonTecnico && logBruto) {
    dadosJsonTecnico = logBruto;
  }

  // Tradução e mensagem principal amigável em português
  let mensagemPrincipal = '';
  if (tituloGravado && msgGravada) {
    mensagemPrincipal = `${tituloGravado}: ${msgGravada}`;
  } else if (tituloGravado || msgGravada) {
    mensagemPrincipal = tituloGravado || msgGravada || '';
  }

  // Se não temos título ou mensagem gravados (logs antigos ou brutos)
  if (!mensagemPrincipal) {
    const traduzido = traduzirErro(corpo, tela);
    mensagemPrincipal = `${traduzido.titulo}: ${traduzido.mensagem}`;
    if (!detalheAmigavel && traduzido.acao) {
      detalheAmigavel = traduzido.acao;
    }
  }

  return {
    isAutoErr: true,
    refCode,
    tela,
    mensagemPrincipal: mensagemPrincipal || 'Erro técnico registrado automaticamente pelo sistema',
    detalheAmigavel,
    dadosJsonTecnico,
  };
}

export const AdminFeedbacks: React.FC = () => {
  const { adminLevel } = useAdminAuth();
  const isEditor = adminLevel !== 'suporte';
  const { showSuccess, showError } = useToast();

  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroTipo, setFiltroTipo] = useState<string>('');
  const [filtroStatus, setFiltroStatus] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  // Modal de Resposta
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackItem | null>(null);
  const [respostaAdmin, setRespostaAdmin] = useState('');
  const [novoStatus, setNovoStatus] = useState<string>('em_analise');
  const [isPremiado, setIsPremiado] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // Accordion para detalhes técnicos
  const [expandedDetails, setExpandedDetails] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    setExpandedDetails((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const loadFeedbacks = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_listar_feedbacks', {
        p_tipo: filtroTipo || null,
        p_status: filtroStatus || null,
        p_tenant_id: null,
        p_limite: 100,
        p_offset: 0,
      });

      if (error) throw error;
      setFeedbacks(data || []);
    } catch (err: any) {
      console.error('[AdminFeedbacks Load Error]:', err);
      showError('Erro ao carregar feedbacks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFeedbacks();
  }, [filtroTipo, filtroStatus]);

  const handleAtualizarStatusRapido = async (id: string, status: 'em_analise' | 'resolvido' | 'descartado') => {
    try {
      const { error } = await supabase.rpc('admin_atualizar_feedback', {
        p_id: id,
        p_status: status,
      });
      if (error) throw error;
      showSuccess(`Feedback marcado como ${status === 'em_analise' ? 'Em Análise (Lido)' : 'Resolvido'}!`);
      window.dispatchEvent(new CustomEvent('feedbacks_atualizados'));
      await loadFeedbacks();
    } catch (err: any) {
      showError(err.message || 'Erro ao atualizar status');
    }
  };

  const handleMarcarTodosNovosLidos = async () => {
    const novos = feedbacks.filter((f) => f.status === 'novo');
    if (novos.length === 0) return;
    try {
      setLoading(true);
      for (const fb of novos) {
        await supabase.rpc('admin_atualizar_feedback', {
          p_id: fb.id,
          p_status: 'em_analise',
        });
      }
      showSuccess('Todos os feedbacks novos foram marcados como lidos!');
      window.dispatchEvent(new CustomEvent('feedbacks_atualizados'));
      await loadFeedbacks();
    } catch (err: any) {
      showError('Erro ao atualizar feedbacks em lote');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenResponder = (item: FeedbackItem) => {
    setSelectedFeedback(item);
    setRespostaAdmin(item.resposta_admin || '');
    setNovoStatus(item.status === 'novo' ? 'em_analise' : item.status);
    setIsPremiado(item.premiado || false);
  };

  const handleSalvarResposta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFeedback) return;

    setSalvando(true);
    try {
      const { error } = await supabase.rpc('admin_atualizar_feedback', {
        p_id: selectedFeedback.id,
        p_status: novoStatus,
        p_premiado: isPremiado,
        p_resposta_admin: respostaAdmin.trim() || null,
      });

      if (error) throw error;

      showSuccess('Feedback atualizado com sucesso!');
      window.dispatchEvent(new CustomEvent('feedbacks_atualizados'));
      setSelectedFeedback(null);
      await loadFeedbacks();
    } catch (err: any) {
      console.error('[AdminFeedbacks Update Error]:', err);
      showError(err.message || 'Erro ao atualizar feedback');
    } finally {
      setSalvando(false);
    }
  };

  const feedbacksFiltrados = feedbacks.filter((f) => {
    const query = searchQuery.toLowerCase();
    return (
      f.mensagem.toLowerCase().includes(query) ||
      f.tenant_nome.toLowerCase().includes(query) ||
      (f.user_email && f.user_email.toLowerCase().includes(query))
    );
  });

  const getTipoIcon = (t: string) => {
    switch (t) {
      case 'erro':
        return <AlertTriangle className="w-4 h-4 text-flare-400" />;
      case 'sugestao':
        return <Lightbulb className="w-4 h-4 text-amber-400" />;
      case 'elogio':
        return <Heart className="w-4 h-4 text-emerald-400" />;
      default:
        return <MessageSquare className="w-4 h-4 text-slate-400" />;
    }
  };

  const getStatusBadge = (s: string) => {
    switch (s) {
      case 'novo':
        return <span className="bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded text-[11px] font-bold">Novo</span>;
      case 'em_analise':
        return <span className="bg-blue-500/20 text-blue-300 border border-blue-500/40 px-2 py-0.5 rounded text-[11px] font-semibold">Em Análise</span>;
      case 'resolvido':
        return <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded text-[11px] font-semibold">Resolvido</span>;
      case 'descartado':
        return <span className="bg-slate-800 text-slate-400 border border-slate-700 px-2 py-0.5 rounded text-[11px]">Descartado</span>;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold font-heading text-slate-100 flex items-center gap-2">
            <MessageSquare className="w-6 h-6 text-amber-400" />
            Central de Feedbacks dos Usuários
          </h1>
          <p className="text-xs text-slate-400">
            Acompanhe erros relatados, elogios e sugestões de oficinas para aprimorar o produto.
          </p>
        </div>

        {feedbacks.some((f) => f.status === 'novo') && isEditor && (
          <button
            onClick={handleMarcarTodosNovosLidos}
            className="px-3.5 py-2 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/40 text-xs font-bold hover:bg-amber-500/30 transition flex items-center gap-2 shadow-sm"
            title="Dar baixa e marcar todos os novos feedbacks como lidos (Em Análise)"
          >
            <Check className="w-4 h-4" />
            <span>Marcar Novos como Lidos</span>
          </button>
        )}
      </div>

      {/* Filtros e Busca */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-900 p-3 rounded-lg border border-slate-800">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar em feedbacks ou oficinas..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-md pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-amber-500"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
          <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded border border-slate-800">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value)}
              className="bg-transparent text-xs text-slate-300 outline-none cursor-pointer"
            >
              <option value="">Todos os Tipos</option>
              <option value="sugestao">Sugestões</option>
              <option value="erro">Problemas/Erros</option>
              <option value="elogio">Elogios</option>
            </select>
          </div>

          <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded border border-slate-800">
            <select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value)}
              className="bg-transparent text-xs text-slate-300 outline-none cursor-pointer"
            >
              <option value="">Todos os Status</option>
              <option value="novo">Novos</option>
              <option value="em_analise">Em Análise</option>
              <option value="resolvido">Resolvidos</option>
              <option value="descartado">Descartados</option>
            </select>
          </div>
        </div>
      </div>

      {/* Lista de Feedbacks */}
      {loading ? (
        <div className="p-12 text-center text-slate-400 text-xs font-mono">Carregando feedbacks...</div>
      ) : feedbacksFiltrados.length === 0 ? (
        <div className="p-12 bg-slate-900 border border-slate-800 rounded-lg text-center text-slate-400 text-sm">
          Nenhum feedback localizado com os filtros atuais.
        </div>
      ) : (
        <div className="space-y-3">
          {feedbacksFiltrados.map((item) => (
            <div
              key={item.id}
              className={`p-4 rounded-lg border transition-all ${
                item.status === 'novo'
                  ? 'bg-slate-900/90 border-amber-500/50 shadow-md shadow-amber-500/5'
                  : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2 border-b border-slate-800/60 pb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1 rounded border border-slate-800 text-xs font-bold text-slate-200">
                    {getTipoIcon(item.tipo)}
                    <span className="capitalize">{item.tipo}</span>
                  </div>

                  {getStatusBadge(item.status)}

                  {item.premiado && (
                    <span className="bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded text-[11px] font-bold flex items-center gap-1">
                      <Star className="w-3 h-3 fill-amber-400 text-amber-400" /> Destaque
                    </span>
                  )}
                </div>

                <div className="text-[11px] font-mono text-slate-400">
                  {new Date(item.created_at).toLocaleString('pt-BR')}
                </div>
              </div>

              {/* Conteúdo e Meta */}
              <div className="space-y-3">
                {(() => {
                  const parsed = parseMensagemFeedback(item.mensagem);

                  if (!parsed.isAutoErr) {
                    return (
                      <p className="text-sm text-slate-200 font-sans whitespace-pre-wrap leading-relaxed">
                        "{item.mensagem}"
                      </p>
                    );
                  }

                  const isExpanded = expandedDetails.has(item.id);

                  return (
                    <div className="space-y-3 bg-slate-950/70 border border-red-500/20 rounded-xl p-4">
                      {/* Cabeçalho do Erro Automático */}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="bg-red-500/15 text-red-400 border border-red-500/30 px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider flex items-center gap-1">
                          <Terminal className="w-3 h-3 text-red-400" />
                          Log do Sistema
                        </span>

                        {parsed.refCode && (
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(parsed.refCode!);
                              showSuccess(`Código ${parsed.refCode} copiado!`);
                            }}
                            className="bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 px-2 py-0.5 rounded text-[11px] font-mono flex items-center gap-1 transition-colors cursor-pointer"
                            title="Clique para copiar código de referência"
                          >
                            <span>Ref: <strong className="text-amber-400">{parsed.refCode}</strong></span>
                            <Copy className="w-3 h-3 text-slate-400" />
                          </button>
                        )}

                        {parsed.tela && (
                          <span className="bg-slate-900 text-slate-400 border border-slate-800 px-2 py-0.5 rounded text-[10px] font-mono">
                            Tela: {parsed.tela}
                          </span>
                        )}
                      </div>

                      {/* Título / Descrição Principal */}
                      <div className="text-sm font-semibold text-slate-100 flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                        <span>{parsed.mensagemPrincipal}</span>
                      </div>

                      {/* Caixa de Explicação Amigável */}
                      {parsed.detalheAmigavel && (
                        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-200 flex items-start gap-2.5">
                          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                          <div>
                            <strong className="text-amber-300 font-bold block mb-0.5">Diagnóstico / Motivo:</strong>
                            <span className="leading-relaxed">{parsed.detalheAmigavel}</span>
                          </div>
                        </div>
                      )}

                      {/* Detalhes Técnicos / JSON (Accordion) */}
                      {parsed.dadosJsonTecnico && (
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={() => toggleExpanded(item.id)}
                            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 font-mono transition-colors cursor-pointer"
                          >
                            <Code className="w-3.5 h-3.5 text-amber-500" />
                            <span>{isExpanded ? 'Ocultar Detalhes Técnicos' : 'Ver Log Técnico / Código do Banco'}</span>
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>

                          {isExpanded && (
                            <div className="mt-2 relative">
                              <pre className="p-3 bg-slate-950 border border-slate-800 rounded-lg text-[11px] font-mono text-emerald-400 overflow-x-auto max-h-56 select-text">
                                {parsed.dadosJsonTecnico}
                              </pre>
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(parsed.dadosJsonTecnico!);
                                  showSuccess('Log técnico copiado para a área de transferência!');
                                }}
                                className="absolute top-2 right-2 p-1.5 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-600 transition cursor-pointer"
                                title="Copiar log técnico"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div className="flex items-center gap-4 text-xs text-slate-400 flex-wrap pt-1">
                  <div className="flex items-center gap-1 text-slate-300">
                    <Building2 className="w-3.5 h-3.5 text-amber-500" />
                    <span className="font-semibold">{item.tenant_nome}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <User className="w-3.5 h-3.5 text-slate-500" />
                    <span>{item.user_email || 'Usuário da Equipe'} ({item.papel})</span>
                  </div>
                  {item.tela_origem && (
                    <span className="bg-slate-950 font-mono text-[10px] px-2 py-0.5 rounded border border-slate-800">
                      Tela: {item.tela_origem}
                    </span>
                  )}
                </div>

                {/* Resposta Admin existente */}
                {item.resposta_admin && (
                  <div className="mt-3 p-3 rounded bg-slate-950 border border-slate-800 text-xs space-y-1">
                    <span className="font-bold text-amber-400 block">Resposta da Plataforma:</span>
                    <p className="text-slate-300 italic">"{item.resposta_admin}"</p>
                  </div>
                )}
              </div>

              {/* Ação */}
              {isEditor && (
                <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    {item.status === 'novo' && (
                      <button
                        type="button"
                        onClick={() => handleAtualizarStatusRapido(item.id, 'em_analise')}
                        className="px-2.5 py-1.5 rounded bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 text-xs font-semibold transition-colors flex items-center gap-1.5"
                        title="Marcar como lido / colocar em análise"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Marcar como Lido</span>
                      </button>
                    )}
                    {item.status !== 'resolvido' && (
                      <button
                        type="button"
                        onClick={() => handleAtualizarStatusRapido(item.id, 'resolvido')}
                        className="px-2.5 py-1.5 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-semibold transition-colors flex items-center gap-1.5"
                        title="Marcar como resolvido"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Resolver</span>
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleOpenResponder(item)}
                    className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-400 font-semibold text-xs transition-colors flex items-center gap-1.5 ml-auto"
                  >
                    <Send className="w-3 h-3" />
                    {item.resposta_admin ? 'Editar Resposta' : 'Responder Feedback'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal de Resposta */}
      {selectedFeedback && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-slate-100 font-heading">Responder ao Feedback</h3>
              <button onClick={() => setSelectedFeedback(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-slate-950 rounded border border-slate-800 text-xs text-slate-300">
              <span className="font-semibold text-slate-400 block mb-1">
                {selectedFeedback.tenant_nome} — {selectedFeedback.tipo.toUpperCase()}
              </span>
              "{selectedFeedback.mensagem}"
            </div>

            <form onSubmit={handleSalvarResposta} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">Status do Feedback</label>
                  <select
                    value={novoStatus}
                    onChange={(e) => setNovoStatus(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-xs text-slate-200 outline-none focus:border-amber-500"
                  >
                    <option value="novo">Novo</option>
                    <option value="em_analise">Em Análise</option>
                    <option value="resolvido">Resolvido</option>
                    <option value="descartado">Descartado</option>
                  </select>
                </div>

                <div className="flex items-center pt-5">
                  <label className="flex items-center gap-2 text-xs text-slate-200 font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isPremiado}
                      onChange={(e) => setIsPremiado(e.target.checked)}
                      className="rounded accent-amber-500 w-4 h-4"
                    />
                    <span>Marcar como Destaque</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Resposta para a Oficina (Visível para o usuário)
                </label>
                <textarea
                  rows={4}
                  value={respostaAdmin}
                  onChange={(e) => setRespostaAdmin(e.target.value)}
                  placeholder="Escreva a resposta ou resolução técnica que a oficina visualizará em 'Ajustes / Meus Feedbacks'..."
                  className="w-full bg-slate-950 border border-slate-800 rounded p-3 text-xs text-slate-200 outline-none focus:border-amber-500 resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setSelectedFeedback(null)}
                  className="px-3 py-1.5 rounded text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando}
                  className="px-4 py-1.5 rounded text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 transition-colors"
                >
                  {salvando ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
