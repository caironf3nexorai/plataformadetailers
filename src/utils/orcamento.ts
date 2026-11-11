import type { Orcamento, OrcamentoPublicoData, StatusOrcamento } from '../types/orcamento';
import type { BadgeTone } from '../components/ui/Badge';

const NOMES_GENERICOS_CLIENTE = new Set([
  'cliente',
  'não informado',
  'nao informado',
  'sem nome',
]);

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

export function isNomeClienteValido(nome?: string | null): boolean {
  const limpo = (nome || '').trim();
  if (limpo.length < 2) return false;
  return !NOMES_GENERICOS_CLIENTE.has(limpo.toLowerCase());
}

function escolherMelhorNomeAvulsoOuAssinatura(
  nomeAvulso?: string | null,
  assinaturaNome?: string | null
): string {
  const avulsoLimpo = isNomeClienteValido(nomeAvulso) ? nomeAvulso!.trim() : '';
  const assinaturaLimpa = isNomeClienteValido(assinaturaNome) ? assinaturaNome!.trim() : '';

  if (avulsoLimpo && assinaturaLimpa) {
    // Se a oficina digitou só o primeiro nome (ex: "João") e o cliente assinou completo (ex: "João Silva"),
    // aproveita o nome completo preenchido pelo próprio cliente.
    if (
      !avulsoLimpo.includes(' ') &&
      assinaturaLimpa.includes(' ') &&
      assinaturaLimpa.toLowerCase().startsWith(`${avulsoLimpo.toLowerCase()} `)
    ) {
      return assinaturaLimpa;
    }
    return avulsoLimpo;
  }

  return avulsoLimpo || assinaturaLimpa;
}

export function obterNomeClienteOrcamento(
  orcamento?: Pick<Orcamento, 'cliente' | 'cliente_nome_avulso' | 'assinatura_nome'> | null,
  fallback = ''
): string {
  if (!orcamento) return fallback;

  if (isNomeClienteValido(orcamento.cliente?.nome)) {
    return orcamento.cliente!.nome.trim();
  }

  const melhorNome = escolherMelhorNomeAvulsoOuAssinatura(
    orcamento.cliente_nome_avulso,
    orcamento.assinatura_nome
  );

  return melhorNome || fallback;
}

export function obterPrimeiroNomeClienteOrcamento(
  orcamento?: Pick<Orcamento, 'cliente' | 'cliente_nome_avulso' | 'assinatura_nome'> | null,
  fallback = 'Cliente'
): string {
  const nome = obterNomeClienteOrcamento(orcamento, '');
  if (!nome) return fallback;
  return nome.split(/\s+/)[0] || fallback;
}

export function obterNomePreferencialPublico(
  data?: Pick<
    OrcamentoPublicoData,
    'cliente_nome' | 'cliente_nome_avulso' | 'assinatura_nome' | 'cliente_primeiro_nome' | 'tem_cliente_cadastrado'
  > | null
): string {
  if (!data) return '';

  if (isNomeClienteValido(data.cliente_nome)) {
    return data.cliente_nome!.trim();
  }

  const melhorAvulsoOuAssinatura = escolherMelhorNomeAvulsoOuAssinatura(
    data.cliente_nome_avulso,
    data.assinatura_nome
  );
  if (melhorAvulsoOuAssinatura) {
    return melhorAvulsoOuAssinatura;
  }

  if (isNomeClienteValido(data.cliente_primeiro_nome)) {
    return data.cliente_primeiro_nome!.trim();
  }

  return '';
}

export interface AgendamentoResumoOrcamento {
  id: string;
  inicio?: string | null;
  status?: string | null;
  numero_os?: number | null;
}

export function resolverAgendamentoVinculadoOrcamento(
  orcamento?: Pick<Orcamento, 'agendamento_id' | 'agendamento'> | null
): AgendamentoResumoOrcamento | null {
  if (!orcamento) return null;

  const joinBruto = Array.isArray(orcamento.agendamento)
    ? orcamento.agendamento[0]
    : orcamento.agendamento;

  if (joinBruto && typeof joinBruto === 'object' && joinBruto.id) {
    if (joinBruto.status === 'cancelado') {
      return null;
    }
    return {
      id: joinBruto.id,
      inicio: joinBruto.inicio ?? null,
      status: joinBruto.status ?? null,
      numero_os: joinBruto.numero_os ?? null,
    };
  }

  if (orcamento.agendamento === null) {
    return null;
  }

  if (orcamento.agendamento_id) {
    return {
      id: orcamento.agendamento_id,
      inicio: null,
      status: null,
      numero_os: null,
    };
  }

  return null;
}

export function isAgendamentoOrcamentoAtivo(
  orcamento?: Pick<Orcamento, 'agendamento_id' | 'agendamento'> | null
): boolean {
  return Boolean(resolverAgendamentoVinculadoOrcamento(orcamento));
}

export function isAgendamentoOrcamentoNaoCompareceu(
  orcamento?: Pick<Orcamento, 'agendamento_id' | 'agendamento'> | null
): boolean {
  const agendamento = resolverAgendamentoVinculadoOrcamento(orcamento);
  return agendamento?.status === 'nao_compareceu';
}

export function obterBadgeAgendamentoOrcamento(
  orcamento?: Pick<Orcamento, 'agendamento_id' | 'agendamento'> | null
): { label: string; tone: BadgeTone } {
  const agendamento = resolverAgendamentoVinculadoOrcamento(orcamento);
  if (!agendamento) {
    return { label: 'Aguardando agenda', tone: 'amber' };
  }

  switch (agendamento.status) {
    case 'nao_compareceu':
      return { label: 'OS Não Compareceu', tone: 'flare' };
    case 'concluido':
      return { label: 'OS Concluída', tone: 'mint' };
    case 'em_andamento':
      return { label: 'OS em Andamento', tone: 'amber' };
    case 'aguardando_confirmacao':
      return { label: 'OS Aguardando Sinal', tone: 'amber' };
    case 'confirmado':
      return { label: 'OS Confirmada', tone: 'cyan' };
    case 'agendado':
    default:
      return { label: 'OS Agendada', tone: 'cyan' };
  }
}
