import test from 'node:test';
import assert from 'node:assert/strict';
import { extractNumeroComprobante, parsePeruReceiptText } from './ocrParser';
import { DEFAULT_CRITERIA } from '../data/seedData';

test('parsePeruReceiptText extracts full 8-digit correlativo F001-00034719 and ignores CREDIBAN RUC', () => {
  const sampleText = `
    BOTICA CENTRAL
    FARMACIA HIROMI S.A.C. |
    RUC 20601314984
    FACTURA ELECTRONICA
    F001-00034719
    Fecha: 13/11/26 Hora: 14:12
    Nombre: CREDIBAN PERU S A C
    RUC 20613997360
    BICARBONATO SODIO 100G 1.80
    Total Gravado S/ 1.53
    Total I.G.V. S/ 0.27
    Total Venta S/ 1.80
  `;

  const parsed = parsePeruReceiptText(sampleText, DEFAULT_CRITERIA);
  assert.equal(parsed.tipoComprobante, 'FACTURA');
  assert.equal(parsed.ruc, '20601314984');
  assert.equal(parsed.numeroComprobante, 'F001-00034719');
  assert.equal(parsed.razonSocial, 'FARMACIA HIROMI S.A.C.');
  assert.equal(parsed.fechaEmision, '2026-11-13');
  assert.equal(parsed.total, 1.8);
  assert.equal(parsed.igv, 0.27);
  assert.equal(parsed.subtotal, 1.53);
});

test('extractNumeroComprobante handles spaces and OCR O/0 confusion in long correlativos', () => {
  assert.equal(extractNumeroComprobante('FACTURA F001 - OOO34719'), 'F001-00034719');
  assert.equal(extractNumeroComprobante('RECIBO M001 - 0127'), 'M001-0127');
  assert.equal(extractNumeroComprobante('RECIBO RC01 - 0025'), 'RC01-0025');
});

test('parsePeruReceiptText extracts Yape titular, numero de operacion, fecha and monto', () => {
  const yapeText = `
    ¡Yapeaste!
    S/ 45.50
    HEYDI DINA TALAVERANO
    17 nov. 2026 - 10:15 a. m.
    Celular: 987654321
    Destino: Yape
    Nro. de operación: 04829104
  `;

  const parsed = parsePeruReceiptText(yapeText, DEFAULT_CRITERIA, 'YAPE / PLIN / TRANSFERENCIA');
  assert.equal(parsed.tipoComprobante, 'YAPE / PLIN / TRANSFERENCIA');
  assert.equal(parsed.entidadPago, 'YAPE');
  assert.equal(parsed.numeroOperacion, '04829104');
  assert.equal(parsed.titularCuenta, 'HEYDI DINA TALAVERANO');
  assert.equal(parsed.fechaEmision, '2026-11-17');
  assert.equal(parsed.total, 45.5);
  assert.equal(parsed.igv, 0);
});
