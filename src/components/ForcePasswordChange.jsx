import { useState } from 'react';
import { supabase } from '../supabase';
import { mensajeError } from '../lib/mensajes';

const reglas = [
  [(p) => p.length >= 8, 'Mínimo 8 caracteres'],
  [(p) => /[a-z]/.test(p), 'Una minúscula'],
  [(p) => /[A-Z]/.test(p), 'Una mayúscula'],
  [(p) => /\d/.test(p), 'Un número'],
  [(p) => /[^A-Za-z0-9]/.test(p), 'Un símbolo'],
];

// CR-02: pantalla de paso obligatorio tras el primer ingreso con clave temporal.
export default function ForcePasswordChange({ perfil, onDone }) {
  const [clave, setClave] = useState('');
  const [confirma, setConfirma] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const cumple = reglas.every(([f]) => f(clave));

  const guardar = async (e) => {
    e.preventDefault();
    if (!cumple) return setError('La contraseña no cumple los requisitos.');
    if (clave !== confirma) return setError('Las contraseñas no coinciden.');
    setLoading(true);
    setError(null);

    const { error: errClave } = await supabase.auth.updateUser({ password: clave });
    if (errClave) {
      setError(mensajeError(errClave, 'No pudimos cambiar la contraseña. Inténtalo nuevamente.'));
      setLoading(false);
      return;
    }

    // La bandera se apaga por RPC (el usuario no puede editar su propio perfil) y deja huella en auditoría.
    const { error: errPerfil } = await supabase.rpc('completar_cambio_clave');
    if (errPerfil) {
      console.error('[detalle técnico]', errPerfil);
      setError(
        'Tu contraseña se actualizó, pero no pudimos terminar el proceso. Cierra sesión y vuelve a ingresar con tu nueva clave.'
      );
      setLoading(false);
      return;
    }

    // Al actualizar el perfil con requiere_cambio_clave = false, App.jsx redirige automáticamente a '/'
    await onDone();
  };

  return (
    <div className="d-flex min-vh-100 align-items-center justify-content-center p-3">
      <form onSubmit={guardar} className="card p-4 w-100" style={{ maxWidth: 440 }}>
        <h4 className="text-center mb-2">Actualización obligatoria</h4>
        <p className="text-muted small text-center">
          Hola {perfil.nombre_completo}. Por seguridad debes reemplazar tu contraseña temporal antes de continuar.
        </p>
        <input
          className="form-control mb-2"
          type="password"
          placeholder="Nueva contraseña"
          autoComplete="new-password"
          value={clave}
          onChange={(e) => setClave(e.target.value)}
          required
        />
        <input
          className="form-control mb-3"
          type="password"
          placeholder="Repite la contraseña"
          autoComplete="new-password"
          value={confirma}
          onChange={(e) => setConfirma(e.target.value)}
          required
        />
        <ul className="list-unstyled small mb-3">
          {reglas.map(([f, texto]) => (
            <li key={texto} className={f(clave) ? 'text-success' : 'text-muted'}>
              {f(clave) ? '✓' : '•'} {texto}
            </li>
          ))}
        </ul>
        {error && <div className="text-danger small mb-3">{error}</div>}
        <button className="btn btn-dark py-2" disabled={loading || !cumple}>
          {loading ? 'Guardando...' : 'Guardar nueva contraseña'}
        </button>
      </form>
    </div>
  );
}