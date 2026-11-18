import { useCallback, useEffect, useState } from 'react';
import {
  LogOut,
  RefreshCw,
  Smartphone,
  Monitor,
  Camera,
  Search,
  BarChart3,
  Sliders,
  Receipt,
  Wallet,
  CloudUpload,
  Sparkles,
  Wifi,
  WifiOff,
  Loader2,
} from 'lucide-react';
import {
  CREDIBAN_COMPANY,
  type ExpenseCriterion,
  type ExpenseRecord,
  type MonthlySedeBudget,
  type NaturalezaGasto,
  type SedeRecord,
  type UserSession,
} from './types/crediban';
import {
  DEFAULT_CRITERIA,
  DEFAULT_SEDES,
  OFFLINE_FALLBACK_USERS,
  SEED_EXPENSES,
} from './data/seedData';
import {
  fetchInitialAppBundle,
  loadMonthlyBudgets,
  syncPendingOfflineExpenses,
} from './services/credibanApi';
import { isManagerUser, resolveUserSystemAccess } from './utils/accounting';
import { canUserAccessBudgetTab } from './utils/budgets';
import { listOfflineExpenses } from './utils/offlineQueue';
import {
  checkGeminiApiHealth,
  getEffectiveGeminiApiKey,
  type GeminiApiHealthStatus,
} from './utils/geminiVision';
import { CredibanLogo } from './components/CredibanLogo';
import { LoginScreen } from './components/LoginScreen';
import { ScannerTab } from './components/ScannerTab';
import { VoucherEmitterTab } from './components/VoucherEmitterTab';
import { SearchTab } from './components/SearchTab';
import { BudgetTab } from './components/BudgetTab';
import { DashboardTab } from './components/DashboardTab';
import { ConfigTab } from './components/ConfigTab';
import { EvidenceModal } from './components/EvidenceModal';

type ActiveTab = 'scanner' | 'vouchers' | 'search' | 'budget' | 'dashboard' | 'config';
type ViewMode = 'mobile' | 'pc';

const SESSION_KEY = 'crediban_active_session_v1';
const VIEW_MODE_KEY = 'crediban_view_mode_v1';

function loadSavedSession(): UserSession | null {
  try {
    const rawLocal = localStorage.getItem(SESSION_KEY);
    if (rawLocal) return JSON.parse(rawLocal) as UserSession;
    const rawSession = sessionStorage.getItem(SESSION_KEY);
    if (rawSession) return JSON.parse(rawSession) as UserSession;
  } catch {
    // ignore
  }
  return null;
}

function getInitialViewMode(): ViewMode {
  try {
    const saved = localStorage.getItem(VIEW_MODE_KEY);
    if (saved === 'mobile' || saved === 'pc') return saved;
  } catch {
    // ignore
  }
  // Primarily mobile-first by default on narrow viewports, or user-toggleable anytime
  if (typeof window !== 'undefined' && window.innerWidth < 768) {
    return 'mobile';
  }
  return 'mobile';
}

export default function App() {
  const [user, setUser] = useState<UserSession | null>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const isLocalHost =
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1';
      // Security: Never allow URL ?autostart=1 privilege escalation on public deployments
      if (isLocalHost && params.get('autostart') === '1') {
        return {
          usuario: 'GERENCIA',
          cargo: 'GERENTE GENERAL',
          sede: 'TODAS',
        };
      }
    }
    return loadSavedSession();
  });

  const [activeTab, setActiveTab] = useState<ActiveTab>('scanner');
  const [viewMode, setViewMode] = useState<ViewMode>(getInitialViewMode);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>(SEED_EXPENSES);
  const [criteria, setCriteria] = useState<ExpenseCriterion[]>(DEFAULT_CRITERIA);
  const [sedes, setSedes] = useState<SedeRecord[]>(DEFAULT_SEDES);
  const [budgets, setBudgets] = useState<MonthlySedeBudget[]>(() => loadMonthlyBudgets());
  const [usersDirectory, setUsersDirectory] = useState<UserSession[]>(OFFLINE_FALLBACK_USERS);
  const [syncing, setSyncing] = useState(false);
  const [syncSource, setSyncSource] = useState<'live' | 'cache'>('cache');
  const [selectedExpense, setSelectedExpense] = useState<ExpenseRecord | null>(null);
  const [geminiHealth, setGeminiHealth] = useState<GeminiApiHealthStatus>({
    status: 'missing',
    message: 'Verificando conexión Gemini IA...',
  });
  const [checkingGeminiHealth, setCheckingGeminiHealth] = useState(false);
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0);
  const [syncingOfflineQueue, setSyncingOfflineQueue] = useState(false);

  const isManager = isManagerUser(user);
  const canSeeBudget = canUserAccessBudgetTab(user, budgets);
  const isMobileMode = viewMode === 'mobile';
  const mobileTabCount = 3 + (canSeeBudget ? 1 : 0) + (isManager ? 2 : 0);
  const mobileGridClass =
    mobileTabCount === 6
      ? 'grid-cols-6'
      : mobileTabCount === 5
      ? 'grid-cols-5'
      : mobileTabCount === 4
      ? 'grid-cols-4'
      : 'grid-cols-3';

  const refreshOfflineCount = useCallback(async () => {
    try {
      const pending = await listOfflineExpenses();
      setPendingOfflineCount(pending.length);
    } catch {
      // ignore IndexedDB unavailability
    }
  }, []);

  const refreshGeminiHealth = useCallback(async () => {
    setCheckingGeminiHealth(true);
    try {
      const { apiKey } = getEffectiveGeminiApiKey();
      const status = await checkGeminiApiHealth(apiKey);
      setGeminiHealth(status);
    } finally {
      setCheckingGeminiHealth(false);
    }
  }, []);

  const handleSetViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // ignore
    }
  };

  const handleLogout = useCallback(() => {
    setUser(null);
    setSelectedExpense(null);
    try {
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
  }, []);

  const loadBackendData = useCallback(
    async (session: UserSession) => {
      setSyncing(true);
      try {
        const bundle = await fetchInitialAppBundle(session.sede, session.cargo);
        // Security: Revoke remembered/active session if user was disabled by master script or Gerencia
        if (bundle.users.length > 0) {
          setUsersDirectory(bundle.users);
          const matchedUser = bundle.users.find(
            (u) => u.usuario.toUpperCase() === session.usuario.toUpperCase()
          );
          if (matchedUser && matchedUser.accesoSistema === false) {
            handleLogout();
            return;
          }
        }
        setExpenses(bundle.expenses);
        setCriteria(bundle.criteria);
        setSedes(bundle.sedes);
        if (bundle.budgets && bundle.budgets.length > 0) {
          setBudgets(bundle.budgets);
        }
        setSyncSource(bundle.source);
      } finally {
        setSyncing(false);
        void refreshGeminiHealth();
        void refreshOfflineCount();
      }
    },
    [handleLogout, refreshGeminiHealth, refreshOfflineCount]
  );

  const handleFlushOfflineQueue = useCallback(async () => {
    setSyncingOfflineQueue(true);
    try {
      const res = await syncPendingOfflineExpenses();
      setPendingOfflineCount(res.remainingCount);
      if (res.syncedCount > 0 && user) {
        await loadBackendData(user);
      }
    } finally {
      setSyncingOfflineQueue(false);
    }
  }, [loadBackendData, user]);

  useEffect(() => {
    if (user) {
      loadBackendData(user);
    }
  }, [user, loadBackendData]);

  useEffect(() => {
    if (!user) return;
    const onOnline = () => {
      void handleFlushOfflineQueue();
    };
    window.addEventListener('online', onOnline);
    void refreshOfflineCount();
    return () => window.removeEventListener('online', onOnline);
  }, [user, handleFlushOfflineQueue, refreshOfflineCount]);

  useEffect(() => {
    if (
      (!isManager && (activeTab === 'dashboard' || activeTab === 'config')) ||
      (!canSeeBudget && activeTab === 'budget')
    ) {
      setActiveTab('scanner');
    }
  }, [isManager, canSeeBudget, activeTab]);

  const handleLoginSuccess = (session: UserSession, remember: boolean) => {
    const { clave: _omitClave, ...safeSession } = session;
    setUser(safeSession);
    setActiveTab('scanner');
    try {
      if (remember) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(safeSession));
      } else {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(safeSession));
      }
    } catch {
      // ignore
    }
  };

  if (!user) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  const visibleExpenses = isManager
    ? expenses
    : expenses.filter((e) => e.sede.toUpperCase() === user.sede.toUpperCase());

  const handleExpenseCreated = (record: ExpenseRecord) => {
    setExpenses((prev) => [record, ...prev.filter((r) => r.id !== record.id)]);
  };

  const handleExpenseUpdated = (updated: ExpenseRecord) => {
    setExpenses((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    setSelectedExpense((prev) => (prev && prev.id === updated.id ? updated : prev));
  };

  const handleExpenseDeleted = (id: string) => {
    setExpenses((prev) => prev.filter((r) => r.id !== id));
  };

  const handleImportCsvRecords = (imported: ExpenseRecord[]) => {
    setExpenses((prev) => {
      const byId = new Map(prev.map((r) => [r.id, r]));
      for (const rec of imported) {
        byId.set(rec.id, rec);
      }
      return Array.from(byId.values());
    });
  };

  const handleCriterionMoved = (
    idCriterio: string,
    nuevaNaturaleza: NaturalezaGasto,
    reclasificarHistoricos: boolean,
    categoriaPrincipal: string,
    subtipo: string,
    nuevaCategoriaPrincipal?: string
  ) => {
    setCriteria((prev) =>
      prev.map((c) =>
        c.idCriterio === idCriterio
          ? {
              ...c,
              naturaleza: nuevaNaturaleza,
              categoriaPrincipal: nuevaCategoriaPrincipal || c.categoriaPrincipal,
            }
          : c
      )
    );
    if (reclasificarHistoricos) {
      setExpenses((prev) =>
        prev.map((e) =>
          e.categoriaPrincipal === categoriaPrincipal && e.subtipo === subtipo
            ? {
                ...e,
                naturaleza: nuevaNaturaleza,
                categoriaPrincipal: nuevaCategoriaPrincipal || e.categoriaPrincipal,
              }
            : e
        )
      );
    }
  };

  const handleCriterionSaved = (criterion: ExpenseCriterion) => {
    setCriteria((prev) => [
      criterion,
      ...prev.filter((c) => c.idCriterio !== criterion.idCriterio),
    ]);
  };

  const handleCriterionRemoved = (idCriterio: string) => {
    setCriteria((prev) => prev.filter((c) => c.idCriterio !== idCriterio));
  };

  const handleSedeCreated = (sede: SedeRecord) => {
    setSedes((prev) => [...prev.filter((s) => s.nombreSede !== sede.nombreSede), sede]);
  };

  const handleSedeUpdated = (updated: SedeRecord) => {
    setSedes((prev) =>
      prev.map((s) =>
        s.nombreSede.toUpperCase() === updated.nombreSede.toUpperCase() ? updated : s
      )
    );
  };

  return (
    <div className="min-h-screen bg-[#f1f5f9] flex flex-col">
      {/* Corporate Header */}
      <header className="bg-[#0f291e] text-white border-b border-emerald-950/60 no-print">
        <div
          className={`${
            isMobileMode ? 'max-w-lg' : 'max-w-7xl'
          } mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4`}
        >
          <CredibanLogo variant="header" />

          {/* Desktop Navigation Tabs (Hidden in Mobile Mode) */}
          {!isMobileMode && (
            <nav
              aria-label="Módulos principales"
              className="hidden md:flex items-center gap-2 overflow-x-auto"
            >
              <button
                type="button"
                onClick={() => setActiveTab('scanner')}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  activeTab === 'scanner'
                    ? 'bg-[#59B447] text-white'
                    : 'text-emerald-100 hover:text-white hover:bg-white/10'
                }`}
              >
                1. Escáner IA
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('vouchers')}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  activeTab === 'vouchers'
                    ? 'bg-[#59B447] text-white'
                    : 'text-emerald-100 hover:text-white hover:bg-white/10'
                }`}
              >
                2. Emitir Recibos
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('search')}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  activeTab === 'search'
                    ? 'bg-[#59B447] text-white'
                    : 'text-emerald-100 hover:text-white hover:bg-white/10'
                }`}
              >
                3. Buscador RUC
              </button>
              {canSeeBudget && (
                <button
                  type="button"
                  onClick={() => setActiveTab('budget')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    activeTab === 'budget'
                      ? 'bg-[#59B447] text-white'
                      : 'text-emerald-100 hover:text-white hover:bg-white/10'
                  }`}
                >
                  4. Presupuesto
                </button>
              )}
              {isManager && (
                <button
                  type="button"
                  onClick={() => setActiveTab('dashboard')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    activeTab === 'dashboard'
                      ? 'bg-[#59B447] text-white'
                      : 'text-emerald-100 hover:text-white hover:bg-white/10'
                  }`}
                >
                  5. Dashboard
                </button>
              )}
              {isManager && (
                <button
                  type="button"
                  onClick={() => setActiveTab('config')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    activeTab === 'config'
                      ? 'bg-[#59B447] text-white'
                      : 'text-emerald-100 hover:text-white hover:bg-white/10'
                  }`}
                >
                  6. Configuración
                </button>
              )}
            </nav>
          )}

          {/* View Mode Toggle (Celular / PC) + Logout */}
          <div className="flex items-center gap-2 shrink-0">
            <div
              role="group"
              aria-label="Modo de visualización"
              className="flex items-center p-0.5 bg-white/10 rounded-lg"
            >
              <button
                type="button"
                onClick={() => handleSetViewMode('mobile')}
                aria-label="Vista Celular"
                className={`px-2 py-1 text-xs font-medium rounded-md flex items-center gap-1 cursor-pointer transition-colors ${
                  isMobileMode
                    ? 'bg-[#59B447] text-white'
                    : 'text-emerald-100 hover:text-white'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Celular</span>
              </button>
              <button
                type="button"
                onClick={() => handleSetViewMode('pc')}
                aria-label="Vista PC"
                className={`px-2 py-1 text-xs font-medium rounded-md flex items-center gap-1 cursor-pointer transition-colors ${
                  !isMobileMode
                    ? 'bg-[#59B447] text-white'
                    : 'text-emerald-100 hover:text-white'
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">PC</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="px-3 py-1.5 text-xs font-semibold bg-white/10 hover:bg-white/20 text-white rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Salir</span>
            </button>
          </div>
        </div>
      </header>

      {/* Workspace Sub-Toolbar */}
      <div className="bg-white border-b border-slate-200 no-print">
        <div
          className={`${
            isMobileMode ? 'max-w-lg' : 'max-w-7xl'
          } mx-auto px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600`}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-900">{CREDIBAN_COMPANY.nombre}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">RUC {CREDIBAN_COMPANY.ruc}</span>
            <span aria-hidden="true">·</span>
            <span>
              <strong className="text-slate-800">{user.sede}</strong>
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Live Connection Indicators: Servidor + Gemini IA + Offline Queue */}
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-medium border ${
                syncSource === 'live'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-amber-50 text-amber-800 border-amber-200'
              }`}
              title={
                syncSource === 'live'
                  ? 'Conectado en vivo con Google Apps Script'
                  : 'Trabajando con caché local offline'
              }
            >
              {syncSource === 'live' ? (
                <Wifi className="w-3 h-3 text-emerald-600" />
              ) : (
                <WifiOff className="w-3 h-3 text-amber-600" />
              )}
              <span>{syncSource === 'live' ? 'Servidor Online' : 'Caché Offline'}</span>
            </span>

            <button
              type="button"
              onClick={() => refreshGeminiHealth()}
              disabled={checkingGeminiHealth}
              title={geminiHealth.message}
              aria-label="Estado de conexión con Gemini IA"
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-medium border cursor-pointer transition-colors ${
                checkingGeminiHealth
                  ? 'bg-slate-50 text-slate-600 border-slate-200'
                  : geminiHealth.status === 'connected'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                  : geminiHealth.status === 'error'
                  ? 'bg-red-50 text-red-800 border-red-200 hover:bg-red-100'
                  : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
              }`}
            >
              {checkingGeminiHealth ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Sparkles
                  className={`w-3 h-3 ${
                    geminiHealth.status === 'connected'
                      ? 'text-emerald-600'
                      : geminiHealth.status === 'error'
                      ? 'text-red-600'
                      : 'text-amber-600'
                  }`}
                />
              )}
              <span>
                {checkingGeminiHealth
                  ? 'Probando IA...'
                  : geminiHealth.status === 'connected'
                  ? `IA Conectada (${geminiHealth.model || 'Gemini'})`
                  : geminiHealth.status === 'error'
                  ? 'IA Error (Reintentar)'
                  : 'IA Sin clave'}
              </span>
            </button>

            {pendingOfflineCount > 0 && (
              <button
                type="button"
                disabled={syncingOfflineQueue}
                onClick={handleFlushOfflineQueue}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-semibold bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 cursor-pointer"
                title="Sincronizar comprobantes guardados sin conexión en IndexedDB"
              >
                <CloudUpload className="w-3 h-3" />
                <span>
                  {syncingOfflineQueue
                    ? 'Subiendo...'
                    : `${pendingOfflineCount} pendiente${
                        pendingOfflineCount === 1 ? '' : 's'
                      } offline`}
                </span>
              </button>
            )}

            <button
              type="button"
              disabled={syncing}
              onClick={() => loadBackendData(user)}
              className="text-xs font-medium text-[#1B4332] hover:text-[#59B447] flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>
                {syncing
                  ? 'Sincronizando...'
                  : syncSource === 'live'
                  ? 'Sincronizado'
                  : 'Sincronizar'}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main
        className={`flex-1 w-full mx-auto px-3 sm:px-6 py-4 sm:py-6 ${
          isMobileMode ? 'max-w-lg pb-24' : 'max-w-7xl pb-24 md:pb-8'
        }`}
      >
        {activeTab === 'scanner' && (
          <ScannerTab
            user={user}
            sedes={sedes}
            criteria={criteria}
            existingExpenses={visibleExpenses}
            isMobileMode={isMobileMode}
            geminiHealth={geminiHealth}
            onRefreshGeminiHealth={refreshGeminiHealth}
            pendingOfflineCount={pendingOfflineCount}
            onPendingQueueChanged={refreshOfflineCount}
            onExpenseCreated={handleExpenseCreated}
          />
        )}
        {activeTab === 'vouchers' && (
          <VoucherEmitterTab
            user={user}
            usersDirectory={usersDirectory}
            sedes={sedes}
            existingExpenses={visibleExpenses}
            isMobileMode={isMobileMode}
            onExpenseCreated={handleExpenseCreated}
            onExpenseUpdated={handleExpenseUpdated}
          />
        )}
        {activeTab === 'search' && (
          <SearchTab
            expenses={visibleExpenses}
            sedes={sedes}
            criteria={criteria}
            user={user}
            userName={user.nombreCompleto || user.usuario}
            isMobileMode={isMobileMode}
            onSelectExpense={setSelectedExpense}
            onDeleteExpense={handleExpenseDeleted}
            onImportCsvRecords={handleImportCsvRecords}
          />
        )}
        {activeTab === 'budget' && canSeeBudget && (
          <BudgetTab
            user={user}
            usersDirectory={usersDirectory}
            sedes={sedes}
            expenses={visibleExpenses}
            criteria={criteria}
            budgets={budgets}
            isMobileMode={isMobileMode}
            onBudgetSaved={(saved) =>
              setBudgets((prev) => [saved, ...prev.filter((b) => b.id !== saved.id)])
            }
          />
        )}
        {activeTab === 'dashboard' && isManager && (
          <DashboardTab
            user={user}
            expenses={visibleExpenses}
            sedes={sedes}
            criteria={criteria}
            onSelectExpense={setSelectedExpense}
            onDeleteExpense={handleExpenseDeleted}
          />
        )}
        {activeTab === 'config' && isManager && (
          <ConfigTab
            user={user}
            usersDirectory={usersDirectory}
            criteria={criteria}
            expenses={visibleExpenses}
            sedes={sedes}
            geminiHealth={geminiHealth}
            onGeminiHealthUpdated={refreshGeminiHealth}
            onCriterionMoved={handleCriterionMoved}
            onCriterionSaved={handleCriterionSaved}
            onCriterionRemoved={handleCriterionRemoved}
            onSedeCreated={handleSedeCreated}
            onSedeUpdated={handleSedeUpdated}
            onUsersAccessUpdated={(overrides) =>
              setUsersDirectory((prev) =>
                prev.map((u) => {
                  const key = u.usuario.toUpperCase();
                  return {
                    ...u,
                    accesoSistema: resolveUserSystemAccess({
                      estado: u.estado,
                      cargo: u.cargo,
                      override: overrides[key],
                    }),
                  };
                })
              )
            }
          />
        )}
      </main>

      {/* Bottom Sticky Thumb Navigation (Always active in Mobile Mode, and on narrow screens in PC mode) */}
      <nav
        aria-label="Navegación móvil"
        className={`fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 no-print ${
          isMobileMode ? 'block' : 'md:hidden'
        }`}
      >
        <div
          className={`${
            isMobileMode ? 'max-w-lg mx-auto' : ''
          } grid ${mobileGridClass} h-16`}
        >
          <button
            type="button"
            onClick={() => setActiveTab('scanner')}
            className={`flex flex-col items-center justify-center gap-1 text-[10px] sm:text-[11px] font-semibold cursor-pointer ${
              activeTab === 'scanner' ? 'text-[#1B4332] bg-emerald-50/70' : 'text-slate-500'
            }`}
          >
            <Camera className="w-4 h-4" />
            <span>Escáner</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('vouchers')}
            className={`flex flex-col items-center justify-center gap-1 text-[10px] sm:text-[11px] font-semibold cursor-pointer ${
              activeTab === 'vouchers' ? 'text-[#1B4332] bg-emerald-50/70' : 'text-slate-500'
            }`}
          >
            <Receipt className="w-4 h-4" />
            <span>Recibos</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('search')}
            className={`flex flex-col items-center justify-center gap-1 text-[10px] sm:text-[11px] font-semibold cursor-pointer ${
              activeTab === 'search' ? 'text-[#1B4332] bg-emerald-50/70' : 'text-slate-500'
            }`}
          >
            <Search className="w-4 h-4" />
            <span>Buscador</span>
          </button>
          {canSeeBudget && (
            <button
              type="button"
              onClick={() => setActiveTab('budget')}
              className={`flex flex-col items-center justify-center gap-1 text-[10px] sm:text-[11px] font-semibold cursor-pointer ${
                activeTab === 'budget' ? 'text-[#1B4332] bg-emerald-50/70' : 'text-slate-500'
              }`}
            >
              <Wallet className="w-4 h-4" />
              <span>Presup.</span>
            </button>
          )}
          {isManager && (
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className={`flex flex-col items-center justify-center gap-1 text-[10px] sm:text-[11px] font-semibold cursor-pointer ${
                activeTab === 'dashboard' ? 'text-[#1B4332] bg-emerald-50/70' : 'text-slate-500'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              <span>Panel</span>
            </button>
          )}
          {isManager && (
            <button
              type="button"
              onClick={() => setActiveTab('config')}
              className={`flex flex-col items-center justify-center gap-1 text-[10px] sm:text-[11px] font-semibold cursor-pointer ${
                activeTab === 'config' ? 'text-[#1B4332] bg-emerald-50/70' : 'text-slate-500'
              }`}
            >
              <Sliders className="w-4 h-4" />
              <span>Config</span>
            </button>
          )}
        </div>
      </nav>

      {selectedExpense && (
        <EvidenceModal
          record={selectedExpense}
          user={user}
          onClose={() => setSelectedExpense(null)}
          onUpdated={handleExpenseUpdated}
          onDeleted={handleExpenseDeleted}
        />
      )}
    </div>
  );
}
