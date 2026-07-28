begin;

create or replace function public.admin_create_custom_proposal_for_client_request(
  target_request_id uuid,
  target_starts_at timestamptz,
  target_total_duration integer,
  target_lifecycle_status text,
  target_confirmation_status text,
  reply_message text,
  target_notes text,
  target_no_charge boolean,
  target_treatments jsonb
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
  treatments jsonb := coalesce(target_treatments, '[]'::jsonb);
  treatment_count integer := 0;
  selected_count integer := 0;
  distinct_count integer := 0;
  duration_sum integer := 0;
  first_service_id uuid;
  combined_names text;
  calculated_price numeric(10,2) := 0;
  final_price numeric(10,2);
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  if jsonb_typeof(treatments) <> 'array' then
    raise exception 'Treatments must be an array';
  end if;

  select request_row.*
  into locked_request
  from public.client_requests as request_row
  where request_row.id = target_request_id
  for update;

  if locked_request.id is null
    or locked_request.status not in ('pending', 'in_review')
    or locked_request.appointment_id is not null
  then
    raise exception 'Request is unavailable';
  end if;
  if not exists (
    select 1
    from public.clients as client_row
    where client_row.id = locked_request.client_id
      and client_row.is_active = true
  ) then
    raise exception 'Client is unavailable';
  end if;
  if target_starts_at is null or target_total_duration is null
    or target_total_duration < 5 or target_total_duration % 5 <> 0
  then
    raise exception 'Duration must use 5-minute steps';
  end if;
  if target_lifecycle_status <> 'confirmed' then
    raise exception 'A proposal must use an active lifecycle status';
  end if;
  if target_confirmation_status not in ('pending', 'confirmed') then
    raise exception 'Unsupported appointment confirmation status';
  end if;

  select count(*),
    count(distinct (treatment_item.value ->> 'service_id')),
    coalesce(sum((treatment_item.value ->> 'duration_minutes')::integer), 0)
  into treatment_count, distinct_count, duration_sum
  from jsonb_array_elements(treatments) as treatment_item
  where nullif(treatment_item.value ->> 'service_id', '') is not null
    and (treatment_item.value ->> 'duration_minutes') ~ '^[0-9]+$'
    and (treatment_item.value ->> 'duration_minutes')::integer % 5 = 0;

  if treatment_count <> jsonb_array_length(treatments) then
    raise exception 'Every treatment requires a service and duration';
  end if;
  if distinct_count <> treatment_count then
    raise exception 'A service cannot be selected twice';
  end if;
  if treatment_count > 0 and duration_sum <> target_total_duration then
    raise exception 'Total duration must match treatment durations';
  end if;

  if treatment_count > 0 then
    select count(*),
      (array_agg(service_row.id order by treatment_item.ordinality))[1],
      string_agg(service_row.name, ' + ' order by treatment_item.ordinality),
      sum(service_row.price)
    into selected_count, first_service_id, combined_names, calculated_price
    from jsonb_array_elements(treatments)
      with ordinality as treatment_item(value, ordinality)
    join public.services as service_row
      on service_row.id =
        (treatment_item.value ->> 'service_id')::uuid
    where service_row.is_active = true
      and service_row.is_bookable = true;

    if selected_count <> treatment_count then
      raise exception 'One or more services are unavailable';
    end if;
  end if;

  final_price := case
    when coalesce(target_no_charge, false) then 0
    else coalesce(calculated_price, 0)
  end;

  delete from public.client_request_services as request_service_row
  where request_service_row.request_id = locked_request.id;

  insert into public.client_request_services (
    request_id,
    service_id,
    service_name_snapshot,
    service_price_snapshot,
    service_duration_snapshot,
    display_order
  )
  select
    locked_request.id,
    service_row.id,
    service_row.name,
    service_row.price,
    (treatment_item.value ->> 'duration_minutes')::integer,
    treatment_item.ordinality - 1
  from jsonb_array_elements(treatments)
    with ordinality as treatment_item(value, ordinality)
  join public.services as service_row
    on service_row.id =
      (treatment_item.value ->> 'service_id')::uuid;

  insert into public.appointments (
    id,
    client_id,
    starts_at,
    ends_at,
    service_id,
    service,
    service_name_snapshot,
    service_price_snapshot,
    service_duration_snapshot,
    total_price_snapshot,
    total_duration_minutes,
    status,
    confirmation_status,
    notes,
    no_charge
  ) values (
    saved_appointment_id,
    locked_request.client_id,
    target_starts_at,
    target_starts_at + make_interval(mins => target_total_duration),
    first_service_id,
    coalesce(combined_names, ''),
    coalesce(combined_names, ''),
    final_price,
    target_total_duration,
    final_price,
    target_total_duration,
    target_lifecycle_status,
    target_confirmation_status,
    nullif(target_notes, ''),
    coalesce(target_no_charge, false)
  );

  insert into public.appointment_services (
    appointment_id,
    service_id,
    service_name_snapshot,
    service_price_snapshot,
    service_duration_snapshot,
    display_order
  )
  select
    saved_appointment_id,
    service_row.id,
    service_row.name,
    service_row.price,
    (treatment_item.value ->> 'duration_minutes')::integer,
    treatment_item.ordinality - 1
  from jsonb_array_elements(treatments)
    with ordinality as treatment_item(value, ordinality)
  join public.services as service_row
    on service_row.id =
      (treatment_item.value ->> 'service_id')::uuid;

  update public.client_requests as request_row
  set service = coalesce(combined_names, ''),
      status = case
        when target_confirmation_status = 'confirmed' then 'confirmed'
        else 'in_review'
      end,
      admin_reply = btrim(reply_message),
      client_reply = '',
      appointment_id = saved_appointment_id,
      proposed_starts_at = target_starts_at,
      proposed_duration_minutes = target_total_duration,
      admin_read_at = coalesce(request_row.admin_read_at, now()),
      updated_at = now()
  where request_row.id = locked_request.id;

  if not found then
    raise exception 'Request could not be linked';
  end if;

  return query
  select
    saved_appointment_id,
    locked_request.id,
    case
      when target_confirmation_status = 'confirmed' then 'confirmed'::text
      else 'in_review'::text
    end;
end
$$;

revoke all on function public.admin_create_custom_proposal_for_client_request(
  uuid, timestamptz, integer, text, text, text, text, boolean, jsonb
) from public, anon;
grant execute on function public.admin_create_custom_proposal_for_client_request(
  uuid, timestamptz, integer, text, text, text, text, boolean, jsonb
) to authenticated;

commit;
