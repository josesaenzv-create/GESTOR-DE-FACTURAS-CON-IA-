import test from 'node:test';
import assert from 'node:assert/strict';
import { extractNumeroComprobante, parsePeruReceiptText } from './ocrParser';
import {
  clusterOcrTokensIntoRows,
  mergeQrAndSpatialOcr,
  parseSpatialReceipt,
} from './spatialReceiptParser';
import { parseSunatQrString } from './sunatQrParser';
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

test('clusterOcrTokensIntoRows reconstructs horizontal POS columns and mergeQrAndSpatialOcr yields >= 95%', () => {
  const tokens = [
    { text: 'LAVANDERIA', x0: 40, y0: 10, x1: 180, y1: 30, confidence: 95 },
    { text: 'LIZ', x0: 190, y0: 11, x1: 240, y1: 30, confidence: 95 },
    { text: 'JJ SERVICIOS LIZ E.I.R.L.', x0: 40, y0: 40, x1: 280, y1: 58, confidence: 93 },
    { text: 'Ruc : 20534123605', x0: 60, y0: 66, x1: 220, y1: 84, confidence: 94 },
    { text: 'CANT DESCRIPCION P.UNIT TOTAL', x0: 10, y0: 140, x1: 320, y1: 158, confidence: 92 },
    { text: '2.30 KG LAVADO AL PESO', x0: 10, y0: 165, x1: 220, y1: 183, confidence: 90 },
    { text: '4.23', x0: 235, y0: 166, x1: 275, y1: 184, confidence: 92 },
    { text: '11.50', x0: 290, y0: 165, x1: 340, y1: 184, confidence: 95 },
    { text: 'Op. Gravada : S/', x0: 60, y0: 200, x1: 200, y1: 218, confidence: 94 },
    { text: '9.75', x0: 290, y0: 201, x1: 340, y1: 219, confidence: 95 },
    { text: 'IGV : S/', x0: 60, y0: 226, x1: 200, y1: 244, confidence: 94 },
    { text: '1.75', x0: 290, y0: 226, x1: 340, y1: 244, confidence: 96 },
    { text: 'Importe Total : S/', x0: 60, y0: 252, x1: 200, y1: 270, confidence: 94 },
    { text: '11.50', x0: 290, y0: 252, x1: 340, y1: 270, confidence: 96 },
    { text: 'SON: ONCE CON 50/100 SOLES', x0: 20, y0: 280, x1: 320, y1: 298, confidence: 95 },
  ];

  const rows = clusterOcrTokensIntoRows(tokens);
  assert.ok(rows.some((r) => r.text.includes('Importe Total : S/ 11.50')));

  const spatial = parseSpatialReceipt({
    tokens,
    rawText: rows.map((r) => r.text).join('\n'),
    criteria: DEFAULT_CRITERIA,
  });
  const qr = parseSunatQrString(
    '20534123605|01|F002|0002741|1.75|11.50|2026-10-29|6|20613997360|'
  );
  const merged = mergeQrAndSpatialOcr({
    qr,
    spatial,
    criteria: DEFAULT_CRITERIA,
  });

  assert.equal(merged.qrVerified, true);
  assert.equal(merged.needsAiEscalation, false);
  assert.ok((merged.confianzaLectura ?? 0) >= 95);
  assert.equal(merged.ruc, '20534123605');
  assert.equal(merged.numeroComprobante, 'F002-0002741');
  assert.equal(merged.fechaEmision, '2026-10-29');
  assert.equal(merged.total, 11.5);
  assert.equal(merged.igv, 1.75);
  assert.equal(merged.subtotal, 9.75);
  assert.match(merged.razonSocial, /SERVICIOS LIZ/);
});
