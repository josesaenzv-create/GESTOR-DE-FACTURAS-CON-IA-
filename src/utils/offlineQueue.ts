import type { ExpenseRecord } from '../types/crediban';

const DB_NAME = 'crediban_offline_db';
const DB_VERSION = 1;
const STORE_PENDING = 'pending_expenses';
const STORE_SUPPLIERS = 'suppliers_ruc';

export interface OfflinePendingExpense {
  id: string;
  record: ExpenseRecord;
  fotoBase64HD?: string;
  nombreArchivoFoto?: string;
  createdAt: string;
  attempts: number;
  lastError?: string;
}

export interface OfflineSupplierRecord {
  ruc: string;
  razonSocial: string;
  nombreComercial: string;
  updatedAt: string;
}

function openOfflineDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_PENDING)) {
          db.createObjectStore(STORE_PENDING, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_SUPPLIERS)) {
          db.createObjectStore(STORE_SUPPLIERS, { keyPath: 'ruc' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function enqueueOfflineExpense(item: {
  record: ExpenseRecord;
  fotoBase64HD?: string;
  nombreArchivoFoto?: string;
  lastError?: string;
}): Promise<boolean> {
  const db = await openOfflineDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_PENDING, 'readwrite');
      const store = tx.objectStore(STORE_PENDING);
      const entry: OfflinePendingExpense = {
        id: item.record.id,
        record: item.record,
        fotoBase64HD: item.fotoBase64HD,
        nombreArchivoFoto: item.nombreArchivoFoto,
        createdAt: new Date().toISOString(),
        attempts: 0,
        lastError: item.lastError,
      };
      store.put(entry);
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
    } catch {
      db.close();
      resolve(false);
    }
  });
}

export async function listOfflineExpenses(): Promise<OfflinePendingExpense[]> {
  const db = await openOfflineDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_PENDING, 'readonly');
      const store = tx.objectStore(STORE_PENDING);
      const req = store.getAll();
      req.onsuccess = () => {
        db.close();
        resolve(Array.isArray(req.result) ? (req.result as OfflinePendingExpense[]) : []);
      };
      req.onerror = () => {
        db.close();
        resolve([]);
      };
    } catch {
      db.close();
      resolve([]);
    }
  });
}

export async function removeOfflineExpense(id: string): Promise<void> {
  const db = await openOfflineDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_PENDING, 'readwrite');
      tx.objectStore(STORE_PENDING).delete(id);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function syncSuppliersFromExpenses(expenses: ExpenseRecord[]): Promise<void> {
  const db = await openOfflineDb();
  if (!db || expenses.length === 0) {
    db?.close();
    return;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_SUPPLIERS, 'readwrite');
      const store = tx.objectStore(STORE_SUPPLIERS);
      for (const exp of expenses) {
        const ruc = String(exp.ruc || '').replace(/\D/g, '');
        const razon = String(exp.razonSocial || '').trim();
        if (ruc.length === 11 && razon) {
          const entry: OfflineSupplierRecord = {
            ruc,
            razonSocial: razon.toUpperCase(),
            nombreComercial: String(exp.nombreComercial || '').trim(),
            updatedAt: new Date().toISOString(),
          };
          store.put(entry);
        }
      }
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function lookupSupplierByRucOffline(
  rucRaw: string
): Promise<OfflineSupplierRecord | null> {
  const ruc = String(rucRaw || '').replace(/\D/g, '');
  if (ruc.length !== 11) return null;
  const db = await openOfflineDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_SUPPLIERS, 'readonly');
      const req = tx.objectStore(STORE_SUPPLIERS).get(ruc);
      req.onsuccess = () => {
        db.close();
        resolve((req.result as OfflineSupplierRecord) || null);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}
