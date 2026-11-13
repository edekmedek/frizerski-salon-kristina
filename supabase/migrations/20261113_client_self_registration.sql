-- Self-registration for new clients. Prepared locally; do not execute in production without review.
-- Additive only: reuses existing clients, client_portal_credentials, user_roles and PIN helpers.
-- Registration keeps the client inactive until an administrator approves it.

begin;

do $preflight$
begin
  if to_regprocedure('public.is_admin()') is null
    or to_regprocedure('public.salon_normalize_phone(text)') is null
    or to_regprocedure('public.salon_require_anonymous_client()') is null
    or to_regprocedure('public.salon_check_pin(text)') is null
    or to_regprocedure('public.salon_encrypt_client_pin(text)') is null
  then
    raise exception 'Preflight failed: required portal security functions are missing';
  end if;

  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'clients'
  ) or not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'client_portal_credentials'
  ) or not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'user_roles'
  ) or not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'messages'
  ) then
    raise exception 'Preflight failed: required tables are missing';
  end if;

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
$preflight$;

-- Normalize Croatian mobile numbers consistently, including 0..., +385..., 00385... and 0385...
-- variants, so login, registration and duplicate detection use one canonical form.
create or replace function public.salon_normalize_phone(phone_value text)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  digits text;
begin
  digits := regexp_replace(phone_value, '[^0-9]', '', 'g');

  if digits like '00%' then
    digits := substring(digits from 3);
  end if;

  if digits like '385%' then
    digits := '0' || substring(digits from 4);
  elsif digits like '0385%' then
    digits := '0' || substring(digits from 5);
  end if;

  return digits;
end;
$$;

-- Prevent duplicate active registrations for the same normalized phone number.
create unique index if not exists clients_active_normalized_phone_uidx
  on public.clients (public.salon_normalize_phone(phone))
  where is_active = true;

-- Update login to distinguish an unregistered phone, a pending registration and a
-- wrong PIN without exposing any other account data. The caller only learns about
-- the phone it supplied, and attempts remain subject to the existing anonymous-session guard.
drop function if exists public.login_client_portal(text, text);

create or replace function public.login_client_portal(
  phone_value text,
  pin_value text
)
returns table (client_id uuid, must_change_pin boolean, authenticated boolean, phone_registered boolean, registration_pending boolean)
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
  supplied_phone_exists boolean;
  supplied_phone_active boolean;
  supplied_registration_pending boolean;
begin
  perform public.salon_require_anonymous_client();
  perform public.salon_check_pin(pin_value);

  select exists (
    select 1
    from public.clients
    where public.salon_normalize_phone(phone) = public.salon_normalize_phone(phone_value)
  ),
  exists (
    select 1
    from public.clients
    where is_active = true
      and public.salon_normalize_phone(phone) = public.salon_normalize_phone(phone_value)
  ),
  exists (
    select 1
    from public.clients
    where is_active = false
      and public.salon_normalize_phone(phone) = public.salon_normalize_phone(phone_value)
  )
  into supplied_phone_exists, supplied_phone_active, supplied_registration_pending;

  insert into public.client_portal_login_guards (auth_user_id)
  values (auth.uid())
  on conflict (auth_user_id) do nothing;

  select *
  into guard_record
  from public.client_portal_login_guards
  where auth_user_id = auth.uid()
  for update;

  if guard_record.locked_until is not null and guard_record.locked_until > now() then
    return query select null::uuid, false, false, supplied_phone_exists, supplied_registration_pending;
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

    return query select null::uuid, false, false, supplied_phone_exists, supplied_registration_pending;
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

  return query select matched_client_id, temporary_pin, true, true, false;
end
$$;

create or replace function public.register_client_portal(
  first_name text,
  last_name text,
  phone_value text,
  pin_value text
)
returns table (client_id uuid, registered boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_phone text;
  new_client_id uuid;
  raw_access_token text;
begin
  perform public.salon_require_anonymous_client();
  perform public.salon_check_pin(pin_value);

  if first_name is null or btrim(first_name) = ''
    or last_name is null or btrim(last_name) = ''
    or phone_value is null or btrim(phone_value) = ''
  then
    raise exception 'Registration data is incomplete';
  end if;

  normalized_phone := public.salon_normalize_phone(phone_value);
  if normalized_phone !~ '^0[0-9]{8,10}$' then
    raise exception 'Phone number is invalid';
  end if;

  -- Serialize registration attempts for the same normalized phone number so two
  -- concurrent requests cannot both pass the duplicate check.
  perform pg_advisory_xact_lock(hashtext(normalized_phone));

  -- Do not expose whether a phone is already registered through a separate public
  -- lookup. Registration cannot create a duplicate client, active or pending.
  if exists (
    select 1
    from public.clients
    where public.salon_normalize_phone(phone) = normalized_phone
  ) then
    return query select null::uuid, false;
    return;
  end if;

  raw_access_token := encode(extensions.gen_random_bytes(32), 'hex');

  -- The client remains inactive until an administrator approves the registration.
  insert into public.clients (first_name, last_name, phone, is_active)
  values (btrim(first_name), btrim(last_name), phone_value, false)
  returning id into new_client_id;

  insert into public.client_portal_credentials (
    client_id,
    access_token_hash,
    pin_hash,
    pin_ciphertext,
    pin_is_temporary,
    failed_attempts,
    locked_until,
    activated_at,
    pin_changed_at
  )
  values (
    new_client_id,
    encode(extensions.digest(raw_access_token, 'sha256'), 'hex'),
    extensions.crypt(pin_value, extensions.gen_salt('bf', 11)),
    public.salon_encrypt_client_pin(pin_value),
    false,
    0,
    null,
    now(),
    now()
  );

  -- Notify Kristina through the existing message inbox; no separate inbox is created.
  insert into public.messages (client_id, sender, subject, message, is_read)
  values (
    new_client_id,
    'client',
    'Novi zahtjev za registraciju',
    'Klijent ' || btrim(first_name) || ' ' || btrim(last_name) || ' (' || phone_value || ') zatražio je registraciju.',
    false
  );

  delete from public.client_portal_login_guards where auth_user_id = auth.uid();

  return query select new_client_id, true;
end
$$;

create or replace function public.admin_approve_client_registration(target_client_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  update public.clients
  set is_active = true, updated_at = now()
  where id = target_client_id
    and is_active = false
    and exists (
      select 1
      from public.client_portal_credentials
      where client_id = target_client_id
    );

  if not found then
    raise exception 'Client is unavailable';
  end if;

  update public.client_portal_credentials
  set activated_at = coalesce(activated_at, now()),
      pin_changed_at = coalesce(pin_changed_at, now()),
      updated_at = now()
  where client_id = target_client_id;

  insert into public.messages (client_id, sender, subject, message, is_read, read_at)
  values (
    target_client_id,
    'admin',
    'Pristup odobren',
    'Vaš pristup klijentskom portalu je odobren. Sada se možete prijaviti brojem mobitela i PIN-om.',
    true,
    now()
  );

  return true;
end
$$;

revoke all on function public.login_client_portal(text, text) from public;
revoke all on function public.register_client_portal(text, text, text, text) from public;
revoke all on function public.register_client_portal(text, text, text, text) from anon;
revoke all on function public.admin_approve_client_registration(uuid) from public, anon;

grant execute on function public.login_client_portal(text, text) to authenticated;
grant execute on function public.register_client_portal(text, text, text, text) to authenticated;
grant execute on function public.admin_approve_client_registration(uuid) to authenticated;

commit;
