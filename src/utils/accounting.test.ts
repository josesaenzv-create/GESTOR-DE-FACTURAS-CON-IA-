import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStandardPhotoFilename,
  calculateIgvBreakdown,
  detectDuplicateExpense,
  formatCommaDecimal,
  getImpactLevel,
  getMonthNameFromIsoDate,
  isManagerUser,
  parseCommaDecimal,
} from './accounting';
import { SEED_EXPENSES } from '../data/seedData';

test('calculateIgvBreakdown computes 18% IGV for FACTURA and 0 for BOLETA/RECIBO', () => {
  const factura = calculateIgvBreakdown(118, 'FACTURA');
  assert.equal(factura.subtotal, 100);
  assert.equal(factura.igv, 18);
  assert.equal(factura.total, 118);

  const facturaDecimal = calculateIgvBreakdown(349, 'FACTURA');
  assert.equal(facturaDecimal.subtotal, 295.76);
  assert.equal(facturaDecimal.igv, 53.24);
  assert.equal(facturaDecimal.total, 349);

  const boleta = calculateIgvBreakdown(150, 'BOLETA');
  assert.equal(boleta.subtotal, 150);
  assert.equal(boleta.igv, 0);
  assert.equal(boleta.total, 150);
});

test('formatCommaDecimal and parseCommaDecimal handle Peruvian comma decimal formats', () => {
  assert.equal(formatCommaDecimal(295.76), '295,76');
  assert.equal(formatCommaDecimal(53.24), '53,24');
  assert.equal(parseCommaDecimal('295,76'), 295.76);
  assert.equal(parseCommaDecimal('S/ 1,250.40'), 1250.4);
  assert.equal(parseCommaDecimal('1.250,40'), 1250.4);
});

test('getImpactLevel enforces <=60 Regular, <=250 Medio, >250 Fuerte', () => {
  assert.equal(getImpactLevel(60), 'Regular');
  assert.equal(getImpactLevel(60.01), 'Medio');
  assert.equal(getImpactLevel(250), 'Medio');
  assert.equal(getImpactLevel(250.01), 'Fuerte');
});

test('buildStandardPhotoFilename formats {ID}_{TIPO}_{SERIE_NUMERO}_RUC{RUC}_{FECHA}.jpg', () => {
  const filename = buildStandardPhotoFilename(
    'CB-2026-0001',
    'FACTURA',
    'F004-000458',
    '20269985900',
    '2026-11-04'
  );
  assert.equal(
    filename,
    'CB-2026-0001_FACTURA_F004-000458_RUC20269985900_2026-11-04.jpg'
  );
});

test('detectDuplicateExpense catches matching RUC + numeroComprobante and ignores excluded ID', () => {
  const dup = detectDuplicateExpense(SEED_EXPENSES, '20269985900', 'F004-000458');
  assert.ok(dup);
  assert.equal(dup?.id, 'CB-2026-0001');

  const notDupSameId = detectDuplicateExpense(
    SEED_EXPENSES,
    '20269985900',
    'F004-000458',
    'CB-2026-0001'
  );
  assert.equal(notDupSameId, null);
});

test('getMonthNameFromIsoDate and isManagerUser work accurately', () => {
  assert.equal(getMonthNameFromIsoDate('2026-11-17'), 'NOVIEMBRE');
  assert.equal(getMonthNameFromIsoDate('2026-01-05'), 'ENERO');
  assert.equal(
    isManagerUser({ usuario: 'JOSE', cargo: 'GERENTE DE OPERACIONES', sede: 'HUACHO' }),
    true
  );
  assert.equal(
    isManagerUser({ usuario: 'ADMIN', cargo: 'ADMINISTRADOR', sede: 'TODAS' }),
    true
  );
  assert.equal(
    isManagerUser({ usuario: 'CAJA', cargo: 'CAJERO', sede: 'HUACHO' }),
    false
  );
});
