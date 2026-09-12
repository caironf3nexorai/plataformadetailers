import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { supabase } from '../../lib/supabase';
import { ShieldCheck, Sparkles, Calendar, CheckCircle2, AlertCircle } from 'lucide-react';
import { formatarData } from '../../utils/datas';

interface ModalRegistrarRevisaoProps {
  isOpen: boolean;
  onClose: () => void;
  onSucesso: () => void;
  certificado: {
    id: string;
    codigo: string;
    servico_nome: string;
    produto_aplicado?: string | null;
    intervalo_manutencao_dias?: number;
    cliente_nome: string;
    veiculo_modelo: string;
    veiculo_placa: string;
    total_revisoes: number;
  };
}

export const ModalRegistrarRevisao: React.FC<ModalRegistrarRevisaoProps> = ({
  isOpen,
  onClose,
  onSucesso,
  certificado
}) => {
  const [observacao, setObservacao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const hojeFormatado = formatarData(new Date().toISOString());
  const proximaDataSugerida = new Date();
  proximaDataSugerida.setDate(proximaDataSugerida.getDate() + (certificado.intervalo_manutencao_dias || 60));
  const proximaFormatada = formatarData(proximaDataSugerida.toISOString());

  const handleSalvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    setSalvando(true);

    try {
      const { error } = await supabase.rpc('registrar_manutencao_certificado', {
        p_certificado_id: certificado.id,
        p_observacao: observacao.trim() || 'Manutenção periódica de garantia realizada com sucesso.'
      });

      if (error) throw error;

      onSucesso();
      onClose();
    } catch (err: any) {
      console.error('Erro ao registrar revisão:', err);
      setErro(err.message || 'Não foi possível registrar a revisão.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Registrar Revisão de Garantia"
      subtitle={`${certificado.veiculo_modelo} · ${certificado.veiculo_placa}`}
      icon={<ShieldCheck className="text-amber-500" size={20} />}
      maxWidth="md"
    >
      <form onSubmit={handleSalvar} className="space-y-4">
        {erro && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        {/* Resumo do Certificado */}
        <div className="p-3.5 bg-graphite-900/80 rounded-xl border border-graphite-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-vapor-400">Certificado Oficial</span>
            <span className="font-mono text-xs font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
              {certificado.codigo}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-vapor-400">Proteção:</span>
            <span className="font-semibold text-vapor-100">{certificado.servico_nome}</span>
          </div>
          {certificado.produto_aplicado && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-vapor-400">Produto Aplicado:</span>
              <span className="font-mono font-bold text-amber-400">{certificado.produto_aplicado}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-xs">
            <span className="text-vapor-400">Histórico:</span>
            <span className="text-vapor-300">
              {certificado.total_revisoes === 0
                ? 'Nenhuma revisão anterior registrada'
                : `${certificado.total_revisoes} revisão(ões) realizada(s)`}
            </span>
          </div>
        </div>

        {/* Informações da Nova Revisão */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-graphite-900 rounded-xl border border-graphite-800">
            <span className="text-[10px] uppercase font-bold text-vapor-400 block mb-1">
              Data da Revisão Atual
            </span>
            <span className="text-sm font-bold font-mono text-vapor-100 flex items-center gap-1.5">
              <Calendar size={14} className="text-amber-500" />
              {hojeFormatado}
            </span>
          </div>

          <div className="p-3 bg-graphite-900 rounded-xl border border-emerald-500/30">
            <span className="text-[10px] uppercase font-bold text-emerald-400 block mb-1">
              Próxima Revisão (+{certificado.intervalo_manutencao_dias}d)
            </span>
            <span className="text-sm font-bold font-mono text-emerald-300 flex items-center gap-1.5">
              <Sparkles size={14} className="text-emerald-400" />
              {proximaFormatada}
            </span>
          </div>
        </div>

        {/* Observações da Revisão */}
        <div>
          <label className="block text-xs font-medium text-vapor-300 mb-1.5">
            Observações da Manutenção / Procedimento Realizado
          </label>
          <textarea
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            rows={3}
            placeholder="Ex: Lavagem técnica detalhada, descontaminação de pintura e aplicação de manutenção com selante SiO2. Repelência e brilho 100% preservados."
            className="w-full px-3 py-2 bg-graphite-900 border border-graphite-700 rounded-xl text-xs text-vapor-100 placeholder:text-vapor-500 focus:outline-none focus:border-amber-500 transition-colors resize-none"
          />
          <p className="text-[10px] text-vapor-400 mt-1">
            Esta anotação ficará visível na página pública do certificado quando o cliente escanear o QR Code.
          </p>
        </div>

        {/* Botões de Ação */}
        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-graphite-800">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={salvando}
            className="text-xs"
          >
            Cancelar
          </Button>

          <Button
            type="submit"
            variant="primary"
            disabled={salvando}
            className="text-xs font-bold bg-amber-500 hover:bg-amber-400 text-graphite-950 flex items-center gap-1.5 shadow-md"
          >
            {salvando ? (
              <span>Salvando...</span>
            ) : (
              <>
                <CheckCircle2 size={15} />
                <span>Confirmar Revisão #{certificado.total_revisoes + 1}</span>
              </>
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
