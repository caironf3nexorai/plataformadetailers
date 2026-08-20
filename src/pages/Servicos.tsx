import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Servico, ServicoPreco, ServicoModelo } from '../types/servicos';
import { formatFaixaPreco } from '../utils/precos';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { ServiceChip } from '../components/ui/ServiceChip';
import { CopyLinkButton } from '../components/ui/CopyLinkButton';
import { ModalConfirmacao } from '../components/ui/ModalConfirmacao';
import { 
  Plus, 
  Globe, 
  Sparkles, 
  AlertTriangle,
  FileSpreadsheet,
  SprayCan,
  Pencil,
  Upload,
  Trash,
  Package
} from 'lucide-react';
import { GerenciadorCombos } from '../components/servicos/GerenciadorCombos';
import {
  slugifyGrupo,
  validateImageFile,
  getFotoPublicUrl,
  fotoDoServico
} from '../utils/imagens';

interface ServicoComPrecos extends Servico {
  servico_precos: ServicoPreco[];
}

export const Servicos: React.FC = () => {
  const { tenant, membership } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'servicos' | 'combos'>('servicos');
  const [services, setServices] = useState<ServicoComPrecos[]>([]);
  const [modelos, setModelos] = useState<ServicoModelo[]>([]);
  const [selectedModelos, setSelectedModelos] = useState<string[]>([]);
  const [grupoFotos, setGrupoFotos] = useState<Record<string, string>>({});
  const [submittingOnboarding, setSubmittingOnboarding] = useState(false);
  const [uploadingGrupo, setUploadingGrupo] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Ações em massa
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [submittingMassa, setSubmittingMassa] = useState(false);
  const [confirmMassa, setConfirmMassa] = useState<{
    isOpen: boolean;
    campo: 'ativo' | 'publico';
    valor: boolean;
    label: string;
  }>({
    isOpen: false,
    campo: 'ativo',
    valor: true,
    label: '',
  });

  const canManage = membership?.role === 'dono' || membership?.role === 'gerente';
  
  // Se o usuário clicar em "Prefiro cadastrar do zero", ocultamos temporariamente o onboarding
  const [forceHideOnboarding, setForceHideOnboarding] = useState(false);

  const fetchServicesAndModels = async () => {
    if (!tenant) return;
    setLoading(true);
    setErrorMsg(null);

    try {
      // 1. Busca serviços cadastrados com seus preços
      const { data: servs, error: sErr } = await supabase
        .from('servicos')
        .select('*, servico_precos(*)')
        .order('ordem', { ascending: true });

      if (sErr) throw sErr;
      setServices(servs as ServicoComPrecos[]);

      // 2. Busca modelos do catálogo global
      const { data: mods, error: mErr } = await supabase
        .from('servicos_modelo')
        .select('*')
        .order('ordem', { ascending: true });

      if (mErr) throw mErr;
      setModelos(mods as ServicoModelo[]);

      // 3. Busca fotos de grupos cadastradas
      const { data: gPhotos, error: gErr } = await supabase
        .from('tenant_grupo_fotos')
        .select('*')
        .eq('tenant_id', tenant.id);

      if (!gErr && gPhotos) {
        const mapping = gPhotos.reduce<Record<string, string>>((acc, curr) => {
          acc[curr.grupo] = curr.foto_path;
          acc[curr.grupo_slug] = curr.foto_path;
          return acc;
        }, {});
        setGrupoFotos(mapping);
      }

      // Pré-seleciona todos os modelos por padrão no onboarding
      if (mods) {
        setSelectedModelos(mods.map((m) => m.id));
      }
    } catch (err: any) {
      console.error('[Servicos Fetch Error]:', err);
      setErrorMsg(err.message || 'Erro ao carregar dados dos serviços.');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleService = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleToggleGroup = (grupoServiceIds: string[]) => {
    const isAllGroupSelected = grupoServiceIds.length > 0 && grupoServiceIds.every((id) => selectedIds.includes(id));
    if (isAllGroupSelected) {
      setSelectedIds((prev) => prev.filter((id) => !grupoServiceIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...grupoServiceIds])));
    }
  };

  const abrirConfirmacaoMassa = (campo: 'ativo' | 'publico', valor: boolean, label: string) => {
    if (selectedIds.length === 0) return;
    setConfirmMassa({
      isOpen: true,
      campo,
      valor,
      label,
    });
  };

  const executarAcaoEmMassa = async () => {
    if (selectedIds.length === 0) return;

    setSubmittingMassa(true);
    setErrorMsg(null);

    try {
      const { error } = await supabase.rpc('atualizar_servicos_em_massa', {
        p_ids: selectedIds,
        p_campo: confirmMassa.campo,
        p_valor: confirmMassa.valor,
      });

      if (error) throw error;

      setSelectedIds([]);
      setConfirmMassa((prev) => ({ ...prev, isOpen: false }));
      await fetchServicesAndModels();
    } catch (err: any) {
      console.error('[Ação em massa Error]:', err);
      setErrorMsg(err.message || 'Erro ao realizar ação em massa.');
    } finally {
      setSubmittingMassa(false);
    }
  };

  const handleGrupoFotoUpload = async (grupo: string, e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0 || !tenant) return;
    const file = e.target.files[0];
    setErrorMsg(null);

    if (file.size > 2 * 1024 * 1024) {
      setErrorMsg('A imagem deve ter no máximo 2MB.');
      return;
    }

    const { valid, ext, error } = validateImageFile(file);
    if (!valid || !ext) {
      setErrorMsg(error || 'Formato inválido.');
      return;
    }

    setUploadingGrupo(grupo);
    const grupoSlug = slugifyGrupo(grupo);
    const newPath = `${tenant.id}/grupos/${grupoSlug}.${ext}`;

    try {
      const oldPath = grupoFotos[grupo] || grupoFotos[grupoSlug];
      if (oldPath && oldPath !== newPath) {
        await supabase.storage.from('catalogo').remove([oldPath]);
      }

      const { error: uploadError } = await supabase.storage
        .from('catalogo')
        .upload(newPath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { error: dbError } = await supabase
        .from('tenant_grupo_fotos')
        .upsert({
          tenant_id: tenant.id,
          grupo,
          grupo_slug: grupoSlug,
          foto_path: newPath,
          updated_at: new Date().toISOString(),
        });

      if (dbError) throw dbError;

      await fetchServicesAndModels();
    } catch (err: any) {
      console.error('[Grupo Foto Upload Error]:', err);
      setErrorMsg(err.message || 'Erro ao salvar foto do grupo.');
    } finally {
      setUploadingGrupo(null);
    }
  };

  const handleRemoveGrupoFoto = async (grupo: string) => {
    if (!tenant) return;
    const grupoSlug = slugifyGrupo(grupo);
    const oldPath = grupoFotos[grupo] || grupoFotos[grupoSlug];
    if (!oldPath) return;

    setErrorMsg(null);
    setUploadingGrupo(grupo);

    try {
      await supabase.storage.from('catalogo').remove([oldPath]);

      const { error: dbError } = await supabase
        .from('tenant_grupo_fotos')
        .delete()
        .eq('tenant_id', tenant.id)
        .eq('grupo_slug', grupoSlug);

      if (dbError) throw dbError;

      await fetchServicesAndModels();
    } catch (err: any) {
      console.error('[Remove Grupo Foto Error]:', err);
      setErrorMsg(err.message || 'Erro ao remover foto do grupo.');
    } finally {
      setUploadingGrupo(null);
    }
  };

  useEffect(() => {
    fetchServicesAndModels();
  }, [tenant?.id]);

  const handleToggleModel = (id: string) => {
    setSelectedModelos((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSemear = async () => {
    if (selectedModelos.length === 0) {
      setErrorMsg('Selecione ao menos um serviço para adicionar.');
      return;
    }

    setSubmittingOnboarding(true);
    setErrorMsg(null);

    try {
      const { error } = await supabase.rpc('semear_servicos', {
        p_modelo_ids: selectedModelos,
      });

      if (error) throw error;

      // Recarrega serviços cadastrados
      await fetchServicesAndModels();
    } catch (err: any) {
      console.error('[Semear Error]:', err);
      setErrorMsg(err.message || 'Erro ao importar serviços selecionados.');
    } finally {
      setSubmittingOnboarding(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 p-6 flex flex-col gap-6 animate-pulse">
        <div className="h-8 bg-graphite-700 w-48 rounded" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="h-32 bg-graphite-700 rounded" />
          <div className="h-32 bg-graphite-700 rounded" />
          <div className="h-32 bg-graphite-700 rounded" />
        </div>
      </div>
    );
  }

  // Agrupa os serviços cadastrados por grupo
  const activeServices = services.filter((s) => s.ativo);
  const inactiveServices = services.filter((s) => !s.ativo);

  const agruparPorGrupo = (lista: ServicoComPrecos[]) => {
    return lista.reduce<Record<string, ServicoComPrecos[]>>((acc, s) => {
      const g = s.grupo || 'Geral';
      if (!acc[g]) acc[g] = [];
      acc[g].push(s);
      return acc;
    }, {});
  };

  const gruposAtivos = agruparPorGrupo(activeServices);

  // Define se exibe o estado de onboarding/catálogo pronto
  const exibirOnboarding = services.length === 0 && !forceHideOnboarding;

  if (exibirOnboarding) {
    // Agrupa modelos por grupo para exibição organizada no onboarding
    const modelosPorGrupo = modelos.reduce<Record<string, ServicoModelo[]>>((acc, m) => {
      const g = m.grupo || 'Geral';
      if (!acc[g]) acc[g] = [];
      acc[g].push(m);
      return acc;
    }, {});

    return (
      <div className="flex-1 p-6 max-w-4xl mx-auto flex flex-col gap-6">
        <div className="flex flex-col gap-1.5 border-b border-graphite-700 pb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="text-amber-500" size={24} />
            <h1 className="font-display text-[22px] text-vapor-100 uppercase tracking-wide">
              Configurar Catálogo de Serviços
            </h1>
          </div>
          <p className="font-sans text-[14px] text-vapor-400">
            Comece pelo catálogo pronto. Marque os serviços que você faz e ajuste os preços depois. Você pode editar tudo.
          </p>
        </div>

        {errorMsg && (
          <div className="p-3.5 bg-flare-400/10 border border-flare-400/30 rounded flex items-center gap-2 text-flare-400 text-[13px]">
            <AlertTriangle size={18} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="flex flex-col gap-6">
          {Object.entries(modelosPorGrupo).map(([grupo, lista]) => (
            <div key={grupo} className="flex flex-col gap-3">
              <h3 className="font-display text-[14px] text-vapor-300 uppercase tracking-widest border-l-2 border-amber-500 pl-2">
                {grupo}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {lista.map((mod) => {
                  const isChecked = selectedModelos.includes(mod.id);
                  return (
                    <label
                      key={mod.id}
                      className={`p-4 rounded border transition-all cursor-pointer flex items-start gap-3 select-none ${
                        isChecked
                          ? 'bg-graphite-900 border-amber-500'
                          : 'bg-graphite-800/50 border-graphite-700 hover:border-graphite-600'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleModel(mod.id)}
                        className="mt-1 w-4 h-4 accent-amber-500 rounded bg-graphite-900 border-graphite-600"
                      />
                      <div className="flex-1 flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <span className="font-sans text-[14px] font-bold text-vapor-100">
                            {mod.nome}
                          </span>
                          <span className="font-mono text-[10px] text-vapor-400 tracking-wider">
                            {mod.codigo}
                          </span>
                        </div>
                        {mod.descricao_publica && (
                          <p className="font-sans text-[12px] text-vapor-400 leading-relaxed truncate max-w-[280px]">
                            {mod.descricao_publica}
                          </p>
                        )}
                        <span className="font-sans text-[11px] text-amber-500/80">
                          Sugerido: {mod.duracao_sugerida} min
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 pt-4 border-t border-graphite-700">
          <button
            type="button"
            onClick={() => setForceHideOnboarding(true)}
            className="font-sans text-[13px] text-vapor-400 hover:text-vapor-100 underline decoration-dotted transition-colors"
          >
            Prefiro cadastrar do zero
          </button>
          
          <Button
            type="button"
            variant="primary"
            disabled={submittingOnboarding}
            onClick={handleSemear}
            className="w-full sm:w-auto font-semibold min-h-[48px] px-8"
          >
            {submittingOnboarding ? (
              'Adicionando...'
            ) : (
              <>
                <Plus size={18} />
                Adicionar {selectedModelos.length} selecionados
              </>
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-6 flex flex-col gap-6 max-w-6xl mx-auto pb-24">
      {/* Topo com ações */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-graphite-700 pb-4">
        <div className="flex items-center gap-2">
          <SprayCan className="text-amber-500" size={24} />
          <h1 className="font-display text-[22px] text-vapor-100 uppercase tracking-wide">
            Catálogo de Serviços
          </h1>
        </div>
        
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <CopyLinkButton slug={tenant?.slug} />

          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate('/servicos/precos')}
            className="flex-1 sm:flex-initial text-vapor-200 border-graphite-600 hover:bg-graphite-700"
          >
            <FileSpreadsheet size={16} />
            Editar Preços
          </Button>

          <Button
            type="button"
            variant="primary"
            onClick={() => navigate('/servicos/novo')}
            className="flex-1 sm:flex-initial font-semibold"
          >
            <Plus size={16} />
            Novo Serviço
          </Button>
        </div>
      </div>

      {/* Navegação por Abas: Serviços x Combos */}
      <div className="flex items-center gap-2 border-b border-graphite-700 pb-px">
        <button
          type="button"
          onClick={() => setActiveTab('servicos')}
          className={`px-4 py-2.5 font-display text-[13px] uppercase tracking-wider font-bold transition-all border-b-2 min-h-[44px] flex items-center gap-2 ${
            activeTab === 'servicos'
              ? 'border-amber-500 text-amber-400 bg-amber-500/5'
              : 'border-transparent text-vapor-400 hover:text-vapor-200'
          }`}
        >
          <SprayCan size={16} />
          <span>Serviços Individuais ({services.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('combos')}
          className={`px-4 py-2.5 font-display text-[13px] uppercase tracking-wider font-bold transition-all border-b-2 min-h-[44px] flex items-center gap-2 ${
            activeTab === 'combos'
              ? 'border-amber-500 text-amber-400 bg-amber-500/5'
              : 'border-transparent text-vapor-400 hover:text-vapor-200'
          }`}
        >
          <Package size={16} />
          <span>Combos & Pacotes</span>
        </button>
      </div>

      {errorMsg && (
        <div className="p-3.5 bg-flare-400/10 border border-flare-400/30 rounded flex items-center gap-2 text-flare-400 text-[13px]">
          <AlertTriangle size={18} className="shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Conteúdo da Aba Ativa */}
      {activeTab === 'combos' ? (
        <GerenciadorCombos />
      ) : (
        <>
          {/* Lista Principal de Serviços Agrupada */}
      {activeServices.length === 0 ? (
        <div className="p-8 text-center bg-graphite-800/30 border border-dashed border-graphite-700 rounded-lg flex flex-col items-center justify-center gap-3">
          <p className="font-sans text-[14px] text-vapor-400">
            Nenhum serviço ativo cadastrado.
          </p>
          <Button
            type="button"
            variant="primary"
            onClick={() => navigate('/servicos/novo')}
            className="font-semibold"
          >
            Criar Primeiro Serviço
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {Object.entries(gruposAtivos).map(([grupo, lista]) => {
            const grupoSlug = slugifyGrupo(grupo);
            const fotoGrupoPath = grupoFotos[grupo] || grupoFotos[grupoSlug];
            const fotoGrupoUrl = getFotoPublicUrl(fotoGrupoPath);

            const grupoServiceIds = lista.map((s) => s.id);
            const isAllGroupSelected = grupoServiceIds.length > 0 && grupoServiceIds.every((id) => selectedIds.includes(id));

            return (
              <div key={grupo} className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-graphite-700 pb-2">
                  <div className="flex items-center gap-3">
                    {canManage && (
                      <input
                        type="checkbox"
                        checked={isAllGroupSelected}
                        onChange={() => handleToggleGroup(grupoServiceIds)}
                        className="w-4 h-4 accent-amber-500 rounded bg-graphite-900 border-graphite-600 cursor-pointer shrink-0"
                        title="Selecionar todos do grupo"
                      />
                    )}
                    <h3 className="font-display text-[14px] text-vapor-300 uppercase tracking-widest border-l-2 border-amber-500 pl-2.5">
                      {grupo}
                    </h3>
                    {fotoGrupoUrl && (
                      <img
                        src={fotoGrupoUrl}
                        alt={`Foto do grupo ${grupo}`}
                        className="w-7 h-7 object-cover rounded border border-graphite-600 shrink-0"
                      />
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <label className="font-sans text-[12px] text-vapor-400 hover:text-amber-500 cursor-pointer transition-colors flex items-center gap-1.5 select-none">
                      <Upload size={13} />
                      <span>{uploadingGrupo === grupo ? 'Enviando...' : fotoGrupoPath ? 'Alterar foto do grupo' : 'Definir foto do grupo'}</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/jpg,image/png,image/webp"
                        onChange={(e) => handleGrupoFotoUpload(grupo, e)}
                        disabled={uploadingGrupo === grupo}
                        className="hidden"
                      />
                    </label>
                    {fotoGrupoPath && (
                      <button
                        type="button"
                        onClick={() => handleRemoveGrupoFoto(grupo)}
                        disabled={uploadingGrupo === grupo}
                        className="text-vapor-400 hover:text-flare-400 p-1 rounded transition-colors"
                        title="Remover foto do grupo"
                      >
                        <Trash size={13} />
                      </button>
                    )}
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {lista.map((serv) => {
                    const precosArray = serv.servico_precos.map((p) => p.preco_base);
                    const faixaTexto = formatFaixaPreco(precosArray, serv.sob_consulta);
                    const possuiEstimado = serv.servico_precos.some((p) => !p.duracao_confirmada);
                    const fotoResolvedUrl = fotoDoServico(serv, grupoFotos, tenant?.capa_path);
                    const isSelected = selectedIds.includes(serv.id);

                    return (
                      <Card
                        key={serv.id}
                        className={`p-4 bg-graphite-800 border-graphite-600 hover:border-graphite-500 transition-all flex flex-col justify-between gap-4 cursor-pointer group ${
                          isSelected ? 'border-amber-500 bg-amber-500/5' : ''
                        }`}
                        onClick={() => navigate(`/servicos/${serv.id}`)}
                      >
                        <div className="flex items-start gap-3">
                          {canManage && (
                            <div
                              className="shrink-0 pt-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleService(serv.id)}
                                className="w-4 h-4 accent-amber-500 rounded bg-graphite-900 border-graphite-600 cursor-pointer"
                              />
                            </div>
                          )}

                          {/* Imagem em Cascata */}
                          <img
                            src={fotoResolvedUrl}
                            alt={serv.nome}
                            className="w-16 h-16 object-cover rounded border border-graphite-600 shrink-0 group-hover:border-amber-500/50 transition-colors"
                          />

                          <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <ServiceChip
                                  code={serv.codigo}
                                  label={serv.nome}
                                  tone={serv.tom}
                                />
                              </div>

                              {/* Badges de Ocupação & Público */}
                              <div className="flex flex-wrap gap-1 justify-end shrink-0">
                                {serv.publico && (
                                  <Badge tone="mint">
                                    <span className="flex items-center gap-1">
                                      <Globe size={10} />
                                      Público
                                    </span>
                                  </Badge>
                                )}
                                {serv.modo_ocupacao === 'dia_inteiro' && (
                                  <Badge tone="amber">Dia Inteiro</Badge>
                                )}
                                {serv.modo_ocupacao === 'multiplos_dias' && (
                                  <Badge tone="glass">{serv.dias_ocupados} dias</Badge>
                                )}
                              </div>
                            </div>

                            {serv.descricao_publica && (
                              <p className="font-sans text-[12px] text-vapor-400 leading-relaxed line-clamp-2">
                                {serv.descricao_publica}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between border-t border-graphite-700 pt-3 mt-1">
                          <span className="font-sans text-[14px] text-vapor-100 font-semibold flex items-center gap-1">
                            <span className="text-[12px] text-vapor-400 font-normal">A partir de</span>
                            <span className="font-mono text-amber-500">{faixaTexto.replace('A partir de', '')}</span>
                          </span>
                          
                          <div className="flex items-center gap-3">
                            {possuiEstimado && (
                              <span className="font-sans text-[11px] text-amber-500 flex items-center gap-1" title="Duração estimada — confirme com o seu tempo real">
                                <AlertTriangle size={12} className="shrink-0" />
                                Estimado
                              </span>
                            )}
                            <span className="text-[11px] text-vapor-400 group-hover:text-amber-500 font-medium transition-colors flex items-center gap-1">
                              <Pencil size={11} />
                              Editar
                            </span>
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Seção Inativos se houver */}
      {inactiveServices.length > 0 && (
        <div className="mt-8 pt-6 border-t border-graphite-700 flex flex-col gap-4">
          <h3 className="font-display text-[13px] text-vapor-500 uppercase tracking-widest">
            Serviços Inativos ({inactiveServices.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {inactiveServices.map((serv) => {
              const isSelected = selectedIds.includes(serv.id);
              return (
                <Card
                  key={serv.id}
                  className={`p-4 bg-graphite-800/40 border-graphite-700 flex items-center justify-between cursor-pointer hover:bg-graphite-800 ${
                    isSelected ? 'border-amber-500 bg-amber-500/10' : ''
                  }`}
                  onClick={() => navigate(`/servicos/${serv.id}`)}
                >
                  <div className="flex items-center gap-3">
                    {canManage && (
                      <div
                        className="shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleService(serv.id)}
                          className="w-4 h-4 accent-amber-500 rounded bg-graphite-900 border-graphite-600 cursor-pointer"
                        />
                      </div>
                    )}
                    <ServiceChip code={serv.codigo} tone="vapor" />
                    <span className="font-sans text-[14px] text-vapor-300">{serv.nome}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-sans text-[12px] text-vapor-500">Inativo</span>
                    <span className="text-[11px] text-vapor-400 hover:text-amber-500 font-medium transition-colors flex items-center gap-1">
                      <Pencil size={11} />
                      Editar
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Barra de Ações em Massa Fixa */}
      {canManage && selectedIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-graphite-900 border border-graphite-600 shadow-2xl rounded-xl px-5 py-3.5 flex flex-wrap items-center gap-4 animate-in fade-in slide-in-from-bottom-4 max-w-full mx-4">
          <span className="font-sans text-[13px] font-semibold text-vapor-100 border-r border-graphite-700 pr-4 shrink-0">
            <strong className="text-amber-400 font-mono text-[14px]">{selectedIds.length}</strong> serviço(s) selecionado(s)
          </span>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={submittingMassa}
              onClick={() => abrirConfirmacaoMassa('ativo', true, 'Ativar')}
              className="text-[12px] h-9 px-3 border-graphite-600 hover:bg-graphite-700 text-vapor-100"
            >
              Ativar
            </Button>

            <Button
              type="button"
              variant="secondary"
              disabled={submittingMassa}
              onClick={() => abrirConfirmacaoMassa('ativo', false, 'Desativar')}
              className="text-[12px] h-9 px-3 border-graphite-600 hover:bg-graphite-700 text-flare-400 hover:text-flare-300"
            >
              Desativar
            </Button>

            <Button
              type="button"
              variant="secondary"
              disabled={submittingMassa}
              onClick={() => abrirConfirmacaoMassa('publico', true, 'Publicar no catálogo')}
              className="text-[12px] h-9 px-3 border-graphite-600 hover:bg-graphite-700 text-mint-400 hover:text-mint-300"
            >
              Publicar no catálogo
            </Button>

            <Button
              type="button"
              variant="secondary"
              disabled={submittingMassa}
              onClick={() => abrirConfirmacaoMassa('publico', false, 'Remover do catálogo')}
              className="text-[12px] h-9 px-3 border-graphite-600 hover:bg-graphite-700 text-vapor-300"
            >
              Remover do catálogo
            </Button>

            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="text-[12px] font-sans text-vapor-400 hover:text-vapor-100 underline ml-2"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Modal de Confirmação no Padrão do Sistema */}
      <ModalConfirmacao
        isOpen={confirmMassa.isOpen}
        onClose={() => setConfirmMassa((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={executarAcaoEmMassa}
        title="Confirmar Ação em Massa"
        mensagem={
          <span>
            Deseja alterar <strong className="text-amber-400">{selectedIds.length} serviço(s)</strong> selecionado(s) para &quot;<strong className="text-vapor-100">{confirmMassa.label}</strong>&quot;?
          </span>
        }
        textoConfirmar="Confirmar Alteração"
        textoCancelar="Voltar"
        variant={confirmMassa.label.includes('Desativar') ? 'danger' : 'primary'}
        loading={submittingMassa}
      />
        </>
      )}
    </div>
  );
};
