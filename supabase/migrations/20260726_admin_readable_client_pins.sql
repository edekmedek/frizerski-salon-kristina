-- Administrator-readable client PINs without weakening the existing bcrypt login check.
-- Existing PIN hashes and client access remain unchanged. A readable value becomes
-- available only after a PIN is set or changed through one of the RPC functions below.

begin;

do $preflight$
begin
  if to_regprocedure('public.is_admin()') is null
    or to_regprocedure('public.salon_check_pin(text)') is null
    or to_regprocedure('public.salon_require_anonymous_client()') is null
  then
    raise exception 'Preflight failed: required portal security functions are missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'client_portal_credentials'
      and column_name = 'pin_hash'
  ) then
    raise exception 'Preflight failed: client portal credentials are missing';
  end if;
end
$preflight$;

create table if not exists public.client_portal_pin_key_store (
  singleton boolean primary key default true check (singleton),
  encryption_key text not null,
  created_at timestamptz not null default now()
);

insert into public.client_portal_pin_key_store (singleton, encryption_key)
values (true, encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (singleton) do nothing;

alter table public.client_portal_credentials
  add column if not exists pin_ciphertext bytea;

alter table public.clients
  add column if not exists test_seed_tag text;

alter table public.client_portal_pin_key_store enable row level security;
revoke all on public.client_portal_pin_key_store from public, anon, authenticated;
revoke all on public.client_portal_credentials from anon, authenticated;

create or replace function public.salon_encrypt_client_pin(pin_value text)
returns bytea
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  secret_key text;
begin
  perform public.salon_check_pin(pin_value);

  select key_store.encryption_key
  into strict secret_key
  from public.client_portal_pin_key_store key_store
  where key_store.singleton = true;

  return extensions.pgp_sym_encrypt(
    pin_value,
    secret_key,
    'cipher-algo=aes256, compress-algo=0'
  );
end
$$;

create or replace function public.salon_decrypt_client_pin(pin_ciphertext bytea)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  secret_key text;
begin
  if pin_ciphertext is null then
    return null;
  end if;

  select key_store.encryption_key
  into strict secret_key
  from public.client_portal_pin_key_store key_store
  where key_store.singleton = true;

  return extensions.pgp_sym_decrypt(pin_ciphertext, secret_key);
exception
  when others then
    return null;
end
$$;

create or replace function public.admin_client_portal_pin_status()
returns table (
  client_id uuid,
  portal_activated boolean,
  pin_is_temporary boolean,
  locked_until timestamptz,
  current_pin text
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
    client_row.id,
    (credential.pin_hash is not null),
    coalesce(credential.pin_is_temporary, false),
    credential.locked_until,
    public.salon_decrypt_client_pin(credential.pin_ciphertext)
  from public.clients client_row
  left join public.client_portal_credentials credential
    on credential.client_id = client_row.id;
end
$$;

create or replace function public.admin_set_client_pin(
  target_client_id uuid,
  pin_value text
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
  perform public.salon_check_pin(pin_value);

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
  select
    client_row.id,
    encode(extensions.digest(extensions.gen_random_bytes(32), 'sha256'), 'hex'),
    extensions.crypt(pin_value, extensions.gen_salt('bf', 11)),
    public.salon_encrypt_client_pin(pin_value),
    false,
    0,
    null,
    now(),
    now()
  from public.clients client_row
  where client_row.id = target_client_id
    and client_row.is_active = true
  on conflict (client_id) do update
    set pin_hash = excluded.pin_hash,
        pin_ciphertext = excluded.pin_ciphertext,
        pin_is_temporary = false,
        failed_attempts = 0,
        locked_until = null,
        activated_at = coalesce(public.client_portal_credentials.activated_at, now()),
        pin_changed_at = now(),
        updated_at = now();

  if not found then
    raise exception 'Client is unavailable';
  end if;
end
$$;

create or replace function public.admin_generate_client_pin(target_client_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  generated_pin text;
  random_bytes bytea;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  random_bytes := extensions.gen_random_bytes(2);
  generated_pin := lpad(
    (((get_byte(random_bytes, 0) * 256 + get_byte(random_bytes, 1)) % 10000))::text,
    4,
    '0'
  );
  perform public.admin_set_client_pin(target_client_id, generated_pin);
  return generated_pin;
end
$$;

-- Keep the legacy RPC callable while ensuring every newly assigned temporary PIN
-- also receives its administrator-readable encrypted copy.
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
      pin_ciphertext = public.salon_encrypt_client_pin(temporary_pin),
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

-- First activation remains tied to the personal access token and verified phone.
-- The chosen PIN is stored as a bcrypt hash for login and as encrypted ciphertext
-- for the administrator-only readable view.
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

  select client_row.id
  into matched_client_id
  from public.clients client_row
  join public.client_portal_credentials credential
    on credential.client_id = client_row.id
  where credential.access_token_hash = encode(extensions.digest(access_token, 'sha256'), 'hex')
    and public.salon_normalize_phone(client_row.phone) = normalized_phone
    and client_row.is_active = true
    and credential.pin_hash is null
  for update of client_row, credential;

  if matched_client_id is null then
    raise exception 'Access could not be verified';
  end if;

  update public.clients
  set user_id = null,
      updated_at = now()
  where user_id = auth.uid()
    and id <> matched_client_id;

  update public.clients
  set user_id = auth.uid(),
      updated_at = now()
  where id = matched_client_id;

  insert into public.user_roles (user_id, role)
  values (auth.uid(), 'client')
  on conflict (user_id) do update
    set role = 'client';

  update public.client_portal_credentials
  set pin_hash = extensions.crypt(permanent_pin, extensions.gen_salt('bf', 11)),
      pin_ciphertext = public.salon_encrypt_client_pin(permanent_pin),
      pin_is_temporary = false,
      failed_attempts = 0,
      locked_until = null,
      activated_at = now(),
      pin_changed_at = now(),
      updated_at = now()
  where client_id = matched_client_id;

  delete from public.client_portal_login_guards
  where auth_user_id = auth.uid();

  return query
  select matched_client_id, false;
end
$$;

-- Client-selected PIN changes continue to use bcrypt for login and additionally
-- refresh the encrypted administrator-readable copy.
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

  select client_row.id, credential.pin_hash
  into own_client_id, stored_pin_hash
  from public.clients client_row
  join public.client_portal_credentials credential
    on credential.client_id = client_row.id
  where client_row.user_id = auth.uid()
  for update of credential;

  if own_client_id is null
    or stored_pin_hash <> extensions.crypt(current_pin, stored_pin_hash)
  then
    raise exception 'PIN change could not be verified';
  end if;

  update public.client_portal_credentials
  set pin_hash = extensions.crypt(new_permanent_pin, extensions.gen_salt('bf', 11)),
      pin_ciphertext = public.salon_encrypt_client_pin(new_permanent_pin),
      pin_is_temporary = false,
      failed_attempts = 0,
      locked_until = null,
      pin_changed_at = now(),
      updated_at = now()
  where client_id = own_client_id;
end
$$;

-- Dedicated, idempotent TEST identity for client portal verification.
insert into public.clients (
  id,
  first_name,
  last_name,
  phone,
  notes,
  is_active,
  test_seed_tag
)
values (
  'b1000000-0000-4000-8000-000000000001',
  'TEST Klijent',
  'PIN Provjera',
  '0999302468',
  '[TEST] Klijent za provjeru prijave i prikaza PIN-a.',
  true,
  'kristina_client_pin_test_v1'
)
on conflict (id) do nothing;

do $test_client_preflight$
begin
  if not exists (
    select 1
    from public.clients
    where id = 'b1000000-0000-4000-8000-000000000001'
      and test_seed_tag = 'kristina_client_pin_test_v1'
  ) then
    raise exception 'TEST client preflight failed';
  end if;
end
$test_client_preflight$;

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
  'b1000000-0000-4000-8000-000000000001',
  encode(extensions.digest('kristina_client_pin_test_v1', 'sha256'), 'hex'),
  extensions.crypt('2468', extensions.gen_salt('bf', 11)),
  public.salon_encrypt_client_pin('2468'),
  false,
  0,
  null,
  now(),
  now()
)
on conflict (client_id) do nothing;

revoke all on function public.salon_encrypt_client_pin(text) from public, anon, authenticated;
revoke all on function public.salon_decrypt_client_pin(bytea) from public, anon, authenticated;
revoke all on function public.admin_client_portal_pin_status() from public, anon;
revoke all on function public.admin_set_client_pin(uuid, text) from public, anon;
revoke all on function public.admin_generate_client_pin(uuid) from public, anon;
revoke all on function public.admin_set_client_temporary_pin(uuid, text) from public, anon;
revoke all on function public.activate_client_portal(text, text, text) from public, anon;
revoke all on function public.change_client_portal_pin(text, text) from public, anon;

grant execute on function public.admin_client_portal_pin_status() to authenticated;
grant execute on function public.admin_set_client_pin(uuid, text) to authenticated;
grant execute on function public.admin_generate_client_pin(uuid) to authenticated;
grant execute on function public.admin_set_client_temporary_pin(uuid, text) to authenticated;
grant execute on function public.activate_client_portal(text, text, text) to authenticated;
grant execute on function public.change_client_portal_pin(text, text) to authenticated;

commit;

select
  client_row.first_name,
  client_row.last_name,
  client_row.phone as test_phone,
  public.salon_decrypt_client_pin(credential.pin_ciphertext) as test_pin,
  (credential.pin_hash is not null) as portal_activated,
  client_row.test_seed_tag
from public.clients client_row
join public.client_portal_credentials credential
  on credential.client_id = client_row.id
where client_row.id = 'b1000000-0000-4000-8000-000000000001';
