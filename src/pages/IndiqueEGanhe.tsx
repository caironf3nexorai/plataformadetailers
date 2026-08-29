import React from 'react';
import { PageHeader } from '../components/layout/PageHeader';
import { AbaIndiqueEGanhe } from './configuracoes/AbaIndiqueEGanhe';

export const IndiqueEGanhe: React.FC = () => {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Indique e Ganhe" />
      <AbaIndiqueEGanhe />
    </div>
  );
};
