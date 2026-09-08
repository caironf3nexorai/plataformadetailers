import React from 'react';
import { PageHeader } from '../components/layout/PageHeader';
import { AbaArquivosDigitais } from '../components/configuracoes/AbaArquivosDigitais';
import { usePlano } from '../hooks/usePlano';
import { BloqueioRecursoPlano } from '../components/planos/BloqueioRecursoPlano';

export const ArquivosDigitaisPage: React.FC = () => {
  const { temFeature, carregandoPermissoes } = usePlano();

  if (!carregandoPermissoes && !temFeature('arquivos_digitais')) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Arquivos Digitais & Acervo" />
        <BloqueioRecursoPlano
          recurso="Arquivos Digitais & Acervo de Documentos"
          descricao="O acervo de manuais, laudos, termos técnicos e arquivos digitais da plataforma está disponível a partir do Plano Pro."
          planoMinimo="Pro"
          beneficios={[
            'Acervo ilimitado de termos e modelos de contrato em PDF',
            'Manuais de procedimentos e tabelas de aplicação',
            'Download direto para envio ao seu cliente',
          ]}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader 
        title="Arquivos Digitais & Acervo" 
      />
      <AbaArquivosDigitais />
    </div>
  );
};
