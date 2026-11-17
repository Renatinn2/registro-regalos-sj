import { useEffect, useRef, useState } from 'react';
import { Scanner } from '@yudiel/react-qr-scanner';
import { supabase } from '../supabase';
import { mensajeError } from '../lib/mensajes';
import { extraerRutDeCedula, validarRut, normalizarRut, variantesRut, formatearRut } from '../lib/rut';

const MIN_OBS = 15;
const MIN_TRAZOS_FIRMA = 6;

const RESTRICCIONES_BASE = {
  facingMode: 'environment',
  width: { ideal: 1920 },
  height: { ideal: 1080 },
};

// Lienzo de firma (CR-07). Devuelve un PNG en data URL solo si hubo trazos efectivos.
function FirmaPad({ onChange }) {
  const ref = useRef(null);
  const activo = useRef(false);
  const puntos = useRef(0);

  const limpiar = () => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    puntos.current = 0;
  };

  useEffect(limpiar, []);

  const pos = (e) => {
    const r = ref.current.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (ref.current.width / r.width),
      y: (e.clientY - r.top) * (ref.current.height / r.height),
    };
  };

  const ini = (e) => {
    ref.current.setPointerCapture(e.pointerId);
    activo.current = true;
    const p = pos(e);
    const ctx = ref.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };

  const mov = (e) => {
    if (!activo.current) return;
    const ctx = ref.current.getContext('2d');
    const p = pos(e);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#000';
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    puntos.current += 1;
  };

  const fin = () => {
    if (!activo.current) return;
    activo.current = false;
    if (puntos.current >= MIN_TRAZOS_FIRMA) {
      onChange(ref.current.toDataURL('image/png'));
    }
  };

  return (
    <div>
      <canvas
        ref={ref}
        width={450}
        height={160}
        onPointerDown={ini}
        onPointerMove={mov}
        onPointerUp={fin}
        onPointerLeave={fin}
        onPointerCancel={fin}
        style={{ width: '100%', background: '#fff', borderRadius: 8, touchAction: 'none' }}
      />
      <button
        type="button"
        className="btn btn-sm btn-outline-light mt-1"
        onClick={() => {
          limpiar();
          onChange(null);
        }}
      >
        Borrar firma
      </button>
    </div>
  );
}

function ListaNinos({ ninos, sel, onToggle }) {
  return (
    <ul className="list-group mb-3">
      {ninos.map((n) => {
        const habilitado = n.estado === 'registrado';
        return (
          <li key={n.id} className="list-group-item bg-transparent text-light d-flex align-items-center gap-2">
            <input
              type="checkbox"
              className="form-check-input mt-0"
              disabled={!habilitado}
              checked={sel.includes(n.id)}
              onChange={() => onToggle(n.id)}
            />
            <span className="flex-grow-1">
              {n.nombres} {n.apellidos}{' '}
              <span className="text-muted small">
                ({n.tipo_identificador} {n.identificador})
              </span>
            </span>
            {n.estado === 'entregado' && <span className="badge text-bg-secondary">Ya entregado</span>}
            {n.estado === 'observado_duplicado' && <span className="badge text-bg-warning">Observado</span>}
            {n.estado === 'rechazado' && <span className="badge text-bg-danger">Rechazado</span>}
          </li>
        );
      })}
    </ul>
  );
}

export default function EntregaRegalo() {
  const [vista, setVista] = useState('escaneo'); // escaneo | resultado | subsidiario
  const [rut, setRut] = useState('');
  const [tutor, setTutor] = useState(null);
  const [ninos, setNinos] = useState([]);
  const [sel, setSel] = useState([]);
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);

  // Selector de lentes de cámara
  const [camaras, setCamaras] = useState([]);
  const [camaraId, setCamaraId] = useState('');

  // Retiro subsidiario
  const [idNino, setIdNino] = useState('');
  const [obs, setObs] = useState('');
  const [firma, setFirma] = useState(null);

  // Bloqueo síncrono contra disparos múltiples de cámara
  const escaneandoRef = useRef(false);

  useEffect(() => {
    if (vista !== 'escaneo' || !navigator.mediaDevices?.enumerateDevices) return;
    const listar = async () => {
      const devs = await navigator.mediaDevices.enumerateDevices();
      const videos = devs.filter((d) => d.kind === 'videoinput');
      const traseras = videos.filter((d) => /back|rear|environment|trasera/i.test(d.label));
      setCamaras(traseras.length ? traseras : videos);
    };
    const t = setTimeout(listar, 1200);
    return () => clearTimeout(t);
  }, [vista]);

  const reiniciar = () => {
    escaneandoRef.current = false;
    setVista('escaneo');
    setRut('');
    setTutor(null);
    setNinos([]);
    setSel([]);
    setMsg(null);
    setIdNino('');
    setObs('');
    setFirma(null);
  };

  const cargarNinosDelTutor = async (tutorId) => {
    const { data, error } = await supabase
      .from('beneficiarios')
      .select('*')
      .eq('tutor_id', tutorId)
      .order('apellidos');
    if (error) return setMsg({ tipo: 'danger', texto: 'Error al buscar a los niños asociados.' });
    setNinos(data);
    setSel(data.filter((n) => n.estado === 'registrado').map((n) => n.id));
  };

  // CR-06: lectura de QR / PDF417 de la cédula
  const procesarEscaneo = async (texto) => {
    if (escaneandoRef.current || loading) return;
    const run = extraerRutDeCedula(texto);
    if (!run || !validarRut(run)) {
      return setMsg({
        tipo: 'warning',
        texto: `Código leído sin RUN válido (${String(texto).slice(0, 45)}...). Reintenta enfocando el QR.`,
      });
    }

    escaneandoRef.current = true;
    setLoading(true);
    setMsg(null);
    try {
      const { data } = await supabase.from('tutores').select('*').in('rut', variantesRut(run)).limit(1);
      if (!data?.length) {
        setMsg({ tipo: 'danger', texto: `El RUN ${formatearRut(run)} no figura como tutor en tu nómina.` });
        return;
      }
      setRut(run);
      setTutor(data[0]);
      setVista('resultado');
      await cargarNinosDelTutor(data[0].id);
    } finally {
      setLoading(false);
      escaneandoRef.current = false;
    }
  };

  const registrar = async (params) => {
    setLoading(true);
    setMsg(null);
    const { data, error } = await supabase.rpc('registrar_entrega', params);
    setLoading(false);
    if (error) {
      setMsg({ tipo: 'danger', texto: mensajeError(error, 'No pudimos registrar la entrega. Inténtalo nuevamente.') });
      return false;
    }
    setMsg({ tipo: 'success', texto: `Entrega registrada: ${data} regalo(s).` });
    return true;
  };

  const confirmarEntrega = async () => {
    const ok = await registrar({
      p_beneficiarios: sel,
      p_metodo: 'QR_ESCANER',
      p_tutor_rut: normalizarRut(rut),
      p_subsidiario: false,
      p_observacion: null,
      p_firma: null,
    });
    if (ok) await cargarNinosDelTutor(tutor.id);
  };

  // CR-07: retiro subsidiario (tutor sin RUN)
  const buscarNinoSubsidiario = async (e) => {
    e.preventDefault();
    setMsg(null);
    setNinos([]);
    setSel([]);

    const clave = idNino.trim();
    const ids = validarRut(clave) ? variantesRut(clave) : [clave.toUpperCase()];
    const { data } = await supabase.from('beneficiarios').select('*').in('identificador', ids).limit(1);

    if (!data?.length) {
      return setMsg({ tipo: 'danger', texto: 'No hay un niño/a con ese identificador en tu nómina.' });
    }
    const nino = data[0];
    if (nino.estado === 'entregado') {
      return setMsg({ tipo: 'danger', texto: 'Este regalo ya fue entregado.' });
    }
    if (nino.estado === 'observado_duplicado') {
      return setMsg({
        tipo: 'warning',
        texto: 'Este registro está observado por duplicidad. Debe ser aprobado por la Municipalidad antes de entregar.',
      });
    }
    if (nino.estado === 'rechazado') {
      return setMsg({
        tipo: 'danger',
        texto: 'Este registro fue rechazado por la Municipalidad y no está habilitado para entrega.',
      });
    }

    setNinos([nino]);
    setSel([nino.id]);
  };

  const confirmarSubsidiario = async () => {
    if (obs.trim().length < MIN_OBS) {
      return setMsg({ tipo: 'warning', texto: `Fundamenta la falta de cédula (mínimo ${MIN_OBS} caracteres).` });
    }
    if (!firma) {
      return setMsg({ tipo: 'warning', texto: 'Falta tu firma válida como responsable de la entrega.' });
    }
    const ok = await registrar({
      p_beneficiarios: sel,
      p_metodo: 'RETIRO_SUBSIDIARIO',
      p_tutor_rut: null,
      p_subsidiario: true,
      p_observacion: obs.trim(),
      p_firma: firma,
    });
    if (ok) {
      setNinos([]);
      setSel([]);
      setIdNino('');
      setObs('');
      setFirma(null);
    }
  };

  const alternar = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const constraintsCamara = camaraId
    ? { deviceId: { exact: camaraId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    : RESTRICCIONES_BASE;

  return (
    <div className="card p-4 mx-auto" style={{ maxWidth: 560 }}>
      <h4 className="mb-1">Entrega de regalos</h4>

      {msg && <div className={`alert alert-${msg.tipo} mt-2`}>{msg.texto}</div>}

      {vista === 'escaneo' && (
        <>
          <p className="text-muted small mb-2">
            Enfoca el código QR de la cédula del tutor (sin mica plástica y con buena luz).
          </p>

          {camaras.length > 1 && (
            <select
              className="form-select form-select-sm mb-2"
              value={camaraId}
              onChange={(e) => setCamaraId(e.target.value)}
            >
              <option value="">Lente automático (cambiar si se ve borroso)</option>
              {camaras.map((c, idx) => (
                <option key={c.deviceId} value={c.deviceId}>
                  {c.label || `Cámara ${idx + 1}`}
                </option>
              ))}
            </select>
          )}

          <div className="rounded overflow-hidden mb-3">
            <Scanner
              key={camaraId || 'auto'}
              formats={['qr_code', 'pdf417']}
              constraints={constraintsCamara}
              components={{ torch: true }}
              scanDelay={200}
              paused={loading}
              onScan={(codes) => {
                if (codes?.length) procesarEscaneo(codes[0].rawValue);
              }}
              onError={(err) => {
                console.error('[cámara]', err);
                setMsg({
                  tipo: 'danger',
                  texto: 'No pudimos acceder a la cámara. Permite el acceso en el navegador y usa una conexión segura (https).',
                });
              }}
            />
          </div>
          <button
            className="btn btn-outline-light"
            onClick={() => {
              reiniciar();
              setVista('subsidiario');
            }}
          >
            El tutor no tiene cédula (retiro subsidiario)
          </button>
        </>
      )}

      {vista === 'resultado' && tutor && (
        <>
          <p className="mb-2">
            Tutor: <strong>{tutor.nombre_completo}</strong> <span className="text-muted">({formatearRut(rut)})</span>
          </p>
          {ninos.length ? (
            <ListaNinos ninos={ninos} sel={sel} onToggle={alternar} />
          ) : (
            <div className="alert alert-warning">Este tutor no tiene niños registrados.</div>
          )}
          <button className="btn btn-dark py-2 mb-2 w-100" disabled={loading || !sel.length} onClick={confirmarEntrega}>
            {loading ? 'Registrando...' : `Confirmar entrega (${sel.length})`}
          </button>
          <button className="btn btn-outline-light w-100" onClick={reiniciar}>
            Escanear otra cédula
          </button>
        </>
      )}

      {vista === 'subsidiario' && (
        <>
          <p className="text-muted small">
            Asumes la responsabilidad de la entrega. Queda registrada con tu usuario, observación y firma.
          </p>
          <form onSubmit={buscarNinoSubsidiario} className="d-flex gap-2 mb-3">
            <input
              className="form-control"
              placeholder="RUT o IPE del niño/a"
              value={idNino}
              onChange={(e) => setIdNino(e.target.value)}
              required
            />
            <button className="btn btn-outline-light">Buscar</button>
          </form>
          {ninos.length > 0 && (
            <>
              <ListaNinos ninos={ninos} sel={sel} onToggle={alternar} />
              <textarea
                className="form-control mb-3"
                rows={3}
                placeholder="Observación: ¿por qué el tutor no presenta cédula?"
                value={obs}
                onChange={(e) => setObs(e.target.value)}
              />
              <p className="small text-muted mb-1">Firma del representante de la JJVV</p>
              <FirmaPad onChange={setFirma} />
              <button className="btn btn-dark py-2 w-100 mt-3" disabled={loading} onClick={confirmarSubsidiario}>
                {loading ? 'Registrando...' : 'Confirmar retiro subsidiario'}
              </button>
            </>
          )}
          <button className="btn btn-outline-light w-100 mt-2" onClick={reiniciar}>
            Volver al escáner
          </button>
        </>
      )}
    </div>
  );
}