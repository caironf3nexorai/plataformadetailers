import React from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { AlertTriangle } from 'lucide-react';

export interface ModalConfirmacaoProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  mensagem: React.ReactNode;
  textoConfirmar?: string;
  textoCancelar?: string;
  variant?: 'danger' | 'warning' | 'primary';
  loading?: boolean;
}

export const ModalConfirmacao: React.FC<ModalConfirmacaoProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title = 'Confirmar Ação',
  mensagem,
  textoConfirmar = 'Confirmar',
  textoCancelar = 'Cancelar',
  variant = 'warning',
  loading = false,
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      maxWidth="sm"
      icon={<AlertTriangle className={variant === 'danger' ? 'text-flare-400' : 'text-amber-500'} size={20} />}
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={loading}
            className="text-vapor-300 hover:bg-graphite-700"
          >
            {textoCancelar}
          </Button>
          <Button
            type="button"
            variant={variant === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={loading}
            className="font-semibold"
          >
            {loading ? 'Processando...' : textoConfirmar}
          </Button>
        </>
      }
    >
      <div className="font-sans text-[14px] text-vapor-300 leading-relaxed">
        {mensagem}
      </div>
    </Modal>
  );
};
