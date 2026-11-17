// CR-04: identificación flexible (RUT con Módulo 11 | IPE alfanumérico)
export const limpiarRut = (s) => String(s ?? '').replace(/[^0-9kK]/g, '').toUpperCase();

export function dvRut(cuerpo) {
  let suma = 0, mul = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const r = 11 - (suma % 11);
  return r === 11 ? '0' : r === 10 ? 'K' : String(r);
}

export function validarRut(s) {
  const c = limpiarRut(s);
  if (c.length < 2 || c.length > 9) return false;
  const cuerpo = c.slice(0, -1);
  return /^\d+$/.test(cuerpo) && dvRut(cuerpo) === c.slice(-1);
}

// Formato canónico de almacenamiento: 12345678-K (sin puntos)
export function normalizarRut(s) {
  const c = limpiarRut(s);
  return c.length > 1 ? `${c.slice(0, -1)}-${c.slice(-1)}` : c;
}

export const formatearRut = (s) => {
  const c = limpiarRut(s);
  if (c.length < 2) return c;
  return `${c.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${c.slice(-1)}`;
};

// La BD podría tener RUTs guardados con otro formato: se busca en todas las variantes.
export const variantesRut = (s) => {
  const c = limpiarRut(s);
  return [...new Set([c, normalizarRut(c), formatearRut(c)])];
};

// IPE (Mineduc): alfanumérico. Se valida solo forma, no existe dígito verificador público.
export const validarIPE = (s) => /^[A-Za-z0-9]{5,20}$/.test(String(s ?? '').trim());

// CR-06: extrae el RUN desde el QR (URL del Registro Civil con ?RUN=...) o desde el PDF417 (carnet antiguo).
// El código anterior borraba todo lo que no fuera dígito/K, lo que mezclaba serie y otros datos con el RUN.
export function extraerRutDeCedula(texto) {
  const t = String(texto ?? '');
  const m =
    t.match(/RUN=([0-9.]+-?[0-9kK])/i) ||
    t.match(/\b(\d{1,2}\.?\d{3}\.?\d{3}-[\dkK])\b/);
  return m ? limpiarRut(m[1]) : null;
}
