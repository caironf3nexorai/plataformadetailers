import React from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Trophy, Sparkles } from 'lucide-react';

interface MilestoneCelebrationModalProps {
  isOpen: boolean;
  marco: number | null;
  onClose: () => void;
}

export const MilestoneCelebrationModal: React.FC<MilestoneCelebrationModalProps> = ({
  isOpen,
  marco,
  onClose,
}) => {
  if (!marco) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="🎉 Marco Atingido!"
      subtitle="Comemoração de Desempenho"
      icon={<Trophy size={24} className="text-amber-400 animate-bounce" />}
      maxWidth="sm"
    >
      <div className="flex flex-col items-center text-center p-4 gap-5">
        <div className="relative p-5 bg-amber-500/10 rounded-full border border-amber-500/30 text-amber-400">
          <Trophy size={48} />
          <Sparkles size={20} className="absolute top-1 right-1 text-mint-400 animate-pulse" />
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="font-display text-[22px] font-bold text-vapor-100 uppercase tracking-tight">
            {marco}ª Ordem de Serviço!
          </h2>
          <p className="font-sans text-[14px] text-vapor-300 leading-relaxed">
            Parabéns! Sua oficina alcançou a incrível marca de{' '}
            <strong className="text-amber-400 font-mono">{marco} atendimentos</strong> registrados no sistema.
          </p>
          <p className="font-sans text-[12px] text-vapor-400">
            É um orgulho fazer parte da evolução e profissionalização do seu negócio!
          </p>
        </div>

        <Button
          type="button"
          variant="primary"
          onClick={onClose}
          className="w-full py-3 text-[14px] font-bold bg-amber-500 text-graphite-950 hover:bg-amber-400"
        >
          Continuar Trabalhando 🚀
        </Button>
      </div>
    </Modal>
  );
};
