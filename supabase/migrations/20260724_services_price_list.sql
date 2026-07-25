-- Additive price-list migration based on "cjenik kristina.xlsx", valid 2026-01-01.
-- Durations intentionally remain NULL until entered by the administrator.

begin;

do $preflight$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'Preflight failed: public.is_admin() is missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'appointments'
      and column_name = 'id' and udt_name = 'uuid'
  ) then
    raise exception 'Preflight failed: public.appointments.id uuid is missing';
  end if;
end
$preflight$;

create table if not exists public.service_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists service_categories_name_case_insensitive_key
  on public.service_categories (lower(btrim(name)));
create index if not exists service_categories_active_display_idx
  on public.service_categories (is_active, display_order, name);

insert into public.service_categories (code, name, is_active, display_order)
values
  ('color-addons', 'Bojenje i dodaci', true, 1),
  ('brows-lashes', 'Obrve i trepavice', true, 2),
  ('botox', 'Botox tretmani', true, 3),
  ('keratin', 'Keratinski tretmani', true, 4),
  ('perms', 'Minival', true, 5),
  ('washing', 'Pranje kose', true, 6),
  ('formal', 'Svečane frizure', true, 7),
  ('cuts', 'Šišanje', true, 8),
  ('bridal', 'Vjenčane frizure i češljanje', true, 9),
  ('care', 'Njega i tretmani', true, 10),
  ('styling', 'Frizure prema dužini kose', true, 11),
  ('cut-styling', 'Šišanje i frizura', true, 12)
on conflict (code) do update
set name = excluded.name,
    is_active = excluded.is_active,
    display_order = excluded.display_order,
    updated_at = now();

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  source_code integer unique,
  category_id uuid not null references public.service_categories(id),
  name text not null,
  price numeric(10,2) not null check (price >= 0),
  duration_minutes integer check (duration_minutes is null or duration_minutes > 0),
  is_active boolean not null default true,
  is_bookable boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists services_name_case_insensitive_key
  on public.services (lower(btrim(name)));
create index if not exists services_active_display_idx
  on public.services (is_active, display_order, name);
create index if not exists services_bookable_display_idx
  on public.services (is_bookable, is_active, display_order, name);
create index if not exists services_category_display_idx
  on public.services (category_id, is_active, is_bookable, display_order, name);

with imported_services (
  source_code, category_code, name, price, duration_minutes, is_active, is_bookable, display_order
) as (
values
  (2, 'color-addons', 'Aplikacija boje', 5.00, null, true, false, 1),
  (11, 'brows-lashes', 'Bojenje obrva', 3.00, null, true, true, 2),
  (13, 'brows-lashes', 'Bojenje trepavica', 4.00, null, true, true, 3),
  (14, 'botox', 'Botox 1', 60.00, null, true, true, 4),
  (15, 'botox', 'Botox 2', 70.00, null, true, true, 5),
  (16, 'botox', 'Botox 3', 80.00, null, true, true, 6),
  (17, 'botox', 'Botox 4', 90.00, null, true, true, 7),
  (18, 'botox', 'Botox 5', 100.00, null, true, true, 8),
  (22, 'keratin', 'Keratin 1', 70.00, null, true, true, 9),
  (23, 'keratin', 'Keratin 2', 90.00, null, true, true, 10),
  (24, 'keratin', 'Keratin 3', 110.00, null, true, true, 11),
  (25, 'keratin', 'Keratin 4', 130.00, null, true, true, 12),
  (26, 'keratin', 'Keratin 5', 150.00, null, true, true, 13),
  (27, 'keratin', 'Keratin 6', 170.00, null, true, true, 14),
  (28, 'keratin', 'Keratin 7', 190.00, null, true, true, 15),
  (30, 'perms', 'Minival srednja kosa', 55.00, null, true, true, 16),
  (31, 'perms', 'Minival kratka kosa', 45.00, null, true, true, 17),
  (32, 'perms', 'Minival duga kosa', 85.00, null, true, true, 18),
  (40, 'washing', 'Pranje kose', 5.00, null, true, true, 19),
  (47, 'formal', 'Svečana frizura duga kosa', 50.00, null, true, true, 20),
  (48, 'formal', 'Svečana frizura srednja kosa', 30.00, null, true, true, 21),
  (49, 'formal', 'Svečana frizura kratka kosa', 25.00, null, true, true, 22),
  (54, 'cuts', 'Šišanje i oblikovanje', 15.00, null, true, true, 23),
  (55, 'cuts', 'Šišanje i pranje kose', 14.00, null, true, true, 24),
  (56, 'cuts', 'Šišanje kose', 10.00, null, true, true, 25),
  (57, 'cuts', 'Šišanje kose mašinica', 7.00, null, true, true, 26),
  (58, 'cuts', 'Šišanje šiški', 4.00, null, true, true, 27),
  (59, 'cuts', 'Šišanje pranje i oblikovanje', 18.00, null, true, true, 28),
  (63, 'bridal', 'Vjenčana frizura duga kosa', 70.00, null, true, true, 29),
  (64, 'bridal', 'Vjenčana frizura srednjaa kosa', 60.00, null, true, true, 30),
  (65, 'bridal', 'Vjenčana frizura kratka kosa', 50.00, null, true, true, 31),
  (66, 'bridal', 'Češljanje', 4.00, null, true, true, 32),
  (103, 'care', 'Defy Damage tretman 1', 4.00, null, true, true, 33),
  (104, 'care', 'Defy Damage tretman 2', 5.00, null, true, true, 34),
  (105, 'care', 'K-pack reconstructor 1', 18.00, null, true, true, 35),
  (106, 'care', 'K-pack reconstructor 2', 20.00, null, true, true, 36),
  (107, 'care', 'K-pack reconstructor 3', 23.00, null, true, true, 37),
  (108, 'color-addons', 'Lumishine boja 10 g', 6.50, null, true, false, 38),
  (109, 'color-addons', 'Liquid toner 10 g', 6.50, null, true, false, 39),
  (110, 'color-addons', 'Demi dimensional 10g', 6.50, null, true, false, 40),
  (111, 'color-addons', 'Blond life blanš 10 g', 5.50, null, true, false, 41),
  (112, 'color-addons', 'Vero light blanš 10g', 5.50, null, true, false, 42),
  (113, 'color-addons', 'Intensity 10g', 5.00, null, true, false, 43),
  (114, 'color-addons', 'Vero - K 10g', 6.50, null, true, false, 44),
  (115, 'color-addons', '10 min. Boja 10g', 6.50, null, true, false, 45),
  (116, 'styling', 'Frizura S', 15.00, null, true, true, 46),
  (117, 'styling', 'Frizura M', 17.00, null, true, true, 47),
  (118, 'styling', 'Frizura L', 19.00, null, true, true, 48),
  (119, 'styling', 'Frizura XL', 21.00, null, true, true, 49),
  (120, 'styling', 'Frizura XXL', 25.00, null, true, true, 50),
  (121, 'cut-styling', 'Šišanje i frizura S', 21.00, null, true, true, 51),
  (122, 'cut-styling', 'Šišanje i frizura M', 23.00, null, true, true, 52),
  (123, 'cut-styling', 'Šišanje i frizura L', 25.00, null, true, true, 53),
  (124, 'cut-styling', 'Šišanje i frizura XL', 27.00, null, true, true, 54),
  (125, 'cut-styling', 'Šišanje i frizura XXL', 30.00, null, true, true, 55),
  (126, 'color-addons', 'Šišanje i frizura uz bojenje S', 18.00, null, true, false, 56),
  (127, 'color-addons', 'Šišanje i frizura uz bojenje M', 20.00, null, true, false, 57),
  (128, 'color-addons', 'Šišanje i frizura uz bojenje L', 22.00, null, true, false, 58),
  (129, 'care', 'Defy Damage tretman 3', 4.50, null, true, true, 59),
  (130, 'styling', 'Frizura XS', 13.00, null, true, true, 60),
  (131, 'cut-styling', 'Šišanje i frizura XS', 20.00, null, true, true, 61),
  (132, 'color-addons', 'Olaplex 10ml', 2.00, null, true, false, 62),
  (133, 'color-addons', 'Predpigmentacija M', 5.00, null, true, false, 63),
  (134, 'color-addons', 'Predpigmentacija L', 10.00, null, true, false, 64)
)
insert into public.services (
  source_code, category_id, name, price, duration_minutes, is_active, is_bookable, display_order
)
select imported.source_code, category.id, imported.name, imported.price,
       imported.duration_minutes::integer, imported.is_active, imported.is_bookable, imported.display_order
from imported_services imported
join public.service_categories category on category.code = imported.category_code
on conflict (source_code) do update
set category_id = excluded.category_id,
    name = excluded.name,
    price = excluded.price,
    is_active = excluded.is_active,
    is_bookable = excluded.is_bookable,
    display_order = excluded.display_order,
    updated_at = now();

alter table public.appointments
  add column if not exists service_id uuid references public.services(id) on delete set null,
  add column if not exists service_name_snapshot text,
  add column if not exists service_price_snapshot numeric(10,2),
  add column if not exists service_duration_snapshot integer;

update public.appointments
set service_name_snapshot = coalesce(service_name_snapshot, service)
where service_name_snapshot is null and service is not null;

create or replace function public.snapshot_appointment_service()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_service public.services%rowtype;
begin
  if new.service_id is not null
    and (tg_op = 'INSERT' or new.service_id is distinct from old.service_id)
  then
    select *
    into selected_service
    from public.services
    where id = new.service_id and is_active = true;

    if selected_service.id is null then
      raise exception 'Selected service is unavailable';
    end if;

    new.service := selected_service.name;
    new.service_name_snapshot := selected_service.name;
    new.service_price_snapshot := selected_service.price;
    new.service_duration_snapshot := selected_service.duration_minutes;
  elsif new.service_name_snapshot is null then
    new.service_name_snapshot := new.service;
  end if;
  return new;
end
$$;

do $trigger$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.appointments'::regclass
      and tgname = 'appointments_snapshot_service'
  ) then
    execute $sql$
      create trigger appointments_snapshot_service
        before insert or update of service_id on public.appointments
        for each row execute function public.snapshot_appointment_service()
    $sql$;
  end if;
end
$trigger$;

alter table public.service_categories enable row level security;
alter table public.services enable row level security;
revoke all on public.service_categories from anon, authenticated;
revoke all on public.services from anon, authenticated;

create or replace view public.active_service_prices
with (security_invoker = false)
as
select category.name as category_name, service.name, service.price
from public.services service
join public.service_categories category on category.id = service.category_id
where category.is_active = true and service.is_active = true
order by category.display_order, category.name, service.display_order, service.name;

create or replace view public.bookable_service_prices
with (security_invoker = false)
as
select category.name as category_name, service.name, service.price
from public.services service
join public.service_categories category on category.id = service.category_id
where category.is_active = true
  and service.is_active = true
  and service.is_bookable = true
order by category.display_order, category.name, service.display_order, service.name;

revoke all on public.active_service_prices from anon, authenticated;
revoke all on public.bookable_service_prices from anon, authenticated;
grant select on public.active_service_prices to authenticated;
grant select on public.bookable_service_prices to authenticated;

create or replace function public.admin_list_services()
returns table (
  id uuid,
  source_code integer,
  category_id uuid,
  category_name text,
  name text,
  price numeric,
  duration_minutes integer,
  is_active boolean,
  is_bookable boolean,
  display_order integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.source_code, s.category_id, c.name, s.name, s.price, s.duration_minutes,
         s.is_active, s.is_bookable, s.display_order
  from public.services s
  join public.service_categories c on c.id = s.category_id
  where public.is_admin()
  order by c.display_order, c.name, s.display_order, s.name
$$;

create or replace function public.admin_upsert_service(
  service_id uuid,
  service_category_id uuid,
  service_name text,
  service_price numeric,
  service_duration_minutes integer,
  service_is_active boolean,
  service_is_bookable boolean,
  service_display_order integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  if btrim(coalesce(service_name, '')) = '' then
    raise exception 'Service name is required';
  end if;
  if service_price is null or service_price < 0 then
    raise exception 'Service price is invalid';
  end if;
  if service_duration_minutes is not null and service_duration_minutes <= 0 then
    raise exception 'Service duration is invalid';
  end if;
  if not exists (
    select 1 from public.service_categories
    where id = service_category_id
  ) then
    raise exception 'Service category is invalid';
  end if;

  if service_id is null then
    insert into public.services (
      category_id, name, price, duration_minutes, is_active, is_bookable, display_order
    )
    values (
      service_category_id, btrim(service_name), service_price, service_duration_minutes,
      service_is_active, service_is_bookable, service_display_order
    )
    returning id into saved_id;
  else
    update public.services
    set category_id = service_category_id,
        name = btrim(service_name),
        price = service_price,
        duration_minutes = service_duration_minutes,
        is_active = service_is_active,
        is_bookable = service_is_bookable,
        display_order = service_display_order,
        updated_at = now()
    where id = service_id
    returning id into saved_id;
    if saved_id is null then
      raise exception 'Service does not exist';
    end if;
  end if;
  return saved_id;
end
$$;

create or replace function public.admin_list_service_categories()
returns table (
  id uuid,
  code text,
  name text,
  is_active boolean,
  display_order integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.code, c.name, c.is_active, c.display_order
  from public.service_categories c
  where public.is_admin()
  order by c.display_order, c.name
$$;

create or replace function public.admin_upsert_service_category(
  category_id uuid,
  category_name text,
  category_is_active boolean,
  category_display_order integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  if btrim(coalesce(category_name, '')) = '' then
    raise exception 'Category name is required';
  end if;

  if category_id is null then
    insert into public.service_categories (code, name, is_active, display_order)
    values (
      'custom-' || replace(gen_random_uuid()::text, '-', ''),
      btrim(category_name), category_is_active, category_display_order
    )
    returning id into saved_id;
  else
    update public.service_categories
    set name = btrim(category_name),
        is_active = category_is_active,
        display_order = category_display_order,
        updated_at = now()
    where id = category_id
    returning id into saved_id;
    if saved_id is null then
      raise exception 'Category does not exist';
    end if;
  end if;
  return saved_id;
end
$$;

revoke all on function public.admin_list_services() from public;
revoke all on function public.admin_upsert_service(uuid,uuid,text,numeric,integer,boolean,boolean,integer) from public;
revoke all on function public.admin_list_service_categories() from public;
revoke all on function public.admin_upsert_service_category(uuid,text,boolean,integer) from public;
grant execute on function public.admin_list_services() to authenticated;
grant execute on function public.admin_upsert_service(uuid,uuid,text,numeric,integer,boolean,boolean,integer) to authenticated;
grant execute on function public.admin_list_service_categories() to authenticated;
grant execute on function public.admin_upsert_service_category(uuid,text,boolean,integer) to authenticated;

commit;
