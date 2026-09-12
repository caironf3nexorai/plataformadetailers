import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { CertificadoPublicoData } from '../types/certificados';
import { formatarData } from '../utils/datas';
import { getFotoPublicUrl } from '../utils/imagens';
import { montarLinkWhatsapp } from '../utils/whatsapp';
import { 
  ShieldCheck, 
  Car, 
  Clock, 
  Sparkles, 
  CheckCircle2, 
  AlertCircle, 
  MessageCircle, 
  Printer, 
  ExternalLink, 
  Share2, 
  Check, 
  ChevronRight,
  Info
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { AdesivoParabrisaModal } from '../components/garantia/AdesivoParabrisaModal';

export const CertificadoGarantiaPublico: React.FC = () => {
  const { codigo } = useParams<{ codigo: string }>();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<CertificadoPublicoData | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [showAdesivoModal, setShowAdesivoModal] = useState(false);

  useEffect(() => {
    async function carregarCertificado() {
      if (!codigo) {
        setErro('Código do certificado não informado.');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const { data: res, error } = await supabase.rpc('obter_certificado_publico', {
          p_codigo: codigo
        });

        if (error) throw error;

        if (res && res.encontrado) {
          setData(res as CertificadoPublicoData);
        } else {
          setErro(res?.motivo || 'Certificado de garantia não localizado ou inválido.');
        }
      } catch (err: any) {
        console.error('Erro ao carregar certificado:', err);
        setErro('Não foi possível carregar os dados deste certificado.');
      } finally {
        setLoading(false);
      }
    }

    carregarCertificado();
  }, [codigo]);

  const handleCopiarLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      // fallback
    }
  };

  const handleAgendarWhatsApp = () => {
    if (!data?.oficina.telefone) return;
    const msg = `Olá, ${data.oficina.nome}! Gostaria de agendar a próxima revisão preventiva da garantia do meu veículo (${data.veiculo.modelo} - Placa ${data.veiculo.placa}) - Certificado ${data.certificado.codigo}.`;
    const link = montarLinkWhatsapp(data.oficina.telefone, msg);
    if (link) {
      window.open(link, '_blank');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-vapor-300">
        <div className="w-12 h-12 border-2 border-amber-500/20 border-t-amber-500 rounded-full animate-spin mb-4" />
        <span className="font-mono text-sm tracking-wider uppercase text-vapor-400">
          Autenticando Certificado de Garantia...
        </span>
      </div>
    );
  }

  if (erro || !data) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-center">
        <div className="max-w-md w-full p-8 bg-graphite-900 border border-graphite-800 rounded-2xl shadow-2xl space-y-4">
          <div className="w-14 h-14 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
            <AlertCircle size={28} />
          </div>
          <h2 className="text-xl font-display font-black text-white uppercase tracking-wide">
            Certificado Não Localizado
          </h2>
          <p className="text-xs text-vapor-400 leading-relaxed">
            {erro || 'O código informado não corresponde a nenhum certificado de garantia emitido.'}
          </p>
          <div className="pt-2">
            <Link
              to="/"
              className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-graphite-800 hover:bg-graphite-700 text-vapor-100 text-xs font-semibold border border-graphite-700 transition-colors"
            >
              Ir para o Início
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const { certificado, oficina, cliente, veiculo, manutencoes } = data;

  // Render do Status Banner
  const renderStatusBanner = () => {
    switch (certificado.status) {
      case 'ativo':
        return (
          <div className="p-4 bg-emerald-500/15 border border-emerald-500/30 rounded-2xl flex items-center justify-between gap-3 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                <CheckCircle2 size={24} />
              </div>
              <div>
                <h3 className="font-display font-bold text-sm text-emerald-300 uppercase tracking-wider">
                  Garantia Ativa e em Dia
                </h3>
                <span className="text-xs text-vapor-300">
                  Proteção válida até <strong>{formatarData(certificado.data_vencimento)}</strong> ({certificado.dias_restantes} dias restantes).
                </span>
              </div>
            </div>
            <span className="hidden sm:inline-block px-3 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-full font-mono text-xs font-bold">
              AUTENTICADO
            </span>
          </div>
        );
      case 'manutencao_pendente':
        return (
          <div className="p-4 bg-amber-500/15 border border-amber-500/30 rounded-2xl flex items-center justify-between gap-3 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                <Clock size={24} />
              </div>
              <div>
                <h3 className="font-display font-bold text-sm text-amber-300 uppercase tracking-wider">
                  Revisão Preventiva Recomendada
                </h3>
                <span className="text-xs text-vapor-300">
                  A data prevista da sua revisão preventiva ({formatarData(certificado.proxima_revisao_data)}) chegou. Agende com a oficina para manter o certificado 100% ativo!
                </span>
              </div>
            </div>
            <Button
              type="button"
              variant="primary"
              onClick={handleAgendarWhatsApp}
              className="hidden sm:flex text-xs font-bold bg-amber-500 hover:bg-amber-400 text-graphite-950 py-2 shrink-0"
            >
              Agendar Revisão
            </Button>
          </div>
        );
      case 'expirado':
      default:
        return (
          <div className="p-4 bg-rose-500/15 border border-rose-500/30 rounded-2xl flex items-center gap-3 shadow-sm">
            <div className="w-10 h-10 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
              <AlertCircle size={24} />
            </div>
            <div>
              <h3 className="font-display font-bold text-sm text-rose-300 uppercase tracking-wider">
                Prazo de Garantia Encerrado
              </h3>
              <span className="text-xs text-vapor-400">
                Este certificado de cobertura foi concluído em {formatarData(certificado.data_vencimento)}.
              </span>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-graphite-950 to-black text-vapor-100 py-8 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto flex flex-col gap-6">

        {/* 1. TOPO OFICIAL DA OFICINA */}
        <header className="flex flex-wrap items-center justify-between gap-4 p-5 bg-graphite-900/80 border border-graphite-800 rounded-2xl backdrop-blur-md shadow-xl">
          <div className="flex items-center gap-3.5">
            {oficina.logo_path ? (
              <img
                src={getFotoPublicUrl(oficina.logo_path) || ''}
                alt={oficina.nome}
                className="w-12 h-12 rounded-xl object-contain bg-graphite-950 border border-graphite-700 p-1 shadow"
              />
            ) : (
              <div className="w-12 h-12 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold font-display text-base border border-amber-500/30">
                {oficina.nome.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display font-black text-base sm:text-lg text-white tracking-wide uppercase">
                  {oficina.nome}
                </h1>
                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                  <ShieldCheck size={11} />
                  Verificada
                </span>
              </div>
              <p className="text-xs text-vapor-400 flex items-center gap-1.5 mt-0.5">
                {oficina.cidade && <span>{oficina.cidade}{oficina.estado ? ` - ${oficina.estado}` : ''}</span>}
                {oficina.telefone && <span>· Tel: {oficina.telefone}</span>}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowAdesivoModal(true)}
              className="text-xs flex items-center gap-1.5 py-2 border-graphite-700"
            >
              <Printer size={15} className="text-amber-400" />
              <span className="hidden sm:inline">Adesivo com QR Code</span>
              <span className="sm:hidden">Selo</span>
            </Button>

            <Button
              type="button"
              variant="secondary"
              onClick={handleCopiarLink}
              className="text-xs flex items-center gap-1.5 py-2 border-graphite-700"
            >
              {copiado ? <Check size={15} className="text-mint-400" /> : <Share2 size={15} />}
              <span>{copiado ? 'Link Copiado!' : 'Compartilhar'}</span>
            </Button>
          </div>
        </header>

        {/* 2. SELO DOURADO DE AUTENTICIDADE DIGITAL */}
        <div className="relative p-6 sm:p-8 rounded-3xl bg-gradient-to-br from-amber-500/10 via-graphite-900 to-graphite-950 border border-amber-500/30 shadow-2xl overflow-hidden">
          {/* Efeito luminoso de fundo */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-amber-500/20 pb-6 mb-6">
            <div className="space-y-1">
              <span className="text-[11px] font-mono tracking-widest text-amber-400 uppercase font-black flex items-center gap-2">
                <Sparkles size={14} className="text-amber-400" />
                Certificado Oficial de Proteção Automotiva
              </span>
              <h2 className="text-2xl sm:text-3xl font-display font-black text-white tracking-tight uppercase">
                {certificado.servico_nome}
              </h2>
              {certificado.produto_aplicado && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-graphite-950/80 border border-amber-500/30 text-xs font-mono text-amber-300 font-bold">
                  <span>Revestimento:</span>
                  <span className="text-white">{certificado.produto_aplicado}</span>
                </div>
              )}
            </div>

            <div className="text-left sm:text-right space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-vapor-400 block font-bold">
                Código de Registro
              </span>
              <div className="text-xl font-mono font-black text-amber-400 tracking-wider bg-graphite-950/90 px-3.5 py-1.5 rounded-xl border border-amber-500/40 inline-block shadow-inner">
                {certificado.codigo}
              </div>
            </div>
          </div>

          {/* BANNER DE STATUS */}
          {renderStatusBanner()}

          {/* BARRA DE PROGRESSO DA GARANTIA */}
          <div className="mt-6 p-4 bg-graphite-950/80 rounded-2xl border border-graphite-800/80 space-y-2.5">
            <div className="flex justify-between items-center text-xs">
              <span className="text-vapor-400 font-medium">Progresso da Cobertura:</span>
              <span className="font-mono text-amber-300 font-bold">
                {certificado.dias_restantes > 0
                  ? `${certificado.dias_restantes} dias restantes (${certificado.percentual_decorrido}% decorrido)`
                  : 'Garantia Concluída'}
              </span>
            </div>
            <div className="w-full h-2.5 bg-graphite-800 rounded-full overflow-hidden p-0.5 border border-graphite-700/60">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-amber-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(5, certificado.percentual_decorrido))}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] font-mono text-vapor-400">
              <span>Aplicação: {formatarData(certificado.data_aplicacao)}</span>
              <span className="text-emerald-400 font-bold">
                Vencimento: {formatarData(certificado.data_vencimento)} ({certificado.garantia_meses} meses)
              </span>
            </div>
          </div>
        </div>

        {/* 3. DADOS DO VEÍCULO & PROPRIETÁRIO */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Veículo */}
          <div className="p-5 bg-graphite-900 border border-graphite-800 rounded-2xl shadow-sm space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-400 uppercase tracking-wider border-b border-graphite-800 pb-2.5">
              <Car size={16} />
              <span>Veículo Beneficiário</span>
            </div>
            <div className="space-y-1">
              <div className="text-lg font-black text-white leading-tight">
                {veiculo.modelo}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <span className="px-2.5 py-1 bg-graphite-950 border border-graphite-700 rounded font-mono text-xs font-bold text-amber-300 tracking-wider">
                  {veiculo.placa}
                </span>
                {veiculo.cor && (
                  <span className="text-xs text-vapor-400 font-medium">Cor: {veiculo.cor}</span>
                )}
                {veiculo.ano && (
                  <span className="text-xs text-vapor-400 font-medium">Ano: {veiculo.ano}</span>
                )}
              </div>
            </div>
          </div>

          {/* Proprietário */}
          <div className="p-5 bg-graphite-900 border border-graphite-800 rounded-2xl shadow-sm space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-400 uppercase tracking-wider border-b border-graphite-800 pb-2.5">
              <ShieldCheck size={16} />
              <span>Titular do Certificado</span>
            </div>
            <div className="space-y-1">
              <div className="text-lg font-black text-white leading-tight">
                {cliente.nome}
              </div>
              <p className="text-xs text-vapor-400">
                Contato Registrado: <span className="font-mono text-vapor-300">{cliente.telefone}</span>
              </p>
              <p className="text-[11px] text-vapor-500 pt-0.5">
                Certificado intransferível vinculado ao chassi/placa do veículo.
              </p>
            </div>
          </div>
        </div>

        {/* 4. LINHA DO TEMPO DE REVISÕES PERIÓDICAS (MANUTENÇÃO OBRIGATÓRIA) */}
        <div className="p-6 bg-graphite-900 border border-graphite-800 rounded-2xl shadow-md space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-graphite-800 pb-3">
            <div>
              <h3 className="font-display font-black text-base text-white uppercase tracking-wide flex items-center gap-2">
                <Clock size={18} className="text-amber-400" />
                <span>Cronograma de Manutenções Preventivas</span>
              </h3>
              <p className="text-xs text-vapor-400 mt-0.5">
                Revisões recomendadas a cada <strong>{certificado.intervalo_manutencao_dias} dias</strong> para preservar a hidrofobia e cobertura total.
              </p>
            </div>
            {data.oficina.telefone && (
              <Button
                type="button"
                variant="primary"
                onClick={handleAgendarWhatsApp}
                className="text-xs font-bold bg-amber-500 hover:bg-amber-400 text-graphite-950 py-2 flex items-center gap-1.5"
              >
                <MessageCircle size={15} />
                <span>Agendar Manutenção</span>
              </Button>
            )}
          </div>

          {/* Lista de Revisões Realizadas */}
          {manutencoes.length > 0 ? (
            <div className="space-y-2.5">
              <span className="text-[11px] uppercase font-bold text-emerald-400 tracking-wider block">
                Revisões Efetuadas na Oficina ({manutencoes.length})
              </span>
              <div className="space-y-2">
                {manutencoes.map((m) => (
                  <div
                    key={m.id}
                    className="p-3 bg-graphite-950/80 border border-emerald-500/20 rounded-xl flex items-start justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-[11px]">
                        ✓
                      </div>
                      <div>
                        <strong className="text-white">Revisão #{m.numero_revisao}</strong>
                        {m.observacao && <p className="text-vapor-400 text-[11px]">{m.observacao}</p>}
                      </div>
                    </div>
                    <span className="font-mono text-emerald-400 font-bold shrink-0">
                      {formatarData(m.data_realizada)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-3.5 bg-graphite-950 rounded-xl border border-graphite-800 text-xs text-vapor-400 flex items-center gap-2.5">
              <Info size={18} className="text-amber-400 shrink-0" />
              <span>
                Nenhuma revisão periódica efetuada até o momento. A primeira revisão está programada para{' '}
                <strong className="text-amber-300">{formatarData(certificado.proxima_revisao_data)}</strong>.
              </span>
            </div>
          )}

          {/* Próxima Revisão Recomendada */}
          {certificado.proxima_revisao_data && (
            <div className="p-4 bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/30 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-amber-400 block">
                  Próxima Parada Recomendada
                </span>
                <div className="text-sm font-black text-white mt-0.5">
                  Revisão Preventiva #{certificado.total_revisoes_feitas + 1}
                </div>
                <p className="text-xs text-vapor-300">
                  Data prevista: <strong>{formatarData(certificado.proxima_revisao_data)}</strong>
                  {certificado.proxima_revisao_dias > 0 && ` (em ${certificado.proxima_revisao_dias} dias)`}
                  {certificado.proxima_revisao_dias < 0 && (
                    <span className="text-rose-400 font-bold"> (Vencida há {Math.abs(certificado.proxima_revisao_dias)} dias)</span>
                  )}
                </p>
              </div>

              {oficina.telefone && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleAgendarWhatsApp}
                  className="w-full sm:w-auto text-xs py-2 text-amber-300 border-amber-500/30 hover:bg-amber-500/10 flex items-center justify-center gap-1.5"
                >
                  <span>Chamar no WhatsApp</span>
                  <ChevronRight size={14} />
                </Button>
              )}
            </div>
          )}
        </div>

        {/* 5. CUIDADOS & INSTRUÇÕES DE CURA */}
        {certificado.observacoes && (
          <div className="p-5 bg-graphite-900 border border-graphite-800 rounded-2xl shadow-sm space-y-2">
            <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
              <Info size={15} />
              <span>Instruções Técnicas de Cura & Recomendações</span>
            </h4>
            <p className="text-xs text-vapor-300 leading-relaxed whitespace-pre-line">
              {certificado.observacoes}
            </p>
          </div>
        )}

        {/* 6. RODAPÉ DE AUTENTICIDADE */}
        <footer className="text-center py-6 space-y-2 text-xs text-vapor-500">
          <div className="flex items-center justify-center gap-2">
            <ShieldCheck size={16} className="text-amber-500" />
            <span className="font-semibold text-vapor-400">
              Certificado Digital emitido por {oficina.nome}
            </span>
          </div>
          <p className="text-[11px] text-vapor-600">
            Tecnologia de Autenticação e Rastreabilidade · NuvemWash Detailers
          </p>
          {oficina.slug && (
            <div className="pt-2">
              <Link
                to={`/agendar/${oficina.slug}`}
                className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 underline"
              >
                <span>Conhecer todos os serviços da {oficina.nome}</span>
                <ExternalLink size={12} />
              </Link>
            </div>
          )}
        </footer>

      </div>

      {/* MODAL DO ADESIVO COM QR CODE */}
      {showAdesivoModal && (
        <AdesivoParabrisaModal
          isOpen={showAdesivoModal}
          onClose={() => setShowAdesivoModal(false)}
          certificado={{
            codigo: certificado.codigo,
            servico_nome: certificado.servico_nome,
            produto_aplicado: certificado.produto_aplicado,
            data_aplicacao: certificado.data_aplicacao,
            data_vencimento: certificado.data_vencimento,
            proxima_revisao_data: certificado.proxima_revisao_data
          }}
          oficina={oficina}
          veiculo={veiculo}
        />
      )}
    </div>
  );
};
