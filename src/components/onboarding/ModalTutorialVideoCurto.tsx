import React from 'react';
import { ArrowRight, PlayCircle, Video } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { PlayerVideoSeguro } from '../video/PlayerVideoSeguro';
import type { ConfigTutorialVideo } from '../../config/tutorialVideos';

interface ModalTutorialVideoCurtoProps {
  aberto: boolean;
  videoConfig: ConfigTutorialVideo | null;
  onFechar: () => void;
  onIrParaConfiguracao: (rota: string) => void;
}

export const ModalTutorialVideoCurto: React.FC<ModalTutorialVideoCurtoProps> = ({
  aberto,
  videoConfig,
  onFechar,
  onIrParaConfiguracao,
}) => {
  if (!videoConfig) return null;

  const temVideoUrl = Boolean(videoConfig.url && videoConfig.url.trim().length > 0);

  return (
    <Modal
      isOpen={aberto}
      onClose={onFechar}
      title={videoConfig.titulo}
      subtitle="Tutorial rápido sob demanda"
      icon={<PlayCircle size={20} className="text-amber-500" />}
      maxWidth="2xl"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onFechar} className="text-xs min-h-[48px]">
            Fechar
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              onFechar();
              onIrParaConfiguracao(videoConfig.rotaDestino);
            }}
            className="text-xs font-bold flex items-center gap-1.5 min-h-[48px]"
          >
            <span>{videoConfig.labelBotao || 'Ir para esta configuração agora'}</span>
            <ArrowRight size={14} />
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="font-sans text-[13px] text-vapor-300 leading-relaxed">
          {videoConfig.descricao}
        </p>

        {temVideoUrl ? (
          <div className="rounded-xl overflow-hidden border border-graphite-700 bg-black">
            <PlayerVideoSeguro
              url={videoConfig.url}
              titulo={videoConfig.titulo}
              tempoInicial={videoConfig.tempoInicial}
              tempoFinal={videoConfig.tempoFinal}
              autoPlay={true}
              mostrarWatermark={false}
            />
          </div>
        ) : (
          <div className="p-6 rounded-xl bg-graphite-900/90 border border-graphite-700 flex flex-col items-center text-center gap-3">
            <div className="p-3 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <Video size={26} />
            </div>
            <div className="flex flex-col gap-1 max-w-md">
              <span className="font-display text-sm text-vapor-100 uppercase tracking-wide">
                Tutorial em vídeo em preparação
              </span>
              <p className="font-sans text-xs text-vapor-400 leading-relaxed">
                O vídeo curto desta etapa está sendo finalizado. Você já pode acessar a tela agora pelo botão abaixo para conferir ou ajustar em poucos segundos.
              </p>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

