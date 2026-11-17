import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, Type } from '@google/genai';

const PORT = Number(process.env.PORT || 3000);
const OFFICIAL_CATEGORIES = [
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
];

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '20mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      geminiConfigured: Boolean(
        process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
      ),
    });
  });

  app.post('/api/scan-invoice', async (req: Request, res: Response) => {
    try {
      const { imageBase64, mimeType, criteria } = req.body as {
        imageBase64?: string;
        mimeType?: string;
        criteria?: Array<{
          naturaleza: string;
          categoriaForms: string;
          categoriaPrincipal: string;
          subtipo: string;
          palabrasClaveIA: string;
        }>;
      };

      if (!imageBase64) {
        res.status(400).json({ error: 'No se recibió imagen del comprobante.' });
        return;
      }

      const ai = getGeminiClient();
      if (!ai) {
        res.json({
          result: null,
          fallback: 'ocr-local',
          reason: 'Modo OCR gratuito local activo.',
        });
        return;
      }

      const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
      const safeMime = mimeType || 'image/jpeg';

      const criteriaSummary = Array.isArray(criteria)
        ? criteria
            .slice(0, 30)
            .map(
              (c) =>
                `- [${c.naturaleza}] CatForms: "${c.categoriaForms}" | Principal: "${c.categoriaPrincipal}" | Subtipo: "${c.subtipo}" | Claves: ${c.palabrasClaveIA}`
            )
            .join('\n')
        : '';

      const prompt = `Eres un auditor contable peruano experto en comprobantes SUNAT para CREDIBAN PERU S.A.C. (RUC 20613997360).
Analiza la imagen del comprobante (Factura, Boleta, Ticket o Recibo) y extrae los datos reales visibles con máxima precisión.

Reglas estrictas:
1. "ruc": Solo los 11 dígitos del RUC del EMISOR (o 8 dígitos si es DNI), sin puntos ni guiones. Nunca devuelvas el RUC de CREDIBAN (20613997360) como emisor.
2. "tipoComprobante": Debe ser exactamente uno de: "FACTURA", "BOLETA", "TICKET DE VENTA", "RECIBO DE CAJA", "SOLO CAPTURA".
3. "fechaEmision": Formato exacto "YYYY-MM-DD". Si no se distingue el año, usa el actual.
4. "numeroComprobante": Serie y correlativo exacto (ej. "F001-000456" o "B002-001234").
5. "nombreComercial": Nombre corto comercial conocido o rubro (ej. "Grifo Primax", "Pluz Energía Luz", "Movistar").
6. "subtotal", "igv", "total": Números con 2 decimales. Si es FACTURA peruana y el IGV (18%) no es explícito, calcula subtotal = total / 1.18 e igv = total - subtotal. Si es BOLETA o RECIBO, igv = 0 y subtotal = total.
7. "categoria": Debe coincidir exactamente con una de las 19 categorías oficiales:
${OFFICIAL_CATEGORIES.map((c) => `  * ${c}`).join('\n')}
8. "naturaleza": "Costo Fijo" o "Costo Variable" según el catálogo de criterios:
${criteriaSummary}
9. "scoreConfiabilidad": Puntaje entre 0.0 y 1.0 indicando qué tan legible es la foto.`;

      const modelsToTry = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'] as const;
      let rawText = '';
      let lastError: unknown = null;

      for (const model of modelsToTry) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: safeMime,
                    data: cleanBase64,
                  },
                },
                { text: prompt },
              ],
            },
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  tipoComprobante: { type: Type.STRING },
                  numeroComprobante: { type: Type.STRING },
                  fechaEmision: { type: Type.STRING },
                  ruc: { type: Type.STRING },
                  razonSocial: { type: Type.STRING },
                  nombreComercial: { type: Type.STRING },
                  subtotal: { type: Type.NUMBER },
                  igv: { type: Type.NUMBER },
                  total: { type: Type.NUMBER },
                  naturaleza: { type: Type.STRING },
                  categoria: { type: Type.STRING },
                  subtipo: { type: Type.STRING },
                  descripcion: { type: Type.STRING },
                  scoreConfiabilidad: { type: Type.NUMBER },
                },
              },
            },
          });
          rawText = (response.text ?? '{}').trim();
          if (rawText) break;
        } catch (err) {
          lastError = err;
          await new Promise((r) => setTimeout(r, 400));
        }
      }

      if (!rawText) {
        const msg =
          lastError instanceof Error ? lastError.message : 'Servicio IA temporalmente ocupado.';
        res.json({
          result: null,
          fallback: 'ocr-local',
          reason: msg,
        });
        return;
      }

      const cleanJson = rawText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      const parsed = JSON.parse(cleanJson) as Record<string, unknown>;

      const validCategory =
        OFFICIAL_CATEGORIES.find(
          (c) => c.toLowerCase() === String(parsed.categoria || '').toLowerCase()
        ) || 'Otros gastos operativos';

      const validNaturaleza = String(parsed.naturaleza || '').toLowerCase().includes('fijo')
        ? 'Costo Fijo'
        : 'Costo Variable';

      res.json({
        result: {
          tipoComprobante: parsed.tipoComprobante || 'FACTURA',
          numeroComprobante: String(parsed.numeroComprobante || ''),
          fechaEmision: String(parsed.fechaEmision || new Date().toISOString().slice(0, 10)),
          ruc: String(parsed.ruc || '').replace(/\D/g, ''),
          razonSocial: String(parsed.razonSocial || ''),
          nombreComercial: String(parsed.nombreComercial || parsed.razonSocial || ''),
          subtotal: Number(parsed.subtotal || 0),
          igv: Number(parsed.igv || 0),
          total: Number(parsed.total || 0),
          naturaleza: validNaturaleza,
          categoria: validCategory,
          subtipo: String(parsed.subtipo || 'General'),
          descripcion: String(parsed.descripcion || ''),
          scoreConfiabilidad: Number(parsed.scoreConfiabilidad || 0.85),
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error inesperado al analizar comprobante.';
      res.json({ result: null, fallback: 'ocr-local', reason: msg });
    }
  });

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('/{*splat}', (_req: Request, res: Response) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CREDIBAN server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
