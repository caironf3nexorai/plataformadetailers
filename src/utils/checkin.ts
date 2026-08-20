import type { TipoAvaria, VistaDiagrama, NivelSujidade, EstadoIluminacao, EstadoFluido } from '../types/checkin';

export function clampedPercentage(val: number): number {
  if (isNaN(val)) return 0;
  return Math.max(0, Math.min(100, Math.round(val * 100) / 100));
}

export function formatarNivelCombustivel(nivel: number | null | undefined): string {
  if (nivel === null || nivel === undefined) return 'Não informado';
  switch (nivel) {
    case 0:
      return 'E (Vazio)';
    case 1:
      return '1/8';
    case 2:
      return '1/4';
    case 3:
      return '3/8';
    case 4:
      return '1/2 (Meio)';
    case 5:
      return '5/8';
    case 6:
      return '3/4';
    case 7:
      return '7/8';
    case 8:
      return 'F (Cheio)';
    default:
      return `${nivel}/8`;
  }
}

export function formatarNomeAvaria(tipo: TipoAvaria): string {
  switch (tipo) {
    case 'risco':
      return 'Risco';
    case 'amassado':
      return 'Amassado';
    case 'avariado':
      return 'Avariado';
    case 'faltante':
      return 'Faltante';
    default:
      return tipo;
  }
}

export function formatarNomeVista(vista: VistaDiagrama): string {
  switch (vista) {
    case 'frente':
      return 'Frente';
    case 'traseira':
      return 'Traseira';
    case 'lateral_esquerda':
      return 'Lateral Esquerda';
    case 'lateral_direita':
      return 'Lateral Direita';
    case 'superior':
      return 'Vista Superior';
    default:
      return vista;
  }
}

export function formatarSujidade(nivel: NivelSujidade | string | undefined): string {
  if (!nivel) return '—';
  switch (nivel) {
    case 'limpo':
      return 'Limpo';
    case 'leve':
      return 'Leve';
    case 'medio':
      return 'Médio';
    case 'sujo':
      return 'Sujo';
    case 'extremo':
      return 'Extremo';
    default:
      return nivel;
  }
}

export function formatarIluminacao(estado: EstadoIluminacao | string | undefined): string {
  if (!estado) return '—';
  switch (estado) {
    case 'ok':
      return 'OK';
    case 'queimado':
      return 'Queimado';
    case 'nao_testado':
      return 'Não testado';
    default:
      return estado;
  }
}

export function formatarFluido(estado: EstadoFluido | string | undefined): string {
  if (!estado) return '—';
  switch (estado) {
    case 'ok':
      return 'OK';
    case 'baixo':
      return 'Baixo';
    case 'ruim':
      return 'Ruim';
    case 'nao_verificado':
      return 'Não verificado';
    default:
      return estado;
  }
}
