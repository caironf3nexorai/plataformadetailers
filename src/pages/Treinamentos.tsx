import React from 'react';
import { PageHeader } from '../components/layout/PageHeader';
import { AbaTreinamento } from '../components/configuracoes/AbaTreinamento';

export const Treinamentos: React.FC = () => {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader 
        title="Academia Detailer" 
      />
      <AbaTreinamento />
    </div>
  );
};
