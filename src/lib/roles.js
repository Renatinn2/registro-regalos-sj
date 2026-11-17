// CR-03: los roles viven en la tabla `roles`; aquí solo se define qué nombres son "administrativos".
// Cualquier rol nuevo (ej. JARDINES) que no esté en esta lista queda con el perfil operativo (registro + entrega).
export const ROLES_ADMIN = ['SUPER_ADMIN', 'SUPERVISOR_MUNI'];
export const esRolAdmin = (rol) => ROLES_ADMIN.includes(rol);
