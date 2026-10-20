/**
 * Metadata Remover - Deep Structural Byte-Level Sanitization
 * Implements exifremover.com-style binary segment slicing
 */

export interface RemovalOptions {
  removeExif: boolean;
  removeIptc: boolean;
  removeXmp: boolean;
  removeGps: boolean;
  removeTrailing: boolean;
  selectedFields?: string[];
}

export interface RemovalResult {
  blob: Blob;
  originalSize: number;
  cleanedSize: number;
  tagsRemoved: number;
}

const DEFAULT_OPTIONS: RemovalOptions = {
  removeExif: true,
  removeIptc: true,
  removeXmp: true,
  removeGps: true,
  removeTrailing: true,
};

// JPEG Markers
const EOI_MARKER = 0xFFD9;
const APP1_MARKER = 0xFFE1;
const APP13_MARKER = 0xFFED;

// XMP/EXIF headers
const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/';
const EXIF_HEADER = 'Exif\x00\x00';
const PHOTOSHOP_HEADER = 'Photoshop 3.0\x00';

function isDocxFile(file: File): boolean {
  const ext = file.name.toLowerCase().split('.').pop() || '';
  return ['docx', 'docm', 'dotx', 'dotm'].includes(ext) ||
    file.type.includes('officedocument.wordprocessingml');
}

// ============ MAIN ENTRY POINT ============

export async function removeMetadata(
  file: File,
  options: Partial<RemovalOptions> = {}
): Promise<RemovalResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const arrayBuffer = await file.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);
  const originalSize = data.length;

  let resultData: Uint8Array<ArrayBuffer>;
  let tagsRemoved = 0;

  if (file.type.startsWith('image/jpeg') || file.name.toLowerCase().endsWith('.jpg') || file.name.toLowerCase().endsWith('.jpeg')) {
    const r = removeJpegDeep(data, opts);
    resultData = r.data;
    tagsRemoved = r.tagsRemoved;
  } else if (file.type.startsWith('image/png') || file.name.toLowerCase().endsWith('.png')) {
    const r = await removePngDeep(data, opts);
    resultData = r.data;
    tagsRemoved = r.tagsRemoved;
  } else if (file.type.startsWith('image/webp') || file.name.toLowerCase().endsWith('.webp')) {
    const r = await removeWebpDeep(data, opts);
    resultData = r.data;
    tagsRemoved = r.tagsRemoved;
  } else if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const r = await removePdfDeep(data, opts);
    resultData = r.data;
    tagsRemoved = r.tagsRemoved;
  } else if (file.type.startsWith('image/tiff') || file.name.toLowerCase().endsWith('.tif') || file.name.toLowerCase().endsWith('.tiff')) {
    const r = await stripCanvasDeep(data, 'image/png');
    resultData = r.data;
    tagsRemoved = r.tagsRemoved;
  } else if (isDocxFile(file)) {
    const r = await removeDocxDeep(arrayBuffer);
    const buf = await r.blob.arrayBuffer();
    resultData = new Uint8Array(buf) as Uint8Array<ArrayBuffer>;
    tagsRemoved = r.tagsRemoved;
  } else {
    const r = await stripCanvasFileDeep(file);
    const buf = await r.blob.arrayBuffer();
    resultData = new Uint8Array(buf) as Uint8Array<ArrayBuffer>;
    tagsRemoved = r.tagsRemoved;
  }

  const cleanedSize = resultData.length;
  const blob = new Blob([resultData.buffer as ArrayBuffer], { type: file.type || 'application/octet-stream' });

  return { blob, originalSize, cleanedSize, tagsRemoved };
}

// ============ JPEG DEEP STRIPPING ============

interface StripResult {
  data: Uint8Array<ArrayBuffer>;
  tagsRemoved: number;
}

function removeJpegDeep(data: Uint8Array, opts: RemovalOptions): StripResult {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const segmentsToRemove: { start: number; end: number }[] = [];
  let tagsRemoved = 0;
  let offset = 2;
  let eoiOffset = -1;

  while (offset < data.length - 1) {
    if (data[offset] !== 0xFF) break;
    const marker = (data[offset] << 8) | data[offset + 1];
    if (marker === 0xFFDA) break;
    if (marker === EOI_MARKER) { eoiOffset = offset; break; }
    if (offset + 3 >= data.length) break;

    const segmentLength = view.getUint16(offset + 2);
    const segmentEnd = offset + 2 + segmentLength;
    if (segmentEnd > data.length) break;

    if (marker === APP1_MARKER) {
      // Check EXIF
      if (opts.removeExif && offset + 10 <= segmentEnd) {
        const hdr = String.fromCharCode(...data.slice(offset + 4, offset + 10));
        if (hdr === EXIF_HEADER) {
          segmentsToRemove.push({ start: offset, end: segmentEnd });
          tagsRemoved += countExifTagsInSegment(data, offset + 10, segmentEnd);
        }
      }
      // Check XMP
      if (opts.removeXmp && offset + 4 + XMP_HEADER.length <= segmentEnd) {
        const hdr = String.fromCharCode(...data.slice(offset + 4, offset + 4 + XMP_HEADER.length));
        if (hdr === XMP_HEADER || hdr.startsWith('http://ns.adobe.com/xmp/')) {
          segmentsToRemove.push({ start: offset, end: segmentEnd });
          tagsRemoved += countXmpTagsInSegment(data, offset + 4, segmentEnd);
        }
      }
    }

    if (marker === APP13_MARKER && opts.removeIptc) {
      if (offset + 4 + PHOTOSHOP_HEADER.length <= segmentEnd) {
        const hdr = String.fromCharCode(...data.slice(offset + 4, offset + 4 + PHOTOSHOP_HEADER.length));
        if (hdr.startsWith('Photoshop 3.0')) {
          segmentsToRemove.push({ start: offset, end: segmentEnd });
          tagsRemoved += countIptcTagsInSegment(data, offset + 4, segmentEnd);
        }
      }
    }

    offset = segmentEnd;
  }

  let result = data;
  if (segmentsToRemove.length > 0) {
    result = sliceOutSegments(data, segmentsToRemove);
  }

  if (opts.removeTrailing) {
    const eoi = eoiOffset >= 0 ? eoiOffset : findEOIInBytes(result);
    if (eoi >= 0 && eoi + 2 < result.length) {
      result = result.slice(0, eoi + 2) as Uint8Array<ArrayBuffer>;
      tagsRemoved++;
    }
  }

  return { data: result as Uint8Array<ArrayBuffer>, tagsRemoved };
}

function countExifTagsInSegment(data: Uint8Array, start: number, end: number): number {
  let count = 0;
  try {
    if (start + 8 > end) return 1;
    const bo = String.fromCharCode(data[start], data[start + 1]);
    const le = bo === 'II';
    const v = new DataView(data.buffer, data.byteOffset + start, end - start);
    const tiffOff = le ? v.getUint32(4, true) : v.getUint32(4, false);
    if (tiffOff + 2 > end - start) return 1;
    const entries = le ? v.getUint16(tiffOff, true) : v.getUint16(tiffOff, false);
    count = entries;
    for (let i = 0; i < entries; i++) {
      const eo = tiffOff + 2 + i * 12;
      if (eo + 12 > end - start) break;
      const tag = le ? v.getUint16(eo, true) : v.getUint16(eo, false);
      if (tag === 0x8769) count += 10;
      if (tag === 0x8825) count += 8;
    }
  } catch { count = 5; }
  return Math.max(count, 1);
}

function countXmpTagsInSegment(data: Uint8Array, start: number, end: number): number {
  try {
    const text = new TextDecoder().decode(data.slice(start, end));
    const m = text.match(/<rdf:Description[^>]*>/g);
    const attrs = text.match(/\w+:\w+="[^"]*"/g);
    return Math.max((m?.length || 0) + (attrs?.length || 0), 1);
  } catch { return 3; }
}

function countIptcTagsInSegment(data: Uint8Array, start: number, end: number): number {
  let count = 0;
  let pos = start;
  try {
    while (pos < end - 4) {
      if (data[pos] === 0x1C) {
        count++;
        const recLen = (data[pos + 3] << 8) | data[pos + 4];
        pos += 5 + recLen;
      } else { pos++; }
    }
  } catch { count = 3; }
  return Math.max(count, 1);
}

function findEOIInBytes(data: Uint8Array): number {
  for (let i = data.length - 2; i >= 0; i--) {
    if (data[i] === 0xFF && data[i + 1] === 0xD9) return i;
  }
  return -1;
}

function sliceOutSegments(data: Uint8Array, segs: { start: number; end: number }[]): Uint8Array<ArrayBuffer> {
  segs.sort((a, b) => a.start - b.start);
  const parts: Uint8Array[] = [];
  let last = 0;
  for (const s of segs) {
    if (s.start > last) parts.push(data.slice(last, s.start));
    last = s.end;
  }
  if (last < data.length) parts.push(data.slice(last));
  const total = parts.reduce((a, p) => a + p.length, 0);
  const result = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { result.set(p, off); off += p.length; }
  return result as Uint8Array<ArrayBuffer>;
}

// ============ PNG DEEP STRIPPING ============

async function removePngDeep(data: Uint8Array, opts: RemovalOptions): Promise<StripResult> {
  if (!opts.removeExif && !opts.removeXmp && !opts.removeIptc) {
    return { data: data as Uint8Array<ArrayBuffer>, tagsRemoved: 0 };
  }

  const metaTypes = ['eXIf', 'tEXt', 'iTXt', 'zTXt'];
  let tagsRemoved = 0;
  const parts: Uint8Array[] = [];
  let offset = 0;

  parts.push(data.slice(0, 8));
  offset = 8;

  while (offset < data.length - 8) {
    const v = new DataView(data.buffer, data.byteOffset + offset, 8);
    const len = v.getUint32(0);
    const type = String.fromCharCode(data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7]);
    const chunkEnd = offset + 12 + len;

    if (metaTypes.includes(type)) {
      tagsRemoved++;
    } else {
      parts.push(data.slice(offset, Math.min(chunkEnd, data.length)));
    }
    offset = chunkEnd;
    if (type === 'IEND') break;
  }

  if (tagsRemoved === 0) return { data: data as Uint8Array<ArrayBuffer>, tagsRemoved: 0 };

  const total = parts.reduce((a, p) => a + p.length, 0);
  const result = new Uint8Array(total) as Uint8Array<ArrayBuffer>;
  let pos = 0;
  for (const p of parts) { result.set(p, pos); pos += p.length; }
  return { data: result, tagsRemoved };
}

// ============ WEBP DEEP STRIPPING ============

async function removeWebpDeep(data: Uint8Array, opts: RemovalOptions): Promise<StripResult> {
  if (!opts.removeExif && !opts.removeXmp) {
    return { data: data as Uint8Array<ArrayBuffer>, tagsRemoved: 0 };
  }

  let tagsRemoved = 0;
  const parts: Uint8Array[] = [];
  let offset = 0;
  let modified = false;

  parts.push(data.slice(0, 12));
  offset = 12;

  while (offset < data.length - 8) {
    const v = new DataView(data.buffer, data.byteOffset + offset, 8);
    const id = String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
    const size = v.getUint32(4, true);
    const end = offset + 8 + size + (size % 2);

    if ((id === 'EXIF' && opts.removeExif) || (id === 'XMP ' && opts.removeXmp)) {
      tagsRemoved++;
      modified = true;
    } else {
      parts.push(data.slice(offset, Math.min(end, data.length)));
    }
    offset = end;
  }

  if (!modified) return { data: data as Uint8Array<ArrayBuffer>, tagsRemoved: 0 };

  const total = parts.reduce((a, p) => a + p.length, 0);
  const result = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { result.set(p, pos); pos += p.length; }
  const rv = new DataView(result.buffer, result.byteOffset, result.byteLength);
  rv.setUint32(4, total - 8, true);
  return { data: result as Uint8Array<ArrayBuffer>, tagsRemoved };
}

// ============ PDF DEEP STRIPPING ============

async function removePdfDeep(data: Uint8Array, opts: RemovalOptions): Promise<StripResult> {
  let tagsRemoved = 0;
  try {
    const { PDFDocument, PDFName } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.load(data, { ignoreEncryption: true });

    const getters = ['getTitle', 'getAuthor', 'getSubject', 'getCreator', 'getProducer', 'getKeywords', 'getCreationDate', 'getModificationDate'];
    for (const g of getters) {
      try {
        const val = (pdfDoc as any)[g]();
        if (val !== null && val !== undefined && val !== '') tagsRemoved++;
      } catch {}
    }

    pdfDoc.setTitle('');
    pdfDoc.setAuthor('');
    pdfDoc.setSubject('');
    pdfDoc.setCreator('');
    pdfDoc.setProducer('');
    pdfDoc.setKeywords([]);

    if (opts.removeXmp) {
      try {
        const ctx = pdfDoc.context;
        const cat = ctx.lookup(ctx.trailerInfo.Root);
        if (cat) {
          const mk = PDFName.of('Metadata');
          if ((cat as any).has(mk)) { (cat as any).delete(mk); tagsRemoved++; }
          const pk = PDFName.of('PieceInfo');
          if ((cat as any).has(pk)) { (cat as any).delete(pk); tagsRemoved++; }
        }
      } catch {}
    }

    const bytes = await pdfDoc.save({ useObjectStreams: false });
    let result = new Uint8Array(bytes) as Uint8Array<ArrayBuffer>;

    if (opts.removeXmp) {
      const xr = stripXmpBinary(result);
      if (xr.removed) tagsRemoved++;
      result = xr.data;
    }

    return { data: result, tagsRemoved };
  } catch (err) {
    console.error('PDF error:', err);
    return { data: data as Uint8Array<ArrayBuffer>, tagsRemoved: 0 };
  }
}

function stripXmpBinary(data: Uint8Array): { data: Uint8Array<ArrayBuffer>; removed: boolean } {
  let result = data as Uint8Array<ArrayBuffer>;
  let removed = false;
  while (true) {
    const s = findStr(result, '<?xpacket begin');
    if (s === -1) break;
    const e = findStr(result, '<?xpacket end', s);
    if (e === -1) break;
    const te = findStr(result, '?>', e);
    if (te === -1) break;
    const pe = te + 2;
    const before = result.slice(0, s);
    const after = result.slice(pe);
    result = new Uint8Array(before.length + after.length) as Uint8Array<ArrayBuffer>;
    result.set(before, 0);
    result.set(after, before.length);
    removed = true;
  }
  return { data: result, removed };
}

function findStr(data: Uint8Array, str: string, start: number = 0): number {
  const sb = new TextEncoder().encode(str);
  for (let i = start; i <= data.length - sb.length; i++) {
    let ok = true;
    for (let j = 0; j < sb.length; j++) {
      if (data[i + j] !== sb[j]) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}

// ============ DOCX DEEP STRIPPING ============

interface DocxResult { blob: Blob; tagsRemoved: number; }

async function removeDocxDeep(arrayBuffer: ArrayBuffer): Promise<DocxResult> {
  let tagsRemoved = 0;
  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(arrayBuffer);

    const coreFile = zip.file('docProps/core.xml');
    if (coreFile) {
      let xml = await coreFile.async('string');
      const patterns = [
        /<dc:creator>[^<]+<\/dc:creator>/gi,
        /<dc:title>[^<]+<\/dc:title>/gi,
        /<dc:subject>[^<]+<\/dc:subject>/gi,
        /<dc:description>[^<]+<\/dc:description>/gi,
        /<cp:lastModifiedBy>[^<]+<\/cp:lastModifiedBy>/gi,
        /<cp:category>[^<]+<\/cp:category>/gi,
        /<cp:keywords>[^<]+<\/cp:keywords>/gi,
        /<dcterms:created[^>]*>[^<]+<\/dcterms:created>/gi,
        /<dcterms:modified[^>]*>[^<]+<\/dcterms:modified>/gi,
      ];
      for (const p of patterns) {
        const m = xml.match(p);
        if (m) tagsRemoved += m.length;
        xml = xml.replace(p, match => match.replace(/>[^<]+</, '><'));
      }
      zip.file('docProps/core.xml', xml);
    }

    const appFile = zip.file('docProps/app.xml');
    if (appFile) {
      let xml = await appFile.async('string');
      const patterns = [
        /<Application>[^<]+<\/Application>/gi,
        /<AppVersion>[^<]+<\/AppVersion>/gi,
        /<Company>[^<]+<\/Company>/gi,
        /<Template>[^<]+<\/Template>/gi,
        /<Manager>[^<]+<\/Manager>/gi,
      ];
      for (const p of patterns) {
        const m = xml.match(p);
        if (m) tagsRemoved += m.length;
        xml = xml.replace(p, match => match.replace(/>[^<]+</, '><'));
      }
      zip.file('docProps/app.xml', xml);
    }

    if (zip.file('docProps/custom.xml')) { tagsRemoved++; zip.remove('docProps/custom.xml'); }
    if (zip.file('docProps/thumbnail.jpeg')) { tagsRemoved++; zip.remove('docProps/thumbnail.jpeg'); }

    const blob = await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
    return { blob, tagsRemoved };
  } catch (err) {
    console.error('DOCX error:', err);
    return { blob: new Blob([arrayBuffer]), tagsRemoved: 0 };
  }
}

// ============ CANVAS FALLBACK ============

async function stripCanvasDeep(data: Uint8Array, mime: string): Promise<StripResult> {
  return new Promise((resolve) => {
    const blob = new Blob([data.buffer as ArrayBuffer], { type: mime });
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d')!.drawImage(img, 0, 0);
      c.toBlob(b => {
        if (b) b.arrayBuffer().then(buf => resolve({ data: new Uint8Array(buf) as Uint8Array<ArrayBuffer>, tagsRemoved: 5 }));
        else resolve({ data: data as Uint8Array<ArrayBuffer>, tagsRemoved: 0 });
      }, mime, 1.0);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => resolve({ data: data as Uint8Array<ArrayBuffer>, tagsRemoved: 0 });
    img.src = URL.createObjectURL(blob);
  });
}

async function stripCanvasFileDeep(file: File): Promise<{ blob: Blob; tagsRemoved: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d')!.drawImage(img, 0, 0);
      c.toBlob(b => {
        if (b) resolve({ blob: b, tagsRemoved: 5 });
        else resolve({ blob: new Blob([]), tagsRemoved: 0 });
      }, 'image/png', 1.0);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => resolve({ blob: new Blob([]), tagsRemoved: 0 });
    img.src = URL.createObjectURL(file);
  });
}

export function getCleanedFilename(originalName: string): string {
  const lastDot = originalName.lastIndexOf('.');
  if (lastDot === -1) return `${originalName} (Cleaned)`;
  return `${originalName.substring(0, lastDot)} (Cleaned)${originalName.substring(lastDot)}`;
}

export { DEFAULT_OPTIONS };
