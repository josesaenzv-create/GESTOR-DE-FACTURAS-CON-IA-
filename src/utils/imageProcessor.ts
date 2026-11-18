export type ImageFilterMode = 'original' | 'bw' | 'high-contrast' | 'grayscale';

export interface ImageEditSettings {
  rotation: 0 | 90 | 180 | 270;
  filterMode: ImageFilterMode;
  brightness: number; // 50..160 (default 100)
  contrast: number; // 50..200 (default 100)
  crop: {
    left: number; // 0..0.45
    top: number; // 0..0.45
    right: number; // 0..0.45
    bottom: number; // 0..0.45
  };
}

export const DEFAULT_IMAGE_EDITS: ImageEditSettings = {
  rotation: 0,
  filterMode: 'original',
  brightness: 100,
  contrast: 100,
  crop: { left: 0, top: 0, right: 0, bottom: 0 },
};

export interface ProcessedInvoiceImages {
  originalDataUrl: string;
  hdDataUrl: string;
  hdBase64: string;
  iaDataUrl: string;
  iaBase64: string;
  width: number;
  height: number;
}

export function loadImageFromSrc(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen.'));
    img.src = src;
  });
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo de imagen.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export function computeCropRect(
  rotW: number,
  rotH: number,
  crop: ImageEditSettings['crop']
): { sx: number; sy: number; sw: number; sh: number } {
  const safeLeft = Math.max(0, Math.min(0.45, crop.left));
  const safeRight = Math.max(0, Math.min(0.45, crop.right));
  const safeTop = Math.max(0, Math.min(0.45, crop.top));
  const safeBottom = Math.max(0, Math.min(0.45, crop.bottom));

  const sx = Math.round(safeLeft * rotW);
  const sy = Math.round(safeTop * rotH);
  const sw = Math.max(20, Math.round((1 - safeLeft - safeRight) * rotW));
  const sh = Math.max(20, Math.round((1 - safeTop - safeBottom) * rotH));
  return { sx, sy, sw, sh };
}

function applyPixelFilters(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  edits: ImageEditSettings
) {
  const { filterMode, brightness, contrast } = edits;
  if (
    filterMode === 'original' &&
    brightness === 100 &&
    contrast === 100
  ) {
    return;
  }

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  const brightFactor = brightness / 100;
  const contrastAdj =
    filterMode === 'high-contrast'
      ? Math.max(contrast, 138)
      : filterMode === 'bw'
      ? Math.max(contrast, 145)
      : contrast;
  const cFactor = (259 * (contrastAdj - 100 + 255)) / (255 * (259 - (contrastAdj - 100)));

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] * brightFactor;
    let g = data[i + 1] * brightFactor;
    let b = data[i + 2] * brightFactor;

    r = cFactor * (r - 128) + 128;
    g = cFactor * (g - 128) + 128;
    b = cFactor * (b - 128) + 128;

    if (filterMode === 'grayscale' || filterMode === 'bw') {
      let lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (filterMode === 'bw') {
        // Gentle adaptive scanner curve: crisp dark ink while preserving thin digits on thermal paper
        if (lum < 115) {
          lum = lum * 0.48;
        } else if (lum > 185) {
          lum = 255;
        } else {
          lum = ((lum - 115) / 70) * 195 + 55;
        }
      }
      r = lum;
      g = lum;
      b = lum;
    }

    data[i] = Math.max(0, Math.min(255, r));
    data[i + 1] = Math.max(0, Math.min(255, g));
    data[i + 2] = Math.max(0, Math.min(255, b));
  }

  ctx.putImageData(imageData, 0, 0);
}

function renderEditedToCanvas(
  img: HTMLImageElement,
  edits: ImageEditSettings,
  maxSide: number,
  quality: number
): { dataUrl: string; base64: string; width: number; height: number } {
  // 1. Rotate onto intermediate canvas first if needed
  const rotRad = (edits.rotation * Math.PI) / 180;
  const swap = edits.rotation === 90 || edits.rotation === 270;
  const rotW = swap ? img.height : img.width;
  const rotH = swap ? img.width : img.height;

  const rotCanvas = document.createElement('canvas');
  rotCanvas.width = rotW;
  rotCanvas.height = rotH;
  const rotCtx = rotCanvas.getContext('2d');
  if (!rotCtx) throw new Error('Error al inicializar Canvas.');

  rotCtx.imageSmoothingEnabled = true;
  rotCtx.imageSmoothingQuality = 'high';
  rotCtx.fillStyle = '#ffffff';
  rotCtx.fillRect(0, 0, rotW, rotH);
  rotCtx.translate(rotW / 2, rotH / 2);
  rotCtx.rotate(rotRad);
  rotCtx.drawImage(img, -img.width / 2, -img.height / 2);

  // 2. Apply crop coordinates on rotated image
  const { sx, sy, sw, sh } = computeCropRect(rotW, rotH, edits.crop);

  // 3. Scale to maxSide preserving original crispness up to 2800px
  const ratio = Math.min(1, maxSide / Math.max(sw, sh));
  const outW = Math.max(1, Math.round(sw * ratio));
  const outH = Math.max(1, Math.round(sh * ratio));

  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) throw new Error('Error al inicializar Canvas de salida.');

  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = 'high';
  outCtx.fillStyle = '#ffffff';
  outCtx.fillRect(0, 0, outW, outH);
  outCtx.drawImage(rotCanvas, sx, sy, sw, sh, 0, 0, outW, outH);

  // 4. Pixel-level contrast / brightness / B&W scanner enhancement
  applyPixelFilters(outCtx, outW, outH, edits);

  const dataUrl = outCanvas.toDataURL('image/jpeg', quality);
  const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
  return { dataUrl, base64, width: outW, height: outH };
}

export async function renderLivePreviewDataUrl(
  originalDataUrl: string,
  edits: ImageEditSettings,
  maxSide = 1200,
  quality = 0.9
): Promise<{ dataUrl: string; width: number; height: number; hdWidth: number; hdHeight: number }> {
  const img = await loadImageFromSrc(originalDataUrl);
  const swap = edits.rotation === 90 || edits.rotation === 270;
  const rotW = swap ? img.height : img.width;
  const rotH = swap ? img.width : img.height;
  const { sw, sh } = computeCropRect(rotW, rotH, edits.crop);
  const hdRatio = Math.min(1, 2800 / Math.max(sw, sh));
  const preview = renderEditedToCanvas(img, edits, maxSide, quality);
  return {
    dataUrl: preview.dataUrl,
    width: preview.width,
    height: preview.height,
    hdWidth: Math.max(1, Math.round(sw * hdRatio)),
    hdHeight: Math.max(1, Math.round(sh * hdRatio)),
  };
}

export async function processEditedInvoiceImage(
  originalDataUrl: string,
  edits: ImageEditSettings = DEFAULT_IMAGE_EDITS
): Promise<ProcessedInvoiceImages> {
  const img = await loadImageFromSrc(originalDataUrl);
  // Maximum HD quality for storage & printing (up to 2800px at 97% JPEG quality)
  const hd = renderEditedToCanvas(img, edits, 2800, 0.97);
  // High-precision 2048px image at 0.92 JPEG for Gemini Vision:
  // Preserves rotation and crop ONLY — NEVER applies hard B/W binarization or destructive filters
  // that could erase small decimal points (e.g. turning 1.80 into 180).
  const iaEdits: ImageEditSettings = {
    ...edits,
    filterMode: 'original',
    brightness: 100,
    contrast: 100,
  };
  const ia = renderEditedToCanvas(img, iaEdits, 2048, 0.92);

  return {
    originalDataUrl,
    hdDataUrl: hd.dataUrl,
    hdBase64: hd.base64,
    iaDataUrl: ia.dataUrl,
    iaBase64: ia.base64,
    width: hd.width,
    height: hd.height,
  };
}

/**
 * Normalizes EXIF camera orientation from mobile phones into an upright data URL
 * using createImageBitmap (which respects EXIF 'from-image' orientation without double-rotating),
 * falling back cleanly to FileReader if unavailable.
 */
async function normalizeExifFileToDataUrl(file: File): Promise<string> {
  if (typeof createImageBitmap === 'function' && typeof document !== 'undefined') {
    try {
      const bitmap = await createImageBitmap(file);
      const maxInitial = 2800;
      const ratio = Math.min(1, maxInitial / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * ratio));
      const h = Math.max(1, Math.round(bitmap.height * ratio));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close?.();
        return canvas.toDataURL('image/jpeg', 0.95);
      }
      bitmap.close?.();
    } catch {
      // Fallback to standard FileReader below
    }
  }
  return readFileAsDataUrl(file);
}

export async function processInvoiceImageFile(file: File): Promise<ProcessedInvoiceImages> {
  const dataUrl = await normalizeExifFileToDataUrl(file);
  return processEditedInvoiceImage(dataUrl, DEFAULT_IMAGE_EDITS);
}

export interface DirectoryHandleLike {
  name: string;
  getFileHandle: (
    name: string,
    options?: { create?: boolean }
  ) => Promise<{
    createWritable: () => Promise<{
      write: (data: Blob) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
}

export async function saveHdPhotoLocally(
  hdDataUrl: string,
  filename: string,
  dirHandle: DirectoryHandleLike | null
): Promise<'folder' | 'download'> {
  const res = await fetch(hdDataUrl);
  const blob = await res.blob();

  if (dirHandle) {
    try {
      const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'folder';
    } catch {
      // Fallback to direct download
    }
  }

  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 2500);
  return 'download';
}
