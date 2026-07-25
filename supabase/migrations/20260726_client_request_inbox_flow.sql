-- Connect the client request form and administrator inbox to one Supabase flow.
-- Existing requests are preserved. Accepting a request and creating its appointment
-- happen in one database transaction, with idempotent protection against double clicks.

begin;

do $preflight$
begin
  if to_regprocedure('public.is_admin()') is null
    or to_regprocedure('public.salon_require_anonymous_client()') is null
    or to_regprocedure(
      'public.admin_save_appointment_with_services(uuid,uuid,timestamp with time zone,text,text,boolean,uuid[],integer,numeric)'
    ) is null
  then
    raise exception 'Preflight failed: required security or appointment functions are missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'client_requests'
      and column_name = 'status'
  ) then
    raise exception 'Preflight failed: public.client_requests is missing';
  end if;
end
$preflight$;

create or replace function public.client_submit_request(
  request_kind text,
  requested_service text,
  requested_dates date[],
  requested_day_period text,
  request_message text,
  related_appointment_id uuid default null
)
returns public.client_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  own_client_id uuid;
  saved_request public.client_requests;
begin
  perform public.salon_require_anonymous_client();

  select client_row.id
  into own_client_id
  from public.clients client_row
  where client_row.user_id = auth.uid()
    and client_row.is_active = true;

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
    and (
      nullif(btrim(requested_service), '') is null
      or coalesce(cardinality(requested_dates), 0) = 0
    )
  then
    raise exception 'Service and at least one preferred date are required';
  end if;
  if request_kind in ('change', 'cancellation')
    and (
      related_appointment_id is null
      or not exists (
        select 1
        from public.appointments appointment_row
        where appointment_row.id = related_appointment_id
          and appointment_row.client_id = own_client_id
      )
    )
  then
    raise exception 'Appointment could not be verified';
  end if;

  insert into public.client_requests (
    client_id,
    kind,
    service,
    preferred_dates,
    day_period,
    client_message,
    status,
    admin_reply,
    appointment_id
  )
  values (
    own_client_id,
    request_kind,
    nullif(btrim(requested_service), ''),
    coalesce(requested_dates, '{}'::date[]),
    requested_day_period,
    coalesce(request_message, ''),
    'pending',
    '',
    related_appointment_id
  )
  returning *
  into saved_request;

  return saved_request;
end
$$;

create or replace function public.admin_list_client_requests()
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
  appointment_id uuid,
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
    request_row.appointment_id,
    request_row.created_at,
    request_row.updated_at
  from public.client_requests request_row
  join public.clients client_row
    on client_row.id = request_row.client_id
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

create or replace function public.admin_respond_client_request(
  target_request_id uuid,
  next_status text,
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
  if next_status not in ('in_review', 'rejected') then
    raise exception 'Unsupported request status';
  end if;
  if nullif(btrim(reply_message), '') is null then
    raise exception 'A reply is required';
  end if;

  update public.client_requests
  set status = next_status,
      admin_reply = btrim(reply_message),
      updated_at = now()
  where id = target_request_id
    and status in ('pending', 'in_review')
  returning *
  into updated_request;

  if updated_request.id is null then
    raise exception 'Request is unavailable';
  end if;

  return updated_request;
end
$$;

create or replace function public.admin_accept_client_request(
  target_request_id uuid,
  target_starts_at timestamptz,
  target_notes text,
  target_no_charge boolean,
  target_service_ids uuid[],
  target_total_duration integer,
  target_total_price numeric
)
returns table (
  request_id uuid,
  appointment_id uuid,
  request_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_request public.client_requests;
  saved_appointment_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select *
  into locked_request
  from public.client_requests
  where id = target_request_id
  for update;

  if locked_request.id is null then
    raise exception 'Request is unavailable';
  end if;

  if locked_request.status = 'confirmed' and locked_request.appointment_id is not null then
    return query
    select locked_request.id, locked_request.appointment_id, locked_request.status;
    return;
  end if;

  if locked_request.status not in ('pending', 'in_review') then
    raise exception 'Request cannot be accepted';
  end if;

  saved_appointment_id := public.admin_save_appointment_with_services(
    null,
    locked_request.client_id,
    target_starts_at,
    'confirmed',
    coalesce(target_notes, ''),
    coalesce(target_no_charge, false),
    target_service_ids,
    target_total_duration,
    target_total_price
  );

  update public.client_requests
  set status = 'confirmed',
      appointment_id = saved_appointment_id,
      updated_at = now()
  where id = locked_request.id;

  return query
  select locked_request.id, saved_appointment_id, 'confirmed'::text;
end
$$;

-- Preserve and verify the intended RLS boundary for direct table access.
do $policies$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'client_requests'
      and policyname = 'Admins manage client requests'
  ) then
    execute $sql$
      create policy "Admins manage client requests"
        on public.client_requests
        for all
        to authenticated
        using (public.is_admin())
        with check (public.is_admin())
    $sql$;
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'client_requests'
      and policyname = 'Clients view own requests'
  ) then
    execute $sql$
      create policy "Clients view own requests"
        on public.client_requests
        for select
        to authenticated
        using (
          exists (
            select 1
            from public.clients client_row
            where client_row.id = client_requests.client_id
              and client_row.user_id = auth.uid()
          )
        )
    $sql$;
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'client_requests'
      and policyname = 'Clients create own requests'
  ) then
    execute $sql$
      create policy "Clients create own requests"
        on public.client_requests
        for insert
        to authenticated
        with check (
          status = 'pending'
          and appointment_id is null
          and admin_reply = ''
          and exists (
            select 1
            from public.clients client_row
            where client_row.id = client_requests.client_id
              and client_row.user_id = auth.uid()
          )
        )
    $sql$;
  end if;
end
$policies$;

revoke all on function public.client_submit_request(
  text, text, date[], text, text, uuid
) from public, anon;
revoke all on function public.admin_list_client_requests() from public, anon;
revoke all on function public.admin_respond_client_request(
  uuid, text, text
) from public, anon;
revoke all on function public.admin_accept_client_request(
  uuid, timestamptz, text, boolean, uuid[], integer, numeric
) from public, anon;

grant execute on function public.client_submit_request(
  text, text, date[], text, text, uuid
) to authenticated;
grant execute on function public.admin_list_client_requests() to authenticated;
grant execute on function public.admin_respond_client_request(
  uuid, text, text
) to authenticated;
grant execute on function public.admin_accept_client_request(
  uuid, timestamptz, text, boolean, uuid[], integer, numeric
) to authenticated;

commit;

-- Read-only diagnostic for the already submitted TEST request.
select
  request_row.id,
  request_row.kind,
  request_row.service,
  request_row.preferred_dates,
  request_row.day_period,
  request_row.status,
  request_row.appointment_id,
  request_row.created_at
from public.client_requests request_row
join public.clients client_row
  on client_row.id = request_row.client_id
where public.salon_normalize_phone(client_row.phone)
  = public.salon_normalize_phone('0999302468')
order by request_row.created_at desc;
