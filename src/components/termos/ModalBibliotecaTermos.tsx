import React, { useState, useEffect } from 'react';
import { 
  Scale, 
  Sparkles, 
  Download, 
  Copy, 
  Check, 
  Search, 
  Zap, 
  X, 
  RotateCw,
  ChevronDown,
  ChevronUp,
  Lock,
  CheckCircle2,
  PowerOff,
  Quote
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { 
  TIPOS_TERMOS_GARANTIA, 
  MODELOS_TERMOS_PLATAFORMA_PADRAO, 
  TERMO_RESPONSABILIDADE_PADRAO 
} from '../../types/termos';
import type { PlataformaModeloTermo } from '../../types/termos';

interface ModalBibliotecaTermosProps {
  isOpen: boolean;
  onClose: () => void;
  onModeloAplicado?: (categoria: 'responsabilidade' | 'garantia', conteudo: string) => void;
  termosTenant?: any[];
  termoRespTenant?: string;
}

export const ModalBibliotecaTermos: React.FC<ModalBibliotecaTermosProps> = ({
  isOpen,
  onClose,
  onModeloAplicado,
  termosTenant: propTermosTenant,
  termoRespTenant: propTermoRespTenant,
}) => {
  const { tenant } = useAuth();
  const { showSuccess, showError } = useToast();

  const [modelos, setModelos] = useState<PlataformaModeloTermo[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [abaAtiva, setAbaAtiva] = useState<'todos' | 'responsabilidade' | 'garantia'>('todos');
  const [filtroServico, setFiltroServico] = useState<string>('todos');
  const [busca, setBusca] = useState<string>('');

  // Termos ativos na oficina (para impedir duplicações e permitir desativação)
  const [termosTenant, setTermosTenant] = useState<any[]>(propTermosTenant || []);
  const [termoRespTenant, setTermoRespTenant] = useState<string>(propTermoRespTenant || '');

  // Sincroniza props quando abrirem ou mudarem
  useEffect(() => {
    if (propTermosTenant) {
      setTermosTenant(propTermosTenant);
    }
  }, [propTermosTenant]);

  useEffect(() => {
    if (propTermoRespTenant !== undefined) {
      setTermoRespTenant(propTermoRespTenant);
    }
  }, [propTermoRespTenant]);

  // Estado de expansão de texto
  const [expandidos, setExpandidos] = useState<Record<string, boolean>>({});

  // Estado de ações
  const [aplicandoId, setAplicandoId] = useState<string | null>(null);
  const [desativandoId, setDesativandoId] = useState<string | null>(null);
  const [copiadoId, setCopiadoId] = useState<string | null>(null);

  const carregarDados = async () => {
    setLoading(true);
    try {
      // 1. Carrega modelos da plataforma
      const { data, error } = await supabase.rpc('listar_modelos_termos');
      const modelosDb: PlataformaModeloTermo[] = (!error && Array.isArray(data)) ? data : [];

      const titulosDb = new Set(modelosDb.map((m) => m.titulo.toLowerCase().trim()));
      const complementares = MODELOS_TERMOS_PLATAFORMA_PADRAO.filter(
        (padrao) => !titulosDb.has(padrao.titulo.toLowerCase().trim())
      );

      setModelos([...modelosDb, ...complementares]);

      // 2. Carrega termos já cadastrados e ativos da oficina do usuário (garantindo dados mais frescos)
      if (tenant?.id) {
        try {
          const [resTg, resTen] = await Promise.all([
            supabase.from('termos_garantia').select('*').eq('tenant_id', tenant.id),
            supabase.from('tenants').select('termo_responsabilidade').eq('id', tenant.id).maybeSingle(),
          ]);

          if (resTg.data && resTg.data.length > 0) {
            setTermosTenant(resTg.data);
          } else if (!propTermosTenant || propTermosTenant.length === 0) {
            const salvos = localStorage.getItem(`termos_garantia_${tenant.id}`);
            if (salvos) setTermosTenant(JSON.parse(salvos));
          }

          if (resTen.data?.termo_responsabilidade) {
            setTermoRespTenant(resTen.data.termo_responsabilidade);
          } else if (!propTermoRespTenant) {
            const salvoResp = localStorage.getItem(`termo_responsabilidade_${tenant.id}`);
            if (salvoResp) setTermoRespTenant(salvoResp);
          }
        } catch (errTenant) {
          console.warn('[ModalBibliotecaTermos] Erro ao carregar termos atuais da oficina:', errTenant);
        }
      }
    } catch (err: any) {
      console.warn('Erro ao consultar banco, usando catálogo completo de modelos padrão:', err);
      setModelos(MODELOS_TERMOS_PLATAFORMA_PADRAO);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      carregarDados();
    }
  }, [isOpen]);

  // Identifica de forma robusta e inequívoca se um modelo já está ativo na oficina do usuário
  const obterTermoAtivoCorrespondente = (modelo: PlataformaModeloTermo) => {
    const titNorm = modelo.titulo.toLowerCase().trim();
    const txtNorm = modelo.conteudo_texto.trim();

    // 1. Procura na lista de termos cadastrados da oficina (garantia ou responsabilidade)
    const achadoNaLista = termosTenant.find((t) => {
      if (t.ativo === false) return false;
      const tTitNorm = (t.titulo || '').toLowerCase().trim();
      const tTxtNorm = (t.conteudo || '').trim();

      // Casamento por título exato ou inclusão mútua
      const matchTitulo = tTitNorm === titNorm || 
        (titNorm.length > 5 && tTitNorm.length > 5 && (titNorm.includes(tTitNorm) || tTitNorm.includes(titNorm)));
      // Casamento por início do texto da cláusula (60 caracteres)
      const matchTexto = txtNorm.slice(0, 60) === tTxtNorm.slice(0, 60);
      // Casamento por tipo de serviço específico (se for garantia com tipo definido)
      const matchTipo = Boolean(
        modelo.categoria === 'garantia' &&
        modelo.tipo_servico && 
        modelo.tipo_servico !== 'geral' && 
        t.tipo === modelo.tipo_servico
      );

      return matchTitulo || matchTexto || matchTipo;
    });

    if (achadoNaLista) return achadoNaLista;

    // 2. Se for termo de responsabilidade e não encontrou na lista, verifica se bate com o texto fixo do tenant
    if (modelo.categoria === 'responsabilidade') {
      const respAtual = (termoRespTenant || (tenant as any)?.termo_responsabilidade || '').trim();
      if (!respAtual) return null;
      const trechoSignificativo = txtNorm.slice(0, 60);
      const ativo = respAtual === txtNorm || respAtual.includes(trechoSignificativo);
      return ativo ? { id: 'responsabilidade_fixa', categoria: 'responsabilidade', titulo: modelo.titulo, conteudo: modelo.conteudo_texto } : null;
    }

    return null;
  };

  const toggleExpandir = (id: string) => {
    setExpandidos((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCopiar = (id: string, texto: string) => {
    navigator.clipboard.writeText(texto);
    setCopiadoId(id);
    showSuccess('Cláusulas copiadas para a área de transferência!');
    setTimeout(() => setCopiadoId(null), 2500);
  };

  const handleDownloadArquivo = async (modelo: PlataformaModeloTermo) => {
    try {
      supabase.rpc('incrementar_download_modelo_termo', { p_modelo_id: modelo.id });

      if (modelo.arquivo_url) {
        window.open(modelo.arquivo_url, '_blank');
      } else {
        const element = document.createElement('a');
        const file = new Blob([modelo.conteudo_texto], { type: 'text/plain;charset=utf-8' });
        element.href = URL.createObjectURL(file);
        element.download = `${modelo.titulo.replace(/[^a-zA-Z0-9]/g, '_')}.txt`;
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
      }
      showSuccess('Download iniciado com sucesso!');
    } catch (err: any) {
      console.error('Erro no download:', err);
      showError('Erro ao baixar o arquivo.');
    }
  };

  // ATIVAR MODELO NA OFICINA (Permite múltiplos termos ativos sem desativar outros)
  const handleAplicarNaOficina = async (modelo: PlataformaModeloTermo) => {
    if (!tenant?.id) return;
    const jaAtivo = obterTermoAtivoCorrespondente(modelo);
    if (jaAtivo) {
      showError('Este modelo já está ativo na sua oficina. Para retirá-lo, clique em "Desativar este Termo".');
      return;
    }

    setAplicandoId(modelo.id);
    try {
      let sucesso = false;
      let msg = '';
      const tipoDestino = modelo.tipo_servico || (modelo.categoria === 'responsabilidade' ? 'responsabilidade' : 'geral');

      // 1. Verifica se já existe registro equivalente no banco
      const { data: existentes } = await supabase
        .from('termos_garantia')
        .select('id')
        .eq('tenant_id', tenant.id)
        .or(`titulo.eq.${modelo.titulo},tipo.eq.${tipoDestino}`);

      let novoItem: any = null;

      if (existentes && existentes.length > 0) {
        // Atualiza registro existente para ativo
        const { data: updated } = await supabase
          .from('termos_garantia')
          .update({
            categoria: modelo.categoria,
            tipo: tipoDestino,
            titulo: modelo.titulo,
            conteudo: modelo.conteudo_texto,
            ativo: true,
            updated_at: new Date().toISOString()
          })
          .eq('id', existentes[0].id)
          .select('*')
          .single();

        novoItem = updated;
      } else {
        // Insere novo registro independente em termos_garantia
        const { data: inserted, error: insertErr } = await supabase
          .from('termos_garantia')
          .insert({
            tenant_id: tenant.id,
            categoria: modelo.categoria,
            tipo: tipoDestino,
            titulo: modelo.titulo,
            conteudo: modelo.conteudo_texto,
            padrao: false,
            ativo: true,
          })
          .select('*')
          .single();

        if (!insertErr && inserted) {
          novoItem = inserted;
        }
      }

      if (modelo.categoria === 'responsabilidade') {
        // Atualiza também o termo do tenant como padrão
        await supabase
          .from('tenants')
          .update({ termo_responsabilidade: modelo.conteudo_texto })
          .eq('id', tenant.id);
        localStorage.setItem(`termo_responsabilidade_${tenant.id}`, modelo.conteudo_texto);
        setTermoRespTenant(modelo.conteudo_texto);
      }

      if (novoItem) {
        setTermosTenant((prev) => [...prev.filter((t) => t.id !== novoItem.id), novoItem]);
        const salvos = localStorage.getItem(`termos_garantia_${tenant.id}`);
        const lista = salvos ? JSON.parse(salvos).filter((t: any) => t.id !== novoItem.id) : [];
        lista.push(novoItem);
        localStorage.setItem(`termos_garantia_${tenant.id}`, JSON.stringify(lista));

        msg = `${modelo.categoria === 'responsabilidade' ? 'Termo de Responsabilidade' : 'Termo de Garantia'} "${modelo.titulo}" ativado com sucesso!`;
        sucesso = true;
      } else {
        // Fallback local
        const novoLocal = {
          id: `local_${Date.now()}`,
          tenant_id: tenant.id,
          categoria: modelo.categoria,
          tipo: tipoDestino,
          titulo: modelo.titulo,
          conteudo: modelo.conteudo_texto,
          padrao: false,
          ativo: true,
          created_at: new Date().toISOString(),
        };
        const salvos = localStorage.getItem(`termos_garantia_${tenant.id}`);
        const lista = salvos ? JSON.parse(salvos) : [];
        lista.push(novoLocal);
        localStorage.setItem(`termos_garantia_${tenant.id}`, JSON.stringify(lista));
        setTermosTenant((prev) => [...prev, novoLocal]);
        msg = `${modelo.categoria === 'responsabilidade' ? 'Termo de Responsabilidade' : 'Termo de Garantia'} "${modelo.titulo}" ativado com sucesso!`;
        sucesso = true;
      }

      if (sucesso) {
        showSuccess(msg);
        if (onModeloAplicado) {
          onModeloAplicado(modelo.categoria, modelo.conteudo_texto);
        }
        setModelos((prev) =>
          prev.map((m) => (m.id === modelo.id ? { ...m, aplicacoes_count: (m.aplicacoes_count || 0) + 1 } : m))
        );
      } else {
        showError('Não foi possível ativar o modelo na oficina.');
      }
    } catch (err: any) {
      console.error('Erro ao aplicar modelo na oficina:', err);
      showError(err.message || 'Erro ao aplicar o modelo de termo.');
    } finally {
      setAplicandoId(null);
    }
  };

  // DESATIVAR MODELO DA OFICINA (Desativa somente o modelo clicado)
  const handleDesativarDaOficina = async (modelo: PlataformaModeloTermo, termoAtivo: any) => {
    if (!tenant?.id) return;
    setDesativandoId(modelo.id);
    try {
      const titNorm = modelo.titulo.toLowerCase().trim();
      const txtNorm = modelo.conteudo_texto.trim();
      
      const itensParaRemover = termosTenant.filter((t) => {
        if (termoAtivo?.id && t.id === termoAtivo.id) return true;
        const tTitNorm = (t.titulo || '').toLowerCase().trim();
        const tTxtNorm = (t.conteudo || '').trim();
        const matchTit = tTitNorm === titNorm || (titNorm.length > 5 && tTitNorm.includes(titNorm));
        const matchTxt = txtNorm.slice(0, 60) === tTxtNorm.slice(0, 60);
        return matchTit || matchTxt;
      });

      const idsParaRemover = itensParaRemover.map((t) => t.id);
      const idsDb = idsParaRemover.filter((id) => !String(id).startsWith('local_') && id !== 'responsabilidade_fixa');

      if (idsDb.length > 0) {
        await supabase.from('termos_garantia').delete().in('id', idsDb);
      }

      setTermosTenant((prev) => prev.filter((t) => !idsParaRemover.includes(t.id)));
      const salvos = localStorage.getItem(`termos_garantia_${tenant.id}`);
      if (salvos) {
        const lista = JSON.parse(salvos).filter((t: any) => !idsParaRemover.includes(t.id));
        localStorage.setItem(`termos_garantia_${tenant.id}`, JSON.stringify(lista));
      }

      if (modelo.categoria === 'responsabilidade') {
        // Se o termo fixo do tenant era exatamente este, restaura para o padrão
        if (termoRespTenant.trim() === txtNorm || termoRespTenant.trim().slice(0, 60) === txtNorm.slice(0, 60)) {
          await supabase
            .from('tenants')
            .update({ termo_responsabilidade: TERMO_RESPONSABILIDADE_PADRAO })
            .eq('id', tenant.id);
          localStorage.setItem(`termo_responsabilidade_${tenant.id}`, TERMO_RESPONSABILIDADE_PADRAO);
          setTermoRespTenant(TERMO_RESPONSABILIDADE_PADRAO);
        }
      }

      showSuccess(`Modelo "${modelo.titulo}" desativado com sucesso da sua oficina.`);
      if (onModeloAplicado) {
        onModeloAplicado(modelo.categoria, '');
      }
    } catch (err: any) {
      console.error('Erro ao desativar termo:', err);
      showError('Erro ao desativar termo: ' + (err?.message || err));
    } finally {
      setDesativandoId(null);
    }
  };

  // Filtragem
  const modelosFiltrados = modelos.filter((m) => {
    if (abaAtiva !== 'todos' && m.categoria !== abaAtiva) return false;
    if (abaAtiva === 'garantia' && filtroServico !== 'todos' && m.tipo_servico !== filtroServico) return false;

    if (busca.trim()) {
      const query = busca.toLowerCase();
      const bateTitulo = m.titulo.toLowerCase().includes(query);
      const bateDesc = (m.descricao || '').toLowerCase().includes(query);
      const bateTexto = m.conteudo_texto.toLowerCase().includes(query);
      return bateTitulo || bateDesc || bateTexto;
    }
    return true;
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Biblioteca de Modelos Jurídicos"
      maxWidth="5xl"
      icon={<Scale className="text-amber-400" size={24} />}
      footer={
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 w-full text-xs text-vapor-400">
          <span className="text-[11.5px] text-center sm:text-left text-vapor-400">
            Termos ativados ficam imediatamente vinculados à sua oficina para seleção em orçamentos e ordens de serviço.
          </span>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            className="text-xs h-9 px-6 text-vapor-200 w-full sm:w-auto hover:bg-graphite-700"
          >
            Fechar
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Banner Informativo Superior */}
        <div className="bg-gradient-to-r from-amber-500/15 via-graphite-800 to-graphite-800 border border-amber-500/30 rounded-2xl p-4 sm:p-5 flex items-center justify-between gap-4 shadow-sm shrink-0">
          <div className="flex items-center gap-3.5">
            <div className="p-3 bg-amber-500/20 text-amber-400 rounded-xl shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-xs sm:text-[13px] font-bold text-vapor-100 uppercase tracking-wide flex items-center gap-2 flex-wrap">
                <span>Modelos Prontos & Validados Juridicamente</span>
                <span className="px-2 py-0.5 rounded text-[9.5px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  SUGESTÕES DA PLATAFORMA
                </span>
              </h4>
              <p className="text-[12px] text-vapor-300 mt-1 leading-relaxed">
                Proteja sua oficina com termos de responsabilidade (falhas ocultas, pertences, pátio) e garantias técnicas especializadas por serviço. Baixe o documento ou ative diretamente na oficina com 1 clique!
              </p>
            </div>
          </div>
        </div>

        {/* Barra de Filtros & Abas - Fixa suavemente no topo durante scroll */}
        <div className="sticky -top-4 sm:-top-7 z-10 bg-graphite-800/95 backdrop-blur-md pt-2 pb-3 border-b border-graphite-700/80 -mx-4 px-4 sm:-mx-7 sm:px-7 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            {/* Abas Principais */}
            <div className="flex items-center bg-graphite-900 p-1 rounded-xl border border-graphite-700 shrink-0">
              <button
                type="button"
                onClick={() => setAbaAtiva('todos')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                  abaAtiva === 'todos'
                    ? 'bg-amber-500 text-graphite-950 font-bold shadow'
                    : 'text-vapor-400 hover:text-vapor-200'
                }`}
              >
                Todos ({modelos.length})
              </button>
              <button
                type="button"
                onClick={() => setAbaAtiva('responsabilidade')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                  abaAtiva === 'responsabilidade'
                    ? 'bg-amber-500 text-graphite-950 font-bold shadow'
                    : 'text-vapor-400 hover:text-vapor-200'
                }`}
              >
                Responsabilidade & Falhas Ocultas
              </button>
              <button
                type="button"
                onClick={() => setAbaAtiva('garantia')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                  abaAtiva === 'garantia'
                    ? 'bg-amber-500 text-graphite-950 font-bold shadow'
                    : 'text-vapor-400 hover:text-vapor-200'
                }`}
              >
                Termos de Garantia
              </button>
            </div>

            {/* Campo de Busca */}
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-vapor-500" />
              <input
                type="text"
                placeholder="Buscar modelos ou cláusulas..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="w-full pl-8 pr-7 py-2 bg-graphite-900 border border-graphite-700 rounded-xl text-xs text-vapor-100 placeholder-vapor-500 focus:outline-none focus:border-amber-500 transition-colors"
              />
              {busca && (
                <button
                  type="button"
                  onClick={() => setBusca('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-vapor-500 hover:text-vapor-300"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Sub-filtro por Serviço (se aba garantia estiver ativa) */}
          {abaAtiva === 'garantia' && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
              <button
                type="button"
                onClick={() => setFiltroServico('todos')}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap transition border ${
                  filtroServico === 'todos'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold'
                    : 'bg-graphite-900 text-vapor-400 hover:text-vapor-200 border-graphite-700'
                }`}
              >
                Todos os Serviços
              </button>
              {TIPOS_TERMOS_GARANTIA.map((t) => (
                <button
                  key={t.tipo}
                  type="button"
                  onClick={() => setFiltroServico(t.tipo)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap transition border ${
                    filtroServico === t.tipo
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold'
                      : 'bg-graphite-900 text-vapor-400 hover:text-vapor-200 border-graphite-700'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Lista de Modelos - Espaçosa, arejada e sem corte de botões */}
        <div className="flex flex-col gap-5 pt-1 pb-4">
          {loading ? (
            <div className="flex flex-col gap-4 py-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-44 rounded-2xl bg-graphite-900 border border-graphite-700 animate-pulse" />
              ))}
            </div>
          ) : modelosFiltrados.length === 0 ? (
            <div className="text-center py-16 px-4 rounded-2xl bg-graphite-900/60 border border-graphite-700 flex flex-col items-center justify-center gap-2">
              <Scale className="w-10 h-10 text-vapor-600" />
              <p className="text-sm font-bold text-vapor-200">Nenhum modelo encontrado</p>
              <p className="text-xs text-vapor-500">
                {busca ? 'Tente buscar com outros termos.' : 'Nenhum modelo cadastrado nesta categoria no momento.'}
              </p>
            </div>
          ) : (
            modelosFiltrados.map((modelo) => {
              const estaExpandido = Boolean(expandidos[modelo.id]);
              const termoAtivo = obterTermoAtivoCorrespondente(modelo);
              const isAtivoNaOficina = Boolean(termoAtivo);

              const rotuloServico =
                modelo.categoria === 'garantia'
                  ? TIPOS_TERMOS_GARANTIA.find((t) => t.tipo === modelo.tipo_servico)?.label ||
                    modelo.tipo_servico ||
                    'Geral'
                  : null;

              return (
                <div
                  key={modelo.id}
                  className={`p-5 sm:p-6 rounded-2xl border transition-all shadow-md flex flex-col gap-4 ${
                    isAtivoNaOficina
                      ? 'bg-graphite-900/95 border-emerald-500/60 shadow-emerald-500/5 ring-1 ring-emerald-500/20'
                      : modelo.destaque
                      ? 'bg-gradient-to-b from-graphite-850 to-graphite-900 border-amber-500/40 shadow-amber-500/5'
                      : 'bg-graphite-900/90 border-graphite-700 hover:border-graphite-600'
                  }`}
                >
                  {/* Topo do Card: Badges e Título */}
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="flex flex-col gap-2 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`text-[10.5px] font-mono font-bold px-2.5 py-0.5 rounded-md border uppercase tracking-wider ${
                            modelo.categoria === 'responsabilidade'
                              ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                              : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30'
                          }`}
                        >
                          {modelo.categoria === 'responsabilidade' ? 'Responsabilidade Geral' : 'Garantia Técnica'}
                        </span>

                        {rotuloServico && (
                          <span className="text-[10.5px] font-mono font-semibold px-2 py-0.5 rounded-md bg-graphite-800 text-vapor-300 border border-graphite-700">
                            {rotuloServico}
                          </span>
                        )}

                        {modelo.destaque && (
                          <span className="text-[10.5px] font-mono font-bold px-2.5 py-0.5 rounded-md bg-yellow-500/10 text-yellow-300 border border-yellow-500/30 flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-yellow-400" />
                            Sugerido CDC
                          </span>
                        )}

                        {isAtivoNaOficina && (
                          <span className="text-[11px] font-mono font-bold px-3 py-1 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 flex items-center gap-1.5 shadow-sm">
                            <CheckCircle2 size={13} className="text-emerald-400" />
                            ATIVO NA SUA OFICINA
                          </span>
                        )}
                      </div>

                      <h3 className="font-heading font-bold text-base sm:text-[17px] text-vapor-100">
                        {modelo.titulo}
                      </h3>

                      {modelo.descricao && (
                        <p className="text-xs sm:text-[13px] text-vapor-400 leading-relaxed">{modelo.descricao}</p>
                      )}
                    </div>

                    {/* Contadores da Plataforma */}
                    <div className="hidden sm:flex flex-col items-end text-[11px] font-mono text-vapor-400 shrink-0">
                      <span>{modelo.aplicacoes_count || 0} oficinas utilizam</span>
                      {modelo.downloads_count > 0 && (
                        <span className="text-vapor-500">{modelo.downloads_count} downloads</span>
                      )}
                    </div>
                  </div>

                  {/* Conteúdo em Cláusulas com expansão visual */}
                  <div className="bg-graphite-950/80 rounded-xl p-4 border border-graphite-800">
                    <div className="flex items-start gap-2.5">
                      <Quote className="w-4 h-4 text-amber-500/60 shrink-0 mt-0.5" />
                      <p
                        className={`text-xs text-vapor-300 font-sans leading-relaxed whitespace-pre-line flex-1 ${
                          !estaExpandido ? 'line-clamp-2' : ''
                        }`}
                      >
                        {modelo.conteudo_texto}
                      </p>
                    </div>

                    <div className="flex items-center justify-between pt-3 mt-3 border-t border-graphite-800/80 text-[11.5px]">
                      <button
                        type="button"
                        onClick={() => toggleExpandir(modelo.id)}
                        className="text-amber-400 hover:text-amber-300 flex items-center gap-1.5 font-semibold transition-colors"
                      >
                        {estaExpandido ? (
                          <>
                            <ChevronUp className="w-3.5 h-3.5" />
                            <span>Recolher Cláusulas</span>
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-3.5 h-3.5" />
                            <span>Ler Cláusulas Completas ({modelo.conteudo_texto.length} caracteres)</span>
                          </>
                        )}
                      </button>

                      {modelo.permitir_download !== false && (
                        <button
                          type="button"
                          onClick={() => handleCopiar(modelo.id, modelo.conteudo_texto)}
                          className="text-vapor-400 hover:text-vapor-200 flex items-center gap-1.5 font-medium transition-colors"
                        >
                          {copiadoId === modelo.id ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="text-emerald-400 font-semibold">Copiado!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copiar Texto</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Ações do Card: Download e Ativação Única / Desativação com margem e destaque */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-3 border-t border-graphite-800/80">
                    {/* Opção A: Download do Arquivo */}
                    {modelo.permitir_download !== false ? (
                      <button
                        type="button"
                        onClick={() => handleDownloadArquivo(modelo)}
                        className="text-xs font-semibold h-10 px-4 rounded-xl bg-graphite-950 hover:bg-graphite-800 border border-graphite-700 text-vapor-300 hover:text-white flex items-center justify-center gap-2 transition"
                        title={modelo.arquivo_url ? 'Baixar documento original em Word/PDF' : 'Baixar texto do modelo'}
                      >
                        <Download className="w-4 h-4 text-amber-400" />
                        <span>{modelo.arquivo_url ? `Baixar ${modelo.arquivo_tipo?.toUpperCase() || 'Arquivo'}` : 'Baixar (.txt)'}</span>
                      </button>
                    ) : (
                      <div className="flex items-center gap-2 text-xs text-vapor-500 bg-graphite-950/60 px-3.5 py-2.5 rounded-xl border border-graphite-800">
                        <Lock className="w-3.5 h-3.5 text-amber-500/70" />
                        <span>Exclusivo para uso interno da plataforma</span>
                      </div>
                    )}

                    {/* Opção B: Ativar ou Desativar (Apenas UMA opção exibida por vez) */}
                    {isAtivoNaOficina ? (
                      <button
                        type="button"
                        onClick={() => handleDesativarDaOficina(modelo, termoAtivo)}
                        disabled={desativandoId === modelo.id}
                        className="text-xs font-bold h-10 px-5 rounded-xl flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition shadow-sm hover:shadow"
                        title="Desativar este modelo da sua oficina"
                      >
                        {desativandoId === modelo.id ? (
                          <>
                            <RotateCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Desativando...</span>
                          </>
                        ) : (
                          <>
                            <PowerOff className="w-4 h-4" />
                            <span>
                              {modelo.categoria === 'responsabilidade'
                                ? 'Desativar este Termo Fixo'
                                : 'Desativar este Termo de Garantia'}
                            </span>
                          </>
                        )}
                      </button>
                    ) : (
                      <Button
                        type="button"
                        variant="primary"
                        onClick={() => handleAplicarNaOficina(modelo)}
                        disabled={aplicandoId === modelo.id}
                        className="text-xs font-bold h-10 px-6 flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-yellow-500 text-graphite-950 shadow-md hover:opacity-95 rounded-xl"
                      >
                        {aplicandoId === modelo.id ? (
                          <>
                            <RotateCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Ativando...</span>
                          </>
                        ) : (
                          <>
                            <Zap className="w-4 h-4 fill-current" />
                            <span>
                              {modelo.categoria === 'responsabilidade'
                                ? 'Ativar como Termo Fixo da Oficina'
                                : 'Ativar este Termo de Garantia'}
                            </span>
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </Modal>
  );
};
