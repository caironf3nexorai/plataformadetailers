import React from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { AlertTriangle, Info } from 'lucide-react';

export interface ModalConfirmacaoProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  titulo?: string;
  description?: React.ReactNode;
  mensagem?: React.ReactNode;
  confirmText?: string;
  textoConfirmar?: string;
  cancelText?: string;
  textoCancelar?: string;
  variant?: 'danger' | 'warning' | 'primary' | 'info';
  loading?: boolean;
  isLoading?: boolean;
}

export const ModalConfirmacao: React.FC<ModalConfirmacaoProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  titulo,
  description,
  mensagem,
  confirmText,
  textoConfirmar,
  cancelText,
  textoCancelar,
  variant = 'warning',
  loading,
  isLoading,
}) => {
  const modalTitle = titulo || title || 'Confirmar Ação';
  const modalMessage = mensagem || description;
  const btnConfirmar = textoConfirmar || confirmText || 'Confirmar';
  const btnCancelar = textoCancelar || cancelText || 'Cancelar';
  const isCarregando = loading ?? isLoading ?? false;

  const getIcon = () => {
    if (variant === 'danger') return <AlertTriangle className="text-flare-400" size={20} />;
    if (variant === 'info') return <Info className="text-cyan-400" size={20} />;
    return <AlertTriangle className="text-amber-500" size={20} />;
  };

  const getButtonVariant = () => {
    if (variant === 'danger') return 'danger';
    return 'primary';
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={modalTitle}
      maxWidth="sm"
      icon={getIcon()}
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isCarregando}
            className="text-vapor-300 hover:bg-graphite-700"
          >
            {btnCancelar}
          </Button>
          <Button
            type="button"
            variant={getButtonVariant()}
            onClick={onConfirm}
            disabled={isCarregando}
            className="font-semibold"
          >
            {isCarregando ? 'Processando...' : btnConfirmar}
          </Button>
        </>
      }
    >
      <div className="font-sans text-[14px] text-vapor-300 leading-relaxed">
        {modalMessage}
      </div>
    </Modal>
  );
};
