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
      ? Math.max(contrast, 145)
      : filterMode === 'bw'
      ? Math.max(contrast, 155)
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
        // Crisp scanner boost: darken ink, lighten thermal paper background
        lum = lum < 138 ? lum * 0.55 : Math.min(255, lum * 1.18 + 20);
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

  rotCtx.fillStyle = '#ffffff';
  rotCtx.fillRect(0, 0, rotW, rotH);
  rotCtx.translate(rotW / 2, rotH / 2);
  rotCtx.rotate(rotRad);
  rotCtx.drawImage(img, -img.width / 2, -img.height / 2);

  // 2. Apply crop coordinates on rotated image
  const sx = Math.round(edits.crop.left * rotW);
  const sy = Math.round(edits.crop.top * rotH);
  const sw = Math.max(20, Math.round((1 - edits.crop.left - edits.crop.right) * rotW));
  const sh = Math.max(20, Math.round((1 - edits.crop.top - edits.crop.bottom) * rotH));

  // 3. Scale to maxSide
  const ratio = Math.min(1, maxSide / Math.max(sw, sh));
  const outW = Math.max(1, Math.round(sw * ratio));
  const outH = Math.max(1, Math.round(sh * ratio));

  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) throw new Error('Error al inicializar Canvas de salida.');

  outCtx.fillStyle = '#ffffff';
  outCtx.fillRect(0, 0, outW, outH);
  outCtx.drawImage(rotCanvas, sx, sy, sw, sh, 0, 0, outW, outH);

  // 4. Pixel-level contrast / brightness / B&W scanner enhancement
  applyPixelFilters(outCtx, outW, outH, edits);

  const dataUrl = outCanvas.toDataURL('image/jpeg', quality);
  const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
  return { dataUrl, base64, width: outW, height: outH };
}

export async function processEditedInvoiceImage(
  originalDataUrl: string,
  edits: ImageEditSettings = DEFAULT_IMAGE_EDITS
): Promise<ProcessedInvoiceImages> {
  const img = await loadImageFromSrc(originalDataUrl);
  const hd = renderEditedToCanvas(img, edits, 2200, 0.94);
  const ia = renderEditedToCanvas(img, edits, 1024, 0.82);

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

export async function processInvoiceImageFile(file: File): Promise<ProcessedInvoiceImages> {
  const dataUrl = await readFileAsDataUrl(file);
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
