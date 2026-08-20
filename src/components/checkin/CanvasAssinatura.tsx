import React, { useRef, useState, useEffect } from 'react';
import { Button } from '../ui/Button';
import { RotateCcw, Check } from 'lucide-react';

interface CanvasAssinaturaProps {
  onSaveSignature: (blob: Blob) => Promise<void>;
  saveButtonText?: string;
  disabled?: boolean;
}

export const CanvasAssinatura: React.FC<CanvasAssinaturaProps> = ({
  onSaveSignature,
  saveButtonText = 'Assinar e Finalizar Vistoria',
  disabled = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Redimensiona o canvas para preencher a largura do container pai mantendo a escala
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = 180;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.strokeStyle = '#f59e0b'; // amber-500
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }
  }, []);

  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();

    let clientX = 0;
    let clientY = 0;

    if ('touches' in e && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if ('clientX' in e) {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (disabled || saving) return;
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCanvasCoords(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || disabled || saving) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCanvasCoords(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasSignature) setHasSignature(true);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  const handleConfirm = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasSignature) return;
    setSaving(true);
    try {
      canvas.toBlob(async (blob) => {
        if (blob) {
          await onSaveSignature(blob);
        } else {
          console.error('[CanvasAssinatura] Erro ao capturar imagem da assinatura.');
        }
        setSaving(false);
      }, 'image/png');
    } catch (err) {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="relative rounded-lg border-2 border-dashed border-graphite-600 bg-graphite-950 overflow-hidden">
        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          className="w-full h-44 cursor-crosshair touch-none"
        />

        {!hasSignature && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-vapor-500 font-sans text-[13px] font-medium">
            Assine aqui usando o dedo ou mouse
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={handleClear}
          disabled={disabled || saving || !hasSignature}
          className="px-3 py-2 rounded text-[13px] font-medium text-vapor-400 hover:text-vapor-100 hover:bg-graphite-800 disabled:opacity-40 transition-colors flex items-center gap-1.5 min-h-[44px]"
        >
          <RotateCcw size={16} />
          <span>Limpar</span>
        </button>

        <Button
          type="button"
          variant="primary"
          onClick={handleConfirm}
          disabled={disabled || saving || !hasSignature}
          className="min-h-[48px] px-6 font-bold flex items-center gap-2"
        >
          <Check size={18} />
          <span>{saving ? 'Processando...' : saveButtonText}</span>
        </Button>
      </div>
    </div>
  );
};
