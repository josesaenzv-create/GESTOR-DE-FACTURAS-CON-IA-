import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBudgetKey,
  canUserAccessBudgetTab,
  computeBudgetProgress,
  createDefaultBudgetFromSede,
  getPreviousMonthPeriod,
  replicateBudgetToMonth,
  resolveUserBudgetVisibility,
} from './budgets';
import { SEED_EXPENSES } from '../data/seedData';
import type { MonthlySedeBudget } from '../types/crediban';

test('getPreviousMonthPeriod handles standard months and January year rollover', () => {
  assert.deepEqual(getPreviousMonthPeriod('2026', 'NOVIEMBRE'), {
    anio: '2026',
    mes: 'OCTUBRE',
  });
  assert.deepEqual(getPreviousMonthPeriod('2026', 'ENERO'), {
    anio: '2025',
    mes: 'DICIEMBRE',
  });
});

test('computeBudgetProgress calculates Fijo, Variable, and optional detailed partidas progress', () => {
  const budget: MonthlySedeBudget = {
    id: buildBudgetKey('HUACHO', '2026', 'NOVIEMBRE'),
    sede: 'HUACHO',
    anio: '2026',
    mes: 'NOVIEMBRE',
    presupuestoFijoTotal: 5000,
    presupuestoVariableTotal: 1500,
    partidas: [
      {
        id: 'p1',
        naturaleza: 'Costo Fijo',
        concepto: 'Energía Eléctrica',
        categoriaMatch: 'Energía Eléctrica',
        montoAsignado: 500,
      },
      {
        id: 'p2',
        naturaleza: 'Costo Variable',
        concepto: 'Combustible / Grifos',
        categoriaMatch: 'Combustible',
        montoAsignado: 300,
      },
    ],
    visibilidadPorDefecto: 'ONLY_VARIABLE',
    visibilidadPorUsuario: {
      CAJA_HUACHO: 'ALL',
    },
  };

  const progress = computeBudgetProgress(budget, SEED_EXPENSES);
  assert.equal(progress.fijoAsignado, 5000);
  assert.ok(progress.fijoEjecutado >= 349);
  assert.equal(progress.partidasProgress.length, 2);
  assert.ok(progress.partidasProgress[0].ejecutado >= 349);
  assert.equal(progress.partidasProgress[0].status, 'Saludable');
});

test('resolveUserBudgetVisibility & canUserAccessBudgetTab grant Gerente+Administrador by default and hide Cajeros/Asesores until enabled', () => {
  const defaultBudget = createDefaultBudgetFromSede(undefined, 'HUACHO', '2026', 'NOVIEMBRE');
  assert.equal(defaultBudget.visibilidadPorDefecto, 'HIDDEN');

  const gerente = { usuario: 'JOSE_SAENZ', cargo: 'GERENTE DE OPERACIONES', sede: 'TODAS' };
  const admin = { usuario: 'ADMIN_HUA', cargo: 'ADMINISTRADOR DE SEDE', sede: 'HUACHO' };
  const cajero = { usuario: 'CAJA_HUACHO', cargo: 'CAJERO', sede: 'HUACHO' };
  const asesor = { usuario: 'ASESOR1', cargo: 'ASESOR', sede: 'HUACHO' };

  // Default with no budget enabled for Cajeros
  assert.equal(canUserAccessBudgetTab(gerente, [defaultBudget]), true);
  assert.equal(canUserAccessBudgetTab(admin, [defaultBudget]), true);
  assert.equal(canUserAccessBudgetTab(cajero, [defaultBudget]), false);
  assert.equal(canUserAccessBudgetTab(asesor, [defaultBudget]), false);
  assert.equal(resolveUserBudgetVisibility(defaultBudget, admin), 'ALL');
  assert.equal(resolveUserBudgetVisibility(defaultBudget, cajero), 'HIDDEN');

  // When Gerencia explicitly enables partial visibility for Cajero
  const partialBudget: MonthlySedeBudget = {
    id: 'HUARAZ::2026::NOVIEMBRE',
    sede: 'HUARAZ',
    anio: '2026',
    mes: 'NOVIEMBRE',
    presupuestoFijoTotal: 4000,
    presupuestoVariableTotal: 1200,
    partidas: [],
    visibilidadPorDefecto: 'HIDDEN',
    visibilidadPorUsuario: {
      CAJA_HUARAZ: 'ONLY_VARIABLE',
      ASESOR_TOP: 'HIDDEN',
    },
  };

  assert.equal(
    resolveUserBudgetVisibility(partialBudget, {
      usuario: 'JOSE_SAENZ',
      cargo: 'GERENTE DE OPERACIONES',
      sede: 'TODAS',
    }),
    'ALL'
  );
  assert.equal(
    resolveUserBudgetVisibility(partialBudget, {
      usuario: 'CAJA_HUARAZ',
      cargo: 'CAJERO',
      sede: 'HUARAZ',
    }),
    'ONLY_VARIABLE'
  );
  assert.equal(
    canUserAccessBudgetTab(
      { usuario: 'CAJA_HUARAZ', cargo: 'CAJERO', sede: 'HUARAZ' },
      [partialBudget]
    ),
    true
  );
  assert.equal(
    resolveUserBudgetVisibility(partialBudget, {
      usuario: 'ASESOR_TOP',
      cargo: 'ASESOR',
      sede: 'HUARAZ',
    }),
    'HIDDEN'
  );
});

test('replicateBudgetToMonth clones partidas and visibility settings into new month', () => {
  const oct: MonthlySedeBudget = {
    id: 'HUACHO::2026::OCTUBRE',
    sede: 'HUACHO',
    anio: '2026',
    mes: 'OCTUBRE',
    presupuestoFijoTotal: 6200,
    presupuestoVariableTotal: 2500,
    partidas: [
      {
        id: 'old-1',
        naturaleza: 'Costo Fijo',
        concepto: 'Planillas + EsSalud',
        montoAsignado: 4500,
      },
    ],
    visibilidadPorDefecto: 'ONLY_VARIABLE',
    visibilidadPorUsuario: { CAJA_HUACHO: 'ALL' },
  };

  const nov = replicateBudgetToMonth(oct, '2026', 'NOVIEMBRE', 'GERENCIA');
  assert.equal(nov.id, 'HUACHO::2026::NOVIEMBRE');
  assert.equal(nov.mes, 'NOVIEMBRE');
  assert.equal(nov.presupuestoFijoTotal, 6200);
  assert.equal(nov.partidas.length, 1);
  assert.notEqual(nov.partidas[0].id, 'old-1');
  assert.equal(nov.visibilidadPorUsuario.CAJA_HUACHO, 'ALL');
});
