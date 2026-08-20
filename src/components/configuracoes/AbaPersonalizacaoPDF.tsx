import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { useAuth } from '../../contexts/AuthContext';
import { usePlano } from '../../hooks/usePlano';
import { supabase } from '../../lib/supabase';
import { getFotoPublicUrl } from '../../utils/imagens';
import {
  Palette,
  Lock,
  Check,
  Save,
  AlertTriangle,
  Sparkles,
  Eye,
  CheckCircle2,
  Layout,
  Type,
} from 'lucide-react';

interface AbaPersonalizacaoPDFProps {
  onNavigateToPlano?: () => void;
}

const PRESET_CORES_PRIMARIAS = [
  { hex: '#f59e0b', nome: 'Amber Detailer' },
  { hex: '#ef4444', nome: 'Vermelho Racing' },
  { hex: '#3b82f6', nome: 'Azul Esporte' },
  { hex: '#10b981', nome: 'Verde Neon' },
  { hex: '#8b5cf6', nome: 'Roxo Premium' },
  { hex: '#ec4899', nome: 'Rosa Magenta' },
  { hex: '#eab308', nome: 'Amarelo Ouro' },
  { hex: '#3f3f46', nome: 'Grafite Escuro' },
];

const PRESET_CORES_FUNDO_HEADLINE = [
  { hex: '#18181b', nome: 'Grafite Padrão' },
  { hex: '#000000', nome: 'Preto Absoluto' },
  { hex: '#0f172a', nome: 'Azul Marinho Escuro' },
  { hex: '#1e3a8a', nome: 'Azul Royal' },
  { hex: '#450a0a', nome: 'Vermelho Racing Escuro' },
  { hex: '#064e3b', nome: 'Verde Garrafa' },
  { hex: '#312e81', nome: 'Índigo Profundo' },
  { hex: '#ffffff', nome: 'Branco / Minimalista' },
];

const PRESET_CORES_SECOES = [
  { hex: '#27272a', nome: 'Grafite 800 (Escuro)' },
  { hex: '#1e293b', nome: 'Azul Slate' },
  { hex: '#111827', nome: 'Cinza Carbono' },
  { hex: '#3f3f46', nome: 'Zinc 700' },
  { hex: '#3f0f15', nome: 'Vinho Suave' },
  { hex: '#14532d', nome: 'Verde Escuro' },
];

export const AbaPersonalizacaoPDF: React.FC<AbaPersonalizacaoPDFProps> = ({ onNavigateToPlano }) => {
  const { tenant, refetchTenantData } = useAuth();
  const { nomePlano } = usePlano();

  const isFree = tenant?.plano === 'free';

  // Estados dos campos de personalização
  const [corPrimaria, setCorPrimaria] = useState(tenant?.pdf_cor_primaria || '#f59e0b');
  const [corFundoCabecalho, setCorFundoCabecalho] = useState(tenant?.pdf_cor_fundo_cabecalho || '#18181b');
  const [corTextoCabecalho, setCorTextoCabecalho] = useState(tenant?.pdf_cor_texto_cabecalho || '#ffffff');
  const [corFundoSecoes, setCorFundoSecoes] = useState(tenant?.pdf_cor_fundo_secoes || '#27272a');

  const [subtituloCabecalho, setSubtituloCabecalho] = useState(tenant?.pdf_subtitulo_cabecalho || '');
  const [textoObservacoesOrcamento, setTextoObservacoesOrcamento] = useState(tenant?.pdf_texto_observacoes_orcamento || '');
  const [textoRodape, setTextoRodape] = useState(tenant?.pdf_texto_rodape || '');
  const [ocultarMarcaDagua, setOcultarMarcaDagua] = useState(tenant?.pdf_ocultar_marca_dagua || false);

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (tenant) {
      setCorPrimaria(tenant.pdf_cor_primaria || '#f59e0b');
      setCorFundoCabecalho(tenant.pdf_cor_fundo_cabecalho || '#18181b');
      setCorTextoCabecalho(tenant.pdf_cor_texto_cabecalho || '#ffffff');
      setCorFundoSecoes(tenant.pdf_cor_fundo_secoes || '#27272a');
      setSubtituloCabecalho(tenant.pdf_subtitulo_cabecalho || '');
      setTextoObservacoesOrcamento(tenant.pdf_texto_observacoes_orcamento || '');
      setTextoRodape(tenant.pdf_texto_rodape || '');
      setOcultarMarcaDagua(tenant.pdf_ocultar_marca_dagua || false);
    }
  }, [tenant]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant) return;
    if (isFree) {
      setErrorMsg('Personalização completa do PDF disponível exclusivamente nos planos Pro e Studio.');
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const { error } = await supabase
        .from('tenants')
        .update({
          pdf_cor_primaria: corPrimaria,
          pdf_cor_fundo_cabecalho: corFundoCabecalho,
          pdf_cor_texto_cabecalho: corTextoCabecalho,
          pdf_cor_fundo_secoes: corFundoSecoes,
          pdf_subtitulo_cabecalho: subtituloCabecalho.trim() || null,
          pdf_texto_observacoes_orcamento: textoObservacoesOrcamento.trim() || null,
          pdf_texto_rodape: textoRodape.trim() || null,
          pdf_ocultar_marca_dagua: ocultarMarcaDagua,
          updated_at: new Date().toISOString(),
        })
        .eq('id', tenant.id);

      if (error) throw error;

      setSuccessMsg('Branding e preferências dos documentos em PDF salvos com sucesso!');
      await refetchTenantData();
    } catch (err: any) {
      console.error('[Salvar PDF Config Error]:', err);
      setErrorMsg(err.message || 'Erro ao salvar configurações do PDF.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      {/* Topo informativo do Plano */}
      <Card className="p-6 bg-graphite-800 border-graphite-600 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`p-3 rounded-xl ${isFree ? 'bg-graphite-700 text-vapor-300' : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'}`}>
            <Palette size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-display text-[18px] text-vapor-100 uppercase tracking-wide">
                Estúdio de Branding & Edição Completa de PDF
              </h3>
              <Badge tone={isFree ? 'graphite' : 'amber'}>
                {isFree ? 'Plano Free' : `Plano ${nomePlano}`}
              </Badge>
            </div>
            <p className="font-sans text-[13px] text-vapor-400 mt-0.5">
              Defina as cores da headline, plano de fundo de seções, textos de garantia e formato visual dos seus orçamentos e relatórios.
            </p>
          </div>
        </div>

        {isFree && onNavigateToPlano && (
          <Button type="button" variant="primary" onClick={onNavigateToPlano} className="shrink-0 text-[13px]">
            <Sparkles size={16} />
            <span>Desbloquear no Plano Pro</span>
          </Button>
        )}
      </Card>

      {/* BLOCO SE FOR PLANO FREE: TRAVA DE RECURSO */}
      {isFree && (
        <Card className="p-6 bg-graphite-900 border-amber-500/30 flex flex-col gap-5 relative overflow-hidden">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-amber-500/10 text-amber-400 shrink-0 border border-amber-500/20">
              <Lock size={24} />
            </div>
            <div className="flex flex-col gap-2">
              <h4 className="font-display text-[16px] text-vapor-100 uppercase tracking-wide">
                Layout Essencial Monocromático (Plano Free)
              </h4>
              <p className="font-sans text-[13px] text-vapor-300 leading-relaxed">
                No plano <strong>Free</strong>, os orçamentos e vistorias utilizam o tema monocromático padrão (Preto & Branco / Grafite). Faça o upgrade para o plano <strong>Pro</strong> para personalizar as cores de fundo do cabeçalho, banners de seções e ocultar a indicação da plataforma.
              </p>
            </div>
          </div>

          <div className="p-4 bg-graphite-950 rounded-lg border border-graphite-800 flex flex-col gap-3">
            <span className="font-mono text-[11px] text-amber-400 uppercase font-bold tracking-wider">
              Recursos de Branding Inclusos nos Planos PRO e STUDIO:
            </span>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-sans text-vapor-200">
              <li className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-mint-400 shrink-0" />
                <span>Cor de Fundo da Headline / Cabeçalho</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-mint-400 shrink-0" />
                <span>Cor de Fundo das Caixas de Informação e Seções</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-mint-400 shrink-0" />
                <span>Seletor de Cor Primária dos Títulos e Destaques</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-mint-400 shrink-0" />
                <span>Observações Comerciais & Condições de Pagamento</span>
              </li>
              <li className="flex items-center gap-2 col-span-full">
                <CheckCircle2 size={16} className="text-mint-400 shrink-0" />
                <span>Remoção da marca d'água da plataforma (White-Label)</span>
              </li>
            </ul>
          </div>
        </Card>
      )}

      {/* PAINEL DE CONFIGURAÇÃO + LIVE PREVIEW */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Formulário de Configuração Visual */}
        <form onSubmit={handleSave} className="lg:col-span-7 flex flex-col gap-5">
          <Card className={`p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-6 ${isFree ? 'opacity-60 pointer-events-none' : ''}`}>
            {errorMsg && (
              <div className="p-3 bg-flare-400/10 border border-flare-400/30 rounded text-flare-400 text-[13px] flex items-center gap-2">
                <AlertTriangle size={16} className="shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {successMsg && (
              <div className="p-3 bg-mint-500/10 border border-mint-500/30 rounded text-mint-400 text-[13px] flex items-center gap-2">
                <Check size={16} className="shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            {/* SEÇÃO 1: CORES DO CABEÇALHO / HEADLINE */}
            <div className="flex flex-col gap-3">
              <h4 className="font-display text-[15px] text-vapor-100 uppercase tracking-wide border-b border-graphite-700 pb-2 flex items-center gap-2">
                <Layout size={18} className="text-amber-500" />
                <span>Headline / Banner Superior do Cabeçalho</span>
              </h4>

              {/* Cor de Fundo da Headline */}
              <div className="flex flex-col gap-2">
                <label className="font-sans text-[13px] text-vapor-200 font-bold">
                  Cor de Fundo da Headline
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  {PRESET_CORES_FUNDO_HEADLINE.map((preset) => (
                    <button
                      key={preset.hex}
                      type="button"
                      onClick={() => setCorFundoCabecalho(preset.hex)}
                      className={`w-7 h-7 rounded-full flex items-center justify-center border-2 transition-transform ${
                        corFundoCabecalho.toLowerCase() === preset.hex.toLowerCase()
                          ? 'border-amber-400 scale-110 shadow-lg'
                          : 'border-graphite-600 hover:scale-105'
                      }`}
                      style={{ backgroundColor: preset.hex }}
                      title={preset.nome}
                    >
                      {corFundoCabecalho.toLowerCase() === preset.hex.toLowerCase() && (
                        <Check size={13} className={preset.hex === '#ffffff' ? 'text-graphite-900' : 'text-white'} />
                      )}
                    </button>
                  ))}

                  <div className="flex items-center gap-2 p-1 bg-graphite-950 rounded border border-graphite-700 ml-1">
                    <input
                      type="color"
                      value={corFundoCabecalho}
                      onChange={(e) => setCorFundoCabecalho(e.target.value)}
                      className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                    />
                    <span className="font-mono text-[11px] text-vapor-300 uppercase pr-1">
                      {corFundoCabecalho}
                    </span>
                  </div>
                </div>
              </div>

              {/* Cor do Texto da Headline */}
              <div className="flex flex-col gap-2 pt-2">
                <label className="font-sans text-[13px] text-vapor-200 font-bold">
                  Cor do Texto da Headline
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setCorTextoCabecalho('#ffffff')}
                    className={`px-3 py-1.5 rounded text-[12px] font-sans font-semibold border flex items-center gap-2 ${
                      corTextoCabecalho === '#ffffff'
                        ? 'bg-graphite-950 text-white border-amber-500'
                        : 'bg-graphite-900 text-vapor-400 border-graphite-700'
                    }`}
                  >
                    <span className="w-3 h-3 rounded-full bg-white border border-graphite-500"></span>
                    <span>Texto Claro (Branco)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCorTextoCabecalho('#18181b')}
                    className={`px-3 py-1.5 rounded text-[12px] font-sans font-semibold border flex items-center gap-2 ${
                      corTextoCabecalho === '#18181b'
                        ? 'bg-graphite-950 text-white border-amber-500'
                        : 'bg-graphite-900 text-vapor-400 border-graphite-700'
                    }`}
                  >
                    <span className="w-3 h-3 rounded-full bg-graphite-900 border border-graphite-400"></span>
                    <span>Texto Escuro (Grafite)</span>
                  </button>
                </div>
              </div>
            </div>

            {/* SEÇÃO 2: CORES DE DESTAQUE E SEÇÕES INTERNAS */}
            <div className="flex flex-col gap-3 pt-2">
              <h4 className="font-display text-[15px] text-vapor-100 uppercase tracking-wide border-b border-graphite-700 pb-2 flex items-center gap-2">
                <Palette size={18} className="text-amber-500" />
                <span>Cores de Destaque e Seções Internas</span>
              </h4>

              {/* Cor Primária */}
              <div className="flex flex-col gap-2">
                <label className="font-sans text-[13px] text-vapor-200 font-bold">
                  Cor Primária de Destaque (Títulos & Valores)
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  {PRESET_CORES_PRIMARIAS.map((preset) => (
                    <button
                      key={preset.hex}
                      type="button"
                      onClick={() => setCorPrimaria(preset.hex)}
                      className={`w-7 h-7 rounded-full flex items-center justify-center border-2 transition-transform ${
                        corPrimaria.toLowerCase() === preset.hex.toLowerCase()
                          ? 'border-white scale-110 shadow-lg'
                          : 'border-transparent hover:scale-105'
                      }`}
                      style={{ backgroundColor: preset.hex }}
                      title={preset.nome}
                    >
                      {corPrimaria.toLowerCase() === preset.hex.toLowerCase() && (
                        <Check size={13} className="text-white drop-shadow" />
                      )}
                    </button>
                  ))}

                  <div className="flex items-center gap-2 p-1 bg-graphite-950 rounded border border-graphite-700 ml-1">
                    <input
                      type="color"
                      value={corPrimaria}
                      onChange={(e) => setCorPrimaria(e.target.value)}
                      className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                    />
                    <span className="font-mono text-[11px] text-vapor-300 uppercase pr-1">
                      {corPrimaria}
                    </span>
                  </div>
                </div>
              </div>

              {/* Cor de Fundo das Seções Internas */}
              <div className="flex flex-col gap-2 pt-2">
                <label className="font-sans text-[13px] text-vapor-200 font-bold">
                  Cor de Fundo das Caixas e Cartões de Seção
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  {PRESET_CORES_SECOES.map((preset) => (
                    <button
                      key={preset.hex}
                      type="button"
                      onClick={() => setCorFundoSecoes(preset.hex)}
                      className={`w-7 h-7 rounded-full flex items-center justify-center border-2 transition-transform ${
                        corFundoSecoes.toLowerCase() === preset.hex.toLowerCase()
                          ? 'border-white scale-110 shadow-lg'
                          : 'border-graphite-600 hover:scale-105'
                      }`}
                      style={{ backgroundColor: preset.hex }}
                      title={preset.nome}
                    >
                      {corFundoSecoes.toLowerCase() === preset.hex.toLowerCase() && (
                        <Check size={13} className="text-white" />
                      )}
                    </button>
                  ))}

                  <div className="flex items-center gap-2 p-1 bg-graphite-950 rounded border border-graphite-700 ml-1">
                    <input
                      type="color"
                      value={corFundoSecoes}
                      onChange={(e) => setCorFundoSecoes(e.target.value)}
                      className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                    />
                    <span className="font-mono text-[11px] text-vapor-300 uppercase pr-1">
                      {corFundoSecoes}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* SEÇÃO 3: TEXTOS E OBSERVAÇÕES DO DOCUMENTO */}
            <div className="flex flex-col gap-4 pt-2">
              <h4 className="font-display text-[15px] text-vapor-100 uppercase tracking-wide border-b border-graphite-700 pb-2 flex items-center gap-2">
                <Type size={18} className="text-amber-500" />
                <span>Textos e Identidade do PDF</span>
              </h4>

              {/* CARD DE ESCLARECIMENTO SOBRE OBSERVAÇÕES POR ORÇAMENTO */}
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3.5 flex items-start gap-3 text-amber-300">
                <Sparkles size={20} className="text-amber-400 shrink-0 mt-0.5" />
                <div className="flex flex-col gap-1 text-[13px] font-sans leading-relaxed">
                  <strong className="text-vapor-100">Identidade Visual do PDF vs. Observações do Orçamento:</strong>
                  <span>
                    As cores, logotipo e subtítulo nesta tela configuram a <strong>Identidade Visual / Branding</strong> dos seus PDFs. As <strong>Observações e Condições de Garantia de cada proposta</strong> são editadas individualmente na tela de cada orçamento, permitindo adaptar o texto para a necessidade específica do veículo e do cliente.
                  </span>
                </div>
              </div>

              {/* Subtítulo do Cabeçalho */}
              <div className="flex flex-col gap-1.5">
                <label className="font-sans text-[13px] text-vapor-200 font-bold">
                  Subtítulo Institucional do Cabeçalho
                </label>
                <input
                  type="text"
                  value={subtituloCabecalho}
                  onChange={(e) => setSubtituloCabecalho(e.target.value)}
                  placeholder="Ex: Ateliê Especializado em Vitrificação & PPF"
                  maxLength={90}
                  className="bg-graphite-950 border border-graphite-600 rounded-lg p-2.5 text-vapor-100 font-sans text-[13px] outline-none focus:border-amber-500 min-h-[44px]"
                />
              </div>

              {/* Observações de Orçamentos */}
              <div className="flex flex-col gap-1.5">
                <label className="font-sans text-[13px] text-vapor-200 font-bold">
                  Observações Padrão de Fallback (Opcional)
                </label>
                <textarea
                  value={textoObservacoesOrcamento}
                  onChange={(e) => setTextoObservacoesOrcamento(e.target.value)}
                  placeholder="Ex: Validade deste orçamento: 7 dias corridos. Forma de pagamento: 50% na aprovação e 50% na entrega."
                  rows={2}
                  maxLength={300}
                  className="bg-graphite-950 border border-graphite-600 rounded-lg p-2.5 text-vapor-100 font-sans text-[13px] outline-none focus:border-amber-500 resize-none"
                />
                <span className="font-sans text-[11.5px] text-vapor-400">
                  Usado apenas caso o orçamento individual não possua observações preenchidas.
                </span>
              </div>

              {/* Termos de Rodapé */}
              <div className="flex flex-col gap-1.5">
                <label className="font-sans text-[13px] text-vapor-200 font-bold">
                  Termos de Garantia / Rodapé Padrão (Opcional)
                </label>
                <textarea
                  value={textoRodape}
                  onChange={(e) => setTextoRodape(e.target.value)}
                  placeholder="Ex: Garantia de 3 anos no tratamento cerâmico 9H. Manutenção recomendada a cada 6 meses."
                  rows={2}
                  maxLength={300}
                  className="bg-graphite-950 border border-graphite-600 rounded-lg p-2.5 text-vapor-100 font-sans text-[13px] outline-none focus:border-amber-500 resize-none"
                />
              </div>

              {/* Toggle Ocultar Marca d'água */}
              <div className="flex items-center justify-between p-3.5 bg-graphite-900 rounded-lg border border-graphite-700 mt-1">
                <div className="flex flex-col gap-0.5">
                  <span className="font-sans text-[13px] text-vapor-100 font-bold">
                    Ocultar marca da plataforma no rodapé (White-Label)
                  </span>
                  <span className="font-sans text-[12px] text-vapor-400">
                    Remove o texto "Gerado via Plataforma Detailers" dos arquivos emitidos.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={ocultarMarcaDagua}
                  onChange={(e) => setOcultarMarcaDagua(e.target.checked)}
                  className="w-5 h-5 accent-amber-500 rounded cursor-pointer shrink-0 min-h-[28px] min-w-[28px]"
                />
              </div>
            </div>

            {!isFree && (
              <div className="flex justify-end pt-2">
                <Button type="submit" variant="primary" disabled={saving} className="font-semibold flex items-center gap-2">
                  <Save size={16} />
                  <span>{saving ? 'Salvando Alterações...' : 'Salvar Personalização de PDF'}</span>
                </Button>
              </div>
            )}
          </Card>
        </form>

        {/* Simulador Interativo de PDF (Live Preview) */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          <Card className="p-5 bg-graphite-800 border-graphite-600 flex flex-col gap-4 sticky top-6">
            <h4 className="font-display text-[15px] text-vapor-100 uppercase tracking-wide border-b border-graphite-700 pb-2 flex items-center justify-between">
              <span>Simulador do Documento (Live)</span>
              <Eye size={18} className="text-amber-500" />
            </h4>

            <p className="font-sans text-[12px] text-vapor-400">
              Visualização aproximada da apresentação visual nos PDFs de Orçamento e Vistoria.
            </p>

            {/* Documento em Papel Simulado */}
            <div className="bg-graphite-950 rounded-lg border border-graphite-700 overflow-hidden shadow-2xl font-sans text-xs">
              {/* Headline Personalizada */}
              <div
                className="p-4 border-b border-graphite-800 transition-colors"
                style={{
                  backgroundColor: isFree ? '#18181b' : corFundoCabecalho,
                  color: isFree ? '#ffffff' : corTextoCabecalho,
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    {tenant?.logo_path ? (
                      <img
                        src={getFotoPublicUrl(tenant.logo_path) || ''}
                        alt="Logo"
                        className="w-10 h-10 object-contain shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded bg-white/10 border border-white/20 flex items-center justify-center font-mono text-[9px] font-bold">
                        LOGO
                      </div>
                    )}
                    <div>
                      <h5
                        className="font-bold text-[13px] uppercase tracking-tight"
                        style={{ color: isFree ? '#e4e4e7' : corPrimaria }}
                      >
                        {tenant?.razao_social || tenant?.nome || 'NOME DO SEU ATELIÊ'}
                      </h5>
                      <p className="text-[10px] opacity-90">
                        {[
                          tenant?.cidade ? `${tenant.cidade}/${tenant.uf || ''}` : 'São Paulo/SP',
                          tenant?.telefone || '(11) 99999-9999',
                          !isFree && subtituloCabecalho ? subtituloCabecalho : 'Orçamento Oficial',
                        ]
                          .filter(Boolean)
                          .join(' • ')}
                      </p>
                      <span className="text-[9px] uppercase opacity-75 font-mono mt-0.5 block">
                        ORÇAMENTO #00124
                      </span>
                    </div>
                  </div>

                  <div className="text-right">
                    <span
                      className="font-mono text-[12px] font-bold block"
                      style={{ color: isFree ? '#e4e4e7' : corPrimaria }}
                    >
                      R$ 2.450,00
                    </span>
                    <span className="text-[9px] opacity-75 font-mono">
                      {isFree ? 'LAYOUT ESSENCIAL (P&B)' : 'PRO BRANDING'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Corpo Simulado do PDF com Seção Interna Customizada */}
              <div className="p-4 flex flex-col gap-3 bg-graphite-950">
                {/* Banner de Seção com a cor de fundo escolhida */}
                <div
                  className="p-3 rounded border border-white/10 flex flex-col gap-1 transition-colors"
                  style={{
                    backgroundColor: isFree ? '#27272a' : corFundoSecoes,
                  }}
                >
                  <span
                    className="font-bold text-[11px] uppercase tracking-wider"
                    style={{ color: isFree ? '#fbbf24' : corPrimaria }}
                  >
                    CLIENTE & VEÍCULO
                  </span>
                  <div className="text-[11px] text-vapor-200 flex justify-between">
                    <span>Cliente: João Silva</span>
                    <span className="font-mono">BMW M3 (Placa: ABC-1234)</span>
                  </div>
                </div>

                {/* Lista de Serviços */}
                <div className="p-3 bg-graphite-900 rounded border border-graphite-800 flex justify-between items-center text-[11px]">
                  <span className="text-vapor-200">Vitrificação de Pintura Cerâmica 9H</span>
                  <span className="font-mono font-bold text-vapor-100">R$ 2.450,00</span>
                </div>

                {/* Bloco de Observações Comerciais se preenchido */}
                {(!isFree && textoObservacoesOrcamento.trim()) && (
                  <div className="p-2.5 bg-graphite-900/60 rounded border border-graphite-800 text-[10px] text-vapor-300 italic">
                    <strong className="not-italic text-vapor-200 block mb-0.5">Observações:</strong>
                    "{textoObservacoesOrcamento.trim()}"
                  </div>
                )}

                {/* Rodapé Simulado */}
                <div className="pt-2 border-t border-graphite-800 text-[10px] text-vapor-400 flex flex-col gap-1 italic">
                  {(!isFree && textoRodape.trim()) && (
                    <p className="text-vapor-300">"{textoRodape.trim()}"</p>
                  )}

                  <div className="flex items-center justify-between text-[9px] text-vapor-500 pt-1">
                    <span>
                      {isFree
                        ? 'Gerado via Plataforma Detailers — Plano Essencial'
                        : ocultarMarcaDagua
                        ? 'Documento emitido diretamente pela oficina'
                        : 'Gerado via Plataforma Detailers'}
                    </span>
                    <span>Página 1 de 1</span>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};
