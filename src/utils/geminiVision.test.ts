import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditGeminiExtraction,
  buildGeminiRequestPayload,
  GEMINI_RESPONSE_SCHEMA,
  parseMontoEnLetrasPeru,
} from './geminiVision';
import { DEFAULT_CRITERIA } from '../data/seedData';

test('parseMontoEnLetrasPeru parses Peruvian SON amounts accurately', () => {
  assert.equal(parseMontoEnLetrasPeru('UN CON 80/100 SOLES'), 1.8);
  assert.equal(parseMontoEnLetrasPeru('SON: UNO CON 80/100 SOLES'), 1.8);
  assert.equal(parseMontoEnLetrasPeru('TRESCIENTOS CUARENTA Y NUEVE CON 00/100 SOLES'), 349.0);
  assert.equal(parseMontoEnLetrasPeru('CIENTO OCHENTA Y CINCO CON 50/100 NUEVOS SOLES'), 185.5);
  assert.equal(parseMontoEnLetrasPeru('MIL DOSCIENTOS CUARENTA CON 25/100 SOLES'), 1240.25);
  assert.equal(parseMontoEnLetrasPeru('DOS MIL CON 00/100 SOLES'), 2000.0);
  assert.equal(parseMontoEnLetrasPeru('VEINTICINCO CON 90/100 SOLES'), 25.9);
  assert.equal(parseMontoEnLetrasPeru('CERO CON 50/100 SOLES'), 0.5);
});

test('auditGeminiExtraction verifies clean Farmacia Hiromi invoice without triggering second pass', () => {
  const audit = auditGeminiExtraction(
    {
      transcripcionCabecera: 'BOTICA CENTRAL FARMACIA HIROMI S.A.C. RUC 20601314984 FACTURA ELECTRONICA F001-00034719',
      transcripcionTotales: 'Total Gravado S/ 1.53 | Total IGV S/ 0.27 | Total Venta S/ 1.80 | SON UN CON 80/100 SOLES',
      razonamientoAuditoria: '1.53 + 0.27 = 1.80 coincide con UN CON 80/100 SOLES',
      tipoComprobante: 'FACTURA',
      serieCorrelativo: 'F001-00034719',
      fechaEmision: '13/11/26',
      rucEmisor: '20601314984',
      razonSocialEmisor: 'FARMACIA HIROMI S.A.C.',
      nombreComercialEmisor: 'BOTICA CENTRAL',
      montoEnLetras: 'UN CON 80/100 SOLES',
      subtotal: 1.53,
      igv: 0.27,
      total: 1.8,
      descripcion: 'BICARBONATO SODIO 100G-ALKOFA (1u)',
      categoriaOficial: 'Atención al cliente y bienestar laboral',
      naturaleza: 'Costo Variable',
      subtipo: 'Refrigerios, Agua de Mesa y Café',
      confianzaLectura: 99,
    },
    DEFAULT_CRITERIA,
    'FACTURA'
  );

  assert.equal(audit.mathMismatch, false);
  assert.equal(audit.wordsMismatch, false);
  assert.equal(audit.needsSecondPass, false);
  assert.equal(audit.result.mathVerified, true);
  assert.equal(audit.result.mathAlert, undefined);
  assert.equal(audit.result.fechaEmision, '2026-11-13');
  assert.equal(audit.result.numeroComprobante, 'F001-00034719');
  assert.equal(audit.result.ruc, '20601314984');
  assert.equal(audit.result.total, 1.8);
});

test('auditGeminiExtraction catches missing decimal point (180 vs 1.80) and triggers second pass', () => {
  const audit = auditGeminiExtraction(
    {
      transcripcionCabecera: 'FARMACIA HIROMI S.A.C. F001-00034719',
      transcripcionTotales: 'Total Gravado 1.53 | IGV 0.27 | Total 180.00 | SON UN CON 80/100 SOLES',
      razonamientoAuditoria: 'Error en punto decimal',
      tipoComprobante: 'FACTURA',
      serieCorrelativo: 'F001-00034719',
      fechaEmision: '2026-11-13',
      rucEmisor: '20601314984',
      razonSocialEmisor: 'FARMACIA HIROMI S.A.C.',
      nombreComercialEmisor: 'BOTICA CENTRAL',
      montoEnLetras: 'UN CON 80/100 SOLES',
      subtotal: 1.53,
      igv: 0.27,
      total: 180.0,
      descripcion: 'BICARBONATO SODIO 100G (1u)',
      categoriaOficial: 'Atención al cliente y bienestar laboral',
      naturaleza: 'Costo Variable',
      subtipo: 'Botiquín',
      confianzaLectura: 95,
    },
    DEFAULT_CRITERIA
  );

  assert.equal(audit.mathMismatch, true);
  assert.equal(audit.wordsMismatch, true);
  assert.equal(audit.needsSecondPass, true);
  assert.equal(audit.result.mathVerified, false);
  assert.ok(audit.result.mathAlert?.includes('Verifica el monto'));
});

test('auditGeminiExtraction rejects CREDIBAN RUC and SUNAT Resolucion numbers', () => {
  const audit = auditGeminiExtraction(
    {
      transcripcionCabecera: 'BOTICA CENTRAL FACTURA ELECTRONICA F001-00034719 | Autorizado Res. 034-005-0005315',
      transcripcionTotales: 'Total Venta S/ 118.00 | SON CIENTO DIECIOCHO CON 00/100 SOLES',
      tipoComprobante: 'FACTURA',
      serieCorrelativo: '034-005-0005315',
      fechaEmision: '2026-11-13',
      rucEmisor: '20613997360',
      razonSocialEmisor: 'CREDIBAN PERU S.A.C.',
      nombreComercialEmisor: 'BOTICA CENTRAL',
      montoEnLetras: 'CIENTO DIECIOCHO CON 00/100 SOLES',
      subtotal: 0,
      igv: 0,
      total: 118,
      descripcion: 'BOTICA CENTRAL - Alcohol y gasa',
      categoriaOficial: 'Otros gastos operativos',
      naturaleza: 'Costo Variable',
      subtipo: 'General',
      confianzaLectura: 90,
    },
    DEFAULT_CRITERIA
  );

  assert.equal(audit.result.ruc, '');
  assert.equal(audit.result.razonSocial, '');
  assert.equal(audit.result.numeroComprobante, 'F001-00034719');
  assert.equal(audit.result.subtotal, 100);
  assert.equal(audit.result.igv, 18);
  assert.equal(audit.result.descripcion, 'Alcohol y gasa');
  assert.equal(audit.needsSecondPass, false);
});

test('buildGeminiRequestPayload configures temperature 0.0, topP 0.1, topK 1 and strict transcription-first ordering', () => {
  const payload = buildGeminiRequestPayload({
    imageBase64: 'ZmFrZQ==',
    mimeType: 'image/jpeg',
    criteria: DEFAULT_CRITERIA,
    expectedTipo: 'FACTURA',
  }) as {
    generationConfig: {
      temperature: number;
      topP: number;
      topK: number;
      responseMimeType: string;
      responseSchema: { propertyOrdering: string[] };
    };
  };

  assert.equal(payload.generationConfig.temperature, 0.0);
  assert.equal(payload.generationConfig.topP, 0.1);
  assert.equal(payload.generationConfig.topK, 1);
  assert.equal(payload.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(GEMINI_RESPONSE_SCHEMA.propertyOrdering.slice(0, 4), [
    'transcripcionCabecera',
    'transcripcionTotales',
    'razonamientoAuditoria',
    'tipoComprobante',
  ]);
  assert.equal(GEMINI_RESPONSE_SCHEMA.propertyOrdering.length, 18);
});
