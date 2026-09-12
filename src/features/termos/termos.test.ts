import { describe, it, expect } from 'vitest';
import { TIPOS_TERMOS_GARANTIA, TERMO_RESPONSABILIDADE_PADRAO } from '../../types/termos';

describe('Biblioteca de Modelos de Termos - Tipos e Padrões', () => {
  it('deve conter as especialidades essenciais nos modelos de garantia', () => {
    const tipos = TIPOS_TERMOS_GARANTIA.map(t => t.tipo);
    expect(tipos).toContain('polimento');
    expect(tipos).toContain('vitrificacao');
    expect(tipos).toContain('lavagem_motor');
    expect(tipos).toContain('microreparo');
    expect(tipos).toContain('higienizacao');
    expect(tipos).toContain('insulfilm');
    expect(tipos).toContain('geral');
  });

  it('cada modelo de garantia deve ter label, descricao e placeholder descritivos', () => {
    TIPOS_TERMOS_GARANTIA.forEach(t => {
      expect(t.label.length).toBeGreaterThan(3);
      expect(t.descricao.length).toBeGreaterThan(5);
      expect(t.placeholder.length).toBeGreaterThan(10);
    });
  });

  it('termo padrao de responsabilidade deve conter clausulas de protecao juridica essenciais', () => {
    expect(TERMO_RESPONSABILIDADE_PADRAO).toContain('objetos de valor');
    expect(TERMO_RESPONSABILIDADE_PADRAO).toContain('avarias preexistentes');
    expect(TERMO_RESPONSABILIDADE_PADRAO).toContain('testes de rodagem');
    expect(TERMO_RESPONSABILIDADE_PADRAO).toContain('pátio');
  });
});
