import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { CampoNumerico } from '../ui/CampoNumerico';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { formatarMoeda } from '../../utils/formatters';
import type { Cliente, Veiculo } from '../../types/clientes';
import {
  Calendar,
  Clock,
  Car,
  User,
  Plus,
  Trash2,
  CheckCircle2,
  CreditCard,
  Sparkles,
} from 'lucide-react';

interface ServicoItem {
  id: string;
  nome: string;
  duracao_minutos: number;
  preco_padrao: number;
}

interface ServicoSelecionado {
  servico_id: string;
  nome: string;
  duracao_minutos: number;
  valor: number;
}

interface MembroEquipe {
  id: string;
  nome?: string | null;
  role: string;
}

interface FormaPagamento {
  id: string;
  nome: string;
  tipo: string;
  permite_parcelar?: boolean;
}

interface ModalLancarServicoRetroativoProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (resultado: { agendamentoId: string; execucaoId: string; numeroOS: number }) => void;
}

export const ModalLancarServicoRetroativo: React.FC<ModalLancarServicoRetroativoProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { tenant } = useAuth();
  const { showSuccess, showError } = useToast();

  // Estados de dados do tenant
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [servicosCatalogo, setServicosCatalogo] = useState<ServicoItem[]>([]);
  const [membrosEquipe, setMembrosEquipe] = useState<MembroEquipe[]>([]);
  const [formasPagamento, setFormasPagamento] = useState<FormaPagamento[]>([]);
  const [carregandoDados, setCarregandoDados] = useState(false);

  // Estados do formulário
  const [dataHora, setDataHora] = useState<string>(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  const [clienteId, setClienteId] = useState<string>('');
  const [veiculoId, setVeiculoId] = useState<string>('');
  const [servicosSelecionados, setServicosSelecionados] = useState<ServicoSelecionado[]>([]);
  const [servicoParaAdicionar, setServicoParaAdicionar] = useState<string>('');
  const [executorId, setExecutorId] = useState<string>('');
  const [formaPagamentoId, setFormaPagamentoId] = useState<string>('');
  const [parcelas, setParcelas] = useState<number>(1);
  const [observacoes, setObservacoes] = useState<string>('');
  const [salvando, setSalvando] = useState(false);

  // Carrega dados iniciais ao abrir o modal
  useEffect(() => {
    if (!isOpen || !tenant) return;

    const carregarTudo = async () => {
      setCarregandoDados(true);
      try {
        const [resClientes, resServicos, resMembros, resFormas] = await Promise.all([
          supabase
            .from('clientes')
            .select('id, nome, telefone, veiculos:veiculos(*)')
            .eq('tenant_id', tenant.id)
            .eq('ativo', true)
            .order('nome', { ascending: true }),
          supabase
            .from('servicos')
            .select('id, nome, duracao_minutos, preco_padrao')
            .eq('tenant_id', tenant.id)
            .eq('ativo', true)
            .order('nome', { ascending: true }),
          supabase
            .from('tenant_members')
            .select('id, nome, role')
            .eq('tenant_id', tenant.id)
            .order('nome', { ascending: true }),
          supabase
            .from('tenant_formas_pagamento')
            .select('id, nome, tipo, permite_parcelar')
            .eq('tenant_id', tenant.id)
            .eq('ativo', true)
            .order('ordem', { ascending: true }),
        ]);

        if (resClientes.data) setClientes(resClientes.data as any);
        if (resServicos.data) setServicosCatalogo(resServicos.data as ServicoItem[]);
        if (resMembros.data) setMembrosEquipe(resMembros.data as MembroEquipe[]);
        if (resFormas.data) {
          setFormasPagamento(resFormas.data as FormaPagamento[]);
          if (resFormas.data.length > 0 && !formaPagamentoId) {
            setFormaPagamentoId(resFormas.data[0].id);
          }
        }
      } catch (err: any) {
        console.error('[ModalLancarServicoRetroativo] Erro ao carregar dados:', err);
      } finally {
        setCarregandoDados(false);
      }
    };

    carregarTudo();
  }, [isOpen, tenant]);

  // Atualiza veículos quando cliente muda
  useEffect(() => {
    if (!clienteId) {
      setVeiculos([]);
      setVeiculoId('');
      return;
    }

    const c = clientes.find((item) => item.id === clienteId);
    if (c && (c as any).veiculos) {
      const vList = (c as any).veiculos as Veiculo[];
      setVeiculos(vList);
      if (vList.length > 0) {
        setVeiculoId(vList[0].id);
      } else {
        setVeiculoId('');
      }
    } else {
      setVeiculos([]);
      setVeiculoId('');
    }
  }, [clienteId, clientes]);

  // Atalhos rápidos de data
  const aplicarAtalhoData = (tipo: 'hoje_cedo' | 'ontem_tarde' | 'dois_dias_atras') => {
    const agora = new Date();
    if (tipo === 'hoje_cedo') {
      agora.setHours(9, 0, 0, 0);
    } else if (tipo === 'ontem_tarde') {
      agora.setDate(agora.getDate() - 1);
      agora.setHours(14, 0, 0, 0);
    } else if (tipo === 'dois_dias_atras') {
      agora.setDate(agora.getDate() - 2);
      agora.setHours(10, 0, 0, 0);
    }
    agora.setMinutes(agora.getMinutes() - agora.getTimezoneOffset());
    setDataHora(agora.toISOString().slice(0, 16));
  };

  // Adicionar serviço à lista
  const handleAdicionarServico = () => {
    if (!servicoParaAdicionar) return;
    const srv = servicosCatalogo.find((s) => s.id === servicoParaAdicionar);
    if (!srv) return;

    if (servicosSelecionados.some((s) => s.servico_id === srv.id)) {
      showError('Este serviço já foi adicionado ao atendimento.');
      return;
    }

    setServicosSelecionados((prev) => [
      ...prev,
      {
        servico_id: srv.id,
        nome: srv.nome,
        duracao_minutos: srv.duracao_minutos || 60,
        valor: Number(srv.preco_padrao) || 0,
      },
    ]);
    setServicoParaAdicionar('');
  };

  const handleRemoverServico = (servicoIdParaRemover: string) => {
    setServicosSelecionados((prev) => prev.filter((s) => s.servico_id !== servicoIdParaRemover));
  };

  const handleAlterarValorServico = (servicoIdAlvo: string, novoValor: number) => {
    setServicosSelecionados((prev) =>
      prev.map((s) => (s.servico_id === servicoIdAlvo ? { ...s, valor: novoValor } : s))
    );
  };

  // Cálculos de totais
  const valorTotalServicos = servicosSelecionados.reduce((acc, s) => acc + (Number(s.valor) || 0), 0);
  const duracaoTotalMinutos = servicosSelecionados.reduce((acc, s) => acc + (Number(s.duracao_minutos) || 60), 0);

  // Submissão do lançamento retroativo
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant) return;

    if (!clienteId) {
      showError('Por favor, selecione o cliente.');
      return;
    }

    if (servicosSelecionados.length === 0) {
      showError('Adicione ao menos um serviço realizado.');
      return;
    }

    if (!dataHora) {
      showError('Informe a data e o horário da realização do serviço.');
      return;
    }

    setSalvando(true);
    try {
      const dataIso = new Date(dataHora).toISOString();

      const servicosPayload = servicosSelecionados.map((s) => ({
        servico_id: s.servico_id,
        valor: Number(s.valor) || 0,
        duracao_minutos: Number(s.duracao_minutos) || 60,
      }));

      const formaEscolhida = formasPagamento.find((f) => f.id === formaPagamentoId);
      const pagamentosPayload = formaPagamentoId && valorTotalServicos > 0
        ? [
            {
              forma_id: formaPagamentoId,
              valor_bruto: valorTotalServicos,
              total_parcelas: formaEscolhida?.permite_parcelar ? Math.max(1, parcelas) : 1,
              numero_parcela: 1,
              previsto_para: dataIso.split('T')[0],
            },
          ]
        : [];

      const { data, error } = await supabase.rpc('lancar_atendimento_retroativo', {
        p_cliente_id: clienteId,
        p_veiculo_id: veiculoId || null,
        p_data_realizacao: dataIso,
        p_servicos: servicosPayload,
        p_pagamentos: pagamentosPayload,
        p_executor_id: executorId || null,
        p_observacoes: observacoes.trim() || null,
      });

      if (error) throw error;

      showSuccess(data?.mensagem || 'Atendimento retroativo lançado com sucesso!');
      if (onSuccess && data) {
        onSuccess({
          agendamentoId: data.agendamento_id,
          execucaoId: data.execucao_id,
          numeroOS: data.numero_os,
        });
      }
      onClose();
    } catch (err: any) {
      console.error('[ModalLancarServicoRetroativo] Erro:', err);
      showError(err.message || 'Erro ao lançar serviço retroativo.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Lançar Serviço Já Realizado"
      icon={<Sparkles size={20} className="text-amber-500" />}
      maxWidth="2xl"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5 py-1">
        {/* Banner Informativo */}
        <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-3 text-xs text-amber-200">
          <Clock size={18} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-semibold text-amber-300">Lançamento Retroativo / Atendimento Concluído</p>
            <p className="text-vapor-300">
              Ideal para registrar serviços realizados na correria ou fora do sistema. O atendimento já nascerá
              concluído, com número de OS, comissão calculada e faturamento registrado na data informada.
            </p>
          </div>
        </div>

        {/* 1. Data e Horário de Realização */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-vapor-200 flex items-center gap-1.5">
              <Calendar size={14} className="text-amber-400" />
              Quando o serviço foi feito? *
            </label>
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="text-vapor-400">Atalhos:</span>
              <button
                type="button"
                onClick={() => aplicarAtalhoData('hoje_cedo')}
                className="px-2 py-0.5 rounded bg-graphite-800 text-vapor-300 hover:text-white border border-graphite-700"
              >
                Hoje 09h
              </button>
              <button
                type="button"
                onClick={() => aplicarAtalhoData('ontem_tarde')}
                className="px-2 py-0.5 rounded bg-graphite-800 text-vapor-300 hover:text-white border border-graphite-700"
              >
                Ontem 14h
              </button>
              <button
                type="button"
                onClick={() => aplicarAtalhoData('dois_dias_atras')}
                className="px-2 py-0.5 rounded bg-graphite-800 text-vapor-300 hover:text-white border border-graphite-700"
              >
                Anteontem
              </button>
            </div>
          </div>
          <Input
            type="datetime-local"
            value={dataHora}
            onChange={(e) => setDataHora(e.target.value)}
            className="min-h-[44px] bg-graphite-900 border-graphite-700 font-mono text-vapor-100"
            required
          />
        </div>

        {/* 2. Cliente & Veículo */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {/* Seletor de Cliente */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-vapor-200 flex items-center gap-1.5">
              <User size={14} className="text-amber-400" />
              Cliente *
            </label>
            <select
              value={clienteId}
              onChange={(e) => setClienteId(e.target.value)}
              className="min-h-[44px] bg-graphite-900 border border-graphite-700 rounded-lg px-3 text-sm text-vapor-100 outline-none focus:border-amber-500"
              required
            >
              <option value="">Selecione o cliente...</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome} {c.telefone ? `(${c.telefone})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Seletor de Veículo */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-vapor-200 flex items-center gap-1.5">
              <Car size={14} className="text-amber-400" />
              Veículo do Cliente
            </label>
            <select
              value={veiculoId}
              onChange={(e) => setVeiculoId(e.target.value)}
              disabled={!clienteId || veiculos.length === 0}
              className="min-h-[44px] bg-graphite-900 border border-graphite-700 rounded-lg px-3 text-sm text-vapor-100 outline-none focus:border-amber-500 disabled:opacity-50"
            >
              <option value="">
                {!clienteId
                  ? 'Selecione um cliente primeiro'
                  : veiculos.length === 0
                  ? 'Nenhum veículo cadastrado'
                  : 'Selecione o veículo...'}
              </option>
              {veiculos.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.placa ? `[${v.placa}]` : ''} {v.modelo || 'Veículo'} {v.marca || ''} {v.cor ? `(${v.cor})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 3. Serviços Realizados */}
        <div className="space-y-3 bg-graphite-900/60 p-4 rounded-xl border border-graphite-800">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-vapor-200 flex items-center gap-1.5">
              <CheckCircle2 size={14} className="text-amber-400" />
              Serviços Realizados *
            </label>
            <span className="text-xs text-vapor-400 font-mono">
              Total: <strong className="text-emerald-400">{formatarMoeda(valorTotalServicos)}</strong>
              {duracaoTotalMinutos > 0 && ` • ~${duracaoTotalMinutos} min`}
            </span>
          </div>

          {/* Adicionar Serviço */}
          <div className="flex items-center gap-2">
            <select
              value={servicoParaAdicionar}
              onChange={(e) => setServicoParaAdicionar(e.target.value)}
              className="flex-1 min-h-[42px] bg-graphite-950 border border-graphite-700 rounded-lg px-3 text-xs text-vapor-100 outline-none focus:border-amber-500"
            >
              <option value="">Selecione um serviço para adicionar...</option>
              {servicosCatalogo.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome} — {formatarMoeda(Number(s.preco_padrao) || 0)}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="secondary"
              onClick={handleAdicionarServico}
              disabled={!servicoParaAdicionar}
              className="min-h-[42px] px-3.5 text-xs font-semibold"
            >
              <Plus size={15} />
              Adicionar
            </Button>
          </div>

          {/* Lista de Serviços Adicionados */}
          {servicosSelecionados.length === 0 ? (
            <div className="py-4 text-center text-xs text-vapor-400 border border-dashed border-graphite-700 rounded-lg">
              Nenhum serviço adicionado ainda. Escolha no seletor acima.
            </div>
          ) : (
            <div className="space-y-2">
              {servicosSelecionados.map((srv) => (
                <div
                  key={srv.servico_id}
                  className="flex items-center justify-between gap-3 p-2.5 bg-graphite-950 rounded-lg border border-graphite-800"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-vapor-100 truncate">{srv.nome}</p>
                    <p className="text-[11px] text-vapor-400">{srv.duracao_minutos} minutos</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-vapor-400">R$</span>
                      <CampoNumerico
                        placeholder="0,00"
                        value={String(srv.valor || '')}
                        onChange={(_v, str) => handleAlterarValorServico(srv.servico_id, Number(str.replace(',', '.')) || 0)}
                        wrapperClassName="w-24 min-h-[34px] bg-graphite-900 border-graphite-700"
                        className="text-xs font-bold text-emerald-400 text-right"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoverServico(srv.servico_id)}
                      className="p-1.5 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded"
                      title="Remover serviço"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 4. Executor & Pagamento */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {/* Executor / Equipe */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-vapor-200 flex items-center gap-1.5">
              <User size={14} className="text-amber-400" />
              Profissional / Executor (Comissão)
            </label>
            <select
              value={executorId}
              onChange={(e) => setExecutorId(e.target.value)}
              className="min-h-[44px] bg-graphite-900 border border-graphite-700 rounded-lg px-3 text-sm text-vapor-100 outline-none focus:border-amber-500"
            >
              <option value="">Não especificar (ou o próprio dono)</option>
              {membrosEquipe.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome || 'Membro'} ({m.role})
                </option>
              ))}
            </select>
            <span className="text-[11px] text-vapor-400">
              Se houver regra de comissão cadastrada, o cálculo será automático.
            </span>
          </div>

          {/* Forma de Pagamento */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-vapor-200 flex items-center gap-1.5">
              <CreditCard size={14} className="text-amber-400" />
              Como foi pago?
            </label>
            <select
              value={formaPagamentoId}
              onChange={(e) => setFormaPagamentoId(e.target.value)}
              className="min-h-[44px] bg-graphite-900 border border-graphite-700 rounded-lg px-3 text-sm text-vapor-100 outline-none focus:border-amber-500"
            >
              <option value="">Ainda não recebido / Fiado sem forma</option>
              {formasPagamento.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome} ({f.tipo})
                </option>
              ))}
            </select>

            {/* Parcelas se permitir parcelar */}
            {formasPagamento.find((f) => f.id === formaPagamentoId)?.permite_parcelar && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-vapor-300">Parcelas:</span>
                <select
                  value={parcelas}
                  onChange={(e) => setParcelas(Number(e.target.value) || 1)}
                  className="min-h-[32px] bg-graphite-950 border border-graphite-700 rounded px-2 text-xs text-vapor-100"
                >
                  {[1, 2, 3, 4, 5, 6, 10, 12].map((n) => (
                    <option key={n} value={n}>
                      {n}x de {formatarMoeda(valorTotalServicos / n)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* 5. Observações */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold uppercase tracking-wider text-vapor-200">
            Observações Técnicas / Notas do Atendimento (Opcional)
          </label>
          <textarea
            rows={2}
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
            placeholder="Ex: Cliente trouxe o carro no sábado sem agendamento prévio. Serviço executado e aprovado no balcão."
            className="p-3 bg-graphite-900 border border-graphite-700 rounded-lg text-sm text-vapor-100 outline-none focus:border-amber-500 resize-none"
          />
        </div>

        {/* Rodapé / Botões */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-graphite-800">
          <Button type="button" variant="ghost" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={salvando || carregandoDados}
            className="bg-amber-500 hover:bg-amber-400 text-graphite-950 font-bold min-h-[44px] px-6 flex items-center gap-2"
          >
            <CheckCircle2 size={17} />
            {salvando ? 'Lançando Atendimento...' : 'Salvar Atendimento Concluído'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
