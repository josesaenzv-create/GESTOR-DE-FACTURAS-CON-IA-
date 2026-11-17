import {
  DATA_API_URL,
  USERS_API_URL,
  type AiScanResult,
  type ExpenseCriterion,
  type ExpenseRecord,
  type NaturalezaGasto,
  type SedeRecord,
  type TipoComprobante,
  type UserSession,
} from '../types/crediban';
import {
  DEFAULT_CRITERIA,
  DEFAULT_SEDES,
  OFFLINE_FALLBACK_USERS,
  SEED_EXPENSES,
} from '../data/seedData';
import {
  formatCommaDecimal,
  getImpactLevel,
  getMonthNameFromIsoDate,
  getYearFromIsoDate,
  parseCommaDecimal,
} from '../utils/accounting';

export interface BackendBundle {
  expenses: ExpenseRecord[];
  criteria: ExpenseCriterion[];
  sedes: SedeRecord[];
  users: UserSession[];
  source: 'live' | 'cache';
  syncMessage?: string;
}

const LOCAL_CACHE_KEYS = {
  expenses: 'crediban_cache_expenses_v1',
  criteria: 'crediban_cache_criteria_v1',
  sedes: 'crediban_cache_sedes_v1',
  users: 'crediban_cache_users_v1',
};

function readCache<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeCache<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
}

export function normalizeDriveImageUrl(url: string): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  const matchId =
    raw.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
    raw.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (matchId && matchId[1] && raw.includes('drive.google.com')) {
    return `https://drive.google.com/thumbnail?id=${matchId[1]}&sz=w2000`;
  }
  return raw;
}

function normalizeIsoDate(raw: unknown): string {
  const str = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

export function normalizeExpenseFromBackend(row: Record<string, unknown>): ExpenseRecord {
  const get = (...keys: string[]): string | number => {
    for (const k of keys) {
      const val = row[k];
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        return typeof val === 'number' ? val : String(val);
      }
    }
    return '';
  };

  const fecha = normalizeIsoDate(get('Fecha', 'fecha', 'FECHA DE EMISION DEL COMPROBANTE'));
  const total = parseCommaDecimal(get('Monto (S/)', 'total', 'MONTO TOTAL: CON ( , )', 'monto'));
  const subtotalRaw = parseCommaDecimal(get('Subtotal', 'subtotal', 'SUBTOTAL'));
  const igv = parseCommaDecimal(get('IGV', 'igv', 'IGV (SOLO FACTURAS) CON ( , )'));
  const subtotal = subtotalRaw > 0 ? subtotalRaw : Math.max(0, total - igv);

  const natStr = String(get('Naturaleza', 'naturaleza', 'NATURALEZA') || 'Costo Variable');
  const naturaleza: NaturalezaGasto = natStr.toLowerCase().includes('fijo')
    ? 'Costo Fijo'
    : 'Costo Variable';

  const tipoRaw = String(
    get('Tipo_Comprobante', 'tipoComprobante', 'TIPO DE COMPROBANTE') || 'BOLETA'
  ).toUpperCase();
  const validTipos: TipoComprobante[] = [
    'FACTURA',
    'BOLETA',
    'TICKET DE VENTA',
    'RECIBO DE CAJA',
    'SOLO CAPTURA',
  ];
  const tipoComprobante = (
    validTipos.find((t) => tipoRaw.includes(t)) || 'BOLETA'
  ) as TipoComprobante;

  const linkRaw = String(
    get('Link_Foto_HD', 'linkFotoHd', 'LINK_THUMBNAIL_HD', 'FOTO O CAPTURA DEL COMPROBANTE')
  );

  return {
    id: String(get('ID', 'id', 'ID_REGISTRO') || `CB-${Date.now()}`),
    fecha,
    anio: String(get('Año', 'anio', 'AÑO') || getYearFromIsoDate(fecha)),
    mes: String(
      get('Mes', 'mes', 'PERIODO PARA EL CUAL DEBE REGISTRARSE') || getMonthNameFromIsoDate(fecha)
    ).toUpperCase(),
    sede: String(get('Sede', 'sede', 'FILIAL') || 'HUACHO').toUpperCase(),
    categoriaForms: String(
      get('CATEGORIA', 'categoriaForms', 'categoria', 'Categoría Principal') ||
        'Otros gastos operativos'
    ),
    naturaleza,
    categoriaPrincipal: String(
      get('Categoría Principal', 'categoriaPrincipal', 'CATEGORIA') || 'Otros gastos operativos'
    ),
    subtipo: String(get('Subtipo', 'subtipo', 'SUBTIPO') || 'General'),
    tipoComprobante,
    numeroComprobante: String(
      get('Numero_Comprobante', 'numeroComprobante', 'NUMERO DE COMPRANTE', 'Comprobante') || ''
    ),
    ruc: String(get('RUC', 'ruc') || '').replace(/\D/g, ''),
    razonSocial: String(
      get('Razon_Social', 'razonSocial', 'NOMBRE DE LA EMPRESA') || ''
    ),
    nombreComercial: String(
      get('Nombre_Comercial', 'nombreComercial', 'NOMBRE_COMERCIAL') || ''
    ),
    subtotal,
    igv,
    total,
    descripcion: String(get('Descripción', 'descripcion', 'DESCRIPCION') || ''),
    nivelImpacto:
      (String(get('Nivel_Impacto', 'nivelImpacto', 'NIVEL_IMPACTO')) as ExpenseRecord['nivelImpacto']) ||
      getImpactLevel(total),
    responsable: String(
      get('Registrado_Por', 'responsable', 'USUARIO_REGISTRO') || 'SISTEMA'
    ),
    cargoUsuario: String(get('Cargo_Usuario', 'cargoUsuario', 'CARGO_USUARIO') || ''),
    direccionGps: String(
      get('Direccion_GPS', 'direccionGps', 'DIRECCION_GPS') || ''
    ),
    coordenadasGps: String(
      get('Coordenadas_GPS', 'coordenadasGps', 'COORDENADAS_GPS') || ''
    ),
    linkMapa: String(get('Link_Mapa', 'linkMapa', 'LINK_MAPA_RUTA') || ''),
    linkFotoHd: normalizeDriveImageUrl(linkRaw),
    linkFotoView: linkRaw,
    estado: String(get('Estado', 'estado', 'ESTADO_AUDITORIA') || 'APROBADO'),
    marcaTemporal: String(get('Marca temporal', 'marcaTemporal') || ''),
  };
}

export function normalizeCriterionFromBackend(row: Record<string, unknown>): ExpenseCriterion {
  const natStr = String(row.Naturaleza || row.naturaleza || 'Costo Variable');
  return {
    idCriterio: String(row.ID_Criterio || row.idCriterio || `CRIT-${Date.now()}`),
    naturaleza: natStr.toLowerCase().includes('fijo') ? 'Costo Fijo' : 'Costo Variable',
    categoriaForms: String(row.Categoria_Forms || row.categoriaForms || 'Otros gastos operativos'),
    categoriaPrincipal: String(
      row.Categoria_Principal || row.categoriaPrincipal || 'Otros gastos operativos'
    ),
    subtipo: String(row.Subtipo || row.subtipo || 'General'),
    palabrasClaveIA: String(
      row.Palabras_Clave_IA || row.palabrasClaveIA || row.palabrasClave || ''
    ),
    aplicaIgvDefecto:
      row.Aplica_IGV_Defecto === true ||
      row.aplicaIgv === true ||
      String(row.Aplica_IGV_Defecto || row.aplicaIgvDefecto || row.aplicaIgv).toUpperCase() === 'SI' ||
      String(row.Aplica_IGV_Defecto || row.aplicaIgvDefecto || row.aplicaIgv).toUpperCase() === 'TRUE',
    topeAlertaSoles: Number(
      row.Tope_Alerta_Soles || row.topeAlertaSoles || row.topeAlerta || 250
    ),
    estado: String(row.Estado || row.estado || 'ACTIVO'),
    ultimaModificacion: String(row.Ultima_Modificacion || row.ultimaModificacion || ''),
    modificadoPor: String(row.Modificado_Por || row.modificadoPor || ''),
  };
}

export function normalizeSedeFromBackend(row: Record<string, unknown>): SedeRecord {
  const nombre = String(
    row.Nombre_Sede || row.nombreSede || row.nombre || row.sede || 'HUACHO'
  )
    .trim()
    .toUpperCase();
  return {
    codigoSede: String(row.Codigo_Sede || row.codigoSede || row.codigo || nombre.slice(0, 3)),
    nombreSede: nombre,
    estado: String(row.Estado || row.estado || 'ACTIVO'),
    presupuestoMensualFijo: Number(
      row.Presupuesto_Mensual_Fijo || row.presupuestoMensualFijo || row.presupuestoFijo || 5000
    ),
    presupuestoMensualVariable: Number(
      row.Presupuesto_Mensual_Variable ||
        row.presupuestoMensualVariable ||
        row.presupuestoVariable ||
        4000
    ),
    nombreHojaSede: String(
      row.Nombre_Hoja_Sede || row.nombreHojaSede || row.hoja || `SEDE_${nombre}`
    ),
    idCarpetaDrive: String(row.ID_Carpeta_Drive || row.idCarpetaDrive || ''),
  };
}

async function postToDataApi<T = Record<string, unknown>>(
  payload: Record<string, unknown>,
  timeoutMs = 15000
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(DATA_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchUsersDirectory(): Promise<UserSession[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    const res = await fetch(`${USERS_API_URL}?action=listar`, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      const rawUsers = Array.isArray(data)
        ? data
        : Array.isArray(data.usuarios)
        ? data.usuarios
        : Array.isArray(data.users)
        ? data.users
        : Array.isArray(data.data)
        ? data.data
        : [];
      if (rawUsers.length > 0) {
        const normalized: UserSession[] = rawUsers
          .map((u: Record<string, unknown>) => ({
            usuario: String(u.Usuario || u.usuario || u.nombre || '').trim(),
            cargo: String(u.Cargo || u.cargo || 'TRABAJADOR').trim().toUpperCase(),
            sede: String(u.Sede || u.sede || 'HUACHO').trim().toUpperCase(),
            clave: String(u.Clave || u.clave || ''),
            estado: String(u.Estado || u.estado || 'ACTIVO').toUpperCase(),
          }))
          .filter((u: UserSession) => Boolean(u.usuario) && u.estado !== 'INACTIVO');
        if (normalized.length > 0) {
          writeCache(LOCAL_CACHE_KEYS.users, normalized);
          return normalized;
        }
      }
    }
  } catch {
    // Fall back to cache
  }
  return readCache<UserSession[]>(LOCAL_CACHE_KEYS.users, OFFLINE_FALLBACK_USERS);
}

export async function authenticateUser(
  usuario: string,
  clave: string
): Promise<{ ok: boolean; user?: UserSession; message?: string }> {
  const cleanUser = usuario.trim();
  const cleanPass = clave.trim();
  if (!cleanUser || !cleanPass) {
    return { ok: false, message: 'Ingrese su usuario y clave.' };
  }

  // Run DATA_API_URL login & USERS_API_URL directory check in parallel with fast 4.5s timeout
  const [loginAttempt, directoryAttempt] = await Promise.allSettled([
    postToDataApi<Record<string, unknown>>(
      { action: 'login', usuario: cleanUser, clave: cleanPass },
      4500
    ),
    fetchUsersDirectory(),
  ]);

  if (loginAttempt.status === 'fulfilled' && loginAttempt.value) {
    const dataRes = loginAttempt.value;
    if (dataRes.status === 'ok' || dataRes.authenticated === true || dataRes.valido === true) {
      const raw = (dataRes.user || dataRes.usuario || dataRes) as Record<string, unknown>;
      return {
        ok: true,
        user: {
          usuario: String(raw.usuario || raw.Usuario || cleanUser).toUpperCase(),
          cargo: String(raw.cargo || raw.Cargo || 'TRABAJADOR').toUpperCase(),
          sede: String(raw.sede || raw.Sede || 'HUACHO').toUpperCase(),
          estado: 'ACTIVO',
        },
      };
    }
  }

  if (directoryAttempt.status === 'fulfilled') {
    const matched = directoryAttempt.value.find(
      (u) =>
        u.usuario.toLowerCase() === cleanUser.toLowerCase() &&
        (!u.clave || u.clave === cleanPass)
    );
    if (matched) {
      return {
        ok: true,
        user: {
          usuario: matched.usuario,
          cargo: matched.cargo,
          sede: matched.sede,
          estado: matched.estado || 'ACTIVO',
        },
      };
    }
  }

  // Offline security cache fallback (for resilience in remote agency)
  const fallbackMatch = OFFLINE_FALLBACK_USERS.find(
    (u) => u.usuario.toLowerCase() === cleanUser.toLowerCase() && u.clave === cleanPass
  );
  if (fallbackMatch) {
    return {
      ok: true,
      user: {
        usuario: fallbackMatch.usuario,
        cargo: fallbackMatch.cargo,
        sede: fallbackMatch.sede,
        isOfflineFallback: true,
      },
    };
  }

  return {
    ok: false,
    message: 'Credenciales inválidas o usuario no autorizado en el Script Maestro.',
  };
}

export async function fetchInitialAppBundle(
  sede: string,
  cargo: string
): Promise<BackendBundle> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const url = `${DATA_API_URL}?action=obtenerConfiguracionYDatos&sede=${encodeURIComponent(
      sede
    )}&cargo=${encodeURIComponent(cargo)}`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      const json = (await res.json()) as Record<string, unknown>;
      const rawExpenses = Array.isArray(json.comprobantes)
        ? json.comprobantes
        : Array.isArray(json.gastos)
        ? json.gastos
        : Array.isArray(json.registros)
        ? json.registros
        : Array.isArray(json.expenses)
        ? json.expenses
        : Array.isArray(json.datos)
        ? json.datos
        : [];

      const rawCriteria = Array.isArray(json.criteriosGastos)
        ? json.criteriosGastos
        : Array.isArray(json.criterios)
        ? json.criterios
        : Array.isArray(json.parametros)
        ? json.parametros
        : [];

      const rawSedes = Array.isArray(json.sedes) ? json.sedes : [];

      const expenses =
        rawExpenses.length > 0
          ? rawExpenses.map((r) => normalizeExpenseFromBackend(r as Record<string, unknown>))
          : readCache<ExpenseRecord[]>(LOCAL_CACHE_KEYS.expenses, SEED_EXPENSES);

      const criteriaList =
        rawCriteria.length > 0
          ? rawCriteria.map((c) => normalizeCriterionFromBackend(c as Record<string, unknown>))
          : readCache<ExpenseCriterion[]>(LOCAL_CACHE_KEYS.criteria, DEFAULT_CRITERIA);
      const criteria = Array.from(
        new Map(criteriaList.map((c) => [c.idCriterio, c])).values()
      );

      const sedesList =
        rawSedes.length > 0
          ? rawSedes.map((s) => normalizeSedeFromBackend(s as Record<string, unknown>))
          : readCache<SedeRecord[]>(LOCAL_CACHE_KEYS.sedes, DEFAULT_SEDES);
      const sedesUnique = Array.from(
        new Map(sedesList.map((s) => [s.nombreSede, s])).values()
      );

      writeCache(LOCAL_CACHE_KEYS.expenses, expenses);
      writeCache(LOCAL_CACHE_KEYS.criteria, criteria);
      writeCache(LOCAL_CACHE_KEYS.sedes, sedesUnique);

      const users = await fetchUsersDirectory();
      return {
        expenses,
        criteria,
        sedes: sedesUnique,
        users,
        source: 'live',
      };
    }
  } catch {
    // Fallback to local cache / seed
  }

  return {
    expenses: readCache<ExpenseRecord[]>(LOCAL_CACHE_KEYS.expenses, SEED_EXPENSES),
    criteria: readCache<ExpenseCriterion[]>(LOCAL_CACHE_KEYS.criteria, DEFAULT_CRITERIA),
    sedes: readCache<SedeRecord[]>(LOCAL_CACHE_KEYS.sedes, DEFAULT_SEDES),
    users: readCache<UserSession[]>(LOCAL_CACHE_KEYS.users, OFFLINE_FALLBACK_USERS),
    source: 'cache',
    syncMessage: 'Trabajando con caché local sincronizada.',
  };
}

export async function saveExpenseToBackend(
  record: ExpenseRecord,
  fotoBase64HD?: string,
  nombreArchivoFoto?: string
): Promise<{
  ok: boolean;
  savedRecord: ExpenseRecord;
  syncedToCloud: boolean;
  message?: string;
}> {
  const payload = {
    action: 'registrarComprobante',
    idRegistro: record.id,
    sede: record.sede,
    filial: record.sede,
    anio: record.anio,
    periodo: record.mes,
    mes: record.mes,
    categoria: record.categoriaForms,
    naturaleza: record.naturaleza,
    categoriaPrincipal: record.categoriaPrincipal,
    subtipo: record.subtipo,
    tipoComprobante: record.tipoComprobante,
    fechaEmision: record.fecha,
    numeroComprobante: record.numeroComprobante,
    razonSocial: record.razonSocial,
    nombreComercial: record.nombreComercial,
    ruc: record.ruc,
    subtotal: record.subtotal,
    igv: record.igv,
    total: record.total,
    montoConComa: formatCommaDecimal(record.total),
    igvConComa: formatCommaDecimal(record.igv),
    descripcion: record.descripcion,
    nivelImpacto: record.nivelImpacto,
    responsable: record.responsable,
    cargoUsuario: record.cargoUsuario,
    direccionGps: record.direccionGps,
    coordenadasGps: record.coordenadasGps,
    linkMapa: record.linkMapa,
    fotoBase64HD: fotoBase64HD || '',
    nombreArchivoFoto: nombreArchivoFoto || '',
  };

  let updatedRecord = { ...record };
  let synced = false;
  let msg = '';

  try {
    const res = await postToDataApi<Record<string, unknown>>(payload);
    if (res && res.status !== 'error') {
      synced = true;
      const driveView = String(res.urlView || res.linkFotoView || '');
      const driveThumb = String(res.urlThumbnail || res.linkFotoHd || '');
      if (driveThumb || driveView) {
        updatedRecord.linkFotoHd = normalizeDriveImageUrl(driveThumb || driveView);
        updatedRecord.linkFotoView = driveView || driveThumb;
      }
      if (res.idRegistro || res.id) {
        updatedRecord.id = String(res.idRegistro || res.id);
      }
      msg = 'Comprobante guardado en Google Sheets y Drive HD.';
    } else {
      msg = String(res?.message || 'Guardado localmente; pendiente sincronización en nube.');
    }
  } catch {
    msg = 'Sin respuesta del servidor Apps Script; guardado en caché local.';
  }

  const current = readCache<ExpenseRecord[]>(LOCAL_CACHE_KEYS.expenses, SEED_EXPENSES);
  const next = [updatedRecord, ...current.filter((r) => r.id !== updatedRecord.id)];
  writeCache(LOCAL_CACHE_KEYS.expenses, next);

  return {
    ok: true,
    savedRecord: updatedRecord,
    syncedToCloud: synced,
    message: msg,
  };
}

export async function updateExpenseInBackend(
  record: ExpenseRecord,
  usuario: UserSession
): Promise<{ ok: boolean; syncedToCloud: boolean; message: string }> {
  let synced = false;
  let msg = 'Registro actualizado localmente.';
  try {
    const res = await postToDataApi<Record<string, unknown>>({
      action: 'editarComprobante',
      idRegistro: record.id,
      usuario: usuario.usuario,
      cargo: usuario.cargo,
      sede: record.sede,
      datosNuevos: {
        ...record,
        montoConComa: formatCommaDecimal(record.total),
        igvConComa: formatCommaDecimal(record.igv),
      },
    });
    if (res && res.status !== 'error') {
      synced = true;
      msg = 'Comprobante actualizado en Google Sheets.';
    }
  } catch {
    // Local cache fallback
  }

  const current = readCache<ExpenseRecord[]>(LOCAL_CACHE_KEYS.expenses, SEED_EXPENSES);
  const next = current.map((r) => (r.id === record.id ? record : r));
  writeCache(LOCAL_CACHE_KEYS.expenses, next);

  return { ok: true, syncedToCloud: synced, message: msg };
}

export async function deleteExpenseInBackend(
  id: string,
  usuario: UserSession
): Promise<{ ok: boolean; syncedToCloud: boolean; message: string }> {
  let synced = false;
  let msg = 'Registro eliminado localmente.';
  try {
    const res = await postToDataApi<Record<string, unknown>>({
      action: 'eliminarComprobante',
      idRegistro: id,
      usuario: usuario.usuario,
      cargo: usuario.cargo,
      sede: usuario.sede,
    });
    if (res && res.status !== 'error') {
      synced = true;
      msg = 'Comprobante eliminado en Google Sheets.';
    }
  } catch {
    // Local cache fallback
  }

  const current = readCache<ExpenseRecord[]>(LOCAL_CACHE_KEYS.expenses, SEED_EXPENSES);
  writeCache(
    LOCAL_CACHE_KEYS.expenses,
    current.filter((r) => r.id !== id)
  );

  return { ok: true, syncedToCloud: synced, message: msg };
}

export async function moveCriterionNatureInBackend(params: {
  idCriterio?: string;
  categoriaPrincipal: string;
  subtipo: string;
  nuevaNaturaleza: NaturalezaGasto;
  reclasificarHistoricos: boolean;
  usuario: string;
}): Promise<{ ok: boolean; syncedToCloud: boolean; message: string }> {
  let synced = false;
  let msg = 'Criterio actualizado localmente.';
  try {
    const res = await postToDataApi<Record<string, unknown>>({
      action: 'moverNaturalezaCriterio',
      ...params,
    });
    if (res && res.status !== 'error') {
      synced = true;
      msg = 'Criterio contable actualizado en PARAMETROS_GASTOS.';
    }
  } catch {
    // Local update continues
  }
  return { ok: true, syncedToCloud: synced, message: msg };
}

export async function saveCriterionInBackend(
  criterion: ExpenseCriterion,
  usuario: string
): Promise<{ ok: boolean; syncedToCloud: boolean; message: string }> {
  let synced = false;
  let msg = 'Criterio guardado localmente.';
  try {
    const res = await postToDataApi<Record<string, unknown>>({
      action: 'guardarCriterioGasto',
      ...criterion,
      modificadoPor: usuario,
    });
    if (res && res.status !== 'error') {
      synced = true;
      msg = 'Criterio guardado en PARAMETROS_GASTOS.';
    }
  } catch {
    // Local update continues
  }
  return { ok: true, syncedToCloud: synced, message: msg };
}

export async function createSedeInBackend(
  sede: SedeRecord,
  usuario: string
): Promise<{ ok: boolean; syncedToCloud: boolean; message: string }> {
  let synced = false;
  let msg = `Sede ${sede.nombreSede} registrada localmente.`;
  try {
    const res = await postToDataApi<Record<string, unknown>>({
      action: 'crearSede',
      codigoSede: sede.codigoSede,
      nombreSede: sede.nombreSede,
      presupuestoMensualFijo: sede.presupuestoMensualFijo,
      presupuestoMensualVariable: sede.presupuestoMensualVariable,
      usuario,
    });
    if (res && res.status !== 'error') {
      synced = true;
      msg = `Sede ${sede.nombreSede}, hoja SEDE_${sede.nombreSede} y carpeta Drive creadas.`;
    }
  } catch {
    // Local update continues
  }
  return { ok: true, syncedToCloud: synced, message: msg };
}

export async function scanInvoiceWithGeminiApi(params: {
  imageBase64: string;
  mimeType: string;
  criteria: ExpenseCriterion[];
}): Promise<AiScanResult> {
  const res = await fetch('/api/scan-invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || 'Error al analizar el comprobante con Gemini Vision.');
  }
  return data.result as AiScanResult;
}
