import React, { useState } from 'react';
import {
  X,
  MapPin,
  ExternalLink,
  Pencil,
  Trash2,
  Printer,
  FileImage,
  Check,
} from 'lucide-react';
import {
  type ExpenseRecord,
  type NaturalezaGasto,
  type TipoComprobante,
  type UserSession,
} from '../types/crediban';
import {
  calculateIgvBreakdown,
  formatCurrencySoles,
  getImpactLevel,
} from '../utils/accounting';
import {
  deleteExpenseInBackend,
  updateExpenseInBackend,
} from '../services/credibanApi';
import { CredibanLogo } from './CredibanLogo';

interface EvidenceModalProps {
  record: ExpenseRecord;
  user: UserSession;
  onClose: () => void;
  onUpdated: (updated: ExpenseRecord) => void;
  onDeleted: (id: string) => void;
}

export const EvidenceModal: React.FC<EvidenceModalProps> = ({
  record,
  user,
  onClose,
  onUpdated,
  onDeleted,
}) => {
  const [imgFailed, setImgFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  // Editable fields
  const [razonSocial, setRazonSocial] = useState(record.razonSocial);
  const [nombreComercial, setNombreComercial] = useState(record.nombreComercial);
  const [ruc, setRuc] = useState(record.ruc);
  const [numeroComprobante, setNumeroComprobante] = useState(record.numeroComprobante);
  const [tipoComprobante, setTipoComprobante] = useState<TipoComprobante>(record.tipoComprobante);
  const [totalStr, setTotalStr] = useState(record.total.toFixed(2));
  const [naturaleza, setNaturaleza] = useState<NaturalezaGasto>(record.naturaleza);
  const [descripcion, setDescripcion] = useState(record.descripcion);
  const [direccionGps, setDireccionGps] = useState(record.direccionGps);

  const handleSaveEdit = async () => {
    const numTotal = parseFloat(totalStr) || 0;
    if (!razonSocial.trim() || numTotal <= 0) return;
    setBusy(true);
    try {
      const breakdown = calculateIgvBreakdown(numTotal, tipoComprobante);
      const next: ExpenseRecord = {
        ...record,
        razonSocial: razonSocial.trim(),
        nombreComercial: nombreComercial.trim() || razonSocial.trim(),
        ruc: ruc.trim(),
        numeroComprobante: numeroComprobante.trim().toUpperCase(),
        tipoComprobante,
        subtotal: breakdown.subtotal,
        igv: breakdown.igv,
        total: breakdown.total,
        nivelImpacto: getImpactLevel(breakdown.total),
        naturaleza,
        descripcion: descripcion.trim(),
        direccionGps: direccionGps.trim(),
      };
      await updateExpenseInBackend(next, user);
      onUpdated(next);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await deleteExpenseInBackend(record.id, user);
      onDeleted(record.id);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const photoUrl = record.linkFotoHd || record.linkFotoView || '';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Detalle de comprobante ${record.numeroComprobante || record.id}`}
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-[2px] flex items-center justify-center p-4"
    >
      <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 bg-slate-50">
          <div className="flex items-center gap-4 min-w-0">
            <div className="hidden sm:block">
              <CredibanLogo variant="print" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-900 truncate">
                {record.razonSocial || record.nombreComercial}
              </h3>
              <p className="text-xs text-slate-500 font-mono truncate">
                {record.id} · {record.tipoComprobante} {record.numeroComprobante || 'S/N'} · {record.sede}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 no-print">
            <button
              type="button"
              onClick={() => window.print()}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Imprimir</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar visor de evidencia"
              className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 rounded-lg cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Split Content */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12">
          {/* Left: High Resolution Invoice Photo */}
          <div className="lg:col-span-6 bg-slate-900/5 border-b lg:border-b-0 lg:border-r border-slate-200 p-5 flex flex-col items-center justify-center min-h-[320px]">
            {photoUrl && !imgFailed ? (
              <div className="w-full flex flex-col items-center gap-3">
                <img
                  src={photoUrl}
                  alt={`Comprobante ${record.numeroComprobante}`}
                  referrerPolicy="no-referrer"
                  onError={() => setImgFailed(true)}
                  className="w-full max-h-[60vh] object-contain rounded-lg border border-slate-200 bg-white"
                />
                {record.linkFotoView && (
                  <a
                    href={record.linkFotoView}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-medium text-[#1B4332] hover:text-[#59B447] flex items-center gap-1"
                  >
                    <span>Ver original en Google Drive HD</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            ) : (
              <div className="text-center p-8 max-w-xs">
                <div className="w-12 h-12 rounded-xl bg-slate-200/80 text-slate-500 flex items-center justify-center mx-auto mb-3">
                  <FileImage className="w-6 h-6" />
                </div>
                <p className="text-sm font-semibold text-slate-700">
                  Sin imagen adjunta disponible
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Este registro corresponde a un asiento contable o su fotografía está archivada en Google Drive de la sede {record.sede}.
                </p>
              </div>
            )}
          </div>

          {/* Right: Accounting & GPS Details */}
          <div className="lg:col-span-6 p-6 space-y-5">
            {editing ? (
              <div className="space-y-3">
                <h4 className="text-sm font-bold text-slate-900">Editar Registro Contable</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">RUC</label>
                    <input
                      type="text"
                      value={ruc}
                      onChange={(e) => setRuc(e.target.value)}
                      className="w-full px-3 py-1.5 text-sm font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">N° Comprobante</label>
                    <input
                      type="text"
                      value={numeroComprobante}
                      onChange={(e) => setNumeroComprobante(e.target.value)}
                      className="w-full px-3 py-1.5 text-sm font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Razón Social</label>
                  <input
                    type="text"
                    value={razonSocial}
                    onChange={(e) => setRazonSocial(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Nombre Comercial</label>
                  <input
                    type="text"
                    value={nombreComercial}
                    onChange={(e) => setNombreComercial(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Tipo</label>
                    <select
                      value={tipoComprobante}
                      onChange={(e) => setTipoComprobante(e.target.value as TipoComprobante)}
                      className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg"
                    >
                      <option value="FACTURA">FACTURA</option>
                      <option value="BOLETA">BOLETA</option>
                      <option value="TICKET DE VENTA">TICKET DE VENTA</option>
                      <option value="RECIBO DE CAJA">RECIBO DE CAJA</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Naturaleza</label>
                    <select
                      value={naturaleza}
                      onChange={(e) => setNaturaleza(e.target.value as NaturalezaGasto)}
                      className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg"
                    >
                      <option value="Costo Fijo">Costo Fijo</option>
                      <option value="Costo Variable">Costo Variable</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Total (S/)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={totalStr}
                      onChange={(e) => setTotalStr(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm font-mono font-bold border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Dirección GPS</label>
                  <input
                    type="text"
                    value={direccionGps}
                    onChange={(e) => setDireccionGps(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Descripción</label>
                  <textarea
                    rows={2}
                    value={descripcion}
                    onChange={(e) => setDescripcion(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleSaveEdit}
                    className="px-4 py-2 bg-[#1B4332] hover:bg-[#0f291e] text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{busy ? 'Guardando...' : 'Guardar Cambios'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg cursor-pointer"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <div>
                    <p className="text-xs text-slate-500">Subtotal</p>
                    <p className="text-sm font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                      {formatCurrencySoles(record.subtotal)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">IGV (18%)</p>
                    <p className="text-sm font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                      {formatCurrencySoles(record.igv)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Total Pagado</p>
                    <p className="text-base font-extrabold font-mono tabular-nums text-[#1B4332] mt-0.5">
                      {formatCurrencySoles(record.total)}
                    </p>
                  </div>
                </div>

                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-xs">
                  <div>
                    <dt className="text-slate-500">RUC / DNI Proveedor</dt>
                    <dd className="font-mono font-semibold text-slate-900 mt-0.5">
                      {record.ruc || 'No especificado'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Nombre Comercial</dt>
                    <dd className="font-semibold text-slate-900 mt-0.5">
                      {record.nombreComercial || '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Fecha y Periodo</dt>
                    <dd className="font-medium text-slate-900 mt-0.5">
                      {record.fecha} · {record.mes} {record.anio}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Naturaleza y Nivel</dt>
                    <dd className="font-medium text-slate-900 mt-0.5">
                      {record.naturaleza} · Impacto {record.nivelImpacto}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Categoría Forms</dt>
                    <dd className="font-medium text-slate-900 mt-0.5">{record.categoriaForms}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Principal / Subtipo</dt>
                    <dd className="font-medium text-slate-900 mt-0.5">
                      {record.categoriaPrincipal} / {record.subtipo}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-slate-500">Descripción del Gasto</dt>
                    <dd className="text-slate-800 mt-0.5 leading-relaxed">
                      {record.descripcion || 'Sin descripción adicional.'}
                    </dd>
                  </div>
                  <div className="sm:col-span-2 pt-2 border-t border-slate-200">
                    <dt className="text-slate-500 flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-[#59B447]" />
                      <span>Ubicación GPS de Emisión / Compra</span>
                    </dt>
                    <dd className="text-slate-900 font-medium mt-1 flex flex-wrap items-center justify-between gap-2">
                      <span>{record.direccionGps || 'Sin dirección registrada'}</span>
                      {record.linkMapa && (
                        <a
                          href={record.linkMapa}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#1B4332] hover:text-[#59B447] font-semibold flex items-center gap-1"
                        >
                          <span>Trazar ruta en Maps</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </dd>
                  </div>
                  <div className="sm:col-span-2 text-slate-500">
                    Registrado por <strong className="text-slate-800">{record.responsable}</strong>{' '}
                    ({record.cargoUsuario || 'Personal'})
                  </div>
                </dl>

                {/* Actions */}
                <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 no-print">
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>Editar Comprobante</span>
                  </button>

                  {confirmDelete ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-red-700 font-medium">¿Confirmar anulación?</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleDelete}
                        className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
                      >
                        Sí, Eliminar
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="px-3 py-1.5 bg-slate-100 text-slate-700 text-xs font-medium rounded-lg cursor-pointer"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="px-3.5 py-2 text-red-700 hover:bg-red-50 border border-red-200 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Anular / Eliminar</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
