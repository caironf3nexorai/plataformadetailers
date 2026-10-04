import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { formatarMoeda } from '../../utils/formatters';
import { formatarDataHora } from '../../utils/datas';
import { 
  Landmark, 
  Receipt, 
  AlertTriangle, 
  Save, 
  RefreshCw, 
  FileText, 
  Download, 
  CheckCircle2,
  ShieldCheck,
  UploadCloud,
  KeyRound,
  Lock,
  Eye,
  EyeOff,
  FileCheck2
} from 'lucide-react';
import { sincronizarDadosFiscais } from '../../services/fiscalSyncService';
import { gerarDanfsePDF } from '../../utils/pdfNFSe';

interface ResumoNFSe {
  configurada: boolean;
  plano_id: string;
  limite_mensal: number;
  emitidas_mes: number;
  disponiveis_mes: number;
  pode_emitir: boolean;
  config: any;
}

interface NotaFiscalItem {
  id: string;
  numero: string | null;
  serie: string | null;
  valor_total: number;
  tomador_nome: string;
  tomador_cpf_cnpj: string | null;
  tomador_email: string | null;
  status: 'emitida' | 'cancelada' | 'processando' | 'erro';
  url_xml: string | null;
  url_danfe: string | null;
  motivo_cancelamento: string | null;
  emitido_em: string;
  discriminacao?: string | null;
}

export const AbaFiscal: React.FC = () => {
  const { tenant } = useAuth();
  const { showSuccess, showError } = useToast();

  const [resumo, setResumo] = useState<ResumoNFSe | null>(null);
  const [notas, setNotas] = useState<NotaFiscalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form states
  const [cnpj, setCnpj] = useState('');
  const [razaoSocial, setRazaoSocial] = useState('');
  const [nomeFantasia, setNomeFantasia] = useState('');
  const [inscricaoMunicipal, setInscricaoMunicipal] = useState('');
  const [regimeTributario, setRegimeTributario] = useState('1');
  const [cnaePadrao, setCnaePadrao] = useState('4520-0/05');
  const [itemListaServico, setItemListaServico] = useState('14.01');
  const [aliquotaIss, setAliquotaIss] = useState('2.00');
  const [ambiente, setAmbiente] = useState<'homologacao' | 'producao'>('homologacao');

  // Certificado Digital A1 states
  const [certificadoStatus, setCertificadoStatus] = useState<'pendente' | 'ativo' | 'expirado'>('pendente');
  const [certificadoValidoAte, setCertificadoValidoAte] = useState<string | null>(null);
  const [certificadoNomeArquivo, setCertificadoNomeArquivo] = useState<string | null>(null);
  const [certificadoArquivo, setCertificadoArquivo] = useState<File | null>(null);
  const [certificadoBase64, setCertificadoBase64] = useState<string | null>(null);
  const [certificadoSenha, setCertificadoSenha] = useState('');
  const [mostrarSenhaCertificado, setMostrarSenhaCertificado] = useState(false);
  const [substituindoCertificado, setSubstituindoCertificado] = useState(false);

  const formatarCNPJ = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, 14);
    return digits
      .replace(/^(\d{2})(\d)/, '$1.$2')
      .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1/$2')
      .replace(/(\d{4})(\d)/, '$1-$2');
  };

  const carregarDados = async () => {
    setLoading(true);
    try {
      // 1. Resumo e Configuração
      const { data: resData, error: resErr } = await supabase.rpc('obter_resumo_nfse_tenant');
      if (resErr) throw resErr;

      const info = resData as ResumoNFSe;
      setResumo(info);

      if (info?.config) {
        setCnpj(info.config.cnpj ? formatarCNPJ(info.config.cnpj) : '');
        setRazaoSocial(info.config.razao_social || '');
        setNomeFantasia(info.config.nome_fantasia || '');
        setInscricaoMunicipal(info.config.inscricao_municipal || '');
        setRegimeTributario(info.config.regime_tributario || '1');
        setCnaePadrao(info.config.cnae_padrao || '4520-0/05');
        setItemListaServico(info.config.item_lista_servico || '14.01');
        setAliquotaIss(info.config.aliquota_iss ? String(info.config.aliquota_iss) : '2.00');
        setAmbiente(info.config.ambiente || 'homologacao');
        setCertificadoStatus(info.config.certificado_status || 'pendente');
        setCertificadoValidoAte(info.config.certificado_valido_ate || null);
        setCertificadoNomeArquivo(info.config.certificado_nome_arquivo || null);
      } else if (tenant) {
        // Pré-preenche com dados básicos da oficina se não houver config
        if (tenant.documento && tenant.documento_tipo === 'cnpj') {
          setCnpj(formatarCNPJ(tenant.documento));
        }
        if (tenant.razao_social) setRazaoSocial(tenant.razao_social);
        if (tenant.nome) setNomeFantasia(tenant.nome);
      }

      // 2. Histórico de Notas Fiscais
      const { data: notasData, error: notasErr } = await supabase
        .from('notas_fiscais')
        .select('*')
        .order('emitido_em', { ascending: false })
        .limit(50);

      if (!notasErr && notasData) {
        setNotas(notasData);
      }
    } catch (err: any) {
      console.error('[AbaFiscal] Erro ao carregar dados:', err);
      showError(err.message || 'Erro ao carregar dados fiscais.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarDados();
  }, []);

  const handleAbrirDanfe = async (nota: NotaFiscalItem) => {
    // Se for URL externa válida da Focus (ex: arquivos/....pdf) e não o mock placeholder
    if (nota.url_danfe && !nota.url_danfe.includes('/v2/nfse/')) {
      window.open(nota.url_danfe, '_blank');
      return;
    }

    try {
      await gerarDanfsePDF({
        numero: nota.numero || '000001',
        serie: '1',
        dataEmissao: nota.emitido_em || new Date(),
        status: nota.status,
        ambiente: ambiente,
        prestador: {
          razaoSocial: razaoSocial || tenant?.nome || 'Oficina Detailer',
          nomeFantasia: nomeFantasia || tenant?.nome || undefined,
          cnpj: cnpj || '',
          inscricaoMunicipal: inscricaoMunicipal || undefined,
          telefone: tenant?.telefone || undefined,
          cidade: tenant?.cidade || undefined,
          uf: tenant?.uf || undefined,
        },
        tomador: {
          nome: nota.tomador_nome || 'Cliente',
          cpfCnpj: nota.tomador_cpf_cnpj || undefined,
          email: nota.tomador_email || undefined,
        },
        servico: {
          discriminacao: nota.discriminacao || 'Serviços de estética automotiva.',
          itemListaServico: itemListaServico || '14.01',
          cnae: cnaePadrao || '4520-0/05',
          valorTotal: Number(nota.valor_total || 0),
          aliquotaIss: Number(aliquotaIss || 2.0),
        },
        formaPagamento: (nota as any).forma_pagamento || undefined,
      }, 'download');
    } catch (err) {
      console.error('[AbaFiscal] Erro ao gerar DANFSe PDF:', err);
    }
  };

  const handleArquivoCertificadoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.pfx') && !lower.endsWith('.p12')) {
      showError('Por favor selecione um arquivo de certificado digital válido (.pfx ou .p12).');
      return;
    }
    setCertificadoArquivo(file);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      setCertificadoBase64(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleSalvarConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCnpj = cnpj.replace(/\D/g, '');
    if (cleanCnpj.length !== 14) {
      showError('Informe um CNPJ válido com 14 dígitos.');
      return;
    }
    if (!razaoSocial.trim()) {
      showError('Informe a Razão Social da empresa.');
      return;
    }

    if (certificadoArquivo && !certificadoSenha.trim()) {
      showError('Informe a senha do certificado digital para validação e instalação.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        cnpj: cleanCnpj,
        razao_social: razaoSocial.trim(),
        nome_fantasia: nomeFantasia.trim() || razaoSocial.trim(),
        inscricao_municipal: inscricaoMunicipal.trim(),
        regime_tributario: regimeTributario,
        cnae_padrao: cnaePadrao.trim(),
        item_lista_servico: itemListaServico.trim(),
        aliquota_iss: parseFloat(aliquotaIss.replace(',', '.')) || 2.0,
        ambiente: ambiente,
        certificado_base64: certificadoBase64 || null,
        senha_certificado: certificadoSenha.trim() || null,
        certificado_nome_arquivo: certificadoArquivo?.name || certificadoNomeArquivo || null,
      };

      await sincronizarDadosFiscais(payload);

      // Atualiza também os dados cadastrais da oficina no perfil principal do tenant
      if (tenant?.id) {
        await supabase
          .from('tenants')
          .update({
            documento: cleanCnpj,
            documento_tipo: 'cnpj',
            razao_social: razaoSocial.trim(),
            nome: nomeFantasia.trim() || razaoSocial.trim(),
          })
          .eq('id', tenant.id);
      }

      showSuccess('Configurações fiscais e certificado digital salvos com sucesso!');
      setCertificadoArquivo(null);
      setCertificadoBase64(null);
      setCertificadoSenha('');
      setSubstituindoCertificado(false);
      await carregarDados();
    } catch (err: any) {
      console.error('[AbaFiscal] Erro ao salvar config fiscal:', err);
      showError(err.message || 'Erro ao salvar configurações fiscais.');
    } finally {
      setSaving(false);
    }
  };

  const getPercentualUso = () => {
    if (!resumo || resumo.limite_mensal <= 0) return 0;
    return Math.min(100, Math.round((resumo.emitidas_mes / resumo.limite_mensal) * 100));
  };

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      {/* 1. CARD DE COTA MENSAL DO PLANO */}
      <Card className="p-5 bg-graphite-800 border-graphite-600 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Receipt className="text-amber-400 w-5 h-5" />
              <h3 className="font-display text-[16px] text-vapor-100 font-bold uppercase tracking-wider">
                Emissão de Notas Fiscais de Serviço (NFS-e)
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase bg-amber-500/10 text-amber-400 border border-amber-500/30">
                Plano {resumo?.plano_id?.toUpperCase() || tenant?.plano?.toUpperCase() || 'FREE'}
              </span>
            </div>
            <p className="text-xs text-vapor-400 font-sans">
              Emita notas fiscais de serviço eletrônicas diretamente de cada atendimento concluído na sua oficina.
            </p>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-4 w-full sm:w-auto">
            <div className="text-left sm:text-right">
              <div className="font-mono text-2xl font-black text-vapor-100">
                {resumo?.emitidas_mes ?? 0} <span className="text-sm font-normal text-vapor-400">/ {resumo?.limite_mensal === 0 ? '0' : resumo?.limite_mensal || '—'}</span>
              </div>
              <div className="text-[11px] font-mono text-vapor-400">
                {resumo?.limite_mensal === 0 
                  ? 'Bloqueado no Plano Free' 
                  : `${resumo?.disponiveis_mes ?? 0} notas restantes este mês`}
              </div>
            </div>

            <Button
              variant="secondary"
              onClick={carregarDados}
              disabled={loading}
              className="p-2.5 h-10 w-10 text-vapor-300 shrink-0"
              title="Atualizar cota"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* Barra de Progresso */}
        <div className="mt-4 pt-4 border-t border-graphite-700/60">
          <div className="flex justify-between text-xs font-mono text-vapor-400 mb-1.5">
            <span>Consumo da Cota Mensal</span>
            <span className="font-bold text-vapor-200">{getPercentualUso()}%</span>
          </div>
          <div className="w-full bg-graphite-900 rounded-full h-2.5 overflow-hidden border border-graphite-700">
            <div
              className={`h-full transition-all duration-500 rounded-full ${
                getPercentualUso() >= 90
                  ? 'bg-red-500'
                  : getPercentualUso() >= 70
                  ? 'bg-amber-500'
                  : 'bg-emerald-500'
              }`}
              style={{ width: `${getPercentualUso()}%` }}
            />
          </div>

          {resumo?.limite_mensal === 0 && (
            <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-amber-300">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  O Plano Free não inclui emissões automáticas de NFS-e. Faça upgrade para o <strong>Plano Pro (30 notas/mês)</strong> ou <strong>Studio (150 notas/mês)</strong>.
                </span>
              </div>
              <a
                href="/configuracoes?aba=plano"
                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg shrink-0 transition w-full sm:w-auto text-center"
              >
                Fazer Upgrade
              </a>
            </div>
          )}
        </div>
      </Card>

      {/* 2. FORMULÁRIO DE CONFIGURAÇÃO FISCAL */}
      <Card className="p-4 sm:p-6 bg-graphite-800 border-graphite-600 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-graphite-700 pb-4 mb-5">
          <div className="flex items-center gap-2">
            <Landmark className="w-5 h-5 text-amber-400 shrink-0" />
            <h3 className="font-display text-[15px] sm:text-[16px] text-vapor-100 font-bold uppercase tracking-wider">
              Dados Cadastrais e Tributários da Oficina
            </h3>
          </div>
          <span className="text-[11px] font-mono text-vapor-400">
            {resumo?.configurada ? (
              <span className="inline-flex items-center gap-1 text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" /> Configuração Pronta
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5" /> Pendente de Configuração
              </span>
            )}
          </span>
        </div>

        <form onSubmit={handleSalvarConfig} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {/* CNPJ */}
            <div>
              <label className="block text-xs font-mono text-vapor-300 uppercase mb-1">
                CNPJ da Oficina *
              </label>
              <input
                type="text"
                value={cnpj}
                onChange={(e) => setCnpj(formatarCNPJ(e.target.value))}
                placeholder="00.000.000/0000-00"
                maxLength={18}
                required
                className="w-full bg-graphite-900 border border-graphite-700 rounded-xl px-3.5 py-2.5 text-vapor-100 font-mono text-sm focus:border-amber-500 outline-none"
              />
            </div>

            {/* Inscrição Municipal */}
            <div>
              <label className="block text-xs font-mono text-vapor-300 uppercase mb-1">
                Inscrição Municipal (IM)
              </label>
              <input
                type="text"
                value={inscricaoMunicipal}
                onChange={(e) => setInscricaoMunicipal(e.target.value)}
                placeholder="Ex: 1234567-8"
                className="w-full bg-graphite-900 border border-graphite-700 rounded-xl px-3.5 py-2.5 text-vapor-100 font-mono text-sm focus:border-amber-500 outline-none"
              />
            </div>

            {/* Regime Tributário */}
            <div>
              <label className="block text-xs font-mono text-vapor-300 uppercase mb-1">
                Regime Tributário
              </label>
              <select
                value={regimeTributario}
                onChange={(e) => setRegimeTributario(e.target.value)}
                className="w-full bg-graphite-900 border border-graphite-700 rounded-xl px-3.5 py-2.5 text-vapor-100 font-sans text-sm focus:border-amber-500 outline-none"
              >
                <option value="1">1 — Simples Nacional</option>
                <option value="4">4 — MEI (Microempreendedor)</option>
                <option value="3">3 — Regime Normal / Lucro Presumido</option>
                <option value="2">2 — Simples (Sublimite Excedido)</option>
              </select>
            </div>

            {/* Razão Social */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-mono text-vapor-300 uppercase mb-1">
                Razão Social (Nome Oficial no CNPJ) *
              </label>
              <input
                type="text"
                value={razaoSocial}
                onChange={(e) => setRazaoSocial(e.target.value)}
                placeholder="Ex: AUTO DETAIL ESTETICA VEICULAR LTDA"
                required
                className="w-full bg-graphite-900 border border-graphite-700 rounded-xl px-3.5 py-2.5 text-vapor-100 font-sans text-sm focus:border-amber-500 outline-none"
              />
            </div>

            {/* Nome Fantasia */}
            <div>
              <label className="block text-xs font-mono text-vapor-300 uppercase mb-1">
                Nome Fantasia
              </label>
              <input
                type="text"
                value={nomeFantasia}
                onChange={(e) => setNomeFantasia(e.target.value)}
                placeholder="Ex: Auto Detail Studio"
                className="w-full bg-graphite-900 border border-graphite-700 rounded-xl px-3.5 py-2.5 text-vapor-100 font-sans text-sm focus:border-amber-500 outline-none"
              />
            </div>

            {/* CNAE Padrão */}
            <div>
              <label className="block text-xs font-mono text-vapor-300 uppercase mb-1">
                CNAE Principal de Serviços
              </label>
              <input
                type="text"
                value={cnaePadrao}
                onChange={(e) => setCnaePadrao(e.target.value)}
                placeholder="4520-0/05"
                className="w-full bg-graphite-900 border border-graphite-700 rounded-xl px-3.5 py-2.5 text-vapor-100 font-mono text-sm focus:border-amber-500 outline-none"
              />
              <span className="text-[10px] text-vapor-500 mt-0.5 block">
                4520-0/05: Lavagem, lubrificação e polimento de veículos
              </span>
            </div>

            {/* Código Lista de Serviço LC 116 */}
            <div>
              <label className="block text-xs font-mono text-vapor-300 uppercase mb-1">
                Item da Lista de Serviços (LC 116)
              </label>
              <input
                type="text"
                value={itemListaServico}
                onChange={(e) => setItemListaServico(e.target.value)}
                placeholder="14.01"
                className="w-full bg-graphite-900 border border-graphite-700 rounded-xl px-3.5 py-2.5 text-vapor-100 font-mono text-sm focus:border-amber-500 outline-none"
              />
              <span className="text-[10px] text-vapor-500 mt-0.5 block">
                14.01: Limpeza, conservação e reparação de veículos
              </span>
            </div>

            {/* Alíquota ISS */}
            <div>
              <label className="block text-xs font-mono text-vapor-300 uppercase mb-1">
                Alíquota ISS Estimada (%)
              </label>
              <input
                type="text"
                value={aliquotaIss}
                onChange={(e) => setAliquotaIss(e.target.value)}
                placeholder="2.00"
                className="w-full bg-graphite-900 border border-graphite-700 rounded-xl px-3.5 py-2.5 text-vapor-100 font-mono text-sm focus:border-amber-500 outline-none"
              />
              <span className="text-[10px] text-vapor-500 mt-0.5 block">
                Entre 2% e 5% conforme prefeitura
              </span>
            </div>

            {/* SEÇÃO DO CERTIFICADO DIGITAL A1 */}
            <div className="sm:col-span-2 md:col-span-3 p-4 bg-graphite-900 border border-graphite-700 rounded-xl space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-amber-400" />
                  <span className="font-display text-xs text-vapor-100 font-bold uppercase tracking-wider">
                    Certificado Digital A1 (.pfx ou .p12)
                  </span>
                </div>

                {certificadoStatus === 'ativo' && !substituindoCertificado ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                    <CheckCircle2 size={12} />
                    <span>Certificado Ativo e Instalado</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                    <AlertTriangle size={12} />
                    <span>Obrigatório para Produção</span>
                  </span>
                )}
              </div>

              {certificadoStatus === 'ativo' && !substituindoCertificado ? (
                <div className="p-3 bg-graphite-950 border border-emerald-500/20 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <FileCheck2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                    <div className="text-xs">
                      <div className="font-semibold text-vapor-100">
                        {certificadoNomeArquivo || 'Certificado Digital A1 Instalado'}
                      </div>
                      <div className="text-[11px] text-vapor-400 font-mono mt-0.5">
                        {certificadoValidoAte ? `Válido até: ${formatarDataHora(certificadoValidoAte).split(' ')[0]}` : 'Pronto para emissão oficial'}
                      </div>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setSubstituindoCertificado(true)}
                    className="text-xs py-1.5 px-3 self-start sm:self-center"
                  >
                    Substituir / Renovar
                  </Button>
                </div>
              ) : (
                <div className="space-y-3 pt-1">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Upload do Arquivo */}
                    <div>
                      <label className="block text-[11px] font-mono text-vapor-300 uppercase mb-1">
                        Arquivo do Certificado (.pfx ou .p12) {ambiente === 'producao' ? '*' : '(Opcional em testes)'}
                      </label>
                      <div className="relative">
                        <input
                          type="file"
                          id="input-certificado-pfx"
                          accept=".pfx,.p12"
                          onChange={handleArquivoCertificadoChange}
                          className="sr-only"
                        />
                        <label
                          htmlFor="input-certificado-pfx"
                          className="flex items-center justify-between w-full bg-graphite-950 border border-dashed border-graphite-600 hover:border-amber-500/80 rounded-xl px-3.5 py-2.5 cursor-pointer text-xs text-vapor-300 transition-colors"
                        >
                          <span className="truncate flex-1 min-w-0 text-vapor-200">
                            {certificadoArquivo ? certificadoArquivo.name : 'Selecionar arquivo .pfx'}
                          </span>
                          <UploadCloud className="w-4 h-4 text-amber-400 shrink-0 ml-2" />
                        </label>
                      </div>
                      <span className="text-[10px] text-vapor-500 mt-1 block">
                        Arquivo digital A1 fornecido pela certificadora (Serasa, Certisign, Soluti, etc.)
                      </span>
                    </div>

                    {/* Senha do Certificado */}
                    <div>
                      <label className="block text-[11px] font-mono text-vapor-300 uppercase mb-1">
                        Senha do Certificado Digital {certificadoArquivo ? '*' : ''}
                      </label>
                      <div className="relative">
                        <input
                          type={mostrarSenhaCertificado ? 'text' : 'password'}
                          value={certificadoSenha}
                          onChange={(e) => setCertificadoSenha(e.target.value)}
                          placeholder="Digite a senha do arquivo"
                          className="w-full bg-graphite-950 border border-graphite-700 rounded-xl pl-3.5 pr-10 py-2.5 text-vapor-100 font-mono text-xs focus:border-amber-500 outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setMostrarSenhaCertificado(!mostrarSenhaCertificado)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-vapor-400 hover:text-vapor-200"
                        >
                          {mostrarSenhaCertificado ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                      <span className="text-[10px] text-vapor-500 mt-1 block">
                        Senha de proteção do arquivo .pfx
                      </span>
                    </div>
                  </div>

                  {substituindoCertificado && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          setSubstituindoCertificado(false);
                          setCertificadoArquivo(null);
                          setCertificadoBase64(null);
                          setCertificadoSenha('');
                        }}
                        className="text-[11px] text-vapor-400 hover:text-vapor-200 underline font-mono"
                      >
                        Cancelar substituição
                      </button>
                    </div>
                  )}

                  <div className="p-2.5 bg-graphite-950/60 rounded-lg border border-graphite-800 text-[11px] text-vapor-400 flex items-start gap-2">
                    <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <span>
                      <strong>Segurança de Ponta a Ponta:</strong> O certificado é transmitido diretamente para o cofre seguro da emissora fiscal para assinar suas notas fiscais oficiais. Nenhuma pessoa tem acesso à chave privada.
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* INFORMAÇÃO DE EMISSÃO INTEGRADA NUVEMWASH */}
            <div className="sm:col-span-2 md:col-span-3 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5 text-xs">
                <div className="font-bold text-emerald-300">
                  Emissão de NFS-e Nativa e Integrada ao Sistema
                </div>
                <p className="text-vapor-300 font-sans leading-relaxed">
                  A comunicação com as prefeituras e a emissão das suas notas fiscais de serviço ocorrem de forma 100% automatizada e nativa pela plataforma. <strong>Você não precisa contratar softwares externos nem configurar chaves técnicas</strong>. Basta manter seus dados cadastrais (CNPJ, Razão Social e Inscrição Municipal) atualizados acima.
                </p>
              </div>
            </div>

            {/* SELEÇÃO DO AMBIENTE FISCAL */}
            <div className="sm:col-span-2 md:col-span-3 pt-2">
              <div className="p-4 bg-graphite-900 border border-graphite-700 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <label className="block text-xs font-mono text-vapor-200 uppercase mb-0.5">
                    Ambiente de Emissão
                  </label>
                  <p className="text-[11px] text-vapor-400 font-sans">
                    Utilize Homologação para testes simulados sem validade fiscal. Alterne para Produção quando desejar emitir notas fiscais com validade jurídica oficial.
                  </p>
                </div>
                <div className="sm:w-64 shrink-0">
                  <select
                    value={ambiente}
                    onChange={(e) => setAmbiente(e.target.value as any)}
                    className="w-full bg-graphite-950 border border-graphite-700 rounded-xl px-3.5 py-2.5 text-vapor-100 font-sans text-xs focus:border-amber-500 outline-none"
                  >
                    <option value="homologacao">Homologação (Testes / Simulado)</option>
                    <option value="producao">Produção (Validade Jurídica Oficial)</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-3 border-t border-graphite-700/60">
            <Button
              type="submit"
              variant="primary"
              disabled={saving}
              className="flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-6 py-2.5 rounded-xl shadow-lg shadow-amber-500/20 w-full sm:w-auto"
            >
              <Save size={16} />
              <span>{saving ? 'Salvando...' : 'Salvar Dados Fiscais'}</span>
            </Button>
          </div>
        </form>
      </Card>

      {/* 3. HISTÓRICO DE NOTAS FISCAIS EMITIDAS */}
      <Card className="p-4 sm:p-6 bg-graphite-800 border-graphite-600 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-graphite-700 pb-4 mb-4">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-amber-400 shrink-0" />
            <h3 className="font-display text-[15px] sm:text-[16px] text-vapor-100 font-bold uppercase tracking-wider">
              Notas Fiscais Emitidas ({notas.length})
            </h3>
          </div>
          <span className="text-xs text-vapor-400 font-sans">
            Últimas emissões registradas
          </span>
        </div>

        {notas.length === 0 ? (
          <div className="text-center py-10 text-vapor-400 text-sm font-sans space-y-2">
            <Receipt className="w-10 h-10 mx-auto text-graphite-600 mb-2" />
            <p>Nenhuma nota fiscal de serviço emitida até o momento.</p>
            <p className="text-xs text-vapor-500">
              Você pode emitir NFS-e diretamente ao finalizar um atendimento ou na tela de visualização do serviço.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
            <table className="w-full min-w-[620px] text-left text-xs font-sans text-vapor-300">
              <thead className="bg-graphite-900/60 uppercase font-mono text-[10px] text-vapor-400 border-b border-graphite-700">
                <tr>
                  <th className="py-2.5 px-3">Número / Série</th>
                  <th className="py-2.5 px-3">Data</th>
                  <th className="py-2.5 px-3">Tomador / Cliente</th>
                  <th className="py-2.5 px-3">Valor Total</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Documentos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-graphite-700/50">
                {notas.map((n) => (
                  <tr key={n.id} className="hover:bg-graphite-700/30 transition">
                    <td className="py-3 px-3 font-mono font-bold text-vapor-100">
                      NFS-e #{n.numero || 'S/N'} {n.serie ? `(${n.serie})` : ''}
                    </td>
                    <td className="py-3 px-3 font-mono text-vapor-400">
                      {formatarDataHora(n.emitido_em)}
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-semibold text-vapor-100">{n.tomador_nome}</div>
                      {n.tomador_cpf_cnpj && (
                        <div className="font-mono text-[11px] text-vapor-400">{n.tomador_cpf_cnpj}</div>
                      )}
                    </td>
                    <td className="py-3 px-3 font-mono font-bold text-amber-400">
                      {formatarMoeda(n.valor_total)}
                    </td>
                    <td className="py-3 px-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase ${
                        n.status === 'emitida'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                          : n.status === 'cancelada'
                          ? 'bg-red-500/10 text-red-400 border border-red-500/30'
                          : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                      }`}>
                        {n.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right space-x-2">
                      <button
                        type="button"
                        onClick={() => handleAbrirDanfe(n)}
                        className="inline-flex items-center gap-1 text-[11px] font-mono text-amber-400 hover:text-amber-300 hover:underline transition"
                        title="Visualizar e Baixar DANFSe (PDF)"
                      >
                        <Download size={12} />
                        <span>PDF</span>
                      </button>

                      {n.url_xml && (
                        <a
                          href={n.url_xml}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-mono text-cyan-400 hover:underline"
                        >
                          <Download size={12} />
                          <span>XML</span>
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};
