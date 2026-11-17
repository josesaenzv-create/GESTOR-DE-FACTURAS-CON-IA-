import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Eye, Layers } from 'lucide-react';
import {
  MONTH_NAMES,
  type ExpenseRecord,
  type NivelImpacto,
  type SedeRecord,
  type UserSession,
} from '../types/crediban';
import { formatCurrencySoles, isManagerUser, round2 } from '../utils/accounting';
import { buildPivotTree } from '../utils/searchAndPivot';

interface DashboardTabProps {
  user: UserSession;
  expenses: ExpenseRecord[];
  sedes: SedeRecord[];
  onSelectExpense: (record: ExpenseRecord) => void;
}

export const DashboardTab: React.FC<DashboardTabProps> = ({
  user,
  expenses,
  sedes,
  onSelectExpense,
}) => {
  const isManager = isManagerUser(user);

  const years = useMemo(() => {
    const set = new Set(expenses.map((e) => e.anio).filter(Boolean));
    set.add('2026');
    return Array.from(set).sort().reverse();
  }, [expenses]);

  const [filterYear, setFilterYear] = useState<string>('TODOS');
  const [filterMonth, setFilterMonth] = useState<string>('TODOS');
  const [filterSede, setFilterSede] = useState<string>(isManager ? 'TODAS' : user.sede);
  const [filterImpact, setFilterImpact] = useState<'TODOS' | NivelImpacto>('TODOS');

  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({
    'nat:Costo Fijo': true,
    'nat:Costo Variable': true,
  });

  const filtered = useMemo(() => {
    return expenses.filter((e) => {
      if (filterYear !== 'TODOS' && e.anio !== filterYear) return false;
      if (filterMonth !== 'TODOS' && e.mes !== filterMonth) return false;
      const effectiveSede = isManager ? filterSede : user.sede;
      if (effectiveSede !== 'TODAS' && e.sede !== effectiveSede) return false;
      if (filterImpact !== 'TODOS' && e.nivelImpacto !== filterImpact) return false;
      return true;
    });
  }, [expenses, filterYear, filterMonth, filterSede, filterImpact, isManager, user.sede]);

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

  const pivotTree = useMemo(() => buildPivotTree(filtered), [filtered]);

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
          <p className="text-xs text-slate-500">IGV Crédito Fiscal</p>
          <p className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {formatCurrencySoles(kpis.igv)}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">Solo facturas 18%</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 col-span-2 lg:col-span-1">
          <p className="text-xs text-slate-500">Alcance de Vista</p>
          <p className="text-base font-bold text-slate-900 mt-1 truncate">
            {isManager ? filterSede : user.sede}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            {filterMonth} · {filterYear}
          </p>
        </div>
      </div>

      {/* Filters & Pivot Controls */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="dash-year" className="block text-xs font-medium text-slate-600 mb-1">
              Año
            </label>
            <select
              id="dash-year"
              value={filterYear}
              onChange={(e) => setFilterYear(e.target.value)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
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
            <label htmlFor="dash-month" className="block text-xs font-medium text-slate-600 mb-1">
              Mes / Periodo
            </label>
            <select
              id="dash-month"
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
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
            <label htmlFor="dash-sede" className="block text-xs font-medium text-slate-600 mb-1">
              Sede
            </label>
            <select
              id="dash-sede"
              value={isManager ? filterSede : user.sede}
              disabled={!isManager}
              onChange={(e) => setFilterSede(e.target.value)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg disabled:bg-slate-100"
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
            <label htmlFor="dash-impact" className="block text-xs font-medium text-slate-600 mb-1">
              Semáforo Impacto
            </label>
            <select
              id="dash-impact"
              value={filterImpact}
              onChange={(e) => setFilterImpact(e.target.value as 'TODOS' | NivelImpacto)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
            >
              <option value="TODOS">Todos</option>
              <option value="Regular">Regular (≤ S/ 60)</option>
              <option value="Medio">Medio (≤ S/ 250)</option>
              <option value="Fuerte">Fuerte (&gt; S/ 250)</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
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
                      {/* Level 1: Naturaleza */}
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

                      {/* Level 2: Categoría Principal */}
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

                              {/* Level 3: Subtipo */}
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

                                      {/* Level 4: Individual Invoices */}
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
                                                <button
                                                  type="button"
                                                  onClick={() => onSelectExpense(rec)}
                                                  className="px-2 py-1 text-[11px] font-medium text-[#1B4332] hover:bg-emerald-100 rounded inline-flex items-center gap-1 cursor-pointer shrink-0"
                                                >
                                                  <Eye className="w-3 h-3" />
                                                  <span>Detalle</span>
                                                </button>
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
    </div>
  );
};
