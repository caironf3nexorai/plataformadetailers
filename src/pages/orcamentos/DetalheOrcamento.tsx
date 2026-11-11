import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { ModalConfirmacao } from '../../components/ui/ModalConfirmacao';
import { CampoNumerico } from '../../components/ui/CampoNumerico';
import {
  ArrowLeft,
  Send,
  Sparkles,
  Calendar,
  Clock,
  Check,
  Star,
  ExternalLink,
  Save,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  PenTool,
  Tag,
  Trash2,
  Percent,
  FileText,
  Camera,
  Printer,
  ShieldCheck,
  FileDown,
  PlusCircle,
  Download,
  RotateCcw,
  Pencil,
  UserCheck,
  Lock,
  RefreshCw,
  Edit3,
  Scale,
  Plus,
  Search,
  X,
  Eye,
  Info,
} from 'lucide-react';
import { usePlano } from '../../hooks/usePlano';
import { ModalEditarVeiculo } from '../../components/clientes/ModalEditarVeiculo';
import { ModalAlterarClienteOrcamento } from '../../components/orcamentos/ModalAlterarClienteOrcamento';
import type { Orcamento, TipoNivelOrcamento } from '../../types/orcamento';
import type { Servico } from '../../types/servicos';
import {
  type TermoGarantia,
  TERMO_RESPONSABILIDADE_PADRAO,
  TERMO_GARANTIA_PADRAO_ADVOGADO,
  TERMO_CIENCIA_RISCO_PADRAO_ADVOGADO,
  MODELOS_TERMOS_PLATAFORMA_PADRAO,
  type ServicoParaTermo,
  type DadosPreenchimentoTermo,
  preencherVariaveisTermo,
  gerarTermoDinamicoServicos,
  obterClausulasDetectadas,
  mesclarClausulasComTextoExistente,
} from '../../types/termos';
import {
  getLabelFromStatusOrcamento,
  getBadgeToneFromStatusOrcamento,
  isNomeClienteValido,
  obterNomeClienteOrcamento,
  obterPrimeiroNomeClienteOrcamento,
  resolverAgendamentoVinculadoOrcamento,
} from '../../utils/orcamento';
import { formatarCodigoProposta, formatarMoeda } from '../../utils/formatters';
import { formatarDuracao, getLabelFromStatus, obterLinkAgendaAgendamento } from '../../utils/agenda';
import { gerarPDFOrcamento, type PDFOrcamentoNivelData } from '../../utils/pdfOrcamento';
import { getFotoPublicUrl } from '../../utils/imagens';
import { uploadOrcamentoFoto, getEvidenciaSignedUrl, baixarFoto } from '../../utils/evidencias';
import { formatarDataHora } from '../../utils/datas';
import { obterLinkAtendimento } from '../../utils/navegacaoAtendimento';
import { CanvasAssinatura } from '../../components/checkin/CanvasAssinatura';
import { ModalServicoRapido } from '../../components/orcamentos/ModalServicoRapido';

interface ServicoComPrecoDuracao extends Servico {
  precoMatriz: number;
  duracaoMatriz: number;
  temPrecoCadastrado: boolean;
  duracaoConfirmada: boolean;
}

interface ServicoAvulsoItem {
  uid: string;
  nome: string;
  preco: number;
  duracao_minutos: number;
}

const formatarHorasInput = (minutos: number): string => {
  const h = Math.round(((Number(minutos) || 0) / 60) * 100) / 100;
  return h > 0 ? String(h) : '1';
};

const InputHorasAvulso: React.FC<{
  duracaoMinutos: number;
  onCommitMinutos: (mins: number) => void;
}> = ({ duracaoMinutos, onCommitMinutos }) => {
  const [focused, setFocused] = useState(false);
  const [texto, setTexto] = useState(() => formatarHorasInput(duracaoMinutos));

  useEffect(() => {
    if (!focused) {
      setTexto(formatarHorasInput(duracaoMinutos));
    }
  }, [duracaoMinutos, focused]);

  return (
    <div
      className="flex items-center gap-1 text-vapor-300"
      title={`Equivale a ${formatarDuracao(duracaoMinutos)}`}
    >
      <Clock size={11} className="text-cyan-400 shrink-0" />
      <input
        type="text"
        inputMode="decimal"
        value={texto}
        onFocus={() => setFocused(true)}
        onChange={(e) => {
          const val = e.target.value;
          if (!/^\d*([.,]\d*)?$/.test(val.trim())) return;
          setTexto(val);
          const num = parseFloat(val.replace(',', '.'));
          if (!isNaN(num) && num > 0) {
            const mins = Math.max(5, Math.round(num * 60));
            onCommitMinutos(mins);
          }
        }}
        onBlur={() => {
          setFocused(false);
          const num = parseFloat(texto.replace(',', '.'));
          const mins =
            !isNaN(num) && num > 0
              ? Math.max(5, Math.round(num * 60))
              : Math.max(5, duracaoMinutos || 60);
          onCommitMinutos(mins);
          setTexto(formatarHorasInput(mins));
        }}
        className="w-12 bg-graphite-950/80 border border-cyan-500/30 rounded px-1.5 py-0.5 text-center text-vapor-100 font-mono text-[11px] outline-none focus:border-cyan-400"
      />
      <span className="text-vapor-400 text-[10px]">h</span>
    </div>
  );
};

const normalizarTextoBusca = (texto: string): string =>
  (texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

export const DetalheOrcamento: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { tenant, membership } = useAuth();
  const { showSuccess, showError, showToast } = useToast();
  const { temFeature, nomePlano } = usePlano();
  const temTresNiveis = temFeature('orcamentos_tres_niveis');

  const canManageDiscount = membership?.role === 'dono' || membership?.role === 'gerente';

  const [orcamento, setOrcamento] = useState<Orcamento | null>(null);
  const [servicosCatalogo, setServicosCatalogo] = useState<ServicoComPrecoDuracao[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [saveStatus, setSaveStatus] = useState<'salvo' | 'salvando' | 'erro'>('salvo');

  // Modal de Cupom / Desconto
  const [showDescontoModal, setShowDescontoModal] = useState<boolean>(false);
  const [descontoTipo, setDescontoTipo] = useState<'porcentagem' | 'valor_fixo'>('porcentagem');
  const [descontoValor, setDescontoValor] = useState<string>('');
  const [descontoCupom, setDescontoCupom] = useState<string>('');
  const [descontoMotivo, setDescontoMotivo] = useState<string>('');
  const [applyingDesconto, setApplyingDesconto] = useState<boolean>(false);

  // Modal de Edição de Veículo / Cor
  const [showModalEditarVeiculo, setShowModalEditarVeiculo] = useState<boolean>(false);

  // Modal de Exclusão de Orçamento
  const [showConfirmExcluir, setShowConfirmExcluir] = useState<boolean>(false);
  const [excluindoOrcamento, setExcluindoOrcamento] = useState<boolean>(false);

  // Modal de Troca / Preenchimento de Cliente / Veículo
  const [showModalTrocarCliente, setShowModalTrocarCliente] = useState<boolean>(false);
  const [modoModalTrocarCliente, setModoModalTrocarCliente] = useState<'selecionar' | 'cadastrar' | 'editar'>('selecionar');
  const [abrirAgendaAposCliente, setAbrirAgendaAposCliente] = useState<boolean>(false);

  const handleExcluirOrcamento = async () => {
    if (!orcamento) return;
    setExcluindoOrcamento(true);
    try {
      const { error } = await supabase.rpc('excluir_orcamento', {
        p_orcamento_id: orcamento.id,
      });

      if (error) {
        const { error: delErr } = await supabase
          .from('orcamentos')
          .delete()
          .eq('id', orcamento.id);
        if (delErr) throw delErr;
      }

      showSuccess(`Orçamento ${formatarCodigoProposta(orcamento)} excluído com sucesso!`);
      navigate('/orcamentos');
    } catch (err: any) {
      showError(err.message || 'Erro ao excluir orçamento.', err);
    } finally {
      setExcluindoOrcamento(false);
    }
  };

  // Ref para controlar hidratação inicial e evitar autosave no boot
  const isLoadedRef = useRef<boolean>(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Níveis de Estado Local
  const [titulosNiveis, setTitulosNiveis] = useState<Record<TipoNivelOrcamento, string>>({
    essencial: 'Essencial',
    recomendado: 'Recomendado',
    completo: 'Completo',
  });

  const [descricoesNiveis, setDescricoesNiveis] = useState<Record<TipoNivelOrcamento, string>>({
    essencial: 'Serviço principal solicitado',
    recomendado: 'Manutenção recomendada com proteção',
    completo: 'Proteção total com higienização',
  });

  // Itens Selecionados por Nível (Map de servico_id -> boolean)
  const [itensNivel, setItensNivel] = useState<Record<TipoNivelOrcamento, Set<string>>>({
    essencial: new Set(),
    recomendado: new Set(),
    completo: new Set(),
  });

  // Preços Personalizados por Item de Nível (key: `${nivel}_${servicoId}` -> number)
  const [customPrecos, setCustomPrecos] = useState<Record<string, number>>({});

  // Serviços Únicos (avulsos, não salvos no catálogo de Serviços) por Nível
  const [servicosAvulsosNivel, setServicosAvulsosNivel] = useState<Record<TipoNivelOrcamento, ServicoAvulsoItem[]>>({
    essencial: [],
    recomendado: [],
    completo: [],
  });
  const servicosAvulsosRef = useRef(servicosAvulsosNivel);
  servicosAvulsosRef.current = servicosAvulsosNivel;

  // Pesquisa rápida na seleção de serviços
  const [buscaServico, setBuscaServico] = useState<string>('');
  const [avisoPrecoSugeridoFechado, setAvisoPrecoSugeridoFechado] = useState<boolean>(false);

  // Modal de Serviço Único (avulso)
  const [showModalServicoUnico, setShowModalServicoUnico] = useState<boolean>(false);
  const [suNome, setSuNome] = useState<string>('');
  const [suValor, setSuValor] = useState<string>('');
  const [suDuracao, setSuDuracao] = useState<string>('1');
  const [suNiveisDestino, setSuNiveisDestino] = useState<Record<TipoNivelOrcamento, boolean>>({
    essencial: false,
    recomendado: true,
    completo: true,
  });

  // Observações e Termos Personalizados do Orçamento
  const [observacoes, setObservacoes] = useState<string>('');

  // Estado dos Grupos de Serviços Expandidos/Recolhidos
  const [gruposExpandidos, setGruposExpandidos] = useState<Record<string, boolean>>({});

  const toggleGrupoExpandido = (grupo: string) => {
    setGruposExpandidos((prev) => ({
      ...prev,
      [grupo]: prev[grupo] === undefined ? false : !prev[grupo],
    }));
  };

  // Mobile Tab active & Drawer State (< 1280px)
  const [activeTabMobile, setActiveTabMobile] = useState<TipoNivelOrcamento>('recomendado');
  const [expandComparacaoMobile, setExpandComparacaoMobile] = useState<boolean>(false);

  // Modal Agendamento
  const [showAgendarModal, setShowAgendarModal] = useState<boolean>(false);
  const [dataAgendamento, setDataAgendamento] = useState<string>('');
  const [horaAgendamento, setHoraAgendamento] = useState<string>('09:00');
  const [converting, setConverting] = useState<boolean>(false);
  const [showConfirmAceiteManual, setShowConfirmAceiteManual] = useState<boolean>(false);

  // Modal Confirmação de Saída com alteração pendente
  const [showVoltarModal, setShowVoltarModal] = useState<boolean>(false);

  // Link público gerado
  const [linkPublico, setLinkPublico] = useState<string>('');

  // Fotos de Avaliação do Veículo (Registro Imutável com Suporte a Antes e Depois)
  interface FotoOrcamentoItem {
    id: string;
    url: string;
    path?: string;
    tipo?: 'antes' | 'depois';
    descricao?: string;
    created_at: string;
  }
  const [fotosAvaliacao, setFotosAvaliacao] = useState<FotoOrcamentoItem[]>([]);
  const [uploadingFoto, setUploadingFoto] = useState<boolean>(false);
  const [momentoFotoUpload, setMomentoFotoUpload] = useState<'antes' | 'depois'>('antes');
  const [filtroMomentoFoto, setFiltroMomentoFoto] = useState<'todas' | 'antes' | 'depois'>('todas');
  const fileInputFotoRef = useRef<HTMLInputElement>(null);

  // Checks de Inclusão no Orçamento / PDF / Link Público (desmarcados por padrão)
  const [incluirFotos, setIncluirFotos] = useState<boolean>(false);
  const [incluirTermoResponsabilidade, setIncluirTermoResponsabilidade] = useState<boolean>(false);
  const [incluirTermoGarantia, setIncluirTermoGarantia] = useState<boolean>(false);
  const [expandidoTermosFotos, setExpandidoTermosFotos] = useState<boolean>(false);
  const [garantiaMeses, setGarantiaMeses] = useState<number>(3);
  const [incluirTermoRisco, setIncluirTermoRisco] = useState<boolean>(false);
  const [termoRiscoServico, setTermoRiscoServico] = useState<string>('');
  const [termoRiscoObservacoes, setTermoRiscoObservacoes] = useState<string>('');

  const incluirFotosRef = useRef(incluirFotos);
  incluirFotosRef.current = incluirFotos;
  const incluirTermoRespRef = useRef(incluirTermoResponsabilidade);
  incluirTermoRespRef.current = incluirTermoResponsabilidade;
  const incluirTermoGarantiaRef = useRef(incluirTermoGarantia);
  incluirTermoGarantiaRef.current = incluirTermoGarantia;
  const incluirTermoRiscoRef = useRef(incluirTermoRisco);
  incluirTermoRiscoRef.current = incluirTermoRisco;

  // Termos de Garantia, Responsabilidade e Validade
  const [termosDisponiveis, setTermosDisponiveis] = useState<TermoGarantia[]>([]);
  const [termoGarantiaSelecionado, setTermoGarantiaSelecionado] = useState<string>('');
  const [termoResponsabilidade, setTermoResponsabilidade] = useState<string>('');
  const termoResponsabilidadeRef = useRef<string>('');
  termoResponsabilidadeRef.current = termoResponsabilidade;
  const [modoTermoResp, setModoTermoResp] = useState<'dinamico' | 'fixo_loja' | 'personalizado'>('dinamico');
  const [termoRespSelecionadoId, setTermoRespSelecionadoId] = useState<string>('dinamico');
  const [editandoTermoResp, setEditandoTermoResp] = useState<boolean>(false);
  const [validadeDiasOrcamento, setValidadeDiasOrcamento] = useState<number>(7);
  const [veiculoKm, setVeiculoKm] = useState<number | null>(null);

  const servicosAtivosRef = useRef<ServicoParaTermo[]>([]);
  const dadosTermoRef = useRef<DadosPreenchimentoTermo | null>(null);
  const termoGarantiaSelecionadoRef = useRef(termoGarantiaSelecionado);
  termoGarantiaSelecionadoRef.current = termoGarantiaSelecionado;
  const garantiaMesesRef = useRef(garantiaMeses);
  garantiaMesesRef.current = garantiaMeses;
  const modoTermoRespRef = useRef(modoTermoResp);
  modoTermoRespRef.current = modoTermoResp;
  const termoRespSelecionadoIdRef = useRef(termoRespSelecionadoId);
  termoRespSelecionadoIdRef.current = termoRespSelecionadoId;

  // Termos de responsabilidade ativos disponíveis para a oficina selecionar
  // Termos de responsabilidade ativos disponíveis para a oficina selecionar
  const termosResponsabilidadeDisponiveis = useMemo(() => {
    const daOficina = termosDisponiveis.filter((t) => 
      t.categoria === 'responsabilidade' || 
      t.tipo === 'responsabilidade' ||
      (t.titulo && t.titulo.toLowerCase().includes('responsabilidade')) ||
      (t.titulo && t.titulo.toLowerCase().includes('veículos antigos'))
    );

    // Complementa com modelos padrão de responsabilidade da plataforma (minuta advogado CDC, veículos antigos, pátio, etc.)
    const titulosOficina = new Set(daOficina.map((t) => t.titulo.toLowerCase().trim()));
    const complementares = MODELOS_TERMOS_PLATAFORMA_PADRAO
      .filter((m) => 
        m.categoria === 'responsabilidade' && 
        !titulosOficina.has(m.titulo.toLowerCase().trim())
      )
      .map((m) => ({
        id: `plataforma_${m.id}`,
        tenant_id: tenant?.id || '',
        tipo: m.tipo_servico || 'geral',
        categoria: 'responsabilidade' as const,
        titulo: m.titulo,
        conteudo: m.conteudo_texto,
        padrao: false,
        ativo: true,
      }));

    return [...daOficina, ...complementares];
  }, [termosDisponiveis, tenant?.id]);

  // Termos de garantia disponíveis para a oficina selecionar no dropdown
  const termosGarantiaDisponiveis = useMemo(() => {
    const daOficina = termosDisponiveis.filter((t) => 
      t.categoria !== 'responsabilidade' && 
      t.tipo !== 'responsabilidade' &&
      !(t.titulo && t.titulo.toLowerCase().includes('responsabilidade')) &&
      !(t.titulo && t.titulo.toLowerCase().includes('veículos antigos'))
    );

    // Complementa com modelos padrão da biblioteca da plataforma (incluindo minuta oficial do advogado CDC e garantias por serviço)
    const titulosOficina = new Set(daOficina.map((t) => t.titulo.toLowerCase().trim()));
    const complementares = MODELOS_TERMOS_PLATAFORMA_PADRAO
      .filter((m) => 
        m.categoria === 'garantia' && 
        !titulosOficina.has(m.titulo.toLowerCase().trim())
      )
      .map((m) => ({
        id: `plataforma_${m.id}`,
        tenant_id: tenant?.id || '',
        tipo: m.tipo_servico || 'geral',
        categoria: 'garantia' as const,
        titulo: m.titulo,
        conteudo: m.conteudo_texto,
        padrao: false,
        ativo: true,
      }));

    return [...daOficina, ...complementares];
  }, [termosDisponiveis, tenant?.id]);

  // Termo de garantia atualmente selecionado
  const termoGarantiaAtual = useMemo(() => {
    if (!termoGarantiaSelecionado) return null;
    return termosGarantiaDisponiveis.find(
      (t) => t.id === termoGarantiaSelecionado || `plataforma_${t.id}` === termoGarantiaSelecionado
    ) || null;
  }, [termoGarantiaSelecionado, termosGarantiaDisponiveis]);

  // Texto formatado de preview da garantia com substituição de variáveis
  const textoPreviewGarantia = useMemo(() => {
    const prazoTexto = `${garantiaMeses} ${garantiaMeses === 1 ? 'mês' : 'meses'}`;
    const nomeEmpresa = tenant?.razao_social || tenant?.nome || 'nossa oficina';
    const orcData = orcamento as any;
    const veicModelo = orcData?.veiculo?.modelo;
    const veicPlaca = orcData?.veiculo?.placa;
    const veicIdent = veicModelo
      ? `${veicModelo}${veicPlaca ? ` (${veicPlaca})` : ''}`
      : (veicPlaca || orcData?.veiculo_descricao_avulsa || undefined);

    const dadosSubst = {
      nomeEmpresa,
      prazoGarantia: prazoTexto,
      clienteNome: obterNomeClienteOrcamento(orcData, '') || undefined,
      veiculoPlaca: veicIdent,
    };

    const textoBase = termoGarantiaAtual?.conteudo || TERMO_GARANTIA_PADRAO_ADVOGADO;
    return preencherVariaveisTermo(textoBase, dadosSubst);
  }, [
    termoGarantiaAtual,
    garantiaMeses,
    tenant?.razao_social,
    tenant?.nome,
    (orcamento as any)?.cliente?.nome,
    (orcamento as any)?.cliente_nome_avulso,
    (orcamento as any)?.assinatura_nome,
    (orcamento as any)?.veiculo?.modelo,
    (orcamento as any)?.veiculo?.placa,
    (orcamento as any)?.veiculo_descricao_avulsa,
  ]);

  // Modal de Novo Serviço Rápido
  const [showModalServicoRapido, setShowModalServicoRapido] = useState<boolean>(false);

  // Modal de Assinaturas Presenciais (Cliente e Operador)
  const [showAssinaturaModal, setShowAssinaturaModal] = useState<boolean>(false);
  const [assinandoTipo, setAssinandoTipo] = useState<'cliente' | 'usuario'>('cliente');
  const [nomeSignatario, setNomeSignatario] = useState<string>('');
  const [savingAssinatura, setSavingAssinatura] = useState<boolean>(false);
  const [assinaturaClienteUrl, setAssinaturaClienteUrl] = useState<string>('');
  const [assinaturaOficinaUrl, setAssinaturaOficinaUrl] = useState<string>('');
  const [recriarAssinaturaCliente, setRecriarAssinaturaCliente] = useState<boolean>(false);
  const [recriarAssinaturaOficina, setRecriarAssinaturaOficina] = useState<boolean>(false);

  // Aceite Manual do Orçamento Impresso
  const [aceitandoManual, setAceitandoManual] = useState<boolean>(false);

  const fetchOrcamentoEDados = async (): Promise<Orcamento | null> => {
    if (!id || !tenant) return null;
    if (!orcamento) {
      setLoading(true);
    }

    try {
      // 1. Busca Orçamento com Joins dos Níveis e seus Itens do Banco
      const { data: quoteData, error: quoteError } = await supabase
        .from('orcamentos')
        .select(`
          *,
          cliente:clientes(id, nome, telefone, email, documento),
          veiculo:veiculos(id, placa, modelo, marca, cor, ano),
          categoria:categorias_veiculo(id, nome),
          agendamento:agendamentos(id, inicio, status, numero_os),
          niveis:orcamento_niveis(
            *,
            itens:orcamento_nivel_itens(
              *,
              servico:servicos(*)
            )
          )
        `)
        .eq('id', id)
        .eq('tenant_id', tenant.id)
        .single();

      if (quoteError || !quoteData) {
        showError('Orçamento não encontrado.');
        navigate('/orcamentos');
        return null;
      }

      if (quoteData?.agendamento_id) {
        try {
          const { data: ck } = await supabase
            .from('checkins')
            .select('km')
            .eq('agendamento_id', quoteData.agendamento_id)
            .maybeSingle();
          if (ck?.km) {
            setVeiculoKm(ck.km);
          }
        } catch (e) {
          console.error('[DetalheOrcamento] Erro ao buscar km do checkin:', e);
        }
      }

      const quote = quoteData as Orcamento;
      setOrcamento(quote);

      if (quote.token_publico) {
        setLinkPublico(`${window.location.origin}/orcamento/${quote.token_publico}`);
      }

      setObservacoes(quote.observacoes || '');
      setValidadeDiasOrcamento(quote.validade_dias || 7);
      setIncluirFotos(Boolean((quote as any).incluir_fotos));
      const baseTermos = Boolean((quote as any).incluir_termos);
      const flagResp = (quote as any).incluir_termo_responsabilidade;
      const flagGarantia = (quote as any).incluir_termo_garantia;
      setIncluirTermoResponsabilidade(flagResp !== null && flagResp !== undefined ? Boolean(flagResp) : baseTermos);
      setIncluirTermoGarantia(flagGarantia !== null && flagGarantia !== undefined ? Boolean(flagGarantia) : baseTermos);
      setTermoGarantiaSelecionado((quote as any).termo_garantia_id || '');
      setGarantiaMeses((quote as any).garantia_meses ?? 3);
      setIncluirTermoRisco(Boolean((quote as any).incluir_termo_risco));
      setTermoRiscoServico((quote as any).termo_risco_servico || '');
      setTermoRiscoObservacoes((quote as any).termo_risco_observacoes || '');


      // Carrega URLs assinadas das assinaturas existentes de forma independente
      if (quote.assinatura_path) {
        getEvidenciaSignedUrl(quote.assinatura_path).then((url) => {
          if (url) setAssinaturaClienteUrl(url);
        });
      } else {
        setAssinaturaClienteUrl('');
      }

      if ((quote as any).assinatura_usuario_path) {
        getEvidenciaSignedUrl((quote as any).assinatura_usuario_path).then((url) => {
          if (url) setAssinaturaOficinaUrl(url);
        });
      } else {
        setAssinaturaOficinaUrl('');
      }

      // Carrega fotos de avaliação
      const { data: fotosData } = await supabase
        .from('orcamento_fotos')
        .select('*')
        .eq('orcamento_id', quote.id)
        .order('created_at', { ascending: true });

      if (fotosData && fotosData.length > 0) {
        const comUrls = await Promise.all(
          fotosData.map(async (ft: any) => {
            const url = await getEvidenciaSignedUrl(ft.path);
            const tipoDetectado: 'antes' | 'depois' = 
              ft.tipo === 'depois' || ft.descricao?.includes('[DEPOIS]') ? 'depois' : 'antes';
            return {
              id: ft.id,
              path: ft.path,
              url: url || '',
              tipo: tipoDetectado,
              descricao: ft.descricao,
              created_at: ft.created_at,
            };
          })
        );
        setFotosAvaliacao(comUrls.filter((f) => Boolean(f.url || f.path)));
      }

      // Carrega termos de garantia do tenant
      const { data: termosData } = await supabase
        .from('termos_garantia')
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('ativo', true);

      if (termosData && termosData.length > 0) {
        setTermosDisponiveis(termosData as TermoGarantia[]);
      } else {
        const salvosLocal = localStorage.getItem(`termos_garantia_${tenant.id}`);
        if (salvosLocal) setTermosDisponiveis(JSON.parse(salvosLocal));
      }

      // Carrega o termo de responsabilidade da proposta (ou prepara para preenchimento dinâmico)
      const termoSalvoNoOrcamento = (quote as any)?.termo_responsabilidade_texto;
      const modoSalvoNoOrcamento = (quote as any)?.modo_termo_responsabilidade;
      const termoRespIdSalvo = (quote as any)?.termo_responsabilidade_id;

      if (termoRespIdSalvo) {
        setTermoRespSelecionadoId(termoRespIdSalvo);
      }

      if (
        modoSalvoNoOrcamento === 'personalizado' &&
        termoSalvoNoOrcamento &&
        termoSalvoNoOrcamento.trim() &&
        termoSalvoNoOrcamento.trim() !== TERMO_RESPONSABILIDADE_PADRAO.trim()
      ) {
        setTermoResponsabilidade(termoSalvoNoOrcamento);
        setModoTermoResp('personalizado');
        if (!termoRespIdSalvo) setTermoRespSelecionadoId('personalizado');
      } else {
        // Por padrão mantém dinâmico, para recalcular instantaneamente quando serviços forem marcados
        setModoTermoResp('dinamico');
        if (!termoRespIdSalvo) setTermoRespSelecionadoId('dinamico');
        if (termoSalvoNoOrcamento && termoSalvoNoOrcamento.trim()) {
          setTermoResponsabilidade(termoSalvoNoOrcamento);
        }
      }

      // Carrega fotos de avaliação do veículo para este orçamento
      let fotosCarregadas: any[] = [];
      try {
        const { data: fotosDb } = await supabase
          .from('orcamento_fotos')
          .select('*')
          .eq('orcamento_id', quote.id)
          .order('created_at', { ascending: true });
        if (fotosDb && fotosDb.length > 0) {
          fotosCarregadas = fotosDb;
        }
      } catch (e) {
        console.warn('[orcamento_fotos select]:', e);
      }

      // Se a tabela não retornou dados, busca diretamente do bucket de evidencias
      if (fotosCarregadas.length === 0) {
        try {
          const { data: storageFiles } = await supabase.storage
            .from('evidencias')
            .list(`${tenant.id}/orcamentos/${quote.id}`);
          if (storageFiles && storageFiles.length > 0) {
            const fotosArquivos = storageFiles.filter((f) => !f.name.startsWith('assinatura_') && !f.name.startsWith('.'));
            fotosCarregadas = fotosArquivos.map((f) => ({
              id: f.id || f.name,
              path: `${tenant.id}/orcamentos/${quote.id}/${f.name}`,
              created_at: f.created_at || new Date().toISOString(),
            }));
          }
        } catch (e) {
          console.warn('[storage list fotos]:', e);
        }
      }

      // Fallback para cache local no navegador
      if (fotosCarregadas.length === 0) {
        const salvosLocal = localStorage.getItem(`orcamento_fotos_${quote.id}`);
        if (salvosLocal) {
          try {
            fotosCarregadas = JSON.parse(salvosLocal);
          } catch {}
        }
      }

      if (fotosCarregadas.length > 0) {
        const fotosComUrl = await Promise.all(
          fotosCarregadas.map(async (ft: any) => {
            const signed = ft.url && ft.url.startsWith('http') ? ft.url : (ft.path ? await getEvidenciaSignedUrl(ft.path) : '');
            const tipoDetectado: 'antes' | 'depois' =
              ft.tipo === 'depois' || ft.descricao?.includes('[DEPOIS]') ? 'depois' : 'antes';
            return {
              id: ft.id,
              path: ft.path,
              url: signed || ft.url || '',
              tipo: tipoDetectado,
              descricao: ft.descricao,
              created_at: ft.created_at || new Date().toISOString(),
            };
          })
        );
        const validas = fotosComUrl.filter((f) => Boolean(f.url || f.path));
        setFotosAvaliacao(validas);
        localStorage.setItem(`orcamento_fotos_${quote.id}`, JSON.stringify(validas));
      }

      // 2. Busca catálogo de serviços e preços (servico_precos) do tenant
      const [resServicos, resServicoPrecos] = await Promise.all([
        supabase.from('servicos').select('*').eq('tenant_id', tenant.id).eq('ativo', true).order('grupo'),
        supabase.from('servico_precos').select('*').eq('tenant_id', tenant.id).eq('ativo', true),
      ]);

      const allPrecos = resServicoPrecos.data || [];

      const gruposIniciais: Record<string, boolean> = {};

      const servicosFormatados: ServicoComPrecoDuracao[] = (resServicos.data || []).map((s: any) => {
        const grupoNome = s.grupo || 'Outros Serviços';
        gruposIniciais[grupoNome] = true; // expande por padrão

        // Filtra todos os preços deste serviço que tenham preco_base > 0
        const precosDoServico = allPrecos.filter(
          (sp: any) => sp.servico_id === s.id && sp.preco_base !== null && sp.preco_base !== undefined && Number(sp.preco_base) > 0
        );

        // Tenta achar o preço para a categoria exata do orçamento; se não houver, pega o primeiro preço válido do serviço
        const matchCategoria = precosDoServico.find((sp: any) => sp.categoria_id === quote.categoria_id);
        const spEscolhido = matchCategoria || precosDoServico[0];

        let precoFinal: number = 0;
        let temPreco = false;

        if (spEscolhido && Number(spEscolhido.preco_base) > 0) {
          precoFinal = Number(spEscolhido.preco_base);
          temPreco = true;
        } else if (s.preco_base !== null && s.preco_base !== undefined && Number(s.preco_base) > 0) {
          precoFinal = Number(s.preco_base);
          temPreco = true;
        } else if (s.preco !== null && s.preco !== undefined && Number(s.preco) > 0) {
          precoFinal = Number(s.preco);
          temPreco = true;
        }

        // Para duração, faz a mesma lógica de preferência pela categoria do orçamento
        const duracoesDoServico = allPrecos.filter(
          (sp: any) => sp.servico_id === s.id && sp.duracao_minutos !== null && sp.duracao_minutos !== undefined && Number(sp.duracao_minutos) > 0
        );
        const matchDuracaoCat = duracoesDoServico.find((sp: any) => sp.categoria_id === quote.categoria_id);
        const spDuracao = matchDuracaoCat || duracoesDoServico[0];
        const dMatriz = spDuracao ? Number(spDuracao.duracao_minutos) : (s.duracao_minutos ?? 60);
        const duracaoConfirmada = spEscolhido ? Boolean(spEscolhido.duracao_confirmada) : true;

        return {
          ...s,
          precoMatriz: precoFinal,
          temPrecoCadastrado: temPreco,
          duracaoMatriz: Number(dMatriz),
          duracaoConfirmada,
        };
      });

      setServicosCatalogo(servicosFormatados);
      setGruposExpandidos(gruposIniciais);

      // 3. Preenche Estados dos Níveis RESTAURANDO O BANCO DE DADOS
      const newTitulos = {
        essencial: 'Essencial',
        recomendado: 'Recomendado',
        completo: 'Completo',
      };
      const newDescricoes = {
        essencial: 'Serviço principal solicitado',
        recomendado: 'Manutenção recomendada com proteção',
        completo: 'Proteção total com higienização',
      };
      const newItens: Record<TipoNivelOrcamento, Set<string>> = {
        essencial: new Set(),
        recomendado: new Set(),
        completo: new Set(),
      };
      const newAvulsos: Record<TipoNivelOrcamento, ServicoAvulsoItem[]> = {
        essencial: [],
        recomendado: [],
        completo: [],
      };

      const initialCustomPrecos: Record<string, number> = {};
      if (quote.niveis) {
        quote.niveis.forEach((n) => {
          if (n.nivel === 'essencial' || n.nivel === 'recomendado' || n.nivel === 'completo') {
            if (n.titulo) newTitulos[n.nivel] = n.titulo;
            if (n.descricao) newDescricoes[n.nivel] = n.descricao;

            if (n.itens) {
              n.itens.forEach((it) => {
                if (it.servico_id) {
                  newItens[n.nivel].add(it.servico_id);
                  if (it.preco !== null && it.preco !== undefined) {
                    initialCustomPrecos[`${n.nivel}_${it.servico_id}`] = Number(it.preco);
                  }
                } else if (!it.combo_id && (it.servico_nome || '').trim()) {
                  newAvulsos[n.nivel].push({
                    uid: it.id || `av_${n.nivel}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                    nome: (it.servico_nome || '').trim(),
                    preco: Number(it.preco ?? 0),
                    duracao_minutos: Number(it.duracao_minutos ?? 60),
                  });
                }
              });
            }
          }
        });
      }

      if ((quote as any)?.modo_orcamento === 'simples') {
        newItens.recomendado = new Set();
        newItens.completo = new Set();
        newAvulsos.recomendado = [];
        newAvulsos.completo = [];
      }

      setTitulosNiveis(newTitulos);
      setDescricoesNiveis(newDescricoes);
      setItensNivel(newItens);
      setServicosAvulsosNivel(newAvulsos);
      setCustomPrecos(initialCustomPrecos);
      setObservacoes(quote.observacoes || '');
      setSaveStatus('salvo');

      // Marca como totalmente carregado para liberar autosave
      setTimeout(() => {
        isLoadedRef.current = true;
      }, 300);

      return quote;
    } catch (err) {
      console.error('[DetalheOrcamento] Erro ao carregar dados:', err);
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    isLoadedRef.current = false;
    fetchOrcamentoEDados();
  }, [id, tenant?.id]);

  // AGRUPAMENTO DE SERVIÇOS POR GRUPO (Lavagem, Polimento, etc.)
  const servicosPorGrupo = useMemo(() => {
    const map = new Map<string, ServicoComPrecoDuracao[]>();
    servicosCatalogo.forEach((serv) => {
      const grupo = serv.grupo || 'Outros Serviços';
      if (!map.has(grupo)) {
        map.set(grupo, []);
      }
      map.get(grupo)!.push(serv);
    });
    return map;
  }, [servicosCatalogo]);

  const termoBuscaNorm = normalizarTextoBusca(buscaServico);

  const servicosPorGrupoFiltrados = useMemo(() => {
    if (!termoBuscaNorm) return servicosPorGrupo;
    const filtered = new Map<string, ServicoComPrecoDuracao[]>();
    servicosPorGrupo.forEach((lista, nomeGrupo) => {
      const grupoBate = normalizarTextoBusca(nomeGrupo).includes(termoBuscaNorm);
      const itensFiltrados = grupoBate
        ? lista
        : lista.filter(
            (s) =>
              normalizarTextoBusca(s.nome).includes(termoBuscaNorm) ||
              normalizarTextoBusca((s as any).codigo || '').includes(termoBuscaNorm)
          );
      if (itensFiltrados.length > 0) {
        filtered.set(nomeGrupo, itensFiltrados);
      }
    });
    return filtered;
  }, [servicosPorGrupo, termoBuscaNorm]);

  const possuiPrecosSugeridosNoCatalogo = useMemo(
    () => servicosCatalogo.some((s) => !s.sob_consulta && s.temPrecoCadastrado && !s.duracaoConfirmada),
    [servicosCatalogo]
  );

  const customPrecosRef = useRef(customPrecos);
  customPrecosRef.current = customPrecos;
  const observacoesRef = useRef(observacoes);
  observacoesRef.current = observacoes;
  const modoOrcamentoRef = useRef<string | null | undefined>((orcamento as any)?.modo_orcamento);
  modoOrcamentoRef.current = (orcamento as any)?.modo_orcamento;

  // PERSISTÊNCIA NO BANCO (FUNÇÃO PRINCIPAL DE SALVAMENTO)
  const executarSalvarNoBanco = useCallback(
    async (
      currentItens: Record<TipoNivelOrcamento, Set<string>>,
      currentTitulos: Record<TipoNivelOrcamento, string>,
      currentDescricoes: Record<TipoNivelOrcamento, string>,
      currentObservacoes?: string,
      currentCustomPrecos?: Record<string, number>,
      currentAvulsos?: Record<TipoNivelOrcamento, ServicoAvulsoItem[]>
    ) => {
      if (!orcamento || !tenant) return;
      setSaveStatus('salvando');

      try {
        const niveisList = orcamento.niveis || [];
        const precosEfetivos = currentCustomPrecos || customPrecosRef.current;
        const avulsosEfetivos = currentAvulsos || servicosAvulsosRef.current;

        const isSimples = (modoOrcamentoRef.current || (orcamento as any)?.modo_orcamento) === 'simples';

        for (const nivelKey of ['essencial', 'recomendado', 'completo'] as TipoNivelOrcamento[]) {
          const nivelRecord = niveisList.find((n) => n.nivel === nivelKey);
          if (nivelRecord) {
            const servicosIds = isSimples && nivelKey !== 'essencial' ? [] : Array.from(currentItens[nivelKey]);
            const avulsosList =
              isSimples && nivelKey !== 'essencial'
                ? []
                : (avulsosEfetivos[nivelKey] || []).filter((av) => av.nome && av.nome.trim().length > 0);

            const payloadItens = [
              ...servicosIds.map((sId) => {
                const cPrice = precosEfetivos[`${nivelKey}_${sId}`];
                const sCatalogo = servicosCatalogo.find((s) => s.id === sId);
                return {
                  servico_id: sId,
                  combo_id: null,
                  servico_nome: null,
                  preco: cPrice !== undefined ? cPrice : null,
                  duracao_minutos: sCatalogo?.duracaoMatriz || 60,
                };
              }),
              ...avulsosList.map((av) => ({
                servico_id: null,
                combo_id: null,
                servico_nome: av.nome.trim(),
                preco: Math.max(0, Number(av.preco || 0)),
                duracao_minutos: Math.max(5, Math.round(Number(av.duracao_minutos || 60))),
              })),
            ];

            const { error } = await supabase.rpc('salvar_nivel_orcamento', {
              p_nivel: nivelRecord.id,
              p_itens: payloadItens,
              p_titulo: isSimples && nivelKey !== 'essencial' ? '' : currentTitulos[nivelKey],
              p_descricao: isSimples && nivelKey !== 'essencial' ? '' : currentDescricoes[nivelKey],
            });

            if (error) throw error;
          }
        }

        // Salvar observações, flags de visualização/termos e termo de responsabilidade do orçamento
        const valObs = currentObservacoes !== undefined ? currentObservacoes : observacoesRef.current;
        const payloadOrc: any = {
          observacoes: valObs.trim() || null,
          updated_at: new Date().toISOString(),
        };
        const dtTermo = dadosTermoRef.current;
        const textoSalvar = (modoTermoRespRef.current === 'dinamico' || !termoResponsabilidadeRef.current || termoResponsabilidadeRef.current.trim() === TERMO_RESPONSABILIDADE_PADRAO.trim())
          ? (dtTermo ? (gerarTermoDinamicoServicos(servicosAtivosRef.current, dtTermo) || termoResponsabilidadeRef.current || termoResponsabilidade || TERMO_RESPONSABILIDADE_PADRAO) : (termoResponsabilidadeRef.current || termoResponsabilidade || TERMO_RESPONSABILIDADE_PADRAO))
          : (termoResponsabilidadeRef.current || termoResponsabilidade);
        if (textoSalvar) {
          payloadOrc.termo_responsabilidade_texto = textoSalvar;
        }
        payloadOrc.modo_termo_responsabilidade = modoTermoRespRef.current;
        if (termoRespSelecionadoIdRef.current && termoRespSelecionadoIdRef.current !== 'dinamico' && termoRespSelecionadoIdRef.current !== 'personalizado') {
          payloadOrc.termo_responsabilidade_id = termoRespSelecionadoIdRef.current;
        } else {
          payloadOrc.termo_responsabilidade_id = null;
        }
        payloadOrc.termo_garantia_id = termoGarantiaSelecionadoRef.current || null;
        payloadOrc.garantia_meses = garantiaMesesRef.current;
        payloadOrc.incluir_fotos = incluirFotosRef.current;
        payloadOrc.incluir_termo_garantia = incluirTermoGarantiaRef.current;
        payloadOrc.incluir_termo_responsabilidade = incluirTermoRespRef.current;
        payloadOrc.incluir_termo_risco = incluirTermoRespRef.current ? incluirTermoRiscoRef.current : false;
        payloadOrc.incluir_termos = incluirTermoGarantiaRef.current || incluirTermoRespRef.current;

        let { error: obsError } = await supabase
          .from('orcamentos')
          .update(payloadOrc)
          .eq('id', orcamento.id);

        if (obsError && (obsError.message?.includes('termo_responsabilidade') || obsError.message?.includes('modo_termo'))) {
          delete payloadOrc.termo_responsabilidade_texto;
          delete payloadOrc.modo_termo_responsabilidade;
          delete payloadOrc.termo_responsabilidade_id;
          const retry = await supabase.from('orcamentos').update(payloadOrc).eq('id', orcamento.id);
          obsError = retry.error;
        }

        if (obsError) throw obsError;

        setSaveStatus('salvo');
      } catch (err: any) {
        console.error('[DetalheOrcamento] Erro no salvamento automático:', err);
        setSaveStatus('erro');
        showError('Não foi possível salvar o orçamento. Tente novamente.', err);
      }
    },
    [orcamento, tenant, servicosCatalogo, termoResponsabilidade, showError]
  );

  // TRIGGER AUTOSAVE COM DEBOUNCE (800ms)
  const triggerAutoSave = useCallback(
    (
      updatedItens: Record<TipoNivelOrcamento, Set<string>>,
      updatedTitulos: Record<TipoNivelOrcamento, string>,
      updatedDescricoes: Record<TipoNivelOrcamento, string>,
      updatedObservacoes?: string,
      updatedCustomPrecos?: Record<string, number>,
      updatedAvulsos?: Record<TipoNivelOrcamento, ServicoAvulsoItem[]>
    ) => {
      if (!isLoadedRef.current) return;

      setSaveStatus('salvando');
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }

      autoSaveTimerRef.current = setTimeout(() => {
        executarSalvarNoBanco(
          updatedItens,
          updatedTitulos,
          updatedDescricoes,
          updatedObservacoes,
          updatedCustomPrecos,
          updatedAvulsos
        );
      }, 800);
    },
    [executarSalvarNoBanco]
  );

  // ATUALIZAR PREÇO ESPECÍFICO DE UM SERVIÇO NO NÍVEL (com autosave)
  const handleAtualizarPrecoItem = (nivel: TipoNivelOrcamento, servicoId: string, novoPreco: number) => {
    const updated = {
      ...customPrecos,
      [`${nivel}_${servicoId}`]: Math.max(0, novoPreco),
    };
    setCustomPrecos(updated);
    triggerAutoSave(itensNivel, titulosNiveis, descricoesNiveis, observacoes, updated, servicosAvulsosNivel);
  };

  // GERENCIAMENTO DE SERVIÇOS ÚNICOS (AVULSOS)
  const abrirModalServicoUnico = (nivelAlvo?: TipoNivelOrcamento, nomeInicial = '') => {
    const isSimples = (orcamento as any)?.modo_orcamento === 'simples';
    setSuNome(nomeInicial);
    setSuValor('');
    setSuDuracao('1');
    if (isSimples || !nivelAlvo) {
      setSuNiveisDestino({
        essencial: true,
        recomendado: !isSimples,
        completo: !isSimples,
      });
    } else if (nivelAlvo === 'essencial') {
      setSuNiveisDestino({ essencial: true, recomendado: true, completo: true });
    } else if (nivelAlvo === 'recomendado') {
      setSuNiveisDestino({ essencial: false, recomendado: true, completo: true });
    } else {
      setSuNiveisDestino({ essencial: false, recomendado: false, completo: true });
    }
    setShowModalServicoUnico(true);
  };

  const handleAdicionarServicoUnico = (e: React.FormEvent) => {
    e.preventDefault();
    const nomeLimpo = suNome.trim();
    const valorNum = parseFloat(suValor.replace(',', '.'));
    const horasNum = parseFloat(suDuracao.replace(',', '.'));

    if (!nomeLimpo) {
      showError('Informe o nome do serviço único.');
      return;
    }
    if (isNaN(valorNum) || valorNum < 0) {
      showError('Informe um valor válido para o serviço.');
      return;
    }
    if (isNaN(horasNum) || horasNum <= 0) {
      showError('Informe um tempo de execução válido em horas (ex: 1 ou 1,5).');
      return;
    }
    const duracaoNum = Math.max(5, Math.round(horasNum * 60));

    const isSimples = (orcamento as any)?.modo_orcamento === 'simples';
    const niveisAlvo: TipoNivelOrcamento[] = isSimples
      ? ['essencial']
      : (['essencial', 'recomendado', 'completo'] as TipoNivelOrcamento[]).filter((k) => suNiveisDestino[k]);

    if (niveisAlvo.length === 0) {
      showError('Selecione pelo menos um nível para adicionar o serviço único.');
      return;
    }

    const updated: Record<TipoNivelOrcamento, ServicoAvulsoItem[]> = {
      essencial: [...servicosAvulsosNivel.essencial],
      recomendado: [...servicosAvulsosNivel.recomendado],
      completo: [...servicosAvulsosNivel.completo],
    };

    const baseId = `av_${Date.now().toString(36)}`;
    niveisAlvo.forEach((nk, idx) => {
      updated[nk].push({
        uid: `${baseId}_${nk}_${idx}`,
        nome: nomeLimpo,
        preco: Math.round(valorNum * 100) / 100,
        duracao_minutos: duracaoNum,
      });
    });

    setServicosAvulsosNivel(updated);
    setShowModalServicoUnico(false);
    triggerAutoSave(itensNivel, titulosNiveis, descricoesNiveis, observacoes, customPrecos, updated);
    showSuccess(`Serviço Único "${nomeLimpo}" adicionado ao orçamento!`);
  };

  const handleAtualizarServicoUnico = (
    nivel: TipoNivelOrcamento,
    uid: string,
    patch: Partial<Pick<ServicoAvulsoItem, 'nome' | 'preco' | 'duracao_minutos'>>
  ) => {
    const updated: Record<TipoNivelOrcamento, ServicoAvulsoItem[]> = {
      ...servicosAvulsosNivel,
      [nivel]: servicosAvulsosNivel[nivel].map((av) =>
        av.uid === uid ? { ...av, ...patch } : av
      ),
    };
    setServicosAvulsosNivel(updated);
    triggerAutoSave(itensNivel, titulosNiveis, descricoesNiveis, observacoes, customPrecos, updated);
  };

  const handleRemoverServicoUnico = (nivel: TipoNivelOrcamento, uid: string) => {
    const updated: Record<TipoNivelOrcamento, ServicoAvulsoItem[]> = {
      ...servicosAvulsosNivel,
      [nivel]: servicosAvulsosNivel[nivel].filter((av) => av.uid !== uid),
    };
    setServicosAvulsosNivel(updated);
    triggerAutoSave(itensNivel, titulosNiveis, descricoesNiveis, observacoes, customPrecos, updated);
  };

  // TOGGLE SERVIÇO COM HERANÇA E DISPARO DE AUTOSAVE
  const handleToggleServico = (nivel: TipoNivelOrcamento, servicoId: string) => {
    const isSimples = (orcamento as any)?.modo_orcamento === 'simples';
    const copy = {
      essencial: new Set(itensNivel.essencial),
      recomendado: new Set(isSimples ? [] : itensNivel.recomendado),
      completo: new Set(isSimples ? [] : itensNivel.completo),
    };

    const isCurrentlyChecked = copy[nivel].has(servicoId);

    if (isCurrentlyChecked) {
      copy[nivel].delete(servicoId);
    } else {
      copy[nivel].add(servicoId);
      if (!isSimples) {
        if (nivel === 'essencial') {
          copy.recomendado.add(servicoId);
          copy.completo.add(servicoId);
        } else if (nivel === 'recomendado') {
          copy.completo.add(servicoId);
        }
      }
    }

    setItensNivel(copy);
    triggerAutoSave(copy, titulosNiveis, descricoesNiveis, observacoes, customPrecos, servicosAvulsosNivel);
  };

  // ATUALIZAR TÍTULO / DESCRIÇÃO COM AUTOSAVE
  const handleAtualizarTitulo = (nivelKey: TipoNivelOrcamento, novoTitulo: string) => {
    const updated = { ...titulosNiveis, [nivelKey]: novoTitulo };
    setTitulosNiveis(updated);
    triggerAutoSave(itensNivel, updated, descricoesNiveis, observacoes, customPrecos, servicosAvulsosNivel);
  };

  const handleAtualizarDescricao = (nivelKey: TipoNivelOrcamento, novaDescricao: string) => {
    const updated = { ...descricoesNiveis, [nivelKey]: novaDescricao };
    setDescricoesNiveis(updated);
    triggerAutoSave(itensNivel, titulosNiveis, updated, observacoes, customPrecos, servicosAvulsosNivel);
  };

  // BOTÃO SUGERIR NÍVEIS AUTOMATICAMENTE
  const handleSugerirNiveis = () => {
    if (itensNivel.essencial.size === 0 && servicosAvulsosNivel.essencial.length === 0) {
      showToast('Selecione ao menos um serviço no nível Essencial antes de sugerir os outros dois.', 'warning');
      return;
    }

    const copy = {
      essencial: new Set(itensNivel.essencial),
      recomendado: new Set(itensNivel.recomendado),
      completo: new Set(itensNivel.completo),
    };

    copy.essencial.forEach((sId) => {
      copy.recomendado.add(sId);
      copy.completo.add(sId);
    });

    servicosCatalogo.forEach((s) => {
      const grupoLower = (s.grupo || '').toLowerCase();
      const nomeLower = (s.nome || '').toLowerCase();

      if (grupoLower.includes('higieniz') || grupoLower.includes('proteç') || nomeLower.includes('cera') || nomeLower.includes('cristaliz')) {
        copy.recomendado.add(s.id);
        copy.completo.add(s.id);
      }

      if (grupoLower.includes('polimento') || grupoLower.includes('vitrific') || nomeLower.includes('vitrific') || nomeLower.includes('descontamina')) {
        copy.completo.add(s.id);
      }
    });

    setItensNivel(copy);
    triggerAutoSave(copy, titulosNiveis, descricoesNiveis, observacoes, customPrecos, servicosAvulsosNivel);
  };

  // CÁLCULOS AO VIVO DOS TOTAIS DE CADA NÍVEL (COM DESCONTO SE ATIVO, PREÇOS EDITADOS E SERVIÇOS ÚNICOS)
  const calcularTotaisNivel = (nivel: TipoNivelOrcamento) => {
    let valorTotal = 0;
    let duracaoTotal = 0;
    let itensSemPrecoCount = 0;

    itensNivel[nivel].forEach((sId) => {
      const serv = servicosCatalogo.find((s) => s.id === sId);
      if (serv) {
        const precoItem = customPrecos[`${nivel}_${sId}`] !== undefined
          ? customPrecos[`${nivel}_${sId}`]
          : serv.precoMatriz;
        valorTotal += precoItem;
        duracaoTotal += serv.duracaoMatriz;
        if (!serv.temPrecoCadastrado && customPrecos[`${nivel}_${sId}`] === undefined) {
          itensSemPrecoCount += 1;
        }
      }
    });

    (servicosAvulsosNivel[nivel] || []).forEach((av) => {
      valorTotal += Number(av.preco || 0);
      duracaoTotal += Number(av.duracao_minutos || 60);
    });

    let valorComDesconto = valorTotal;
    if (orcamento?.desconto_valor && orcamento.desconto_valor > 0 && orcamento.desconto_tipo) {
      if (orcamento.desconto_tipo === 'porcentagem') {
        valorComDesconto = Math.round(valorTotal * (1.0 - (orcamento.desconto_valor / 100.0)) * 100) / 100;
      } else if (orcamento.desconto_tipo === 'valor_fixo') {
        valorComDesconto = Math.max(0, valorTotal - orcamento.desconto_valor);
      }
    }

    return {
      valorTotal,
      valorComDesconto,
      duracaoTotal,
      itensCount: itensNivel[nivel].size + (servicosAvulsosNivel[nivel]?.length || 0),
      itensSemPrecoCount
    };
  };

  const totais = {
    essencial: calcularTotaisNivel('essencial'),
    recomendado: calcularTotaisNivel('recomendado'),
    completo: calcularTotaisNivel('completo'),
  };

  // SALVAR MANUALMENTE (BOTÃO SALVAR)
  const handleSalvarManual = async () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    await executarSalvarNoBanco(
      itensNivel,
      titulosNiveis,
      descricoesNiveis,
      observacoes,
      customPrecos,
      servicosAvulsosNivel
    );
    showSuccess('Orçamento salvo com sucesso!');
  };

  // ENVIAR PARA O CLIENTE E ABRIR WHATSAPP
  const handleEnviarCliente = async () => {
    if (!orcamento) return;

    try {
      await handleSalvarManual();

      const { data: token, error } = await supabase.rpc('enviar_orcamento', {
        p_orcamento: orcamento.id,
      });

      if (error) throw error;

      const link = `${window.location.origin}/orcamento/${token || orcamento.token_publico}`;
      setLinkPublico(link);

      const clienteNome = obterPrimeiroNomeClienteOrcamento(orcamento, 'Cliente');
      const veiculoModelo = orcamento.veiculo?.modelo || (orcamento as any).veiculo_descricao_avulsa || 'seu veículo';
      const isSimples = (orcamento as any)?.modo_orcamento === 'simples';

      const mensagem = isSimples
        ? `Olá ${clienteNome}! Preparei uma proposta especial de serviços para o seu ${veiculoModelo}. Dá uma olhada e me diz se podemos agendar: ${link}`
        : `Olá ${clienteNome}! Preparei três opções especiais de serviços para o seu ${veiculoModelo}. Dá uma olhada e me diz qual prefere: ${link}`;
      const telefoneFormatado = (orcamento.cliente?.telefone || (orcamento as any).cliente_telefone_avulso || '').replace(/\D/g, '');

      const whatsappUrl = telefoneFormatado
        ? `https://api.whatsapp.com/send?phone=55${telefoneFormatado}&text=${encodeURIComponent(mensagem)}`
        : `https://api.whatsapp.com/send?text=${encodeURIComponent(mensagem)}`;

      window.open(whatsappUrl, '_blank');
      await fetchOrcamentoEDados();
    } catch (err: any) {
      showError('Não foi possível enviar o orçamento. Tente novamente.', err);
    }
  };

  // SOLICITAR REASSINATURA DE ALTERAÇÃO DO ORÇAMENTO
  const handleSolicitarReassinatura = async () => {
    if (!orcamento) return;

    try {
      await handleSalvarManual();

      const { error } = await supabase.rpc('solicitar_reassinatura_orcamento', {
        p_orcamento_id: orcamento.id,
        p_motivo: 'Atualização de serviços e valores do orçamento pela oficina',
      });

      if (error) {
        console.warn('[solicitar_reassinatura_orcamento fallback]:', error);
        await supabase
          .from('orcamentos')
          .update({
            status: 'enviado',
            assinatura_path: null,
            assinatura_nome: null,
            assinatura_data: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', orcamento.id);
      }

      const link = `${window.location.origin}/orcamento/${orcamento.token_publico}`;
      setLinkPublico(link);

      const clienteNome = obterPrimeiroNomeClienteOrcamento(orcamento, 'Cliente');
      const veiculoModelo = orcamento.veiculo?.modelo || (orcamento as any).veiculo_descricao_avulsa || 'seu veículo';

      const mensagem = `Olá ${clienteNome}! Atualizamos os detalhes e valores do orçamento do seu ${veiculoModelo}. Por favor, acesse o link a seguir para conferir a alteração e realizar sua assinatura digital de confirmação: ${link}`;
      const telefoneFormatado = (orcamento.cliente?.telefone || (orcamento as any).cliente_telefone_avulso || '').replace(/\D/g, '');

      const whatsappUrl = telefoneFormatado
        ? `https://api.whatsapp.com/send?phone=55${telefoneFormatado}&text=${encodeURIComponent(mensagem)}`
        : `https://api.whatsapp.com/send?text=${encodeURIComponent(mensagem)}`;

      window.open(whatsappUrl, '_blank');
      showSuccess('Link de alteração e assinatura enviado ao cliente!');
      await fetchOrcamentoEDados();
    } catch (err: any) {
      showError('Não foi possível solicitar a assinatura da alteração.', err);
    }
  };

  // APLICAR CUPOM DE DESCONTO
  const handleAplicarDesconto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orcamento || !id) return;

    const val = parseFloat(descontoValor.replace(',', '.'));
    if (isNaN(val) || val <= 0) {
      showError('Informe um valor de desconto válido.');
      return;
    }

    if (descontoTipo === 'porcentagem' && val > 100) {
      showError('O desconto em porcentagem não pode exceder 100%.');
      return;
    }

    setApplyingDesconto(true);
    try {
      const { error } = await supabase.rpc('aplicar_desconto_orcamento', {
        p_orcamento: id,
        p_tipo: descontoTipo,
        p_valor: val,
        p_motivo: descontoMotivo.trim() || null,
        p_cupom_codigo: descontoCupom.trim() || null,
      });

      if (error) throw error;

      showSuccess('Cupom / Desconto aplicado com sucesso!');
      setShowDescontoModal(false);
      await fetchOrcamentoEDados();
    } catch (err: any) {
      showError('Não foi possível aplicar o desconto.', err);
    } finally {
      setApplyingDesconto(false);
    }
  };

  // REMOVER CUPOM DE DESCONTO
  const handleRemoverDesconto = async () => {
    if (!orcamento || !id) return;

    try {
      const { error } = await supabase.rpc('remover_desconto_orcamento', {
        p_orcamento: id,
      });

      if (error) throw error;

      showSuccess('Desconto removido do orçamento.');
      await fetchOrcamentoEDados();
    } catch (err: any) {
      showError('Não foi possível remover o desconto.', err);
    }
  };

  // CONVERTER EM AGENDAMENTO
  const handleConverterAgendamento = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orcamento || !dataAgendamento || !horaAgendamento) return;

    if (resolverAgendamentoVinculadoOrcamento(orcamento)) {
      setShowAgendarModal(false);
      showToast('Este orçamento já possui um agendamento/OS ativo.', 'info');
      return;
    }

    if (!orcamento.cliente_id) {
      setShowAgendarModal(false);
      setAbrirAgendaAposCliente(true);
      showToast('Preencha e vincule o cliente antes de converter em agendamento/OS.', 'warning');
      setModoModalTrocarCliente('cadastrar');
      setShowModalTrocarCliente(true);
      return;
    }

    setConverting(true);
    try {
      const dataHoraIso = `${dataAgendamento}T${horaAgendamento}:00`;

      const { data: novoAgendamentoId, error } = await supabase.rpc('converter_orcamento_em_agendamento', {
        p_orcamento: orcamento.id,
        p_inicio: dataHoraIso,
      });

      if (error) throw error;

      const agendamentoIdCriado = typeof novoAgendamentoId === 'string' && novoAgendamentoId ? novoAgendamentoId : null;
      if (agendamentoIdCriado) {
        setOrcamento((prev) =>
          prev
            ? {
                ...prev,
                agendamento_id: agendamentoIdCriado,
                agendamento: {
                  id: agendamentoIdCriado,
                  inicio: dataHoraIso,
                  status: 'agendado',
                  numero_os: prev.numero_os ?? null,
                },
              }
            : null
        );
      }

      setShowAgendarModal(false);
      showSuccess('Orçamento convertido em agendamento com sucesso!');
      navigate(obterLinkAgendaAgendamento(agendamentoIdCriado, dataHoraIso));
    } catch (err: any) {
      showError('Não foi possível agendar o atendimento. Tente novamente.', err);
    } finally {
      setConverting(false);
    }
  };

  const [gerandoPDF, setGerandoPDF] = useState<boolean>(false);

  const executarNavegacaoVoltar = () => {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      navigate('/orcamentos');
    }
  };

  // BOTÃO VOLTAR COM CONFIRMAÇÃO SE SALVAMENTO ESTIVER EM ANDAMENTO
  const handleVoltar = () => {
    if (saveStatus === 'salvando') {
      setShowVoltarModal(true);
    } else {
      executarNavegacaoVoltar();
    }
  };

  const handleDispararUpload = (momento: 'antes' | 'depois') => {
    setMomentoFotoUpload(momento);
    if (fileInputFotoRef.current) {
      fileInputFotoRef.current.value = '';
      fileInputFotoRef.current.click();
    }
  };

  // UPLOAD DE FOTO DE AVALIAÇÃO COM CARIMBO IMUTÁVEL
  const handleUploadFotoAvaliacao = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !orcamento || !tenant) return;

    setUploadingFoto(true);
    try {
      const { path, capturadaEm } = await uploadOrcamentoFoto(tenant.id, orcamento.id, file, false, orcamento.veiculo?.placa);

      let novaFotoId = `ft_${Date.now()}`;
      try {
        const descMomento = momentoFotoUpload === 'depois' ? '[DEPOIS]' : '[ANTES]';
        const { data: novaFoto } = await supabase
          .from('orcamento_fotos')
          .insert({
            tenant_id: tenant.id,
            orcamento_id: orcamento.id,
            path,
            descricao: descMomento,
            created_at: capturadaEm || new Date().toISOString(),
          })
          .select('*')
          .single();
        if (novaFoto?.id) novaFotoId = novaFoto.id;
      } catch (errDb) {
        console.warn('[orcamento_fotos insert error]:', errDb);
      }

      const signedUrl = await getEvidenciaSignedUrl(path);
      const novaFotoObj: FotoOrcamentoItem = {
        id: novaFotoId,
        path,
        url: signedUrl || '',
        tipo: momentoFotoUpload,
        descricao: momentoFotoUpload === 'depois' ? '[DEPOIS]' : '[ANTES]',
        created_at: capturadaEm || new Date().toISOString(),
      };

      setFotosAvaliacao((prev) => {
        const updated = [...prev, novaFotoObj];
        localStorage.setItem(`orcamento_fotos_${orcamento.id}`, JSON.stringify(updated));
        return updated;
      });
      showSuccess(`Foto (${momentoFotoUpload === 'depois' ? 'Depois' : 'Antes'}) anexada com sucesso!`);
    } catch (err: any) {
      console.error('[Upload Foto Avaliacao Error]:', err);
      showError('Erro ao enviar foto: ' + (err?.message || err));
    } finally {
      setUploadingFoto(false);
      e.target.value = '';
    }
  };

  const handleExcluirFotoAvaliacao = async (fotoId: string) => {
    if (isAprovado) {
      showError('As fotos não podem ser excluídas após a aprovação da proposta comercial.');
      return;
    }
    try {
      await supabase.from('orcamento_fotos').delete().eq('id', fotoId);
    } catch (e: any) {
      console.error('[Excluir Foto Orcamento]:', e);
    }
    setFotosAvaliacao((prev) => {
      const updated = prev.filter((f) => f.id !== fotoId);
      if (orcamento) {
        localStorage.setItem(`orcamento_fotos_${orcamento.id}`, JSON.stringify(updated));
      }
      return updated;
    });
    showSuccess('Foto removida.');
  };

  // ACEITE MANUAL DO ORÇAMENTO IMPRESSO
  const handleDarAceiteManual = () => {
    setShowConfirmAceiteManual(true);
  };

  const executeAceiteManual = async () => {
    setShowConfirmAceiteManual(false);
    if (!orcamento || !tenant) return;

    setAceitandoManual(true);
    try {
      const agora = new Date().toISOString();
      const nivelEscolhido = orcamento.nivel_aprovado || 'recomendado';

      const { error } = await supabase
        .from('orcamentos')
        .update({
          status: 'aprovado',
          nivel_aprovado: nivelEscolhido,
          aceite_manual: true,
          respondido_em: agora,
          updated_at: agora,
        })
        .eq('id', orcamento.id);

      if (error) throw error;
      setOrcamento((prev) => prev ? { ...prev, status: 'aprovado', nivel_aprovado: nivelEscolhido, aceite_manual: true } as any : null);
      showSuccess('Aceite manual registrado com sucesso! Você já pode agendar ou iniciar a OS.');
    } catch (err: any) {
      console.error('[Aceite Manual Error]:', err);
      showError('Erro ao registrar aceite manual: ' + (err?.message || err));
    } finally {
      setAceitandoManual(false);
    }
  };

  // ASSINATURA DIGITAL NA TELA (CLIENTE OU USUÁRIO)
  const handleSalvarAssinaturaCanvas = async (blob: Blob) => {
    if (!orcamento || !tenant) return;
    if (!nomeSignatario.trim()) {
      showError('Informe o nome de quem está assinando.');
      return;
    }

    setSavingAssinatura(true);
    try {
      // Salva cada assinatura em um arquivo distinto com prefixo explícito no bucket
      const tipo = assinandoTipo === 'cliente' ? 'cliente' : 'oficina';
      const { path } = await uploadOrcamentoFoto(
        tenant.id,
        orcamento.id,
        blob,
        true,
        orcamento.veiculo?.placa,
        tipo
      );
      const agora = new Date().toISOString();
      const signedUrl = await getEvidenciaSignedUrl(path);

      if (assinandoTipo === 'cliente') {
        const assinaturaTrim = nomeSignatario.trim();
        const capturarNomeAvulso =
          !orcamento.cliente_id &&
          isNomeClienteValido(assinaturaTrim) &&
          !isNomeClienteValido((orcamento as any).cliente_nome_avulso);

        const updatePayload: any = {
          assinatura_path: path,
          assinatura_nome: assinaturaTrim,
          assinatura_data: agora,
          status: 'aprovado',
          nivel_aprovado: orcamento.nivel_aprovado || 'recomendado',
          updated_at: agora,
        };
        if (capturarNomeAvulso) {
          updatePayload.cliente_nome_avulso = assinaturaTrim;
        }

        await supabase
          .from('orcamentos')
          .update(updatePayload)
          .eq('id', orcamento.id);

        setOrcamento((prev) =>
          prev
            ? {
                ...prev,
                status: 'aprovado',
                nivel_aprovado: prev.nivel_aprovado || 'recomendado',
                assinatura_path: path,
                assinatura_nome: assinaturaTrim,
                assinatura_data: agora,
                ...(capturarNomeAvulso ? { cliente_nome_avulso: assinaturaTrim } : {}),
              } as any
            : null
        );
        if (signedUrl) setAssinaturaClienteUrl(signedUrl);
        setRecriarAssinaturaCliente(false);
        showSuccess('Assinatura do cliente salva e orçamento aprovado!');
      } else {
        await supabase
          .from('orcamentos')
          .update({
            assinatura_usuario_path: path,
            assinatura_usuario_nome: nomeSignatario.trim(),
            assinado_usuario_em: agora,
            updated_at: agora,
          })
          .eq('id', orcamento.id);

        setOrcamento((prev) =>
          prev
            ? {
                ...prev,
                assinatura_usuario_path: path,
                assinatura_usuario_nome: nomeSignatario.trim(),
                assinado_usuario_em: agora,
              } as any
            : null
        );
        if (signedUrl) setAssinaturaOficinaUrl(signedUrl);
        setRecriarAssinaturaOficina(false);
        showSuccess('Assinatura da oficina registrada!');
      }

      setShowAssinaturaModal(false);
      setNomeSignatario('');
    } catch (err: any) {
      console.error('[Salvar Assinatura Error]:', err);
      showError('Erro ao salvar assinatura: ' + (err?.message || err));
    } finally {
      setSavingAssinatura(false);
    }
  };

  // NOVO SERVIÇO CADASTRADO VIA MODAL RÁPIDO
  const handleNovoServicoCadastrado = (novoServico: any) => {
    fetchOrcamentoEDados();
    const nivelAlvo = activeTabMobile || 'recomendado';
    handleToggleServico(nivelAlvo, novoServico.id);
    showSuccess(`Serviço "${novoServico.nome}" criado e selecionado na proposta!`);
  };

  // Lista de serviços constantes neste orçamento para preenchimento ágil
  const servicosDoOrcamento = useMemo(() => {
    const map = new Map<string, { id: string; nome: string; riscos_especificos_padrao?: string }>();
    if (orcamento?.niveis) {
      for (const n of orcamento.niveis) {
        for (const it of (n.itens || [])) {
          const nome = (it as any).servico_nome || it.servico?.nome;
          if (nome && !map.has(nome)) {
            map.set(nome, {
              id: it.servico_id || it.id,
              nome,
              riscos_especificos_padrao: (it.servico as any)?.riscos_especificos_padrao || '',
            });
          }
        }
      }
    }
    Object.values(servicosAvulsosNivel).forEach((arr) => {
      arr.forEach((av) => {
        if (av.nome && !map.has(av.nome)) {
          map.set(av.nome, { id: av.uid, nome: av.nome, riscos_especificos_padrao: '' });
        }
      });
    });
    return Array.from(map.values());
  }, [orcamento, servicosAvulsosNivel]);

  // Lista de serviços atualmente selecionados na proposta (reativo às mudanças nos níveis)
  const servicosAtivosNoOrcamento = useMemo<ServicoParaTermo[]>(() => {
    const isSimples = (orcamento as any)?.modo_orcamento === 'simples';
    const todosIds = new Set<string>(
      isSimples
        ? Array.from(itensNivel.essencial)
        : [
            ...Array.from(itensNivel.essencial),
            ...Array.from(itensNivel.recomendado),
            ...Array.from(itensNivel.completo),
          ]
    );

    const list: ServicoParaTermo[] = [];
    const seen = new Set<string>();

    todosIds.forEach((sId) => {
      const s = servicosCatalogo.find((cat) => cat.id === sId);
      if (s && !seen.has(s.nome.toLowerCase())) {
        seen.add(s.nome.toLowerCase());
        list.push({
          nome: s.nome,
          grupo: s.grupo,
          riscos_especificos_padrao: (s as any).riscos_especificos_padrao || null,
        });
      }
    });

    // Inclui Serviços Únicos (avulsos) ativos
    const avulsosAtivos = isSimples
      ? servicosAvulsosNivel.essencial
      : [
          ...servicosAvulsosNivel.essencial,
          ...servicosAvulsosNivel.recomendado,
          ...servicosAvulsosNivel.completo,
        ];
    avulsosAtivos.forEach((av) => {
      if (av.nome && !seen.has(av.nome.toLowerCase())) {
        seen.add(av.nome.toLowerCase());
        list.push({
          nome: av.nome,
          grupo: 'Serviço Único',
          riscos_especificos_padrao: null,
        });
      }
    });

    // Se houver itens em orcamento.niveis que estão selecionados ou se o catálogo ainda estiver carregando
    if (orcamento?.niveis && servicosCatalogo.length === 0) {
      for (const n of orcamento.niveis) {
        if (isSimples && n.nivel !== 'essencial') continue;
        for (const it of (n.itens || [])) {
          const sId = it.servico_id || (it.servico as any)?.id;
          const isSelected = todosIds.size === 0 || (sId && todosIds.has(sId));
          if (isSelected) {
            const nome = (it as any).servico_nome || it.servico?.nome || (it as any).nome;
            if (nome && !seen.has(nome.toLowerCase())) {
              seen.add(nome.toLowerCase());
              list.push({
                nome,
                grupo: (it.servico as any)?.grupo,
                riscos_especificos_padrao: (it.servico as any)?.riscos_especificos_padrao || null,
              });
            }
          }
        }
      }
    }

    return list;
  }, [itensNivel, servicosAvulsosNivel, servicosCatalogo, orcamento]);
  servicosAtivosRef.current = servicosAtivosNoOrcamento;

  // Dados do cliente, veículo e oficina para preenchimento de variáveis no termo
  const dadosTermo = useMemo<DadosPreenchimentoTermo>(() => {
    const veicStr = orcamento?.veiculo
      ? `${orcamento.veiculo.modelo || 'Veículo'}${orcamento.veiculo.marca ? ` (${orcamento.veiculo.marca})` : ''} - Placa: ${orcamento.veiculo.placa || 'N/I'}`
      : ((orcamento as any)?.veiculo_descricao_avulsa || 'Veículo');
    return {
      nomeEmpresa: tenant?.nome || tenant?.razao_social || 'Oficina Especializada',
      prazoGarantia: `${garantiaMeses} ${garantiaMeses === 1 ? 'mês' : 'meses'}`,
      servicoContratado: servicosAtivosNoOrcamento.map((s) => s.nome).join(', ') || 'Procedimentos Especializados',
      clienteNome: obterNomeClienteOrcamento(orcamento, ''),
      clienteCpf: (orcamento?.cliente as any)?.documento || (orcamento?.cliente as any)?.cpf_cnpj || '',
      veiculoPlaca: veicStr,
      data: new Date().toLocaleDateString('pt-BR'),
    };
  }, [tenant, garantiaMeses, servicosAtivosNoOrcamento, orcamento]);
  dadosTermoRef.current = dadosTermo;

  // Cláusulas técnicas ativas detectadas com base nos serviços selecionados (motor centralizado)
  const clausulasDetectadasInfo = useMemo(() => {
    return obterClausulasDetectadas(servicosAtivosNoOrcamento);
  }, [servicosAtivosNoOrcamento]);

  const clausulasDetectadas = useMemo(() => {
    return clausulasDetectadasInfo.map((c) => c.badgeLabel);
  }, [clausulasDetectadasInfo]);

  // Efeito reativo: Sempre que os serviços mudarem na proposta, se estiver em modo dinâmico, auto-preenche o texto
  useEffect(() => {
    if (modoTermoResp === 'dinamico') {
      const novoTexto = gerarTermoDinamicoServicos(servicosAtivosNoOrcamento, dadosTermo);
      setTermoResponsabilidade(novoTexto);
      termoResponsabilidadeRef.current = novoTexto;
    }
  }, [modoTermoResp, servicosAtivosNoOrcamento, dadosTermo]);

  // ANEXAR CLÁUSULAS DOS SERVIÇOS AO TEXTO ATUAL (Ex: na Minuta do Advogado ou termo de antigos)
  const handleAnexarClausulasServicos = () => {
    const textoMesclado = mesclarClausulasComTextoExistente(termoResponsabilidade, servicosAtivosNoOrcamento);
    if (textoMesclado.trim() === termoResponsabilidade.trim()) {
      showToast('Todas as cláusulas dos serviços selecionados já estão contempladas no texto atual.', 'info');
      return;
    }
    setTermoResponsabilidade(textoMesclado);
    termoResponsabilidadeRef.current = textoMesclado;
    showSuccess('Cláusulas técnicas dos serviços selecionados anexadas ao texto com sucesso!');
  };

  // SELECIONAR MODELO DE RESPONSABILIDADE PARA O ORÇAMENTO / IMPRESSÃO
  const handleSelecionarTermoResp = (idOuModo: string) => {
    setTermoRespSelecionadoId(idOuModo);
    if (idOuModo === 'dinamico') {
      setModoTermoResp('dinamico');
      setEditandoTermoResp(false);
      const txt = gerarTermoDinamicoServicos(servicosAtivosNoOrcamento, dadosTermo);
      setTermoResponsabilidade(txt);
      termoResponsabilidadeRef.current = txt;
      showSuccess('Modo dinâmico ativado: cláusulas automáticas dos serviços vinculadas!');
    } else if (idOuModo === 'personalizado') {
      setModoTermoResp('personalizado');
      setEditandoTermoResp(true);
    } else {
      const termoAchado = termosResponsabilidadeDisponiveis.find((t) => t.id === idOuModo);
      if (termoAchado) {
        setModoTermoResp('personalizado');
        setEditandoTermoResp(false);
        setTermoResponsabilidade(termoAchado.conteudo);
        termoResponsabilidadeRef.current = termoAchado.conteudo;
        showSuccess(`Termo "${termoAchado.titulo}" aplicado neste orçamento e no PDF!`);
      }
    }
  };

  // ALTERAR VALIDADE DO ORÇAMENTO
  const handleAlterarValidade = async (dias: number) => {
    setValidadeDiasOrcamento(dias);
    if (!orcamento) return;
    try {
      await supabase.from('orcamentos').update({ validade_dias: dias }).eq('id', orcamento.id);
      setOrcamento((prev) => prev ? { ...prev, validade_dias: dias } : null);
      showSuccess(`Validade alterada para ${dias} dias.`);
    } catch (e) {
      console.error('[Alterar Validade Error]:', e);
    }
  };

  // ALTERAR MESES DE GARANTIA DO ORÇAMENTO
  const handleAlterarGarantiaMeses = async (meses: number) => {
    setGarantiaMeses(meses);
    if (!orcamento) return;
    try {
      await supabase.from('orcamentos').update({ garantia_meses: meses }).eq('id', orcamento.id);
      setOrcamento((prev) => prev ? { ...prev, garantia_meses: meses } as any : null);
      showSuccess(`Garantia definida para ${meses} ${meses === 1 ? 'mês' : 'meses'}.`);
    } catch (e) {
      console.error('[Alterar Garantia Meses Error]:', e);
    }
  };

  // SELECIONAR MODELO DE GARANTIA DO ORÇAMENTO
  const handleSelecionarTermoGarantia = async (idOuModo: string) => {
    if (!orcamento) return;

    // Se selecionou vazio ou padrão (Minuta Padrão do Advogado)
    if (!idOuModo || idOuModo === 'padrao') {
      setTermoGarantiaSelecionado('');
      try {
        await supabase.from('orcamentos').update({ termo_garantia_id: null }).eq('id', orcamento.id);
        setOrcamento((prev) => prev ? { ...prev, termo_garantia_id: null } as any : null);
        showSuccess('Minuta padrão do advogado selecionada para a garantia.');
      } catch (e) {
        console.error('[Selecionar Minuta Advogado Error]:', e);
      }
      return;
    }

    let idFinal = idOuModo;
    const termoEscolhido = termosGarantiaDisponiveis.find((t) => t.id === idOuModo);

    // Se for um modelo da biblioteca da plataforma selecionado pela primeira vez, cria o registro em termos_garantia para a oficina
    if (idOuModo.startsWith('plataforma_') && termoEscolhido && tenant) {
      try {
        const { data: novoTermo, error: insErr } = await supabase
          .from('termos_garantia')
          .insert({
            tenant_id: tenant.id,
            tipo: termoEscolhido.tipo || 'geral',
            titulo: termoEscolhido.titulo,
            conteudo: termoEscolhido.conteudo,
            categoria: 'garantia',
            padrao: false,
            ativo: true,
          })
          .select()
          .single();

        if (!insErr && novoTermo) {
          idFinal = novoTermo.id;
          setTermosDisponiveis((prev) => [...prev, novoTermo as TermoGarantia]);
        }
      } catch (err) {
        console.warn('[handleSelecionarTermoGarantia] Aviso ao persistir modelo da plataforma:', err);
      }
    }

    setTermoGarantiaSelecionado(idFinal);

    try {
      await supabase.from('orcamentos').update({ termo_garantia_id: idFinal }).eq('id', orcamento.id);
      setOrcamento((prev) => prev ? { ...prev, termo_garantia_id: idFinal } as any : null);
      showSuccess(`Modelo de garantia "${termoEscolhido?.titulo || 'selecionado'}" aplicado!`);
    } catch (e) {
      console.error('[Selecionar Termo Garantia Error]:', e);
    }
  };

  // ATIVAR / DESATIVAR TERMO DE RESPONSABILIDADE & RISCOS
  const handleToggleTermoResponsabilidade = async (ativo: boolean) => {
    setIncluirTermoResponsabilidade(ativo);
    if (ativo) {
      setExpandidoTermosFotos(true);
    } else {
      setIncluirTermoRisco(false);
    }
    if (!orcamento) return;
    try {
      const updatePayload: any = {
        incluir_termo_responsabilidade: ativo,
        incluir_termos: ativo || incluirTermoGarantia,
      };
      if (!ativo) {
        updatePayload.incluir_termo_risco = false;
      }
      await supabase.from('orcamentos').update(updatePayload).eq('id', orcamento.id);
      setOrcamento((prev) => prev ? {
        ...prev,
        ...updatePayload,
      } as any : null);
      showSuccess(ativo ? 'Termo de Responsabilidade & Riscos ativado!' : 'Termo de Responsabilidade & Riscos desativado.');
    } catch (e) {
      console.error('[Toggle Termo Responsabilidade Error]:', e);
    }
  };

  // ATIVAR / DESATIVAR TERMO DE GARANTIA
  const handleToggleTermoGarantia = async (ativo: boolean) => {
    setIncluirTermoGarantia(ativo);
    if (ativo) {
      setExpandidoTermosFotos(true);
    }
    if (!orcamento) return;
    try {
      await supabase.from('orcamentos').update({
        incluir_termo_garantia: ativo,
        incluir_termos: ativo || incluirTermoResponsabilidade,
      }).eq('id', orcamento.id);
      setOrcamento((prev) => prev ? {
        ...prev,
        incluir_termo_garantia: ativo,
        incluir_termos: ativo || incluirTermoResponsabilidade,
      } as any : null);
      showSuccess(ativo ? 'Termo de Garantia ativado!' : 'Termo de Garantia desativado da proposta.');
    } catch (e) {
      console.error('[Toggle Termo Garantia Error]:', e);
    }
  };

  // ATIVAR / DESATIVAR EMISSÃO EM FOLHA SEPARADA NO PDF (CDC)
  const handleToggleTermoRisco = async (ativo: boolean) => {
    setIncluirTermoRisco(ativo);
    let sNome = termoRiscoServico;
    let sRiscos = termoRiscoObservacoes;

    // Se ligou e não tinha serviço selecionado, pré-carrega os serviços do orçamento
    if (ativo && !sNome && servicosDoOrcamento.length > 0) {
      sNome = servicosDoOrcamento.map((s) => s.nome).join(', ');
      setTermoRiscoServico(sNome);
    }

    if (!orcamento) return;
    try {
      await supabase.from('orcamentos').update({
        incluir_termo_risco: ativo,
        termo_risco_servico: sNome || null,
        termo_risco_observacoes: sRiscos || null,
      }).eq('id', orcamento.id);
      setOrcamento((prev) => prev ? {
        ...prev,
        incluir_termo_risco: ativo,
        termo_risco_servico: sNome || null,
        termo_risco_observacoes: sRiscos || null,
      } as any : null);
      showSuccess(ativo ? 'Emissão em Folha Separada no PDF ativada!' : 'Emissão em Folha Separada desativada (será impresso no corpo).');
    } catch (e) {
      console.error('[Toggle Termo Risco Error]:', e);
    }
  };


  // INSERÇÃO RÁPIDA DE RISCO
  const handleInserirRiscoRapido = async (riscoTexto: string) => {
    const atualResp = termoResponsabilidade ? termoResponsabilidade.trim() : '';
    const novoResp = atualResp
      ? `${atualResp}\n• Condição Específica Observada: ${riscoTexto}`
      : `• Condição Específica Observada: ${riscoTexto}`;
    setTermoResponsabilidade(novoResp);
    setModoTermoResp('personalizado');

    const atualRisco = termoRiscoObservacoes ? termoRiscoObservacoes.trim() : '';
    const novoRisco = atualRisco ? `${atualRisco}\n• ${riscoTexto}` : `• ${riscoTexto}`;
    setTermoRiscoObservacoes(novoRisco);

    if (!orcamento) return;
    try {
      await supabase.from('orcamentos').update({ 
        termo_responsabilidade_texto: novoResp,
        termo_risco_observacoes: novoRisco,
      }).eq('id', orcamento.id);
      setOrcamento((prev) => prev ? { 
        ...prev, 
        termo_responsabilidade_texto: novoResp,
        termo_risco_observacoes: novoRisco,
      } as any : null);
      showSuccess(`Risco específico adicionado: "${riscoTexto}"`);
    } catch (e) {
      console.error('[Inserir Risco Rapido Error]:', e);
    }
  };

  // GERAR PDF DO ORÇAMENTO (DOWNLOAD OU IMPRESSÃO DIRETA)
  const handleGerarPDF = async (acao: 'download' | 'print' = 'download') => {
    if (!orcamento || !tenant) return;
    setGerandoPDF(true);
    try {
      const isSimples = (orcamento as any)?.modo_orcamento === 'simples';
      const niveisFiltrados = (orcamento.niveis || []).filter((n) => !isSimples || n.nivel === 'essencial');
      const niveisFormatados: PDFOrcamentoNivelData[] = niveisFiltrados.map((n) => {
        const calc = calcularTotaisNivel(n.nivel);
        const tituloNivel = isSimples
          ? (titulosNiveis['essencial'] && titulosNiveis['essencial'].toLowerCase() !== 'essencial' ? titulosNiveis['essencial'] : 'Proposta de Serviços')
          : (titulosNiveis[n.nivel] || n.titulo || n.nivel);
        const itensCatalogoPdf = Array.from(itensNivel[n.nivel]).map((sId) => {
          const s = servicosCatalogo.find((serv) => serv.id === sId);
          const cPrice = customPrecos[`${n.nivel}_${sId}`];
          const dbNivel = orcamento.niveis?.find((lvl: any) => lvl.nivel === n.nivel);
          const dbItem = dbNivel?.itens?.find((it: any) => it.servico_id === sId);
          const nomeFinal = s?.nome || dbItem?.servico?.nome || (dbItem as any)?.servico_nome || 'Serviço';
          const descFinal = s?.descricao_publica || s?.descricao_interna || dbItem?.servico?.descricao_publica;
          const precoFinal = cPrice !== undefined ? cPrice : (s?.precoMatriz !== undefined ? s.precoMatriz : (dbItem?.preco ? Number(dbItem.preco) : 0));
          const duracaoFinal = s?.duracaoMatriz !== undefined ? s.duracaoMatriz : (dbItem?.duracao_minutos ? Number(dbItem.duracao_minutos) : undefined);

          return {
            servico_nome: nomeFinal,
            servico_descricao: descFinal,
            preco: precoFinal,
            duracao_minutos: duracaoFinal,
          };
        });
        const itensAvulsosPdf = (servicosAvulsosNivel[n.nivel] || []).map((av) => ({
          servico_nome: av.nome,
          servico_descricao: 'Serviço Único (personalizado para esta proposta)',
          preco: av.preco,
          duracao_minutos: av.duracao_minutos,
        }));
        return {
          nivel: n.nivel,
          titulo: tituloNivel,
          descricao: descricoesNiveis[n.nivel] || n.descricao,
          valor_total: calc.valorComDesconto,
          valor_original: calc.valorTotal,
          duracao_total: calc.duracaoTotal,
          destaque: isSimples ? false : n.destaque,
          itens: [...itensCatalogoPdf, ...itensAvulsosPdf],
        };
      });

      const termoEscolhido = termosGarantiaDisponiveis.find((t) => t.id === termoGarantiaSelecionado) || termoGarantiaAtual;

      const diasVal = validadeDiasOrcamento || orcamento.validade_dias || 7;
      const baseDt = orcamento.enviado_em ? new Date(orcamento.enviado_em) : new Date(orcamento.created_at || Date.now());
      baseDt.setDate(baseDt.getDate() + diasVal);
      const dataValidadeLimiteStr = baseDt.toISOString().split('T')[0];

      await gerarPDFOrcamento(
        {
          id: orcamento.id,
          numero: orcamento.numero,
          numero_os: orcamento.numero_os,
          status: orcamento.status,
          modo_orcamento: (orcamento as any)?.modo_orcamento || '3_niveis',
          nivel_aprovado: orcamento.nivel_aprovado,
          enviado_em: orcamento.enviado_em,
          validade_dias: diasVal,
          data_validade_limite: dataValidadeLimiteStr,
          observacoes: observacoes || orcamento.observacoes,
          clienteNome: obterNomeClienteOrcamento(orcamento, 'Não informado'),
          clienteTelefone: orcamento.cliente?.telefone || (orcamento as any).cliente_telefone_avulso || undefined,
          clienteEmail: (orcamento.cliente as any)?.email,
          clienteCpfCnpj: (orcamento.cliente as any)?.documento || (orcamento.cliente as any)?.cpf_cnpj,
          clienteEndereco: (orcamento.cliente as any)?.endereco,
          veiculoModelo: orcamento.veiculo?.modelo || (orcamento as any).veiculo_descricao_avulsa || undefined,
          veiculoMarca: orcamento.veiculo?.marca,
          veiculoPlaca: orcamento.veiculo?.placa,
          veiculoCor: orcamento.veiculo?.cor || null,
          veiculoAno: (orcamento.veiculo as any)?.ano,
          veiculoKm: veiculoKm,
          categoriaNome: orcamento.categoria?.nome,
          oficinaNome: tenant.nome || 'Oficina',
          oficinaRazaoSocial: tenant.razao_social,
          oficinaDocumento: tenant.documento,
          oficinaDocumentoTipo: tenant.documento_tipo as any,
          oficinaTelefone: tenant.telefone,
          oficinaCidadeUF: tenant.cidade ? `${tenant.cidade}/${tenant.uf || ''}` : undefined,
          oficinaLogoUrl: getFotoPublicUrl(tenant.logo_path) || tenant.logo_url,
          assinaturaUrl: (orcamento as any).assinatura_path || (orcamento as any).assinatura_url,
          assinaturaNome: (orcamento as any).assinatura_nome,
          assinaturaData: (orcamento as any).assinatura_data,
          assinaturaUsuarioUrl: (orcamento as any).assinatura_usuario_path || (orcamento as any).assinatura_usuario_url,
          assinaturaUsuarioNome: (orcamento as any).assinatura_usuario_nome || tenant.nome,
          assinadoUsuarioEm: (orcamento as any).assinado_usuario_em,
          incluirFotos,
          fotos: incluirFotos
            ? fotosAvaliacao.map((f) => ({
                url: f.url,
                path: (f as any).path,
                tipo: f.tipo || (f.descricao?.includes('[DEPOIS]') ? 'depois' : 'antes'),
                created_at: f.created_at,
                descricao: f.descricao,
              }))
            : [],
          incluirTermos: incluirTermoResponsabilidade || incluirTermoGarantia,
          incluirTermoResponsabilidade,
          incluirTermoGarantia,
          garantiaMeses,
          incluirTermoRisco: incluirTermoResponsabilidade && incluirTermoRisco,
          termoRiscoServico: incluirTermoResponsabilidade
            ? (termoRiscoServico || servicosAtivosNoOrcamento.map((s) => s.nome).join(', ') || 'Procedimentos Especializados com Risco Técnico')
            : undefined,
          termoRiscoObservacoes: incluirTermoResponsabilidade
            ? (termoRiscoObservacoes?.trim() || termoResponsabilidadeRef.current || termoResponsabilidade)
            : undefined,
          termoResponsabilidade: incluirTermoResponsabilidade
            ? ((modoTermoResp === 'dinamico' || !termoResponsabilidade || termoResponsabilidade.trim() === TERMO_RESPONSABILIDADE_PADRAO.trim())
              ? (gerarTermoDinamicoServicos(servicosAtivosNoOrcamento, dadosTermo) || termoResponsabilidade || TERMO_RESPONSABILIDADE_PADRAO)
              : termoResponsabilidade)
            : undefined,
          termosGarantia: incluirTermoGarantia && termoEscolhido?.conteudo ? textoPreviewGarantia : undefined,
          desconto: orcamento.desconto_valor && orcamento.desconto_tipo ? {
            tipo: orcamento.desconto_tipo,
            valor: orcamento.desconto_valor,
            motivo: orcamento.desconto_motivo,
            cupom_codigo: orcamento.desconto_cupom_codigo,
          } : null,
          niveis: niveisFormatados,
          planoCodigo: tenant.plano,
          pdfCorPrimaria: tenant.pdf_cor_primaria || undefined,
          pdfCorFundoCabecalho: tenant.pdf_cor_fundo_cabecalho || undefined,
          pdfCorTextoCabecalho: tenant.pdf_cor_texto_cabecalho || undefined,
          pdfCorFundoSecoes: tenant.pdf_cor_fundo_secoes || undefined,
          pdfCorTextoSecoes: tenant.pdf_cor_texto_secoes || localStorage.getItem(`tenant_pdf_cor_texto_secoes_${tenant.id}`) || undefined,
          pdfSubtituloCabecalho: tenant.pdf_subtitulo_cabecalho || undefined,
          pdfTextoObservacoesOrcamento: tenant.pdf_texto_observacoes_orcamento || undefined,
          pdfTextoRodape: tenant.pdf_texto_rodape || undefined,
          pdfOcultarMarcaDagua: tenant.pdf_ocultar_marca_dagua || undefined,
        },
        undefined,
        acao
      );
      showSuccess(acao === 'print' ? 'Documento enviado para impressão!' : 'PDF baixado com sucesso!');
    } catch (err: any) {
      showError('Não foi possível gerar o PDF.', err);
    } finally {
      setGerandoPDF(false);
    }
  };

  if (loading || !orcamento) {
    return (
      <div className="flex flex-col gap-4 py-8">
        <div className="h-10 bg-graphite-800 rounded w-1/4 animate-pulse" />
        <div className="h-64 bg-graphite-800 rounded animate-pulse" />
      </div>
    );
  }

  const isAprovado = orcamento.status === 'aprovado';
  const agendamentoAtivo = resolverAgendamentoVinculadoOrcamento(orcamento);
  const temAgendamentoAtivo = Boolean(agendamentoAtivo);

  return (
    <div className="flex flex-col gap-6 pb-52 xl:pb-40 relative max-w-full overflow-x-hidden">
      {/* CABEÇALHO E AÇÕES PRINCIPAIS */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-graphite-800 pb-4">
        <div className="flex items-center gap-3">
          <Button
            tone="graphite"
            size="sm"
            onClick={handleVoltar}
            className="px-2.5 min-h-[44px]"
            title="Voltar para a lista"
          >
            <ArrowLeft size={18} />
          </Button>

          <div className="flex flex-col">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`font-mono text-[14px] font-bold ${orcamento.numero_os ? 'text-cyan-400' : 'text-amber-400'}`}>
                {formatarCodigoProposta(orcamento)}
              </span>
              <Badge tone={getBadgeToneFromStatusOrcamento(orcamento.status)}>
                {getLabelFromStatusOrcamento(orcamento.status)}
              </Badge>

              {/* INDICADOR DISCRETO DE AUTOSAVE NO TOPO */}
              <div className="ml-2">
                {saveStatus === 'salvo' && (
                  <span className="inline-flex items-center gap-1 font-sans text-[12px] text-emerald-400 font-medium bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                    <CheckCircle2 size={13} /> Salvo
                  </span>
                )}
                {saveStatus === 'salvando' && (
                  <span className="inline-flex items-center gap-1 font-sans text-[12px] text-amber-400 font-medium bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                    <Loader2 size={13} className="animate-spin" /> Salvando...
                  </span>
                )}
                {saveStatus === 'erro' && (
                  <span className="inline-flex items-center gap-1 font-sans text-[12px] text-rose-400 font-medium bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
                    <AlertTriangle size={13} /> Erro ao salvar
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="font-display text-[22px] text-vapor-100 uppercase tracking-wide">
                {obterNomeClienteOrcamento(orcamento, 'Cliente não informado')}
              </h1>
              {!orcamento.cliente_id && (
                <Badge tone="amber">Dados parciais</Badge>
              )}
              {!temAgendamentoAtivo && (
                <button
                  type="button"
                  onClick={() => {
                    setAbrirAgendaAposCliente(false);
                    setModoModalTrocarCliente(!orcamento.cliente_id ? 'cadastrar' : 'selecionar');
                    setShowModalTrocarCliente(true);
                  }}
                  className="inline-flex items-center gap-1.5 text-[11px] text-cyan-400 hover:text-cyan-300 font-sans font-bold px-2 py-0.5 rounded bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 transition-colors"
                  title={!orcamento.cliente_id ? 'Preencher ou vincular cliente a este orçamento' : 'Alterar ou editar cliente e veículo deste orçamento'}
                >
                  <UserCheck size={12} />
                  <span>{!orcamento.cliente_id ? 'Preencher / Vincular Cliente' : 'Alterar / Editar Cliente'}</span>
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[13px] text-vapor-400">
                {orcamento.veiculo
                  ? `${orcamento.veiculo.placa} (${orcamento.veiculo.modelo || 'Sem modelo'})${orcamento.veiculo.cor ? ` • Cor: ${orcamento.veiculo.cor}` : ''}`
                  : ((orcamento as any).veiculo_descricao_avulsa || 'Sem veículo')} • {orcamento.categoria?.nome}
                {!orcamento.cliente_id && (orcamento as any).cliente_telefone_avulso ? ` • ${(orcamento as any).cliente_telefone_avulso}` : ''}
              </span>
              {orcamento.veiculo && (
                <button
                  type="button"
                  onClick={() => setShowModalEditarVeiculo(true)}
                  className="inline-flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 font-sans font-medium px-2 py-0.5 rounded bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition-colors"
                  title="Editar dados e cor do veículo"
                >
                  <Pencil size={11} />
                  {orcamento.veiculo.cor ? 'Editar Veículo' : 'Informar Cor'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* BOTOES DE ACAO DO TOPO */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* EXCLUIR ORÇAMENTO */}
          <Button
            tone="rose"
            size="sm"
            onClick={() => setShowConfirmExcluir(true)}
            className="flex items-center gap-1.5 min-h-[44px]"
            title="Excluir este orçamento definitivamente"
          >
            <Trash2 size={16} />
            <span>Excluir</span>
          </Button>
          {canManageDiscount && (
            <Button
              tone={Number(orcamento.desconto_valor) > 0 ? 'amber' : 'graphite'}
              size="sm"
              onClick={() => {
                setDescontoTipo(orcamento.desconto_tipo || 'porcentagem');
                setDescontoValor(orcamento.desconto_valor ? String(orcamento.desconto_valor) : '');
                setDescontoCupom(orcamento.desconto_cupom_codigo || '');
                setDescontoMotivo(orcamento.desconto_motivo || '');
                setShowDescontoModal(true);
              }}
              className="flex items-center gap-1.5 min-h-[44px]"
            >
              <Tag size={16} className="text-amber-400" />
              <span>{Number(orcamento.desconto_valor) > 0 ? 'Desconto Ativo' : 'Cupom / Desconto'}</span>
            </Button>
          )}

          <Button
            tone="graphite"
            size="sm"
            onClick={handleSugerirNiveis}
            className="flex items-center gap-1.5 min-h-[44px]"
          >
            <Sparkles size={16} className="text-amber-400" />
            <span>Sugerir Níveis</span>
          </Button>

          {linkPublico && (
            <Button
              tone="graphite"
              size="sm"
              onClick={() => window.open(linkPublico, '_blank')}
              className="flex items-center gap-1.5 min-h-[44px]"
            >
              <ExternalLink size={16} />
              <span>Ver Proposta Pública</span>
            </Button>
          )}

          {/* IMPRIMIR PROPOSTA (DIRETO) */}
          <Button
            tone="graphite"
            size="sm"
            onClick={() => handleGerarPDF('print')}
            loading={gerandoPDF}
            className="flex items-center gap-1.5 min-h-[44px]"
            title="Imprimir proposta com campo para assinatura física"
          >
            <Printer size={16} className="text-amber-400" />
            <span>Imprimir</span>
          </Button>

          {/* BAIXAR PDF */}
          <Button
            tone="graphite"
            size="sm"
            onClick={() => handleGerarPDF('download')}
            loading={gerandoPDF}
            className="flex items-center gap-1.5 min-h-[44px]"
          >
            <FileDown size={16} className="text-cyan-400" />
            <span>PDF</span>
          </Button>

          {/* ASSINATURA DIGITAL (CLIENTE / OFICINA) */}
          <Button
            tone="graphite"
            size="sm"
            onClick={() => {
              setAssinandoTipo('cliente');
              setNomeSignatario(obterNomeClienteOrcamento(orcamento, ''));
              setShowAssinaturaModal(true);
            }}
            className="flex items-center gap-1.5 min-h-[44px]"
            title="Coletar assinatura digital"
          >
            <PenTool size={16} className="text-amber-400" />
            <span>Assinatura</span>
          </Button>

          {/* ACEITE MANUAL (CASO SEJA IMPRESSO PARA ASSINATURA FÍSICA) */}
          {!isAprovado && (
            <Button
              tone="amber"
              size="sm"
              onClick={handleDarAceiteManual}
              loading={aceitandoManual}
              className="flex items-center gap-1.5 min-h-[44px] font-bold"
              title="Confirmar que o cliente assinou a via impressa física"
            >
              <CheckCircle2 size={16} />
              <span>Dar Aceite Manual</span>
            </Button>
          )}

          <Button
            tone="amber"
            size="sm"
            onClick={handleSalvarManual}
            loading={saveStatus === 'salvando'}
            className="flex items-center gap-1.5 min-h-[44px]"
          >
            <Save size={16} />
            <span>Salvar</span>
          </Button>

          <Button
            tone="emerald"
            size="sm"
            onClick={handleEnviarCliente}
            className="flex items-center gap-1.5 min-h-[44px]"
          >
            <Send size={16} />
            <span>Enviar no WhatsApp</span>
          </Button>

          {isAprovado && (
            <Button
              tone="amber"
              size="sm"
              onClick={handleSolicitarReassinatura}
              className="flex items-center gap-1.5 min-h-[44px]"
            >
              <PenTool size={16} />
              <span>Solicitar Assinatura de Alteração</span>
            </Button>
          )}

          {isAprovado && !temAgendamentoAtivo && (
            <Button
              tone="cyan"
              size="sm"
              onClick={() => {
                if (!orcamento.cliente_id) {
                  setAbrirAgendaAposCliente(true);
                  showToast('Preencha e vincule o cliente antes de converter em agendamento/OS.', 'warning');
                  setModoModalTrocarCliente('cadastrar');
                  setShowModalTrocarCliente(true);
                  return;
                }
                const hoje = new Date().toISOString().split('T')[0];
                setDataAgendamento(hoje);
                setShowAgendarModal(true);
              }}
              className="flex items-center gap-1.5 min-h-[44px]"
            >
              <Calendar size={16} />
              <span>Converter em Agendamento</span>
            </Button>
          )}

          {isAprovado && temAgendamentoAtivo && (
            <Button
              tone="emerald"
              size="sm"
              onClick={() => {
                const link = obterLinkAtendimento(null, agendamentoAtivo?.id || orcamento.agendamento_id);
                navigate(link || '/agenda');
              }}
              className="flex items-center gap-1.5 min-h-[44px]"
            >
              <CheckCircle2 size={16} />
              <span>Ver OS / Atendimento</span>
            </Button>
          )}
        </div>
      </div>

      {/* BANNER DE CUPOM DE DESCONTO ATIVO */}
      {!!orcamento.desconto_valor && Number(orcamento.desconto_valor) > 0 && (
        <Card className="p-3.5 bg-amber-500/10 border-amber-500/30 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/20 rounded-lg text-amber-400 shrink-0">
              <Tag size={18} />
            </div>
            <div className="flex flex-col">
              <span className="font-sans font-bold text-[14px] text-vapor-100">
                Desconto Aplicado no Orçamento: {' '}
                <span className="text-amber-400">
                  {orcamento.desconto_tipo === 'porcentagem'
                    ? `${orcamento.desconto_valor}% OFF`
                    : formatarMoeda(orcamento.desconto_valor)}
                </span>
                {orcamento.desconto_cupom_codigo && (
                  <span className="ml-2 font-mono text-[12px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded border border-amber-500/30">
                    CUPOM: {orcamento.desconto_cupom_codigo}
                  </span>
                )}
              </span>
              {orcamento.desconto_motivo && (
                <span className="font-sans text-[12px] text-vapor-300">
                  Motivo: {orcamento.desconto_motivo}
                </span>
              )}
            </div>
          </div>

          {canManageDiscount && (
            <Button
              tone="rose"
              size="sm"
              onClick={handleRemoverDesconto}
              className="flex items-center gap-1.5 text-[12px] h-8"
            >
              <Trash2 size={14} />
              <span>Remover Desconto</span>
            </Button>
          )}
        </Card>
      )}

      {/* AVISO DE ORÇAMENTO APROVADO */}
      {isAprovado && (
        <Card className="p-4 bg-emerald-500/10 border-emerald-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Check size={24} className="text-emerald-400 shrink-0" />
            <div className="flex flex-col gap-0.5">
              {temAgendamentoAtivo ? (
                <>
                  <span className="font-sans font-bold text-[14px] text-emerald-400">
                    Orçamento Aprovado e Já Agendado
                    {(agendamentoAtivo?.numero_os || orcamento.numero_os)
                      ? ` — OS #${String(agendamentoAtivo?.numero_os || orcamento.numero_os).padStart(4, '0')}`
                      : ''}
                  </span>
                  <span className="font-sans text-[12px] text-vapor-300">
                    {agendamentoAtivo?.inicio
                      ? `Atendimento marcado para ${formatarDataHora(agendamentoAtivo.inicio)}`
                      : 'Este orçamento já foi convertido em Ordem de Serviço / Agendamento'}
                    {agendamentoAtivo?.status
                      ? ` • Status: ${getLabelFromStatus(agendamentoAtivo.status as any)}`
                      : ''}
                  </span>
                </>
              ) : (
                <>
                  <span className="font-sans font-bold text-[14px] text-emerald-400">
                    Orçamento Aprovado pelo Cliente (Nível {orcamento.nivel_aprovado?.toUpperCase()})
                  </span>
                  <span className="font-sans text-[12px] text-vapor-300">
                    O cliente escolheu esta proposta! Clique no botão ao lado para agendar a execução.
                  </span>
                </>
              )}
            </div>
          </div>

          {temAgendamentoAtivo ? (
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <Button
                tone="emerald"
                size="sm"
                onClick={() => {
                  const link = obterLinkAtendimento(null, agendamentoAtivo?.id || orcamento.agendamento_id);
                  navigate(link || '/agenda');
                }}
              >
                Ver Atendimento / OS
              </Button>
              <Button
                tone="graphite"
                size="sm"
                onClick={() =>
                  navigate(
                    obterLinkAgendaAgendamento(
                      agendamentoAtivo?.id || orcamento.agendamento_id,
                      agendamentoAtivo?.inicio
                    )
                  )
                }
              >
                Ver na Agenda
              </Button>
            </div>
          ) : (
            <Button
              tone="emerald"
              size="sm"
              onClick={() => {
                if (!orcamento.cliente_id) {
                  setAbrirAgendaAposCliente(true);
                  showToast('Preencha e vincule o cliente antes de agendar a OS.', 'warning');
                  setModoModalTrocarCliente('cadastrar');
                  setShowModalTrocarCliente(true);
                  return;
                }
                const hoje = new Date().toISOString().split('T')[0];
                setDataAgendamento(hoje);
                setShowAgendarModal(true);
              }}
              className="shrink-0"
            >
              Agendar Agora
            </Button>
          )}
        </Card>
      )}

      {/* CARD: AVALIAÇÃO DO VEÍCULO, FOTOS COM TIMESTAMP IMUTÁVEL E TERMOS DE GARANTIA */}
      <Card className="p-4 bg-graphite-900 border-graphite-800 flex flex-col gap-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Camera size={18} className="text-amber-400 shrink-0" />
            <h3 className="font-display text-sm font-bold text-vapor-100 uppercase tracking-wide">
              Avaliação do Veículo, Fotos & Termos
            </h3>
          </div>

          <div className="flex items-center gap-3 flex-wrap text-xs">
            {/* CHECK: INCLUIR FOTOS */}
            <label className="flex items-center gap-1.5 cursor-pointer select-none text-vapor-300 hover:text-vapor-100">
              <input
                type="checkbox"
                checked={incluirFotos}
                onChange={async (e) => {
                  const val = e.target.checked;
                  setIncluirFotos(val);
                  if (val) {
                    setExpandidoTermosFotos(true);
                  }
                  if (orcamento) {
                    await supabase.from('orcamentos').update({ incluir_fotos: val }).eq('id', orcamento.id);
                    setOrcamento((prev) => prev ? ({ ...prev, incluir_fotos: val } as any) : null);
                  }
                }}
                className="w-4 h-4 rounded bg-graphite-950 border-graphite-700 text-amber-500 focus:ring-0"
              />
              <span className="font-semibold">Fotos no PDF / Link</span>
            </label>

            {/* CHECK: TERMO DE RESPONSABILIDADE & RISCOS (UNIFICADO) */}
            <label className="flex items-center gap-1.5 cursor-pointer select-none text-vapor-300 hover:text-cyan-300">
              <input
                type="checkbox"
                checked={incluirTermoResponsabilidade}
                onChange={(e) => handleToggleTermoResponsabilidade(e.target.checked)}
                className="w-4 h-4 rounded bg-graphite-950 border-graphite-700 text-cyan-400 focus:ring-0"
              />
              <span className="font-semibold">Termo de Responsabilidade & Riscos</span>
            </label>

            {/* CHECK: TERMO DE GARANTIA (SELECIONÁVEL) */}
            <label className="flex items-center gap-1.5 cursor-pointer select-none text-vapor-300 hover:text-amber-300">
              <input
                type="checkbox"
                checked={incluirTermoGarantia}
                onChange={(e) => handleToggleTermoGarantia(e.target.checked)}
                className="w-4 h-4 rounded bg-graphite-950 border-graphite-700 text-amber-500 focus:ring-0"
              />
              <span className="font-semibold">Termo de Garantia</span>
            </label>

            {/* BOTÃO VISUALIZAR TUDO / RECOLHER */}
            <button
              type="button"
              onClick={() => setExpandidoTermosFotos((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-graphite-800 hover:bg-graphite-700 text-amber-400 border border-graphite-700 font-sans text-xs font-bold transition-colors ml-auto lg:ml-1"
            >
              <Eye size={13} />
              <span>{expandidoTermosFotos ? 'Recolher' : 'Visualizar tudo'}</span>
              {expandidoTermosFotos ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          </div>
        </div>

        {/* RESUMO COMPACTO QUANDO RECOLHIDO */}
        {!expandidoTermosFotos ? (
          <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-graphite-800/80 text-[11px]">
            <button
              type="button"
              onClick={() => setExpandidoTermosFotos(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-graphite-950 border border-graphite-800 text-vapor-300 hover:border-amber-500/40 font-mono transition-colors"
            >
              <Calendar size={11} className="text-amber-400" />
              <span>Validade: {validadeDiasOrcamento}d</span>
            </button>
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md border font-mono ${
                incluirFotos
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-graphite-950/60 border-graphite-800/70 text-vapor-500'
              }`}
            >
              Fotos: {incluirFotos ? `${fotosAvaliacao.length} anexada(s)` : 'Oculto'}
            </span>
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md border font-mono ${
                incluirTermoResponsabilidade
                  ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'
                  : 'bg-graphite-950/60 border-graphite-800/70 text-vapor-500'
              }`}
            >
              Resp. CDC: {incluirTermoResponsabilidade ? 'Ativo' : 'Oculto'}
            </span>
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md border font-mono ${
                incluirTermoGarantia
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                  : 'bg-graphite-950/60 border-graphite-800/70 text-vapor-500'
              }`}
            >
              Garantia: {incluirTermoGarantia ? `${garantiaMeses} ${garantiaMeses === 1 ? 'mês' : 'meses'}` : 'Oculto'}
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-4 pt-3 border-t border-graphite-800">
            {/* SELETORES: VALIDADE DO ORÇAMENTO E (QUANDO ATIVO) PRAZO DE GARANTIA */}
            <div className={`grid grid-cols-1 ${incluirTermoGarantia ? 'md:grid-cols-2' : ''} gap-4`}>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-vapor-300">
                  Validade da Proposta (em dias):
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  <CampoNumerico
                    integerOnly
                    value={validadeDiasOrcamento}
                    onChange={(val) => {
                      const next = val && val >= 1 ? Math.min(365, val) : 1;
                      setValidadeDiasOrcamento(next);
                    }}
                    onBlur={() => handleAlterarValidade(validadeDiasOrcamento)}
                    wrapperClassName="w-24 bg-graphite-950"
                    className="text-amber-400 text-base font-bold px-3 py-1.5"
                  />
                  <span className="text-xs font-sans text-vapor-300 font-medium">dias</span>
                  <button
                    type="button"
                    onClick={() => handleAlterarValidade(validadeDiasOrcamento)}
                    className="px-2.5 py-1.5 bg-graphite-800 hover:bg-graphite-700 text-vapor-200 border border-graphite-700 rounded text-xs font-bold"
                    title="Salvar validade digitada"
                  >
                    Salvar
                  </button>
                  <div className="flex items-center gap-1 ml-auto flex-wrap">
                    {[7, 15, 30, 60, 90].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => {
                          setValidadeDiasOrcamento(d);
                          handleAlterarValidade(d);
                        }}
                        className={`px-2 py-1 rounded text-[11px] font-mono transition-colors ${
                          validadeDiasOrcamento === d
                            ? 'bg-amber-500 text-graphite-950 font-bold'
                            : 'bg-graphite-950 text-vapor-400 border border-graphite-800 hover:text-vapor-200'
                        }`}
                      >
                        {d}d
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {incluirTermoGarantia && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-vapor-300 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <ShieldCheck size={14} className="text-amber-400" />
                      Tempo de Garantia do Serviço:
                    </span>
                    <span className="text-[10px] font-mono text-amber-400 font-bold bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                      {garantiaMeses} {garantiaMeses === 1 ? 'mês' : 'meses'} (Jurídico Padrão)
                    </span>
                  </label>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {[1, 3, 6, 12].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => handleAlterarGarantiaMeses(m)}
                        className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${
                          garantiaMeses === m
                            ? 'bg-amber-500 text-graphite-950 font-bold shadow-md shadow-amber-500/20'
                            : 'bg-graphite-950 text-vapor-300 border border-graphite-800 hover:bg-graphite-900 hover:text-vapor-100'
                        }`}
                      >
                        {m} {m === 1 ? 'mês' : 'meses'} {m === 3 ? '(CDC)' : ''}
                      </button>
                    ))}
                  </div>
                  <span className="text-[10.5px] text-vapor-400 mt-0.5">
                    • Acompanha a proposta com o termo de garantia padrão e exclusões legais do CDC.
                  </span>
                </div>
              )}
            </div>

            {/* BLOCO COMPLETO DO TERMO DE GARANTIA (SOMENTE SE MARCADO) */}
            {incluirTermoGarantia && (
              <>
                <div className="p-3 bg-graphite-950/70 rounded-xl border border-graphite-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-xs font-bold text-vapor-100 flex items-center gap-2">
                      <ShieldCheck size={14} className="text-amber-400" />
                      <span>Modelo de Garantia da Proposta:</span>
                    </span>
                    <span className="text-[11px] text-vapor-400">
                      Selecione a minuta do advogado (CDC padrão) ou uma garantia técnica específica para os serviços executados.
                    </span>
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => handleSelecionarTermoGarantia('padrao')}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition ${
                          !termoGarantiaSelecionado
                            ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-sm'
                            : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border-amber-500/30'
                        }`}
                      >
                        <ShieldCheck size={12} />
                        <span>⚡ Aplicar Minuta Oficial de Garantia (Advogado)</span>
                      </button>
                    </div>
                  </div>

                  <select
                    value={termoGarantiaSelecionado}
                    onChange={(e) => handleSelecionarTermoGarantia(e.target.value)}
                    className="bg-graphite-900 border border-graphite-700 hover:border-amber-500 text-vapor-100 font-sans text-xs rounded-lg px-3 py-2 outline-none focus:border-amber-500 transition-colors cursor-pointer w-full sm:w-auto sm:min-w-[280px]"
                  >
                    <option value="">
                      ⚡ Minuta do Advogado (Padrão Geral CDC - {garantiaMeses} {garantiaMeses === 1 ? 'mês' : 'meses'})
                    </option>
                    {termosGarantiaDisponiveis.map((t) => (
                      <option key={t.id} value={t.id}>
                        🛡️ {t.titulo}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5 p-3 rounded-lg border text-xs bg-graphite-950/70 border-graphite-800">
                  <div className="flex items-center justify-between">
                    <span className="font-bold flex items-center gap-1.5 text-amber-400">
                      <ShieldCheck size={14} />
                      {termoGarantiaAtual ? termoGarantiaAtual.titulo : `Termo de Garantia da Proposta (${garantiaMeses} ${garantiaMeses === 1 ? 'mês' : 'meses'})`}
                    </span>
                    <span className="text-[10px] text-amber-400/90 font-mono bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 font-bold">
                      {termoGarantiaAtual ? 'Modelo Específico Ativo' : 'Minuta do Advogado Ativa'}
                    </span>
                  </div>
                  <p className="text-[11px] text-vapor-300 leading-relaxed italic bg-graphite-900/60 p-2.5 rounded border border-graphite-800/80 whitespace-pre-line">
                    {textoPreviewGarantia}
                  </p>
                </div>
              </>
            )}

            {/* CARD UNIFICADO DO TERMO DE RESPONSABILIDADE & RISCOS TÉCNICOS (SOMENTE SE MARCADO) */}
            {incluirTermoResponsabilidade && (
              <div className="flex flex-col gap-3 p-3.5 rounded-xl border transition-all bg-graphite-950/90 border-cyan-500/30 shadow-lg shadow-cyan-950/20">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-graphite-800/80 pb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 shrink-0">
                      <ShieldCheck size={16} />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-vapor-200 flex items-center gap-1.5 flex-wrap">
                        Termo de Responsabilidade & Riscos Técnicos (CDC)
                        {modoTermoResp === 'dinamico' && (
                          <span className="text-[10px] bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded font-mono font-bold border border-cyan-500/30">
                            ⚡ Cláusulas Inteligentes Dinâmicas
                          </span>
                        )}
                      </span>
                      <p className="text-[10.5px] text-vapor-400">
                        Preenchido automaticamente com as variáveis do cliente, veículo e cláusulas técnicas dos serviços selecionados.
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 font-bold self-start sm:self-auto">
                    Ativo na Proposta / PDF
                  </span>
                </div>

                {clausulasDetectadas.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-semibold text-vapor-400 flex items-center gap-1">
                      <span>⚡ Cláusulas técnicas ativas:</span>
                    </span>
                    {clausulasDetectadas.map((c, i) => (
                      <span
                        key={i}
                        className="text-[10px] bg-graphite-900 text-cyan-300 px-2 py-0.5 rounded-md border border-cyan-500/20 font-medium flex items-center gap-1"
                      >
                        <Check size={10} className="text-cyan-400" />
                        {c}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-2.5 bg-graphite-900/60 rounded-lg border border-graphite-800">
                  <label className="flex items-start sm:items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={incluirTermoRisco}
                      onChange={(e) => handleToggleTermoRisco(e.target.checked)}
                      className="w-4 h-4 mt-0.5 sm:mt-0 rounded bg-graphite-950 border-graphite-700 text-amber-500 focus:ring-0"
                    />
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold text-vapor-200 flex items-center gap-1.5 flex-wrap">
                        <span>Imprimir em Folha Separada no PDF</span>
                        <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1.5 py-0.2 rounded font-bold uppercase border border-amber-500/30">
                          Anexo Dedicado CDC com Assinatura Exclusiva
                        </span>
                      </span>
                      <span className="text-[10.5px] text-vapor-400">
                        Gera folha anexa avulsa no PDF com campo de assinatura exclusiva para o cliente aceitar as condições de risco (Arts. 6º, 8º, 14, 40 e 54 CDC).
                      </span>
                    </div>
                  </label>
                  {incluirTermoRisco && (
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold self-start sm:self-auto shrink-0">
                      Folha Anexa Ativa
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 flex-wrap text-[11px] pt-1 border-t border-graphite-800/60">
                  <span className="text-vapor-400 font-semibold text-[10.5px]">Adicionar risco específico:</span>
                  <button
                    type="button"
                    onClick={() => handleInserirRiscoRapido('Lavagem técnica com risco em conectores/chicotes elétricos e módulos antigos ressecados')}
                    className="px-2 py-0.5 bg-graphite-900 hover:bg-graphite-800 text-cyan-300 border border-cyan-500/30 rounded text-[10.5px] transition-colors"
                  >
                    + Motor / Chicote Elétrico
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInserirRiscoRapido('Pintura com repintura anterior ou verniz fino (< 80 micras), risco de queima')}
                    className="px-2 py-0.5 bg-graphite-900 hover:bg-graphite-800 text-cyan-300 border border-cyan-500/30 rounded text-[10.5px] transition-colors"
                  >
                    + Verniz Fino / Repintura
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInserirRiscoRapido('Forro de teto/estofamento ressecado com fragilidade ou risco de descolamento')}
                    className="px-2 py-0.5 bg-graphite-900 hover:bg-graphite-800 text-cyan-300 border border-cyan-500/30 rounded text-[10.5px] transition-colors"
                  >
                    + Higienização / Couro
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInserirRiscoRapido('Martelinho em vinco ou chapa estirada com tinta fragilizada')}
                    className="px-2 py-0.5 bg-graphite-900 hover:bg-graphite-800 text-cyan-300 border border-cyan-500/30 rounded text-[10.5px] transition-colors"
                  >
                    + Martelinho / Vinco
                  </button>
                </div>

                <div className="p-3 bg-graphite-950/70 rounded-xl border border-graphite-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-xs font-bold text-vapor-100 flex items-center gap-2">
                      <Scale size={14} className="text-amber-400" />
                      <span>Modelo de Responsabilidade na Proposta / Impressão:</span>
                    </span>
                    <span className="text-[11px] text-vapor-400">
                      Selecione o modelo adequado para o perfil do carro (padrão CDC por serviços, minuta do advogado, veículos antigos, etc.).
                    </span>
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          const advTermo = termosResponsabilidadeDisponiveis.find((t) =>
                            t.titulo.toLowerCase().includes('advogado')
                          );
                          if (advTermo) {
                            handleSelecionarTermoResp(advTermo.id);
                          } else {
                            setModoTermoResp('personalizado');
                            setEditandoTermoResp(false);
                            setTermoResponsabilidade(TERMO_CIENCIA_RISCO_PADRAO_ADVOGADO);
                            termoResponsabilidadeRef.current = TERMO_CIENCIA_RISCO_PADRAO_ADVOGADO;
                            showSuccess('Minuta Oficial do Advogado (CDC) aplicada neste orçamento e no PDF!');
                          }
                        }}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition ${
                          termoRespSelecionadoId.includes('advogado') || (modoTermoResp === 'personalizado' && termoResponsabilidade.includes('CDC'))
                            ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-sm'
                            : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border-amber-500/30'
                        }`}
                      >
                        <Scale size={12} />
                        <span>⚡ Aplicar Minuta Oficial do Advogado (CDC)</span>
                      </button>
                    </div>
                  </div>

                  <select
                    value={termoRespSelecionadoId}
                    onChange={(e) => handleSelecionarTermoResp(e.target.value)}
                    className="bg-graphite-900 border border-graphite-700 hover:border-amber-500 text-vapor-100 font-sans text-xs rounded-lg px-3 py-2 outline-none focus:border-amber-500 transition-colors cursor-pointer w-full sm:w-auto sm:min-w-[280px]"
                  >
                    <option value="dinamico">
                      ⚡ Dinâmico (Cláusulas automáticas dos serviços)
                    </option>
                    {termosResponsabilidadeDisponiveis.map((t) => (
                      <option key={t.id} value={t.id}>
                        📄 {t.titulo}
                      </option>
                    ))}
                    <option value="personalizado">
                      ✍️ Texto Personalizado (Edição Livre)
                    </option>
                  </select>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 text-xs pt-1">
                  <div className="flex items-center gap-2 flex-wrap flex-1">
                    {modoTermoResp === 'dinamico' ? (
                      <span className="text-[11px] font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/30 flex items-center gap-1.5 shadow-sm">
                        <Sparkles size={12} className="text-emerald-400 animate-pulse" />
                        <span>Sincronização Dinâmica Ativa (Atualiza ao marcar/desmarcar serviços)</span>
                      </span>
                    ) : (
                      <span className="text-[11px] font-bold text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-md border border-amber-500/30 flex items-center gap-1.5">
                        <Lock size={12} className="text-amber-400" />
                        <span>Modelo Fixo / Manual Selecionado</span>
                      </span>
                    )}
                    <span className="text-[10px] text-vapor-500 hidden md:inline">
                      • Arts. 6º, 8º, 14, 40 e 54 CDC
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 self-end sm:self-auto flex-wrap">
                    {modoTermoResp !== 'dinamico' && (
                      <>
                        <button
                          type="button"
                          onClick={handleAnexarClausulasServicos}
                          className="px-2.5 py-1 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded text-[11px] font-bold transition-colors flex items-center gap-1"
                          title="Adiciona as cláusulas dos serviços selecionados neste orçamento ao final deste termo"
                        >
                          <Plus size={12} />
                          + Cláusulas dos Serviços
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSelecionarTermoResp('dinamico')}
                          className="px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded text-[11px] font-bold transition-colors flex items-center gap-1"
                          title="Voltar ao modo onde o texto é atualizado automaticamente conforme os serviços marcados"
                        >
                          <RefreshCw size={11} />
                          Voltar ao Dinâmico
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditandoTermoResp(!editandoTermoResp)}
                      className={`px-2.5 py-1 rounded text-[11px] font-semibold border transition-colors flex items-center gap-1 ${
                        editandoTermoResp
                          ? 'bg-cyan-500 text-graphite-950 font-bold border-cyan-400'
                          : 'bg-graphite-900 text-vapor-300 border-graphite-700 hover:text-vapor-100'
                      }`}
                    >
                      <Edit3 size={11} />
                      {editandoTermoResp ? 'Concluir Edição' : 'Editar Texto'}
                    </button>
                  </div>
                </div>

                {editandoTermoResp ? (
                  <div className="flex flex-col gap-2">
                    <div className="p-2.5 bg-amber-500/10 border border-amber-500/25 rounded-md flex items-start gap-2 text-[11px] text-amber-200">
                      <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                      <span className="leading-snug">
                        <strong>Aviso de Segurança Jurídica (CDC):</strong> O modelo automático está amparado nos Arts. 6º, III e 14, §3º do CDC (desgaste preexistente). Cláusulas que tentem isentar a oficina de falhas próprias de execução são nulas por lei (Art. 51, I). Utilize a edição para apontar avarias pontuais deste veículo.
                      </span>
                    </div>
                    <textarea
                      rows={6}
                      value={termoResponsabilidade}
                      onChange={(e) => {
                        setTermoResponsabilidade(e.target.value);
                        setModoTermoResp('personalizado');
                      }}
                      className="w-full bg-graphite-900 border border-cyan-500/50 rounded-lg p-2.5 font-sans text-xs text-vapor-100 outline-none focus:border-cyan-400 leading-relaxed shadow-inner"
                      placeholder="Texto do termo de responsabilidade e riscos..."
                    />
                    <div className="flex items-center justify-between text-[10px] text-vapor-400">
                      <span>Modo manual ativado. As alterações serão salvas neste orçamento.</span>
                      <button
                        type="button"
                        onClick={() => {
                          setModoTermoResp('dinamico');
                          const txt = gerarTermoDinamicoServicos(servicosAtivosNoOrcamento, dadosTermo);
                          setTermoResponsabilidade(txt);
                          setEditandoTermoResp(false);
                          showSuccess('Texto restaurado para o formato inteligente!');
                        }}
                        className="text-cyan-400 hover:underline font-semibold"
                      >
                        Descartar e voltar ao automático
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-vapor-300 leading-relaxed whitespace-pre-line bg-graphite-900/70 p-3 rounded-lg border border-graphite-800 max-h-36 overflow-y-auto">
                    {termoResponsabilidade || TERMO_RESPONSABILIDADE_PADRAO}
                  </p>
                )}

                <div className="flex flex-col gap-1 text-[10px] text-vapor-500">
                  <span>
                    • Este termo com as cláusulas dos serviços selecionados acompanha a proposta comercial e o PDF para proteção jurídica blindada contra falhas preexistentes.
                  </span>
                  <span className="text-amber-400/90 font-medium">
                    ⚡ Recomendação CDC: Armazene fotos e vídeos do estado ANTES do serviço (na galeria abaixo) para juntar ao documento como comprovação do estado anterior do veículo.
                  </span>
                </div>
              </div>
            )}

            {/* GALERIA DE FOTOS DE AVALIAÇÃO (SOMENTE SE FOTOS ESTIVER MARCADO) */}
            {incluirFotos && (
              <div className="flex flex-col gap-3 pt-2 border-t border-graphite-800">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-vapor-300 uppercase tracking-wide">
                      Fotos do Veículo ({fotosAvaliacao.length})
                    </span>

                    <div className="flex items-center bg-graphite-950 p-0.5 rounded-lg border border-graphite-800 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setFiltroMomentoFoto('todas')}
                        className={`px-2.5 py-1 rounded transition-colors ${filtroMomentoFoto === 'todas' ? 'bg-graphite-800 text-vapor-100 font-bold' : 'text-vapor-400 hover:text-vapor-200'}`}
                      >
                        Todas ({fotosAvaliacao.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setFiltroMomentoFoto('antes')}
                        className={`px-2.5 py-1 rounded transition-colors ${filtroMomentoFoto === 'antes' ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30' : 'text-vapor-400 hover:text-vapor-200'}`}
                      >
                        📷 Antes ({fotosAvaliacao.filter(f => f.tipo !== 'depois').length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setFiltroMomentoFoto('depois')}
                        className={`px-2.5 py-1 rounded transition-colors ${filtroMomentoFoto === 'depois' ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30' : 'text-vapor-400 hover:text-vapor-200'}`}
                      >
                        ✨ Depois ({fotosAvaliacao.filter(f => f.tipo === 'depois').length})
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => handleDispararUpload('antes')}
                      disabled={uploadingFoto}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
                      title="Anexar foto do estado inicial / antes do serviço"
                    >
                      <Camera size={14} />
                      <span>{uploadingFoto && momentoFotoUpload === 'antes' ? 'Enviando...' : '+ Foto Antes'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDispararUpload('depois')}
                      disabled={uploadingFoto}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
                      title="Anexar foto do resultado final / depois do serviço"
                    >
                      <Sparkles size={14} />
                      <span>{uploadingFoto && momentoFotoUpload === 'depois' ? 'Enviando...' : '+ Foto Depois'}</span>
                    </button>

                    <input
                      ref={fileInputFotoRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleUploadFotoAvaliacao}
                      disabled={uploadingFoto}
                      className="hidden"
                    />
                  </div>
                </div>

                {fotosAvaliacao.length === 0 ? (
                  <p className="text-xs text-vapor-400 italic py-2">
                    Nenhuma foto anexada. Tire fotos de detalhes ou avarias para o "Antes", e fotos do acabamento para o "Depois".
                  </p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2.5">
                    {fotosAvaliacao
                      .filter((f) => {
                        if (filtroMomentoFoto === 'antes') return f.tipo !== 'depois';
                        if (filtroMomentoFoto === 'depois') return f.tipo === 'depois';
                        return true;
                      })
                      .map((foto) => {
                        const isDepois = foto.tipo === 'depois';
                        return (
                          <div
                            key={foto.id}
                            className="relative group rounded-lg overflow-hidden border border-graphite-700 bg-graphite-950 flex flex-col"
                          >
                            <img
                              src={foto.url}
                              alt={isDepois ? 'Depois' : 'Antes'}
                              className="w-full h-24 object-cover group-hover:scale-105 transition-transform"
                            />
                            <div className="absolute top-1 left-1">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase shadow ${
                                isDepois
                                  ? 'bg-emerald-500 text-graphite-950'
                                  : 'bg-cyan-600 text-white'
                              }`}>
                                {isDepois ? '✨ DEPOIS' : '📷 ANTES'}
                              </span>
                            </div>

                            <div className="p-1 bg-graphite-950/95 border-t border-graphite-800 text-[9px] font-mono text-vapor-300 flex items-center gap-1">
                              <Clock size={10} className="text-amber-400 shrink-0" />
                              <span className="truncate">{formatarDataHora(foto.created_at)}</span>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                baixarFoto(
                                  foto.url,
                                  `orcamento_${orcamento?.numero ? String(orcamento.numero) : (orcamento?.id ? orcamento.id.slice(0, 8) : 'proposta')}_${isDepois ? 'depois' : 'antes'}_${foto.id.slice(0, 6)}.jpg`
                                );
                              }}
                              className={`absolute top-1 ${!isAprovado ? 'right-7' : 'right-1'} p-1 bg-graphite-900/80 hover:bg-amber-500 hover:text-graphite-950 text-white rounded opacity-0 group-hover:opacity-100 transition shadow`}
                              title="Baixar Foto"
                            >
                              <Download size={12} />
                            </button>
                            {!isAprovado && (
                              <button
                                type="button"
                                onClick={() => handleExcluirFotoAvaliacao(foto.id)}
                                className="absolute top-1 right-1 p-1 bg-rose-600/90 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Remover Foto"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* STATUS DAS ASSINATURAS (SEMPRE ACESSÍVEL DE FORMA COMPACTA) */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2.5 border-t border-graphite-800 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-vapor-400 font-medium">Assinatura Cliente:</span>
            {(orcamento as any).assinatura_path || (orcamento as any).assinatura_data ? (
              <button
                type="button"
                onClick={() => {
                  setAssinandoTipo('cliente');
                  setNomeSignatario(
                    (isNomeClienteValido((orcamento as any).assinatura_nome) ? (orcamento as any).assinatura_nome : '') ||
                      obterNomeClienteOrcamento(orcamento, '')
                  );
                  setRecriarAssinaturaCliente(false);
                  setShowAssinaturaModal(true);
                }}
                className="inline-flex items-center gap-1.5 text-emerald-400 font-bold bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-0.5 rounded border border-emerald-500/20 transition cursor-pointer"
                title="Clique para ver ou assinar novamente"
              >
                <Check size={13} />{' '}
                {(isNomeClienteValido((orcamento as any).assinatura_nome)
                  ? (orcamento as any).assinatura_nome
                  : obterNomeClienteOrcamento(orcamento, 'Cliente'))}{' '}
                em {formatarDataHora((orcamento as any).assinatura_data)}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAssinandoTipo('cliente');
                  setNomeSignatario(obterNomeClienteOrcamento(orcamento, ''));
                  setRecriarAssinaturaCliente(true);
                  setShowAssinaturaModal(true);
                }}
                className="text-amber-400 font-medium italic hover:underline cursor-pointer"
              >
                Pendente (Clique para coletar)
              </button>
            )}
            {assinaturaClienteUrl && (
              <button
                type="button"
                onClick={() => baixarFoto(assinaturaClienteUrl, `assinatura_cliente_${obterNomeClienteOrcamento(orcamento, 'cliente')}.png`)}
                className="p-1 text-vapor-400 hover:text-amber-400 hover:bg-graphite-800 rounded transition"
                title="Baixar Assinatura do Cliente"
              >
                <Download size={13} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-vapor-400 font-medium">Assinatura Oficina:</span>
            {(orcamento as any).assinatura_usuario_path || (orcamento as any).assinado_usuario_em ? (
              <button
                type="button"
                onClick={() => {
                  setAssinandoTipo('usuario');
                  setNomeSignatario((orcamento as any).assinatura_usuario_nome || tenant?.nome || '');
                  setRecriarAssinaturaOficina(false);
                  setShowAssinaturaModal(true);
                }}
                className="inline-flex items-center gap-1.5 text-emerald-400 font-bold bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-0.5 rounded border border-emerald-500/20 transition cursor-pointer"
                title="Clique para ver ou assinar novamente"
              >
                <Check size={13} /> {(orcamento as any).assinatura_usuario_nome || 'Oficina'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAssinandoTipo('usuario');
                  setNomeSignatario((orcamento as any).assinatura_usuario_nome || tenant?.nome || '');
                  setRecriarAssinaturaOficina(true);
                  setShowAssinaturaModal(true);
                }}
                className="text-vapor-400 italic hover:text-amber-400 hover:underline cursor-pointer"
              >
                Não coletada (Clique para assinar)
              </button>
            )}
            {assinaturaOficinaUrl && (
              <button
                type="button"
                onClick={() => baixarFoto(assinaturaOficinaUrl, `assinatura_oficina_${tenant?.nome || 'oficina'}.png`)}
                className="p-1 text-vapor-400 hover:text-amber-400 hover:bg-graphite-800 rounded transition"
                title="Baixar Assinatura da Oficina"
              >
                <Download size={13} />
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* BANNER DE FORMATO DO ORÇAMENTO (3 NÍVEIS VS SIMPLES) */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-3 bg-graphite-900 border border-graphite-800 rounded-xl">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
            Formato: {(orcamento as any)?.modo_orcamento === 'simples' ? 'Orçamento Simples (Nível Único)' : 'Orçamento em 3 Níveis'}
          </span>
          <span className="text-[11px] text-vapor-400 hidden sm:inline">
            {(orcamento as any)?.modo_orcamento === 'simples'
              ? '• Exibindo lista única de serviços'
              : '• Níveis Essencial, Recomendado e Completo separados'}
          </span>
        </div>
        <button
          type="button"
          onClick={async () => {
            const isSimples = (orcamento as any)?.modo_orcamento === 'simples';
            const novoModo = isSimples ? '3_niveis' : 'simples';

            if (novoModo === '3_niveis' && !temTresNiveis) {
              showError(`A proposta em 3 Níveis (Essencial, Recomendado e Premium) é exclusiva a partir do Plano Pro. Seu plano atual é ${nomePlano}.`);
              return;
            }

            await supabase.from('orcamentos').update({ modo_orcamento: novoModo }).eq('id', orcamento.id);
            modoOrcamentoRef.current = novoModo;
            setOrcamento((prev) => prev ? { ...prev, modo_orcamento: novoModo } : null);

            if (novoModo === 'simples') {
              setActiveTabMobile('essencial');
              const copy = {
                essencial: new Set(itensNivel.essencial),
                recomendado: new Set<string>(),
                completo: new Set<string>(),
              };
              const copyAvulsos: Record<TipoNivelOrcamento, ServicoAvulsoItem[]> = {
                essencial: [...servicosAvulsosNivel.essencial],
                recomendado: [],
                completo: [],
              };
              setItensNivel(copy);
              setServicosAvulsosNivel(copyAvulsos);
              triggerAutoSave(copy, titulosNiveis, descricoesNiveis, observacoes, customPrecos, copyAvulsos);
            }
            showSuccess(novoModo === 'simples' ? 'Alternado para Orçamento Simples' : 'Alternado para Orçamento em 3 Níveis');
          }}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-vapor-300 hover:text-amber-400 underline transition-colors"
        >
          {(orcamento as any)?.modo_orcamento === 'simples' ? (
            <>
              <span>Ativar Apresentação em 3 Níveis</span>
              {!temTresNiveis && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 no-underline">
                  <Lock size={10} /> PRO
                </span>
              )}
            </>
          ) : (
            'Mudar para Orçamento Simples'
          )}
        </button>
      </div>

      {/* BARRA DE PESQUISA RÁPIDA NA SELEÇÃO DE SERVIÇOS + ATALHO DE SERVIÇO ÚNICO */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 bg-graphite-900/90 border border-graphite-800 rounded-xl p-2.5">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-vapor-400 pointer-events-none" />
          <input
            type="text"
            value={buscaServico}
            onChange={(e) => setBuscaServico(e.target.value)}
            placeholder="Pesquisar serviço por nome ou categoria (ex: polimento, vitrificação, higienização)..."
            className="w-full bg-graphite-950 border border-graphite-700 rounded-lg pl-9 pr-9 py-2 text-vapor-100 placeholder:text-vapor-500 font-sans text-[13px] focus:outline-none focus:border-amber-500 min-h-[42px]"
          />
          {buscaServico && (
            <button
              type="button"
              onClick={() => setBuscaServico('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-vapor-400 hover:text-vapor-100 p-1"
              title="Limpar pesquisa"
            >
              <X size={15} />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() =>
            abrirModalServicoUnico(
              (orcamento as any)?.modo_orcamento === 'simples' ? 'essencial' : activeTabMobile,
              buscaServico.trim()
            )
          }
          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 font-sans text-[13px] font-bold transition-colors min-h-[42px] shrink-0"
          title="Adicionar serviço pontual apenas neste orçamento sem salvar no catálogo"
        >
          <Plus size={15} />
          <span>Serviço Único (Avulso)</span>
        </button>
      </div>

      {/* LEMBRETE CALMO: SERVIÇOS COM PREÇOS MÉDIOS SUGERIDOS */}
      {possuiPrecosSugeridosNoCatalogo && !avisoPrecoSugeridoFechado && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20 text-xs text-vapor-300">
          <div className="flex items-start sm:items-center gap-2">
            <Info size={15} className="text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
            <span>
              <strong className="text-amber-300">Preços sugeridos de mercado:</strong> você já pode simular e enviar seus orçamentos agora — depois lembre-se de ajustar os valores para a sua região ou editar direto em cada item.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
            <button
              type="button"
              onClick={() => navigate('/servicos/precos')}
              className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 font-semibold transition-colors whitespace-nowrap"
            >
              Ajustar Matriz de Preços
            </button>
            <button
              type="button"
              onClick={() => setAvisoPrecoSugeridoFechado(true)}
              className="p-1 text-vapor-400 hover:text-vapor-200 rounded transition-colors"
              title="Ocultar aviso"
              aria-label="Ocultar aviso de preços sugeridos"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* SELETOR DE NÍVEL EM ABAS (< 1280px / xl) */}
      {(orcamento as any)?.modo_orcamento !== 'simples' && (
        <div className="flex xl:hidden bg-graphite-900 p-1.5 rounded-xl border border-graphite-800 gap-1">
          {(['essencial', 'recomendado', 'completo'] as TipoNivelOrcamento[]).map((nKey) => (
            <button
              key={nKey}
              type="button"
              onClick={() => setActiveTabMobile(nKey)}
              className={`flex-1 py-2.5 rounded-lg font-sans text-[12px] font-bold uppercase tracking-wider transition-colors min-h-[48px] ${activeTabMobile === nKey
                  ? nKey === 'recomendado'
                    ? 'bg-amber-500 text-graphite-950 shadow'
                    : 'bg-graphite-700 text-vapor-100 shadow'
                  : 'text-vapor-400 hover:text-vapor-200'
                }`}
            >
              {nKey} {nKey === 'recomendado' && '★'}
            </button>
          ))}
        </div>
      )}

      {/* 3 COLUNAS LADO A LADO (>= 1280px / xl) OU COLUNA ÚNICA EM MODO SIMPLES */}
      <div className={`grid gap-6 ${(orcamento as any)?.modo_orcamento === 'simples' ? 'grid-cols-1 max-w-2xl mx-auto w-full' : 'grid-cols-1 xl:grid-cols-3'}`}>
        {(((orcamento as any)?.modo_orcamento === 'simples' ? ['essencial'] : ['essencial', 'recomendado', 'completo']) as TipoNivelOrcamento[]).map((nivelKey) => {
          const isDestaque = nivelKey === 'recomendado';
          const isTabVisible = activeTabMobile === nivelKey || (orcamento as any)?.modo_orcamento === 'simples';

          const nivelConfig = {
            essencial: {
              tag: (orcamento as any)?.modo_orcamento === 'simples' ? 'PROPOSTA PRINCIPAL' : 'NÍVEL 1: ESSENCIAL',
              tagClass: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
              cardBorder: 'border-cyan-500/40 bg-gradient-to-b from-cyan-950/20 to-graphite-900',
              titleClass: 'text-amber-400 font-extrabold',
            },
            recomendado: {
              tag: 'NÍVEL 2: RECOMENDADO ★ MAIS ESCOLHIDO',
              tagClass: 'bg-amber-500 text-graphite-950 font-black shadow-md shadow-amber-500/20',
              cardBorder: 'border-2 border-amber-500 bg-gradient-to-b from-amber-950/30 to-graphite-900 shadow-xl shadow-amber-500/10',
              titleClass: 'text-amber-300 font-black drop-shadow-[0_0_8px_rgba(245,158,11,0.5)]',
            },
            completo: {
              tag: 'NÍVEL 3: COMPLETO / PREMIUM',
              tagClass: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
              cardBorder: 'border-purple-500/40 bg-gradient-to-b from-purple-950/20 to-graphite-900',
              titleClass: 'text-amber-400 font-extrabold',
            },
          }[nivelKey];

          return (
            <div
              key={nivelKey}
              className={`flex flex-col gap-4 ${isTabVisible ? 'flex' : 'hidden xl:flex'}`}
            >
              {/* CARD HEADER DO NÍVEL COM DESIGN DESTACADO E TÍTULO DOURADO */}
              <Card className={`p-4 flex flex-col gap-3 relative transition-all rounded-xl border ${nivelConfig.cardBorder}`}>
                <div className="flex items-center justify-between">
                  <span className={`font-mono text-[10px] uppercase tracking-wider px-2.5 py-0.5 rounded-full border font-bold ${nivelConfig.tagClass}`}>
                    {nivelConfig.tag}
                  </span>
                  {isDestaque && (
                    <div className="flex items-center gap-1 text-amber-400 font-mono text-[11px] font-bold">
                      <Star size={12} fill="currentColor" />
                      <span>DESTAQUE</span>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-1 mt-1">
                  <textarea
                    rows={2}
                    value={titulosNiveis[nivelKey]}
                    onChange={(e) => handleAtualizarTitulo(nivelKey, e.target.value)}
                    className={`font-display text-[16px] uppercase tracking-wide bg-transparent border-b border-transparent hover:border-graphite-700 focus:border-amber-500 focus:outline-none resize-none h-[48px] leading-tight overflow-hidden text-ellipsis line-clamp-2 ${nivelConfig.titleClass}`}
                    placeholder="Título do Nível..."
                  />

                  <textarea
                    rows={2}
                    value={descricoesNiveis[nivelKey]}
                    onChange={(e) => handleAtualizarDescricao(nivelKey, e.target.value)}
                    className="font-sans text-[12px] text-vapor-300 bg-transparent border-b border-transparent hover:border-graphite-700 focus:border-amber-500 focus:outline-none resize-none h-[38px] leading-tight overflow-hidden text-ellipsis line-clamp-2"
                    placeholder="Descrição curta para o cliente..."
                  />
                </div>

                <div className="flex items-center justify-between bg-graphite-950/80 p-2.5 rounded-lg border border-graphite-800 min-h-[42px]">
                  {totais[nivelKey].itensCount === 0 ? (
                    <span className="text-[12px] font-sans text-vapor-500 italic w-full text-center">
                      Nenhum serviço selecionado
                    </span>
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5 text-vapor-300 font-mono text-[12px]">
                        <Clock size={14} className="text-vapor-400 shrink-0" />
                        <span>
                          {formatarDuracao(totais[nivelKey].duracaoTotal)}
                        </span>
                      </div>

                      <div className="flex flex-col items-end">
                        {totais[nivelKey].itensSemPrecoCount === totais[nivelKey].itensCount ? (
                          <span className="font-sans text-[12px] font-bold text-amber-500">
                            Preço a definir
                          </span>
                        ) : totais[nivelKey].valorComDesconto < totais[nivelKey].valorTotal ? (
                          <div className="flex flex-col items-end">
                            <span className="font-mono text-[11px] text-vapor-500 line-through">
                              {formatarMoeda(totais[nivelKey].valorTotal)}
                            </span>
                            <span className="font-mono text-[18px] font-black text-amber-400">
                              {formatarMoeda(totais[nivelKey].valorComDesconto)}
                            </span>
                          </div>
                        ) : (
                          <span className="font-mono text-[18px] font-black text-amber-400">
                            {formatarMoeda(totais[nivelKey].valorTotal)}
                          </span>
                        )}
                        {totais[nivelKey].itensSemPrecoCount > 0 && totais[nivelKey].itensSemPrecoCount < totais[nivelKey].itensCount && (
                          <span className="font-sans text-[9px] text-amber-500 font-medium">
                            *com itens s/ preço
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </Card>

              {/* LISTA DE SERVIÇOS AGRUPADOS COM CABEÇALHOS RECOLHÍVEIS */}
              <Card className="p-3 bg-graphite-900 border-graphite-800 flex flex-col gap-3 max-h-[600px] overflow-y-auto">
                <div className="flex items-center justify-between gap-2 border-b border-graphite-800 pb-2 flex-wrap">
                  <span className="font-mono text-[11px] text-vapor-400 uppercase tracking-wider">
                    Selecione os Serviços ({totais[nivelKey].itensCount})
                  </span>
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => abrirModalServicoUnico(nivelKey)}
                      className="text-[11px] font-bold text-cyan-400 hover:text-cyan-300 flex items-center gap-1 hover:underline"
                      title="Adicionar serviço pontual sem salvar no catálogo"
                    >
                      <Plus size={12} />
                      <span>Serviço Único</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowModalServicoRapido(true)}
                      className="text-[11px] font-bold text-amber-400 hover:text-amber-300 flex items-center gap-1 hover:underline"
                      title="Cadastrar novo serviço no catálogo sem sair desta tela"
                    >
                      <PlusCircle size={13} />
                      <span>+ Catálogo</span>
                    </button>
                  </div>
                </div>

                {/* SERVIÇOS ÚNICOS (AVULSOS) DESTE NÍVEL */}
                {(servicosAvulsosNivel[nivelKey] || []).length > 0 && (
                  <div className="flex flex-col gap-2">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-300 px-1">
                      Serviços Únicos neste nível ({servicosAvulsosNivel[nivelKey].length})
                    </span>
                    {servicosAvulsosNivel[nivelKey].map((av) => (
                      <div
                        key={av.uid}
                        className="p-2.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 flex flex-col gap-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2 min-w-0 flex-1">
                            <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shrink-0 mt-0.5">
                              Único
                            </span>
                            <input
                              type="text"
                              value={av.nome}
                              onChange={(e) =>
                                handleAtualizarServicoUnico(nivelKey, av.uid, { nome: e.target.value })
                              }
                              className="w-full bg-transparent font-sans text-[13px] font-bold text-vapor-100 outline-none border-b border-transparent focus:border-cyan-400"
                              placeholder="Nome do serviço único"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoverServicoUnico(nivelKey, av.uid)}
                            className="text-vapor-400 hover:text-rose-400 p-1 rounded transition-colors shrink-0"
                            title="Remover Serviço Único"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>

                        <div className="flex items-center justify-between pt-1.5 border-t border-cyan-500/20 text-[11px] font-mono gap-2">
                          <InputHorasAvulso
                            duracaoMinutos={av.duracao_minutos}
                            onCommitMinutos={(mins) => {
                              if (mins !== av.duracao_minutos) {
                                handleAtualizarServicoUnico(nivelKey, av.uid, { duracao_minutos: mins });
                              }
                            }}
                          />

                          <CampoNumerico
                            prefix="R$"
                            align="right"
                            value={av.preco}
                            onChange={(val) => {
                              handleAtualizarServicoUnico(nivelKey, av.uid, {
                                preco: Math.max(0, val ?? 0),
                              });
                            }}
                            wrapperClassName="w-28 bg-graphite-950/80 border-cyan-500/40 focus-within:border-cyan-400"
                            className="px-2 py-0.5 font-bold text-cyan-300 text-xs focus:text-white"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {servicosCatalogo.length === 0 ? (
                  <p className="font-sans text-[13px] text-vapor-400 italic py-2">
                    Nenhum serviço disponível no catálogo.
                  </p>
                ) : servicosPorGrupoFiltrados.size === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-6 px-3 text-center bg-graphite-950/50 rounded-xl border border-graphite-800">
                    <span className="font-sans text-[12px] text-vapor-400">
                      Nenhum serviço encontrado para &ldquo;{buscaServico}&rdquo;.
                    </span>
                    <button
                      type="button"
                      onClick={() => abrirModalServicoUnico(nivelKey, buscaServico.trim())}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 text-xs font-bold transition-colors"
                    >
                      <Plus size={13} />
                      <span>Adicionar &ldquo;{buscaServico.trim()}&rdquo; como Serviço Único</span>
                    </button>
                  </div>
                ) : (
                  Array.from(servicosPorGrupoFiltrados.entries()).map(([nomeGrupo, servicosDoGrupo]) => {
                    const isExpanded = termoBuscaNorm ? true : gruposExpandidos[nomeGrupo] !== false;
                    const selecionadosNoGrupo = servicosDoGrupo.filter((s) => itensNivel[nivelKey].has(s.id)).length;

                    return (
                      <div
                        key={nomeGrupo}
                        className="flex flex-col gap-1.5 bg-graphite-950/40 rounded-xl p-2 border border-graphite-800/60"
                      >
                        {/* CABEÇALHO DO GRUPO */}
                        <button
                          type="button"
                          onClick={() => toggleGrupoExpandido(nomeGrupo)}
                          className="flex items-center justify-between w-full px-2 py-1.5 rounded-lg hover:bg-graphite-800/50 transition-colors text-left min-h-[44px]"
                        >
                          <div className="flex items-center gap-2">
                            {isExpanded ? (
                              <ChevronDown size={15} className="text-amber-400 shrink-0" />
                            ) : (
                              <ChevronRight size={15} className="text-vapor-400 shrink-0" />
                            )}
                            <span className="font-mono text-[12px] font-bold text-vapor-200 uppercase tracking-wide">
                              {nomeGrupo}
                            </span>
                            <span className="font-mono text-[10px] text-vapor-400 bg-graphite-800 px-1.5 py-0.5 rounded">
                              {servicosDoGrupo.length}
                            </span>
                          </div>

                          {selecionadosNoGrupo > 0 && (
                            <span className="font-mono text-[10px] text-amber-400 font-bold bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/30">
                              {selecionadosNoGrupo} sel.
                            </span>
                          )}
                        </button>

                        {/* SERVIÇOS DO GRUPO */}
                        {isExpanded && (
                          <div className="flex flex-col gap-2 mt-1">
                            {servicosDoGrupo.map((serv) => {
                              const isChecked = itensNivel[nivelKey].has(serv.id);

                              return (
                                <div
                                  key={serv.id}
                                  onClick={() => handleToggleServico(nivelKey, serv.id)}
                                  className={`p-2.5 rounded-lg border cursor-pointer flex flex-col gap-2 transition-all select-none min-h-[52px] ${isChecked
                                      ? 'bg-amber-500/10 border-amber-500/50 text-vapor-100 shadow-sm'
                                      : 'bg-graphite-900/70 border-graphite-800/80 text-vapor-400 hover:border-graphite-700 hover:text-vapor-200'
                                    }`}
                                >
                                  {/* LINHA 1: CHECKBOX + NOME DO SERVIÇO */}
                                  <div className="flex items-start gap-2.5 w-full min-w-0">
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => { }}
                                      className="w-4 h-4 rounded border-graphite-600 text-amber-500 focus:ring-amber-500 bg-graphite-800 shrink-0 mt-0.5 pointer-events-none"
                                    />
                                    <span
                                      title={serv.nome}
                                      className="font-sans text-[13px] font-bold text-vapor-100 line-clamp-2 leading-tight break-words flex-1 min-w-0"
                                    >
                                      {serv.nome}
                                    </span>
                                  </div>

                                  {/* LINHA 2: DURAÇÃO À ESQUERDA, PREÇO À DIREITA COM CAMPO EDITÁVEL */}
                                  <div className="flex items-center justify-between w-full pt-1.5 border-t border-graphite-800/50 text-[11px] font-mono gap-2">
                                    <span className="text-vapor-400 flex items-center gap-1 shrink-0">
                                      <Clock size={11} className="text-vapor-500" />
                                      {formatarDuracao(serv.duracaoMatriz)}
                                    </span>

                                    {isChecked ? (
                                      <div
                                        className="flex items-center gap-1 bg-graphite-950/80 px-2 py-0.5 rounded border border-amber-500/40 hover:border-amber-500 transition-colors"
                                        onClick={(e) => e.stopPropagation()}
                                        title="Clique para editar o valor deste serviço no orçamento"
                                      >
                                        <span className="text-amber-400 font-bold text-[11px]">R$</span>
                                        <CampoNumerico
                                          value={
                                            customPrecos[`${nivelKey}_${serv.id}`] !== undefined
                                              ? customPrecos[`${nivelKey}_${serv.id}`]
                                              : serv.precoMatriz || 0
                                          }
                                          onChange={(val) => {
                                            handleAtualizarPrecoItem(nivelKey, serv.id, Math.max(0, val ?? 0));
                                          }}
                                          align="right"
                                          placeholder="0,00"
                                          wrapperClassName="w-20 bg-transparent border-none rounded-none"
                                          className="px-0 py-0 font-bold text-amber-400 text-xs focus:text-white"
                                        />
                                        {customPrecos[`${nivelKey}_${serv.id}`] !== undefined &&
                                          customPrecos[`${nivelKey}_${serv.id}`] !== serv.precoMatriz && (
                                            <span className="text-[9px] text-amber-400 font-sans font-bold">
                                              *editado
                                            </span>
                                          )}
                                      </div>
                                    ) : serv.temPrecoCadastrado ? (
                                      <span className="font-bold text-vapor-300">
                                        {formatarMoeda(serv.precoMatriz)}
                                      </span>
                                    ) : (
                                      <span className="font-sans text-[10px] font-medium text-amber-500">
                                        Preço não cadastrado
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </Card>
            </div>
          );
        })}
      </div>

      {/* OBSERVAÇÕES & TERMOS ESPECÍFICOS DESTE ORÇAMENTO */}
      <Card className="p-4 bg-graphite-900 border-graphite-800 flex flex-col gap-3 my-4 mb-24">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 text-amber-400 font-display text-[14px] uppercase tracking-wide font-bold">
            <FileText size={18} />
            <span>Observações & Termos Específicos deste Orçamento</span>
          </div>
          <span className="font-sans text-[12px] text-vapor-400">
            Aparece impresso no PDF e na proposta enviada ao cliente
          </span>
        </div>
        <textarea
          value={observacoes}
          onChange={(e) => {
            const val = e.target.value;
            setObservacoes(val);
            triggerAutoSave(itensNivel, titulosNiveis, descricoesNiveis, val, customPrecos, servicosAvulsosNivel);
          }}
          placeholder="Digite observações específicas deste veículo ou atendimento (ex: veículo possui repintura no capô, prazos de execução, condições de garantia...)"
          rows={3}
          className="w-full bg-graphite-950 border border-graphite-700 rounded-lg p-3 text-vapor-100 font-sans text-[13px] outline-none focus:border-amber-500 resize-none"
        />
      </Card>

      {/* PAINEL FIXO DE COMPARAÇÃO NO RODAPÉ */}
      <div className="fixed bottom-panel-orcamento left-0 lg:left-[240px] right-0 bg-graphite-800/95 backdrop-blur-md border-t border-graphite-700 p-3 sm:p-4 z-30 shadow-2xl">
        <div className="max-w-6xl mx-auto flex flex-col gap-3">

          {/* BARRA COMPACTA MOBILE E TABLET (< 1280px) */}
          <div className="flex xl:hidden items-center justify-between gap-2">
            <div className="flex flex-col">
              <span className="font-mono text-[10px] text-vapor-400 uppercase font-semibold">
                {(orcamento as any)?.modo_orcamento === 'simples' ? 'Proposta Única' : `Nível Ativo (${activeTabMobile.toUpperCase()})`}
              </span>
              <div className="flex items-center gap-2">
                {totais.essencial.itensCount === 0 ? (
                  <span className="font-sans text-[12px] text-vapor-500 italic">
                    Nenhum serviço selecionado
                  </span>
                ) : (
                  <>
                    <span className="font-mono text-[15px] font-bold text-amber-400">
                      {totais.essencial.itensSemPrecoCount === totais.essencial.itensCount
                        ? 'Preço a definir'
                        : formatarMoeda(totais.essencial.valorComDesconto)}
                    </span>
                    {totais.essencial.valorComDesconto < totais.essencial.valorTotal && (
                      <span className="font-mono text-[11px] text-vapor-500 line-through">
                        {formatarMoeda(totais.essencial.valorTotal)}
                      </span>
                    )}
                    <span className="font-mono text-[11px] text-vapor-400">
                      • {formatarDuracao(totais.essencial.duracaoTotal)}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                tone="amber"
                size="sm"
                onClick={handleSalvarManual}
                loading={saveStatus === 'salvando'}
                className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 min-h-[44px]"
                title="Salvar Orçamento"
              >
                <Save size={14} />
                <span className="hidden sm:inline">Salvar</span>
              </Button>

              {(orcamento as any)?.modo_orcamento !== 'simples' && (
                <Button
                  tone="graphite"
                  size="sm"
                  onClick={() => setExpandComparacaoMobile(!expandComparacaoMobile)}
                  className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 min-h-[44px]"
                >
                  <span>{expandComparacaoMobile ? 'Ocultar' : 'Comparar'}</span>
                  {expandComparacaoMobile ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                </Button>
              )}

              <Button
                tone="emerald"
                size="sm"
                onClick={handleEnviarCliente}
                className="px-2.5 py-1.5 min-h-[44px]"
                title="Enviar no WhatsApp"
              >
                <Send size={15} />
              </Button>
            </div>
          </div>

          {/* GRID DE TOTAIS (NO MODO SIMPLES MOSTRA APENAS O TOTAL DA PROPOSTA, NO MODO 3 NÍVEIS MOSTRA A COMPARAÇÃO) */}
          <div className={`flex-col xl:flex-row xl:items-center justify-between gap-4 ${(orcamento as any)?.modo_orcamento === 'simples' ? 'hidden xl:flex' : (expandComparacaoMobile ? 'flex' : 'hidden xl:flex')}`}>
            {(orcamento as any)?.modo_orcamento === 'simples' ? (
              <div className="flex items-center justify-between gap-4 p-3 bg-graphite-900 border border-amber-500/30 rounded-xl flex-1 shadow-sm">
                <div className="flex flex-col">
                  <span className="font-mono text-[10px] uppercase font-bold text-amber-400 tracking-wider">
                    Orçamento Simples (Proposta de Nível Único)
                  </span>
                  <span className="font-sans text-[12px] text-vapor-300">
                    {totais.essencial.itensCount} serviço{totais.essencial.itensCount !== 1 ? 's' : ''} incluso{totais.essencial.itensCount !== 1 ? 's' : ''}
                  </span>
                </div>

                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[22px] font-black text-amber-400">
                    {totais.essencial.itensCount === 0
                      ? 'Sem itens'
                      : totais.essencial.itensSemPrecoCount === totais.essencial.itensCount
                        ? 'Preço a definir'
                        : formatarMoeda(totais.essencial.valorComDesconto)}
                  </span>
                  {totais.essencial.valorComDesconto < totais.essencial.valorTotal && (
                    <span className="font-mono text-[13px] text-vapor-500 line-through">
                      {formatarMoeda(totais.essencial.valorTotal)}
                    </span>
                  )}
                </div>

                {totais.essencial.duracaoTotal > 0 && (
                  <div className="flex items-center gap-1.5 text-vapor-300 font-mono text-[12px] bg-graphite-950 px-3 py-1.5 rounded-lg border border-graphite-800">
                    <Clock size={14} className="text-amber-400" />
                    <span>Tempo total: {formatarDuracao(totais.essencial.duracaoTotal)}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:gap-4 flex-1">
                {(['essencial', 'recomendado', 'completo'] as TipoNivelOrcamento[]).map((nKey) => {
                  const isNivelDestaque = nKey === 'recomendado';
                  const t = totais[nKey];
                  const semPreco = t.itensSemPrecoCount > 0;
                  const todosSemPreco = t.itensCount > 0 && t.itensSemPrecoCount === t.itensCount;

                  return (
                    <div
                      key={nKey}
                      onClick={() => setActiveTabMobile(nKey)}
                      className={`flex flex-col items-start p-2 sm:px-3.5 sm:py-2.5 rounded-lg border transition-all cursor-pointer min-h-[52px] ${isNivelDestaque
                          ? 'bg-amber-500/10 border-amber-500/50 text-vapor-100 shadow-sm'
                          : 'bg-graphite-900 border-graphite-700 hover:border-graphite-600'
                        }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className={`font-mono text-[10px] uppercase font-bold ${isNivelDestaque ? 'text-amber-400' : 'text-vapor-400'}`}>
                          {nKey === 'recomendado' ? 'Recomendado ★' : nKey}
                        </span>
                        {t.itensCount > 0 && (
                          <span className="font-mono text-[9px] text-vapor-400">
                            {t.itensCount} item{t.itensCount !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>

                      <div className="flex items-baseline gap-1.5 flex-wrap">
                        <span className={`font-mono text-[14px] sm:text-[15px] font-bold ${isNivelDestaque ? 'text-amber-400' : 'text-vapor-100'}`}>
                          {t.itensCount === 0
                            ? 'Sem itens'
                            : todosSemPreco
                              ? 'Preço a definir'
                              : formatarMoeda(t.valorComDesconto)}
                        </span>
                        {t.valorComDesconto < t.valorTotal && !todosSemPreco && (
                          <span className="font-mono text-[10px] text-vapor-500 line-through">
                            {formatarMoeda(t.valorTotal)}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between w-full mt-0.5">
                        <span className="font-mono text-[10px] text-vapor-400">
                          {formatarDuracao(t.duracaoTotal)}
                        </span>
                        {semPreco && !todosSemPreco && (
                          <span className="font-sans text-[9px] text-amber-500 font-medium">
                            *com itens s/ preço
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* AÇÕES DIREITA */}
            <div className="flex items-center gap-2 justify-end shrink-0 pt-2 xl:pt-0 border-t xl:border-t-0 border-graphite-700/60">
              {linkPublico && (
                <Button
                  tone="graphite"
                  size="sm"
                  onClick={() => window.open(linkPublico, '_blank')}
                  className="flex items-center gap-1.5 text-[12px] min-h-[44px]"
                >
                  <ExternalLink size={14} />
                  <span className="hidden sm:inline">Ver Proposta Pública</span>
                </Button>
              )}

              <Button
                tone="amber"
                size="sm"
                onClick={handleSalvarManual}
                loading={saveStatus === 'salvando'}
                className="flex items-center gap-1.5 text-[12px] min-h-[44px]"
              >
                <Save size={14} />
                <span>Salvar</span>
              </Button>

              <Button
                tone="emerald"
                size="sm"
                onClick={handleEnviarCliente}
                className="flex items-center gap-1.5 text-[12px] min-h-[44px]"
              >
                <Send size={14} />
                <span>Enviar WhatsApp</span>
              </Button>
            </div>
          </div>

        </div>
      </div>

      {/* MODAL CONVERTER EM AGENDAMENTO */}
      <Modal
        isOpen={showAgendarModal}
        onClose={() => setShowAgendarModal(false)}
        title="Converter Orçamento em Agendamento"
      >
        <form onSubmit={handleConverterAgendamento} className="flex flex-col gap-4">
          <p className="font-sans text-[14px] text-vapor-300">
            Escolha o dia e horário para agendar o serviço aprovado pelo cliente (Nível <strong>{orcamento.nivel_aprovado?.toUpperCase()}</strong>).
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="font-sans text-[13px] font-bold text-vapor-200">
                Data do Agendamento <span className="text-amber-500">*</span>
              </label>
              <input
                type="date"
                value={dataAgendamento}
                onChange={(e) => setDataAgendamento(e.target.value)}
                required
                className="bg-graphite-900 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 font-sans text-[14px] focus:border-amber-500 focus:outline-none min-h-[48px]"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="font-sans text-[13px] font-bold text-vapor-200">
                Horário de Início <span className="text-amber-500">*</span>
              </label>
              <input
                type="time"
                value={horaAgendamento}
                onChange={(e) => setHoraAgendamento(e.target.value)}
                required
                className="bg-graphite-900 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 font-sans text-[14px] focus:border-amber-500 focus:outline-none min-h-[48px]"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-4">
            <Button
              type="button"
              tone="graphite"
              onClick={() => setShowAgendarModal(false)}
              className="min-h-[48px]"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              tone="emerald"
              loading={converting}
              className="min-h-[48px]"
            >
              Confirmar Agendamento
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL DE CUPOM E DESCONTO ESPECIAL */}
      <Modal
        isOpen={showDescontoModal}
        onClose={() => setShowDescontoModal(false)}
        title="Aplicar Cupom ou Desconto no Orçamento"
      >
        <form onSubmit={handleAplicarDesconto} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="font-sans text-[13px] font-bold text-vapor-200">
              Tipo de Desconto <span className="text-amber-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDescontoTipo('porcentagem')}
                className={`py-2 px-3 rounded-lg font-sans text-[13px] font-bold flex items-center justify-center gap-2 border transition-all ${descontoTipo === 'porcentagem'
                    ? 'bg-amber-500 text-graphite-950 border-amber-500'
                    : 'bg-graphite-800 text-vapor-300 border-graphite-700 hover:border-graphite-600'
                  }`}
              >
                <Percent size={16} />
                <span>Porcentagem (%)</span>
              </button>
              <button
                type="button"
                onClick={() => setDescontoTipo('valor_fixo')}
                className={`py-2 px-3 rounded-lg font-sans text-[13px] font-bold flex items-center justify-center gap-2 border transition-all ${descontoTipo === 'valor_fixo'
                    ? 'bg-amber-500 text-graphite-950 border-amber-500'
                    : 'bg-graphite-800 text-vapor-300 border-graphite-700 hover:border-graphite-600'
                  }`}
              >
                <Tag size={16} />
                <span>Valor Fixo (R$)</span>
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-sans text-[13px] font-bold text-vapor-200">
              Valor do Desconto {descontoTipo === 'porcentagem' ? '(%)' : '(R$)'} <span className="text-amber-500">*</span>
            </label>
            <input
              type="text"
              placeholder={descontoTipo === 'porcentagem' ? 'Ex: 10 (para 10%)' : 'Ex: 150 (para R$ 150,00)'}
              value={descontoValor}
              onChange={(e) => setDescontoValor(e.target.value)}
              required
              className="bg-graphite-900 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 font-mono text-[14px] focus:border-amber-500 focus:outline-none min-h-[44px]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-sans text-[13px] font-bold text-vapor-200">
              Código do Cupom (Opcional)
            </label>
            <input
              type="text"
              placeholder="Ex: VOLTA10, VIP2026, FIDELIDADE"
              value={descontoCupom}
              onChange={(e) => setDescontoCupom(e.target.value.toUpperCase())}
              className="bg-graphite-900 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 font-mono text-[14px] uppercase focus:border-amber-500 focus:outline-none min-h-[44px]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-sans text-[13px] font-bold text-vapor-200">
              Motivo / Observação Interna (Opcional)
            </label>
            <input
              type="text"
              placeholder="Ex: Cliente fechou mais de um carro na oficina"
              value={descontoMotivo}
              onChange={(e) => setDescontoMotivo(e.target.value)}
              className="bg-graphite-900 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 font-sans text-[14px] focus:border-amber-500 focus:outline-none min-h-[44px]"
            />
          </div>

          <div className="flex justify-end gap-3 mt-4">
            <Button
              type="button"
              tone="graphite"
              onClick={() => setShowDescontoModal(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              tone="amber"
              loading={applyingDesconto}
            >
              Aplicar Desconto
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL CONFIRMAÇÃO DE SAÍDA COM SALVAMENTO PENDENTE */}
      <ModalConfirmacao
        isOpen={showVoltarModal}
        onClose={() => setShowVoltarModal(false)}
        onConfirm={() => {
          setShowVoltarModal(false);
          executarNavegacaoVoltar();
        }}
        title="Salvamento em Andamento"
        mensagem="As alterações do orçamento estão sendo salvas no servidor. Deseja realmente sair agora?"
        textoConfirmar="Sair Sem Aguardar"
        textoCancelar="Permanecer na Tela"
        variant="warning"
      />

      {/* MODAL NOVO SERVIÇO RÁPIDO */}
      <ModalServicoRapido
        isOpen={showModalServicoRapido}
        onClose={() => setShowModalServicoRapido(false)}
        onSuccess={handleNovoServicoCadastrado}
        categoriaVeiculoId={orcamento.categoria_id}
      />

      {/* MODAL SERVIÇO ÚNICO (AVULSO, NÃO SALVO NO CATÁLOGO) */}
      <Modal
        isOpen={showModalServicoUnico}
        onClose={() => setShowModalServicoUnico(false)}
        title="Adicionar Serviço Único (Avulso)"
        subtitle="Serviço pontual apenas para este orçamento — não será salvo no catálogo"
        maxWidth="md"
      >
        <form onSubmit={handleAdicionarServicoUnico} className="flex flex-col gap-4">
          <div className="p-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/25 text-[12px] text-cyan-200">
            Ideal para demandas pontuais: informe apenas nome, valor e tempo de execução.
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-sans text-[13px] font-bold text-vapor-200">
              Nome do serviço <span className="text-amber-500">*</span>
            </label>
            <input
              type="text"
              value={suNome}
              onChange={(e) => setSuNome(e.target.value)}
              placeholder="Ex: Remoção de piche localizado, Ajuste pontual..."
              autoFocus
              required
              className="bg-graphite-900 border border-graphite-700 rounded-lg px-3 py-2.5 text-vapor-100 font-sans text-[14px] focus:border-cyan-400 focus:outline-none min-h-[44px]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="font-sans text-[13px] font-bold text-vapor-200">
                Valor (R$) <span className="text-amber-500">*</span>
              </label>
              <CampoNumerico
                allowNull
                prefix="R$"
                value={suValor}
                onChange={(_, valStr) => setSuValor(valStr)}
                placeholder="Ex: 150,00"
                required
                wrapperClassName="bg-graphite-900 min-h-[44px] focus-within:border-cyan-400"
                className="text-vapor-100 text-[14px]"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="font-sans text-[13px] font-bold text-vapor-200">
                  Tempo de execução (horas) <span className="text-amber-500">*</span>
                </label>
                {(() => {
                  const hParsed = parseFloat(suDuracao.replace(',', '.'));
                  if (!isNaN(hParsed) && hParsed > 0) {
                    const minsPreview = Math.max(5, Math.round(hParsed * 60));
                    return (
                      <span className="font-mono text-[11px] text-cyan-300/90">
                        = {formatarDuracao(minsPreview)}
                      </span>
                    );
                  }
                  return null;
                })()}
              </div>
              <input
                type="text"
                inputMode="decimal"
                value={suDuracao}
                onChange={(e) => {
                  const val = e.target.value;
                  if (/^\d*([.,]\d*)?$/.test(val.trim())) {
                    setSuDuracao(val);
                  }
                }}
                placeholder="Ex: 1 ou 1,5"
                required
                className="bg-graphite-900 border border-graphite-700 rounded-lg px-3 py-2.5 text-vapor-100 font-mono text-[14px] focus:border-cyan-400 focus:outline-none min-h-[44px]"
              />
              <div className="flex items-center gap-1 flex-wrap pt-0.5">
                {[0.5, 1, 1.5, 2, 3, 4].map((h) => {
                  const isAtivo =
                    Math.abs((parseFloat(suDuracao.replace(',', '.')) || 0) - h) < 0.01;
                  return (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setSuDuracao(String(h))}
                      className={`px-2 py-0.5 rounded text-[10.5px] font-mono border transition-colors ${
                        isAtivo
                          ? 'bg-cyan-500 text-graphite-950 font-bold border-cyan-400'
                          : 'bg-graphite-950 text-vapor-400 border-graphite-800 hover:text-vapor-200'
                      }`}
                    >
                      {String(h).replace('.', ',')}h
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {(orcamento as any)?.modo_orcamento !== 'simples' && (
            <div className="flex flex-col gap-2 pt-1">
              <div className="flex items-center justify-between">
                <label className="font-sans text-[12px] font-bold text-vapor-300 uppercase tracking-wide">
                  Incluir em quais níveis:
                </label>
                <button
                  type="button"
                  onClick={() => setSuNiveisDestino({ essencial: true, recomendado: true, completo: true })}
                  className="text-[11px] text-cyan-400 hover:underline font-semibold"
                >
                  Marcar todos os 3
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(['essencial', 'recomendado', 'completo'] as TipoNivelOrcamento[]).map((nKey) => {
                  const ativo = suNiveisDestino[nKey];
                  return (
                    <button
                      key={nKey}
                      type="button"
                      onClick={() => setSuNiveisDestino((prev) => ({ ...prev, [nKey]: !prev[nKey] }))}
                      className={`py-2 px-2.5 rounded-lg border text-xs font-bold uppercase tracking-wide transition-all ${
                        ativo
                          ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/60'
                          : 'bg-graphite-950 text-vapor-400 border-graphite-800 hover:text-vapor-200'
                      }`}
                    >
                      {nKey === 'recomendado' ? 'Recomendado ★' : nKey}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 mt-2 pt-3 border-t border-graphite-800">
            <Button
              type="button"
              tone="graphite"
              onClick={() => setShowModalServicoUnico(false)}
              className="min-h-[44px]"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              tone="cyan"
              className="min-h-[44px] font-bold"
            >
              Adicionar Serviço Único
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL ASSINATURA DIGITAL (CLIENTE OU OFICINA) */}
      <Modal
        isOpen={showAssinaturaModal}
        onClose={() => setShowAssinaturaModal(false)}
        title={assinandoTipo === 'cliente' ? 'Assinatura do Cliente' : 'Assinatura da Oficina / Responsável'}
        maxWidth="md"
        icon={<PenTool className="text-amber-500" size={22} />}
      >
        <div className="flex flex-col gap-4">
          <div className="flex gap-2 p-1 bg-graphite-900 rounded-lg border border-graphite-700">
            <button
              type="button"
              onClick={() => {
                setAssinandoTipo('cliente');
                setNomeSignatario(
                  (isNomeClienteValido((orcamento as any).assinatura_nome) ? (orcamento as any).assinatura_nome : '') ||
                    obterNomeClienteOrcamento(orcamento, '')
                );
              }}
              className={`flex-1 py-1.5 text-xs font-bold rounded flex items-center justify-center gap-1.5 transition ${
                assinandoTipo === 'cliente' ? 'bg-amber-500 text-graphite-950 shadow' : 'text-vapor-400 hover:text-vapor-100'
              }`}
            >
              <span>Cliente</span>
              {(assinaturaClienteUrl || (orcamento as any).assinatura_path) && (
                <span className={`w-2 h-2 rounded-full ${assinandoTipo === 'cliente' ? 'bg-graphite-950' : 'bg-emerald-400'}`} title="Já assinado" />
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setAssinandoTipo('usuario');
                setNomeSignatario((orcamento as any).assinatura_usuario_nome || tenant?.nome || '');
              }}
              className={`flex-1 py-1.5 text-xs font-bold rounded flex items-center justify-center gap-1.5 transition ${
                assinandoTipo === 'usuario' ? 'bg-amber-500 text-graphite-950 shadow' : 'text-vapor-400 hover:text-vapor-100'
              }`}
            >
              <span>Oficina / Responsável</span>
              {(assinaturaOficinaUrl || (orcamento as any).assinatura_usuario_path) && (
                <span className={`w-2 h-2 rounded-full ${assinandoTipo === 'usuario' ? 'bg-graphite-950' : 'bg-emerald-400'}`} title="Já assinado" />
              )}
            </button>
          </div>

          {assinandoTipo === 'cliente' ? (
            (assinaturaClienteUrl || (orcamento as any).assinatura_path) && !recriarAssinaturaCliente ? (
              /* CARD DE ASSINATURA DO CLIENTE JÁ COLETADA */
              <div className="flex flex-col items-center justify-center p-5 bg-graphite-950 rounded-xl border border-emerald-500/30 gap-3 text-center">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                  <Check size={18} />
                  <span>Assinatura do Cliente já Coletada</span>
                </div>
                {assinaturaClienteUrl ? (
                  <div className="p-3 bg-white rounded-lg border border-graphite-700 max-w-xs w-full flex items-center justify-center">
                    <img src={assinaturaClienteUrl} alt="Assinatura do Cliente" className="max-h-20 object-contain" />
                  </div>
                ) : (
                  <div className="p-3 bg-graphite-900 text-xs font-mono text-vapor-400 rounded">
                    Arquivo de assinatura registrado
                  </div>
                )}
                <div className="flex flex-col gap-0.5 text-xs">
                  <span className="font-semibold text-vapor-100">
                    {isNomeClienteValido(orcamento.assinatura_nome)
                      ? orcamento.assinatura_nome
                      : obterNomeClienteOrcamento(orcamento, 'Cliente')}
                  </span>
                  {orcamento.assinatura_data && (
                    <span className="font-mono text-[11px] text-vapor-400">
                      Assinado em {formatarDataHora(orcamento.assinatura_data)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  {assinaturaClienteUrl && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => baixarFoto(assinaturaClienteUrl, `assinatura_cliente_${obterNomeClienteOrcamento(orcamento, 'cliente')}.png`)}
                      className="text-xs h-8 px-3 flex items-center gap-1.5 text-amber-400 border-graphite-700 hover:bg-graphite-800"
                      title="Baixar imagem da assinatura do cliente"
                    >
                      <Download size={13} />
                      <span>Baixar</span>
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setRecriarAssinaturaCliente(true)}
                    className="text-xs h-8 px-3 flex items-center gap-1.5 text-vapor-300 border-graphite-700 hover:text-amber-400 hover:bg-graphite-800"
                  >
                    <RotateCcw size={13} />
                    <span>Assinar Novamente</span>
                  </Button>
                </div>
              </div>
            ) : (
              /* FORMULÁRIO DE CAPTURA DA ASSINATURA DO CLIENTE */
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-vapor-300 uppercase tracking-wide">
                    Nome do Cliente Signatário:
                  </label>
                  <input
                    type="text"
                    value={nomeSignatario}
                    onChange={(e) => setNomeSignatario(e.target.value)}
                    placeholder="Nome completo do cliente..."
                    className="bg-graphite-900 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 text-sm outline-none focus:border-amber-500"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-vapor-300 uppercase tracking-wide">
                      Desenhe a Assinatura do Cliente:
                    </label>
                    {(assinaturaClienteUrl || (orcamento as any).assinatura_path) && (
                      <button
                        type="button"
                        onClick={() => setRecriarAssinaturaCliente(false)}
                        className="text-[11px] text-vapor-400 hover:text-amber-400 underline"
                      >
                        Cancelar e manter existente
                      </button>
                    )}
                  </div>
                  <CanvasAssinatura
                    key="canvas-assinatura-cliente"
                    onSaveSignature={handleSalvarAssinaturaCanvas}
                    saveButtonText="Confirmar e Salvar Assinatura do Cliente"
                    disabled={savingAssinatura}
                  />
                </div>
              </div>
            )
          ) : (
            (assinaturaOficinaUrl || (orcamento as any).assinatura_usuario_path) && !recriarAssinaturaOficina ? (
              /* CARD DE ASSINATURA DA OFICINA JÁ REGISTRADA */
              <div className="flex flex-col items-center justify-center p-5 bg-graphite-950 rounded-xl border border-emerald-500/30 gap-3 text-center">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                  <Check size={18} />
                  <span>Assinatura da Oficina já Registrada</span>
                </div>
                {assinaturaOficinaUrl ? (
                  <div className="p-3 bg-white rounded-lg border border-graphite-700 max-w-xs w-full flex items-center justify-center">
                    <img src={assinaturaOficinaUrl} alt="Assinatura da Oficina" className="max-h-20 object-contain" />
                  </div>
                ) : (
                  <div className="p-3 bg-graphite-900 text-xs font-mono text-vapor-400 rounded">
                    Arquivo de assinatura registrado
                  </div>
                )}
                <div className="flex flex-col gap-0.5 text-xs">
                  <span className="font-semibold text-vapor-100">
                    {(orcamento as any).assinatura_usuario_nome || tenant?.nome || 'Oficina'}
                  </span>
                  {(orcamento as any).assinado_usuario_em && (
                    <span className="font-mono text-[11px] text-vapor-400">
                      Registrado em {formatarDataHora((orcamento as any).assinado_usuario_em)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  {assinaturaOficinaUrl && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => baixarFoto(assinaturaOficinaUrl, `assinatura_oficina_${tenant?.nome || 'oficina'}.png`)}
                      className="text-xs h-8 px-3 flex items-center gap-1.5 text-amber-400 border-graphite-700 hover:bg-graphite-800"
                      title="Baixar imagem da assinatura da oficina"
                    >
                      <Download size={13} />
                      <span>Baixar</span>
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setRecriarAssinaturaOficina(true)}
                    className="text-xs h-8 px-3 flex items-center gap-1.5 text-vapor-300 border-graphite-700 hover:text-amber-400 hover:bg-graphite-800"
                  >
                    <RotateCcw size={13} />
                    <span>Assinar Novamente</span>
                  </Button>
                </div>
              </div>
            ) : (
              /* FORMULÁRIO DE CAPTURA DA ASSINATURA DA OFICINA */
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-vapor-300 uppercase tracking-wide">
                    Nome do Responsável / Oficina:
                  </label>
                  <input
                    type="text"
                    value={nomeSignatario}
                    onChange={(e) => setNomeSignatario(e.target.value)}
                    placeholder="Nome do responsável técnico..."
                    className="bg-graphite-900 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 text-sm outline-none focus:border-amber-500"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-vapor-300 uppercase tracking-wide">
                      Desenhe a Assinatura da Oficina:
                    </label>
                    {(assinaturaOficinaUrl || (orcamento as any).assinatura_usuario_path) && (
                      <button
                        type="button"
                        onClick={() => setRecriarAssinaturaOficina(false)}
                        className="text-[11px] text-vapor-400 hover:text-amber-400 underline"
                      >
                        Cancelar e manter existente
                      </button>
                    )}
                  </div>
                  <CanvasAssinatura
                    key="canvas-assinatura-oficina"
                    onSaveSignature={handleSalvarAssinaturaCanvas}
                    saveButtonText="Confirmar e Salvar Assinatura da Oficina"
                    disabled={savingAssinatura}
                  />
                </div>
              </div>
            )
          )}
        </div>
      </Modal>
      
      {/* Modal de Confirmação para Aceite Manual */}
      <ModalConfirmacao
        isOpen={showConfirmAceiteManual}
        onClose={() => setShowConfirmAceiteManual(false)}
        onConfirm={executeAceiteManual}
        titulo="Confirmar Aceite Manual do Orçamento"
        mensagem="Deseja confirmar o aceite manual deste orçamento impresso? Isso marcará a proposta como aprovada e liberará a conversão para Ordem de Serviço."
        textoConfirmar="Confirmar Aceite"
        textoCancelar="Cancelar"
        variant="info"
        loading={aceitandoManual}
      />

      {/* Modal Editar Veículo e Cor */}
      {orcamento.veiculo && (
        <ModalEditarVeiculo
          isOpen={showModalEditarVeiculo}
          onClose={() => setShowModalEditarVeiculo(false)}
          veiculo={orcamento.veiculo as any}
          onSuccess={(veiculoAtualizado) => {
            setOrcamento((prev: any) =>
              prev ? { ...prev, veiculo: { ...prev.veiculo, ...veiculoAtualizado } } : null
            );
            fetchOrcamentoEDados();
          }}
        />
      )}

      {/* Modal Alterar Cliente / Veículo do Orçamento */}
      <ModalAlterarClienteOrcamento
        isOpen={showModalTrocarCliente}
        onClose={() => {
          setShowModalTrocarCliente(false);
          setAbrirAgendaAposCliente(false);
        }}
        orcamentoId={orcamento.id}
        clienteAtualId={orcamento.cliente_id}
        veiculoAtualId={orcamento.veiculo_id}
        categoriaAtualId={orcamento.categoria_id}
        modoInicial={modoModalTrocarCliente}
        dadosAvulsosInicial={{
          nome: obterNomeClienteOrcamento(orcamento, ''),
          telefone: (orcamento as any).cliente_telefone_avulso || '',
          veiculoDescricao: (orcamento as any).veiculo_descricao_avulsa || '',
        }}
        onSuccess={async () => {
          const quoteAtualizado = await fetchOrcamentoEDados();
          if (abrirAgendaAposCliente) {
            setAbrirAgendaAposCliente(false);
            if (quoteAtualizado?.cliente_id && !resolverAgendamentoVinculadoOrcamento(quoteAtualizado)) {
              const hoje = new Date().toISOString().split('T')[0];
              setDataAgendamento(hoje);
              setShowAgendarModal(true);
            }
          }
        }}
      />

      {/* Modal Confirmar Exclusão de Orçamento */}
      <ModalConfirmacao
        isOpen={showConfirmExcluir}
        onClose={() => setShowConfirmExcluir(false)}
        onConfirm={handleExcluirOrcamento}
        titulo="Excluir Orçamento"
        mensagem={`Deseja realmente excluir permanentemente o orçamento ${formatarCodigoProposta(orcamento)}? Esta ação não pode ser desfeita.`}
        textoConfirmar="Excluir Definitivamente"
        textoCancelar="Cancelar"
        variant="danger"
        loading={excluindoOrcamento}
      />
    </div>
  );
};
