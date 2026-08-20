import React, { useState } from 'react';
import type { EquipamentoPerfilData } from './types';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Bookmark, Plus, Trash2 } from 'lucide-react';

interface EquipamentoPerfilProps {
  perfis: EquipamentoPerfilData[];
  selectedPerfilId: string | null;
  onSelectPerfil: (perfil: EquipamentoPerfilData | null) => void;
  onSavePerfil: (nome: string) => void;
  onDeletePerfil: (id: string) => void;
  canSave: boolean;
}

export const EquipamentoPerfil: React.FC<EquipamentoPerfilProps> = ({
  perfis,
  selectedPerfilId,
  onSelectPerfil,
  onSavePerfil,
  onDeletePerfil,
  canSave,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [nomePerfil, setNomePerfil] = useState('');

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nomePerfil.trim()) return;
    onSavePerfil(nomePerfil.trim());
    setNomePerfil('');
    setIsModalOpen(false);
  };

  return (
    <div className="flex flex-col gap-3 p-4 bg-graphite-700/50 border border-graphite-600 rounded-md">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bookmark size={18} className="text-amber-500" />
          <span className="font-sans text-[14px] text-vapor-100 font-medium">
            Perfis de Equipamento
          </span>
          <span className="font-mono text-[12px] text-vapor-400">
            ({perfis.length}/3)
          </span>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {canSave && perfis.length < 3 && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsModalOpen(true)}
              className="text-[13px] py-1.5 px-3 min-h-[40px] flex items-center gap-1.5 border-amber-500/40 text-amber-500 hover:bg-amber-500/10"
            >
              <Plus size={16} />
              Salvar como perfil
            </Button>
          )}
        </div>
      </div>

      {/* Lista / Seletor de Perfis */}
      {perfis.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <button
            type="button"
            onClick={() => onSelectPerfil(null)}
            className={`px-3 py-1.5 rounded text-[13px] font-sans transition-colors min-h-[38px] ${
              selectedPerfilId === null
                ? 'bg-amber-500/20 text-amber-500 font-medium border border-amber-500/40'
                : 'bg-graphite-800 text-vapor-400 hover:text-vapor-100 border border-graphite-600'
            }`}
          >
            Personalizado
          </button>
          {perfis.map((p) => (
            <div key={p.id} className="flex items-center">
              <button
                type="button"
                onClick={() => onSelectPerfil(p)}
                className={`px-3 py-1.5 rounded-l text-[13px] font-sans transition-colors min-h-[38px] ${
                  selectedPerfilId === p.id
                    ? 'bg-amber-500/20 text-amber-500 font-medium border border-amber-500/40'
                    : 'bg-graphite-800 text-vapor-100 hover:border-vapor-400 border border-graphite-600'
                }`}
              >
                {p.nome}
              </button>
              <button
                type="button"
                title="Excluir perfil"
                onClick={() => onDeletePerfil(p.id)}
                className="px-2 py-1.5 bg-graphite-800 border-y border-r border-graphite-600 text-vapor-400 hover:text-flare-400 rounded-r min-h-[38px] flex items-center justify-center transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Modal para nomear perfil */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Salvar Perfil de Equipamento"
        subtitle="Dê um apelido para guardar as configurações da lavadora, lança e calibração."
        icon={<Bookmark size={20} className="text-amber-500" />}
        maxWidth="md"
      >
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <Input
            type="text"
            placeholder="Ex: Lavadora da Oficina"
            value={nomePerfil}
            onChange={(e) => setNomePerfil(e.target.value)}
            autoFocus
            required
            className="min-h-[48px]"
          />
          <div className="flex justify-end gap-2 pt-3 border-t border-graphite-700">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsModalOpen(false)}
              className="min-h-[44px]"
            >
              Cancelar
            </Button>
            <Button type="submit" variant="primary" className="min-h-[44px]">
              Salvar Perfil
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
