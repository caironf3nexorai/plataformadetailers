import { supabase } from '../lib/supabase';

export const DEFAULT_SERVICE_PLACEHOLDER =
  'https://images.unsplash.com/photo-1607860108855-64acf2078ed9?auto=format&fit=crop&w=800&q=80';

/**
 * Converte um nome de grupo em um slug determinístico sem acentos e sem caracteres especiais.
 * Exemplo: "Higienização" -> "higienizacao"
 * Exemplo: "Polimento / Correção" -> "polimento-correcao"
 */
export const slugifyGrupo = (text: string): string => {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

/**
 * Valida o tipo MIME do arquivo enviado. Aceita imagens padrão (JPG, JPEG, PNG, WEBP).
 */
export const validateImageFile = (
  file: File
): { valid: boolean; ext: string; error?: string } => {
  const allowedMimeTypes: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };

  const ext = allowedMimeTypes[file.type.toLowerCase()];
  if (!ext) {
    return {
      valid: false,
      ext: '',
      error: 'Formato inválido. Envie apenas imagens JPG, PNG ou WEBP.',
    };
  }

  return { valid: true, ext };
};

export interface CompressaoCatalogoOptions {
  maxDimension?: number;
  targetMaxBytes?: number;
  initialQuality?: number;
  preservePngTransparency?: boolean;
}

/**
 * Comprime e otimiza imagens de catálogo no navegador para o menor tamanho possível (< 200KB) sem perda de qualidade visual perceptível.
 * Reduz drasticamente o consumo de storage do Supabase convertendo para WebP ultra-leve.
 */
export async function comprimirImagemCatalogo(
  file: File,
  options: CompressaoCatalogoOptions = {}
): Promise<{ file: File; ext: string; originalSize: number; compressedSize: number }> {
  const {
    maxDimension = 1200,
    targetMaxBytes = 200 * 1024, // Alvo padrão: ~200 KB máximo (frequentemente 80-160 KB)
    initialQuality = 0.74,
    preservePngTransparency = false,
  } = options;

  const originalSize = file.size;

  // Se já for menor que 100KB e em formato webp, mantém direto
  if (originalSize <= 100 * 1024 && file.type.includes('webp') && !preservePngTransparency) {
    return { file, ext: 'webp', originalSize, compressedSize: originalSize };
  }

  let width = 0;
  let height = 0;
  let imageSource: CanvasImageSource | null = null;
  let closeImageSource: (() => void) | null = null;

  // 1. Decodificação com createImageBitmap (trata rotação EXIF automaticamente)
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: 'from-image',
      });
      width = bitmap.width;
      height = bitmap.height;
      imageSource = bitmap;
      closeImageSource = () => bitmap.close();
    } catch (err) {
      console.warn('[comprimirImagemCatalogo] createImageBitmap falhou, usando fallback Image:', err);
    }
  }

  // 2. Fallback com HTMLImageElement
  if (!imageSource) {
    imageSource = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        width = img.width;
        height = img.height;
        resolve(img);
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      img.src = url;
    });
  }

  try {
    // 3. Redimensionamento proporcional (nunca amplia)
    let curMaxDim = maxDimension;
    if (width > curMaxDim || height > curMaxDim) {
      if (width > height) {
        height = Math.round((height * curMaxDim) / width);
        width = curMaxDim;
      } else {
        width = Math.round((width * curMaxDim) / height);
        height = curMaxDim;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('Não foi possível inicializar o contexto 2D do Canvas.');
    }

    // Se for PNG e usuário deseja manter transparência (ex: logos), preserva alpha
    const isPng = file.type.toLowerCase().includes('png');
    const keepAlpha = isPng && preservePngTransparency;

    if (!keepAlpha) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
    }

    ctx.drawImage(imageSource, 0, 0, width, height);

    // 4. Formato de exportação: WebP é extremamente eficiente e suporta transparência com fração do peso de PNG
    const outputMime = 'image/webp';
    let quality = initialQuality;

    let compressedBlob: Blob | null = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), outputMime, quality);
    });

    let finalExt = 'webp';

    // Fallback se o navegador antigo não suportar WebP no canvas
    if (!compressedBlob) {
      compressedBlob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), keepAlpha ? 'image/png' : 'image/jpeg', quality);
      });
      finalExt = keepAlpha ? 'png' : 'jpg';
    }

    // 5. Passagens iterativas se ainda estiver acima do alvo desejado (< 200KB)
    if (compressedBlob && compressedBlob.size > targetMaxBytes) {
      // Tentativa 2: qualidade 0.62
      quality = 0.62;
      const attempt2 = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), outputMime, quality);
      });
      if (attempt2 && attempt2.size < compressedBlob.size) {
        compressedBlob = attempt2;
      }
    }

    // Se mesmo assim ainda estiver acima de targetMaxBytes, redimensiona um pouco mais (960px)
    if (compressedBlob && compressedBlob.size > targetMaxBytes && (width > 960 || height > 960)) {
      const scale = 960 / Math.max(width, height);
      const w2 = Math.round(width * scale);
      const h2 = Math.round(height * scale);

      const canvas2 = document.createElement('canvas');
      canvas2.width = w2;
      canvas2.height = h2;
      const ctx2 = canvas2.getContext('2d');
      if (ctx2) {
        if (!keepAlpha) {
          ctx2.fillStyle = '#FFFFFF';
          ctx2.fillRect(0, 0, w2, h2);
        }
        ctx2.drawImage(canvas, 0, 0, w2, h2);
        const attempt3 = await new Promise<Blob | null>((resolve) => {
          canvas2.toBlob((b) => resolve(b), outputMime, 0.58);
        });
        if (attempt3 && attempt3.size < compressedBlob.size) {
          compressedBlob = attempt3;
        }
      }
    }

    if (!compressedBlob) {
      return { file, ext: 'jpg', originalSize, compressedSize: originalSize };
    }

    const baseName = file.name.replace(/\.[^/.]+$/, '');
    const finalFile = new File([compressedBlob], `${baseName}.${finalExt}`, {
      type: compressedBlob.type,
      lastModified: Date.now(),
    });

    console.info(
      `[comprimirImagemCatalogo] ${file.name}: ${(originalSize / 1024).toFixed(1)} KB -> ${(
        finalFile.size / 1024
      ).toFixed(1)} KB (${(((originalSize - finalFile.size) / originalSize) * 100).toFixed(0)}% de economia)`
    );

    return {
      file: finalFile,
      ext: finalExt,
      originalSize,
      compressedSize: finalFile.size,
    };
  } finally {
    if (closeImageSource) {
      closeImageSource();
    }
  }
}

/**
 * Retorna a URL pública de uma foto armazenada no bucket público 'catalogo'.
 */
export const getFotoPublicUrl = (path: string | null | undefined): string | null => {
  if (!path) return null;
  const { data } = supabase.storage.from('catalogo').getPublicUrl(path);
  return data?.publicUrl || null;
};

/**
 * Resolve a imagem de exibição do serviço seguindo a ordem estrita de precedência:
 * 1. Foto própria do serviço (servico.foto_path)
 * 2. Foto do grupo de serviços (grupoFotos[grupo])
 * 3. Capa padrão da oficina (tenantCapaPath)
 * 4. Placeholder de fallback
 */
export const fotoDoServico = (
  servico: { foto_path?: string | null; grupo?: string } | null | undefined,
  grupoFotos: Record<string, string | null | undefined> = {},
  tenantCapaPath: string | null | undefined = null
): string => {
  if (!servico) {
    if (tenantCapaPath) {
      const url = getFotoPublicUrl(tenantCapaPath);
      if (url) return url;
    }
    return DEFAULT_SERVICE_PLACEHOLDER;
  }

  // 1. Foto própria do serviço
  if (servico.foto_path) {
    const url = getFotoPublicUrl(servico.foto_path);
    if (url) return url;
  }

  // 2. Foto do grupo
  if (servico.grupo) {
    const grupoSlug = slugifyGrupo(servico.grupo);
    const grupoPath = grupoFotos[servico.grupo] || grupoFotos[grupoSlug];
    if (grupoPath) {
      const url = getFotoPublicUrl(grupoPath);
      if (url) return url;
    }
  }

  // 3. Capa da oficina
  if (tenantCapaPath) {
    const url = getFotoPublicUrl(tenantCapaPath);
    if (url) return url;
  }

  // 4. Placeholder padrão
  return DEFAULT_SERVICE_PLACEHOLDER;
};
