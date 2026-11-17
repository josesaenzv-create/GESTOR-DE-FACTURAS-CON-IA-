import type {
  ExpenseRecord,
  NaturalezaGasto,
  TipoComprobante,
  UserSession,
  VoucherType,
} from '../types/crediban';

export interface VoucherTemplateConfig {
  type: VoucherType;
  label: string;
  headerTitle: string;
  serie: string;
  tipoComprobante: TipoComprobante;
  categoriaForms: string;
  naturaleza: NaturalezaGasto;
  categoriaPrincipal: string;
  subtipo: string;
  totalLabel: string;
  legalText: string;
  defaultConcept: string;
  showSignatureByDefault: boolean;
  suggestUsersByDefault: boolean;
}

export const VOUCHER_TEMPLATES: Record<VoucherType, VoucherTemplateConfig> = {
  MOVILIDAD: {
    type: 'MOVILIDAD',
    label: 'Recibo de Movilidad',
    headerTitle: 'RECIBO DE MOVILIDAD',
    serie: 'M001',
    tipoComprobante: 'RECIBO DE MOVILIDAD',
    categoriaForms: 'Movilidad y transporte',
    naturaleza: 'Costo Variable',
    categoriaPrincipal: 'Viáticos y Movilidad',
    subtipo: 'Pasajes urbanos y taxis',
    totalLabel: 'TOTAL DESEMBOLSADO',
    legalText:
      'RECIBI EL TOTAL DE DESEMBOLSO SEÑALADO EN EFECTIVO POR ELLO FIRMO EN SEÑAL DE CONFORMIDAD',
    defaultConcept: 'MOVILIDAD DE CAMPO Y GESTIÓN COMERCIAL',
    showSignatureByDefault: true,
    suggestUsersByDefault: true,
  },
  CAJA: {
    type: 'CAJA',
    label: 'Recibo de Caja',
    headerTitle: 'CAJA RECIBO',
    serie: 'RC01',
    tipoComprobante: 'RECIBO DE CAJA',
    categoriaForms: 'Otros gastos operativos',
    naturaleza: 'Costo Variable',
    categoriaPrincipal: 'Otros Gastos Operativos',
    subtipo: 'Otros gastos operativos / Caja chica',
    totalLabel: 'TOTAL ENTREGADO',
    legalText: '',
    defaultConcept: 'EGRESO DE CAJA CHICA',
    showSignatureByDefault: false,
    suggestUsersByDefault: false,
  },
  COMISION_COBRANZA: {
    type: 'COMISION_COBRANZA',
    label: 'Comisión de Cobranza',
    headerTitle: 'RECIBO DE COMISIÓN COBRANZA',
    serie: 'CC01',
    tipoComprobante: 'RECIBO DE CAJA',
    categoriaForms: 'comisiones cobranza',
    naturaleza: 'Costo Variable',
    categoriaPrincipal: 'Comisiones e Incentivos',
    subtipo: 'Comisiones de cobranza',
    totalLabel: 'TOTAL DESEMBOLSADO',
    legalText:
      'RECIBI EL TOTAL DE COMISIÓN DE COBRANZA SEÑALADO EN EFECTIVO POR ELLO FIRMO EN SEÑAL DE CONFORMIDAD',
    defaultConcept: 'COMISIÓN POR RECUPERACIÓN DE CARTERA',
    showSignatureByDefault: true,
    suggestUsersByDefault: true,
  },
  COMISION_COLOCACION: {
    type: 'COMISION_COLOCACION',
    label: 'Comisión de Colocación',
    headerTitle: 'RECIBO DE COMISIÓN COLOCACIÓN',
    serie: 'CL01',
    tipoComprobante: 'RECIBO DE CAJA',
    categoriaForms: 'comisiones asesores',
    naturaleza: 'Costo Variable',
    categoriaPrincipal: 'Comisiones e Incentivos',
    subtipo: 'Comisiones de asesores',
    totalLabel: 'TOTAL DESEMBOLSADO',
    legalText:
      'RECIBI EL TOTAL DE COMISIÓN DE COLOCACIÓN SEÑALADO EN EFECTIVO POR ELLO FIRMO EN SEÑAL DE CONFORMIDAD',
    defaultConcept: 'COMISIÓN POR COLOCACIÓN DE CRÉDITOS',
    showSignatureByDefault: true,
    suggestUsersByDefault: true,
  },
  INCENTIVOS: {
    type: 'INCENTIVOS',
    label: 'Incentivos',
    headerTitle: 'CAJA RECIBO',
    serie: 'IN01',
    tipoComprobante: 'RECIBO DE CAJA',
    categoriaForms: 'incentivos',
    naturaleza: 'Costo Variable',
    categoriaPrincipal: 'Comisiones e Incentivos',
    subtipo: 'Incentivos comerciales',
    totalLabel: 'TOTAL ENTREGADO',
    legalText:
      'RECIBI EL TOTAL DE INCENTIVO SEÑALADO POR ELLO FIRMO EN SEÑAL DE CONFORMIDAD',
    defaultConcept: 'INCENTIVO',
    showSignatureByDefault: true,
    suggestUsersByDefault: true,
  },
  VACACIONES: {
    type: 'VACACIONES',
    label: 'Vacaciones',
    headerTitle: 'RECIBO DE VACACIONES',
    serie: 'VA01',
    tipoComprobante: 'RECIBO DE CAJA',
    categoriaForms: 'Gastos administrativos',
    naturaleza: 'Costo Fijo',
    categoriaPrincipal: 'Planillas y Recursos Humanos',
    subtipo: 'Beneficios y vacaciones',
    totalLabel: 'TOTAL ENTREGADO',
    legalText:
      'RECIBI CONFORME EL PAGO CORRESPONDIENTE A MIS VACACIONES DEL PERIODO SEÑALADO Y FIRMO EN CONFORMIDAD',
    defaultConcept: 'PAGO DE VACACIONES',
    showSignatureByDefault: true,
    suggestUsersByDefault: true,
  },
  LIQUIDACION: {
    type: 'LIQUIDACION',
    label: 'Liquidaciones',
    headerTitle: 'RECIBO DE LIQUIDACIÓN',
    serie: 'LQ01',
    tipoComprobante: 'RECIBO DE CAJA',
    categoriaForms: 'Gastos administrativos',
    naturaleza: 'Costo Fijo',
    categoriaPrincipal: 'Planillas y Recursos Humanos',
    subtipo: 'Liquidación de beneficios',
    totalLabel: 'TOTAL DESEMBOLSADO',
    legalText:
      'RECIBI CONFORME EL TOTAL DE LIQUIDACIÓN DE BENEFICIOS SOCIALES SIN NINGUN RECLAMO POSTERIOR',
    defaultConcept: 'LIQUIDACIÓN DE BENEFICIOS SOCIALES',
    showSignatureByDefault: true,
    suggestUsersByDefault: true,
  },
};

export function getNextVoucherCorrelative(
  expenses: ExpenseRecord[],
  serie: string,
  sede?: string
): string {
  const cleanSerie = serie.trim().toUpperCase();
  const cleanSede = (sede || '').trim().toUpperCase();
  let maxNum = 0;
  for (const e of expenses) {
    if (cleanSede && String(e.sede || '').trim().toUpperCase() !== cleanSede) {
      continue;
    }
    const numStr = String(e.numeroComprobante || '').toUpperCase();
    const match = numStr.match(new RegExp(`^${cleanSerie}\\s*-\\s*(\\d+)$`));
    if (match) {
      const n = parseInt(match[1], 10);
      if (Number.isFinite(n) && n > maxNum) maxNum = n;
    }
  }
  return String(maxNum + 1).padStart(4, '0');
}

export function filterMatchingCollaborators(
  users: UserSession[],
  query: string,
  limit = 6
): UserSession[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return users
    .filter((u) => {
      const fullName = (u.nombreCompleto || u.usuario.replace(/\./g, ' ')).toLowerCase();
      const dni = (u.dni || '').toLowerCase();
      const userCode = u.usuario.toLowerCase();
      return fullName.includes(q) || dni.includes(q) || userCode.includes(q);
    })
    .slice(0, limit);
}

export function formatVoucherDateTime(isoDate: string): string {
  const m = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return isoDate;
  return `${parseInt(m[3], 10)}/${parseInt(m[2], 10)}/${m[1]} 00:00`;
}
