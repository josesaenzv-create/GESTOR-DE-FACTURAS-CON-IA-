import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStandardPhotoFilename,
  calculateIgvBreakdown,
  detectDuplicateExpense,
  formatCommaDecimal,
  getImpactLevel,
  getMonthNameFromIsoDate,
  isDefaultAuthorizedRole,
  isManagerUser,
  mergeSedeMetadata,
  parseCommaDecimal,
  resolveUserSystemAccess,
} from './accounting';
import { DEFAULT_SEDES, SEED_EXPENSES } from '../data/seedData';

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
  assert.equal(
    isManagerUser({ usuario: 'CAJA_HUACHO', cargo: 'ADMINISTRADOR DE SEDE', sede: 'HUACHO' }),
    false
  );
  assert.equal(
    isManagerUser({ usuario: 'ASESOR1', cargo: 'ASESOR', sede: 'HUARAZ' }),
    false
  );
});

test('isDefaultAuthorizedRole allows only Cajeros, Administradores and Gerencia by default', () => {
  assert.equal(isDefaultAuthorizedRole('Cajero'), true);
  assert.equal(isDefaultAuthorizedRole('CAJERA'), true);
  assert.equal(isDefaultAuthorizedRole('Administrador'), true);
  assert.equal(isDefaultAuthorizedRole('ADMINISTRADOR DE SEDE'), true);
  assert.equal(isDefaultAuthorizedRole('Gerente'), true);
  assert.equal(isDefaultAuthorizedRole('GERENTE GENERAL'), true);

  // Blocked by default
  assert.equal(isDefaultAuthorizedRole('Asesor'), false);
  assert.equal(isDefaultAuthorizedRole('ASESOR DE NEGOCIOS'), false);
  assert.equal(isDefaultAuthorizedRole('Jefe de Equipo'), false);
  assert.equal(isDefaultAuthorizedRole('Trabajador'), false);
  assert.equal(isDefaultAuthorizedRole(''), false);
});

test('resolveUserSystemAccess enforces master disabled, explicit override, then role policy', () => {
  // Cajero & Administrador allowed by default
  assert.equal(resolveUserSystemAccess({ estado: 'HABILITADO', cargo: 'Cajero' }), true);
  assert.equal(resolveUserSystemAccess({ estado: 'HABILITADO', cargo: 'Administrador' }), true);

  // Asesor blocked by default, unless explicitly allowed by Gerencia
  assert.equal(resolveUserSystemAccess({ estado: 'HABILITADO', cargo: 'Asesor' }), false);
  assert.equal(
    resolveUserSystemAccess({ estado: 'HABILITADO', cargo: 'Asesor', override: true }),
    true
  );

  // Master disabled blocks even Gerente/Cajero with override=true
  assert.equal(
    resolveUserSystemAccess({ estado: 'DESHABILITADO', cargo: 'Cajero', override: true }),
    false
  );
  assert.equal(
    resolveUserSystemAccess({ estado: 'HABILITADO', cargo: 'Cajero', override: false }),
    false
  );
});

test('mergeSedeMetadata uses live Users API direccion & celular when CONFIG_SEDES is empty', () => {
  const seedHuacho = DEFAULT_SEDES.find((s) => s.nombreSede === 'HUACHO');
  const merged = mergeSedeMetadata({
    sede: {
      codigoSede: '',
      nombreSede: 'HUACHO',
      estado: 'ACTIVO',
      presupuestoMensualFijo: 5000,
      presupuestoMensualVariable: 4000,
      direccion: '',
      telefono: '',
      ubicacion: '',
    },
    masterSede: {
      codigoSede: 'SED-HUA',
      nombreSede: 'HUACHO',
      direccion: 'Av. 28 de Julio / Sede Central Huacho',
      telefono: '999111222',
      correoContacto: 'credibanperu@gmail.com',
    },
    custom: {
      direccion: '',
      telefono: '',
    },
    seedMatch: seedHuacho,
  });

  assert.equal(merged.codigoSede, 'SED-HUA');
  assert.equal(merged.direccion, 'Av. 28 de Julio / Sede Central Huacho');
  assert.equal(merged.telefono, '999111222');

  // Explicit manager custom edit overrides Users API
  const withCustom = mergeSedeMetadata({
    sede: {
      codigoSede: '',
      nombreSede: 'HUACHO',
      estado: 'ACTIVO',
      presupuestoMensualFijo: 5000,
      presupuestoMensualVariable: 4000,
      direccion: '',
      telefono: '',
    },
    masterSede: {
      direccion: 'Av. 28 de Julio / Sede Central Huacho',
      telefono: '999111222',
    },
    custom: {
      direccion: 'CALLE NUEVA 456',
      telefono: '988777666',
    },
    seedMatch: seedHuacho,
  });

  assert.equal(withCustom.direccion, 'CALLE NUEVA 456');
  assert.equal(withCustom.telefono, '988777666');
});
