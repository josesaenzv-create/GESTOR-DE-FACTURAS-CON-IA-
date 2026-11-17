export const DATA_API_URL =
  'https://script.google.com/macros/s/AKfycby6nDbUCJQZsR4eZUqmD13y2kf-Rj7i4x0Pm9k71QaykCoEURIskfW-EmkbPtd1LOAW/exec';

export const USERS_API_URL =
  'https://script.google.com/macros/s/AKfycbyPGo-OSC0KZcz03bAMpKQ82cipc2T1LNztaI229FhYqqNNXqG1oSb6hPPgVSSU3piqiw/exec';

export const CREDIBAN_COMPANY = {
  nombre: 'CREDIBAN PERU S.A.C.',
  ruc: '20613997360',
  slogan: 'empieza a construir tus sueños',
};

export const OFFICIAL_CATEGORIES = [
  'Materiales y suministros',
  'Mantenimiento y reparación',
  'Servicios básicos',
  'Movilidad y transporte',
  'Gastos administrativos',
  'Marketing y promoción',
  'Atención al cliente y bienestar laboral',
  'Seguridad y prevención',
  'Eventos y reuniones corporativas',
  'Tecnología y equipos',
  'Capacitación y desarrollo',
  'Articulos de limpieza',
  'Alquiler del local',
  'Gastos legales',
  'Otros gastos operativos',
  'comisiones asesores',
  'comisiones cobranza',
  'viaticos',
  'incentivos',
] as const;

export const MONTH_NAMES = [
  'ENERO',
  'FEBRERO',
  'MARZO',
  'ABRIL',
  'MAYO',
  'JUNIO',
  'JULIO',
  'AGOSTO',
  'SEPTIEMBRE',
  'OCTUBRE',
  'NOVIEMBRE',
  'DICIEMBRE',
] as const;

export type TipoComprobante =
  | 'FACTURA'
  | 'BOLETA'
  | 'YAPE / PLIN / TRANSFERENCIA'
  | 'RECIBO DE CAJA'
  | 'RECIBO DE MOVILIDAD'
  | 'TICKET DE VENTA'
  | 'SOLO CAPTURA';

export type VoucherType =
  | 'MOVILIDAD'
  | 'CAJA'
  | 'COMISION_COBRANZA'
  | 'COMISION_COLOCACION'
  | 'INCENTIVOS'
  | 'VACACIONES'
  | 'LIQUIDACION';

export type NaturalezaGasto = 'Costo Fijo' | 'Costo Variable';

export type NivelImpacto = 'Regular' | 'Medio' | 'Fuerte';

export interface UserSession {
  usuario: string;
  nombreCompleto?: string;
  dni?: string;
  cargo: string;
  sede: string;
  clave?: string;
  estado?: string;
  accesoSistema?: boolean;
  jefeAsignado?: string;
  equipo?: string;
  isOfflineFallback?: boolean;
}

export interface ExpenseRecord {
  id: string;
  fecha: string; // YYYY-MM-DD
  anio: string;
  mes: string; // ENERO..DICIEMBRE
  sede: string;
  categoriaForms: string;
  naturaleza: NaturalezaGasto;
  categoriaPrincipal: string;
  subtipo: string;
  tipoComprobante: TipoComprobante;
  numeroComprobante: string;
  ruc: string;
  razonSocial: string;
  nombreComercial: string;
  subtotal: number;
  igv: number;
  total: number;
  descripcion: string;
  nivelImpacto: NivelImpacto;
  responsable: string;
  cargoUsuario: string;
  titularCuenta?: string;
  numeroOperacion?: string;
  entidadPago?: string;
  telefonoCuenta?: string;
  direccionGps: string;
  coordenadasGps: string;
  linkMapa: string;
  linkFotoHd: string;
  linkFotoView?: string;
  carpetaDestino?: string;
  estado: string;
  marcaTemporal?: string;
}

export interface ExpenseCriterion {
  idCriterio: string;
  naturaleza: NaturalezaGasto;
  categoriaForms: string;
  categoriaPrincipal: string;
  subtipo: string;
  palabrasClaveIA: string;
  aplicaIgvDefecto: boolean;
  topeAlertaSoles: number;
  estado: string;
  ultimaModificacion?: string;
  modificadoPor?: string;
}

export interface SedeRecord {
  codigoSede: string;
  nombreSede: string;
  estado: string;
  presupuestoMensualFijo: number;
  presupuestoMensualVariable: number;
  nombreHojaSede?: string;
  idCarpetaDrive?: string;
  fechaCreacion?: string;
  direccion?: string;
  ubicacion?: string;
  telefono?: string;
  codigoSbs?: string;
  mensajePie?: string;
  correoContacto?: string;
}

export interface AiScanResult {
  tipoComprobante: TipoComprobante;
  numeroComprobante: string;
  fechaEmision: string;
  ruc: string;
  razonSocial: string;
  nombreComercial: string;
  titularCuenta?: string;
  numeroOperacion?: string;
  entidadPago?: string;
  telefonoCuenta?: string;
  subtotal: number;
  igv: number;
  total: number;
  naturaleza: NaturalezaGasto;
  categoria: string;
  subtipo: string;
  descripcion: string;
  scoreConfiabilidad: number;
}

export interface GpsLocationState {
  status: 'searching' | 'ready' | 'denied' | 'unavailable';
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  address: string;
  district: string;
  province: string;
  mapsLink: string;
}

export type BudgetVisibilityMode =
  | 'ALL'
  | 'ONLY_VARIABLE'
  | 'ONLY_FIXED'
  | 'SUMMARY_ONLY'
  | 'HIDDEN';

export interface BudgetLineItem {
  id: string;
  naturaleza: NaturalezaGasto;
  concepto: string;
  categoriaMatch?: string;
  montoAsignado: number;
}

export interface MonthlySedeBudget {
  id: string; // `${SEDE}::${ANIO}::${MES}`
  sede: string;
  anio: string;
  mes: string;
  presupuestoFijoTotal: number;
  presupuestoVariableTotal: number;
  partidas: BudgetLineItem[];
  visibilidadPorDefecto: BudgetVisibilityMode;
  visibilidadPorUsuario: Record<string, BudgetVisibilityMode>;
  notasGerencia?: string;
  asignadoPor?: string;
  updatedAt?: string;
}

