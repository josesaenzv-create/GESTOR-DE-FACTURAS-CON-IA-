import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  Building2,
  TrendingUp,
  ShieldCheck,
  ArrowLeftRight,
} from 'lucide-react';
import {
  MONTH_NAMES,
  type ExpenseRecord,
  type SedeRecord,
} from '../types/crediban';
import {
  aggregateByCategoryOrSubtype,
  aggregateByImpact,
  aggregateByMonth,
  aggregateBySede,
  aggregateFiscalComparison,
  aggregateIgvProgress,
  type MonthlySalesEntry,
} from '../utils/analytics';
import { formatCurrencySoles, round2 } from '../utils/accounting';

interface DashboardChartsProps {
  filteredExpenses: ExpenseRecord[];
  allVisibleExpenses: ExpenseRecord[];
  sedes: SedeRecord[];
  salesEntries: MonthlySalesEntry[];
  filterYear: string;
  filterMonth: string;
}

type LeftCompareMode = 'sedes' | 'categorias' | 'subtipos' | 'meses';
type MonthlyChartMode = 'gasto' | 'igv' | 'fiscal';

export const DashboardCharts: React.FC<DashboardChartsProps> = ({
  filteredExpenses,
  allVisibleExpenses,
  sedes,
  salesEntries,
  filterYear,
  filterMonth,
}) => {
  const [compareMode, setCompareMode] = useState<LeftCompareMode>('sedes');
  const [monthlyMode, setMonthlyMode] = useState<MonthlyChartMode>('gasto');
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [compareMonthA, setCompareMonthA] = useState<string>('OCTUBRE');
  const [compareMonthB, setCompareMonthB] = useState<string>('NOVIEMBRE');

  const sedeRows = useMemo(
    () => aggregateBySede(filteredExpenses, sedes),
    [filteredExpenses, sedes]
  );

  const categoryRows = useMemo(
    () => aggregateByCategoryOrSubtype(filteredExpenses, 'categoriaPrincipal'),
    [filteredExpenses]
  );

  const subtipoRows = useMemo(
    () => aggregateByCategoryOrSubtype(filteredExpenses, 'subtipo'),
    [filteredExpenses]
  );

  const monthRows = useMemo(
    () => aggregateByMonth(filteredExpenses),
    [filteredExpenses]
  );

  const fiscalSummary = useMemo(
    () =>
      aggregateFiscalComparison(
        filteredExpenses,
        salesEntries,
        filterYear,
        filterMonth
      ),
    [filteredExpenses, salesEntries, filterYear, filterMonth]
  );

  const allMonthsFiscal = useMemo(() => {
    const yearScoped =
      filterYear === 'TODOS'
        ? allVisibleExpenses
        : allVisibleExpenses.filter((e) => e.anio === filterYear);
    return aggregateFiscalComparison(yearScoped, salesEntries, filterYear, 'TODOS');
  }, [allVisibleExpenses, salesEntries, filterYear]);

  const igvSummary = useMemo(
    () => aggregateIgvProgress(filteredExpenses),
    [filteredExpenses]
  );

  const impactSummary = useMemo(
    () => aggregateByImpact(filteredExpenses),
    [filteredExpenses]
  );

  const maxSedeValue = useMemo(
    () => Math.max(...sedeRows.map((s) => Math.max(s.total, s.budgetTotal)), 1),
    [sedeRows]
  );

  const maxCatValue = useMemo(
    () =>
      Math.max(
        ...(compareMode === 'categorias' ? categoryRows : subtipoRows).map((r) => r.total),
        1
      ),
    [compareMode, categoryRows, subtipoRows]
  );

  const maxMonthValue = useMemo(() => {
    if (monthlyMode === 'fiscal') {
      return Math.max(
        ...fiscalSummary.byMonth.map((m) => Math.max(m.igvVentas, m.igvCompras)),
        1
      );
    }
    return Math.max(
      ...monthRows.map((m) => (monthlyMode === 'gasto' ? m.total : m.subtotal + m.igv)),
      1
    );
  }, [monthRows, fiscalSummary, monthlyMode]);

  const activeMonthDetail = useMemo(() => {
    if (selectedMonth) {
      return (
        fiscalSummary.byMonth.find((m) => m.mes === selectedMonth) || null
      );
    }
    const withData = fiscalSummary.byMonth.filter(
      (m) => m.comprasTotal > 0 || m.ventasBoleteadas > 0
    );
    return withData.length > 0 ? withData[withData.length - 1] : null;
  }, [fiscalSummary, selectedMonth]);

  const monthCompA = useMemo(() => {
    const mData = allMonthsFiscal.byMonth.find((m) => m.mes === compareMonthA);
    const expensesA = allVisibleExpenses.filter(
      (e) =>
        (filterYear === 'TODOS' || e.anio === filterYear) &&
        e.mes.toUpperCase() === compareMonthA
    );
    const fijo = round2(
      expensesA
        .filter((e) => e.naturaleza === 'Costo Fijo')
        .reduce((acc, e) => acc + (Number(e.total) || 0), 0)
    );
    const variable = round2(
      expensesA
        .filter((e) => e.naturaleza !== 'Costo Fijo')
        .reduce((acc, e) => acc + (Number(e.total) || 0), 0)
    );
    return {
      mes: compareMonthA,
      total: mData?.comprasTotal || 0,
      fijo,
      variable,
      igvCompras: mData?.igvCompras || 0,
      igvVentas: mData?.igvVentas || 0,
      igvNeto: mData?.igvNeto || 0,
    };
  }, [allMonthsFiscal, allVisibleExpenses, filterYear, compareMonthA]);

  const monthCompB = useMemo(() => {
    const mData = allMonthsFiscal.byMonth.find((m) => m.mes === compareMonthB);
    const expensesB = allVisibleExpenses.filter(
      (e) =>
        (filterYear === 'TODOS' || e.anio === filterYear) &&
        e.mes.toUpperCase() === compareMonthB
    );
    const fijo = round2(
      expensesB
        .filter((e) => e.naturaleza === 'Costo Fijo')
        .reduce((acc, e) => acc + (Number(e.total) || 0), 0)
    );
    const variable = round2(
      expensesB
        .filter((e) => e.naturaleza !== 'Costo Fijo')
        .reduce((acc, e) => acc + (Number(e.total) || 0), 0)
    );
    return {
      mes: compareMonthB,
      total: mData?.comprasTotal || 0,
      fijo,
      variable,
      igvCompras: mData?.igvCompras || 0,
      igvVentas: mData?.igvVentas || 0,
      igvNeto: mData?.igvNeto || 0,
    };
  }, [allMonthsFiscal, allVisibleExpenses, filterYear, compareMonthB]);

  const totalImpactCount =
    impactSummary.regular.count + impactSummary.medio.count + impactSummary.fuerte.count;

  const activeCategoryList = compareMode === 'categorias' ? categoryRows : subtipoRows;

  return (
    <div className="space-y-4">
      {/* Row 1: Flexible Comparison Panel + Monthly & IGV Evolution */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Card: Multi-Mode Comparison */}
        <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              {compareMode === 'meses' ? (
                <ArrowLeftRight className="w-4 h-4 text-[#1B4332]" />
              ) : (
                <Building2 className="w-4 h-4 text-[#1B4332]" />
              )}
              <h3 className="text-sm font-bold text-slate-900">
                {compareMode === 'sedes'
                  ? 'Comparativa por Sedes'
                  : compareMode === 'categorias'
                  ? 'Comparativa por Categoría'
                  : compareMode === 'subtipos'
                  ? 'Comparativa por Subtipo'
                  : 'Comparativa Mes vs Mes'}
              </h3>
            </div>

            <div className="flex items-center gap-1.5">
              <label htmlFor="chart-compare-mode" className="sr-only">
                Modo de comparación
              </label>
              <select
                id="chart-compare-mode"
                value={compareMode}
                onChange={(e) => setCompareMode(e.target.value as LeftCompareMode)}
                className="px-2.5 py-1 text-[11px] font-semibold bg-slate-50 border border-slate-300 rounded-md text-slate-800"
              >
                <option value="sedes">Por Sedes</option>
                <option value="categorias">Por Categorías</option>
                <option value="subtipos">Por Subtipos</option>
                <option value="meses">Mes vs Mes</option>
              </select>
            </div>
          </div>

          {compareMode === 'sedes' && (
            <>
              <div className="flex items-center justify-end gap-3 text-[11px] text-slate-600 mt-2.5">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-xs bg-[#1B4332] inline-block" />
                  Fijo
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-xs bg-[#59B447] inline-block" />
                  Variable
                </span>
              </div>
              {sedeRows.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-500">
                  Sin sedes habilitadas para comparar.
                </p>
              ) : (
                <div className="mt-3 space-y-3.5">
                  {sedeRows.map((row) => {
                    const fijoPct = Math.min(100, (row.fijo / maxSedeValue) * 100);
                    const varPct = Math.min(100 - fijoPct, (row.variable / maxSedeValue) * 100);
                    const budgetMarkerPct =
                      row.budgetTotal > 0
                        ? Math.min(100, (row.budgetTotal / maxSedeValue) * 100)
                        : null;

                    return (
                      <div key={row.sede} className="space-y-1">
                        <div className="flex items-baseline justify-between gap-2 text-xs">
                          <span className="font-bold text-slate-800 truncate">
                            {row.sede}
                            <span className="ml-1.5 font-normal text-slate-500 font-mono">
                              ({row.count})
                            </span>
                          </span>
                          <span className="font-mono font-bold tabular-nums text-slate-900 shrink-0">
                            {formatCurrencySoles(row.total)}
                          </span>
                        </div>

                        <div className="relative h-3 bg-slate-100 rounded-md overflow-hidden flex">
                          {fijoPct > 0 && (
                            <div
                              style={{ width: `${fijoPct}%` }}
                              className="bg-[#1B4332] h-full transition-all"
                              title={`Costo Fijo: ${formatCurrencySoles(row.fijo)}`}
                            />
                          )}
                          {varPct > 0 && (
                            <div
                              style={{ width: `${varPct}%` }}
                              className="bg-[#59B447] h-full transition-all"
                              title={`Costo Variable: ${formatCurrencySoles(row.variable)}`}
                            />
                          )}
                          {budgetMarkerPct !== null && (
                            <div
                              style={{ left: `${budgetMarkerPct}%` }}
                              className="absolute top-0 bottom-0 w-0.5 bg-amber-600"
                              title={`Presupuesto mensual: ${formatCurrencySoles(row.budgetTotal)}`}
                            />
                          )}
                        </div>

                        <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono tabular-nums">
                          <span>IGV: {formatCurrencySoles(row.igv)}</span>
                          {row.budgetTotal > 0 && (
                            <span
                              className={
                                row.executionPct > 100
                                  ? 'text-red-700 font-semibold'
                                  : row.executionPct > 80
                                  ? 'text-amber-700 font-semibold'
                                  : 'text-emerald-700'
                              }
                            >
                              {row.executionPct}% de {formatCurrencySoles(row.budgetTotal)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {(compareMode === 'categorias' || compareMode === 'subtipos') && (
            <div className="mt-3 space-y-3 max-h-72 overflow-y-auto pr-1">
              {activeCategoryList.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-500">
                  No hay datos para comparar en los filtros actuales.
                </p>
              ) : (
                activeCategoryList.slice(0, 8).map((row) => {
                  const fijoPct = Math.min(100, (row.fijo / maxCatValue) * 100);
                  const varPct = Math.min(100 - fijoPct, (row.variable / maxCatValue) * 100);
                  return (
                    <div key={row.label} className="space-y-1">
                      <div className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="font-semibold text-slate-800 truncate">
                          {row.label}
                          <span className="ml-1 font-normal text-slate-500 font-mono">
                            ({row.count})
                          </span>
                        </span>
                        <span className="font-mono font-bold tabular-nums text-slate-900 shrink-0">
                          {formatCurrencySoles(row.total)}
                        </span>
                      </div>
                      <div className="h-2.5 bg-slate-100 rounded-md overflow-hidden flex">
                        {fijoPct > 0 && (
                          <div style={{ width: `${fijoPct}%` }} className="bg-[#1B4332] h-full" />
                        )}
                        {varPct > 0 && (
                          <div style={{ width: `${varPct}%` }} className="bg-[#59B447] h-full" />
                        )}
                      </div>
                      <p className="text-[10px] text-slate-500 font-mono tabular-nums">
                        IGV Compras: {formatCurrencySoles(row.igv)}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {compareMode === 'meses' && (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="compare-month-a" className="block text-[10px] font-semibold text-slate-500 mb-1">
                    Mes A (Base)
                  </label>
                  <select
                    id="compare-month-a"
                    value={compareMonthA}
                    onChange={(e) => setCompareMonthA(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs font-semibold bg-slate-50 border border-slate-300 rounded-md"
                  >
                    {MONTH_NAMES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="compare-month-b" className="block text-[10px] font-semibold text-slate-500 mb-1">
                    Mes B (Comparar)
                  </label>
                  <select
                    id="compare-month-b"
                    value={compareMonthB}
                    onChange={(e) => setCompareMonthB(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs font-semibold bg-slate-50 border border-slate-300 rounded-md"
                  >
                    {MONTH_NAMES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Visual Side-by-Side Bar Comparison between Mes A and Mes B */}
              {(() => {
                const barMetrics = [
                  {
                    label: 'Gasto Total',
                    a: monthCompA.total,
                    b: monthCompB.total,
                  },
                  {
                    label: 'Costos Fijos',
                    a: monthCompA.fijo,
                    b: monthCompB.fijo,
                  },
                  {
                    label: 'Costos Variables',
                    a: monthCompA.variable,
                    b: monthCompB.variable,
                  },
                  {
                    label: 'IGV Compras',
                    a: monthCompA.igvCompras,
                    b: monthCompB.igvCompras,
                  },
                ];
                const maxBarVal = Math.max(
                  ...barMetrics.map((r) => Math.max(r.a, r.b)),
                  1
                );
                return (
                  <div className="space-y-2.5 p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="flex items-center justify-between text-[10px] font-semibold text-slate-600">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-xs bg-slate-500 inline-block" />
                        {compareMonthA}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-xs bg-[#1B4332] inline-block" />
                        {compareMonthB}
                      </span>
                    </div>
                    {barMetrics.map((m) => {
                      const pctA = m.a > 0 ? Math.max(4, (m.a / maxBarVal) * 100) : 0;
                      const pctB = m.b > 0 ? Math.max(4, (m.b / maxBarVal) * 100) : 0;
                      const varPct =
                        m.a > 0 ? Math.round(((m.b - m.a) / m.a) * 100) : m.b > 0 ? 100 : 0;
                      return (
                        <div key={m.label} className="space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-semibold text-slate-700">{m.label}</span>
                            <span
                              className={`font-mono font-bold ${
                                varPct > 0
                                  ? 'text-amber-700'
                                  : varPct < 0
                                  ? 'text-emerald-700'
                                  : 'text-slate-500'
                              }`}
                            >
                              {varPct > 0 ? `+${varPct}%` : `${varPct}%`}
                            </span>
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-slate-200 rounded overflow-hidden">
                                <div
                                  style={{ width: `${pctA}%` }}
                                  className="h-full bg-slate-500 transition-all"
                                />
                              </div>
                              <span className="w-20 text-right font-mono text-[10px] text-slate-600 tabular-nums">
                                {formatCurrencySoles(m.a)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-slate-200 rounded overflow-hidden">
                                <div
                                  style={{ width: `${pctB}%` }}
                                  className="h-full bg-[#1B4332] transition-all"
                                />
                              </div>
                              <span className="w-20 text-right font-mono text-[10px] font-bold text-slate-900 tabular-nums">
                                {formatCurrencySoles(m.b)}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              <div className="border border-slate-200 rounded-lg overflow-hidden text-xs">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-600">
                      <th className="py-1.5 px-2.5">Concepto</th>
                      <th className="py-1.5 px-2.5 text-right">{compareMonthA.slice(0, 3)}</th>
                      <th className="py-1.5 px-2.5 text-right">{compareMonthB.slice(0, 3)}</th>
                      <th className="py-1.5 px-2.5 text-right">Dif. (B-A)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono tabular-nums text-[11px]">
                    {[
                      {
                        label: 'Gasto Total',
                        a: monthCompA.total,
                        b: monthCompB.total,
                      },
                      {
                        label: 'Costos Fijos',
                        a: monthCompA.fijo,
                        b: monthCompB.fijo,
                      },
                      {
                        label: 'Costos Var.',
                        a: monthCompA.variable,
                        b: monthCompB.variable,
                      },
                      {
                        label: 'IGV Compras',
                        a: monthCompA.igvCompras,
                        b: monthCompB.igvCompras,
                      },
                      {
                        label: 'IGV Ventas',
                        a: monthCompA.igvVentas,
                        b: monthCompB.igvVentas,
                      },
                      {
                        label: 'IGV Neto',
                        a: monthCompA.igvNeto,
                        b: monthCompB.igvNeto,
                      },
                    ].map((row) => {
                      const diff = round2(row.b - row.a);
                      return (
                        <tr key={row.label}>
                          <td className="py-1.5 px-2.5 font-sans font-medium text-slate-700">
                            {row.label}
                          </td>
                          <td className="py-1.5 px-2.5 text-right">{row.a.toFixed(2)}</td>
                          <td className="py-1.5 px-2.5 text-right font-semibold">{row.b.toFixed(2)}</td>
                          <td
                            className={`py-1.5 px-2.5 text-right font-semibold ${
                              diff > 0
                                ? 'text-amber-700'
                                : diff < 0
                                ? 'text-emerald-700'
                                : 'text-slate-400'
                            }`}
                          >
                            {diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right Card: Evolución Mensual / Avance IGV / Ventas vs Compras */}
        <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-4 sm:p-5 flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#59B447]" />
                <h3 className="text-sm font-bold text-slate-900">
                  {monthlyMode === 'gasto'
                    ? 'Evolución Mensual de Gastos'
                    : monthlyMode === 'igv'
                    ? 'Avance Mensual de IGV Compras (18%)'
                    : 'Comparativa Mensual: IGV Ventas vs. IGV Compras'}
                </h3>
              </div>
              <div
                role="group"
                aria-label="Modo de gráfico mensual"
                className="flex flex-wrap items-center p-0.5 bg-slate-100 rounded-lg border border-slate-200"
              >
                <button
                  type="button"
                  onClick={() => setMonthlyMode('gasto')}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-md cursor-pointer transition-colors ${
                    monthlyMode === 'gasto'
                      ? 'bg-[#1B4332] text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Por Mes
                </button>
                <button
                  type="button"
                  onClick={() => setMonthlyMode('igv')}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-md cursor-pointer transition-colors ${
                    monthlyMode === 'igv'
                      ? 'bg-[#1B4332] text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Avance IGV
                </button>
                <button
                  type="button"
                  onClick={() => setMonthlyMode('fiscal')}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-md cursor-pointer transition-colors ${
                    monthlyMode === 'fiscal'
                      ? 'bg-[#1B4332] text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  IGV Ventas vs Compras
                </button>
              </div>
            </div>

            {/* 12-Month Chart Canvas */}
            <div className="mt-4 pt-2">
              <div className="grid grid-cols-12 gap-1.5 sm:gap-2 items-end h-40">
                {monthRows.map((m, idx) => {
                  const fiscalM = fiscalSummary.byMonth[idx];
                  const isActive = activeMonthDetail?.mes === m.mes;

                  if (monthlyMode === 'fiscal') {
                    const ventasPct =
                      fiscalM.igvVentas > 0
                        ? Math.max(8, Math.round((fiscalM.igvVentas / maxMonthValue) * 100))
                        : 0;
                    const comprasPct =
                      fiscalM.igvCompras > 0
                        ? Math.max(8, Math.round((fiscalM.igvCompras / maxMonthValue) * 100))
                        : 0;

                    return (
                      <button
                        key={m.mes}
                        type="button"
                        onClick={() => setSelectedMonth(m.mes)}
                        aria-label={`${m.mes}: IGV Ventas ${formatCurrencySoles(
                          fiscalM.igvVentas
                        )}, IGV Compras ${formatCurrencySoles(fiscalM.igvCompras)}`}
                        className={`flex flex-col items-center justify-end h-full cursor-pointer rounded-md px-0.5 transition-colors ${
                          isActive ? 'bg-emerald-50/70' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="w-full flex-1 flex items-end justify-center gap-0.5 pb-1">
                          <div
                            style={{ height: `${ventasPct || 3}%` }}
                            className={`w-2.5 rounded-t-xs ${
                              ventasPct > 0 ? 'bg-amber-500' : 'bg-slate-200'
                            }`}
                            title={`IGV Ventas: ${formatCurrencySoles(fiscalM.igvVentas)}`}
                          />
                          <div
                            style={{ height: `${comprasPct || 3}%` }}
                            className={`w-2.5 rounded-t-xs ${
                              comprasPct > 0 ? 'bg-emerald-600' : 'bg-slate-200'
                            }`}
                            title={`IGV Compras: ${formatCurrencySoles(fiscalM.igvCompras)}`}
                          />
                        </div>
                        <span
                          className={`text-[10px] font-mono leading-none py-1 ${
                            isActive ? 'font-bold text-[#1B4332]' : 'text-slate-500'
                          }`}
                        >
                          {m.mesShort}
                        </span>
                      </button>
                    );
                  }

                  const primaryVal = monthlyMode === 'gasto' ? m.fijo : m.subtotal;
                  const secondaryVal = monthlyMode === 'gasto' ? m.variable : m.igv;
                  const totalBarVal = primaryVal + secondaryVal;
                  const totalHeightPct =
                    totalBarVal > 0
                      ? Math.max(8, Math.round((totalBarVal / maxMonthValue) * 100))
                      : 0;
                  const primarySharePct =
                    totalBarVal > 0 ? Math.round((primaryVal / totalBarVal) * 100) : 0;
                  const secondarySharePct =
                    totalBarVal > 0 ? 100 - primarySharePct : 0;

                  return (
                    <button
                      key={m.mes}
                      type="button"
                      onClick={() => setSelectedMonth(m.mes)}
                      aria-label={`${m.mes}: ${formatCurrencySoles(m.total)}, IGV ${formatCurrencySoles(
                        m.igv
                      )}`}
                      className={`group flex flex-col items-center justify-end h-full cursor-pointer rounded-md px-0.5 transition-colors ${
                        isActive ? 'bg-emerald-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="w-full flex-1 flex items-end justify-center pb-1">
                        {totalHeightPct > 0 ? (
                          <div
                            style={{ height: `${totalHeightPct}%` }}
                            className="w-full max-w-[26px] rounded-t-md overflow-hidden flex flex-col-reverse border border-slate-200/70"
                          >
                            <div
                              style={{ height: `${primarySharePct}%` }}
                              className={
                                monthlyMode === 'gasto' ? 'bg-[#1B4332]' : 'bg-slate-400'
                              }
                            />
                            <div
                              style={{ height: `${secondarySharePct}%` }}
                              className={
                                monthlyMode === 'gasto' ? 'bg-[#59B447]' : 'bg-emerald-500'
                              }
                            />
                          </div>
                        ) : (
                          <div className="w-full max-w-[26px] h-1 rounded-xs bg-slate-200" />
                        )}
                      </div>
                      <span
                        className={`text-[10px] font-mono leading-none py-1 ${
                          isActive ? 'font-bold text-[#1B4332]' : 'text-slate-500'
                        }`}
                      >
                        {m.mesShort}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Active Month Detail */}
          <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-4 text-[11px] text-slate-600">
              {monthlyMode === 'gasto' ? (
                <>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-xs bg-[#1B4332] inline-block" />
                    Costo Fijo
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-xs bg-[#59B447] inline-block" />
                    Costo Variable
                  </span>
                </>
              ) : monthlyMode === 'igv' ? (
                <>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-xs bg-slate-400 inline-block" />
                    Subtotal
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500 inline-block" />
                    IGV Compras 18%
                  </span>
                </>
              ) : (
                <>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-xs bg-amber-500 inline-block" />
                    IGV Ventas (Boleteado)
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 inline-block" />
                    IGV Compras (Crédito)
                  </span>
                </>
              )}
            </div>

            {activeMonthDetail && (
              <div className="font-mono tabular-nums text-[11px] text-slate-700 bg-slate-50 px-2.5 py-1 rounded-md border border-slate-200">
                <strong className="text-slate-900">{activeMonthDetail.mes}:</strong>{' '}
                {monthlyMode === 'fiscal' ? (
                  <>
                    IGV Ventas{' '}
                    <strong className="text-amber-700">
                      {formatCurrencySoles(activeMonthDetail.igvVentas)}
                    </strong>{' '}
                    vs Compras{' '}
                    <strong className="text-emerald-700">
                      {formatCurrencySoles(activeMonthDetail.igvCompras)}
                    </strong>{' '}
                    → Neto{' '}
                    <strong>{formatCurrencySoles(activeMonthDetail.igvNeto)}</strong>
                  </>
                ) : (
                  <>
                    Compras <strong>{formatCurrencySoles(activeMonthDetail.comprasTotal)}</strong>{' '}
                    · IGV{' '}
                    <strong className="text-emerald-700">
                      {formatCurrencySoles(activeMonthDetail.igvCompras)}
                    </strong>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Row 2: Balance Fiscal (IGV Ventas vs IGV Compras) + Semáforo de Impacto */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* IGV Fiscal Balance Card */}
        <div className="lg:col-span-6 bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <h3 className="text-sm font-bold text-slate-900">
                Comparativa Fiscal: IGV Ventas vs. IGV Compras
              </h3>
            </div>
            <span className="text-xs font-mono font-bold tabular-nums text-emerald-700">
              {igvSummary.gravadoSharePct}% compras con IGV
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2.5 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs">
            <div>
              <p className="text-[11px] text-slate-500">IGV Ventas (18%)</p>
              <p className="text-sm font-bold font-mono tabular-nums text-amber-700 mt-0.5">
                {formatCurrencySoles(fiscalSummary.igvVentas)}
              </p>
              <p className="text-[10px] text-slate-500 font-mono">
                Boleteado: {formatCurrencySoles(fiscalSummary.totalVentas)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">IGV Compras (Crédito)</p>
              <p className="text-sm font-bold font-mono tabular-nums text-emerald-700 mt-0.5">
                {formatCurrencySoles(fiscalSummary.igvCompras)}
              </p>
              <p className="text-[10px] text-slate-500 font-mono">
                {igvSummary.facturaCount} facturas · {igvSummary.nonFacturaCount} sin IGV
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">
                {fiscalSummary.igvNeto >= 0 ? 'IGV Neto a Pagar' : 'Crédito a Favor'}
              </p>
              <p
                className={`text-sm font-extrabold font-mono tabular-nums mt-0.5 ${
                  fiscalSummary.igvNeto > 0 ? 'text-red-700' : 'text-emerald-700'
                }`}
              >
                {formatCurrencySoles(Math.abs(fiscalSummary.igvNeto))}
              </p>
              <p className="text-[10px] text-slate-500 font-mono">
                Ventas − Compras
              </p>
            </div>
          </div>

          <div className="h-3 bg-slate-100 rounded-md overflow-hidden flex">
            {igvSummary.totalGastado > 0 && (
              <>
                <div
                  style={{
                    width: `${(igvSummary.subtotalGravado / igvSummary.totalGastado) * 100}%`,
                  }}
                  className="bg-slate-600 h-full"
                  title={`Base Gravada Compras: ${formatCurrencySoles(igvSummary.subtotalGravado)}`}
                />
                <div
                  style={{
                    width: `${(igvSummary.igvCreditoFiscal / igvSummary.totalGastado) * 100}%`,
                  }}
                  className="bg-emerald-500 h-full"
                  title={`IGV Crédito Fiscal: ${formatCurrencySoles(igvSummary.igvCreditoFiscal)}`}
                />
                <div
                  style={{
                    width: `${(igvSummary.noGravadoTotal / igvSummary.totalGastado) * 100}%`,
                  }}
                  className="bg-amber-400 h-full"
                  title={`Sin IGV: ${formatCurrencySoles(igvSummary.noGravadoTotal)}`}
                />
              </>
            )}
          </div>
        </div>

        {/* Semáforo de Impacto Distribution */}
        <div className="lg:col-span-6 bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-[#1B4332]" />
              <h3 className="text-sm font-bold text-slate-900">
                Distribución por Semáforo de Impacto
              </h3>
            </div>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              {totalImpactCount} comprobantes
            </span>
          </div>

          <div className="space-y-2.5">
            {[
              {
                label: 'Regular (≤ S/ 60)',
                data: impactSummary.regular,
                barClass: 'bg-emerald-600',
                textClass: 'text-emerald-700',
              },
              {
                label: 'Medio (S/ 60.01 - 250)',
                data: impactSummary.medio,
                barClass: 'bg-amber-500',
                textClass: 'text-amber-700',
              },
              {
                label: 'Fuerte (> S/ 250)',
                data: impactSummary.fuerte,
                barClass: 'bg-red-600',
                textClass: 'text-red-700',
              },
            ].map((item) => {
              const share =
                igvSummary.totalGastado > 0
                  ? Math.round((item.data.total / igvSummary.totalGastado) * 100)
                  : 0;
              return (
                <div key={item.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700">
                      {item.label} ·{' '}
                      <span className="font-mono text-slate-500">
                        {item.data.count} docs
                      </span>
                    </span>
                    <span className={`font-mono font-bold tabular-nums ${item.textClass}`}>
                      {formatCurrencySoles(item.data.total)} ({share}%)
                    </span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-md overflow-hidden">
                    <div
                      style={{ width: `${share}%` }}
                      className={`${item.barClass} h-full transition-all`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
