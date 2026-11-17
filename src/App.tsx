import { useCallback, useEffect, useState } from 'react';
import { LogOut, RefreshCw } from 'lucide-react';
import {
  CREDIBAN_COMPANY,
  type ExpenseCriterion,
  type ExpenseRecord,
  type NaturalezaGasto,
  type SedeRecord,
  type UserSession,
} from './types/crediban';
import { DEFAULT_CRITERIA, DEFAULT_SEDES, SEED_EXPENSES } from './data/seedData';
import { fetchInitialAppBundle } from './services/credibanApi';
import { isManagerUser } from './utils/accounting';
import { CredibanLogo } from './components/CredibanLogo';
import { LoginScreen } from './components/LoginScreen';
import { ScannerTab } from './components/ScannerTab';
import { SearchTab } from './components/SearchTab';
import { DashboardTab } from './components/DashboardTab';
import { ConfigTab } from './components/ConfigTab';
import { EvidenceModal } from './components/EvidenceModal';

type ActiveTab = 'scanner' | 'search' | 'dashboard' | 'config';

const SESSION_KEY = 'crediban_active_session_v1';

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
  const [expenses, setExpenses] = useState<ExpenseRecord[]>(SEED_EXPENSES);
  const [criteria, setCriteria] = useState<ExpenseCriterion[]>(DEFAULT_CRITERIA);
  const [sedes, setSedes] = useState<SedeRecord[]>(DEFAULT_SEDES);
  const [syncing, setSyncing] = useState(false);
  const [syncSource, setSyncSource] = useState<'live' | 'cache'>('cache');
  const [selectedExpense, setSelectedExpense] = useState<ExpenseRecord | null>(null);

  const isManager = isManagerUser(user);

  const loadBackendData = useCallback(async (session: UserSession) => {
    setSyncing(true);
    try {
      const bundle = await fetchInitialAppBundle(session.sede, session.cargo);
      setExpenses(bundle.expenses);
      setCriteria(bundle.criteria);
      setSedes(bundle.sedes);
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
    setSelectedExpense(updated);
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
    subtipo: string
  ) => {
    setCriteria((prev) =>
      prev.map((c) =>
        c.idCriterio === idCriterio ? { ...c, naturaleza: nuevaNaturaleza } : c
      )
    );
    if (reclasificarHistoricos) {
      setExpenses((prev) =>
        prev.map((e) =>
          e.categoriaPrincipal === categoriaPrincipal && e.subtipo === subtipo
            ? { ...e, naturaleza: nuevaNaturaleza }
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

  const handleSedeCreated = (sede: SedeRecord) => {
    setSedes((prev) => [...prev.filter((s) => s.nombreSede !== sede.nombreSede), sede]);
  };

  return (
    <div className="min-h-screen bg-[#f1f5f9] flex flex-col">
      {/* Corporate 3-Zone Top Header */}
      <header className="bg-[#0f291e] text-white border-b border-emerald-950/60 no-print">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-4 lg:gap-8">
          {/* Zone 1: Brand Logo */}
          <CredibanLogo variant="header" />

          {/* Zone 2: Single-Line Navigation Tabs */}
          <nav
            aria-label="Módulos principales"
            className="flex items-center gap-1 sm:gap-2 overflow-x-auto"
          >
            <button
              type="button"
              onClick={() => setActiveTab('scanner')}
              className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                activeTab === 'scanner'
                  ? 'bg-[#59B447] text-white'
                  : 'text-emerald-100 hover:text-white hover:bg-white/10'
              }`}
            >
              1. Escáner IA
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('search')}
              className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                activeTab === 'search'
                  ? 'bg-[#59B447] text-white'
                  : 'text-emerald-100 hover:text-white hover:bg-white/10'
              }`}
            >
              2. Buscador RUC
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                activeTab === 'dashboard'
                  ? 'bg-[#59B447] text-white'
                  : 'text-emerald-100 hover:text-white hover:bg-white/10'
              }`}
            >
              3. Dashboard
            </button>
            {isManager && (
              <button
                type="button"
                onClick={() => setActiveTab('config')}
                className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  activeTab === 'config'
                    ? 'bg-[#59B447] text-white'
                    : 'text-emerald-100 hover:text-white hover:bg-white/10'
                }`}
              >
                4. Criterios y Sedes
              </button>
            )}
          </nav>

          {/* Zone 3: Account Action */}
          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden md:inline text-xs text-emerald-100 whitespace-nowrap">
              {user.usuario} · {user.sede}
            </span>
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-900">{CREDIBAN_COMPANY.nombre}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">RUC {CREDIBAN_COMPANY.ruc}</span>
            <span aria-hidden="true">·</span>
            <span>
              Perfil: <strong className="text-slate-800">{user.cargo}</strong> ({user.sede})
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
                ? 'Sincronizando Apps Script...'
                : syncSource === 'live'
                ? 'Sincronizado con Google Sheets'
                : 'Sincronizar con Sheets'}
            </span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        {activeTab === 'scanner' && (
          <ScannerTab
            user={user}
            sedes={sedes}
            criteria={criteria}
            existingExpenses={visibleExpenses}
            onExpenseCreated={handleExpenseCreated}
          />
        )}
        {activeTab === 'search' && (
          <SearchTab
            expenses={visibleExpenses}
            onSelectExpense={setSelectedExpense}
            onImportCsvRecords={handleImportCsvRecords}
          />
        )}
        {activeTab === 'dashboard' && (
          <DashboardTab
            user={user}
            expenses={visibleExpenses}
            sedes={sedes}
            onSelectExpense={setSelectedExpense}
          />
        )}
        {activeTab === 'config' && isManager && (
          <ConfigTab
            user={user}
            criteria={criteria}
            sedes={sedes}
            onCriterionMoved={handleCriterionMoved}
            onCriterionSaved={handleCriterionSaved}
            onSedeCreated={handleSedeCreated}
          />
        )}
      </main>

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
