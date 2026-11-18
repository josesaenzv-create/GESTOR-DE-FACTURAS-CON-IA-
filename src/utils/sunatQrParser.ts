import type { TipoComprobante } from '../types/crediban';
import {
  isCredibanClientRuc,
  normalizePeruDateIso,
  validateSunatRucMod11,
} from './invoiceValidator';
import { round2 } from './accounting';

export interface SunatQrParsedData {
  rawText: string;
  rucEmisor: string;
  tipoComprobante: TipoComprobante;
  tipoCodigoSunat: string;
  serie: string;
  numero: string;
  serieCorrelativo: string;
  igv: number;
  igvRateHint?: number;
  total: number;
  subtotal: number;
  fechaEmision: string;
  tipoDocAdquirente: string;
  numDocAdquirente: string;
  hashDigest: string;
  isCredibanClient: boolean;
  qrVerified: boolean;
}

function mapSunatTipoCodigo(rawCode: string): {
  tipoComprobante: TipoComprobante;
  code: string;
} {
  const digits = String(rawCode || '').replace(/\D/g, '').padStart(2, '0');
  if (digits === '01') return { tipoComprobante: 'FACTURA', code: '01' };
  if (digits === '03') return { tipoComprobante: 'BOLETA', code: '03' };
  if (digits === '07' || digits === '08') {
    return { tipoComprobante: 'FACTURA', code: digits };
  }
  if (digits === '12') return { tipoComprobante: 'TICKET DE VENTA', code: '12' };
  return { tipoComprobante: 'FACTURA', code: digits || '01' };
}

/**
 * Parses ALL real-world Peruvian SUNAT QR formats seen in production:
 * 1) Standard SUNAT 9-10 pipe fields:
 *    RUC|TIPO|SERIE|NUMERO|IGV|TOTAL|FECHA|TIPODOC_ADQ|NUMDOC_ADQ|HASH
 *    Example: "20534123605|01|F002|0002741|1.75|11.50|2026-10-29|6|20613997360|"
 * 2) Standard omitting FECHA:
 *    "10316801426|01|E001|6565|9.15|60.00|6|20613997360|"
 * 3) Spaced PSE format with percentage instead of S/ IGV & DD/MM/YYYY date:
 *    "10713721633 | 1 | F003 | 00005141 | 18 | 45.00 | 21/10/2026"
 * 4) Notary / PSE prefixed-docType format:
 *    "6|10316786613|6|20611658410|01|001-00008766|2026-10-21|3.66|24.00|"
 */
export function parseSunatQrString(rawText: string): SunatQrParsedData | null {
  const cleanRaw = String(rawText || '').trim();
  if (!cleanRaw.includes('|')) return null;

  const fields = cleanRaw.split('|').map((f) => f.trim());
  if (fields.length < 6) return null;

  // Format 4: Starts with emitter doc type ("6" for RUC) + 11-digit RUC + adquirente docType + adquirente num + tipoComprobante + serie-numero + fecha + igv + total
  if (
    fields.length >= 9 &&
    /^[1467]$/.test(fields[0]) &&
    validateSunatRucMod11(fields[1]) &&
    /^\d{1,2}$/.test(fields[4]) &&
    fields[5].includes('-')
  ) {
    const rucEmisor = fields[1];
    const tipoDocAdq = fields[2];
    const numDocAdq = fields[3].replace(/\D/g, '');
    const mappedTipo = mapSunatTipoCodigo(fields[4]);
    const [rawSerie, rawNum] = fields[5].split('-').map((s) => s.trim());
    // Prefix 'F'/'B' when SUNAT electronic notary omits the letter on serie ("001" -> "F001" / "B001")
    let serie = rawSerie.toUpperCase();
    if (/^\d{3}$/.test(serie)) {
      serie = mappedTipo.code === '03' ? `B${serie}` : `F${serie}`;
    }
    const numero = rawNum;
    const dateCheck = normalizePeruDateIso(fields[6]);
    const igv = round2(parseFloat(fields[7].replace(',', '.')) || 0);
    const total = round2(parseFloat(fields[8].replace(',', '.')) || 0);
    const subtotal = total > 0 ? round2(Math.max(0, total - igv)) : 0;

    return {
      rawText: cleanRaw,
      rucEmisor,
      tipoComprobante: mappedTipo.tipoComprobante,
      tipoCodigoSunat: mappedTipo.code,
      serie,
      numero,
      serieCorrelativo: `${serie}-${numero}`,
      igv,
      total,
      subtotal,
      fechaEmision: dateCheck.valid ? dateCheck.iso : '',
      tipoDocAdquirente: tipoDocAdq,
      numDocAdquirente: numDocAdq,
      hashDigest: fields[9] || '',
      isCredibanClient: isCredibanClientRuc(numDocAdq),
      qrVerified: total > 0 && !isCredibanClientRuc(rucEmisor),
    };
  }

  // Formats 1, 2, 3: fields[0] is Emitter RUC
  const rucCandidate = fields[0].replace(/\D/g, '');
  if (!validateSunatRucMod11(rucCandidate)) return null;

  const mappedTipo = mapSunatTipoCodigo(fields[1]);
  const serie = fields[2].toUpperCase().replace(/\s+/g, '');
  const numero = fields[3].replace(/\s+/g, '');
  if (!serie || !numero) return null;

  const igvFieldRaw = fields[4].replace(',', '.');
  const igvRawNum = parseFloat(igvFieldRaw);
  const total = round2(parseFloat(fields[5].replace(',', '.')) || 0);

  // Check if field[4] is an explicit rate (e.g. "18" without decimal) that would be impossible as SOLES IGV
  let igv = Number.isFinite(igvRawNum) ? round2(igvRawNum) : 0;
  let igvRateHint: number | undefined;
  if (
    mappedTipo.tipoComprobante === 'FACTURA' &&
    total > 0 &&
    !igvFieldRaw.includes('.') &&
    (igvRawNum === 18 || igvRawNum === 10 || igvRawNum === 10.5) &&
    Math.abs(total - 118) > 0.05 &&
    igvRawNum / Math.max(0.01, total - igvRawNum) > 0.35
  ) {
    igvRateHint = igvRawNum;
    const base = round2(total / (1 + igvRawNum / 100));
    igv = round2(total - base);
  }
  const subtotal =
    mappedTipo.tipoComprobante === 'FACTURA' && total > 0
      ? round2(Math.max(0, total - igv))
      : total;

  // Locate date & client document flexibly across trailing fields (handles omitted date in f[6])
  let fechaEmision = '';
  let tipoDocAdq = '';
  let numDocAdq = '';
  let hashDigest = '';

  const trailing = fields.slice(6);
  for (let i = 0; i < trailing.length; i++) {
    const token = trailing[i];
    if (!token) continue;
    if (!fechaEmision) {
      const dc = normalizePeruDateIso(token);
      if (dc.valid) {
        fechaEmision = dc.iso;
        continue;
      }
    }
    if (/^[01467]$/.test(token) && trailing[i + 1] && /^\d{8,11}$/.test(trailing[i + 1])) {
      tipoDocAdq = token;
      numDocAdq = trailing[i + 1];
      i++;
      continue;
    }
    if (!numDocAdq && /^\d{8,11}$/.test(token)) {
      numDocAdq = token;
      continue;
    }
    if (!hashDigest && token.length >= 8) {
      hashDigest = token;
    }
  }

  return {
    rawText: cleanRaw,
    rucEmisor: rucCandidate,
    tipoComprobante: mappedTipo.tipoComprobante,
    tipoCodigoSunat: mappedTipo.code,
    serie,
    numero,
    serieCorrelativo: `${serie}-${numero}`,
    igv,
    igvRateHint,
    total,
    subtotal,
    fechaEmision,
    tipoDocAdquirente: tipoDocAdq,
    numDocAdquirente: numDocAdq,
    hashDigest,
    isCredibanClient: isCredibanClientRuc(numDocAdq),
    qrVerified: total > 0 && !isCredibanClientRuc(rucCandidate),
  };
}

let zxingConfigured = false;

export function ensureZxingWasmLocalPath(wasmBinary?: ArrayBuffer): void {
  if (zxingConfigured && !wasmBinary) return;
  zxingConfigured = true;
  void import('barcode-detector/ponyfill').then(({ setZXingModuleOverrides }) => {
    if (wasmBinary) {
      setZXingModuleOverrides({ wasmBinary });
      return;
    }
    setZXingModuleOverrides({
      locateFile: (fileName: string, prefix: string) => {
        if (fileName.endsWith('.wasm')) {
          let base = './';
          try {
            const meta = import.meta as unknown as { env?: { BASE_URL?: string } };
            base = meta?.env?.BASE_URL || './';
          } catch {
            base = './';
          }
          return `${base.endsWith('/') ? base : `${base}/`}wasm/${fileName}`;
        }
        return `${prefix}${fileName}`;
      },
    });
  });
}

function createSharpenedBottomRoiCanvases(
  source: HTMLCanvasElement
): HTMLCanvasElement[] {
  const candidates: HTMLCanvasElement[] = [];
  if (typeof document === 'undefined') return candidates;

  const w = source.width;
  const h = source.height;
  if (!w || !h) return candidates;

  // Bottom thermal QRs are typically small/creased in lower 45% of tall tickets
  const roiConfigs: Array<{
    xStartRatio: number;
    widthRatio: number;
    yStartRatio: number;
    heightRatio: number;
    scale: number;
    contrast: boolean;
  }> = [
    { xStartRatio: 0, widthRatio: 1, yStartRatio: 0.55, heightRatio: 0.45, scale: 1.5, contrast: false },
    { xStartRatio: 0.15, widthRatio: 0.7, yStartRatio: 0.65, heightRatio: 0.35, scale: 2.2, contrast: false },
    { xStartRatio: 0.15, widthRatio: 0.7, yStartRatio: 0.65, heightRatio: 0.35, scale: 2.4, contrast: true },
    { xStartRatio: 0, widthRatio: 1, yStartRatio: 0.58, heightRatio: 0.42, scale: 2.0, contrast: true },
    { xStartRatio: 0, widthRatio: 1, yStartRatio: 0.35, heightRatio: 0.45, scale: 1.5, contrast: true },
  ];

  for (const cfg of roiConfigs) {
    const sx = Math.round(w * cfg.xStartRatio);
    const sw = Math.max(40, Math.round(w * cfg.widthRatio));
    const sy = Math.round(h * cfg.yStartRatio);
    const sh = Math.max(40, Math.round(h * cfg.heightRatio));
    const outW = Math.min(2200, Math.round(sw * cfg.scale));
    const outH = Math.min(2200, Math.round(sh * cfg.scale));
    const c = document.createElement('canvas');
    c.width = outW;
    c.height = outH;
    const ctx = c.getContext('2d');
    if (!ctx) continue;
    ctx.imageSmoothingEnabled = !cfg.contrast;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, outW, outH);

    // Apply adaptive contrast ONLY on dedicated QR retry canvas (never sent to OCR/Gemini)
    if (cfg.contrast) {
      const imgData = ctx.getImageData(0, 0, outW, outH);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const v = lum < 125 ? Math.max(0, lum * 0.35) : Math.min(255, 195 + (lum - 125) * 0.5);
        d[i] = v;
        d[i + 1] = v;
        d[i + 2] = v;
      }
      ctx.putImageData(imgData, 0, 0);
    }
    candidates.push(c);
  }
  return candidates;
}

/**
 * Offline Layer 0 SUNAT QR Detector using zxing-wasm (`barcode-detector/ponyfill`).
 * Tries full canvas/blob first, then bottom-half upscaled & contrast-boosted ROIs.
 */
export async function detectSunatQrFromImage(
  source: HTMLCanvasElement | Blob | string
): Promise<SunatQrParsedData | null> {
  try {
    const { BarcodeDetector, setZXingModuleOverrides } = await import(
      'barcode-detector/ponyfill'
    );
    setZXingModuleOverrides({
      locateFile: (fileName: string, prefix: string) => {
        if (fileName.endsWith('.wasm')) {
          let base = './';
          try {
            const meta = import.meta as unknown as { env?: { BASE_URL?: string } };
            base = meta?.env?.BASE_URL || './';
          } catch {
            base = './';
          }
          return `${base.endsWith('/') ? base : `${base}/`}wasm/${fileName}`;
        }
        return `${prefix}${fileName}`;
      },
    });

    const detector = new BarcodeDetector({ formats: ['qr_code'] });

    const tryDetectOnInput = async (
      input: HTMLCanvasElement | Blob
    ): Promise<SunatQrParsedData | null> => {
      const results = await detector.detect(input);
      for (const item of results) {
        const parsed = parseSunatQrString(item.rawValue);
        if (parsed) return parsed;
      }
      return null;
    };

    if (typeof source === 'string') {
      // Data URL -> load to canvas for both full and ROI detection
      if (typeof document !== 'undefined') {
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('QR image load failed'));
          img.src = source;
        });
        const fullCanvas = document.createElement('canvas');
        fullCanvas.width = img.naturalWidth || img.width;
        fullCanvas.height = img.naturalHeight || img.height;
        const fCtx = fullCanvas.getContext('2d');
        if (fCtx) {
          fCtx.drawImage(img, 0, 0);
          const fullHit = await tryDetectOnInput(fullCanvas);
          if (fullHit) return fullHit;

          for (const roiCanvas of createSharpenedBottomRoiCanvases(fullCanvas)) {
            const roiHit = await tryDetectOnInput(roiCanvas);
            if (roiHit) return roiHit;
          }
        }
      }
      const res = await fetch(source);
      const blob = await res.blob();
      return await tryDetectOnInput(blob);
    }

    if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
      const fullHit = await tryDetectOnInput(source);
      if (fullHit) return fullHit;

      for (const roiCanvas of createSharpenedBottomRoiCanvases(source)) {
        const roiHit = await tryDetectOnInput(roiCanvas);
        if (roiHit) return roiHit;
      }
      return null;
    }

    return await tryDetectOnInput(source as Blob);
  } catch {
    return null;
  }
}
