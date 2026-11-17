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
  moveCriterionNatureInBackend,
  saveCriterionInBackend,
} from '../services/credibanApi';
import { exportExpensesToCsv } from '../utils/searchAndPivot';

interface ConfigTabProps {
  user: UserSession;
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
}

export const ConfigTab: React.FC<ConfigTabProps> = ({
  user,
  criteria,
  expenses,
  sedes,
  onCriterionMoved,
  onCriterionSaved,
  onCriterionRemoved,
  onSedeCreated,
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

  // New Sede Form
  const [sedeName, setSedeName] = useState('');
  const [sedeCode, setSedeCode] = useState('');
  const [sedeBudgetFixed, setSedeBudgetFixed] = useState('6000');
  const [sedeBudgetVar, setSedeBudgetVar] = useState('4500');

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
    };

    onSedeCreated(newSede);
    const res = await createSedeInBackend(newSede, user.usuario);
    setFeedback(res.message);
    setSedeName('');
    setSedeCode('');
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
                            onClick={() =>
                              onCriterionMoved(
                                item.idCriterio,
                                isFixed ? 'Costo Variable' : 'Costo Fijo',
                                reclassifyHistorical,
                                item.categoriaPrincipal,
                                item.subtipo
                              )
                            }
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

      {/* Sedes Management Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Building className="w-4 h-4 text-[#59B447]" />
          <h3 className="text-sm font-bold text-slate-900">
            Gestión Dinámica de Sedes (Servidor y Nube)
          </h3>
        </div>

        <form onSubmit={handleCreateSede} className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
          <div className="sm:col-span-2">
            <label htmlFor="sede-name" className="block text-xs font-medium text-slate-700 mb-1">
              Nombre Nueva Sede
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
            <label htmlFor="sede-pf" className="block text-xs font-medium text-slate-700 mb-1">
              Presup. Fijo (S/)
            </label>
            <input
              id="sede-pf"
              type="number"
              value={sedeBudgetFixed}
              onChange={(e) => setSedeBudgetFixed(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-[#1B4332] hover:bg-[#0f291e] text-white text-xs font-semibold rounded-lg cursor-pointer"
          >
            Crear Sede
          </button>
        </form>

        <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
          <span className="text-slate-500 font-medium">Sedes activas ({sedes.length}):</span>
          {sedes.map((s) => (
            <span key={s.nombreSede} className="font-mono font-semibold">
              {s.nombreSede}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
