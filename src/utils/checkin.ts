import type { TipoAvaria, VistaDiagrama, NivelSujidade, EstadoIluminacao, EstadoFluido } from '../types/checkin';
import { supabase } from '../lib/supabase';

export function clampedPercentage(val: number): number {
  if (isNaN(val)) return 0;
  return Math.max(0, Math.min(100, Math.round(val * 100) / 100));
}

export function formatarNivelCombustivel(nivel: number | null | undefined): string {
  if (nivel === null || nivel === undefined) return 'Não informado';
  switch (nivel) {
    case 0:
      return 'Reserva (Vazio)';
    case 1:
      return 'Reserva (12%)';
    case 2:
      return '25%';
    case 3:
      return '37%';
    case 4:
      return '50% (Meio Tanque)';
    case 5:
      return '62%';
    case 6:
      return '75%';
    case 7:
      return '87%';
    case 8:
      return '100% (Tanque Cheio)';
    default:
      return `${Math.round((nivel / 8) * 100)}%`;
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

/**
 * Executa a dispensa de vistoria chamando a RPC dispensar_vistoria.
 * Possui fallback transparente para iniciar_execucao caso a migration 0083
 * ainda não tenha sido aplicada no banco ou o cache do PostgREST não tenha atualizado.
 */
export async function dispensarVistoriaAgendamento(agendamentoId: string): Promise<string> {
  const { data, error } = await supabase.rpc('dispensar_vistoria', {
    p_agendamento: agendamentoId,
  });

  if (!error && data) {
    const execId = typeof data === 'string' ? data : (data.execucao_id || data.id);
    if (execId) return execId;
  }

  // Se a RPC dispensar_vistoria falhar por ausência no schema cache (função não encontrada),
  // executa o fallback iniciando a execução diretamente:
  const isFunctionNotFound = error?.message?.includes('dispensar_vistoria') ||
                             error?.message?.includes('schema cache') ||
                             error?.code === 'PGRST202' ||
                             (error as any)?.details?.includes('dispensar_vistoria');

  if (isFunctionNotFound) {
    const { data: initData, error: initErr } = await supabase.rpc('iniciar_execucao', {
      p_agendamento: agendamentoId,
    });
    if (initErr) throw initErr;
    const execId = typeof initData === 'string' ? initData : (initData?.execucao_id || initData?.id);
    if (execId) return execId;
  }

  if (error) throw error;
  throw new Error('Não foi possível iniciar o atendimento.');
}
