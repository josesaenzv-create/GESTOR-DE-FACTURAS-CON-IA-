import { jsPDF } from 'jspdf';
import {
  CREDIBAN_COMPANY,
  type ExpenseRecord,
  type SedeRecord,
} from '../types/crediban';
import {
  aggregateByMonth,
  aggregateBySede,
  aggregateIgvProgress,
} from './analytics';
import { formatCurrencySoles, round2 } from './accounting';

export const CREDIBAN_LOGO_WING_PATH =
  'M143 55 C141 78 130 95 111 107 C96 117 81 122 72 134 C62 147 63 166 70 181 C76 195 87 208 97 216 C107 201 118 189 131 177 C144 166 157 156 164 141 C173 123 173 104 168 89 C164 74 156 62 143 55 Z';

export const CREDIBAN_LOGO_BARS: Array<[number, number, number, number, number]> = [
  [90, 8, 24, 13, 6.5],
  [71, 31, 61, 13, 6.5],
  [50, 55, 74, 13, 6.5],
  [31, 79, 75, 13, 6.5],
  [24, 103, 63, 13, 6.5],
  [37, 128, 24, 13, 6.5],
];

/**
 * Draws the exact CREDIBAN vector mark (6 rounded bars + curved wing) onto any Canvas 2D context.
 */
export function drawCredibanEmblemOnCanvas(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  targetSize: number,
  color = '#1B4332'
): void {
  const scale = targetSize / 240;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = color;

  for (const [rx, ry, rw, rh, rad] of CREDIBAN_LOGO_BARS) {
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(rx, ry, rw, rh, rad);
    } else {
      ctx.rect(rx, ry, rw, rh);
    }
    ctx.fill();
  }

  if (typeof Path2D !== 'undefined') {
    const wing = new Path2D(CREDIBAN_LOGO_WING_PATH);
    ctx.fill(wing);
  }
  ctx.restore();
}

export function getCredibanEmblemPngDataUrl(color = '#59B447', px = 180): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.clearRect(0, 0, px, px);
  // Center 180x240 viewBox nicely inside square px canvas
  const offsetX = Math.round(px * 0.125);
  drawCredibanEmblemOnCanvas(ctx, offsetX, 0, px, color);
  return canvas.toDataURL('image/png');
}

/**
 * Exports an 80mm thermal PDF containing the crisp rendered receipt image.
 */
export function downloadVoucherPdf(
  voucherImageDataUrl: string,
  filenameBase: string,
  aspectRatio = 1.4
): void {
  if (!voucherImageDataUrl) return;
  const widthMm = 80;
  const heightMm = Math.max(110, Math.round(widthMm * aspectRatio));
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [widthMm, heightMm],
  });

  doc.addImage(voucherImageDataUrl, 'JPEG', 2, 2, widthMm - 4, heightMm - 4);
  doc.save(`${filenameBase.replace(/[^\w.-]+/g, '_')}.pdf`);
}

/**
 * Prints via a dedicated hidden iframe (no window.open / popup blocked),
 * falling back to downloading the thermal PDF if sandbox restricts print().
 */
function escapeHtml(raw: string): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function printThermalVoucher(
  voucherImageDataUrl: string,
  title: string,
  filenameBase: string,
  aspectRatio = 1.4
): { mode: 'iframe-print' | 'pdf-fallback'; message: string } {
  if (
    !voucherImageDataUrl ||
    !voucherImageDataUrl.startsWith('data:image/') ||
    typeof document === 'undefined'
  ) {
    return { mode: 'pdf-fallback', message: 'No hay vista previa válida para imprimir.' };
  }

  try {
    const existing = document.getElementById('crediban-print-iframe');
    if (existing) existing.remove();

    const iframe = document.createElement('iframe');
    iframe.id = 'crediban-print-iframe';
    iframe.title = title;
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '1px';
    iframe.style.height = '1px';
    iframe.style.opacity = '0.01';
    iframe.style.pointerEvents = 'none';
    iframe.style.border = '0';

    const safeTitle = escapeHtml(title);
    const safeSrc = escapeHtml(voucherImageDataUrl);
    const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>${safeTitle}</title>
    <style>
      @page { size: 80mm auto; margin: 3mm; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: #fff; text-align: center; }
      img { width: 100%; max-width: 76mm; height: auto; display: block; margin: 0 auto; }
    </style>
  </head>
  <body>
    <img src="${safeSrc}" alt="${safeTitle}" />
  </body>
</html>`;

    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc || !iframe.contentWindow) {
      downloadVoucherPdf(voucherImageDataUrl, filenameBase, aspectRatio);
      return {
        mode: 'pdf-fallback',
        message: 'Se descargó el PDF térmico del recibo listo para imprimir.',
      };
    }

    doc.open();
    doc.write(html);
    doc.close();

    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        downloadVoucherPdf(voucherImageDataUrl, filenameBase, aspectRatio);
      }
      setTimeout(() => {
        iframe.remove();
      }, 4000);
    }, 150);

    return {
      mode: 'iframe-print',
      message: 'Diálogo de impresión enviado. Si tu navegador está en modo embebido, también puedes usar "Descargar PDF".',
    };
  } catch {
    downloadVoucherPdf(voucherImageDataUrl, filenameBase, aspectRatio);
    return {
      mode: 'pdf-fallback',
      message: 'Se generó y descargó el archivo PDF del recibo para impresión.',
    };
  }
}

export interface CustomPdfOptions {
  title: string;
  subtitle: string;
  orientation: 'portrait' | 'landscape';
  includeKpis: boolean;
  includeSedeChart: boolean;
  includeMonthlyIgvChart: boolean;
  includeTable: boolean;
  columns: {
    fecha: boolean;
    sede: boolean;
    numero: boolean;
    proveedor: boolean;
    clasificacion: boolean;
    subtotal: boolean;
    igv: boolean;
    total: boolean;
  };
}

export interface ReportFilterContext {
  anio: string;
  mes: string;
  rangoFechas?: string;
  sede: string;
  impacto: string;
  naturaleza?: string;
  categoria?: string;
  subtipo?: string;
  busqueda?: string;
  generadoPor: string;
  fiscalComparison?: {
    totalVentas: number;
    igvVentas: number;
    igvCompras: number;
    igvNeto: number;
  };
}

export function downloadCustomFilteredPdf(
  options: CustomPdfOptions,
  filteredExpenses: ExpenseRecord[],
  sedes: SedeRecord[],
  filters: ReportFilterContext
): void {
  const doc = new jsPDF({
    orientation: options.orientation,
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;
  let y = 12;

  const ensureSpace = (neededMm: number) => {
    if (y + neededMm > pageHeight - 14) {
      doc.addPage();
      y = 14;
    }
  };

  // Header band
  doc.setFillColor(27, 67, 50); // #1B4332
  doc.roundedRect(margin, y, contentWidth, 24, 2.5, 2.5, 'F');

  const logoPng = getCredibanEmblemPngDataUrl('#59B447', 160);
  if (logoPng) {
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(margin + 3, y + 3, 18, 18, 2, 2, 'F');
    doc.addImage(logoPng, 'PNG', margin + 4, y + 4, 16, 16);
  }

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(options.title || 'REPORTE FINANCIERO DE GASTOS - CREDIBAN PERÚ', margin + 25, y + 9);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(209, 250, 229);
  doc.text(
    `${CREDIBAN_COMPANY.nombre} · RUC ${CREDIBAN_COMPANY.ruc} | ${
      options.subtitle || 'Control Operativo y Crédito Fiscal'
    }`,
    margin + 25,
    y + 15
  );
  doc.text(
    `Filtros: Año ${filters.anio} · Mes ${filters.mes}${
      filters.rangoFechas ? ` · ${filters.rangoFechas}` : ''
    } · Sede ${filters.sede} · Impacto ${filters.impacto}${
      filters.naturaleza && filters.naturaleza !== 'TODAS' ? ` · ${filters.naturaleza}` : ''
    }${filters.categoria && filters.categoria !== 'TODAS' ? ` · ${filters.categoria}` : ''}${
      filters.subtipo && filters.subtipo !== 'TODOS' ? ` · ${filters.subtipo}` : ''
    }${filters.busqueda ? ` · Búsqueda "${filters.busqueda}"` : ''}`,
    margin + 25,
    y + 20.5,
    { maxWidth: contentWidth - 28 }
  );

  y += 29;

  // Aggregates
  let total = 0;
  let fijo = 0;
  let variable = 0;
  let igvTotal = 0;
  for (const r of filteredExpenses) {
    const t = Number(r.total) || 0;
    total += t;
    igvTotal += Number(r.igv) || 0;
    if (r.naturaleza === 'Costo Fijo') fijo += t;
    else variable += t;
  }
  total = round2(total);
  fijo = round2(fijo);
  variable = round2(variable);
  igvTotal = round2(igvTotal);

  const igvProgress = aggregateIgvProgress(filteredExpenses);
  const sedeRows = aggregateBySede(filteredExpenses, sedes);
  const monthRows = aggregateByMonth(filteredExpenses).filter((m) => m.count > 0 || m.total > 0);

  // Section 1: KPIs
  if (options.includeKpis) {
    ensureSpace(22);
    const kpis = [
      { label: 'TOTAL EJECUTADO', value: formatCurrencySoles(total), sub: `${filteredExpenses.length} docs` },
      { label: 'COSTOS FIJOS', value: formatCurrencySoles(fijo), sub: total > 0 ? `${Math.round((fijo / total) * 100)}%` : '0%' },
      { label: 'COSTOS VARIABLES', value: formatCurrencySoles(variable), sub: total > 0 ? `${Math.round((variable / total) * 100)}%` : '0%' },
      { label: 'IGV CRÉDITO FISCAL', value: formatCurrencySoles(igvTotal), sub: `${igvProgress.facturaCount} facturas` },
    ];
    const gap = 3;
    const cardW = (contentWidth - gap * 3) / 4;

    kpis.forEach((k, idx) => {
      const cx = margin + idx * (cardW + gap);
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(cx, y, cardW, 18, 1.5, 1.5, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(k.label, cx + 3, y + 5.5);

      doc.setFontSize(10.5);
      doc.setTextColor(15, 23, 42);
      doc.text(k.value, cx + 3, y + 11.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(71, 85, 105);
      doc.text(k.sub, cx + 3, y + 15.8);
    });

    y += 23;
  }

  // Section 2: Sede Comparison Chart
  if (options.includeSedeChart && sedeRows.length > 0) {
    const needed = 14 + sedeRows.length * 9;
    ensureSpace(Math.min(needed, 75));

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(27, 67, 50);
    doc.text('Comparativa de Gastos por Sede (Fijo vs Variable)', margin, y);
    y += 4;

    const maxSedeTotal = Math.max(...sedeRows.map((s) => s.total), 1);
    const barAreaW = contentWidth * 0.45;
    const labelW = 36;

    for (const s of sedeRows) {
      ensureSpace(9);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(15, 23, 42);
      doc.text(s.sede.slice(0, 18), margin, y + 4.5);

      // Bar background
      const bx = margin + labelW;
      doc.setFillColor(241, 245, 249);
      doc.rect(bx, y + 1, barAreaW, 4.5, 'F');

      // Fijo bar
      const fijoW = (s.fijo / maxSedeTotal) * barAreaW;
      const varW = (s.variable / maxSedeTotal) * barAreaW;
      if (fijoW > 0) {
        doc.setFillColor(27, 67, 50);
        doc.rect(bx, y + 1, fijoW, 4.5, 'F');
      }
      if (varW > 0) {
        doc.setFillColor(89, 180, 71);
        doc.rect(bx + fijoW, y + 1, varW, 4.5, 'F');
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(51, 65, 85);
      const metricsText = `${formatCurrencySoles(s.total)} (${s.count} docs · IGV ${formatCurrencySoles(s.igv)}${
        s.budgetTotal > 0 ? ` · ${s.executionPct}% ppto` : ''
      })`;
      doc.text(metricsText, bx + barAreaW + 3, y + 4.5);

      y += 7.5;
    }

    // Legend
    doc.setFillColor(27, 67, 50);
    doc.rect(margin, y, 3, 2.5, 'F');
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105);
    doc.text('Costo Fijo', margin + 4.5, y + 2.2);

    doc.setFillColor(89, 180, 71);
    doc.rect(margin + 24, y, 3, 2.5, 'F');
    doc.text('Costo Variable', margin + 28.5, y + 2.2);

    y += 7;
  }

  // Section 3: Monthly Evolution & IGV Progress
  if (options.includeMonthlyIgvChart) {
    ensureSpace(24);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(27, 67, 50);
    doc.text('Evolución Mensual y Avance de IGV (Crédito Fiscal 18%)', margin, y);
    y += 4.5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);
    const fiscalLine = filters.fiscalComparison && filters.fiscalComparison.totalVentas > 0
      ? ` | Ventas Boleteadas: ${formatCurrencySoles(
          filters.fiscalComparison.totalVentas
        )} (IGV Ventas: ${formatCurrencySoles(
          filters.fiscalComparison.igvVentas
        )} vs IGV Compras: ${formatCurrencySoles(
          filters.fiscalComparison.igvCompras
        )} → Neto: ${formatCurrencySoles(filters.fiscalComparison.igvNeto)})`
      : '';
    doc.text(
      `Base Gravada Facturas: ${formatCurrencySoles(igvProgress.subtotalGravado)} | IGV Compras: ${formatCurrencySoles(
        igvProgress.igvCreditoFiscal
      )} (${igvProgress.igvOverTotalPct}% del gasto)${fiscalLine}`,
      margin,
      y + 2,
      { maxWidth: contentWidth }
    );
    y += fiscalLine ? 7 : 5;

    if (monthRows.length > 0) {
      const maxMonthTotal = Math.max(...monthRows.map((m) => m.total), 1);
      const mBarW = contentWidth * 0.42;

      for (const m of monthRows) {
        ensureSpace(7.5);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(15, 23, 42);
        doc.text(m.mes, margin, y + 3.5);

        const bx = margin + 30;
        doc.setFillColor(241, 245, 249);
        doc.rect(bx, y + 0.5, mBarW, 4, 'F');

        const totW = (m.total / maxMonthTotal) * mBarW;
        const igvW = (m.igv / maxMonthTotal) * mBarW;
        if (totW > 0) {
          doc.setFillColor(148, 163, 184);
          doc.rect(bx, y + 0.5, totW, 4, 'F');
        }
        if (igvW > 0) {
          doc.setFillColor(16, 185, 129);
          doc.rect(bx, y + 0.5, igvW, 4, 'F');
        }

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(51, 65, 85);
        doc.text(
          `Total ${formatCurrencySoles(m.total)} | IGV ${formatCurrencySoles(m.igv)} (${m.count} docs)`,
          bx + mBarW + 3,
          y + 3.5
        );
        y += 6.5;
      }
    } else {
      doc.setFontSize(8);
      doc.text('Sin movimientos mensuales en el rango filtrado.', margin, y + 3);
      y += 6;
    }

    y += 4;
  }

  // Section 4: Detailed Table
  if (options.includeTable && filteredExpenses.length > 0) {
    ensureSpace(18);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(27, 67, 50);
    doc.text(`Detalle de Comprobantes (${filteredExpenses.length} registros)`, margin, y);
    y += 4.5;

    const colDefs: Array<{
      key: keyof CustomPdfOptions['columns'];
      label: string;
      weight: number;
      align: 'left' | 'right';
    }> = [
      { key: 'fecha', label: 'Fecha', weight: 15, align: 'left' },
      { key: 'sede', label: 'Sede', weight: 15, align: 'left' },
      { key: 'numero', label: 'N° Comprob.', weight: 22, align: 'left' },
      { key: 'proveedor', label: 'Proveedor / RUC', weight: 38, align: 'left' },
      { key: 'clasificacion', label: 'Clasificación', weight: 30, align: 'left' },
      { key: 'subtotal', label: 'Subtot.', weight: 14, align: 'right' },
      { key: 'igv', label: 'IGV', weight: 12, align: 'right' },
      { key: 'total', label: 'Total S/', weight: 15, align: 'right' },
    ];

    const activeCols = colDefs.filter((c) => options.columns[c.key]);
    const totalWeight = activeCols.reduce((acc, c) => acc + c.weight, 0) || 1;
    const computedCols = activeCols.map((c) => ({
      ...c,
      widthMm: (c.weight / totalWeight) * contentWidth,
    }));

    const drawTableHeader = () => {
      doc.setFillColor(241, 245, 249);
      doc.setDrawColor(203, 213, 225);
      doc.rect(margin, y, contentWidth, 6.5, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.setTextColor(30, 41, 59);

      let cx = margin;
      for (const col of computedCols) {
        if (col.align === 'right') {
          doc.text(col.label, cx + col.widthMm - 1.5, y + 4.4, { align: 'right' });
        } else {
          doc.text(col.label, cx + 1.5, y + 4.4);
        }
        cx += col.widthMm;
      }
      y += 6.5;
    };

    drawTableHeader();

    filteredExpenses.forEach((rec, index) => {
      if (y + 6.5 > pageHeight - 14) {
        doc.addPage();
        y = 14;
        drawTableHeader();
      }

      if (index % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y, contentWidth, 6, 'F');
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(30, 41, 59);

      let cx = margin;
      for (const col of computedCols) {
        let val = '';
        switch (col.key) {
          case 'fecha':
            val = rec.fecha || '-';
            break;
          case 'sede':
            val = (rec.sede || '-').slice(0, 12);
            break;
          case 'numero':
            val = (rec.numeroComprobante || 'S/N').slice(0, 18);
            break;
          case 'proveedor':
            val = `${rec.nombreComercial || rec.razonSocial || '-'}${
              rec.ruc ? ` (${rec.ruc})` : ''
            }`.slice(0, options.orientation === 'landscape' ? 38 : 26);
            break;
          case 'clasificacion':
            val = `${rec.naturaleza === 'Costo Fijo' ? 'Fijo' : 'Var.'} · ${rec.subtipo || rec.categoriaPrincipal}`.slice(
              0,
              options.orientation === 'landscape' ? 32 : 22
            );
            break;
          case 'subtotal':
            val = (Number(rec.subtotal) || 0).toFixed(2);
            break;
          case 'igv':
            val = (Number(rec.igv) || 0).toFixed(2);
            break;
          case 'total':
            val = (Number(rec.total) || 0).toFixed(2);
            break;
        }

        if (col.align === 'right') {
          doc.text(val, cx + col.widthMm - 1.5, y + 4.2, { align: 'right' });
        } else {
          doc.text(val, cx + 1.5, y + 4.2);
        }
        cx += col.widthMm;
      }

      doc.setDrawColor(226, 232, 240);
      doc.line(margin, y + 6, margin + contentWidth, y + 6);
      y += 6;
    });
  }

  // Page Footer across all pages
  const totalPages = doc.getNumberOfPages();
  const stamp = new Date().toLocaleString('es-PE');
  for (let p = 1; p <= totalPages; p += 1) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `CREDIBAN PERU S.A.C. · Generado por ${filters.generadoPor} el ${stamp}`,
      margin,
      pageHeight - 6
    );
    doc.text(`Página ${p} de ${totalPages}`, pageWidth - margin, pageHeight - 6, {
      align: 'right',
    });
  }

  const safeTitle = (options.title || 'Reporte_CREDIBAN')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_');
  doc.save(`${safeTitle}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
