import {
  CREDIBAN_COMPANY,
  OFFICIAL_CATEGORIES,
  type AiScanResult,
  type ExpenseCriterion,
  type TipoComprobante,
} from '../types/crediban';
import { calculateIgvBreakdown, parseCommaDecimal } from './accounting';

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
  septiembre: '09',
  setiembre: '09',
  oct: '10',
  octubre: '10',
  nov: '11',
  noviembre: '11',
  dic: '12',
  diciembre: '12',
};

function cleanCompanyText(raw: string): string {
  return String(raw || '')
    .replace(/[|,;]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractRucEmisor(text: string): string {
  const matches = text.match(/\b(?:10|15|17|20)\d{9}\b/g) || [];
  const filtered = matches.filter((m) => m !== CREDIBAN_COMPANY.ruc);
  return filtered[0] || '';
}

function extractTipoComprobante(text: string, expectedTipo?: TipoComprobante): TipoComprobante {
  const upper = text.toUpperCase();
  if (/YAPEASTE|YAPE|PLIN|NRO\.?\s*DE\s*OPERACI[ÓO]N|TRANSFERENCIA\s+EXITOSA|BCP|BBVA|INTERBANK|SCOTIABANK/.test(upper)) {
    return 'YAPE / PLIN / TRANSFERENCIA';
  }
  if (/RECIBO\s+DE\s+MOVILIDAD|MOVILIDAD/.test(upper) && /RECIBO\s+M\d+/.test(upper)) {
    return 'RECIBO DE MOVILIDAD';
  }
  if (/FACTURA/.test(upper)) return 'FACTURA';
  if (/BOLETA/.test(upper)) return 'BOLETA';
  if (/TICKET/.test(upper)) return 'TICKET DE VENTA';
  if (/RECIBO/.test(upper)) return 'RECIBO DE CAJA';
  return expectedTipo || 'BOLETA';
}

export function extractNumeroComprobante(text: string): string {
  const upper = text.toUpperCase();
  // Match full SUNAT series + correlative including 8+ digits (e.g. F001-00034719, B002-00123456, M001-0127, RC01-0025)
  const patterns = [
    /\b([FBETMR][A-Z0-9]{2,3})\s*[-–—]\s*([0-9O]{1,12})\b/,
    /\b(\d{3,4})\s*[-–—]\s*([0-9O]{3,12})\b/,
  ];
  for (const regex of patterns) {
    const match = upper.match(regex);
    if (match) {
      const serie = match[1];
      const correlativo = match[2].replace(/O/g, '0');
      // Avoid matching dates like 2026-11 or phone prefixes
      if (/^20\d{2}$/.test(serie) && correlativo.length <= 2) continue;
      return `${serie}-${correlativo}`;
    }
  }
  return '';
}

function extractYapeOrTransferFields(text: string): {
  entidadPago: string;
  numeroOperacion: string;
  titularCuenta: string;
  telefonoCuenta: string;
} {
  const upper = text.toUpperCase();
  let entidadPago = '';
  if (/YAPE/.test(upper)) entidadPago = 'YAPE';
  else if (/PLIN/.test(upper)) entidadPago = 'PLIN';
  else if (/BCP|BANCO DE CR[ÉE]DITO/.test(upper)) entidadPago = 'BCP';
  else if (/BBVA/.test(upper)) entidadPago = 'BBVA';
  else if (/INTERBANK/.test(upper)) entidadPago = 'INTERBANK';
  else if (/SCOTIABANK/.test(upper)) entidadPago = 'SCOTIABANK';

  const opMatch = text.match(
    /(?:N[°ºRO.]*\s*(?:DE\s*)?OPERACI[ÓO]N|OPERACI[ÓO]N|NRO\.?\s*OP\.?|TRANSACCI[ÓO]N|C[ÓO]DIGO\s*DE\s*OPERACI[ÓO]N)[:\s#-]*([A-Z0-9-]{5,18})/i
  );
  const numeroOperacion = opMatch ? opMatch[1].trim() : '';

  const phoneMatch = text.match(/\b(9\d{8}|\*{3}\s*\*{3}\s*\d{3})\b/);
  const telefonoCuenta = phoneMatch ? phoneMatch[1].replace(/\s+/g, '') : '';

  const lines = text
    .split(/\r?\n/)
    .map((l) => cleanCompanyText(l))
    .filter(Boolean);

  let titularCuenta = '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const inlineTitular = l.match(
      /^(?:PARA|A\s+NOMBRE\s+DE|TITULAR|BENEFICIARIO|DESTINATARIO|DESTINO|ENVIADO\s+A)[:\s]+(.{3,60})$/i
    );
    if (inlineTitular) {
      titularCuenta = cleanCompanyText(inlineTitular[1]);
      break;
    }
    if (/^(?:¡?YAPEASTE!?|¡?PLINEASTE!?|TRANSFERENCIA\s+EXITOSA|PAGO\s+EXITOSO)$/i.test(l)) {
      const candidate = lines.slice(i + 1, i + 5).find(
        (c) =>
          !/^S\/|^\d|FECHA|HORA|OPERACI|CELULAR|DESTINO|COMISI/i.test(c) &&
          /[A-Za-zÁÉÍÓÚÑ]{3,}/.test(c)
      );
      if (candidate) {
        titularCuenta = candidate;
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

function extractFechaEmision(text: string): string {
  const iso = text.match(/\b(20\d{2})[\/\-](0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])\b/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  }
  const dmy4 = text.match(/\b(0?[1-9]|[12]\d|3[01])[\/\-](0?[1-9]|1[0-2])[\/\-](20\d{2})\b/);
  if (dmy4) {
    return `${dmy4[3]}-${dmy4[2].padStart(2, '0')}-${dmy4[1].padStart(2, '0')}`;
  }
  const dmyText = text.match(
    /\b(0?[1-9]|[12]\d|3[01])\s*(?:de\s*)?([a-záéíóú]{3,10})\.?\s*(?:de\s*)?(20\d{2})\b/i
  );
  if (dmyText) {
    const mon = SPANISH_MONTHS[dmyText[2].toLowerCase()];
    if (mon) {
      return `${dmyText[3]}-${mon}-${dmyText[1].padStart(2, '0')}`;
    }
  }
  const dmy2 = text.match(/\b(0?[1-9]|[12]\d|3[01])[\/\-](0?[1-9]|1[0-2])[\/\-](\d{2})\b/);
  if (dmy2) {
    return `20${dmy2[3]}-${dmy2[2].padStart(2, '0')}-${dmy2[1].padStart(2, '0')}`;
  }
  return new Date().toISOString().slice(0, 10);
}

function extractAmounts(
  text: string,
  tipo: TipoComprobante
): {
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
    const anyNumMatch = line.match(
      /(?:S\/|S\.|TOTAL|IGV|GRAVADO|SUBTOTAL|MONTO)[^\d]*(\d{1,6}[.,]\d{2})/i
    );
    const candidateStr = numMatch?.[1] || anyNumMatch?.[1];
    if (!candidateStr) continue;
    const val = parseCommaDecimal(candidateStr);

    if (/TOTAL\s*(?:VENTA|A\s*PAGAR|GENERAL|IMPORTE|DESEMBOLSADO|ENTREGADO)|IMPORTE\s*TOTAL/.test(clean)) {
      if (val > total) total = val;
    } else if (/I\.?\s*G\.?\s*V\.?/.test(clean) && !/TOTAL\s*VENTA/.test(clean)) {
      if (val >= 0 && igv === 0) igv = val;
    } else if (/GRAVADO|SUB\s*TOTAL|OP\.?\s*GRAVADA/.test(clean)) {
      if (val > 0 && subtotal === 0) subtotal = val;
    }
  }

  if (total === 0) {
    const sMatch = text.match(/S\/\s*(\d{1,6}(?:[.,]\d{2})?)/i);
    if (sMatch) {
      total = parseCommaDecimal(sMatch[1]);
    }
  }

  if (total === 0) {
    const allNums = (text.match(/\b\d{1,5}[.,]\d{2}\b/g) || []).map((n) => parseCommaDecimal(n));
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
    .map((l) => cleanCompanyText(l))
    .filter((l) => l.length >= 3 && !/CREDIBAN/i.test(l));

  const legalLine = lines.find((l) =>
    /\b(S\.?A\.?C\.?|S\.?A\.?A\.?|S\.?R\.?L\.?|E\.?I\.?R\.?L\.?|S\.?A\.?)\b/i.test(l)
  );
  const firstHeaderLine = lines.find(
    (l) => !/^RUC/i.test(l) && !/^\d{1,2}:\d{2}/.test(l) && /[A-Za-zÁÉÍÓÚÑ]{3,}/.test(l)
  );

  return {
    razonSocial: cleanCompanyText(legalLine || firstHeaderLine || '').toUpperCase(),
    nombreComercial: cleanCompanyText(firstHeaderLine || legalLine || ''),
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
  criteria: ExpenseCriterion[],
  expectedTipo?: TipoComprobante
): AiScanResult {
  const tipoComprobante = extractTipoComprobante(rawText, expectedTipo);
  const ruc = extractRucEmisor(rawText);
  const numeroComprobante = extractNumeroComprobante(rawText);
  const fechaEmision = extractFechaEmision(rawText);
  const amounts = extractAmounts(rawText, tipoComprobante);
  const names = extractBusinessNames(rawText);
  const transfer = extractYapeOrTransferFields(rawText);
  const classification = classifyWithCriteria(rawText, criteria);

  const isTransfer = tipoComprobante === 'YAPE / PLIN / TRANSFERENCIA';
  const finalRazon = isTransfer
    ? cleanCompanyText(transfer.titularCuenta || names.razonSocial || transfer.entidadPago)
    : names.razonSocial;
  const finalComercial = isTransfer
    ? cleanCompanyText(
        transfer.entidadPago
          ? `${transfer.entidadPago}${transfer.titularCuenta ? ` - ${transfer.titularCuenta}` : ''}`
          : names.nombreComercial
      )
    : names.nombreComercial;

  const summaryLine = rawText
    .split(/\r?\n/)
    .map((l) => cleanCompanyText(l))
    .find((l) => l.length > 6 && !/RUC|CREDIBAN|FECHA|TOTAL/i.test(l));

  return {
    tipoComprobante,
    numeroComprobante:
      numeroComprobante || (isTransfer && transfer.numeroOperacion ? `OP-${transfer.numeroOperacion}` : ''),
    fechaEmision,
    ruc,
    razonSocial: finalRazon,
    nombreComercial: finalComercial,
    titularCuenta: transfer.titularCuenta,
    numeroOperacion: transfer.numeroOperacion,
    entidadPago: transfer.entidadPago,
    telefonoCuenta: transfer.telefonoCuenta,
    subtotal: amounts.subtotal,
    igv: amounts.igv,
    total: amounts.total,
    naturaleza: classification.naturaleza,
    categoria: classification.categoria,
    subtipo: classification.subtipo,
    descripcion: summaryLine ? `${finalComercial || 'Comprobante'} - ${summaryLine}` : '',
    scoreConfiabilidad:
      (ruc || transfer.numeroOperacion) && amounts.total > 0 ? 0.85 : 0.6,
  };
}
