import { supabase } from '../supabase';

// Escritura en la bitácora. La BD completa creado_el e ip_origen y bloquea UPDATE/DELETE (ver migración SQL).
export async function registrarAuditoria(usuarioId, modulo, accion, detalle = {}) {
  const { error } = await supabase
    .from('auditoria')
    .insert([{ usuario_id: usuarioId, modulo, accion, detalle }]);
  if (error) console.error('Auditoría falló:', error.message);
  return !error;
}
