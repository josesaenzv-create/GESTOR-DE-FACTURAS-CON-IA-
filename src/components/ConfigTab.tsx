import React, { useMemo, useState } from 'react';
import {
  GripVertical,
  Plus,
  X,
  CheckCircle2,
  Building,
  Download,
  Printer,
  ArrowLeftRight,
  Pencil,
  Check,
  Lightbulb,
  Minus,
  ShieldCheck,
  UserCheck,
  UserX,
  Code2,
  Copy,
} from 'lucide-react';
import {
  OFFICIAL_CATEGORIES,
  type ExpenseCriterion,
  type ExpenseRecord,
  type NaturalezaGasto,
  type SedeRecord,
  type UserSession,
} from '../types/crediban';
import {
  createSedeInBackend,
  getUserAccessOverrides,
  moveCriterionNatureInBackend,
  saveCriterionInBackend,
  saveSedeCustomizationInBackend,
  saveUserAccessOverrides,
} from '../services/credibanApi';
import { isDefaultAuthorizedRole, resolveUserSystemAccess } from '../utils/accounting';
import { exportExpensesToCsv } from '../utils/searchAndPivot';

interface ConfigTabProps {
  user: UserSession;
  usersDirectory: UserSession[];
  criteria: ExpenseCriterion[];
  expenses: ExpenseRecord[];
  sedes: SedeRecord[];
  onCriterionMoved: (
    idCriterio: string,
    nuevaNaturaleza: NaturalezaGasto,
    reclasificarHistoricos: boolean,
    categoriaPrincipal: string,
    subtipo: string,
    nuevaCategoriaPrincipal?: string
  ) => void;
  onCriterionSaved: (criterion: ExpenseCriterion) => void;
  onCriterionRemoved: (idCriterio: string) => void;
  onSedeCreated: (sede: SedeRecord) => void;
  onSedeUpdated?: (sede: SedeRecord) => void;
  onUsersAccessUpdated: (overrides: Record<string, boolean>) => void;
}

export const ConfigTab: React.FC<ConfigTabProps> = ({
  user,
  usersDirectory,
  criteria,
  expenses,
  sedes,
  onCriterionMoved,
  onCriterionSaved,
  onCriterionRemoved,
  onSedeCreated,
  onSedeUpdated,
  onUsersAccessUpdated,
}) => {
  const [reclassifyHistorical, setReclassifyHistorical] = useState(true);
  const [feedback, setFeedback] = useState('');
  const [draggedCriterionId, setDraggedCriterionId] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  // Per-category quick "Añadir nuevo desglose..." input values
  const [quickSubtipoByGroup, setQuickSubtipoByGroup] = useState<Record<string, string>>({});

  // Inline rename of subtype
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingSubtipoVal, setEditingSubtipoVal] = useState('');

  // Add new Principal Category in Costo Fijo / Costo Variable
  const [newFixedCategoryName, setNewFixedCategoryName] = useState('');
  const [newFixedFirstSubtipo, setNewFixedFirstSubtipo] = useState('');
  const [newVarCategoryName, setNewVarCategoryName] = useState('');
  const [newVarFirstSubtipo, setNewVarFirstSubtipo] = useState('');

  // New Sede Form & Per-Sede Receipt Personalization Drafts
  const [sedeName, setSedeName] = useState('');
  const [sedeCode, setSedeCode] = useState('');
  const [sedeBudgetFixed, setSedeBudgetFixed] = useState('6000');
  const [sedeBudgetVar, setSedeBudgetVar] = useState('4500');
  const [sedeAddress, setSedeAddress] = useState('');
  const [sedeLocation, setSedeLocation] = useState('');
  const [sedeDrafts, setSedeDrafts] = useState<Record<string, SedeRecord>>({});
  const [savingSedeKey, setSavingSedeKey] = useState<string | null>(null);

  // Manager User Access Control & Script Reference
  const [accessOverrides, setAccessOverrides] = useState<Record<string, boolean>>(() =>
    getUserAccessOverrides()
  );
  const [userSearch, setUserSearch] = useState('');
  const [savingAccess, setSavingAccess] = useState(false);
  const [showScriptCode, setShowScriptCode] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);

  const activeCriteria = useMemo(
    () => criteria.filter((c) => c.estado !== 'INACTIVO'),
    [criteria]
  );

  // Group criteria by Naturaleza -> Categoria Principal
  const groupedByNature = useMemo(() => {
    const buildGroups = (nat: NaturalezaGasto) => {
      const map = new Map<string, ExpenseCriterion[]>();
      for (const c of activeCriteria) {
        if (c.naturaleza !== nat) continue;
        const cat = c.categoriaPrincipal || 'Otros';
        if (!map.has(cat)) map.set(cat, []);
        map.get(cat)!.push(c);
      }
      return Array.from(map.entries());
    };

    return {
      fijos: buildGroups('Costo Fijo'),
      variables: buildGroups('Costo Variable'),
    };
  }, [activeCriteria]);

  const handleDropOnCategory = async (
    targetNaturaleza: NaturalezaGasto,
    targetCategoriaPrincipal: string
  ) => {
    setDragOverTarget(null);
    if (!draggedCriterionId) return;
    const item = activeCriteria.find((c) => c.idCriterio === draggedCriterionId);
    setDraggedCriterionId(null);
    if (!item) return;
    if (
      item.naturaleza === targetNaturaleza &&
      item.categoriaPrincipal === targetCategoriaPrincipal
    ) {
      return;
    }

    onCriterionMoved(
      item.idCriterio,
      targetNaturaleza,
      reclassifyHistorical,
      item.categoriaPrincipal,
      item.subtipo,
      targetCategoriaPrincipal
    );

    const updated: ExpenseCriterion = {
      ...item,
      naturaleza: targetNaturaleza,
      categoriaPrincipal: targetCategoriaPrincipal,
      modificadoPor: user.usuario,
    };
    await saveCriterionInBackend(updated, user.usuario);
    const res = await moveCriterionNatureInBackend({
      idCriterio: item.idCriterio,
      categoriaPrincipal: targetCategoriaPrincipal,
      subtipo: item.subtipo,
      nuevaNaturaleza: targetNaturaleza,
      reclasificarHistoricos: reclassifyHistorical,
      usuario: user.usuario,
    });
    setFeedback(
      `"${item.subtipo}" movido a ${targetNaturaleza} → ${targetCategoriaPrincipal}. ${res.message}`
    );
  };

  const handleQuickAddSubtipo = async (
    naturaleza: NaturalezaGasto,
    categoriaPrincipal: string
  ) => {
    const groupKey = `${naturaleza}::${categoriaPrincipal}`;
    const label = (quickSubtipoByGroup[groupKey] || '').trim();
    if (!label) return;

    const existingSample = activeCriteria.find(
      (c) => c.naturaleza === naturaleza && c.categoriaPrincipal === categoriaPrincipal
    );

    const newCrit: ExpenseCriterion = {
      idCriterio: `CRIT-${Date.now().toString().slice(-5)}`,
      naturaleza,
      categoriaForms: existingSample?.categoriaForms || OFFICIAL_CATEGORIES[0],
      categoriaPrincipal,
      subtipo: label,
      palabrasClaveIA: label.toLowerCase(),
      aplicaIgvDefecto: true,
      topeAlertaSoles: 250,
      estado: 'ACTIVO',
      modificadoPor: user.usuario,
    };

    onCriterionSaved(newCrit);
    setQuickSubtipoByGroup((prev) => ({ ...prev, [groupKey]: '' }));
    const res = await saveCriterionInBackend(newCrit, user.usuario);
    setFeedback(`Desglose "${label}" añadido a ${categoriaPrincipal}. ${res.message}`);
  };

  const handleAddPrincipalGroup = async (naturaleza: NaturalezaGasto) => {
    const catName =
      naturaleza === 'Costo Fijo' ? newFixedCategoryName.trim() : newVarCategoryName.trim();
    const firstSub =
      naturaleza === 'Costo Fijo'
        ? newFixedFirstSubtipo.trim() || 'Desglose general'
        : newVarFirstSubtipo.trim() || 'Desglose general';
    if (!catName) return;

    const newCrit: ExpenseCriterion = {
      idCriterio: `CRIT-${Date.now().toString().slice(-5)}`,
      naturaleza,
      categoriaForms: OFFICIAL_CATEGORIES[0],
      categoriaPrincipal: catName,
      subtipo: firstSub,
      palabrasClaveIA: `${catName.toLowerCase()}, ${firstSub.toLowerCase()}`,
      aplicaIgvDefecto: true,
      topeAlertaSoles: 250,
      estado: 'ACTIVO',
      modificadoPor: user.usuario,
    };

    onCriterionSaved(newCrit);
    if (naturaleza === 'Costo Fijo') {
      setNewFixedCategoryName('');
      setNewFixedFirstSubtipo('');
    } else {
      setNewVarCategoryName('');
      setNewVarFirstSubtipo('');
    }
    const res = await saveCriterionInBackend(newCrit, user.usuario);
    setFeedback(`Categoría "${catName}" creada en ${naturaleza}. ${res.message}`);
  };

  const handleSaveInlineRename = async (item: ExpenseCriterion) => {
    const clean = editingSubtipoVal.trim();
    setEditingId(null);
    if (!clean || clean === item.subtipo) return;
    const updated: ExpenseCriterion = { ...item, subtipo: clean, modificadoPor: user.usuario };
    onCriterionSaved(updated);
    const res = await saveCriterionInBackend(updated, user.usuario);
    setFeedback(`Subtipo renombrado a "${clean}". ${res.message}`);
  };

  const handleRemoveSubtype = async (item: ExpenseCriterion) => {
    onCriterionRemoved(item.idCriterio);
    const archived: ExpenseCriterion = { ...item, estado: 'INACTIVO', modificadoPor: user.usuario };
    await saveCriterionInBackend(archived, user.usuario);
    setFeedback(`Subtipo "${item.subtipo}" eliminado de ${item.categoriaPrincipal}.`);
  };

  const handleMoveSingleSubtype = async (item: ExpenseCriterion) => {
    const nextNat: NaturalezaGasto =
      item.naturaleza === 'Costo Fijo' ? 'Costo Variable' : 'Costo Fijo';
    onCriterionMoved(
      item.idCriterio,
      nextNat,
      reclassifyHistorical,
      item.categoriaPrincipal,
      item.subtipo
    );
    const updated: ExpenseCriterion = {
      ...item,
      naturaleza: nextNat,
      modificadoPor: user.usuario,
    };
    await saveCriterionInBackend(updated, user.usuario);
    const res = await moveCriterionNatureInBackend({
      idCriterio: item.idCriterio,
      categoriaPrincipal: item.categoriaPrincipal,
      subtipo: item.subtipo,
      nuevaNaturaleza: nextNat,
      reclasificarHistoricos: reclassifyHistorical,
      usuario: user.usuario,
    });
    setFeedback(`"${item.subtipo}" movido a ${nextNat}. ${res.message}`);
  };

  const handleToggleGroupNature = async (
    currentNat: NaturalezaGasto,
    categoriaPrincipal: string,
    items: ExpenseCriterion[]
  ) => {
    const nextNat: NaturalezaGasto =
      currentNat === 'Costo Fijo' ? 'Costo Variable' : 'Costo Fijo';
    for (const item of items) {
      onCriterionMoved(
        item.idCriterio,
        nextNat,
        reclassifyHistorical,
        item.categoriaPrincipal,
        item.subtipo
      );
      await moveCriterionNatureInBackend({
        idCriterio: item.idCriterio,
        categoriaPrincipal: item.categoriaPrincipal,
        subtipo: item.subtipo,
        nuevaNaturaleza: nextNat,
        reclasificarHistoricos: reclassifyHistorical,
        usuario: user.usuario,
      });
    }
    setFeedback(`Categoría "${categoriaPrincipal}" movida a ${nextNat}.`);
  };

  const handleExportCsv = () => {
    const csvContent = exportExpensesToCsv(expenses);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CREDIBAN_Parametros_y_Gastos_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2500);
  };

  const handleCreateSede = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = sedeName.trim().toUpperCase();
    if (!cleanName) return;

    const newSede: SedeRecord = {
      codigoSede: (sedeCode.trim() || cleanName.slice(0, 3)).toUpperCase(),
      nombreSede: cleanName,
      estado: 'ACTIVO',
      presupuestoMensualFijo: parseFloat(sedeBudgetFixed) || 6000,
      presupuestoMensualVariable: parseFloat(sedeBudgetVar) || 4500,
      nombreHojaSede: `SEDE_${cleanName}`,
      direccion: sedeAddress.trim().toUpperCase() || 'DIRECCIÓN POR CONFIGURAR',
      ubicacion: sedeLocation.trim().toUpperCase() || `${cleanName} - PERÚ`,
      telefono: '',
      codigoSbs: 'INSCRITO EN LA SBS BAJO CODIGO REGISTRAL 00038222-2025',
      mensajePie: '*** TE DESEO MUCHO EXITO ***',
      correoContacto: 'CREDIBANPERU@GMAIL.COM',
    };

    onSedeCreated(newSede);
    const res = await createSedeInBackend(newSede, user.usuario);
    setFeedback(res.message);
    setSedeName('');
    setSedeCode('');
    setSedeAddress('');
    setSedeLocation('');
  };

  const getSedeDraft = (s: SedeRecord): SedeRecord => sedeDrafts[s.nombreSede] || s;

  const updateSedeDraftField = (
    sedeObj: SedeRecord,
    field: keyof SedeRecord,
    value: string | number
  ) => {
    const current = getSedeDraft(sedeObj);
    setSedeDrafts((prev) => ({
      ...prev,
      [sedeObj.nombreSede]: {
        ...current,
        [field]: value,
      },
    }));
  };

  const handleSaveSedeCustomization = async (sedeObj: SedeRecord) => {
    const draft = getSedeDraft(sedeObj);
    setSavingSedeKey(sedeObj.nombreSede);
    try {
      const normalized: SedeRecord = {
        ...draft,
        direccion: (draft.direccion || '').trim().toUpperCase() || 'DIRECCIÓN POR CONFIGURAR',
        ubicacion:
          (draft.ubicacion || '').trim().toUpperCase() || `${draft.nombreSede} - PERÚ`,
        telefono: (draft.telefono || '').trim(),
        codigoSbs:
          (draft.codigoSbs || '').trim().toUpperCase() ||
          'INSCRITO EN LA SBS BAJO CODIGO REGISTRAL 00038222-2025',
        mensajePie:
          (draft.mensajePie || '').trim().toUpperCase() || '*** TE DESEO MUCHO EXITO ***',
        correoContacto:
          (draft.correoContacto || '').trim().toUpperCase() || 'CREDIBANPERU@GMAIL.COM',
        presupuestoMensualFijo: Number(draft.presupuestoMensualFijo) || 0,
        presupuestoMensualVariable: Number(draft.presupuestoMensualVariable) || 0,
      };
      onSedeUpdated?.(normalized);
      const res = await saveSedeCustomizationInBackend(normalized, user.usuario);
      setFeedback(res.message);
    } finally {
      setSavingSedeKey(null);
    }
  };

  const renderColumn = (
    naturaleza: NaturalezaGasto,
    groups: Array<[string, ExpenseCriterion[]]>,
    isFixed: boolean
  ) => {
    const columnBorder = isFixed ? 'border-blue-200 bg-blue-50/40' : 'border-orange-200 bg-orange-50/40';
    const titleColor = isFixed ? 'text-blue-700' : 'text-orange-600';
    const subtitleColor = isFixed ? 'text-blue-600/80' : 'text-orange-500/90';
    const cardHeaderBg = isFixed ? 'bg-blue-600' : 'bg-orange-500';
    const addBtnStyle = isFixed
      ? 'bg-blue-100 hover:bg-blue-200 text-blue-800'
      : 'bg-orange-100 hover:bg-orange-200 text-orange-800';

    return (
      <section className={`rounded-2xl border p-4 sm:p-5 space-y-4 ${columnBorder}`}>
        <div className="text-center pb-1">
          <h3 className={`text-lg font-extrabold tracking-wide uppercase ${titleColor}`}>
            {isFixed ? 'COSTOS FIJOS' : 'COSTOS VARIABLES'}
          </h3>
          <p className={`text-xs mt-0.5 ${subtitleColor}`}>
            {isFixed
              ? 'Gastos recurrentes e independientes del volumen'
              : 'Gastos según gestión operativa y cobranzas'}
          </p>
        </div>

        {/* Category Cards */}
        <div className="space-y-4">
          {groups.map(([catName, items]) => {
            const groupKey = `${naturaleza}::${catName}`;
            const isOver = dragOverTarget === groupKey;
            return (
              <div
                key={groupKey}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverTarget(groupKey);
                }}
                onDragLeave={() => setDragOverTarget(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDropOnCategory(naturaleza, catName);
                }}
                className={`bg-white rounded-xl border overflow-hidden transition-all ${
                  isOver
                    ? isFixed
                      ? 'border-blue-500 ring-2 ring-blue-300'
                      : 'border-orange-500 ring-2 ring-orange-300'
                    : 'border-slate-200'
                }`}
              >
                {/* Category Header */}
                <div
                  className={`${cardHeaderBg} text-white px-4 py-2.5 flex items-center justify-between gap-2`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                      {isFixed ? <Minus className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                    </span>
                    <span className="text-sm font-bold truncate">{catName}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggleGroupNature(naturaleza, catName, items)}
                    title={`Mover toda la categoría a ${isFixed ? 'Costos Variables' : 'Costos Fijos'}`}
                    className="px-2 py-1 text-[11px] font-medium bg-white/15 hover:bg-white/25 rounded flex items-center gap-1 shrink-0 cursor-pointer"
                  >
                    <ArrowLeftRight className="w-3 h-3" />
                    <span className="hidden sm:inline">
                      {isFixed ? 'A Variable' : 'A Fijo'}
                    </span>
                  </button>
                </div>

                {/* Draggable Subtypes */}
                <div className="p-3 space-y-2">
                  {items.map((item) => {
                    const isEditingThis = editingId === item.idCriterio;
                    return (
                      <div
                        key={item.idCriterio}
                        draggable={!isEditingThis}
                        onDragStart={() => setDraggedCriterionId(item.idCriterio)}
                        onDragEnd={() => {
                          setDraggedCriterionId(null);
                          setDragOverTarget(null);
                        }}
                        className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs transition-colors ${
                          draggedCriterionId === item.idCriterio
                            ? 'bg-slate-100 border-slate-400 opacity-60'
                            : 'bg-slate-50/70 hover:bg-slate-100/80 border-slate-200'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <GripVertical
                            className="w-4 h-4 text-slate-400 cursor-grab shrink-0"
                            aria-hidden="true"
                          />
                          {isEditingThis ? (
                            <input
                              type="text"
                              autoFocus
                              value={editingSubtipoVal}
                              onChange={(e) => setEditingSubtipoVal(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveInlineRename(item);
                                if (e.key === 'Escape') setEditingId(null);
                              }}
                              className="w-full px-2 py-1 text-xs bg-white border border-slate-300 rounded"
                            />
                          ) : (
                            <span className="text-slate-800 font-medium truncate">
                              {item.subtipo}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {isEditingThis ? (
                            <button
                              type="button"
                              onClick={() => handleSaveInlineRename(item)}
                              aria-label="Confirmar nombre"
                              className="p-1 text-emerald-700 hover:bg-emerald-100 rounded cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(item.idCriterio);
                                setEditingSubtipoVal(item.subtipo);
                              }}
                              aria-label={`Editar ${item.subtipo}`}
                              className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleMoveSingleSubtype(item)}
                            title={`Mover a ${isFixed ? 'Costo Variable' : 'Costo Fijo'}`}
                            aria-label={`Mover ${item.subtipo} a ${isFixed ? 'Variable' : 'Fijo'}`}
                            className="p-1 text-slate-400 hover:text-blue-700 rounded cursor-pointer"
                          >
                            <ArrowLeftRight className="w-3 h-3" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleRemoveSubtype(item)}
                            aria-label={`Eliminar ${item.subtipo}`}
                            className="p-1 text-slate-400 hover:text-red-600 rounded cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {/* Quick Add Subtype Row */}
                  <div className="pt-2 mt-1 border-t border-slate-100 flex items-center gap-2">
                    <input
                      type="text"
                      value={quickSubtipoByGroup[groupKey] || ''}
                      onChange={(e) =>
                        setQuickSubtipoByGroup((prev) => ({
                          ...prev,
                          [groupKey]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleQuickAddSubtipo(naturaleza, catName);
                        }
                      }}
                      placeholder="Añadir nuevo desglose..."
                      className="flex-1 px-3 py-1.5 text-xs bg-white border-b border-slate-200 focus:border-slate-400 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleQuickAddSubtipo(naturaleza, catName)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${addBtnStyle}`}
                    >
                      Añadir
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Add New Principal Category Card */}
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-3.5 space-y-2">
          <p className="text-xs font-semibold text-slate-700">
            Nueva categoría en {isFixed ? 'Costos Fijos' : 'Costos Variables'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="text"
              value={isFixed ? newFixedCategoryName : newVarCategoryName}
              onChange={(e) =>
                isFixed
                  ? setNewFixedCategoryName(e.target.value)
                  : setNewVarCategoryName(e.target.value)
              }
              placeholder="Nombre de categoría principal..."
              className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
            <input
              type="text"
              value={isFixed ? newFixedFirstSubtipo : newVarFirstSubtipo}
              onChange={(e) =>
                isFixed
                  ? setNewFixedFirstSubtipo(e.target.value)
                  : setNewVarFirstSubtipo(e.target.value)
              }
              placeholder="Primer subtipo / desglose..."
              className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>
          <button
            type="button"
            onClick={() => handleAddPrincipalGroup(naturaleza)}
            className={`w-full py-2 text-xs font-semibold rounded-lg cursor-pointer ${addBtnStyle}`}
          >
            + Crear Categoría Principal
          </button>
        </div>
      </section>
    );
  };

  return (
    <div className="space-y-5">
      {/* Top Manager Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Administrador de Categorías
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Configura el Dashboard Interactivo · Sincronizado con el Servidor
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={reclassifyHistorical}
              onChange={(e) => setReclassifyHistorical(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-[#59B447] focus:ring-[#59B447]"
            />
            <span>Reclasificar históricos al mover</span>
          </label>
          <button
            type="button"
            onClick={handleExportCsv}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exportar CSV</span>
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Exportar PDF</span>
          </button>
        </div>
      </div>

      {/* Interactive Tip */}
      <div className="bg-sky-50 border border-sky-200 rounded-xl px-4 py-3 text-xs text-sky-900 flex items-center gap-2.5">
        <Lightbulb className="w-4 h-4 text-amber-500 shrink-0" />
        <span>
          <strong>Tip interactivo:</strong> Puedes agarrar los subtipos (los recuadros grises) y arrastrarlos para cambiar su orden o moverlos a otra categoría entre Costos Fijos y Costos Variables.
        </span>
      </div>

      {feedback && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800 flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Dual Column Costos Fijos vs Costos Variables Board */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {renderColumn('Costo Fijo', groupedByNature.fijos, true)}
        {renderColumn('Costo Variable', groupedByNature.variables, false)}
      </div>

      {/* Sedes Management & Receipt Personalization Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Building className="w-4 h-4 text-[#59B447]" />
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Personalización de Sedes y Cabecera de Recibos
              </h3>
              <p className="text-xs text-slate-500">
                Dirección, celular y correo se sincronizan automáticamente desde la App de Usuarios; puedes editarlos aquí si necesitas sobrescribir la cabecera de recibos por sede.
              </p>
            </div>
          </div>
          <span className="text-xs font-mono font-semibold text-slate-600">
            {sedes.length} sede{sedes.length === 1 ? '' : 's'} activa{sedes.length === 1 ? '' : 's'}
          </span>
        </div>

        {/* Editable Active Sede Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {sedes.map((s) => {
            const draft = getSedeDraft(s);
            const isSavingThis = savingSedeKey === s.nombreSede;
            return (
              <div
                key={s.nombreSede}
                className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3"
              >
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200">
                  <div>
                    <h4 className="text-sm font-extrabold text-[#1B4332]">
                      SEDE {s.nombreSede}
                    </h4>
                    <p className="text-[11px] text-slate-500 font-mono">
                      Código: {draft.codigoSede} · Serie independiente desde 0001
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isSavingThis}
                    onClick={() => handleSaveSedeCustomization(s)}
                    className="px-3 py-1.5 bg-[#1B4332] hover:bg-[#0f291e] disabled:opacity-60 text-white text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{isSavingThis ? 'Guardando...' : 'Guardar Sede'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">
                      Dirección en Recibo
                    </label>
                    <input
                      type="text"
                      aria-label={`Dirección sede ${s.nombreSede}`}
                      value={draft.direccion || ''}
                      onChange={(e) => updateSedeDraftField(s, 'direccion', e.target.value)}
                      placeholder="Ej. AV. LUZURIAGA #450"
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-md uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">
                      Ubicación (Ciudad - Prov - Dpto)
                    </label>
                    <input
                      type="text"
                      aria-label={`Ubicación sede ${s.nombreSede}`}
                      value={draft.ubicacion || ''}
                      onChange={(e) => updateSedeDraftField(s, 'ubicacion', e.target.value)}
                      placeholder={`Ej. ${s.nombreSede} - PROV - DPTO`}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-md uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">
                      Correo de Contacto
                    </label>
                    <input
                      type="text"
                      aria-label={`Correo sede ${s.nombreSede}`}
                      value={draft.correoContacto || ''}
                      onChange={(e) =>
                        updateSedeDraftField(s, 'correoContacto', e.target.value)
                      }
                      placeholder="CREDIBANPERU@GMAIL.COM"
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-md uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">
                      Teléfono / WhatsApp (Opcional)
                    </label>
                    <input
                      type="text"
                      aria-label={`Teléfono sede ${s.nombreSede}`}
                      value={draft.telefono || ''}
                      onChange={(e) => updateSedeDraftField(s, 'telefono', e.target.value)}
                      placeholder="Ej. 999 888 777"
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-md font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">
                      Subtítulo / Registro SBS
                    </label>
                    <input
                      type="text"
                      aria-label={`SBS sede ${s.nombreSede}`}
                      value={draft.codigoSbs || ''}
                      onChange={(e) => updateSedeDraftField(s, 'codigoSbs', e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-md uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">
                      Mensaje de Pie del Recibo
                    </label>
                    <input
                      type="text"
                      aria-label={`Mensaje pie sede ${s.nombreSede}`}
                      value={draft.mensajePie || ''}
                      onChange={(e) => updateSedeDraftField(s, 'mensajePie', e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-md uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">
                      Presup. Mensual Fijo (S/)
                    </label>
                    <input
                      type="number"
                      value={draft.presupuestoMensualFijo}
                      onChange={(e) =>
                        updateSedeDraftField(
                          s,
                          'presupuestoMensualFijo',
                          parseFloat(e.target.value) || 0
                        )
                      }
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-md font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">
                      Presup. Mensual Variable (S/)
                    </label>
                    <input
                      type="number"
                      value={draft.presupuestoMensualVariable}
                      onChange={(e) =>
                        updateSedeDraftField(
                          s,
                          'presupuestoMensualVariable',
                          parseFloat(e.target.value) || 0
                        )
                      }
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-md font-mono"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Create New Sede Form */}
        <form
          onSubmit={handleCreateSede}
          className="pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-6 gap-3 items-end"
        >
          <div className="sm:col-span-2">
            <label htmlFor="sede-name" className="block text-xs font-medium text-slate-700 mb-1">
              Crear Nueva Sede
            </label>
            <input
              id="sede-name"
              type="text"
              required
              value={sedeName}
              onChange={(e) => setSedeName(e.target.value)}
              placeholder="Ej. BARRANCA"
              className="w-full px-3 py-2 text-xs uppercase border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label htmlFor="sede-code" className="block text-xs font-medium text-slate-700 mb-1">
              Código
            </label>
            <input
              id="sede-code"
              type="text"
              value={sedeCode}
              onChange={(e) => setSedeCode(e.target.value)}
              placeholder="BAR"
              maxLength={5}
              className="w-full px-3 py-2 text-xs font-mono uppercase border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label htmlFor="sede-addr" className="block text-xs font-medium text-slate-700 mb-1">
              Dirección
            </label>
            <input
              id="sede-addr"
              type="text"
              value={sedeAddress}
              onChange={(e) => setSedeAddress(e.target.value)}
              placeholder="AV. GRAU #200"
              className="w-full px-3 py-2 text-xs uppercase border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label htmlFor="sede-loc" className="block text-xs font-medium text-slate-700 mb-1">
              Ubicación
            </label>
            <input
              id="sede-loc"
              type="text"
              value={sedeLocation}
              onChange={(e) => setSedeLocation(e.target.value)}
              placeholder="BARRANCA - LIMA"
              className="w-full px-3 py-2 text-xs uppercase border border-slate-300 rounded-lg"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-[#1B4332] hover:bg-[#0f291e] text-white text-xs font-semibold rounded-lg cursor-pointer"
          >
            + Crear Sede
          </button>
        </form>
      </div>

      {/* Manager Access Control for System Users */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4 no-print">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#1B4332]" />
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Control de Acceso de Usuarios al Sistema
              </h3>
              <p className="text-xs text-slate-500">
                Por defecto solo <strong>Cajeros</strong>, <strong>Administradores</strong> y <strong>Gerencia</strong> pueden ingresar. Los <strong>Asesores</strong> y demás cargos están bloqueados por defecto salvo habilitación explícita.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Buscar nombre, usuario o sede..."
              className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
            <button
              type="button"
              disabled={savingAccess}
              onClick={async () => {
                setSavingAccess(true);
                const res = await saveUserAccessOverrides(accessOverrides, user.usuario);
                onUsersAccessUpdated(accessOverrides);
                setFeedback(res.message);
                setSavingAccess(false);
              }}
              className="px-3.5 py-1.5 bg-[#1B4332] hover:bg-[#0f291e] disabled:opacity-60 text-white text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              {savingAccess ? 'Guardando...' : 'Guardar Permisos'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase">
                <th className="py-2.5 px-3 font-semibold">Colaborador</th>
                <th className="py-2.5 px-3 font-semibold">Usuario</th>
                <th className="py-2.5 px-3 font-semibold">Cargo / Sede</th>
                <th className="py-2.5 px-3 font-semibold">DNI</th>
                <th className="py-2.5 px-3 font-semibold text-right">Acceso al Sistema</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {usersDirectory
                .filter((u) => {
                  const q = userSearch.trim().toLowerCase();
                  if (!q) return true;
                  return (
                    (u.nombreCompleto || '').toLowerCase().includes(q) ||
                    u.usuario.toLowerCase().includes(q) ||
                    u.sede.toLowerCase().includes(q) ||
                    u.cargo.toLowerCase().includes(q)
                  );
                })
                .map((u) => {
                  const key = u.usuario.toUpperCase();
                  const isSelf = key === user.usuario.toUpperCase();
                  const est = String(u.estado || 'HABILITADO').toUpperCase();
                  const disabledInMaster =
                    est === 'DESHABILITADO' ||
                    est === 'INACTIVO' ||
                    est === 'BLOQUEADO' ||
                    est === 'SUSPENDIDO';
                  const defaultRoleAllowed = isDefaultAuthorizedRole(u.cargo);
                  const allowed = resolveUserSystemAccess({
                    estado: u.estado,
                    cargo: u.cargo,
                    override: accessOverrides[key],
                  });
                  return (
                    <tr key={u.usuario} className="hover:bg-slate-50">
                      <td className="py-2 px-3 font-medium text-slate-900">
                        {u.nombreCompleto || u.usuario.replace(/\./g, ' ')}
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-600">{u.usuario}</td>
                      <td className="py-2 px-3 text-slate-600">
                        <div>
                          {u.cargo} · {u.sede}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {disabledInMaster
                            ? 'Deshabilitado en App de Usuarios'
                            : defaultRoleAllowed
                            ? 'Acceso por defecto'
                            : 'Rol restringido por defecto'}
                        </div>
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-600">{u.dni || '—'}</td>
                      <td className="py-2 px-3 text-right">
                        <button
                          type="button"
                          disabled={isSelf || disabledInMaster}
                          onClick={() =>
                            setAccessOverrides((prev) => ({
                              ...prev,
                              [key]: !allowed,
                            }))
                          }
                          className={`px-2.5 py-1 rounded-md text-xs font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50 ${
                            allowed
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                              : 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100'
                          }`}
                        >
                          {allowed ? (
                            <>
                              <UserCheck className="w-3.5 h-3.5" />
                              <span>Permitido</span>
                            </>
                          ) : (
                            <>
                              <UserX className="w-3.5 h-3.5" />
                              <span>Bloqueado</span>
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Database Script Update Guide for Manager */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3 no-print">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Code2 className="w-4 h-4 text-slate-700" />
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Código.gs Completo para tu Servidor de Base de Datos (Listo para Copiar)
              </h3>
              <p className="text-xs text-slate-500">
                Por seguridad de Google, esta web no puede editar directamente tu cuenta en script.google.com. Copia este código completo, pégalo en tu proyecto <span className="font-mono">Código.gs</span> y haz clic en <strong>Implementar → Gestionar implementaciones → Nueva versión</strong>.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowScriptCode((v) => !v)}
            className="px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg cursor-pointer"
          >
            {showScriptCode ? 'Ocultar Código' : 'Ver Código.gs Completo'}
          </button>
        </div>

        {showScriptCode && (
          <div className="space-y-2.5">
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 space-y-1">
              <p className="font-bold">Mejoras incluidas automáticamente en este script:</p>
              <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                <li>Preserva tus 28 columnas exactas + 4 columnas de Yape/Plin (<span className="font-mono">TITULAR_CUENTA, NUMERO_OPERACION, ENTIDAD_PAGO, TELEFONO_CUENTA</span>).</li>
                <li>Guarda <span className="font-mono">NUMERO DE COMPRANTE</span> y <span className="font-mono">RUC</span> en formato texto <span className="font-mono">@</span> para que nunca se recorten correlativos largos (ej. <span className="font-mono">F001-00034719</span>).</li>
                <li>Permite reemplazar o adjuntar la foto HD del recibo firmado (<span className="font-mono">editarComprobante</span>) directo en Google Drive.</li>
                <li>Persiste en la nube las direcciones de recibos por sede (<span className="font-mono">CONFIG_SEDES</span>), categorías fijas/variables (<span className="font-mono">PARAMETROS_GASTOS</span>) y permisos de acceso (<span className="font-mono">PERMISOS_ACCESO</span>).</li>
              </ul>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(RECOMMENDED_GAS_SNIPPET);
                  setCopiedScript(true);
                  setTimeout(() => setCopiedScript(false), 2500);
                }}
                className="px-3 py-1.5 text-xs font-semibold bg-[#1B4332] text-white rounded-md flex items-center gap-1.5 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copiedScript ? '¡Código Completo Copiado!' : 'Copiar Código.gs Completo'}</span>
              </button>
            </div>
            <pre className="p-3.5 bg-slate-900 text-slate-100 rounded-lg text-[11px] font-mono overflow-x-auto max-h-[420px] leading-relaxed">
              {RECOMMENDED_GAS_SNIPPET}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};

const RECOMMENDED_GAS_SNIPPET = `/**
 * CREDIBAN PERU S.A.C. (RUC: 20613997360)
 * Código.gs Completo — Compatible con hoja de 28+ columnas, Drive HD,
 * personalización de sedes, criterios contables y permisos de usuarios.
 */

var ROOT_DRIVE_FOLDER_NAME = 'CREDIBAN_COMPROBANTES_HD';

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function isManagerCargo_(cargo) {
  var c = String(cargo || '').toUpperCase();
  return c.indexOf('GERENTE') !== -1 || c.indexOf('GERENCIA') !== -1 || c.indexOf('DIRECTOR') !== -1;
}

function getMainExpensesSheet_(ss) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName().toUpperCase();
    if (
      name !== 'PARAMETROS_GASTOS' &&
      name !== 'CONFIG_SEDES' &&
      name !== 'PERMISOS_ACCESO' &&
      name !== 'PRESUPUESTOS_MENSUALES'
    ) {
      return sheets[i];
    }
  }
  return ss.getSheets()[0];
}

function ensureExtendedHeaders_(sheet) {
  var expected = [
    'Marca temporal',
    'FILIAL',
    'AÑO',
    'PERIODO PARA EL CUAL DEBE REGISTRARSE',
    'CATEGORIA',
    'TIPO DE COMPROBANTE',
    'FECHA DE EMISION DEL COMPROBANTE',
    'NUMERO DE COMPRANTE',
    'NOMBRE DE LA EMPRESA',
    'RUC',
    'MONTO TOTAL: CON ( , )',
    'IGV (SOLO FACTURAS) CON ( , )',
    'DESCRIPCION',
    'FOTO O CAPTURA DEL COMPROBANTE',
    'ID_REGISTRO',
    'NOMBRE_COMERCIAL',
    'SUBTOTAL',
    'NATURALEZA',
    'SUBTIPO',
    'NIVEL_IMPACTO',
    'USUARIO_REGISTRO',
    'CARGO_USUARIO',
    'DIRECCION_GPS',
    'COORDENADAS_GPS',
    'LINK_MAPA_RUTA',
    'LINK_THUMBNAIL_HD',
    'CARPETA_DESTINO',
    'ESTADO_AUDITORIA',
    'TITULAR_CUENTA',
    'NUMERO_OPERACION',
    'ENTIDAD_PAGO',
    'TELEFONO_CUENTA'
  ];
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    sheet.appendRow(expected);
    return expected;
  }
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  for (var i = 0; i < expected.length; i++) {
    if (headers.indexOf(expected[i]) === -1 && i >= headers.length) {
      sheet.getRange(1, headers.length + 1).setValue(expected[i]);
      headers.push(expected[i]);
    }
  }
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function sheetToObjects_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  var values = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  var headers = values[0];
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var rowObj = {};
    var empty = true;
    for (var c = 0; c < headers.length; c++) {
      var h = String(headers[c] || '').trim();
      if (!h) continue;
      var val = values[r][c];
      if (val !== '') empty = false;
      rowObj[h] = val;
    }
    if (!empty) out.push(rowObj);
  }
  return out;
}

function getOrCreateSubfolder_(parent, name) {
  var clean = String(name || 'GENERAL').trim().toUpperCase();
  var it = parent.getFoldersByName(clean);
  return it.hasNext() ? it.next() : parent.createFolder(clean);
}

function saveBase64PhotoToDrive_(base64Str, fileName, sede, anio, mes) {
  if (!base64Str) return null;
  var rootIt = DriveApp.getFoldersByName(ROOT_DRIVE_FOLDER_NAME);
  var root = rootIt.hasNext() ? rootIt.next() : DriveApp.createFolder(ROOT_DRIVE_FOLDER_NAME);
  var sedeFolder = getOrCreateSubfolder_(root, sede || 'HUACHO');
  var periodFolder = getOrCreateSubfolder_(sedeFolder, (anio || '2026') + '_' + (mes || 'GENERAL'));

  var decoded = Utilities.base64Decode(base64Str);
  var blob = Utilities.newBlob(decoded, 'image/jpeg', fileName || ('CB_' + Date.now() + '.jpg'));
  var file = periodFolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var fileId = file.getId();
  return {
    urlView: 'https://drive.google.com/file/d/' + fileId + '/view?usp=drivesdk',
    urlThumbnail: 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w2000',
    folderName: sedeFolder.getName() + '/' + periodFolder.getName()
  };
}

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'obtenerConfiguracionYDatos';
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (action === 'obtenerConfiguracionYDatos') {
      var mainSheet = getMainExpensesSheet_(ss);
      ensureExtendedHeaders_(mainSheet);
      var comprobantes = sheetToObjects_(mainSheet);

      var paramSheet = ss.getSheetByName('PARAMETROS_GASTOS');
      var criteriosGastos = paramSheet ? sheetToObjects_(paramSheet) : [];

      var sedesSheet = ss.getSheetByName('CONFIG_SEDES');
      var sedes = sedesSheet ? sheetToObjects_(sedesSheet) : [];

      var permSheet = ss.getSheetByName('PERMISOS_ACCESO');
      var permisos = permSheet ? sheetToObjects_(permSheet) : [];

      var budgetSheet = ss.getSheetByName('PRESUPUESTOS_MENSUALES');
      var presupuestos = budgetSheet ? sheetToObjects_(budgetSheet) : [];

      return jsonOut_({
        status: 'ok',
        comprobantes: comprobantes,
        criteriosGastos: criteriosGastos,
        sedes: sedes,
        permisos: permisos,
        presupuestos: presupuestos
      });
    }

    return jsonOut_({ status: 'ok', message: 'Servicio CREDIBAN activo.' });
  } catch (err) {
    return jsonOut_({ status: 'error', message: String(err) });
  }
}

function doPost(e) {
  try {
    var data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var action = String(data.action || '');
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (action === 'registrarComprobante') {
      var sheet = getMainExpensesSheet_(ss);
      var headers = ensureExtendedHeaders_(sheet);
      var driveRes = saveBase64PhotoToDrive_(
        data.fotoBase64HD,
        data.nombreArchivoFoto,
        data.sede || data.filial,
        data.anio,
        data.mes || data.periodo
      );
      var idReg = data.idRegistro || ('GST-' + Utilities.formatString('%04d', sheet.getLastRow()));

      var map = {
        'Marca temporal': new Date(),
        'FILIAL': String(data.sede || data.filial || 'HUACHO').toUpperCase(),
        'AÑO': String(data.anio || ''),
        'PERIODO PARA EL CUAL DEBE REGISTRARSE': String(data.mes || data.periodo || '').toUpperCase(),
        'CATEGORIA': String(data.categoria || ''),
        'TIPO DE COMPROBANTE': String(data.tipoComprobante || ''),
        'FECHA DE EMISION DEL COMPROBANTE': String(data.fechaEmision || ''),
        'NUMERO DE COMPRANTE': String(data.numeroComprobante || ''),
        'NOMBRE DE LA EMPRESA': String(data.razonSocial || ''),
        'RUC': String(data.ruc || ''),
        'MONTO TOTAL: CON ( , )': String(data.montoConComa || data.total || '0,00'),
        'IGV (SOLO FACTURAS) CON ( , )': String(data.igvConComa || data.igv || '0,00'),
        'DESCRIPCION': String(data.descripcion || ''),
        'FOTO O CAPTURA DEL COMPROBANTE': driveRes ? driveRes.urlView : '',
        'ID_REGISTRO': idReg,
        'NOMBRE_COMERCIAL': String(data.nombreComercial || ''),
        'SUBTOTAL': String(data.subtotal || 0),
        'NATURALEZA': String(data.naturaleza || 'Costo Variable'),
        'SUBTIPO': String(data.subtipo || 'General'),
        'NIVEL_IMPACTO': String(data.nivelImpacto || 'Regular'),
        'USUARIO_REGISTRO': String(data.responsable || ''),
        'CARGO_USUARIO': String(data.cargoUsuario || ''),
        'DIRECCION_GPS': String(data.direccionGps || ''),
        'COORDENADAS_GPS': String(data.coordenadasGps || ''),
        'LINK_MAPA_RUTA': String(data.linkMapa || ''),
        'LINK_THUMBNAIL_HD': driveRes ? driveRes.urlThumbnail : '',
        'CARPETA_DESTINO': driveRes ? driveRes.folderName : '',
        'ESTADO_AUDITORIA': 'APROBADO',
        'TITULAR_CUENTA': String(data.titularCuenta || ''),
        'NUMERO_OPERACION': String(data.numeroOperacion || ''),
        'ENTIDAD_PAGO': String(data.entidadPago || ''),
        'TELEFONO_CUENTA': String(data.telefonoCuenta || '')
      };

      var nextRow = sheet.getLastRow() + 1;
      var rowArr = headers.map(function(h) { return map.hasOwnProperty(h) ? map[h] : ''; });
      var range = sheet.getRange(nextRow, 1, 1, headers.length);
      // Preserva texto exacto en correlativos largos (ej. F001-00034719) y RUC con ceros
      var textCols = ['NUMERO DE COMPRANTE', 'RUC', 'NUMERO_OPERACION', 'TELEFONO_CUENTA', 'AÑO'];
      textCols.forEach(function(colName) {
        var idx = headers.indexOf(colName);
        if (idx !== -1) sheet.getRange(nextRow, idx + 1).setNumberFormat('@');
      });
      range.setValues([rowArr]);

      return jsonOut_({
        status: 'ok',
        idRegistro: idReg,
        urlView: driveRes ? driveRes.urlView : '',
        urlThumbnail: driveRes ? driveRes.urlThumbnail : ''
      });
    }

    if (action === 'editarComprobante') {
      var editSheet = getMainExpensesSheet_(ss);
      var editHeaders = ensureExtendedHeaders_(editSheet);
      var idCol = editHeaders.indexOf('ID_REGISTRO') + 1;
      var lastR = editSheet.getLastRow();
      var targetRow = -1;
      if (idCol > 0 && lastR >= 2) {
        var ids = editSheet.getRange(2, idCol, lastR - 1, 1).getDisplayValues();
        for (var rIdx = 0; rIdx < ids.length; rIdx++) {
          if (String(ids[rIdx][0]).trim() === String(data.idRegistro || '').trim()) {
            targetRow = rIdx + 2;
            break;
          }
        }
      }
      if (targetRow === -1) return jsonOut_({ status: 'error', message: 'Registro no encontrado.' });

      var d = data.datosNuevos || {};
      var driveUpdated = saveBase64PhotoToDrive_(
        data.fotoBase64HD,
        data.nombreArchivoFoto,
        d.sede || data.sede,
        d.anio,
        d.mes
      );

      var updates = {
        'FILIAL': d.sede,
        'FECHA DE EMISION DEL COMPROBANTE': d.fecha,
        'NUMERO DE COMPRANTE': d.numeroComprobante,
        'NOMBRE DE LA EMPRESA': d.razonSocial,
        'RUC': d.ruc,
        'MONTO TOTAL: CON ( , )': d.montoConComa,
        'IGV (SOLO FACTURAS) CON ( , )': d.igvConComa,
        'SUBTOTAL': d.subtotal,
        'DESCRIPCION': d.descripcion,
        'NATURALEZA': d.naturaleza,
        'SUBTIPO': d.subtipo,
        'ESTADO_AUDITORIA': d.estado
      };
      if (driveUpdated) {
        updates['FOTO O CAPTURA DEL COMPROBANTE'] = driveUpdated.urlView;
        updates['LINK_THUMBNAIL_HD'] = driveUpdated.urlThumbnail;
        updates['CARPETA_DESTINO'] = driveUpdated.folderName;
      }
      Object.keys(updates).forEach(function(col) {
        if (updates[col] === undefined) return;
        var cIdx = editHeaders.indexOf(col) + 1;
        if (cIdx > 0) {
          var cell = editSheet.getRange(targetRow, cIdx);
          if (col === 'NUMERO DE COMPRANTE' || col === 'RUC') cell.setNumberFormat('@');
          cell.setValue(String(updates[col]));
        }
      });

      return jsonOut_({
        status: 'ok',
        urlView: driveUpdated ? driveUpdated.urlView : '',
        urlThumbnail: driveUpdated ? driveUpdated.urlThumbnail : ''
      });
    }

    if (action === 'eliminarComprobante') {
      if (!isManagerCargo_(data.cargo)) {
        return jsonOut_({ status: 'error', message: 'Solo Gerencia puede eliminar comprobantes.' });
      }
      if (!String(data.claveConfirmacion || '').trim()) {
        return jsonOut_({ status: 'error', message: 'Se requiere clave de confirmación de Gerencia.' });
      }
      var delSheet = getMainExpensesSheet_(ss);
      var delHeaders = ensureExtendedHeaders_(delSheet);
      var delIdCol = delHeaders.indexOf('ID_REGISTRO') + 1;
      var delLast = delSheet.getLastRow();
      if (delIdCol > 0 && delLast >= 2) {
        var delIds = delSheet.getRange(2, delIdCol, delLast - 1, 1).getDisplayValues();
        for (var j = 0; j < delIds.length; j++) {
          if (String(delIds[j][0]).trim() === String(data.idRegistro || '').trim()) {
            delSheet.deleteRow(j + 2);
            return jsonOut_({ status: 'ok' });
          }
        }
      }
      return jsonOut_({ status: 'error', message: 'ID no encontrado.' });
    }

    if (action === 'guardarConfigSede' || action === 'crearSede') {
      if (!isManagerCargo_(data.cargo || 'GERENTE')) {
        return jsonOut_({ status: 'error', message: 'Solo Gerencia puede configurar sedes.' });
      }
      var sedeSheet = ss.getSheetByName('CONFIG_SEDES') || ss.insertSheet('CONFIG_SEDES');
      var sedeCols = [
        'Codigo_Sede', 'Nombre_Sede', 'Estado',
        'Presupuesto_Mensual_Fijo', 'Presupuesto_Mensual_Variable',
        'Nombre_Hoja_Sede', 'Direccion', 'Ubicacion', 'Telefono',
        'Codigo_SBS', 'Mensaje_Pie', 'Correo_Contacto'
      ];
      if (sedeSheet.getLastRow() === 0) sedeSheet.appendRow(sedeCols);
      var nom = String(data.nombreSede || '').trim().toUpperCase();
      var rowsSede = sheetToObjects_(sedeSheet);
      var foundRow = -1;
      for (var s = 0; s < rowsSede.length; s++) {
        if (String(rowsSede[s].Nombre_Sede || '').toUpperCase() === nom) {
          foundRow = s + 2;
          break;
        }
      }
      var rowSedeVals = [
        String(data.codigoSede || nom.slice(0, 3)),
        nom,
        'ACTIVO',
        Number(data.presupuestoMensualFijo || 5000),
        Number(data.presupuestoMensualVariable || 10000),
        'SEDE_' + nom,
        String(data.direccion || ''),
        String(data.ubicacion || ''),
        String(data.telefono || ''),
        String(data.codigoSbs || 'INSCRITO EN LA SBS BAJO CODIGO REGISTRAL 00038222-2025'),
        String(data.mensajePie || '*** TE DESEO MUCHO EXITO ***'),
        String(data.correoContacto || 'CREDIBANPERU@GMAIL.COM')
      ];
      if (foundRow > 0) {
        sedeSheet.getRange(foundRow, 1, 1, sedeCols.length).setValues([rowSedeVals]);
      } else {
        sedeSheet.appendRow(rowSedeVals);
      }
      return jsonOut_({ status: 'ok' });
    }

    if (action === 'guardarCriterioGasto' || action === 'moverNaturalezaCriterio') {
      var critSheet = ss.getSheetByName('PARAMETROS_GASTOS') || ss.insertSheet('PARAMETROS_GASTOS');
      var critCols = [
        'ID_Criterio', 'Naturaleza', 'Categoria_Forms', 'Categoria_Principal',
        'Subtipo', 'Palabras_Clave_IA', 'Aplica_IGV_Defecto',
        'Tope_Alerta_Soles', 'Estado', 'Ultima_Modificacion', 'Modificado_Por'
      ];
      if (critSheet.getLastRow() === 0) critSheet.appendRow(critCols);
      var critRows = sheetToObjects_(critSheet);
      var targetId = String(data.idCriterio || '');
      var cRow = -1;
      for (var ci = 0; ci < critRows.length; ci++) {
        if (String(critRows[ci].ID_Criterio) === targetId) { cRow = ci + 2; break; }
      }
      if (action === 'moverNaturalezaCriterio' && cRow > 0) {
        critSheet.getRange(cRow, 2).setValue(String(data.nuevaNaturaleza || 'Costo Variable'));
        if (data.reclasificarHistoricos) {
          var mSheet = getMainExpensesSheet_(ss);
          var mHeaders = ensureExtendedHeaders_(mSheet);
          var catIdx = mHeaders.indexOf('CATEGORIA');
          var subIdx = mHeaders.indexOf('SUBTIPO');
          var natIdx = mHeaders.indexOf('NATURALEZA');
          if (subIdx !== -1 && natIdx !== -1 && mSheet.getLastRow() >= 2) {
            var all = mSheet.getRange(2, 1, mSheet.getLastRow() - 1, mHeaders.length).getDisplayValues();
            for (var mr = 0; mr < all.length; mr++) {
              if (all[mr][subIdx] === data.subtipo && (!data.categoriaPrincipal || all[mr][catIdx] === data.categoriaPrincipal || true)) {
                mSheet.getRange(mr + 2, natIdx + 1).setValue(String(data.nuevaNaturaleza));
              }
            }
          }
        }
        return jsonOut_({ status: 'ok' });
      }
      var critVals = [
        targetId || ('CRIT-' + Date.now()),
        String(data.naturaleza || 'Costo Variable'),
        String(data.categoriaForms || 'Otros gastos operativos'),
        String(data.categoriaPrincipal || 'Otros gastos operativos'),
        String(data.subtipo || 'General'),
        String(data.palabrasClave || data.palabrasClaveIA || ''),
        data.aplicaIgv || data.aplicaIgvDefecto ? 'SI' : 'NO',
        Number(data.topeAlerta || data.topeAlertaSoles || 250),
        String(data.estado || 'ACTIVO'),
        new Date(),
        String(data.modificadoPor || '')
      ];
      if (cRow > 0) {
        critSheet.getRange(cRow, 1, 1, critCols.length).setValues([critVals]);
      } else {
        critSheet.appendRow(critVals);
      }
      return jsonOut_({ status: 'ok' });
    }

    if (action === 'guardarPermisosUsuarios') {
      if (!isManagerCargo_(data.cargo || 'GERENTE')) {
        return jsonOut_({ status: 'error', message: 'Solo Gerencia puede gestionar permisos.' });
      }
      var hojaPerm = ss.getSheetByName('PERMISOS_ACCESO') || ss.insertSheet('PERMISOS_ACCESO');
      hojaPerm.clearContents();
      hojaPerm.appendRow(['USUARIO', 'ACCESO_PERMITIDO', 'MODIFICADO_POR', 'FECHA']);
      var permisos = data.permisos || {};
      Object.keys(permisos).forEach(function(usr) {
        hojaPerm.appendRow([usr, permisos[usr] ? 'SI' : 'NO', data.modificadoPor || '', new Date()]);
      });
      return jsonOut_({ status: 'ok' });
    }

    if (action === 'guardarPresupuestoMensual') {
      if (!isManagerCargo_(data.cargo)) {
        return jsonOut_({ status: 'error', message: 'Solo Gerencia puede asignar presupuestos mensuales.' });
      }
      var bSheet = ss.getSheetByName('PRESUPUESTOS_MENSUALES') || ss.insertSheet('PRESUPUESTOS_MENSUALES');
      var bCols = [
        'ID', 'SEDE', 'ANIO', 'MES', 'FIJO_TOTAL', 'VARIABLE_TOTAL',
        'VISIBILIDAD_DEFECTO', 'JSON_CONFIG', 'ASIGNADO_POR', 'FECHA_ACTUALIZACION'
      ];
      if (bSheet.getLastRow() === 0) bSheet.appendRow(bCols);
      var p = data.presupuesto || {};
      var bId = String(p.id || (p.sede + '::' + p.anio + '::' + p.mes)).toUpperCase();
      var bRows = sheetToObjects_(bSheet);
      var bTarget = -1;
      for (var bi = 0; bi < bRows.length; bi++) {
        if (String(bRows[bi].ID || '').toUpperCase() === bId) {
          bTarget = bi + 2;
          break;
        }
      }
      var bVals = [
        bId,
        String(p.sede || '').toUpperCase(),
        String(p.anio || ''),
        String(p.mes || '').toUpperCase(),
        Number(p.presupuestoFijoTotal || 0),
        Number(p.presupuestoVariableTotal || 0),
        String(p.visibilidadPorDefecto || 'ALL'),
        JSON.stringify(p),
        String(data.usuario || ''),
        new Date()
      ];
      if (bTarget > 0) {
        bSheet.getRange(bTarget, 1, 1, bCols.length).setValues([bVals]);
      } else {
        bSheet.appendRow(bVals);
      }
      return jsonOut_({ status: 'ok', id: bId });
    }

    return jsonOut_({ status: 'error', message: 'Acción no reconocida: ' + action });
  } catch (err) {
    return jsonOut_({ status: 'error', message: String(err) });
  }
}`;
