import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateByCategoryOrSubtype,
  aggregateByImpact,
  aggregateByMonth,
  aggregateBySede,
  aggregateFiscalComparison,
  aggregateIgvProgress,
  calculateSalesIgvBreakdown,
  filterExpensesAdvanced,
} from './analytics';
import type { ExpenseRecord, SedeRecord } from '../types/crediban';

const SAMPLE_SEDES: SedeRecord[] = [
  {
    codigoSede: 'HUACHO',
    nombreSede: 'HUACHO',
    estado: 'ACTIVO',
    presupuestoMensualFijo: 1000,
    presupuestoMensualVariable: 500,
  },
  {
    codigoSede: 'HUAURA',
    nombreSede: 'HUAURA',
    estado: 'ACTIVO',
    presupuestoMensualFijo: 800,
    presupuestoMensualVariable: 200,
  },
];

function makeExpense(overrides: Partial<ExpenseRecord>): ExpenseRecord {
  return {
    id: 'CB-1',
    fecha: '2026-08-10',
    anio: '2026',
    mes: 'AGOSTO',
    sede: 'HUACHO',
    categoriaForms: 'Servicios básicos',
    naturaleza: 'Costo Fijo',
    categoriaPrincipal: 'Servicios Básicos',
    subtipo: 'Energía eléctrica',
    tipoComprobante: 'FACTURA',
    numeroComprobante: 'F001-00001001',
    ruc: '20100000001',
    razonSocial: 'ENEL S.A.',
    nombreComercial: 'ENEL',
    subtotal: 100,
    igv: 18,
    total: 118,
    descripcion: 'Luz',
    nivelImpacto: 'Medio',
    responsable: 'JOSE',
    cargoUsuario: 'ADMINISTRADOR',
    direccionGps: '',
    coordenadasGps: '',
    linkMapa: '',
    linkFotoHd: '',
    estado: 'APROBADO',
    ...overrides,
  };
}

test('aggregateBySede computes fijo, variable, igv, and only keeps active sedes when provided', () => {
  const expenses: ExpenseRecord[] = [
    makeExpense({ id: '1', sede: 'HUACHO', naturaleza: 'Costo Fijo', subtotal: 500, igv: 90, total: 590 }),
    makeExpense({ id: '2', sede: 'HUACHO', naturaleza: 'Costo Variable', subtotal: 160, igv: 0, total: 160, tipoComprobante: 'BOLETA' }),
    makeExpense({ id: '3', sede: 'HUAURA', naturaleza: 'Costo Variable', subtotal: 254.24, igv: 45.76, total: 300 }),
    makeExpense({ id: '4', sede: 'HUANUCO', total: 400 }), // Disabled sede not in SAMPLE_SEDES
  ];

  const rows = aggregateBySede(expenses, SAMPLE_SEDES);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].sede, 'HUACHO');
  assert.equal(rows[0].fijo, 590);
  assert.equal(rows[0].variable, 160);
  assert.equal(rows[0].total, 750);
  assert.equal(rows[0].igv, 90);
  assert.equal(rows[0].budgetTotal, 1500);
  assert.equal(rows[0].executionPct, 50);

  assert.equal(rows[1].sede, 'HUAURA');
  assert.equal(rows[1].total, 300);
  assert.equal(rows[1].executionPct, 30);
});

test('filterExpensesAdvanced filters by date range, naturaleza, categoriaPrincipal, and subtipo', () => {
  const expenses: ExpenseRecord[] = [
    makeExpense({
      id: '1',
      fecha: '2026-08-05',
      naturaleza: 'Costo Fijo',
      categoriaPrincipal: 'Servicios Básicos',
      subtipo: 'Energía eléctrica',
    }),
    makeExpense({
      id: '2',
      fecha: '2026-08-18',
      naturaleza: 'Costo Variable',
      categoriaPrincipal: 'Viáticos y Movilidad',
      subtipo: 'Pasajes urbanos',
    }),
    makeExpense({
      id: '3',
      fecha: '2026-09-01',
      naturaleza: 'Costo Variable',
      categoriaPrincipal: 'Viáticos y Movilidad',
      subtipo: 'Combustible',
    }),
  ];

  const filtered = filterExpensesAdvanced(expenses, {
    anio: 'TODOS',
    mes: 'TODOS',
    dateFrom: '2026-08-10',
    dateTo: '2026-08-31',
    sede: 'TODAS',
    impacto: 'TODOS',
    naturaleza: 'Costo Variable',
    categoriaPrincipal: 'Viáticos y Movilidad',
    subtipo: 'Pasajes urbanos',
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, '2');
});

test('calculateSalesIgvBreakdown and aggregateFiscalComparison compare sales IGV vs purchase IGV', () => {
  const sales = calculateSalesIgvBreakdown(1180);
  assert.equal(sales.baseImponible, 1000);
  assert.equal(sales.igvVentas, 180);

  const expenses: ExpenseRecord[] = [
    makeExpense({ id: '1', anio: '2026', mes: 'AGOSTO', subtotal: 500, igv: 90, total: 590 }),
  ];

  const fiscal = aggregateFiscalComparison(
    expenses,
    [{ anio: '2026', mes: 'AGOSTO', ...sales }],
    '2026',
    'AGOSTO'
  );

  assert.equal(fiscal.igvVentas, 180);
  assert.equal(fiscal.igvCompras, 90);
  assert.equal(fiscal.igvNeto, 90);
});

test('aggregateByCategoryOrSubtype ranks categories by total descending', () => {
  const expenses: ExpenseRecord[] = [
    makeExpense({ id: '1', subtipo: 'Energía', total: 120 }),
    makeExpense({ id: '2', subtipo: 'Combustible', total: 350 }),
    makeExpense({ id: '3', subtipo: 'Energía', total: 100 }),
  ];

  const rows = aggregateByCategoryOrSubtype(expenses, 'subtipo');
  assert.equal(rows[0].label, 'Combustible');
  assert.equal(rows[0].total, 350);
  assert.equal(rows[1].label, 'Energía');
  assert.equal(rows[1].total, 220);
});

test('aggregateByMonth orders ENERO..DICIEMBRE and tracks cumulative IGV', () => {
  const expenses: ExpenseRecord[] = [
    makeExpense({ id: '1', mes: 'ENERO', subtotal: 100, igv: 18, total: 118 }),
    makeExpense({ id: '2', mes: 'AGOSTO', subtotal: 200, igv: 36, total: 236 }),
  ];

  const months = aggregateByMonth(expenses);
  assert.equal(months.length, 12);
  assert.equal(months[0].mes, 'ENERO');
  assert.equal(months[0].igv, 18);
  assert.equal(months[0].cumulativeIgv, 18);

  const aug = months.find((m) => m.mes === 'AGOSTO');
  assert.ok(aug);
  assert.equal(aug.total, 236);
  assert.equal(aug.cumulativeTotal, 354);
  assert.equal(aug.cumulativeIgv, 54);
});

test('aggregateIgvProgress distinguishes IGV invoices from non-IGV receipts', () => {
  const expenses: ExpenseRecord[] = [
    makeExpense({ id: '1', tipoComprobante: 'FACTURA', subtotal: 100, igv: 18, total: 118 }),
    makeExpense({ id: '2', tipoComprobante: 'RECIBO DE MOVILIDAD', subtotal: 82, igv: 0, total: 82 }),
  ];

  const summary = aggregateIgvProgress(expenses);
  assert.equal(summary.totalGastado, 200);
  assert.equal(summary.igvCreditoFiscal, 18);
  assert.equal(summary.subtotalGravado, 100);
  assert.equal(summary.noGravadoTotal, 82);
  assert.equal(summary.facturaCount, 1);
  assert.equal(summary.nonFacturaCount, 1);
  assert.equal(summary.igvOverTotalPct, 9);
  assert.equal(summary.gravadoSharePct, 59);
});

test('aggregateByImpact groups expenses by Regular, Medio, Fuerte', () => {
  const expenses: ExpenseRecord[] = [
    makeExpense({ id: '1', nivelImpacto: 'Regular', total: 40 }),
    makeExpense({ id: '2', nivelImpacto: 'Medio', total: 150 }),
    makeExpense({ id: '3', nivelImpacto: 'Fuerte', total: 400 }),
  ];

  const imp = aggregateByImpact(expenses);
  assert.equal(imp.regular.total, 40);
  assert.equal(imp.medio.total, 150);
  assert.equal(imp.fuerte.total, 400);
});
