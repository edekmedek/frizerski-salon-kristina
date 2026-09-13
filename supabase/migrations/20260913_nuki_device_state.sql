-- Publish verified Nuki state through gateway-owned, narrowly scoped RPC paths.

create or replace function public.gateway_complete_hardware_command(
  command_id uuid, final_status text, final_code text, final_detail text,
  confirmed_state text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  command_row public.hardware_commands;
  published_state text;
  published_observed_at timestamptz;
  published_availability text;
begin
  if final_status not in ('succeeded', 'failed', 'timed_out', 'outcome_unknown') then
    raise exception 'Invalid terminal status';
  end if;
  select c.* into command_row from public.hardware_commands c
  where c.id = command_id and c.status in ('claimed', 'running') and exists (
    select 1 from public.hardware_gateways g
    where g.id = c.gateway_id and g.auth_user_id = auth.uid() and g.enabled
  ) for update;
  if command_row.id is null then raise exception 'Command cannot be completed'; end if;
  if command_row.device = 'nuki' and confirmed_state is not null
      and confirmed_state not in ('locked', 'unlocked', 'unknown') then
    raise exception 'Invalid Nuki state';
  end if;

  if command_row.device = 'boiler' and confirmed_state in ('on', 'off') then
    published_state := confirmed_state;
    published_observed_at := now();
  elsif command_row.device = 'nuki' and confirmed_state in ('locked', 'unlocked', 'unknown') then
    published_state := confirmed_state;
    published_observed_at := case when confirmed_state in ('locked', 'unlocked') then now() else null end;
  else
    published_state := null;
    published_observed_at := null;
  end if;
  published_availability := case
    when final_status <> 'succeeded' then 'error'
    when command_row.device = 'nuki' and published_state = 'unknown' then 'stale'
    else 'available'
  end;

  update public.hardware_commands
  set status = final_status, completed_at = now(), lease_until = null,
      result_code = left(final_code, 100), result_detail = left(final_detail, 500)
  where id = command_id;

  insert into public.hardware_device_states (
    gateway_id, device, state, availability, observed_at, checked_at,
    last_command_id, detail
  ) values (
    command_row.gateway_id, command_row.device,
    coalesce(published_state, 'unknown'), published_availability,
    published_observed_at, now(), command_id, left(final_detail, 500)
  ) on conflict (gateway_id, device) do update set
    state = coalesce(published_state, public.hardware_device_states.state),
    observed_at = coalesce(published_observed_at, public.hardware_device_states.observed_at),
    availability = published_availability,
    checked_at = now(), last_command_id = command_id,
    detail = left(final_detail, 500), updated_at = now();
end;
$$;

create or replace function public.gateway_report_nuki_state(
  reported_state text, reported_detail text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare gateway uuid;
begin
  select g.id into gateway from public.hardware_gateways g
  where g.auth_user_id = auth.uid() and g.enabled;
  if gateway is null then raise exception 'Not authorized'; end if;
  if reported_state not in ('locked', 'unlocked', 'unknown') then
    raise exception 'Invalid Nuki state';
  end if;
  insert into public.hardware_device_states (
    gateway_id, device, state, availability, observed_at, checked_at, detail
  ) values (
    gateway, 'nuki', reported_state,
    case when reported_state = 'unknown' then 'stale' else 'available' end,
    case when reported_state in ('locked', 'unlocked') then now() else null end,
    now(), left(reported_detail, 500)
  ) on conflict (gateway_id, device) do update set
    state = excluded.state, availability = excluded.availability,
    observed_at = coalesce(excluded.observed_at, public.hardware_device_states.observed_at),
    checked_at = excluded.checked_at, detail = excluded.detail, updated_at = now();
end;
$$;

revoke execute on function public.gateway_report_nuki_state(text, text) from public, anon;
grant execute on function public.gateway_report_nuki_state(text, text) to authenticated;
