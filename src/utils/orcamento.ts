import type { StatusOrcamento } from '../types/orcamento';
import type { BadgeTone } from '../components/ui/Badge';

export function getLabelFromStatusOrcamento(status: StatusOrcamento): string {
  switch (status) {
    case 'rascunho':
      return 'Rascunho';
    case 'enviado':
      return 'Enviado';
    case 'visualizado':
      return 'Visualizado';
    case 'aprovado':
      return 'Aprovado';
    case 'recusado':
      return 'Recusado';
    case 'expirado':
      return 'Expirado';
    default:
      return status;
  }
}

export function getBadgeToneFromStatusOrcamento(status: StatusOrcamento): BadgeTone {
  switch (status) {
    case 'rascunho':
      return 'vapor';
    case 'enviado':
      return 'amber';
    case 'visualizado':
      return 'cyan';
    case 'aprovado':
      return 'emerald';
    case 'recusado':
      return 'rose';
    case 'expirado':
      return 'graphite';
    default:
      return 'vapor';
  }
}
