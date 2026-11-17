import { useState } from 'react';
import { supabase } from '../supabase';
import { mensajeError } from '../lib/mensajes';
import { validarRut, validarIPE, normalizarRut, variantesRut } from '../lib/rut';
import { registrarAuditoria } from '../lib/auditoria';

const MIN_JUSTIFICACION = 15;
const FECHA_MINIMA_NAC = '2008-01-01'; // menores de 18 años en campaña 2026
const tutorVacio = { tutorSinRun: false, tutorRut: '', tutorNombre: '', tutorTelefono: '', tutorDireccion: '' };
const ninoVacio = { tipoId: 'RUT', identificador: '', nombres: '', apellidos: '', fechaNacimiento: '', sexo: '' };

export default function RegistroBeneficiario({ perfil }) {
  const [f, setF] = useState({ ...tutorVacio, ...ninoVacio });
  const [duplicados, setDuplicados] = useState(null); // null = aún no verificado
  const [justificacion, setJustificacion] = useState('');
  const [msg, setMsg] = useState(null); // { tipo: 'success' | 'danger' | 'warning', texto }
  const [guardando, setGuardando] = useState(false);

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setF((prev) => ({ ...prev, [k]: v }));
    if (k === 'identificador' || k === 'tipoId') {
      setDuplicados(null);
      setJustificacion('');
    }
  };

  const idNormalizado = f.tipoId === 'RUT' ? normalizarRut(f.identificador) : f.identificador.trim().toUpperCase();

  const guardar = async (e) => {
    e.preventDefault();
    setMsg(null);

    if (!perfil?.jjvv_id) {
      return setMsg({ tipo: 'danger', texto: 'Tu cuenta no tiene una Junta de Vecinos asignada.' });
    }

    // CR-04: validación polimórfica
    if (f.tipoId === 'RUT' && !validarRut(f.identificador)) {
      return setMsg({ tipo: 'danger', texto: 'El RUT del menor no es válido (dígito verificador).' });
    }
    if (f.tipoId === 'IPE' && !validarIPE(f.identificador)) {
      return setMsg({ tipo: 'danger', texto: 'El IPE debe ser alfanumérico (5 a 20 caracteres).' });
    }
    if (!f.tutorSinRun && !validarRut(f.tutorRut)) {
      return setMsg({ tipo: 'danger', texto: 'El RUT del tutor no es válido.' });
    }
    if (new Date(f.fechaNacimiento) > new Date()) {
      return setMsg({ tipo: 'danger', texto: 'La fecha de nacimiento no puede ser futura.' });
    }
    if (f.fechaNacimiento < FECHA_MINIMA_NAC) {
      return setMsg({ tipo: 'danger', texto: 'La fecha de nacimiento corresponde a una persona mayor de 18 años.' });
    }

    setGuardando(true);

    // CR-05: detección de duplicidad en TODAS las nóminas (RPC con SECURITY DEFINER)
    let dups = duplicados;
    if (dups === null) {
      const { data, error } = await supabase.rpc('buscar_duplicado', { p_identificador: idNormalizado });
      if (error) {
        setGuardando(false);
        return setMsg({
          tipo: 'danger',
          texto: mensajeError(error, 'No pudimos verificar si el niño o niña ya está registrado. Inténtalo nuevamente.'),
        });
      }
      dups = data ?? [];
      setDuplicados(dups);
    }

    const esDup = dups.length > 0;
    if (esDup && justificacion.trim().length < MIN_JUSTIFICACION) {
      setGuardando(false);
      return setMsg({
        tipo: 'warning',
        texto: `Este identificador ya está en otra nómina. Para continuar escribe una justificación (mínimo ${MIN_JUSTIFICACION} caracteres).`,
      });
    }

    // Tutor: se reutiliza si ya existe (hermanos), si no se crea. Sin RUN => rut null (CR-07)
    let tutorId = null;
    if (!f.tutorSinRun) {
      const { data } = await supabase.from('tutores').select('id').in('rut', variantesRut(f.tutorRut)).limit(1);
      tutorId = data?.[0]?.id ?? null;
    }
    if (!tutorId) {
      if (!f.tutorNombre.trim()) {
        setGuardando(false);
        return setMsg({ tipo: 'danger', texto: 'Ingresa el nombre completo del tutor.' });
      }
      const { data, error } = await supabase
        .from('tutores')
        .insert([
          {
            rut: f.tutorSinRun ? null : normalizarRut(f.tutorRut),
            nombre_completo: f.tutorNombre.trim(),
            telefono: f.tutorTelefono.trim() || null,
            direccion: f.tutorDireccion.trim() || null,
            jjvv_id: perfil.jjvv_id,
          },
        ])
        .select('id')
        .single();
      if (error) {
        setGuardando(false);
        return setMsg({
          tipo: 'danger',
          texto: mensajeError(error, 'No pudimos guardar los datos del tutor. Revisa que el RUT y el nombre estén correctos.'),
        });
      }
      tutorId = data.id;
    }

    const { data: nino, error } = await supabase
      .from('beneficiarios')
      .insert([
        {
          identificador: idNormalizado,
          tipo_identificador: f.tipoId,
          nombres: f.nombres.trim(),
          apellidos: f.apellidos.trim(),
          fecha_nacimiento: f.fechaNacimiento,
          sexo: f.sexo,
          tutor_id: tutorId,
          jjvv_id: perfil.jjvv_id,
          estado: esDup ? 'observado_duplicado' : 'registrado',
          es_duplicado: esDup,
          justificacion_duplicidad: esDup ? justificacion.trim() : null,
          creado_por: perfil.id,
        },
      ])
      .select('id')
      .single();

    if (error) {
      // Manejo de colisión concurrente: otro operador inscribió al mismo menor segundos antes
      if (error.code === '23505') {
        const { data: dupsRecientes } = await supabase.rpc('buscar_duplicado', { p_identificador: idNormalizado });
        setDuplicados(dupsRecientes ?? [{ jjvv_nombre: 'otra nómina', estado: 'registrado' }]);
        setGuardando(false);
        return setMsg({
          tipo: 'warning',
          texto: `Este identificador acaba de ser registrado en otra nómina. Ingresa una justificación (mínimo ${MIN_JUSTIFICACION} caracteres) para guardarlo como observado.`,
        });
      }
      setGuardando(false);
      return setMsg({
        tipo: 'danger',
        texto: mensajeError(error, 'No pudimos registrar al niño o niña. Revisa los datos e inténtalo nuevamente.'),
      });
    }

    await registrarAuditoria(perfil.id, 'REGISTRO', esDup ? 'DUPLICIDAD_JUSTIFICADA' : 'BENEFICIARIO_CREADO', {
      beneficiario_id: nino.id,
      identificador: idNormalizado,
      tipo_identificador: f.tipoId,
      ...(esDup && { justificacion: justificacion.trim(), existente_en: dups }),
    });

    setMsg({
      tipo: 'success',
      texto: esDup
        ? 'Registrado con observación por duplicidad. Quedó marcado para revisión municipal.'
        : 'Niño/a registrado correctamente.',
    });
    setF((prev) => ({ ...prev, ...ninoVacio })); // se conserva el tutor para registrar hermanos
    setDuplicados(null);
    setJustificacion('');
    setGuardando(false);
  };

  return (
    <form onSubmit={guardar} className="card p-4">
      <h4 className="mb-3">Registrar niño/a</h4>

      {!perfil?.jjvv_id && (
        <div className="alert alert-warning">
          Tu cuenta no tiene una Junta de Vecinos asignada. Contacta al supervisor municipal antes de registrar.
        </div>
      )}

      <h6 className="text-muted">Tutor responsable</h6>
      <div className="form-check mb-2">
        <input id="sinrun" type="checkbox" className="form-check-input" checked={f.tutorSinRun} onChange={set('tutorSinRun')} />
        <label htmlFor="sinrun" className="form-check-label">
          El tutor no tiene RUN (cédula chilena)
        </label>
      </div>
      <div className="row g-2 mb-4">
        {!f.tutorSinRun && (
          <div className="col-md-4">
            <input className="form-control" placeholder="RUT del tutor" value={f.tutorRut} onChange={set('tutorRut')} required />
          </div>
        )}
        <div className="col-md-8">
          <input className="form-control" placeholder="Nombre completo del tutor" value={f.tutorNombre} onChange={set('tutorNombre')} required />
        </div>
        <div className="col-md-4">
          <input className="form-control" placeholder="Teléfono" value={f.tutorTelefono} onChange={set('tutorTelefono')} />
        </div>
        <div className="col-md-8">
          <input className="form-control" placeholder="Dirección" value={f.tutorDireccion} onChange={set('tutorDireccion')} />
        </div>
      </div>

      <h6 className="text-muted">Niño/a</h6>
      <div className="row g-2 mb-3">
        <div className="col-md-3">
          <select className="form-select" value={f.tipoId} onChange={set('tipoId')}>
            <option value="RUT">RUT</option>
            <option value="IPE">IPE (Identificador Provisorio Escolar)</option>
          </select>
        </div>
        <div className="col-md-9">
          <input
            className="form-control"
            placeholder={f.tipoId === 'RUT' ? 'RUT (ej. 12345678-9)' : 'Código IPE'}
            value={f.identificador}
            onChange={set('identificador')}
            required
          />
        </div>
        <div className="col-md-6">
          <input className="form-control" placeholder="Nombres" value={f.nombres} onChange={set('nombres')} required />
        </div>
        <div className="col-md-6">
          <input className="form-control" placeholder="Apellidos" value={f.apellidos} onChange={set('apellidos')} required />
        </div>
        <div className="col-md-6">
          <input
            className="form-control"
            type="date"
            min={FECHA_MINIMA_NAC}
            max={new Date().toISOString().split('T')[0]}
            value={f.fechaNacimiento}
            onChange={set('fechaNacimiento')}
            required
          />
        </div>
        <div className="col-md-6">
          <select className="form-select" value={f.sexo} onChange={set('sexo')} required>
            <option value="">Sexo</option>
            <option value="F">Femenino</option>
            <option value="M">Masculino</option>
            <option value="OTRO">Otro</option>
          </select>
        </div>
      </div>

      {duplicados?.length > 0 && (
        <div className="alert alert-warning">
          <strong>Posible duplicado.</strong> Este identificador ya figura en:{' '}
          {duplicados
            .map(
              (d) =>
                `${d.jjvv_nombre ?? 'otra nómina'} (${
                  {
                    registrado: 'registrado',
                    observado_duplicado: 'observado',
                    entregado: 'regalo ya entregado',
                    rechazado: 'rechazado',
                  }[d.estado] ?? d.estado
                })`
            )
            .join(', ')}
          . Para registrarlo igualmente debes justificar el motivo (vulnerabilidad social, pertenencia a dos territorios, etc.).
          <textarea
            className="form-control mt-2"
            rows={3}
            placeholder="Justificación obligatoria"
            value={justificacion}
            onChange={(e) => setJustificacion(e.target.value)}
          />
          <div className="small mt-1">
            {justificacion.trim().length}/{MIN_JUSTIFICACION} caracteres mínimos
          </div>
        </div>
      )}

      {msg && <div className={`alert alert-${msg.tipo}`}>{msg.texto}</div>}
      <button className="btn btn-dark py-2" disabled={guardando || !perfil?.jjvv_id}>
        {guardando ? 'Guardando...' : duplicados?.length ? 'Registrar con justificación' : 'Registrar'}
      </button>
    </form>
  );
}