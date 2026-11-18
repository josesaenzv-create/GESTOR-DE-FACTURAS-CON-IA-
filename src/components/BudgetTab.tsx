import React, { useEffect, useMemo, useState } from 'react';
import {
  Wallet,
  CopyPlus,
  Plus,
  Trash2,
  Eye,
  Lock,
  CheckCircle2,
  History,
  Save,
  Calculator,
  AlertTriangle,
} from 'lucide-react';
import {
  MONTH_NAMES,
  type BudgetLineItem,
  type BudgetVisibilityMode,
  type ExpenseCriterion,
  type ExpenseRecord,
  type MonthlySedeBudget,
  type NaturalezaGasto,
  type SedeRecord,
  type UserSession,
} from '../types/crediban';
import {
  formatCurrencySoles,
  isAdminOrManagerUser,
  isManagerUser,
  round2,
} from '../utils/accounting';
import {
  buildBudgetKey,
  computeBudgetProgress,
  createDefaultBudgetFromSede,
  getPreviousMonthPeriod,
  replicateBudgetToMonth,
  resolveUserBudgetVisibility,
} from '../utils/budgets';
import { saveMonthlyBudgetInBackend } from '../services/credibanApi';

interface BudgetTabProps {
  user: UserSession;
  usersDirectory: UserSession[];
  sedes: SedeRecord[];
  expenses: ExpenseRecord[];
  criteria: ExpenseCriterion[];
  budgets: MonthlySedeBudget[];
  isMobileMode?: boolean;
  onBudgetSaved: (saved: MonthlySedeBudget) => void;
}

const VISIBILITY_LABELS: Record<BudgetVisibilityMode, string> = {
  ALL: 'Completo (Fijos + Variables + Partidas)',
  ONLY_VARIABLE: 'Solo Gastos Variables',
  ONLY_FIXED: 'Solo Gastos Fijos',
  SUMMARY_ONLY: 'Solo Total Global',
  HIDDEN: 'Oculto (Sin acceso)',
};

const QUICK_PARTIDA_TEMPLATES: Array<{
  naturaleza: NaturalezaGasto;
  concepto: string;
  categoriaMatch: string;
}> = [
  { naturaleza: 'Costo Fijo', concepto: 'Planillas Sueldos', categoriaMatch: 'Planilla Sueldos' },
  { naturaleza: 'Costo Fijo', concepto: 'EsSalud / EPS', categoriaMatch: 'EsSalud' },
  { naturaleza: 'Costo Fijo', concepto: 'Movilidad Fija', categoriaMatch: 'movilidad fija' },
  {
    naturaleza: 'Costo Fijo',
    concepto: 'Gratificaciones / CTS / Beneficios',
    categoriaMatch: 'Beneficios Sociales',
  },
  {
    naturaleza: 'Costo Variable',
    concepto: 'Comisiones de Colocación / Cobranza',
    categoriaMatch: 'Comisi',
  },
  {
    naturaleza: 'Costo Variable',
    concepto: 'Incentivos / Viáticos / Movilidad',
    categoriaMatch: 'Movilidad',
  },
];

function getProgressBarColor(status: 'Saludable' | 'Alerta' | 'Excedido'): string {
  if (status === 'Excedido') return 'bg-red-600';
  if (status === 'Alerta') return 'bg-amber-500';
  return 'bg-[#59B447]';
}

function getStatusBadgeClasses(status: 'Saludable' | 'Alerta' | 'Excedido'): string {
  if (status === 'Excedido') return 'bg-red-50 text-red-700 border-red-200';
  if (status === 'Alerta') return 'bg-amber-50 text-amber-800 border-amber-200';
  return 'bg-emerald-50 text-emerald-800 border-emerald-200';
}

export const BudgetTab: React.FC<BudgetTabProps> = ({
  user,
  usersDirectory,
  sedes,
  expenses,
  criteria,
  budgets,
  isMobileMode = false,
  onBudgetSaved,
}) => {
  const isManager = isManagerUser(user);
  const currentYear = String(new Date().getFullYear());
  const currentMonth = MONTH_NAMES[new Date().getMonth()] || 'ENERO';

  const defaultSede = useMemo(() => {
    if (!isManager) return user.sede.toUpperCase();
    return sedes[0]?.nombreSede?.toUpperCase() || 'HUACHO';
  }, [isManager, sedes, user.sede]);

  const [selectedSede, setSelectedSede] = useState<string>(defaultSede);
  const [selectedYear, setSelectedYear] = useState<string>('2026');
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonth);

  const effectiveSede = isManager ? selectedSede : user.sede.toUpperCase();

  const yearOptions = useMemo(() => {
    const set = new Set<string>(['2025', '2026', '2027', currentYear]);
    for (const b of budgets) if (b.anio) set.add(b.anio);
    for (const e of expenses) if (e.anio) set.add(e.anio);
    return Array.from(set).sort().reverse();
  }, [budgets, expenses, currentYear]);

  const activeBudgetKey = buildBudgetKey(effectiveSede, selectedYear, selectedMonth);

  const storedBudget = useMemo(
    () => budgets.find((b) => b.id === activeBudgetKey),
    [budgets, activeBudgetKey]
  );

  const sedeObj = useMemo(
    () => sedes.find((s) => s.nombreSede.toUpperCase() === effectiveSede),
    [sedes, effectiveSede]
  );

  // Editable draft for managers (automatically syncs when Sede / Year / Month changes)
  const [draft, setDraft] = useState<MonthlySedeBudget>(() =>
    storedBudget || createDefaultBudgetFromSede(sedeObj, effectiveSede, selectedYear, selectedMonth)
  );
  const [newPartidaNat, setNewPartidaNat] = useState<NaturalezaGasto>('Costo Fijo');
  const [newPartidaConcepto, setNewPartidaConcepto] = useState('');
  const [newPartidaMatch, setNewPartidaMatch] = useState('');
  const [newPartidaMonto, setNewPartidaMonto] = useState('');
  const [replicateSourceId, setReplicateSourceId] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setDraft(
      storedBudget
        ? {
            ...storedBudget,
            partidas: [...(storedBudget.partidas || [])],
            visibilidadPorUsuario: { ...(storedBudget.visibilidadPorUsuario || {}) },
          }
        : createDefaultBudgetFromSede(sedeObj, effectiveSede, selectedYear, selectedMonth)
    );
    setNotice('');
  }, [activeBudgetKey, storedBudget, sedeObj, effectiveSede, selectedYear, selectedMonth]);

  const activeBudgetForView = isManager
    ? draft
    : storedBudget || createDefaultBudgetFromSede(sedeObj, effectiveSede, selectedYear, selectedMonth);

  const progress = useMemo(
    () => computeBudgetProgress(activeBudgetForView, expenses),
    [activeBudgetForView, expenses]
  );

  const visibility = useMemo(
    () => resolveUserBudgetVisibility(activeBudgetForView, user),
    [activeBudgetForView, user]
  );

  // Previous month & sede history for replication
  const prevPeriod = useMemo(
    () => getPreviousMonthPeriod(selectedYear, selectedMonth),
    [selectedYear, selectedMonth]
  );
  const prevMonthBudget = useMemo(
    () =>
      budgets.find(
        (b) => b.id === buildBudgetKey(effectiveSede, prevPeriod.anio, prevPeriod.mes)
      ),
    [budgets, effectiveSede, prevPeriod]
  );

  const sedeBudgetHistory = useMemo(
    () =>
      budgets
        .filter((b) => b.sede.toUpperCase() === effectiveSede)
        .sort((a, b) => `${b.anio}-${b.mes}`.localeCompare(`${a.anio}-${a.mes}`)),
    [budgets, effectiveSede]
  );

  const allBudgetHistory = useMemo(
    () =>
      [...budgets].sort((a, b) =>
        (b.updatedAt || b.id).localeCompare(a.updatedAt || a.id)
      ),
    [budgets]
  );

  // Collaborators belonging to the selected Sede (Cajeros & Asesores; Gerentes & Administradores always have full access)
  const sedeCollaborators = useMemo(() => {
    return usersDirectory.filter((u) => {
      if (isAdminOrManagerUser(u)) return false;
      const uSede = String(u.sede || '').toUpperCase();
      return uSede === effectiveSede || uSede === 'TODAS';
    });
  }, [usersDirectory, effectiveSede]);

  // Distinct criterion subtypes for quick dropdown matching
  const criterionConcepts = useMemo(() => {
    return criteria
      .filter((c) => c.estado !== 'INACTIVO')
      .map((c) => ({
        label: `${c.subtipo} (${c.categoriaPrincipal})`,
        naturaleza: c.naturaleza,
        subtipo: c.subtipo,
      }));
  }, [criteria]);

  const handleAddPartida = (
    naturaleza: NaturalezaGasto,
    concepto: string,
    categoriaMatch: string,
    monto: number
  ) => {
    if (!concepto.trim()) return;
    const item: BudgetLineItem = {
      id: `PART-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      naturaleza,
      concepto: concepto.trim(),
      categoriaMatch: (categoriaMatch || concepto).trim(),
      montoAsignado: round2(Math.max(0, monto)),
    };
    setDraft((prev) => ({
      ...prev,
      partidas: [...prev.partidas, item],
    }));
  };

  const handleUpdatePartidaMonto = (id: string, val: number) => {
    setDraft((prev) => ({
      ...prev,
      partidas: prev.partidas.map((p) =>
        p.id === id ? { ...p, montoAsignado: round2(Math.max(0, val)) } : p
      ),
    }));
  };

  const handleRemovePartida = (id: string) => {
    setDraft((prev) => ({
      ...prev,
      partidas: prev.partidas.filter((p) => p.id !== id),
    }));
  };

  const handleSyncPartidasToTotals = () => {
    const sumFijo = round2(
      draft.partidas
        .filter((p) => p.naturaleza === 'Costo Fijo')
        .reduce((acc, p) => acc + (Number(p.montoAsignado) || 0), 0)
    );
    const sumVar = round2(
      draft.partidas
        .filter((p) => p.naturaleza === 'Costo Variable')
        .reduce((acc, p) => acc + (Number(p.montoAsignado) || 0), 0)
    );
    setDraft((prev) => ({
      ...prev,
      presupuestoFijoTotal: sumFijo > 0 ? sumFijo : prev.presupuestoFijoTotal,
      presupuestoVariableTotal: sumVar > 0 ? sumVar : prev.presupuestoVariableTotal,
    }));
    setNotice(
      `Totales sincronizados desde el desglose: Fijos ${formatCurrencySoles(
        sumFijo
      )} · Variables ${formatCurrencySoles(sumVar)}.`
    );
  };

  const handleReplicateFrom = (sourceBudget: MonthlySedeBudget | undefined) => {
    if (!sourceBudget) return;
    const cloned = replicateBudgetToMonth(
      sourceBudget,
      selectedYear,
      selectedMonth,
      user.usuario
    );
    setDraft({
      ...cloned,
      sede: effectiveSede,
      id: buildBudgetKey(effectiveSede, selectedYear, selectedMonth),
    });
    setNotice(
      `Presupuesto replicado desde ${sourceBudget.mes} ${sourceBudget.anio}. Revisa los montos y presiona "Guardar Presupuesto Mensual".`
    );
  };

  const handleSaveBudget = async () => {
    if (!isManager) return;
    setSaving(true);
    setNotice('');
    try {
      const normalized: MonthlySedeBudget = {
        ...draft,
        id: buildBudgetKey(effectiveSede, selectedYear, selectedMonth),
        sede: effectiveSede,
        anio: selectedYear,
        mes: selectedMonth,
        presupuestoFijoTotal: round2(Math.max(0, Number(draft.presupuestoFijoTotal) || 0)),
        presupuestoVariableTotal: round2(
          Math.max(0, Number(draft.presupuestoVariableTotal) || 0)
        ),
      };
      const res = await saveMonthlyBudgetInBackend(normalized, user.usuario, user.cargo);
      onBudgetSaved({
        ...normalized,
        asignadoPor: user.usuario,
        updatedAt: new Date().toISOString(),
      });
      setNotice(res.message);
    } finally {
      setSaving(false);
    }
  };

  const showFijoCard = visibility === 'ALL' || visibility === 'ONLY_FIXED';
  const showVariableCard = visibility === 'ALL' || visibility === 'ONLY_VARIABLE';
  const showTotalCard = visibility === 'ALL' || visibility === 'SUMMARY_ONLY';
  const visiblePartidas = progress.partidasProgress.filter((row) => {
    if (visibility === 'ALL') return true;
    if (visibility === 'ONLY_FIXED') return row.item.naturaleza === 'Costo Fijo';
    if (visibility === 'ONLY_VARIABLE') return row.item.naturaleza === 'Costo Variable';
    return false;
  });

  return (
    <div className="space-y-5">
      {/* Header + Period / Sede Selector */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#1B4332] text-white flex items-center justify-center shrink-0">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900">
                {isManager
                  ? 'Gestión de Presupuestos Mensuales por Sede'
                  : `Presupuesto Mensual · Sede ${effectiveSede}`}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {isManager
                  ? 'Asigna topes mensuales de Gastos Fijos y Variables, partidas detalladas opcionales, visibilidad por usuario y réplica entre meses.'
                  : 'Consulta tu presupuesto autorizado del mes y el avance de ejecución en tiempo real.'}
              </p>
            </div>
          </div>

          {!isManager && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold shrink-0">
              <Eye className="w-3.5 h-3.5 text-[#1B4332]" />
              <span>{VISIBILITY_LABELS[visibility]}</span>
            </span>
          )}
        </div>

        {/* Selector Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
          <div>
            <label htmlFor="budget-sede" className="block text-xs font-medium text-slate-600 mb-1">
              Sede
            </label>
            <select
              id="budget-sede"
              value={effectiveSede}
              disabled={!isManager}
              onChange={(e) => setSelectedSede(e.target.value)}
              className="w-full px-3 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-lg disabled:bg-slate-100"
            >
              {sedes.map((s) => (
                <option key={s.nombreSede} value={s.nombreSede}>
                  {s.nombreSede}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="budget-year" className="block text-xs font-medium text-slate-600 mb-1">
              Año
            </label>
            <select
              id="budget-year"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="w-full px-3 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-lg"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="budget-month" className="block text-xs font-medium text-slate-600 mb-1">
              Mes del Presupuesto
            </label>
            <select
              id="budget-month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="w-full px-3 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-lg"
            >
              {MONTH_NAMES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          {isManager && (
            <div className="flex items-end gap-2">
              <button
                type="button"
                disabled={!prevMonthBudget}
                onClick={() => handleReplicateFrom(prevMonthBudget)}
                className="w-full px-3 py-2 text-xs font-semibold text-[#1B4332] bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 border border-emerald-200 rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
                title={
                  prevMonthBudget
                    ? `Copiar presupuesto de ${prevPeriod.mes} ${prevPeriod.anio}`
                    : `No existe presupuesto guardado en ${prevPeriod.mes} ${prevPeriod.anio}`
                }
              >
                <CopyPlus className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  Replicar {prevPeriod.mes.slice(0, 3)} {prevPeriod.anio}
                </span>
              </button>
            </div>
          )}
        </div>

        {notice && (
          <div
            role="status"
            className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800 flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{notice}</span>
          </div>
        )}
      </div>

      {/* Non-manager Hidden State */}
      {!isManager && visibility === 'HIDDEN' ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-900">
            Presupuesto Reservado por Gerencia
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            La Gerencia restringió temporalmente la visualización del presupuesto para{' '}
            <strong>{effectiveSede}</strong> ({selectedMonth} {selectedYear}).
          </p>
        </div>
      ) : (
        <>
          {/* Live Execution Progress Cards */}
          <div
            className={`grid gap-4 ${
              isMobileMode
                ? 'grid-cols-1'
                : showTotalCard && showFijoCard && showVariableCard
                ? 'grid-cols-1 md:grid-cols-3'
                : 'grid-cols-1 md:grid-cols-2'
            }`}
          >
            {showFijoCard && (
              <div className="bg-white rounded-xl border border-blue-200 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-blue-800 uppercase">
                      Presupuesto Gastos Fijos
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Planillas, EsSalud, Movilidad fija, Alquiler
                    </p>
                  </div>
                  <span
                    className={`px-2 py-0.5 text-[11px] font-bold rounded border ${getStatusBadgeClasses(
                      progress.fijoPct > 100
                        ? 'Excedido'
                        : progress.fijoPct >= 80
                        ? 'Alerta'
                        : 'Saludable'
                    )}`}
                  >
                    {progress.fijoPct}%
                  </span>
                </div>

                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-lg font-extrabold font-mono tabular-nums text-slate-900">
                    {formatCurrencySoles(progress.fijoEjecutado)}
                  </span>
                  <span className="text-xs font-mono text-slate-500">
                    de {formatCurrencySoles(progress.fijoAsignado)}
                  </span>
                </div>

                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      progress.fijoPct > 100
                        ? 'bg-red-600'
                        : progress.fijoPct >= 80
                        ? 'bg-amber-500'
                        : 'bg-blue-600'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, progress.fijoPct))}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-500">Disponible del mes:</span>
                  <span
                    className={`font-bold ${
                      progress.fijoDisponible < 0 ? 'text-red-700' : 'text-emerald-700'
                    }`}
                  >
                    {formatCurrencySoles(progress.fijoDisponible)}
                  </span>
                </div>
              </div>
            )}

            {showVariableCard && (
              <div className="bg-white rounded-xl border border-orange-200 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-orange-700 uppercase">
                      Presupuesto Gastos Variables
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Operación diaria, Comisiones, Viáticos, Insumos
                    </p>
                  </div>
                  <span
                    className={`px-2 py-0.5 text-[11px] font-bold rounded border ${getStatusBadgeClasses(
                      progress.variablePct > 100
                        ? 'Excedido'
                        : progress.variablePct >= 80
                        ? 'Alerta'
                        : 'Saludable'
                    )}`}
                  >
                    {progress.variablePct}%
                  </span>
                </div>

                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-lg font-extrabold font-mono tabular-nums text-slate-900">
                    {formatCurrencySoles(progress.variableEjecutado)}
                  </span>
                  <span className="text-xs font-mono text-slate-500">
                    de {formatCurrencySoles(progress.variableAsignado)}
                  </span>
                </div>

                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      progress.variablePct > 100
                        ? 'bg-red-600'
                        : progress.variablePct >= 80
                        ? 'bg-amber-500'
                        : 'bg-orange-500'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, progress.variablePct))}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-500">Disponible del mes:</span>
                  <span
                    className={`font-bold ${
                      progress.variableDisponible < 0 ? 'text-red-700' : 'text-emerald-700'
                    }`}
                  >
                    {formatCurrencySoles(progress.variableDisponible)}
                  </span>
                </div>
              </div>
            )}

            {showTotalCard && (
              <div className="bg-white rounded-xl border border-emerald-200 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-[#1B4332] uppercase">
                      Avance Total · {selectedMonth} {selectedYear}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Ejecución consolidada de sede {effectiveSede}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-0.5 text-[11px] font-bold rounded border ${getStatusBadgeClasses(
                      progress.statusGeneral
                    )}`}
                  >
                    {progress.statusGeneral} ({progress.totalPct}%)
                  </span>
                </div>

                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-lg font-extrabold font-mono tabular-nums text-[#1B4332]">
                    {formatCurrencySoles(progress.totalEjecutado)}
                  </span>
                  <span className="text-xs font-mono text-slate-500">
                    de {formatCurrencySoles(progress.totalAsignado)}
                  </span>
                </div>

                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${getProgressBarColor(progress.statusGeneral)}`}
                    style={{ width: `${Math.min(100, Math.max(0, progress.totalPct))}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-500">Saldo total disponible:</span>
                  <span
                    className={`font-bold ${
                      progress.totalDisponible < 0 ? 'text-red-700' : 'text-[#1B4332]'
                    }`}
                  >
                    {formatCurrencySoles(progress.totalDisponible)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Detailed Optional Partidas Progress (visible according to permissions) */}
          {visiblePartidas.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Avance por Partida / Concepto Específico ({selectedMonth} {selectedYear})
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Seguimiento mensual detallado según tope asignado por Gerencia.
                  </p>
                </div>
                <span className="text-xs font-mono text-slate-500">
                  {visiblePartidas.length} partida{visiblePartidas.length === 1 ? '' : 's'}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <th className="py-2.5 px-4">Concepto / Tipo</th>
                      <th className="py-2.5 px-4 text-right">Asignado</th>
                      <th className="py-2.5 px-4 text-right">Ejecutado</th>
                      <th className="py-2.5 px-4 text-right">Disponible</th>
                      <th className="py-2.5 px-4 w-44">Avance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {visiblePartidas.map((row) => (
                      <tr key={row.item.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-4">
                          <div className="font-semibold text-slate-900">{row.item.concepto}</div>
                          <div className="text-[11px] text-slate-500">
                            {row.item.naturaleza} · {row.count} doc{row.count === 1 ? '' : 's'}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums font-medium">
                          {formatCurrencySoles(row.item.montoAsignado)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold">
                          {formatCurrencySoles(row.ejecutado)}
                        </td>
                        <td
                          className={`py-2.5 px-4 text-right font-mono tabular-nums font-bold ${
                            row.disponible < 0 ? 'text-red-700' : 'text-emerald-700'
                          }`}
                        >
                          {formatCurrencySoles(row.disponible)}
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full ${getProgressBarColor(row.status)}`}
                                style={{ width: `${Math.min(100, Math.max(0, row.pct))}%` }}
                              />
                            </div>
                            <span className="font-mono font-bold text-[11px] w-12 text-right">
                              {row.pct}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeBudgetForView.notasGerencia && !isManager && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-900 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Nota de Gerencia:</span>{' '}
                {activeBudgetForView.notasGerencia}
              </div>
            </div>
          )}
        </>
      )}

      {/* MANAGER CONFIGURATION & ALLOCATION PANEL */}
      {isManager && (
        <div className="space-y-5">
          {/* 1. Montos Fijos / Variables & Partidas Opcionales */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Configurar Presupuesto · {effectiveSede} ({selectedMonth} {selectedYear})
                </h3>
                <p className="text-xs text-slate-500">
                  Define el tope mensual para Gastos Fijos y Gastos Variables. Si deseas mayor detalle, agrega partidas específicas opcionales abajo.
                </p>
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveBudget}
                className="px-4 py-2 bg-[#1B4332] hover:bg-[#0f291e] disabled:opacity-60 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? 'Guardando...' : 'Guardar Presupuesto Mensual'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-3.5 rounded-xl bg-blue-50/50 border border-blue-200">
                <label
                  htmlFor="budget-fijo-total"
                  className="block text-xs font-bold text-blue-900 mb-1"
                >
                  Presupuesto Gastos Fijos (S/)
                </label>
                <p className="text-[11px] text-blue-700 mb-2">
                  Planillas + EsSalud + Movilidad fija + Gratificaciones
                </p>
                <input
                  id="budget-fijo-total"
                  type="number"
                  step="0.01"
                  min="0"
                  value={draft.presupuestoFijoTotal}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      presupuestoFijoTotal: parseFloat(e.target.value) || 0,
                    }))
                  }
                  className="w-full px-3 py-2 text-sm font-mono font-bold bg-white border border-blue-300 rounded-lg"
                />
              </div>

              <div className="p-3.5 rounded-xl bg-orange-50/50 border border-orange-200">
                <label
                  htmlFor="budget-var-total"
                  className="block text-xs font-bold text-orange-900 mb-1"
                >
                  Presupuesto Gastos Variables (S/)
                </label>
                <p className="text-[11px] text-orange-700 mb-2">
                  Viáticos + Comisiones + Insumos + Mantenimiento
                </p>
                <input
                  id="budget-var-total"
                  type="number"
                  step="0.01"
                  min="0"
                  value={draft.presupuestoVariableTotal}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      presupuestoVariableTotal: parseFloat(e.target.value) || 0,
                    }))
                  }
                  className="w-full px-3 py-2 text-sm font-mono font-bold bg-white border border-orange-300 rounded-lg"
                />
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between">
                <div>
                  <p className="text-xs font-bold text-slate-800">Total Mensual Asignado</p>
                  <p className="text-xl font-extrabold font-mono tabular-nums text-[#1B4332] mt-1">
                    {formatCurrencySoles(
                      (Number(draft.presupuestoFijoTotal) || 0) +
                        (Number(draft.presupuestoVariableTotal) || 0)
                    )}
                  </p>
                </div>
                <div className="mt-2">
                  <label htmlFor="budget-notes" className="block text-[11px] font-medium text-slate-600 mb-1">
                    Nota / Lineamiento opcional para la sede
                  </label>
                  <input
                    id="budget-notes"
                    type="text"
                    value={draft.notasGerencia || ''}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, notasGerencia: e.target.value }))
                    }
                    placeholder="Ej. Priorizar control en viáticos..."
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
            </div>

            {/* Optional Detailed Line Items (Partidas) */}
            <div className="pt-4 border-t border-slate-200 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                    Desglose Opcional por Partida / Tipo Específico
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Opcional: asigna topes por concepto específico (Planillas, EsSalud, Movilidad, Gratificaciones o cualquier subtipo).
                  </p>
                </div>
                {draft.partidas.length > 0 && (
                  <button
                    type="button"
                    onClick={handleSyncPartidasToTotals}
                    className="px-3 py-1.5 text-xs font-semibold text-[#1B4332] bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Calculator className="w-3.5 h-3.5" />
                    <span>Sincronizar suma al Total Fijo/Variable</span>
                  </button>
                )}
              </div>

              {/* Quick Templates */}
              <div className="flex flex-wrap gap-1.5">
                {QUICK_PARTIDA_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.concepto}
                    type="button"
                    onClick={() =>
                      handleAddPartida(tpl.naturaleza, tpl.concepto, tpl.categoriaMatch, 500)
                    }
                    className="px-2.5 py-1 text-[11px] font-medium bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-md inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3 text-[#59B447]" />
                    <span>{tpl.concepto}</span>
                  </button>
                ))}
              </div>

              {/* Custom Partida Form */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="sm:col-span-3">
                  <label htmlFor="part-nat" className="block text-[11px] font-medium text-slate-600 mb-1">
                    Naturaleza
                  </label>
                  <select
                    id="part-nat"
                    value={newPartidaNat}
                    onChange={(e) => setNewPartidaNat(e.target.value as NaturalezaGasto)}
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="Costo Fijo">Costo Fijo</option>
                    <option value="Costo Variable">Costo Variable</option>
                  </select>
                </div>
                <div className="sm:col-span-4">
                  <label htmlFor="part-concept" className="block text-[11px] font-medium text-slate-600 mb-1">
                    Nombre de la Partida
                  </label>
                  <input
                    id="part-concept"
                    type="text"
                    list="budget-criteria-list"
                    value={newPartidaConcepto}
                    onChange={(e) => {
                      setNewPartidaConcepto(e.target.value);
                      if (!newPartidaMatch) setNewPartidaMatch(e.target.value);
                    }}
                    placeholder="Ej. Planillas, EsSalud, Gratificación..."
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                  />
                  <datalist id="budget-criteria-list">
                    {criterionConcepts.map((c, idx) => (
                      <option key={`${c.subtipo}-${idx}`} value={c.subtipo}>
                        {c.label}
                      </option>
                    ))}
                  </datalist>
                </div>
                <div className="sm:col-span-3">
                  <label htmlFor="part-monto" className="block text-[11px] font-medium text-slate-600 mb-1">
                    Monto Asignado (S/)
                  </label>
                  <input
                    id="part-monto"
                    type="number"
                    step="0.01"
                    min="0"
                    value={newPartidaMonto}
                    onChange={(e) => setNewPartidaMonto(e.target.value)}
                    placeholder="Ej. 1500.00"
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!newPartidaConcepto.trim()) return;
                      handleAddPartida(
                        newPartidaNat,
                        newPartidaConcepto,
                        newPartidaMatch || newPartidaConcepto,
                        parseFloat(newPartidaMonto) || 0
                      );
                      setNewPartidaConcepto('');
                      setNewPartidaMatch('');
                      setNewPartidaMonto('');
                    }}
                    className="w-full px-3 py-1.5 text-xs font-semibold text-white bg-[#1B4332] hover:bg-[#0f291e] rounded-lg inline-flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Agregar</span>
                  </button>
                </div>
              </div>

              {/* Editable Partidas List */}
              {draft.partidas.length > 0 && (
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
                  {draft.partidas.map((p) => (
                    <div
                      key={p.id}
                      className="px-3.5 py-2.5 bg-white flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <span
                          className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded mr-2 ${
                            p.naturaleza === 'Costo Fijo'
                              ? 'bg-blue-50 text-blue-700'
                              : 'bg-orange-50 text-orange-700'
                          }`}
                        >
                          {p.naturaleza}
                        </span>
                        <span className="font-semibold text-slate-900">{p.concepto}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 font-mono">S/</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          aria-label={`Monto asignado para ${p.concepto}`}
                          value={p.montoAsignado}
                          onChange={(e) =>
                            handleUpdatePartidaMonto(p.id, parseFloat(e.target.value) || 0)
                          }
                          className="w-28 px-2 py-1 text-xs font-mono font-bold text-right border border-slate-300 rounded-md"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemovePartida(p.id)}
                          aria-label={`Quitar partida ${p.concepto}`}
                          className="p-1.5 text-slate-400 hover:text-red-600 rounded cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 2. Visibility Control (Who sees what part of the budget) */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Control de Visibilidad del Presupuesto ({effectiveSede})
                </h3>
                <p className="text-xs text-slate-500">
                  Por defecto solo <strong>Gerentes y Administradores</strong> ven la pestaña Presupuesto; Cajeros y Asesores inician en <strong>Oculto</strong> hasta que habilites su acceso aquí.
                </p>
              </div>
              <div className="w-full sm:w-72">
                <label
                  htmlFor="budget-default-vis"
                  className="block text-[11px] font-semibold text-slate-600 mb-1"
                >
                  Visibilidad por defecto para la sede
                </label>
                <select
                  id="budget-default-vis"
                  value={draft.visibilidadPorDefecto}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      visibilidadPorDefecto: e.target.value as BudgetVisibilityMode,
                    }))
                  }
                  className="w-full px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg"
                >
                  {Object.entries(VISIBILITY_LABELS).map(([mode, label]) => (
                    <option key={mode} value={mode}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {sedeCollaborators.length > 0 && (
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <th className="py-2 px-3">Colaborador ({effectiveSede})</th>
                      <th className="py-2 px-3">Cargo</th>
                      <th className="py-2 px-3 text-right">Qué parte puede ver</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sedeCollaborators.map((u) => {
                      const key = u.usuario.toUpperCase();
                      const currentMode =
                        draft.visibilidadPorUsuario[key] || draft.visibilidadPorDefecto;
                      return (
                        <tr key={key} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-semibold text-slate-900">
                            {u.nombreCompleto || u.usuario}{' '}
                            <span className="font-mono font-normal text-slate-500">
                              ({u.usuario})
                            </span>
                          </td>
                          <td className="py-2 px-3 text-slate-600">{u.cargo}</td>
                          <td className="py-2 px-3 text-right">
                            <select
                              aria-label={`Visibilidad de presupuesto para ${u.usuario}`}
                              value={currentMode}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  visibilidadPorUsuario: {
                                    ...prev.visibilidadPorUsuario,
                                    [key]: e.target.value as BudgetVisibilityMode,
                                  },
                                }))
                              }
                              className="px-2.5 py-1 text-xs bg-white border border-slate-300 rounded-md"
                            >
                              {Object.entries(VISIBILITY_LABELS).map(([mode, label]) => (
                                <option key={mode} value={mode}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 3. History & Replicate Any Previous Month */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-[#1B4332]" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Historial de Presupuestos Asignados y Réplica Rápida
                  </h3>
                  <p className="text-xs text-slate-500">
                    Consulta presupuestos asignados anteriormente y copia cualquiera al mes actual ({selectedMonth} {selectedYear}).
                  </p>
                </div>
              </div>

              {allBudgetHistory.length > 0 && (
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Seleccionar mes histórico para replicar"
                    value={replicateSourceId}
                    onChange={(e) => setReplicateSourceId(e.target.value)}
                    className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="">Elegir mes guardado para replicar...</option>
                    {allBudgetHistory.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.sede} · {b.mes} {b.anio} (S/{' '}
                        {(b.presupuestoFijoTotal + b.presupuestoVariableTotal).toFixed(0)})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!replicateSourceId}
                    onClick={() => {
                      const src = budgets.find((b) => b.id === replicateSourceId);
                      handleReplicateFrom(src);
                    }}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-[#1B4332] hover:bg-[#0f291e] disabled:opacity-50 rounded-lg inline-flex items-center gap-1 cursor-pointer"
                  >
                    <CopyPlus className="w-3.5 h-3.5" />
                    <span>Replicar aquí</span>
                  </button>
                </div>
              )}
            </div>

            {sedeBudgetHistory.length === 0 && allBudgetHistory.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">
                Aún no hay presupuestos mensuales guardados. Configura los montos arriba y presiona &ldquo;Guardar Presupuesto Mensual&rdquo;.
              </p>
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <th className="py-2 px-3">Sede / Periodo</th>
                      <th className="py-2 px-3 text-right">Fijo</th>
                      <th className="py-2 px-3 text-right">Variable</th>
                      <th className="py-2 px-3 text-right">Total</th>
                      <th className="py-2 px-3">Partidas</th>
                      <th className="py-2 px-3">Visibilidad Defecto</th>
                      <th className="py-2 px-3 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {allBudgetHistory.map((b) => (
                      <tr key={b.id} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-semibold text-slate-900">
                          {b.sede} · {b.mes} {b.anio}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {formatCurrencySoles(b.presupuestoFijoTotal)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {formatCurrencySoles(b.presupuestoVariableTotal)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold tabular-nums text-[#1B4332]">
                          {formatCurrencySoles(
                            b.presupuestoFijoTotal + b.presupuestoVariableTotal
                          )}
                        </td>
                        <td className="py-2 px-3 text-slate-600">
                          {b.partidas?.length || 0} detalle(s)
                        </td>
                        <td className="py-2 px-3 text-slate-600">
                          {VISIBILITY_LABELS[b.visibilidadPorDefecto] || b.visibilidadPorDefecto}
                        </td>
                        <td className="py-2 px-3 text-right space-x-1.5 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedSede(b.sede);
                              setSelectedYear(b.anio);
                              setSelectedMonth(b.mes);
                            }}
                            className="px-2 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
                          >
                            Ver
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReplicateFrom(b)}
                            className="px-2 py-1 text-[11px] font-semibold text-[#1B4332] bg-emerald-50 hover:bg-emerald-100 rounded cursor-pointer"
                          >
                            Replicar a {selectedMonth}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
