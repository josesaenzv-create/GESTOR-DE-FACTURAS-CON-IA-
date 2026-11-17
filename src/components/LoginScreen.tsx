import React, { useEffect, useState } from 'react';
import { Lock, User, LogIn, Building2, ShieldCheck } from 'lucide-react';
import { CredibanLogo } from './CredibanLogo';
import { CREDIBAN_COMPANY, type UserSession } from '../types/crediban';
import { authenticateUser, fetchUsersDirectory } from '../services/credibanApi';

interface LoginScreenProps {
  onLoginSuccess: (session: UserSession, remember: boolean) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [remember, setRemember] = useState(true);
  const [directory, setDirectory] = useState<UserSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetchUsersDirectory()
      .then((users) => {
        if (active) setDirectory(users);
      })
      .finally(() => {
        if (active) setLoadingUsers(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await authenticateUser(usuario, clave);
      if (res.ok && res.user) {
        onLoginSuccess(res.user, remember);
      } else {
        setError(res.message || 'Usuario o clave incorrectos.');
      }
    } catch {
      setError('No se pudo verificar la sesión. Intente nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  const applyQuickUser = (u: string, pass: string) => {
    setUsuario(u);
    setClave(pass);
    setError('');
  };

  return (
    <div className="min-h-screen bg-[#f1f5f9] flex items-center justify-center p-4 md:p-8">
      <div className="w-full max-w-4xl bg-white rounded-2xl border border-slate-200 overflow-hidden grid grid-cols-1 md:grid-cols-12">
        {/* Corporate Left Panel */}
        <div className="md:col-span-5 bg-[#0f291e] text-white p-8 flex flex-col justify-between">
          <div>
            <CredibanLogo variant="login" />
            <h1 className="mt-8 text-2xl font-bold tracking-tight text-white leading-snug">
              Control Inteligente de Gastos y Facturas
            </h1>
            <p className="mt-3 text-sm text-emerald-100/80 leading-relaxed">
              Plataforma corporativa de {CREDIBAN_COMPANY.nombre} para escaneo IA de comprobantes SUNAT, control por sedes, directorio de proveedores y enrutamiento GPS.
            </p>
          </div>

          <div className="mt-8 pt-6 border-t border-emerald-800/60 space-y-3 text-xs text-emerald-100/80">
            <div className="flex items-center gap-2.5">
              <Building2 className="w-4 h-4 text-[#59B447] shrink-0" />
              <span>RUC Corporativo: <strong className="font-mono text-white">{CREDIBAN_COMPANY.ruc}</strong></span>
            </div>
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-4 h-4 text-[#59B447] shrink-0" />
              <span>Sincronización directa con Google Sheets & Drive HD</span>
            </div>
          </div>
        </div>

        {/* Form Right Panel */}
        <div className="md:col-span-7 p-8 md:p-10 flex flex-col justify-center">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-slate-900">Iniciar Sesión Corporativa</h2>
            <p className="text-sm text-slate-500 mt-1">
              Ingresa tus credenciales asignadas en el Maestro de Usuarios.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-usuario" className="block text-sm font-medium text-slate-700 mb-1.5">
                Usuario de Agencia o Gerencia
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="login-usuario"
                  type="text"
                  list="crediban-users-datalist"
                  value={usuario}
                  onChange={(e) => setUsuario(e.target.value)}
                  placeholder={loadingUsers ? 'Cargando directorio...' : 'Ej. GERENCIA o CAJA_HUACHO'}
                  required
                  autoComplete="username"
                  className="w-full pl-10 pr-4 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#59B447]/30 focus:border-[#59B447]"
                />
                <datalist id="crediban-users-datalist">
                  {directory.map((u) => (
                    <option key={u.usuario} value={u.usuario}>
                      {u.cargo} · {u.sede}
                    </option>
                  ))}
                </datalist>
              </div>
            </div>

            <div>
              <label htmlFor="login-clave" className="block text-sm font-medium text-slate-700 mb-1.5">
                Clave de Acceso
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="login-clave"
                  type="password"
                  value={clave}
                  onChange={(e) => setClave(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="w-full pl-10 pr-4 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#59B447]/30 focus:border-[#59B447]"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-[#59B447] focus:ring-[#59B447]"
                />
                <span>Mantener sesión abierta</span>
              </label>
            </div>

            {error && (
              <div
                role="alert"
                className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-[#1B4332] hover:bg-[#0f291e] disabled:opacity-60 text-white font-semibold text-sm rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <LogIn className="w-4 h-4" />
              <span>{loading ? 'Validando acceso...' : 'Ingresar al Sistema'}</span>
            </button>
          </form>

          {/* Quick Local Cache Profiles for Offline / Immediate Access */}
          <div className="mt-6 pt-5 border-t border-slate-200">
            <p className="text-xs text-slate-500 mb-2.5">
              Perfiles de respaldo offline (clave local: <span className="font-mono font-medium">123</span>):
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => applyQuickUser('GERENCIA', '123')}
                className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md transition-colors cursor-pointer"
              >
                Gerencia (Todas las sedes)
              </button>
              <button
                type="button"
                onClick={() => applyQuickUser('CAJA_HUACHO', '123')}
                className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md transition-colors cursor-pointer"
              >
                Caja Huacho (Agencia)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
