begin;

do $preflight$
declare
  object_kind "char";
begin
  select class.relkind
  into object_kind
  from pg_class class
  join pg_namespace namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'public'
    and class.relname = 'bookable_service_prices';

  if object_kind is distinct from 'v' then
    raise exception 'Preflight failed: public.bookable_service_prices is not a regular view';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'services'
      and column_name = 'id'
      and udt_name = 'uuid'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'services'
      and column_name = 'duration_minutes'
      and data_type = 'integer'
  ) then
    raise exception 'Preflight failed: required public.services columns are unavailable';
  end if;
end
$preflight$;

create or replace view public.bookable_service_prices
with (security_invoker = false)
as
select category.name as category_name,
       service.name,
       service.price,
       service.id,
       service.duration_minutes
from public.services service
join public.service_categories category on category.id = service.category_id
where category.is_active = true
  and service.is_active = true
  and service.is_bookable = true
order by category.display_order, category.name, service.display_order, service.name;

revoke all on public.bookable_service_prices from anon, authenticated;
grant select on public.bookable_service_prices to authenticated;

commit;
