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
import { parsePeruReceiptText } from '../utils/ocrParser';
import {
  calculateSalesIgvBreakdown,
  type MonthlySalesEntry,
} from '../utils/analytics';

export interface BackendBundle {
  expenses: ExpenseRecord[];
  criteria: ExpenseCriterion[];
  sedes: SedeRecord[];
  users: UserSession[];
  enabledSedeNames?: string[];
  source: 'live' | 'cache';
  syncMessage?: string;
}

const LOCAL_CACHE_KEYS = {
  expenses: 'crediban_cache_expenses_v1',
  criteria: 'crediban_cache_criteria_v1',
  sedes: 'crediban_cache_sedes_v1',
  sedeCustom: 'crediban_sede_custom_v1',
  users: 'crediban_cache_users_v1',
  enabledSedes: 'crediban_cache_enabled_sedes_v1',
  userAccess: 'crediban_user_access_v1',
  monthlySales: 'crediban_monthly_sales_v1',
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
    'YAPE / PLIN / TRANSFERENCIA',
    'RECIBO DE CAJA',
    'RECIBO DE MOVILIDAD',
    'TICKET DE VENTA',
    'SOLO CAPTURA',
  ];
  const tipoComprobante = (
    validTipos.find((t) => tipoRaw.includes(t)) ||
    (tipoRaw.includes('YAPE') || tipoRaw.includes('PLIN') || tipoRaw.includes('TRANSFER')
      ? 'YAPE / PLIN / TRANSFERENCIA'
      : tipoRaw.includes('MOVILIDAD')
      ? 'RECIBO DE MOVILIDAD'
      : 'BOLETA')
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
    titularCuenta: String(get('Titular_Cuenta', 'titularCuenta', 'TITULAR_CUENTA') || ''),
    numeroOperacion: String(get('Numero_Operacion', 'numeroOperacion', 'NUMERO_OPERACION') || ''),
    entidadPago: String(get('Entidad_Pago', 'entidadPago', 'ENTIDAD_PAGO') || ''),
    telefonoCuenta: String(get('Telefono_Cuenta', 'telefonoCuenta', 'TELEFONO_CUENTA') || ''),
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
  const seedMatch = DEFAULT_SEDES.find((s) => s.nombreSede === nombre);
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
    direccion: String(row.Direccion || row.direccion || seedMatch?.direccion || ''),
    ubicacion: String(row.Ubicacion || row.ubicacion || seedMatch?.ubicacion || `${nombre} - PERÚ`),
    telefono: String(row.Telefono || row.telefono || seedMatch?.telefono || ''),
    codigoSbs: String(
      row.Codigo_SBS ||
        row.codigoSbs ||
        seedMatch?.codigoSbs ||
        'INSCRITO EN LA SBS BAJO CODIGO REGISTRAL 00038222-2025'
    ),
    mensajePie: String(
      row.Mensaje_Pie || row.mensajePie || seedMatch?.mensajePie || '*** TE DESEO MUCHO EXITO ***'
    ),
    correoContacto: String(
      row.Correo_Contacto ||
        row.correoContacto ||
        seedMatch?.correoContacto ||
        'CREDIBANPERU@GMAIL.COM'
    ),
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

export function getUserAccessOverrides(): Record<string, boolean> {
  return readCache<Record<string, boolean>>(LOCAL_CACHE_KEYS.userAccess, {});
}

export async function saveUserAccessOverrides(
  overrides: Record<string, boolean>,
  managerUser: string
): Promise<{ ok: boolean; syncedToCloud: boolean; message: string }> {
  writeCache(LOCAL_CACHE_KEYS.userAccess, overrides);
  try {
    const res = await postToDataApi<Record<string, unknown>>({
      action: 'guardarPermisosUsuarios',
      permisos: overrides,
      modificadoPor: managerUser,
    });
    if (res && res.status !== 'error') {
      return {
        ok: true,
        syncedToCloud: true,
        message: 'Permisos de acceso actualizados en el Servidor.',
      };
    }
  } catch {
    // Saved locally even if server script hasn't been updated yet
  }
  return {
    ok: true,
    syncedToCloud: false,
    message: 'Permisos guardados localmente. Actualiza Código.gs para sincronizarlos en la nube.',
  };
}

export function loadMonthlySalesEntries(): MonthlySalesEntry[] {
  return readCache<MonthlySalesEntry[]>(LOCAL_CACHE_KEYS.monthlySales, []);
}

export function saveMonthlySalesEntry(
  anio: string,
  mes: string,
  montoBoleteado: number
): MonthlySalesEntry[] {
  const cleanAnio = anio.trim() || String(new Date().getFullYear());
  const cleanMes = mes.trim().toUpperCase();
  const breakdown = calculateSalesIgvBreakdown(montoBoleteado);
  const entry: MonthlySalesEntry = {
    anio: cleanAnio,
    mes: cleanMes,
    ...breakdown,
    updatedAt: new Date().toISOString(),
  };
  const current = loadMonthlySalesEntries();
  const next = [
    entry,
    ...current.filter((e) => !(e.anio === cleanAnio && e.mes.toUpperCase() === cleanMes)),
  ];
  writeCache(LOCAL_CACHE_KEYS.monthlySales, next);
  return next;
}

export interface MasterCatalogResult {
  users: UserSession[];
  enabledSedeNames: string[];
  fromLive: boolean;
}

export async function fetchMasterUsersCatalog(): Promise<MasterCatalogResult> {
  const overrides = getUserAccessOverrides();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5500);
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

      // Parse enabled sedes from USERS_API_URL catalogos.sedesHabilitadas / sedesTodas
      const cat = (data && typeof data === 'object' ? data.catalogos : null) as
        | {
            sedesHabilitadas?: unknown[];
            sedesTodas?: Array<{ sede?: string; estado?: string }>;
          }
        | null;

      let enabledSedeNames: string[] = [];
      if (cat && Array.isArray(cat.sedesHabilitadas)) {
        enabledSedeNames = cat.sedesHabilitadas
          .map((s) => String(s || '').trim().toUpperCase())
          .filter(Boolean);
      } else if (cat && Array.isArray(cat.sedesTodas)) {
        enabledSedeNames = cat.sedesTodas
          .filter((s) => String(s.estado || '').toUpperCase() === 'HABILITADO')
          .map((s) => String(s.sede || '').trim().toUpperCase())
          .filter(Boolean);
      }

      if (enabledSedeNames.length > 0) {
        writeCache(LOCAL_CACHE_KEYS.enabledSedes, enabledSedeNames);
      }

      if (rawUsers.length > 0) {
        const normalized: UserSession[] = rawUsers
          .map((u: Record<string, unknown>) => {
            const usuario = String(u.Usuario || u.usuario || u.nombre || '').trim();
            const nombreCompleto = String(
              u.nombreCompleto || u.Nombre_Completo || u.nombre || usuario
            )
              .trim()
              .toUpperCase();
            const estado = String(u.Estado || u.estado || 'HABILITADO').trim().toUpperCase();
            const masterDisabled =
              estado === 'DESHABILITADO' ||
              estado === 'INACTIVO' ||
              estado === 'BLOQUEADO' ||
              estado === 'SUSPENDIDO';
            const override = overrides[usuario.toUpperCase()];
            // Master script disable always takes strict precedence across all apps
            const accesoSistema = masterDisabled
              ? false
              : override !== undefined
              ? override
              : true;

            return {
              usuario,
              nombreCompleto,
              dni: String(u.dni || u.DNI || '').replace(/\D/g, ''),
              cargo: String(u.Cargo || u.cargo || 'TRABAJADOR').trim().toUpperCase(),
              sede: String(u.Sede || u.sede || 'HUACHO').trim().toUpperCase(),
              clave: String(u.Clave || u.clave || ''),
              estado,
              accesoSistema,
              equipo: String(u.equipo || ''),
              jefeAsignado: String(u.jefeEquipo || u.jefeAsignado || ''),
            };
          })
          .filter((u: UserSession) => Boolean(u.usuario));

        if (normalized.length > 0) {
          writeCache(LOCAL_CACHE_KEYS.users, normalized);
          return {
            users: normalized,
            enabledSedeNames,
            fromLive: true,
          };
        }
      }
    }
  } catch {
    // Fall back to cache
  }

  const cachedUsers = readCache<UserSession[]>(
    LOCAL_CACHE_KEYS.users,
    OFFLINE_FALLBACK_USERS
  ).map((u) => {
    const ov = overrides[u.usuario.toUpperCase()];
    const est = String(u.estado || 'HABILITADO').toUpperCase();
    const disabledInMaster =
      est === 'DESHABILITADO' || est === 'INACTIVO' || est === 'BLOQUEADO';
    return {
      ...u,
      nombreCompleto: u.nombreCompleto || u.usuario.replace(/\./g, ' '),
      accesoSistema: disabledInMaster ? false : ov !== undefined ? ov : u.accesoSistema !== false,
    };
  });

  const cachedEnabledSedes = readCache<string[]>(
    LOCAL_CACHE_KEYS.enabledSedes,
    DEFAULT_SEDES.map((s) => s.nombreSede)
  );

  return {
    users: cachedUsers,
    enabledSedeNames: cachedEnabledSedes,
    fromLive: false,
  };
}

export async function fetchUsersDirectory(): Promise<UserSession[]> {
  const { users } = await fetchMasterUsersCatalog();
  return users;
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

  const overrides = getUserAccessOverrides();
  if (overrides[cleanUser.toUpperCase()] === false) {
    return {
      ok: false,
      message: 'Tu acceso al sistema está restringido por Gerencia.',
    };
  }

  // Run DATA_API_URL login & USERS_API_URL directory check in parallel with fast 4.5s timeout
  const [loginAttempt, directoryAttempt] = await Promise.allSettled([
    postToDataApi<Record<string, unknown>>(
      { action: 'login', usuario: cleanUser, clave: cleanPass },
      4500
    ),
    fetchUsersDirectory(),
  ]);

  if (directoryAttempt.status === 'fulfilled') {
    const dirUser = directoryAttempt.value.find(
      (u) => u.usuario.toLowerCase() === cleanUser.toLowerCase()
    );
    if (dirUser && dirUser.accesoSistema === false) {
      return {
        ok: false,
        message: 'Usuario sin permiso de acceso al sistema. Consulta con Gerencia.',
      };
    }
  }

  if (loginAttempt.status === 'fulfilled' && loginAttempt.value) {
    const dataRes = loginAttempt.value;
    if (dataRes.status === 'ok' || dataRes.authenticated === true || dataRes.valido === true) {
      const raw = (dataRes.user || dataRes.usuario || dataRes) as Record<string, unknown>;
      return {
        ok: true,
        user: {
          usuario: String(raw.usuario || raw.Usuario || cleanUser).toUpperCase(),
          nombreCompleto: String(raw.nombreCompleto || cleanUser.replace(/\./g, ' ')).toUpperCase(),
          dni: String(raw.dni || ''),
          cargo: String(raw.cargo || raw.Cargo || 'TRABAJADOR').toUpperCase(),
          sede: String(raw.sede || raw.Sede || 'HUACHO').toUpperCase(),
          estado: 'HABILITADO',
          accesoSistema: true,
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
          nombreCompleto: matched.nombreCompleto,
          dni: matched.dni,
          cargo: matched.cargo,
          sede: matched.sede,
          estado: matched.estado || 'HABILITADO',
          accesoSistema: true,
        },
      };
    }
  }

  // Offline security cache fallback
  const fallbackMatch = OFFLINE_FALLBACK_USERS.find(
    (u) => u.usuario.toLowerCase() === cleanUser.toLowerCase() && u.clave === cleanPass
  );
  if (fallbackMatch) {
    return {
      ok: true,
      user: {
        usuario: fallbackMatch.usuario,
        nombreCompleto: fallbackMatch.usuario.replace(/\./g, ' '),
        cargo: fallbackMatch.cargo,
        sede: fallbackMatch.sede,
        accesoSistema: true,
        isOfflineFallback: true,
      },
    };
  }

  return {
    ok: false,
    message: 'Credenciales inválidas o usuario no autorizado en el Servidor.',
  };
}

export function loadSedeCustomizations(): Record<string, Partial<SedeRecord>> {
  return readCache<Record<string, Partial<SedeRecord>>>(LOCAL_CACHE_KEYS.sedeCustom, {});
}

function mergeSedeWithDefaultsAndCustom(
  sede: SedeRecord,
  customMap: Record<string, Partial<SedeRecord>>
): SedeRecord {
  const key = sede.nombreSede.trim().toUpperCase();
  const seedMatch = DEFAULT_SEDES.find((d) => d.nombreSede === key);
  const custom = customMap[key] || {};
  return {
    ...seedMatch,
    ...sede,
    ...custom,
    nombreSede: key,
    direccion:
      custom.direccion ??
      (sede.direccion || seedMatch?.direccion || 'DIRECCIÓN POR CONFIGURAR'),
    ubicacion:
      custom.ubicacion ??
      (sede.ubicacion || seedMatch?.ubicacion || `${key} - PERÚ`),
    telefono: custom.telefono ?? sede.telefono ?? seedMatch?.telefono ?? '',
    codigoSbs:
      custom.codigoSbs ??
      (sede.codigoSbs ||
        seedMatch?.codigoSbs ||
        'INSCRITO EN LA SBS BAJO CODIGO REGISTRAL 00038222-2025'),
    mensajePie:
      custom.mensajePie ??
      (sede.mensajePie || seedMatch?.mensajePie || '*** TE DESEO MUCHO EXITO ***'),
    correoContacto:
      custom.correoContacto ??
      (sede.correoContacto || seedMatch?.correoContacto || 'CREDIBANPERU@GMAIL.COM'),
  };
}

function filterSedesByMasterCatalog(
  sedesList: SedeRecord[],
  enabledSedeNames: string[]
): SedeRecord[] {
  const customMap = loadSedeCustomizations();
  if (!enabledSedeNames || enabledSedeNames.length === 0) {
    return sedesList.map((s) => mergeSedeWithDefaultsAndCustom(s, customMap));
  }
  const enabledSet = new Set(enabledSedeNames.map((s) => s.trim().toUpperCase()));
  const byName = new Map(sedesList.map((s) => [s.nombreSede.trim().toUpperCase(), s]));

  const filtered: SedeRecord[] = [];
  for (const enabledName of enabledSet) {
    const existing = byName.get(enabledName);
    const seedMatch = DEFAULT_SEDES.find((d) => d.nombreSede === enabledName);
    if (existing) {
      filtered.push(mergeSedeWithDefaultsAndCustom(existing, customMap));
    } else if (seedMatch) {
      filtered.push(mergeSedeWithDefaultsAndCustom(seedMatch, customMap));
    } else {
      filtered.push(
        mergeSedeWithDefaultsAndCustom(
          {
            codigoSede: enabledName.slice(0, 3),
            nombreSede: enabledName,
            estado: 'ACTIVO',
            presupuestoMensualFijo: 5000,
            presupuestoMensualVariable: 10000,
            nombreHojaSede: `SEDE_${enabledName}`,
          },
          customMap
        )
      );
    }
  }
  return filtered;
}

export async function fetchInitialAppBundle(
  sede: string,
  cargo: string
): Promise<BackendBundle> {
  const masterCatalogPromise = fetchMasterUsersCatalog();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const url = `${DATA_API_URL}?action=obtenerConfiguracionYDatos&sede=${encodeURIComponent(
      sede
    )}&cargo=${encodeURIComponent(cargo)}`;
    const [res, masterCatalog] = await Promise.all([
      fetch(url, { signal: controller.signal }),
      masterCatalogPromise,
    ]);
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
      const activeSedes = filterSedesByMasterCatalog(
        sedesUnique,
        masterCatalog.enabledSedeNames
      );

      writeCache(LOCAL_CACHE_KEYS.expenses, expenses);
      writeCache(LOCAL_CACHE_KEYS.criteria, criteria);
      writeCache(LOCAL_CACHE_KEYS.sedes, activeSedes);

      return {
        expenses,
        criteria,
        sedes: activeSedes,
        users: masterCatalog.users,
        enabledSedeNames: masterCatalog.enabledSedeNames,
        source: 'live',
      };
    }
  } catch {
    // Fallback to local cache / seed
  }

  const masterFallback = await masterCatalogPromise;
  const cachedSedes = readCache<SedeRecord[]>(LOCAL_CACHE_KEYS.sedes, DEFAULT_SEDES);
  const activeCachedSedes = filterSedesByMasterCatalog(
    cachedSedes,
    masterFallback.enabledSedeNames
  );

  return {
    expenses: readCache<ExpenseRecord[]>(LOCAL_CACHE_KEYS.expenses, SEED_EXPENSES),
    criteria: readCache<ExpenseCriterion[]>(LOCAL_CACHE_KEYS.criteria, DEFAULT_CRITERIA),
    sedes: activeCachedSedes,
    users: masterFallback.users,
    enabledSedeNames: masterFallback.enabledSedeNames,
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
    titularCuenta: record.titularCuenta || '',
    numeroOperacion: record.numeroOperacion || '',
    entidadPago: record.entidadPago || '',
    telefonoCuenta: record.telefonoCuenta || '',
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
      msg = 'Comprobante guardado en el Servidor y Nube HD.';
    } else {
      msg = String(res?.message || 'Guardado localmente; pendiente sincronización con Servidor.');
    }
  } catch {
    msg = 'Sin respuesta del Servidor; guardado en caché local.';
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
  usuario: UserSession,
  fotoBase64HD?: string,
  nombreArchivoFoto?: string
): Promise<{
  ok: boolean;
  savedRecord: ExpenseRecord;
  syncedToCloud: boolean;
  message: string;
}> {
  let updatedRecord: ExpenseRecord = { ...record };
  let synced = false;
  let msg = fotoBase64HD
    ? 'Foto HD del comprobante guardada localmente.'
    : 'Registro actualizado localmente.';
  try {
    const res = await postToDataApi<Record<string, unknown>>({
      action: 'editarComprobante',
      idRegistro: record.id,
      usuario: usuario.usuario,
      cargo: usuario.cargo,
      sede: record.sede,
      fotoBase64HD: fotoBase64HD || '',
      nombreArchivoFoto: nombreArchivoFoto || '',
      datosNuevos: {
        ...record,
        montoConComa: formatCommaDecimal(record.total),
        igvConComa: formatCommaDecimal(record.igv),
      },
    });
    if (res && res.status !== 'error') {
      synced = true;
      const driveView = String(res.urlView || res.linkFotoView || '');
      const driveThumb = String(res.urlThumbnail || res.linkFotoHd || '');
      if (driveThumb || driveView) {
        updatedRecord.linkFotoHd = normalizeDriveImageUrl(driveThumb || driveView);
        updatedRecord.linkFotoView = driveView || driveThumb;
      }
      msg = fotoBase64HD
        ? 'Foto HD firmada actualizada en el Servidor y Nube.'
        : 'Comprobante actualizado en el Servidor.';
    }
  } catch {
    // Local cache fallback
  }

  const current = readCache<ExpenseRecord[]>(LOCAL_CACHE_KEYS.expenses, SEED_EXPENSES);
  const next = current.map((r) => (r.id === updatedRecord.id ? updatedRecord : r));
  writeCache(LOCAL_CACHE_KEYS.expenses, next);

  return { ok: true, savedRecord: updatedRecord, syncedToCloud: synced, message: msg };
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
      msg = 'Comprobante eliminado del Servidor.';
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
  let msg = 'Criterio actualizado localmente.';
  try {
    const res = await postToDataApi<Record<string, unknown>>({
      action: 'guardarCriterioGasto',
      ...criterion,
      palabrasClave: criterion.palabrasClaveIA,
      aplicaIgv: criterion.aplicaIgvDefecto,
      topeAlerta: criterion.topeAlertaSoles,
      modificadoPor: usuario,
    });
    if (res && res.status !== 'error') {
      synced = true;
      msg = 'Criterio guardado en el Servidor.';
    }
  } catch {
    // Local update continues
  }

  const current = readCache<ExpenseCriterion[]>(LOCAL_CACHE_KEYS.criteria, DEFAULT_CRITERIA);
  const next = [criterion, ...current.filter((c) => c.idCriterio !== criterion.idCriterio)];
  writeCache(LOCAL_CACHE_KEYS.criteria, next);

  return { ok: true, syncedToCloud: synced, message: msg };
}

export async function createSedeInBackend(
  sede: SedeRecord,
  usuario: string
): Promise<{ ok: boolean; syncedToCloud: boolean; message: string }> {
  const customMap = loadSedeCustomizations();
  const key = sede.nombreSede.trim().toUpperCase();
  customMap[key] = {
    codigoSede: sede.codigoSede,
    presupuestoMensualFijo: sede.presupuestoMensualFijo,
    presupuestoMensualVariable: sede.presupuestoMensualVariable,
    direccion: sede.direccion,
    ubicacion: sede.ubicacion,
    telefono: sede.telefono,
    codigoSbs: sede.codigoSbs,
    mensajePie: sede.mensajePie,
    correoContacto: sede.correoContacto,
  };
  writeCache(LOCAL_CACHE_KEYS.sedeCustom, customMap);

  let synced = false;
  let msg = `Sede ${sede.nombreSede} registrada localmente.`;
  try {
    const res = await postToDataApi<Record<string, unknown>>({
      action: 'crearSede',
      codigoSede: sede.codigoSede,
      nombreSede: sede.nombreSede,
      presupuestoMensualFijo: sede.presupuestoMensualFijo,
      presupuestoMensualVariable: sede.presupuestoMensualVariable,
      direccion: sede.direccion || '',
      ubicacion: sede.ubicacion || '',
      telefono: sede.telefono || '',
      codigoSbs: sede.codigoSbs || '',
      mensajePie: sede.mensajePie || '',
      correoContacto: sede.correoContacto || '',
      usuario,
    });
    if (res && res.status !== 'error') {
      synced = true;
      msg = `Sede ${sede.nombreSede} y carpeta en la Nube creadas en el Servidor.`;
    }
  } catch {
    // Local update continues
  }
  return { ok: true, syncedToCloud: synced, message: msg };
}

export async function saveSedeCustomizationInBackend(
  sede: SedeRecord,
  usuario: string
): Promise<{ ok: boolean; syncedToCloud: boolean; message: string }> {
  const key = sede.nombreSede.trim().toUpperCase();
  const customMap = loadSedeCustomizations();
  customMap[key] = {
    codigoSede: sede.codigoSede,
    presupuestoMensualFijo: sede.presupuestoMensualFijo,
    presupuestoMensualVariable: sede.presupuestoMensualVariable,
    direccion: sede.direccion || '',
    ubicacion: sede.ubicacion || '',
    telefono: sede.telefono || '',
    codigoSbs: sede.codigoSbs || '',
    mensajePie: sede.mensajePie || '',
    correoContacto: sede.correoContacto || '',
  };
  writeCache(LOCAL_CACHE_KEYS.sedeCustom, customMap);

  const cachedSedes = readCache<SedeRecord[]>(LOCAL_CACHE_KEYS.sedes, DEFAULT_SEDES);
  const nextSedes = [
    ...cachedSedes.filter((s) => s.nombreSede.toUpperCase() !== key),
    sede,
  ];
  writeCache(LOCAL_CACHE_KEYS.sedes, nextSedes);

  let synced = false;
  let msg = `Personalización de recibos y dirección de ${key} guardada.`;
  try {
    const res = await postToDataApi<Record<string, unknown>>({
      action: 'guardarConfigSede',
      nombreSede: key,
      codigoSede: sede.codigoSede,
      presupuestoMensualFijo: sede.presupuestoMensualFijo,
      presupuestoMensualVariable: sede.presupuestoMensualVariable,
      direccion: sede.direccion || '',
      ubicacion: sede.ubicacion || '',
      telefono: sede.telefono || '',
      codigoSbs: sede.codigoSbs || '',
      mensajePie: sede.mensajePie || '',
      correoContacto: sede.correoContacto || '',
      usuario,
    });
    if (res && res.status !== 'error') {
      synced = true;
      msg = `Sede ${key} actualizada y sincronizada con el Servidor.`;
    }
  } catch {
    // Saved locally even if server script isn't updated yet
  }
  return { ok: true, syncedToCloud: synced, message: msg };
}

export async function scanInvoiceWithGeminiApi(params: {
  imageBase64: string;
  imageDataUrl?: string;
  mimeType: string;
  criteria: ExpenseCriterion[];
  expectedTipo?: TipoComprobante;
  onProgress?: (pct: number, step: string) => void;
}): Promise<{ result: AiScanResult; engine: 'gemini' | 'ocr-local' }> {
  const notify = params.onProgress;

  // 1. Try server-side Gemini Vision API first (safely checking JSON content-type to avoid <!doctype errors)
  try {
    notify?.(18, 'Consultando motor de lectura inteligente...');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 16000);
    const res = await fetch('/api/scan-invoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: params.imageBase64,
        mimeType: params.mimeType,
        criteria: params.criteria,
        expectedTipo: params.expectedTipo,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json();
      if (data?.result) {
        notify?.(100, 'Lectura IA completada.');
        return { result: data.result as AiScanResult, engine: 'gemini' };
      }
    }
  } catch {
    // Server route unavailable (e.g. GitHub Pages static deploy) -> use free local OCR below
  }

  // 2. Free zero-API-key client-side OCR fallback using Tesseract.js
  notify?.(28, 'Iniciando motor OCR gratuito sin clave...');
  const { createWorker } = await import('tesseract.js');
  const dataUrl =
    params.imageDataUrl || `data:${params.mimeType || 'image/jpeg'};base64,${params.imageBase64}`;

  const worker = await createWorker('spa+eng', 1, {
    logger: (m: { status?: string; progress?: number }) => {
      const status = String(m?.status || '').toLowerCase();
      const rawProgress = typeof m?.progress === 'number' ? m.progress : 0;
      if (status.includes('loading tesseract core')) {
        notify?.(34, 'Cargando núcleo OCR en memoria...');
      } else if (status.includes('initializing tesseract')) {
        notify?.(42, 'Inicializando lector de caracteres...');
      } else if (status.includes('loading language traineddata')) {
        notify?.(Math.min(58, Math.round(44 + rawProgress * 14)), 'Cargando diccionario español/números...');
      } else if (status.includes('initializing api')) {
        notify?.(62, 'Preparando análisis de comprobante...');
      } else if (status.includes('recognizing text')) {
        const pct = Math.min(92, Math.max(64, Math.round(64 + rawProgress * 28)));
        notify?.(pct, `Extrayendo RUC, serie, fecha y montos (${pct}%)...`);
      }
    },
  });
  try {
    notify?.(60, 'Analizando texto y montos del comprobante...');
    const {
      data: { text },
    } = await worker.recognize(dataUrl);
    notify?.(96, 'Clasificando naturaleza contable y campos...');
    const parsed = parsePeruReceiptText(text || '', params.criteria, params.expectedTipo);
    notify?.(100, 'Lectura completada.');
    return { result: parsed, engine: 'ocr-local' };
  } finally {
    await worker.terminate();
  }
}
