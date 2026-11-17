import React, { useState } from 'react';
import { FileText, X, Download } from 'lucide-react';
import type { ExpenseRecord, SedeRecord } from '../types/crediban';
import {
  downloadCustomFilteredPdf,
  type CustomPdfOptions,
  type ReportFilterContext,
} from '../utils/pdfReports';

interface CustomPdfModalProps {
  isOpen: boolean;
  onClose: () => void;
  filteredExpenses: ExpenseRecord[];
  sedes: SedeRecord[];
  filters: ReportFilterContext;
}

export const CustomPdfModal: React.FC<CustomPdfModalProps> = ({
  isOpen,
  onClose,
  filteredExpenses,
  sedes,
  filters,
}) => {
  const [options, setOptions] = useState<CustomPdfOptions>({
    title: 'REPORTE FINANCIERO DE GASTOS CREDIBAN',
    subtitle: `Periodo ${filters.mes} ${filters.anio} · Sede ${filters.sede}`,
    orientation: 'landscape',
    includeKpis: true,
    includeSedeChart: true,
    includeMonthlyIgvChart: true,
    includeTable: true,
    columns: {
      fecha: true,
      sede: true,
      numero: true,
      proveedor: true,
      clasificacion: true,
      subtotal: true,
      igv: true,
      total: true,
    },
  });

  if (!isOpen) return null;

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    downloadCustomFilteredPdf(options, filteredExpenses, sedes, filters);
    onClose();
  };

  const toggleColumn = (col: keyof CustomPdfOptions['columns']) => {
    setOptions((prev) => ({
      ...prev,
      columns: { ...prev.columns, [col]: !prev.columns[col] },
    }));
  };

  const columnLabels: Array<{ key: keyof CustomPdfOptions['columns']; label: string }> = [
    { key: 'fecha', label: 'Fecha' },
    { key: 'sede', label: 'Sede' },
    { key: 'numero', label: 'N° Comprobante' },
    { key: 'proveedor', label: 'Proveedor / RUC' },
    { key: 'clasificacion', label: 'Clasificación' },
    { key: 'subtotal', label: 'Subtotal' },
    { key: 'igv', label: 'IGV' },
    { key: 'total', label: 'Total (S/)' },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="custom-pdf-modal-title"
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#1B4332]/10 text-[#1B4332] flex items-center justify-center">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h3 id="custom-pdf-modal-title" className="text-sm font-bold text-slate-900">
                Exportar Reporte PDF Personalizado
              </h3>
              <p className="text-xs text-slate-500">
                Basado en {filteredExpenses.length} registro{filteredExpenses.length === 1 ? '' : 's'} filtrados actualmente
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar constructor PDF"
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleGenerate} className="p-5 space-y-4">
          <div className="space-y-3">
            <div>
              <label htmlFor="pdf-title" className="block text-xs font-medium text-slate-700 mb-1">
                Título del Reporte
              </label>
              <input
                id="pdf-title"
                type="text"
                value={options.title}
                onChange={(e) => setOptions((p) => ({ ...p, title: e.target.value }))}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label htmlFor="pdf-sub" className="block text-xs font-medium text-slate-700 mb-1">
                  Subtítulo / Observación
                </label>
                <input
                  id="pdf-sub"
                  type="text"
                  value={options.subtitle}
                  onChange={(e) => setOptions((p) => ({ ...p, subtitle: e.target.value }))}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="pdf-orient" className="block text-xs font-medium text-slate-700 mb-1">
                  Orientación
                </label>
                <select
                  id="pdf-orient"
                  value={options.orientation}
                  onChange={(e) =>
                    setOptions((p) => ({
                      ...p,
                      orientation: e.target.value as 'portrait' | 'landscape',
                    }))
                  }
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                >
                  <option value="landscape">Horizontal (A4)</option>
                  <option value="portrait">Vertical (A4)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Active Filter Badges */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600 flex flex-wrap gap-x-3 gap-y-1">
            <span>
              <strong>Año:</strong> {filters.anio}
            </span>
            <span>
              <strong>Mes:</strong> {filters.mes}
            </span>
            {filters.rangoFechas && (
              <span>
                <strong>Rango:</strong> {filters.rangoFechas}
              </span>
            )}
            <span>
              <strong>Sede:</strong> {filters.sede}
            </span>
            <span>
              <strong>Semáforo:</strong> {filters.impacto}
            </span>
            {filters.naturaleza && filters.naturaleza !== 'TODAS' && (
              <span>
                <strong>Tipo:</strong> {filters.naturaleza}
              </span>
            )}
            {filters.categoria && filters.categoria !== 'TODAS' && (
              <span>
                <strong>Categoría:</strong> {filters.categoria}
              </span>
            )}
            {filters.subtipo && filters.subtipo !== 'TODOS' && (
              <span>
                <strong>Subtipo:</strong> {filters.subtipo}
              </span>
            )}
            {filters.busqueda && (
              <span>
                <strong>Búsqueda:</strong> {filters.busqueda}
              </span>
            )}
          </div>

          {/* Sections */}
          <div>
            <p className="text-xs font-bold text-slate-800 mb-2">Secciones a incluir</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <label className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={options.includeKpis}
                  onChange={(e) =>
                    setOptions((p) => ({ ...p, includeKpis: e.target.checked }))
                  }
                  className="accent-[#1B4332]"
                />
                <span>KPIs Ejecutivos</span>
              </label>
              <label className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={options.includeSedeChart}
                  onChange={(e) =>
                    setOptions((p) => ({ ...p, includeSedeChart: e.target.checked }))
                  }
                  className="accent-[#1B4332]"
                />
                <span>Gráfico por Sedes</span>
              </label>
              <label className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={options.includeMonthlyIgvChart}
                  onChange={(e) =>
                    setOptions((p) => ({ ...p, includeMonthlyIgvChart: e.target.checked }))
                  }
                  className="accent-[#1B4332]"
                />
                <span>Avance Mensual e IGV</span>
              </label>
              <label className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={options.includeTable}
                  onChange={(e) =>
                    setOptions((p) => ({ ...p, includeTable: e.target.checked }))
                  }
                  className="accent-[#1B4332]"
                />
                <span>Tabla de Comprobantes</span>
              </label>
            </div>
          </div>

          {/* Table Columns */}
          {options.includeTable && (
            <div>
              <p className="text-xs font-bold text-slate-800 mb-2">Columnas de la tabla</p>
              <div className="flex flex-wrap gap-2 text-xs">
                {columnLabels.map((col) => (
                  <label
                    key={col.key}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={options.columns[col.key]}
                      onChange={() => toggleColumn(col.key)}
                      className="accent-[#1B4332]"
                    />
                    <span>{col.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-[#1B4332] hover:bg-[#0f291e] rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Generar PDF</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
