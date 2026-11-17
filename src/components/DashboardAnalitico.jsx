import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { supabase } from '../supabase';
import { descargarCSV } from '../lib/csv';
import { mensajeError } from '../lib/mensajes';

const META = 13500; // volumen operativo estimado (documento de requerimientos)
const num = (x) => (x ?? 0).toLocaleString('es-CL');
const pct = (a, b) => (b ? Math.round((a * 1000) / b) / 10 : 0);
const fecha = (s) => new Date(s).toLocaleString('es-CL');

const COLORES_TORTA = ['#198754', '#6B2B85', '#ffc107', '#495057'];
const ESTILO_TOOLTIP = {
  backgroundColor: '#1a1a2e',
  borderColor: 'rgba(255,255,255,0.2)',
  color: '#f8f9fa',
  borderRadius: 8,
};

function Barra({ valor, total, color = 'bg-success' }) {
  return (
    <div className="progress" style={{ height: 10, background: 'rgba(255,255,255,.12)' }}>
      <div className={`progress-bar ${color}`} style={{ width: `${Math.min(pct(valor, total), 100)}%` }} />
    </div>
  );
}

export default function DashboardAnalitico() {
  const [avance, setAvance] = useState([]);
  const [proy, setProy] = useState([]);
  const [dups, setDups] = useState([]);
  const [aud, setAud] = useState([]);
  const [tab, setTab] = useState('resumen');
  const [margen, setMargen] = useState(10);
  const [ultima, setUltima] = useState(null);
  const [error, setError] = useState(null);

  // Filtros y acciones de resolución
  const [busquedaDup, setBusquedaDup] = useState('');
  const [busquedaAud, setBusquedaAud] = useState('');
  const [resolviendoId, setResolviendoId] = useState(null);
  const [avisoDup, setAvisoDup] = useState(null);
  const [anioFiltro, setAnioFiltro] = useState('TODOS');
  const [jjvvFiltro, setJjvvFiltro] = useState('TODAS');

  const cargar = useCallback(async () => {
    const [a, p, d, au, pf] = await Promise.all([
      supabase.from('v_avance_jjvv').select('*').order('nombre'),
      supabase.from('v_proyeccion').select('*'),
      supabase
        .from('beneficiarios')
        .select('id,identificador,tipo_identificador,nombres,apellidos,estado,jjvv_id,justificacion_duplicidad,creado_el')
        .eq('es_duplicado', true)
        .order('creado_el', { ascending: false })
        .limit(500),
      supabase.from('auditoria').select('*').order('creado_el', { ascending: false }).limit(200),
      supabase.from('perfiles').select('id,nombre_completo'),
    ]);
    const fallo = [a, p, d, au, pf].find((r) => r.error);
    if (fallo) return setError(fallo.error.message);
    const nombres = Object.fromEntries(pf.data.map((x) => [x.id, x.nombre_completo]));
    setError(null);
    setAvance(a.data);
    setProy(p.data);
    setDups(d.data);
    setAud(au.data.map((x) => ({ ...x, usuario: nombres[x.usuario_id] ?? x.usuario_id })));
    setUltima(new Date());
  }, []);

  // Monitor "en vivo": refresco cada 15 s
  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 15000);
    return () => clearInterval(t);
  }, [cargar]);

  const k = useMemo(() => {
    const s = (c) => avance.reduce((acc, r) => acc + (r[c] ?? 0), 0);
    const registrados = s('registrados');
    return {
      registrados,
      entregados: s('entregados'),
      pendientes: s('pendientes'),
      observados: s('observados'),
      faltantes: Math.max(META - registrados, 0),
    };
  }, [avance]);

  const jjvvNombre = useMemo(() => Object.fromEntries(avance.map((r) => [r.jjvv_id, r.nombre])), [avance]);

  // Datos para gráficos (CR-08)
  const datosBarras = useMemo(
    () =>
      avance
        .filter((r) => r.registrados > 0)
        .slice(0, 12)
        .map((r) => ({
          nombre: r.nombre.length > 18 ? `${r.nombre.slice(0, 18)}…` : r.nombre,
          Entregados: r.entregados,
          Pendientes: Math.max((r.pendientes ?? 0) - (r.observados ?? 0), 0),
          Observados: r.observados,
        })),
    [avance]
  );

  const datosTorta = useMemo(
    () => [
      { name: 'Entregados', value: k.entregados },
      { name: 'Pendientes habilitados', value: Math.max(k.pendientes - k.observados, 0) },
      { name: 'Observados (duplicidad)', value: k.observados },
      { name: 'Cupo meta disponible', value: k.faltantes },
    ],
    [k]
  );

  // Resolución municipal de duplicados (CR-05)
  const resolverCaso = async (dup, aprobar) => {
    setResolviendoId(dup.id);
    setAvisoDup(null);
    const { error: errRpc } = await supabase.rpc('resolver_duplicado', {
      p_beneficiario_id: dup.id,
      p_aprobar: aprobar,
    });
    setResolviendoId(null);
    if (errRpc) {
      setAvisoDup({ tipo: 'danger', texto: mensajeError(errRpc, 'No se pudo actualizar el estado del registro.') });
      return;
    }
    setAvisoDup({
      tipo: 'success',
      texto: aprobar
        ? `Registro de ${dup.nombres} ${dup.apellidos} aprobado y habilitado para entrega.`
        : `Registro de ${dup.nombres} ${dup.apellidos} rechazado.`,
    });
    await cargar();
  };

  const dupsFiltrados = useMemo(() => {
    const q = busquedaDup.trim().toLowerCase();
    if (!q) return dups;
    return dups.filter((d) =>
      `${d.nombres} ${d.apellidos} ${d.identificador} ${jjvvNombre[d.jjvv_id] ?? ''} ${d.estado}`
        .toLowerCase()
        .includes(q)
    );
  }, [dups, busquedaDup, jjvvNombre]);

  const audFiltrados = useMemo(() => {
    const q = busquedaAud.trim().toLowerCase();
    if (!q) return aud;
    return aud.filter((a) =>
      `${a.usuario} ${a.modulo} ${a.accion} ${JSON.stringify(a.detalle ?? {})}`.toLowerCase().includes(q)
    );
  }, [aud, busquedaAud]);

  // Años disponibles para cruce histórico (CR-09)
  const aniosDisponibles = useMemo(() => {
    const set = new Set(proy.map((r) => r.campana_anio).filter(Boolean));
    return Array.from(set).sort((a, b) => b - a);
  }, [proy]);

  // CR-09: tasas de retiro por territorio, año, edad y sexo con margen de seguridad
  const grupos = useMemo(() => {
    const m = {};
    proy
      .filter((r) => (anioFiltro === 'TODOS' || String(r.campana_anio) === anioFiltro))
      .filter((r) => (jjvvFiltro === 'TODAS' || String(r.jjvv_id) === jjvvFiltro))
      .forEach((r) => {
        const key = `${r.rango_etario}|${r.sexo}`;
        m[key] ??= { rango: r.rango_etario, sexo: r.sexo, registrados: 0, entregados: 0 };
        m[key].registrados += r.registrados;
        m[key].entregados += r.entregados;
      });
    return Object.values(m)
      .sort((a, b) => a.rango.localeCompare(b.rango) || String(a.sexo).localeCompare(String(b.sexo)))
      .map((g) => ({
        ...g,
        tasa: pct(g.entregados, g.registrados),
        sugeridas: Math.ceil(g.registrados * (g.entregados / (g.registrados || 1)) * (1 + margen / 100)),
      }));
  }, [proy, anioFiltro, jjvvFiltro, margen]);

  const totalSugerido = grupos.reduce((a, g) => a + g.sugeridas, 0);
  const pendientesRevision = dups.filter((d) => d.estado === 'observado_duplicado').length;

  const KPI = ({ t, v, sub }) => (
    <div className="col-6 col-lg-2">
      <div className="card p-3 h-100">
        <div className="text-muted small">{t}</div>
        <div className="fs-3 fw-semibold">{num(v)}</div>
        {sub && <div className="small text-muted">{sub}</div>}
      </div>
    </div>
  );

  const pestanas = [
    ['resumen', 'Avance y Gráficos'],
    ['duplicidad', `Duplicidades (${pendientesRevision} pend. / ${dups.length})`],
    ['auditoria', 'Auditoría'],
    ['proyeccion', 'Proyección de compras'],
  ];

  return (
    <>
      <div className="d-flex flex-wrap align-items-end justify-content-between mb-3">
        <div>
          <h3 className="mb-0">Panel municipal</h3>
          <span className="text-muted small">
            Meta de campaña: {num(META)} juguetes · actualizado {ultima ? ultima.toLocaleTimeString('es-CL') : '…'}
          </span>
        </div>
      </div>
      {error && (
        <div className="alert alert-danger">
          No se pudo cargar: {error}. Revisa que las migraciones SQL estén ejecutadas en Supabase.
        </div>
      )}

      <div className="row g-3 mb-3">
        <KPI t="Registrados" v={k.registrados} sub={`${pct(k.registrados, META)}% de la meta`} />
        <KPI t="Entregados" v={k.entregados} sub={`${pct(k.entregados, k.registrados)}% de los registrados`} />
        <KPI t="Pendientes de retiro" v={k.pendientes} />
        <KPI t="Faltan por inscribir" v={k.faltantes} sub="Meta − registrados" />
        <KPI t="Observados" v={k.observados} sub="Duplicidad por revisar" />
      </div>
      <Barra valor={k.entregados} total={META} />
      <div className="small text-muted mt-1 mb-4">Entregados sobre la meta total: {pct(k.entregados, META)}%</div>

      <ul className="nav nav-pills mb-3 gap-1">
        {pestanas.map(([id, t]) => (
          <li className="nav-item" key={id}>
            <button className={`nav-link ${tab === id ? 'active' : 'text-light'}`} onClick={() => setTab(id)}>
              {t}
            </button>
          </li>
        ))}
      </ul>

      {tab === 'resumen' && (
        <>
          <div className="row g-3 mb-3">
            <div className="col-lg-7">
              <div className="card p-3 h-100">
                <h6 className="mb-3">Distribución de entregas por Junta de Vecinos</h6>
                {datosBarras.length > 0 ? (
                  <div style={{ width: '100%', height: 270 }}>
                    <ResponsiveContainer>
                      <BarChart data={datosBarras} margin={{ top: 5, right: 15, left: -15, bottom: 35 }}>
                        <XAxis dataKey="nombre" stroke="#adb5bd" fontSize={11} angle={-25} textAnchor="end" interval={0} />
                        <YAxis stroke="#adb5bd" fontSize={11} allowDecimals={false} />
                        <Tooltip contentStyle={ESTILO_TOOLTIP} />
                        <Legend verticalAlign="top" height={30} />
                        <Bar dataKey="Entregados" stackId="a" fill="#198754" />
                        <Bar dataKey="Pendientes" stackId="a" fill="#6B2B85" />
                        <Bar dataKey="Observados" stackId="a" fill="#ffc107" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-muted small my-auto text-center py-5">Aún no hay beneficiarios registrados.</p>
                )}
              </div>
            </div>

            <div className="col-lg-5">
              <div className="card p-3 h-100">
                <h6 className="mb-3">Estado global respecto a meta ({num(META)})</h6>
                <div style={{ width: '100%', height: 270 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={datosTorta}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={85}
                        paddingAngle={2}
                      >
                        {datosTorta.map((_, idx) => (
                          <Cell key={idx} fill={COLORES_TORTA[idx % COLORES_TORTA.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={ESTILO_TOOLTIP} formatter={(v) => num(v)} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>

          <div className="card p-3">
            <div className="d-flex justify-content-between mb-2">
              <h5>Avance por Junta de Vecinos</h5>
              <button className="btn btn-sm btn-outline-light" onClick={() => descargarCSV('avance_por_jjvv', avance)}>
                Exportar CSV
              </button>
            </div>
            <div className="table-responsive">
              <table className="table table-hover align-middle">
                <thead>
                  <tr>
                    <th>JJVV</th>
                    <th>Registrados</th>
                    <th>Entregados</th>
                    <th>Pendientes</th>
                    <th>Observados</th>
                    <th style={{ minWidth: 140 }}>Avance</th>
                  </tr>
                </thead>
                <tbody>
                  {avance.map((r) => (
                    <tr key={r.jjvv_id}>
                      <td>
                        {r.nombre}
                        <div className="small text-muted">{r.unidad_vecinal}</div>
                      </td>
                      <td>{r.registrados}</td>
                      <td>{r.entregados}</td>
                      <td>{r.pendientes}</td>
                      <td>{r.observados}</td>
                      <td>
                        <Barra valor={r.entregados} total={r.registrados} />
                        <span className="small text-muted">{pct(r.entregados, r.registrados)}%</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'duplicidad' && (
        <div className="card p-3">
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
            <h5 className="mb-0">Registros observados por duplicidad</h5>
            <div className="d-flex gap-2">
              <input
                className="form-control form-control-sm"
                placeholder="Buscar RUT, nombre o JJVV..."
                value={busquedaDup}
                onChange={(e) => setBusquedaDup(e.target.value)}
              />
              <button
                className="btn btn-sm btn-outline-light text-nowrap"
                onClick={() =>
                  descargarCSV(
                    'duplicidades',
                    dupsFiltrados.map((d) => ({ ...d, jjvv: jjvvNombre[d.jjvv_id] }))
                  )
                }
              >
                Exportar CSV
              </button>
            </div>
          </div>

          {avisoDup && <div className={`alert alert-${avisoDup.tipo} py-2 small`}>{avisoDup.texto}</div>}

          <div className="table-responsive">
            <table className="table table-hover align-middle">
              <thead>
                <tr>
                  <th>Niño/a</th>
                  <th>Identificador</th>
                  <th>JJVV</th>
                  <th>Estado</th>
                  <th>Justificación</th>
                  <th>Fecha</th>
                  <th className="text-end">Resolución</th>
                </tr>
              </thead>
              <tbody>
                {dupsFiltrados.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {d.nombres} {d.apellidos}
                    </td>
                    <td>
                      {d.tipo_identificador} {d.identificador}
                    </td>
                    <td>{jjvvNombre[d.jjvv_id] ?? '—'}</td>
                    <td>
                      {d.estado === 'observado_duplicado' && <span className="badge text-bg-warning">Pendiente revisión</span>}
                      {d.estado === 'registrado' && <span className="badge text-bg-success">Aprobado</span>}
                      {d.estado === 'entregado' && <span className="badge text-bg-secondary">Entregado</span>}
                      {d.estado === 'rechazado' && <span className="badge text-bg-danger">Rechazado</span>}
                    </td>
                    <td style={{ maxWidth: 280 }}>{d.justificacion_duplicidad}</td>
                    <td>{fecha(d.creado_el)}</td>
                    <td className="text-end text-nowrap">
                      {d.estado === 'observado_duplicado' ? (
                        <div className="d-inline-flex gap-1">
                          <button
                            className="btn btn-sm btn-success"
                            disabled={resolviendoId === d.id}
                            onClick={() => resolverCaso(d, true)}
                          >
                            Aprobar
                          </button>
                          <button
                            className="btn btn-sm btn-outline-danger"
                            disabled={resolviendoId === d.id}
                            onClick={() => resolverCaso(d, false)}
                          >
                            Rechazar
                          </button>
                        </div>
                      ) : (
                        <span className="small text-muted">Resuelto</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'auditoria' && (
        <div className="card p-3">
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
            <h5 className="mb-0">Bitácora inmutable (últimos 200 eventos)</h5>
            <div className="d-flex gap-2">
              <input
                className="form-control form-control-sm"
                placeholder="Filtrar usuario, módulo o acción..."
                value={busquedaAud}
                onChange={(e) => setBusquedaAud(e.target.value)}
              />
              <button
                className="btn btn-sm btn-outline-light text-nowrap"
                onClick={() => descargarCSV('auditoria', audFiltrados)}
              >
                Exportar CSV
              </button>
            </div>
          </div>
          <div className="table-responsive">
            <table className="table table-hover align-middle small">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Usuario</th>
                  <th>Módulo</th>
                  <th>Acción</th>
                  <th>Detalle</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {audFiltrados.map((a) => (
                  <tr key={a.id}>
                    <td>{fecha(a.creado_el)}</td>
                    <td>{a.usuario}</td>
                    <td>{a.modulo}</td>
                    <td>{a.accion}</td>
                    <td style={{ maxWidth: 360, wordBreak: 'break-word' }}>{JSON.stringify(a.detalle)}</td>
                    <td>{a.ip_origen}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'proyeccion' && (
        <div className="card p-3">
          <div className="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
            <h5 className="mb-0">Tasa de retiro por territorio, edad y sexo</h5>
            <div className="d-flex flex-wrap align-items-center gap-2">
              <select
                className="form-select form-select-sm"
                style={{ width: 140 }}
                value={anioFiltro}
                onChange={(e) => setAnioFiltro(e.target.value)}
              >
                <option value="TODOS">Todos los años</option>
                {aniosDisponibles.map((anio) => (
                  <option key={anio} value={String(anio)}>
                    Campaña {anio}
                  </option>
                ))}
              </select>

              <select
                className="form-select form-select-sm"
                style={{ width: 190 }}
                value={jjvvFiltro}
                onChange={(e) => setJjvvFiltro(e.target.value)}
              >
                <option value="TODAS">Todas las JJVV</option>
                {avance.map((j) => (
                  <option key={j.jjvv_id} value={String(j.jjvv_id)}>
                    {j.nombre}
                  </option>
                ))}
              </select>

              <label className="small text-muted">Margen %</label>
              <input
                type="number"
                min={0}
                max={100}
                className="form-control form-control-sm"
                style={{ width: 75 }}
                value={margen}
                onChange={(e) => setMargen(Number(e.target.value) || 0)}
              />
              <button
                className="btn btn-sm btn-outline-light"
                onClick={() => descargarCSV('proyeccion_compras', grupos)}
              >
                Exportar CSV
              </button>
            </div>
          </div>
          <div className="table-responsive">
            <table className="table table-hover align-middle">
              <thead>
                <tr>
                  <th>Rango etario</th>
                  <th>Sexo</th>
                  <th>Registrados</th>
                  <th>Entregados</th>
                  <th>Tasa de retiro</th>
                  <th>Unidades sugeridas</th>
                </tr>
              </thead>
              <tbody>
                {grupos.map((g) => (
                  <tr key={`${g.rango}${g.sexo}`}>
                    <td>{g.rango} años</td>
                    <td>{g.sexo}</td>
                    <td>{g.registrados}</td>
                    <td>{g.entregados}</td>
                    <td>{g.tasa}%</td>
                    <td>{g.sugeridas}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} className="text-end fw-semibold">
                    Total sugerido para licitación
                  </td>
                  <td className="fw-semibold">{num(totalSugerido)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="small text-muted mb-0">
            Unidades sugeridas = registrados × tasa de retiro × (1 + margen). Permite cruzar métricas históricas por año de
            campaña y Junta de Vecinos.
          </p>
        </div>
      )}
    </>
  );
}