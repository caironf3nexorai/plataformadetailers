import React, { useState } from 'react';
import { Link as LinkIcon, Check, Share2 } from 'lucide-react';

interface CopyLinkButtonProps {
  slug?: string | null;
  variant?: 'button' | 'icon' | 'outline';
  className?: string;
  label?: string;
}

export const CopyLinkButton: React.FC<CopyLinkButtonProps> = ({
  slug,
  variant = 'button',
  className = '',
  label = 'Copiar Link da Bio'
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!slug) return;
    const url = `${window.location.origin}/agendar/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      console.error('[Copy Error]:', err);
    }
  };

  if (!slug) return null;

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={handleCopy}
        className={`p-2 rounded bg-graphite-800 hover:bg-graphite-700 text-vapor-300 border border-graphite-600 transition-colors ${className}`}
        title={copied ? 'Link Copiado!' : 'Copiar Link do Catálogo'}
      >
        {copied ? <Check size={16} className="text-mint-400" /> : <Share2 size={16} />}
      </button>
    );
  }

  if (variant === 'outline') {
    return (
      <button
        type="button"
        onClick={handleCopy}
        className={`px-3 py-1.5 rounded-md border text-[12px] font-sans font-medium flex items-center gap-2 transition-colors ${
          copied
            ? 'border-mint-500/50 bg-mint-500/10 text-mint-400'
            : 'border-graphite-600 bg-graphite-800/80 hover:bg-graphite-700 text-vapor-200 hover:border-graphite-500'
        } ${className}`}
      >
        {copied ? (
          <>
            <Check size={14} className="text-mint-400 shrink-0" />
            <span>Link Copiado!</span>
          </>
        ) : (
          <>
            <LinkIcon size={14} className="text-amber-500 shrink-0" />
            <span>{label}</span>
          </>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`px-4 py-2 rounded-md font-sans text-[13px] font-medium flex items-center justify-center gap-2 transition-all shadow-sm ${
        copied
          ? 'bg-mint-500/20 border border-mint-500/50 text-mint-400'
          : 'bg-amber-500/10 border border-amber-500/40 hover:bg-amber-500/20 text-amber-400 hover:border-amber-500/60'
      } ${className}`}
    >
      {copied ? (
        <>
          <Check size={16} className="text-mint-400" />
          <span>Link Copiado!</span>
        </>
      ) : (
        <>
          <Share2 size={16} />
          <span>{label}</span>
        </>
      )}
    </button>
  );
};
