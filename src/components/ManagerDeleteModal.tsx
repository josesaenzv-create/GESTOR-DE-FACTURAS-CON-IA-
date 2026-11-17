import React, { useState } from 'react';
import { ShieldAlert, Trash2, X, Lock, Eye, EyeOff } from 'lucide-react';
import type { ExpenseRecord, UserSession } from '../types/crediban';
import { formatCurrencySoles, isManagerUser } from '../utils/accounting';
import { deleteExpenseInBackend, verifyManagerPassword } from '../services/credibanApi';

interface ManagerDeleteModalProps {
  record: ExpenseRecord;
  user: UserSession;
  onClose: () => void;
  onDeleted: (id: string) => void;
}

export const ManagerDeleteModal: React.FC<ManagerDeleteModalProps> = ({
  record,
  user,
  onClose,
  onDeleted,
}) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const isManager = isManagerUser(user);

  const handleConfirmDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isManager) {
      setError('Solo un Gerente autorizado puede eliminar registros.');
      return;
    }
    const cleanPass = password.trim();
    if (!cleanPass) {
      setError('Ingresa tu clave de Gerente para autorizar la eliminación.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const check = await verifyManagerPassword(user.usuario, cleanPass);
      if (!check.ok) {
        setError(check.message || 'Clave incorrecta. No se eliminó el registro.');
        return;
      }

      const res = await deleteExpenseInBackend(record.id, user, cleanPass);
      if (!res.ok) {
        setError(res.message || 'El servidor rechazó la eliminación.');
        return;
      }

      onDeleted(record.id);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No se pudo completar la eliminación.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Confirmar eliminación de comprobante ${record.numeroComprobante || record.id}`}
      className="fixed inset-0 z-[60] bg-slate-900/65 backdrop-blur-[2px] flex items-center justify-center p-4"
    >
      <form
        onSubmit={handleConfirmDelete}
        className="bg-white rounded-2xl border border-slate-200 w-full max-w-md overflow-hidden shadow-xl"
      >
        <div className="px-5 py-4 border-b border-red-100 bg-red-50/70 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-red-100 text-red-700 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Autorización de Gerencia para Eliminar
              </h3>
              <p className="text-[11px] text-slate-600">
                Limpieza individual protegida con clave de administrador
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar confirmación de eliminación"
            className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Record summary */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono font-bold text-slate-800">{record.id}</span>
              <span className="font-mono font-semibold text-slate-600">
                {record.sede} · {record.fecha}
              </span>
            </div>
            <p className="font-semibold text-slate-900 truncate">
              {record.razonSocial || record.nombreComercial || 'SIN PROVEEDOR'}
            </p>
            <div className="flex items-center justify-between gap-2 text-slate-600">
              <span>
                {record.tipoComprobante} · {record.numeroComprobante || 'S/N'}
              </span>
              <span className="font-mono font-extrabold text-red-700">
                {formatCurrencySoles(record.total)}
              </span>
            </div>
          </div>

          <div>
            <label
              htmlFor="manager-delete-password"
              className="block text-xs font-semibold text-slate-700 mb-1.5"
            >
              Ingresa tu Clave de Gerente ({user.usuario})
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="manager-delete-password"
                type={showPassword ? 'text' : 'password'}
                autoFocus
                required
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError('');
                }}
                placeholder="Contraseña de Gerencia..."
                className="w-full pl-9 pr-10 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Ocultar clave' : 'Mostrar clave'}
                className="p-1.5 text-slate-400 hover:text-slate-700 absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
            >
              {error}
            </p>
          )}
        </div>

        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy || !isManager}
            className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{busy ? 'Validando y Eliminando...' : 'Confirmar Eliminación'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
