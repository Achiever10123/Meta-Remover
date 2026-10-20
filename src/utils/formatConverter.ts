// Format Converter Utility
export type OutputFormat = 'original' | 'jpg' | 'webp' | 'png';

export async function convertImageFormat(
  blob: Blob,
  targetFormat: OutputFormat,
  quality: number = 0.92
): Promise<Blob> {
  if (targetFormat === 'original') {
    return blob;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context not available'));
        return;
      }
      
      // For JPG, fill with white background (no transparency)
      if (targetFormat === 'jpg') {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      
      ctx.drawImage(img, 0, 0);
      
      const mimeType = targetFormat === 'jpg' ? 'image/jpeg' : 
                       targetFormat === 'webp' ? 'image/webp' : 'image/png';
      
      canvas.toBlob(
        (resultBlob) => {
          if (resultBlob) {
            resolve(resultBlob);
          } else {
            reject(new Error('Conversion failed'));
          }
        },
        mimeType,
        quality
      );
      
      URL.revokeObjectURL(img.src);
    };
    
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = URL.createObjectURL(blob);
  });
}

export function getFormatExtension(format: OutputFormat): string {
  switch (format) {
    case 'jpg': return 'jpg';
    case 'webp': return 'webp';
    case 'png': return 'png';
    default: return '';
  }
}

export function getFormatMimeType(format: OutputFormat): string {
  switch (format) {
    case 'jpg': return 'image/jpeg';
    case 'webp': return 'image/webp';
    case 'png': return 'image/png';
    default: return '';
  }
}

export function isConvertibleImage(file: File): boolean {
  return file.type.startsWith('image/') && 
    !file.type.includes('svg') && 
    !file.type.includes('gif') &&
    !file.type.includes('bmp');
}
