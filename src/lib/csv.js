export function descargarCSV(nombre, filas) {
  if (!filas?.length) return;

  const sep = ';';
  const cabeceras = Object.keys(filas[0]);

  const escapar = (val) => {
    if (val === null || val === undefined) return '';
    const texto = typeof val === 'object' ? JSON.stringify(val) : String(val);
    if (texto.includes(sep) || texto.includes('"') || texto.includes('\n') || texto.includes('\r')) {
      return `"${texto.replace(/"/g, '""')}"`;
    }
    return texto;
  };

  const lineas = [
    cabeceras.join(sep),
    ...filas.map((fila) => cabeceras.map((k) => escapar(fila[k])).join(sep)),
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