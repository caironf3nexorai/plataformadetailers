import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { 
  Receipt, 
  AlertTriangle, 
  Landmark, 
  Send, 
  ExternalLink,
  ShieldAlert
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface ModalEmitirNFSeProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (nota: any) => void;
  agendamento: any;
  valorTotal: number;
}

export const ModalEmitirNFSe: React.FC<ModalEmitirNFSeProps> = ({
  isOpen,
  onClose,
  onSuccess,
  agendamento,
  valorTotal
}) => {
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();

  const [loadingResumo, setLoadingResumo] = useState(true);
  const [resumo, setResumo] = useState<any>(null);
  const [emitindo, setEmitindo] = useState(false);

  // Dados do Tomador
  const [tomadorNome, setTomadorNome] = useState('');
  const [tomadorDoc, setTomadorDoc] = useState('');
  const [tomadorEmail, setTomadorEmail] = useState('');
  const [tomadorTelefone, setTomadorTelefone] = useState('');
  const [discriminacao, setDiscriminacao] = useState('');
  const [valorFinal, setValorFinal] = useState(valorTotal || 0);

  useEffect(() => {
    if (isOpen && agendamento) {
      setValorFinal(valorTotal || 0);
      setTomadorNome(agendamento.cliente?.nome || '');
      setTomadorDoc(agendamento.cliente?.documento || agendamento.cliente?.cpf_cnpj || '');
      setTomadorEmail(agendamento.cliente?.email || '');
      setTomadorTelefone(agendamento.cliente?.telefone || '');

      // Constrói discriminação padrão
      const veiculoTexto = agendamento.veiculo 
        ? `no veículo ${agendamento.veiculo.modelo || ''} (Placa: ${agendamento.veiculo.placa || 'Sem placa'})`
        : '';
      const servicoTexto = agendamento.servico?.nome || 'Serviços de Estética Automotiva';
      
      setDiscriminacao(
        `Serviços de estética e detalhamento automotivo prestados ${veiculoTexto}: ${servicoTexto}. Atendimento OS #${agendamento.numero_os || agendamento.id.slice(0, 6)}.`
      );

      verificarResumoFiscal();
    }
  }, [isOpen, agendamento, valorTotal]);

  const verificarResumoFiscal = async () => {
    setLoadingResumo(true);
    try {
      const { data, error } = await supabase.rpc('obter_resumo_nfse_tenant');
      if (error) throw error;
      setResumo(data);
    } catch (err: any) {
      console.error('[ModalEmitirNFSe] Erro ao carregar resumo fiscal:', err);
    } finally {
      setLoadingResumo(false);
    }
  };

  const handleEmitir = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tomadorNome.trim()) {
      showError('Nome do tomador / cliente é obrigatório.');
      return;
    }
    if (valorFinal <= 0) {
      showError('O valor total da nota fiscal deve ser maior que zero.');
      return;
    }

    setEmitindo(true);
    try {
      const payload = {
        atendimento_id: agendamento.id,
        valor_total: valorFinal,
        tomador_nome: tomadorNome.trim(),
        tomador_cpf_cnpj: tomadorDoc.trim() || null,
        tomador_email: tomadorEmail.trim() || null,
        tomador_telefone: tomadorTelefone.trim() || null,
        discriminacao: discriminacao.trim(),
        aliquota_iss: resumo?.config?.aliquota_iss || 2.0
      };

      const { data, error } = await supabase.rpc('registrar_emissao_nfse', {
        p_dados: payload
      });

      if (error) throw error;

      showSuccess(`NFS-e Nº ${data?.numero || 'gerada'} emitida com sucesso!`);
      onSuccess(data);
      onClose();
    } catch (err: any) {
      console.error('[ModalEmitirNFSe] Erro ao emitir NFS-e:', err);
      showError(err.message || 'Erro ao emitir nota fiscal de serviço.');
    } finally {
      setEmitindo(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Emitir Nota Fiscal de Serviço (NFS-e)"
      subtitle={`OS #${agendamento?.numero_os || ''} · ${agendamento?.cliente?.nome || 'Cliente'}`}
      icon={<Receipt className="text-amber-500" size={20} />}
      maxWidth="lg"
    >
      <div className="flex flex-col gap-4 font-sans text-xs pb-4">
        {loadingResumo ? (
          <div className="py-10 text-center text-vapor-400">
            Verificando parâmetros fiscais e cota do plano...
          </div>
        ) : (
          <>
            {/* 1. VERIFICAÇÃO DE CONFIGURAÇÃO FISCAL */}
            {!resumo?.configurada && (
              <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex flex-col gap-2 text-red-300">
                <div className="flex items-center gap-2 font-bold text-sm text-red-400">
                  <ShieldAlert size={18} />
                  <span>Dados Fiscais Não Configurados</span>
                </div>
                <p className="leading-relaxed">
                  Para emitir notas fiscais, configure previamente o CNPJ, Razão Social, Inscrição Municipal e CNAE da sua oficina.
                </p>
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      navigate('/configuracoes?aba=fiscal');
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-400 text-slate-950 font-bold rounded-lg text-xs transition"
                  >
                    <span>Configurar Dados Fiscais Agora</span>
                    <ExternalLink size={12} />
                  </button>
                </div>
              </div>
            )}

            {/* 2. VERIFICAÇÃO DE COTA DO PLANO */}
            {resumo?.configurada && !resumo?.pode_emitir && (
              <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl flex flex-col gap-2 text-amber-300">
                <div className="flex items-center gap-2 font-bold text-sm text-amber-400">
                  <AlertTriangle size={18} />
                  <span>Cota Mensal Esgotada ou Não Inclusa</span>
                </div>
                <p className="leading-relaxed">
                  {resumo?.limite_mensal === 0
                    ? `Seu plano atual (${resumo?.plano_id?.toUpperCase()}) não inclui emissão de NFS-e. Faça upgrade para o Plano Pro (30 notas/mês) ou Studio (150 notas/mês).`
                    : `Você já atingiu o limite de ${resumo?.limite_mensal} notas fiscais deste mês no seu plano (${resumo?.plano_id?.toUpperCase()}).`}
                </p>
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      navigate('/configuracoes?aba=plano');
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs transition"
                  >
                    <span>Fazer Upgrade de Plano</span>
                    <ExternalLink size={12} />
                  </button>
                </div>
              </div>
            )}

            {/* COTA STATUS PILL */}
            {resumo?.pode_emitir && (
              <div className="p-3 bg-graphite-900 rounded-xl border border-graphite-700 flex items-center justify-between text-vapor-300">
                <div className="flex items-center gap-2">
                  <Landmark size={15} className="text-amber-400" />
                  <span>
                    Ambiente: <strong className="font-mono text-vapor-100 uppercase">{resumo?.config?.ambiente || 'Homologação'}</strong>
                  </span>
                </div>
                <span className="font-mono text-emerald-400 font-semibold">
                  {resumo?.disponiveis_mes} de {resumo?.limite_mensal} notas restantes no mês
                </span>
              </div>
            )}

            {/* FORMULÁRIO DE EMISSÃO */}
            <form onSubmit={handleEmitir} className="space-y-3 pt-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-mono text-vapor-400 uppercase mb-1">
                    Nome do Tomador / Cliente *
                  </label>
                  <input
                    type="text"
                    value={tomadorNome}
                    onChange={(e) => setTomadorNome(e.target.value)}
                    required
                    className="w-full bg-graphite-900 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 font-sans outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-mono text-vapor-400 uppercase mb-1">
                    CPF ou CNPJ do Cliente
                  </label>
                  <input
                    type="text"
                    value={tomadorDoc}
                    onChange={(e) => setTomadorDoc(e.target.value)}
                    placeholder="000.000.000-00"
                    className="w-full bg-graphite-900 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 font-mono outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-mono text-vapor-400 uppercase mb-1">
                    E-mail para Envio da Nota
                  </label>
                  <input
                    type="email"
                    value={tomadorEmail}
                    onChange={(e) => setTomadorEmail(e.target.value)}
                    placeholder="cliente@email.com"
                    className="w-full bg-graphite-900 border border-graphite-700 rounded-lg px-3 py-2 text-vapor-100 font-sans outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-mono text-vapor-400 uppercase mb-1">
                    Valor Total dos Serviços (R$) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={valorFinal}
                    onChange={(e) => setValorFinal(parseFloat(e.target.value) || 0)}
                    required
                    className="w-full bg-graphite-900 border border-graphite-700 rounded-lg px-3 py-2 text-amber-400 font-mono font-bold outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-mono text-vapor-400 uppercase mb-1">
                  Discriminação dos Serviços na Nota *
                </label>
                <textarea
                  value={discriminacao}
                  onChange={(e) => setDiscriminacao(e.target.value)}
                  rows={3}
                  required
                  className="w-full bg-graphite-900 border border-graphite-700 rounded-lg p-2.5 text-vapor-100 font-sans text-xs outline-none focus:border-amber-500 leading-relaxed"
                />
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-graphite-700">
                <Button type="button" variant="secondary" onClick={onClose}>
                  Cancelar
                </Button>

                <Button
                  type="submit"
                  variant="primary"
                  disabled={emitindo || !resumo?.pode_emitir || !resumo?.configurada}
                  className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-4 py-2"
                >
                  <Send size={14} />
                  <span>{emitindo ? 'Transmitindo NFS-e...' : 'Emitir Nota Fiscal Agora'}</span>
                </Button>
              </div>
            </form>
          </>
        )}
      </div>
    </Modal>
  );
};
