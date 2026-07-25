-- Multiple treatments per appointment plus precise UTF-8 catalog repair.
-- Additive only: legacy appointment service columns remain in place.

begin;

create table if not exists public.appointment_services (
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  service_id uuid not null references public.services(id),
  service_name_snapshot text not null,
  service_price_snapshot numeric(10,2) not null check (service_price_snapshot >= 0),
  service_duration_snapshot integer check (service_duration_snapshot is null or service_duration_snapshot > 0),
  display_order integer not null check (display_order >= 0),
  created_at timestamptz not null default now(),
  primary key (appointment_id, service_id)
);

alter table public.appointments
  add column if not exists total_price_snapshot numeric(10,2),
  add column if not exists total_duration_minutes integer;

alter table public.appointment_services enable row level security;
revoke all on public.appointment_services from anon;
grant select on public.appointment_services to authenticated;

do $policies$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'appointment_services'
      and policyname = 'Admins manage appointment services'
  ) then
    execute $sql$
      create policy "Admins manage appointment services"
        on public.appointment_services for all to authenticated
        using (public.is_admin()) with check (public.is_admin())
    $sql$;
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'appointment_services'
      and policyname = 'Clients read own appointment services'
  ) then
    execute $sql$
      create policy "Clients read own appointment services"
        on public.appointment_services for select to authenticated
        using (
          exists (
            select 1 from public.appointments appointment
            join public.clients client on client.id = appointment.client_id
            where appointment.id = appointment_services.appointment_id
              and client.user_id = auth.uid()
          )
        )
    $sql$;
  end if;
end
$policies$;

insert into public.appointment_services (
  appointment_id, service_id, service_name_snapshot,
  service_price_snapshot, service_duration_snapshot, display_order
)
select
  appointment.id,
  appointment.service_id,
  coalesce(appointment.service_name_snapshot, appointment.service, service.name),
  coalesce(appointment.service_price_snapshot, service.price),
  coalesce(appointment.service_duration_snapshot, service.duration_minutes),
  0
from public.appointments appointment
join public.services service on service.id = appointment.service_id
where appointment.service_id is not null
on conflict (appointment_id, service_id) do nothing;

update public.appointments appointment
set total_price_snapshot = case
      when appointment.no_charge then 0
      else coalesce(appointment.total_price_snapshot, appointment.service_price_snapshot)
    end,
    total_duration_minutes = coalesce(
      appointment.total_duration_minutes,
      appointment.service_duration_snapshot,
      case
        when appointment.ends_at is not null
        then greatest(1, extract(epoch from (appointment.ends_at - appointment.starts_at))::integer / 60)
      end
    )
where appointment.total_price_snapshot is null
   or appointment.total_duration_minutes is null;

create or replace function public.admin_save_appointment_with_services(
  target_appointment_id uuid,
  target_client_id uuid,
  target_starts_at timestamptz,
  target_status text,
  target_notes text,
  target_no_charge boolean,
  target_service_ids uuid[],
  target_total_duration integer,
  target_total_price numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid := coalesce(target_appointment_id, extensions.gen_random_uuid());
  selected_count integer;
  first_service_id uuid;
  combined_names text;
  calculated_price numeric(10,2);
  calculated_duration integer;
  final_price numeric(10,2);
  final_duration integer;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  if target_client_id is null or target_starts_at is null
    or not exists (select 1 from public.clients where id = target_client_id)
  then
    raise exception 'Client and start time are required';
  end if;
  if target_status not in ('confirmed', 'cancelled', 'completed') then
    raise exception 'Unsupported appointment status';
  end if;
  if target_service_ids is null or cardinality(target_service_ids) = 0 then
    raise exception 'At least one service is required';
  end if;
  if cardinality(target_service_ids) <> (
    select count(distinct service_id) from unnest(target_service_ids) service_id
  ) then
    raise exception 'A service cannot be selected twice';
  end if;

  select
    count(*),
    (array_agg(service.id order by selected.ordinality))[1],
    string_agg(service.name, ' + ' order by selected.ordinality),
    sum(service.price),
    sum(coalesce(service.duration_minutes, 0))
  into selected_count, first_service_id, combined_names, calculated_price, calculated_duration
  from unnest(target_service_ids) with ordinality selected(service_id, ordinality)
  join public.services service on service.id = selected.service_id
  where service.is_active = true and service.is_bookable = true;

  if selected_count <> cardinality(target_service_ids) then
    raise exception 'One or more services are unavailable';
  end if;

  final_duration := coalesce(target_total_duration, calculated_duration);
  final_price := case
    when coalesce(target_no_charge, false) then 0
    else coalesce(target_total_price, calculated_price)
  end;
  if final_duration is null or final_duration <= 0 or final_price is null or final_price < 0 then
    raise exception 'Invalid appointment totals';
  end if;

  insert into public.appointments (
    id, client_id, starts_at, ends_at, service_id, service,
    service_name_snapshot, service_price_snapshot, service_duration_snapshot,
    total_price_snapshot, total_duration_minutes,
    status, notes, no_charge
  )
  values (
    saved_id, target_client_id, target_starts_at,
    target_starts_at + make_interval(mins => final_duration),
    first_service_id, combined_names,
    combined_names, final_price, final_duration,
    final_price, final_duration,
    target_status, nullif(target_notes, ''), coalesce(target_no_charge, false)
  )
  on conflict (id) do update
    set client_id = excluded.client_id,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        service_id = excluded.service_id,
        service = excluded.service,
        service_name_snapshot = excluded.service_name_snapshot,
        service_price_snapshot = excluded.service_price_snapshot,
        service_duration_snapshot = excluded.service_duration_snapshot,
        total_price_snapshot = excluded.total_price_snapshot,
        total_duration_minutes = excluded.total_duration_minutes,
        status = excluded.status,
        notes = excluded.notes,
        no_charge = excluded.no_charge,
        updated_at = now();

  delete from public.appointment_services where appointment_id = saved_id;
  insert into public.appointment_services (
    appointment_id, service_id, service_name_snapshot,
    service_price_snapshot, service_duration_snapshot, display_order
  )
  select
    saved_id, service.id, service.name, service.price,
    service.duration_minutes, selected.ordinality - 1
  from unnest(target_service_ids) with ordinality selected(service_id, ordinality)
  join public.services service on service.id = selected.service_id;

  -- The legacy snapshot trigger may copy the first service; restore aggregate snapshots.
  update public.appointments
  set service = combined_names,
      service_name_snapshot = combined_names,
      service_price_snapshot = final_price,
      service_duration_snapshot = final_duration,
      total_price_snapshot = final_price,
      total_duration_minutes = final_duration
  where id = saved_id;

  return saved_id;
end
$$;

revoke all on function public.admin_save_appointment_with_services(
  uuid, uuid, timestamptz, text, text, boolean, uuid[], integer, numeric
) from public, anon;
grant execute on function public.admin_save_appointment_with_services(
  uuid, uuid, timestamptz, text, text, boolean, uuid[], integer, numeric
) to authenticated;

with corrected_categories (code, corrected_name) as (
  values
    ('color-addons', U&'Bojenje i dodaci'),
    ('brows-lashes', U&'Obrve i trepavice'),
    ('botox', U&'Botox tretmani'),
    ('keratin', U&'Keratinski tretmani'),
    ('perms', U&'Minival'),
    ('washing', U&'Pranje kose'),
    ('formal', U&'Sve\010Dane frizure'),
    ('cuts', U&'\0160i\0161anje'),
    ('bridal', U&'Vjen\010Dane frizure i \010De\0161ljanje'),
    ('care', U&'Njega i tretmani'),
    ('styling', U&'Frizure prema du\017Eini kose'),
    ('cut-styling', U&'\0160i\0161anje i frizura')
)
update public.service_categories category
set name = corrected.corrected_name,
    updated_at = now()
from corrected_categories corrected
where category.code = corrected.code
  and category.name is distinct from corrected.corrected_name;

with corrected_services (source_code, corrected_name) as (
  values
    (47, U&'Sve\010Dana frizura duga kosa'),
    (48, U&'Sve\010Dana frizura srednja kosa'),
    (49, U&'Sve\010Dana frizura kratka kosa'),
    (54, U&'\0160i\0161anje i oblikovanje'),
    (55, U&'\0160i\0161anje i pranje kose'),
    (56, U&'\0160i\0161anje kose'),
    (57, U&'\0160i\0161anje kose ma\0161inica'),
    (58, U&'\0160i\0161anje \0161i\0161ki'),
    (59, U&'\0160i\0161anje pranje i oblikovanje'),
    (63, U&'Vjen\010Dana frizura duga kosa'),
    (64, U&'Vjen\010Dana frizura srednjaa kosa'),
    (65, U&'Vjen\010Dana frizura kratka kosa'),
    (66, U&'\010Ce\0161ljanje'),
    (111, U&'Blond life blan\0161 10 g'),
    (112, U&'Vero light blan\0161 10g'),
    (121, U&'\0160i\0161anje i frizura S'),
    (122, U&'\0160i\0161anje i frizura M'),
    (123, U&'\0160i\0161anje i frizura L'),
    (124, U&'\0160i\0161anje i frizura XL'),
    (125, U&'\0160i\0161anje i frizura XXL'),
    (126, U&'\0160i\0161anje i frizura uz bojenje S'),
    (127, U&'\0160i\0161anje i frizura uz bojenje M'),
    (128, U&'\0160i\0161anje i frizura uz bojenje L'),
    (131, U&'\0160i\0161anje i frizura XS')
)
update public.services service
set name = corrected.corrected_name,
    updated_at = now()
from corrected_services corrected
where service.source_code = corrected.source_code
  and service.name is distinct from corrected.corrected_name;

commit;
