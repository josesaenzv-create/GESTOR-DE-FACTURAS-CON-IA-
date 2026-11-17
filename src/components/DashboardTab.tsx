import React, { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  Layers,
  FileText,
  RotateCcw,
  ReceiptText,
  Trash2,
} from 'lucide-react';
import {
  MONTH_NAMES,
  type ExpenseCriterion,
  type ExpenseRecord,
  type NaturalezaGasto,
  type NivelImpacto,
  type SedeRecord,
  type UserSession,
} from '../types/crediban';
import { formatCurrencySoles, isManagerUser, round2 } from '../utils/accounting';
import { buildPivotTree } from '../utils/searchAndPivot';
import {
  aggregateFiscalComparison,
  filterExpensesAdvanced,
  type MonthlySalesEntry,
} from '../utils/analytics';
import {
  loadMonthlySalesEntries,
  saveMonthlySalesEntry,
} from '../services/credibanApi';
import { DashboardCharts } from './DashboardCharts';
import { CustomPdfModal } from './CustomPdfModal';
import { ManagerDeleteModal } from './ManagerDeleteModal';

interface DashboardTabProps {
  user: UserSession;
  expenses: ExpenseRecord[];
  sedes: SedeRecord[];
  criteria?: ExpenseCriterion[];
  onSelectExpense: (record: ExpenseRecord) => void;
  onDeleteExpense?: (id: string) => void;
}

export const DashboardTab: React.FC<DashboardTabProps> = ({
  user,
  expenses,
  sedes,
  criteria = [],
  onSelectExpense,
  onDeleteExpense,
}) => {
  const isManager = isManagerUser(user);

  const years = useMemo(() => {
    const set = new Set(expenses.map((e) => e.anio).filter(Boolean));
    set.add('2026');
    return Array.from(set).sort().reverse();
  }, [expenses]);

  const currentYear = String(new Date().getFullYear());
  const currentMonth = MONTH_NAMES[new Date().getMonth()] || 'ENERO';

  // Comprehensive Filters
  const [filterYear, setFilterYear] = useState<string>('TODOS');
  const [filterMonth, setFilterMonth] = useState<string>('TODOS');
  const [filterDateFrom, setFilterDateFrom] = useState<string>('');
  const [filterDateTo, setFilterDateTo] = useState<string>('');
  const [filterSede, setFilterSede] = useState<string>(isManager ? 'TODAS' : user.sede);
  const [filterImpact, setFilterImpact] = useState<'TODOS' | NivelImpacto>('TODOS');
  const [filterNaturaleza, setFilterNaturaleza] = useState<'TODAS' | NaturalezaGasto>('TODAS');
  const [filterCategoria, setFilterCategoria] = useState<string>('TODAS');
  const [filterSubtipo, setFilterSubtipo] = useState<string>('TODOS');
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ExpenseRecord | null>(null);

  // Sales IGV Entry (ONLY 2 items: Mes + Monto Boleteado)
  const [salesEntries, setSalesEntries] = useState<MonthlySalesEntry[]>(() =>
    loadMonthlySalesEntries()
  );
  const [salesMonthInput, setSalesMonthInput] = useState<string>(currentMonth);
  const [salesAmountInput, setSalesAmountInput] = useState<string>(() => {
    const existing = loadMonthlySalesEntries().find(
      (s) => s.mes.toUpperCase() === currentMonth && s.anio === currentYear
    );
    return existing ? String(existing.montoBoleteado) : '';
  });
  const [salesSavedNotice, setSalesSavedNotice] = useState<string>('');

  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({
    'nat:Costo Fijo': true,
    'nat:Costo Variable': true,
  });

  // Dynamic Category & Subtype Options derived from active Criteria + Expenses
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of criteria) {
      if (filterNaturaleza !== 'TODAS' && c.naturaleza !== filterNaturaleza) continue;
      if (c.categoriaPrincipal) set.add(c.categoriaPrincipal);
    }
    for (const e of expenses) {
      if (filterNaturaleza !== 'TODAS' && e.naturaleza !== filterNaturaleza) continue;
      if (e.categoriaPrincipal) set.add(e.categoriaPrincipal);
    }
    return Array.from(set).sort();
  }, [criteria, expenses, filterNaturaleza]);

  const subtypeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of criteria) {
      if (filterNaturaleza !== 'TODAS' && c.naturaleza !== filterNaturaleza) continue;
      if (filterCategoria !== 'TODAS' && c.categoriaPrincipal !== filterCategoria) continue;
      if (c.subtipo) set.add(c.subtipo);
    }
    for (const e of expenses) {
      if (filterNaturaleza !== 'TODAS' && e.naturaleza !== filterNaturaleza) continue;
      if (filterCategoria !== 'TODAS' && e.categoriaPrincipal !== filterCategoria) continue;
      if (e.subtipo) set.add(e.subtipo);
    }
    return Array.from(set).sort();
  }, [criteria, expenses, filterNaturaleza, filterCategoria]);

  const effectiveSede = isManager ? filterSede : user.sede;

  const filtered = useMemo(
    () =>
      filterExpensesAdvanced(expenses, {
        anio: filterYear,
        mes: filterMonth,
        dateFrom: filterDateFrom || undefined,
        dateTo: filterDateTo || undefined,
        sede: effectiveSede,
        impacto: filterImpact,
        naturaleza: filterNaturaleza,
        categoriaPrincipal: filterCategoria,
        subtipo: filterSubtipo,
      }),
    [
      expenses,
      filterYear,
      filterMonth,
      filterDateFrom,
      filterDateTo,
      effectiveSede,
      filterImpact,
      filterNaturaleza,
      filterCategoria,
      filterSubtipo,
    ]
  );

  const kpis = useMemo(() => {
    let total = 0;
    let fijo = 0;
    let variable = 0;
    let igv = 0;
    for (const r of filtered) {
      const t = Number(r.total) || 0;
      total += t;
      igv += Number(r.igv) || 0;
      if (r.naturaleza === 'Costo Fijo') fijo += t;
      else variable += t;
    }
    return {
      total: round2(total),
      fijo: round2(fijo),
      variable: round2(variable),
      igv: round2(igv),
      count: filtered.length,
    };
  }, [filtered]);

  const fiscalSummary = useMemo(
    () => aggregateFiscalComparison(filtered, salesEntries, filterYear, filterMonth),
    [filtered, salesEntries, filterYear, filterMonth]
  );

  const pivotTree = useMemo(() => buildPivotTree(filtered), [filtered]);

  const handleSaveSalesEntry = (e: React.FormEvent) => {
    e.preventDefault();
    const numeric = parseFloat(salesAmountInput);
    if (Number.isNaN(numeric) || numeric < 0) {
      setSalesSavedNotice('Ingresa un monto boleteado válido.');
      return;
    }
    const targetYear = filterYear !== 'TODOS' ? filterYear : currentYear;
    const next = saveMonthlySalesEntry(targetYear, salesMonthInput, numeric);
    setSalesEntries(next);
    const saved = next.find(
      (item) => item.anio === targetYear && item.mes === salesMonthInput
    );
    setSalesSavedNotice(
      `${salesMonthInput} ${targetYear}: Boleteado ${formatCurrencySoles(
        numeric
      )} → IGV Ventas ${formatCurrencySoles(saved?.igvVentas || 0)}`
    );
  };

  const handleSalesMonthSelectChange = (nextMes: string) => {
    setSalesMonthInput(nextMes);
    const targetYear = filterYear !== 'TODOS' ? filterYear : currentYear;
    const existing = salesEntries.find(
      (s) => s.anio === targetYear && s.mes.toUpperCase() === nextMes.toUpperCase()
    );
    setSalesAmountInput(existing ? String(existing.montoBoleteado) : '');
    setSalesSavedNotice('');
  };

  const resetFilters = () => {
    setFilterYear('TODOS');
    setFilterMonth('TODOS');
    setFilterDateFrom('');
    setFilterDateTo('');
    setFilterSede(isManager ? 'TODAS' : user.sede);
    setFilterImpact('TODOS');
    setFilterNaturaleza('TODAS');
    setFilterCategoria('TODAS');
    setFilterSubtipo('TODOS');
  };

  const toggleKey = (key: string) => {
    setExpandedKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const expandAll = () => {
    const next: Record<string, boolean> = {};
    for (const nat of pivotTree) {
      next[`nat:${nat.naturaleza}`] = true;
      for (const cat of nat.categorias) {
        next[`cat:${nat.naturaleza}:${cat.categoriaPrincipal}`] = true;
        for (const sub of cat.subtipos) {
          next[`sub:${nat.naturaleza}:${cat.categoriaPrincipal}:${sub.subtipo}`] = true;
        }
      }
    }
    setExpandedKeys(next);
  };

  const collapseAll = () => {
    setExpandedKeys({});
  };

  const activeRangeSummary =
    filterDateFrom || filterDateTo
      ? `${filterDateFrom || '...'} a ${filterDateTo || '...'}`
      : undefined;

  return (
    <div className="space-y-5">
      {/* KPI Executive Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Total Ejecutado</p>
          <p className="text-xl font-extrabold font-mono tabular-nums text-[#1B4332] mt-1">
            {formatCurrencySoles(kpis.total)}
          </p>
          <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
            {kpis.count} comprobantes
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Costos Fijos</p>
          <p className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {formatCurrencySoles(kpis.fijo)}
          </p>
          <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
            {kpis.total > 0 ? `${Math.round((kpis.fijo / kpis.total) * 100)}%` : '0%'} del total
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Costos Variables</p>
          <p className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {formatCurrencySoles(kpis.variable)}
          </p>
          <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
            {kpis.total > 0 ? `${Math.round((kpis.variable / kpis.total) * 100)}%` : '0%'} del total
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">IGV Compras vs Ventas</p>
          <p className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {formatCurrencySoles(kpis.igv)}
          </p>
          <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums truncate">
            {fiscalSummary.igvVentas > 0
              ? `Ventas: ${formatCurrencySoles(fiscalSummary.igvVentas)}`
              : 'Solo facturas 18%'}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 col-span-2 lg:col-span-1">
          <p className="text-xs text-slate-500">Alcance de Vista</p>
          <p className="text-base font-bold text-slate-900 mt-1 truncate">
            {effectiveSede}
          </p>
          <p className="text-xs text-slate-500 mt-0.5 truncate">
            {activeRangeSummary || `${filterMonth} · ${filterYear}`}
          </p>
        </div>
      </div>

      {/* Filters & Pivot Controls (Range + Category + Subtype) */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
          <div>
            <label htmlFor="dash-year" className="block text-[11px] font-medium text-slate-600 mb-1">
              Año
            </label>
            <select
              id="dash-year"
              value={filterYear}
              onChange={(e) => setFilterYear(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
            >
              <option value="TODOS">Todos</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="dash-month" className="block text-[11px] font-medium text-slate-600 mb-1">
              Mes / Periodo
            </label>
            <select
              id="dash-month"
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
            >
              <option value="TODOS">Todos</option>
              {MONTH_NAMES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="dash-date-from" className="block text-[11px] font-medium text-slate-600 mb-1">
              Desde fecha
            </label>
            <input
              id="dash-date-from"
              type="date"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
              className="w-full px-2 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label htmlFor="dash-date-to" className="block text-[11px] font-medium text-slate-600 mb-1">
              Hasta fecha
            </label>
            <input
              id="dash-date-to"
              type="date"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
              className="w-full px-2 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label htmlFor="dash-sede" className="block text-[11px] font-medium text-slate-600 mb-1">
              Sede
            </label>
            <select
              id="dash-sede"
              value={effectiveSede}
              disabled={!isManager}
              onChange={(e) => setFilterSede(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg disabled:bg-slate-100"
            >
              {isManager && <option value="TODAS">TODAS LAS SEDES</option>}
              {sedes.map((s) => (
                <option key={s.nombreSede} value={s.nombreSede}>
                  {s.nombreSede}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="dash-naturaleza" className="block text-[11px] font-medium text-slate-600 mb-1">
              Tipo de Gasto
            </label>
            <select
              id="dash-naturaleza"
              value={filterNaturaleza}
              onChange={(e) => {
                setFilterNaturaleza(e.target.value as 'TODAS' | NaturalezaGasto);
                setFilterCategoria('TODAS');
                setFilterSubtipo('TODOS');
              }}
              className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
            >
              <option value="TODAS">Todos</option>
              <option value="Costo Fijo">Costo Fijo</option>
              <option value="Costo Variable">Costo Variable</option>
            </select>
          </div>

          <div>
            <label htmlFor="dash-categoria" className="block text-[11px] font-medium text-slate-600 mb-1">
              Categoría
            </label>
            <select
              id="dash-categoria"
              value={filterCategoria}
              onChange={(e) => {
                setFilterCategoria(e.target.value);
                setFilterSubtipo('TODOS');
              }}
              className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
            >
              <option value="TODAS">Todas</option>
              {categoryOptions.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="dash-subtipo" className="block text-[11px] font-medium text-slate-600 mb-1">
              Subtipo
            </label>
            <select
              id="dash-subtipo"
              value={filterSubtipo}
              onChange={(e) => setFilterSubtipo(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
            >
              <option value="TODOS">Todos</option>
              {subtypeOptions.map((sub) => (
                <option key={sub} value={sub}>
                  {sub}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="dash-impact" className="text-[11px] font-medium text-slate-600">
              Semáforo:
            </label>
            <select
              id="dash-impact"
              value={filterImpact}
              onChange={(e) => setFilterImpact(e.target.value as 'TODOS' | NivelImpacto)}
              className="px-2.5 py-1 text-xs bg-white border border-slate-300 rounded-lg"
            >
              <option value="TODOS">Todos</option>
              <option value="Regular">Regular (≤ S/ 60)</option>
              <option value="Medio">Medio (≤ S/ 250)</option>
              <option value="Fuerte">Fuerte (&gt; S/ 250)</option>
            </select>
            <button
              type="button"
              onClick={resetFilters}
              className="px-2.5 py-1 text-xs text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg inline-flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Limpiar filtros</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPdfModal(true)}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-[#1B4332] hover:bg-[#0f291e] rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>PDF Personalizado</span>
            </button>
            <button
              type="button"
              onClick={expandAll}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
            >
              + Expandir Todo
            </button>
            <button
              type="button"
              onClick={collapseAll}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
            >
              - Contraer Todo
            </button>
          </div>
        </div>
      </div>

      {/* Registro Rápido de IGV Ventas (ONLY 2 items: Mes + Monto Boleteado) */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <ReceiptText className="w-4 h-4 text-amber-600" />
              <h3 className="text-sm font-bold text-slate-900">
                IGV Ventas Totales (Monto Boleteado Mensual)
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Registra el monto boleteado del mes para calcular el IGV Ventas (18%) y compararlo frente al IGV de Compras.
            </p>
          </div>

          <form
            onSubmit={handleSaveSalesEntry}
            className="flex flex-wrap sm:flex-nowrap items-end gap-2.5"
          >
            <div className="w-36">
              <label htmlFor="sales-mes" className="block text-[11px] font-semibold text-slate-600 mb-1">
                Mes
              </label>
              <select
                id="sales-mes"
                value={salesMonthInput}
                onChange={(e) => handleSalesMonthSelectChange(e.target.value)}
                className="w-full px-2.5 py-2 text-xs font-semibold bg-slate-50 border border-slate-300 rounded-lg"
              >
                {MONTH_NAMES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div className="w-44">
              <label
                htmlFor="sales-monto-boleteado"
                className="block text-[11px] font-semibold text-slate-600 mb-1"
              >
                Monto Boleteado (S/)
              </label>
              <input
                id="sales-monto-boleteado"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={salesAmountInput}
                onChange={(e) => setSalesAmountInput(e.target.value)}
                placeholder="Ej. 15000.00"
                className="w-full px-3 py-2 text-xs font-mono font-bold bg-white border border-slate-300 rounded-lg"
              />
            </div>

            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg whitespace-nowrap cursor-pointer"
            >
              Guardar Ventas
            </button>
          </form>
        </div>

        {(salesSavedNotice || salesEntries.length > 0) && (
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px]">
            {salesSavedNotice && (
              <span className="font-semibold text-emerald-700">{salesSavedNotice}</span>
            )}
            <div className="flex flex-wrap items-center gap-2 ml-auto">
              {salesEntries.slice(0, 6).map((s) => (
                <button
                  key={`${s.anio}-${s.mes}`}
                  type="button"
                  onClick={() => handleSalesMonthSelectChange(s.mes)}
                  className="px-2 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-900 font-mono tabular-nums cursor-pointer hover:bg-amber-100"
                >
                  {s.mes.slice(0, 3)} {s.anio}: Boleteado {formatCurrencySoles(s.montoBoleteado)} · IGV{' '}
                  <strong>{formatCurrencySoles(s.igvVentas)}</strong>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Interactive Comparison Charts: Por Sede / Categoría / Subtipo / Mes vs Mes & IGV */}
      <DashboardCharts
        filteredExpenses={filtered}
        allVisibleExpenses={expenses}
        sedes={sedes}
        salesEntries={salesEntries}
        filterYear={filterYear}
        filterMonth={filterMonth}
      />

      {/* 3-Level Expandable Pivot Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#59B447]" />
            <h3 className="text-sm font-bold text-slate-900">
              Tabla Dinámica de Gastos (Naturaleza → Categoría → Subtipo → Comprobantes)
            </h3>
          </div>
        </div>

        {pivotTree.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No existen registros para los filtros seleccionados.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-2.5 px-4">Agrupación Jerárquica</th>
                  <th className="py-2.5 px-4 text-right">Docs</th>
                  <th className="py-2.5 px-4 text-right">Subtotal (S/)</th>
                  <th className="py-2.5 px-4 text-right">IGV (S/)</th>
                  <th className="py-2.5 px-4 text-right">Total (S/)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {pivotTree.map((natNode) => {
                  const natKey = `nat:${natNode.naturaleza}`;
                  const natOpen = Boolean(expandedKeys[natKey]);
                  return (
                    <React.Fragment key={natKey}>
                      <tr className="bg-[#0f291e]/5 font-bold text-slate-900">
                        <td className="py-2.5 px-4">
                          <button
                            type="button"
                            onClick={() => toggleKey(natKey)}
                            aria-expanded={natOpen}
                            className="flex items-center gap-2 text-left cursor-pointer"
                          >
                            {natOpen ? (
                              <ChevronDown className="w-4 h-4 text-[#1B4332]" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-[#1B4332]" />
                            )}
                            <span>{natNode.naturaleza}</span>
                          </button>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          {natNode.count}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          {natNode.subtotal.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          {natNode.igv.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-[#1B4332]">
                          {natNode.total.toFixed(2)}
                        </td>
                      </tr>

                      {natOpen &&
                        natNode.categorias.map((catNode) => {
                          const catKey = `cat:${natNode.naturaleza}:${catNode.categoriaPrincipal}`;
                          const catOpen = Boolean(expandedKeys[catKey]);
                          return (
                            <React.Fragment key={catKey}>
                              <tr className="bg-slate-50/70 font-semibold text-slate-800">
                                <td className="py-2 px-4 pl-9">
                                  <button
                                    type="button"
                                    onClick={() => toggleKey(catKey)}
                                    aria-expanded={catOpen}
                                    className="flex items-center gap-2 text-left cursor-pointer"
                                  >
                                    {catOpen ? (
                                      <ChevronDown className="w-3.5 h-3.5 text-slate-600" />
                                    ) : (
                                      <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
                                    )}
                                    <span>{catNode.categoriaPrincipal}</span>
                                  </button>
                                </td>
                                <td className="py-2 px-4 text-right font-mono tabular-nums">
                                  {catNode.count}
                                </td>
                                <td className="py-2 px-4 text-right font-mono tabular-nums">
                                  {catNode.subtotal.toFixed(2)}
                                </td>
                                <td className="py-2 px-4 text-right font-mono tabular-nums">
                                  {catNode.igv.toFixed(2)}
                                </td>
                                <td className="py-2 px-4 text-right font-mono tabular-nums">
                                  {catNode.total.toFixed(2)}
                                </td>
                              </tr>

                              {catOpen &&
                                catNode.subtipos.map((subNode) => {
                                  const subKey = `sub:${natNode.naturaleza}:${catNode.categoriaPrincipal}:${subNode.subtipo}`;
                                  const subOpen = Boolean(expandedKeys[subKey]);
                                  return (
                                    <React.Fragment key={subKey}>
                                      <tr className="text-slate-700 hover:bg-slate-50">
                                        <td className="py-2 px-4 pl-14">
                                          <button
                                            type="button"
                                            onClick={() => toggleKey(subKey)}
                                            aria-expanded={subOpen}
                                            className="flex items-center gap-2 text-left font-medium cursor-pointer"
                                          >
                                            {subOpen ? (
                                              <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                                            ) : (
                                              <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                                            )}
                                            <span>{subNode.subtipo}</span>
                                          </button>
                                        </td>
                                        <td className="py-2 px-4 text-right font-mono tabular-nums">
                                          {subNode.count}
                                        </td>
                                        <td className="py-2 px-4 text-right font-mono tabular-nums">
                                          {subNode.subtotal.toFixed(2)}
                                        </td>
                                        <td className="py-2 px-4 text-right font-mono tabular-nums">
                                          {subNode.igv.toFixed(2)}
                                        </td>
                                        <td className="py-2 px-4 text-right font-mono font-semibold tabular-nums">
                                          {subNode.total.toFixed(2)}
                                        </td>
                                      </tr>

                                      {subOpen &&
                                        subNode.records.map((rec) => (
                                          <tr
                                            key={rec.id}
                                            className="bg-white hover:bg-emerald-50/40 text-slate-600"
                                          >
                                            <td className="py-2 px-4 pl-20">
                                              <div className="flex items-center justify-between gap-3">
                                                <div>
                                                  <span className="font-mono text-slate-800 font-medium">
                                                    {rec.fecha} · {rec.numeroComprobante || 'S/N'}
                                                  </span>{' '}
                                                  — {rec.nombreComercial || rec.razonSocial} ({rec.sede})
                                                </div>
                                                <div className="flex items-center gap-1.5 shrink-0">
                                                  <button
                                                    type="button"
                                                    onClick={() => onSelectExpense(rec)}
                                                    className="px-2 py-1 text-[11px] font-medium text-[#1B4332] hover:bg-emerald-100 rounded inline-flex items-center gap-1 cursor-pointer"
                                                  >
                                                    <Eye className="w-3 h-3" />
                                                    <span>Detalle</span>
                                                  </button>
                                                  {isManager && onDeleteExpense && (
                                                    <button
                                                      type="button"
                                                      onClick={() => setDeleteTarget(rec)}
                                                      aria-label={`Eliminar comprobante ${rec.numeroComprobante || rec.id}`}
                                                      title="Eliminar con clave"
                                                      className="p-1 text-red-700 hover:bg-red-50 border border-red-200 rounded cursor-pointer"
                                                    >
                                                      <Trash2 className="w-3 h-3" />
                                                    </button>
                                                  )}
                                                </div>
                                              </div>
                                            </td>
                                            <td className="py-2 px-4 text-right font-mono tabular-nums">
                                              1
                                            </td>
                                            <td className="py-2 px-4 text-right font-mono tabular-nums">
                                              {rec.subtotal.toFixed(2)}
                                            </td>
                                            <td className="py-2 px-4 text-right font-mono tabular-nums">
                                              {rec.igv.toFixed(2)}
                                            </td>
                                            <td className="py-2 px-4 text-right font-mono tabular-nums">
                                              {rec.total.toFixed(2)}
                                            </td>
                                          </tr>
                                        ))}
                                    </React.Fragment>
                                  );
                                })}
                            </React.Fragment>
                          );
                        })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CustomPdfModal
        isOpen={showPdfModal}
        onClose={() => setShowPdfModal(false)}
        filteredExpenses={filtered}
        sedes={sedes}
        filters={{
          anio: filterYear,
          mes: filterMonth,
          rangoFechas: activeRangeSummary,
          sede: effectiveSede,
          impacto: filterImpact,
          naturaleza: filterNaturaleza,
          categoria: filterCategoria,
          subtipo: filterSubtipo,
          generadoPor: (user.nombreCompleto || user.usuario).toUpperCase(),
          fiscalComparison: {
            totalVentas: fiscalSummary.totalVentas,
            igvVentas: fiscalSummary.igvVentas,
            igvCompras: fiscalSummary.igvCompras,
            igvNeto: fiscalSummary.igvNeto,
          },
        }}
      />

      {isManager && deleteTarget && onDeleteExpense && (
        <ManagerDeleteModal
          record={deleteTarget}
          user={user}
          onClose={() => setDeleteTarget(null)}
          onDeleted={onDeleteExpense}
        />
      )}
    </div>
  );
};
