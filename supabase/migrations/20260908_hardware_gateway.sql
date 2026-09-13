-- Durable, RLS-protected command queue for the salon hardware gateway.

create table public.hardware_gateways (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  auth_user_id uuid not null unique references auth.users(id) on delete restrict,
  enabled boolean not null default true,
  last_seen_at timestamptz,
  app_version text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.hardware_commands (
  id uuid primary key default gen_random_uuid(),
  gateway_id uuid not null references public.hardware_gateways(id) on delete restrict,
  device text not null check (device in ('camera', 'boiler', 'nuki')),
  action text not null,
  status text not null default 'queued'
    check (status in ('queued', 'claimed', 'running', 'succeeded', 'failed', 'timed_out', 'outcome_unknown')),
  requested_by uuid not null references auth.users(id) on delete restrict,
  client_request_id uuid not null,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '45 seconds'),
  claimed_at timestamptz,
  lease_until timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  result_code text,
  result_detail text,
  constraint hardware_command_action_check check (
    (device = 'camera' and action = 'open_live') or
    (device = 'boiler' and action in ('status', 'on', 'off')) or
    (device = 'nuki' and action in ('lock', 'unlock'))
  ),
  unique (requested_by, client_request_id)
);

create index hardware_commands_gateway_queue_idx
  on public.hardware_commands (gateway_id, requested_at)
  where status = 'queued';

create unique index hardware_commands_one_active_device_idx
  on public.hardware_commands (gateway_id, device)
  where status in ('queued', 'claimed', 'running');

create table public.hardware_device_states (
  gateway_id uuid not null references public.hardware_gateways(id) on delete cascade,
  device text not null check (device in ('camera', 'boiler', 'nuki')),
  state text not null default 'unknown',
  availability text not null default 'offline'
    check (availability in ('available', 'stale', 'offline', 'error')),
  observed_at timestamptz,
  checked_at timestamptz,
  last_command_id uuid references public.hardware_commands(id) on delete set null,
  detail text,
  updated_at timestamptz not null default now(),
  primary key (gateway_id, device),
  constraint confirmed_boiler_state_check check (
    device <> 'boiler' or state in ('on', 'off', 'unknown')
  )
);

alter table public.hardware_gateways enable row level security;
alter table public.hardware_commands enable row level security;
alter table public.hardware_device_states enable row level security;

revoke all on public.hardware_gateways from anon, authenticated;
revoke all on public.hardware_commands from anon, authenticated;
revoke all on public.hardware_device_states from anon, authenticated;
grant select on public.hardware_gateways to authenticated;
grant select on public.hardware_commands to authenticated;
grant select on public.hardware_device_states to authenticated;

create policy "admins or owning gateway read gateways"
on public.hardware_gateways for select to authenticated
using (public.is_admin() or auth.uid() = auth_user_id);

create policy "admins or owning gateway read commands"
on public.hardware_commands for select to authenticated
using (
  public.is_admin() or exists (
    select 1 from public.hardware_gateways g
    where g.id = gateway_id and g.auth_user_id = auth.uid() and g.enabled
  )
);

create policy "admins or owning gateway read device states"
on public.hardware_device_states for select to authenticated
using (
  public.is_admin() or exists (
    select 1 from public.hardware_gateways g
    where g.id = gateway_id and g.auth_user_id = auth.uid() and g.enabled
  )
);

create or replace function public.admin_enqueue_hardware_command(
  target_gateway_id uuid,
  target_device text,
  target_action text,
  request_id uuid
) returns public.hardware_commands
language plpgsql
security definer
set search_path = ''
as $$
declare
  created public.hardware_commands;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  if not exists (
    select 1 from public.hardware_gateways g
    where g.id = target_gateway_id and g.enabled
  ) then
    raise exception 'Hardware gateway unavailable';
  end if;
  if not (
    (target_device = 'camera' and target_action = 'open_live') or
    (target_device = 'boiler' and target_action in ('status', 'on', 'off')) or
    (target_device = 'nuki' and target_action in ('lock', 'unlock'))
  ) then
    raise exception 'Unsupported hardware command';
  end if;
  insert into public.hardware_commands (
    gateway_id, device, action, requested_by, client_request_id
  ) values (
    target_gateway_id, target_device, target_action, auth.uid(), request_id
  )
  on conflict (requested_by, client_request_id) do nothing
  returning * into created;
  if created.id is null then
    select c.* into created from public.hardware_commands c
    where c.requested_by = auth.uid() and c.client_request_id = request_id;
  end if;
  return created;
end;
$$;

create or replace function public.gateway_claim_next_hardware_command()
returns setof public.hardware_commands
language plpgsql
security definer
set search_path = ''
as $$
declare
  gateway uuid;
  claimed uuid;
begin
  select g.id into gateway
  from public.hardware_gateways g
  where g.auth_user_id = auth.uid() and g.enabled;
  if gateway is null then raise exception 'Not authorized'; end if;

  update public.hardware_commands
  set status = case when status = 'running' then 'outcome_unknown' else 'timed_out' end,
      completed_at = now(),
      result_code = case when status = 'running' then 'worker_lost_after_start' else 'claim_lease_expired' end,
      lease_until = null
  where gateway_id = gateway and status in ('claimed', 'running') and lease_until <= now();

  update public.hardware_commands
  set status = 'timed_out', completed_at = now(), result_code = 'not_claimed_before_expiry'
  where gateway_id = gateway and status = 'queued' and expires_at <= now();

  select c.id into claimed
  from public.hardware_commands c
  where c.gateway_id = gateway and c.status = 'queued' and c.expires_at > now()
  order by c.requested_at
  for update skip locked
  limit 1;
  if claimed is null then return; end if;

  return query
  update public.hardware_commands
  set status = 'claimed', claimed_at = now(), lease_until = now() + interval '60 seconds'
  where id = claimed
  returning *;
end;
$$;

create or replace function public.gateway_mark_hardware_command_running(command_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.hardware_commands c
  set status = 'running', started_at = now(), lease_until = now() + interval '60 seconds'
  where c.id = command_id and c.status = 'claimed' and exists (
    select 1 from public.hardware_gateways g
    where g.id = c.gateway_id and g.auth_user_id = auth.uid() and g.enabled
  );
  if not found then raise exception 'Command cannot be started'; end if;
end;
$$;

create or replace function public.gateway_complete_hardware_command(
  command_id uuid,
  final_status text,
  final_code text,
  final_detail text,
  confirmed_state text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  command_row public.hardware_commands;
  published_state text;
  published_observed_at timestamptz;
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

  if command_row.device = 'boiler' and confirmed_state in ('on', 'off') then
    published_state := confirmed_state;
    published_observed_at := now();
  else
    published_state := null;
    published_observed_at := null;
  end if;

  update public.hardware_commands
  set status = final_status, completed_at = now(), lease_until = null,
      result_code = left(final_code, 100), result_detail = left(final_detail, 500)
  where id = command_id;

  insert into public.hardware_device_states (
    gateway_id, device, state, availability, observed_at, checked_at,
    last_command_id, detail
  ) values (
    command_row.gateway_id, command_row.device,
    coalesce(published_state, 'unknown'),
    case when final_status = 'succeeded' then 'available' else 'error' end,
    published_observed_at, now(), command_id, left(final_detail, 500)
  ) on conflict (gateway_id, device) do update set
    state = coalesce(published_state, public.hardware_device_states.state),
    observed_at = coalesce(published_observed_at, public.hardware_device_states.observed_at),
    availability = case when final_status = 'succeeded' then 'available' else 'error' end,
    checked_at = now(), last_command_id = command_id,
    detail = left(final_detail, 500), updated_at = now();
end;
$$;

create or replace function public.gateway_heartbeat(gateway_app_version text, gateway_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.hardware_gateways
  set last_seen_at = now(), app_version = left(gateway_app_version, 50),
      last_error = left(gateway_error, 500), updated_at = now()
  where auth_user_id = auth.uid() and enabled;
  if not found then raise exception 'Not authorized'; end if;
end;
$$;

revoke execute on function public.admin_enqueue_hardware_command(uuid, text, text, uuid) from public, anon;
revoke execute on function public.gateway_claim_next_hardware_command() from public, anon;
revoke execute on function public.gateway_mark_hardware_command_running(uuid) from public, anon;
revoke execute on function public.gateway_complete_hardware_command(uuid, text, text, text, text) from public, anon;
revoke execute on function public.gateway_heartbeat(text, text) from public, anon;
grant execute on function public.admin_enqueue_hardware_command(uuid, text, text, uuid) to authenticated;
grant execute on function public.gateway_claim_next_hardware_command() to authenticated;
grant execute on function public.gateway_mark_hardware_command_running(uuid) to authenticated;
grant execute on function public.gateway_complete_hardware_command(uuid, text, text, text, text) to authenticated;
grant execute on function public.gateway_heartbeat(text, text) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.hardware_gateways;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.hardware_commands;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.hardware_device_states;
exception when duplicate_object then null; end $$;

-- Provisioning is intentionally separate: create a dedicated Supabase Auth user, then
-- insert its UUID into hardware_gateways. Never use an administrator or service-role token.
