import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import type { ServicoPreco, TomChip, ModoOcupacao } from '../../types/servicos';
import type { CategoriaVeiculo } from '../../types/clientes';
import { formatFaixaPreco } from '../../utils/precos';
import { gerarId } from '../../utils/uuid';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';
import { CampoNumerico } from '../../components/ui/CampoNumerico';
import { Badge } from '../../components/ui/Badge';
import { ServiceChip } from '../../components/ui/ServiceChip';
import { 
  ArrowLeft, 
  Save, 
  Upload, 
  Trash, 
  Globe, 
  Calendar, 
  AlertTriangle,
  CheckCircle,
  Sparkles,
  ShieldCheck
} from 'lucide-react';
import {
  slugifyGrupo,
  validateImageFile,
  comprimirImagemCatalogo,
  getFotoPublicUrl,
  DEFAULT_SERVICE_PLACEHOLDER
} from '../../utils/imagens';
import {
  type UnidadeDuracao,
  converterParaMinutos,
  converterDeMinutos,
  detectarUnidadeSugerida,
  OPCOES_UNIDADE_DURACAO
} from '../../utils/duracao';
import { AlertaErro } from '../../components/ui/AlertaErro';
import { ModalConfirmacao } from '../../components/ui/ModalConfirmacao';

const GRUPOS_SUGESTOES = [
  'Lavagem',
  'Polimento',
  'Higienização',
  'Proteção',
  'Vidros',
  'Motor',
  'Geral'
];

export const FormularioServico: React.FC = () => {
  const { tenant, membership } = useAuth();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = !!id && id !== 'novo';
  const canManage = !membership || membership.role === 'dono' || membership.role === 'gerente';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showModalExcluir, setShowModalExcluir] = useState(false);
  const [deletingServico, setDeletingServico] = useState(false);
  const [categories, setCategories] = useState<CategoriaVeiculo[]>([]);
  const [grupoFotos, setGrupoFotos] = useState<Record<string, string>>({});
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleExcluirServico = async () => {
    if (!id || !tenant) return;
    setDeletingServico(true);
    setErrorMsg(null);

    try {
      const { error } = await supabase.rpc('excluir_servico', {
        p_servico_id: id,
        p_tenant_id: tenant.id,
      });

      if (error) throw error;

      setShowModalExcluir(false);
      navigate('/servicos');
    } catch (err: any) {
      console.error('[Excluir Servico Error]:', err);
      setErrorMsg(err.message || 'Erro ao excluir serviço.');
    } finally {
      setDeletingServico(false);
    }
  };

  // Estados dos campos do serviço
  const [nome, setNome] = useState('');
  const [grupo, setGrupo] = useState('Geral');
  const [codigo, setCodigo] = useState('');
  const [tom, setTom] = useState<TomChip>('vapor');
  const [modoOcupacao, setModoOcupacao] = useState<ModoOcupacao>('slot');
  const [diasOcupados, setDiasOcupados] = useState(1);
  const [publico, setPublico] = useState(false);
  const [sobConsulta, setSobConsulta] = useState(false);
  const [descricaoPublica, setDescricaoPublica] = useState('');
  const [descricaoInterna, setDescricaoInterna] = useState('');
  const [fotoPath, setFotoPath] = useState<string | null>(null);
  const [ativo, setAtivo] = useState(true);
  const [checklistModeloId, setChecklistModeloId] = useState<string | null>(null);
  const [checklistModelos, setChecklistModelos] = useState<Array<{ id: string; nome: string }>>([]);

  // Estados de Garantia e Pós-Venda
  const [temGarantia, setTemGarantia] = useState(false);
  const [garantiaMeses, setGarantiaMeses] = useState<number>(12);
  const [garantiaIntervaloDias, setGarantiaIntervaloDias] = useState<number>(60);
  const [garantiaProdutoPadrao, setGarantiaProdutoPadrao] = useState('');
  const [garantiaCuidados, setGarantiaCuidados] = useState('');

  // Matriz de preços local para o serviço específico
  const [servicosDoTenant, setServicosDoTenant] = useState<Array<{ id: string; nome: string; grupo: string; ativo?: boolean }>>([]);
  const [unidadePadrao, setUnidadePadrao] = useState<UnidadeDuracao>('min');
  const [precosLocais, setPrecosLocais] = useState<
    Record<
      string,
      {
        preco_base: string;
        duracao_minutos: number;
        duracao_valor: string | number;
        unidade_duracao: UnidadeDuracao;
        duracao_confirmada: boolean;
      }
    >
  >({});

  const fetchServiceData = async () => {
    if (!tenant) return;
    setLoading(true);
    setErrorMsg(null);

    try {
      // 1. Busca fotos de grupo para resolução em cascata
      const { data: gPhotos } = await supabase
        .from('tenant_grupo_fotos')
        .select('*')
        .eq('tenant_id', tenant.id);

      if (gPhotos) {
        const mapping = gPhotos.reduce<Record<string, string>>((acc, curr) => {
          acc[curr.grupo] = curr.foto_path;
          acc[curr.grupo_slug] = curr.foto_path;
          return acc;
        }, {});
        setGrupoFotos(mapping);
      }

      // 2. Busca categorias de veículo ativas do tenant
      const { data: cats, error: cErr } = await supabase
        .from('categorias_veiculo')
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('ativo', true)
        .order('ordem', { ascending: true });

      if (cErr) throw cErr;
      setCategories(cats as CategoriaVeiculo[]);

      // 2b. Busca modelos de checklist da oficina
      const { data: modData } = await supabase
        .from('checklist_modelos')
        .select('id, nome')
        .eq('tenant_id', tenant.id)
        .eq('ativo', true);

      setChecklistModelos(modData || []);

      // 2c. Busca lista de serviços existentes para detecção de substituição de duração
      const { data: allSrvs } = await supabase
        .from('servicos')
        .select('id, nome, grupo, ativo')
        .eq('tenant_id', tenant.id);

      if (allSrvs) {
        setServicosDoTenant(allSrvs);
      }

      let existingPrices: ServicoPreco[] = [];
      let servicoUnidadeSalva: UnidadeDuracao = 'min';

      if (isEdit) {
        // 3. Busca dados do serviço se for edição pertencente a este tenant
        const { data: serv, error: sErr } = await supabase
          .from('servicos')
          .select('*, servico_precos(*)')
          .eq('id', id)
          .eq('tenant_id', tenant.id)
          .single();

        if (sErr) throw sErr;
        
        if (serv) {
          const s = serv as any;
          existingPrices = (serv as any).servico_precos || [];

          // Preenche campos
          setNome(s.nome);
          setGrupo(s.grupo || 'Geral');
          setCodigo(s.codigo || '');
          setTom(s.tom || 'vapor');
          setModoOcupacao(s.modo_ocupacao || 'slot');
          setDiasOcupados(s.dias_ocupados || 1);
          setPublico(s.publico || false);
          setSobConsulta(s.sob_consulta || false);
          setDescricaoPublica(s.descricao_publica || '');
          setDescricaoInterna(s.descricao_interna || '');
          setFotoPath(s.foto_path);
          setAtivo(s.ativo);
          setChecklistModeloId(s.checklist_modelo_id || null);
          setTemGarantia(s.tem_garantia || false);
          setGarantiaMeses(s.garantia_meses || 12);
          setGarantiaIntervaloDias(s.garantia_intervalo_dias || 60);
          setGarantiaProdutoPadrao(s.garantia_produto_padrao || '');
          setGarantiaCuidados(s.garantia_cuidados || '');

          if (s.unidade_duracao === 'dias' || s.unidade_duracao === 'horas' || s.unidade_duracao === 'min') {
            servicoUnidadeSalva = s.unidade_duracao;
            setUnidadePadrao(s.unidade_duracao);
          }
        }
      }

      // 4. Inicializa preços locais
      const initialPrices: typeof precosLocais = {};
      cats?.forEach((c) => {
        const matched = existingPrices.find((p) => p.categoria_id === c.id);
        const dMins = matched?.duracao_minutos ?? 60;
        const uDur = detectarUnidadeSugerida(
          dMins,
          modoOcupacao,
          matched?.unidade_duracao || servicoUnidadeSalva
        );
        const dValor = converterDeMinutos(dMins, uDur);

        initialPrices[c.id] = {
          preco_base: matched?.preco_base !== null && matched?.preco_base !== undefined ? String(matched.preco_base) : '',
          duracao_minutos: dMins,
          duracao_valor: dValor > 0 ? String(dValor) : '60',
          unidade_duracao: uDur,
          duracao_confirmada: matched?.duracao_confirmada || false,
        };
      });

      setPrecosLocais(initialPrices);
    } catch (err: any) {
      console.error('[FormularioServico Fetch Error]:', err);
      setErrorMsg(err.message || 'Erro ao carregar dados do serviço.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServiceData();
  }, [tenant?.id, id]);

  const handlePriceLocalChange = (catId: string, value: string) => {
    setPrecosLocais((prev) => {
      const updated = { ...prev[catId], preco_base: value };
      return { ...prev, [catId]: updated };
    });
  };

  const handleDuracaoValorChange = (catId: string, novoValor: string | number) => {
    setPrecosLocais((prev) => {
      const item = prev[catId] || {
        preco_base: '',
        duracao_minutos: 60,
        duracao_valor: '60',
        unidade_duracao: unidadePadrao,
        duracao_confirmada: false,
      };
      const mins = converterParaMinutos(Number(novoValor) || 0, item.unidade_duracao);
      if (item.unidade_duracao === 'dias') {
        const valDias = Number(novoValor) || 1;
        if (valDias > 1) {
          setModoOcupacao('multiplos_dias');
          setDiasOcupados(valDias);
        } else {
          setModoOcupacao((prev) => (prev === 'slot' ? 'dia_inteiro' : prev));
          setDiasOcupados(1);
        }
      }

      return {
        ...prev,
        [catId]: {
          ...item,
          duracao_valor: novoValor,
          duracao_minutos: mins,
          duracao_confirmada: true,
        },
      };
    });
  };

  const handleUnidadeCategoriaChange = (catId: string, novaUnidade: UnidadeDuracao) => {
    setPrecosLocais((prev) => {
      const item = prev[catId];
      if (!item) return prev;
      const novoValor = converterDeMinutos(item.duracao_minutos, novaUnidade);
      return {
        ...prev,
        [catId]: {
          ...item,
          unidade_duracao: novaUnidade,
          duracao_valor: novoValor > 0 ? String(novoValor) : '',
          duracao_confirmada: true,
        },
      };
    });
  };

  const handleMudarUnidadePadrao = (novaUnidade: UnidadeDuracao) => {
    setUnidadePadrao(novaUnidade);
    if (novaUnidade === 'dias') {
      setModoOcupacao((prev) => (prev === 'slot' ? 'dia_inteiro' : prev));
    }
    setPrecosLocais((prev) => {
      const updated: typeof prev = {};
      Object.entries(prev).forEach(([cId, item]) => {
        const novoValor = converterDeMinutos(item.duracao_minutos, novaUnidade);
        updated[cId] = {
          ...item,
          unidade_duracao: novaUnidade,
          duracao_valor: novoValor > 0 ? String(novoValor) : '',
          duracao_confirmada: true,
        };
      });
      return updated;
    });
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0 || !tenant) return;
    const file = e.target.files[0];
    setPhotoError(null);

    const { valid, error } = validateImageFile(file);
    if (!valid) {
      setPhotoError(error || 'Formato inválido. Use JPG, PNG ou WEBP.');
      return;
    }

    setUploadingPhoto(true);

    try {
      // Comprime no cliente para o menor tamanho possível sem perda visual (< 200KB)
      const { file: compressedFile, ext } = await comprimirImagemCatalogo(file, {
        maxDimension: 1200,
        targetMaxBytes: 200 * 1024,
      });

      const targetServiceId = isEdit ? id : (id === 'novo' ? gerarId() : id);
      const newPath = `${tenant.id}/servicos/${targetServiceId}/capa.${ext}`;

      if (fotoPath && fotoPath !== newPath) {
        await supabase.storage.from('catalogo').remove([fotoPath]);
      }

      const { error: uploadError } = await supabase.storage
        .from('catalogo')
        .upload(newPath, compressedFile, { upsert: true });

      if (uploadError) throw uploadError;

      setFotoPath(newPath);
    } catch (err: any) {
      console.error('[Upload Error]:', err);
      setPhotoError(err.message || 'Erro ao processar e enviar a imagem.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleRemovePhoto = async () => {
    if (!fotoPath) return;
    setPhotoError(null);
    setUploadingPhoto(true);
    try {
      await supabase.storage.from('catalogo').remove([fotoPath]);
      setFotoPath(null);
    } catch (err: any) {
      console.error('[Remove Photo Error]:', err);
      setPhotoError(err.message || 'Erro ao remover imagem.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    setErrorMsg(null);
    setSuccessMsg(null);

    const nomeFormatado = nome.trim();
    if (!nomeFormatado) {
      setErrorMsg('Nome do serviço é obrigatório.');
      return;
    }

    if (!tenant) {
      setErrorMsg('Sessão expirada. Recarregue a página.');
      return;
    }

    setSaving(true);

    try {
      let servicoId = id;

      // Sincroniza automaticamente modo_ocupacao e dias_ocupados com a duração configurada em dias
      let maxDiasCalculados = 1;
      let temDuracaoEmDias = unidadePadrao === 'dias';

      Object.values(precosLocais).forEach((item) => {
        if (item.unidade_duracao === 'dias' || item.duracao_minutos >= 480) {
          const d = Math.ceil(item.duracao_minutos / 480);
          if (d > maxDiasCalculados) maxDiasCalculados = d;
          if (item.unidade_duracao === 'dias') temDuracaoEmDias = true;
        }
      });

      let modoOcupacaoFinal = modoOcupacao;
      let diasOcupadosFinal = modoOcupacao === 'multiplos_dias' ? diasOcupados : 1;

      if (temDuracaoEmDias && maxDiasCalculados > 1) {
        modoOcupacaoFinal = 'multiplos_dias';
        diasOcupadosFinal = Math.max(diasOcupados, maxDiasCalculados);
      } else if (temDuracaoEmDias && maxDiasCalculados === 1 && modoOcupacao === 'slot') {
        modoOcupacaoFinal = 'dia_inteiro';
        diasOcupadosFinal = 1;
      }

      const payload = {
        tenant_id: tenant.id,
        nome: nomeFormatado,
        grupo: grupo.trim() || 'Geral',
        codigo: codigo.trim() || null,
        tom,
        modo_ocupacao: modoOcupacaoFinal,
        dias_ocupados: diasOcupadosFinal,
        publico,
        sob_consulta: sobConsulta,
        descricao_publica: descricaoPublica.trim() || null,
        descricao_interna: descricaoInterna.trim() || null,
        foto_path: fotoPath,
        unidade_duracao: unidadePadrao,
        ativo,
        checklist_modelo_id: checklistModeloId || null,
        tem_garantia: temGarantia,
        garantia_meses: temGarantia ? (Number(garantiaMeses) || 12) : null,
        garantia_intervalo_dias: temGarantia ? (Number(garantiaIntervaloDias) || 60) : null,
        garantia_produto_padrao: temGarantia ? (garantiaProdutoPadrao.trim() || null) : null,
        garantia_cuidados: temGarantia ? (garantiaCuidados.trim() || null) : null,
      };

      // 1. Identifica se já existe serviço com este mesmo nome no tenant
      const nomeNormalizado = nomeFormatado.trim().toLowerCase();

      let matchExistente = servicosDoTenant.find(
        (s) => s.nome.trim().toLowerCase() === nomeNormalizado
      );

      // Se não encontrou em memória, faz busca defensiva no banco com LIMIT 5 (evitando crash de maybeSingle)
      if (!matchExistente) {
        const { data: dbMatches } = await supabase
          .from('servicos')
          .select('id, nome, ativo, grupo')
          .eq('tenant_id', tenant.id)
          .ilike('nome', nomeFormatado)
          .limit(5);

        if (dbMatches && dbMatches.length > 0) {
          matchExistente = dbMatches.find((m) => m.ativo) || dbMatches[0];
        }
      }

      // Determina se vamos fazer UPDATE ou INSERT:
      // Se for edição OU se já existir um serviço com este nome no tenant, É UM UPDATE!
      const targetId = isEdit ? id : (matchExistente ? matchExistente.id : null);

      if (targetId) {
        // --- FLUXO 1: UPDATE GARANTIDO ---
        servicoId = targetId;

        // Se o nome coincidir com outro registro existente diferente de targetId, atualiza o que tem o nome
        if (matchExistente && matchExistente.id !== targetId) {
          console.warn('[FormularioServico] Nome coincide com outro registro existente. Atualizando o serviço correspondente:', matchExistente.id);
          servicoId = matchExistente.id;
        }

        const { error: sErr } = await supabase
          .from('servicos')
          .update({
            ...payload,
            ativo: isEdit ? ativo : true,
          })
          .eq('id', servicoId)
          .eq('tenant_id', tenant.id);

        if (sErr) {
          // Se mesmo o UPDATE falhar por unicidade (outro registro no banco com esse nome):
          if (
            sErr.code === '23505' ||
            sErr.message?.includes('duplicate key') ||
            sErr.message?.includes('servicos_tenant_id_nome')
          ) {
            console.warn('[FormularioServico] Update colidiu com unicidade. Buscando o registro conflitante para sobrescrever...');
            const { data: colididos } = await supabase
              .from('servicos')
              .select('id')
              .eq('tenant_id', tenant.id)
              .ilike('nome', nomeFormatado)
              .limit(1);

            if (colididos && colididos.length > 0) {
              servicoId = colididos[0].id;
              const { error: updErr } = await supabase
                .from('servicos')
                .update({
                  ...payload,
                  ativo: isEdit ? ativo : true,
                })
                .eq('id', servicoId)
                .eq('tenant_id', tenant.id);

              if (updErr) throw updErr;
            } else {
              throw sErr;
            }
          } else {
            throw sErr;
          }
        }
      } else {
        // --- FLUXO 2: NOVO SERVIÇO (INSERT) COM FALLBACK TRANSPARENTE PARA UPDATE ---
        const { data: newServ, error: sErr } = await supabase
          .from('servicos')
          .insert(payload)
          .select()
          .single();

        if (sErr) {
          // SE O INSERT FALHOU POR DUPLICIDADE (23505), NUNCA EXIBA ERRO!
          // Faz UPDATE direto no serviço existente que causou o conflito!
          if (
            sErr.code === '23505' ||
            sErr.message?.includes('duplicate key') ||
            sErr.message?.includes('servicos_tenant_id_nome')
          ) {
            console.warn('[FormularioServico] Insert colidiu por duplicidade. Executando UPDATE de recuperação no serviço existente...');
            const { data: colididos } = await supabase
              .from('servicos')
              .select('id')
              .eq('tenant_id', tenant.id)
              .ilike('nome', nomeFormatado)
              .limit(1);

            if (colididos && colididos.length > 0) {
              servicoId = colididos[0].id;
              const { error: updErr } = await supabase
                .from('servicos')
                .update({
                  ...payload,
                  ativo: true,
                })
                .eq('id', servicoId)
                .eq('tenant_id', tenant.id);

              if (updErr) throw updErr;
            } else {
              throw sErr;
            }
          } else {
            throw sErr;
          }
        } else {
          servicoId = newServ.id;
        }
      }

      // 2. Salva matriz de preços e tempos de execução para todas as categorias
      const pLinhas = categories.map((c) => {
        const local = precosLocais[c.id] || {
          preco_base: '',
          duracao_minutos: 60,
          duracao_valor: '60',
          unidade_duracao: unidadePadrao,
          duracao_confirmada: false,
        };
        return {
          categoria_id: c.id,
          preco_base: local.preco_base === '' ? null : Number(local.preco_base.replace(',', '.')),
          duracao_minutos: local.duracao_minutos,
          unidade_duracao: local.unidade_duracao,
          duracao_confirmada: true,
        };
      });

      const { error: mErr } = await supabase.rpc('salvar_matriz_precos', {
        p_servico: servicoId,
        p_linhas: pLinhas,
      });

      if (mErr) {
        console.warn('[FormularioServico] RPC salvar_matriz_precos retornou erro, executando upsert direto:', mErr);
        const promessas = pLinhas.map((linha) =>
          supabase.from('servico_precos').upsert(
            {
              tenant_id: tenant.id,
              servico_id: servicoId,
              categoria_id: linha.categoria_id,
              preco_base: linha.preco_base,
              duracao_minutos: linha.duracao_minutos,
              unidade_duracao: linha.unidade_duracao,
              duracao_confirmada: true,
              ativo: true,
            },
            { onConflict: 'servico_id,categoria_id' }
          )
        );
        await Promise.all(promessas);
      }

      setSuccessMsg('Serviço e tempos de execução atualizados com sucesso!');
      setTimeout(() => {
        navigate('/servicos');
      }, 1000);
    } catch (err: any) {
      console.error('[FormularioServico Submit Error]:', err);
      setErrorMsg(err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 p-6 flex flex-col gap-6 animate-pulse max-w-5xl mx-auto">
        <div className="h-8 bg-graphite-700 w-48 rounded" />
        <div className="h-64 bg-graphite-700 rounded" />
      </div>
    );
  }

  // Calcula valores de faixas de preço locais para o Preview do catálogo
  const pricesList = categories.map((c) => {
    const local = precosLocais[c.id];
    return local && local.preco_base !== '' ? Number(local.preco_base.replace(',', '.')) : null;
  });
  const previewFaixa = formatFaixaPreco(pricesList, sobConsulta);

  return (
    <div className="flex-1 p-6 flex flex-col gap-6 max-w-5xl mx-auto pb-12">
      {/* Cabeçalho */}
      <div className="flex items-center gap-3 border-b border-graphite-700 pb-4">
        <button
          type="button"
          onClick={() => {
            if (window.history.state && window.history.state.idx > 0) {
              navigate(-1);
            } else {
              navigate('/servicos');
            }
          }}
          className="p-2 text-vapor-400 hover:text-vapor-100 hover:bg-graphite-700 rounded transition-colors"
          title="Voltar para a página anterior"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="font-display text-[22px] text-vapor-100 uppercase tracking-wide">
            {isEdit ? 'Editar Serviço' : 'Novo Serviço'}
          </h1>
          <p className="font-sans text-[12px] text-vapor-400">
            {isEdit ? 'Atualize as especificações e a grade de valores do serviço.' : 'Adicione um serviço do zero ao catálogo da oficina.'}
          </p>
        </div>
      </div>

      {errorMsg && (
        <AlertaErro erro={errorMsg} />
      )}

      {successMsg && (
        <div className="p-3.5 bg-mint-400/10 border border-mint-400/30 rounded flex items-center gap-2 text-mint-400 text-[13px]">
          <CheckCircle size={18} className="shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Lado Esquerdo: Formulário principal */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          
          {/* Seção 1: Identificação */}
          <Card className="p-5 bg-graphite-800 border-graphite-600 flex flex-col gap-4">
            <h3 className="font-display text-[13px] text-vapor-300 uppercase tracking-widest border-b border-graphite-700 pb-2">
              1. Identificação do Serviço
            </h3>

            <div className="flex flex-col gap-1">
              <label className="font-sans text-[13px] text-vapor-400 font-medium">Nome do Serviço *</label>
              <Input
                type="text"
                placeholder="Ex: Lavagem Detalhada de Chassis"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                required
                className="min-h-[48px]"
              />
              {!isEdit && servicosDoTenant.some((s) => s.nome.trim().toLowerCase() === nome.trim().toLowerCase()) && (
                <span className="text-[11px] text-amber-400 font-sans flex items-center gap-1.5 mt-1 bg-amber-500/10 p-2 rounded border border-amber-500/30">
                  <Sparkles size={14} className="shrink-0 text-amber-400" />
                  Este serviço já existe no catálogo. Ao salvar, suas novas durações e preços substituirão o registro antigo diretamente.
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Grupo com sugestões */}
              <div className="flex flex-col gap-1">
                <label className="font-sans text-[13px] text-vapor-400 font-medium">Grupo / Categoria *</label>
                <div className="relative">
                  <select
                    value={grupo}
                    onChange={(e) => setGrupo(e.target.value)}
                    className="w-full bg-graphite-900 border border-graphite-600 rounded px-3 py-2.5 font-sans text-[14px] text-vapor-100 outline-none focus:border-amber-500 transition-colors appearance-none min-h-[48px]"
                  >
                    {GRUPOS_SUGESTOES.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Código */}
              <div className="flex flex-col gap-1">
                <label className="font-sans text-[13px] text-vapor-400 font-medium">Código do Serviço (Opcional)</label>
                <Input
                  type="text"
                  placeholder="Ex: LV-04"
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                  className="min-h-[48px] uppercase font-mono tracking-wider"
                />
              </div>
            </div>

            {/* Modelo de Checklist */}
            <div className="flex flex-col gap-1">
              <label className="font-sans text-[13px] text-vapor-400 font-medium">
                Modelo de Checklist Padrão (Opcional)
              </label>
              <select
                value={checklistModeloId || ''}
                onChange={(e) => setChecklistModeloId(e.target.value || null)}
                className="w-full bg-graphite-900 border border-graphite-600 rounded px-3 py-2.5 font-sans text-[14px] text-vapor-100 outline-none focus:border-amber-500 transition-colors min-h-[48px]"
              >
                <option value="">Nenhum / Selecionar modelo...</option>
                {checklistModelos.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </select>
            </div>

            {/* Tom do Chip */}
            <div className="flex flex-col gap-1.5">
              <label className="font-sans text-[13px] text-vapor-400 font-medium">Cor de Destaque (Tom do Chip)</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {(['vapor', 'amber', 'glass', 'mint'] as TomChip[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTom(t)}
                    className={`py-3 px-2.5 rounded border font-display text-[12px] uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${
                      tom === t
                        ? 'border-amber-500 bg-graphite-900 text-amber-500 font-bold'
                        : 'border-graphite-600 bg-graphite-900/40 text-vapor-400 hover:text-vapor-200'
                    }`}
                  >
                    <span className={`w-2.5 h-2.5 rounded-full ${
                      t === 'amber' ? 'bg-amber-500' : t === 'glass' ? 'bg-glass-400' : t === 'mint' ? 'bg-mint-400' : 'bg-vapor-400'
                    }`} />
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          {/* Seção 2: Agenda */}
          <Card className="p-5 bg-graphite-800 border-graphite-600 flex flex-col gap-4">
            <h3 className="font-display text-[13px] text-vapor-300 uppercase tracking-widest border-b border-graphite-700 pb-2 flex items-center gap-1.5">
              <Calendar size={16} className="text-amber-500" />
              2. Configurações da Agenda & Ocupação
            </h3>

            <div className="flex flex-col gap-2">
              <label className="font-sans text-[13px] text-vapor-400 font-medium">Modo de Ocupação</label>
              <div className="flex flex-col gap-2.5">
                {[
                  {
                    mode: 'slot',
                    label: 'Slot de Tempo',
                    desc: 'Ocupa apenas o tempo do serviço. Outros carros podem entrar no mesmo dia.'
                  },
                  {
                    mode: 'dia_inteiro',
                    label: 'Dia Inteiro',
                    desc: 'Bloqueia a vaga da agenda pelo dia inteiro. Indicado para vitrificações e polimentos técnicos.'
                  },
                  {
                    mode: 'multiplos_dias',
                    label: 'Múltiplos Dias',
                    desc: 'Bloqueia a vaga por múltiplos dias seguidos.'
                  }
                ].map((item) => (
                  <label
                    key={item.mode}
                    onClick={() => setModoOcupacao(item.mode as ModoOcupacao)}
                    className={`p-3.5 rounded border transition-all cursor-pointer flex items-start gap-3 select-none ${
                      modoOcupacao === item.mode
                        ? 'bg-graphite-900 border-amber-500'
                        : 'bg-graphite-900/30 border-graphite-700 hover:border-graphite-600'
                    }`}
                  >
                    <input
                      type="radio"
                      name="modoOcupacao"
                      checked={modoOcupacao === item.mode}
                      onChange={() => {}}
                      className="mt-1 w-4 h-4 accent-amber-500 bg-graphite-900 border-graphite-600"
                    />
                    <div className="flex flex-col gap-0.5">
                      <span className="font-sans text-[13px] font-bold text-vapor-100">
                        {item.label}
                      </span>
                      <span className="font-sans text-[12px] text-vapor-400">
                        {item.desc}
                      </span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {modoOcupacao === 'multiplos_dias' && (
              <div className="flex flex-col gap-1 animate-fadeIn">
                <label className="font-sans text-[13px] text-vapor-400 font-medium">Quantidade de Dias Ocupados</label>
                <CampoNumerico
                  integerOnly
                  value={diasOcupados}
                  onChange={(val) => setDiasOcupados(val || 2)}
                  placeholder="2"
                  wrapperClassName="w-full sm:w-32 min-h-[48px]"
                />
              </div>
            )}
          </Card>

          {/* Seção 3: Preços por Categoria */}
          <Card className="p-5 bg-graphite-800 border-graphite-600 flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-graphite-700 pb-2">
              <h3 className="font-display text-[13px] text-vapor-300 uppercase tracking-widest">
                3. Matriz de Partida (A partir de & Duração)
              </h3>
              
              <label className="flex items-center gap-2 cursor-pointer select-none shrink-0">
                <input
                  type="checkbox"
                  checked={sobConsulta}
                  onChange={(e) => setSobConsulta(e.target.checked)}
                  className="w-4 h-4 accent-amber-500 rounded bg-graphite-900 border-graphite-600"
                />
                <span className="font-sans text-[12px] text-vapor-300 font-medium">
                  Sob avaliação (Consulta presencial)
                </span>
              </label>
            </div>

            {sobConsulta ? (
              <div className="p-4 bg-graphite-900 border border-graphite-700 rounded text-center text-vapor-400 text-[13px]">
                Nenhum valor pré-definido. O sistema exibirá <strong>"Sob avaliação"</strong> para o cliente.
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-graphite-900/60 p-3 rounded-lg border border-graphite-700/80">
                  <p className="font-sans text-[12px] text-vapor-400 leading-relaxed">
                    Informe o piso de preço e a duração estimada. Você pode escolher entre <strong>minutos</strong>, <strong>horas</strong> ou <strong>dias</strong>:
                  </p>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                    <span className="text-[11px] uppercase tracking-wider text-vapor-400 font-medium">Unidade padrão:</span>
                    <div className="inline-flex bg-graphite-950 border border-graphite-700 rounded-lg p-0.5">
                      {OPCOES_UNIDADE_DURACAO.map((opt) => (
                        <button
                          key={opt.valor}
                          type="button"
                          onClick={() => handleMudarUnidadePadrao(opt.valor)}
                          className={`px-2.5 py-1 text-[11px] rounded-md font-bold transition-all ${
                            unidadePadrao === opt.valor
                              ? 'bg-amber-500 text-graphite-950 shadow-sm'
                              : 'text-vapor-400 hover:text-vapor-200'
                          }`}
                        >
                          {opt.rotulo}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  {categories.map((cat) => {
                    const precoObj = precosLocais[cat.id] || {
                      preco_base: '',
                      duracao_minutos: 60,
                      duracao_valor: '60',
                      unidade_duracao: unidadePadrao,
                      duracao_confirmada: false,
                    };
                    
                    return (
                      <div
                        key={cat.id}
                        className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-graphite-900/50 rounded border border-graphite-700 items-center"
                      >
                        <span className="font-sans text-[13px] font-bold text-vapor-200">
                          {cat.nome}
                        </span>

                        {/* Input Preço */}
                        <CampoNumerico
                          prefix="R$"
                          align="right"
                          placeholder="--"
                          value={precoObj.preco_base}
                          onChange={(_, valStr) => handlePriceLocalChange(cat.id, valStr)}
                          wrapperClassName="w-full min-h-[40px]"
                        />

                        {/* Input Duração com Seletor de Unidade */}
                        <div className="flex items-center gap-1.5 w-full">
                          <CampoNumerico
                            align="center"
                            placeholder="0"
                            value={precoObj.duracao_valor}
                            onChange={(val) => handleDuracaoValorChange(cat.id, val ?? 0)}
                            wrapperClassName={`flex-1 min-h-[40px] ${
                              !precoObj.duracao_confirmada ? 'border-amber-500 bg-amber-500/5 text-amber-500 font-bold' : ''
                            }`}
                          />
                          <select
                            value={precoObj.unidade_duracao || unidadePadrao}
                            onChange={(e) => handleUnidadeCategoriaChange(cat.id, e.target.value as UnidadeDuracao)}
                            className="bg-graphite-800 text-vapor-100 border border-graphite-700 hover:border-graphite-600 rounded px-2 h-[40px] text-[12px] font-sans font-semibold focus:border-amber-500 focus:outline-none shrink-0 cursor-pointer"
                            title="Alterar unidade desta categoria"
                          >
                            <option value="min">min</option>
                            <option value="horas">horas</option>
                            <option value="dias">dias</option>
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* Lado Direito: Preview & Catálogo Público */}
        <div className="flex flex-col gap-6">
          
          {/* Seção 4: Catálogo Público */}
          {(() => {
            const grupoSlug = slugifyGrupo(grupo);
            const grupoFotoPath = grupoFotos[grupo] || grupoFotos[grupoSlug];
            const oficinaCapaPath = tenant?.capa_path;

            let resolvedFotoUrl = '';
            let originBadgeLabel = '';
            let originBadgeTone: 'mint' | 'amber' | 'vapor' | 'glass' = 'glass';
            const hasOwnPhoto = !!fotoPath;

            if (fotoPath) {
              resolvedFotoUrl = getFotoPublicUrl(fotoPath) || '';
              originBadgeLabel = 'Foto própria';
              originBadgeTone = 'mint';
            } else if (grupoFotoPath) {
              resolvedFotoUrl = getFotoPublicUrl(grupoFotoPath) || '';
              originBadgeLabel = 'Herdada do grupo';
              originBadgeTone = 'amber';
            } else if (oficinaCapaPath) {
              resolvedFotoUrl = getFotoPublicUrl(oficinaCapaPath) || '';
              originBadgeLabel = 'Herdada da oficina';
              originBadgeTone = 'vapor';
            } else {
              resolvedFotoUrl = DEFAULT_SERVICE_PLACEHOLDER;
              originBadgeLabel = 'Placeholder padrão';
              originBadgeTone = 'glass';
            }

            return (
              <>
                <Card className="p-5 bg-graphite-800 border-graphite-600 flex flex-col gap-4">
                  <h3 className="font-display text-[13px] text-vapor-300 uppercase tracking-widest border-b border-graphite-700 pb-2 flex items-center gap-1.5">
                    <Globe size={16} className="text-amber-500" />
                    4. Catálogo Público
                  </h3>

                  <div className="flex items-center justify-between">
                    <span className="font-sans text-[13px] text-vapor-200 font-medium">Exibir no Catálogo Online?</span>
                    <label className="relative inline-flex items-center cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={publico}
                        onChange={(e) => setPublico(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-graphite-900 border border-graphite-600 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-vapor-400 after:border-graphite-600 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500 peer-checked:after:bg-graphite-900" />
                    </label>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="font-sans text-[13px] text-vapor-400 font-medium">Descrição Pública (Catálogo)</label>
                    <textarea
                      placeholder="Descreva o serviço para o seu cliente final..."
                      rows={3}
                      value={descricaoPublica}
                      onChange={(e) => setDescricaoPublica(e.target.value)}
                      className="w-full bg-graphite-900 border border-graphite-600 rounded p-3 font-sans text-[13px] text-vapor-100 outline-none focus:border-amber-500 transition-colors resize-none"
                    />
                    <span className="font-sans text-[11px] text-vapor-500">
                      A descrição pública é o que seu cliente lê antes de agendar.
                    </span>
                  </div>

                  {/* Upload & Herança de Imagem */}
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <label className="font-sans text-[13px] text-vapor-400 font-medium">Imagem do Serviço</label>
                      <Badge tone={originBadgeTone}>{originBadgeLabel}</Badge>
                    </div>

                    {photoError && (
                      <div className="p-2.5 bg-flare-400/10 border border-flare-400/30 rounded text-flare-400 text-[12px] flex items-center gap-2">
                        <AlertTriangle size={14} className="shrink-0" />
                        <span>{photoError}</span>
                      </div>
                    )}

                    <div className="relative rounded-lg overflow-hidden border border-graphite-700 bg-graphite-900 group">
                      <img
                        src={resolvedFotoUrl}
                        alt={nome || 'Foto do serviço'}
                        className="w-full h-36 object-cover"
                      />
                      
                      {hasOwnPhoto && (
                        <button
                          type="button"
                          onClick={handleRemovePhoto}
                          disabled={uploadingPhoto}
                          className="absolute top-2 right-2 px-3 py-1.5 bg-flare-500 hover:bg-flare-600 text-white rounded text-[12px] font-sans font-medium transition-colors shadow-md flex items-center gap-1.5"
                          title="Remover foto própria e voltar a herdar"
                        >
                          <Trash size={13} />
                          <span>Remover e voltar a herdar</span>
                        </button>
                      )}
                    </div>

                    {!hasOwnPhoto && (
                      <label className="border border-dashed border-graphite-600 hover:border-amber-500/70 rounded-lg p-3 flex items-center justify-center gap-2 cursor-pointer transition-colors bg-graphite-900/50">
                        <Upload size={16} className="text-amber-500" />
                        <span className="font-sans text-[12px] text-vapor-200 font-medium">
                          {uploadingPhoto ? 'Enviando imagem...' : 'Usar foto própria'}
                        </span>
                        <input
                          type="file"
                          accept="image/jpeg,image/jpg,image/png,image/webp"
                          onChange={handlePhotoUpload}
                          disabled={uploadingPhoto}
                          className="hidden"
                        />
                      </label>
                    )}
                  </div>
                </Card>

                {/* Live Preview Card */}
                {publico && (
                  <div className="flex flex-col gap-2">
                    <span className="font-display text-[10px] text-vapor-400 uppercase tracking-widest">
                      Preview no Catálogo Público:
                    </span>
                    <Card className="p-4 bg-graphite-800 border-amber-500/40 flex flex-col gap-3 shadow-lg select-none">
                      <img src={resolvedFotoUrl} alt="Preview" className="w-full h-28 object-cover rounded" />
                      
                      <div className="flex flex-col gap-1">
                        <ServiceChip code={codigo || 'XX'} label={nome || 'Nome do Serviço'} tone={tom} />
                        <p className="font-sans text-[12px] text-vapor-400 leading-relaxed mt-1">
                          {descricaoPublica || 'Sem descrição pública fornecida.'}
                        </p>
                      </div>
                      
                      <div className="border-t border-graphite-700/60 pt-2 flex items-center justify-between">
                        <span className="font-sans text-[13px] text-vapor-200 font-semibold">
                          {previewFaixa}
                        </span>
                        <span className="font-sans text-[11px] text-vapor-500">
                          Online
                        </span>
                      </div>
                    </Card>
                  </div>
                )}
              </>
            );
          })()}

          {/* Seção 5: Garantia & Pós-Venda (Etiquetas de Para-brisa) */}
          <Card className="p-5 bg-graphite-800 border-graphite-600 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-graphite-700 pb-2">
              <h3 className="font-display text-[13px] text-vapor-300 uppercase tracking-widest flex items-center gap-1.5">
                <ShieldCheck size={16} className="text-amber-500" />
                5. Garantia & Etiqueta de Para-brisa
              </h3>
              <span className="text-[10px] font-sans text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 font-bold">
                PÓS-VENDA
              </span>
            </div>

            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="font-sans text-[13px] text-vapor-100 font-medium">
                  Este serviço emite Certificado e Etiqueta de Garantia?
                </span>
                <span className="font-sans text-[11px] text-vapor-400">
                  Ao concluir um atendimento com este serviço, a plataforma sugerirá a emissão da etiqueta de para-brisa com QR Code e ativará o radar de retorno.
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer select-none shrink-0">
                <input
                  type="checkbox"
                  checked={temGarantia}
                  onChange={(e) => setTemGarantia(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-graphite-900 border border-graphite-600 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-vapor-400 after:border-graphite-600 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500 peer-checked:after:bg-graphite-900" />
              </label>
            </div>

            {temGarantia && (
              <div className="flex flex-col gap-4 pt-3 border-t border-graphite-700/80">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Prazo de Garantia */}
                  <div className="flex flex-col gap-1.5">
                    <label className="font-sans text-[12px] text-vapor-300 font-medium">
                      Prazo de Garantia Padrão (Meses)
                    </label>
                    <select
                      value={garantiaMeses}
                      onChange={(e) => setGarantiaMeses(Number(e.target.value))}
                      className="bg-graphite-900 border border-graphite-600 rounded p-2.5 font-sans text-[13px] text-vapor-100 outline-none focus:border-amber-500 transition-colors"
                    >
                      <option value={3}>3 meses (90 dias)</option>
                      <option value={6}>6 meses</option>
                      <option value={12}>12 meses (1 ano)</option>
                      <option value={24}>24 meses (2 anos)</option>
                      <option value={36}>36 meses (3 anos - Vitrificação)</option>
                      <option value={60}>60 meses (5 anos)</option>
                    </select>
                  </div>

                  {/* Intervalo de Retorno */}
                  <div className="flex flex-col gap-1.5">
                    <label className="font-sans text-[12px] text-vapor-300 font-medium">
                      Retorno Recomendado (Dias)
                    </label>
                    <CampoNumerico
                      integerOnly
                      value={garantiaIntervaloDias}
                      onChange={(val) => setGarantiaIntervaloDias(val || 60)}
                      placeholder="60"
                      wrapperClassName="w-full min-h-[42px]"
                    />
                    <span className="font-sans text-[10.5px] text-vapor-500">
                      Intervalo para lavar/inspecionar e manter a garantia ativa.
                    </span>
                  </div>
                </div>

                {/* Produto Recomendado */}
                <div className="flex flex-col gap-1">
                  <label className="font-sans text-[12px] text-vapor-300 font-medium">
                    Produto / Vitrificador Padrão
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: Vonixx V-Paint 3 Anos, Nasiol ZR53, Kisho Si-701..."
                    value={garantiaProdutoPadrao}
                    onChange={(e) => setGarantiaProdutoPadrao(e.target.value)}
                    className="w-full bg-graphite-900 border border-graphite-600 rounded p-2.5 font-sans text-[13px] text-vapor-100 outline-none focus:border-amber-500 transition-colors"
                  />
                </div>

                {/* Recomendações e Cuidados */}
                <div className="flex flex-col gap-1">
                  <label className="font-sans text-[12px] text-vapor-300 font-medium">
                    Instruções de Cuidados no Pós-Venda
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Ex: Tempo de cura de 48h sem contato com água. Lavar com shampoo neutro..."
                    value={garantiaCuidados}
                    onChange={(e) => setGarantiaCuidados(e.target.value)}
                    className="w-full bg-graphite-900 border border-graphite-600 rounded p-2.5 font-sans text-[12px] text-vapor-100 outline-none focus:border-amber-500 transition-colors resize-none"
                  />
                  <span className="font-sans text-[10.5px] text-vapor-500">
                    Esse texto será impresso no certificado e exibido quando o cliente escanear o QR Code.
                  </span>
                </div>
              </div>
            )}
          </Card>

          {/* Seção 6: Interno & Status */}
          <Card className="p-5 bg-graphite-800 border-graphite-600 flex flex-col gap-4">
            <h3 className="font-display text-[13px] text-vapor-300 uppercase tracking-widest border-b border-graphite-700 pb-2">
              6. Observações Internas
            </h3>

            <div className="flex flex-col gap-1">
              <label className="font-sans text-[13px] text-vapor-400 font-medium">Instruções para a Equipe</label>
              <textarea
                placeholder="Ex: Utilizar APC diluído em 1:10 e pincel macio no acabamento..."
                rows={3}
                value={descricaoInterna}
                onChange={(e) => setDescricaoInterna(e.target.value)}
                className="w-full bg-graphite-900 border border-graphite-600 rounded p-3 font-sans text-[13px] text-vapor-100 outline-none focus:border-amber-500 transition-colors resize-none"
              />
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-graphite-700">
              <span className="font-sans text-[13px] text-vapor-200 font-medium">Status do Serviço</span>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={ativo}
                  onChange={(e) => setAtivo(e.target.checked)}
                  className="w-4 h-4 accent-amber-500 rounded bg-graphite-900 border-graphite-600"
                />
                <span className="font-sans text-[13px] text-vapor-200">Ativo</span>
              </label>
            </div>
          </Card>

          {/* Botões de Ação */}
          <div className="flex flex-col gap-2">
            <Button
              type="submit"
              variant="primary"
              disabled={saving}
              className="w-full font-semibold min-h-[48px]"
            >
              <Save size={18} />
              {saving ? 'Salvando...' : 'Salvar Serviço'}
            </Button>
            
            <Button
              type="button"
              variant="ghost"
              onClick={() => navigate('/servicos')}
              className="w-full border-graphite-600 text-vapor-300"
            >
              Cancelar
            </Button>

            {isEdit && canManage && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowModalExcluir(true)}
                className="w-full border-flare-400/40 text-flare-400 hover:bg-flare-400/10 hover:border-flare-400 mt-2 flex items-center justify-center gap-2"
              >
                <Trash size={16} />
                Excluir Serviço
              </Button>
            )}
          </div>
        </div>
      </form>

      {/* Modal de Confirmação de Exclusão do Serviço */}
      <ModalConfirmacao
        isOpen={showModalExcluir}
        onClose={() => setShowModalExcluir(false)}
        onConfirm={handleExcluirServico}
        title="Excluir Serviço"
        mensagem={
          <span>
            Tem certeza que deseja excluir o serviço &quot;<strong className="text-vapor-100">{nome}</strong>&quot;? Se ele já possuir histórico em atendimentos ou orçamentos, será desativado com segurança para manter o histórico financeiro e relatórios íntegros.
          </span>
        }
        textoConfirmar="Excluir Serviço"
        textoCancelar="Voltar"
        variant="danger"
        loading={deletingServico}
      />
    </div>
  );
};
