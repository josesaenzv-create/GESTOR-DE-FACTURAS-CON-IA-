import React, { useMemo, useRef, useState } from 'react';
import {
  Search,
  Download,
  Upload,
  Eye,
  X,
  Building2,
  FileText,
  Filter,
  RotateCcw,
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
import { formatCurrencySoles, isManagerUser } from '../utils/accounting';
import { filterExpensesAdvanced } from '../utils/analytics';
import {
  buildProviderChips,
  computeProviderSummary,
  exportExpensesToCsv,
  matchesExpenseSearch,
  parseCsvRecords,
} from '../utils/searchAndPivot';
import { CustomPdfModal } from './CustomPdfModal';
import { ManagerDeleteModal } from './ManagerDeleteModal';

interface SearchTabProps {
  expenses: ExpenseRecord[];
  sedes?: SedeRecord[];
  criteria?: ExpenseCriterion[];
  user?: UserSession;
  userName?: string;
  isMobileMode?: boolean;
  onSelectExpense: (record: ExpenseRecord) => void;
  onDeleteExpense?: (id: string) => void;
  onImportCsvRecords: (records: ExpenseRecord[]) => void;
}

export const SearchTab: React.FC<SearchTabProps> = ({
  expenses,
  sedes = [],
  criteria = [],
  user,
  userName = 'USUARIO CREDIBAN',
  isMobileMode = false,
  onSelectExpense,
  onDeleteExpense,
  onImportCsvRecords,
}) => {
  const isManager = user ? isManagerUser(user) : false;
  const userSede = user?.sede || 'TODAS';

  const [query, setQuery] = useState('');
  const [filterYear, setFilterYear] = useState<string>('TODOS');
  const [filterMonth, setFilterMonth] = useState<string>('TODOS');
  const [filterDateFrom, setFilterDateFrom] = useState<string>('');
  const [filterDateTo, setFilterDateTo] = useState<string>('');
  const [filterSede, setFilterSede] = useState<string>(isManager ? 'TODAS' : userSede);
  const [filterNaturaleza, setFilterNaturaleza] = useState<'TODAS' | NaturalezaGasto>('TODAS');
  const [filterCategoria, setFilterCategoria] = useState<string>('TODAS');
  const [filterSubtipo, setFilterSubtipo] = useState<string>('TODOS');
  const [filterImpact, setFilterImpact] = useState<'TODOS' | NivelImpacto>('TODOS');
  const [showFilters, setShowFilters] = useState<boolean>(true);
  const [importMsg, setImportMsg] = useState('');
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ExpenseRecord | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const years = useMemo(() => {
    const set = new Set(expenses.map((e) => e.anio).filter(Boolean));
    set.add('2026');
    return Array.from(set).sort().reverse();
  }, [expenses]);

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

  const effectiveSede = isManager ? filterSede : userSede;

  const filtered = useMemo(() => {
    const byCriteria = filterExpensesAdvanced(expenses, {
      anio: filterYear,
      mes: filterMonth,
      dateFrom: filterDateFrom || undefined,
      dateTo: filterDateTo || undefined,
      sede: effectiveSede,
      impacto: filterImpact,
      naturaleza: filterNaturaleza,
      categoriaPrincipal: filterCategoria,
      subtipo: filterSubtipo,
    });
    return byCriteria.filter((r) => matchesExpenseSearch(r, query));
  }, [
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
    query,
  ]);

  const hasActiveFilters =
    filterYear !== 'TODOS' ||
    filterMonth !== 'TODOS' ||
    Boolean(filterDateFrom) ||
    Boolean(filterDateTo) ||
    (isManager && filterSede !== 'TODAS') ||
    filterNaturaleza !== 'TODAS' ||
    filterCategoria !== 'TODAS' ||
    filterSubtipo !== 'TODOS' ||
    filterImpact !== 'TODOS';

  const resetFilters = () => {
    setFilterYear('TODOS');
    setFilterMonth('TODOS');
    setFilterDateFrom('');
    setFilterDateTo('');
    setFilterSede(isManager ? 'TODAS' : userSede);
    setFilterNaturaleza('TODAS');
    setFilterCategoria('TODAS');
    setFilterSubtipo('TODOS');
    setFilterImpact('TODOS');
    setQuery('');
  };

  const providerChips = useMemo(() => buildProviderChips(expenses).slice(0, 10), [expenses]);

  const providerSummary = useMemo(() => {
    if ((!query.trim() && !hasActiveFilters) || filtered.length === 0) return null;
    if (!query.trim()) return null;
    return computeProviderSummary(filtered);
  }, [query, hasActiveFilters, filtered]);

  const handleExportCsv = () => {
    const csvContent = exportExpensesToCsv(filtered);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CREDIBAN_Gastos_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2500);
  };

  const handleImportCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseCsvRecords(text);
      if (parsed.length === 0) {
        setImportMsg('El archivo CSV no contiene registros válidos.');
      } else {
        onImportCsvRecords(parsed);
        setImportMsg(`Se restauraron ${parsed.length} comprobantes desde el respaldo CSV.`);
      }
    } catch {
      setImportMsg('No se pudo leer el archivo CSV.');
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Search Header + CSV Backup Controls */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Buscador de Proveedores y Comprobantes
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Busca por RUC/DNI, Razón Social, Nombre Comercial o N° Comprobante (ej. 458).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleImportCsv}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => csvInputRef.current?.click()}
              className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Restaurar CSV</span>
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="px-3 py-2 text-xs font-semibold text-white bg-[#1B4332] hover:bg-[#0f291e] rounded-lg flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exportar CSV</span>
            </button>
            {isManager && (
              <button
                type="button"
                onClick={() => setShowPdfModal(true)}
                className="px-3 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5 text-red-600" />
                <span>PDF Personalizado</span>
              </button>
            )}
          </div>
        </div>

        {/* Live Search Bar + Filter Toggle */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              aria-label="Buscar por RUC, razón social, nombre comercial o comprobante"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="RUC, Razón Social, Nombre Comercial, Serie/Correlativo (ej. 458)..."
              className="w-full pl-10 pr-10 py-2.5 text-sm bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#59B447]/30 focus:border-[#59B447]"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Limpiar búsqueda"
                className="p-1.5 text-slate-400 hover:text-slate-700 absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className={`px-3 py-2 text-xs font-semibold rounded-xl border inline-flex items-center justify-center gap-1.5 cursor-pointer shrink-0 ${
              hasActiveFilters
                ? 'bg-emerald-50 border-emerald-300 text-[#1B4332]'
                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>{showFilters ? 'Ocultar filtros' : 'Filtros'}</span>
          </button>
        </div>

        {/* Advanced Filters Strip: Mes, Rango de Fechas, Tipo y Subtipo */}
        {showFilters && (
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">
                Filtros de Búsqueda (Periodo, Rango de Fechas, Tipo y Subtipo)
              </span>
              {(hasActiveFilters || query) && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 inline-flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Limpiar todo</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
              <div>
                <label htmlFor="search-anio" className="block text-[11px] font-medium text-slate-600 mb-1">
                  Año
                </label>
                <select
                  id="search-anio"
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
                <label htmlFor="search-mes" className="block text-[11px] font-medium text-slate-600 mb-1">
                  Mes
                </label>
                <select
                  id="search-mes"
                  value={filterMonth}
                  onChange={(e) => setFilterMonth(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                >
                  <option value="TODOS">Todos los meses</option>
                  {MONTH_NAMES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="search-from" className="block text-[11px] font-medium text-slate-600 mb-1">
                  Desde fecha
                </label>
                <input
                  id="search-from"
                  type="date"
                  value={filterDateFrom}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="search-to" className="block text-[11px] font-medium text-slate-600 mb-1">
                  Hasta fecha
                </label>
                <input
                  id="search-to"
                  type="date"
                  value={filterDateTo}
                  onChange={(e) => setFilterDateTo(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="search-sede" className="block text-[11px] font-medium text-slate-600 mb-1">
                  Sede
                </label>
                <select
                  id="search-sede"
                  value={effectiveSede}
                  disabled={!isManager}
                  onChange={(e) => setFilterSede(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg disabled:bg-slate-100"
                >
                  {isManager && <option value="TODAS">Todas las sedes</option>}
                  {sedes.map((s) => (
                    <option key={s.nombreSede} value={s.nombreSede}>
                      {s.nombreSede}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="search-nat" className="block text-[11px] font-medium text-slate-600 mb-1">
                  Tipo de Gasto
                </label>
                <select
                  id="search-nat"
                  value={filterNaturaleza}
                  onChange={(e) => {
                    setFilterNaturaleza(e.target.value as 'TODAS' | NaturalezaGasto);
                    setFilterCategoria('TODAS');
                    setFilterSubtipo('TODOS');
                  }}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                >
                  <option value="TODAS">Fijo y Variable</option>
                  <option value="Costo Fijo">Costo Fijo</option>
                  <option value="Costo Variable">Costo Variable</option>
                </select>
              </div>
              <div>
                <label htmlFor="search-cat" className="block text-[11px] font-medium text-slate-600 mb-1">
                  Categoría Principal
                </label>
                <select
                  id="search-cat"
                  value={filterCategoria}
                  onChange={(e) => {
                    setFilterCategoria(e.target.value);
                    setFilterSubtipo('TODOS');
                  }}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                >
                  <option value="TODAS">Todas las categorías</option>
                  {categoryOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="search-sub" className="block text-[11px] font-medium text-slate-600 mb-1">
                  Subtipo
                </label>
                <select
                  id="search-sub"
                  value={filterSubtipo}
                  onChange={(e) => setFilterSubtipo(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                >
                  <option value="TODOS">Todos los subtipos</option>
                  {subtypeOptions.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="search-imp" className="block text-[11px] font-medium text-slate-600 mb-1">
                  Semáforo
                </label>
                <select
                  id="search-imp"
                  value={filterImpact}
                  onChange={(e) => setFilterImpact(e.target.value as 'TODOS' | NivelImpacto)}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                >
                  <option value="TODOS">Todos</option>
                  <option value="Regular">Regular (≤ S/ 60)</option>
                  <option value="Medio">Medio (S/ 60 - 250)</option>
                  <option value="Fuerte">Fuerte (&gt; S/ 250)</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Quick Provider Chips */}
        {providerChips.length > 0 && (
          <div>
            <p className="text-xs font-medium text-slate-500 mb-2">
              Proveedores frecuentes:
            </p>
            <div className="flex flex-wrap gap-2">
              {providerChips.map((chip) => {
                const isSelected =
                  query.trim().toLowerCase() === (chip.ruc || chip.razonSocial).toLowerCase();
                return (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() =>
                      setQuery(isSelected ? '' : chip.ruc || chip.razonSocial)
                    }
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors flex items-center gap-2 cursor-pointer ${
                      isSelected
                        ? 'bg-[#1B4332] text-white border-[#1B4332]'
                        : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                    }`}
                  >
                    <span className="font-semibold truncate max-w-[150px]">
                      {chip.nombreComercial}
                    </span>
                    <span className="font-mono tabular-nums opacity-75">
                      ({chip.count}) · {formatCurrencySoles(chip.total)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {importMsg && (
          <p className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            {importMsg}
          </p>
        )}
      </div>

      {/* Consolidated Provider Executive Summary (Gerentes only) */}
      {isManager && providerSummary && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5">
          <div className="flex items-start gap-3 pb-4 border-b border-slate-200">
            <div className="w-10 h-10 rounded-lg bg-[#59B447]/15 text-[#1B4332] flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900 truncate">
                Ficha Consolidada: {providerSummary.razonSocial}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Comercial: {providerSummary.nombreComercial} · RUC:{' '}
                <span className="font-mono font-medium">{providerSummary.ruc}</span> · Sedes:{' '}
                {providerSummary.sedes.join(', ')}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4">
            <div>
              <p className="text-xs text-slate-500">Comprobantes</p>
              <p className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {providerSummary.totalComprobantes}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Subtotal</p>
              <p className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {formatCurrencySoles(providerSummary.subtotalAcumulado)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">IGV</p>
              <p className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {formatCurrencySoles(providerSummary.igvAcumulado)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Total Facturado</p>
              <p className="text-lg font-extrabold font-mono tabular-nums text-[#1B4332] mt-0.5">
                {formatCurrencySoles(providerSummary.totalAcumulado)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Results: Mobile Cards when in Mobile Mode / small screens, Table on PC */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">
            Comprobantes Encontrados
          </h3>
          <span className="text-xs text-slate-500 font-mono tabular-nums">
            {filtered.length} registro{filtered.length === 1 ? '' : 's'}
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-medium text-slate-700">
              No se encontraron comprobantes para &ldquo;{query}&rdquo;.
            </p>
          </div>
        ) : isMobileMode ? (
          <div className="divide-y divide-slate-200">
            {filtered.map((r) => (
              <div key={r.id} className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">
                      {r.razonSocial || r.nombreComercial}
                    </p>
                    <p className="text-xs text-slate-500 font-mono">
                      {r.fecha} · {r.numeroComprobante || 'S/N'} · {r.sede}
                    </p>
                  </div>
                  <span className="text-sm font-extrabold font-mono tabular-nums text-[#1B4332] shrink-0">
                    {formatCurrencySoles(r.total)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="text-xs text-slate-600 truncate">
                    {r.naturaleza} · {r.subtipo}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onSelectExpense(r)}
                      className="px-3 py-1.5 text-xs font-semibold text-[#1B4332] bg-emerald-50 hover:bg-emerald-100 rounded-lg inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Ver</span>
                    </button>
                    {isManager && user && onDeleteExpense && (
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(r)}
                        aria-label={`Eliminar comprobante ${r.numeroComprobante || r.id}`}
                        className="p-1.5 text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-2.5 px-4">Fecha / Sede</th>
                  <th className="py-2.5 px-4">Comprobante</th>
                  <th className="py-2.5 px-4">Proveedor (RUC / Comercial)</th>
                  <th className="py-2.5 px-4">Clasificación</th>
                  <th className="py-2.5 px-4 text-right">Subtotal</th>
                  <th className="py-2.5 px-4 text-right">IGV</th>
                  <th className="py-2.5 px-4 text-right">Total (S/)</th>
                  <th className="py-2.5 px-4 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <div className="font-mono text-slate-900">{r.fecha}</div>
                      <div className="text-slate-500">{r.sede}</div>
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <div className="font-mono font-semibold text-slate-900">
                        {r.numeroComprobante || 'S/N'}
                      </div>
                      <div className="text-slate-500">{r.tipoComprobante}</div>
                    </td>
                    <td className="py-2.5 px-4 min-w-[200px]">
                      <div className="font-semibold text-slate-900 truncate max-w-[240px]">
                        {r.razonSocial}
                      </div>
                      <div className="text-slate-500 font-mono">
                        {r.ruc || 'Sin RUC'} · {r.nombreComercial}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 min-w-[180px]">
                      <div className="font-medium text-slate-800">{r.naturaleza}</div>
                      <div className="text-slate-500 truncate max-w-[200px]">
                        {r.categoriaPrincipal} / {r.subtipo}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                      {r.subtotal.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                      {r.igv.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-bold tabular-nums text-slate-900 whitespace-nowrap">
                      {r.total.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onSelectExpense(r)}
                          className="px-2.5 py-1 text-xs font-medium text-[#1B4332] bg-emerald-50 hover:bg-emerald-100 rounded-md inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Ver</span>
                        </button>
                        {isManager && user && onDeleteExpense && (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(r)}
                            aria-label={`Eliminar comprobante ${r.numeroComprobante || r.id}`}
                            title="Eliminar registro con clave"
                            className="p-1 text-red-700 hover:bg-red-50 border border-red-200 rounded-md cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isManager && (
        <CustomPdfModal
          isOpen={showPdfModal}
          onClose={() => setShowPdfModal(false)}
          filteredExpenses={filtered}
          sedes={sedes}
          filters={{
            anio: filterYear,
            mes: filterMonth,
            rangoFechas:
              filterDateFrom || filterDateTo
                ? `${filterDateFrom || '...'} a ${filterDateTo || '...'}`
                : undefined,
            sede: effectiveSede,
            impacto: filterImpact,
            naturaleza: filterNaturaleza,
            categoria: filterCategoria,
            subtipo: filterSubtipo,
            busqueda: query.trim() || undefined,
            generadoPor: userName.toUpperCase(),
          }}
        />
      )}

      {isManager && user && deleteTarget && onDeleteExpense && (
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
