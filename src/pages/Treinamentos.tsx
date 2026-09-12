import React, { useState } from 'react';
import { PageHeader } from '../components/layout/PageHeader';
import { AbaTreinamento } from '../components/configuracoes/AbaTreinamento';
import { AbaMateriaisDidaticos } from '../components/treinamentos/AbaMateriaisDidaticos';
import { usePlano } from '../hooks/usePlano';
import { BloqueioRecursoPlano } from '../components/planos/BloqueioRecursoPlano';
import { Tv, BookOpen } from 'lucide-react';

export const Treinamentos: React.FC = () => {
  const { temFeature, carregandoPermissoes } = usePlano();
  const [subAba, setSubAba] = useState<'videos' | 'materiais'>('videos');

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
            'E-books e manuais de precificação, tráfego pago e gestão',
          ]}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader 
          title="Academia Detailer" 
        />

        {/* Alternador de Abas */}
        <div className="flex items-center bg-neutral-900 border border-neutral-800 p-1 rounded-xl self-start sm:self-auto shadow-inner">
          <button
            onClick={() => setSubAba('videos')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              subAba === 'videos'
                ? 'bg-cyan-500 text-neutral-950 shadow-md shadow-cyan-500/20'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Tv className="w-4 h-4" />
            <span>Aulas em Vídeo</span>
          </button>
          <button
            onClick={() => setSubAba('materiais')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              subAba === 'materiais'
                ? 'bg-cyan-500 text-neutral-950 shadow-md shadow-cyan-500/20'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>Materiais & E-books</span>
          </button>
        </div>
      </div>

      {subAba === 'videos' ? <AbaTreinamento /> : <AbaMateriaisDidaticos />}
    </div>
  );
};

