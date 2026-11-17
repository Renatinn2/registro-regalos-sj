import { useState } from 'react';
import { supabase } from '../supabase';

// CR-01: no existe registro público. Solo inicio de sesión con cuentas creadas por la Municipalidad.
export default function Login({ aviso }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const entrar = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError('Credenciales incorrectas.');
    setLoading(false);
  };

  return (
    <div className="d-flex min-vh-100 align-items-center justify-content-center p-3">
      <form onSubmit={entrar} className="card p-4 w-100" style={{ maxWidth: 400 }}>
        <h4 className="text-center mb-1">Sistema de Regalos</h4>
        <p className="text-muted small text-center mb-4">Ilustre Municipalidad de San Joaquín</p>
        {aviso && <div className="alert alert-warning py-2 small">{aviso}</div>}
        <input className="form-control mb-3" type="email" placeholder="Correo" autoComplete="username"
          value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="form-control mb-3" type="password" placeholder="Contraseña" autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <div className="text-danger small mb-3">{error}</div>}
        <button className="btn btn-dark w-100 py-2" disabled={loading}>{loading ? 'Ingresando...' : 'Ingresar'}</button>
        <p className="text-muted small text-center mt-3 mb-0">¿Sin cuenta? Solicítala a tu supervisor municipal.</p>
      </form>
    </div>
  );
}
