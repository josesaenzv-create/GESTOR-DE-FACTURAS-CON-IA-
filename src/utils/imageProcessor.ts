export interface ProcessedInvoiceImages {
  hdDataUrl: string;
  hdBase64: string;
  iaDataUrl: string;
  iaBase64: string;
  width: number;
  height: number;
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo de imagen.'));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('El archivo seleccionado no es una imagen válida.'));
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function resizeWithCanvas(
  img: HTMLImageElement,
  maxSide: number,
  quality: number
): { dataUrl: string; base64: string; width: number; height: number } {
  const ratio = Math.min(1, maxSide / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * ratio));
  const height = Math.max(1, Math.round(img.height * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('No se pudo inicializar el procesador gráfico Canvas.');
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
  return { dataUrl, base64, width, height };
}

export async function processInvoiceImageFile(file: File): Promise<ProcessedInvoiceImages> {
  const img = await loadImageFromFile(file);
  // Full HD copy (max 2200px, JPEG 0.94)
  const hd = resizeWithCanvas(img, 2200, 0.94);
  // Lightweight AI copy (max 1024px, JPEG 0.80)
  const ia = resizeWithCanvas(img, 1024, 0.8);

  return {
    hdDataUrl: hd.dataUrl,
    hdBase64: hd.base64,
    iaDataUrl: ia.dataUrl,
    iaBase64: ia.base64,
    width: hd.width,
    height: hd.height,
  };
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
