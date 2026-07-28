begin;

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
  if request_kind = 'appointment' and cardinality(requested_ids) = 0 then
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
  ) then
    raise exception 'A service cannot be selected twice';
  end if;

  if request_kind = 'appointment' then
    if cardinality(requested_ids) = 0
      or coalesce(cardinality(requested_dates), 0) = 0
    then
      raise exception 'Services and at least one preferred date are required';
    end if;
    select count(*), string_agg(service.name, ' + ' order by selected.ordinality)
    into selected_count, combined_names
    from unnest(requested_ids) with ordinality selected(service_id, ordinality)
    join public.services service on service.id = selected.service_id
    where service.is_active and service.is_bookable;
    if selected_count <> cardinality(requested_ids) then
      raise exception 'One or more services are unavailable';
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

revoke all on function public.client_submit_request(
  text, text, date[], text, text, uuid, uuid[]
) from public, anon;
grant execute on function public.client_submit_request(
  text, text, date[], text, text, uuid, uuid[]
) to authenticated;

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

commit;
