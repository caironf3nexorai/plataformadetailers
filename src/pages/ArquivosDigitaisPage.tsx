import React from 'react';
import { PageHeader } from '../components/layout/PageHeader';
import { AbaArquivosDigitais } from '../components/configuracoes/AbaArquivosDigitais';

export const ArquivosDigitaisPage: React.FC = () => {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader 
        title="Arquivos Digitais & Acervo" 
      />
      <AbaArquivosDigitais />
    </div>
  );
};
