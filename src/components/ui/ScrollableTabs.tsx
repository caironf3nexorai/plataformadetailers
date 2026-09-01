import React, { useRef, useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, Check, Layers } from 'lucide-react';

export interface TabItem {
  id: string;
  label: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  badge?: React.ReactNode;
  disabled?: boolean;
}

export interface ScrollableTabsProps {
  /** Lista de itens das abas */
  items?: TabItem[];
  /** ID da aba atualmente ativa */
  activeId?: string;
  /** Callback acionado ao selecionar uma aba */
  onChange?: (id: string) => void;
  /** Variante visual ('pill' | 'underline' | 'sport') */
  variant?: 'pill' | 'underline' | 'sport';
  /** Se verdadeiro, exibe um seletor dropdown rápido no mobile para listas longas */
  showQuickSelect?: boolean;
  /** Título do seletor mobile (ex: 'Selecione a Seção') */
  quickSelectTitle?: string;
  /** Conteúdo customizado (usado quando se passa filhos como NavLinks ou botões arbitrários) */
  children?: React.ReactNode;
  /** Classes CSS adicionais */
  className?: string;
}

export const ScrollableTabs: React.FC<ScrollableTabsProps> = ({
  items,
  activeId,
  onChange,
  variant = 'sport',
  showQuickSelect = true,
  quickSelectTitle = 'Navegação por Abas',
  children,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Checagem do estado de rolagem (overflow)
  const checkScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 6);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 6);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = containerRef.current;
    if (!el) return;

    const handleResize = () => checkScroll();
    window.addEventListener('resize', handleResize);
    el.addEventListener('scroll', checkScroll, { passive: true });

    const resizeObserver = new ResizeObserver(() => checkScroll());
    resizeObserver.observe(el);

    return () => {
      window.removeEventListener('resize', handleResize);
      el.removeEventListener('scroll', checkScroll);
      resizeObserver.disconnect();
    };
  }, [checkScroll, items, children]);

  // Auto-scroll da aba ativa para o centro do container
  useEffect(() => {
    if (activeTabRef.current && containerRef.current) {
      const container = containerRef.current;
      const activeEl = activeTabRef.current;

      const containerRect = container.getBoundingClientRect();
      const activeRect = activeEl.getBoundingClientRect();

      const scrollOffset =
        activeRect.left -
        containerRect.left -
        containerRect.width / 2 +
        activeRect.width / 2;

      container.scrollTo({
        left: container.scrollLeft + scrollOffset,
        behavior: 'smooth',
      });
    }
  }, [activeId]);

  const scroll = (direction: 'left' | 'right') => {
    if (!containerRef.current) return;
    const scrollAmount = containerRef.current.clientWidth * 0.65;
    containerRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  const activeIndex = items ? items.findIndex((item) => item.id === activeId) : -1;
  const currentItem = activeIndex >= 0 && items ? items[activeIndex] : null;

  return (
    <div className={`relative w-full flex flex-col gap-2 ${className}`}>
      {/* SELETOR COMPACTO RÁPIDO PARA MOBILE (se houver muitas abas e items definidos) */}
      {items && items.length > 3 && showQuickSelect && (
        <div className="md:hidden flex items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-1.5 text-xs text-vapor-400 font-mono">
            <Layers size={13} className="text-amber-500" />
            <span>
              Aba <strong className="text-vapor-100">{activeIndex >= 0 ? activeIndex + 1 : 1}</strong> de{' '}
              <strong>{items.length}</strong>
            </span>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-graphite-800 border border-graphite-700 hover:border-amber-500/60 text-xs font-semibold text-vapor-200 hover:text-amber-500 transition-colors shadow-sm"
              title="Menu rápido de todas as abas"
            >
              <span className="truncate max-w-[140px]">
                {currentItem ? currentItem.label : 'Selecionar'}
              </span>
              <ChevronDown size={14} className={`text-amber-500 transition-transform ${isMobileMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown Mobile Popover */}
            {isMobileMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
                  onClick={() => setIsMobileMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-1.5 z-50 w-64 bg-graphite-900 border border-graphite-700 rounded-xl shadow-2xl p-1.5 max-h-80 overflow-y-auto animate-in fade-in duration-150">
                  <div className="px-2.5 py-1.5 border-b border-graphite-800 text-[11px] font-display text-vapor-400 uppercase tracking-wider">
                    {quickSelectTitle}
                  </div>
                  <div className="flex flex-col gap-0.5 mt-1">
                    {items.map((item, idx) => {
                      const Icon = item.icon;
                      const isSelected = item.id === activeId;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          disabled={item.disabled}
                          onClick={() => {
                            if (onChange) onChange(item.id);
                            setIsMobileMenuOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-colors text-left ${
                            isSelected
                              ? 'bg-amber-500 text-graphite-950 font-bold'
                              : 'text-vapor-300 hover:bg-graphite-800 hover:text-vapor-100'
                          } ${item.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                        >
                          <div className="flex items-center gap-2.5 truncate">
                            <span className="font-mono text-[10px] opacity-70 w-4">
                              {idx + 1}.
                            </span>
                            {Icon && <Icon size={15} className="shrink-0" />}
                            <span className="truncate">{item.label}</span>
                          </div>
                          {isSelected && <Check size={14} className="shrink-0 stroke-[3]" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* CONTAINER PRINCIPAL DAS ABAS ROLÁVEIS */}
      <div className="relative group">
        {/* Sombra / Gradiente de Fade na Borda Esquerda */}
        <div
          className={`absolute left-0 top-0 bottom-0 w-10 bg-gradient-to-r from-graphite-900 via-graphite-900/80 to-transparent pointer-events-none z-10 transition-opacity duration-300 ${
            canScrollLeft ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {/* Botão de Rolagem para a Esquerda */}
        {canScrollLeft && (
          <button
            type="button"
            onClick={() => scroll('left')}
            className="absolute left-1 top-1/2 -translate-y-1/2 z-20 p-1.5 rounded-full bg-graphite-800/90 border border-graphite-600 text-vapor-200 hover:text-amber-500 hover:bg-graphite-700 shadow-lg backdrop-blur-sm transition-all hover:scale-105 active:scale-95"
            title="Rolar abas para a esquerda"
          >
            <ChevronLeft size={16} />
          </button>
        )}

        {/* Barra de Abas Rolável */}
        <div
          ref={containerRef}
          className="flex items-center gap-2 overflow-x-auto scrollbar-none py-1 px-1 touch-pan-x"
          style={{
            scrollBehavior: 'smooth',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {items && onChange
            ? items.map((item) => {
                const Icon = item.icon;
                const isActive = item.id === activeId;
                return (
                  <button
                    key={item.id}
                    ref={isActive ? (el) => { activeTabRef.current = el; } : null}
                    type="button"
                    disabled={item.disabled}
                    onClick={() => onChange(item.id)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-display text-[13.5px] uppercase tracking-wide whitespace-nowrap shrink-0 transition-all duration-200 select-none ${
                      variant === 'sport'
                        ? isActive
                          ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-graphite-950 font-bold shadow-md shadow-amber-500/20 border border-amber-400/50 scale-[1.02]'
                          : 'bg-graphite-800/90 text-vapor-300 hover:text-vapor-100 hover:bg-graphite-700/80 border border-graphite-700/80'
                        : variant === 'underline'
                        ? isActive
                          ? 'bg-graphite-800 text-amber-500 border-b-2 border-amber-500'
                          : 'text-vapor-400 hover:text-vapor-100 hover:bg-graphite-800/40'
                        : isActive
                        ? 'bg-amber-500 text-graphite-950 font-bold shadow-md'
                        : 'bg-graphite-800 text-vapor-300 hover:bg-graphite-700 hover:text-vapor-100'
                    } ${item.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    {Icon && (
                      <Icon
                        size={17}
                        className={isActive && variant === 'sport' ? 'text-graphite-950' : isActive ? 'text-amber-500' : 'text-vapor-400'}
                      />
                    )}
                    <span>{item.label}</span>
                    {item.badge && <span className="ml-1">{item.badge}</span>}
                  </button>
                );
              })
            : children}
        </div>

        {/* Sombra / Gradiente de Fade na Borda Direita (Visual Cue Crítico para Mobile) */}
        <div
          className={`absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-graphite-900 via-graphite-900/80 to-transparent pointer-events-none z-10 transition-opacity duration-300 ${
            canScrollRight ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {/* Botão de Rolagem para a Direita */}
        {canScrollRight && (
          <button
            type="button"
            onClick={() => scroll('right')}
            className="absolute right-1 top-1/2 -translate-y-1/2 z-20 p-1.5 rounded-full bg-graphite-800/90 border border-graphite-600 text-vapor-200 hover:text-amber-500 hover:bg-graphite-700 shadow-lg backdrop-blur-sm transition-all hover:scale-105 active:scale-95 animate-pulse"
            title="Rolar abas para a direita"
          >
            <ChevronRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
};
