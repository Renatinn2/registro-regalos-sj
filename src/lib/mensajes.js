// Traduce errores técnicos (Postgres, Supabase, red) a frases que entienda un vecino.
// El detalle técnico se deja en la consola del navegador para depurar.
const REGLAS = [
  [/chk_justificacion_duplicidad/i, 'Para registrar un duplicado debes escribir una justificación de al menos 15 caracteres.'],
  [/chk_subsidiario/i, 'El retiro sin cédula requiere una observación de al menos 15 caracteres y tu firma.'],
  [/beneficiarios_(estado|sexo|tipo_identificador)_check|entregas_metodo_validacion_check/i, 'Hay un dato con un valor no permitido. Revisa el formulario e inténtalo de nuevo.'],
  [/beneficiarios_identificador_original_uk/i, 'Este niño o niña ya está registrado en la nómina.'],
  [/entregas_beneficiario_uk|ya fue entregado/i, 'El regalo de este niño o niña ya fue entregado.'],
  [/duplicate key.*tutores|tutores_rut/i, 'Ya existe un tutor con ese RUT en el sistema.'],
  [/already been registered|already registered|User already/i, 'Ya existe una cuenta con ese correo.'],
  [/Invalid login credentials/i, 'Correo o contraseña incorrectos.'],
  [/different from the old|same password|should be different/i, 'La nueva contraseña debe ser distinta de la anterior.'],
  [/row-level security|permission denied|Sin permisos|sin permiso/i, 'No tienes permiso para realizar esta acción.'],
  [/fuera de tu Junta/i, 'Este niño o niña pertenece a otra Junta de Vecinos.'],
  [/Failed to fetch|Failed to send a request|NetworkError|FunctionsFetchError|network/i, 'No pudimos conectar con el sistema. Revisa tu conexión a internet.'],
  [/JWT expired|not authenticated|No autenticado/i, 'Tu sesión expiró. Vuelve a ingresar.'],
];

export function mensajeError(error, porDefecto = 'Ocurrió un problema. Inténtalo nuevamente o avisa a la Municipalidad.', { pasar = false } = {}) {
  console.error('[detalle técnico]', error);
  const texto = typeof error === 'string' ? error : `${error?.message ?? ''} ${error?.details ?? ''} ${error?.hint ?? ''}`;
  for (const [re, msg] of REGLAS) if (re.test(texto)) return msg;
  // Los RAISE EXCEPTION de nuestras funciones SQL (código P0001) ya vienen redactados para el usuario.
  if (error?.code === 'P0001' && error?.message) return error.message;
  return pasar && typeof error === 'string' ? error : porDefecto;
}
