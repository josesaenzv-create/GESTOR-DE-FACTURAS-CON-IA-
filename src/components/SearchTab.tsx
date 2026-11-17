import React, { useMemo, useRef, useState } from 'react';
import {
  Search,
  Download,
  Upload,
  Eye,
  MapPin,
  X,
  Building2,
} from 'lucide-react';
import type { ExpenseRecord } from '../types/crediban';
import { formatCurrencySoles } from '../utils/accounting';
import {
  buildProviderChips,
  computeProviderSummary,
  exportExpensesToCsv,
  matchesExpenseSearch,
  parseCsvRecords,
} from '../utils/searchAndPivot';

interface SearchTabProps {
  expenses: ExpenseRecord[];
  onSelectExpense: (record: ExpenseRecord) => void;
  onImportCsvRecords: (records: ExpenseRecord[]) => void;
}

export const SearchTab: React.FC<SearchTabProps> = ({
  expenses,
  onSelectExpense,
  onImportCsvRecords,
}) => {
  const [query, setQuery] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const csvInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(
    () => expenses.filter((r) => matchesExpenseSearch(r, query)),
    [expenses, query]
  );

  const providerChips = useMemo(() => buildProviderChips(expenses).slice(0, 10), [expenses]);

  const providerSummary = useMemo(() => {
    if (!query.trim() || filtered.length === 0) return null;
    // Show executive summary when filtered records share a provider or search targets a specific provider
    const uniqueRucs = new Set(filtered.map((r) => r.ruc || r.razonSocial));
    if (uniqueRucs.size <= 2) {
      return computeProviderSummary(filtered);
    }
    return computeProviderSummary(filtered);
  }, [query, filtered]);

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
    <div className="space-y-5">
      {/* Search Header + CSV Backup Controls */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Buscador Inteligente de Proveedores y Comprobantes
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Busca por RUC/DNI, Razón Social, Nombre Comercial, N° Comprobante (ej. 458 encuentra F004-000458), responsable o concepto.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
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
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Restaurar CSV</span>
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-[#1B4332] hover:bg-[#0f291e] rounded-lg flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exportar Excel (CSV)</span>
            </button>
          </div>
        </div>

        {/* Live Search Bar */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            aria-label="Buscar por RUC, razón social, nombre comercial o comprobante"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Escribe RUC, Razón Social, Nombre Comercial, N° Serie/Correlativo (ej. 458), o concepto..."
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

        {/* Quick Provider Chips */}
        {providerChips.length > 0 && (
          <div>
            <p className="text-xs font-medium text-slate-500 mb-2">
              Directorio rápido de proveedores frecuentes:
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
                    <span className="font-semibold truncate max-w-[160px]">
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

      {/* Consolidated Provider Executive Summary */}
      {providerSummary && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-200">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#59B447]/15 text-[#1B4332] flex items-center justify-center shrink-0">
                <Building2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Ficha Consolidada: {providerSummary.razonSocial}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Comercial: {providerSummary.nombreComercial} · RUC:{' '}
                  <span className="font-mono font-medium">{providerSummary.ruc}</span> · Sedes:{' '}
                  {providerSummary.sedes.join(', ')}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4">
            <div>
              <p className="text-xs text-slate-500">Total Comprobantes</p>
              <p className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {providerSummary.totalComprobantes}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Subtotal Acumulado</p>
              <p className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {formatCurrencySoles(providerSummary.subtotalAcumulado)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">IGV Acumulado</p>
              <p className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {formatCurrencySoles(providerSummary.igvAcumulado)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Total Facturado (S/)</p>
              <p className="text-lg font-extrabold font-mono tabular-nums text-[#1B4332] mt-0.5">
                {formatCurrencySoles(providerSummary.totalAcumulado)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Results Data Grid */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">
            Comprobantes Encontrados
          </h3>
          <span className="text-xs text-slate-500 font-mono tabular-nums">
            {filtered.length} registro{filtered.length === 1 ? '' : 's'}
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-700">
              No se encontraron comprobantes para &ldquo;{query}&rdquo;.
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Prueba buscando por número correlativo, RUC o limpia el filtro.
            </p>
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
                  <th className="py-2.5 px-4 text-right">Acciones</th>
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
                        {r.linkMapa && (
                          <a
                            href={r.linkMapa}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Ver mapa GPS de ${r.numeroComprobante || r.id}`}
                            className="p-1.5 text-slate-500 hover:text-[#1B4332] hover:bg-slate-100 rounded-md"
                          >
                            <MapPin className="w-3.5 h-3.5" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => onSelectExpense(r)}
                          className="px-2.5 py-1 text-xs font-medium text-[#1B4332] bg-emerald-50 hover:bg-emerald-100 rounded-md inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Ver</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
