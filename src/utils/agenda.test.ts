import { describe, it, expect } from 'vitest';
import { 
  traduzirMotivoIndisponivel, 
  getLabelFromStatus, 
  getBadgeToneFromStatus, 
  calcularTermino,
  formatarHoraCurta,
  getNomeDiaSemana,
  obterLinkAgendaAgendamento,
  resolverPeriodoFiltroLista,
  resolverPeriodoVisaoCalendario,
  ordenarItensAgendaDia,
  agendamentoBateBuscaTexto,
} from './agenda';

describe('Agenda Utilities', () => {
  it('traduz motivos de indisponibilidade em português', () => {
    expect(traduzirMotivoIndisponivel('nao_cabe_no_expediente')).toBe('Excede o horário de expediente');
    expect(traduzirMotivoIndisponivel('bloqueado')).toBe('Horário bloqueado');
    expect(traduzirMotivoIndisponivel('passado')).toBe('Horário já passou');
    expect(traduzirMotivoIndisponivel('dia_reservado')).toBe('Dia reservado para serviço exclusivo');
    expect(traduzirMotivoIndisponivel('sem_box_livre')).toBe('Sem box livre neste horário');
    expect(traduzirMotivoIndisponivel(null)).toBe('Indisponível');
  });

  it('retorna labels de status legíveis', () => {
    expect(getLabelFromStatus('agendado')).toBe('Agendado');
    expect(getLabelFromStatus('aguardando_confirmacao')).toBe('Aguardando confirmação');
    expect(getLabelFromStatus('confirmado')).toBe('Confirmado');
    expect(getLabelFromStatus('em_andamento')).toBe('Em andamento');
    expect(getLabelFromStatus('concluido')).toBe('Concluído');
    expect(getLabelFromStatus('cancelado')).toBe('Cancelado');
    expect(getLabelFromStatus('nao_compareceu')).toBe('Não compareceu');
  });

  it('retorna tons visuais por status', () => {
    expect(getBadgeToneFromStatus('agendado')).toBe('vapor');
    expect(getBadgeToneFromStatus('aguardando_confirmacao')).toBe('amber');
    expect(getBadgeToneFromStatus('em_andamento')).toBe('amber');
    expect(getBadgeToneFromStatus('concluido')).toBe('mint');
    expect(getBadgeToneFromStatus('cancelado')).toBe('flare');
    expect(getBadgeToneFromStatus('nao_compareceu')).toBe('flare');
  });

  it('calcula o horário de término corretamente', () => {
    // 2026-08-01T08:00:00.000Z -> adiciona 90 minutos
    const inicio = '2026-08-01T08:00:00.000Z';
    const termino = calcularTermino(inicio, 90);
    expect(termino).toMatch(/^\d{2}:\d{2}$/);
  });

  it('formata horários de string HH:mm:ss para HH:mm', () => {
    expect(formatarHoraCurta('08:00:00')).toBe('08:00');
    expect(formatarHoraCurta('14:30')).toBe('14:30');
  });

  it('retorna o nome do dia da semana em português', () => {
    expect(getNomeDiaSemana(0)).toBe('Domingo');
    expect(getNomeDiaSemana(1)).toBe('Segunda-feira');
    expect(getNomeDiaSemana(6)).toBe('Sábado');
  });

  it('gera link direto de localização do agendamento na agenda', () => {
    expect(obterLinkAgendaAgendamento('ag-123', '2026-11-18T14:30:00-03:00')).toBe(
      '/agenda?aba=agenda&agendamentoId=ag-123&data=2026-11-18'
    );
    expect(obterLinkAgendaAgendamento('ag-123', null)).toBe(
      '/agenda?aba=agenda&agendamentoId=ag-123'
    );
    expect(obterLinkAgendaAgendamento(null, null)).toBe('/agenda?aba=agenda');
  });

  it('resolve corretamente períodos da lista incluindo todo o período e intervalo invertido', () => {
    const ref = new Date('2026-11-11T15:00:00-03:00'); // quarta-feira

    expect(resolverPeriodoFiltroLista('todos', '', '', ref)).toEqual({
      inicio: null,
      fim: null,
    });
    expect(resolverPeriodoFiltroLista('hoje', '', '', ref)).toEqual({
      inicio: '2026-11-11',
      fim: '2026-11-11',
    });
    expect(resolverPeriodoFiltroLista('semana', '', '', ref)).toEqual({
      inicio: '2026-11-09',
      fim: '2026-11-15',
    });
    expect(resolverPeriodoFiltroLista('mes', '', '', ref)).toEqual({
      inicio: '2026-11-01',
      fim: '2026-11-30',
    });
    expect(resolverPeriodoFiltroLista('personalizado', '2026-11-20', '2026-11-05', ref)).toEqual({
      inicio: '2026-11-05',
      fim: '2026-11-20',
    });
  });

  it('calcula intervalo semanal da visão calendário de segunda a domingo', () => {
    const ref = new Date('2026-11-11T12:00:00-03:00');
    expect(resolverPeriodoVisaoCalendario('semana', ref)).toEqual({
      inicio: '2026-11-09',
      fim: '2026-11-15',
    });
  });

  it('ordena atendimentos do dia com continuação primeiro e horário crescente', () => {
    const ordenado = ordenarItensAgendaDia([
      { ag: { id: '3', inicio: '2026-11-11T15:00:00-03:00' }, papel: { isContinuacao: false } },
      { ag: { id: '1', inicio: '2026-11-10T09:00:00-03:00' }, papel: { isContinuacao: true } },
      { ag: { id: '2', inicio: '2026-11-11T08:30:00-03:00' }, papel: { isContinuacao: false } },
    ]);
    expect(ordenado.map((x) => x.ag.id)).toEqual(['1', '2', '3']);
  });

  it('busca corretamente por OS, placa sem hífen, nome com acento e dígitos de telefone', () => {
    const ag = {
      numero_os: 42,
      cliente: { nome: 'João Araújo', telefone: '(11) 98765-4321' },
      veiculo: { placa: 'ABC-1234', modelo: 'Civic Touring', marca: 'Honda' },
      observacoes: 'Vitrificação 9H',
    };
    expect(agendamentoBateBuscaTexto(ag, 'OS 0042')).toBe(true);
    expect(agendamentoBateBuscaTexto(ag, 'abc1234')).toBe(true);
    expect(agendamentoBateBuscaTexto(ag, 'joao araujo')).toBe(true);
    expect(agendamentoBateBuscaTexto(ag, '987654321')).toBe(true);
    expect(agendamentoBateBuscaTexto(ag, 'corolla')).toBe(false);
  });
});
