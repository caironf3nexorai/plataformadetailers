import React from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ShieldAlert, ClipboardCheck, ArrowRight } from 'lucide-react';

interface ModalConfirmarSemVistoriaProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  loading?: boolean;
}

export const ModalConfirmarSemVistoria: React.FC<ModalConfirmarSemVistoriaProps> = ({
  isOpen,
  onClose,
  onConfirm,
  loading = false,
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Iniciar sem a vistoria de entrada?"
      maxWidth="md"
    >
      <div className="flex flex-col gap-5 pt-1 text-vapor-200">
        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-3 text-amber-300">
          <ShieldAlert size={24} className="shrink-0 mt-0.5 text-amber-400" />
          <div className="flex flex-col gap-1 text-xs sm:text-sm leading-relaxed">
            <span className="font-bold text-amber-300 font-display uppercase tracking-wide">
              Aviso de Responsabilidade e Proteção
            </span>
            <p className="text-vapor-300 font-sans">
              A vistoria registra como o carro chegou — fotos, avarias existentes e a assinatura do cliente concordando com o estado.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 text-xs sm:text-sm text-vapor-300 font-sans leading-relaxed">
          <p>
            Se depois aparecer discussão sobre um risco ou amassado, é esse registro que mostra o que já existia. Sem ele, fica a palavra de um contra a do outro.
          </p>
          <p className="text-vapor-400 text-xs italic">
            Você ainda pode fazer a vistoria depois, enquanto o serviço não tiver começado.
          </p>
        </div>

        {/* BOTÕES: 56px de altura mínima para toque ágil e preciso */}
        <div className="flex flex-col sm:flex-row-reverse items-center gap-3 pt-3 border-t border-graphite-700">
          {/* Botão Principal em Destaque: Fazer a vistoria */}
          <Button
            type="button"
            variant="primary"
            onClick={onClose}
            disabled={loading}
            className="w-full sm:flex-1 min-h-[56px] text-[15px] font-bold uppercase tracking-wider shadow-lg flex items-center justify-center gap-2"
          >
            <ClipboardCheck size={20} />
            <span>Fazer a vistoria</span>
          </Button>

          {/* Botão Secundário Discreto: Iniciar sem vistoria */}
          <Button
            type="button"
            variant="ghost"
            onClick={onConfirm}
            disabled={loading}
            className="w-full sm:flex-1 min-h-[56px] text-[14px] font-medium text-vapor-400 hover:text-vapor-100 hover:bg-graphite-800 border border-graphite-700 flex items-center justify-center gap-2"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <span>Iniciar sem vistoria</span>
                <ArrowRight size={16} />
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
