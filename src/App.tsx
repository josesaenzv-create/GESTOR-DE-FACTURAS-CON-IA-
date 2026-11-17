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
} from 'lucide-react';
import {
  CREDIBAN_COMPANY,
  type ExpenseCriterion,
  type ExpenseRecord,
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
import { fetchInitialAppBundle } from './services/credibanApi';
import { isManagerUser } from './utils/accounting';
import { CredibanLogo } from './components/CredibanLogo';
import { LoginScreen } from './components/LoginScreen';
import { ScannerTab } from './components/ScannerTab';
import { VoucherEmitterTab } from './components/VoucherEmitterTab';
import { SearchTab } from './components/SearchTab';
import { DashboardTab } from './components/DashboardTab';
import { ConfigTab } from './components/ConfigTab';
import { EvidenceModal } from './components/EvidenceModal';

type ActiveTab = 'scanner' | 'vouchers' | 'search' | 'dashboard' | 'config';
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
      if (params.get('autostart') === '1') {
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
  const [usersDirectory, setUsersDirectory] = useState<UserSession[]>(OFFLINE_FALLBACK_USERS);
  const [syncing, setSyncing] = useState(false);
  const [syncSource, setSyncSource] = useState<'live' | 'cache'>('cache');
  const [selectedExpense, setSelectedExpense] = useState<ExpenseRecord | null>(null);

  const isManager = isManagerUser(user);
  const isMobileMode = viewMode === 'mobile';

  const handleSetViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // ignore
    }
  };

  const loadBackendData = useCallback(async (session: UserSession) => {
    setSyncing(true);
    try {
      const bundle = await fetchInitialAppBundle(session.sede, session.cargo);
      setExpenses(bundle.expenses);
      setCriteria(bundle.criteria);
      setSedes(bundle.sedes);
      if (bundle.users.length > 0) {
        setUsersDirectory(bundle.users);
      }
      setSyncSource(bundle.source);
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      loadBackendData(user);
    }
  }, [user, loadBackendData]);

  useEffect(() => {
    if (!isManager && (activeTab === 'dashboard' || activeTab === 'config')) {
      setActiveTab('scanner');
    }
  }, [isManager, activeTab]);

  const handleLoginSuccess = (session: UserSession, remember: boolean) => {
    setUser(session);
    setActiveTab('scanner');
    try {
      if (remember) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      } else {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      }
    } catch {
      // ignore
    }
  };

  const handleLogout = () => {
    setUser(null);
    setSelectedExpense(null);
    try {
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_KEY);
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
                  4. Dashboard
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
                  5. Configuración
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

          <button
            type="button"
            disabled={syncing}
            onClick={() => loadBackendData(user)}
            className="text-xs font-medium text-[#1B4332] hover:text-[#59B447] flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>
              {syncing
                ? 'Sincronizando con Servidor...'
                : syncSource === 'live'
                ? 'Sincronizado con Servidor'
                : 'Sincronizar con Servidor'}
            </span>
          </button>
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
            onImportCsvRecords={handleImportCsvRecords}
          />
        )}
        {activeTab === 'dashboard' && isManager && (
          <DashboardTab
            user={user}
            expenses={visibleExpenses}
            sedes={sedes}
            criteria={criteria}
            onSelectExpense={setSelectedExpense}
          />
        )}
        {activeTab === 'config' && isManager && (
          <ConfigTab
            user={user}
            usersDirectory={usersDirectory}
            criteria={criteria}
            expenses={visibleExpenses}
            sedes={sedes}
            onCriterionMoved={handleCriterionMoved}
            onCriterionSaved={handleCriterionSaved}
            onCriterionRemoved={handleCriterionRemoved}
            onSedeCreated={handleSedeCreated}
            onSedeUpdated={handleSedeUpdated}
            onUsersAccessUpdated={(overrides) =>
              setUsersDirectory((prev) =>
                prev.map((u) => {
                  const key = u.usuario.toUpperCase();
                  return overrides[key] !== undefined
                    ? { ...u, accesoSistema: overrides[key] }
                    : u;
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
          } grid ${isManager ? 'grid-cols-5' : 'grid-cols-3'} h-16`}
        >
          <button
            type="button"
            onClick={() => setActiveTab('scanner')}
            className={`flex flex-col items-center justify-center gap-1 text-[11px] font-semibold cursor-pointer ${
              activeTab === 'scanner' ? 'text-[#1B4332] bg-emerald-50/70' : 'text-slate-500'
            }`}
          >
            <Camera className="w-4 h-4" />
            <span>Escáner</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('vouchers')}
            className={`flex flex-col items-center justify-center gap-1 text-[11px] font-semibold cursor-pointer ${
              activeTab === 'vouchers' ? 'text-[#1B4332] bg-emerald-50/70' : 'text-slate-500'
            }`}
          >
            <Receipt className="w-4 h-4" />
            <span>Recibos</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('search')}
            className={`flex flex-col items-center justify-center gap-1 text-[11px] font-semibold cursor-pointer ${
              activeTab === 'search' ? 'text-[#1B4332] bg-emerald-50/70' : 'text-slate-500'
            }`}
          >
            <Search className="w-4 h-4" />
            <span>Buscador</span>
          </button>
          {isManager && (
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className={`flex flex-col items-center justify-center gap-1 text-[11px] font-semibold cursor-pointer ${
                activeTab === 'dashboard' ? 'text-[#1B4332] bg-emerald-50/70' : 'text-slate-500'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              <span>Dashboard</span>
            </button>
          )}
          {isManager && (
            <button
              type="button"
              onClick={() => setActiveTab('config')}
              className={`flex flex-col items-center justify-center gap-1 text-[11px] font-semibold cursor-pointer ${
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
