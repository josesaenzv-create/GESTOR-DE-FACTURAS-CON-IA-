import { CREDIBAN_COMPANY, OFFICIAL_CATEGORIES, type AiScanResult, type ExpenseCriterion, type TipoComprobante } from '../types/crediban';
import { calculateIgvBreakdown, parseCommaDecimal } from './accounting';

function extractRucEmisor(text: string): string {
  const matches = text.match(/\b(?:10|15|17|20)\d{9}\b/g) || [];
  const filtered = matches.filter((m) => m !== CREDIBAN_COMPANY.ruc);
  return filtered[0] || '';
}

function extractTipoComprobante(text: string): TipoComprobante {
  const upper = text.toUpperCase();
  if (/FACTURA/.test(upper)) return 'FACTURA';
  if (/BOLETA/.test(upper)) return 'BOLETA';
  if (/TICKET/.test(upper)) return 'TICKET DE VENTA';
  if (/RECIBO/.test(upper)) return 'RECIBO DE CAJA';
  return 'BOLETA';
}

function extractNumeroComprobante(text: string): string {
  const match = text.toUpperCase().match(/\b([FBETR]\d{3}|[FB]\w{3})\s*[-–—]\s*(\d{3,10})\b/);
  if (match) {
    return `${match[1]}-${match[2]}`;
  }
  return '';
}

function extractFechaEmision(text: string): string {
  const iso = text.match(/\b(20\d{2})[\/\-](0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])\b/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  }
  const dmy4 = text.match(/\b(0?[1-9]|[12]\d|3[01])[\/\-](0?[1-9]|1[0-2])[\/\-](20\d{2})\b/);
  if (dmy4) {
    return `${dmy4[3]}-${dmy4[2].padStart(2, '0')}-${dmy4[1].padStart(2, '0')}`;
  }
  const dmy2 = text.match(/\b(0?[1-9]|[12]\d|3[01])[\/\-](0?[1-9]|1[0-2])[\/\-](\d{2})\b/);
  if (dmy2) {
    return `20${dmy2[3]}-${dmy2[2].padStart(2, '0')}-${dmy2[1].padStart(2, '0')}`;
  }
  return new Date().toISOString().slice(0, 10);
}

function extractAmounts(text: string, tipo: TipoComprobante): {
  subtotal: number;
  igv: number;
  total: number;
} {
  const lines = text.split(/\r?\n/);
  let total = 0;
  let igv = 0;
  let subtotal = 0;

  for (const line of lines) {
    const clean = line.toUpperCase();
    const numMatch = line.match(/(\d{1,6}[.,]\d{2})\s*$/);
    const anyNumMatch = line.match(/(?:S\/|S\.|TOTAL|IGV|GRAVADO|SUBTOTAL)[^\d]*(\d{1,6}[.,]\d{2})/i);
    const candidateStr = numMatch?.[1] || anyNumMatch?.[1];
    if (!candidateStr) continue;
    const val = parseCommaDecimal(candidateStr);

    if (/TOTAL\s*(?:VENTA|A\s*PAGAR|GENERAL|IMPORTE)|IMPORTE\s*TOTAL/.test(clean)) {
      if (val > total) total = val;
    } else if (/I\.?\s*G\.?\s*V\.?/.test(clean) && !/TOTAL\s*VENTA/.test(clean)) {
      if (val >= 0 && igv === 0) igv = val;
    } else if (/GRAVADO|SUB\s*TOTAL|OP\.?\s*GRAVADA/.test(clean)) {
      if (val > 0 && subtotal === 0) subtotal = val;
    }
  }

  if (total === 0) {
    // Fallback: largest decimal number in document that looks like a total
    const allNums = (text.match(/\b\d{1,5}\.\d{2}\b/g) || []).map((n) => parseFloat(n));
    if (allNums.length > 0) {
      total = Math.max(...allNums);
    }
  }

  if (total > 0 && (subtotal === 0 || igv === 0)) {
    const calc = calculateIgvBreakdown(total, tipo);
    if (subtotal === 0) subtotal = calc.subtotal;
    if (igv === 0) igv = calc.igv;
  }

  return { subtotal, igv, total };
}

function extractBusinessNames(text: string): {
  razonSocial: string;
  nombreComercial: string;
} {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 3 && !/CREDIBAN/i.test(l));

  const legalLine = lines.find((l) =>
    /\b(S\.?A\.?C\.?|S\.?A\.?A\.?|S\.?R\.?L\.?|E\.?I\.?R\.?L\.?|S\.?A\.?)\b/i.test(l)
  );
  const firstHeaderLine = lines.find((l) => !/^RUC/i.test(l) && /[A-Za-zÁÉÍÓÚÑ]{3,}/.test(l));

  return {
    razonSocial: (legalLine || firstHeaderLine || '').toUpperCase(),
    nombreComercial: firstHeaderLine || legalLine || '',
  };
}

function classifyWithCriteria(
  text: string,
  criteria: ExpenseCriterion[]
): {
  naturaleza: 'Costo Fijo' | 'Costo Variable';
  categoria: string;
  subtipo: string;
} {
  const lower = text.toLowerCase();
  for (const c of criteria) {
    const keywords = String(c.palabrasClaveIA || '')
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter((k) => k.length >= 3);
    if (keywords.some((kw) => lower.includes(kw))) {
      return {
        naturaleza: c.naturaleza,
        categoria: c.categoriaForms || OFFICIAL_CATEGORIES[0],
        subtipo: c.subtipo || 'General',
      };
    }
  }

  // Fallback heuristics for pharmacy/medical/supplies/fuel
  if (/botica|farmacia|inkafarma|mifarma|medic|bicarbonato|salud/.test(lower)) {
    return {
      naturaleza: 'Costo Variable',
      categoria: 'Atención al cliente y bienestar laboral',
      subtipo: 'Botiquín y Bienestar',
    };
  }
  if (/grifo|primax|repsol|gasolina|combustible/.test(lower)) {
    return {
      naturaleza: 'Costo Variable',
      categoria: 'Movilidad y transporte',
      subtipo: 'Combustible / Grifos',
    };
  }

  return {
    naturaleza: 'Costo Variable',
    categoria: 'Otros gastos operativos',
    subtipo: criteria.find((c) => c.naturaleza === 'Costo Variable')?.subtipo || 'General',
  };
}

export function parsePeruReceiptText(
  rawText: string,
  criteria: ExpenseCriterion[]
): AiScanResult {
  const tipoComprobante = extractTipoComprobante(rawText);
  const ruc = extractRucEmisor(rawText);
  const numeroComprobante = extractNumeroComprobante(rawText);
  const fechaEmision = extractFechaEmision(rawText);
  const amounts = extractAmounts(rawText, tipoComprobante);
  const names = extractBusinessNames(rawText);
  const classification = classifyWithCriteria(rawText, criteria);

  const summaryLine = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 6 && !/RUC|CREDIBAN|FECHA|TOTAL/i.test(l));

  return {
    tipoComprobante,
    numeroComprobante,
    fechaEmision,
    ruc,
    razonSocial: names.razonSocial,
    nombreComercial: names.nombreComercial,
    subtotal: amounts.subtotal,
    igv: amounts.igv,
    total: amounts.total,
    naturaleza: classification.naturaleza,
    categoria: classification.categoria,
    subtipo: classification.subtipo,
    descripcion: summaryLine ? `${names.nombreComercial || 'Comprobante'} - ${summaryLine}` : '',
    scoreConfiabilidad: ruc && amounts.total > 0 ? 0.82 : 0.58,
  };
}
