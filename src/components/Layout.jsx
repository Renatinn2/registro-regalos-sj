import { NavLink } from 'react-router-dom';
import { supabase } from '../supabase';
import { esRolAdmin } from '../lib/roles';

export default function Layout({ perfil, children }) {
  const admin = esRolAdmin(perfil.rol);
  const enlaces = admin
    ? [
        ['/', 'Panel'],
        ['/usuarios', 'Usuarios'],
      ]
    : [
        ['/', 'Inicio'],
        ['/registro', 'Registrar niño/a'],
        ['/entrega', 'Entregar regalo'],
      ];

  return (
    <>
      <nav className="navbar navbar-dark bg-dark px-3 mb-3 barra-app" style={{ borderRadius: 0 }}>
        <span className="navbar-brand fw-semibold me-3">Regalos San Joaquín</span>
        <div className="enlaces">
          {enlaces.map(([to, texto]) => (
            <NavLink
              key={to}
              to={to}
              end
              className={({ isActive }) => `nav-link px-0 ${isActive ? 'active fw-semibold' : ''}`}
            >
              {texto}
            </NavLink>
          ))}
        </div>
        <div className="usuario">
          <span className="text-muted small d-none d-md-inline">
            {perfil.nombre_completo} · {perfil.rol}
          </span>
          <button className="btn btn-sm btn-outline-light" onClick={() => supabase.auth.signOut()}>
            Salir
          </button>
        </div>
      </nav>
      <main className="container-fluid pb-5" style={{ maxWidth: 1100 }}>
        {children}
      </main>
    </>
  );
}