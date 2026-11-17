import {
  MONTH_NAMES,
  type ExpenseRecord,
  type NaturalezaGasto,
  type NivelImpacto,
  type SedeRecord,
} from '../types/crediban';
import { round2 } from './accounting';

export interface SedeAggregate {
  sede: string;
  fijo: number;
  variable: number;
  subtotal: number;
  igv: number;
  total: number;
  budgetTotal: number;
  executionPct: number;
  count: number;
}

export interface MonthAggregate {
  mes: string;
  mesShort: string;
  fijo: number;
  variable: number;
  subtotal: number;
  igv: number;
  total: number;
  cumulativeTotal: number;
  cumulativeIgv: number;
  count: number;
}

export interface IgvProgressSummary {
  totalGastado: number;
  subtotalGravado: number;
  igvCreditoFiscal: number;
  noGravadoTotal: number;
  facturaCount: number;
  nonFacturaCount: number;
  igvOverTotalPct: number;
  gravadoSharePct: number;
}

export interface ImpactAggregate {
  regular: { count: number; total: number };
  medio: { count: number; total: number };
  fuerte: { count: number; total: number };
}

export interface ExpenseFilterCriteria {
  anio: string;
  mes: string;
  dateFrom?: string;
  dateTo?: string;
  sede: string;
  impacto: 'TODOS' | NivelImpacto;
  naturaleza?: 'TODAS' | NaturalezaGasto;
  categoriaPrincipal?: string;
  subtipo?: string;
}

export interface MonthlySalesEntry {
  anio: string;
  mes: string;
  montoBoleteado: number;
  baseImponible: number;
  igvVentas: number;
  updatedAt?: string;
}

export interface CategoryAggregate {
  label: string;
  fijo: number;
  variable: number;
  igv: number;
  total: number;
  count: number;
}

export interface MonthlyFiscalComparison {
  mes: string;
  mesShort: string;
  comprasTotal: number;
  igvCompras: number;
  ventasBoleteadas: number;
  igvVentas: number;
  igvNeto: number;
}

export function filterExpensesAdvanced(
  expenses: ExpenseRecord[],
  criteria: ExpenseFilterCriteria
): ExpenseRecord[] {
  return expenses.filter((e) => {
    if (criteria.anio !== 'TODOS' && e.anio !== criteria.anio) return false;
    if (criteria.mes !== 'TODOS' && e.mes !== criteria.mes) return false;
    if (criteria.dateFrom && e.fecha && e.fecha < criteria.dateFrom) return false;
    if (criteria.dateTo && e.fecha && e.fecha > criteria.dateTo) return false;
    if (criteria.sede !== 'TODAS' && e.sede.toUpperCase() !== criteria.sede.toUpperCase()) {
      return false;
    }
    if (criteria.impacto !== 'TODOS' && e.nivelImpacto !== criteria.impacto) return false;
    if (
      criteria.naturaleza &&
      criteria.naturaleza !== 'TODAS' &&
      e.naturaleza !== criteria.naturaleza
    ) {
      return false;
    }
    if (
      criteria.categoriaPrincipal &&
      criteria.categoriaPrincipal !== 'TODAS' &&
      e.categoriaPrincipal !== criteria.categoriaPrincipal
    ) {
      return false;
    }
    if (
      criteria.subtipo &&
      criteria.subtipo !== 'TODOS' &&
      e.subtipo !== criteria.subtipo
    ) {
      return false;
    }
    return true;
  });
}

export function calculateSalesIgvBreakdown(montoBoleteado: number): {
  montoBoleteado: number;
  baseImponible: number;
  igvVentas: number;
} {
  const safeTotal = Math.max(0, round2(Number(montoBoleteado) || 0));
  if (safeTotal === 0) {
    return { montoBoleteado: 0, baseImponible: 0, igvVentas: 0 };
  }
  const baseImponible = round2(safeTotal / 1.18);
  const igvVentas = round2(safeTotal - baseImponible);
  return { montoBoleteado: safeTotal, baseImponible, igvVentas };
}

export function aggregateFiscalComparison(
  filteredExpenses: ExpenseRecord[],
  salesEntries: MonthlySalesEntry[],
  filterAnio: string,
  filterMes: string
): {
  totalCompras: number;
  igvCompras: number;
  totalVentas: number;
  igvVentas: number;
  igvNeto: number;
  byMonth: MonthlyFiscalComparison[];
} {
  const relevantSales = salesEntries.filter((s) => {
    if (filterAnio !== 'TODOS' && s.anio !== filterAnio) return false;
    if (filterMes !== 'TODOS' && s.mes !== filterMes) return false;
    return true;
  });

  const purchasesByMonth = new Map<string, { total: number; igv: number }>();
  const salesByMonth = new Map<string, { total: number; igv: number }>();
  for (const m of MONTH_NAMES) {
    purchasesByMonth.set(m, { total: 0, igv: 0 });
    salesByMonth.set(m, { total: 0, igv: 0 });
  }

  let totalCompras = 0;
  let igvCompras = 0;
  for (const e of filteredExpenses) {
    const mes = (e.mes || '').trim().toUpperCase();
    const bucket = purchasesByMonth.get(mes);
    const t = Number(e.total) || 0;
    const igv = Number(e.igv) || 0;
    totalCompras += t;
    igvCompras += igv;
    if (bucket) {
      bucket.total = round2(bucket.total + t);
      bucket.igv = round2(bucket.igv + igv);
    }
  }

  let totalVentas = 0;
  let igvVentas = 0;
  for (const s of relevantSales) {
    const mes = (s.mes || '').trim().toUpperCase();
    const bucket = salesByMonth.get(mes);
    const t = Number(s.montoBoleteado) || 0;
    const igv = Number(s.igvVentas) || 0;
    totalVentas += t;
    igvVentas += igv;
    if (bucket) {
      bucket.total = round2(bucket.total + t);
      bucket.igv = round2(bucket.igv + igv);
    }
  }

  const byMonth: MonthlyFiscalComparison[] = MONTH_NAMES.map((mes) => {
    const p = purchasesByMonth.get(mes)!;
    const v = salesByMonth.get(mes)!;
    return {
      mes,
      mesShort: mes.slice(0, 3),
      comprasTotal: p.total,
      igvCompras: p.igv,
      ventasBoleteadas: v.total,
      igvVentas: v.igv,
      igvNeto: round2(v.igv - p.igv),
    };
  });

  return {
    totalCompras: round2(totalCompras),
    igvCompras: round2(igvCompras),
    totalVentas: round2(totalVentas),
    igvVentas: round2(igvVentas),
    igvNeto: round2(igvVentas - igvCompras),
    byMonth,
  };
}

export function aggregateByCategoryOrSubtype(
  expenses: ExpenseRecord[],
  groupBy: 'categoriaPrincipal' | 'subtipo'
): CategoryAggregate[] {
  const map = new Map<string, CategoryAggregate>();
  for (const e of expenses) {
    const label =
      (groupBy === 'categoriaPrincipal' ? e.categoriaPrincipal : e.subtipo) ||
      'Sin Clasificación';
    const current = map.get(label) || {
      label,
      fijo: 0,
      variable: 0,
      igv: 0,
      total: 0,
      count: 0,
    };
    const t = Number(e.total) || 0;
    const igv = Number(e.igv) || 0;
    if (e.naturaleza === 'Costo Fijo') current.fijo = round2(current.fijo + t);
    else current.variable = round2(current.variable + t);
    current.igv = round2(current.igv + igv);
    current.total = round2(current.total + t);
    current.count += 1;
    map.set(label, current);
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

export function aggregateBySede(
  expenses: ExpenseRecord[],
  sedes: SedeRecord[]
): SedeAggregate[] {
  const map = new Map<string, SedeAggregate>();
  const allowedSedeNames = new Set(
    sedes.map((s) => (s.nombreSede || '').trim().toUpperCase()).filter(Boolean)
  );

  for (const s of sedes) {
    const key = (s.nombreSede || '').trim().toUpperCase();
    if (!key) continue;
    const budgetTotal = round2(
      (Number(s.presupuestoMensualFijo) || 0) + (Number(s.presupuestoMensualVariable) || 0)
    );
    map.set(key, {
      sede: key,
      fijo: 0,
      variable: 0,
      subtotal: 0,
      igv: 0,
      total: 0,
      budgetTotal,
      executionPct: 0,
      count: 0,
    });
  }

  for (const e of expenses) {
    const key = (e.sede || 'SIN SEDE').trim().toUpperCase();
    // Only create extra bucket if sedes list was empty; otherwise respect active sedes catalog
    if (allowedSedeNames.size > 0 && !allowedSedeNames.has(key)) continue;

    const existing = map.get(key) || {
      sede: key,
      fijo: 0,
      variable: 0,
      subtotal: 0,
      igv: 0,
      total: 0,
      budgetTotal: 0,
      executionPct: 0,
      count: 0,
    };

    const t = Number(e.total) || 0;
    const sub = Number(e.subtotal) || 0;
    const igv = Number(e.igv) || 0;

    if (e.naturaleza === 'Costo Fijo') {
      existing.fijo = round2(existing.fijo + t);
    } else {
      existing.variable = round2(existing.variable + t);
    }
    existing.subtotal = round2(existing.subtotal + sub);
    existing.igv = round2(existing.igv + igv);
    existing.total = round2(existing.total + t);
    existing.count += 1;

    map.set(key, existing);
  }

  const list = Array.from(map.values()).map((item) => ({
    ...item,
    executionPct:
      item.budgetTotal > 0 ? round2((item.total / item.budgetTotal) * 100) : 0,
  }));

  return list.sort((a, b) => b.total - a.total || a.sede.localeCompare(b.sede));
}

export function aggregateByMonth(expenses: ExpenseRecord[]): MonthAggregate[] {
  const map = new Map<
    string,
    {
      fijo: number;
      variable: number;
      subtotal: number;
      igv: number;
      total: number;
      count: number;
    }
  >();

  for (const m of MONTH_NAMES) {
    map.set(m, { fijo: 0, variable: 0, subtotal: 0, igv: 0, total: 0, count: 0 });
  }

  for (const e of expenses) {
    const rawMes = (e.mes || '').trim().toUpperCase();
    const key = MONTH_NAMES.includes(rawMes as (typeof MONTH_NAMES)[number])
      ? rawMes
      : 'ENERO';
    const cur = map.get(key)!;
    const t = Number(e.total) || 0;
    const sub = Number(e.subtotal) || 0;
    const igv = Number(e.igv) || 0;

    if (e.naturaleza === 'Costo Fijo') {
      cur.fijo = round2(cur.fijo + t);
    } else {
      cur.variable = round2(cur.variable + t);
    }
    cur.subtotal = round2(cur.subtotal + sub);
    cur.igv = round2(cur.igv + igv);
    cur.total = round2(cur.total + t);
    cur.count += 1;
  }

  let runningTotal = 0;
  let runningIgv = 0;

  return MONTH_NAMES.map((mes) => {
    const cur = map.get(mes)!;
    runningTotal = round2(runningTotal + cur.total);
    runningIgv = round2(runningIgv + cur.igv);
    return {
      mes,
      mesShort: mes.slice(0, 3),
      fijo: cur.fijo,
      variable: cur.variable,
      subtotal: cur.subtotal,
      igv: cur.igv,
      total: cur.total,
      cumulativeTotal: runningTotal,
      cumulativeIgv: runningIgv,
      count: cur.count,
    };
  });
}

export function aggregateIgvProgress(expenses: ExpenseRecord[]): IgvProgressSummary {
  let totalGastado = 0;
  let subtotalGravado = 0;
  let igvCreditoFiscal = 0;
  let noGravadoTotal = 0;
  let facturaCount = 0;
  let nonFacturaCount = 0;

  for (const e of expenses) {
    const t = Number(e.total) || 0;
    const igv = Number(e.igv) || 0;
    const sub = Number(e.subtotal) || 0;

    totalGastado += t;
    if (igv > 0 || e.tipoComprobante === 'FACTURA') {
      facturaCount += 1;
      igvCreditoFiscal += igv;
      subtotalGravado += sub > 0 ? sub : round2(t - igv);
    } else {
      nonFacturaCount += 1;
      noGravadoTotal += t;
    }
  }

  const totalRounded = round2(totalGastado);
  const igvRounded = round2(igvCreditoFiscal);
  const gravadoTotal = round2(subtotalGravado + igvCreditoFiscal);

  return {
    totalGastado: totalRounded,
    subtotalGravado: round2(subtotalGravado),
    igvCreditoFiscal: igvRounded,
    noGravadoTotal: round2(noGravadoTotal),
    facturaCount,
    nonFacturaCount,
    igvOverTotalPct: totalRounded > 0 ? round2((igvRounded / totalRounded) * 100) : 0,
    gravadoSharePct: totalRounded > 0 ? round2((gravadoTotal / totalRounded) * 100) : 0,
  };
}

export function aggregateByImpact(expenses: ExpenseRecord[]): ImpactAggregate {
  const res: ImpactAggregate = {
    regular: { count: 0, total: 0 },
    medio: { count: 0, total: 0 },
    fuerte: { count: 0, total: 0 },
  };

  for (const e of expenses) {
    const t = Number(e.total) || 0;
    if (e.nivelImpacto === 'Fuerte') {
      res.fuerte.count += 1;
      res.fuerte.total = round2(res.fuerte.total + t);
    } else if (e.nivelImpacto === 'Medio') {
      res.medio.count += 1;
      res.medio.total = round2(res.medio.total + t);
    } else {
      res.regular.count += 1;
      res.regular.total = round2(res.regular.total + t);
    }
  }

  return res;
}
