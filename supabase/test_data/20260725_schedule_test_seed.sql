-- Idempotent TEST data for visual calendar verification.
-- Every inserted row carries the exact marker: kristina_schedule_seed_v1.

begin;

alter table public.clients
  add column if not exists test_seed_tag text;

alter table public.appointments
  add column if not exists test_seed_tag text;

create index if not exists clients_test_seed_tag_idx
  on public.clients (test_seed_tag)
  where test_seed_tag is not null;

create index if not exists appointments_test_seed_tag_idx
  on public.appointments (test_seed_tag)
  where test_seed_tag is not null;

insert into public.clients (
  id, first_name, last_name, phone, notes, is_active, test_seed_tag
)
values
  ('a1000000-0000-4000-8000-000000000001', 'TEST Ana', U&'Radi\0107', '0999100001', U&'[TEST] Izmi\0161ljeni klijent za provjeru rasporeda.', true, 'kristina_schedule_seed_v1'),
  ('a1000000-0000-4000-8000-000000000002', 'TEST Marko', U&'Kova\010Devi\0107', '0999100002', U&'[TEST] Izmi\0161ljeni klijent za provjeru rasporeda.', true, 'kristina_schedule_seed_v1'),
  ('a1000000-0000-4000-8000-000000000003', 'TEST Petra', 'Horvat', '0999100003', U&'[TEST] Izmi\0161ljeni klijent za provjeru rasporeda.', true, 'kristina_schedule_seed_v1'),
  ('a1000000-0000-4000-8000-000000000004', 'TEST Luka', U&'Bari\0161i\0107', '0999100004', U&'[TEST] Izmi\0161ljeni klijent za provjeru rasporeda.', true, 'kristina_schedule_seed_v1'),
  ('a1000000-0000-4000-8000-000000000005', 'TEST Ivana', U&'Juri\0107', '0999100005', U&'[TEST] Izmi\0161ljeni klijent za provjeru rasporeda.', true, 'kristina_schedule_seed_v1'),
  ('a1000000-0000-4000-8000-000000000006', 'TEST Nikola', U&'Peri\0107', '0999100006', U&'[TEST] Izmi\0161ljeni klijent za provjeru rasporeda.', true, 'kristina_schedule_seed_v1'),
  ('a1000000-0000-4000-8000-000000000007', 'TEST Maja', U&'Bo\017Ei\0107', '0999100007', U&'[TEST] Izmi\0161ljeni klijent za provjeru rasporeda.', true, 'kristina_schedule_seed_v1'),
  ('a1000000-0000-4000-8000-000000000008', 'TEST Dario', U&'Mari\0107', '0999100008', U&'[TEST] Izmi\0161ljeni klijent za provjeru rasporeda.', true, 'kristina_schedule_seed_v1'),
  ('a1000000-0000-4000-8000-000000000009', 'TEST Lucija', U&'Vukovi\0107', '0999100009', U&'[TEST] Izmi\0161ljeni klijent za provjeru rasporeda.', true, 'kristina_schedule_seed_v1'),
  ('a1000000-0000-4000-8000-000000000010', 'TEST Tomislav', U&'Pavi\0107', '0999100010', U&'[TEST] Izmi\0161ljeni klijent za provjeru rasporeda.', true, 'kristina_schedule_seed_v1'),
  ('a1000000-0000-4000-8000-000000000011', 'TEST Ema', U&'\0160ari\0107', '0999100011', U&'[TEST] Izmi\0161ljeni klijent za provjeru rasporeda.', true, 'kristina_schedule_seed_v1'),
  ('a1000000-0000-4000-8000-000000000012', 'TEST Filip', U&'Babi\0107', '0999100012', U&'[TEST] Izmi\0161ljeni klijent za provjeru rasporeda.', true, 'kristina_schedule_seed_v1')
on conflict (id) do nothing;

do $preflight$
begin
  if (select count(*) from public.clients where test_seed_tag = 'kristina_schedule_seed_v1') <> 12 then
    raise exception 'TEST seed preflight failed: expected 12 dedicated test clients';
  end if;
  if not exists (
    select 1 from public.services
    where is_active = true and is_bookable = true
  ) then
    raise exception 'TEST seed preflight failed: no active bookable services';
  end if;
end
$preflight$;

with test_clients as (
  select id, row_number() over (order by id) as rn,
         count(*) over () as total
  from public.clients
  where test_seed_tag = 'kristina_schedule_seed_v1'
),
test_services as (
  select id, name, price, row_number() over (order by display_order, id) as rn,
         count(*) over () as total
  from public.services
  where is_active = true and is_bookable = true
),
seed_days as (
  select day::date,
         row_number() over (order by day) as day_number,
         extract(isodow from day)::integer as iso_day
  from generate_series(date '2026-07-11', date '2026-08-24', interval '1 day') day
  where extract(isodow from day) <> 7
),
seed_slots as (
  select d.*, slot
  from seed_days d
  cross join lateral generate_series(
    1,
    case when d.iso_day = 6 then 1 else 2 end
  ) slot
),
planned as (
  select
    s.*,
    c.id as client_id,
    service.id as service_id,
    case
      when position(chr(195) in service.name) > 0
        or position(chr(196) in service.name) > 0
        or position(chr(197) in service.name) > 0
        or position(chr(226) in service.name) > 0
      then convert_from(convert_to(service.name, 'WIN1252'), 'UTF8')
      else service.name
    end as service_name,
    service.price as service_price,
    case ((s.day_number + s.slot) % 5)
      when 0 then 30 when 1 then 45 when 2 then 60 when 3 then 90 else 120
    end as duration_minutes,
    case
      when (s.day_number + s.slot) % 13 = 0 then time '07:15'
      when (s.day_number + s.slot) % 17 = 0 then time '20:00'
      when s.iso_day in (2, 6) then time '08:30' + (s.slot - 1) * interval '150 minutes'
      when s.iso_day = 1 then time '13:15' + (s.slot - 1) * interval '150 minutes'
      else time '12:15' + (s.slot - 1) * interval '150 minutes'
    end as local_start
  from seed_slots s
  join test_clients c
    on c.rn = ((s.day_number + s.slot - 2) % c.total) + 1
  join test_services service
    on service.rn = ((s.day_number * 2 + s.slot - 3) % service.total) + 1
),
appointments_to_insert as (
  select
    md5('kristina_schedule_seed_v1:' || day::text || ':' || slot::text)::uuid as id,
    client_id,
    ((day + local_start) at time zone 'Europe/Zagreb') as starts_at,
    service_id,
    service_name,
    service_price,
    duration_minutes,
    case
      when (day_number + slot) % 11 = 0 then 'cancelled'
      when day < date '2026-07-25' then 'completed'
      else 'confirmed'
    end as appointment_status,
    (day_number + slot) % 14 = 0 as no_charge
  from planned
)
insert into public.appointments (
  id, client_id, starts_at, ends_at, service_id, service,
  service_name_snapshot, service_price_snapshot, service_duration_snapshot,
  status, notes, no_charge, test_seed_tag
)
select
  id,
  client_id,
  starts_at,
  starts_at + make_interval(mins => duration_minutes),
  service_id,
  service_name,
  service_name,
  service_price,
  duration_minutes,
  appointment_status,
  U&'[TEST] Probni termin \2013 kristina_schedule_seed_v1',
  no_charge,
  'kristina_schedule_seed_v1'
from appointments_to_insert
on conflict (id) do nothing;

-- The existing snapshot trigger correctly copies service name and price, while
-- these TEST durations remain intentionally varied for calendar verification.
with seed_days as (
  select day::date,
         row_number() over (order by day) as day_number,
         extract(isodow from day)::integer as iso_day
  from generate_series(date '2026-07-11', date '2026-08-24', interval '1 day') day
  where extract(isodow from day) <> 7
),
seed_slots as (
  select d.*, slot
  from seed_days d
  cross join lateral generate_series(
    1,
    case when d.iso_day = 6 then 1 else 2 end
  ) slot
),
durations as (
  select
    md5('kristina_schedule_seed_v1:' || day::text || ':' || slot::text)::uuid as id,
    case ((day_number + slot) % 5)
      when 0 then 30 when 1 then 45 when 2 then 60 when 3 then 90 else 120
    end as duration_minutes
  from seed_slots
)
update public.appointments appointment
set service_duration_snapshot = durations.duration_minutes,
    ends_at = appointment.starts_at + make_interval(mins => durations.duration_minutes)
from durations
where appointment.id = durations.id
  and appointment.test_seed_tag = 'kristina_schedule_seed_v1';

commit;

select
  (select count(*) from public.clients where test_seed_tag = 'kristina_schedule_seed_v1') as test_clients,
  (select count(*) from public.appointments where test_seed_tag = 'kristina_schedule_seed_v1') as test_appointments,
  (select count(*) from public.appointments where test_seed_tag = 'kristina_schedule_seed_v1' and no_charge) as test_no_charge;
