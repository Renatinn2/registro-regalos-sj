// @ts-nocheck
// Edge Function — CR-01: solo SUPER_ADMIN / SUPERVISOR_MUNI crean cuentas (el sistema no tiene autoregistro).
// Despliegue: supabase functions deploy crear-usuario
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya vienen inyectadas por Supabase.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const ADMIN = ['SUPER_ADMIN', 'SUPERVISOR_MUNI'];
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

function claveTemporal(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const r = crypto.getRandomValues(new Uint32Array(10));
  return Array.from(r, (n) => abc[n % abc.length]).join('') + '#7a';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const {
      data: { user },
    } = await admin.auth.getUser(token);
    if (!user) return json({ error: 'No autenticado' }, 401);

    const { data: yo } = await admin.from('perfiles').select('rol_id, activo').eq('id', user.id).single();
    const { data: miRol } = await admin.from('roles').select('nombre').eq('id', yo?.rol_id).single();
    if (!yo?.activo || !ADMIN.includes(miRol?.nombre)) return json({ error: 'Sin permisos para crear cuentas' }, 403);

    const { email, nombre_completo, rut, rol_id, jjvv_id } = await req.json();
    if (!email || !nombre_completo || !rol_id) return json({ error: 'Faltan datos obligatorios' }, 400);

    const { data: rolNuevo } = await admin.from('roles').select('nombre').eq('id', rol_id).single();
    if (!rolNuevo) return json({ error: 'Rol inexistente' }, 400);

    const esNuevoAdmin = ADMIN.includes(rolNuevo.nombre);
    if (!esNuevoAdmin && !jjvv_id) {
      return json({ error: 'Las cuentas territoriales requieren una Junta de Vecinos' }, 400);
    }
    if (esNuevoAdmin && miRol?.nombre !== 'SUPER_ADMIN') {
      return json({ error: 'Solo un SUPER_ADMIN crea cuentas administrativas' }, 403);
    }

    const jjvvFinal = esNuevoAdmin ? null : jjvv_id;
    const password = claveTemporal();
    const { data: creado, error: e1 } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (e1) return json({ error: e1.message }, 400);

    const { error: e2 } = await admin.from('perfiles').upsert({
      id: creado.user.id,
      rut,
      nombre_completo,
      rol_id,
      jjvv_id: jjvvFinal,
      requiere_cambio_clave: true,
      activo: true,
    });
    if (e2) {
      await admin.auth.admin.deleteUser(creado.user.id);
      return json({ error: e2.message }, 400);
    }

    const ipOrigen = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

    await admin.from('auditoria').insert({
      usuario_id: user.id,
      modulo: 'SEGURIDAD',
      accion: 'CUENTA_CREADA',
      ip_origen: ipOrigen,
      detalle: { usuario_creado: creado.user.id, email, rol: rolNuevo.nombre, jjvv_id: jjvvFinal },
    });

    return json({ ok: true, user_id: creado.user.id, password_temporal: password });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});