import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { ModalConfirmacao } from '../../components/ui/ModalConfirmacao';
import { Badge } from '../../components/ui/Badge';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissao } from '../../hooks/usePermissao';
import { supabase } from '../../lib/supabase';
import type { CategoriaVeiculo, Cliente, Veiculo } from '../../types/clientes';
import { HistoricoServicos } from '../../components/clientes/HistoricoServicos';
import { formatTelefone, formatPlaca, cleanTelefone } from '../../utils/formatters';
import {
  ArrowLeft,
  Car,
  MessageCircle,
  Plus,
  Save,
  Trash2,
  AlertTriangle,
} from 'lucide-react';

export const DetalheCliente: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { tenant } = useAuth();
  const { isDono, isOperador } = usePermissao();

  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [categorias, setCategorias] = useState<CategoriaVeiculo[]>([]);
  const docInputRef = React.useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);

  // Form de edição do cliente
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [documento, setDocumento] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [savingCliente, setSavingCliente] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modal Novo Veículo
  const [showAddVeiculoModal, setShowAddVeiculoModal] = useState(false);
  const [vPlaca, setVPlaca] = useState('');
  const [vCategoriaId, setVCategoriaId] = useState('');
  const [vMarca, setVMarca] = useState('');
  const [vModelo, setVModelo] = useState('');
  const [savingVeiculo, setSavingVeiculo] = useState(false);
  const [veiculoError, setVeiculoError] = useState<string | null>(null);

  const fetchClienteDetails = async () => {
    if (!id || !tenant) return;
    setLoading(true);

    try {
      // Busca dados do cliente
      const { data: cData, error: cErr } = await supabase
        .from('clientes')
        .select('*')
        .eq('id', id)
        .eq('tenant_id', tenant.id)
        .single();

      if (cErr || !cData) {
        navigate('/clientes');
        return;
      }

      const clientObj = cData as Cliente;
      const docVal = clientObj.documento || (clientObj as any).cpf_cnpj || '';
      setCliente(clientObj);
      setNome(clientObj.nome);
      setTelefone(formatTelefone(clientObj.telefone));
      setEmail(clientObj.email || '');
      setDocumento(docVal);
      setObservacoes(clientObj.observacoes || '');

      // Foco automático se for cadastro online incompleto
      if ((clientObj.origem === 'online' || (clientObj.origem as string) === 'agendamento_online') && !docVal) {
        setTimeout(() => {
          docInputRef.current?.focus();
        }, 150);
      }

      // Busca veículos do cliente
      const { data: vData } = await supabase
        .from('veiculos')
        .select('*, categoria:categorias_veiculo(*)')
        .eq('cliente_id', id)
        .eq('tenant_id', tenant.id)
        .eq('ativo', true)
        .order('created_at', { ascending: false });

      if (vData) {
        setVeiculos(vData as Veiculo[]);
      }

      // Busca categorias para o modal de inclusão de veículo
      const { data: catData } = await supabase
        .from('categorias_veiculo')
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('ativo', true)
        .order('ordem', { ascending: true });

      if (catData && catData.length > 0) {
        setCategorias(catData as CategoriaVeiculo[]);
        setVCategoriaId(catData[0].id);
      }
    } catch (err) {
      console.error('Erro ao carregar detalhes do cliente:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClienteDetails();
  }, [id, tenant]);

  const handleSalvarCliente = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isOperador || !cliente) return;
    setSavingCliente(true);
    setFeedbackMsg(null);

    try {
      const { error } = await supabase
        .from('clientes')
        .update({
          nome: nome.trim(),
          telefone: telefone.trim(),
          email: email.trim() || null,
          documento: documento.trim() || null,
          observacoes: observacoes.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', cliente.id);

      if (error) {
        setFeedbackMsg({ type: 'error', text: error.message || 'Erro ao atualizar cliente.' });
      } else {
        setFeedbackMsg({ type: 'success', text: 'Dados do cliente atualizados com sucesso!' });
        await fetchClienteDetails();
      }
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'Erro ao salvar.' });
    } finally {
      setSavingCliente(false);
    }
  };

  const [showConfirmDesativar, setShowConfirmDesativar] = useState(false);
  const [desativandoCliente, setDesativandoCliente] = useState(false);

  const handleDesativarCliente = async () => {
    if (!isDono || !cliente) return;
    setDesativandoCliente(true);

    try {
      const { error } = await supabase
        .from('clientes')
        .update({ ativo: false, updated_at: new Date().toISOString() })
        .eq('id', cliente.id);

      if (!error) {
        setShowConfirmDesativar(false);
        navigate('/clientes');
      }
    } catch (err) {
      console.error('Erro ao desativar cliente:', err);
    } finally {
      setDesativandoCliente(false);
    }
  };

  const handleAdicionarVeiculo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cliente || isOperador) return;
    setVeiculoError(null);

    if (!vPlaca.trim() || !vCategoriaId) {
      setVeiculoError('Placa e categoria são obrigatórias.');
      return;
    }

    setSavingVeiculo(true);

    try {
      const cleanPlaca = vPlaca.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

      const { data: _vId, error } = await supabase.rpc('cadastro_rapido', {
        p_nome: cliente.nome,
        p_telefone: cliente.telefone,
        p_placa: cleanPlaca,
        p_categoria: vCategoriaId,
        p_marca: vMarca.trim() || null,
        p_modelo: vModelo.trim() || null,
      });

      if (error) {
        setVeiculoError(error.message || 'Erro ao cadastrar veículo.');
      } else {
        setShowAddVeiculoModal(false);
        setVPlaca('');
        setVMarca('');
        setVModelo('');
        await fetchClienteDetails();
      }
    } catch (err: any) {
      setVeiculoError(err?.message || 'Erro inesperado.');
    } finally {
      setSavingVeiculo(false);
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

  if (!cliente) return null;

  const rawPhone = cleanTelefone(cliente.telefone);
  const whatsappUrl = `https://wa.me/55${rawPhone}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={() => navigate('/clientes')}
          className="min-h-[40px] px-3"
        >
          <ArrowLeft size={18} />
          Voltar
        </Button>
        <PageHeader title={`Cliente: ${cliente.nome}`} />
      </div>

      {/* Header com Ações Rápida (WhatsApp, Desativar) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-graphite-800 border border-graphite-600 rounded-lg shadow-md">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[16px] text-amber-500 font-bold">{cliente.telefone}</span>
          <Badge tone={cliente.origem === 'online' ? 'mint' : 'glass'}>
            {cliente.origem.toUpperCase()}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          {rawPhone && (
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
              <Button type="button" variant="primary" className="min-h-[44px] px-4 bg-emerald-600 hover:bg-emerald-500 text-white border-none">
                <MessageCircle size={18} />
                Conversar no WhatsApp
              </Button>
            </a>
          )}

          {isDono && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowConfirmDesativar(true)}
              className="min-h-[44px] px-3 text-flare-400 hover:bg-flare-400/10 hover:text-flare-400"
            >
              <Trash2 size={18} />
              Desativar cliente
            </Button>
          )}
        </div>
      </div>

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

      {/* Formulário de Dados do Cliente */}
      <Card className="p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-4 shadow-xl">
        <h3 className="font-display text-[18px] text-vapor-100 uppercase tracking-wide">
          Dados do Cliente
        </h3>

        <form onSubmit={handleSalvarCliente} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-vapor-400 font-medium">Nome Completo *</label>
            <Input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              disabled={isOperador || savingCliente}
              required
              className="min-h-[44px]"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-vapor-400 font-medium">Telefone / WhatsApp *</label>
            <Input
              type="tel"
              inputMode="tel"
              value={telefone}
              onChange={(e) => setTelefone(formatTelefone(e.target.value))}
              disabled={isOperador || savingCliente}
              required
              className="min-h-[44px] font-mono"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-vapor-400 font-medium">E-mail</label>
            <Input
              type="email"
              placeholder="cliente@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isOperador || savingCliente}
              className="min-h-[44px]"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-vapor-400 font-medium">Documento (CPF/CNPJ)</label>
            <Input
              ref={docInputRef}
              type="text"
              placeholder="000.000.000-00"
              value={documento}
              onChange={(e) => setDocumento(e.target.value)}
              disabled={isOperador || savingCliente}
              className="min-h-[44px]"
            />
          </div>

          <div className="sm:col-span-2 flex flex-col gap-1">
            <label className="font-sans text-[13px] text-vapor-400 font-medium">Observações Gerais</label>
            <textarea
              rows={2}
              placeholder="Ex: Cliente preferencial, exige nota fiscal..."
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              disabled={isOperador || savingCliente}
              className="p-3 bg-graphite-900 border border-graphite-600 rounded text-vapor-100 font-sans text-[14px] outline-none focus:border-amber-500 transition-colors"
            />
          </div>

          {!isOperador && (
            <div className="sm:col-span-2 flex justify-end mt-2">
              <Button type="submit" variant="primary" disabled={savingCliente} className="min-h-[44px] px-6 font-semibold">
                <Save size={18} />
                {savingCliente ? 'Salvando...' : 'Salvar Alterações'}
              </Button>
            </div>
          )}
        </form>
      </Card>

      {/* Cartão de Saldo Devedor e Recebimentos (Visível apenas para Gestão) */}
      {!isOperador && cliente && (
        <BlocoSaldoCliente clienteId={cliente.id} />
      )}

      {/* Seção de Veículos do Cliente */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-[18px] text-vapor-100 uppercase tracking-wide flex items-center gap-2">
            <Car size={20} className="text-amber-500" />
            Veículos Cadastrados ({veiculos.length})
          </h3>

          {!isOperador && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setVeiculoError(null);
                setShowAddVeiculoModal(true);
              }}
              className="min-h-[40px] px-3 text-[13px]"
            >
              <Plus size={16} />
              Adicionar Veículo
            </Button>
          )}
        </div>

        {veiculos.length === 0 ? (
          <Card className="p-6 bg-graphite-800 border-graphite-600 text-center">
            <p className="font-sans text-[14px] text-vapor-400 italic">Nenhum veículo vinculado a este cliente.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {veiculos.map((v) => (
              <Card
                key={v.id}
                onClick={() => navigate(`/veiculos/${v.id}`)}
                className="p-5 bg-graphite-800 border-graphite-600 hover:border-amber-500/50 cursor-pointer transition-all flex flex-col gap-3 group"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[18px] text-amber-500 font-bold group-hover:underline">
                    {v.placa}
                  </span>
                  {v.categoria && <Badge tone="mint">{v.categoria.nome}</Badge>}
                </div>

                <div className="font-sans text-[14px] text-vapor-100 font-semibold">
                  {v.marca || v.modelo ? `${v.marca || ''} ${v.modelo || ''}`.trim() : 'Modelo não informado'}
                </div>

                {v.observacoes && (
                  <p className="font-sans text-[12px] text-amber-500 bg-amber-500/10 p-2 rounded border border-amber-500/20">
                    <strong>Obs:</strong> {v.observacoes}
                  </p>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Histórico de Serviços */}
      <div className="mt-2">
        <HistoricoServicos clienteId={cliente.id} modo="cliente" />
      </div>

      {/* Modal Adicionar Veículo */}
      <Modal
        isOpen={showAddVeiculoModal}
        onClose={() => setShowAddVeiculoModal(false)}
        title={`Novo Veículo para ${cliente.nome}`}
        icon={<Car size={20} className="text-amber-500" />}
        maxWidth="md"
      >
        {veiculoError && (
          <div className="p-3 bg-flare-400/10 border border-flare-400/30 rounded text-flare-400 text-[13px] flex items-center gap-2">
            <AlertTriangle size={16} />
            <span>{veiculoError}</span>
          </div>
        )}

        <form onSubmit={handleAdicionarVeiculo} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-vapor-400 font-medium">Placa *</label>
            <Input
              type="text"
              placeholder="ABC-1234"
              value={vPlaca}
              onChange={(e) => setVPlaca(formatPlaca(e.target.value))}
              required
              className="min-h-[44px] font-mono text-[16px] uppercase tracking-wider text-amber-500 font-bold"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-vapor-400 font-medium">Categoria *</label>
            <select
              value={vCategoriaId}
              onChange={(e) => setVCategoriaId(e.target.value)}
              className="min-h-[44px] px-3 bg-graphite-900 border border-graphite-600 rounded text-vapor-100 font-sans text-[14px]"
            >
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome} {c.descricao ? `(${c.descricao})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="font-sans text-[13px] text-vapor-400 font-medium">Marca</label>
              <Input
                type="text"
                placeholder="Chevrolet"
                value={vMarca}
                onChange={(e) => setVMarca(e.target.value)}
                className="min-h-[44px]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-sans text-[13px] text-vapor-400 font-medium">Modelo</label>
              <Input
                type="text"
                placeholder="Onix"
                value={vModelo}
                onChange={(e) => setVModelo(e.target.value)}
                className="min-h-[44px]"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-2 pt-3 border-t border-graphite-700">
            <Button type="button" variant="ghost" onClick={() => setShowAddVeiculoModal(false)} className="min-h-[44px]">
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={savingVeiculo} className="min-h-[44px]">
              {savingVeiculo ? 'Salvando...' : 'Cadastrar Veículo'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal de Confirmação para Desativar Cliente */}
      <ModalConfirmacao
        isOpen={showConfirmDesativar}
        onClose={() => setShowConfirmDesativar(false)}
        onConfirm={handleDesativarCliente}
        title="Desativar Cliente"
        mensagem="Deseja realmente desativar este cliente? Ele não aparecerá nas listagens principais da oficina."
        textoConfirmar="Desativar"
        textoCancelar="Voltar"
        variant="danger"
        loading={desativandoCliente}
      />
    </div>
  );
};

// Componente Auxiliar de Saldo Devedor do Cliente (Dono / Gerente)
const BlocoSaldoCliente: React.FC<{ clienteId: string }> = ({ clienteId }) => {
  const [saldo, setSaldo] = useState(0);
  const [historico, setHistorico] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSaldo = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc('obter_saldo_devedor_cliente', {
          p_cliente_id: clienteId,
        });

        if (!error && data) {
          setSaldo(Number(data.saldo_devedor || 0));
          setHistorico(data.historico || []);
        }
      } catch (err) {
        console.error('Erro ao buscar saldo do cliente:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchSaldo();
  }, [clienteId]);

  if (loading) {
    return <Card className="p-4 bg-graphite-800 border-graphite-700 animate-pulse h-24"><div /></Card>;
  }

  return (
    <Card className="p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-4 shadow-xl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-display text-[18px] text-vapor-100 uppercase tracking-wide">
          Situação Financeira do Cliente
        </h3>
        <Badge tone={saldo > 0 ? 'amber' : 'mint'}>
          {saldo > 0 ? 'Possui Débitos Pendentes' : 'Em Dia'}
        </Badge>
      </div>

      <div className="p-4 bg-graphite-900 rounded-lg border border-graphite-700 flex items-center justify-between">
        <span className="text-xs text-vapor-400 font-semibold uppercase tracking-wider">Saldo Devedor / A Receber</span>
        <span className={`font-mono text-2xl font-bold ${saldo > 0 ? 'text-amber-400' : 'text-mint-400'}`}>
          {saldo > 0 ? `R$ ${saldo.toFixed(2).replace('.', ',')}` : 'R$ 0,00'}
        </span>
      </div>

      {historico.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-vapor-300">Histórico de Títulos e Lançamentos ({historico.length})</span>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-sans">
              <thead>
                <tr className="border-b border-graphite-700 text-vapor-400 uppercase text-[10px]">
                  <th className="py-2 px-2">Forma</th>
                  <th className="py-2 px-2 text-center">Parcela</th>
                  <th className="py-2 px-2 text-right">Valor</th>
                  <th className="py-2 px-2 text-center">Vencimento</th>
                  <th className="py-2 px-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-graphite-750">
                {historico.map((h: any) => (
                  <tr key={h.id} className="hover:bg-graphite-750/50">
                    <td className="py-2 px-2 text-vapor-200 font-medium">{h.forma_nome || '—'}</td>
                    <td className="py-2 px-2 text-center font-mono text-vapor-400">{h.numero_parcela}/{h.total_parcelas}</td>
                    <td className="py-2 px-2 text-right font-mono font-bold text-vapor-100">
                      R$ {Number(h.valor_bruto).toFixed(2).replace('.', ',')}
                    </td>
                    <td className="py-2 px-2 text-center font-mono text-vapor-400">
                      {h.previsto_para ? h.previsto_para.split('-').reverse().join('/') : '—'}
                    </td>
                    <td className="py-2 px-2 text-center">
                      <Badge tone={h.status === 'recebido' ? 'mint' : h.status === 'previsto' ? 'amber' : 'vapor'}>
                        {h.status.toUpperCase()}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
};

