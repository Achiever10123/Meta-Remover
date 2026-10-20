/**
 * Metadata Remover - Implements 3 core developer protocols:
 * 1. Hard-Wipe XMP App1 Segment
 * 2. Nullify IPTC App13 Segment
 * 3. Clear File Structure Padding (Trailing Data)
 */

export interface RemovalOptions {
  removeExif: boolean;
  removeIptc: boolean;
  removeXmp: boolean;
  removeGps: boolean;
  removeTrailing: boolean;
  selectedFields?: string[];
}

const DEFAULT_OPTIONS: RemovalOptions = {
  removeExif: true,
  removeIptc: true,
  removeXmp: true,
  removeGps: true,
  removeTrailing: true,
};

// JPEG Markers
const SOI_MARKER = 0xFFD8;
const EOI_MARKER = 0xFFD9;
const APP0_MARKER = 0xFFE0;
const APP1_MARKER = 0xFFE1;
const APP13_MARKER = 0xFFED;

// XMP namespace identifiers
const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/';
const XMP_EXTENDED_HEADER = 'http://ns.adobe.com/xmp/extension/';
const EXIF_HEADER = 'Exif\x00\x00';

// IPTC/Photoshop markers
const PHOTOSHOP_HEADER = 'Photoshop 3.0\x00';

export async function removeMetadata(
  file: File,
  options: Partial<RemovalOptions> = {}
): Promise<Blob> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const arrayBuffer = await file.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);

  if (file.type.startsWith('image/jpeg') || file.name.toLowerCase().endsWith('.jpg') || file.name.toLowerCase().endsWith('.jpeg')) {
    return removeJpegMetadata(data, opts);
  } else if (file.type.startsWith('image/png') || file.name.toLowerCase().endsWith('.png')) {
    return removePngMetadata(data, opts);
  } else if (file.type.startsWith('image/webp') || file.name.toLowerCase().endsWith('.webp')) {
    return removeWebpMetadata(data, opts);
  } else if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    return removePdfMetadata(data, opts);
  } else if (file.type.startsWith('image/tiff') || file.name.toLowerCase().endsWith('.tif') || file.name.toLowerCase().endsWith('.tiff')) {
    return removeTiffMetadata(data, opts);
  } else {
    // For other formats, attempt canvas-based strip
    return stripViaCanvas(file);
  }
}

async function removeJpegMetadata(data: Uint8Array, opts: RemovalOptions): Promise<Blob> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const segments: { start: number; end: number; type: string }[] = [];
  let offset = 2; // Skip SOI

  // Parse all segments
  while (offset < data.length - 1) {
    if (data[offset] !== 0xFF) break;

    const marker = (data[offset] << 8) | data[offset + 1];

    // SOS marker - stop parsing segments
    if (marker === 0xFFDA) break;

    // EOI marker
    if (marker === EOI_MARKER) {
      // Protocol 3: Check for trailing data after EOI
      if (opts.removeTrailing && offset + 2 < data.length) {
        // Truncate at EOI
        const truncated = data.slice(0, offset + 2);
        return new Blob([truncated], { type: 'image/jpeg' });
      }
      break;
    }

    if (offset + 3 >= data.length) break;

    const segmentLength = view.getUint16(offset + 2);
    const segmentEnd = offset + 2 + segmentLength;

    if (segmentEnd > data.length) break;

    // Protocol 1: XMP in APP1
    if (marker === APP1_MARKER && opts.removeXmp) {
      const headerBytes = data.slice(offset + 4, offset + 4 + XMP_HEADER.length);
      const headerStr = String.fromCharCode(...headerBytes);
      if (headerStr === XMP_HEADER || headerStr.startsWith(XMP_EXTENDED_HEADER)) {
        segments.push({ start: offset, end: segmentEnd, type: 'xmp' });
      }
    }

    // Protocol 2: IPTC in APP13
    if (marker === APP13_MARKER && opts.removeIptc) {
      const headerBytes = data.slice(offset + 4, offset + 4 + PHOTOSHOP_HEADER.length);
      const headerStr = String.fromCharCode(...headerBytes);
      if (headerStr.startsWith('Photoshop 3.0')) {
        segments.push({ start: offset, end: segmentEnd, type: 'iptc' });
      }
    }

    // EXIF in APP1
    if (marker === APP1_MARKER && opts.removeExif) {
      const headerBytes = data.slice(offset + 4, offset + 10);
      const headerStr = String.fromCharCode(...headerBytes);
      if (headerStr === EXIF_HEADER) {
        segments.push({ start: offset, end: segmentEnd, type: 'exif' });
      }
    }

    // Other APP markers to remove based on options
    if (marker >= 0xFFE0 && marker <= 0xFFEF) {
      // APP0 (JFIF) - keep
      // APP1 - handled above
      // APP2 (ICC Profile) - keep unless specified
      // APP13 - handled above
    }

    offset = segmentEnd;
  }

  // Protocol 3: Trailing data after EOI
  if (opts.removeTrailing) {
    // Find EOI marker
    for (let i = data.length - 2; i >= 2; i--) {
      if (data[i] === 0xFF && data[i + 1] === 0xD9) {
        if (i + 2 < data.length) {
          // There's data after EOI - truncate
          const result = buildCleanJpeg(data, segments);
          const truncated = result.slice(0, findEOI(result) + 2);
          return new Blob([truncated.buffer as ArrayBuffer], { type: 'image/jpeg' });
        }
        break;
      }
    }
  }

  // Build clean JPEG without marked segments
  const result = buildCleanJpeg(data, segments);
  return new Blob([result.buffer as ArrayBuffer], { type: 'image/jpeg' });
}

function findEOI(data: Uint8Array): number {
  for (let i = data.length - 2; i >= 0; i--) {
    if (data[i] === 0xFF && data[i + 1] === 0xD9) {
      return i;
    }
  }
  return data.length - 2;
}

function buildCleanJpeg(data: Uint8Array, segmentsToRemove: { start: number; end: number; type: string }[]): Uint8Array {
  if (segmentsToRemove.length === 0) return data;

  const parts: Uint8Array[] = [];
  let lastEnd = 0;

  // Sort segments by start position
  segmentsToRemove.sort((a, b) => a.start - b.start);

  for (const seg of segmentsToRemove) {
    // Add data before this segment
    if (seg.start > lastEnd) {
      parts.push(data.slice(lastEnd, seg.start));
    }
    lastEnd = seg.end;
  }

  // Add remaining data
  if (lastEnd < data.length) {
    parts.push(data.slice(lastEnd));
  }

  // Concatenate
  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}

async function removePngMetadata(data: Uint8Array, opts: RemovalOptions): Promise<Blob> {
  // PNG uses chunks, not JPEG markers
  // We'll use canvas to strip all metadata
  if (opts.removeExif || opts.removeXmp || opts.removeIptc) {
    return stripViaCanvasFromBuffer(data, 'image/png');
  }
  return new Blob([data.buffer as ArrayBuffer], { type: 'image/png' });
}

async function removeWebpMetadata(data: Uint8Array, opts: RemovalOptions): Promise<Blob> {
  // WebP metadata is in RIFF chunks
  // Use canvas approach for clean removal
  if (opts.removeExif || opts.removeXmp || opts.removeIptc) {
    return stripViaCanvasFromBuffer(data, 'image/webp');
  }
  return new Blob([data.buffer as ArrayBuffer], { type: 'image/webp' });
}

async function removeTiffMetadata(data: Uint8Array, opts: RemovalOptions): Promise<Blob> {
  // TIFF has IFD entries - complex to parse, use canvas
  return stripViaCanvasFromBuffer(data, 'image/tiff');
}

async function removePdfMetadata(data: Uint8Array, opts: RemovalOptions): Promise<Blob> {
  try {
    const { PDFDocument } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.load(data, { ignoreEncryption: true });

    // Remove all metadata fields
    pdfDoc.setTitle('');
    pdfDoc.setAuthor('');
    pdfDoc.setSubject('');
    pdfDoc.setCreator('');
    pdfDoc.setProducer('');
    pdfDoc.setKeywords([]);

    const cleanedBytes = await pdfDoc.save();
    return new Blob([cleanedBytes as unknown as BlobPart], { type: 'application/pdf' });
  } catch (err) {
    console.error('PDF metadata removal error:', err);
    return new Blob([data.buffer as ArrayBuffer], { type: 'application/pdf' });
  }
}

function stripViaCanvasFromBuffer(data: Uint8Array, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([data.buffer as ArrayBuffer], { type: mimeType });
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas toBlob failed'));
        },
        mimeType === 'image/tiff' ? 'image/png' : mimeType,
        1.0
      );
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = URL.createObjectURL(blob);
  });
}

function stripViaCanvas(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas toBlob failed'));
        },
        'image/png',
        1.0
      );
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = URL.createObjectURL(file);
  });
}

export function getCleanedFilename(originalName: string): string {
  const lastDot = originalName.lastIndexOf('.');
  if (lastDot === -1) return `${originalName} (Cleaned)`;
  const name = originalName.substring(0, lastDot);
  const ext = originalName.substring(lastDot);
  return `${name} (Cleaned)${ext}`;
}

export { DEFAULT_OPTIONS };
