import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeOfflineConfidenceScore,
  normalizePeruDateIso,
  parseMontoEnLetrasPeru,
  sanitizeSerieCorrelativo,
  shouldAcceptEmitterRuc,
  validatePeruTaxAndMath,
  validateSunatRucMod11,
} from './invoiceValidator';
import { parseSunatQrString } from './sunatQrParser';

test('validateSunatRucMod11 validates real Peruvian emitter RUCs and rejects invalid checksums', () => {
  // Real verified emitter RUCs from uploaded invoices
  assert.equal(validateSunatRucMod11('20601314984'), true); // Farmacia Hiromi
  assert.equal(validateSunatRucMod11('10316801426'), true); // Tonny Brandon Rascon
  assert.equal(validateSunatRucMod11('20609699982'), true); // Terranova Trading / Trujillo Market
  assert.equal(validateSunatRucMod11('20534123605'), true); // Lavanderia Liz
  assert.equal(validateSunatRucMod11('10316786613'), true); // Notaria Spetale
  assert.equal(validateSunatRucMod11('10425088659'), true); // Polleria Santo Domingo
  assert.equal(validateSunatRucMod11('10713721633'), true); // Emisor F003-00005141
  assert.equal(validateSunatRucMod11('20613997360'), true); // CREDIBAN PERU S.A.C.

  // Invalid checksum / prefix / length
  assert.equal(validateSunatRucMod11('20548796321'), false);
  assert.equal(validateSunatRucMod11('30601314984'), false);
  assert.equal(validateSunatRucMod11('12345'), false);
});

test('shouldAcceptEmitterRuc strictly blocks CREDIBAN PERU S.A.C. RUC 20613997360', () => {
  assert.equal(shouldAcceptEmitterRuc('20613997360'), false);
  assert.equal(shouldAcceptEmitterRuc('20601314984'), true);
  assert.equal(shouldAcceptEmitterRuc('20611658410', ['20611658410']), false);
});

test('parseMontoEnLetrasPeru parses all Peruvian receipt SON lines accurately', () => {
  assert.equal(parseMontoEnLetrasPeru('SON: UN CON 80/100 SOLES'), 1.8);
  assert.equal(parseMontoEnLetrasPeru('SON: SESENTA Y 00/100 SOLES'), 60.0);
  assert.equal(parseMontoEnLetrasPeru('SON: DOCE CON 00/100 Peruvian Nuevo Sol'), 12.0);
  assert.equal(parseMontoEnLetrasPeru('SON: ONCE CON 50/100 SOLES'), 11.5);
  assert.equal(parseMontoEnLetrasPeru('SON: VEINTE Y CUATRO Y 00/100 Soles'), 24.0);
  assert.equal(parseMontoEnLetrasPeru('SON: TREINTA Y CUATRO Y 00/100 Soles'), 34.0);
});

test('sanitizeSerieCorrelativo ignores Resolucion de Intendencia and printer ranges', () => {
  assert.equal(
    sanitizeSerieCorrelativo('034-005-0005315', [
      'AUTORIZADO MEDIANTE RESOLUCION N° 034-005-0005315',
      'FACTURA ELECTRONICA',
      'F001-00034719',
    ]),
    'F001-00034719'
  );

  assert.equal(
    sanitizeSerieCorrelativo('', [
      'BOLETA DE VENTA',
      '001 - N° 02139',
      'AUT. N° 0120661233 SERIE 001 DEL 002001-003000',
    ]),
    '001-02139'
  );
});

test('normalizePeruDateIso handles 2-digit years, DD/MM/YYYY, and Spanish dates', () => {
  assert.equal(normalizePeruDateIso('13/11/26', '2026-11-18').iso, '2026-11-13');
  assert.equal(normalizePeruDateIso('28/10/2026', '2026-11-18').iso, '2026-10-28');
  assert.equal(normalizePeruDateIso('17 nov. 2026', '2026-11-18').iso, '2026-11-17');
});

test('validatePeruTaxAndMath verifies 18% micro-receipts (1.80), MYPE 10.5% 2026 regime, and blocks 180 typo', () => {
  const botica = validatePeruTaxAndMath({
    tipoComprobante: 'FACTURA',
    subtotal: 1.53,
    igv: 0.27,
    total: 1.8,
    montoEnLetras: 'SON: UN CON 80/100 SOLES',
  });
  assert.equal(botica.mathVerified, true);
  assert.equal(botica.detectedRatePct, 18);

  const mype2026 = validatePeruTaxAndMath({
    tipoComprobante: 'FACTURA',
    subtotal: 100.0,
    igv: 10.5,
    total: 110.5,
    montoEnLetras: 'SON: CIENTO DIEZ CON 50/100 SOLES',
  });
  assert.equal(mype2026.mathVerified, true);
  assert.equal(mype2026.detectedRatePct, 10.5);

  const decimalBug = validatePeruTaxAndMath({
    tipoComprobante: 'FACTURA',
    subtotal: 1.53,
    igv: 0.27,
    total: 180.0,
    montoEnLetras: 'SON: UN CON 80/100 SOLES',
  });
  assert.equal(decimalBug.mathVerified, false);
  assert.equal(decimalBug.mathMismatch, true);
  assert.equal(decimalBug.wordsMismatch, true);
});

test('parseSunatQrString handles all 4 real SUNAT QR formats in production', () => {
  // Format 1: Standard pipe-separated with YYYY-MM-DD
  const qr1 = parseSunatQrString(
    '20534123605|01|F002|0002741|1.75|11.50|2026-10-29|6|20613997360|'
  );
  assert.ok(qr1);
  assert.equal(qr1.rucEmisor, '20534123605');
  assert.equal(qr1.serieCorrelativo, 'F002-0002741');
  assert.equal(qr1.igv, 1.75);
  assert.equal(qr1.total, 11.5);
  assert.equal(qr1.subtotal, 9.75);
  assert.equal(qr1.fechaEmision, '2026-10-29');
  assert.equal(qr1.qrVerified, true);

  // Format 2: Date omitted
  const qr2 = parseSunatQrString('10316801426|01|E001|6565|9.15|60.00|6|20613997360|');
  assert.ok(qr2);
  assert.equal(qr2.rucEmisor, '10316801426');
  assert.equal(qr2.serieCorrelativo, 'E001-6565');
  assert.equal(qr2.igv, 9.15);
  assert.equal(qr2.total, 60.0);
  assert.equal(qr2.subtotal, 50.85);
  assert.equal(qr2.fechaEmision, '');

  // Format 3: Spaced PSE format with IGV percentage rate "18" instead of S/ amount
  const qr3 = parseSunatQrString('10713721633 | 1 | F003 | 00005141 | 18 | 45.00 | 21/10/2026');
  assert.ok(qr3);
  assert.equal(qr3.rucEmisor, '10713721633');
  assert.equal(qr3.serieCorrelativo, 'F003-00005141');
  assert.equal(qr3.total, 45.0);
  assert.equal(qr3.igvRateHint, 18);
  assert.equal(qr3.igv, 6.86);
  assert.equal(qr3.subtotal, 38.14);
  assert.equal(qr3.fechaEmision, '2026-10-21');

  // Format 4: Notary PSE prefixed-docType format
  const qr4 = parseSunatQrString(
    '6|10316786613|6|20611658410|01|001-00008766|2026-10-21|3.66|24.00|'
  );
  assert.ok(qr4);
  assert.equal(qr4.rucEmisor, '10316786613');
  assert.equal(qr4.serieCorrelativo, 'F001-00008766');
  assert.equal(qr4.igv, 3.66);
  assert.equal(qr4.total, 24.0);
  assert.equal(qr4.subtotal, 20.34);
  assert.equal(qr4.fechaEmision, '2026-10-21');
});

test('computeOfflineConfidenceScore reaches >= 95% on verified QR receipts and < 95% on handwritten/missing fields', () => {
  const qrVerifiedScore = computeOfflineConfidenceScore({
    qrVerified: true,
    tipoComprobante: 'FACTURA',
    rucValid: true,
    hasSerie: true,
    hasValidDate: true,
    dateMissing: false,
    mathVerified: true,
    wordsMatched: true,
    hasRazonSocial: true,
    hasDescripcion: true,
    isTransfer: false,
    hasNumeroOperacion: false,
  });
  assert.ok(qrVerifiedScore >= 0.95);

  const handwrittenLowConfScore = computeOfflineConfidenceScore({
    qrVerified: false,
    tipoComprobante: 'BOLETA',
    rucValid: true,
    hasSerie: true,
    hasValidDate: true,
    dateMissing: false,
    mathVerified: true,
    wordsMatched: false,
    hasRazonSocial: true,
    hasDescripcion: false,
    isTransfer: false,
    hasNumeroOperacion: false,
    ocrMeanConfidence: 68,
  });
  assert.ok(handwrittenLowConfScore < 0.95);
});
