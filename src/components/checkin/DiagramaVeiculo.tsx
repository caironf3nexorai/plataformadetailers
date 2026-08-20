import React, { useState, useRef } from 'react';
import type { VistaDiagrama, TipoAvaria, CheckinAvaria, CheckinFoto } from '../../types/checkin';
import { clampedPercentage, formatarNomeVista, formatarNomeAvaria } from '../../utils/checkin';
import { formatarData, formatarHora } from '../../utils/datas';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Trash2, Camera } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface DiagramaVeiculoProps {
  checkinId: string;
  avarias: CheckinAvaria[];
  fotos: CheckinFoto[];
  finalizado: boolean;
  onAddAvaria: (avaria: Omit<CheckinAvaria, 'id' | 'created_at'>) => Promise<void>;
  onRemoveAvaria: (avariaId: string) => Promise<void>;
  onAddFotoAvaria: (avariaId: string, file: File, descricao?: string) => Promise<void>;
  svgRefs?: React.MutableRefObject<{ [key in VistaDiagrama]?: SVGSVGElement | null }>;
}

export const DiagramaVeiculo: React.FC<DiagramaVeiculoProps> = ({
  checkinId,
  avarias,
  fotos,
  finalizado,
  onAddAvaria,
  onRemoveAvaria,
  onAddFotoAvaria,
  svgRefs,
}) => {
  const { tenant } = useAuth();
  const [vistaAtiva, setVistaAtiva] = useState<VistaDiagrama>('lateral_esquerda');
  
  // Estado para criar avaria
  const [pendingPos, setPendingPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedTipo, setSelectedTipo] = useState<TipoAvaria>('risco');
  const [avariaDescricao, setAvariaDescricao] = useState('');
  const [savingAvaria, setSavingAvaria] = useState(false);

  // Estado para visualizar/editar avaria existente
  const [selectedAvaria, setSelectedAvaria] = useState<CheckinAvaria | null>(null);
  const [uploadingFotoAvaria, setUploadingFotoAvaria] = useState(false);

  const activeSvgRef = useRef<SVGSVGElement | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const vistas: { key: VistaDiagrama; label: string }[] = [
    { key: 'lateral_esquerda', label: 'Lat. Esquerda' },
    { key: 'lateral_direita', label: 'Lat. Direita' },
    { key: 'frente', label: 'Frente' },
    { key: 'traseira', label: 'Traseira' },
    { key: 'superior', label: 'Superior' },
  ];

  // Handler unificado usando onPointerDown + onPointerUp para detectar tap real (distância < 10px e tempo < 500ms)
  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (finalizado) return;
    pointerStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      time: Date.now(),
    };
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (finalizado) return;
    if (!pointerStartRef.current || !activeSvgRef.current) return;

    const start = pointerStartRef.current;
    pointerStartRef.current = null;

    const deltaX = Math.abs(e.clientX - start.x);
    const deltaY = Math.abs(e.clientY - start.y);
    const distance = Math.hypot(deltaX, deltaY);
    const duration = Date.now() - start.time;

    // Se distância > 10px ou duração > 500ms, foi rolagem ou arraste: ignora
    if (distance > 10 || duration > 500) {
      return;
    }

    const rect = activeSvgRef.current.getBoundingClientRect();
    const posX = clampedPercentage(((e.clientX - rect.left) / rect.width) * 100);
    const posY = clampedPercentage(((e.clientY - rect.top) / rect.height) * 100);

    setPendingPos({ x: posX, y: posY });
    setSelectedTipo('risco');
    setAvariaDescricao('');
  };

  const handleConfirmAvaria = async () => {
    if (!pendingPos || !tenant) return;
    setSavingAvaria(true);
    try {
      await onAddAvaria({
        tenant_id: tenant.id,
        checkin_id: checkinId,
        vista: vistaAtiva,
        pos_x: pendingPos.x,
        pos_y: pendingPos.y,
        tipo: selectedTipo,
        descricao: avariaDescricao.trim() || null,
      });
      setPendingPos(null);
    } catch (err: any) {
      console.error('[DiagramaVeiculo] Erro ao salvar avaria:', err);
    } finally {
      setSavingAvaria(false);
    }
  };

  const handleUploadFotoAvaria = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedAvaria || !e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    setUploadingFotoAvaria(true);
    try {
      await onAddFotoAvaria(selectedAvaria.id, file, `Foto de ${selectedAvaria.tipo}`);
    } catch (err: any) {
      console.error('[DiagramaVeiculo] Erro ao enviar foto da avaria:', err);
    } finally {
      setUploadingFotoAvaria(false);
    }
  };

  // Renderiza silhuetas vetoriais próprias
  const renderSvgSilhouette = (key: VistaDiagrama) => {
    const isCurrent = vistaAtiva === key;
    const avariasNaVista = avarias.filter((a) => a.vista === key);
    const setRef = (el: SVGSVGElement | null) => {
      if (isCurrent) activeSvgRef.current = el;
      if (svgRefs) {
        svgRefs.current[key] = el;
      }
    };

    let pathContent: React.ReactNode = null;

    switch (key) {
      case 'lateral_esquerda':
      case 'lateral_direita':
        pathContent = (
          <g stroke="currentColor" strokeWidth="2" fill="none">
            {/* Linha do teto, capô e porta-malas */}
            <path d="M 20,80 C 60,35 120,30 180,30 C 240,30 280,50 310,65 L 375,70 C 390,75 395,90 390,105 L 385,125 L 15,125 L 12,95 Z" className="text-vapor-300" />
            {/* Vidros */}
            <path d="M 80,70 L 120,38 L 185,38 L 185,70 Z" fill="#27272a" opacity="0.6" />
            <path d="M 190,38 L 245,38 L 280,70 L 190,70 Z" fill="#27272a" opacity="0.6" />
            {/* Rodas */}
            <circle cx="75" cy="125" r="22" fill="#18181b" stroke="#71717a" strokeWidth="3" />
            <circle cx="315" cy="125" r="22" fill="#18181b" stroke="#71717a" strokeWidth="3" />
            {/* Maçanetas */}
            <line x1="185" y1="38" x2="185" y2="125" stroke="#52525b" />
            <rect x="150" y="78" width="16" height="4" rx="1" fill="#a1a1aa" />
            <rect x="220" y="78" width="16" height="4" rx="1" fill="#a1a1aa" />
          </g>
        );
        break;
      case 'frente':
        pathContent = (
          <g stroke="currentColor" strokeWidth="2" fill="none">
            <path d="M 40,110 C 50,55 70,35 100,35 C 130,35 270,35 300,35 C 330,35 350,55 360,110 L 365,130 L 35,130 Z" className="text-vapor-300" />
            <path d="M 65,55 C 95,42 305,42 335,55 L 345,85 L 55,85 Z" fill="#27272a" opacity="0.6" />
            {/* Faróis */}
            <rect x="45" y="92" width="45" height="20" rx="4" fill="#fef08a" opacity="0.8" stroke="#eab308" />
            <rect x="310" y="92" width="45" height="20" rx="4" fill="#fef08a" opacity="0.8" stroke="#eab308" />
            {/* Grade */}
            <rect x="105" y="95" width="190" height="28" rx="3" fill="#18181b" stroke="#71717a" />
          </g>
        );
        break;
      case 'traseira':
        pathContent = (
          <g stroke="currentColor" strokeWidth="2" fill="none">
            <path d="M 40,110 C 50,55 70,35 100,35 C 130,35 270,35 300,35 C 330,35 350,55 360,110 L 365,130 L 35,130 Z" className="text-vapor-300" />
            <path d="M 65,55 C 95,42 305,42 335,55 L 345,85 L 55,85 Z" fill="#27272a" opacity="0.6" />
            {/* Lanternas */}
            <rect x="45" y="92" width="45" height="20" rx="4" fill="#f87171" opacity="0.8" stroke="#ef4444" />
            <rect x="310" y="92" width="45" height="20" rx="4" fill="#f87171" opacity="0.8" stroke="#ef4444" />
            {/* Placa */}
            <rect x="140" y="100" width="120" height="20" rx="2" fill="#ffffff" stroke="#000000" />
          </g>
        );
        break;
      case 'superior':
        pathContent = (
          <g stroke="currentColor" strokeWidth="2" fill="none">
            <path d="M 40,20 C 80,12 320,12 360,20 C 380,40 380,120 360,140 C 320,148 80,148 40,140 C 20,120 20,40 40,20 Z" className="text-vapor-300" />
            <path d="M 70,30 C 120,25 280,25 330,30 L 320,55 C 260,50 140,50 80,55 Z" fill="#27272a" opacity="0.6" />
            <path d="M 70,130 C 120,135 280,135 330,130 L 320,105 C 260,110 140,110 80,105 Z" fill="#27272a" opacity="0.6" />
            <rect x="80" y="55" width="240" height="50" fill="#18181b" stroke="#52525b" />
          </g>
        );
        break;
    }

    return (
      <div className="w-full max-w-full overflow-hidden px-0 relative rounded-lg">
        <svg
          ref={setRef}
          viewBox="0 0 400 160"
          preserveAspectRatio="xMidYMid meet"
          onPointerDown={isCurrent ? handlePointerDown : undefined}
          onPointerUp={isCurrent ? handlePointerUp : undefined}
          className={`w-full h-auto block select-none bg-graphite-900 rounded-lg border transition-colors ${
            isCurrent ? 'border-amber-500 cursor-crosshair' : 'border-graphite-700'
          }`}
          style={{ touchAction: 'pan-y' }}
        >
          {pathContent}

          {/* Marcações de Avarias neste SVG */}
          {avariasNaVista.map((av) => {
            const isSelected = selectedAvaria?.id === av.id;
            return (
              <g
                key={av.id}
                transform={`translate(${(av.pos_x * 400) / 100}, ${(av.pos_y * 160) / 100})`}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedAvaria(av);
                }}
                className="cursor-pointer group"
              >
                {/* Sombra de destaque */}
                <circle r="12" className="fill-flare-500/30 animate-pulse" />

                {/* Ícones por Tipo */}
                {av.tipo === 'risco' && (
                  <circle r="8" fill="none" stroke="#f97316" strokeWidth="3" />
                )}
                {av.tipo === 'amassado' && (
                  <circle r="8" fill="#f97316" stroke="#ffffff" strokeWidth="2" />
                )}
                {av.tipo === 'avariado' && (
                  <g stroke="#f97316" strokeWidth="3">
                    <line x1="-7" y1="-7" x2="7" y2="7" />
                    <line x1="7" y1="-7" x2="-7" y2="7" />
                  </g>
                )}
                {av.tipo === 'faltante' && (
                  <polygon points="0,-8 -8,7 8,7" fill="#f97316" stroke="#ffffff" strokeWidth="1.5" />
                )}

                {isSelected && (
                  <circle r="14" fill="none" stroke="#ffffff" strokeWidth="2" strokeDasharray="3,3" />
                )}
              </g>
            );
          })}
        </svg>
      </div>
    );
  };

  return (
    <div className="w-full max-w-full overflow-hidden flex flex-col gap-4">
      {/* Abas das Vistas do Veículo - Scroll Horizontal com Snap */}
      <div className="w-full max-w-full min-w-0 overflow-x-auto pb-2 scrollbar-none snap-x snap-mandatory flex items-center gap-1.5">
        {vistas.map((v) => {
          const count = avarias.filter((a) => a.vista === v.key).length;
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => setVistaAtiva(v.key)}
              className={`snap-start shrink-0 px-3 py-2 rounded-md font-display text-[12px] uppercase tracking-wide flex items-center gap-1.5 whitespace-nowrap min-h-[44px] ${
                vistaAtiva === v.key
                  ? 'bg-amber-500 text-graphite-950 font-bold'
                  : 'bg-graphite-800 text-vapor-300 hover:bg-graphite-700'
              }`}
            >
              <span>{v.label}</span>
              {count > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[11px] font-mono bg-graphite-950 text-amber-400 font-bold">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Instabilidade / Instrução */}
      <div className="p-3 bg-graphite-800/80 border border-graphite-700 rounded-lg flex items-center justify-between gap-3 text-[12px] text-vapor-300">
        <span>Toque em qualquer ponto do veículo abaixo para marcar um risco ou avaria.</span>
        <span className="font-mono text-amber-400 font-bold shrink-0">
          {avarias.length} avaria(s) total
        </span>
      </div>

      {/* Diagrama Interativo (Renderiza todas as 5 vistas no DOM para popular os refs do PDF) */}
      <div className="relative">
        {vistas.map((v) => (
          <div key={v.key} className={v.key === vistaAtiva ? 'block' : 'hidden'}>
            {renderSvgSilhouette(v.key)}
          </div>
        ))}
      </div>

      {/* Legenda de Marcações */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono text-[12px] text-vapor-400">
        <div className="flex items-center gap-2">
          <span className="w-3.5 h-3.5 rounded-full border-2 border-flare-400 inline-block" />
          <span>Risco (Círculo vazado)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3.5 h-3.5 rounded-full bg-flare-400 inline-block" />
          <span>Amassado (Círculo cheio)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-bold text-flare-400 text-[14px]">✕</span>
          <span>Avariado (X)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-flare-400 text-[14px]">▲</span>
          <span>Faltante (Triângulo)</span>
        </div>
      </div>

      {/* Modal para Adicionar Avaria no Ponto Tocado */}
      <Modal
        isOpen={!!pendingPos}
        onClose={() => setPendingPos(null)}
        title={`Adicionar Avaria em ${formatarNomeVista(vistaAtiva)}`}
      >
        <div className="flex flex-col gap-4">
          <label className="font-sans text-[13px] text-vapor-300 font-medium">
            Selecione o Tipo de Avaria:
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(['risco', 'amassado', 'avariado', 'faltante'] as TipoAvaria[]).map((tipo) => (
              <button
                key={tipo}
                type="button"
                onClick={() => setSelectedTipo(tipo)}
                className={`p-3 rounded-lg border font-display text-[13px] uppercase tracking-wide flex items-center justify-between min-h-[56px] ${
                  selectedTipo === tipo
                    ? 'bg-amber-500 text-graphite-950 font-bold border-amber-400'
                    : 'bg-graphite-900 text-vapor-200 border-graphite-700 hover:bg-graphite-800'
                }`}
              >
                <span>{formatarNomeAvaria(tipo)}</span>
                {tipo === 'risco' && <span className="w-4 h-4 rounded-full border-2 border-current" />}
                {tipo === 'amassado' && <span className="w-4 h-4 rounded-full bg-current" />}
                {tipo === 'avariado' && <span className="font-bold">✕</span>}
                {tipo === 'faltante' && <span>▲</span>}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-sans text-[13px] text-vapor-300 font-medium">
              Descrição Detalhada (opcional):
            </label>
            <textarea
              value={avariaDescricao}
              onChange={(e) => setAvariaDescricao(e.target.value)}
              placeholder="Ex: Risco profundo de 5cm na porta dianteira"
              rows={3}
              className="appearance-none bg-graphite-700 border border-graphite-600 rounded-lg p-3 text-vapor-100 placeholder-vapor-600 outline-none focus:border-amber-500 font-sans text-[14px]"
              style={{ WebkitAppearance: 'none' }}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-graphite-700">
            <Button type="button" variant="secondary" onClick={() => setPendingPos(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleConfirmAvaria}
              disabled={savingAvaria}
              className="min-h-[48px]"
            >
              {savingAvaria ? 'Salvando...' : 'Adicionar Avaria'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal para Visualizar / Remover Avaria Selecionada */}
      {selectedAvaria && (
        <Modal
          isOpen={!!selectedAvaria}
          onClose={() => setSelectedAvaria(null)}
          title={`Avaria: ${formatarNomeAvaria(selectedAvaria.tipo)} (${formatarNomeVista(selectedAvaria.vista)})`}
        >
          <div className="flex flex-col gap-4">
            <div className="p-3 bg-graphite-900 rounded-lg border border-graphite-700 flex flex-col gap-1 font-sans text-[13px]">
              <span className="text-vapor-400">Descrição:</span>
              <span className="text-vapor-100 font-medium">{selectedAvaria.descricao || 'Sem descrição cadastrada'}</span>
              <span className="font-mono text-[11px] text-vapor-500 mt-1">
                Posição: X {selectedAvaria.pos_x.toFixed(1)}% | Y {selectedAvaria.pos_y.toFixed(1)}%
              </span>
            </div>

            {/* Fotos associadas a esta avaria */}
            <div className="flex flex-col gap-2">
              <label className="font-sans text-[13px] text-vapor-300 font-medium flex items-center justify-between">
                <span>Fotos desta avaria ({fotos.filter(f => f.avaria_id === selectedAvaria.id).length}):</span>
                {!finalizado && (
                  <label className="px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-graphite-950 font-bold text-[12px] cursor-pointer transition-colors flex items-center gap-1.5 min-h-[40px]">
                    <Camera size={14} />
                    <span>Adicionar Foto</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleUploadFotoAvaria}
                      disabled={uploadingFotoAvaria}
                      className="hidden"
                    />
                  </label>
                )}
              </label>

              {uploadingFotoAvaria && (
                <span className="text-[12px] text-amber-400 font-mono">Enviando foto da avaria...</span>
              )}

              {/* Lista de Fotos desta Avaria com Carimbo de Data/Hora */}
              {fotos.filter(f => f.avaria_id === selectedAvaria.id).length > 0 && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {fotos.filter(f => f.avaria_id === selectedAvaria.id).map((ft) => (
                    <div key={ft.id} className="flex flex-col gap-1">
                      <div className="rounded-lg overflow-hidden border border-graphite-700 bg-graphite-950 aspect-video flex items-center justify-center">
                        <span className="text-[11px] font-sans text-vapor-300 p-2 truncate">
                          {ft.descricao || 'Foto de avaria'}
                        </span>
                      </div>
                      <span className="font-mono text-[11px] text-vapor-400 px-0.5">
                        {formatarData(ft.created_at)} {formatarHora(ft.created_at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-graphite-700">
              {!finalizado ? (
                <Button
                  type="button"
                  variant="danger"
                  onClick={async () => {
                    await onRemoveAvaria(selectedAvaria.id);
                    setSelectedAvaria(null);
                  }}
                  className="min-h-[48px] flex items-center gap-2"
                >
                  <Trash2 size={16} />
                  <span>Remover</span>
                </Button>
              ) : (
                <span className="text-[12px] text-amber-500 font-mono">Imutável (Vistoria Assinada)</span>
              )}

              <Button type="button" variant="secondary" onClick={() => setSelectedAvaria(null)}>
                Fechar
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
