-- FINAL REVIEWED DRAFT — run once in the Supabase SQL Editor.
-- Based on the live catalog inspection from 2026-07-24.
-- Additive only: no existing table, account, role, policy, photo, or bucket is removed.

begin;

do $preflight$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clients'
      and column_name = 'id' and udt_name = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clients'
      and column_name = 'user_id' and udt_name = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clients'
      and column_name = 'phone' and udt_name = 'text'
  ) then
    raise exception 'Preflight failed: public.clients no longer matches the inspected schema';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'appointments'
      and column_name = 'id' and udt_name = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'appointments'
      and column_name = 'client_id' and udt_name = 'uuid'
  ) then
    raise exception 'Preflight failed: public.appointments no longer matches the inspected schema';
  end if;

  if to_regprocedure('public.is_admin()') is null then
    raise exception 'Preflight failed: public.is_admin() is missing';
  end if;
end
$preflight$;

create table if not exists public.client_portal_credentials (
  client_id uuid primary key references public.clients(id) on delete cascade,
  access_token_hash text not null unique,
  pin_hash text,
  pin_is_temporary boolean not null default false,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  activated_at timestamptz,
  pin_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_portal_pin_state check (
    (pin_hash is null and activated_at is null and pin_is_temporary = false)
    or (pin_hash is not null and activated_at is not null)
  )
);

create table if not exists public.client_portal_login_guards (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.client_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null check (kind in ('appointment', 'change', 'cancellation')),
  service text,
  preferred_dates date[] not null default '{}',
  day_period text not null default 'any'
    check (day_period in ('morning', 'afternoon', 'any')),
  client_message text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'in_review', 'confirmed', 'rejected')),
  admin_reply text not null default '',
  appointment_id uuid references public.appointments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.appointment_reminders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  kind text not null check (kind in ('day_before', 'hour_before', 'manual')),
  channel text not null default 'in_app'
    check (channel in ('in_app', 'sms', 'web_push')),
  title text not null,
  body text not null,
  scheduled_for timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'delivered', 'cancelled', 'failed')),
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (appointment_id, kind, channel, scheduled_for)
);

alter table public.hairstyle_photos
  add column if not exists visible_to_client boolean not null default false;

create index if not exists client_requests_client_created_idx
  on public.client_requests (client_id, created_at desc);
create index if not exists client_requests_status_created_idx
  on public.client_requests (status, created_at desc);
create index if not exists appointment_reminders_due_idx
  on public.appointment_reminders (scheduled_for)
  where status = 'scheduled';
create index if not exists appointment_reminders_client_idx
  on public.appointment_reminders (client_id, scheduled_for desc);
create index if not exists client_portal_credentials_locked_idx
  on public.client_portal_credentials (locked_until)
  where locked_until is not null;

create or replace function public.salon_normalize_phone(phone_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select regexp_replace(
    case
      when regexp_replace(phone_value, '[^0-9]', '', 'g') like '385%'
        then '0' || substring(regexp_replace(phone_value, '[^0-9]', '', 'g') from 4)
      else regexp_replace(phone_value, '[^0-9]', '', 'g')
    end,
    '[^0-9]',
    '',
    'g'
  )
$$;

create or replace function public.salon_require_anonymous_client()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true
  then
    raise exception 'Client authentication is required';
  end if;
end
$$;

create or replace function public.salon_check_pin(pin_value text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if pin_value is null or pin_value !~ '^[0-9]{4}$' then
    raise exception 'PIN must contain exactly four digits';
  end if;
end
$$;

do $normalized_phone_preflight$
begin
  if exists (
    select 1
    from public.clients
    where is_active = true
    group by public.salon_normalize_phone(phone)
    having count(*) > 1
  ) then
    raise exception 'Preflight failed: active clients contain duplicate normalized phone numbers';
  end if;
end
$normalized_phone_preflight$;

create or replace function public.admin_create_client_access(target_client_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw_token text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  if not exists (
    select 1 from public.clients
    where id = target_client_id and is_active = true
  ) then
    raise exception 'Client is unavailable';
  end if;

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.client_portal_credentials (
    client_id,
    access_token_hash
  )
  values (
    target_client_id,
    encode(extensions.digest(raw_token, 'sha256'), 'hex')
  )
  on conflict (client_id) do update
    set access_token_hash = excluded.access_token_hash,
        updated_at = now();

  return raw_token;
end
$$;

create or replace function public.admin_client_portal_status()
returns table (
  client_id uuid,
  portal_activated boolean,
  pin_is_temporary boolean,
  locked_until timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    (pc.pin_hash is not null),
    coalesce(pc.pin_is_temporary, false),
    pc.locked_until
  from public.clients c
  left join public.client_portal_credentials pc on pc.client_id = c.id
  where public.is_admin()
$$;

create or replace function public.admin_set_client_temporary_pin(
  target_client_id uuid,
  temporary_pin text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  perform public.salon_check_pin(temporary_pin);

  update public.client_portal_credentials
  set pin_hash = extensions.crypt(temporary_pin, extensions.gen_salt('bf', 11)),
      pin_is_temporary = true,
      failed_attempts = 0,
      locked_until = null,
      activated_at = coalesce(activated_at, now()),
      pin_changed_at = now(),
      updated_at = now()
  where client_id = target_client_id;

  if not found then
    raise exception 'Create portal access before setting a temporary PIN';
  end if;
end
$$;

create or replace function public.admin_initialize_demo_pin(target_client_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_count integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  insert into public.client_portal_credentials (
    client_id,
    access_token_hash,
    pin_hash,
    pin_is_temporary,
    activated_at,
    pin_changed_at
  )
  select
    c.id,
    encode(extensions.digest(extensions.gen_random_bytes(32), 'sha256'), 'hex'),
    extensions.crypt('1234', extensions.gen_salt('bf', 11)),
    true,
    now(),
    now()
  from public.clients c
  where c.id = any(target_client_ids)
    and c.is_active = true
  on conflict (client_id) do update
    set pin_hash = case
          when client_portal_credentials.pin_hash is null
            then excluded.pin_hash
          else client_portal_credentials.pin_hash
        end,
        pin_is_temporary = case
          when client_portal_credentials.pin_hash is null
            then true
          else client_portal_credentials.pin_is_temporary
        end,
        activated_at = coalesce(client_portal_credentials.activated_at, now()),
        pin_changed_at = case
          when client_portal_credentials.pin_hash is null
            then now()
          else client_portal_credentials.pin_changed_at
        end,
        updated_at = now();

  get diagnostics changed_count = row_count;
  return changed_count;
end
$$;

create or replace function public.activate_client_portal(
  access_token text,
  phone_value text,
  permanent_pin text
)
returns table (client_id uuid, must_change_pin boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_client_id uuid;
  normalized_phone text;
begin
  perform public.salon_require_anonymous_client();
  perform public.salon_check_pin(permanent_pin);
  normalized_phone := public.salon_normalize_phone(phone_value);

  select c.id
  into matched_client_id
  from public.clients c
  join public.client_portal_credentials pc on pc.client_id = c.id
  where pc.access_token_hash = encode(extensions.digest(access_token, 'sha256'), 'hex')
    and public.salon_normalize_phone(c.phone) = normalized_phone
    and c.is_active = true
    and pc.pin_hash is null
  for update of c, pc;

  if matched_client_id is null then
    raise exception 'Access could not be verified';
  end if;

  update public.clients
  set user_id = null, updated_at = now()
  where user_id = auth.uid() and id <> matched_client_id;

  update public.clients
  set user_id = auth.uid(), updated_at = now()
  where id = matched_client_id;

  insert into public.user_roles (user_id, role)
  values (auth.uid(), 'client')
  on conflict (user_id) do update set role = 'client';

  update public.client_portal_credentials
  set pin_hash = extensions.crypt(permanent_pin, extensions.gen_salt('bf', 11)),
      pin_is_temporary = false,
      failed_attempts = 0,
      locked_until = null,
      activated_at = now(),
      pin_changed_at = now(),
      updated_at = now()
  where client_portal_credentials.client_id = matched_client_id;

  delete from public.client_portal_login_guards where auth_user_id = auth.uid();
  return query select matched_client_id, false;
end
$$;

create or replace function public.login_client_portal(
  phone_value text,
  pin_value text
)
returns table (client_id uuid, must_change_pin boolean, authenticated boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_client_id uuid;
  stored_pin_hash text;
  temporary_pin boolean;
  client_locked_until timestamptz;
  guard_record public.client_portal_login_guards%rowtype;
  next_failures integer;
begin
  perform public.salon_require_anonymous_client();
  perform public.salon_check_pin(pin_value);

  insert into public.client_portal_login_guards (auth_user_id)
  values (auth.uid())
  on conflict (auth_user_id) do nothing;

  select *
  into guard_record
  from public.client_portal_login_guards
  where auth_user_id = auth.uid()
  for update;

  if guard_record.locked_until is not null and guard_record.locked_until > now() then
    return query select null::uuid, false, false;
    return;
  end if;

  select c.id, pc.pin_hash, pc.pin_is_temporary, pc.locked_until
  into matched_client_id, stored_pin_hash, temporary_pin, client_locked_until
  from public.clients c
  join public.client_portal_credentials pc on pc.client_id = c.id
  where public.salon_normalize_phone(c.phone) = public.salon_normalize_phone(phone_value)
    and c.is_active = true
    and pc.pin_hash is not null
  for update of c, pc;

  if matched_client_id is null
    or (client_locked_until is not null and client_locked_until > now())
    or stored_pin_hash <> extensions.crypt(pin_value, stored_pin_hash)
  then
    next_failures := guard_record.failed_attempts + 1;
    update public.client_portal_login_guards
    set failed_attempts = case when next_failures >= 5 then 0 else next_failures end,
        locked_until = case when next_failures >= 5 then now() + interval '15 minutes' else null end,
        updated_at = now()
    where auth_user_id = auth.uid();

    if matched_client_id is not null then
      update public.client_portal_credentials
      set failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
          locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else null end,
          updated_at = now()
      where client_portal_credentials.client_id = matched_client_id;
    end if;

    return query select null::uuid, false, false;
    return;
  end if;

  update public.clients
  set user_id = null, updated_at = now()
  where user_id = auth.uid() and id <> matched_client_id;

  update public.clients
  set user_id = auth.uid(), updated_at = now()
  where id = matched_client_id;

  insert into public.user_roles (user_id, role)
  values (auth.uid(), 'client')
  on conflict (user_id) do update set role = 'client';

  update public.client_portal_credentials
  set failed_attempts = 0, locked_until = null, updated_at = now()
  where client_portal_credentials.client_id = matched_client_id;
  delete from public.client_portal_login_guards where auth_user_id = auth.uid();

  return query select matched_client_id, temporary_pin, true;
end
$$;

create or replace function public.change_client_portal_pin(
  current_pin text,
  new_permanent_pin text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  own_client_id uuid;
  stored_pin_hash text;
begin
  perform public.salon_require_anonymous_client();
  perform public.salon_check_pin(current_pin);
  perform public.salon_check_pin(new_permanent_pin);

  select c.id, pc.pin_hash
  into own_client_id, stored_pin_hash
  from public.clients c
  join public.client_portal_credentials pc on pc.client_id = c.id
  where c.user_id = auth.uid()
  for update of pc;

  if own_client_id is null
    or stored_pin_hash <> extensions.crypt(current_pin, stored_pin_hash)
  then
    raise exception 'PIN change could not be verified';
  end if;

  update public.client_portal_credentials
  set pin_hash = extensions.crypt(new_permanent_pin, extensions.gen_salt('bf', 11)),
      pin_is_temporary = false,
      failed_attempts = 0,
      locked_until = null,
      pin_changed_at = now(),
      updated_at = now()
  where client_portal_credentials.client_id = own_client_id;
end
$$;

alter table public.client_portal_credentials enable row level security;
alter table public.client_portal_login_guards enable row level security;
alter table public.client_requests enable row level security;
alter table public.appointment_reminders enable row level security;

revoke all on public.client_portal_credentials from anon, authenticated;
revoke all on public.client_portal_login_guards from anon, authenticated;
revoke all on public.client_requests from anon, authenticated;
revoke all on public.appointment_reminders from anon, authenticated;

grant select, insert, update, delete on public.client_requests to authenticated;
grant select, insert, update, delete on public.appointment_reminders to authenticated;

revoke all on function public.salon_normalize_phone(text) from public;
revoke all on function public.salon_require_anonymous_client() from public;
revoke all on function public.salon_check_pin(text) from public;
revoke all on function public.admin_create_client_access(uuid) from public;
revoke all on function public.admin_client_portal_status() from public;
revoke all on function public.admin_set_client_temporary_pin(uuid, text) from public;
revoke all on function public.admin_initialize_demo_pin(uuid[]) from public;
revoke all on function public.activate_client_portal(text, text, text) from public;
revoke all on function public.login_client_portal(text, text) from public;
revoke all on function public.change_client_portal_pin(text, text) from public;

grant execute on function public.admin_create_client_access(uuid) to authenticated;
grant execute on function public.admin_client_portal_status() to authenticated;
grant execute on function public.admin_set_client_temporary_pin(uuid, text) to authenticated;
grant execute on function public.admin_initialize_demo_pin(uuid[]) to authenticated;
grant execute on function public.activate_client_portal(text, text, text) to authenticated;
grant execute on function public.login_client_portal(text, text) to authenticated;
grant execute on function public.change_client_portal_pin(text, text) to authenticated;

do $policies$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'client_requests'
      and policyname = 'Admins manage client requests'
  ) then
    execute $sql$
      create policy "Admins manage client requests"
        on public.client_requests for all to authenticated
        using (public.is_admin()) with check (public.is_admin())
    $sql$;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'client_requests'
      and policyname = 'Clients view own requests'
  ) then
    execute $sql$
      create policy "Clients view own requests"
        on public.client_requests for select to authenticated
        using (
          exists (
            select 1 from public.clients
            where clients.id = client_requests.client_id
              and clients.user_id = auth.uid()
          )
        )
    $sql$;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'client_requests'
      and policyname = 'Clients create own requests'
  ) then
    execute $sql$
      create policy "Clients create own requests"
        on public.client_requests for insert to authenticated
        with check (
          status = 'pending'
          and appointment_id is null
          and admin_reply = ''
          and exists (
            select 1 from public.clients
            where clients.id = client_requests.client_id
              and clients.user_id = auth.uid()
          )
        )
    $sql$;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'appointment_reminders'
      and policyname = 'Admins manage appointment reminders'
  ) then
    execute $sql$
      create policy "Admins manage appointment reminders"
        on public.appointment_reminders for all to authenticated
        using (public.is_admin()) with check (public.is_admin())
    $sql$;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'appointment_reminders'
      and policyname = 'Clients view own appointment reminders'
  ) then
    execute $sql$
      create policy "Clients view own appointment reminders"
        on public.appointment_reminders for select to authenticated
        using (
          exists (
            select 1 from public.clients
            where clients.id = appointment_reminders.client_id
              and clients.user_id = auth.uid()
          )
        )
    $sql$;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'hairstyle_photos'
      and policyname = 'Clients only view shared hairstyle photos'
  ) then
    execute $sql$
      create policy "Clients only view shared hairstyle photos"
        on public.hairstyle_photos
        as restrictive
        for select to authenticated
        using (
          public.is_admin()
          or (
            visible_to_client = true
            and exists (
              select 1 from public.clients
              where clients.id = hairstyle_photos.client_id
                and clients.user_id = auth.uid()
            )
          )
        )
    $sql$;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Clients only read authorized client photos'
  ) then
    execute $sql$
      create policy "Clients only read authorized client photos"
        on storage.objects
        as restrictive
        for select to authenticated
        using (
          public.is_admin()
          or (
            bucket_id = 'client-photos'
            and exists (
              select 1
              from public.clients c
              where c.user_id = auth.uid()
                and (
                  c.profile_photo_path = objects.name
                  or exists (
                    select 1
                    from public.hairstyle_photos hp
                    where hp.client_id = c.id
                      and hp.visible_to_client = true
                      and objects.name in (hp.image_path, hp.thumbnail_path)
                  )
                )
            )
          )
        )
    $sql$;
  end if;
end
$policies$;

insert into public.client_portal_credentials (
  client_id,
  access_token_hash,
  pin_hash,
  pin_is_temporary,
  activated_at,
  pin_changed_at
)
select
  c.id,
  encode(extensions.digest(extensions.gen_random_bytes(32), 'sha256'), 'hex'),
  extensions.crypt('1234', extensions.gen_salt('bf', 11)),
  true,
  now(),
  now()
from public.clients c
where (c.first_name, c.last_name, public.salon_normalize_phone(c.phone)) in (
  ('Ana', 'Kovačević', '0981234567'),
  ('Marta', 'Rukavina', '0913344556'),
  ('Ivana', 'Perić', '0952221144')
)
on conflict (client_id) do update
  set pin_hash = case
        when client_portal_credentials.pin_hash is null
          then excluded.pin_hash
        else client_portal_credentials.pin_hash
      end,
      pin_is_temporary = case
        when client_portal_credentials.pin_hash is null
          then true
        else client_portal_credentials.pin_is_temporary
      end,
      activated_at = coalesce(client_portal_credentials.activated_at, now()),
      pin_changed_at = case
        when client_portal_credentials.pin_hash is null
          then now()
        else client_portal_credentials.pin_changed_at
      end,
      updated_at = now();

commit;

-- Only the three exact local demo identities above receive PIN 1234.
-- Existing credentials are never overwritten.
