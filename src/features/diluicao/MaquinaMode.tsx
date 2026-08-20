import React, { useState } from 'react';
import type {
  DiluicaoConvention,
  DiluicaoVariant,
  EquipamentoPerfilData,
  PosicaoRegistro,
} from './types';
import { calculateMaquinaDilution, convertFlowRateToMlMin, formatNumber, parseNumber } from './calc';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { EquipamentoPerfil } from './EquipamentoPerfil';
import { AlertTriangle, ChevronDown, HelpCircle, Info, Sparkles } from 'lucide-react';

interface MaquinaModeProps {
  variant: DiluicaoVariant;
  perfis: EquipamentoPerfilData[];
  onSavePerfil: (perfil: Omit<EquipamentoPerfilData, 'id' | 'createdAt'>) => void;
  onDeletePerfil: (id: string) => void;
}

export const MaquinaMode: React.FC<MaquinaModeProps> = ({
  variant,
  perfis,
  onSavePerfil,
  onDeletePerfil,
}) => {
  // Estado dos Inputs (Valores iniciais úteis: 420 L/h, registro fechado, pote 1 L, alvo 1:100)
  const [selectedPerfilId, setSelectedPerfilId] = useState<string | null>(null);

  const [vazaoStr, setVazaoStr] = useState<string>('420');
  const [vazaoUnit, setVazaoUnit] = useState<'L/h' | 'L/min'>('L/h');
  const [psiStr, setPsiStr] = useState<string>('');
  const [posicaoRegistro, setPosicaoRegistro] = useState<PosicaoRegistro>('fechado');

  const [isCalibrated, setIsCalibrated] = useState<boolean>(false);
  const [saiuBaldeStr, setSaiuBaldeStr] = useState<string>('');
  const [sumiuPoteStr, setSumiuPoteStr] = useState<string>('');

  const [volumePoteStr, setVolumePoteStr] = useState<string>('1000');
  const [targetRatioXStr, setTargetRatioXStr] = useState<string>('100');
  const [convention, setConvention] = useState<DiluicaoConvention>('agua');

  // Seleção de perfil gravado
  const handleSelectPerfil = (perfil: EquipamentoPerfilData | null) => {
    if (!perfil) {
      setSelectedPerfilId(null);
      return;
    }
    setSelectedPerfilId(perfil.id);
    setVazaoStr(perfil.vazao);
    setVazaoUnit(perfil.unidadeVazao);
    setPsiStr(perfil.psi);
    setPosicaoRegistro(perfil.posicaoRegistro);
    setIsCalibrated(perfil.isCalibrated);
    setSaiuBaldeStr(perfil.saiuBalde);
    setSumiuPoteStr(perfil.sumiuPote);
  };

  const handleSavePerfil = (nome: string) => {
    onSavePerfil({
      nome,
      vazao: vazaoStr,
      unidadeVazao: vazaoUnit,
      psi: psiStr,
      posicaoRegistro,
      isCalibrated,
      saiuBalde: saiuBaldeStr,
      sumiuPote: sumiuPoteStr,
    });
  };

  const handleQuickVolumePote = (ml: number) => {
    setVolumePoteStr(ml.toString());
  };

  // Executa o cálculo puro
  const result = calculateMaquinaDilution(
    vazaoStr,
    vazaoUnit,
    psiStr,
    posicaoRegistro,
    isCalibrated,
    saiuBaldeStr,
    sumiuPoteStr,
    volumePoteStr,
    targetRatioXStr,
    convention
  );

  // Cálculo alternativo para o aviso acionável se status === 'unattainable'
  let alternativePotDirect: { produtoFormatted: string; paintRatioFormatted: string } | null = null;

  if (result.status === 'unattainable') {
    const vazao = parseNumber(vazaoStr);
    const volumePote = parseNumber(volumePoteStr);
    const targetRatioX = parseNumber(targetRatioXStr);

    if (vazao > 0 && volumePote > 0 && targetRatioX > 0) {
      let f = 0;
      if (isCalibrated) {
        const saiuBalde = parseNumber(saiuBaldeStr);
        const sumiuPote = parseNumber(sumiuPoteStr);
        if (saiuBalde > 0 && sumiuPote > 0) {
          f = sumiuPote / saiuBalde;
        }
      } else if (posicaoRegistro === 'fechado') {
        const S = 700;
        const vazaoMlMin = convertFlowRateToMlMin(vazao, vazaoUnit);
        f = S / (S + vazaoMlMin);
      }

      if (f > 0 && f < 0.5) {
        const C_target = convention === 'agua' ? 1 / (targetRatioX + 1) : 1 / targetRatioX;
        const produtoPotDirect = volumePote * C_target;
        const C_paint = C_target * f;
        const paintRatioYRaw = convention === 'agua' ? 1 / C_paint - 1 : 1 / C_paint;
        const paintRatioY = Math.floor(paintRatioYRaw * 10) / 10;

        alternativePotDirect = {
          produtoFormatted: formatNumber(produtoPotDirect, 1),
          paintRatioFormatted: formatNumber(paintRatioY, 1).replace(',0', ''),
        };
      }
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Explicação Conceitual Recolhível */}
      <details className="group bg-graphite-800 border border-graphite-600 rounded-md p-4 [&_summary::-webkit-details-marker]:hidden cursor-pointer">
        <summary className="flex items-center justify-between gap-2 font-sans text-[14px] text-amber-500 font-medium select-none">
          <div className="flex items-center gap-2">
            <HelpCircle size={18} />
            <span>Por que a diluição da lavadora é diferente?</span>
          </div>
          <ChevronDown size={18} className="transition-transform group-open:rotate-180 text-vapor-400" />
        </summary>
        <p className="mt-3 font-sans text-[13px] text-vapor-100 leading-relaxed pl-6 border-l-2 border-amber-500/40">
          A concentração que chega na pintura não é a do pote. A lança suga a solução do pote e mistura com a água da máquina, diluindo de novo. Esta calculadora corrige as duas etapas.
        </p>
      </details>

      {/* Perfis de Equipamento (somente no modo interno) */}
      {variant === 'interno' && (
        <EquipamentoPerfil
          perfis={perfis}
          selectedPerfilId={selectedPerfilId}
          onSelectPerfil={handleSelectPerfil}
          onSavePerfil={handleSavePerfil}
          onDeletePerfil={onDeletePerfil}
          canSave={result.status === 'valid'}
        />
      )}

      {/* Form de Parâmetros */}
      <Card className="p-5 sm:p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-6">
        <h3 className="font-display text-[16px] text-vapor-100 uppercase tracking-wide">
          Snow Foam de Lavadora (Canhão / Lança de Espuma)
        </h3>

        {/* Bloco A — Máquina */}
        <div className="flex flex-col gap-3 pb-4 border-b border-graphite-600">
          <span className="font-sans text-[13px] text-amber-500 font-semibold tracking-wider uppercase">
            Bloco A — Sua Lavadora
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="font-sans text-[13px] text-vapor-400 font-medium">
                Vazão da lavadora *
              </label>
              <div className="flex gap-2">
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="ex: 7 ou 420"
                  value={vazaoStr}
                  onChange={(e) => {
                    setVazaoStr(e.target.value);
                    setSelectedPerfilId(null);
                  }}
                  className="font-mono min-h-[48px] flex-1"
                />
                <select
                  value={vazaoUnit}
                  onChange={(e) => {
                    setVazaoUnit(e.target.value as 'L/h' | 'L/min');
                    setSelectedPerfilId(null);
                  }}
                  className="min-h-[48px] px-3 bg-graphite-700 border border-graphite-600 rounded text-vapor-100 font-mono text-[14px] focus:outline-none focus:border-amber-500"
                >
                  <option value="L/min">L/min</option>
                  <option value="L/h">L/h</option>
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="font-sans text-[13px] text-vapor-400 font-medium">
                Pressão PSI (opcional)
              </label>
              <Input
                type="text"
                inputMode="decimal"
                placeholder="ex: 1200"
                value={psiStr}
                onChange={(e) => {
                  setPsiStr(e.target.value);
                  setSelectedPerfilId(null);
                }}
                className="font-mono min-h-[48px]"
              />
            </div>
          </div>
        </div>

        {/* Bloco B — Lança */}
        <div className="flex flex-col gap-3 pb-4 border-b border-graphite-600">
          <span className="font-sans text-[13px] text-amber-500 font-semibold tracking-wider uppercase">
            Bloco B — Posição do Registro da Lança
          </span>
          <div className="flex flex-col gap-2">
            <select
              value={posicaoRegistro}
              onChange={(e) => {
                setPosicaoRegistro(e.target.value as PosicaoRegistro);
                setSelectedPerfilId(null);
              }}
              className="w-full min-h-[48px] px-3 bg-graphite-700 border border-graphite-600 rounded text-vapor-100 font-sans text-[14px] focus:outline-none focus:border-amber-500"
            >
              <option value="fechado">Fechado — sucção máxima (Padrão)</option>
              <option value="parcialmente_aberto">Parcialmente aberto — mais água, menos produto</option>
            </select>

            {posicaoRegistro === 'parcialmente_aberto' && !isCalibrated && (
              <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded text-amber-500 text-[13px]">
                <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                <span>
                  Só é possível calcular com precisão nessa posição se você calibrar. Sem calibração, use o registro fechado.
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Bloco C — Calibração (Opcional / Colapsado) */}
        <details
          open={isCalibrated}
          className="group bg-graphite-700/40 border border-graphite-600 rounded-md p-4 [&_summary::-webkit-details-marker]:hidden"
        >
          <summary
            onClick={(e) => {
              // Alterna o estado de ativação da calibração
              e.preventDefault();
              setIsCalibrated(!isCalibrated);
              setSelectedPerfilId(null);
            }}
            className="flex items-center justify-between gap-2 font-sans text-[14px] text-vapor-100 font-medium cursor-pointer select-none"
          >
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span>Calibrar minha lança — 2 minutos, resultado preciso</span>
            </div>
            <span className="font-mono text-[12px] text-amber-500 font-medium">
              {isCalibrated ? '[ Ativa ]' : '[ Opcional ]'}
            </span>
          </summary>

          <div className="mt-4 flex flex-col gap-4 pt-3 border-t border-graphite-600">
            <ol className="list-decimal list-inside flex flex-col gap-1.5 text-[13px] text-vapor-400 font-sans leading-relaxed">
              <li>Encha o pote só com água e anote o volume</li>
              <li>Acione a lança dentro de um balde grande por cerca de 1 minuto, na pressão e no registro que você usa</li>
              <li>Meça quanto saiu no balde</li>
              <li>Meça quanto sumiu do pote</li>
            </ol>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
              <div className="flex flex-col gap-1">
                <label className="font-sans text-[13px] text-vapor-400 font-medium">
                  Saiu no balde (mL) *
                </label>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="ex: 5400"
                  value={saiuBaldeStr}
                  onChange={(e) => {
                    setSaiuBaldeStr(e.target.value);
                    setSelectedPerfilId(null);
                  }}
                  className="font-mono min-h-[48px]"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-sans text-[13px] text-vapor-400 font-medium">
                  Sumiu do pote (mL) *
                </label>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="ex: 480"
                  value={sumiuPoteStr}
                  onChange={(e) => {
                    setSumiuPoteStr(e.target.value);
                    setSelectedPerfilId(null);
                  }}
                  className="font-mono min-h-[48px]"
                />
              </div>
            </div>
          </div>
        </details>

        {/* Bloco D — O que você quer */}
        <div className="flex flex-col gap-4">
          <span className="font-sans text-[13px] text-amber-500 font-semibold tracking-wider uppercase">
            Bloco D — O que você quer
          </span>

          {/* Volume do Pote */}
          <div className="flex flex-col gap-2">
            <label className="font-sans text-[13px] text-vapor-400 font-medium">
              Volume do pote da lança
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleQuickVolumePote(500)}
                className={`min-h-[48px] px-4 rounded text-[14px] font-mono transition-colors border ${
                  volumePoteStr === '500'
                    ? 'bg-amber-500/10 border-amber-500 text-amber-500 font-semibold'
                    : 'bg-graphite-700 border-graphite-600 text-vapor-100 hover:border-vapor-400'
                }`}
              >
                500 mL
              </button>
              <button
                type="button"
                onClick={() => handleQuickVolumePote(1000)}
                className={`min-h-[48px] px-4 rounded text-[14px] font-mono transition-colors border ${
                  volumePoteStr === '1000'
                    ? 'bg-amber-500/10 border-amber-500 text-amber-500 font-semibold'
                    : 'bg-graphite-700 border-graphite-600 text-vapor-100 hover:border-vapor-400'
                }`}
              >
                1 L
              </button>
              <button
                type="button"
                onClick={() => handleQuickVolumePote(2000)}
                className={`min-h-[48px] px-4 rounded text-[14px] font-mono transition-colors border ${
                  volumePoteStr === '2000'
                    ? 'bg-amber-500/10 border-amber-500 text-amber-500 font-semibold'
                    : 'bg-graphite-700 border-graphite-600 text-vapor-100 hover:border-vapor-400'
                }`}
              >
                2 L
              </button>

              <div className="flex-1 min-w-[140px]">
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="Volume em mL"
                  value={volumePoteStr}
                  onChange={(e) => setVolumePoteStr(e.target.value)}
                  className="font-mono min-h-[48px]"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Diluição Desejada na Pintura */}
            <div className="flex flex-col gap-1">
              <label className="font-sans text-[13px] text-vapor-400 font-medium">
                Diluição desejada na pintura (1 : X)
              </label>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[16px] text-vapor-400 font-bold">1 :</span>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="ex: 10 ou 100"
                  value={targetRatioXStr}
                  onChange={(e) => setTargetRatioXStr(e.target.value)}
                  className="font-mono min-h-[48px] flex-1"
                />
              </div>
              <p className="font-sans text-[12px] text-vapor-400 mt-1">
                Não é o número do rótulo. Pré-lavagem costuma ficar entre 1:80 e 1:150 na pintura.
              </p>
            </div>

            {/* Convenção */}
            <div className="flex flex-col gap-1">
              <label className="font-sans text-[13px] text-vapor-400 font-medium">
                Convenção
              </label>
              <select
                value={convention}
                onChange={(e) => setConvention(e.target.value as DiluicaoConvention)}
                className="w-full min-h-[48px] px-3 bg-graphite-700 border border-graphite-600 rounded text-vapor-100 font-sans text-[14px] focus:outline-none focus:border-amber-500"
              >
                <option value="agua">Partes de água (1 produto : X água)</option>
                <option value="totais">Partes totais (1 produto em X final)</option>
              </select>
            </div>
          </div>
        </div>
      </Card>

      {/* BLOCO DE RESULTADO */}
      <Card className="p-5 sm:p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-3">
        <h4 className="font-sans text-[12px] text-vapor-400 uppercase tracking-widest font-semibold">
          Dosagem Corrigida para o Pote
        </h4>

        {/* Status: Vazio / Incompleto */}
        {result.status === 'empty' && (
          <div className="py-4 text-center border border-dashed border-graphite-600 rounded">
            <p className="font-sans text-[14px] text-vapor-400">
              Preencha a vazão da máquina, volume do pote e a diluição desejada.
            </p>
          </div>
        )}

        {/* Status: Registro Aberto Sem Calibração */}
        {result.status === 'uncalibrated_open' && (
          <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded flex items-start gap-3 text-amber-500">
            <AlertTriangle size={20} className="shrink-0 mt-0.5" />
            <span className="font-sans text-[14px] leading-relaxed">
              {result.warningMessage}
            </span>
          </div>
        )}

        {/* Status: Calibração Inválida (f >= 0.5) */}
        {result.status === 'calibracao_invalida' && (
          <div className="p-4 bg-flare-400/10 border border-flare-400/30 rounded flex items-start gap-3 text-flare-400">
            <AlertTriangle size={20} className="shrink-0 mt-0.5" />
            <span className="font-sans text-[14px] leading-relaxed">
              {result.warningMessage}
            </span>
          </div>
        )}

        {/* Status: Guarda Inatingível (produto >= 98% do pote) */}
        {result.status === 'unattainable' && (
          <div className="p-5 bg-flare-400/10 border border-flare-400/30 rounded-md flex flex-col gap-3 text-flare-400">
            <div className="flex items-start gap-3">
              <AlertTriangle size={20} className="shrink-0 mt-0.5 font-bold" />
              <span className="font-sans text-[14px] leading-relaxed font-medium">
                {result.warningMessage}
              </span>
            </div>

            {alternativePotDirect && (
              <div className="flex flex-col gap-3 pt-3 border-t border-flare-400/20 text-vapor-100 font-sans text-[13px]">
                <p className="leading-relaxed">
                  Se <span className="font-mono text-amber-500 font-bold">1:{targetRatioXStr}</span> é a diluição do rótulo do produto, ela provavelmente se refere ao <strong className="text-amber-500">POTE</strong>, não à pintura. Nesse caso: coloque <span className="font-mono text-amber-500 font-bold">{alternativePotDirect.produtoFormatted} mL</span> no pote, e chegará <span className="font-mono text-amber-500 font-bold">1:{alternativePotDirect.paintRatioFormatted}</span> na pintura.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setTargetRatioXStr(alternativePotDirect!.paintRatioFormatted)}
                  className="w-full sm:w-auto self-start text-[13px] min-h-[40px] py-2 px-4 border-amber-500/40 text-amber-500 hover:bg-amber-500/10"
                >
                  Calcular como diluição do pote (1:{alternativePotDirect.paintRatioFormatted} na pintura)
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Status: Válido */}
        {result.status === 'valid' && (
          <div className="flex flex-col gap-4">
            {/* Alerta de Alta Concentração (> 50% do pote) */}
            {result.hasHighConcWarning && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded flex items-start gap-2.5 text-amber-500 text-[13px]">
                <Info size={18} className="shrink-0 mt-0.5" />
                <span>{result.warningMessage}</span>
              </div>
            )}

            {/* 1. Card com Resultado Principal */}
            <div className="p-4 bg-graphite-700/60 border border-graphite-600 rounded-md">
              <p className="font-sans text-[15px] sm:text-[18px] text-vapor-100 font-semibold leading-relaxed">
                Coloque{' '}
                <span className="font-mono text-[20px] sm:text-[22px] text-amber-500 font-bold">
                  {result.produtoFormatted} mL
                </span>{' '}
                de produto e complete com{' '}
                <span className="font-mono text-[20px] sm:text-[22px] text-vapor-100 font-bold">
                  {result.aguaFormatted} mL
                </span>{' '}
                de água
              </p>
            </div>

            {/* 2. Linha Secundária em vapor-400 */}
            <p className="font-sans text-[13px] sm:text-[14px] text-vapor-400">
              Concentração no pote:{' '}
              <span className="font-mono text-vapor-100 font-medium">
                {result.potRatioFormatted}
              </span>{' '}
              · Chega na pintura:{' '}
              <span className="font-mono text-vapor-100 font-medium">
                {result.targetRatioFormatted}
              </span>
            </p>

            {/* 3. Rodapé Dinâmico de Verdade (segmentos unidos por " · ") */}
            <div className="pt-3 border-t border-graphite-600">
              <p className="font-mono text-[11px] text-vapor-600 uppercase tracking-wider">
                {result.footerSegments.join(' · ')}
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* CTA de Cadastro no Rodapé (apenas no modo público, exibido APÓS o resultado) */}
      {variant === 'publico' && (
        <Card className="p-6 bg-gradient-to-r from-graphite-800 to-graphite-700 border-amber-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-lg">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-amber-500 font-sans font-medium text-[15px]">
              <Sparkles size={18} />
              <span>Salve a calibração da sua lança</span>
            </div>
            <p className="font-sans text-[13px] text-vapor-400">
              Crie uma conta gratuita para guardar seus perfis de equipamento e nunca mais precisar medir de novo.
            </p>
          </div>
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              // Redireciona ou abre convite
              window.location.href = '#';
            }}
            className="w-full sm:w-auto shrink-0 min-h-[48px] px-6 font-semibold"
          >
            Criar conta grátis
          </Button>
        </Card>
      )}
    </div>
  );
};
