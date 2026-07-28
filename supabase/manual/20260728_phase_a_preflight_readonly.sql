select
  table_name,
  ordinal_position,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'appointments',
    'appointment_services',
    'client_requests',
    'services',
    'clients',
    'user_roles'
  )
order by table_name, ordinal_position;

select
  constraint_row.table_name,
  constraint_row.constraint_name,
  constraint_row.constraint_type,
  key_row.column_name,
  foreign_row.table_name as referenced_table,
  foreign_row.column_name as referenced_column
from information_schema.table_constraints constraint_row
left join information_schema.key_column_usage key_row
  on key_row.constraint_schema = constraint_row.constraint_schema
  and key_row.constraint_name = constraint_row.constraint_name
  and key_row.table_name = constraint_row.table_name
left join information_schema.referential_constraints reference_rule
  on reference_rule.constraint_schema = constraint_row.constraint_schema
  and reference_rule.constraint_name = constraint_row.constraint_name
left join information_schema.constraint_column_usage foreign_row
  on foreign_row.constraint_schema = reference_rule.unique_constraint_schema
  and foreign_row.constraint_name = reference_rule.unique_constraint_name
where constraint_row.table_schema = 'public'
  and constraint_row.table_name in (
    'appointments',
    'appointment_services',
    'client_requests',
    'services',
    'clients',
    'user_roles'
  )
  and constraint_row.constraint_type in (
    'PRIMARY KEY',
    'FOREIGN KEY',
    'UNIQUE'
  )
order by constraint_row.table_name, constraint_row.constraint_name,
  key_row.ordinal_position;

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'appointments',
    'appointment_services',
    'client_requests',
    'services',
    'clients',
    'user_roles'
  )
order by tablename, policyname;

select
  procedure.proname as function_name,
  pg_get_function_identity_arguments(procedure.oid) as argument_types,
  pg_get_function_result(procedure.oid) as result_type,
  procedure.prosecdef as security_definer,
  procedure.provolatile as volatility,
  procedure.proconfig as function_settings
from pg_proc procedure
join pg_namespace namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname in (
    'is_admin',
    'admin_save_appointment_with_services',
    'client_submit_request',
    'admin_propose_client_request',
    'client_respond_to_proposed_request',
    'admin_confirm_pending_appointment',
    'admin_create_proposal_for_client_request'
  )
order by function_name, argument_types;

select
  grantee,
  routine_name,
  privilege_type,
  specific_name
from information_schema.routine_privileges
where routine_schema = 'public'
  and grantee in ('anon', 'authenticated')
  and routine_name in (
    'is_admin',
    'admin_save_appointment_with_services',
    'client_submit_request',
    'admin_propose_client_request',
    'client_respond_to_proposed_request',
    'admin_confirm_pending_appointment',
    'admin_create_proposal_for_client_request'
  )
order by routine_name, grantee, privilege_type;

select
  grantee,
  table_name,
  privilege_type
from information_schema.table_privileges
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
  and table_name in (
    'appointments',
    'appointment_services',
    'client_requests',
    'services',
    'clients',
    'user_roles'
  )
order by table_name, grantee, privilege_type;

select
  (select count(*) from public.appointments) as appointments_count,
  (select count(*) from public.appointment_services)
    as appointment_services_count,
  (select count(*) from public.client_requests) as client_requests_count,
  (select count(*) from public.services) as services_count,
  (select count(*) from public.clients) as clients_count;

select
  expectation,
  case when passed then 'PASS' else 'REVIEW' end as result
from (
  select
    'appointments.id and appointments.client_id use uuid' as expectation,
    count(*) = 2 and bool_and(udt_name = 'uuid') as passed
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'appointments'
    and column_name in ('id', 'client_id')

  union all

  select
    'appointment_services foreign IDs use uuid',
    count(*) = 2 and bool_and(udt_name = 'uuid')
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'appointment_services'
    and column_name in ('appointment_id', 'service_id')

  union all

  select
    'client_requests.id and client_requests.client_id use uuid',
    count(*) = 2 and bool_and(udt_name = 'uuid')
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'client_requests'
    and column_name in ('id', 'client_id')

  union all

  select
    'services.id and clients.id use uuid',
    count(*) = 2 and bool_and(udt_name = 'uuid')
  from information_schema.columns
  where table_schema = 'public'
    and (
      (table_name = 'services' and column_name = 'id')
      or (table_name = 'clients' and column_name = 'id')
    )

  union all

  select
    'central administrator check exists',
    to_regprocedure('public.is_admin()') is not null

  union all

  select
    'required source tables exist',
    to_regclass('public.appointments') is not null
      and to_regclass('public.appointment_services') is not null
      and to_regclass('public.client_requests') is not null
      and to_regclass('public.services') is not null
      and to_regclass('public.clients') is not null
) checks
order by expectation;
