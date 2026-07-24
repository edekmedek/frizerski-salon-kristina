with target_tables (schema_name, table_name) as (
  values
    ('public', 'clients'),
    ('public', 'appointments'),
    ('public', 'messages'),
    ('public', 'hairstyle_photos'),
    ('public', 'user_roles'),
    ('public', 'client_accounts'),
    ('public', 'client_invitations'),
    ('public', 'client_requests'),
    ('public', 'client_portal_messages'),
    ('public', 'appointment_reminders')
),
inspection as (
  select
    '01_table'::text as section,
    t.schema_name,
    t.table_name as object_name,
    jsonb_build_object(
      'exists', c.oid is not null,
      'rls_enabled', coalesce(c.relrowsecurity, false),
      'rls_forced', coalesce(c.relforcerowsecurity, false),
      'owner', pg_get_userbyid(c.relowner)
    ) as details
  from target_tables t
  left join pg_namespace n
    on n.nspname = t.schema_name
  left join pg_class c
    on c.relnamespace = n.oid
   and c.relname = t.table_name
   and c.relkind in ('r', 'p')

  union all

  select
    '02_column',
    cols.table_schema,
    cols.table_name || '.' || cols.column_name,
    jsonb_build_object(
      'ordinal_position', cols.ordinal_position,
      'data_type', cols.data_type,
      'udt_schema', cols.udt_schema,
      'udt_name', cols.udt_name,
      'nullable', cols.is_nullable,
      'default_expression', cols.column_default,
      'identity', cols.is_identity,
      'generated', cols.is_generated,
      'character_maximum_length', cols.character_maximum_length,
      'numeric_precision', cols.numeric_precision,
      'numeric_scale', cols.numeric_scale
    )
  from information_schema.columns cols
  join target_tables t
    on t.schema_name = cols.table_schema
   and t.table_name = cols.table_name

  union all

  select
    '03_constraint',
    n.nspname,
    c.relname || '.' || con.conname,
    jsonb_build_object(
      'kind', con.contype,
      'definition', pg_get_constraintdef(con.oid, true),
      'referenced_schema', rn.nspname,
      'referenced_table', rc.relname,
      'validated', con.convalidated,
      'deferrable', con.condeferrable,
      'initially_deferred', con.condeferred
    )
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  join target_tables t
    on t.schema_name = n.nspname
   and t.table_name = c.relname
  left join pg_class rc on rc.oid = con.confrelid
  left join pg_namespace rn on rn.oid = rc.relnamespace

  union all

  select
    '04_index',
    n.nspname,
    c.relname || '.' || i.relname,
    jsonb_build_object(
      'definition', pg_get_indexdef(i.oid),
      'primary', ix.indisprimary,
      'unique', ix.indisunique,
      'valid', ix.indisvalid,
      'ready', ix.indisready
    )
  from pg_index ix
  join pg_class c on c.oid = ix.indrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_class i on i.oid = ix.indexrelid
  join target_tables t
    on t.schema_name = n.nspname
   and t.table_name = c.relname

  union all

  select
    '05_policy',
    p.schemaname,
    p.tablename || '.' || p.policyname,
    jsonb_build_object(
      'mode', p.permissive,
      'roles', p.roles,
      'command', p.cmd,
      'using_expression', p.qual,
      'check_expression', p.with_check
    )
  from pg_policies p
  where
    (p.schemaname, p.tablename) in (
      select t.schema_name, t.table_name
      from target_tables t
    )
    or (p.schemaname = 'storage' and p.tablename in ('objects', 'buckets'))

  union all

  select
    '06_function',
    n.nspname,
    pr.proname || '(' || pg_get_function_identity_arguments(pr.oid) || ')',
    jsonb_build_object(
      'result', pg_get_function_result(pr.oid),
      'language', lang.lanname,
      'security_definer', pr.prosecdef,
      'volatility', pr.provolatile,
      'parallel_safety', pr.proparallel,
      'arguments', pg_get_function_arguments(pr.oid),
      'configuration', pr.proconfig,
      'source', pr.prosrc
    )
  from pg_proc pr
  join pg_namespace n on n.oid = pr.pronamespace
  join pg_language lang on lang.oid = pr.prolang
  where n.nspname = 'public'

  union all

  select
    '07_trigger',
    n.nspname,
    c.relname || '.' || tr.tgname,
    jsonb_build_object(
      'enabled', tr.tgenabled,
      'definition', pg_get_triggerdef(tr.oid, true),
      'function_schema', fnn.nspname,
      'function_name', fn.proname
    )
  from pg_trigger tr
  join pg_class c on c.oid = tr.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join target_tables t
    on t.schema_name = n.nspname
   and t.table_name = c.relname
  join pg_proc fn on fn.oid = tr.tgfoid
  join pg_namespace fnn on fnn.oid = fn.pronamespace
  where not tr.tgisinternal

  union all

  select
    '08_storage_bucket',
    'storage',
    b.id,
    to_jsonb(b)
  from storage.buckets b
  where b.id = 'client-photos'

  union all

  select
    '09_enum',
    n.nspname,
    typ.typname,
    jsonb_build_object(
      'labels',
      jsonb_agg(e.enumlabel order by e.enumsortorder)
    )
  from pg_type typ
  join pg_namespace n on n.oid = typ.typnamespace
  join pg_enum e on e.enumtypid = typ.oid
  where n.nspname = 'public'
  group by n.nspname, typ.typname
)
select section, schema_name, object_name, details
from inspection
order by section, schema_name, object_name;
