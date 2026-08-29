import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { EmptyState } from '../components/ui/EmptyState';
import { useAuth } from '../contexts/AuthContext';
import { usePermissao } from '../hooks/usePermissao';
import { supabase } from '../lib/supabase';
import type { Cliente } from '../types/clientes';
import { CadastroRapidoModal } from '../components/clientes/CadastroRapidoModal';
import { ImportarCSVModal } from '../components/clientes/ImportarCSVModal';
import { extrairNumeroOS } from '../utils/formatters';
import { Users, UserPlus, Search, Car, Phone, FileSpreadsheet } from 'lucide-react';

export const Clientes: React.FC = () => {
  const navigate = useNavigate();
  const { tenant } = useAuth();
  const { isOperador } = usePermissao();

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  const [abaAtiva, setAbaAtiva] = useState<'todos' | 'incompletos'>('todos');

  // Debounce 300ms na busca
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchClientes = async () => {
    if (!tenant) return;
    setLoading(true);

    try {
      // Busca clientes ativos do tenant com seus veículos
      const query = supabase
        .from('clientes')
        .select('*, veiculos:veiculos(*)')
        .eq('tenant_id', tenant.id)
        .eq('ativo', true)
        .order('created_at', { ascending: false });

      if (debouncedQuery.trim()) {
        const q = debouncedQuery.trim().toLowerCase();
        const cleanDigits = q.replace(/\D/g, '');
        const cleanPlaca = q.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        const numOS = extrairNumeroOS(q);

        let clienteIdByOS: string | null = null;
        if (numOS) {
          const { data: agendOS } = await supabase
            .from('agendamentos')
            .select('cliente_id')
            .eq('tenant_id', tenant.id)
            .eq('numero_os', numOS)
            .maybeSingle();
          if (agendOS?.cliente_id) {
            clienteIdByOS = agendOS.cliente_id;
          }
        }

        const { data: rawData } = await query;
        if (rawData) {
          const filtered = (rawData as Cliente[]).filter((c) => {
            const matchesNome = c.nome.toLowerCase().includes(q);
            const matchesTel = cleanDigits ? c.telefone.replace(/\D/g, '').includes(cleanDigits) : false;
            const matchesPlaca = c.veiculos?.some((v) =>
              v.placa.toUpperCase().includes(cleanPlaca)
            );
            const matchesOS = clienteIdByOS ? c.id === clienteIdByOS : false;
            return matchesNome || matchesTel || matchesPlaca || matchesOS;
          });
          setClientes(filtered);
          setLoading(false);
          return;
        }
      }

      const { data, error } = await query;
      if (!error && data) {
        setClientes(data as Cliente[]);
      }
    } catch (err) {
      console.error('Erro ao carregar clientes:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClientes();
  }, [tenant?.id, debouncedQuery]);

  const isIncompleto = (c: Cliente) => {
    const isOnline = c.origem === 'online' || (c.origem as string) === 'agendamento_online';
    const semDoc = !c.documento && !(c as any).cpf_cnpj;
    return isOnline && semDoc;
  };

  const clientesIncompletos = clientes.filter(isIncompleto);
  const clientesExibidos = abaAtiva === 'incompletos' ? clientesIncompletos : clientes;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Clientes"
        action={
          !isOperador ? (
            <div className="flex items-center gap-2.5">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setIsImportModalOpen(true)}
                className="min-h-[44px] px-3.5 font-semibold text-xs border-graphite-600 hover:border-amber-500/50"
              >
                <FileSpreadsheet size={17} className="text-amber-500" />
                Importar CSV
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => setIsModalOpen(true)}
                className="min-h-[44px] px-4 font-semibold text-xs"
              >
                <UserPlus size={18} />
                Novo cliente
              </Button>
            </div>
          ) : undefined
        }
      />

      {/* Abas e Busca */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        {/* Topo com Busca Única */}
        <div className="relative w-full max-w-lg">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-vapor-400" size={18} />
          <Input
            type="text"
            placeholder="Buscar por nome, telefone, placa ou OS (ex: OS 0042)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
            className="pl-10 min-h-[48px] bg-graphite-800 border-graphite-600 text-vapor-100"
          />
        </div>

        {/* Filtros de Aba */}
        <div className="flex items-center gap-2 bg-graphite-800 p-1 rounded-lg border border-graphite-600">
          <button
            type="button"
            onClick={() => setAbaAtiva('todos')}
            className={`px-3 py-2 text-xs font-semibold rounded-md transition ${
              abaAtiva === 'todos'
                ? 'bg-graphite-700 text-vapor-100 shadow'
                : 'text-vapor-400 hover:text-vapor-200'
            }`}
          >
            Todos ({clientes.length})
          </button>
          <button
            type="button"
            onClick={() => setAbaAtiva('incompletos')}
            className={`px-3 py-2 text-xs font-semibold rounded-md transition flex items-center gap-1.5 ${
              abaAtiva === 'incompletos'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                : 'text-vapor-400 hover:text-amber-400'
            }`}
          >
            <span>Cadastro Incompleto</span>
            {clientesIncompletos.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-amber-500/30 text-amber-300 font-bold">
                {clientesIncompletos.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Listagem de Clientes / Skeleton / EmptyState */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i} className="p-5 bg-graphite-800 border-graphite-600 animate-pulse flex flex-col gap-3">
              <div className="h-5 bg-graphite-700 rounded w-3/4" />
              <div className="h-4 bg-graphite-700 rounded w-1/2" />
              <div className="h-6 bg-graphite-700 rounded w-2/3 mt-2" />
            </Card>
          ))}
        </div>
      ) : clientesExibidos.length === 0 ? (
        <EmptyState
          icon={<Users size={48} strokeWidth={1.5} />}
          title={
            abaAtiva === 'incompletos'
              ? 'Nenhum cliente com cadastro incompleto.'
              : searchQuery
              ? 'Nenhum cliente encontrado.'
              : 'Nenhum cliente cadastrado.'
          }
          description={
            abaAtiva === 'incompletos'
              ? 'Todos os clientes de agendamento online possuem CPF/CNPJ preenchido.'
              : searchQuery
              ? 'Tente buscar por outro termo ou limpe o filtro.'
              : 'Cadastre o primeiro para começar a montar o histórico dos veículos.'
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {clientesExibidos.map((cliente) => {
            const veiculosAtivos = (cliente.veiculos || []).filter((v) => v.ativo);
            const incompleto = isIncompleto(cliente);

            return (
              <Card
                key={cliente.id}
                onClick={() => navigate(`/clientes/${cliente.id}`)}
                className={`p-5 bg-graphite-800 border transition-all flex flex-col justify-between gap-4 group shadow-md ${
                  incompleto
                    ? 'border-amber-500/40 hover:border-amber-500'
                    : 'border-graphite-600 hover:border-amber-500/50'
                }`}
              >
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-sans text-[16px] font-bold text-vapor-100 group-hover:text-amber-500 transition-colors">
                      {cliente.nome}
                    </h3>
                    {incompleto && (
                      <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                        Falta CPF
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-vapor-400 font-mono text-[13px]">
                    <Phone size={14} className="shrink-0 text-vapor-400" />
                    <span>{cliente.telefone}</span>
                  </div>
                </div>

                {/* Placas dos Veículos */}
                <div className="pt-3 border-t border-graphite-700 flex items-center gap-2 flex-wrap">
                  <Car size={16} className="text-amber-500 shrink-0" />
                  {veiculosAtivos.length === 0 ? (
                    <span className="font-sans text-[12px] text-vapor-400 italic">Sem veículo cadastrado</span>
                  ) : (
                    veiculosAtivos.map((v) => (
                      <span
                        key={v.id}
                        className="px-2 py-0.5 bg-graphite-900 border border-graphite-600 rounded font-mono text-[12px] text-amber-500 font-semibold"
                      >
                        {v.placa}
                      </span>
                    ))
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal Cadastro Rápido */}
      <CadastroRapidoModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => fetchClientes()}
      />

      {/* Modal Importação CSV */}
      <ImportarCSVModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onSuccess={() => fetchClientes()}
      />
    </div>
  );
};
