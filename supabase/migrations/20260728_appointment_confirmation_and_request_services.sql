begin;

do $preflight$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'appointments'
      and column_name = 'id' and udt_name = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'client_requests'
      and column_name = 'id' and udt_name = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'services'
      and column_name = 'id' and udt_name = 'uuid'
  ) or to_regclass('public.appointment_services') is null
    or to_regprocedure('public.is_admin()') is null
  then
    raise exception 'Preflight failed: required V1 UUID schema is unavailable';
  end if;
end
$preflight$;

alter table public.appointments
  add column if not exists confirmation_status text not null default 'confirmed';

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and conname = 'appointments_confirmation_status_check'
  ) then
    alter table public.appointments
      add constraint appointments_confirmation_status_check
      check (confirmation_status in ('pending', 'confirmed'));
  end if;
end
$constraints$;

create table if not exists public.client_request_services (
  id uuid primary key default extensions.gen_random_uuid(),
  request_id uuid not null references public.client_requests(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  service_name_snapshot text not null,
  service_price_snapshot numeric(10,2),
  service_duration_snapshot integer not null
    check (service_duration_snapshot >= 0),
  display_order integer not null check (display_order >= 0),
  created_at timestamptz not null default now(),
  constraint client_request_services_request_order_key
    unique (request_id, display_order),
  constraint client_request_services_request_service_key
    unique (request_id, service_id)
);

create index if not exists client_request_services_request_idx
  on public.client_request_services (request_id, display_order);

alter table public.client_request_services enable row level security;
revoke all on public.client_request_services from public, anon, authenticated;
grant select, insert, update, delete on public.client_request_services to authenticated;

drop policy if exists "Admins manage client request services"
  on public.client_request_services;
create policy "Admins manage client request services"
on public.client_request_services for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Clients read own request services"
  on public.client_request_services;
create policy "Clients read own request services"
on public.client_request_services for select to authenticated
using (
  exists (
    select 1
    from public.client_requests request
    join public.clients client on client.id = request.client_id
    where request.id = client_request_services.request_id
      and client.user_id = auth.uid()
  )
);

create or replace function public.admin_save_appointment_with_services(
  target_appointment_id uuid,
  target_client_id uuid,
  target_starts_at timestamptz,
  target_lifecycle_status text,
  target_confirmation_status text,
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
  requested_ids uuid[] := coalesce(target_service_ids, '{}'::uuid[]);
  selected_count integer := 0;
  first_service_id uuid;
  combined_names text;
  calculated_price numeric(10,2) := 0;
  final_price numeric(10,2);
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  if target_client_id is null or target_starts_at is null
    or not exists (select 1 from public.clients where id = target_client_id)
  then raise exception 'Client and start time are required'; end if;
  if target_lifecycle_status not in ('confirmed', 'cancelled', 'completed') then
    raise exception 'Unsupported appointment lifecycle status';
  end if;
  if target_confirmation_status not in ('pending', 'confirmed') then
    raise exception 'Unsupported appointment confirmation status';
  end if;
  if target_total_duration is null or target_total_duration < 15
    or target_total_duration % 15 <> 0
  then raise exception 'Duration must use 15-minute steps'; end if;
  if cardinality(requested_ids) <> (
    select count(distinct service_id) from unnest(requested_ids) service_id
  ) then raise exception 'A service cannot be selected twice'; end if;

  if cardinality(requested_ids) > 0 then
    select count(*),
      (array_agg(service.id order by selected.ordinality))[1],
      string_agg(service.name, ' + ' order by selected.ordinality),
      sum(service.price)
    into selected_count, first_service_id, combined_names, calculated_price
    from unnest(requested_ids) with ordinality selected(service_id, ordinality)
    join public.services service on service.id = selected.service_id
    where service.is_active and service.is_bookable;
    if selected_count <> cardinality(requested_ids) then
      raise exception 'One or more services are unavailable';
    end if;
  end if;

  final_price := case when coalesce(target_no_charge, false) then 0
    else coalesce(target_total_price, calculated_price, 0) end;
  if final_price < 0 then raise exception 'Invalid appointment price'; end if;

  insert into public.appointments (
    id, client_id, starts_at, ends_at, service_id, service,
    service_name_snapshot, service_price_snapshot, service_duration_snapshot,
    total_price_snapshot, total_duration_minutes, status, confirmation_status,
    notes, no_charge
  ) values (
    saved_id, target_client_id, target_starts_at,
    target_starts_at + make_interval(mins => target_total_duration),
    first_service_id, coalesce(combined_names, ''),
    coalesce(combined_names, ''), final_price, target_total_duration,
    final_price, target_total_duration, target_lifecycle_status,
    target_confirmation_status, nullif(target_notes, ''),
    coalesce(target_no_charge, false)
  )
  on conflict (id) do update set
    client_id = excluded.client_id,
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
    confirmation_status = excluded.confirmation_status,
    notes = excluded.notes,
    no_charge = excluded.no_charge,
    updated_at = now();

  delete from public.appointment_services where appointment_id = saved_id;
  insert into public.appointment_services (
    appointment_id, service_id, service_name_snapshot,
    service_price_snapshot, service_duration_snapshot, display_order
  )
  select saved_id, service.id, service.name, service.price,
    service.duration_minutes, selected.ordinality - 1
  from unnest(requested_ids) with ordinality selected(service_id, ordinality)
  join public.services service on service.id = selected.service_id;

  return saved_id;
end
$$;

create or replace function public.client_submit_request(
  request_kind text,
  requested_service text,
  requested_dates date[],
  requested_day_period text,
  request_message text,
  related_appointment_id uuid default null,
  requested_service_ids uuid[] default '{}'::uuid[]
)
returns public.client_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  own_client_id uuid;
  requested_ids uuid[] := coalesce(requested_service_ids, '{}'::uuid[]);
  combined_names text;
  selected_count integer := 0;
  saved_request public.client_requests;
begin
  perform public.salon_require_anonymous_client();
  select id into own_client_id from public.clients
  where user_id = auth.uid() and is_active = true limit 1;
  if own_client_id is null then
    raise exception 'Client access could not be verified';
  end if;
  if request_kind not in ('appointment', 'change', 'cancellation') then
    raise exception 'Unsupported request kind';
  end if;
  if requested_day_period not in ('morning', 'afternoon', 'any') then
    raise exception 'Unsupported day period';
  end if;
  if request_kind = 'appointment'
    and cardinality(requested_ids) = 0
    and nullif(btrim(requested_service), '') is not null
  then
    select array_agg(service.id order by service.id), count(*)
    into requested_ids, selected_count
    from public.services service
    where service.name = nullif(btrim(requested_service), '')
      and service.is_active
      and service.is_bookable;
    if selected_count <> 1 then
      raise exception 'The selected service could not be resolved uniquely';
    end if;
    selected_count := 0;
  end if;
  if cardinality(requested_ids) <> (
    select count(distinct service_id) from unnest(requested_ids) service_id
  ) then raise exception 'A service cannot be selected twice'; end if;

  if request_kind = 'appointment' then
    if coalesce(cardinality(requested_dates), 0) = 0
    then raise exception 'At least one preferred date is required'; end if;
    if cardinality(requested_ids) > 0 then
      select count(*), string_agg(service.name, ' + ' order by selected.ordinality)
      into selected_count, combined_names
      from unnest(requested_ids) with ordinality selected(service_id, ordinality)
      join public.services service on service.id = selected.service_id
      where service.is_active and service.is_bookable;
      if selected_count <> cardinality(requested_ids) then
        raise exception 'One or more services are unavailable';
      end if;
    else
      combined_names := null;
    end if;
  else
    combined_names := nullif(btrim(requested_service), '');
  end if;

  insert into public.client_requests (
    client_id, kind, service, preferred_dates, day_period,
    client_message, status, admin_reply, appointment_id
  ) values (
    own_client_id, request_kind, combined_names,
    coalesce(requested_dates, '{}'::date[]), requested_day_period,
    coalesce(request_message, ''), 'pending', '', related_appointment_id
  ) returning * into saved_request;

  insert into public.client_request_services (
    request_id, service_id, service_name_snapshot,
    service_price_snapshot, service_duration_snapshot, display_order
  )
  select saved_request.id, service.id, service.name, service.price,
    coalesce(service.duration_minutes, 0), selected.ordinality - 1
  from unnest(requested_ids) with ordinality selected(service_id, ordinality)
  join public.services service on service.id = selected.service_id;

  return saved_request;
end
$$;

create or replace function public.admin_create_proposal_for_client_request(
  target_request_id uuid,
  target_starts_at timestamptz,
  target_total_duration integer,
  target_lifecycle_status text,
  target_confirmation_status text,
  reply_message text,
  target_notes text,
  target_no_charge boolean,
  target_service_ids uuid[],
  target_total_price numeric
)
returns table (
  appointment_id uuid,
  request_id uuid,
  request_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_request public.client_requests;
  saved_appointment_id uuid := extensions.gen_random_uuid();
  requested_ids uuid[] := coalesce(target_service_ids, '{}'::uuid[]);
  selected_count integer := 0;
  first_service_id uuid;
  combined_names text;
  calculated_price numeric(10,2) := 0;
  final_price numeric(10,2);
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select * into locked_request
  from public.client_requests
  where id = target_request_id
  for update;
  if locked_request.id is null
    or locked_request.status not in ('pending', 'in_review')
    or locked_request.appointment_id is not null
  then raise exception 'Request is unavailable'; end if;
  if not exists (
    select 1 from public.clients
    where id = locked_request.client_id and is_active = true
  ) then raise exception 'Client is unavailable'; end if;
  if target_starts_at is null or target_total_duration is null
    or target_total_duration < 15 or target_total_duration % 15 <> 0
  then raise exception 'Duration must use 15-minute steps'; end if;
  if target_lifecycle_status <> 'confirmed' then
    raise exception 'A proposal must use an active lifecycle status';
  end if;
  if target_confirmation_status not in ('pending', 'confirmed') then
    raise exception 'Unsupported appointment confirmation status';
  end if;
  if cardinality(requested_ids) <> (
    select count(distinct service_id) from unnest(requested_ids) service_id
  ) then raise exception 'A service cannot be selected twice'; end if;

  if cardinality(requested_ids) > 0 then
    select count(*),
      (array_agg(service.id order by selected.ordinality))[1],
      string_agg(service.name, ' + ' order by selected.ordinality),
      sum(service.price)
    into selected_count, first_service_id, combined_names, calculated_price
    from unnest(requested_ids) with ordinality selected(service_id, ordinality)
    join public.services service on service.id = selected.service_id
    where service.is_active and service.is_bookable;
    if selected_count <> cardinality(requested_ids) then
      raise exception 'One or more services are unavailable';
    end if;
  end if;

  final_price := case when coalesce(target_no_charge, false) then 0
    else coalesce(target_total_price, calculated_price, 0) end;
  if final_price < 0 then raise exception 'Invalid appointment price'; end if;

  insert into public.appointments (
    id, client_id, starts_at, ends_at, service_id, service,
    service_name_snapshot, service_price_snapshot, service_duration_snapshot,
    total_price_snapshot, total_duration_minutes, status, confirmation_status,
    notes, no_charge
  ) values (
    saved_appointment_id, locked_request.client_id, target_starts_at,
    target_starts_at + make_interval(mins => target_total_duration),
    first_service_id, coalesce(combined_names, ''),
    coalesce(combined_names, ''), final_price, target_total_duration,
    final_price, target_total_duration, target_lifecycle_status,
    target_confirmation_status, nullif(target_notes, ''),
    coalesce(target_no_charge, false)
  );

  insert into public.appointment_services (
    appointment_id, service_id, service_name_snapshot,
    service_price_snapshot, service_duration_snapshot, display_order
  )
  select saved_appointment_id, service.id, service.name, service.price,
    service.duration_minutes, selected.ordinality - 1
  from unnest(requested_ids) with ordinality selected(service_id, ordinality)
  join public.services service on service.id = selected.service_id;

  update public.client_requests
  set status = case when target_confirmation_status = 'confirmed'
        then 'confirmed' else 'in_review' end,
      admin_reply = btrim(reply_message),
      client_reply = '',
      appointment_id = saved_appointment_id,
      proposed_starts_at = target_starts_at,
      proposed_duration_minutes = target_total_duration,
      admin_read_at = coalesce(admin_read_at, now()),
      updated_at = now()
  where id = locked_request.id;
  if not found then raise exception 'Request could not be linked'; end if;

  return query select saved_appointment_id, locked_request.id,
    case when target_confirmation_status = 'confirmed'
      then 'confirmed'::text else 'in_review'::text end;
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
declare own_client_id uuid; locked_request public.client_requests;
begin
  select id into own_client_id from public.clients
  where user_id = auth.uid() and is_active = true limit 1;
  if own_client_id is null then raise exception 'Not authorized'; end if;
  select * into locked_request from public.client_requests
  where id = target_request_id and client_id = own_client_id for update;
  if locked_request.id is null or locked_request.status <> 'in_review'
    or locked_request.appointment_id is null
  then raise exception 'Proposal is unavailable'; end if;

  if coalesce(accept_proposal, false) then
    update public.appointments
    set confirmation_status = 'confirmed', updated_at = now()
    where id = locked_request.appointment_id
      and client_id = own_client_id
      and status = 'confirmed'
      and confirmation_status = 'pending';
    if not found then raise exception 'Reserved appointment is unavailable'; end if;
    update public.client_requests
    set status = 'confirmed', client_reply = U&'Termin je potvr\0111en.',
        updated_at = now()
    where id = locked_request.id returning * into locked_request;
  else
    update public.appointments
    set status = 'cancelled', confirmation_status = 'confirmed', updated_at = now()
    where id = locked_request.appointment_id
      and client_id = own_client_id
      and confirmation_status = 'pending';
    update public.client_requests
    set status = 'pending',
        client_reply = coalesce(nullif(btrim(response_message), ''),
          'Molim novi prijedlog termina.'),
        admin_reply = '', proposed_starts_at = null,
        proposed_duration_minutes = null, appointment_id = null,
        admin_read_at = null, updated_at = now()
    where id = locked_request.id returning * into locked_request;
  end if;
  return locked_request;
end
$$;

create or replace function public.admin_confirm_pending_appointment(
  target_appointment_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  update public.appointments
  set confirmation_status = 'confirmed', updated_at = now()
  where id = target_appointment_id
    and status = 'confirmed'
    and confirmation_status = 'pending';
  if found then
    update public.client_requests
    set status = 'confirmed',
        admin_reply = coalesce(nullif(admin_reply, ''), 'Termin je potvrdila Kristina.'),
        updated_at = now()
    where appointment_id = target_appointment_id
      and status = 'in_review';
    return true;
  end if;
  return false;
end
$$;

revoke all on function public.admin_save_appointment_with_services(
  uuid, uuid, timestamptz, text, text, text, boolean, uuid[], integer, numeric
) from public, anon;
revoke execute on function public.admin_save_appointment_with_services(
  uuid, uuid, timestamptz, text, text, boolean, uuid[], integer, numeric
) from authenticated;
revoke all on function public.client_submit_request(
  text, text, date[], text, text, uuid, uuid[]
) from public, anon;
do $legacy_client_submit_revoke$
begin
  if to_regprocedure(
    'public.client_submit_request(text,text,date[],text,text,uuid)'
  ) is not null then
    revoke execute on function public.client_submit_request(
      text, text, date[], text, text, uuid
    ) from authenticated;
  end if;
end
$legacy_client_submit_revoke$;
revoke all on function public.admin_create_proposal_for_client_request(
  uuid, timestamptz, integer, text, text, text, text, boolean, uuid[], numeric
) from public, anon;
do $legacy_admin_propose_revoke$
begin
  if to_regprocedure(
    'public.admin_propose_client_request(uuid,timestamptz,integer,text)'
  ) is not null then
    revoke execute on function public.admin_propose_client_request(
      uuid, timestamptz, integer, text
    ) from authenticated;
  end if;
end
$legacy_admin_propose_revoke$;
revoke all on function public.client_respond_to_proposed_request(uuid, boolean, text)
  from public, anon;
revoke all on function public.admin_confirm_pending_appointment(uuid)
  from public, anon;

grant execute on function public.admin_save_appointment_with_services(
  uuid, uuid, timestamptz, text, text, text, boolean, uuid[], integer, numeric
) to authenticated;
grant execute on function public.client_submit_request(
  text, text, date[], text, text, uuid, uuid[]
) to authenticated;
grant execute on function public.admin_create_proposal_for_client_request(
  uuid, timestamptz, integer, text, text, text, text, boolean, uuid[], numeric
) to authenticated;
grant execute on function public.client_respond_to_proposed_request(uuid, boolean, text)
  to authenticated;
grant execute on function public.admin_confirm_pending_appointment(uuid)
  to authenticated;

commit;
