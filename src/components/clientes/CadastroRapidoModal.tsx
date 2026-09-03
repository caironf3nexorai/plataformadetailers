import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { CategoriaVeiculo } from '../../types/clientes';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { useNavigate } from 'react-router-dom';
import { formatTelefone, formatPlaca } from '../../utils/formatters';
import { AlertTriangle, Car, Check, UserCheck, FileText } from 'lucide-react';
import { AlertaErro } from '../ui/AlertaErro';

interface CadastroRapidoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (clienteId: string, veiculoId?: string) => void;
  onCriarOrcamento?: (orcamentoId: string) => void;
  iniciarComOrcamento?: boolean;
}

export const CadastroRapidoModal: React.FC<CadastroRapidoModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  onCriarOrcamento,
  iniciarComOrcamento = false,
}) => {
  const navigate = useNavigate();
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [criarOrcamentoAgora, setCriarOrcamentoAgora] = useState(iniciarComOrcamento);
  
  // Bloco de veículo
  const [incluirVeiculo, setIncluirVeiculo] = useState(false);
  const [placa, setPlaca] = useState('');
  const [categoriaId, setCategoriaId] = useState<string>('');
  const [marca, setMarca] = useState('');
  const [modelo, setModelo] = useState('');

  const [categorias, setCategorias] = useState<CategoriaVeiculo[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Verificação de placa existente
  const [existingVehicle, setExistingVehicle] = useState<{ clienteNome: string } | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Reset estados
    setNome('');
    setTelefone('');
    setIncluirVeiculo(false);
    setPlaca('');
    setMarca('');
    setModelo('');
    setErrorMsg(null);
    setExistingVehicle(null);
    setCriarOrcamentoAgora(iniciarComOrcamento);

    // Carrega categorias de veículo ativas
    const fetchCategorias = async () => {
      const { data } = await supabase
        .from('categorias_veiculo')
        .select('*')
        .eq('ativo', true)
        .order('ordem', { ascending: true });

      if (data && data.length > 0) {
        setCategorias(data as CategoriaVeiculo[]);
        setCategoriaId(data[0].id);
      }
    };

    fetchCategorias();
  }, [isOpen]);

  // Checa placa duplicada
  useEffect(() => {
    if (!placa || placa.length < 7) {
      setExistingVehicle(null);
      return;
    }

    const cleanPlaca = placa.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (cleanPlaca.length < 7) return;

    const timer = setTimeout(async () => {
      try {
        const { data } = await supabase
          .from('veiculos')
          .select('cliente:clientes(nome)')
          .eq('placa', cleanPlaca)
          .maybeSingle();

        if (data && data.cliente) {
          setExistingVehicle({ clienteNome: (data.cliente as any).nome || 'outro cliente' });
        } else {
          setExistingVehicle(null);
        }
      } catch (err) {
        console.error('Erro ao verificar placa:', err);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [placa]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!nome.trim() || !telefone.trim()) {
      setErrorMsg('Nome e telefone são obrigatórios.');
      return;
    }

    if (incluirVeiculo && (!placa.trim() || !categoriaId)) {
      setErrorMsg('Informe a placa e selecione a categoria do veículo.');
      return;
    }

    setLoading(true);

    try {
      const cleanPlaca = incluirVeiculo ? placa.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() : null;

      const { data, error } = await supabase.rpc('cadastro_rapido', {
        p_nome: nome.trim(),
        p_telefone: telefone.trim(),
        p_placa: cleanPlaca,
        p_categoria: incluirVeiculo ? categoriaId : null,
        p_marca: incluirVeiculo && marca.trim() ? marca.trim() : null,
        p_modelo: incluirVeiculo && modelo.trim() ? modelo.trim() : null,
      });

      if (error) {
        console.error('[CadastroRapido Error]:', error);
        setErrorMsg(error.message || 'Erro ao realizar cadastro.');
        setLoading(false);
      } else {
        const result = Array.isArray(data) ? data[0] : data;
        const cId = result?.out_cliente_id || result?.cliente_id;
        const vId = result?.out_veiculo_id || result?.veiculo_id;

        onSuccess(cId, vId);

        if (criarOrcamentoAgora && cId) {
          const { data: newOrcId, error: orcErr } = await supabase.rpc('criar_orcamento', {
            p_cliente: cId,
            p_veiculo: vId || null,
            p_categoria: incluirVeiculo ? categoriaId : null,
            p_titulo: null,
          });

          if (!orcErr && newOrcId) {
            onClose();
            if (onCriarOrcamento) {
              onCriarOrcamento(newOrcId);
            } else {
              navigate(`/orcamentos/${newOrcId}`);
            }
            return;
          }
        }

        onClose();
      }
    } catch (err: any) {
      console.error('[CadastroRapido Exception]:', err);
      setErrorMsg(err?.message || 'Erro inesperado ao salvar.');
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Cadastro Rápido de Balcão"
      icon={<UserCheck className="text-amber-500" size={22} />}
      maxWidth="lg"
    >
      {errorMsg && (
        <AlertaErro erro={errorMsg} />
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Dados do Cliente */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-vapor-400 font-medium">Nome do Cliente *</label>
            <Input
              type="text"
              placeholder="Ex: Carlos Eduardo"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              autoFocus
              className="min-h-[48px]"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-vapor-400 font-medium">Telefone / WhatsApp *</label>
            <Input
              type="tel"
              inputMode="tel"
              placeholder="(11) 99999-9999"
              value={telefone}
              onChange={(e) => setTelefone(formatTelefone(e.target.value))}
              required
              className="min-h-[48px] font-mono"
            />
          </div>
        </div>

        {/* Toggle Adicionar Veículo */}
        <div className="pt-2 border-t border-graphite-700 flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={incluirVeiculo}
              onChange={(e) => setIncluirVeiculo(e.target.checked)}
              className="w-4 h-4 accent-amber-500 rounded bg-graphite-900 border-graphite-600"
            />
            <span className="font-sans text-[14px] text-vapor-100 font-semibold flex items-center gap-1.5">
              <Car size={18} className="text-amber-500" />
              Adicionar veículo agora
            </span>
          </label>
        </div>

        {/* Bloco de Veículo Opcional */}
        {incluirVeiculo && (
          <div className="p-4 bg-graphite-900/60 border border-graphite-700 rounded-md flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="font-sans text-[13px] text-vapor-400 font-medium">Placa *</label>
              <Input
                type="text"
                placeholder="ABC-1234 ou ABC1D23"
                value={placa}
                onChange={(e) => setPlaca(formatPlaca(e.target.value))}
                required={incluirVeiculo}
                className="min-h-[48px] font-mono text-[16px] uppercase tracking-wider text-amber-500 font-bold"
              />
            </div>

            {/* Aviso de placa existente */}
            {existingVehicle && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded text-amber-500 text-[13px] flex flex-col gap-1">
                <div className="flex items-center gap-1.5 font-bold">
                  <AlertTriangle size={16} />
                  <span>Placa já cadastrada!</span>
                </div>
                <p className="font-sans text-[12px] leading-relaxed">
                  Essa placa já está cadastrada para <strong>{existingVehicle.clienteNome}</strong>. Deseja transferir o veículo para <strong>{nome || 'o novo cliente'}</strong>?
                </p>
              </div>
            )}

            {/* Categoria do Veículo */}
            <div className="flex flex-col gap-1.5">
              <label className="font-sans text-[13px] text-vapor-400 font-medium">Categoria / Porte *</label>
              <div className="flex flex-wrap gap-2">
                {categorias.map((cat) => {
                  const isSelected = categoriaId === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setCategoriaId(cat.id)}
                      className={`px-3 py-2 rounded text-[13px] font-sans transition-colors border ${
                        isSelected
                          ? 'bg-amber-500 text-graphite-900 font-bold border-amber-500'
                          : 'bg-graphite-800 text-vapor-300 border-graphite-600 hover:border-vapor-400'
                      }`}
                    >
                      {cat.nome}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Marca e Modelo */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="font-sans text-[13px] text-vapor-400 font-medium">Marca (Opcional)</label>
                <Input
                  type="text"
                  placeholder="Ex: Honda"
                  value={marca}
                  onChange={(e) => setMarca(e.target.value)}
                  className="min-h-[44px]"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-sans text-[13px] text-vapor-400 font-medium">Modelo (Opcional)</label>
                <Input
                  type="text"
                  placeholder="Ex: Civic"
                  value={modelo}
                  onChange={(e) => setModelo(e.target.value)}
                  className="min-h-[44px]"
                />
              </div>
            </div>
          </div>
        )}

        {/* OPÇÃO DE CRIAR ORÇAMENTO IMEDIATO */}
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center justify-between">
          <label className="flex items-center gap-2.5 text-xs font-sans text-vapor-200 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={criarOrcamentoAgora}
              onChange={(e) => setCriarOrcamentoAgora(e.target.checked)}
              className="w-4 h-4 rounded bg-graphite-900 border-graphite-700 text-amber-500 focus:ring-0"
            />
            <span className="font-semibold text-amber-300">
              Salvar e Abrir Orçamento Imediatamente
            </span>
          </label>
          <FileText size={16} className="text-amber-400 shrink-0" />
        </div>

        {/* Botões de Ação */}
        <div className="flex justify-end gap-2 mt-2 pt-3 border-t border-graphite-700">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            className="min-h-[48px] px-5"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={loading}
            className="min-h-[48px] px-6 font-semibold flex items-center gap-2"
          >
            {loading ? (
              'Salvando...'
            ) : (
              <>
                <Check size={18} />
                <span>{criarOrcamentoAgora ? 'Salvar & Criar Orçamento' : 'Salvar Cadastro'}</span>
              </>
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
