import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePeruReceiptText } from './ocrParser';
import { DEFAULT_CRITERIA } from '../data/seedData';

test('parsePeruReceiptText extracts RUC, serie, date, IGV, and totals from Peruvian pharmacy factura while ignoring CREDIBAN RUC', () => {
  const sampleOcr = `
BOTICA CENTRAL
FARMACIA HIROMI S.A.C.
RUC 20601314984
FACTURA ELECTRÓNICA
F001-00034719
Fecha 13/11/26
Datos del cliente
Nombre: CREDIBAN PERU S.A.C.
RUC: 20613997360
BICARBONATO SODIO 100G-ALKOFA 1.80
Total Gravado S/ 1.53
Total I.G.V. S/ 0.27
Total Venta S/ 1.80
`;

  const parsed = parsePeruReceiptText(sampleOcr, DEFAULT_CRITERIA);
  assert.equal(parsed.ruc, '20601314984');
  assert.equal(parsed.tipoComprobante, 'FACTURA');
  assert.equal(parsed.numeroComprobante, 'F001-00034719');
  assert.equal(parsed.fechaEmision, '2026-11-13');
  assert.equal(parsed.subtotal, 1.53);
  assert.equal(parsed.igv, 0.27);
  assert.equal(parsed.total, 1.8);
  assert.equal(parsed.razonSocial, 'FARMACIA HIROMI S.A.C.');
  assert.equal(parsed.nombreComercial, 'BOTICA CENTRAL');
});
