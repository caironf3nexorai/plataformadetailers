import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { PageHeader } from '../components/layout/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { EmptyState } from '../components/ui/EmptyState';
import { ScrollableTabs } from '../components/ui/ScrollableTabs';
import {
  FileText,
  Plus,
  Search,
  Send,
  CheckCircle2,
  TrendingUp,
  AlertCircle,
  ChevronRight,
  Calendar
} from 'lucide-react';
import type { Orcamento } from '../types/orcamento';
import type { Cliente, Veiculo, CategoriaVeiculo } from '../types/clientes';
import { getLabelFromStatusOrcamento, getBadgeToneFromStatusOrcamento } from '../utils/orcamento';
import { formatarData } from '../utils/datas';
import { formatarCodigoProposta, formatarMoeda } from '../utils/formatters';

export const Orcamentos: React.FC = () => {
  const navigate = useNavigate();
  const { tenant } = useAuth();
  const { showError } = useToast();

  const [orcamentos, setOrcamentos] = useState<Orcamento[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Filtros
  const [busca, setBusca] = useState<string>('');
  const [statusFiltro, setStatusFiltro] = useState<string>('todos');

  // Modal de Criação
  const [showModal, setShowModal] = useState<boolean>(false);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [categorias, setCategorias] = useState<CategoriaVeiculo[]>([]);

  const [clienteId, setClienteId] = useState<string>('');
  const [veiculoId, setVeiculoId] = useState<string>('');
  const [categoriaId, setCategoriaId] = useState<string>('');
  const [titulo, setTitulo] = useState<string>('');
  const [creating, setCreating] = useState<boolean>(false);

  const fetchOrcamentos = async () => {
    if (!tenant) return;
    setLoading(true);

    try {
      // Chama expirar_orcamentos antes de listar para garantir status atualizados
      await supabase.rpc('expirar_orcamentos', { p_tenant: tenant.id });

      const { data, error } = await supabase
        .from('orcamentos')
        .select(`
          *,
          cliente:clientes(id, nome, telefone),
          veiculo:veiculos(id, placa, modelo, marca),
          categoria:categorias_veiculo(id, nome),
          niveis:orcamento_niveis(id, nivel, titulo, valor_total, duracao_total, destaque)
        `)
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false });

      if (!error && data) {
        setOrcamentos(data as Orcamento[]);
      }
    } catch (err) {
      console.error('[Orcamentos] Erro ao carregar orçamentos:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchDadosFormulario = async () => {
    if (!tenant) return;
    try {
      const [resClientes, resCategorias] = await Promise.all([
        supabase.from('clientes').select('*').eq('tenant_id', tenant.id).order('nome'),
        supabase.from('categorias_veiculo').select('*').eq('tenant_id', tenant.id).order('nome'),
      ]);

      if (resClientes.data) setClientes(resClientes.data as Cliente[]);
      if (resCategorias.data) setCategorias(resCategorias.data as CategoriaVeiculo[]);
    } catch (err) {
      console.error('[Orcamentos] Erro ao carregar dados do formulário:', err);
    }
  };

  useEffect(() => {
    fetchOrcamentos();
    fetchDadosFormulario();
  }, [tenant?.id]);

  // Carrega veículos do cliente selecionado no modal
  useEffect(() => {
    if (!clienteId || !tenant) {
      setVeiculos([]);
      setVeiculoId('');
      return;
    }

    const fetchVeiculosDoCliente = async () => {
      const { data } = await supabase
        .from('veiculos')
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('cliente_id', clienteId);

      if (data) {
        setVeiculos(data as Veiculo[]);
        if (data.length > 0) {
          setVeiculoId(data[0].id);
          if (data[0].categoria_id) {
            setCategoriaId(data[0].categoria_id);
          }
        } else {
          setVeiculoId('');
        }
      }
    };

    fetchVeiculosDoCliente();
  }, [clienteId, tenant?.id]);

  const handleCriarOrcamento = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clienteId || !tenant) return;

    setCreating(true);
    try {
      const { data: newId, error } = await supabase.rpc('criar_orcamento', {
        p_cliente: clienteId,
        p_veiculo: veiculoId || null,
        p_categoria: categoriaId || null,
        p_titulo: titulo.trim() || null,
      });

      if (error) throw error;
      if (newId) {
        setShowModal(false);
        navigate(`/orcamentos/${newId}`);
      }
    } catch (err: any) {
      showError('Não foi possível criar o orçamento. Tente novamente.', err);
    } finally {
      setCreating(false);
    }
  };

  // Cálculo de Indicadores
  const enviadosAguardando = orcamentos.filter(
    (o) => o.status === 'enviado' || o.status === 'visualizado'
  ).length;

  const inicioMesAtual = new Date();
  inicioMesAtual.setDate(1);
  inicioMesAtual.setHours(0, 0, 0, 0);

  const aprovadosNoMes = orcamentos.filter((o) => {
    if (o.status !== 'aprovado') return false;
    const dt = new Date(o.updated_at || o.created_at);
    return dt >= inicioMesAtual;
  }).length;

  const totalEnviadosOuRespondidos = orcamentos.filter(
    (o) => o.status !== 'rascunho'
  ).length;

  const totalAprovadosGeral = orcamentos.filter((o) => o.status === 'aprovado').length;

  const taxaConversao = totalEnviadosOuRespondidos > 0
    ? ((totalAprovadosGeral / totalEnviadosOuRespondidos) * 100).toFixed(1)
    : '0.0';

  const aprovadosAguardandoAgendamento = orcamentos.filter(
    (o) => o.status === 'aprovado' && !o.agendamento_id
  );

  // Filtragem da Lista
  const orcamentosFiltrados = orcamentos.filter((o) => {
    // Filtro Status
    if (statusFiltro !== 'todos' && o.status !== statusFiltro) {
      return false;
    }

    // Filtro Busca
    if (busca.trim()) {
      const q = busca.toLowerCase().trim();
      const numStr = o.numero.toString();
      const osNumStr = o.numero_os ? o.numero_os.toString() : '';
      const clienteNome = o.cliente?.nome?.toLowerCase() || '';
      const veiculoPlaca = o.veiculo?.placa?.toLowerCase() || '';
      const tituloStr = o.titulo?.toLowerCase() || '';

      const matchNum = numStr.includes(q) || q.includes(numStr) || (osNumStr && osNumStr.includes(q));
      const matchCliente = clienteNome.includes(q);
      const matchVeiculo = veiculoPlaca.includes(q);
      const matchTitulo = tituloStr.includes(q);

      return matchNum || matchCliente || matchVeiculo || matchTitulo;
    }

    return true;
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Orçamentos"
        action={
          <Button
            tone="amber"
            onClick={() => {
              setClienteId('');
              setVeiculoId('');
              setCategoriaId('');
              setTitulo('');
              setShowModal(true);
            }}
            className="flex items-center gap-2"
          >
            <Plus size={18} />
            <span>Novo Orçamento</span>
          </Button>
        }
      />

      {/* INDICADORES NO TOPO */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 bg-graphite-900 border-graphite-700 flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[12px] font-sans text-vapor-400 uppercase tracking-wider">
              Enviados Aguardando
            </span>
            <span className="font-mono text-[28px] font-bold text-amber-400">
              {enviadosAguardando}
            </span>
          </div>
          <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20 text-amber-400">
            <Send size={24} />
          </div>
        </Card>

        <Card className="p-4 bg-graphite-900 border-graphite-700 flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[12px] font-sans text-vapor-400 uppercase tracking-wider">
              Aprovados no Mês
            </span>
            <span className="font-mono text-[28px] font-bold text-emerald-400">
              {aprovadosNoMes}
            </span>
          </div>
          <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-400">
            <CheckCircle2 size={24} />
          </div>
        </Card>

        <Card className="p-4 bg-graphite-900 border-graphite-700 flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[12px] font-sans text-vapor-400 uppercase tracking-wider">
              Taxa de Conversão
            </span>
            <span className="font-mono text-[28px] font-bold text-cyan-400">
              {taxaConversao}%
            </span>
          </div>
          <div className="p-3 bg-cyan-500/10 rounded-xl border border-cyan-500/20 text-cyan-400">
            <TrendingUp size={24} />
          </div>
        </Card>
      </div>

      {/* BANNER: APROVADOS AGUARDANDO AGENDAMENTO */}
      {aprovadosAguardandoAgendamento.length > 0 && (
        <Card className="p-4 bg-emerald-500/10 border-emerald-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/20 rounded-lg text-emerald-400 shrink-0">
              <AlertCircle size={24} />
            </div>
            <div className="flex flex-col">
              <span className="font-sans font-bold text-[15px] text-vapor-100">
                {aprovadosAguardandoAgendamento.length} {aprovadosAguardandoAgendamento.length === 1 ? 'orçamento aprovado aguardando agendamento' : 'orçamentos aprovados aguardando agendamento'}
              </span>
              <span className="font-sans text-[13px] text-vapor-300">
                O cliente já aceitou a proposta! Clique para escolher o dia e horário.
              </span>
            </div>
          </div>

          <Button
            tone="emerald"
            size="sm"
            onClick={() => navigate(`/orcamentos/${aprovadosAguardandoAgendamento[0].id}`)}
            className="shrink-0"
          >
            Agendar Agora
          </Button>
        </Card>
      )}

      {/* BARRA DE FILTROS E BUSCA */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-graphite-900 p-4 rounded-xl border border-graphite-800">
        {/* Chips de Status Roláveis com Indicador de Scroll */}
        <div className="flex-1 min-w-0">
          <ScrollableTabs
            items={[
              { id: 'todos', label: 'Todos' },
              { id: 'rascunho', label: 'Rascunho' },
              { id: 'enviado', label: 'Enviado' },
              { id: 'visualizado', label: 'Visualizado' },
              { id: 'aprovado', label: 'Aprovado' },
              { id: 'recusado', label: 'Recusado' },
              { id: 'expirado', label: 'Expirado' },
            ]}
            activeId={statusFiltro}
            onChange={(id) => setStatusFiltro(id)}
            variant="sport"
            showQuickSelect={true}
            quickSelectTitle="Filtrar por Status"
          />
        </div>

        {/* Campo de Busca */}
        <div className="relative min-w-[240px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-vapor-400" />
          <input
            type="text"
            placeholder="Buscar por OS, cliente ou placa..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full bg-graphite-800 border border-graphite-700 rounded-lg pl-9 pr-3 py-1.5 font-sans text-[13px] text-vapor-100 focus:outline-none focus:border-amber-500"
          />
        </div>
      </div>

      {/* LISTAGEM DE ORÇAMENTOS */}
      {loading ? (
        <div className="flex flex-col gap-3">
          <div className="h-20 bg-graphite-800 rounded-xl animate-pulse" />
          <div className="h-20 bg-graphite-800 rounded-xl animate-pulse" />
          <div className="h-20 bg-graphite-800 rounded-xl animate-pulse" />
        </div>
      ) : orcamentosFiltrados.length === 0 ? (
        <EmptyState
          icon={<FileText size={48} strokeWidth={1.5} />}
          title="Nenhum orçamento encontrado."
          description={
            statusFiltro !== 'todos' || busca
              ? 'Tente alterar os filtros ou o termo de busca.'
              : 'Monte um a partir da sua tabela de serviços e envie o link para o cliente aprovar.'
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {orcamentosFiltrados.map((orc) => {
            // Pega o nível destacado (Recomendado) ou o primeiro para exibir o valor de referência
            const nivelDestaque = orc.niveis?.find((n) => n.destaque) || orc.niveis?.find((n) => n.nivel === 'recomendado') || orc.niveis?.[0];
            const valorReferencia = nivelDestaque ? nivelDestaque.valor_total : 0;

            return (
              <Card
                key={orc.id}
                onClick={() => navigate(`/orcamentos/${orc.id}`)}
                className="p-4 cursor-pointer hover:border-amber-500/50 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 group"
              >
                {/* Lado Esquerdo: Código (ORC / OS), Cliente, Veículo */}
                <div className="flex items-center gap-4">
                  <div className="flex flex-col items-center justify-center bg-graphite-800 px-3.5 py-2 rounded-lg border border-graphite-700 shrink-0 min-w-[95px]">
                    <span className="font-mono text-[10px] text-vapor-400 uppercase tracking-wider">
                      {orc.numero_os ? 'Ordem Serviço' : 'Orçamento'}
                    </span>
                    <span className={`font-mono text-[16px] font-bold ${orc.numero_os ? 'text-cyan-400' : 'text-amber-400'}`}>
                      {formatarCodigoProposta(orc)}
                    </span>
                  </div>

                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-sans text-[15px] font-bold text-vapor-100 group-hover:text-amber-400 transition-colors">
                        {orc.cliente?.nome || 'Cliente não informado'}
                      </span>
                      {orc.titulo && (
                        <span className="text-[12px] text-vapor-400 bg-graphite-800 px-2 py-0.5 rounded font-sans">
                          {orc.titulo}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-[13px] text-vapor-400 font-sans flex-wrap">
                      {orc.veiculo ? (
                        <span className="font-mono font-medium text-vapor-300">
                          {orc.veiculo.placa} ({orc.veiculo.modelo || 'Sem modelo'})
                        </span>
                      ) : (
                        <span>Sem veículo associado</span>
                      )}

                      <span className="text-graphite-600">•</span>
                      <span className="flex items-center gap-1">
                        <Calendar size={13} />
                        {formatarData(orc.created_at)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Lado Direito: Status, Valor Recomendado e Setinha */}
                <div className="flex items-center gap-4 shrink-0 justify-between sm:justify-end">
                  <div className="flex flex-col items-end gap-1">
                    <Badge tone={getBadgeToneFromStatusOrcamento(orc.status)}>
                      {getLabelFromStatusOrcamento(orc.status)}
                    </Badge>

                    <span className="font-mono text-[13px] text-vapor-300">
                      Rec.: <strong className="text-amber-400">{formatarMoeda(valorReferencia)}</strong>
                    </span>
                  </div>

                  <ChevronRight size={18} className="text-vapor-500 group-hover:text-amber-400 transition-colors" />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* MODAL NOVO ORÇAMENTO */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title="Novo Orçamento em Níveis"
      >
        <form onSubmit={handleCriarOrcamento} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="font-sans text-[13px] font-bold text-vapor-200">
              Cliente <span className="text-amber-500">*</span>
            </label>
            <select
              value={clienteId}
              onChange={(e) => setClienteId(e.target.value)}
              required
              className="bg-graphite-900 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 font-sans text-[14px] focus:border-amber-500 focus:outline-none"
            >
              <option value="">Selecione um cliente...</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome} {c.telefone ? `(${c.telefone})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-sans text-[13px] font-bold text-vapor-200">
              Veículo
            </label>
            <select
              value={veiculoId}
              onChange={(e) => setVeiculoId(e.target.value)}
              disabled={!clienteId || veiculos.length === 0}
              className="bg-graphite-900 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 font-sans text-[14px] focus:border-amber-500 focus:outline-none disabled:opacity-50"
            >
              <option value="">
                {!clienteId
                  ? 'Selecione um cliente primeiro...'
                  : veiculos.length === 0
                    ? 'Nenhum veículo cadastrado para este cliente'
                    : 'Selecione um veículo...'}
              </option>
              {veiculos.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.placa} - {v.modelo || 'Sem modelo'}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-sans text-[13px] font-bold text-vapor-200">
              Categoria do Veículo (para preços da matriz) <span className="text-amber-500">*</span>
            </label>
            <select
              value={categoriaId}
              onChange={(e) => setCategoriaId(e.target.value)}
              required
              className="bg-graphite-900 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 font-sans text-[14px] focus:border-amber-500 focus:outline-none"
            >
              <option value="">Selecione a categoria...</option>
              {categorias.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.nome}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-sans text-[13px] font-bold text-vapor-200">
              Título do Orçamento (Opcional)
            </label>
            <input
              type="text"
              placeholder="Ex: Detalhamento de Pintura e Proteção"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              className="bg-graphite-900 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 font-sans text-[14px] focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-3 mt-4">
            <Button
              type="button"
              tone="graphite"
              onClick={() => setShowModal(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              tone="amber"
              loading={creating}
            >
              Criar e Montar Níveis
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
