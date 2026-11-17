-- =====================================================================
-- Migración CR-01 … CR-09 · Sistema de Regalos San Joaquín
-- Ejecutar en Supabase → SQL Editor. Revisa los avisos (⚠) antes de correrla.
-- =====================================================================

-- ---------- CR-03: roles dinámicos (datos, no código) ----------
insert into public.roles (nombre, descripcion) values
  ('SUPER_ADMIN',     'Administrador total del sistema'),
  ('SUPERVISOR_MUNI', 'Supervisor municipal: crea cuentas y audita'),
  ('JJVV',            'Representante de Junta de Vecinos')
on conflict (nombre) do nothing;

-- ---------- Funciones auxiliares (SECURITY DEFINER evita recursión de RLS) ----------
create or replace function public.mi_rol() returns text
language sql stable security definer set search_path = public as $$
  select r.nombre from perfiles p join roles r on r.id = p.rol_id
  where p.id = auth.uid() and p.activo $$;

create or replace function public.mi_jjvv() returns int
language sql stable security definer set search_path = public as $$
  select jjvv_id from perfiles where id = auth.uid() and activo $$;

create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.mi_rol() in ('SUPER_ADMIN','SUPERVISOR_MUNI'), false) $$;

-- ---------- CR-05: unicidad por estados, no global ----------
-- Elimina cualquier UNIQUE existente que cubra solo `identificador`
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.beneficiarios'::regclass and contype = 'u'
      and conkey = array[(select attnum from pg_attribute where attrelid = 'public.beneficiarios'::regclass and attname = 'identificador')]
  loop
    execute format('alter table public.beneficiarios drop constraint %I', c.conname);
  end loop;
end $$;
drop index if exists public.beneficiarios_identificador_key;

-- Solo puede existir UN registro "original" por identificador; los duplicados justificados quedan permitidos.
create unique index if not exists beneficiarios_identificador_original_uk
  on public.beneficiarios (upper(identificador)) where es_duplicado = false;

alter table public.beneficiarios drop constraint if exists chk_justificacion_duplicidad;
alter table public.beneficiarios add constraint chk_justificacion_duplicidad
  check (not es_duplicado or length(trim(coalesce(justificacion_duplicidad,''))) >= 15) not valid;

-- ---------- CR-07: tutor sin RUN y retiro subsidiario ----------
alter table public.tutores alter column rut drop not null;

create unique index if not exists entregas_beneficiario_uk on public.entregas (beneficiario_id); -- una sola entrega por niño
alter table public.entregas drop constraint if exists chk_subsidiario;
alter table public.entregas add constraint chk_subsidiario
  check (not es_retiro_subsidiario
         or (length(trim(coalesce(observacion_subsidiario,''))) >= 15 and firma_digital_url is not null)) not valid;

-- ---------- CR-08: bitácora inmutable ----------
create or replace function public.auditoria_before_insert() returns trigger
language plpgsql as $$
declare h json;
begin
  begin h := current_setting('request.headers', true)::json; exception when others then h := null; end;
  new.creado_el  := now();
  new.usuario_id := coalesce(new.usuario_id, auth.uid());
  new.ip_origen  := coalesce(new.ip_origen, nullif(trim(split_part(coalesce(h->>'x-forwarded-for',''), ',', 1)), ''));
  return new;
end $$;

create or replace function public.auditoria_inmutable() returns trigger
language plpgsql as $$ begin raise exception 'La bitácora de auditoría es inmutable'; end $$;

drop trigger if exists trg_auditoria_ins on public.auditoria;
create trigger trg_auditoria_ins before insert on public.auditoria
  for each row execute function public.auditoria_before_insert();
drop trigger if exists trg_auditoria_upd_del on public.auditoria;
create trigger trg_auditoria_upd_del before update or delete on public.auditoria
  for each row execute function public.auditoria_inmutable();
drop trigger if exists trg_auditoria_trunc on public.auditoria;
create trigger trg_auditoria_trunc before truncate on public.auditoria
  for each statement execute function public.auditoria_inmutable();

-- ---------- RPC ----------
-- CR-05: detecta el identificador en TODAS las nóminas (devuelve solo territorio y estado, sin datos personales)
create or replace function public.buscar_duplicado(p_identificador text)
returns table (jjvv_nombre text, estado text)
language sql security definer set search_path = public as $$
  select j.nombre::text, b.estado::text
  from beneficiarios b left join jjvv j on j.id = b.jjvv_id
  where auth.uid() is not null and upper(b.identificador) = upper(p_identificador) $$;

-- CR-02: apaga la bandera (el usuario NO puede editar su propio perfil)
create or replace function public.completar_cambio_clave() returns void
language plpgsql security definer set search_path = public as $$
begin
  update perfiles set requiere_cambio_clave = false where id = auth.uid();
  insert into auditoria (usuario_id, modulo, accion, detalle)
  values (auth.uid(), 'SEGURIDAD', 'CAMBIO_CLAVE_INICIAL', jsonb_build_object('mensaje','El usuario reemplazó su contraseña temporal'));
end $$;

create or replace function public.cambiar_estado_usuario(p_id uuid, p_activo boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Sin permisos'; end if;
  if p_id = auth.uid() then raise exception 'No puedes desactivar tu propia cuenta'; end if;
  update perfiles set activo = p_activo where id = p_id;
  insert into auditoria (usuario_id, modulo, accion, detalle)
  values (auth.uid(), 'SEGURIDAD', case when p_activo then 'CUENTA_ACTIVADA' else 'CUENTA_DESACTIVADA' end, jsonb_build_object('usuario_objetivo', p_id));
end $$;

-- CR-06/07: entrega atómica (inserta entregas + cambia estado + audita) y valida territorio
create or replace function public.registrar_entrega(
  p_beneficiarios uuid[], p_metodo text, p_tutor_rut text,
  p_subsidiario boolean default false, p_observacion text default null, p_firma text default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_jjvv int := mi_jjvv(); v_n int;
begin
  if auth.uid() is null or v_jjvv is null or es_admin() then raise exception 'Sin permisos para registrar entregas'; end if;
  if coalesce(cardinality(p_beneficiarios),0) = 0 then raise exception 'Selecciona al menos un regalo'; end if;
  if p_subsidiario and (length(trim(coalesce(p_observacion,''))) < 15 or p_firma is null) then
    raise exception 'El retiro subsidiario exige observación y firma'; end if;
  if (select count(*) from beneficiarios where id = any(p_beneficiarios) and jjvv_id = v_jjvv) <> cardinality(p_beneficiarios) then
    raise exception 'Hay beneficiarios fuera de tu Junta de Vecinos'; end if;

  insert into entregas (beneficiario_id, operador_id, metodo_validacion, tutor_rut_escaneado,
                        es_retiro_subsidiario, observacion_subsidiario, firma_digital_url)
  select b, auth.uid(), p_metodo, p_tutor_rut, p_subsidiario, p_observacion, p_firma from unnest(p_beneficiarios) b;
  get diagnostics v_n = row_count;

  update beneficiarios set estado = 'entregado' where id = any(p_beneficiarios);

  insert into auditoria (usuario_id, modulo, accion, detalle)
  values (auth.uid(), 'ENTREGA', case when p_subsidiario then 'RETIRO_SUBSIDIARIO' else 'ENTREGA_VALIDADA' end,
          jsonb_build_object('beneficiarios', p_beneficiarios, 'metodo', p_metodo, 'tutor_rut', p_tutor_rut, 'observacion', p_observacion));
  return v_n;
exception when unique_violation then
  raise exception 'Uno de los regalos seleccionados ya fue entregado';
end $$;

revoke execute on function public.buscar_duplicado, public.completar_cambio_clave,
  public.cambiar_estado_usuario, public.registrar_entrega from public, anon;
grant  execute on function public.buscar_duplicado, public.completar_cambio_clave,
  public.cambiar_estado_usuario, public.registrar_entrega to authenticated;

-- ---------- Vistas analíticas (CR-08 / CR-09). security_invoker: respetan RLS ----------
create or replace view public.v_avance_jjvv with (security_invoker = true) as
select j.id as jjvv_id, j.nombre, j.unidad_vecinal,
       count(b.id)                                                       as registrados,
       count(b.id) filter (where b.estado = 'entregado')                 as entregados,
       count(b.id) filter (where b.estado <> 'entregado')                as pendientes,
       count(b.id) filter (where b.es_duplicado)                         as observados
from jjvv j left join beneficiarios b on b.jjvv_id = j.id
group by j.id, j.nombre, j.unidad_vecinal;

create or replace view public.v_proyeccion with (security_invoker = true) as
select b.jjvv_id, j.nombre as jjvv,
       case when e.edad <= 3 then '0-3' when e.edad <= 6 then '4-6' when e.edad <= 9 then '7-9' else '10+' end as rango_etario,
       b.sexo,
       count(*) as registrados,
       count(*) filter (where b.estado = 'entregado') as entregados
from beneficiarios b
join jjvv j on j.id = b.jjvv_id
cross join lateral (select date_part('year', age(current_date, b.fecha_nacimiento))::int as edad) e
group by 1, 2, 3, 4;

grant select on public.v_avance_jjvv, public.v_proyeccion to authenticated;

-- ---------- RLS ----------
-- ⚠ Borra TODAS las políticas previas de estas tablas y las reemplaza por el modelo de abajo.
do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies
           where schemaname = 'public' and tablename in ('perfiles','roles','jjvv','tutores','beneficiarios','entregas','auditoria')
  loop execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename); end loop;
end $$;

alter table public.perfiles      enable row level security;
alter table public.roles         enable row level security;
alter table public.jjvv          enable row level security;
alter table public.tutores       enable row level security;
alter table public.beneficiarios enable row level security;
alter table public.entregas      enable row level security;
alter table public.auditoria     enable row level security;

-- perfiles: solo lectura propia/admin. Escrituras únicamente vía RPC o Edge Function (service_role).
create policy perfiles_select on public.perfiles for select to authenticated using (id = auth.uid() or es_admin());
-- roles y jjvv: lectura para autenticados, escritura solo admin
create policy roles_select on public.roles for select to authenticated using (true);
create policy roles_admin  on public.roles for all    to authenticated using (es_admin()) with check (es_admin());
create policy jjvv_select  on public.jjvv  for select to authenticated using (true);
create policy jjvv_admin   on public.jjvv  for all    to authenticated using (es_admin()) with check (es_admin());
-- tutores y beneficiarios: cada operador ve/crea solo lo de su territorio; el admin ve todo
create policy tutores_select on public.tutores for select to authenticated using (es_admin() or jjvv_id = mi_jjvv());
create policy tutores_insert on public.tutores for insert to authenticated with check (not es_admin() and jjvv_id = mi_jjvv());
create policy tutores_update on public.tutores for update to authenticated using (not es_admin() and jjvv_id = mi_jjvv()) with check (jjvv_id = mi_jjvv());
create policy benef_select on public.beneficiarios for select to authenticated using (es_admin() or jjvv_id = mi_jjvv());
create policy benef_insert on public.beneficiarios for insert to authenticated
  with check (not es_admin() and jjvv_id = mi_jjvv() and creado_por = auth.uid());
-- entregas: solo lectura; se escriben por registrar_entrega()
create policy entregas_select on public.entregas for select to authenticated using (es_admin() or operador_id = auth.uid());
-- auditoria: el admin lee; cualquier usuario puede insertar eventos propios; nadie edita (trigger)
create policy auditoria_select on public.auditoria for select to authenticated using (es_admin());
create policy auditoria_insert on public.auditoria for insert to authenticated with check (usuario_id = auth.uid());
