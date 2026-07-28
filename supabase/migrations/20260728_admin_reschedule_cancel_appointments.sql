begin;

create or replace function public.admin_reschedule_appointment(
  target_appointment_id uuid,
  target_starts_at timestamptz,
  allow_overlap boolean default false
)
returns table (
  appointment_id uuid,
  client_id uuid,
  previous_starts_at timestamptz,
  current_starts_at timestamptz,
  current_ends_at timestamptz,
  notification_created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_appointment public.appointments;
  calculated_ends_at timestamptz;
  duration_minutes integer;
  inserted_message_count integer := 0;
  notification_key text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  if target_starts_at is null then
    raise exception 'New appointment time is required';
  end if;

  select appointment_row.*
  into locked_appointment
  from public.appointments as appointment_row
  where appointment_row.id = target_appointment_id
  for update;

  if locked_appointment.id is null then
    raise exception 'Appointment was not found';
  end if;
  if locked_appointment.status <> 'confirmed'
    or locked_appointment.confirmation_status <> 'confirmed'
  then
    raise exception 'Only a confirmed active appointment can be rescheduled';
  end if;
  if locked_appointment.starts_at = target_starts_at then
    raise exception 'The appointment already uses the selected time';
  end if;

  duration_minutes := coalesce(
    locked_appointment.total_duration_minutes,
    locked_appointment.service_duration_snapshot,
    greatest(
      1,
      round(extract(epoch from (
        locked_appointment.ends_at - locked_appointment.starts_at
      )) / 60)::integer
    ),
    30
  );
  calculated_ends_at := target_starts_at
    + make_interval(mins => duration_minutes);

  if not coalesce(allow_overlap, false) and exists (
    select 1
    from public.appointments as conflicting_appointment
    where conflicting_appointment.id <> locked_appointment.id
      and conflicting_appointment.status = 'confirmed'
      and conflicting_appointment.starts_at < calculated_ends_at
      and conflicting_appointment.ends_at > target_starts_at
  ) then
    raise exception 'The new time overlaps another active appointment';
  end if;

  update public.appointments as appointment_row
  set starts_at = target_starts_at,
      ends_at = calculated_ends_at,
      updated_at = now()
  where appointment_row.id = locked_appointment.id;

  update public.client_requests as request_row
  set proposed_starts_at = target_starts_at,
      proposed_duration_minutes = duration_minutes,
      admin_reply = 'Termin je pomaknut na novi datum ili vrijeme.',
      updated_at = now()
  where request_row.appointment_id = locked_appointment.id;

  notification_key := 'appointment-rescheduled:'
    || locked_appointment.id::text
    || ':'
    || extract(epoch from locked_appointment.starts_at)::bigint::text
    || ':'
    || extract(epoch from target_starts_at)::bigint::text;

  insert into public.messages (
    client_id,
    sender,
    subject,
    message,
    is_read,
    event_key
  ) values (
    locked_appointment.client_id,
    'admin',
    'Termin je promijenjen',
    'Kristina je promijenila vrijeme vašeg termina. Novo vrijeme: '
      || to_char(target_starts_at at time zone 'Europe/Zagreb', 'DD.MM.YYYY. HH24:MI')
      || '.',
    true,
    notification_key
  )
  on conflict (event_key) do nothing;
  get diagnostics inserted_message_count = row_count;

  return query
  select
    locked_appointment.id,
    locked_appointment.client_id,
    locked_appointment.starts_at,
    target_starts_at,
    calculated_ends_at,
    inserted_message_count > 0;
end
$$;

create or replace function public.admin_cancel_appointment(
  target_appointment_id uuid,
  cancellation_reason text default ''
)
returns table (
  appointment_id uuid,
  client_id uuid,
  notification_created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_appointment public.appointments;
  clean_reason text := coalesce(nullif(btrim(cancellation_reason), ''), '');
  inserted_message_count integer := 0;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select appointment_row.*
  into locked_appointment
  from public.appointments as appointment_row
  where appointment_row.id = target_appointment_id
  for update;

  if locked_appointment.id is null then
    raise exception 'Appointment was not found';
  end if;
  if locked_appointment.status = 'cancelled' then
    raise exception 'Appointment is already cancelled';
  end if;
  if locked_appointment.status <> 'confirmed'
    or locked_appointment.confirmation_status <> 'confirmed'
  then
    raise exception 'Only a confirmed active appointment can be cancelled';
  end if;

  update public.appointments as appointment_row
  set status = 'cancelled',
      notes = case
        when clean_reason = '' then appointment_row.notes
        when coalesce(appointment_row.notes, '') = '' then
          'Razlog otkazivanja: ' || clean_reason
        else appointment_row.notes || E'\nRazlog otkazivanja: ' || clean_reason
      end,
      updated_at = now()
  where appointment_row.id = locked_appointment.id;

  update public.client_requests as request_row
  set status = 'rejected',
      admin_reply = case
        when clean_reason = '' then 'Termin je otkazala Kristina.'
        else 'Termin je otkazala Kristina. Razlog: ' || clean_reason
      end,
      updated_at = now()
  where request_row.appointment_id = locked_appointment.id;

  insert into public.messages (
    client_id,
    sender,
    subject,
    message,
    is_read,
    event_key
  ) values (
    locked_appointment.client_id,
    'admin',
    'Termin je otkazan',
    'Kristina je otkazala vaš termin '
      || to_char(locked_appointment.starts_at at time zone 'Europe/Zagreb', 'DD.MM.YYYY. HH24:MI')
      || case when clean_reason = '' then '.' else '. Razlog: ' || clean_reason end,
    true,
    'appointment-cancelled:' || locked_appointment.id::text
  )
  on conflict (event_key) do nothing;
  get diagnostics inserted_message_count = row_count;

  return query
  select
    locked_appointment.id,
    locked_appointment.client_id,
    inserted_message_count > 0;
end
$$;

revoke all on function public.admin_reschedule_appointment(
  uuid, timestamptz, boolean
) from public, anon;
revoke all on function public.admin_cancel_appointment(
  uuid, text
) from public, anon;
grant execute on function public.admin_reschedule_appointment(
  uuid, timestamptz, boolean
) to authenticated;
grant execute on function public.admin_cancel_appointment(
  uuid, text
) to authenticated;

commit;
