import {
  CREDIBAN_COMPANY,
  OFFICIAL_CATEGORIES,
  type ExpenseCriterion,
  type NaturalezaGasto,
  type TipoComprobante,
} from '../types/crediban';
import { calculateIgvBreakdown, round2 } from './accounting';

export interface FieldValidationAlert {
  field: 'ruc' | 'serie' | 'fecha' | 'total' | 'igv' | 'general';
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface SunatDateCheckResult {
  iso: string;
  valid: boolean;
  isFuture: boolean;
  missing: boolean;
}

export interface PeruTaxValidationResult {
  subtotal: number;
  igv: number;
  total: number;
  mathVerified: boolean;
  mathMismatch: boolean;
  wordsMismatch: boolean;
  parsedLetrasAmount: number | null;
  detectedRatePct: 0 | 10 | 10.5 | 18 | null;
  alerts: FieldValidationAlert[];
}

const SPANISH_MONTHS: Record<string, string> = {
  ene: '01',
  enero: '01',
  feb: '02',
  febrero: '02',
  mar: '03',
  marzo: '03',
  abr: '04',
  abril: '04',
  may: '05',
  mayo: '05',
  jun: '06',
  junio: '06',
  jul: '07',
  julio: '07',
  ago: '08',
  agosto: '08',
  sep: '09',
  set: '09',
  sept: '09',
  septiembre: '09',
  setiembre: '09',
  oct: '10',
  octubre: '10',
  nov: '11',
  noviembre: '11',
  dic: '12',
  diciembre: '12',
};

const SPANISH_UNITS: Record<string, number> = {
  CERO: 0,
  UN: 1,
  UNO: 1,
  UNA: 1,
  DOS: 2,
  TRES: 3,
  CUATRO: 4,
  CINCO: 5,
  SEIS: 6,
  SIETE: 7,
  OCHO: 8,
  NUEVE: 9,
  DIEZ: 10,
  ONCE: 11,
  DOCE: 12,
  TRECE: 13,
  CATORCE: 14,
  QUINCE: 15,
  DIECISEIS: 16,
  DIECISIETE: 17,
  DIECIOCHO: 18,
  DIECINUEVE: 19,
  VEINTE: 20,
  VEINTIUN: 21,
  VEINTIUNO: 21,
  VEINTIUNA: 21,
  VEINTIDOS: 22,
  VEINTITRES: 23,
  VEINTICUATRO: 24,
  VEINTICINCO: 25,
  VEINTISEIS: 26,
  VEINTISIETE: 27,
  VEINTIOCHO: 28,
  VEINTINUEVE: 29,
  TREINTA: 30,
  CUARENTA: 40,
  CINCUENTA: 50,
  SESENTA: 60,
  SETENTA: 70,
  OCHENTA: 80,
  NOVENTA: 90,
  CIEN: 100,
  CIENTO: 100,
  DOSCIENTOS: 200,
  DOSCIENTAS: 200,
  TRESCIENTOS: 300,
  TRESCIENTAS: 300,
  CUATROCIENTOS: 400,
  CUATROCIENTAS: 400,
  QUINIENTOS: 500,
  QUINIENTAS: 500,
  SEISCIENTOS: 600,
  SEISCIENTAS: 600,
  SETECIENTOS: 700,
  SETECIENTAS: 700,
  OCHOCIENTOS: 800,
  OCHOCIENTAS: 800,
  NOVECIENTOS: 900,
  NOVECIENTAS: 900,
};

export function stripAccents(str: string): string {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * SUNAT official Módulo 11 RUC validator:
 * - Exact 11 numeric digits
 * - Prefix must be 10, 15, 17, or 20
 * - Checksum digit = 11 - (sum(d[i]*w[i]) % 11) with weights [5,4,3,2,7,6,5,4,3,2] (10->0, 11->1)
 */
export function validateSunatRucMod11(rucRaw: string | null | undefined): boolean {
  const ruc = String(rucRaw || '').replace(/\D/g, '');
  if (!/^(10|15|17|20)\d{9}$/.test(ruc)) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += Number(ruc[i]) * weights[i];
  }
  const rem = sum % 11;
  let check = 11 - rem;
  if (check === 10) check = 0;
  if (check === 11) check = 1;
  return check === Number(ruc[10]);
}

export function isCredibanClientRuc(rucRaw: string | null | undefined): boolean {
  return String(rucRaw || '').replace(/\D/g, '') === CREDIBAN_COMPANY.ruc;
}

export function shouldAcceptEmitterRuc(
  rucRaw: string | null | undefined,
  excludedClientRucs: string[] = []
): boolean {
  const clean = String(rucRaw || '').replace(/\D/g, '');
  if (!validateSunatRucMod11(clean)) return false;
  if (isCredibanClientRuc(clean)) return false;
  const excludedSet = new Set(excludedClientRucs.map((r) => String(r || '').replace(/\D/g, '')));
  if (excludedSet.has(clean)) return false;
  return true;
}

/**
 * Normalizes OCR character confusions strictly inside numeric candidate tokens.
 * NEVER apply this to company names or descriptions.
 */
export function repairOcrNumericToken(token: string): string {
  return String(token || '')
    .trim()
    .replace(/[OoQD]/g, '0')
    .replace(/[Il|!]/g, '1')
    .replace(/[Zz]/g, '2')
    .replace(/[Ss$]/g, '5')
    .replace(/,/g, '.');
}

function parseSpanishUnder1000Words(phrase: string): number | null {
  const tokens = stripAccents(phrase)
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && t !== 'Y');
  if (tokens.length === 0) return null;

  let total = 0;
  let recognized = false;
  for (const tok of tokens) {
    if (SPANISH_UNITS[tok] !== undefined) {
      total += SPANISH_UNITS[tok];
      recognized = true;
    } else {
      return null;
    }
  }
  return recognized ? total : null;
}

/**
 * Deterministic parser for Peruvian literal totals ("SON: ... SOLES"):
 * - "SON: SESENTA Y 00/100 SOLES" -> 60.00
 * - "SON: DOCE CON 00/100 Peruvian Nuevo Sol" -> 12.00
 * - "SON: ONCE CON 50/100 SOLES" -> 11.50
 * - "SON: VEINTE Y CUATRO Y 00/100 Soles" -> 24.00
 * - "SON: TREINTA Y CUATRO Y 00/100 Soles" -> 34.00
 * - "SON: UN CON 80/100 SOLES" -> 1.80
 * - "MIL DOSCIENTOS CUARENTA CON 25/100 SOLES" -> 1240.25
 */
export function parseMontoEnLetrasPeru(raw: string | null | undefined): number | null {
  const text = stripAccents(String(raw || ''))
    .toUpperCase()
    .replace(/^SON\s*:\s*/i, '')
    .trim();
  if (!text) return null;

  const centMatch = text.match(/\b(\d{1,2})\s*\/\s*100\b/);
  if (!centMatch) return null;
  const cents = parseInt(centMatch[1], 10);
  if (Number.isNaN(cents) || cents < 0 || cents > 99) return null;

  const beforeCents = text
    .slice(0, centMatch.index)
    .replace(/(?:\b(?:CON|Y|DE|SOLES|NUEVOS?\s+SOLES|PERUVIAN\s+NUEVO\s+SOL|S\/)\b\s*)+$/i, '')
    .trim();

  if (!beforeCents) {
    return round2(cents / 100);
  }

  const milParts = beforeCents.split(/\bMIL\b/);
  let integerPart = 0;

  if (milParts.length === 2) {
    const thousandsText = milParts[0].trim();
    const remainderText = milParts[1].trim();
    let thousands = 1;
    if (thousandsText) {
      const parsedThousands = parseSpanishUnder1000Words(thousandsText);
      if (parsedThousands === null) return null;
      thousands = parsedThousands;
    }
    integerPart += thousands * 1000;
    if (remainderText) {
      const parsedRem = parseSpanishUnder1000Words(remainderText);
      if (parsedRem === null) return null;
      integerPart += parsedRem;
    }
  } else if (milParts.length === 1) {
    const parsed = parseSpanishUnder1000Words(milParts[0]);
    if (parsed === null) return null;
    integerPart = parsed;
  } else {
    return null;
  }

  return round2(integerPart + cents / 100);
}

const LEGAL_FOOTER_BLACKLIST_REGEX =
  /\b(?:RESOLUCION|INTENDENCIA|AUTORIZADO|ACEPTA\.PE|IMPRENTA|PROFORMA|COTIZACION|KARDEX|VENDEDOR|AUT\.?\s*N|F\.I\.|SERIE\s+\d{3}\s+DEL|TELEFONO|CELULAR|WHATSAPP|CUENTA|CCI)\b/i;

export function isLegalFooterNoiseLine(line: string): boolean {
  const upper = stripAccents(line).toUpperCase();
  return LEGAL_FOOTER_BLACKLIST_REGEX.test(upper);
}

/**
 * Extracts and validates receipt Serie-Correlativo while blocking SUNAT
 * "Resolución de Intendencia" codes (e.g. 034-005-0004782) and printer blocks.
 */
export function sanitizeSerieCorrelativo(
  rawSerie: string,
  fallbackTextLines: string | string[] = ''
): string {
  const normalizeToken = (val: string) =>
    stripAccents(String(val || ''))
      .toUpperCase()
      .replace(/[—–]/g, '-')
      .replace(/N[°º]\s*/g, '')
      .replace(/\s*-\s*/g, '-')
      .replace(/\s+/g, '');

  const extractFromString = (candidate: string): string => {
    const upper = stripAccents(candidate).toUpperCase();
    if (!upper) return '';
    // Remove 3-part Resolución numbers first (e.g., 034-005-0005315)
    const stripped = upper.replace(/\b\d{3}\s*[-–—]\s*\d{3}\s*[-–—]\s*\d{4,}\b/g, ' ');

    // Priority 1: Electronic SUNAT & Crediban voucher prefixes: F001-00034719, E001-6565, B002-123, NV01-0012, NP01-005, RC01-0025, M001-0127
    const elec = stripped.match(
      /\b([FBETM][A-Z0-9]{2,3}|NV\d{2}|NP\d{2}|RC\d{2})\s*[-–—]\s*([0-9OQ]{1,12})\b/
    );
    if (elec) {
      const serie = elec[1];
      const corr = elec[2].replace(/[OQ]/g, '0');
      return `${serie}-${corr}`;
    }

    // Priority 2: Physical printed/handwritten Boleta / Nota de Venta (e.g., 001-02139 or 001 - N° 02139)
    if (!isLegalFooterNoiseLine(stripped)) {
      const phys = stripped.match(
        /\b(0\d{2,3})\s*[-–—]\s*(?:N[°º.]?\s*)?([0-9OQ]{3,10})\b/
      );
      if (phys) {
        const serie = phys[1];
        const corr = phys[2].replace(/[OQ]/g, '0');
        // Exclude printer range "002001-003000" or phone numbers
        if (serie !== '034' && serie !== '043' && corr.length >= 4) {
          return `${serie}-${corr}`;
        }
      }
    }
    return '';
  };

  const directClean = normalizeToken(rawSerie);
  if (
    directClean &&
    !/^\d{3}-\d{3}-\d{4,}$/.test(directClean) &&
    (/^([FBETM][A-Z0-9]{2,3}|NV\d{2}|NP\d{2}|RC\d{2})-\d{1,12}$/.test(directClean) ||
      /^0\d{2,3}-\d{4,10}$/.test(directClean))
  ) {
    return directClean;
  }

  const lines = Array.isArray(fallbackTextLines)
    ? fallbackTextLines
    : String(fallbackTextLines || '').split(/\r?\n/);

  // Prefer header lines that don't match legal footer blacklist
  for (const line of lines) {
    if (isLegalFooterNoiseLine(line)) continue;
    const found = extractFromString(line);
    if (found) return found;
  }
  return '';
}

function isValidCalendarDate(y: number, m: number, d: number): boolean {
  if (y < 2018 || y > 2035 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function normalizePeruDateIso(
  raw: string | null | undefined,
  referenceTodayIso?: string
): SunatDateCheckResult {
  const str = stripAccents(String(raw || '')).trim();
  const todayIso = referenceTodayIso || new Date().toISOString().slice(0, 10);
  if (!str) {
    return { iso: '', valid: false, isFuture: false, missing: true };
  }

  const check = (y: number, m: number, d: number): SunatDateCheckResult | null => {
    if (!isValidCalendarDate(y, m, d)) return null;
    const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(
      2,
      '0'
    )}`;
    return {
      iso,
      valid: true,
      isFuture: iso > todayIso,
      missing: false,
    };
  };

  // YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = str.match(/\b(20\d{2})[\/\-](0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])\b/);
  if (isoMatch) {
    const r = check(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
    if (r) return r;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy4 = str.match(/\b(0?[1-9]|[12]\d|3[01])[\/\-](0?[1-9]|1[0-2])[\/\-](20\d{2})\b/);
  if (dmy4) {
    const r = check(Number(dmy4[3]), Number(dmy4[2]), Number(dmy4[1]));
    if (r) return r;
  }

  // Spanish month name: "17 nov. 2026" or "28 de octubre de 2026"
  const dmyText = str.match(
    /\b(0?[1-9]|[12]\d|3[01])\s*(?:de\s*)?([a-z]{3,10})\.?\s*(?:de\s*)?(20\d{2})\b/i
  );
  if (dmyText) {
    const mon = SPANISH_MONTHS[dmyText[2].toLowerCase()];
    if (mon) {
      const r = check(Number(dmyText[3]), Number(mon), Number(dmyText[1]));
      if (r) return r;
    }
  }

  // DD/MM/YY (e.g. 21/10/26 -> 2026-10-21)
  const dmy2 = str.match(/\b(0?[1-9]|[12]\d|3[01])[\/\-](0?[1-9]|1[0-2])[\/\-](\d{2})\b/);
  if (dmy2) {
    const r = check(2000 + Number(dmy2[3]), Number(dmy2[2]), Number(dmy2[1]));
    if (r) return r;
  }

  return { iso: '', valid: false, isFuture: false, missing: true };
}

/**
 * Validates Peruvian 2026 tax arithmetic & IGV regimes:
 * - 18% General (tolerates 0.02 rounding even on micro totals like 1.53 + 0.27 = 1.80)
 * - 10.5% MYPE Restaurants/Hotels 2026 (Ley 31556 / 32219 / 32387: 8% IGV + 2.5% IPM)
 * - 10% MYPE Restaurants/Hotels 2025 (8% IGV + 2% IPM)
 * - 0% Boletas, Notas de Venta, Recibos, Transfers, or Exonerado
 */
export function validatePeruTaxAndMath(params: {
  tipoComprobante: TipoComprobante;
  subtotal: number;
  igv: number;
  total: number;
  fechaEmision?: string;
  montoEnLetras?: string;
  fromQr?: boolean;
}): PeruTaxValidationResult {
  const alerts: FieldValidationAlert[] = [];
  let total = round2(Math.max(0, Number(params.total) || 0));
  let subtotal = round2(Math.max(0, Number(params.subtotal) || 0));
  let igv = round2(Math.max(0, Number(params.igv) || 0));

  // Guard against QR encoders that put IGV rate ("18") instead of monetary IGV when Total != 118
  if (
    params.tipoComprobante === 'FACTURA' &&
    total > 0 &&
    igv > 0 &&
    (igv === 18 || igv === 10.5 || igv === 10) &&
    subtotal === 0 &&
    Math.abs(total - 118) > 0.05 &&
    Math.abs(total - (total / (1 + igv / 100) + igv)) > 0.05 &&
    igv / Math.max(0.01, total - igv) > 0.35
  ) {
    const calc = calculateIgvBreakdown(total, 'FACTURA');
    subtotal = calc.subtotal;
    igv = calc.igv;
  }

  // When FACTURA comes with total and explicit IGV (e.g. from QR), derive subtotal cleanly
  if (params.tipoComprobante === 'FACTURA' && total > 0 && igv > 0 && subtotal === 0) {
    subtotal = round2(Math.max(0, total - igv));
  } else if (params.tipoComprobante === 'FACTURA' && total > 0 && subtotal === 0 && igv === 0) {
    const calc = calculateIgvBreakdown(total, 'FACTURA');
    subtotal = calc.subtotal;
    igv = calc.igv;
  } else if (params.tipoComprobante !== 'FACTURA' && total > 0 && subtotal === 0 && igv === 0) {
    subtotal = total;
    igv = 0;
  }

  const mathMismatch = total > 0 && Math.abs(round2(subtotal + igv) - total) > 0.02;

  // Determine effective Peruvian tax rate without overwriting printed MYPE 10.5% / 10% values
  let detectedRatePct: 0 | 10 | 10.5 | 18 | null = null;
  if (total > 0) {
    if (igv === 0) {
      detectedRatePct = 0;
    } else if (subtotal > 0) {
      const diff18 = Math.abs(igv - round2(subtotal * 0.18));
      const diff105 = Math.abs(igv - round2(subtotal * 0.105));
      const diff10 = Math.abs(igv - round2(subtotal * 0.1));
      if (diff18 <= 0.03) {
        detectedRatePct = 18;
      } else if (diff105 <= 0.03) {
        detectedRatePct = 10.5;
      } else if (diff10 <= 0.03) {
        detectedRatePct = 10;
      }
    }
  }

  const parsedLetrasAmount = parseMontoEnLetrasPeru(params.montoEnLetras);
  const wordsMismatch =
    parsedLetrasAmount !== null && total > 0 && Math.abs(parsedLetrasAmount - total) > 0.02;

  if (total <= 0) {
    alerts.push({
      field: 'total',
      severity: 'error',
      message: 'No se detectó un Monto Total mayor a S/ 0.00.',
    });
  }
  if (mathMismatch) {
    alerts.push({
      field: 'total',
      severity: 'error',
      message: `Cuadre aritmético: Subtotal (${subtotal.toFixed(2)}) + IGV (${igv.toFixed(
        2
      )}) = ${(subtotal + igv).toFixed(2)} no coincide con Total (${total.toFixed(2)}).`,
    });
  }
  if (wordsMismatch && parsedLetrasAmount !== null) {
    alerts.push({
      field: 'total',
      severity: 'error',
      message: `Discrepancia crítica con "SON:": literal dice S/ ${parsedLetrasAmount.toFixed(
        2
      )} pero el Total numérico indica S/ ${total.toFixed(2)}.`,
    });
  }
  if (params.tipoComprobante === 'FACTURA' && total > 0 && igv > 0 && detectedRatePct === null) {
    alerts.push({
      field: 'igv',
      severity: 'warning',
      message:
        'La tasa efectiva de IGV no corresponde exactamente a 18%, 10.5% (MYPE 2026) ni 10%. Verifica Subtotal e IGV.',
    });
  }

  return {
    subtotal,
    igv,
    total,
    mathVerified: !mathMismatch && !wordsMismatch && total > 0,
    mathMismatch,
    wordsMismatch,
    parsedLetrasAmount,
    detectedRatePct,
    alerts,
  };
}

export function classifyReceiptWithCriteria(
  text: string,
  criteria: ExpenseCriterion[]
): {
  naturaleza: NaturalezaGasto;
  categoria: string;
  subtipo: string;
} {
  const lower = stripAccents(text).toLowerCase();
  for (const c of criteria) {
    if (c.estado === 'INACTIVO') continue;
    const keywords = String(c.palabrasClaveIA || '')
      .split(',')
      .map((k) => stripAccents(k).trim().toLowerCase())
      .filter((k) => k.length >= 3);
    if (keywords.some((kw) => lower.includes(kw))) {
      return {
        naturaleza: c.naturaleza,
        categoria: c.categoriaForms || OFFICIAL_CATEGORIES[0],
        subtipo: c.subtipo || 'General',
      };
    }
  }

  if (/notaria|legaliz|certificacion\s+de\s+firma|apertura\s+libro|kardex/.test(lower)) {
    return {
      naturaleza: 'Costo Variable',
      categoria: 'Gastos legales',
      subtipo:
        criteria.find((c) => /legal|notar/i.test(c.categoriaForms + c.subtipo))?.subtipo ||
        'Notaría y Legalización',
    };
  }
  if (/lavand|lavado\s+al\s+peso/.test(lower)) {
    return {
      naturaleza: 'Costo Variable',
      categoria: 'Articulos de limpieza',
      subtipo:
        criteria.find((c) => /limpieza/i.test(c.categoriaForms))?.subtipo ||
        'Lavandería y Limpieza',
    };
  }
  if (/pollo|polleria|menu|restauran|torta|panader|gaseosa|galleta|fanta|refrigerio/.test(lower)) {
    return {
      naturaleza: 'Costo Variable',
      categoria: 'Atención al cliente y bienestar laboral',
      subtipo:
        criteria.find((c) => /refrigerio|atenci/i.test(c.subtipo + c.categoriaForms))?.subtipo ||
        'Refrigerios y Atención',
    };
  }
  if (/luz\s+de\s+emergencia|ferreter|foco|cable|mantenim/.test(lower)) {
    return {
      naturaleza: 'Costo Variable',
      categoria: 'Mantenimiento y reparación',
      subtipo:
        criteria.find((c) => /mantenim/i.test(c.categoriaForms))?.subtipo ||
        'Mantenimiento General',
    };
  }
  if (/botica|farmacia|inkafarma|mifarma|medic|bicarbonato|salud/.test(lower)) {
    return {
      naturaleza: 'Costo Variable',
      categoria: 'Atención al cliente y bienestar laboral',
      subtipo: 'Botiquín y Bienestar',
    };
  }
  if (/grifo|primax|repsol|gasolina|combustible|movilidad|taxi|pasaje/.test(lower)) {
    return {
      naturaleza: 'Costo Variable',
      categoria: 'Movilidad y transporte',
      subtipo: 'Combustible / Movilidad',
    };
  }

  return {
    naturaleza: 'Costo Variable',
    categoria: 'Otros gastos operativos',
    subtipo: criteria.find((c) => c.naturaleza === 'Costo Variable')?.subtipo || 'General',
  };
}

/**
 * Computes conservative offline confidence score (0..1).
 * Only reaches >= 0.95 when fields are corroborated cleanly (QR SUNAT + math + date,
 * or crisp printed spatial alignment with SON: / IGV math + Módulo 11 RUC + avg OCR conf >= 84).
 * Handwritten / ambiguous / blurry images stay < 0.95 so the hybrid pipeline triggers Gemini IA.
 */
export function computeOfflineConfidenceScore(params: {
  qrVerified: boolean;
  tipoComprobante: TipoComprobante;
  rucValid: boolean;
  hasSerie: boolean;
  hasValidDate: boolean;
  dateMissing: boolean;
  mathVerified: boolean;
  wordsMatched: boolean;
  hasRazonSocial: boolean;
  hasDescripcion: boolean;
  isTransfer: boolean;
  hasNumeroOperacion: boolean;
  ocrMeanConfidence?: number; // 0..100
}): number {
  const meanConf = params.ocrMeanConfidence ?? 0;

  if (params.qrVerified) {
    if (!params.rucValid || !params.hasSerie) return 0.78;
    let score = 0.94;
    if (params.hasValidDate && !params.dateMissing) score += 0.02;
    if (params.mathVerified) score += 0.02;
    if (params.wordsMatched) score += 0.01;
    if (params.hasRazonSocial && params.hasDescripcion) score += 0.01;
    // Penalize sharply if math fails even with QR
    if (!params.mathVerified) score -= 0.1;
    return round2(Math.max(0.5, Math.min(0.99, score)));
  }

  // No QR available: require crystal-clear OCR & structural corroboration to exceed 0.95
  if (params.isTransfer) {
    let score = 0.55;
    if (params.hasNumeroOperacion) score += 0.16;
    if (params.hasRazonSocial) score += 0.1;
    if (params.hasValidDate) score += 0.08;
    if (params.mathVerified) score += 0.07;
    if (meanConf < 78) score = Math.min(score, 0.88);
    return round2(Math.max(0.35, Math.min(0.96, score)));
  }

  let score = 0.45;
  if (params.rucValid) score += 0.18;
  if (params.hasSerie) score += 0.12;
  if (params.hasValidDate) score += 0.08;
  if (params.mathVerified) score += 0.09;
  if (params.wordsMatched) score += 0.05;
  if (params.hasRazonSocial) score += 0.02;
  if (params.hasDescripcion) score += 0.01;

  // Handwritten or low-contrast images never reach 95% from classical OCR alone -> escalate to Gemini
  if (meanConf > 0 && meanConf < 82) {
    score = Math.min(score, 0.84);
  }
  if ((params.tipoComprobante === 'FACTURA' || params.tipoComprobante === 'BOLETA') && !params.rucValid) {
    score = Math.min(score, 0.78);
  }
  if (!params.hasValidDate) {
    score = Math.min(score, 0.86);
  }

  return round2(Math.max(0.3, Math.min(0.97, score)));
}
