import { MONTH_NAMES } from '../types/crediban';
import type {
  ExpenseRecord,
  NivelImpacto,
  TipoComprobante,
  UserSession,
} from '../types/crediban';

export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateIgvBreakdown(
  totalAmount: number,
  tipoComprobante: TipoComprobante
): { subtotal: number; igv: number; total: number } {
  const safeTotal = round2(Math.max(0, Number(totalAmount) || 0));
  if (tipoComprobante === 'FACTURA') {
    const subtotal = round2(safeTotal / 1.18);
    const igv = round2(safeTotal - subtotal);
    return { subtotal, igv, total: safeTotal };
  }
  return { subtotal: safeTotal, igv: 0, total: safeTotal };
}

export function formatCommaDecimal(value: number): string {
  const safe = round2(Number(value) || 0);
  return safe.toFixed(2).replace('.', ',');
}

export function parseCommaDecimal(raw: string | number | null | undefined): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? round2(raw) : 0;
  if (!raw) return 0;
  const str = String(raw).trim().replace(/^S\/\s*/i, '');
  // If both comma and dot exist, determine decimal separator by last occurrence
  if (str.includes(',') && str.includes('.')) {
    const lastComma = str.lastIndexOf(',');
    const lastDot = str.lastIndexOf('.');
    if (lastComma > lastDot) {
      return round2(parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0);
    }
    return round2(parseFloat(str.replace(/,/g, '')) || 0);
  }
  if (str.includes(',')) {
    return round2(parseFloat(str.replace(',', '.')) || 0);
  }
  return round2(parseFloat(str) || 0);
}

export function formatCurrencySoles(amount: number): string {
  const safe = round2(Number(amount) || 0);
  return `S/ ${safe.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function getImpactLevel(total: number): NivelImpacto {
  const val = Number(total) || 0;
  if (val <= 60) return 'Regular';
  if (val <= 250) return 'Medio';
  return 'Fuerte';
}

export function buildStandardPhotoFilename(
  id: string,
  tipo: string,
  numero: string,
  ruc: string,
  fecha: string
): string {
  const sanitize = (input: string) =>
    String(input || 'NA')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]+/g, '_')
      .replace(/^_+|_+$/g, '');

  const cleanId = sanitize(id || 'CB');
  const cleanTipo = sanitize(tipo || 'DOC');
  const cleanNum = sanitize(numero || 'SN');
  const cleanRuc = String(ruc || '00000000000').replace(/\D/g, '') || '00000000000';
  const cleanFecha = sanitize(fecha || new Date().toISOString().slice(0, 10));

  return `${cleanId}_${cleanTipo}_${cleanNum}_RUC${cleanRuc}_${cleanFecha}.jpg`;
}

export function detectDuplicateExpense(
  records: ExpenseRecord[],
  ruc: string,
  numeroComprobante: string,
  excludeId?: string
): ExpenseRecord | null {
  const cleanRuc = String(ruc || '').replace(/\D/g, '');
  const cleanNum = String(numeroComprobante || '').trim().toUpperCase();
  if (!cleanRuc || !cleanNum) return null;

  return (
    records.find(
      (r) =>
        r.id !== excludeId &&
        String(r.ruc || '').replace(/\D/g, '') === cleanRuc &&
        String(r.numeroComprobante || '').trim().toUpperCase() === cleanNum
    ) || null
  );
}

export function getMonthNameFromIsoDate(isoDate: string): string {
  const match = String(isoDate || '').match(/^\d{4}-(\d{2})-\d{2}/);
  if (!match) {
    return MONTH_NAMES[new Date().getMonth()];
  }
  const idx = parseInt(match[1], 10) - 1;
  return MONTH_NAMES[idx] || MONTH_NAMES[0];
}

export function getYearFromIsoDate(isoDate: string): string {
  const match = String(isoDate || '').match(/^(\d{4})-/);
  return match ? match[1] : String(new Date().getFullYear());
}

export function isManagerUser(user: UserSession | null): boolean {
  if (!user) return false;
  const cargo = String(user.cargo || '').toUpperCase();
  const sede = String(user.sede || '').toUpperCase();
  return cargo.includes('GERENTE') || sede === 'TODAS';
}
