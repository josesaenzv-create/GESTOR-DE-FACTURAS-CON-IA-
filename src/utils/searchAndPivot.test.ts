import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPivotTree,
  buildProviderChips,
  computeProviderSummary,
  correctPeruUbigeo,
  exportExpensesToCsv,
  matchesExpenseSearch,
  normalizeComprobanteNumber,
  parseCsvRecords,
} from './searchAndPivot';
import { SEED_EXPENSES } from '../data/seedData';

test('normalizeComprobanteNumber and matchesExpenseSearch ignore series and leading zeros', () => {
  assert.equal(normalizeComprobanteNumber('F004-000458'), '458');
  assert.equal(normalizeComprobanteNumber('000458'), '458');

  const luz = SEED_EXPENSES[0];
  assert.equal(matchesExpenseSearch(luz, '458'), true);
  assert.equal(matchesExpenseSearch(luz, '20269985900'), true);
  assert.equal(matchesExpenseSearch(luz, 'Pluz Energía'), true);
  assert.equal(matchesExpenseSearch(luz, 'PRIMAX'), false);
});

test('computeProviderSummary and buildProviderChips aggregate totals accurately', () => {
  const huachoLuz = SEED_EXPENSES.filter((r) => r.ruc === '20269985900');
  const summary = computeProviderSummary(huachoLuz);
  assert.ok(summary);
  assert.equal(summary?.totalComprobantes, 1);
  assert.equal(summary?.subtotalAcumulado, 295.76);
  assert.equal(summary?.igvAcumulado, 53.24);
  assert.equal(summary?.totalAcumulado, 349);

  const chips = buildProviderChips(SEED_EXPENSES);
  assert.equal(chips.length, 5);
  assert.equal(chips[0].ruc, '10214567892');
  assert.equal(chips[0].total, 1850);
});

test('buildPivotTree groups Costo Fijo and Costo Variable across 3 levels', () => {
  const tree = buildPivotTree(SEED_EXPENSES);
  assert.equal(tree.length, 2);
  assert.equal(tree[0].naturaleza, 'Costo Fijo');
  assert.equal(tree[0].count, 3);
  assert.equal(tree[0].total, 2398); // 349 + 1850 + 199
  assert.equal(tree[1].naturaleza, 'Costo Variable');
  assert.equal(tree[1].count, 2);
  assert.equal(tree[1].total, 204); // 150 + 54
});

test('correctPeruUbigeo resolves Huaura districts properly', () => {
  const res = correctPeruUbigeo({
    display_name: 'Avenida 28 de Julio, Hualmay, Huaura, Lima, Perú',
    address: {
      road: 'Avenida 28 de Julio',
      house_number: '412',
      suburb: 'Hualmay',
      county: 'Huaura',
    },
  });
  assert.equal(res.district, 'Hualmay');
  assert.equal(res.province, 'Huaura');
  assert.equal(res.address, 'Avenida 28 de Julio 412, Hualmay, Huaura');
});

test('exportExpensesToCsv and parseCsvRecords preserve quoted commas', () => {
  const csv = exportExpensesToCsv(SEED_EXPENSES);
  assert.ok(csv.startsWith('\uFEFF'));
  const parsed = parseCsvRecords(csv);
  assert.equal(parsed.length, SEED_EXPENSES.length);
  assert.equal(parsed[0].id, 'CB-2026-0001');
  assert.equal(parsed[0].total, 349);
  assert.equal(parsed[0].direccionGps, 'Av. 28 de Julio 412, Huacho, Huaura');
});
