import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import {
  AlertTriangle,
  Camera,
  Send,
  ShieldCheck,
  UploadCloud,
  X,
  Sparkles,
  Printer,
  Download,
  CheckCircle2,
  Layers,
  Copy,
  BookOpen,
  Search,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { gerarPDFTermoRisco } from '../../utils/pdfTermoRisco';
import {
  TERMO_CIENCIA_RISCO_PADRAO_ADVOGADO,
  preencherVariaveisTermo,
  BIBLIOTECA_RISCOS_SERVICOS,
  type ItemBibliotecaRisco,
} from '../../types/termos';
import { uploadExecucaoFoto, compressImage, getEvidenciaSignedUrl } from '../../utils/evidencias';
import { montarLinkWhatsapp } from '../../utils/whatsapp';
import { formatarDataHora } from '../../utils/datas';
import { gerarId } from '../../utils/uuid';

export interface ModalTermoRiscoAtendimentoProps {
  isOpen: boolean;
  onClose: () => void;
  agendamento: any;
  execucaoId?: string;
  onSuccess?: (dadosAtualizados: any) => void;
}

const PRESETS_RISCOS = [
  {
    titulo: 'Verniz Queimado / Fino (Pós Pré-Lavagem)',
    servico: 'Polimento Técnico',
    texto:
      'Após pré-lavagem e descontaminação técnica, identificado verniz excessivamente fino, queimado ou craquelado pelo sol, com risco de desgaste ou rompimento durante o corte mecânico.',
  },
  {
    titulo: 'Repintura Prévia / Risco de Desplacamento',
    servico: 'Polimento Técnico',
    texto:
      'Identificado vício preexistente de repintura automotiva com aderência deficiente; risco de desplacamento na remoção de fita de isolamento ou temperatura da politriz.',
  },
  {
    titulo: 'Lavagem de Motor / Chicote & Sensores',
    servico: 'Lavagem Técnica de Motor',
    texto:
      'Componentes elétricos, chicotes, presilhas e conectores de sensores ressecados pelo tempo e temperatura do motor; risco de falha preexistente comunicado preventivamente.',
  },
  {
    titulo: 'Plásticos & Frisos Externos Ressecados',
    servico: 'Detalhamento Externo',
    texto:
      'Guarnições de borracha e acabamentos plásticos externos esbranquiçados/ressecados com fragilidade prévia na manipulação ou limpeza técnica.',
  },
  {
    titulo: 'Couro / Estofado Desgastado',
    servico: 'Higienização Interna',
    texto:
      'Tecido ou couro com ressecamento severo/desgaste acentuado, com risco de desgaste adicional inerente ao atrito de limpeza técnica profunda.',
  },
];

export const ModalTermoRiscoAtendimento: React.FC<ModalTermoRiscoAtendimentoProps> = ({
  isOpen,
  onClose,
  agendamento,
  execucaoId,
  onSuccess,
}) => {
  const { tenant, user } = useAuth();
  const { showSuccess, showError } = useToast();

  const [incluirTermoRisco, setIncluirTermoRisco] = useState(false);
  const [servicoNome, setServicoNome] = useState('');
  const [observacoes, setObservacoes] = useState('');

  // Fotos do Antes (Vistoria de Entrada)
  const [fotosAntes, setFotosAntes] = useState<
    Array<{ path: string; url?: string; descricao?: string }>
  >([]);

  // Fotos do Durante (Existentes e Novas)
  const [fotosDuranteExistentes, setFotosDuranteExistentes] = useState<
    Array<{ path: string; url?: string; descricao?: string }>
  >([]);
  const [novasFotos, setNovasFotos] = useState<
    Array<{ file: File; preview: string }>
  >([]);

  const [saving, setSaving] = useState(false);
  const [gerandoPDFTermo, setGerandoPDFTermo] = useState(false);

  // Estados para exploração dos 24 serviços CDC
  const [mostrarBiblioteca, setMostrarBiblioteca] = useState(false);
  const [buscaBiblioteca, setBuscaBiblioteca] = useState('');
  const [categoriaBiblioteca, setCategoriaBiblioteca] = useState<string>('todas');

  // Lista de serviços existentes no agendamento para seleção rápida
  const servicosDisponiveis = React.useMemo(() => {
    if (!agendamento) return [];
    const rawItens = agendamento.agendamento_itens || agendamento.itens || [];
    const list: string[] = [];
    rawItens.forEach((it: any) => {
      const nome = it.servicos?.nome || it.servico_nome;
      if (nome && !list.includes(nome)) list.push(nome);
    });
    if (agendamento.servico?.nome && !list.includes(agendamento.servico.nome)) {
      list.push(agendamento.servico.nome);
    }
    return list;
  }, [agendamento]);

  useEffect(() => {
    if (!isOpen || !agendamento) return;

    const ativo = agendamento.incluir_termo_risco ?? false;
    setIncluirTermoRisco(ativo);

    const srv =
      agendamento.termo_risco_servico ||
      (servicosDisponiveis.length > 0 ? servicosDisponiveis[0] : 'Polimento Técnico');
    setServicoNome(srv);

    setObservacoes(agendamento.termo_risco_observacoes || '');
    setNovasFotos([]);

    // 1. Carregar Fotos da Vistoria Inicial (Antes)
    const carregarFotosAntes = async () => {
      try {
        const { data: chkData } = await supabase
          .from('checkins')
          .select('id')
          .eq('agendamento_id', agendamento.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (chkData?.id) {
          const { data: fts } = await supabase
            .from('checkin_fotos')
            .select('*')
            .eq('checkin_id', chkData.id);

          if (fts && fts.length > 0) {
            const comUrls = await Promise.all(
              fts.map(async (f: any) => ({
                path: f.path,
                descricao: f.descricao || 'Vistoria inicial na chegada do veículo',
                url: await getEvidenciaSignedUrl(f.path),
              }))
            );
            setFotosAntes(comUrls);
          } else {
            setFotosAntes([]);
          }
        } else {
          setFotosAntes([]);
        }
      } catch (e) {
        console.warn('[ModalTermoRisco] Erro ao carregar fotos antes:', e);
      }
    };

    // 2. Carregar Fotos de Vício Oculto Existentes (Durante)
    const carregarFotosDurante = async () => {
      try {
        const fotosRaw = agendamento.termo_risco_fotos_durante || [];
        if (Array.isArray(fotosRaw) && fotosRaw.length > 0) {
          const comUrls = await Promise.all(
            fotosRaw.map(async (f: any) => ({
              path: f.path,
              descricao: f.descricao || 'Avaria identificada pós pré-lavagem',
              url: await getEvidenciaSignedUrl(f.path),
            }))
          );
          setFotosDuranteExistentes(comUrls);
        } else {
          setFotosDuranteExistentes([]);
        }
      } catch (e) {
        console.warn('[ModalTermoRisco] Erro ao carregar fotos durante:', e);
      }
    };

    carregarFotosAntes();
    carregarFotosDurante();
  }, [isOpen, agendamento, servicosDisponiveis]);

  const handleSelecionarNovasFotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const filesArray = Array.from(e.target.files);
    const mapped = filesArray.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
    }));
    setNovasFotos((prev) => [...prev, ...mapped]);
  };

  const handleRemoverNovaFoto = (index: number) => {
    setNovasFotos((prev) => {
      const copy = [...prev];
      if (copy[index]?.preview) URL.revokeObjectURL(copy[index].preview);
      copy.splice(index, 1);
      return copy;
    });
  };

  const aplicarPreset = (preset: (typeof PRESETS_RISCOS)[0]) => {
    if (!servicoNome || servicoNome === 'Polimento Técnico' || servicoNome === 'Serviço') {
      setServicoNome(preset.servico);
    }
    if (!observacoes.trim()) {
      setObservacoes(preset.texto);
    } else {
      setObservacoes((prev) => `${prev.trim()}\n• ${preset.texto}`);
    }
  };

  const itensBibliotecaFiltrados = React.useMemo(() => {
    return BIBLIOTECA_RISCOS_SERVICOS.filter((item) => {
      const matchCat = categoriaBiblioteca === 'todas' || item.categoria === categoriaBiblioteca;
      const matchBusca =
        !buscaBiblioteca.trim() ||
        item.titulo.toLowerCase().includes(buscaBiblioteca.toLowerCase()) ||
        item.badgeLabel.toLowerCase().includes(buscaBiblioteca.toLowerCase()) ||
        item.palavrasChave.some((k) => k.toLowerCase().includes(buscaBiblioteca.toLowerCase()));
      return matchCat && matchBusca;
    });
  }, [categoriaBiblioteca, buscaBiblioteca]);

  const aplicarItemBiblioteca = (item: ItemBibliotecaRisco) => {
    if (!servicoNome || servicoNome === 'Polimento Técnico' || servicoNome === 'Serviço') {
      setServicoNome(item.titulo);
    }
    const clausulaLimpa = item.clausulaJuridica.startsWith('• ')
      ? item.clausulaJuridica.slice(2)
      : item.clausulaJuridica;

    if (!observacoes.trim()) {
      setObservacoes(clausulaLimpa);
    } else {
      setObservacoes((prev) => `${prev.trim()}\n\n• ${clausulaLimpa}`);
    }
    showSuccess(`Cláusula CDC de "${item.badgeLabel}" adicionada aos riscos!`);
  };

  const construirTextoTermo = () => {
    const nomeOficina = tenant?.nome || tenant?.razao_social || 'Oficina Detailer';
    const nomeCliente = agendamento?.cliente?.nome || 'Cliente';
    const cpfCliente =
      agendamento?.cliente?.documento || agendamento?.cliente?.cpf_cnpj || 'Não informado';
    const veicPlaca = `${agendamento?.veiculo?.modelo || 'Veículo'}${
      agendamento?.veiculo?.placa ? ` - Placa: ${agendamento.veiculo.placa}` : ''
    }`;

    return preencherVariaveisTermo(TERMO_CIENCIA_RISCO_PADRAO_ADVOGADO, {
      nomeEmpresa: nomeOficina,
      servicoContratado: servicoNome.trim() || 'Serviço com Risco Específico',
      riscosObservacoes: observacoes.trim() || 'Condições e riscos informados ao cliente.',
      clienteNome: nomeCliente,
      clienteCpf: cpfCliente,
      veiculoPlaca: veicPlaca,
      data: new Date().toLocaleDateString('pt-BR'),
    });
  };

  const handleSalvar = async (notificarSucesso = true) => {
    if (!agendamento?.id) return;
    if (incluirTermoRisco && !observacoes.trim()) {
      showError('Informe os riscos identificados antes de ativar o termo.');
      return;
    }

    try {
      setSaving(true);

      const textoFinal = incluirTermoRisco ? construirTextoTermo() : null;
      const placa = agendamento.veiculo?.placa || '';
      const dataHoraAtual = formatarDataHora(new Date().toISOString());

      // 1. Processar e fazer upload de todas as novas fotos selecionadas
      const novasFotosSalvas: Array<{ path: string; descricao: string; created_at: string }> = [];

      for (const item of novasFotos) {
        if (execucaoId && tenant && user) {
          const { path, capturadaEm } = await uploadExecucaoFoto(
            tenant.id,
            execucaoId,
            item.file,
            placa
          );
          await supabase.from('execucao_fotos').insert({
            tenant_id: tenant.id,
            execucao_id: execucaoId,
            path,
            momento: 'durante',
            enviado_por: user.id,
            capturada_em: capturadaEm,
          });
          novasFotosSalvas.push({
            path,
            descricao: 'Avaria revelada após pré-lavagem e descontaminação',
            created_at: capturadaEm,
          });
        } else if (tenant) {
          const carimbo = placa ? `${dataHoraAtual} · ${placa.toUpperCase()}` : dataHoraAtual;
          const blobToUpload = await compressImage(item.file, 1600, 0.75, carimbo);
          const fileName = `${gerarId()}.jpg`;
          const filePath = `${tenant.id}/atendimentos/${agendamento.id}/${fileName}`;
          await supabase.storage.from('evidencias').upload(filePath, blobToUpload, {
            upsert: true,
            contentType: 'image/jpeg',
          });
          novasFotosSalvas.push({
            path: filePath,
            descricao: 'Avaria revelada após pré-lavagem e descontaminação',
            created_at: new Date().toISOString(),
          });
        }
      }

      // Monta lista atualizada de fotos durante
      const fotosDuranteAtualizadas = [
        ...fotosDuranteExistentes.map((f) => ({
          path: f.path,
          descricao: f.descricao,
        })),
        ...novasFotosSalvas,
      ];

      // Garante token único de assinatura digital
      const termoToken = agendamento.termo_risco_token || gerarId();

      // 2. Atualizar no banco (agendamentos)
      const payloadAgend: any = {
        incluir_termo_risco: incluirTermoRisco,
        termo_risco_servico: incluirTermoRisco ? servicoNome.trim() : null,
        termo_risco_observacoes: incluirTermoRisco ? observacoes.trim() : null,
        termo_risco_texto: textoFinal,
        termo_risco_fotos_durante: fotosDuranteAtualizadas,
        termo_risco_token: termoToken,
      };

      const { error: agErr } = await supabase
        .from('agendamentos')
        .update(payloadAgend)
        .eq('id', agendamento.id);

      if (agErr) throw agErr;

      // 3. Se houver orçamento vinculado, atualiza também
      if (agendamento.orcamento_id) {
        await supabase
          .from('orcamentos')
          .update({
            incluir_termo_risco: incluirTermoRisco,
            termo_risco_servico: incluirTermoRisco ? servicoNome.trim() : null,
            termo_risco_observacoes: incluirTermoRisco ? observacoes.trim() : null,
            termo_risco_texto: textoFinal,
          })
          .eq('id', agendamento.orcamento_id);
      }

      const dadosAtualizados = {
        ...agendamento,
        ...payloadAgend,
      };

      if (notificarSucesso) {
        showSuccess(
          incluirTermoRisco
            ? 'Termo de Risco registrado na OS com sucesso!'
            : 'Termo de Risco desativado com sucesso.'
        );
      }

      onSuccess?.(dadosAtualizados);
      onClose();
    } catch (err: any) {
      console.error('[ModalTermoRisco] Erro ao salvar:', err);
      showError(err?.message || 'Erro ao registrar termo de risco.');
    } finally {
      setSaving(false);
    }
  };

  const handleCopiarLink = () => {
    const tokenTermo = agendamento?.termo_risco_token || agendamento?.id;
    const link = `${window.location.origin}/termo-risco/${tokenTermo}`;
    navigator.clipboard.writeText(link);
    showSuccess('Link de assinatura digital copiado para a área de transferência!');
  };

  const handleEnviarWhatsapp = () => {
    const clienteTelefone = agendamento?.cliente?.telefone;
    const clienteNome = agendamento?.cliente?.nome || 'Cliente';
    const veiculoDesc = `${agendamento?.veiculo?.modelo || 'Veículo'}${
      agendamento?.veiculo?.placa ? ` (${agendamento.veiculo.placa})` : ''
    }`;

    if (!clienteTelefone) {
      showError('O cliente não possui telefone cadastrado.');
      return;
    }

    if (!observacoes.trim()) {
      showError('Preencha os riscos identificados antes de enviar pelo WhatsApp.');
      return;
    }

    const tokenTermo = agendamento?.termo_risco_token || agendamento?.id;
    const linkTermo = `${window.location.origin}/termo-risco/${tokenTermo}`;

    const mensagem =
      `🚗 *Cuidado Técnico Especial com seu ${veiculoDesc}*\n\n` +
      `Olá, *${clienteNome}*! Tudo bem com você?\n\n` +
      `Já iniciamos os cuidados com o seu veículo aqui na oficina! Durante a nossa etapa de pré-lavagem e descontaminação técnica detalhada, nossa equipe notou uma condição preexistente que estava encoberta pela sujeira e que achamos fundamental compartilhar com você, prezando sempre pela transparência e pelo melhor resultado:\n\n` +
      `🔧 *Serviço:* ${servicoNome || 'Procedimento Técnico'}\n` +
      `🔍 *O que identificamos:* ${observacoes.trim()}\n\n` +
      `Prezando pela sua segurança e tranquilidade, preparamos um termo com as fotos comparativas do seu carro (*Antes da lavagem* x *Avaria revelada*).\n\n` +
      `📲 *Por favor, acesse o link seguro abaixo para conferir as fotos e assinar digitalmente a autorização na tela:*\n` +
      `${linkTermo}\n\n` +
      `Qualquer dúvida, estamos 100% à sua disposição! 😊✨`;

    const link = montarLinkWhatsapp(clienteTelefone, mensagem);
    if (link) {
      window.open(link, '_blank');
    } else {
      showError('Número de WhatsApp inválido para envio.');
    }
  };

  const handleGerarPDFTermoManual = async (acao: 'download' | 'print' = 'print') => {
    if (!tenant || !agendamento) return;
    if (!observacoes.trim()) {
      showError('Preencha os riscos identificados antes de gerar o termo.');
      return;
    }

    try {
      setGerandoPDFTermo(true);
      const logoUrl = tenant.logo_path
        ? supabase.storage.from('catalogo').getPublicUrl(tenant.logo_path).data.publicUrl
        : undefined;

      const fotosA = fotosAntes.map((f) => ({
        url: f.url || f.path,
        descricao: f.descricao,
        momento: 'antes',
      }));

      const fotosD = [
        ...fotosDuranteExistentes.map((f) => ({
          url: f.url || f.path,
          descricao: f.descricao,
          momento: 'durante',
        })),
        ...novasFotos.map((nf) => ({
          url: nf.preview,
          descricao: 'Avaria revelada pós pré-lavagem',
          momento: 'durante',
        })),
      ];

      const assinado = agendamento.termo_risco_assinado ?? false;

      await gerarPDFTermoRisco(
        {
          oficinaNome: tenant.nome || 'Oficina',
          oficinaRazaoSocial: tenant.razao_social,
          oficinaDocumento: tenant.documento,
          oficinaDocumentoTipo: tenant.documento_tipo,
          oficinaTelefone: tenant.telefone,
          oficinaCidadeUF: tenant.cidade && tenant.uf ? `${tenant.cidade}/${tenant.uf}` : undefined,
          oficinaLogoUrl: logoUrl,
          planoCodigo: tenant.plano,
          pdfCorPrimaria: tenant.pdf_cor_primaria,
          pdfCorFundoCabecalho: tenant.pdf_cor_fundo_cabecalho,
          pdfCorTextoCabecalho: tenant.pdf_cor_texto_cabecalho,
          pdfCorFundoSecoes: tenant.pdf_cor_fundo_secoes,
          pdfCorTextoSecoes: tenant.pdf_cor_texto_secoes,
          pdfSubtituloCabecalho: tenant.pdf_subtitulo_cabecalho,
          pdfTextoRodape: tenant.pdf_texto_rodape,
          pdfOcultarMarcaDagua: tenant.pdf_ocultar_marca_dagua,

          clienteNome: agendamento.cliente?.nome || 'Cliente',
          clienteDocumento: agendamento.cliente?.documento || agendamento.cliente?.cpf_cnpj,
          clienteTelefone: agendamento.cliente?.telefone,
          veiculoModelo: agendamento.veiculo?.modelo || 'Veículo',
          veiculoPlaca: agendamento.veiculo?.placa || '',
          veiculoCor: agendamento.veiculo?.cor,
          numeroOS: agendamento.numero_os,
          dataEmissao: agendamento.created_at || new Date().toISOString(),

          servicoNome: servicoNome.trim() || 'Serviço com Risco Técnico',
          riscosObservacoes: observacoes.trim(),
          assinaturaClienteNome: agendamento.cliente?.nome,

          fotosAntes: fotosA,
          fotosDurante: fotosD,

          assinaturaDigitalUrl: assinado ? agendamento.termo_risco_assinatura_path : null,
          assinaturaDigitalNome: agendamento.termo_risco_assinante_nome,
          assinaturaDigitalEm: agendamento.termo_risco_assinado_em,
        },
        undefined,
        acao,
        !assinado // Se assinado, imprime via digital única; se manual, 2 vias
      );
      showSuccess(
        acao === 'print' ? 'Termo enviado para impressão!' : 'PDF do termo baixado com sucesso!'
      );
    } catch (err: any) {
      console.error('[PDF Termo Risco Error]:', err);
      showError('Erro ao gerar termo: ' + (err?.message || err));
    } finally {
      setGerandoPDFTermo(false);
    }
  };

  const isAssinado = agendamento?.termo_risco_assinado ?? false;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Termo de Risco Específico & Vício Oculto (CDC)"
      maxWidth="lg"
    >
      <div className="flex flex-col gap-5 p-1 max-h-[82vh] overflow-y-auto pr-1">
        {/* Banner Informativo CDC */}
        <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-3">
          <AlertTriangle size={22} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1 text-[12px] font-sans">
            <span className="font-bold text-amber-300 uppercase tracking-wide">
              Proteção Jurídica & CDC (Dossiê Antes, Durante e Depois)
            </span>
            <p className="text-vapor-300 leading-relaxed">
              Veículos muito sujos costumam encobrir avarias (verniz fino/queimado, repinturas anteriores mal feitas, presilhas plásticas ressecadas).
              Ao lavar e identificar o vício, anexe as novas fotos. O sistema reúne as <strong>fotos da vistoria inicial (Antes)</strong> com as <strong>fotos do defeito revelado (Durante)</strong> e envia um link seguro para o cliente <strong>assinar digitalmente na tela</strong> ou assinar em 2 vias impressas.
            </p>
          </div>
        </div>

        {/* Status de Assinatura se já assinado */}
        {isAssinado && (
          <div className="p-4 bg-emerald-500/10 border border-emerald-500/40 rounded-xl flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 size={22} className="text-emerald-400 shrink-0" />
              <div className="flex flex-col text-[12px] font-sans">
                <span className="font-bold text-emerald-300 uppercase tracking-wide">
                  Termo Assinado Digitalmente pelo Cliente
                </span>
                <span className="text-vapor-300">
                  Assinado por <strong>{agendamento.termo_risco_assinante_nome || 'Cliente'}</strong> em{' '}
                  {agendamento.termo_risco_assinado_em
                    ? formatarDataHora(agendamento.termo_risco_assinado_em)
                    : ''}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => handleGerarPDFTermoManual('download')}
                disabled={gerandoPDFTermo}
                className="h-8 text-[11px] px-3 font-bold bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 flex items-center gap-1.5"
              >
                <Download size={13} />
                <span>PDF Assinado</span>
              </Button>

              <button
                type="button"
                onClick={handleCopiarLink}
                className="p-2 rounded-lg bg-graphite-900 border border-graphite-700 hover:border-amber-500 text-vapor-300 hover:text-amber-400 transition-colors"
                title="Copiar Link Público"
              >
                <Copy size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Toggle Ativação */}
        <div className="flex items-center justify-between p-3.5 bg-graphite-900 rounded-xl border border-graphite-700">
          <div className="flex items-center gap-2.5">
            <ShieldCheck
              size={20}
              className={incluirTermoRisco ? 'text-amber-400' : 'text-vapor-500'}
            />
            <div className="flex flex-col">
              <span className="font-sans text-[13px] font-bold text-vapor-100">
                Ativar Termo de Risco neste Atendimento / OS
              </span>
              <span className="font-sans text-[11px] text-vapor-400">
                Gera folha exclusiva de ciência e link de assinatura digital para o cliente.
              </span>
            </div>
          </div>

          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={incluirTermoRisco}
              onChange={(e) => setIncluirTermoRisco(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-graphite-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
          </label>
        </div>

        {incluirTermoRisco && (
          <div className="flex flex-col gap-5 animate-in fade-in duration-200">
            {/* Serviço Vinculado */}
            <div className="flex flex-col gap-1.5">
              <label className="font-sans text-[12px] font-bold text-vapor-300 uppercase tracking-wider">
                Serviço Sujeito a Risco Técnico:
              </label>

              {servicosDisponiveis.length > 0 ? (
                <div className="flex flex-wrap gap-2 mb-1">
                  {servicosDisponiveis.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setServicoNome(s)}
                      className={`px-3 py-1 rounded-lg text-[12px] font-sans transition-all border ${
                        servicoNome === s
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500 font-bold'
                          : 'bg-graphite-800 text-vapor-400 border-graphite-700 hover:text-vapor-200'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              ) : null}

              <input
                type="text"
                value={servicoNome}
                onChange={(e) => setServicoNome(e.target.value)}
                placeholder="Ex: Polimento Técnico, Lavagem de Motor, Higienização..."
                className="w-full bg-graphite-900 border border-graphite-700 rounded-lg p-2.5 text-[13px] text-vapor-100 placeholder-vapor-500 focus:border-amber-500 outline-none"
              />
            </div>

            {/* Presets Rápidos */}
            <div className="flex flex-col gap-1.5">
              <span className="font-sans text-[11px] font-bold text-vapor-400 uppercase tracking-wider flex items-center gap-1">
                <Sparkles size={13} className="text-amber-400" /> Modelos Rápidos de Risco (Clique para aplicar):
              </span>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS_RISCOS.map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => aplicarPreset(preset)}
                    className="px-2.5 py-1 text-[11px] font-sans font-medium rounded-md bg-graphite-900 hover:bg-graphite-800 text-amber-400/90 border border-amber-500/30 hover:border-amber-500/60 transition-colors"
                  >
                    + {preset.titulo}
                  </button>
                ))}
              </div>
            </div>

            {/* Explorar Todos os 24 Modelos CDC da Plataforma */}
            <div className="flex flex-col gap-2 p-3 bg-graphite-950/60 rounded-xl border border-graphite-800">
              <button
                type="button"
                onClick={() => setMostrarBiblioteca((prev) => !prev)}
                className="flex items-center justify-between text-left group w-full"
              >
                <div className="flex items-center gap-2">
                  <div className="p-1 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400">
                    <BookOpen size={14} />
                  </div>
                  <span className="font-sans text-[12px] font-bold text-vapor-200 group-hover:text-amber-400 transition-colors">
                    Explorar Biblioteca CDC Completa ({BIBLIOTECA_RISCOS_SERVICOS.length} Serviços Especializados)
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-vapor-400 text-[11px]">
                  <span>{mostrarBiblioteca ? 'Recolher' : 'Expandir'}</span>
                  {mostrarBiblioteca ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </div>
              </button>

              {mostrarBiblioteca && (
                <div className="flex flex-col gap-3 pt-2 border-t border-graphite-800/80 animate-in fade-in duration-150">
                  {/* Busca */}
                  <div className="relative">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-vapor-400" />
                    <input
                      type="text"
                      value={buscaBiblioteca}
                      onChange={(e) => setBuscaBiblioteca(e.target.value)}
                      placeholder="Buscar por serviço, peça ou dano (ex: motor, chuva ácida, couro, verniz)..."
                      className="w-full bg-graphite-900 border border-graphite-700 rounded-lg pl-8 pr-3 py-1.5 text-[11.5px] text-vapor-100 placeholder-vapor-500 focus:border-amber-500 outline-none"
                    />
                  </div>

                  {/* Pills de Categoria */}
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { id: 'todas', label: 'Todas' },
                      { id: 'lavagem', label: 'Lavagens' },
                      { id: 'vidros', label: 'Vidros' },
                      { id: 'polimento', label: 'Polimento' },
                      { id: 'protecao', label: 'Proteção' },
                      { id: 'interior', label: 'Interior' },
                      { id: 'reparo', label: 'Reparos' },
                      { id: 'especial', label: 'Especiais' },
                    ].map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setCategoriaBiblioteca(cat.id)}
                        className={`px-2 py-0.5 rounded text-[11px] font-sans font-medium transition-colors ${
                          categoriaBiblioteca === cat.id
                            ? 'bg-amber-500 text-graphite-950 font-bold'
                            : 'bg-graphite-900 text-vapor-400 hover:text-vapor-200 border border-graphite-800'
                        }`}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>

                  {/* Grid de 24 Serviços com 1 clique */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-1">
                    {itensBibliotecaFiltrados.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => aplicarItemBiblioteca(item)}
                        className="p-2 rounded-lg bg-graphite-900/90 hover:bg-graphite-850 border border-graphite-800 hover:border-amber-500/50 text-left transition-all group flex flex-col gap-0.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-sans text-[11.5px] font-bold text-vapor-200 group-hover:text-amber-300">
                            {item.titulo}
                          </span>
                          <span className="text-[9.5px] font-mono font-semibold px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            {item.badgeLabel}
                          </span>
                        </div>
                        <p className="font-sans text-[10.5px] text-vapor-400 line-clamp-2 leading-tight">
                          {item.riscoPadraoCurto}
                        </p>
                      </button>
                    ))}

                    {itensBibliotecaFiltrados.length === 0 && (
                      <div className="col-span-full py-4 text-center text-[11px] text-vapor-500">
                        Nenhum modelo de risco encontrado com o filtro "{buscaBiblioteca}".
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Riscos e Observações Técnicas */}
            <div className="flex flex-col gap-1.5">
              <label className="font-sans text-[12px] font-bold text-vapor-300 uppercase tracking-wider">
                Riscos Específicos & Condição Preexistente do Veículo:
              </label>
              <textarea
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                placeholder="Descreva detalhadamente a fragilidade identificada no veículo (ex: verniz muito fino no teto, conectores ressecados no cofre, repintura anterior frágil)..."
                rows={4}
                className="w-full bg-graphite-900 border border-graphite-700 rounded-lg p-3 text-[13px] text-vapor-100 placeholder-vapor-500 focus:border-amber-500 outline-none leading-relaxed"
              />
            </div>

            {/* Dossiê Fotográfico: Antes (Vistoria) e Durante (Defeito Revelado) */}
            <div className="flex flex-col gap-3 p-3.5 bg-graphite-900 rounded-xl border border-graphite-700">
              <div className="flex items-center justify-between border-b border-graphite-800 pb-2">
                <span className="font-sans text-[12px] font-bold text-vapor-200 flex items-center gap-1.5">
                  <Layers size={16} className="text-amber-400" />
                  Dossiê Fotográfico Comparativo (Antes x Durante)
                </span>
                <span className="text-[11px] text-vapor-400">Proteção CDC</span>
              </div>

              {/* 1. Fotos da Vistoria Inicial (Antes) */}
              <div className="flex flex-col gap-2">
                <span className="font-sans text-[11px] font-bold text-vapor-400 uppercase tracking-wider">
                  1. Fotos da Vistoria Inicial (Antes da Lavagem · Como o carro chegou):
                </span>
                {fotosAntes.length > 0 ? (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {fotosAntes.map((f, i) => (
                      <div
                        key={i}
                        className="relative h-20 bg-graphite-950 rounded-lg overflow-hidden border border-graphite-800 group"
                      >
                        <img
                          src={f.url || f.path}
                          alt={`Antes ${i + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center p-1 text-center">
                          <span className="text-[9px] text-white truncate">
                            {f.descricao || 'Entrada'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-vapor-500 italic p-2 bg-graphite-950 rounded border border-graphite-800">
                    Nenhuma foto de vistoria vinculada a este atendimento.
                  </p>
                )}
              </div>

              {/* 2. Fotos do Vício Revelado (Durante - Pós Pré-Lavagem) */}
              <div className="flex flex-col gap-2 pt-2 border-t border-graphite-800">
                <div className="flex items-center justify-between">
                  <span className="font-sans text-[11px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1">
                    <Camera size={13} />
                    2. Fotos da Avaria / Vício Revelado (Durante · Pós Pré-Lavagem):
                  </span>
                  <span className="text-[10px] text-vapor-500">Múltiplas fotos permitidas</span>
                </div>

                {/* Grid de fotos existentes e novas */}
                {(fotosDuranteExistentes.length > 0 || novasFotos.length > 0) && (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {fotosDuranteExistentes.map((f, i) => (
                      <div
                        key={`existente-${i}`}
                        className="relative h-20 bg-graphite-950 rounded-lg overflow-hidden border border-amber-500/40"
                      >
                        <img
                          src={f.url || f.path}
                          alt={`Durante ${i + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <span className="absolute bottom-1 right-1 text-[8px] bg-amber-500/90 text-graphite-950 font-bold px-1 rounded">
                          Salvo
                        </span>
                      </div>
                    ))}

                    {novasFotos.map((nf, i) => (
                      <div
                        key={`nova-${i}`}
                        className="relative h-20 bg-graphite-950 rounded-lg overflow-hidden border border-emerald-500/50 group"
                      >
                        <img
                          src={nf.preview}
                          alt={`Nova ${i + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoverNovaFoto(i)}
                          className="absolute top-1 right-1 p-1 bg-graphite-900/90 hover:bg-flare-500 text-white rounded-full transition-colors"
                          title="Remover foto"
                        >
                          <X size={12} />
                        </button>
                        <span className="absolute bottom-1 left-1 text-[8px] bg-emerald-500/90 text-graphite-950 font-bold px-1 rounded">
                          Nova
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Upload Trigger */}
                <label className="p-3 border border-dashed border-graphite-600 hover:border-amber-500 bg-graphite-950 rounded-lg flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-colors">
                  <UploadCloud size={20} className="text-amber-400" />
                  <span className="font-sans text-[11px] text-vapor-200 font-bold">
                    Tirar Foto ou Anexar Evidências da Avaria
                  </span>
                  <span className="font-sans text-[10px] text-vapor-500">
                    Comprime com carimbo d'água automático e anexa ao dossiê da OS
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleSelecionarNovasFotos}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {/* Ação Assinatura Digital & Link Público */}
            <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center justify-between gap-3 flex-wrap">
              <div className="flex flex-col">
                <span className="font-sans text-[12px] font-bold text-amber-400 flex items-center gap-1.5">
                  <Send size={14} />
                  Enviar Link Seguro para Assinatura Digital no WhatsApp
                </span>
                <span className="font-sans text-[11px] text-vapor-300">
                  O cliente abre no celular, vê o comparativo (Antes x Durante) e assina na tela.
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleEnviarWhatsapp}
                  className="h-8 text-[11px] px-3 font-bold bg-emerald-600 hover:bg-emerald-500 text-white shrink-0 flex items-center gap-1.5"
                >
                  <Send size={13} />
                  <span>Enviar no WhatsApp</span>
                </Button>

                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleCopiarLink}
                  className="h-8 text-[11px] px-2.5 font-bold bg-graphite-800 hover:bg-graphite-700 text-vapor-200 border-graphite-700 shrink-0"
                  title="Copiar Link"
                >
                  <Copy size={13} />
                  <span>Copiar Link</span>
                </Button>
              </div>
            </div>

            {/* Bloco de Assinatura Manual (2 Vias Físicas) */}
            <div className="p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-xl flex items-center justify-between gap-3 flex-wrap">
              <div className="flex flex-col">
                <span className="font-sans text-[12px] font-bold text-cyan-400 flex items-center gap-1.5">
                  <Printer size={15} />
                  Assinatura Física / Manual (2 Vias)
                </span>
                <span className="font-sans text-[11px] text-vapor-400">
                  Imprime o termo com fotos em 2 cópias (1ª Via Oficina / 2ª Via Cliente) para assinar no papel.
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => handleGerarPDFTermoManual('print')}
                  disabled={gerandoPDFTermo}
                  className="h-8 text-[11px] px-3 font-bold bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 shrink-0 flex items-center gap-1.5"
                  title="Imprimir 2 vias do termo avulso"
                >
                  <Printer size={13} />
                  <span>{gerandoPDFTermo ? 'Gerando...' : 'Imprimir 2 Vias'}</span>
                </Button>

                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => handleGerarPDFTermoManual('download')}
                  disabled={gerandoPDFTermo}
                  className="h-8 text-[11px] px-2.5 font-bold bg-graphite-800 hover:bg-graphite-700 text-vapor-200 border-graphite-700 shrink-0"
                  title="Baixar PDF das 2 vias"
                >
                  <Download size={13} />
                  <span>PDF</span>
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Rodapé do Modal */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-graphite-800">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={saving}
            className="text-[12px]"
          >
            Cancelar
          </Button>

          <Button
            type="button"
            variant="primary"
            onClick={() => handleSalvar(true)}
            disabled={saving}
            className="text-[12px] font-bold bg-amber-500 hover:bg-amber-400 text-graphite-950"
          >
            {saving ? 'Gravando...' : 'Salvar no Atendimento'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
