import React from 'react';
import { PageHeader } from '../components/layout/PageHeader';
import { AbaTreinamento } from '../components/configuracoes/AbaTreinamento';
import { usePlano } from '../hooks/usePlano';
import { BloqueioRecursoPlano } from '../components/planos/BloqueioRecursoPlano';

export const Treinamentos: React.FC = () => {
  const { temFeature, carregandoPermissoes } = usePlano();

  if (!carregandoPermissoes && !temFeature('treinamentos')) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Academia Detailer" />
        <BloqueioRecursoPlano
          recurso="Academia Detailer & Treinamentos"
          descricao="O módulo de capacitação técnica, tutoriais de processos e onboarding da equipe está disponível a partir do Plano Pro."
          planoMinimo="Pro"
          beneficios={[
            'Aulas em vídeo sobre processos de polimento e vitrificação',
            'Padronização de checklist e execução para a equipe',
            'Treinamentos de atendimento e vendas de alto valor',
          ]}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader 
        title="Academia Detailer" 
      />
      <AbaTreinamento />
    </div>
  );
};
