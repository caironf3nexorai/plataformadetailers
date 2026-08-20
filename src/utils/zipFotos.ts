import { getEvidenciaSignedUrl } from './evidencias';

interface FotoItem {
  id: string;
  path: string;
  momento?: string;
  descricao?: string;
  created_at?: string;
}

/**
 * Baixa fotos de um atendimento a partir de caminhos no bucket evidencias (usando URLs assinadas)
 * e gera o download de um arquivo .zip contendo todas as fotos.
 */
export async function downloadFotosAtendimentoZip(
  placa: string,
  execucaoId: string,
  fotos: FotoItem[]
): Promise<void> {
  if (!fotos || fotos.length === 0) {
    throw new Error('Nenhuma foto para baixar neste atendimento.');
  }

  const fileEntries: { filename: string; data: Uint8Array }[] = [];

  for (let i = 0; i < fotos.length; i++) {
    const foto = fotos[i];
    const signedUrl = await getEvidenciaSignedUrl(foto.path, 300);
    if (!signedUrl) continue;

    const res = await fetch(signedUrl);
    if (!res.ok) continue;

    const buffer = await res.arrayBuffer();
    const data = new Uint8Array(buffer);

    const momentoStr = foto.momento ? `-${foto.momento}` : '';
    const numStr = String(i + 1).padStart(2, '0');
    const filename = `${placa || 'veiculo'}${momentoStr}-${numStr}.jpg`;

    fileEntries.push({ filename, data });
  }

  if (fileEntries.length === 0) {
    throw new Error('Não foi possível obter os arquivos das fotos para gerar o ZIP.');
  }

  // Constrói arquivo ZIP binário (formato Store / sem compressão)
  const zipBlob = buildZipBlob(fileEntries);

  const cleanPlaca = (placa || 'atendimento').replace(/[^a-zA-Z0-9]/g, '-').toUpperCase();
  const zipFilename = `FOTOS-${cleanPlaca}-${execucaoId.substring(0, 8)}.zip`;

  // Dispara o download no navegador
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = zipFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Gerador leve de arquivo ZIP (formato Store - 0x0000) sem dependências externas.
 */
function buildZipBlob(files: { filename: string; data: Uint8Array }[]): Blob {
  const parts: Uint8Array[] = [];
  const centralDirectoryHeaders: Uint8Array[] = [];
  let currentOffset = 0;

  const encoder = new TextEncoder();

  for (const file of files) {
    const filenameBytes = encoder.encode(file.filename);
    const crc32Val = calculateCRC32(file.data);
    const uncompressedSize = file.data.length;
    const compressedSize = uncompressedSize;

    // 1. Local File Header (30 bytes + filename)
    const localHeader = new Uint8Array(30 + filenameBytes.length);
    const lView = new DataView(localHeader.buffer);

    lView.setUint32(0, 0x04034b50, true); // Signatura local header
    lView.setUint16(4, 20, true); // Versão necessária
    lView.setUint16(6, 0, true); // Bit flags
    lView.setUint16(8, 0, true); // Método de compressão (0 = Store)
    lView.setUint16(10, 0, true); // Hora dos MS-DOS
    lView.setUint16(12, 0, true); // Data MS-DOS
    lView.setUint32(14, crc32Val, true); // CRC-32
    lView.setUint32(18, compressedSize, true); // Tamanho comprimido
    lView.setUint32(22, uncompressedSize, true); // Tamanho não comprimido
    lView.setUint16(26, filenameBytes.length, true); // Tamanho do nome do arquivo
    lView.setUint16(28, 0, true); // Tamanho do campo extra

    localHeader.set(filenameBytes, 30);

    parts.push(localHeader);
    parts.push(file.data);

    // 2. Central Directory Header (46 bytes + filename)
    const cdHeader = new Uint8Array(46 + filenameBytes.length);
    const cView = new DataView(cdHeader.buffer);

    cView.setUint32(0, 0x02014b50, true); // Signatura central directory
    cView.setUint16(4, 20, true); // Versão feita por
    cView.setUint16(6, 20, true); // Versão necessária
    cView.setUint16(8, 0, true); // Bit flags
    cView.setUint16(10, 0, true); // Método de compressão
    cView.setUint16(12, 0, true); // Hora
    cView.setUint16(14, 0, true); // Data
    cView.setUint32(16, crc32Val, true); // CRC-32
    cView.setUint32(20, compressedSize, true);
    cView.setUint32(24, uncompressedSize, true);
    cView.setUint16(28, filenameBytes.length, true);
    cView.setUint16(30, 0, true); // Extra field length
    cView.setUint16(32, 0, true); // Comment length
    cView.setUint16(34, 0, true); // Disk number start
    cView.setUint16(36, 0, true); // Internal file attributes
    cView.setUint32(38, 0, true); // External file attributes
    cView.setUint32(42, currentOffset, true); // Offset do Local Header

    cdHeader.set(filenameBytes, 46);
    centralDirectoryHeaders.push(cdHeader);

    currentOffset += localHeader.length + file.data.length;
  }

  const cdOffset = currentOffset;
  let cdSize = 0;

  for (const cdHeader of centralDirectoryHeaders) {
    parts.push(cdHeader);
    cdSize += cdHeader.length;
  }

  // 3. End of Central Directory Record (22 bytes)
  const eocd = new Uint8Array(22);
  const eView = new DataView(eocd.buffer);

  eView.setUint32(0, 0x06054b50, true); // Signatura EOCD
  eView.setUint16(4, 0, true); // Número do disco
  eView.setUint16(6, 0, true); // Disco onde o Central Directory inicia
  eView.setUint16(8, files.length, true); // Registros neste disco
  eView.setUint16(10, files.length, true); // Total de registros
  eView.setUint32(12, cdSize, true); // Tamanho do Central Directory
  eView.setUint32(16, cdOffset, true); // Offset do Central Directory
  eView.setUint16(20, 0, true); // Tamanho do comentário ZIP

  parts.push(eocd);

  return new Blob(parts as BlobPart[], { type: 'application/zip' });
}

/**
 * Tabela e cálculo de CRC-32 standard para checksum no ZIP.
 */
let crcTable: Uint32Array | null = null;

function calculateCRC32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[i] = c;
    }
  }

  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}
