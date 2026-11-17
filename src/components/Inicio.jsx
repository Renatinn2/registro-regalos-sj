import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabase';

// Pantalla de inicio del perfil operativo (JJVV y roles futuros).
export default function Inicio({ perfil }) {
  const [res, setRes] = useState(null);

  useEffect(() => {
    if (!perfil.jjvv_id) return;
    supabase.from('v_avance_jjvv').select('*').eq('jjvv_id', perfil.jjvv_id).maybeSingle()
      .then(({ data }) => setRes(data));
  }, [perfil.jjvv_id]);

  return (
    <>
      <h3 className="mb-1">Hola, {perfil.nombre_completo}</h3>
      <p className="text-muted">{res?.nombre ? `Junta de Vecinos: ${res.nombre}` : 'Sin Junta de Vecinos asignada: contacta al supervisor.'}</p>

      {res && (
        <div className="row g-3 mb-4">
          {[['Registrados', res.registrados], ['Entregados', res.entregados], ['Pendientes', res.pendientes], ['Observados', res.observados]].map(([t, v]) => (
            <div className="col-6 col-md-3" key={t}>
              <div className="card p-3"><div className="text-muted small">{t}</div><div className="fs-2 fw-semibold">{v}</div></div>
            </div>
          ))}
        </div>
      )}

      <div className="row g-3">
        <div className="col-md-6"><Link to="/registro" className="btn btn-dark w-100 py-4 fs-5">Registrar niño/a</Link></div>
        <div className="col-md-6"><Link to="/entrega" className="btn btn-dark w-100 py-4 fs-5">Entregar regalo</Link></div>
      </div>
    </>
  );
}
