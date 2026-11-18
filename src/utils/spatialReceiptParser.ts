import {
  CREDIBAN_COMPANY,
  type AiScanResult,
  type ExpenseCriterion,
  type TipoComprobante,
} from '../types/crediban';
import { parseCommaDecimal, round2 } from './accounting';
import {
  classifyReceiptWithCriteria,
  computeOfflineConfidenceScore,
  isCredibanClientRuc,
  isLegalFooterNoiseLine,
  normalizePeruDateIso,
  parseMontoEnLetrasPeru,
  repairOcrNumericToken,
  sanitizeSerieCorrelativo,
  shouldAcceptEmitterRuc,
  stripAccents,
  validatePeruTaxAndMath,
  validateSunatRucMod11,
} from './invoiceValidator';
import type { SunatQrParsedData } from './sunatQrParser';

export interface SpatialOcrToken {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  confidence?: number;
}

export interface ClusteredOcrRow {
  yCenter: number;
  yMin: number;
  yMax: number;
  tokens: SpatialOcrToken[];
  text: string;
  meanConfidence: number;
}

function cleanText(raw: string): string {
  return String(raw || '')
    .replace(/[|]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Extracts SpatialOcrToken[] from Tesseract.js v7 output (blocks -> paragraphs -> lines -> words).
 */
export function extractSpatialTokensFromTesseract(data: {
  blocks?: Array<{
    paragraphs?: Array<{
      lines?: Array<{
        text?: string;
        confidence?: number;
        bbox?: { x0: number; y0: number; x1: number; y1: number };
        words?: Array<{
          text?: string;
          confidence?: number;
          bbox?: { x0: number; y0: number; x1: number; y1: number };
        }>;
      }>;
    }>;
  }> | null;
  words?: Array<{
    text?: string;
    confidence?: number;
    bbox?: { x0: number; y0: number; x1: number; y1: number };
  }>;
  lines?: Array<{
    text?: string;
    confidence?: number;
    bbox?: { x0: number; y0: number; x1: number; y1: number };
  }>;
}): SpatialOcrToken[] {
  const tokens: SpatialOcrToken[] = [];

  if (Array.isArray(data.blocks)) {
    for (const block of data.blocks) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          if (Array.isArray(line.words) && line.words.length > 0) {
            for (const w of line.words) {
              if (!w.text?.trim() || !w.bbox) continue;
              tokens.push({
                text: w.text.trim(),
                x0: w.bbox.x0,
                y0: w.bbox.y0,
                x1: w.bbox.x1,
                y1: w.bbox.y1,
                confidence: w.confidence ?? line.confidence ?? 80,
              });
            }
          } else if (line.text?.trim() && line.bbox) {
            tokens.push({
              text: line.text.trim(),
              x0: line.bbox.x0,
              y0: line.bbox.y0,
              x1: line.bbox.x1,
              y1: line.bbox.y1,
              confidence: line.confidence ?? 80,
            });
          }
        }
      }
    }
  }

  if (tokens.length === 0 && Array.isArray(data.words)) {
    for (const w of data.words) {
      if (!w.text?.trim() || !w.bbox) continue;
      tokens.push({
        text: w.text.trim(),
        x0: w.bbox.x0,
        y0: w.bbox.y0,
        x1: w.bbox.x1,
        y1: w.bbox.y1,
        confidence: w.confidence ?? 80,
      });
    }
  }

  if (tokens.length === 0 && Array.isArray(data.lines)) {
    for (const l of data.lines) {
      if (!l.text?.trim() || !l.bbox) continue;
      tokens.push({
        text: l.text.trim(),
        x0: l.bbox.x0,
        y0: l.bbox.y0,
        x1: l.bbox.x1,
        y1: l.bbox.y1,
        confidence: l.confidence ?? 80,
      });
    }
  }

  return tokens;
}

/**
 * Spatial Row-Clustering:
 * Groups OCR boxes sharing similar Y-center into logical horizontal rows
 * and orders each row strictly from left to right (X ascending).
 */
export function clusterOcrTokensIntoRows(tokens: SpatialOcrToken[]): ClusteredOcrRow[] {
  const valid = tokens.filter((t) => cleanText(t.text).length > 0);
  if (valid.length === 0) return [];

  const heights = valid
    .map((t) => Math.max(4, t.y1 - t.y0))
    .sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 16;
  const yTolerance = Math.max(8, medianH * 0.58);

  const sorted = [...valid].sort((a, b) => {
    const ay = (a.y0 + a.y1) / 2;
    const by = (b.y0 + b.y1) / 2;
    return ay - by || a.x0 - b.x0;
  });

  const rows: Array<{ sumY: number; count: number; tokens: SpatialOcrToken[] }> = [];

  for (const tok of sorted) {
    const cy = (tok.y0 + tok.y1) / 2;
    let bestRow: (typeof rows)[number] | null = null;
    let bestDist = Infinity;

    for (const row of rows) {
      const avgY = row.sumY / row.count;
      const dist = Math.abs(cy - avgY);
      if (dist <= yTolerance && dist < bestDist) {
        bestDist = dist;
        bestRow = row;
      }
    }

    if (bestRow) {
      bestRow.tokens.push(tok);
      bestRow.sumY += cy;
      bestRow.count += 1;
    } else {
      rows.push({ sumY: cy, count: 1, tokens: [tok] });
    }
  }

  return rows
    .map((r) => {
      const ordered = [...r.tokens].sort((a, b) => a.x0 - b.x0);
      const yMin = Math.min(...ordered.map((t) => t.y0));
      const yMax = Math.max(...ordered.map((t) => t.y1));
      const text = cleanText(ordered.map((t) => t.text).join(' '));
      const confs = ordered.map((t) => t.confidence ?? 80);
      const meanConfidence = confs.reduce((a, b) => a + b, 0) / confs.length;
      return {
        yCenter: r.sumY / r.count,
        yMin,
        yMax,
        tokens: ordered,
        text,
        meanConfidence,
      };
    })
    .filter((r) => r.text.length > 0)
    .sort((a, b) => a.yCenter - b.yCenter);
}

function buildRowsFromPlainText(rawText: string): ClusteredOcrRow[] {
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map((l) => cleanText(l))
    .filter(Boolean);
  return lines.map((text, idx) => ({
    yCenter: idx * 24 + 12,
    yMin: idx * 24,
    yMax: idx * 24 + 20,
    tokens: text.split(/\s+/).map((tok, tIdx) => ({
      text: tok,
      x0: tIdx * 60,
      y0: idx * 24,
      x1: (tIdx + 1) * 60,
      y1: idx * 24 + 20,
      confidence: 82,
    })),
    text,
    meanConfidence: 82,
  }));
}

function extractRightmostMoneyOnRow(rowText: string): number | null {
  const normalized = stripAccents(rowText).replace(/[Ss]\s*\/\s*\.?/g, 'S/ ');
  const candidates = normalized.match(/[0-9OQIl,$]{1,7}[.,][0-9OIl]{2}/g);
  if (!candidates || candidates.length === 0) return null;
  const lastRaw = candidates[candidates.length - 1];
  const repaired = repairOcrNumericToken(lastRaw).replace(/[^0-9.]/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(repaired)) return null;
  const parsed = parseCommaDecimal(repaired);
  return parsed >= 0 ? parsed : null;
}

const NOISE_HEADER_LINE_REGEX =
  /\b(?:IMPRIMIR|VERSION\s+GRATUITA|COMPRA\s+TU\s+LICENCIA|FRASE\s+DEL\s+MES|EMPRENDER|SUENOS|REPRESENTACION|GRACIAS|CONSULT|WWW\.|HTTP|@|TEL[EF]?\.|CEL\.|AV\.|JR\.|CAL\.|URB\.|MZA\.|LOTE|ANCASH|HUARAZ|LIMA|HUACHO|R\.?U\.?C\.?|FACTURA|BOLETA|NOTA\s+DE\s+(?:VENTA|PEDIDO)|FECHA|MONEDA|FORMA\s+DE\s+PAGO)\b/i;

function extractEmitterZoneAndRuc(rows: ClusteredOcrRow[]): {
  rucEmisor: string;
  razonSocial: string;
  nombreComercial: string;
} {
  // Collect client / footer RUCs to exclude explicitly (CREDIBAN, Adquiriente, Imprenta)
  const excludedRucs: string[] = [CREDIBAN_COMPANY.ruc];
  let inClientBlock = false;

  for (let i = 0; i < rows.length; i++) {
    const upper = stripAccents(rows[i].text).toUpperCase();
    if (/\b(?:CLIENTE|ADQUIRIENTE|SENOR|SENORES|RAZON\s+SOCIAL\s+CLIENTE)\b/.test(upper)) {
      inClientBlock = true;
    } else if (/\b(?:CANT|DESCRIPCION|PRODUCTO|OP\.?\s*GRAVADA|SUBTOTAL)\b/.test(upper)) {
      inClientBlock = false;
    }

    const rucMatches = upper.match(/\b(?:10|15|17|20)\d{9}\b/g) || [];
    for (const r of rucMatches) {
      if (inClientBlock || isLegalFooterNoiseLine(upper) || /\b(?:IMPRENTA|AUT\.|F\.I\.)\b/.test(upper)) {
        if (!excludedRucs.includes(r)) excludedRucs.push(r);
      }
    }
  }

  // Locate primary emitter RUC row (typically top 60% of rows and before client block)
  let rucEmisor = '';
  let rucRowIndex = -1;

  for (let i = 0; i < rows.length; i++) {
    const upper = stripAccents(rows[i].text).toUpperCase();
    if (/\b(?:CLIENTE|ADQUIRIENTE|SENOR|SENORES)\b/.test(upper)) break;
    if (isLegalFooterNoiseLine(upper)) continue;

    // Repair slight OCR char swaps inside "RUC ..." token line
    const repaired = upper.replace(
      /(?:R\.?\s*U\.?\s*C\.?[:\s.-]*)([0-9OIl]{11})\b/g,
      (_, digits) => `RUC ${repairOcrNumericToken(digits)}`
    );
    const matches = repaired.match(/\b(?:10|15|17|20)\d{9}\b/g) || [];
    for (const m of matches) {
      if (shouldAcceptEmitterRuc(m, excludedRucs)) {
        rucEmisor = m;
        rucRowIndex = i;
        break;
      }
    }
    if (rucEmisor) break;
  }

  // Fallback scan anywhere non-footer/non-client
  if (!rucEmisor) {
    for (let i = 0; i < rows.length; i++) {
      const upper = stripAccents(rows[i].text).toUpperCase();
      if (isLegalFooterNoiseLine(upper)) continue;
      const matches = upper.match(/\b(?:10|15|17|20)\d{9}\b/g) || [];
      for (const m of matches) {
        if (shouldAcceptEmitterRuc(m, excludedRucs)) {
          rucEmisor = m;
          rucRowIndex = i;
          break;
        }
      }
      if (rucEmisor) break;
    }
  }

  // Extract Razón Social & Nombre Comercial near emitter RUC or top header block
  const headerCutoff = Math.min(
    rows.length,
    Math.max(
      rucRowIndex >= 0 ? rucRowIndex + 1 : 8,
      rows.findIndex((r) =>
        /\b(?:FACTURA|BOLETA|NOTA\s+DE|CLIENTE|ADQUIRIENTE|CANT|DESCRIPCION)\b/i.test(
          stripAccents(r.text)
        )
      )
    ) || 8
  );

  const headerRows = rows.slice(0, headerCutoff > 0 ? headerCutoff : Math.min(10, rows.length));
  const candidateLines: string[] = [];

  for (let i = 0; i < headerRows.length; i++) {
    const raw = cleanText(headerRows[i].text);
    const upper = stripAccents(raw).toUpperCase();
    const alphaCount = (upper.match(/[A-Z]/g) || []).length;
    if (raw.length < 3 || alphaCount < 4) continue;
    // Reject logo/coat-of-arms ASCII artifacts without real 3+ letter words
    if (!/[A-Z]{3,}/.test(upper)) continue;
    if (NOISE_HEADER_LINE_REGEX.test(upper)) continue;
    if (/^\d{3,}$/.test(raw.replace(/\s+/g, ''))) continue;
    if (/CREDIBAN/i.test(upper)) continue;
    // Skip motivational quote blocks printed by free POS software (IMPRIMIRSUNAT.COM)
    if (
      /\b(?:NO\s+TE\s+DETENGAS|PLANES\s+EN\s+ACCION|POR\s+CONSTRUIRSE|VISUALIZA\s+O\s+IMPRIME)\b/.test(
        upper
      )
    ) {
      continue;
    }
    candidateLines.push(raw);
  }

  // Legal entity line (contains SAC/EIRL/SRL/SA including minor OCR slips like ELRL, or sits immediately above RUC)
  const legalRegex =
    /\b(?:S\.?\s*A\.?\s*C\.?|S\.?\s*A\.?\s*A\.?|S\.?\s*R\.?\s*L\.?|E\.?\s*[IL1]\.?\s*R\.?\s*L\.?|EIRL|ELRL|S\.?\s*A\.?)\b/i;
  let razonSocial = candidateLines.find((l) => legalRegex.test(l)) || '';

  // Prefer multi-line personal/sole-proprietor name right above RUC (e.g. LEANDRO JOSE GABRIEL SPETALE BOJORQUEZ or TONNY BRANDON ...)
  if (!razonSocial && rucRowIndex > 0) {
    const aboveParts: string[] = [];
    for (let k = Math.max(0, rucRowIndex - 3); k < rucRowIndex; k++) {
      const t = cleanText(rows[k].text);
      const u = stripAccents(t).toUpperCase();
      if (!t || NOISE_HEADER_LINE_REGEX.test(u) || t.length < 3) continue;
      if ((u.match(/[A-Z]/g) || []).length < 4 || !/[A-Z]{3,}/.test(u)) continue;
      if (/\b(?:DE:|POR\s+CONSTRUIRSE|FRASE)\b/.test(u)) continue;
      aboveParts.push(t.replace(/^DE:\s*/i, ''));
    }
    if (aboveParts.length > 0) {
      razonSocial = aboveParts.join(' ');
    }
  }

  if (!razonSocial) {
    razonSocial =
      candidateLines.find((l) => /NOTAR[IÍ]A|BOTICA|FARMACIA|SERVICIOS|TRADING|POLLER[IÍ]A/i.test(l)) ||
      candidateLines[candidateLines.length - 1] ||
      candidateLines[0] ||
      '';
  }

  const nombreComercial =
    candidateLines.find((l) => l.toUpperCase() !== razonSocial.toUpperCase()) ||
    candidateLines[0] ||
    razonSocial;

  return {
    rucEmisor,
    razonSocial: cleanText(razonSocial).toUpperCase(),
    nombreComercial: cleanText(nombreComercial),
  };
}

function detectTipoComprobante(
  rows: ClusteredOcrRow[],
  expectedTipo?: TipoComprobante
): TipoComprobante {
  const fullUpper = stripAccents(rows.map((r) => r.text).join('\n')).toUpperCase();
  if (
    /\b(?:YAPEASTE|PLINEASTE|NRO\.?\s*(?:DE\s*)?OPERACI[O0]N|TRANSFERENCIA\s+EXITOSA|CONSTANCIA\s+DE\s+PAGO|YAPE|PLIN)\b/.test(
      fullUpper
    ) &&
    !/\b(?:FACTURA\s+ELECTRONICA|R\.?U\.?C\.?\s*(?:10|20)\d{9})\b/.test(fullUpper)
  ) {
    return 'YAPE / PLIN / TRANSFERENCIA';
  }
  if (/RECIBO\s+DE\s+MOVILIDAD|MOVILIDAD/.test(fullUpper) && /RECIBO\s+M\d+/.test(fullUpper)) {
    return 'RECIBO DE MOVILIDAD';
  }
  if (/\bFACTURA\b/.test(fullUpper)) return 'FACTURA';
  if (/\bBOLETA\b/.test(fullUpper)) return 'BOLETA';
  if (/\bNOTA\s+DE\s+(?:VENTA|PEDIDO)\b/.test(fullUpper)) return 'TICKET DE VENTA';
  if (/\bTICKET\b/.test(fullUpper)) return 'TICKET DE VENTA';
  if (/\bRECIBO\b/.test(fullUpper)) return 'RECIBO DE CAJA';
  return expectedTipo || 'BOLETA';
}

function extractTransferFields(rows: ClusteredOcrRow[]): {
  entidadPago: string;
  numeroOperacion: string;
  titularCuenta: string;
  telefonoCuenta: string;
} {
  const texts = rows.map((r) => r.text);
  const fullUpper = stripAccents(texts.join('\n')).toUpperCase();

  let entidadPago = '';
  if (/YAPE/.test(fullUpper)) entidadPago = 'YAPE';
  else if (/PLIN/.test(fullUpper)) entidadPago = 'PLIN';
  else if (/BBVA/.test(fullUpper)) entidadPago = 'BBVA';
  else if (/BCP|BANCO\s+DE\s+CREDITO/.test(fullUpper)) entidadPago = 'BCP';
  else if (/INTERBANK/.test(fullUpper)) entidadPago = 'INTERBANK';
  else if (/SCOTIABANK/.test(fullUpper)) entidadPago = 'SCOTIABANK';
  else if (/BANCO\s+DE\s+LA\s+NACION/.test(fullUpper)) entidadPago = 'BANCO DE LA NACIÓN';

  let numeroOperacion = '';
  for (const line of texts) {
    const opMatch = stripAccents(line).match(
      /(?:N[°ºRO.]*\s*(?:DE\s*)?OPERACI[O0]N|OPERACI[O0]N|NRO\.?\s*OP\.?|TRANSACCI[O0]N|CODIGO\s*DE\s*OPERACI[O0]N)[:\s#-]*([A-Z0-9-]{5,18})/i
    );
    if (opMatch) {
      numeroOperacion = opMatch[1].trim();
      break;
    }
  }

  const phoneMatch = fullUpper.match(/\b(9\d{8}|\*{3}\s*\*{3}\s*\d{3})\b/);
  const telefonoCuenta = phoneMatch ? phoneMatch[1].replace(/\s+/g, '') : '';

  let titularCuenta = '';
  for (let i = 0; i < texts.length; i++) {
    const l = texts[i];
    const inline = l.match(
      /^(?:PARA|A\s+NOMBRE\s+DE|TITULAR|BENEFICIARIO|DESTINATARIO|DESTINO|ENVIADO\s+A)[:\s]+(.{3,60})$/i
    );
    if (inline && !/^(YAPE|PLIN|BCP|BBVA|INTERBANK)$/i.test(inline[1].trim())) {
      titularCuenta = cleanText(inline[1]);
      break;
    }
    if (
      /^(?:¡?YAPEASTE!?|¡?PLINEASTE!?|TRANSFERENCIA\s+EXITOSA|PAGO\s+EXITOSO)$/i.test(
        stripAccents(l)
      )
    ) {
      const candidate = texts.slice(i + 1, i + 5).find(
        (c) =>
          !/^S\/|^\d|FECHA|HORA|OPERACI|CELULAR|DESTINO|COMISI/i.test(stripAccents(c)) &&
          /[A-Za-zÁÉÍÓÚÑ]{3,}/.test(c)
      );
      if (candidate) {
        titularCuenta = cleanText(candidate);
        break;
      }
    }
  }

  return {
    entidadPago,
    numeroOperacion,
    titularCuenta,
    telefonoCuenta,
  };
}

function extractItemsDescription(
  rows: ClusteredOcrRow[],
  razonSocial: string,
  nombreComercial: string
): string {
  const headerIdx = rows.findIndex((r) =>
    /\b(?:CANT|PRODUCTO|DESCRIPCI[O0]N|P\.?\s*UNIT)\b/i.test(stripAccents(r.text))
  );
  const footerIdx = rows.findIndex(
    (r, idx) =>
      idx > Math.max(0, headerIdx) &&
      /\b(?:OP\.?\s*GRAVADA|OPERACI[O0]N\s*GRAVADA|SUB\s*VENTAS|VENTA\s*TOTAL|SUBTOTAL|EXONERAD|INAFECT|TOTAL\s*(?:A\s*PAGAR|VENTA|S\/)|IMPORTE\s*TOTAL|SON:)\b/i.test(
        stripAccents(r.text)
      )
  );

  if (headerIdx < 0) return '';
  const endIdx = footerIdx > headerIdx ? footerIdx : Math.min(rows.length, headerIdx + 8);
  const slice = rows.slice(headerIdx + 1, endIdx);

  const items: string[] = [];
  for (const row of slice) {
    let clean = row.text
      // remove leading qty & unit e.g. "1 U " or "2.30 KG " or "1 "
      .replace(/^\d+(?:[.,]\d+)?\s*(?:U|UND|UNID|KG|LT|PZ|CAJA)?\s+/i, '')
      // remove trailing unit price + line total decimals
      .replace(/(?:\s+\d{1,6}[.,]\d{2}){1,2}\s*$/g, '')
      .trim();

    if (!clean || clean.length < 3) continue;
    if (/^[-_.=]+$/.test(clean)) continue;
    if (/^(?:CANT|DESCRIPCION|PRODUCTO|IMPORTE|TOTAL)/i.test(stripAccents(clean))) continue;
    if (razonSocial && clean.toUpperCase() === razonSocial.toUpperCase()) continue;
    if (nombreComercial && clean.toUpperCase() === nombreComercial.toUpperCase()) continue;

    // Merge continuation line (e.g. "1 LUZ DE" + "EMERGENCIA 60.00 60.00")
    if (items.length > 0 && row.tokens.length <= 2 && /^[A-ZÁÉÍÓÚÑ\s]{3,20}$/i.test(clean)) {
      items[items.length - 1] = `${items[items.length - 1]} ${clean}`.trim();
    } else {
      items.push(clean);
    }
  }

  return items.join('; ').slice(0, 240);
}

/**
 * Spatial OCR Parser (Layer 1 & 2):
 * Operates on coordinate-clustered horizontal rows from Tesseract/Paddle OCR,
 * anchoring Subtotal, IGV, Total, SON:, Fecha, Serie and RUC with 2026 Peruvian tax validation.
 */
export function parseSpatialReceipt(params: {
  tokens?: SpatialOcrToken[];
  rawText: string;
  criteria: ExpenseCriterion[];
  expectedTipo?: TipoComprobante;
}): AiScanResult & {
  montoEnLetrasParsed: number | null;
  qrVerified: boolean;
  alerts: ReturnType<typeof validatePeruTaxAndMath>['alerts'];
} {
  const rows =
    params.tokens && params.tokens.length > 0
      ? clusterOcrTokensIntoRows(params.tokens)
      : buildRowsFromPlainText(params.rawText);

  const meanConf =
    rows.length > 0
      ? rows.reduce((acc, r) => acc + r.meanConfidence, 0) / rows.length
      : 75;

  const tipoComprobante = detectTipoComprobante(rows, params.expectedTipo);
  const { rucEmisor, razonSocial, nombreComercial } = extractEmitterZoneAndRuc(rows);
  const numeroComprobante = sanitizeSerieCorrelativo('', rows.map((r) => r.text));
  const transfer = extractTransferFields(rows);
  const isTransfer = tipoComprobante === 'YAPE / PLIN / TRANSFERENCIA';

  // Extract date excluding printer footer lines (e.g. "F.I. 18/06/2026" on Luna Service footer)
  let dateCheck: { iso: string; valid: boolean; isFuture: boolean; missing: boolean } = {
    iso: '',
    valid: false,
    isFuture: false,
    missing: true,
  };
  for (const row of rows) {
    if (isLegalFooterNoiseLine(row.text)) continue;
    const candidate = normalizePeruDateIso(row.text);
    if (candidate.valid) {
      dateCheck = candidate;
      break;
    }
  }

  // Extract spatial amounts + "SON:" line
  let subtotal = 0;
  let igv = 0;
  let total = 0;
  let montoEnLetras = '';

  for (const row of rows) {
    const upper = stripAccents(row.text).toUpperCase();

    if (/\bSON\s*:/i.test(upper)) {
      montoEnLetras = row.text.replace(/^.*?\bSON\s*:\s*/i, '').trim();
    }

    const rowMoney = extractRightmostMoneyOnRow(row.text);
    if (rowMoney === null) continue;

    if (
      /\b(?:TOTAL\s*(?:A\s*PAGAR|VENTA|GENERAL|DESEMBOLSADO|ENTREGADO)|IMPORTE\s*TOTAL|^TOTAL\b)\b/.test(
        upper
      ) &&
      !/VENTA\s*TOTAL/.test(upper)
    ) {
      total = rowMoney;
    } else if (/\bI\.?\s*G\.?\s*V\.?\b/.test(upper) && !/TOTAL\s*VENTA/.test(upper)) {
      if (igv === 0) igv = rowMoney;
    } else if (
      /\b(?:OP\.?\s*GRAVADA|OP\.?\s*GRAVADAS|OPERACI[O0]N\s*GRAVADA|SUB\s*VENTAS|VENTA\s*TOTAL|SUBTOTAL|BASE\s*IMPONIBLE)\b/.test(
        upper
      )
    ) {
      if (rowMoney > 0 && subtotal === 0) subtotal = rowMoney;
    } else if (/^TOTAL\s+S\//i.test(upper)) {
      total = rowMoney;
    }
  }

  if (total === 0) {
    const sMatch = stripAccents(params.rawText).match(/S\/\s*([0-9O]{1,6}[.,][0-9O]{2})/i);
    if (sMatch) {
      total = parseCommaDecimal(repairOcrNumericToken(sMatch[1]));
    }
  }

  const parsedWords = parseMontoEnLetrasPeru(montoEnLetras);
  if (total === 0 && parsedWords !== null && parsedWords > 0) {
    total = parsedWords;
  }

  const taxValidation = validatePeruTaxAndMath({
    tipoComprobante,
    subtotal,
    igv,
    total,
    fechaEmision: dateCheck.iso,
    montoEnLetras,
    fromQr: false,
  });

  const descripcion = extractItemsDescription(rows, razonSocial, nombreComercial);
  const fullForClass = `${razonSocial} ${nombreComercial} ${descripcion} ${params.rawText}`;
  const classification = classifyReceiptWithCriteria(fullForClass, params.criteria);

  const finalRazon = isTransfer
    ? cleanText(transfer.titularCuenta || razonSocial || transfer.entidadPago).toUpperCase()
    : razonSocial;
  const finalComercial = isTransfer
    ? cleanText(
        transfer.entidadPago
          ? `${transfer.entidadPago}${transfer.titularCuenta ? ` - ${transfer.titularCuenta}` : ''}`
          : nombreComercial
      )
    : nombreComercial;

  const rucValid = validateSunatRucMod11(rucEmisor) && !isCredibanClientRuc(rucEmisor);
  const score = computeOfflineConfidenceScore({
    qrVerified: false,
    tipoComprobante,
    rucValid,
    hasSerie: Boolean(numeroComprobante),
    hasValidDate: dateCheck.valid,
    dateMissing: dateCheck.missing,
    mathVerified: taxValidation.mathVerified,
    wordsMatched:
      taxValidation.parsedLetrasAmount !== null && !taxValidation.wordsMismatch,
    hasRazonSocial: finalRazon.length >= 3,
    hasDescripcion: descripcion.length >= 3,
    isTransfer,
    hasNumeroOperacion: Boolean(transfer.numeroOperacion),
    ocrMeanConfidence: meanConf,
  });

  const confPct = Math.round(score * 100);
  const alerts = [...taxValidation.alerts];
  if (dateCheck.missing) {
    alerts.push({
      field: 'fecha',
      severity: 'warning',
      message: 'No se detectó fecha impresa en el comprobante. Selecciona la fecha manualmente.',
    });
  } else if (dateCheck.isFuture) {
    alerts.push({
      field: 'fecha',
      severity: 'warning',
      message: `La fecha detectada (${dateCheck.iso}) es posterior a hoy. Verifica año y mes.`,
    });
  }

  return {
    tipoComprobante,
    numeroComprobante:
      numeroComprobante || (isTransfer && transfer.numeroOperacion ? `OP-${transfer.numeroOperacion}` : ''),
    fechaEmision: dateCheck.iso,
    ruc: rucValid ? rucEmisor : '',
    razonSocial: finalRazon,
    nombreComercial: finalComercial,
    titularCuenta: transfer.titularCuenta,
    numeroOperacion: transfer.numeroOperacion,
    entidadPago: transfer.entidadPago,
    telefonoCuenta: transfer.telefonoCuenta,
    subtotal: taxValidation.subtotal,
    igv: taxValidation.igv,
    total: taxValidation.total,
    naturaleza: classification.naturaleza,
    categoria: classification.categoria,
    subtipo: classification.subtipo,
    descripcion,
    montoEnLetras,
    montoEnLetrasParsed: taxValidation.parsedLetrasAmount,
    scoreConfiabilidad: score,
    confianzaLectura: confPct,
    mathVerified: taxValidation.mathVerified,
    mathAlert:
      taxValidation.alerts.find((a) => a.severity === 'error')?.message ||
      alerts[0]?.message,
    qrVerified: false,
    alerts,
  };
}

/**
 * Fuses deterministic Layer 0 SUNAT QR data (highest priority for fiscal/math fields)
 * with Layer 1 Spatial OCR (supplying Reason Social, Commercial Name, Description, and any omitted date).
 */
export function mergeQrAndSpatialOcr(params: {
  qr: SunatQrParsedData | null;
  spatial: ReturnType<typeof parseSpatialReceipt> | null;
  criteria: ExpenseCriterion[];
  expectedTipo?: TipoComprobante;
}): AiScanResult & {
  qrVerified: boolean;
  needsAiEscalation: boolean;
} {
  const { qr, spatial } = params;

  if (!qr && spatial) {
    return {
      ...spatial,
      qrVerified: false,
      needsAiEscalation: (spatial.confianzaLectura ?? 0) < 95,
    };
  }

  if (qr) {
    const fechaEmision = qr.fechaEmision || spatial?.fechaEmision || '';
    const dateCheck = normalizePeruDateIso(fechaEmision);
    const tipoComprobante = qr.tipoComprobante;

    // Prefer exact printed Serie with letter (e.g., F001-00008766 matches 001-00008766 normalized by QR)
    const numeroComprobante = qr.serieCorrelativo || spatial?.numeroComprobante || '';

    // Respect OCR's explicit subtotal+igv if QR encoded percentage rate ("18") instead of IGV amount
    const subtotalSource =
      qr.igvRateHint &&
      spatial &&
      spatial.total > 0 &&
      Math.abs(spatial.total - qr.total) <= 0.02 &&
      spatial.subtotal > 0
        ? spatial.subtotal
        : qr.subtotal;
    const igvSource =
      qr.igvRateHint &&
      spatial &&
      spatial.total > 0 &&
      Math.abs(spatial.total - qr.total) <= 0.02 &&
      spatial.igv > 0
        ? spatial.igv
        : qr.igv;

    const taxValidation = validatePeruTaxAndMath({
      tipoComprobante,
      subtotal: subtotalSource,
      igv: igvSource,
      total: qr.total,
      fechaEmision: dateCheck.iso,
      montoEnLetras: spatial?.montoEnLetras,
      fromQr: true,
    });

    const razonSocial = spatial?.razonSocial || '';
    const nombreComercial = spatial?.nombreComercial || '';
    const descripcion = spatial?.descripcion || '';

    const fullTextForClass = `${razonSocial} ${nombreComercial} ${descripcion}`;
    const classification =
      fullTextForClass.trim().length > 3
        ? classifyReceiptWithCriteria(fullTextForClass, params.criteria)
        : {
            naturaleza: spatial?.naturaleza || 'Costo Variable',
            categoria: spatial?.categoria || 'Otros gastos operativos',
            subtipo: spatial?.subtipo || 'General',
          };

    const rucValid = validateSunatRucMod11(qr.rucEmisor) && !isCredibanClientRuc(qr.rucEmisor);
    const score = computeOfflineConfidenceScore({
      qrVerified: qr.qrVerified,
      tipoComprobante,
      rucValid,
      hasSerie: Boolean(numeroComprobante),
      hasValidDate: dateCheck.valid,
      dateMissing: dateCheck.missing,
      mathVerified: taxValidation.mathVerified,
      wordsMatched:
        taxValidation.parsedLetrasAmount !== null && !taxValidation.wordsMismatch,
      hasRazonSocial: razonSocial.length >= 3,
      hasDescripcion: descripcion.length >= 3,
      isTransfer: false,
      hasNumeroOperacion: false,
    });

    const confPct = Math.round(score * 100);
    return {
      tipoComprobante,
      numeroComprobante,
      fechaEmision: dateCheck.iso,
      ruc: qr.rucEmisor,
      razonSocial,
      nombreComercial,
      subtotal: taxValidation.subtotal,
      igv: taxValidation.igv,
      total: taxValidation.total,
      naturaleza: classification.naturaleza,
      categoria: classification.categoria,
      subtipo: classification.subtipo,
      descripcion,
      montoEnLetras: spatial?.montoEnLetras,
      scoreConfiabilidad: score,
      confianzaLectura: confPct,
      mathVerified: taxValidation.mathVerified,
      mathAlert: taxValidation.alerts[0]?.message,
      qrVerified: true,
      needsAiEscalation: confPct < 95,
    };
  }

  return {
    tipoComprobante: params.expectedTipo || 'BOLETA',
    numeroComprobante: '',
    fechaEmision: '',
    ruc: '',
    razonSocial: '',
    nombreComercial: '',
    subtotal: 0,
    igv: 0,
    total: 0,
    naturaleza: 'Costo Variable',
    categoria: 'Otros gastos operativos',
    subtipo: 'General',
    descripcion: '',
    scoreConfiabilidad: 0.3,
    confianzaLectura: 30,
    mathVerified: false,
    mathAlert: 'No se pudo leer el comprobante offline.',
    qrVerified: false,
    needsAiEscalation: true,
  };
}
