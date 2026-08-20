import React from 'react';
import { PageHeader } from '../components/layout/PageHeader';
import { DiluicaoCalculator } from '../features/diluicao/DiluicaoCalculator';

export const DiluicaoInterna: React.FC = () => {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Calculadora de Diluição" />
      <DiluicaoCalculator variant="interno" />
    </div>
  );
};
