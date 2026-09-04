import React, { useState } from 'react';
import type { DiluicaoVariant, EquipamentoPerfilData } from './types';
import { ManualMode } from './ManualMode';
import { MaquinaMode } from './MaquinaMode';
import { Container, Gauge } from 'lucide-react';

interface DiluicaoCalculatorProps {
  variant: DiluicaoVariant;
}

export const DiluicaoCalculator: React.FC<DiluicaoCalculatorProps> = ({ variant }) => {
  const [activeTab, setActiveTab] = useState<'manual' | 'maquina'>('manual');

  // Estado dos Perfis de Equipamento persistido em localStorage
  const [perfis, setPerfis] = useState<EquipamentoPerfilData[]>(() => {
    try {
      const saved = localStorage.getItem('nuvemwash_lavadora_perfis');
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });

  const handleSavePerfil = (data: Omit<EquipamentoPerfilData, 'id' | 'createdAt'>) => {
    if (perfis.length >= 5) return;
    const newPerfil: EquipamentoPerfilData = {
      ...data,
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
    };
    const updated = [...perfis, newPerfil];
    setPerfis(updated);
    try {
      localStorage.setItem('nuvemwash_lavadora_perfis', JSON.stringify(updated));
    } catch {}
  };

  const handleDeletePerfil = (id: string) => {
    const updated = perfis.filter((p) => p.id !== id);
    setPerfis(updated);
    try {
      localStorage.setItem('nuvemwash_lavadora_perfis', JSON.stringify(updated));
    } catch {}
  };

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col gap-6">
      {/* Navegação por Abas do Topo */}
      <div className="flex bg-graphite-800 p-1.5 rounded-md border border-graphite-600">
        <button
          type="button"
          onClick={() => setActiveTab('manual')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded text-[14px] font-sans font-medium transition-colors min-h-[48px] ${
            activeTab === 'manual'
              ? 'bg-amber-500 text-graphite-900 font-semibold shadow'
              : 'text-vapor-400 hover:text-vapor-100'
          }`}
        >
          <Container size={18} />
          <span>Snow Foam Manual</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('maquina')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded text-[14px] font-sans font-medium transition-colors min-h-[48px] ${
            activeTab === 'maquina'
              ? 'bg-amber-500 text-graphite-900 font-semibold shadow'
              : 'text-vapor-400 hover:text-vapor-100'
          }`}
        >
          <Gauge size={18} />
          <span>Snow Foam Lavadora</span>
        </button>
      </div>

      {/* Conteúdo da Aba Selecionada */}
      {activeTab === 'manual' ? (
        <ManualMode />
      ) : (
        <MaquinaMode
          variant={variant}
          perfis={perfis}
          onSavePerfil={handleSavePerfil}
          onDeletePerfil={handleDeletePerfil}
        />
      )}
    </div>
  );
};
