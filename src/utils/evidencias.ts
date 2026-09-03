import { supabase } from '../lib/supabase';
import { formatarDataHora } from './datas';
import { gerarId } from './uuid';
import { extractExifCapturedAt } from './exif';

export interface UploadFotoResult {
  path: string;
  capturadaEm: string;
}

/**
 * Comprime uma imagem no cliente mantendo a proporção, tratando a rotação nativa (createImageBitmap / fallback HEIC)
 * e gravando um carimbo d'água de data, hora e placa na imagem.
 */
export async function compressImage(
  fileOrBlob: File | Blob,
  maxDimension = 1600,
  quality = 0.75,
  carimboTexto?: string
): Promise<Blob> {
  const originalSize = fileOrBlob.size;

  let width = 0;
  let height = 0;
  let imageSource: CanvasImageSource | null = null;
  let closeImageSource: (() => void) | null = null;

  // 1. Tenta decodificação nativa com createImageBitmap ({ imageOrientation: 'from-image' })
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(fileOrBlob, {
        imageOrientation: 'from-image',
      });
      width = bitmap.width;
      height = bitmap.height;
      imageSource = bitmap;
      closeImageSource = () => bitmap.close();
    } catch (err) {
      console.warn('[compressImage]: createImageBitmap falhou (ex: HEIC no iPhone). Usando fallback Image.', err);
    }
  }

  // 2. Fallback gracioso usando HTMLImageElement
  if (!imageSource) {
    try {
      const img = await loadImageElement(fileOrBlob);
      width = img.width;
      height = img.height;
      imageSource = img;
    } catch (err) {
      console.warn('[compressImage]: Fallback HTMLImageElement falhou. Retornando imagem original.', err);
      return fileOrBlob;
    }
  }

  try {
    // 3. Regra de redimensionamento: NUNCA AMPLIAR se a imagem já for menor que o limite
    if (width > maxDimension || height > maxDimension) {
      if (width > height) {
        height = Math.round((height * maxDimension) / width);
        width = maxDimension;
      } else {
        width = Math.round((width * maxDimension) / height);
        height = maxDimension;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return fileOrBlob;
    }

    ctx.drawImage(imageSource, 0, 0, width, height);

    // 4. Carimbo d'água desenhado no Canvas REDIMENSIONADO (após o resize)
    if (carimboTexto) {
      const fontSize = Math.max(14, Math.round(width * 0.022));
      ctx.font = `bold ${fontSize}px "Courier New", monospace`;
      const paddingX = Math.round(fontSize * 0.8);
      const paddingY = Math.round(fontSize * 0.5);
      const textMetrics = ctx.measureText(carimboTexto);
      const textWidth = textMetrics.width;
      const boxWidth = textWidth + paddingX * 2;
      const boxHeight = fontSize + paddingY * 2;
      const boxX = width - boxWidth - Math.round(fontSize * 0.8);
      const boxY = height - boxHeight - Math.round(fontSize * 0.8);

      // Faixa escura semitransparente
      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

      // Texto em branco contrastante
      ctx.fillStyle = '#FFFFFF';
      ctx.textBaseline = 'middle';
      ctx.fillText(carimboTexto, boxX + paddingX, boxY + boxHeight / 2);
    }

    const compressedBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
    });

    if (!compressedBlob) {
      return fileOrBlob;
    }

    // 5. Comparação de Tamanho: Se o comprimido for MAIOR que o original, descarta e envia o original
    if (compressedBlob.size >= originalSize) {
      console.info(`[compressImage]: Imagem já otimizada (original: ${originalSize}b <= comprimido: ${compressedBlob.size}b). Mantendo original.`);
      return fileOrBlob;
    }

    return compressedBlob;
  } finally {
    if (closeImageSource) {
      closeImageSource();
    }
  }
}

function loadImageElement(fileOrBlob: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(fileOrBlob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

/**
 * Faz upload de uma foto de vistoria ou assinatura para o bucket privado `evidencias`.
 * Retorna o path no bucket e o timestamp de captura original lido do EXIF.
 */
export async function uploadEvidenciaFoto(
  tenantId: string,
  checkinId: string,
  fileOrBlob: File | Blob,
  isSignature = false,
  placaVeiculo?: string
): Promise<UploadFotoResult> {
  let blobToUpload: Blob;
  let capturadaEm = new Date().toISOString();

  if (fileOrBlob instanceof File && !isSignature) {
    capturadaEm = await extractExifCapturedAt(fileOrBlob);
  }

  if (isSignature) {
    // Assinatura PNG mantida byte-a-byte intacta sem compressão nem carimbo
    blobToUpload = fileOrBlob;
  } else {
    const dataHoraAtual = formatarDataHora(new Date().toISOString());
    const carimbo = placaVeiculo ? `${dataHoraAtual} · ${placaVeiculo.toUpperCase()}` : dataHoraAtual;
    blobToUpload = await compressImage(fileOrBlob, 1600, 0.75, carimbo);
  }

  const fileExt = isSignature ? 'png' : 'jpg';
  const fileName = isSignature ? 'assinatura.png' : `${gerarId()}.${fileExt}`;
  const filePath = `${tenantId}/checkins/${checkinId}/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from('evidencias')
    .upload(filePath, blobToUpload, {
      upsert: true,
      contentType: isSignature ? 'image/png' : 'image/jpeg',
    });

  if (uploadError) {
    throw new Error(`Erro ao enviar foto para o bucket privado: ${uploadError.message}`);
  }

  return { path: filePath, capturadaEm };
}

/**
 * Faz upload de uma foto de execução de serviço para o bucket privado `evidencias`.
 * Path: {tenant_id}/execucoes/{execucao_id}/{uuid}.jpg
 */
export async function uploadExecucaoFoto(
  tenantId: string,
  execucaoId: string,
  fileOrBlob: File | Blob,
  placaVeiculo?: string
): Promise<UploadFotoResult> {
  let capturadaEm = new Date().toISOString();
  if (fileOrBlob instanceof File) {
    capturadaEm = await extractExifCapturedAt(fileOrBlob);
  }

  const dataHoraAtual = formatarDataHora(new Date().toISOString());
  const carimbo = placaVeiculo ? `${dataHoraAtual} · ${placaVeiculo.toUpperCase()}` : dataHoraAtual;
  const blobToUpload = await compressImage(fileOrBlob, 1600, 0.75, carimbo);

  const fileName = `${gerarId()}.jpg`;
  const filePath = `${tenantId}/execucoes/${execucaoId}/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from('evidencias')
    .upload(filePath, blobToUpload, {
      upsert: true,
      contentType: 'image/jpeg',
    });

  if (uploadError) {
    throw new Error(`Erro ao enviar foto de execução para o bucket: ${uploadError.message}`);
  }

  return { path: filePath, capturadaEm };
}

/**
 * Faz upload de uma foto de avaliação ou assinatura para o orçamento no bucket privado `evidencias`.
 * Path: {tenant_id}/orcamentos/{orcamento_id}/{uuid}.jpg
 */
export async function uploadOrcamentoFoto(
  tenantId: string,
  orcamentoId: string,
  fileOrBlob: File | Blob,
  isSignature = false,
  placaVeiculo?: string
): Promise<UploadFotoResult> {
  let capturadaEm = new Date().toISOString();
  if (fileOrBlob instanceof File && !isSignature) {
    capturadaEm = await extractExifCapturedAt(fileOrBlob);
  }

  let blobToUpload: Blob;
  if (isSignature) {
    blobToUpload = fileOrBlob;
  } else {
    const dataHoraAtual = formatarDataHora(new Date().toISOString());
    const carimbo = placaVeiculo ? `${dataHoraAtual} · ${placaVeiculo.toUpperCase()}` : dataHoraAtual;
    blobToUpload = await compressImage(fileOrBlob, 1600, 0.75, carimbo);
  }

  const fileExt = isSignature ? 'png' : 'jpg';
  const fileName = isSignature ? `assinatura_${gerarId().slice(0, 8)}.png` : `${gerarId()}.${fileExt}`;
  const filePath = `${tenantId}/orcamentos/${orcamentoId}/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from('evidencias')
    .upload(filePath, blobToUpload, {
      upsert: true,
      contentType: isSignature ? 'image/png' : 'image/jpeg',
    });

  if (uploadError) {
    throw new Error(`Erro ao enviar foto do orçamento: ${uploadError.message}`);
  }

  return { path: filePath, capturadaEm };
}

/**
 * Gera uma URL assinada temporária para visualizar arquivos do bucket privado `evidencias`.
 */
export async function getEvidenciaSignedUrl(
  path: string,
  expiresInSeconds = 3600
): Promise<string> {
  if (!path) return '';

  const { data, error } = await supabase.storage
    .from('evidencias')
    .createSignedUrl(path, expiresInSeconds);

  if (error || !data?.signedUrl) {
    console.error('[Evidencias Signed URL Error]:', error);
    return '';
  }

  return data.signedUrl;
}

/**
 * Baixa uma imagem pela URL assinada e a converte para Base64 usando FileReader.
 */
export async function fetchImageAsBase64(url: string): Promise<string> {
  if (!url) return '';
  const response = await fetch(url);
  const blob = await response.blob();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Erro ao converter imagem para Base64.'));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Obtém a imagem da assinatura em Base64 para ser incorporada no PDF de vistoria.
 * Suporta assinaturas remotas (data:image/png;base64,...) e presenciais (caminhos no Storage evidencias).
 */
export async function obterAssinaturaBase64(pathOrData: string): Promise<string> {
  if (!pathOrData) return '';

  // Se já for data URL base64 (aceite remoto por link)
  if (pathOrData.startsWith('data:')) {
    return pathOrData;
  }

  try {
    // Download direto do blob do Supabase Storage
    const { data: blob, error } = await supabase.storage
      .from('evidencias')
      .download(pathOrData);

    if (error || !blob) {
      // Fallback via Signed URL caso o download direto falhe
      const signedUrl = await getEvidenciaSignedUrl(pathOrData);
      if (signedUrl) {
        return await fetchImageAsBase64(signedUrl);
      }
      console.error('[obterAssinaturaBase64 Storage Error]:', error);
      return '';
    }

    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          resolve('');
        }
      };
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.error('[obterAssinaturaBase64 Exception]:', err);
    return '';
  }
}

