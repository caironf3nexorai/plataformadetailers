/**
 * Parser de metadados EXIF para extração da data de captura original da foto (DateTimeOriginal).
 * Interpreta a string "YYYY:MM:DD HH:MM:SS" como fuso horário local do dispositivo antes de converter para ISO string.
 */
export async function extractExifCapturedAt(file: File): Promise<string> {
  const fallbackDate = file.lastModified
    ? new Date(file.lastModified).toISOString()
    : new Date().toISOString();

  if (!file || file.type !== 'image/jpeg') {
    return fallbackDate;
  }

  try {
    // Lê os primeiros 128KB do arquivo para encontrar os blocos APP1/EXIF
    const buffer = await readFileSliceAsArrayBuffer(file, 0, 131072);
    const view = new DataView(buffer);

    if (view.getUint16(0, false) !== 0xffd8) {
      // Não é um arquivo JPEG válido
      return fallbackDate;
    }

    let offset = 2;
    const length = view.byteLength;

    while (offset < length - 2) {
      const marker = view.getUint16(offset, false);
      offset += 2;

      if (marker === 0xffe1) {
        // Marcador APP1 encontrado
        const exifHeader = getASCIIString(view, offset + 2, 4);

        if (exifHeader === 'Exif') {
          const tiffHeaderOffset = offset + 8;
          const isLittleEndian = view.getUint16(tiffHeaderOffset, false) === 0x4949;

          const dateStr = parseIFDForDate(view, tiffHeaderOffset, isLittleEndian);
          if (dateStr) {
            const parsedIso = parseExifDateToLocalIso(dateStr);
            if (parsedIso) return parsedIso;
          }
        }
        break;
      } else if ((marker & 0xff00) === 0xff00) {
        const sectionLength = view.getUint16(offset, false);
        offset += sectionLength;
      } else {
        break;
      }
    }
  } catch (err) {
    console.warn('[EXIF Parse Error]: Fallback para data de modificação/atual.', err);
  }

  return fallbackDate;
}

function readFileSliceAsArrayBuffer(file: File, start: number, end: number): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const slice = file.slice(start, end);
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(slice);
  });
}

function getASCIIString(view: DataView, offset: number, length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    const code = view.getUint8(offset + i);
    if (code === 0) break;
    result += String.fromCharCode(code);
  }
  return result;
}

function parseIFDForDate(view: DataView, tiffHeaderOffset: number, isLittleEndian: boolean): string | null {
  try {
    const firstIFDOffset = view.getUint32(tiffHeaderOffset + 4, isLittleEndian);
    let currentIFD = tiffHeaderOffset + firstIFDOffset;

    let dateStr = searchEntriesForDate(view, currentIFD, tiffHeaderOffset, isLittleEndian);
    if (dateStr) return dateStr;

    // Procura por ponteiro EXIF SubIFD (tag 0x8769)
    const entriesCount = view.getUint16(currentIFD, isLittleEndian);
    for (let i = 0; i < entriesCount; i++) {
      const entryOffset = currentIFD + 2 + i * 12;
      const tag = view.getUint16(entryOffset, isLittleEndian);
      if (tag === 0x8769) {
        const subIFDOffset = view.getUint32(entryOffset + 8, isLittleEndian);
        const subIFDPos = tiffHeaderOffset + subIFDOffset;
        dateStr = searchEntriesForDate(view, subIFDPos, tiffHeaderOffset, isLittleEndian);
        if (dateStr) return dateStr;
      }
    }
  } catch (e) {
    // Ignora estouro de limites do DataView
  }
  return null;
}

function searchEntriesForDate(view: DataView, ifdOffset: number, tiffHeaderOffset: number, isLittleEndian: boolean): string | null {
  if (ifdOffset + 2 > view.byteLength) return null;
  const entriesCount = view.getUint16(ifdOffset, isLittleEndian);

  for (let i = 0; i < entriesCount; i++) {
    const entryOffset = ifdOffset + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength) break;

    const tag = view.getUint16(entryOffset, isLittleEndian);

    // Tag 0x9003 = DateTimeOriginal, Tag 0x0132 = DateTime
    if (tag === 0x9003 || tag === 0x0132) {
      const valueOffset = view.getUint32(entryOffset + 8, isLittleEndian);
      const strPos = tiffHeaderOffset + valueOffset;
      if (strPos + 19 <= view.byteLength) {
        const rawStr = getASCIIString(view, strPos, 19);
        if (rawStr && rawStr.length >= 19) {
          return rawStr;
        }
      }
    }
  }
  return null;
}

/**
 * Converte a string "YYYY:MM:DD HH:MM:SS" em um objeto Date considerando o FUSO HORÁRIO LOCAL do dispositivo.
 */
function parseExifDateToLocalIso(exifDateStr: string): string | null {
  // Exemplo: "2026:08:19 14:30:00"
  const regex = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/;
  const match = exifDateStr.match(regex);
  if (!match) return null;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1; // 0-indexed no JS
  const day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);
  const second = parseInt(match[6], 10);

  // Instancia a data como horário LOCAL do navegador
  const localDate = new Date(year, month, day, hour, minute, second);
  if (isNaN(localDate.getTime())) return null;

  return localDate.toISOString();
}
