import React, { useState, useEffect } from 'react';
import { PageHeader } from '../components/layout/PageHeader';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { CampoNumerico } from '../components/ui/CampoNumerico';
import { CopyLinkButton } from '../components/ui/CopyLinkButton';
import { ScrollableTabs } from '../components/ui/ScrollableTabs';
import { useAuth } from '../contexts/AuthContext';
import { usePermissao } from '../hooks/usePermissao';
import { usePlano } from '../hooks/usePlano';
import { supabase } from '../lib/supabase';
import { AbaEquipe } from './configuracoes/AbaEquipe';
import { AbaCategorias } from './configuracoes/AbaCategorias';
import { AbaHorarios } from './configuracoes/AbaHorarios';
import { AbaChecklists } from './configuracoes/AbaChecklists';
import { AbaDespesasFixas } from './configuracoes/AbaDespesasFixas';
import { AbaAgendamentoOnline } from '../components/configuracoes/AbaAgendamentoOnline';
import { AbaPersonalizacaoPDF } from '../components/configuracoes/AbaPersonalizacaoPDF';
import { AbaMetaMensal } from './configuracoes/AbaMetaMensal';
import { AbaFeedbacks } from './configuracoes/AbaFeedbacks';
import { AbaAssinatura } from './configuracoes/AbaAssinatura';
import { Building2, Users, CreditCard, Tag, Upload, Trash, AlertTriangle, ExternalLink, Globe, Check, Save, Clock, CheckSquare, DollarSign, Calendar, FileText, Target, MessageSquare } from 'lucide-react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { validateImageFile, getFotoPublicUrl } from '../utils/imagens';

interface ConfiguracoesProps {
  abaInicial?: 'oficina' | 'horarios' | 'equipe' | 'categorias' | 'checklists' | 'despesas' | 'plano' | 'agendamento' | 'pdf' | 'meta' | 'feedbacks';
}

export const Configuracoes: React.FC<ConfiguracoesProps> = ({ abaInicial }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { tenant, refetchTenantData } = useAuth();
  const { isDono, podeGerirEquipe, podeGerirServicos } = usePermissao();
  const { planoAtual, nomePlano, limiteDe } = usePlano();

  const getTabPadrao = () => {
    if (abaInicial) return abaInicial;
    return 'oficina';
  };

  const [activeTab, setActiveTab] = useState<'oficina' | 'horarios' | 'equipe' | 'categorias' | 'checklists' | 'despesas' | 'plano' | 'agendamento' | 'pdf' | 'meta' | 'feedbacks'>(getTabPadrao());

  useEffect(() => {
    const queryParams = new URLSearchParams(location.search);
    const abaParam = queryParams.get('aba');
    if (abaParam === 'treinamento') {
      navigate('/treinamentos', { replace: true });
      return;
    }
    if (abaParam === 'arquivos' || location.pathname.includes('arquivos-digitais')) {
      navigate('/arquivos-digitais', { replace: true });
      return;
    }
    if (abaInicial) {
      setActiveTab(abaInicial);
    }
  }, [location.pathname, location.search, abaInicial, navigate]);
  const [uploadingCapa, setUploadingCapa] = useState(false);
  const [capaError, setCapaError] = useState<string | null>(null);
  // Estados da Logo da Oficina
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoSemAlfa, setLogoSemAlfa] = useState(false);

  // Estados de Identidade da Oficina (CPF/CNPJ e Razão Social)
  const [docTipo, setDocTipo] = useState<'cpf' | 'cnpj'>(tenant?.documento_tipo || 'cnpj');
  const [documentoInput, setDocumentoInput] = useState(tenant?.documento || '');
  const [razaoSocialInput, setRazaoSocialInput] = useState(tenant?.razao_social || '');
  const [validadeDiasInput, setValidadeDiasInput] = useState<number>(tenant?.orcamento_validade_dias || 7);
  const [savingIdentidade, setSavingIdentidade] = useState(false);
  const [identidadeError, setIdentidadeError] = useState<string | null>(null);
  const [identidadeSuccess, setIdentidadeSuccess] = useState<string | null>(null);

  const [contadorOS, setContadorOS] = useState<{ proxima_os: number; ultimo_marco_exibido: number } | null>(null);

  useEffect(() => {
    if (tenant) {
      setDocTipo(tenant.documento_tipo || 'cnpj');
      setDocumentoInput(tenant.documento || '');
      setRazaoSocialInput(tenant.razao_social || '');
      setValidadeDiasInput(tenant.orcamento_validade_dias || 7);

      supabase
        .from('tenant_contadores')
        .select('proxima_os, ultimo_marco_exibido')
        .eq('tenant_id', tenant.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data) setContadorOS(data);
        });
    }
  }, [tenant?.id]);

  const aplicarMascaraDocumento = (val: string, tipo: 'cpf' | 'cnpj') => {
    const digits = val.replace(/\D/g, '');
    if (tipo === 'cpf') {
      return digits
        .slice(0, 11)
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    } else {
      return digits
        .slice(0, 14)
        .replace(/^(\d{2})(\d)/, '$1.$2')
        .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
        .replace(/\.(\d{3})(\d)/, '.$1/$2')
        .replace(/(\d{4})(\d)/, '$1-$2');
    }
  };

  const handleSaveIdentidade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant) return;
    setIdentidadeError(null);
    setIdentidadeSuccess(null);

    const rawDigits = documentoInput.replace(/\D/g, '');
    if (rawDigits.length > 0) {
      if (docTipo === 'cpf' && rawDigits.length !== 11) {
        setIdentidadeError('CPF deve conter exatamente 11 dígitos.');
        return;
      }
      if (docTipo === 'cnpj' && rawDigits.length !== 14) {
        setIdentidadeError('CNPJ deve conter exatamente 14 dígitos.');
        return;
      }
    }

    setSavingIdentidade(true);
    try {
      const { error } = await supabase
        .from('tenants')
        .update({
          documento: rawDigits || null,
          documento_tipo: rawDigits ? docTipo : null,
          razao_social: razaoSocialInput.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', tenant.id);

      if (error) throw error;

      setIdentidadeSuccess('Dados de identidade da oficina salvos com sucesso!');
      await refetchTenantData();
    } catch (err: any) {
      console.error('[Salvar Identidade Error]:', err);
      setIdentidadeError(err.message || 'Erro ao salvar identidade da oficina.');
    } finally {
      setSavingIdentidade(false);
    }
  };

  // Estados de edição de Slug
  const [slugInput, setSlugInput] = useState(tenant?.slug || '');
  const [savingSlug, setSavingSlug] = useState(false);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [slugSuccess, setSlugSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (tenant?.slug) {
      setSlugInput(tenant.slug);
    }
  }, [tenant?.slug]);

  // Função auxiliar para verificar transparência (canal alfa) na imagem
  const checkImageHasAlpha = (file: File): Promise<boolean> => {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          resolve(false);
          return;
        }
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let hasAlpha = false;
        // Percorre os canais de alfa (stride 4)
        for (let i = 3; i < imgData.length; i += 4) {
          if (imgData[i] < 255) {
            hasAlpha = true;
            break;
          }
        }
        URL.revokeObjectURL(url);
        resolve(hasAlpha);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(false);
      };
      img.src = url;
    });
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0 || !tenant) return;
    const file = e.target.files[0];
    setLogoError(null);
    setLogoSemAlfa(false);

    if (file.size > 2 * 1024 * 1024) {
      setLogoError('A imagem deve ter no máximo 2MB.');
      return;
    }

    const { valid, ext, error } = validateImageFile(file);
    if (!valid || !ext) {
      setLogoError(error || 'Formato inválido.');
      return;
    }

    setUploadingLogo(true);

    try {
      const hasAlpha = await checkImageHasAlpha(file);
      if (!hasAlpha && ext !== 'png') {
        setLogoSemAlfa(true);
      } else if (!hasAlpha) {
        setLogoSemAlfa(true);
      }

      const newPath = `${tenant.id}/oficina/logo.${ext}`;

      if (tenant.logo_path && tenant.logo_path !== newPath) {
        await supabase.storage.from('catalogo').remove([tenant.logo_path]);
      }

      const { error: uploadError } = await supabase.storage
        .from('catalogo')
        .upload(newPath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { error: updateError } = await supabase
        .from('tenants')
        .update({ logo_path: newPath })
        .eq('id', tenant.id);

      if (updateError) throw updateError;

      await refetchTenantData();
    } catch (err: any) {
      console.error('[Logo Upload Error]:', err);
      setLogoError(err.message || 'Erro ao fazer upload da logo.');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleRemoveLogo = async () => {
    if (!tenant?.logo_path) return;
    setLogoError(null);
    setLogoSemAlfa(false);
    setUploadingLogo(true);

    try {
      await supabase.storage.from('catalogo').remove([tenant.logo_path]);

      const { error: updateError } = await supabase
        .from('tenants')
        .update({ logo_path: null })
        .eq('id', tenant.id);

      if (updateError) throw updateError;

      await refetchTenantData();
    } catch (err: any) {
      console.error('[Remove Logo Error]:', err);
      setLogoError(err.message || 'Erro ao remover logo.');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSaveSlug = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant) return;
    setSlugError(null);
    setSlugSuccess(null);

    const novoSlugLimpo = slugInput.trim().toLowerCase();

    if (novoSlugLimpo === tenant.slug) {
      setSlugError('O novo endereço é idêntico ao atual.');
      return;
    }

    setSavingSlug(true);

    try {
      const { error } = await supabase.rpc('atualizar_slug', {
        p_tenant: tenant.id,
        p_novo_slug: novoSlugLimpo
      });

      if (error) throw error;

      setSlugSuccess('Endereço (slug) da oficina atualizado com sucesso!');
      await refetchTenantData();
    } catch (err: any) {
      console.error('[Atualizar Slug Error]:', err);
      setSlugError(err.message || 'Erro ao atualizar endereço da oficina.');
    } finally {
      setSavingSlug(false);
    }
  };

  const handleCapaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0 || !tenant) return;
    const file = e.target.files[0];
    setCapaError(null);

    if (file.size > 2 * 1024 * 1024) {
      setCapaError('A imagem deve ter no máximo 2MB.');
      return;
    }

    const { valid, ext, error } = validateImageFile(file);
    if (!valid || !ext) {
      setCapaError(error || 'Formato inválido.');
      return;
    }

    setUploadingCapa(true);

    try {
      const newPath = `${tenant.id}/oficina/capa.${ext}`;

      if (tenant.capa_path && tenant.capa_path !== newPath) {
        await supabase.storage.from('catalogo').remove([tenant.capa_path]);
      }

      const { error: uploadError } = await supabase.storage
        .from('catalogo')
        .upload(newPath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { error: updateError } = await supabase
        .from('tenants')
        .update({ capa_path: newPath })
        .eq('id', tenant.id);

      if (updateError) throw updateError;

      await refetchTenantData();
    } catch (err: any) {
      console.error('[Capa Upload Error]:', err);
      setCapaError(err.message || 'Erro ao fazer upload da capa.');
    } finally {
      setUploadingCapa(false);
    }
  };

  const handleRemoveCapa = async () => {
    if (!tenant?.capa_path) return;
    setCapaError(null);
    setUploadingCapa(true);

    try {
      await supabase.storage.from('catalogo').remove([tenant.capa_path]);

      const { error: updateError } = await supabase
        .from('tenants')
        .update({ capa_path: null })
        .eq('id', tenant.id);

      if (updateError) throw updateError;

      await refetchTenantData();
    } catch (err: any) {
      console.error('[Remove Capa Error]:', err);
      setCapaError(err.message || 'Erro ao remover capa.');
    } finally {
      setUploadingCapa(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Minha Oficina" />

      {/* Tabs Switcher com Gradiente de Fade, Chevrons e Menu Rápido Mobile */}
      <ScrollableTabs
        items={[
          { id: 'oficina', label: 'Oficina', icon: Building2 },
          ...((isDono || podeGerirEquipe()) ? [{ id: 'horarios', label: 'Horários & Agenda', icon: Clock }] : []),
          ...(podeGerirEquipe() ? [{ id: 'equipe', label: 'Equipe', icon: Users }] : []),
          ...(isDono ? [{ id: 'categorias', label: 'Categorias', icon: Tag }] : []),
          ...((isDono || podeGerirEquipe()) ? [{ id: 'checklists', label: 'Checklists', icon: CheckSquare }] : []),
          ...(isDono ? [{ id: 'despesas', label: 'Despesas Fixas', icon: DollarSign }] : []),
          ...(isDono ? [{ id: 'agendamento', label: 'Agendamento Online', icon: Calendar }] : []),
          { id: 'plano', label: 'Plano e Limites', icon: CreditCard },
          ...((isDono || podeGerirServicos()) ? [{ id: 'pdf', label: 'Documentos PDF', icon: FileText }] : []),
          ...(isDono ? [{ id: 'meta', label: 'Meta Mensal', icon: Target }] : []),
          { id: 'feedbacks', label: 'Meus Feedbacks', icon: MessageSquare },
        ]}
        activeId={activeTab}
        onChange={(id) => setActiveTab(id as any)}
        variant="sport"
        showQuickSelect={true}
        quickSelectTitle="Seções da Oficina"
      />

      {/* Conteúdo das Abas */}
      {activeTab === 'meta' && <AbaMetaMensal />}
      {activeTab === 'feedbacks' && <AbaFeedbacks />}

      {activeTab === 'oficina' && (
        <div className="flex flex-col lg:flex-row items-start gap-6">
          <Card className="p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-4 max-w-2xl flex-1 w-full">
            <h3 className="font-display text-[18px] text-vapor-100 uppercase tracking-wide">
              Dados da Oficina
            </h3>
            <div className="flex flex-col gap-3 font-sans text-[14px] text-vapor-400">
              <div className="flex justify-between py-2 border-b border-graphite-700">
                <span>Nome:</span>
                <strong className="text-vapor-100">{tenant?.nome || '—'}</strong>
              </div>
              <div className="flex justify-between py-2 border-b border-graphite-700">
                <span>Slug (Identificador):</span>
                <span className="font-mono text-amber-500">{tenant?.slug || '—'}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-graphite-700">
                <span>Cidade / UF:</span>
                <span className="text-vapor-100">
                  {tenant?.cidade ? `${tenant.cidade} / ${tenant.uf || ''}` : '—'}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-graphite-700">
                <span>Telefone / WhatsApp:</span>
                <span className="text-vapor-100">{tenant?.telefone || '—'}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-graphite-700">
                <span>Total de OSs Criadas:</span>
                <span className="font-mono text-amber-400 font-bold">
                  {contadorOS ? `${contadorOS.proxima_os - 1} OS(s)` : '0 OS(s)'}
                </span>
              </div>
              {contadorOS && contadorOS.ultimo_marco_exibido > 0 && (
                <div className="flex justify-between py-2 border-b border-graphite-700">
                  <span>Último Marco Atingido:</span>
                  <span className="font-mono text-mint-400 font-bold">
                    🎉 {contadorOS.ultimo_marco_exibido} Atendimentos
                  </span>
                </div>
              )}
            </div>

            {/* CONFIGURAÇÃO: Agendamento pelo Cliente no Orçamento */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-graphite-900 rounded-lg border border-graphite-700 mt-2">
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <span className="font-sans text-[13px] text-vapor-100 font-bold">
                  Cliente escolhe o horário ao aprovar o orçamento
                </span>
                <span className="font-sans text-[12px] text-vapor-400">
                  Permite agendamento direto sem precisar entrar em contato.
                </span>
              </div>
              <input
                type="checkbox"
                checked={tenant?.orcamento_agendamento_cliente ?? true}
                onChange={async (e) => {
                  if (!tenant) return;
                  try {
                    await supabase
                      .from('tenants')
                      .update({ orcamento_agendamento_cliente: e.target.checked })
                      .eq('id', tenant.id);
                    await refetchTenantData();
                  } catch (err) {
                    console.error('[Configuracoes] Erro ao salvar agendamento cliente:', err);
                  }
                }}
                className="w-5 h-5 accent-amber-500 rounded cursor-pointer shrink-0 min-h-[28px] min-w-[28px]"
              />
            </div>

            {/* CONFIGURAÇÃO: Validade Padrão dos Orçamentos */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-graphite-900 rounded-lg border border-graphite-700 mt-2">
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <span className="font-sans text-[13px] text-vapor-100 font-bold">
                  Validade Padrão dos Orçamentos (dias)
                </span>
                <span className="font-sans text-[12px] text-vapor-400">
                  Tempo que a proposta pública continuará ativa para o cliente aceitar.
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <CampoNumerico
                  integerOnly
                  value={validadeDiasInput}
                  onChange={async (val) => {
                    const novoVal = val || 7;
                    setValidadeDiasInput(novoVal);
                    if (!tenant) return;
                    try {
                      await supabase
                        .from('tenants')
                        .update({ orcamento_validade_dias: novoVal })
                        .eq('id', tenant.id);
                      await refetchTenantData();
                    } catch (err) {
                      console.error('[Configuracoes] Erro ao salvar validade orcamento:', err);
                    }
                  }}
                  align="center"
                  placeholder="7"
                  wrapperClassName="w-20 min-h-[40px]"
                />
                <span className="font-sans text-[12px] text-vapor-400 font-medium">dias</span>
              </div>
            </div>

            {/* CONFIGURAÇÃO: Fuso Horário da Oficina */}
            <div className="flex flex-col gap-2.5 p-3.5 bg-graphite-900 rounded-lg border border-graphite-700 mt-2">
              <div className="flex flex-col gap-0.5">
                <span className="font-sans text-[13px] text-vapor-100 font-bold">
                  Fuso Horário Local da Oficina
                </span>
                <span className="font-sans text-[12px] text-vapor-400">
                  Define o fuso para fechamentos financeiros, limites mensais e agenda.
                </span>
              </div>
              <select
                value={tenant?.fuso_horario || 'America/Sao_Paulo'}
                onChange={async (e) => {
                  const novoFuso = e.target.value;
                  if (!tenant) return;
                  try {
                    await supabase
                      .from('tenants')
                      .update({ fuso_horario: novoFuso })
                      .eq('id', tenant.id);
                    await refetchTenantData();
                  } catch (err) {
                    console.error('[Configuracoes] Erro ao salvar fuso horario:', err);
                  }
                }}
                className="bg-graphite-950 border border-graphite-600 rounded-lg p-2.5 text-vapor-100 font-sans text-[13px] outline-none focus:border-amber-500 min-h-[40px] cursor-pointer w-full"
              >
                <option value="America/Sao_Paulo">America/Sao_Paulo (Brasília - UTC-3)</option>
                <option value="America/Manaus">America/Manaus (Amazonas - UTC-4)</option>
                <option value="America/Cuiaba">America/Cuiaba (Mato Grosso - UTC-4)</option>
                <option value="America/Campo_Grande">America/Campo_Grande (Mato Grosso do Sul - UTC-4)</option>
                <option value="America/Fortaleza">America/Fortaleza (Ceará / Nordeste - UTC-3)</option>
                <option value="America/Belem">America/Belem (Pará / Amapá - UTC-3)</option>
                <option value="America/Recife">America/Recife (Pernambuco - UTC-3)</option>
                <option value="America/Rio_Branco">America/Rio_Branco (Acre - UTC-5)</option>
                <option value="America/Noronha">America/Noronha (Fernando de Noronha - UTC-2)</option>
              </select>
            </div>

            {/* CONFIGURAÇÃO: Porte da Cidade (Precificação de Mercado) */}
            <div className="flex flex-col gap-2.5 p-3.5 bg-graphite-900 rounded-lg border border-graphite-700 mt-2">
              <div className="flex flex-col gap-0.5">
                <span className="font-sans text-[13px] text-vapor-100 font-bold">
                  Porte da Cidade (Referência de Mercado)
                </span>
                <span className="font-sans text-[12px] text-vapor-400">
                  Usado para calibrar a faixa de preços praticada na sua região.
                </span>
              </div>
              <select
                value={(tenant as any)?.porte_cidade || 'interior'}
                onChange={async (e) => {
                  const novoPorte = e.target.value;
                  if (!tenant) return;
                  try {
                    await supabase
                      .from('tenants')
                      .update({ porte_cidade: novoPorte })
                      .eq('id', tenant.id);
                    await refetchTenantData();
                  } catch (err) {
                    console.error('[Configuracoes] Erro ao salvar porte da cidade:', err);
                  }
                }}
                className="bg-graphite-950 border border-graphite-600 rounded-lg p-2.5 text-vapor-100 font-sans text-[13px] outline-none focus:border-amber-500 min-h-[40px] cursor-pointer w-full"
              >
                <option value="interior">Interior / Cidade de Médio Porte</option>
                <option value="capital">Capital do Estado</option>
                <option value="metropolitana">Região Metropolitana / Grande Centro</option>
                <option value="nacional">Referência Nacional Geral</option>
              </select>
            </div>

            {/* CONFIGURAÇÃO: Margem Alvo de Lucro (%) */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-graphite-900 rounded-lg border border-graphite-700 mt-2">
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <span className="font-sans text-[13px] text-vapor-100 font-bold">
                  Margem Alvo de Lucro (%)
                </span>
                <span className="font-sans text-[12px] text-vapor-400">
                  Margem desejada sobre o preço de venda para recalcular preços ideais (padrão: 40%).
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <CampoNumerico
                  integerOnly
                  value={(tenant as any)?.margem_alvo_percentual ?? 40}
                  onChange={async (val) => {
                    const novaMargem = val || 40;
                    if (!tenant) return;
                    try {
                      await supabase
                        .from('tenants')
                        .update({ margem_alvo_percentual: novaMargem })
                        .eq('id', tenant.id);
                      await refetchTenantData();
                    } catch (err) {
                      console.error('[Configuracoes] Erro ao salvar margem alvo:', err);
                    }
                  }}
                  align="center"
                  placeholder="40"
                  wrapperClassName="w-20 min-h-[40px]"
                />
                <span className="font-sans text-[12px] text-vapor-400 font-medium">%</span>
              </div>
            </div>

            {/* FORMULÁRIO: Identidade Legal (CPF / CNPJ & Razão Social / Nome Completo) */}
            <form onSubmit={handleSaveIdentidade} className="flex flex-col gap-3 mt-2 pt-4 border-t border-graphite-700">
              <label className="font-sans text-[14px] text-vapor-100 font-bold">
                Identidade nos Documentos
              </label>

              {identidadeError && (
                <div className="p-2.5 bg-flare-400/10 border border-flare-400/30 rounded text-flare-400 text-[12px] flex items-center gap-2">
                  <AlertTriangle size={14} className="shrink-0" />
                  <span>{identidadeError}</span>
                </div>
              )}

              {identidadeSuccess && (
                <div className="p-2.5 bg-mint-500/10 border border-mint-500/30 rounded text-mint-400 text-[12px] flex items-center gap-2">
                  <Check size={14} className="shrink-0" />
                  <span>{identidadeSuccess}</span>
                </div>
              )}

              <div className="flex flex-col gap-1">
                <label className="font-sans text-[12px] text-vapor-300 font-medium">
                  Razão social ou nome completo (opcional)
                </label>
                <input
                  type="text"
                  value={razaoSocialInput}
                  onChange={(e) => setRazaoSocialInput(e.target.value)}
                  placeholder="Ex: Detailer Studio Ltda ou João da Silva"
                  className="bg-graphite-950 border border-graphite-600 rounded-lg p-2.5 text-vapor-100 font-sans text-[13px] outline-none focus:border-amber-500 min-h-[44px]"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-sans text-[12px] text-vapor-300 font-medium">
                  CPF ou CNPJ (opcional)
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={docTipo}
                    onChange={(e) => {
                      const newType = e.target.value as 'cpf' | 'cnpj';
                      setDocTipo(newType);
                      setDocumentoInput(aplicarMascaraDocumento(documentoInput, newType));
                    }}
                    className="bg-graphite-950 border border-graphite-600 rounded-lg p-2.5 text-vapor-100 font-mono text-[13px] outline-none focus:border-amber-500 min-h-[44px] shrink-0"
                  >
                    <option value="cnpj">CNPJ</option>
                    <option value="cpf">CPF</option>
                  </select>

                  <input
                    type="text"
                    value={documentoInput}
                    onChange={(e) => setDocumentoInput(aplicarMascaraDocumento(e.target.value, docTipo))}
                    placeholder={docTipo === 'cnpj' ? '00.000.000/0000-00' : '000.000.000-00'}
                    className="bg-graphite-950 border border-graphite-600 rounded-lg p-2.5 text-vapor-100 font-mono text-[13px] outline-none focus:border-amber-500 min-h-[44px] flex-1 min-w-0"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={savingIdentidade}
                  className="text-[12px] flex items-center gap-1.5"
                >
                  <Save size={14} />
                  <span>{savingIdentidade ? 'Salvando...' : 'Salvar Identidade'}</span>
                </Button>
              </div>
            </form>

            {/* UPLOAD 1: Logo da Oficina (Documentos) */}
            <div className="flex flex-col gap-3 mt-4 pt-4 border-t border-graphite-700">
              <label className="font-sans text-[14px] text-vapor-100 font-bold flex items-center justify-between">
                <span>Logo da oficina</span>
                <span className="text-[11px] text-amber-500 font-mono font-normal">Documentos</span>
              </label>

              <p className="font-sans text-[12px] text-vapor-400 leading-snug">
                Aparece nos documentos: vistoria, orçamento e ordem de serviço. Prefira PNG com fundo transparente.
              </p>

              {logoError && (
                <div className="p-2.5 bg-flare-400/10 border border-flare-400/30 rounded text-flare-400 text-[12px] flex items-center gap-2">
                  <AlertTriangle size={14} className="shrink-0" />
                  <span>{logoError}</span>
                </div>
              )}

              {logoSemAlfa && (
                <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded text-amber-400 text-[12px] flex items-center gap-2">
                  <AlertTriangle size={14} className="shrink-0" />
                  <span>Sem fundo transparente. A logo pode aparecer com um retângulo em volta nos documentos.</span>
                </div>
              )}

              {tenant?.logo_path ? (
                <div className="flex flex-col gap-2">
                  {/* Dual Preview: Fundo Claro vs Fundo Escuro */}
                  <div className="grid grid-cols-2 gap-3 p-3 bg-graphite-900 rounded-lg border border-graphite-700">
                    <div className="flex flex-col items-center gap-1.5 p-3 bg-white rounded border border-graphite-300">
                      <span className="font-mono text-[10px] text-graphite-700 uppercase font-bold">Preview Fundo Claro (Papel/PDF)</span>
                      <img
                        src={getFotoPublicUrl(tenant.logo_path) || ''}
                        alt="Logo da oficina (Claro)"
                        className="h-14 object-contain"
                      />
                    </div>
                    <div className="flex flex-col items-center gap-1.5 p-3 bg-graphite-950 rounded border border-graphite-800">
                      <span className="font-mono text-[10px] text-vapor-400 uppercase font-bold">Preview Fundo Escuro (Tela)</span>
                      <img
                        src={getFotoPublicUrl(tenant.logo_path) || ''}
                        alt="Logo da oficina (Escuro)"
                        className="h-14 object-contain"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={handleRemoveLogo}
                      disabled={uploadingLogo}
                      className="text-[12px] bg-flare-500/10 text-flare-400 border-flare-500/30 hover:bg-flare-500/20"
                    >
                      <Trash size={14} />
                      <span>Remover Logo</span>
                    </Button>
                  </div>
                </div>
              ) : (
                <label className="border-2 border-dashed border-graphite-700 hover:border-amber-500/60 rounded-lg p-5 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors bg-graphite-900/40">
                  <Upload size={20} className="text-amber-500" />
                  <span className="font-sans text-[12px] text-vapor-200 font-semibold">
                    {uploadingLogo ? 'Enviando logo...' : 'Fazer upload da logo da oficina'}
                  </span>
                  <span className="font-sans text-[10px] text-vapor-500">
                    Recomendado: PNG com fundo transparente (Até 2MB)
                  </span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    onChange={handleLogoUpload}
                    disabled={uploadingLogo}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            {/* UPLOAD 2: Capa do Catálogo (Vitrine) */}
            <div className="flex flex-col gap-3 mt-4 pt-4 border-t border-graphite-700">
              <label className="font-sans text-[14px] text-vapor-100 font-bold flex items-center justify-between">
                <span>Capa do catálogo</span>
                <span className="text-[11px] text-amber-500 font-mono font-normal">Vitrine Digital</span>
              </label>

              <p className="font-sans text-[12px] text-vapor-400 leading-snug">
                Aparece na sua página pública de agendamento.
              </p>

              {capaError && (
                <div className="p-2.5 bg-flare-400/10 border border-flare-400/30 rounded text-flare-400 text-[12px] flex items-center gap-2">
                  <AlertTriangle size={14} className="shrink-0" />
                  <span>{capaError}</span>
                </div>
              )}

              {tenant?.capa_path ? (
                <div className="relative rounded overflow-hidden border border-graphite-700 bg-graphite-900 group">
                  <img
                    src={getFotoPublicUrl(tenant.capa_path) || ''}
                    alt="Capa do catálogo"
                    className="w-full h-36 object-cover"
                  />
                  <button
                    type="button"
                    onClick={handleRemoveCapa}
                    disabled={uploadingCapa}
                    className="absolute top-2 right-2 p-2 bg-flare-500 hover:bg-flare-600 text-white rounded transition-colors shadow-md"
                    title="Remover capa"
                  >
                    <Trash size={14} />
                  </button>
                </div>
              ) : (
                <label className="border-2 border-dashed border-graphite-700 hover:border-graphite-600 rounded-lg p-5 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors bg-graphite-900/40">
                  <Upload size={20} className="text-vapor-400" />
                  <span className="font-sans text-[12px] text-vapor-300 font-semibold">
                    {uploadingCapa ? 'Enviando foto...' : 'Fazer upload da capa do catálogo'}
                  </span>
                  <span className="font-sans text-[10px] text-vapor-500">
                    PNG, JPG ou WEBP de até 2MB
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp"
                    onChange={handleCapaUpload}
                    disabled={uploadingCapa}
                    className="hidden"
                  />
                </label>
              )}
            </div>
          </Card>

          {/* Card Vitrine Digital & Link da Bio */}
          <Card className="p-6 bg-graphite-800 border-amber-500/30 flex flex-col gap-4 max-w-xl flex-1 w-full shadow-lg">
            <div className="flex items-center justify-between border-b border-graphite-700 pb-3">
              <h3 className="font-display text-[16px] text-vapor-100 uppercase tracking-wide flex items-center gap-2">
                <Globe size={18} className="text-amber-500" />
                <span>Vitrine Digital (Link da Bio)</span>
              </h3>
              <Badge tone="amber">Endereço Público</Badge>
            </div>

            <p className="font-sans text-[13px] text-vapor-400 leading-relaxed">
              Este é o link público do catálogo online da sua oficina. Use no Instagram, WhatsApp e cartões de visita.
            </p>

            <form onSubmit={handleSaveSlug} className="flex flex-col gap-3">
              <label className="font-sans text-[13px] text-vapor-300 font-medium">Endereço Público (Slug):</label>
              
              <div className="flex items-center bg-graphite-950 border border-graphite-600 rounded-lg p-2 font-mono text-[13px] overflow-hidden focus-within:border-amber-500 transition-colors">
                <span className="text-vapor-500 shrink-0 select-none">{window.location.origin}/agendar/</span>
                <input
                  type="text"
                  value={slugInput}
                  onChange={(e) => setSlugInput(e.target.value)}
                  placeholder="sua-oficina"
                  disabled={!isDono || savingSlug}
                  className="bg-transparent text-amber-400 font-bold outline-none flex-1 min-w-0"
                />
              </div>

              <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded text-amber-400 text-[12px] flex items-start gap-2">
                <AlertTriangle size={15} className="shrink-0 mt-0.5 text-amber-400" />
                <span>
                  <strong>Aviso:</strong> Ao alterar o endereço, o link anterior deixará de funcionar imediatamente. Lembre-se de atualizar onde você já divulgou.
                </span>
              </div>

              {slugError && (
                <div className="p-2.5 bg-flare-400/10 border border-flare-400/30 rounded text-flare-400 text-[12px] flex items-center gap-2">
                  <AlertTriangle size={14} className="shrink-0" />
                  <span>{slugError}</span>
                </div>
              )}

              {slugSuccess && (
                <div className="p-2.5 bg-mint-500/10 border border-mint-500/30 rounded text-mint-400 text-[12px] flex items-center gap-2">
                  <Check size={14} className="shrink-0" />
                  <span>{slugSuccess}</span>
                </div>
              )}

              {isDono && slugInput.trim().toLowerCase() !== (tenant?.slug || '') && (
                <Button
                  type="submit"
                  variant="primary"
                  disabled={savingSlug}
                  className="w-full mt-1 flex items-center justify-center gap-2 font-semibold"
                >
                  <Save size={16} />
                  <span>{savingSlug ? 'Salvando...' : 'Salvar Novo Endereço'}</span>
                </Button>
              )}
            </form>

            <div className="pt-3 border-t border-graphite-700 flex flex-col sm:flex-row items-center gap-3">
              <CopyLinkButton slug={tenant?.slug} className="w-full sm:w-auto flex-1" />
              
              {tenant?.slug && (
                <a
                  href={`/agendar/${tenant.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full sm:w-auto px-4 py-2 rounded-md bg-graphite-900 hover:bg-graphite-700 text-vapor-200 border border-graphite-600 font-sans text-[13px] font-medium flex items-center justify-center gap-2 transition-colors shrink-0"
                >
                  <span>Abrir Preview</span>
                  <ExternalLink size={14} />
                </a>
              )}
            </div>
          </Card>
        </div>
      )}

      {activeTab === 'horarios' && (isDono || podeGerirEquipe()) && <AbaHorarios />}

      {activeTab === 'equipe' && podeGerirEquipe() && <AbaEquipe />}

      {activeTab === 'categorias' && isDono && <AbaCategorias />}

      {activeTab === 'checklists' && (isDono || podeGerirEquipe()) && <AbaChecklists />}

      {activeTab === 'plano' && (
        <div className="flex flex-col gap-6">
          <AbaAssinatura />

          <Card className="p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-6 max-w-3xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-[18px] text-vapor-100 uppercase tracking-wide">
                Limites do Plano {nomePlano.toUpperCase()}
              </h3>
              <Badge tone={planoAtual === 'studio' ? 'mint' : planoAtual === 'pro' ? 'amber' : 'glass'}>
                {nomePlano.toUpperCase()}
              </Badge>
            </div>

            <div className="flex flex-col gap-3 font-sans text-[14px]">
              <div className="flex justify-between py-2 border-b border-graphite-700">
                <span className="text-vapor-400">Usuários permitidos:</span>
                <strong className="text-vapor-100 font-mono">
                  {limiteDe('usuarios') !== null ? `${limiteDe('usuarios')} pessoa(s)` : 'Ilimitado'}
                </strong>
              </div>
              <div className="flex justify-between py-2 border-b border-graphite-700">
                <span className="text-vapor-400">Serviços / Mês:</span>
                <strong className="text-vapor-100 font-mono">
                  {limiteDe('servicos_mes') !== null ? `${limiteDe('servicos_mes')} por mês` : 'Ilimitado'}
                </strong>
              </div>
              <div className="flex justify-between py-2 border-b border-graphite-700">
                <span className="text-vapor-400">Orçamentos / Mês:</span>
                <strong className="text-vapor-100 font-mono">
                  {limiteDe('orcamentos_mes') !== null ? `${limiteDe('orcamentos_mes')} por mês` : 'Ilimitado'}
                </strong>
              </div>
              <div className="flex justify-between py-2 border-b border-graphite-700">
                <span className="text-vapor-400">Módulo de Estoque e Produtos:</span>
                <strong className="text-vapor-100 font-mono">
                  {limiteDe('produtos') === 0 ? 'Não incluso no Free' : 'Incluso'}
                </strong>
              </div>
            </div>
          </Card>
        </div>
      )}

      {activeTab === 'despesas' && isDono && <AbaDespesasFixas />}

      {activeTab === 'agendamento' && isDono && <AbaAgendamentoOnline />}

      {activeTab === 'pdf' && (isDono || podeGerirServicos()) && (
        <AbaPersonalizacaoPDF onNavigateToPlano={() => setActiveTab('plano')} />
      )}

      {/* Rodapé de Conformidade e Documentos Legais */}
      <div className="mt-12 pt-6 border-t border-graphite-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-vapor-500 font-sans">
        <span>NuvemWash • Software de Gestão para Estética Automotiva</span>
        <div className="flex items-center gap-4">
          <Link
            to="/termos-de-uso"
            target="_blank"
            className="text-vapor-400 hover:text-amber-400 transition-colors font-medium"
          >
            Termos de Uso
          </Link>
          <span>•</span>
          <Link
            to="/politica-de-privacidade"
            target="_blank"
            className="text-vapor-400 hover:text-amber-400 transition-colors font-medium"
          >
            Política de Privacidade
          </Link>
        </div>
      </div>
    </div>
  );
};
