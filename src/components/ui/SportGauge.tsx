import React, { useMemo } from 'react';

export type GaugeVariant = 'cyan' | 'mint' | 'amber' | 'flare' | 'multi';

export interface SportGaugeProps {
  /** Valor numérico atual */
  value: number;
  /** Valor mínimo da escala (padrão: 0) */
  min?: number;
  /** Valor máximo da escala (padrão: 100) */
  max?: number;
  /** Texto formatado para exibição central (ex: 'R$ 42.2k', '94', '85%') */
  formattedValue?: string;
  /** Rótulo abaixo do valor (ex: 'Agendamentos', 'Faturamento Total') */
  label?: string;
  /** Subtítulo descritivo (ex: 'Volume total do período') */
  subtitle?: string;
  /** Variante de cor do arco e brilhos */
  variant?: GaugeVariant;
  /** Tamanho do manômetro ('sm' | 'md' | 'lg') */
  size?: 'sm' | 'md' | 'lg';
  /** Exibir zona de corte de giro (redline) no final da escala */
  showRedline?: boolean;
  /** Exibir marcadores/ticks de calibração ao redor do arco */
  showTicks?: boolean;
  /** Classes adicionais para o container */
  className?: string;
}

/**
 * Converte coordenadas polares (graus onde 90° = Topo, 180° = Esquerda, 0° = Direita)
 * para coordenadas cartesianas SVG (onde Y cresce para baixo).
 */
function polarToSvg(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy - r * Math.sin(rad),
  };
}

export const SportGauge: React.FC<SportGaugeProps> = ({
  value,
  min = 0,
  max = 100,
  formattedValue,
  label,
  subtitle,
  variant = 'cyan',
  size = 'md',
  showRedline = true,
  showTicks = true,
  className = '',
}) => {
  // Dimensões do SVG
  // O arco é um domo superior que parte de ~200° (inferior esquerdo), sobe até 90° (topo) e desce até -20° (inferior direito)
  const width = size === 'sm' ? 200 : size === 'lg' ? 280 : 240;
  const height = size === 'sm' ? 140 : size === 'lg' ? 190 : 160;
  const cx = width / 2;
  const cy = height - (size === 'sm' ? 28 : size === 'lg' ? 40 : 34);
  const radius = size === 'sm' ? 68 : size === 'lg' ? 98 : 82;
  const strokeWidth = size === 'sm' ? 9 : size === 'lg' ? 13 : 11;

  // Ângulos do velocímetro esportivo:
  // 180° é esquerda horizontal. Usamos 205° (abaixo da esquerda) até -25° (abaixo da direita).
  // Arco total = 230 graus de amplitude.
  const startAngle = 205; // 8 horas (inferior esquerdo)
  const endAngle = -25;   // 4 horas (inferior direito)
  const totalAngleSpan = startAngle - endAngle; // 230 graus

  // Normalização do percentual (0 a 1)
  const range = max - min > 0 ? max - min : 1;
  const rawPct = (value - min) / range;
  const clampedPct = Math.max(0, Math.min(rawPct, 1.15)); // Permite até 115% para redline

  // Ângulo atual do ponteiro
  const currentAngle = startAngle - Math.min(clampedPct, 1.15) * totalAngleSpan;

  // Pontos do trilho de fundo (Domo do velocímetro)
  const pTrackStart = polarToSvg(cx, cy, radius, startAngle);
  const pTrackEnd = polarToSvg(cx, cy, radius, endAngle);
  const trackPath = `M ${pTrackStart.x} ${pTrackStart.y} A ${radius} ${radius} 0 1 1 ${pTrackEnd.x} ${pTrackEnd.y}`;

  // Caminho do arco ativo colorido
  const activeEndAngle = startAngle - Math.min(clampedPct, 1.0) * totalAngleSpan;
  const pActiveEnd = polarToSvg(cx, cy, radius, activeEndAngle);
  const activeAngleDelta = startAngle - activeEndAngle;
  const activePath =
    clampedPct > 0.005
      ? `M ${pTrackStart.x} ${pTrackStart.y} A ${radius} ${radius} 0 ${
          activeAngleDelta > 180 ? 1 : 0
        } 1 ${pActiveEnd.x} ${pActiveEnd.y}`
      : '';

  // Redline path (últimos 18% do arco)
  const redlineStartAngle = startAngle - totalAngleSpan * 0.82;
  const pRedlineStart = polarToSvg(cx, cy, radius, redlineStartAngle);
  const redlineDelta = redlineStartAngle - endAngle;
  const redlinePath = `M ${pRedlineStart.x} ${pRedlineStart.y} A ${radius} ${radius} 0 ${
    redlineDelta > 180 ? 1 : 0
  } 1 ${pTrackEnd.x} ${pTrackEnd.y}`;

  // Ticks (marcadores automotivos graduados)
  const ticks = useMemo(() => {
    if (!showTicks) return [];
    const count = 23; // Ticks ao longo do arco
    const list = [];
    for (let i = 0; i < count; i++) {
      const pct = i / (count - 1);
      const angle = startAngle - pct * totalAngleSpan;
      const isMajor = i % 4 === 0 || i === count - 1;
      const isRedlineTick = showRedline && pct >= 0.82;

      const outerR = radius + (isMajor ? strokeWidth / 2 + 6 : strokeWidth / 2 + 3);
      const innerR = radius + strokeWidth / 2 + 1;

      const pInner = polarToSvg(cx, cy, innerR, angle);
      const pOuter = polarToSvg(cx, cy, outerR, angle);

      list.push({
        x1: pInner.x,
        y1: pInner.y,
        x2: pOuter.x,
        y2: pOuter.y,
        isMajor,
        isRedlineTick,
      });
    }
    return list;
  }, [cx, cy, radius, strokeWidth, startAngle, totalAngleSpan, showTicks, showRedline]);

  // Cores por variante
  const colorMap = {
    cyan: {
      gradientStart: '#0284C7',
      gradientEnd: '#00E5FF',
      glow: 'rgba(0, 229, 255, 0.45)',
      accent: '#00E5FF',
      needle: '#FF3B30',
    },
    mint: {
      gradientStart: '#059669',
      gradientEnd: '#10B981',
      glow: 'rgba(16, 185, 129, 0.45)',
      accent: '#10B981',
      needle: '#FF3B30',
    },
    amber: {
      gradientStart: '#D97706',
      gradientEnd: '#F59E0B',
      glow: 'rgba(245, 158, 11, 0.45)',
      accent: '#F59E0B',
      needle: '#FF3B30',
    },
    flare: {
      gradientStart: '#E11D48',
      gradientEnd: '#FF5A5A',
      glow: 'rgba(255, 90, 90, 0.45)',
      accent: '#FF5A5A',
      needle: '#FF3B30',
    },
    multi: {
      gradientStart: '#00E5FF',
      gradientEnd: '#10B981',
      glow: 'rgba(16, 185, 129, 0.45)',
      accent: '#10B981',
      needle: '#FF3B30',
    },
  };

  const currentColors = colorMap[variant] || colorMap.cyan;
  const uniqueId = useMemo(() => `sg-${variant}-${Math.random().toString(36).substr(2, 7)}`, [variant]);

  // Cálculo da ponta e base do ponteiro (Needle)
  const needleLength = radius - 6;
  const pTip = polarToSvg(cx, cy, needleLength, currentAngle);
  const pBaseLeft = polarToSvg(cx, cy, 7, currentAngle + 90);
  const pBaseRight = polarToSvg(cx, cy, 7, currentAngle - 90);
  const pBaseBack = polarToSvg(cx, cy, 12, currentAngle + 180);

  // Valor numérico formatado
  const displayVal = formattedValue !== undefined ? formattedValue : Math.round(value).toString();

  return (
    <div className={`flex flex-col items-center justify-center select-none w-full ${className}`}>
      {/* SVG DO VELOCÍMETRO / MANÔMETRO */}
      <div className="relative flex items-center justify-center">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="overflow-visible"
        >
          <defs>
            {/* Gradiente do arco luminoso */}
            <linearGradient id={`grad-${uniqueId}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={currentColors.gradientStart} />
              {variant === 'multi' && <stop offset="60%" stopColor="#F59E0B" />}
              <stop offset="100%" stopColor={currentColors.gradientEnd} />
            </linearGradient>

            {/* Brilho Neon (Glow Filter) */}
            <filter id={`glow-${uniqueId}`} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>

            {/* Sombra realista do ponteiro */}
            <filter id={`shadow-${uniqueId}`} x="-40%" y="-40%" width="180%" height="180%">
              <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#000" floodOpacity="0.9" />
            </filter>
          </defs>

          {/* Trilho de fundo (Dark Carbon Track) */}
          <path
            d={trackPath}
            fill="none"
            stroke="#1F242C"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />

          {/* Zona de Redline sutil no final da escala */}
          {showRedline && (
            <path
              d={redlinePath}
              fill="none"
              stroke="rgba(255, 90, 90, 0.25)"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
          )}

          {/* Ticks de calibração esportivos ao redor do arco */}
          {ticks.map((t, idx) => (
            <line
              key={idx}
              x1={t.x1}
              y1={t.y1}
              x2={t.x2}
              y2={t.y2}
              stroke={t.isRedlineTick ? '#FF5A5A' : t.isMajor ? '#98A2B0' : '#3A4452'}
              strokeWidth={t.isMajor ? 2 : 1}
              strokeLinecap="round"
              opacity={t.isMajor ? 0.9 : 0.5}
            />
          ))}

          {/* Arco Ativo com Brilho Neon */}
          {activePath && (
            <>
              {/* Brilho neon de fundo */}
              <path
                d={activePath}
                fill="none"
                stroke={currentColors.accent}
                strokeWidth={strokeWidth + 4}
                strokeLinecap="round"
                opacity={0.35}
                filter={`url(#glow-${uniqueId})`}
                className="transition-all duration-700 ease-out"
              />
              {/* Linha principal com gradiente esportivo */}
              <path
                d={activePath}
                fill="none"
                stroke={`url(#grad-${uniqueId})`}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                className="transition-all duration-700 ease-out"
              />
            </>
          )}

          {/* Ponteiro Esportivo (Needle com animação fluida) */}
          <g filter={`url(#shadow-${uniqueId})`}>
            {/* Lâmina do ponteiro afunilada em vermelho esportivo */}
            <polygon
              points={`${pTip.x},${pTip.y} ${pBaseLeft.x},${pBaseLeft.y} ${pBaseBack.x},${pBaseBack.y} ${pBaseRight.x},${pBaseRight.y}`}
              fill={currentColors.needle}
              className="transition-all duration-700 ease-out"
            />
            {/* Linha de reflexo fino central no ponteiro */}
            <line
              x1={cx}
              y1={cy}
              x2={pTip.x}
              y2={pTip.y}
              stroke="#FFF"
              strokeWidth={1}
              opacity={0.7}
              className="transition-all duration-700 ease-out"
            />
          </g>

          {/* Pivô Central (Tampa metálica de manômetro automotivo) */}
          <circle cx={cx} cy={cy} r={12} fill="#0F1216" stroke="#2B323C" strokeWidth={2.5} />
          <circle cx={cx} cy={cy} r={6} fill="#171B21" />
          <circle cx={cx} cy={cy} r={3} fill={currentColors.needle} />
        </svg>
      </div>

      {/* BLOCO CENTRAL: NÚMERO, TÍTULO E SUBTÍTULO (POSICIONADOS LOGO ABAIXO DO MANÔMETRO) */}
      <div className="flex flex-col items-center text-center mt-1 w-full px-2">
        {/* Grande Valor Digital de Alto Contraste */}
        <span
          className="font-mono font-bold tracking-tight text-vapor-100 text-3xl sm:text-4xl leading-none my-1"
          style={{
            textShadow: `0 0 16px ${currentColors.glow}`,
          }}
        >
          {displayVal}
        </span>

        {/* Título / Rótulo da Métrica */}
        {label && (
          <span className="font-display text-sm font-bold text-vapor-100 uppercase tracking-wider mt-0.5">
            {label}
          </span>
        )}

        {/* Subtítulo Descritivo */}
        {subtitle && (
          <span className="font-sans text-xs text-vapor-400 mt-0.5 max-w-[220px] truncate">
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
};

export interface SportGaugeCardProps {
  title: string;
  subtitle?: string;
  value: number;
  min?: number;
  max?: number;
  formattedValue?: string;
  variant?: GaugeVariant;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  badge?: React.ReactNode;
  footerInfo?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

export const SportGaugeCard: React.FC<SportGaugeCardProps> = ({
  title,
  subtitle,
  value,
  min = 0,
  max = 100,
  formattedValue,
  variant = 'cyan',
  icon: Icon,
  badge,
  footerInfo,
  onClick,
  className = '',
}) => {
  return (
    <div
      onClick={onClick}
      className={`relative bg-gradient-to-b from-graphite-800/90 to-graphite-900/95 border border-graphite-700/80 hover:border-amber-500/60 transition-all duration-300 rounded-2xl p-5 flex flex-col justify-between items-center shadow-xl hover:shadow-2xl hover:shadow-amber-500/5 group ${
        onClick ? 'cursor-pointer' : ''
      } ${className}`}
    >
      {/* Luz ambiente de cockpit esportivo no fundo */}
      <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-graphite-800/20 to-amber-500/5 rounded-2xl pointer-events-none" />

      {/* Top Header do Card (Ícone, Nome e Badge) */}
      <div className="w-full flex items-center justify-between gap-2 relative z-10 mb-2">
        <div className="flex items-center gap-2 truncate">
          {Icon && (
            <div className="p-1.5 rounded-lg bg-graphite-950/70 border border-graphite-700 text-vapor-400 group-hover:text-amber-500 transition-colors shrink-0">
              <Icon size={16} />
            </div>
          )}
          <span className="font-display text-xs font-bold text-vapor-200 uppercase tracking-wider truncate">
            {title}
          </span>
        </div>
        {badge && <div className="shrink-0">{badge}</div>}
      </div>

      {/* Manômetro Central com Leitura Digital */}
      <div className="w-full flex items-center justify-center my-2 relative z-10">
        <SportGauge
          value={value}
          min={min}
          max={max}
          formattedValue={formattedValue}
          label={title}
          subtitle={subtitle}
          variant={variant}
          size="md"
        />
      </div>

      {/* Informação / Indicadores de Rodapé */}
      {footerInfo && (
        <div className="w-full relative z-10 pt-3 mt-1 border-t border-graphite-700/60">
          {footerInfo}
        </div>
      )}
    </div>
  );
};
