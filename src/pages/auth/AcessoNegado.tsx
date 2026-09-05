import React from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const AcessoNegado: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-4 text-center">
      <Card className="max-w-md w-full p-8 bg-graphite-800 border-graphite-600 flex flex-col items-center gap-4">
        <div className="p-3 bg-flare-400/10 border border-flare-400/30 rounded-full text-flare-400">
          <ShieldAlert size={36} />
        </div>
        <h2 className="font-display text-[20px] text-vapor-100 uppercase tracking-wide">
          Acesso Restrito
        </h2>
        <p className="font-sans text-[14px] text-vapor-400 leading-relaxed">
          Você não possui permissão para acessar este módulo. Esta função é exclusiva para administradores ou gerentes.
        </p>
        <Button
          type="button"
          variant="primary"
          onClick={() => {
            if (window.history.state && window.history.state.idx > 0) {
              navigate(-1);
            } else {
              navigate('/hoje');
            }
          }}
          className="mt-2 min-h-[48px] px-6"
        >
          Voltar
        </Button>
      </Card>
    </div>
  );
};
