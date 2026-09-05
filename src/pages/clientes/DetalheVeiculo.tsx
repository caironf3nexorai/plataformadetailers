import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { CampoNumerico } from '../../components/ui/CampoNumerico';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissao } from '../../hooks/usePermissao';
import { supabase } from '../../lib/supabase';
import type { Cliente, Veiculo, VeiculoDono } from '../../types/clientes';
import { HistoricoServicos } from '../../components/clientes/HistoricoServicos';
import type { HistoricoConsumoItem } from '../../types/estoque';
import {
  ArrowLeft,
  User,
  History,
  ArrowRightLeft,
  AlertTriangle,
  Save,
  Package,
  Calendar,
  Palette,
} from 'lucide-react';

import { formatarData } from '../../utils/datas';

export const DetalheVeiculo: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { tenant, membership } = useAuth();
  const { isOperador } = usePermissao();
  const podeVerCusto = membership?.role === 'dono' || membership?.role === 'gerente';

  const [veiculo, setVeiculo] = useState<Veiculo | null>(null);
  const [historicoDonos, setHistoricoDonos] = useState<VeiculoDono[]>([]);
  const [historicoConsumo, setHistoricoConsumo] = useState<HistoricoConsumoItem[]>([]);
  const [clienteAtual, setClienteAtual] = useState<Cliente | null>(null);
  const [loading, setLoading] = useState(true);

  // Form de edição do veículo
  const [marca, setMarca] = useState('');
  const [modelo, setModelo] = useState('');
  const [cor, setCor] = useState('');
  const [ano, setAno] = useState<string>('');
  const [observacoes, setObservacoes] = useState('');
  const [savingVeiculo, setSavingVeiculo] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modal de Transferência de Veículo
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [clientesDisponiveis, setClientesDisponiveis] = useState<Cliente[]>([]);
  const [novoClienteId, setNovoClienteId] = useState('');
  const [dataTransferencia, setDataTransferencia] = useState(new Date().toISOString().split('T')[0]);
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  const fetchVeiculoDetails = async () => {
    if (!id || !tenant) return;
    setLoading(true);

    try {
      // Busca dados do veículo com categoria e cliente
      const { data: vData, error: vErr } = await supabase
        .from('veiculos')
        .select('*, categoria:categorias_veiculo(*), cliente:clientes(*)')
        .eq('id', id)
        .eq('tenant_id', tenant.id)
        .single();

      if (vErr || !vData) {
        navigate('/clientes');
        return;
      }

      const vObj = vData as Veiculo;
      setVeiculo(vObj);
      setClienteAtual(vObj.cliente as Cliente || null);
      setMarca(vObj.marca || '');
      setModelo(vObj.modelo || '');
      setCor(vObj.cor || '');
      setAno(vObj.ano ? String(vObj.ano) : '');
      setObservacoes(vObj.observacoes || '');

      // Busca histórico de proprietários
      const { data: hData } = await supabase
        .from('veiculo_donos')
        .select('*, cliente:clientes(nome, telefone)')
        .eq('veiculo_id', id)
        .eq('tenant_id', tenant.id)
        .order('inicio', { ascending: false });

      if (hData) {
        setHistoricoDonos(hData as VeiculoDono[]);
      }

      // Busca histórico de consumo de produtos (apenas gestão)
      if (podeVerCusto) {
        const { data: cData } = await supabase.rpc('historico_consumo_veiculo', { p_veiculo: id });
        if (cData) {
          setHistoricoConsumo(cData as HistoricoConsumoItem[]);
        }
      }
    } catch (err) {
      console.error('Erro ao carregar veículo:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVeiculoDetails();
  }, [id, tenant, podeVerCusto]);

  const handleSalvarVeiculo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isOperador || !veiculo) return;
    setSavingVeiculo(true);
    setFeedbackMsg(null);

    try {
      const { error } = await supabase
        .from('veiculos')
        .update({
          marca: marca.trim() || null,
          modelo: modelo.trim() || null,
          cor: cor.trim() || null,
          ano: ano ? parseInt(ano, 10) : null,
          observacoes: observacoes.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', veiculo.id);

      if (error) {
        setFeedbackMsg({ type: 'error', text: error.message || 'Erro ao atualizar veículo.' });
      } else {
        setFeedbackMsg({ type: 'success', text: 'Dados do veículo salvos com sucesso!' });
        await fetchVeiculoDetails();
      }
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'Erro ao salvar.' });
    } finally {
      setSavingVeiculo(false);
    }
  };

  const handleOpenTransferModal = async () => {
    if (!tenant) return;
    setTransferError(null);
    setShowTransferModal(true);

    const { data } = await supabase
      .from('clientes')
      .select('*')
      .eq('tenant_id', tenant.id)
      .eq('ativo', true)
      .order('nome', { ascending: true });

    if (data) {
      const list = (data as Cliente[]).filter((c) => c.id !== clienteAtual?.id);
      setClientesDisponiveis(list);
      if (list.length > 0) setNovoClienteId(list[0].id);
    }
  };

  const handleTransferirVeiculo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!veiculo || !novoClienteId || isOperador) return;
    setTransferring(true);
    setTransferError(null);

    try {
      const { error } = await supabase.rpc('transferir_veiculo', {
        p_veiculo: veiculo.id,
        p_novo_cliente: novoClienteId,
        p_data: dataTransferencia,
      });

      if (error) {
        setTransferError(error.message || 'Erro ao transferir veículo.');
      } else {
        setShowTransferModal(false);
        await fetchVeiculoDetails();
      }
    } catch (err: any) {
      setTransferError(err?.message || 'Erro inesperado.');
    } finally {
      setTransferring(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="h-8 bg-graphite-700 rounded w-1/4 animate-pulse" />
        <Card className="p-6 bg-graphite-800 border-graphite-600 animate-pulse h-64">
          <div />
        </Card>
      </div>
    );
  }

  if (!veiculo) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            if (window.history.state && window.history.state.idx > 0) {
              navigate(-1);
            } else {
              navigate('/clientes');
            }
          }}
          className="min-h-[40px] px-3"
          title="Voltar para a página anterior"
        >
          <ArrowLeft size={18} />
          Voltar
        </Button>
        <PageHeader title={`Veículo ${veiculo.placa}`} />
      </div>

      {/* Header com Destaque de Placa e Proprietário Atual */}
      <div className="p-6 bg-graphite-800 border border-graphite-600 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-lg">
        <div className="flex flex-col gap-1">
          <span className="font-sans text-[13px] text-vapor-400">Placa do Veículo:</span>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[32px] sm:text-[40px] font-extrabold text-amber-500 tracking-wider">
              {veiculo.placa}
            </span>
            {veiculo.categoria && (
              <Badge tone="mint">
                {veiculo.categoria.nome}
              </Badge>
            )}
            {veiculo.cor ? (
              <span className="font-mono text-[13px] px-2.5 py-1 bg-graphite-900 border border-graphite-700 rounded text-vapor-200 font-semibold flex items-center gap-1.5">
                <Palette size={14} className="text-amber-400" />
                Cor: {veiculo.cor}
              </span>
            ) : (
              <span className="font-mono text-[12px] px-2.5 py-1 bg-amber-500/10 border border-amber-500/30 rounded text-amber-400 font-semibold flex items-center gap-1.5">
                ⚠️ Sem cor informada
              </span>
            )}
          </div>
        </div>

        {/* Proprietário Atual */}
        <div className="flex items-center justify-between md:justify-end gap-4 p-4 bg-graphite-900/80 border border-graphite-700 rounded-md">
          <div className="flex items-center gap-3">
            <User className="text-amber-500" size={24} />
            <div className="flex flex-col">
              <span className="font-sans text-[12px] text-vapor-400">Proprietário Atual:</span>
              <span
                onClick={() => clienteAtual && navigate(`/clientes/${clienteAtual.id}`)}
                className="font-sans text-[16px] font-bold text-vapor-100 hover:text-amber-500 cursor-pointer transition-colors"
              >
                {clienteAtual ? clienteAtual.nome : 'Sem proprietário vinculado'}
              </span>
            </div>
          </div>

          {!isOperador && (
            <Button
              type="button"
              variant="secondary"
              onClick={handleOpenTransferModal}
              className="min-h-[40px] px-3 text-[13px]"
            >
              <ArrowRightLeft size={16} />
              Transferir
            </Button>
          )}
        </div>
      </div>

      {/* Bloco Destacado de Observações */}
      <Card className="p-5 bg-amber-500/10 border-2 border-amber-500/40 rounded-lg flex flex-col gap-2">
        <div className="flex items-center gap-2 text-amber-500 font-bold font-display uppercase tracking-wide">
          <AlertTriangle size={20} />
          <span>Observações e Avarias do Veículo</span>
        </div>
        <p className="font-sans text-[14px] text-vapor-100 leading-relaxed">
          {veiculo.observacoes || 'Nenhuma observação registrada para este veículo.'}
        </p>
      </Card>

      {feedbackMsg && (
        <div
          className={`p-3 rounded text-[13px] flex items-center gap-2 border ${
            feedbackMsg.type === 'success'
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-500'
              : 'bg-flare-400/10 border-flare-400/30 text-flare-400'
          }`}
        >
          <AlertTriangle size={18} className="shrink-0" />
          <span>{feedbackMsg.text}</span>
        </div>
      )}

      {/* Edição de Dados Técnicos do Veículo */}
      <Card className="p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-4 shadow-xl">
        <h3 className="font-display text-[18px] text-vapor-100 uppercase tracking-wide">
          Dados do Veículo
        </h3>

        <form onSubmit={handleSalvarVeiculo} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-vapor-400 font-medium">Marca</label>
            <Input
              type="text"
              placeholder="Ex: Volkswagen"
              value={marca}
              onChange={(e) => setMarca(e.target.value)}
              disabled={isOperador || savingVeiculo}
              className="min-h-[44px]"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-vapor-400 font-medium">Modelo</label>
            <Input
              type="text"
              placeholder="Ex: Golf GTI"
              value={modelo}
              onChange={(e) => setModelo(e.target.value)}
              disabled={isOperador || savingVeiculo}
              className="min-h-[44px]"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-vapor-400 font-medium flex items-center gap-1.5">
              <Palette size={14} className="text-amber-400" />
              Cor do Veículo
            </label>
            <Input
              type="text"
              placeholder="Ex: Preto Ninja, Branco..."
              value={cor}
              onChange={(e) => setCor(e.target.value)}
              disabled={isOperador || savingVeiculo}
              className="min-h-[44px]"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-vapor-400 font-medium">Ano</label>
            <CampoNumerico
              integerOnly
              placeholder="Ex: 2021"
              value={ano}
              onChange={(_, valStr) => setAno(valStr)}
              disabled={isOperador || savingVeiculo}
              wrapperClassName="min-h-[44px]"
            />
          </div>

          <div className="sm:col-span-2 md:col-span-4 flex flex-col gap-1">
            <label className="font-sans text-[13px] text-vapor-400 font-medium">
              Observações (riscos, detalhes do vidro, restrições)
            </label>
            <textarea
              rows={3}
              placeholder="Ex: Para-choque dianteiro já riscado. Cliente não quer cera no parabrisa."
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              disabled={isOperador || savingVeiculo}
              className="p-3 bg-graphite-900 border border-graphite-600 rounded text-vapor-100 font-sans text-[14px] outline-none focus:border-amber-500 transition-colors"
            />
          </div>

          {!isOperador && (
            <div className="sm:col-span-2 md:col-span-4 flex justify-end mt-2">
              <Button type="submit" variant="primary" disabled={savingVeiculo} className="min-h-[44px] px-6 font-semibold">
                <Save size={18} />
                {savingVeiculo ? 'Salvando...' : 'Salvar Alterações'}
              </Button>
            </div>
          )}
        </form>
      </Card>

      {/* Histórico de Proprietários */}
      <Card className="p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-4 shadow-xl">
        <h3 className="font-display text-[18px] text-vapor-100 uppercase tracking-wide flex items-center gap-2">
          <History size={20} className="text-amber-500" />
          Histórico de Proprietários
        </h3>

        {historicoDonos.length === 0 ? (
          <p className="font-sans text-[14px] text-vapor-400 italic">Nenhum histórico registrado.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {historicoDonos.map((h) => {
              const isCurrent = h.fim === null;
              return (
                <div
                  key={h.id}
                  className={`p-3 rounded border flex items-center justify-between ${
                    isCurrent
                      ? 'bg-amber-500/10 border-amber-500/40 text-vapor-100'
                      : 'bg-graphite-900/60 border-graphite-700 text-vapor-400'
                  }`}
                >
                  <div className="flex flex-col">
                    <span className="font-sans text-[14px] font-bold text-vapor-100">
                      {(h.cliente as any)?.nome || 'Cliente não encontrado'}
                    </span>
                    <span className="font-mono text-[12px] text-vapor-400">
                      {(h.cliente as any)?.telefone}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-right font-mono text-[12px]">
                      <div>Início: {formatarData(h.inicio)}</div>
                      <div>{h.fim ? `Fim: ${formatarData(h.fim)}` : 'Proprietário Atual'}</div>
                    </div>
                    {isCurrent && <Badge tone="amber">ATUAL</Badge>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Histórico de Serviços Executados neste Veículo */}
      <div>
        <HistoricoServicos veiculoId={veiculo.id} modo="veiculo" />
      </div>

      {/* HISTÓRICO DE PRODUTOS JÁ USADOS NESTE VEÍCULO (PROMPT 8 - Visível Apenas Gestão) */}
      {podeVerCusto && (
        <Card className="p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-4 shadow-xl">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-[18px] text-vapor-100 uppercase tracking-wide flex items-center gap-2">
              <Package size={20} className="text-amber-500" />
              Produtos já usados neste veículo
            </h3>
            <span className="text-[11px] text-vapor-400 uppercase tracking-wide font-sans">
              Visível apenas para Gestão
            </span>
          </div>

          {historicoConsumo.length === 0 ? (
            <p className="font-sans text-[14px] text-vapor-400 italic">
              Nenhum produto consumido registrado em atendimentos deste veículo.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {historicoConsumo.map((item, idx) => (
                <div
                  key={`${item.execucao_id}-${idx}`}
                  className="p-3 bg-graphite-900/80 border border-graphite-700 rounded flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[13px]"
                >
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2 font-bold text-vapor-100">
                      <span>{item.produto_nome}</span>
                      {item.produto_marca && (
                        <span className="text-[11px] text-vapor-400 font-normal">
                          ({item.produto_marca})
                        </span>
                      )}
                    </div>
                    <span className="text-[12px] text-amber-500">{item.servicos_nomes}</span>
                  </div>

                  <div className="flex items-center gap-4 shrink-0 justify-between sm:justify-end">
                    <div className="flex items-center gap-1.5 text-vapor-300 font-mono text-[12px]">
                      <Calendar size={14} className="text-vapor-400" />
                      <span>{item.concluido_em ? formatarData(item.concluido_em) : 'Data N/D'}</span>
                    </div>

                    <div className="flex items-center gap-3 font-mono text-[13px]">
                      <span className="text-vapor-100 font-semibold">
                        {item.quantidade} {item.unidade_uso}
                      </span>
                      <span className="text-emerald-400 font-bold">
                        R$ {Number(item.custo_total).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Modal Transferir Veículo */}
      <Modal
        isOpen={showTransferModal}
        onClose={() => setShowTransferModal(false)}
        title={`Transferir Veículo ${veiculo.placa}`}
        icon={<ArrowRightLeft size={20} className="text-amber-500" />}
        maxWidth="md"
      >
        {transferError && (
          <div className="p-3 bg-flare-400/10 border border-flare-400/30 rounded text-flare-400 text-[13px] flex items-center gap-2">
            <AlertTriangle size={16} />
            <span>{transferError}</span>
          </div>
        )}

        <form onSubmit={handleTransferirVeiculo} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-vapor-400 font-medium">Novo Proprietário *</label>
            <select
              value={novoClienteId}
              onChange={(e) => setNovoClienteId(e.target.value)}
              required
              className="min-h-[44px] px-3 bg-graphite-900 border border-graphite-600 rounded text-vapor-100 font-sans text-[14px]"
            >
              {clientesDisponiveis.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome} ({c.telefone})
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-vapor-400 font-medium">Data da Transferência *</label>
            <Input
              type="date"
              value={dataTransferencia}
              onChange={(e) => setDataTransferencia(e.target.value)}
              required
              className="min-h-[44px] font-mono"
            />
          </div>

          <p className="font-sans text-[12px] text-vapor-400 leading-relaxed bg-graphite-900/60 p-3 rounded border border-graphite-700">
            Esta ação encerrará a propriedade de <strong>{clienteAtual?.nome || 'Proprietário atual'}</strong> na data selecionada e iniciará o vínculo do novo cliente.
          </p>

          <div className="flex justify-end gap-2 mt-2 pt-3 border-t border-graphite-700">
            <Button type="button" variant="ghost" onClick={() => setShowTransferModal(false)} className="min-h-[44px]">
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={transferring} className="min-h-[44px]">
              {transferring ? 'Transferindo...' : 'Confirmar Transferência'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
