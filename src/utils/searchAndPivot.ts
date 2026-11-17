import type { ExpenseRecord, NaturalezaGasto } from '../types/crediban';
import { parseCommaDecimal, round2 } from './accounting';

export function normalizeComprobanteNumber(value: string): string {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  // If format has series-correlative (e.g. F004-000458), extract numeric correlative
  const parts = raw.split('-');
  const tail = parts.length > 1 ? parts[parts.length - 1] : raw;
  const stripped = tail.replace(/^0+(?=\d)/, '');
  return stripped || tail;
}

export function matchesExpenseSearch(record: ExpenseRecord, query: string): boolean {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;

  const qNormalizedNum = normalizeComprobanteNumber(q);
  const recordNormalizedNum = normalizeComprobanteNumber(record.numeroComprobante);

  const searchableFields = [
    record.ruc,
    record.razonSocial,
    record.nombreComercial,
    record.numeroComprobante,
    record.responsable,
    record.categoriaForms,
    record.categoriaPrincipal,
    record.subtipo,
    record.descripcion,
    record.sede,
    record.id,
  ];

  if (searchableFields.some((f) => String(f || '').toLowerCase().includes(q))) {
    return true;
  }

  // Intelligent matching ignoring series prefix and leading zeros (e.g. "458" -> "F004-000458")
  if (qNormalizedNum && /^\d+$/.test(qNormalizedNum) && recordNormalizedNum.includes(qNormalizedNum)) {
    return true;
  }

  return false;
}

export interface ProviderSummary {
  ruc: string;
  razonSocial: string;
  nombreComercial: string;
  sedes: string[];
  totalComprobantes: number;
  subtotalAcumulado: number;
  igvAcumulado: number;
  totalAcumulado: number;
}

export function computeProviderSummary(records: ExpenseRecord[]): ProviderSummary | null {
  if (records.length === 0) return null;
  const first = records[0];
  const sedes = Array.from(new Set(records.map((r) => r.sede).filter(Boolean)));
  let subtotal = 0;
  let igv = 0;
  let total = 0;
  for (const r of records) {
    subtotal += Number(r.subtotal) || 0;
    igv += Number(r.igv) || 0;
    total += Number(r.total) || 0;
  }
  return {
    ruc: first.ruc || 'Sin RUC',
    razonSocial: first.razonSocial || first.nombreComercial || 'Proveedor Varios',
    nombreComercial: first.nombreComercial || first.razonSocial || 'Sin nombre comercial',
    sedes,
    totalComprobantes: records.length,
    subtotalAcumulado: round2(subtotal),
    igvAcumulado: round2(igv),
    totalAcumulado: round2(total),
  };
}

export interface ProviderChip {
  key: string;
  ruc: string;
  razonSocial: string;
  nombreComercial: string;
  count: number;
  total: number;
}

export function buildProviderChips(records: ExpenseRecord[]): ProviderChip[] {
  const map = new Map<string, ProviderChip>();
  for (const r of records) {
    const cleanRuc = String(r.ruc || '').trim();
    const key = cleanRuc || String(r.razonSocial || r.nombreComercial || 'OTROS').trim().toUpperCase();
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      existing.total = round2(existing.total + (Number(r.total) || 0));
      if (!existing.nombreComercial && r.nombreComercial) {
        existing.nombreComercial = r.nombreComercial;
      }
    } else {
      map.set(key, {
        key,
        ruc: cleanRuc,
        razonSocial: r.razonSocial || r.nombreComercial || key,
        nombreComercial: r.nombreComercial || r.razonSocial || key,
        count: 1,
        total: round2(Number(r.total) || 0),
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

export interface PivotSubtipoNode {
  subtipo: string;
  count: number;
  subtotal: number;
  igv: number;
  total: number;
  records: ExpenseRecord[];
}

export interface PivotCategoriaNode {
  categoriaPrincipal: string;
  count: number;
  subtotal: number;
  igv: number;
  total: number;
  subtipos: PivotSubtipoNode[];
}

export interface PivotNaturalezaNode {
  naturaleza: NaturalezaGasto;
  count: number;
  subtotal: number;
  igv: number;
  total: number;
  categorias: PivotCategoriaNode[];
}

export function buildPivotTree(records: ExpenseRecord[]): PivotNaturalezaNode[] {
  const natMap = new Map<NaturalezaGasto, Map<string, Map<string, ExpenseRecord[]>>>();

  for (const r of records) {
    const nat: NaturalezaGasto = r.naturaleza === 'Costo Fijo' ? 'Costo Fijo' : 'Costo Variable';
    const cat = r.categoriaPrincipal || r.categoriaForms || 'Sin Categoría';
    const sub = r.subtipo || r.categoriaForms || 'General';

    if (!natMap.has(nat)) natMap.set(nat, new Map());
    const catMap = natMap.get(nat)!;
    if (!catMap.has(cat)) catMap.set(cat, new Map());
    const subMap = catMap.get(cat)!;
    if (!subMap.has(sub)) subMap.set(sub, []);
    subMap.get(sub)!.push(r);
  }

  const order: NaturalezaGasto[] = ['Costo Fijo', 'Costo Variable'];
  const result: PivotNaturalezaNode[] = [];

  for (const nat of order) {
    const catMap = natMap.get(nat);
    if (!catMap) continue;

    const categorias: PivotCategoriaNode[] = [];
    let natCount = 0;
    let natSub = 0;
    let natIgv = 0;
    let natTot = 0;

    for (const [catName, subMap] of catMap.entries()) {
      const subtipos: PivotSubtipoNode[] = [];
      let catCount = 0;
      let catSub = 0;
      let catIgv = 0;
      let catTot = 0;

      for (const [subName, items] of subMap.entries()) {
        const subCount = items.length;
        const subSub = round2(items.reduce((acc, x) => acc + (Number(x.subtotal) || 0), 0));
        const subIgv = round2(items.reduce((acc, x) => acc + (Number(x.igv) || 0), 0));
        const subTot = round2(items.reduce((acc, x) => acc + (Number(x.total) || 0), 0));

        subtipos.push({
          subtipo: subName,
          count: subCount,
          subtotal: subSub,
          igv: subIgv,
          total: subTot,
          records: items,
        });

        catCount += subCount;
        catSub = round2(catSub + subSub);
        catIgv = round2(catIgv + subIgv);
        catTot = round2(catTot + subTot);
      }

      subtipos.sort((a, b) => b.total - a.total);
      categorias.push({
        categoriaPrincipal: catName,
        count: catCount,
        subtotal: catSub,
        igv: catIgv,
        total: catTot,
        subtipos,
      });

      natCount += catCount;
      natSub = round2(natSub + catSub);
      natIgv = round2(natIgv + catIgv);
      natTot = round2(natTot + catTot);
    }

    categorias.sort((a, b) => b.total - a.total);
    result.push({
      naturaleza: nat,
      count: natCount,
      subtotal: natSub,
      igv: natIgv,
      total: natTot,
      categorias,
    });
  }

  return result;
}

export interface NominatimAddressInput {
  display_name?: string;
  address?: {
    road?: string;
    house_number?: string;
    suburb?: string;
    neighbourhood?: string;
    city_district?: string;
    town?: string;
    village?: string;
    city?: string;
    county?: string;
    state?: string;
    region?: string;
  };
}

export function correctPeruUbigeo(data: NominatimAddressInput): {
  address: string;
  district: string;
  province: string;
} {
  const addr = data?.address || {};
  const rawDisplay = String(data?.display_name || '');
  const road = [addr.road, addr.house_number].filter(Boolean).join(' ').trim();

  let district =
    addr.city_district ||
    addr.suburb ||
    addr.town ||
    addr.village ||
    addr.neighbourhood ||
    addr.city ||
    '';

  let province = addr.county || addr.city || addr.state || '';
  const combined = `${rawDisplay} ${district} ${province}`.toLowerCase();

  // Huaura province district correction (Huacho, Hualmay, Santa María, Végueta, Carquín)
  const huauraDistricts: Array<[RegExp, string]> = [
    [/hualmay/i, 'Hualmay'],
    [/santa\s*mar[ií]a/i, 'Santa María'],
    [/v[eé]gueta/i, 'Végueta'],
    [/carqu[ií]n|caleta\s*carqu[ií]n/i, 'Caleta de Carquín'],
    [/huacho/i, 'Huacho'],
    [/huaura/i, 'Huaura'],
  ];

  for (const [regex, canonical] of huauraDistricts) {
    if (regex.test(combined)) {
      district = canonical;
      province = 'Huaura';
      break;
    }
  }

  if (/huaraz|independencia.*ancash/i.test(combined)) {
    district = /independencia/i.test(combined) ? 'Independencia' : 'Huaraz';
    province = 'Huaraz';
  } else if (/\bica\b|tingui[ñn]a|parcona|subtanjalla/i.test(combined)) {
    if (/tingui[ñn]a/i.test(combined)) district = 'La Tinguiña';
    else if (/parcona/i.test(combined)) district = 'Parcona';
    else if (/subtanjalla/i.test(combined)) district = 'Subtanjalla';
    else district = 'Ica';
    province = 'Ica';
  }

  const formatted = [road, district, province].filter(Boolean).join(', ');
  return {
    address: formatted || rawDisplay || 'Ubicación GPS registrada',
    district: district || 'Sin distrito',
    province: province || 'Perú',
  };
}

function escapeCsvCell(val: unknown): string {
  let str = String(val ?? '');
  // Neutralize Excel/Sheets formula injection on text cells (keep negative numbers like -12.50 intact)
  if (/^[=+\t\r@]/.test(str) || (/^-/.test(str) && !/^-\d+(\.\d+)?$/.test(str))) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export const CSV_HEADERS = [
  'ID',
  'Fecha',
  'Año',
  'Mes',
  'Sede',
  'Categoria_Forms',
  'Naturaleza',
  'Categoria_Principal',
  'Subtipo',
  'Tipo_Comprobante',
  'Numero_Comprobante',
  'RUC',
  'Razon_Social',
  'Nombre_Comercial',
  'Subtotal',
  'IGV',
  'Total',
  'Nivel_Impacto',
  'Responsable',
  'Cargo_Usuario',
  'Direccion_GPS',
  'Coordenadas_GPS',
  'Link_Mapa',
  'Link_Foto_HD',
  'Descripcion',
  'Estado',
];

export function exportExpensesToCsv(records: ExpenseRecord[]): string {
  const rows = [CSV_HEADERS.join(',')];
  for (const r of records) {
    rows.push(
      [
        r.id,
        r.fecha,
        r.anio,
        r.mes,
        r.sede,
        r.categoriaForms,
        r.naturaleza,
        r.categoriaPrincipal,
        r.subtipo,
        r.tipoComprobante,
        r.numeroComprobante,
        r.ruc,
        r.razonSocial,
        r.nombreComercial,
        r.subtotal.toFixed(2),
        r.igv.toFixed(2),
        r.total.toFixed(2),
        r.nivelImpacto,
        r.responsable,
        r.cargoUsuario,
        r.direccionGps,
        r.coordenadasGps,
        r.linkMapa,
        r.linkFotoHd,
        r.descripcion,
        r.estado,
      ]
        .map(escapeCsvCell)
        .join(',')
    );
  }
  return '\uFEFF' + rows.join('\r\n');
}

export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

export function parseCsvRecords(csvText: string): ExpenseRecord[] {
  const cleaned = csvText.replace(/^\uFEFF/, '');
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name.toLowerCase());

  const out: ExpenseRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 5) continue;

    const get = (name: string, fallback = '') => {
      const pos = idx(name);
      return pos >= 0 && pos < cols.length ? cols[pos].trim() : fallback;
    };

    const total = parseCommaDecimal(get('total') || get('monto (s/)') || '0');
    const subtotal = parseCommaDecimal(get('subtotal') || '0');
    const igv = parseCommaDecimal(get('igv') || '0');
    const natRaw = get('naturaleza', 'Costo Variable');

    out.push({
      id: get('id', `IMP-${Date.now()}-${i}`),
      fecha: get('fecha', new Date().toISOString().slice(0, 10)),
      anio: get('año') || get('anio') || '2026',
      mes: get('mes', 'NOVIEMBRE').toUpperCase(),
      sede: get('sede', 'HUACHO').toUpperCase(),
      categoriaForms: get('categoria_forms') || get('categoria', 'Otros gastos operativos'),
      naturaleza: natRaw.toLowerCase().includes('fijo') ? 'Costo Fijo' : 'Costo Variable',
      categoriaPrincipal: get('categoria_principal', 'Otros gastos operativos'),
      subtipo: get('subtipo', 'General'),
      tipoComprobante: (get('tipo_comprobante', 'BOLETA').toUpperCase() as ExpenseRecord['tipoComprobante']) || 'BOLETA',
      numeroComprobante: get('numero_comprobante', ''),
      ruc: get('ruc', ''),
      razonSocial: get('razon_social', ''),
      nombreComercial: get('nombre_comercial', ''),
      subtotal,
      igv,
      total,
      nivelImpacto: (get('nivel_impacto', 'Regular') as ExpenseRecord['nivelImpacto']) || 'Regular',
      responsable: get('responsable', 'IMPORTADO'),
      cargoUsuario: get('cargo_usuario', 'ADMINISTRADOR'),
      direccionGps: get('direccion_gps', ''),
      coordenadasGps: get('coordenadas_gps', ''),
      linkMapa: get('link_mapa', ''),
      linkFotoHd: get('link_foto_hd', ''),
      descripcion: get('descripcion', ''),
      estado: get('estado', 'APROBADO'),
    });
  }

  return out;
}
