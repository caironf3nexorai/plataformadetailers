import React, { useState, useEffect, useRef } from 'react';

export interface CampoNumericoProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  /**
   * Valor numérico ou string (ex: 12.5, "12,5", 0, null)
   */
  value: number | string | null | undefined;
  /**
   * Callback invocado a cada alteração.
   * Retorna o número convertido (ou null) e a string formatada.
   */
  onChange: (value: number | null, valueStr: string) => void;
  /**
   * Símbolo impresso à esquerda (ex: "R$", "US$")
   */
  prefix?: string;
  /**
   * Símbolo impresso à direita (ex: "%", "min", "kg", "un")
   */
  suffix?: string;
  /**
   * Permite apenas inteiros (dispara inputMode="numeric")
   */
  integerOnly?: boolean;
  /**
   * Se true, ao desfocar um campo vazio, mantém null em vez de 0.
   */
  allowNull?: boolean;
  /**
   * Se true, exibe e aceita 0 explicitamente (ex: "0,00" ou "0") sem esvaziar para marca-d'água.
   * Essencial para valores gratuitos, brindes ou cortesias.
   */
  allowZero?: boolean;
  /**
   * Alinhamento do texto ("left" | "center" | "right")
   */
  align?: 'left' | 'center' | 'right';
  /**
   * Classe customizada para o wrapper externo (ex: flex-1, w-full, etc.)
   */
  wrapperClassName?: string;
}

/**
 * Converte valor externo (número ou string) para string de exibição PT-BR.
 * Quando allowZero for true, preserva o zero ("0,00" ou "0") ao invés de ocultar para placeholder.
 */
export function formatarValorNumerico(
  val: number | string | null | undefined,
  allowZero = false,
  integerOnly = false
): string {
  if (val === null || val === undefined || val === '') return '';
  const num = typeof val === 'string' ? parseFloat(val.replace(',', '.')) : val;
  if (isNaN(num)) return '';
  if (num === 0) {
    if (!allowZero) return '';
    return integerOnly ? '0' : '0,00';
  }

  const strVal = String(val);
  if (strVal.includes(',')) return strVal;
  return strVal.replace('.', ',');
}

export const CampoNumerico = React.forwardRef<HTMLInputElement, CampoNumericoProps>(
  (
    {
      value,
      onChange,
      prefix,
      suffix,
      integerOnly = false,
      allowNull = false,
      allowZero = false,
      align = 'left',
      wrapperClassName = '',
      className = '',
      placeholder = '0',
      disabled = false,
      onFocus,
      onBlur,
      onMouseDown,
      onTouchStart,
      ...restProps
    },
    ref
  ) => {
    const internalRef = useRef<HTMLInputElement | null>(null);

    // Helper para unificar ref externa e interna
    const handleRef = (node: HTMLInputElement | null) => {
      internalRef.current = node;
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref) {
        (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
      }
    };

    const [isFocused, setIsFocused] = useState(false);

    const formatValueToString = (val: number | string | null | undefined): string =>
      formatarValorNumerico(val, allowZero, integerOnly);

    const [editingValue, setEditingValue] = useState<string>(() => formatValueToString(value));
    const wasJustFocusedRef = useRef(false);

    // Atualiza o valor interno quando o valor externo muda E o campo não está com foco
    useEffect(() => {
      if (!isFocused) {
        setEditingValue(formatValueToString(value));
      }
    }, [value, isFocused]);

    // Trata parsing e emissão do evento onChange
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      let rawStr = e.target.value;

      // Substitui múltiplos pontos ou vírgulas se necessário
      if (integerOnly) {
        rawStr = rawStr.replace(/[^0-9-]/g, '');
      } else {
        // Permite números, uma vírgula ou um ponto, e sinal negativo no início
        rawStr = rawStr.replace(/[^0-9,.-]/g, '');
        // Se houver ponto e vírgula, padroniza todos os pontos para vírgula antes de normalizar
        rawStr = rawStr.replace(/\./g, ',');
        // Garante no máximo uma vírgula
        const parts = rawStr.split(',');
        if (parts.length > 2) {
          rawStr = parts[0] + ',' + parts.slice(1).join('');
        }
      }

      setEditingValue(rawStr);

      if (rawStr === '' || rawStr === '-') {
        onChange(allowNull ? null : 0, rawStr);
        return;
      }

      const normalizedNumber = parseFloat(rawStr.replace(',', '.'));
      if (isNaN(normalizedNumber)) {
        onChange(allowNull ? null : 0, rawStr);
      } else {
        onChange(normalizedNumber, rawStr);
      }
    };

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(true);
      wasJustFocusedRef.current = true;

      // Se o valor numérico atual for 0 e allowZero não estiver ativo, limpa para exibir placeholder
      if (!allowZero && value === 0 && (editingValue === '0' || editingValue === '0,00' || editingValue === '')) {
        setEditingValue('');
      }

      if (onFocus) {
        onFocus(e);
      }

      // requestAnimationFrame garante a seleção completa em mobile (iOS/Android) e desktop (click e Tab)
      requestAnimationFrame(() => {
        if (internalRef.current) {
          internalRef.current.select();
        }
      });
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(false);
      wasJustFocusedRef.current = false;

      const trimmed = editingValue.trim();

      if (trimmed === '' || trimmed === '-') {
        if (allowNull) {
          setEditingValue('');
          onChange(null, '');
        } else if (allowZero) {
          const zeroStr = integerOnly ? '0' : '0,00';
          setEditingValue(zeroStr);
          onChange(0, zeroStr);
        } else {
          setEditingValue('');
          onChange(0, '0');
        }
      } else {
        // Formata para exibição padrão ao desfocar
        const parsed = parseFloat(trimmed.replace(',', '.'));
        if (isNaN(parsed)) {
          if (allowNull) {
            setEditingValue('');
            onChange(null, '');
          } else if (allowZero) {
            const zeroStr = integerOnly ? '0' : '0,00';
            setEditingValue(zeroStr);
            onChange(0, zeroStr);
          } else {
            setEditingValue('');
            onChange(0, '0');
          }
        } else if (parsed === 0) {
          if (allowZero) {
            const zeroStr = integerOnly ? '0' : '0,00';
            setEditingValue(zeroStr);
            onChange(0, zeroStr);
          } else {
            setEditingValue('');
            onChange(0, '0');
          }
        } else {
          setEditingValue(formatValueToString(parsed));
          onChange(parsed, String(parsed));
        }
      }

      if (onBlur) {
        onBlur(e);
      }
    };

    // Previne que o toque/clique no primeiro foco desfaça a seleção completa de texto
    const handleMouseUp = (e: React.MouseEvent<HTMLInputElement>) => {
      if (wasJustFocusedRef.current) {
        e.preventDefault();
        wasJustFocusedRef.current = false;
      }
    };

    const alignClasses = {
      left: 'text-left',
      center: 'text-center',
      right: 'text-right',
    }[align];

    return (
      <div
        className={`relative flex items-center bg-graphite-950 border border-graphite-700 rounded-lg focus-within:border-amber-500 transition-colors ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        } ${wrapperClassName}`}
      >
        {prefix && (
          <span className="pl-3 pr-1 text-xs font-mono font-medium text-vapor-400 select-none shrink-0">
            {prefix}
          </span>
        )}

        <input
          ref={handleRef}
          type="text"
          inputMode={integerOnly ? 'numeric' : 'decimal'}
          value={isFocused ? editingValue : formatValueToString(value)}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onMouseUp={handleMouseUp}
          placeholder={placeholder}
          disabled={disabled}
          className={`w-full bg-transparent px-3 py-2 text-sm font-mono text-vapor-100 placeholder:text-graphite-500 placeholder:font-mono outline-none ${alignClasses} ${className}`}
          {...restProps}
        />

        {suffix && (
          <span className="pr-3 pl-1 text-xs font-mono font-medium text-vapor-400 select-none shrink-0">
            {suffix}
          </span>
        )}
      </div>
    );
  }
);

CampoNumerico.displayName = 'CampoNumerico';
