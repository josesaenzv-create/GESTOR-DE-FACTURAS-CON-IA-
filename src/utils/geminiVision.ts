import {
  CREDIBAN_COMPANY,
  OFFICIAL_CATEGORIES,
  type AiScanResult,
  type ExpenseCriterion,
  type NaturalezaGasto,
  type TipoComprobante,
} from '../types/crediban';
import { calculateIgvBreakdown, round2 } from './accounting';

import { parseMontoEnLetrasPeru as parseMontoEnLetrasPeruCore } from './invoiceValidator';

export const GEMINI_API_KEY_STORAGE_KEY = 'crediban_gemini_api_key';
export const SERVER_GEMINI_API_KEY_STORAGE_KEY = 'crediban_server_gemini_api_key';
export const GEMINI_MODEL_ID = 'gemini-flash-lite-latest';
export const GEMINI_FALLBACK_MODEL_ID = 'gemini-3-flash-preview';
export const GEMINI_CANDIDATE_MODELS = [
  'gemini-flash-lite-latest',
  'gemini-3-flash-preview',
  'gemini-flash-latest',
  'gemini-3.8-flash',
] as const;

export function buildGeminiEndpoint(modelId: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
}

export const GEMINI_ENDPOINT = buildGeminiEndpoint(GEMINI_MODEL_ID);
export const GEMINI_FALLBACK_ENDPOINT = buildGeminiEndpoint(GEMINI_FALLBACK_MODEL_ID);

export const GEMINI_MATH_ALERT_TEXT =
  '⚠️ Verifica el monto: Subtotal + IGV o el texto "SON..." no coincide exactamente con el Total';

export class GeminiApiError extends Error {
  status?: number;
  apiCode?: string;
  isNetworkError: boolean;

  constructor(
    message: string,
    opts?: { status?: number; apiCode?: string; isNetworkError?: boolean }
  ) {
    super(message);
    this.name = 'GeminiApiError';
    this.status = opts?.status;
    this.apiCode = opts?.apiCode;
    this.isNetworkError = Boolean(opts?.isNetworkError);
  }
}

export interface GeminiRawReceiptJson {
  transcripcionCabecera: string;
  transcripcionTotales: string;
  razonamientoAuditoria: string;
  tipoComprobante: string;
  serieCorrelativo: string;
  fechaEmision: string;
  rucEmisor: string;
  razonSocialEmisor: string;
  nombreComercialEmisor: string;
  montoEnLetras: string;
  subtotal: number;
  igv: number;
  total: number;
  descripcion: string;
  categoriaOficial: string;
  naturaleza: string;
  subtipo: string;
  confianzaLectura: number;
}

export interface AuditedGeminiOutput {
  result: AiScanResult;
  mathMismatch: boolean;
  wordsMismatch: boolean;
  parsedLetrasAmount: number | null;
  needsSecondPass: boolean;
  reasons: string[];
}

export function getStoredGeminiApiKey(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      return String(localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY) || '').trim();
    }
  } catch {
    // ignore storage access issues
  }
  return '';
}

export function getServerGeminiApiKey(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      return String(localStorage.getItem(SERVER_GEMINI_API_KEY_STORAGE_KEY) || '').trim();
    }
  } catch {
    // ignore storage access issues
  }
  return '';
}

export function saveServerGeminiApiKey(apiKey: string): string {
  const clean = String(apiKey || '').trim();
  try {
    if (typeof localStorage !== 'undefined') {
      if (clean) {
        localStorage.setItem(SERVER_GEMINI_API_KEY_STORAGE_KEY, clean);
      } else {
        localStorage.removeItem(SERVER_GEMINI_API_KEY_STORAGE_KEY);
      }
    }
  } catch {
    // ignore storage errors
  }
  return clean;
}

function isLikelyGeminiApiKey(val: string): boolean {
  const clean = val.trim();
  if (clean.length < 20 || /\s/.test(clean)) return false;
  if (clean.startsWith('{') || clean.startsWith('[') || clean.startsWith('<')) return false;
  return true;
}

export function extractApiKeyFromServerPayload(payload: unknown): string {
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return extractApiKeyFromServerPayload(JSON.parse(trimmed));
      } catch {
        return '';
      }
    }
    return isLikelyGeminiApiKey(trimmed) ? trimmed : '';
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = extractApiKeyFromServerPayload(item);
      if (found) return found;
    }
    return '';
  }

  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    const candidateKeys = [
      'geminiApiKey',
      'apiKey',
      'api_key',
      'claveGemini',
      'claveApi',
      'A1',
      'a1',
      'api',
      'API',
      'key',
      'value',
      'valor',
      'data',
    ];
    for (const k of candidateKeys) {
      if (obj[k] !== undefined && obj[k] !== null) {
        const found = extractApiKeyFromServerPayload(obj[k]);
        if (found) return found;
      }
    }
  }

  return '';
}

export function getEnvGeminiApiKey(): string {
  try {
    const meta = import.meta as unknown as {
      env?: Record<string, string | undefined>;
    };
    return String(meta?.env?.VITE_GEMINI_API_KEY || '').trim();
  } catch {
    return '';
  }
}

export function getEffectiveGeminiApiKey(): {
  apiKey: string;
  source: 'localStorage' | 'env' | 'server' | 'none';
} {
  const stored = getStoredGeminiApiKey();
  if (stored) return { apiKey: stored, source: 'localStorage' };
  const envKey = getEnvGeminiApiKey();
  if (envKey && envKey !== 'MY_GEMINI_API_KEY') {
    return { apiKey: envKey, source: 'env' };
  }
  const serverKey = getServerGeminiApiKey();
  if (serverKey) return { apiKey: serverKey, source: 'server' };
  return { apiKey: '', source: 'none' };
}

export function hasGeminiApiKey(): boolean {
  return Boolean(getEffectiveGeminiApiKey().apiKey);
}

export function saveStoredGeminiApiKey(apiKey: string): string {
  const clean = String(apiKey || '').trim();
  try {
    if (typeof localStorage !== 'undefined') {
      if (clean) {
        localStorage.setItem(GEMINI_API_KEY_STORAGE_KEY, clean);
      } else {
        localStorage.removeItem(GEMINI_API_KEY_STORAGE_KEY);
      }
    }
  } catch {
    // ignore storage errors
  }
  return clean;
}

export function clearStoredGeminiApiKey(): void {
  saveStoredGeminiApiKey('');
}

/**
 * Parses Peruvian receipt "SON: ..." amount-in-words lines such as:
 * "UN CON 80/100 SOLES" -> 1.80
 * "CIENTO OCHENTA Y CINCO CON 50/100 NUEVOS SOLES" -> 185.50
 * "MIL DOSCIENTOS CUARENTA CON 00/100 SOLES" -> 1240.00
 */
export function parseMontoEnLetrasPeru(raw: string | null | undefined): number | null {
  return parseMontoEnLetrasPeruCore(raw);
}

function normalizeGeminiDate(raw: string): string {
  const str = String(raw || '').trim();
  const iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  }
  const dmy4 = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})$/);
  if (dmy4) {
    return `${dmy4[3]}-${dmy4[2].padStart(2, '0')}-${dmy4[1].padStart(2, '0')}`;
  }
  const dmy2 = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (dmy2) {
    return `20${dmy2[3]}-${dmy2[2].padStart(2, '0')}-${dmy2[1].padStart(2, '0')}`;
  }
  return str;
}

function sanitizeSerieCorrelativo(
  rawSerie: string,
  transcripcionCabecera: string
): string {
  const clean = String(rawSerie || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  // Guard against SUNAT "Resolución de Intendencia" numbers like 034-005-0005315
  const isResolucionFormat = /^\d{3}-\d{3}-\d{5,}$/.test(clean);
  if (!clean || isResolucionFormat) {
    const matchHeader = String(transcripcionCabecera || '')
      .toUpperCase()
      .match(/\b([FBETMR][A-Z0-9]{2,3})\s*[-–—]\s*(\d{1,12})\b/);
    if (matchHeader) {
      return `${matchHeader[1]}-${matchHeader[2]}`;
    }
    return isResolucionFormat ? '' : clean;
  }
  return clean;
}

function normalizeTipoComprobante(
  rawTipo: string,
  expectedTipo?: TipoComprobante
): TipoComprobante {
  const upper = String(rawTipo || '').trim().toUpperCase();
  if (upper.includes('FACTURA')) return 'FACTURA';
  if (upper.includes('BOLETA')) return 'BOLETA';
  if (upper.includes('YAPE') || upper.includes('PLIN') || upper.includes('TRANSFER')) {
    return 'YAPE / PLIN / TRANSFERENCIA';
  }
  if (upper.includes('MOVILIDAD')) return 'RECIBO DE MOVILIDAD';
  if (upper.includes('RECIBO')) return 'RECIBO DE CAJA';
  if (upper.includes('TICKET')) return 'TICKET DE VENTA';
  if (upper.includes('SOLO')) return 'SOLO CAPTURA';
  return expectedTipo || 'BOLETA';
}

function resolveCategoryAndSubtype(
  rawCat: string,
  rawNat: string,
  rawSub: string,
  criteria: ExpenseCriterion[]
): { categoria: string; naturaleza: NaturalezaGasto; subtipo: string } {
  const nat: NaturalezaGasto = String(rawNat || '').toLowerCase().includes('fijo')
    ? 'Costo Fijo'
    : 'Costo Variable';

  const catLower = String(rawCat || '').trim().toLowerCase();
  const matchedOfficial =
    OFFICIAL_CATEGORIES.find((c) => c.toLowerCase() === catLower) ||
    OFFICIAL_CATEGORIES.find(
      (c) => catLower && (c.toLowerCase().includes(catLower) || catLower.includes(c.toLowerCase()))
    ) ||
    'Otros gastos operativos';

  const activeCriteria = criteria.filter((c) => c.estado !== 'INACTIVO');
  const subLower = String(rawSub || '').trim().toLowerCase();
  const matchedCrit =
    activeCriteria.find((c) => c.subtipo.toLowerCase() === subLower) ||
    activeCriteria.find(
      (c) =>
        subLower &&
        (c.subtipo.toLowerCase().includes(subLower) || subLower.includes(c.subtipo.toLowerCase()))
    ) ||
    activeCriteria.find(
      (c) => c.categoriaForms.toLowerCase() === matchedOfficial.toLowerCase()
    );

  return {
    categoria: matchedOfficial,
    naturaleza: matchedCrit?.naturaleza || nat,
    subtipo: matchedCrit?.subtipo || String(rawSub || '').trim() || 'General',
  };
}

/**
 * Audits Gemini's structured output mathematically and structurally:
 * - Excludes CREDIBAN client RUC (20613997360)
 * - Excludes Resolución de Intendencia numbers
 * - Auto-splits 18% IGV on FACTURA only when ticket omitted subtotal & igv
 * - Verifies |subtotal + igv - total| <= 0.02 and consistency with "SON: ... SOLES"
 * - Flags whether a second precision verification pass is required
 */
export function auditGeminiExtraction(
  raw: Partial<GeminiRawReceiptJson>,
  criteria: ExpenseCriterion[],
  expectedTipo?: TipoComprobante
): AuditedGeminiOutput {
  const tipoComprobante = normalizeTipoComprobante(
    raw.tipoComprobante || '',
    expectedTipo
  );
  const transcripcionCabecera = String(raw.transcripcionCabecera || '').trim();
  const transcripcionTotales = String(raw.transcripcionTotales || '').trim();
  const razonamientoAuditoria = String(raw.razonamientoAuditoria || '').trim();
  const montoEnLetras = String(raw.montoEnLetras || '').trim();

  // RUC exclusion: never accept CREDIBAN client RUC
  let ruc = String(raw.rucEmisor || '').replace(/\D/g, '');
  if (ruc === CREDIBAN_COMPANY.ruc) {
    ruc = '';
  }

  const numeroComprobante = sanitizeSerieCorrelativo(
    raw.serieCorrelativo || '',
    transcripcionCabecera
  );

  const fechaEmision =
    normalizeGeminiDate(raw.fechaEmision || '') || new Date().toISOString().slice(0, 10);

  let total = round2(Math.max(0, Number(raw.total) || 0));
  let subtotal = round2(Math.max(0, Number(raw.subtotal) || 0));
  let igv = round2(Math.max(0, Number(raw.igv) || 0));

  // If FACTURA omitted breakdown on the ticket, compute 18% IGV breakdown cleanly
  if (tipoComprobante === 'FACTURA' && subtotal === 0 && igv === 0 && total > 0) {
    const calc = calculateIgvBreakdown(total, 'FACTURA');
    subtotal = calc.subtotal;
    igv = calc.igv;
  } else if (tipoComprobante !== 'FACTURA') {
    if (subtotal === 0 && igv === 0 && total > 0) {
      subtotal = total;
      igv = 0;
    }
  }

  const mathMismatch =
    total > 0 && Math.abs(round2(subtotal + igv) - total) > 0.02;

  const parsedLetrasAmount = parseMontoEnLetrasPeru(montoEnLetras);
  const wordsMismatch =
    parsedLetrasAmount !== null &&
    total > 0 &&
    Math.abs(parsedLetrasAmount - total) > 0.02;

  const rawConf = Number(raw.confianzaLectura);
  const confianzaLectura = Number.isFinite(rawConf)
    ? Math.max(0, Math.min(100, Math.round(rawConf)))
    : 75;

  const reasons: string[] = [];
  if (mathMismatch) {
    reasons.push(
      `Subtotal (${subtotal.toFixed(2)}) + IGV (${igv.toFixed(2)}) = ${(subtotal + igv).toFixed(2)} difiere de Total (${total.toFixed(2)})`
    );
  }
  if (wordsMismatch && parsedLetrasAmount !== null) {
    reasons.push(
      `Texto "${montoEnLetras}" (${parsedLetrasAmount.toFixed(2)}) difiere de Total (${total.toFixed(2)})`
    );
  }
  if (confianzaLectura < 85) {
    reasons.push(`Confianza inicial (${confianzaLectura}%) por debajo de 85%`);
  }
  if (total <= 0) {
    reasons.push('Total numérico faltante o cero');
  }

  const needsSecondPass =
    mathMismatch || wordsMismatch || confianzaLectura < 85 || total <= 0;

  const { categoria, naturaleza, subtipo } = resolveCategoryAndSubtype(
    raw.categoriaOficial || '',
    raw.naturaleza || '',
    raw.subtipo || '',
    criteria
  );

  // Strip store name if repeated at start of descripcion
  let razonSocial = String(raw.razonSocialEmisor || '').trim().toUpperCase();
  let nombreComercial = String(raw.nombreComercialEmisor || '').trim();
  if (razonSocial.includes('CREDIBAN')) {
    razonSocial = '';
  }

  let descripcion = String(raw.descripcion || '').trim();
  if (nombreComercial && descripcion.toUpperCase().startsWith(nombreComercial.toUpperCase())) {
    descripcion = descripcion.slice(nombreComercial.length).replace(/^[\s\-–:]+/, '').trim();
  }

  // Detect digital transfer hints if Yape/Plin
  const headerUpper = transcripcionCabecera.toUpperCase();
  const isTransfer = tipoComprobante === 'YAPE / PLIN / TRANSFERENCIA';
  let entidadPago = '';
  if (isTransfer) {
    if (headerUpper.includes('YAPE')) entidadPago = 'YAPE';
    else if (headerUpper.includes('PLIN')) entidadPago = 'PLIN';
    else if (headerUpper.includes('BCP')) entidadPago = 'BCP';
    else if (headerUpper.includes('BBVA')) entidadPago = 'BBVA';
    else if (headerUpper.includes('INTERBANK')) entidadPago = 'INTERBANK';
    else if (headerUpper.includes('SCOTIABANK')) entidadPago = 'SCOTIABANK';
  }

  const mathVerified = !mathMismatch && !wordsMismatch && total > 0;
  const mathAlert =
    mathMismatch || wordsMismatch ? GEMINI_MATH_ALERT_TEXT : undefined;

  const result: AiScanResult = {
    tipoComprobante,
    numeroComprobante,
    fechaEmision,
    ruc,
    razonSocial,
    nombreComercial,
    titularCuenta: isTransfer ? razonSocial : '',
    numeroOperacion: isTransfer ? numeroComprobante.replace(/^OP-/i, '') : '',
    entidadPago,
    subtotal,
    igv,
    total,
    naturaleza,
    categoria,
    subtipo,
    descripcion,
    scoreConfiabilidad: round2(confianzaLectura / 100),
    confianzaLectura,
    transcripcionCabecera,
    transcripcionTotales,
    razonamientoAuditoria,
    montoEnLetras,
    mathVerified,
    mathAlert,
  };

  return {
    result,
    mathMismatch,
    wordsMismatch,
    parsedLetrasAmount,
    needsSecondPass,
    reasons,
  };
}

export const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcripcionCabecera: {
      type: 'STRING',
      description:
        'Transcripción literal de las líneas superiores del documento (nombre comercial, razón social, RUC emisor, tipo de comprobante y serie-correlativo).',
    },
    transcripcionTotales: {
      type: 'STRING',
      description:
        'Transcripción literal exacta de la zona de totales (Op. Gravada / Total Gravado / Subtotal, IGV, Total Venta y la línea "SON: ... SOLES").',
    },
    razonamientoAuditoria: {
      type: 'STRING',
      description:
        'Verificación paso a paso confirmando que Subtotal + IGV = Total y que coincide exactamente con el monto en letras (ej. 1.53 + 0.27 = 1.80, UN CON 80/100 SOLES).',
    },
    tipoComprobante: {
      type: 'STRING',
      enum: [
        'FACTURA',
        'BOLETA',
        'TICKET DE VENTA',
        'RECIBO DE CAJA',
        'RECIBO DE MOVILIDAD',
        'YAPE / PLIN / TRANSFERENCIA',
        'SOLO CAPTURA',
      ],
    },
    serieCorrelativo: {
      type: 'STRING',
      description:
        'Exclusivamente la serie y número del comprobante (ej. F001-00034719, B001-001234, E001-45). NUNCA extraer Resolución de Intendencia, Autorización SUNAT, Proforma ni Ticket interno.',
    },
    fechaEmision: {
      type: 'STRING',
      description:
        'Fecha impresa en formato YYYY-MM-DD. Convierte años de 2 dígitos como 13/11/26 a 2026-11-13. Nunca uses la fecha de hoy si hay fecha impresa.',
    },
    rucEmisor: {
      type: 'STRING',
      description:
        'RUC de 11 dígitos o DNI de 8 del EMISOR (quien vende). PROHIBIDO devolver 20613997360 (CREDIBAN PERU S.A.C.) o datos bajo Datos del cliente.',
    },
    razonSocialEmisor: {
      type: 'STRING',
      description: 'Razón social legal completa del emisor (ej. FARMACIA HIROMI S.A.C.).',
    },
    nombreComercialEmisor: {
      type: 'STRING',
      description: 'Nombre comercial o marca si aparece (ej. BOTICA CENTRAL), o "" si no tiene.',
    },
    montoEnLetras: {
      type: 'STRING',
      description: 'Texto literal después de "SON:" (ej. "UN CON 80/100 SOLES").',
    },
    subtotal: {
      type: 'NUMBER',
      description: 'Número decimal exacto de Op. Gravada / Total Gravado / Subtotal impreso.',
    },
    igv: {
      type: 'NUMBER',
      description: 'Número decimal exacto de I.G.V. impreso (0.00 si es Boleta o Recibo).',
    },
    total: {
      type: 'NUMBER',
      description: 'Número decimal exacto de Total Venta / Importe Total impreso.',
    },
    descripcion: {
      type: 'STRING',
      description:
        'Lista limpia y concreta de los productos o servicios comprados con cantidad (ej. "BICARBONATO SODIO 100G-ALKOFA (1u)"). PROHIBIDO incluir el nombre de la tienda.',
    },
    categoriaOficial: {
      type: 'STRING',
      description: 'Una de las 19 categorías oficiales exactas de CREDIBAN.',
    },
    naturaleza: {
      type: 'STRING',
      enum: ['Costo Fijo', 'Costo Variable'],
    },
    subtipo: {
      type: 'STRING',
      description: 'Subtipo específico del catálogo de CREDIBAN.',
    },
    confianzaLectura: {
      type: 'INTEGER',
      description: 'Entero de 0 a 100 según nitidez y consistencia matemática.',
    },
  },
  required: [
    'transcripcionCabecera',
    'transcripcionTotales',
    'razonamientoAuditoria',
    'tipoComprobante',
    'serieCorrelativo',
    'fechaEmision',
    'rucEmisor',
    'razonSocialEmisor',
    'nombreComercialEmisor',
    'montoEnLetras',
    'subtotal',
    'igv',
    'total',
    'descripcion',
    'categoriaOficial',
    'naturaleza',
    'subtipo',
    'confianzaLectura',
  ],
  propertyOrdering: [
    'transcripcionCabecera',
    'transcripcionTotales',
    'razonamientoAuditoria',
    'tipoComprobante',
    'serieCorrelativo',
    'fechaEmision',
    'rucEmisor',
    'razonSocialEmisor',
    'nombreComercialEmisor',
    'montoEnLetras',
    'subtotal',
    'igv',
    'total',
    'descripcion',
    'categoriaOficial',
    'naturaleza',
    'subtipo',
    'confianzaLectura',
  ],
} as const;

export function buildGeminiRequestPayload(params: {
  imageBase64: string;
  mimeType: string;
  criteria: ExpenseCriterion[];
  expectedTipo?: TipoComprobante;
  secondPassContext?: {
    previousResult: AiScanResult;
    reasons: string[];
  };
}): Record<string, unknown> {
  const activeCatalog = params.criteria
    .filter((c) => c.estado !== 'INACTIVO')
    .slice(0, 35)
    .map(
      (c) =>
        `- [${c.naturaleza}] Categoría: "${c.categoriaForms}" | Subtipo: "${c.subtipo}" (Claves: ${c.palabrasClaveIA || c.subtipo})`
    )
    .join('\n');

  const officialList = OFFICIAL_CATEGORIES.join(' | ');

  let prompt = `Eres un auditor contable peruano experto en comprobantes electrónicos SUNAT (Facturas, Boletas, Tickets POS, Recibos de Caja y constancias Yape/Plin).
Analiza la imagen adjunta con MÁXIMA PRECISIÓN VISUAL Y MATEMÁTICA.

REGLAS CRÍTICAS OBLIGATORIAS:
1. Primero transcribe literalmente la cabecera en "transcripcionCabecera" y la zona de totales + texto "SON:" en "transcripcionTotales".
2. Revisa con lupa cada punto o coma decimal en papel térmico: NUNCA confundas 1.80 con 180.00 ni 3.00 con 300.00. Usa la línea "SON: ... SOLES" para validar el monto exacto.
3. En "razonamientoAuditoria" comprueba explícitamente: Subtotal + IGV = Total, y que coincide con "montoEnLetras".
4. "rucEmisor": Extrae ÚNICAMENTE el RUC/DNI del EMISOR (quien vende, arriba). PROHIBIDO extraer el RUC ${CREDIBAN_COMPANY.ruc} (que es del cliente ${CREDIBAN_COMPANY.nombre}) ni ningún dato bajo "Datos del cliente" o "Señor(es)".
5. "serieCorrelativo": Extrae EXCLUSIVAMENTE la serie-correlativo del comprobante (ej. F001-00034719). PROHIBIDO extraer números de "Resolución de Intendencia" (ej. 034-005-0005315), "Autorización SUNAT", "Proforma" o "Ticket interno". Si es captura Yape/Plin sin serie, extrae el N° de Operación.
6. "fechaEmision": Formato exacto "YYYY-MM-DD". Lee cada dígito con cuidado (ej. 3 vs 8). Si dice 13/11/26, devuelve "2026-11-13".
7. "descripcion": Lista limpia de ítems/servicios comprados con cantidad (ej. "BICARBONATO SODIO 100G-ALKOFA (1u)"). PROHIBIDO incluir el nombre de la tienda o razón social aquí.
8. Tipo esperado seleccionado por el usuario: "${params.expectedTipo || 'FACTURA'}" (respeta el documento real si la imagen muestra claramente otro tipo).
9. Clasifica "categoriaOficial" usando EXACTAMENTE una de estas 19 categorías:
${officialList}
Y elige "naturaleza" y "subtipo" del catálogo CREDIBAN:
${activeCatalog}`;

  if (params.secondPassContext) {
    const prev = params.secondPassContext.previousResult;
    prompt += `\n\n⚠️ SEGUNDA PASADA DE CORRECCIÓN OBLIGATORIA:
En la lectura anterior hubo una inconsistencia entre Subtotal, IGV, Total y el texto 'SON...' (o baja confianza):
- Motivos detectados: ${params.secondPassContext.reasons.join(' | ')}
- Lectura previa reportada: Subtotal=${prev.subtotal}, IGV=${prev.igv}, Total=${prev.total}, SON="${prev.montoEnLetras || ''}", Serie="${prev.numeroComprobante}", Fecha="${prev.fechaEmision}".
Revisa los decimales y dígitos con lupa en la imagen original y devuelve el JSON 100% corregido y consistente.`;
  }

  return {
    contents: [
      {
        parts: [
          {
            inline_data: {
              mime_type: params.mimeType || 'image/jpeg',
              data: params.imageBase64,
            },
          },
          {
            text: prompt,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.0,
      topP: 0.1,
      topK: 1,
      responseMimeType: 'application/json',
      responseSchema: GEMINI_RESPONSE_SCHEMA,
    },
  };
}

async function postToGeminiUrl(
  endpointUrl: string,
  apiKey: string,
  payload: Record<string, unknown>,
  timeoutMs: number
): Promise<{ response: Response; rawText: string; data: Record<string, unknown> | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${endpointUrl}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    throw new GeminiApiError(
      isAbort
        ? 'Tiempo de espera agotado al conectar con Gemini API. Verifica tu internet e intenta nuevamente.'
        : `Error de red al conectar con Gemini API: ${
            err instanceof Error ? err.message : 'Sin conexión a internet'
          }`,
      { isNetworkError: true }
    );
  } finally {
    clearTimeout(timer);
  }

  let data: Record<string, unknown> | null = null;
  const rawText = await response.text();
  try {
    data = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    data = null;
  }
  return { response, rawText, data };
}

const RETRYABLE_GEMINI_STATUSES = new Set([400, 403, 404, 429, 500, 502, 503, 504]);

function formatGeminiFailureMessage(params: {
  status: number;
  apiStatus?: string;
  exactMessage: string;
}): string {
  const { status, apiStatus, exactMessage } = params;
  const codeLabel = apiStatus ? ` (${status} ${apiStatus})` : ` (${status})`;
  if (/PROXY_GENERATION_DISABLED/i.test(exactMessage)) {
    return `Error API Gemini${codeLabel}: ${exactMessage}. Esta clave está bloqueada para llamadas directas desde el navegador. En Configuración presiona "Borrar" para usar la clave de la Hoja API!A1 del Servidor o pega una clave AIzaSy... de Google AI Studio.`;
  }
  return `Error API Gemini${codeLabel}: ${exactMessage}`;
}

async function callGeminiEndpoint(
  apiKey: string,
  payload: Record<string, unknown>,
  timeoutMs = 18000
): Promise<GeminiRawReceiptJson> {
  let attempt: { response: Response; rawText: string; data: Record<string, unknown> | null } | null =
    null;

  for (let i = 0; i < GEMINI_CANDIDATE_MODELS.length; i++) {
    const modelId = GEMINI_CANDIDATE_MODELS[i];
    attempt = await postToGeminiUrl(buildGeminiEndpoint(modelId), apiKey, payload, timeoutMs);
    if (attempt.response.ok) break;
    if (!RETRYABLE_GEMINI_STATUSES.has(attempt.response.status)) break;
    if (i < GEMINI_CANDIDATE_MODELS.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  // Final single retry on secondary model if primary endpoints hit transient 503 overload
  if (attempt && !attempt.response.ok && [429, 500, 502, 503, 504].includes(attempt.response.status)) {
    await new Promise((resolve) => setTimeout(resolve, 1100));
    attempt = await postToGeminiUrl(
      buildGeminiEndpoint(GEMINI_FALLBACK_MODEL_ID),
      apiKey,
      payload,
      timeoutMs
    );
  }

  if (!attempt) {
    throw new GeminiApiError('No se pudo conectar con ningún modelo de Gemini.');
  }

  const { response, rawText, data } = attempt;

  if (!response.ok) {
    const errObj = (data?.error || {}) as {
      message?: string;
      status?: string;
      code?: number;
    };
    const exactMessage =
      errObj.message ||
      rawText.slice(0, 300) ||
      `HTTP ${response.status} ${response.statusText}`;
    throw new GeminiApiError(
      formatGeminiFailureMessage({
        status: response.status,
        apiStatus: errObj.status,
        exactMessage,
      }),
      {
        status: response.status,
        apiCode: errObj.status,
        isNetworkError: false,
      }
    );
  }

  const candidates = (data?.candidates || []) as Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  const jsonText = candidates?.[0]?.content?.parts?.[0]?.text;
  if (!jsonText) {
    throw new GeminiApiError(
      `La API de Gemini no devolvió contenido legible (finishReason: ${
        candidates?.[0]?.finishReason || 'desconocido'
      }).`
    );
  }

  try {
    return JSON.parse(jsonText) as GeminiRawReceiptJson;
  } catch {
    // Strip accidental markdown fences if any
    const cleaned = jsonText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    return JSON.parse(cleaned) as GeminiRawReceiptJson;
  }
}

export async function scanReceiptWithGemini(params: {
  apiKey: string;
  imageBase64: string;
  mimeType: string;
  criteria: ExpenseCriterion[];
  expectedTipo?: TipoComprobante;
  onProgress?: (pct: number, step: string) => void;
}): Promise<AiScanResult> {
  const cleanKey = params.apiKey.trim();
  if (!cleanKey) {
    throw new GeminiApiError(
      'Falta configurar tu Gemini API Key gratuita para usar el escáner IA de alta precisión.'
    );
  }

  params.onProgress?.(25, 'Analizando comprobante con Gemini Flash IA (Alta Precisión)...');
  const pass1Payload = buildGeminiRequestPayload({
    imageBase64: params.imageBase64,
    mimeType: params.mimeType,
    criteria: params.criteria,
    expectedTipo: params.expectedTipo,
  });

  const pass1Raw = await callGeminiEndpoint(cleanKey, pass1Payload);
  params.onProgress?.(60, 'Auditando cuadre matemático y monto en letras...');
  const pass1Audit = auditGeminiExtraction(
    pass1Raw,
    params.criteria,
    params.expectedTipo
  );

  if (!pass1Audit.needsSecondPass) {
    params.onProgress?.(100, 'Lectura matemática verificada.');
    return {
      ...pass1Audit.result,
      secondPassTriggered: false,
    };
  }

  // Automatic Second Pass for Precision Verification
  params.onProgress?.(
    76,
    'Inconsistencia o baja nitidez detectada: ejecutando segunda pasada de verificación con lupa...'
  );

  try {
    const pass2Payload = buildGeminiRequestPayload({
      imageBase64: params.imageBase64,
      mimeType: params.mimeType,
      criteria: params.criteria,
      expectedTipo: params.expectedTipo,
      secondPassContext: {
        previousResult: pass1Audit.result,
        reasons: pass1Audit.reasons,
      },
    });
    const pass2Raw = await callGeminiEndpoint(cleanKey, pass2Payload);
    const pass2Audit = auditGeminiExtraction(
      pass2Raw,
      params.criteria,
      params.expectedTipo
    );

    params.onProgress?.(100, 'Doble verificación completada.');

    const pass1Errors =
      (pass1Audit.mathMismatch ? 1 : 0) + (pass1Audit.wordsMismatch ? 1 : 0);
    const pass2Errors =
      (pass2Audit.mathMismatch ? 1 : 0) + (pass2Audit.wordsMismatch ? 1 : 0);

    const best =
      pass2Errors < pass1Errors ||
      (pass2Errors === pass1Errors &&
        (pass2Audit.result.confianzaLectura || 0) >=
          (pass1Audit.result.confianzaLectura || 0))
        ? pass2Audit.result
        : pass1Audit.result;

    return {
      ...best,
      secondPassTriggered: true,
    };
  } catch {
    // If second pass fails due to transient error/timeout, return pass1 result with its alert intact
    params.onProgress?.(100, 'Lectura completada con advertencia de verificación.');
    return {
      ...pass1Audit.result,
      secondPassTriggered: true,
    };
  }
}

export interface GeminiApiHealthStatus {
  status: 'connected' | 'missing' | 'error';
  model?: string;
  message: string;
  isProxyRestricted?: boolean;
}

export async function testGeminiApiKeyConnection(
  apiKey: string
): Promise<{ ok: boolean; message: string; model?: string; isProxyRestricted?: boolean }> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    return { ok: false, message: 'Ingresa una Gemini API Key primero.' };
  }

  try {
    const testPayload = {
      contents: [{ parts: [{ text: 'Responde únicamente: OK' }] }],
      generationConfig: {
        temperature: 0.0,
        maxOutputTokens: 256,
      },
    };

    let lastAttempt: {
      response: Response;
      rawText: string;
      data: Record<string, unknown> | null;
    } | null = null;
    let activeModel: string = GEMINI_MODEL_ID;

    for (const modelId of GEMINI_CANDIDATE_MODELS) {
      activeModel = modelId;
      lastAttempt = await postToGeminiUrl(buildGeminiEndpoint(modelId), cleanKey, testPayload, 12000);
      if (lastAttempt.response.ok) {
        return {
          ok: true,
          model: activeModel,
          message: `Conexión exitosa con ${activeModel}. El escáner IA de alta precisión está listo.`,
        };
      }
      if (!RETRYABLE_GEMINI_STATUSES.has(lastAttempt.response.status)) {
        break;
      }
    }

    const res = lastAttempt?.response;
    const raw = lastAttempt?.rawText || '';
    const parsed = lastAttempt?.data || null;
    const errObj = (parsed?.error || {}) as { message?: string; status?: string };
    const exactMsg = errObj.message || raw.slice(0, 200) || res?.statusText || 'Error desconocido';
    const isProxyRestricted = /PROXY_GENERATION_DISABLED/i.test(exactMsg);

    return {
      ok: false,
      isProxyRestricted,
      message: formatGeminiFailureMessage({
        status: res?.status || 400,
        apiStatus: errObj.status,
        exactMessage: exactMsg,
      }),
    };
  } catch (err) {
    return {
      ok: false,
      message: `Error de red al probar Gemini API: ${
        err instanceof Error ? err.message : 'Sin conexión'
      }`,
    };
  }
}

export async function checkGeminiApiHealth(apiKey: string): Promise<GeminiApiHealthStatus> {
  const clean = String(apiKey || '').trim();
  if (!clean) {
    return {
      status: 'missing',
      message: 'Sin Gemini API Key (se usará QR + OCR offline; configura API!A1 o clave en Config)',
    };
  }
  const probe = await testGeminiApiKeyConnection(clean);
  if (probe.ok) {
    return {
      status: 'connected',
      model: probe.model,
      message: probe.message,
    };
  }
  return {
    status: 'error',
    message: probe.message,
    isProxyRestricted: probe.isProxyRestricted,
  };
}
