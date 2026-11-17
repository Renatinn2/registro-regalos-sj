export function descargarCSV(nombre, filas) {
  if (!filas?.length) return;
  const cols = Object.keys(filas[0]);
  const esc = (v) => {
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(','), ...filas.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${nombre}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
