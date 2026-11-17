-- =====================================================================
-- Ajuste 002: la tabla beneficiarios ya restringe `estado` a minúsculas
-- ('registrado', 'observado_duplicado', 'entregado'). Se actualizan la función
-- de entrega y las vistas del panel para usar esos valores.
-- Ejecutar en Supabase -> SQL Editor (es seguro repetirlo).
-- =====================================================================

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
