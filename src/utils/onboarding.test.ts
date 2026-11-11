import { describe, it, expect } from 'vitest';
import {
  calcularProgressoOnboarding,
  mergeOnboardingFlags,
  type StatusOnboardingInput,
} from './onboarding';
import {
  resolverTutoriaisEtapas,
  resolverVideoBoasVindas,
} from '../config/tutorialVideos';

const baseInput: StatusOnboardingInput = {
  plano: 'pro',
  servicosCount: 15,
  servicosConfirmadosCount: 0,
  orcamentosCount: 0,
  termosGarantiaCount: 0,
  membrosCount: 1,
  temLogo: false,
  temIdentidade: false,
  temPix: false,
  sinalAtivo: false,
  temTermoRespCustom: false,
  progress: {},
};

describe('onboarding progress calculation', () => {
  it('inicia exatamente em 16% com a contagem exata de serviços carregados', () => {
    const res = calcularProgressoOnboarding(baseInput);
    expect(res.porcentagem).toBe(16);
    expect(res.etapasConcluidas).toBe(0);
    expect(res.fase1Concluida).toBe(false);
    expect(res.tudoConcluido).toBe(false);
    expect(res.etapa1Texto).toContain('15 serviços padrão carregados');
  });

  it('exibe corretamente 10 serviços quando a oficina inicia no plano Free', () => {
    const res = calcularProgressoOnboarding({ ...baseInput, plano: 'free', servicosCount: 10 });
    expect(res.etapa1Texto).toContain('10 serviços padrão carregados');
    const etapa8 = res.etapas.find((e) => e.id === 'etapa_8');
    expect(etapa8?.subtitulo).toContain('Plano Free');
  });

  it('soma +12% por etapa concluída automaticamente até fechar Fase 1 (52%) e 100%', () => {
    const fase1 = calcularProgressoOnboarding({
      ...baseInput,
      orcamentosCount: 1,
      temLogo: true,
      servicosConfirmadosCount: 3,
    });
    expect(fase1.etapasConcluidas).toBe(3);
    expect(fase1.porcentagem).toBe(52);
    expect(fase1.fase1Concluida).toBe(true);
    expect(fase1.tudoConcluido).toBe(false);

    const completo = calcularProgressoOnboarding({
      ...baseInput,
      orcamentosCount: 1,
      temLogo: true,
      servicosConfirmadosCount: 3,
      temTermoRespCustom: true,
      temPix: true,
      membrosCount: 2,
      progress: { horarios_revisados: true },
    });
    expect(completo.etapasConcluidas).toBe(7);
    expect(completo.porcentagem).toBe(100);
    expect(completo.tudoConcluido).toBe(true);
  });

  it('direciona Etapa 2 para ?novo=1 apenas quando há 0 orçamentos', () => {
    const semOrcamento = calcularProgressoOnboarding(baseInput);
    expect(semOrcamento.etapas.find((e) => e.id === 'etapa_2')?.rota).toBe('/orcamentos?novo=1');

    const comOrcamento = calcularProgressoOnboarding({ ...baseInput, orcamentosCount: 2 });
    expect(comOrcamento.etapas.find((e) => e.id === 'etapa_2')?.rota).toBe('/orcamentos');
  });

  it('permite concluir etapas manualmente e via atalho Trabalho Sozinho', () => {
    const manual = calcularProgressoOnboarding({
      ...baseInput,
      progress: {
        trabalho_sozinho: true,
        manual: {
          etapa_2: true,
          etapa_5: true,
        },
      },
    });
    expect(manual.etapas.find((e) => e.id === 'etapa_2')?.concluida).toBe(true);
    expect(manual.etapas.find((e) => e.id === 'etapa_5')?.concluida).toBe(true);
    expect(manual.etapas.find((e) => e.id === 'etapa_8')?.concluida).toBe(true);
    expect(manual.porcentagem).toBe(16 + 3 * 12);
  });

  it('preserva marcações manuais existentes ao fazer merge de flags de progresso', () => {
    const merged = mergeOnboardingFlags(
      { manual: { etapa_2: true, etapa_3: true }, horarios_revisados: true },
      { catalogo_revisado: true, manual: { etapa_4: true } }
    );
    expect(merged.horarios_revisados).toBe(true);
    expect(merged.catalogo_revisado).toBe(true);
    expect(merged.manual).toEqual({
      etapa_2: true,
      etapa_3: true,
      etapa_4: true,
    });
  });

  it('mescla URLs e timestamps de tutoriais vindos da configuração remota sobre o fallback', () => {
    const tutoriais = resolverTutoriaisEtapas({
      videos_tutoriais_etapas: {
        etapa_2: { url: 'https://youtu.be/orcamento123', tempoInicial: 5, tempoFinal: 35 },
        etapa_6: { url: '  https://vimeo.com/999999  ' },
      },
    });

    expect(tutoriais.etapa_2.url).toBe('https://youtu.be/orcamento123');
    expect(tutoriais.etapa_2.tempoInicial).toBe(5);
    expect(tutoriais.etapa_2.tempoFinal).toBe(35);
    expect(tutoriais.etapa_6.url).toBe('https://vimeo.com/999999');
    expect(tutoriais.etapa_3.url).toBe('');

    const bv = resolverVideoBoasVindas({
      video_onboarding_url: 'https://youtu.be/welcome60s',
      video_onboarding_titulo: 'Boas-vindas Custom',
      video_onboarding_ativo: true,
      videos_tutoriais_etapas: {
        boas_vindas: { tempoInicial: 2, tempoFinal: 62 },
      },
    });
    expect(bv).toEqual({
      url: 'https://youtu.be/welcome60s',
      titulo: 'Boas-vindas Custom',
      ativo: true,
      tempoInicial: 2,
      tempoFinal: 62,
    });
  });

  it('informa de forma honesta quando serviços carregados ainda não possuem preços definidos', () => {
    const semPrecos = calcularProgressoOnboarding({
      ...baseInput,
      servicosCount: 15,
      servicosComPrecoCount: 0,
    });
    expect(semPrecos.etapa1Texto).toBe(
      'Conta criada e 15 serviços padrão carregados (defina os preços na Matriz)'
    );
    const etapa4SemPreco = semPrecos.etapas.find((e) => e.id === 'etapa_4');
    expect(etapa4SemPreco?.subtitulo).toContain('Defina os preços iniciais');

    const comPrecos = calcularProgressoOnboarding({
      ...baseInput,
      servicosCount: 15,
      servicosComPrecoCount: 15,
    });
    expect(comPrecos.etapa1Texto).toBe(
      'Conta criada e 15 serviços padrão carregados (com valores médios sugeridos)'
    );
    const etapa4ComPreco = comPrecos.etapas.find((e) => e.id === 'etapa_4');
    expect(etapa4ComPreco?.subtitulo).toContain('médias nacionais');
  });
});

