import React, { useMemo, useRef, useState } from 'react';
import {
  Printer,
  Download,
  Save,
  CheckCircle2,
  UserCheck,
  Receipt,
  RefreshCw,
  FileText,
  Camera,
  Upload,
  Trash2,
  FileCheck2,
} from 'lucide-react';
import {
  CREDIBAN_COMPANY,
  MONTH_NAMES,
  type ExpenseRecord,
  type SedeRecord,
  type UserSession,
  type VoucherType,
} from '../types/crediban';
import {
  VOUCHER_TEMPLATES,
  filterMatchingCollaborators,
  formatVoucherDateTime,
  getNextVoucherCorrelative,
} from '../utils/vouchers';
import {
  getImpactLevel,
  getMonthNameFromIsoDate,
  getYearFromIsoDate,
  isManagerUser,
} from '../utils/accounting';
import {
  saveExpenseToBackend,
  updateExpenseInBackend,
} from '../services/credibanApi';
import {
  processInvoiceImageFile,
  type ProcessedInvoiceImages,
} from '../utils/imageProcessor';
import {
  downloadVoucherPdf,
  drawCredibanEmblemOnCanvas,
  printThermalVoucher,
} from '../utils/pdfReports';

interface VoucherEmitterTabProps {
  user: UserSession;
  usersDirectory: UserSession[];
  sedes: SedeRecord[];
  existingExpenses: ExpenseRecord[];
  isMobileMode?: boolean;
  onExpenseCreated: (record: ExpenseRecord) => void;
  onExpenseUpdated?: (record: ExpenseRecord) => void;
}

function renderVoucherToImageDataUrl(params: {
  headerTitle: string;
  fechaTexto: string;
  sede: string;
  direccion: string;
  ubicacion: string;
  telefono: string;
  codigoSbs: string;
  mensajePie: string;
  correoContacto: string;
  serieNumero: string;
  mes: string;
  beneficiario: string;
  concepto: string;
  legalText: string;
  dni: string;
  showSignature: boolean;
  totalLabel: string;
  monto: number;
  gestorCaja: string;
}): string {
  const canvas = document.createElement('canvas');
  canvas.width = 680;
  canvas.height = params.showSignature ? 980 : 800;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const marginX = 32;
  const rightX = canvas.width - marginX;
  const centerX = canvas.width / 2;
  const maxTextW = canvas.width - marginX * 2;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Exact CREDIBAN vector mark (6 rounded bars + curved wing)
  drawCredibanEmblemOnCanvas(ctx, marginX, 18, 56, '#1B4332');

  ctx.fillStyle = '#0f172a';
  ctx.textAlign = 'left';
  ctx.font = 'bold 28px Georgia, serif';
  ctx.fillText('CREDIBAN', marginX + 54, 56);

  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(params.headerTitle, rightX, 54, 340);

  const drawDoubleLine = (yy: number) => {
    ctx.save();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(marginX, yy);
    ctx.lineTo(rightX, yy);
    ctx.moveTo(marginX, yy + 4);
    ctx.lineTo(rightX, yy + 4);
    ctx.stroke();
    ctx.restore();
  };

  const drawDashedLine = (yy: number) => {
    ctx.save();
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(marginX, yy);
    ctx.lineTo(rightX, yy);
    ctx.stroke();
    ctx.restore();
  };

  let y = 84;
  drawDoubleLine(y);
  y += 28;

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 19px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(CREDIBAN_COMPANY.ruc, marginX + 4, y);
  ctx.textAlign = 'right';
  ctx.fillText(params.fechaTexto, rightX - 4, y);

  y += 24;
  ctx.font = '15px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(params.direccion.toUpperCase(), marginX + 4, y, 290);
  ctx.textAlign = 'right';
  ctx.fillText(params.ubicacion.toUpperCase(), rightX - 4, y, 310);

  if (params.telefono) {
    y += 20;
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`TELF: ${params.telefono}`, centerX, y, maxTextW);
  }

  y += 22;
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(params.codigoSbs.toUpperCase(), centerX, y, maxTextW);

  y += 32;
  ctx.font = 'bold 21px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`RECIBO ${params.serieNumero}`, marginX, y);
  ctx.textAlign = 'right';
  ctx.fillText(params.mes, rightX, y);

  y += 14;
  drawDashedLine(y);
  y += 30;

  ctx.font = 'bold 21px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(params.beneficiario.toUpperCase(), centerX, y, maxTextW);

  y += 16;
  drawDoubleLine(y);
  y += 32;

  ctx.font = '15.5px sans-serif';
  ctx.textAlign = 'left';
  const wrapText = (text: string, maxW: number, startY: number): number => {
    const words = text.split(/\s+/);
    let line = '';
    let cy = startY;
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW) {
        ctx.fillText(line, marginX, cy);
        line = w;
        cy += 24;
      } else {
        line = test;
      }
    }
    if (line) {
      ctx.fillText(line, marginX, cy);
      cy += 24;
    }
    return cy;
  };

  if (params.legalText) {
    y = wrapText(params.legalText, maxTextW, y);
    y += 12;
  }

  if (params.concepto) {
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(params.concepto.toUpperCase(), centerX, y + 14, maxTextW);
    y += 46;
  }

  if (params.showSignature) {
    y = Math.max(y + 72, 560);
    ctx.font = 'bold 17px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('FIRMA :', marginX, y);
    ctx.beginPath();
    ctx.moveTo(marginX + 108, y + 2);
    ctx.lineTo(rightX, y + 2);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    y += 48;
    ctx.fillText('DNI:', marginX, y);
    ctx.font = 'bold 19px monospace';
    ctx.fillText(params.dni || '____________', marginX + 68, y);
    ctx.beginPath();
    ctx.moveTo(marginX + 210, y + 4);
    ctx.lineTo(rightX, y + 4);
    ctx.stroke();
    y += 32;
  } else {
    y = Math.max(y + 80, 520);
  }

  drawDashedLine(y);
  y += 32;

  ctx.font = 'bold 21px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#0f172a';
  ctx.fillText(
    `${params.totalLabel}   S/ ${params.monto.toFixed(2)}`,
    rightX,
    y,
    maxTextW
  );

  y += 18;
  drawDoubleLine(y);
  y += 28;

  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`GESTOR DE CAJA:   ${params.gestorCaja.toUpperCase()}`, centerX, y, maxTextW);

  y += 14;
  drawDashedLine(y);
  y += 24;

  ctx.font = 'italic bold 15px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(params.mensajePie.toUpperCase(), centerX, y, maxTextW);
  y += 22;
  ctx.font = '13px sans-serif';
  ctx.fillText(
    'SI TIENE ALGUNA DUDA PONGASE EN CONTACTO CON :',
    centerX,
    y,
    maxTextW
  );
  y += 19;
  ctx.fillStyle = '#1d4ed8';
  ctx.fillText(params.correoContacto.toUpperCase(), centerX, y, maxTextW);

  return canvas.toDataURL('image/jpeg', 0.95);
}

export const VoucherEmitterTab: React.FC<VoucherEmitterTabProps> = ({
  user,
  usersDirectory,
  sedes,
  existingExpenses,
  isMobileMode = false,
  onExpenseCreated,
  onExpenseUpdated,
}) => {
  const isManager = isManagerUser(user);
  const ticketRef = useRef<HTMLDivElement>(null);
  const signedCameraInputRef = useRef<HTMLInputElement>(null);
  const signedGalleryInputRef = useRef<HTMLInputElement>(null);
  const todayIso = new Date().toISOString().slice(0, 10);

  const [voucherType, setVoucherType] = useState<VoucherType>('MOVILIDAD');
  const template = VOUCHER_TEMPLATES[voucherType];

  const [sede, setSede] = useState<string>(
    isManager ? sedes[0]?.nombreSede || 'HUACHO' : user.sede || 'HUACHO'
  );
  const [fecha, setFecha] = useState<string>(todayIso);
  const [mes, setMes] = useState<string>(getMonthNameFromIsoDate(todayIso));
  const [correlativoOverride, setCorrelativoOverride] = useState<string>('');
  const [beneficiario, setBeneficiario] = useState<string>('');
  const [dni, setDni] = useState<string>('');
  const [concepto, setConcepto] = useState<string>(template.defaultConcept);
  const [montoStr, setMontoStr] = useState<string>('');
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Signed physical voucher photo support (pre-emit OR post-emit)
  const [signedPhoto, setSignedPhoto] = useState<ProcessedInvoiceImages | null>(null);
  const [lastEmittedRecord, setLastEmittedRecord] = useState<ExpenseRecord | null>(null);
  const [uploadingSignedPhoto, setUploadingSignedPhoto] = useState(false);

  const activeSede = (isManager ? sede : user.sede || 'HUACHO').trim().toUpperCase();
  const activeSedeConfig = useMemo(
    () => sedes.find((s) => s.nombreSede.trim().toUpperCase() === activeSede),
    [sedes, activeSede]
  );

  const sedeDireccion = activeSedeConfig?.direccion || 'PROLG. GRAU #108';
  const sedeUbicacion = activeSedeConfig?.ubicacion || `${activeSede} - PERÚ`;
  const sedeTelefono = activeSedeConfig?.telefono || '';
  const sedeCodigoSbs =
    activeSedeConfig?.codigoSbs || 'INSCRITO EN LA SBS BAJO CODIGO REGISTRAL 00038222-2025';
  const sedeMensajePie = activeSedeConfig?.mensajePie || '*** TE DESEO MUCHO EXITO ***';
  const sedeCorreo = activeSedeConfig?.correoContacto || 'CREDIBANPERU@GMAIL.COM';

  const autoCorrelativo = useMemo(
    () => getNextVoucherCorrelative(existingExpenses, template.serie, activeSede),
    [existingExpenses, template.serie, activeSede]
  );

  const activeCorrelativo = correlativoOverride || autoCorrelativo;
  const fullSerieNumero = `${template.serie} - ${activeCorrelativo}`;
  const cleanSerieNumero = `${template.serie}-${activeCorrelativo}`;

  const matchingUsers = useMemo(() => {
    if (!beneficiario.trim()) return [];
    const activeUsers = usersDirectory.filter((u) => {
      const est = String(u.estado || 'HABILITADO').toUpperCase();
      return est !== 'DESHABILITADO' && est !== 'INACTIVO' && est !== 'BLOQUEADO';
    });
    return filterMatchingCollaborators(activeUsers, beneficiario, 6);
  }, [usersDirectory, beneficiario]);

  const handleSelectVoucherType = (nextType: VoucherType) => {
    setVoucherType(nextType);
    const nextTpl = VOUCHER_TEMPLATES[nextType];
    setConcepto(nextTpl.defaultConcept);
    setCorrelativoOverride('');
    setLastEmittedRecord(null);
    setFeedback(null);
  };

  const handlePickUser = (u: UserSession) => {
    setBeneficiario((u.nombreCompleto || u.usuario.replace(/\./g, ' ')).toUpperCase());
    setDni(u.dni || '');
    setShowSuggestions(false);
  };

  const numericMonto = parseFloat(montoStr) || 0;
  const gestorCaja = (user.nombreCompleto || user.usuario.replace(/\./g, ' ')).toUpperCase();

  const buildImageUrl = () =>
    renderVoucherToImageDataUrl({
      headerTitle: template.headerTitle,
      fechaTexto: formatVoucherDateTime(fecha),
      sede: activeSede,
      direccion: sedeDireccion,
      ubicacion: sedeUbicacion,
      telefono: sedeTelefono,
      codigoSbs: sedeCodigoSbs,
      mensajePie: sedeMensajePie,
      correoContacto: sedeCorreo,
      serieNumero: fullSerieNumero,
      mes,
      beneficiario: beneficiario || 'COLABORADOR CREDIBAN',
      concepto,
      legalText: template.legalText,
      dni,
      showSignature: template.showSignatureByDefault || Boolean(dni),
      totalLabel: template.totalLabel,
      monto: numericMonto,
      gestorCaja,
    });

  const handleDownloadTicketPng = () => {
    const dataUrl = buildImageUrl();
    if (!dataUrl) return;
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${cleanSerieNumero}_${activeSede}_${(beneficiario || 'RECIBO')
      .replace(/\s+/g, '_')
      .toUpperCase()}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadTicketPdf = () => {
    const dataUrl = buildImageUrl();
    if (!dataUrl) return;
    const showSig = template.showSignatureByDefault || Boolean(dni);
    downloadVoucherPdf(
      dataUrl,
      `${cleanSerieNumero}_${activeSede}_${(beneficiario || 'RECIBO').toUpperCase()}`,
      showSig ? 980 / 680 : 800 / 680
    );
    setFeedback({
      type: 'ok',
      text: `PDF térmico ${cleanSerieNumero} (${activeSede}) descargado correctamente.`,
    });
  };

  const handlePrintTicket = () => {
    const dataUrl = buildImageUrl();
    if (!dataUrl) return;
    const showSig = template.showSignatureByDefault || Boolean(dni);
    const result = printThermalVoucher(
      dataUrl,
      `Recibo ${cleanSerieNumero} (${activeSede}) - CREDIBAN`,
      `${cleanSerieNumero}_${activeSede}_${(beneficiario || 'RECIBO').toUpperCase()}`,
      showSig ? 980 / 680 : 800 / 680
    );
    setFeedback({ type: 'ok', text: result.message });
  };

  const handleSignedPhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingSignedPhoto(true);
    setFeedback(null);
    try {
      const processed = await processInvoiceImageFile(file);
      setSignedPhoto(processed);

      if (lastEmittedRecord) {
        const updatedLocal: ExpenseRecord = {
          ...lastEmittedRecord,
          linkFotoHd: processed.hdDataUrl,
          estado: 'APROBADO · FIRMADO',
        };
        const res = await updateExpenseInBackend(
          updatedLocal,
          user,
          processed.hdBase64,
          `${lastEmittedRecord.id}_${lastEmittedRecord.numeroComprobante}_FIRMADO.jpg`
        );
        setLastEmittedRecord(res.savedRecord);
        onExpenseUpdated?.(res.savedRecord);
        setFeedback({
          type: 'ok',
          text: `Foto del voucher firmado adjuntada al recibo ${lastEmittedRecord.numeroComprobante} (${res.message}).`,
        });
      } else {
        setFeedback({
          type: 'ok',
          text: 'Foto del voucher firmado lista para enviarse al emitir y guardar el recibo.',
        });
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo procesar la fotografía firmada.',
      });
    } finally {
      setUploadingSignedPhoto(false);
      e.target.value = '';
    }
  };

  const handleEmitAndSave = async () => {
    setFeedback(null);
    if (!beneficiario.trim() || numericMonto <= 0) {
      setFeedback({
        type: 'err',
        text: 'Ingresa el nombre del beneficiario y un monto mayor a S/ 0.00.',
      });
      return;
    }

    setSaving(true);
    try {
      const generatedDataUrl = buildImageUrl();
      const uploadDataUrl = signedPhoto?.hdDataUrl || generatedDataUrl;
      const uploadBase64 =
        signedPhoto?.hdBase64 || generatedDataUrl.replace(/^data:[^;]+;base64,/, '');
      const newId = `CB-${getYearFromIsoDate(fecha)}-${String(
        Math.floor(1000 + Math.random() * 9000)
      )}`;

      const record: ExpenseRecord = {
        id: newId,
        fecha,
        anio: getYearFromIsoDate(fecha),
        mes,
        sede: activeSede,
        categoriaForms: template.categoriaForms,
        naturaleza: template.naturaleza,
        categoriaPrincipal: template.categoriaPrincipal,
        subtipo: template.subtipo,
        tipoComprobante: template.tipoComprobante,
        numeroComprobante: cleanSerieNumero,
        ruc: dni || CREDIBAN_COMPANY.ruc,
        razonSocial: beneficiario.trim().toUpperCase(),
        nombreComercial: `${template.label} - ${beneficiario.trim().toUpperCase()}`,
        subtotal: numericMonto,
        igv: 0,
        total: numericMonto,
        descripcion: `${template.headerTitle} (${cleanSerieNumero}) - ${concepto}`,
        nivelImpacto: getImpactLevel(numericMonto),
        responsable: user.usuario,
        cargoUsuario: user.cargo,
        direccionGps: `${sedeDireccion}, ${sedeUbicacion}`,
        coordenadasGps: '',
        linkMapa: '',
        linkFotoHd: uploadDataUrl,
        estado: signedPhoto ? 'APROBADO · FIRMADO' : 'APROBADO',
      };

      const res = await saveExpenseToBackend(
        record,
        uploadBase64,
        `${newId}_${cleanSerieNumero}${signedPhoto ? '_FIRMADO' : ''}.jpg`
      );
      onExpenseCreated(res.savedRecord);
      setLastEmittedRecord(res.savedRecord);
      setCorrelativoOverride('');
      setFeedback({
        type: 'ok',
        text: signedPhoto
          ? `Recibo ${cleanSerieNumero} (${activeSede}) guardado CON foto del voucher firmado.`
          : `Recibo ${cleanSerieNumero} (${activeSede}) emitido. Ahora puedes imprimirlo y subir abajo la foto firmada.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Error al emitir el recibo.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Voucher Type Collapsible Dropdown */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 no-print">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Emisor Oficial de Recibos CREDIBAN
            </h2>
            <p className="text-xs text-slate-500">
              Genera, imprime en PDF y registra recibos de movilidad, caja, comisiones, incentivos, vacaciones y liquidaciones.
            </p>
          </div>
          <div className="sm:w-72 shrink-0">
            <label htmlFor="voucher-type-select" className="block text-[11px] font-semibold text-slate-600 mb-1">
              Tipo de recibo a emitir
            </label>
            <select
              id="voucher-type-select"
              value={voucherType}
              onChange={(e) => handleSelectVoucherType(e.target.value as VoucherType)}
              className="w-full px-3 py-2 text-xs font-semibold text-slate-900 bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1B4332]/25"
            >
              {(Object.keys(VOUCHER_TEMPLATES) as VoucherType[]).map((typeKey) => {
                const tpl = VOUCHER_TEMPLATES[typeKey];
                return (
                  <option key={typeKey} value={typeKey}>
                    {tpl.label} ({tpl.serie})
                  </option>
                );
              })}
            </select>
          </div>
        </div>
      </div>

      <div
        className={
          isMobileMode
            ? 'space-y-4'
            : 'grid grid-cols-1 lg:grid-cols-12 gap-6 items-start'
        }
      >
        {/* Left: Voucher Form */}
        <div
          className={`${
            isMobileMode ? '' : 'lg:col-span-6'
          } bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-4 no-print`}
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="voucher-sede" className="block text-xs font-medium text-slate-700 mb-1">
                Sede Emisora
              </label>
              <select
                id="voucher-sede"
                value={activeSede}
                disabled={!isManager}
                onChange={(e) => {
                  setSede(e.target.value);
                  setCorrelativoOverride('');
                  setLastEmittedRecord(null);
                }}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg disabled:bg-slate-100"
              >
                {sedes.map((s) => (
                  <option key={s.nombreSede} value={s.nombreSede}>
                    {s.nombreSede}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="voucher-fecha" className="block text-xs font-medium text-slate-700 mb-1">
                Fecha
              </label>
              <input
                id="voucher-fecha"
                type="date"
                value={fecha}
                onChange={(e) => {
                  setFecha(e.target.value);
                  setMes(getMonthNameFromIsoDate(e.target.value));
                }}
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="voucher-mes" className="block text-xs font-medium text-slate-700 mb-1">
                Mes Contable
              </label>
              <select
                id="voucher-mes"
                value={mes}
                onChange={(e) => setMes(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
              >
                {MONTH_NAMES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="voucher-numero"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Correlativo ({template.serie})
              </label>
              <input
                id="voucher-numero"
                type="text"
                value={activeCorrelativo}
                onChange={(e) => setCorrelativoOverride(e.target.value)}
                placeholder={autoCorrelativo}
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="voucher-monto" className="block text-xs font-medium text-slate-700 mb-1">
                Monto a Desembolsar (S/)
              </label>
              <input
                id="voucher-monto"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={montoStr}
                onChange={(e) => setMontoStr(e.target.value)}
                placeholder="200.00"
                className="w-full px-3 py-2 text-sm font-mono font-bold bg-white border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          {/* Beneficiary Input with Live Users Autocomplete */}
          <div className="relative">
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="voucher-beneficiario" className="text-xs font-medium text-slate-700">
                Nombre Completo del Colaborador / Receptor
              </label>
              <span className="text-[11px] text-slate-500">
                {template.suggestUsersByDefault
                  ? 'Sugerencias activas desde Base de Usuarios'
                  : 'Escritura libre (escribe para buscar en base si deseas)'}
              </span>
            </div>
            <input
              id="voucher-beneficiario"
              type="text"
              value={beneficiario}
              onFocus={() => setShowSuggestions(true)}
              onChange={(e) => {
                setBeneficiario(e.target.value);
                setShowSuggestions(true);
              }}
              placeholder={
                template.suggestUsersByDefault
                  ? 'Escribe nombre o DNI para autocompletar...'
                  : 'Escribe nombre del receptor...'
              }
              className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg"
            />

            {showSuggestions && matchingUsers.length > 0 && (
              <div
                role="listbox"
                aria-label="Colaboradores coincidentes"
                className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-300 rounded-lg shadow-lg max-h-56 overflow-y-auto divide-y divide-slate-100"
              >
                {matchingUsers.map((u) => (
                  <button
                    key={u.usuario}
                    type="button"
                    onClick={() => handlePickUser(u)}
                    className="w-full px-3 py-2.5 text-left hover:bg-emerald-50 flex items-center justify-between gap-2 cursor-pointer"
                  >
                    <p className="text-xs font-bold text-slate-900">
                      {(u.nombreCompleto || u.usuario.replace(/\./g, ' ')).toUpperCase()}
                    </p>
                    {u.dni ? (
                      <span className="text-xs font-mono text-emerald-700 flex items-center gap-1 shrink-0">
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>DNI {u.dni}</span>
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="voucher-dni" className="block text-xs font-medium text-slate-700 mb-1">
                DNI del Receptor
              </label>
              <input
                id="voucher-dni"
                type="text"
                inputMode="numeric"
                maxLength={11}
                value={dni}
                onChange={(e) => setDni(e.target.value.replace(/\D/g, ''))}
                placeholder="75258722"
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label
                htmlFor="voucher-concepto"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Concepto / Motivo
              </label>
              <input
                id="voucher-concepto"
                type="text"
                value={concepto}
                onChange={(e) => setConcepto(e.target.value)}
                placeholder="INCENTIVO / MOVILIDAD..."
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          {feedback && (
            <div
              role="status"
              className={`p-3 rounded-lg border text-xs font-medium flex items-center gap-2 ${
                feedback.type === 'ok'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{feedback.text}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200">
            <button
              type="button"
              disabled={saving}
              onClick={handleEmitAndSave}
              className="flex-1 sm:flex-none px-4 py-2.5 bg-[#1B4332] hover:bg-[#0f291e] disabled:opacity-60 text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {saving ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              <span>{saving ? 'Registrando...' : 'Emitir y Guardar en Servidor'}</span>
            </button>
            <button
              type="button"
              onClick={handlePrintTicket}
              className="px-3.5 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>Imprimir</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadTicketPdf}
              className="px-3.5 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <FileText className="w-4 h-4 text-red-600" />
              <span>Descargar PDF</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadTicketPng}
              className="px-3.5 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Imagen JPG</span>
            </button>
          </div>

          {/* Signed Physical Voucher Photo Capture / Post-Print Upload */}
          <div className="p-3.5 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/50 space-y-2.5">
            <input
              id="voucher-signed-camera-input"
              ref={signedCameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleSignedPhotoSelected}
              className="sr-only"
            />
            <input
              id="voucher-signed-gallery-input"
              ref={signedGalleryInputRef}
              type="file"
              accept="image/*"
              onChange={handleSignedPhotoSelected}
              className="sr-only"
            />

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileCheck2 className="w-4 h-4 text-[#1B4332] shrink-0" />
                <div>
                  <p className="text-xs font-bold text-slate-900">
                    {lastEmittedRecord
                      ? `¿Ya firmaron el recibo ${lastEmittedRecord.numeroComprobante}? Sube la foto firmada`
                      : 'Foto del Voucher Firmado (Opcional / Post-Impresión)'}
                  </p>
                  <p className="text-[11px] text-slate-600">
                    {lastEmittedRecord
                      ? 'La fotografía HD firmada se adjuntará automáticamente a este recibo en el Servidor.'
                      : 'Imprime el recibo, hazlo firmar y luego fotografía el voucher firmado desde aquí.'}
                  </p>
                </div>
              </div>
              {lastEmittedRecord && (
                <button
                  type="button"
                  onClick={() => {
                    setLastEmittedRecord(null);
                    setSignedPhoto(null);
                    setBeneficiario('');
                    setDni('');
                    setMontoStr('');
                    setFeedback(null);
                  }}
                  className="text-[11px] font-semibold text-[#1B4332] hover:underline cursor-pointer"
                >
                  + Nuevo recibo
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label
                htmlFor={uploadingSignedPhoto ? undefined : 'voucher-signed-camera-input'}
                className={`px-3 py-2 bg-[#1B4332] hover:bg-[#0f291e] text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 select-none ${
                  uploadingSignedPhoto ? 'opacity-60 pointer-events-none' : 'cursor-pointer'
                }`}
              >
                <Camera className="w-3.5 h-3.5" />
                <span>
                  {uploadingSignedPhoto ? 'Procesando...' : 'Fotografiar Voucher Firmado'}
                </span>
              </label>
              <label
                htmlFor={uploadingSignedPhoto ? undefined : 'voucher-signed-gallery-input'}
                className={`px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 select-none ${
                  uploadingSignedPhoto ? 'opacity-60 pointer-events-none' : 'cursor-pointer'
                }`}
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Subir Foto Firmada</span>
              </label>
              {signedPhoto && !lastEmittedRecord && (
                <button
                  type="button"
                  onClick={() => setSignedPhoto(null)}
                  className="px-2.5 py-2 text-xs text-red-700 hover:bg-red-50 rounded-lg inline-flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Quitar</span>
                </button>
              )}
            </div>

            {signedPhoto && (
              <div className="flex items-center gap-3 pt-1">
                <img
                  src={signedPhoto.hdDataUrl}
                  alt="Voucher firmado adjunto"
                  className="w-16 h-16 object-cover rounded-lg border border-emerald-300 bg-white"
                />
                <div className="text-[11px] text-emerald-900">
                  <p className="font-bold">Foto HD del voucher firmado lista</p>
                  <p className="font-mono text-emerald-700">
                    {signedPhoto.width}×{signedPhoto.height}px
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Exact Thermal Receipt Preview matching CREDIBAN Models */}
        <div className={isMobileMode ? '' : 'lg:col-span-6'}>
          <div className="bg-slate-200/70 rounded-xl p-4 flex justify-center">
            <div
              ref={ticketRef}
              className="w-full max-w-[380px] bg-white text-slate-900 border border-slate-300 shadow-sm p-5 font-sans text-xs"
            >
              {/* Header */}
              <div className="flex items-center justify-between gap-2 pb-2 border-b-4 border-double border-slate-800">
                <div className="flex items-center gap-2">
                  <svg viewBox="0 0 180 240" className="w-7 h-7 shrink-0" aria-hidden="true">
                    <g fill="#0f172a">
                      <rect x="90" y="8" width="24" height="13" rx="6.5" />
                      <rect x="71" y="31" width="61" height="13" rx="6.5" />
                      <rect x="50" y="55" width="74" height="13" rx="6.5" />
                      <rect x="31" y="79" width="75" height="13" rx="6.5" />
                      <rect x="24" y="103" width="63" height="13" rx="6.5" />
                      <rect x="37" y="128" width="24" height="13" rx="6.5" />
                      <path d="M143 55 C141 78 130 95 111 107 C96 117 81 122 72 134 C62 147 63 166 70 181 C76 195 87 208 97 216 C107 201 118 189 131 177 C144 166 157 156 164 141 C173 123 173 104 168 89 C164 74 156 62 143 55 Z" />
                    </g>
                  </svg>
                  <span style={{ fontFamily: 'Georgia, serif' }} className="text-lg font-bold tracking-wide">
                    CREDIBAN
                  </span>
                </div>
                <span className="text-xs font-bold text-right leading-tight">
                  {template.headerTitle}
                </span>
              </div>

              {/* Company Meta */}
              <div className="py-2 text-center space-y-0.5">
                <div className="flex justify-between font-bold text-sm font-mono tabular-nums">
                  <span>{CREDIBAN_COMPANY.ruc}</span>
                  <span>{formatVoucherDateTime(fecha)}</span>
                </div>
                <div className="flex justify-between gap-2 text-[11px] uppercase">
                  <span className="text-left">{sedeDireccion}</span>
                  <span className="text-right">{sedeUbicacion}</span>
                </div>
                {sedeTelefono && (
                  <p className="text-[10px] font-mono">TELF: {sedeTelefono}</p>
                )}
                <p className="text-[10px] tracking-tight pt-0.5">{sedeCodigoSbs}</p>
              </div>

              {/* Serie + Month */}
              <div className="flex items-center justify-between py-1.5 border-b border-dashed border-slate-500 font-bold">
                <span className="text-sm font-mono">RECIBO {fullSerieNumero}</span>
                <span className="text-sm">{mes}</span>
              </div>

              {/* Recipient */}
              <div className="py-2 text-center border-b-4 border-double border-slate-800">
                <p className="text-sm font-bold tracking-wide">
                  {(beneficiario || 'NOMBRE DEL RECEPTOR').toUpperCase()}
                </p>
              </div>

              {/* Legal Text + Concept + Signature */}
              <div className="py-4 min-h-[200px] flex flex-col justify-between space-y-4">
                {template.legalText && (
                  <p className="text-[11px] leading-relaxed font-medium">
                    {template.legalText}
                  </p>
                )}

                {concepto && (
                  <p className="text-sm font-bold text-center uppercase tracking-wide py-2">
                    {concepto}
                  </p>
                )}

                {(template.showSignatureByDefault || dni) && (
                  <div className="pt-8 space-y-4">
                    <div className="flex items-end gap-2">
                      <span className="font-bold">FIRMA :</span>
                      <div className="flex-1 border-b border-slate-800" />
                    </div>
                    <div className="flex items-end gap-3">
                      <span className="font-bold">DNI:</span>
                      <span className="font-mono font-bold text-sm">{dni || '________'}</span>
                      <div className="flex-1 border-b border-slate-800" />
                    </div>
                  </div>
                )}
              </div>

              {/* Total */}
              <div className="py-2 border-t border-dashed border-slate-500 border-b-4 border-double border-b-slate-800 flex items-center justify-end gap-4">
                <span className="font-semibold">{template.totalLabel}</span>
                <span className="text-base font-bold font-mono tabular-nums">
                  S/ {numericMonto.toFixed(2)}
                </span>
              </div>

              {/* Footer */}
              <div className="pt-2 text-center space-y-1">
                <p className="text-[11px] font-bold">
                  GESTOR DE CAJA: {gestorCaja}
                </p>
                <div className="border-t border-dashed border-slate-400 pt-1.5">
                  <p className="italic font-bold text-[11px]">{sedeMensajePie}</p>
                  <p className="text-[10px] text-slate-600">
                    SI TIENE ALGUNA DUDA PONGASE EN CONTACTO CON :
                  </p>
                  <p className="text-[10px] text-blue-700 underline">{sedeCorreo}</p>
                </div>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 text-center mt-2 flex items-center justify-center gap-1 no-print">
            <Receipt className="w-3.5 h-3.5" />
            <span>Vista previa exacta de impresión térmica 80mm / comprobante oficial</span>
          </p>
        </div>
      </div>
    </div>
  );
};
