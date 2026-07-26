begin;

alter table public.client_requests
  add column if not exists proposed_starts_at timestamptz,
  add column if not exists proposed_duration_minutes integer,
  add column if not exists client_reply text not null default '';

alter table public.client_requests
  drop constraint if exists client_requests_proposal_duration_check;

alter table public.client_requests
  add constraint client_requests_proposal_duration_check
  check (proposed_duration_minutes is null or proposed_duration_minutes > 0);

drop function if exists public.admin_list_client_request_inbox();

create function public.admin_list_client_request_inbox()
returns table (
  id uuid,
  client_id uuid,
  client_first_name text,
  client_last_name text,
  client_phone text,
  kind text,
  service text,
  preferred_dates date[],
  day_period text,
  client_message text,
  status text,
  admin_reply text,
  client_reply text,
  proposed_starts_at timestamptz,
  proposed_duration_minutes integer,
  appointment_id uuid,
  admin_read_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  return query
  select
    request_row.id,
    request_row.client_id,
    client_row.first_name,
    client_row.last_name,
    client_row.phone,
    request_row.kind,
    request_row.service,
    request_row.preferred_dates,
    request_row.day_period,
    request_row.client_message,
    request_row.status,
    request_row.admin_reply,
    request_row.client_reply,
    request_row.proposed_starts_at,
    request_row.proposed_duration_minutes,
    request_row.appointment_id,
    request_row.admin_read_at,
    request_row.created_at,
    request_row.updated_at
  from public.client_requests request_row
  join public.clients client_row on client_row.id = request_row.client_id
  order by
    case request_row.status
      when 'pending' then 0
      when 'in_review' then 1
      when 'confirmed' then 2
      else 3
    end,
    request_row.created_at desc;
end
$$;

create or replace function public.admin_propose_client_request(
  target_request_id uuid,
  target_starts_at timestamptz,
  target_duration_minutes integer,
  reply_message text
)
returns public.client_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_request public.client_requests;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  if target_starts_at is null or target_duration_minutes is null
    or target_duration_minutes <= 0
  then
    raise exception 'A valid proposed time and duration are required';
  end if;
  if nullif(btrim(reply_message), '') is null then
    raise exception 'A reply is required';
  end if;

  update public.client_requests
  set status = 'in_review',
      admin_reply = btrim(reply_message),
      client_reply = '',
      proposed_starts_at = target_starts_at,
      proposed_duration_minutes = target_duration_minutes,
      admin_read_at = coalesce(admin_read_at, now()),
      updated_at = now()
  where id = target_request_id
    and status in ('pending', 'in_review')
  returning * into updated_request;

  if updated_request.id is null then
    raise exception 'Request is unavailable';
  end if;
  return updated_request;
end
$$;

create or replace function public.client_respond_to_proposed_request(
  target_request_id uuid,
  accept_proposal boolean,
  response_message text default ''
)
returns public.client_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  own_client_id uuid;
  locked_request public.client_requests;
  selected_service public.services%rowtype;
  saved_appointment_id uuid;
  final_duration integer;
begin
  select client_row.id
  into own_client_id
  from public.clients client_row
  where client_row.user_id = auth.uid()
    and client_row.is_active = true
  limit 1;

  if own_client_id is null then
    raise exception 'Not authorized';
  end if;

  select *
  into locked_request
  from public.client_requests
  where id = target_request_id
    and client_id = own_client_id
  for update;

  if locked_request.id is null
    or locked_request.status <> 'in_review'
    or locked_request.proposed_starts_at is null
    or locked_request.proposed_duration_minutes is null
  then
    raise exception 'Proposal is unavailable';
  end if;

  if not coalesce(accept_proposal, false) then
    update public.client_requests
    set status = 'pending',
        client_reply = coalesce(nullif(btrim(response_message), ''), 'Molim novi prijedlog termina.'),
        admin_reply = '',
        proposed_starts_at = null,
        proposed_duration_minutes = null,
        admin_read_at = null,
        updated_at = now()
    where id = locked_request.id
    returning * into locked_request;
    return locked_request;
  end if;

  select service.*
  into selected_service
  from public.services service
  where service.name = locked_request.service
    and service.is_active = true
    and service.is_bookable = true
  order by service.display_order, service.id
  limit 1;

  if selected_service.id is null then
    raise exception 'Requested service is unavailable';
  end if;

  final_duration := locked_request.proposed_duration_minutes;
  saved_appointment_id := extensions.gen_random_uuid();

  insert into public.appointments (
    id, client_id, starts_at, ends_at, service_id, service,
    service_name_snapshot, service_price_snapshot, service_duration_snapshot,
    total_price_snapshot, total_duration_minutes,
    status, notes, no_charge
  )
  values (
    saved_appointment_id,
    own_client_id,
    locked_request.proposed_starts_at,
    locked_request.proposed_starts_at + make_interval(mins => final_duration),
    selected_service.id,
    selected_service.name,
    selected_service.name,
    selected_service.price,
    final_duration,
    selected_service.price,
    final_duration,
    'confirmed',
    nullif(locked_request.client_message, ''),
    false
  );

  insert into public.appointment_services (
    appointment_id, service_id, service_name_snapshot,
    service_price_snapshot, service_duration_snapshot, display_order
  )
  values (
    saved_appointment_id,
    selected_service.id,
    selected_service.name,
    selected_service.price,
    selected_service.duration_minutes,
    0
  );

  update public.client_requests
  set status = 'confirmed',
      appointment_id = saved_appointment_id,
      client_reply = 'Termin je potvrđen.',
      updated_at = now()
  where id = locked_request.id
  returning * into locked_request;

  return locked_request;
end
$$;

revoke all on function public.admin_list_client_request_inbox() from public, anon;
revoke all on function public.admin_propose_client_request(uuid, timestamptz, integer, text) from public, anon;
revoke all on function public.client_respond_to_proposed_request(uuid, boolean, text) from public, anon;

grant execute on function public.admin_list_client_request_inbox() to authenticated;
grant execute on function public.admin_propose_client_request(uuid, timestamptz, integer, text) to authenticated;
grant execute on function public.client_respond_to_proposed_request(uuid, boolean, text) to authenticated;

commit;
