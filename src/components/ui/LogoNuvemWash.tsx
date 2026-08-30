import React from 'react';

export interface LogoNuvemWashProps {
  /**
   * Modo de exibição:
   * - 'full': Logo completa original (Ícone + Texto NUVEMWASH)
   * - 'icon': Apenas o símbolo (Nuvem com onda e gota)
   */
  variant?: 'full' | 'icon';
  /**
   * Tamanho pré-definido:
   * - 'xs': ~20px altura
   * - 'sm': ~28px altura
   * - 'md': ~36px altura (padrão)
   * - 'lg': ~48px altura
   * - 'xl': ~60px altura
   * - '2xl': ~80px altura
   */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  /**
   * Altura personalizada em pixels ou string CSS (ex: 40, '40px')
   */
  height?: number | string;
  /**
   * Classes adicionais no elemento
   */
  className?: string;
  /**
   * Texto alternativo (acessibilidade)
   */
  alt?: string;
}

const heightConfig: Record<string, number> = {
  xs: 20,
  sm: 28,
  md: 36,
  lg: 48,
  xl: 60,
  '2xl': 80,
};

export const NuvemWashIcon: React.FC<{
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  height?: number | string;
  className?: string;
  alt?: string;
}> = ({ size = 'md', height, className = '', alt = 'Ícone NuvemWash' }) => {
  const h = height !== undefined ? height : heightConfig[size] || 36;

  return (
    <img
      src="/logo-icon.png"
      alt={alt}
      style={{ height: typeof h === 'number' ? `${h}px` : h, width: 'auto' }}
      className={`shrink-0 object-contain select-none pointer-events-none ${className}`}
      loading="eager"
      decoding="async"
    />
  );
};

export const LogoNuvemWash: React.FC<LogoNuvemWashProps> = ({
  variant = 'full',
  size = 'md',
  height,
  className = '',
  alt = 'NuvemWash',
}) => {
  const h = height !== undefined ? height : heightConfig[size] || 36;
  const src = variant === 'icon' ? '/logo-icon.png' : '/logo-full.png';

  return (
    <img
      src={src}
      alt={alt}
      style={{ height: typeof h === 'number' ? `${h}px` : h, width: 'auto' }}
      className={`shrink-0 object-contain select-none ${className}`}
      loading="eager"
      decoding="async"
    />
  );
};
