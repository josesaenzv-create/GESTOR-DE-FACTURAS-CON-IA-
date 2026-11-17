import React, { useState } from 'react';
import { ArrowLeftRight, Building, Plus, Sliders, CheckCircle2 } from 'lucide-react';
import {
  OFFICIAL_CATEGORIES,
  type ExpenseCriterion,
  type NaturalezaGasto,
  type SedeRecord,
  type UserSession,
} from '../types/crediban';
import {
  createSedeInBackend,
  moveCriterionNatureInBackend,
  saveCriterionInBackend,
} from '../services/credibanApi';

interface ConfigTabProps {
  user: UserSession;
  criteria: ExpenseCriterion[];
  sedes: SedeRecord[];
  onCriterionMoved: (
    idCriterio: string,
    nuevaNaturaleza: NaturalezaGasto,
    reclasificarHistoricos: boolean,
    categoriaPrincipal: string,
    subtipo: string
  ) => void;
  onCriterionSaved: (criterion: ExpenseCriterion) => void;
  onSedeCreated: (sede: SedeRecord) => void;
}

export const ConfigTab: React.FC<ConfigTabProps> = ({
  user,
  criteria,
  sedes,
  onCriterionMoved,
  onCriterionSaved,
  onSedeCreated,
}) => {
  const [reclassifyHistorical, setReclassifyHistorical] = useState(true);
  const [feedback, setFeedback] = useState('');

  // New/Edit Criterion Form
  const [critNature, setCritNature] = useState<NaturalezaGasto>('Costo Variable');
  const [critCatForms, setCritCatForms] = useState<string>(OFFICIAL_CATEGORIES[0]);
  const [critPrincipal, setCritPrincipal] = useState('');
  const [critSubtipo, setCritSubtipo] = useState('');
  const [critKeywords, setCritKeywords] = useState('');
  const [critTope, setCritTope] = useState('250');

  // New Sede Form
  const [sedeName, setSedeName] = useState('');
  const [sedeCode, setSedeCode] = useState('');
  const [sedeBudgetFixed, setSedeBudgetFixed] = useState('6000');
  const [sedeBudgetVar, setSedeBudgetVar] = useState('4500');

  const handleMoveNature = async (c: ExpenseCriterion) => {
    const nextNature: NaturalezaGasto =
      c.naturaleza === 'Costo Fijo' ? 'Costo Variable' : 'Costo Fijo';

    onCriterionMoved(
      c.idCriterio,
      nextNature,
      reclassifyHistorical,
      c.categoriaPrincipal,
      c.subtipo
    );

    const res = await moveCriterionNatureInBackend({
      idCriterio: c.idCriterio,
      categoriaPrincipal: c.categoriaPrincipal,
      subtipo: c.subtipo,
      nuevaNaturaleza: nextNature,
      reclasificarHistoricos: reclassifyHistorical,
      usuario: user.usuario,
    });
    setFeedback(
      `${c.subtipo} movido a ${nextNature}${
        reclassifyHistorical ? ' (históricos reclasificados)' : ''
      }. ${res.message}`
    );
  };

  const handleSaveCriterion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!critPrincipal.trim() || !critSubtipo.trim()) return;

    const newCrit: ExpenseCriterion = {
      idCriterio: `CRIT-${String(criteria.length + 1).padStart(2, '0')}`,
      naturaleza: critNature,
      categoriaForms: critCatForms,
      categoriaPrincipal: critPrincipal.trim(),
      subtipo: critSubtipo.trim(),
      palabrasClaveIA: critKeywords.trim(),
      aplicaIgvDefecto: true,
      topeAlertaSoles: parseFloat(critTope) || 250,
      estado: 'ACTIVO',
      modificadoPor: user.usuario,
    };

    onCriterionSaved(newCrit);
    const res = await saveCriterionInBackend(newCrit, user.usuario);
    setFeedback(res.message);
    setCritPrincipal('');
    setCritSubtipo('');
    setCritKeywords('');
  };

  const handleCreateSede = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = sedeName.trim().toUpperCase();
    if (!cleanName) return;

    const newSede: SedeRecord = {
      codigoSede: (sedeCode.trim() || cleanName.slice(0, 3)).toUpperCase(),
      nombreSede: cleanName,
      estado: 'ACTIVO',
      presupuestoMensualFijo: parseFloat(sedeBudgetFixed) || 6000,
      presupuestoMensualVariable: parseFloat(sedeBudgetVar) || 4500,
      nombreHojaSede: `SEDE_${cleanName}`,
    };

    onSedeCreated(newSede);
    const res = await createSedeInBackend(newSede, user.usuario);
    setFeedback(res.message);
    setSedeName('');
    setSedeCode('');
  };

  return (
    <div className="space-y-6">
      {feedback && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800 flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Panel A: Reclassify Costo Fijo <-> Costo Variable */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Sliders className="w-4 h-4 text-[#59B447]" />
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Catálogo Contable: Costo Fijo vs. Costo Variable
              </h2>
              <p className="text-xs text-slate-500">
                Sincronizado con PARAMETROS_GASTOS en Google Sheets.
              </p>
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={reclassifyHistorical}
              onChange={(e) => setReclassifyHistorical(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-[#59B447] focus:ring-[#59B447]"
            />
            <span>Reclasificar automáticamente históricos al mover</span>
          </label>
        </div>

        <div className="overflow-x-auto max-h-[380px]">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
              <tr>
                <th className="py-2.5 px-4">Naturaleza</th>
                <th className="py-2.5 px-4">Categoría Principal</th>
                <th className="py-2.5 px-4">Subtipo</th>
                <th className="py-2.5 px-4">Palabras Clave IA</th>
                <th className="py-2.5 px-4 text-right">Tope (S/)</th>
                <th className="py-2.5 px-4 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {criteria.map((c) => (
                <tr key={c.idCriterio} className="hover:bg-slate-50">
                  <td className="py-2.5 px-4 whitespace-nowrap font-semibold">
                    <span
                      className={
                        c.naturaleza === 'Costo Fijo' ? 'text-[#1B4332]' : 'text-amber-700'
                      }
                    >
                      {c.naturaleza}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 font-medium text-slate-800">
                    {c.categoriaPrincipal}
                  </td>
                  <td className="py-2.5 px-4 text-slate-700">{c.subtipo}</td>
                  <td className="py-2.5 px-4 text-slate-500 max-w-[240px] truncate">
                    {c.palabrasClaveIA || '—'}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                    {c.topeAlertaSoles.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-4 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleMoveNature(c)}
                      className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md inline-flex items-center gap-1 cursor-pointer"
                    >
                      <ArrowLeftRight className="w-3 h-3" />
                      <span>
                        Mover a {c.naturaleza === 'Costo Fijo' ? 'Variable' : 'Fijo'}
                      </span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottom 2-Column Split: Create Criterion + Create Sede */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Panel B: Add Criterion */}
        <form
          onSubmit={handleSaveCriterion}
          className="bg-white rounded-xl border border-slate-200 p-5 space-y-4"
        >
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-[#59B447]" />
            <h3 className="text-sm font-bold text-slate-900">
              Agregar Criterio o Subtipo Contable
            </h3>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="crit-nat" className="block text-xs font-medium text-slate-700 mb-1">
                Naturaleza
              </label>
              <select
                id="crit-nat"
                value={critNature}
                onChange={(e) => setCritNature(e.target.value as NaturalezaGasto)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              >
                <option value="Costo Fijo">Costo Fijo</option>
                <option value="Costo Variable">Costo Variable</option>
              </select>
            </div>
            <div>
              <label htmlFor="crit-forms" className="block text-xs font-medium text-slate-700 mb-1">
                Categoría Forms
              </label>
              <select
                id="crit-forms"
                value={critCatForms}
                onChange={(e) => setCritCatForms(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              >
                {OFFICIAL_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="crit-princ" className="block text-xs font-medium text-slate-700 mb-1">
                Categoría Principal
              </label>
              <input
                id="crit-princ"
                type="text"
                required
                value={critPrincipal}
                onChange={(e) => setCritPrincipal(e.target.value)}
                placeholder="Ej. Servicios Públicos"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="crit-sub" className="block text-xs font-medium text-slate-700 mb-1">
                Subtipo Específico
              </label>
              <input
                id="crit-sub"
                type="text"
                required
                value={critSubtipo}
                onChange={(e) => setCritSubtipo(e.target.value)}
                placeholder="Ej. Mantenimiento POS"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label htmlFor="crit-kw" className="block text-xs font-medium text-slate-700 mb-1">
                Palabras Clave para IA
              </label>
              <input
                id="crit-kw"
                type="text"
                value={critKeywords}
                onChange={(e) => setCritKeywords(e.target.value)}
                placeholder="izipay, niubiz, pos, terminal"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="crit-tope" className="block text-xs font-medium text-slate-700 mb-1">
                Tope Alerta (S/)
              </label>
              <input
                id="crit-tope"
                type="number"
                value={critTope}
                onChange={(e) => setCritTope(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <button
            type="submit"
            className="px-4 py-2 bg-[#1B4332] hover:bg-[#0f291e] text-white text-xs font-semibold rounded-lg cursor-pointer"
          >
            Guardar Criterio en BD
          </button>
        </form>

        {/* Panel C: Create New Sede */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Building className="w-4 h-4 text-[#59B447]" />
            <h3 className="text-sm font-bold text-slate-900">
              Gestión Dinámica de Sedes (CAT_SEDES + Drive)
            </h3>
          </div>

          <form onSubmit={handleCreateSede} className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label htmlFor="sede-name" className="block text-xs font-medium text-slate-700 mb-1">
                  Nombre Nueva Sede
                </label>
                <input
                  id="sede-name"
                  type="text"
                  required
                  value={sedeName}
                  onChange={(e) => setSedeName(e.target.value)}
                  placeholder="Ej. BARRANCA"
                  className="w-full px-3 py-2 text-xs uppercase border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="sede-code" className="block text-xs font-medium text-slate-700 mb-1">
                  Código
                </label>
                <input
                  id="sede-code"
                  type="text"
                  value={sedeCode}
                  onChange={(e) => setSedeCode(e.target.value)}
                  placeholder="BAR"
                  maxLength={5}
                  className="w-full px-3 py-2 text-xs font-mono uppercase border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="sede-pf" className="block text-xs font-medium text-slate-700 mb-1">
                  Presupuesto Mensual Fijo (S/)
                </label>
                <input
                  id="sede-pf"
                  type="number"
                  value={sedeBudgetFixed}
                  onChange={(e) => setSedeBudgetFixed(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="sede-pv" className="block text-xs font-medium text-slate-700 mb-1">
                  Presupuesto Mensual Variable (S/)
                </label>
                <input
                  id="sede-pv"
                  type="number"
                  value={sedeBudgetVar}
                  onChange={(e) => setSedeBudgetVar(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <button
              type="submit"
              className="px-4 py-2 bg-[#1B4332] hover:bg-[#0f291e] text-white text-xs font-semibold rounded-lg cursor-pointer"
            >
              Crear Sede, Hoja y Carpeta Drive
            </button>
          </form>

          <div className="pt-3 border-t border-slate-200">
            <p className="text-xs font-medium text-slate-600 mb-2">
              Sedes activas ({sedes.length}):
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
              {sedes.map((s) => (
                <span key={s.nombreSede} className="font-mono">
                  {s.nombreSede}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
