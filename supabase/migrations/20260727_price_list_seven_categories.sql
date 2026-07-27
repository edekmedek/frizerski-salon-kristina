-- Keep exactly the seven approved price-list categories.
-- No services, prices, appointments, clients, users, PINs or Storage objects are changed.

begin;

do $preflight$
declare
  remaining_nonempty_count integer;
begin
  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'service_categories'
  ) or not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'services'
  ) then
    raise exception 'Preflight failed: price-list tables are missing';
  end if;

  if (
    select count(*)
    from public.service_categories
    where name in (
      'Dodaci',
      'Bojanje',
      'Frizura',
      'Pranje',
      U&'\0160i\0161anje',
      'Joico'
    )
  ) <> 6 then
    raise exception 'Preflight failed: one or more approved categories are missing or duplicated';
  end if;

  select count(*)
  into remaining_nonempty_count
  from public.service_categories category
  where category.name not in (
      'Dodaci',
      'Bojanje',
      'Frizura',
      'Pranje',
      U&'\0160i\0161anje',
      'Joico'
    )
    and exists (
      select 1
      from public.services service
      where service.category_id = category.id
    );

  if remaining_nonempty_count <> 1 then
    raise exception 'Preflight failed: expected exactly one additional non-empty category, found %',
      remaining_nonempty_count;
  end if;
end
$preflight$;

delete from public.service_categories category
where category.name not in (
    'Dodaci',
    'Bojanje',
    'Frizura',
    'Pranje',
    U&'\0160i\0161anje',
    'Joico'
  )
  and not exists (
    select 1
    from public.services service
    where service.category_id = category.id
  );

update public.service_categories category
set name = U&'Artikli koji se vi\0161e ne koriste',
    updated_at = now()
where category.name not in (
    'Dodaci',
    'Bojanje',
    'Frizura',
    'Pranje',
    U&'\0160i\0161anje',
    'Joico'
  )
  and exists (
    select 1
    from public.services service
    where service.category_id = category.id
  )
  and category.name is distinct from U&'Artikli koji se vi\0161e ne koriste';

with approved (name, display_order) as (
  values
    ('Dodaci'::text, 1),
    ('Bojanje'::text, 2),
    ('Frizura'::text, 3),
    ('Pranje'::text, 4),
    (U&'\0160i\0161anje', 5),
    ('Joico'::text, 6),
    (U&'Artikli koji se vi\0161e ne koriste', 7)
)
update public.service_categories category
set is_active = true,
    display_order = approved.display_order,
    updated_at = now()
from approved
where category.name = approved.name
  and (
    category.is_active is distinct from true
    or category.display_order is distinct from approved.display_order
  );

do $postflight$
begin
  if (select count(*) from public.service_categories) <> 7 then
    raise exception 'Postflight failed: expected exactly seven categories';
  end if;
end
$postflight$;

commit;

select
  category.name,
  category.display_order,
  count(service.id)::integer as service_count
from public.service_categories category
left join public.services service on service.category_id = category.id
group by category.id, category.name, category.display_order
order by category.display_order;
