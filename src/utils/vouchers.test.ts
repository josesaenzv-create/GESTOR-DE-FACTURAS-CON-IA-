import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VOUCHER_TEMPLATES,
  filterMatchingCollaborators,
  formatVoucherDateTime,
  getNextVoucherCorrelative,
} from './vouchers';
import type { ExpenseRecord, UserSession } from '../types/crediban';

test('getNextVoucherCorrelative increments existing series accurately and independently per sede', () => {
  const expenses = [
    { sede: 'HUACHO', numeroComprobante: 'M001-0126' },
    { sede: 'HUACHO', numeroComprobante: 'M001-0127' },
    { sede: 'HUACHO', numeroComprobante: 'RC01-0025' },
    { sede: 'HUARAZ', numeroComprobante: 'RC01-0003' },
  ] as ExpenseRecord[];

  assert.equal(getNextVoucherCorrelative(expenses, 'M001'), '0128');
  assert.equal(getNextVoucherCorrelative(expenses, 'M001', 'HUACHO'), '0128');
  assert.equal(getNextVoucherCorrelative(expenses, 'M001', 'HUARAZ'), '0001');
  assert.equal(getNextVoucherCorrelative(expenses, 'M001', 'ICA'), '0001');
  assert.equal(getNextVoucherCorrelative(expenses, 'RC01', 'HUARAZ'), '0004');
  assert.equal(getNextVoucherCorrelative(expenses, 'RC01', 'HUACHO'), '0026');
  assert.equal(getNextVoucherCorrelative(expenses, 'CC01', 'HUACHO'), '0001');
});

test('filterMatchingCollaborators matches by name or DNI', () => {
  const users: UserSession[] = [
    {
      usuario: 'HEYDI.TALAVERANO',
      nombreCompleto: 'HEYDI DINA TALAVERANO',
      dni: '75258722',
      cargo: 'ASESOR',
      sede: 'HUACHO',
    },
    {
      usuario: 'JOSE.SAENZ',
      nombreCompleto: 'JOSE SAENZ VARGAS',
      dni: '44556677',
      cargo: 'GERENTE',
      sede: 'TODAS',
    },
  ];

  assert.equal(filterMatchingCollaborators(users, 'heydi').length, 1);
  assert.equal(filterMatchingCollaborators(users, '752587').length, 1);
  assert.equal(filterMatchingCollaborators(users, 'saenz')[0].dni, '44556677');
});

test('VOUCHER_TEMPLATES configures Caja as free-typing default and Movilidad with user suggestions', () => {
  assert.equal(VOUCHER_TEMPLATES.CAJA.suggestUsersByDefault, false);
  assert.equal(VOUCHER_TEMPLATES.MOVILIDAD.suggestUsersByDefault, true);
  assert.equal(VOUCHER_TEMPLATES.INCENTIVOS.suggestUsersByDefault, true);
  assert.equal(formatVoucherDateTime('2026-11-02'), '2/11/2026 00:00');
});
