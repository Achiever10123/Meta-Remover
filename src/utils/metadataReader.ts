import exifr from 'exifr';
import { PDFDocument } from 'pdf-lib';

export interface MetadataEntry {
  key: string;
  value: string | number | boolean | null;
  category: 'exif' | 'iptc' | 'xmp' | 'gps' | 'file' | 'pdf' | 'office';
  removable: boolean;
}

export interface FileMetadata {
  file: File;
  entries: MetadataEntry[];
  gps?: { latitude: number; longitude: number };
  thumbnail?: string;
  hasExif: boolean;
  hasIptc: boolean;
  hasXmp: boolean;
  fileSize: number;
  mimeType: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  exif: 'EXIF',
  iptc: 'IPTC',
  xmp: 'XMP',
  gps: 'GPS',
  file: 'File Info',
  pdf: 'PDF Metadata',
  office: 'Office Metadata',
};

export function getCategoryLabel(cat: string): string {
  return CATEGORY_LABELS[cat] || cat;
}

function isImage(file: File): boolean {
  return file.type.startsWith('image/');
}

function isPDF(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function isOffice(file: File): boolean {
  const ext = file.name.toLowerCase().split('.').pop() || '';
  return ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp'].includes(ext) ||
    file.type.includes('officedocument') ||
    file.type.includes('msword') ||
    file.type.includes('spreadsheet') ||
    file.type.includes('presentation');
}

async function readImageMetadata(file: File): Promise<FileMetadata> {
  const entries: MetadataEntry[] = [];
  let gps: { latitude: number; longitude: number } | undefined;
  let thumbnail: string | undefined;
  let hasExif = false, hasIptc = false, hasXmp = false;

  // File info
  entries.push({ key: 'File Name', value: file.name, category: 'file', removable: false });
  entries.push({ key: 'File Size', value: formatFileSize(file.size), category: 'file', removable: false });
  entries.push({ key: 'MIME Type', value: file.type, category: 'file', removable: false });
  entries.push({ key: 'Last Modified', value: new Date(file.lastModified).toISOString(), category: 'file', removable: false });

  try {
    // Read all EXIF data
    const exifData = await exifr.parse(file, {
      tiff: true,
      exif: true,
      gps: true,
      iptc: true,
      xmp: true,
      icc: true,
      jfif: true,
      ihdr: true,
    });

    if (exifData) {
      // GPS
      if (exifData.latitude && exifData.longitude) {
        gps = { latitude: exifData.latitude, longitude: exifData.longitude };
        entries.push({ key: 'GPS Latitude', value: exifData.latitude, category: 'gps', removable: true });
        entries.push({ key: 'GPS Longitude', value: exifData.longitude, category: 'gps', removable: true });
        hasExif = true;
      }

      // EXIF fields
      const exifFields = [
        'Make', 'Model', 'LensModel', 'Software', 'DateTime', 'DateTimeOriginal',
        'ExposureTime', 'FNumber', 'ISO', 'FocalLength', 'Flash', 'WhiteBalance',
        'ImageWidth', 'ImageHeight', 'Orientation', 'ColorSpace', 'BitsPerSample',
        'Compression', 'DigitalZoomRatio', 'SceneCaptureType', 'Contrast',
        'Saturation', 'Sharpness', 'SubjectDistanceRange', 'MeteringMode',
        'ExposureProgram', 'ExposureCompensation', 'MaxApertureValue',
        'ShutterSpeedValue', 'ApertureValue', 'BrightnessValue'
      ];

      for (const field of exifFields) {
        if (exifData[field] !== undefined && exifData[field] !== null) {
          hasExif = true;
          let displayValue = exifData[field];
          if (displayValue instanceof Date) {
            displayValue = displayValue.toISOString();
          }
          entries.push({
            key: formatKey(field),
            value: String(displayValue),
            category: 'exif',
            removable: true,
          });
        }
      }

      // IPTC fields
      const iptcFields = [
        'Caption', 'Headline', 'Credit', 'Source', 'Copyright',
        'Keywords', 'City', 'State', 'Country', 'Object_name',
        'SpecialInstructions', 'DateCreated', 'Author', 'CopyrightNotice'
      ];

      for (const field of iptcFields) {
        if (exifData[field] !== undefined && exifData[field] !== null) {
          hasIptc = true;
          entries.push({
            key: formatKey(field),
            value: Array.isArray(exifData[field]) ? exifData[field].join(', ') : String(exifData[field]),
            category: 'iptc',
            removable: true,
          });
        }
      }

      // XMP fields
      const xmpFields = [
        'CreatorTool', 'MetadataDate', 'ModifyDate', 'CreateDate',
        'Format', 'Description', 'Title', 'Rights', 'Creator',
        'Subject', 'Rating', 'Label', 'Marked', 'WebStatement'
      ];

      for (const field of xmpFields) {
        if (exifData[field] !== undefined && exifData[field] !== null) {
          hasXmp = true;
          entries.push({
            key: formatKey(field),
            value: String(exifData[field]),
            category: 'xmp',
            removable: true,
          });
        }
      }

      // Any other unrecognized fields
      for (const [key, value] of Object.entries(exifData)) {
        if (value !== undefined && value !== null &&
          !exifFields.includes(key) && !iptcFields.includes(key) &&
          !xmpFields.includes(key) && key !== 'latitude' && key !== 'longitude' &&
          key !== 'ImageWidth' && key !== 'ImageHeight') {
          const cat = categorizeUnknownField(key);
          if (cat === 'iptc') hasIptc = true;
          if (cat === 'xmp') hasXmp = true;
          if (cat === 'exif') hasExif = true;
          entries.push({
            key: formatKey(key),
            value: value instanceof Date ? value.toISOString() : String(value),
            category: cat,
            removable: true,
          });
        }
      }
    }

    // Generate thumbnail
    try {
      const thumb = await exifr.thumbnail(file);
      if (thumb) {
        thumbnail = URL.createObjectURL(thumb);
      }
    } catch {
      // No thumbnail available
    }
  } catch (err) {
    console.warn('EXIF read error:', err);
  }

  return {
    file,
    entries,
    gps,
    thumbnail,
    hasExif,
    hasIptc,
    hasXmp,
    fileSize: file.size,
    mimeType: file.type,
  };
}

async function readPDFMetadata(file: File): Promise<FileMetadata> {
  const entries: MetadataEntry[] = [];
  let hasXmp = false;

  entries.push({ key: 'File Name', value: file.name, category: 'file', removable: false });
  entries.push({ key: 'File Size', value: formatFileSize(file.size), category: 'file', removable: false });
  entries.push({ key: 'MIME Type', value: file.type || 'application/pdf', category: 'file', removable: false });

  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
    const info = pdfDoc.getTitle() || pdfDoc.getAuthor() || pdfDoc.getSubject() ||
      pdfDoc.getCreator() || pdfDoc.getProducer() || pdfDoc.getCreationDate() || pdfDoc.getModificationDate();

    if (pdfDoc.getTitle()) {
      entries.push({ key: 'Title', value: pdfDoc.getTitle()!, category: 'pdf', removable: true });
      hasXmp = true;
    }
    if (pdfDoc.getAuthor()) {
      entries.push({ key: 'Author', value: pdfDoc.getAuthor()!, category: 'pdf', removable: true });
      hasXmp = true;
    }
    if (pdfDoc.getSubject()) {
      entries.push({ key: 'Subject', value: pdfDoc.getSubject()!, category: 'pdf', removable: true });
      hasXmp = true;
    }
    if (pdfDoc.getCreator()) {
      entries.push({ key: 'Creator', value: pdfDoc.getCreator()!, category: 'pdf', removable: true });
      hasXmp = true;
    }
    if (pdfDoc.getProducer()) {
      entries.push({ key: 'Producer', value: pdfDoc.getProducer()!, category: 'pdf', removable: true });
      hasXmp = true;
    }
    if (pdfDoc.getCreationDate()) {
      entries.push({ key: 'Creation Date', value: pdfDoc.getCreationDate()!.toISOString(), category: 'pdf', removable: true });
      hasXmp = true;
    }
    if (pdfDoc.getModificationDate()) {
      entries.push({ key: 'Modification Date', value: pdfDoc.getModificationDate()!.toISOString(), category: 'pdf', removable: true });
      hasXmp = true;
    }
    if (pdfDoc.getKeywords()) {
      entries.push({ key: 'Keywords', value: pdfDoc.getKeywords()!, category: 'pdf', removable: true });
      hasXmp = true;
    }

    const pageCount = pdfDoc.getPageCount();
    entries.push({ key: 'Page Count', value: pageCount, category: 'file', removable: false });
  } catch (err) {
    console.warn('PDF metadata read error:', err);
  }

  return {
    file,
    entries,
    hasExif: false,
    hasIptc: false,
    hasXmp,
    fileSize: file.size,
    mimeType: file.type || 'application/pdf',
  };
}

function readOfficeMetadata(file: File): FileMetadata {
  const entries: MetadataEntry[] = [];

  entries.push({ key: 'File Name', value: file.name, category: 'file', removable: false });
  entries.push({ key: 'File Size', value: formatFileSize(file.size), category: 'file', removable: false });
  entries.push({ key: 'MIME Type', value: file.type || 'application/octet-stream', category: 'file', removable: false });
  entries.push({ key: 'Last Modified', value: new Date(file.lastModified).toISOString(), category: 'file', removable: false });
  entries.push({ key: 'Note', value: 'Office docs contain metadata in embedded XML. Use dedicated tools for deep cleaning.', category: 'office', removable: false });

  return {
    file,
    entries,
    hasExif: false,
    hasIptc: false,
    hasXmp: true,
    fileSize: file.size,
    mimeType: file.type || 'application/octet-stream',
  };
}

function categorizeUnknownField(key: string): MetadataEntry['category'] {
  const lower = key.toLowerCase();
  if (lower.includes('gps') || lower.includes('latitude') || lower.includes('longitude')) return 'gps';
  if (lower.includes('iptc') || lower.includes('caption') || lower.includes('copyright')) return 'iptc';
  if (lower.includes('xmp') || lower.includes('creator') || lower.includes('rights')) return 'xmp';
  return 'exif';
}

function formatKey(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export async function readMetadata(file: File): Promise<FileMetadata> {
  if (isImage(file)) {
    return readImageMetadata(file);
  } else if (isPDF(file)) {
    return readPDFMetadata(file);
  } else if (isOffice(file)) {
    return readOfficeMetadata(file);
  }
  // Fallback - file info only
  return readOfficeMetadata(file);
}
