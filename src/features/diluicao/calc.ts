import type {
  DiluicaoConvention,
  ManualCalculationResult,
  MaquinaCalculationResult,
  PosicaoRegistro,
} from './types';

/**
 * Converte string pt-BR ou US para número float.
 * Ex: "12,5" -> 12.5 | "1000" -> 1000
 */
export function parseNumber(val: string): number {
  if (!val) return 0;
  const cleanVal = val.trim().replace(',', '.');
  const num = parseFloat(cleanVal);
  return isNaN(num) || num < 0 ? 0 : num;
}

/**
 * Formata número para pt-BR com N casas decimais.
 * Ex: 90.9 -> "90,9"
 */
export function formatNumber(val: number, decimals = 1): string {
  if (isNaN(val) || !isFinite(val)) return '0,0';
  return val.toFixed(decimals).replace('.', ',');
}

/**
 * Converte vazão de L/h ou L/min para mL/min
 */
export function convertFlowRateToMlMin(vazao: number, unit: 'L/h' | 'L/min'): number {
  if (unit === 'L/h') {
    return (vazao * 1000) / 60;
  }
  return vazao * 1000;
}

/**
 * MODO 1: SNOW FOAM MANUAL (pulverizador / borrifador)
 * Função pura sem dependência de React
 */
export function calculateManualDilution(
  volumeMlStr: string,
  ratioXStr: string,
  convention: DiluicaoConvention
): ManualCalculationResult {
  const volumeMl = parseNumber(volumeMlStr);
  const ratioX = parseNumber(ratioXStr);

  if (volumeMl <= 0 || ratioX <= 0) {
    return {
      isValid: false,
      produtoMl: 0,
      aguaMl: 0,
      produtoFormatted: '0,0',
      aguaFormatted: '0,0',
      formattedOutput: '',
      conventionText: '',
    };
  }

  let produtoMl = 0;
  let aguaMl = 0;

  if (convention === 'agua') {
    // 1 parte de produto para X partes de água (total X + 1 partes)
    produtoMl = volumeMl / (ratioX + 1);
    aguaMl = volumeMl - produtoMl;
  } else {
    // 1 parte de produto em X partes de solução final (total X partes)
    produtoMl = volumeMl / ratioX;
    aguaMl = volumeMl - produtoMl;
  }

  const produtoFormatted = formatNumber(produtoMl, 1);
  const aguaFormatted = formatNumber(aguaMl, 1);
  const ratioFormatted = formatNumber(ratioX, 1).replace(',0', '');
  const conventionLabel = convention === 'agua' ? 'partes de água' : 'partes totais';
  const conventionText = `${ratioFormatted} ${conventionLabel}`;

  const formattedOutput = `Diluição por ${conventionLabel} (${conventionText}): 1:${ratioFormatted} = ${produtoFormatted} mL + ${aguaFormatted} mL`;

  return {
    isValid: true,
    produtoMl,
    aguaMl,
    produtoFormatted,
    aguaFormatted,
    formattedOutput,
    conventionText,
  };
}

/**
 * MODO 2: SNOW FOAM DE LAVADORA (canhão / lança de espuma)
 * Função pura sem dependência de React
 * 
 * NOTA DE ARQUITETURA:
 * A constante S = 700 mL/min é uma estimativa média para sucção de lança de detailing
 * com registro completamente fechado. A calibração (balde + pote) substitui essa estimativa.
 */
export function calculateMaquinaDilution(
  vazaoStr: string,
  vazaoUnit: 'L/h' | 'L/min',
  psiStr: string,
  posicaoRegistro: PosicaoRegistro,
  isCalibrated: boolean,
  saiuBaldeStr: string,
  sumiuPoteStr: string,
  volumePoteStr: string,
  targetRatioXStr: string,
  convention: DiluicaoConvention
): MaquinaCalculationResult {
  const vazao = parseNumber(vazaoStr);
  const volumePote = parseNumber(volumePoteStr);
  const targetRatioX = parseNumber(targetRatioXStr);
  const psi = parseNumber(psiStr);

  const emptyResult: MaquinaCalculationResult = {
    status: 'empty',
    produtoMl: 0,
    aguaMl: 0,
    produtoFormatted: '0,0',
    aguaFormatted: '0,0',
    potRatioFormatted: '1:0',
    targetRatioFormatted: '1:0',
    suctionPercentage: 0,
    isCalibrated: false,
    hasHighConcWarning: false,
    footerSegments: [],
  };

  if (vazao <= 0 || volumePote <= 0 || targetRatioX <= 0) {
    return emptyResult;
  }

  // 1. Guarda: Registro parcialmente aberto SEM calibração -> não calcula
  if (posicaoRegistro === 'parcialmente_aberto' && !isCalibrated) {
    return {
      ...emptyResult,
      status: 'uncalibrated_open',
      warningMessage:
        'Só é possível calcular com precisão nessa posição se você calibrar. Sem calibração, use o registro fechado.',
    };
  }

  let f = 0; // Fração de sucção

  if (isCalibrated) {
    const saiuBalde = parseNumber(saiuBaldeStr);
    const sumiuPote = parseNumber(sumiuPoteStr);

    if (saiuBalde <= 0 || sumiuPote <= 0) {
      return emptyResult;
    }

    f = sumiuPote / saiuBalde;

    // 2. Guarda: Validação da Calibração (f >= 0.5 é fisicamente improvável e indica erro de digitação/campos trocados)
    if (f >= 0.5) {
      return {
        ...emptyResult,
        status: 'calibracao_invalida',
        warningMessage:
          'Valores de calibração improváveis. Confira se não trocou os campos: o volume que saiu no balde deve ser bem maior que o que sumiu do pote.',
      };
    }
  } else {
    // Estimativa para registro fechado: Constante S = 700 mL/min
    const S = 700;
    const vazaoMlMin = convertFlowRateToMlMin(vazao, vazaoUnit);
    f = S / (S + vazaoMlMin);
  }

  if (f <= 0) {
    return emptyResult;
  }

  // Concentração Alvo que deve chegar na pintura
  const C_target = convention === 'agua' ? 1 / (targetRatioX + 1) : 1 / targetRatioX;

  // Concentração necessária dentro do pote para que, após a injeção da máquina, chegue C_target na pintura
  const C_pot = C_target / f;

  const produtoMl = volumePote * C_pot;
  const aguaMl = volumePote - produtoMl;

  // 3. Guarda de Segurança com Margem: Se produto >= 98% do pote, diluição é inatingível
  if (produtoMl >= volumePote * 0.98) {
    return {
      ...emptyResult,
      status: 'unattainable',
      warningMessage:
        'Não dá para atingir essa diluição com essa lança. A sucção não é suficiente. Feche mais o registro, calibre a lança, ou escolha uma diluição mais fraca.',
    };
  }

  // Alerta de Alta Concentração (> 50% do pote)
  const hasHighConcWarning = produtoMl > volumePote * 0.5;
  const warningMessage = hasHighConcWarning
    ? 'Concentração muito alta. Confira se a diluição informada é a que chega na pintura, e não a do pote.'
    : undefined;

  // Concentração no pote (razão 1:Y)
  const potRatioXRaw = convention === 'agua' ? 1 / C_pot - 1 : 1 / C_pot;
  const potRatioX = Math.floor(potRatioXRaw * 10) / 10;
  const potRatioFormatted = `1:${formatNumber(potRatioX, 1)}`;
  const targetRatioFormatted = `1:${formatNumber(targetRatioX, 1).replace(',0', '')}`;

  const suctionPercentage = f * 100;

  // Construção do Rodapé Dinâmico por Segmentos
  const footerSegments: string[] = [];
  
  // 1. Posição do registro
  footerSegments.push(
    posicaoRegistro === 'fechado' ? 'Registro fechado' : 'Registro parcialmente aberto'
  );

  // 2. Vazão formatada
  footerSegments.push(`${formatNumber(vazao, 1).replace(',0', '')} ${vazaoUnit}`);

  // 3. PSI (apenas se informado)
  if (psi > 0) {
    footerSegments.push(`${Math.round(psi)} PSI`);
  }

  // 4. Status de sucção (calibrado ou estimado)
  if (isCalibrated) {
    footerSegments.push(`calibrado (sucção ${formatNumber(suctionPercentage, 1)}%)`);
  } else {
    footerSegments.push(
      `sucção estimada em ${formatNumber(suctionPercentage, 1)}% — calibre para maior precisão`
    );
  }

  return {
    status: 'valid',
    produtoMl,
    aguaMl,
    produtoFormatted: formatNumber(produtoMl, 1),
    aguaFormatted: formatNumber(aguaMl, 1),
    potRatioFormatted,
    targetRatioFormatted,
    suctionPercentage,
    isCalibrated,
    hasHighConcWarning,
    warningMessage,
    footerSegments,
  };
}
