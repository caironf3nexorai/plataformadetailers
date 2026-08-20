export type DiluicaoConvention = 'agua' | 'totais';

export type DiluicaoVariant = 'publico' | 'interno';

export type PosicaoRegistro = 'fechado' | 'parcialmente_aberto';

export interface EquipamentoPerfilData {
  id: string;
  nome: string;
  vazao: string;
  unidadeVazao: 'L/h' | 'L/min';
  psi: string;
  posicaoRegistro: PosicaoRegistro;
  isCalibrated: boolean;
  saiuBalde: string;
  sumiuPote: string;
  createdAt: string;
}

export interface ManualCalculationInput {
  volumeMl: string;
  ratioX: string;
  convention: DiluicaoConvention;
}

export interface ManualCalculationResult {
  isValid: boolean;
  produtoMl: number;
  aguaMl: number;
  produtoFormatted: string;
  aguaFormatted: string;
  formattedOutput: string;
  conventionText: string;
}

export type MaquinaResultStatus = 
  | 'empty'
  | 'uncalibrated_open'
  | 'calibracao_invalida'
  | 'unattainable'
  | 'valid';

export interface MaquinaCalculationResult {
  status: MaquinaResultStatus;
  produtoMl: number;
  aguaMl: number;
  produtoFormatted: string;
  aguaFormatted: string;
  potRatioFormatted: string;
  targetRatioFormatted: string;
  suctionPercentage: number;
  isCalibrated: boolean;
  hasHighConcWarning: boolean;
  warningMessage?: string;
  footerSegments: string[];
}
