import { describe, it, expect } from 'vitest';
import {
  calculateManualDilution,
  calculateMaquinaDilution,
  convertFlowRateToMlMin,
} from './calc';

describe('Calculadora de Diluição (calc.ts)', () => {
  // 1. Manual 1 L, 1:10 partes de água -> produto 90,9 / água 909,1
  it('deve calcular corretamente a diluição manual com partes de água', () => {
    const res = calculateManualDilution('1000', '10', 'agua');
    expect(res.isValid).toBe(true);
    expect(res.produtoFormatted).toBe('90,9');
    expect(res.aguaFormatted).toBe('909,1');
    expect(res.formattedOutput).toBe('Diluição por partes de água (10 partes de água): 1:10 = 90,9 mL + 909,1 mL');
  });

  // 2. Manual 1 L, 1:10 partes totais -> produto 100,0 / água 900,0
  it('deve calcular corretamente a diluição manual com partes totais', () => {
    const res = calculateManualDilution('1000', '10', 'totais');
    expect(res.isValid).toBe(true);
    expect(res.produtoFormatted).toBe('100,0');
    expect(res.aguaFormatted).toBe('900,0');
    expect(res.formattedOutput).toBe('Diluição por partes totais (10 partes totais): 1:10 = 100,0 mL + 900,0 mL');
  });

  // 3. Conversão de vazão 420 L/h -> 7000 mL/min
  it('deve converter corretamente 420 L/h para 7000 mL/min', () => {
    const mlMin = convertFlowRateToMlMin(420, 'L/h');
    expect(mlMin).toBe(7000);
  });

  // 4. Lavadora 7 L/min, fechado, sem calibração, pote 1 L, alvo 1:10 -> status 'unattainable'
  it('deve disparar status unattainable para diluição de lavadora inatingível (1:10 em 7 L/min)', () => {
    const res = calculateMaquinaDilution(
      '7',
      'L/min',
      '',
      'fechado',
      false,
      '',
      '',
      '1000',
      '10',
      'agua'
    );
    expect(res.status).toBe('unattainable');
    expect(res.warningMessage).toContain('Não dá para atingir essa diluição com essa lança');
  });

  // 5. Lavadora 7 L/min, fechado, sem calibração, pote 1 L, alvo 1:100 -> produto ≈ 108,9 e potRatioFormatted 1:8,1
  it('deve calcular lavadora 1:100 com produto ≈ 108,9 e concentração no pote 1:8,1', () => {
    const res = calculateMaquinaDilution(
      '7',
      'L/min',
      '',
      'fechado',
      false,
      '',
      '',
      '1000',
      '100',
      'agua'
    );
    expect(res.status).toBe('valid');
    expect(res.produtoFormatted).toBe('108,9');
    expect(res.potRatioFormatted).toBe('1:8,1');
    expect(res.targetRatioFormatted).toBe('1:100');
  });

  // 6. Calibrado 480/5400 -> sucção 8,9% no rodapé
  it('deve exibir sucção 8,9% no rodapé para calibração de 480 mL pote / 5400 mL balde', () => {
    const res = calculateMaquinaDilution(
      '420',
      'L/h',
      '1200',
      'fechado',
      true,
      '5400',
      '480',
      '1000',
      '100',
      'agua'
    );
    expect(res.status).toBe('valid');
    expect(res.isCalibrated).toBe(true);
    expect(res.suctionPercentage.toFixed(1).replace('.', ',')).toBe('8,9');
    expect(res.footerSegments).toContain('calibrado (sucção 8,9%)');
  });

  // 7. Calibrado 3000/5000 -> status 'calibracao_invalida' (f >= 0.5)
  it('deve retornar status calibracao_invalida se f >= 0.5', () => {
    const res = calculateMaquinaDilution(
      '7',
      'L/min',
      '',
      'fechado',
      true,
      '5000',
      '3000',
      '1000',
      '100',
      'agua'
    );
    expect(res.status).toBe('calibracao_invalida');
    expect(res.warningMessage).toContain('Valores de calibração improváveis');
  });

  // 8. Parcialmente aberto sem calibração -> status 'uncalibrated_open'
  it('deve retornar status uncalibrated_open quando registro for parcialmente aberto sem calibração', () => {
    const res = calculateMaquinaDilution(
      '7',
      'L/min',
      '',
      'parcialmente_aberto',
      false,
      '',
      '',
      '1000',
      '100',
      'agua'
    );
    expect(res.status).toBe('uncalibrated_open');
    expect(res.warningMessage).toContain('Só é possível calcular com precisão nessa posição se você calibrar');
  });

  // 9. Sem PSI -> rodapé sem separador órfão
  it('deve gerar rodapé limpo sem PSI quando o campo de pressão estiver em branco', () => {
    const res = calculateMaquinaDilution(
      '7',
      'L/min',
      '',
      'fechado',
      false,
      '',
      '',
      '1000',
      '100',
      'agua'
    );
    expect(res.footerSegments).toEqual([
      'Registro fechado',
      '7 L/min',
      'sucção estimada em 9,1% — calibre para maior precisão',
    ]);
    expect(res.footerSegments.join(' · ')).toBe(
      'Registro fechado · 7 L/min · sucção estimada em 9,1% — calibre para maior precisão'
    );
  });
});
