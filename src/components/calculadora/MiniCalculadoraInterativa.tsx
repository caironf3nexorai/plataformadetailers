import React, { useId, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Droplets,
  Flame,
  Info,
  PackageCheck,
  Sparkles,
} from 'lucide-react';
import { formatarMoeda } from '../../utils/formatters';
import { calcularSimulacaoCustos } from '../../utils/calculadoraSimulacao';

interface ProdutoItem {
  nome: string;
  dose: string;
  custoUnitario: number;
}

interface PresetServico {
  id: string;
  nome: string;
  tipoCurto: string;
  tempoPadrao: number;
  custoQuimicoPadrao: number;
  precoSugeridoMercado: number;
  descricao: string;
  produtos: ProdutoItem[];
}

const PRESETS_SERVICOS: PresetServico[] = [
  {
    id: 'lavagem_detalhada',
    nome: 'Lavagem Técnica / Detalhada',
    tipoCurto: 'Lavagem Detalhada',
    tempoPadrao: 90,
    custoQuimicoPadrao: 14.80,
    precoSugeridoMercado: 120,
    descricao: 'Snow Foam concentrada, desengraxante de caixas de roda, pretinho de pneu e selante SiO2.',
    produtos: [
      { nome: 'Snow Foam Concentrada (diluição 1:10 canhão)', dose: '50 mL', custoUnitario: 1.50 },
      { nome: 'Desengraxante APC pátio e caixas de roda', dose: '100 mL', custoUnitario: 2.80 },
      { nome: 'Pretinho de pneu alta fixação', dose: '30 mL', custoUnitario: 2.50 },
      { nome: 'Cera líquida / Selante SiO2 spray de acabamento', dose: '40 mL', custoUnitario: 8.00 },
    ],
  },
  {
    id: 'lavagem_rapida',
    nome: 'Lavagem Comercial / Rápida',
    tipoCurto: 'Lavagem Rápida',
    tempoPadrao: 45,
    custoQuimicoPadrao: 5.80,
    precoSugeridoMercado: 60,
    descricao: 'Shampoo neutro, pretinho tradicional e limpeza rápida de painéis.',
    produtos: [
      { nome: 'Shampoo Neutro automotivo', dose: '40 mL', custoUnitario: 1.20 },
      { nome: 'Pretinho tradicional de pneu', dose: '25 mL', custoUnitario: 1.60 },
      { nome: 'Limpador APC rápido interior', dose: '50 mL', custoUnitario: 3.00 },
    ],
  },
  {
    id: 'polimento',
    nome: 'Polimento Técnico / Comercial',
    tipoCurto: 'Polimento',
    tempoPadrao: 240,
    custoQuimicoPadrao: 44.00,
    precoSugeridoMercado: 380,
    descricao: 'Compostos de corte/refino/lustro, desgaste fracionado de boinas, IPA e selante sintético.',
    produtos: [
      { nome: 'Compostos Polidores (Corte + Refino + Lustro)', dose: '60 g', custoUnitario: 18.00 },
      { nome: 'Amortização / desgaste de boinas e interfaces', dose: '1 uso', custoUnitario: 10.00 },
      { nome: 'Revelador de hologramas (Álcool Isopropílico IPA)', dose: '120 mL', custoUnitario: 4.00 },
      { nome: 'Selante sintético de pintura (proteção 6 meses)', dose: '30 mL', custoUnitario: 12.00 },
    ],
  },
  {
    id: 'farol',
    nome: 'Restauração de Faróis (Par)',
    tipoCurto: 'Restauração Farol',
    tempoPadrao: 60,
    custoQuimicoPadrao: 21.50,
    precoSugeridoMercado: 130,
    descricao: 'Lixamento d’água progressivo em 4 etapas e polimerização / verniz UV.',
    produtos: [
      { nome: 'Lixas d’água especiais (grãos 800 a 3000)', dose: '4 folhas', custoUnitario: 6.50 },
      { nome: 'Composto polidor de policarbonato', dose: '20 g', custoUnitario: 5.00 },
      { nome: 'Polímero vaporizado ou Verniz UV catalisado', dose: '1 aplicação', custoUnitario: 10.00 },
    ],
  },
  {
    id: 'higienizacao',
    nome: 'Higienização Interna Completa',
    tipoCurto: 'Higienização',
    tempoPadrao: 180,
    custoQuimicoPadrao: 28.00,
    precoSugeridoMercado: 280,
    descricao: 'Flotador de estofados na extratora, bactericida e hidratação de plásticos/couro.',
    produtos: [
      { nome: 'Flotador / Detergente para extratora', dose: '200 mL', custoUnitario: 9.00 },
      { nome: 'Bactericida / Sanitizante de interiores', dose: '50 mL', custoUnitario: 5.00 },
      { nome: 'Condicionador de couro e plásticos UV', dose: '80 mL', custoUnitario: 14.00 },
    ],
  },
];

interface MiniCalculadoraInterativaProps {
  className?: string;
  onSimulacaoChange?: (resultado: ReturnType<typeof calcularSimulacaoCustos>) => void;
}

export const MiniCalculadoraInterativa: React.FC<MiniCalculadoraInterativaProps> = ({
  className = '',
  onSimulacaoChange,
}) => {
  const idPrefix = useId();

  // Estados dos custos fixos
  const [despesaFixa, setDespesaFixa] = useState<number>(4200);
  const [salarioEquipe, setSalarioEquipe] = useState<number>(5300);

  // Assistente de Jornada / Horas de Trabalho
  const [modoHoras, setModoHoras] = useState<'rotina' | 'manual'>('rotina');
  const [diasPorMes, setDiasPorMes] = useState<number>(22); // 22 = Seg a Sex, 26 = Seg a Sáb, 30 = Todos os dias
  const [horasPorDia, setHorasPorDia] = useState<number>(8);
  const [equipeQtd, setEquipeQtd] = useState<number>(1);
  const [horasProdutivasManual, setHorasProdutivasManual] = useState<number>(176);

  // Calcula horas produtivas do mês
  const horasProdutivasCalculadas = modoHoras === 'rotina'
    ? diasPorMes * horasPorDia * equipeQtd
    : horasProdutivasManual;

  // Estados do serviço simulado
  const [presetAtivoId, setPresetAtivoId] = useState<string>('lavagem_detalhada');
  const [tempoServico, setTempoServico] = useState<number>(90);
  const [custoQuimico, setCustoQuimico] = useState<number>(14.80);
  const [precoCobrado, setPrecoCobrado] = useState<number>(100);
  const [detalhesQuimicosAbertos, setDetalhesQuimicosAbertos] = useState<boolean>(false);
  const [modoQuimicoCustomizado, setModoQuimicoCustomizado] = useState<boolean>(false);

  // Preset ativo atual
  const presetAtual = PRESETS_SERVICOS.find((p) => p.id === presetAtivoId);

  // Atualiza quando o usuário clica num Preset de serviço
  const handleSelecionarPreset = (preset: PresetServico) => {
    setPresetAtivoId(preset.id);
    setTempoServico(preset.tempoPadrao);
    setCustoQuimico(preset.custoQuimicoPadrao);
    setPrecoCobrado(preset.precoSugeridoMercado);
    setModoQuimicoCustomizado(false);
  };

  // Cálculo em tempo real
  const resultado = calcularSimulacaoCustos({
    despesaFixaMensal: despesaFixa,
    salarioEquipe,
    horasProdutivasMes: horasProdutivasCalculadas,
    tempoGastoMinutos: tempoServico,
    custoQuimico,
    precoCobradoAtual: precoCobrado,
    margemAlvo: 0.40,
  });

  // Notifica componentes pais se necessário
  React.useEffect(() => {
    onSimulacaoChange?.(resultado);
  }, [resultado, onSimulacaoChange]);

  return (
    <div className={`w-full flex flex-col gap-5 ${className}`}>
      {/* =================================================================== */}
      {/* PARTE 1.1: BLOCO DE CUSTOS FIXOS DA OFICINA & ASSISTENTE DE HORAS   */}
      {/* =================================================================== */}
      <div className="bg-graphite-800 border border-graphite-600 rounded-[8px] p-4 sm:p-6 shadow-xl flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-graphite-600/70">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-[6px] bg-amber-500/15 border border-amber-500/30 text-amber-500 flex items-center justify-center shrink-0">
              <Calculator size={17} />
            </div>
            <div>
              <h3 className="font-display text-sm sm:text-base font-bold text-vapor-100 uppercase tracking-wide">
                1. Custos Fixos & Jornada da Sua Estética
              </h3>
              <p className="text-[12px] text-vapor-400">
                O sistema calcula o custo exato do seu minuto de pátio:
              </p>
            </div>
          </div>

          <span className="self-start sm:self-auto font-mono text-[11px] uppercase tracking-wider px-2.5 py-1 rounded bg-graphite-900 border border-graphite-600 text-glass-400">
            Passo 1 de 2
          </span>
        </div>

        {/* Inputs de Despesa Fixa e Salário */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {/* Campo 1: Despesa Fixa Mensal */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={`${idPrefix}-despesa`}
              className="font-display text-[11px] uppercase tracking-wider text-vapor-400 flex items-center justify-between"
            >
              <span>Despesa Fixa / Mês</span>
              <span className="text-[10px] text-vapor-400 font-sans normal-case">Aluguel, luz, água, sistemas</span>
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-3 font-mono text-xs text-vapor-400 select-none">
                R$
              </span>
              <input
                id={`${idPrefix}-despesa`}
                type="number"
                inputMode="decimal"
                min="0"
                step="50"
                value={despesaFixa === 0 ? '' : despesaFixa}
                onChange={(e) => setDespesaFixa(Number(e.target.value) || 0)}
                className="w-full min-h-[46px] pl-9 pr-3 rounded-[4px] bg-graphite-900 border border-graphite-600 font-mono text-sm sm:text-base text-vapor-100 focus:outline-none focus:border-amber-500 transition-colors"
                placeholder="4200"
              />
            </div>
          </div>

          {/* Campo 2: Salário + Equipe */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={`${idPrefix}-salario`}
              className="font-display text-[11px] uppercase tracking-wider text-vapor-400 flex items-center justify-between"
            >
              <span>Salário + Equipe</span>
              <span className="text-[10px] text-vapor-400 font-sans normal-case">Seu pró-labore + ajudantes</span>
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-3 font-mono text-xs text-vapor-400 select-none">
                R$
              </span>
              <input
                id={`${idPrefix}-salario`}
                type="number"
                inputMode="decimal"
                min="0"
                step="50"
                value={salarioEquipe === 0 ? '' : salarioEquipe}
                onChange={(e) => setSalarioEquipe(Number(e.target.value) || 0)}
                className="w-full min-h-[46px] pl-9 pr-3 rounded-[4px] bg-graphite-900 border border-graphite-600 font-mono text-sm sm:text-base text-vapor-100 focus:outline-none focus:border-amber-500 transition-colors"
                placeholder="5300"
              />
            </div>
          </div>
        </div>

        {/* =================================================================== */}
        {/* ASSISTENTE DE HORAS DE TRABALHO: CALCULE PELA SUA ROTINA            */}
        {/* =================================================================== */}
        <div className="bg-graphite-900 border border-graphite-700/80 rounded-[6px] p-3.5 sm:p-4 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Calendar size={15} className="text-amber-500 shrink-0" />
              <span className="font-display text-xs sm:text-sm font-bold text-vapor-100 uppercase tracking-wide">
                Quantas horas sua oficina trabalha no mês?
              </span>
            </div>

            <div className="inline-flex rounded p-0.5 bg-graphite-950 border border-graphite-700 text-[11px]">
              <button
                type="button"
                onClick={() => setModoHoras('rotina')}
                className={`px-2.5 py-1 rounded transition-colors font-medium ${
                  modoHoras === 'rotina'
                    ? 'bg-amber-500 text-graphite-950 font-bold'
                    : 'text-vapor-400 hover:text-vapor-100'
                }`}
              >
                Pela minha rotina (Fácil)
              </button>
              <button
                type="button"
                onClick={() => {
                  setModoHoras('manual');
                  setHorasProdutivasManual(horasProdutivasCalculadas);
                }}
                className={`px-2.5 py-1 rounded transition-colors font-medium ${
                  modoHoras === 'manual'
                    ? 'bg-amber-500 text-graphite-950 font-bold'
                    : 'text-vapor-400 hover:text-vapor-100'
                }`}
              >
                Digitar horas direto
              </button>
            </div>
          </div>

          {modoHoras === 'rotina' ? (
            <div className="flex flex-col gap-3 pt-1">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* 1. Dias de Atendimento */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-mono text-vapor-400 uppercase tracking-wider">
                    1. Dias de funcionamento:
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setDiasPorMes(22)}
                      className={`min-h-[40px] px-2 rounded border text-xs font-semibold flex flex-col items-center justify-center transition-all ${
                        diasPorMes === 22
                          ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                          : 'bg-graphite-800 border-graphite-700 text-vapor-400 hover:text-vapor-100'
                      }`}
                    >
                      <span>Seg a Sex</span>
                      <span className="text-[10px] font-mono opacity-80">(~22 dias)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDiasPorMes(26)}
                      className={`min-h-[40px] px-2 rounded border text-xs font-semibold flex flex-col items-center justify-center transition-all ${
                        diasPorMes === 26
                          ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                          : 'bg-graphite-800 border-graphite-700 text-vapor-400 hover:text-vapor-100'
                      }`}
                    >
                      <span>Seg a Sáb</span>
                      <span className="text-[10px] font-mono opacity-80">(~26 dias)</span>
                    </button>
                  </div>
                </div>

                {/* 2. Horas por Dia */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-mono text-vapor-400 uppercase tracking-wider">
                    2. Horas de pátio por dia:
                  </span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[8, 9, 10].map((h) => (
                      <button
                        key={h}
                        type="button"
                        onClick={() => setHorasPorDia(h)}
                        className={`min-h-[40px] px-1 rounded border text-xs font-mono font-bold flex items-center justify-center transition-all ${
                          horasPorDia === h
                            ? 'bg-glass-400/20 border-glass-400 text-glass-400'
                            : 'bg-graphite-800 border-graphite-700 text-vapor-400 hover:text-vapor-100'
                        }`}
                      >
                        {h}h/dia
                      </button>
                    ))}
                  </div>
                </div>

                {/* 3. Operadores no Pátio */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-mono text-vapor-400 uppercase tracking-wider">
                    3. Equipe no pátio:
                  </span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { qtd: 1, rotulo: '1 pessoa' },
                      { qtd: 2, rotulo: '2 pessoas' },
                      { qtd: 3, rotulo: '3+ pessoas' },
                    ].map((item) => (
                      <button
                        key={item.qtd}
                        type="button"
                        onClick={() => setEquipeQtd(item.qtd)}
                        className={`min-h-[40px] px-1 rounded border text-xs font-medium flex items-center justify-center text-center transition-all ${
                          equipeQtd === item.qtd
                            ? 'bg-mint-400/20 border-mint-400 text-mint-400 font-bold'
                            : 'bg-graphite-800 border-graphite-700 text-vapor-400 hover:text-vapor-100'
                        }`}
                      >
                        {item.rotulo}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Resumo da rotina calculada */}
              <div className="p-2.5 rounded bg-graphite-950 border border-graphite-700 text-xs flex flex-wrap items-center justify-between gap-2">
                <span className="text-vapor-400">
                  📅 Sua rotina calculada:{' '}
                  <strong className="text-vapor-100 font-mono">{diasPorMes} dias</strong> ×{' '}
                  <strong className="text-vapor-100 font-mono">{horasPorDia}h/dia</strong> ×{' '}
                  <strong className="text-vapor-100 font-mono">{equipeQtd} {equipeQtd === 1 ? 'operador' : 'operadores'}</strong> =
                </span>
                <span className="font-mono text-sm font-extrabold text-amber-400 bg-amber-500/10 px-2.5 py-0.5 rounded border border-amber-500/30">
                  {horasProdutivasCalculadas} Horas de Pátio / Mês
                </span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 pt-1">
              <label
                htmlFor={`${idPrefix}-horas-manual`}
                className="text-xs text-vapor-400"
              >
                Digite a quantidade exata de horas produtivas faturáveis da oficina no mês:
              </label>
              <div className="relative flex items-center max-w-xs">
                <span className="absolute left-3 text-vapor-400 select-none">
                  <Clock size={15} />
                </span>
                <input
                  id={`${idPrefix}-horas-manual`}
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  value={horasProdutivasManual === 0 ? '' : horasProdutivasManual}
                  onChange={(e) => setHorasProdutivasManual(Number(e.target.value) || 1)}
                  className="w-full min-h-[44px] pl-9 pr-12 rounded-[4px] bg-graphite-950 border border-graphite-600 font-mono text-sm text-vapor-100 focus:outline-none focus:border-amber-500"
                  placeholder="144"
                />
                <span className="absolute right-3 font-mono text-xs text-vapor-400">horas</span>
              </div>
            </div>
          )}

          {/* Micro-aviso pedagógico do sistema NuvemWash */}
          <div className="text-[11px] text-vapor-400 flex items-start gap-1.5 pt-0.5">
            <Info size={13} className="text-glass-400 shrink-0 mt-0.5" />
            <span>
              <strong className="text-vapor-200">Como funciona no NuvemWash:</strong> Você não precisa somar isso. O sistema puxa os horários de abertura e fechamento que você define na sua Agenda e calcula suas horas úteis automaticamente a cada mês!
            </span>
          </div>
        </div>

        {/* Card Destacado: Resultado da Hora e Minuto */}
        <div className="bg-graphite-900 border border-glass-400/40 rounded-[6px] p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-inner">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-[6px] bg-glass-400/15 border border-glass-400/30 text-glass-400 flex items-center justify-center shrink-0">
              <Clock size={20} />
            </div>
            <div className="flex flex-col">
              <span className="font-mono text-[11px] uppercase tracking-wider text-glass-400 font-semibold">
                Custo de Pátio Calculado em Tempo Real
              </span>
              <span className="text-xs text-vapor-400">
                Total fixo: <strong className="text-vapor-100 font-mono">{formatarMoeda(resultado.custoFixoTotal)}</strong> dividido por <strong className="text-vapor-100 font-mono">{horasProdutivasCalculadas}h</strong> de trabalho no mês.
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4 sm:gap-6 self-end sm:self-auto shrink-0 bg-graphite-950/80 px-3.5 py-2 rounded border border-graphite-700">
            <div className="flex flex-col text-right">
              <span className="font-mono text-[10px] uppercase text-vapor-400">Custo por Hora</span>
              <span className="font-mono text-base sm:text-lg font-bold text-vapor-100">
                {formatarMoeda(resultado.custoHora)}
              </span>
            </div>
            <div className="w-[1px] h-8 bg-graphite-700" />
            <div className="flex flex-col text-right">
              <span className="font-mono text-[10px] uppercase text-amber-500 font-semibold">Custo por Minuto</span>
              <span className="font-mono text-base sm:text-lg font-extrabold text-amber-400">
                {formatarMoeda(resultado.custoMinuto)}
                <span className="text-xs font-normal text-vapor-400">/min</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* =================================================================== */}
      {/* PARTE 1.2: BLOCO DE SIMULAÇÃO DE SERVIÇO & CUSTO REAL DO PRODUTO    */}
      {/* =================================================================== */}
      <div className="bg-graphite-800 border-2 border-graphite-600 rounded-[8px] p-4 sm:p-6 shadow-xl flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-graphite-600/70">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-[6px] bg-glass-400/15 border border-glass-400/30 text-glass-400 flex items-center justify-center shrink-0">
              <Droplets size={17} />
            </div>
            <div>
              <h3 className="font-display text-sm sm:text-base font-bold text-vapor-100 uppercase tracking-wide">
                2. Simule um Serviço Real & Custo Real dos Químicos
              </h3>
              <p className="text-[12px] text-vapor-400">
                Escolha o serviço abaixo para ver a ficha técnica exata de produtos e diluição:
              </p>
            </div>
          </div>

          <span className="self-start sm:self-auto font-mono text-[11px] uppercase tracking-wider px-2.5 py-1 rounded bg-graphite-900 border border-graphite-600 text-amber-500">
            Passo 2 de 2
          </span>
        </div>

        {/* Seletor de Serviços Rápidos com Ficha Técnica */}
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-mono uppercase tracking-wider text-vapor-400">
            Selecione o serviço para carregar o tempo e os produtos reais:
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {PRESETS_SERVICOS.map((preset) => {
              const isSelected = presetAtivoId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelecionarPreset(preset)}
                  className={`min-h-[44px] px-2.5 py-2 rounded-[6px] text-xs font-semibold flex flex-col items-center justify-center text-center transition-all border ${
                    isSelected
                      ? 'bg-amber-500/20 border-amber-500 text-amber-400 shadow-md shadow-amber-500/10'
                      : 'bg-graphite-900 border-graphite-700 text-vapor-400 hover:text-vapor-100 hover:border-graphite-500'
                  }`}
                >
                  <span className="leading-tight">{preset.tipoCurto}</span>
                  <span className="text-[10px] font-mono opacity-80">
                    {preset.tempoPadrao} min • {formatarMoeda(preset.custoQuimicoPadrao)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Inputs de Simulação do Serviço */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-1">
          {/* Campo: Tempo Gasto */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={`${idPrefix}-tempo`}
              className="font-display text-[11px] uppercase tracking-wider text-vapor-400 flex items-center justify-between"
            >
              <span>Tempo Gasto</span>
              <span className="text-[10px] text-vapor-400 font-sans normal-case">Duração no pátio</span>
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-3 text-vapor-400 select-none">
                <Clock size={15} />
              </span>
              <input
                id={`${idPrefix}-tempo`}
                type="number"
                inputMode="numeric"
                min="5"
                step="5"
                value={tempoServico === 0 ? '' : tempoServico}
                onChange={(e) => setTempoServico(Number(e.target.value) || 0)}
                className="w-full min-h-[46px] pl-9 pr-14 rounded-[4px] bg-graphite-900 border border-graphite-600 font-mono text-sm sm:text-base text-vapor-100 focus:outline-none focus:border-amber-500 transition-colors"
                placeholder="90"
              />
              <span className="absolute right-3 font-mono text-xs text-vapor-400 pointer-events-none">
                min
              </span>
            </div>
          </div>

          {/* Campo: Custo Químico */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={`${idPrefix}-quimico`}
              className="font-display text-[11px] uppercase tracking-wider text-vapor-400 flex items-center justify-between"
            >
              <span>Custo de Químicos</span>
              <button
                type="button"
                onClick={() => setDetalhesQuimicosAbertos((prev) => !prev)}
                className="text-[10px] text-glass-400 hover:underline flex items-center gap-0.5 font-sans normal-case cursor-pointer"
              >
                <span>{detalhesQuimicosAbertos ? 'Ocultar itens' : 'Ver de onde veio'}</span>
                {detalhesQuimicosAbertos ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-3 font-mono text-xs text-vapor-400 select-none">
                R$
              </span>
              <input
                id={`${idPrefix}-quimico`}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.5"
                value={custoQuimico === 0 ? '' : custoQuimico}
                onChange={(e) => {
                  setCustoQuimico(Number(e.target.value) || 0);
                  setModoQuimicoCustomizado(true);
                }}
                className={`w-full min-h-[46px] pl-9 pr-3 rounded-[4px] bg-graphite-900 border ${
                  modoQuimicoCustomizado ? 'border-amber-500/80' : 'border-graphite-600'
                } font-mono text-sm sm:text-base text-vapor-100 focus:outline-none focus:border-amber-500 transition-colors`}
                placeholder="14.80"
              />
            </div>
          </div>

          {/* Campo: Quanto cobra hoje */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={`${idPrefix}-preco`}
              className="font-display text-[11px] uppercase tracking-wider text-amber-500 font-bold flex items-center justify-between"
            >
              <span>Preço Cobrado Hoje *</span>
              <span className="text-[10px] text-vapor-400 font-sans normal-case">Valor final ao cliente</span>
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-3 font-mono text-xs text-amber-500 select-none font-bold">
                R$
              </span>
              <input
                id={`${idPrefix}-preco`}
                type="number"
                inputMode="decimal"
                min="0"
                step="5"
                value={precoCobrado === 0 ? '' : precoCobrado}
                onChange={(e) => setPrecoCobrado(Number(e.target.value) || 0)}
                className="w-full min-h-[46px] pl-9 pr-3 rounded-[4px] bg-graphite-900 border-2 border-amber-500/80 font-mono text-sm sm:text-base text-vapor-100 font-bold focus:outline-none focus:border-amber-400 transition-colors"
                placeholder="100"
              />
            </div>
          </div>
        </div>

        {/* =================================================================== */}
        {/* ASSISTENTE DE QUÍMICOS: TABELA DE DOSES EM ML & CUSTO REAL          */}
        {/* =================================================================== */}
        <div className="bg-graphite-900 border border-graphite-700 rounded-[6px] p-3.5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PackageCheck size={16} className="text-mint-400 shrink-0" />
              <span className="font-display text-xs sm:text-sm font-bold text-vapor-100">
                Ficha Técnica dos Produtos Gastos neste Serviço:
              </span>
            </div>

            <button
              type="button"
              onClick={() => setDetalhesQuimicosAbertos((prev) => !prev)}
              className="text-xs text-glass-400 hover:text-vapor-100 flex items-center gap-1 font-sans cursor-pointer"
            >
              <span>{detalhesQuimicosAbertos ? 'Recolher detalhes' : 'Ver quanto gasta por mL'}</span>
              {detalhesQuimicosAbertos ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>

          {/* Detalhamento de cada produto em mL */}
          {detalhesQuimicosAbertos && presetAtual && (
            <div className="flex flex-col gap-2 pt-2 border-t border-graphite-800">
              <p className="text-[11px] text-vapor-400">
                {presetAtual.descricao}
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-graphite-700/80 text-vapor-400 font-mono text-[10px] uppercase">
                      <th className="pb-1.5 font-semibold">Produto / Insumo</th>
                      <th className="pb-1.5 font-semibold text-center">Dose / Veículo</th>
                      <th className="pb-1.5 font-semibold text-right">Custo Real</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-graphite-800/60 font-sans">
                    {presetAtual.produtos.map((prod, idx) => (
                      <tr key={idx} className="hover:bg-graphite-800/40">
                        <td className="py-2 text-vapor-200">{prod.nome}</td>
                        <td className="py-2 text-center font-mono text-vapor-400">{prod.dose}</td>
                        <td className="py-2 text-right font-mono text-vapor-100 font-semibold">
                          {formatarMoeda(prod.custoUnitario)}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-graphite-950 font-bold border-t border-graphite-700">
                      <td className="py-2 px-1 text-vapor-100">Total de Químicos Calculado:</td>
                      <td className="py-2 text-center text-vapor-400 font-mono text-[11px]">Soma dos insumos</td>
                      <td className="py-2 px-1 text-right font-mono text-amber-400 text-sm">
                        {formatarMoeda(presetAtual.custoQuimicoPadrao)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Micro-aviso pedagógico do sistema NuvemWash para Produtos */}
          <div className="text-[11px] text-vapor-400 flex items-start gap-1.5 pt-1 border-t border-graphite-800/60">
            <Sparkles size={13} className="text-amber-500 shrink-0 mt-0.5" />
            <span>
              <strong className="text-vapor-200">Como o NuvemWash faz isso automaticamente:</strong> O sistema possui a Calculadora de Snow Foam e Diluição integrada ao seu Estoque. Ao abrir a OS do cliente, o sistema já calcula os mL de cada produto e dá baixa no estoque na hora, calculando o custo cirúrgico de cada lavagem ou polimento!
            </span>
          </div>
        </div>

        {/* ================================================================= */}
        {/* O CHOQUE DE REALIDADE: CARD DE IMPACTO FINANCEIRO                 */}
        {/* ================================================================= */}
        <div className="mt-2 flex flex-col gap-3">
          {/* Métricas lado a lado: Custo Real vs Preço Ideal NuvemWash */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Bloco 1: Custo Total Real */}
            <div className="bg-graphite-900 border border-graphite-600 rounded-[6px] p-3.5 sm:p-4 flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-[11px] uppercase tracking-wider text-vapor-400">
                  Custo Total Real de Produção
                </span>
                <span className="font-mono text-[10px] text-vapor-400">Tempo + Químico</span>
              </div>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="font-mono text-2xl sm:text-3xl font-extrabold text-vapor-100">
                  {formatarMoeda(resultado.custoTotalReal)}
                </span>
              </div>
              <p className="text-[11px] text-vapor-400 mt-1">
                (Tempo de pátio: <strong className="text-vapor-100 font-mono">{formatarMoeda(resultado.custoTempo)}</strong> + Químicos: <strong className="text-vapor-100 font-mono">{formatarMoeda(custoQuimico)}</strong>)
              </p>
            </div>

            {/* Bloco 2: Preço Ideal NuvemWash (Margem de 40%) */}
            <div className="bg-graphite-900 border border-amber-500/50 rounded-[6px] p-3.5 sm:p-4 flex flex-col gap-1 shadow-lg shadow-amber-500/5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-[11px] uppercase tracking-wider text-amber-500 font-semibold flex items-center gap-1">
                  <Sparkles size={12} />
                  <span>Preço Ideal NuvemWash</span>
                </span>
                <span className="font-mono text-[10px] text-mint-400 font-bold px-1.5 py-0.5 rounded bg-mint-400/10 border border-mint-400/30">
                  Margem Alvo 40%
                </span>
              </div>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="font-mono text-2xl sm:text-3xl font-extrabold text-amber-400">
                  {formatarMoeda(resultado.precoIdealNuvemWash)}
                </span>
              </div>
              <p className="text-[11px] text-vapor-400 mt-1">
                Fórmula blindada: <strong className="text-vapor-100 font-mono">Custo / (1 - 0.40)</strong> para sobrar 40% limpos no bolso.
              </p>
            </div>
          </div>

          {/* O Veredito: Diagnóstico Emocional de Choque de Realidade */}
          {resultado.estaPrejuizo ? (
            /* CASO 1: PREJUÍZO REAL (PAGANDO PARA TRABALHAR) */
            <div className="bg-flare-400/10 border-2 border-flare-400 rounded-[8px] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-pulse">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-[6px] bg-flare-400/20 border border-flare-400 text-flare-400 flex items-center justify-center shrink-0">
                  <Flame size={24} />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-flare-400 font-bold">
                    🚨 ALERTA CRÍTICO: VOCÊ ESTÁ PAGANDO PARA TRABALHAR!
                  </span>
                  <h4 className="font-display text-base sm:text-lg font-black text-vapor-100">
                    Prejuízo Real de <span className="text-flare-400 font-mono">{formatarMoeda(Math.abs(resultado.lucroRealAtual))}</span> em cada serviço
                  </h4>
                  <p className="text-xs text-vapor-300 leading-relaxed max-w-xl">
                    Seu custo de produção é de <strong>{formatarMoeda(resultado.custoTotalReal)}</strong>, mas você cobra <strong>{formatarMoeda(precoCobrado)}</strong>. A cada cliente atendido nesse preço, você tira dinheiro do próprio bolso para bancar a água, luz e produtos da sua oficina!
                  </p>
                </div>
              </div>

              <div className="self-end sm:self-auto shrink-0 bg-graphite-950 px-3.5 py-2.5 rounded border border-flare-400/40 text-right">
                <span className="font-mono text-[10px] uppercase text-flare-400 block font-semibold">Margem Atual</span>
                <span className="font-mono text-xl font-black text-flare-400">
                  {resultado.margemPercentualAtual.toFixed(1)}%
                </span>
              </div>
            </div>
          ) : resultado.estaAbaixoIdeal ? (
            /* CASO 2: LUCRO ILUSÓRIO (SOBRA POUCO E QUALQUER TAXA DE CARTÃO ENGROLA) */
            <div className="bg-amber-500/10 border-2 border-amber-500/60 rounded-[8px] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-[6px] bg-amber-500/20 border border-amber-500 text-amber-500 flex items-center justify-center shrink-0">
                  <AlertTriangle size={24} />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-amber-500 font-bold">
                    ⚠️ LUCRO ILUSÓRIO: MARGEM MUITO BAIXA
                  </span>
                  <h4 className="font-display text-base sm:text-lg font-black text-vapor-100">
                    Sobram apenas <span className="text-amber-400 font-mono">{formatarMoeda(resultado.lucroRealAtual)}</span> ({resultado.margemPercentualAtual.toFixed(1)}% de margem)
                  </h4>
                  <p className="text-xs text-vapor-300 leading-relaxed max-w-xl">
                    Você acha que está lucrando, mas qualquer taxa de maquininha de cartão (10% a 15% parcelado), comissão de ajudante ou dia de chuva <strong className="text-amber-400">engole todo esse valor</strong>. Seu preço ideal para blindar sua margem deveria ser de <strong className="text-vapor-100 font-mono">{formatarMoeda(resultado.precoIdealNuvemWash)}</strong>.
                  </p>
                </div>
              </div>

              <div className="self-end sm:self-auto shrink-0 bg-graphite-950 px-3.5 py-2.5 rounded border border-amber-500/40 text-right">
                <span className="font-mono text-[10px] uppercase text-amber-500 block font-semibold">Margem Atual</span>
                <span className="font-mono text-xl font-bold text-amber-400">
                  {resultado.margemPercentualAtual.toFixed(1)}%
                </span>
              </div>
            </div>
          ) : (
            /* CASO 3: MARGEM SAUDÁVEL (ACIMA DE 40%) */
            <div className="bg-mint-400/10 border-2 border-mint-400/60 rounded-[8px] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-[6px] bg-mint-400/20 border border-mint-400 text-mint-400 flex items-center justify-center shrink-0">
                  <CheckCircle2 size={24} />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-mint-400 font-bold">
                    ✅ PREÇO BLINDADO: MARGEM SAUDÁVEL
                  </span>
                  <h4 className="font-display text-base sm:text-lg font-black text-vapor-100">
                    Lucro Real de <span className="text-mint-400 font-mono">{formatarMoeda(resultado.lucroRealAtual)}</span> ({resultado.margemPercentualAtual.toFixed(1)}% de margem)
                  </h4>
                  <p className="text-xs text-vapor-300 leading-relaxed max-w-xl">
                    Parabéns! Seu preço cobre com segurança todos os custos fixos, mão de obra e químicos, garantindo lucro real no bolso.
                  </p>
                </div>
              </div>

              <div className="self-end sm:self-auto shrink-0 bg-graphite-950 px-3.5 py-2.5 rounded border border-mint-400/40 text-right">
                <span className="font-mono text-[10px] uppercase text-mint-400 block font-semibold">Margem Atual</span>
                <span className="font-mono text-xl font-bold text-mint-400">
                  {resultado.margemPercentualAtual.toFixed(1)}%
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
