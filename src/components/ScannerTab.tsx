import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Upload,
  Sparkles,
  FolderOpen,
  AlertTriangle,
  CheckCircle2,
  Save,
  RefreshCw,
  Crop,
  RotateCw,
  SlidersHorizontal,
  Check,
} from 'lucide-react';
import {
  MONTH_NAMES,
  OFFICIAL_CATEGORIES,
  type ExpenseCriterion,
  type ExpenseRecord,
  type NaturalezaGasto,
  type SedeRecord,
  type TipoComprobante,
  type UserSession,
} from '../types/crediban';
import {
  buildStandardPhotoFilename,
  calculateIgvBreakdown,
  detectDuplicateExpense,
  formatCurrencySoles,
  getImpactLevel,
  getMonthNameFromIsoDate,
  getYearFromIsoDate,
  isManagerUser,
} from '../utils/accounting';
import {
  DEFAULT_IMAGE_EDITS,
  processEditedInvoiceImage,
  processInvoiceImageFile,
  saveHdPhotoLocally,
  type DirectoryHandleLike,
  type ImageEditSettings,
  type ImageFilterMode,
  type ProcessedInvoiceImages,
} from '../utils/imageProcessor';
import { saveExpenseToBackend, scanInvoiceWithGeminiApi } from '../services/credibanApi';

interface ScannerTabProps {
  user: UserSession;
  sedes: SedeRecord[];
  criteria: ExpenseCriterion[];
  existingExpenses: ExpenseRecord[];
  isMobileMode?: boolean;
  onExpenseCreated: (record: ExpenseRecord) => void;
}

export const ScannerTab: React.FC<ScannerTabProps> = ({
  user,
  sedes,
  criteria,
  existingExpenses,
  isMobileMode = false,
  onExpenseCreated,
}) => {
  const isManager = isManagerUser(user);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const todayIso = new Date().toISOString().slice(0, 10);

  // Image, Editor & Folder state
  const [images, setImages] = useState<ProcessedInvoiceImages | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [edits, setEdits] = useState<ImageEditSettings>(DEFAULT_IMAGE_EDITS);
  const [applyingEdit, setApplyingEdit] = useState(false);
  const [dirHandle, setDirHandle] = useState<DirectoryHandleLike | null>(null);
  const [scanningAi, setScanningAi] = useState(false);
  const [aiMessage, setAiMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [aiScore, setAiScore] = useState<number | null>(null);

  // Editable preliminary form state
  const [sede, setSede] = useState<string>(
    isManager ? sedes[0]?.nombreSede || 'HUACHO' : user.sede || 'HUACHO'
  );
  const [tipoComprobante, setTipoComprobante] = useState<TipoComprobante>('FACTURA');
  const [numeroComprobante, setNumeroComprobante] = useState('');
  const [fechaEmision, setFechaEmision] = useState(todayIso);
  const [anio, setAnio] = useState(getYearFromIsoDate(todayIso));
  const [mes, setMes] = useState(getMonthNameFromIsoDate(todayIso));
  const [ruc, setRuc] = useState('');
  const [razonSocial, setRazonSocial] = useState('');
  const [nombreComercial, setNombreComercial] = useState('');
  const [totalStr, setTotalStr] = useState('');
  const [subtotalStr, setSubtotalStr] = useState('');
  const [igvStr, setIgvStr] = useState('');
  const [categoriaForms, setCategoriaForms] = useState<string>(OFFICIAL_CATEGORIES[0]);
  const [naturaleza, setNaturaleza] = useState<NaturalezaGasto>('Costo Variable');
  const [categoriaPrincipal, setCategoriaPrincipal] = useState<string>('');
  const [subtipo, setSubtipo] = useState<string>('');
  const [descripcion, setDescripcion] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  // Filter criteria options dynamically by selected naturaleza
  const criteriaForNature = useMemo(
    () => criteria.filter((c) => c.naturaleza === naturaleza && c.estado !== 'INACTIVO'),
    [criteria, naturaleza]
  );

  const principalCategories = useMemo(
    () => Array.from(new Set(criteriaForNature.map((c) => c.categoriaPrincipal))),
    [criteriaForNature]
  );

  const subtiposForPrincipal = useMemo(
    () =>
      criteriaForNature
        .filter((c) => !categoriaPrincipal || c.categoriaPrincipal === categoriaPrincipal)
        .map((c) => c.subtipo),
    [criteriaForNature, categoriaPrincipal]
  );

  useEffect(() => {
    if (principalCategories.length > 0 && !principalCategories.includes(categoriaPrincipal)) {
      const nextPrincipal = principalCategories[0];
      setCategoriaPrincipal(nextPrincipal);
      const nextSub =
        criteriaForNature.find((c) => c.categoriaPrincipal === nextPrincipal)?.subtipo || '';
      setSubtipo(nextSub);
    }
  }, [principalCategories, categoriaPrincipal, criteriaForNature]);

  // Auto-recalculate IGV when Total or Tipo changes
  const handleTotalOrTipoChange = (nextTotalStr: string, nextTipo: TipoComprobante) => {
    setTotalStr(nextTotalStr);
    setTipoComprobante(nextTipo);
    const numeric = parseFloat(nextTotalStr);
    if (!Number.isNaN(numeric) && numeric >= 0) {
      const breakdown = calculateIgvBreakdown(numeric, nextTipo);
      setSubtotalStr(breakdown.subtotal.toFixed(2));
      setIgvStr(breakdown.igv.toFixed(2));
    } else {
      setSubtotalStr('');
      setIgvStr('');
    }
  };

  // Auto-fill Razon Social & Nombre Comercial if RUC exists in history
  const handleRucChange = (nextRuc: string) => {
    const clean = nextRuc.replace(/\D/g, '').slice(0, 11);
    setRuc(clean);
    if (clean.length === 8 || clean.length === 11) {
      const match = existingExpenses.find((e) => e.ruc === clean);
      if (match) {
        if (!razonSocial) setRazonSocial(match.razonSocial);
        if (!nombreComercial) setNombreComercial(match.nombreComercial);
      }
    }
  };

  const duplicateMatch = useMemo(
    () => detectDuplicateExpense(existingExpenses, ruc, numeroComprobante),
    [existingExpenses, ruc, numeroComprobante]
  );

  const numericTotal = parseFloat(totalStr) || 0;
  const impactLevel = getImpactLevel(numericTotal);

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAiMessage(null);
    setSaveFeedback(null);
    setEdits(DEFAULT_IMAGE_EDITS);
    try {
      const processed = await processInvoiceImageFile(file);
      setImages(processed);
      setShowEditor(true); // Immediately allow cropping/filters even while AI analyzes
      await runGeminiAnalysis(processed.iaBase64, processed.iaDataUrl);
    } catch (err) {
      setAiMessage({
        type: 'err',
        text: err instanceof Error ? err.message : 'Error procesando imagen.',
      });
    } finally {
      e.target.value = '';
    }
  };

  const runGeminiAnalysis = async (base64ToScan?: string, dataUrlToScan?: string) => {
    const targetBase64 = base64ToScan || images?.iaBase64;
    const targetDataUrl = dataUrlToScan || images?.iaDataUrl;
    if (!targetBase64) return;
    setScanningAi(true);
    setAiMessage(null);

    try {
      const { result, engine } = await scanInvoiceWithGeminiApi({
        imageBase64: targetBase64,
        imageDataUrl: targetDataUrl,
        mimeType: 'image/jpeg',
        criteria,
      });

      const nextTipo = (result.tipoComprobante || 'FACTURA') as TipoComprobante;
      setTipoComprobante(nextTipo);
      if (result.numeroComprobante) setNumeroComprobante(result.numeroComprobante);
      if (result.fechaEmision) {
        setFechaEmision(result.fechaEmision);
        setAnio(getYearFromIsoDate(result.fechaEmision));
        setMes(getMonthNameFromIsoDate(result.fechaEmision));
      }
      if (result.ruc) setRuc(result.ruc.replace(/\D/g, ''));
      if (result.razonSocial) setRazonSocial(result.razonSocial);
      if (result.nombreComercial) setNombreComercial(result.nombreComercial);
      if (result.total > 0) {
        setTotalStr(result.total.toFixed(2));
        setSubtotalStr(result.subtotal.toFixed(2));
        setIgvStr(result.igv.toFixed(2));
      }
      if (result.naturaleza) setNaturaleza(result.naturaleza);
      if (result.categoria) setCategoriaForms(result.categoria);
      if (result.subtipo) setSubtipo(result.subtipo);
      if (result.descripcion) setDescripcion(result.descripcion);
      setAiScore(result.scoreConfiabilidad ?? null);

      setAiMessage({
        type: 'ok',
        text:
          engine === 'gemini'
            ? `Lectura IA completada (confiabilidad ${Math.round(
                (result.scoreConfiabilidad || 0.85) * 100
              )}%). Verifica los campos antes de guardar.`
            : `Lectura OCR gratuita completada (${Math.round(
                (result.scoreConfiabilidad || 0.7) * 100
              )}%). Verifica los campos o aplica filtro Blanco y Negro y re-escanea si deseas mayor nitidez.`,
      });
    } catch (err) {
      setAiMessage({
        type: 'err',
        text:
          err instanceof Error
            ? err.message
            : 'No se pudo leer automáticamente. Completa el formulario preliminar manualmente.',
      });
    } finally {
      setScanningAi(false);
    }
  };

  const handleApplyImageEdits = async (andRescan = false) => {
    if (!images?.originalDataUrl) return;
    setApplyingEdit(true);
    try {
      const updated = await processEditedInvoiceImage(images.originalDataUrl, edits);
      setImages(updated);
      if (andRescan) {
        await runGeminiAnalysis(updated.iaBase64, updated.iaDataUrl);
      }
    } finally {
      setApplyingEdit(false);
    }
  };

  const handleSelectDirectory = async () => {
    const picker = (
      window as unknown as { showDirectoryPicker?: () => Promise<DirectoryHandleLike> }
    ).showDirectoryPicker;
    if (!picker) {
      setAiMessage({
        type: 'err',
        text: 'Tu navegador descargará las fotos HD automáticamente en tu dispositivo.',
      });
      return;
    }
    try {
      const handle = await picker();
      setDirHandle(handle);
    } catch {
      // cancelled
    }
  };

  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveFeedback(null);

    if (!razonSocial.trim() || numericTotal <= 0) {
      setSaveFeedback({
        type: 'err',
        text: 'Completa la Razón Social y un Monto Total mayor a S/ 0.00.',
      });
      return;
    }

    setSaving(true);
    try {
      const newId = `CB-${anio}-${String(Math.floor(1000 + Math.random() * 9000))}`;
      const filename = buildStandardPhotoFilename(
        newId,
        tipoComprobante,
        numeroComprobante || 'SN',
        ruc || '00000000000',
        fechaEmision
      );

      let localSavedVia: string | null = null;
      if (images?.hdDataUrl) {
        localSavedVia = await saveHdPhotoLocally(images.hdDataUrl, filename, dirHandle);
      }

      const subtotal = parseFloat(subtotalStr) || 0;
      const igv = parseFloat(igvStr) || 0;

      const record: ExpenseRecord = {
        id: newId,
        fecha: fechaEmision,
        anio,
        mes,
        sede: isManager ? sede : user.sede,
        categoriaForms,
        naturaleza,
        categoriaPrincipal: categoriaPrincipal || categoriaForms,
        subtipo: subtipo || 'General',
        tipoComprobante,
        numeroComprobante: numeroComprobante.trim().toUpperCase(),
        ruc: ruc.trim(),
        razonSocial: razonSocial.trim(),
        nombreComercial: (nombreComercial || razonSocial).trim(),
        subtotal,
        igv,
        total: numericTotal,
        descripcion: descripcion.trim() || `${categoriaForms} - ${razonSocial.trim()}`,
        nivelImpacto: impactLevel,
        responsable: user.usuario,
        cargoUsuario: user.cargo,
        direccionGps: '',
        coordenadasGps: '',
        linkMapa: '',
        linkFotoHd: images?.hdDataUrl || '',
        estado: 'APROBADO',
      };

      const res = await saveExpenseToBackend(record, images?.hdBase64, filename);
      onExpenseCreated(res.savedRecord);

      setSaveFeedback({
        type: 'ok',
        text: `${res.message || 'Comprobante registrado.'}${
          localSavedVia
            ? ` Foto HD guardada (${
                localSavedVia === 'folder' ? 'carpeta local' : 'descarga'
              }) como ${filename}.`
            : ''
        }`,
      });

      setImages(null);
      setShowEditor(false);
      setEdits(DEFAULT_IMAGE_EDITS);
      setNumeroComprobante('');
      setRuc('');
      setRazonSocial('');
      setNombreComercial('');
      setTotalStr('');
      setSubtotalStr('');
      setIgvStr('');
      setDescripcion('');
      setAiScore(null);
    } catch (err) {
      setSaveFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Error al guardar el comprobante.',
      });
    } finally {
      setSaving(false);
    }
  };

  // Live CSS preview filter string inside editor before baking into Canvas
  const liveCssFilter = useMemo(() => {
    const brightnessPct = edits.brightness;
    const contrastPct =
      edits.filterMode === 'high-contrast'
        ? Math.max(edits.contrast, 145)
        : edits.filterMode === 'bw'
        ? Math.max(edits.contrast, 165)
        : edits.contrast;
    const gray =
      edits.filterMode === 'bw' || edits.filterMode === 'grayscale' ? 'grayscale(100%)' : '';
    return `brightness(${brightnessPct}%) contrast(${contrastPct}%) ${gray}`.trim();
  }, [edits]);

  return (
    <div
      className={
        isMobileMode
          ? 'space-y-4'
          : 'grid grid-cols-1 lg:grid-cols-12 gap-6 items-start'
      }
    >
      {/* Left Column: Capture + Interactive Photo Editor (Crop & Filters) */}
      <div className={isMobileMode ? 'space-y-4' : 'lg:col-span-5 space-y-5'}>
        <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                1. Captura y Mejora de Foto HD
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Recorta y mejora contraste mientras se lee el comprobante.
              </p>
            </div>
            <button
              type="button"
              onClick={handleSelectDirectory}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>{dirHandle ? dirHandle.name : 'Carpeta'}</span>
            </button>
          </div>

          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileSelected}
            className="hidden"
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelected}
            className="hidden"
          />

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="py-3 px-4 bg-[#1B4332] hover:bg-[#0f291e] text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Camera className="w-4 h-4" />
              <span>Cámara en Vivo</span>
            </button>
            <button
              type="button"
              onClick={() => galleryInputRef.current?.click()}
              className="py-3 px-4 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>Subir de Galería</span>
            </button>
          </div>

          {/* Preview + Live Interactive Editor */}
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 overflow-hidden">
            {images ? (
              <div>
                <div className="relative bg-slate-900/5 flex items-center justify-center overflow-hidden p-2">
                  <div className="relative inline-block max-w-full">
                    <img
                      src={showEditor ? images.originalDataUrl : images.hdDataUrl}
                      alt="Vista previa de comprobante"
                      style={
                        showEditor
                          ? {
                              filter: liveCssFilter,
                              transform: `rotate(${edits.rotation}deg)`,
                            }
                          : undefined
                      }
                      className="max-h-72 w-auto object-contain mx-auto transition-transform"
                    />
                    {/* Visual Crop Overlay when Editor is open */}
                    {showEditor &&
                      (edits.crop.left > 0 ||
                        edits.crop.right > 0 ||
                        edits.crop.top > 0 ||
                        edits.crop.bottom > 0) && (
                        <div
                          aria-hidden="true"
                          style={{
                            left: `${edits.crop.left * 100}%`,
                            right: `${edits.crop.right * 100}%`,
                            top: `${edits.crop.top * 100}%`,
                            bottom: `${edits.crop.bottom * 100}%`,
                          }}
                          className="absolute border-2 border-[#59B447] bg-[#59B447]/10 pointer-events-none"
                        />
                      )}
                  </div>
                </div>

                {/* Action Bar under photo */}
                <div className="p-3 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-slate-600 font-mono tabular-nums">
                    HD {images.width}×{images.height}px
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowEditor((prev) => !prev)}
                      className={`px-2.5 py-1.5 text-xs font-semibold rounded-md flex items-center gap-1 cursor-pointer ${
                        showEditor
                          ? 'bg-slate-800 text-white'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                      }`}
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      <span>{showEditor ? 'Ocultar Editor' : 'Recortar / Filtros'}</span>
                    </button>
                    <button
                      type="button"
                      disabled={scanningAi}
                      onClick={() => runGeminiAnalysis()}
                      className="px-3 py-1.5 bg-[#59B447] hover:bg-[#4ca13b] disabled:opacity-60 text-white text-xs font-semibold rounded-md flex items-center gap-1.5 cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>{scanningAi ? 'Leyendo...' : 'Re-escanear'}</span>
                    </button>
                  </div>
                </div>

                {/* Interactive Photo Editor Controls (Works simultaneously while AI reads) */}
                {showEditor && (
                  <div className="p-3.5 bg-slate-50 border-t border-slate-200 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <Crop className="w-3.5 h-3.5 text-[#59B447]" />
                        <span>Editor de Calidad HD</span>
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setEdits((prev) => ({
                            ...prev,
                            rotation: ((prev.rotation + 90) % 360) as 0 | 90 | 180 | 270,
                          }))
                        }
                        className="px-2.5 py-1 text-xs font-medium bg-white border border-slate-300 hover:bg-slate-100 rounded-md flex items-center gap-1 cursor-pointer"
                      >
                        <RotateCw className="w-3 h-3" />
                        <span>Rotar 90°</span>
                      </button>
                    </div>

                    {/* Filter Presets */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                      {(
                        [
                          ['original', 'Original'],
                          ['bw', 'B/N Escáner'],
                          ['high-contrast', 'Contraste +'],
                          ['grayscale', 'Grises'],
                        ] as Array<[ImageFilterMode, string]>
                      ).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setEdits((prev) => ({ ...prev, filterMode: mode }))}
                          className={`py-2 px-2.5 text-xs font-semibold rounded-md border whitespace-nowrap cursor-pointer ${
                            edits.filterMode === mode
                              ? 'bg-[#1B4332] text-white border-[#1B4332]'
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {/* Contrast & Brightness Sliders */}
                    <div className="grid grid-cols-2 gap-3 text-[11px]">
                      <label className="block">
                        <span className="text-slate-600 font-medium">
                          Contraste ({edits.contrast}%)
                        </span>
                        <input
                          type="range"
                          min={60}
                          max={200}
                          value={edits.contrast}
                          onChange={(e) =>
                            setEdits((prev) => ({ ...prev, contrast: Number(e.target.value) }))
                          }
                          className="w-full accent-[#1B4332]"
                        />
                      </label>
                      <label className="block">
                        <span className="text-slate-600 font-medium">
                          Brillo ({edits.brightness}%)
                        </span>
                        <input
                          type="range"
                          min={60}
                          max={150}
                          value={edits.brightness}
                          onChange={(e) =>
                            setEdits((prev) => ({ ...prev, brightness: Number(e.target.value) }))
                          }
                          className="w-full accent-[#1B4332]"
                        />
                      </label>
                    </div>

                    {/* Crop Sliders */}
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                      <label className="block">
                        <span className="text-slate-600">
                          Recorte Izq. ({Math.round(edits.crop.left * 100)}%)
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={40}
                          value={Math.round(edits.crop.left * 100)}
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              crop: { ...prev.crop, left: Number(e.target.value) / 100 },
                            }))
                          }
                          className="w-full accent-[#59B447]"
                        />
                      </label>
                      <label className="block">
                        <span className="text-slate-600">
                          Recorte Der. ({Math.round(edits.crop.right * 100)}%)
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={40}
                          value={Math.round(edits.crop.right * 100)}
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              crop: { ...prev.crop, right: Number(e.target.value) / 100 },
                            }))
                          }
                          className="w-full accent-[#59B447]"
                        />
                      </label>
                      <label className="block">
                        <span className="text-slate-600">
                          Recorte Sup. ({Math.round(edits.crop.top * 100)}%)
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={40}
                          value={Math.round(edits.crop.top * 100)}
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              crop: { ...prev.crop, top: Number(e.target.value) / 100 },
                            }))
                          }
                          className="w-full accent-[#59B447]"
                        />
                      </label>
                      <label className="block">
                        <span className="text-slate-600">
                          Recorte Inf. ({Math.round(edits.crop.bottom * 100)}%)
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={40}
                          value={Math.round(edits.crop.bottom * 100)}
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              crop: { ...prev.crop, bottom: Number(e.target.value) / 100 },
                            }))
                          }
                          className="w-full accent-[#59B447]"
                        />
                      </label>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setEdits(DEFAULT_IMAGE_EDITS)}
                        className="px-2.5 py-1.5 text-xs text-slate-600 hover:text-slate-900 cursor-pointer"
                      >
                        Restablecer
                      </button>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={applyingEdit}
                          onClick={() => handleApplyImageEdits(false)}
                          className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 text-xs font-semibold rounded-md flex items-center gap-1 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5 text-[#59B447]" />
                          <span>Aplicar a Foto HD</span>
                        </button>
                        <button
                          type="button"
                          disabled={applyingEdit || scanningAi}
                          onClick={() => handleApplyImageEdits(true)}
                          className="px-3 py-1.5 bg-[#1B4332] hover:bg-[#0f291e] text-white text-xs font-semibold rounded-md cursor-pointer"
                        >
                          Aplicar y Re-leer
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-10 px-6 text-center">
                <Camera className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-sm font-medium text-slate-700">
                  Sube o fotografía una factura, boleta o ticket
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Podrás recortar y ajustar blanco y negro o contraste para guardarla nítida en HD.
                </p>
              </div>
            )}
          </div>

          {aiMessage && (
            <div
              role="status"
              className={`mt-3 p-3 rounded-lg border text-xs font-medium flex items-start gap-2 ${
                aiMessage.type === 'ok'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}
            >
              {aiMessage.type === 'ok' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
              )}
              <span>{aiMessage.text}</span>
            </div>
          )}
        </div>
      </div>

      {/* Right Column: Editable Preliminary Accounting Form */}
      <form
        onSubmit={handleSaveExpense}
        className={`${
          isMobileMode ? '' : 'lg:col-span-7'
        } bg-white rounded-xl border border-slate-200 p-4 sm:p-6 space-y-4`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              2. Formulario Preliminar Editable
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Verifica o corrige los campos antes de registrar en el Servidor.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-600">
            {aiScore !== null && (
              <span className="font-mono tabular-nums">
                Lectura: {(aiScore * 100).toFixed(0)}%
              </span>
            )}
            <span
              className={`font-semibold ${
                impactLevel === 'Fuerte'
                  ? 'text-red-700'
                  : impactLevel === 'Medio'
                  ? 'text-amber-700'
                  : 'text-emerald-700'
              }`}
            >
              Impacto {impactLevel}
            </span>
          </div>
        </div>

        {duplicateMatch && (
          <div
            role="alert"
            className="p-3.5 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-red-800"
          >
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Alerta Anti-Duplicados Detectada</p>
              <p className="mt-0.5">
                Ya existe el comprobante{' '}
                <strong className="font-mono">{duplicateMatch.numeroComprobante}</strong> del RUC{' '}
                <strong className="font-mono">{duplicateMatch.ruc}</strong> registrado el{' '}
                {duplicateMatch.fecha} por{' '}
                <strong>{formatCurrencySoles(duplicateMatch.total)}</strong> ({duplicateMatch.sede}).
              </p>
            </div>
          </div>
        )}

        {/* Row 1: Sede, Año, Periodo */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          <div>
            <label htmlFor="form-sede" className="block text-xs font-medium text-slate-700 mb-1">
              Filial / Sede
            </label>
            <select
              id="form-sede"
              value={isManager ? sede : user.sede}
              disabled={!isManager}
              onChange={(e) => setSede(e.target.value)}
              className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg disabled:bg-slate-100"
            >
              {sedes.map((s) => (
                <option key={s.nombreSede} value={s.nombreSede}>
                  {s.nombreSede}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="form-anio" className="block text-xs font-medium text-slate-700 mb-1">
              Año Contable
            </label>
            <input
              id="form-anio"
              type="text"
              value={anio}
              onChange={(e) => setAnio(e.target.value)}
              className="w-full px-3 py-2.5 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label htmlFor="form-mes" className="block text-xs font-medium text-slate-700 mb-1">
              Periodo de Registro
            </label>
            <select
              id="form-mes"
              value={mes}
              onChange={(e) => setMes(e.target.value)}
              className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg"
            >
              {MONTH_NAMES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Row 2: Tipo, Serie-Numero, Fecha Emision */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          <div>
            <label htmlFor="form-tipo" className="block text-xs font-medium text-slate-700 mb-1">
              Tipo de Comprobante
            </label>
            <select
              id="form-tipo"
              value={tipoComprobante}
              onChange={(e) =>
                handleTotalOrTipoChange(totalStr, e.target.value as TipoComprobante)
              }
              className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg"
            >
              <option value="FACTURA">FACTURA</option>
              <option value="BOLETA">BOLETA</option>
              <option value="TICKET DE VENTA">TICKET DE VENTA</option>
              <option value="RECIBO DE CAJA">RECIBO DE CAJA</option>
              <option value="SOLO CAPTURA">SOLO CAPTURA</option>
            </select>
          </div>
          <div>
            <label htmlFor="form-numero" className="block text-xs font-medium text-slate-700 mb-1">
              Serie y Correlativo
            </label>
            <input
              id="form-numero"
              type="text"
              value={numeroComprobante}
              onChange={(e) => setNumeroComprobante(e.target.value)}
              placeholder="F001-000456"
              className="w-full px-3 py-2.5 text-sm font-mono bg-white border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label htmlFor="form-fecha" className="block text-xs font-medium text-slate-700 mb-1">
              Fecha de Emisión
            </label>
            <input
              id="form-fecha"
              type="date"
              value={fechaEmision}
              onChange={(e) => {
                setFechaEmision(e.target.value);
                setAnio(getYearFromIsoDate(e.target.value));
                setMes(getMonthNameFromIsoDate(e.target.value));
              }}
              className="w-full px-3 py-2.5 text-sm font-mono bg-white border border-slate-300 rounded-lg"
            />
          </div>
        </div>

        {/* Row 3: RUC, Razon Social, Nombre Comercial */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5">
          <div className="sm:col-span-4">
            <label htmlFor="form-ruc" className="block text-xs font-medium text-slate-700 mb-1">
              RUC / DNI Emisor
            </label>
            <input
              id="form-ruc"
              type="text"
              inputMode="numeric"
              value={ruc}
              onChange={(e) => handleRucChange(e.target.value)}
              placeholder="20100017491"
              maxLength={11}
              className="w-full px-3 py-2.5 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
            />
          </div>
          <div className="sm:col-span-4">
            <label htmlFor="form-razon" className="block text-xs font-medium text-slate-700 mb-1">
              Razón Social (Legal)
            </label>
            <input
              id="form-razon"
              type="text"
              required
              value={razonSocial}
              onChange={(e) => setRazonSocial(e.target.value)}
              placeholder="PLUZ ENERGIA PERU S.A.A."
              className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg"
            />
          </div>
          <div className="sm:col-span-4">
            <label
              htmlFor="form-comercial"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Nombre Comercial / Alias
            </label>
            <input
              id="form-comercial"
              type="text"
              value={nombreComercial}
              onChange={(e) => setNombreComercial(e.target.value)}
              placeholder="Pluz Energía Luz"
              className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg"
            />
          </div>
        </div>

        {/* Row 4: Montos (Total, Subtotal, IGV 18%) */}
        <div className="grid grid-cols-3 gap-3 p-3.5 bg-slate-50 rounded-xl border border-slate-200">
          <div>
            <label htmlFor="form-total" className="block text-xs font-semibold text-slate-800 mb-1">
              Total (S/)
            </label>
            <input
              id="form-total"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              required
              value={totalStr}
              onChange={(e) => handleTotalOrTipoChange(e.target.value, tipoComprobante)}
              placeholder="0.00"
              className="w-full px-2.5 py-2 text-sm font-mono font-bold tabular-nums bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#59B447]/30 focus:border-[#59B447]"
            />
          </div>
          <div>
            <label htmlFor="form-subtotal" className="block text-xs font-medium text-slate-600 mb-1">
              Subtotal
            </label>
            <input
              id="form-subtotal"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={subtotalStr}
              onChange={(e) => setSubtotalStr(e.target.value)}
              placeholder="0.00"
              className="w-full px-2.5 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label htmlFor="form-igv" className="block text-xs font-medium text-slate-600 mb-1">
              IGV 18%
            </label>
            <input
              id="form-igv"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={igvStr}
              onChange={(e) => setIgvStr(e.target.value)}
              placeholder="0.00"
              className="w-full px-2.5 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
            />
          </div>
        </div>

        {/* Row 5: Clasificacion Contable */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label
              htmlFor="form-cat-forms"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Categoría Oficial (19 opciones)
            </label>
            <select
              id="form-cat-forms"
              value={categoriaForms}
              onChange={(e) => setCategoriaForms(e.target.value)}
              className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg"
            >
              {OFFICIAL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="form-naturaleza"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Naturaleza del Costo
            </label>
            <select
              id="form-naturaleza"
              value={naturaleza}
              onChange={(e) => setNaturaleza(e.target.value as NaturalezaGasto)}
              className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg"
            >
              <option value="Costo Fijo">Costo Fijo</option>
              <option value="Costo Variable">Costo Variable</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label
              htmlFor="form-cat-principal"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Categoría Principal
            </label>
            <select
              id="form-cat-principal"
              value={categoriaPrincipal}
              onChange={(e) => setCategoriaPrincipal(e.target.value)}
              className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg"
            >
              {principalCategories.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="form-subtipo"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Subtipo Específico
            </label>
            <select
              id="form-subtipo"
              value={subtipo}
              onChange={(e) => setSubtipo(e.target.value)}
              className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg"
            >
              {subtiposForPrincipal.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              {!subtiposForPrincipal.includes(subtipo) && subtipo && (
                <option value={subtipo}>{subtipo}</option>
              )}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="form-desc" className="block text-xs font-medium text-slate-700 mb-1">
            Descripción / Detalle de Ítems
          </label>
          <textarea
            id="form-desc"
            rows={2}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Detalle claro de los productos o servicios adquiridos..."
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
          />
        </div>

        {saveFeedback && (
          <div
            role="status"
            className={`p-3 rounded-lg border text-xs font-medium ${
              saveFeedback.type === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            {saveFeedback.text}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
          <span className="text-xs text-slate-500">
            Responsable: <strong className="text-slate-700">{user.usuario}</strong>
          </span>
          <button
            type="submit"
            disabled={saving}
            className="w-full sm:w-auto px-5 py-3 bg-[#1B4332] hover:bg-[#0f291e] disabled:opacity-60 text-white text-sm font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            {saving ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            <span>{saving ? 'Guardando en Servidor...' : 'Guardar Comprobante'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
