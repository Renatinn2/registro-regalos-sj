import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { mensajeError } from '../lib/mensajes';
import { validarRut, normalizarRut } from '../lib/rut';
import { esRolAdmin } from '../lib/roles';

// CR-01: aprovisionamiento interno. Crear usuarios en Auth exige service_role, por eso va en una Edge Function.
export default function AdminUsuarios() {
  const [usuarios, setUsuarios] = useState([]);
  const [roles, setRoles] = useState([]);
  const [jjvvs, setJjvvs] = useState([]);
  const [f, setF] = useState({ email: '', nombre_completo: '', rut: '', rol_id: '', jjvv_id: '' });
  const [msg, setMsg] = useState(null);
  const [credencial, setCredencial] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    const [u, r, j] = await Promise.all([
      supabase.from('perfiles').select('*').order('creado_el', { ascending: false }),
      supabase.from('roles').select('*').order('nombre'),
      supabase.from('jjvv').select('id,nombre,territorio,situacion_legal').order('territorio').order('nombre'),
    ]);
    setUsuarios(u.data ?? []); setRoles(r.data ?? []); setJjvvs(j.data ?? []);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const rolNombre = (id) => roles.find((r) => r.id === id)?.nombre ?? '—';
  const jjvvNombre = (id) => jjvvs.find((j) => j.id === id)?.nombre ?? '—';
  const rolElegidoEsAdmin = esRolAdmin(rolNombre(Number(f.rol_id)));

  const crear = async (e) => {
    e.preventDefault(); setMsg(null); setCredencial(null);
    if (f.rut && !validarRut(f.rut)) return setMsg({ tipo: 'danger', texto: 'RUT inválido.' });
    if (!rolElegidoEsAdmin && !f.jjvv_id) return setMsg({ tipo: 'danger', texto: 'Asigna una Junta de Vecinos a la cuenta.' });
    setGuardando(true);
    const { data, error } = await supabase.functions.invoke('crear-usuario', {
      body: { email: f.email.trim(), nombre_completo: f.nombre_completo.trim(), rut: f.rut ? normalizarRut(f.rut) : null, rol_id: Number(f.rol_id), jjvv_id: f.jjvv_id ? Number(f.jjvv_id) : null },
    });
    setGuardando(false);
    if (error) {
      let texto = error.message;
      try { texto = (await error.context.json()).error ?? texto; } catch { /* sin cuerpo */ }
      return setMsg({ tipo: 'danger', texto: mensajeError(texto, 'No pudimos crear la cuenta. Revisa los datos e inténtalo nuevamente.', { pasar: true }) });
    }
    setCredencial({ email: f.email.trim(), password: data.password_temporal });
    setF({ email: '', nombre_completo: '', rut: '', rol_id: '', jjvv_id: '' });
    cargar();
  };

  const alternarActivo = async (u) => {
    const { error } = await supabase.rpc('cambiar_estado_usuario', { p_id: u.id, p_activo: !u.activo });
    if (error) setMsg({ tipo: 'danger', texto: mensajeError(error, 'No pudimos cambiar el estado de la cuenta.') }); else cargar();
  };

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  return (
    <>
      <form onSubmit={crear} className="card p-4 mb-4">
        <h4 className="mb-3">Crear cuenta</h4>
        <div className="row g-2">
          <div className="col-md-6"><input className="form-control" type="email" placeholder="Correo" value={f.email} onChange={set('email')} required /></div>
          <div className="col-md-6"><input className="form-control" placeholder="Nombre completo" value={f.nombre_completo} onChange={set('nombre_completo')} required /></div>
          <div className="col-md-4"><input className="form-control" placeholder="RUT (opcional)" value={f.rut} onChange={set('rut')} /></div>
          <div className="col-md-4">
            <select className="form-select" value={f.rol_id} onChange={set('rol_id')} required>
              <option value="">Rol</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
            </select>
          </div>
          <div className="col-md-4">
            <select className="form-select" value={f.jjvv_id} onChange={set('jjvv_id')} disabled={rolElegidoEsAdmin}>
              <option value="">Junta de Vecinos</option>{jjvvs.map((j) => <option key={j.id} value={j.id}>T{j.territorio ?? '?'} · {j.nombre}{j.situacion_legal && j.situacion_legal !== 'VIGENTE' ? ` (${j.situacion_legal.toLowerCase()})` : ''}</option>)}
            </select>
          </div>
        </div>
        {msg && <div className={`alert alert-${msg.tipo} mt-3 mb-0`}>{msg.texto}</div>}
        {credencial && (
          <div className="alert alert-success mt-3 mb-0">
            Cuenta creada. Entrega estas credenciales <strong>una sola vez</strong> (el usuario deberá cambiarla al ingresar):<br />
            <code>{credencial.email}</code> / <code>{credencial.password}</code>
            <button type="button" className="btn btn-sm btn-outline-light ms-2" onClick={() => navigator.clipboard.writeText(credencial.password)}>Copiar clave</button>
          </div>
        )}
        <button className="btn btn-dark mt-3 align-self-start px-4" disabled={guardando}>{guardando ? 'Creando...' : 'Crear cuenta'}</button>
      </form>

      <div className="card p-3">
        <h5 className="mb-3">Cuentas</h5>
        <div className="table-responsive">
          <table className="table table-hover align-middle">
            <thead><tr><th>Nombre</th><th>Rol</th><th>JJVV</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.id}>
                  <td>{u.nombre_completo}{u.requiere_cambio_clave && <span className="badge text-bg-warning ms-2">Clave temporal</span>}</td>
                  <td>{rolNombre(u.rol_id)}</td><td>{jjvvNombre(u.jjvv_id)}</td>
                  <td>{u.activo ? 'Activa' : 'Desactivada'}</td>
                  <td className="text-end"><button className="btn btn-sm btn-outline-light" onClick={() => alternarActivo(u)}>{u.activo ? 'Desactivar' : 'Activar'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
