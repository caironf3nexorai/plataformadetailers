import React, { useId, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  Clock,
  Droplets,
  Flame,
  Sparkles,
} from 'lucide-react';
import { formatarMoeda } from '../../utils/formatters';
import { calcularSimulacaoCustos } from '../../utils/calculadoraSimulacao';

interface MiniCalculadoraInterativaProps {
  className?: string;
  onSimulacaoChange?: (resultado: ReturnType<typeof calcularSimulacaoCustos>) => void;
}

export const MiniCalculadoraInterativa: React.FC<MiniCalculadoraInterativaProps> = ({
  className = '',
  onSimulacaoChange,
}) => {
  const idPrefix = useId();

  // Estados dos inputs (com valores padrão sugeridos na especificação)
  const [despesaFixa, setDespesaFixa] = useState<number>(4200);
  const [salarioEquipe, setSalarioEquipe] = useState<number>(5300);
  const [horasProdutivas, setHorasProdutivas] = useState<number>(144);

  const [tempoServico, setTempoServico] = useState<number>(90);
  const [custoQuimico, setCustoQuimico] = useState<number>(15);
  const [precoCobrado, setPrecoCobrado] = useState<number>(100);

  // Cálculo em tempo real
  const resultado = calcularSimulacaoCustos({
    despesaFixaMensal: despesaFixa,
    salarioEquipe,
    horasProdutivasMes: horasProdutivas,
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
      {/* PARTE 1.1: BLOCO DE CUSTOS FIXOS DA OFICINA                         */}
      {/* =================================================================== */}
      <div className="bg-graphite-800 border border-graphite-600 rounded-[8px] p-4 sm:p-6 shadow-xl flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-graphite-600/70">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-[6px] bg-amber-500/15 border border-amber-500/30 text-amber-500 flex items-center justify-center shrink-0">
              <Calculator size={17} />
            </div>
            <div>
              <h3 className="font-display text-sm sm:text-base font-bold text-vapor-100 uppercase tracking-wide">
                1. Custos Fixos da Sua Estética
              </h3>
              <p className="text-[12px] text-vapor-400">
                Toque nos campos para simular a realidade da sua oficina:
              </p>
            </div>
          </div>

          <span className="self-start sm:self-auto font-mono text-[11px] uppercase tracking-wider px-2.5 py-1 rounded bg-graphite-900 border border-graphite-600 text-glass-400">
            Passo 1 de 2
          </span>
        </div>

        {/* 3 Inputs Numéricos Responsivos */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          {/* Campo 1: Despesa Fixa Mensal */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={`${idPrefix}-despesa`}
              className="font-display text-[11px] uppercase tracking-wider text-vapor-400 flex items-center justify-between"
            >
              <span>Despesa Fixa / Mês</span>
              <span className="text-[10px] text-vapor-400 font-sans normal-case">Aluguel, luz, água</span>
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
              <span className="text-[10px] text-vapor-400 font-sans normal-case">Pró-labore + ajudantes</span>
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

          {/* Campo 3: Horas Produtivas / Mês */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={`${idPrefix}-horas`}
              className="font-display text-[11px] uppercase tracking-wider text-vapor-400 flex items-center justify-between"
            >
              <span>Horas Produtivas / Mês</span>
              <span className="text-[10px] text-vapor-400 font-sans normal-case">Horas de pátio real</span>
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-3 text-vapor-400 select-none">
                <Clock size={15} />
              </span>
              <input
                id={`${idPrefix}-horas`}
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                value={horasProdutivas === 0 ? '' : horasProdutivas}
                onChange={(e) => setHorasProdutivas(Number(e.target.value) || 1)}
                className="w-full min-h-[46px] pl-9 pr-3 rounded-[4px] bg-graphite-900 border border-graphite-600 font-mono text-sm sm:text-base text-vapor-100 focus:outline-none focus:border-amber-500 transition-colors"
                placeholder="144"
              />
            </div>
          </div>
        </div>

        {/* Chips de Atalho para Horas Produtivas no Celular */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
          <span className="text-[11px] text-vapor-400 mr-1 select-none">Atalhos rápidos:</span>
          {[
            { label: '144h (1 pessoa)', val: 144 },
            { label: '288h (2 pessoas)', val: 288 },
            { label: '432h (3+ equipe)', val: 432 },
          ].map((item) => (
            <button
              key={item.val}
              type="button"
              onClick={() => setHorasProdutivas(item.val)}
              className={`px-2.5 py-1 rounded-[4px] font-mono text-[11px] transition-colors border ${
                horasProdutivas === item.val
                  ? 'bg-amber-500/20 border-amber-500 text-amber-400 font-bold'
                  : 'bg-graphite-900 border-graphite-600 text-vapor-400 hover:text-vapor-100'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Card Destacado: Resultado da Hora e Minuto */}
        <div className="mt-1 bg-graphite-900 border border-glass-400/40 rounded-[6px] p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-inner">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-[6px] bg-glass-400/15 border border-glass-400/30 text-glass-400 flex items-center justify-center shrink-0">
              <Clock size={20} />
            </div>
            <div className="flex flex-col">
              <span className="font-mono text-[11px] uppercase tracking-wider text-glass-400 font-semibold">
                Custo de Pátio Calculado em Tempo Real
              </span>
              <span className="text-xs text-vapor-400">
                Total fixo: <strong className="text-vapor-100 font-mono">{formatarMoeda(resultado.custoFixoTotal)}</strong> dividido por <strong className="text-vapor-100 font-mono">{horasProdutivas}h</strong> de trabalho.
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
      {/* PARTE 1.2: BLOCO DE SIMULAÇÃO DE SERVIÇO & CHOQUE DE REALIDADE     */}
      {/* =================================================================== */}
      <div className="bg-graphite-800 border-2 border-graphite-600 rounded-[8px] p-4 sm:p-6 shadow-xl flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-graphite-600/70">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-[6px] bg-glass-400/15 border border-glass-400/30 text-glass-400 flex items-center justify-center shrink-0">
              <Droplets size={17} />
            </div>
            <div>
              <h3 className="font-display text-sm sm:text-base font-bold text-vapor-100 uppercase tracking-wide">
                2. Simule um Serviço Real (Lavagem / Polimento / Farol)
              </h3>
              <p className="text-[12px] text-vapor-400">
                Veja o que realmente sobra no bolso após pagar o tempo e os produtos:
              </p>
            </div>
          </div>

          <span className="self-start sm:self-auto font-mono text-[11px] uppercase tracking-wider px-2.5 py-1 rounded bg-graphite-900 border border-graphite-600 text-amber-500">
            Passo 2 de 2
          </span>
        </div>

        {/* Inputs de Simulação do Serviço */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          {/* Campo: Tempo Gasto */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={`${idPrefix}-tempo`}
              className="font-display text-[11px] uppercase tracking-wider text-vapor-400 flex items-center justify-between"
            >
              <span>Tempo Gasto</span>
              <span className="text-[10px] text-vapor-400 font-sans normal-case">Em minutos</span>
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
              <span className="text-[10px] text-vapor-400 font-sans normal-case">Shampoo, ceras, etc.</span>
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
                step="1"
                value={custoQuimico === 0 ? '' : custoQuimico}
                onChange={(e) => setCustoQuimico(Number(e.target.value) || 0)}
                className="w-full min-h-[46px] pl-9 pr-3 rounded-[4px] bg-graphite-900 border border-graphite-600 font-mono text-sm sm:text-base text-vapor-100 focus:outline-none focus:border-amber-500 transition-colors"
                placeholder="15"
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

        {/* Chips de Tempo Rápido */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-[11px] text-vapor-400 mr-1 select-none">Exemplos comuns:</span>
          {[
            { label: '45 min (Lavagem Rápida)', val: 45 },
            { label: '90 min (Lavagem Detalhada)', val: 90 },
            { label: '150 min (Higienização)', val: 150 },
            { label: '240 min (Polimento)', val: 240 },
          ].map((item) => (
            <button
              key={item.val}
              type="button"
              onClick={() => setTempoServico(item.val)}
              className={`px-2.5 py-1 rounded-[4px] font-mono text-[11px] transition-colors border ${
                tempoServico === item.val
                  ? 'bg-glass-400/20 border-glass-400 text-glass-400 font-bold'
                  : 'bg-graphite-900 border-graphite-600 text-vapor-400 hover:text-vapor-100'
              }`}
            >
              {item.label}
            </button>
          ))}
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
                (Tempo de pátio: <strong className="text-vapor-100 font-mono">{formatarMoeda(resultado.custoTempo)}</strong> + Produtos: <strong className="text-vapor-100 font-mono">{formatarMoeda(custoQuimico)}</strong>)
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
