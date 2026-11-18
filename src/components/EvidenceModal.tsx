import React, { useRef, useState } from 'react';
import {
  X,
  ExternalLink,
  Pencil,
  Trash2,
  Printer,
  FileImage,
  Check,
  Camera,
  Upload,
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
  isManagerUser,
} from '../utils/accounting';
import { updateExpenseInBackend } from '../services/credibanApi';
import { processInvoiceImageFile } from '../utils/imageProcessor';
import { CredibanLogo } from './CredibanLogo';
import { ManagerDeleteModal } from './ManagerDeleteModal';

function isSafeMediaUrl(raw?: string): boolean {
  const s = String(raw || '').trim();
  if (!s) return false;
  return /^https?:\/\//i.test(s) || /^data:image\//i.test(s);
}

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
  const isManager = isManagerUser(user);
  const [imgFailed, setImgFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoStatusMsg, setPhotoStatusMsg] = useState('');
  const signedCamRef = useRef<HTMLInputElement>(null);
  const signedFileRef = useRef<HTMLInputElement>(null);

  const [razonSocial, setRazonSocial] = useState(record.razonSocial);
  const [nombreComercial, setNombreComercial] = useState(record.nombreComercial);
  const [ruc, setRuc] = useState(record.ruc);
  const [numeroComprobante, setNumeroComprobante] = useState(record.numeroComprobante);
  const [tipoComprobante, setTipoComprobante] = useState<TipoComprobante>(record.tipoComprobante);
  const [totalStr, setTotalStr] = useState(record.total.toFixed(2));
  const [naturaleza, setNaturaleza] = useState<NaturalezaGasto>(record.naturaleza);
  const [descripcion, setDescripcion] = useState(record.descripcion);

  const handleUploadSignedPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setPhotoStatusMsg('');
    try {
      const processed = await processInvoiceImageFile(file);
      setImgFailed(false);
      const next: ExpenseRecord = {
        ...record,
        linkFotoHd: processed.hdDataUrl,
        estado: record.estado.includes('FIRMADO') ? record.estado : `${record.estado} · FIRMADO`,
      };
      const res = await updateExpenseInBackend(
        next,
        user,
        processed.hdBase64,
        `${record.id}_${record.numeroComprobante || 'COMPROBANTE'}_FIRMADO.jpg`
      );
      onUpdated(res.savedRecord);
      setPhotoStatusMsg(res.message);
    } catch (err) {
      setPhotoStatusMsg(
        err instanceof Error ? err.message : 'No se pudo adjuntar la foto firmada.'
      );
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

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
      };
      const res = await updateExpenseInBackend(next, user);
      onUpdated(res.savedRecord);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const rawPhotoUrl = record.linkFotoHd || record.linkFotoView || '';
  const photoUrl = isSafeMediaUrl(rawPhotoUrl) ? rawPhotoUrl : '';
  const safeExternalViewUrl = isSafeMediaUrl(record.linkFotoView) ? record.linkFotoView : '';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Detalle de comprobante ${record.numeroComprobante || record.id}`}
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-4"
    >
      <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 bg-slate-50">
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
              <span className="hidden sm:inline">Imprimir</span>
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
          {/* Left: High Resolution Invoice / Signed Voucher Photo */}
          <div className="lg:col-span-6 bg-slate-900/5 border-b lg:border-b-0 lg:border-r border-slate-200 p-5 flex flex-col items-center justify-center min-h-[260px] gap-3">
            <input
              id="evidence-camera-input"
              ref={signedCamRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleUploadSignedPhoto}
              className="sr-only"
            />
            <input
              id="evidence-gallery-input"
              ref={signedFileRef}
              type="file"
              accept="image/*"
              onChange={handleUploadSignedPhoto}
              className="sr-only"
            />

            {photoUrl && !imgFailed ? (
              <div className="w-full flex flex-col items-center gap-3">
                <img
                  src={photoUrl}
                  alt={`Comprobante ${record.numeroComprobante}`}
                  referrerPolicy="no-referrer"
                  onError={() => setImgFailed(true)}
                  className="w-full max-h-[50vh] object-contain rounded-lg border border-slate-200 bg-white"
                />
                {safeExternalViewUrl && (
                  <a
                    href={safeExternalViewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-medium text-[#1B4332] hover:text-[#59B447] flex items-center gap-1"
                  >
                    <span>Ver original en Nube HD</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            ) : (
              <div className="text-center p-6 max-w-xs">
                <div className="w-12 h-12 rounded-xl bg-slate-200/80 text-slate-500 flex items-center justify-center mx-auto mb-3">
                  <FileImage className="w-6 h-6" />
                </div>
                <p className="text-sm font-semibold text-slate-700">
                  Sin imagen adjunta disponible
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Puedes subir o fotografiar el comprobante / voucher firmado para adjuntarlo en HD al Servidor.
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-center gap-2 no-print pt-1">
              <label
                htmlFor={busy ? undefined : 'evidence-camera-input'}
                className={`px-3 py-1.5 bg-[#1B4332] hover:bg-[#0f291e] text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 select-none ${
                  busy ? 'opacity-60 pointer-events-none' : 'cursor-pointer'
                }`}
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Fotografiar Firmado</span>
              </label>
              <label
                htmlFor={busy ? undefined : 'evidence-gallery-input'}
                className={`px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 select-none ${
                  busy ? 'opacity-60 pointer-events-none' : 'cursor-pointer'
                }`}
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{photoUrl ? 'Reemplazar Foto HD' : 'Subir Foto HD'}</span>
              </label>
            </div>

            {photoStatusMsg && (
              <p className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5 text-center">
                {photoStatusMsg}
              </p>
            )}
          </div>

          {/* Right: Accounting Details */}
          <div className="lg:col-span-6 p-5 sm:p-6 space-y-5">
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
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">N° Comprobante</label>
                    <input
                      type="text"
                      value={numeroComprobante}
                      onChange={(e) => setNumeroComprobante(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Razón Social</label>
                  <input
                    type="text"
                    value={razonSocial}
                    onChange={(e) => setRazonSocial(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Nombre Comercial</label>
                  <input
                    type="text"
                    value={nombreComercial}
                    onChange={(e) => setNombreComercial(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Tipo</label>
                    <select
                      value={tipoComprobante}
                      onChange={(e) => setTipoComprobante(e.target.value as TipoComprobante)}
                      className="w-full px-2 py-2 text-xs border border-slate-300 rounded-lg"
                    >
                      <option value="FACTURA">FACTURA</option>
                      <option value="BOLETA">BOLETA</option>
                      <option value="YAPE / PLIN / TRANSFERENCIA">YAPE / PLIN / TRANSFERENCIA</option>
                      <option value="RECIBO DE CAJA">RECIBO DE CAJA</option>
                      <option value="RECIBO DE MOVILIDAD">RECIBO DE MOVILIDAD</option>
                      <option value="TICKET DE VENTA">TICKET DE VENTA</option>
                      <option value="SOLO CAPTURA">SOLO CAPTURA</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Naturaleza</label>
                    <select
                      value={naturaleza}
                      onChange={(e) => setNaturaleza(e.target.value as NaturalezaGasto)}
                      className="w-full px-2 py-2 text-xs border border-slate-300 rounded-lg"
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
                      className="w-full px-2 py-2 text-sm font-mono font-bold border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Descripción</label>
                  <textarea
                    rows={2}
                    value={descripcion}
                    onChange={(e) => setDescripcion(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
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
                  <div className="sm:col-span-2 pt-2 border-t border-slate-200 text-slate-500">
                    Registrado por <strong className="text-slate-800">{record.responsable}</strong>{' '}
                    ({record.cargoUsuario || 'Personal'})
                  </div>
                </dl>

                <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 no-print">
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>Editar Comprobante</span>
                  </button>

                  {isManager && (
                    <button
                      type="button"
                      onClick={() => setShowDeleteModal(true)}
                      className="px-3.5 py-2 text-red-700 hover:bg-red-50 border border-red-200 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Eliminar con Clave</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {isManager && showDeleteModal && (
        <ManagerDeleteModal
          record={record}
          user={user}
          onClose={() => setShowDeleteModal(false)}
          onDeleted={(deletedId) => {
            onDeleted(deletedId);
            onClose();
          }}
        />
      )}
    </div>
  );
};
