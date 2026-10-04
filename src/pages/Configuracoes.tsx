import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
import { AbaAgendamentoOnline } from '../components/configuracoes/AbaAgendamentoOnline';
import { AbaPersonalizacaoPDF } from '../components/configuracoes/AbaPersonalizacaoPDF';
import { AbaMetaMensal } from './configuracoes/AbaMetaMensal';
import { AbaFeedbacks } from './configuracoes/AbaFeedbacks';
import { AbaAssinatura } from './configuracoes/AbaAssinatura';
import { AbaTermosGarantia } from './configuracoes/AbaTermosGarantia';
import { AbaFiscal } from '../components/configuracoes/AbaFiscal';
import { AbaWhatsApp } from '../components/configuracoes/AbaWhatsApp';
import { Building2, Users, CreditCard, Tag, Upload, Trash, AlertTriangle, ExternalLink, Globe, Check, Save, Clock, CheckSquare, FileText, Target, MessageSquare, ShieldCheck, QrCode, Download, Sparkles, Receipt, MessageCircle, User, Edit2, X } from 'lucide-react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { validateImageFile, comprimirImagemCatalogo, getFotoPublicUrl } from '../utils/imagens';
import { ModalPlacaBalcao } from '../components/vitrine/ModalPlacaBalcao';

interface ConfiguracoesProps {
  abaInicial?: 'perfil' | 'oficina' | 'horarios' | 'equipe' | 'categorias' | 'checklists' | 'despesas' | 'plano' | 'agendamento' | 'pdf' | 'meta' | 'feedbacks' | 'termos' | 'fiscal' | 'whatsapp';
}

export const Configuracoes: React.FC<ConfiguracoesProps> = ({ abaInicial }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { tenant, refetchTenantData, profile, user, membership } = useAuth();
  const { isDono, podeGerirEquipe, podeGerirServicos } = usePermissao();
  const { planoAtual, nomePlano, limiteDe } = usePlano();

  const getTabPadrao = () => {
    if (abaInicial) return abaInicial;
    return 'oficina';
  };

  const [activeTab, setActiveTab] = useState<'perfil' | 'oficina' | 'horarios' | 'equipe' | 'categorias' | 'checklists' | 'despesas' | 'plano' | 'agendamento' | 'pdf' | 'meta' | 'feedbacks' | 'termos' | 'fiscal' | 'whatsapp'>(getTabPadrao());

  useEffect(() => {
    const queryParams = new URLSearchParams(location.search);
    const abaParam = (queryParams.get('aba') || queryParams.get('tab') || '').toLowerCase();
    if (abaParam === 'treinamento') {
      navigate('/treinamentos', { replace: true });
      return;
    }
    if (abaParam === 'arquivos' || location.pathname.includes('arquivos-digitais')) {
      navigate('/arquivos-digitais', { replace: true });
      return;
    }
    if (abaParam === 'despesas' || abaParam === 'contas' || abaInicial === 'despesas') {
      navigate('/financeiro/despesas', { replace: true });
      return;
    }
    if (abaParam === 'plano' || abaParam === 'assinatura') {
      setActiveTab('plano');
    } else if (abaParam === 'fiscal' || abaParam === 'nfse') {
      setActiveTab('fiscal');
    } else if (abaParam === 'whatsapp' || abaParam === 'zap') {
      setActiveTab('whatsapp');
    } else if (['termos', 'garantia', 'garantias', 'minuta', 'minutas'].includes(abaParam)) {
      setActiveTab('termos');
    } else if (['perfil', 'usuario', 'meuperfil', 'dados'].includes(abaParam)) {
      setActiveTab('perfil');
    } else if (['oficina', 'horarios', 'equipe', 'categorias', 'checklists', 'agendamento', 'pdf', 'meta', 'feedbacks'].includes(abaParam)) {
      setActiveTab(abaParam as any);
    } else if (abaInicial) {
      setActiveTab(abaInicial);
    }
  }, [location.pathname, location.search, abaInicial, navigate]);

  // Estados de Edição do Perfil Pessoal do Usuário Logado
  const [meuNomeInput, setMeuNomeInput] = useState(profile?.nome || '');
  const [meuTelefoneInput, setMeuTelefoneInput] = useState(profile?.telefone || '');
  const [salvandoMeuPerfil, setSalvandoMeuPerfil] = useState(false);
  const [meuPerfilError, setMeuPerfilError] = useState<string | null>(null);
  const [meuPerfilSuccess, setMeuPerfilSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setMeuNomeInput(profile.nome || '');
      setMeuTelefoneInput(profile.telefone || '');
    }
  }, [profile]);

  const handleSalvarMeuPerfil = async (e: React.FormEvent) => {
    e.preventDefault();
    setMeuPerfilError(null);
    setMeuPerfilSuccess(null);

    const nomeLimpo = meuNomeInput.trim();
    if (!nomeLimpo || nomeLimpo.length < 2) {
      setMeuPerfilError('Seu nome completo deve ter pelo menos 2 caracteres.');
      return;
    }

    setSalvandoMeuPerfil(true);
    try {
      // 1. Tenta via RPC atualizar_meu_perfil para sincronia atômica (profiles + auth.users)
      const { error: rpcError } = await supabase.rpc('atualizar_meu_perfil', {
        p_nome: nomeLimpo,
        p_telefone: meuTelefoneInput.trim() || null,
      });

      if (rpcError) {
        // Fallback direto via tabela profiles se a RPC ainda não tiver sido propagada
        if (user) {
          const { error: directError } = await supabase
            .from('profiles')
            .update({
              nome: nomeLimpo,
              telefone: meuTelefoneInput.trim() || null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', user.id);

          if (directError) throw directError;
        } else {
          throw rpcError;
        }
      }

      setMeuPerfilSuccess('Seus dados pessoais foram salvos com sucesso!');
      await refetchTenantData();
    } catch (err: any) {
      console.error('[Salvar Meu Perfil Error]:', err);
      setMeuPerfilError(err.message || 'Erro ao atualizar seu perfil.');
    } finally {
      setSalvandoMeuPerfil(false);
    }
  };

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
  const [savingIdentidade, setSavingIdentidade] = useState(false);
  const [identidadeError, setIdentidadeError] = useState<string | null>(null);
  const [identidadeSuccess, setIdentidadeSuccess] = useState<string | null>(null);

  const [contadorOS, setContadorOS] = useState<{ proxima_os: number; ultimo_marco_exibido: number } | null>(null);

  useEffect(() => {
    if (tenant) {
      setDocTipo(tenant.documento_tipo || 'cnpj');
      setDocumentoInput(tenant.documento || '');
      setRazaoSocialInput(tenant.razao_social || '');

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

  // Estados e Funções de Alteração de Nome da Oficina (Regra de 15 dias, Unicidade e Sincronia de Slug)
  const [modalEditarNomeOficina, setModalEditarNomeOficina] = useState(false);
  const [novoNomeOficinaInput, setNovoNomeOficinaInput] = useState('');
  const [salvandoNomeOficina, setSalvandoNomeOficina] = useState(false);
  const [erroNomeOficina, setErroNomeOficina] = useState<string | null>(null);
  const [sucessoNomeOficina, setSucessoNomeOficina] = useState<string | null>(null);

  const calcularSlugPreview = (nome: string, currentSlug?: string | null) => {
    const limpo = (nome || '').toLowerCase().trim();
    if (!limpo) return '—';
    const base = limpo
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'oficina';
    const suffixMatch = currentSlug ? currentSlug.match(/-[a-f0-9]{6}$/) : null;
    return suffixMatch ? `${base}${suffixMatch[0]}` : `${base}-xxxxxx`;
  };

  const dataUltimaAlteracao = tenant?.nome_alterado_em ? new Date(tenant.nome_alterado_em) : null;
  const diasPassadosDesdeAlteracao = dataUltimaAlteracao
    ? (Date.now() - dataUltimaAlteracao.getTime()) / (1000 * 60 * 60 * 24)
    : 999;
  const diasRestantesCooldown = Math.max(0, Math.ceil(15 - diasPassadosDesdeAlteracao));
  const oficinaEmCooldown = diasRestantesCooldown > 0;

  const handleAbrirModalNomeOficina = () => {
    setNovoNomeOficinaInput(tenant?.nome || '');
    setErroNomeOficina(null);
    setSucessoNomeOficina(null);
    setModalEditarNomeOficina(true);
  };

  const handleSalvarNovoNomeOficina = async (e: React.FormEvent) => {
    e.preventDefault();
    setErroNomeOficina(null);
    setSucessoNomeOficina(null);

    const nomeLimpo = novoNomeOficinaInput.trim();
    if (!nomeLimpo || nomeLimpo.length < 2) {
      setErroNomeOficina('O nome da oficina deve ter pelo menos 2 caracteres.');
      return;
    }

    if (nomeLimpo.toLowerCase() === (tenant?.nome || '').toLowerCase()) {
      setErroNomeOficina('O novo nome é idêntico ao atual.');
      return;
    }

    setSalvandoNomeOficina(true);
    try {
      const { data, error } = await supabase.rpc('atualizar_nome_oficina', {
        p_novo_nome: nomeLimpo,
      });

      if (error) throw error;

      const slugRetornado = data?.slug || '';
      setSucessoNomeOficina(`Nome e endereço da oficina atualizados com sucesso! Novo link: /agendar/${slugRetornado}`);
      await refetchTenantData();
      setTimeout(() => {
        setModalEditarNomeOficina(false);
      }, 2000);
    } catch (err: any) {
      console.error('[Atualizar Nome Oficina Error]:', err);
      setErroNomeOficina(err.message || 'Erro ao alterar o nome da oficina.');
    } finally {
      setSalvandoNomeOficina(false);
    }
  };

  const [downloadingQr, setDownloadingQr] = useState(false);
  const [showPlacaBalcaoModal, setShowPlacaBalcaoModal] = useState(false);

  const handleBaixarQrCode = async () => {
    if (!tenant?.slug) return;
    try {
      setDownloadingQr(true);
      const urlDestino = `${window.location.origin}/agendar/${tenant.slug}`;
      const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=800x800&data=${encodeURIComponent(urlDestino)}&margin=15&format=png`;
      const response = await fetch(qrApiUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `qrcode-vitrine-${tenant.slug}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Erro ao baixar QR Code:', err);
    } finally {
      setDownloadingQr(false);
    }
  };

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

    const { valid, error } = validateImageFile(file);
    if (!valid) {
      setLogoError(error || 'Formato inválido. Use JPG, PNG ou WEBP.');
      return;
    }

    setUploadingLogo(true);

    try {
      const hasAlpha = await checkImageHasAlpha(file);
      if (!hasAlpha) {
        setLogoSemAlfa(true);
      }

      // Comprime mantendo transparência se for PNG
      const { file: compressedFile, ext: finalExt } = await comprimirImagemCatalogo(file, {
        maxDimension: 1200,
        targetMaxBytes: 250 * 1024,
        preservePngTransparency: true,
      });

      const newPath = `${tenant.id}/oficina/logo.${finalExt}`;

      if (tenant.logo_path && tenant.logo_path !== newPath) {
        await supabase.storage.from('catalogo').remove([tenant.logo_path]);
      }

      const { error: uploadError } = await supabase.storage
        .from('catalogo')
        .upload(newPath, compressedFile, { upsert: true });

      if (uploadError) throw uploadError;

      const { error: updateError } = await supabase
        .from('tenants')
        .update({ logo_path: newPath })
        .eq('id', tenant.id);

      if (updateError) throw updateError;

      await refetchTenantData();
    } catch (err: any) {
      console.error('[Logo Upload Error]:', err);
      setLogoError(err.message || 'Erro ao processar e enviar a logo.');
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

  const handleCapaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0 || !tenant) return;
    const file = e.target.files[0];
    setCapaError(null);

    const { valid, error } = validateImageFile(file);
    if (!valid) {
      setCapaError(error || 'Formato inválido. Use JPG, PNG ou WEBP.');
      return;
    }

    setUploadingCapa(true);

    try {
      // Comprime no cliente para o menor tamanho possível (< 220KB)
      const { file: compressedFile, ext: finalExt } = await comprimirImagemCatalogo(file, {
        maxDimension: 1280,
        targetMaxBytes: 200 * 1024,
      });

      const newPath = `${tenant.id}/oficina/capa.${finalExt}`;

      if (tenant.capa_path && tenant.capa_path !== newPath) {
        await supabase.storage.from('catalogo').remove([tenant.capa_path]);
      }

      const { error: uploadError } = await supabase.storage
        .from('catalogo')
        .upload(newPath, compressedFile, { upsert: true });

      if (uploadError) throw uploadError;

      const { error: updateError } = await supabase
        .from('tenants')
        .update({ capa_path: newPath })
        .eq('id', tenant.id);

      if (updateError) throw updateError;

      await refetchTenantData();
    } catch (err: any) {
      console.error('[Capa Upload Error]:', err);
      setCapaError(err.message || 'Erro ao processar e enviar a capa.');
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
          { id: 'perfil', label: 'Meu Perfil', icon: User },
          { id: 'oficina', label: 'Oficina', icon: Building2 },
          ...((isDono || podeGerirEquipe()) ? [{ id: 'horarios', label: 'Horários & Agenda', icon: Clock }] : []),
          ...(podeGerirEquipe() ? [{ id: 'equipe', label: 'Equipe', icon: Users }] : []),
          ...(isDono ? [{ id: 'categorias', label: 'Categorias', icon: Tag }] : []),
          ...((isDono || podeGerirEquipe()) ? [{ id: 'checklists', label: 'Checklists', icon: CheckSquare }] : []),
          ...(isDono ? [{ id: 'agendamento', label: 'Agendamento Online & Vitrine', icon: Globe }] : []),
          { id: 'plano', label: 'Plano e Limites', icon: CreditCard },
          ...((isDono || podeGerirServicos()) ? [{ id: 'fiscal', label: 'Dados Fiscais & NFS-e', icon: Receipt }] : []),
          ...((isDono || podeGerirServicos()) ? [{ id: 'whatsapp', label: 'WhatsApp & Avisos', icon: MessageCircle }] : []),
          ...((isDono || podeGerirServicos()) ? [{ id: 'pdf', label: 'Documentos PDF', icon: FileText }] : []),
          ...((isDono || podeGerirServicos()) ? [{ id: 'termos', label: 'Termos de Garantia', icon: ShieldCheck }] : []),
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
      {activeTab === 'termos' && <AbaTermosGarantia />}
      {activeTab === 'fiscal' && <AbaFiscal />}
      {activeTab === 'whatsapp' && <AbaWhatsApp />}

      {activeTab === 'perfil' && (
        <div className="flex flex-col lg:flex-row items-start gap-6">
          <Card className="p-4 sm:p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-5 max-w-2xl flex-1 w-full shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-graphite-700 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold shrink-0">
                  <User size={20} />
                </div>
                <div>
                  <h3 className="font-display text-[16px] sm:text-[18px] text-vapor-100 uppercase tracking-wide">
                    Meu Perfil de Usuário
                  </h3>
                  <p className="font-sans text-[12px] text-vapor-400">
                    Seus dados pessoais de identificação na plataforma NuvemWash
                  </p>
                </div>
              </div>
              <Badge tone="amber" className="self-start sm:self-auto">
                {membership?.role === 'dono' ? 'Proprietário' : membership?.role === 'gerente' ? 'Gerente' : 'Membro'}
              </Badge>
            </div>

            {meuPerfilError && (
              <div className="p-3 bg-flare-400/10 border border-flare-400/30 rounded-lg text-flare-400 text-[13px] flex items-center gap-2">
                <AlertTriangle size={16} className="shrink-0" />
                <span>{meuPerfilError}</span>
              </div>
            )}

            {meuPerfilSuccess && (
              <div className="p-3 bg-mint-500/10 border border-mint-500/30 rounded-lg text-mint-400 text-[13px] flex items-center gap-2">
                <Check size={16} className="shrink-0" />
                <span>{meuPerfilSuccess}</span>
              </div>
            )}

            <form onSubmit={handleSalvarMeuPerfil} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="font-sans text-[13px] text-vapor-300 font-medium">
                  Nome Completo *
                </label>
                <input
                  type="text"
                  value={meuNomeInput}
                  onChange={(e) => setMeuNomeInput(e.target.value)}
                  placeholder="Seu nome completo"
                  required
                  className="bg-graphite-950 border border-graphite-600 rounded-lg p-3 text-vapor-100 font-sans text-[14px] outline-none focus:border-amber-500 min-h-[48px]"
                />
                <span className="font-sans text-[11px] text-vapor-500">
                  Este é o nome com o qual você assina orçamentos, vistorias e é reconhecido na equipe.
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-sans text-[13px] text-vapor-300 font-medium">
                  WhatsApp / Telefone Pessoal
                </label>
                <input
                  type="text"
                  value={meuTelefoneInput}
                  onChange={(e) => setMeuTelefoneInput(e.target.value)}
                  placeholder="(11) 99999-9999"
                  className="bg-graphite-950 border border-graphite-600 rounded-lg p-3 text-vapor-100 font-sans text-[14px] outline-none focus:border-amber-500 min-h-[48px]"
                />
              </div>

              <div className="flex flex-col gap-1.5 pt-2 border-t border-graphite-700/80">
                <label className="font-sans text-[13px] text-vapor-400 font-medium flex items-center gap-1.5">
                  <ShieldCheck size={15} className="text-vapor-500" />
                  <span>E-mail da Conta (Acesso)</span>
                </label>
                <input
                  type="email"
                  value={user?.email || ''}
                  disabled
                  className="bg-graphite-900 border border-graphite-700 rounded-lg p-3 text-vapor-400 font-mono text-[13px] cursor-not-allowed select-all"
                />
                <span className="font-sans text-[11px] text-vapor-500">
                  O e-mail é a sua chave única de acesso ao sistema.
                </span>
              </div>

              <div className="flex justify-end pt-3">
                <Button
                  type="submit"
                  variant="primary"
                  disabled={salvandoMeuPerfil}
                  className="min-h-[44px] px-6 font-semibold flex items-center justify-center gap-2 w-full sm:w-auto"
                >
                  <Save size={16} />
                  <span>{salvandoMeuPerfil ? 'Salvando...' : 'Salvar Meus Dados'}</span>
                </Button>
              </div>
            </form>
          </Card>

          {/* Card Informativo Lateral */}
          <Card className="p-4 sm:p-6 bg-graphite-800 border-graphite-700 flex flex-col gap-4 max-w-md w-full shadow-lg">
            <h4 className="font-display text-[15px] text-vapor-100 uppercase tracking-wide flex items-center gap-2">
              <Building2 size={16} className="text-amber-500" />
              <span>Vínculo com a Oficina</span>
            </h4>
            <div className="flex flex-col gap-3 text-[13px] text-vapor-300 font-sans">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 border-b border-graphite-700 gap-1">
                <span className="text-vapor-400">Oficina Ativa:</span>
                <strong className="text-vapor-100 text-left sm:text-right break-words min-w-0">{tenant?.nome || '—'}</strong>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 border-b border-graphite-700 gap-1">
                <span className="text-vapor-400">Seu Papel:</span>
                <span className="font-semibold text-amber-400 uppercase font-mono text-[12px] text-left sm:text-right">
                  {membership?.role === 'dono' ? 'Proprietário' : membership?.role === 'gerente' ? 'Gerente' : 'Operador'}
                </span>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 border-b border-graphite-700 gap-1">
                <span className="text-vapor-400">Status:</span>
                <span className="text-mint-400 font-semibold uppercase text-[12px] text-left sm:text-right">
                  {membership?.status || 'Ativo'}
                </span>
              </div>
            </div>
            <p className="text-[12px] text-vapor-400 leading-relaxed pt-2">
              Caso você seja o proprietário da estética, você também pode alterar os dados legais da sua empresa na aba <strong>Oficina</strong>.
            </p>
          </Card>
        </div>
      )}

      {activeTab === 'oficina' && (
        <div className="flex flex-col lg:flex-row items-start gap-6">
          <Card className="p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-4 max-w-2xl flex-1 w-full">
            {/* Banner Rápido de Acesso ao Perfil */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3.5 bg-graphite-900 border border-graphite-700/80 rounded-lg">
              <div className="flex items-center gap-2.5 min-w-0">
                <User size={16} className="text-amber-500 shrink-0" />
                <span className="font-sans text-[13px] text-vapor-300 truncate">
                  Logado como: <strong className="text-vapor-100">{profile?.nome || user?.email}</strong>
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('perfil')}
                className="text-amber-400 hover:text-amber-300 text-xs font-semibold underline flex items-center gap-1 cursor-pointer shrink-0 self-start sm:self-auto"
              >
                <span>Editar meu nome</span>
                <ExternalLink size={12} />
              </button>
            </div>

            <h3 className="font-display text-[18px] text-vapor-100 uppercase tracking-wide">
              Dados da Oficina
            </h3>
            <div className="flex flex-col gap-3 font-sans text-[14px] text-vapor-400">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 border-b border-graphite-700 gap-2">
                <span className="text-vapor-400 shrink-0">Nome da Oficina:</span>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <strong className="text-vapor-100 text-left sm:text-right break-words min-w-0">{tenant?.nome || '—'}</strong>
                  {isDono && (
                    <button
                      type="button"
                      onClick={handleAbrirModalNomeOficina}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-semibold transition cursor-pointer shrink-0"
                      title={oficinaEmCooldown ? `Próxima alteração liberada em ${diasRestantesCooldown} dia(s)` : 'Alterar Nome da Oficina'}
                    >
                      <Edit2 size={12} />
                      <span>Alterar Nome</span>
                      {oficinaEmCooldown && (
                        <span className="text-[10px] bg-amber-500/20 px-1 rounded font-mono">
                          {diasRestantesCooldown}d
                        </span>
                      )}
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 border-b border-graphite-700 gap-1">
                <span className="text-vapor-400 shrink-0">Endereço Público (Slug):</span>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-amber-500 text-left sm:text-right break-all min-w-0">/{tenant?.slug || '—'}</span>
                  {tenant?.nome_alterado_em && (
                    <span className="text-[11px] text-vapor-500 font-mono" title={`Última alteração em ${new Date(tenant.nome_alterado_em).toLocaleDateString('pt-BR')}`}>
                      • Atualizado em {new Date(tenant.nome_alterado_em).toLocaleDateString('pt-BR')}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 border-b border-graphite-700 gap-1">
                <span className="text-vapor-400 shrink-0">Cidade / UF:</span>
                <span className="text-vapor-100 text-left sm:text-right break-words min-w-0">
                  {tenant?.cidade ? `${tenant.cidade} / ${tenant.uf || ''}` : '—'}
                </span>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 border-b border-graphite-700 gap-1">
                <span className="text-vapor-400 shrink-0">Telefone / WhatsApp:</span>
                <span className="text-vapor-100 text-left sm:text-right break-words min-w-0">{tenant?.telefone || '—'}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 border-b border-graphite-700 gap-1">
                <span className="text-vapor-400 shrink-0">Total de OSs Criadas:</span>
                <span className="font-mono text-amber-400 font-bold text-left sm:text-right">
                  {contadorOS ? `${contadorOS.proxima_os - 1} OS(s)` : '0 OS(s)'}
                </span>
              </div>
              {contadorOS && contadorOS.ultimo_marco_exibido > 0 && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 border-b border-graphite-700 gap-1">
                  <span className="text-vapor-400 shrink-0">Último Marco Atingido:</span>
                  <span className="font-mono text-mint-400 font-bold text-left sm:text-right">
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-graphite-900 rounded-lg border border-graphite-700">
                    <div className="flex flex-col items-center gap-1.5 p-3 bg-white rounded border border-graphite-300">
                      <span className="font-mono text-[10px] text-graphite-700 uppercase font-bold text-center">Preview Fundo Claro (Papel/PDF)</span>
                      <img
                        src={getFotoPublicUrl(tenant.logo_path) || ''}
                        alt="Logo da oficina (Claro)"
                        className="h-14 object-contain max-w-full"
                      />
                    </div>
                    <div className="flex flex-col items-center gap-1.5 p-3 bg-graphite-950 rounded border border-graphite-800">
                      <span className="font-mono text-[10px] text-vapor-400 uppercase font-bold text-center">Preview Fundo Escuro (Tela)</span>
                      <img
                        src={getFotoPublicUrl(tenant.logo_path) || ''}
                        alt="Logo da oficina (Escuro)"
                        className="h-14 object-contain max-w-full"
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
                    Recomendado: PNG com fundo transparente (Compressão automática inteligente)
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
                    PNG, JPG ou WEBP (Comprimido automaticamente para máxima economia de storage)
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

            <div className="flex flex-col gap-3">
              <label className="font-sans text-[13px] text-vapor-300 font-medium">Link da Vitrine (Sincronizado):</label>
              
              <div className="flex flex-col sm:flex-row sm:items-center bg-graphite-950 border border-graphite-600 rounded-lg p-3 font-mono text-[13px] gap-1 sm:gap-2">
                <span className="text-vapor-500 shrink-0 select-none text-xs sm:text-[13px]">{window.location.origin}/agendar/</span>
                <span className="text-amber-400 font-bold break-all flex-1">{tenant?.slug || 'sua-oficina'}</span>
              </div>

              <div className="p-3 bg-graphite-900 border border-graphite-700 rounded-lg text-vapor-400 text-[12px] flex items-start gap-2.5">
                <Building2 size={16} className="shrink-0 mt-0.5 text-amber-500" />
                <div className="space-y-1">
                  <div>
                    O endereço público da vitrine é sincronizado com o <strong>nome registrado da sua oficina</strong> ({tenant?.nome || '—'}).
                  </div>
                  <div className="text-vapor-500 text-[11px]">
                    {oficinaEmCooldown
                      ? `Próxima alteração disponível em ${diasRestantesCooldown} dia(s).`
                      : 'Alterações de nome e link são permitidas uma vez a cada 15 dias.'}
                  </div>
                </div>
              </div>

              {isDono && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleAbrirModalNomeOficina}
                  className="w-full flex items-center justify-center gap-2 font-semibold border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                >
                  <Edit2 size={15} />
                  <span>Alterar Nome e Link da Oficina</span>
                  {oficinaEmCooldown && (
                    <span className="text-[10px] bg-amber-500/20 px-1.5 py-0.5 rounded font-mono">
                      {diasRestantesCooldown}d restantes
                    </span>
                  )}
                </Button>
              )}
            </div>

            <div className="pt-3 border-t border-graphite-700 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
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

            {tenant?.slug && (
              <div className="pt-4 border-t border-graphite-700 flex flex-col sm:flex-row items-center gap-4 bg-graphite-900/60 p-4 rounded-lg border border-graphite-700/60">
                <div className="bg-white p-2 rounded-md shadow-inner flex items-center justify-center shrink-0">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(`${window.location.origin}/agendar/${tenant.slug}`)}&margin=4`}
                    alt="QR Code da Vitrine"
                    className="w-20 h-20"
                  />
                </div>
                <div className="flex flex-col gap-1.5 flex-1 text-center sm:text-left">
                  <div className="flex items-center justify-center sm:justify-start gap-1.5 font-display text-[13px] text-vapor-100 uppercase tracking-wide">
                    <QrCode size={16} className="text-amber-400" />
                    <span>QR Code de Balcão (Recepção)</span>
                  </div>
                  <p className="text-[12px] text-vapor-400">
                    Imprima ou baixe para colocar no balcão da sua estética. O cliente aponta a câmera e acessa seus serviços e agendamento imediatamente!
                  </p>
                  <div className="pt-1 flex flex-wrap gap-2 justify-center sm:justify-start">
                    <Button
                      type="button"
                      variant="primary"
                      onClick={() => setShowPlacaBalcaoModal(true)}
                      className="text-[12px] py-1.5 px-3.5 flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-graphite-950 font-semibold shadow-md shadow-amber-500/10"
                    >
                      <Sparkles size={14} className="text-graphite-950" />
                      <span>Gerar Placa de Balcão (Display de Mesa)</span>
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={handleBaixarQrCode}
                      disabled={downloadingQr}
                      className="text-[12px] py-1.5 px-3 flex items-center justify-center gap-2 w-full sm:w-auto"
                    >
                      <Download size={14} />
                      <span>{downloadingQr ? 'Baixando...' : 'Apenas QR Code PNG'}</span>
                    </Button>
                  </div>
                </div>
              </div>
            )}
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
              <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 border-b border-graphite-700 gap-1">
                <span className="text-vapor-400">Usuários permitidos:</span>
                <strong className="text-vapor-100 font-mono text-left sm:text-right">
                  {limiteDe('usuarios') !== null ? `${limiteDe('usuarios')} pessoa(s)` : 'Ilimitado'}
                </strong>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 border-b border-graphite-700 gap-1">
                <span className="text-vapor-400">Serviços / Mês:</span>
                <strong className="text-vapor-100 font-mono text-left sm:text-right">
                  {limiteDe('servicos_mes') !== null ? `${limiteDe('servicos_mes')} por mês` : 'Ilimitado'}
                </strong>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 border-b border-graphite-700 gap-1">
                <span className="text-vapor-400">Orçamentos / Mês:</span>
                <strong className="text-vapor-100 font-mono text-left sm:text-right">
                  {limiteDe('orcamentos_mes') !== null ? `${limiteDe('orcamentos_mes')} por mês` : 'Ilimitado'}
                </strong>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 border-b border-graphite-700 gap-1">
                <span className="text-vapor-400">Módulo de Estoque e Produtos:</span>
                <strong className="text-vapor-100 font-mono text-left sm:text-right">
                  {limiteDe('produtos') === 0 ? 'Não incluso no Free' : 'Incluso'}
                </strong>
              </div>
            </div>
          </Card>
        </div>
      )}

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

      {/* Modal de Alteração do Nome da Oficina para o Dono */}
      {modalEditarNomeOficina && createPortal(
        <div className="fixed inset-0 z-[100] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-graphite-900 border border-graphite-700 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6 flex flex-col gap-5 animate-in zoom-in-95 duration-150 relative">
            <button
              onClick={() => setModalEditarNomeOficina(false)}
              className="absolute top-4 right-4 text-vapor-400 hover:text-white transition cursor-pointer"
            >
              <X size={18} />
            </button>

            <div className="flex items-center gap-3 mb-1">
              <div className="p-3 bg-amber-500/15 border border-amber-500/30 rounded-xl text-amber-400 shrink-0">
                <Building2 size={24} />
              </div>
              <div>
                <h3 className="text-base font-bold text-vapor-100 font-heading">
                  Alterar Nome da Oficina
                </h3>
                <p className="text-xs text-vapor-400">
                  Atualização cadastral e link público
                </p>
              </div>
            </div>

            <form onSubmit={handleSalvarNovoNomeOficina} className="flex flex-col gap-4">
              <div className="p-3 bg-graphite-950 rounded-xl border border-graphite-800 text-xs text-vapor-300 space-y-1">
                <div>Nome atual: <strong className="text-vapor-100">{tenant?.nome}</strong></div>
                <div className="text-vapor-400">
                  Link público atual: <span className="text-amber-400 font-mono">/agendar/{tenant?.slug}</span>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-mono font-bold text-vapor-300">
                  Novo Nome da Oficina *
                </label>
                <input
                  type="text"
                  value={novoNomeOficinaInput}
                  onChange={(e) => setNovoNomeOficinaInput(e.target.value)}
                  placeholder="Ex: Detail Car Estética Automotiva"
                  autoFocus
                  required
                  disabled={oficinaEmCooldown || salvandoNomeOficina}
                  className="p-3 bg-graphite-950 border border-graphite-700 focus:border-amber-500 rounded-xl text-xs text-vapor-100 font-medium outline-none transition disabled:opacity-50"
                />
              </div>

              {/* Preview Dinâmico do Slug */}
              <div className="p-3 bg-graphite-950/80 border border-graphite-800/80 rounded-xl space-y-1 text-xs">
                <span className="text-vapor-400 block text-[11px] font-mono uppercase">
                  Novo Link Público (Sincronizado):
                </span>
                <span className="font-mono font-bold text-amber-400 text-xs break-all">
                  {window.location.origin}/agendar/{calcularSlugPreview(novoNomeOficinaInput, tenant?.slug)}
                </span>
                <span className="text-[11px] text-vapor-500 block pt-0.5">
                  Ao salvar, o link da sua vitrine e QR Code mudam automaticamente para acompanhar o novo nome.
                </span>
              </div>

              {/* Regra de Intervalo de 15 Dias */}
              {oficinaEmCooldown ? (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-xs flex items-start gap-2">
                  <AlertTriangle size={15} className="shrink-0 mt-0.5 text-amber-400" />
                  <div>
                    <strong>Intervalo Obrigatório:</strong> O nome da oficina só pode ser alterado a cada 15 dias.
                    {dataUltimaAlteracao && (
                      <div className="text-vapor-400 text-[11px] pt-1">
                        Última alteração: {dataUltimaAlteracao.toLocaleDateString('pt-BR')} às {dataUltimaAlteracao.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.
                        <br />
                        Próxima alteração liberada em <strong>{diasRestantesCooldown} dia(s)</strong>.
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-2.5 bg-graphite-950/50 border border-graphite-800 rounded text-vapor-400 text-[11px] flex items-center gap-1.5 font-mono">
                  <Clock size={13} className="text-amber-500 shrink-0" />
                  <span>Atenção: Após salvar, uma nova alteração só será permitida após 15 dias.</span>
                </div>
              )}

              {erroNomeOficina && (
                <div className="p-2.5 bg-flare-400/10 border border-flare-400/30 rounded text-flare-400 text-[12px] flex items-center gap-2">
                  <AlertTriangle size={14} className="shrink-0" />
                  <span>{erroNomeOficina}</span>
                </div>
              )}

              {sucessoNomeOficina && (
                <div className="p-2.5 bg-mint-500/10 border border-mint-500/30 rounded text-mint-400 text-[12px] flex items-center gap-2">
                  <Check size={14} className="shrink-0" />
                  <span>{sucessoNomeOficina}</span>
                </div>
              )}

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalEditarNomeOficina(false)}
                  className="flex-1 py-2.5 bg-graphite-800 hover:bg-graphite-700 text-vapor-300 font-bold rounded-xl text-xs uppercase tracking-wider transition cursor-pointer"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={
                    oficinaEmCooldown ||
                    salvandoNomeOficina ||
                    !novoNomeOficinaInput.trim() ||
                    novoNomeOficinaInput.trim().toLowerCase() === (tenant?.nome || '').toLowerCase()
                  }
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 text-graphite-950 font-bold rounded-xl text-xs uppercase tracking-wider transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-lg flex items-center justify-center gap-2"
                >
                  {salvandoNomeOficina ? (
                    'Salvando...'
                  ) : (
                    <>
                      <Save size={16} />
                      <span>Salvar Nome</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {tenant && tenant.slug && (
        <ModalPlacaBalcao
          isOpen={showPlacaBalcaoModal}
          onClose={() => setShowPlacaBalcaoModal(false)}
          oficina={{
            nome: tenant.nome,
            slug: tenant.slug,
            logo_path: tenant.logo_path,
            telefone: tenant.telefone,
            cidade: tenant.cidade,
            estado: tenant.uf || ''
          }}
        />
      )}
    </div>
  );
};
