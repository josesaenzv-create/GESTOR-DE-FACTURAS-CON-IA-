import type {
  AiScanResult,
  ExpenseCriterion,
  TipoComprobante,
} from '../types/crediban';
import { sanitizeSerieCorrelativo } from './invoiceValidator';
import { parseSpatialReceipt } from './spatialReceiptParser';

export function extractNumeroComprobante(text: string): string {
  return sanitizeSerieCorrelativo('', text);
}

export function parsePeruReceiptText(
  rawText: string,
  criteria: ExpenseCriterion[],
  expectedTipo?: TipoComprobante
): AiScanResult {
  const parsed = parseSpatialReceipt({
    rawText,
    criteria,
    expectedTipo,
  });

  // Preserve fallback today date for legacy plain-text callers only if missing
  return {
    ...parsed,
    fechaEmision: parsed.fechaEmision || '',
  };
}
