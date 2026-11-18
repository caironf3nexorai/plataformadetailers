import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { ModalConfirmacao } from '../../components/ui/ModalConfirmacao';
import { Badge } from '../../components/ui/Badge';
import { CampoNumerico } from '../../components/ui/CampoNumerico';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { usePermissao } from '../../hooks/usePermissao';
import { supabase } from '../../lib/supabase';
import type { CategoriaVeiculo, Cliente, Veiculo } from '../../types/clientes';
import { HistoricoServicos } from '../../components/clientes/HistoricoServicos';
import { GarantiasClienteVeiculo } from '../../components/clientes/GarantiasClienteVeiculo';
import { formatTelefone, formatPlaca, cleanTelefone, formatarMoeda, parseNumeroFlexivel } from '../../utils/formatters';
import {
  ArrowLeft,
  Car,
  MessageCircle,
  Plus,
  Save,
  Trash2,
  AlertTriangle,
  Pencil,
  CheckCircle2,
  CreditCard,
} from 'lucide-react';
import { ModalEditarVeiculo, type VeiculoEditavel } from '../../components/clientes/ModalEditarVeiculo';

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
  const [semCelular, setSemCelular] = useState(false);
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
  const [vCor, setVCor] = useState('');
  const [savingVeiculo, setSavingVeiculo] = useState(false);
  const [veiculoError, setVeiculoError] = useState<string | null>(null);

  // Modal Edição de Veículo Existente
  const [showEditVeiculoModal, setShowEditVeiculoModal] = useState(false);
  const [veiculoParaEditar, setVeiculoParaEditar] = useState<VeiculoEditavel | null>(null);

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
      setSemCelular(!clientObj.telefone);
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

    const telTrim = semCelular ? '' : telefone.trim();
    const telDigits = telTrim.replace(/\D/g, '');

    if (!nome.trim()) {
      setFeedbackMsg({ type: 'error', text: 'Nome do cliente é obrigatório.' });
      return;
    }

    if (telTrim && telDigits.length < 8) {
      setFeedbackMsg({
        type: 'error',
        text: 'Informe um telefone / WhatsApp válido (mín. 8 dígitos) ou marque que não possui celular.',
      });
      return;
    }

    setSavingCliente(true);
    setFeedbackMsg(null);

    try {
      const { error } = await supabase
        .from('clientes')
        .update({
          nome: nome.trim(),
          telefone: telTrim || null,
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
      const { error } = await supabase.rpc('inativar_ou_excluir_cliente', {
        p_cliente_id: cliente.id,
      });

      if (error) throw error;

      setShowConfirmDesativar(false);
      navigate('/clientes');
    } catch (err: any) {
      console.error('Erro ao excluir/desativar cliente:', err);
      setFeedbackMsg({ type: 'error', text: 'Não foi possível excluir o cliente: ' + (err.message || 'Erro desconhecido') });
    } finally {
      setDesativandoCliente(false);
    }
  };

  const handleAdicionarVeiculo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cliente || isOperador) return;
    setVeiculoError(null);

    const categoriaFinal = vCategoriaId || categorias[0]?.id || '';
    const temDados = Boolean(vPlaca.trim() || vModelo.trim() || vMarca.trim() || vCor.trim());

    if (!temDados) {
      setVeiculoError('Informe ao menos a placa ou o modelo/marca do veículo.');
      return;
    }

    if (!categoriaFinal) {
      setVeiculoError('Selecione a categoria do veículo.');
      return;
    }

    setSavingVeiculo(true);

    try {
      const cleanPlaca = vPlaca.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

      const { data: _vId, error } = await supabase.rpc('cadastro_rapido', {
        p_nome: cliente.nome,
        p_telefone: cliente.telefone || null,
        p_placa: cleanPlaca || null,
        p_categoria: categoriaFinal,
        p_marca: vMarca.trim() || null,
        p_modelo: vModelo.trim() || null,
        p_cor: vCor.trim() || null,
        p_cliente_id: cliente.id,
      });

      if (error) {
        setVeiculoError(error.message || 'Erro ao cadastrar veículo.');
      } else {
        setShowAddVeiculoModal(false);
        setVPlaca('');
        setVMarca('');
        setVModelo('');
        setVCor('');
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
        <PageHeader title={`Cliente: ${cliente.nome}`} />
      </div>

      {/* Header com Ações Rápida (WhatsApp, Desativar) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-graphite-800 border border-graphite-600 rounded-lg shadow-md">
        <div className="flex items-center gap-3">
          <span className={`font-mono font-bold ${cliente.telefone ? 'text-[16px] text-amber-500' : 'text-[14px] text-vapor-400 italic font-normal'}`}>
            {cliente.telefone || 'Sem telefone cadastrado'}
          </span>
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
              Excluir cliente
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
            <label className="font-sans text-[13px] text-vapor-400 font-medium">Telefone / WhatsApp (Opcional)</label>
            <Input
              type="tel"
              inputMode="tel"
              placeholder={semCelular ? 'Sem celular / WhatsApp' : '(11) 99999-9999'}
              value={telefone}
              onChange={(e) => setTelefone(formatTelefone(e.target.value))}
              disabled={isOperador || savingCliente || semCelular}
              className="min-h-[44px] font-mono disabled:opacity-50"
            />
            {!isOperador && (
              <label className="flex items-center gap-2 cursor-pointer select-none mt-1">
                <input
                  type="checkbox"
                  checked={semCelular}
                  disabled={savingCliente}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setSemCelular(checked);
                    if (checked) setTelefone('');
                  }}
                  className="w-4 h-4 accent-amber-500 rounded bg-graphite-900 border-graphite-600"
                />
                <span className="font-sans text-[12px] text-vapor-300">
                  Cliente não possui celular / WhatsApp
                </span>
              </label>
            )}
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
        <BlocoSaldoCliente clienteId={cliente.id} clienteNome={cliente.nome} tenantId={tenant?.id} />
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
                if (!vCategoriaId && categorias.length > 0) {
                  setVCategoriaId(categorias[0].id);
                }
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

                <div className="font-sans text-[14px] text-vapor-100 font-semibold flex items-center justify-between flex-wrap gap-2">
                  <span>{v.marca || v.modelo ? `${v.marca || ''} ${v.modelo || ''}`.trim() : 'Modelo não informado'}</span>
                  {v.cor ? (
                    <span className="font-sans text-xs text-vapor-200 bg-graphite-700/80 px-2 py-0.5 rounded border border-graphite-600 font-medium">
                      Cor: {v.cor}
                    </span>
                  ) : (
                    <span className="font-sans text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30 font-semibold">
                      ⚠️ Sem cor informada
                    </span>
                  )}
                </div>

                {v.observacoes && (
                  <p className="font-sans text-[12px] text-amber-500 bg-amber-500/10 p-2 rounded border border-amber-500/20">
                    <strong>Obs:</strong> {v.observacoes}
                  </p>
                )}

                <div className="flex items-center justify-between pt-2 border-t border-graphite-700/60 mt-1">
                  <span className="text-[11px] text-vapor-400 group-hover:text-vapor-300">
                    Clique para ver ficha completa
                  </span>
                  {!isOperador && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setVeiculoParaEditar(v);
                        setShowEditVeiculoModal(true);
                      }}
                      className="min-h-[32px] px-2.5 text-[12px] flex items-center gap-1.5"
                    >
                      <Pencil size={13} />
                      Editar Veículo
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Garantias & Proteções Ativas */}
      <div className="mt-2">
        <GarantiasClienteVeiculo clienteId={cliente.id} modo="cliente" />
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
            <label className="font-sans text-[13px] text-vapor-400 font-medium">Placa (Opcional)</label>
            <Input
              type="text"
              placeholder="ABC-1234 (ou deixe em branco)"
              value={vPlaca}
              onChange={(e) => setVPlaca(formatPlaca(e.target.value))}
              className="min-h-[44px] font-mono text-[16px] uppercase tracking-wider text-amber-500 font-bold"
            />
            <span className="font-sans text-[11px] text-vapor-400">
              Se não souber agora, geramos um código provisório e você edita depois.
            </span>
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

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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
            <div className="flex flex-col gap-1">
              <label className="font-sans text-[13px] text-vapor-400 font-medium">Cor</label>
              <Input
                type="text"
                placeholder="Ex: Preto"
                value={vCor}
                onChange={(e) => setVCor(e.target.value)}
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

      {/* Modal Editar Veículo Existente */}
      <ModalEditarVeiculo
        isOpen={showEditVeiculoModal}
        onClose={() => {
          setShowEditVeiculoModal(false);
          setVeiculoParaEditar(null);
        }}
        veiculo={veiculoParaEditar}
        onSuccess={() => {
          fetchClienteDetails();
        }}
      />

      {/* Modal de Confirmação para Excluir / Desativar Cliente */}
      <ModalConfirmacao
        isOpen={showConfirmDesativar}
        onClose={() => setShowConfirmDesativar(false)}
        onConfirm={handleDesativarCliente}
        title="Excluir Cliente"
        mensagem="Deseja realmente remover este cliente? Se não houver histórico vinculado (agendamentos, orçamentos ou pagamentos), ele será excluído definitivamente do banco de dados. Caso já possua histórico, será desativado e ocultado das listas e seletores."
        textoConfirmar="Excluir"
        textoCancelar="Voltar"
        variant="danger"
        loading={desativandoCliente}
      />
    </div>
  );
};

interface HistoricoRecebimentoCliente {
  id: string;
  forma_nome?: string | null;
  forma_tipo?: string | null;
  numero_parcela?: number | null;
  total_parcelas?: number | null;
  valor_bruto?: number | null;
  valor_liquido?: number | null;
  previsto_para?: string | null;
  recebido_em?: string | null;
  status?: string | null;
  origem?: string | null;
  observacao?: string | null;
}

const obterHojeLocalISO = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Componente Auxiliar de Saldo Devedor do Cliente (Dono / Gerente)
const BlocoSaldoCliente: React.FC<{ clienteId: string; clienteNome: string; tenantId?: string }> = ({
  clienteId,
  clienteNome,
  tenantId,
}) => {
  const { showToast } = useToast();
  const [saldo, setSaldo] = useState(0);
  const [historico, setHistorico] = useState<HistoricoRecebimentoCliente[]>([]);
  const [formasQuitacao, setFormasQuitacao] = useState<Array<{ id: string; nome: string; tipo: string }>>([]);
  const [loading, setLoading] = useState(true);

  const [itemBaixa, setItemBaixa] = useState<HistoricoRecebimentoCliente | null>(null);
  const [valorBaixaInput, setValorBaixaInput] = useState('');
  const [formaQuitacaoId, setFormaQuitacaoId] = useState('');
  const [baixando, setBaixando] = useState(false);

  const fetchSaldo = React.useCallback(async () => {
    setLoading(true);
    try {
      const [resSaldo, resFormas] = await Promise.all([
        supabase.rpc('obter_saldo_devedor_cliente', {
          p_cliente_id: clienteId,
        }),
        tenantId
          ? supabase
              .from('tenant_formas_pagamento')
              .select('id, nome, tipo')
              .eq('tenant_id', tenantId)
              .eq('ativo', true)
              .neq('tipo', 'fiado')
              .order('ordem', { ascending: true })
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (!resSaldo.error && resSaldo.data) {
        setSaldo(Number(resSaldo.data.saldo_devedor || 0));
        setHistorico(Array.isArray(resSaldo.data.historico) ? resSaldo.data.historico : []);
      }

      if (!resFormas.error && Array.isArray(resFormas.data)) {
        setFormasQuitacao(resFormas.data as Array<{ id: string; nome: string; tipo: string }>);
      }
    } catch (err) {
      console.error('Erro ao buscar saldo do cliente:', err);
    } finally {
      setLoading(false);
    }
  }, [clienteId, tenantId]);

  useEffect(() => {
    fetchSaldo();
  }, [fetchSaldo]);

  const handleAbrirBaixa = (h: HistoricoRecebimentoCliente) => {
    const bruto = Number(h.valor_bruto ?? 0);
    setItemBaixa(h);
    setValorBaixaInput(bruto.toFixed(2).replace('.', ','));
    if (formasQuitacao.length > 0) {
      const pixDefault = formasQuitacao.find((f) => f.tipo === 'pix') || formasQuitacao[0];
      setFormaQuitacaoId(pixDefault?.id || '');
    } else {
      setFormaQuitacaoId('');
    }
  };

  const handleConfirmarBaixa = async () => {
    if (!itemBaixa) return;
    const valPago = parseNumeroFlexivel(valorBaixaInput);
    if (valPago <= 0) {
      showToast('O valor recebido deve ser maior que zero.', 'error');
      return;
    }

    setBaixando(true);
    try {
      const { data, error } = await supabase.rpc('dar_baixa_recebimento', {
        p_recebimento_id: itemBaixa.id,
        p_valor_pago: valPago,
        p_forma_quitacao_id: formaQuitacaoId || null,
      });

      if (error) throw error;

      showToast(data?.mensagem || 'Baixa registrada com sucesso!', 'success');
      setItemBaixa(null);
      await fetchSaldo();
      window.dispatchEvent(new CustomEvent('financeiro_atualizado'));
    } catch (err: any) {
      console.error('Erro ao dar baixa na ficha do cliente:', err);
      showToast(err?.message || 'Não foi possível dar baixa no título.', 'error');
    } finally {
      setBaixando(false);
    }
  };

  if (loading) {
    return <Card className="p-4 bg-graphite-800 border-graphite-700 animate-pulse h-24"><div /></Card>;
  }

  const hojeIso = obterHojeLocalISO();

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

      <div className="p-4 bg-graphite-900 rounded-lg border border-graphite-700 flex items-center justify-between flex-wrap gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-vapor-400 font-semibold uppercase tracking-wider">
            Saldo Devedor Real (Fiado / A Prazo)
          </span>
          <span className="text-[11px] text-vapor-500">
            Pagamentos já passados no cartão não entram como dívida do cliente
          </span>
        </div>
        <span className={`font-mono text-2xl font-bold ${saldo > 0 ? 'text-amber-400' : 'text-mint-400'}`}>
          {saldo > 0 ? formatarMoeda(saldo) : 'R$ 0,00'}
        </span>
      </div>

      {historico.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-vapor-300">
            Histórico de Títulos e Lançamentos ({historico.length})
          </span>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-sans">
              <thead>
                <tr className="border-b border-graphite-700 text-vapor-400 uppercase text-[10px]">
                  <th className="py-2 px-2">Forma</th>
                  <th className="py-2 px-2 text-center">Parcela</th>
                  <th className="py-2 px-2 text-right">Valor</th>
                  <th className="py-2 px-2 text-center">Vencimento</th>
                  <th className="py-2 px-2 text-center">Status</th>
                  <th className="py-2 px-2 text-center">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-graphite-750">
                {historico.map((h) => {
                  const isCartao = h?.forma_tipo === 'debito' || h?.forma_tipo === 'credito';
                  const statusNorm = (h?.status || '').toLowerCase();
                  const isPrevisto = statusNorm === 'previsto';
                  const isFiadoAberto = isPrevisto && !isCartao;
                  const dataIso = (h?.previsto_para || '').substring(0, 10);
                  const isVencido = isFiadoAberto && Boolean(dataIso) && dataIso < hojeIso;
                  const isVenceHoje = isFiadoAberto && Boolean(dataIso) && dataIso === hojeIso;
                  const bruto = Number(h?.valor_bruto ?? 0);

                  return (
                    <tr key={h.id} className="hover:bg-graphite-750/50">
                      <td className="py-2.5 px-2 text-vapor-200 font-medium">
                        <div className="flex flex-col gap-0.5">
                          <span className="flex items-center gap-1.5">
                            {isCartao && <CreditCard size={12} className="text-sky-400 shrink-0" />}
                            <span>{h?.forma_nome || '—'}</span>
                          </span>
                          {h?.observacao && (
                            <span className="text-[10px] text-vapor-400 italic max-w-xs truncate">
                              {h.observacao}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-2 text-center font-mono text-vapor-400">
                        {h?.numero_parcela || 1}/{h?.total_parcelas || 1}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono font-bold text-vapor-100">
                        {formatarMoeda(bruto)}
                      </td>
                      <td className="py-2.5 px-2 text-center font-mono text-vapor-400">
                        {dataIso ? dataIso.split('-').reverse().join('/') : '—'}
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        {statusNorm === 'recebido' ? (
                          <Badge tone="mint">RECEBIDO</Badge>
                        ) : isPrevisto && isCartao ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-sky-500/15 text-sky-300 border border-sky-500/30 whitespace-nowrap">
                            Pago no Cartão • Repasse Operadora
                          </span>
                        ) : isVencido ? (
                          <Badge tone="flare">VENCIDO</Badge>
                        ) : isVenceHoje ? (
                          <Badge tone="amber">VENCE HOJE</Badge>
                        ) : isPrevisto ? (
                          <Badge tone="amber">EM ABERTO</Badge>
                        ) : (
                          <Badge tone="vapor">{(h?.status || '—').toUpperCase()}</Badge>
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        {isFiadoAberto ? (
                          <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            onClick={() => handleAbrirBaixa(h)}
                            className="text-[11px] px-2.5 py-1 bg-mint-500 hover:bg-mint-400 text-graphite-950 font-bold border-none whitespace-nowrap"
                          >
                            <CheckCircle2 size={12} />
                            Dar Baixa
                          </Button>
                        ) : (
                          <span className="text-[11px] text-vapor-500">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Rápido de Baixa de Fiado na Ficha do Cliente */}
      {itemBaixa && (
        <Modal
          isOpen={Boolean(itemBaixa)}
          onClose={() => setItemBaixa(null)}
          title="Dar Baixa em Título do Cliente"
          maxWidth="md"
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <Button variant="secondary" onClick={() => setItemBaixa(null)} disabled={baixando}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                onClick={handleConfirmarBaixa}
                disabled={baixando}
                className="bg-mint-500 hover:bg-mint-400 text-graphite-950 font-bold"
              >
                {baixando ? 'Confirmando...' : 'Confirmar Recebimento'}
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-4 py-1">
            <div className="p-3 bg-graphite-950 rounded-xl border border-graphite-800 text-xs flex flex-col gap-1">
              <div className="flex justify-between">
                <span className="text-vapor-400">Cliente:</span>
                <span className="font-bold text-vapor-100">{clienteNome}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-vapor-400">Parcela:</span>
                <span className="font-mono text-vapor-200">
                  {itemBaixa.numero_parcela || 1}/{itemBaixa.total_parcelas || 1} •{' '}
                  {itemBaixa.previsto_para ? itemBaixa.previsto_para.substring(0, 10).split('-').reverse().join('/') : '—'}
                </span>
              </div>
              <div className="flex justify-between pt-1 border-t border-graphite-800">
                <span className="text-vapor-400">Valor Previsto:</span>
                <span className="font-mono font-bold text-vapor-100">
                  {formatarMoeda(Number(itemBaixa.valor_bruto ?? 0))}
                </span>
              </div>
            </div>

            {formasQuitacao.length > 0 && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-vapor-200 uppercase tracking-wider">
                  Meio de pagamento recebido hoje
                </label>
                <select
                  value={formaQuitacaoId}
                  onChange={(e) => setFormaQuitacaoId(e.target.value)}
                  className="w-full min-h-[42px] bg-graphite-950 border border-graphite-700 rounded-lg px-3 py-2 text-sm text-vapor-100 outline-none focus:border-amber-500"
                >
                  <option value="">Não especificar</option>
                  {formasQuitacao.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-vapor-200 uppercase tracking-wider">
                Valor Recebido no Caixa (R$)
              </label>
              <CampoNumerico
                prefix="R$"
                placeholder="0,00"
                value={valorBaixaInput}
                onChange={(_val, str) => setValorBaixaInput(str)}
                wrapperClassName="min-h-[44px] bg-graphite-950"
                className="text-lg font-bold text-mint-400"
              />
              <span className="text-[11px] text-vapor-400">
                Pagamentos parciais ou excedentes ajustam automaticamente o saldo das próximas parcelas.
              </span>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
};

