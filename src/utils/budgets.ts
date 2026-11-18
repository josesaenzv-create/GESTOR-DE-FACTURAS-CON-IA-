import {
  MONTH_NAMES,
  type BudgetLineItem,
  type BudgetVisibilityMode,
  type ExpenseRecord,
  type MonthlySedeBudget,
  type SedeRecord,
  type UserSession,
} from '../types/crediban';
import { isAdminOrManagerUser, round2 } from './accounting';

export function buildBudgetKey(sede: string, anio: string, mes: string): string {
  return `${String(sede || '').trim().toUpperCase()}::${String(anio || '').trim()}::${String(
    mes || ''
  )
    .trim()
    .toUpperCase()}`;
}

export function getPreviousMonthPeriod(
  anio: string,
  mes: string
): { anio: string; mes: string } {
  const cleanMes = String(mes || '').trim().toUpperCase();
  const idx = MONTH_NAMES.indexOf(cleanMes as (typeof MONTH_NAMES)[number]);
  const numYear = parseInt(String(anio || new Date().getFullYear()), 10) || new Date().getFullYear();

  if (idx <= 0) {
    return {
      anio: String(numYear - 1),
      mes: 'DICIEMBRE',
    };
  }
  return {
    anio: String(numYear),
    mes: MONTH_NAMES[idx - 1],
  };
}

export function createDefaultBudgetFromSede(
  sede: SedeRecord | undefined,
  sedeName: string,
  anio: string,
  mes: string
): MonthlySedeBudget {
  const cleanSede = String(sedeName || sede?.nombreSede || 'HUACHO').trim().toUpperCase();
  const cleanAnio = String(anio || new Date().getFullYear()).trim();
  const cleanMes = String(mes || 'ENERO').trim().toUpperCase();
  return {
    id: buildBudgetKey(cleanSede, cleanAnio, cleanMes),
    sede: cleanSede,
    anio: cleanAnio,
    mes: cleanMes,
    presupuestoFijoTotal: round2(Number(sede?.presupuestoMensualFijo ?? 5000) || 0),
    presupuestoVariableTotal: round2(Number(sede?.presupuestoMensualVariable ?? 4000) || 0),
    partidas: [],
    visibilidadPorDefecto: 'HIDDEN',
    visibilidadPorUsuario: {},
    notasGerencia: '',
  };
}

export function replicateBudgetToMonth(
  source: MonthlySedeBudget,
  targetAnio: string,
  targetMes: string,
  managerUsuario: string
): MonthlySedeBudget {
  const cleanSede = source.sede.trim().toUpperCase();
  const cleanAnio = targetAnio.trim();
  const cleanMes = targetMes.trim().toUpperCase();

  return {
    ...source,
    id: buildBudgetKey(cleanSede, cleanAnio, cleanMes),
    sede: cleanSede,
    anio: cleanAnio,
    mes: cleanMes,
    partidas: (source.partidas || []).map((p, idx) => ({
      ...p,
      id: `PART-${Date.now()}-${idx}-${Math.floor(Math.random() * 1000)}`,
    })),
    visibilidadPorUsuario: { ...(source.visibilidadPorUsuario || {}) },
    asignadoPor: managerUsuario,
    updatedAt: new Date().toISOString(),
  };
}

export function resolveUserBudgetVisibility(
  budget: MonthlySedeBudget,
  user: UserSession | null
): BudgetVisibilityMode {
  if (!user) return 'HIDDEN';
  if (isAdminOrManagerUser(user)) return 'ALL';
  const key = String(user.usuario || '').trim().toUpperCase();
  if (budget.visibilidadPorUsuario && budget.visibilidadPorUsuario[key]) {
    return budget.visibilidadPorUsuario[key];
  }
  return budget.visibilidadPorDefecto || 'HIDDEN';
}

export function canUserAccessBudgetTab(
  user: UserSession | null,
  budgets: MonthlySedeBudget[]
): boolean {
  if (!user) return false;
  if (isAdminOrManagerUser(user)) return true;
  const userSede = String(user.sede || '').trim().toUpperCase();
  return budgets
    .filter((b) => String(b.sede || '').trim().toUpperCase() === userSede)
    .some((b) => resolveUserBudgetVisibility(b, user) !== 'HIDDEN');
}

export interface PartidaExecutionRow {
  item: BudgetLineItem;
  ejecutado: number;
  disponible: number;
  pct: number;
  status: 'Saludable' | 'Alerta' | 'Excedido';
  count: number;
}

export interface BudgetProgressReport {
  fijoAsignado: number;
  fijoEjecutado: number;
  fijoDisponible: number;
  fijoPct: number;
  variableAsignado: number;
  variableEjecutado: number;
  variableDisponible: number;
  variablePct: number;
  totalAsignado: number;
  totalEjecutado: number;
  totalDisponible: number;
  totalPct: number;
  partidasProgress: PartidaExecutionRow[];
  statusGeneral: 'Saludable' | 'Alerta' | 'Excedido';
}

function getBudgetStatus(pct: number, asignado: number, ejecutado: number): 'Saludable' | 'Alerta' | 'Excedido' {
  if (asignado <= 0) {
    return ejecutado > 0 ? 'Excedido' : 'Saludable';
  }
  if (pct > 100) return 'Excedido';
  if (pct >= 80) return 'Alerta';
  return 'Saludable';
}

function normalizeMatchToken(val: string): string {
  return String(val || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function matchesBudgetPartida(expense: ExpenseRecord, item: BudgetLineItem): boolean {
  if (expense.naturaleza !== item.naturaleza) return false;
  const target = normalizeMatchToken(item.categoriaMatch || item.concepto);
  if (!target) return false;

  const haystack = [
    expense.subtipo,
    expense.categoriaPrincipal,
    expense.categoriaForms,
    expense.descripcion,
  ]
    .map(normalizeMatchToken)
    .join(' | ');

  if (haystack.includes(target)) return true;

  // Match significant keywords (>= 4 chars) when concept is composite e.g. "Planillas y Sueldos"
  const keywords = target
    .split(/[\s,/+-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4);
  return keywords.some((kw) => haystack.includes(kw));
}

export function computeBudgetProgress(
  budget: MonthlySedeBudget,
  expenses: ExpenseRecord[]
): BudgetProgressReport {
  const cleanSede = budget.sede.trim().toUpperCase();
  const cleanAnio = budget.anio.trim();
  const cleanMes = budget.mes.trim().toUpperCase();

  const matchingExpenses = expenses.filter(
    (e) =>
      String(e.sede || '').trim().toUpperCase() === cleanSede &&
      String(e.anio || '').trim() === cleanAnio &&
      String(e.mes || '').trim().toUpperCase() === cleanMes
  );

  let fijoEjecutado = 0;
  let variableEjecutado = 0;
  for (const e of matchingExpenses) {
    const t = Number(e.total) || 0;
    if (e.naturaleza === 'Costo Fijo') fijoEjecutado += t;
    else variableEjecutado += t;
  }
  fijoEjecutado = round2(fijoEjecutado);
  variableEjecutado = round2(variableEjecutado);

  const fijoAsignado = round2(Number(budget.presupuestoFijoTotal) || 0);
  const variableAsignado = round2(Number(budget.presupuestoVariableTotal) || 0);
  const totalAsignado = round2(fijoAsignado + variableAsignado);
  const totalEjecutado = round2(fijoEjecutado + variableEjecutado);

  const fijoPct = fijoAsignado > 0 ? round2((fijoEjecutado / fijoAsignado) * 100) : 0;
  const variablePct =
    variableAsignado > 0 ? round2((variableEjecutado / variableAsignado) * 100) : 0;
  const totalPct = totalAsignado > 0 ? round2((totalEjecutado / totalAsignado) * 100) : 0;

  const partidasProgress: PartidaExecutionRow[] = (budget.partidas || []).map((item) => {
    const matched = matchingExpenses.filter((e) => matchesBudgetPartida(e, item));
    const ejecutado = round2(matched.reduce((acc, e) => acc + (Number(e.total) || 0), 0));
    const asignado = round2(Number(item.montoAsignado) || 0);
    const pct = asignado > 0 ? round2((ejecutado / asignado) * 100) : 0;
    return {
      item,
      ejecutado,
      disponible: round2(asignado - ejecutado),
      pct,
      status: getBudgetStatus(pct, asignado, ejecutado),
      count: matched.length,
    };
  });

  return {
    fijoAsignado,
    fijoEjecutado,
    fijoDisponible: round2(fijoAsignado - fijoEjecutado),
    fijoPct,
    variableAsignado,
    variableEjecutado,
    variableDisponible: round2(variableAsignado - variableEjecutado),
    variablePct,
    totalAsignado,
    totalEjecutado,
    totalDisponible: round2(totalAsignado - totalEjecutado),
    totalPct,
    partidasProgress,
    statusGeneral: getBudgetStatus(totalPct, totalAsignado, totalEjecutado),
  };
}
