import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { formatarMoeda } from '../../utils/formatters';
import { montarLinkWhatsapp } from '../../utils/whatsapp';
import { Check, Sparkles, Send, Clock } from 'lucide-react';

interface ServicoOpcao {
  id: string;
  nome: string;
  grupo?: string;
  preco_base?: number;
  duracao_minutos?: number;
}

interface ModalOrcamentoComplementarProps {
  isOpen: boolean;
  onClose: () => void;
  agendamentoId: string;
  execucaoId?: string;
  veiculoPlaca?: string;
  veiculoModelo?: string;
  clienteNome?: string;
  clienteTelefone?: string;
  onSuccess: () => void;
}

export const ModalOrcamentoComplementar: React.FC<ModalOrcamentoComplementarProps> = ({
  isOpen,
  onClose,
  agendamentoId,
  execucaoId,
  veiculoPlaca,
  veiculoModelo,
  clienteNome,
  clienteTelefone,
  onSuccess,
}) => {
  const { tenant } = useAuth();
  const { showSuccess, showError } = useToast();

  const [servicos, setServicos] = useState<ServicoOpcao[]>([]);
  const [loadingServicos, setLoadingServicos] = useState(false);

  // Estados do formulário de serviço complementar
  const [servicoId, setServicoId] = useState('');
  const [servicoNomeManual, setServicoNomeManual] = useState('');
  const [preco, setPreco] = useState('');
  const [duracaoMinutos, setDuracaoMinutos] = useState('30');
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !tenant) return;

    const carregarServicos = async () => {
      setLoadingServicos(true);
      try {
        const { data } = await supabase
          .from('servicos')
          .select('id, nome, grupo, preco_base, duracao_minutos')
          .eq('tenant_id', tenant.id)
          .eq('ativo', true)
          .order('nome');

        if (data) {
          setServicos(data as ServicoOpcao[]);
        }
      } catch (err) {
        console.error('[ModalOrcamentoComplementar] Erro ao carregar serviços:', err);
      } finally {
        setLoadingServicos(false);
      }
    };

    carregarServicos();
  }, [isOpen, tenant]);

  const handleSelectServico = (id: string) => {
    setServicoId(id);
    if (!id) {
      setPreco('');
      return;
    }
    const s = servicos.find((item) => item.id === id);
    if (s) {
      setServicoNomeManual(s.nome);
      setPreco(s.preco_base ? String(s.preco_base) : '');
      setDuracaoMinutos(s.duracao_minutos ? String(s.duracao_minutos) : '30');
    }
  };

  // Aprovação imediata do serviço complementar (inserção direta na OS em andamento)
  const handleAprovarEInserir = async () => {
    if (!agendamentoId || !tenant) return;
    const nomeFinal = servicoId ? servicos.find((s) => s.id === servicoId)?.nome : servicoNomeManual.trim();
    if (!nomeFinal) {
      showError('Informe o serviço complementar a ser adicionado.');
      return;
    }

    const valorNumerico = Number(preco.replace(',', '.')) || 0;
    const duracaoNum = Number(duracaoMinutos) || 30;

    setSaving(true);
    try {
      // 1. Inserir em agendamento_itens
      const { data: itemData, error: itemErr } = await supabase
        .from('agendamento_itens')
        .insert({
          tenant_id: tenant.id,
          agendamento_id: agendamentoId,
          servico_id: servicoId || null,
          servico_nome: nomeFinal,
          preco_praticado: valorNumerico,
          duracao_minutos: duracaoNum,
          quantidade: 1,
        })
        .select('id')
        .single();

      if (itemErr) throw itemErr;

      // 2. Se houver execução ativa, cria item no checklist de execução
      if (execucaoId) {
        await supabase.from('execucao_itens').insert({
          tenant_id: tenant.id,
          execucao_id: execucaoId,
          agendamento_item_id: itemData?.id || null,
          servico_nome: nomeFinal,
          descricao: motivo ? `[COMPLEMENTAR] ${nomeFinal} - ${motivo}` : `[COMPLEMENTAR] ${nomeFinal}`,
          concluido: false,
          obrigatorio: false,
          origem: 'avulso',
          ordem: 99,
        });
      }

      // 3. Atualiza valor total do agendamento
      const { data: todosItens } = await supabase
        .from('agendamento_itens')
        .select('preco_praticado')
        .eq('agendamento_id', agendamentoId);

      const novoTotal = (todosItens || []).reduce((acc, it) => acc + Number(it.preco_praticado || 0), 0);
      await supabase
        .from('agendamentos')
        .update({
          preco_total: novoTotal,
          updated_at: new Date().toISOString(),
        })
        .eq('id', agendamentoId);

      showSuccess(`Serviço complementar "${nomeFinal}" adicionado e aprovado com sucesso!`);
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('[Adicionar Complementar Error]:', err);
      showError('Erro ao adicionar serviço complementar: ' + (err?.message || err));
    } finally {
      setSaving(false);
    }
  };

  // Enviar link de autorização rápida no WhatsApp do cliente
  const handleEnviarWhatsAppAutorizacao = () => {
    const nomeFinal = servicoId ? servicos.find((s) => s.id === servicoId)?.nome : servicoNomeManual.trim();
    if (!nomeFinal) {
      showError('Informe o serviço antes de enviar no WhatsApp.');
      return;
    }

    const valorNumerico = Number(preco.replace(',', '.')) || 0;
    const primeiroNome = clienteNome ? clienteNome.split(' ')[0] : 'Cliente';
    const motivoTxt = motivo.trim() ? ` Identificamos durante os trabalhos: ${motivo.trim()}.` : '';

    const mensagem = `Olá, ${primeiroNome}! Aqui é da ${tenant?.nome || 'Oficina'}. Durante o atendimento do seu ${veiculoModelo || 'veículo'} (${veiculoPlaca || ''}), identificamos a recomendação de um serviço complementar: *${nomeFinal}* no valor de *${formatarMoeda(valorNumerico)}*.${motivoTxt}\n\nVocê autoriza a inclusão deste serviço adicional na ordem de serviço?`;

    const link = montarLinkWhatsapp(clienteTelefone, mensagem);
    if (link) {
      window.open(link, '_blank');
      showSuccess('Mensagem de autorização gerada no WhatsApp!');
    } else {
      showError('Telefone do cliente não cadastrado ou inválido.');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Adicionar Serviço Complementar"
      maxWidth="lg"
      icon={<Sparkles className="text-amber-500" size={22} />}
    >
      <div className="flex flex-col gap-4">
        {/* Banner informativo */}
        <div className="p-3.5 bg-gradient-to-r from-amber-500/10 via-graphite-900 to-graphite-900 border border-amber-500/30 rounded-xl flex flex-col gap-1">
          <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
            <Sparkles size={16} />
            <span>Serviço Mapeado Durante a Execução</span>
          </div>
          <p className="text-xs text-vapor-300 leading-relaxed">
            Identificou um detalhe ou serviço extra no veículo? Adicione-o aqui. Uma vez aprovado, ele atualizará automaticamente a lista de serviços contratados e o valor final da OS.
          </p>
        </div>

        {/* Seleção do Serviço */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-vapor-300 uppercase tracking-wide">
            Selecione do Catálogo ou Digite:
          </label>
          <select
            value={servicoId}
            onChange={(e) => handleSelectServico(e.target.value)}
            disabled={loadingServicos}
            className="w-full bg-graphite-900 border border-graphite-700 rounded-lg p-3 text-vapor-100 font-sans text-sm outline-none focus:border-amber-500 disabled:opacity-60"
          >
            <option value="">{loadingServicos ? 'Carregando serviços...' : 'Selecione um serviço existente...'}</option>
            {servicos.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome} {s.preco_base ? `· ${formatarMoeda(s.preco_base)}` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Nome Manual se não escolheu do catálogo */}
        {!servicoId && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-vapor-300 uppercase tracking-wide">
              Nome do Serviço Personalizado *
            </label>
            <Input
              type="text"
              placeholder="Ex: Polimento de Faróis, Remoção de Chuva Ácida..."
              value={servicoNomeManual}
              onChange={(e) => setServicoNomeManual(e.target.value)}
              className="min-h-[44px]"
            />
          </div>
        )}

        {/* Preço e Duração Estimada */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-vapor-300 uppercase tracking-wide">
              Valor Adicional (R$) *
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-3 text-vapor-500 font-mono text-sm">R$</span>
              <Input
                type="text"
                placeholder="0,00"
                value={preco}
                onChange={(e) => setPreco(e.target.value)}
                className="pl-9 font-mono text-base font-bold text-amber-400 min-h-[44px]"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-vapor-300 uppercase tracking-wide">
              Tempo Estimado (minutos)
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-3 text-vapor-500 font-mono text-sm"><Clock size={16} /></span>
              <Input
                type="number"
                placeholder="30"
                value={duracaoMinutos}
                onChange={(e) => setDuracaoMinutos(e.target.value)}
                className="pl-9 font-mono min-h-[44px]"
              />
            </div>
          </div>
        </div>

        {/* Motivo / Detalhe identificado */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-vapor-300 uppercase tracking-wide">
            Observações / Por que é necessário? (Opcional)
          </label>
          <textarea
            rows={2}
            placeholder="Ex: Identificado verniz queimado no teto / motor muito contaminado com graxa seca..."
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className="w-full bg-graphite-900 border border-graphite-700 rounded-lg p-3 text-vapor-100 placeholder-vapor-600 font-sans text-xs outline-none focus:border-amber-500"
          />
        </div>

        {/* Ações de Confirmação */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-3 border-t border-graphite-800">
          <Button
            type="button"
            variant="ghost"
            onClick={handleEnviarWhatsAppAutorizacao}
            className="flex items-center justify-center gap-2 text-emerald-400 hover:bg-emerald-500/10 text-xs font-semibold h-11"
          >
            <Send size={15} />
            <span>Pedir Autorização via WhatsApp</span>
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={saving}
              className="text-xs h-11 px-4"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleAprovarEInserir}
              disabled={saving}
              className="text-xs font-bold h-11 px-5 flex items-center gap-2 bg-gradient-to-r from-amber-500 to-yellow-500 text-graphite-950 shadow-md"
            >
              <Check size={16} />
              <span>{saving ? 'Adicionando...' : 'Aprovar e Inserir na OS'}</span>
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
