const COLUMNAS_TECNICAS = new Set([
  'id',
  'jjvv_id',
  'unidad_vecinal',
  'usuario_id',
  'tutor_id',
  'beneficiario_id',
  'registro_id',
  'updated_at',
]);

const ETIQUETAS = {
  nombre: 'Junta de Vecinos',
  jjvv_nombre: 'Junta de Vecinos',
  registrados: 'Registrados',
  entregados: 'Entregados',
  pendientes: 'Pendientes',
  observados: 'Observados',
  campana_anio: 'Año Campaña',
  rango_etario: 'Rango Etario',
  sexo: 'Sexo',
  tasa_retiro: 'Tasa de Retiro (%)',
  compra_sugerida: 'Compra Sugerida',
  proyeccion: 'Proyección',
  created_at: 'Fecha y Hora',
  fecha: 'Fecha',
  usuario_nombre: 'Usuario',
  usuario_email: 'Correo Operador',
  accion: 'Acción Realizada',
  tabla_afectada: 'Módulo',
  ip_origen: 'IP de Origen',
  motivo_duplicado: 'Justificación Social',
  estado: 'Estado',
};

function formatearEncabezado(clave) {
  if (ETIQUETAS[clave]) return ETIQUETAS[clave];
  const limpio = clave.replace(/_/g, ' ');
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

function formatearValor(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'boolean') return val ? 'Sí' : 'No';

  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(val)) {
    const fecha = new Date(val);
    if (!Number.isNaN(fecha.getTime())) {
      return fecha.toLocaleString('es-CL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
  }

  if (typeof val === 'object') {
    const entradas = Object.entries(val).filter(([, v]) => v !== null && v !== '');
    if (!entradas.length) return '';
    return entradas.map(([k, v]) => `${formatearEncabezado(k)}: ${v}`).join(' | ');
  }

  return String(val);
}

export function descargarCSV(nombre, filas) {
  if (!filas?.length) return;

  const sep = ';';

  // Filtra columnas técnicas y cualquier columna que venga 100% vacía en todas las filas
  const clavesValidas = Object.keys(filas[0]).filter((clave) => {
    if (COLUMNAS_TECNICAS.has(clave)) return false;
    return filas.some((fila) => fila[clave] !== null && fila[clave] !== undefined && fila[clave] !== '');
  });

  if (!clavesValidas.length) return;

  const escapar = (val) => {
    const texto = formatearValor(val);
    if (texto.includes(sep) || texto.includes('"') || texto.includes('\n') || texto.includes('\r')) {
      return `"${texto.replace(/"/g, '""')}"`;
    }
    return texto;
  };

  const cabeceras = clavesValidas.map(formatearEncabezado);
  const lineas = [
    cabeceras.join(sep),
    ...filas.map((fila) => clavesValidas.map((k) => escapar(fila[k])).join(sep)),
  ];

  const contenido = '\uFEFF' + lineas.join('\r\n');
  const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${nombre}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}