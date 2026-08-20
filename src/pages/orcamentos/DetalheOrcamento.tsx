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
  FileText
} from 'lucide-react';
import type { Orcamento, TipoNivelOrcamento } from '../../types/orcamento';
import type { Servico } from '../../types/servicos';
import { getLabelFromStatusOrcamento, getBadgeToneFromStatusOrcamento } from '../../utils/orcamento';
import { formatarCodigoProposta, formatarMoeda } from '../../utils/formatters';
import { gerarPDFOrcamento, type PDFOrcamentoNivelData } from '../../utils/pdfOrcamento';
import { getFotoPublicUrl } from '../../utils/imagens';

interface ServicoComPrecoDuracao extends Servico {
  precoMatriz: number;
  duracaoMatriz: number;
  temPrecoCadastrado: boolean;
}

export const DetalheOrcamento: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { tenant, membership } = useAuth();
  const { showSuccess, showError, showToast } = useToast();

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

  // Modal Confirmação de Saída com alteração pendente
  const [showVoltarModal, setShowVoltarModal] = useState<boolean>(false);

  // Link público gerado
  const [linkPublico, setLinkPublico] = useState<string>('');

  const fetchOrcamentoEDados = async () => {
    if (!id || !tenant) return;
    if (!orcamento) {
      setLoading(true);
    }

    try {
      // 1. Busca Orçamento com Joins dos Níveis e seus Itens do Banco
      const { data: quoteData, error: quoteError } = await supabase
        .from('orcamentos')
        .select(`
          *,
          cliente:clientes(id, nome, telefone),
          veiculo:veiculos(id, placa, modelo, marca),
          categoria:categorias_veiculo(id, nome),
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
        return;
      }

      const quote = quoteData as Orcamento;
      setOrcamento(quote);

      if (quote.token_publico) {
        setLinkPublico(`${window.location.origin}/orcamento/${quote.token_publico}`);
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

        return {
          ...s,
          precoMatriz: precoFinal,
          temPrecoCadastrado: temPreco,
          duracaoMatriz: Number(dMatriz),
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

      if (quote.niveis) {
        quote.niveis.forEach((n) => {
          if (n.nivel === 'essencial' || n.nivel === 'recomendado' || n.nivel === 'completo') {
            if (n.titulo) newTitulos[n.nivel] = n.titulo;
            if (n.descricao) newDescricoes[n.nivel] = n.descricao;

            if (n.itens) {
              n.itens.forEach((it) => {
                if (it.servico_id) {
                  newItens[n.nivel].add(it.servico_id);
                }
              });
            }
          }
        });
      }

      setTitulosNiveis(newTitulos);
      setDescricoesNiveis(newDescricoes);
      setItensNivel(newItens);
      setObservacoes(quote.observacoes || '');
      setSaveStatus('salvo');

      // Marca como totalmente carregado para liberar autosave
      setTimeout(() => {
        isLoadedRef.current = true;
      }, 300);
    } catch (err) {
      console.error('[DetalheOrcamento] Erro ao carregar dados:', err);
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

  // PERSISTÊNCIA NO BANCO (FUNÇÃO PRINCIPAL DE SALVAMENTO)
  const executarSalvarNoBanco = useCallback(
    async (
      currentItens: Record<TipoNivelOrcamento, Set<string>>,
      currentTitulos: Record<TipoNivelOrcamento, string>,
      currentDescricoes: Record<TipoNivelOrcamento, string>,
      currentObservacoes?: string
    ) => {
      if (!orcamento || !tenant) return;
      setSaveStatus('salvando');

      try {
        const niveisList = orcamento.niveis || [];

        for (const nivelKey of ['essencial', 'recomendado', 'completo'] as TipoNivelOrcamento[]) {
          const nivelRecord = niveisList.find((n) => n.nivel === nivelKey);
          if (nivelRecord) {
            const servicosIds = Array.from(currentItens[nivelKey]);
            const payloadItens = servicosIds.map((sId) => ({ servico_id: sId, combo_id: null }));

            const { error } = await supabase.rpc('salvar_nivel_orcamento', {
              p_nivel: nivelRecord.id,
              p_itens: payloadItens,
              p_titulo: currentTitulos[nivelKey],
              p_descricao: currentDescricoes[nivelKey],
            });

            if (error) throw error;
          }
        }

        // Salvar observações do orçamento
        const valObs = currentObservacoes !== undefined ? currentObservacoes : observacoes;
        const { error: obsError } = await supabase
          .from('orcamentos')
          .update({
            observacoes: valObs.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', orcamento.id);

        if (obsError) throw obsError;

        setSaveStatus('salvo');
      } catch (err: any) {
        console.error('[DetalheOrcamento] Erro no salvamento automático:', err);
        setSaveStatus('erro');
        showError('Não foi possível salvar o orçamento. Tente novamente.', err);
      }
    },
    [orcamento, tenant, observacoes, showError]
  );

  // TRIGGER AUTOSAVE COM DEBOUNCE (800ms)
  const triggerAutoSave = useCallback(
    (
      updatedItens: Record<TipoNivelOrcamento, Set<string>>,
      updatedTitulos: Record<TipoNivelOrcamento, string>,
      updatedDescricoes: Record<TipoNivelOrcamento, string>,
      updatedObservacoes?: string
    ) => {
      if (!isLoadedRef.current) return;

      setSaveStatus('salvando');
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }

      autoSaveTimerRef.current = setTimeout(() => {
        executarSalvarNoBanco(updatedItens, updatedTitulos, updatedDescricoes, updatedObservacoes);
      }, 800);
    },
    [executarSalvarNoBanco]
  );

  // TOGGLE SERVIÇO COM HERANÇA E DISPARO DE AUTOSAVE
  const handleToggleServico = (nivel: TipoNivelOrcamento, servicoId: string) => {
    const copy = {
      essencial: new Set(itensNivel.essencial),
      recomendado: new Set(itensNivel.recomendado),
      completo: new Set(itensNivel.completo),
    };

    const isCurrentlyChecked = copy[nivel].has(servicoId);

    if (isCurrentlyChecked) {
      copy[nivel].delete(servicoId);
    } else {
      copy[nivel].add(servicoId);
      if (nivel === 'essencial') {
        copy.recomendado.add(servicoId);
        copy.completo.add(servicoId);
      } else if (nivel === 'recomendado') {
        copy.completo.add(servicoId);
      }
    }

    setItensNivel(copy);
    triggerAutoSave(copy, titulosNiveis, descricoesNiveis);
  };

  // ATUALIZAR TÍTULO / DESCRIÇÃO COM AUTOSAVE
  const handleAtualizarTitulo = (nivelKey: TipoNivelOrcamento, novoTitulo: string) => {
    const updated = { ...titulosNiveis, [nivelKey]: novoTitulo };
    setTitulosNiveis(updated);
    triggerAutoSave(itensNivel, updated, descricoesNiveis);
  };

  const handleAtualizarDescricao = (nivelKey: TipoNivelOrcamento, novaDescricao: string) => {
    const updated = { ...descricoesNiveis, [nivelKey]: novaDescricao };
    setDescricoesNiveis(updated);
    triggerAutoSave(itensNivel, titulosNiveis, updated);
  };

  // BOTÃO SUGERIR NÍVEIS AUTOMATICAMENTE
  const handleSugerirNiveis = () => {
    if (itensNivel.essencial.size === 0) {
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
    triggerAutoSave(copy, titulosNiveis, descricoesNiveis);
  };

  // CÁLCULOS AO VIVO DOS TOTAIS DE CADA NÍVEL (COM DESCONTO SE ATIVO)
  const calcularTotaisNivel = (nivel: TipoNivelOrcamento) => {
    let valorTotal = 0;
    let duracaoTotal = 0;
    let itensSemPrecoCount = 0;

    itensNivel[nivel].forEach((sId) => {
      const serv = servicosCatalogo.find((s) => s.id === sId);
      if (serv) {
        valorTotal += serv.precoMatriz;
        duracaoTotal += serv.duracaoMatriz;
        if (!serv.temPrecoCadastrado) {
          itensSemPrecoCount += 1;
        }
      }
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
      itensCount: itensNivel[nivel].size,
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
    await executarSalvarNoBanco(itensNivel, titulosNiveis, descricoesNiveis);
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

      const clienteNome = orcamento.cliente?.nome ? orcamento.cliente.nome.split(' ')[0] : 'Cliente';
      const veiculoModelo = orcamento.veiculo?.modelo || 'seu veículo';

      const mensagem = `Olá ${clienteNome}! Preparei três opções especiais de serviços para o seu ${veiculoModelo}. Dá uma olhada e me diz qual prefere: ${link}`;
      const telefoneFormatado = (orcamento.cliente?.telefone || '').replace(/\D/g, '');

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

      if (error) throw error;

      const link = `${window.location.origin}/orcamento/${orcamento.token_publico}`;
      setLinkPublico(link);

      const clienteNome = orcamento.cliente?.nome ? orcamento.cliente.nome.split(' ')[0] : 'Cliente';
      const veiculoModelo = orcamento.veiculo?.modelo || 'seu veículo';

      const mensagem = `Olá ${clienteNome}! Atualizamos os detalhes e valores do orçamento do seu ${veiculoModelo}. Por favor, acesse o link a seguir para conferir a alteração e realizar sua assinatura digital de confirmação: ${link}`;
      const telefoneFormatado = (orcamento.cliente?.telefone || '').replace(/\D/g, '');

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

    setConverting(true);
    try {
      const dataHoraIso = `${dataAgendamento}T${horaAgendamento}:00`;

      const { error } = await supabase.rpc('converter_orcamento_em_agendamento', {
        p_orcamento: orcamento.id,
        p_inicio: dataHoraIso,
      });

      if (error) throw error;

      setShowAgendarModal(false);
      showSuccess('Orçamento convertido em agendamento com sucesso!');
      navigate('/agenda');
    } catch (err: any) {
      showError('Não foi possível agendar o atendimento. Tente novamente.', err);
    } finally {
      setConverting(false);
    }
  };

  const [gerandoPDF, setGerandoPDF] = useState<boolean>(false);

  // BOTÃO VOLTAR COM CONFIRMAÇÃO SE SALVAMENTO ESTIVER EM ANDAMENTO
  const handleVoltar = () => {
    if (saveStatus === 'salvando') {
      setShowVoltarModal(true);
    } else {
      navigate('/orcamentos');
    }
  };

  // GERAR PDF DO ORÇAMENTO
  const handleGerarPDF = async () => {
    if (!orcamento || !tenant) return;
    setGerandoPDF(true);
    try {
      const niveisFormatados: PDFOrcamentoNivelData[] = (orcamento.niveis || []).map((n) => {
        const calc = calcularTotaisNivel(n.nivel);
        return {
          nivel: n.nivel,
          titulo: titulosNiveis[n.nivel] || n.titulo || n.nivel,
          descricao: descricoesNiveis[n.nivel] || n.descricao,
          valor_total: calc.valorComDesconto,
          valor_original: calc.valorTotal,
          duracao_total: calc.duracaoTotal,
          destaque: n.destaque,
          itens: Array.from(itensNivel[n.nivel]).map((sId) => {
            const s = servicosCatalogo.find((serv) => serv.id === sId);
            return {
              servico_nome: s?.nome || 'Serviço',
              servico_descricao: s?.descricao_publica || s?.descricao_interna,
              preco: s?.precoMatriz,
              duracao_minutos: s?.duracaoMatriz,
            };
          }),
        };
      });

      await gerarPDFOrcamento({
        id: orcamento.id,
        numero: orcamento.numero,
        numero_os: orcamento.numero_os,
        status: orcamento.status,
        nivel_aprovado: orcamento.nivel_aprovado,
        enviado_em: orcamento.enviado_em,
        validade_dias: orcamento.validade_dias,
        observacoes: observacoes || orcamento.observacoes,
        clienteNome: orcamento.cliente?.nome || 'Cliente',
        clienteTelefone: orcamento.cliente?.telefone,
        veiculoModelo: orcamento.veiculo?.modelo,
        veiculoPlaca: orcamento.veiculo?.placa,
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
        desconto: orcamento.desconto_valor && orcamento.desconto_tipo ? {
          tipo: orcamento.desconto_tipo,
          valor: orcamento.desconto_valor,
          motivo: orcamento.desconto_motivo,
          cupom_codigo: orcamento.desconto_cupom_codigo,
        } : null,
        niveis: niveisFormatados,
        planoCodigo: tenant.plano,
        pdfCorPrimaria: tenant.pdf_cor_primaria,
        pdfCorFundoCabecalho: tenant.pdf_cor_fundo_cabecalho,
        pdfCorTextoCabecalho: tenant.pdf_cor_texto_cabecalho,
        pdfCorFundoSecoes: tenant.pdf_cor_fundo_secoes,
        pdfSubtituloCabecalho: tenant.pdf_subtitulo_cabecalho,
        pdfTextoObservacoesOrcamento: tenant.pdf_texto_observacoes_orcamento,
        pdfTextoRodape: tenant.pdf_texto_rodape,
        pdfOcultarMarcaDagua: tenant.pdf_ocultar_marca_dagua,
      });
      showSuccess('PDF do orçamento gerado com sucesso!');
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
            <h1 className="font-display text-[22px] text-vapor-100 uppercase tracking-wide">
              {orcamento.cliente?.nome || 'Cliente não informado'}
            </h1>
            <span className="font-mono text-[13px] text-vapor-400">
              {orcamento.veiculo ? `${orcamento.veiculo.placa} (${orcamento.veiculo.modelo || 'Sem modelo'})` : 'Sem veículo'} • {orcamento.categoria?.nome}
            </span>
          </div>
        </div>

        {/* BOTOES DE ACAO DO TOPO */}
        <div className="flex items-center gap-2 flex-wrap">
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

          <Button
            tone="graphite"
            size="sm"
            onClick={handleGerarPDF}
            loading={gerandoPDF}
            className="flex items-center gap-1.5 min-h-[44px]"
          >
            <FileText size={16} className="text-amber-400" />
            <span>Baixar PDF</span>
          </Button>

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

          {isAprovado && (
            <Button
              tone="cyan"
              size="sm"
              onClick={() => {
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
        <Card className="p-4 bg-emerald-500/10 border-emerald-500/40 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Check size={24} className="text-emerald-400 shrink-0" />
            <div className="flex flex-col">
              <span className="font-sans font-bold text-[14px] text-emerald-400">
                Orçamento Aprovado pelo Cliente (Nível {orcamento.nivel_aprovado?.toUpperCase()})
              </span>
              <span className="font-sans text-[12px] text-vapor-300">
                O cliente escolheu esta proposta! Clique no botão ao lado para agendar a execução.
              </span>
            </div>
          </div>

          <Button
            tone="emerald"
            size="sm"
            onClick={() => {
              const hoje = new Date().toISOString().split('T')[0];
              setDataAgendamento(hoje);
              setShowAgendarModal(true);
            }}
          >
            Agendar Agora
          </Button>
        </Card>
      )}

      {/* SELETOR DE NÍVEL EM ABAS (< 1280px / xl) */}
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

      {/* 3 COLUNAS LADO A LADO (>= 1280px / xl) E ABAS ABAIXO DE 1280px */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {(['essencial', 'recomendado', 'completo'] as TipoNivelOrcamento[]).map((nivelKey) => {
          const isDestaque = nivelKey === 'recomendado';
          const isTabVisible = activeTabMobile === nivelKey;

          return (
            <div
              key={nivelKey}
              className={`flex flex-col gap-4 ${isTabVisible ? 'flex' : 'hidden xl:flex'}`}
            >
              {/* CARD HEADER DO NÍVEL */}
              <Card
                className={`p-4 flex flex-col gap-3 relative transition-all ${isDestaque
                    ? 'bg-graphite-900 border-2 border-amber-500 shadow-xl shadow-amber-500/10'
                    : 'bg-graphite-900 border-graphite-700'
                  }`}
              >
                {isDestaque ? (
                  <div className="self-center bg-amber-500 text-graphite-950 font-mono text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full flex items-center gap-1 shadow-md whitespace-nowrap -mt-2 mb-1">
                    <Star size={11} fill="currentColor" />
                    <span>MAIS ESCOLHIDO</span>
                  </div>
                ) : (
                  <div className="self-center invisible font-mono text-[10px] uppercase px-3 py-1 -mt-2 mb-1 pointer-events-none select-none">
                    <span>Espaçador</span>
                  </div>
                )}

                <div className="flex flex-col gap-1 mt-1">
                  <textarea
                    rows={2}
                    value={titulosNiveis[nivelKey]}
                    onChange={(e) => handleAtualizarTitulo(nivelKey, e.target.value)}
                    className="font-display text-[15px] sm:text-[16px] text-vapor-100 uppercase tracking-wide bg-transparent border-b border-transparent hover:border-graphite-700 focus:border-amber-500 focus:outline-none resize-none h-[48px] leading-tight overflow-hidden text-ellipsis line-clamp-2"
                    placeholder="Título do Nível..."
                  />

                  <textarea
                    rows={2}
                    value={descricoesNiveis[nivelKey]}
                    onChange={(e) => handleAtualizarDescricao(nivelKey, e.target.value)}
                    className="font-sans text-[12px] text-vapor-400 bg-transparent border-b border-transparent hover:border-graphite-700 focus:border-amber-500 focus:outline-none resize-none h-[38px] leading-tight overflow-hidden text-ellipsis line-clamp-2"
                    placeholder="Descrição curta para o cliente..."
                  />
                </div>

                <div className="flex items-center justify-between bg-graphite-950/60 p-2.5 rounded-lg border border-graphite-800/80 min-h-[42px]">
                  {totais[nivelKey].itensCount === 0 ? (
                    <span className="text-[12px] font-sans text-vapor-500 italic w-full text-center">
                      Nenhum serviço selecionado
                    </span>
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5 text-vapor-300 font-mono text-[12px]">
                        <Clock size={14} className="text-vapor-400 shrink-0" />
                        <span>
                          {totais[nivelKey].duracaoTotal < 60
                            ? `${totais[nivelKey].duracaoTotal} min`
                            : `${Math.floor(totais[nivelKey].duracaoTotal / 60)}h${totais[nivelKey].duracaoTotal % 60
                              ? `${totais[nivelKey].duracaoTotal % 60}min`
                              : ''
                            }`}
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
                            <span className="font-mono text-[16px] font-bold text-amber-400">
                              {formatarMoeda(totais[nivelKey].valorComDesconto)}
                            </span>
                          </div>
                        ) : (
                          <span className="font-mono text-[16px] font-bold text-amber-400">
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
                <div className="flex items-center justify-between border-b border-graphite-800 pb-2">
                  <span className="font-mono text-[11px] text-vapor-400 uppercase tracking-wider">
                    Selecione os Serviços ({itensNivel[nivelKey].size})
                  </span>
                </div>

                {servicosCatalogo.length === 0 ? (
                  <p className="font-sans text-[13px] text-vapor-400 italic py-2">
                    Nenhum serviço disponível no catálogo.
                  </p>
                ) : (
                  Array.from(servicosPorGrupo.entries()).map(([nomeGrupo, servicosDoGrupo]) => {
                    const isExpanded = gruposExpandidos[nomeGrupo] !== false;
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

                                  {/* LINHA 2: DURAÇÃO À ESQUERDA, PREÇO À DIREITA */}
                                  <div className="flex items-center justify-between w-full pt-1.5 border-t border-graphite-800/50 text-[11px] font-mono">
                                    <span className="text-vapor-400 flex items-center gap-1">
                                      <Clock size={11} className="text-vapor-500" />
                                      {serv.duracaoMatriz} min
                                    </span>

                                    {serv.temPrecoCadastrado ? (
                                      <span className="font-bold text-amber-400">
                                        {formatarMoeda(serv.precoMatriz)}
                                      </span>
                                    ) : (
                                      <span className="font-sans text-[10px] font-medium text-amber-500">
                                        Preço não cadastrado para esta categoria
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
            triggerAutoSave(itensNivel, titulosNiveis, descricoesNiveis, val);
          }}
          placeholder="Digite observações específicas deste veículo ou atendimento (ex: veículo possui repintura no capô, prazos de execução, condições de garantia...)"
          rows={3}
          className="w-full bg-graphite-950 border border-graphite-700 rounded-lg p-3 text-vapor-100 font-sans text-[13px] outline-none focus:border-amber-500 resize-none"
        />
      </Card>

      {/* PAINEL FIXO DE COMPARAÇÃO NO RODAPÉ */}
      <div className="fixed bottom-0 left-0 xl:left-[240px] right-0 bg-graphite-800/95 backdrop-blur-md border-t border-graphite-700 p-3 sm:p-4 z-30 shadow-2xl">
        <div className="max-w-6xl mx-auto flex flex-col gap-3">

          {/* BARRA COMPACTA MOBILE E TABLET (< 1280px) */}
          <div className="flex xl:hidden items-center justify-between gap-2">
            <div className="flex flex-col">
              <span className="font-mono text-[10px] text-vapor-400 uppercase font-semibold">
                Nível Ativo ({activeTabMobile.toUpperCase()})
              </span>
              <div className="flex items-center gap-2">
                {totais[activeTabMobile].itensCount === 0 ? (
                  <span className="font-sans text-[12px] text-vapor-500 italic">
                    Nenhum serviço selecionado
                  </span>
                ) : (
                  <>
                    <span className="font-mono text-[15px] font-bold text-amber-400">
                      {totais[activeTabMobile].itensSemPrecoCount === totais[activeTabMobile].itensCount
                        ? 'Preço a definir'
                        : formatarMoeda(totais[activeTabMobile].valorComDesconto)}
                    </span>
                    {totais[activeTabMobile].valorComDesconto < totais[activeTabMobile].valorTotal && (
                      <span className="font-mono text-[11px] text-vapor-500 line-through">
                        {formatarMoeda(totais[activeTabMobile].valorTotal)}
                      </span>
                    )}
                    <span className="font-mono text-[11px] text-vapor-400">
                      • {totais[activeTabMobile].duracaoTotal} min
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                tone="graphite"
                size="sm"
                onClick={() => setExpandComparacaoMobile(!expandComparacaoMobile)}
                className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 min-h-[44px]"
              >
                <span>{expandComparacaoMobile ? 'Ocultar' : 'Comparar 3 Níveis'}</span>
                {expandComparacaoMobile ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </Button>

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

          {/* GRID DE COMPARAÇÃO DOS 3 NÍVEIS (VISÍVEL NO DESKTOP >= 1280px OU EXPANDIDO ABAIXO) */}
          <div className={`flex-col xl:flex-row xl:items-center justify-between gap-4 ${expandComparacaoMobile ? 'flex' : 'hidden xl:flex'}`}>
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
                        {t.duracaoTotal} min
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
          navigate('/orcamentos');
        }}
        title="Salvamento em Andamento"
        mensagem="As alterações do orçamento estão sendo salvas no servidor. Deseja realmente sair agora?"
        textoConfirmar="Sair Sem Aguardar"
        textoCancelar="Permanecer na Tela"
        variant="warning"
      />
    </div>
  );
};
